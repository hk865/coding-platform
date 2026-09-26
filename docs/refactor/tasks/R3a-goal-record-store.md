# R3a：Goal 创建贯穿 WorkGraph 与 RecordStore

状态：2026-09-23 用户已提交按[并行实现任务](DSH-PARALLEL-IMPLEMENTATION.md)产出的代码，Goal已贯穿真实Store/WG及旧Host链；本轮独立验收发现guard与不可克隆输入隔离缺陷，尚未通过。见[独立验收](../reviews/R3a-R4a-independent-acceptance.md)及[返修任务](R3a-R4a-acceptance-fixes.md)，返修尚未派发。本页保留原实施契约，不放宽验收要求；本批仍不依赖全部R2e Git/语言功能完成。

主 Agent 负责架构、任务书和独立测试；dsh 实现生产代码及必要接线/fixture迁移，不修改或放宽主 Agent 冻结的测试，不自动提交、不启动真实付费模型集成测试，保留用户及前批修改。已授权的 dsh 团队协作按并行任务书执行。

路径：C=`/home/hyh001/projects/coding-platform/coding-platform`；N=`/home/hyh001/projects/coding-platform/docs/refactor`。下文省略 `src/` 的源码文件路径均相对 C/src；`scripts/`、`tests/` 路径相对 C。依据 N/refactor-plan.md §3.1、N/modules/core/{work-graph,record-store}.md。真实旧入口为 `control/control-engine/control-engine.ts` 的 submit、`data/state-ledger/{in-memory-ledger,sqlite-ledger}.ts` 的 goal-create 分支及 `validation/bootstrap.ts`；本页明确迁移和兼容决策，不要求读取临时调查文件或重做全仓调查。

## 1. 已冻结的最小结果

只交付 `GoalTaskPort.createGoal`，方法签名与目标完整 TaskPort.createGoal 一致，并使原 GUI → HumanCollaboration → Control.submit 真正经过同一个 WorkGraph Goal 内核和 RecordStore。原 `CreateGoalCommand@1`、`GoalCreated@1`、GoalRef、事件游标、snapshot JSON、幂等 key 和旧 CommandReceipt 不变。

不建立新的 Goal 表、第二份活动 Goal Map、Session/index/outbox/body 框架。SQLite 四张核心表继续使用，已有 memory_* 等其它表原样保留；内存也只有一组事件/快照/幂等/claim 状态。旧其他 commitKind 的 validator 和业务提交代码继续留在 StateLedger 兼容适配内。

选定结构是**共享物理后端**，不是 RecordStore 调用 StateLedger.commit 的包装：

```text
旧 GUI/HumanCollaboration → Control.submit → WG.LegacyGoalCommandPort.submit ─┐
新 GoalTaskPort.createGoal ────────────────────────────────────────────────────┤
                                                     admitGoalCreation   │
旧 StateLedger.commit(goal-create) → WG.LegacyGoalCommitPort.commit ───────┤
                                                       Goal compiler    ↓
                                  GraphRepository → GoalRecordTransactionPort
                                                           ↓
             同一个 SQLite connection / 同一组内存 state + 原物理表
                                                           ↑
旧 StateLedger 的未迁 kind → 原 validator/提交分支 → 共享 backend
```

两个命令入口共享同一个 `admitGoalCreation`。兼容 batch 入口接受已编译命令，因此只做旧 batch 合约检查/编码，不再生成另一套业务决定。Store 不导入 WorkGraph，WorkGraph 不调用旧 StateLedger。

## 2. 本批公共子集与必要的小接口修正

### 2.1 WorkGraph

```ts
// core/work-graph/tasks/contracts.ts
// 以下现有类型仍从 contracts/command-event.ts、contracts/ledger.ts 精确导入。
export type GraphWrite<T> = { input: T; meta: CommandMeta };
export type CreateGoalInput = {
  goalId: string;
  workspace: { projectId: string; workspaceId: string };
  objective: string;
};
export interface GoalTaskPort {
  createGoal(ctx: CoreCallContext, request: GraphWrite<CreateGoalInput>):
    Promise<WriteResult<GoalSnapshot>>;
}
// 可信旧入口适配，不作为模型工具发布。
export interface LegacyGoalCommandPort {
  submit(command: CreateGoalCommand): Promise<CommandReceipt>;
}
export interface LegacyGoalCommitPort {
  commit(batch: GoalCreateLedgerCommitV1): Promise<LedgerCommitReceipt>;
}
export type GoalServiceDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};
export function createGoalService(deps: GoalServiceDependencies): {
  tasks: GoalTaskPort;
  legacyCommands: LegacyGoalCommandPort;
};
export function createLegacyGoalCommitAdapter(deps: {
  records: GoalRecordTransactionPort;
}): LegacyGoalCommitPort;
```

只导出已实现的方法，不建立包含其他任务操作的空壳 Port。后批在原文件扩展。

