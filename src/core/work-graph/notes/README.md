# src/core/work-graph/notes：注记的写入、处置、读取、范围与书记待办（L5.5）

## 负责什么，不负责什么

- 负责：注记写入/复核/撤回/决定应用；按 id、锚点和记忆的读取；锚点解析与写入门；书记范围与配额计数；更新到期折叠；版本列表；书记待办；决定卡来源；记忆材料读取。
- 不负责：记录 codec 和游标绑定在 `src/core/work-graph/persistence/note-record-codecs.ts`；注记状态与准入判断在 `src/core/work-graph/state/note-machine.ts`（`query_run` 的写入范围与 `storedGoalId` 由其中的纯 `secretaryNoteScope` 按 `SecretaryNoteScopeFactsV1` 判定）。本层只调用它们，不自己改记录字段。
- 允许依赖 `model`、`state`、`persistence`、`architecture`、`sessions`、`tasks`，以及 `WorkspaceTools`/`RecordStore` 端口；不得 import `queries`、`evidence`、`communication`、`views`、`agent-runtime`、`app/`、`business/`、`composition/`（`docs/refactor/module-target.json`）。
- 状态迁移只经过 `src/core/work-graph/state/`（根 `AGENTS.md` 第 9 条）。读失败不得折成空列表、空范围、0 或“没有书记”（FP-05、FP-06、M1-12）。

## 文件

