# src/core/work-graph/architecture：正式架构目录与观测架构的纯算法、编解码和读写服务（L2）

## 负责什么，不负责什么
- L2，允许依赖 `model`、`state`、`persistence`；另用 `workspace` 与 `record-store` 的端口。不得 import `sessions/queries/tasks/notes/evidence/communication/views`、`src/core/agent-runtime`、`src/app`、`src/business`、`src/composition`。
- 管两个不同的面：观测架构是某一次有界源捕获的证据，永远不是正式 baseline；正式 catalog 是已采用的模块/依赖结构，有单独的 `baselineId`/`revision` 和 active pointer。正式架构的初始接受（`adoptInitialArchitecture`）和修订由 `catalog-service.ts` 负责；`architecture-service.ts` 只做观测捕获/查询/比较，不做正式接受。
- 写入只经注入的 `GoalRecordTransactionPort`（`src/core/record-store/ports.ts:192`）一次提交，记录/事件编解码复用 `persistence/`；自动捕获请求/失败的受保护状态经 `state/architecture-capture.ts` 构造，状态迁移只经 `state/`（根 `AGENTS.md` 第 9 条）。
- 记录/图 DTO 的正本在 `src/contracts/architecture-*.ts`、`src/contracts/governance.ts` 与 `src/contracts/core/`（身份/结果/拒绝）；本层只声明端口和转出的 `GraphWrite`（`src/core/work-graph/architecture/contracts.ts:16` 只是转出；正本在 `src/core/work-graph/model/task-contracts.ts:28`），不另建平行身份或结果类型。
- 只做形状、身份、版本与纯图算法：不抓源码（`WorkspaceTools` 做）、不写 SQL/事务、不做 UI 读模型、不做决定/迁移门。
- 读失败、损坏或缺失保持 `unavailable`/`rejected`，不猜空目录；路径和名字只是标签，不能证明语义移动或依赖关系。

