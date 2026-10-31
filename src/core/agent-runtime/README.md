# src/core/agent-runtime：把已受理的 Work/Query 执行事实接到 Kernel 模型循环，并把原始历史还原成可提交的观察

## 负责什么，不负责什么
- 负责：Work/Query 的准备（有界 manifest、冻结提示词与工具声明、工作区基线）、fresh 启动、运行观察/归约、控制投递、预算计量、Run 启动对账、Session 创建与原历史读取、工具适配与工具组装配、上下文装配与渲染。
- 只做适配：可信绑定与平台配置由 Host/组合根提供；记录、业务规则、授权判定和状态迁移都在 WorkGraph，本层不持有第二份事实。
- 依赖只允许 WorkGraph、WorkspaceTools、RecordStore 和 `src/contracts`；不得 import `src/business`、`src/app`、`src/composition`。Kernel 只经 `vendor/coding-agent/dist/public-api.js`。
- 状态写入：本层不直接造状态记录，状态迁移只经 `src/core/work-graph/state/` 的构造器（AGENTS 第 9 条）；本层只提交观察与事实。
- 提示词：包格式、选包和模板渲染的正本在 `src/contracts/prompts`，本层只消费。

## 文件

### Runtime 与执行驱动
做 Runtime 装配、执行端口和 Work/Query 驱动接线的去这组。
- `index.ts` — 包入口，只导出 `createAgentRuntime` 与 capability 类型。
- `contracts.ts` — capability 词汇（`RuntimeCapabilities`）。
- `ports.ts` — `RuntimeExecutionPort`/`AgentRuntimePort`/`AgentRuntimeService`：整个执行面的正式端口；`countRunActivity` 与 `countQueryActivity` 是并排的只读活动计数。
- `runtime.ts` — `createAgentRuntime`：装配并发布端口；无依赖时只给显式 unsupported/unavailable，不伪造能力。`countQueryActivity` 先按 ref 读已结束的 QueryRun：没有执行状态、没有固定入口或结果是 `not_entered` 的答 `not_entered`；其余再读执行 Session，窗口上界与 `countRunActivity` 共用一个选择（`endPosition` → Turn 终点 → 保存的对账观察 → Kernel 尾部），丢失窗口时从位置 0 读起；`maxPages` 原样交给窗口读取器校验。
- `execution-contracts.ts` — 执行与 Query 的 prepare/start/observe 请求、结果和 `RuntimeExecutionDependencies` 依赖束；`messages` 是完整 `SessionMessageCommandPort`。
- `execution-history-contracts.ts` — 原历史分页与图执行历史的请求/端口类型。
- `execution-control.ts` — 内部安全点控制协调器：pause/cancel 的 live handle 与退出证明。
- `execution-driver.ts` — Work fresh 执行驱动与 shell blocked/allowance hook。

### 执行准备与输入
做 Work 准备、输入通道、模型预算、注册检查和 Role profile 的去这组。
- `execution-preparation.ts` — Work 准备：读已受理事实与 Role/Host 配置，存有界 manifest、冻结提示词和工作区基线。
- `execution-inputs.ts` — 统一输入通道：邮件、答复、到期（expiry）、steer 和 attention 的候选与 accepted 排除。`only: 'notify'` 是秘书请求轮的供给：跳过 person 列表、续接与答复邮件，只把 `intent` 缺省或 `notify` 的收件箱邮件经 `readMessagePart` 供出（`notify-delivery`）。
- `check-execution.ts` — 可信 Host 注册检查执行器。
- `model-budget.ts` — 模型预算、token 计量与超限错误。
- `model-call-access.ts` — 一次性模型调用许可：绑定校验、durable permit。
- `run-limits.ts` — 平台预算映射为 Kernel `RunLimits`。
- `role-profiles.ts` — 平台 Role duty profile 表。

### Kernel 适配与模型调用
做 Kernel 模型/工具循环、Turn 解码、Session 存储映射和原历史分页的去这组。
- `observed-model-run.ts` — 唯一的 Kernel 模型/工具循环。
- `kernel-turn-facts.ts` — Kernel SessionRecord 解码与单个 Turn 归约。
- `kernel-store-locator.ts` — Session 到 Kernel store 的固定映射注册表。
- `session-operations.ts` — Session 创建、原历史分页、cursor owner 与 Kernel DB 状态；`readConsultationHistory` 用同一个 `readPositionWindow` 有界读完冻结前缀，并在 `mapHistoryFailure` 展平之前保留 missing/corrupt/transient/cancelled 分类。

