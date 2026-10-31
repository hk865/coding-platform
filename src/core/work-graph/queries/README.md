# src/core/work-graph/queries：QueryJob/QueryRun 的提交、执行写入与请求轮次读取（L4）

## 负责什么，不负责什么

- 负责：pending `QueryJob`+`QueryRun` 的提交与读取；Query 执行的 claim、prepare、entry、model request、usage、observation、answer、recovery；一次请求全部轮次的事实读取。
- 不负责 Query 生命周期状态的构造与推进：pending pair、phase、settle 在 `src/core/work-graph/state/query-run-recovery.ts:533` 的 `newPendingQueryRecords` 等构造器里；本层只调用。Session 准入在 `src/core/work-graph/state/session-availability.ts`，材料适用性在 `src/core/work-graph/materials/applicability.ts`。
- 允许依赖 `model`、`state`、`persistence`、`materials`、`sessions`；不得 import `tasks`、`notes`、`evidence`、`communication`、`views`、`agent-runtime`、`app/`、`business/`、`composition/`（`docs/refactor/module-target.json`）。
- 状态写入只经 `state/`（根 `AGENTS.md` 第 9 条）。失败的读不得变成空事实、成功或 `not_found`（FP-05、M1-12、MH-06）。

## 文件

- `contracts.ts` — `QueryJobPort`/`QueryExecutionPort` 及提交、执行、recovery 的输入/依赖类型；`QueryJobDependencies.eligibility?` 是给直接咨询准入预留的只读缝（三个非消息投递事实由 B 产出、L 注入），不另立准入规则。
- `query-job-service.ts` — pending QueryJob 的提交/读取（幂等提交、原收据恢复），并把 claim/answer 转给执行端口；`submit` 的咨询分支读 B 的 `readDeliveryEligibilityFacts` 并调用完整的 `deliveryEligibility`；`deps.eligibility === undefined` 即 `unsupported`（facts 缺失/未就绪分别为 `not_found`/`incomplete`），不可投递按 `deliveryBlockCode`/`reason` 拒绝，并用读到的消息 revision 作 `consultationMessageGuard` 复核。
- `query-execution.ts` — 唯一的 Query 执行写入器：claim 到 answer、观察、reconcile/unknown 恢复；准备期读取：请求轮的目标取请求事实的 `effectiveGoalId`（确认草稿的归属轮把有效目标移到新目标），空时按调用 scope 读 Workspace，非空时走目标分支并连同该目标的活动 Plan 一起冻结；普通 Query 仍取 `job.goalId`，绑定复核只比较 Workspace。`beginEntry` 在读过 Session/预备记录之后、任何提交之前读一次 Session 的交接 fence（失败/损坏为 `unavailable`，不写）：fence 被持有且是请求轮时走 `requestAbandon` 的 `fenced` 触发器（新 pending attempt、释放占用、无 fence claim）；被持有且是普通 Query 时由本层用 `settleQueryRunRecord` 的 `not_entered`（`closeMessage: session_handoff_fence`，history 不变）加 `releaseUnenteredQuerySession` 一次提交结束（无路由、无活动）。真正开始的两次提交（普通、吸收 batch）各自把 `handoffFenceGuard` 追加到 claims；abandon 与过期迁移不加。请求轮在 `loadQueryManifest` 之后重读 `[round, ...batch]` 的载体 Job 和每个 `command.operation`（导出的 `currentUnderstandingMaterials` 与 `currentUnderstandingOperations` 各读一次，缺失或损坏即 `unavailable`），用同一 `liveUnderstandingGrants` 规则与 manifest 冻结的 `understandingGrants` 比较；不同即由 `beginEntry` 自己原子迁移（`requestRetry` + `releaseUnenteredQuerySession`，并入本轮 Job/Run/Session 的 pins，旧 manifest 不改，返回 abandoned busy），相同则把载体/operation 的 guards 并入进入提交。进入、终态和 QRR-04/05 的收尾提交在同一个 commit 里并入回复/到期轮的消费 fragment（`messages`/`messageWrites` 缺省时跳过，不失败关闭）；终态提交与 QRR-04/06 的收尾提交在同一 commit 里用 `planQueryActivityWrite` 写 `QueryActivity`（无额外事件），调用方没给 tally 时写显式 unknown（`history_read_failed`），不跳过；请求轮的 `goalId` 取准备提交冻结的 `prepared.requestEffectiveGoalId`，其他 Query 取 `intent.goalId`；QRR-01/02/05 不写。`expectedQueryCallKinds` 对 `intervention_planning` 只回这一个调用种类；`freezesGoalPlan` 把它与请求轮一样算作冻结目标活动 Plan 的轮次。
- `query-record-codecs.ts` — QueryJob/QueryRun/Query 事件的编码、解码、索引槽与后端 schema 注册；QueryJob 的 `understanding` 字段与旧形状都由同一个 normalizer 读取（缺字段读成 null，旧形状只映射一次，损坏即拒绝），manifest 的 `briefRef`/`understandingGrants`/材料 `command` 在同一检查里校验；一并注册 `persistence/query-activity-codecs.ts` 的 `QueryActivity` 记录/事件和新的 workspace ended 索引。
- `request-rounds-read.ts` — 一个请求的全部轮次、owner/后继、发起人、effective goal 与 guards 的完整读取；`COMPLETE_READ_ATTEMPTS` 是有界重读次数；`compareCursors` 从这里转出，正本在 `src/contracts/ledger.ts:142`（本层不另写比较），`sameCursor` 是本层对可空游标的比较。
- `platform-facts.ts` — 7B-3 的平台事实：`readConsultationCreate` 按创建 operation 读冻结的 consultation 载荷（不是创建、或载荷为 null 答 `not_found`），Q 的准备调用它；`createConsultationFactsReader` 是唯一的采集器（有界一遍：源历史、Goal/PlanRevision、每个 task 的最新 Run、≤20 条消息，失败进 `unreadable`/`omitted`，永不产出 `event`）；`ConsultationHistoryPort`/`ConsultationHistoryReadV1` 是历史读的契约，实现在 R。
- `secretary-answer.ts` — 秘书一轮回答的纯检查（slice-6 L7）：`semantic_query` 的严格 JSON 对象，`initial_coordination` 的 v2 回答加顶层草稿和顶层 `planDraftIndex`；草稿的 `screening` 按 `GoalScreeningShape` 判、原样保留。
- `request-round-claims.ts` — 两个请求写入者（`tasks/request-service.ts` 与 `query-execution.ts`）共用的纯计划：记录键、请求根、`request-tail` 空操作 claim，起跑检查和请求轮 not-entered 恢复要提交的记录、claim 与 guard；abandon 的触发器除 owner 变化/归档外还有 fence 持有的 `fenced`（本地类型带上该字面量，经 `newAttempt` 落到状态构造器）；回复/到期轮进入时的消费计划（`enteredConsumptionCommands`）也在这里，它只产出命令和 claim，由邮箱写入者 `prepare` 编码。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `queryTextProblem` | `src/core/work-graph/queries/query-job-service.ts:92` | 所有 Query/请求文本的规则：非空、≤16 KiB UTF-8、不 trim | 任何 Query/请求文本入口；不要另写文本校验 |
| `createQueryJobService` | `src/core/work-graph/queries/query-job-service.ts:893` | pending 提交/读取端口；可选注入执行端口转发 claim/readAnswer | composition 装配 QueryJob 端口 |
| `lookupCommittedReceipt` | `src/core/work-graph/persistence/receipt-lookup.ts:18`（本模块 `query-job-service.ts` 转出） | 唯一的提交收据查找：按 identity/fingerprint 调 `lookupCommit`（`src/core/record-store/ports.ts:190`），把 missing/conflict/invalid/unavailable 分类；**正本** | 提交前查重；提交抛异常后只按 identity/fingerprint 查原收据恢复，绝不重试（M1-14、M1-15、M1-26） |
| `createQueryExecution` | `src/core/work-graph/queries/query-execution.ts:1247` | 唯一 Query 执行写入端口：claim/prepare/entry/model/usage/observation/answer/recovery；claim 只收没有执行状态的 Run（已 claim 或已 prepare 的 attempt 答 `busy`）；请求轮的起跑提交输给先提交的请求命令（tail 或 intake 被移动、读过的记录变了，答 `revision_conflict`）时重读再判，最多 `SECRETARY_TAIL_RETRIES` 次 | composition 注入执行端口；Runtime 只经端口调用 |
| `queryClaimDispatchProblem` | `src/core/work-graph/queries/query-execution.ts:265` | Query claim 的 Session 排除：archive 请求/Work wait 为 busy，只读副本只允许自己的 consultation Query | claim 前的准入判断 |
| `readConsultationCreate` | `src/core/work-graph/queries/platform-facts.ts:38` | 读一个创建 operation 冻结的 consultation 载荷；不重新采集、不重读源线 | Q 准备 consultation Query 时；不要另写第二个读 |
| `createConsultationFactsReader` | `src/core/work-graph/queries/platform-facts.ts:217` | 唯一的咨询事实采集器：先读源线的有界历史，再一次 Goal/任务图、每个 task 的最新 Run 与 ≤20 条消息，冻结正文；只产 `task`/`body`/`record`，不产 `event` | CS 的创建 arm 注入；不要另写采集或第二份模式判断 |
| `readRequestRounds` | `src/core/work-graph/queries/request-rounds-read.ts:226` | 一个请求根的全部轮次：稳定水位重读、规范重读、QueryRun/owner/后继/initiator/guards | 需要一次请求的完整事实快照时；不要自己拼多页 |
| `deriveRequestOwner` | `src/core/work-graph/queries/request-rounds-read.ts:157` | 由全部轮次与已读 Session 事实推 owner/ownerState/lastOwner；archived owner 沿 handoff 找 live 后继 | 读请求 owner；不要自己再写后继规则 |
| `compareRequestRounds` | `src/core/work-graph/queries/request-rounds-read.ts:96` | 轮次顺序：`since` 后按规范 key；只取 `ref` 与 `since` 两项，所以只带这两项的候选也按它排 | 排序轮次时（含请求队列跨 pass 带着的候选） |
| `deriveEffectiveGoalId` | `src/core/work-graph/queries/request-rounds-read.ts:434` | 取最新非空 `goalAttribution`，否则请求自己的 goal | 请求事实投影 |
| `deriveCoveredByDrop` | `src/core/work-graph/queries/request-rounds-read.ts:450` | 被后续 drop 轮覆盖的轮次 ref 列表 | 请求事实投影/取消判断 |
| `oldestPendingRound` | `src/core/work-graph/queries/request-rounds-read.ts:464` | 最老的 pending 非 routing 轮，按 `since`、再按规范 key；**正本**（6A-1 已合成一份，不列副本） | 请求 intake、未分配 drain 和 Workflow 选最老 pending；调用方各自投影快照或 ref |
| `canonicalKey` **正本** | `src/contracts/fingerprint.ts:59` | 记录 ref 的规范 key（规范 JSON，不可编码时抛错） | 写 `request-tail`/intake claim 与比较记录 key；本层和 `tasks` 都直接 import 这一份，不要另写编码 |
| `rootOfFacts` | `src/core/work-graph/queries/request-round-claims.ts:49` | 一次请求的根轮 ref | 写 `request-tail` claim 时取请求根；本层不能 import `tasks`，两边都用这一份 |
| `noopTailClaim` | `src/core/work-graph/queries/request-round-claims.ts:44` | 不加轮也占住 `request-tail` 的空操作 CAS，排除并发 append | 不加轮的请求提交（`end_unbound`、被 drop 覆盖的轮结束） |
| `requestStartCheck` | `src/core/work-graph/queries/request-round-claims.ts:66` | 起跑检查：attempt 的 Session 必须是请求当前 owner；owner 已归档先于换人判定 | entry 前；不 pass 就放弃本 attempt |
| `requestStartPass` | `src/core/work-graph/queries/request-round-claims.ts:96` | 起跑通过的一次提交：吸收冻结的批轮、释放各轮自己 `intakeSession` 的 key、合并冻结 guard；本轮前一次 attempt 已吸收的批轮只留冻结 guard，不再吸收、不再释放 | 请求轮进入 entering |
| `requestAbandon` / `requestRetry` | `src/core/work-graph/queries/request-round-claims.ts:159`、`src/core/work-graph/queries/request-round-claims.ts:179` | 结束本 attempt、同一 Job 开新 pending Run（`newAttempt`）；放弃时释放旧 attempt 的 Session 占用 | owner 换人或归档时放弃；QRR-01/02 未被 drop 覆盖时重试 |
| `coveredByDrop` / `requestDroppedEnd` | `src/core/work-graph/queries/request-round-claims.ts:188`、`src/core/work-graph/queries/request-round-claims.ts:198` | 轮是否被 drop 覆盖；覆盖时按 `cancelled`/`dropped` 结束未开始的轮 | QRR-01/02 请求轮的 not-entered 收尾 |
| `enteredConsumptionCommands` | `src/core/work-graph/queries/request-round-claims.ts:249` | 回复/到期轮进入 Kernel 后要并入同一次提交的消息消费计划：重读后的消息、`query_entered` 证据、`wait-consumed` claim（`expectedOwner: null`、`nextOwner: inputId`）；已接受的输入按 `deriveSessionInputId` 视为重放并跳过；纯函数，不读 store、不取时钟 | 进入/终态/reconcile 提交并入 `MessageCommandWritePort.prepare` 的 fragment 时；不要另写投影或第二份 claim |
| `beginReplayAnswer` | `src/core/work-graph/queries/query-execution.ts:711` | 重复的 begin 按第一次提交的事件作答：进入恢复 ticket；请求轮起跑发现别的 owner 而放弃的（`observed`）走和第一次相同的 `busy`；begin 的三个回执入口（开头的查找、提交时库重放的回执、提交抛错后查到的回执）都按已提交的事件作答，不按本次调用打算写的操作 | begin 的回执重放；不要只认 `entering` |
| `buildRecordedEvent` | `src/core/work-graph/queries/query-execution.ts:603` | 唯一的 Query 执行事件构造，已经导出；新 attempt 的 pending Run 用 `createsPending` 记成 `pending`、无执行状态；一次提交写多个事件时（起跑吸收的轮、新 attempt 的 pending Run、终态的 Answer），带本次结果的事件写在最后（收据游标指提交的最后一个事件，重放读它）；**正本**（6A-1 已合成一份，不列副本） | 写 Query 执行事件时；不要另写 `QueryExecutionRecordedEventV1` 字面量（M1-37） |
| `encodeQueryJobSnapshot` / `decodeQueryJobSnapshot` | `src/core/work-graph/queries/query-record-codecs.ts:1038`、`src/core/work-graph/queries/query-record-codecs.ts:1048` | QueryJob 记录的纯编码/解码；编码派生索引槽，解码校验后剥掉 | 读写 QueryJob 记录 |
| `encodeQueryJobSubmittedEvent` / `decodeQueryJobSubmittedEvent` | `src/core/work-graph/queries/query-record-codecs.ts:1109`、`src/core/work-graph/queries/query-record-codecs.ts:1114` | 提交事件的编码/解码，带 writer 生成的 identity/fingerprint 镜像 | 提交事件与历史读 |
| `encodeQueryJobAnswerSnapshot` / `decodeQueryJobAnswerSnapshot` | `src/core/work-graph/queries/query-record-codecs.ts:1129`、`src/core/work-graph/queries/query-record-codecs.ts:1159` | 答案快照的编码/解码；草稿的 `screening` 按 `GoalScreeningShape` 复检（`null` = 未筛选），`planDraftIndex` 必填（`null` 或指向自己的草稿，没有旧格式缺省） | 写/读 Query 答案 |
| `encodeQueryExecutionRecordedEvent` / `decodeQueryExecutionRecordedEvent` | `src/core/work-graph/queries/query-record-codecs.ts:1171`、`src/core/work-graph/queries/query-record-codecs.ts:1208` | 执行事件的编码/解码；payload 保留原始 result、phase、executionState | 执行写入与 replay |
| `encodeQueryRunSnapshotRecord` / `decodeQueryRunSnapshotRecord` | `src/core/work-graph/queries/query-record-codecs.ts:1259`、`src/core/work-graph/queries/query-record-codecs.ts:1269` | QueryRun 记录的编码/解码；复用 materials 的 `QueryRunSnapshot@1` 校验 | 写/读 QueryRun 记录 |
| `queryRunRefFromValue` | `src/core/work-graph/queries/query-record-codecs.ts:194` | 从未知值读出完整 `QueryRunRef`（`aggregateType` 为 `QueryRun`，四个 id 非空），否则 null | 记录、事件和写入请求里的 QueryRunRef；不要另写解析 |
| `parseSecretaryAnswer` | `src/core/work-graph/queries/secretary-answer.ts:65` | 秘书回答格式：`semantic_query` 是整段文本一个 JSON 对象，只含 `schemaVersion` 1、非空 `body`、0/2/3 个思路（标题一行 ≤120 码点、说明 ≤600 码点）和 `goalCardDrafts`（有目标的请求只能 `[]`）；整段文本外层恰是一个代码框（三个反引号加可选语言词、内容、结束三个反引号）时先剥掉这一层再解析，框前后有文字或不止一个框仍拒绝（97-1 将替换这个过渡做法）；`initial_coordination` 用 `parseInitialPlanningResponseV2` 判外层，正文是整段 v2 文本，思路恒 `[]`，有目标的请求不得出现 `goalCardDrafts` 字段，无目标的可缺省；思路规则用 `model/request-ideas.ts` 的 `ideasIssues`，另加模型格式的字段白名单；草稿可带模型给的 `screening`（用 `GoalScreeningShape` 判，缺省或 `null` 即未筛选，原样保留）；无目标的 `kind: 'plan'` 回答至少带一张草稿，并带顶层 `planDraftIndex`（必须指向自己的草稿；`needs_decision` 和有目标的请求都不许），有目标的请求的无草稿 plan 与 `needs_decision` 都没有就是 `null`；失败一律 `protocol` 带原因。空和超长文本由 Runtime 观察先判，不进这里 | request round 的最终文本；不要另写回答解析。存储时 codec 另按存储形状复检 |
| `goalCardDraftCheck` | `src/core/work-graph/queries/secretary-answer.ts:164` | 一张 `goalCardDrafts[]` 的规则：字段白名单、非空 objective、至少一条非空 completion、autonomy 和 `screening` 形状；返回解析后的草稿或第一个问题的原文 | `draftsOf` 与提交内容逐张草稿检查共用；不要另写草稿规则 |
| `planDraftIndexOf` **正本** | `src/core/work-graph/queries/secretary-answer.ts:121` | 无目标 `initial_coordination` 的 plan 答案如何命名自己的草稿：缺字段时 plan 带草稿必须给索引，`needs_decision` 和有目标的请求不得给，给了必须是自己的草稿索引；返回索引、`null` 或原因原文 | `parseSecretaryAnswer` 与 `answer-tools.ts` 的填表检查共用；不要另写 `planDraftIndex` 规则 |
| `queryManifestProblem` | `src/core/work-graph/queries/query-record-codecs.ts:748` | 准备好的 Query manifest 的形状检查：目标可空只限 secretary、`request` 必填且与 callKind 一致、batch 材料完整（每轮材料带 `command`，缺键即拒绝）、`focusPlan` 必填（显式  或 Plan pin，缺键即拒绝），`briefRef` 是 OperationRef 或 null，`understandingGrants` 每条是 GoalRef；pin 只在有目标时出现且是本项目的 Plan | 读取或提交一个 prepared manifest 时；不另写 manifest 校验 |
| `loadQueryManifest` | `src/core/work-graph/queries/query-execution.ts:534` | 读一个已准备 Query 绑定的 manifest：核对 owner（本 QueryRun）、字节、摘要、形状、prompt set 和输入摘要 | 要读绑定 manifest 的地方（秘书 QueryRun 解析器从它取准备时冻结的 Plan）；不另写 manifest 读取 |
| `legacyTemplateDutyOf` **正本** | `src/core/work-graph/queries/query-execution.ts:119` | 旧模板 Session 角色 ref 固定的职责：只有五个版本化模板 `platform-<duty>@s3.1` 有，别的 ref 没有 | Query 执行和 `tasks/execution-entry-service.ts` 的任务入口检查都用这一份；不要再写副本 |
| `QUERY_JOB_RECORD_SCHEMAS` | `src/core/work-graph/queries/query-record-codecs.ts:1375` | Query 后端的 records/events/lookups 注册表 | composition 注册后端；不要另建注册表 |
| `S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP` | `src/core/work-graph/queries/query-record-codecs.ts:85` | 按 Session generation 取最近/分页 QueryRun 的索引名 | tasks/views 的分页查询 |
| `S5_QUERY_JOB_BY_GOAL` | `src/core/work-graph/queries/query-record-codecs.ts:90` | 一个 Goal 在 workspace 里的 QueryJob 索引名 | tasks 的问题读取 |
| `S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP` | `src/core/work-graph/queries/query-record-codecs.ts:1355` | 按结束时间排序的 Session QueryRun 索引名（track） | views 的轨道读取 |
| `S6_QUERY_RUN_BY_WORKSPACE_ENDED_LOOKUP` | `src/core/work-graph/queries/query-record-codecs.ts:1367` | 一个 workspace 里按 `run.endedAt` 排序的 QueryRun 索引名 | 合并的 Query 活动 backfill 读取 |
| `messageOf` **正本** | `src/contracts/error-message.ts:2` | 取 `Error.message`，否则 `String(error)`；转换抛错不吞 | 统一错误文本；本层及全仓的旧副本已删除，不要在本层再抽一份（M1-38） |
| `mergeGuards` | `src/core/work-graph/persistence/record-guards.ts:12` | 唯一的提交前 guard 合并：同 key 不同 revision 立即 `revision_conflict`，绝不 first-wins；**正本** | 提交前合并全部读依赖；queries 不能 import tasks，需要时先报 lead，不要另写 |
| `appendGuardFirstWins` | `src/core/work-graph/queries/request-rounds-read.ts:178` | 读窗口专用的 first-wins 追加：同 key 只留第一条 guard；不是提交前的 `mergeGuards`，也不是它的副本 | 请求轮的读窗口与 `tasks/initial-plan-answer.ts` 的来源 guards 追加；不要用于提交前合并 |
| `checkSessionProvenance` / `readSuccessorFacts` | `src/core/work-graph/sessions/session-record-codecs.ts:397`、`src/core/work-graph/queries/request-rounds-read.ts:188` | `checkSessionProvenance` 校验 new/task 续接/secretary handoff/readonly-copy；`readSuccessorFacts` 按 provenance 读 owner 的 live 后继索引 | 请求 owner 延续；完整 provenance 判定在 sessions |

