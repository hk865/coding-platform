G6 的 13 个文件、3,303 行已全部读完；共 55 个测试定义，按参数展开为 98 个测试。未修改文件，未运行测试或构建。以下“删除检查后会失败”均为静态判断，没有执行变异测试。

本组不能判为 clean。最直接的漏测是：K3-18 的“暂停目标”用例只生成了暂停请求，没有发送；此外，该用例也没有设置规格要求的 `every_step`。见 `tests/work-graph/K3-18-review-card-queue.test.ts:197`、`tests/scenarios/support/control.ts:106`。

为缩短重复路径，以下定位约定：

- 测试文件仅写文件名时，目录均为 `tests/work-graph/`。
- `helpers/` 表示 `tests/helpers/`；`runtime/` 表示 `tests/runtime/`；`scenarios/` 表示 `tests/scenarios/`。
- `state/`、`tasks/`、`communication/`、`views/` 均相对 `src/core/work-graph/`。
- `slice-K3-SPEC.md` 的完整路径为 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`。
- `D1:n` 表示 `.lead-ref/d1-k3g4b3-r8.txt:n`，其旧代码定位不是当前文件的行号。
- 同一共享 helper 的缺陷按源位置计一次，不按调用次数、参数行或后端重复计数；调用文件与调用位置列在 COVERAGE。F 编号只是规则中的例子，不能覆盖的默认禁止项另列，未硬塞进不相符的 F 编号。

**1. COVERAGE**

| 文件 | 测试定义／展开数；测试标题起始行 | 全读？ | 命中 | 调用的 helper 及裁定 | 最后一个测试标题 |
|---|---|---|---|---|---|
| `K3-06-mixed-kinds-owner.test.ts` | 2／4；117、181；EOF 230 | 是 | 共享 F1/F2/F3/F4/F9；本地 F4；默认禁止 A6；D1 的 F12 | `openK3ReviewCardWorld`，119、183：共享 F1/F3/F4；`createK3PendingReview`，121：公开识别主体 A1，但继承 shell F4；`claimK3ReviewRound`，145：F2/F9，继承 Session F3；`recordK3Conclusion`，150：公开 owner 写本体 A1；`endK3RunCompleted`，161：A1；`settleK3Review`，164：本例经手造显示表，F4；`openRealRunHarness`，185：正常 prepare/start/识别主体 A1、后端共享 A4；`shellSeam`，54：F4；`ownerServices`，92：F4；`item`／`draftOf`，71、105：仅作为拒绝输入，尚不满足 A6 | `K3-06 %s: the create entry refuses an item whose kind disagrees with the L3 mapping and writes nothing`，181 |
| `K3-13-two-items-owner.test.ts` | 1／2；50；EOF 114 | 是 | 共享 F1/F2/F3/F4/F9；D1 的 F12 | `openK3ReviewCardWorld`，52：F1/F3/F4；`createK3PendingReview`，54：本体 A1、shell F4；`claimK3ReviewRound`，66：F2/F9；`endK3RunCompleted`，71：A1；`settleK3Review`，77：本例没有模型结论，不调用伪 full 表，本体 A1；`shellSeam`，35：F4；公开队列读取，99：A1 | `K3-13 %s: settlement closes the pending process item undetermined/settlement with the fixed sentence and reasons, and the card is queued`，50 |
| `K3-15-disposition-effects.test.ts` | 8／11；219、285、308、321、334、349、362、375；EOF 420 | 是 | 共享 F1/F3/F4/F6；本地 F6；默认禁止 A5、缺 memory；D1 的 F12 | `openWorld`，150：只开 SQLite，且继承共享 F1/F3/F4；`createK3NeedsDecisionRecord`，201、292、351：普通分支 F6，auto 分支 read seam F4；`createFileEditRecord`，164：F6；`openRealRunHarness`，166：正常路径 A1/A4；`createScriptedModel`，175：A1；`readToolSeam`／`shellSeam`／`mixedEditSeam`，48、54、59：F4；`applyChoice`，197、`cardSourceOf`，132：公开决定操作本体 A1，继承上述前置；`runOf`／`recordOf`／`requeueOf`／`baseBrief`／`renderWith`，88、96、102、113、127：是纯输入构造，但所在文件不满足 A5 | `K3-15 (L20): annotations survive the codec, and the renderer writes the record and file lines`，375 |
| `K3-15-hold-release.test.ts` | 3／6；95、135、224；EOF 240 | 是 | 共享 F1/F3/F4；本地 F4/F7；默认禁止 A1；D1 的 F12 | `ownerFixture`，62：继承 world 缺陷；`reviewClaim`，70：真实 claim 本体 A1，但 Session 创建 F3，且没有进入 Runtime；`workspaceRevision`，79：直接读 store，不符合 A1 的公开读取形状；`shellSeam`／`readToolSeam`，文件顶部 mock：F4；`readGoalPlanWindow`／`readCanonicalTaskFacts`，175、177、189：用于断言，F7；`captureDigest`，159：F4；commit 包装，230：A3；缺 taskProjection 的 owner 构造，230：默认禁止，见下文 | `K3-15 (四) %s: without the task projection the hold is unavailable and nothing is written`，224 |
| `K3-15-list-by-task.test.ts` | 2／4；51、70；EOF 87 | 是 | 共享 F1/F3/F4/F6；本地 F11；默认禁止 A6 | `openK3ReviewCardWorld`，52、71：F1/F3/F4；`createK3NeedsDecisionRecord`，54、55、73：F6；`shellSeam`，20：F4；`listByTask`，33：公开分页调用本体 A1，但当前测试数据不能保护续页逻辑 | `(%s) rejects an empty taskId and leaves the other filters untouched`，70 |
| `K3-16-approval-application.test.ts` | 7／14；196、245、339、390、415、429、461；EOF 472 | 是 | 共享 F1/F2/F3/F4/F9；本地 F6/F7/F8/F12；默认禁止 A6 | `openWorld`，59：启用真实 Kernel 命令读口，A1；world 其他前置仍 F1/F3/F4；`approvalSetup`，125、`cleanAwaitingApproval`，159：F6；`completeProposalRound`，111：继承 claim F2/F9；`createK3PendingReview`：A1 主体、F4 seam；`claimK3ReviewRound`：F2/F9；`recordK3Conclusion`／`writeK3Proposal`：公开 owner 本体 A1；`endK3RunCompleted`：A1；`endK3RunUnfinished`：A2；`settleK3Review`：有结论分支 F4；`readK3Review`／`readK3ReviewCard`／`answerK3Disposition`：公开调用本体 A1；`shellSeam`，45：F4；`observeRecords`：A3 | `K3-16 %s: an option that is not on the approval card is invalid and writes nothing`，461 |
| `K3-16-proposal-round-fixture.test.ts` | 6／12；75、122、138、171、221、251；EOF 271 | 是 | 共享 F1/F2/F3/F4/F6/F9；F12 | `world`，63：继承共享 world 缺陷；`reachK3AwaitingProposal`，77 等：F6，默认 tool 分支另有 F3；`runK3ReviewRound`，258：继承 claim F2/F9、结算 F4；`readK3Review`：A1；`endK3RunCompleted`：A1；`endK3RunUnfinished`：A2；`settleK3Review`：公开结算本体 A1，有结论时 F4；`readRunBoundary`，201、230：公开 execution＋history owner 读取，A1；`cursorPosition`，56：只解析真实游标作交叉校验，不是造游标；`shellSeam`：F4 | `K3-16 %s: a pending_review record enters a real review round, records a conclusion and settles resolved`，251 |
| `K3-16-proposal-write.test.ts` | 6／12；86、133、154、167、190、216；EOF 250 | 是 | 共享 F1/F2/F3/F4/F9；本地 F6/F7/F12；默认禁止 A6 | `setup`，54：F6；`createK3PendingReview`：A1 主体、F4 seam；`claimK3ReviewRound`：F2/F9；`answerK3Disposition`／`readK3Review`：公开调用本体 A1；`proposalRequest`，74：公开命令输入 A1，非法行须满足 A6；`methodLine`／`commandOf`，205、210：由规格字面格式手算，未取生产常量；`bytesOf`，48：只量长度，不等于内容不变；`shellSeam`，35：F4 | `K3-16 %s: one rendered command line is 28 bytes + command + 2 per newline; 5,121 is capacity and 5,120 is accepted`，216 |
| `K3-16-second-unfinished-proposal.test.ts` | 3／6；122、140、162；EOF 192 | 是 | 共享 F1/F2/F3/F4/F9；本地 F6 | `concludedDecision`，66：F6；`awaitingProposal`，87：公开答复、claim 主体 A1，继承 F2/F9；`secondUnfinished`，100：真实崩溃 A2，但默认 `writeK3Proposals` 直接调用工具 handler，F3；`runK3ReviewRound`：继承 claim／settlement 缺陷；`endK3RunUnfinished`：A2；`readK3Review`：A1；`shellSeam`，31：F4 | `K3-16 %s: a new stateEntry counts from one again`，162 |
| `K3-17-disposition-replay.test.ts` | 4／8；66、86、112、129；EOF 166 | 是 | 共享 F1/F3/F4/F6 | `readyWorld`，55：继承 world 与 `createK3NeedsDecisionRecord` 的 F6；`cardOf`，37／`requestOf`，47：公开卡读取、请求构造本体 A1；`failNextApplicationCommit`，88：A2；`failNextApplicationRead`，114：A2；应用提交计数包装：A3；`shellSeam`，24：F4 | `K3-17 (%s): an answer to an older card revision is revision_conflict and writes nothing`，129 |
| `K3-18-autonomy-facts.test.ts` | 3／6；140、158、173；EOF 192 | 是 | 共享 F1/F3/F4；F12 | `openWorld`，63：继承 world 缺陷；`fileEditRecord`，78：正常识别主体 A1，但 edit seam F4；`openRealRunHarness`：A1/A4；`createScriptedModel`：A1；`setAutonomy`，109、`taskRow`，119、`causes`，128：公开 owner／公开读取，A1；`shellSeam`／`mixedEditSeam`，37、42：F4 | `K3-18 (五) %s: requeueConfirmed removes the system_requeue confirmation cause`，173 |
| `K3-18-requeue-confirmed.test.ts` | 2／4；116、160；EOF 174 | 是 | 共享 F1/F3/F4/F6；本地 F3/F11；默认禁止 A5 | `setEveryStep`，62：公开设置 owner，A1；`pauseGoal`，79：F3，并读内部 GoalPhase；`taskRow`，97、`confirmationCauses`，107：公开读取 A1；`createK3NeedsDecisionRecord`，120：F6，164 auto 分支 read seam F4；`automationConfirmationCause`，137、153／`pausedAutomationAction`，150：纯函数行混在场景文件，不满足 A5；`readToolSeam`／`shellSeam`，34、40：F4 | `K3-18 (一) (%s): an auto-settled record with no disposition still gets the ordinary confirmation card`，160 |
| `K3-18-review-card-queue.test.ts` | 8／9；194、301、321、337、354、361、368、423；EOF 495 | 是 | 共享 F1/F2/F3/F4；本地 F4/F6/F7/F8/F11/F12；默认禁止 A5 | `HostScenario.open`，195：公开 Host 初始化主体 A1；`restart`，126：崩溃 A2，但默认 invariant 为 F7；`openShellWorkRoot`，117：F2；`prepareOn`，121／`driveReviewUntil`，174：A1；`preparedOf`，122：返回真实 prepared，无覆盖，本体 A1；`openMissingReadReviewRoot`，135：真实配置缩窄，A2；`control`，197：A1 请求构造，**不执行暂停**；`queue`／`reviewOf`，186、109：A1；`targetDigestSeam`，389／`digestDecisions`，401：F4；`record`／条目 builder，235–298：纯输入，所在文件不满足 A5；`openRealRunHarness`，427：正常路径 A1/A4，本次传 probe 是 F6；`mixedEditSeam`／`shellSeam`：F4；清理 helper：仅清理自身临时资源，无本轮新增命中 | `K3-18 (%s): a file_edit record whose Kernel was unreadable at the stop is needs_decision; a file change invalidates its old file annotation`，423 |

UNREAD：无 G6 文件未读。对额外依赖，裁定只覆盖已经读取的被调用函数及其必要初始化，不宣称整个仓库或所有历史文档已审完。

**2. FINDINGS by rule**

每行只给一个处置。共享 helper 的调用者见 COVERAGE；“全部 world 场景”指经 `helpers/K3-review-card-fixture.ts:127` 创建世界的本组测试。

**F1**

- F1-01｜`helpers/S5-decision-fixture.ts:707`、`:719`、`:736`｜全部 world 场景的初始化｜手造 manifest、envelope、prepared 后交 `authorizeRuntimeEntry` 接受；初始化实际在 `:783` 执行，不因被测 Run 后来走真实 Runtime 而消失｜处置（i）：用 `helpers/K3-35-continuation-fixture.ts:536` 的真实 `prepareAndStart` 路径产生进入前值；缺少的共享初始化 helper 必须只收任务、Session 标识和脚本回复，不能收 prepared。

**F2**

- F2-01｜`helpers/K3-proposal-round.ts:428`、`:431`｜调用 `claimK3ReviewRound` 的核对／提案测试｜真实配置读回后 spread，再覆盖 `readonlyCommandAccess`；这就是 F2，`??` 不构成例外｜处置（i）：沿 `helpers/K3-35-runtime.ts:75` 在 Host 配置输入处声明授权，删除读后覆盖。
- F2-02｜`scenarios/support/shell-work-root.ts:38`、`:43`｜`K3-18-review-card-queue.test.ts:194`“暂停目标队列”｜读回配置后覆盖 `shellWorkspaceAccess`｜处置（i）：缺 helper：从真实 Host 配置输入创建带 shell 授权的 root，沿 `helpers/AG2b-collaboration-fixture.ts:185` 的配置加载路径，不改读取结果。

**F3**

- F3-01｜`helpers/S5-decision-fixture.ts:543`｜全部 world 场景初始化｜直接提交手造 Project、Workspace｜处置（i）：用 `helpers/AG2b-collaboration-fixture.ts:342` 的公开 seed 路径建立项目和工作区。
- F3-02｜`helpers/S5-decision-fixture.ts:568`｜全部 world 场景初始化｜直接提交治理快照与活动指针｜处置（i）：用 `helpers/AG2b-collaboration-fixture.ts:354`、`:361` 的公开安装、激活、初始架构采用步骤。
- F3-03｜`helpers/S5-decision-fixture.ts:574`｜全部 world 场景初始化｜直接提交预设 revision 的 Goal｜处置（i）：用 `helpers/AG2b-collaboration-fixture.ts:366` 的公开 Goal 创建，再通过设置 owner 配置。
- F3-04｜`helpers/S5-decision-fixture.ts:816`｜全部 world 场景初始化｜循环直接写候选 PlanProposal、请求头 claim 和事件｜处置（i）：缺 helper：经真实 Query／计划提案公开入口生成候选；不能接收编码记录。
- F3-05｜`helpers/S5-decision-fixture.ts:881`｜全部 world 场景初始化｜直接写 pending 决策消息及发送事件｜处置（i）：缺 helper：脚本模型调用真实消息工具，返回消息标识。
- F3-06｜`helpers/S5-decision-fixture.ts:892`｜全部 world 场景初始化｜直接写另一条待答消息及发送事件｜处置（i）：同上，使用真实消息发送 helper。
- F3-07｜`helpers/S5-decision-fixture.ts:906`｜全部 world 场景初始化｜直接把消息写成 responded 并写答复事件｜处置（i）：缺 helper：读取真实卡后调用 `answerDecision`，返回真实答复标识。
- F3-08｜`helpers/S5-decision-fixture.ts:869`｜全部 world 场景初始化｜绕过消息 owner，直接向 body store 放手造消息封套，供后面的手造消息使用｜处置（i）：由上面真实消息发送／答复 helper 让生产 owner 保存正文。
- F3-09｜`helpers/S5-decision-fixture.ts:630`｜全部 world 场景和新建核对 Session｜直接调用 Kernel store 的 `create`｜处置（i）：用 `helpers/AG2b-collaboration-fixture.ts:381` 的公开 Session 创建路径。
- F3-10｜`helpers/S5-decision-fixture.ts:632`｜全部 world 场景和新建核对 Session｜手工调用 Host 正常负责的 `recordSessionCreated`｜处置（i）：同一公开 Session 创建路径，`helpers/AG2b-collaboration-fixture.ts:381`。
- F3-11｜`helpers/S5-decision-fixture.ts:739`｜全部 world 场景初始化｜测试调用 Runtime 的 begin 写入，并使用手造 Kernel 绑定｜处置（i）：由 `helpers/K3-35-continuation-fixture.ts:536` 的真实 Runtime start 完成。
- F3-12｜`helpers/S5-decision-fixture.ts:742`｜全部 world 场景初始化｜手写 entered 事实，位置固定为 2、3｜处置（i）：由同一真实 Runtime start 完成，禁止传入位置。
- F3-13｜`helpers/K3-proposal-round.ts:705`、`:708`｜`K3-16-proposal-round-fixture.test.ts:75` 及 `K3-16-second-unfinished-proposal.test.ts:122`、`:162` 的默认 tool 分支｜测试构造 ToolCall 后直接执行 handler；正在运行的脚本模型只等待最终文字，并没有在 Kernel 中发出该提案调用，见 helper `:413`｜处置（i）：缺 helper：在真实提案 Runtime 的脚本回复中发出 `propose_safer_method`，从真实后续模型请求读取工具结果。
- F3-14｜`K3-18-requeue-confirmed.test.ts:86`｜116“重跑已确认，抑制普通确认卡”｜直接调用 Host 内部 `setGoalControlFromHost`，跳过 Host 控制入口｜处置（i）：用 `scenarios/support/control.ts:156` 的 `goalControlled`；共享 memory world 缺少相应公开控制 helper，应补同等公开入口适配。

**F4**

- F4-01｜`helpers/K3-tool-seams.ts:79`、`:93`｜所有使用 armed shell 的本组场景｜替换 schema、能力清单并返回手造 success；未调用真实 shell handler，不能算 A3 gate｜处置（i）：缺 helper：包装真实 shell handler，在确定入口挂 gate，放行后原样返回真实结果。
- F4-02｜`helpers/K3-tool-seams.ts:132`、`:146`｜`K3-15-disposition-effects.test.ts:285`、`:349`，hold、requeue-confirmed 的 autoSettled 前置｜read 替身返回手造 success，不读取磁盘｜处置（i）：缺 helper：真实 read handler 的 A3 gate，文件内容通过磁盘输入产生。
- F4-03｜`helpers/K3-mixed-seams.ts:53`、`:70`｜disposition-effects 的文件批注、autonomy-facts 三例、review-card-queue 文件摘要例｜edit 替身没有实际修改文件却返回 success｜处置（i）：缺 helper：真实 edit handler 的 A3 gate，放行后保留真实修改及返回值。
- F4-04｜`helpers/K3-proposal-round.ts:571`｜有核对轮结论的 `settleK3Review` 调用｜把每个 alias 统一标成 `full`，替代真实准备清单；生产读法在 `src/composition/create-platform.ts:715`、`:722`、`:726`｜处置（i）：结算使用共享 composition root 的真实 review owner；缺 helper 的只是该 owner 的公开访问封装。
- F4-05｜`helpers/K3-review-card-fixture.ts:139`｜默认 world 的 Kernel 命令读口｜从测试 map 返回命令事实；F4 不因名字叫 PORT DOUBLE 而放行；本组 approval／disposition-effects 已通过 `realKernelCommandFacts: true` 避开这一分支｜处置（i）：统一采用该 helper `:150` 的真实 Kernel 命令读口。
- F4-06｜`helpers/K3-review-card-fixture.ts:162`、`:164`｜会落实 skip／approve 的场景｜固定返回“没有 package.json”，没有查询真实工作树；F 中的 unavailable 展开原因随之来自这个替身｜处置（i）：接入真实工作区读取，在磁盘上决定 package.json 是否存在。
- F4-07｜`helpers/K3-review-card-fixture.ts:245`、`:247`｜真实答复／落实路径｜消息 duties 端口返回手造事实和空 guards｜处置（i）：缺 helper：让 world 使用 composition root 的真实 mailbox 与 duties reader。
- F4-08｜`helpers/executed-files-stub.ts:23`、`:24`，接入点 `helpers/K3-review-card-fixture.ts:305`｜使用 world 决定读模型的场景｜返回固定 not_available、空 files、空 guards｜处置（i）：缺 helper：复用 composition root 的真实 executed-files reader。
- F4-09｜`helpers/K3-review-card-fixture.ts:200`、`:205`｜world 构造中的 CRR recognizer｜手写 exact-sha 匹配结果；G6 没有调用该 CRR 写入口，因此不把它说成 G6 已执行的业务分支，但 helper 本身仍不合规｜处置（i）：接真实 CRR recognizer，输入来自真实 Kernel 命令和工作树。
- F4-10｜`K3-06-mixed-kinds-owner.test.ts:100`｜181“拒绝 L3 kind 不符”｜给 owner 注入固定 full map；此拒绝路径没有消费该端口，是多余禁用替身｜处置（iii）：删除；该例只需拒绝后公开 `readReview`，已有 `:220`。
- F4-11｜`K3-15-hold-release.test.ts:159`｜135“自动定稿后 hold、release、接续领取”｜`captureDigest()` 返回 `'a'.repeat(64)`，正中裁决 §3.4｜处置（i）：用 `helpers/K3-35-continuation-fixture.ts:491`、`:493` 的真实工作树 capture。
- F4-12｜`K3-15-hold-release.test.ts:162`｜同一例｜消息读口固定 not_found，未委托真实 owner｜处置（i）：缺 helper：将真实 mailbox 的 `readMessage` 接入同一 requeue world。
- F4-13｜`K3-15-hold-release.test.ts:233`｜224“缺 task projection 时 unavailable”｜固定 full map，且该路径不需要显示表｜处置（iii）：删除；拒绝目标是 `tasks/unknown-call-review-service.ts:979` 的 projection 缺失检查。
- F4-14｜`K3-18-review-card-queue.test.ts:62`、`:72`｜194“暂停目标队列”｜整个 ProcessSandbox 类被替身替换，probe 可返回虚构 available/bwrap 路径｜处置（i）：使用真实 sandbox probe；本例的能力缺失由 `openMissingReadReviewRoot`，`:135` 的真实 Host 授权缩窄产生。
- F4-15｜`K3-18-review-card-queue.test.ts:389`、`:396`｜423“文件改变使旧批注失效”｜工作区读口返回手造 WorkspaceFile；`:474` 只改变量，不改文件｜处置（i）：缺 helper：真实文件 A 写盘、公开读卡、真实改为 B、再答旧对象、重读新对象。
- F4-16｜`K3-18-review-card-queue.test.ts:412`｜423 同例｜为新建消息 owner 手造 duties、readOnlyCopy、independentReview、guards｜处置（i）：缺 helper：复用同一真实 world 的 mailbox／decision owner，不在用例里重组其事实端口。

**F5**

- 本组未确认 F5 实例。下列无真实能力故障的 `review_unavailable` 按 F6 计，不重复计 F5。

**F6**

- F6-01｜`helpers/K3-review-card-fixture.ts:389`｜所有普通 `createK3NeedsDecisionRecord` 调用｜没有缩窄授权或令真实依赖失败，就声明 `review_unavailable` 结算｜处置（i）：缺 helper：将 `K3-18-review-card-queue.test.ts:135`、`:170` 的真实缺 read 授权＋Workflow `settle_review` 路径提为双后端共享 helper。
- F6-02｜`helpers/K3-proposal-round.ts:874`｜`K3-16-proposal-round-fixture.test.ts:75` 等 reach helper 调用｜同上，用 owner 入参代替真实不可用原因｜处置（i）：使用上述真实授权缩窄 helper。
- F6-03｜`K3-16-approval-application.test.ts:135`｜196、245、415、429、461 的审批前置｜直接声明不可用以得到第一张卡｜处置（i）：使用上述真实授权缩窄 helper。
- F6-04｜`K3-16-approval-application.test.ts:174`｜339、390 的 clean approval 前置｜真实 unfinished 之后再凭空声明不可用；前一个真实崩溃不证明只读能力不可用｜处置（i）：在第一次 unfinished 后真实缩窄 Host 授权，再由 Workflow 结算。
- F6-05｜`K3-16-proposal-write.test.ts:63`｜该文件六个测试的前置｜直接声明不可用｜处置（i）：使用上述真实授权缩窄 helper。
- F6-06｜`K3-16-second-unfinished-proposal.test.ts:80`｜该文件三个测试的前置｜真实 unfinished 后凭空声明不可用｜处置（i）：真实缩窄 Host 授权并推进 Workflow，保留已经写下的结论。
- F6-07｜`K3-15-disposition-effects.test.ts:185`｜375“批注经 codec 和 renderer 保留”｜传入手造 damaged probe；helper 在 `helpers/K3-35-continuation-fixture.ts:691` 用它替代真实 probe｜处置（i）：缺 helper：包装真实 Kernel 读取，在停止读取点失败一次，认定时恢复，禁止输入 probe 结果。
- F6-08｜`K3-18-review-card-queue.test.ts:448`｜423“Kernel 停止时不可读，旧文件批注失效”｜同一手造 damaged probe 模式｜处置（i）：使用上述真实 Kernel 读取故障 helper。

**F7**

- F7-01｜`K3-15-hold-release.test.ts:177`、`:180`｜135“hold／release／接续领取”｜直接从 records 派生内部 canonical task facts 后断言选定 Run｜处置（i）：用本组已有 `K3-18-autonomy-facts.test.ts:119` 的公开 `queryTaskGraph` 读取方式。
- F7-02｜`K3-15-hold-release.test.ts:189`、`:192`｜同例｜直接从 records 派生内部投影后断言 held｜处置（i）：同一公开 `queryTaskGraph` 路径。
- F7-03｜`K3-16-approval-application.test.ts:307`｜245“同意审批”｜`records.eventAt` 解事件后断言 proof／review｜处置（i）：经 `readDecisionAnswer` 与公开 `readReview` 检验落实及 revisions；缺 helper：若必须单独验证 proof，读取正式公开历史接口的 proof，不暴露 RecordStore。
- F7-04｜`K3-16-approval-application.test.ts:365`｜339“不同意审批”｜同样从 RecordStore 事件断言｜处置（i）：使用相同公开决定读取与 review 读取路径。
- F7-05｜`K3-16-proposal-write.test.ts:110`｜86“proposal_recorded、重放、同身份不同内容”｜通过 `eventAt` 证明事件 change 和 proposals｜处置（i）：用 `helpers/K3-proposal-round.ts:277` 的公开 `readK3Review` 检验写入和重放；缺 helper：事件名称若须独立证明，接正式公开历史读取。
- F7-06｜`K3-18-review-card-queue.test.ts:126` → `scenarios/harness.ts:1063` → `:684`、`:688`｜194“暂停目标队列”｜`restart({crash:true})` 默认执行直接读取存储的 invariant 断言｜处置（i）：该用例的重启关闭这项内部 invariant，继续通过 `reviewOf`，`:109` 和 `queue`，`:186` 断言公开行为。

**F8**

- F8-01｜`K3-16-approval-application.test.ts:214`、`:215`｜196“审批卡可用、两个选项、全文”｜expected label 直接引用生产 `UNKNOWN_CALL_APPROVAL_OPTION_LABELS`｜处置（i）：在现有 `readK3ReviewCard`，`helpers/K3-proposal-round.ts:620` 的公开结果上断言 lead 冻结的字面 label；当前文字出处缺失，见 OPEN QUESTIONS。
- F8-02｜`K3-18-review-card-queue.test.ts:311`｜301“混合卡四选项及混合提示”｜expected 混合句取自生产常量｜处置（ii）：移到 `tests/runtime/K3-18-review-card-pure.test.ts`，测试 `unknownCallReviewCardFacts`，期望句按 `slice-K3-SPEC.md:433` 写字面值。
- F8-03｜`K3-18-review-card-queue.test.ts:358`｜354“无可提案命令时三选项、无混合句”｜negative expected 仍取生产常量，常量漂移可能同步改变搜索目标｜处置（ii）：移到同一 `K3-18-review-card-pure.test.ts`，测试 `unknownCallReviewCardFacts`，使用规格字面句。

**F9**

- F9-01｜`helpers/K3-proposal-round.ts:347`、`:356`｜全部 `claimK3ReviewRound` 调用｜最多 500 次轮询，间隔 10ms，靠时序等待 entered｜处置（i）：缺 helper：在真实模型第一请求或真实依赖入口放 A3 到达 gate，收到到达信号后公开读取 entered；不用 sleep。

**F10**

- 本组未确认 F10 实例。应用提交次数的包装直接计其目标提交，没有把某个公开操作预算偷换为更内层次数；例如 `K3-17-disposition-replay.test.ts:109` 对应应用补记次数。

**F11**

- F11-01｜`K3-15-list-by-task.test.ts:54`、`:55`、`:64`｜51“按任务过滤、分页与一页结果相同、不重复”｜只为所查任务造一条记录；其 Run 标识先生成、排序靠前，生成器见 `helpers/B2-crr-world.ts:56`。把生产 `tasks/unknown-call-review-service.ts:1566` 的 nextCursor 固定为 null，当前目标结果仍可是同一条｜处置（i）：沿 `helpers/B2-crr-world.ts:111`、`:76` 和 `helpers/K3-35-continuation-fixture.ts:780`，为同一任务通过处置、重排、再运行生成后续记录，再夹入另一任务记录后翻页。
- F11-02｜`K3-15-list-by-task.test.ts:84`｜70“空 taskId 被拒且其他过滤不变”｜只检查 `.every`；空结果也为 true，且世界里没有不同 status 的对照记录，不能保护声称的 status 过滤｜处置（i）：用 `helpers/K3-review-card-fixture.ts:375` 的真实决策记录和 autoSettled 记录形成不同 status，公开列表断言确切 refs 和数量。
- F11-03｜`K3-18-requeue-confirmed.test.ts:150`、`:151`｜116“暂停后仍抑制重复确认卡”｜`pausedAutomationAction` 返回 null 时跳过唯一要求它派生 system_requeue 的断言；把该函数整体改成 null，不会使这段失败｜处置（ii）：将这段移到 `tests/runtime/K3-18-requeue-confirmed-pure.test.ts`，直接测试 `pausedAutomationAction`，先明确断言非 null，再断言动作和共享确认规则。
- F11-04｜`K3-18-review-card-queue.test.ts:195`、`:197`、`:214`｜194“暂停目标的队列只有核对卡”｜`control` 只构造请求，`scenarios/support/control.ts:106`、`:107` 没有发送；本例也未写 every_step，默认是 `src/contracts/goal-decisions.ts:40` 的 after_plan_confirmation。删掉暂停分支的阻挡 `state/decision-policy.ts:213`，此例仍未命中该前提｜处置（i）：通过真实设置入口设 every_step，再用 `scenarios/support/control.ts:156` 的 `goalControlled` 发送暂停；公开读回设置和 desiredState 后查询队列。

**F12：超时变更**

D1 把 17 条列为 NEW timeout，6 条列为 RAISED timeout。当前全局默认是 `vitest.config.ts:8` 的 30,000ms。没有发现对下列测试的上调授权；返工 6 第 8 项只授权 K3-35 的 `beforeAll`，见 `.lead-ref/k3-g4b3-rework-6.md:70`。NEW 条目不能仅因名称不是 RAISED 就视为等价移动。

- F12-T01｜`K3-15-hold-release.test.ts:220`，标题 135｜D1:33：新增 120,000ms｜处置（i）：保留真实公开 hold/release/claim 路径，恢复该测试原超时；共享路径采用 `helpers/K3-35-continuation-fixture.ts:443`。
- F12-T02｜`K3-16-approval-application.test.ts:240`，标题 196｜D1:34：新增 180,000ms｜处置（i）：保留 `helpers/K3-proposal-round.ts:620` 的公开卡读取，恢复原超时。
- F12-T03｜`K3-16-approval-application.test.ts:334`，标题 245｜D1:35：新增 180,000ms｜处置（i）：保留 `helpers/K3-proposal-round.ts:654` 的公开决定路径，恢复原超时。
- F12-T04｜`K3-16-approval-application.test.ts:387`，标题 339｜D1:36：新增 180,000ms｜处置（i）：保留同一公开决定路径，恢复原超时。
- F12-T05｜`K3-16-proposal-round-fixture.test.ts:119`，标题 75｜D1:37：新增 180,000ms｜处置（i）：使用修正后的 `helpers/K3-proposal-round.ts:863` 公开提案链，恢复原超时。
- F12-T06｜`K3-16-proposal-round-fixture.test.ts:135`，标题 122｜D1:38：新增 180,000ms｜处置（i）：使用真实 Runtime 崩溃 helper `helpers/K3-proposal-round.ts:542`，恢复原超时。
- F12-T07｜`K3-16-proposal-round-fixture.test.ts:166`，标题 138｜D1:39：新增 180,000ms｜处置（i）：使用同一真实崩溃、结算路径，恢复原超时。
- F12-T08｜`K3-16-proposal-round-fixture.test.ts:218`，标题 171｜D1:40：新增 180,000ms｜处置（i）：保留真实 Runtime 与 `helpers/K3-35-continuation-fixture.ts:850` 的边界读取，恢复原超时。
- F12-T09｜`K3-16-proposal-round-fixture.test.ts:246`，标题 221｜D1:41：新增 180,000ms｜处置（i）：保留真实崩溃与同一边界读取，恢复原超时。
- F12-T10｜`K3-16-proposal-round-fixture.test.ts:270`，标题 251｜D1:42：新增 180,000ms｜处置（i）：使用修正后的 `helpers/K3-proposal-round.ts:807` 核对链，恢复原超时。
- F12-T11｜`K3-16-proposal-write.test.ts:151`，标题 133｜D1:43：新增 120,000ms｜处置（i）：保留公开 `recordProposal` 路径和 `helpers/K3-proposal-round.ts:277` 读取，恢复原超时。
- F12-T12｜`K3-16-proposal-write.test.ts:164`，标题 154｜D1:44：新增 120,000ms｜处置（i）：保留公开拒绝输入路径和同一读取，恢复原超时。
- F12-T13｜`K3-16-proposal-write.test.ts:187`，标题 167｜D1:45：新增 120,000ms｜处置（i）：保留公开字段拒绝路径和同一读取，恢复原超时。
- F12-T14｜`K3-16-proposal-write.test.ts:201`，标题 190｜D1:46：新增 120,000ms｜处置（i）：保留公开合法边界写入，恢复原超时。
- F12-T15｜`K3-18-autonomy-facts.test.ts:154`，标题 140｜D1:47：新增 120,000ms｜处置（i）：保留 `:109` 设置、`:119` 公开任务读取，恢复原超时。
- F12-T16｜`K3-18-autonomy-facts.test.ts:169`，标题 158｜D1:48：新增 120,000ms｜处置（i）：保留同一公开设置、读取路径，恢复原超时。
- F12-T17｜`K3-18-autonomy-facts.test.ts:191`，标题 173｜D1:49：新增 120,000ms｜处置（i）：保留公开 hold/release 与任务读取，恢复原超时。
- F12-T18｜`K3-16-approval-application.test.ts:410`，标题 390｜D1:53：120,000→180,000ms｜处置（i）：沿修正后的 `cleanAwaitingApproval`，`:159` 保留真实轮次链，恢复 120,000ms。
- F12-T19｜`K3-16-approval-application.test.ts:426`，标题 415｜D1:54：120,000→180,000ms｜处置（i）：沿公开卡读／答复路径恢复 120,000ms。
- F12-T20｜`K3-16-approval-application.test.ts:458`，标题 429｜D1:55：120,000→180,000ms｜处置（i）：沿公开答复、hold、落实路径恢复 120,000ms。
- F12-T21｜`K3-16-approval-application.test.ts:471`，标题 461｜D1:56：120,000→180,000ms｜处置（i）：沿公开拒绝输入路径恢复 120,000ms。
- F12-T22｜`K3-16-proposal-write.test.ts:249`，标题 216｜D1:57：120,000→180,000ms｜处置（i）：沿公开 proposal 写入与读取路径恢复 120,000ms。
- F12-T23｜`K3-18-review-card-queue.test.ts:494`，标题 423｜D1:58：120,000→240,000ms｜处置（i）：使用 F6-08、F4-15 指定的真实故障／文件 helper，恢复 120,000ms。

**F12：移出多条目场景时未找到等价承接的断言**

这里不要求恢复违规造态。裁决要求把存在纯函数承接面的行为移入纯测试；“场景必须改单条”不能自动授权丢掉这些纯行为。

- F12-D01｜D1:154，旧 `K3-06-mixed-kinds-owner.test.ts:182`，混合三种条目标题｜三个 contained 值的保留断言消失；当前 `:136` 只查单条，纯文件 `runtime/K3-06-mixed-kinds-pure.test.ts:114` 起未查这一字段｜处置（ii）：移入该 pure 文件，测试 `newUnknownCallReview` 的多条目字段保留。
- F12-D02｜D1:171，旧 `K3-13-two-items-owner.test.ts:190`，两条命令标题｜创建后的双 alias 顺序断言未承接｜处置（ii）：移入 `runtime/K3-06-mixed-kinds-pure.test.ts` 的 K3-13 行，测试 `newUnknownCallReview`。
- F12-D03｜D1:174，旧 `K3-13-two-items-owner.test.ts:194`｜两个 argumentsDigest 的保留断言未承接；纯 helper 构造摘要不等于断言输出保留｜处置（ii）：移入同一 pure 文件，测试 `newUnknownCallReview`，期望摘要从字面参数独立手算。
- F12-D04｜D1:186，旧 `K3-13-two-items-owner.test.ts:261`｜定稿后的双 alias 顺序断言未承接｜处置（ii）：移入同一 pure 文件，测试 `transitionUnknownCallReview`。
- F12-D05｜D1:187，旧 `K3-13-two-items-owner.test.ts:262`｜定稿后的两条 kind 保留断言未承接；纯文件 `:168` 只查创建时｜处置（ii）：移入同一 pure 文件，测试 `transitionUnknownCallReview`。
- F12-D06｜D1:194，旧 `K3-15-disposition-effects.test.ts:256`，四种卡处置标题｜混合作用对象 `#1、#2` 的明确存在断言丢失；其他文件的 `indexOf` 比较不能代替存在断言｜处置（ii）：移到 `tests/runtime/K3-15-disposition-effects-pure.test.ts`，测试 `assembleUnknownCallReviewSection` 与 `renderContinuationBriefZh`。
- F12-D07｜D1:199，旧 `K3-15-disposition-effects.test.ts:278`，无作用对象标题｜无目标的卡上 rerun 字面行被改成直接 hold 前置，没有等价断言；该卡并非已证明不可达，见 STATIC｜处置（i）：用修正后的 `K3-15-disposition-effects.test.ts:164` 文件故障公开 helper，在真实无目标决策卡上 rerun 后检查原字面行。
- F12-D08｜D1:200，旧 `K3-15-disposition-effects.test.ts:291`，rerun 渲染标题｜第二处混合作用对象存在断言丢失｜处置（ii）：移到 `K3-15-disposition-effects-pure.test.ts`，测试同一组纯 assembler／renderer。
- F12-D09｜D1:202，旧 `K3-15-disposition-effects.test.ts:295`｜“作用对象行在平台条目行之前”的约束未完整承接｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`，先断言两行存在再比位置。
- F12-D10｜D1:203，旧 `K3-15-disposition-effects.test.ts:296`｜“平台条目行在固定提醒之前”的约束未承接｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`。
- F12-D11｜D1:204，旧 `K3-15-disposition-effects.test.ts:357`，文件批注标题｜`workspace.status === 'captured'` 的断言消失；当前 `:383` 的 inventory 断言不是替代｜处置（i）：在修正后的真实文件故障／capture 路径 `:164` 保留公开 review 的 captured 断言。
- F12-D12｜D1:213，旧 `K3-16-approval-application.test.ts:140`，审批前置｜两个 proposalTargets 的推导未移到纯状态测试；`runtime/K3-16-review-extremes-pure.test.ts:94` 是把 targets 当输入传入｜处置（ii）：移到 `tests/runtime/K3-16-targets-pure.test.ts`，测试 `newUnknownCallReview` 的目标集合推导。
- F12-D13｜D1:214，旧 `K3-16-approval-application.test.ts:141`｜三个 dispositionTargets 的推导未承接｜处置（ii）：移到同一 `K3-16-targets-pure.test.ts`，测试 `newUnknownCallReview`。
- F12-D14｜D1:219，旧 `K3-16-approval-application.test.ts:235`，混合审批摘要标题｜审批摘要最后必须带混合提示的断言消失；纯摘要例 `runtime/K3-16-review-extremes-pure.test.ts:117` 只有 process 条目｜处置（ii）：移到 `tests/runtime/K3-16-review-extremes-pure.test.ts`，测试 `unknownCallReviewSummary`，用规格字面混合句。
- F12-D15｜D1:225，旧 `K3-16-proposal-round-fixture.test.ts:83`，混合提案前置｜三个 dispositionTargets 的断言消失｜处置（ii）：移到 `K3-16-targets-pure.test.ts`，测试 `newUnknownCallReview`。
- F12-D16｜D1:226，旧 `K3-16-proposal-round-fixture.test.ts:84`｜两个 proposalTargets 的断言消失｜处置（ii）：移到同一 pure 文件，测试 `newUnknownCallReview`。
- F12-D17｜D1:227，旧 `K3-16-proposal-round-fixture.test.ts:86`｜平台条目 kind／undetermined 的输出保留未承接；在 builder 中写入不等于验证输出｜处置（ii）：移到同一 pure 文件，测试 `newUnknownCallReview`。
- F12-D18｜D1:228，旧 `K3-16-proposal-round-fixture.test.ts:87`｜平台 callId 必须进入 dispositionTargets 的断言消失｜处置（ii）：移到同一 pure 文件，测试 `newUnknownCallReview`。
- F12-D19｜D1:229，旧 `K3-16-proposal-round-fixture.test.ts:88`｜平台 callId 必须排除于 proposalTargets 的断言消失；手填 `platformTargets` 的 renderer 行不保护这项推导｜处置（ii）：移到同一 pure 文件，测试 `newUnknownCallReview`。
- F12-D20｜D1:235，旧 `K3-16-proposal-round-fixture.test.ts:165`，12 条极值标题｜12 个 proposal 写入后的数量断言没有承接；现 pure codec `runtime/K3-16-review-extremes-pure.test.ts:198` 检查的是 12 个 items｜处置（ii）：移到 `tests/runtime/K3-16-proposals-pure.test.ts`，通过 `transitionUnknownCallReview` 的 proposal_recorded 迁移验证多目标保留。
- F12-D21｜D1:245，旧 `K3-16-proposal-write.test.ts:214`，预算和 alias 顺序标题｜保存数组按 alias 排序的断言消失；纯摘要 `runtime/K3-16-review-extremes-pure.test.ts:128` 只证明 renderer 排序｜处置（ii）：移到 `K3-16-proposals-pure.test.ts`，测试 `transitionUnknownCallReview`；对应生产排序是 `state/unknown-call-review.ts:341`、`:342`。
- F12-D22｜`K3-18-review-card-queue.test.ts:483`、`:485`｜423“文件变更使旧批注失效”｜只恢复拒绝和重读，没有恢复新摘要批注成功；返工 6 第 5 项明确要求 rejection、re-read、passing 三者，见 `.lead-ref/k3-g4b3-rework-6.md:60`、`:61`｜处置（i）：沿 F4-15 的真实文件 helper，用重读的新 objectKey 提交一次有效批注，并公开读回答复。

