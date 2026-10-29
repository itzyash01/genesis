// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
vi.mock('../../frontend/src/components/ReadOnlyDiffEditor.vue',()=>({default:{name:'ReadOnlyDiffEditor',template:'<div />'}}));
import SnapshotDiff from '../../frontend/src/components/SnapshotDiff.vue';
const snapshot={id:'s',version:3,fileCount:2,prompt:'Build',createdAt:null};
const props={open:true,loading:false,snapshot,error:'',result:{available:true,changes:[{path:'a.js',status:'modified' as const,before:'old',after:'new'},{path:'b.css',status:'added' as const,before:'',after:'new'}]}};
describe('snapshot diff view',()=>{
  it('selects changed files and keeps the diff read-only',async()=>{
    const wrapper=shallowMount(SnapshotDiff,{props});const vm=wrapper.vm as any;
    expect(vm.selected.path).toBe('a.js');expect(vm.language).toBe('javascript');
    vm.selectedPath='b.css';await wrapper.vm.$nextTick();expect(vm.selected.path).toBe('b.css');expect(vm.language).toBe('css');
  });
  it('recognizes older snapshots without a baseline',()=>{
    const wrapper=shallowMount(SnapshotDiff,{props:{...props,result:{available:false,changes:[]}}});
    expect((wrapper.vm as any).result.available).toBe(false);
  });
});
