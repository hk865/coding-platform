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