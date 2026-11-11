# src/core/work-graph/notes：注记的写入、处置、读取、范围与书记待办（L5.5）

## 负责什么，不负责什么

- 负责：注记写入/复核/撤回/决定应用；按 id、锚点和记忆的读取；锚点解析与写入门；书记范围与配额计数；更新到期折叠；版本列表；书记待办；决定卡来源；记忆材料读取。
- 不负责：记录 codec 和游标绑定在 `src/core/work-graph/persistence/note-record-codecs.ts`；注记状态与准入判断在 `src/core/work-graph/state/note-machine.ts`（`query_run` 的写入范围与 `storedGoalId` 由其中的纯 `secretaryNoteScope` 按 `SecretaryNoteScopeFactsV1` 判定）。本层只调用它们，不自己改记录字段。
- 允许依赖 `model`、`state`、`persistence`、`knowledge`、`architecture`、`sessions`、`tasks`，以及 `WorkspaceTools`/`RecordStore` 端口；不得 import `queries`、`evidence`、`communication`、`views`、`agent-runtime`、`app/`、`business/`、`composition/`（`docs/refactor/module-target.json`）。
- 状态迁移只经过 `src/core/work-graph/state/`（根 `AGENTS.md` 第 9 条）。读失败不得折成空列表、空范围、0 或“没有书记”（FP-05、FP-06、M1-12）。

## 文件