- `goalId` 与 `meta.requestId` 独立；后者映射原 idempotencyKey，不能拿来覆盖目标 ID。
- `meta.expected` 本批仅接受本项目的对应 Project、Workspace、Goal 三种 pin，拒绝重复/无关/跨 scope pin；Goal 的旧 revision=0 pin 显式转成“必须不存在”。Project/Workspace 未给 pin 时使用本次真实读到的版本；给了则按它检查，不能悄悄覆盖。
- 合法幂等 lookup 先于这些**当前版本**判定；但结构、身份和 scope 输入有效性仍在 lookup 之前。expected pin 的变化不改原 CreateGoal fingerprint：旧 fingerprint 只含命令中固定的 Goal expectedRevision=0，不含 Control 读到的引用对象版本。
- `GoalTaskPort` 本切片只发布真实可信 Host 创建能力；ctx 必须匹配 request.workspace，并由实际 Host 授权入口构造。不要因为 `principal.kind==='host'` 就把模型输入变成授权。query_run 不获得创建正式目标能力。
- 旧 `CreateGoalCommand` 已包含完整 ActorRef/可选 AgentPrincipal；兼容入口继续按原身份 validator 接受和归因，不把 agent 变成 human/system，也不借本切片放宽其权限。新 GoalTaskPort 扩展工作 Run 正式创建授权不属于本批。
- 旧 commandId/correlationId/submittedAt 保持在兼容入口，不塞进公共 CommandMeta，不丢掉 GoalCreated 的 causation/correlation 字段。新 GoalTaskPort 可从真实 identity 派生稳定 commandId/correlationId；eventId 使用同一注入生成器。二者均不参与原幂等 fingerprint。
- 内部 `admitGoalCreation` 返回 `{snapshot: GoalSnapshot, receipt: committed StoreCommitReceipt}` 或保留细分的拒绝；两个入口只做参数和结果映射。旧接口需要 eventIds，因此不能只拿 WriteResult.value 再读当前记录猜回执。

### 2.2 RecordStore

只实现创建链实际使用的 `readMany / lookupCommit / commit`，以及恢复原事件所需的一个精确读取。不提前实现 readIndex、正文、Runtime records 或索引表。

```ts
export interface GoalRecordTransactionPort {
  readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>>;
  lookupCommit(input: { identityKey: string; fingerprint: string }):
    Promise<StoreResult<Extract<StoreCommitReceipt, {status:'committed'}>>>;
  commit(input: PreparedCommit): Promise<StoreCommitReceipt>;
  eventAt(cursor: CommitCursor): Promise<StoreResult<{
    cursor: CommitCursor; event: EncodedDomainEvent;
  }>>;
}
```

`eventAt` 是已批准的最小机械能力：SQLite 用现有 events 主键、内存用原事件序号定位一条，不新增索引/表；后续完整 RecordTransactionPort 保留它或做兼容扩展。**不要在 WG 拆解/减一 cursor，也不要从 null 分页扫描所有事件找原提交。** 原目标 `events(afterCursor)` 不支持有效的随机读取，不能假装现有 Port 已足够。

机械 `EncodedRecord/EncodedDomainEvent/RecordGuard/PreparedCommit/StoreResult` 最小实现直接归 `core/record-store/ports.ts`。WorkGraph→RecordStore 本来允许，不另造 contracts/core/records.ts。本批 PreparedCommit 只有 records/guards/events/identityKey/fingerprint 有实际内容；`claims/indexGuards/indexChanges` 如保留目标字段，类型和运行时均只接受空元组 `readonly []`，`ledgerHorizon` 不发布。不能接收非空后忽略。不提前声明所有 DurableIndexName。

已批准的另一机械补齐：StoreFailure 的 `revision_conflict` 保留事务当时当前版本，以忠实映射旧 CommandReceipt.currentRevision：

```ts
{ status: 'rejected'; code: 'revision_conflict'; reason: string;
  current: { refKey: string; revision: number | null }[] }
```

null 是真实不存在；兼容旧回执时按旧语义映射 revision 0。其他 StoreFailure 不变；不能重读最新版本代替事务当时报告的冲突。

### 2.3 schema 注册、旧数据选择与验证

机械类型放 `core/record-store/ports.ts`，复用同文件 EncodedRecord / EncodedDomainEvent / DecodeResult，不新增全局 contracts/core/records.ts：

```ts
export type EncodedRecordSchema = {
  readonly schemaId: string;
  readonly aggregateType: string;
  validate(record: EncodedRecord): DecodeResult<EncodedRecord>;
};
export type EncodedEventSchema = {
  readonly eventType: string;
  readonly schemaVersion: number;
  validate(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent>;
};
export type RecordBackendSchemas = {
  readonly records: readonly EncodedRecordSchema[];
  readonly events: readonly EncodedEventSchema[];
};
```

aggregateType 是对目标页注册接口的必要补齐：旧 snapshot_json 没有 schemaId 列，Store 根据完整 ref 的 aggregateType 选 codec，不能硬编码 Goal 或试跑所有 schema。event 注册使 eventAt/commit 能拒绝未知事件 schema，不新建注册服务。

