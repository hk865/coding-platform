审计结论：**G5 不通过 v1 规则。** 已逐行读完 17 个文件，共 2,824 行；89 个测试定义，展开 `.each` 后为 101 个用例。没有修改文件，没有运行测试或构建。下文的检查敏感性都是静态判断，不是变异测试结果。

为保持每个实例一行，路径采用以下缩写：

- `W/`＝`tests/work-graph/`
- `H/`＝`tests/helpers/`
- `P/`＝`src/core/work-graph/tasks/`
- `ST/`＝`src/core/work-graph/state/`
- `V/`＝`src/core/work-graph/views/`
- `C/`＝`src/core/work-graph/communication/`
- `B/`＝`src/business/workflow/`
- `R/`＝`src/core/agent-runtime/`
- `SPEC`＝`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`

计数口径：按不同源位置的违规构造计数；一个共享 helper 的同一构造不因调用次数重复计数。一个端口对象算一个 F4 实例，包含它的各个返回分支。包含 G5 使用的非 T helper；T 项另列，不计入末行数字。表中的“服务场景”指 ROWS 中后端不是“无”的测试。

**1. COVERAGE**

共享依赖的独立判定如下；后面的文件行引用这些判定，不把“调用了真实 owner”当作整条前置链合规的证明。

| helper | 独立判定 |
|---|---|
| `openK3ReviewCardWorld`，`H/K3-review-card-fixture.ts:127` | F1：手写 Plan draft 被接受，`:115`；F4：Kernel 事实替身、工作区替身、简化识别器和 duties 替身，`:139`、`:162`、`:200`、`:245`；还进入 S5 的 F1/F2/F3 前置链，`:131`。 |
| `openS5DecisionFixture`，`H/S5-decision-fixture.ts:459` | F1/F2/F3；具体实例见 FINDINGS，不能以“冻结的旧夹具”豁免；A7 为空，`.lead-ref/test-rule-sheet.md:52`。 |
| `createTaskClaimFixture`，`H/task-claim-fixture.ts:160` | F1/F3/F4：手写 Plan、直接提交初始事实、代 Runtime 创建 Session、材料替身，`:301`、`:233`、`:324`、`:327`、`:245`。 |
| `openRealRunHarness` 的共享接续链，`H/K3-35-continuation-fixture.ts:443` | A1：真实 prepare/start、RUN-20→RUN-22、真实工作树 capture；A4：共享同一个内存后端；这是规则明确接受的路径，`.lead-ref/test-rule-sheet.md:26`、`:38`；它不为调用者另加的伪 digest 或 S5 原始 seed 开豁免。 |
| `prepareContinuation`，`H/K3-35-prepare.ts:58`；`createK3_35Runtime`，`H/K3-35-runtime.ts:120` | A1：调用生产准备器与 Runtime；准备结果来自 `preparation.prepare`，`H/K3-35-prepare.ts:93`，不是手造 prepared。 |
| `createScriptedModel`，`H/B2-runtime-fixture.ts:69` | A1：脚本模型回复；该文件其他问题属于 T，不能把 T 身份转给调用者。 |
| `shellSeam`，`H/K3-tool-seams.ts:79`；`mailboxToolSeam`，`:132` | A2：在指定工具处理点挂起；阻塞接缝符合 `SPEC:1392`；`waitForCall`，`:52`，是可用的门，不是睡眠。这里只接受挂起用途，不把它们当作真实命令执行结果的证明。 |
| `openK3BlockedCommandWorld`，`H/K3-blocked-command-fixture.ts:520`；`openK3BlockedReviewServices`，`:395` | F2/F4/F6/F9：Host 返回值覆盖、手写工作区端口、凭空结算 unavailable、睡眠轮询，`:146`、`:406`、`:367`、`:350`。 |
| `sha256Of`，`H/K3-blocked-command-fixture.ts:114` | A5：独立 `node:crypto` 运算；可以用于手算例子的散列，不能替生产规范化函数背书。 |
| `createK3PendingReview`，`H/K3-proposal-round.ts:255` | A1 的 RUN-20→RUN-22 步骤；整体仍继承 `openK3ReviewCardWorld` 的前置链问题。 |
| `readK3Review`，`H/K3-proposal-round.ts:277`；`readK3ReviewCard`，`:620` | A1：公开读。 |
| `settleK3Review`，`H/K3-proposal-round.ts:588` | 已有真实轮次结束后结算可走 A1；G5 直接指定 `review_unavailable` 的调用是 F6，不能仅凭真实 owner 接受而放行。 |
| `claimK3ReviewRound`，`H/K3-proposal-round.ts:383` | F2/F9：覆盖 Host 返回值，`:431`；睡眠等 entered，`:356`。 |
| `endK3RunCompleted`，`H/K3-proposal-round.ts:526` | A1：释放模型门并等真实 Run 结束。 |
| `writeK3Proposals`，`H/K3-proposal-round.ts:744` | 默认进入 F3：构造 Kernel ToolCall 后直接执行 handler，`:705`、`:708`，并没有由脚本模型在真实轮次中发出这个调用。 |
| `blockedRecord`／`blockedRecordWithClaim`，`H/B2-crr-world.ts:100`、`:111` | RUN-20→RUN-22 部分 A1；默认处置分支进入 F6 的 `settleUnavailable`，`:193`。 |
| `requeueBlockedRecord`，`H/B2-crr-world.ts:178` | A1：调用共享 harness 的真实 requeue，`:183`。 |
| `realKernelCommandReaderOf`，`H/B2-crr-world.ts:206` | A1：生产 Kernel reader 读取同一个 Kernel store，`:211`。 |
| `crrCardOf`，`H/B2-crr-world.ts:253` | A1：公开卡片源分页读。 |
| `requestRerunOf`，`H/B2-crr-world.ts:233` | owner 调用形状是 A1；但前置 `workRunCtx` 使用原始 store 读，`:226`，不是完整合规的公开读 helper。 |
| `runSnapshotOf`，`H/B2-crr-world.ts:215` | 不符合 A1 的公开读要求：直接 `records.readMany`，`:216`；这里不把所有此类前置读都硬算作 F7，因为部分用途只是构造上下文。 |
| `crrSourceOf`，`H/B2-crr-world.ts:262` | 用来手算身份 key 可作 A5；用作答复来源时不合规：固定 `pins: []`，`:265`，实际导致本组的双错误拒绝用例。 |
| `setK3TaskDisposition`，`H/K3-review-card-fixture.ts:329` | F1：从读出的 Plan 手造新 draft 后交 owner 接受，`:338`、`:353`；v1 没有“Plan draft”例外。 |
| `openCrrWorld`，`H/K3-crr-fixture.ts:52` | F4：工作区内容由 map 返回，`:121`；`createContinuationRun` 另有假 root、固定 digest 等替身，`:154`、`:157`。计数和失败提交包装本身为 A3/A2，`:82`。 |
| `createBlockedRecord`，`H/K3-prefix-claim.ts:59` | 继承 blocked helper 的 F2/F4/F6/F9；注入 Run ID 本身是 A1 公共输入。 |
| `requeueAfterRun`，`H/K3-prefix-claim.ts:85` | F4：假 root、固定 digest、材料和消息替身，`:93`、`:96`、`:97`、`:99`。 |
| `workRunContextOf`，`H/K3-prefix-claim.ts:122` | 从真实读出的 Run 取身份，没有改写 Run；但 helper 接受完整 Run 的接口仍不符合 v1“只收公共输入”的严格接口要求。 |
| `failNextApplicationCommit`，`H/K3-review-card-fixture.ts:217` | A2：包装真实 store，在指定的 ③ 提交失败，其他调用委托原依赖。 |

