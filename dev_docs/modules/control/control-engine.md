# ControlEngine Module：Goal 创建切片

```yaml
status: draft
updated: 2026-09-06
slice: 创建 Goal → 持久化 → 投影显示
plane: Control
```

## Purpose

2026-09-05 [设计复核](../../design/human-framework-role-review.md)：当前仅展开 CreateGoal，角色提案、协作决定及状态推进路径需复核后扩展。

`ControlEngine` 是 canonical state 的唯一 transition authority。本切片只接受 `CreateGoal`，执行领域
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

2026-09-05 [P1-04](../../planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md) 版本化扩展：ControlEngine 接口新增 `submitEvidence`、`reduceTask`（submit/bootstrap 形状不变）。实现分派到两个独立入口文件（src/control/evidence-intake.ts、src/control/task-reducer.ts），ControlEngineImpl 仅委托；Evidence 不可变追加/完整幂等/CAS、纯函数 TaskSatisfied 公式与零写入语义见 HANDOFF「P1-04 契约与存储语义（冻结）」；**控制是唯一写 TaskReduction phase 者，本票不归约 Goal（P1-05）**。
## P1-02 extension record：install / activate / applyPlan

2026-09-05 [P1-02](../../planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md) 版本化扩展：`submit`/`bootstrap` 形状不变；ControlEngine 接口新增 `install`、`activate`、`applyPlan`。
实现分派到三个独立入口文件（src/control/governance-install.ts、governance-activate.ts、plan-acceptance.ts），ControlEngineImpl 仅做委托；pre-CAS 引用解析（目标已安装、active refs 解析）、guard 顺序与零写入语义见 HANDOFF 冻结清单。HumanCollaboration 面向用户的 Plan 提交入口留给状态台/完整协作票（P1-08/15），本票经 ControlEngine 直接消费票据命令。

## P1-03 extension record：dispatch / run 入口

2026-09-05 [P1-03](../../planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 版本化扩展：接口新增 dispatchReadiness、claimTask、startRun、runFact（submit/bootstrap 形状不变）。实现分派到 src/control/{readiness,claim,start-run,run-facts}.ts，ControlEngineImpl 仅委托；readiness 零写、claim 单次 CAS 唯一领取、durable outbox 与事件同原子提交；eligibility 的 depends_on 满足以 TaskReduction live phase 为准（dispatch-facts.loadLivePlan，P1-07 起；签名不变）。
## P1-05 extension record：reduceGoal / goal phase 查询

2026-09-06 [P1-05](../../planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md) 版本化扩展：接口新增 reduceGoal 与 goal phase 查询（src/control/goal-reducer.ts 独立入口，ControlEngineImpl 委托）；GoalPhaseUpdated 事件与 GoalCompletionGuard 非空检查见 HANDOFF「P1-05 契约与存储语义（冻结）」与 [completion-policy](../../interfaces/completion-policy.md)。
## P1-06 extension record：recordHandoff / claimReplacement

2026-09-06 [P1-06](../../planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md) 版本化扩展：接口新增 recordHandoff、claimReplacement（src/control/handoff.ts、replacement-claim.ts）；旧 lease/迟到结果守卫与 replacement CAS 见 HANDOFF「P1-06 契约与存储语义（冻结）」。
## P1-07 extension record：lease / integration / patch 入口

2026-09-06 [P1-07](../../planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md) 版本化扩展：接口新增 acquireReadLease、acquireWriteLease、releaseWorkspaceLease、recordIntegrationResult、recordPatch（src/control/{workspace-lease,integration-join,patch-record}.ts）；不变量 #7 唯一 Writer = WorkspaceWriteLeaseIndex CAS；细节见 HANDOFF「P1-07 契约与存储语义（冻结）」。

## Context 生命周期与协作扩展

P1-16／17 保存工作关联与记录受理事实；P1-15 校验议题、分工与决定路由。语义分析由正式工作请求完成，reducer 不调用模型。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
