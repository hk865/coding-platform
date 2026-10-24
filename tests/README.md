# 测试夹具清单

写测试前**先在这里找夹具**：找到就直接用；夹具缺一个公开步骤，**报给 lead**，不要在测试里手写事实、补记录或绕过 owner。测试规则（允许什么、禁止什么、怎么判）见 `tests/RULES.md`。

`tests/helpers/` 按主题分组，每组内按文件名排序。每个 helper 一行：给出什么前置状态、走哪些公开步骤、谁在用。标「冻结」的夹具只能在末尾追加导出，已有内容不能改。

## tests/ 下的直接子文件夹

- `tests/app/` — Host/HTTP 路由、Host 装配与运行入口（72 个 `*.test.ts`），例如 `S5-decision-routes.test.ts`、`PC2-H-tool-routes.test.ts`。
- `tests/architecture/` — 依赖方向、生产代码可达性和状态写入边界（4 个），入口 `boundaries.test.ts`；`production-reach.ts` 是它自己的扫描器。
- `tests/business/` — 业务流程：Workflow、决定/审批、归档、交接（25 个），例如 `R5c-workflow.test.ts`、`WP1-continuation-handover.test.ts`。
- `tests/composition/` — `createTargetPlatform` 组合根和真实 Host 接线（45 个），例如 `AG1-session-discovery.test.ts`。
- `tests/context/` — 上下文装配，只有 `verification-workspace-reader.test.ts` 一个。
- `tests/contracts/` — 契约、提示词包/文本、平台能力和 Skill 声明（14 个），例如 `PC-prompt-set-v1.test.ts`。
- `tests/core/` — 只有 `work-graph/MVP-execution-list.test.ts`，核对与 `src/core` 对齐的清单。
- `tests/data/` — 记录存储、材料、工作区文件、git 操作和编码边界（52 个），例如 `R2e-git-operations.test.ts`。
- `tests/helpers/` — 共享测试夹具，共 129 个文件；本清单主体在下一节。
- `tests/kernel/` — 冻结 Kernel 公共入口的集成（23 个 `*.test.ts`），另有 `README.md` 记录 R4a 迁移。
- `tests/record-store/` — RecordStore 后端、查找、索引迁移和全文检索（13 个），例如 `SP-lookup-index-migration.test.ts`。
- `tests/runtime/` — 真实 Runtime/Kernel 执行链（139 个），是行为面最大的文件夹。
- `tests/scenarios/` — 跨片端到端场景：Host 重启、崩溃恢复、审批、白板（117 个，其中 S6A-secretary-flow-*、S6A-secretary-context-*、S6A-activity-*、S6A-main-read-joint 与 S6A-request-drop-settle 是秘书轮、查询活动和主读的整轮场景）。
- `tests/state/` — 状态机、编解码、查询和恢复不变量（51 个），例如 `K3-14-conclusion-pure.test.ts`。
- `tests/work-graph/` — WorkGraph 域服务和读模型（317 个），是夹具使用最密集的文件夹。

## tests/helpers/ 的夹具

### Host 和平台

起真实 `createLocalWorkbenchHost`/`createTargetPlatform`，只替换允许的启动配置、provider 或端口，用来测 Host 路由和平台装配。