| 文件 | 测试定义／展开用例 | 全读 | 命中规则 | 本文件调用的 helper 及判定 | 最后一个测试标题 |
|---|---:|---|---|---|---|
| `W/B2-01-blocked-commands.test.ts:1` | 5／6 | 是，180 行 | F1、F2、F3、F4、F6、F8、F9 | `migrateWorld:51`→blocked world，F2/F4/F6/F9；`byAlias:58` A5；`keyOf:49`、`sha256Of` A5；`claimK3ReviewRound` F2/F9；`writeK3Proposals` F3；`endK3RunCompleted` A1；`settleK3Review` 依真实结束原因判定；shell/mailbox seam A2；共享前置链 F1/F2/F3/F4 | `approve writes the ORIGINAL commands of proposalTargets, never the proposals`，`:148` |
| `W/B2-01-task-read.test.ts:1` | 1／2 | 是，108 行 | F1、F2、F3、F4、F6、F8 | `needsDecision:44` F6；`listByTask:53` A1；`createK3PendingReview` A1 路径；`settleK3Review` 此处 F6；`openK3ReviewCardWorld` F1/F2/F3/F4；shell seam A2 | `(%s) pages to the task record when another status page supplies the last raw window record`，`:76` |
| `W/B2-03-crr-request.test.ts:1` | 6／6 | 是，189 行 | F1、F2、F3、F4、F6、F8、F9 | `request:30`、`listAll:49`、`answer:64` A1 形状；`openCrrWorld` F4 并继承 blocked 问题；`createContinuationRun` F4；`crrCardOf` A1；shell seam A2 | `rewriteOf must name this task and a blocked alias, otherwise invalid`，`:160` |
| `W/B2-07-crr-card-closed.test.ts:1` | 3／4 | 是，175 行 | F1、F2、F3、F4、F6、F10 | `openK3ReviewCardWorld` F1/F2/F3/F4；`setK3TaskDisposition` F1；`blockedRecord`／`blockedRecordWithClaim` F6；`requeueBlockedRecord`、`realKernelCommandReaderOf`、`crrCardOf` A1；`requestRerunOf` 有非公开前置读；`crrSourceOf` 本处只算 key，A5；`:71` 失败包装 A2；`:141` 委托包装 A3，但计数范围 F10；shell seam A2 | `B2-07: the Task card page reads the canonical closure exactly once per operation`，`:98` |
| `W/B2-07-crr-card.test.ts:1` | 4／4 | 是，184 行 | F1、F2、F3、F4、F6、F8、F11 | `openK3ReviewCardWorld` F1/F2/F3/F4；`blockedRecord` F6；`crrCardOf` A1；`requestRerunOf`／`runSnapshotOf` 有非公开读；renderer 调用不符合当前混合文件的 A5；shell seam A2 | `B2-07: the queue advertises the source as available and the card stays in waiting_answer`，`:171` |
| `W/B2-08-crr-answer.test.ts:1` | 3／5 | 是，121 行 | F1、F2、F3、F4、F6、F7、F11 | `ctxOf:31` A1 上下文转交；`answerCrr:33`、`pauseGoal:41` A1；`setK3TaskDisposition` F1；`crrSourceOf` 此处不符合 A6，且造成 F11；其他共享 helper 同上；shell seam A2 | `B2-08: a Task that is no longer active closes the request and refuses the answer`，`:101` |
| `W/B2-08-crr-cancel.test.ts:1` | 1／1 | 是，70 行 | F1、F2、F3、F4、F6、F11 | `openK3ReviewCardWorld` F1/F2/F3/F4；`setK3TaskDisposition` F1；`blockedRecord` F6；`crrCardOf` A1；`requestRerunOf` 有非公开前置读；shell seam A2 | `B2-08: cancelling the Task closes a pending request, moves the card to history and voids an unused allowance`，`:30` |
| `W/B2-09-answer-replay.test.ts:1` | 1／1 | 是，58 行 | F1、F2、F3、F4、F6 | `ask:35`、`crrCardOf` A1；`blockedRecord` F6；`openK3ReviewCardWorld` F1/F2/F3/F4；`requestRerunOf` 有非公开前置读；shell seam A2；重放比较本身符合裁定 §3.1 | `B2-09: the same answer replayed applies the request once and records the application once`，`:28` |
| `W/B2-09-crr-owner.test.ts:1` | 16／16 | 是，411 行 | F1、F2、F3、F4、F6、F7、F8、F11 | `openCrr:63` F4/F6；`request:149` A1 形状；`commit:161` 仅检查返回值；`answerRef:166`＋`answer:169` F3；`setClosed:143` F4；提交失败包装 `:94` A2/A3；closure failure `:121` 没有包装真实 closure reader，非 A2；共享 world 同上；shell seam A2 | `a closure read failure makes the task list unavailable, never open`，`:402` |
| `W/B2-11-expansion-levels.test.ts:1` | 9／9 | 是，184 行 | F4、F11；另有 A5 文件隔离违规 | `sha:21`、`keyOf:22`、`bytes:23`、`pkg:42` A5；`actionsOf:25` 是生产 parser 的调用输入，不是期望值；`reader:31` F4；`blockedCommandsBytes` 的两个纯测试须独立文件 | `counts actions, expansions, bases and truncated too`，`:176` |
| `W/B2-11-script-expansion.test.ts:1` | 15／22 | 是，200 行 | F4；另有 A5 文件隔离违规 | `sha:14`、`keyOf:15`、`digestOf:16`、`pkg:37` A5；`expand:20` 的 `readFile:26` F4，不能以“纯展开 helper”命名豁免 | `clips scriptText to 2,048 UTF-8 bytes but keys come from the untruncated body`，`:191` |
| `W/B2-12-recognition.test.ts:1` | 9／9 | 是，246 行 | F1、F2、F3、F4、F6；另有 A5 文件隔离违规 | `sha:35`、`keyOf:36` A5；`record:46`、`request:67` 只可用于隔离纯测试；`workspace:76` F4；`:228` 失败替身非 A2；最后一例的 world、settle 同上；公开 Kernel reader 链 A1；shell seam A2 | `creates a declared request through the real owner when package.json cannot be read`，`:192` |
| `W/B2-12-rewrite-prefix.test.ts:1` | 4／4 | 是，188 行 | F1、F2、F3、F4、F6、F8、F9 | `twoRecords:52` 继承 prefix/blocked 问题；`createBlockedRecord` F2/F4/F6/F9；`requeueAfterRun` F4；`request:79`、`listAll:93` A1 形状；`workRunContextOf` 接口不符合严格 A1；`sha256Of` A5；shell seam A2 | `the same record with a non-blocked alias is invalid`，`:172` |
| `W/B2-14-crr-forms.test.ts:1` | 6／6 | 是，164 行 | F1、F2、F3、F4、F6、F8、F9 | `requestDeclared:31`、`requestAny:41`、`answer:52` A1 形状；`openCrrWorld` F4 并继承 blocked 问题；`crrCardOf` A1；shell seam A2 | `a declared rewrite against a same-Run deny appends then refuses denied_in_this_run`，`:151` |
| `W/B2-17-disposition-reads.test.ts:1` | 3／3 | 是，77 行 | F1、F2、F3、F4、F6、F9、F11 | `pkg:28` A5；`appliedOf:30` A1 形状；`openK3BlockedCommandWorld` F2/F4/F6/F9 及共享前置问题；shell seam A2 | `counts the budget per blocked command (the same file read once per command)`，`:62` |
| `W/B2-18-request-reads.test.ts:1` | 2／2 | 是，199 行 | F1、F2、F3、F4、F6、F9、F10 | `committed:56` 仅检查返回值；`realBlockedRun:69` F6 及 blocked 问题；`workCtxOf:86` 从公开 execution 读构造身份；`:100` 包装本身 A3；`:112`、`:114`、`:146`、`:148` F4；`crrCardOf` A1；shell seam A2 | `no-write branches say not_written and are not reported as committed`，`:137` |
| `W/B2-UR7-crr-answer.test.ts:1` | 1／1 | 是，70 行 | F1、F2、F3、F4、F6、F11 | `failNextApplicationCommit` A2；`crrCardOf` A1；`blockedRecord` F6；world 共享问题同上；两次直接 `advanceReviewDisposition` 不能证明 Workflow，`:49`、`:61`；shell seam A2 | `UR7: a failed ③ is repaired by advanceReviewDisposition through ② replay and one ③`，`:29` |

UNREAD：无 G5 文件。

**2. FINDINGS by rule**

以下处置名称用于避免重复写同一段修复说明；每个实例只选择一个处置。

| 处置名称 | 唯一处置内容 |
|---|---|
| 公开初始化 | **helper missing**：只接收项目、目标、任务名称及脚本回复，经平台公开创建、提计划、采用计划、创建 Session 的流程产生前置事实；不得继续调用原始 seed、接受测试手写事实或代 Runtime 写入。 |
| 真实文件 | **helper missing**：将输入文件写到该 world 的真实工作区，把生产 `WorkspaceToolsPort.readWorkspace` 接到 owner／识别器，计数仅包装真实读口；目录样例放在这个工作区内。现有 `openK3BlockedReviewServices`，`H/K3-blocked-command-fixture.ts:395`，需要改到此形状后才能使用。 |
| 真实接续 | 使用 `requeueBlockedRecord`，`H/B2-crr-world.ts:178`，进入 `openRealRunHarness` 的真实工作树 capture，`H/K3-35-continuation-fixture.ts:491`，再 claim／prepare／start。 |
| 真实不可用 | **helper missing**：缩窄真实 Host 的只读命令授权，经 `workflow.advanceWork` 使 `reviewCapability` 返回不可用，再由 Workflow 选择结算；生产选择点为 `B/workflow.ts:1485`、`:1491`。 |
| 真实答复 | 使用公开卡片来源后调用 `resolveDecision`；已有正确调用形状为 `W/B2-03-crr-request.test.ts:64`；答复必须实际保存，不能自造 `SessionMessageRef`。 |
| 真实消费 | **helper missing**：真实答复允许后，让脚本模型发出真实 `shell` 调用，由生产 before-tool hook 调 `consumeAllowance`；调用和放行检查为 `R/execution-driver.ts:500`、`:509`。 |
| 独立期望 | 保留公开场景；用 `sha256Of`，`H/K3-blocked-command-fixture.ts:114`，对规格给定的规范化文字或手写 JSON 求散列；文字直接写 `SPEC:535` 的固定原文，不调用生产格式化、规范化或排序函数生成期望。 |

F1：

| 实例 | 位置、测试标题／范围、原因 | 唯一处置 |
|---|---|---|
| F1-01 | `H/task-claim-fixture.ts:301`｜全部服务场景的初始化｜测试手写 `PlanRevisionDraft`，`:280`，被 owner 接受后继续使用；不在 A6。 | 公开初始化。 |
| F1-02 | `H/S5-decision-fixture.ts:586`｜全部服务场景的初始化｜`adoptInitial` 接收并提交测试构造的 draft，`:585`。 | 公开初始化。 |
| F1-03 | `H/S5-decision-fixture.ts:736`｜全部服务场景的初始化｜`authorizeRuntimeEntry` 接受测试 `buildPrepared` 返回的 envelope／manifest／permit，`:698`、`:728`。 | 用 `prepareContinuation`，`H/K3-35-prepare.ts:58`，及真实 Runtime start 产生 entry。 |
| F1-04 | `H/K3-review-card-fixture.ts:115`｜全部服务场景的初始化｜`extendPlan` 手造第二版 draft 后提交，`:101`；“真实 Plan owner”不能豁免 F1。 | 公开初始化。 |
| F1-05 | `H/K3-review-card-fixture.ts:353`｜“a %s Task closes…”、“a Task that is no longer active…”、“cancelling the Task…”｜手造带新 disposition 的 draft，`:338`、`:341`，再采用。 | **helper missing**：经真实计划交互产生并采用任务取消／替代变更，只接收 taskId 与用户意图。 |

F2：

| 实例 | 位置、测试标题／范围、原因 | 唯一处置 |
|---|---|---|
| F2-01 | `H/K3-blocked-command-fixture.ts:146`｜使用 blocked world 的场景｜读 Host 配置后 spread 并强制覆盖 `shellWorkspaceAccess`。 | **helper missing**：在真实 Host 创建选项中声明权限，再原样委托配置读。 |
| F2-02 | `H/K3-proposal-round.ts:431`｜“approve writes the ORIGINAL commands…”｜读配置后补写 `readonlyCommandAccess`；现有正常配置已经给该值，`H/K3-35-runtime.ts:94`。 | 删除这个覆盖包装；权限由 `k3_35Configuration`，`H/K3-35-runtime.ts:75`，声明。 |
| F2-03 | `H/S5-decision-fixture.ts:904`｜全部服务场景的初始化｜把手写 sent message spread 成 responded message，改 revision/status/readAt/response。 | 真实答复。 |
| F2-04 | `W/B2-07-crr-card.test.ts:124`｜“earlier requests are the ones created before this one, newest first, at most 5”｜复制真实请求并改 ID、时间。 | 移到 `W/B2-07-crr-card-pure.test.ts`，直接给 `commandRerunRequestCardFacts` 构造纯输入。 |
| F2-05 | `W/B2-07-crr-card.test.ts:126`｜同上｜批量复制真实请求，改 ID、command、时间和状态。 | 移到 `W/B2-07-crr-card-pure.test.ts`，测 `commandRerunRequestCardFacts`。 |
| F2-06 | `W/B2-07-crr-card.test.ts:131`｜同上｜复制真实请求构造“later”记录。 | 移到 `W/B2-07-crr-card-pure.test.ts`，测 `commandRerunRequestCardFacts`。 |
| F2-07 | `W/B2-07-crr-card.test.ts:157`｜同上｜再覆盖 sibling 的 ID、command、时间构造 tieA。 | 移到 `W/B2-07-crr-card-pure.test.ts`，测 `commandRerunRequestSummary`；同时间顺序须先按 OPEN QUESTIONS 裁定。 |
| F2-08 | `W/B2-07-crr-card.test.ts:159`｜同上｜再覆盖 sibling 构造 tieZ。 | 移到 `W/B2-07-crr-card-pure.test.ts`，测 `commandRerunRequestSummary`；同时间顺序须先裁定。 |
| F2-09 | `W/B2-08-crr-cancel.test.ts:60`｜“cancelling the Task…”｜spread 旧 card.source，只换 key，继续带旧来源字段。 | **helper missing**：从公开当前请求／历史卡读取完整当前来源，不覆盖旧读结果。 |

