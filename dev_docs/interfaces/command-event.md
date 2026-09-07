# Command/Event Interface：Goal 创建切片

```yaml
status: draft
updated: 2026-09-05
slice: 创建 Goal → 持久化 → 投影显示
participants: HumanCollaboration, ControlEngine, StateLedger, ReadModelIndex
```

## Purpose

2026-09-05 [设计复核](../design/human-framework-role-review.md)：命令、事件和版本语义作为候选保留；新增角色提案与决定的适用范围需复核。

本 Interface 固定首切片跨 Module 可观察的 Command、receipt、Event 与 cursor 语义：

```text
HumanCollaboration → CreateGoal Command → ControlEngine
ControlEngine → atomic commit → StateLedger
StateLedger → EventPage(GoalCreated) → ReadModelIndex
HumanCollaboration → Goal View(atLeastCursor) → display  // 见 Goal View Interface
```

查询的字段与 freshness 语义由 [Goal View Interface](goal-view.md) 单独定义；本文件不复制该契约。
snapshot、commit 与 EventPage 由 [StateLedger Interface](state-ledger.md) 定义。

## Interface

完整协作的扩展行为见 [运行时协作 Interface](runtime-collaboration.md)。以下类型仍限定于 CreateGoal 首切片；新增角色／消息／运行或报告查询必须显式扩展 schema，不把本切片类型直接用作完整协作类型。

```ts
type Opaque<Value, Brand extends string> = Value & {
  readonly __brand: Brand;
};

type CommitCursor = Opaque<string, "CommitCursor">;
type CommandFingerprint = Opaque<string, "CommandFingerprint">;

type ActorRef = {
  kind: "human" | "system";
  id: string;
};

type CommandIdentity = {
  projectId: string;
  actor: ActorRef;
  idempotencyKey: string;
};

type CreateGoalCommand = {
  commandId: string;
  commandType: "CreateGoal";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string; // identity.projectId 内的本地 goalId
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { workspaceId: string; objective: string };
};

type CommandEnvelope = CreateGoalCommand;

type CommandReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      aggregateRevision: 1;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "not_found"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      currentRevision?: number;
    };

type GoalCreatedEvent = {
  eventId: string;
  eventType: "GoalCreated";
  schemaVersion: 1;
  projectId: string; // command.identity.projectId
  workspaceId: string;
  aggregateType: "Goal";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string; // commandId
  correlationId: string;
  idempotencyKey: string; // command.identity.idempotencyKey
  actor: ActorRef;
  occurredAt: string;
  payload: {
    objective: string;
    desiredState: "active";
    activePlanRevision: null;
  };
};
```

`commitCursor` 是至少包含本次 Event 的 durable log 位置；它不是 aggregate revision，也不表示 Read Model
已经推进到该位置。CommitCursor 是 opaque token；StateLedger 定义其日志顺序，ReadModelIndex 判断自己
是否已经连续处理到该位置，其他调用者不得按字符串字典序比较。

`CommandIdentity` 的相等性精确取
`(projectId, actor.kind, actor.id, idempotencyKey)`。`CommandFingerprint` 为下列对象经 RFC 8785/JCS
canonical JSON 编码后，对 UTF-8 bytes 计算 SHA-256 所得的小写十六进制 opaque value：

```text
{ schemaVersion, commandType, projectId: identity.projectId, aggregateId,
  expectedRevision, payload: { workspaceId, objective } }
```

fingerprint 前，objective 先做 Unicode NFC 并移除首尾 Unicode whitespace，内部字符保持不变。
`GoalCreatedEvent.payload.objective` 与 GoalSnapshot 必须保存这一规范化值。
`commandId、correlationId、submittedAt、actor、idempotencyKey` 不进入 fingerprint；actor 与 key 已进入 identity。

Command 与 Event 的 Goal identity 均为 `(projectId, aggregateType = "Goal", aggregateId)`；其中
`aggregateId` 只是 Project 内的本地 `goalId`，不得脱离 `projectId` 单独查找、判重或加锁。Workspace identity
同理是 `(projectId, workspaceId)`。

## Hidden Implementation

本文件没有业务 Implementation。编码格式、进程内调用、HTTP/IPC transport、数据库列和 projection storage
分别隐藏在参与 Module 的 Implementation 内；任何 Adapter 都必须保持这里的可观察语义。

## Dependencies

- 标识符、revision 与 actor 使用项目的 canonical domain types；
- snapshot、atomic commit 与 EventPage 使用 [StateLedger Interface](state-ledger.md)；
- 不依赖数据库、UI framework、消息队列或 `coding-agent` 类型；
- schema 演进必须增加 `schemaVersion` 和兼容策略，不能原地改变 v1 含义。

## Invariants

### Global

- Command 表达请求，Event 使用过去时表达已提交事实；二者不可互换；
- `committed` receipt 只能在 Event durable commit 后返回；
- Event 不可变，且必须保留 causation、correlation、actor 和 schema provenance；
- consumer 以 event identity 与 cursor 处理 at-least-once delivery。