- `AG2b-collaboration-fixture.ts` — 真实启动文件 + SQLite ledger/Kernel store + 受控 Kernel provider 起 Host，经公共 HTTP 路由建 Project/Workspace/Goal/Plan/Session 和 AG1 工作线；`tests/scenarios/S2C-K2-paused-transfer.test.ts` 在用。
- `C2-runtime-platform-fixture.ts` — 真实 TaskClaim + SQLite 配 `createTargetPlatform`，RoleSpec 经真实 writer 安装激活，两个 Session 走真实生命周期并 claim；`tests/state/invariants.test.ts` 在用。
- `K3-07-host-child.mjs` — 子进程用编译后的 `dist/` 起真实 Host，并在子进程内注入很小的 ModelClientPort；`tests/scenarios/K3-07-real-host-kill.test.ts` 在用。
- `K3-07-support.ts` — 父进程侧：写子进程读的启动 JSON、起/杀子进程并收结果；`tests/scenarios/K3-07-real-host-kill.test.ts` 在用。
- `K-legacy-reader-support.ts` — 同一 ledger 上只注册当前 workspace 的 Kernel store、不注册前任 adapter，给出「前任历史读被拒」的前置；`tests/scenarios/K-W-workflow-close.test.ts` 在用。
- `K-readonly-host-support.ts` — 生产 `createLocalWorkbenchHost` + 只读命令开关 + 显式 runtime binding，经公共 HTTP 路由种 AG2b 图，再由 `workflow/driver-start` 驱动只读 Work；`tests/runtime/K-readonly-command.test.ts` 在用。
- `K-t1-support.ts` — 公共流程搭平台状态，开带 `hostInstance: { lease: 'owned' }` 的真实组合根；`buildRun24KernelOpen` 造人暂停后关 Host 的 RUN-24；`tests/composition/K-R-close-open-turn.test.ts` 在用。
- `PC-platform-fixture.ts` — 冻结，只能在末尾追加导出；经公共步骤给 Work/Query/K3 review 世界，带可注入 prompt-pack 源、自定义 Skill 目录、失败 body store 和命令捕获；`tests/state/PC2-G-query-bind-order.test.ts` 在用。
- `PC2-host-fixture.ts` — 冻结，只能在末尾追加导出；真实 Host 和 HTTP handler，只换 socket 绑定，请求流交给真实 listener；`tests/app/PC2-H-tool-routes.test.ts` 在用。
- `PC2-pack-fixture.ts` — 冻结，只能在末尾追加导出；PC-2 pack 的输入与观察值（prompt 包/文本），期望留给测试行；`tests/app/PC2-H-tool-routes.test.ts` 在用。
- `RL-query-fixture.ts` — 真实 `createTargetPlatform` + trusted Query Host binding，一个已 claim 的 QueryRun 和真实 Session；`tests/state/PC2-G-query-bind-order.test.ts` 在用。
- `S2B-be1-platform-fixture.ts` — 真实 SQLite ledger + Kernel store，RoleSpec/协调策略经真实 owner，Session 带 `role_spec` pin，Run 由 `TaskClaimPort` claim，上接生产组合根；`tests/app/RL-34-wiring-resource-caps.test.ts` 在用。
- `S8D-platform-fixture.ts` — 真实临时根 + A-06 Host bindings，Project/Workspace/真实 catalog 走公共入口，`captureSourceChanges`/`listFiles` 观察工作区；`tests/composition/S8D-A11-python-failure.test.ts` 在用。
- `WP2-platform-support.ts` — 真实 SQLite 组合根，精确 pin 的 `role_spec` Session、平台 duty、脚本 Kernel 模型和已 claim 未 enter 的 Work Run；`tests/scenarios/WP2-wiring-scenario.test.ts` 在用。
- `host-page.ts` — 写 Host 测试用的最小 `index.html`（可带两个 asset），让静态壳替换 per-instance token；`tests/app/change-commit-observer.test.ts` 在用。
- `runtime-capabilities-fixture.ts` — SQLite Host，workspace 配好 Kernel store，最小 index 页带 token，走公共 capability 读；`tests/app/K-R-runtime-capabilities.test.ts` 在用。

### Session

Session 目录、生命周期、归档和交接；事实由正式 owner 写，历史从 Kernel 公共读入口取。

- `K-session-support.ts` — 只经 `SqliteStores.create/append/get/read` 建/读真实 Kernel Session，自留 reduced RunState 以发下一个合法事件；`tests/composition/K-R-close-open-turn.test.ts` 在用。
- `R4-history-turn-support.ts` — 在真实 claim 的 Session 里准备/启动/结束 Run，给 R4 历史与 turn 用例，不接受手写 record/event/cursor；`tests/runtime/R4b-session-input-boundaries.test.ts` 在用。
- `S1-archive-service-fixture.ts` — 共享 fx1：Project/Workspace/Goal/Plan/Session/Run 全走 owner，只有 Kernel observation 过 B2 边界；`tests/work-graph/R4c-execution-read.test.ts` 在用。
- `S1-public-anchor.ts` — slice-1 公共归档路径：真实 claim、execution-result 停止、`requestSessionArchive` 登记、`finishSessionArchive` 收线，并加 §2.6 workspace-capture；`tests/scenarios/K3-29-startup-reconcile-2b.test.ts` 经 K3-35 夹具在用。
- `S1-session-facts-fixture.ts` — fx2 的生产入口前置：公共 Session 创建/观察和 `observeStore`，不调用模型；`tests/work-graph/S1-session-facts.test.ts` 在用。
- `S1-workflow-archive-fixture.ts` — FX3 owner、注入时钟、逐次 commit 的不变量观察，claim/entry 沿用现有夹具，域写入走生产 writer；`tests/business/S1-archive-flow.test.ts` 在用。
- `WP1-handover-fixture.ts` — 五套交接世界（中断、Role 不匹配、别的责任、被占/被归档前任），每套经 claim/link/enter/terminal/requeue/archive 公共步骤；`tests/business/WP1-continuation-handover.test.ts` 在用。
- `WP1-units-fixture.ts` — DU09 duty-maintenance、GC03/GC04/AN08 的 assembler facts、WF01/WF02 的 start 拒绝工作流；`tests/composition/WP1-session-duty.test.ts` 在用。
- `graph-session-fixture.ts` — 真实 Project/Workspace/CompletionPolicy + 真实 Session 目录，link/archive/reactivate 全走正式服务；`tests/work-graph/A1-independent-review.test.ts` 在用。

### 计划和任务

Goal/Plan/claim/prepare/execute 的共同前置；claim 只由 `TaskClaimPort` 产生，Run 走生产 prepare 和 Runtime。

