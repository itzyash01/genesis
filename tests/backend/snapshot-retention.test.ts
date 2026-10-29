import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({docs:[] as any[], files:[] as any[], deleted:[] as any[], warnings:[] as any[]}));
vi.mock('../../functions/src/admin',()=>({db:{batch:()=>({delete:(ref:any)=>fake.deleted.push(ref),commit:async()=>{}})}}));
vi.mock('firebase-functions',()=>({logger:{warn:(...args:any[])=>fake.warnings.push(args)}}));
import { pruneOldSnapshots } from '../../functions/src/snapshot-retention';
function project(){return {collection:()=>({where:()=>({orderBy:()=>({limit:()=>({get:async()=>({size:fake.docs.length,docs:fake.docs})})})})})} as any}
beforeEach(()=>{fake.docs=[];fake.files=[];fake.deleted=[];fake.warnings=[]});
describe('snapshot retention',()=>{
  it('does nothing within the retention limit',async()=>{await pruneOldSnapshots(project());expect(fake.deleted).toEqual([])});
  it('deletes the oldest snapshot and its files',async()=>{
    fake.files=[{ref:'file1'},{ref:'file2'}];
    fake.docs=Array.from({length:21},(_,i)=>({ref:{id:i,collection:(name:string)=>({limit:()=>({get:async()=>name==='beforeFiles'?{size:1,docs:[{ref:'before1'}]}:{size:fake.files.length,docs:fake.files}})})}}));
    await pruneOldSnapshots(project());expect(fake.deleted).toEqual(['file1','file2','before1',fake.docs[20].ref]);
  });
  it('leaves oversized snapshots untouched',async()=>{
    fake.files=Array.from({length:151},(_,i)=>({ref:i}));
    fake.docs=Array.from({length:21},()=>({ref:{collection:()=>({limit:()=>({get:async()=>({size:151,docs:fake.files})})})}}));
    await pruneOldSnapshots(project());expect(fake.deleted).toEqual([]);
  });
});
