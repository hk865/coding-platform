G7 不能判为 clean。13 个目标文件共 3,273 行已逐行读完；没有修改文件，没有运行测试、构建或变异测试。下面的“移除检查后是否失败”均为静态判断。

为避免路径重复，下面使用仓库内唯一文件名：目标测试在 `tests/work-graph/`，共享夹具在 `tests/helpers/`，三个迁移目标在 `tests/runtime/`。`SPEC` 指 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`；`D1:n` 指 `.lead-ref/d1-k3g4b3-r8.txt:n`。

实例计数口径：共享 helper 的同一坏来源只计一次，调用它的文件全部标出；同一读取后的连续断言合为一个 F7 实例；memory/sqlite 不乘二；台账对同一改动的重复记录不重复计数。A1/A5/A6 的“默认拒绝”问题另列，不强塞进不适用的 F 编号。

**1. COVERAGE**

| 文件 | 测试定义／展开后用例 | 完整读取 | 命中规则 | 调用的 helper 及裁定 | 最后一个测试标题 |
|---|---:|---|---|---|---|
| `K3-26-unknown-call-review-storage.test.ts:1` | 20／37 | 是，至 `:963` | F1、F2、F3、F4、F7、F8、F9、F11；另有 A5/A6 问题 | `openRealRunHarness`：编排 A1、共享后端 A4，见 `K3-35-continuation-fixture.ts:443`、`:637`；`blockedRecordWithClaim`／`requeueBlockedRecord`：步骤 A1，见 `B2-crr-world.ts:111`、`:178`；`createScriptedModel`：A1，见 `B2-runtime-fixture.ts:69`；`shellSeam`：F4，见 `K3-tool-seams.ts:93`；proposal helpers：F2/F4/F9，见 `K3-proposal-round.ts:356`、`:431`、`:571`；world 的 S5 前置：F1/F3，见 `S5-decision-fixture.ts:530`、`:736`、`:742`；`createExecutedFilesStub`：F4，见 `executed-files-stub.ts:24`；本地 canonical-facts 读取：F7，见本文件 `:785`、`:889` | `:935` — `K3-47 (三) %s: the requeue claim carrying its requeueRef re-holds the lease` |
| `K3-35-owner-manifest-trim.test.ts:1` | 1／2 | 是，至 `:82` | F1、F2、F3、F4、F9、F12 | `openK3ReviewCardWorld`／`createK3PendingReview`：外层步骤 A1，S5 前置 F1/F3；`runK3ReviewRound`：调用真实 owner/Runtime，但含 F2/F4/F9，见 `K3-proposal-round.ts:807`、`:431`、`:571`、`:356`；`shellSeam`：F4，见 `K3-tool-seams.ts:93` | `:40` — `K3-35 (一) (%s): one real pending record, one conclusion, the model ends the round, and the owner settles it resolved` |
| `K3-41-disposition-proof.test.ts:1` | 3／6 | 是，至 `:141` | F1、F2、F3、F4、F6、F7 | `createK3NeedsDecisionRecord`：F6，见 `K3-review-card-fixture.ts:389`；`applicationReceipt`：读取内部事件，不能当公开断言入口，见 `K3-review-card-fixture.ts:264`；`appliedWorld` 的公开答卡步骤 A1，见本文件 `:51`；直接 `eventAt`／`readApplicationReceiptFacts` 断言 F7，见本文件 `:72`、`:90`、`:136`；共享 world 前置 F1/F3 | `:125` — `K3-41 (%s): a non-application UnknownCallReviewChanged stays incomplete` |
| `K3-43-continuation-vs-hold.test.ts:1` | 2／4 | 是，至 `:261` | F1、F2、F3、F4、F7 | `interleaved`：A3，真实提交原样转交，见本文件 `:153`；`createK3NeedsDecisionRecord({autoSettled:true})`：真实编排，但 read stand-in F4，见 `K3-review-card-fixture.ts:410`、`K3-tool-seams.ts:146`；本地 `requeueAfterOrigin` 的真实 `VerificationWorkspaceReader`：A1，见本文件 `:126`；`runsOf`：F7，见本文件 `:170`；`projectionOver`：真实生产读取的接线，A1，见本文件 `:76` | `:217` — `K3-43 (二) %s: the stale hold loses on the TaskLease revision and the record is unchanged` |
| `K3-43-review-claim-vs-hold.test.ts:1` | 3／6 | 是，至 `:162` | F1、F2、F3、F4、F7 | `pendingRecord`／`reviewClaim`：真实 owner 步骤，A1，见本文件 `:52`、`:69`，但共享前置 F1/F3/F4；`reviewRuns`：F7，见本文件 `:85`；`shellSeam`：F4 | `:148` — `K3-43 (四) %s: releaseHold is busy with the round-not-settled text` |
| `K3-47-claim-gate.test.ts:1` | 10／22 | 是，至 `:335` | F1、F2、F3、F4、F6、F7、F11 | `failReviewReads`：A2，指定 review 读取失败，其余委托，见本文件 `:74`；`crashedRunWithoutRecord`：A1+A2，模型 `beforeReply` 抛错，见本文件 `:179`、`:188`；`taskRowOf`：A1，公开 `queryTaskGraph`，见本文件 `:211`；`durableFacts`：F7，见本文件 `:201`；`needsDecisionRecord`：F6，见本文件 `:92`；`requeueService.captureDigest`：F4，见本文件 `:140` | `:327` — `K3-47 (二): a %s review read refuses a system requeue unavailable` |
| `K3-47-continuation-gate.test.ts:1` | 1／2 | 是，至 `:222` | F1、F2、F3、F4、F7；另违反裁定 §3.3 | `failReviewReads`：A2，见本文件 `:69`；提交计数：A3，包住一次公开 claim，见本文件 `:207`；`realOwners`：F4，见 `S5-user-message-support.ts:54`、`:62`；`prepareContinuation`／`createK3_35Runtime`：生产步骤本身 A1，见 `K3-35-prepare.ts:58`、`K3-35-runtime.ts:120`；自行装配 mailbox/Runtime 仍未迁入裁定要求的共享 helper，见本文件 `:129`、`:147`；`runsOf`：F7，见本文件 `:96` | `:127` — `K3-47 (二): a real yield + formal reply followed by an unavailable review read refuses the continuation, with no Run and zero writes` |
| `K3-47-reader-facts.test.ts:1` | 7／14 | 是，至 `:225` | F1、F2、F3、F4、F11 | `failReviewRead`：A2，见本文件 `:75`；抛错包装：A2，见本文件 `:174`；`taskRow`：A1，公开查询，见本文件 `:85`；`crashedRunWithoutRecord`：A1+A2，见本文件 `:101`；shared world／shell/read seam：F1/F3/F4 | `:210` — `K3-47 (二): a resolved+held record stops the Task with reviewHold` |
| `K3-48-2-unknown-call-review-model-text-budget.test.ts:1` | 4／5 | 是，至 `:458` | F1、F2、F3、F4、F9、F11、F12；另有 A5 问题；非 proposal 部分 T | `fixture`／B2 `enter`／直接 commit：F1/F3，T，见本文件 `:210`、`:235`；`proposalFixture`：真实步骤但继承 shared helper 问题，见本文件 `:276`；`claimK3ReviewRound`／`writeK3Proposal`：调用真实 owner，但前者 F2/F9，见 `K3-proposal-round.ts:383`、`:712`；`exactSizedRecord`／`awaitingProposalRecord`：纯值构造，只能用于 A5，见本文件 `:169`、`:190`；sandbox mock：F4，见本文件 `:58` | `:448` — `K3-48 (二) codec: strict decode accepts only a 64-lowercase-hex argumentsDigest` |
| `K3-48-3-required-writes.test.ts:1` | 1／2 | 是，至 `:110` | F1、F2、F3、F4、F6、F11、F12 | `createK3PendingReview`／`readK3Review`：公开步骤 A1，继承 world 前置问题；`settleK3Review({cause:'review_unavailable'})`：本调用 F6，见本文件 `:71`；`bytes`：A5 的字节测量，见本文件 `:49` | `:55` — `K3-48 (三) %s: settle, hold and release commit and every record stays at or under 512 KiB` |
| `K3-50-codec-shape-checks.test.ts:1` | 3／3 | 是，至 `:59` | clean，A5；错误句式的冻结来源见 Q2 | `runRefProblem`／`taskTripleProblem`／`sessionMessageRefProblem`：A5，见 `codec-shape-checks.ts:12`、`:20`、`:27`；两个 body decoder：A5，见本文件 `:14`、`:15` | `:47` — `the CRR decoder keeps its "task"/"request runRef" sentences` |
| `K3-receipt-replay.test.ts:1` | 10／10 | 是，至 `:134` | F4；不满足 A5 | `eventOf`／`eventAtOf`／`input`：造事件、游标、回执和返回值，F4，见本文件 `:18`、`:21`、`:28`、`:49`；`decode`：返回构造事件的解析结果，不能使调用 I/O 的 replay 变成纯函数，见本文件 `:35`；`reasons`：纯失败映射本身 A5，见本文件 `:63` | `:125` — `does not require identity extraction when the event carries none (legacy note replay)` |
| `K3-task-closure.test.ts:1` | 13／13 | 是，至 `:121` | clean，A5 | `planWith`／`factsWith`／`pin`：纯输入构造，A5，见本文件 `:19`、`:23`、`:58`；`taskClosureOf`、`pinRevision`、字段谓词、source-key parser：A5，见 `plan-readers.ts:1921`、`revision-guard.ts:23`、`codec-fields.ts:14`、`decision-source-identity.ts:14` | `:116` — `reads a nested object field` |

UNREAD：无目标文件未读。上表的 78 个测试定义按 `.each` 展开为 126 个用例；这是源码计数，不是运行结果。

**2. FINDINGS by rule**

下面“共享前置”指上表使用 `openK3ReviewCardWorld` 的场景；其入口调用 `openS5DecisionFixture`，见 `K3-review-card-fixture.ts:131`。T 项只暂存于明确的 T 范围，不能豁免新 K3 调用方。

**F1：2 个实例**

- F1-01 | `S5-decision-fixture.ts:736`，共享前置／`enterClaim`：`buildPrepared` 手工构造 manifest、envelope、permit 后交给 `authorizeRuntimeEntry` 接受，见同文件 `:698`、`:707`、`:719`、`:728`；默认初始化确实调用它，见 `:783`。| 处置（i）：helper missing：建立仅收公开输入的 S5 world 初始化 helper，通过生产 prepare/start 建立该 Run。
- F1-02 | `B2-execution-fixture.ts:277`，`K3-48 (二) … a long evidence write over budget…` 的非 proposal 前置：接受手组 prepared；调用点为 `K3-48-2-unknown-call-review-model-text-budget.test.ts:213`。| 处置（iv）：T，依据 `k3-b3-rulings-v1.md:10`、`:11`。

**F2：4 个实例**

- F2-01 | `K3-26-unknown-call-review-storage.test.ts:168`，`the read port answers not_found…invalid for a bad record`：把编码记录展开后改 body revision，再从 stub 读口返回。| 处置（ii）：移到 `K3-26-unknown-call-review-codec-pure.test.ts`，直接测 `decodeUnknownCallReview`。
- F2-02 | `K3-26-unknown-call-review-storage.test.ts:800`、`:802`，`the Task read model projects…fail-closed when unreadable`：真实 `readMany` 结果被展开，review 的 JSON 被换成 `{"broken":true}`。| 处置（i）：用 `failReviewRead`，`K3-47-reader-facts.test.ts:75`，包装真实读取返回指定失败；通过其 `taskRow`，`:85`，断言公开查询结果。
- F2-03 | `K3-proposal-round.ts:428`、`:431`，共享的 `claimK3ReviewRound`：重建真实 Host 配置读取结果，并兜底扩大 `readonlyCommandAccess`。| 处置（i）：使用 `createK3_35Runtime` 的声明式 Host 配置，`K3-35-runtime.ts:75`、`:94`；删除读取结果覆盖。
- F2-04 | `S5-decision-fixture.ts:903`、`:904`，共享前置：把已构造的 pending message 展开改成 `responded`，随后直接保存，见 `:906`。| 处置（i）：helper missing：通过真实 mailbox 发送及公开答复步骤建立 responded message。

**F3：18 个实例**

- F3-01 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:235`，`a long evidence write over budget…`：直接提交构造 review 和 `round_claimed` 事件，见 `:239`。| 处置（iv）：T，仅非 proposal 部分。
- F3-02 | `B2-execution-fixture.ts:301`，同一非 proposal 用例的 `enter()`：手写进入事实和位置。| 处置（iv）：T，依据 `k3-b3-rulings-v1.md:10`。
- F3-03 | `task-claim-fixture.ts:233`，共享前置：直接提交 Project、Workspace、治理记录组成的 `scopeSeed`，见 `:227`。| 处置（i）：helper missing：用公开项目、工作区和治理配置步骤建立 scope。
- F3-04 | `task-claim-fixture.ts:324`，共享前置／`createSession`：测试直接写 Kernel session store。| 处置（i）：helper missing：通过生产 Session 创建入口建立 Kernel session。
- F3-05 | `task-claim-fixture.ts:327`，共享前置／`createSession`：测试代替 Host 调 `recordSessionCreated`，并自行给出 Kernel 身份。| 处置（i）：使用上一项的公开 Session 创建 helper。
- F3-06 | `S5-decision-fixture.ts:543`，共享前置：用 `seedCommit` 写 Project/Workspace 快照。| 处置（i）：helper missing：公开 scope 初始化 helper。
- F3-07 | `S5-decision-fixture.ts:568`，共享前置：直接保存构造的治理版本和 active 指针。| 处置（i）：helper missing：公开治理配置 helper。
- F3-08 | `S5-decision-fixture.ts:574`，共享前置：把构造的三个 Goal 快照直接入库。| 处置（i）：helper missing：用 Goal 创建、设置和计划采用的公开步骤建立这些 Goal。
- F3-09 | `S5-decision-fixture.ts:630`，共享前置／`createS5Session`：测试直接创建 Kernel session。| 处置（i）：helper missing：公开 Session 创建 helper。
- F3-10 | `S5-decision-fixture.ts:632`，共享前置／`createS5Session`：测试代替 Host 登记 session-created 事实。| 处置（i）：使用上一项的公开 Session 创建 helper。
- F3-11 | `S5-decision-fixture.ts:715`，共享前置／`buildPrepared`：测试把手组 manifest 写入 body store。| 处置（i）：用生产 prepare，已有编排参考 `prepareContinuation`，`K3-35-prepare.ts:58`。
- F3-12 | `S5-decision-fixture.ts:739`，共享前置／`enterClaim`：测试以手组 Kernel binding 调 `beginRuntimeEntry`，binding 在 `:733`。| 处置（i）：用生产 Runtime start，已有编排参考 `openRealRunHarness`，`K3-35-continuation-fixture.ts:536`。
- F3-13 | `S5-decision-fixture.ts:742`，共享前置／`enterClaim`：测试直接登记进入事实，位置固定为 2、3，见 `:744`、`:745`。| 处置（i）：使用上一项生产 Runtime start。
- F3-14 | `S5-decision-fixture.ts:816`，共享前置：构造 PlanProposal 及对应事件后直接提交，事件在 `:818`。| 处置（i）：helper missing：通过真实 Query/计划提议 owner 建立候选。
- F3-15 | `S5-decision-fixture.ts:869`，共享前置／`putBody`：测试代替消息 owner 写消息和答复 body。| 处置（i）：helper missing：由真实 mailbox 发送及答复步骤生成 body。
- F3-16 | `S5-decision-fixture.ts:881`，共享前置：直接写 pending DecisionMessage 及发送事件。| 处置（i）：使用上一项真实 mailbox helper。
- F3-17 | `S5-decision-fixture.ts:892`，共享前置：直接写第二条 pending message 及发送事件。| 处置（i）：使用上一项真实 mailbox helper。
- F3-18 | `S5-decision-fixture.ts:906`，共享前置：直接写 responded message 及答复事件。| 处置（i）：使用真实公开答复步骤，由消息 owner 保存结果。

