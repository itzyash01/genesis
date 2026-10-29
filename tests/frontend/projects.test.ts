// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import ProjectList from '../../frontend/src/components/ProjectList.vue';
const projects=[{id:'a',name:'Contacts',description:'Customers',highLevelLocationId:'loc',version:1},{id:'b',name:'Calendar',description:'Appointments',highLevelLocationId:'loc',version:1}];
describe('project list',()=>{
  it('filters by name or description',async()=>{
    const wrapper=shallowMount(ProjectList,{props:{projects,connection:{connected:true,locationId:'loc',locationName:'Test'}}});const vm=wrapper.vm as any;
    vm.search='customer';await wrapper.vm.$nextTick();expect(vm.filteredProjects.map((p:any)=>p.id)).toEqual(['a']);
    vm.search='calendar';await wrapper.vm.$nextTick();expect(vm.filteredProjects.map((p:any)=>p.id)).toEqual(['b']);
  });
  it('trims project creation input and ignores empty names',async()=>{
    const wrapper=shallowMount(ProjectList,{props:{projects:[],connection:{connected:false}}});const vm=wrapper.vm as any;
    vm.name=' ';vm.submitProject();expect(wrapper.emitted('create')).toBeUndefined();
    vm.name=' App ';vm.description=' Description ';vm.submitProject();expect(wrapper.emitted('create')?.[0]).toEqual(['App','Description']);
  });
});
