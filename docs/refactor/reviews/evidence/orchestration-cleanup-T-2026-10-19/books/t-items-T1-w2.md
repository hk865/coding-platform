# T items, wave 2, group T1 (69 items; lead 2026-10-20)

编号 = 原组内序号 · 清点编号。动作是最终的；修正行的先后和优先级见任务书 §1。看不懂或和代码对不上的，标 BLOCKED 并报证据。

从别的组移进本组的条目（它们和本组条目改同一批文件）：T2-003, T2-021, T2-045, T2-049, T2-050, T2-051, T2-052, T2-059, T3-090, T3-095, T3-096, T3-106。

### T1-001 · F-29 · helper · tests/helpers/S2C-X-scale-fixture.ts:523
- **动作：** delete:删 tests/helpers/S2C-X-scale-fixture.ts:523 整行，并删掉只为这行转出口才存在的类型 import：:51 GoalRef 整行、:56 的 StoreResult、:59 的 RecordOrderedLookupPort 与 RecordCountPort、:83 的 type RunSupport（RecordLookupPort 在 :201、SessionRef 在多处仍用，保留）
- **覆盖/依据：** 无外部消费者
- **核实理由：** :523 列的是 7 个名字不是 8 个；唯一 importer tests/work-graph/S2C-lines-scale.test.ts:14-17 不取其中任何一个（Record*Port 它自己从 src 的 lookup-ports 直接 import）。“不要删顶部源 import”不对：RunSupport、StoreResult、RecordOrderedLookupPort、RecordCountPort、GoalRef 在本文件只出现在 import 行和 :523，删 :523 后这些 import 就没人用了。
- **涉及测试：** 无测试从本文件 import 这 8 个名字
- 来源：DSH；核实：partly；规格行：否；估计行数：5
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：涉及测试仍写8个名字，实际出口为7个（tests/helpers/S2C-X-scale-fixture.ts:523；.lead-ref/books/t-items-T1.md:9）。 改法：将涉及测试中的8改为7；删除动作不变。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S2C-X-scale-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S2C-X-scale-fixture.ts:501（七个类型出口仍在，按书面改正删除。）

### T1-003 · A1-28 · handwritten · tests/work-graph/A2-control-service.test.ts:320-326;335;346
- **动作：** convert:setGoalControl（paused 与 cancelled 各用独立 fixture，cancelled 不可恢复）
- **覆盖/依据：** 保留原文件 336-347 的 Run 控制规则（D-9）
- **核实理由：** 320-326 的 goalReadAs 在读端改写 Goal 的 desiredState，等同手写事实；公开的 setGoalControl 存在（task-contracts.ts:90-93，并说明不改任何 Run），submitControl 的拒绝只看 desiredState（control-intent-machine.ts:249-250），所以真实暂停/取消能得到同样的拒绝和文字。
- **涉及测试：** refuses a resume of a not-entered and of an entered Run while the Goal is paused or cancelled; pause and cancel stay accepted
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：9
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：B2前置仍原始提交治理并自行创建、登记Kernel Session；TP-107只处理治理（tests/helpers/task-claim-fixture.ts:227、:324、:327；.lead-ref/books/t-items-TP.md:717）。 改法：先完成TP-107，并将task-claim-fixture的createSession改为createSessionOperations的真实createSession；前置合入后再转换两个独立的Goal控制fixture。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 补真实 Session 创建；entered 分支用真实 Runtime 门控；独立公开 pause/cancel Goal，保留拒绝及公开读不变。（位置：tests/work-graph/A2-control-service.test.ts:320; tests/helpers/task-claim-fixture.ts:245; tests/helpers/task-claim-fixture.ts:361; tests/helpers/S2B-runtime-steps-fixture.ts:319；说明：治理已公开化，Session 和 entered 前置仍需转换。）

### T1-004 · A1-09 · handwritten · tests/work-graph/A2-control-service.test.ts:290-315
- **动作：** merge-into:tests/scenarios/A7-control.test.ts::A7 yielded wait: ... the yielded Run takes no control (RD-8)（直接删 A2-control-service.test.ts:290-315，不用新建 helper）
- **覆盖/依据：** tests/scenarios/A7-control.test.ts:499-523（真实回复、Workflow 接续 claim 之后四种控制都被拒为 busy，原因文字相同，scenario.counts 不变）；等待窗口里未消费时受理控制见 A7:488-489 和本文件 281-282
- **核实理由：** 这条测试确实用假读口把 Lease 的 holder 改成 a2-successor-run（A2-control-service.test.ts:296-301），算手写事实。但同一断言在 A7-control.test.ts:506-523 已经走真实的接续 claim 做过（四种控制、同一个 busy 原因、零写入），照 DSH 新建 helper 去转换只会再复制一遍 A7，应该直接删。
- **涉及测试：** RD-8: once a successor Run holds the Lease, the yielded Run takes no control and nothing is written
- 来源：DSH；核实：partly；规格行：否；估计行数：26
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除会丢失未消费等待时cancel的intent为queued的断言，点名覆盖只检查pause（tests/work-graph/A2-control-service.test.ts:310；tests/scenarios/A7-control.test.ts:488）。 改法：先在A2-continuation-projection.test.ts:128保存真实cancel结果并断言intent.status为queued，将其列入覆盖，再删除原用例。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/scenarios/A7-control.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/A2-control-service.test.ts:290; tests/app/A2-continuation-projection.test.ts:109（保存真实 cancel 结果并补 queued 断言，再删除原例；仅目标行号移动。）

### T1-005 · A1-10 · handwritten · tests/work-graph/A2-control-service.test.ts:262-275
- **动作：** merge-into:tests/scenarios/A7-control.test.ts::A7 yielded wait ...（删 A2-control-service.test.ts:262-288 的 yieldedRun 和 RUN-14 用例，把 :287 的 run.controlState 断言搬到 A7-control.test.ts:495 之后；RD-8 用例按 A1-09 处理）
- **覆盖/依据：** tests/scenarios/A7-control.test.ts:457-497（脚本化模型调用真实 send_session_message(replyMode wait) 让出；暂停为 queued，恢复后暂停被 superseded，origin platform_superseded、supersededBy 指向恢复）
- **核实理由：** yieldedRun 自己拼了 run_yielded 事件交给 recordRunResult（A2-control-service.test.ts:265-271），按 coordinator-mode 的规则算手写事实，这一点属实。但 A7-control.test.ts:457-497 已经走真实的等待让出，断言同样的“恢复取代排队中的暂停”，只缺本文件 :287 的 controlState 一行，搬过去就够，不必另建 helper。
- **涉及测试：** a resume over the queued wait-window pause supersedes it (RUN-14); RD-8: once a successor Run holds the Lease ...
- 来源：DSH；核实：partly；规格行：否；估计行数：27
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/scenarios/A7-control.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/A2-control-service.test.ts:262; tests/scenarios/A7-control.test.ts:488（先迁 controlState 断言，再删手造 yielded 前置。）

### T1-007 · A1-50 · tamper · tests/work-graph/A2-gate-chain-facts.test.ts:298-307
- **动作：** delete
- **覆盖/依据：** 只为篡改（AGENTS.md:33 第 4 条）：真实写者的 ref.taskId 取自 subject.taskId（src/core/work-graph/evidence/evidence-service.ts:1112-1114），后继轮沿用前驱的 ref 与 subject；同文件 149-216 的当前门链流程保留
- **核实理由：** A2-gate-chain-facts.test.ts:302-304 手改 subject 后用 commitRaw 写入，造出 ref.taskId 和 subject 不一致的轮次。真实写入总让两者一致（evidence-service.ts:1112-1114），所以 plan-readers.ts:1285 的拒绝只有篡改数据库才能触发。
- **涉及测试：** foreign subject / inconsistent gate round reference
- 来源：Codex；核实：confirmed；规格行：是；估计行数：10
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/A2-gate-chain-facts.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/A2-gate-chain-facts.test.ts:267（异 subject/ref 篡改例仍在，删除动作不变。）

### T1-008 · A1-20 · duplicate · tests/work-graph/B2-11-expansion-levels.test.ts:162-173
- **动作：** merge-into:tests/work-graph/B2-11-script-expansion.test.ts::does not go a third level
- **覆盖/依据：** tests/work-graph/B2-11-script-expansion.test.ts:155-164::does not go a third level（合并时把源 171 的 sha256 断言带进 162）
- **核实理由：** 源测试 B2-11-expansion-levels.test.ts:162-173 和目标 B2-11-script-expansion.test.ts:155-164 是同一个场景：一个 package.json 三层脚本，只展开两层，第二层的正文不再展开。目标还多断言只读了一次文件（:163）。源测试名里的“没有这个脚本”其实没测，那个场景已由 script-expansion.test.ts:124-129 覆盖。
- **涉及测试：** does not expand a readable package.json without that script or a third level
- 来源：Codex；核实：confirmed；规格行：是；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/B2-11-expansion-levels.test.ts:162; tests/work-graph/B2-11-script-expansion.test.ts:155（合并时保留 sha 断言。）

### T1-009 · A1-19 · duplicate · tests/work-graph/B2-11-script-expansion.test.ts:241-249
- **动作：** merge-into:tests/work-graph/B2-11-expansion-levels.test.ts::cuts scriptText to 2,048 bytes and sets the record truncated flag; keys use the full text
- **覆盖/依据：** tests/work-graph/B2-11-expansion-levels.test.ts:105-116::cuts scriptText to 2,048 bytes and sets the record truncated flag; keys use the full text
- **核实理由：** B2-11-script-expansion.test.ts:241-249 只断言 scriptText ≤2048 字节和 actions 用未截断正文算键；B2-11-expansion-levels.test.ts:112-115 同样走真实读口，断言这两点并多断言 truncated=true，留下的是更全的那条，B2-11 行仍有测试。
- **涉及测试：** clips scriptText to 2,048 UTF-8 bytes but keys come from the untruncated body
- 来源：Codex；核实：confirmed；规格行：是；估计行数：9
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：合并目标被T1-010整文件删除（.lead-ref/books/t-items-T1.md:62、:69）。 改法：与T1-010同批，将levels的105–116迁入script-expansion并替换241–249，最终只保留script-expansion。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/B2-11-script-expansion.test.ts:241; tests/work-graph/B2-11-expansion-levels.test.ts:105（与 010 同批迁移，最终保留 script-expansion。）

### T1-010 · A1-21 · duplicate · tests/work-graph/B2-11-script-expansion.test.ts:214-233
- **动作：** merge-into:tests/work-graph/B2-11-script-expansion.test.ts（整份 B2-11-expansion-levels.test.ts 删掉，搬过去四处：60-77 同一脚本名在两个目录各自展开；用 105-116（带 result.truncated===true）替换 241-249；用 118-145 两条读失败（带 truncated:false 和 basis.reason）替换 214-233；79-103 每层的 scriptText 断言补进 133-153）
- **覆盖/依据：** tests/work-graph/B2-11-script-expansion.test.ts:108-114,133-153,155-164,166-179,190-199（其余几条按 action 搬入后才算覆盖）
- **核实理由：** 两份文件测的是同一个纯函数 expandShellScripts，大部分重复（levels:162-185 对应 script-expansion:155-164,108-114,176-178），合成一份比 Codex 两份各留一半、仍留着重复要好。但 DSH 说的“断言相同”不成立：script-expansion 没有同一条动作跨两个目录的用例（levels:60-77；script-expansion:208-212 只测同目录去重），241-249 不断言 result.truncated（levels:112），失败用例也少 truncated:false（levels:131,144）。所以这几组按 Codex 的判断保留 levels 那份更强的写法再搬过去。
- **涉及测试：** marks a failed read as unavailable with no actions and never throws; keeps the per-entry basis unavailable when the real package.json is moved away
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：155
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：整文件删除遗漏maxFiles为1的独立输入及路径、数量、basis断言（tests/work-graph/B2-11-expansion-levels.test.ts:147、:154、:156）。 改法：增加第五处迁移：把levels的147–160整条迁入script-expansion，保留全部输入及断言后再删levels文件。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/B2-11-expansion-levels.test.ts:60; tests/work-graph/B2-11-expansion-levels.test.ts:147（包括 maxFiles=1 在内的五组输入和全部断言迁完再删文件。）

### T1-011 · A1-25 · trivial · tests/work-graph/B2-11-script-expansion.test.ts:190-199
- **动作：** merge-into:tests/work-graph/B2-17-disposition-reads.test.ts::reads one file per distinct directory, at most four, and skips the fifth
- **覆盖/依据：** tests/work-graph/B2-17-disposition-reads.test.ts:34-49（memory/sqlite 两种，真实拦下命令 + skip_as_done，44-48 断言四个读路径、四个 expansions、truncated=true）；相对 cd ../x 的目录解析另由 B2-11-expansion-levels.test.ts:60-77 覆盖
- **核实理由：** B2-11-script-expansion.test.ts:190-199 断言的四路径/四展开/truncated 在 B2-17 的业务流程测试 44-48 里原样断言；上限本身就是 K3 规格 B2-17 行（slice-K3-SPEC.md:1501），只差相对 cd 写法，而相对 cd 已在 levels 60-77 测过。
- **涉及测试：** reads one file per distinct directory and at most maxFiles (the rest are absent)
- 来源：Codex；核实：confirmed；规格行：是；估计行数：10
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/B2-11-script-expansion.test.ts:190; tests/work-graph/B2-17-disposition-reads.test.ts:34（删除重复段并补目标覆盖。）

