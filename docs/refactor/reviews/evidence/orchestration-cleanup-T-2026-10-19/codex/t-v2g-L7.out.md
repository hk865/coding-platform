**枚举仍不完整，不能用作 wave 2 冻结清单。** 未完成的是 A1 全部直接调用、helper 调用的参数来源和后续路径，以及间接写入调用链的穷尽核对；冻结前要求完整枚举，见 `.lead-ref/books/test-rule-sheet-v2.md:19`。

下面只列当前代码中已经核实的位置，不沿用旧清单的行号。计数按静态调用位置；同一位置的后端参数化不重复计数。文件覆盖数表示已有确定条目或“无实例”结论的文件数，**不表示这些文件已经逐调用穷尽**。

为控制重复，下表和 JSON 的 `file` 均相对 `tests/work-graph/`；helper 路径写全。`同文件:行号` 指该行第一列的文件。“输入允许”不连带豁免内部读取、替身或断言，依据 `.lead-ref/books/test-rule-sheet-v2.md:30`。

1．A1 公开输入

| 文件与行号 | owner | 来源、平台签发字段、后续路径 | 判定 |
|---|---|---|---|
| `A1-architecture-catalog.test.ts:43,68,71,80,175,182,208,229` | `architecture.adoptInitialArchitecture` | helper 手写 baseline、catalog、constraints；无签发字段。构造及调用：`tests/helpers/graph-session-fixture.ts:449,458`。不是全公开链，内部读取见同文件 `:55,184,203,206`。 | v2 允许 |
| `A1-architecture-catalog.test.ts:147,148,221` | 同上 | 手写请求来自同文件 `:34`；无签发字段。并发调用至少一方接受，同文件 `:151`；`:221` 的输入修改发生于调用之后，同文件 `:216`。这些调用后检查返回结果。 | v2 允许 |
| `A1-architecture-catalog.test.ts:59,171,176` | `architecture.readArchitectureRevision` | 手写 `current`；无签发字段。helper：`tests/helpers/graph-session-fixture.ts:461,464`；随后检查公开返回。 | v2 允许 |
| `A1-catalog-independent.test.ts:34,41,60` | `architecture.adoptInitialArchitecture` | 手写请求来自同文件 `:14`；无签发字段。`:34,41` 后检查截获批次，同文件 `:45`；`:60` 后公开读取，同文件 `:77`。 | v2 允许 |
| `A1-catalog-independent.test.ts:77` | `architecture.readArchitectureRevision` | 手写 `current`；无签发字段；随后只检查公开返回，同文件 `:78`。 | v2 允许 |
| `A1-independent-review.test.ts:22,66` | `architecture.adoptInitialArchitecture` | helper 手写架构正文，`tests/helpers/graph-session-fixture.ts:449,458`；无签发字段。后续有内部读取窗口及计数，同文件 `:31,90`。 | v2 允许 |
| `A1-independent-review.test.ts:50` | `architecture.readArchitectureRevision` | 手写 `current`；无签发字段。内部窗口触发另一 owner 修改，同文件 `:39`；随后检查公开返回，同文件 `:54`。 | v2 允许 |
| `A1-independent-review.test.ts:73` | `sessions.linkSessionWork` | target、relation 手写，同文件 `:67,69`；版本来自 store read，`tests/helpers/graph-session-fixture.ts:199,204`；无签发字段。后续内部计数，同文件 `:90`。 | v2 允许 |
| `A1-independent-review.test.ts:82` | `sessions.findSessions` | 手写筛选和 limit；cursor 原样来自前页 `nextCursor`，同文件 `:95`。后续内部计数，同文件 `:90`。 | v2 允许 |
| `A1-session-independent.test.ts:26,55,86,117` | `goals.createGoal`、`plans.proposePlan/readPlanProposal/applyPlanChange` | `seedAcceptedTask` 手写 Goal、计划正文；proposal ref/revision 使用实际返回。helper 已走公开创建、提案、读取、采用：`tests/helpers/graph-session-fixture.ts:403,410,425,431,433`。后续关联请求仍读内部版本，helper `:199,210`。 | v2 允许 |
| `A1-session-lifecycle.test.ts:80,125,272` | 同上 | 同一 `seedAcceptedTask`，来源和公开步骤同上；后续关联及生命周期请求使用内部版本读取，`tests/helpers/graph-session-fixture.ts:199,210`。 | v2 允许 |
| `S5-goal-settings.test.ts:398,410,416,423,501,525,544,577,599,619,637,652,654,669` | `goalSettings.setGoalSettings` | 手写自治、等待目标、版本条件；无签发字段。不是全公开链：快照、事件、receipt 读取在同文件 `:135,125,130`。 | v2 允许 |
| `S5-goal-settings.test.ts:434,456,624,638` | `goalSettings.reorderGoals` | 手写顺序、版本条件；无签发字段。后续内部断言，同文件 `:437,461,643,646`。 | v2 允许 |
| `S5-notices.test.ts:66` | `workspaceDecisionSettings.markNoticesSeen` | token、seenThrough 原样来自公开 page，同文件 `:61`；接受调用在 `:173,192,215,259,269`。内部 pin、存储断言在 `:67,174`，不是全公开链。 | v2 允许 |
| `S2A-notices-counts.test.ts:109,112` | 同上 | token、seenThrough 来自同文件公开 page `:107,110`；helper 原样转交，`tests/helpers/S2A-notices-support.ts:83,88`。helper 内部读取 pin，`:89`。 | v2 允许 |
| `S2A-notices-rework.test.ts:61` | 同上 | token、seenThrough 来自同文件 `:59`；helper 同上，内部 pin 在 helper `:89`。 | v2 允许 |
| `S2A-notices-since.test.ts:104` | 同上 | token、seenThrough 来自同文件 `:102`；helper 同上，内部 pin 在 helper `:89`。 | v2 允许 |
| `S5-user-messages.test.ts:37` | `decisionMessages.sendUserMessage` | 手写 intent/text，同文件 `:31`；options/objects 从已有消息取出，`tests/helpers/S5-user-message-support.ts:82,88`。无签发字段；后续内部事件读取，同文件 `:69`。 | v2 允许 |
| `S5-request-candidates.test.ts:31` | `plans.proposePlan` | 从夹具候选提取 draft，加手写 reason/requestRef，同文件 `:26`；无签发字段。内部 Goal 版本及后续记录读取在 `:32,43,46`。 | v2 允许 |
| `S5-decision-application.test.ts:53` | `decisionMessages.recordDecisionApplication` | receipt 的 identityKey、fingerprint、cursor 从截获 commit **重新构造**，同文件 `:34,39`。后续内部 lookupCommit/eventAt，`:89,92`。 | **F1：v2 A1 平台签发字段，规则 `:32–35`** |
| `S2A-queue-card-semantics.test.ts:78` | 同上 | receipt 从截获 commit 重建，同文件 `:60,63`。之后公开查询队列，`:83`；此前内部 Goal 读取，`:72`。 | **F1：同条款** |
| `S2C-pins.test.ts:58` | `workspaceDecisionSettings.markNoticesSeen` | position 手造，token 在测试中签发，同文件 `:51,52`。随后继续公开 pin/mark 及返回值断言，`:216,222,227,244,254,258`。 | **F1：同条款** |
| `C1-session-mailbox.test.ts:333` | `messages.readInbox` | 将公开 sourceCursor 加 1000 后重建 cursor，同文件 `:332`。返回 `not_ready`，随后断言，`:334`。 | **F1：同条款** |
| `R3c-plan-adoption.test.ts:152` | `plans.queryTaskGraph` | 将 apply 返回 cursor 加 1000 后重建，同文件 `:153`。`not_ready` 后继续查询 ready tasks，`:154,155`。 | **F1：同条款** |
| `R4c-execution-read.test.ts:325,339` | `executions.readExecution` | 将 claim 返回 cursor 加 25 后重建，同文件 `:324,338`。随后检查 `not_ready`，`:326,340`。 | **F1：同条款** |

