import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  auth: { currentUser: null as null | {getIdToken: () => Promise<string>} },
  callable: vi.fn(), appCheck: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions: unknown, name: string) => (data: unknown) => mocked.callable(name, data) }));
vi.mock('../../frontend/src/lib/firebase', () => ({ auth: mocked.auth, functions: {}, getAppCheckRequestToken: mocked.appCheck }));
import { api, streamGeneration } from '../../frontend/src/lib/api';

beforeEach(() => { vi.clearAllMocks(); mocked.auth.currentUser = {getIdToken: async () => 'test-token'}; mocked.appCheck.mockResolvedValue(null); });
afterEach(() => vi.unstubAllGlobals());

describe('callable requests', () => {
  it('forwards contact writes and filters undefined read parameters', async () => {
    mocked.callable.mockResolvedValue({data: {ok: true}});
    await api.highLevelWrite('p1', {action:'updateContact', contactId:'c1', changes:{email:'a@example.invalid'}});
    expect(mocked.callable).toHaveBeenCalledWith('highLevelWrite', {projectId:'p1', action:'updateContact', contactId:'c1', changes:{email:'a@example.invalid'}});
    await api.getHighLevelData('p1', 'contacts', {query:'Jane', calendarId:undefined});
    expect(mocked.callable).toHaveBeenLastCalledWith('highLevelData', {projectId:'p1',kind:'contacts',query:'Jane'});
  });
});

describe('generation event stream', () => {
  it('parses events split across network chunks', async () => {
    const enc = new TextEncoder();
    const chunks = ['event: token\ndata: {"text":"He', 'llo"}\n\nevent: complete\r\ndata: {"files":[],"partial":false}\r\n\r\n'];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { for (const c of chunks) controller.enqueue(enc.encode(c)); controller.close(); } }), {status:200})));
    const events: unknown[] = [];
    await streamGeneration('project', 'build', new AbortController().signal, e => events.push(e));
    expect(events).toEqual([{event:'token',data:{text:'Hello'}},{event:'complete',data:{files:[],partial:false}}]);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({Authorization:'Bearer test-token'});
  });
  it('rejects unauthenticated requests', async () => {
    mocked.auth.currentUser = null;
    await expect(streamGeneration('p','x',new AbortController().signal, vi.fn())).rejects.toThrow('Sign in');
  });
  it('surfaces API errors and disconnected streams', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'Denied'}), {status:403})).mockResolvedValueOnce(new Response('event: token\ndata: {"text":"part"}\n\n')));
    await expect(streamGeneration('p','x',new AbortController().signal,vi.fn())).rejects.toThrow('Denied');
    await expect(streamGeneration('p','x',new AbortController().signal,vi.fn())).rejects.toThrow('disconnected');
  });
  it('reports invalid event payload and still handles final event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('event: token\ndata: bad\n\nevent: complete\ndata: {"files":[],"partial":false}')));
    const events: any[] = [];
    await streamGeneration('p','x',new AbortController().signal,e=>events.push(e));
    expect(events[0].data.code).toBe('INVALID_STREAM');
    expect(events[1].event).toBe('complete');
  });
});
