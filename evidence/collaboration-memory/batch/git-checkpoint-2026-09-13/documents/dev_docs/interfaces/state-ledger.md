# StateLedger Interface：Goal 创建切片

```yaml
status: draft
updated: 2026-09-05
slice: 创建 Goal → 持久化 → 投影显示
participants: ControlEngine, StateLedger, ReadModelIndex
```

## Purpose

2026-09-05 [设计复核](../design/human-framework-role-review.md)：存储原子性与作用域作为候选保留；最终状态／事件种类需与角色及协作流程对齐。

本 Interface 固定 Control 与持久化之间的 aggregate snapshot、原子提交和有序 Event 读取语义。
`ControlEngine` 负责 fold；`StateLedger` 只保存已经归约出的 snapshot 与 Event；`ReadModelIndex`
只用 EventPage 重建 View。

## Interface

完整协作的扩展行为见 [运行时协作 Interface](runtime-collaboration.md)。以下类型仍限定于 CreateGoal 首切片；新增角色／消息／运行或报告查询必须显式扩展 schema，不把本切片类型直接用作完整协作类型。

```ts
type ProjectRef = { aggregateType: "Project"; projectId: string };
type WorkspaceRef = {
  aggregateType: "Workspace";
  projectId: string;
  workspaceId: string;
};
type GoalRef = {
  aggregateType: "Goal";
  projectId: string;
  goalId: string;
};
type AggregateRef = ProjectRef | WorkspaceRef | GoalRef;

type ProjectSnapshot = {
  ref: ProjectRef;
  revision: number;
};

type WorkspaceSnapshot = {
  ref: WorkspaceRef;
  revision: number;
};

type GoalSnapshot = {
  ref: GoalRef;
  workspaceRef: WorkspaceRef;
  objective: string;
  desiredState: "active";
  activePlanRevision: null;
  revision: 1;
};

type AggregateSnapshot = ProjectSnapshot | WorkspaceSnapshot | GoalSnapshot;

type SnapshotResult =
  | { status: "found"; snapshot: AggregateSnapshot }
  | { status: "not_found"; ref: AggregateRef };

type ExpectedVersion = { ref: AggregateRef; revision: number };
type VersionedRef = { ref: AggregateRef; revision: number };

type LedgerCommit = {
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: GoalCreatedEvent[];
  snapshots: GoalSnapshot[];
  outboxIntents: [];
};

type LedgerCommitReceipt =
  | {
      status: "committed";
      replayed: boolean;
      identity: CommandIdentity;
      aggregateRevisions: VersionedRef[];
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      code:
        | "invalid_commit"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      currentVersions?: VersionedRef[];
    };

type EventQuery = {
  afterCursor: CommitCursor | null;
  limit: number;
};

type PositionedEvent = {
  cursor: CommitCursor;
  event: GoalCreatedEvent;
};

type EventPage = {
  afterCursor: CommitCursor | null;
  throughCursor: CommitCursor | null;
  events: PositionedEvent[];
  hasMore: boolean;
};
```

`revision` 必须是非负安全整数；已存在 snapshot 的 revision 至少为 `1`。Goal 创建提交的
`expectedVersions` 必须覆盖所读取的 Project、Workspace 及 revision `0` 的目标 Goal。

canonical aggregate identity 分别是 `(Project, projectId)`、`(Workspace, projectId, workspaceId)` 与
`(Goal, projectId, goalId)`。`workspaceId` 和 `goalId` 只要求在所属 Project 内唯一；不同 Project 可以安全
复用相同本地 ID。Snapshot 不另存 `projectId、workspaceId、goalId` 的平铺副本；Goal 与 Workspace 的归属
通过 `ref` 表达。

## Hidden Implementation

本文件没有 Implementation。表结构、事务、序列化、cursor 编码、分页和 checkpoint 隐藏在
`StateLedger` 内；projection handler 与索引布局隐藏在 `ReadModelIndex` 内。

## Dependencies

- `CommandIdentity`、`CommandFingerprint`、`CommitCursor` 和 `GoalCreatedEvent` 来自
  [Command/Event Interface](command-event.md)；
- 不依赖 Control reducer、数据库类型、transport 或 UI 类型。

## Invariants

### Global