- `B2-execution-fixture.ts` — R4c.1 真实 claim + Goal/Plan/Session 服务 + Kernel store 映射，B2 execution-entry/model-request 端口叠在同一 Store，material 显式 unsupported；`tests/app/RL-34-wiring-resource-caps.test.ts` 在用。
- `B2-runtime-fixture.ts` — 真实 TaskClaim + WG11 执行读、WG12/RT7/RT8 历史读、WorkGraph entry/model-call 骨架和本地脚本模型，不伪造 claim/terminal/model call；`tests/state/invariants.test.ts` 在用。
- `S2A-planning-fixture.ts` — 经 Query owner 的 `submitQueryJob→claimQuery→bindPreparedQuery→beginQueryEntry→recordQueryObservation` 造 Goal D 的已答 `initial_coordination`；`tests/work-graph/S2A-queue-derived-cards.scale.test.ts` 在用。
- `S2B-be2-reconcile-support.ts` — 在 P7 store 上提供 RunControl/execution reader/`RunActivityPort`，给 2B-10…2B-14 的重放与 backfill；`tests/app/S2B-be2-run23-activity.test.ts` 在用。
- `S2B-runtime-steps-fixture.ts` — 把测试的 `TaskClaim` 经生产 prepare 和 `runtime.port.startRun` 进入，脚本模型停在 A3 gate 由调用方决定终态；`tests/app/S2B-r2-backfill-done-cursor.test.ts` 在用。
- `S2B-runtime-store-fixture.ts` — 在 `createB2RuntimeFixture` 上按调用方追加 schema（如 `CONTROL_RECORD_SCHEMAS`），保留 store 句柄和 SQLite reopen；`tests/app/S2B-be2-run23-activity.test.ts` 在用。
- `S2B-runtime-tools-support.ts` — 三个从既有测试原样搬来的工具：`blockingTool`、`restartedHost`、`controlledTool`；`tests/app/S2B-be2-run23-activity.test.ts` 在用。
- `S5-decision-fixture.ts` — 真实 Store 上建 P/W、Goal A/B/C、Plan 指针、Session 和 claim→enter Run 的完整 slice-5 世界；`tests/scenarios/K3-29-startup-reconcile-2b.test.ts` 在用。
- `S8A-L8-prepare.ts` — 经 `runtime.prepareExecution` + `materials.openArtifact` 的公开 `historical_explanation` 读拿到 prepared 和 manifest body；`tests/work-graph/S8A-L8-chunk-scope.test.ts` 在用。
- `WP1-entry-fixture.ts` — GE01–GE07 的 goal-content entry：真实 claim/prepare/assembler/graph，含 unbound、换 Plan、RUN-16 等分支；`tests/work-graph/WP1-goal-content-entry.test.ts` 在用。
- `ordered-lookup-forward.ts` — 给 Query 执行 owner 的 `records` 依赖转发真实 backend 的 `lookupOrdered`（请求轮的事实按有序查找读），其余成员在调用时转给原 port；`S1-session-facts-fixture.ts`、`S1-workflow-archive-fixture.ts`、`S2B-track-fixture.ts`、`S2C-L-runs-support.ts`、`WP2-notices-fixture.ts` 和 `tests/work-graph/PC-query-record-usage.test.ts`、`S3-graph-context.test.ts`、`S3-prepared-context-admission.test.ts` 在用。
- `task-claim-fixture.ts` — R4c.1：真实 Project/Workspace/governance + Goal/接受 Plan + 映射 Session，claim 只由 `TaskClaimPort` 产生；`tests/scenarios/A7-control.test.ts` 在用。

### 请求和秘书

决定队列、mailbox、notice、review card 和用户消息；所有消息经真实 mailbox/decision owner，队列只经公共读模型。

