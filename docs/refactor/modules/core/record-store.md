# RecordStore：事务、正文与持久索引实现骨架

状态：目标详细设计形成于2026-09-23，当前施工位置为 `coding-platform/next/src/core/record-store/`。必要 backend、正文、注册 lookup 和材料 reader 已完成干净迁入，见[迁移验收](../../reviews/next-completed-migration-2026-09-24.md)；next 不依赖旧 StateLedger/ArtifactVault/ReadModelIndex 服务。原工程各批行为依据保留在[历史验收](../../reviews/implementation-batches.md)。本文供后续 R3/R4 独立施工，配合[公共契约](../../skeleton/CONTRACTS.md)、[核心数据](../../CORE-DATA-OPERATIONS.md)、[WorkGraph](work-graph.md)、[AgentRuntime](agent-runtime.md)。下面完整 Port/表仍是目标设计；当前实际能力以 next 代码及本轮任务书为准。

本轮实施状态（2026-09-24）：`next` 已有真实 Memory/SQLite、snapshot/事件/幂等与注册lookup。本轮只扩展 claims、ledgerHorizon 和 commitCursorBindings；indexGuards/indexChanges 仍为空 tuple，下面完整协议是后续目标而非已实现API。cursor binding仅允许schema注册的顶层 since/until，预检机械envelope和null占位，得到真实末事件cursor后完整schema验证再写入；全部失败一起回滚。详见 [Store任务书](../../tasks/R3-next-store-extensions.md)。

> **2026-09-24 适用范围纠偏：** Store 的索引、CAS 和条件事务是按消费者需要提供的原子能力，不因此要求每个 Task 在启动前解析并占用全部预测范围。下文资源分区方案保留为具体工具需要时的设计参考；本轮同步资源索引扩展已暂停，尚未新增源码。不要把它作为 R4c 连续 Session 接线的前置。

## 1. 业务目的与确定边界

一个被接受的修改必须完整保存、重试不重复、并发不覆盖，正文可按原引用读回，索引明确读到哪个水位。RecordStore 提供这些持久机制；WorkGraph 决定任务、架构、Session、证据和责任关系能否这样改变。

最终允许产品 Module 依赖：无。RecordStore 不 import WorkGraph/AgentRuntime/WorkspaceTools/Workflow，不通过回调在事务中执行它们的业务。只依赖 Node SQLite、物理存储辅助函数、共享 contracts 和调用者注入的纯编码器。

调用者仅有 WorkGraph 和 AgentRuntime。WorkGraph 获得正式事务/索引/原始正文能力；AgentRuntime 只获得技术运行记录、观测及必要正文能力，不能由通用 Store 入口写 Task、Session 占用或正式完成。Host 不把任何 raw commit/SQL/json 写入接口注册成模型工具。

保留现有数据库、身份、游标与历史 payload；目标模块合并不要求立即合库。跨正文库、领域库与 Kernel 不存在隐含原子事务。

## 2. 目标关键文件与内部依赖

```text
src/core/record-store/
  ports.ts                         # 下述四个Port和物理请求/结果
  record-codec.ts                  # 编码边界、key/schema/revision完整性
  sqlite-record-store.ts           # 正式事务、精确读取、事件和同步索引
  in-memory-record-store.ts        # 同契约测试适配，不另写业务判据
  sqlite-body-store.ts             # 原始不可变正文/来源存取
  sqlite-index-store.ts            # 异步投影行与checkpoint事务
  runtime-record-store.ts          # 技术状态/增量观测；兼容旧JSON
  legacy-readers.ts                # 原表/原JSON读适配，无业务准入
  migrations.ts                   # 明确schema版本和增量迁移
```

| 文件 | 导出/职责 | 读写/内部依赖 |
| --- | --- | --- |
| ports.ts | RecordTransactionPort、RawArtifactStorePort、RuntimeRecordStorePort、IndexStorePort | 引用共享身份；不引用上层实现 |
| record-codec.ts | RecordCodec、decode校验、key/版本一致性检查 | 复用 canonicalJson 和现有schema validator，不发I/O |
| sqlite-record-store.ts | R3a：同步 createSqliteRecordBackend；后续目标 createSqliteRecordStore | 读写主库、BEGIN/CAS/claim/index/事件/幂等；依赖codec/migrations |
| in-memory-record-store.ts | R3a：同步 createInMemoryRecordBackend；后续全量内存适配 | 同机制语义，故障注入与并发验收用；不成为额外业务真相源 |
| sqlite-body-store.ts | createRawArtifactStore | 保持artifacts内容寻址、插入获胜者、完整性验证；不执行授权政策 |
| sqlite-index-store.ts | createIndexStore | 有界行查询、整页原子更新、水位；不解释Task含义 |
| runtime-record-store.ts | createRuntimeRecordStore<R,O> | 保存技术header与codec正文，增量平台观察；不导入Runtime类型 |
| legacy-readers.ts | readLegacySnapshot/readLegacyRuntimeRecord | 保留原key/payload/文件身份，输出可核对的旧版本；不推测Session映射 |
| migrations.ts | migrateRecordStore、schema compatibility检查 | 只执行登记的schema变更；失败回滚，不删除数据库重建 |

