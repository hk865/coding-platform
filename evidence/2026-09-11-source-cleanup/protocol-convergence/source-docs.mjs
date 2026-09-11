import fs from 'node:fs';
import path from 'node:path';
const files=['src/contracts/README.md','src/harness/README.md','src/control/plan-compiler/README.md','src/data/context-compiler/README.md','IMPLEMENTATION-HANDOFF.md'];
let checked=0;const failures=[];
for(const file of files)for(const m of fs.readFileSync(file,'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
 const ref=m[1].replace(/^<|>$/g,'').split('#')[0];if(!ref||/^(https?:|mailto:|codex:)/.test(ref))continue;checked++;
 if(!fs.existsSync(path.resolve(path.dirname(file),ref)))failures.push({file,ref});
}
fs.writeFileSync('evidence/2026-09-11-source-cleanup/protocol-convergence/source-docs.json',JSON.stringify({files,checked,failures},null,2));console.log(JSON.stringify({checked,failures}));if(failures.length)process.exitCode=1;
