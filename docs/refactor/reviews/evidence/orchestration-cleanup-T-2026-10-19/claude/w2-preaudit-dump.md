## T1a-01 未完成 | T3-106 | tests/work-graph/A2-disposition-change.test.ts:349-366, 590-596
P: guard 2（unknown outcome）这一行仍保留手写的 seedRun/seedLease（base.commitRaw 直接写 RunSnapshot@1 和 TaskLeaseSnapshot@1，属 F3），报成 BLOCKED。理由写的是“outcome_unknown 只能由 Kernel store 损坏产生，属 tamper-only”，这个证据不对。刷新行要求“其余分支用共享真实 Runtime……转换”，没有把 guard 2 留作 BLOCKED。
FIX: 用公开路径造出 outcome_unknown，有两种做法：(a) 用 startHeld 让 B 停在闸门，然后挪走 Kernel 文件或用 kernelStores 包装让读取失败，再走真实对账或重启；(b) 让脚本模型留下结果未定的工具调用，走 RUN-08。造出来以后删掉 seedRun/seedLease。如果确实缺入口，就把 BLOCKED 改为 missing entry point，写清缺的是哪一步（比如 S2B 夹具没有重启或对账入口），并删掉“tamper-only / 只能 Kernel 损坏”的说法，交 lead 裁定。
V: 核实属实。回复 t-reply-T1.md:95 和测试注释 A2-disposition-change.test.ts:349-354、:591 都说 outcome_unknown“只能由 Kernel 损坏产生，属 tamper-only”，这个说法不对。第一，场景 tests/scenarios/S2C-K-unknown-outcome.test.ts:45-50 的 2C-22 (1) 用 moveKernelAside（tests/helpers/A2-restart-fixture.ts:213-219，真实文件挪走，属规则表 v1 A1 认可的形状）加崩溃重启，就得到 outcome_unknown，由 tests/helpers/S2C-K-scenario-support.ts:181-183 断言，这条路径不用 damageKernel。第二，生产代码有正常路径：RUN-08（src/core/work-graph/state/run-machine.ts:1789-1815）和 RUN-20 (ii) missing/damaged（:2317-2324）。另有 tests/runtime/S2B-38-run08-unknown-activity.test.ts:1-4、:146 用真实 Kernel 排空超时走公开步骤得到 outcome_unknow

## T1a-02 未完成 | T3-106 | tests/work-graph/A2-disposition-change.test.ts:379-396, 676-701
P: guard 9 竞态行还在用 seedRun/seedLease/humanStop。humanStop 在 commit 包装里用 base.commitRaw 手写 ControlIntent 和 RunSnapshot@2，属 F3。这一行报成 BLOCKED，理由是“公开 submitControl 拒绝已结束 Run，只能手写”。可是这个竞态并不需要一个已经结束的 Run，所以这个理由不成立。
FIX: 改成先 startHeld('B') 让 B 停在闸门，再提议平行载体；在 A3 的 racing commit 包装里，碰到 plan-apply 时用 steps.controls.submitControl 发一次真实的人工 cancel，Run 版本前进，指针请求者变成 human。断言不变：revision_conflict、raced、activePlan 不变；重读后得到 forbidden。然后删掉 seedRun/seedLease/humanStop 和它们在接口里的声明（:161-166、:423）。如果实跑发现 running 的 B 会被别的守卫先拦住，就改报 BLOCKED，写出那个守卫的 file:line，并注明是 unreachable 还是 missing entry point。这一点只是读源码推出来的，没有实跑。
V: 核实属实（只读了源码，没有实跑）。回复 t-reply-T1.md:96 的理由是 submitControl 拒绝已结束的 Run，这条规则本身没错（control-intent-machine.ts:474-478 只拒 'ended' 类）。但 Entering/Running 归 'entered'（:432-434），可以提交 cancel 并排队。守卫 9 只看选中 Run 和指针意图的请求者（plan-machine.ts:766-786 → task-failure.ts:137-144）。请求者是 human 就得 human_only，不要求 Run 已结束。规格 STATE-MACHINES-SPEC.md:736 写的竞态是“守卫 9 读取之后、提交之前，人工取消 O 的最后一个未围栏载体 → revision_conflict，重读后 forbidden”，:608 也写“并发的人工暂停/取消……让采用 revision_conflict”，两处都没要求已结束的 Run。夹具已有 startHeld（A2-disposition-change.test.ts:266-272）和真实的 steps.controls.submitControl（S2B-runtime-steps-fixture.ts:395-405），所以这个状态可以用公开步骤造出来。现在这

## T1a-03 违规 | T1-020 | tests/work-graph/K3-16-second-unfinished-proposal.test.ts:107-116
P: 合并时没有照条目迁入源第 132 行的 round:1，而是自行改成 round: 2，并加注释说明。源第 131 行“只有一轮”的断言（after.rounds toHaveLength(1)）也没有迁入，只换成了一个按 stateEntry/phase/result 过滤后的计数。条目和刷新都写“迁入源 132 的 round:1 轮号断言”“仍按上面做”。总书 §1“条目和代码对不上时不要即兴处理，报 BLOCKED”，§2.3“合并会丢掉条目没说丢的断言时，报 BLOCKED”。这条却报成 done，源文件也已删除。
FIX: 恢复源文件 K3-16-proposal-round-fixture.test.ts 里的首轮用例，或者把目标改回条目要求的断言，二选一；然后把 T1-020 改报 BLOCKED，证据写目标路径会先记一轮 review，所以提案轮号是 2，由 lead 决定接受 round 2 还是保留源用例。不要自己改期望值。
V: 核实属实。条目 t-items-T1.md:132 要求“迁入源 132 的 round:1 轮号断言”，刷新 :136 写“仍按上面做”。目标 K3-16-second-unfinished-proposal.test.ts:111-116 却把期望值改成 round: 2，并加了注释。原因确实是生产代码按 rounds.length+1 编号（claim-service.ts:216、:295），目标路径先记了一轮 review。但这说明条目和今天的代码对不上。总书 §1 要求这种情况报 BLOCKED、不即兴处理；§2.2 规定只有条目写明才能改断言的期望值；§2.3 写的是合并做不到时报 BLOCKED。回复 t-reply-T1.md:23 却报 done，:193 自己也承认“若坚持源字面量 1，该合并无法成立”，源文件里这两例已经删掉（当前 K3-16-proposal-round-fixture.test.ts 只剩 :73、:122、:172、:202 四组）。要更正一处：源 :131 的 after.rounds toHaveLength(1)，条目 :133 的核实理由已认定由目标 base :108-110 的过滤计数覆盖，这一部分不算违规。问题只在把轮号从 1 改成 2 并报 done。

## T1a-04 违规 | T1-068 | tests/work-graph/goal-independent.test.ts:63-65
P: createGoal 结果里的期望 workspaceRef 直接用了程序输出 workspace.value.ref（registerWorkspace 的返回值），不是手写字面量。rule sheet F8 和总书 §2.4 都要求期望值来自规格或手算，不能抄程序自己的输出。
FIX: 改成字面量 `workspaceRef: { aggregateType: 'Workspace', projectId, workspaceId }`，并加注释说明来源：用的是 registerWorkspace 的输入。pins 里的 ref/revision 是平台签发的值，取自公开返回值，这样用没有问题，不需要改。
V: 核实属实。base 的 goal-independent.test.ts:53 期望值是测试自己写的字面量 workspace.ref，即 { aggregateType:'Workspace', projectId, workspaceId }（base :17）。现在 :65 改成 workspace.value.ref，也就是 :50 registerWorkspace 的返回值，属于程序自己的输出。Workspace ref 由输入 id 决定，不在 v2 A1“平台签发值”的列表里（列表见 t-book.md:76-78）。这样改违反 F8（test-rule-sheet-v1.md:78-79）和总书 :83-85。条目 T1-068（t-items-T1.md:492-493）要求保留原断言和期望值，没有写明改这里。同一处的 Goal ref 仍用字面量（:64），写法不一致。影响不大，但确实违规。