### Local

- `CreateGoalCommand.expectedRevision` 固定为 `0`；成功 Event/snapshot revision 固定从 `1` 开始；
- `GoalCreatedEvent.projectId` 必须等于 `command.identity.projectId`，其 `aggregateId` 必须等于
  `command.aggregateId`；
- 一个成功 `CreateGoal` 在本切片恰好对应一个 `GoalCreated`；
- 同一 CommandIdentity/fingerprint 重放返回相同 event IDs、aggregate revision 与 commit cursor；
- `CommandReceipt.commandId` 始终回显当前请求的 commandId；重放时 `replayed = true`，原 Event 的
  `causationId` 保持不变；
- 同一 CommandIdentity 配不同 fingerprint 必须返回 `idempotency_conflict`；
- `GoalCreated` 不隐式创建 Plan、Task 或 AgentRun；
- View 的 read-after-write 依赖 `commitCursor`，不得依赖时间等待或本地 request echo。

## Test seam

维护一组跨 Module contract fixtures：有效 Command/receipt/Event、每种 rejection、NFC/whitespace 规范化、
同 identity 重放、同 identity 异 fingerprint、未知 schema version，以及两个 Project 复用同一
`workspaceId/goalId`。四个参与 Module 的测试都复用这些 fixture，避免各自解释协议。

## Explicitly not responsible

- 不定义 Module 内部调用顺序、存储 schema 或 transport；
- 不定义自然语言 Intent、Plan 创建、Task 状态机或完成验证；
- 不定义 UI 样式；
- 不授权任何参与者绕过 Control 或直接写 Read Model。

## Context load

实现首切片任一参与 Module 时默认装载本文件与当前 Ticket，再按需装载该 Module 自己的文档。实现
持久化/Event feed 时读取 [StateLedger Interface](state-ledger.md)；实现查询时读取
[Goal View Interface](goal-view.md)。只调用其他 Module 时只装载对方的 `Interface` 小节；不要同时装载
四份 Implementation、完整产品定义或完整架构图。

## P1-00 extension record：bootstrap 事件契约

2026-09-05 [P1-00](../planning/proposed/P1-foundation/tickets/00-contract-pack.md) 扩展（上文 v1 目标创建语义不变）：

- 新增 `ProjectBootstrappedEventV1` 与 `WorkspaceBootstrappedEventV1`（schemaVersion 1）：字段结构与 `GoalCreatedEvent` 一致（eventId/eventType/schemaVersion/(projectId, workspaceId)/aggregateType/aggregateId/aggregateRevision/causationId/correlationId/idempotencyKey/actor/occurredAt/payload），`payload` 仅含 `sourceDigest`；
- bootstrap 不绑定单一 Project，其请求 identity 为 `BootstrapCommandIdentity {actor, idempotencyKey}`（区别于含 projectId 的 `CommandIdentity`）；bootstrap fingerprint 为 JCS+SHA-256({schemaVersion, commandType, sourceDigest, entries})；
- `DomainEvent` 联合 = GoalCreated | ProjectBootstrapped | WorkspaceBootstrapped；未知 eventType/schemaVersion 的消费者（含 ReadModelIndex）必须停止并报告，不得跳过；
- 可执行契约见产品代码 `src/contracts/bootstrap.ts`、`src/contracts/events.ts`（产品代码根：`/home/han001/projects/agents/agent_platform`）。
## P1-03 extension record：dispatch / run 命令与事件

