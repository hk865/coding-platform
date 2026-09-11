import fs from 'node:fs';import path from 'node:path';
const files=['IMPLEMENTATION-HANDOFF.md','src/contracts/README.md','src/harness/README.md','src/control/plan-compiler/README.md','src/control/verification-engine/README.md','src/data/state-ledger/README.md','src/fixtures/README.md','src/testing/README.md','tests/contract-support/README.md'];
const broken=[];let checked=0;
for(const f of files){const text=fs.readFileSync(f,'utf8');for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){let url=m[1];if(/^(https?:|#|codex:)/.test(url))continue;url=url.split('#')[0];const dest=path.resolve(path.dirname(f),url);checked++;if(!fs.existsSync(dest))broken.push({file:f,target:url});}}
console.log(JSON.stringify({files:files.length,checked,broken},null,2));if(broken.length)process.exitCode=1;