- `C1-mailbox-fixture.ts` — 一个真实 ledger 放 claim/Session/Role/mailbox，running/entered 由真实 Runtime start 产生；`tests/app/orchestration-mechanism.test.ts` 在用。
- `K3-review-card-fixture.ts` — 从冻结 S5 fixture 起，真实第二次 Plan revision + 五次 blocked-Run/`settleReview` 造 `needs_decision` 卡和读模型；`tests/scenarios/K3-29-startup-answers.test.ts` 在用。
- `S2A-notices-overbound-fixture.ts` — 公共 owner 建两 Session、Goal/Plan、两个已 enter Run、真实 mailbox 问答、健康 owner 标 unavailable，给 QA-10(二) 过载；`tests/work-graph/S2A-notices-overbound.test.ts` 在用。
- `S2A-notices-support.ts` — 真实 S5 decision 世界 + 真实 notice owner 的通用支持；`tests/work-graph/S2A-notices-rework.test.ts` 在用。
- `S2A-notices-workspace2-fixture.ts` — 第二 workspace 的 W2 调用上下文和 Session/claim/entry/end，Goal/Plan/requeue 复用 `openManyTaskWorld`；`tests/work-graph/S2A-notices-workspace.test.ts` 在用。
- `S2A-queue-fixture.ts` — 在冻结 S5 fixture 上经 mailbox、`sendUserMessage`、`answerDecision`、Goal 服务造队列世界，只经 `queryDecisionQueue`/`readDecisionCard` 读；`tests/app/S2A-decision-routes.test.ts` 在用。
- `S5-application-support.ts` — 真实 owner 集合、持久化观察和两 writer commit barrier，给 AP/RC 行；`tests/app/S2A-decision-routes.test.ts` 在用。
- `S5-queue-support.ts` — 同一 P/W records port 上的命令和队列 setup；`tests/work-graph/S2A-notices-rework.test.ts` 在用。
- `S5-user-message-support.ts` — UM/TU 装配：真实 owner、一个 Store、可观察的分配；`tests/app/S5R2-driver-safe-point.test.ts` 在用。
- `S5R2-a-support.ts` — round-2 A：生产历史与不设 cap 的 Store 观察；`tests/work-graph/S2A-queue-bounds.test.ts` 在用。
- `S5R2-b-support.ts` — round-2 B：真实 S5 owner，不跑 Runtime/模型/check；`tests/business/S5R2-automation-cards.test.ts` 在用。
- `S5R2-c-support.ts` — round-2 C：共享 S5 fixture 上的 driver（R2C01–R2C08）；`tests/business/S5R2-settings-replay.test.ts` 在用。
- `S5R2-d-support.ts` — round-2 D：共享 S5 fixture 上的 driver 排序（R2D）；`tests/app/S5R2-driver-safe-point.test.ts` 在用。
- `S6A-request-fixture.ts` — 冻结，只能在末尾追加导出；真实 Host + memory/SQLite 的请求世界（三种 runtime binding、query profile、Workflow binding、脚本模型、Kernel store）；`tests/scenarios/S6A-request-concurrency.test.ts` 在用。
- `S6A-host-fixture.ts` — 冻结；6A-2 的 SE2 世界，在 `openS6ARequestWorld` 上加：按 Session 排队的脚本回复（没排的走世界模型）、按提交身份和 Session 的提交闸门（claim、prepared、start、drop 之前）、Kernel 入口 / 模型请求 / 工具调用闸门（闸门只对设门时那个 Host 生效）、SQLite 上的崩溃和重启（只在旧 Host 的推进都停住时用）、`resumeOnStartup` 开关、设置和提示词包路由；`ensureProjectPointers` 补齐架构和完成策略指针；测试文件要自己装 `S6A-commit-barrier.ts` 的两个 `vi.mock`。
- `S6A-history-fixture.ts` — 冻结；只用公开步骤造一条请求的历史：跨 A、B 两个 Session、十轮边界、带选中思路的吸收、drop 结束的轮、长 UTF-8 回答、A 上结果未知的轮、后来的回答；多数构造要等 6A-2 的轮次自己跑起来才能用。
- `S6A-memory-fixture.ts` — 冻结；`seedS6AMemory` 经公开路由写项目理解、规范、注记和两个目标的理解，并给出治理操作（架构采纳和修订、完成策略安装、激活和换版）；`S6A_GOVERNANCE_CASES` 是 R-14 的四种指针组合。
- `S6A-prompt-samples.ts` — 冻结；按模板、字符串表和 6A-2 裁定 S15 手写的秘书输入期望文本：各段的构造函数和整段的 `secretaryInputText`。
- `S6A-cards-fixture.ts` — 冻结；6A-3 主对话的世界，两个：`openS6ACardsWorld`（SE1，请求世界加第二个工作区及其秘书绑定和 profile，Host 输入，规则 A8）和 `openS6ANoticesWorld`（SE2，两个目标各有采用的 Plan、一个 Work Session）；步骤：`s6aCardsWorkspace`（路由句柄）、`seedS6ASharedCards`（两请求各一候选、另一目标上的独立候选，卡的 `source.pins` 就是 `ask` 的 `cardRefs`）、`seedS6AGoalOrder`（已知顺序的目标和无目标请求，`goals/create` 返回创建游标）、`submitMany`、`seedReworkNotices`（真实 Workflow 的自动返工通知，位置 1、3 在目标 1、2 在目标 2）、`moveGoal`（只推进 revision）；不写记录、不读 store。
- `S8A-L8-reminder-world.ts` — L8 rework-2 两个公开测试的共享世界：Project/Workspace/policy/catalog/Goal/Plan/Session/claim/source capture 全由平台产生，再走 H4 prepare；`tests/work-graph/S8A-L8-reminders-public.test.ts` 在用。
- `WP2-duties-fixture.ts` — `WP2_DUTIES` 五个平台 duty、legacy template 精确匹配的 `wp2LegacyDuty` 和 `wp2RoleContent`；`tests/work-graph/WP2-message-duties.test.ts` 在用。
- `WP2-notices-fixture.ts` — 真实 S1 owner/backend，构造钩子只加 schema 和 beforeWrite 故障点，不种历史或 cursor；`tests/work-graph/WP2-undelivered-notices.test.ts` 在用。
- `request-claim-steps.ts` — 不冻结；请求轮测试的 claim 步骤：Host 发布的 query profile 换成 claim 收的形状（`claimProfile`），按刚读到的 Job、Run、Session 版本走 `queries/claim`（`claimQuery`，带或不带 profile；`claimWithSecretaryProfile` 带秘书 profile）；`tests/work-graph/S6A-request-start.test.ts`、`S6A-request-claim.test.ts`、`S6A-request-attempt-restart.test.ts` 在用。

### 工作线

工作线读取、track、timeline、node detail、规模、白板和跨片场景的前置；每条线都由真实 Session/claim/entry 撑起来。