## 文件
- `architecture-delta.ts` — 纯观测图差异（结构 key 与 digest 的增删改）、SCC 环成员与 `compareObservedGraphs`；不产出 baseline 或规则结论。
- `architecture-record-codecs.ts` — observed capture 的 body/chunk/记录/事件 codec、schema 注册与 `mergeObservedFileGraphChunks`。
- `architecture-service.ts` — `ObservedArchitecturePort` 实现：源捕获、历史读、邻域/影响/比较、自动捕获、文件图分页与 chunk 打包。
- `catalog-contracts.ts` — 正式 catalog 的 adoption/revision 端口、revision 快照与 module facts DTO。
- `catalog-record-codecs.ts` — catalog 记录/事件 codec、adoption 闭包校验、`architectureBaselineDigest` 与 schema 注册。
- `catalog-service.ts` — 正式架构的初始接受（`adoptInitialArchitecture`）、catalog 修订（`reviseArchitectureCatalog`）、revision 读取、当前 catalog 的 module facts、revision 的完整 pin（`catalogPinOf`）与 guards。
- `contracts.ts` — observed architecture 的记录/端口/DTO，以及本文件的 `GraphWrite` 转出（`src/core/work-graph/architecture/contracts.ts:16` 只是转出；正本在 `src/core/work-graph/model/task-contracts.ts:28`）。
- `file-graph-index.ts` — 纯文件级图分页：listFiles/neighbors/impact 与 cursor 绑定。
- `formal-comparison.ts` — 正式 catalog 与观测文件图的纯比较（ownership/ambiguous/SCC 等 finding）。
- `graph-index.ts` — 纯观测图遍历：邻域、反向影响闭包、分页与 `encodeCursor`。
- `proposal-record-codecs.ts` — `ArchitectureProposal@1`/`ArchitectureProposalBatch@1` 记录与 `ArchitectureProposalChanged@1` 事件 codec、两个按项目 lookup 与 schema 注册；提案内容不可变，只有 `state`/`batchRef` 由状态机改，批冻结后不可变。
- `proposal-service.ts` — 结构提案 owner：pinned propose、批冻结、答复应用/关闭与读；唯一写提案/批记录并在提案路径调 catalog planner 的地方，试算复用 `planCatalogRevision` 后丢弃其 contribution。
- `repair-ops.ts` — 唯一的 repair 操作纯解析/试算路径：note 写入、catalog 修订规划与结构提案共用；不读 catalog/baseline、不提交、不查 footprint。
- `revision-planner.ts` — 唯一的非提交 catalog 修订规划：校验 expected pin、跑 op 引擎、套删除与职责移动规则，返回整个 contribution；提交 owner 是 `reviseArchitectureCatalog`。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `ObservedArchitecturePort` | `src/core/work-graph/architecture/contracts.ts:115` | 观测架构的捕获、自动捕获、查询、比较、影响与文件图读端口 | 消费观测架构时只依赖此端口 |
| `ArchitectureCatalogPort` | `src/core/work-graph/architecture/catalog-contracts.ts:119` | 正式架构的初始采用、修订与 revision 读取 | 正式架构的写读入口 |
| `createObservedArchitecture` | `src/core/work-graph/architecture/architecture-service.ts:904` | 绑定 workspace/bodies/records 等依赖，实现观测端口 | 组合根装配观测架构服务 |
| `createArchitectureCatalogService` | `src/core/work-graph/architecture/catalog-service.ts:466` | 绑定 records，实现正式 catalog 端口 | 组合根装配正式架构服务 |
| `readCurrentCatalogWindow` | `src/core/work-graph/architecture/catalog-service.ts:379` | 解析 active pointer，再在同一窗口读 pointer+baseline+catalog，复核后返回 CAS guards | 需要当前正式架构及其 guards 时 |
| `readRevisionByRef` | `src/core/work-graph/architecture/catalog-service.ts:440` | 按引用读不可变 baseline 与同 revision 的 catalog | 正式/观测比较解析 pin 时 |
| `catalogPinOf` | `src/core/work-graph/architecture/catalog-service.ts:443` | 把一次已读 revision（current window 或 `readRevisionByRef`）折成完整 `ArchitectureCatalogPinV1`；pin 只从读出的记录来，绝不来自输入 | propose 记录候选的 `catalogPin`，或需要当时的完整 pin 时 |
| `readCatalogModuleFacts` | `src/core/work-graph/architecture/catalog-service.ts:764` | 把 `ModuleRef` 解析到当前 catalog 的 module，并带出 guards | Session 写 work link 前的准入 |
| `catalogModuleFactsOf` | `src/core/work-graph/architecture/catalog-service.ts:780` | 从已读的 current window 投影某个 module 的事实 | 一次调用有多个模块目标时共享一次读 |
| `parseRepairOps` / `applyRepairOps` | `src/core/work-graph/architecture/repair-ops.ts:191` / `src/core/work-graph/architecture/repair-ops.ts:405` | 严格解析 1–20 个 repair op，并在 pinned baseline 规则上纯试算 catalog（含最终 `validateAdoptedArchitecture` 与 `(from, to)` 规则检查） | note 写入、修订规划与结构提案共用的唯一 op 引擎 |
| `planCatalogRevision` | `src/core/work-graph/architecture/revision-planner.ts:131` | 非提交的 catalog 修订：expected pin 对当前窗口、op 试算、删除/职责移动规则、guards/records/claims/events/next pin 一次返回 | 人路由的 `reviseArchitectureCatalog` 与提案应用合并 contribution 时 |
| `createArchitectureProposalService` | `src/core/work-graph/architecture/proposal-service.ts:965` | 绑定 records/lookups 等依赖，返回 propose/freeze/apply/read 的提案 owner | 组合根装配结构提案服务 |
| `readArchitectureProposal` | `src/core/work-graph/architecture/proposal-service.ts:944` | 按 `proposalRef` 读提案、批 ref 与卡片 key | 提案读（路由、E3 与卡来源） |
| `compareObservedGraphs` | `src/core/work-graph/architecture/architecture-delta.ts:89` | 两份观测的节点/边结构差异与环变化 | 观测版本比较 |
| `stronglyConnectedCycles` | `src/core/work-graph/architecture/architecture-delta.ts:24` | 确定性 SCC（成员数 >1 或自环）检测 | 观测差异与正式比较共用 |
| `buildObservedNeighborhood` | `src/core/work-graph/architecture/graph-index.ts:161` | 按 anchor/depth/relations 取有界邻域页，带 unresolved 归属 | 图邻域查询 |
| `buildObservedImpact` | `src/core/work-graph/architecture/graph-index.ts:209` | 沿边反向取影响节点、路径与页 cursor | 影响查询 |
| `encodeCursor` | `src/core/work-graph/architecture/graph-index.ts:48` | 统一的 base64url JSON cursor 编码 | 读模型需要生成 opaque cursor 时 |
| `listFilesPage` | `src/core/work-graph/architecture/file-graph-index.ts:96` | 文件图按路径稳定排序分页 | 文件级列表读 |
| `neighborsPage` | `src/core/work-graph/architecture/file-graph-index.ts:103` | 一跳出/入邻居分页 | 文件邻域读 |
| `impactPage` | `src/core/work-graph/architecture/file-graph-index.ts:120` | 反向可达影响分页，深度有上限 | 文件影响读 |
| `compareFormalObservedGraphs` | `src/core/work-graph/architecture/formal-comparison.ts:29` | 正式 catalog 与观测文件图的确定性 finding | 架构提醒与检查 |
| `architectureBaselineDigest` | `src/core/work-graph/architecture/catalog-record-codecs.ts:201` | 正式 baseline 的规范内容 digest，与 `plan-readers.ts` 的治理读取一致 | 校验/读取 baseline 时 |
| `OBSERVED_ARCHITECTURE_RECORD_SCHEMAS` | `src/core/work-graph/architecture/architecture-record-codecs.ts:746` | observed 记录/事件的 Store schema 注册表 | 组合根注册纪录后端 |
| `ARCHITECTURE_CATALOG_SCHEMAS` | `src/core/work-graph/architecture/catalog-record-codecs.ts:543` | 正式 catalog 记录/事件的 Store schema 注册表 | 组合根注册纪录后端 |