这些不是只存在于未调用函数里的代码：`openS5DecisionFixture` 默认执行 scope、Goal、Session、Run、候选和消息初始化，见 `S5-decision-fixture.ts:543`、`:574`、`:638`、`:783`、`:816`、`:881`。

**F4：24 个实例**

- F4-01 | `K3-26-unknown-call-review-storage.test.ts:171`、`:172`，`the read port answers not_found…invalid for a bad record`：stub `readMany` 返回手组 encoded record。| 处置（ii）：移到 `K3-26-unknown-call-review-codec-pure.test.ts`，测 `decodeUnknownCallReview`。
- F4-02 | `K3-26-unknown-call-review-storage.test.ts:216`，`reviewWorldFixture` 所供用例：`readReviewDisplays` 固定返回 alias 1 的 `full`。| 处置（i）：helper missing：取得生产 platform 的 review owner，沿 `create-platform.ts:715` 的真实 envelope→manifest→display 读取接线。
- F4-03 | `K3-26-unknown-call-review-storage.test.ts:852`，两条 K3-47(三) 用例：`captureDigest` 固定返回 `'a'.repeat(64)`。| 处置（i）：使用 `requeueBlockedRecord`，`B2-crr-world.ts:178`，其 harness 使用真实工作树 capture，见 `K3-35-continuation-fixture.ts:491`。
- F4-04 | `K3-26-unknown-call-review-storage.test.ts:855`，同一 `requeueAfterOrigin`：消息读口固定 `not_found`；当前输入没有新消息，也不能把假读口认作真实读取。| 处置（i）：helper missing：共享 requeue helper 接入真实 mailbox 读口。
- F4-05 | `K3-43-continuation-vs-hold.test.ts:133`，两条 continuation/hold 用例：消息读口固定 `not_found`。| 处置（i）：helper missing：共享 requeue helper 使用真实 mailbox。
- F4-06 | `K3-43-continuation-vs-hold.test.ts:235`，`the stale hold loses on the TaskLease revision…`：额外 review owner 带固定 `full` display 口；该 hold 路径没有使用 display，不构成保留假口的理由。| 处置（i）：helper missing：共享竞争 helper 使用生产 owner 接线，只在真实 records.commit 外加 A3 gate。
- F4-07 | `K3-47-claim-gate.test.ts:140`，所有本地 requeue 用例：固定 source digest。| 处置（i）：使用 `requeueBlockedRecord`，`B2-crr-world.ts:178`，并在其真实依赖外施加该测试的 A2 读取失败。
- F4-08 | `K3-47-claim-gate.test.ts:143`，同一 requeue helper：消息读口固定 `not_found`。| 处置（i）：helper missing：真实 mailbox 接线的共享 requeue helper。
- F4-09 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:48`、`:58`，proposal 用例：整个 ProcessSandbox 被替换，probe 凭布尔量报告 bwrap 可用，没有调用真实 probe。| 处置（i）：helper missing：真实 sandbox 上的共享 proposal 路径；故障只通过包装真实 probe 注入。
- F4-10 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:250`，非 proposal 用例：固定 display 读取结果。| 处置（iv）：T，仅非 proposal 部分。
- F4-11 | `K3-tool-seams.ts:79`、`:93`，所有使用 `shellSeam` 的 G7 用例：替换真实 shell，移除能力要求后返回手组成功结果；gate 本身不使这个成功替身成为 A3，见 `:85`、`:103`。| 处置（i）：helper missing：在真实 shell 依赖外加受控 gate，放行后返回真实结果。
- F4-12 | `K3-tool-seams.ts:132`、`:146`，auto-settled/read 用例及 continuation-gate：read 工具同样被替换，返回手组成功值。| 处置（i）：helper missing：真实 read 工具的 A3 gate。
- F4-13 | `K3-proposal-round.ts:571`、`:573`，`runK3ReviewRound`／`settleK3Review` 调用方：settlement owner 用固定 `full` map 代替真实 prepared manifest。| 处置（i）：helper missing：共享 helper 使用 `create-platform.ts:715` 的生产 display reader。
- F4-14 | `K3-review-card-fixture.ts:139`、`:148`，共享 world 默认 Kernel command reader：把测试 map 的值交给 owner，名称为 reader 不改变来源。| 处置（i）：使用该 helper 已有的 `realKernelCommandFacts:true` 分支，见 `:150`、`:158`。
- F4-15 | `K3-review-card-fixture.ts:162`、`:164`，共享 world：workspace reader 无条件报告文件不存在。| 处置（i）：helper missing：真实工作目录上的 WorkspaceTools reader；需要不存在时，由真实文件状态形成。
- F4-16 | `K3-review-card-fixture.ts:200`、`:205`、`:211`，共享 world 的命令识别依赖：从测试提供的命令和值构造识别结果；G7 没有单独调用其 CRR 分支，但 helper 的该部分不能判 A1。| 处置（i）：helper missing：接入生产 command recognition 依赖，输入只来自真实 Kernel 和工作区文件。
- F4-17 | `K3-review-card-fixture.ts:246`、`:247`，共享 mailbox：直接返回 duties、readOnlyCopy、independentReview、空 guards。| 处置（i）：helper missing：真实 duties reader 接线。
- F4-18 | `executed-files-stub.ts:24`，G7 卡片读取：固定返回 `not_available`、空 files、空 guards、空 cursor。调用点为 `K3-26-unknown-call-review-storage.test.ts:336` 和 `K3-review-card-fixture.ts:305`。| 处置（i）：共享卡片 helper 使用 `createGoalExecutedFilesReader`，`src/core/work-graph/tasks/goal-executed-files-reader.ts:74`。
- F4-19 | `S5-user-message-support.ts:54`、`:55`，continuation-gate 的 `realOwners`：duties facts 是构造返回值。| 处置（i）：helper missing：裁定 §3.3 要求的 real-mailbox harness 选项，接入真实 duties reader。
- F4-20 | `S5-user-message-support.ts:62`，同一用例：`authorizeConfiguration` 原样批准传入权限，没有真实 Host 授权判断。| 处置（i）：使用上一项共享 real-mailbox harness，由真实 Host authorization 决定。
- F4-21 | `K3-receipt-replay.test.ts:28`、`:32`，使用 `eventAtOf` 的九个测试：手组 receipt/cursor/event 从 stub eventAt 返回；`replayCommittedReceipt` 实际调用 I/O，见 `src/core/work-graph/tasks/receipt-replay.ts:110`，不是 A5。| 处置（i）：helper missing：通过真实 owner 提交取得回执、再经公开 owner 重放的共享 helper；只接受公开操作输入。
- F4-22 | `K3-receipt-replay.test.ts:103`，`rejects an undecodable event`：decoder 直接返回构造的 invalid。| 处置（iii）：删除；这是手组事件和假 decoder 才形成的 owner 前置，按 AGENTS 规则 4。
- F4-23 | `K3-receipt-replay.test.ts:115`，`absorbs an eventAt throw…`：独立假函数抛错，没有包装真实事件依赖。| 处置（i）：helper missing：在真实 owner replay 的真实 eventAt 外加 A2 抛错包装，再断言公开拒绝及公开状态不变。
- F4-24 | `K3-receipt-replay.test.ts:129`、`:130`，`does not require identity extraction…legacy note replay`：decoder 和 projection 分别返回预造对象、常数 7。| 处置（i）：helper missing：真实 Note 创建及重放 helper，公开读回 Note 及原回执。

