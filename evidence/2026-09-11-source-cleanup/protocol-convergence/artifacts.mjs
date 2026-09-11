import fs from 'node:fs';
import {root} from './edit.mjs';
const stage=process.argv[2],out=`${root}/artifacts-${stage}.json`;
if(!['before','after'].includes(stage)||fs.existsSync(out))throw Error('Fresh named stage required');
const obsolete=['planProposalRequest','assemblePlanningContext','recordPlanChangeProposal','recordUserDecision','applyPlanChange','assembleQueryContext','assembleWorkContext','assembleCompletedWorkContext','amend'];
const stale=[];
for(const file of ['dist/harness/in-memory-harness.js','dist/harness/persistent-harness.js']) {
 const text=fs.readFileSync(file,'utf8');for(const name of obsolete)if(new RegExp(`^\\s+${name}:`,'m').test(text))stale.push({file,name});
}
const compiler=fs.readFileSync('dist/control/plan-compiler/plan-compiler.js','utf8');
const result={checkedAt:new Date().toISOString(),staleForwarders:stale,requestInitialBuilt:compiler.includes('async requestInitial(')};
if(stage==='after') {
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);
 const files=walk('dist').filter(f=>f.endsWith('.js')&&!f.startsWith('dist/app/public/'));
 result.serverFiles=files.length;
 result.stalePaths=files.filter(f=>!fs.existsSync(f.replace(/^dist\//,'src/').replace(/\.js$/,'.ts')));
}
fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(stale.length||!result.requestInitialBuilt||result.stalePaths?.length)process.exitCode=1;