**默认禁止，但不冒充某个 F 编号**

- A1 形状｜`helpers/K3-proposal-round.ts:383`｜`claimK3ReviewRound` 接收整份 review record｜处置（i）：helper 仅收 reviewRef、phase、公开 expected revision，并在内部公开读取。
- A1 形状｜`helpers/K3-proposal-round.ts:588`｜`settleK3Review` 接收整份 review record｜处置（i）：helper 仅收 reviewRef 与操作标识，内部公开读取当前记录。
- A1 形状｜`helpers/K3-proposal-round.ts:620`｜`readK3ReviewCard` 接收整份 record｜处置（i）：改为 reviewRef／公开来源标识输入。
- A1 形状｜`helpers/K3-proposal-round.ts:654`｜`answerK3Disposition` 接收整份 record｜处置（i）：改为公开卡 source、选项、文字、批注输入。
- A1 形状｜`helpers/K3-proposal-round.ts:807`｜`runK3ReviewRound` 接收整份 record｜处置（i）：改为 reviewRef 和脚本回复输入，内部完成真实读取、claim、Runtime 调用。
- A1 形状｜`helpers/K3-proposal-round.ts:754`、`:755`、`:756`｜回调接收 item，调用者可由事实对象生成输入｜处置（i）：提案 helper 仅收按公开 alias 指定的命令、目录、理由或脚本回复。
- A1 形状｜`K3-15-hold-release.test.ts:80`｜`workspaceRevision` 为前置 pin 直接读取 store｜处置（i）：缺 helper：通过公开 Workspace 查询读取 revision。
- A1 形状｜`helpers/K3-proposal-round.ts:331`｜核对轮 helper 为前置 pin 直接读取 store｜处置（i）：同一公开 Workspace 查询 helper。
- A1/A2 形状｜`K3-15-hold-release.test.ts:230`｜224 的服务构造故意缺失内部 taskProjection；这不是包装真实依赖的失败｜处置（i）：缺 helper：在真实 taskProjection reader 外包一次 unavailable 故障，保留真实前置和公开 unchanged 读取。
- 双后端｜`K3-15-disposition-effects.test.ts:150`、`:151`｜该文件 8 个定义、11 个展开例都固定 SQLite；没有 Host 重启豁免｜处置（i）：让 `openWorld` 收 backend，沿已接受的 `helpers/K3-35-continuation-fixture.ts:637`、`:646` 的共享后端方式跑 memory、SQLite。
- A5｜`K3-15-disposition-effects.test.ts:264`｜219 四选项例中的手造 brief 渲染部分｜处置（ii）：移到 `tests/runtime/K3-15-disposition-effects-pure.test.ts`，测试 `assembleUnknownCallReviewSection`／`renderContinuationBriefZh`，场景保留公开处置断言。
- A5｜`K3-15-disposition-effects.test.ts:303`｜285 无目标渲染部分｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`。
- A5｜`K3-15-disposition-effects.test.ts:313`｜308 rerun 字面行和顺序｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`。
- A5｜`K3-15-disposition-effects.test.ts:325`｜321 skip 字面行｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`。
- A5｜`K3-15-disposition-effects.test.ts:345`｜334 released handle_myself 字面行｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`。
- A5｜`K3-15-disposition-effects.test.ts:355`｜349 自动定稿字面行｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`。
- A5｜`K3-15-disposition-effects.test.ts:365`｜362 的 61→60 截断｜处置（ii）：移到同一 pure 文件，测试 `renderContinuationBriefZh`。
- A5｜`K3-15-disposition-effects.test.ts:409`、`:416`｜375 的 codec、手造 brief 渲染部分｜处置（ii）：移到同一 pure 文件，测试 `encodeUnknownCallReview`／`decodeUnknownCallReview`／`renderContinuationBriefZh`；公开批注落实留在场景。
- A5｜`K3-18-review-card-queue.test.ts:301`｜混合卡形状｜处置（ii）：移到 `tests/runtime/K3-18-review-card-pure.test.ts`，测试 `unknownCallReviewCardFacts`。
- A5｜`K3-18-review-card-queue.test.ts:321`｜目标文件对象｜处置（ii）：移到同一 pure 文件，测试 `unknownCallReviewCardFacts`。
- A5｜`K3-18-review-card-queue.test.ts:337`｜31 个文件对象上限｜处置（ii）：移到同一 pure 文件，测试 `unknownCallReviewCardFacts`／`unknownCallReviewTargetPaths`。
- A5｜`K3-18-review-card-queue.test.ts:354`｜无可提案对象时三个选项｜处置（ii）：移到同一 pure 文件，测试 `unknownCallReviewOptions`。
- A5｜`K3-18-review-card-queue.test.ts:361`｜7 个已用槽位时三个选项｜处置（ii）：移到同一 pure 文件，测试 `unknownCallReviewOptions`。
- A5｜`K3-18-review-card-queue.test.ts:368`｜取消 Goal／非 active Task 的历史卡｜处置（ii）：移到同一 pure 文件，测试 `unknownCallReviewCardFacts`。
- A5｜`K3-18-requeue-confirmed.test.ts:137`｜手组参数直接测确认策略｜处置（ii）：移到 `tests/runtime/K3-18-requeue-confirmed-pure.test.ts`，测试 `automationConfirmationCause`。
- A5｜`K3-18-requeue-confirmed.test.ts:150`、`:153`｜暂停策略纯判断｜处置（ii）：移到同一 pure 文件，测试 `pausedAutomationAction` 与 `automationConfirmationCause`。
- A6｜`K3-06-mixed-kinds-owner.test.ts:212`、`:214`｜181 的手造拒绝 draft 没放在 `describe('rejects: …')`，前置又继承 world 禁项｜处置（i）：在修正后的公开识别前置上，仅改合法 draft 的 kind，放入 rejects 块，保留精确 reason 和公开 not_found；不把该行另判 F11，因为 `:219` 的精确 reason 确实针对 L3 检查。
- A6｜`K3-15-list-by-task.test.ts:75`｜70 的空 taskId 拒绝行没有 rejects 分组，后读又可空真｜处置（i）：公开建立前置、放入 rejects 块，公开列表断言确切原记录仍在。
- A6｜`K3-16-proposal-write.test.ts:160`｜154 的越界 alias 拒绝行没有 rejects 分组，`:163` 只比长度｜处置（i）：公开进入真实提案轮，放入 rejects 块，拒绝前后用 `readK3Review` 比完整值。
- A6｜`K3-16-proposal-write.test.ts:171`｜167 中 command 4001 bytes｜处置（i）：独立 rejects 参数行；公开前置；公开 review 完整 unchanged。
- A6｜`K3-16-proposal-write.test.ts:172`｜167 中 empty command｜处置（i）：同一公开拒绝 helper，独立一错一行。
- A6｜`K3-16-proposal-write.test.ts:173`｜167 中 cwd 513 bytes｜处置（i）：同一公开拒绝 helper，独立一错一行。
- A6｜`K3-16-proposal-write.test.ts:174`｜167 中 empty cwd｜处置（i）：同一公开拒绝 helper，独立一错一行。
- A6｜`K3-16-proposal-write.test.ts:175`｜167 中 empty rationale｜处置（i）：同一公开拒绝 helper，独立一错一行。
- A6｜`K3-16-proposal-write.test.ts:176`｜167 中 rationale 2001 units｜处置（i）：同一公开拒绝 helper，独立一错一行。
- A6｜`K3-16-proposal-write.test.ts:235`、`:238`｜216 的 5121 拒绝半行没有 rejects 分组，“byte-identical”实际只比 JSON 字节数，定义在 `:48`｜处置（i）：公开前置与拒绝保持，公开读取后比较完整记录。
- A6｜`K3-16-approval-application.test.ts:465`｜461 中 `safer_method` 非审批选项｜处置（i）：放入独立 rejects 参数行，拒绝后公开读取 review／答复证明未变。
- A6｜`K3-16-approval-application.test.ts:465`｜461 中 `rerun_as_is` 非审批选项｜处置（i）：同一公开拒绝 helper，独立一错一行。

**T，只记录，不把 G6 调用者转入 T**

- T／F1、F3｜`helpers/B2-execution-fixture.ts:211`、`:225`、`:277`、`:291`、`:301`｜手造 prepared 与进入事实｜处置（iv）：按 `.lead-ref/k3-b3-rulings-v1.md:10` 留在 T；本组没有因此获得用它造前置的豁免。
- T／F2、F3｜`helpers/B2-runtime-fixture.ts:194` 的既有初始化覆盖／写入部分｜处置（iv）：按同一裁决留 T；G6 直接使用的 `createScriptedModel`，`:69` 是脚本回复入口，本体裁为 A1，不把整文件一概判为禁用。

**3. ROWS**

下列“会”只表示所列分支的静态敏感性，不消除前述造态、helper、后端或断言来源问题。共享前置失败也不算被测检查受到保护。

| 规格行／测试定位 | 断言字面值及来源 | 后端 | 删除所列生产行为后的静态判断 |
|---|---|---|---|
| K3-06；`K3-06-mixed-kinds-owner.test.ts:126` | 单条 shell/process/pending、claim 后 revision 2、结论后再定稿 revision 4；状态来自 L3、L14–16，revision 是创建 1＋claim＋结论＋定稿手算；不是规格 `slice-K3-SPEC.md:1413` 原三种同批的完整证明 | memory＋SQLite | 会：`state/unknown-call-review.ts:796` 的 process→pending、`:294` 的结论迁移、`:436` 的定稿。单条例不保护多种类分流 |
| L3 拒绝；`K3-06-mixed-kinds-owner.test.ts:218` | `invalid`＋精确 `review item #1 kind disagrees with L3`；映射来自规格 L3，拒绝文案是实现字面而非规格固定中文 | 两者 | 会：删除 `tasks/run-reconcile-service.ts:263` 的 kind 检查，精确 reason 不再成立；没有将“还有其他可能问题”误报成必然 F11 |
| RUN-20 前置；`K3-06-mixed-kinds-owner.test.ts:207` | `ended/outcome_unknown`；只证明该拒绝例的前置，不证明 RUN-25 | 两者 | 对真实 reconcile 输出敏感；不据此宣称完整 RUN-20／RUN-22 矩阵覆盖 |
| K3-13；`K3-13-two-items-owner.test.ts:83` | `needs_decision`、单条 `undetermined/settlement`、“核对轮没有给出结论”、原因 `['undetermined','crash_undetermined']`；来源 `slice-K3-SPEC.md:407`、`:411`、`:1427`；“没有自查依据”缺固定字面出处，见问题 1 | 两者 | 会：`state/unknown-call-review.ts:668` 的未结论补齐、`:699`、`:701` 的原因；本例只覆盖单条未写结论，多条差异应由 pure 承接 |
| K3-15（一）；`K3-15-disposition-effects.test.ts:219` 的 rerun 参数 | `resolved`，观察不改、choice rerun；来源规格 `:445`、`:446` | 仅 SQLite | 会：`state/unknown-call-review.ts:537`；未证明真实 continuation prepare |
| K3-15（二）；同 `:219` 的 skip 参数 | `resolved`、一个 blockedCommands、固定阻止重跑句；来源规格 `:447`、`:453`、`:568` | 仅 SQLite | 会：`state/unknown-call-review.ts:527`、`src/contracts/continuation-brief.ts:934`；本组这例没有公开 Kernel 历史断言那条仍 outcome_unknown |
| K3-16／UCR-10；同 `:219` 的 safer 参数 | `awaiting_proposal`、stateEntry＋1；规格 `:448`、`:547` | 仅 SQLite | 会：`state/unknown-call-review.ts:522` |
| K3-15（三）；同 `:219` 的 handle 参数 | `resolved`、held、card；规格 `:449`、`:591` | 仅 SQLite | 会：`state/unknown-call-review.ts:532`；该例本身未覆盖重启后仍 held、人的 requeue 被挡 |
| L20 空目标；`K3-15-disposition-effects.test.ts:301`、`:304` | targets/platformTargets 都空；`- 作用对象：无。`；规格固定格式 `:564`，空集合按字面手算 | 仅 SQLite | 会：`src/contracts/continuation-brief.ts:918`；当前覆盖 direct hold，不等价于被删的无目标 rerun 卡例 |
| L20 rerun；同文件 `:314`、`:317` | rerun 字面行、`#1`、固定提醒、行顺序；规格 `:563`、`:564`、`:567`、`:570` | 仅 SQLite | 会：`src/contracts/continuation-brief.ts:913`、`:918`、`:931` |
| L20 skip；同文件 `:326`、`:328`、`:331` | skip 字面行、一条被阻止命令、相邻固定句；规格 `:568`、`:570` | 仅 SQLite | 会：`state/unknown-call-review.ts:530`、`src/contracts/continuation-brief.ts:934` |
| L20 released handle；同文件 `:341`、`:346` | revision＋1、released、人工处理字面句；规格 `:603`、`:570` | 仅 SQLite | 会：`state/unknown-call-review.ts:607` 和 renderer 处置行 |
| L20 auto；同文件 `:352`、`:356` | resolved/disposition null、“核对自动定下，不用决定（自动）”、无目标；规格 `:570` | 仅 SQLite | 会：`state/unknown-call-review.ts:802`、`src/contracts/continuation-brief.ts:904` |
| L20 附言；同文件 `:369`、`:371`、`:372` | 61 个“字”截成 60，加截断后缀；60 来自规格 `:563`；计数由字面输入手算 | 仅 SQLite | 会：`src/contracts/continuation-brief.ts:911`、`:912` |
| L18／L20 批注；同文件 `:407`、`:412`、`:417`、`:418` | record path null、文件 path `src/x.ts`，两条字面批注；来自本例提交的用户输入和规格 `:428`、`:435` | 仅 SQLite | 会：`tasks/unknown-call-review-service.ts:353` 的注记转换、`:1372` 的保存、`src/contracts/continuation-brief.ts:851` 的渲染；故障前置与文件读取仍不合规 |
| K3-15（四）；`K3-15-hold-release.test.ts:112`、`:121` | rev3、resolved/held/direct、activeRound 保留；release busy“核对轮还没收尾”；规格 `:594`、`:598`、`:603` | 两者 | hold 与 release 检查敏感：`state/unknown-call-review.ts:594`，`tasks/unknown-call-review-service.ts:1131`；但 `reviewClaim`，测试 `:70` 仅 claim，不能宣称已覆盖“正在跑”的 Runtime 生命周期 |
| K3-15（四）重放；同文件 `:125`、`:130` | 同请求等回执＋replayed，新请求 busy“已经在等你处理”；规格 `:602` | 两者 | 会：hold 的回执重放和 held guard；未以公开读取单独证明新请求没有副写 |
| K3-15（五）；同文件 `:141`、`:184`、`:208`、`:213`、`:219` | 自动 resolved→held→released；held 时 claim busy `unknown_call_review_held`，release 后 claim committed；规格 `:593`、`:603`、`:605` | 两者 | 会：hold/release 迁移与 claim 的 review blocker；内部投影断言部分仍 F7 |
| D3 缺投影；同文件 `:237`、`:238` | unavailable、0 commit；规格 `:595` 要求同一投影守卫 | 两者 | 会：`tasks/unknown-call-review-service.ts:979`；只是缺依赖构造检查，不是有效 A2 场景 |
| L19a 按任务列表；`K3-15-list-by-task.test.ts:60`、`:64`、`:67` | 只返回 task A 的一个 ref，limit1 等于 limit100；手算两个任务各一记录 | 两者 | 任务过滤 `tasks/unknown-call-review-service.ts:1563` 删除会失败；续页 `:1566` 删除不会，F11 |
| 列表空 taskId；同文件 `:77` | invalid；公开输入非空契约，生产 `tasks/unknown-call-review-service.ts:1483` | 两者 | 删除该检查会使拒绝断言失败；`:84` 不能证明其他过滤正确 |
| K3-16 审批卡；`K3-16-approval-application.test.ts:203`、`:214`、`:232` | available、approve/decline、原命令与方案全文；内容字面来自 `:129` 和方案输入；全文要求规格 `:553`、`:1430`；label 取生产常量，F8 | 两者 | 摘要内容会：`tasks/unknown-call-review-card.ts:137`、`:143`；label 同步改常量不一定失败 |
| K3-16／UCR-12；同文件 `:274`、`:299` | approve→resolved、批准方法、原命令 SHA／动作与 blockedCommands；来源规格 `:555`、L19a；SHA 期望是本例固定命令的独立字面值；unavailable 展开原因却来自 helper 替身 | 两者 | 会：`state/unknown-call-review.ts:567`、`:570`，`tasks/unknown-call-review-service.ts:155`；事件 proof 检查方式 F7 |
| K3-16 approve 重放；同文件 `:329`、`:331` | 第二报告相等、提交不增、公开 review 不变；裁决 §3.1 接受的重放形状 | 两者 | 会：`tasks/unknown-call-review-service.ts:1231`；不是 F8 的“抄输出” |
| K3-16／UCR-13；同文件 `:339`、`:386` | decline→needs_decision、proposal_declined、恢复处置卡；规格 `:589` | 两者 | 会：`state/unknown-call-review.ts:560`；事件断言仍 F7 |
| K3-45（四）；同文件 `:390`、`:409` | 7 条 rounds→剩1槽→三选项，safer invalid；8−7＝1，规格 `:432`、`:1438` | 两者 | 选项检查会：`tasks/unknown-call-review-card.ts:113`；只删除深层 state 的重复槽位 guard `state/unknown-call-review.ts:519`，上游卡选项仍可拒绝，不能声称该测试单独保护深层检查 |
| L18 旧卡；同文件 `:421`、`:423` | revision_conflict，公开 review 不变；规格 `:436` | 两者 | 对公开答复的版本钉核对敏感；没有覆盖所有内部重复版本检查 |
| L19 捕获后变更；同文件 `:439`、`:456` | 先保存答复，再真实 hold，再落实 revision_conflict；规格 `:438`、`:442` | 两者 | 会：`tasks/unknown-call-review-service.ts:1276`；删除后进入其他状态拒绝，错误码不会仍是此 revision_conflict |
| L18 非卡选项；同文件 `:465`、`:468` | safer_method／rerun_as_is 在审批卡 invalid；规格 `:432`、`:435` | 两者 | 对公开卡选项检查敏感；不能据此证明所有深层检查分别敏感 |
| K3-16 提案链；`K3-16-proposal-round-fixture.test.ts:83`、`:99`、`:107`、`:118` | needs_decision→awaiting_proposal→awaiting_approval、单目标有方案、tool success；规格 `:548`、`:553` | 两者 | 状态／方案落盘会失败；删除 Runtime 中真实工具调用接线不一定使直接 handler 这项失败，见 F3-13 |
| UCR-06；同文件 `:122`、`:134` | 第一 unfinished 保留方案和 awaiting_proposal；规格 `:396`、UCR-06 `:1257` | 两者 | 会：`tasks/unknown-call-review-service.ts:926`、`:933` 与 `state/unknown-call-review.ts:351` |
| UCR-08／K3-45（二）；同文件 `:138`、`:165` | 第二 unfinished→needs_decision、review_incomplete | 两者 | 会：`state/unknown-call-review.ts:464`、`:475`；规格 `:1438` |
| K3-35 review entry 子链；同文件 `:171`、`:189`、`:203` | real running→completed、history endPosition 与公开 Session cursor 对齐；位置比较是身份一致性，不是固定容量值 | 两者 | 对 Runtime 保存终态／历史绑定敏感；此例未量 256KiB 或最坏输入，不能充作完整 K3-35，规格容量行在 `:1435` |
| K3-35 unfinished entry 子链；同文件 `:221`、`:230`、`:245` | crashed 终态与真实边界一致；来自 A2 beforeReply 故障和公开 history 读取 | 两者 | 对 Runtime 终态和边界保存敏感；同样不是 K3-35 容量验收 |
| K3-45 setup／UCR-04、07；同文件 `:251`、`:258` | done/unlikely→resolved；规格 `:1424` | 两者 | 会：结论迁移 `state/unknown-call-review.ts:294`、原因／定稿 `:448`；D6 显示来源被 F4 替换 |
| UCR-05／L14；`K3-16-proposal-write.test.ts:97`、`:107`、`:119`、`:129` | committed、proposal id 形状、原回执 replay、同身份不同内容冲突；规格 `:379`、`:380`、`:549` | 两者 | 会：`tasks/unknown-call-review-service.ts:710`、`:713`、`:722`；`:123` 只证明长度相同 |
| UCR-05 替换；同文件 `:146`、`:150` | 仍一份方案、内容为第二次输入、id 不同；规格 `:549` 沿 L14 | 两者 | 会：`state/unknown-call-review.ts:341` 的按 callId 替换 |
| proposalTargets 拒绝；同文件 `:161` | alias2 invalid；当前记录只有 alias1，手算 | 两者 | 会：`state/unknown-call-review.ts:335`；没有另一个同级 alias 存在性 guard 可直接替它兜底，未判“双错误” |
| L20 字段上限；同文件 `:171`、`:184` | command 4001／0、cwd513／0、rationale0／2001 都 invalid；4000、512 来自规格 `:550`，rationale 1..2000 来自 `:856`、`:1202`；cwd 空串未见明确最小值，见问题 2 | 两者 | 对 owner 检查 `tasks/unknown-call-review-service.ts:679`、`:689`、`:699` 敏感；未执行删除检查实验 |
| L20 合法边界；同文件 `:195`、`:199` | 4000／512／2000 原样保存；规格同上，ASCII 字节和“理”的 UTF-16 units 手算 | 两者 | 对保存内容行为敏感；合法边界正例单独不保护上限，需与上一拒绝行配对 |
| K3-16 5120 预算；同文件 `:227`、`:228`、`:237`、`:248` | 固定前缀28；28＋4000＋2×546＝5120；28＋3999＋2×547＝5121；来源规格 `:550`、`:571` 的字面格式 | 两者 | 会：`state/unknown-call-review.ts:343`；记录“未变”部分只比长度，尚不满足 A6 |
| K3-45（二）完整方案仍 unfinished；`K3-16-second-unfinished-proposal.test.ts:127` | 原因恰好 `['review_incomplete']`，2 次 unfinished，方案保留；规格 `:396`、`:1438` | 两者 | 会：`state/unknown-call-review.ts:475` 的 `!second` 条件 |
| K3-45（二）缺方案；同文件 `:155` | `['review_incomplete','proposal_missing']` 固定顺序；规格 `:411`、`:554`、`:1438` | 两者 | 会：`state/unknown-call-review.ts:479`、`:704` |
| K3-45（三）stateEntry；同文件 `:170`、`:178`、`:187` | 新 stateEntry＋1，第一次仍 awaiting，第二次 needs_decision；规格 `:396`、`:1438` | 两者 | 会：`tasks/unknown-call-review-service.ts:926` 的 stateEntry 限定；但该例通过“第二次 unfinished 后再选 safer”重入，不是规格文字中的“不同意后重入”全过程 |
| K3-17 重放；`K3-17-disposition-replay.test.ts:72`、`:80`、`:83` | 相同 ② 回执，③ 只一次；规格 `:443`、`:444` | 两者 | 会：`tasks/unknown-call-review-service.ts:1231`、`communication/decision-service.ts:1080` |
| K3-17 ③写失败重试；同文件 `:88`、`:99`、`:109` | 首次补记失败、重试复用 ②、补记一次；规则 A2 点名允许 | 两者 | 会：`src/business/workflow/decision-actions.ts:481`、`:486` 的补记流程 |
| K3-17 ③读失败重试；同文件 `:114`、`:125` | 同一 ② receipt 保留，之后补记 | 两者 | 会：`src/business/workflow/decision-actions.ts:472`、`:477` 的 receipt 处理 |
| K3-17 旧卡；同文件 `:149`、`:160`、`:162` | 答旧卡与落实旧答复都 revision_conflict，公开 record 保留 | 两者 | 对公开版本钉检查敏感；`tasks/unknown-call-review-service.ts:1276` 对落实半行敏感 |
| K3-18（二）；`K3-18-autonomy-facts.test.ts:146`、`:153` | after_plan_confirmation，无确认 cause | 两者 | 对 `state/decision-policy.ts:35`、`:50` 的自治分支及公开推导接线敏感；当前用 file_edit 自动定稿，不是 process done/unlikely 的整条核对链 |
| K3-18（三）；同文件 `:168` | every_step、只有 file_edit、恰好 system_requeue | 两者 | 会：`state/decision-policy.ts:50`、`tasks/goal-decision-reader.ts:383`；规格 `:613`、`:1432` |
| K3-18（五）；同文件 `:189`、`:190` | release 后 requeueConfirmed true、无普通确认 cause | 两者 | 会：`state/task-failure.ts:1101`、`state/decision-policy.ts:125`；规格 `:611` |
| K3-18（一）；`K3-18-requeue-confirmed.test.ts:131`、`:135`、`:141` | rerun/card/resolved、requeueConfirmed true、无 system_requeue cause | 两者 | 会：`state/task-failure.ts:1096`、`state/decision-policy.ts:125`；前置卡由伪 unavailable 得到，未证明本行前半要求的 done/unlikely＋confirm_each_step |
| K3-18 暂停派生；同文件 `:147`、`:149`、`:151` | 暂停后无 cause；可选检查 paused.action | 两者 | 条件断言不会保护 `pausedAutomationAction` 非 null 派生，F11-03；生产入口在 `tasks/goal-decision-reader.ts:361` |
| K3-18 自动定稿对照；同文件 `:165`、`:169`、`:171` | disposition null、requeueConfirmed false、一个普通确认 cause | 两者 | 会：`state/task-failure.ts:1094`、`state/decision-policy.ts:50`；规格 `:613` |
| K3-18（四）；`K3-18-review-card-queue.test.ts:200`、`:202`、`:214` | 一张核对卡、四个固定 label、无普通卡；label 来源规格 `:66` | SQLite；真实 Host restart 可用 R1 豁免 | 卡形状会受 `tasks/unknown-call-review-card.ts:110` 影响；暂停／every_step 守卫不会受到有效保护，F11-04 |
| L18 混合卡纯形状；同文件 `:304`、`:311`、`:315` | 四选项、3 pins、仅 aggregate 对象；规格 `:427`、`:432`、`:433`；混合句 expected 为 F8 | 无后端，纯函数 | 选项／pins 会：`tasks/unknown-call-review-card.ts:113`、`:161`；F8 部分不同步独立 |
| L18 文件对象；同文件 `:328`、`:334` | 只为 `src/x.ts` 建对象，不为变化样本 `src/other.ts` 建对象；规格 `:428`，输入手算 | 无后端 | 会：`tasks/unknown-call-review-card.ts:91`、`:173` |
| L18 对象上限；同文件 `:345`、`:346`、`:347` | 总对象32，其中 aggregate1＋file31，保留前31条；上游规格 `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md:229` 的 objects≤32，31为手算 | 无后端 | 会：`tasks/unknown-call-review-card.ts:173` 的 slice；纯行需移文件 |
| K3-45（四）标题实际偏 K3-46（一）；同文件 `:354`、`:357` | 没有 proposalTargets 时三个选项；规格 `slice-K3-SPEC.md:432`、`:1439` | 无后端 | 会：`tasks/unknown-call-review-card.ts:113` 的非空目标条件；这不是轮次空位例 |
| K3-45（四）；同文件 `:362`、`:365` | 7 rounds，8−7＝1，三个选项；规格 `:432`、`:1438` | 无后端 | 会：`tasks/unknown-call-review-card.ts:113` 的 freeSlots≥2 |
| L18 历史卡；同文件 `:371`、`:374` | cancelled→goal_cancelled，inactive→source_resolved；规格 `:437` | 无后端 | 会：`tasks/unknown-call-review-card.ts:178`、`:180` |
| L8 Kernel 不可读后恢复；同文件 `:450`、`:456` | incomplete/kernel_unreadable_at_stop、needs_decision、一个 file_edit、`['inventory_incomplete']`；规格 L8 和返工6第5项 | 两者 | 状态推导会：`state/unknown-call-review.ts:793`；真实故障读取链未被测试，因为 probe 是输入 |
| L18 旧文件批注；同文件 `:471`、`:480`、`:484` | 摘要 A→B；旧 key invalid，理由为对象不在卡内；A/B 是测试常量，没有真实文件来源 | 两者 | 对 `communication/decision-service.ts:820` 的对象成员检查敏感；真实磁盘摘要接线不会被保护，且缺新 key 成功半行 |
| UR2／settle_review 前置；同文件 `:174`、`:177` | Workflow 选中 settle_review 并返回 receipt；原因来自真实缺 read 的 Host grant | SQLite | 对真实 Workflow 能力分支敏感；这部分 A2 形状成立，不能替其他直接填 cause 的 helper 授权 |
| UR7／UR7b 名称边界；`K3-17-disposition-replay.test.ts:66`、`:86`、`:112` | 检查 resolveDecision／应用补记子链 | 两者 | 本组没有完成规格 `slice-K3-SPEC.md:1431` 中两种调用顺序＋暂停恢复的全部 Workflow 行，不能据此宣称 UR7/UR7b 全覆盖 |