**F5：0 个实例**

没有把同请求重放误报为“无原因重触发”：`K3-26-unknown-call-review-storage.test.ts:415`、`:633`、`:743` 对应明确的幂等重放，且裁定允许同报告及公开 revision 检查，见 `k3-b3-rulings-v1.md:29`。

**F6：3 个实例**

- F6-01 | `K3-review-card-fixture.ts:389`，`createK3NeedsDecisionRecord` 调用方，尤其 K3-41 三条：没有先造成只读能力不可用，直接以 `review_unavailable` 调 settlement。| 处置（i）：helper missing：收窄真实 Host 只读授权，经公开准备／Workflow 发现不可用后定稿。
- F6-02 | `K3-47-claim-gate.test.ts:94`，`needsDecisionRecord`，影响 `:246`、`:267`、`:276`：直接写入虚构的 review-unavailable 结果。| 处置（i）：使用上一项真实不可用前置 helper。
- F6-03 | `K3-48-3-required-writes.test.ts:71`，`settle, hold and release…`：同样只有 cause 字面量，没有产生该失败的依赖步骤。| 处置（i）：使用上一项真实不可用前置 helper。

**F7：16 个实例**

- F7-01 | `K3-26-unknown-call-review-storage.test.ts:785`、`:791`，`the Task read model projects…`：直接 canonical storage reader 后断言投影。| 处置（i）：用公开 `taskRow`，`K3-47-reader-facts.test.ts:85`。
- F7-02 | `K3-26-unknown-call-review-storage.test.ts:805`、`:808`，同一测试的失败半段：直接读 canonical facts。| 处置（i）：用 `failReviewRead`＋`taskRow`，`K3-47-reader-facts.test.ts:75`、`:85`。
- F7-03 | `K3-26-unknown-call-review-storage.test.ts:889`、`:891`、`:892`，两条 K3-47(三) 的 `releasedLease`：从 canonical facts 断言选定 Run 和 Run 列表。| 处置（i）：helper missing：共享公开 Task 查询和 Run 查询，返回选定执行及该任务的实际 Run 列表。
- F7-04 | `K3-26-unknown-call-review-storage.test.ts:913`、`:915`、`:918`、`:920`，同一 helper：从存储 facts 断言租约、purpose，再把该存储值交 predicate。| 处置（i）：用本文件已有 `executionOf`，`:695`，分别读原 Run 和核对 Run；租约公开读的现成例子为 `:909`。
- F7-05 | `K3-41-disposition-proof.test.ts:72`，`the real disposition_applied event proves…`：直接 `eventAt` 后解码并断言事件 proof。| 处置（i）：helper missing：从公开决定答复／落实读口取得 application proof 并断言。
- F7-06 | `K3-41-disposition-proof.test.ts:90`，同一测试：直接调用接收 records 的内部 receipt reader。| 处置（i）：通过公开 `recordDecisionApplication` 后使用 `readDecisionAnswer`；现有调用形式见本文件 `:112`、`:62`。
- F7-07 | `K3-41-disposition-proof.test.ts:133`、`:134`，`a non-application UnknownCallReviewChanged…`：内部事件提取的 receipt 被直接作为可读性断言。| 处置（i）：helper missing：从公开 owner 返回值取得正式 receipt，避免测试读事件恢复身份。
- F7-08 | `K3-41-disposition-proof.test.ts:136`，同一测试：内部 receipt reader 的结果直接作为断言目标。| 处置（i）：经公开 `recordDecisionApplication` 提交这个真实非落实回执，断言公开拒绝和公开答复未变化。
- F7-09 | `K3-43-continuation-vs-hold.test.ts:207`，`the continuation claim loses…creates no Run`：`runsOf` 内部读存储。| 处置（i）：helper missing：共享公开任务 Run 列表读取 helper。
- F7-10 | `K3-43-continuation-vs-hold.test.ts:252`、`:254`，`the stale hold loses…`：直接 canonical facts 断言 selected Run。| 处置（i）：用公开 Task 查询，参考 `K3-47-reader-facts.test.ts:85`。
- F7-11 | `K3-43-review-claim-vs-hold.test.ts:115`，`hold first…creates no Run`：`reviewRuns` 从 canonical facts 计数。| 处置（i）：helper missing：公开任务 Run 列表读取 helper。
- F7-12 | `K3-47-claim-gate.test.ts:242`、`:243`，`an invalid review read…`：从 `durableFacts` 断言 Run 数。| 处置（i）：helper missing：公开任务 Run 列表读取 helper。
- F7-13 | `K3-47-claim-gate.test.ts:295`、`:296`，`an unavailable review read…no new Run`：同上。| 处置（i）：使用上一项公开读取 helper。
- F7-14 | `K3-47-claim-gate.test.ts:306`、`:307`、`:308`，`…system requeue…no TaskRequeued`：从存储 facts 断言 requeue/Run 数。| 处置（i）：helper missing：公开任务重排历史及 Run 列表读取 helper。
- F7-15 | `K3-47-claim-gate.test.ts:320`、`:321`，`…human requeue…no TaskRequeued`：从存储 facts 断言重排数。| 处置（i）：使用上一项公开读取 helper。
- F7-16 | `K3-47-continuation-gate.test.ts:212`，`a real yield + formal reply…`：`runsOf` 从内部 facts 读列表。| 处置（i）：helper missing：共享公开任务 Run 列表读取 helper。

**F8：2 个实例**

- F8-01 | `K3-26-unknown-call-review-storage.test.ts:142`，`an UnknownCallReview@1 snapshot round-trips…`：expected refKey 调用生产 `unknownCallReviewRefKey`；编码器本身也调用该函数，见 `unknown-call-review-codecs.ts:552`。| 处置（ii）：移到 `K3-26-unknown-call-review-codec-pure.test.ts`，测 `encodeUnknownCallReview`，期望 key 用固定输入手写字面量。
- F8-02 | `K3-26-unknown-call-review-storage.test.ts:355`，`expectReviewCard`，影响 `:394`、`:418`：expected source key 调生产 `decisionSourceKey`。| 处置（i）：继续经本文件 `reviewCards`，`:341`，读公开卡片；按冻结 source-key 格式手算 expected，仅插入动态标识。

这里没有把“同回执重放相等”“版本增加 1”“返回的 ref 等于请求 ref”报成 F8；这些是在检验关系，见 `K3-26-unknown-call-review-storage.test.ts:415`、`K3-48-2-unknown-call-review-model-text-budget.test.ts:395`。

**F9：1 个实例**

- F9-01 | `K3-proposal-round.ts:347`、`:356`，所有 `claimK3ReviewRound` 调用方：最多 500 次、每次 sleep 10ms 等进入事实，仍是轮询时间窗。| 处置（i）：helper missing：在真实 Runtime 的进入步骤外加 A3 gate，以明确 promise 通知进入后再放行模型。

**F10：0 个实例**

`K3-47-continuation-gate.test.ts:207`、`:211` 的提交计数围住一次完整公开 `claimTask`，不是把公开操作的限额偷换成某个内部 reader 的计数。

**F11：12 个实例**