### T1-012 · A1-24 · helper · tests/work-graph/B2-12-recognition.test.ts:52-80
- **动作：** 把 record()/request()（连同 sha/keyOf/ctx）抽到 tests/helpers 下一个新的 B2-12 构造器模块，两个文件都从那里 import；不要让 pure 文件 import B2-12-recognition.test.ts
- **覆盖/依据：** tests/work-graph/B2-12-recognition.test.ts:52-80 与 tests/work-graph/B2-12-recognition-pure.test.ts:29-57 逐字相同
- **核实理由：** B2-12-recognition.test.ts:52-80 和 B2-12-recognition-pure.test.ts:29-57 的构造器确实逐字一样，两边也都在用；但 B2-12-recognition.test.ts:28-35 有 vi.mock 和自己的 describe，pure 文件 import 它会把这些一起带进来，违背 pure 文件头 :5-8 说的拆出理由，所以应抽成共享 helper。
- **涉及测试：** (file-level fixture builders record()/request())
- 来源：DSH；核实：partly；规格行：否；估计行数：28
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：pure调用方和新共享helper均不在白名单，新helper未命名（.lead-ref/books/t-items-T1.md:83；.lead-ref/books/t-files-T1.txt:13）。 改法：共享模块定名B2-12-recognition-fixture.ts；将该模块及B2-12-recognition-pure.test.ts加入白名单；共享模块只用纯依赖。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/B2-12-recognition.test.ts:52; tests/work-graph/B2-12-recognition-pure.test.ts:29（按书面改正抽纯共享夹具并调整白名单。）

### T1-013 · A1-31 · handwritten · tests/work-graph/B2-execution-result.test.ts:29-32
- **动作：** convert:linkSessionWork（在 B2 夹具里用 createSessionLifecycleService({records,lookups}) 建 lifecycle，enter 之后调 linkSessionWork 开 responsible 链接，后面断言改用返回的 link）
- **覆盖/依据：** 保留 B2-execution-result.test.ts:36-62 的原子结束、链接保留、发现和 Task phase 断言
- **核实理由：** linkSessionWork 现在就有（session-lifecycle.ts:440，路由 core-routes.ts:403），work_linked 不查 occupancy，只要 Session 是 active、目标有效（session-availability.ts:934-950），所以 entered 时能开链接；建服务只需 records/lookups（graph-session-fixture.ts:357）。差别只有 since 取真实游标、Session revision+1，原测试 29-34 要改用返回值，约 8 行。
- **涉及测试：** one complete Turn atomically ends Run/Attempt/outbox, retains released Lease, advances the boundary and preserves discovery/links
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：8
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：只换链接种子仍保留手造entered和成功终态事实（tests/work-graph/B2-execution-result.test.ts:25、:35、:36；tests/helpers/B2-execution-fixture.ts:297）。 改法：前置改为真实prepareExecution/startRun并门控在entered；此时linkSessionWork，再放行模型产生真实结束；重放使用Runtime实际提交的原请求。先完成共享B2及task-claim初始化改造。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/B2-execution-result.test.ts:24; tests/helpers/S2B-runtime-steps-fixture.ts:348（真实 prepare/start、entered 门控、链接和结束；重放实际请求。）

### T1-014 · A1-33 · handwritten · tests/work-graph/C1-session-mailbox.test.ts:128-165;336-353;367-377;467-490;509-514
- **动作：** delete（C1-session-mailbox.test.ts:467-490 整条）
- **覆盖/依据：** 行为只在篡改后存在：AGENTS 第 4 条；结束后原回执重放、新请求 forbidden 见同文件 :336-353
- **核实理由：** Lease 的 release 只在 attempt_ended/attempt_resolved 时写（attempt-machine.ts:719-725、804-807），跟 Run 结束在同一次提交里；按 Codex 改走 recordRunResult 后 Run 已 ended，会先在 mailbox-service.ts:1326 被拒，变成 :336-353 的重复，1341 的 release 分支还是到不了。
- **涉及测试：** work-run admission; retains exact receipts after bound Run ends; sender Session guard race; released same-owner Lease; failed publication retries across a Workspace revision
- 来源：冲突裁定（采用 dsh）；核实：confirmed；规格行：是；估计行数：24
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/C1-session-mailbox.test.ts:467; tests/work-graph/C1-session-mailbox.test.ts:336（删除释放 Lease 后篡改的整例，终态重放覆盖仍在。）

### T1-015 · A1-52 · tamper · tests/work-graph/C1-session-mailbox.test.ts:355-365;461-463
- **动作：** delete（C1-session-mailbox.test.ts:355-365 整条；只为篡改）
- **覆盖/依据：** 行为只在篡改后存在：AGENTS 第 4 条；Run 已结束被拒见同文件 :128-136
- **核实理由：** mailbox-service.ts:1326 先查 run.status==='running'，1335 才查 lease holder；真实接续 claim 要求原 Run 已 ended(yielded) 且 lease 已由它释放（claim-service.ts:358-376），所以走真实接续只会在 1326 被拒，和 :128-136 的已结束用例重复，“Run 和 Session 仍像在跑、Lease 却归接续者”只有改库能造出。
- **涉及测试：** rejects a formal lease successor even when the Run and Session still appear running; SQLite closes both body and ledger connections, reopens the message, and rejects actual stored-body corruption
- 来源：冲突裁定（采用 codex）；核实：refuted；规格行：是；估计行数：11
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/C1-session-mailbox.test.ts:355（Lease 接续篡改段仍在。）

### T1-019 · A1-29 · duplicate · tests/work-graph/K3-15-disposition-effects.test.ts:230-238
- **动作：** merge-into:tests/work-graph/K3-15-disposition-effects.test.ts::%s: resolveDecision applies the card disposition and leaves the observation untouched（删 :230-238）
- **覆盖/依据：** tests/work-graph/K3-15-disposition-effects.test.ts:149-206（skip_as_done 分支 :199-203）
- **核实理由：** :230-238 用同一个 createK3NeedsDecisionRecord 加卡片 skip_as_done（applyChoice :128-146），断言长度 1、alias/reviewRunId、section 长度 1；参数化用例 :199-203 对同一选择断言了全部这些，section 还用 toEqual 比得更严，没有独有断言。
- **涉及测试：** K3-15 (L20): a card skip_as_done records the one blocked command
- 来源：DSH；核实：confirmed；规格行：是；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/K3-15-disposition-effects.test.ts:230; tests/work-graph/K3-15-disposition-effects.test.ts:149（并入现有参数化例。）

### T1-020 · A1-23 · duplicate · tests/work-graph/K3-16-proposal-round-fixture.test.ts:121-166
- **动作：** merge-into:tests/work-graph/K3-16-second-unfinished-proposal.test.ts::every proposal written, both rounds unfinished -> needs_decision with review_incomplete
- **覆盖/依据：** tests/work-graph/K3-16-second-unfinished-proposal.test.ts:105-111、126-134；迁入源 132 的 round:1 轮号断言
- **核实理由：** 源文件 K3-16-proposal-round-fixture.test.ts:137-166 和目标 K3-16-second-unfinished-proposal.test.ts:66-118 走的公开步骤一样（核对轮未完成，review_unavailable 出卡，选 safer_method，两轮提案都 crashed），目标断言更多。源 121-135 的首轮断言目标 105-111 都有，只少 132 的轮号；128 的 crashed 已由夹具 finishK3RoundRun 强制检查（K3-proposal-round.ts:511）。
- **涉及测试：** a first unfinished round keeps awaiting_proposal and clears activeRound; a second unfinished round settles to needs_decision with review_incomplete
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：45
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/K3-16-proposal-round-fixture.test.ts:121; tests/work-graph/K3-16-second-unfinished-proposal.test.ts:122（迁首轮断言后删除重复例。）

### T1-024 · A1-37 · handwritten · tests/work-graph/R3b-material-applicability.test.ts:24-50;86-88
- **动作：** convert:createProject/registerWorkspace/createGoal → 采用Plan/claimTask；submitQueryJob
- **覆盖/依据：** 保留原文件 92-98 的材料归属和使用范围断言；bodyFor（62-69）也可改用 materials.storeArtifact
- **核实理由：** R3b-material-applicability.test.ts:24-50 手写 Workspace/Goal/Run/QueryRun 快照，86-88 用 seedCommit 直接提交，属实。公开步骤现在都有：projects/create、workspaces/register、goals/create（core-routes.ts:372-377），submitQueryJob 会写出 QueryJob@1 和 pending 的 QueryRun@1（R5b-query-job.test.ts:141-160）。两个 Workspace、两个 Goal 加上领取 Run，能得到同样的跨 Workspace 状态。
- **涉及测试：** a Run or QueryRun reader opens only its own material, and not for current use
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：30
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：采用Plan和claim的治理、Session前置缺失，bodyFor仍有两种实施方式（src/core/work-graph/tasks/plan-readers.ts:824；tests/work-graph/R3b-material-applicability.test.ts:62；.lead-ref/books/t-items-T1.md:168）。 改法：补公开治理激活、初始架构、可领取Plan及真实Session Runtime创建；补schemas；正文统一由真实owner Run上下文调用materials.storeArtifact，删除也可措辞。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/R3b-material-applicability.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/R3b-material-applicability.test.ts:24; tests/work-graph/R3b-material-applicability.test.ts:87（按改正补公开治理、Plan、真实 Session，正文经真实 owner 上下文存入。）

### T1-025 · A1-36 · handwritten · tests/work-graph/R3d-fixture.ts:79-91
- **动作：** convert:createProject → registerWorkspace（后端加 PROJECT_BOOTSTRAP_RECORD_SCHEMAS 事件）；有治理记录处改 installCompletionPolicy/activateCompletionPolicy/adoptInitialArchitecture
- **覆盖/依据：** 各原业务测试保留；R3a-goal-replay-boundaries.test.ts:50 的 Project revision 2 没有公开步骤（src 里写 Project 的只有 createProject，project-bootstrap-service.ts:574,591），只能留手写，或改成只用 line-settings/decision-settings 升 Workspace（line-settings-service.ts:214、decision-settings-service.ts:178）；CoordinationPolicy 见 A1-48
- **核实理由：** 所引各处都是手写 Project/Workspace 种子（R3d-fixture.ts:79-91、R3a-goal-replay-boundaries.test.ts:22-27、R3c-plan-entry.test.ts:30-36、R3c-plan-adoption.test.ts:68-75、R3c-task-relations.test.ts:89-98）。公开的 createProject/registerWorkspace 写出同样的 r1 记录（project-bootstrap-service.ts:574,669）。不过 R3a:50 的 Project 升版没有公开步骤，另外连同治理记录一起改的话，45 行偏少。
- **涉及测试：** shared Project/Workspace scope fixtures
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：80
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：五文件范围不明且缺四份白名单；Project升版处理有两个方案；R3a保留事件存储断言（.lead-ref/books/t-items-T1.md:175、:176；tests/work-graph/R3a-goal-replay-boundaries.test.ts:50、:54）。 改法：明确五文件范围；真实创建Session后setLinePins使Workspace升版，Project保持原版本；原始事件断言子段单列BLOCKED，合规入口冻结前不删除。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 按上面的书面核对改正做 scope 转换（五个文件；Workspace 用真实 Session 后的 setLinePins 升版，Project 保持原版本）。R3a 的原始事件 ID/载荷断言子段 BLOCKED（queryGoal 没有等价的事件输出，src/core/work-graph/model/plan-contracts.ts:44）：保持原样，不删不改，本条报 partial。（位置：tests/work-graph/R3d-fixture.ts:79; tests/work-graph/R3a-goal-replay-boundaries.test.ts:54；说明：lead 10-20：Codex 报 BLOCK 只因事件子段，其余可做）

### T1-026 · A1-56 · duplicate · tests/work-graph/R3e-completion.test.ts:87-164
- **动作：** merge-into:tests/composition/R3e-completion-platform.test.ts::runs the real registered checks, completes work and goal, and replays the original receipt after reopen（要带过去的是 :94-95 的 adoptUnrelatedFutureEdit、把它的 planRef 传给 openRequest/completeTask/completeGoal，以及 :154-156；adoptUnrelatedFutureEdit 必须在 prepared() 的 closeBackend 之前调用）
- **覆盖/依据：** tests/composition/R3e-completion-platform.test.ts:67-148
- **核实理由：** 同一流程确实重复：组合版（:67-148）同样做 work/gate 两轮 PASS、completeTask、completeGoal COMPLETED、图读回 satisfied，还多了重开后重放。但工作图版整条流程都跑在 adoptUnrelatedFutureEdit 产生的新 Plan 上（R3e-completion.test.ts:94-95，planRef 一路传下去，:144 还断言了 planRef），不只是 :154-156 三行；组合版先关后端（:35），所以采用必须在关之前做。合并后，不依赖沙箱的内存版完成流程就没有了（组合版要真 ProcessSandbox，:5-7）。
- **涉及测试：** completes work and the Goal gate from formal rounds, then reads back satisfied and COMPLETED
- 来源：DSH；核实：partly；规格行：否；估计行数：80
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：completeGoal不接受planRef输入，源用例是在结果和显式图读中检查它（src/core/work-graph/model/task-contracts.ts:78；tests/work-graph/R3e-completion.test.ts:144、:147）。 改法：planRef传给openRequest、completeTask和queryTaskGraph；completeGoal仅传goalRef，在其结果断言中检查planRef；采用仍置于closeBackend之前。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/R3e-completion.test.ts:87; tests/composition/R3e-completion-platform.test.ts:67; src/core/work-graph/model/task-contracts.ts:78（按改正合并；completeGoal 不传 planRef。）