- `S2B-r2-timeline-public-flows.ts` — 在 timeline fixture 上经真实 claim/control/entry 产生记录，补 claim 未 enter、pre-entry control 等公开流程；`tests/work-graph/S2B-r2-s-preentry-control.test.ts` 在用。
- `S2B-r2-track-support.ts` — 经公开 fixture 流为每条 track 任务造真实 Run，用低 `readRecordCap` 区分分页读和全窗扫；`tests/work-graph/S2B-r3-consultation-cap.test.ts` 在用。
- `S2B-task-timeline-fixture.ts` — 真实 Store + 公共 Plan/claim/entry，注册 evidence/control/anomaly/lifecycle/catalog/completion schema，给 task timeline；`tests/app/S2B-35-activity-routes.test.ts` 在用。
- `S2B-track-fixture.ts` — 真实 Store + 公共 Plan/claim/entry，只注册 track 读需要的 schema，用可拨时钟造 Run；`tests/app/S2B-35-activity-routes.test.ts` 在用。
- `S2C-D-node-support.ts` — 完整 schema 的真实后端，可信 scope/Goal/Plan/catalog/Session/responsibility links 走 owner，给 node-detail/hover；`tests/work-graph/S2C-node-detail-task.test.ts` 在用。
- `S2C-K-scenario-support.ts` — K1 的 LE4 Host 场景读写层，基于 `openHostScenario`/`restart()`/`direct()` 的真实路由；`tests/scenarios/S2C-K2-paused-transfer.test.ts` 在用。
- `S2C-K2-scenario-support.ts` — K2 在 K1 之上的 Host 场景 helper 和暂停用 `PAUSE_ON_SECOND_REPLY`；`tests/scenarios/S2C-K2-paused-transfer.test.ts` 在用。
- `S2C-L-check-support.ts` — 与 line fixture 同 Store 的真实 Evidence/completion：policy、可检查 Goal/Plan、workspace、check 流程；`tests/app/S2C-line-routes.test.ts` 经 `S2C-L-line-support.ts` 在用。
- `S2C-L-line-support.ts` — 真实 Memory/SQLite + Session 目录/lifecycle/responsibility/archive/claim 造工作线读模型前置；`tests/app/S2C-line-routes.test.ts` 在用。
- `S2C-L-runs-support.ts` — 真实 `ExecutionEntryPort`/`RunControlPort`/`RunReconcilePort` 造 starting/running/ended、安全点暂停和 retire；`tests/work-graph/S2C-lines-tiers.test.ts` 在用。
- `S2C-P-pins-fixture.ts` — R4c.1 store 上注册 `WorkspaceLinePinsChanged@1`，经公共 Session/pin/notice owner 造 pin 世界；`tests/app/S2C-line-routes.test.ts` 在用。
- `S2C-X-scale-fixture.ts` — 2C-25 规模：5,000 Session + 1,100 active line head 等，除 A2 的 Run seed 外全走公共 owner；`tests/work-graph/S2C-lines-scale.scale.test.ts` 在用。
- `W2-whiteboard-fixture.ts` — 真实 B2 执行世界 + W2 read/admission 端口，Agent Run/claim/Session/Lease 全由正式服务产生；`tests/work-graph/A2-disposition-change.test.ts` 在用。
- `WP1-scenario-fixture.ts` — SQLite 真实组合的 SC01 暂停中断和 SC02 归档线场景，返回人继续/下一 Session 之前的状态；`tests/scenarios/WP1-wiring.test.ts` 在用。
- `observation-source-fixture.ts` — 真实临时根 + `createWorkspaceAccessFactory`/`captureObservationSource`，保留真实 git 命令和 Host bindings；`tests/data/S8E-A26-git-classification.test.ts` 在用。

### 活动

Run 活动、track/timeline 背后的活动记录、回填和复核轮；写入走 `RunActivity`/evidence 的公共 owner。

- `S2B-activity-fixture.ts` — 真实 Store + claim/entry + 可拨平台时钟，`RunActivity` 只经公共服务写，配 evidence schema；`tests/app/S2B-r2-backfill-identity.test.ts` 在用。
- `S2B-r2-activity-support.ts` — R4/R5/R7/R8 修补：`seedActivityRun`/`authorizeOnlyRun` 造 V2 授权、只有 position 没 activity、authorized 未 enter 的 Run，其余走公共读/服务；`tests/work-graph/S2B-r2-workspace-binding.test.ts` 在用。
- `S2B-r2-backfill-kernel-support.ts` — 真实 SQLite Runtime + Kernel 历史 Run，回填只经 `createRunActivityService`/`createActivityBackfill` 写；`tests/app/S2B-r2-backfill-real-kernel.test.ts` 在用。
- `S2B-r2-calendar-reverify-support.ts` — 在 activity store 上建真实 `createEvidenceService`，走开轮/记结果/finalize FAIL/`reverifyRound`；`tests/work-graph/S2B-r2-calendar-same-task.test.ts` 在用。

### Kernel 和模型脚本

Kernel 公共入口 harness、blocked/CRR/review 世界、受控命令替身和资源上限脚本；模型一律是脚本 provider，不联网。

