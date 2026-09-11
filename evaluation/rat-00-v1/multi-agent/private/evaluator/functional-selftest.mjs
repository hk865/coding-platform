import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluate } from './functional.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const out=resolve(process.argv[2]); await mkdir(out,{recursive:true});
const tests=[
 {id:'changed-rule-base',kind:'case-sensitive',overlays:[],expected:'FAIL',requiredFailures:['filter.api-parameters-and-total']},
 {id:'changed-rule-oracle',kind:'case-sensitive',overlays:['private/oracles/filter','private/oracles/case-sensitive'],expected:'PASS'},
 {id:'changed-rule-oracle-repeat',kind:'case-sensitive',overlays:['private/oracles/filter','private/oracles/case-sensitive'],expected:'PASS'},
 {id:'changed-rule-stale-near-miss',kind:'case-sensitive',overlays:['private/oracles/filter'],expected:'FAIL',requiredFailures:['filter.api-parameters-and-total']},
 {id:'filter-base',kind:'filter',overlays:[],expected:'FAIL',requiredFailures:['filter.api-parameters-and-total','filter.persistence-after-reconstruction']},
 {id:'filter-oracle',kind:'filter',overlays:['private/oracles/filter'],expected:'PASS'},
 {id:'filter-oracle-repeat',kind:'filter',overlays:['private/oracles/filter'],expected:'PASS'},
 {id:'filter-near-miss',kind:'filter',overlays:['private/oracles/filter','private/near-miss/no-persistence'],expected:'FAIL',requiredFailures:['filter.persistence-after-reconstruction']},
 {id:'pagination-base',kind:'pagination',overlays:[],expected:'FAIL',requiredFailures:['pagination.filter-before-slice','pagination.filter-resets-ui-page']},
 {id:'pagination-oracle',kind:'pagination',overlays:['private/oracles/pagination'],expected:'PASS'},
 {id:'pagination-oracle-repeat',kind:'pagination',overlays:['private/oracles/pagination'],expected:'PASS'},
 {id:'pagination-near-miss',kind:'pagination',overlays:['private/oracles/pagination','private/near-miss/no-page-reset'],expected:'FAIL',requiredFailures:['pagination.filter-resets-ui-page']}
];
const results=[];
for(const test of tests){
 const workspace=await mkdtemp(join(tmpdir(),'rat-ma-control-'));
 try {
  await cp(join(root,'base'),workspace,{recursive:true});
  for(const overlay of test.overlays)await cp(join(root,overlay),workspace,{recursive:true});
  const publicTest=spawnSync(process.execPath,['--test','test/public.test.mjs'],{cwd:workspace,encoding:'utf8'});
  assert.equal(publicTest.status,0,publicTest.stdout+publicTest.stderr);
  const result=await evaluate(workspace,test.kind);
  await writeFile(join(out,test.id+'.json'),JSON.stringify({control:test,result,publicSmoke:{exitCode:publicTest.status,stdout:publicTest.stdout,stderr:publicTest.stderr}},null,2)+'\n');
  assert.equal(result.status,test.expected,test.id+JSON.stringify(result));
  for(const id of test.requiredFailures||[])assert.equal(result.assertions.find(x=>x.id===id)?.status,'FAIL',test.id+' '+id);
  results.push({id:test.id,expected:test.expected,observed:result.status,status:'PASS',assertions:result.assertions.length});
 } finally { await rm(workspace,{recursive:true,force:true}); }
}
const report={schemaVersion:1,status:'PASS',layer:'fixture-functional-evaluator-selftest',results,browserEngine:'NOT_PREPARED',realModelExecution:'NOT_RUN'};
await writeFile(join(out,'functional-selftest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
