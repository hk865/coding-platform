import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNext } from '../injections/select-next.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));const out=resolve(process.argv[2]);await mkdir(out,{recursive:true});const results=[];
for(const id of ['MA-04','MA-05','MA-06','MA-07','MA-08']) {
 const plan=JSON.parse(await readFile(join(root,'private/injections',id+'.json'),'utf8'));const observed=[],issued=[];
 for(const step of plan.steps){
  assert.equal(selectNext(plan,observed,issued),null);
  assert.equal(selectNext(plan,[...observed,{id:'wrong',type:'unrelated'}],issued),null);
  observed.push({id:'anchor-'+step.id,...step.after});const action=selectNext(plan,observed,issued);assert.equal(action.injectionId,step.id);assert.equal(action.anchorEventId,'anchor-'+step.id);issued.push(step.id);
  results.push({scenarioId:id,injectionId:step.id,knownTrigger:'PASS',missingTrigger:'PASS',wrongTrigger:'PASS'});
 }
 assert.equal(selectNext(plan,observed,issued),null);
}
const report={schemaVersion:1,layer:'directive-selection-selftest',status:'PASS',results,productInjectionAdapter:'NOT_PREPARED',realFlowInjection:'NOT_RUN'};await writeFile(join(out,'injection-selftest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'PASS',directives:results.length,productInjectionAdapter:'NOT_PREPARED'}));