F3：

| 实例 | 位置、测试标题／范围、原因 | 唯一处置 |
|---|---|---|
| F3-01 | `H/task-claim-fixture.ts:233`｜全部服务场景初始化｜直接向 backend 提交 scope/governance。 | 公开初始化。 |
| F3-02 | `H/task-claim-fixture.ts:324`｜全部服务场景初始化｜直接打开 Kernel store 创建 Session 记录。 | 公开初始化。 |
| F3-03 | `H/task-claim-fixture.ts:327`｜全部服务场景初始化｜代 Runtime 调 `recordSessionCreated`，Kernel 标识由测试指定。 | 公开初始化。 |
| F3-04 | `H/S5-decision-fixture.ts:543`｜全部服务场景初始化｜直接 seed Project/Workspace。 | 公开初始化。 |
| F3-05 | `H/S5-decision-fixture.ts:568`｜全部服务场景初始化｜直接 seed governance。 | 公开初始化。 |
| F3-06 | `H/S5-decision-fixture.ts:574`｜全部服务场景初始化｜直接 seed 三个 Goal 的指定 revision/settings。 | 公开初始化。 |
| F3-07 | `H/S5-decision-fixture.ts:630`｜全部服务场景初始化及后续 Session 创建｜直接创建 Kernel Session。 | 公开初始化。 |
| F3-08 | `H/S5-decision-fixture.ts:632`｜同上｜代 Runtime 写 `recordSessionCreated`。 | 公开初始化。 |
| F3-09 | `H/S5-decision-fixture.ts:715`｜全部服务场景初始化｜直接写手造 manifest body。 | 使用 `prepareContinuation`，`H/K3-35-prepare.ts:58`。 |
| F3-10 | `H/S5-decision-fixture.ts:739`｜全部服务场景初始化｜手指定 Kernel run/turn 后调用 `beginRuntimeEntry`。 | 使用真实 `createK3_35Runtime`，`H/K3-35-runtime.ts:120`，驱动 start。 |
| F3-11 | `H/S5-decision-fixture.ts:742`｜全部服务场景初始化｜直接写 entered，位置 3、起点 2 等来自测试，`:744`。 | 使用真实 Runtime start，`H/K3-35-runtime.ts:120`。 |
| F3-12 | `H/S5-decision-fixture.ts:816`｜全部服务场景初始化｜直接写 U1/U2 proposal、唯一 claim 和事件。 | 公开初始化。 |
| F3-13 | `H/S5-decision-fixture.ts:869`｜全部服务场景初始化｜手写消息 envelope 到 body store。 | **helper missing**：经真实消息工具发送正文，经公开答复入口保存响应。 |
| F3-14 | `H/S5-decision-fixture.ts:881`｜全部服务场景初始化｜直接 seed pending DecisionMessage 和 sent event。 | **helper missing**：脚本模型调用真实消息工具创建该消息。 |
| F3-15 | `H/S5-decision-fixture.ts:892`｜全部服务场景初始化｜直接 seed 第二条 sent message。 | **helper missing**：脚本模型调用真实消息工具创建该消息。 |
| F3-16 | `H/S5-decision-fixture.ts:906`｜全部服务场景初始化｜直接提交 responded message 和 responded event。 | 真实答复。 |
| F3-17 | `W/B2-09-crr-owner.test.ts:171`｜“applying the same answer twice…”、“a moved request…”、“consumeAllowance…”及所有调用本地 `answer` 的行｜直接 applyAnswer，答复消息引用由 `answerRef:166` 手造，未保存真实答复。 | 真实答复。 |
| F3-18 | `W/B2-09-crr-owner.test.ts:230`｜“consumeAllowance records usedBy and commits the used event with no proof”｜直接消费，`call-7` 没有真实 shell 调用，`:229`。 | 真实消费。 |
| F3-19 | `W/B2-09-crr-owner.test.ts:253`｜“a failed allowance commit leaves the allowance untouched and rejects the call”｜直接消费，`call-8` 由测试指定。 | 真实消费，并在同一真实提交点注入失败。 |
| F3-20 | `W/B2-09-crr-owner.test.ts:382`｜“consumeAllowance on a closed Task rejects and voids the allowance”｜直接消费，`closed-call` 由测试指定。 | 真实消费；任务关闭也由公开步骤产生。 |
| F3-21 | `H/K3-proposal-round.ts:708`｜“approve writes the ORIGINAL commands…”｜直接执行真实工具 handler，但 ToolCall 和 callId 是 helper 构造的，`:705`；没有真实模型调用事实。 | **helper missing**：把 `propose_safer_method` 参数放入该 proposal Run 的脚本模型回复，由 Runtime/Kernel 执行工具。 |

F4：

| 实例 | 位置、测试标题／范围、原因 | 唯一处置 |
|---|---|---|
| F4-01 | `H/task-claim-fixture.ts:245`｜全部服务场景初始化｜材料端口固定返回 unsupported；不是对真实依赖的失败包装。 | 公开初始化，并接生产材料服务。 |
| F4-02 | `H/K3-review-card-fixture.ts:139`｜world 默认分支；本组默认打开 world 的 task-read、rewrite-prefix｜Kernel reader 从测试 map 返回事实；本组部分路径未调用该分支，不能因此称 helper 合规。 | 全部改用现有 `realKernelCommandFacts: true` 分支，`:150`。 |
| F4-03 | `H/K3-review-card-fixture.ts:162`｜使用 review world 的服务场景｜工作区读固定返回 not_found，没有真实文件读。 | 真实文件。 |
| F4-04 | `H/K3-review-card-fixture.ts:200`｜卡片、答复、重放、prefix 等场景｜另写 exact-only 识别器，生成 match；绕过共享生产识别规则。 | 真实文件，并接 `createCommandRecognizer`，`P/command-recognition.ts:30`，作为唯一识别器。 |
| F4-05 | `H/K3-review-card-fixture.ts:245`｜review world 的消息接线｜duties、readOnlyCopy、independentReview、guards 由替身返回。 | **helper missing**：接真实 duties reader，角色／职责由公开配置产生。 |
| F4-06 | `H/K3-blocked-command-fixture.ts:165`｜“a platform-only skip_as_done…”｜空邮箱替身返回手写空页和 `c0000000000`，`:167`。 | 使用真实邮箱选项；按裁定 `.lead-ref/k3-b3-rulings-v1.md:33` 接真实 mailbox。 |
| F4-07 | `H/K3-blocked-command-fixture.ts:406`｜blocked world 所有文件展开／读数场景｜从内存 map 返回 WorkspaceFile，包括 digest、版本、readAt；并绕过真实路径授权。 | 真实文件。 |
| F4-08 | `H/K3-crr-fixture.ts:121`｜B2-03、B2-14 全部测试｜识别器工作区端口返回手造 WorkspaceFile。 | 真实文件。 |
| F4-09 | `H/K3-crr-fixture.ts:154`｜“deny in this Run…another Run may ask again”｜requeue 的根固定为 `/tmp/k3-crr-fixture`，不是该 world 的根。 | 真实接续。 |
| F4-10 | `H/K3-crr-fixture.ts:157`｜同上｜`captureDigest` 固定返回 64 个 a；裁定 §3.4 已明确为 F4。 | 真实接续。 |
| F4-11 | `H/K3-crr-fixture.ts:158`｜同上｜材料方法用固定 throw 替代真实材料服务；当前无材料分支并不豁免 helper。 | 真实接续，使用其生产材料服务，`H/K3-35-continuation-fixture.ts:483`。 |
| F4-12 | `H/K3-crr-fixture.ts:160`｜同上｜消息读固定返回 not_found。 | **helper missing**：在真实接续接线中使用真实消息读口。 |
| F4-13 | `H/K3-prefix-claim.ts:93`｜rewrite-prefix 四个测试｜requeue 使用固定假 root。 | 真实接续。 |
| F4-14 | `H/K3-prefix-claim.ts:96`｜同上｜固定 source digest；裁定 §3.4 已明确为 F4。 | 真实接续。 |
| F4-15 | `H/K3-prefix-claim.ts:97`｜同上｜材料方法固定 throw，没有真实依赖包装。 | 真实接续，使用 `H/K3-35-continuation-fixture.ts:483` 的材料服务。 |
| F4-16 | `H/K3-prefix-claim.ts:99`｜同上｜消息读固定 not_found。 | **helper missing**：接真实消息读口。 |
| F4-17 | `W/B2-09-crr-owner.test.ts:121`｜该文件全部测试，尤其六个 closure 测试｜closure 来自 `active.closed`，`:127`；`setClosed` 可以任意翻转，`:143`；失败分支也没有委托真实 reader。 | **helper missing**：公开关闭任务后使用生产 `readTaskClosure`，`P/plan-readers.ts:1941`；失败用包装它的 A2 故障。 |
| F4-18 | `W/B2-09-crr-owner.test.ts:130`｜该文件全部测试的识别接线｜工作区读固定 not_found。 | 真实文件。 |
| F4-19 | `W/B2-11-expansion-levels.test.ts:31`｜前七个展开测试｜`reader` 从 map 返回正文／digest 或手造 unavailable；该调用不是无端口纯函数。 | 真实文件，经公开 ② 保存展开后断言。 |
| F4-20 | `W/B2-11-script-expansion.test.ts:26`｜该文件全部 22 个展开用例｜`readFile` 返回 map 值或手造 unavailable。 | 真实文件，经公开 ② 保存展开后断言。 |
| F4-21 | `W/B2-12-recognition.test.ts:87`｜前五个排序／匹配测试｜构造 records/requests，又接 `workspace({})` 替身；当前文件还导入 store、Runtime 和 owner。 | 移到 `W/B2-12-recognition-pure.test.ts`，调用无工作区依赖的 `createCommandRecognizer({})`，只保留纯输入和纯断言。 |
| F4-22 | `W/B2-12-recognition.test.ts:159`｜“matches the CURRENT package.json expansion and names the current script”｜当前文件由替身返回，`:76`，没有真实文件状态。 | 真实文件。 |
| F4-23 | `W/B2-12-recognition.test.ts:171`｜“loses only the current expansion when the workspace read fails…”｜`workspace('throws')` 是独立失败替身，不是包装真实 reader。 | 真实文件，并包装生产工作区 reader 在该读点失败。 |
| F4-24 | `W/B2-12-recognition.test.ts:183`｜“matches a declared form even when the package.json read fails”｜同样使用独立 throw 替身。 | 真实文件，并包装生产工作区 reader 在该读点失败。 |
| F4-25 | `W/B2-12-recognition.test.ts:228`｜“creates a declared request through the real owner when package.json cannot be read”｜独立工作区端口总是 throw，不是 A2 所要求的真实依赖包装。 | 真实文件，并在生产 reader 上注入失败。 |
| F4-26 | `W/B2-18-request-reads.test.ts:112`｜“listRequests issues exactly one physical page…”｜`listTaskReviews` 固定返回 `[record]`；这次 list 调用未用它，但 helper 接线仍为替身。 | 删除该测试专用替身，使用真实 owner 接线。 |
| F4-27 | `W/B2-18-request-reads.test.ts:114`｜同上｜识别器固定返回 null。 | 删除该测试专用替身，使用真实 owner 接线。 |
| F4-28 | `W/B2-18-request-reads.test.ts:146`｜“no-write branches say not_written…”｜用早先捕获的 `[record]` 替代每次真实任务记录读。 | 使用 `readTaskReviews` 的公开分页形状，`H/K3-crr-fixture.ts:105`，原样取得当前记录。 |
| F4-29 | `W/B2-18-request-reads.test.ts:148`｜同上｜工作区读固定 not_found。 | 真实文件。 |