### T1-028 · A1-53 · tamper · tests/work-graph/R3g-role-spec.test.ts:346-349;381-404;506-546
- **动作：** delete
- **覆盖/依据：** 只为篡改：AGENTS.md:33（第 4 条）；358-380 的坏请求、缺失 pin、水位断言和 331-337 的正常持久重放保留（去掉 346-349 后改用正常 schemas）
- **核实理由：** 346-349 换成宽松 codec 来存坏记录；381-404 手写悬空指针和 activeRevision:null 的指针，src 根本没有 CoordinationPolicy 写者。533-535 改动读回事件里的 actor，而身份键本身含 actor（command-event.ts:99-103，role-memory-service.ts:133,136），真实输入走不到这一步。三处都只有改库才能到。
- **涉及测试：** verified absence differs from corrupt role governance; review replay rejects an event attributed to another actor
- 来源：Codex；核实：confirmed；规格行：否；估计行数：69
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/R3g-role-spec.test.ts:346; tests/work-graph/R3g-role-spec.test.ts:381; tests/work-graph/R3g-role-spec.test.ts:506（指定三处篡改段仍在。）

### T1-029 · A1-40 · handwritten · tests/work-graph/R4b-session-boundaries.test.ts:194-219;238-258
- **动作：** convert:adoptInitialArchitecture（目录含 needle-module 和 601 个模块）→ admitSessionCreation/recordSessionCreated → linkSessionWork；第一条只需建被链接的那个 Session
- **覆盖/依据：** 保留原文件 231、259-261 的断言；601 条链接边界要保留；1001 个 Session 的边界在带 target 的查询里已经不经过（session-directory.ts:1486-1501 走 findSessionsByTarget，1362-1363 写明不枚举无关 Session，MAX_DIRECTORY_SCAN 只用于 1504 起的非 target 路径），不必用公开步骤造 1000 个陪衬 Session
- **核实理由：** 194-219、238-258 确实直接写 Session/WorkLink，公开步骤存在且没有链接数上限（session-lifecycle.ts:342-438，模块目标经 session-targets.ts:138-142 校验当前目录）。但原记录要求“不得降低 1001 边界”，这一点不对：带 target 的 findSessions 根本不扫目录，照搬 1001 个公开 Session 要多出约 2000 次提交，又测不到边界。
- **涉及测试：** keeps the matching Session at candidate 1001 visible after a bounded directory scan; never presents a Session card with a silently truncated set of 601 persisted links
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：50
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：直接recordSessionCreated仍由测试写入Runtime登记事实（tests/work-graph/R4b-session-boundaries.test.ts:83、:87；src/core/agent-runtime/session-operations.ts:542）。 改法：公开初始化scope和架构后，由createSessionOperations的createSession创建真实Session，再以返回身份建立链接。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/R4b-session-boundaries.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/R4b-session-boundaries.test.ts:192; tests/work-graph/R4b-session-boundaries.test.ts:238（使用真实 Session 创建及公开链接，不能直接登记事实。）

### T1-030 · A1-49 · handwritten · tests/work-graph/R4b-session-boundaries.test.ts:113-148
- **动作：** convert:admitSessionCreation（role 用 specRole / otherRole）+ recordSessionCreated，断言改成按两条 plannedSessionRef 比较
- **覆盖/依据：** 同文件 :77-88、:98-104 已用 admitSessionCreation + recordSessionCreated（不是 :149-160，那条本身也是手写提交）
- **核实理由：** R4b-session-boundaries.test.ts:120-141 手写两条没有 provenance 字段的 SessionRecord，再配假的 TrustedScopeSeeded 提交；admitSessionCreation 对 role_spec 只查形状和 project（session-record-codecs.ts:198-211、session-directory.ts:233-238），不读 RoleSpecRevision，所以任意 digest 都能经公开步骤建出来；只是 DSH 引的 :149-160 行号不对。
- **涉及测试：** finds a role_spec Session by the digest on its pin
- 来源：DSH；核实：partly；规格行：否；估计行数：25
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：直接登记Session不符合F3（.lead-ref/books/t-items-T1.md:209；src/core/agent-runtime/session-operations.ts:542）。 改法：两种role分别通过Session Runtime创建，按完成回执中的真实Session ref断言过滤结果；与T1-029共用公开初始化。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/R4b-session-boundaries.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/R4b-session-boundaries.test.ts:113（两类 role 经真实 Runtime 创建，按返回身份验证过滤。）

### T1-031 · A1-39 · handwritten · tests/work-graph/R4b-session-directory.test.ts:104-142
- **动作：** convert:createGoal → proposePlan → applyPlanChange（schemas 的 lookups 补 PLAN_RECORD_SCHEMAS.lookups）
- **覆盖/依据：** 保留原文件 225 起的 initial link cursor 断言和 250 起的不存在 Task 拒绝
- **核实理由：** seedAcceptedTask（R4b-session-directory.test.ts:104-142）手写 Goal r1、Goal r2 带 activePlanRevision 和 v1 PlanRevision，调用在 228、253 行。同样的治理种子下，公开的 createGoal/proposePlan/applyPlanChange 能写出同样的状态（R3c-plan-adoption.test.ts:110-140 就是这样走通的）。
- **涉及测试：** seedAcceptedTask; binds an initial work link to the actual Session registration commit cursor; rejects a Task link absent from the active accepted Plan
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：39
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：原治理种子仍为原始提交，不能作为A1前置（tests/work-graph/R4b-session-directory.test.ts:85、:92）。 改法：open中的scope和治理一并改为公开bootstrap、policy激活及初始架构；Session由真实Runtime创建；随后执行Goal和Plan转换并补齐schemas。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/R4b-session-directory.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/R4b-session-directory.test.ts:107; tests/work-graph/R4b-session-directory.test.ts:114; tests/work-graph/R4b-session-directory.test.ts:142（保留已有公开 createGoal，转换其余 scope、治理、Plan、Session。）

### T1-032 · A1-54 · tamper · tests/work-graph/R4c-execution-history-index.test.ts:763-775;934-960
- **动作：** delete
- **覆盖/依据：** 只靠篡改才能触发（AGENTS.md:33）；正常重放见同文件 551-569，重开保留见 983-1009，真实存储失败回滚见 962-981。
- **核实理由：** 两条都只靠篡改：768-769 在读取时把已存 locator 改成 0（写入口 517、codec 330 都拒绝 0），950-952 用 SQL 直接改事件里的 runRevision，确实可删。但删掉以后 218-236 的 mutateRecord 和第 24 行 seqOfCommitCursor 导入就没人用了，要一起删，行数约 61，不是 40。
- **涉及测试：** reports a malformed stored locator as unavailable; rejects replay when the stored event Run revision disagrees with the committed receipt
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：61
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/R4c-execution-history-index.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/R4c-execution-history-index.test.ts:788; tests/work-graph/R4c-execution-history-index.test.ts:956（删除两处篡改例及孤立 helper/import。）

### T1-033 · A1-09 · stale · tests/work-graph/S1-codecs-indexes.test.ts:275-300
- **动作：** delete（规格行 SV01，lead 要给 slice-1-SPEC.md:954 加后注）
- **覆盖/依据：** Session/Operation 缺 provenance 才是旧格式：当前写入总会带 provenance（session-directory.ts:792、977）。其余几项是当前的形状，已有别处覆盖：Session 不带 archiveRequest（session-availability.ts:330-346）由 tests/work-graph/A2-step1-codecs.test.ts:686-687 覆盖；Message 不带 replyHandler/archiveWaitDisposition 由 tests/state/S5-message-decision.test.ts:124 覆盖；brief 不带 anomalies 也是当前写法（continuation-brief-assembly.ts:951），字面摘要只保护旧库里存的摘要，按决定 79-1 不用保。
- **核实理由：** 说 SV01 整条都是旧格式不对：只有 provenance 的默认值是旧格式；archiveRequest、replyHandler、disposition 缺省和 brief 不带 anomalies 都是当前写入的形状，只是另有测试覆盖，所以仍然可以删。删掉后 97-149 的 OLD_* 字面量、156-164 的 old*Encoding 和相关导入也没人用了，行数约 90。
- **涉及测试：** SV01
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：90
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/state/S5-message-decision.test.ts, tests/work-graph/A2-step1-codecs.test.ts, tests/work-graph/S1-codecs-indexes.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S1-codecs-indexes.test.ts:255（provenance 部分已不在；剩余 SV01 段仍按原动作删除。）

### T1-034 · A1-10 · stale · tests/work-graph/S1-codecs-indexes.test.ts:384-453
- **动作：** delete（规格行 SV03，按重复处理，lead 要给 slice-1-SPEC.md:956 加后注）
- **覆盖/依据：** 内存这一半和同文件 SV02 重复（354-357 用 IDX-S2 查真实 claim 的 outbox）；SQLite 重开这一半是存储层通用行为，已由 tests/record-store/SP-lookup-index-migration.test.ts::SP-41 和 tests/record-store/S2C-count-lookup.test.ts::2C-08 覆盖。
- **核实理由：** 所谓“旧 Outbox 字节”其实就是当前格式：attempt-machine.ts:288 今天写的就是 {ref,revision:1,schemaVersion:1,status:'pending',claim}，claim 的字段也和 task-claim.ts:15-26 完全一样。只有“先在没有 IDX-S2 的 schema 下写库再重开”算旧库，而这个机制别处已经测了。所以删的理由应该是重复，不是过时。删掉后 221-268 的辅助函数和 20-33 的几行导入也要一起删，行数约 125。
- **涉及测试：** SV03
- 来源：Codex；核实：partly；规格行：是；估计行数：125
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/S1-codecs-indexes.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S1-codecs-indexes.test.ts:348（SV03 旧 outbox 索引迁移段仍在。）

### T1-036 · A2-03 · stale · tests/work-graph/S2B-r2-keyed-cap.test.ts:61-77
- **动作：** delete（S2B-r2-keyed-cap.test.ts:61-77；与 activity-read-helpers.ts:182 派工记录缺失回 null 的旧执行分支同批删，R7 头注 :2-5 去掉 dispatch miss）
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）；slice-2B-SPEC.md:435 L17 自称派工记录缺失是“旧执行”；同文件 :21-59 的 activity/epoch miss 用例保留
- **核实理由：** claimTask 的 task_claimed 效果把 create_run 和 create_outbox 放在同一提交（task-machine.ts:930-931、claim-service.ts:458-468），当前写者造不出“Run 在、派工记录不在”，只有 seedActivityRun 手写（S2B-r2-activity-support.ts:48-73）；R7 是第二轮返工编号、不是冻结表行，按 79-1 删掉而非 keep-note。
- **涉及测试：** R7 readActivityCalendar charges an absent dispatch claim for an unplaced Run
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：17
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：只删缺记录return null会向解码器传undefined（src/core/work-graph/views/activity-read-helpers.ts:116、:182、:183；src/core/work-graph/tasks/claim-record-codecs.ts:279）。 改法：缺记录时明确抛出unavailable并包含dispatch ref key；保持签名、解码和下游接口，其余按条目删除旧执行测试及头注。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S2B-r2-keyed-cap.test.ts:61; src/core/work-graph/views/activity-read-helpers.ts:182（缺记录明确抛 unavailable 并带 ref，不能仅删 return null。）

### T1-037 · A2-19 · duplicate · tests/work-graph/S2C-lines-attention.test.ts:216-235
- **动作：** merge-into:tests/work-graph/S2C-lines-tiers.test.ts::2C-03 (3) an INCONCLUSIVE formal round puts the line in the blocked tier（把 own==='standby' 一句并入）
- **覆盖/依据：** tests/work-graph/S2C-lines-tiers.test.ts::2C-03 (3) an INCONCLUSIVE formal round puts the line in the blocked tier
- **核实理由：** 同一 openLineFixture、同样的建目标、领取、进入、记结果、开轮、取消检查、finalize 步骤（S2C-lines-attention.test.ts:217-229 与 S2C-lines-tiers.test.ts:156-168），同样断 attention.code blocked、reason.code round_inconclusive；只差 own 对 bucket 一句，合并即可。
- **涉及测试：** 2C-12 (9) an INCONCLUSIVE formal check is the block round_inconclusive attention
- 来源：DSH；核实：confirmed；规格行：是；估计行数：20
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/S2C-lines-attention.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S2C-lines-attention.test.ts:216; tests/work-graph/S2C-lines-tiers.test.ts:156（迁 own=standby 断言后删重复例。）

