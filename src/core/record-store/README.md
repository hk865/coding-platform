# src/core/record-store：只做机械持久化的记录、正文与索引存储层

## 负责什么，不负责什么
- 负责：按完整 canonical refKey 成组读记录；按 `PreparedCommit` 原子写记录/事件/revision guard/唯一 claim/游标绑定；注册 lookup 的翻页、计数与子串检索；原始正文的内容寻址存取；4 张核心表的初始化与兼容检查。
- 不负责：不认识 Task/Goal/Run/Session 语义，不判断授权、不选状态、不算 identity/fingerprint、不产生领域事件、不解释正文权限。
- 依赖：无（module-target.json）。不 import `src/core/work-graph`、`src/core/agent-runtime`、`src/app`、`src/business`、`src/composition`，只依赖 `src/contracts/`、`node:sqlite` 和 `node:crypto`。
- 状态迁移只经 `src/core/work-graph/state/`；本层只持久化上层已经构造好的记录和事件。
- lookup 只返回候选：调用方必须回到正式记录复核，本层不替调用方补齐过滤、去重或领域判断。

## 文件
- `body-codec.ts` — artifact 正文行的编解码：`ArtifactRef` 完整性、内容寻址 key、origin/sourceRefs/摘要与大小的机械校验。
- `body-ports.ts` — 原始正文端口与 DTO：`RawArtifactStorePort`、`RawArtifactPut`、`RawArtifactRecord`、`MaterialOrigin`。
- `body-store.ts` — 两种正文实现共用的 put/read 算法（内容寻址、先写者胜、读回校验），`ArtifactBodyRows` 是持久化 seam。
- `commit-extensions.ts` — 唯一 claim 校验/冲突、ledger horizon 比较、事务内游标绑定、事务内拒绝异常。
- `guarded-revision.ts` — 事务内用存储正文解码 guard 目标的真实 revision；invalid 只能映射为 corrupt。
- `in-memory-record-store.ts` — 内存记录 backend：同一事务语义、单份 eventLog/snapshots/claims，供内存模式与测试。
- `lookup-index.ts` — lookup 注册、请求规则、候选 key、排序/比较、全文词项与比较文本。
- `lookup-ports.ts` — 精确/有序/计数/全文四个 lookup 端口及其请求/页类型和全文边界常量。
- `migrations.ts` — 旧 4 表 DDL、逐表列/主键/affinity 兼容检查、`initRecordStoreSchema`；从不删表或重建。
- `ports.ts` — 核心机械协议：`GoalRecordTransactionPort`、`PreparedCommit`、guard/claim/receipt、记录与事件 DTO、schema 注册形状。
- `record-codec.ts` — schema 注册、JSON envelope/refKey/revision 一致性、`planPreparedCommit`、事务内游标绑定、guard 规则、幂等行与回执。
- `sqlite-body-store.ts` — `artifacts(key, record)` 表上的原子 `INSERT ... ON CONFLICT DO NOTHING` 正文实现，`close` 幂等。
- `sqlite-lookup-indexes.ts` — 每个注册 lookup 一张按 aggregateType 分区的部分表达式索引，以及开库时的增量迁移。
- `sqlite-record-store.ts` — SQLite 记录 backend：一个连接、`BEGIN IMMEDIATE` 事务、旧列/旧 JSON 字节兼容、精确 `eventAt`。
- `sqlite-sql-literals.ts` — 只接受注册期已验证的 aggregateType 与 LIMIT 字面量，避免每类查询重新规划。
- `sqlite-text-scan.ts` — SQLite 全文表（每个 text 索引一张）、缓存、开库 catch-up 与 `through` 水位。
- `text-scan.ts` — 两个 backend 共用的子串扫描、refKey 快排、内存分桶索引与回滚 undo。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `GoalRecordTransactionPort` | `src/core/record-store/ports.ts:188` | 记录存储端口：`readMany`/`lookupCommit`/`commit`/`eventAt`。 | WorkGraph/AgentRuntime 声明记录依赖时只依赖端口，不依赖具体 backend。 |
| `readMany`、`RecordBatchRead` | `src/core/record-store/ports.ts:189`、`src/core/record-store/ports.ts:138` | 一次读多个完整 key，返回 records/missing/readThrough。 | 需要成组事实时；不要另写 batch reader，也不要把 missing 当成功空事实（FP-05、M1-28）。 |
| `lookupCommit` **正本** | `src/core/record-store/ports.ts:190` | 按 identityKey+fingerprint 找已提交回执。 | 重放、提交抛错后的恢复；不要重跑提交或从今天的快照重建结果（M1-14、M1-15、M1-26）。 |
| `commit`、`eventAt` | `src/core/record-store/ports.ts:194`、`src/core/record-store/ports.ts:195` | 原子提交一个 `PreparedCommit`；按游标精确读一条事件。 | 所有记录写入与原始结果重放；不要从事件头扫描或倒推 cursor。 |
| `PreparedCommit`、`RecordGuard`、`UniqueClaimChange`、`StoreCommitReceipt` | `src/core/record-store/ports.ts:110`、`src/core/record-store/ports.ts:82`、`src/core/record-store/ports.ts:85`、`src/core/record-store/ports.ts:127` | 一次提交的全部机械内容：guard、记录、claim、事件、回执。 | 把一组耦合写入合成一个 commit；`expectedRevision:null` 表示必须不存在，数字（含 0）表示必须存在且等于该 revision。 |
| `StoreFailure`、`StoreResult`、`StoreError`、`DecodeResult` | `src/core/record-store/ports.ts:38`、`src/core/record-store/ports.ts:62`、`src/core/record-store/ports.ts:28`、`src/core/record-store/ports.ts:64` | 机械失败/结果/解码结果；conflict 带事务内观察到的 current。 | 保留 `revision_conflict`/`unique_conflict` 的现场，不要重读最新版本替换它。 |
| `EncodedRecord`、`EncodedDomainEvent`、`StoredVersion`、`CommitCursorBinding` | `src/core/record-store/ports.ts:72`、`src/core/record-store/ports.ts:102`、`src/core/record-store/ports.ts:100`、`src/core/record-store/ports.ts:91` | 存储 DTO；可绑定的游标字段只有 since/until/unavailableSince/responseSince。 | 编译 commit 与读取结果时。 |
| `EncodedRecordSchema`、`EncodedEventSchema`、`RecordBackendSchemas` | `src/core/record-store/ports.ts:154`、`src/core/record-store/ports.ts:162`、`src/core/record-store/ports.ts:168` | 注册 record/event codec、lookup 定义和可绑定字段白名单。 | 组合根建 backend 时；注册的 validate 是调用方的纯校验，不是本层的领域判断。 |
| `PersistedIdempotencyRecord` | `src/core/record-store/ports.ts:209` | 旧库幂等行的字节兼容形状。 | 只在 store 内做 idempotency 编解码/回执恢复；上层不要解析这一行。 |
| `RecordLookupPort`、`lookup` | `src/core/record-store/lookup-ports.ts:35` | 注册索引的 keyset 翻页，带 next 与 readThrough。 | 有界列表/队列；转发 continuation，不要在每页重复去重（M1-11、M1-13）。 |
| `RecordOrderedLookupPort`、`lookupOrdered` | `src/core/record-store/lookup-ports.ts:67` | 按 (order, refKey) 有序翻页，可带 direction/bound；`lowerBound` 是不分方向的下界，倒序续页要停在某个值之上时用它。 | 需要稳定顺序与续页时；不要扫描无界页来凑一页过滤结果，也不要先探测再在读的一侧比对停止行。 |
| `RecordCountPort`、`countLookup` | `src/core/record-store/lookup-ports.ts:88` | 相等条件计数或 distinct 计数。 | 只要数量时；不要用翻页自行计数。 |
| `RecordTextSearchPort`、`searchText` | `src/core/record-store/lookup-ports.ts:129` | 注册全文索引的子串检索，返回 complete/readThrough。 | 笔记/文本检索；不要另建 FTS 或在前端重扫。 |
| `RecordLookupIndex`、`RecordLookupRequest`、`RecordLookupPage`、`LookupValue` | `src/core/record-store/lookup-ports.ts:5`、`src/core/record-store/lookup-ports.ts:22`、`src/core/record-store/lookup-ports.ts:29`、`src/core/record-store/lookup-ports.ts:21` | lookup 注册与请求/页形状。 | 定义索引或调用精确 lookup 时。 |
| `OrderedLookupRequest`、`OrderedLookupValue`、`RecordOrderedLookupPage` | `src/core/record-store/lookup-ports.ts:46`、`src/core/record-store/lookup-ports.ts:45`、`src/core/record-store/lookup-ports.ts:61` | 有序 lookup 的请求/续页形状。 | 有序列表、队列、历史翻页。 |
| `RecordCountRequest`、`RecordCountResult` | `src/core/record-store/lookup-ports.ts:82`、`src/core/record-store/lookup-ports.ts:87` | 计数请求与结果。 | 调用 count 端口时。 |
| `TextSearchRequest`、`TextSearchPage` | `src/core/record-store/lookup-ports.ts:113`、`src/core/record-store/lookup-ports.ts:122` | 全文请求与页（含 complete）。 | 调用 searchText 时。 |
| `TEXT_SEARCH_PAGE_MAX`、`TEXT_SEARCH_MAX_TERMS`、`TEXT_SEARCH_TERM_MIN`、`TEXT_SEARCH_TERM_MAX` | `src/core/record-store/lookup-ports.ts:101`、`src/core/record-store/lookup-ports.ts:102`、`src/core/record-store/lookup-ports.ts:103`、`src/core/record-store/lookup-ports.ts:104`、`src/core/work-graph/model/note-contracts.ts:46` | 全文检索边界：单页 100 条、1–8 个词、每词 2–64 码点。 | 校验全文请求；`TEXT_SEARCH_MAX_TERMS` 在 WorkGraph 另有一份同值常量，正本待 lead 定。 |
| `RawArtifactStorePort`、`RawArtifactPut`、`RawArtifactRecord`、`MaterialOrigin` | `src/core/record-store/body-ports.ts:23`、`src/core/record-store/body-ports.ts:10`、`src/core/record-store/body-ports.ts:17`、`src/core/record-store/body-ports.ts:7` | 原始正文端口：put 内容寻址、read 校验；origin 只记录来源，不解释授权。 | Runtime/WorkGraph 存取 artifact 正文时。 |
| `RawArtifactBodyStore` | `src/core/record-store/body-store.ts:24` | 内存正文实现，共享 put/read 规则，Map seam 可替换。 | 内存存储的组合根或测试。 |
| `createSqliteRawArtifactStore` | `src/core/record-store/sqlite-body-store.ts:25` | SQLite `artifacts` 表实现，`close` 幂等。 | 持久化内容寻址正文时。 |
| `createInMemoryRecordBackend` | `src/core/record-store/in-memory-record-store.ts:71` | 内存记录 backend，同一事务契约，支持 `beforeWrite`。 | 内存模式与测试；不要把它当第二个业务真相源。 |
| `createSqliteRecordBackend` | `src/core/record-store/sqlite-record-store.ts:111` | SQLite 记录 backend，一个连接、事务、部分表达式索引。 | 持久模式；组合根唯一创建处。 |
| `isArtifactRef` | `src/core/record-store/body-codec.ts:59` | 校验完整 `ArtifactRef`（kind/contentType/digest/sizeBytes/source）。 | WorkGraph 解码嵌套 artifact ref 时复用，不要另写一份。 |
| `compareRefKeys` | `src/core/record-store/lookup-index.ts:587` | 按 canonical refKey 的 UTF-8 字节序比较。 | 排序/合并 canonical key；不要用 JS 默认字符串序。 |
| `compareRefKeysFast` | `src/core/record-store/text-scan.ts:46` | 同一字节序的免分配实现，ill-formed 时回退 Buffer。 | 内存全文扫描/热路径；与 `compareRefKeys` 同一排序规则，正本待 lead 定。 |
| `normalizeSearchText` | `src/core/record-store/lookup-index.ts:653` | NFC 后只把 ASCII 大写转小写。 | 全文检索两侧归一化。 |
| `bigramWindows` | `src/core/record-store/lookup-index.ts:662` | 无空白的两码点窗口集合。 | 笔记视图/文本候选构造。 |
| `searchTextFrom` | `src/core/record-store/lookup-index.ts:679` | 把注册的 text paths 拼成比较文本并归一化。 | 建/查全文文本时。 |
| `decodeTextTerms` | `src/core/record-store/lookup-index.ts:699` | 1–8 个、每词 2–64 码点、无空白的词项规则。 | 端口和 read model 共用；不要另写词项校验。 |
| `textMatches` | `src/core/record-store/text-scan.ts:67` | all/any 子串匹配。 | 全文扫描与 read model 复核。 |
| `decodeTextSearchAfter` | `src/core/record-store/lookup-index.ts:751` | 续页 key 必须是本 aggregateType 的完整 canonical refKey。 | 全文检索续页。 |
| `messageOf` | `src/contracts/error-message.ts:2` | `Error.message`，否则 `String(error)`；转换抛错不吞。 | 本层与上层拼 reason；直接 import contracts，不要为它 import RecordStore。 |
| `bindPreparedRecords` | `src/core/record-store/record-codec.ts:695` | 事务内把真实末事件 cursor 绑到注册的 null 字段，再做最终 schema 校验。 | 只有两个 backend 在 commit 内调用；上层写 null 占位 + bindings，不要自己填 since/until（CS-01、CS-08、CS-10）。 |
| `bindCommitCursor` | `src/core/record-store/commit-extensions.ts:113` | 机械绑定：形状、重复、白名单、null 占位检查。 | 同上，事务内；不要绕过它手改记录 JSON。 |