方向是物理adapter → codec/migrations/legacy reader；adapter之间没有“为了权限再回调WorkGraph”的隐藏依赖。旧Ledger的业务校验只在迁移过渡期间留原位置，最终归WorkGraph；不能直接把整个sqlite-ledger.ts换个目录宣布分离完成。

## 3. 正式记录与通用事务 Port

下面是可信组件间的物理协议，不是业务/模型的万能命令DSL。WG内部 `persistence/record-codecs.ts` 按封闭领域union编码，提交编译器产生 PreparedCommit；模型只看到 claimTask/completeTask 等类型化操作。JSON string 是实际存储编码，不能借它绕过领域类型和schema校验。

已有 CommitCursor 来自 `src/contracts/command-event.ts`；AggregateRef、AggregateSnapshot、LedgerCommit、LedgerCommitReceipt 保持 `src/contracts/ledger.ts` 原定义，不在本页复制庞大union。旧ref key继续使用原完整引用的canonicalJson，不以局部ID重新编码。

```ts
import type { CommitCursor } from '../../contracts/command-event.js';
export type StoreError = 'invalid' | 'not_found' | 'revision_conflict' | 'index_conflict'
  | 'idempotency_conflict' | 'unique_conflict' | 'not_ready'
  | 'corrupt' | 'unsupported' | 'unavailable';
export type StoreFailure =
  | { status:'rejected'; code:Exclude<StoreError,'not_ready'|'revision_conflict'|'index_conflict'|'unique_conflict'>; reason:string }
  | { status:'rejected'; code:'revision_conflict'; reason:string;
      current:{refKey:string;revision:number|null}[] }
  | { status:'rejected'; code:'index_conflict'; reason:string;
      current:{index:DurableIndexName;partition:string;revision:number}[] }
  | { status:'rejected'; code:'unique_conflict'; reason:string;
      current:{claimKey:string;owner:string|null}[] }
  | { status:'rejected'; code:'not_ready'; reason:string;
      observed:CommitCursor|null; required:CommitCursor };
export type StoreResult<T> = { status: 'ready'; value: T } | StoreFailure;
export type EncodedRecord = {
  refKey: string; schemaId: string; revision: number; json: string;
};
export type RecordGuard = { refKey: string; expectedRevision: number | null };
export type StoredVersion = { refKey: string; revision: number };
export type UniqueClaimChange = {
  claimKey: string; expectedOwner: string | null; nextOwner: string | null;
};
export type DurableIndexName = 'session_by_task' | 'session_by_module'
  | 'session_by_work' | 'session_by_role' | 'session_by_execution'
  | 'session_by_availability' | 'task_by_plan' | 'task_forward' | 'task_reverse'
  | 'ready_task' | 'mailbox_by_recipient' | 'participation_by_work'
  | 'wait_by_subject' | 'evidence_by_task' | 'history_by_target' | 'history_by_session'
  | 'dispatch_pending' | 'architecture_out' | 'architecture_in'
  | 'work_module_by_subject' | 'work_module_by_module'
  | 'resource_by_root' | 'resource_by_shared' | 'resource_by_owner';
export type IndexRow = {
  partition: string; sortKey: string; rowKey: string; recordKey: string;
};
export type IndexChange =
  | { kind: 'put'; index: DurableIndexName; row: IndexRow }
  | { kind: 'remove'; index: DurableIndexName; partition: string; rowKey: string };
export type IndexGuard = {
  index: DurableIndexName; partition: string; expectedRevision: number;
};
export type EncodedDomainEvent = {
  eventId: string; eventType: string; schemaVersion: number;
  occurredAt: string; json: string;
};
export type PreparedCommit = {
  identityKey: string; fingerprint: string;
  guards: readonly RecordGuard[]; records: readonly EncodedRecord[];
  claims: readonly UniqueClaimChange[];
  indexGuards: readonly IndexGuard[]; indexChanges: readonly IndexChange[];
  events: readonly EncodedDomainEvent[];
  commitCursorBindings?: readonly { refKey: string; field: 'since' | 'until' }[];
  indexCommitOrderBindings?: readonly {
    index: 'mailbox_by_recipient'; partition: string; rowKey: string;
  }[];
  ledgerHorizon?: CommitCursor | null;
};
export type StoreCommitReceipt =
  | { status: 'committed'; replayed: boolean; identityKey: string;
      versions: StoredVersion[]; eventIds: string[]; cursor: CommitCursor }
  | StoreFailure;
export type RecordRead = { record: EncodedRecord; readThrough: CommitCursor | null };
export type RecordBatchRead = {
  records: EncodedRecord[]; missing: string[]; readThrough: CommitCursor | null;
};
export type EncodedEventPage = {
  afterCursor: CommitCursor | null; throughCursor: CommitCursor | null;
  events: { cursor: CommitCursor; event: EncodedDomainEvent }[]; hasMore: boolean;
};
export type IndexQuery = {
  index: DurableIndexName; partition: string;
  after: {sortKey:string;rowKey:string} | null; limit: number;
  expectedPartitionRevision?: number;
};
export type IndexPage = {
  rows: IndexRow[]; next: IndexQuery['after']; partitionRevision: number;
};
export interface RecordTransactionPort {
  read(refKey: string): Promise<StoreResult<RecordRead>>;
  readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>>;
  lookupCommit(input:{identityKey:string;fingerprint:string}):
    Promise<StoreResult<Extract<StoreCommitReceipt,{status:'committed'}>>>;
  commit(prepared: PreparedCommit): Promise<StoreCommitReceipt>;
  events(input: {afterCursor:CommitCursor|null;limit:number}):
    Promise<StoreResult<EncodedEventPage>>;
  eventAt(cursor:CommitCursor):
    Promise<StoreResult<{cursor:CommitCursor;event:EncodedDomainEvent}>>;
  readIndex(input: IndexQuery): Promise<StoreResult<IndexPage>>;
}
export type DecodeResult<T> = {status:'decoded';value:T}
  | {status:'invalid';reason:string};
export interface RecordCodec<T> {
  readonly schemaId: string;
  describe(value: T): {refKey:string;revision:number};
  encode(value: T): string;
  decode(json: string): DecodeResult<T>;
}
```

