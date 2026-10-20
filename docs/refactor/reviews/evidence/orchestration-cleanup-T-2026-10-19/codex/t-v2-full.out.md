**本次仍未完成全量枚举，不能作为 wave 2 的冻结清单。** 未完成的是 A1 全部调用的数据来源与后续路径追踪，以及 F3 全部间接调用、Kernel append 和 body-store 写入的边界核对；冻结前须补完，依据 `.lead-ref/books/test-rule-sheet-v2.md:19`。

以下只确认、补充首轮结果，不把检索命中直接当成违规。统计按列出的静态位置计数；同一行的后端参数化不重复计数。JSON 的 `line` 数组逐项计数。第一节的“允许”只判该笔输入，不连带放行其他造状态、替身或仓库断言；依据 `.lead-ref/books/test-rule-sheet-v2.md:30`。

1．A1 公开输入

| owner | 调用位置 | 值来源、平台签发字段及后续路径 | 判定 |
|---|---|---|---|
| `plans.proposePlan` | `tests/helpers/task-claim-fixture.ts:343` | 手写计划；无 token、receipt、prepared；随后公开 apply 在同文件 `:349`。沿用首轮 `.lead-ref/t-v2-list.out.md:11`。 | v2 允许 |
| `plans.proposePlan` | `tests/business/K3-46-review-advance-failures.test.ts:143` | 从公开任务图读取后重排；来源同文件 `:128`、`:133`；随后公开 apply `:149`。沿用首轮 `:12`。 | v2 允许 |
| `plans.proposePlan` | `tests/helpers/S5R2-a-support.ts:82` | 从仓库记录投影成计划正文；来源同文件 `:68`；不重建签发凭据。后续仍读仓库，同文件 `:97`、`:105`。沿用首轮 `:13`。 | v2 允许 |
| `propose_future_plan` | `tests/runtime/S5R2-agent-application.test.ts:143` | 手写工具参数，计划正文来自夹具计划；无 receipt；随后公开读取同文件 `:155`。沿用首轮 `:14`。 | v2 允许 |
| `plans.proposePlan` | `tests/helpers/S4A-note-fixture.ts:222` | 手写计划定义；无签发字段；随后公开 apply，同文件 `:225`。完整调用者后续未追完。 | v2 允许 |
| `plans.proposePlan` | `tests/helpers/S4A-note-scope-fixture.ts:212`、`:234` | 手写两个计划定义；无签发字段；公开 apply 分别在同文件 `:215`、`:237`。完整调用者后续未追完。 | v2 允许 |
| `decisionMessages.sendUserMessage` | `tests/helpers/S5-user-message-support.ts:95` | 正文手写，选项和对象从已有消息取出，同文件 `:82`；没有把消息记录整体交回 owner。调用后检查公开返回值，同文件 `:99`；上游夹具另论。 | v2 允许 |
| `decisionMessages.sendUserMessage` | `tests/work-graph/S5-user-messages.test.ts:37` | 手写正文、intent、选项组合，同文件 `:30`；不带签发凭据。后续并非全公开，内部事件断言在同文件 `:67`。 | v2 允许 |
| `decisionMessages.recordDecisionApplication` | `tests/work-graph/S5-decision-application.test.ts:53` | 从截获 commit 拼 receipt，同文件 `:34`、`:39`；后续内部 receipt/event 读取在 `:89`、`:92`。沿用首轮 `:24`。 | **F1：A1 平台签发字段** |
| `decisionMessages.recordDecisionApplication` | `tests/work-graph/S2A-queue-card-semantics.test.ts:78` | 从截获提交重建 receipt，同文件 `:60`、`:63`；随后继续查队列 `:83`。沿用首轮 `:25`。 | **F1：A1 平台签发字段** |
| `decisionMessages.recordDecisionApplication` | `tests/scenarios/support/S5-decisions.ts:434` | receipt 来自内部 ledger；来源 `tests/scenarios/S5-two-request-decisions.test.ts:141`，调用 `:163`，后续读卡 `:169`。沿用首轮 `:26`。 | **F1：A1 平台签发字段** |
| `record_decision_application` 工具 | `tests/runtime/S5R2-agent-application.test.ts:241`、`:282` | 内部事件读取在同文件 `:187`；用事件的 identityKey、fingerprint 与 cursor **重新构造** receipt 在 `:224`，返回给调用者在 `:229`。随后检查应用及重放，` :248`、`:288`。即使与工具返回值相等，也不是原样使用返回值。 | **F1：A1 平台签发字段** |
| `decisionMessages.recordDecisionApplication` | `tests/runtime/S5R2-agent-application.test.ts:374` | 同一重建 receipt 经同文件 `:373` 交入；随后继续 tool-commit lookup，`:378`。 | **F1：A1 平台签发字段** |
| `notes.writeNote` | `tests/helpers/S4A-note-fixture.ts:282` | 包装调用者注记正文、commandId、版本前置条件；没有替造写结果。沿用首轮 `.lead-ref/t-v2-list.out.md:20`。 | v2 允许 |
| `notes.writeNote` | `tests/helpers/S4A-note-scope-fixture.ts:329` | 调用者正文加手写 commandId，同文件 `:328`；没有 receipt、token、prepared。helper 原样返回 owner 结果；完整调用者后续未追完。 | v2 允许 |
| `notes.reviewNote` | `tests/helpers/S4A-note-scope-fixture.ts:325` | noteId、verdict、版本条件由调用者提供；同文件 `:324`；这是审阅请求，不是构造审阅结果。helper 原样返回；完整调用者后续未追完。 | v2 允许 |
| `notes.reviewNote` | `tests/helpers/S4C2-note-card-fixture.ts:299` | 手写审阅请求及调用者 options，同文件 `:298`；没有签发字段；helper 原样返回，完整调用者后续未追完。 | v2 允许 |
| `notes.withdrawNote` | `tests/helpers/S4C2-note-card-fixture.ts:308`、`:314` | 手写撤回请求及版本条件；没有 receipt、token、prepared；helper 原样返回，完整调用者后续未追完。 | v2 允许 |
| `goalSettings.setGoalSettings` | `tests/work-graph/S5-goal-settings.test.ts:398`、`:410`、`:416`、`:423`、`:501`、`:525`、`:544`、`:577`、`:599`、`:619`、`:637`、`:652`、`:654`、`:669` | 手写自治、等待目标及版本前置条件；不携带签发凭据。输入允许；后续并非全公开，例如仓库快照和事件断言在同文件 `:404`、`:419`、`:643`、`:644`。`:398` 沿用首轮 `:21`。 | v2 允许 |
| `goalSettings.reorderGoals` | `tests/work-graph/S5-goal-settings.test.ts:434`、`:456`、`:624`、`:638` | 手写目标顺序及版本条件；没有签发字段；后续包含内部状态、事件读取，同文件 `:437`、`:461`、`:643`、`:646`。 | v2 允许 |
| `goalSettings.setGoalSettings` | `tests/helpers/S5R2-b-support.ts:153` | 手写自治选项；revision 来自内部 `goalAt`，同文件 `:152`；不重建 receipt/token。不是全公开链。 | v2 允许 |
| `goalSettings.reorderGoals` | `tests/helpers/S5R2-d-support.ts:63` | 手写顺序与版本条件，同文件 `:64`、`:65`；随后公开 settings 读取 `:72`；后续 Workflow 替身另论，同文件 `:74`。 | v2 允许 |
| `claims.requeueTask` | `tests/helpers/S5-queue-support.ts:366` | 手写 requeue 请求；无签发字段。前置手造结束事件及摘要替身在同文件 `:365`、`:360`，不能一起放行。沿用首轮 `:22`。 | v2 允许 |
| `claims.requeueTask` | `tests/helpers/K3-prefix-claim.ts:111` | reason 手写；Run/Goal 版本来自公开读，同文件 `:106`、`:108`。请求无签发字段；摘要依赖返回手写值，同文件 `:99`，所以整链不能放行。 | v2 允许 |
| `claims.requeueTask` | `tests/helpers/K3-crr-fixture.ts:167` | 请求由公开 Goal/Run 读组装，同文件 `:163`、`:165`；没有签发字段。摘要替身在同文件 `:157`；之后继续创建和读取 Session，`:177`、`:178`。 | v2 允许 |
| `claims.requeueTask` | `tests/helpers/K3-35-continuation-fixture.ts:708` | 手写 reason/note，Run 版本来自公开读，同文件 `:706`；摘要来自真实 reader，`:412`、`:414`。helper 返回公开结果 `:714`；调用者全链未追完。 | v2 允许 |
| `workspaceDecisionSettings.markNoticesSeen` | `tests/composition/WP2-wiring.test.ts:146`、`:851` | token、seenThrough 原样来自公开页面，同文件 `:142`、`:844`；Workspace pin 来自公开读 `:144`、`:849`。之后公开重读 `:856`；文件其他内部观测不因此豁免。 | v2 允许 |
| `workspaceDecisionSettings.markNoticesSeen` | `tests/helpers/S4C2-note-card-fixture.ts:389` | token、seenThrough 来自公开队列页面，同文件 `:377`；Workspace pin 来自公开读 `:387`；helper 内仅公开步骤。 | v2 允许 |
| `workspaceDecisionSettings.markNoticesSeen` | `tests/helpers/WP2-notices-fixture.ts:122` | token、seenThrough 原样来自公开页面，同文件 `:117`；Workspace pin 仍经内部 `f.pin`，`:124`，整链不是全公开。 | v2 允许 |
| `workspaceDecisionSettings.markNoticesSeen` | `tests/helpers/S2A-notices-support.ts:88` | token、seenThrough 来自公开队列，同文件 `:83`；调用实例见 `tests/work-graph/S2A-notices-counts.test.ts:109`、`:112`。内部 pin 读取在 helper `:89`。 | v2 允许 |
| `workspaceDecisionSettings.markNoticesSeen` | `tests/work-graph/S5-notices.test.ts:66` | 接受路径原样使用公开页面字段，例如同文件 `:173`、`:192`、`:215`、`:259`、`:269`；内部 pin/仓库断言仍在 `:67`、`:174`。`:189` 是拒绝路径，不计为接受伪造值。 | v2 允许 |
| `workspaceDecisionSettings.markNoticesSeen` | `tests/scenarios/support/S5-decisions.ts:448` | token、seenThrough 原样传递；公开页面来源 `tests/scenarios/S5-goal-conflict-rework.test.ts:170`；Workspace pin 经公开读，helper `:446`。 | v2 允许 |
| `workspaceDecisionSettings.markNoticesSeen` | `tests/work-graph/S2C-pins.test.ts:58` | position 手造、token 自行签发，同文件 `:51`、`:52`；随后继续 pin/重放测试，`:216`、`:227`、`:244`、`:254`。沿用首轮 `:23`。 | **F1：A1 平台签发字段** |