- `ControlEngine` 先从旧 snapshot 与 Command 生成新 snapshot/Event，再调用 `commit`；
- `StateLedger` 不 fold Event，也不重建 canonical snapshot；
- Event、snapshot、idempotency receipt 与 outbox intents 原子提交；
- Event 不可变，aggregate revision 与 CommitCursor 单调递增。

### Local

- 首次 Goal 提交含一个 `GoalCreatedEvent@1` 与一个字段一致的 `GoalSnapshot@1`；
- `GoalSnapshot.ref.projectId` 必须等于 `workspaceRef.projectId`；Event 的 `projectId、workspaceId、aggregateId`
  必须分别等于 `ref.projectId、workspaceRef.workspaceId、ref.goalId`；
- 同一 CommandIdentity/fingerprint 重放不追加 Event，并返回相同 event IDs、revision 与 cursor；
- 同一 CommandIdentity 配不同 fingerprint 必须返回 `idempotency_conflict`；
- EventPage 必须从 `afterCursor` 后连续读取；非空页的 `throughCursor` 等于最后一个 PositionedEvent cursor；
- 空页的 `throughCursor` 等于 `afterCursor`；二者都为空仅表示日志尚无 Event。

## Test seam

所有 StateLedger Adapter 复用同一 contract suite：load、首次 commit、CAS、幂等重放、同键异载荷、
原子故障、restart 后 snapshot load、EventPage 分页和 cursor 连续性。ReadModel 测试直接消费相同
EventPage fixture，不再维护另一种 EventBatch。fixture 必须包含两个 Project 复用同一 `workspaceId/goalId`
且互不碰撞的场景。

## Explicitly not responsible

- 不定义 CreateGoal 业务 guard 或 Command→snapshot/Event reducer；
- 不从 Event Log fold 或修复 canonical snapshot；
- 不生成 Goal View，也不定义等待投影的策略；
- 不定义数据库 schema 或 transport。

## Context load