### T1-038 · A2-39 · tamper · tests/work-graph/S2C-lines-failure.test.ts:173-184
- **动作：** delete S2C-lines-failure.test.ts:173-184 (B4 坏 schema) 与 corruptLookupSchema :45-55；delete :186-197 (2C-14/L11 T5x) 与 endedRunRead :40-43；RD-8 :199-221 不按规则 4 删：convert 为提交替身在读 Session 之后、读 TaskLease 之前经真实 claimTask(consumedWait) 领取接续，或由 lead 定按琐碎删；rewriteRead :23-38 随 RD-8 改写一起去掉
- **覆盖/依据：** B4 坏 schema：只为篡改（AGENTS 4；slice-2C-SPEC.md:1278 不改存下的记录），冻结 2C-14 的 B4 由 S2C-lines-d1.test.ts:90 与本文件 :122 的注入读失败覆盖；T5x：slice-2C-SPEC.md:1053 写明防御、不要求测试；RD-8：推导由 tests/state/S2C-line-status.test.ts:200 覆盖，真实 RD-8 控制由 tests/scenarios/A7-control.test.ts:451 覆盖
- **核实理由：** B4 坏 schema（:173-184）和 T5x（:186-197）确实只靠改读回内容到达，slice-2C-SPEC.md:1278 禁止改存下的记录、:1053 写明 T5x 防御不要求测试，冻结 2C-14 的 B4 是注入读失败（:1312，测在 S2C-lines-d1.test.ts:90），所以 Codex 以“冻结 B4”保留站不住。但 RD-8（:199-221）里租约换了持有者，这是真实接续领取会写出的事实（claim-service.ts:352 要求同一 Session 接续，A7-control.test.ts:451-523 真实造过），只在读 Session 和读租约之间的竞态里才落到线行上，不属于规则 4 的篡改，应改用提交替身或按琐碎处理。
- **涉及测试：** 2C-14 (review item 2) an undecodable open responsible link marks the line B4, never no responsibility
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：45
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：转换或删除尚未定案，前置还手造等待消息和yielded结果（.lead-ref/books/t-items-T1.md:265；tests/work-graph/S2C-lines-failure.test.ts:206、:208）。 改法：固定convert：真实wait工具、真实回复、A3门控Session读与Lease读之间的真实接续claim；保留waiting_reply和pause/cancel busy断言；删除原伪造读及删除选项。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/scenarios/A7-control.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S2C-lines-failure.test.ts:173; tests/work-graph/S2C-lines-failure.test.ts:199（删篡改例；RD8 用真实等待/回复和 A3 接续门控转换，保留 busy。）

### T1-039 · A2-40 · trivial · tests/work-graph/S2C-lines-scale.test.ts:146-183
- **动作：** delete（连同只为它存在的计数仪器：tests/helpers/S2C-X-scale-fixture.ts:237-301 的 ReaderCall/countingRecords/S2C_UNLIMITED_BUDGET/countAcceptedCalls/measureBudgetedReads，以及 readerUnlimited :108、:496；slice-2C-SPEC.md:1587 和 LE5 :1289 加后注）
- **覆盖/依据：** 测量目的已完成：slice-2C-SPEC.md:112 已量定 LINE_HISTORY_READ_BUDGET = 100（§1587 只要求合入前打印一次）；tests/work-graph/S2C-lines-scale.test.ts::2C-25 (3) 断言默认预算下 R、W 读全（:100-113）
- **核实理由：** 这个用例只打印读数和耗时，唯一断言 m>0（S2C-lines-scale.test.ts:184）；它是规格 §1587 要的施工期测量，数已记进 §0.2（slice-2C-SPEC.md:112）。2C-25 (3)/(4) 断言的是预算行为，不做这项测量，所以覆盖说法要改成“测量已完成”；仪器函数 Grep 只有这一处用，要一起删，行数比 38 多。
- **涉及测试：** A2 measured on this build (printout, not asserted)
- 来源：DSH；核实：partly；规格行：否；估计行数：105
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S2C-X-scale-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S2C-lines-scale.test.ts:146; tests/helpers/S2C-X-scale-fixture.ts:219（删除测量例及专用计数包装。）

### T1-040 · A2-49 · handwritten · tests/work-graph/S2C-node-detail-anomalies.test.ts:96-160
- **动作：** convert 只限 :100-129 的非故障部分：用 fixture.claim→runs.enter→pauseAtSafePoint→reconcileInterrupt→writeAnchor（同 S2C-node-detail-next-kinds.test.ts:71-79）造锚点，再在同任务 claim+enter 一次造 pickedUpBy；:131-139 的 incomplete 替身和 :142-160 的分页/第二页失败替身是读失败注入，保留
- **覆盖/依据：** human_continue 显示：tests/work-graph/S2C-node-detail-next-kinds.test.ts::2C-28 the task display $name next equals ...（:113-150）
- **核实理由：** 前一段的显示、anomalies 列表、pickedUpBy 和目标精确计数可经真实服务造（tests/helpers/S2C-D-node-support.ts:377-394；src/core/work-graph/state/session-anomaly.ts:60-72），其中 human_continue 显示已由 next-kinds.test.ts:113-150 用真实服务覆盖；但 :131-139、:142-160 测的是锚点读口报 incomplete / 第二页失败时 anomalyCount 报 partial（slice-2C-SPEC.md:1326），只能靠端口注入，不是手写事实。
- **涉及测试：** 2C-28 the task anomaly facts, the goal count and the incomplete count / the goal anomaly count pages the index to the end
- 来源：DSH；核实：partly；规格行：是；估计行数：25
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：指定helper仍写Runtime/Host事实；pickedUpBy缺继续步骤；分页成功值及游标也是手造，不能归为失败注入（tests/helpers/S2C-D-node-support.ts:391；tests/helpers/S2C-L-runs-support.ts:167、:260；tests/work-graph/S2C-node-detail-anomalies.test.ts:83、:86、:117）。 改法：整项标BLOCKED，先冻结真实暂停、接管、归档及继续路径；真实产生101个锚点，成功页原样委托，仅第二页注入失败；runId改用真实claim身份。冻结前不执行部分删除。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S2C-D-node-support.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 解除整项 BLOCKED；沿真实路径产生 101 个锚点，身份来自公开读；成功页和游标原样委托，仅第二页注入失败。（位置：tests/work-graph/S2C-node-detail-anomalies.test.ts:97; tests/scenarios/S2C-K2-paused-archive.test.ts:46; tests/scenarios/S2C-K2-paused-archive.test.ts:66; tests/scenarios/S2C-K2-paused-archive.test.ts:91；说明：真实暂停、重启、归档和另一 Session 接续路径已有依据。）

### T1-041 · A2-07 · stale · tests/work-graph/S2C-node-detail-executions.test.ts:44-47
- **动作：** merge-into:tests/work-graph/S4C-node-notes.test.ts::RW-11 nodeReaderOf does not hide the missing notes read: an unwired dependency is unavailable（删 S2C-node-detail-executions.test.ts:34-36 和标题里的 notes not_available/slice_4，2C-29 只留执行读失败一半，规格 2C-29 行加后注）
- **覆盖/依据：** tests/work-graph/S4C-node-notes.test.ts::RW-11 nodeReaderOf does not hide the missing notes read（:106-116，:115 同一字面）；真实接线由同文件 R-02（:34-104）断言
- **核实理由：** 核心属实：生产只在 create-platform.ts:2215-2223 构造 node detail 且一定传 notes，node-detail-reader.ts:966 的 not wired 只在测试不传时走到；规格 2C-29 行（slice-2C-SPEC.md:1327）的“注记一栏 not_available（第 4 片）”已被 4C 接线取代。但行号错了：notes 断言在 :34-36，DSH 写的 :44-47 是执行一半，应保留。
- **涉及测试：** 2C-29 notes say not_available/slice_4 and a failed Run read keeps its executions item with a problem
- 来源：DSH；核实：partly；规格行：是；估计行数：3
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S2C-node-detail-executions.test.ts:34; tests/work-graph/S2C-node-detail-executions.test.ts:44（只删 notes 缺失断言，保留 execution 断言。）

### T1-042 · A2-16 · duplicate · tests/work-graph/S4A-note-history.test.ts:464-489
- **动作：** merge-into:tests/work-graph/S4A-note-write.test.ts::N-08 %s accepting a pending general note on a goal anchor leaves the pointer
- **覆盖/依据：** tests/work-graph/S4A-note-write.test.ts:481-523::N-08 %s accepting a pending general note on a goal anchor leaves the pointer（Case B 在 502-521）
- **核实理由：** 两边用的是同一个 createS4ANoteFixture，步骤顺序也一样：agent 写 u1，用户写 seed，agent 替换 seed 得到 pending_review，然后接受（S4A-note-history.test.ts:468-481 对 S4A-note-write.test.ts:504-514）。history 里断言的 pointer={u1,1} 和 storedState=accepted（484、487），write 里都有（517、520），还多断言了 version 1 和 Case A。整个 describe 块在 463-490，共 28 行。
- **涉及测试：** N-08 %s accepting a pending general note on a goal anchor leaves the pointer
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：28
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4A-note-history.test.ts:464; tests/work-graph/S4A-note-write.test.ts:481（原合并动作仍适用。）

### T1-043 · A2-17 · duplicate · tests/work-graph/S4A-note-history.test.ts:493-513
- **动作：** merge-into:tests/work-graph/S4A-note-write.test.ts::N-10 accepting a pending note supersedes its current replaces targets
- **覆盖/依据：** tests/work-graph/S4A-note-write.test.ts:699-735::N-10 accepting a pending note supersedes its current replaces targets
- **核实理由：** S4A-note-history.test.ts:502/505/508/511 断言的 pending_review+user_note_replaced、收下前 accepted、收下 done/accepted、收下后 superseded，在 S4A-note-write.test.ts:714/717/721/724 用同一 S4A 夹具、同样 KINDS 全部断言了，保留端还多验 version 2 和 withdrawn 目标；N-06 规格行（slice-4-SPEC.md:615）行为仍在，所以合并时要把 N-06 标记带进去。行数连 describe 外壳约 23 行。
- **涉及测试：** N-06 %s accepting a pending replacement supersedes its target in that commit
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：23
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4A-note-history.test.ts:493; tests/work-graph/S4A-note-write.test.ts:699（合并并保留 N06 标识。）

### T1-044 · A2-23 · duplicate · tests/work-graph/S4B-memory-not-found.test.ts:17-27
- **动作：** merge-into:tests/work-graph/S4B-memory-not-found.test.ts::M-16 %s: a missing module anchor with no head is not_found anchor_not_found（把 MF9 的 anchorCandidates 断言 S4B-memory-anchor-not-found.test.ts:54-60 并入 M-16，模块 id 改用 A2；删 MF9 的 module lookup 用例 :45-62）
- **覆盖/依据：** tests/work-graph/S4B-memory-not-found.test.ts::M-16 %s: a missing module anchor with no head is not_found anchor_not_found（并入候选断言后）
- **核实理由：** 重复成立：M-16（S4B-memory-not-found.test.ts:17-27）与 MF9（S4B-memory-anchor-not-found.test.ts:45-62）同夹具、同 memoryLookup、同 not_found/anchor_not_found，MF9 多断候选；但 M-16 用的是 'NO_SUCH_MODULE' 不是 A2。M-16 是冻结规格行（slice-4-SPEC.md:658，且该行要求带 anchorCandidates），MF9 只是 4B 返工条目号，应保留 M-16 名字、把候选断言并进去，删 MF9 那一例。
- **涉及测试：** M-16 a missing module anchor with no head is not_found anchor_not_found
- 来源：DSH；核实：partly；规格行：是；估计行数：18
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4B-memory-anchor-not-found.test.ts:45; tests/work-graph/S4B-memory-not-found.test.ts:17（合入目标时保留 A2 身份和 candidates 断言。）

### T1-045 · A2-14 · stale · tests/work-graph/S4B-memory-version-lists.test.ts:77-81
- **动作：** delete
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-569（79-1）；本文件51-75::M-10 three plan versions 覆盖当前原因、时间和顺序
- **核实理由：** S4B-memory-version-lists.test.ts:81 是 it.skip 空壳，不执行任何断言；77-80 自己写明公开步骤造不出没原因的计划版本，M-10 行（slice-4-SPEC.md:652）这一半只对应旧数据。生产里的兜底 PLAN_REASON_MISSING_LABEL（src/core/work-graph/notes/note-version-lists.ts:30,117）还在，归生产区按 79-1 另看。
- **涉及测试：** M-10 an old plan version without a recorded reason shows the missing label
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：5
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4B-memory-version-lists.test.ts:81（旧 reason skip 仍在。）

### T1-046 · A2-21 · duplicate · tests/work-graph/S4B-memory-version-lists.test.ts:102-131
- **动作：** merge-into:tests/work-graph/S8A-catalog-version-time.test.ts::binds the revised record to its event cursor so the list shows that event time and reason
- **覆盖/依据：** tests/work-graph/S8A-catalog-version-time.test.ts:21-66::binds the revised record to its event cursor so the list shows that event time and reason
- **核实理由：** 两边都走 platform.notes.listCatalogVersions（S4B 夹具 catalogVersions 就是 holder.listCatalogVersions，tests/helpers/S4B-note-check-fixture.ts:157）；S4B 117/122-124/127-129 的修订号、原因、旧项 null 和标签，S8A 50/52/58/63-65 都断言了，时间还用前后时间夹住，更强。只缺 S4B:125 最新项的 reasonLabel，要迁入；合并后的测试名要带上 M-10 标记。
- **涉及测试：** M-10 %s: two catalog versions list newest first with the 8A reason label
- 来源：Codex；核实：confirmed；规格行：是；估计行数：30
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4B-memory-version-lists.test.ts:102; tests/work-graph/S8A-catalog-version-time.test.ts:21（迁 newest reasonLabel 断言并保留 M10。）

