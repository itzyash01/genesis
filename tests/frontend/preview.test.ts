// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PreviewPanel from '../../frontend/src/components/PreviewPanel.vue';

describe('sandbox preview', () => {
  it('shows empty state without an entry file', () => {
    const wrapper=mount(PreviewPanel,{props:{files:[],projectName:'Test',refreshKey:0}});
    expect(wrapper.find('iframe').exists()).toBe(false);
  });
  it('isolates generated code and removes dangerous markup', () => {
    const wrapper=mount(PreviewPanel,{props:{projectName:'Test',refreshKey:0,files:[
      {path:'index.html',content:'<html><head><meta http-equiv="refresh" content="0;url=https://example.com"></head><body><button onclick="alert(1)">Go</button><iframe src="https://example.com"></iframe><script src="https://example.com/x.js"></script></body></html>'},
      {path:'app.js',content:'document.body.dataset.ready="yes";'},
      {path:'style.css',content:'body { color: red; }'},
    ]}});
    const iframe=wrapper.find('iframe'); const src=iframe.attributes('srcdoc');
    expect(iframe.attributes('sandbox')).toBe('allow-scripts allow-forms');
    expect(src).toContain("connect-src 'none'");
    expect(src).toContain('window.genesis');
    expect(src).toContain('body { color: red; }');
    expect(src).not.toContain('onclick=');
    expect(src).not.toContain('<iframe');
    expect(src).not.toContain('http-equiv="refresh"');
    expect(src).not.toContain('src="https://example.com/x.js"');
  });
  it('accepts data requests only from its own iframe with an allowed action', async () => {
    const wrapper=mount(PreviewPanel,{attachTo:document.body,props:{projectName:'Test',refreshKey:0,files:[{path:'index.html',content:'<html><body>hi</body></html>'}]}});
    const frame=wrapper.find('iframe').element as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{source:'genesis-preview',id:'1',action:'contacts',params:{query:'A'}}}));
    expect(wrapper.emitted('dataRequest')?.[0]).toEqual([{id:'1',action:'contacts',params:{query:'A'}}]);
    window.dispatchEvent(new MessageEvent('message',{source:window,data:{source:'genesis-preview',id:'2',action:'contacts',params:{}}}));
    window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{source:'genesis-preview',id:'3',action:'unknown',params:{}}}));
    expect(wrapper.emitted('dataRequest')).toHaveLength(1);
    wrapper.unmount();
  });
});