## T1a-05 不整洁 | T3-096 | tests/helpers/W2-whiteboard-fixture.ts:46, 70-72
P: 删掉 seedAgentCandidate 后，私有函数 agentActorIdFor 已经没有调用方，成了死代码；它也是 sha256Hex 导入的唯一使用处。
FIX: 删掉 :70-72 的 agentActorIdFor，再从 :46 的导入里去掉 sha256Hex。
V: 事实属实。base 里 agentActorIdFor 唯一的调用在 seedAgentCandidate（base W2-whiteboard-fixture.ts:349）。T3-096 删掉 seedAgentCandidate 之后，当前文件里只剩 :70-72 的定义；sha256Hex 只在 :46 导入、:71 使用。tsconfig 没开 noUnusedLocals，所以 typecheck 不报错。需要说明：总书 §2.1 只允许改条目点名的行和 helper，T3-095（t-items-T1.md:591）只要求去掉它的 export，没有要求删除。所以实施者留下它不算越权，只是留了死代码，需要 lead 另立条目或在合并时顺手清理。

## T1b-01 违规 | T1-003 | tests/work-graph/A2-control-service.test.ts:329-333
P: Goal 已取消时 resume 被拒的那段，丢了“零提交”断言。原测试对 paused 和 cancelled 两种状态都用 countingCommits 断言 0 次提交；现在只有 paused 段（:288-294）还有。另外，cancelled 现在只在已进入的 Run 上测，原来测的是未进入的 Run。
FIX: 用 countingCommits（A3）包住 cancelled 段的 enteredControls.records，对这次 resume 拒绝断言 commits()===0。“未进入 Run + cancelled”这一组合要么另外补回，要么报 lead。
V: 已核实。base A2-control-service.test.ts:332-342 在 for(['paused','cancelled']) 循环里对两种状态都写了 expect(counted.commits()).toBe(0)（:340）。现在只有 paused 段保留了这条（:285-294）；cancelled 段（:330-335）直接用 enteredControls 提交 resume，没有计数包装，零提交断言没了。T1-003 的动作、书面核对改正和刷新（t-items-T1.md:18-24）都只说“保留拒绝及公开读不变”，没有放弃零提交断言。按 book §2.4“Keep the test's assertions”和 F12，这是未经授权的放松。ledger-T1.txt:52 只记了 :336，:340 没记。cancelled 只在已进入的 Run 上测，这一点和事实相符（base 没调用过 enter，测的是未进入的 Run）。但动作要求 paused 和 cancelled 用独立 fixture，刷新又要求 entered 分支走真实 Runtime，所以这个组合改动可以算条目允许的范围；主要问题是零提交断言丢了。

## T1b-02 违规 | T1-013 | tests/work-graph/B2-execution-result.test.ts:94-95
P: 历史位置的期望值从字面量改成了程序输出（F8）。新期望里，startPosition 来自 entered 后的读取，observedThroughPosition 和 endPosition 来自 Runtime 实际提交的请求，等于拿存进去的值和自己比。位置算错时测试看不出来。条目要求保留原断言。
FIX: 按脚本模型的固定回复手算三个位置，写成字面量并在注释里写出推算过程。如果真实路径的位置和原值 2/4/4 不同，报 lead 裁定，不要改成取程序输出。
V: 已核实。base B2-execution-result.test.ts:49 是字面量 { startPosition: 2, observedThroughPosition: 4, endPosition: 4 }。现在 :94-95 的期望值分别取自 startedHistory.startPosition（entered 后读到的 Run 自身值）和 Runtime 提交请求里的 history.observedThroughPosition / endPosition，等于拿存进去的值和自己比，位置算错时测试看不出来。T1-013 的书面核对改正和刷新（t-items-T1.md:103-104）只授权“重放使用 Runtime 实际提交的原请求”，没有授权改历史位置的期望值。book §2.4 规定期望值必须是字面量并写出推算过程，不得取程序输出（F8）；回复（t-reply-T1.md:19）也没提这处改动。

## T1b-03 违规 | T1-029 | tests/work-graph/R4b-session-boundaries.test.ts:135-137
P: 按书面核对改正，测试改用 createSession，但“B 重放 A 的登记回执”这半段从此空测（F11）。新调用 createSession(inB, …)，请求里的 workspace 是 A，在调用范围检查一开始就被拒，根本走不到回执查找。即使把回执的作用域检查删掉，这一行照样通过，测试名里的 registration receipt 已不再被检查。
FIX: 保留 getSessionOperation(inB) 返回 not_found 的断言。回执重放这段单列 BLOCKED，类别是缺入口：没有公开步骤能让 B 重放 A 的登记回执。不要用一个更早触发的拒绝来顶替，本条不报 done。
V: 已核实，而且问题比原报告更重。被改的是 base :74-93 的 'does not disclose a workspace A operation or registration receipt to workspace B'。T1-029 的范围是 :194-219;238-258（t-items-T1.md:174）。书面核对改正（:180）和 t-bk-T1.out.md:25 引用 :83/:87，只是拿它当同文件里被禁止的写法示例（“现有同文件示例不能证明该测试形式获准”），并没有把这条测试划进 T1-029。T1-030 管的是 :113-148，也不覆盖它，所以这一处改动没有任何条目授权（book §2.1“不要把改动延伸到条目保留的兄弟测试”）。改动后，:135 的 createSession(inB, sessionCreation(...)) 请求里 workspace 是 A，在 session-operations.ts:578-579 的调用范围检查就被拒成 forbidden，走不到登记回执；即使删掉 recordSessionCreated 的作用域检查，这一行也照样通过（F11）。测试名里的 registration receipt 已经不再被检查。处理办法：恢复 base，或报 BLOCKED（unreachable，拒绝点在 session

## T1b-04 违规 | T1-040 | tests/work-graph/S2C-node-detail-anomalies.test.ts:86-91,120-123,151-153
P: 刷新要求沿真实路径产生锚点（暂停、Host 接管、归档、在另一 Session 接续），实现仍走书面核对点名驳回的手写 Runtime/Host 事实 helper（F3），回复却标 done。具体：进入事实手写；暂停观察手写；host_instance_takeover 由测试发出；archive 的 files 观察和 subjectKey 由测试自造并经 recordSessionAnomaly 写入；Session 由测试写 Kernel store 再 recordSessionCreated。
FIX: 按刷新改走真实 Host/Runtime 路径：真实暂停、重启接管、sessions/archive-line 归档、requeue 后由另一 Session 接续。101 个锚点同样由真实归档产生，只在第二页注入失败。做不到就把该项标 BLOCKED 并写明缺哪个入口，不报 done。
V: 已核实。现在的 S2C-node-detail-anomalies.test.ts:86-91、:120-123、:151-153 用的仍是书面核对点名驳回的 helper（t-items-T1.md:274；t-bk-T1.out.md:30）：S2C-L-runs-support.ts:160-163 由测试自建 kernelSource 和 history 位置，调用 recordExecutionEntered；:211-219 自建 paused observation，调用 recordControlObservation；:246-249 以 host_instance_takeover 提交测试自造的 interrupted_clean 结果；S2C-D-node-support.ts:392-395 自造 ArchiveStepRefV1（subjectKey 用 canonicalJson 自算）和 files 观察，直接调用 recordSessionAnomaly（core-routes.ts:307 写明该方法不对 HTTP 开放，生产里只有 session-archive.ts:490 调用）；:300-305 先写 Kernel store 再 recordSessionCreated。这些都属于 F3。刷新（t-items-T1.md:276）要求走