### 上下文与提示词渲染
做上下文装配、各调用配方、事实文本、渲染和提示词冻结的去这组。
- `context-assembler.ts` — 上下文装配入口与依赖接线。
- `context-types.ts` — 装配器类型、模板 id（含 `secretary-round`）、节序与历史判定词汇；`RuntimeExecutionDependencies.secretaryFacts?` 是同一准备端口的注入点（装配器只接收准备读好的值）；请求轮的准备在最终工具名单之前读一次，装配输入 `secretaryFacts` 带着同一个值。
- `context-work-recipe.ts` — Work 上下文装配配方。
- `context-query-recipe.ts` — Query 上下文装配配方；请求轮先按 `isRequestRound` 转到秘书配方。`intervention_planning` 走自己的 `intervention-planning` 模板：`plan` 槽是 `task` 段、`message` 槽放问题，`callKind` 记 `intervention_planning`，不渲染 footprint。
- `context-secretary-recipe.ts` — 秘书轮上下文装配：用准备读好并传入的 `secretaryFacts` 值（配方不再读端口），`memoryMaterial` 仍按声明依赖读，由共享渲染器写 `secretary-round` 的三个 task 槽与 notes 预算。`roundMaterial` 渲染一轮的材料：输入行、选中的思路，再是 `ask` 带的卡片引用（`## Cards` 下每个引用一行，写钉住的版本；对象动过加 `(now @当前版本)`，不存在加 `(not found)`）。可选输入 `handoff: SecretaryHandoffPromptFactsV1`（旧秘书的 understanding 目标清单，或继任者的一份交接 brief）经两个交接模板渲染后加在 task 段开头；所需交接材料属于 task 材料，不放进可截断的 notes。
- `context-review-recipe.ts` — review 轮上下文装配。
- `context-continuation-recipe.ts` — continuation 段的 blocked commands 与 brief 事实。
- `context-history-facts.ts` — Session 历史模式/基线判定与 Kernel 命令事实。
- `context-fact-text.ts` — 各段 payload/文本构造（Role、Goal、Task、Query、notes 等）；`withNoteVersion` 与 `understandingLine` 是共用的注记行规则。
- `consultation-facts-text.ts` — 平台事实的唯一渲染器：`consultationFactLine` 把一条已解析事实渲染成正文行或 `- unreadable: <定位符>` 行，`consultationFactsLines` 依次渲染免责声明、已解析事实、omitted 与 unreadable 列表；不读端口、不重采集。
- `context-rendering.ts` — 纯渲染：节序、字节预算、模板渲染、attention；固定字符串读取用 `packString`（`src/contracts/prompts/pack-string.ts:4`）；`templateSectionOrder` 把 `secretary-round` 的三个 `task_*` 槽投影成一个 `task` 段，`sectionOrderFor`/`queryPreparedSectionOrder` 也覆盖 `secretary`，`renderQueryContext` 同时渲染秘书轮。`intervention-planning` 的 `plan` 槽同样投影成 `task` 段（`message` 不是段），`sectionOrderFor`/`queryPreparedSectionOrder` 覆盖 `intervention_planning`，该模板没有可选段。
- `context-review-input.ts` — unknown-call review 输入构造与命令字节上限。
- `context-workspace-facts.ts` — brief/review 用的工作区事实与 diff。
- `context-support.ts` — 本层小工具（排序、拒绝结果映射与文本投影）。
- `architecture-reminders.ts` — 纯架构提醒行构造（消费 findings，不重比图）。
- `prompt-set-texts.ts` — 提示词文本存取、pack 解析与 Skill 选择。
- `platform-skill-root.ts` — 仓库 `resources/skills` 根常量。

