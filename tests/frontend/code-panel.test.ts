// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
vi.mock('../../frontend/src/lib/monaco',()=>({}));
import CodePanel from '../../frontend/src/components/CodePanel.vue';
const props={files:[{path:'z.js',content:'x'},{path:'index.html',content:'y'}],selectedPath:'index.html',content:'y',streaming:false,dirty:false,version:1};
describe('code editor',()=>{
  it('orders files and determines the editor language',()=>{
    const wrapper=shallowMount(CodePanel,{props});const vm=wrapper.vm as any;
    expect(vm.orderedFiles.map((file:any)=>file.path)).toEqual(['index.html','z.js']);expect(vm.language).toBe('html');expect(vm.editorOptions.readOnly).toBe(false);
  });
  it('locks the editor while streaming',()=>{
    const wrapper=shallowMount(CodePanel,{props:{...props,streaming:true}});expect((wrapper.vm as any).editorOptions.readOnly).toBe(true);
  });
  it('emits a normalized filename for creation',()=>{
    const wrapper=shallowMount(CodePanel,{props});const vm=wrapper.vm as any;
    vm.newPath=' /src/app.js ';vm.addFile();expect(wrapper.emitted('create')?.[0]).toEqual(['src/app.js']);
    vm.newPath=' ';vm.addFile();expect(wrapper.emitted('create')).toHaveLength(1);
  });
});