上述 F1 统一依据 `.lead-ref/books/test-rule-sheet-v2.md:32`，尤其 `:34`、`:35`；公开请求正文的允许依据 `:24`、`:28`。

2．Record-store 测试逐行及专用 helper

下表列测试声明位置；不是只列一个 seed 代表整个文件。`R3a` 的三行分别验证写入钩子/结果隔离、事务回滚、事务内 guard 对损坏记录的处理；对应断言在 `tests/record-store/R3a-transaction-boundaries.test.ts:56`、`:68`、`:95`、`:99`、`:127`、`:129`，guard 解码确由 store 执行，见 `src/core/record-store/sqlite-record-store.ts:330`。这些行按实际契约允许，而非按目录放行；依据 `.lead-ref/books/test-rule-sheet-v2.md:41`。

| 文件与全部测试行 | 实际验证对象 | 判定 |
|---|---|---|
| `tests/record-store/lookup.test.ts:55`、`:72`、`:94`、`:137`、`:174` | 索引、排序、续页、提交可见性、损坏记录 | v2 允许 |
| `tests/record-store/R3a-transaction-boundaries.test.ts:46`、`:76`、`:103` | 上述三项存储契约；Goal owner 作驱动 | v2 允许 |
| `tests/record-store/R3b-body-concurrency.test.ts:60` | 真实进程间 body-store 并发与首写归属 | v2 允许 |
| `tests/record-store/S2A-ordered-lookup.test.ts:152`、`:192`、`:228`、`:263`、`:293`、`:338`、`:362`、`:414`、`:441`、`:499`、`:540`、`:613` | 有序查询边界、续页、重开、拒绝及并发 | v2 允许 |
| `tests/record-store/S2C-count-lookup.test.ts:124`、`:142`、`:188`、`:222`、`:248`、`:284`、`:325` | 索引计数、提交可见性、重开 | v2 允许 |
| `tests/record-store/S4B-text-search.test.ts:33`、`:47`、`:61`、`:75`、`:94`、`:108`、`:122`、`:136`、`:150`、`:164`、`:183`、`:196`、`:209`、`:222`、`:236`、`:249`、`:269`、`:284`、`:299`、`:313`、`:361`、`:380`、`:400`、`:418`、`:441`、`:455`、`:469`、`:489`、`:504`、`:525`、`:539`、`:558`、`:571`、`:584`、`:597`、`:610`、`:624`、`:639`、`:652`、`:675`、`:692`、`:709` | 文本检索、分页、注册、重建、跨后端一致性 | v2 允许 |
| `tests/record-store/SP-literal-type.test.ts:65`、`:76`、`:142` | 类型名约束与类型隔离 | v2 允许 |
| `tests/record-store/SP-lookup-index-migration.test.ts:107`、`:154`、`:188`、`:223` | 索引注册迁移及多连接兼容 | v2 允许 |
| `tests/record-store/SP-record-store-limits.test.ts:113`、`:130`、`:167`、`:194` | lookup/lookupOrdered 的限额与续页契约 | v2 允许 |
| `tests/record-store/SP-text-scan-undo.test.ts:14` | 扫描桶撤销纯函数；不是新增提交豁免 | v2 允许，A5 |
| `tests/record-store/SP-text-scan.test.ts:74`、`:89`、`:111`、`:133`、`:175`、`:200`、`:217`、`:247`、`:272`、`:292`、`:315`、`:332`、`:349`、`:373`、`:404`、`:430` | 扫描、缓存失效、跨连接更新及续页 | v2 允许 |
| `tests/record-store/transaction-extensions.test.ts:46`、`:57`、`:75`、`:92`、`:116`、`:132`、`:154`、`:174`、`:196` | horizon、CAS、唯一占位、游标绑定、回滚、重放 | v2 允许 |
| `tests/record-store/WP2-notice-cursors.test.ts:61`、`:78` | store 游标字段注册白名单，不测通知业务状态 | v2 允许 |
| `tests/record-store/sqlite-body-race-worker.mjs:18` | 上述 body-store 并发测试的真实 put | v2 允许 |
| `tests/helpers/S4B-text-search-support.ts:155`、`:168` | 单条/批量提交；仅由 `tests/record-store/S4B-text-search.test.ts`、`tests/record-store/SP-record-store-limits.test.ts`、`tests/record-store/SP-text-scan.test.ts` 使用；导入证据分别在 `:11`、`:13`、`:15` | v2 允许 |