F5：本组没有确认实例；有真实请求重试原因的重放不按 F5 计。

F6：

| 实例 | 位置、测试标题／范围、原因 | 唯一处置 |
|---|---|---|
| F6-01 | `W/B2-01-task-read.test.ts:50`｜“pages to the task record…”｜没有 capability 失败，直接写 `review_unavailable`。 | 真实不可用。 |
| F6-02 | `W/B2-09-crr-owner.test.ts:70`｜该文件全部测试｜前置 setup 直接指定 unavailable 原因。 | 真实不可用。 |
| F6-03 | `W/B2-12-recognition.test.ts:199`｜“creates a declared request through the real owner…”｜直接指定 unavailable 原因。 | 真实不可用。 |
| F6-04 | `W/B2-18-request-reads.test.ts:78`｜该文件两个测试｜读到 pending 后由测试决定写 unavailable。 | 真实不可用。 |
| F6-05 | `H/B2-crr-world.ts:193`｜卡片、答复、取消、重放及 UR7 的 `blockedRecord` 前置链｜`settleUnavailable` 直接写失败，`:194`，没有失败的真实依赖。 | 真实不可用。 |
| F6-06 | `H/K3-blocked-command-fixture.ts:367`｜blocked world 场景｜从 pending 直接结算为 unavailable；没有经过 capability 判断。 | 真实不可用。 |

F7：

| 实例 | 位置、测试标题、原因 | 唯一处置 |
|---|---|---|
| F7-01 | `W/B2-08-crr-answer.test.ts:72`｜“%s writes the request state and the proof on the changed event”，三种选项｜直接 `eventAt` 后解码并断言 change/proof/acknowledgement/pins，`:75`、`:78`、`:82`。 | 将事件编码形状移到 `W/B2-command-rerun-request-event-pure.test.ts`，测 `encodeCommandRerunRequestChangedEvent`／`commandRerunRequestChangedEventFromEvent`；服务场景保留公开答复和公开请求状态断言，`:64`、`:70`。 |
| F7-02 | `W/B2-09-crr-owner.test.ts:238`｜“consumeAllowance records usedBy and commits the used event with no proof”｜直接读事件，断言 used 无 proof，`:244`、`:245`。 | 将事件形状移到同一个 `W/B2-command-rerun-request-event-pure.test.ts`，测上述 codec；usedBy 状态由真实消费后的公开 `readRequest` 断言。 |

F8：

| 实例 | 位置、测试标题、原因 | 唯一处置 |
|---|---|---|
| F8-01 | `W/B2-01-blocked-commands.test.ts:77`｜“skip_as_done writes the parsed action…”｜期望 hash 调生产 `commandSha256`。 | 独立期望。 |
| F8-02 | `W/B2-01-blocked-commands.test.ts:110`｜“all-irrelevant (or unparsed) commands…”｜两个期望 hash 都调生产规范化。 | 独立期望。 |
| F8-03 | `W/B2-01-blocked-commands.test.ts:130`｜“a platform-only skip_as_done…”｜期望 argumentsDigest 使用生产 `canonicalJson`。 | 独立期望，手写此固定参数的 canonical JSON。 |
| F8-04 | `W/B2-01-blocked-commands.test.ts:169`｜“approve writes the ORIGINAL commands…”｜原命令期望 hash 来自生产函数。 | 独立期望。 |
| F8-05 | `W/B2-01-blocked-commands.test.ts:170`｜同上｜排除用的 proposal hashes 也由生产函数计算。 | 独立期望，以脚本给出的 proposal 文字计算。 |
| F8-06 | `W/B2-01-task-read.test.ts:93`｜“pages to the task record…”｜用生产 ref-key codec 和 comparator 选择期望目标，`:94`，而不是固定手算目标。 | 保留 `listByTask:53` 公开路径；**helper missing**：注入已知排序的 Run ID，直接断言事先指定的 targetRecord。 |
| F8-07 | `W/B2-03-crr-request.test.ts:89`｜“a blocked command creates one pending request…”｜期望 command hash 调生产函数。 | 独立期望。 |
| F8-08 | `W/B2-07-crr-card.test.ts:51`｜“an exact rerun request produces…”｜固定句期望导入 src 常量。 | 独立期望，写 `SPEC:535` 原文。 |
| F8-09 | `W/B2-07-crr-card.test.ts:58`｜同上｜allow 标签期望导入 src 常量。 | 独立期望：`允许重跑`。 |
| F8-10 | `W/B2-07-crr-card.test.ts:59`｜同上｜deny 标签期望导入 src 常量。 | 独立期望：`不允许`。 |
| F8-11 | `W/B2-07-crr-card.test.ts:60`｜同上｜deny_final 标签期望导入 src 常量。 | 独立期望：`不允许，也别再问`。 |
| F8-12 | `W/B2-07-crr-card.test.ts:97`｜“a declared rewrite shows…”｜固定句期望导入 src 常量。 | 独立期望。 |
| F8-13 | `W/B2-07-crr-card.test.ts:148`｜“earlier requests…”｜固定句期望导入 src 常量。 | 移到 `W/B2-07-crr-card-pure.test.ts` 的 `commandRerunRequestCardFacts` 测试，并写规格原文。 |
| F8-14 | `W/B2-07-crr-card.test.ts:167`｜同上，同时间子例｜固定句期望导入 src 常量。 | 移到 `W/B2-07-crr-card-pure.test.ts` 的 `commandRerunRequestSummary` 测试，并写规格原文。 |
| F8-15 | `W/B2-09-crr-owner.test.ts:278`｜“not_blocked, pending and allowed are not_written…”｜等待命令期望复制第一次生产返回的 `.request.command`。 | 保留公开请求路径，期望直接写输入字面量 `echo k3-fixture`。 |
| F8-16 | `W/B2-09-crr-owner.test.ts:285`｜同上｜allowed 的等待命令也复制生产输出。 | 保留公开请求路径，期望直接写 `echo k3-fixture`。 |
| F8-17 | `W/B2-12-rewrite-prefix.test.ts:71`｜四个测试共用 `twoRecords`｜期望 digest 用生产 `canonicalJson`。 | 独立期望。 |
| F8-18 | `W/B2-12-rewrite-prefix.test.ts:73`｜同上｜第二条命令同样用生产序列化生成期望。 | 独立期望。 |
| F8-19 | `W/B2-14-crr-forms.test.ts:76`｜“an unrecognised rewrite…starts a pending request…”｜declared form 的 hash 期望调生产函数。 | 独立期望。 |
| F8-20 | `W/B2-14-crr-forms.test.ts:92`｜“a second declared rewrite appends…”｜第一种 form 的期望 hash 调生产函数。 | 独立期望。 |
| F8-21 | `W/B2-14-crr-forms.test.ts:93`｜同上｜第二种 form 的期望 hash 调生产函数。 | 独立期望。 |

F9：

| 实例 | 位置、测试标题／范围、原因 | 唯一处置 |
|---|---|---|
| F9-01 | `H/K3-blocked-command-fixture.ts:350`｜blocked world 场景｜用每次 5ms 的睡眠轮询处理器调用数。 | 使用已有 `shellSeam.waitForCall`／对应 seam 门，`H/K3-tool-seams.ts:52`。 |
| F9-02 | `H/K3-proposal-round.ts:356`｜“approve writes the ORIGINAL commands…”｜最多 500 次、每次 10ms 轮询 entered。 | **helper missing**：包装真实 entry 的 entered 提交设置 A3 门，原样返回真实结果。 |

F10：

| 实例 | 位置、测试标题、原因 | 唯一处置 |
|---|---|---|
| F10-01 | `W/B2-07-crr-card-closed.test.ts:140`｜“the Task card page reads the canonical closure exactly once per operation”｜只给卡片源注入 countedRecords，`:149`，请求服务仍是原 `world.commandRerun`，`:150`；卡片源读取 siblings 会调用该服务，`V/decision-read-model.ts:557`，服务又读 closure，`P/command-rerun-request-service.ts:450`，这部分不进计数器。 | **helper missing**：在整个 world 的同一个 records 工厂边界安装 A3 包装，让卡片源、请求 owner、execution reader 共用它；围绕一次 `readPage` 统计全部读。 |
| F10-02 | `W/B2-18-request-reads.test.ts:94`｜“listRequests issues exactly one physical page per call for all three filters”｜规格约束一次请求工具调用；测试只调三个 `listRequests`，`:120`、`:125`、`:131`，没调用请求工具，也没覆盖其其他读。 | **helper missing**：真实模型调用一次 `request_command_rerun`，在整次工具调用外计数；守住 `SPEC:1500`，不以 inner list 的一次读替代。 |

F11：

| 实例 | 位置、测试标题、为什么可以漏过所声称检查 | 唯一处置 |
|---|---|---|
| F11-01 | `W/B2-07-crr-card.test.ts:78`｜“a declared rewrite shows…never a re-expansion”｜没有修改真实 package.json，也没有观察工作区读取；即使卡片重新读／重新展开后仍保留 stored match，`:103`、`:106` 仍可通过；生产当前只投影 stored request，`V/decision-read-model.ts:655`。 | **helper missing**：请求产生后修改真实 package.json，计数真实 reader，再公开读卡，断言原 stored match 及零重新展开读。 |
| F11-02 | `W/B2-08-crr-answer.test.ts:110`｜“a Task that is no longer active closes the request and refuses the answer”｜同时有关闭卡和不完整 expected pins；这里只传请求 pin，`:114`，完整来源需三个 pin，`P/command-rerun-request-card.ts:200`；移除选项检查 `C/decision-service.ts:817`，仍会在 exactPinSet，`:824`，返回同一个 `invalid`。 | 使用公开当前卡来源和完整 pins，放入 `describe('rejects: closed CRR card')`，只保留“卡已关闭”这一个错误，公开读确认无变化。 |
| F11-03 | `W/B2-08-crr-cancel.test.ts:67`｜“cancelling the Task…”末尾“全文仍来自 Kernel”断言｜只检查 hash 非空，不能证明全文来源或没有截断；没有读该全文。 | 删除该断言；全文比较已由 `W/B2-07-crr-card.test.ts:69` 覆盖。 |
| F11-04 | `W/B2-08-crr-cancel.test.ts:68`｜同上｜只检查夹具常量包含 migrate，移除任何生产全文检查都不影响它。 | 删除；生产全文由 `W/B2-07-crr-card.test.ts:69` 覆盖。 |
| F11-05 | `W/B2-11-expansion-levels.test.ts:176`｜“counts actions, expansions, bases and truncated too”｜基准同时清空 actions/expansions 并改 truncated，`:178`；删掉某一个字段的计量，其他字段仍使 `>` 成立；未逐字段守住 `P/unknown-call-review-service.ts:108`。 | 移到 `W/B2-11-blocked-commands-bytes-pure.test.ts`，测 `blockedCommandsBytes`，每行只改一个字段并手算精确字节差。 |
| F11-06 | `W/B2-17-disposition-reads.test.ts:62`｜“counts the budget per blocked command…”｜开两个 world，分别执行一次 ②，`:63`、`:67`、`:72`；不能区分“一次 ② 内每条命令独立预算”与“每次操作共享预算”。 | 删除这条重复单命令测试；单命令预算和目录去重分别已由同文件 `:34`、`:51` 覆盖。 |
| F11-07 | `W/B2-UR7-crr-answer.test.ts:49`｜“a failed ③ is repaired by advanceReviewDisposition…”｜直接调用 coordinator；移除 Workflow 对 CRR 的交接选择 `B/workflow.ts:2726` 或执行接线 `:2576`，该测试仍不受影响。 | **helper missing**：真实失败 ③ 后把保存的答复交给 `workflow.advanceWork`，断言实际 `apply_review_disposition` 回执和公开消息／请求 revision。 |
| F11-08 | `W/B2-09-crr-owner.test.ts:248`｜“a failed allowance commit…rejects the call”｜只有 owner 返回 unavailable 和 allowance 未变，没有 shell 调用；移除 `R/execution-driver.ts:509` 的“提交成功才放行”检查仍可通过。 | 真实消费，在消费提交点注入失败，同时断言真实工具处理器没有进入。 |

