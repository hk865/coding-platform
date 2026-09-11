import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateControl } from './control.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const out=resolve(process.argv[2]); await mkdir(out,{recursive:true});
const cases=JSON.parse(await readFile(join(root,'private/control-fixtures.json'),'utf8'));
const results=[];
for(const [scenarioId,fixture] of Object.entries(cases)) {
 const trace={schemaVersion:1,scenarioId,origin:'constructed-evaluator-selftest-only',observations:fixture.positive};
 const good=evaluateControl(trace); assert.equal(good.status,'PASS',scenarioId+JSON.stringify(good));
 await writeFile(join(out,scenarioId+'-positive.json'),JSON.stringify({trace,result:good},null,2)+'\n');
 results.push({scenarioId,control:'known-success',status:good.status});
 for(const bad of fixture.negativeMutations){
  const mutated=structuredClone(trace); let target=mutated.observations;const keys=bad.path.split('.');for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=bad.value;
  const result=evaluateControl(mutated);assert.equal(result.assertions.find(x=>x.id===bad.assertion).status,'FAIL',scenarioId+': '+bad.assertion);
  await writeFile(join(out,scenarioId+'-'+bad.assertion+'.json'),JSON.stringify({trace:mutated,expectedFailure:bad.assertion,result},null,2)+'\n');
  results.push({scenarioId,control:'known-failure',assertion:bad.assertion,status:'PASS',observed:result.status});
 }
}
const configurationControls=[];
for(const [scenarioId,fixture] of Object.entries(cases)){
 for(const [name,value] of [['missing',undefined],['unknown','unregistered'],['incompatible',scenarioId<'MA-04'?'parallel-with-injection':'single']]){
  const trace={schemaVersion:1,scenarioId,origin:'constructed-evaluator-selftest-only',observations:structuredClone(fixture.positive)};
  if(value===undefined)delete trace.observations.configuration;else trace.observations.configuration=value;
  const result=evaluateControl(trace);assert.equal(result.status,'FAIL');assert.equal(result.assertions[0].id,'trace.registered-scenario-configuration');
  configurationControls.push({scenarioId,case:name,trace,result});
 }
}
await writeFile(join(out,'invalid-configuration-controls.json'),JSON.stringify(configurationControls,null,2)+'\n');
const single={schemaVersion:1,scenarioId:'MA-02',origin:'constructed-evaluator-selftest-only',observations:structuredClone(cases['MA-02'].positive)};
single.observations.configuration='single';single.observations.runs=[single.observations.runs[0]];
const singleResult=evaluateControl(single);assert.equal(singleResult.status,'PASS');assert.equal(singleResult.assertions.filter(x=>x.status==='NOT_APPLICABLE').length,3);
await writeFile(join(out,'single-ablation-applicability.json'),JSON.stringify({trace:single,result:singleResult},null,2)+'\n');
const report={schemaVersion:1,layer:'evaluator-selftest',status:'PASS',results,invalidConfigurationControls:configurationControls.length,realModelExecution:'NOT_RUN',productControlIntegration:'NOT_PREPARED'};
await writeFile(join(out,'control-selftest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,positiveControls:8,negativeControls:results.length-8,invalidConfigurationControls:configurationControls.length,productControlIntegration:'NOT_PREPARED'}));
