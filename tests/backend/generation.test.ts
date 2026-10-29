import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({project:{name:'Test',version:0} as Record<string,any>,rate:null as any, saved:[] as any[], output:'', failure:null as Error|null, requests:[] as any[], files:[] as any[]}));
vi.mock('../../functions/src/config',()=>({groqModel:{value:()=> 'model'},llmProvider:{value:()=> 'groq'},maxGenerationsPerHour:{value:()=>20},openaiModel:{value:()=> 'model'}}));
vi.mock('../../functions/src/highlevel',()=>({getHighLevelData:vi.fn().mockRejectedValue(new Error('offline'))}));
vi.mock('../../functions/src/snapshot-retention',()=>({pruneOldSnapshots:vi.fn()}));
vi.mock('openai',()=>({default:class {chat={completions:{create:async (request:any)=>{fake.requests.push(request);if(fake.failure)throw fake.failure;const text=fake.output;return (async function*(){for(let i=0;i<text.length;i+=7)yield {choices:[{delta:{content:text.slice(i,i+7)}}]};})();}}};}}));
vi.mock('../../functions/src/admin',()=>{
  function ref(path:string):any { return {path, collection:(name:string)=>collection(path+'/'+name)}; }
  function collection(path:string):any {return {
    doc:(id:string)=>ref(path+'/'+id),limit:()=>collection(path),orderBy:()=>collection(path),
    get:async()=>path.endsWith('/files')?({size:fake.files.length,docs:fake.files.map((f:any)=>({data:()=>f})),forEach:(fn:any)=>fake.files.forEach((f:any)=>fn({data:()=>f}))}):({size:0,docs:[],forEach:()=>{}}),
  };}
  return {db:{doc:ref,runTransaction:async(fn:any)=>fn({
    get:async (r:any)=>r.path.includes('/rateLimits/') ? {exists:!!fake.rate,data:()=>fake.rate} : {exists:!!fake.project,data:()=>fake.project},
    update:(r:any,data:any)=>{if(r.path.includes('/projects/'))Object.assign(fake.project,data);},
    set:(r:any,data:any)=>{fake.saved.push({path:r.path,data});if(r.path.includes('/rateLimits/'))fake.rate=data;},
  })}};
});
import { generateProjectFiles } from '../../functions/src/generation';
const options=()=>({uid:'user',projectId:'project',prompt:'Build app',apiKey:'key',crmCredentials:{clientId:'x',clientSecret:'x',encryptionKey:'x'},signal:new AbortController().signal,send:vi.fn().mockResolvedValue(undefined)});
beforeEach(()=>{fake.project={name:'Test',version:0};fake.rate=null;fake.saved=[];fake.files=[];fake.output='';fake.failure=null;fake.requests=[];});
describe('generation lifecycle',()=>{
  it('streams tokens and persists complete generated files and a snapshot',async()=>{
    fake.output=JSON.stringify({files:[{path:'index.html',content:'<h1>hello</h1>'},{path:'app.js',content:'console.log(1);'}]});
    const opts=options();const result=await generateProjectFiles(opts);
    expect(result).toMatchObject({files:['index.html','app.js'],partial:false});
    expect(opts.send.mock.calls.some(([event])=>event==='token')).toBe(true);
    expect(opts.send.mock.calls.some(([event])=>event==='file_content')).toBe(true);
    expect(opts.send.mock.calls.at(-1)?.[0]).toBe('complete');
    expect(fake.saved.filter(item=>item.path.includes('/files/'))).toHaveLength(4);
    expect(fake.requests[0].stream).toBe(true);
    expect(fake.requests[0].response_format).toBeUndefined();
  });
  it('saves complete files and reports malformed records',async()=>{
    fake.output=JSON.stringify({files:[{path:'index.html',content:'ok'},{path:'../unsafe.js',content:'bad'}]});
    const opts=options();const result=await generateProjectFiles(opts);
    expect(result).toMatchObject({files:['index.html'],partial:true});
    expect(opts.send.mock.calls).toContainEqual(['error',expect.objectContaining({code:'MALFORMED_OUTPUT'})]);
  });
  it('reports provider failure and preserves existing project state',async()=>{
    fake.failure=Object.assign(new Error('rate limit'),{status:429});
    const opts=options();const result=await generateProjectFiles(opts);
    expect(result.partial).toBe(true);
    expect(opts.send.mock.calls).toContainEqual(['error',expect.objectContaining({code:'GENERATION_INTERRUPTED',message:expect.stringContaining('rate limit')})]);
  });
  it('enforces generation rate limits before contacting the provider',async()=>{
    fake.rate={windowStartMs:Date.now(),count:20};
    await expect(generateProjectFiles(options())).rejects.toThrow('limit of 20');
    expect(fake.requests).toHaveLength(0);
  });
  it('requires an API key',async()=>{
    await expect(generateProjectFiles({...options(),apiKey:''})).rejects.toThrow('LLM_API_KEY');
  });
  it('rejects duplicate paths while preserving the first valid file',async()=>{
    fake.output=JSON.stringify({files:[{path:'index.html',content:'first'},{path:'index.html',content:'second'}]});
    const opts=options();const result=await generateProjectFiles(opts);
    expect(result).toMatchObject({files:['index.html'],partial:true});
    expect(opts.send.mock.calls).toContainEqual(['error',expect.objectContaining({code:'MALFORMED_OUTPUT'})]);
  });
  it('marks interrupted generations partial without saving incomplete files',async()=>{
    const controller=new AbortController();controller.abort();fake.output=JSON.stringify({files:[{path:'index.html',content:'ignored'}]});
    const result=await generateProjectFiles({...options(),signal:controller.signal});
    expect(result).toMatchObject({files:[],partial:true});
  });
  it('reports empty model output',async()=>{
    fake.output=JSON.stringify({files:[]});const opts=options();await generateProjectFiles(opts);
    expect(opts.send.mock.calls).toContainEqual(['error',expect.objectContaining({code:'EMPTY_OUTPUT'})]);
  });
  it('rejects overlapping generation leases',async()=>{
    fake.project.activeGenerationId='other';fake.project.generationLeaseUntilMs=Date.now()+60000;
    await expect(generateProjectFiles(options())).rejects.toThrow('already running');
  });

  it('stores the exact manually edited input as the diff baseline',async()=>{
    fake.files=[{path:'index.html',content:'manual edit'}];fake.output=JSON.stringify({files:[{path:'index.html',content:'generated'}]});
    await generateProjectFiles(options());
    const baseline=fake.saved.find(item=>item.path.includes('/beforeFiles/'));
    expect(baseline.data).toEqual({path:'index.html',content:'manual edit'});
    expect(fake.saved.find(item=>item.data.diffBase==='generation-input').data.diffBaseFileCount).toBe(1);
  });

});
