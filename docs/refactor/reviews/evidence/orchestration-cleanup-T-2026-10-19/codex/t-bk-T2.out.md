改完再施工

已完整核对 T2-001—T2-064。以下只处理条目与当前代码、保留断言、施工规则和文件归属之间的问题，不重新裁定清理方向。本次未修改文件，未运行测试、构建、Git 写操作或网络请求。

**2. 需要修改的条目**

| 编号 | 问题 | 证据（`file:line`） | 改法 |
|---|---|---|---|
| T2-004 | 撤销 `change` 导出与 T2-012 冲突。合并后，S2A 留下的重开数据库用例仍须调用它。`event` 可以留作共享文件内部函数，不必因此保留导出。 | `tests/helpers/S4B-text-search-support.ts:104`；`tests/record-store/S2A-ordered-lookup.test.ts:375`；`.lead-ref/books/t-items-T2.md:83` | 改为：**只撤销 `at`、`event`、`SearchRequest` 的导出；保留 `change` 导出，供 T2-012 合并后的 S2A 用例使用。与 T2-012/013 同批落地。** |
| T2-005 | 已要求同步说明，但 `tests/kernel/README.md` 不在白名单。说明不只有第 16 行：前面的迁入数量和用例列表也描述了随后删除、合并的内容。 | `.lead-ref/books/t-items-T2.md:36`；`tests/kernel/README.md:5`、`:10`、`:11`、`:16` | 将该 README 加入白名单；**追加 T 轮后注，说明 T2-005/006/007/008/009 后的保留范围及旧 writer 删除情况，保留原历史迁入说明原义。** |
| T2-009 | “留在原文件”与“挪进中性 helper”是两个施工结果；同时，删除 writer 必须晚于转换，和 run 文件的统一顺序相反。 | `.lead-ref/books/t-items-T2.md:62`；`.lead-ref/books/t-run-T2.md:6`；`tests/kernel/R4a-legacy-fixtures.ts:31`；`tests/runtime/R4b-session-input-boundaries.test.ts:119`；`tests/runtime/R4b-session-recovery.test.ts:184`、`:192` | 固定为：**`TempWorkspace/createTempWorkspace` 留在原文件；先完成 T2-005/007/008、T2-025/030，再删除旧 writer 及其专用导入。不要新建中性目录 helper。前置项用这些 T2 编号表达，不再使用 C-02/C-03。** |
| T2-012 | 共享 `open()` 的返回类型只有事务和文本检索能力，不能直接替代 S2A 的 backend：保留的分页函数和用例需要 `lookupOrdered`、`lookup`。 | `tests/helpers/S4B-text-search-support.ts:69`、`:129`；`tests/record-store/S2A-ordered-lookup.test.ts:51`、`:115`、`:136` | 在动作中补上：**共享 backend 类型增加 `RecordLookupPort`、`RecordOrderedLookupPort`；同时返回 `dir`。S2A 使用这个真实能力类型，保留本地索引、接受 `unknown` 的注册入口和分页函数，不用强制断言掩盖缺失能力。** |
| T2-013 | 同一个共享 backend 类型也缺少 S2C 必需的 `countLookup`。 | `tests/helpers/S4B-text-search-support.ts:69`；`tests/record-store/S2C-count-lookup.test.ts:57`、`:115`、`:129` | 在动作中补上：**共享 backend 类型增加 `RecordCountPort`，与 T2-012 的类型扩展合成一次修改；S2C 保留五个索引和 `countOf`，各次打开继续显式传入本文件 schemas。** |
| T2-016 | 第二个必须修改的消费者没有列入任何组的白名单。 | `.lead-ref/books/t-items-T2.md:111`；`tests/record-store/SP-lookup-index-migration.test.ts:31`、`:49`、`:59`、`:68` | **将 `tests/record-store/SP-lookup-index-migration.test.ts` 加入 T2 白名单。** 共享 `typed` 的默认体放在调用方正文之前展开：literal 文件传 `{group:'shared'}`，migration 文件传空默认体，保留调用方正文覆盖默认值的行为。 |
| T2-025 | “抽共享 helper”与“本文件复制”没有冻结；若选择共享化，新增文件也没有名字和白名单授权。 | `.lead-ref/books/t-items-T2.md:174`；`tests/runtime/R4c-execution-history.test.ts:80`、`:93`、`:99` | 固定为：**新建 `tests/helpers/R4-history-turn-support.ts`，迁入 `scriptedClient`、`TurnInput`、`runTurn`；R4c 和两份 R4b 测试共同导入。把该文件加入白名单；helper 只接受工作目录、数据库位置、Session/执行身份、文本及脚本模型等输入，不接受手写记录。** |
| T2-030 | “从第一轮公开历史取得上界，再作为期望”与书中禁止从程序输出取期望冲突；第一张限长页的最后一个位置也不是整轮上界。 | `.lead-ref/books/t-items-T2.md:209`；`.lead-ref/books/t-book.md:50`；`tests/runtime/R4b-session-recovery.test.ts:186`、`:197`；`src/core/agent-runtime/session-operations.ts:491`；`tests/runtime/R4c-execution-history.test.ts:129` | **使用 T2-025 的共享 helper，预先给两轮不同的固定 `runId/turnId`。保留第一张 `limit:2` 页及其非空续页游标；第二轮完成后沿这个旧游标读到结束，断言续页非空、每条 Turn/事件都属于第一轮的固定身份、不出现第二轮身份。删除数字 6 的断言，不从输出或解码游标取得数字期望；保留跨 Session 拒绝断言。** |
| T2-034 | 有三处未闭合：①“取消真实 start”与直接调用入口写 owner 二选一；②现有 harness 不仅伪造 execution，还伪造 roles、Host 配置、body store 和扩展读取结果；③ CA04 直接改 `objective`，CA03 的“整个假 store 恰有一个正文”不能原样搬到真实世界。 | `.lead-ref/books/t-items-T2.md:237`；`tests/runtime/S3-context-assembler.test.ts:319`、`:393`、`:419`、`:420`、`:422`、`:596`、`:654`、`:661`、`:663`；`tests/runtime/S4C2-assembly.test.ts:283`、`:299`；`src/core/work-graph/state/goal-machine.ts:95`、`:108` | **固定走真实初始化、Session 创建、claim、prepare、start；仅在真实入口授权提交后用取消信号停止，禁止直接调用 `authorizeRuntimeEntry`。替换该 harness 的全部造值依赖。CA04 通过真实后继计划采用改变 Goal 的计划指针，通过真实 note 写入改变注记，不再改写 objective；保留重放相等及三种读取零次断言。CA03 用真实 body-store 的委托包装，仅统计两次 prepare 产生的不同 manifest 正文，期望为 1。CA15 在真实扩展读取依赖上注入抛错，保留 unavailable 和本次 prepare 零正文写入。** |
| T2-035 | 指定公开注册产生 Workspace revision 1，而现有夹具和创建 Goal 的钉仍为 7；仅替换种子会导致后续版本冲突。schemas 也尚未登记这些新公开步骤需要的全部事件和 catalog 记录。 | `tests/runtime/S3-graph-tools.test.ts:796`、`:849`、`:890`、`:927`；`src/core/work-graph/configuration/project-bootstrap-service.ts:669` | 补成：**两个 Workspace 都用公开注册得到 revision 1；把 `FX_WORKSPACE_REVISION` 及由它形成的请求钉、来源版本统一改为手算的 1。schemas 加入 `PROJECT_BOOTSTRAP_RECORD_SCHEMAS` 和 `ARCHITECTURE_CATALOG_SCHEMAS`，移除假 `TrustedScopeSeeded` 登记。四条 GT 用例及其业务断言保留。** |
| T2-036 | 所荐 `createTaskClaimFixture` 本身仍手写 bootstrap，并代 Runtime 直接建 Kernel Session、登记 Session；其任务身份也不是本文件的 tA/tB。仅把两次 Run 写入换成 `claimTask`，仍留下正文直写。 | `tests/helpers/task-claim-fixture.ts:198`、`:318`、`:324`、`:327`、`:347`；`tests/runtime/S3-graph-tools.test.ts:909`、`:931`、`:978`；`src/core/work-graph/tasks/claim-service.ts:1204` | **删除“可直接复用 task-claim-fixture”的指示。在本文件的 `openInputFixture` 内接上 T2-035 的真实世界；计划从真实脚本 Query 的已保存 Answer 经 `proposeInitialPlanFromAnswer`、采用产生；通过 Runtime 创建两个 Session，再分别 claim tA、tB。夹具返回真实 Run B 上下文供四条 GT 用例使用；领取 A 后调用真实 `materials.storeArtifact` 存正文，禁止保留 `rawBodies.put` 播种。ArtifactRef 仍由固定正文手算，A 不必先结束。** |
| T2-037 | 同样不能用现有 task-claim fixture 宣称符合 v1；而且它固定的 project、goal、task、plan 与 GTN20 的字面期望不一致。 | `tests/helpers/task-claim-fixture.ts:185`、`:318`、`:324`、`:347`；`tests/runtime/S4C-note-run-task-resolver.test.ts:12`、`:15`、`:60` | **GTN20 在本文件建立真实世界，保留公开输入 `projectId:'p'`、`goalId:'g'`、`planId:'pl'`、`taskId:'t1'`；计划经真实 Answer 采用，Session 经 Runtime 创建，再 claim t1。用返回的 RunRef/roleBinding 构造调用上下文，对同一真实 backend 的 `readMany` 委托计数，保留精确结果和一次读取。不要修改 TP 的 task-claim helper；GTN21 按条目原定范围保留。** |
| T2-038 | 合并目标确实存在，但目标通过固定返回成功结果的 NoteWrite/NoteCheck 假端口运行，不能按当前 v1 归入委托包装或纯函数。书要求遵守 v1，与既定合并方向冲突。 | `tests/runtime/S4C-note-tools.test.ts:67`、`:72`、`:92`、`:123`、`:187`；`docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md:35`、`:41`、`:52`、`:68` | **保留既定合并方向；增加施工前置：lead 在下一版规则中点名 `buildNoteTools`，仅允许本文件适配器参数映射及结果透传测试使用其记录型假端口，不得用于业务 owner 达态。冻结后按原条目迁入严格形状与全部默认值子例。** |
| T2-040 | “其余 27 处见 evidence”没有给出可执行文件清单；实际有 21 个必改文件不在 T2 白名单，其中四个已分给 TP/T1。另有两份源文件将由 T2-043/045 删除。共享 probe 返回手造成功能力，也需要解决 v1 规则冲突。 | `.lead-ref/books/t-items-T2.md:278`、`:279`；`tests/scenarios/support/process-sandbox-standin.ts:38`；`.lead-ref/books/t-files-TP.txt:172`；`.lead-ref/books/t-files-T1.txt:6`、`:7`、`:8` | **把下节列出的 21 个文件及原白名单中的 K3-05、K3-06、K3-09、K3-16-proposal、K3-19-review-unavailable 固定为 26 个存活迁移目标；K3-13、K3-19-missing-read 随删除项消失，不再迁移。先完成四个冲突文件的归属交接。lead 同时在下一版规则中点名该 probe 替身，仅允许本条 `executeChecks:false` 的能力探测用途；冻结后迁移，K3-12-14 不动。** |
| T2-041 | 独有断言清单不全，且 rounds 的行号错误。还缺结束后 Run 的 review purpose，以及 concluded/resolved 两阶段各恰有一条 item 的约束；源测试的数组 `toMatchObject` 包含长度约束，目标只读 `[0]`。 | `tests/scenarios/K3-06-mixed-batch.test.ts:213`、`:216`、`:227`、`:229`；`tests/scenarios/K3-05-review-round.test.ts:155`、`:160`、`:178`、`:180` | **在原迁移清单上增加：ended Run 的 `{kind:'unknown_call_review',phase:'review',round:1}`；concluded.items 和 resolved.items 各 `toHaveLength(1)`。rounds 来源改为第 229 行，并保留其精确单元素约束。目标名称带 K3-06，再删 process 源例。** |
| T2-042 | “加选项，否则保留”把最终范围留给实现者；列出的选项也不足：需要保留自定义调用/流程/请求身份、shell 参数、实际重启报告、延后释放及 K3-37 的创建后断言。 | `.lead-ref/books/t-items-T2.md:293`；`tests/scenarios/support/review-card-round.ts:58`、`:72`；`tests/scenarios/K3-10-review-round-cells.test.ts:122`、`:131`；`tests/scenarios/K3-37-stopped-review-round.test.ts:123`、`:140`、`:143`；`tests/scenarios/K3-29-recovery-round.test.ts:172`、`:176` | **固定迁移删除项之外的 14 份。共享 helper 接收原调用身份、流程身份、请求身份和 shell 参数，返回真实 `{runRef, prepared, report, release}`；`release` 幂等，出错时自动清理。原来即时释放的调用方在原位置释放；29-disposition、29-maintenance、29-continuation、29-round、44-recovery 保留原释放时机。各调用方保留原 W-26 断言，K3-37 保留创建后记录及条目断言。删除“否则保留”；新增文件见白名单表。** |
| T2-043 | 漏掉定稿后 `items` 恰有一条；目标当前没有这个断言。合并后源文件只剩辅助代码，也应明确整文件删除。 | `tests/scenarios/K3-13-two-commands.test.ts:160`；`tests/scenarios/K3-05-review-round.test.ts:175`、`:180`；`tests/scenarios/K3-13-two-commands.test.ts:107` | **在已有迁移清单中加入 settled/resolved.items 的 `toHaveLength(1)`，与 T2-041 的最终条目数断言共用一次。迁完 alias、严格 observed、open 和 evidence 后删除整份 `K3-13-two-commands.test.ts`；目标名称同时保留 K3-05、K3-06、K3-13。** |
| T2-044 | 统一包住“prepare→start→close”会把原来位于 prepare 与 start 之间的 manifest 检查挤出去；另一消费者还需要提案 RunRef 检查重启报告。只写“L13 工具集”也不够精确，这里实际是提案工具集。 | `tests/scenarios/K3-16-proposal-round.test.ts:128`、`:132`、`:143`；`tests/scenarios/K3-29-startup-variants.test.ts:214`、`:223` | **固定 `proposalRound` 先完成 open/prepare，断言工具恰为 `['read','run_readonly_command','propose_safer_method']`，返回真实 prepared、RunRef、model 及绑定该 prepared 的 start/close 操作。调用方在 start 前保留原 manifest/writeScope 检查，随后断言 start ready，并在 finally close；startup 用例保留 RunRef 与重启报告断言。答卡、settle 留在调用方。补入两份漏列消费者。** |
| T2-046 | 迁移 `createNeedsDecisionRecord` 时没有规定它依赖的延后释放怎样移交。两份原函数都依赖本文件 `crashHandles`，不能换成当前共享 helper 的立即释放。还漏列三个存活消费者。 | `tests/scenarios/K3-29-disposition-recovery.test.ts:86`、`:100`、`:143`；`tests/scenarios/K3-44-recovery-answers.test.ts:101`、`:143`；`tests/work-graph/K3-18-review-card-queue.test.ts:129` | **在原目标文件共享 `openMissingReadReviewRoot` 和 `createNeedsDecisionRecord`；后者接收 label、hostInstanceId，调用 T2-042 的延后释放路径并返回 release，由两份调用文件在原清理位置执行。保留原 hostInstanceId、settle receipt 和 needs_decision/open/activeRound 断言。T2-045 删除的副本不迁；补入三个存活消费者。** |
| T2-047 | “启动前钩子”可能被放在 prepare 之后，但原忽略目录在 prepare 前已经存在；当前 helper 不返回 manifest，搬不出 baseline 断言。还漏了真实单条 edit 的 toolName/kind 断言。 | `tests/scenarios/K3-R1-file-change.test.ts:147`、`:148`、`:179`、`:182`、`:230`、`:234`、`:270`、`:271`、`:315` | **钩子固定在 `HostScenario.open` 后、第一次 `h.advance` 前执行；`driveSingleEdit` 额外返回实际 manifest。按原条目搬入忽略目录、受保护文件名及 workspaceBaseline 断言；replace/create 两条各补 `toolName:'edit'`、`kind:'file_edit'`。仅移除已裁定取消的双调用数量与双调用并行身份断言，再删注入例。** |
| T2-049 | “名字或注释”与书要求规格行号必须放在目标测试名称中冲突。 | `.lead-ref/books/t-items-T2.md:343`；`.lead-ref/books/t-book.md:44`；`tests/scenarios/S2C-K-retired.test.ts:242` | **将目标参数化测试名称同时写入 `2C-21 (2)`、`2C-22 (2)`、`2C-22 (4)`；删除“或注释”。其余合并方向和保留范围不变。** |
| T2-050 | 指定迁移的 `damageKernel` 是直接 SQL 改写真实 Kernel 记录；它不属于 v1 列出的允许形态，A7 又为空。不能让 DSH 因为它叫故障 helper 就自行认定允许。 | `tests/scenarios/S2C-K-unknown-outcome.test.ts:38`、`:41`；`tests/scenarios/S2C-K-retired.test.ts:193`；`docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md:28`、`:52`、`:64` | **保留既定迁移与 damaged 行为；增加前置：lead 在下一版规则中精确登记 `damageKernel` 的 Kernel 损坏注入例外，只准损坏临时 Kernel 的事件 JSON，不准造写 WorkGraph 业务事实。规则冻结后原样迁移，不能删除这些当前 damaged 场景来绕过冲突。** |
| T2-051 | “同 B-09”有歧义：本组 B-09 是 T2-046，真正所指在 TP-123。另须给 tA 单独的模型回复，否则会先消耗 SC02 为后续工作准备的 send 回复。 | `.lead-ref/books/t-items-T2.md:320`、`:357`；`.lead-ref/books/t-items-TP.md:829`、`:830`；`tests/scenarios/S3-query-graph.test.ts:299`、`:317`、`:392`、`:395`、`:406`、`:441` | **删除“同 B-09”，写全：先由固定正文手算 ArtifactRef，在一次计划采用中声明它；计划通过真实已保存 Answer 产生；给 tA 独立的一条文本回复，advanceWork 到其 completed、open_checks 前停止，用真实 RunRef 调 storeArtifact。返回实际 runARef，并在 Query 启动前补入 history 脚本参数；断言使用这个公开输入身份。原 send 回复留给后续工作，计划仍只有 revision 1。** |
| T2-052 | 第二份必须修改的文件归 TP；其 TP-123 正在转换同一段初始化。按照 run 文件“合并先于转换”抽取，会把即将删除的 SQL Run 种子搬进新 helper。资源关闭的归属也未写入抽取范围。 | `.lead-ref/books/t-files-TP.txt:174`；`.lead-ref/books/t-items-TP.md:829`；`tests/scenarios/S3-context-and-inputs.test.ts:197`、`:307`、`:310`；`tests/scenarios/S3-query-graph.test.ts:114`、`:117`、`:315`、`:317` | **先完成并承接 TP-123 与 T2-051 的转换，再由 lead 将 `S3-context-and-inputs.test.ts` 交给 T2，禁止两组继续并写。之后抽取真实初始化到 `S3-host.ts`；明确把资源关闭纳入接口，由返回的 S3Host 提供 close、两个调用方负责 finally 关闭。不要把 seedCompletedRun/runASnapshot 搬进共享文件。** |
| T2-053 | 所引 A11 覆盖的是 cap 1，不能支持文字声称的“所有断言都在这些位置”，尤其是 cap 0。已有其他保留测试覆盖 cap 0，可以补足依据，无须改变删除决定。 | `tests/scenarios/harness.test.ts:204`、`:206`；`tests/scenarios/A11-no-progress.test.ts:398`、`:399`；`tests/app/A2-automation-verdict.test.ts:120`、`:124`、`:133` | **覆盖/依据增加 `tests/app/A2-automation-verdict.test.ts:120–133`，明确它覆盖 cap 0 保存及 TaskRow 停止判定；A11 继续负责下调上限、waiting、空 receipt 和计数不变。保留删除动作。** |
| T2-062 | 第一段删除范围多算一行：第 606 行结束外层 describe，并非待删测试的一部分。照范围删除会破坏语法结构。 | `tests/state/control-intent-machine.test.ts:602`、`:605`、`:606`；`.lead-ref/books/t-items-T2.md:433`、`:436` | **第一段改为只删 602–605，保留第 606 行；另两段仍删 853–857、859–876，保留第 877 行外层结束括号。同步修正条目标题和核实理由中的范围。** |

