import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../../functions/src/crypto';
const store = vi.hoisted(() => ({project: {exists:true, data:()=>({highLevelLocationId:'loc1'})}, integration: {exists:true, data:()=>({})}, audit:vi.fn()}));
vi.mock('../../functions/src/admin', () => ({db:{
  doc:(path:string)=>({get:async()=>path.includes('/integrations/')?store.integration:store.project}),
  collection:()=>({add:store.audit}),
}}));
import { executeHighLevelWrite, getHighLevelData, getHighLevelAccessToken } from '../../functions/src/highlevel';
const key=Buffer.alloc(32,1).toString('base64');
const base={uid:'u1', projectId:'p1', clientId:'client', clientSecret:'secret', encryptionKey:key};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{
  store.project={exists:true,data:()=>({highLevelLocationId:'loc1'})};
  store.integration={exists:true,data:()=>({locationId:'loc1',accessToken:encryptSecret('access',key),expiresAtMs:Date.now()+600000})};
  store.audit.mockReset().mockResolvedValue({});
});
afterEach(()=>vi.unstubAllGlobals());
describe('CRM reads and account isolation',()=>{
  it('searches contacts with the linked location and passes through the response',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(json({contacts:[{id:'c1'}]}));vi.stubGlobal('fetch',fetchMock);
    expect(await getHighLevelData({...base,kind:'contacts',query:' Jane '})).toEqual({contacts:[{id:'c1'}]});
    const [url,init]=fetchMock.mock.calls[0];expect(url.toString()).toContain('/contacts/search');
    expect(JSON.parse(init.body)).toMatchObject({locationId:'loc1',query:'Jane'});
    expect(init.headers.Authorization).toBe('Bearer access');
  });
  it('rejects cross-account contact records',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({contact:{locationId:'other'}})));
    await expect(getHighLevelData({...base,kind:'contact',contactId:'c1'})).rejects.toThrow('not in this connected account');
  });
  it('rejects missing projects, connections and mismatched project location',async()=>{
    store.project={exists:false,data:()=>({highLevelLocationId:'loc1'})};
    await expect(getHighLevelData({...base,kind:'contacts'})).rejects.toThrow('Project not found');
    store.project={exists:true,data:()=>({highLevelLocationId:'other'})};
    await expect(getHighLevelData({...base,kind:'contacts'})).rejects.toThrow('another business account');
    store.integration={exists:false,data:()=>({})};
    await expect(getHighLevelAccessToken(base)).rejects.toThrow('Connect a CRM account');
  });
  it('validates availability ranges and returns appointments',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(json({calendars:[{id:'cal1'}]})).mockResolvedValueOnce(json({events:[{id:'event1'}]}));vi.stubGlobal('fetch',fetchMock);
    await expect(getHighLevelData({...base,kind:'availability',calendarId:'cal1',startDate:100,endDate:99})).rejects.toThrow('valid date range');
    expect(await getHighLevelData({...base,kind:'appointments',startDate:100,endDate:200})).toEqual({events:[{id:'event1'}],truncated:false});
  });

  it('loads calendars, conversations and a verified availability response',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(json({calendars:[{id:'cal1'}]})).mockResolvedValueOnce(json({conversations:[]})).mockResolvedValueOnce(json({calendars:[{id:'cal1'}]})).mockResolvedValueOnce(json({'2026-10-29':{slots:['10:00']}}));vi.stubGlobal('fetch',fetchMock);
    expect(await getHighLevelData({...base,kind:'calendars'})).toEqual({calendars:[{id:'cal1'}]});
    expect(await getHighLevelData({...base,kind:'conversations'})).toEqual({conversations:[]});
    expect(await getHighLevelData({...base,kind:'availability',calendarId:'cal1',startDate:100,endDate:200,timezone:'UTC'})).toEqual({'2026-10-29':{slots:['10:00']}});
    expect(fetchMock.mock.calls[3][0].toString()).toContain('timezone=UTC');
  });
  it('rejects invalid and unauthorized calendar results',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(json({calendars:[]})).mockResolvedValueOnce(json({calendars:[]}));vi.stubGlobal('fetch',fetchMock);
    await expect(getHighLevelData({...base,kind:'availability',calendarId:'cal1',startDate:100,endDate:200})).rejects.toThrow('not in this connected account');
    await expect(getHighLevelData({...base,kind:'appointments',calendarId:'cal1',startDate:100,endDate:200})).rejects.toThrow('not in this connected account');
  });
  it('rejects cross-account conversations and invalid identifiers',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({conversation:{locationId:'other'}})));
    await expect(getHighLevelData({...base,kind:'messages',conversationId:'bad/id'})).rejects.toThrow('valid conversation ID');
    await expect(getHighLevelData({...base,kind:'messages',conversationId:'conv1'})).rejects.toThrow('not in this connected account');
  });
  it('reports sanitized CRM validation failures',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({message:'Bad email a@example.invalid'},400)));
    await expect(getHighLevelData({...base,kind:'contacts'})).rejects.toThrow('Bad email [email]');
  });
  it('verifies conversation ownership before reading messages',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(json({conversation:{locationId:'loc1'}})).mockResolvedValueOnce(json({messages:{messages:[{body:'hi'}]}}));vi.stubGlobal('fetch',fetchMock);
    expect(await getHighLevelData({...base,kind:'messages',conversationId:'conv1'})).toEqual({messages:{messages:[{body:'hi'}]}});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
describe('CRM writes',()=>{
  it('updates only after verifying contact ownership and records the action',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(json({contact:{locationId:'loc1'}})).mockResolvedValueOnce(json({contact:{id:'c1',email:'new@example.invalid'}}));vi.stubGlobal('fetch',fetchMock);
    const input={action:'updateContact' as const,contactId:'c1',changes:{email:'new@example.invalid'}};
    expect(await executeHighLevelWrite({...base,input})).toMatchObject({contact:{id:'c1'}});
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(input.changes);
    expect(store.audit).toHaveBeenCalledWith(expect.objectContaining({action:'updateContact',outcome:'succeeded'}));
  });
  it('prevents a write for a contact from another location',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(json({contact:{locationId:'other'}}));vi.stubGlobal('fetch',fetchMock);
    await expect(executeHighLevelWrite({...base,input:{action:'updateContact',contactId:'c1',changes:{firstName:'A'}}})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.audit).toHaveBeenCalledWith(expect.objectContaining({outcome:'failed'}));
  });

  it('creates appointments only after contact and calendar ownership checks',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(json({contact:{locationId:'loc1'}})).mockResolvedValueOnce(json({calendars:[{id:'cal1'}]})).mockResolvedValueOnce(json({id:'appointment1'}));vi.stubGlobal('fetch',fetchMock);
    await executeHighLevelWrite({...base,input:{action:'createAppointment',contactId:'c1',calendarId:'cal1',title:'Meeting',startTime:'2026-10-29T10:00:00Z'}});
    expect(fetchMock.mock.calls[2][0].toString()).toContain('/calendars/events/appointments');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({contactId:'c1',calendarId:'cal1',locationId:'loc1'});
  });
  it('creates contacts and sends email with escaped HTML',async()=>{
    const fetchMock=vi.fn().mockResolvedValueOnce(json({contact:{id:'new'}})).mockResolvedValueOnce(json({contact:{locationId:'loc1'}})).mockResolvedValueOnce(json({messageId:'m1'}));vi.stubGlobal('fetch',fetchMock);
    await executeHighLevelWrite({...base,input:{action:'createContact',contact:{email:'x@example.invalid'}}});
    await executeHighLevelWrite({...base,input:{action:'sendMessage',contactId:'c1',type:'Email',message:'<hello>\nworld',subject:'Test'}});
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({html:'&lt;hello&gt;<br>world',type:'Email'});
  });
});
