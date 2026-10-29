// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
const mock=vi.hoisted(()=>({listener:null as any,signOut:vi.fn(),api:{listProjects:vi.fn(),createProject:vi.fn(),getProject:vi.fn(),startHighLevelOAuth:vi.fn(),disconnectHighLevel:vi.fn(),softDeleteProject:vi.fn()}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:any,fn:any)=>{mock.listener=fn;return ()=>{}},signOut:mock.signOut}));
vi.mock('../../frontend/src/lib/firebase',()=>({auth:{}}));
vi.mock('../../frontend/src/lib/api',()=>({api:mock.api}));
import App from '../../frontend/src/App.vue';
const project={id:'p1',name:'App',description:'',highLevelLocationId:'loc',version:0};
beforeEach(()=>{vi.clearAllMocks();mock.api.listProjects.mockResolvedValue({projects:[project],connection:{connected:true,locationId:'loc',locationName:'Sandbox'}});mock.api.getProject.mockResolvedValue({project,files:[]});});
describe('application navigation',()=>{
  it('loads projects after sign in and opens the selected project',async()=>{
    const wrapper=shallowMount(App);await mock.listener({uid:'user'});await flushPromises();const vm=wrapper.vm as any;
    expect(mock.api.listProjects).toHaveBeenCalled();expect(vm.projects).toEqual([project]);
    await vm.openProject(project);expect(mock.api.getProject).toHaveBeenCalledWith('p1');expect(vm.workspaceProject).toEqual(project);wrapper.unmount();
  });
  it('creates projects and surfaces failures',async()=>{
    const wrapper=shallowMount(App);await mock.listener({uid:'user'});await flushPromises();const vm=wrapper.vm as any;
    mock.api.createProject.mockResolvedValue({project});await vm.createProject('App','');expect(vm.workspaceProject.id).toBe('p1');
    mock.api.createProject.mockRejectedValue(new Error('Creation failed'));await vm.createProject('App','');expect(vm.globalError).toBe('Creation failed');wrapper.unmount();
  });
  it('confirms before deleting or disconnecting',async()=>{
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);const wrapper=shallowMount(App);await mock.listener({uid:'user'});await flushPromises();const vm=wrapper.vm as any;
    await vm.deleteProject(project);await vm.disconnectHighLevel();expect(mock.api.softDeleteProject).not.toHaveBeenCalled();expect(mock.api.disconnectHighLevel).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);await vm.deleteProject(project);expect(vm.projects).toEqual([]);await vm.disconnectHighLevel();expect(vm.connection).toEqual({connected:false});
    confirm.mockRestore();wrapper.unmount();
  });
});