`note-service.ts` — 唯一的注记写入器：写入、复核/撤回、决定应用、用户理由事实、工具提交回读；命令身份 `noteCommandIdentity`（write/review/withdraw/activate）。写注记和处置经 `writeKnowledge` 提交，同一提交写出的每个 head（新注记、它取代或撤回的、被处置的）由 `noteFileWritesOf` 算注记文件的改动。
`note-file.ts` — 注记的知识文件格式（纯）：首行 `--- knowledge-note@1`、`prettyJson` 的头、一行 `---`、原样的正文字节；没有 id 键，注记号只在文件名里（`noteIdFromFilePath`）。只有主锚点是模块、接口或文件的注记进文件，工作过程的附加锚点留在记录；file 锚点不带符号，file 事实和依据文件不带摘要；模块编号和路径按文件帧写，读回转回项目视图。link、flow、repair 这一版没有文件形式（写和读回都回 `invalid`）。
`note-read-model.ts` — 注记读端口：按 id/锚点读取、六种记忆读、`find`、记忆材料（无 Goal 时只读项目理解与 norms）；并转出基础读法与唯一的记忆游标 helper（`encodeMemoryCursor`/`parseMemoryCursor`/`callerIdentityOf`）；`NoteReadDependencies.expandFlowForHead` 是 flow 项的展开依赖，`flowCheckOf` 合成流程的 freshness/currentEligible，`readSemanticCatalog` 是语义页的唯一目录读。
`semantic-layer-read.ts` — 语义层的读侧：`readSemanticLinks` 按 project/module/file 范围读 `link` 的三状态页，`readSemanticFlows` 读 `flow` 的三状态页并按存储的步骤 id 展开（module/file 范围先取范围里任意状态的 `link`）；两页都一次 `checkHeads`，分别映射成 `SemanticLinkV1`/`SemanticFlowV1`。
`activate-repair.ts` — 8C 的唯一 repair 激活 owner 与纯 footprint 判定：把 staged `repair` 注记绑到 Run 轮链的有效 head，检查轮 PASS、批准与 footprint，再一次 `PreparedCommit` 提交 `staged → accepted` 与 catalog revision contribution；激活（含当前目录读、规划、架构和注记文件改动）和任务不在时的撤回都经同一次 `writeKnowledge`，撤回用自己的命令身份；规划回“依据变了”（`source_stale`）时先按激活命令的身份查回执，同一命令已提交就重放它的结果（快速核对 5）；`readBoundRepairRound`、`footprintProblem`、`activateRepair`、`readObservation`、`attemptRepairsForGoal` 与 `createRepairActivationService`。
`note-anchors.ts` — 锚点 key、主题归一化、写时锚点解析（含 symbol 定位：TS/JS 在工作树单文件的导航项里找，Python/C++ 经单文件查 `lookup`，都不开捕获）。Python 语法错只退回那个文件的锚，`ResolvedNoteAnchors.symbolProblems` 和成功回执的 `symbolProblems` 带文件、行、原因；别的锚照常解析。
`note-anchor-facts.ts` — 锚点校验所需的 Goal/Plan 窗口事实读取，不经通用 Plan 服务。
`note-related-scope.ts` — `find` 的 related 范围解析，以及纯 key 集合/相关谓词。
`note-update-due.ts` — `updateDue` 的纯 fold，以及 Goal 锚点集合的唯一共享读取。
`note-continuity.ts` — stage 锚点在 plan revision 窗口内的连续性纯判定。
`note-base-reader.ts` — 把一个 lookup index 分页读到尾，返回完整集合或失败；`readAllHeads` 读一批 head，`headsByAnchorKey` 读一个锚点 key 的 head 集合。
`note-batch-reader.ts` — 批量读当前指针与被指 head，缺指针/缺 head 的语义由调用方选。
`note-decision-source.ts` — 注记复核决定卡来源（communication/business 消费的对象）：Goal 的 bucket，或项目 subject 的无 Goal bucket `[projectId, null, 'pending_review']`。
`note-scribe-todos.ts` — 书记待办：`updateDue`、`pending`、`immediate` 三类。
`scribe-scope.ts` — 书记范围事实、写准入、管理范围与按范围计数；包含判定、模块深度与最深包含 region 的纯规则在 `state/role-scope.ts`（本文件只导入 `regionContains`/`deepestContainingRegion`，不另留副本）。只有目标链接的书记现在是 goal 范围：每条开着的 goal 负责链接给一个 `{kind:'goal'}` 范围，与 region 范围合并（同时持有 region 和目标的线两边都留）；目标类锚点在它持有的目标内准入，其余锚点 `anchor_out_of_scope`；单目标、没有模块锚点且有书记持有该目标时，管理范围是这个目标，所以计数与 `manages` 按同一个范围。`ScribeScope.managingScopeOfAnchors` 按同一规则给没有 head 的锚点（`updateDue` 待办）求管理范围。书记范围事实按项目翻目录（不分工作区）：书记按项目服务所有工作区，第二个工作区没有自己的角色线，由主工作区的书记管。
`note-version-lists.ts` — 计划版本与目录版本的分页列表。
`note-memory-material.ts` — 记忆材料端口的薄适配；无 Goal 的项目材料由读模型组装。
`note-rendering.ts` — 理解正文的五段渲染。
`note-path-ownership.ts` — 转出 `contracts/path-ownership.ts` 的唯一路径所有权判定。
`store-failures.ts` — 注记读/写共用的 store 失败映射。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createNoteService` | `src/core/work-graph/notes/note-service.ts:829` | 唯一注记写入端口：write/review/withdraw/applyNoteDecision/userReasonFacts/lookupToolCommit；`query_run` 准入只经注入的 `secretaryQueryRun` 端口；秘书的阶段锚点取本轮准备时冻结的 Plan 的版本，准备时没有 Plan 的轮拒绝阶段锚点；文件锚点的存在、候选、符号读和基准文件的读经 `noteCheckWorkspace`，写入、准入、额度和存下的作者仍是调用者；注入了 `regionScopes?` 时，区域参谋（Work Run 和冷启动的探索轮同一道）写的注记至少要有一个锚点在自己的有效区域模块里、或是自己目标的锚点，否则 `forbidden`/`anchor_out_of_region`（`link` 看检查后的两头，`flow` 看各步注记的锚点，证据和依据文件不算锚点）；开场参谋（项目范围）和只有目标范围的参谋不受这一道限 | 注入给 composition；所有注记写入与处置走它 |
| `noteFileWritesOf` | `src/core/work-graph/notes/note-service.ts:172` | 一次注记提交写出的每个 head 的文件改动：主锚点是知识锚点的进它那个工作区的线（模块编号的工作区，或存储路径的工作区）；link/flow/repair 这一版不进文件；字节没变给空改动 | 4 个注记写点（写注记、处置、修补激活、撤回）都调它；不要另写选线 |
| `noteIdFromFilePath`、`isKnowledgeAnchor` | `src/core/work-graph/notes/note-file.ts:34`、`src/core/work-graph/notes/note-file.ts:38` | 注记文件路径到注记号；锚点是不是三种知识锚点 | 读注记文件、判注记进不进文件 |
| `noteKnowledgeOf` | `src/core/work-graph/notes/note-file.ts:52` | 带 `source` 的 head → 文件里的知识字段（项目视图） | 写注记文件前；不要另取字段 |
| `noteFileBytes`、`noteOfFileBytes` | `src/core/work-graph/notes/note-file.ts:86`、`src/core/work-graph/notes/note-file.ts:148` | 知识字段 ↔ 注记文件字节，文件帧是这条线的工作区；读回查精确键、知识锚点、按种类的专用字段（`payloadKindProblem`）和导出的锚点、来源、五段检查 | 组合根的 `writeNote`/`readNotesById` |
| `createRepairActivationService` | `src/core/work-graph/notes/activate-repair.ts:801` | 绑定 records/catalog/evidence 等依赖，返回 `readBoundRepairRound`/`activateRepair`/`attemptRepairsForGoal`；激活检查轮 PASS、批准、footprint 并一次提交注记与 catalog 修订 | 组合根装配 repair 激活；不要另开激活入口 |
| `createNoteReadModel` | `src/core/work-graph/notes/note-read-model.ts:480` | 注记读端口：`readNote`、`listByAnchor`、六种 `memory*`、`readMemoryMaterial`（无 Goal 只回项目理解与 norms，其余为空）；`expandFlowForHead` 依赖把 flow 项展开成 `flow` | 读注记、记忆查找、组装材料；Query 的当前 Goal 是本轮准备时冻结的 `effectiveGoalId`（由 `tasks/secretary-query-run.ts` 的解析器给出），绝不取模型参数 |
| `createSemanticLayerRead` | `src/core/work-graph/notes/semantic-layer-read.ts:59` | 语义层的唯一读端口：`readSemanticLinks`（project/module/file，limit 1–100）、`readSemanticFlows`（project/module/file，limit 1–50，一页最多 500 个流程头）；一页一次核对；`checkSemanticLinks`（`semantic-layer-read.ts:55`，1–`NOTE_LINK_VERIFY_MAX` 条，按钮的优先级交第二档） | Host 的 `architecture/semantic-links`、`architecture/semantic-flows`、`architecture/semantic-links/check` 路由；不要另写范围、分页或 item 映射 |
| `linkChecksOf` | `src/core/work-graph/notes/semantic-layer-read.ts:245` | 纯投影：核对的行 → `{ items: { noteId, version, verification } }`，不是联系的 `verification: null` | “重新核对”路由和 agent 的只读核对工具；不要另写投影 |
| `expandFlowForHead` | `src/core/work-graph/notes/semantic-layer-read.ts:430` | 纯映射：按存储的步骤顺序展开一条流程，五值取第一个 problem（`not_current` 时 `item: null`），`gapsAfter` 按端点身份比相邻步 | 流程页与 `withCheck` 的 flow 项；不要另写问题的先后或 `gapsAfter` |
| `flowCheckOf`、`readSemanticCatalog` | `src/core/work-graph/notes/note-read-model.ts:445`、`src/core/work-graph/notes/note-read-model.ts:445` | 流程 freshness/currentEligible 的唯一合成；语义页的唯一目录读（缺目录是 `null`，其它失败 `unavailable`） | `semanticFlowOf`、`withCheck` 的 flow 项与两个语义读口；不要另写合成或目录读 |
| `encodeMemoryCursor`、`parseMemoryCursor`、`callerIdentityOf` | `src/core/work-graph/notes/note-read-model.ts:405`、`src/core/work-graph/notes/note-read-model.ts:412`、`src/core/work-graph/notes/note-read-model.ts:401` | 注记读与语义读共用的唯一不透明游标：绑定 op、调用者、规则、请求和位置 | 需要绑定请求的翻页时；不要把游标解析放到 HTTP 层或另写一份 |
| `collectModuleFileKeys`、`interfaceKeysOf` | `src/core/work-graph/notes/note-related-scope.ts:314`、`src/core/work-graph/notes/note-related-scope.ts:314` | 模块路径下的文件 key 集合（按唯一主人判定）与模块接口 key | 语义模块范围要模块/接口/文件键集时；不要另写归属或接口 key |
| `createScribeScope` | `src/core/work-graph/notes/scribe-scope.ts:267` | 书记范围事实、写准入、管理范围、按范围计数；事实按调用缓存 | 注记写入准入、范围计数 |
| `createNoteDecisionSource` | `src/core/work-graph/notes/note-decision-source.ts:118` | 注记复核决定卡来源：`readNoteDecisions` 按 `subject` 读 Goal 或项目的卡（项目桶无 Goal 窗口、无 cancelled 门，批读与理由读同一套）、按 pin 读一张（`goalId: null` 走项目卡；开着、关了都带回注记自己的 subject，读的一方先比 subject 再看开关）、应用决定 | 装配决定队列/决定应用 |
| `createNoteScribeTodos` | `src/core/work-graph/notes/note-scribe-todos.ts:76` | 书记待办：`pending`、`updateDueTodos`、`immediate`，复用同一锚点读 | Host 提醒/书记心跳 |
| `createVersionLists` | `src/core/work-graph/notes/note-version-lists.ts:69` | 计划版本/目录版本列表：新到旧、每页 ≤50、游标绑定请求 | 版本页；不要另写分页 |
| `createNoteMemoryMaterial` | `src/core/work-graph/notes/note-memory-material.ts:14` | 记忆材料端口；`goalId === null` 读项目理解与 norms（`localUnderstanding`/`general`/`reminders` 为空） | 上下文组装要注记材料时；不要另写无 Goal 分支 |
| `readGoalUnderstandingAnchors` | `src/core/work-graph/notes/note-update-due.ts:140` | 一次读多 Goal 的 plan 窗口、指针、head、trigger；全批只做一次指针/head 批量读 | 书记待办、需要同一套锚点事实时 |
| `foldInputOf` | `src/core/work-graph/notes/note-update-due.ts:48` | `updateDue` 的 baseline 规则：当前版才计，stage 无当前版时用 plan 接受时间 | 构造 `foldUpdateDue` 输入时 |
| `foldUpdateDue` | `src/core/work-graph/notes/note-update-due.ts:57` | 纯 fold：trigger 相对 baseline，返回 `updateDue` 与 `latestTriggerCursor` | 需要更新到期判断时；不要另写规则 |
| `stageContinuityOf` | `src/core/work-graph/notes/note-continuity.ts:18` | 纯 stage 连续性：revision 窗口内缺席即 `retired`，读不到为 `unchecked` | 注记派生字段的 stage 退役判断 |
| `anchorKeyOf` | `src/core/work-graph/notes/note-anchors.ts:405` | 唯一 anchor key 规则；file key 只含规范化后的项目路径、不含 symbol | 任何锚点比较/存储前 |
| `moduleRefOf` | `src/core/work-graph/notes/note-anchors.ts:417` | 由 `projectId` 和 `moduleId` 组成 `ModuleRef` | 要 `ModuleRef` 时；不要另写构造器 |
| `relationNeedsKey`、`referenceFieldsOf`、`partFieldsOf`、`literalInScope` | `src/core/work-graph/notes/link-evidence.ts:240`、`src/core/work-graph/notes/link-evidence.ts:240`、`src/core/work-graph/notes/link-evidence.ts:240`、`src/core/work-graph/notes/link-evidence.ts:240` | 关系要不要 key（injects、callback 不要）；一条证据按角色要引用的定义（L3a 的表）；再加上关系要 key、key 是符号时的 `'key'`（一条证据要查的全部引用）；字面 key 在范围里逐行找得到 | 写入闸门和读时第一档共用；不要另写 |
| `checkLinkDraft` | `src/core/work-graph/notes/link-evidence.ts:303`（`checkLinkDraft`）、`src/core/work-graph/notes/link-evidence.ts:303`（`endpointIdentityOf`）、`src/core/work-graph/notes/link-evidence.ts:47`（`moduleOfFile`）、`src/core/work-graph/notes/link-evidence.ts:61`（`evidenceScopeOf`）、`src/core/work-graph/notes/link-evidence.ts:76`（`literalKeyProblem`）、`src/core/work-graph/notes/link-evidence.ts:89`（`evidenceRoleProblem`） | 一条联系的一张结果表：包含判定不查找；按字段顺序解析端与符号 key、按下标解析证据 `symbolRequest`，都在各自的 TS/JS 单文件里找（一次写每个路径只读一次工作树）；存 `raw_bytes` 摘要、扫字面 key；要引用的定义一次交第二档（`verify`，`priority: 'write'`，一组），第二档分析的文件摘要和这次读到的不同时那一部分记 `analyzer_unavailable`；`analysisConfig` 存第二档用的配置，第二档失败时按 `TYPESCRIPT_CONFIG_FILES` 在工作树找；成功返回解析后的锚点、`LinkPayloadV1` 与 warnings，退回带 `evidenceIndexes`/`symbolCandidates` | `writeNote` 在锚点第 1–3 类之后、依据文件之前调用；不要另写符号解析、包含、范围或摘要规则 |
| `topicKeyOf` | `src/core/work-graph/notes/note-anchors.ts:127` | 主题归一化：NFC、空白折叠、ASCII 小写 | 主题比较/查重 |
| `isSafeWorkspaceRelativePath`、`isSafeProjectPath` | `src/contracts/workspace-path.ts:21`、`:47` | 工作区相对路径与带 `/@ws:` 的项目路径语法（唯一正本） | file 锚点/路径输入 |
| `normalizeProjectPath` | `src/contracts/workspace-path.ts:91` | 项目路径归一化（id 先解码再规范编码，相对部分去前导 `./`）；`normalizePath` 只用于工作区相对路径 | 锚点 key、查重、写回 |
| `signatureDigestOf` | `src/core/work-graph/notes/note-anchors.ts:285` | 把 symbol 命中文本的空白折叠成一个空格后 sha256 | symbol 热度的稳定摘要 |
| `symbolRangeText` | `src/core/work-graph/notes/note-anchors.ts:290` | 一基 UTF-16 行/列切片（结束列不含） | 从文件文字取 symbol 名字那一段（写时定位和读时重查共用） |
| `pickSymbol` | `src/core/work-graph/notes/note-anchors.ts:308` | 泛型：一个 `symbolRequest` 在一个文件的条目（TS 导航项或 Python/C++ 单文件查的符号）里按名字挑，带 `range` 时也比名字行；一个 → 定位（名字行、解码文字的 sha256、签名摘要）和挑中的条目原样，没有 → `unresolved`，多个 → `ambiguous`（按起始行、列排的候选） | 写时的符号定位，各语言共用；不要另写匹配 |
| `pickTypeScriptSymbol` | `src/core/work-graph/notes/note-anchors.ts:333` | TS/JS 文件文字的 `navigationItemsOf` 交给 `pickSymbol`，成功时带回 `NavItemV1`（种类、全部声明段）；不分页、没有命中上限、不建程序 | 联系的端、符号 key、证据和一般注记的 TS 符号；不要另开捕获 |
| `noteCheckWorkspace` | `src/core/work-graph/notes/note-anchors.ts:863` | 注记的工作区读口包一层：`readWorkspace`/`readWorkspaceFiles`/`capture`/`querySource`/`releaseCapture`/`verify`/`lookup` 都用 `platformCheckContext` 换成固定的内部 Host 身份（`system`/`note-workspace-check`；Host 只给自己的 principal 授权工作区读），Host 调用者不变 | 注记写入的锚点和基准文件读、注记检查的文件读、读模型的锚点存在读；写入、准入、额度、作者和非工作区读仍用调用者的上下文 |
| `createNoteHeadDerivations` | `src/core/work-graph/notes/note-read-model.ts:300` | 从已存 head 派生 `conflicting`/`overQuota` 等注记字段 | 注记读/检查；不要另算 |
| `newHeadCache` | `src/core/work-graph/notes/note-read-model.ts:264` | 一次读内的 anchors/goals 缓存 | 与 `createNoteHeadDerivations` 配套 |
| `selectRelatedFiles` | `src/core/work-graph/notes/note-related-scope.ts:102` | 纯：从 Run 事实选 related 文件，definite 先于 possible、去重、截断 | `find` 的 related 文件段 |
| `taskRelatedKeys` | `src/core/work-graph/notes/note-related-scope.ts:129` | 纯：task T 在 goal/plan 下的 anchor key 集合 | `find` 的 related task 段 |
| `moduleRelatedKeys` | `src/core/work-graph/notes/note-related-scope.ts:149` | 纯：module 及其 interface/file key 集合 | `find` 的 related module 段 |
| `isRelatedHead` | `src/core/work-graph/notes/note-related-scope.ts:164` | 纯：head 的五个槽是否落在 key 集合；`project` 只算通用种类 | 两段 `find` 共用的相关谓词 |
| `anchorSlots` | `src/core/work-graph/notes/note-related-scope.ts:86` | 把 head 的五个可空锚点槽收成非空数组 | 遍历 head 锚点时 |
| `readAllRecords` | `src/core/work-graph/notes/note-base-reader.ts:22` | 把一个 lookup index 分页读到尾，任一分页失败即整体失败 | 需要完整等值集合时；`src/core/work-graph/notes/note-read-model.ts:71` 转出 |
| `mapStoreFailure` | `src/core/work-graph/notes/store-failures.ts:9` | 注记读/写共用的 store 失败映射 | 把 StoreFailure 转 NoteErrorCode 时；`src/core/work-graph/notes/note-read-model.ts:72` 转出 |
| `pathOwnershipOf` | `src/contracts/path-ownership.ts:36` | 路径所有权：最长合法段匹配，返回 owner/tie/none；`note-path-ownership.ts` 只是转出 | file 锚点归属；不要另写路径匹配 |

## 内部用

`readAnchorGoalFacts`、`anchorFormatProblem`、`resolveNoteAnchors`、`topicProblem`、`conclusionProblem`、`anchorNotFound`、`moduleOfAnchor`、`renderUnderstandingBody`、`readAllHeads`、`readPointerBatch`、`readHeadBatch`、`readPointerAndHeadBatch`、`resolveSymbol`、`matchesPathPrefix`、`headsOnKeyPrefix`、`stageIdOf`、`resolveTaskScopeWithPlan`、`resolveRelatedScope`、`sourceIsAuthorOf`、`newScribeScopeCall`、`asOutcome`、`VERSION_LIST_PAGE_MAX`、`CATALOG_REASON_LABEL`、`PLAN_REASON_MISSING_LABEL`，以及本层的 `*V1`/`*Deps`/`*Port` 类型。

## 不要做

- 不另写记录 codec 或游标绑定；用 `src/core/work-graph/persistence/note-record-codecs.ts:454` 的 `decodeNoteHeadSnapshot` 等既有入口（CS-01、CS-08、CS-10）。
- 不另写命令身份里的主体折叠；用 `src/contracts/core/call-context.ts:64` 的 `principalIdentity`（原来的私有 `principalOf` 已删除）。
- 不绕过 `src/core/work-graph/state/note-machine.ts` 自行改状态；状态写入只经 `state/`（`src/core/work-graph/state/note-machine.ts:429` 的 `transitionNote`）。
- 不把失败的读或损坏的记录当成空列表、空范围、0 或“没有书记”（FP-05、M1-12、MH-06）。
- 不另写锚点 key、主题归一化、路径所有权或更新到期规则；分别用 `anchorKeyOf`、`topicKeyOf`、`pathOwnershipOf`、`foldUpdateDue`。
- 不复制 `note-read-model` 的批量读/派生字段；`find` 的两段共用 `isRelatedHead` 和同一批指针/head 读。
