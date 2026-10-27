# src/ 总图：给施工者的导航

这是 `src/` 的总图，不是规格。**任务书和它点名的规格优先**；本图与文件夹 README 只帮助定位，冲突时以代码为准。写代码前先读 [`src/AGENTS.md`](AGENTS.md)（复用、分层、写法与收尾规范）；写测试前先读 [`tests/README.md`](../tests/README.md) 的夹具清单和 [`tests/RULES.md`](../tests/RULES.md) 的规则。每层的职责、文件清单与可复用能力以各文件夹 README 为准。

## 模块和文件夹

### 五个模块

| 模块 | 目录 | 负责什么 |
| --- | --- | --- |
| Workflow | `src/business/workflow/` | 业务流程与决策：`advanceWork` 选下一步、request intake、咨询/决定/归档；只调一个核心 owner。 |
| WorkGraph | `src/core/work-graph/` | 正式事实、查询与读模型；13 个子模块，受保护状态迁移的唯一入口。 |
| AgentRuntime | `src/core/agent-runtime/` | 把已受理的 Work/Query 接到 Kernel：准备、执行、观察、工具、上下文。 |
| WorkspaceTools | `src/core/workspace/` | 只读的文件、Git、源码捕获与各语言索引。 |
| RecordStore | `src/core/record-store/` | 记录、正文与索引的机械持久化；不含领域规则。 |

### src/ 顶层文件夹

| 文件夹 | 负责什么 |
| --- | --- |
| `app/` | Host 进程外壳：CLI、HTTP/SSE、设置、启动对账、注意力与驱动；只调 composition 公开端口。 |
| `business/` | 业务层；当前只有 `workflow/`。 |
| `composition/` | 唯一装配根：`createTargetPlatform` 把受信任配置和各 owner 接成平台。 |
| `contracts/` | 最外层纯契约：身份、结果、提示词、校验；不放 I/O 或状态机。 |
| `core/` | 核心：`agent-runtime/`、`record-store/`、`workspace/`、`work-graph/`。 |

### 有 README 的文件夹