- `B2-401-world.ts` — 每文件一份 401-Run 世界：首个 blocked record 来自真实 seed/RUN-20/RUN-22 和 `skip_as_done`，后续 Run 由 requeue/claim/prepare/`startRun` 真实续跑；`tests/runtime/B2-401-world.scale.test.ts` 在用。
- `B2-blocked-runtime.ts` — 在 K3 blocked 世界上建 CRR owner/read port、真实 recognizer 和 `before_tool` shell hook；`tests/runtime/B2-02-recognition-unified.test.ts` 在用。
- `B2-crr-world.ts` — 真实 RUN-20/RUN-22 blocked record、UCR `skip_as_done`、真实 CRR owner，Run 由 `openRealRunHarness` claim/prepare/start；`tests/scenarios/K3-29-startup-reconcile-2b.test.ts` 在用。
- `K-boundary-facts-support.ts` — 在已开 Turn 上经 `SqliteStores.append` 追加真实 Kernel fact，模拟平台 locator 落后；只在 Kernel 存储边界用；`tests/scenarios/K-R-attested-facts-source.test.ts` 在用。
- `K-readonly-work-support.ts` — 复用真实 claim/entry/Runtime，改可信配置造空写 scope、只有 Host 上限的只读 Work；`tests/runtime/K-readonly-command.test.ts` 在用。
- `K3-35-continuation-fixture.ts` — K3-35 一条真实事实：批准记录、八个 anomaly anchor、continuation basis、九个 Run 全走 claim/prepare/`startRun`；`tests/scenarios/K3-29-startup-reconcile-2b.test.ts` 在用。
- `K3-35-prepare.ts` — 对上述事实跑生产 `createExecutionPreparation`（含 `plan-readers.readTaskClosure`）；`tests/runtime/K3-35-approved-methods-brief.test.ts` 在用。
- `K3-35-runtime.ts` — 同一 K3-35 链上的生产 Runtime：claim 后 authorize/begin/`recordExecutionEntered`，用真实 Turn facts；`tests/runtime/K3-19-review-admission.test.ts` 在用。
- `K3-blocked-command-fixture.ts` — 一个真实 blocked-command 世界：§5.1 shell stand-in、Host classifier、review-draft reader、RUN-22 和 `settle_review{review_unavailable}`；`tests/work-graph/B2-01-blocked-commands.test.ts` 在用。
- `K3-crr-fixture.ts` — 复用 blocked 世界，在同一 store 建 CRR owner（含 schema），workspace 文件读是唯一输入 seam；`tests/runtime/K3-review-preparation.test.ts` 在用。
- `K3-prefix-claim.ts` — 同一 Task 上两个真实 blocked record，Run id 由注入生成器给相同 8 字符前缀，验 `rewriteOf` 前缀行；`tests/runtime/B2-02-recognition-unified.test.ts` 在用。
- `K3-proposal-round.ts` — 经公共生产步骤（memory 和 sqlite）到 `awaiting_proposal`/`awaiting_approval`，record/item 都不是输入；`tests/scenarios/K3-29-startup-reconcile-2b.test.ts` 在用。
- `K3-real-workspace.ts` — 真实临时目录上的工作区：生产 access factory/tools 服务 `readWorkspace`，Host 输入根、ref、授权；`tests/runtime/B2-02-recognition-unified.test.ts` 在用。
- `PC-kernel-fixture.ts` — 冻结，只能在末尾追加导出；脚本 provider、公共入口 Kernel harness、可手算 preview、RuntimeRunner harness、adapter 捕获和 selectContext 输入；`tests/kernel/PC-12-tool-result-placeholder.test.ts` 在用。
- `RL-bwrap-child.mjs` — 子 Node Host：预热 fake bwrap 探针、切 gate-reset/exit-after-r、跑一次带 cap 命令并打一行 JSON；`tests/kernel/RL-15c-gate-stream-error.test.ts` 在用。
- `RL-child-node.mjs` — 子 Node Host：自己进程内预热 cap 探针，等 stdin 后跑一条 capped 命令，供 SIGSTOP/SIGKILL 行；`tests/kernel/RL-06-11-stop.test.ts` 在用。
- `RL-fake-bwrap.sh` — 文件驱动的假 `bwrap`（forward/gate-reset/exit-after-r），只经 `CODING_AGENT_BWRAP_PATH` 选中；`tests/kernel/RL-15c-gate-stream-error.test.ts` 在用。
- `RL-fake-systemctl.sh` — 文件驱动的假 `systemctl`（fail/ok/hang），记录每次 argv，只经 `CODING_AGENT_SYSTEMCTL_PATH` 选中；`tests/kernel/RL-06-11-stop.test.ts` 在用。
- `RL-fake-systemd-run.sh` — 文件驱动的假 `systemd-run`（forward/fail-bus/no-scope/sleep 等），记录 argv，经 `CODING_AGENT_SYSTEMD_RUN_PATH` 选中；`tests/kernel/RL-15c-gate-stream-error.test.ts` 在用（经 `RL-resource-caps-support.ts` 安装）。
- `RL-fork.py` — 不断 fork 到 EAGAIN、留子进程睡眠再清理并打印成功数，给 RL-04；`tests/kernel/RL-03-05-oom-pids.test.ts` 在用。
- `RL-kernel-sandbox-double.ts` — `vi.mock` 用的 Kernel `ProcessSandbox` 进程级可拨 double：probe/构造/execute 记录，按模式返回或挂起；`tests/app/RL-33-workbench-resource-caps.test.ts` 在用。
- `RL-memory.py` — 按页写 1 GiB bytearray 并保持，让 OOM killer 杀进程，给 RL-03；`tests/kernel/RL-03-05-oom-pids.test.ts` 在用。
- `RL-re2-support.ts` — 只经公开 `readSessionHistory` 读 Kernel 持久化的 tool result，另有 `cancelRLRun` 和 cap 报告字面量；`tests/runtime/RL-31-readonly-resource-caps.test.ts` 在用。
- `RL-resource-caps-support.ts` — RE1 共享：临时 workspace、带 `ResourceCapSource` 的 `ProcessSandbox`、identity/release marker、fake systemd-run/bwrap 安装器和 scope 查询；`tests/scenarios/K3-07-real-host-kill.test.ts` 在用。
- `RL-thread.py` — 小栈线程压到创建失败并打印数量和峰值 RSS，给 RL-05；`tests/kernel/RL-03-05-oom-pids.test.ts` 在用。
- `S2B-kernel-records-fixture.ts` — BE0 的合成 Kernel Turn：每条事件经真实 `agentEventSchema`/`sessionRecordSchema` 校验并用 `reduceRunState` 回放；`tests/runtime/S2B-tally.test.ts` 在用。
- `orchestration-fixture.ts` — 真实 Kernel `RuntimeRunner` harness（脚本模型 + 受控 tool executor + sink）和纯 attention stamps；`tests/scenarios/S3-query-graph.test.ts` 在用。