上述转换所用的 Answer→计划入口确实存在：`src/core/work-graph/model/plan-contracts.ts:242`；Workflow 调用及采用接续在 `src/business/workflow/workflow.ts:829`、`:842`。它用于避免把现有手写 draft 的 fixture 换个名字继续使用。

**3. 白名单增补**

共 **27 个文件**，其中一个是本次修正明确命名的新共享文件。下表“无”表示 TP、TQ、T1、T3 四份白名单均未列入；核对入口分别为 `.lead-ref/books/t-files-TP.txt:1`、`.lead-ref/books/t-files-TQ.txt:1`、`.lead-ref/books/t-files-T1.txt:1`、`.lead-ref/books/t-files-T3.txt:1`。

“已归其他组”的文件必须先交接，不能简单加入后继续并行修改。

| 文件／当前修改位置 | 哪个条目 | 在其他组白名单？ |
|---|---|---|
| `tests/kernel/README.md:16` | T2-005，说明还涉及 006/007/008/009 | 无 |
| `tests/record-store/SP-lookup-index-migration.test.ts:31` | T2-016 | 无；TQ 把它列作覆盖证据，不是编辑白名单，见 `.lead-ref/books/t-items-TQ.md:432` |
| `tests/helpers/R4-history-turn-support.ts`（新增） | T2-025、030 | 无 |
| `tests/scenarios/B2-09b-allowance-crash.test.ts:53` | T2-040 | 无 |
| `tests/scenarios/K3-08-wait-reply.test.ts:44` | T2-040 | **TP**，`.lead-ref/books/t-files-TP.txt:172` |
| `tests/scenarios/K3-10-review-round-cells.test.ts:41` | T2-040、042 | 无 |
| `tests/scenarios/K3-11-review-reasons-r2.test.ts:53` | T2-040、042 | **T1**，`.lead-ref/books/t-files-T1.txt:6` |
| `tests/scenarios/K3-15-card-hold.test.ts:34` | T2-040 | 无 |
| `tests/scenarios/K3-16-approval-round.test.ts:46` | T2-040、044 | 无 |
| `tests/scenarios/K3-17-review-answer-shape.test.ts:47` | T2-040、042、046 | 无 |
| `tests/scenarios/K3-18-one-card.test.ts:42` | T2-040、042 | 无 |
| `tests/scenarios/K3-26-inventory-scenarios.test.ts:127` | T2-040 | 无 |
| `tests/scenarios/K3-27-review-claim-close.test.ts:41` | T2-040 | 无 |
| `tests/scenarios/K3-28-attested-continuation.test.ts:33` | T2-040 | 无 |
| `tests/scenarios/K3-29-maintenance-review-run.test.ts:40` | T2-040、042 | 无 |
| `tests/scenarios/K3-29-recovery-continuation.test.ts:40` | T2-040、042 | 无 |
| `tests/scenarios/K3-29-recovery-round.test.ts:52` | T2-040、042 | 无 |
| `tests/scenarios/K3-29-startup-variants.test.ts:47` | T2-040、044 | 无 |
| `tests/scenarios/K3-37-stopped-review-round.test.ts:42` | T2-040、042 | **T1**，`.lead-ref/books/t-files-T1.txt:7` |
| `tests/scenarios/K3-42-truncated-command.test.ts:48` | T2-040 | 无 |
| `tests/scenarios/K3-42-unexpanded-r2.test.ts:48` | T2-040 | 无 |
| `tests/scenarios/K3-44-hold-restart.test.ts:39` | T2-040、042 | 无 |
| `tests/scenarios/K3-44-recovery-answers.test.ts:80`、`:110`、`:143` | T2-042、046 | 无 |
| `tests/scenarios/K3-45-review-incomplete-r2.test.ts:55` | T2-040、042 | **T1**，`.lead-ref/books/t-files-T1.txt:8` |
| `tests/scenarios/K3-R1-second-cleanup.test.ts:46` | T2-040 | 无 |
| `tests/work-graph/K3-18-review-card-queue.test.ts:129` | T2-046 | 无 |
| `tests/scenarios/S3-context-and-inputs.test.ts:286` | T2-052 | **TP**，`.lead-ref/books/t-files-TP.txt:174` |