F12：D1 中落在 G5 的四项不是删减或放宽，见 LEDGER；本次未确认 G5 的 F12 实例。单后端不合规不自动等于发生过“删除后端”的历史行为。

默认禁止还产生以下不能硬塞进 F1–F12 的问题：

| 位置 | 问题 | 唯一处置 |
|---|---|---|
| `W/B2-11-expansion-levels.test.ts:169` | 纯字节计量和带读端口的场景混在同一文件，不满足 A5 文件隔离。 | 移到 `W/B2-11-blocked-commands-bytes-pure.test.ts`，测 `blockedCommandsBytes`。 |
| `W/B2-03-crr-request.test.ts:160` | 三个拒绝输入没有 `describe('rejects: …')`；最后只看 commit counter，`:183`，没有逐行公开读确认无变化。 | 保留公开 request/listAll 路径，拆为三个单错误拒绝行，各自公开读前后比较。 |
| `W/B2-09-crr-owner.test.ts:193` | 身份冲突拒绝行不在 rejects 块，且只有提交计数确认不写，`:200`。 | 经公开 request/readRequest 路径组织独立 rejects 行并比较公开状态。 |
| `W/B2-09-crr-owner.test.ts:214` | stale revision 拒绝行不在 rejects 块，前置答复还是手造引用，`:217`。 | 真实答复后组织单独 stale-pin rejects 行，公开读确认 revision 不再变化。 |
| `W/B2-12-rewrite-prefix.test.ts:104` | ambiguous 拒绝与成功 full-id 混在普通 it；未按 A6 分类。 | 把 ambiguous 输入放入专门 rejects 行，保持本文件 `listAll:93` 的前后公开读。 |
| `W/B2-12-rewrite-prefix.test.ts:134` | foreign-prefix 拒绝不在 rejects 块。 | 保持唯一 foreign-task 错误，移入对应 rejects 块。 |
| `W/B2-12-rewrite-prefix.test.ts:156` | rewrite mismatch 拒绝不在 rejects 块。 | 保持唯一 mismatch 错误，移入对应 rejects 块。 |
| `W/B2-12-rewrite-prefix.test.ts:172` | alias 拒绝不在 rejects 块；使用 full ID 避开前缀歧义这一点是正确的，`:180`。 | 保持该单错误输入，移入对应 rejects 块。 |
| `W/B2-14-crr-forms.test.ts:98` | 第九种形式的 capacity 拒绝不在 rejects 块；其公开 readRequest 检查本身正确，`:113`。 | 保留八次公开创建／追加，独立组织第九种形式的 rejects 行。 |
| `H/B2-crr-world.ts:216` | 前置状态通过 raw store 读而非公开 execution reader；不把这种非断言读误报成 F7。 | 改用现有公开 `createRunStateReader().readExecution` 形状，示例 `W/B2-18-request-reads.test.ts:152`。 |
| `H/K3-prefix-claim.ts:122` | helper 接受完整 Run；`requestRerunOf` 也接受完整 record，`H/B2-crr-world.ts:234`，不符合 A1“只收公共输入”的接口约束。 | **helper missing**：只接收 runRef/requestId/命令，由 helper 内部公开读取得当前身份与任务。 |

双后端：ROWS 中所有只标“内存”或“SQLite”的服务行都缺另一后端；没有一个 G5 服务测试属于必须 SQLite 的 Host 重启例外。依据是 `.lead-ref/test-rule-sheet.md:94` 和 `.lead-ref/k3-g4b3-rework-7.md:40`、`:56`。这里不将它们重复计成 F12。

T 记录，仅限裁定明确列入 T 的文件：

| 文件位置 | 判定与范围 | 处置 |
|---|---|---|
| `H/B2-execution-fixture.ts:147` | F1：constructor 接受手写第二个 Plan draft；这是 G5 的传递初始化依赖。 | T；裁定 `.lead-ref/k3-b3-rulings-v1.md:10`。 |
| `H/B2-execution-fixture.ts:220` | F3：`buildPrepared` 写手造 manifest；本组调用 constructor，不据此声称执行过该方法。 | T。 |
| `H/B2-execution-fixture.ts:277` | F1：接受 built prepared。 | T。 |
| `H/B2-execution-fixture.ts:291` | F3：手写 Kernel binding 后 begin。 | T。 |
| `H/B2-execution-fixture.ts:301` | F3：手写 entered/history position；与规则 canary 一致。 | T。 |
| `H/B2-runtime-fixture.ts:155` | F4：Host double 的 inputCounter 固定返回 256 tokens；脚本模型本身仍为 A1。 | T。 |

**3. ROWS**

“会”只表示按当前代码可指出能被该断言区别的生产分支，不表示当前测试已经满足全部规则。F1–F10 的前置问题仍然阻止验收。动态 ref 的“相同”表示规格要求的身份关系；不把这种关系断言和固定文案从生产输出取值混为一谈。