### T1-047 · A2-24 · duplicate · tests/work-graph/S4B-note-anchor-status.test.ts:122-134
- **动作：** delete:tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4 %s: a renamed symbol is still symbol_missing（:73-84；保留 M-15）
- **覆盖/依据：** tests/work-graph/S4B-note-anchor-status.test.ts::M-15 %s: a symbol that no longer resolves retires the note for symbol_missing
- **核实理由：** 两例逐字相同：S4B-note-anchor-status.test.ts:122-134 与 S4B-note-symbol-recheck.test.ts:73-84 都写 src/a/x.ts 的符号 a、改成 'export const renamed = 1'、断 retired 且含 symbol_missing。M-15 是冻结规格行（slice-4-SPEC.md:657），MF4 是返工条目号，方向应反过来：删 MF4 那一例、留 M-15。
- **涉及测试：** M-15 a symbol that no longer resolves retires the note for symbol_missing
- 来源：DSH；核实：partly；规格行：是；估计行数：12
- **第一批之后已不存在的文件：** src/a/x.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4B-note-symbol-recheck.test.ts:73; tests/work-graph/S4B-note-anchor-status.test.ts:122; tests/helpers/S4A-note-scope-fixture.ts:105（重复仍成立；src/a/x.ts 是临时夹具文件，不是 GONE。）

### T1-048 · A2-26 · duplicate · tests/work-graph/S4B-note-freshness.test.ts:54-70
- **动作：** merge-into:tests/work-graph/S4B-note-budget-check.test.ts::M-14 %s: a message fact that cannot be read is sourceUnavailable and the item remains
- **覆盖/依据：** tests/work-graph/S4B-note-budget-check.test.ts::M-14 %s: a message fact that cannot be read is sourceUnavailable and the item remains
- **核实理由：** M-05（S4B-note-freshness.test.ts:54-70）与 M-14（S4B-note-budget-check.test.ts:127-144）同夹具、同一条读不到的 SessionMessage 事实，M-14 经 readNote 和 checkNotes 断 sourceUnavailable 与 currentEligible false；readNote 和 listByAnchor 都走同一个 withCheck（note-read-model.ts:2139、:2192）。M-05 独有的只是 listByAnchor 页里仍有该项（:62-67），合并时带上这条断言并让测试名带 M-05（两者都是规格行 slice-4-SPEC.md:647、:656）。
- **涉及测试：** M-05 an unreadable message fact is sourceUnavailable and the note is still returned
- 来源：DSH；核实：confirmed；规格行：是；估计行数：17
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4B-note-freshness.test.ts:54; tests/work-graph/S4B-note-budget-check.test.ts:127（保留 listByAnchor 断言及 M05/M14 标识。）

### T1-049 · A2-18 · duplicate · tests/work-graph/S4C-note-protection.test.ts:257-268
- **动作：** merge-into:tests/work-graph/S4C2-D-rows.test.ts::D-16 %s: a replaced user note also in coexistWith is admitted directly, no card
- **覆盖/依据：** tests/work-graph/S4C2-D-rows.test.ts:274-286::D-16 %s: a replaced user note also in coexistWith is admitted directly, no card
- **核实理由：** S4C-note-protection.test.ts:264-266 的 accepted/reasons []、用户注记仍 accepted、新注记 coexistWith，S4C2-D-rows.test.ts:281-284 用同一个 S4A 写入路径全部断言了，还多验 replaces 和没出卡（285），符合 D-16 行（slice-4-SPEC.md:931）。差别只在锚点（文件锚和目标锚）和注记种类，D-16 规则跟锚点无关，迁不迁成参数都行。
- **涉及测试：** D-16 %s: the write is accepted directly with no user reason
- 来源：Codex；核实：confirmed；规格行：是；估计行数：14
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：是否参数化仍未定案（.lead-ref/books/t-items-T1.md:344）。 改法：固定参数化合并，保留目标现有组合及源文件锚组合，两组都执行全部保留断言后删除源用例。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4C-note-protection.test.ts:257; tests/work-graph/S4C2-D-rows.test.ts:274（按改正固定参数化两组组合。）

### T1-050 · A2-28 · duplicate · tests/work-graph/S4C-note-protection.test.ts:287-311
- **动作：** merge-into:tests/work-graph/S4C-resolution-order.test.ts::RW-8 order review/reject %s: resolution_not_applicable even when the target read fails
- **覆盖/依据：** tests/work-graph/S4C-resolution-order.test.ts::RW-8 order review %s / RW-8 order reject %s
- **核实理由：** S4C-note-protection.test.ts:287-311 的 review/reject 两例与 S4C-resolution-order.test.ts:79-98 断同一 invalid/resolution_not_applicable；生产只有一处判断（note-service.ts:1644-1646），不分用户或书记，且在任何读目标和写入之前返回，所以 protection 多断的 storedState 不变是必然结果。order 版还用 readMany 封锁证明先后，更强；RW-8 是返工条目号，不是规格表行。
- **涉及测试：** RW-8 review/reject resolution_not_applicable
- 来源：DSH；核实：confirmed；规格行：是；估计行数：25
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标缺状态不变断言，且review前置为pending而源为accepted（tests/work-graph/S4C-resolution-order.test.ts:73、:83；tests/work-graph/S4C-note-protection.test.ts:295、:308）。 改法：把源accepted-review和pending-reject两组输入及状态不变断言完整迁入目标文件，保留目标原顺序检查，再删除源段。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4C-note-protection.test.ts:287; tests/work-graph/S4C-resolution-order.test.ts:79（完整迁 accepted-review、pending-reject 及状态不变断言。）

### T1-051 · A2-29 · duplicate · tests/work-graph/S4C-project-understanding.test.ts:40-62
- **动作：** merge-into:tests/work-graph/S4C-project-understanding.test.ts::PU-02（把 DS-07 的 find 一半 :50-54 并入，测试名带 DS-07）
- **覆盖/依据：** tests/work-graph/S4C-project-understanding.test.ts::PU-02 %s: a g2 work Run lookup {kind:project} returns the pointer...
- **核实理由：** DS-07（S4C-project-understanding.test.ts:40-62）的 lookup 一半被 PU-02 :83-96 覆盖且 PU-02 断得更多（pointer、currentEligible、crossGoal）；DS-07 独有 g2 的 memoryFind 一半（:50-54），DSH 已注明。两者都是规格行（slice-4-SPEC.md:928、:929），合并后测试名要同时带 DS-07 和 PU-02。
- **涉及测试：** DS-07 project understanding visibility
- 来源：DSH；核实：confirmed；规格行：是；估计行数：23
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4C-project-understanding.test.ts:40; tests/work-graph/S4C-project-understanding.test.ts:65（合入 PU02，保留 find 和 DS07。）

### T1-052 · A2-30 · duplicate · tests/work-graph/S4C2-D-rows.test.ts:100-120
- **动作：** merge-into:tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede: the note replaces the target and the target becomes superseded（D-06 去掉 :114-120 的 supersede 尾段，保留待审与三选项断言）
- **覆盖/依据：** tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede: the note replaces the target and the target becomes superseded
- **核实理由：** D-06（S4C2-D-rows.test.ts:100-120）与 D-17 supersede（S4C2-D17.test.ts:53-71）同夹具、同 replaces 种子、同 resolve('supersede')，都断 v2 accepted、replaces [userId]、目标 superseded，D-17 还多断 contradicts/coexistWith 和卡消失。小错：D-06 并没有断卡消失。去掉 D-06 尾部 7 行、留它的三选项断言（:110-112）即可，两条规格行（slice-4-SPEC.md:931）仍各有测试。
- **涉及测试：** D-06 %s: replacing the user note is pending, opens the three-option card and supersedes it；D-17 %s supersede: the note replaces the target and the target becomes superseded
- 来源：DSH；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4C2-D-rows.test.ts:110; tests/work-graph/S4C2-D-rows.test.ts:114（只删尾部 supersede 重复段，保留 pending options。）

### T1-053 · A2-34 · handwritten · tests/work-graph/S4C2-U3.test.ts:47-108
- **动作：** convert：在 S4C2 注记卡夹具里造两张待审注记卡 A、B；A 只经 decisionMessages.answerDecision 答复，B 经 f.resolve 答复并应用，拿 B 的正式 NoteDispositionChanged 回执（带 proof、acknowledgementRef 是 B 的答复）；再调 recordDecisionApplication(A 的答复, B 的回执)，断言 rejected/invalid；删掉 :47-94 的手拼事件和单独内存库
- **覆盖/依据：** 原 invalid 断言保留；:111-178 的 ordinary disposition→incomplete 行不动
- **核实理由：** 被测的检查是 proof.acknowledgementRef 不等于这次答复（src/core/work-graph/communication/decision-application.ts:153-154），而 recordDecisionApplication 收的是调用方给的 receipt（decision-service.ts:1039-1074），把另一张卡的真实回执交进来就能走到，正式回执的 proof 由 note-service.ts:845-869 真实写出，不需要伪造记录，所以 DSH 说的“没有公开步骤”不成立；slice-4-SPEC.md:1110 只是当时验收接受这一处伪造，不是要求保留。
- **涉及测试：** rejects a forged proof whose acknowledgementRef names another answer as invalid
- 来源：冲突裁定（采用 codex）；核实：refuted；规格行：是；估计行数：62
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：卡夹具的Session前置自行写Kernel store并登记事实（tests/helpers/S4C2-note-card-fixture.ts:271；tests/helpers/S4A-note-scope-fixture.ts:250、:253）。 改法：先将S4A-note-scope-fixture的Session创建改为真实Session Runtime入口，再执行两卡跨回执拒绝方案并检查A公开读不变。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4C2-U3.test.ts:47; tests/helpers/S4A-note-scope-fixture.ts:250（真实 Session 前置后，用 B 的真实回执申请 A；检查拒绝及 A 公开读不变。）

### T1-054 · A2-55 · handwritten · tests/work-graph/S4C2-goal-triggers.test.ts:92-198
- **动作：** 不整体 convert：S4C2-3d 可删（会丢的只有“带 archiveOrigin 时不再出 rework:t1/run-2”这一条字面断言）；S4C2-3a、3b、3c、3e、3h 保留为 §11.5 三步读法的读者测试
- **覆盖/依据：** 3d：tests/work-graph/S4C2-update-due.test.ts::M-12a/c（rework 键）、tests/app/S4C2-scribe-reminders.test.ts::S4C2 missed 2: a public archive ... is immediate（archive 键）和 ::S4C2 D-03 claimed archive requeue（认领过滤）
- **核实理由：** 记录确是手写 JSON 加假 lookup（S4C2-goal-triggers.test.ts:57-70、:94-110），T3、T4、archive 和认领过滤都已有公开流程（S4C2-update-due.test.ts:119-128、:149-188；S4C2-scribe-reminders.test.ts:827-829、:884-909）；但 DSH 指的“计划采用+startRun/requeueTask”造不出 3a/3b 的 TaskReduction（要走整条验证链到 completeTask），3c 的“setIn 是更早计划”要连续三次采用且无现成覆盖，3e plan===null、3h 对未结束 Run 的 requeue 没有公开步骤能造。
- **涉及测试：** S4C2-3a: T1 reads a satisfied TaskReduction as task_end#r<revision> at reducedAt；S4C2-3b: a TaskReduction that is not satisfied produces no task_end；S4C2-3c: T2 uses the FIRST terminal source plan acceptedAt when setIn is an older plan；S4C2-3d: T3 makes one rework trigger per requeue; archiveOrigin replaces it with archive；S4C2-3e: plan === null drops T1/T2/T4 but still builds T3；S4C2-3h: a requeue key is only built for ended Runs
- 来源：DSH；核实：partly；规格行：否；估计行数：21
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：读者测试名称不能豁免手造事实；删除3d会失去archive/rework互斥断言，而生产规则仍存在（tests/work-graph/S4C2-goal-triggers.test.ts:173、:183、:192；src/core/work-graph/tasks/plan-readers.ts:1417）。 改法：整项标BLOCKED并保留全部现有子例，取消3d删除；先冻结3a、3c及archive/rework互斥的真实替代流程；3b/e/h未有合规路径前单列BLOCKED。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/S4C2-goal-triggers.test.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 3a 转真实完成链，3c 转连续真实 Plan 采用，3d 转真实 requeue/archive 并保留互斥和 claimed 断言；按 R4 删除 3b/e/h，保留生产过滤。（位置：tests/work-graph/S4C2-goal-triggers.test.ts:116; tests/work-graph/S4C2-goal-triggers.test.ts:129; tests/work-graph/S4C2-goal-triggers.test.ts:181; tests/work-graph/S4C2-goal-triggers.test.ts:190; src/core/work-graph/state/task-machine.ts:487; src/core/work-graph/state/task-machine.ts:1172; src/core/work-graph/tasks/plan-readers.ts:1390；说明：旧整项 BLOCKED 不再适用；部分行依赖不可达持久状态。）