## T1b-05 会出错 | T1-054 | tests/work-graph/S4C2-goal-triggers.test.ts:77,294-297,496-503
P: 改写后时间戳无法区分，读者用错时间也会通过。3a 设了 P1_AT = AT，plan 触发的 at 和 task_end 的 reducedAt 是同一时刻。3d 所有 at 都等于 reworkAt（固定时钟），plan 的 key 和 at 又直接取自 graph 读结果（程序输出，F8）。原测试用了互不相同的时间。
FIX: 3a 让 P1 用一个早于 AT 的另一个字面时间采用（setupPlans 的 adopt 本来就接受 at 参数），这样仍是先有计划后有完成的顺序。3d 通过平台时钟选项让 archive、rework、plan 三个时刻互不相同，期望写成字面量 key/at 并注明推算。做不到就把这几个子例标 BLOCKED。
V: 已核实。base :36-40 的 PLAN_AT、REDUCED_AT、REWORK_AT、ARCHIVE_AT 互不相同。现在 :77 是 P1_AT = AT，3a 的 :294-297 中 plan 和 task_end 的 at 都是 AT（:290 的 reducedAt 也是 AT），读者如果把 plan.acceptedAt 当成 reducedAt 用，测试照样通过。setupPlans 的 adopt 接受 at 参数（:217-219），完全可以用一个早于 AT 的字面时间，因果顺序仍然成立。3d 的 :500 archive 和 :502 rework 都等于 reworkAt；:501 的 plan key 和 at 取自 graph.value.plan（程序输出，F8），在固定时钟下也等于同一时刻。三个时间分不开，时间归属错了测试发现不了。WP2-platform-support.ts:121 和 :207 有可选的递增时钟，所以并非只能用同一时刻。

## T1b-06 违规 | T1-054 | tests/work-graph/S4C2-goal-triggers.test.ts:60-71,343
P: 用 vi.mock 包 SQLite 后端工厂，目的是截下平台内部的 records 端口，再直接拿去调用 readGoalTriggerRecords。这超出了 A4“只为共享同一后端，别无他用”的范围。
FIX: 交 lead 裁定。可改为经组合体已公开的读口取触发结果，或经平台已暴露的 records；否则这一用法单列 BLOCKED，不报 done。
V: 事实已核实：S4C2-goal-triggers.test.ts:64-72 用 vi.mock 包了 createSqliteRecordBackend，截下组合体内部 backend 的 records；:343 取出后，在 :493 直接交给 readGoalTriggerRecords。规则表 v1 A4（test-rule-sheet-v1.md 的 A4 条）只允许包工厂“让平台共享测试世界的那一个真实后端……and nothing else”，接受的示例方向也是平台用测试的后端。这里方向相反：WP2 sqlite 先 closeBackend（WP2-platform-support.ts:783），测试世界没有自己的后端，是测试反过来取平台的内部端口直接读。规则表 deny-by-default，这种形式没有列出；实现者在 :61-63 的注释里自行把它归为 A4，违反了“不自评为允许”（v1“Nobody grades their own work”）。是否放行由 lead 裁定，在裁定之前不能报 done。

## T1b-08 违规 | T1-020 | tests/work-graph/K3-16-second-unfinished-proposal.test.ts:111-116
P: 合并时改动了期望值：条目要求迁入源测试的 round:1，目标里写成了 round:2。源路径不先跑核对轮，直接到 awaiting_proposal；目标路径先记一轮 review，所以两者不重复。按 book，合并会丢断言时应报 BLOCKED，不应自改字面量后报 done。
FIX: T1-020 改报 BLOCKED，等 lead 裁定。可选做法：保留源测试（它覆盖的是不同路径），或由 lead 明确同意把 round 断言改为 2。
V: 已核实。t-items-T1.md:132 明确要求“迁入源 132 的 round:1 轮号断言”。源测试 base K3-16-proposal-round-fixture.test.ts:121-135 走 reachK3AwaitingProposal（K3-proposal-round.ts:898-933，不跑核对轮，直接 settle review_unavailable），断言 rounds 长度为 1、rounds[0] 是 round:1。目标路径先跑一轮 review，现在 :114-116 断言 round: 2，期望字面量被自行改了，“无核对轮时首个提案轮号为 1”这一断言也丢了。book §2.3 规定：合并会丢掉条目没有放弃的断言时报 BLOCKED。回复 §5.2（t-reply-T1.md:193）承认 round:1 不成立，表里（:23）却仍报 done。

## T1b-09 违规 | T1-037 | tests/work-graph/S2C-lines-tiers.test.ts:155
P: 合并后，目标测试名没有带上源测试的规格行号“2C-12 (9)”。断言本身已全部迁入（own==='standby' 在 :171）。
FIX: 把目标测试名改成同时含 2C-03 (3) 和 2C-12 (9)。目标文件不在 T1b 的文件清单里，由负责该文件的部分改。
V: 已核实。源测试名 base S2C-lines-attention.test.ts:216 是 '2C-12 (9) an INCONCLUSIVE formal check is the blocked round_inconclusive attention'，已删除。目标 S2C-lines-tiers.test.ts:155 的名字仍只有 '2C-03 (3) ...'，没有 2C-12 (9)。book §2.3 规定源有规格行号时目标测试名要保留。断言本身已完整迁入（:170-174 含 own==='standby'），所以只是命名问题，但违反了 book 的明文规定。目标文件在 T1a 的文件清单里（T1a-files.txt:38），由 T1a 修改。

## T1b-10 不整洁 | T1-055 | tests/work-graph/S4C2-project-set-shared.test.ts:162
P: 参数化之后，includeInputs:false 那一行实际测的是 query material，测试名却仍叫 work material，名字和断言对不上。
FIX: 按 includeInputs 把测试名里的 work/query 写对，比如用参数把 work material 或 query material 填进名字。
V: 已核实。S4C2-project-set-shared.test.ts:29 的注释写明 work 对应 includeInputs:true，query 对应 false；:162 的测试名固定为 'the Goal-card work material reads ... (includeInputs: %s)'，includeInputs 为 false 的那一行实际测的是 query material，名字和内容不符。断言和计数没有变化，属于命名小问题。

## T1b-11 不整洁 | T1-015 | .lead-ref/replies/t-reply-T1.md:21
P: 回复说 T1-015 删掉了 C1 的 :461-463，但这段（真实 SQLite 正文损坏）其实还在。没有条目授权删它，留着是对的；错的是回复的描述。
FIX: 把回复表中 T1-015 的“及 :461-463”删去，并核对 ledger 映射没有因此出错。
V: 已核实。t-reply-T1.md:21 说 T1-015 删了“Lease 接续篡改例及 :461-463”。但 3a9f6d94 上的 :461-463 是 SQLite 正文损坏例（DatabaseSync、UPDATE artifacts、断言 unavailable），现在仍完整保留在 C1-session-mailbox.test.ts:443-451。T1-015 的动作（t-items-T1.md:115）只删 :355-365，T1b.diff 也只删了那段，所以代码没错，错的是回复的描述。