**4. 必须一起落地或按顺序执行的条目**

| 条目 | 固定顺序／协作边界 | 依据 |
|---|---|---|
| T2-001、002、022 | 同一人完成一次合并。三条独有输入只迁一次，contracts 重复例只删一次，最后删除 runtime 文件。 | `.lead-ref/books/t-items-T2.md:6`、`:13`、`:153` |
| T2-004、012、013 | 同批完成导出、backend 能力类型、dir 返回和两个消费者迁移。 | `tests/helpers/S4B-text-search-support.ts:69`、`:104`、`:129`；`tests/record-store/S2A-ordered-lookup.test.ts:375` |
| T2-005—009、024、025、029、030、032 | 先做相关公开 bootstrap 和 Turn 转换，再清理旧 writer。005/007/008 清掉 R4a 依赖；025/030 清掉 R4b 依赖；009 最后。025/030/032 与 R4c helper 抽取同一人负责。 | `tests/kernel/R4a-legacy-fixtures.ts:18`、`:52`；`tests/runtime/R4b-session-input-boundaries.test.ts:119`；`tests/runtime/R4b-session-recovery.test.ts:184`、`:192`；`tests/runtime/R4c-execution-history.test.ts:80`、`:99` |
| T2-018、019 | 两份 allowance 文件交同一人：一条向 crash 文件归并，另一条反向归并到 B2-04，不能按文件分给两个同时工作的子任务。 | `.lead-ref/books/t-items-T2.md:125`、`:132` |
| T2-035、036 | 先公开 bootstrap，再建立计划、Session、claim 和材料；同一 `openInputFixture` 一次替换。 | `tests/runtime/S3-graph-tools.test.ts:846`、`:866`、`:908`、`:978` |
| T2-040—046 | 先完成 041/043 对 K3-05 的断言合并及 045 删除；042、044、046 的共享接口由同一负责人维护；040 只处理存活文件。046 使用 042 的延后释放接口。 | `tests/scenarios/support/review-card-round.ts:58`；`tests/scenarios/K3-29-disposition-recovery.test.ts:100`、`:143`；`.lead-ref/books/t-items-T2.md:300`、`:314` |
| T2-040/042 与 T1 | T1 先完成三个冲突文件的自身改动并交接，T2 再做共享化。T1-002 会同时改 K3-37/K3-45；T1-016、022 也以其中文件为合并目标。 | `.lead-ref/books/t-items-T1.md:13`、`:111`、`:153` |
| T2-040 与 TP | K3-08 先承接 TP-031 的通信字段转换，再由 T2 迁移 sandbox 替身。 | `.lead-ref/books/t-items-TP.md:202`；`tests/scenarios/K3-08-wait-reply.test.ts:44` |
| T2-003、049、050 | 同一人维护 S2C-K support；先完成 049 删除重复场景，再抽剩余故障 helper。003 删除的未使用辅助不要在抽取时重新带回。 | `.lead-ref/books/t-items-T2.md:19`、`:343`、`:350` |
| TP-123、T2-051、052 | 两份真实初始化转换完成并交接后，052 才抽共享代码。 | `.lead-ref/books/t-items-TP.md:830`；`.lead-ref/books/t-items-T2.md:357`、`:364` |
| T2-060、061 | 同批清理纯测试文件及只剩这两条使用的辅助函数；保留构造器上限测试。 | `.lead-ref/books/t-items-T2.md:422`、`:427` |
| T2-064 与 TP-025 | **还有一处白名单没有显露的实际编辑冲突。** TP-025 明写要改 `tests/state/task-machine.test.ts:144,1350`，但该文件归 T2。由 lead 将该文件涉及 TP-025 的改动固定交给 T2 同一负责人，和 064 一起核对；不得让两组分别修改后才处理冲突。TP-025 尚待 lead 冻结的“两个旧根”处理，不属于 064 的删除授权。 | `.lead-ref/books/t-items-TP.md:161`、`:162`；`.lead-ref/books/t-files-T2.txt:59`；`.lead-ref/books/t-items-T2.md:448` |