`note-service.ts` — 唯一的注记写入器：写入、复核/撤回、决定应用、用户理由事实、工具提交回读。
`note-read-model.ts` — 注记读端口：按 id/锚点读取、六种记忆读、`find`、记忆材料（无 Goal 时只读项目理解与 norms）；并转出基础读法。
`note-anchors.ts` — 锚点 key、主题归一化、写时锚点解析（含 symbol 定位）。
`note-anchor-facts.ts` — 锚点校验所需的 Goal/Plan 窗口事实读取，不经通用 Plan 服务。
`note-related-scope.ts` — `find` 的 related 范围解析，以及纯 key 集合/相关谓词。
`note-update-due.ts` — `updateDue` 的纯 fold，以及 Goal 锚点集合的唯一共享读取。
`note-continuity.ts` — stage 锚点在 plan revision 窗口内的连续性纯判定。
`note-base-reader.ts` — 把一个 lookup index 分页读到尾，返回完整集合或失败。
`note-batch-reader.ts` — 批量读当前指针与被指 head，缺指针/缺 head 的语义由调用方选。
`note-decision-source.ts` — 注记复核决定卡来源（communication/business 消费的对象）：Goal 的 bucket，或项目 subject 的无 Goal bucket `[projectId, null, 'pending_review']`。
`note-scribe-todos.ts` — 书记待办：`updateDue`、`pending`、`immediate` 三类。
`scribe-scope.ts` — 书记范围事实、写准入、管理范围与按范围计数。
`note-version-lists.ts` — 计划版本与目录版本的分页列表。
`note-memory-material.ts` — 记忆材料端口的薄适配；无 Goal 的项目材料由读模型组装。
`note-rendering.ts` — 理解正文的五段渲染。
`note-path-ownership.ts` — 转出 `contracts/path-ownership.ts` 的唯一路径所有权判定。
`store-failures.ts` — 注记读/写共用的 store 失败映射。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createNoteService` | `src/core/work-graph/notes/note-service.ts:468` | 唯一注记写入端口：write/review/withdraw/applyNoteDecision/userReasonFacts/lookupToolCommit；`query_run` 准入只经注入的 `secretaryQueryRun` 端口；秘书的阶段锚点取本轮准备时冻结的 Plan 的版本，准备时没有 Plan 的轮拒绝阶段锚点 | 注入给 composition；所有注记写入与处置走它 |
| `createNoteReadModel` | `src/core/work-graph/notes/note-read-model.ts:306` | 注记读端口：`readNote`、`listByAnchor`、六种 `memory*`、`readMemoryMaterial`（无 Goal 只回项目理解与 norms，其余为空） | 读注记、记忆查找、组装材料；Query 的当前 Goal 是本轮准备时冻结的 `effectiveGoalId`（由 `tasks/secretary-query-run.ts` 的解析器给出），绝不取模型参数 |
| `createScribeScope` | `src/core/work-graph/notes/scribe-scope.ts:263` | 书记范围事实、写准入、管理范围、按范围计数；事实按调用缓存 | 注记写入准入、范围计数 |
| `createNoteDecisionSource` | `src/core/work-graph/notes/note-decision-source.ts:114` | 注记复核决定卡来源：`readNoteDecisions` 按 `subject` 读 Goal 或项目的卡（项目桶无 Goal 窗口、无 cancelled 门，批读与理由读同一套）、按 pin 读一张（`goalId: null` 走项目卡；开着、关了都带回注记自己的 subject，读的一方先比 subject 再看开关）、应用决定 | 装配决定队列/决定应用 |
| `createNoteScribeTodos` | `src/core/work-graph/notes/note-scribe-todos.ts:76` | 书记待办：`pending`、`updateDueTodos`、`immediate`，复用同一锚点读 | Host 提醒/书记心跳 |
| `createVersionLists` | `src/core/work-graph/notes/note-version-lists.ts:69` | 计划版本/目录版本列表：新到旧、每页 ≤50、游标绑定请求 | 版本页；不要另写分页 |
| `createNoteMemoryMaterial` | `src/core/work-graph/notes/note-memory-material.ts:14` | 记忆材料端口；`goalId === null` 读项目理解与 norms（`localUnderstanding`/`general`/`reminders` 为空） | 上下文组装要注记材料时；不要另写无 Goal 分支 |
| `readGoalUnderstandingAnchors` | `src/core/work-graph/notes/note-update-due.ts:140` | 一次读多 Goal 的 plan 窗口、指针、head、trigger；全批只做一次指针/head 批量读 | 书记待办、需要同一套锚点事实时 |
| `foldInputOf` | `src/core/work-graph/notes/note-update-due.ts:48` | `updateDue` 的 baseline 规则：当前版才计，stage 无当前版时用 plan 接受时间 | 构造 `foldUpdateDue` 输入时 |
| `foldUpdateDue` | `src/core/work-graph/notes/note-update-due.ts:57` | 纯 fold：trigger 相对 baseline，返回 `updateDue` 与 `latestTriggerCursor` | 需要更新到期判断时；不要另写规则 |
| `stageContinuityOf` | `src/core/work-graph/notes/note-continuity.ts:18` | 纯 stage 连续性：revision 窗口内缺席即 `retired`，读不到为 `unchecked` | 注记派生字段的 stage 退役判断 |
| `anchorKeyOf` | `src/core/work-graph/notes/note-anchors.ts:410` | 唯一 anchor key 规则；file key 只含路径、不含 symbol | 任何锚点比较/存储前 |
| `moduleRefOf` | `src/core/work-graph/notes/note-anchors.ts:422` | 由 `projectId` 和 `moduleId` 组成 `ModuleRef` | 要 `ModuleRef` 时；不要另写构造器 |
| `topicKeyOf` | `src/core/work-graph/notes/note-anchors.ts:105` | 主题归一化：NFC、空白折叠、ASCII 小写 | 主题比较/查重 |
| `isSafeRelativePath` | `src/core/work-graph/notes/note-anchors.ts:402` | 安全的 workspace 相对路径（无 `\`、盘符、`.`/`..`） | file 锚点/路径输入 |
| `normalizePath` | `src/core/work-graph/notes/note-anchors.ts:583` | 去掉前导 `./`；其余由 class-1 提前拒绝 | 锚点 key 归一化 |
| `signatureDigestOf` | `src/core/work-graph/notes/note-anchors.ts:268` | 把 symbol 命中文本的空白折叠成一个空格后 sha256 | symbol 热度的稳定摘要 |
| `symbolRangeText` | `src/core/work-graph/notes/note-anchors.ts:281` | 一基 UTF-16 行/列切片（结束列不含） | 从捕获内容取 symbol 文本 |
| `createNoteHeadDerivations` | `src/core/work-graph/notes/note-read-model.ts:244` | 从已存 head 派生 `conflicting`/`overQuota` 等注记字段 | 注记读/检查；不要另算 |
| `newHeadCache` | `src/core/work-graph/notes/note-read-model.ts:208` | 一次读内的 anchors/goals 缓存 | 与 `createNoteHeadDerivations` 配套 |
| `selectRelatedFiles` | `src/core/work-graph/notes/note-related-scope.ts:104` | 纯：从 Run 事实选 related 文件，definite 先于 possible、去重、截断 | `find` 的 related 文件段 |
| `taskRelatedKeys` | `src/core/work-graph/notes/note-related-scope.ts:131` | 纯：task T 在 goal/plan 下的 anchor key 集合 | `find` 的 related task 段 |
| `moduleRelatedKeys` | `src/core/work-graph/notes/note-related-scope.ts:151` | 纯：module 及其 interface/file key 集合 | `find` 的 related module 段 |
| `isRelatedHead` | `src/core/work-graph/notes/note-related-scope.ts:166` | 纯：head 的五个槽是否落在 key 集合；`project` 只算通用种类 | 两段 `find` 共用的相关谓词 |
| `anchorSlots` | `src/core/work-graph/notes/note-related-scope.ts:88` | 把 head 的五个可空锚点槽收成非空数组 | 遍历 head 锚点时 |
| `readAllRecords` | `src/core/work-graph/notes/note-base-reader.ts:22` | 把一个 lookup index 分页读到尾，任一分页失败即整体失败 | 需要完整等值集合时；`src/core/work-graph/notes/note-read-model.ts:66` 转出 |
| `mapStoreFailure` | `src/core/work-graph/notes/store-failures.ts:9` | 注记读/写共用的 store 失败映射 | 把 StoreFailure 转 NoteErrorCode 时；`src/core/work-graph/notes/note-read-model.ts:67` 转出 |
| `pathOwnershipOf` | `src/contracts/path-ownership.ts:36` | 路径所有权：最长合法段匹配，返回 owner/tie/none；`note-path-ownership.ts` 只是转出 | file 锚点归属；不要另写路径匹配 |

## 内部用

`readAnchorGoalFacts`、`anchorFormatProblem`、`resolveNoteAnchors`、`topicProblem`、`conclusionProblem`、`anchorNotFound`、`moduleOfAnchor`、`renderUnderstandingBody`、`readAllHeads`、`readPointerBatch`、`readHeadBatch`、`readPointerAndHeadBatch`、`resolveSymbol`、`matchesPathPrefix`、`headsOnKeyPrefix`、`stageIdOf`、`resolveTaskScopeWithPlan`、`resolveRelatedScope`、`sourceIsAuthorOf`、`newScribeScopeCall`、`asOutcome`、`VERSION_LIST_PAGE_MAX`、`CATALOG_REASON_LABEL`、`PLAN_REASON_MISSING_LABEL`，以及本层的 `*V1`/`*Deps`/`*Port` 类型。

## 不要做

- 不另写记录 codec 或游标绑定；用 `src/core/work-graph/persistence/note-record-codecs.ts:449` 的 `decodeNoteHeadSnapshot` 等既有入口（CS-01、CS-08、CS-10）。
- 不另写命令身份里的主体折叠；用 `src/contracts/core/call-context.ts:64` 的 `principalIdentity`（原来的私有 `principalOf` 已删除）。
- 不绕过 `src/core/work-graph/state/note-machine.ts` 自行改状态；状态写入只经 `state/`（`src/core/work-graph/state/note-machine.ts:425` 的 `transitionNote`）。
- 不把失败的读或损坏的记录当成空列表、空范围、0 或“没有书记”（FP-05、M1-12、MH-06）。
- 不另写锚点 key、主题归一化、路径所有权或更新到期规则；分别用 `anchorKeyOf`、`topicKeyOf`、`pathOwnershipOf`、`foldUpdateDue`。
- 不复制 `note-read-model` 的批量读/派生字段；`find` 的两段共用 `isRelatedHead` 和同一批指针/head 读。