WG 的 `persistence/record-codecs.ts` 导出唯一 `GOAL_RECORD_SCHEMAS: RecordBackendSchemas`，由 Host 和旧 Ledger 兼容构造注入。固定注册：

| selector | EncodedRecord.schemaId | 形状 |
| --- | --- | --- |
| Project | `ProjectSnapshot@1` | 原完整 ProjectRef + revision，不要求不存在的 schemaVersion |
| Workspace | `WorkspaceSnapshot@1` | 原完整 WorkspaceRef + revision，不要求 schemaVersion |
| Goal | `GoalSnapshot@1` | 原 GoalSnapshot；允许 revision2+ 和合法 PlanRevisionRef |
| GoalCreated / schemaVersion=1 | 事件不加 schemaId | 原 GoalCreatedEvent；外层 eventId/type/version/occurredAt 与 JSON 一致 |

schemaId 的 @1 是编码版本，不是 aggregate revision。通用 revision 为安全非负整数，Goal 自身要求 >=1；Goal 创建 revision1/activePlanRevision=null 由 compiler 保证，读取 codec 不能误拒合法后续 Goal。原 snapshot/事件 JSON 和数据库列不增加 schemaId。

注册回调只检查纯编码、形状、身份、版本，不含 I/O、权限、准入、fold、事务。Store 检查通用 JSON 和外层一致性，再调用相应纯 validator；回调不能改变外层 key/schema/revision 或 JSON。不要在读取 codec 重新规范化历史 objective；原命令规范化、raw event/snapshot 一致性仍归 WG。

工厂同步复制注册数组和 selector 元数据；空标识/非法版本/非函数、重复 schemaId、重复 aggregateType、重复 eventType+schemaVersion 都拒绝启动。不是最后注册者获胜。Store 无 WG import。

readMany：ref_key 必须是完整 ref 的规范 key；按 selector 将旧 JSON 包成 EncodedRecord 并核对内部 ref/revision。未知类型 unsupported，已知损坏 corrupt，不能当 missing。旧 Ledger 对其它聚合仍沿原读法。eventAt 用旧 cursor 主键精确读取，未知/损坏 schema 不伪装 not_found；WG replay 映射 unavailable 并保留原因。

## 3. 文件分工与真实接线

| 文件 | 本批唯一职责/导出 | 不放进去的工作 |
| --- | --- | --- |
| `contracts/core/{identity,results}.ts` | 仅此链需要的 WorkspaceScope/CommandMeta、WriteResult；机械持久协议归 RecordStore ports | 不生成 Session/全部未来 Port |
| `core/work-graph/tasks/contracts.ts` | 上述 GoalTaskPort/请求、两种旧接口适配的精确类型 | 不复制旧 Goal/命令正文类型 |
| `core/work-graph/tasks/task-service.ts` | `createGoalService`；合法命令→早期lookup→scope读取→fold→commit→原结果 | 不写 SQL/Map、不实现自己的CAS |
| `core/work-graph/persistence/record-codecs.ts` | Project/Workspace/Goal 封闭 codec、`GOAL_RECORD_SCHEMAS`；GoalCreated@1 编解码与 snapshot恢复 | 不作 I/O，不从当前 Goal 构造旧结果 |
| `core/work-graph/persistence/commit-compiler.ts` | Goal fold/完整 guards/EncodedRecord/event；迁入的唯一 goal-create 纯 envelope validator | 不开始事务，不再向旧 Ledger 发 batch |
| `core/work-graph/persistence/graph-repository.ts` | 类型化 readGoalScope/lookup/commit/readCreatedGoal；错误细分和完整引用 | 不重复领域准入 |
| `core/work-graph/persistence/legacy-adapter.ts` | 旧 GoalCreateLedgerCommit→同 compiler/Store；原 Ledger receipt映射 | 不迁未使用的其它 commitKind |
| `core/record-store/ports.ts` | 本批拟实现 GoalRecordTransactionPort、schema 注册及机械 DTO | 不发布虚假的全量 Store 门面 |
| `core/record-store/record-codec.ts` | 注册 schema/key/revision/JSON一致性，输入输出隔离 | 不导入 WG、不判断目标业务合法性 |
| `core/record-store/sqlite-record-store.ts` | 同步 `createSqliteRecordBackend`、原 connection 所有权、Goal 通用 BEGIN/COMMIT/ROLLBACK、精确读、幂等/CAS/写入 | 不调用 Goal validator，不重新算业务 fingerprint |
| `core/record-store/in-memory-record-store.ts` | 同步 `createInMemoryRecordBackend`、唯一 eventLog/snapshots/idempotency/identityClaims/cursor 状态，通用原子提交 | 不再 new 第二组 Map |
| `core/record-store/migrations.ts` | 原4表兼容检查和新库初始化 | 本批不新增业务表/结果表/索引表 |