- F11-01 | `K3-26-unknown-call-review-storage.test.ts:380`，`a complete draft with 33 items…`：前置是 Kernel unreadable，见 `:383`；去掉 32 项检查 `run-reconcile-service.ts:243`，仍被 complete＋unreadable 检查 `:273` 拒绝，现有 `invalid` 断言仍可过。| 处置（i）：用本文件 `unknownRun`，`:240`，建立可读的真实前置；在 `rejects:` 中只放超限错误，并断言该拒绝原因。
- F11-02 | `K3-26-unknown-call-review-storage.test.ts:436`，`an item kind that disagrees with L3…`：同样使用 unreadable 前置，见 `:439`；去掉 L3 kind 检查 `run-reconcile-service.ts:263`，`:273` 仍拒绝。| 处置（i）：用 `unknownRun`，`:240`，建立真实可读前置，只改变 kind。
- F11-03 | `K3-26-unknown-call-review-storage.test.ts:502`，`a draft item callId over 512 bytes…`：真实记录的是 `y×512`，提交的是 `x×513`，见 `:509`、`:512`；去掉长度检查 `run-reconcile-service.ts:266`，仍因 complete 遗漏 recorded ID 被 `:279` 拒绝。| 处置（i）：用 `unknownRun`，`:240`，让真实 recorded callId 与被拒输入一致，只留下长度错误。
- F11-04 | `K3-26-unknown-call-review-storage.test.ts:593`，`RUN-25 creates…in the same commit`：`:603` 和 `:615` 只读最终两个对象；拆成两次成功提交仍可满足全部断言，当前没有验证 `run-reconcile-service.ts:772` 的合并提交性质。| 处置（i）：helper missing：在共享 RUN-25 路径的真实提交点注入一次提交失败，并用公开 Run/review 读取证明没有部分落盘。
- F11-05 | `K3-47-claim-gate.test.ts:254`，`…absent and does not gate the claim`：只要求任意 rejected 且 reason 不含 review 字样，见 `:261`、`:262`；普通 phase/lease 拒绝就能满足，不能证明 absent 路径可正常接续。| 处置（i）：用 `crashedRunWithoutRecord`，`:179`，再经真实 requeue 建立可领取前置，公开 claim 必须成功。
- F11-06 | `K3-47-claim-gate.test.ts:267`，`…busy pending and writes nothing`：只有拒绝断言 `:273`，没有“不写”的观察。| 处置（i）：helper missing：为此完整公开 requeue 加 A3 提交观察，并通过公开查询核对 Run/requeue 未变化。
- F11-07 | `K3-47-claim-gate.test.ts:276`，`…accepted (its claim still waits)`：只做并断言 requeue 成功，见 `:280`、`:282`；根本没有携带新 requeueRef 的 claim。| 处置（i）：用该真实 requeue 返回值继续公开 claim，参考 `K3-26-unknown-call-review-storage.test.ts:945` 的请求形式，并断言 review 门仍拒绝。
- F11-08 | `K3-47-reader-facts.test.ts:159`，`a corrupt review read…AV-2b reports unreadable`：`:165`、`:166` 只断言事实，删除 `task-failure.ts:867` 的 AV-2b 判断不影响这些断言。| 处置（i）：继续通过现有 `taskRow`，`:85`，断言公开 `automation.verdict` 的完整字面量。
- F11-09 | `K3-47-reader-facts.test.ts:169`，`a thrown review read…AV-2b reports unreadable`：同样缺 automation verdict 断言，见 `:182`、`:183`。| 处置（i）：继续通过 `taskRow`，`:85`，断言 AV-2b 结果。
- F11-10 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:374`，`…admits a 2,000-character rationale…`：前置远低于 B，见 `:388`；删除 owner 的 optional admission `unknown-call-review-service.ts:783`，本行仍成功；不能接替 SPEC K3-48(二) 的溢出拒绝。| 处置（i）：helper missing：用公开标识、真实文件和真实 capture 构造接近预算的 proposal 前置，再测 capacity、公开读回不变、缩短后接受。
- F11-11 | `K3-48-3-required-writes.test.ts:55`，`settle, hold and release…`：小记录未跨过 B；把 required admission 错接成 optional，当前行仍可通过，相关调用在 `unknown-call-review-service.ts:950`、`:1078`、`:1146`。| 处置（i）：helper missing：公开步骤形成跨 B 的必需写前置，保留公开 settle/hold/release 及读回断言。
- F11-12 | `K3-48-3-required-writes.test.ts:70`，该行声称 `UCR-08c`，但前置实际是 `pending_review`，见 `:64`；SPEC `:1262` 的 UCR-08c 是 `awaiting_proposal` 且理由含 `proposal_missing`，当前测的是 SPEC `:1259` 的 UCR-07。| 处置（i）：保留此公开 UCR-07 路径并正确命名；不把它登记为 UCR-08c 覆盖。

**F12：19 个实例**

F12 的迁移授权没有扩大成“可以随迁移丢断言”。下列旧位置来自 D1，当前落点同时给出。

- F12-01 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:374`，proposal 行：memory/sqlite 变成 sqlite；D1:23、D1:479。| 处置（i）：共享 `proposalFixture`，本文件 `:276`，恢复两个后端。
- F12-02 | 同文件 `:388`，proposal 行：`= B−2000` 变成 `< B−2000`；D1:27、D1:367。| 处置（i）：使用 F11-10 所述公开近预算 helper，恢复精确边界前置。
- F12-03 | 同文件 `:403`，proposal 行：120,000ms 变成 180,000ms；D1:59；返工 6 第 8 项只授权指定 K3-35 hooks，见 `k3-g4b3-rework-6.md:70`。| 处置（i）：继续用 `proposalFixture`，`:276`，恢复原 timeout。
- F12-04 | `K3-48-3-required-writes.test.ts:109`，required-writes 行：新增 120,000ms timeout；D1:50，没有找到本行的冻结授权。| 处置（i）：继续使用 `createK3PendingReview`，`K3-proposal-round.ts:255`，恢复该行原 timeout。
- F12-05 | `K3-35-owner-manifest-trim.test.ts:58`，原 32-item owner 行的 digest 格式断言消失；D1:300；当前单项路径不再断言 `argumentsDigest`。| 处置（i）：经 `createK3PendingReview`，`K3-proposal-round.ts:255`，读真实生成的 digest 并保留规格要求的格式检查。
- F12-06 | 同文件 `:58`，原 summary command 长度上界断言消失；D1:301；当前只用短命令比较。| 处置（ii）：把边界验证放入 `K3-26-unknown-call-review-codec-pure.test.ts`，直接测 `unknownCallReviewBodyProblem` 的 512/513 字符边界。
- F12-07 | `K3-35-manifest-trim-pure.test.ts:275`，迁入的 trim 行缺原始 render `>65536` 的前置断言；D1:315；当前 `:372` 只要求两个预算中至少一个超限。| 处置（ii）：在此 `*-pure.test.ts` 的 `renderUnknownCallReviewZh` 行恢复该独立下界。
- F12-08 | 同文件 `:275`，缺原始 structured input JSON `>262144` 的前置断言；D1:316；“至少一个预算超限”不等价。| 处置（ii）：在同文件 `buildUnknownCallReviewInputV1` 行恢复该独立下界。
- F12-09 | 同文件 `:397`，缺原 fitted 每项 `toolName === 'shell'` 的输出检查；D1:323；输入写着 shell 不是输出断言。| 处置（ii）：在同文件 `fitUnknownCallReviewForManifest` 行恢复逐项字面量检查。
- F12-10 | 同文件 `:386`，缺原完整 manifest input 中每项正常渲染行的检查；D1:324。| 处置（ii）：在同文件 `renderUnknownCallReviewZh` 行恢复每个保留别名和工具名的文字断言。
- F12-11 | 同文件 `:401`，只检查 `unexpanded` 状态，原“没展开，按判断不了处理。”文字断言消失；D1:325。| 处置（ii）：在同文件 `renderUnknownCallReviewZh` 行恢复固定句断言。
- F12-12 | 同文件 `:289`，原 expanded command 非 null 检查消失；D1:326；`item.command?.text ?? ''` 让 null 的字节数为零，仍满足上界。| 处置（ii）：在同文件 `buildUnknownCallReviewInputV1` 行恢复非 null 断言。
- F12-13 | 同文件 `:288`，只检查 display，原 `command.truncated === true` 消失；D1:327。| 处置（ii）：在同文件 `buildUnknownCallReviewInputV1` 行恢复 command 的截断标记断言。
- F12-14 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:392`，原 proposal owner 的 capacity 拒绝被成功写入代替；D1:368、D1:479；`:444` 只测纯 admission，未证明 owner 接了它。| 处置（i）：使用 F11-10 的公开近预算 helper，恢复 owner capacity 行。
- F12-15 | 同文件 `:399`，原拒绝后整条记录字节不变的断言消失；D1:369。| 处置（i）：用同一公开近预算 helper，经 `readK3Review`，`K3-proposal-round.ts:277`，恢复拒绝前后字节相等。
- F12-16 | 同文件 `:392`，原“同一近预算前置，缩短 rationale 后成功”的行被远低于预算的长 rationale 成功取代；D1:370。| 处置（i）：在同一公开近预算 helper 中恢复拒绝后的短 rationale 重试。
- F12-17 | `K3-35-manifest-trim-pure.test.ts:413`，原对整份 manifest JSON 排除每个 callId，缩成对 fitted review JSON 排除；D1:340。| 处置（ii）：在同文件 `fitUnknownCallReviewForManifest` 行，对 `manifestFor` 形成的完整测量对象恢复检查。
- F12-18 | 同文件 `:415`，原整份 manifest JSON 不含 `k335-callid-`，缩成只查 rendered 字符串；D1:341。| 处置（ii）：在同文件完整 manifest 测量对象上恢复该断言。
- F12-19 | `K3-35-owner-manifest-trim.test.ts:62`，原生产 prepare 的 manifest input 以两换行加 review render 结尾的联系不再被测；D1:342；纯测试 `K3-35-manifest-trim-pure.test.ts:386` 比较的是测试自己拼出的 `BASE_INPUT + rendered`。| 处置（i）：helper missing：共享单项 review prepare helper 返回真实 prepared manifest，保留该生产装配关系断言。

**默认拒绝，但不冒充某个 F 编号**

- A5 不成立 | `K3-26-unknown-call-review-storage.test.ts:138`，strict codec round-trip：直接纯测与 store/Host/Runtime imports 混在场景文件中。| 处置（ii）：移到 `K3-26-unknown-call-review-codec-pure.test.ts`，测 `encodeUnknownCallReview`／`decodeUnknownCallReview`。
- A5 不成立 | 同文件 `:149`，unknown field/bad revision/key/schema 拒绝：同上。| 处置（ii）：移到同一 codec pure 文件。
- A5 不成立 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:405`，`pure L7 boundary…`：同文件仍导入并 mock platform 依赖，见 `:46`；不是符合 A5 的 pure 文件。| 处置（ii）：移到 `K3-48-2-proposal-budget-pure.test.ts`，测 `transitionUnknownCallReview` 和 `admitUnknownCallReview`。
- A6 不完整 | `K3-26-unknown-call-review-storage.test.ts:379`、`:380`：33 项拒绝没有 `describe('rejects: …')`。| 处置（i）：用 `unknownRun`，`:240`，在独立 rejects 块按 F11-01 修正。
- A6 不完整 | 同文件 `:436`：wrong-kind 拒绝没有 rejects 块。| 处置（i）：用 `unknownRun`，`:240`，在独立 rejects 块按 F11-02 修正。
- A6 不完整 | 同文件 `:450`：unreadable＋complete 拒绝没有 rejects 块。| 处置（i）：用 `unknownKernelUnreadable`，`:302`，在独立 rejects 块保留公开未写入读取。
- A6 不完整 | 同文件 `:464`：missing-recorded-call 拒绝没有 rejects 块。| 处置（i）：用 `unknownRun`，`:240`，在独立 rejects 块保留单错误及公开未写入读取。
- A6 不完整 | 同文件 `:478`、`:493`：wrong-count 是同一个 `it` 中第二次拒绝，且 `:498` 后没有公开不变读取；`call-9/itemsOmitted:0` 本身已按冻结裁定修好，见 `:487`。| 处置（i）：沿 `unknownRun`，`:240`，把两个错误拆成两个 rejects 用例，各自读回不变。
- A6 不完整 | 同文件 `:502`：513-byte 拒绝没有 rejects 块。| 处置（i）：按 F11-03 修正公开前置后放入独立 rejects 块。
- A6 不完整 | 同文件 `:638`：手组 stale classification 与重放成功合在同一测试，不在 rejects 块。| 处置（i）：保留 `reconcileUnknownTwice`，`K3-35-continuation-fixture.ts:711`，把 stale 输入单列为 rejects 行。
- 双后端规则未满足 | `K3-26-unknown-call-review-storage.test.ts:158`、`:159`：service read 行只有 memory；不是 SQLite Host 重启例外。| 处置（i）：helper missing：同一公开 review-read helper 在两个真实后端执行 absent 行。
- 裁定未落实 | `K3-47-continuation-gate.test.ts:129`、`:147`：仍在测试里装配 mailbox、Runtime；裁定明确要求共享 helper 增加 real-mailbox 选项，见 `k3-b3-rulings-v1.md:33`。| 处置（i）：helper missing：`openRealRunHarness` 的 real-mailbox 选项，封装该真实 send/yield/respond/continue 链。
- A1 helper 入参边界 | `K3-proposal-round.ts:383`、`:384`：`claimK3ReviewRound` 收整条 review。| 处置（i）：helper missing：仅收 reviewRef/公开选项的版本，内部公开读取。
- A1 helper 入参边界 | `K3-proposal-round.ts:475`、`:476`：`recordK3Conclusion` 收带 record、claim、run 的 K3Round。| 处置（i）：helper missing：只收公开 round/run 标识及结论文本的版本。
- A1 helper 入参边界 | `K3-proposal-round.ts:588`：`settleK3Review` 收整条 review 作为步骤输入。| 处置（i）：helper missing：只收 reviewRef 的 settlement helper，内部公开读版本。
- A1 helper 入参边界 | `K3-proposal-round.ts:712`：`writeK3Proposal` 收 K3Round。| 处置（i）：helper missing：只收公开 round/run 标识及方案文本的版本。
- A1 helper 入参边界 | `K3-proposal-round.ts:807`、`:808`：`runK3ReviewRound` 收整条 review。| 处置（i）：helper missing：只收 reviewRef 和脚本回复／结论文本的共享完整步骤。

**3. ROWS**

“是”表示静态上能指出相应分支失效会改变本行所断言的结果；不是已运行变异测试。“局部”明确限制实际覆盖范围。动态 ref 相等、revision 加一及列表长度属于手算关系，不从生产常量取 expected。