refKey、identityKey、fingerprint 与claim owner由可信codec/compiler生成，不能任意传入跨项目标识。Store验证schema注册、编码完整性、记录key/revision与外层一致，但不决定该Task是否已经通过验收。JSON解码失败返回corrupt/invalid，不当作not_found。

null expectedRevision表示记录必须不存在；数字0表示实际存在的revision 0，两者不混淆。records只写完整新版本；正式取消/删除采用领域tombstone或原有清除语义，不开放“任意删除历史快照”。每个写key必须有guard，同一提交中key不重复。

Store不返回可由调用者继续修改的内部对象。readMany在同一只读事务取得记录和readThrough。游标是原Ledger不透明CommitCursor，消费者不能把它当时间或自行加1。

readIndex 的 rows、next、partitionRevision 必须来自同一个只读事务。首批后续页传首批 expectedPartitionRevision；变化则返回 typed index_conflict，调用方丢弃该次已累积页、重读受影响分区，不能把不同版本拼成“无冲突”的集合。分区变空仍保留其版本，不重新从0开始。全部页完成后，正式提交仍 guard 首批 partitionRevision，封闭最后一页与 commit 之间的窗口。相交范围的索引分区必须覆盖所有候选，不能只查一个路径精确键漏掉祖先/后代。

Store 的 index_conflict/unique_conflict 返回失败事务中的实际分区版本/owner；WG 将这些机械冲突映射为领域 busy/revision_conflict 和授权范围内的解释，不解析 reason 字符串恢复结构。

WG在新状态准入前先lookupCommit：身份不存在为not_found，同身份不同内容为idempotency_conflict，相同内容返回原committed回执且replayed=true。操作产生的ID从稳定请求身份派生或已受理记录取回，重试不重新随机生成。WG据原引用/版本恢复原操作结果，不能用当前新版本重算成另一结果。commit内部仍重复幂等检查以封闭lookup与提交间竞态；这个窄读口不授予执行或绕过权限。

`eventAt` 使用已有事件序号主键精确读取，不新增业务索引；游标解码只在Store中执行。单事件的Goal创建可由原回执cursor和GoalCreated恢复原Goal@1，不扫描全部历史、不返回已经前进的当前Goal。CAS拒绝的current来自失败事务当时，null表示记录不存在；不能在拒绝后重读一个更新的版本代替。旧命令适配将不存在显式转为其原revision=0语义。

## 4. 事务算法、范围读取和占用

### 4.1 固定事务次序

1. 事务外完成输入schema/大小检查、codec编码与确定性fingerprint；允许注册的 commitCursorBindings 使用 null 待绑定，其余字段必须完整；不得在SQLite锁内读取工作区、调用模型、Kernel或网络。
2. BEGIN IMMEDIATE。先查幂等身份：同identity+fingerprint返回原回执；同身份不同内容拒绝。重放不能先因旧expected版本而失败。
3. 在同事务核对全部RecordGuard、UniqueClaimChange.expectedOwner、IndexGuard及可选ledgerHorizon。
4. 确定本提交事件位置，将 commitCursorBindings 绑定为本提交末事件的真实 cursor，按注册 schema 完整验证最终编码，再写快照、新事件、唯一claim与必要同步索引；同步索引分区实际变化时增加partition revision。
5. 记录完整幂等回执，COMMIT后才向外发布事件/回执。异常ROLLBACK全部，beforeWrite故障注入仍有效。

存储异常不能吞成成功/空结果。新Port可以在确认已回滚后返回unavailable；旧StateLedger适配需保持其原异常传播契约。提交响应丢失时用原身份重试，读取原回执确认，不重新计算新ID再执行副作用。

`commitCursorBindings` 是机械字段绑定，不允许 WG 在 Store 事务里回调领域逻辑。仅绑定本提交 records 中、schema 显式允许的顶层 since/until 字段，每目标至多一次且有对应 RecordGuard；有绑定却没有事件、任意 JSON 路径、覆盖非 null 值或未注册字段一律 invalid。指纹取原命令与未绑定载荷，不含尚未生成的 cursor；重放返回原已绑定结果，不再次绑定。最终解码校验失败回滚事件和所有关联。R3a 的 Goal 切片不发布/不需要此能力，待关系记录迁移时实现；禁止在 WG 猜下个 cursor 或提交后补写 since/until。