| 文件:行／所声称行为 | 实际期望及来源 | 后端 | 删除所守检查后的静态判断 |
|---|---|---|---|
| `W/B2-01-blocked-commands.test.ts:66`／B2-01 | 一个 alias=1；动作 npm run db:migrate；展开 prisma migrate deploy；basis=app/package.json；truncated=false；来自 `SPEC:479`、`:484`、`:504`；hash 期望有 F8。 | 双后端 | 会：去掉 ② 构造动作／展开，`P/unknown-call-review-service.ts:228`、`:235`，会改变完整数组；不能独立守住生产 hash。 |
| `W/B2-01-blocked-commands.test.ts:93`／B2-01 fallback | `echo hi` 与 `tool 'unterminated` 各保存一项；手算规范化，`SPEC:485`、`:488`。 | 内存 | 会：删除 fallback，`P/unknown-call-review-service.ts:229`，数组不同；hash 有 F8。 |
| `W/B2-01-blocked-commands.test.ts:114`／B2-01 非 process | platform、空 blockedCommands、零 Kernel／文件读；`SPEC:461`。 | 内存 | 会：删除 process 过滤，`P/unknown-call-review-service.ts:166`，会多读／多写。 |
| `W/B2-01-blocked-commands.test.ts:139`／B2-01 rerun_as_is | 空 blockedCommands、零读；`SPEC:461`。 | 内存 | 会：删除处置类型入口筛选，`P/unknown-call-review-service.ts:163`。 |
| `W/B2-01-blocked-commands.test.ts:148`／B2-01 approve | resolved、alias `[1]`、原命令 hash、非 proposal hash；`SPEC:460`；缺文件 reason 来自替身，`:176`，不是生产读证据。 | 内存 | 会：把原命令换成方案命令，`P/unknown-call-review-service.ts:196`，会使原文 hash 断言不同；hash oracle 仍有 F8。 |
| `W/B2-01-task-read.test.ts:76`／B2-01 task-form read、返工 1 item 1 | limit=2，至少一空页，最后 cursor=null，目标只出现一次；五记录手算窗口应固定；当前目标选择用了生产排序。 | 双后端 | 会：过滤先于固定窗口会漏目标；检查点 `P/unknown-call-review-service.ts:1562`、`:1563`、`:1566`；但期望选择有 F8。 |
| `W/B2-03-crr-request.test.ts:79`／B2-03、CRR-01 | committed/requested、revision=1、pending、exact、空 forms、一次提交、一条公开记录；`SPEC:1280`、`:1485`。 | 内存 | 会：删除新建分支 `P/command-rerun-request-service.ts:882`、`:900`。 |
| `W/B2-03-crr-request.test.ts:99`／B2-03 | pending 返回同 requestId，不新增记录；`SPEC:523`、`:1485`。 | 内存 | 会：删除 pending 分支，`P/command-rerun-request-service.ts:840`。 |
| `W/B2-03-crr-request.test.ts:113`／B2-03 | git status→not_written/not_blocked，公开列表为 0；`SPEC:520`。 | 内存 | 会：删除未命中返回，`P/command-rerun-request-service.ts:790`。 |
| `W/B2-03-crr-request.test.ts:123`／实际 B2-05 | 同 Run denied_in_this_run；另一 Run requested、新 requestId；`SPEC:526`、`:1487`。 | 内存 | 会：删除同 Run 拒绝，`P/command-rerun-request-service.ts:864`；下一轮只 claim 未 start，且接续有 F4。 |
| `W/B2-03-crr-request.test.ts:146`／实际 B2-06 | denied_final、后续 refused、不提交；`SPEC:525`、`:1488`。 | 内存 | 会：删除 final 分支，`P/command-rerun-request-service.ts:853`。 |
| `W/B2-03-crr-request.test.ts:160`／B2-12 | foreign task、alias=2、deadbeef 各 invalid；`SPEC:521`；候选仅本任务。 | 内存 | 各分支可区分：`P/command-rerun-request-service.ts:599`、`:601`；但缺逐行公开无变化检查及 A6 组织。 |
| `W/B2-07-crr-card-closed.test.ts:39`／B2-07、B2-08 | cancelled/superseded→closed、source_resolved、无选项／动作、只读；`SPEC:536`、`:537`。 | SQLite | 会：卡片关闭投影依赖 `V/decision-read-model.ts:587` 与 `P/command-rerun-request-card.ts:215`；当前请求对象的 pending 断言不是重新读取持久态。 |
| `W/B2-07-crr-card-closed.test.ts:63`／B2-07 closure 读失败 | unavailable、故障被触发；故障文字为测试输入。 | SQLite | 会：删除失败传播，`V/decision-read-model.ts:588`。 |
| `W/B2-07-crr-card-closed.test.ts:98`／B2-07 closure 成本 | 一页两卡，计数两次操作各 1；“每 Task 一次”由测试要求，`:103`、`:169`。 | SQLite | 会杀卡片源 cache 删除，`V/decision-read-model.ts:384`；不会发现请求服务的额外 closure 读，`P/command-rerun-request-service.ts:450`，F10。 |
| `W/B2-07-crr-card.test.ts:34`／B2-07 | waiting_answer、answer、非只读、三个 apply 选项、三个 pins、完整全文；`SPEC:535`；固定句和标签有 F8。 | SQLite | 会检测选项数量／ID／顺序变化，`P/command-rerun-request-card.ts:98`；标签／固定句一起改变时不失败。 |
| `W/B2-07-crr-card.test.ts:78`／B2-07、B2-15 | declared、一个 form、固定“agent 注明是改写”、summary；`SPEC:535`、`:1497`。 | SQLite | 会检测 declared 显示分支删除，`P/command-rerun-request-card.ts:169`；不证明零重读／零展开，F11。 |
| `W/B2-07-crr-card.test.ts:111`／B2-07 earlier | 显示 earlier-command-5…1，不显示 0、later；手算六取五，`SPEC:535`；tie-z 在 tie-a 前无规格来源。 | SQLite＋混入纯输入 | 会检测 `< createdAt`、倒序、五条 cap，`P/command-rerun-request-card.ts:180`、`:182`、`:183`；输入 F2，tie 见开放问题。 |
| `W/B2-07-crr-card.test.ts:171`／B2-07 | by-key ready/waiting_answer、来源 kind；`SPEC:535`。 | SQLite | 会：来源读取／投影 `V/decision-read-model.ts:697`、`:707`。 |
| `W/B2-08-crr-answer.test.ts:57`／B2-08、CRR-02/04/05 | allow→allowed，deny→denied，deny_final→denied_final，公开 read 同态；`SPEC:1281`、`:1283`、`:1284`；事件 proof 检查有 F7。 | SQLite | 会：删除 answer transition，`ST/command-rerun-request.ts:167`；proof 构造点 `P/command-rerun-request-service.ts:1009`。 |
| `W/B2-08-crr-answer.test.ts:87`／CRR-02 pause | awaiting_resume、busy、请求仍 pending 原 revision；`SPEC:536`、`:1281`。 | SQLite | 会：删除暂停检查，`P/command-rerun-request-service.ts:988`。 |
| `W/B2-08-crr-answer.test.ts:101`／B2-08 | 公开 read closed、答复 invalid、之后仍 closed；`SPEC:536`。 | SQLite | 不会可靠守住不可答检查：移除 `C/decision-service.ts:817` 后，`:824` 仍因缺 pins 返回 invalid，F11。 |
| `W/B2-08-crr-cancel.test.ts:30`／B2-08 | allowed→closed，pending 队列空，旧 key 返回 null，新 key closed；`SPEC:1490`、`:1285`。 | SQLite | 会检测派生 closed，`P/command-rerun-request-service.ts:1154`，及旧 key 版本检查 `V/decision-read-model.ts:702`；fresh 来源有 F2；末尾两断言无全文敏感性。 |
| `W/B2-09-answer-replay.test.ts:28`／B2-09 | 第二次 replayed，同 action cursor，revision 只加一，公开请求仍同 revision；`SPEC:1289`、`:1491`，裁定 §3.1 允许。 | SQLite | 会检测 ② 重放，`P/command-rerun-request-service.ts:947`；③只断言 committed，没有公开消息 revision 的独立“一次”证据。 |
| `W/B2-09-crr-owner.test.ts:178`／B2-09 request replay | 第二次 replayed，同 cursor/ref，提交数不变；`SPEC:1289`。 | SQLite | 会：request receipt 重放，`P/command-rerun-request-service.ts:726`。 |
| `W/B2-09-crr-owner.test.ts:193`／B2-09 identity conflict | 同 requestId 不同命令→idempotency_conflict；`SPEC:1289`。 | SQLite | 会：receipt fingerprint 检查经过 `P/command-rerun-request-service.ts:239`；A6 无变化证据不足。 |
| `W/B2-09-crr-owner.test.ts:203`／B2-09 answer replay | 第一次 revision=2/allowed，第二次 replayed，提交数不变；`SPEC:1289`。 | SQLite | 会：`P/command-rerun-request-service.ts:947`；但答复引用是 F3。 |
| `W/B2-09-crr-owner.test.ts:214`／CRR revision | stale revision=1→revision_conflict/current=2；`SPEC:1289`。 | SQLite | 会：删除 revision 检查 `P/command-rerun-request-service.ts:964`，会落到非 pending 的另一拒绝码，不能满足该断言。 |
| `W/B2-09-crr-owner.test.ts:224`／CRR-03 | revision=3、used、usedAt=T、usedBy=指定 call-7、事件无 proof；`SPEC:1282`；T 为注入时钟，revision 手算 1+1+1。 | SQLite | 会检测 used transition 字段，`ST/command-rerun-request.ts:193`；不证明真实调用或提交后放行，F3/F7。 |
| `W/B2-09-crr-owner.test.ts:248`／B2-09、CRR-03 | unavailable，公开请求仍 revision=2/allowed/usedAt=null；`SPEC:1282`。 | SQLite | 会检测 owner 提交失败传播 `P/command-rerun-request-service.ts:322`；不会检测 hook 放行守卫 `R/execution-driver.ts:509`。 |
| `W/B2-09-crr-owner.test.ts:263`／CRR-01/no-write | not_blocked、pending、allowed 均 not_written；提交数 0→1→2；`SPEC:1289`。 | SQLite | 会：`:790`、`:840`、`:849`；等待命令期望有 F8。 |
| `W/B2-09-crr-owner.test.ts:289`／CRR-07 | denied_final 仍拒绝，但新 form 提交；重放同 cursor；`SPEC:522`、`:1286`。 | SQLite | 会：append 路径 `P/command-rerun-request-service.ts:853`、`:672` 及 receipt 重放。 |
| `W/B2-09-crr-owner.test.ts:313`／CRR-07 replay | 重放 outcome.command=`echo first-form`；字面量来自第一请求输入，`:315`，符合 `SPEC:523`。 | SQLite | 会：重放重建 outcome 使用原等待命令，`P/command-rerun-request-service.ts:274`。 |
| `W/B2-09-crr-owner.test.ts:336`／CRR-06 derived read | revision=1/closed、提交数仍 1；`SPEC:1285`。 | SQLite | 会：`:1154`；但 closure 本身是 F4。 |
| `W/B2-09-crr-owner.test.ts:345`／closure 失败 | unavailable；测试注入错误。 | SQLite | 会：`:1153`；依赖失败形状不满足 A2。 |
| `W/B2-09-crr-owner.test.ts:353`／CRR-06 applyAnswer | busy、增加一次提交，之后公开 read revision=2/closed；`SPEC:1285`。 | SQLite | 会：`:978`、`:979`；人为把 closure 改回 false，`:361`，仍是 F4。 |
| `W/B2-09-crr-owner.test.ts:366`／CRR-06 requestRerun | busy、增加一次 close 提交；`SPEC:1285`。 | SQLite | 会：`:823`、`:829`。 |
| `W/B2-09-crr-owner.test.ts:376`／CRR-06 consume | busy、增加一次 close 提交；`SPEC:1285`。 | SQLite | 会：`:1105`、`:1106`；调用与 closure 都不是公开前置链。 |
| `W/B2-09-crr-owner.test.ts:389`／CRR-06 list | 一项 revision=1/closed、提交数不增；`SPEC:1285`。 | SQLite | 会：task closure 读与派生，`P/command-rerun-request-service.ts:450`、`:463`。 |
| `W/B2-09-crr-owner.test.ts:402`／list 失败 | unavailable。 | SQLite | 会：`P/command-rerun-request-service.ts:451`；失败替身仍不合规。 |
| `W/B2-11-expansion-levels.test.ts:45`／B2-11 | 两目录各一个 build，分别 tsc -p app／other，truncated=false；手算，`SPEC:480`。 | 无 | 会：目录参与展开键，`P/command-expansion.ts:197`；目前用 F4 端口。 |
| `W/B2-11-expansion-levels.test.ts:64`／B2-11 | build、lint 两项，各自 actions/basis；`SPEC:479`、`:481`。 | 无 | 会：第二层循环，`P/command-expansion.ts:210`；outer 不折叠由数组精确值检查。 |
| `W/B2-11-expansion-levels.test.ts:90`／B2-11 cap | truncated=true、scriptText≤2048 bytes、hash 使用 3000 个 a 的全文；`SPEC:487`。 | 无 | 会：裁剪 `P/command-expansion.ts:69`、调用点 `:180`。 |
| `W/B2-11-expansion-levels.test.ts:103`／B2-11 unavailable | 空 scriptText/actions、basis unavailable、truncated=false；`SPEC:481`；reason 取自替身。 | 无 | 会：读失败分支 `P/command-expansion.ts:163`；并非真实工作区失败证据。 |
| `W/B2-11-expansion-levels.test.ts:115`／B2-11 可调 maxFiles | maxFiles=1，只读 a，一项，truncated=true；小上限为测试输入，规格生产上限 4，`SPEC:482`。 | 无 | 会：`P/command-expansion.ts:133`；不证明 ② 的生产上限接线。 |
| `W/B2-11-expansion-levels.test.ts:130`／B2-11 两层 | build、lint，无 lint:deep；`SPEC:479`。 | 无 | 会：两层循环边界，`P/command-expansion.ts:210`；标题的“缺 script”部分没有另给样例。 |
| `W/B2-11-expansion-levels.test.ts:143`／B2-11 非 runner／非静态 cwd | 两者 expansions=[]；`SPEC:479`、`:480`。 | 无 | 会：runner 识别 `P/command-expansion.ts:57` 与 dirs=null 跳过 `:192`。 |
| `W/B2-11-expansion-levels.test.ts:169`／blockedCommands 字节 | Run ID 从 2 字节变 2000 字节，差 1998；手算，`SPEC:484`、`:487`。 | 无 | 会：删除 reviewRunId 计量，`P/unknown-call-review-service.ts:108`；须移纯文件。 |
| `W/B2-11-expansion-levels.test.ts:176`／blockedCommands 字节 | 两个 `>`；没有各字段精确增量。 | 无 | 否：删除某一字段仍可能由其他字段产生差值；`P/unknown-call-review-service.ts:108`，F11。 |
| `W/B2-11-script-expansion.test.ts:49`／B2-11 八种 runner | npm run、run-script、test/start/stop/restart、pnpm run、yarn run；各一项、正文 prisma migrate deploy；`SPEC:479`、`:1493`。 | 无 | 会：`P/command-expansion.ts:57`；F4 端口阻止场景验收。 |
| `W/B2-11-script-expansion.test.ts:63`／B2-11 extra args | expansions=[]、reads=[]；`SPEC:515` 的 `-- --force` 例子。 | 无 | 会：精确参数个数，`P/command-expansion.ts:60`。 |
| `W/B2-11-script-expansion.test.ts:70`／B2-11 bare pnpm/yarn | 三个命令均不展开，动作仍保留；`SPEC:479`。 | 无 | 会：`P/command-expansion.ts:65`。 |
| `W/B2-11-script-expansion.test.ts:79`／B2-11 pre/post | 只有 tool x，无 prep/postp；`SPEC:479`。 | 无 | 会检测引入自动 pre/post；当前只取指定 script，`P/command-expansion.ts:95`。 |
| `W/B2-11-script-expansion.test.ts:87`／B2-11 missing script | 空 expansion、读一次 package.json；`SPEC:479`。 | 无 | 会：`P/command-expansion.ts:95`。 |
| `W/B2-11-script-expansion.test.ts:96`／B2-11 两层不同目录 | 外层 package.json、内层 sub/package.json，两项，两次读；手算 `cd sub`，`SPEC:480`、`:481`。 | 无 | 会：第二层目录传播，`P/command-expansion.ts:210`。 |
| `W/B2-11-script-expansion.test.ts:118`／B2-11 不进第三层 | a、b 两项，保留 npm run c 作为动作，只读一次；`SPEC:479`。 | 无 | 会：两层边界，`P/command-expansion.ts:210`。 |
| `W/B2-11-script-expansion.test.ts:129`／B2-11 cwd | 静态 app 路径展开；`$ROOT` 零读零展开；`SPEC:480`。 | 无 | 会：`P/command-expansion.ts:45`、`:192`。 |
| `W/B2-11-script-expansion.test.ts:144`／B2-11 absolute cd | `/abs/package.json` 被读并成为 basis；来自路径手算，未证明该路径在工作区内。 | 无 | 会检测内部 joinDirs，`P/command-expansion.ts:45`；不会证明生产工作区授权，`SPEC:481`。 |
| `W/B2-11-script-expansion.test.ts:153`／B2-11 文件上限 | 五目录只读前四，四项、truncated=true；`SPEC:482`。 | 无 | 会：`P/command-expansion.ts:133`；未覆盖生产 WorkspaceTools 读口。 |
| `W/B2-11-script-expansion.test.ts:164`／B2-11 目录去重 | package.json 一次，a、b 两项；`SPEC:1493`。 | 无 | 会：读缓存 `P/command-expansion.ts:130`。 |
| `W/B2-11-script-expansion.test.ts:171`／B2-11 动作去重 | 相同动作只一项；手算两次同文字。 | 无 | 会：已展开键判断 `P/command-expansion.ts:197`。 |
| `W/B2-11-script-expansion.test.ts:177`／B2-11 read failure | unavailable，空正文/actions；`SPEC:481`；reason 为替身文字。 | 无 | 会：`P/command-expansion.ts:163`。 |
| `W/B2-11-script-expansion.test.ts:185`／B2-11 invalid JSON | unavailable、空 actions；`SPEC:481`。 | 无 | 会：JSON 解析失败处理，`P/command-expansion.ts:87`。 |
| `W/B2-11-script-expansion.test.ts:191`／B2-11 text cap | ≤2048 bytes；动作保留 3000 个 x；`SPEC:487`。 | 无 | 会：`P/command-expansion.ts:69`、`:180`；该行没有单独断言 truncated，另一文件 `:97` 有。 |
| `W/B2-12-recognition.test.ts:90`／B2-12、K8-6 | 较早 record 的 action 胜过较晚 exact；`SPEC:539`。 | 无 | 会：排序及逐 entry 判定，`P/command-recognition.ts:42`、`:134`。 |
| `W/B2-12-recognition.test.ts:103`／K8-6 跨 record alias | 同时刻先 alias=1，不是另一 record 的 alias=2；`SPEC:539`。 | 无 | 会：flatten 后 alias 排序，`P/command-recognition.ts:42`；必须留纯测试，不能造服务状态。 |
| `W/B2-12-recognition.test.ts:122`／识别优先级 | 同 entry exact 优先 action；`SPEC:494`、`:495`。 | 无 | 会：`P/command-recognition.ts:136` 在 `:139` 前。 |
| `W/B2-12-recognition.test.ts:131`／declaredForms | stored declared form→declared；`SPEC:497`。 | 无 | 会：`P/command-recognition.ts:104`、`:141`。 |
| `W/B2-12-recognition.test.ts:142`／K8-6 | earlier action 优先 later declared；`SPEC:539`。 | 无 | 会：`P/command-recognition.ts:42`、`:134`。 |
| `W/B2-12-recognition.test.ts:155`／当前展开 | action 命中，viaScript=build/app；`SPEC:495`。 | 无 | 会：当前展开 `P/command-recognition.ts:73`、action matching `:109`；文件端口 F4。 |
| `W/B2-12-recognition.test.ts:168`／读失败退化 | unknown→null，exact 仍 exact；`SPEC:498`。 | 无 | 会：失败捕获 `P/command-recognition.ts:86`；故障替身不合规。 |
| `W/B2-12-recognition.test.ts:178`／读失败仍认 declared | declared；`SPEC:497`、`:498`。 | 无 | 会：`P/command-recognition.ts:104`、`:141`。 |
| `W/B2-12-recognition.test.ts:192`／B2-12、CRR-01 | requested、declared=true、match declared、form=`npm run custom`；`SPEC:519`、`:1280`。 | SQLite | 会：rewrite fallback `P/command-rerun-request-service.ts:810`；前置 F6、reader F4。 |
| `W/B2-12-rewrite-prefix.test.ts:104`／B2-12 prefix | ambiguous invalid，列两个完整 aaaaaaaa UUID；full ID 成功；输入字面量在 `:38`、`:39`，规则 `SPEC:517`。 | 内存 | 会：唯一前缀检查 `P/command-rerun-request-service.ts:595`。 |
| `W/B2-12-rewrite-prefix.test.ts:134`／B2-12 foreign task | invalid、候选含两本任务 ID，不含 FOREIGN_RUN；`SPEC:521`。 | 内存 | 会：本任务记录范围与未找到检查，`P/command-rerun-request-service.ts:599`。 |
| `W/B2-12-rewrite-prefix.test.ts:156`／B2-12 mismatch | invalid/rewrite_of_mismatch，公开列表空；`SPEC:539`。 | 内存 | 会：`P/command-rerun-request-service.ts:786`。 |
| `W/B2-12-rewrite-prefix.test.ts:172`／B2-12 alias | full ID＋alias=2→invalid，包含完整 ID；`SPEC:521`。 | 内存 | 会：`P/command-rerun-request-service.ts:601`；该输入没有前缀歧义的第二错误。 |
| `W/B2-14-crr-forms.test.ts:67`／B2-14、CRR-01 | pending/declared，一个 form，一次提交；`SPEC:522`、`:1280`；hash 有 F8。 | 内存 | 会：declared 创建 `P/command-rerun-request-service.ts:810`、`:882`。 |
| `W/B2-14-crr-forms.test.ts:81`／B2-14、CRR-07 | 同 ref、revision=2、两个有序 forms、两次提交；`SPEC:522`、`:1286`。 | 内存 | 会：append `P/command-rerun-request-service.ts:842`、`:653`；hash 有 F8。 |
| `W/B2-14-crr-forms.test.ts:98`／CRR-07 capacity | 第九项 capacity；公开状态 revision=8、八项；`SPEC:522`，手算一次创建＋七次追加。 | 内存 | 上限规则有两处保护：owner `P/command-rerun-request-service.ts:657`、状态机 `ST/command-rerun-request.ts:222`；单删其中一处不一定失败，删除该规则两处才会失败，不能把两处分别算已验证。 |
| `W/B2-14-crr-forms.test.ts:118`／B2-14 allowed | not_written/allowed、无 form append，revision=2、forms=[]；`SPEC:524`。 | 内存 | 会：`P/command-rerun-request-service.ts:849`。 |
| `W/B2-14-crr-forms.test.ts:135`／CRR-07 final | committed/refused/denied_final，revision=3，一项 form；`SPEC:522`。 | 内存 | 会：final 分支内 append，`P/command-rerun-request-service.ts:853`。 |
| `W/B2-14-crr-forms.test.ts:151`／CRR-07 same Run deny | committed/refused/denied_in_this_run，revision=3，一项 form；`SPEC:522`、`:526`。 | 内存 | 会：`P/command-rerun-request-service.ts:864`。 |
| `W/B2-17-disposition-reads.test.ts:34`／B2-17 | 四次路径读、四项、truncated=true；`SPEC:1499`。 | 内存 | 会检测 `P/command-expansion.ts:133` 的文件上限；读口仍为 F4，绝对路径未验证真实工作区授权。 |
| `W/B2-17-disposition-reads.test.ts:51`／B2-17 | 同目录一次读、两展开；`SPEC:1499`。 | 内存 | 会检测 `P/command-expansion.ts:130` 的缓存；读口 F4。 |
| `W/B2-17-disposition-reads.test.ts:62`／B2-17 per-command | 两 world 合计两次读、长度 `[1,1]`；只证明两次独立单命令操作。 | 内存 | 否：不能区分 `P/unknown-call-review-service.ts:235` 的每命令展开预算是否被改成每操作共享，F11。 |
| `W/B2-18-request-reads.test.ts:94`／B2-18 | 三种 list filter 各读 1 页；字面量来自 inner API 行为，不是 `SPEC:1500` 的整次工具成本。 | SQLite | 会检测 `P/command-rerun-request-service.ts:531` 的重复 lookup；不会守住请求工具内部分页 `:740`、`:619`，F10。 |
| `W/B2-18-request-reads.test.ts:137`／B2-18 no-write | not_blocked/pending/allowed 均 not_written；等待文字=`echo k3-fixture` 来自输入，`:164`。 | SQLite | 会检测 no-write 返回分支 `P/command-rerun-request-service.ts:790`、`:840`、`:849`；本行未计提交数，也没验证整次读取上界。 |
| `W/B2-UR7-crr-answer.test.ts:29`／UR7、实际也涉及 UR7b | 第一次 application_not_recorded；重驱 applied、② replayed、请求 revision 只加一；`SPEC:1319`、`:1324`，CRR 扩展来源 `.lead-ref/k3-g4b3-impl.md:252`。 | SQLite | 会检测 coordinator 重驱 `B/decision-actions.ts:561`；不会检测 Workflow 选择／执行 `B/workflow.ts:2726`、`:2576`，F11。 |