3．Store 以上的 F3

以下都是已确认的手造提交入口或调用点，依据 `.lead-ref/books/test-rule-sheet-v2.md:43`。透明转发不能仅因出现 `.commit` 就计 F3，例如 `tests/helpers/B2-execution-fixture.ts:354` 原样转发 gated batch；该处不计入下表。

“本文件”表示该文件中的本地测试/本地 helper。共享 helper 的调用文件列只列已核实调用关系；尚未完成全部间接展开，不能把本表称为完整传播清单。

| 提交位置 | 构造内容或入口 | 已核实调用文件 |
|---|---|---|
| `tests/helpers/task-claim-fixture.ts:310`、`:460`、`:470` | `commitRaw`、手造 Run、覆写 Session；确认首轮 `.lead-ref/t-v2-list.out.md:49` | 本表各 `commitRaw` 调用文件；另有 `tests/runtime/A2-reconcile-runtime.test.ts`、`tests/work-graph/R4c-execution-read.test.ts`、`tests/work-graph/R4c-task-claim-concurrency.test.ts`、`tests/work-graph/R4c-task-claim.test.ts` |
| `tests/helpers/graph-session-fixture.ts:365`、`:398`、`:423`、`:437` | 手造 Goal、接受任务状态、Session；确认首轮 `:50` | `tests/work-graph/A1-independent-review.test.ts`、`tests/work-graph/A1-session-independent.test.ts`、`tests/work-graph/A1-session-lifecycle.test.ts` |
| `tests/helpers/S5-decision-fixture.ts:547`、`:560`、`:599`、`:1016`、`:1017`、`:1018` | `seedCommit` 与 Goal/Plan/Proposal 别名；确认首轮 `:51` | 直接调用 `openS5DecisionFixture` 的文件及本表 `seedCommit` 调用文件；完整间接名单未完成 |
| `tests/helpers/B2-runtime-fixture.ts:204` | 手造协调策略与活动指针 | `tests/composition/B2-runtime-platform.test.ts`、`tests/composition/R4-control-runtime-platform.test.ts`、`tests/helpers/K-readonly-work-support.ts`、`tests/helpers/S2B-runtime-store-fixture.ts`、`tests/runtime/A2-reconcile-runtime.test.ts`、`tests/runtime/B2-runtime-execution.test.ts`、`tests/runtime/K-readonly-command.test.ts`、`tests/runtime/K3-14-record-unknown-call-review-tool.test.ts`、`tests/runtime/K3-19-review-capability.test.ts`、`tests/runtime/K3-24-unknown-outcome-stability.test.ts`、`tests/runtime/orchestration-boundaries.test.ts`、`tests/runtime/R2e-git-source-loop.test.ts`、`tests/runtime/R4-control-runtime.test.ts`、`tests/runtime/R4c-source-authority-guards.test.ts`、`tests/runtime/S2B-15-end-retry-activity.test.ts`、`tests/scenarios/A7-control.test.ts`、`tests/work-graph/R3c-plan-adoption.test.ts` |
| `tests/helpers/C1-mailbox-fixture.ts:174`、`:211`、`:224` | entered Run、Run 更新、Session 更新 | `tests/app/orchestration-mechanism.test.ts`、`tests/runtime/C1-communication-tools.test.ts`、`tests/work-graph/A2-step1-manifest.test.ts`、`tests/work-graph/C1-session-mailbox.test.ts`、`tests/work-graph/C2-mailbox-admission.test.ts`、`tests/work-graph/K3-39-tool-commit-lookup.test.ts` |
| `tests/helpers/C2-runtime-platform-fixture.ts:106` | 策略矩阵记录 | `tests/composition/A2-reconcile-classifier-platform.test.ts`、`tests/composition/AG1-session-discovery.test.ts`、`tests/composition/C2-runtime-platform.test.ts`、`tests/composition/S2B-39-run17-activity.test.ts`、`tests/composition/S2B-40-run20iii-activity.test.ts`、`tests/runtime/C2-runtime-platform-tools.test.ts`、`tests/state/invariants.test.ts` |
| `tests/helpers/K-readonly-work-support.ts:80` | raw 记录追加 | `tests/runtime/K-readonly-command.test.ts` |
| `tests/helpers/S1-session-facts-fixture.ts:220` | `createLegacySession` 写旧 Session | 未发现该函数的当前调用；定义仍保留 |
| `tests/helpers/S2B-activity-fixture.ts:333` | `seedLegacyActivity` 手造结束 Run | `tests/app/S2B-r2-backfill-done-cursor.test.ts` |
| `tests/helpers/S2B-be1-platform-fixture.ts:208` | 手造策略矩阵 | `tests/app/RL-34-wiring-resource-caps.test.ts`、`tests/composition/S2B-be1-counting-failure.test.ts`、`tests/composition/S2B-be1-cross-hour.test.ts`、`tests/composition/S2B-be1-five-tools.test.ts`、`tests/composition/S2B-be1-step-boundaries.test.ts`、`tests/composition/S2B-be1-usage.test.ts`、`tests/composition/S2B-be1s-shell.test.ts`、`tests/runtime/RL-30-shell-resource-caps.test.ts`、`tests/runtime/RL-31-readonly-resource-caps.test.ts`、`tests/runtime/RL-35-36-sandbox-and-retry.test.ts`、`tests/work-graph/S2B-r2-v-real-runs.test.ts` |
| `tests/helpers/S2B-r2-activity-support.ts:69` | `seedActivityRun` | `tests/work-graph/S2B-r2-keyed-cap.test.ts`、`tests/work-graph/S2B-r2-never-entered.test.ts`、`tests/work-graph/S2B-r4-session-workspace.test.ts` |
| `tests/helpers/S2B-r2-track-support.ts:75` | `seedRawRunVariant` | `tests/work-graph/S2B-r2-r5-not-entered.test.ts`、`tests/work-graph/S2B-r4-session-workspace.test.ts` |
| `tests/helpers/S2B-r3-r4-support.ts:39` | 克隆 Session 到另一个 Workspace | `tests/work-graph/S2B-r4-session-workspace.test.ts` |
| `tests/helpers/S2C-X-scale-fixture.ts:408`、`:430` | 手造 picker Run、复制历史 Run | `tests/work-graph/S2C-lines-scale.test.ts` |
| `tests/helpers/W2-whiteboard-fixture.ts:352` | `seedAgentCandidate` | `tests/work-graph/A2-disposition-change.test.ts`、`tests/work-graph/W2-agent-whiteboard.test.ts` |
| `tests/helpers/WP2-duties-fixture.ts:123` | `seedCommit` | `tests/work-graph/WP2-message-duties.test.ts` |
| `tests/helpers/WP2-platform-support.ts:579` | 手造策略矩阵 | `tests/composition/WP2-wiring.test.ts`、`tests/runtime/S4C2-assembly.test.ts`、`tests/scenarios/WP2-wiring-scenario.test.ts`、`tests/work-graph/S4C2-update-due.test.ts` |
| `tests/app/S2B-backfill-workflow.test.ts:83` | `commitRaw` | 本文件 |
| `tests/app/S2B-r2-backfill-done-cursor.test.ts:59` | `commitRaw` | 本文件 |
| `tests/composition/A1-graph-session-platform.test.ts:54` | scope seed | 本文件 |
| `tests/composition/R3c-R4b-platform.test.ts:93` | scope seed | 本文件 |
| `tests/composition/R3d-R3g-platform.test.ts:87` | scope seed | 本文件 |
| `tests/composition/W1-future-plan-platform.test.ts:135`、`:189` | scope/业务状态批次 | 本文件 |
| `tests/composition/W2-future-intent-platform.test.ts:119` | scope seed | 本文件 |
| `tests/runtime/R4b-session-input-boundaries.test.ts:53` | scope seed | 本文件 |
| `tests/runtime/R4b-session-operations.test.ts:59` | scope seed | 本文件 |
| `tests/runtime/R4b-session-recovery.test.ts:60` | scope seed | 本文件 |
| `tests/runtime/R4c-execution-history.test.ts:61` | scope seed | 本文件 |
| `tests/runtime/R4c-graph-history.test.ts:165` | raw 历史记录 | 本文件 |
| `tests/runtime/S3-graph-tools.test.ts:903`、`:972`、`:978` | scope、`commitRaw` 与事实批次 | 本文件 |
| `tests/work-graph/A1-independent-review.test.ts:48` | raw 记录批次 | 本文件 |
| `tests/work-graph/A1-session-independent.test.ts:127` | Session 别名记录 | 本文件 |
| `tests/work-graph/A2-disposition-change.test.ts:143`、`:156`、`:198`、`:209`、`:220`、`:241`、`:261`、`:641` | scope、Run、Lease、Reduction 等 seed | 本文件 |
| `tests/work-graph/A2-gate-chain-facts.test.ts:237`、`:304` | VerificationRound 记录 | 本文件 |
| `tests/work-graph/A2-step1-codecs.test.ts:161` | 业务记录编码后提交 helper | 本文件 |
| `tests/work-graph/B2-execution-entry.test.ts:30`、`:175` | Lease 与占位批次 | 本文件 |
| `tests/work-graph/B2-execution-result.test.ts:31`、`:105` | WorkLink、Lease | 本文件 |
| `tests/work-graph/C1-session-mailbox.test.ts:362`、`:483`、`:513` | 改写业务记录 | 本文件 |
| `tests/work-graph/goal-independent.test.ts:47` | scope seed | 本文件 |
| `tests/work-graph/K3-11-review-reasons.test.ts:159` | review 状态提交 helper | 本文件 |
| `tests/work-graph/K3-14-unknown-call-review-tool.test.ts:121`、`:213`、`:292` | review 记录批次 | 本文件 |
| `tests/work-graph/K3-45-review-incomplete.test.ts:139` | review 记录批次 | 本文件 |
| `tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:213` | review 记录批次 | 本文件 |
| `tests/work-graph/material-readers.test.ts:63` | 材料权限读取所需记录 | 本文件 |
| `tests/work-graph/R3a-goal-replay-boundaries.test.ts:44`、`:50`、`:67` | scope 创建、改写 | 本文件 |
| `tests/work-graph/R3b-material-applicability.test.ts:87` | Workspace/归属等记录 | 本文件 |
| `tests/work-graph/R3c-plan-adoption.test.ts:109` | scope seed | 本文件 |
| `tests/work-graph/R3c-plan-entry.test.ts:46` | scope seed | 本文件 |
| `tests/work-graph/R3c-task-relations.test.ts:93` | 关系测试 seed | 本文件 |
| `tests/work-graph/R3d-fixture.ts:85` | architecture scope seed | `tests/app/S8A-architecture-routes.test.ts`、`tests/work-graph/R3d-observed-architecture.test.ts`、`tests/work-graph/R3d-observed-boundaries.test.ts`、`tests/work-graph/R3d-record-integrity.test.ts`、`tests/work-graph/S8A-root-path.test.ts` |
| `tests/work-graph/R3d-observed-boundaries.test.ts:146` | 额外手造提交 | 本文件 |
| `tests/work-graph/R3e-reverify.test.ts:255`、`:477`、`:485` | Workspace 修订、VerificationRound | 本文件 |
| `tests/work-graph/R3g-role-spec.test.ts:85`、`:99`、`:178`、`:278`、`:299`、`:314`、`:353`、`:386`、`:397`、`:414`、`:434`、`:451`、`:474`、`:512` | Project、协调策略及策略替换记录 | 本文件 |
| `tests/work-graph/R4b-session-boundaries.test.ts:63`、`:141`、`:182`、`:220`、`:259` | scope、Session、WorkLink 批次 | 本文件 |
| `tests/work-graph/R4b-session-directory.test.ts:102`、`:149` | scope、已接受任务状态 | 本文件 |
| `tests/work-graph/R4c-execution-history-index.test.ts:287`、`:750` | 历史记录及并发覆写 | 本文件 |
| `tests/work-graph/R4c-execution-read.test.ts:189`、`:371`、`:391`、`:424` | Lease、Project、业务记录覆写 | 本文件 |
| `tests/work-graph/R4c-task-claim-boundaries.test.ts:56` | claim 前置矩阵 | 本文件 |
| `tests/work-graph/R4c-task-claim-concurrency.test.ts:71` | 业务记录覆写 | 本文件 |
| `tests/work-graph/R4c-task-claim.test.ts:334` | 额外 Project 提交 | 本文件 |
| `tests/work-graph/S1-codecs-indexes.test.ts:252` | `seedOldOutbox` | 本文件 |
| `tests/work-graph/S1-session-facts.test.ts:129` | 复制事实记录 | 本文件 |
| `tests/work-graph/S2A-queue-goal-runs.test.ts:47` | 手造 Run | 本文件 |
| `tests/work-graph/S2A-queue-request-candidates.test.ts:72` | `seedCandidateProposal` | 本文件 |
| `tests/work-graph/S3-context-inputs.test.ts:330`、`:478`、`:485`、`:504` | scope、上下文事实 seed | 本文件 |
| `tests/work-graph/S3-graph-context.test.ts:530`、`:556`、`:594`、`:759` | scope、事实、结束状态及切换 | 本文件 |
| `tests/work-graph/S3-prepared-context-admission.test.ts:234`、`:258`、`:382`、`:569`、`:635` | 治理、Run、撤销及 scope 记录 | 本文件 |
| `tests/work-graph/S3-role-profiles.test.ts:154` | scope seed | 本文件 |
| `tests/work-graph/S4C2-U3.test.ts:78` | 手造 NoteDispositionChanged 事件 | 本文件 |
| `tests/work-graph/S5-decision-application.test.ts:78` | 手造 scope 事件以取得 receipt | 本文件 |
| `tests/work-graph/S5-goal-cause-at-least-cursor.test.ts:20` | 空记录 seed 推进游标 | 本文件 |
| `tests/work-graph/S8A-file-layer.test.ts:103`、`:122` | scope seed、任意记录提交 helper | 本文件 |
| `tests/work-graph/UCR-settle-review.test.ts:85`、`:152`、`:199` | review 记录 | 本文件 |
| `tests/work-graph/unknown-call-review-list.test.ts:61` | review 记录 | 本文件 |
| `tests/work-graph/W1-future-plan.test.ts:240`、`:254`、`:281`、`:297`、`:306`、`:320`、`:382` | scope、Plan、Run、Lease、Reduction、空提交 | 本文件 |
| `tests/work-graph/W2-agent-whiteboard.test.ts:324` | 空 raw 提交 | 本文件 |
| `tests/work-graph/WP2-context-extensions.test.ts:319` | `seedCandidateProposal` | 本文件 |
| `tests/work-graph/WP2-message-duties.test.ts:94` | `seedCommit` | 本文件 |
| `tests/work-graph/WP2-undelivered-notices.test.ts:286`、`:292` | Session、Message raw 提交 | 本文件 |
| `tests/scenarios/S3-query-graph.test.ts:208` | 直接 SQL 写 RunSnapshot | 本文件 |