## T2a-01 违规 | T3-033 | tests/business/K3-review-workflow-rows.test.ts:754-757, 728-751, 886, 895
P: 转换后的 settle_review 行不是走真实公开步骤进入 Workflow。第 895 行用 performRun('start') 推进，这个 perform 请求只有 meta，靠 `as unknown as WorkflowOperation` 强转成操作（:756）。服务它的 savedRunRuntime（:728-751）里，startRun/observeRun 完全不看请求，直接返回保存的 Run 读数（:747-748）。规则表 v2 A1 写明：类型强转不能让一个值成为合法的公开输入，忽略请求的替身也不行，A1 也不豁免 F4。所以这条转换仍然违规，回复里却记为 done。
FIX: 核对 Run 结束以后，从真实的 select_work 推进开始，取 Workflow 真实规划出的 settle_review 再 perform（同组 K3-15 那条真实链可以参照）。Runtime 用真实的或 A3 委托包装，不用忽略请求的 savedRunRuntime，也不用强转的 start 请求。如果公开步骤到不了这里，就把这条子例标 BLOCKED 交 lead，不能记 done。
V: 我在引用的行逐条核对过，事实都对。K3-review-workflow-rows.test.ts:886 用 savedRunRuntime 替换了 Runtime。:747-748 的 startRun/observeRun 只读保存的 Run，不看请求。:754-757 的 performRun 只带 meta，靠 `as unknown as WorkflowOperation` 强转成 start 操作。:895 用它让 Workflow 规划出 settle_review。规则表 v2 :30-31 写明，类型强转不能让值成为合法的公开输入，忽略请求的替身也不行。书 §2 第 4 条还规定，违反规则表的保留测试不能记 done，回复 :61 却记了 done。

可以减轻的一点：条目 T3-033 的核实理由（t-items-T2.md:457）把同文件 K3 A 行当作“已走真实 claim、end、settle_review”的先例，而 K3 A 用的正是这套替身；这套替身在 w2-base 里也已存在（base:784-812）。但条目动作只要求“经 Workflow perform 真实 settle_review”，没有点名强转的 start 请求。真实路径今天也有：workflow.ts:1418 的 UR4 在 select_work 时对已知结束的核对轮规

## T2a-02 违规 | T3-033 | tests/business/K3-review-workflow-rows.test.ts:911-971
P: 书面核对改正要求从固定输入和确定的调用序列独立列出完整的 expectedOwnerResult，再分别和 owner 结果、receipt.result 比较。现在的 expectedValue 大约 20 个字段直接抄自 `before.*`，也就是程序自己先前的读数（ref、schemaVersion、workspaceId、task、runRef、sessionRef、origin、inventory、各 item 字段、stateEntry、createdAt 等），revision 写成 `before.revision + 1`。这属于 F8“期望值抄自程序输出”。另外两处比较都用 toMatchObject（:967、:971）：结果里多出的字段不会失败，没有达到“完整、逐字段”的要求，不符合测试名里的 field for field。
FIX: 由固定输入和手算写出字面量期望，在注释里写明推算过程：ids、alias 1、callId、toolName、workspace、时间戳和 revision 都写成具体值。owner 结果和 receipt.result 都用 toEqual 比较整个对象。只有平台签发的 cursor 可以从真实返回里取，原样使用；:973 的 receipt toEqual 保留。
V: 核实属实：:911-956 的 expectedValue 里约 20 个字段直接取 `before.*`，revision 写成 `before.revision + 1`；:967 和 :971 用 toMatchObject。书面核对改正（t-items-T2.md:460）要求从固定输入和确定的调用序列独立列出完整期望；书 t-book.md:84-85 禁止用程序输出算期望。lead 在同类条目 T1-069 采纳的改正（t-items-T1.md:506）也写明：期望按公开请求、固定时钟和步骤手算，只有动态身份引用公开返回值，不复制整个快照。

需要收窄两处：
- 平台签发的值可以继续取自公开读数，不能改成测试自写的字面量，否则违反 v2 A1（:32-35）和书 :78-80。这类值包括 ref、runRef、sessionRef、task、kernel、argumentsDigest、origin 里的 proof/hostInstanceId，以及 workspace 捕获里的摘要。原 fix 把 ids 和 workspace 也列为要写字面量，这部分不对。
- 其余字段应写成手算字面量：schemaVersion、revision、inventory、inventoryProblem、alias、toolName、contained、summary、start

## T2a-03 违规 | T2-038 | tests/runtime/S4C-note-tools.test.ts:133-141, 158-166, 199-200, 207-208, 214, 219
P: RW-14 合并进 GTN02/03/06 时把严格比较放松了，这是 F12 那类削弱。被删的 RW-14 用 toStrictEqual 比较整个请求，会查出请求多出来的顶层键，也会核对值为 undefined 的键在不在：convention 写入要有 `body: undefined`，无 resolution 的 review 不能带 resolution 键。现在 GTN02/GTN03 只用 toBe 逐个查 commandId、goalId、expectedPointerRevision，note 用 toEqual；GTN06 用 toEqual。整请求的额外键不再检查，undefined 键是否存在也不再检查（:141 的 toBeUndefined 不区分键缺失和值为 undefined）。书面核对改正要求“迁入严格形状”，回复却写“严格 toEqual，默认值全迁”，toEqual 并不严格。
FIX: GTN02、GTN03 对 `writes[0]!.input` 整体用 toStrictEqual，带上 commandId、expectedPointerRevision、goalId 和 note，convention 写入的 note 里保留 `body: undefined`。GTN06 对 `reviews[0/1]!.input`、`withdraws[0/1]!.input` 也改用 toStrictEqual，保证不带 resolution 的 review 没有 resolution 键。
V: 核实属实。被删的 RW-14（T2a.diff 中 S4C 段，ledger-T2.txt:62-68）对整个请求用 toStrictEqual。现在 GTN02/03 只用 toBe 分别查 commandId、goalId 和 expectedPointerRevision（:134-136、:162-164），note 用 toEqual（:137、:165）；GTN06 用 toEqual（:199、:207、:214、:219）。toEqual 会忽略值为 undefined 的键，也不检查请求顶层多出的键。

具体丢了一项被测行为：生产代码 note-contracts.ts:181 特意写成 `...(args.resolution === undefined ? {} : { resolution })`，不带 resolution 时就没有这个键。RW-14 :301 的 toStrictEqual 钉住了这一点；如果改回 `resolution: args.resolution`，GTN06 :207 仍然会过。convention 写入时 `body: undefined` 这个键在不在，也不再检查：:140 写的 `body: undefined` 在 toEqual 下不起作用，:141 的 toBeUndefined 也分不出键缺失和值为 undefin

## T2a-04 未完成 | T1-067 | tests/work-graph/WP2-context-extensions.test.ts:269
P: T1-067 的刷新以它为准，要求“复用公开 scope/Goal，补真实 Session 和 entered Run”，还注明剩余的 Session 和 entered 仍然手造。F07 现在只补了 100 次真实 propose，前置仍从 openS5DecisionFixture('memory') 起步。这个 fixture 里 Session 还是手工登记：测试自己在 Kernel store 里建会话，再代 Runtime 调 recordSessionCreated。entered Run 也还是手造：测试自选 Kernel runId/turnId 和 position 2/3，直接调 Runtime 才该调的 recordExecutionEntered，属于 F3，也违反“Kernel 身份和位置由平台签发”。T2b 对 S5-decision-fixture.ts 的改动没有动这两段。回复把 T1-067 记成 done，只提了 propose 循环，属于虚报完成。
FIX: S5-decision-fixture.ts 在同组 T2b 的白名单里。可以在那里把 Session 创建和 RA 的 entered 改走共享真实 Runtime（tests/helpers/S2B-runtime-steps-fixture.ts：真实 prepare，脚本模型 start，A3 闸门）；也可以给 F07 换一个只由真实 Runtime 建前置的入口。做不到就把 T1-067 改记 partial 或 BLOCKED，写明缺口（fixture 的 enterClaim 和 createS5Session 仍手造），不要记 done。
V: 核实属实。T1-067 的刷新行（t-items-T2.md:84，以它为准）要求“补真实 Session 和 entered Run”，并注明剩余的 Session 和 entered 仍是手造。它指的位置在 w2-base 里正是 S5-decision-fixture.ts:598 的 createS5Session 和 :840 的 enterClaim，我对照 base 文件确认过。