本组没有独立的 B2-nn 或 RUN-25 验收行。helper 注释提及 RUN-20／RUN-22、Host crash 前置，并不自动增加规格行覆盖。

**4. LEDGER**

共核对落入 G6 的 155 条账本记录。以下是裁定，不重复抄账本中的旧断言。

- D1:26｜等价保留：当前 `K3-16-approval-application.test.ts:224` 构造独立字面摘要，`:232` 整段 `toBe`；`:238` 只是附加检查。
- D1:33｜弱化：F12-T01。
- D1:34｜弱化：F12-T02。
- D1:35｜弱化：F12-T03。
- D1:36｜弱化：F12-T04。
- D1:37｜弱化：F12-T05。
- D1:38｜弱化：F12-T06。
- D1:39｜弱化：F12-T07。
- D1:40｜弱化：F12-T08。
- D1:41｜弱化：F12-T09。
- D1:42｜弱化：F12-T10。
- D1:43｜弱化：F12-T11。
- D1:44｜弱化：F12-T12。
- D1:45｜弱化：F12-T13。
- D1:46｜弱化：F12-T14。
- D1:47｜弱化：F12-T15。
- D1:48｜弱化：F12-T16。
- D1:49｜弱化：F12-T17。
- D1:53｜弱化：F12-T18。
- D1:54｜弱化：F12-T19。
- D1:55｜弱化：F12-T20。
- D1:56｜弱化：F12-T21。
- D1:57｜弱化：F12-T22。
- D1:58｜弱化：F12-T23。
- D1:147｜前书要求：返工6第3项、返工7第1项要求去掉手造识别提交；当前公开前置在 `K3-06-mixed-kinds-owner.test.ts:194`、`:206`。
- D1:148｜前书要求：返工6第3项＋裁决§2，去掉混合 draft 接受；真实单条创建在当前 `:121`，纯多条创建在 `runtime/K3-06-mixed-kinds-pure.test.ts:112`。
- D1:149｜等价移动：公开读取由 `helpers/K3-proposal-round.ts:277` 保证，当前业务断言在 `K3-06-mixed-kinds-owner.test.ts:126`。
- D1:150｜等价移动：当前单条 `:126`，混合状态 `runtime/K3-06-mixed-kinds-pure.test.ts:114`；单条化依据裁决§2。
- D1:151｜等价移动：`runtime/K3-06-mixed-kinds-pure.test.ts:115`。
- D1:152｜等价移动：同 pure 文件 `:116`。
- D1:153｜等价移动：同 pure 文件 `:118`。
- D1:154｜弱化：F12-D01。
- D1:155｜等价移动：同 pure 文件 `:119`。
- D1:156｜等价移动：同 pure 文件 `:121`。
- D1:157｜等价移动：同 pure 文件 `:122`。
- D1:158｜等价移动：同 pure 文件 `:123`。
- D1:159｜前书要求＋承接：返工6第3项，claim 改共享公开链；当前 `K3-06-mixed-kinds-owner.test.ts:145`，helper `helpers/K3-proposal-round.ts:389`、`:392`。
- D1:160｜等价移动：当前 `K3-06-mixed-kinds-owner.test.ts:146` 的 claim 后状态。
- D1:161｜等价移动：当前 `:150` 的公开结论 helper，其提交拒绝检查在 `helpers/K3-proposal-round.ts:475` 所在函数。
- D1:162｜等价移动：当前 `:154` 的单条结论；多条保留在 `runtime/K3-06-mixed-kinds-pure.test.ts:134`。
- D1:163｜前书要求：返工6第3项要求 Runtime 自己结束；当前 `:161`，真实结束校验在 `helpers/K3-proposal-round.ts:496`。
- D1:164｜等价移动：当前 `K3-06-mixed-kinds-owner.test.ts:164`、`:173`。
- D1:165｜等价移动：当前 `:173`，多条结算在 `runtime/K3-06-mixed-kinds-pure.test.ts:142`。
- D1:166｜等价移动：当前 `K3-06-mixed-kinds-owner.test.ts:220`。
- D1:167｜前书要求：返工6第3项要求删除手造识别提交；当前 `K3-13-two-items-owner.test.ts:54` 经共享公开识别。
- D1:168｜前书要求：裁决§2要求双条 owner 造态移出；纯创建在 `runtime/K3-06-mixed-kinds-pure.test.ts:166`。
- D1:169｜等价移动：当前公开读取由 `helpers/K3-proposal-round.ts:277` 承接。
- D1:170｜等价移动：当前 `K3-13-two-items-owner.test.ts:58`，双条状态在 `runtime/K3-06-mixed-kinds-pure.test.ts:167`。
- D1:171｜弱化：F12-D02。
- D1:172｜等价移动：`runtime/K3-06-mixed-kinds-pure.test.ts:168`。
- D1:173｜等价移动：同 pure 文件 `:169`。
- D1:174｜弱化：F12-D03。
- D1:175｜前书要求＋承接：返工6第3项，当前 `K3-13-two-items-owner.test.ts:66` 公开 claim。
- D1:176｜等价移动：当前 `:67` 的 claim 后状态；纯迁移在 `runtime/K3-06-mixed-kinds-pure.test.ts:172`。
- D1:177｜前书要求：裁决§2移出双条 owner 结论；纯结论迁移在 `runtime/K3-06-mixed-kinds-pure.test.ts:173`。
- D1:178｜等价移动：同 pure 文件 `:177`、`:183`、`:185`，覆盖一条保留结论、另一条待定。
- D1:179｜前书要求：返工6第3项；当前 `K3-13-two-items-owner.test.ts:71` 改由 Runtime 自己结束。
- D1:180｜等价移动：`runtime/K3-06-mixed-kinds-pure.test.ts:177`。
- D1:181｜等价移动：当前 `K3-13-two-items-owner.test.ts:77`、`:83`；纯迁移 `runtime/K3-06-mixed-kinds-pure.test.ts:179`。
- D1:182｜等价移动：当前公开读取 helper 和 `K3-13-two-items-owner.test.ts:83`。
- D1:183｜等价移动：`runtime/K3-06-mixed-kinds-pure.test.ts:180`。
- D1:184｜等价移动：同 pure 文件 `:181`。
- D1:185｜等价移动：同 pure 文件 `:182`。
- D1:186｜弱化：F12-D04。
- D1:187｜弱化：F12-D05。
- D1:188｜等价移动：同 pure 文件 `:183`。
- D1:189｜等价移动：同 pure 文件 `:185`。
- D1:190｜等价移动：同 pure 文件 `:189`，当前单条也在 `K3-13-two-items-owner.test.ts:92`。
- D1:191｜前书要求：返工6第3项要求真实识别；由 `helpers/K3-35-continuation-fixture.ts:744`、`:750` 承接，不能保留旧造态提交。
- D1:192｜同一前书要求；共享 helper 的提交检查在 `helpers/K3-35-continuation-fixture.ts:751`。
- D1:193｜前书要求＋等价改写：真实 pending→settle 多一步，当前 `K3-15-disposition-effects.test.ts:227` 的 revision 2；不是把错误 revision 当容忍范围。
- D1:194｜弱化：F12-D06。
- D1:195｜等价覆盖：同一 continuation renderer 的平台字面句仍在 `runtime/K3-continuation-review-note.test.ts:378`、`:381`；纯文件命名问题不在此行重新扩展审计。
- D1:196｜前书要求：返工6第3项要求换公开可达前置；当前 `K3-15-disposition-effects.test.ts:293` 的自动定稿＋直接 hold 确能产生空 targets，但不能替代 D1:199 的卡上 rerun 行。
- D1:197｜等价行为承接：当前 `K3-15-disposition-effects.test.ts:298` 的直接 hold 提交；其用途是建立空 targets，公开操作种类的改动依据返工6第3项。
- D1:198｜等价移动：当前 `K3-15-disposition-effects.test.ts:301`。
- D1:199｜弱化：F12-D07。
- D1:200｜弱化：F12-D08。
- D1:201｜等价覆盖：`runtime/K3-continuation-review-note.test.ts:381` 的同一平台字面行。
- D1:202｜弱化：F12-D09。
- D1:203｜弱化：F12-D10。
- D1:204｜弱化：F12-D11。
- D1:205｜等价移动：当前 `K3-15-disposition-effects.test.ts:418`；文件从 src/a 改为真实场景的 src/x，文字仍独立字面。
- D1:206｜前书要求：返工6第3项点名 hold-release 的手造识别；当前 `K3-15-hold-release.test.ts:98` 使用共享识别。
- D1:207｜同一前书要求；当前真实识别提交由 `helpers/K3-35-continuation-fixture.ts:750`、`:751` 检查。
- D1:208｜等价移动：当前 `K3-15-hold-release.test.ts:72`、`:105`。
- D1:209｜等价移动：当前 `K3-15-hold-release.test.ts:141`。
- D1:210｜等价移动但检查方式不合规：当前 `K3-15-hold-release.test.ts:180`，另计 F7-01。
- D1:211｜等价移动但检查方式不合规：当前 `K3-15-hold-release.test.ts:192`，另计 F7-02。
- D1:212｜等价移动：当前 `K3-15-hold-release.test.ts:208`。
- D1:213｜弱化：F12-D12。
- D1:214｜弱化：F12-D13。
- D1:215｜等价且按任务书修正来源：当前 `K3-16-approval-application.test.ts:224`、`:232`；原任务书第0项要求独立字面全文，`.lead-ref/k3-g4b3-impl.md:55`。
- D1:216｜等价纯函数承接：`runtime/K3-16-review-extremes-pure.test.ts:128`、`:131` 检查同一摘要函数第二原命令的字面输出；命令输入改为纯例的 `two`。
- D1:217｜等价纯函数承接：同 pure 文件 `:128`、`:132`、`:134`；当前单条全文在 `K3-16-approval-application.test.ts:232`。
- D1:218｜等价纯函数承接：同 pure 文件 `:132`、`:134` 分别核目录 packages/db 与缺省目录，并以反序 proposals 检查对应关系。
- D1:219｜弱化：F12-D14。
- D1:220｜等价移动：当前 `K3-16-approval-application.test.ts:232`、`:238`；没有从返回 proposal 动态生成 expected。
- D1:221｜等价单条承接：当前 `K3-16-proposal-round-fixture.test.ts:106`；单条化依据返工6第3项。
- D1:222｜等价单条承接：当前同文件 `:107`。
- D1:223｜等价移动：当前同文件 `:118`。
- D1:224｜等价移动：当前同文件 `:83`。
- D1:225｜弱化：F12-D15。
- D1:226｜弱化：F12-D16。
- D1:227｜弱化：F12-D17。
- D1:228｜弱化：F12-D18。
- D1:229｜弱化：F12-D19。
- D1:230｜等价移动：当前 `K3-16-proposal-round-fixture.test.ts:99`。
- D1:231｜等价移动：当前同文件 `:134`。
- D1:232｜等价纯 codec 承接：`runtime/K3-16-review-extremes-pure.test.ts:199`、`:200`；移出场景依据返工6第3项。
- D1:233｜等价纯 codec 承接：同 pure 文件 `:201`。
- D1:234｜等价纯 codec 承接：同 pure 文件 `:190`、`:193`。
- D1:235｜弱化：F12-D20。
- D1:236｜前书要求：返工6第3项禁止不可达的12目标 owner 写入前置；每次公开写生成 proposal id 的行为仍在 `K3-16-proposal-write.test.ts:107`，不恢复手造12目标 owner 场景。
- D1:237｜前书要求＋单条承接：返工6第3项，当前 `K3-16-proposal-write.test.ts:90`、`:92`；不把单条断言冒充双目标推导，缺口已记 F12-D12／D16。
- D1:238｜等价预算边界改写：当前 `K3-16-proposal-write.test.ts:228`、`:230`；同一5121预算，通过单命令换行开销构造。
- D1:239｜等价预算边界改写：当前同文件 `:227`、`:229`。
- D1:240｜前书要求＋合法边界承接：多条 owner 前置移除，当前同文件 `:244` 的5120公开接受。
- D1:241｜等价移动：当前同文件 `:237`。
- D1:242｜等价移动：当前同文件 `:238`；原来和现在都只是字节长度相等，另列 A6 缺陷，不称 byte-identical。
- D1:243｜前书要求＋合法写入承接：当前同文件 `:244`。
- D1:244｜等价移动：当前同文件 `:244`。
- D1:245｜弱化：F12-D21。
- D1:246｜等价预算承接：当前同文件 `:248`。
- D1:247｜前书要求：返工6第3项改成真实单条前置；当前 `K3-16-second-unfinished-proposal.test.ts:82` 保留该例所需 done 结论。
- D1:248｜前书要求：同上；当前同文件 `:130`、`:131` 保留“全部真实目标均有方案”的业务条件。
- D1:440｜前书要求：裁决§2；场景保留当前 `K3-06-mixed-kinds-owner.test.ts:115`，多条 pure 在 `runtime/K3-06-mixed-kinds-pure.test.ts:110`。
- D1:441｜前书要求：裁决§2；场景保留当前 `K3-13-two-items-owner.test.ts:48`，双条 pure 在 `runtime/K3-06-mixed-kinds-pure.test.ts:156`。
- D1:442｜行本身移动到 `K3-15-disposition-effects.test.ts:308`；其丢失的混合断言分别按 F12-D08／D09／D10 裁，不重复增加实例。
- D1:443｜等价移动：当前同文件 `:375`。
- D1:444｜等价扩展：当前 `K3-15-hold-release.test.ts:95`，memory＋SQLite；双后端依据返工6第4项。
- D1:445｜等价扩展：当前同文件 `:135`；超时另计 F12-T01。
- D1:446｜等价扩展：当前同文件 `:224`。
- D1:447｜等价扩展：当前 `K3-16-approval-application.test.ts:390`；超时另计 F12-T18。
- D1:448｜等价扩展：当前同文件 `:415`；超时另计 F12-T19。
- D1:449｜等价扩展：当前同文件 `:429`；超时另计 F12-T20。
- D1:450｜等价扩展：当前同文件 `:461`；超时另计 F12-T21。
- D1:451｜前书要求的极值迁移：`runtime/K3-16-review-extremes-pure.test.ts:173`；12 proposals 不等于12 items，未承接部分另计 F12-D20。
- D1:452｜等价移动：当前 `K3-16-proposal-write.test.ts:86`。
- D1:453｜等价扩展：当前同文件 `:133`。
- D1:454｜等价扩展：当前同文件 `:154`。
- D1:455｜等价扩展：当前同文件 `:167`。
- D1:456｜等价扩展：当前同文件 `:190`。
- D1:457｜等价重命名：当前同文件 `:214`；单条边界的预算仍5120。
- D1:458｜预算部分等价移动：当前同文件 `:216`；保存顺序未承接，另计 F12-D21。
- D1:459｜等价扩展：当前 `K3-17-disposition-replay.test.ts:66`；返工7第4项要求双后端。
- D1:460｜等价扩展：当前同文件 `:86`。
- D1:461｜等价扩展：当前同文件 `:112`。
- D1:462｜等价扩展：当前同文件 `:129`。
- D1:463｜等价扩展：当前 `K3-18-autonomy-facts.test.ts:140`；超时另计 F12-T15。
- D1:464｜等价扩展：当前同文件 `:158`；超时另计 F12-T16。
- D1:465｜等价扩展：当前同文件 `:173`；超时另计 F12-T17。
- D1:466｜等价扩展：当前 `K3-18-requeue-confirmed.test.ts:116`；返工7第4项。
- D1:467｜等价扩展：当前同文件 `:160`。
- D1:468｜双后端扩展符合返工7第4项，当前 `K3-18-review-card-queue.test.ts:423`；故障与摘要造态另计 F6-08／F4-15，成功批注缺口另计 F12-D22，超时另计 F12-T23。