T2-064 的生产调用链也已用 `rg` 查过。其动作删除的是一条条件，保留函数及签名；当前产生规则在有 gaps 时不会给出 PASS，保留测试也钉住这一点。证据：`src/core/work-graph/state/task-machine.ts:1031`、`:1044`；`src/core/work-graph/state/verification-machine.ts:882`；`tests/state/verification-machine.test.ts:901`。

| 调用方／下游读取方 | 是否在 T2 白名单外 | 条目是否覆盖其影响 |
|---|---|---|
| 同文件 `onTaskCompleted` 调用该判定；由 `transitionTask` 的 `task_completed` 分派进入。`src/core/work-graph/state/task-machine.ts:811`、`:1133` | 否 | 是；函数仍保留，不需要改调用。 |
| completion 先判轮次、再判 producer，最后经状态机完成任务。`src/core/work-graph/tasks/completion.ts:363`、`:379`、`:430` | **是**，其他组白名单也未列入 | 是；当前格式输入下返回接口及有效拒绝顺序不变，无须编辑。 |
| Goal service 包装 completion。`src/core/work-graph/tasks/task-service.ts:421`、`:424` | **是**，其他组白名单也未列入 | 无须编辑；消费的完成结果接口未变。 |
| composition 包装 `completeTask`。`src/composition/create-platform.ts:1257` | **是，归 TP** | 无须编辑。 |
| Workflow 调用并消费 `completeTask`；其操作类型引用同一接口。`src/business/workflow/workflow.ts:2503`；`src/business/workflow/contracts.ts:87` | **是，归 TP** | 无须编辑。 |
| 公开接口声明。`src/core/work-graph/model/task-contracts.ts:70` | **是**，其他组白名单也未列入 | 无须编辑。 |
| `transitionTask` 的其他生产调用：claim、计划 disposition、requeue、rework refusal。`src/core/work-graph/tasks/claim-service.ts:1236`；`src/core/work-graph/tasks/plan-service.ts:2711`；`src/core/work-graph/tasks/requeue-service.ts:1097`、`:1261` | **均在外**；plan/requeue 归 TP，claim 未列入其他组 | 这些调用不进入 `task_completed` 分支，无须编辑。 |
| 判定函数的直接测试及 completion 状态测试。`tests/state/task-machine.test.ts:890`、`:996`、`:1013`、`:1025` | 否 | 064 已列出旧 gaps 输入的删除位置；需另处理上表所述 TP-025 同文件归属。 |