### 3.1 同步子工厂与共享物理状态

本批同步子工厂固定为 `createSqliteRecordBackend` / `createInMemoryRecordBackend`。模块页的异步全量 `createSqliteRecordStore` 是后续目标，本批不发表该名字，也不实现 bodies/indexes/runtime 空壳。只返回 `{records,close,legacyAccess}`。

```ts
// core/record-store/sqlite-record-store.ts
export type SqliteRecordBackendOptions = {
  path: string; schemas: RecordBackendSchemas; beforeWrite?: () => void;
};
export type SqliteRecordBackend = {
  readonly records: GoalRecordTransactionPort;
  close(): Promise<void>;
  readonly legacyAccess: SqliteLegacyRecordAccess;
};
export function createSqliteRecordBackend(
  options: SqliteRecordBackendOptions,
): SqliteRecordBackend;

// core/record-store/in-memory-record-store.ts
export type InMemoryRecordBackendOptions = {
  schemas: RecordBackendSchemas; beforeWrite?: () => void;
};
export type InMemoryRecordBackend = {
  readonly records: GoalRecordTransactionPort;
  close(): Promise<void>;
  readonly legacyAccess: InMemoryLegacyRecordAccess;
};
export function createInMemoryRecordBackend(
  options: InMemoryRecordBackendOptions,
): InMemoryRecordBackend;
```

无 now/eventId：时间和 ID 已由 Goal 服务编译。无 memoryLimits：它继续属于旧 memory-ledger 的配置。两种 backend 的 close 在本切片同步标记关闭并释放同步资源，返回已完成 Promise；没有异步写队列。SQLite 沿原 close 的重复/已关闭容错，不能把后续异步全量工厂的等待语义倒灌进同步构造。

下列过渡类型放各自适配文件；共用的机械 receipt/helper 类型可放 ports.ts。这里只暴露同一物理状态及原机械辅助，绝不暴露领域事务执行回调：

```ts
import type { DatabaseSync } from 'node:sqlite';
import type { CommitCursor, CommandFingerprint } from '../../contracts/command-event.js';
import type { AggregateSnapshot, PositionedEvent, VersionedRef } from '../../contracts/ledger.js';
export type LegacyIdempotencyRecord = {
  fingerprint: CommandFingerprint; eventIds: string[];
  aggregateRevisions: VersionedRef[]; commitCursor: CommitCursor;
};
export type LegacyRecordMechanics = {
  assertOpen(): void;
  idempotencyRecord(identityKey: string): LegacyIdempotencyRecord | undefined;
  appendEvents(events: readonly {eventId:string;json:string}[]): {
    eventIds: string[]; commitCursor: CommitCursor;
  };
  upsertSnapshot(refKey: string, json: string): void;
  persistIdempotency(identityKey: string, value: LegacyIdempotencyRecord): void;
  nextEventSeq(): number;
};
export type SqliteLegacyRecordAccess = {
  readonly path: string;
  readonly connection: DatabaseSync;
  readonly beforeWrite: (() => void) | undefined;
  readonly mechanics: LegacyRecordMechanics;
};
export type InMemoryLegacyRecordState = {
  readonly eventLog: PositionedEvent[];
  readonly snapshots: Map<string, AggregateSnapshot>;
  readonly idempotency: Map<string, LegacyIdempotencyRecord>;
  readonly identityClaims: Map<string, string>;
  cursorSeq: number;
};
export type InMemoryLegacyRecordAccess = {
  readonly state: InMemoryLegacyRecordState;
  readonly beforeWrite: (() => void) | undefined;
  readonly mechanics: LegacyRecordMechanics;
};
```

机械写 helper 不 BEGIN/COMMIT、不 await、不执行 Goal validator，调用者必须持有同一后端同步写段。新 records.commit 在调用前执行注册 schema 检查；旧 kind 仍由旧 validator 负责，不能因为 Goal 的封闭注册拒绝所有未迁业务。旧私有 append/upsert/idempotency 方法改薄委托，只搬一份现有 SQL/数组追加逻辑，不另建一套。nextEventSeq 在 SQLite 仍要求 BEGIN IMMEDIATE，沿 sqlite_sequence；Store 不重新计算 raw fingerprint。

SQLite backend 唯一拥有 DatabaseSync、关闭标记、四张核心表初始化/兼容检查及 busy_timeout=5000。注册先验证，再开库/检查 DDL；开库后失败关闭连接并同步抛原错误。不 DROP/重建旧库，不删其它表。

内存 backend 唯一创建 eventLog、三张 Map 和 cursor。旧类引用这些对象，cursor 用 getter/setter 委托同一 state.cursorSeq；不能复制值形成第二个计数器。Map/数组引用稳定，事务发布/rollback 原位更新或 undo，不整体替换导致旧适配看到过时引用。

### 3.2 旧构造与关闭所有权

只增加第二个可选参数，第一个 Options 原样保留、构造仍同步：

