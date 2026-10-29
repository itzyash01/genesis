// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatPanel from '../../frontend/src/components/ChatPanel.vue';

const props = {messages:[], generating:false, streamText:''};
const global = { stubs: { ArrowUp: true, History: true, LoaderCircle: true, Sparkles: true, Square: true } };
describe('build conversation', () => {
  it('submits a trimmed prompt and clears it', async () => {
    const wrapper = mount(ChatPanel,{props, global});
    await wrapper.find('textarea').setValue('  Build a dashboard  ');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('send')?.[0]).toEqual(['Build a dashboard']);
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });
  it('blocks generation for unsaved changes', async () => {
    const wrapper = mount(ChatPanel,{props:{...props,unsavedChanges:true}, global});
    await wrapper.find('textarea').setValue('Build');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('send')).toBeUndefined();
    expect(wrapper.text()).toContain('Save the current file');
  });
  it('shows streaming output and allows cancellation', async () => {
    const wrapper = mount(ChatPanel,{props:{...props,generating:true,streamText:'Generating code'}, global});
    expect(wrapper.text()).toContain('Generating code');
    await wrapper.findAll('button').find(button=>button.text().includes('Stop'))!.trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
