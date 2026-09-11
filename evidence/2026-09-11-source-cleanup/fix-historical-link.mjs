import fs from 'node:fs';import path from 'node:path';
const file='../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-core-verification/reviewer-continuation.md';
const saved='evidence/2026-09-11-source-cleanup/history/docs/dev_docs/verification/2026-09-09-core-verification/reviewer-continuation.md.txt';
fs.mkdirSync(path.dirname(saved),{recursive:true});if(!fs.existsSync(saved))fs.copyFileSync(file,saved);
const old=fs.readFileSync(file,'utf8'),next=old.replace('/src/contracts/ledger-validation.ts#L628','/src/data/state-ledger/ledger-validation.ts#L628');
if(next===old)throw Error('Expected broken link not found');fs.writeFileSync(file+'.cleanup-tmp',next,{flag:'wx'});fs.renameSync(file+'.cleanup-tmp',file);
