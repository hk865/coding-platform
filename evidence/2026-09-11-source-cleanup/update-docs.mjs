import fs from 'node:fs';import path from 'node:path';
const root='evidence/2026-09-11-source-cleanup',docs='../agent_learn/agent_dev/agent_platform';
function edit(f,fn){const s=fs.readFileSync(f,'utf8'),n=fn(s);if(n===s)return;const rel=f.startsWith(docs)?'docs/'+path.relative(docs,f).replaceAll('\\','/'):f;const h=root+'/history/'+rel+'.txt';if(!fs.existsSync(h)){fs.mkdirSync(path.dirname(h),{recursive:true});fs.copyFileSync(f,h);}fs.writeFileSync(f+'.cleanup-tmp',n,{flag:'wx'});fs.renameSync(f+'.cleanup-tmp',f);}
edit('src/contracts/README.md',s=>s.replace('fixtures/ 与 testing/ 是示例和替身；修改契约须同步正式 Interface、实际消费者与回归。',`按真实跨 Module 消费者保留协议。调用者直接导入所属协议文件，不再通过无消费者的根 barrel；不为目录整理新增业务层级。

- 反馈与补料：[execution-feedback.ts](execution-feedback.ts)、[query-job.ts](query-job.ts)、[runtime-context-materials.ts](runtime-context-materials.ts)。
- 协调与返工：[planning.ts](planning.ts)（含影响报告工作身份材料）、[rework.ts](rework.ts)、[rework-drive.ts](rework-drive.ts)、[rework-acceptance.ts](rework-acceptance.ts)。
- 验证与正式资格：[verification-service.ts](verification-service.ts)、[verification-round.ts](verification-round.ts)、[evidence.ts](evidence.ts)、[reduction.ts](reduction.ts)。

仅供测试的构造器和替身在 [tests/contract-support](../../tests/contract-support)；宿主实际消费的启动样例在 [src/fixtures](../fixtures)，确定性依赖与检查替身在 [src/testing](../testing)。它们保留明确消费者与原默认值，不作为公共业务协议导出。StateLedger 的提交结构校验位于 [ledger-validation.ts](../data/state-ledger/ledger-validation.ts)，Verification 的构造依赖位于 [verification-deps.ts](../control/verification-engine/verification-deps.ts)。

持久字段和 HTTP wire 形状不因内部路径迁移改变；新增公共导出需说明真实跨模块消费者。私有包没有已登记的外部 deep-import 兼容承诺。`));
edit('src/harness/README.md',s=>s.replace('两个宿主都暴露 RW-06 的返工触发面','两个宿主都暴露返工触发面').replace('## 修改与验证入口',`[query-composition.ts](query-composition.ts) 统一 Query 授权提交后推进投影的接线；内存宿主仍每次 drive 创建实例，持久宿主仍每个宿主实例保留一个驱动。[rework-composition.ts](rework-composition.ts) 先从 Verification 取得材料再传入 Dispatch；两者都只组合，不迁移业务守卫。

## 修改与验证入口`));
edit('src/control/plan-compiler/README.md',s=>s.replace('- [rework-plan-compiler.ts](rework-plan-compiler.ts)：由未处置验证问题推导返工提案（ADR 0003 D1）',`- [execution-feedback-compiler.ts](execution-feedback-compiler.ts)：公开执行反馈进入只读协调 Query。
- [rework-plan-compiler.ts](rework-plan-compiler.ts)：校验当前问题、去重并按义务承担者分组。
- [rework-proposal.ts](rework-proposal.ts)：模块内组装返工任务指令、影响与草稿；不负责受理。`));
edit('src/control/verification-engine/README.md',s=>s.replace('- [verification-service.ts](verification-service.ts)：','- [verification-deps.ts](verification-deps.ts)：仅模块内部使用的构造依赖；公共生命周期与报告形状仍在 contracts。\n- [rework-verification.ts](rework-verification.ts)：正式返工来源的工具重验与必要 Reviewer 准备。\n- [verification-service.ts](verification-service.ts)：'));
edit('src/data/state-ledger/README.md',s=>s.replace('- [governance-records.ts]', '- [ledger-validation.ts](ledger-validation.ts)：两种适配器共用的提交结构校验；原事件/快照/CAS 规则不变。\n- [governance-records.ts]'));
edit(docs+'/dev_docs/modules/data/state-ledger.md',s=>s.replaceAll('src/contracts/ledger-validation.ts','src/data/state-ledger/ledger-validation.ts'));
edit(docs+'/dev_docs/modules/control/plan-compiler.md',s=>s.replace('## 当前源码边界（2026-09-11）','## 当前源码边界（2026-09-11）\n\n返工纯编译分为 `rework-plan-compiler.ts` 的输入校验/分组与 `rework-proposal.ts` 的任务指令/影响/草稿组装；两者同属 PlanCompiler，继续复用 Control 的义务、任务集和 DAG 权威规则。`PlanningTaskWorkMaterial` 与协调材料协议共同定义在 `contracts/planning.ts`。'));
edit(docs+'/dev_docs/modules/control/verification-engine.md',s=>s.replace('独立审阅本身未在本票实现。','独立审阅由下述 Reviewer 流程承担，工具轮次不替代 Reviewer 资格。').replace('最新版本自动重验、再次独立审阅与最终归约闭环仍未完成。','正式返工已接当前版本工具重验及必要 Reviewer 准备，并已证明单任务工具重验至 Task 归约；同一任务的必要重审联合链、连续失败和中途恢复仍待完整验收。').replace('`verification-engine.ts` 与 `verification-service.ts` 组织','`verification-deps.ts` 保存仅模块内部使用的构造依赖；公共生命周期和报告 wire 仍在 `contracts/verification-service.ts`。\n\n`verification-engine.ts` 与 `verification-service.ts` 组织'));
edit(docs+'/dev_docs/interfaces/module-boundaries.md',s=>s.replace('更新：2026-09-10。','更新：2026-09-11。').replace('`src/control/control-engine/`、`src/control/control-engine/`','`src/control/control-engine/`、`src/control/plan-compiler/`').replace('| Module | 目录 | 目录内文件数 |','| Module | 目录 |').replace('| --- | --- | --- |','| --- | --- |').replace(/^(\| (?:ControlEngine|PlanCompiler|DispatchEngine|VerificationEngine|ArchitectureReconciler|HumanCollaboration|WorkerRuntime|StateLedger|ArtifactVault|ReadModelIndex|ContextCompiler|WorkspaceReader) \| `src\/[^`]+` \|) \d+ \|$/gm,'$1').replace('## 组合根、样例与检查',`## 源码契约归属

公共契约按实际消费者保留，移除无消费者的根 barrel。影响报告工作身份材料并入 planning 协议；Verification 构造依赖回到本 Module，StateLedger 提交结构校验回到两个适配器共同使用的内部文件。持久字段、HTTP 路由/响应及正式权限不变。

返工编译器分为输入检查与提案组装；Control 保持受理、义务与 DAG 推导权威。宿主的 Query 授权后投影接线共用 query-composition，实例生命周期保留原差异。运行结束和启动扫描仍经 app/service.ts 的 continueEndedRun 进入反馈调查与正式重验；未新增语义 FAIL 改计划能力。

## 组合根、样例与检查`).replace('明确命名的 Fake Adapter 和样例场景继续用于合同/演示测试','纯测试构造器位于 tests/contract-support；生产默认样例位于 src/fixtures，显式测试依赖位于 src/testing，仍属原 Fixtures/TestDoubles 非 Module 表面，消费者白名单不扩大。明确命名的 Fake Adapter 和样例场景继续用于合同/演示测试'));
console.log('Current module and source routing documents updated.');