2026-09-05 [P1-03](../planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 版本化扩展（v1 既有语义不变）：新增 claim/start/runFact 命令、dispatch-claim / dispatch-start / run-fact 三个 commitKind 与 TaskClaimed / RunStarted / RunEventRecorded / RunOutcomeUnknown 四事件；outbox 语义（intentId===attemptId、pending→started→done、与事件同原子提交）；重复/迟到/冲突按 per-run sequence 拒绝，不回退 Task/Run revision；TaskEnvelope 有界（64KiB、无完整 transcript）。相关：eligibility 的 depends_on 满足以 TaskReduction live phase 为准（plan 快照 phase 为声明值；P1-07 起由 dispatch-facts.loadLivePlan 派生，readiness/claim 均接入，签名不变）。可执行契约见产品代码 src/contracts/dispatch.ts、ledger-validation.ts（产品代码根：/home/han001/projects/agents/agent_platform，IMPLEMENTATION-HANDOFF.md「P1-03 契约与存储语义（冻结）」）。

## P1-04 extension record：evidence / reduction commands & events

2026-09-05 [P1-04](../planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md) 版本化扩展（v1 既有语义不变）：

- 新命令：SubmitEvidence（claim/observation/verdict 三种证据，schemaVersion 1；fingerprint=JCS+SHA-256({schemaVersion, commandType, projectId, aggregateId(evidenceId), expectedRevision=0, payload:{evidence}})；同 identity+fingerprint 重放 committed(replayed)，同 identity 异 fingerprint=idempotency_conflict，异 identity 复用 evidenceId=revision_conflict——**完整幂等，与 run-fact 的“无幂等记录”语义相反**）、ReduceTask（schemaVersion 1；纯函数归约提交 verification-result；同样完整幂等）；
- 新事件（v1）：EvidenceAdmitted（Evidence 聚合，aggregateRevision=1）、TaskReductionUpdated（TaskReduction 聚合，aggregateRevision 递增 k），列入 DomainEvent 联合（KNOWN_EVENT_TYPES 同步；未知类型仍强制停止，不跳过）；
- 相关：CompletionClaim=EvidenceV1(kind=claim) 且**强制 outcome=INCONCLUSIVE**（自报不是证据 PASS）；Worker/Reviewer 不能写 Task.phase（Completion Policy 权限边界）；可执行契约见产品代码 src/contracts/evidence.ts、reduction.ts（产品代码根：/home/han001/projects/agents/agent_platform，IMPLEMENTATION-HANDOFF.md「P1-04 契约与存储语义（冻结）」）。
## P1-02 extension record：governance / plan commands & events

2026-09-05 [P1-02](../planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md) 版本化扩展（v1 CreateGoal 语义不变）：

- 新命令：InstallCompletionPolicyRevision / InstallArchitectureBaselineRevision / ActivateProjectCompletionPolicy / ActivateProjectArchitectureBaseline / ApplyPlanRevision（schemaVersion 1；经 ControlEngine.install/activate/applyPlan 进入；fingerprint 见 src/contracts/governance.ts、plan.ts）；
- 新事件（v1）：CompletionPolicyInstalled / ArchitectureBaselineInstalled / CompletionPolicyActivated / ArchitectureBaselineActivated / PlanRevisionAccepted（列入 DomainEvent 联合；未知类型仍强制停止，不跳过）；
- 本票不创建 Run / TaskAttempt / dispatch outbox；PlanRevisionAccepted 之后不触发任何派发事实。
## P1-05 extension record：goal phase reduction command & event

2026-09-05 [P1-05](../planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md) 版本化扩展（v1 既有语义不变）：

- 新命令：ReduceGoal（schemaVersion 1；aggregateId=goalId 且 payload.goalId 必须相等；fingerprint=JCS+SHA-256({schemaVersion, commandType, projectId, aggregateId, expectedRevision, payload:{goalId}})；**完整幂等**（同 identity+fingerprint → committed(replayed)；同 identity 异 fingerprint → idempotency_conflict；异 identity 复用 goalId → revision_conflict），与 evidence/verification-result 语义一致，与 run-fact 的"无幂等记录"语义相反）；
- 新事件（v1）：GoalPhaseUpdated（GoalPhase 聚合，aggregateRevision 单调 k；payload=goalId + previousPhase + phase + reasonCodes + explanation + sideEffectReconciliation + planRef + reducedAt），列入 DomainEvent 联合（KNOWN_EVENT_TYPES 同步；未知类型仍强制停止，不跳过）；
- 相关：Goal phase 只能由 ControlEngine.reduceGoal 归约（Worker/Reviewer/ReadModel 均不写）；可执行契约见产品代码 src/contracts/goal-phase.ts（产品代码根：/home/han001/projects/agents/agent_platform，IMPLEMENTATION-HANDOFF.md「P1-05 契约与存储语义（冻结）」）。

## P1-06 extension record：handoff 命令与事件

2026-09-06 [P1-06](../planning/proposed/P1-foundation/tickets/06-handoff-a-to-b.md) 版本化扩展（v1 既有语义不变）：recordHandoff / claimReplacement 命令、handoff-record / replacement-claim commitKind 与 HandoffRecorded / ReplacementClaimed 事件；HandoffPacket 有界且无完整 transcript（noFullTranscript）；公开运行快照经 WorkerRuntime.HandoffControlPort.snapshot（noHiddenContextRead）。可执行契约见产品代码 src/contracts/handoff.ts、handoff-control.ts（产品代码根：/home/han001/projects/agents/agent_platform，IMPLEMENTATION-HANDOFF.md「P1-06 契约与存储语义（冻结）」）。

## P1-07 extension record：workspace lease / integration / patch 命令与事件

2026-09-06 [P1-07](../planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md) 版本化扩展（v1 既有语义不变）：acquireReadLease / acquireWriteLease / releaseWorkspaceLease / recordIntegrationResult / recordPatch 五命令、六个 commitKind（workspace-read-lease-acquire / workspace-read-lease-release / workspace-write-lease-acquire / workspace-write-lease-release / integration-record / patch-record）与六事件（WorkspaceReadLeaseGranted / WorkspaceReadLeaseReleased / WorkspaceWriteLeaseGranted / WorkspaceWriteLeaseReleased / IntegrationJoined / PatchRecorded）。可执行契约见产品代码 src/contracts/{workspace-lease,workspace-capability,integration,patch}.ts（产品代码根：/home/han001/projects/agents/agent_platform，IMPLEMENTATION-HANDOFF.md「P1-07 契约与存储语义（冻结）」）。