邮箱的提交顺序由有限的 `indexCommitOrderBindings` 绑定：只接受本提交 `mailbox_by_recipient` 的 put 行，匹配 partition/rowKey 且原 sortKey 为空占位；Store 在上一步确定事件位置后生成可排序的提交序号编码，同行唯一性仍用 rowKey。编码是 Store 的机械顺序，调用者只透传游标，不把不透明 CommitCursor 强转字符串排序。未匹配/重复绑定、绑定没有事件、其它索引或非空 sortKey 拒绝；与记录游标同事务回滚和重放。这样 directed_request 等没有旧 sourceCursor 的投递也可按实际提交顺序分页，不借 wall-clock 冒充总序。R3a 不发布这两种绑定字段；Goal 窄协议拒绝它们，待关系/邮箱批次再启用。

### 4.2 领域校验的读集不能丢

WG先读状态并计算动作，把所有影响准入的版本放入guards。事务CAS确保它们在落盘时仍然成立；这可以代替重复执行相同纯业务判据，但前提是读集完整。

只guard已返回行不能保护“某范围内没有其他占用/候选”。能表达成唯一关系时使用claim slot；确实依赖范围集合时guard同步索引的partition revision。尚未迁入可验证索引的旧范围规则可临时使用ledgerHorizon，允许更多冲突，不能牺牲正确性冒充精确增量。

partition revision由Store根据同事务indexChanges更新；WG的codec/compiler须确保影响该索引的所有正式变更都包含对应mutation。不得只在一种handler维护索引，而让另一条合法写路径绕过。

异步UI投影不能作为正式占用许可。readIndex返回候选/分区版本，WG仍核对所选记录及正式规则；调用方没有“查询过ready就已领取”的权限。

资源并行新增同步索引：resource_by_root 分区为可信物理根 ID，保存活跃路径范围；resource_by_shared 分区为共享资源的 namespace+ID；resource_by_owner 按完整类型化 owner 反查。初版物理根分区 guard 可让同时提交的不同路径产生短暂 CAS 重试，但重算后不相交执行应同时存在，不能把该分区做成覆盖整个执行时长的 writer 锁。路径前缀检索的祖先/后代覆盖由 WG 定义和核对；后续细分 guard 分区必须保持完整重叠覆盖。所有新增/改范围/结束/unknown/旧租约兼容写路径闭合维护这些索引。SQLite 短事务的顺序不限制 Agent 实际执行的并行。

### 4.3 Session、维护和执行的原子关系

正式SessionRecord、SessionWorkLink和CoreOperation均由WG定义/编码。ExecutionRef包含RunRef和QueryRunRef；普通query不得为了占用Session伪造Task。

同一Session的occupancy为null，或execution(executionRef,generation)，或maintenance(operationRef,generation)。执行与压缩/重组维护共用唯一slot，例如 `session-occupancy:[projectId,sessionId]`；owner编码实际typed ref和generation。Store只作expectedOwner→nextOwner条件更换，WG判断是否允许释放/接管。

| 操作 | 同事务必须保持一致 |
| --- | --- |
| 登记Kernel映射 | Session记录、CoreOperation结果、唯一adapter实例/kernelSessionId槽及查询索引 |
| 领取普通任务 | Session occupancy、TaskAttempt/Run、Task及实际资源范围占用、原有dispatch outbox及相关索引 |
| 领取query执行 | Session occupancy、正式QueryRun/其执行意图；没有虚构TaskAttempt |
| 领取maintenance | Session maintenance occupancy、CoreOperation维护意图，禁止同时执行 |
| 接受终态并释放 | 精确execution/generation结果、相应占用释放、必要后继意图和关联；旧结果不能释放新占用 |
| 归档/责任切换 | Session版本、未决责任转移/交接引用、SessionWorkLink索引；Kernel成功观察是WG准入依据 |

Kernel创建/停止发生在事务外。首次创建为WG正式操作意图→Runtime创建→WG登记映射；不能把先创建Kernel对象再写数据库的整个过程宣称原子。映射唯一键包含adapterId代表的存储实例，不仅是厂商名。

## 5. 原始正文与领域授权分离

原ArtifactRef继续来自 `src/contracts/artifact.ts`，SourceRefV1来自 `src/contracts/dispatch.ts`；PlatformMaterialOrigin新增于共享call-context。旧owner-only/grant/current-source适用性在WG材料入口维持，不在RawArtifactStore重复实现。

```ts
import type { ArtifactRef, ArtifactOwnerRunRef } from '../../contracts/artifact.js';
import type { SourceRefV1, TaskAttemptRef } from '../../contracts/dispatch.js';
import type { PlatformMaterialOrigin } from '../../contracts/core/call-context.js';
export type MaterialOrigin =
  | {kind:'run';owner:ArtifactOwnerRunRef|TaskAttemptRef}
  | {kind:'legacy';ownerRunRef:ArtifactOwnerRunRef|null}
  | PlatformMaterialOrigin;
export type RawArtifactPut = {
  body:string;contentType:string;sourceRefs:SourceRefV1[];
  origin:Exclude<MaterialOrigin,{kind:'legacy'}>;requestedAt:string;
};
export type RawArtifactRecord = {
  ref:ArtifactRef;body:string;sourceRefs:SourceRefV1[];origin:MaterialOrigin;
};
export interface RawArtifactStorePort {
  put(input:RawArtifactPut):Promise<StoreResult<{ref:ArtifactRef;replayed:boolean}>>;
  read(ref:ArtifactRef):Promise<StoreResult<RawArtifactRecord>>;
}
```