- `K3-26-unknown-call-review-storage.test.ts:138` | K3-26/L7 codec：`UnknownCallReview@1`、decoded、round-trip 相等；来源 SPEC `:235` 和给定输入；无后端；删除 `unknown-call-review-codecs.ts:559` 的相应解码检查会破坏 round-trip，但 refKey expected 有 F8。
- 同文件 `:149` | K3-26 strict codec：额外字段、revision/key/schema 不符均 `invalid`；来源 SPEC `:235`；无后端；是，对应 `unknown-call-review-codecs.ts:565`、`:570`、`:572`。
- 同文件 `:158` | K3-26 public read：absent→`not_found`，坏记录→`rejected/invalid`；来源 L7 strict read，SPEC `:235`；仅 memory；是，对应 `unknown-call-review-service.ts:1426`、`:1428`，但坏前置是 F2/F4。
- 同文件 `:380` | K3-26(七)：33 项→`invalid`，review absent；32 上限来自 SPEC `:241`、`:1457`；memory/sqlite；否，F11-01，目标 `run-reconcile-service.ts:243` 被 `:273` 遮住。
- 同文件 `:394` | K3-26(八)、RUN-22/UCR-02：513-byte ID→`incomplete/undecodable_call/needs_decision/['inventory_incomplete']`，三选项、同 ref 读相等、原回执重放；来源 SPEC `:278`、`:280`、`:284`、`:1237`、`:1253`；memory/sqlite；状态部分是，目标 `unknown-call-draft.ts:129`、`:142`、`:178` 和 `unknown-call-review.ts:793`；重放部分目标 `run-reconcile-service.ts:829`。
- 同文件 `:418` | K3-26(九)：revision 1、items=[]、itemsOmitted 0、记录和卡均不含 x×513；来源 SPEC `:242`、`:278`、`:1457`；memory/sqlite；是，目标 `unknown-call-draft.ts:129`、`:178`、`:208`。
- 同文件 `:436` | K3-26(八)：shell 被写成 read_only→invalid、absent；来源 L3/L8，SPEC `:289`、`:1457`；memory/sqlite；否，F11-02，目标 `run-reconcile-service.ts:263` 被 `:273` 遮住。
- 同文件 `:450` | K3-26(六)：停止时 Kernel unreadable 却 complete→invalid、absent；来源 SPEC `:285`；memory/sqlite；是，目标 `run-reconcile-service.ts:273`。
- 同文件 `:464` | K3-26(六)：真实 call-1，complete 只列 call-2→invalid、absent；来源 SPEC `:286`；memory/sqlite；是，目标 `run-reconcile-service.ts:279`。
- 同文件 `:483` | K3-26(六)：too_large 列未记录 call-9、omitted=0→invalid、absent；来源 SPEC `:287` 及手算一条已记录／一条列出；memory/sqlite；是，目标 `run-reconcile-service.ts:283`；该输入修正得到冻结认可，`test-rule-sheet.md:48`。
- 同文件 `:493` | K3-26(六)：真实 call-1 已列出却 omitted=1→invalid；手算应为 1−1=0，SPEC `:287`；memory/sqlite；是，目标 `run-reconcile-service.ts:286`；但缺第二次公开不变读取。
- 同文件 `:502` | K3-26(九)：x×513→invalid；512 上限来自 SPEC `:242`；memory/sqlite；否，目标 `run-reconcile-service.ts:266` 被 missing-recorded-call 的 `:279` 遮住。
- 同文件 `:521` | K3-26(九)：y×512 被真实 Host 列出，complete、pending_review、alias1、shell/process、contained；来源 SPEC `:242`、`:271`、`:297`；memory/sqlite；长度边界及构造结果可检验，目标 `unknown-call-draft.ts:129`、`:187`、`unknown-call-review.ts:796`。
- 同文件 `:593` | RUN-25/UCR-01：ended/crashed、review@1、complete、pending_review、takeover proof、captured baseline；来源 SPEC `:1235`、`:1252`、`:267`；memory/sqlite；删除 review 创建写入 `run-reconcile-service.ts:735` 会失败；“同一次提交”不受现有断言保护，见 F11-04。
- 同文件 `:623` | K3-47(一)：`W-26/takeover_unresolved/applied:true`、第二报告相等、review@1 不增长、stale pin→revision_conflict、Run revision 不变；来源 SPEC `:1465`、裁定 `k3-b3-rulings-v1.md:29`；memory/sqlite；重放目标 `run-reconcile-service.ts:829`、`:830`，stale 入口读目标 `:832`。
- 同文件 `:708` | K3-47(四)、TASK-03r/UCR-03/ATT-16r：claim committed；review@2、round1、startedRevision1；Run purpose 为 unknown_call_review；lease 改持有者且无 release；来源 SPEC `:1239`、`:1241`、`:1254`；memory/sqlite；是，目标 `claim-service.ts:1320`、`:1363`，以及其同批 claim records `:1370`；原子性没有独立故障证明。
- 同文件 `:734` | K3-47(四) replay：第二 claim 等于第一次加 replayed:true，review 保持 revision2、round1；来源 SPEC `:1239`、裁定 `:29`；memory/sqlite；是，claim receipt replay 路径位于 `claim-service.ts:924`。
- 同文件 `:750` | K3-47(四) P4：真实 covering requeue 后 review claim 成功，review@2、lease reheld；来源 SPEC `:1239`、`:1241`；memory/sqlite；是，`claim-service.ts:1175`、`:1181`、`:1320`。
- 同文件 `:777` | K3-47(二)：selected origin、review@1/pending、remainingRoundSlots=8，损坏时 unreadable；来源 SPEC `:264`、`:265`、`:299`；memory/sqlite；是，`plan-readers.ts:1094`、`:1102`、`:1757`；但两半都是 F7，坏半还有 F2。
- 同文件 `:927` | K3-47(三)、TASK-03/ATT-16：核对轮释放租约，afterRun 仍为原 Run，requeue 成功；来源 SPEC `:318`、`:1242`、`:1244`；memory/sqlite；是，`requeue-service.ts:892` 的 `leaseReleasedForContinuation` 判定。
- 同文件 `:935` | K3-47(三)：携带真实 requeueRef 的 claim 成功、lease holder 为新 Run、release 消失；同上；memory/sqlite；是，`claim-service.ts:1163`、`:1164`、`:1170`。
- `K3-35-owner-manifest-trim.test.ts:40` | K3-35(一)可达子链：一条 shell/process、alias1、pending；模型结束 completed；定稿 resolved/open:no/activeRound:null、done/by:review_round；来源 SPEC `:297`、`:375`、`:399`、`:1255`、`:1259`，及 `k3-b3-rulings-v1.md:21`；memory/sqlite；状态转换可检验，相关入口 `unknown-call-review-service.ts:864`；本行不再证明 SPEC `:1435` 的 32 项 manifest 极值，极值迁移和漏断言见 LEDGER。
- `K3-41-disposition-proof.test.ts:70` | K3-41(一)/L19 proof：disposition_applied、acknowledgementRef、capturedPins、before/after 相差1、basisRebases=[]；来源 SPEC `:442`；memory/sqlite；删除 proof 生成 `unknown-call-review-service.ts:1381` 会失败；当前观察方式 F7。
- 同文件 `:96` | L19 交叉 receipt：`invalid`、固定 reason，B 保持 answered_pending_application/application:null；来源 SPEC `:442`、`:456`，不同 answer 的手算身份；memory/sqlite；是，`communication/decision-application.ts:165`、`:166`。
- 同文件 `:125` | L19 非落实事件：`incomplete`、`the formal event carries no decision change proof`；来源 SPEC `:442` 的仅两种落实 change；memory/sqlite；是，`communication/decision-application.ts:159`、`:160`；但入口为内部 reader。
- `K3-43-continuation-vs-hold.test.ts:187` | K3-43(一)、TASK-03/UCR-15：hold@2 成功，claim revision_conflict，无新 Run，held 不变；来源 SPEC `:335`、`:1463`；memory/sqlite；是，目标 claim 的 selected-review CAS `claim-service.ts:1356`；“无新 Run”观察 F7。
- 同文件 `:217` | K3-43(二)：claim 成功，交错的 hold revision_conflict，review@1 不变，新 Run 持有 lease；来源 SPEC `:335`、`:1463`；memory/sqlite；目标为 hold 投影守卫 `unknown-call-review-service.ts:1061`、`:1085`；selected Run 观察 F7。
- `K3-43-review-claim-vs-hold.test.ts:102` | K3-43(三)：hold@2 后旧 revision review claim 被拒；来源 SPEC `:1463`、`:1239`；memory/sqlite；是，review claim 的 revision facts 在 `claim-service.ts:324`；Run 数观察 F7。
- 同文件 `:121` | K3-43(三)、UCR-15：claim 后 review@2，stale hold 冲突，按 revision2 重读的 hold@3 成功并保留 activeRound；来源 SPEC `:1269`；memory/sqlite；是，`unknown-call-review.ts:254`、`:593`。
- 同文件 `:137` | UR3h 仅出现在注释：本测试未调用 Workflow，也未断言 cancel_review_round；SPEC `:1314` 的 UR3h 不能由这里登记为覆盖。
- 同文件 `:148` | K3-43(四)、UCR-14：active round 下 releaseHold→busy，中文“核对轮还没收尾”；来源 SPEC `:1268`；memory/sqlite；是，owner 的中文拒绝 `unknown-call-review-service.ts:1131`、`:1132`；下层另有不同英文拒绝 `unknown-call-review.ts:602`，因此精确中文句仍能辨别 owner 检查。
- `K3-47-claim-gate.test.ts:223` | K3-47(二)：corrupt review read→ordinary claim unavailable；来源 SPEC `:265`、`:324`；memory/sqlite；是，`claim-service.ts:1208`、`:1218`、`run-machine.ts:634`。
- 同文件 `:233` | 同行 invalid→unavailable、Run数1；来源同上，1 为真实前置的手算数量；memory/sqlite；拒绝检查是；数量读取 F7。
- 同文件 `:246` | needs_decision→busy/unknown_call_review_pending；来源 SPEC `:324`；memory/sqlite；是，`claim-service.ts:1212`、`run-machine.ts:632`；前置 F6。
- 同文件 `:254` | absent 不应引入 review gate；来源 SPEC `:334`；memory/sqlite；否，当前只是另一种拒绝，见 F11-05。
- 同文件 `:267` | 系统 requeue→busy/pending；来源 SPEC `:324`、`:1244`；memory/sqlite；拒绝是，`requeue-service.ts:904`、`:905`；“零写”未检验。
- 同文件 `:276` | 人的 pending requeue→committed/requeued；来源 SPEC `:324`；memory/sqlite；人的例外可检验，`requeue-service.ts:904`；后续 claim 仍等待未检验。
- 同文件 `:287` | unavailable read→claim unavailable、Run数1；来源 SPEC `:265`、`:324`；memory/sqlite；拒绝是，`claim-service.ts:1208`；Run数 F7。
- 同文件 `:299` | 系统 requeue unavailable、零 requeue、Run数1、公开 row unreadable；来源同上；memory/sqlite；是，`requeue-service.ts:903`；计数部分 F7。
- 同文件 `:313` | 人的 requeue 也 unavailable、零 requeue、row unreadable；来源同上；memory/sqlite；是，`requeue-service.ts:903`；计数部分 F7。
- 同文件 `:327` | invalid/corrupt 两值均 system requeue unavailable；来源 SPEC `:265`；memory/sqlite×两个失败码；是，`requeue-service.ts:903`。
- `K3-47-continuation-gate.test.ts:127` | K3-47(二)、TASK-02：真实 yield/formal reply 后 review 读失败→unavailable、提交计数不变、只有原 Run；来源 SPEC `:324`；memory/sqlite；拒绝目标 `claim-service.ts:1208`、`run-machine.ts:634`；提交观察 A3，Run列表 F7。
- `K3-47-reader-facts.test.ts:127` | K3-47(二)/AV-2b：unreadable、hold:null、requeueConfirmed:false、stopped/unknown_call_review/detail unreadable；来源 SPEC `:265`、`:324`；memory/sqlite；是，`plan-readers.ts:1127`、`task-failure.ts:867`。
- 同文件 `:142` | unsupported 同样 unreadable、AV-2b stopped；来源 SPEC `:265`；memory/sqlite；是，同上。
- 同文件 `:159` | corrupt→事实 unreadable；来源 SPEC `:265`；memory/sqlite；facts 检查是，`plan-readers.ts:1127`；标题所说 AV-2b 否，`task-failure.ts:867` 未被断言。
- 同文件 `:169` | throw→事实 unreadable；来源同上；memory/sqlite；catch 映射是，`plan-readers.ts:1124`；AV-2b 否。
- 同文件 `:186` | authoritative missing→两个 review 字段 absent、automation requeue；来源 SPEC `:334`；memory/sqlite；是，`plan-readers.ts:1755`、`:1756`。
- 同文件 `:197` | pending_review→AV-2b stopped、detail pending_review；来源 SPEC `:324`；memory/sqlite；是，`task-failure.ts:867`。
- 同文件 `:210` | resolved+held→task_paused/human_pause/pausedBy:human/reviewHold:true；来源 SPEC `:591`；memory/sqlite；是，`task-failure.ts:873`、`:875`。
- `K3-48-2-unknown-call-review-model-text-budget.test.ts:351` | K3-48(二) evidence：B−1000 前置，长 evidence capacity、记录字节不变，短 evidence 接受；B=158720 来自 SPEC `:261`，行为来自 `:1440`；memory/sqlite；目标 `unknown-call-review-service.ts:620` 及 `unknown-call-review.ts:231`；T。
- 同文件 `:374` | K3-48(二) proposal：2000 个“理”、revision+1、一个 echo safer proposal、公开读回相等；2000 来自 SPEC `:244`，字节手算为6000；仅 sqlite；成功写入可检验，optional capacity 检查 `unknown-call-review-service.ts:783` 不受本行保护。
- 同文件 `:405` | L7 pure boundary：前置 B−2000，后继 B／B+1，分别接受／capacity；来源 SPEC `:251`、`:261`；无后端；是，`unknown-call-review.ts:231`；但 pure 文件隔离不合规，且不能代替 owner 接线测试。
- 同文件 `:448` | digest：64 位小写十六进制接受，错误长度／大写／非 hex 拒绝；来源 SPEC 的 argumentsDigest 形状及固定输入；无后端；是，`unknown-call-review-codecs.ts:240`、`codec-fields.ts:22`；非 proposal 部分 T。
- 同文件 `:91` | K3-48(一) 只用于介绍输入 builder；本文件没有创建溢出行，不能因此登记 K3-48(一) 覆盖。
- `K3-48-3-required-writes.test.ts:55` | K3-48(三)：revision1→2→3→4，needs_decision 三个固定原因、held/released、文本保留、每次≤524288；上限来自 SPEC `:249`，状态来自 `:1259`、`:1268`、`:1269`，revision 为逐次+1；memory/sqlite；状态转换可检验，required-vs-optional admission 不受当前小前置保护。
- 同文件 `:70` | 所标 UCR-08c 不成立：实际前置 pending_review，对应 UCR-07；来源对照 SPEC `:1259`、`:1262`；memory/sqlite；删除 UCR-08c 分支不会使本行失败。
- 同文件 `:80` | UCR-15：2000 个“核”，hold 后 revision3、resolved、handle_myself/direct/held；来源 SPEC `:244`、`:1269`；memory/sqlite；是，`unknown-call-review.ts:575`、`:594`。
- 同文件 `:92` | UCR-14：release 后 revision4、released；来源 SPEC `:1268`；memory/sqlite；是，`unknown-call-review.ts:598`、`:607`。
- `K3-50-codec-shape-checks.test.ts:22` | shared shape checks：合法 shape→null，额外字段／空字段→固定句；给定小对象手算；无后端；是，`codec-shape-checks.ts:13`、`:21`、`:28`；句式冻结来源 Q2。
- 同文件 `:36` | UCR caller label：精确 `review task…`／`review runRef…`；给定 label 的固定预期；无后端；精确 reason 使其他缺字段错误不能掩盖目标检查；相关调用在 `unknown-call-review-codecs.ts:449` 的 body 校验链；句式来源 Q2。
- 同文件 `:47` | CRR caller label：精确 `task…`／`request runRef…`；同上；无后端；精确 reason 可辨别被移除的检查；句式来源 Q2。
- `K3-receipt-replay.test.ts:68` | replay projected value=7、cursor=c1、replayed:true；7/c1 是手组输入；无真实后端；删除最终投影 `receipt-replay.ts:138` 会失败，但测试形态 F4。
- 同文件 `:74` | validate 被调用并收到 c1；手算输入；无真实后端；是，`receipt-replay.ts:136`；F4。
- 同文件 `:85` | validation rejection 原样返回；手组 rejection；无真实后端；是，`receipt-replay.ts:137`；F4。
- 同文件 `:91` | wrong_event_type；固定事件类型不等；无真实后端；是，`receipt-replay.ts:118`；F4。
- 同文件 `:96` | receipt_mismatch；e2 不在 [e1]；无真实后端；是，`receipt-replay.ts:122`；F4。
- 同文件 `:101` | undecodable；fake decoder 的 invalid；无真实后端；是，`receipt-replay.ts:126`；F4。
- 同文件 `:107` | identity_mismatch；other≠f1；无真实后端；是，`receipt-replay.ts:131`；F4。
- 同文件 `:113` | event_unreadable；假 eventAt 抛错；无真实后端；是，`receipt-replay.ts:111`；F4，未满足真实依赖包装。
- 同文件 `:120` | not_found 映射；假 store rejection；无真实后端；是，`receipt-replay.ts:76`、`:114`；F4。
- 同文件 `:125` | legacy 无 identity 仍 replay value7；假 decoder/project；无真实后端；对应 `receipt-replay.ts:130`；F4，未证明真实 Note replay。
- `K3-task-closure.test.ts:30` | satisfied→closed/satisfied；给定 canonical phase 手算；无后端；是，`plan-readers.ts:1926`。
- 同文件 `:35` | cancelled→closed/cancelled；给定 disposition 手算；无后端；是，`plan-readers.ts:1930`。
- 同文件 `:40` | superseded→closed/superseded；手算；无后端；是，`plan-readers.ts:1931`。
- 同文件 `:45` | satisfied 优先于 cancelled；给定两个条件手算；无后端；是，`plan-readers.ts:1926` 的顺序。
- 同文件 `:50` | active/in_progress→open/cause:null；手算；无后端；是，`plan-readers.ts:1932`。
- 同文件 `:60` | 唯一匹配 pin→3；手算；无后端；是，`revision-guard.ts:26`、`:29`。
- 同文件 `:64` | 无匹配 pin→null；手算；无后端；是，`revision-guard.ts:27`。
- 同文件 `:68` | 重复、负数、小数、字符串 revision→null；手算；无后端；是，`revision-guard.ts:27`、`:29`。
- 同文件 `:75` | 非对象 ref→null；手算；无后端；是，`revision-guard.ts:24`。
- 同文件 `:81` | object/string/integer/hex/onlyKeys/JSON/UTF-8 小例；`é`=2 bytes 为编码手算；无后端；相应分支在 `codec-fields.ts:14`、`:17`、`:21`、`:24`、`:27`、`:30`、`:33`、`:36`、`:45`。
- 同文件 `:104` | JSON key→kind/body 固定对象；手算输入；无后端；是，`decision-source-identity.ts:24`、`:27`、`:28`。
- 同文件 `:109` | 非 JSON、数组、空 kind、数字 kind→null；手算；无后端；是，`decision-source-identity.ts:20`、`:24`、`:27`。
- 同文件 `:116` | 对象字段原样返回，数组／缺字段→null；手算；无后端；是，`decision-source-identity.ts:32`、`:34`。

