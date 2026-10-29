import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../../functions/src/crypto';
const memory=vi.hoisted(()=>({docs:new Map<string,any>()}));
vi.mock('../../functions/src/admin',()=>{
  function doc(path:string):any{return {path,get:async()=>snapshot(path),create:async(data:any)=>memory.docs.set(path,data),set:async(data:any)=>memory.docs.set(path,data),delete:async()=>memory.docs.delete(path),update:async(data:any)=>memory.docs.set(path,{...memory.docs.get(path),...data})}}
  function snapshot(path:string){return {exists:memory.docs.has(path),data:()=>memory.docs.get(path)}}
  return {db:{doc,runTransaction:async(fn:any)=>fn({get:async(r:any)=>snapshot(r.path),delete:(r:any)=>memory.docs.delete(r.path),update:(r:any,data:any)=>memory.docs.set(r.path,{...memory.docs.get(r.path),...data})})}};
});
import { createHighLevelAuthorizationUrl, disconnectHighLevel, finishHighLevelOAuth, getHighLevelAccessToken, getHighLevelConnection } from '../../functions/src/highlevel';
const key=Buffer.alloc(32,3).toString('base64');const settings={clientId:'client',clientSecret:'secret',redirectUri:'https://app.example.invalid/callback',encryptionKey:key};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>memory.docs.clear());afterEach(()=>vi.unstubAllGlobals());
describe('OAuth account connection',()=>{
  it('creates a one-time state, exchanges a code and stores encrypted tokens',async()=>{
    const url=await createHighLevelAuthorizationUrl({...settings,uid:'user',scopes:'contacts.readonly'});const state=new URL(url).searchParams.get('state')!;
    const fetchMock=vi.fn().mockResolvedValueOnce(json({access_token:'access',refresh_token:'refresh',expires_in:3600,locationId:'loc'})).mockResolvedValueOnce(json({location:{name:'Sandbox'}}));vi.stubGlobal('fetch',fetchMock);
    expect(await finishHighLevelOAuth({...settings,code:'code',state})).toBe('user');
    const stored=memory.docs.get('users/user/integrations/highlevel');expect(stored.locationName).toBe('Sandbox');expect(decryptSecret(stored.accessToken,key)).toBe('access');
    expect(stored.accessToken).not.toBe('access');
    expect(await getHighLevelConnection('user')).toEqual({connected:true,locationId:'loc',locationName:'Sandbox'});
    await expect(finishHighLevelOAuth({...settings,code:'code',state})).rejects.toMatchObject({code:'invalid-argument'});
    await disconnectHighLevel('user');expect(await getHighLevelConnection('user')).toEqual({connected:false});
  });
  it('rejects missing settings, expired state and failed token exchanges',async()=>{
    await expect(createHighLevelAuthorizationUrl({...settings,clientId:'',uid:'user',scopes:''})).rejects.toMatchObject({code:'failed-precondition'});
    const url=await createHighLevelAuthorizationUrl({...settings,uid:'user',scopes:''});const state=new URL(url).searchParams.get('state')!;
    const entry=[...memory.docs.values()][0];entry.expiresAtMs=Date.now()-1;
    await expect(finishHighLevelOAuth({...settings,code:'x',state})).rejects.toMatchObject({code:'deadline-exceeded'});
    const second=await createHighLevelAuthorizationUrl({...settings,uid:'user',scopes:''});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({},400)));
    await expect(finishHighLevelOAuth({...settings,code:'x',state:new URL(second).searchParams.get('state')!})).rejects.toMatchObject({code:'failed-precondition'});
  });
  it('refreshes an expired token and stores the replacement encrypted',async()=>{
    memory.docs.set('users/user/integrations/highlevel',{locationId:'loc',accessToken:encryptSecret('old',key),refreshToken:encryptSecret('refresh',key),expiresAtMs:0});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({access_token:'new',refresh_token:'new-refresh',expires_in:3600})));
    expect(await getHighLevelAccessToken({...settings,uid:'user'})).toMatchObject({accessToken:'new',locationId:'loc'});
    expect(decryptSecret(memory.docs.get('users/user/integrations/highlevel').refreshToken,key)).toBe('new-refresh');
  });
  it('requires a location and a complete token response',async()=>{
    let url=await createHighLevelAuthorizationUrl({...settings,uid:'user',scopes:''});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json({access_token:'a',refresh_token:'b',expires_in:3600})));
    await expect(finishHighLevelOAuth({...settings,code:'x',state:new URL(url).searchParams.get('state')!})).rejects.toThrow('Choose one business account');
    url=await createHighLevelAuthorizationUrl({...settings,uid:'user',scopes:''});vi.mocked(fetch).mockResolvedValueOnce(json({access_token:'a'}));
    await expect(finishHighLevelOAuth({...settings,code:'x',state:new URL(url).searchParams.get('state')!})).rejects.toThrow('response was incomplete');
  });
  it('reports a failed refresh without revealing credentials',async()=>{
    memory.docs.set('users/user/integrations/highlevel',{locationId:'loc',accessToken:encryptSecret('old',key),refreshToken:encryptSecret('refresh',key),expiresAtMs:0});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({},401)));
    await expect(getHighLevelAccessToken({...settings,uid:'user'})).rejects.toThrow('Reconnect your account');
  });

});
