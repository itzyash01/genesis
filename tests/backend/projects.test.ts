import { beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({documents:new Map<string,any>(), connected:true}));
vi.mock('../../functions/src/config',()=>{const p={value:()=> 'value'};return {allowedOrigins:p,appOrigin:p,hlClientId:p,hlClientSecret:p,hlRedirectUri:p,hlScopes:p,llmApiKey:p,tokenEncryptionKey:p};});
vi.mock('../../functions/src/highlevel',()=>({HighLevelApiError:class extends Error{},getHighLevelConnection:async()=>state.connected?{connected:true,locationId:'loc',locationName:'Location'}:{connected:false},createHighLevelAuthorizationUrl:vi.fn(),disconnectHighLevel:vi.fn(),finishHighLevelOAuth:vi.fn(),getHighLevelData:vi.fn(),executeHighLevelWrite:vi.fn()}));
vi.mock('../../functions/src/generation',()=>({generateProjectFiles:vi.fn()}));vi.mock('../../functions/src/snapshot-retention',()=>({pruneOldSnapshots:vi.fn()}));
vi.mock('../../functions/src/admin',()=>{
  function doc(path:string):any{return {path,id:path.split('/').at(-1),get:async()=>snap(path),create:async(data:any)=>state.documents.set(path,data),collection:(name:string)=>collection(path+'/'+name)}}
  function snap(path:string){const data=state.documents.get(path);return {id:path.split('/').at(-1),exists:!!data,data:()=>data,ref:doc(path)}}
  function collection(path:string):any {const query:any={where:()=>query,orderBy:()=>query,limit:()=>query,doc:(id='new-message')=>doc(path+'/'+id),get:async()=>{const docs=[...state.documents.keys()].filter(k=>k.startsWith(path+'/')&&k.slice(path.length+1).indexOf('/')<0).map(snap);return {docs,size:docs.length}}};return query}
  return {auth:{},db:{doc,collection,runTransaction:async(fn:any)=>fn({get:async(r:any)=>r.get(),update:(r:any,data:any)=>state.documents.set(r.path,{...state.documents.get(r.path),...data}),create:(r:any,data:any)=>state.documents.set(r.path,data),delete:(r:any)=>state.documents.delete(r.path),set:(r:any,data:any)=>state.documents.set(r.path,data)})}};
});
import { createProject, getProject, listProjects, updateProject, softDeleteProject, appendProjectMessage, listProjectMessages, saveFile, listFiles, listSnapshots, restoreSnapshot, getSnapshotDiff } from '../../functions/src/index';
const invoke=(endpoint:any,data:unknown,uid:string|null='user')=>endpoint.run({data,auth:uid?{uid,token:{}}:undefined});
beforeEach(()=>{state.documents.clear();state.connected=true});
describe('project persistence',()=>{
  it('requires a connection before project creation',async()=>{
    state.connected=false;await expect(invoke(createProject,{name:'App'})).rejects.toMatchObject({code:'failed-precondition'});
  });
  it('creates, reads, lists and renames a project scoped to the user',async()=>{
    const created:any=await invoke(createProject,{name:' App ',description:' example '});const id=created.project.id;
    expect(created.project.name).toBe('App');expect(state.documents.has('users/user/projects/'+id)).toBe(true);
    expect((await invoke(listProjects,{})).projects).toHaveLength(1);
    expect((await invoke(getProject,{projectId:id})).project.id).toBe(id);
    expect((await invoke(updateProject,{projectId:id,name:'Renamed'})).project.name).toBe('Renamed');
    await expect(invoke(getProject,{projectId:id},'other')).rejects.toMatchObject({code:'not-found'});
  });
  it('stores and lists user messages',async()=>{
    const created:any=await invoke(createProject,{name:'App'});const id=created.project.id;
    await invoke(appendProjectMessage,{projectId:id,role:'user',content:' Hello '});
    expect((await invoke(listProjectMessages,{projectId:id})).messages).toMatchObject([{role:'user',content:'Hello'}]);
  });
  it('soft deletes a project',async()=>{
    const created:any=await invoke(createProject,{name:'App'});const id=created.project.id;
    expect(await invoke(softDeleteProject,{projectId:id})).toEqual({success:true});
    await expect(invoke(getProject,{projectId:id})).rejects.toMatchObject({code:'not-found'});
  });
  it('saves files and rejects unsafe paths and oversized contents',async()=>{
    const created:any=await invoke(createProject,{name:'App'});const id=created.project.id;
    expect(await invoke(saveFile,{projectId:id,path:'index.html',content:'hello'})).toEqual({success:true,path:'index.html'});
    expect((await invoke(listFiles,{projectId:id})).files).toMatchObject([{path:'index.html',content:'hello'}]);
    await expect(invoke(saveFile,{projectId:id,path:'../bad.js',content:'x'})).rejects.toMatchObject({code:'invalid-argument'});
    await expect(invoke(saveFile,{projectId:id,path:'big.js',content:'x'.repeat(220001)})).rejects.toMatchObject({code:'invalid-argument'});
  });
  it('lists and restores a complete snapshot',async()=>{
    const created:any=await invoke(createProject,{name:'App'});const id=created.project.id;
    const root='users/user/projects/'+id, snapshot='11111111-1111-4111-8111-111111111111';
    state.documents.set(root+'/snapshots/'+snapshot,{status:'complete',version:1,fileCount:1,prompt:'build'});
    state.documents.set(root+'/snapshots/'+snapshot+'/files/a',{path:'index.html',content:'restored'});
    await invoke(saveFile,{projectId:id,path:'old.js',content:'old'});
    expect((await invoke(listSnapshots,{projectId:id})).snapshots).toHaveLength(1);
    expect(await invoke(restoreSnapshot,{projectId:id,snapshotId:snapshot})).toMatchObject({success:true,fileCount:1});
    expect((await invoke(listFiles,{projectId:id})).files).toMatchObject([{path:'index.html',content:'restored'}]);
  });

  it('compares the exact generation input and enforces project ownership',async()=>{
    const created:any=await invoke(createProject,{name:'App'});const id=created.project.id;
    const root='users/user/projects/'+id, snapshot='11111111-1111-4111-8111-111111111111';
    state.documents.set(root+'/snapshots/'+snapshot,{status:'complete',version:1,fileCount:1,diffBase:'generation-input',diffBaseFileCount:1});
    state.documents.set(root+'/snapshots/'+snapshot+'/beforeFiles/a',{path:'index.html',content:'manually edited'});
    state.documents.set(root+'/snapshots/'+snapshot+'/files/a',{path:'index.html',content:'generated'});
    expect(await invoke(getSnapshotDiff,{projectId:id,snapshotId:snapshot})).toEqual({available:true,changes:[{path:'index.html',status:'modified',before:'manually edited',after:'generated'}]});
    await expect(invoke(getSnapshotDiff,{projectId:id,snapshotId:snapshot},'other')).rejects.toMatchObject({code:'not-found'});
  });
  it('marks legacy snapshots unavailable and rejects unknown snapshots',async()=>{
    const created:any=await invoke(createProject,{name:'App'});const id=created.project.id;
    const root='users/user/projects/'+id, snapshot='11111111-1111-4111-8111-111111111111';
    state.documents.set(root+'/snapshots/'+snapshot,{status:'complete',version:1});
    expect(await invoke(getSnapshotDiff,{projectId:id,snapshotId:snapshot})).toEqual({available:false,changes:[]});
    await expect(invoke(getSnapshotDiff,{projectId:id,snapshotId:'22222222-2222-4222-8222-222222222222'})).rejects.toMatchObject({code:'not-found'});
  });

  it('rejects incomplete snapshot baselines',async()=>{
    const created:any=await invoke(createProject,{name:'App'});const id=created.project.id;
    const root='users/user/projects/'+id, snapshot='11111111-1111-4111-8111-111111111111';
    state.documents.set(root+'/snapshots/'+snapshot,{status:'complete',version:1,fileCount:1,diffBase:'generation-input',diffBaseFileCount:1});
    await expect(invoke(getSnapshotDiff,{projectId:id,snapshotId:snapshot})).rejects.toThrow('incomplete');
  });

});