### 工具注册与工具实现
做工具组装配和每个 Kernel 工具实现的去这组。
- `tool-group-assembly.ts` — 工具组装配、工具名清单与顺序。`FinalToolListInputV1.answerTools` 可为 `null`/`secretary`/`initial`：只有两个 Query 调用按冻结的 `executionKind` 给出，`finalToolNamesOf` 把提交工具名追加在既有扩展名之后，Work 不传、行为不变。`FinalToolListInputV1.noteAdmission`（必填）决定 Query 是否选 `record_note`：只有 `secretary` 类才选，Work 分支不读它；`selectWorkToolGroup` 里的 Work 注记工具声明传入全部写入种类与 `withdraw: true`。`WorkToolGroupInput.mailbox` 是完整 `SessionMessageCommandPort`；未绑定的检查在 mailbox/decision 分支内，只选用户决策工具同样要求它。`createQueryGraphToolGroup` 接受可空 `goalRef` 与可选 notes 读端口（只有秘书轮绑定）；`createGraphHistoryProxy` 在无可信目标时以 `invalid` 拒绝。
- `exploration-tools.ts` — 源码探索工具组。
- `graph-tools.ts` — `look_graph`/`find_graph` 只读图工具，`success`/`rejectedResult` 是各工具共用的结果构造（提交工具也直接用它们）；`goalRef` 可为 `null`（请求无目标时的项目读分支）。`history` 模式没有可信目标时以 `invalid`“this request has no goal”拒绝，不拿别的目标的历史。
- `answer-tools.ts` — 秘书填表式回答（97-3）的三个提交工具。`ANSWER_TOOL_NAMES` 是名字清单；`createAnswerTools` 按冻结的 manifest 事实每轮建 zod schema（只在无 `effectiveGoalId` 的轮次出现 `goalCardDrafts`/`planDraftIndex`），处理器不写任何东西：`buildAnswerText` 把表单拼成今天的 v1/v2 协议文本并填入版本、`phase: "pending"`、`requireDag` 与每个 ref 的项目号；`answerProblems` 是检查入口；`answerSubmitNamesIn`/`answerToolsOf` 从冻结的工具名和执行种类取名字；`createAnswerToolBarrier` 在收下的提交组后 `yield`；`submittedAnswerArgumentsOf` 按 transcript 找第一条成功的提交调用参数，观察侧用同一 `buildAnswerText` 重建。
- `note-tool.ts` — `record_note` 工具。`NoteToolsConfig` 的 `kinds`/`withdraw` 决定声明：写入种类枚举正好是 `kinds`，`review` 只在完整 Work 种类集（含 `repair`）下才建，`withdraw` 只在被准可时才建；空 `kinds` 在构造时抛错，不注册一个只能被拒的工具。
- `whiteboard-tools.ts` — 白板/未来计划工具。
- `communication-tools.ts` — SessionMailbox 与用户决策工具。`SessionMailboxToolsConfig.mailbox` 是完整 `SessionMessageCommandPort`；`send_session_message` 带 `expected`/`taskRef`/`followupOf`/`deadlineMs`，没有 `goalRef`；`respond_session_message` 是扁平的两臂 `{ messageRef, expectedRevision, text } | { messageRef, expectedRevision, reject: true, reason }`。
- `session-discovery-tools.ts` — Session 发现工具（已弃用，保留旧 Run 行为）。
- `unknown-call-review-tools.ts` — review 轮的记录与更安全方案工具。
- `command-rerun-tools.ts` — `request_command_rerun` 工具。
- `readonly-command-tool.ts` — `run_readonly_command` 沙箱工具、注册与选项。

### 观察与恢复
做原历史观察、活动计数、continuation brief 和启动对账的去这组。
- `execution-observation.ts` — Work 观察：沿 locator 读原历史、归约 Turn、提交唯一终态。
- `query-observation.ts` — Query 原历史观察与终态提交；`MAX_ANSWER_BYTES` 是 16 KiB 回答上限；冻结清单含提交工具时，从第一条成功的提交参数经 `submittedAnswerArgumentsOf`/`buildAnswerText` 重建文本再走同一条 `formalAnswerOf`，无提交仍读最后的文本；transcript 有冻结清单里的收下提交时，`yielded`、`completed`、`failed`、`limit_exceeded` 都记为 `answered`，`cancelled` 仍 `cancelled`；无收下提交按各自旧映射；request round 的最终文本按 manifest 冻结的执行种类做秘书回答检查（`parseSecretaryAnswer`），空、超 16 KiB 或格式不符时终态 `failed`、不写回答、带 `answerCheck`；回答写回时带上解析出的草稿 `screening` 和顶层 `planDraftIndex`（普通 Query 是 `null`）；普通 Query 照旧记 `gap`。终态提交在同一 commit 里写这一 Turn 的活动计数（`tallyTurnActivity`，`bound: 'end_position'`），格式失败的终态也照写。
- `observation-recovery.ts` — 按 Kernel run/turn 过滤的精确原历史读取。
- `graph-execution-history.ts` — WorkGraph locator 到 RT7 原历史的适配。
- `continuation-brief-assembly.ts` — continuation brief 的事实读取与纯装配。
- `run-reconcile.ts` — 启动与进程内 Run/Query 对账分类器；QRR-04 用已读窗口写活动计数，QRR-06 的 attestation 事实带计数（Kernel 不可读或无固定 Turn 时是显式 `unknown`）。重建的 yielded continuation 只写 `kind: 'wait_reply'`，`expiry`/`intervention` 是 claim 的选择，不由 yield 写入。
- `session-anomaly-facts.ts` — 归档异常锚点旁的变更文件快照。
- `unknown-call-draft.ts` — unknown-call review 草稿读取与工作区捕获。
- `run-activity-reader.ts` — 有界活动窗口读取；`unknownFacts` 从 `src/contracts/run-activity.ts` 的正本转出。
- `run-activity-tally.ts` — 纯 Turn 活动计数。

