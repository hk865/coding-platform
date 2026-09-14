import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {it,expect,vi} from 'vitest';
import {createGuiServer} from '/mnt/d/1.project/Software/agent_platform/src/app/server.js';
import {DispatchWake} from '/mnt/d/1.project/Software/agent_platform/src/app/scheduling/dispatch-wake.js';
import {RuntimeDispatch} from '/mnt/d/1.project/Software/agent_platform/src/control/dispatch-engine/runtime-dispatch.js';
import {ExecutionFeedbackCompiler} from '/mnt/d/1.project/Software/agent_platform/src/control/plan-compiler/execution-feedback-compiler.js';
import {createBuiltinProviderRegistry} from '/mnt/d/1.project/Software/agent_platform/vendor/coding-agent/dist/public-api.js';
it.each([false,true])('terminal followup after handoff via periodic wake=%s',async periodic=>{
 const dir=await mkdtemp(join(tmpdir(),'m-acceptance-')),root=join(dir,'root');await mkdir(root);await writeFile(join(root,'README.md'),'ok');
 let writerCalls=0,owner:any;const original=RuntimeDispatch.prototype.drive;
 const wakes=new Set<DispatchWake>(), wakeRequest=DispatchWake.prototype.request;
 vi.spyOn(DispatchWake.prototype,'request').mockImplementation(function(reason){wakes.add(this);return wakeRequest.call(this,reason);});
 const feedback:string[]=[];const originalFeedback=ExecutionFeedbackCompiler.prototype.request;
 vi.spyOn(ExecutionFeedbackCompiler.prototype,'request').mockImplementation(function(ref,...args){feedback.push(ref.runId);return originalFeedback.call(this,ref,...args);});
 vi.spyOn(RuntimeDispatch.prototype,'drive').mockImplementation(function(request){
  if(periodic && request.runRef?.runId.startsWith('replacement-')){owner=this;return Promise.resolve({scanned:0,started:0,completed:0,pendingRemaining:1,failures:[]});}
  return original.call(this,request);
 });
 const registry=createBuiltinProviderRegistry();const client={async *stream(request:any,options:any){
  if(request.tools.some((t:any)=>t.name==='edit')){
   writerCalls++;if(writerCalls===1){await new Promise<void>(done=>{if(options.signal?.aborted)done();else options.signal.addEventListener('abort',()=>done(),{once:true});});return;}
  }
  yield {schemaVersion:1,requestId:request.requestId,sequence:1,type:'text_delta',delta:'Work finished.'};
  yield {schemaVersion:1,requestId:request.requestId,sequence:2,type:'usage_snapshot',usage:{inputTokens:10,outputTokens:5,cachedInputTokens:0,costUsdMicros:null}};
  yield {schemaVersion:1,requestId:request.requestId,sequence:3,type:'completed',reason:'final_answer'};
 }};
 const app=await createGuiServer(join(dir,'data'),{workspaceRoots:{'acceptance-alpha':root,'acceptance-beta':root},modelSettings:{directory:join(dir,'settings'),registry:{list:()=>registry.list(),get:(id:string)=>registry.get(id),create:()=>client}}});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+(app.server.address() as any).port;
 const token=(await(await fetch(base+'/api/meta')).json()).workspaceToken;const scope={projectId:'acceptance-alpha',workspaceId:'workspace-main',goalId:'acceptance'};
 const post=async(path:string,body:any)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const state=async()=>await(await fetch(base+'/api/state?'+new URLSearchParams(scope))).json();
 const until=async(check:(s:any)=>boolean)=>{const end=Date.now()+20000;for(;;){const s=await state();if(check(s))return s;if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,30));}};
 try{
  expect((await post('/api/model-settings',{provider:'deepseek',model:'stub',baseUrl:'http://127.0.0.1',apiKey:'LOCAL_TEST_KEY'})).status).toBe(200);
  expect((await post('/api/goals',{...scope,requestId:'acceptance',objective:'test'})).status).toBe(200);
  expect((await post('/api/real/tasks',{...scope,requestId:'writer',instruction:'Wait.',allowWrite:true})).status).toBe(200);
  await until(s=>writerCalls===1);await post('/api/real/cancel',{...scope,runId:'real-writer'});
  await until(s=>s.liveRuns.some((r:any)=>r.spec.runId==='real-writer'&&r.canonicalStatus==='ended'));
  const replacement=await post('/api/real/handoff',{...scope,requestId:'replace',sourceRunId:'real-writer',reason:'Continue.'});expect(replacement.status).toBe(200);
  if(periodic){expect(owner).toBeDefined();await Promise.all([...wakes].map(w=>wakeRequest.call(w,'durable-periodic-scan')));}
  await until(s=>s.liveRuns.some((r:any)=>r.spec.runId===replacement.body.runId&&r.canonicalStatus==='ended'));
  await new Promise(r=>setTimeout(r,300));
  console.log(JSON.stringify({periodic,writerCalls,replacementRunId:replacement.body.runId,feedbackRunIds:feedback}));
  expect(writerCalls).toBe(2);expect(feedback.includes(replacement.body.runId)).toBe(true);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});vi.restoreAllMocks();}
},60000);