### T1-055 · A2-44 · trivial · tests/work-graph/S4C2-project-set-shared.test.ts:197-229
- **动作：** merge-into:tests/work-graph/S4C2-project-set-shared.test.ts::item 3 %s: the Goal-card work material reads the project set once (5, not 10)
- **覆盖/依据：** tests/work-graph/S4C2-project-set-shared.test.ts::item 3 %s: the Goal-card work material...（:160-195）；includeInputs:false 跳过通用部分见 tests/work-graph/S4C2-memory-material.test.ts:338-351
- **核实理由：** 两个用例用同一个 seed，断言同样的 state.project=5 和 projectRow/norm（:183-191 对 :218-225）。项目集只在 selectProjectHeader 里读一次（note-read-model.ts:1953），这一步在 includeInputs 分支（:1962）之前，两条路径走同一段代码，所以 query 下的计数没有单独的回归风险。
- **涉及测试：** item 3 %s: the Goal-card query material reads the project set once (5, not 10)
- 来源：DSH；核实：confirmed；规格行：否；估计行数：33
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S4C2-project-set-shared.test.ts:197; tests/work-graph/S4C2-project-set-shared.test.ts:160（重复 query 例并入 work 例。）

### T1-056 · A2-33 · duplicate · tests/work-graph/S5R2-queue-history.test.ts:141-149
- **动作：** merge-into:tests/work-graph/S5R2-queue-history.test.ts::R2A07 - an unfiltered Workspace queue over 201 Goals is read, not refused
- **覆盖/依据：** tests/work-graph/S5R2-queue-history.test.ts::R2A07
- **核实理由：** R2A08 只断 200 个 Goal 时 ready 且存储不变（S5R2-queue-history.test.ts:141-149）；R2A07 在 201 个时断 ready、存储不变，另加分配计数和模型调用（:127-139），是超集。R2A08 原来钉的是 200 上限的边界（slice-5-round2-TESTS.md:36），2A 已去掉这个上限（slice-2A-SPEC.md:202），所以行为已不存在，并入后不丢东西。
- **涉及测试：** R2A08 - exactly 200 Goals remain inside the Workspace queue limit
- 来源：DSH；核实：confirmed；规格行：是；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S5R2-queue-history.test.ts:141; tests/work-graph/S5R2-queue-history.test.ts:127（200 条例并入 201 条边界例。）

### T1-057 · A2-20 · duplicate · tests/work-graph/S8A-L8-reminders-pure.test.ts:130-169
- **动作：** merge-into:tests/work-graph/S8A-L8-reminders-public.test.ts::renders the four literal rows in order after two real captures (%s)（删 S8A-L8-reminders-pure.test.ts:130-137、139-146、148-161、163-169 四条；171-175 的 catalog=null 空行和 T25 起的各行保留）
- **覆盖/依据：** tests/work-graph/S8A-L8-reminders-public.test.ts:54-70（四行）、:97-117（10 行加省略行）、:120-135（，不确定）、:138-149（还没有观测）
- **核实理由：** public 文件经真抓取和 prepareExecution、两个后端，断言与纯文件逐字相同：四行（public :26-31、66 对 pure :131-136）、省略行（:110-113 对 :157-160）、，不确定（:129-131 对 :143-145）、还没有观测（:144-145 对 :164-168）；A-03 行（slice-8-SPEC.md:415）由 public 文件钉住，纯文件不是另一张冻结规则表，保留业务流那份。DSH 配的第四对不成立：public :152-166 是有目录的干净观测，pure :171-175 是 catalog=null、taskModuleRef=null，后者要保留，Codex 已排除它。
- **涉及测试：** A-03: the four rows in kind order, each with the 3-hour observation time; an unknown dependency finding ends with ，不确定; caps at 10 rows and adds 另有 N 条架构提醒没列出; no successful observation -> 还没有观测
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：38
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S8A-L8-reminders-pure.test.ts:130; tests/work-graph/S8A-L8-reminders-pure.test.ts:171（只删指定四例，保留未指定纯例。）

### T1-058 · A2-37 · handwritten · tests/work-graph/S8A-file-layer.test.ts:101-112
- **动作：** convert:createProjectBootstrapServices({records,now,eventId}).projects.createProject→registerWorkspace（schemas加PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events）
- **覆盖/依据：** 原S8A文件层业务测试全部保留，仅替换初始化。
- **核实理由：** S8A-file-layer.test.ts:101-112手写Project/Workspace快照并自造TrustedArchitectureScopeSeeded事件；createProject(project-bootstrap-service.ts:528,574)和registerWorkspace(601,668)写出的正是同样的{ref,revision:1}快照，测试的上下文是host+human(44-47)，满足bindContext(162-175)，S2B-track-fixture.ts:268已这样用。另外fixture返回的commit/readRecord/readBody(119-132)在本文件没人调用，换完后94-95的自造事件schema也可去掉。
- **涉及测试：** S8A文件层测试共享scope初始化
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S8A-file-layer.test.ts:103（原始 scope 前置仍在，改公开 bootstrap/register 并补 schemas。）

### T1-059 · A2-19 · duplicate · tests/work-graph/S8A-path-ownership-dedupe.test.ts:18-28
- **动作：** merge-into:tests/work-graph/S4C-note-path-ownership.test.ts::RW-13（删 S8A-06b，保留 S8A-06a）
- **覆盖/依据：** tests/work-graph/S4C-note-path-ownership.test.ts::RW-13（:44、:50、:57、:62）
- **核实理由：** S8A-06b 的四个断言跟 RW-13 的 :50、:44、:57、:62 输入和期望逐条相同；06a（S8A-path-ownership-dedupe.test.ts:13-16）证明 note-path-ownership 导出的就是 canonical 那个函数。DSH 引的 S8A-02a/b 和 formal-comparison 只经 mapArchitectureSource / compareFormalObservedGraphs 间接测，也不含“空路径 → none”。S8A-06 是任务书条目，slices 规格里查不到这个行号，所以应该删，不是只加注。
- **涉及测试：** S8A-06b the canonical decision keeps the 4C-1/8A semantics
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：11
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/S8A-path-ownership-dedupe.test.ts:18; tests/work-graph/S4C-note-path-ownership.test.ts:44（删除 06b，保留身份去重及公开路径归属覆盖。）

### T1-060 · A2-46 · trivial · tests/work-graph/SP-memory-history-confirm.test.ts:75-84
- **动作：** delete
- **覆盖/依据：** 行为不可达：src/core/work-graph/state/note-machine.ts:408-436（accept/reject 只能从 pending_review 出发，review 只能从 accepted，supersede 只能从 accepted|reviewed，staged 只能 withdraw），一条注记最多到 v4；同文件 SP-13 四版本用例（:34-73）保留
- **核实理由：** 这是空的 it.skip（SP-memory-history-confirm.test.ts:82-84），没有断言。照 note-machine.ts:408-436 的守卫，最长链是 pending→accept→review→withdraw/supersede，到 v4 为止，没有其他会加版本的写法（bumped 只在 :450）。SP- 测试不是冻结行（slice-4-SPEC.md:932）。
- **涉及测试：** SP-13b a head version >= 5 with a confirmation at version 3 lists every confirmedByUser
- 来源：DSH；核实：confirmed；规格行：是；估计行数：10
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/SP-memory-history-confirm.test.ts:82（第五版本 skip 仍在。）

### T1-062 · A2-29 · handwritten · tests/work-graph/W1-future-plan.test.ts:276-323,363-367,470-471,534-537,744-749；仅正常可达场景
- **动作：** convert：seedAcceptedPlan→proposePlan+applyPlanChange；seedRun/seedLease→claimTask（再 enter / 结束）；scenario 1/2 里 C 的 seedReduction→openVerification→beginCheck→recordCheckResult→finalizeChecks→completeTask（夹具要换成能领取和验证的，如 A2-gate-chain-facts 用的 B2 执行夹具）；scenario 9 里没有配套领取的单独 Lease、没有 Run 的 Reduction 和新增 Task 的痕迹按 Codex A2-42 留给 lead
- **覆盖/依据：** 原 scenario 1/2、4、6、7 的断言保留
- **核实理由：** DSH 说 TaskReduction 没有公开写入口，依据是 W1 骨架“本批不假装已完成结果归约 writer”（docs/refactor/tasks/W1-future-plan-skeleton.md:167），那是 W1 当时的状态；今天 completeTask 是公开 owner 方法、返回 TaskReductionSnapshot（src/core/work-graph/model/task-contracts.ts:64-73），work-graph 层测试已经经真实验证链调用它（tests/work-graph/A2-gate-chain-facts.test.ts:73-134）。Plan/Run/Lease 两边结论一致；scenario 9 的 changed-reduction 一类造不出，因为真实完成会先留下 Run、按 :715-721 的顺序先报 Run。
- **涉及测试：** scenario 1/2: future-only B edit + prompt edge keep A running and C satisfied after real adoption; scenario 4: a stale proposal revision or an inactive source is rejected with zero writes; scenario 7: authorized split adopts from the source; coverage/role weakening is zero-write rejected; scenario 6 (memory): explicit old Plan excludes later Run + global Lease; active reads stay authoritative
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：50
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：转换仍写检查/运行事实，scenario9未定案，正常场景仍原始写事件并读存储断言（.lead-ref/books/t-items-T1.md:433；tests/work-graph/W1-future-plan.test.ts:382、:443、:687、:706）。 改法：使用真实Runtime、runRegisteredCheck和完成链；scenario9不可达子例及其helper暂留并标BLOCKED；并发写改公开命令，状态不变改公开读，零写入用A3委托计数；无等价公开读的字节/事件断言单列BLOCKED。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/A2-gate-chain-facts.test.ts, tests/work-graph/W1-future-plan.test.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 正常场景用真实 Runtime、检查和完成链；scenario9 留真实 changed-run 拒绝，删 Lease/Reduction 单独存在及未采用新增任务已有痕迹的行；用公开读和 A3 验零写入，保留字节/事件子段的阻塞记录。（位置：tests/work-graph/W1-future-plan.test.ts:276; tests/work-graph/W1-future-plan.test.ts:443; tests/work-graph/W1-future-plan.test.ts:687; tests/work-graph/W1-future-plan.test.ts:706; src/core/work-graph/tasks/plan-readers.ts:2065；说明：scenario9 不可达子例应删除，不再暂留；字节/事件断言子段仍缺公开等价入口。）

### T1-063 · A2-66 · tamper · tests/work-graph/W1-future-plan.test.ts:416-441
- **动作：** delete W1-future-plan.test.ts:416-441（scenario 1/2 里改来源 Plan 义务的循环；场景其余断言保留）
- **覆盖/依据：** 只为篡改：AGENTS 第 4 条（生产核对仍在 plan-readers.ts:1602-1607，比较规则另有 A2-entry-plan.test.ts:92-94、:139 的纯函数测试）；W1-future-plan-skeleton.md:165 第 8 行加后注
- **核实理由：** W1-future-plan.test.ts:417-441 在读回时改不可变的来源 Plan P1 的义务 title/requirementLevel/verification；公开的 proposePlan/applyPlanChange 只在 A 的定义没变时才继承 P1 basis，写不出含义不符的来源，只有改库才能碰到 plan-readers.ts:1602-1607 的核对。covered_by 应写“只为篡改”，不是“行为已不存在”。
- **涉及测试：** scenario 1/2: future-only B edit + prompt edge keep A running and C satisfied after real adoption
- 来源：DSH；核实：confirmed；规格行：否；估计行数：26
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/W1-future-plan.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/W1-future-plan.test.ts:417（损坏源定义段仍在。）

### T1-064 · A2-67 · tamper · tests/work-graph/W1-future-plan.test.ts:622-661
- **动作：** delete W1-future-plan.test.ts:620-660（scenario 8 后半的真实采用加三种来源损坏；:600-618 的 codec 校验保留）
- **覆盖/依据：** 只为篡改：AGENTS 第 4 条；连带删掉的采用后 ready 读由 scenario 1/2 :394-404、scenario 6 :761-766 覆盖；W1-future-plan-skeleton.md:165 第 8 行加后注
- **核实理由：** :634-659 的 cross-goal、missing、definition 三种故障都是在读回时改掉或藏起不可变的 P1，记录从不删除、basis 由写者从同一 Goal 的来源生成，只有改库才能到达。连带删掉的 :623-633 只是为它们准备的真实采用和 ready 读，scenario 1/2 :394-404、scenario 6 :761-766 已经断言采用后图是 ready。
- **涉及测试：** scenario 8: codec rejects broken shapes and graph reads verify the actual basis source
- 来源：DSH；核实：confirmed；规格行：否；估计行数：40
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/W1-future-plan.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/W1-future-plan.test.ts:620; tests/work-graph/W1-future-plan.test.ts:600（删坏源图集成段，保留 codec 测试。）