Raw入口仅向可信WG/Runtime组件开放；UI/模型拿到ArtifactRef不能直接绕过WG读取。去掉Store的领域授权回调不等于取消产品权限。WG先依据真实MaterialReader、正式grant/来源版本判断，再读正文，并在需要当前来源时做正确时点核对。

复用现有artifactBodyDigest/artifactBodySize、contentType+digest寻址和putIfAbsent获胜者。相同正文重复put不覆盖第一次owner/来源，新增使用关系由WG单独记录。旧StoredRecord缺新origin时按原ownerRunRef解码为legacy，不把null猜成某个人或新Run。

legacy仅用于读取旧记录，新put类型及运行时schema均拒绝legacy分支。WG的MaterialWriteOrigin.kind=execution在内部转成run/owner；真实Host来源使用PlatformMaterialOrigin，不伪造旧owner。

正文先持久成功，才可提交引用它的正式记录；正式提交失败可能留下未引用正文，这是可解释孤儿，不能伪造跨库原子提交。首版不自动删除无法证明无引用的正文；后续GC需明确引用/保留规则。损坏、digest/size不符返回corrupt，不以空正文降级。

## 6. 异步投影 Port 与水位

```ts
export type ProjectionScope = {index:DurableIndexName;partition:string};
export type ProjectionPage = {
  scope:ProjectionScope;afterCursor:CommitCursor|null;throughCursor:CommitCursor;
  changes:readonly IndexChange[];
};
export interface IndexStorePort {
  read(input:IndexQuery & {atLeastCursor?:CommitCursor}):
    Promise<StoreResult<IndexPage & {throughCursor:CommitCursor|null}>>;
  applyPage(input:ProjectionPage):Promise<StoreResult<{throughCursor:CommitCursor}>>;
}
```

WG根据正式事件编译投影变化；Store不解释事件的任务意义。applyPage在一个事务检查旧水位、更新所有行及新水位；失败不推进。scope内重复同一页必须核对已存页身份/摘要，不能仅凭相同throughCursor接受不同内容。

旧ReadModel整批advance事务可以先原样复用，再把领域reducer迁WG、物理行/水位迁Store。不能先删旧投影而使UI正常历史消失。同步正式索引与异步显示索引即使同名，也须明确各自DB/水位，正式claim不能信任滞后副本。

read未达到atLeastCursor返回not_ready及observed/required水位，不是not_found；调用方不得据not_ready断言没有任务/消息。applyPage的全部change必须属于scope，拒绝借一页修改别的分区。

## 7. Runtime技术记录 Port（不引入反向边）

正式CoreOperation/Run/Session状态由WG维护。这里保存平台执行适配需要的配置引用、启动观察、Kernel游标和最小技术状态，不能另立正式Operation真相源。具体RuntimeOperationRecord/RuntimeObservation由AgentRuntime定义；泛型在Host装配，Store不import该模块。

```ts
export type RuntimeOperationHeader = {operationId:string;revision:number};
export type RuntimeObservationHeader = {operationId:string;sequence:number};
export interface ObservationCodec<O extends RuntimeObservationHeader> {
  readonly schemaId:string;
  encode(value:O):string;
  decode(json:string):DecodeResult<O>;
}
export interface RuntimeRecordStorePort<
  R extends RuntimeOperationHeader, O extends RuntimeObservationHeader
> {
  readOperation(operationId:string):Promise<StoreResult<R>>;
  saveOperation(input:{record:R;expectedRevision:number|null}):
    Promise<StoreResult<{revision:number;replayed:boolean}>>;
  appendObservedDelta(input:{record:R;expectedRevision:number;observation:O}):
    Promise<StoreResult<{revision:number;sequence:number;replayed:boolean}>>;
  readObservations(input:{operationId:string;afterSequence:number;limit:number}):
    Promise<StoreResult<{items:O[];nextSequence:number|null}>>;
}
```

Host以RecordCodec<R>/ObservationCodec<O>构造适配。save/append使用operationId、revision和实际内容摘要判断重复，旧版本不同内容冲突；append同事务更新技术状态与对应平台观察，sequence唯一且连续。不能先前移lastKernelPosition再落盘观察，造成重启跳过未保存结果。

RuntimeObservation不是版本化正式聚合，使用专门的纯ObservationCodec，不为满足RecordCodec.describe而伪造正式ref/revision。初始技术revision=1，更新必须为expected+1；首个观察sequence=1，之后等于已提交末序号+1；相同序号同内容重放，不同内容拒绝。

这里operationId是技术存储键：Runtime codec从完整binding的判别类型及OperationRef，或ExecutionRef+admission generation生成稳定规范摘要，包含project/goal/query等完整身份。不能直接拿局部OperationRef.operationId或runId做全局SQLite主键。迁移旧Run使用现有keyFor的完整作用域规则核对；同一技术记录与正式操作引用不是同一个身份。