### 并发门闩和故障注入

commit 闸门、阻塞替身、store/Kernel 读故障和崩溃重启；只在规则表允许的边界注入，不手写平台事实。

- `A2-restart-fixture.ts` — 两个真实 Host 共享一个 SQLite ledger/Kernel store；`closed` 正常 drain 后写 stale lock，`abandoned` 留一个 blocked 请求并改 lock 模拟崩溃；`tests/scenarios/S2C-K2-paused-transfer.test.ts` 在用。
- `B2-09b-crash.ts` — 经 composition 发布的 owner read port 读真实 `CommandRerunRequest`，Task closure 用生产 `plan-readers.readTaskClosure`；`tests/scenarios/B2-09b-allowance-crash.test.ts` 在用。
- `K3-mailbox-seam.ts` — 可开关地阻塞 `send_session_message` handler，制造 Kernel 已 started、消息未提交的 K3-02 崩溃点；`tests/scenarios/K3-R1-restart-flows.test.ts` 在用。
- `K3-mixed-seams.ts` — 保持真实 `edit` 名字/effectClass/能力，只在 handler 内阻塞，制造串行批次 running 点；`tests/scenarios/K3-06-mixed-batch.test.ts` 在用。
- `K3-tool-seams.ts` — §5.1 可开关替身：`shell` 保持名字/`process` 但去掉 `isolated_process` 并阻塞，`mailboxToolSeam` 同理；`tests/scenarios/K3-11-review-reasons-r2.test.ts` 在用。
- `S1-runtime-scenario-fixture.ts` — 只给场景注入时钟、commit 观察和丢失的 transport 回复；`tests/scenarios/S1-archive-restart.test.ts` 在用。
- `S2A-route-storage-support.ts` — 包住真实 records port，让 `readMany`/`lookup` 一律返回 `unavailable`，验路由如实带出读失败；`tests/app/S2A-decision-routes.test.ts` 在用。
- `S2A-window-fixture.ts` — 在命名窗口第一次数据读后精确 commit 一次，验稳定窗口；`tests/work-graph/S2A-queue-window.test.ts` 在用。
- `S2B-be1r-kernel-faults-support.ts` — 包真实 Kernel registry，在 `store.read` 注入故障，不写记录不造 fact；`tests/runtime/S2B-38-run08-unknown-activity.test.ts` 在用。
- `S2B-be1r2-support.ts` — `withProbeMissing` 让 `store.get` 抛 not_found，`createPausingRecords` 在 records 边界暂停/放行；`tests/app/S2B-r2-backfill-probe-first.test.ts` 在用。
- `S2B-counting-off-support.ts` — `vi.mock` 计数/活动读，让 `tallyTurnActivity` 返回 undefined、`readRunActivityFacts` 返回 retry_later，其他导出保持真实；`tests/app/S2B-r2-backfill-real-kernel.test.ts` 在用。
- `S4A-note-fault-fixture.ts` — 完整真实 4A scope 世界上只包 records 的 lookup/readMany 和两个 scope-fact 端口，注入 `unavailable`；`tests/work-graph/S4C2-m12h-store-fault.test.ts` 在用。
- `S4A-note-interleave-fixture.ts` — 唯一允许的 commit gate double：只拦含 `NoteWritten` 的 `PreparedCommit`；`tests/work-graph/S4A-note-concurrency.test.ts` 在用。
- `S6A-commit-barrier.ts` — 冻结，只能在末尾追加导出；mock 两个真实 backend factory，只包 `records.commit` 成提交闸门，其余导出保持真实；闸门只停在提交前（owner 读之后、store CAS 之前），没有提交之后的公开闸门，别在测试里另造；`tests/scenarios/S6A-request-concurrency.test.ts` 在用。
- `S6A-registration-double.ts` — 冻结，只能在末尾追加导出；mock `session-directory.ts`，只包 `recordSessionCreated`，可 `failNext(n)` 或计数；`tests/scenarios/S6A-request-concurrency.test.ts` 在用。
- `S6A-activity-boundary.ts` — 冻结；R-15、R-16 允许的两个 store 边界替身，装在冻结的提交闸门外面（测试文件装这里的两个 `vi.mock`，不再装 `S6A-commit-barrier.ts` 的）：`rejectQueryEnd` 让结束目标 Query 的那次提交在存储层失败一次（memory 写前抛出，SQLite 事务内回滚）；`dropQueryActivity` 只去掉那次提交里完整身份对上的 `QueryActivity` 记录及其游标绑定，别的记录、守卫和事件不动；`setQuerySince` 改写工作区 `ActivityRecording` 的 `querySince` 及事件里同 ref 同 revision 的快照；`afterEach` 里先 `activityBoundary.reset()` 再 `commitBarrier.reset()`。

