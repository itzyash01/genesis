// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
const mock=vi.hoisted(()=>({api:{listMessages:vi.fn(),appendMessage:vi.fn(),getProject:vi.fn(),saveFile:vi.fn(),listSnapshots:vi.fn(),getSnapshotDiff:vi.fn(),restoreSnapshot:vi.fn(),getHighLevelData:vi.fn(),highLevelWrite:vi.fn()},stream:vi.fn()}));
vi.mock('../../frontend/src/lib/api',()=>({api:mock.api,streamGeneration:mock.stream}));
vi.mock('../../frontend/src/components/CodePanel.vue',()=>({default:{name:'CodePanel',template:'<div />'}}));
vi.mock('../../frontend/src/components/PreviewPanel.vue',()=>({default:{name:'PreviewPanel',template:'<div />',methods:{respond:vi.fn()}}}));
vi.mock('../../frontend/src/components/SnapshotDiff.vue',()=>({default:{name:'SnapshotDiff',template:'<div />'}}));
import Workspace from '../../frontend/src/components/Workspace.vue';
const project={id:'p1',name:'Test',description:'',highLevelLocationId:'loc',version:1};
const files=[{path:'index.html',content:'old'}];
beforeEach(()=>{vi.clearAllMocks();mock.api.listMessages.mockResolvedValue({messages:[]});mock.api.appendMessage.mockResolvedValue({id:'m1'});mock.api.getProject.mockResolvedValue({project,files:[{path:'index.html',content:'new'}]});mock.api.saveFile.mockResolvedValue({});mock.api.listSnapshots.mockResolvedValue({snapshots:[]});});
const mountWorkspace=()=>shallowMount(Workspace,{props:{project,initialFiles:files}});
describe('workspace workflow',()=>{
  it('saves edits before allowing generation',async()=>{
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;
    vm.editContent('changed');await flushPromises();expect(vm.dirty).toBe(true);
    await vm.sendPrompt('Build');expect(mock.stream).not.toHaveBeenCalled();
    await vm.saveCurrentFile();expect(mock.api.saveFile).toHaveBeenCalledWith('p1','index.html','changed');expect(vm.dirty).toBe(false);
    wrapper.unmount();
  });
  it('streams content, updates files, and reloads the saved project',async()=>{
    mock.stream.mockImplementation(async (_id:any,_prompt:any,_signal:any,send:any)=>{send({event:'token',data:{text:'hello'}});send({event:'file_content',data:{path:'index.html',content:'streamed'}});send({event:'complete',data:{files:['index.html'],partial:false}})});
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;
    await vm.sendPrompt('Build');await flushPromises();
    expect(mock.api.appendMessage).toHaveBeenCalledWith('p1','user','Build');
    expect(mock.api.getProject).toHaveBeenCalledWith('p1');
    expect(mock.api.appendMessage).toHaveBeenCalledWith('p1','assistant',expect.stringContaining('Generation complete'));
    expect(vm.files[0].content).toBe('new');expect(wrapper.emitted('updated')).toBeTruthy();wrapper.unmount();
  });
  it('surfaces generation errors rather than claiming success',async()=>{
    mock.stream.mockImplementation(async (_id:any,_prompt:any,_signal:any,send:any)=>{send({event:'error',data:{code:'MALFORMED_OUTPUT',message:'Bad output'}});send({event:'complete',data:{files:[],partial:true}})});
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;await vm.sendPrompt('Build');await flushPromises();
    expect(mock.api.appendMessage).toHaveBeenCalledWith('p1','assistant','Bad output');expect(vm.streamError).toBe('Bad output');wrapper.unmount();
  });
  it('requires confirmation before a contact update reaches the API',async()=>{
    mock.api.getHighLevelData.mockResolvedValue({contact:{id:'c1',firstName:'A',email:'old@example.invalid'}});
    mock.api.highLevelWrite.mockResolvedValue({contact:{id:'c1'}});
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;
    vm.preview={respond:vi.fn()};await vm.previewDataRequest({id:'r1',action:'updateContact',params:{contactId:'c1',changes:{email:'new@example.invalid'}}});
    expect(mock.api.highLevelWrite).not.toHaveBeenCalled();expect(vm.confirmationOpen).toBe(true);
    vm.preview={respond:vi.fn()};await vm.confirmCrmWrite();expect(mock.api.highLevelWrite).toHaveBeenCalledWith('p1',expect.objectContaining({action:'updateContact',contactId:'c1'}));
    wrapper.unmount();
  });
  it('rejects malformed writes without calling the API',async()=>{
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;
    vm.preview={respond:vi.fn()};await vm.previewDataRequest({id:'r2',action:'createContact',params:{contact:{firstName:'A'}}});
    expect(mock.api.highLevelWrite).not.toHaveBeenCalled();expect(vm.pendingCrmWrite).toBe(null);wrapper.unmount();
  });
  it('loads and restores a snapshot when confirmed',async()=>{
    const confirmed=vi.spyOn(window,'confirm').mockReturnValue(true);
    mock.api.listSnapshots.mockResolvedValue({snapshots:[{id:'s1',version:1,fileCount:1,prompt:'build',createdAt:null}]});
    mock.api.restoreSnapshot.mockResolvedValue({success:true});
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;
    await vm.openHistory();expect(vm.snapshots).toHaveLength(1);await vm.restore(vm.snapshots[0]);
    expect(mock.api.restoreSnapshot).toHaveBeenCalledWith('p1','s1');confirmed.mockRestore();wrapper.unmount();
  });

  it('creates files, rejects duplicates and reports save failures',async()=>{
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;
    await vm.createFile('index.html');expect(vm.streamError).toContain('new file path');
    await vm.createFile('app.js');expect(mock.api.saveFile).toHaveBeenCalledWith('p1','app.js','');expect(vm.files.map((f:any)=>f.path)).toContain('app.js');
    vm.editContent('changed');mock.api.saveFile.mockRejectedValueOnce(new Error('Save failed'));await vm.saveCurrentFile();expect(vm.streamError).toBe('Save failed');wrapper.unmount();
  });
  it('returns read results and errors to the preview',async()=>{
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;const respond=vi.fn();vm.preview={respond};
    mock.api.getHighLevelData.mockResolvedValueOnce({contacts:[]}).mockRejectedValueOnce(new Error('Read failed'));
    await vm.previewDataRequest({id:'r1',action:'contacts',params:{query:'A'}});
    expect(mock.api.getHighLevelData).toHaveBeenCalledWith('p1','contacts',expect.objectContaining({query:'A'}));expect(respond).toHaveBeenCalledWith('r1',{contacts:[]});
    vm.preview={respond};await vm.previewDataRequest({id:'r2',action:'contacts',params:{}});expect(respond).toHaveBeenCalledWith('r2',undefined,'Read failed');wrapper.unmount();
  });
  it('does not restore a snapshot without confirmation',async()=>{
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;
    await vm.restore({id:'s1',version:1});expect(mock.api.restoreSnapshot).not.toHaveBeenCalled();confirm.mockRestore();wrapper.unmount();
  });

  it('opens snapshot changes and shows loading errors',async()=>{
    mock.api.getSnapshotDiff.mockResolvedValueOnce({available:true,changes:[{path:'index.html',status:'modified',before:'old',after:'new'}]}).mockRejectedValueOnce(new Error('Comparison failed'));
    const wrapper=mountWorkspace();await flushPromises();const vm=wrapper.vm as any;const snapshot={id:'s1',version:2};
    await vm.openDiff(snapshot);expect(mock.api.getSnapshotDiff).toHaveBeenCalledWith('p1','s1');expect(vm.diffOpen).toBe(true);expect(vm.diffResult.changes[0].after).toBe('new');
    await vm.openDiff(snapshot);expect(vm.diffError).toBe('Comparison failed');wrapper.unmount();
  });

});