```ts
// data/state-ledger/sqlite-ledger.ts
constructor(options: SqliteStateLedgerOptions, backend?: SqliteRecordBackend);
export function createSqliteStateLedger(
  options: SqliteStateLedgerOptions, backend?: SqliteRecordBackend,
): SqliteStateLedger;
// data/state-ledger/in-memory-ledger.ts
constructor(options: InMemoryLedgerOptions = {}, backend?: InMemoryRecordBackend);
export function createInMemoryLedger(
  options?: InMemoryLedgerOptions, backend?: InMemoryRecordBackend,
): InMemoryLedger;
```

未注入时，旧类同步调用子工厂，传原 path/beforeWrite 和 GOAL_RECORD_SCHEMAS；StateLedger→WG/Store 已是本批明确过渡边。已注入时，不再 new DatabaseSync/Map、不重复四表初始化；绑定 legacyAccess 并构造 `createLegacyGoalCommitAdapter({records:backend.records})`。Goal 委托必须位于旧 SQLite 外层 BEGIN 之前。

注入一致性固定：options.path 与 backend.legacyAccess.path 字符串必须相同；options.beforeWrite 给出时必须与 backend hook 是同一函数，否则同步拒绝，不能静默忽略。省略 hook 时使用 backend 的 hook；内存相同。memoryLimits 始终传给原 memory adapter。

SqliteMemoryLedger 继续由旧 Ledger 构造，拿同一 connection、同一 hook 和原 memoryLimits/get。其既有 memory_* 表及兼容动作保持；四张核心表迁移不意味着库内只有四表。InMemoryMemoryLedger 自己的知识记忆集合不在此批迁移，get 指向同一 snapshots Map。构造 memory adapter 失败时旧类调用 backend.close 并同步抛原异常；close 的同步资源释放不要求异步构造。

唯一物理 close 在 backend。SqliteStateLedger.close() 只委托，不再直接 db.close；平台 close/cleanup 原来调用 built.ledger.close 的位置保持，不另外并列关闭 backend。成功交付 Ledger 前的初始化失败由创建者关闭 backend；成功后沿旧 Ledger 关闭入口。重复别名调用由 backend 关闭标记封闭。

InMemoryLedger 原来没有公开 close，本批不把 close 加进 StateLedger/InMemoryHarness 协议。独立 fixture 如直接持有内存 backend 可调用其 close；旧适配通过 mechanics.assertOpen 拒绝对已关闭 backend 的操作。原 harness 无持久句柄，生命周期不变。

beforeWrite 保持：全部校验、幂等/CAS 之后，第一项状态/SQL 写之前只调用一次；SQLite 在事务内，抛错整体回滚并保留原异常传播。replay/冲突/schema 初始化不调用。旧 kind 与 memory-ledger 保留各自原调用点，不在 wrapper 和新 Store 各调用一次。

### 3.3 两个真实组合根

ControlEngineDeps 增加必需 `goalCommands: LegacyGoalCommandPort`，准确 import WG tasks/contracts；submit 只委托 goalCommands.submit。不是 optional，不保留旧 Goal body 作为默认 fallback；原 ledger/now/eventId 留给未迁功能。

持久 buildPersistentPlatform 同步创建 backend，然后 `createSqliteStateLedger({path},backend)`，使用 `createGoalService({records:backend.records,now:d.clock,eventId:d.eventId})`，把 `goals.legacyCommands` 注入 Control。原 workspaceCapability、alternativeReportObservation、runtimeObservation 等依赖保持。重开同 path 创建新连接，禁止全局 path→backend 缓存。

内存根对应 `createInMemoryRecordBackend({schemas:GOAL_RECORD_SCHEMAS})` → `new InMemoryLedger({},backend)` → 同样 Goal 服务/Control。两根都经真实新 Store，不做 records→StateLedger.commit 包装。后续组装异常清理已创建资源；不借此扩大到 Host 全生命周期重构。

### 3.4 独立 suite 的真实连接

独立测试已由主 Agent 安放到 `C/tests/data/R3a-goal-record-store.test.ts`，自带并注册 `connectR3aSqlite`；原临时稿不再作为当前测试入口。不要求另造生产测试工厂。精确装配如下；计数器跨 connect 保持唯一，并与 suite 自建 GoalService 的事件前缀不同：

```ts
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { SqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { ControlEngineImpl } from '../../src/control/control-engine/control-engine.js';
let eventSequence = 0;
export async function connectR3aSqlite(path: string) {
  const backend = createSqliteRecordBackend({path,schemas:GOAL_RECORD_SCHEMAS});
  try {
    const ledger = new SqliteStateLedger({path}, backend);
    const now = () => '2026-09-23T10:00:00.000Z';
    const eventId = () => `r3a-control-event-${++eventSequence}`;
    const goals = createGoalService({records:backend.records,now,eventId});
    const control = new ControlEngineImpl({ledger,now,eventId,goalCommands:goals.legacyCommands});
    return {records:backend.records,ledger,control,close:() => ledger.close()};
  } catch (error) {
    await backend.close();
    throw error;
  }
}
```