## 内部用

`queryJobIntentIssues`、`queryPromptFactsIssues`、`queryJobIndexSlots`、`normalizeUnderstandingCommand`、`UnderstandingCommandReadV1`、`encodeQueryJobAnsweredEvent`、`QUERY_JOB_SUBMITTED_EVENT`、`QUERY_JOB_EVENT_SCHEMA_VERSION`、`QUERY_JOB_SNAPSHOT_SCHEMA_ID`、`QUERY_JOB_ANSWER_SNAPSHOT_SCHEMA_ID`、`QUERY_EXECUTION_EVENT`、`QUERY_EXECUTION_EVENT_SCHEMA_VERSION`、`QUERY_JOB_ANSWERED_EVENT`、`QUERY_EXECUTION_OPERATIONS`、`QUERY_JOB_SUBMIT_IDENTITY_PREFIX`、`QUERY_MANIFEST_CONTENT_TYPE`（转出 `contracts/no-progress.ts`），以及本层的 `*V1`/`*Deps`/`*Port` 类型。

## 不要做

- 不自己构造/推进 Query 生命周期状态；用 `state/query-run-recovery.ts` 的构造器，状态写入只经 `state/`（M1-01、M1-36、CS-03）。
- 不复制 Query 事件构造：`buildRecordedEvent`（`src/core/work-graph/queries/query-execution.ts:603`）是唯一形状且已导出；6A-1 已合成一份，不列副本（M1-37）。
- 不把查询/执行读失败折成空事实或 `not_found`；`not_ready`/`unavailable`/`conflict` 原样返回（FP-05、M1-12、MH-06）。fence 读失败或 operation 记录损坏同样是 `unavailable`，绝不当作“未持有”。
- 只有真正开始执行的提交合并 `handoffFenceGuard`（普通进入与吸收 batch 的进入）；abandon 和过期迁移的提交不合并它，否则持有 fence 的槽会让释放永远冲突。
- `mergeGuards` 是提交前唯一的 guard 合并；本层读窗口的 `appendGuardFirstWins`（`src/core/work-graph/queries/request-rounds-read.ts:178`）是有意保留的 first-wins 追加，不是它的副本，也不用于提交（M1-27）。
- 不另写 SessionRef 检查：直接调 `src/core/work-graph/persistence/rework-codecs.ts:154` 的 `sessionRefProblem`（CS-11、M1-31）。
- 不另写 `messageOf`：正本是 `src/contracts/error-message.ts:2`（M1-38），本层旧副本已删除。
- 不另写文本校验或收据查找；分别用 `queryTextProblem`、`lookupCommittedReceipt`（正本 `src/core/work-graph/persistence/receipt-lookup.ts:18`，本模块转出）（M1-26、M1-38）。
- 不 import `tasks`/`notes`/`evidence`/`communication`/`views` 或上层 `app`/`business`/`composition`；需要那边的事实就让调用方传入或走已声明的依赖。