实现 Control/Ledger 接缝时默认只装载：本文件、[Command/Event Interface](command-event.md)、当前 Ticket，
以及当前 Module 的文档。实现 ReadModel catch-up 时只额外装载
[Goal View Interface](goal-view.md)和
[`ReadModelIndex.Interface`](../modules/data/read-model-index.md#interface)；不加载其他 Module Implementation。

## P1-00 extension record：bootstrap commit kinds

2026-09-05 由 [P1-00](../planning/proposed/P1-foundation/tickets/00-contract-pack.md) 首次真实消费时统一扩展（版本化记录，不改变上文 v1 目标创建语义）：

- `LedgerCommit` 成为 kind 标签联合：`goal-create`（= 上文 v1）与 `bootstrap`；bootstrap 变体携带 `BootstrapCommandIdentity`、`expectedVersions: []`、`ProjectBootstrapped/WorkspaceBootstrapped` 事件、`Project/Workspace/BootstrapManifest` snapshot；
- bootstrap 提交的固有语义为“仅空库初始化”：ledger 无任何 Event/snapshot/幂等记录才接受；同 identity+fingerprint 重放优先（committed/replayed，绝不追加）；同 identity 异 fingerprint 为 `idempotency_conflict`；其它 identity 在非空库上为 `not_empty`（新增 rejection code，仅 bootstrap 路径产生）；
- `AggregateRef` 增加 `BootstrapManifestRef {aggregateType, manifestId}`；manifest snapshot 记录 sourceDigest、每 entry 的 identity/revision 与 bootstrapRevision；
- `EventPage.events` 承载版本化 `DomainEvent` 联合（GoalCreated | ProjectBootstrapped | WorkspaceBootstrapped），`PositionedEvent.event` 同步扩展；
- `CommitCursor` 保持 opaque：其具象编码（单调十进制序列）只允许 ledger Adapter 与 ReadModelIndex 经 `compareCommitCursor` 使用；其它调用者不得比较或解码；
- 对应可执行契约见产品代码（`src/contracts/ledger.ts`、`src/contracts/bootstrap.ts`）与 `tests/contract-suite/state-ledger.contract.suite.ts`（产品代码根：`/home/han001/projects/agents/agent_platform`）。
## P1-04 extension record：evidence / verification-result 切片

2026-09-05 [P1-04](../planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md) 版本化扩展（既有 v1 语义不变）：

- LedgerCommit += evidence-intake（events=[EvidenceAdmitted]，snapshots=[EvidenceSnapshot, TaskEvidenceIndexSnapshot]，CAS=[Evidence@0, TaskEvidenceIndex@(count-1)]，完整幂等）与 verification-result（events=[TaskReductionUpdated]，snapshots=[TaskReductionSnapshot]，CAS=[TaskReduction@(k-1)]，完整幂等）；outboxIntents=[]；
- AggregateRef/AggregateSnapshot += Evidence / TaskEvidenceIndex / TaskReduction；EvidenceSnapshot 不可变（revision 恒 1）；TaskEvidenceIndex.revision==evidenceIds.length（admission 序；上限 MAX_EVIDENCE_PER_TASK=512，超出零写入拒绝）；TaskReductionSnapshot 记录归约 phase（verifying|failed|blocked|satisfied）+ effective/blocking/stale/outOfScope evidence ids + currentAnchor；
- Evidence 与绑定锚（EffectivityAnchorV1）同事务可见；applicability（APPLICABLE/STALE/OUT_OF_SCOPE）是纯函数派生量，永不写回；冻结语义与可执行契约见产品代码根 IMPLEMENTATION-HANDOFF.md（P1-04 契约与存储语义）与 src/contracts/{evidence,reduction,ledger,ledger-validation}.ts。
## P1-02 extension record：install / activate / PlanRevision 切片

2026-09-05 [P1-02](../planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md) 版本化扩展（上文 v1 bootstrap/CreateGoal 语义不变）：

- LedgerCommit += governance-install | governance-activate | plan-revision（project-scoped CommandIdentity、outboxIntents=[]）；
- AggregateRef/AggregateSnapshot += CompletionPolicyRevision / ArchitectureBaselineRevision / ProjectCompletionPolicyActive / ProjectArchitectureBaselineActive / PlanRevision；GoalSnapshot.activePlanRevision 可非空（v1 创建仍 null/1）；
- 冻结语义清单与可执行契约见产品代码根 IMPLEMENTATION-HANDOFF.md（P1-02 契约与存储语义）与 src/contracts/**；本文件不复制可执行 schema。
## P1-05 extension record：goal-reduction commit kind

2026-09-05 [P1-05](../planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md) 版本化扩展（既有 v1 语义不变）：

- LedgerCommit += goal-reduction（events=[GoalPhaseUpdated]，snapshots=[GoalPhaseSnapshot]，CAS=[GoalPhase@(revision-1)]，**完整幂等**；outboxIntents=[]）；
- AggregateRef/AggregateSnapshot += GoalPhase（ref=(projectId, goalId)——全键隔离，与 TaskReduction 对称）；GoalPhaseSnapshot 记录 phase（§9 封闭 10 值）+ reasonCodes + explanation（确定性模板）+ sideEffectReconciliation + previousPhase + planRef + reducedAt；单事务，重启等价（tests/restart/p1-05-*）；
- 冻结语义清单与可执行契约见产品代码根 IMPLEMENTATION-HANDOFF.md（P1-05 契约与存储语义）与 src/contracts/{goal-phase,ledger,ledger-validation}.ts；本文件不复制可执行 schema。

## P1-03 extension record：dispatch / run 持久化

2026-09-05 [P1-03](../planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 版本化扩展（既有 v1 语义不变）：新增 dispatch-claim / dispatch-start / run-fact 三个 commitKind 与 TaskLease / TaskAttempt / Run / DispatchOutboxEntry 聚合（ref=projectId+goalId+taskId+attemptId，同一原子提交、CAS、可 load、可重启读取；outbox status pending→started→done 各自 CAS 推进）。可执行契约见 src/contracts/{dispatch,ledger,ledger-validation}.ts。

## P1-06 extension record：handoff 持久化

2026-09-06 [P1-06](../planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md) 版本化扩展：新增 handoff-record / replacement-claim 两个 commitKind 与 HandoffPacket / ReplacementAttempt / HandoffProvenance 聚合；packet 有界（64KiB）且无完整 transcript。可执行契约见 src/contracts/{handoff,handoff-view,handoff-control}.ts。

## P1-07 extension record：lease / integration / patch 持久化

2026-09-06 [P1-07](../planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md) 版本化扩展：新增六个 commitKind 与 WorkspaceReadLease / WorkspaceWriteLease / WorkspaceWriteLeaseIndex / IntegrationResult / PatchRecord 聚合；Workspace 聚合 revision 由 ledger CAS 单调推进，patch 登记在同一原子 commit 内携带 N→N+1 推进（显式 release 不推进）。可执行契约见 src/contracts/{workspace-lease,integration,patch,ledger,ledger-validation}.ts。

## CM-1A-001 extension record：协作通信 commit kinds 与聚合

2026-09-13 [CM-1A-001](../planning/active/collaboration-memory/CM-1A-001.md) 第 1 工作段版本化扩展（既有 v1 语义不变）：`LedgerCommit` 增加 14 个 commitKind，`AggregateRef`/`AggregateSnapshot` 增加 10 个协作聚合。**本记录只登记已落地的形状与账本分派：Control handler、Dispatch 路由与 Context 消费者均未实现，业务准入仍在 Control；不代表协作通信已可用，A01–A12 未验证。**

14 个 commitKind（逐项取自 `src/contracts/coordination.ts` 的 `COMMUNICATION_COMMIT_KINDS`，由两个 Adapter 共用的 `validateCommunicationCommit` / `validateCommunicationSuccessorClaimCommit` 校验）：

- `agent-instance-register`：events=[AgentInstanceRegistered]，snapshots=[AgentInstance]（CAS@0，不可变）；
- `participation-start`：参与关系 @1，**同一事务**可携带发起 Run 的归因（events 含 `WorkRunLinked`，snapshots 含 `WorkContextBinding`）——分两次提交会留下"参与已生效但 Run 未 link"的中间态；
- `participation-end`：events=[WorkParticipationEnded]，snapshots=[WorkParticipation|WorkMailbox]（CAS@N，历史保留）；
- `directed-request-send`：events=[DirectedRequestSent, ...DeliveryRecorded]，snapshots=[DirectedRequest|Delivery|CommunicationIntent]（请求 @1 + 首个 route intent，有界时同事务首投）；
- `directed-request-respond`：events=[DirectedRequestResponded]，snapshots=[DirectedRequest]（回应正文登记，CAS@N）；
- `directed-request-cancel`：events=[DirectedRequestCancelled]，snapshots=[DirectedRequest]（desired-state 取消）；
- `subscription-create`：events=[SubscriptionCreated|CommunicationIntentRecorded]，snapshots=[Subscription|CommunicationIntent]（订阅 @1 + 首个 route intent，CAS@0）；
- `subscription-cancel`：events=[SubscriptionCancelled]，snapshots=[Subscription]（desired-state 取消）；
- `wait-register`：events=[WaitConditionRegistered|WaitConditionObserved]，snapshots=[WaitCondition|CommunicationIntent]（等待 @1）；
- `wait-cancel`：events=[WaitConditionCancelled|CommunicationIntentSettled]，snapshots=[WaitCondition|CommunicationIntent]（desired-state 取消）；
- `communication-intent-claim`：events=[CommunicationIntentClaimed]，snapshots=[CommunicationIntent]（机械领取，事件携带 priorGeneration）；
- `communication-route-page`：**一页的 Delivery + checkpoint + wait transition + next intent + current settle 同一 CAS**；snapshots=[CommunicationIntent|Delivery|Subscription|WaitCondition]；
- `communication-intent-settle`：非页面的 settle（cancel 确认 / unknown / quarantine / deadline）；snapshots=[CommunicationIntent|WaitCondition]；
- `communication-successor-claim`：events=[TaskClaimed, WaitConditionSatisfied, CommunicationAdmissionRecorded, ...CommunicationIntentSettled]，snapshots=[TaskLease, TaskAttempt, Run, DispatchOutboxEntry, WaitCondition, CommunicationAdmission, ...CommunicationIntent]，且 `outboxIntents` **恰好 1 条** `DispatchIntentV1`——后继 TaskAttempt 的唯一调度记录仍是 `DispatchOutboxEntry`。

10 个协作聚合（`AggregateRef`/`AggregateSnapshot`；ref 键 = projectId + workspaceId + 各自局部 id）：

- `AgentInstance`(+agentInstanceId)、`WorkParticipation`(+workId+participationId)、`DirectedRequest`(+requestId)、`Subscription`(+subscriptionId)、`Delivery`(+deliveryId)、`WaitCondition`(+waitId)、`CommunicationIntent`(+intentId)、`CommunicationAdmission`(+waitId)；
- `CoordinationRegistry` 与 `WorkMailbox` 是**每个 (project, workspace) 一份的可重建投影**（无局部 id），用于查询与重建，不是调度权威。

配套登记（同一工作段）：20 个协作事件进入 `KNOWN_EVENT_TYPES` 与事件校验白名单；两个 ReadModel 的 `isHandledEventType` 白名单同步登记（漏登记会让整页 `ProjectionStallError`）；幂等身份仍是 `commandIdentityKey`，本段把 `agentPrincipal` 折叠进该 key，防止不同 Agent 用同一 idempotencyKey 互相 replay。**注意：tsconfig 未开 `noImplicitReturns`，两个 Adapter 的 commit 分派必须成对核对。** 可执行契约见 `src/contracts/coordination.ts`、`src/contracts/ledger.ts` 与 `src/data/state-ledger/ledger-validation.ts`；本文件不复制可执行 schema。

## CM-1A-001 continuation-04：事务与恢复约束

两套适配器共享形状校验与 canonical 状态 fold。participation-start 先校验通用事件再校验专用顺序/作用域/expectedVersions；active participation 唯一槽与 Work 当前参与关系同事务。waitRef 不携 workId，Work 归属从 canonical Wait 检查。

源事件的 routeIntentPlans.scopeMode=canonical_active 在追加事务内固定 sourceCursor 和当前订阅范围；不会遗漏并发建订阅。null start 固定到 SubscriptionCreated 的真实位置，历史 start 创建一个固定 horizon 的 catchup intent。每页最多扫描 512 源事件；Delivery、checkpoint、wait 条件观察、当前 intent 与下一页同 CAS，页重复/乱序/范围外数据拒绝。取消订阅保留固定页位置并跳过 Delivery。

RuntimeInputBound 原子固定实际输入/manifest/Delivery/grant refs。每个 ModelRequestAuthorized / ModelRequestEvidenceRecorded 用 Run/角色策略/材料引用的 CAS 守卫与 permit @0→@1→@2；新 attempted 不能在取消或终态之后落账。ExecutionEntered 必须 exact owner/generation；ExecutionRetryScheduled 仅撤销未进入授权，同时复原同一个 Run/TaskAttempt/outbox 到待派发并保存退避，已 entered/ended 不可重开。

RunReconciled 是独立的 unknown 终态对账事实。Control 读可信 Host journal；Ledger 检查 exact Run、序号、事件摘要与完整状态 fold。done/cancelled 同事务修正 TaskAttempt 结果；无证明只登记 quarantine。communication-intent-reconcile 仅把未核实的通信结果隔离，保留 generation/owner/domain，不放宽 ordinary settle 的终态守卫。

admitWaitSuccessor 存在 intent 时必须携当前 intentClaim；受理事务 CAS 该 intent、Work binding、参与关系、Wait 及其他新聚合。无 intent 的直接路径也检查该确定性 intent ref @0。新增事件均由两套 ReadModel 识别；ExecutionRetryScheduled/RunReconciled 更新展示，不由投影触发调度。

源码阅读：src/contracts/{coordination,dispatch,execution-authorization,run-lifecycle-fold,run-reconciliation,communication-reconciliation,runtime-input-authorization}.ts → src/data/state-ledger/ledger-validation.ts 的专用校验 → in-memory-ledger.ts / sqlite-ledger.ts。旧字段缺失保持历史可读；新授权不补猜。独立 SQLite 连接与独立进程证据见 tests/coordination/{participation-uniqueness,process-recovery,route-drive}.test.ts。

## CM-1B-001：小记忆能力与笔记治理见证

StateLedger 的可选 memory capability 由现有内存/SQLite 适配器实现，缺失时记忆消费者明确 unavailable；旧 Ledger 调用者可继续不使用该能力。Control 是写入者，ReadModel/Context 只读；collection revision、条目 revision、摘要、来源、适用条件、删除标记与原请求回执由同一记忆事务固定。完整字段与读写/重放/兼容约束见 [记忆维护 Interface](memory-maintenance.md)，不引入第二个存储权威。

ExecutionNote 新增可选 memoryGovernance。提供该见证时，完整正文摘要必须覆盖原始四项治理 revision；记录提交 expectedVersions 恰为 note@0 及四项治理守卫，两个 Ledger 最终 CAS 防止记录前治理变化。没有该字段的旧笔记仍按原规则留作历史，但不允许被导入为本票当前经验；原 governanceRevision 的权限策略语义不变。记忆 collection 提交还复核原 note、当前 Workspace/Goal、治理及后继 note 守卫，省略守卫不能落账。
