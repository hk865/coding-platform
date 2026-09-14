# ControlEngine Module

> 当前代码与接线评价见 [模块审计](../../../human/module-status.md) 的对应条目。本页保留职责、Interface 要求及明确标注的首切片约定；旧切片状态不能代替当前实现结论。


```yaml
status: draft
updated: 2026-09-11
slice: 创建 Goal → 持久化 → 投影显示
plane: Control
```

## Purpose

ControlEngine 是 canonical 状态转换与授权的唯一受理方。当前入口覆盖目标、计划、证据、角色、派发事实与返工等正式命令；精确当前责任见下方“当前源码边界”。2026-09-05 [设计复核](../../design/human-framework-role-review.md) 及下方 CreateGoal 局部约定描述首切片，不限制当前入口集合。

`ControlEngine` 是 canonical state 的唯一 transition authority。首个创建切片接受 `CreateGoal`，执行领域
guard，并把 Domain Event、Goal snapshot 与幂等结果作为一个原子提交交给 `StateLedger`。

## Interface

角色绑定、消息路由、运行报告和协调工作请求遵循 [运行时协作 Interface](../../interfaces/runtime-collaboration.md)。`submit` 形状不变，扩展 command／snapshot／event 必须按版本定义。语义职责属于 Control Plane，但不在本 Module reducer 中执行；依赖仍指向 StateLedger。

```ts
interface ControlEngine {
  submit(command: CommandEnvelope): Promise<CommandReceipt>;
}
```

Interface 返回 durable receipt，不返回 UI View。未知 command type、未知 schema version 或不满足 guard
均返回结构化 rejection，且不产生部分写入。

## Hidden Implementation

Implementation 隐藏：command dispatch、schema 校验、旧 snapshot 读取、领域 guard、CommandFingerprint、
`old snapshots + Command → new GoalSnapshot + GoalCreatedEvent` 的确定性 fold，以及
`StateLedger.commit` 的 expected-version 集合构造。StateLedger 不参与该 fold。

`CreateGoal` 按 [StateLedger Interface](../../interfaces/state-ledger.md) 构造
`ProjectRef(projectId)`、`WorkspaceRef(projectId, workspaceId)` 与 `GoalRef(projectId, goalId)`；这里的
`goalId` 来自 `command.aggregateId`。任何 load、guard、CAS 或 snapshot 都使用完整 Ref。

`CreateGoal` 不需要 Planner 或模型调用；所有输出由确定性规则生成。

## Dependencies

