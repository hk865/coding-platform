import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {createGuiServer} from '../../src/app/server.js';
import {createBuiltinProviderRegistry,type ModelClientPort,type ModelRequest} from '../../vendor/coding-agent/dist/public-api.js';
import type {QueryRuntimeRecord} from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import {semanticQueryGuideFor} from '../../src/contracts/query-execution-context.js';

it('three response purposes adopt current persisted versions in real kernel requests and retain separate save/adoption facts',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cm1b-response-')),root=join(dir,'source');await mkdir(root);
  const requests:ModelRequest[]=[],builtin=createBuiltinProviderRegistry();
  const client:ModelClientPort={async *stream(request){
    requests.push(structuredClone(request));
    const input=request.messages.filter(message=>message.role==='user').map(message=>message.content).join('\n');
    // Deterministic behavior witness, explicitly not a commercial-model quality eval.
    const answer=input.includes('CM1B_TEMP_DETAIL')?'Temporary detailed explanation, for this request only.':input.includes('CM1B_ARCH_DETAIL')?'Architecture: boundaries, interfaces and tradeoffs. Detailed explanation from the selected preference.':'Brief status.';
    yield {schemaVersion:1,requestId:request.requestId,sequence:1,type:'text_delta',delta:JSON.stringify({schemaVersion:1,language:'en',blocks:[{kind:'explanation',text:answer,basis:[]}]})};
    yield {schemaVersion:1,requestId:request.requestId,sequence:2,type:'usage_snapshot',usage:{inputTokens:100,outputTokens:20,cachedInputTokens:0,costUsdMicros:null}};
    yield {schemaVersion:1,requestId:request.requestId,sequence:3,type:'completed',reason:'final_answer'};
  }};
  const options={workspaceRoots:{'acceptance-alpha':root,'acceptance-beta':root},modelSettings:{directory:join(dir,'settings'),registry:{list:()=>builtin.list(),get:(id:string)=>builtin.get(id),create:()=>client}}};
  let app=await createGuiServer(join(dir,'data'),options),base='',token='';
  const scope={projectId:'acceptance-alpha',workspaceId:'workspace-main',goalId:'acceptance-demo'};
  const listen=async()=>{await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const address=app.server.address();if(!address||typeof address==='string')throw Error('port');
    base='http://127.0.0.1:'+address.port;token=(await(await fetch(base+'/api/meta')).json() as {workspaceToken:string}).workspaceToken;};
  const post=async(path:string,body:unknown)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify(body)});
    const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(200);return result;};
  const query=async(id:string,purpose:string,question='Explain the current public situation.')=>{
    const before=requests.length;
    await post('/api/real/queries',{...scope,requestId:id,question,responsePurpose:purpose});
    const start=Date.now();for(;;){
      const run=((await post('/api/real/queries/runs',scope)) as {runs:QueryRuntimeRecord[]}).runs.find(row=>row.runRef.runId==='real-query-'+id);
      if(run&&run.status!=='running'){expect(run.status,JSON.stringify(run)).toBe('completed');return {run,requests:requests.slice(before)};}
      if(Date.now()-start>20_000)throw Error('query did not finish');await new Promise(done=>setTimeout(done,25));
    }
  };
  try{
    await listen();await post('/api/model-settings',{provider:'deepseek',model:'labelled-memory-input-stub',baseUrl:'http://127.0.0.1',apiKey:'LOCAL_TEST_KEY'});
    expect(await post('/api/real/memory/profile/maintain',{requestId:'general',expectedRevision:0,edits:[{operation:'remember',entryId:'general',content:'CM1B_ALL_BRIEF: Keep all replies brief.'}]})).toMatchObject({status:'committed',revision:1});
    for(const purpose of ['reply','architecture','progress']){
      const observed=await query('before-'+purpose,purpose);
      expect(observed.requests).toHaveLength(1);expect(JSON.stringify(observed.requests[0]!.messages)).toContain('CM1B_ALL_BRIEF');
      expect(observed.requests[0]!.systemPrompt).toContain(semanticQueryGuideFor(purpose).instruction);
      expect(observed.requests[0]!.systemPrompt).not.toContain('CM1B_ALL_BRIEF');
      expect(observed.run.responseGuide).toBe(semanticQueryGuideFor(purpose).id);
      expect(JSON.parse(observed.run.input).responseGuide).toBe(semanticQueryGuideFor(purpose).id);
      expect(JSON.parse(observed.run.input)).toMatchObject({responsePurpose:purpose,maintainedPreferences:{profileRevision:1}});
      expect(observed.run.result).toMatchObject({outcome:'answered',answer:'Explanation：Brief status.'});
    }
    expect(await post('/api/real/memory/profile/maintain',{requestId:'specific',expectedRevision:1,edits:[
      {operation:'remember',entryId:'architecture',content:'CM1B_ARCH_DETAIL: Explain architecture in detail.',conditions:{purposes:['architecture'],expiresAt:null}},
      {operation:'remember',entryId:'progress',content:'CM1B_PROGRESS_BRIEF: Give concise progress updates.',conditions:{purposes:['progress'],expiresAt:null}}]})).toMatchObject({status:'committed',revision:2});
    await app.close();app=await createGuiServer(join(dir,'data'),options);await listen();
    for(const purpose of ['reply','architecture','progress']){
      const observed=await query('after-'+purpose,purpose),input=JSON.parse(observed.run.input);
      expect(input.maintainedPreferences.profileRevision).toBe(2);
      expect(input.maintainedPreferences.entries.some((row:{entry:{entryId:string}})=>row.entry.entryId==='architecture')).toBe(purpose==='architecture');
      const actual=JSON.stringify(observed.requests[0]!.messages);
      expect(actual.includes('CM1B_ARCH_DETAIL')).toBe(purpose==='architecture');
      if(purpose==='architecture')expect(JSON.stringify(observed.run.result)).toContain('Detailed explanation');
      else expect(observed.run.result).toMatchObject({outcome:'answered',answer:'Explanation：Brief status.'});
    }
    const adoption=await post('/api/real/memory/project/adoption',scope) as {runs:{memory:{profileRevision:number}}[]};
    expect(adoption.runs.map(run=>run.memory.profileRevision).sort()).toEqual([1,1,1,2,2,2]);
    const temporary=await query('temporary','reply','CM1B_TEMP_DETAIL: explain this one reply in detail without saving a preference.');
    expect(temporary.run.result).toMatchObject({outcome:'answered',answer:'Explanation：Temporary detailed explanation, for this request only.'});
    expect(await post('/api/real/memory/profile/view',{})).toMatchObject({status:'ready',snapshot:{revision:2}});
    const nextReply=await query('after-temporary','reply');expect(nextReply.run.result).toMatchObject({outcome:'answered',answer:'Explanation：Brief status.'});
    expect(JSON.stringify(nextReply.requests[0]!.messages)).not.toContain('CM1B_TEMP_DETAIL');
    expect(await post('/api/real/memory/profile/maintain',{requestId:'delete-general',expectedRevision:2,edits:[{operation:'remove',entryId:'general',expectedEntryRevision:1}]})).toMatchObject({status:'committed',revision:3});
    const afterDeletion=await query('after-deletion','reply');expect(JSON.stringify(afterDeletion.requests[0]!.messages)).not.toContain('CM1B_ALL_BRIEF');
    expect(requests.every(request=>request.tools.every(tool=>!['edit','shell'].includes(tool.name)))).toBe(true);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
},60_000);