上述普通请求正文依据 `.lead-ref/books/test-rule-sheet-v2.md:24,28,30` 判输入允许；重建签发字段依据同文件 `:32–35` 判 F1。`not_ready` 条目没有按“成功写入状态”描述。

2．Record-store 测试

| 范围 | 结果 |
|---|---|
| L7 文件清单，`.lead-ref/groups/L7-files.txt:1` 至 `:169` | 没有 `tests/record-store/` 文件；本节无实例。 |

3．Store 以上的 F3

以下每行均判 **F3**，依据 `.lead-ref/books/test-rule-sheet-v2.md:38–43`。特别标出的拒绝探针、拒绝提交是**提交尝试，不是已经落库**。调用文件为第一列文件；共享的 `R3d-fixture.ts` 另列到达它的测试文件。

| 文件与行号 | 写入内容／调用 | helper 或到达它的测试文件 |
|---|---|---|
| `A1-session-independent.test.ts:127` | 克隆 Session，改 ref、Kernel 身份 | `tests/helpers/graph-session-fixture.ts:366` |
| `A2-disposition-change.test.ts:143,156,198,209,220,241,261,641` | scope、治理、Run、Lease、Reduction、ControlIntent | 本文件；`:641` 的 raw helper 为 `tests/helpers/task-claim-fixture.ts:311` |
| `A2-gate-chain-facts.test.ts:275` | foreign VerificationRound | `tests/helpers/task-claim-fixture.ts:311` |
| `A2-step1-codecs.test.ts:161` | 编码后的业务记录、事件 | 本文件 |
| `A2-step1-manifest.test.ts:30` | manifest 正文 | 本文件 |
| `B2-execution-entry.test.ts:31,43` | Lease 提交尝试被拒绝；wrong-contentType 正文 | raw helper：`tests/helpers/task-claim-fixture.ts:311` |
| `B2-execution-result.test.ts:31,105` | SessionWorkLink；改 Lease | `tests/helpers/task-claim-fixture.ts:311` |
| `C1-session-mailbox.test.ts:362,483,513` | 改 Lease、释放 Lease、改 Workspace revision | `tests/helpers/task-claim-fixture.ts:311` |
| `R3a-goal-replay-boundaries.test.ts:44,50,67` | Project/Workspace 初始记录、版本改写 | 本文件 |
| `R3b-material-applicability.test.ts:65,87` | 材料正文；Workspace/Goal/Run/QueryRun | 本文件 |
| `R3c-plan-adoption.test.ts:109` | scope、治理记录 | 本文件 |
| `R3c-plan-entry.test.ts:46` | Project/Workspace | 本文件 |
| `R3c-task-relations.test.ts:93` | scope、治理记录 | 本文件 |
| `R3d-fixture.ts:85` | Project/Workspace | 到达文件：`tests/work-graph/R3d-observed-architecture.test.ts:7`、`tests/work-graph/R3d-observed-boundaries.test.ts:5`、`tests/work-graph/R3d-record-integrity.test.ts:11`、`tests/work-graph/S8A-root-path.test.ts:17`、`tests/app/S8A-architecture-routes.test.ts:26` |
| `R3d-observed-boundaries.test.ts:146` | 只有手工事件的提交 | 本文件 |
| `R3d-record-integrity.test.ts:25` | 导出的 capture 正文 | 本文件 |
| `R3e-reverify.test.ts:254` | Workspace revision | `tests/helpers/task-claim-fixture.ts:311` |
| `R3g-role-spec.test.ts:85,99,178,278,299,314,353,386,397,414,434,451,474,512` | Project、策略矩阵、活动指针及损坏版本 | 本文件 |
| `R4b-session-boundaries.test.ts:63,141,182,220,259` | scope、Session、链接、规模记录；`:182` 为拒绝 schema 提交尝试 | 本文件 |
| `R4b-session-directory.test.ts:85,142` | scope/治理；Goal、已接受 Plan | 本文件 |
| `R4c-execution-history-index.test.ts:775` | TaskLease revision | `tests/helpers/task-claim-fixture.ts:311` |
| `R4c-execution-read.test.ts:452,472,505` | 无关 Project；Run budget/revision | `tests/helpers/task-claim-fixture.ts:311` |
| `R4c-task-claim-boundaries.test.ts:56` | 策略矩阵、活动指针 | `tests/helpers/task-claim-fixture.ts:311` |
| `R4c-task-claim.test.ts:334` | 无关 Project | `tests/helpers/task-claim-fixture.ts:311` |
| `S1-codecs-indexes.test.ts:241` | 旧 DispatchOutboxEntry | 本文件 |
| `S1-session-facts.test.ts:129` | 克隆 Session 关联的执行记录 | `tests/helpers/task-claim-fixture.ts:311` |
| `S2A-queue-goal-runs.test.ts:47` | 克隆 Run | `tests/helpers/S5-decision-fixture.ts:544` |
| `S3-graph-context.test.ts:604` | old-A 正文 | 本文件 |
| `S3-prepared-context-admission.test.ts:248,271,406,531,592,766` | Project/Workspace/治理；old-A、manifest、new-A 正文 | raw helper：`tests/helpers/task-claim-fixture.ts:311`；正文在本文件写入 |
| `S3-role-profiles.test.ts:154` | Project/Workspace | 本文件 |
| `S5-decision-application.test.ts:78` | 只含事件的 scope receipt | 本文件 |
| `S5-goal-cause-at-least-cursor.test.ts:20` | 空 records、手工 seed 事件 | `tests/helpers/S5-decision-fixture.ts:544` |
| `UCR-settle-review.test.ts:85,152,199` | UnknownCallReview 初始、hold、移除活动轮 | 本文件 |
| `W1-future-plan.test.ts:240,254,281,297,306,320,382` | scope/治理、Plan/Goal、Run、Lease、Reduction、额外事件 | 本文件；`commitRaw` 是本地 `seedCommit` 别名，同文件 `:329` |
| `W2-agent-whiteboard.test.ts:324` | 额外 seed 事件 | `tests/helpers/task-claim-fixture.ts:311` |
| `WP2-message-duties.test.ts:94` | 策略矩阵、活动指针 | `tests/helpers/S5-decision-fixture.ts:544` |
| `WP2-undelivered-notices.test.ts:286,292` | Session/Message 非法游标提交尝试，均被拒绝 | `tests/helpers/task-claim-fixture.ts:311` |
| `goal-independent.test.ts:47` | scope seed | 本文件 |
| `material-readers.test.ts:63` | Workspace/Goal/Run/QueryRun | 本文件 |
| `unknown-call-review-list.test.ts:61` | 手造 UnknownCallReview、事件 | 本文件 |
| `A2-disposition-change.test.ts:599` | `seedAgentCandidate` 写 PlanProposal | `tests/helpers/W2-whiteboard-fixture.ts:352` |
| `B2-execution-result.test.ts:98,137` | `overwriteSession` 改 Session | `tests/helpers/task-claim-fixture.ts:471` |
| `B2-execution-entry.test.ts:149,150` | `buildPrepared` 改 manifest 正文 | `tests/helpers/B2-execution-fixture.ts:233` |
| `C1-session-mailbox.test.ts:134,139,145,150,161,166,347` | `commitRun` 改 Run | `tests/helpers/C1-mailbox-fixture.ts:186` |
| `C1-session-mailbox.test.ts:371` | `commitSession` 改 Session | `tests/helpers/C1-mailbox-fixture.ts:199` |
| `R3c-plan-adoption.test.ts:182` | `createB2RuntimeFixture` 写策略 | `tests/helpers/B2-runtime-fixture.ts:204` |
| `R4c-execution-history-index.test.ts:745` | `overwriteSession` | `tests/helpers/task-claim-fixture.ts:471` |
| `R4c-execution-read.test.ts:474` | `overwriteSession` | 同上 |
| `R4c-task-claim-boundaries.test.ts:96` | `overwriteSession` | 同上 |
| `R4c-task-claim.test.ts:265` | `overwriteSession` | 同上 |
| `S2A-queue-request-candidates.test.ts:72` | `seedCandidateProposal` | `tests/helpers/S5-decision-fixture.ts:1119,544` |
| `S2A-queue-derived-cards.test.ts:21` | `buildPlanningQuestions` 写正文 | `tests/helpers/S2A-planning-fixture.ts:91` |
| `S2B-30-track-bars.test.ts:337,339,342` | `submitAndFinishQuery` 写正文 | `tests/helpers/S2B-track-fixture.ts:613` |
| `S2B-r2-keyed-cap.test.ts:68` | `seedActivityRun` | `tests/helpers/S2B-r2-activity-support.ts:69` |
| `S2B-r2-never-entered.test.ts:32` | `seedActivityRun` | 同上 |
| `S2B-r2-r5-not-entered.test.ts:39,54` | `seedRawRunVariant` | `tests/helpers/S2B-r2-track-support.ts:75` |
| `S2B-r4-session-workspace.test.ts:46,66` | 克隆 Session 到另一 Workspace | `tests/helpers/S2B-r3-r4-support.ts:39` |
| `S2B-r4-session-workspace.test.ts:48` | `seedRawRunVariant` | `tests/helpers/S2B-r2-track-support.ts:75` |
| `S2B-r4-session-workspace.test.ts:68` | `seedActivityRun` | `tests/helpers/S2B-r2-activity-support.ts:69` |
| `S2B-r2-v-real-runs.test.ts:64,96,127,158` | 创建夹具时写策略 | `tests/helpers/S2B-be1-platform-fixture.ts:208` |
| `S2B-r3-consultation-cap.test.ts:46` | `submitAndFinishQuery` 写正文 | `tests/helpers/S2B-track-fixture.ts:613` |
| `S2C-lines-copies.test.ts:56,102` | `completeConsultation(answered)` 写正文 | `tests/helpers/S2C-L-runs-support.ts:420` |
| `S2C-lines-latest-generation.test.ts:50,64,66` | 同上 | 同上 |
| `S2C-lines-page.test.ts:66,75,77,145,165,191` | 同上 | 同上 |
| `S2C-lines-scale.test.ts:43` | `buildScaleFixture` 写 picker/historical Run、回答正文 | `tests/helpers/S2C-X-scale-fixture.ts:405,427,440`；`tests/helpers/S2C-L-runs-support.ts:420` |
| `S5-decision-queue.test.ts:93,228` | `answeredPlanningQuestion` 写正文 | `tests/helpers/S5-queue-support.ts:237` |
| `W2-agent-whiteboard.test.ts:192,213,384,464` | `seedAgentCandidate` | `tests/helpers/W2-whiteboard-fixture.ts:352` |
| `WP1-goal-content-entry.test.ts:66,106` | `makeUnboundGoalPrepared` 改 manifest 正文 | `tests/helpers/WP1-entry-fixture.ts:289` |
| `WP2-context-extensions.test.ts:319` | `seedCandidateProposal` | `tests/helpers/S5-decision-fixture.ts:1119,544` |
| `WP2-undelivered-notices.test.ts:136` | `q.answer()` 写正文 | `tests/helpers/WP2-notices-fixture.ts:211` |
| `S2B-r2-activity-run-ended-at.test.ts:52` | 创建夹具时写策略 | `tests/helpers/S2B-runtime-store-fixture.ts:75` → `tests/helpers/B2-runtime-fixture.ts:204` |
| `C1-session-mailbox.test.ts:462` | SQL `UPDATE artifacts` 损坏正文 JSON | 正文库打开于同文件 `:461`；不是 A7 的临时 Kernel 库 |
| `R4c-execution-history-index.test.ts:974` | SQL 改事件 `recorded.runRevision=999` | ledger 打开于同文件 `:966`；SQL 在 `:973` |
| `S5-decision-application.test.ts:143,166,197,201,220,222,240,242,262,265,277,296,306,318,323,376,379,388,390,401,403,416,422,428,431,450,453` | `storeSnapshot` 的手写 claims/event 拒绝探针；未落库 | `tests/helpers/S5-decision-fixture.ts:1075,1079,1084`，仅 memory 分支 |
| `S5-decision-queue.test.ts:238,251,277,290` | 同上 | 同上 |
| `S5-goal-settings.test.ts:135,308,312,357,397,414,419,425,428,433,445,448,500,505,509,548,556,564,579,582,610,613,634,643,658,676,681,688,692` | 同上 | 同上 |
| `S5-notices.test.ts:186,190,207,231,235,237` | 同上 | 同上 |
| `S5-request-candidates.test.ts:59,71,81,101,115,137,168,183,196,212,215,225,230,234,259,263,277,283,298,302` | 同上 | 同上 |
| `S5-user-messages.test.ts:81,94,104,106,114,122,130,132,137,139,154,168,173,175,190,199,220,225,229,240,245,259,263` | 同上 | 同上 |
| `S5R2-queue-history.test.ts:131,135,144,148,164,166,181,183,226,241` | 同上 | 同上 |
| `S5-decision-queue.test.ts:239,252,278,291` | `modelRequestCounts` 间接执行上述拒绝探针 | `tests/helpers/S5-queue-support.ts:80` → `tests/helpers/S5-decision-fixture.ts:1079` |
| `S5-notices.test.ts:187,191` | 同上 | 同上 |
| `S5R2-queue-history.test.ts:130,137` | 同上 | 同上 |
| `S5R2-queue-history.test.ts:40,54,65,86` | `expectClosedQ1` 间接执行上述拒绝探针 | `tests/helpers/S5R2-a-support.ts:125,134` → `tests/helpers/S5-decision-fixture.ts:1079` |

