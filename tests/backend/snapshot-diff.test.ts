import { describe, expect, it } from 'vitest';
import { compareSnapshotFiles } from '../../functions/src/snapshot-diff';

describe('snapshot comparison',()=>{
  it('identifies added, changed and removed files, including empty files',()=>{
    const changes=compareSnapshotFiles([{path:'same.js',content:'x'},{path:'change.js',content:'old'},{path:'removed.css',content:''}],[{path:'same.js',content:'x'},{path:'change.js',content:'new'},{path:'added.html',content:''}]);
    expect(changes).toEqual([
      {path:'added.html',status:'added',before:'',after:''},
      {path:'change.js',status:'modified',before:'old',after:'new'},
      {path:'removed.css',status:'removed',before:'',after:''},
    ]);
  });
  it('returns no changes for identical files',()=>expect(compareSnapshotFiles([{path:'a',content:'x'}],[{path:'a',content:'x'}])).toEqual([]));
});