**5. CANARIES**

- `.lead-ref/k3-b3-rulings-v1.md:45`，K3-06 的 F1 canary｜当前主测试在 `K3-06-mixed-kinds-owner.test.ts:121` 创建真实单条记录，`:132` 起断言单条；多条内容在 `runtime/K3-06-mixed-kinds-pure.test.ts:111`。没有在该主测试找到原“接受手造混合 draft”的同一实例；不能照 canary 原文机械判仍存在。其共享初始化仍有本报告 F1-01，两个问题分开。
- 同裁决 `:45`，K3-13 的 F1 canary｜当前 `K3-13-two-items-owner.test.ts:54` 创建单条；双条纯迁移在 `runtime/K3-06-mixed-kinds-pure.test.ts:157`。原 owner 多条造态实例已移出；仍有共享初始化和纯承接断言缺口。
- 同裁决 `:47`，审批摘要 toBe→toContain｜当前 `K3-16-approval-application.test.ts:232` 仍有整段独立字面 `toBe`；`:238` 不是唯一断言。因此 D1:26 不判当前全文断言弱化；混合句与多目标推导丢失另记 F12。
- 同裁决 `:49`，七处 raised timeout｜落在 G6 的六处全部找到：`K3-16-approval-application.test.ts:410`、`:426`、`:458`、`:471`，`K3-16-proposal-write.test.ts:249`，`K3-18-review-card-queue.test.ts:494`；分别为 F12-T18 至 T23。
- 同裁决 `:49` 的第七处 timeout 位于 `K3-48-2-unknown-call-review-model-text-budget.test.ts`，不属于 G6；不越组重复裁定。
- 同裁决 `:44`、`:46`、`:48` 指向其他组文件；不在 G6 列表中。