平台观察是所需RuntimeEvent/控制响应/失败摘要，原Kernel transcript仍在Kernel Store。技术读取不触发模型；消费者根据正式WG权限和原Kernel能力读取Session历史。不因新接口再复制全份Kernel事件/正文。

当前RuntimeObservationJournal按JSON保存整条RuntimeRecord，迁移先兼容旧文件读取，再切新增技术状态/增量观察存储。旧events/trace可以按序读取，不声称旧文件已经增量化；新旧双读须以明确迁移标记去重，不能把同一观察播放两次。

## 8. 巨大Ledger union和旧schema如何迁移

现有LedgerCommit是带kind的领域union，sqlite-ledger.ts同时含事务和大量领域validator。它们不是可以一次删除的冗余。迁移逐kind进行：

1. 保留原StateLedger接口与所有旧identity/ref/payload，未迁kind继续走原实现。
2. WG的legacy commit compiler接收精确LedgerCommit分支，复用原纯校验和reducer；读取完整事实，编译PreparedCommit及全部版本/范围/唯一guards。
3. 对该kind比较旧/新回执、事件、快照和拒绝语义，加入并发、故障及restart测试。尤其核对validator内部额外读取，不能只搬参数形状校验。
4. 切换该kind所有生产消费者后删除原adapter该分支业务逻辑；Store保留通用CAS/claim/schema检查。没有消费者的旧兼容入口才删除。
5. 过渡期巨union仍是兼容协议，最终域types可按WG组件收窄；不是重命名一个Store.union.ts继续让存储懂全部业务。

| 真实已有物理结构 | 兼容要求 | 新能力如何增加 |
| --- | --- | --- |
| Ledger snapshots/events/idempotency/identity_claims | 保留完整ref_key、event_json、游标与原幂等身份 | 复用事务/唯一槽；注册新增Session/Link/Operation schema |
| Vault artifacts(key,record) | 原ArtifactRef和第一次来源/owner可读 | 新origin版本化；旧记录按legacy解码 |
| ReadModel plan_graph/task_detail/active_agent等表 | 保留现有UI读取与checkpoint | 逐查询增加专用索引，不批量改写全部快照 |
| 平台按Run保存的JSON观察文件 | 原文件身份、序列及异常记录可核查 | 新技术状态/增量表与旧读取桥接，完成迁移才退役旧写者 |

目标新增最小schema如下；这些表当前不存在，必须以明确迁移新增。正式同步索引表在Ledger同一数据库，显示投影可在原ReadModel数据库创建同形表，二者不共享未经核对的水位。

```sql
CREATE TABLE core_index_rows (
  index_name TEXT NOT NULL, partition_key TEXT NOT NULL,
  row_key TEXT NOT NULL, sort_key TEXT NOT NULL, record_key TEXT NOT NULL,
  PRIMARY KEY(index_name, partition_key, row_key)
);
CREATE INDEX core_index_page ON core_index_rows
  (index_name, partition_key, sort_key, row_key);
CREATE TABLE core_index_partitions (
  index_name TEXT NOT NULL, partition_key TEXT NOT NULL, revision INTEGER NOT NULL,
  PRIMARY KEY(index_name, partition_key)
);
CREATE TABLE core_projection_checkpoint (
  index_name TEXT NOT NULL, partition_key TEXT NOT NULL, through_cursor TEXT,
  PRIMARY KEY(index_name, partition_key)
);
CREATE TABLE core_projection_pages (
  index_name TEXT NOT NULL, partition_key TEXT NOT NULL,
  through_cursor TEXT NOT NULL, after_cursor TEXT, page_digest TEXT NOT NULL,
  PRIMARY KEY(index_name, partition_key, through_cursor)
);
CREATE TABLE runtime_operations (
  operation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
  schema_id TEXT NOT NULL, record_json TEXT NOT NULL
);
CREATE TABLE runtime_observations (
  operation_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  schema_id TEXT NOT NULL, observation_json TEXT NOT NULL, digest TEXT NOT NULL,
  PRIMARY KEY(operation_id, sequence)
);
```

index_name必须来自DurableIndexName白名单；partition/row/sort key由WG明确codec生成，不接受SQL片段。新空分区revision=0；每次有效同步改变加1，重复put相同值不增版本。row分页用(sort_key,row_key)严格大于上页尾，不能用OFFSET扫描全部前页。跨多页需要一致集合时，WG携partition revision核验，否则明确候选集合可能变化。

R3a 没有 DDL 格式变更，只兼容检查/初始化原四张核心表，不预建 schema 迁移登记表。后续真正改变 schema 时，迁移记录使用独立、显式版本的schema迁移登记（版本、DDL摘要、完成时间），不能挪用已经存在的用户字段作迁移标记。每个schema迁移在事务中执行，先检查旧结构兼容；需要跨文件迁移时先备份并保存可恢复进度，不宣称多数据库原子升级。

Session正式记录可先进入现有snapshots，通过新schema codec读取；Kernel映射/occupancy优先复用identity_claims。没有现成Session表可“升级”，旧currentClaim/lastRunRef只是未实现草案，不能伪造历史迁移。实际旧Run能确认Kernel映射才登记关联，未知保持未映射。

## 9. 旧实现到新位置、装配和删除条件