实际调用 `defineR3aGoalTaskSqliteSuite(connectR3aSqlite)` 注册套件，不把未调用的导出当成已通过。Control.install/activate/applyPlan 沿真实治理/计划路径，Control.submit 也已显式注入新 capability。无需全平台、Kernel、外网或模拟 Store。每次 connect 同 path 是另一条真实连接；同一 connect 的 records/ledger 共享连接。

本装配的额外验收：旧单参同步构造及 beforeWrite 保持；默认/注入路径只触发一次 hook，replay 不触发；schema 重复和损坏明确拒绝、合法 Goal@2 可读；backend/ledger 重复 close 只物理关一次；旧 bootstrap→新 records 读、新 Goal→旧计划推进贯通；内存 cursor/集合在旧新提交后无分叉。真实写中故障仍用已设计 SQLite trigger，不新增生产故障 hook。

### 3.5 迁移边与路径

`legacyAccess` 仅用于旧适配共享物理 connection/状态及机械 helper，不是业务/模型 Port。未迁 kind 的 BEGIN/COMMIT/ROLLBACK 与 validator 仍在旧 Ledger；RecordStore 不接收或执行领域 transaction 回调。剩余 kind 全迁完才删除 legacyAccess，不能宣称本批已迁所有事务。

`scripts/module-map.mjs` 登记本批真实边：ControlEngine→WorkGraph、StateLedger→WorkGraph/RecordStore、WorkGraph→RecordStore，保留未迁 ControlEngine→StateLedger；不得引入 WorkGraph→StateLedger 或 RecordStore→WorkGraph。更新对应精确 ownership 测试。直接 Control fixtures 也必须装配 goalCommands，原 fold/CAS 断言迁到 Goal 服务后保留语义，不以旧 submit fallback 少改 fixture。

相对 import 按源文件位置精确计算，不把所有 core 文件统一成同一层数：

| 文件位置 | 指向 contracts | 指向 RecordStore/WG |
| --- | --- | --- |
| `src/core/record-store/*.ts` | `../../contracts/...` | 不 import WG |
| `src/core/work-graph/tasks/*.ts`、`persistence/*.ts` | `../../../contracts/...` | `../../record-store/ports.js` |
| `src/data/state-ledger/*.ts` | `../../contracts/...` | `../../core/record-store/...`、`../../core/work-graph/...` |
| `src/composition/*.ts`、`src/harness/*.ts` | `../contracts/...` | `../core/record-store/...`、`../core/work-graph/...` |
| `tests/data/*.ts`、`tests/contract-support/*.ts` | `../../src/contracts/...` | `../../src/core/...` |

## 4. 唯一领域规则与兼容 batch 的迁移次序

1. 将 `validation/bootstrap.ts::validateGoalCreateCommit` **移动**到 WG compiler，bootstrap validator 留原文件；旧 barrel 不继续实现第二份规则。先保留该纯 validator 的既有语义，不将“换目录”变成无提示的兼容收紧。
2. `buildGoalCreatedEvent/buildGoalSnapshot` 从 Control 移至 WG compiler；normalizeObjective/commandFingerprint/commandIdentityKey 继续复用 contracts 原实现。不要复制一份规范化规则。
3. 新命令路径固定生成 Project@observed、Workspace@observed、Goal@absent 三项完整 guard；不需要 identity_claim/indexGuard/ledgerHorizon。编译产生唯一 Goal record、唯一 GoalCreated event、空其它集合。
4. 旧 batch 路径先做原结构校验，再 lookup；命中原指纹即原回执，不重算 raw batch 的 fingerprint，不因 retry 的 eventId/时间/正文变化重新写入。异 fingerprint 保持 idempotency_conflict。
5. **已批准的旧 raw 输入修复：** 仅对“新身份、未曾提交”的 batch 要求精确 Project/Workspace/Goal 三项 expectedVersions（Goal=0），无缺项、重复、跨scope；snapshot必须是event的一致fold，完整正文/身份/版本一致。不合格invalid_commit。已合法入库的同指纹replay仍先返回原receipt，不因当前版本失效。该项是明确修复，不伪称纯目录迁移；不可重算raw fingerprint，不可自动补读版本替代调用者漏传的expected。
6. 确認 compiler/read集都接管后删除两个旧 `commitGoalCreate/validateGoalCreate` 的实现分支，旧 switch只剩委托（移到事务外）。未迁 validator 不删。

旧原始 Store/ledger tests 中“同identity同fingerprint但改变正文仍重放”必须保留；它验证的是回执身份语义，不等于允许新 GoalTaskPort 谎报正文指纹。

## 5. 新命令的精确执行算法