**6. STATIC claims**

没有执行公开 API、测试或构建。下面是实际阅读代码后的调用链推演，不是运行记录。

- 多个非只读工具同时保持 unresolved｜推演序列：脚本模型回复 `[send_session_message, edit, shell]` 或两条 shell → Runtime start → Kernel 分组 → 首条 handler 停在 gate。实际分组在 `vendor/coding-agent/dist/tools/registry/tool-registry.js:135` 判断“全部独立只读”；否则 `:142` 每条单独成组；runner 在 `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:629` 逐组推进，并在 `:670`／`:684` 等当前组结束后才进入下一组。这不是某个 owner 回 rejected，而是下一条尚未开始。因此不能靠把三条写进同一个模型回复得到旧 owner 多条前置；本报告按裁决§2移纯测试，没有声称尝试过所有可能系统历史。
- “无目标的 needs_decision 卡只能造出来”｜不成立，不能作为删断言理由。可用链是：真实 file_edit 在途 → 真实 Kernel 停止读取失败一次 → 恢复读取 → 公开认定 → needs_decision 卡 → rerun_as_is。生产 `state/unknown-call-review.ts:793` 将 incomplete 设为 needs_decision，而 `:808` 不把 file_edit 加入 dispositionTargets；这正是返工6第5项明确要求的路径。`K3-15-disposition-effects.test.ts:286` 至 `:290` 的解释不能证明该组合不可达。
- “memory 不能共享 Host 的 backend”｜不能作为 SQLite-only 理由。已接受 helper 在 `helpers/K3-35-continuation-fixture.ts:637`、`:646` 共享真实 backend/body factory；本组没有找到拒绝 memory 的产品入口。`K3-15-disposition-effects.test.ts:151` 是测试自己固定 SQLite。
- “调用 control 就暂停了”｜不成立。`K3-18-review-card-queue.test.ts:197` → `scenarios/support/control.ts:106` → `:107` 仅返回请求对象；没有到达发送调用 `scenarios/support/control.ts:151`。正确现有 helper 是 `goalControlled`，`:156`。
- “readonly 不可用已由 settleReview 检验”｜不成立。直接 `settleReview({cause:'review_unavailable'})` 在 `tasks/unknown-call-review-service.ts:939` 把入参转成 context boolean；这里没有执行 Host 能力探测。真实缺能力链必须经过 `K3-18-review-card-queue.test.ts:135` 的配置和 `:174` 的 Workflow 推进。
- “提案工具已由脚本模型实际调用”｜不成立。`helpers/K3-proposal-round.ts:413` 的模型脚本只有最终文字；提案调用在 `:708` 由测试直接执行 handler。没有 Kernel 工具调用拒绝行，因为测试绕开了那一层。
- “没有 taskProjection 的产品状态不可达，所以删例”｜本报告没有采用这种不可达结论；只确认 composition root 在 `src/composition/create-platform.ts:731` 接入投影，而测试在 `K3-15-hold-release.test.ts:230` 自建缺依赖 owner。处置是换成真实依赖失败包装，不据此新增生产防御要求。