这组没有独立声明 B2-01…B2-18 的测试；`PLAN_B2` 和 B2 helper 的出现不能当 B2 行覆盖。`K3-26-unknown-call-review-storage.test.ts:885` 的 K3-27 是新 Session 的说明，也不是完整 K3-27 行验收。

**4. LEDGER**

共 156 条属于 G7。以下每条是判断，不重抄被删除的原断言。授权简称：

- R6-2＝`k3-g4b3-rework-6.md:37`，K3-48-3 构造极值退出 owner 场景。
- R6-3＝同文件 `:40`，前置改为共享公开步骤。
- R6-7＝同文件 `:67`，纯 manifest 测量改为完整对象。
- R7-2＝`k3-g4b3-rework-7.md:32`，K3-26 构造前置及多项状态迁移。
- R7-4＝同文件 `:40`，服务层两个后端。
- R8-1＝`k3-g4b3-rework-8.md:29`，K3-26 成功 draft 改真实 Host 路径。
- R8-2＝同文件 `:33`，call-9 omitted=0，33 项行正确命名。
- R8-3＝同文件 `:37`，RUN-25 真实进入＋Host。
- V1-2＝`k3-b3-rulings-v1.md:18`，撤销多项 owner 裁定，迁纯函数。
- P26＝`tests/runtime/K3-26-unknown-call-review-pure.test.ts`。
- P35＝`tests/runtime/K3-35-manifest-trim-pure.test.ts`。
- P48＝`tests/runtime/K3-48-3-extremes-pure.test.ts`。