| 文件夹 | 负责什么 | README |
| --- | --- | --- |
| `app/` | Host 启动、HTTP 路由、设置、秘书档案、驱动与启动对账 | [app/README.md](app/README.md) |
| `business/workflow/` | Workflow：推进、请求 intake、决定/咨询/归档、工作线创建 | [business/workflow/README.md](business/workflow/README.md) |
| `composition/` | 唯一装配根、duty 解析、提交观察与工作线对话 | [composition/README.md](composition/README.md) |
| `contracts/` | 共享身份/结果/事件/读模型 DTO 与校验原语 | [contracts/README.md](contracts/README.md) |
| `contracts/core/` | 核心原语：调用上下文、结果、Session、归档、消息、准备执行清单 | [contracts/core/README.md](contracts/core/README.md) |
| `contracts/prompts/` | 提示词包格式、模板解析/渲染、选包合并、冻结提示词集 | [contracts/prompts/README.md](contracts/prompts/README.md) |
| `contracts/validation/` | 命令体字段校验器与结构原语，输出 `ValidationIssue[]` | [contracts/validation/README.md](contracts/validation/README.md) |
| `core/agent-runtime/` | Work/Query 执行准备、Kernel 模型循环、观察、工具组、上下文装配 | [core/agent-runtime/README.md](core/agent-runtime/README.md) |
| `core/record-store/` | 记录/事件原子提交、正文内容寻址、lookup 翻页/计数/全文检索 | [core/record-store/README.md](core/record-store/README.md) |
| `core/work-graph/` | WorkGraph 根：两个 `source-authority-*` 端口与 13 个子模块导航 | [core/work-graph/README.md](core/work-graph/README.md) |
| `core/work-graph/model/` | L0 共享 DTO/端口与纯 helper：图邻接、工具参数映射、索引名 | [core/work-graph/model/README.md](core/work-graph/model/README.md) |
| `core/work-graph/state/` | 受保护生命周期字段的唯一构造与 `transition*`（纯子模块） | [core/work-graph/state/README.md](core/work-graph/state/README.md) |
| `core/work-graph/persistence/` | 记录/事件编解码、`PreparedCommit` 编译、完整索引读、失败映射 | [core/work-graph/persistence/README.md](core/work-graph/persistence/README.md) |
| `core/work-graph/configuration/` | Project/Workspace 初始化、CompletionPolicy、角色规格、决定设置、线 pin | [core/work-graph/configuration/README.md](core/work-graph/configuration/README.md) |
| `core/work-graph/materials/` | 材料存取、适用性与 Run/QueryRun 规范事实读取 | [core/work-graph/materials/README.md](core/work-graph/materials/README.md) |
| `core/work-graph/architecture/` | 正式架构目录与观测架构：图算法、编解码、读写服务 | [core/work-graph/architecture/README.md](core/work-graph/architecture/README.md) |
| `core/work-graph/sessions/` | Session 目录、生命周期、健康、责任转移、消息与 Session codec | [core/work-graph/sessions/README.md](core/work-graph/sessions/README.md) |
| `core/work-graph/queries/` | QueryJob/QueryRun 提交、执行写入、请求轮次读取 | [core/work-graph/queries/README.md](core/work-graph/queries/README.md) |
| `core/work-graph/tasks/` | Goal/Task/Plan/Request/Run 写入 owner 与定向读取 | [core/work-graph/tasks/README.md](core/work-graph/tasks/README.md) |
| `core/work-graph/notes/` | 注记写入/处置/读取、锚点、书记范围与记忆材料 | [core/work-graph/notes/README.md](core/work-graph/notes/README.md) |
| `core/work-graph/evidence/` | 证据与验证轮唯一写入 owner，编译检查计划并折证据 | [core/work-graph/evidence/README.md](core/work-graph/evidence/README.md) |
| `core/work-graph/communication/` | 决定答复与 Session 邮箱的事实 owner | [core/work-graph/communication/README.md](core/work-graph/communication/README.md) |
| `core/work-graph/communication/decision-source/` | 每种决定来源一个 handler，从正式记录重建该分支的完整事实 | [core/work-graph/communication/decision-source/README.md](core/work-graph/communication/decision-source/README.md) |
| `core/work-graph/views/` | 只读投影：工作线、图、轨道、活动、决定队列与请知悉 | [core/work-graph/views/README.md](core/work-graph/views/README.md) |
| `core/workspace/` | 文件/Git/源码捕获、路径边界、TS/Python/C++ 索引 | [core/workspace/README.md](core/workspace/README.md) |

## 要做什么 → 去哪里