4．A7

| 指定 helper | L7 结果及边界 |
|---|---|
| `buildNoteTools` | L7 及已展开 helper 中未发现调用；许可仅限指定 adapter 测试，`.lead-ref/books/test-rule-sheet-v2.md:45–49`。 |
| `damageKernel` | L7 及已展开 helper 中未发现调用；许可仅限两个指定文件、临时 Kernel 库，规则 `:50–58`。上表正文库和 ledger SQL 改写不属于该许可。 |
| `process-sandbox-standin` / `executeChecks` | L7 及已展开 helper 中未发现使用；边界为 `executeChecks:false`、不执行检查或返回结果，规则 `:59–64`。 |

无实例：以下文件未发现本题四类实例；这不等于对其他规则作合规结论。

- `tests/work-graph/B2-07-crr-card-pure.test.ts:16`
- `tests/work-graph/B2-11-blocked-commands-bytes-pure.test.ts:10`
- `tests/work-graph/B2-12-recognition-pure.test.ts:61`
- `tests/work-graph/B2-command-rerun-request-event-pure.test.ts:11`
- `tests/work-graph/R3c-canonical-task-state.test.ts:22`
- `tests/work-graph/R3c-task-graph.test.ts:12`
- `tests/work-graph/R3c-task-relations-boundaries.test.ts:72`

