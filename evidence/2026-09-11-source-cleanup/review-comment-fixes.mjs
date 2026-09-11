import fs from 'node:fs';import path from 'node:path';
const dir='evidence/2026-09-11-source-cleanup';
function edit(f,fn){const old=fs.readFileSync(f,'utf8'),s=fn(old);if(s===old)return;const h=dir+'/history/'+f+'.txt';if(!fs.existsSync(h)){fs.mkdirSync(path.dirname(h),{recursive:true});fs.copyFileSync(f,h);}fs.writeFileSync(f+'.cleanup-tmp',s,{flag:'wx'});fs.renameSync(f+'.cleanup-tmp',f);}
edit('src/control/plan-compiler/rework-plan-compiler.ts',s=>s.replace(/\/\*\*\s*\n \* 人类摘要里[\s\S]*?\*\//,'').replace('/** 一个被取代任务 + 处置它的问题 = 一个返工任务。 */','').replace('「本票不产生任何账本写入」','「编译不产生任何账本写入」').replace(/\n{4,}/g,'\n\n'));
for(const f of ['src/contracts/context-continuity.ts','src/control/control-engine/work-record.ts','src/data/state-ledger/in-memory-ledger.ts','src/data/state-ledger/sqlite-ledger.ts','tests/control/work-identity-uniqueness.test.ts'])edit(f,s=>s.replaceAll('contracts/ledger-validation','data/state-ledger/ledger-validation'));