| 要做什么 | 去哪个文件夹（必要时到文件） | 先看的可复用能力（含位置） |
| --- | --- | --- |
| 加一个 HTTP 路由 | `src/app/`（`core-routes.ts`、`server.ts`） | `dispatchCoreRoute`（`src/app/core-routes.ts:1167`）、`parseCoreRouteRequest`（`src/app/core-routes.ts:613`） |
| 加一个 Host 选项 / 运行期配置 | `src/app/`（`host.ts`、`runtime-configuration.ts`）+ `src/composition/` | `createLocalWorkbenchHost`（`src/app/host.ts:440`）、`createTargetPlatform`（`src/composition/create-platform.ts:755`） |
| 加一种记录或索引 | `src/core/record-store/`（`lookup-ports.ts`、`ports.ts`） | `RecordLookupIndex`（`src/core/record-store/lookup-ports.ts:5`）、`RecordLookupPort`（`src/core/record-store/lookup-ports.ts:35`） |
| 加一种事件/记录编解码 | `src/core/work-graph/persistence/` | `createEventCodec`（`src/core/work-graph/persistence/event-codec-factory.ts:42`）、`canonicalRefKey`（`src/core/work-graph/persistence/record-codecs.ts:81`） |
| 状态迁移 | `src/core/work-graph/state/`（按聚合分文件） | `transitionRun`（`src/core/work-graph/state/run-machine.ts:1366`）、`transitionTask`（`src/core/work-graph/state/task-machine.ts:797`） |
| 加一个读模型 | `src/core/work-graph/views/` | `createWorkLineReader`（`src/core/work-graph/views/work-line-reader.ts:3049`）、`createCollectionCardSource`（`src/core/work-graph/views/decision-read-model.ts:302`） |
| 改提示词模板或渲染 | `src/contracts/prompts/` | `renderTemplate`（`src/contracts/prompts/render-template.ts:387`）、`resolvePromptPackV1`（`src/contracts/prompts/resolve-pack.ts:79`） |
| Kernel 补丁（vendor 冻结） | 脚本 `scripts/build-kernel-patch.mjs`；适配 `src/core/agent-runtime/`（`observed-model-run.ts`） | `runObservedModel`（`src/core/agent-runtime/observed-model-run.ts:207`） |
| Workflow 的驱动和唤醒 | `src/business/workflow/` | `createWorkflow`（`src/business/workflow/workflow.ts:764`）、`createRequestIntake`（`src/business/workflow/request-intake.ts:185`） |
| 请求和秘书 | `src/core/work-graph/tasks/`（`request-service.ts`、`secretary-selection.ts`、`initialization-pointers.ts`）、`src/core/work-graph/views/`（`secretary-preparation-facts.ts`） | `admitRequestSecretary`（`src/core/work-graph/tasks/secretary-selection.ts:191`）、`createRequestRoundService`（`src/core/work-graph/tasks/request-service.ts:862`）、`createSecretaryPreparationFacts`（`src/core/work-graph/views/secretary-preparation-facts.ts:507`）、`readInitializationPointers`（`src/core/work-graph/tasks/initialization-pointers.ts:46`） |
| Session 生命周期 | `src/core/work-graph/sessions/` | `createSessionLifecycleService`（`src/core/work-graph/sessions/session-lifecycle.ts:273`）、`createSessionDirectory`（`src/core/work-graph/sessions/session-directory.ts:560`） |
| Session 创建与 Kernel 历史读取 | `src/core/agent-runtime/`（`session-operations.ts`、`observation-recovery.ts`） | `createSessionOperations`（`src/core/agent-runtime/session-operations.ts:529`）、`createExecutionHistoryReader`（`src/core/agent-runtime/observation-recovery.ts:242`） |
| 工作线读取 | `src/core/work-graph/views/`（`work-line-reader.ts`） | `createWorkLineReader`（`src/core/work-graph/views/work-line-reader.ts:3049`）、`assembleLineBriefs`（`src/core/work-graph/views/work-line-reader.ts:232`） |
| 附件和材料 | `src/core/work-graph/materials/` | `createMaterialService`（`src/core/work-graph/materials/material-service.ts:116`）、`createMaterialApplicability`（`src/core/work-graph/materials/applicability.ts:23`） |
| 架构图/正式架构 | `src/core/work-graph/architecture/` | `createObservedArchitecture`（`src/core/work-graph/architecture/architecture-service.ts:904`）、`readCurrentCatalogWindow`（`src/core/work-graph/architecture/catalog-service.ts:368`）、`catalogPinOf`（`src/core/work-graph/architecture/catalog-service.ts:443`） |
| 笔记（注记） | `src/core/work-graph/notes/` | `createNoteService`（`src/core/work-graph/notes/note-service.ts:468`）、`createNoteReadModel`（`src/core/work-graph/notes/note-read-model.ts:306`） |
| 配置和设置 | `src/core/work-graph/configuration/` | `createProjectBootstrapServices`（`src/core/work-graph/configuration/project-bootstrap-service.ts:1125`）、`createRoleConfigurationService`（`src/core/work-graph/configuration/role-memory-service.ts:206`） |
| 记录存储（提交/回执/翻页） | `src/core/record-store/`（`ports.ts`、`lookup-ports.ts`） | `GoalRecordTransactionPort`（`src/core/record-store/ports.ts:188`）、`lookupCommit`（`src/core/record-store/ports.ts:190`） |
| 测试夹具 | `tests/helpers/`（先读 `tests/README.md`）；内存/SQLite 后端在 `src/core/record-store/` | `createInMemoryRecordBackend`（`src/core/record-store/in-memory-record-store.ts:71`） |
| Query 提交/执行 | `src/core/work-graph/queries/` | `createQueryJobService`（`src/core/work-graph/queries/query-job-service.ts:877`）、`createQueryExecution`（`src/core/work-graph/queries/query-execution.ts:1047`） |
| Run 控制与对账 | `src/core/work-graph/tasks/`（`control-service.ts`、`run-reconcile-service.ts`） | `createRunControlService`（`src/core/work-graph/tasks/control-service.ts:583`）、`createRunReconcileService`（`src/core/work-graph/tasks/run-reconcile-service.ts:649`） |
| 证据与验证轮 | `src/core/work-graph/evidence/` | `createEvidenceService`（`src/core/work-graph/evidence/evidence-service.ts:824`）、`compileVerificationPlan`（`src/core/work-graph/evidence/verification-plan.ts:61`） |
| 消息与决定答复 | `src/core/work-graph/communication/` | `createSessionMailbox`（`src/core/work-graph/communication/mailbox-service.ts:1050`）、`createDecisionMessageService`（`src/core/work-graph/communication/decision-service.ts:198`） |
| 模块依赖检查 | `docs/refactor/module-target.json`（`npm run check:architecture`）；跨层共享契约放 `src/core/work-graph/model/` | `GraphWrite`（`src/core/work-graph/model/task-contracts.ts:28`） |
| 工具注册/工具组 | `src/core/agent-runtime/`（`tool-group-assembly.ts`） | `selectWorkToolGroup`（`src/core/agent-runtime/tool-group-assembly.ts:220`）、`finalToolNamesOf`（`src/core/agent-runtime/tool-group-assembly.ts:519`） |
| 上下文装配 | `src/core/agent-runtime/`（`context-assembler.ts`、`context-rendering.ts`、`context-secretary-recipe.ts`） | `createContextAssembler`（`src/core/agent-runtime/context-assembler.ts:27`）、`renderContext`（`src/core/agent-runtime/context-rendering.ts:396`）、`assembleSecretaryContext`（`src/core/agent-runtime/context-secretary-recipe.ts:106`） |
| 模型调用 permit | `src/core/work-graph/tasks/`（`model-call-service.ts`、`model-call-contracts.ts`） | `createModelCallService`（`src/core/work-graph/tasks/model-call-service.ts:154`）、`modelRequestPermitIdFor`（`src/core/work-graph/tasks/model-call-contracts.ts:80`） |
| Goal/Plan | `src/core/work-graph/tasks/`（`task-service.ts`、`plan-service.ts`） | `admitGoalCreation`（`src/core/work-graph/tasks/task-service.ts:156`）、`createPlanService`（`src/core/work-graph/tasks/plan-service.ts:1073`） |
| 返工/重排队 | `src/core/work-graph/tasks/`（`requeue-service.ts`）+ `src/core/work-graph/state/` | `createTaskRequeueService`（`src/core/work-graph/tasks/requeue-service.ts:600`）、`newTaskRequeueRecord`（`src/core/work-graph/state/task-machine.ts:711`） |
| 源码探索与捕获 | `src/core/workspace/`（`capture.ts`、`workspace-tools.ts`） | `CaptureRegistry`（`src/core/workspace/capture.ts:111`）、`createWorkspaceTools`（`src/core/workspace/workspace-tools.ts:74`） |
| Git 与工作树比较 | `src/core/workspace/`（`git-read.ts`、`workspace-change-capture.ts`） | `compareGitWorkingTree`（`src/core/workspace/git-read.ts:583`）、`captureWorkspaceChange`（`src/core/workspace/workspace-change-capture.ts:276`） |
| 全文检索/注记查找 | `src/core/record-store/`（`lookup-ports.ts`） | `RecordTextSearchPort.searchText`（`src/core/record-store/lookup-ports.ts:130`） |
| 决定队列/请知悉 | `src/core/work-graph/views/`（`decision-read-model.ts`、`notice-grouping.ts`） | `createDecisionReadModel`（`src/core/work-graph/views/decision-read-model.ts:203`）、`groupNotices`（`src/core/work-graph/views/notice-grouping.ts:63`） |

## 依赖方向

以 [`docs/refactor/module-target.json`](../docs/refactor/module-target.json) 为准，`npm run check:architecture` 强制：Workflow → {WorkGraph, AgentRuntime, WorkspaceTools}；WorkGraph → {WorkspaceTools, RecordStore}；AgentRuntime → {WorkGraph, WorkspaceTools, RecordStore}；WorkspaceTools 与 RecordStore 无依赖。WorkGraph 不 import Workflow、AgentRuntime、`app/`、`composition/`；WorkGraph 内 `queries` 不 import `tasks`。WorkGraph 子模块上层可依赖下层，反过来不行；`model` 可依赖 `state`，`state` 不依赖 WorkGraph 其它子模块。需要上层能力时在 `model/` 声明端口，由组合根注入。