因此，**没有发现 T2-064 必须额外修改的生产调用方，也没有生产白名单增补。**

**5. 总书和 run 文件的问题**

| 位置 | 问题 | 固定修正 |
|---|---|---|
| `.lead-ref/books/t-run-T2.md:6` | “删除、合并先做，转换最后”与 009 的明确前置、052 的共享化顺序冲突。 | 改为：**按上节依赖顺序施工；清除旧 writer 晚于全部消费者转换，共享化晚于相关事实转换；其余无依赖项才按删除、合并、转换安排。** |
| `.lead-ref/books/t-book.md:30`、`:31`；`.lead-ref/books/t-run-T2.md:5` | 共享化需要实质改写调用文件，不属于“删除符号后，为编译删 import/usage”的唯一例外；现有“各组不重叠”不能代替实际动作范围核对。 | **补齐 27 个文件，并冻结五个已归 TP/T1 文件的交接次序；另把 TP-025 对 task-machine 测试的修改交给 T2。交接前相关项不得施工。** |
| `.lead-ref/books/t-book.md:48`、`:65` | v1 与几项已裁定迁移直接冲突：RecordStore helper 构造记录并 commit；note adapter helper 返回固定结果；sandbox probe 返回固定能力；damageKernel 改写 Kernel JSON。不能同时要求原样迁移和绝对遵守当前 v1。 | **由 lead 在施工前发布下一版规则，明确限定这些已裁定用途，书中引用该冻结版本；不得由 DSH 自行豁免。逐项范围为 T2-012/013 的 Widget 存储测试辅助、T2-016 的 W/V 存储测试辅助、T2-038 的适配器记录型假端口、T2-040 的 probe、T2-050 的 Kernel 损坏注入。禁止把这些许可用于业务事实播种。** |
| `docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md:3`；`.lead-ref/books/t-book.md:29` | “scope”到底指条目动作还是白名单整文件没有说清。T2-037 明确保留 GTN21，而它仍使用构造记录和假 readMany；把整个白名单文件当改造范围，会额外扩大既定任务。 | **在书中定义：白名单是可编辑文件边界，施工对象仍是条目指定的行／测试／helper；条目明示保留的兄弟行不擅自扩改。新转换所依赖的前置状态仍须符合冻结规则，不能借此继续使用违规播种路径。** |
| `.lead-ref/books/t-book.md:44` | 与 T2-049 的“名字或注释”冲突。 | **保留总书要求，按 T2-049 修正将规格编号放入测试名称。** |
| `.lead-ref/books/t-book.md:50` | 与 T2-030 的“从公开历史输出取得上界作为期望”冲突。 | **保留总书要求，按 T2-030 修正使用预先给定的两轮执行身份检验分页隔离。** |
| `.lead-ref/books/t-book.md:79`、`:80` | “每个改过的测试文件”包含整文件删除项；直接把删除路径放入执行清单没有可执行目标。 | **检查清单只列仍存在的变更测试文件及改动模块的存活测试消费者；整文件删除项在台账中映射到保留覆盖，不把已删除路径传给 Vitest。** |