现在 WP2-context-extensions.test.ts:269 仍从 openS5DecisionFixture('memory') 起步，夹具里这两段没改：
- :620-626 由测试自建 Kernel 会话，再代 Runtime 调 recordSessionCreated；
- :859-860 由测试自选 Kernel runId/turnId，:868-871 自选位置 2/3 并直接调 recordExecutionEntered；
- :910 对 claimRA 调用 enterClaim。

这些属于 F3，也违反“Kernel 身份和位置由平台签发”。base 与当前 S5-decision-fixture.ts 的 diff 只有 RUN_ACTIVITY 注册和 lookupOrdered 转发。这个文件在本组（T2b）的改动范围内，可以改。回复 :1

## T2b-01 违规 | T1-061 | tests/work-graph/UCR-settle-review.test.ts:160,184,209,237,295
P: 转换后的用例新加了 5 处 120_000 毫秒超时。没有任何条目授权，书里明确禁止调高超时，回复也没有报告。
FIX: 删掉这 5 处 120_000。真实链在 30 秒内跑不完的用例标 BLOCKED，附上实测耗时交 lead 裁定，不要自己加长超时。
V: 已核实。当前 tests/work-graph/UCR-settle-review.test.ts:160、:184、:209、:237、:295 五处都是 `}, 120_000);`。基线 .lead-ref/base/tests/work-graph/UCR-settle-review.test.ts 里 grep 不到 timeout/120_000，对应用例（基线 :182、:194、:218、:228、:245、:264、:335）都用默认值，即 vitest.config.ts:9 的 testTimeout: 30_000。t-book.md:115 写明 no raised timeouts，test-rule-sheet-v1.md:87-89（F12）把调高超时算作弱化，只有冻结的发现表点名时才允许。T1-061 条目、书面改正和刷新（t-items-T2.md:68-76）都没提超时。回复 t-reply-T2.md:17 只写了 done，也没报告。ledger-T2.txt:5-8 只列出 :209、:237、:295 三处，:160（UCR-06）和 :184（UCR-08b）在基线同样没有超时，也是新加的。

## T2b-02 会出错 | T1-070 | tests/work-graph/unknown-call-review-list.test.ts:166-217
P: 条目要求保留 Goal 过滤，并用另一个 Goal 的任务造第二个 Goal 的记录。转换后所有记录都落在 GOAL_B，基线里另一个 Goal 的种子和对它的断言被删掉了。现在过滤器去掉 goalRef 条件、或者按 workspace 列表时漏掉别的 Goal，测试照样通过。回复把这一子例写成 BLOCKED，可原断言没有留下。
FIX: lead 裁定前，保留原用例里第二个 Goal 的部分（种子和 :91/:125 两处断言），条目继续标 BLOCKED。裁定放宽 K3-35-runtime.ts:113 的授权后，用第二个真实 Goal 的任务补回两条断言：按 Goal 过滤会排除别的 Goal，workspace+open 列表跨 Goal。
V: 已核实，改判为覆盖丢失（同时也违反书里 BLOCKED 要原样保留的规定）。基线 base/tests/work-graph/unknown-call-review-list.test.ts:88 和 :118 种了 list-goal-b/run-b1。:91-95 按 goalA 过滤时数组只有两项，toMatchObject 对数组要求长度一致，所以等于断言 Goal B 被排除；:122-126 要求 workspace+open 列表里有 `{goalId:'list-goal-b', runId:'run-b1'}`。当前 :166-196 和 :198-217 的记录全落在 GOAL_B，过滤条件也是 GOAL_B，跨 Goal 的排除和合并都没有断言了。全 tests/ 再没有别处断言 listReviews 跨 Goal 的行为：K3-15-list-by-task 和 B2-01-task-read 都没有第二个 Goal。条目 t-items-T2.md:88 要求保留 Goal/status 过滤和 open 过滤的断言，:87 要求第二个 Goal 的记录用另一 Goal 的任务造。回复 t-reply-T2.md:19、:77 把这个子例标成 BLOCKED，理由属实（tests/helpers/K3-35-runtime.ts:113 只授权 GOAL

## T2b-03 未完成 | T1-023 | tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:192
P: 刷新要求只补真实的 Session 和 Run，但造接近预算的 pending_review 时，Session 仍由 createS5Session 生成。这个函数直接写 kernel 存储，还替 Host 调了 recordSessionCreated，属于 F3。回复却把 T1-023 标为 done。
FIX: 改用公开的 Session 创建步骤生成 Session，和 T1-067 的刷新要求一致。做不到就在回复里把 T1-023 改成 partial 或 BLOCKED，写明缺哪一步公开路径。
V: 已核实。当前 tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:192 仍用 `world.fixture.createS5Session(...)` 生成 Session。这个函数在 tests/helpers/S5-decision-fixture.ts:615-627：admit 之后，:621 用测试自选的 kernelSessionId 直接 `kernelStores.withStore(...store.create(...))` 写 Kernel 存储，:623 再替 Runtime 调 `recordSessionCreated`。按 test-rule-sheet-v1.md F3（打开存储写入、以 Runtime/Host 身份写）和 t-book.md A1（Kernel identity 不能由测试选定）都不允许。T1-023 的刷新（t-items-T2.md:66）要求“只补真实 Session/Run”，点名的未完成位置正是 base S5-decision-fixture.ts:598（createS5Session）和 :840。T1-067 的刷新（:84）也写明“剩余 Session/entered 仍手造”。T2b.diff:4913-4914 只把

## T2b-04 违规 | T1-018 | tests/work-graph/K3-14-unknown-call-review-tool.test.ts:78-88
P: 基线写死的 revision 3/4 被改成从程序输出推出来的 `start + 1` / `start + 2`，注释还特意说“never hard-coded”。期望值本身来自被测链的返回值，没有写成字面量和手算过程。如果认领后的 revision 出错，这条断言也查不出来。
FIX: 按真实链手数 revision（create、round_claimed 等每次提交各加 1），把 `start` 先断言成手算的字面量，再写 start+1、start+2 对应的字面量，并在注释里写出推算过程。作为请求参数的 expected revision 可以继续用公开读回的值。
V: 已核实。当前 tests/work-graph/K3-14-unknown-call-review-tool.test.ts:78-80 的注释写“computed from that public read, never hard-coded”，:80 `const start = fx.round.record.revision;`，:83/:86/:88 的期望值是 `start + 1`、`start + 2`、`start + 2`。基线 base/…/K3-14-unknown-call-review-tool.test.ts:185/:188/:190 是字面量 3/4/4。条目 t-items-T2.md:35 要求“写死的 revision 3/4 要按真实记录重算”，意思是对真实链重新手算字面量，没有授权改用程序输出做相对期望。t-book.md:83-85 规定期望值写字面量并在注释里写出推算过程，不得用程序自己的输出计算，test-rule-sheet-v1.md F8 也禁止从程序输出抄期望值。:86 把 start+1 作为请求的 expected revision 是可以的，但 :83/:88 断言里的期望值不行。

## T2b-05 未完成 | T3-103 | tests/helpers/K3-review-card-fixture.ts:58,336
P: 回复说这个文件不在 T2 白名单，所以 stub 只能保留。可 T2 这一段改了这个文件（加了 mailbox、interceptDispositionCommits 等），它在 T2 的改动范围里，这里的 createExecutedFilesStub 应该一起换成真 reader。
FIX: 在本文件里接 createGoalExecutedFilesReader，注册 RUN_ACTIVITY_RECORD_SCHEMAS 并转发真实的 lookupOrdered，删掉 :58/:336 的 stub。同时更正回复 §2 里 T3-103 的说法，剩下的调用方只有 tests/app/S5-decision-routes.test.ts:223 和 tests/helpers/S2A-window-fixture.ts:48。
V: 已核实。当前 tests/helpers/K3-review-card-fixture.ts:58 仍 import createExecutedFilesStub，:336 仍传 `executedFiles: createExecutedFilesStub()`。T2 这一段改了这个文件（T2b.diff:759 起：加 mailbox、interceptDispositionCommits、adoptReorderedPlan 等），而且 T2 第二波的白名单 D:\cc-lead-notes\impl\t\books\t-run-T2.w2.md:20 明确列了 tests/helpers/K3-review-card-fixture.ts，同一行还列了 tests/helpers/S2A-window-fixture.ts 和 tests/helpers/executed-files-stub.ts。回复 t-reply-T2.md:79 说这几个调用方“不在 T2 白名单”，就 K3-review-card-fixture.ts:335 和 S2A-window-fixture.ts:48 而言是错的。T3-103 的书面改正（t-items-T2.md:540）要求只用真实 reader，全部调用方接好后再删 stub。更正原发现的一处：S2A-window-fixt

