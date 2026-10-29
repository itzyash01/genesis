import { beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({count:0,read:vi.fn(),write:vi.fn(), verify:vi.fn(), generate:vi.fn(), finish:vi.fn()}));
vi.mock('../../functions/src/admin',()=>({auth:{verifyIdToken:state.verify},db:{doc:(path:string)=>({path}),runTransaction:async (fn:any)=>fn({get:async()=>({data:()=>({windowStartMs:Date.now(),count:state.count})}),set:()=>{state.count++}})}}));
vi.mock('../../functions/src/config',()=>{const p={value:()=> 'value'};return {allowedOrigins:p,appOrigin:p,hlClientId:p,hlClientSecret:p,hlRedirectUri:p,hlScopes:p,llmApiKey:p,tokenEncryptionKey:p};});
vi.mock('../../functions/src/highlevel',()=>({
  HighLevelApiError:class extends Error {constructor(message:string,public status:number){super(message)}},
  getHighLevelData:state.read,executeHighLevelWrite:state.write,getHighLevelConnection:vi.fn(),createHighLevelAuthorizationUrl:vi.fn(),disconnectHighLevel:vi.fn(),finishHighLevelOAuth:state.finish,
}));
vi.mock('../../functions/src/generation',()=>({generateProjectFiles:state.generate}));
vi.mock('../../functions/src/snapshot-retention',()=>({pruneOldSnapshots:vi.fn()}));
import { api, oauthCallback, highLevelData, highLevelWrite } from '../../functions/src/index';
const invoke=(endpoint:any,data:unknown,uid:string|null='user')=>endpoint.run({data,auth:uid?{uid,token:{}}:undefined});
beforeEach(()=>{state.count=0;state.read.mockReset().mockResolvedValue({contacts:[]});state.write.mockReset().mockResolvedValue({contact:{id:'c'}})});
describe('CRM callable endpoint security',()=>{
  it('requires authentication',async()=>{
    await expect(invoke(highLevelData,{projectId:'p',kind:'contacts'},null)).rejects.toMatchObject({code:'unauthenticated'});
    await expect(invoke(highLevelWrite,{projectId:'p',action:'createContact',contact:{email:'a@example.invalid'}},null)).rejects.toMatchObject({code:'unauthenticated'});
  });
  it('validates contact writes before executing',async()=>{
    await expect(invoke(highLevelWrite,{projectId:'p',action:'createContact',contact:{firstName:'A'}})).rejects.toMatchObject({code:'invalid-argument'});
    await expect(invoke(highLevelWrite,{projectId:'p',action:'updateContact',contactId:'c',changes:{email:'bad'}})).rejects.toMatchObject({code:'invalid-argument'});
    expect(state.write).not.toHaveBeenCalled();
  });
  it('validates email subject and date ordering',async()=>{
    await expect(invoke(highLevelWrite,{projectId:'p',action:'sendMessage',contactId:'c',type:'Email',message:'Hello'})).rejects.toMatchObject({code:'invalid-argument'});
    await expect(invoke(highLevelWrite,{projectId:'p',action:'createAppointment',contactId:'c',calendarId:'cal',title:'Meeting',startTime:'2026-10-29T10:00:00Z',endTime:'2026-10-29T09:00:00Z'})).rejects.toMatchObject({code:'invalid-argument'});
  });
  it('passes validated writes with identity and enforces rate limits',async()=>{
    await invoke(highLevelWrite,{projectId:'p',action:'updateContact',contactId:'c',changes:{email:'a@example.invalid'}});
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({uid:'user',projectId:'p',input:expect.objectContaining({action:'updateContact'})}));
    state.count=10;
    await expect(invoke(highLevelWrite,{projectId:'p',action:'updateContact',contactId:'c',changes:{email:'a@example.invalid'}})).rejects.toMatchObject({code:'resource-exhausted'});
  });
  it('validates reads and enforces rate limits',async()=>{
    await expect(invoke(highLevelData,{projectId:'p',kind:'unknown'})).rejects.toMatchObject({code:'invalid-argument'});
    await invoke(highLevelData,{projectId:'p',kind:'contacts',query:'sam'});
    expect(state.read).toHaveBeenCalledWith(expect.objectContaining({uid:'user',projectId:'p',query:'sam'}));
    state.count=60;
    await expect(invoke(highLevelData,{projectId:'p',kind:'contacts'})).rejects.toMatchObject({code:'resource-exhausted'});
  });
});

function response() {
  const res:any={statusCode:200, headers:{} as Record<string,string>, chunks:[] as string[], writableEnded:false,destroyed:false,headersSent:false};
  res.status=(code:number)=>{res.statusCode=code;return res};res.setHeader=(k:string,v:string)=>{res.headers[k]=v};
  res.json=(body:any)=>{res.body=body;res.writableEnded=true;return res};res.send=res.json;
  res.redirect=(code:number,url:string)=>{res.statusCode=code;res.redirectUrl=url;res.writableEnded=true};res.end=()=>{res.writableEnded=true};res.flushHeaders=()=>{res.headersSent=true};res.on=()=>res;res.write=(chunk:string)=>{res.chunks.push(chunk);return true};
  return res;
}
describe('streaming HTTP endpoint',()=>{
  it('handles preflight and rejects unauthenticated requests',async()=>{
    let res=response();await api({method:'OPTIONS',path:'/',headers:{}} as any,res);expect(res.statusCode).toBe(204);
    res=response();await api({method:'POST',path:'/generate',headers:{},body:{}} as any,res);expect(res.statusCode).toBe(401);
  });
  it('checks the request origin and payload',async()=>{
    let res=response();await api({method:'POST',path:'/generate',headers:{origin:'https://untrusted.invalid'}} as any,res);expect(res.statusCode).toBe(403);
    state.verify.mockResolvedValue({uid:'user'});res=response();
    await api({method:'POST',path:'/generate',headers:{authorization:'Bearer token'},body:{projectId:'p',prompt:''}} as any,res);
    expect(res.statusCode).toBe(400);
  });
  it('streams events and disables buffering',async()=>{
    state.verify.mockResolvedValue({uid:'user'});state.generate.mockImplementation(async (options:any)=>{await options.send('token',{text:'hello'});await options.send('complete',{files:[],partial:false})});
    const res=response();await api({method:'POST',path:'/generate',headers:{authorization:'Bearer token'},body:{projectId:'p',prompt:'Build'}} as any,res);
    expect(res.headers['Content-Type']).toContain('text/event-stream');expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.chunks.join('')).toContain('event: token');expect(res.chunks.join('')).toContain('event: complete');expect(res.writableEnded).toBe(true);
  });
});

describe('OAuth callback',()=>{
  it('rejects bad requests and redirects unsuccessful authorization',async()=>{
    let res=response();await oauthCallback({method:'POST',query:{}} as any,res);expect(res.statusCode).toBe(405);
    res=response();await oauthCallback({method:'GET',query:{}} as any,res);expect(res.statusCode).toBe(400);
    res=response();await oauthCallback({method:'GET',query:{error:'access_denied'}} as any,res);expect(res.redirectUrl).toContain('highlevel=error');
  });
  it('exchanges valid callbacks and handles failed exchange',async()=>{
    state.finish.mockResolvedValue('user');let res=response();
    await oauthCallback({method:'GET',query:{code:'code',state:'state'}} as any,res);expect(res.redirectUrl).toContain('highlevel=connected');
    state.finish.mockRejectedValue(new Error('denied'));res=response();await oauthCallback({method:'GET',query:{code:'code',state:'state'}} as any,res);expect(res.redirectUrl).toContain('highlevel=error');
  });
});