### 查询与来源绑定
做 Query 驱动和源码捕获/来源绑定的去这组。
- `query-preparation.ts` — Query 有界输入准备与 manifest 绑定；由 Job 冻结的请求根算注记准入（`secretaryNoteAdmission`，`src/core/agent-runtime/query-preparation.ts:322`），并按准入把 `record_note` 冻进工具名清单。请求轮同一份冻结事实里读一次交接材料（SR3 第 6 项、§8.3）：旧秘书的理解轮把那条活命令的 goal 清单（`request.understandingGrants`，即授权所来自的同一份事实、同一条规则）交成 `{kind:'understanding'}`；manifest 带 `briefRef` 的继任轮经注入的 `handoff.readBriefState`（`QueryPreparationDependencies.handoff`）读一次四态——`waiting` 返回可重试的 `incomplete`（这一轮根本不准备）、`ready` 交 `{kind:'brief'}`、`none`/`consumed` 不出模板、读失败 `unavailable`，绝不折成空简报。`semantic_query` 的 consultation 带 `operation` 时经 `readConsultationCreate`（`src/core/work-graph/queries/platform-facts.ts:38`）读一次创建载荷；`platform_facts` 模式把每个冻结事实解析成正文（`record` 的正文、`body` 经材料端口打开、`task` 取冻结 PlanRevision 的定义），交给装配器的 `consultationFacts`，且不取 Session 历史。
- `query-execution.ts` — 一次 fresh QueryRun 的驱动。角色绑定与预算一律经 `queryExecutionBindingOf`；`callKind: 'secretary'` 的轮次把清单冻结的 `request.effectiveGoalId` 写进 `query_run` 主体的 `goalId` 并作为图工具目标（无目标时为 `null`，图工具读项目），其余 Query 的主体形状不变。注记准入从 manifest 的 `request` 重算一次（`src/core/agent-runtime/query-execution.ts:317`），与冻结的工具名同一次比较；缺注记写/检查 owner 是 `unavailable`，秘书轮在图工具组旁建 `record_note` 组（`createNoteTools`，`src/core/agent-runtime/query-execution.ts:454`），有提交工具的轮次再建 `createAnswerTools` 组并把 `createAnswerToolBarrier` 交给 `runObservedModel`，可信调用身份是 `r5b-query-note:` 加 QueryRun 与 Kernel 调用 id/名的 sha256。邮件供给只有一处：请求轮（`manifest.request !== null`）传 `only: 'notify'` 并优先于普通 `semantic_query` 分支，派生咨询仍不供。
- `project-source-tool.ts` — `project_source` 查询/捕获工具。
- `source-capture-access.ts` — 源码捕获访问与 Work/Query 工厂；Query 的主体/权限身份里的角色取 `queryExecutionBindingOf`，`intent.execution` 只留作执行身份校验。
- `source-tool-ports.ts` — 源码工具端口与 `BoundModel` 类型。
- `source-binding-types.ts` — 源码绑定读取的准备字段 `SourceRunSpec`。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createAgentRuntime` | `src/core/agent-runtime/runtime.ts:560` | 装配并发布整套执行端口；无依赖时只给显式 unsupported/unavailable，不伪造能力 | 组合根构造 Runtime 的唯一入口 |
| `createContextAssembler` | `src/core/agent-runtime/context-assembler.ts:27` | 按调用种类装配一次上下文 | prepare 需要正式上下文时，别自己拼 |
| `assembleSecretaryContext` | `src/core/agent-runtime/context-secretary-recipe.ts:193` | 按冻结的秘书准备事实渲染 `secretary-round` 并生成合法绑定；可选的 `handoff` 材料渲染后加在 task 段开头 | 秘书请求轮装配；经 `assembleQuery` 自动进入 |
| `SecretaryHandoffPromptFactsV1` | `src/core/agent-runtime/context-secretary-recipe.ts:135` | 秘书轮要 prepend 的交接材料：旧秘书 understanding 轮的目标清单，或继任者首轮的一份交接 brief | 调用方已从冻结 manifest 或交接 brief 端口读到材料时，交给 `handoff`；准备阶段已经这么做（见 `query-preparation.ts`） |
| `createExecutionPreparation` | `src/core/agent-runtime/execution-preparation.ts:306` | Work 有界准备与 manifest/提示词冻结 | 启动 Work Run 之前 |
| `createExecutionDriver` | `src/core/agent-runtime/execution-driver.ts:309` | Work fresh 启动、进入与模型循环 | 正式 Work Run 启动 |
| `createExecutionObservation` | `src/core/agent-runtime/execution-observation.ts:247` | 沿 locator 归约原历史并提交终态 | observe/reconcile Work Run |
| `createQueryPreparation` | `src/core/agent-runtime/query-preparation.ts:150` | Query 有界输入准备 | Query claim 之后 |
| `createQueryExecutionDriver` | `src/core/agent-runtime/query-execution.ts:210` | 一次 fresh QueryRun 驱动；秘书轮按准入多建 `record_note` 组 | 正式 Query 启动 |
| `createQueryObservation` | `src/core/agent-runtime/query-observation.ts:287` | Query 原历史观察与终态提交；request round 的回答检查结果放在终态观察的 `answerCheck`，回答带解析出的 `screening` 与 `planDraftIndex` | observe QueryRun |
| `mapOutcome` | `src/core/agent-runtime/query-observation.ts:121` | Kernel 终态到 Query 结局的映射：transcript 有冻结清单里的收下提交时，`yielded`/`completed`/`failed`/`limit_exceeded` 记 `answered`，`cancelled` 仍 `cancelled`；无收下提交按各自旧映射 | Query observer 的终态读取；重启的 Q-03 也走同一函数 |
| `createRuntimeControlCoordinator` | `src/core/agent-runtime/execution-control.ts:122` | 安全点 pause/cancel 协调与退出证明；关闭中的 Host 在每个在跑 Run 的下一个安全点暂停（无 intent、不 abort 控制器） | 投递控制意图；Host 关闭时由关闭信号驱动 |
| `createRuntimeModelCallAccess` | `src/core/agent-runtime/model-call-access.ts:41` | 一次性 durable 模型调用许可 | 每次 provider 调用前 |
| `runObservedModel` | `src/core/agent-runtime/observed-model-run.ts:207` | 唯一的 Kernel 模型/工具循环 | 需要跑模型时；不要写第二个循环 |
| `createSessionOperations` | `src/core/agent-runtime/session-operations.ts:540` | Session 创建、原历史分页与创建恢复 | 组合根创建/读 Session |
| `createSessionHistoryCursorOwner` | `src/core/agent-runtime/session-operations.ts:908` | 完成轮边界、cursor、turn bounds 与 `readConsultationHistory`（有界读完冻结前缀，保留 missing/corrupt/transient/cancelled 分类） | 需要 completed boundary 或咨询的历史分类 |
| `createKernelStoreRegistry` | `src/core/agent-runtime/kernel-store-locator.ts:46` | Session 到 Kernel store 的固定映射 | 组合根构造 Kernel reader |
| `createRegisteredCheckRunner` | `src/core/agent-runtime/check-execution.ts:78` | 执行注册检查并记录真实观察 | verification 检查 |
| `createGraphExecutionHistoryReader` | `src/core/agent-runtime/graph-execution-history.ts:170` | 图 locator 到原始历史的分页读取 | 读某 Run 的 Kernel 历史 |
| `createExecutionHistoryReader` | `src/core/agent-runtime/observation-recovery.ts:242` | 按 run/turn 过滤原历史页 | 精确原历史读取 |
| `createArchiveChangedFilesReader` | `src/core/agent-runtime/session-anomaly-facts.ts:111` | 归档锚点旁的变更文件快照 | `readArchiveChangedFiles` |
| `decodeKernelEntry` | `src/core/agent-runtime/kernel-turn-facts.ts:28` | 解码一条 Kernel SessionRecord | 所有 Kernel 历史读取 |
| `reduceTurnFromStart` | `src/core/agent-runtime/kernel-turn-facts.ts:53` | 从 turn 起点归约 `RunState` | 观察、对账、brief |
| `applyTurnEvents` | `src/core/agent-runtime/kernel-turn-facts.ts:62` | 在已归约状态上应用增量 | 增量观察 |
| `unresolvedToolCallIds` | `src/core/agent-runtime/kernel-turn-facts.ts:81` | 列未闭合工具调用 | 判断 Turn 能否完成 |
| `readRunActivityFacts` | `src/core/agent-runtime/run-activity-reader.ts:47` | 显式窗口内的有界活动事实 | 结束 Run 的活动计数 |
| `tallyTurnActivity` | `src/core/agent-runtime/run-activity-tally.ts:104` | 纯 Turn 活动计数 | 已有解码 Turn 时 |
| `countQueryActivity` | `src/core/agent-runtime/runtime.ts:906` | 已结束 QueryRun 的只读活动计数；从未进入 Kernel（没有执行状态、没有固定入口或 `not_entered`）答 `not_entered`，上界与 Run 计数同一选择，不写记录 | Query 活动 backfill 的读侧 |
| `readPreviousTurn` | `src/core/agent-runtime/continuation-brief-assembly.ts:537` | 读上一 Turn 的真实证据 | requeue brief |
| `assembleContinuationBrief` | `src/core/agent-runtime/continuation-brief-assembly.ts:798` | 纯函数装配 continuation brief | requeue Run 准备 |
| `reconcileRunAtStartup` | `src/core/agent-runtime/run-reconcile.ts:214` | 启动时分类一个 Run 并提交一次对账 | 启动恢复 |
| `reconcileQueryRunAtStartup` | `src/core/agent-runtime/run-reconcile.ts:567` | QueryRun 启动对账 | Query 恢复 |
| `reconcileRunControlsAtStartup` | `src/core/agent-runtime/run-reconcile.ts:518` | 启动时结清排队控制与已接受的 steer | 控制意图恢复 |
| `readAttestationFacts` | `src/core/agent-runtime/run-reconcile.ts:653` | 读 attestation 的 Kernel 与输入确认事实 | RUN-25 判定 |
| `readReviewDraftAtEntry` | `src/core/agent-runtime/run-reconcile.ts:742` | 入口一次读 Kernel 事实与未截断 review 草稿 | review 轮入口 |
| `readUnknownCallReviewDraft` | `src/core/agent-runtime/unknown-call-draft.ts:169` | 读完整 review 草稿 | review 候选与 attestation |
| `renderContext` | `src/core/agent-runtime/context-rendering.ts:418` | 按冻结模板渲染 Work 输入并记录节区间 | prepare Work |
| `renderQueryContext` | `src/core/agent-runtime/context-rendering.ts:452` | 渲染 Query 输入 | prepare Query |
| `consultationFactsLines` | `src/core/agent-runtime/consultation-facts-text.ts:31` | 平台事实段的完整文本：免责声明、已解析事实、omitted 与 unreadable 列表 | 装配带 `platform_facts` 创建载荷的咨询 Query 上下文时；不要另写渲染 |
| `rerenderContextV1` | `src/core/agent-runtime/context-rendering.ts:501` | 只替换 review 槽重渲染 | 准备 review 指令 |
| `renderAttentionChanges` | `src/core/agent-runtime/context-rendering.ts:543` | 渲染 attention 段 | attention 扫描 |
| `storePromptTexts` | `src/core/agent-runtime/prompt-set-texts.ts:168` | 每种文本只存一次，返回冻结 `PromptSetV1` | prepare 冻结提示词 |
| `readPromptTexts` | `src/core/agent-runtime/prompt-set-texts.ts:243` | 按 ref 读文本并校验内容 | 读冻结提示词 |
| `resolvePromptPack` | `src/core/agent-runtime/prompt-set-texts.ts:140` | 经 `PromptPackSourcePort` 解析指定 pack | prepare 选包 |
| `selectPromptSkills` | `src/core/agent-runtime/prompt-set-texts.ts:333` | 按选择取 Skill 内容 | prepare 冻结 Skill |
| `ModelBudget` | `src/core/agent-runtime/model-budget.ts:44` | 一次执行的预算与用量账 | 模型请求记账 |
| `kernelRunLimits` | `src/core/agent-runtime/run-limits.ts:40` | 平台预算映射为 Kernel limits | 启动 Kernel run |
| `selectWorkToolGroup` | `src/core/agent-runtime/tool-group-assembly.ts:218` | 按 grant/配置选 Work 工具组 | 驱动装配 |
| `finalToolNamesOf` | `src/core/agent-runtime/tool-group-assembly.ts:538` | 最终工具名与固定顺序；Query 只在该轮的注记准入是 `secretary` 时选注记工具；`answerTools` 为 `secretary`/`initial` 时追加对应提交工具 | 提交工具声明 |
| `createGraphHistoryProxy` | `src/core/agent-runtime/tool-group-assembly.ts:119` | 图历史读端口的工具代理 | 工具需要图历史 |
| `createProjectSourceTool` | `src/core/agent-runtime/project-source-tool.ts:238` | `project_source` 冻结模式工具 | 源码工具组 |
| `duplicates`（`project_source` 的 compare 选项） | `src/core/agent-runtime/project-source-tool.ts:120` | `duplicates: true` 让同一次 compare 在 after 材料上列出重复候选；缺省时结果与字节不变 | 模型要在一次比较里同时拿重复候选时 |
| `createExplorationTools` | `src/core/agent-runtime/exploration-tools.ts:105` | 源码探索工具组与生命周期 | 模型循环探索 |
| `kernelEnabledToolNames` | `src/core/agent-runtime/tool-group-assembly.ts:467` | Kernel 回调的启用工具名与顺序 | 构造 Kernel 回调 |
| `platformRoleProfile` | `src/core/agent-runtime/role-profiles.ts:70` | 平台 Role duty profile | 选择/配置 duty |
| `PLATFORM_SKILL_RESOURCE_ROOT` | `src/core/agent-runtime/platform-skill-root.ts:12` | 仓库 `resources/skills` 根 | 配置 Skill 根 |
| `READONLY_COMMAND_TOOL_NAME` | `src/core/agent-runtime/readonly-command-tool.ts:26` | 只读命令工具名 | Host 授权与配置过滤 |
| `projectQueryConfiguration` | `src/core/agent-runtime/query-preparation.ts:116` | 解析并校验 Query 的 Host 配置 | 组合根构造 Query 配置 |
| `readKernelCommandFacts` | `src/core/agent-runtime/context-history-facts.ts:221` | 读原 Run 的完整 command/cwd 事实 | review/blocked command |
| `rejected` | `src/contracts/core/rejections.ts:5` | **正本**：带 code/reason 的拒绝结果形状 | 拒绝输入或读失败时；本层只调本正本 |

### 同名能力
- `messageOf` 正本在 `src/contracts/error-message.ts`；本层 `runtime.ts:66`、`:67` 的 `messageOf`/`rejected` 只是这两个正本的本地常量别名（签名不变，因为生产可达性白名单记着这两个节点），新代码直接 import 正本。`isRecord`/`nonEmpty`/`utf8Bytes` 用 `src/contracts/validation/common.ts`，`rejected` 用 `src/contracts/core/rejections.ts`。
- 通用文本限制：`queryTextProblem`（`src/core/work-graph/queries/query-job-service.ts:92`）是 Query 文本的正本；本层的字节/条数上限是各协议固定值，不要另造通用校验器。

## 内部用
- 上下文事实与 payload：`assembleWorkContext`、`assembleQueryContext`、`assembleReviewForContext`、`assembleBriefForContext`、`readTaskBlockedCommands`、`takesSessionHistoryOf`、`sessionHistoryDecision`、`sessionBasisForContext`、`reviewSessionBasis`、`archiveOriginSkipsHistorySeed`、`runEnteredKernel`、`effectiveDuty`、`rolePayload`、`goalPayload`、`declarationsForTask`、`taskPayload`、`missingInputReminder`、`optionalRowsFromExtensions`、`annotations`、`queryFocusLines`、`queryPlanSummary`、`topLevelModuleCards`、`notImplementedExtensions`、`noteSourcesOf`、`briefWorkspaceFactsFor`、`readReviewCaptureChanges`、`unknownCallReviewFilesFor`。
- 上下文渲染与输入校验：`contextSectionHeaders`、`workContextPrelude`、`queryContextPrelude`、`CONTEXT_FORMAT_VERSION`、`CONTEXT_SECTION_ORDER`、`templateSectionOrder`、`sectionOrderFor`、`workPreparedSectionOrder`、`queryPreparedSectionOrder`、`renderSkillTextV1`、`ATTENTION_HEADER`、`ATTENTION_MAX_BYTES`、`REVIEW_COMMAND_MAX_BYTES`、`buildUnknownCallReviewInputV1`、`trimUnknownCallReviewInput`、`byKey`、`mapRead`、`requirementIdOf`、`emptyNotes`、`indexRowText`、`canonical`、`sortedSources`。
- 架构提醒与 continuation：`ARCHITECTURE_REMINDER_UNAVAILABLE_KEY`、`architectureReminderRowEntries`、`ANOMALY_ANCHOR_LIMIT`、`assembleAnomalySection`、`assembleUnknownCallReviewSection`、`acceptedMessagesOf`、`selfChangedFactsOf`。
- 执行、输入与预算：`createShellBlockedHook`、`SHELL_BLOCKED_UNCONFIRMED_TEXT`、`SHELL_ALLOWANCE_UNCONFIRMED_TEXT`、`turnIsComplete`、`terminalEventOf`、`transcriptHasOutcomeUnknown`、`deriveInputId`、`formatDecisionResponseInput`、`createMailboxInputSupply`、`createControlOnlyInputSupply`、`confirmMailboxInputs`、`PREPARED_MANIFEST_CONTENT_TYPE`、`MAX_PREPARED_MANIFEST_BYTES`、`WORKSPACE_BASELINE_CONTENT_TYPE`、`REVIEW_INSTRUCTION_MAX_BYTES`、`fitUnknownCallReviewForManifest`、`rehydratePreparedExecution`、`snapshotRuntimeConfiguration`、`loadPreparedManifest`、`briefWorkspaceFacts`、`MAX_QUERY_MANIFEST_BYTES`、`BudgetExceeded`、`ContextCapacityExceeded`、`taskBudgetDeadlineRemaining`、`remainingTaskDeadlineMs`、`RuntimeModelCallRejected`。
- 历史、活动与对账：`unknownFacts`、`bookLateEvidenceInProcess`、`stopPausedRunInProcess`、`kernelDatabaseState`、`RUNTIME_HISTORY_PRINCIPAL_ACTOR`。
- 工具适配：`createGraphTools`、`GRAPH_TOOL_NAMES`、`metadataSample`、`toModelCoverage`、`toModelCapture`、`projectSourceInputSchema`、`createNoteTools`、`NOTE_TOOL_NAMES`、`createWhiteboardTools`、`WHITEBOARD_TOOL_NAMES`、`createSessionMailboxTools`、`SESSION_MAILBOX_TOOL_NAMES`、`USER_DECISION_TOOL_NAMES`、`SESSION_MESSAGE_SEND_TIMEOUT_MS`、`createSessionDiscoveryTools`、`SESSION_DISCOVERY_TOOL_NAMES`、`createUnknownCallReviewTools`、`RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME`、`PROPOSE_SAFER_METHOD_TOOL_NAME`、`RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAMES`、`PROPOSE_SAFER_METHOD_TOOL_NAMES`、`UNKNOWN_CALL_REVIEW_EVIDENCE_MAX_CHARS`、`UNKNOWN_CALL_REVIEW_CRASH_EVIDENCE_MAX_CHARS`、`UNKNOWN_CALL_PROPOSAL_RATIONALE_MAX_CHARS`、`createCommandRerunTools`、`REQUEST_COMMAND_RERUN_TOOL_NAME`、`REQUEST_COMMAND_RERUN_TOOL_NAMES`。
- 工具组装配与源码捕获：`createQueryGraphToolGroup`、`createReviewToolGroup`、`createRerunToolGroup`、`assembleObservedExtensions`、`EXPLORATION_TOOL_NAMES`、`BUILTIN_TOOL_NAMES`、`RESERVED_TOOL_NAMES`、`RUNTIME_TOOL_NAMES`、`createSourceCaptureAccess`、`createRuntimeSourceCaptureFactory`、`createQuerySourceCaptureFactory`、`unknownCallInventoryProblem`、`captureUnknownCallWorkspace`、`createReadonlyCommandTool`、`registerReadonlyCommandTool`、`readonlyCommandSandboxOptions`、`READONLY_OUTPUT_STREAM_LIMIT_BYTES`、`READONLY_OUTPUT_LIMIT_BYTES`、`READONLY_DEFAULT_TIMEOUT_MS`、`READONLY_MIN_TIMEOUT_MS`、`READONLY_MAX_TIMEOUT_MS`、`READONLY_DISPATCHER_TIMEOUT_MS`、`READONLY_MAX_EXTERNAL_PATHS`。
- 提示词：`trackPromptTexts`、`promptRenderProblem`、`promptDeclarationProblem`、`DEFAULT_SKILL_SELECTION`、`DELIVERY_SET_TEMPLATE_IDS`、`templatesToFreeze`、`promptTemplatePart`、`promptTemplateVersion`。

## 不要做
- 不 import `src/business`、`src/app`、`src/composition`；不绕过 Kernel 的 `public-api` 取私有实现，也不把平台默认配置当业务事实。
- 不直接写 WorkGraph 记录或状态字段；状态迁移只用 `src/core/work-graph/state/` 的构造器，本层只提交观察/事实（AGENTS 第 9 条）。
- 不另写提示词渲染器或选包规则：格式、选包、渲染在 `src/contracts/prompts`；本层只组合 `parseTemplateV1`/`renderTemplate`。
- 不新建第二份 transcript、store、plan engine 或 budget：观察只沿 locator 读原始历史，工具是薄适配，业务判断留给 WorkGraph owner（M1-37/M1-19）。
- 不把失败读成空事实或成功：`mapRead` 保留原 code，`not_found`/`not_ready` 不当 ready（FP-05/M1-12/MH-06）。