### T1-065 · A2-68 · tamper · tests/work-graph/W1-future-plan.test.ts:670-680,739-741
- **动作：** delete W1-future-plan.test.ts:669-676（leaseKeyB 与 corruptLeaseB）、:734-741（first-trace-stops 与 undecodable-lease 两例），并去掉 refusedAdoption 的 over 参数（:680、:693）
- **覆盖/依据：** 只为篡改：AGENTS 第 4 条；Run 先于 Lease、Lease 先于 Reduction 的次序由 scenario 9 'runs-first' :717-721、'lease-before-reduction' :729-732 覆盖
- **核实理由：** corruptLeaseB 把 B 的 TaskLease 读成 '{}'，只有改库才能到达，所以 'undecodable-lease'（:740-741）确实只为篡改；但同一个 helper 还给 'first-trace-stops'（:736-739）用，只删 helper 会让它跑不起来。它要证明的“后面的坏记录不再解码”也只有坏记录才看得出，应一起删；行号 670-680 也错了，:677-680 是 refusedAdoption 的注释和签名。
- **涉及测试：** scenario 9: a changed or added Task with a Run, TaskLease or TaskReduction is no longer future (zero writes)
- 来源：DSH；核实：partly；规格行：否；估计行数：20
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/W1-future-plan.test.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 仍删除篡改 helper 和两例；撤销 runs-first、lease-before-reduction 覆盖说明，它们随 062 删除；仅引用真实 changed-run 的 A6 拒绝，不声称覆盖不可达优先级。（位置：tests/work-graph/W1-future-plan.test.ts:669; tests/work-graph/W1-future-plan.test.ts:734; tests/work-graph/W1-future-plan.test.ts:717; tests/work-graph/W1-future-plan.test.ts:729; tests/work-graph/W1-future-plan.test.ts:706；说明：原点名覆盖中的两条优先级例也依赖不可达状态。）

### T1-066 · A2-28 · handwritten · tests/work-graph/W2-agent-whiteboard.test.ts:189-219,383-387,463-467
- **动作：** convert:proposeAsWorkRun/proposeAsSecondWorkRun→applyAsWorkRun
- **覆盖/依据：** 原四组断言保留；tests/work-graph/W2-agent-whiteboard.test.ts:171-187::real claim -> B2 entered -> Agent propose commits a sourced candidate；seedAgentCandidate还被tests/work-graph/A2-disposition-change.test.ts:599用，helper先留着
- **核实理由：** seedAgentCandidate（W2-whiteboard-fixture.ts:329-357）直接encodePlanProposal加事件；同文件284-289已证明proposeAsWorkRun真实提交后能被applyAsWorkRun采用，310行证明proposeAsSecondWorkRun能在plan2上提交；192、213、385、465四处调用都没覆盖provenance，换成真实propose得到的来源一样。
- **涉及测试：** Agent apply adopts its own sourced candidate and preserves unchanged task basis; a candidate sourced from another Run cannot be adopted by this Run; exact apply replays its original receipt after terminal/revocation; changed Plan/Proposal pins conflict; a signal aborted after the actual commit preserves that invocation committed result
- 来源：Codex；核实：confirmed；规格行：是；估计行数：12
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：与T3-096重复修改四处且对helper去留相反；两个Run前置仍手写entered（.lead-ref/books/t-items-T3.md:671、:672；tests/helpers/W2-whiteboard-fixture.ts:175、:197）。 改法：T1只改四处，T3只改第五处并等待T1提交后删helper；共享W2前置先改真实prepare/start及Runtime结束，门控保持entered。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/work-graph/W2-agent-whiteboard.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/W2-agent-whiteboard.test.ts:192; tests/helpers/W2-whiteboard-fixture.ts:175; tests/helpers/W2-whiteboard-fixture.ts:197（先换两个真实 Run；T1 改四处，T3 改第五处后删共享种子 helper。）

### T1-068 · A2-35 · handwritten · tests/work-graph/goal-independent.test.ts:18-27,47
- **动作：** convert:createProjectBootstrapServices(...).projects.createProject→registerWorkspace（后端 schemas 加 PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events，去掉自造的 ScopeSeeded 事件）
- **覆盖/依据：** 原 tests/work-graph/goal-independent.test.ts:50-68 的 Goal 重放、冲突、越权和后端独立性断言保留。
- **核实理由：** goal-independent.test.ts:18-27,47 直接用 encodeProjectSnapshot/encodeWorkspaceSnapshot 原始提交 Project/Workspace；公开步骤 createProject（project-bootstrap-service.ts:528）和 registerWorkspace（:601）存在，只要 records/now/eventId（project-bootstrap-contracts.ts:123-127），接受 host 上下文（:162-186），结果同为 Project rev1、Workspace rev1（registerWorkspace 只守 Project 版本不改写它，:683-691），后续 createGoal 断言不变。
- **涉及测试：** %s: Goal creation uses only the new Store transaction, including exact replay and conflict
- 来源：Codex；核实：confirmed；规格行：否；估计行数：11
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：要求保留的范围包含直接记录和事件存储断言（tests/work-graph/goal-independent.test.ts:63、:66）。 改法：Goal存在和revision改由queryGoal检查；原事件类型及ID检查子段标BLOCKED，合规入口冻结前不删除或标完成。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 按上面的动作和书面核对改正转换 scope 种子，Goal 存在和 revision 改由 queryGoal 检查。事件类型和事件 ID 的检查子段 BLOCKED（没有等价的公开输出，src/core/work-graph/model/plan-contracts.ts:44）：保持原样，不删不改，本条报 partial。（位置：tests/work-graph/goal-independent.test.ts:63; tests/work-graph/goal-independent.test.ts:66；说明：lead 10-20：Codex 报 BLOCK 只因事件子段，其余可做）

### T1-069 · A2-36 · handwritten · tests/work-graph/material-readers.test.ts:20-48,61-73
- **动作：** convert:两个 Project 各走 createProject/registerWorkspace/installCompletionPolicy+activateCompletionPolicy/adoptInitialArchitecture（可复用 tests/helpers/S4B-note-multi-scope-fixture.ts 的做法），再 createGoal（主 Goal、other-goal、other-project 同名 Goal，另在 other-workspace 建 Goal）→proposePlan/applyPlanChange→角色配置+createSession→claimTask（注入按队列给 'same-run' 的 newId）；两个 QueryRun 用 submitQueryJob（queryJobId 'query-1'、runId 'same-query'，分属两个 Workspace）
- **覆盖/依据：** 本文件 75-82 的完整 ref 区分、not_found 和返回副本隔离断言保留，期望快照改为 owner 返回值。
- **核实理由：** 手写快照加原始提交属实（material-readers.test.ts:20-48,61-73），81 行只改返回副本也属实；公开步骤都存在（claimTask 的 runId 来自注入的 newId，claim-service.ts:1204；submitQueryJob 接受调用方给的 queryJobId/runId，S3-context-inputs.test.ts:514-528），但所列步骤漏了前置：Plan 要求项目已激活 CompletionPolicy 和 ArchitectureBaseline（plan-readers.ts:812-826），claimTask 要求可用 Session（claim-service.ts:15,396），连现有 task-claim-fixture.ts:198-233 也是手写治理种子，所以 45 行偏低。
- **涉及测试：** %s: canonical material records use complete refs and returned values are isolated
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：80
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：期望快照取owner返回值与禁止复制程序输出的规则冲突（.lead-ref/books/t-items-T1.md:483；.lead-ref/books/t-book.md:50）。 改法：期望按公开请求、固定时钟及步骤手算，仅动态ref引用创建返回身份；不复制整个返回snapshot；保留完整ref区分、not_found及副本隔离，Session经真实Runtime创建。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S4B-note-multi-scope-fixture.ts, tests/work-graph/material-readers.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/material-readers.test.ts:20; tests/work-graph/material-readers.test.ts:74（真实 owner/Session；期望由请求和时钟手算，只引用公开返回的动态身份。）

### T2-003 · F-08 · helper · tests/helpers/S2C-K-scenario-support.ts:33,127-129,172-174
- **动作：** delete
- **覆盖/依据：** 无消费者；保留现用的行读取和维护流程。
- **核实理由：** 全仓 Grep 三个符号在 tests/ 里只有定义 tests/helpers/S2C-K-scenario-support.ts:33、:127、:172（src 里的 sessionRefOf 是 work-line-reader.ts:2282 等处自己的本地函数，无关）。删 lineWrite 后 :25 的 graphWrite 导入要一起去掉。
- **涉及测试：** LinePageRead; sessionRefOf; lineWrite
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S2C-K-scenario-support.ts:33; tests/helpers/S2C-K-scenario-support.ts:127; tests/helpers/S2C-K-scenario-support.ts:172（三个无消费者声明仍在。）

### T2-021 · C10 · duplicate · tests/runtime/K3-12-review-round-tools.test.ts:['129-149']
- **动作：** merge-into:tests/runtime/K3-review-preparation.test.ts::(%s) K3-L13-5 … —— 把 K3-12-review-round-tools.test.ts:141-142（envelope 的 tools/writeScope）和 :145（manifest.input 含 run_readonly_command）迁进 K3-L13-5（:174-208），并把合并后的测试名带上 K3-12 行号（slice-K3-SPEC.md:1428）；删 K3-12 :128-150，以及只给前半段用的 :37-45 shell mock、:47-126 的 hostConfiguration/EXPECTED_REVIEW_TOOLS/claimReviewRound/prepareReviewRun 和对应导入；后半段 'K3-12 read-only command write attempt'（:151-247）保留。
- **覆盖/依据：** tests/runtime/K3-review-preparation.test.ts:168-212::(%s) K3-L13-5 prepares with the L13 tools, empty write scope, sessionBasis and the review section（补断言后）
- **核实理由：** 两边用同一个 openK3ReviewCardWorld→createK3PendingReview→真实 review claim→prepare，hostConfiguration 和 prepareReviewRun 逐行相同（K3-12:47-126 对 K3-review-preparation:53-123），K3-L13-5 断言更多，只缺 K3-12:141-142、145，迁过去就不丢东西。K3-12 是规格行（slice-K3-SPEC.md:1428），所以合并后的测试名要保留 K3-12。Codex 的 21 行少算了，前半段删掉后那些辅助函数也没人用了，约 120 行。
- **涉及测试：** (%s) K3-12 prepares a review-purpose Run with exactly the L13 tools and an empty write scope
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：120
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/K3-12-review-round-tools.test.ts:129; tests/runtime/K3-review-preparation.test.ts:168（原合并仍成立，保留后半段测试。）

### T2-045 · B-08 · duplicate · tests/scenarios/K3-19-missing-read-no-round.test.ts:181-241
- **动作：** merge-into:tests/scenarios/K3-19-review-unavailable.test.ts::K3-19 (一)（不需要迁任何断言，整份 K3-19-missing-read-no-round.test.ts 可删）
- **覆盖/依据：** tests/scenarios/K3-19-review-unavailable.test.ts:125-181 + tests/app/K3-19-review-capability-host.test.ts:145-156
- **核实理由：** 缺 read 时，应用层测试断言 reviewCapability 的回答（K3-19-review-capability-host.test.ts:152）与开关关时（:132、:141）一字不差，都是 {unavailable, 'the Host read-only command switch is off'}，Workflow 分不出原因。所以 missing-read 文件 :181-240 在能力判断之后的链路，和 K3-19-review-unavailable.test.ts:125-181 完全重复，而且后者对 decisionReasons 的断言更严。结论成立。行数改成整个文件 241 行：两个本地 helper 一起去掉，这会牵连 DSH 的 B-09。另外，这条 Workflow 级检查是 lead 在 k3-g3-impl-4 §2 第 7 条点名要的，由 lead 定。
- **涉及测试：** K3-19 A1: a Host binding with run_readonly_command but no read answers reviewCapability unavailable / K3-19 (一): with the read-only command unusable the Workflow opens no round ... settles review_unavailable
- 来源：DSH；核实：partly；规格行：是；估计行数：241
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-19-missing-read-no-round.test.ts:181; tests/scenarios/K3-19-review-unavailable.test.ts:125（覆盖关系仍成立。）

### T2-049 · B-08 · duplicate · tests/scenarios/S2C-K-unknown-outcome.test.ts:105-150;174-207
- **动作：** merge-into:tests/scenarios/S2C-K-retired.test.ts::2C-21 (2)（missing/damaged 两例）；删 S2C-K-unknown-outcome.test.ts 的 2C-22 (2) :105-150 和 2C-22 (4) :174-207，在 2C-21 (2) 的名字或注释里注明 2C-22 认定后 missing/damaged 的映射；2C-22 (1)(3) 保留
- **覆盖/依据：** tests/scenarios/S2C-K-retired.test.ts:242-298::2C-21 (2) a ${name} Kernel leaves the line retired（retiredUnknownCase('missing') :297、('damaged') :298）
- **核实理由：** 2C-21 (2) 按 missing/damaged 参数化，2C-22 (2)/(4) 的每一条断言它都有：认定 committed、kernel_turn_open、pass 1 的结论、归档后的 bucket/tag/own/conclusion、reactivate 被拒、session 卡（retired:256-293），另外还多一条 history not_readable。2C-22 (2)/(4) 没有独有的断言，所以 Codex 把两条都合并是对的；DSH 只记了 keep-note 又写了 30 行，而且漏了 (4)。
- **涉及测试：** 2C-22 (2); 2C-22 (4)
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：80
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：规格编号可放注释的写法与总书要求放在测试名称冲突。 改法：目标参数化测试名称同时写入2C-21(2)、2C-22(2)、2C-22(4)，删除或注释这一选项，其余动作不变。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/S2C-K-unknown-outcome.test.ts:105; tests/scenarios/S2C-K-unknown-outcome.test.ts:174; tests/scenarios/S2C-K-retired.test.ts:243（仍可合并，目标名称保留三个规格编号。）