4．A7 三个指定 helper

这里同时列出直接调用和 v2 明列的外层调用位置；定义位置不另计一次使用。范围依据 `.lead-ref/books/test-rule-sheet-v2.md:45`、`:50`、`:59`。

| helper | 全部已定位使用位置 | 边界与判定 |
|---|---|---|
| `buildNoteTools` | `tests/runtime/S4C-note-tools.test.ts:114`、`:124`、`:151`、`:165`、`:177`、`:188`、`:206`、`:215`、`:240` | 均在指定文件验证适配、默认值或结果透传；沿用首轮 `.lead-ref/t-v2-list.out.md:57` 至 `:65`。**v2 允许** |
| `damageKernel` | `tests/scenarios/S2C-K-unknown-outcome.test.ts:75`、`:157`、`:179` | 直接调用加外层使用；只损坏临时 Kernel 库，SQL 在同文件 `:41`。**v2 允许** |
| `damageKernel` 移动形式 | `tests/scenarios/S2C-K-retired.test.ts:218`、`:248`、`:298` | 直接调用、外层调用与 damaged 参数实例；SQL 在同文件 `:196`。**v2 允许** |
| process sandbox stand-in | `tests/scenarios/K3-44-crr-kind4.test.ts:53` | `executeChecks:false`，初始化 `:49`，复位 `:74`。**v2 允许** |
| process sandbox stand-in | `tests/scenarios/K3-29-disposition-recovery.test.ts:50` | 同文件 `:185` 开启执行；到达 helper 的命令执行与结果返回，`tests/scenarios/support/process-sandbox-standin.ts:59`、`:64`。**A7 越界** |
| process sandbox stand-in | `tests/scenarios/K3-44-recovery-answers.test.ts:51` | 同文件 `:267` 开启执行，越过仅 probe 的范围。**A7 越界** |