## 内部用
- `body-codec.ts`：`ArtifactBodyCodecError`、`artifactBodyKey`、`encodeArtifactBodyRow`、`readEncodedArtifactRef`、`decodeArtifactBodyRow`。
- `body-store.ts`：`ArtifactBodyRows`（持久化 seam，只由两种正文实现提供）。
- `commit-extensions.ts`：`COMMIT_CURSOR_FIELDS`、`RejectedInsideTransaction`、`validateUniqueClaims`、`findClaimConflicts`、`ledgerHorizonMatches`。
- `guarded-revision.ts`：`decodeGuardedRevision`。
- `lookup-index.ts`：`AGGREGATE_TYPE_PATTERN`、`RecordLookupRegistrationError`、`createRecordLookupRegistry`、`decodeLookupRequest`、`decodeOrderedLookupRequest`、`decodeCountRequest`、`orderedRangePlanOf`、`encodeLookupValues`、`lookupIndexKeyOf`、`distinctLookupValueKeyOf`、`orderedLookupCandidateOf`、`lookupMatcherOf`、`compareOrderedValues`、`matchesOrderedRequest`、`decodeTextSearchRequest`。
- `migrations.ts`：`CORE_TABLE_DDL`、`checkRecordStoreSchema`、`initRecordStoreSchema`。
- `record-codec.ts`：`invalidFailure`、`notFoundFailure`、`idempotencyConflictFailure`、`corruptFailure`、`unsupportedFailure`、`revisionConflictFailure`、`uniqueConflictFailure`、`isJsonObject`、`isNonEmptyString`、`isRevision`、`RecordSchemaRegistrationError`、`createRecordSchemaRegistry`、`parseJsonObject`、`decodeRefKey`、`decodeRecordBody`、`decodeStoredEventBody`、`decodeEventBody`、`applyRecordSchema`、`applyEventSchema`、`planPreparedCommit`、`guardIsSatisfied`、`checkPersistedIdempotencyRecord`、`clonePersistedIdempotencyRecord`、`storedVersionsOf`、`committedReceiptFromIdempotency`。
- `sqlite-lookup-indexes.ts`：`LOOKUP_INDEX_RULE_VERSION`、`migrateLookupIndexes`。
- `sqlite-sql-literals.ts`：`aggregateTypeTerm`、`literalLimit`。
- `sqlite-text-scan.ts`：`TEXT_SCAN_RULE_VERSION`、`StatementGetter`、`SqliteTextScanPage`、`SqliteTextScan`、`createSqliteTextScan`。
- `text-scan.ts`：`textScanRowOf`、`scanEntries`、`createTextScanIndex`、`bucketOf`、`loadBucket`、`clearTextScanIndex`、`putLoadedRow`、`moveCatchUpRow`、`putIndexRow`、`removeTextScanRow`、`captureTextScanRow`、`restoreTextScanRow`、`mergePending`。
- `lookup-ports.ts` 的 `TEXT_SEARCH_*` 常量只给本层 decode 用，已在上表列出；`ports.ts`/`lookup-ports.ts`/`body-ports.ts` 的其余类型都在上表。