### T2-050 · B-16 · helper · tests/scenarios/S2C-K-unknown-outcome.test.ts:38-81
- **动作：** 把 damageKernel 和参数化的 crashedUnknownKernel 移到 tests/helpers/S2C-K-scenario-support.ts（两文件已从它导入），两个测试文件都改成导入；不要合进 .test.ts
- **覆盖/依据：** tests/scenarios/S2C-K-retired.test.ts:193-224 的同一实现
- **核实理由：** 重复属实：unknown-outcome.test.ts:38-45 与 retired.test.ts:193-200 逐字相同，48-81 两个函数只差故障类型，等于 retired.test.ts:207-224 的 crashedUnknownKernel(h, id, kernel)；全 tests 里没有别处定义。但 action 写的是合进 .test.ts，和它自己的证据“抽出共享 support、不从 .test.ts 导入”矛盾，目标应是 support 文件。
- **涉及测试：** damageKernel; crashedMissingKernel; crashedDamagedKernel
- 来源：Codex；核实：partly；规格行：否；估计行数：44
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：damageKernel直接SQL改写Kernel记录，不在v1允许形态内，A7为空。 改法：保留迁移和damaged行为；lead先在下一版规则精确登记临时Kernel事件JSON损坏注入例外，禁止造写WorkGraph事实。冻结后原样迁移，不删除当前damaged场景来绕过规则。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 只抽共享崩溃流程并接收调用方故障回调；两份damageKernel留在原测试文件，不将SQL注入迁入未获A7授权的helper。（位置：tests/scenarios/S2C-K-unknown-outcome.test.ts:38; tests/scenarios/S2C-K-retired.test.ts:193; .lead-ref/books/test-rule-sheet-v2.md:50；说明：A7将damageKernel限定在两份测试文件。）

### T2-051 · B-10 · handwritten · tests/scenarios/S3-query-graph.test.ts:205-221;317-323
- **动作：** convert:同 B-09（advanceWork 跑 tA 到 open_checks 前 -> 用真实 RunRef storeArtifact，事先算 ArtifactRef 保持一次计划 revision）；另把 392 行 history 调用和 441 行 toContain(RUN_A.runId) 改成 tA 的真实 runId（照 406 行事后补参数的写法）
- **覆盖/依据：** tests/scenarios/S3-query-graph.test.ts:386-478::SC02（业务断言保留，只换前置事实的造法）
- **核实理由：** 手写属实：205-221 与 B-09 同样直接写 snapshots 表，317 注入后才存 Artifact、323 建图；公开步骤存在。但与 B-09 同样的顺序问题，并且本文件 441 行断言 history 结果含字面 'runA'、392 行脚本写死 RUN_A，真实 Run 的 id 是随机的（create-platform.ts 用 randomUUID），这些都要跟着改，24 行偏少。
- **涉及测试：** SC02: the old main-conversation Query answers through the read-only graph tools and the Answer is saved
- 来源：Codex；核实：partly；规格行：是；估计行数：35
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：同B-09指向歧义；未明确给tA独立回复会消耗SC02后续send脚本。 改法：写全转换链：固定正文手算ArtifactRef，在真实Answer产生并一次采用的计划中声明；给tA独立文本回复，advance到completed且open_checks前停，用真实RunRef存Artifact。返回runARef并在Query启动前补history参数；原send回复保留给后续工作，计划仍为revision1。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/scenarios/S3-query-graph.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/S3-query-graph.test.ts:205; tests/scenarios/S3-query-graph.test.ts:317; tests/scenarios/S3-query-graph.test.ts:392; tests/scenarios/S3-query-graph.test.ts:441（SQL Run种子仍在，原转换及独立tA回复安排适用。）

### T2-052 · B-14 · helper · tests/scenarios/S3-query-graph.test.ts:121-186;223-292;294-316;324-348
- **动作：** 抽到新的 tests/scenarios/support/S3-host.ts（S3Host 类型、workspaceBindings、s3Checks、s3Runtime、s3Ctx、planDraft、seedS3Graph、openS3Host 带临时目录前缀参数），两个测试文件都改为导入；不要合进 .test.ts
- **覆盖/依据：** tests/scenarios/S3-context-and-inputs.test.ts:345-406::SC01；tests/scenarios/S3-query-graph.test.ts:386-478::SC02（两条业务断言都保留）
- **核实理由：** 重复属实：query-graph.test.ts:121-186、223-292、294-348 与 context-and-inputs.test.ts:113-178、215-284、286-340 逐段相同（连架构描述都是 'S3 context and inputs fixture'），只有 295-296 行的临时目录前缀不同；S3Host 类型（100-112 对 92-104）和 s3Ctx/runACtx（188-196）也重复，估计数应略多。action 写成合进 .test.ts，和证据里“抽共享 support”矛盾。
- **涉及测试：** workspaceBindings; s3Checks; s3Runtime; planDraft; seedS3Graph; openS3Host
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：200
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：第二份消费者归TP且同段由TP-123转换；先抽取会迁移旧SQL种子，关闭责任也未纳入接口。 改法：先完成并承接TP-123、T2-051，再由lead将S3-context-and-inputs.test.ts交接给T2；随后抽取真实初始化到S3-host.ts，S3Host提供close，两个调用方finally关闭。不迁seedCompletedRun/runASnapshot，禁止两组继续并写。
- **第一批之后已不存在的文件：** tests/scenarios/support/S3-host.ts
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/scenarios/S3-context-and-inputs.test.ts, tests/scenarios/S3-query-graph.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/S3-context-and-inputs.test.ts:269; tests/scenarios/S3-context-and-inputs.test.ts:317; tests/scenarios/S3-query-graph.test.ts:294（承接SC01真实tA路径和051后抽共享初始化。）

### T2-059 · D-04 · stale · tests/state/S2C-line-status.test.ts:['148-157']
- **动作：** delete
- **覆盖/依据：** 行为已不存在（只为旧数据）：docs/refactor/HANDOFF.md:566；slice-2C-SPEC.md:1299 的 2C-01 (2) 自己写明结论为 null 的退役只出现在第 1 片之前的旧数据里。当前三种结论配结果未知由 tests/scenarios/S2C-K-unknown-outcome.test.ts:83-104 的 2C-22 (1) 和 :152 起的 2C-22 (3) 覆盖。
- **核实理由：** 把 Session 写成不可用的写入方都带结论（session-availability.ts:394、:452-457，可观测类型 :193-195 只允许 missing/damaged），所以 health=unavailable 加 healthConclusion=null 只有旧记录才有；S2C-line-status.test.ts:148-157 固定的就是这个形状。被引的 2C-22 场景确实存在，断言 retired_missing/retired_damaged 加 attention unknown。
- **涉及测试：** 2C-01 T1 before T2: a legacy null conclusion with an unknown occupancy is 已退役 and 待核对
- 来源：Codex；核实：confirmed；规格行：是；估计行数：10
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/state/S2C-line-status.test.ts:148（旧null conclusion例仍在。）

### T3-090 · F-07 · helper · tests/helpers/S2C-D-node-support.ts:630-636
- **动作：** delete
- **覆盖/依据：** 无消费者；2C-28 的不完整计数由 tests/work-graph/S2C-node-detail-anomalies.test.ts 自己造，不用这个桩。
- **核实理由：** 全仓 Grep `incompleteAnomalies` 只有定义 tests/helpers/S2C-D-node-support.ts:630，2C-28 的三个测试文件都不导入它；删掉后 SessionAnomalyPort 在同文件 :108、:542 仍有用，导入不用改。
- **涉及测试：** incompleteAnomalies
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：8
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S2C-D-node-support.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S2C-D-node-support.ts:630（原删除成立。）

### T3-095 · F-11 · helper · tests/helpers/W2-whiteboard-fixture.ts:77-79
- **动作：** delete:整段删 tests/helpers/W2-whiteboard-fixture.ts:77-79 W2AgentApplyRequest；:63、:66、:73 去掉 export
- **覆盖/依据：** 无外部消费者（三个 importer A2-disposition-change:61、K3-39-tool-commit-lookup:22-24、W2-agent-whiteboard:20-23 只取 createW2WhiteboardFixture/W2WhiteboardFixture/W2PlanDraftV2）
- **核实理由：** W2AgentApplyRequest 全树只有 :77 定义，本文件也不引用，Codex 说整个删对，DSH“同文件内用”不成立（删后 PlanProposal import 仍被 :117 等使用）；DSH 另外三项成立：W2Records(:85)、agentActorIdFor(:349)、W2AgentProposeRequest(:115/:287) 只在本文件用。
- **涉及测试：** W2AgentApplyRequest
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：6
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/W2-whiteboard-fixture.ts:63,73,77（原删除及导出清理成立。）

### T3-096 · F-43 · handwritten · tests/helpers/W2-whiteboard-fixture.ts:329-359
- **动作：** convert:proposeAsWorkRun/proposeAsSecondWorkRun（五处调用都改，含 A2-disposition-change.test.ts:599），然后删 seedAgentCandidate（W2-whiteboard-fixture.ts:127-130 接口、:329-359 实现、:390 导出）
- **覆盖/依据：** W2-agent-whiteboard.test.ts:192、:213（用 proposeAsSecondWorkRun）、:385、:465 和 tests/work-graph/A2-disposition-change.test.ts:599 改用真实 propose，断言不变；同文件 A2-disposition-change.test.ts:645-652 的 proposeAsAgent 已在 :660-661 证明真实 Agent 候选能被 apply
- **核实理由：** 手写候选属实（W2-whiteboard-fixture.ts:338-356 直接 encodePlanProposal 加事件提交），真实步骤也能用：Agent propose 只查范围，执行规则留到 apply（plan-service.ts:3300-3302），所以对自己正在跑的 Task 改 disposition 的草稿也能先提交。但 Codex 漏了第五个调用方 A2-disposition-change.test.ts:599，只改 W2 那四处就删 helper，会让 A2 这个测试坏掉。
- **涉及测试：** seedAgentCandidate; Agent apply adopts its own sourced candidate and preserves unchanged task basis; a candidate sourced from another Run cannot be adopted by this Run; exact apply replays its original receipt after terminal/revocation; changed Plan/Proposal pins conflict; a signal aborted after the actual commit preserves that invocation committed result
- 来源：Codex；核实：partly；规格行：否；估计行数：40
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：四个调用点属于 T1，且已由 T1-066 分配同一转换。 改法：四个 W2 调用继续由 T1-066 修改；T3 修改 A2 第五处。T1 转换合入后，T3 才删除 seedAgentCandidate 的接口、实现和返回字段。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/A2-disposition-change.test.ts:599; tests/helpers/W2-whiteboard-fixture.ts:292,329; .lead-ref/books/t-items-T3.md:708（T3只改第五处，T1四处合入后再删helper。）

### T3-106 · A1-29 · handwritten · tests/work-graph/A2-disposition-change.test.ts:190-264;617-641
- **动作：** convert：能走公开步骤的行照建议改（claimTask → enter/recordRunResult 得到结束的 Run 和已释放的 Lease；submitControl 做人工停止；R3e 检查 → completeTask 得到 Reduction），夹具要从裸后端（102-156）换成领取+执行夹具；447-448（Run 已结束但 Lease 未释放）和 reholdLease 竞态（235-246、494-507）改为 keep-note：没有公开步骤；449-450 见 A1-17
- **覆盖/依据：** 保留 384 起的业务断言和拒绝规则，但上面两处的状态造不出来；真实平台路径另有 tests/scenarios/C7-supersede-failed-task.test.ts 与 C7-defer-reactivate.test.ts（文件头 31-34）
- **核实理由：** 核心属实：seedRun/seedLease/seedReduction/reholdLease/humanStop（190-264）和 seedEndedSibling（617-641）都是直接写库。但 Run 结束时同一提交就释放 Lease（attempt-machine.ts:297-301，B2-execution-result.test.ts:20、45），所以“已结束却持有 Lease”造不出来；真实的并发领取还会写一个未结束的新 Run（claim-service.ts:1212-1239），重读时答的是守卫 1 而不是 505-507 断言的守卫 4 文字。换夹具也让改动远超 100 行。
- **涉及测试：** traced disposition changes; TASK-19; humanStop and ended sibling fixtures
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：150
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：enter/recordRunResult 前置违反规则；不可达状态的 keep-note 与总书冲突；449–450 引用的 A1-17 是无关条目。 改法：可达分支使用 claimTask→Runtime.prepareExecution→Runtime.startRun 和真实停止/检查/completeTask；447–448、449–450及479–508明确标为 BLOCKED，删除 keep-note 和错误 A1-17 引用，待 lead 冻结这些行的处置后重新下发，不保留造态也不修改守卫文字求通过。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 删除447–450的两条不可达前置行和479–508的直接重持Lease竞态；其余分支用共享真实Runtime、公开停止/检查/completeTask转换，拒绝行按A6保留并公开读取零变化；取消这三处旧BLOCKED待裁定安排，生产守卫保留。（位置：tests/work-graph/A2-disposition-change.test.ts:447,449,479; src/core/work-graph/tasks/execution-entry-service.ts:900; src/core/work-graph/tasks/claim-service.ts:1212; .lead-ref/books/t-w1-findings.md:27,31；说明：R-3/R-4已取代三处旧BLOCKED待裁定安排。）
