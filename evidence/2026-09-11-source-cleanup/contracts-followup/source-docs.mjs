import fs from 'node:fs';
import path from 'node:path';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
const files=['src/contracts/README.md','src/contracts/validation/README.md','src/control/plan-compiler/README.md','IMPLEMENTATION-HANDOFF.md'];
const failures=[];let checked=0;
for(const file of files){const body=fs.readFileSync(file,'utf8');for(const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
 let ref=m[1].replace(/^<|>$/g,'').split('#')[0];if(!ref||/^(https?:|mailto:|codex:)/.test(ref))continue;
 ref=ref.replace(/:\d+$/,'');const target=path.resolve(path.dirname(file),ref);checked++;if(!fs.existsSync(target))failures.push({file,ref,target});
}}
fs.writeFileSync(`${evidence}/source-docs.json`,JSON.stringify({files,checked,failures},null,2));console.log(JSON.stringify({checked,failures}));if(failures.length)process.exitCode=1;