```json
[
  {"section":1,"file":"tests/helpers/task-claim-fixture.ts","line":[343],"owner":"plans.proposePlan","value":"手写计划正文","verdict":"v2 允许","note":"首轮确认；公开apply349；夹具直写另计"},
  {"section":1,"file":"tests/business/K3-46-review-advance-failures.test.ts","line":[143],"owner":"plans.proposePlan","value":"公开任务图投影的计划正文","verdict":"v2 允许","note":"公开读128；组装133；公开apply149"},
  {"section":1,"file":"tests/helpers/S5R2-a-support.ts","line":[82],"owner":"plans.proposePlan","value":"仓库记录投影的计划正文","verdict":"v2 允许","note":"来源68；后续97、105仍读仓库"},
  {"section":1,"file":"tests/runtime/S5R2-agent-application.test.ts","line":[143],"owner":"propose_future_plan","value":"计划工具参数","verdict":"v2 允许","note":"首轮确认；公开读取155；后面的receipt重建另计"},
  {"section":1,"file":"tests/helpers/S4A-note-fixture.ts","line":[222],"owner":"plans.proposePlan","value":"手写计划正文","verdict":"v2 允许","note":"公开apply225；调用者全链未追完"},
  {"section":1,"file":"tests/helpers/S4A-note-scope-fixture.ts","line":[212,234],"owner":"plans.proposePlan","value":"手写计划正文","verdict":"v2 允许","note":"公开apply215、237；调用者全链未追完"},
  {"section":1,"file":"tests/helpers/S5-user-message-support.ts","line":[95],"owner":"decisionMessages.sendUserMessage","value":"手写正文及已有消息的选项对象","verdict":"v2 允许","note":"来源82；无签发凭据；检查公开结果99"},
  {"section":1,"file":"tests/work-graph/S5-user-messages.test.ts","line":[37],"owner":"decisionMessages.sendUserMessage","value":"手写消息请求","verdict":"v2 允许","note":"构造30；后续内部事件断言67不豁免"},
  {"section":1,"file":"tests/work-graph/S5-decision-application.test.ts","line":[53],"owner":"decisionMessages.recordDecisionApplication","value":"截获commit重建receipt","verdict":"F1","note":"A1平台签发字段条款；构造34、39"},
  {"section":1,"file":"tests/work-graph/S2A-queue-card-semantics.test.ts","line":[78],"owner":"decisionMessages.recordDecisionApplication","value":"截获commit重建receipt","verdict":"F1","note":"A1平台签发字段条款；构造60、63；后续83"},
  {"section":1,"file":"tests/scenarios/support/S5-decisions.ts","line":[434],"owner":"decisionMessages.recordDecisionApplication","value":"内部ledger取得receipt","verdict":"F1","note":"A1平台签发字段条款；来源tests/scenarios/S5-two-request-decisions.test.ts:141；调用163；后续169"},
  {"section":1,"file":"tests/runtime/S5R2-agent-application.test.ts","line":[241,282],"owner":"record_decision_application","value":"内部事件重建receipt","verdict":"F1","note":"A1平台签发字段条款；事件读187；重建224；返回229；后续248、288"},
  {"section":1,"file":"tests/runtime/S5R2-agent-application.test.ts","line":[374],"owner":"decisionMessages.recordDecisionApplication","value":"内部事件重建receipt","verdict":"F1","note":"A1平台签发字段条款；重建224；组装373；后续378"},
  {"section":1,"file":"tests/helpers/S4A-note-fixture.ts","line":[282],"owner":"notes.writeNote","value":"调用者注记正文及版本条件","verdict":"v2 允许","note":"首轮确认；只判输入"},
  {"section":1,"file":"tests/helpers/S4A-note-scope-fixture.ts","line":[329],"owner":"notes.writeNote","value":"调用者注记正文及版本条件","verdict":"v2 允许","note":"无签发凭据；原样返回；调用者全链未追完"},
  {"section":1,"file":"tests/helpers/S4A-note-scope-fixture.ts","line":[325],"owner":"notes.reviewNote","value":"审阅请求及版本条件","verdict":"v2 允许","note":"不是构造审阅结果；调用者全链未追完"},
  {"section":1,"file":"tests/helpers/S4C2-note-card-fixture.ts","line":[299],"owner":"notes.reviewNote","value":"手写审阅请求","verdict":"v2 允许","note":"无签发凭据；调用者全链未追完"},
  {"section":1,"file":"tests/helpers/S4C2-note-card-fixture.ts","line":[308,314],"owner":"notes.withdrawNote","value":"手写撤回请求","verdict":"v2 允许","note":"无签发凭据；调用者全链未追完"},
  {"section":1,"file":"tests/work-graph/S5-goal-settings.test.ts","line":[398,410,416,423,501,525,544,577,599,619,637,652,654,669],"owner":"goalSettings.setGoalSettings","value":"手写自治和等待目标设置","verdict":"v2 允许","note":"无签发凭据；后续仓库与事件断言404、419、643、644不豁免"},
  {"section":1,"file":"tests/work-graph/S5-goal-settings.test.ts","line":[434,456,624,638],"owner":"goalSettings.reorderGoals","value":"手写目标顺序","verdict":"v2 允许","note":"无签发凭据；后续437、461、643、646不是全公开"},
  {"section":1,"file":"tests/helpers/S5R2-b-support.ts","line":[153],"owner":"goalSettings.setGoalSettings","value":"手写自治设置","verdict":"v2 允许","note":"版本来自内部goalAt152；只判输入"},
  {"section":1,"file":"tests/helpers/S5R2-d-support.ts","line":[63],"owner":"goalSettings.reorderGoals","value":"手写目标顺序","verdict":"v2 允许","note":"公开读取72；后续替身74另论"},
  {"section":1,"file":"tests/helpers/S5-queue-support.ts","line":[366],"owner":"claims.requeueTask","value":"手写requeue请求","verdict":"v2 允许","note":"首轮确认；前置手造事件365及摘要替身360不豁免"},
  {"section":1,"file":"tests/helpers/K3-prefix-claim.ts","line":[111],"owner":"claims.requeueTask","value":"公开读取组装的requeue请求","verdict":"v2 允许","note":"公开读106、108；手写摘要替身99不豁免"},
  {"section":1,"file":"tests/helpers/K3-crr-fixture.ts","line":[167],"owner":"claims.requeueTask","value":"公开读取组装的requeue请求","verdict":"v2 允许","note":"公开读163、165；摘要替身157不豁免"},
  {"section":1,"file":"tests/helpers/K3-35-continuation-fixture.ts","line":[708],"owner":"claims.requeueTask","value":"手写reason/note及公开Run版本","verdict":"v2 允许","note":"公开读706；真实摘要412、414；调用者全链未追完"},
  {"section":1,"file":"tests/composition/WP2-wiring.test.ts","line":[146,851],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"公开页面的token和seenThrough","verdict":"v2 允许","note":"来源142、844；公开Workspace读144、849；后续856"},
  {"section":1,"file":"tests/helpers/S4C2-note-card-fixture.ts","line":[389],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"公开页面的token和seenThrough","verdict":"v2 允许","note":"公开页面377；公开Workspace读387"},
  {"section":1,"file":"tests/helpers/WP2-notices-fixture.ts","line":[122],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"公开页面的token和seenThrough","verdict":"v2 允许","note":"来源117；内部pin124不豁免"},
  {"section":1,"file":"tests/helpers/S2A-notices-support.ts","line":[88],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"公开页面的token和seenThrough","verdict":"v2 允许","note":"来源83；内部pin89不豁免"},
  {"section":1,"file":"tests/work-graph/S5-notices.test.ts","line":[66],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"公开页面的token和seenThrough","verdict":"v2 允许","note":"接受路径173、192、215、259、269；拒绝路径189未计为接受伪造值；内部读取67、174不豁免"},
  {"section":1,"file":"tests/scenarios/support/S5-decisions.ts","line":[448],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"原样传入公开页面字段","verdict":"v2 允许","note":"来源tests/scenarios/S5-goal-conflict-rework.test.ts:170；公开Workspace读446"},
  {"section":1,"file":"tests/work-graph/S2C-pins.test.ts","line":[58],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"手造position和自行签发token","verdict":"F1","note":"A1平台签发字段条款；构造51、52；后续216、227、244、254"},

  {"section":2,"file":"tests/record-store/lookup.test.ts","line":[55,72,94,137,174],"owner":"record-store","value":"索引查询契约测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/R3a-transaction-boundaries.test.ts","line":[46,76,103],"owner":"record-store","value":"写入钩子、隔离、回滚、guard","verdict":"v2 允许","note":"Goal作驱动；按断言56、68、95、99、127、129判存储契约"},
  {"section":2,"file":"tests/record-store/R3b-body-concurrency.test.ts","line":[60],"owner":"body-store","value":"真实进程并发put","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/S2A-ordered-lookup.test.ts","line":[152,192,228,263,293,338,362,414,441,499,540,613],"owner":"record-store.lookupOrdered","value":"有序查询测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/S2C-count-lookup.test.ts","line":[124,142,188,222,248,284,325],"owner":"record-store.count","value":"计数测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/S4B-text-search.test.ts","line":[33,47,61,75,94,108,122,136,150,164,183,196,209,222,236,249,269,284,299,313,361,380,400,418,441,455,469,489,504,525,539,558,571,584,597,610,624,639,652,675,692,709],"owner":"record-store.searchText","value":"文本检索测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/SP-literal-type.test.ts","line":[65,76,142],"owner":"record-store","value":"类型名及隔离测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/SP-lookup-index-migration.test.ts","line":[107,154,188,223],"owner":"record-store","value":"索引迁移测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/SP-record-store-limits.test.ts","line":[113,130,167,194],"owner":"record-store","value":"查询限额测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/SP-text-scan-undo.test.ts","line":[14],"owner":"text-scan","value":"撤销纯函数输入","verdict":"v2 允许","note":"A5；不是新增提交豁免"},
  {"section":2,"file":"tests/record-store/SP-text-scan.test.ts","line":[74,89,111,133,175,200,217,247,272,292,315,332,349,373,404,430],"owner":"record-store","value":"文本扫描测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/transaction-extensions.test.ts","line":[46,57,75,92,116,132,154,174,196],"owner":"record-store","value":"事务扩展测试行","verdict":"v2 允许","note":"store自身契约"},
  {"section":2,"file":"tests/record-store/WP2-notice-cursors.test.ts","line":[61,78],"owner":"record-store","value":"游标绑定白名单测试行","verdict":"v2 允许","note":"不测通知业务状态"},
  {"section":2,"file":"tests/record-store/sqlite-body-race-worker.mjs","line":[18],"owner":"body-store.put","value":"并发worker输入","verdict":"v2 允许","note":"专用store helper"},
  {"section":2,"file":"tests/helpers/S4B-text-search-support.ts","line":[155,168],"owner":"record-store.commit","value":"seed和seedBatch","verdict":"v2 允许","note":"调用者仅tests/record-store/S4B-text-search.test.ts、tests/record-store/SP-record-store-limits.test.ts、tests/record-store/SP-text-scan.test.ts"},

  {"section":3,"file":"tests/helpers/task-claim-fixture.ts","line":[310,460,470],"owner":"commitRaw","value":"Run和Session等记录","verdict":"F3","note":"首轮确认；共享调用关系见第三表；完整间接展开未完成"},
  {"section":3,"file":"tests/helpers/graph-session-fixture.ts","line":[365,398,423,437],"owner":"commitRaw/seedAcceptedTask/overwriteSession","value":"Goal、任务、Session记录","verdict":"F3","note":"调用者tests/work-graph/A1-independent-review.test.ts、tests/work-graph/A1-session-independent.test.ts、tests/work-graph/A1-session-lifecycle.test.ts"},
  {"section":3,"file":"tests/helpers/S5-decision-fixture.ts","line":[547,560,599,1016,1017,1018],"owner":"seedCommit及三个seed别名","value":"scope、Goal、Plan、Proposal记录","verdict":"F3","note":"首轮确认；调用者包括openS5DecisionFixture直接调用文件及本表seedCommit调用文件；完整间接名单未完成"},
  {"section":3,"file":"tests/helpers/B2-runtime-fixture.ts","line":[204],"owner":"createB2RuntimeFixture","value":"协调策略及活动指针记录","verdict":"F3","note":"已核对的直接调用文件见第三表"},
  {"section":3,"file":"tests/helpers/C1-mailbox-fixture.ts","line":[174,211,224],"owner":"createC1Harness及更新helper","value":"entered Run、Run、Session记录","verdict":"F3","note":"调用者tests/app/orchestration-mechanism.test.ts、tests/runtime/C1-communication-tools.test.ts、tests/work-graph/A2-step1-manifest.test.ts、tests/work-graph/C1-session-mailbox.test.ts、tests/work-graph/C2-mailbox-admission.test.ts、tests/work-graph/K3-39-tool-commit-lookup.test.ts"},
  {"section":3,"file":"tests/helpers/C2-runtime-platform-fixture.ts","line":[106],"owner":"createC2RuntimePlatform","value":"策略矩阵记录","verdict":"F3","note":"已核对的直接调用文件见第三表"},
  {"section":3,"file":"tests/helpers/K-readonly-work-support.ts","line":[80],"owner":"createKReadonlyWorkFixture","value":"raw记录批次","verdict":"F3","note":"调用者tests/runtime/K-readonly-command.test.ts"},
  {"section":3,"file":"tests/helpers/S1-session-facts-fixture.ts","line":[220],"owner":"createLegacySession","value":"旧Session记录","verdict":"F3","note":"未发现当前函数调用；定义仍保留"},
  {"section":3,"file":"tests/helpers/S2B-activity-fixture.ts","line":[333],"owner":"seedLegacyActivity","value":"结束Run记录","verdict":"F3","note":"调用者tests/app/S2B-r2-backfill-done-cursor.test.ts"},
  {"section":3,"file":"tests/helpers/S2B-be1-platform-fixture.ts","line":[208],"owner":"createS2BBe1Platform","value":"策略矩阵记录","verdict":"F3","note":"已核对的直接调用文件见第三表"},
  {"section":3,"file":"tests/helpers/S2B-r2-activity-support.ts","line":[69],"owner":"seedActivityRun","value":"Run记录","verdict":"F3","note":"调用者tests/work-graph/S2B-r2-keyed-cap.test.ts、tests/work-graph/S2B-r2-never-entered.test.ts、tests/work-graph/S2B-r4-session-workspace.test.ts"},
  {"section":3,"file":"tests/helpers/S2B-r2-track-support.ts","line":[75],"owner":"seedRawRunVariant","value":"改写后Run记录","verdict":"F3","note":"调用者tests/work-graph/S2B-r2-r5-not-entered.test.ts、tests/work-graph/S2B-r4-session-workspace.test.ts"},
  {"section":3,"file":"tests/helpers/S2B-r3-r4-support.ts","line":[39],"owner":"cloneSessionInWorkspace","value":"克隆Session记录","verdict":"F3","note":"调用者tests/work-graph/S2B-r4-session-workspace.test.ts"},
  {"section":3,"file":"tests/helpers/S2C-X-scale-fixture.ts","line":[408,430],"owner":"buildScaleFixture","value":"picker与历史Run记录","verdict":"F3","note":"调用者tests/work-graph/S2C-lines-scale.test.ts"},
  {"section":3,"file":"tests/helpers/W2-whiteboard-fixture.ts","line":[352],"owner":"seedAgentCandidate","value":"Agent候选记录","verdict":"F3","note":"调用者tests/work-graph/A2-disposition-change.test.ts、tests/work-graph/W2-agent-whiteboard.test.ts"},
  {"section":3,"file":"tests/helpers/WP2-duties-fixture.ts","line":[123],"owner":"openWP2DutiesFixture","value":"seedCommit批次","verdict":"F3","note":"调用者tests/work-graph/WP2-message-duties.test.ts"},
  {"section":3,"file":"tests/helpers/WP2-platform-support.ts","line":[579],"owner":"createWP2Platform","value":"策略矩阵记录","verdict":"F3","note":"调用者tests/composition/WP2-wiring.test.ts、tests/runtime/S4C2-assembly.test.ts、tests/scenarios/WP2-wiring-scenario.test.ts、tests/work-graph/S4C2-update-due.test.ts"},
  {"section":3,"file":"tests/app/S2B-backfill-workflow.test.ts","line":[83],"owner":"commitRaw","value":"业务记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/app/S2B-r2-backfill-done-cursor.test.ts","line":[59],"owner":"commitRaw","value":"业务记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/composition/A1-graph-session-platform.test.ts","line":[54],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/composition/R3c-R4b-platform.test.ts","line":[93],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/composition/R3d-R3g-platform.test.ts","line":[87],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/composition/W1-future-plan-platform.test.ts","line":[135,189],"owner":"records.commit","value":"scope及业务状态","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/composition/W2-future-intent-platform.test.ts","line":[119],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/runtime/R4b-session-input-boundaries.test.ts","line":[53],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/runtime/R4b-session-operations.test.ts","line":[59],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/runtime/R4b-session-recovery.test.ts","line":[60],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/runtime/R4c-execution-history.test.ts","line":[61],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/runtime/R4c-graph-history.test.ts","line":[165],"owner":"commitRaw","value":"历史记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/runtime/S3-graph-tools.test.ts","line":[903,972,978],"owner":"records.commit/commitRaw","value":"scope和上下文事实","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/A1-independent-review.test.ts","line":[48],"owner":"commitRaw","value":"业务记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/A1-session-independent.test.ts","line":[127],"owner":"commitRaw","value":"Session别名记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/A2-disposition-change.test.ts","line":[143,156,198,209,220,241,261,641],"owner":"seedCommit/commitRaw","value":"scope、Run、Lease、Reduction等","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/A2-gate-chain-facts.test.ts","line":[237,304],"owner":"commitRaw","value":"VerificationRound记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/A2-step1-codecs.test.ts","line":[161],"owner":"commit","value":"编码后的业务记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/B2-execution-entry.test.ts","line":[30,175],"owner":"commitRaw/records.commit","value":"Lease及占位批次","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/B2-execution-result.test.ts","line":[31,105],"owner":"commitRaw","value":"WorkLink和Lease","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/C1-session-mailbox.test.ts","line":[362,483,513],"owner":"commitRaw","value":"覆写业务记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/goal-independent.test.ts","line":[47],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/K3-11-review-reasons.test.ts","line":[159],"owner":"commit","value":"review状态","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/K3-14-unknown-call-review-tool.test.ts","line":[121,213,292],"owner":"records.commit","value":"review记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/K3-45-review-incomplete.test.ts","line":[139],"owner":"records.commit","value":"review记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts","line":[213],"owner":"records.commit","value":"review记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/material-readers.test.ts","line":[63],"owner":"records.commit","value":"材料权限读取所需记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3a-goal-replay-boundaries.test.ts","line":[44,50,67],"owner":"records.commit","value":"scope创建及覆写","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3b-material-applicability.test.ts","line":[87],"owner":"records.commit","value":"Workspace及归属记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3c-plan-adoption.test.ts","line":[109],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3c-plan-entry.test.ts","line":[46],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3c-task-relations.test.ts","line":[93],"owner":"records.commit","value":"关系测试seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3d-fixture.ts","line":[85],"owner":"records.commit","value":"architecture scope seed","verdict":"F3","note":"调用者tests/app/S8A-architecture-routes.test.ts、tests/work-graph/R3d-observed-architecture.test.ts、tests/work-graph/R3d-observed-boundaries.test.ts、tests/work-graph/R3d-record-integrity.test.ts、tests/work-graph/S8A-root-path.test.ts"},
  {"section":3,"file":"tests/work-graph/R3d-observed-boundaries.test.ts","line":[146],"owner":"records.commit","value":"额外手造提交","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3e-reverify.test.ts","line":[255,477,485],"owner":"commitRaw","value":"Workspace与VerificationRound","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R3g-role-spec.test.ts","line":[85,99,178,278,299,314,353,386,397,414,434,451,474,512],"owner":"records.commit","value":"Project和策略记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R4b-session-boundaries.test.ts","line":[63,141,182,220,259],"owner":"records.commit","value":"scope、Session、WorkLink","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R4b-session-directory.test.ts","line":[102,149],"owner":"records.commit","value":"scope和接受任务状态","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R4c-execution-history-index.test.ts","line":[287,750],"owner":"commitRaw","value":"历史记录及覆写","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R4c-execution-read.test.ts","line":[189,371,391,424],"owner":"commitRaw","value":"Lease、Project、业务记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R4c-task-claim-boundaries.test.ts","line":[56],"owner":"commitRaw","value":"claim前置矩阵","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R4c-task-claim-concurrency.test.ts","line":[71],"owner":"commitRaw","value":"业务记录覆写","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/R4c-task-claim.test.ts","line":[334],"owner":"commitRaw","value":"额外Project记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S1-codecs-indexes.test.ts","line":[252],"owner":"seedOldOutbox","value":"旧outbox记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S1-session-facts.test.ts","line":[129],"owner":"commitRaw","value":"复制事实记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S2A-queue-goal-runs.test.ts","line":[47],"owner":"seedCommit","value":"手造Run","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S2A-queue-request-candidates.test.ts","line":[72],"owner":"seedCandidateProposal","value":"手造候选","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S3-context-inputs.test.ts","line":[330,478,485,504],"owner":"records.commit/commitRaw","value":"scope和上下文事实","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S3-graph-context.test.ts","line":[530,556,594,759],"owner":"records.commit","value":"scope、事实、结束状态及切换","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S3-prepared-context-admission.test.ts","line":[234,258,382,569,635],"owner":"commitRaw","value":"治理、Run、撤销、scope记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S3-role-profiles.test.ts","line":[154],"owner":"records.commit","value":"scope seed","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S4C2-U3.test.ts","line":[78],"owner":"commitNoteEvent","value":"手造注记处置事件","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S5-decision-application.test.ts","line":[78],"owner":"scopeReceipt","value":"手造scope事件","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S5-goal-cause-at-least-cursor.test.ts","line":[20],"owner":"seedCommit","value":"空记录提交推进游标","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/S8A-file-layer.test.ts","line":[103,122],"owner":"records.commit","value":"scope及任意业务记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/UCR-settle-review.test.ts","line":[85,152,199],"owner":"records.commit","value":"review记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/unknown-call-review-list.test.ts","line":[61],"owner":"records.commit","value":"review记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/W1-future-plan.test.ts","line":[240,254,281,297,306,320,382],"owner":"seedCommit/commitRaw","value":"scope、Plan、Run、Lease、Reduction及空提交","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/W2-agent-whiteboard.test.ts","line":[324],"owner":"commitRaw","value":"空提交","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/WP2-context-extensions.test.ts","line":[319],"owner":"seedCandidateProposal","value":"手造候选","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/WP2-message-duties.test.ts","line":[94],"owner":"seedCommit","value":"业务记录批次","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/work-graph/WP2-undelivered-notices.test.ts","line":[286,292],"owner":"commitRaw","value":"Session和Message记录","verdict":"F3","note":"调用者本文件"},
  {"section":3,"file":"tests/scenarios/S3-query-graph.test.ts","line":[208],"owner":"SQL snapshots写入","value":"手造RunSnapshot","verdict":"F3","note":"调用者本文件"},

  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":[114,124,151,165,177,188,206,215,240],"owner":"buildNoteTools","value":"记录型note端口","verdict":"v2 允许","note":"A7限定文件和适配器用途；沿用首轮"},
  {"section":4,"file":"tests/scenarios/S2C-K-unknown-outcome.test.ts","line":[75,157,179],"owner":"damageKernel","value":"临时Kernel记录JSON损坏","verdict":"v2 允许","note":"SQL41；包含直接及外层调用"},
  {"section":4,"file":"tests/scenarios/S2C-K-retired.test.ts","line":[218,248,298],"owner":"damageKernel移动形式","value":"临时Kernel记录JSON损坏","verdict":"v2 允许","note":"SQL196；包含直接调用、外层调用及damaged实例"},
  {"section":4,"file":"tests/scenarios/K3-44-crr-kind4.test.ts","line":[53],"owner":"createProcessSandboxStandin","value":"executeChecks:false","verdict":"v2 允许","note":"初始化49；复位74"},
  {"section":4,"file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":[50],"owner":"createProcessSandboxStandin","value":"开启命令执行","verdict":"A7 越界","note":"开启185；执行及返回结果在tests/scenarios/support/process-sandbox-standin.ts:59、:64"},
  {"section":4,"file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":[51],"owner":"createProcessSandboxStandin","value":"开启命令执行","verdict":"A7 越界","note":"开启267；超出仅probe范围"}
]
```

v2 允许 174，F1 7，F3 156，A7 越界 2；枚举不完整：A1 其余路由 owner、平台工具、HTTP 封装和别名调用的数据来源及后续路径；F3 全部 helper 间接调用名单、Kernel append 与 body-store 写入的逐项边界核对。