| D1 行 | 判断 |
|---:|---|
| 23 | 削弱 F12-01：proposal 的 memory 后端消失，当前 `K3-48-2-unknown-call-review-model-text-budget.test.ts:374`。 |
| 27 | 削弱 F12-02：精确大小降成上界，当前同文件 `:388`。 |
| 50 | 削弱 F12-04：required-writes 新 timeout，当前 `K3-48-3-required-writes.test.ts:109`。 |
| 59 | 削弱 F12-03：proposal timeout 放宽，当前 `K3-48-2-unknown-call-review-model-text-budget.test.ts:403`。 |
| 249 | 由 R7-2 要求替换旧前置；真实 RUN-20 前置现在由 `K3-26-unknown-call-review-storage.test.ts:257` 校验。 |
| 250 | 由 R7-2 要求替换旧前置；成功认定现在由 `K3-35-continuation-fixture.ts:750`、`:751` 校验。 |
| 251 | 由 R7-2 要求退出构造的 32 项 owner 成功行；纯构造及 codec 在 P26 `:71`。 |
| 252 | 等价的记录状态字面量移到 P26 `:79`。 |
| 253 | 等价的 32 项长度移到 P26 `:83`。 |
| 254 | 等价的 1…32 aliases 移到 P26 `:84`。 |
| 255 | 公开 ref/runRef 同对象读取保留在 `K3-26-unknown-call-review-storage.test.ts:409`。 |
| 256 | 真实 RUN-22 重放相等保留在同文件 `:415`；R8-1 要求替换旧成功来源。 |
| 257 | 由 R8-2 允许更正 33 项行标题；公开 absent 断言在同文件 `:390`。 |
| 258 | 由 R8-1 要求换真实 Host draft；成功路径在同文件 `:401`。 |
| 259 | undecodable/needs_decision 字面量在同文件 `:404`。 |
| 260 | 由 R8-1 要求替换成功造态；真实 513 路径在同文件 `:425`。 |
| 261 | 状态／revision／omitted 字面量在同文件 `:426`；原“undecodable 但列出512”组合移到 P26 `:142`。 |
| 262 | 记录不含长 ID 保留在 `K3-26-unknown-call-review-storage.test.ts:430`。 |
| 263 | wrong-kind 后 absent 保留在同文件 `:446`；其双错误另记 F11。 |
| 264 | unreadable＋complete 后 absent 保留在同文件 `:460`。 |
| 265 | missing recorded call 后 absent 保留在同文件 `:474`。 |
| 266 | unrecorded too_large 后 absent 保留在同文件 `:491`；输入修正由 R8-2 指定。 |
| 267 | 由 R8-3 要求真实 RUN-25；结束/crashed 断言在同文件 `:601`。 |
| 268 | RUN-25 review 内容断言在同文件 `:603`。 |
| 269 | R8-3 后按裁定 §3.1 用 Host report 表达首个成功，现同文件 `:629`。 |
| 270 | 重放相等保留在同文件 `:633`，符合裁定 `k3-b3-rulings-v1.md:29`。 |
| 271 | stale revision 拒绝保留在同文件 `:647`。 |
| 272 | 513-byte 拒绝保留在同文件 `:516`；独立性仍有 F11-03。 |
| 273 | 由 R8-1 要求改真实 512-byte Host 路径，现同文件 `:527`、`:528`。 |
| 274 | 真实 512-byte 列出及字节数在同文件 `:529`、`:530`。 |
| 275 | 由 R7-2 要求改 review-claim 前置；pending/revision1 在同文件 `:879`。 |
| 276 | review claim 的 revision2/activeRound 在同文件 `:719`。 |
| 277 | review Run purpose 在同文件 `:725`。 |
| 278 | claim replay 后仍 revision2/round1 在同文件 `:744`。 |
| 279 | 前置 Goal 可读性仍在同文件 `:686` 附近的公开 request 构造中校验；这是 R7-2 的前置迁移。 |
| 280 | 真实 requeue 成功由 `K3-35-continuation-fixture.ts:783` 后的返回检查承担；调用为 `B2-crr-world.ts:183`。 |
| 281 | P4 claim 后 review@2 在 `K3-26-unknown-call-review-storage.test.ts:761`。 |
| 282 | selected origin/review 投影在同文件 `:791`；迁移没有修掉 F7。 |
| 283 | unreadable 投影在同文件 `:808`；迁移没有修掉 F2/F7。 |
| 284 | Goal 可读性保留在同文件 `:840`、`:841`。 |
| 285 | review claim 成功检查迁入 `S5-decision-fixture.ts:682`、`:683`，调用入口 `K3-proposal-round.ts:389`；共享前置仍有 F1/F3。 |
| 286 | 原 Run 仍 selected 保留在 `K3-26-unknown-call-review-storage.test.ts:891`。 |
| 287 | 当前同文件 `:892` 仅 `toContain(roundRunRef)`；D1 未保存旧 matcher 的续行，完整等价性未定，见 Q1。 |
| 288 | conclusion committed 检查移到 `K3-proposal-round.ts:483`；业务观察保留在 `K3-26-unknown-call-review-storage.test.ts:902`。 |
| 289 | 由 R6-3 改为 Runtime 自己结束；ended/completed 在同文件 `:905`，共享检查在 `K3-proposal-round.ts:511`。 |
| 290 | settlement 结果在 `K3-26-unknown-call-review-storage.test.ts:908`。 |
| 291 | 公开 lease release 在同文件 `:912`。 |
| 292 | canonical lease release 在同文件 `:915`；保留但仍 F7。 |
| 293 | releasing Run purpose 在同文件 `:918`；保留但仍 F7。 |
| 294 | afterRun 指向原 Run 在同文件 `:930`。 |
| 295 | reheld holder 在同文件 `:959`。 |
| 296 | release 消失在同文件 `:960`。 |
| 297 | V1-2 要求 32 项移纯；长度在 P35 `:280`、`:397`；可达单项在 `K3-35-owner-manifest-trim.test.ts:51`。 |
| 298 | 32 aliases 移到 P35 `:281`、`:398`，属于 V1-2。 |
| 299 | 可达单项 shell/process 保留在 `K3-35-owner-manifest-trim.test.ts:55`、`:56`；多项 owner 部分按 V1-2 退出。 |
| 300 | 削弱 F12-05：生成 digest 的格式检查没有等价断言，当前 owner 行止于同文件 `:58` 的 summary 检查。 |
| 301 | 削弱 F12-06：512 summary 边界检查没有等价迁移，当前同文件 `:58` 只比较短命令。 |
| 302 | pending_review 保留在同文件 `:50`。 |
| 303 | 同一公开 pending-record 的 complete 字面量现在在 `K3-48-3-required-writes.test.ts:64`。 |
| 304 | V1-2 的构造记录容量转纯验证；固定 B 的记录测量在 P48 `:131`，不能据此声称 owner 接线也被测。 |
| 305 | claim committed 检查迁入 `S5-decision-fixture.ts:683`，调用 `K3-proposal-round.ts:389`。 |
| 306 | review@2/activeRound 的同一业务断言在 `K3-26-unknown-call-review-storage.test.ts:719`。 |
| 307 | V1-2 移除不可达的32次 owner 写；单项 committed 检查在 `K3-proposal-round.ts:483`。 |
| 308 | R6-3 要求 Runtime 结束；当前 `K3-35-owner-manifest-trim.test.ts:68`。 |
| 309 | settled resolved 在同文件 `:72`。 |
| 310 | 公开 review 可读性由 `readK3Review`，`K3-proposal-round.ts:277`，校验。 |
| 311 | V1-2 移除32项 owner 后置；单项长度在 `K3-35-owner-manifest-trim.test.ts:75`。 |
| 312 | V1-2 的32 aliases 输出在 P35 `:398`；单项 alias 在 owner 文件 `:78`。 |
| 313 | V1-2 移除32次核对造态；可达单项 by/verdict 在 `K3-35-owner-manifest-trim.test.ts:79`、`:80`。 |
| 314 | resolved 保留在同文件 `:72`。 |
| 315 | 削弱 F12-07：P35 `:372` 的“任一预算超限”不等价于原 render 独立超限。 |
| 316 | 削弱 F12-08：同上，原 structured input JSON 独立超限未保留。 |
| 317 | 真实 round 与 activeRound 的关系由 `K3-proposal-round.ts:459`、`:460` 校验；32-item owner 情境按 V1-2 迁走。 |
| 318 | R6-7 明确要求完整 manifest 测量；现 P35 `:368`、`:378`。 |
| 319 | render≤65536 在 P35 `:367`。 |
| 320 | 32-item 场景按 V1-2 退出；完整纯 manifest≤262144 在 P35 `:368`，不再声称实际 bundleRef 大小。 |
| 321 | fitted32项在 P35 `:397`。 |
| 322 | fitted aliases 在 P35 `:398`。 |
| 323 | 削弱 F12-09：P35 `:397`、`:398` 未检查 fitted toolName。 |
| 324 | 削弱 F12-10：P35 `:386` 未保留逐项正常文字。 |
| 325 | 削弱 F12-11：P35 `:401` 的状态不等价于原固定中文句。 |
| 326 | 削弱 F12-12：P35 `:289` 允许 null 通过字节上界。 |
| 327 | 削弱 F12-13：P35 `:288` 的 display 不能替代 command.truncated。 |
| 328 | changedSample 前缀检查迁到 P35 `:326`、`:327`。 |
| 329 | 200 条总数通过逐次遗漏加1及最终200保留，P35 `:332`、`:361`、`:407`。 |
| 330 | omitted 增量与最终值在 P35 `:332`、`:407`。 |
| 331 | notVisible 前缀在 P35 `:328`、`:329`。 |
| 332 | notVisible 总数及遗漏在 P35 `:341`、`:362`、`:409`。 |
| 333 | 尾项 unexpanded 在 P35 `:401`。 |
| 334 | 首项 truncated、存在展开项在 P35 `:400`、`:403`。 |
| 335 | sample 清空在 P35 `:406`。 |
| 336 | notVisible 清空在 P35 `:408`。 |
| 337 | 开始裁 item 前 sample 必空，在 P35 `:338`、`:339` 的逐步检查中。 |
| 338 | sample 裁剪及最终清空在 P35 `:331`、`:361`、`:406`。 |
| 339 | changedOmitted 最终200在 P35 `:407`。 |
| 340 | 削弱 F12-17：P35 `:413` 只检查 fitted review，不是完整 manifest。 |
| 341 | 削弱 F12-18：P35 `:415` 只检查 rendered。 |
| 342 | 削弱 F12-19：P35 `:386` 的自拼 input 不等价于生产 prepare 装配关系。 |
| 343 | R6-3 要求替换手组 recognition；现 `K3-43-continuation-vs-hold.test.ts:88` 调真实共享路径。 |
| 344 | 同上，成功认定由 `K3-35-continuation-fixture.ts:750`、`:751` 校验。 |
| 345 | resolved 前置在 `K3-43-continuation-vs-hold.test.ts:89` 的读取检查中。 |
| 346 | hold 成功状态在同文件 `:203`。 |
| 347 | 无新 Run 在同文件 `:207`；F7 仍在。 |
| 348 | held 记录在同文件 `:209`。 |
| 349 | 未改变的 review 在同文件 `:247`。 |
| 350 | selected new Run 在同文件 `:254`；F7 仍在。 |
| 351 | 新 holder 在同文件 `:257`。 |
| 352 | release absent 在同文件 `:258`。 |
| 353 | R6-3 要求替换手组进入／认定；现 `K3-43-review-claim-vs-hold.test.ts:52` 的 pendingRecord 路径。 |
| 354 | 同上，真实 Host 认定成功由 `K3-35-continuation-fixture.ts:751` 校验。 |
| 355 | review Run 数不变在 `K3-43-review-claim-vs-hold.test.ts:115`；F7 仍在。 |
| 356 | review 公开读回在同文件 `:116`。 |
| 357 | claim committed 在同文件 `:127`。 |
| 358 | review@2/activeRound 在同文件 `:133`。 |
| 359 | Run数1在 `K3-47-claim-gate.test.ts:243`；F7 仍在。 |
| 360 | Run数1在同文件 `:296`；F7 仍在。 |
| 361 | requeue数0在同文件 `:307`；F7 仍在。 |
| 362 | Run数1在同文件 `:308`；F7 仍在。 |
| 363 | 人的 requeue数0在同文件 `:321`；F7 仍在。 |
| 364 | 零提交观察迁到 `K3-47-continuation-gate.test.ts:207`、`:211`，覆盖一次完整 claim，A3。 |
| 365 | 只有原 Run 在同文件 `:212`；F7 仍在。 |
| 366 | exact target 的纯数值检查在 `K3-48-2-unknown-call-review-model-text-budget.test.ts:419`；纯文件隔离仍未完成。 |
| 367 | 同 D1:27，削弱 F12-02，不重复计数。 |
| 368 | 削弱 F12-14：当前同文件 `:392` 是成功写，不是 owner capacity。 |
| 369 | 削弱 F12-15：当前同文件 `:399` 没有拒绝前后字节相等。 |
| 370 | 削弱 F12-16：同一近预算状态缩短后成功被替换。 |
| 371 | 当前 proposal 字段检查在同文件 `:397`；D1 未保存旧 object matcher 的续行，完整字段／文字等价性未定，见 Q1。 |
| 372 | R6-2 要求构造 recognition 退出 owner；真实创建断言现 `K3-48-3-required-writes.test.ts:63`。 |
| 373 | R6-2 要求32项极值纯测；创建状态在 P48 `:123` 后检查。 |
| 374 | 32项在 P48 `:124`。 |
| 375 | captured workspace 在 P48 `:127`。 |
| 376 | 32 notVisible 在 P48 `:129`。 |
| 377 | 固定158720在 P48 `:131`；R7第5项要求固定容量字面量。 |
| 378 | 真实 settlement 状态在 `K3-48-3-required-writes.test.ts:72`；纯极值状态在 P48 `:149`。 |
| 379 | required 后 >B 在 P48 `:153`，属于 R6-2 的极值迁移。 |
| 380 | ≤524288在 P48 `:154`，真实路径在 `K3-48-3-required-writes.test.ts:76`。 |
| 381 | revision4 公开读回在同文件 `:104`。 |
| 382 | 公开读回大小上界在同文件 `:108`。 |
| 383 | R6-2 要求构造 draft 退出 owner；513路径拒绝移到 P48 `:217`、`:223` 的真实 codec/schema 检查。 |
| 384 | R6-2 移除相应构造 draft owner 情境；纯 codec 不写存储，不保留伪装成场景的 absent 后置。 |
| 385 | R6-2 移除该构造 draft owner 情境；真实 pending 前置现在由 `K3-48-3-required-writes.test.ts:63` 验证，不把旧 Run 后置算作仍有覆盖。 |
| 469 | R7-2 指定32-item too_many_calls 退出 owner；P26 `:71`。 |
| 470 | R8-2 指定33项拒绝正确命名；当前 `K3-26-unknown-call-review-storage.test.ts:380`；不是恢复“遗漏一条”的覆盖，且有 F11-01。 |
| 471 | R8-1 指定真实513路径和不可达组合分开；真实行 `K3-26-unknown-call-review-storage.test.ts:418`，组合纯行 P26 `:140`、`:155`。 |
| 472 | R8-1 后拆为拒绝 `K3-26-unknown-call-review-storage.test.ts:502` 和真实512成功 `:521`；前者仍有 F11-03。 |
| 473 | V1-2 明确撤销32项 owner 情境；单项 owner `K3-35-owner-manifest-trim.test.ts:40`，多项 pure P35 `:274`。 |
| 474 | V1-2、R6-7 要求迁纯并测完整 manifest；P35 `:273`、`:368`。 |
| 475 | 同一授权下整体迁到 P35 `:274`；其中丢掉的具体断言已分别记 F12，不能以整体迁移一笔核销。 |
| 476 | R7-4 要求两个后端；当前 `K3-41-disposition-proof.test.ts:70`。 |
| 477 | R7-4 要求两个后端；当前同文件 `:96`。 |
| 478 | R7-4 要求两个后端；当前同文件 `:125`。 |
| 479 | 与 D1:23、27、368—370 同一 proposal 改写：F12-01、02、14、15、16，不重复计数。 |
| 480 | R6-2 指定近阈值构造状态退出 owner；P48 `:121`、`:139`，真实路径 `K3-48-3-required-writes.test.ts:55`。 |
| 481 | R6-2 的 pure 部分无需后端；真实 owner 行仍在 `K3-48-3-required-writes.test.ts:55` 跑两个后端。 |
| 482 | R6-2 拆成真实 owner 状态链 `K3-48-3-required-writes.test.ts:55` 和极值纯计算 P48 `:139`；真实行的 required admission 敏感性见 F11-11。 |
| 483 | R6-2 的构造 draft 退出 owner；513路径 codec 行在 P48 `:201`。 |