**7. OPEN QUESTIONS**

- 问题 1｜`K3-13-two-items-owner.test.ts:88` 附近要求自查 evidence 精确等于“没有自查依据”；该文字能定位到 `state/unknown-call-review.ts:622`，但在提供的 K3 规格中未找到必须逐字相等的来源｜最小选项：lead 为该固定文字补一个明确规格出处；或规定这里只检验自查 verdict／证据语义，不冻结这句措辞。未替 lead 选择。
- 问题 2｜`K3-16-proposal-write.test.ts:174` 把空 cwd 作为 invalid；规格 `slice-K3-SPEC.md:550`、`:1202` 明确给了最大512字节，没有明确给出非空最小值，而 owner 在 `tasks/unknown-call-review-service.ts:689` 拒绝空串、codec 在 `tasks/unknown-call-review-codecs.ts:273` 允许长度0｜最小选项：明确 cwd 给出时必须非空；或明确空串按某个公开约定处理。未把实现一方当成规格裁决。
- 问题 3｜`K3-16-approval-application.test.ts:214`、`:215` 的审批 label 需要独立字面 expected；提供的 K3 规格 `:432` 明确 approve/decline ID，但未找到两个 label 必须逐字等于当前生产常量的规定｜最小选项：lead 指出已有文案冻结出处；或在下一版规则／规格冻结两个 label。当前不从生产常量反推期望。