## 不要做
- 不要在上层另写 store、receipt、翻页或记录解码：先依赖端口；编码、guard 和游标绑定由本层 `planPreparedCommit`/`bindPreparedRecords` 负责，不要复制。读取失败不是空事实（FP-05、M1-28、M1-11、M1-12、M1-13）。
- 不要在 store 里放领域规则或状态迁移：Task/Goal/Run 的构造与迁移只在 `src/core/work-graph/state/`（AGENTS 第 9 条）；本层不 import 上层。
- 不要把缺失记录当 revision 0：`RecordGuard` 的 null 是“必须不存在”，数字（含 0）是“必须存在且等于该 revision”；缺失与 revision 0 是两件事。
- 不要手填提交游标：记录里先留 null 占位，再用 `commitCursorBindings`，事务内绑定后做最终 schema 校验（CS-01、CS-08、CS-10）。
- 不要在 store 外重建回执或重放：用 `lookupCommit`/`eventAt`；恢复时不要把 lookup 失败当“未提交”（M1-14、M1-15、M1-26）。
- 不要重写 idempotency/快照的编码，也不要重新序列化旧记录：保持旧列/旧 JSON 的原字节（CS-01、CS-08、CS-10；另写事件/记录构造的同类错误见 M1-37）。
- `lookupReceipt` 不是本层导出：它只是 `src/core/work-graph/queries/query-job-service.ts:413`、`src/core/work-graph/tasks/completion.ts:174`、`src/core/work-graph/evidence/evidence-service.ts:465` 各自的私有包装；不要把它写成 `ports.ts` 的端口，收拢前按各 owner 的代码使用。
