import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),evidence=join(root,'evidence/rat-03');
const plan=JSON.parse(await readFile(join(evidence,'preregistered.json'),'utf8'));
const {createGuiServer}=await import(pathToFileURL(join(plan.source,'dist/app/server.js')));
const {defaultSettingsDirectory}=await import(pathToFileURL(join(plan.source,'dist/app/model-settings.js')));
const reports=[];
for(const task of plan.tasks){
 const dir=join(evidence,'platform-dispatch',task.taskId+'-trial-1');
 const report=JSON.parse(await readFile(join(dir,'runtime.json'),'utf8'));const spec=report.run.spec;
 const app=await createGuiServer(join(dir,'gui-data'),{modelSettings:{directory:defaultSettingsDirectory(join(root,'.local/gui'))}});
 try{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const scope={projectId:spec.projectId,workspaceId:spec.workspaceId,goalId:spec.goalId};
 const state=await(await fetch(`http://127.0.0.1:${app.server.address().port}/api/state?`+new URLSearchParams(scope))).json();
 const runtime=state.liveRuns.find(r=>r.spec.runId===spec.runId);
 assert.deepEqual(runtime.usage,report.run.usage);assert.equal(runtime.trace.filter(e=>e.type==='model.request_started').length,report.run.usage.length);
 const canonical=state.agents.agents.rows.find(r=>r.runRef.runId===spec.runId);assert.equal(canonical.runOutcome,'completed');
 await writeFile(join(dir,'platform-settled-state.json'),JSON.stringify(state,null,2)+'\n');
 reports.push({taskId:task.taskId,runId:spec.runId,canonicalOutcome:canonical.runOutcome,requests:runtime.usage.length,newRequests:0});
 }finally{await app.close();}
}
await writeFile(join(evidence,'settled-state-check.json'),JSON.stringify({status:'PASS',scope:'Separate post-run persisted projection read after host restart; original immediate snapshots retained',reports},null,2)+'\n');
console.log(JSON.stringify(reports));
