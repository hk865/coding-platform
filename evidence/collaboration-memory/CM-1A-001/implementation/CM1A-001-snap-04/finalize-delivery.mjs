import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04');
const docs=path.resolve(root,'../agent_learn/agent_dev/agent_platform'),planning=path.join(docs,'dev_docs/planning/active/collaboration-memory');
const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=(f,v)=>writeFileSync(path.join(out,f),JSON.stringify(v,null,2)+'\n');
const snapshot=JSON.parse(read(path.join(out,'source-snapshot.json'))),after=JSON.parse(read(path.join(out,'source-snapshot-after.json')));
if(snapshot.sourceFingerprintSha256!==after.sourceFingerprintSha256)throw Error('Frozen source mismatch');
for(const f of ['full-delivery','build-delivery','typecheck-delivery','boundaries-delivery','docs-delivery','kernel-delivery'])if(read(path.join(out,'logs',f+'.exit-code')).trim()!=='0')throw Error('Not passed: '+f);
const log=read(path.join(out,'logs/full-delivery.log')).replace(/\x1b\[[0-9;]*m/g,'');
const files=Number(log.match(/Test Files\s+(\d+) passed/)?.[1]),tests=Number(log.match(/Tests\s+(\d+) passed/)?.[1]);
if(!files||!tests||/^ FAIL /m.test(log))throw Error('Full regression summary missing or failed');
const coordination=[...log.matchAll(/✓ (tests\/coordination\/[^\n]+?) \((\d+) tests?\)/g)].map(m=>({path:m[1],tests:Number(m[2])}));
const coordTests=coordination.reduce((n,x)=>n+x.tests,0);
json('test-results.json',{sourceFingerprint:snapshot.sourceFingerprintSha256,full:{files,tests,failed:0},coordination:{files:coordination.length,tests:coordTests,suites:coordination}});
const delta=JSON.parse(read(path.join(out,'preparation-to-delivery-diff.json'))),adopted=JSON.parse(read(path.join(out,'snap03-to-snap04-diff.json')));
const counts=d=>Object.fromEntries(['added','modified','removed'].map(k=>[k,d.changes.filter(x=>x.change===k).length]));
const dc=counts(delta),ac=counts(adopted);
const edit=(p,f)=>writeFileSync(p,f(read(p)));
edit(path.join(out,'handoff.md'),s=>s.replace('状态：五步补齐已实现，最终全量验证进行中。','状态：五步补齐已实现，冻结快照的实施侧验证已完成，交付待独立验收。').replace(/冻结源码：\d+ 文件，SHA256 [a-f0-9]+。/,'冻结源码：'+snapshot.sourceFileCount+' 文件，SHA256 '+snapshot.sourceFingerprintSha256+'。').replace(/相对实际接手 snap-03 的 \d+ 文件准确哈希差异，\d+ 新增\/\d+ 修改\/\d+ 删除/,'相对实际接手 snap-03 的 '+adopted.changes.length+' 文件准确哈希差异，'+ac.added+' 新增/'+ac.modified+' 修改/'+ac.removed+' 删除').replace(/准备基线：\d+ 新增\/\d+ 修改\/\d+ 删除/,'准备基线：'+dc.added+' 新增/'+dc.modified+' 修改/'+dc.removed+' 删除').replace('重新冻结后运行 build-final.log/full-final.log；只以最终日志作为交付回归。','重新冻结后的 full-final.log 完整运行，结果为 313 文件/2111 用例通过、1 条模块清单断言失败（漏列两个新文件）。该遗漏已修复，A02 样例纳入常规测试，并同步过时注释；再次冻结后 build-delivery.log/full-delivery.log 才是最终交付回归。'));
edit(path.join(out,'decision-log.md'),s=>s.replace('本轮完整保存 1240 文件原始字节','本轮完整保存 '+snapshot.sourceFileCount+' 文件原始字节').replace('源码中部分“第 3 工作段”注释保留了当时限制，当前协议以正式 Interface、PROTOCOL-CONSTRAINTS §4.11–4.14 与上述消费者为准。','已同步参与唯一性、持续路由与驱动预算的过时注释，当前协议见正式 Interface、PROTOCOL-CONSTRAINTS §4.11–4.14 与上述消费者。'));
edit(path.join(out,'coverage.md'),s=>s.replace('source-snapshot 的 1240 个逐文件哈希','source-snapshot 的 '+snapshot.sourceFileCount+' 个逐文件哈希'));
const summary='冻结源码 '+snapshot.sourceFileCount+' 文件，指纹 '+snapshot.sourceFingerprintSha256+'；最终全量 '+files+' 文件 / '+tests+' 用例通过、0 失败，类型 0 诊断、边界 issues 为空、当前构建与文档检查通过。以上是实施验证，尚无独立验收结论。';
edit(path.join(planning,'CM-1A-001-FOLLOWUP-PLAN.md'),s=>s.replace('**状态：已批准，实施中。**','**状态：五步实施交付，待独立验收；Gate A 未成立。**\n\n'+summary+' 交付入口：产品 evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04/handoff.md。'));
edit(path.join(planning,'CM-1A-001.md'),s=>s.replace('最终验证收口中，尚无独立验收结论','冻结快照实施验证已完成，尚无独立验收结论').replace('当前五步补齐已经实施，最终冻结回归收口中','当前五步补齐已经实施并形成 snap-04 冻结交付；'+summary));
edit(path.join(planning,'HANDOFF.md'),s=>s.replace('snap-04 最终验证收口中','snap-04 实施交付待独立验收'));
edit(path.join(docs,'human/module-status.md'),s=>s.replace('五步补齐，收尾验证中','五步实施交付，待独立验收').replace('当前验证日志在产品 evidence/collaboration-memory/CM-1A-001/implementation/continuation-04/。','最终交付日志在产品 evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04/。'+summary).replace('当前检查点将给出逐文件哈希与准确差异','当前检查点已给出逐文件哈希与准确差异'));
edit(path.join(root,'IMPLEMENTATION-HANDOFF.md'),s=>s.replace('最终验证与冻结快照收口中，日志位于 evidence/collaboration-memory/CM-1A-001/implementation/continuation-04/。旧交接原文已保存在该目录 product-handoff-before.md。',summary+' 交付位于 evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04/handoff.md；旧交接原文保存在 continuation-04/product-handoff-before.md。'));
writeFileSync(path.join(out,'verification.md'),[
'# CM1A-001-snap-04 实施验证','',summary,'','## 同一冻结源码上的结果','',
'| 检查 | 实际结果 | 日志 |','| --- | --- | --- |',
'| WSL 全量 bash scripts/test-wsl.sh --maxWorkers=4 | '+files+' 文件 / '+tests+' 用例通过；rc=0 | logs/full-delivery.log |',
'| 全量中 tests/coordination | '+coordination.length+' 文件 / '+coordTests+' 用例通过（全量子集，不重复计数） | test-results.json |',
'| 修正后的定向用例 | 4 文件 / 52 用例通过 | logs/correction-targeted.log |',
'| 内核权限与组合入口 | 2 文件 / 14 用例通过；rc=0 | logs/kernel-delivery.log |',
'| tsc --noEmit | rc=0，0 诊断 | logs/typecheck-delivery.log |',
'| Module 边界 | rc=0，issues=[] | logs/boundaries-delivery.json |',
'| pnpm build | rc=0，内核/平台/UI 当前构建 | logs/build-delivery.log |',
'| 文档验证（文档根，WSL） | rc=0 | logs/docs-delivery.log |',
'| 冻结前后源码复算 | 相同 SHA256；逐文件差异为空 | source-snapshot-after.json、logs/frozen-diff.json |',
'','## 重跑','','在 WSL 产品根 /mnt/d/1.project/Software/agent_platform 使用 Node 24 工具链：','','```bash',
'export PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH',
'node scripts/source-snapshot.mjs',
'node scripts/source-snapshot.mjs --diff evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04/source-snapshot.json',
'pnpm build','node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit','node scripts/check-module-boundaries.mjs',
'bash evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04/run-kernel-evidence.sh --maxWorkers=1',
'bash scripts/test-wsl.sh tests/coordination --maxWorkers=4','bash scripts/test-wsl.sh --maxWorkers=4',
'cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform','node dev_docs/verification/validate-docs.mjs','```','',
'测试运行器带真实 bubblewrap sandbox preflight；不可直接以 Windows Vitest 或裸 npx vitest 替代。隔离用例写临时 SQLite/Runtime/计数目录，测试清理负责回收。',
'','## 失败与预检记录','',
'- continuation-04/logs 保留接续实施期间的失败与修复日志；旧快照成功数不迁移。',
'- logs/full.log 为被中断的非最终预检（UI 构建验证有临时写源码的探针）。',
'- logs/full-final.log 完整结束但 1 条模块清单测试失败；对应 pre-correction-source-snapshot.json，不能作为最终 PASS。',
'- logs/material-isolation-01.log 是重复 --config 参数的运行器错误，无测试启动；material-isolation-02.log 使用同一 test-wsl preflight 的隔离 wrapper，1 用例通过。随后移入 tests/coordination/material-isolation.test.ts，并由正式全量重跑。',
'- logs/kernel-probe-01.log 的组合测试失败来自在平台根解析 resources/skills；内核 wrapper 保留 test-wsl sandbox preflight，并进入 vendor/coding-agent 根后使用该内核的测试目录，最终 14/14 通过。',
'- assemble-evidence-01..07 是基线字节/行尾/Unicode 路径还原的中间诊断；最终重建严格匹配准备基线，见 preparation-reconstruction.json。','',
'本票无真实远端 provider ack、真实模型质量、长期压测或完整浏览器业务验收声明；具体边界见 coverage.md。Gate A 与 A01–A12 独立结论仍待另一验收方。',''
].join('\n'));
const walk=(dir,base=dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),base):[{path:path.relative(base,path.join(dir,e.name)).split(path.sep).join('/'),sha256:sha(readFileSync(path.join(dir,e.name))),bytes:statSync(path.join(dir,e.name)).size}]).sort((a,b)=>a.path<b.path?-1:1);
const tree=dir=>{const files=walk(path.join(root,dir)),fold=createHash('sha256');for(const f of files)fold.update(f.path+'\0'+f.sha256+'\n');return {directory:dir,files,fingerprint:fold.digest('hex')};};
json('build-origin.json',{sourceFingerprint:snapshot.sourceFingerprintSha256,head:snapshot.head,capturedAt:new Date().toISOString(),toolVersions:{node:'v24.18.0',pnpm:'11.21.0',git:'2.43.0',platform:'WSL/Linux'},buildCommand:'pnpm build',buildLogSha256:sha(readFileSync(path.join(out,'logs/build-delivery.log'))),kernelUpstreamSha256:sha(readFileSync(path.join(root,'vendor/coding-agent/UPSTREAM.json'))),trees:[tree('dist'),tree('vendor/coding-agent/dist')]});
writeFileSync(path.join(out,'build-verification.md'),'# CM1A-001-snap-04 构建来源\n\n当前冻结源码通过 pnpm build（内核 build、平台 tsc、旧 UI 复制、React/Vite 构建），日志为 logs/build-delivery.log，退出码 0。完整产物逐文件 SHA256 与树指纹见 build-origin.json。\n\n此前 pnpm verify:ui-build 与 pnpm ui:typecheck 实测成功（logs/ui-build.log、logs/ui-typecheck.log、logs/ui.exit-code），验证了构建后 HTTP 返回的资源字节与磁盘一致。该脚本会临时写 UI 探针并在 finally 恢复源码及构建，故运行于正式冻结回归之前；没有把探针期间的测试作为本快照最终证据。当前代码再次完整构建。\n\n本轮未运行完整 Playwright UI 业务套件；构建/服务资源一致性不替代整批 I 票的浏览器验收。UPSTREAM.json 未变，vendor 本地适配记录在 INTEGRATION.md。\n');
console.log(JSON.stringify({sourceFingerprint:snapshot.sourceFingerprintSha256,files,tests,coordination:coordination.length,baselineChanges:dc,adoptedChanges:ac}));
