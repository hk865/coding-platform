# src/core/work-graph/evidence：证据与验证轮的唯一写入 owner，编译检查计划并折出可核对证据

## 负责什么，不负责什么

- 负责 L6 证据与验证轮：`openVerification` 读已采纳的 Goal/Plan/subject Run，捕获真实 workspace source，编译钉住的 `VerificationPlan` 并登记 pending checks；`beginCheck`、`recordCheckResult`、`abandonCheck`、`interruptCheck`、`finalizeChecks` 推进检查与轮次。
- 负责证据适用性的落点与检查计划的收口：finalize 按状态机的顺序折 coverage，一个 commit 写 round + Evidence + TaskEvidenceIndex + 事件 + receipt；纯规则复用 `tasks/evidence-coverage.ts`。
- 依赖方向：允许 `model, state, persistence, architecture, tasks, notes`（WorkGraph 顶层还允许 `RecordStore`、`WorkspaceTools`）。不得 import `queries/sessions`、`communication/views`、`agent-runtime`、`app`/`business`/`composition`。
- 状态迁移只经 `state/verification-machine.ts`；本层只读事实、捕获 source、生成 effects，不手改受保护字段（根 AGENTS 第 9 条）。
- 不负责 Task/Goal 完成裁决：那在 `tasks/completion.ts` 的 `completeTaskFromHost`/`completeGoalFromHost` 与完成策略归约里。本层不判完成，也不释放或推进 Task/Run/Session。
- 不负责：通用编解码与 store 失败映射（`persistence/`）、纯状态机（`state/`）、UI 读模型（`views/`）。

## 文件

- `evidence-service.ts` — 唯一可信 Evidence/verification 服务：开启与读取轮次、检查执行与结果、finalize、后继轮与链头读取。
- `verification-plan.ts` — 确定性、内容寻址的 `VerificationPlan` 纯编译器；同 tuple 同 digest，不读 store。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createEvidenceService` | `src/core/work-graph/evidence/evidence-service.ts:832` | 构造 `EvidencePort` 的单一实现，依赖全部由组合根注入 | 组合根接线；不要另写证据服务 |
| `openVerification` | `src/core/work-graph/evidence/evidence-service.ts:995` | 读 subject Run 与已采纳 Plan、捕获固定 source、编译计划、按轮次 revision CAS 登记 pending checks | Run 结束开检查；一个 subject 只开一条轮次链 |
| `readVerification`、`queryOriginalVerification`、`queryRoundChainHead` | `src/core/work-graph/evidence/evidence-service.ts:1163`、`src/core/work-graph/evidence/evidence-service.ts:1220`、`src/core/work-graph/evidence/evidence-service.ts:1185` | 读一轮、读某 work Run 的原轮链头、读某 subject 的链头 | 启动恢复与完成读取；读不到不是“没有轮” |
| `beginCheck`、`recordCheckResult`、`abandonCheck`、`interruptCheck` | `src/core/work-graph/evidence/evidence-service.ts:1238`、`src/core/work-graph/evidence/evidence-service.ts:1316`、`src/core/work-graph/evidence/evidence-service.ts:1460`、`src/core/work-graph/evidence/evidence-service.ts:1464` | 检查 pending→executing 并冻结 ticket、记录真实观察/未启动/中断 | 检查 runner 与 Host 记录结果 |
| `finalizeChecks` | `src/core/work-graph/evidence/evidence-service.ts:1468` | 折冻结 coverage，一次 commit 写 round + Evidence + 索引 + 事件 + receipt；未覆盖/阻塞进 gaps，不当 PASS | 轮次收口；不伪造 PASS |
| `reverifyRound` | `src/core/work-graph/evidence/evidence-service.ts:1816` | 在 finalized 非 PASS 链头上开后继轮，或提交一条策略拒绝；接受可选 `acknowledgement`，提交结果带 `proofReceipt` | 自动复核/返工；不要另开第二轮 |
| `compileVerificationPlan` | `src/core/work-graph/evidence/verification-plan.ts:61` | 纯编译：每个必需要求绑定可覆盖的冻结能力，缺覆盖记 `uncovered`，空必需集 `invalid`，不接受调用方 digest/coverage/PASS | open/reverify 冻结检查计划 |
| `evidenceApplicabilityWithBasis`、`selectEffectiveEvidenceSet` | `src/core/work-graph/tasks/evidence-coverage.ts:153`、`src/core/work-graph/tasks/evidence-coverage.ts:76` | 证据适用性判定与有效证据的单一纯折叠 | finalize 与完成读取；不要在本层重算 applicability |
| `sameRef` **正本** | `src/core/work-graph/state/ref-equality.ts:2` | 引用的结构判等；不是 `sameJson` 的等价物 | 证据 commit 组装；执行入口的 `sameJson as sameRef` 转出已删除，F 行副本直接用 `src/contracts/fingerprint.ts:50` 的 `sameJson` |
| `mergeGuards`、`mapStoreFailure` | `src/core/work-graph/persistence/record-guards.ts:12`、`src/core/work-graph/tasks/execution-entry-service.ts:148` | 合并一个 commit 的读 guards、把执行写失败映射成 `CoreRejection` | 证据 commit 组装（M1-27、M1-30、M1-32） |
| `bindTrustedContext`、`isolateWrite` | `src/core/work-graph/tasks/execution-entry-service.ts:208`、`src/core/work-graph/tasks/execution-entry-service.ts:216` | 绑定可信 Host 上下文并同步隔离写入请求 | 每个证据写入入口；不要另写绑定与检查顺序 |

## 内部用

- 本文件夹的两个值导出（`createEvidenceService`、`compileVerificationPlan`）都在上表，其余导出是类型。
- `lookupReceipt` 是本层的私有包装（`src/core/work-graph/evidence/evidence-service.ts:465`），只在提交前/提交抛错后经 `GoalRecordTransactionPort.lookupCommit` 查回执；它不是 `src/core/record-store/ports.ts` 的导出。同类私有包装还在 `src/core/work-graph/queries/query-job-service.ts:418`、`src/core/work-graph/tasks/completion.ts:174`，按各 owner 的代码使用，收拢前不要编造共享端口。

## 不要做

- 不要在本层判 Task/Goal 完成：完成归约在 `tasks/completion.ts`；本层不调用 `completeTaskFromHost`/`completeGoalFromHost`，也不从 Run 终态推完成。
- 不要伪造 PASS，或把缺失/阻塞的检查折成通过：必需义务无必需要求是 `invalid`，必需要求无覆盖能力记 `uncovered`，读失败原样返回（FP-05、M1-12、MH-06）。
- 不要另写证据适用性或有效证据折叠：用 `evidenceApplicabilityWithBasis`、`selectEffectiveEvidenceSet`；不要从 Plan、列表顺序或时间猜 supersession。
- 不要绕过 `state/verification-machine.ts` 手改 round/check/index 的受保护字段；轮次与检查写入都由机器决定并一个 commit 写齐（M1-01、M1-36）。
- 不要 import `queries/sessions`、`communication/views`、`agent-runtime`、`app`/`business`/`composition`，也不要另写 RecordStore 事务、store 失败映射或 guard 合并；用注入的 `records` 与 `mapStoreFailure`、`mergeGuards` 等既有缝（M1-27、M1-30）。
- 不要把不可读的 source、配置或链头当成“没有轮次”或空证据；`incomplete`/`unavailable` 原样返回，未知窗口只能等待。