```text
admitGoalCreation(validatedCommand, optionalCallerPins):
  1. 输入clone；validateCreateGoalCommand；校验绑定身份/scope；normalizeObjective。
     由原commandFingerprint计算真实指纹、原commandIdentityKey生成goal-create键。
  2. records.lookupCommit(identityKey,fingerprint)
     命中：用receipt.cursor/eventIds恢复原GoalCreated结果并返回；不读当前Goal或scope。
     异指纹：idempotency_conflict。
     真not_found：继续；corrupt/unavailable不能当not_found。
  3. readMany([ProjectRef, WorkspaceRef, GoalRef] canonical keys)，同一读取快照及watermark。
     Project/Workspace不存在→not_found；codec/schema异常→拒绝，不能当作scope不存在。
     处理合法caller pins；保存Goal当前revision仅作兼容冲突回执fallback。
  4. fold GoalCreated@1 + GoalSnapshot@1，编译3 guards和原事件身份。
     Goal不存在由guard=null保证；不要因Goal预读存在抢先返回而越过事务内幂等机会。
  5. Store.commit(prepared)：再次lookup→CAS→写→幂等回执→COMMIT。
     committed replayed=false：返回本次已编译Goal@1 + 原receipt。
     committed replayed=true（竞态另一请求获胜）：根据原cursor/eventIds恢复原Goal@1。
     rejected：保留current冲突明细，映射旧Goal优先/预读/首项回退规则。
```

可以先判断旧caller expected是否与读取版本一致返回冲突，但仍需先lookup；不能遗漏最终事务CAS。禁止实现“先查询Goal不存在然后无guard写入”。

取消：提交前已明确取消可返回 cancelled；进入同步事务后以事务结果为准，commit成功不能被结束时 signal 改成取消。旧 CommandReceipt 没有 cancelled 新分支，不暗改旧 wire。未能取得回执的存储错误不能报告 persisted。

## 6. 幂等重放：无新表恢复原 Goal@1

原 idempotency 已有 fingerprint/event_ids_json/aggregate_revisions_json/commit_cursor。Goal-create 恰有一个事件，因此 receipt.cursor 精确定位这个 GoalCreated，`eventAt(cursor)` 可 O(1) 读取。WG 核对：

- receipt.eventIds长度为1、eventAt.eventId一致；版本/类型是 GoalCreated@1。
- 完整 projectId/goalId/workspaceId、actor/idempotencyKey 与被恢复命令身份一致。
- receipt.versions包含相同Goal完整ref的revision1；目标事件 aggregateRevision=1。
- 以事件的 workspaceId、objective、desiredState、activePlanRevision 构造原 GoalSnapshot；不拿本次重试payload、当前snapshot或当前time替代。

原事件缺失/未知schema/回执指向其它事件→明确 corrupt（GoalTaskPort映射 unavailable 并保留原因）；不重新提交，也不返回当前Goal作为近似。新提交可直接返回fold值，只有lookup或commit中的replay才精确读取原事件。

兼容界限必须说清：原生产 Control 构造的事件/快照是一致的，现有旧writer/历史fixture可证明。旧 raw validator 曾允许 event/snapshot的正文互相矛盾；若任意外部程序真的写过这种历史，且快照后来前进，现有库没有其revision1 snapshot正文，任何新实现都无法凭空恢复。这不是增加一个当前时刻result表能够补救的。R3a保证旧raw **receipt**重放不变；新GoalTaskPort从已记录GoalCreated还原创建结果，不能宣称证明了所有人为不一致历史的原snapshot。不要为这类未出现历史全库回填/重建。



## 7. 通用事务、schema、冲突和错误

### SQLite

- physical owner 统一 BEGIN IMMEDIATE → lookup identity → all record guards → append original event JSON → upsert original snapshot JSON → persist原格式idempotency → COMMIT。写顺序可沿旧实现，所有写都在一个事务。
- expectedRevision=null要求row不存在；数字0要求真实存在revision0。旧Goal@0仅在legacy compiler明确转null；Store自身不把所有0当缺失。
- guards碰到JSON损坏/未知或不一致schema，返回corrupt而非revision0；必须检查每个写key有对应guard，重复key/guard拒绝。
- CAS按完整canonical ref_key，错误current按事务内值报告。不能通过另一个连接预先CAS后再写。
- Store.schema注册验证JSON的ref/revision与EncodedRecord外层一致。Project/Workspace仅有ref/revision；Goal额外校验workspaceRef/objective/desiredState/activePlanRevision形状；Goal创建必须是null，当前Goal读取允许原PlanRevisionRef，不把合法revision2+误判成未知schema。
- 原snapshot_json没有schemaId/revision列；read由ref.aggregateType匹配已注册旧codec，再形成EncodedRecord，不ALTER或重写所有旧快照。未知类型对本窄Store读返回unsupported，旧StateLedger自己的其他类型读法继续有效。
- migrations只检查已有4表字段、主键和必要类型兼容，新库按原DDL建表。保留其它业务表；检测不兼容明确失败，绝不DROP重建。因为本批没有schema变更，不预建schema迁移登记表；未来真正DDL变更时再按正式设计加登记与迁移。
- 不新增events.eventId UNIQUE，不改变c0000000001游标算法、原幂等key与aggregate_revisions_json格式。