D1:287、D1:371 没有被强行记成“等价”或“削弱”；当前输入不足以判断旧多行 matcher 的完整含义。它们是台账未闭合项，见 Q1。

**5. CANARIES**

- 找到 | `K3-48-2-unknown-call-review-model-text-budget.test.ts:388`：精确 `toBe(B - 2_000)` 被 `toBeLessThan` 取代；对应 `k3-b3-rulings-v1.md:48`，F12-02。
- 找到 | 同文件 `:374`：仅 sqlite；对应裁定 `:49`，F12-01。
- 找到 | 同文件 `:403`：120 秒放宽至180秒；对应裁定 `:49` 的 raised-timeout 集合及 D1:59，F12-03。
- 另发现 | `K3-48-3-required-writes.test.ts:109`：D1:50 的新增120秒 timeout，F12-04；它不是把“七个 raised timeout”全部算进 G7。
- 不属于 G7 | 裁定 `:44` 的 workflow `performWorld`、`:45` 的 K3-06/K3-13、`:46` 的 K3-15 digest、`:47` 的 K3-16 summary 弱化；本报告没有把它们算作本组目标实例。
- 同类遗漏已找到 | literal digest 还出现在 G7 的 `K3-26-unknown-call-review-storage.test.ts:852` 和 `K3-47-claim-gate.test.ts:140`，已按裁定 §3.4 记 F4，不能因为不在 §4 示例名单里而放行。

**6. STATIC claims**

- RUN-25 两个后端可接线：静态路径为 `openK3ReviewCardWorld(kind)` → `openRealRunHarness({gitWorkspace:true,takeover})` → 创建 Session → `claimRun` → `prepareAndStart({prepareViaRuntime:true})` → 等待真实 Kernel started call → `reconcileUnknown` → 公开 `readExecution/readReview`；G7 调用在 `K3-26-unknown-call-review-storage.test.ts:550`、`:571`、`:593`；git 初始化在 `K3-35-continuation-fixture.ts:450`，底层真实文件/git 操作在 `tests/scenarios/support/git-workspace.ts:92`；memory 的共享 records/body 工厂在 `K3-35-continuation-fixture.ts:637`、`:646`、`:652`，sqlite 在 `:660`、`:661`；没有找到只允许 sqlite 的该路径拒绝。这里只确认静态可走，未运行验证。
- 旧 `openK3_35PublicRecord` 的 memory 拒绝不能用于否定上项：它是另一个 helper 的限制，见 `K3-35-continuation-fixture.ts:886`、`:889`；G7 RUN-25 调的是 `openRealRunHarness`，见 `K3-26-unknown-call-review-storage.test.ts:555`。
- “同一批32个 process 调用都 started 且未完成”在当前 serial shell 路径不可达：静态序列为 claim→prepare→start→模型给出32个 shell calls→第一组 tool.started→第一项 shell 挂起；policy 给非全只读调用逐个 serial group，见 `vendor/coding-agent/dist/tools/registry/tool-registry.js:135`、`:142`；runner 在下一组前等待本组 executions，见 `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:629`、`:638`、`:644`、`:684`。这里的阻断是 await，不是一个拒绝返回码。它支持撤销的“32个 unresolved process owner 前置”迁纯，不支持把所有多项或大记录一概称为不可达。
- “513-byte ID 无法作为该 Host draft 的 listed item”有明确静态过滤：模型给 x×513→Kernel started→Host draft→`decodable` 的 UTF-8≤512 条件，见 `src/core/agent-runtime/unknown-call-draft.ts:129`；`:178` 过滤后再生成 items，`:142` 标记 undecodable；故真实513成功行是空 items，真实512成功行是 pending process，见 `K3-26-unknown-call-review-storage.test.ts:425`、`:527`。
- 没有接受“一个 process item 就证明所有近 B 场景不可达”：该推论出现在 `K3-48-2-unknown-call-review-model-text-budget.test.ts:380`、`:406` 的注释，但它只限制 process 并发数，没有给出所有公开标识、工作区 capture、历史文字的总大小证明；例如 taskId 校验只要求非空，见 `src/core/work-graph/persistence/plan-record-codecs.ts:352`，SPEC `:586` 也明确 T=512 不是强制标识上限。F11-10/F12-02 的处置因此要求公开近预算 helper，不以这段注释批准删除场景。
- 没有接受“receipt-replay 是纯函数”：测试文件 `K3-receipt-replay.test.ts:3` 如此声称，但生产函数在 `src/core/work-graph/tasks/receipt-replay.ts:110` await `eventAt`；换成注入参数不改变它调用 I/O 的事实。
- 没有用旧书的 shell stand-in 许可覆盖 v1：当前 stand-in 确实手组成功结果，见 `K3-tool-seams.ts:93`、`:146`；v1 的允许形态是包装真实依赖并原样返回，见 `test-rule-sheet.md:35`，且 A7 空，`:52`。因此报告保留 F4，不按名字豁免。

以上均为“静态追踪的调用序列”，没有把它们描述成已经执行过的测试。

**7. OPEN QUESTIONS**

- Q1｜旧多行断言信息不足：D1:287 只保存 `.map(...)` 开头，D1:371 只保存 `toMatchObject({` 开头；当前分别是 `K3-26-unknown-call-review-storage.test.ts:892` 的 `toContain` 和 `K3-48-2-unknown-call-review-model-text-budget.test.ts:397` 的字段匹配。最小选项：提供这两处旧完整断言；或由 lead 将两项明确保持为未闭合，不能据现有单行 ledger 宣布等价。
- Q2｜错误句式的冻结依据未附：`K3-50-codec-shape-checks.test.ts:2` 指返工2第12项，`:41`、`:54` 断言精确英文句式；提供的历史书从返工6起，未含该条正文。最小选项：补返工2的冻结条目以确认逐字兼容要求；或由 lead 明确这几个句式是否属于冻结契约。本报告不自行放宽精确字符串。

**8. SEARCH LOG**

- 读取入口与范围：读取仓库入口说明、`.lead-ref/groups/G7.txt`、`test-rule-sheet.md`、`k3-b3-rulings-v1.md`；目标文件按逐段带行号读取到 EOF，最后再次核对13个文件的行数及末行。
- 完整目标读取核对：963、82、141、261、162、335、222、225、458、110、59、134、121 行，合计3,273行；分别对应 COVERAGE 的13行。
- 测试清单核对：搜索 `it(`、`it.each(`、`describe.each`，并人工展开 backend 和失败码参数；确认78个定义、126个展开用例及每个文件最后一个标题。
- 规则候选搜索：搜索 `readMany`、`eventAt`、`commit`、`recordExecutionEntered`、`recordRunResult`、`captureDigest`、`readReviewDisplays`、`mock`、spread override、`setTimeout`、timeout 和断言方法；每个候选随后读取函数及调用上下文，没有以关键词命中数代替判断。
- helper 追踪：读取 G7 调用的 `K3-proposal-round`、`K3-review-card-fixture`、`K3-tool-seams`、`B2-crr-world`、`K3-35-continuation-fixture` 的相关完整 helper、`K3-35-prepare`、`K3-35-runtime`、`S5-decision-fixture`、`S5-user-message-support`、`executed-files-stub`、`B2-execution-fixture`、`task-claim-fixture`、`B2-runtime-fixture.createScriptedModel` 和 git-workspace helper；对照 `.lead-ref/groups/H.txt` 及 `b3-helpers.diff` 的相应文件段定位。
- 台账核对：读取 D1 全表，按13个目标文件筛出156条；逐条对照当前断言、三份 pure 迁移文件和返工6/7/8授权；没有把删除行原文再次充当审查结论。
- 历史材料核对：读取 `k3-g4b3-impl.md`、返工6/7/8任务书、返工8 final 和上一份 capped review；历史“0 defects”没有作为本次清洁证据。
- 规格核对：读取 L7—L22、RUN/UCR/UR 表、测试入口要求及 K3-26/35/41/43/47/48 行，使用原 UTF-8 行号。
- 生产反向核对：读取 reconcile draft 校验、Run/review 同批提交、claim review gate/CAS、requeue gate、Task review projection、AV-2b/AV-4c、review settlement/hold/release、decision proof、receipt replay、codec primitives、pure closure/pin/source-key，以及 Kernel batch policy/runner 的相关实现。
- 工具限制处理：`rg` 不可用，改用 PowerShell `Get-Content -Encoding UTF8`、`Select-String`、`Get-ChildItem`；输出编码损坏或截断的读取均重新按较小范围读取，不把损坏输出算作完成。
- 未执行：测试、构建、格式化、安装、git 操作、文件写入、实际故障注入和变异执行。

G7: files read 13/13; instances by rule: F1 2, F2 4, F3 18, F4 24, F5 0, F6 3, F7 16, F8 2, F9 1, F10 0, F11 12, F12 19; open questions 2