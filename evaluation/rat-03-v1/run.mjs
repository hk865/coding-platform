import { readFile, writeFile, mkdir, appendFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const source = join(root, '.local/evaluation/rat-03/source');
const outputRoot = join(root, 'evidence/rat-03');
const tasksRoot = join(root, '.local/evaluation/rat-00/kernel-baseline/benchmarks/tasks');
const from = p => import(pathToFileURL(join(source, p)).href);
const kernel = await from('vendor/coding-agent/dist/public-api.js');
const harness = await from('vendor/coding-agent/benchmarks/harness/benchmark-harness.mjs');
const { runRealBaseline } = await from('vendor/coding-agent/benchmarks/harness/real-baseline.mjs');
const { createModelSettings, defaultSettingsDirectory } = await from('dist/app/model-settings.js');
const { createGuiServer } = await from('dist/app/server.js');
const { prepareRuntimeWorkspace } = await from('dist/runtime/coding-agent-runtime.js');
const { ModelBudget } = await from('dist/runtime/model-budget.js');
const settings = await createModelSettings(join(root, '.local/gui'));
const reference = (await settings.read()).configuration;
assert(reference && reference.provider === 'deepseek' && reference.model === 'deepseek-v4-flash-vision-exp');
const tasks = await harness.loadBenchmarkTasks(tasksRoot);
const revision = spawnSync('git', ['rev-parse','HEAD'], {cwd:source,encoding:'utf8'}).stdout.trim();
assert.equal(spawnSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).stdout.trim(),'');
const budgetFor = task => ({contextWindowTokens:1_000_000,inputTokens:200_000,outputTokens:16_384,maxRequests:task.maxModelRequests,maxToolCalls:task.maxToolCalls,timeoutMs:task.timeoutSeconds*1000,perResponseTokens:2048});
const hash = b => createHash('sha256').update(b).digest('hex');
const plan = {stage:'RAT-03',revision,source,configuration:reference,scriptSha256:hash(await readFile(import.meta.filename)),repeats:1,runnerOrder:['kernel-direct','platform-dispatch'],tasks:tasks.map(t=>({taskId:t.task.taskId,digest:t.digest,budget:budgetFor(t.task)})),network:'disabled for tools; provider HTTPS only in host',modelOptions:'RAT-01 bound client defaults on both paths; no thinking override',oracleIsolation:'only public base workspace and original instruction passed to worker; evaluator outside workspace',onFailure:'Preserve every trial, no automatic retries, budget increases or best-result selection'};
await mkdir(outputRoot,{recursive:true});
if (process.argv.includes('--prepare')) {
 await writeFile(join(outputRoot,'preregistered.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 const preflight=await harness.preflightBenchmarkSuite(tasksRoot);
 await writeFile(join(outputRoot,'preflight.json'),JSON.stringify(preflight,null,2)+'\n');
 console.log(JSON.stringify({prepared:true,revision,tasks:plan.tasks,preflight}));
 process.exit(0);
}
assert.equal(process.env.RAT03_LIVE,'1','explicit live execution required');
assert.deepEqual(JSON.parse(await readFile(join(outputRoot,'preregistered.json'),'utf8')),plan,'frozen inputs changed');
await writeFile(join(outputRoot,'execution-started.json'),JSON.stringify({startedAt:new Date().toISOString(),planDigest:hash(JSON.stringify(plan))})+'\n',{flag:'wx'});
process.env.PYTHONDONTWRITEBYTECODE='1';
const deniedPrefixes=['.evaluator','.oracle','hidden-tests','.git','.env','.env.local','.platform-runtime'];
const processSandboxOptions={readOnlyPaths:['.platform-runtime'],executablePath:'/workspace/.platform-runtime/bin:/usr/bin:/bin'};
async function direct(loaded, prepared, dir, budget) {
 const runId=randomUUID(),bound=await settings.bindRun(runId); assert.deepEqual(bound.configuration,reference);
 const usage=[],trace=[]; const controller=new AbortController();
 const meter=new ModelBudget(budget, async entries=>{usage.splice(0,usage.length,...structuredClone(entries));await writeFile(join(dir,'meter.json'),JSON.stringify(entries,null,2)+'\n');});
 const registry=kernel.createBuiltinProviderRegistry(),definition=registry.get(bound.configuration.provider);
 const providerRegistry=new kernel.ProviderRegistry().register({...definition,create:()=>meter.wrap(bound.client)});
 const ws=await kernel.WorkspaceSandbox.create(prepared.workspace,{deniedPrefixes});
 const profile=await kernel.ProcessSandbox.probe(prepared.workspace,ws); assert(profile.available,'sandbox unavailable');
 const probe=await new kernel.ProcessSandbox(profile,prepared.workspace,ws,processSandboxOptions).execute({command:'node --version',cwd:'.',timeoutMs:5000,outputLimitBytes:1000,signal:controller.signal}); assert.equal(probe.exitCode,0);
 const base=await kernel.loadAppConfig({cwd:prepared.workspace,environment:{}});
 const timer=setTimeout(()=>controller.abort('deadline'),budget.timeoutMs);
 let result;
 try {
 result=await kernel.runCodingAgent({config:{...base,model:{...base.model,provider:definition.id,model:reference.model,baseUrl:reference.baseUrl,maxOutputTokens:budget.perResponseTokens},runtime:{tokenBudget:budget.contextWindowTokens,maxModelRequests:budget.maxRequests,maxToolCalls:budget.maxToolCalls},tools:{enabledNames:['read','edit','shell']},storage:{databasePath:join(dir,'session.sqlite')},skills:{resourceRoot:join(source,'vendor/coding-agent/resources/skills'),enabledIds:['coding-safety']}},workspaceRoot:prepared.workspace,input:await readFile(join(loaded.taskRoot,'instruction.md'),'utf8'),sessionId:runId,signal:controller.signal,secretSource:{get:()=> 'platform-bound-client'},providerRegistry,workspaceOptions:{deniedPrefixes},processSandboxOptions,limits:{maxModelRequests:budget.maxRequests,maxToolCalls:budget.maxToolCalls,maxInputTokens:budget.inputTokens,maxOutputTokens:budget.outputTokens,maxTotalTokens:null,maxCostUsdMicros:null,deadlineMs:budget.timeoutMs},approvalRequester:new kernel.StaticApprovalRequester({decision:'allow_once',reason:'explicit_isolated_RAT03_trial'}),observerEventSinks:[{sinkId:'rat03',delivery:'best_effort',publish:async event=>{const data=structuredClone(event.payload); if(data.message) delete data.message.reasoningContent; const item={type:event.type,sequence:event.meta.sequence,at:event.meta.occurredAt,data};trace.push(item); await appendFile(join(dir,'native-trace.jsonl'),JSON.stringify(item)+'\n');}}]});
 } finally {clearTimeout(timer);}
 return {status:controller.signal.aborted?'budget_exhausted':result.state.status,timeout:controller.signal.reason==='deadline',sessionId:result.sessionId,configuration:bound.configuration,usage,trace,nativeOutcome:result.state.outcome};
}
async function platform(loaded, prepared, dir, budget) {
 const app=await createGuiServer(join(dir,'gui-data'),{modelSettings:{directory:defaultSettingsDirectory(join(root,'.local/gui'))}});
 try {
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r)); const base=`http://127.0.0.1:${app.server.address().port}`;
 const token=(await (await fetch(base+'/api/meta')).json()).workspaceToken;
 async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify(body)}); const data=await r.json(); if(!r.ok) throw Error(JSON.stringify({httpStatus:r.status,data})); return data;}
 const p=await post('/api/projects/add',{path:prepared.workspace}); const goalId=randomUUID();const scope={projectId:p.projectId,workspaceId:p.workspaceId,goalId};
 const instruction=await readFile(join(loaded.taskRoot,'instruction.md'),'utf8');
 await post('/api/goals',{...scope,requestId:goalId,objective:instruction});
 const request={...scope,requestId:randomUUID(),instruction,allowWrite:true,budget};
 const accepted=await post('/api/real/tasks',request);
 await writeFile(join(dir,'dispatch.json'),JSON.stringify({request,accepted},null,2)+'\n');
 const started=Date.now(); let state,run;
 while(Date.now()-started<budget.timeoutMs+20000){state=await (await fetch(base+'/api/state?'+new URLSearchParams(scope))).json();run=state.liveRuns.find(r=>r.spec.runId===accepted.runId); if(run&&!['prepared','running'].includes(run.status))break; await new Promise(r=>setTimeout(r,100));}
 assert(run&&!['prepared','running'].includes(run.status),'platform host observation timeout');
 await writeFile(join(dir,'platform-state.json'),JSON.stringify(state,null,2)+'\n');
 await writeFile(join(dir,'native-trace.jsonl'),run.trace.map(e=>JSON.stringify(e)).join('\n')+'\n');
 assert.deepEqual(run.configuration,reference);
 return {...run,timeout:run.status==='budget_exhausted'&&Date.now()-started>=budget.timeoutMs-1000};
 } finally {await app.close();}
}
async function trial(loaded,options){
 const id=loaded.task.taskId, dir=join(outputRoot,options.runId,id+'-trial-1');await mkdir(dir,{recursive:true});
 const prepared=await harness.prepareWorkspace(loaded,'base');
 const budget=budgetFor(loaded.task);
 await prepareRuntimeWorkspace(prepared.workspace); prepared.before=await harness.snapshot(prepared.workspace);
 await writeFile(join(dir,'workspace.json'),JSON.stringify({root:prepared.workspace,before:Object.fromEntries(prepared.before),budget},null,2)+'\n');
 const started=Date.now();let run,error;
 console.log(JSON.stringify({event:'trial-started',runner:options.runId,taskId:id}));
 try {run=await (options.runId==='kernel-direct'?direct:platform)(loaded,prepared,dir,budget);}catch(e){error=String(e).replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]');}
 const runtimeMs=Date.now()-started;
 const evaluation=await harness.evaluateWorkspace(loaded,prepared);
 const after=await harness.snapshot(prepared.workspace);
 let status=evaluation.status;
 if(evaluation.status!=='policy_violation') {if(error)status='environment_error';else if(run.timeout)status='timeout';else if(run.status!=='completed')status='agent_error';}
 const entries=run?.usage??[];
 const usage={modelRequestCount:entries.length,toolCallCount:run?.trace.filter(e=>e.type==='tool.started').length??0,inputTokens:entries.reduce((s,e)=>s+(e.inputTokens??0),0),outputTokens:entries.reduce((s,e)=>s+(e.outputTokens??0),0),cachedInputTokens:entries.reduce((s,e)=>s+(e.cachedInputTokens??0),0),costUsdMicros:null};
 const report={runner:options.runId,taskId:id,taskDigest:loaded.digest,status,runtimeMs,evaluatorStatus:evaluation.status,run:run??null,error};
 await writeFile(join(dir,'runtime.json'),JSON.stringify(report,null,2)+'\n');
 let patch='';for(const p of evaluation.changedPaths){if(p.startsWith('.platform-runtime/')){patch+=`Runtime file changed: ${p}\n`;continue;} const d=spawnSync('diff',['-u','--label','a/'+p,'--label','b/'+p,join(loaded.taskRoot,loaded.task.variants.base,p),join(prepared.workspace,p)],{encoding:'utf8',maxBuffer:1024*1024});patch+=d.stdout??'';}
 await writeFile(join(dir,'patch.diff'),patch);
 console.log(JSON.stringify({event:'trial-finished',runner:options.runId,taskId:id,status,evaluatorStatus:evaluation.status,usage,error}));
 return {...evaluation,status,wallClockMs:runtimeMs+evaluation.wallClockMs,before:prepared.before,after,agentCommand:{exitCode:run?.status==='completed'?0:2,stdout:'',stderr:error??run?.error??''},agentSummary:{status:run?.status,sessionId:run?.sessionId,configuration:reference,usage,traceArtifact:'native-trace.jsonl',runtimeArtifact:'runtime.json',budget}};
}
const runs=[];
for(const runner of plan.runnerOrder){runs.push(await runRealBaseline({projectRoot:join(source,'vendor/coding-agent'),tasksRoot,outputRoot,runId:runner,provider:reference.provider,model:reference.model,modelOptions:{configurationRevision:reference.revision,thinking:'bound-client-default',contextWindowTokens:1000000},runTask:trial}));await writeFile(join(outputRoot,'comparison.json'),JSON.stringify({plan,runs},null,2)+'\n');}
settings.close();
console.log(JSON.stringify({event:'complete',summaries:runs.map(r=>r.summary)}));
