import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'evidence/rat-03');
const load=p=>readFile(p,'utf8').then(JSON.parse);
const plan=await load(join(evidence,'preregistered.json'));
const {benchmarkTrialResultSchema}=await import(pathToFileURL(join(plan.source,'vendor/coding-agent/benchmarks/schemas/benchmark-schema.mjs')));
const rows=[];
for(const runner of plan.runnerOrder)for(const task of plan.tasks){
 const dir=join(evidence,runner,task.taskId+'-trial-1');
 const result=benchmarkTrialResultSchema.parse(await load(join(dir,'result.json')));
 const runtime=await load(join(dir,'runtime.json'));
 const diff=await load(join(dir,'diff.json'));
 assert.equal(result.taskDigest,task.digest);assert.equal(result.agent.revision,plan.revision);assert.equal(result.model.model,plan.configuration.model);
 assert.equal(runtime.status,result.status);assert.equal(result.metrics.modelRequestCount,runtime.run.usage.length);
 assert.deepEqual(runtime.run.configuration,plan.configuration);
 const events=(await readFile(join(dir,'native-trace.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 assert.equal(events.filter(e=>e.type==='model.request_started').length,result.metrics.modelRequestCount);
 assert(result.metrics.modelRequestCount<=task.budget.maxRequests);
 assert(result.metrics.toolCallCount<=task.budget.maxToolCalls);
 assert.equal(diff.before['.platform-runtime/bin/node'],diff.after['.platform-runtime/bin/node']);
 if(runner==='platform-dispatch'){
 const state=await load(join(dir,'platform-settled-state.json'));const run=state.agents.agents.rows.find(r=>r.runRef.runId===runtime.run.spec.runId);assert(run);
 if(result.status==='resolved')assert.equal(run.runOutcome,'completed');
 assert(state.matrix.matrix.rows.every(r=>r.livePhase!=='satisfied'));
 }
 rows.push({runner,taskId:task.taskId,status:result.status,evaluatorStatus:runtime.evaluatorStatus,modelRequests:result.metrics.modelRequestCount,toolCalls:result.metrics.toolCallCount,inputTokens:result.metrics.inputTokens,outputTokens:result.metrics.outputTokens,cachedInputTokens:result.metrics.cachedInputTokens,unknownUsageRequests:runtime.run.usage.filter(e=>e.status!=='reported').length,runtimeMs:runtime.runtimeMs,changedPaths:result.changedPaths});
}
assert.equal(spawnSync('git',['status','--porcelain'],{cwd:plan.source,encoding:'utf8'}).stdout.trim(),'');
const report={status:'PASS',scope:'evidence completeness and consistency, separate from ability gate',trialCount:rows.length,abilityGate:rows.every(r=>r.status==='resolved')?'PASS':'FAIL',rows};
await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