以上覆盖 89 个测试定义；`.each` 的八种 runner、三种答案、两种关闭状态及两后端分别在对应行列明。

RUN 前置链声明另列，不能冒充这些行的独立验收：

| 声明位置 | 判断 |
|---|---|
| `W/B2-07-crr-card-closed.test.ts:24` | 声称 RUN-20/RUN-22 是前置链；没有独立 RUN 行 literal／守卫断言；实际共享入口为 `H/K3-35-continuation-fixture.ts:744`、`:750`。 |
| `W/B2-07-crr-card.test.ts:20` | 同上；不计为独立 RUN-20/RUN-22 覆盖。 |
| `W/B2-08-crr-answer.test.ts:18` | 同上。 |
| `W/B2-08-crr-cancel.test.ts:16` | 同上。 |
| `W/B2-09-answer-replay.test.ts:14` | 同上。 |
| `W/B2-09-crr-owner.test.ts:7` | 同上。 |
| `W/B2-12-rewrite-prefix.test.ts:13` | 同上；真实 requeue 仍被该文件所用固定 digest 替身破坏。 |
| `W/B2-18-request-reads.test.ts:10` | 声称 ended/crashed 前置事实；本文件没有对应独立 expect；公开执行读在 `:153`，仅要求 ready。 |
| `W/B2-UR7-crr-answer.test.ts:15` | 同上。 |
| G5 全部 17 文件 | 没有直接声称 RUN-25 验收的测试行；不替其他组回答裁定 §3.2 的 RUN-25 双后端问题。 |