## T2b-06 不整洁 | T1-016 | tests/work-graph/K3-11-review-reasons.test.ts:22
P: 文件头注释引用的覆盖行号过时了。
FIX: 改成 :272-376。
V: 已核实。tests/work-graph/K3-11-review-reasons.test.ts:22 的注释是本段新加的（T2b.diff:3823），引用 `K3-11-review-reasons-r2.test.ts:299-400`，这是基线的行号（base 里 :299 是该 describe，文件 411 行）。当前 r2 文件只有 387 行，second_consecutive 的 describe 在 :272，:376 断言 ['second_consecutive']，用例到 :386 结束。引用已经过时。

## T2b-07 不整洁 | T1-017/T1-018 | tests/work-graph/K3-14-unknown-call-review-tool.test.ts:52-57
P: ready() 先打开世界，等整条链都成功后，调用方才把它推进 fixtures。中间任何一步抛错，世界就不会关闭，sqlite 句柄和临时目录会泄漏到后面的用例。
FIX: world 一打开就登记清理（例如在 ready 里 try/catch，出错先 close 再抛），或者先把 world 推进清理列表。
V: 事实属实，只是小问题。当前 tests/work-graph/K3-14-unknown-call-review-tool.test.ts:52-57 的 ready() 在 :53 打开世界，:54-55 跑真实链，fixtures.push 由调用方在 :77、:101、:175、:195、:208、:221 做。链上任何一步抛错，世界都不会进 afterEach（:68-71）的清理。补充：基线 fixture()（base :86-108）打开 b2 之后、:152 push 之前，也有同样的泄漏窗口，只是这次换成真实链后窗口更大。同一轮的 UCR-settle-review.test.ts:52-56 openWorld 是一打开就 push，可以照这个改。这个问题只在用例已经失败时影响资源回收，不影响断言是否正确。

## T2b-08 不整洁 | T2-046 | tests/scenarios/K3-29-recovery-round.test.ts:121-122
P: 改动留下了连续两个空行。
FIX: 删掉一个空行。
V: 已核实。tests/scenarios/K3-29-recovery-round.test.ts:120 是 `}`，:121 和 :122 都是空行，:123 是 JSDoc。这个多出来的空行是 T2 这一段加的（T2b.diff 里 `@@ -131,6 +119,7 @@` 那块的 `+` 空行，约第 2758 行）。

## T2b-09 不整洁 | T2-048 | tests/scenarios/K3-r1-seams.test.ts:5-19
P: 删掉第 3 节后，文件头的编号从 2 直接跳到 4。
FIX: 把 4 改成 3，同时检查正文里引用“Part N”的地方。
V: 已核实。T2-048 把文件头第 3 条一起删了（t-items-T2.md:346 的 B-14 裁定要求删掉“文件头 :19-45 第 3 条”），当前 tests/scenarios/K3-r1-seams.test.ts:5 是 `1.`，:15 是 `2.`，:19 是 `4. Long commands/ids`，中间缺 3。基线 :19 原本是 `3. Crash points`。:19 里的“Part 2 already covers them”指的是 K3 第 2 组的 part 2，不是文件头第 2 条，所以只需把 4 改成 3。

## T3a-01 会出错 | T3-004 | tests/app/A2-settings-automation.test.ts:114-128, 138-144
P: 合并后丢了来源用例里“启动时从文件读到的 0/false 策略，在另一项设置保存后仍写在文件里”这条断言。新加的“stored zero/false”变体只在启动时读一次，然后不做任何写入就重开一次（第二次读的是没动过的同一份文件）。之后 models/save 的保留检查（:138-141），针对的是本次会话里刚用 automation/save 存进去的 5/false，而不是启动时读入的策略。
FIX: 在 stored 变体里先调用 settings.call('models/save', saveModel)，断言 storedFile(dir).automation 仍等于 stored（0/false），然后重开，断言 pushed.at(-1).automation 等于 stored。之后再接目标原有的 automation/save 段。
V: 属实。来源 base A2-settings-automation.test.ts:95-104 的流程是：启动读出 0/false（:99），models/save（:100），断言文件里仍是 0/false（:101），重开读回（:103）。重开发生在一次重写之后。现在的 stored 变体在 :121-127 里是 open、断言、再 open、断言，中间没有任何写入。src/app/host-settings.ts 启动时只调 notify（:583），不调 persist，所以第二次 open 读的还是测试手写的那份文件，等于把第一次读取重复一遍。之后 :131-141 的保留断言针对的是本会话 automation/save 存进去的 5/false（:132）。ledger-T3.txt:8 把 :101 记为 REMOVED。全 tests/ 里同时用到 automation 和 models/save 的只有本文件和 RL-40-43，后者不测 automation 的保留。条目 T3-004 的刷新行要求“合并时保留零值和false的重开断言”，来源这条断言的意义在于重写之后重开，现在只剩字面。“0/false 策略经过一次重写仍在文件里，重开读回”这条覆盖丢了。修法按原 finding 即可。

## T3a-02 违规 | T3-065 | tests/data/S8E-A23-ignored-databases.test.ts:22-37, 73-80, 82-90
P: node_modules/pkg/compile_commands.json 这条输入和 .gitignore 里的 'node_modules/' 加在了共用的 baseEntries() 里。结果同文件里条目要求保留不变的两条兄弟测试（colcon aggregate、binary database，各跑两个后端）也换了输入。任务书 §2 第 1 条写明“Do not extend a change to a sibling test that an item keeps”。另外，这两条兄弟测试现在也依赖跳过名单规则，等于一条用例里同时有两个可能出错的原因。
FIX: node_modules 数据库和 .gitignore 那一行只在合并目标用例里通过 extra 参数（或该用例自己的条目列表）加入，baseEntries() 和两条兄弟测试的输入恢复原样。
V: 属实。当前 S8E-A23-ignored-databases.test.ts:24 把 .gitignore 改成 'build/\nnode_modules/\n'，:28 加了 node_modules/pkg/compile_commands.json，两处都在共用的 baseEntries() 里（对照 base :22-35）。同文件的 aggregate 用例（:75）和 binary 用例（:83）都调用 baseEntries([...])，输入随之改变。T3-065（t-items-T3.md:594）只要求在合并目标 'A-23 merges ignored per-package databases…' 里加这条输入。任务书 t-book.md:40-41 写明“change only the lines, tests and helpers your items name. Do not extend a change to a sibling test that an item keeps.”。两条兄弟用例的断言没变，影响不大，但字面上违反了任务书。另外，:57-60 新加的 notes 断言与 :52 的 toEqual 里已有的 notes 完全重复，属于小问题。