上述规则冲突的代码位置分别为：`tests/helpers/S4B-text-search-support.ts:79`、`:104`、`:155`；`tests/record-store/SP-literal-type.test.ts:125`、`:134`；`tests/record-store/SP-lookup-index-migration.test.ts:59`、`:68`；`tests/runtime/S4C-note-tools.test.ts:72`、`:92`；`tests/scenarios/support/process-sandbox-standin.ts:38`；`tests/scenarios/S2C-K-unknown-outcome.test.ts:38`。GTN21 的明确保留及实现见 `.lead-ref/books/t-items-T2.md:259`、`tests/runtime/S4C-note-run-task-resolver.test.ts:64`。

**6. 条目修改 JSON**

```json
[
  {
    "id": "T2-004",
    "problem": "撤销 change 导出会破坏 T2-012 合并后保留的 S2A 重开数据库用例。",
    "fix": "只撤销 at、event、SearchRequest 的导出；保留 change 导出。与 T2-012、T2-013 同批完成。",
    "files_add": []
  },
  {
    "id": "T2-005",
    "problem": "已要求修改 tests/kernel/README.md，但该文件不在白名单，且相关历史说明不限于第16行。",
    "fix": "将 README 加入白名单，追加 T 轮后注说明 T2-005至009后的保留范围及旧 writer 删除情况，保留原历史迁入说明原义。",
    "files_add": ["tests/kernel/README.md"]
  },
  {
    "id": "T2-009",
    "problem": "保留目录 helper 或迁移 helper 未冻结；删除 writer 必须晚于消费者转换，和 run 文件统一顺序冲突。",
    "fix": "TempWorkspace/createTempWorkspace 留在原文件；先完成 T2-005、007、008、025、030，再删除旧 writer 和专用导入。不新建中性目录 helper，前置项统一使用 T2 编号。",
    "files_add": []
  },
  {
    "id": "T2-012",
    "problem": "共享 open 的 backend 类型缺少 S2A 所需 lookup 和 lookupOrdered。",
    "fix": "共享 backend 类型增加 RecordLookupPort、RecordOrderedLookupPort，并实际返回 dir；S2A 保留自己的索引、unknown 注册入口和分页函数，不用强制断言掩盖能力缺失。",
    "files_add": []
  },
  {
    "id": "T2-013",
    "problem": "共享 open 的 backend 类型缺少 S2C 所需 countLookup。",
    "fix": "共享 backend 类型增加 RecordCountPort，与 T2-012 合成一次修改；保留 S2C 五个索引和 countOf，各次 open 显式传入本文件 schemas。",
    "files_add": []
  },
  {
    "id": "T2-016",
    "problem": "第二个必须迁移的消费者未列入任何组白名单。",
    "fix": "增加 SP-lookup-index-migration.test.ts；共享 typed 的默认体先于调用方正文展开，literal 文件传 group:shared，migration 文件传空默认体，open 各自保留。",
    "files_add": ["tests/record-store/SP-lookup-index-migration.test.ts"]
  },
  {
    "id": "T2-025",
    "problem": "共享化和复制两种实现未冻结，共享文件也未命名授权。",
    "fix": "新建 tests/helpers/R4-history-turn-support.ts，迁入 scriptedClient、TurnInput、runTurn；R4c 和两份 R4b 共同导入，只接受公开执行输入，不接受手写记录。",
    "files_add": ["tests/helpers/R4-history-turn-support.ts"]
  },
  {
    "id": "T2-030",
    "problem": "从第一轮输出提取数字上界作为期望违反书中期望值规则，首张限长页末位置也不是整轮上界。",
    "fix": "使用共享 runTurn，以预先给定且不同的两轮 runId/turnId 执行；保留第一张 limit:2 页和非空续页游标。第二轮后沿旧游标读到结束，断言续页非空、每条记录属于第一轮固定身份且没有第二轮身份；删除数字6断言，保留跨 Session 拒绝，不解码游标生成期望。",
    "files_add": ["tests/helpers/R4-history-turn-support.ts"]
  },
  {
    "id": "T2-034",
    "problem": "绑定路径二选一；harness 仍有多个造值依赖，CA04 直接修改 objective，CA03 的整个假正文库大小无法照搬到真实世界。",
    "fix": "固定真实初始化、Runtime创建Session、claim、prepare、start后在入口提交点取消；禁止直接 authorizeRuntimeEntry。替换该 harness 的造值依赖。CA04 通过真实后继计划采用改变 Goal 指针、真实 note 写入改变注记，保留重放及零读取断言；CA03 用真实正文库委托包装统计两次 prepare 的不同 manifest 正文，期望1；CA15 在真实扩展依赖上注入抛错并保留 unavailable 和零正文写入。",
    "files_add": []
  },
  {
    "id": "T2-035",
    "problem": "公开注册写 Workspace revision 1，夹具与请求仍用7；schemas 未补齐。",
    "fix": "两个 Workspace 公开注册后统一使用手算 revision 1，同步 FX_WORKSPACE_REVISION、请求钉和来源版本；加入 PROJECT_BOOTSTRAP_RECORD_SCHEMAS、ARCHITECTURE_CATALOG_SCHEMAS，移除 TrustedScopeSeeded，保留四条 GT 业务断言。",
    "files_add": []
  },
  {
    "id": "T2-036",
    "problem": "所荐 task-claim fixture 仍手写 bootstrap 和 Session 事实，身份也不同；只换 Run 写入仍留下正文直写。",
    "fix": "在本文件 openInputFixture 中接上 T2-035；计划从真实脚本 Query 保存的 Answer 经 proposeInitialPlanFromAnswer 和采用产生；Runtime 创建两个 Session 后分别 claim tA、tB。返回真实 Run B 上下文；领取A后用 materials.storeArtifact 存正文，删除 rawBodies.put 播种。ArtifactRef 仍按固定正文手算，A不必结束，不修改 TP 的 task-claim helper。",
    "files_add": []
  },
  {
    "id": "T2-037",
    "problem": "所荐 fixture 不符合 v1，其固定身份也不能保持 GTN20 的字面期望。",
    "fix": "GTN20 在本文件公开建立 p/g/pl/t1 世界，计划经真实 Answer 采用，Runtime 创建 Session 后 claim t1；用实际 RunRef/roleBinding 构造上下文，对同一真实 backend 的 readMany 委托计数，保留精确结果和一次读取。GTN21按原条目保留，不修改 TP helper。",
    "files_add": []
  },
  {
    "id": "T2-038",
    "problem": "合并目标依赖固定返回成功结果的 NoteWrite/NoteCheck 假端口，与当前 v1 冲突。",
    "fix": "保留合并方向；lead 先在下一版规则点名 buildNoteTools，仅限本文件适配器参数映射和结果透传测试，不得用于业务 owner 达态。冻结后迁入严格形状及全部默认值子例。",
    "files_add": []
  },
  {
    "id": "T2-040",
    "problem": "缺少完整文件清单，21个必改文件不在白名单，四个归其他组；两个源文件即将删除；probe替身还与v1冲突。",
    "fix": "冻结26个存活迁移目标：本项files_add中的21个，加原白名单中的K3-05、K3-06、K3-09、K3-16-proposal、K3-19-review-unavailable。K3-13和K3-19-missing-read随删除项消失。先交接TP/T1冲突文件；lead在下一版规则点名本条executeChecks:false的probe用途后迁移，K3-12-14不动。",
    "files_add": [
      "tests/scenarios/B2-09b-allowance-crash.test.ts",
      "tests/scenarios/K3-08-wait-reply.test.ts",
      "tests/scenarios/K3-10-review-round-cells.test.ts",
      "tests/scenarios/K3-11-review-reasons-r2.test.ts",
      "tests/scenarios/K3-15-card-hold.test.ts",
      "tests/scenarios/K3-16-approval-round.test.ts",
      "tests/scenarios/K3-17-review-answer-shape.test.ts",
      "tests/scenarios/K3-18-one-card.test.ts",
      "tests/scenarios/K3-26-inventory-scenarios.test.ts",
      "tests/scenarios/K3-27-review-claim-close.test.ts",
      "tests/scenarios/K3-28-attested-continuation.test.ts",
      "tests/scenarios/K3-29-maintenance-review-run.test.ts",
      "tests/scenarios/K3-29-recovery-continuation.test.ts",
      "tests/scenarios/K3-29-recovery-round.test.ts",
      "tests/scenarios/K3-29-startup-variants.test.ts",
      "tests/scenarios/K3-37-stopped-review-round.test.ts",
      "tests/scenarios/K3-42-truncated-command.test.ts",
      "tests/scenarios/K3-42-unexpanded-r2.test.ts",
      "tests/scenarios/K3-44-hold-restart.test.ts",
      "tests/scenarios/K3-45-review-incomplete-r2.test.ts",
      "tests/scenarios/K3-R1-second-cleanup.test.ts"
    ]
  },
  {
    "id": "T2-041",
    "problem": "遗漏 ended Run purpose、concluded/resolved 两阶段 item 数量断言，rounds来源行号也错误。",
    "fix": "除原清单外迁入 ended Run 的 unknown_call_review/review/round1 purpose，concluded.items和resolved.items各断言长度1；rounds来源修正为229行并保留单元素约束。目标名称带K3-06，再删除process源例。",
    "files_add": []
  },
  {
    "id": "T2-042",
    "problem": "否则保留使迁移范围未冻结，选项不足以保持身份、参数、报告、释放时机和K3-37创建后断言。",
    "fix": "固定迁移删除项之外的14份。共享helper接收原调用、流程、请求身份及shell参数，返回真实runRef/prepared/report及幂等release，出错自动清理。即时释放者保留原位置；29-disposition、29-maintenance、29-continuation、29-round、44-recovery保持延后释放。各调用方保留W-26断言，K3-37保留创建后断言。删除否则保留。",
    "files_add": [
      "tests/scenarios/K3-10-review-round-cells.test.ts",
      "tests/scenarios/K3-11-review-reasons-r2.test.ts",
      "tests/scenarios/K3-17-review-answer-shape.test.ts",
      "tests/scenarios/K3-18-one-card.test.ts",
      "tests/scenarios/K3-29-maintenance-review-run.test.ts",
      "tests/scenarios/K3-29-recovery-continuation.test.ts",
      "tests/scenarios/K3-29-recovery-round.test.ts",
      "tests/scenarios/K3-37-stopped-review-round.test.ts",
      "tests/scenarios/K3-44-hold-restart.test.ts",
      "tests/scenarios/K3-44-recovery-answers.test.ts",
      "tests/scenarios/K3-45-review-incomplete-r2.test.ts"
    ]
  },
  {
    "id": "T2-043",
    "problem": "遗漏定稿后items长度1，未明确源文件在唯一测试迁完后的删除。",
    "fix": "迁入settled/resolved.items长度1，与T2-041共用一次断言；迁完alias、严格observed、open、evidence后删除整份源文件，目标名称同时保留K3-05、K3-06、K3-13。",
    "files_add": []
  },
  {
    "id": "T2-044",
    "problem": "整段封装没有保留prepare与start之间的检查位置及startup用例需要的RunRef，工具集名称也不够精确。",
    "fix": "proposalRound先open/prepare并断言工具恰为read、run_readonly_command、propose_safer_method，返回真实prepared、RunRef、model及绑定该prepared的start/close。调用方在start前保留manifest/writeScope检查，断言start ready并finally close；保留startup的RunRef/重启报告断言，答卡与settle留在调用方。",
    "files_add": [
      "tests/scenarios/K3-16-approval-round.test.ts",
      "tests/scenarios/K3-29-startup-variants.test.ts"
    ]
  },
  {
    "id": "T2-046",
    "problem": "createNeedsDecisionRecord依赖本地延后释放，迁移未规定释放责任，且漏列三个消费者。",
    "fix": "在原目标文件共享两个函数；createNeedsDecisionRecord接收label、hostInstanceId，使用T2-042延后释放路径并返回release，由调用文件在原清理位置执行。保留host身份及settle/needs_decision/open/activeRound断言；不迁T2-045删除的副本。",
    "files_add": [
      "tests/scenarios/K3-17-review-answer-shape.test.ts",
      "tests/scenarios/K3-44-recovery-answers.test.ts",
      "tests/work-graph/K3-18-review-card-queue.test.ts"
    ]
  },
  {
    "id": "T2-047",
    "problem": "启动前钩子的时点不确定，helper不返回manifest，且漏了单条edit的toolName/kind断言。",
    "fix": "钩子固定在HostScenario.open后、首次advance前；driveSingleEdit返回实际manifest。迁移原列出的可见性、保护名和baseline断言，replace/create各补toolName:edit、kind:file_edit。仅移除已取消的双调用数量和并行身份断言，再删注入例。",
    "files_add": []
  },
  {
    "id": "T2-049",
    "problem": "规格编号可放注释的写法与总书要求放在测试名称冲突。",
    "fix": "目标参数化测试名称同时写入2C-21(2)、2C-22(2)、2C-22(4)，删除或注释这一选项，其余动作不变。",
    "files_add": []
  },
  {
    "id": "T2-050",
    "problem": "damageKernel直接SQL改写Kernel记录，不在v1允许形态内，A7为空。",
    "fix": "保留迁移和damaged行为；lead先在下一版规则精确登记临时Kernel事件JSON损坏注入例外，禁止造写WorkGraph事实。冻结后原样迁移，不删除当前damaged场景来绕过规则。",
    "files_add": []
  },
  {
    "id": "T2-051",
    "problem": "同B-09指向歧义；未明确给tA独立回复会消耗SC02后续send脚本。",
    "fix": "写全转换链：固定正文手算ArtifactRef，在真实Answer产生并一次采用的计划中声明；给tA独立文本回复，advance到completed且open_checks前停，用真实RunRef存Artifact。返回runARef并在Query启动前补history参数；原send回复保留给后续工作，计划仍为revision1。",
    "files_add": []
  },
  {
    "id": "T2-052",
    "problem": "第二份消费者归TP且同段由TP-123转换；先抽取会迁移旧SQL种子，关闭责任也未纳入接口。",
    "fix": "先完成并承接TP-123、T2-051，再由lead将S3-context-and-inputs.test.ts交接给T2；随后抽取真实初始化到S3-host.ts，S3Host提供close，两个调用方finally关闭。不迁seedCompletedRun/runASnapshot，禁止两组继续并写。",
    "files_add": ["tests/scenarios/S3-context-and-inputs.test.ts"]
  },
  {
    "id": "T2-053",
    "problem": "所引A11测试是cap1，覆盖说明缺少cap0的实际断言位置。",
    "fix": "覆盖依据增加tests/app/A2-automation-verdict.test.ts:120-133负责cap0保存和TaskRow停止；A11继续负责下调上限、waiting、空receipt、计数不变。删除动作保持不变。",
    "files_add": []
  },
  {
    "id": "T2-062",
    "problem": "602-606多包含外层describe结束括号。",
    "fix": "第一段只删602-605并保留606；另两段删853-857、859-876并保留877。同步修正条目标题和核实理由。",
    "files_add": []
  }
]
```

**7. 核对完整性**

- **完整核对：T2-001—T2-064，全部 64 项。** 核对包括所指代码、删除依据、合并断言、转换入口及前置、共享辅助消费者、白名单和组内依赖；T2-064 另查了生产调用链。
- **仅略读：无。**
- **未核对：无。**
- “完整核对”是本次只读书审结论；不代表已经执行转换或验证测试通过。