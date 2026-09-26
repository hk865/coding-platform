执行授权：骨架已独审导入，目标 3 项首红于完成入口、18 必要邻接和 types 通过。现在从最新 main prepare 后执行下列五生产文件实现。

# R3e.3 Task / Goal 正式完成：第二阶段实现

2026-09-26，派工准备。承接 [骨架任务](R3e-task-goal-completion-skeleton.md)；唯一行为与接口依据为 [主任务 §9](R3e-completion-skeleton.md#9-r3e3-首批派工冻结机械证据到正式-taskgoal-完成)，§7/§7.1 保留历史与正式完成语义。骨架 candidate 已 STOP，三个目标均到新增完成入口 unsupported；组合正常前态已真实执行 work 与 gate 各自的注册检查并 finalize。主审独立检查、导入骨架后才能从 fresh main prepare；本文件不派工，不声明正式完成已交付。

本批优先让真实 `checks → finalize → completeTask(work/gate) → completeGoal → queryTaskGraph` 正常路径可跑。保留用户两阶段流程；不为覆盖更漂亮新增测试、审阅轮次或异常矩阵。先读 docs/AGENTS.md、当前 HANDOFF、CODE-QUALITY-GUIDELINES §2.1、DSH-EXECUTION-HARNESS 及主任务 §9。

## 唯一五生产文件

精确白名单见 [implementation scope](R3e-task-goal-completion-implementation-scope.json)，路径相对 `coding-platform/next/`：

| 文件 | 实现职责 |
| --- | --- |
| `src/core/work-graph/tasks/completion.ts` | 原 Goal service 两入口的 Host 受理、原回执、局部事实与 CAS、唯一 fold 调用、一次正式提交 |
| `src/core/work-graph/tasks/completion-policy.ts` | 冻结两纯函数；从现有 evidence fold 与 canonical facts 判断 Task satisfied / Goal COMPLETED |
| `src/core/work-graph/tasks/completion-record-codecs.ts` | TaskReduction 编码、GoalPhase 编解码、两完成事件与精确重放结果；完成新 schema 注册集合 |
| `src/core/work-graph/tasks/plan-readers.ts` | 实现精确 GoalPhase reader，保留原 TaskReduction schema owner、已接 audit 校验及既有事实 maps |
| `src/core/work-graph/tasks/plan-service.ts` | 原 queryTaskGraph 增加精确 GoalPhase 点读投影与现有 cursor 语义 |

其余全部只读。特别是 contracts、tasks/contracts.ts、plan-contracts.ts、task-service.ts、composition/create-platform.ts、全部 tests/helpers、R3e.1 producer 五文件、检查脚本、Kernel、Workspace/Material/Query 均不开放。task-service 已在唯一服务接好两入口，composition 已接同一 records、trackedCall/close 和 COMPLETION_RECORD_SCHEMAS 数组，均无需再改。不新增产品文件、Port、数据库、manager、轮询或模型循环，不安装依赖。接口确有缺口时只报告具体符号，不扩大白名单。

主审已授权的唯一测试前提纠正为 R3e fixture 第二可选 additionalSchemas 透传及新领域测试传入 COMPLETION_RECORD_SCHEMAS；既有默认行为不变。该纠正与骨架由主审审核导入，实施 lane 中 fixture 和两目标测试转只读。不得通过改测试、伪造 schema、raw seed PASS/Reduction 或跳过真实 sandbox 让结果变绿。

## 实现要求

1. **同一 owner、原身份与原回执。** `completeTaskFromHost` / `completeGoalFromHost` 沿冻结 CompletionDependencies 使用唯一 records。固定本次输入与真实 Host actor/scope，按原 identity/fingerprint 先恢复 receipt/eventAt；fresh 再核 Goal/Workspace、采用 Plan、Task/round 完整身份及必要 expected。Task caller pins 为 Goal + TaskReduction，Goal caller pins 为 Goal + GoalPhase，首次目标版本 0。原请求重放返回原值/cursor，不由当前状态拼造；commit 失联沿现 lookupCommit/eventAt 协议确认，仍未知则 unavailable，不猜未提交、不抹掉历史事实。
2. **消费既有正式证据，不重建生产链。** 从指定 finalized round、该 Task 的 TaskEvidenceIndex 及精确 Evidence refs 读取真实记录；复用 `evidence-record-codecs.ts` 的三个 decoder，以及 `coverage.ts::evidenceApplicabilityWithBasis`、`evidenceBindingFor`、`selectEffectiveEvidenceSet`。精确采用 Plan / task basis / 原政策 pin，复用 `readPinnedCompletionPolicy` 与原 basis/origin reader；不能只凭 round PASS，也不能用当前 active policy 把旧报告升格。不再启动检查、打开正文、重新捕获磁盘或全局扫描来源。完成采用具体已完成检查快照，不宣称重新证明磁盘此刻未变。
3. **正常满足与真实未完成。** 普通 ended Run 本身不是 PASS；其正式检查 Evidence 才贡献覆盖。直接消费 canonical reader 已返回的所有实际 Run、Lease、Reduction；未知或未对账副作用、运行中或有效 lease 阻止完成，不能只看 preferRun。requirement key 使用 obligationId + requirementId。沿唯一 evidence fold 保留适用 FAIL/INCONCLUSIVE blocker，本批不猜 supersession。没有要求 reviewer 的机械正常路径不增加前提；要求 reviewer 但无正式 producer 时 incomplete。required plan_only/deferred/未验收保持未完成；optional future 节点不阻止 Goal 完成，也不能从图删除。
4. **gate 与正式写入。** gate 使用自身 subject 的独立 round/Evidence，引用同 Goal 已 ended 的真实普通 producer Run；核真实身份与终态，不 claim 或造 gate Run。Task 只写 satisfied TaskReduction（带全部旧字段和必填 completion audit）/TaskCompleted event/receipt；Goal 只写 COMPLETED GoalPhase/GoalCompleted event/receipt。各操作一次 commit，沿原局部 guard 集合覆盖所读 Goal、Plan、Run、Lease、Reduction、round/index/Evidence/政策等实际版本或缺席；不以全账本 cursor 作 CAS，不另写 blocked/failed reduction，不推进 Workflow。
5. **唯一 schema 与无环读取。** COMPLETION_RECORD_SCHEMAS 仅注册 GoalPhaseSnapshot@1 与 TaskCompleted@1/GoalCompleted@1；TaskReductionSnapshot@1 仍仅原 PLAN_STATE_RECORD_SCHEMAS 注册。新编码及事件保留完整 result、actor、identity/fingerprint，decoder 真校验，不接受假 decoded。`plan-readers → completion-record-codecs` 是单向运行时边；codecs 不运行时反向依赖 reader/completion/service，纯 DTO 使用 type-only，不为解环新增层。
6. **只读投影保持轻量。** 原 Task phase 继续 canonical reader。queryTaskGraph 授权/Goal 存在性之后仅对 GoalPhase 精确点读一次，纳入原 sourceCursor/atLeastCursor 窗口；无记录为 not_recorded，正式 snapshot 原样返回，selectedPlanMatches 比较完整所选 Plan ref。普通查询不重新执行完成权限链、政策读取或 evidence fold，历史 Plan 不冒领另一个 Plan 的完成。

## 检查与停止

冻结目标 `next-completion` 两文件共三个 case。必要邻接限 `next-plan` 与 `next-evidence`（本次修改 reader / 公开 goals 接缝所影响的既有集合）；执行 `next-types`、`next-architecture`。主审已处理旧 evidence 组合测试对 completeTask 不存在的过时断言，不据此改其他测试。不得机械追加整个运行时、Kernel 或全仓矩阵；完整隔离由主审整合后组织。

须实际跑通两组正常链及关闭重开原回执，诚实报告到达步骤和任何真实环境阻塞。交付五文件 SHA-256、检查结果和已完成消费者路径后立即 STOP；不自行导入 main、不宣称 reviewer/witness、正式重开控制、Workflow、Query 或完整 Host 入口已完成。