## 内部用
- architecture-record-codecs：`OBSERVED_ARCHITECTURE_SCHEMA_ID`、`OBSERVATION_CURRENT_SCHEMA_ID`、`ARCHITECTURE_AUTO_CAPTURE_SCHEMA_ID`、`ARCHITECTURE_AUTO_CAPTURE_REQUESTED_EVENT`、`ARCHITECTURE_AUTO_CAPTURE_FAILED_EVENT`、`ARCHITECTURE_AUTO_CAPTURE_EVENT_VERSION`、`ARCHITECTURE_SOURCE_OBSERVED_EVENT`、`ARCHITECTURE_SOURCE_OBSERVED_EVENT_VERSION`、`OBSERVED_ARCHITECTURE_BODY_CONTENT_TYPE`、`FILE_GRAPH_CHUNK_CONTENT_TYPE`、`readSourceCaptureRef`、`readArtifactRef`、`readPersistedSourceCaptureRef`、`validateObservedFileGraphChunkV2`、`decodeObservedFileGraphChunk`、`mergeObservedFileGraphChunks`、`decodeObservedArchitectureBody`、`encodeObservedArchitecture`、`encodeObservationCurrent`、`encodeArchitectureSourceObservedEvent`、`encodeArchitectureAutoCapture`、`encodeArchitectureAutoCaptureEvent`、`decodeArchitectureAutoCapture`、`decodeArchitectureAutoCaptureEvent`、`decodeObservedArchitectureRecord`、`decodeObservationCurrent`、`decodeArchitectureSourceObservedEvent`。
- catalog-record-codecs：`ARCHITECTURE_CATALOG_SCHEMA_ID`、`ARCHITECTURE_CATALOG_ADOPTED_EVENT`、`ARCHITECTURE_CATALOG_EVENT_VERSION`、`S4B_CATALOG_REVISION_BY_PROJECT_LOOKUP`、`ARCHITECTURE_CATALOG_REVISED_EVENT`、`readModuleRef`、`readArchitectureBaselineRef`、`readArchitectureCatalogRef`、`readArchitectureBaselinePin`、`readConstraints`、`readArchitectureBaselineSnapshot`、`validateAdoptedArchitecture`、`encodeArchitectureCatalog`、`encodeArchitectureCatalogAdoptedEvent`、`encodeArchitectureCatalogRevisedEvent`、`decodeArchitectureCatalogRecord`、`decodeArchitectureCatalogAdoptedEvent`、`decodeArchitectureCatalogRevisedEvent`。
- architecture-service：`normalizeFileGraph`、`serializeFileGraphChunks`（文件图存储步骤的纯 helper）、`safeMappingPath`（`src/core/work-graph/architecture/architecture-service.ts:133`，映射路径的收窄检查）。
- file-graph-index：`FILE_GRAPH_PAGE_SIZE`、`FILE_GRAPH_MAX_IMPACT_DEPTH`、`FileGraphCursorError`。
- graph-index：`ObservedGraphCursorError`。
- catalog-service：`BASELINE_SCHEMA_ID`、`BASELINE_ACTIVE_SCHEMA_ID`、`activeRefKey`、`baselineRefFor`、`catalogRefFor`（baseline/active/catalog 的 ref 与键配方）。
- repair-ops：`catalogRevisionMovesProblem`、`structuralOfRepair`、`repairNeedsCard`、`repairBindingDigest`、`RepairProblemV1`。
- revision-planner：`catalogRevisionKeys`、`catalogRevisionPinProblem`、`CatalogRevisionInputV1`、`CatalogRevisionContribution`、`CatalogRevisionDependencies`。
- proposal-service：`proposeArchitectureRevision`、`freezeArchitectureProposalBatch`、`applyArchitectureProposalBatch`、`ProposalBatchWindowPort`、`ProposalRunFactResolver`、`ProposalDecisionMessageRead`、`ProposalServiceDeps`、`ArchitectureProposalService`。
- proposal-record-codecs：`ArchitectureProposalRefShape`、`ArchitectureProposalBatchRefShape`、`ArchitectureProposalFields`、`ArchitectureProposalBatchFields`、`S8C_PROPOSAL_BY_PROJECT_LOOKUP`、`S8C_PROPOSAL_BATCH_BY_PROJECT_LOOKUP`、`ArchitectureProposalFormat`、`ArchitectureProposalBatchFormat`、`ARCHITECTURE_PROPOSAL_CHANGED_EVENT`、`ArchitectureProposalChangedFormat`、`architectureProposalCodec`、`architectureProposalBatchCodec`、`architectureProposalChangedEventCodec`、`ARCHITECTURE_PROPOSAL_SCHEMAS`、`encodeArchitectureProposalRecord`、`encodeArchitectureProposalBatchRecord`、`decodeArchitectureProposalRecord`、`decodeArchitectureProposalBatchRecord`、`encodeArchitectureProposalChangedEvent`、`decodeArchitectureProposalChangedEvent`。

## 不要做
- 不要把观测 capture 当正式 baseline 或 adopted architecture；两者是不同聚合，正式采用（`adoptInitialArchitecture`）和修订只由 `catalog-service.ts` 负责，`architecture-service.ts` 不做这件事。
- 不要另写图遍历、SCC 或 cursor 编解码；用 `graph-index.ts`、`architecture-delta.ts`、`encodeCursor`（M1-37 的同类教训是别复制管线）。
- 不要用路径/名字猜语义移动、依赖方向或规则结论；差异只报结构 key 与 digest 证明的事实。
- 不要绕过注入的 `GoalRecordTransactionPort` 写记录，也不要手改受保护状态字段；状态写入只经 `state/`（`AGENTS.md` 第 9 条、M1-01）。
- 不要重排事件字段、改校验顺序或给旧格式补默认值；编解码走本层唯一注册（M1-37、CS-01）。
- 不要把缺失、损坏或不可读的 catalog/body 读成空事实或 `not_found`（FP-05、M1-12、MH-06）。