| 旧符号/实现 | 目标 | 退出条件 |
| --- | --- | --- |
| SqliteStateLedger/InMemoryLedger的事务和事件游标 | sqlite/in-memory-record-store | 相关kind读集/回执/故障/重启一致后 |
| ledger-validation.ts及validation/*中的领域判据 | WG相应任务/计划/证据/协作组件与legacy compiler | 每kind消费者迁完，不复制第二套政策 |
| ledger-scope-catalog/dispatch-selection | WG查询判据+Store明确物理索引 | 范围语义与稳定顺序经真实查询验证 |
| ArtifactVault.open/material-access-policy | WG材料授权/适用性 | 所有旧Run/QueryRun及新Host读入口接通 |
| SqliteArtifactVault的putIfAbsent/正文检查 | sqlite-body-store | 旧owner/来源竞态测试与历史读取通过 |
| SqliteReadModelIndex的领域reduce/解释 | WG投影编译器 | UI与原读端口切新实现 |
| ReadModel的SQL/页事务/checkpoint | sqlite-index-store | 原页失败/去重/水位契约保持 |
| RuntimeObservationJournal | runtime-record-store兼容读/新增量写 | 真实Runtime读写/恢复切换，旧记录仍读得到 |
| memory-ledger.ts | 持久适配留Store、记忆行为归WG | 人工remember/correct/remove及删除正文语义保持 |

### 9.1 R3a 的同步窄后端（已实现并通过独立验收）

[R3a 任务书](../../tasks/R3a-goal-record-store.md) 只实施 `GoalTaskPort.createGoal` 对应的记录能力，不要求先实现下面的全量 Store。选定同步子工厂 `createSqliteRecordBackend` / `createInMemoryRecordBackend`，分别位于本页同名适配文件；返回仅 `{records,close,legacyAccess}`。records 是 `GoalRecordTransactionPort`，只含 readMany/lookupCommit/commit/eventAt，不发布其它未实现方法。

共享 schema 注册类型归 `src/core/record-store/ports.ts`；WG 的纯 `persistence/record-codecs.ts` 导出 `GOAL_RECORD_SCHEMAS`，由 Host 和旧 Ledger 兼容构造注入。Store 不 import WG。注册含完整 selector：

```ts
export interface GoalRecordTransactionPort {
  readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>>;
  lookupCommit(input: {identityKey:string;fingerprint:string}):
    Promise<StoreResult<Extract<StoreCommitReceipt,{status:'committed'}>>>;
  commit(input: PreparedCommit): Promise<StoreCommitReceipt>;
  eventAt(cursor: CommitCursor): Promise<StoreResult<{cursor:CommitCursor;event:EncodedDomainEvent}>>;
}
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
// 后续关系记录批次的全量扩展；R3a窄注册不发布/消费此能力。
export type FullEncodedRecordSchema = EncodedRecordSchema & {
  readonly commitCursorFields?: readonly ('since' | 'until')[];
};
export type FullRecordBackendSchemas = {
  readonly records: readonly FullEncodedRecordSchema[];
  readonly events: readonly EncodedEventSchema[];
};
// 各适配文件导出；Legacy access 的精确字段按 R3a §3.1，只有物理状态和机械 helper。
export type SqliteRecordBackendOptions = {
  path: string; schemas: RecordBackendSchemas; beforeWrite?: () => void;
};
export type SqliteRecordBackend = {
  readonly records: GoalRecordTransactionPort;
  close(): Promise<void>;
  readonly legacyAccess: SqliteLegacyRecordAccess;
};
export type InMemoryRecordBackendOptions = {
  schemas: RecordBackendSchemas; beforeWrite?: () => void;
};
export type InMemoryRecordBackend = {
  readonly records: GoalRecordTransactionPort;
  close(): Promise<void>;
  readonly legacyAccess: InMemoryLegacyRecordAccess;
};
export function createSqliteRecordBackend(options: SqliteRecordBackendOptions): SqliteRecordBackend;
export function createInMemoryRecordBackend(options: InMemoryRecordBackendOptions): InMemoryRecordBackend;
```

R3a 注册 Project→`ProjectSnapshot@1`、Workspace→`WorkspaceSnapshot@1`、Goal→`GoalSnapshot@1` 和 GoalCreated/schemaVersion=1。@1 是编码版本，Goal aggregate revision2+ 和合法 activePlanRevision 仍可读；原 Project/Workspace 没有 schemaVersion 字段，不能要求它们新增。旧 snapshot_json 没有 schemaId 列，按完整 ref.aggregateType 选择；不 ALTER/重写历史 JSON。重复 schemaId/aggregateType/eventType+schemaVersion 拒绝启动，未知类型与损坏编码不当作 not_found。注册是纯编码验证，无 I/O/业务准入/事务回调。

两个真实组合根先同步建 backend，再给旧构造器第二个可选参数注入它；原 `new SqliteStateLedger(options)` / `new InMemoryLedger(options)` 和 create 函数保持同步兼容，未注入时内部调用同一个子工厂。SQLite 只一条连接，内存只一组 eventLog/snapshots/idempotency/identityClaims/cursor；旧适配保留未迁 validator 和事务边界，Goal 在旧外层 BEGIN 之前委托 WG→新 Store。legacyAccess 不接收领域 transaction 回调。

`beforeWrite` 仍在校验、幂等/CAS 后第一写前调用一次；同一 backend 的新旧链共用 hook，注入时不能默默覆盖不一致选项。原 memoryLimits 和 memory_* 表仍由旧 memory-ledger 维护并共享该连接/快照，不能把“四张核心表”误解为删除其它表。

唯一物理 close 在 backend，SqliteStateLedger.close 只委托；平台原 built.ledger.close 关机位置保持，不再并列关闭 backend。此同步子后端的关闭同步释放资源并返回已完成 Promise，保持重复安全，不预造异步队列。InMemoryHarness 不新增公开 close 协议；直接拥有内存 backend 的 fixture 可关闭它。其余 kind 清零后才能删除 legacyAccess。具体构造签名、共享机械类型和测试 connect 在 R3a §3；该窄后端已实现，源码与验证范围见[2026-09-24独立验收](../../reviews/R3a-R4a-sol-dsh-acceptance.md)。

### 9.2 后续全量组合工厂（目标接口）

下列异步工厂在未来完整 Store 装配时导出；R3a 不以同名函数冒充已完成。它内部复用已迁的同步记录子工厂，再组合正文/索引/运行适配器，不新增业务总门面。schema 使用上面的共同注册格式，仍由 WG 纯 codec 适配生成、Host 注入。

```ts
export type RecordStoreDependencies = {
  paths:{ledger:string;artifacts:string;readModel:string;runtime:string;
    legacyRuntimeDirectory:string};
  schemas:FullRecordBackendSchemas;
  now:()=>string;
  beforeWrite?:()=>void;
};
export type RecordStoreHandle = {
  records:RecordTransactionPort;
  bodies:RawArtifactStorePort;
  indexes:IndexStorePort;
  runtime<R extends RuntimeOperationHeader,O extends RuntimeObservationHeader>(
    codecs:{record:RecordCodec<R>;observation:ObservationCodec<O>}
  ):RuntimeRecordStorePort<R,O>;
  close():Promise<void>;
};
export function createSqliteRecordStore(deps:RecordStoreDependencies):
  Promise<RecordStoreHandle>;
```

paths是Host从既有安装数据目录确定的存储路径，不是模型/业务请求。runtime为平台技术数据库，legacyRuntimeDirectory为已有平台Run观察目录，均不是Kernel Session数据库。内存测试适配使用同一schema/codec和端口契约，仅省略paths；beforeWrite只用于现有故障注入语义。完整工厂内部调用各物理子工厂；R3a 期间只由可信 Host/旧适配直接装配上文已明确定义的记录子后端，不把其参数暴露给模型业务。

Host先等待工厂完成schema检查/增量迁移，再把records/bodies/indexes注入WG；通过runtime(codecs)实例化窄技术端口给AgentRuntime，并只按需要提供bodies。schemaId重复注册或schema不受支持拒绝启动，不最后注册者获胜。runtime泛型由Runtime实际技术记录类型填充，Store不反向import Runtime。

只有Host持有handle.close。先停止外层驱动、持久Runtime剩余观察，再关闭Store；close停止新写入、等待已受理写队列flush，再关数据库，重复close可安全重放。普通Port无close，业务不能关闭共享存储。Workflow通过WG读取材料，不获得raw Store；源码根只交WorkspaceTools，Store不探测工作区。

先完成一个正式操作的compiler/guards/存储接线，再迁其他kind，不先造大门面包住所有旧引擎。迁移期真实module-map登记实际文件/临时边，最终目标仍只有WG/Runtime→Store；删除消费者清零的兼容层。

## 10. 验收与交付证据

复用tests/sqlite-ledger/sqlite-ledger.contract.test.ts、tests/contract-suite/state-ledger.contract.suite.ts、tests/vault/{artifact-vault,sqlite-artifact-concurrency}.test.ts、tests/sqlite-read-model/sqlite-read-model-index.contract.test.ts、tests/runtime/runtime-observation-journal.test.ts。迁移一个kind再跑相应领域场景，不用全仓通过掩盖该kind缺并发覆盖。

必须补齐：同身份同内容重放/不同内容冲突；旧expected不能阻止正确重放；两执行者或执行/维护竞争同slot仅一方成功；旧generation释放拒绝；query无需伪Task；新增范围成员使indexGuard冲突；读集遗漏检测；beforeWrite异常不留半套记录；页失败水位不前移；跨正文/领域提交失败不出现悬空成功引用。

旧数据fixtures须由当前schema写出再用新reader打开，核对ref、事件顺序、幂等回执、原owner/来源及旧Runtime观察。没有旧fixture时不能用新实现给自己生成“旧数据”证明兼容。迁移失败保留可恢复原库，禁止清库获得PASS。

性能证据记录精确key/页读取数、同一事件序列的平台实际写入字节和旧全量扫描退出范围。文件/Module数量减少不能代替真实去重。R3a同步窄后端已实现并通过[独立验收](../../reviews/R3a-R4a-sol-dsh-acceptance.md)；R3b仍在Sol骨架阶段。完整Store拆分、Session事务、增量观察及后续新schema仍待逐批落地，不能据R3a或Workspace批次的通过宣布完整Store迁移完成。