以下 91 个文件已列入分组比对，但还没有完成可交付的逐调用判定，**不能放进“无实例”**。位置是待核入口，不是违规判定；路径同样相对 `tests/work-graph/`：

- `A1-session-discovery.test.ts:33`；`A2-control-service.test.ts:57`；`A2-entry-plan.test.ts:181`；`A2-goal-control.test.ts:80`；`A2-requeue-service.test.ts:117`；`A2-verification-chain.test.ts:151`。
- `B2-01-blocked-commands.test.ts:1`；`B2-01-task-read.test.ts:1`；`B2-03-crr-request.test.ts:66`；`B2-07-crr-card-closed.test.ts:120`；`B2-07-crr-card.test.ts:1`；`B2-08-crr-answer.test.ts:35`；`B2-08-crr-cancel.test.ts:36`；`B2-09-answer-replay.test.ts:35`；`B2-09-crr-owner.test.ts:103`。
- `B2-11-expansion-levels.test.ts:46`；`B2-11-script-expansion.test.ts:37`；`B2-12-recognition.test.ts:140`；`B2-12-rewrite-prefix.test.ts:1`；`B2-14-crr-forms.test.ts:55`；`B2-17-disposition-reads.test.ts:1`；`B2-18-request-reads.test.ts:166`；`B2-UR7-crr-answer.test.ts:127`；`B2-model-request.test.ts:1`。
- `C2-mailbox-admission.test.ts:31`；`R3d-observed-architecture.test.ts:21`；`R3e-completion.test.ts:81`；`R3e-evidence-coverage.test.ts:1`；`R3e-evidence.test.ts:97`；`R4-control-intent.test.ts:61`；`R4c-source-authority-reader.test.ts:110`；`R4c-task-claim-concurrency.test.ts:23`。
- `R5a-project-bootstrap.test.ts:105`；`R5b-initial-plan.test.ts:144`；`R5b-query-execution.test.ts:87`；`R5b-query-job.test.ts:108`；`RL-32b-rework-notice-memory-cap.test.ts:105`。
- `S1-anomaly-owner.test.ts:156`；`S1-archive-owner.test.ts:27`；`S1-dispatch-guards.test.ts:41`；`S1-provenance.test.ts:109`；`S1-requeue.test.ts:38`；`S1-responsibility.test.ts:160`；`S1-wait-disposal.test.ts:30`。
- `S2A-notices-attempt.test.ts:1`；`S2A-notices-overbound.test.ts:1`；`S2A-notices-workspace.test.ts:1`；`S2A-queue-bounds.test.ts:1`；`S2A-queue-window.test.ts:20`。
- `S2B-31-task-timeline-main.test.ts:23`；`S2B-32-task-timeline-fold.test.ts:57`；`S2B-33-task-timeline-pagination.test.ts:24`；`S2B-34-executed-files.test.ts:209`；`S2B-activity-calendar-tasks.test.ts:84`；`S2B-activity-calendar.test.ts:278`；`S2B-activity-read-faults.test.ts:80`。
- `S2B-r2-27-moving-window.test.ts:81`；`S2B-r2-calendar-boundaries.test.ts:1`；`S2B-r2-calendar-same-task.test.ts:1`；`S2B-r2-conflict-catalog.test.ts:78`；`S2B-r2-r3-track-pagination.test.ts:1`；`S2B-r2-r4-bound-workspace.test.ts:32`；`S2B-r2-r7-keyed-read-cap.test.ts:53`；`S2B-r2-s-preentry-control.test.ts:27`；`S2B-r2-s-yielded.test.ts:79`；`S2B-r2-workspace-binding.test.ts:41`；`S2B-run-activity-read.test.ts:61`。
- `S2C-lines-attention.test.ts:32`；`S2C-lines-controls.test.ts:38`；`S2C-lines-conversation.test.ts:56`；`S2C-lines-counts.test.ts:35`；`S2C-lines-d1.test.ts:34`；`S2C-lines-done-evidence.test.ts:42`；`S2C-lines-failure.test.ts:68`；`S2C-lines-identification.test.ts:41`；`S2C-lines-names.test.ts:34`。
- `S2C-lines-paused-continue.test.ts:40`；`S2C-lines-read-only.test.ts:95`；`S2C-lines-task-anchors.test.ts:32`；`S2C-lines-tiers.test.ts:35`；`S2C-lines-waiting-reply.test.ts:35`；`S2C-lines-walk.test.ts:70`。
- `S2C-node-detail-anomalies.test.ts:103`；`S2C-node-detail-bounded.test.ts:84`；`S2C-node-detail-executions.test.ts:22`；`S2C-node-detail-hover.test.ts:23`；`S2C-node-detail-next-kinds.test.ts:47`；`S2C-node-detail-task.test.ts:25`。
- `S3-context-inputs.test.ts:296`；`W2-future-intent.test.ts:87`；`WP1-context-anomalies.test.ts:1`。

