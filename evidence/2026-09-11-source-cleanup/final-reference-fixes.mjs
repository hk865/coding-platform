import fs from 'node:fs';import path from 'node:path';
const root='evidence/2026-09-11-source-cleanup';
const files=['src/contracts/verification.ts','src/contracts/commands/governance.ts','src/contracts/commands/context.ts','src/execution/worker-runtime/fake-runtime-adapter.ts','tests/runtime/fake-runtime-adapter.test.ts','tests/app/governance-commands.test.ts'];
for(const f of files){const h=root+'/history/'+f+'.txt';if(!fs.existsSync(h)){fs.mkdirSync(path.dirname(h),{recursive:true});fs.copyFileSync(f,h);}let s=fs.readFileSync(f,'utf8').replaceAll('contracts/fixtures','fixtures');
if(f.endsWith('/verification.ts'))s=s.replace('CheckPort: the deterministic static/dynamic provider seam for P1-04\n * (fake providers live in contracts/testing; real tools are later tickets).','CheckPort: static/dynamic checks supplied by production CommandCheckProvider\n * or the explicit deterministic providers in src/testing.').replace('VerificationPort — FROZEN (interfaces_to_freeze: VerificationEngine).','VerificationEngine public verification entry.');
if(f.endsWith('/commands/context.ts'))s=s.replace(/\/\*\*\s*\n \* 把 P1-16[\s\S]*?\*\//,'/** 正式工作身份命令的唯一字段构造入口。Dispatch 提供身份、范围与时间；\n * 不从测试夹具取得默认值。测试包装可以显式补自己的默认值。 */');
if(f.endsWith('/commands/governance.ts'))s=s.replace(/\/\*\*\s*\n \* 这两种治理命令[\s\S]*?\*\//,'/** 治理命令的唯一字段构造入口。应用提供身份、时间与幂等键；\n * src/fixtures 中的包装只提供样例默认值。内容摘要复用\n * coordinationPolicyContentDigest / architectureEvolutionPolicyContentDigest，\n * 与 Control 安装守卫保持同一口径。 */');
fs.writeFileSync(f+'.cleanup-tmp',s,{flag:'wx'});fs.renameSync(f+'.cleanup-tmp',f);}
