import fs from 'node:fs';
import crypto from 'node:crypto';
const root='evidence/2026-09-10-def17/', sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const names=['candidate','full-end','browser-end','final'];
const manifests=names.map(name=>{const file=name+'-source-sha256.json', m=JSON.parse(fs.readFileSync(root+file));return{file,root:m.root,count:m.files.length,declared:m.digest,recomputed:sha(JSON.stringify(m.files)),files:m.files}});
const final=manifests.at(-1), actualMismatches=[];
for(const f of final.files){try{const actual=sha(fs.readFileSync(f.path));if(actual!==f.sha256)actualMismatches.push({path:f.path,actual,expected:f.sha256})}catch(e){actualMismatches.push({path:f.path,error:e.code})}}
const logNames=['full-tests-final.log','browser-final.log','backend-types.log','ui-types.log','build.log','module-boundaries.log','validate-docs-progress.log'];
const logs=logNames.map(file=>{const b=fs.readFileSync(root+file);return{file,bytes:b.length,sha256:sha(b),exitCode:Number(b.toString().match(/EXIT_CODE=(\d+)\s*$/)?.[1]??-1)}});
const clean=name=>fs.readFileSync(root+name,'utf8').replace(/\u001b\[[0-9;]*m/g,'');
const full=clean('full-tests-final.log'),browser=clean('browser-final.log');
const summary=full.match(/Test Files\s+([^\n]+)\n\s+Tests\s+([^\n]+)/);
const cases=[...full.matchAll(/^\s*✓ ([^\n]+\.test\.ts) \((\d+) tests?\)/gm)].map(m=>({file:m[1],tests:Number(m[2])}));
const browserCases=browser.split('\n').filter(line=>/^\s*✓\s+\d+\s+tests\//.test(line));
const boundaryBody=clean('module-boundaries.log');
const boundary=JSON.parse(boundaryBody.slice(boundaryBody.indexOf('{'),boundaryBody.lastIndexOf('}')+1));
const result={checkedAt:new Date().toISOString(),manifests:manifests.map(({files,...m})=>m),allManifestFilesEqual:manifests.every(m=>JSON.stringify(m.files)===JSON.stringify(final.files)),actualMismatches,logs,
 full:{fileSummary:summary?.[1],testSummary:summary?.[2],parsedFileRows:cases.length,parsedTestSum:cases.reduce((n,x)=>n+x.tests,0),focus:cases.filter(x=>/reviewer-(?:recovery|product-recovery|runtime-start-rejection|lease-conflict-recovery|unknown-outcome-preservation)|runtime-observation-journal/.test(x.file))},
 browser:{summary:browser.match(/^\s*(\d+ passed \([^\n]+\))/m)?.[1],parsedPassedRows:browserCases.length,recoveryCases:browserCases.filter(line=>line.includes('reviewer-recovery.spec.ts')),skippedSummary:/^\s*\d+ skipped\b/m.test(browser)},
 boundary:{sourceFiles:boundary.sourceFiles,inventoryFiles:boundary.inventoryFiles,issues:boundary.issues,coverage:boundary.coverage},
 documentation:{progressPassed:clean('validate-docs-progress.log').includes('13/13 checks passed'),finalStatusSyncStillPending:true}};
fs.writeFileSync(root+'independent-final-check.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