### 注记和证据

笔记、memory、全文索引和证据链；写入经 `platform.notes`/evidence owner，读故障也只在允许的端口上包。

- `R3e-evidence-fixture.ts` — 在真实 B2 执行世界上经公共操作装 R3e bootstrap/evidence schema、真实 Project bootstrap 和独立 static CompletionPolicy，再测证据；`tests/app/RL-34-wiring-resource-caps.test.ts` 在用。
- `S4A-note-fixture.ts` — 真实 `createTargetPlatform`（memory/SQLite）+ 临时 workspace、catalog、Goal/Plan、Run，给注记 W1 行；`tests/app/S4C2-scribe-reminders.test.ts` 在用。
- `S4A-note-scope-fixture.ts` — 4A group G：真实平台 + 显式 `containment.parentOf` catalog 和多 scope，给 N-20/21/22 与按 scope 计数；`tests/work-graph/S4A-note-failures.test.ts` 在用。
- `S4B-memory-fixture.ts` — 包装 S4B check fixture，另造第二个 Goal/Plan/Session/Run，全走公共平台服务；`tests/work-graph/S4B-memory-current-filter.test.ts` 在用。
- `S4B-note-check-fixture.ts` — 完整真实 4A 平台 + 组合根建出的 `platform.notes` holder（notes/check/memory/version lists），只加读故障 spy；`tests/work-graph/S4B-memory-current-filter.test.ts` 在用。
- `S4B-note-multi-scope-fixture.ts` — 在同一项目加第二 Goal，并加第二 Project/Workspace + 自己的 catalog/Goal/Plan；`tests/work-graph/SP-memory-check-scoped.test.ts` 在用。
- `S4B-text-search-support.ts` — 打开真实 memory/SQLite store 并注册 `s4b-text` 测试全文索引，写入走 `commit`、读走 `searchText`；`tests/record-store/S2C-count-lookup.test.ts` 在用。
- `S4C-node-notes-fixture.ts` — 在真实 4A 平台上为 Task 加一个真实 archived Run 的 anomaly anchor，给 node-detail notes 列；`tests/work-graph/S4C-node-notes.test.ts` 在用。
- `S4C2-note-card-fixture.ts` — N 行验收：真实 4A scope 平台（g1/g2、scribe/executor Run），草稿/review/withdraw 全走 `platform.notes`，id 用注入计数器；`tests/scenarios/S4C2-U6-note-card-e2e.test.ts` 在用。

### 纯规则和其他

不碰 Store/Host 的纯输入、流读取和工具层夹层；可以直接被 `*-pure.test.ts` 引用。

- `B2-12-recognition-fixture.ts` — 纯识别构造器：`record()`/`request()`、`sha`/`keyOf` 和 host `ctx`，只依赖 `node:crypto` 和契约类型；`tests/work-graph/B2-12-recognition.test.ts` 在用。
- `K3-continuation-pure-fixture.ts` — 纯 continuation brief：构造输入、`assembleContinuationBrief` 结果和固定字面量，不 import store/Host/Runtime；`tests/runtime/PC2-T-render.test.ts` 在用。
- `K3-padded-review-record.ts` — 纯输入：32 个 codec 合法 process item、200×512 字节 changed-path 和 32 项 notVisible，把记录顶到 B=158,720 字节；`tests/runtime/K3-48-3-extremes-pure.test.ts` 在用。
- `SP-record-store-support.ts` — SP store 契约共用：schema 构造与 `commit` 写入，期望值留在测试；`tests/record-store/SP-literal-type.test.ts` 在用。
- `change-stream-reader.ts` — 逐帧读真实 `text/event-stream` 响应体，心跳注释返回 `{ comment: true }`；`tests/app/change-commit-observer.test.ts` 在用。
- `field-table-fixture.ts` — 测试本地的字段表格式（`Parcel` 记录和 `ParcelMoved` 事件，没有生产聚合）注册到两个真实 RecordStore 后端，经公共 `commit` 写、`readMany`/`lookupOrdered` 读回；`tests/work-graph/field-table-codec.test.ts` 在用。
- `workspace-tools-fixture.ts` — 真实临时根上的 `createWorkspaceTools` + permission-filtered sandbox，三个调用方共用，暴露各 wrapper；`tests/data/S8D-language-providers.test.ts` 在用。
- `write-command-fixture.ts` — 写入执行器的测试本地格式和命令（`Exchange@1` 记录、`ExchangeCommitted` 事件），先前记录都经 `executeWriteCommand` 写入；`script` 在 `lookupCommit`/`commit`/`eventAt` 计数或注入一次失败后原样委托；`tests/work-graph/command-executor.test.ts` 在用。