**4. LEDGER**

D1 按 G5 文件路径精确过滤后只有四项；没有照抄其他组的机械命中。

| D1 行 | 判定 |
|---|---|
| `.lead-ref/d1-k3g4b3-r8.txt:17` → `W/B2-12-rewrite-prefix.test.ts:62` | **较早任务书要求的前置身份核验**：`.lead-ref/k3-g4b3-impl.md:102` 的请求工具项、`:105` 的“同任务完整 ID／唯一前缀”要求；TASK_ID 是本文件 `:43` 的输入字面量，不是 src 常量，不是 F8/F12。 |
| `.lead-ref/d1-k3g4b3-r8.txt:18` → `W/B2-12-rewrite-prefix.test.ts:63` | **同一较早任务书项要求**：核验第二条记录仍属同一 task；同一个本地输入字面量 `:43`；不是弱化。 |
| `.lead-ref/d1-k3g4b3-r8.txt:19` → `W/B2-12-rewrite-prefix.test.ts:64` | **同一较早任务书项要求**：核验实际 Run ID 等于注入 FIRST_RUN，定义 `:38`；它是共享八字符前缀样例的输入，不是生产常量。 |
| `.lead-ref/d1-k3g4b3-r8.txt:20` → `W/B2-12-rewrite-prefix.test.ts:65` | **同一较早任务书项要求**：核验实际第二 Run ID 等于 SECOND_RUN，定义 `:39`；不是弱化。 |

这四条身份断言保留；它们合规不使同一 helper 的固定 digest 合规，`H/K3-prefix-claim.ts:96`。

**5. CANARIES**

| 裁定 §4 已知实例 | G5 核对 |
|---|---|
| `.lead-ref/k3-b3-rulings-v1.md:44`，`tests/business/K3-review-workflow-rows.test.ts:736` | 不在 `.lead-ref/groups/G5.txt` 的 17 个文件中；不在 G5 重报。 |
| `.lead-ref/k3-b3-rulings-v1.md:45`，K3-06 mixed-kinds owner | 不在 G5 文件表；不能以已撤回裁定替 G5 的 built draft 开例外。 |
| `.lead-ref/k3-b3-rulings-v1.md:45`，K3-13 two-items owner | 不在 G5 文件表。 |
| `.lead-ref/k3-b3-rulings-v1.md:46`，`tests/app/K3-15-review-routes.test.ts:81` | 不在 G5 文件表。 |
| `.lead-ref/k3-b3-rulings-v1.md:47`，K3-16 整体 summary 放宽 | 不在 G5 文件表／G5 的 D1 子集。 |
| `.lead-ref/k3-b3-rulings-v1.md:48`，K3-48-2 精确字节放宽 | 不在 G5 文件表／G5 的 D1 子集。 |
| `.lead-ref/k3-b3-rulings-v1.md:49`，K3-48-2 SQLite-only 与七个 timeout 提高 | 不在 G5 的 D1 子集；没有把本组现存单后端误报为这些历史删减。 |
| 裁定 §3.4 的相关依赖，`.lead-ref/k3-b3-rulings-v1.md:35` | **找到** `H/K3-crr-fixture.ts:157`，由 `W/B2-03-crr-request.test.ts:136` 调到；F4-10。 |
| 裁定 §3.4 的相关依赖，`.lead-ref/k3-b3-rulings-v1.md:37` | **找到** `H/K3-prefix-claim.ts:96`，由 `W/B2-12-rewrite-prefix.test.ts:56` 调到；F4-14。 |

**6. STATIC claims**

没有运行任何公开调用序列，也没有把静态阅读写成“已试跑”。

| 声明 | 静态核对与本报告是否依赖 |
|---|---|
| `W/B2-07-crr-card.test.ts:112`：“固定 T，所以真实 store 到不了先前时间” | **不成立为公共不可达证明**。这里只证明当前 helper 的固定时钟不能产生严格先后；world 中 CRR owner 确实用 `now: () => T`，`H/K3-review-card-fixture.ts:213`。公开序列应为“第一次请求／答复→推进注入时钟→第二次请求→公开读卡”；没有找到生产拒绝该序列的行。本报告选择纯 renderer 迁移，不依赖“公共步骤不可达”。 |
| `W/B2-03-crr-request.test.ts:186`：“两个 process item 不可达，因为串行分派” | **没有据此裁定不可达或删除覆盖**。静态可见 `RegistryToolBatchPolicy` 返回 serial 批次，`vendor/coding-agent/dist/tools/registry/tool-registry.js:142`；但“串行”本身不等于完整公共链的拒绝证明。helper 可把多条 calls 放进一次脚本回复，`H/B2-crr-world.ts:122`，再走 prepare/start/createRecord，`:125`、`:128`；本次未执行该序列，也没有取得拒绝行。 |
| `W/B2-17-disposition-reads.test.ts:62` 的 per-command 例子 | 删除建议基于它实际是两次独立单命令操作，`:72`、`:73`，且已有单命令覆盖，`:34`、`:51`；**不依赖**多 process item 公共不可达。 |
| `H/K3-crr-fixture.ts:192`：“claimed Run 已足够” | 这是请求 owner 不读 Run 运行态的事实范围，不等于真实工具已可调用；该 helper 在 claim 后只读 execution，`:193`，没有 start。后续真实工具场景应继续 prepare/start；本报告没有声称这条公共序列被拒绝。 |
| RUN-25 双后端 | G5 没有该行；共享 helper 有 git 工作树选项，`H/K3-35-continuation-fixture.ts:450`，有真实 capture，`:493`；这些静态事实不足以让我声称已经验证完整 RUN-25 双后端序列。 |

**7. OPEN QUESTIONS**

| 编号 | 尚未裁定的问题 | 最小选项 |
|---|---|---|
| Q1 | 同一创建时间的“以前请求”显示顺序：测试硬定 tie-z 在 tie-a 前，`W/B2-07-crr-card.test.ts:164`；生产注释也承认规格未指定，`P/command-rerun-request-card.ts:146`；`SPEC:535` 只说时间倒序。 | ① 规格补定 request-ref 降序，保留纯测试；② 不规定 tie 顺序，纯测试只断言集合和时间约束。 |
| Q2 | `SPEC:1500` 的 `⌈R/200⌉` 在 R=0 时是 0；当前空集合 list 示例却要求一次查询，`W/B2-18-request-reads.test.ts:123`。规则要求迁到整次请求工具计数后，仍需明确“查空的一页”是否计入上界。 | ① 严格保留 0，明确无需查询即可确认空集合的公开依据；② 规格明确最少一次查空页，即 `max(1,⌈R/200⌉)`。 |

这些问题没有被本报告自行选定答案；已有 F4、F7、双后端要求不是开放问题。

**8. SEARCH LOG**

| 检查 | 实际做法与结果用途 |
|---|---|
| 文件边界 | 读取 `.lead-ref/groups/G5.txt` 全部 17 行；逐文件读取全部内容，并记录行数、测试定义及最后测试标题；总计 2,824 行。 |
| 完整性复核 | 对 17 个已读文件逐个核对数组无缺行、末行为 `});`；测试定义统计 89，按 `.each` 表逐项展开为 101；没有用命中片段代替整文件阅读。 |
| 规则输入 | 全读 `.lead-ref/test-rule-sheet.md` 与 `.lead-ref/k3-b3-rulings-v1.md`；特别核对 default-deny、A7 为空、T 的明确边界、固定 digest 裁定。 |
| helper 清单 | 读取 `.lead-ref/groups/H.txt`；提取 G5 的 helper imports、本地 helper 定义及传递调用；阅读相应当前 helper 实现，不以文件名或“real/pure/seam”注释判定。 |
| helper 变化 | 搜索 `.lead-ref/b3-helpers.diff` 的 `diff --git`／`@@` 边界，结合当前实现核对 B2-crr、K3 continuation、blocked、crr、prefix、proposal、review-card、tool-seams、S5 的相关变化；没有把整个 H 组声称为本组全审完成。 |
| 语义候选搜索 | 在全部 G5 内容检索 spread、eventAt、readMany、readWorkspace、recognize、listTaskReviews、setClosed、consumeAllowance、applyAnswer、setTimeout、src 文案常量、commandSha256、canonicalJson、compareRefKeys、advanceReviewDisposition；逐项回到完整测试和 helper 判断。 |
| 隐藏前置链 | 跟读 `openK3ReviewCardWorld→openS5DecisionFixture→createB2ExecutionFixture→createTaskClaimFixture`，发现原始提交、Session 写入、prepared/entered 写入；没有因末端 review 来自真实 Kernel 就忽略这些前置事实。 |
| 拒绝双错误 | 跟读 `C/decision-source-facts.ts:805` 至当前来源投影、`C/decision-service.ts:817` 的选项检查与 `:824` 的 exact pins 检查，确认 inactive-answer 的两条独立拒绝原因。 |
| 全操作计数 | 跟读卡片源 `aliasRequestsOf`，`V/decision-read-model.ts:547`，到请求服务 closure，`P/command-rerun-request-service.ts:450`；确认该路径绕过测试计数器。 |
| 规格对应 | 阅读 `SPEC:457` 的 L19a、`:1276` 的 CRR 表、`:1311` 的 UR 表、`:1380` 的入口与接缝、`:1479` 的 B2 表；逐测试登记 literal 来源与生产检查。 |
| 账本 | 按 17 个完整文件路径过滤 `.lead-ref/d1-k3g4b3-r8.txt`；仅四条命中，逐条对照本地常量定义与早期任务书请求工具项。 |
| 历史上下文 | 读取相关 B3 任务书、返工 6–8、closeout／最后报告／上一轮审查；历史“0 defects”没有作为当前合规证据；尤其重新核对返工 7 的双后端要求。 |
| 搜索工具 | 环境中 `rg` 不可用，使用 PowerShell `Get-Content`、`Select-String`、`Get-ChildItem` 及已读文本的 JavaScript 过滤；中文输出乱码处改为 UTF-8 读取后转义传输再解码，重新读取必要内容。 |
| 执行限制 | 未运行测试、构建、git、模型或生产流程；未修改文件；未启动其他审计 agent。 |

G5: files read 17/17; instances by rule: F1 5, F2 9, F3 21, F4 29, F5 0, F6 6, F7 2, F8 21, F9 2, F10 2, F11 8, F12 0; open questions 2