- Command/Event 类型只使用[Command/Event Interface](../../interfaces/command-event.md)；
- snapshot、commit 与 EventPage 只使用[StateLedger Interface](../../interfaces/state-ledger.md)；
- 只通过 [`StateLedger.Interface`](../data/state-ledger.md#interface) 读取与提交；
- clock、ID 生成器和 StateLedger Adapter 由调用方注入，不在 Implementation 内自行创建；
- 不依赖 Human Interaction、Read Model 或具体数据库。

## Invariants

### Global

- 只有 Control 可以把 Command 归约为 canonical state transition；
- 每次 transition 都受 schema、idempotency 与 expected revision 约束；
- Event、canonical snapshot、幂等记录和 outbox intent 必须原子提交；
- Read Model 永远不是 guard 输入或写入目标。

### Local

- `CreateGoalCommand.expectedRevision` 必须为 `0`，且 `aggregateId` 指向的 Goal 尚不存在；
- Goal 不存在 guard 使用 `(identity.projectId, aggregateId)`；不同 Project 的相同 `aggregateId` 是不同 Goal；
- Project 与 Workspace 必须存在，且 Workspace 属于该 Project；
- objective 规范化后不得为空；
- 成功只产生一个 revision `1` 的 Goal snapshot 和一个 `GoalCreated` Event；
- 新 Goal 的 `activePlanRevision = null`；本切片不暗中创建 Plan、Task、Run 或 outbox action；
- rejection 不产生 Event；相同 CommandIdentity/fingerprint 返回相同 durable outcome，同 identity 异
  fingerprint 拒绝；
- restart 直接加载 StateLedger 已提交的 canonical snapshot；只有 Control reducer 可以重新 fold Event。

## Test seam

从 `submit` 进入，使用满足 [StateLedger Interface](../../interfaces/state-ledger.md) 的 in-memory Adapter。
表驱动覆盖所有 guard、重复与冲突请求、引用 aggregate 在提交前变化导致的 CAS 冲突、Event/snapshot
revision 对齐、deterministic fold，以及失败零写入。
用两个 Project 复用相同 `workspaceId/goalId` 的 fixture 验证 Ref 构造、load 与 CAS 互不串扰。
测试不读取 ControlEngine 内部 reducer 或 handler。

## Explicitly not responsible

- 不解释自然语言或渲染用户反馈；
- 不实现持久化、投影索引或 UI 查询；
- 不规划 Task、调度 Worker、验证完成或运行工具；
- 不把资源不足、投影延迟或 Adapter 故障改写成业务失败。

## Context load

默认只装载：本文件、[Command/Event Interface](../../interfaces/command-event.md)、
[StateLedger Interface](../../interfaces/state-ledger.md)、当前 Ticket，以及仅在需要调用细节时装载
[`StateLedger.Interface`](../data/state-ledger.md#interface) 小节。仅在术语冲突时读取
[`CONTEXT.md`](../../../CONTEXT.md) 的 Goal/Project/Workspace 条目；不装载 StateLedger Implementation、
Human Interaction 文档、完整产品定义或其他 Plane。

## P1-00 extension record：bootstrap

2026-09-05 [P1-00](../../planning/proposed/P1-foundation/tickets/00-contract-pack.md) 版本化扩展接口：`submit` 形状不变；新增

```ts
bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
```

- bootstrap 只接受空 Ledger（仅空库首次初始化），其幂等判定（同 identity+fingerprint 重放）先于空库检查，由 StateLedger.commit 原子执行；
- 校验失败的 rejection code：`invalid | digest_mismatch | not_empty | idempotency_conflict | unavailable`，全部零写入；
- bootstrap 产物（entry snapshot/审计 Event/BootstrapManifest snapshot）确定性生成，重放时经 manifest snapshot 重建，同一 fixture 的 manifest 一致；
- 契约类型见 [Command/Event Interface](../../interfaces/command-event.md) 与 [StateLedger Interface](../../interfaces/state-ledger.md) 的 P1-00 扩展记录。
## P1-04 extension record：submitEvidence / reduceTask

2026-09-05 [P1-04](../../planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md) 版本化扩展：ControlEngine 接口新增 `submitEvidence`、`reduceTask`（submit/bootstrap 形状不变）。实现分派到两个独立入口文件（src/control/control-engine/evidence-intake.ts、src/control/control-engine/task-reducer.ts），ControlEngineImpl 仅委托；Evidence 不可变追加/完整幂等/CAS、纯函数 TaskSatisfied 公式与零写入语义见 HANDOFF「P1-04 契约与存储语义（冻结）」；**控制是唯一写 TaskReduction phase 者，本票不归约 Goal（P1-05）**。
## P1-02 extension record：install / activate / applyPlan

2026-09-05 [P1-02](../../planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md) 版本化扩展：`submit`/`bootstrap` 形状不变；ControlEngine 接口新增 `install`、`activate`、`applyPlan`。
实现分派到三个独立入口文件（src/control/control-engine/governance-install.ts、governance-activate.ts、plan-acceptance.ts），ControlEngineImpl 仅做委托；pre-CAS 引用解析（目标已安装、active refs 解析）、guard 顺序与零写入语义见 HANDOFF 冻结清单。HumanCollaboration 面向用户的 Plan 提交入口留给状态台/完整协作票（P1-08/15），本票经 ControlEngine 直接消费票据命令。

## P1-03 extension record：dispatch / run 入口

2026-09-05 [P1-03](../../planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 版本化扩展：接口新增 dispatchReadiness、claimTask、startRun、runFact（submit/bootstrap 形状不变）。实现分派到 src/control/control-engine/{readiness,claim,start-run,run-facts}.ts，ControlEngineImpl 仅委托；readiness 零写、claim 单次 CAS 唯一领取、durable outbox 与事件同原子提交；eligibility 的 depends_on 满足以 TaskReduction live phase 为准（dispatch-facts.loadLivePlan，P1-07 起；签名不变）。
## P1-05 extension record：reduceGoal / goal phase 查询

2026-09-06 [P1-05](../../planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md) 版本化扩展：接口新增 reduceGoal 与 goal phase 查询（src/control/control-engine/goal-reducer.ts 独立入口，ControlEngineImpl 委托）；GoalPhaseUpdated 事件与 GoalCompletionGuard 非空检查见 HANDOFF「P1-05 契约与存储语义（冻结）」与 [completion-policy](../../interfaces/completion-policy.md)。
## P1-06 extension record：recordHandoff / claimReplacement

2026-09-06 [P1-06](../../planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md) 版本化扩展：接口新增 recordHandoff、claimReplacement（src/control/control-engine/handoff.ts、replacement-claim.ts）；旧 lease/迟到结果守卫与 replacement CAS 见 HANDOFF「P1-06 契约与存储语义（冻结）」。
## P1-07 extension record：lease / integration / patch 入口

2026-09-06 [P1-07](../../planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md) 版本化扩展：接口新增 acquireReadLease、acquireWriteLease、releaseWorkspaceLease、recordIntegrationResult、recordPatch（src/control/control-engine/{workspace-lease,integration-join,patch-record}.ts）；不变量 #7 唯一 Writer = WorkspaceWriteLeaseIndex CAS；细节见 HANDOFF「P1-07 契约与存储语义（冻结）」。

## Context 生命周期与协作扩展

P1-16／17 保存工作关联与记录受理事实；P1-15 校验议题、分工与决定路由。语义分析由正式工作请求完成，reducer 不调用模型。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
## 当前源码边界（2026-09-11）

`ControlReworkDisposition.projectIssues` 是当前义务处置的只读解释入口：读取当前 Plan 的义务承担者及适用的正式 Evidence，复用已有来源、版本与独立审阅资格政策。Verification 的原失败材料与当前处置状态分开；本地 PASS、未接纳 Reviewer decision、过期 Evidence 不能抑制未处理返工。读取中 canonical 版本移动返回 unknown，不提交状态。正式返工受理仍由 acceptReworkProposal 与既有计划变更命令执行。

任务工作身份由 bindWorkContext 的权威解析守卫与 Ledger 提交时的唯一性约束共同保证，不依赖调用方先查。历史重复绑定保留可追溯，不据新规则删除或改名；旧库提交兼容见 StateLedger Module。

`src/control/control-engine/control-engine.ts` 组合各正式处理器。`control/policies` 持有完成/资格/来源/租约算法、证据冲突与返工去重政策，`control/records` 构造正式 snapshot/event；`contracts/commands` 只接受显式输入构造命令。ConfiguredWorkspaceCapabilityPolicy 用显式支持配置与 envelope 权限求交集，不回调 Runtime；PolicyExplanationPort 给 ReadModel 无状态解释，不具有状态提交权。生产逻辑不能从测试 fixture 取得默认 scope 或政策。

跨 Module 的精确入口与失败/持久兼容规则见 [当前 Module 边界](../../interfaces/module-boundaries.md)。此源码映射不代替整体功能验收。

VR-02 新增 `reviewer-work.ts` 的受限生命周期/输出绑定端口，正式 TaskReviewProtocol、ReviewWork、独立 Run/Attempt/outbox 与分组 ReviewResult/Evidence 均由 Control 重核后原子提交。`policies/reviewer-evidence.ts` 复用无状态资格函数供 reducer 和 ReadModel 解释；新协议不接受普通 verdict/observation 冒充 Reviewer，也不采信旧 satisfied 缓存，不改原 TaskLease 或旧 Plan/Evidence。准确接口见[独立审阅](../../interfaces/independent-review.md)；本批已按[VR-02验收](../../verification/2026-09-09-independent-review/acceptance.md)确认限定能力。

CM-M06-001：any准入只读取Host已完成且本次调用隔离的验读观察，不调用Context/Vault。当前Work/参与/角色权限仍由Control核对，观察前缀和实际赢家与admission同事务记录；调用方token不是verdict，不进入稳定命令指纹。 精确语义见[运行时协作](../../interfaces/runtime-collaboration.md)，M06 snap-01 已独立验收，准确边界见模块状态。


CM-1B-001（实施中、未冻结验收）：Control 负责明确人的记忆维护准入、来源校验与版本化折叠，构造带来源 guard 的提交；不从模型候选自动写入。 契约见[记忆维护与回应选材](../../interfaces/memory-maintenance.md)。


## CM-1C-001 当前增量（未冻结）

归约 ArchitectureReview 的打开/修改/最终决定，固定完整 Work 集，修改产生新提案；最终决定复用 ArchitectureChangeDecision。initial-participation-start 在原有专用参与校验之外校验正式首次派发来源。

涉及本模块文件：`architecture-review.ts`、`coordination.ts`。共享值与纯校验位于 Contracts 的 architecture-review.ts / architecture-review-values.ts / initial-work-assignment.ts；组合根 service、harness 和 UI 负责接线，不承接模块权威。Gate C 待独立判断。