## T3a-03 不整洁 | T3-027 | tests/scenarios/C8-human-stop-respected.test.ts:456-462
P: 合并只带过了来源 open_checks 请求的精确字段，没有带过来源 PASS 头那一步 complete_task 请求的精确 input（taskRef、planRef、roundRef），也没带首步的 reason:null。条目写的是“A2 独有的只是精确请求字段，合并时可带过去”。真实 Host 流程里 complete_task 提交成功、Task 变为 satisfied，行为上大体覆盖了，但来源断言没有搬全。
FIX: 从 open_checks 回执里公开读出 roundRef，在 complete_task 那一步断言 request.input 为 {taskRef: 任务三元组, planRef, roundRef: 读回的 ref}。steps[0] 补 reason: null。
V: 属实。来源 base A2-workflow-auto-rework.test.ts:251-254 用 toEqual 断言 receipt:null、reason:null 和 open_checks 的精确 input。:259-260 断言 complete_task 的 request.input = {taskRef: head.subject, planRef, roundRef: head.ref}。目标 C8-human-stop-respected.test.ts:457-461 只带过了 steps[0] 的 open_checks input，用的是 toMatchObject，嵌套对象是部分匹配，比来源 objectContaining 下的精确 input 松一点；没有 reason:null，也没有 complete_task 的 request.input。T3-027（t-items-T3.md:336）说“A2 独有的只是精确请求字段，合并时可带过去”，没有说丢弃哪部分，而任务书 §3 要求目标断言来源的全部内容。行为上，真实 Host 里 complete_task 提交成功、Task 变为 satisfied（:462-467），覆盖了大部分，所以归为不整洁。

## T3a-04 不整洁 | T3-002 / T3-003 | tests/app/A2-runtime-capabilities.test.ts:209-235
P: 转换时给共享夹具 startHost 加了没有条目要求的 settingsDirectory 覆盖参数，测试也改用一个单独的临时设置目录。被测 Host 因此不再从 SQLite Host 的默认位置 database/host-settings 读设置，而条目的依据正是这个默认位置（host.ts:327-328）。用默认位置同样能走“automation/save → close → 重开”。
FIX: 去掉 settingsDirectory 参数，startHost(paths) 照旧，设置走默认的 database/host-settings。夹具里新加的可选参数也一并删除，因为 K-R 不用它。
V: 属实。tests/helpers/runtime-capabilities-fixture.ts:40、56、65 给 startHost 加了可选的 settingsDirectory 参数。A2-runtime-capabilities.test.ts:209 新建 'a2-capabilities-settings-' 目录，:210、214、224、231、235 都传入它。K-R-runtime-capabilities.test.ts:39 不用这个参数。src/app/host.ts:327-328 在 SQLite 下默认使用 join(storage.directory,'host-settings')，原测试也是写到这里（tests/helpers/A2-restart-fixture.ts:229）。用默认位置同样能走 automation/save → close → 重开。T3-003 要抽的参数只有 scope、adapterId、名称（书面改正还加了时钟和清理），没有设置目录；T3-002 的依据就是这个默认位置。属于超出条目的小改动，被测行为没有变弱。

## T3a-05 不整洁 | T2-022 | tests/runtime/K3-19-review-admission.test.ts:24-28
P: T2-022 删掉了 tests/runtime/K3-19-review-admission-pure.test.ts，但这个文件头注释仍告诉读者，不可达组合的纯函数测试在那个已删除的文件里。这些用例现在在 tests/contracts/review-admission.test.ts。
FIX: 把注释里的指向改成 tests/contracts/review-admission.test.ts（只改注释）。如果该文件不在白名单，就报给 lead 处理。
V: 属实。tests/runtime/K3-19-review-admission.test.ts:24-28 仍写着这些不可达组合是 `K3-19-review-admission-pure.test.ts` 里的纯函数测试。该文件已按 T2-022（t-items-T3.md:65）删除，目录里查不到，tests/ 下也只剩这一处引用。K3-19-review-admission.test.ts 不在 T3a 的文件清单里，可能不在白名单上，未必是实现方的责任，但这个过时指向确实存在，需要 lead 处理。

## T3a-06 不整洁 | T2-025 / T3-036 / T3-101 | tests/helpers/R4-history-turn-support.ts:53-54, 126-127
P: 几处注释与改后的代码不符：(1) R4 helper 把 `text` 注释成“The user text of the scripted Turn”，实际传进 steps.start 的 replies，作为脚本模型的回复，用户输入是平台准备好的 brief；(2) K-R-previous-turn-bounds.test.ts:27-28 仍写“live counter (test 1) or absent (test 2)”，计数那条已按 T3-036 删除；(3) WP2-duties-fixture.ts:1-4 的文件头仍在描述 pinned roles、Sessions 和 entered Work 夹具，这些代码已按 T3-101 删除，文件现在只剩常量和两个纯函数。
FIX: 改这三处注释：R4 helper 的 text 写成“脚本模型的回复文本”；K-R 注释改为只有缺接缝这一种情形；WP2 文件头改为只说明剩下的 WP2_DUTIES、wp2LegacyDuty、wp2RoleContent。
V: 三处都属实。(1) R4-history-turn-support.ts:53 把 text 注释成“The user text of the scripted Turn”，实际 :126-127 把它作为 replies 传进 steps.start；S2B-runtime-steps-fixture.ts:118-120 写明 replies 是脚本模型的回复。调用方（R4c:105、R4b:182 等）没有对这段文字做断言，只是注释写错了。(2) K-R-previous-turn-bounds.test.ts:27 仍写“live counter (test 1) or absent (test 2)”，但文件里现在只剩 :84 这一条 absent 用例；计数那条已按 T3-036 删除，文件头 :11 已经改了，:27 没改。(3) WP2-duties-fixture.ts:1-4 的文件头仍说 real pinned roles、newly created Sessions、authorized entered Work，这些代码已按 T3-101 删除（T3a.diff 2232 起），现在 :6-33 只剩 WP2_DUTIES、wp2LegacyDuty、wp2RoleContent。条目没有点名这几行文件头，可以交 lead 一并改。

## T3b-01 会出错 | T3-006 | tests/app/session-rendering.test.ts:427-428
P: R6 的“原始记录展开、默认收起”这一组独有断言只搬过来一半。R6 有两条断言，查原始记录里保存着推理内容（reasoningContent 字段和推理正文），这两条被删了，全仓也没有别处覆盖。新搬来的“没有 open”那条又少了非空保护：正则没命中时 savedRaw 是空串，这条断言会空过。
FIX: 在 session-rendering.test.ts:428 前补两条：expect(savedRaw).toContain('reasoningContent') 和 expect(savedRaw).toContain('已保存的判断')。这样既补回 R6 原有内容，也保证 savedRaw 非空，“默认收起”这条才不会空过。
V: 已核实。条目 T3-006（t-items-T3.md:179-188）要求先搬 R6 独有的“原始记录展开默认收起”。它引的 R6:357-360 是 3a9f6d94 的行号（git show 核对过），这四行是：savedRaw 正则、toContain('检查了测试失败的原因')、toContain('reasoningContent')、not.toMatch(open)，对应 w2-base 的 R6:358-361。当前 session-rendering.test.ts:427-428 只搬了正则和 not.toMatch(open) 两行。ledger-T3.txt:13-14 把 w2-base R6:359、:360 记为 REMOVED，t-reply-T3.md:165 把它们归到 T3-006。在 tests/ 里 grep reasoningContent，只有 session-rendering:421 设值，另有 R4-terminal-history:285，但那条查的是 Kernel 投影，不是界面原始记录块。全仓没有一条断言查 data-history-raw="agent:a" 块里的推理原文，合并丢了覆盖，违反任务书 §2.3。再看空过的问题：taggedBlocks（:198-204）不要求 <details> 标签，:431 也只查属