JSON 中每个 `line` 数组元素计一个位置；路径前缀约定与表格相同。

```json
[
  {"section":"A1","file":"A1-architecture-catalog.test.ts","line":[43,68,71,80,175,182,208,229],"owner":"architecture.adoptInitialArchitecture","value":"helper 手写架构正文，无签发字段","verdict":"v2 允许","note":"tests/helpers/graph-session-fixture.ts:449,458；后续内部读取本文件:55,184,203,206"},
  {"section":"A1","file":"A1-architecture-catalog.test.ts","line":[147,148,221],"owner":"architecture.adoptInitialArchitecture","value":"手写 catalog 请求，无签发字段","verdict":"v2 允许","note":"来源本文件:34；并发接受:151；调用后修改:216；后续检查返回"},
  {"section":"A1","file":"A1-architecture-catalog.test.ts","line":[59,171,176],"owner":"architecture.readArchitectureRevision","value":"手写 current，无签发字段","verdict":"v2 允许","note":"tests/helpers/graph-session-fixture.ts:461,464；后续公开返回断言"},
  {"section":"A1","file":"A1-catalog-independent.test.ts","line":[34,41,60],"owner":"architecture.adoptInitialArchitecture","value":"手写架构请求，无签发字段","verdict":"v2 允许","note":"来源本文件:14；内部批次断言:45；公开读:77"},
  {"section":"A1","file":"A1-catalog-independent.test.ts","line":[77],"owner":"architecture.readArchitectureRevision","value":"手写 current，无签发字段","verdict":"v2 允许","note":"后续公开返回断言本文件:78"},
  {"section":"A1","file":"A1-independent-review.test.ts","line":[22,66],"owner":"architecture.adoptInitialArchitecture","value":"helper 手写架构正文，无签发字段","verdict":"v2 允许","note":"tests/helpers/graph-session-fixture.ts:449,458；非全公开，本文件:31,90"},
  {"section":"A1","file":"A1-independent-review.test.ts","line":[50],"owner":"architecture.readArchitectureRevision","value":"手写 current，无签发字段","verdict":"v2 允许","note":"内部窗口修改本文件:39；后续返回断言:54"},
  {"section":"A1","file":"A1-independent-review.test.ts","line":[73],"owner":"sessions.linkSessionWork","value":"手写 target/relation，内部读取版本，无签发字段","verdict":"v2 允许","note":"tests/helpers/graph-session-fixture.ts:199,204；后续内部计数本文件:90"},
  {"section":"A1","file":"A1-independent-review.test.ts","line":[82],"owner":"sessions.findSessions","value":"手写筛选；cursor 原样取前页","verdict":"v2 允许","note":"cursor 来源本文件:95；内部计数:90"},
  {"section":"A1","file":"A1-session-independent.test.ts","line":[26,55,86,117],"owner":"goals.createGoal / plans.proposePlan/readPlanProposal/applyPlanChange","value":"seedAcceptedTask 手写 Goal/计划；proposal 字段取实际返回","verdict":"v2 允许","note":"tests/helpers/graph-session-fixture.ts:403,410,425,431,433；后续内部 pin 读取:199,210"},
  {"section":"A1","file":"A1-session-lifecycle.test.ts","line":[80,125,272],"owner":"goals.createGoal / plans.proposePlan/readPlanProposal/applyPlanChange","value":"seedAcceptedTask 手写 Goal/计划；proposal 字段取实际返回","verdict":"v2 允许","note":"tests/helpers/graph-session-fixture.ts:403,410,425,431,433；后续内部 pin 读取:199,210"},
  {"section":"A1","file":"S5-goal-settings.test.ts","line":[398,410,416,423,501,525,544,577,599,619,637,652,654,669],"owner":"goalSettings.setGoalSettings","value":"手写自治、等待目标、版本条件；无签发字段","verdict":"v2 允许","note":"非全公开；本文件:125,130,135"},
  {"section":"A1","file":"S5-goal-settings.test.ts","line":[434,456,624,638],"owner":"goalSettings.reorderGoals","value":"手写顺序、版本条件；无签发字段","verdict":"v2 允许","note":"非全公开；本文件:437,461,643,646"},
  {"section":"A1","file":"S5-notices.test.ts","line":[66],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"token、seenThrough 原样取公开页面","verdict":"v2 允许","note":"来源本文件:61；接受调用:173,192,215,259,269；内部读取:67,174"},
  {"section":"A1","file":"S2A-notices-counts.test.ts","line":[109,112],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"token、seenThrough 原样取公开页面","verdict":"v2 允许","note":"来源本文件:107,110；tests/helpers/S2A-notices-support.ts:83,88；内部 pin:89"},
  {"section":"A1","file":"S2A-notices-rework.test.ts","line":[61],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"token、seenThrough 原样取公开页面","verdict":"v2 允许","note":"来源本文件:59；tests/helpers/S2A-notices-support.ts:83,88；内部 pin:89"},
  {"section":"A1","file":"S2A-notices-since.test.ts","line":[104],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"token、seenThrough 原样取公开页面","verdict":"v2 允许","note":"来源本文件:102；tests/helpers/S2A-notices-support.ts:83,88；内部 pin:89"},
  {"section":"A1","file":"S5-user-messages.test.ts","line":[37],"owner":"decisionMessages.sendUserMessage","value":"手写 intent/text；options/objects 从已有消息取出；无签发字段","verdict":"v2 允许","note":"本文件:31；tests/helpers/S5-user-message-support.ts:82,88；后续内部 eventAt 本文件:69"},
  {"section":"A1","file":"S5-request-candidates.test.ts","line":[31],"owner":"plans.proposePlan","value":"候选 draft 加手写 reason/requestRef；无签发字段","verdict":"v2 允许","note":"来源本文件:26；内部版本和记录读取:32,43,46"},
  {"section":"A1","file":"S5-decision-application.test.ts","line":[53],"owner":"decisionMessages.recordDecisionApplication","value":"截获 commit 重建 receipt、fingerprint、cursor","verdict":"F1","note":"v2:32–35；来源本文件:34,39；内部后续:89,92"},
  {"section":"A1","file":"S2A-queue-card-semantics.test.ts","line":[78],"owner":"decisionMessages.recordDecisionApplication","value":"截获 commit 重建 receipt","verdict":"F1","note":"v2:32–35；来源本文件:60,63；内部 Goal:72；公开后续:83"},
  {"section":"A1","file":"S2C-pins.test.ts","line":[58],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"手造 position、自行签发 token","verdict":"F1","note":"v2:32–35；来源本文件:51,52；公开后续:216,222,227,244,254,258"},
  {"section":"A1","file":"C1-session-mailbox.test.ts","line":[333],"owner":"messages.readInbox","value":"公开 sourceCursor 加 1000 重建 cursor","verdict":"F1","note":"v2:32–35；来源本文件:332；not_ready 断言:334"},
  {"section":"A1","file":"R3c-plan-adoption.test.ts","line":[152],"owner":"plans.queryTaskGraph","value":"apply.cursor 加 1000 重建 cursor","verdict":"F1","note":"v2:32–35；来源本文件:153；后续:154,155"},
  {"section":"A1","file":"R4c-execution-read.test.ts","line":[325,339],"owner":"executions.readExecution","value":"claimResult.cursor 加 25 重建 cursor","verdict":"F1","note":"v2:32–35；来源本文件:324,338；后续:326,340"},

  {"section":"F3","file":"A1-session-independent.test.ts","line":[127],"owner":"RecordStore","value":"克隆 Session、改 Kernel 身份","verdict":"F3","note":"本文件调用；tests/helpers/graph-session-fixture.ts:366"},
  {"section":"F3","file":"A2-disposition-change.test.ts","line":[143,156,198,209,220,241,261,641],"owner":"RecordStore","value":"scope、治理、Run、Lease、Reduction、ControlIntent","verdict":"F3","note":"本文件；641 调用 tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"A2-gate-chain-facts.test.ts","line":[275],"owner":"RecordStore","value":"foreign VerificationRound","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"A2-step1-codecs.test.ts","line":[161],"owner":"RecordStore","value":"编码业务记录、事件","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"A2-step1-manifest.test.ts","line":[30],"owner":"RawArtifactStore","value":"manifest 正文","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"B2-execution-entry.test.ts","line":[31,43],"owner":"RecordStore/RawArtifactStore","value":"Lease 拒绝提交尝试；wrong-contentType 正文","verdict":"F3","note":"raw helper tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"B2-execution-result.test.ts","line":[31,105],"owner":"RecordStore","value":"SessionWorkLink；改 Lease","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"C1-session-mailbox.test.ts","line":[362,483,513],"owner":"RecordStore","value":"改 Lease、释放 Lease、改 Workspace revision","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"R3a-goal-replay-boundaries.test.ts","line":[44,50,67],"owner":"RecordStore","value":"Project/Workspace 初始及改版本","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R3b-material-applicability.test.ts","line":[65,87],"owner":"RecordStore/RawArtifactStore","value":"材料正文；Workspace/Goal/Run/QueryRun","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R3c-plan-adoption.test.ts","line":[109],"owner":"RecordStore","value":"scope、治理记录","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R3c-plan-entry.test.ts","line":[46],"owner":"RecordStore","value":"Project/Workspace","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R3c-task-relations.test.ts","line":[93],"owner":"RecordStore","value":"scope、治理记录","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R3d-fixture.ts","line":[85],"owner":"RecordStore","value":"Project/Workspace","verdict":"F3","note":"调用：tests/work-graph/R3d-observed-architecture.test.ts:7、R3d-observed-boundaries.test.ts:5、R3d-record-integrity.test.ts:11、S8A-root-path.test.ts:17；tests/app/S8A-architecture-routes.test.ts:26"},
  {"section":"F3","file":"R3d-observed-boundaries.test.ts","line":[146],"owner":"RecordStore","value":"手工事件提交","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R3d-record-integrity.test.ts","line":[25],"owner":"RawArtifactStore","value":"导出的 capture 正文","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R3e-reverify.test.ts","line":[254],"owner":"RecordStore","value":"Workspace revision","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"R3g-role-spec.test.ts","line":[85,99,178,278,299,314,353,386,397,414,434,451,474,512],"owner":"RecordStore","value":"Project、策略矩阵、活动指针及损坏版本","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R4b-session-boundaries.test.ts","line":[63,141,182,220,259],"owner":"RecordStore","value":"scope、Session、链接、规模记录及拒绝 schema 提交尝试","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R4b-session-directory.test.ts","line":[85,142],"owner":"RecordStore","value":"scope/治理；Goal、已接受 Plan","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"R4c-execution-history-index.test.ts","line":[775],"owner":"RecordStore","value":"TaskLease revision","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"R4c-execution-read.test.ts","line":[452,472,505],"owner":"RecordStore","value":"无关 Project；Run budget/revision","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"R4c-task-claim-boundaries.test.ts","line":[56],"owner":"RecordStore","value":"策略矩阵、活动指针","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"R4c-task-claim.test.ts","line":[334],"owner":"RecordStore","value":"无关 Project","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"S1-codecs-indexes.test.ts","line":[241],"owner":"RecordStore","value":"旧 DispatchOutboxEntry","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"S1-session-facts.test.ts","line":[129],"owner":"RecordStore","value":"克隆 Session 关联执行记录","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"S2A-queue-goal-runs.test.ts","line":[47],"owner":"RecordStore","value":"克隆 Run","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:544"},
  {"section":"F3","file":"S3-graph-context.test.ts","line":[604],"owner":"RawArtifactStore","value":"old-A 正文","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"S3-prepared-context-admission.test.ts","line":[248,271,406,531,592,766],"owner":"RecordStore/RawArtifactStore","value":"Project/Workspace/治理；old-A、manifest、new-A 正文","verdict":"F3","note":"raw helper tests/helpers/task-claim-fixture.ts:311；正文在本文件写入"},
  {"section":"F3","file":"S3-role-profiles.test.ts","line":[154],"owner":"RecordStore","value":"Project/Workspace","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"S5-decision-application.test.ts","line":[78],"owner":"RecordStore","value":"只含事件的 scope receipt","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"S5-goal-cause-at-least-cursor.test.ts","line":[20],"owner":"RecordStore","value":"空 records、手工 seed 事件","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:544"},
  {"section":"F3","file":"UCR-settle-review.test.ts","line":[85,152,199],"owner":"RecordStore","value":"UnknownCallReview 初始、hold、移除活动轮","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"W1-future-plan.test.ts","line":[240,254,281,297,306,320,382],"owner":"RecordStore","value":"scope/治理、Plan/Goal、Run、Lease、Reduction、额外事件","verdict":"F3","note":"本文件；commitRaw 本地别名见:329"},
  {"section":"F3","file":"W2-agent-whiteboard.test.ts","line":[324],"owner":"RecordStore","value":"额外 seed 事件","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"WP2-message-duties.test.ts","line":[94],"owner":"RecordStore","value":"策略矩阵、活动指针","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:544"},
  {"section":"F3","file":"WP2-undelivered-notices.test.ts","line":[286,292],"owner":"RecordStore","value":"Session/Message 非法游标提交尝试，被拒绝","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:311"},
  {"section":"F3","file":"goal-independent.test.ts","line":[47],"owner":"RecordStore","value":"scope seed","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"material-readers.test.ts","line":[63],"owner":"RecordStore","value":"Workspace/Goal/Run/QueryRun","verdict":"F3","note":"调用文件：本文件"},
  {"section":"F3","file":"unknown-call-review-list.test.ts","line":[61],"owner":"RecordStore","value":"UnknownCallReview、事件","verdict":"F3","note":"调用文件：本文件"},

  {"section":"F3","file":"A2-disposition-change.test.ts","line":[599],"owner":"RecordStore","value":"seedAgentCandidate 写 PlanProposal","verdict":"F3","note":"本文件调用；tests/helpers/W2-whiteboard-fixture.ts:352"},
  {"section":"F3","file":"B2-execution-result.test.ts","line":[98,137],"owner":"RecordStore","value":"overwriteSession","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:471"},
  {"section":"F3","file":"B2-execution-entry.test.ts","line":[149,150],"owner":"RawArtifactStore","value":"buildPrepared 改 manifest","verdict":"F3","note":"本文件调用；tests/helpers/B2-execution-fixture.ts:233"},
  {"section":"F3","file":"C1-session-mailbox.test.ts","line":[134,139,145,150,161,166,347],"owner":"RecordStore","value":"commitRun","verdict":"F3","note":"本文件调用；tests/helpers/C1-mailbox-fixture.ts:186"},
  {"section":"F3","file":"C1-session-mailbox.test.ts","line":[371],"owner":"RecordStore","value":"commitSession","verdict":"F3","note":"本文件调用；tests/helpers/C1-mailbox-fixture.ts:199"},
  {"section":"F3","file":"R3c-plan-adoption.test.ts","line":[182],"owner":"RecordStore","value":"createB2RuntimeFixture 写策略","verdict":"F3","note":"本文件调用；tests/helpers/B2-runtime-fixture.ts:204"},
  {"section":"F3","file":"R4c-execution-history-index.test.ts","line":[745],"owner":"RecordStore","value":"overwriteSession","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:471"},
  {"section":"F3","file":"R4c-execution-read.test.ts","line":[474],"owner":"RecordStore","value":"overwriteSession","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:471"},
  {"section":"F3","file":"R4c-task-claim-boundaries.test.ts","line":[96],"owner":"RecordStore","value":"overwriteSession","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:471"},
  {"section":"F3","file":"R4c-task-claim.test.ts","line":[265],"owner":"RecordStore","value":"overwriteSession","verdict":"F3","note":"本文件调用；tests/helpers/task-claim-fixture.ts:471"},
  {"section":"F3","file":"S2A-queue-request-candidates.test.ts","line":[72],"owner":"RecordStore","value":"seedCandidateProposal","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1119,544"},
  {"section":"F3","file":"S2A-queue-derived-cards.test.ts","line":[21],"owner":"RawArtifactStore","value":"buildPlanningQuestions 写正文","verdict":"F3","note":"本文件调用；tests/helpers/S2A-planning-fixture.ts:91"},
  {"section":"F3","file":"S2B-30-track-bars.test.ts","line":[337,339,342],"owner":"RawArtifactStore","value":"submitAndFinishQuery 写正文","verdict":"F3","note":"本文件调用；tests/helpers/S2B-track-fixture.ts:613"},
  {"section":"F3","file":"S2B-r2-keyed-cap.test.ts","line":[68],"owner":"RecordStore","value":"seedActivityRun","verdict":"F3","note":"本文件调用；tests/helpers/S2B-r2-activity-support.ts:69"},
  {"section":"F3","file":"S2B-r2-never-entered.test.ts","line":[32],"owner":"RecordStore","value":"seedActivityRun","verdict":"F3","note":"本文件调用；tests/helpers/S2B-r2-activity-support.ts:69"},
  {"section":"F3","file":"S2B-r2-r5-not-entered.test.ts","line":[39,54],"owner":"RecordStore","value":"seedRawRunVariant","verdict":"F3","note":"本文件调用；tests/helpers/S2B-r2-track-support.ts:75"},
  {"section":"F3","file":"S2B-r4-session-workspace.test.ts","line":[46,66],"owner":"RecordStore","value":"跨 Workspace 克隆 Session","verdict":"F3","note":"本文件调用；tests/helpers/S2B-r3-r4-support.ts:39"},
  {"section":"F3","file":"S2B-r4-session-workspace.test.ts","line":[48],"owner":"RecordStore","value":"seedRawRunVariant","verdict":"F3","note":"本文件调用；tests/helpers/S2B-r2-track-support.ts:75"},
  {"section":"F3","file":"S2B-r4-session-workspace.test.ts","line":[68],"owner":"RecordStore","value":"seedActivityRun","verdict":"F3","note":"本文件调用；tests/helpers/S2B-r2-activity-support.ts:69"},
  {"section":"F3","file":"S2B-r2-v-real-runs.test.ts","line":[64,96,127,158],"owner":"RecordStore","value":"创建夹具时写策略","verdict":"F3","note":"本文件调用；tests/helpers/S2B-be1-platform-fixture.ts:208"},
  {"section":"F3","file":"S2B-r3-consultation-cap.test.ts","line":[46],"owner":"RawArtifactStore","value":"submitAndFinishQuery 写正文","verdict":"F3","note":"本文件调用；tests/helpers/S2B-track-fixture.ts:613"},
  {"section":"F3","file":"S2C-lines-copies.test.ts","line":[56,102],"owner":"RawArtifactStore","value":"completeConsultation(answered) 写正文","verdict":"F3","note":"本文件调用；tests/helpers/S2C-L-runs-support.ts:420"},
  {"section":"F3","file":"S2C-lines-latest-generation.test.ts","line":[50,64,66],"owner":"RawArtifactStore","value":"completeConsultation(answered) 写正文","verdict":"F3","note":"本文件调用；tests/helpers/S2C-L-runs-support.ts:420"},
  {"section":"F3","file":"S2C-lines-page.test.ts","line":[66,75,77,145,165,191],"owner":"RawArtifactStore","value":"completeConsultation(answered) 写正文","verdict":"F3","note":"本文件调用；tests/helpers/S2C-L-runs-support.ts:420"},
  {"section":"F3","file":"S2C-lines-scale.test.ts","line":[43],"owner":"RecordStore/RawArtifactStore","value":"buildScaleFixture 写 Run、正文","verdict":"F3","note":"本文件调用；tests/helpers/S2C-X-scale-fixture.ts:405,427,440；tests/helpers/S2C-L-runs-support.ts:420"},
  {"section":"F3","file":"S5-decision-queue.test.ts","line":[93,228],"owner":"RawArtifactStore","value":"answeredPlanningQuestion 写正文","verdict":"F3","note":"本文件调用；tests/helpers/S5-queue-support.ts:237"},
  {"section":"F3","file":"W2-agent-whiteboard.test.ts","line":[192,213,384,464],"owner":"RecordStore","value":"seedAgentCandidate","verdict":"F3","note":"本文件调用；tests/helpers/W2-whiteboard-fixture.ts:352"},
  {"section":"F3","file":"WP1-goal-content-entry.test.ts","line":[66,106],"owner":"RawArtifactStore","value":"makeUnboundGoalPrepared 改 manifest","verdict":"F3","note":"本文件调用；tests/helpers/WP1-entry-fixture.ts:289"},
  {"section":"F3","file":"WP2-context-extensions.test.ts","line":[319],"owner":"RecordStore","value":"seedCandidateProposal","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1119,544"},
  {"section":"F3","file":"WP2-undelivered-notices.test.ts","line":[136],"owner":"RawArtifactStore","value":"q.answer 写正文","verdict":"F3","note":"本文件调用；tests/helpers/WP2-notices-fixture.ts:211"},
  {"section":"F3","file":"S2B-r2-activity-run-ended-at.test.ts","line":[52],"owner":"RecordStore","value":"创建夹具时写策略","verdict":"F3","note":"本文件调用；tests/helpers/S2B-runtime-store-fixture.ts:75 → tests/helpers/B2-runtime-fixture.ts:204"},
  {"section":"F3","file":"C1-session-mailbox.test.ts","line":[462],"owner":"SQLite body store","value":"UPDATE artifacts 损坏正文 JSON","verdict":"F3","note":"正文库打开于本文件:461；非 A7 Kernel 库"},
  {"section":"F3","file":"R4c-execution-history-index.test.ts","line":[974],"owner":"SQLite ledger","value":"UPDATE events 改 recorded.runRevision","verdict":"F3","note":"ledger 本文件:966；SQL:973"},

  {"section":"F3","file":"S5-decision-application.test.ts","line":[143,166,197,201,220,222,240,242,262,265,277,296,306,318,323,376,379,388,390,401,403,416,422,428,431,450,453],"owner":"RecordStore","value":"storeSnapshot 手写 claims/event 拒绝探针，未落库","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1075,1079,1084；仅 memory"},
  {"section":"F3","file":"S5-decision-queue.test.ts","line":[238,251,277,290],"owner":"RecordStore","value":"storeSnapshot 拒绝探针，未落库","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1075,1079,1084；仅 memory"},
  {"section":"F3","file":"S5-goal-settings.test.ts","line":[135,308,312,357,397,414,419,425,428,433,445,448,500,505,509,548,556,564,579,582,610,613,634,643,658,676,681,688,692],"owner":"RecordStore","value":"storeSnapshot 拒绝探针，未落库","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1075,1079,1084；仅 memory"},
  {"section":"F3","file":"S5-notices.test.ts","line":[186,190,207,231,235,237],"owner":"RecordStore","value":"storeSnapshot 拒绝探针，未落库","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1075,1079,1084；仅 memory"},
  {"section":"F3","file":"S5-request-candidates.test.ts","line":[59,71,81,101,115,137,168,183,196,212,215,225,230,234,259,263,277,283,298,302],"owner":"RecordStore","value":"storeSnapshot 拒绝探针，未落库","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1075,1079,1084；仅 memory"},
  {"section":"F3","file":"S5-user-messages.test.ts","line":[81,94,104,106,114,122,130,132,137,139,154,168,173,175,190,199,220,225,229,240,245,259,263],"owner":"RecordStore","value":"storeSnapshot 拒绝探针，未落库","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1075,1079,1084；仅 memory"},
  {"section":"F3","file":"S5R2-queue-history.test.ts","line":[131,135,144,148,164,166,181,183,226,241],"owner":"RecordStore","value":"storeSnapshot 拒绝探针，未落库","verdict":"F3","note":"本文件调用；tests/helpers/S5-decision-fixture.ts:1075,1079,1084；仅 memory"},
  {"section":"F3","file":"S5-decision-queue.test.ts","line":[239,252,278,291],"owner":"RecordStore","value":"modelRequestCounts 间接执行拒绝探针","verdict":"F3","note":"tests/helpers/S5-queue-support.ts:80 → tests/helpers/S5-decision-fixture.ts:1079"},
  {"section":"F3","file":"S5-notices.test.ts","line":[187,191],"owner":"RecordStore","value":"modelRequestCounts 间接执行拒绝探针","verdict":"F3","note":"tests/helpers/S5-queue-support.ts:80 → tests/helpers/S5-decision-fixture.ts:1079"},
  {"section":"F3","file":"S5R2-queue-history.test.ts","line":[130,137],"owner":"RecordStore","value":"modelRequestCounts 间接执行拒绝探针","verdict":"F3","note":"tests/helpers/S5-queue-support.ts:80 → tests/helpers/S5-decision-fixture.ts:1079"},
  {"section":"F3","file":"S5R2-queue-history.test.ts","line":[40,54,65,86],"owner":"RecordStore","value":"expectClosedQ1 间接执行拒绝探针","verdict":"F3","note":"tests/helpers/S5R2-a-support.ts:125,134 → tests/helpers/S5-decision-fixture.ts:1079"}
]
```

v2 允许 55，F1 7，F3 280，A7 越界 0，文件 78/169；枚举不完整：A1 全部直接及 helper 调用的来源、后续路径尚未穷尽，间接写入调用链尚未完全闭合，上列 91 个文件仍缺逐调用判定。