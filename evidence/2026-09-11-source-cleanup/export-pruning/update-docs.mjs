import fs from 'node:fs';
import path from 'node:path';
const root='evidence/2026-09-11-source-cleanup/export-pruning',docs='../agent_learn/agent_dev/agent_platform';
function edit(file,replacements){const original=fs.readFileSync(file,'utf8');let body=original;
 for(const [from,to]of replacements){if(!body.includes(from))throw Error(`Expected text missing in ${file}`);body=body.replace(from,to);}
 const rel=file.startsWith(docs)?`docs/${path.relative(docs,file).replaceAll('\\','/')}`:file,archive=`${root}/history/${rel}.txt`;
 if(!fs.existsSync(archive)){fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,original,{flag:'wx'});}
 fs.writeFileSync(`${file}.cleanup-tmp`,body,{flag:'wx'});fs.renameSync(`${file}.cleanup-tmp`,file);
}
edit('src/fixtures/plan-fixtures.ts',[
 ['P1-02 shared fixture: hand-authored PlanRevision.','Shared fixture: hand-authored PlanRevision.'],
 ['Frozen structure (see IMPLEMENTATION-HANDOFF.md "P1-02 契约与存储语义"):','Plan structure and admission constraints:'],
 ['four ORTHOGONAL dimensions) / AcceptanceObligation / GateTask (a gate is','four ORTHOGONAL dimensions) / AcceptanceObligation / gate tasks (a gate is'],
]);
edit('tests/app/plan-changes.test.ts',[
 ['RW-09 真实 HTTP：受理结果在界面上真正可见。','真实 HTTP：受理结果在界面上真正可见。'],
 ['HumanCollaboration.GoalChangePort.decide/applyChange','HumanCollaboration.decide/applyChange'],
]);
edit('src/contracts/README.md',[
 ['持久字段和 HTTP wire 形状不因内部路径迁移改变；','公开命名导出只保留真实跨文件消费者需要的入口；只作为同文件结果成员的子类型保留定义与字段但不额外导出。不存在消费者的 GoalChangePort/PublicSnapshotPort 已删除：前者的正式调用形状由 modules.ts 的 HumanCollaboration 定义，后者的真实快照路径由 query-job.ts 的 SnapshotPort 定义。ports.ts 不再转导出 Artifact/TaskContext/DispatchIntent。\n\nVerification 的编译输入/结果与补丁检查注入类型位于该模块实现，Context 的 CoordinationSourcePort 位于 query-execution-context.ts；这些内部接口不属于跨 Module 公共协议。\n\n持久字段和 HTTP wire 形状不因内部路径迁移改变；'],
]);
edit('src/control/verification-engine/README.md',[
 ['精确契约见 [verification-source.ts](../../contracts/verification-source.ts)。','跨 Module 来源契约见 [verification-source.ts](../../contracts/verification-source.ts)；仅本 Module 使用的 CandidatePatchCheckPort 位于 [candidate-patch-check.ts](candidate-patch-check.ts)。'],
 ['## 修改与验证入口','内部确定性检查计划编译的 VerificationPlanCompileInput/Result/RejectionCode 在 [verification-plan-compiler.ts](verification-plan-compiler.ts) 定义，公开 VerificationPlanV1 和 verify 请求/结果仍在共享契约。编译器内部类型不对外形成另一套模块协议。\n\n## 修改与验证入口'],
]);
edit(`${docs}/dev_docs/interfaces/module-boundaries.md`,[
 ['这些子目录不是新增 Module，也不扩大依赖图。','这些子目录不是新增 Module，也不扩大依赖图。\n\n公共命名导出按真实消费者收窄：无消费者的 GoalChangePort/PublicSnapshotPort 旧门面、RuntimeEvent/GateTask 旧别名、Reviewer clone-only 命令包装等已移除，正式 HumanCollaboration 与 SnapshotPort 继续负责真实调用。仅作为同文件结果成员使用的类型保留字段但不再单独导出。Verification 的编译输入/结果/拒绝码与 CandidatePatchCheckPort 回到本 Module；CoordinationSourcePort 回到 ContextCompiler。取消 named export 不改变外层公开结果、序列化字段或权限规则。'],
]);