## T3b-02 会出错 | T3-006 | tests/app/session-rendering.test.ts:406-445
P: 条目把 R6 的“未知记录”算成重复，可目标测试查的不是同一件事。R6 渲染的是一条未知 recordType 的原始记录，走未识别记录分支。session-rendering 的 agent:unknown 是已知的 agent.event 里带一个未知事件类型，走的是 technical 分支。删掉 R6 历史块以后，全仓没有测试再覆盖“未知记录类型照样可辨认、可按需查看”。
FIX: 在 session-rendering 的 'keeps every original record reachable…' 里加一条正文为 {recordType:'future.unknown',…} 的记录，断言 html 含 data-history-body="unknown" 和 'future.unknown'，它的 raw 块里也要有原文。也可以交 lead 改判这一处不算重复。
V: 已核实，但根子在条目的覆盖判断，不在实现方，应交 lead 改判。w2-base R6 第四条记录的正文是 {recordType:'future.unknown'}（diff 里 R6 那条被删的记录）。parse.ts:137 取到 recordType 后，既不是 turn.started 也不是 agent.event，于是走到 :200 返回 {kind:'unknown'}，渲染在 timeline.ts:275-277（data-history-body="unknown"、未识别记录）。session-rendering 的 agentEvent 固定写 recordType:'agent.event'（:50），所以 :413 的 'future.event' 和 :490 的 'unknown-x' 都走 parse.ts:192-197 的 technical 分支。在 tests/ 里 grep 未识别记录、data-history-body="unknown"、future.unknown、parseHistoryBody，都是 0 命中。T3-006 的核实理由把“未知记录”算成重复，可它指的覆盖（session-rendering:395-437）测的是另一条分支，未知 recordType 这条渲染路径现在没有测试了。按审核第 2 条（cover 必

## T3b-03 会出错 | T3-021 | tests/app/host-settings.test.ts:901-906
P: 转换以后，“未授权命令的工作区不能批准检查”这一行同时有两个错：没有命令授权，而且没有已保存的 Answer。断言只查 status:'rejected'，把授权检查删掉，这一行照样通过（F11）。旧测试给 locked 工作区存过一份真实的提案，只有授权检查能拒它。另外，两条拒绝行用的都是手拼的 answerRef，这是平台签发的值，却不在 describe('rejects: …') 里，不合 v2 A1/A6。
FIX: 推荐的做法：给 locked 范围也跑一次真实 Query（多加一条 planAnswer 脚本回复），拿到真实的 answerRef 再批准，断言 {status:'rejected', code:'forbidden'}。至少要把期望改成 code:'forbidden'。两条拒绝行移进 describe('rejects: …')，每行只放一个错。
V: 主要论点已核实。w2-base host-settings.test.ts:875-880 的 save(locked.scope,'locked') 先把提案写进 proposals，替身 readCheckProposal 对它返回 ready（:854-860），所以 :889 只有授权检查能拒。当前 :904-906 用的 answerRefForScope(locked.scope,'locked') 没有对应的已保存 Answer，期望只有 {status:'rejected'}。src/app/host-settings.ts:772-775 先查 commandsAllowed，回 forbidden。把这一段删掉，会走到 :782 调 host.ts:979-989 的真实 readCheckProposal：readQueryAnswer 找不到时回 {status:'rejected',code:'not_found'}，读失败时回 code:'unavailable'，status 仍是 'rejected'；外面 catch 用的 unavailable()（host-settings.ts:378）也是 status:'rejected'。所以去掉授权检查，这一行照样通过，属于 F11。至少要把期望改为 code:'forbidden'，最好给 lock

## T3b-04 违规 | T3-042 | tests/composition/W1-future-plan-platform.test.ts:179-181, 209, 211
P: 后面一版 Plan 的 ref 原来是写死的期望值，现在直接拿 applyPlanChange 的返回值当期望（F8：期望值来自程序输出）。planId 'w1-composed-later' 是测试自己在草稿里选的，不是平台签发的值，完全可以写字面量。现在的写法下，如果 apply 返回了错的 ref，Goal 也指向它，:181、:209、:211 照样通过。
FIX: 恢复字面量 const plan2Ref = { aggregateType:'PlanRevision', projectId, planId:'w1-composed-later' }，先断言 plan2Applied 的 value.ref 等于它，后面的断言再用这个字面量。
V: 已核实。w2-base W1:175 的 plan2Ref 是字面量 {aggregateType:'PlanRevision',projectId,planId:'w1-composed-later'}，:203、:205 用它当期望。当前 :179 是 plan2Ref = plan2Applied.value.ref，:181、:209、:211 拿这个返回值当期望。planId 是测试在草稿里自己定的（:169），不属于任务书 §2.4 列出的平台签发值；同一文件的 goalRef（:46）和 claim 里的 Goal ref 也都是测试自己写的字面量。任务书 §2.4 规定期望值不得取自程序输出，并要求保留原有期望值，除非条目另有说明。T3-042 只允许“Goal 修订号等断言按真实写入微调”，没有授权把 Plan ref 的期望换成程序输出，规则单 F8 也禁止这样做。后果：如果 apply 返回了错的 ref，Goal 也指向它，这几条断言照样通过。

## T3b-06 违规 | T3-064 | tests/data/S8E-A08-skip-list.test.ts:36-42
P: 书面核对要求断言“所有 language issues 合并后为空”。实现方发现做不到，自己换成“三个保留路径不在 issue 里”，并删掉了来源测试，结果报 partial，没有按任务书 §1 标 BLOCKED 交给 lead 裁定。证据本身是对的：dist/z.ts 在 TS 扫描里合法地报为 skipped。换上的断言也没有丢掉来源的实际覆盖，但这个口径是实现方自己定的。
FIX: 交 lead 裁定，接受替代断言或改写这条书面核对。如果要求完全按书，可把断言改为 issues 恰好等于 [{path:'dist/z.ts',kind:'skipped',reason:<SKIPPED_REASON 字面量>}]，原因写成手写字面量。
V: 已核实。T3-064 的书面核对改正（t-items-T3.md:590）要求“断言所有 language issues 合并后为空”。typescript-source-query.ts:112 的 roots 排除 /dist/，typescript-light-scan.ts:417-421 对未遍历的源文件推 skipped issue，所以 dist/z.ts 一定会报，这个字面要求做不到。实现方没有按任务书 §1（条目和现有代码对不上时“do not improvise… Mark the item BLOCKED”）标 BLOCKED，而是自己把断言换成“三个路径不在 issue 里”（S8E-A08:39-42），删掉了来源 S8D:151-167，报 partial（t-reply-T3.md:121-125）。它确实写明了理由并请 lead 裁定（:224、:238），换上的断言也没有丢掉来源的实际覆盖，所以是过程违规，严重程度低，交 lead 裁定接受替代断言或改写书面核对即可。

## T3b-08 不整洁 | T3-006 | tests/app/R6-workbench.test.ts:294-299
P: 历史子块删掉以后，测试名和上方注释还说“projects real original history in order”，“first red is missing user content in the honest timeline placeholder”，可这个测试已经不渲染、也不断言任何原历史。tests/runtime/R4c-kernel-history-range.test.ts:406 也是同类问题：按 T2-033 删掉损坏注入后，测试名仍是“isolates Sessions so damage and tails never leak across them”，实际已没有 damage。
FIX: 按留下的断言改测试名和注释。R6 改成只说任务层级、执行依赖和 work link 加历史页签布局。R4c 改成 'isolates Sessions so tails never leak across them'。
V: 已核实。当前 R6-workbench.test.ts:294-297 的注释和 :299 的测试名仍在说 real original history in order，还提到 first red is missing user content in the honest timeline placeholder。可 diff 已经删掉 renderSessionHistoryTimeline 的导入和整个历史子块，测试里再没有渲染或断言原历史。R4c-kernel-history-range.test.ts:406 的测试名仍是 'isolates Sessions so damage and tails never leak across them'，而 w2-base :594-598 的 mutateDatabase 改库段已按 T2-033 删掉，:406-422 里没有 damage 了。属于测试名和实际断言不一致（审核第 7 条），不影响结果，只改名和注释即可。