### 内存

复用一组状态。完整输入在首个await之前clone；读、receipt都返回值拷贝。generic commit在同步原子段完成最终lookup/CAS/写，不在中间await。尽量先完成所有验证/编码、准备新增事件和回执，再发布；若设置写阶段故障注入，用本次涉及key的undo（原Map值、旧eventLog长度、cursor）恢复，不能为每次Goal提交复制全部历史。旧kind保持当前同步执行语义。

### 异常传播

Goal的Store通用事务和未迁kind的旧adapter事务各自回滚后抛出意外异常；新GoalTaskPort可映射为unavailable，旧StateLedger/Control兼容入口继续原异常传播。不要将未知异常吞成success或空snapshot；不要仅为适配两种外部错误协议复制Goal事务。

CoreError目前没有corrupt，Goal服务可以对外unavailable并保留reason；旧invalid_commit→invalid、scope缺失→not_found、revision/idempotency冲突及currentRevision照旧。不要擅自扩大旧CommandReceipt enum。

## 8. 独立验收与真实故障测点

主 Agent写测试，dsh只实现。以下是本批有意义的增量，不要求全仓重新测量：

1. **同一真实链**：两个组合根经HumanCollaboration→Control.submit创建，原ReadModel.events/project()能显示目标；goalId与idempotencyKey不同；NFC/首尾空白与旧fingerprint一致。
2. **原结果重放**：创建后用合法计划路径推进Goal至revision2+，Project/Workspace版本也变化，再原身份重试；返回Goal@1/原objective/原cursor/eventIds，零新增事件。用instrumented Store确认lookup在scope reads前；schema非法重试仍invalid。
3. **不同身份/内容**：同Goal不同key冲突，同key不同正文idempotency_conflict；新GoalTaskPort不信任调用者提供fingerprint；旧raw同fingerprint变正文继续返回原receipt。
4. **两个SQLite连接**：对同一文件先读相同scope后同时提交同Goal，不同key只有一个成功；同key只有一事件、一个原回执，另一replayed。仅Promise.all调用同步SQLite可能自然串行，测试需barrier控制领域read与commit之间的交错，而非假称有线程并发。
5. **真正写中rollback**：在测试复制库内建立SQLite trigger，例如snapshots插入目标Goal时 `RAISE(ABORT,...)`，保证其之前events INSERT已发生；另在idempotency INSERT阶段抛错，保证事件和snapshot都曾尝试写。失败后用独立连接核对目标event/snapshot/idempotency均不存在、旧数据不变；去trigger后同key能成功一次。不在原evidence库装trigger。
6. **memory故障/隔离**：beforeWrite仍零写；若本批引入分阶段hook，event写后异常也回到同一状态；输入/结果对象修改不能污染存储。
7. **兼容库与重启**：复制真实RAT-03库或由原writer固定生成的fixture；读原refs/events/receipt，重放原命令，close/reopen后新提交序列继续。不能用新writer生成数据自称旧库证明。
8. **边界拒绝**：schemaId/JSON/ref/revision不一致、未知event schema、重复guard、缺Goal不存在guard、非空未实现claims/index字段；没有部分写入。对§4已批准的新raw输入收紧，单独新增对应断言，不放宽旧suite。
9. **共同旧suite**：旧memory/sqlite ledger契约、snapshot隔离、重放边界、Control/人机/GUI与历史库测试。Control原fold测试迁到WG后保持预期batch语义，不能删除断言只留mock委托成功。

测试后记录类型/真实模块DAG/app构建。未迁kind保留旧suite作为共享backend无退化证据；不新增外部模型调用。

## 9. 本批删什么、明确保留什么

删除（达到对应覆盖后）：

- Control 的Goal创建领域body和两个fold函数、仅它们使用的import；submit只委托，原错误映射移到WG legacy adapter而非两处各留一份。
- 两个StateLedger中的Goal专属commit/validate实现；goal-create switch移为事务外适配委托。
- `validation/bootstrap.ts` 的Goal validator及旧barrel同名导出；bootstrap内容保留。
- 重复connection/schema/物理state所有权；旧适配只引用共享底座，不维护平行副本。未迁kind事务边界暂留旧adapter，不在本批一并删除。

保留：两个旧StateLedger文件及未迁分支/事务边界、bootstrap/governance/dispatch等validator、memory ledger、旧contracts/fixtures/event/ref/cursor/存储格式、HumanCollaboration/GUI API、ReadModel投影、既有beforeWrite语义。原物理辅助方法若仍被未迁kind使用可以保留薄委托，不复制实现。

本批不宣布StateLedger、Control或ReadModel退役，也不宣布R3全部完成。


退出边界：legacyAccess、旧adapter事务边界在剩余kind迁完后删除；首批GoalTaskPort在原组件扩充后并入完整TaskPort，不另造同义服务。