**8. SEARCH LOG**

- 读取 `.lead-ref/groups/G6.txt:1` 至 `:13`，建立完整13文件清单；逐文件带行号读取到 EOF，最终重新核对行数分别为 230、114、420、240、87、472、271、250、192、166、192、174、495，总计3,303。
- 检索各文件 `it`／`it.each`／`describe`，核对55个测试定义；手工展开双后端和四选项参数，得到98个测试；读取每个文件最后一个测试直到文件尾。
- 完整读取 `.lead-ref/test-rule-sheet.md:1` 至 `:106`、`.lead-ref/k3-b3-rulings-v1.md:1` 至 `:49`，没有把旧“seam”“frozen boundary”注释当授权。
- 检索并逐条核对 D1 中所有 G6 文件名；实际审阅相关155条，覆盖 `:26`、`:33` 至 `:49`、`:53` 至 `:58`、`:147` 至 `:248`、`:440` 至 `:468`。
- 读取被调用共享 helper 的实现：K3 proposal round、review card world、35 continuation/prepare/runtime、tool seams、mixed seams、B2 crr world、S5 初始化、scripted model、Host root、控制请求／发送、Workflow drive、history boundary、fault wrappers。
- 沿 world 初始化继续追踪 `seedCommit`、`createS5Session`、`buildPrepared`、`enterClaim`，确认这些操作确实在 open 时执行，没有只搜索被测 Run 的局部代码。
- 搜索 `readMany`、`eventAt`、`readCanonicalTaskFacts`、`captureDigest`、`readReviewDisplays`、`kernelCommands`、`setTimeout`、`resolveConfiguration`、`probe`、`handler.execute`，随后读取候选所在函数和调用路径。
- 检查 spread 后覆盖、真实读取后补字段、回调生成值、端口固定返回值、直接 Host／Runtime owner 写入、纯函数行混入场景文件、拒绝前后只比长度等模式。
- 检查所有 G6 backend 入口；区分真实 Host restart 的 SQLite 豁免和普通服务层 SQLite-only。
- 读取规格相关 L3、L7、L14–L22、UCR／UR 和 K3-06／13／15／16／17／18／35／45／46 行；对象数量另查 slice-5 的 `objects ≤32`，没有从生产常量推31。
- 对照 `.lead-ref/k3-g4b3-impl.md:53`、返工6第3–5、8项、返工7第1、4项、返工8要求，分别核对允许的移除、移纯、双后端恢复和超时范围。
- 检索所有 pure 测试中的 targets、proposals、alias、contained、argumentsDigest、平台字面句，读取 `runtime/K3-06-mixed-kinds-pure.test.ts`、`runtime/K3-16-review-extremes-pure.test.ts` 的相关完整测试，另读 `runtime/K3-continuation-review-note.test.ts:345`、`:367` 的承接断言。
- 静态追踪生产 draft 校验、proposal 字段与预算、状态迁移、卡选项、摘要排序、分页游标、答复对象验证、处置重放、暂停确认推导和 continuation 渲染，逐项区分“会失败”“被其他分支挡住”“当前没有命中前提”。
- 静态读取 Kernel 工具分组和 runner 等待逻辑，检查多条副作用工具同时在途的不可达解释；没有运行模拟。
- 首选 `rg`，环境不可用后使用 PowerShell `Select-String`、`Get-Content`、`Get-ChildItem`。中文输出出现编码问题时按 UTF-8 读取、转义后解码；输出被截断的范围重新分段读取，没有用截断输出宣称 G6 文件已读完。
- 未执行测试、构建、git 操作、写文件、外部网络请求或任何应用写入。

G6: files read 13/13; instances by rule: F1 1, F2 2, F3 14, F4 16, F5 0, F6 8, F7 6, F8 3, F9 1, F10 0, F11 4, F12 45; open questions 3