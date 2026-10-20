# T items, wave 2, group T2 (62 items; lead 2026-10-20)

编号 = 原组内序号 · 清点编号。动作是最终的；修正行的先后和优先级见任务书 §1。看不懂或和代码对不上的，标 BLOCKED 并报证据。

从别的组移进本组的条目（它们和本组条目改同一批文件）：T1-002, T1-016, T1-017, T1-018, T1-021, T1-022, T1-023, T1-061, T1-067, T1-070, T3-028, T3-030, T3-031, T3-032, T3-033, T3-034, T3-044, T3-077, T3-078, T3-079, T3-080, T3-084, T3-102, T3-103, T3-105。

### T1-002 · B-07 · duplicate · tests/scenarios/K3-37-stopped-review-round.test.ts:231-296
- **动作：** merge-into:tests/scenarios/K3-45-review-incomplete-r2.test.ts::K3-45 (一) R2，并把 K3-37-stopped-review-round.test.ts:359-366 的“目标暂停期间 h.advance 不领核对轮、记录仍是 pending_review/unfinished”断言迁到 K3-45 第 1 轮定稿之后、:233 resume 之前，再删 K3-37 (三) :298-383
- **覆盖/依据：** tests/scenarios/K3-45-review-incomplete-r2.test.ts:153-285（第 1 轮 :178-230 + resume 后第 2 轮 claim :233-237）+ 迁入的 K3-37:359-366
- **核实理由：** K3-45 第 1 轮（:178-230）和 K3-37 (三) 是同一条链路、同一组断言，但 DSH 说“round 1 covers it fully”不对：K3-45 定稿后直接 resume（:233），K3-11:262 也一样，都没断言暂停期间不开第二轮。这是规格行 K3-37（三）“目标恢复以后才开第二轮”（slice-K3-SPEC.md:1438）里的“才”，目前只有 K3-37:359-366 钉住，要先迁过去才能删。Codex B-07 只写了 (一)/(三) 保留，没有说明 (三) 有哪条断言是 K3-45 没有的；迁入以后合并成立。
- **涉及测试：** K3-37 (二)
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：94
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：标题及涉及测试指向（二），实际动作删除（三）（.lead-ref/books/t-items-T1.md:12、:13、:16）。 改法：标题范围改为298–383，涉及测试改为K3-37（三）；保留现有迁移359–366断言的动作。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-37-stopped-review-round.test.ts:298; tests/scenarios/K3-45-review-incomplete-r2.test.ts:233（删除第三例前，迁入暂停期间不产生第二轮的断言。）

### T1-016 · A1-34 · handwritten · tests/work-graph/K3-11-review-reasons.test.ts:105-171;208-219
- **动作：** convert:createK3PendingReview → runK3ReviewRound/claimK3ReviewRound → endK3RunUnfinished/endK3RunCompleted → settleK3Review（every_step 仍用 setGoalSettings），用于 review_unavailable、review_incomplete、confirm_each_step 和三种原因四例；second_consecutive 一例改为 merge-into:tests/scenarios/K3-11-review-reasons-r2.test.ts::K3-11 R2: a shell call in B after A ended by RUN-25 leaves streak.priorUnknownProcess and settles second_consecutive
- **覆盖/依据：** tests/scenarios/K3-11-review-reasons-r2.test.ts:299-400（400 行断言 ['second_consecutive']）；confirm_each_step 和三种原因在同一文件 143-188、197-286 已有真实链，保留 K3-11 规格行和 L17 顺序断言
- **核实理由：** 手写属实：K3-11-review-reasons.test.ts:113-141、208-219 用 newUnknownCallReview/transitionUnknownCallReview 构造记录后直接 commit，其余几种原因 K3-proposal-round 的公开步骤都能造出。但 streak.priorUnknownProcess 只来自同一 Task 上一个 Run 留下的未知 process（task-failure.ts:576-607，run-reconcile-service.ts:930-964），createK3PendingReview 每次领一个新 Task（K3-proposal-round.ts:255-275），所以这条链造不出 second_consecutive；这一例的真实接续链只有 R2 场景 299-400 有。
- **涉及测试：** K3-11 review reasons; review_incomplete appears once alone on the second unfinished round
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：89
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：结算helper返回手造display map；仅review_unavailable所需的已写结论前置未写明；K3世界继承手写S5初始化（tests/helpers/K3-proposal-round.ts:571、:591；tests/work-graph/K3-11-review-reasons.test.ts:341）。 改法：结算读取真实核对轮manifest；单原因用例固定为pending、写done/unlikely、unfinished结束、round_ended回pending、review_unavailable；先完成公开S5初始化。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/K3-11-review-reasons.test.ts:113; tests/helpers/K3-proposal-round.ts:571（仍需真实核对轮和 manifest；单原因前置按书面改正。）

### T1-017 · A1-22 · duplicate · tests/work-graph/K3-14-unknown-call-review-tool.test.ts:157-179;206-229
- **动作：** merge-into:tests/work-graph/K3-14-unknown-call-review-tool.test.ts::the same call replays the original receipt; the adapter never pre-reads the record / the same identity with changed content is idempotency_conflict through the adapter / a post-round write through the adapter is source_stale
- **覆盖/依据：** 同文件 318-325、335-337、347-349
- **核实理由：** owner 层三例（K3-14-unknown-call-review-tool.test.ts:157-169、171-179、206-229）断言的是：重放得到原回执且记录不变、idempotency_conflict、source_stale；适配器三例（310-327、329-339、341-351）在同样两个后端上断言了同样的结果，还多一条“不预读”。recordConclusion 在生产里唯一的调用方是工具适配器，而且总是传 expected: []（unknown-call-review-tools.ts:177-183），所以 owner 层带 pin 的写法本来就不是真实请求的样子。
- **涉及测试：** the same call replays the original receipt and leaves the record unchanged; the same identity with different content is idempotency_conflict; writing after the round settled is stale
- 来源：Codex；核实：confirmed；规格行：是；估计行数：46
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/K3-14-unknown-call-review-tool.test.ts:157; tests/work-graph/K3-14-unknown-call-review-tool.test.ts:310（owner/adapter 重复仍在。）

### T1-018 · A1-35 · handwritten · tests/work-graph/K3-14-unknown-call-review-tool.test.ts:72-136;284-306
- **动作：** convert:createK3PendingReview → claimK3ReviewRound → endK3RunCompleted → settleK3Review
- **覆盖/依据：** 保留 tool/owner 语义，与 A1-22 合并同时做；181-192 里写死的 revision 3/4 要按真实记录重算；194-204 的 process+read_only 组合不能走公开路径，另放纯状态层
- **核实理由：** 72-136 直接构造 claimed 记录并 commit，284-306 直接写 settled 替换记录，两处都属实。K3-proposal-round.ts 里 createK3PendingReview（255）、claimK3ReviewRound（383，返回 work_run 上下文）、endK3RunCompleted（526）、settleK3Review（588）现在都有。结算后 activeRound 为空，或轮次 Run 已结束，都会回 source_stale（unknown-call-review-service.ts:563-572）。多条目组合造不出来，K3-06-mixed-kinds-owner.test.ts:6-12 有说明。
- **涉及测试：** ready; settleRecord
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：88
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：纯状态目标未命名，且把可公开测试的缺失alias与非process组合混在一起（tests/work-graph/K3-14-unknown-call-review-tool.test.ts:194、:197、:200）。 改法：服务层保留真实记录上的alias 9拒绝及公开读不变；仅非process分支迁到K3-14-conclusion-pure.test.ts；同时依赖真实display读取和公开S5初始化。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/K3-14-unknown-call-review-tool.test.ts:72; tests/work-graph/K3-14-unknown-call-review-tool.test.ts:292（真实记录转换；alias 9 拒绝留服务层，仅非 process 分支迁纯测试。）

### T1-021 · A1-28 · duplicate · tests/work-graph/K3-26-unknown-call-review-storage.test.ts:857-897
- **动作：** merge-into:tests/work-graph/K3-47-reader-facts.test.ts::K3-47 (二): a pending_review record stops the Task before AV-3（先把完整投影断言 ref、revision 1、decisionReasons []、activeRound null、hold null、remainingRoundSlots 8 和 row.execution 是原 Run 搬过去），再删 K3-26:857-897；坏 JSON 解码那一半（plan-readers.ts:1755-1758）只有改库可达，不搬
- **覆盖/依据：** tests/work-graph/K3-47-reader-facts.test.ts:126-210（读失败与 pending 投影）；投影字段需搬入后才算覆盖
- **核实理由：** K3-47-reader-facts.test.ts:206 只断言 status/hold，remainingRoundSlots 等字段全 tests/ 只在 K3-26:879 断言；而且 K3-26 走的是 ready 读后解码失败的分支（plan-readers.ts:1755-1758），K3-47-reader 走的是 readMany 被拒的分支（:1764），说它“断言是超集”不成立，直接合并会丢投影字段。
- **涉及测试：** K3-47 (二) %s: the Task read model projects the selected Run's record, fail-closed when unreadable
- 来源：DSH；核实：partly；规格行：是；估计行数：37
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/K3-26-unknown-call-review-storage.test.ts:862; tests/work-graph/K3-47-reader-facts.test.ts:201（完整 pending 投影断言迁入目标，损坏解码段删除。）

### T1-022 · A1-24 · duplicate · tests/work-graph/K3-45-review-incomplete.test.ts:1-220
- **动作：** merge-into:tests/scenarios/K3-45-review-incomplete-r2.test.ts::K3-45 (一) R2: two rounds that each wrote every conclusion then were interrupted with no call in flight settle needs_decision with exactly review_incomplete
- **覆盖/依据：** tests/scenarios/K3-45-review-incomplete-r2.test.ts:268-280；单条目的纯状态行见 tests/state/unknown-call-review.test.ts:403-413
- **核实理由：** K3-45-review-incomplete.test.ts:93-151 用状态机手造两轮记录，再原始提交；R2 场景 153-280 真实跑了两轮，在 268-278 断言 needs_decision、只有 ['review_incomplete']、两轮都是 unfinished、结论没被改，覆盖了同一业务。源文件里两条目的写法走公开路径造不出（K3-06-mixed-kinds-owner.test.ts:6-12）。合并后少了 memory 后端；K3 冻结时已接受真实 Host 行只跑 SQLite。
- **涉及测试：** two unfinished rounds in one stateEntry settle needs_decision with review_incomplete although every item has a conclusion
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：220
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/state/unknown-call-review.test.ts, tests/work-graph/K3-45-review-incomplete.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/K3-45-review-incomplete.test.ts:93; tests/scenarios/K3-45-review-incomplete-r2.test.ts:268（迁入真实第二轮场景后删旧文件。）

### T1-023 · A1-47 · handwritten · tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:149-224
- **动作：** convert：照 :316-347 的 nearBudgetProposalFixture 前半段（gitWorkspace + prepareViaRuntime + 50 条长路径真实捕获 + createRecord）造接近预算的 pending_review，再 claimK3ReviewRound(review) 后调 reviews.recordConclusion；调路径字节，让记录落在 1,500 字节依据超、100 字节依据收的区间；删 :141-237 的 ctxOf/pendingReview/exactSizedRecord/fixture，processItem（:97-112）留给 :573-582 的 codec 用例；不用另写 pure 测试
- **覆盖/依据：** 转换路径见同文件 :316-364；tests/runtime/K3-48-2-proposal-budget-pure.test.ts 只管方案理由，不覆盖结论/依据
- **核实理由：** Codex 说真实串行只出一个 process 条目，这话对，但同文件 :303-315 已证明接近 B 的大小可以由真实工作区捕获产生，公开步骤（openRealRunHarness gitWorkspace、createRecord、claimK3ReviewRound）都在；规格 K3-48（二）（slice-K3-SPEC.md:1442）只要求“接近”不要求精确边界，§10.10（:1898）把这处留给 T。DSH 说移到 pure 文件不对，tests/runtime 下没有结论预算的 pure 测试。
- **涉及测试：** exactSizedRecord; near-512KiB model text budget owner fixture
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：95
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：K3世界依赖手写S5检查点，TP-099仍保留该例外，而规则表A7为空（tests/helpers/K3-review-card-fixture.ts:149；tests/helpers/S5-decision-fixture.ts:543、:574；.lead-ref/books/t-items-TP.md:662）。 改法：先冻结并完成T1使用的公开S5初始化模式，Project、Workspace、治理、Goal及设置均经公开入口产生，不使用固定版本的原始检查点，再执行预算转换。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 复用已转换初始化，只补真实 Session/Run；以真实 prepare/核对请求测预算，display 从真实 manifest 读取。（位置：tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:149; tests/helpers/S5-decision-fixture.ts:572; tests/helpers/S5-decision-fixture.ts:598; tests/helpers/S5-decision-fixture.ts:840; src/composition/create-platform.ts:737；说明：S5 的 scope、治理、Goal/设置已公开化，Session/Run 前置及真实 display 仍未齐。）

### T1-061 · A2-32 · handwritten · tests/work-graph/UCR-settle-review.test.ts:58-96,142-165,194-210
- **动作：** convert:createK3PendingReview→claimK3ReviewRound(带review参数)→recordK3Conclusion / holdReview(要接taskProjection)→endK3RunCompleted / endK3RunUnfinished→settleK3Review；review_unavailable直接从未认领的pending_review记录开始
- **覆盖/依据：** 原UCR-06/07/08b断言保留；fixture(kind, items)还被同文件L16 D6（245-294）和K3-10（324-358）共用，它们预置了by:'review_round'的结论（roundRunRef是假的p/g/round-run），真实链不能注入items，要一起改成真实recordConclusion；K3-10矩阵已由tests/scenarios/K3-10-review-round-cells.test.ts:206走真实链测过，可交lead定是否只留一处
- **核实理由：** 核实：58-96手写newUnknownCallReview和round_claimed提交，198行手工清空activeRound，143-163手写hold_applied；公开链都在（K3-proposal-round.ts:255、383、475、588，holdReview在unknown-call-review-service.ts:979），round_claimed只设activeRound不改status（state/unknown-call-review.ts:285-290），所以未认领的pending_review就是review_unavailable的真实起点。但共用fixture一换，L16 D6和K3-10也得改，80行明显低估。
- **涉及测试：** UCR-07正常结束结算; UCR-07 review_unavailable; UCR-15 hold共享布置
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：170
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：缺真实display和S5前置、outcome_unknown路径、真实truncated及manifest失败路径；单条目helper不能覆盖多条目计数；矩阵去留未定（tests/work-graph/UCR-settle-review.test.ts:218、:250、:269、:278、:333；tests/helpers/K3-proposal-round.ts:266、:571）。 改法：先修共享前置；truncated由真实长命令prepare产生，manifest失败包装真实依赖；outcome_unknown和多条目计数子例单列BLOCKED；固定保留并转换全部K3-10矩阵及双后端。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 转换真实核对轮和 manifest；真实 entered 核对 Run 经 Kernel 缺失故障及重启产生 unknown，保留 busy 和公开读不变；删除多 process 计数例；真实长命令产生 truncated，manifest 仅注入失败；保留全部矩阵和双后端。（位置：tests/work-graph/UCR-settle-review.test.ts:218; tests/work-graph/UCR-settle-review.test.ts:245; tests/work-graph/UCR-settle-review.test.ts:264; tests/work-graph/UCR-settle-review.test.ts:278; tests/work-graph/K3-06-mixed-kinds-owner.test.ts:6; tests/scenarios/S2C-K-unknown-outcome.test.ts:48；说明：多 process 行不可达；unknown 有真实 Run 加 Kernel 缺失、重启的产生路径。）

### T1-067 · A2-30 · handwritten · tests/work-graph/WP2-context-extensions.test.ts:309-320
- **动作：** convert:循环调用plans.proposePlan并保存返回的proposalId（排好序再算行键和candidateProposalIds[0]）
- **覆盖/依据：** 原tests/work-graph/WP2-context-extensions.test.ts:402::F07保留，真实入口已在296-307
- **核实理由：** 309-320用seedCandidateProposal直接写candidate；Host的proposePlan对basedOn非空的草稿只查Goal范围、原因形状和validatePlanDraft（plan-machine.ts:1021-1031，plan-service.ts:1364-1365），planId和planRevision要到采用时才查（plan-machine.ts:1418-1422），所以同一份草稿能真实提交100个候选；proposalId由requestId派生，测试里的顺序要按返回值重排。
- **涉及测试：** F07 follows the real page boundary and keeps the named tail Task card under focus
- 来源：Codex；核实：confirmed；规格行：是；估计行数：14
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：循环propose仍从手写S5检查点开始（tests/work-graph/WP2-context-extensions.test.ts:269；tests/helpers/S5-decision-fixture.ts:543、:574）。 改法：先使用T1-023要求的公开S5初始化，再执行100次真实propose、按返回proposalId排序并保留分页断言。
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 复用公开 scope/Goal，补真实 Session 和 entered Run；执行 100 次真实 propose，按返回 proposalId 排序并保留分页断言。（位置：tests/work-graph/WP2-context-extensions.test.ts:309; tests/helpers/S5-decision-fixture.ts:572; tests/helpers/S5-decision-fixture.ts:598; tests/helpers/S5-decision-fixture.ts:840；说明：S5 部分初始化已公开化，剩余 Session/entered 仍手造。）

### T1-070 · A2-33 · handwritten · tests/work-graph/unknown-call-review-list.test.ts:45-74
- **动作：** convert（仅少量记录的用例 80-161、198-253）:openK3ReviewCardWorld 里用 createK3PendingReview 造 pending_review、reachK3AwaitingProposal 得 needs_decision、settleK3Review 得 resolved，第二个 Goal 的记录需另一 Goal 的任务；165-194 的 205 条分页用例 keep-note（每条记录要一个任务加一次真实 Run，K3 世界只有 5 个任务，没有可行的公开步骤），保留现有 seed
- **覆盖/依据：** 原分页、Goal/status 过滤、open 过滤、游标边界、watermark 重试和双后端断言保留；断言中的 runId/排序要改为真实生成的 ref。
- **核实理由：** seed 强行改 status/open（unknown-call-review-list.test.ts:59-60）并统一写 created 事件（:69）属实；记录只由 Runtime 结束路径创建（run-machine.ts:2466、run-reconcile-service.ts:957），公开链在 K3-proposal-round.ts:256-270、863、588 存在。但 205 条用例（:165-194）要 205 个任务和真实 Run，K3 世界只有 5 个任务（K3-review-card-fixture.ts:60,336、K3-proposal-round.ts:117-123），无法照办；且断言里的固定 runId（:94-95,103,108,123-125,155）都要改，30 行偏低。
- **涉及测试：** listReviews共享seed及80起的分页/过滤用例
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：60
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：needs_decision和resolved路径写错，Goal/Plan硬编码，五任务不是不可扩展限制，watermark仍覆盖真实结果，且继承手写S5初始化（tests/helpers/K3-proposal-round.ts:169、:390、:879；tests/helpers/B2-crr-world.ts:119；tests/helpers/K3-35-continuation-fixture.ts:447；tests/work-graph/unknown-call-review-list.test.ts:213、:243）。 改法：needs_decision在review_unavailable后停止；resolved经真实done/unlikely核对轮正常结束并结算；贯穿goalRef/planRef；公开采用205任务并逐个产生记录；用真实公开写入和A3门控制造水位变化，保持4/6次及ready/not_ready断言；先完成公开S5初始化。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/work-graph/unknown-call-review-list.test.ts:45; tests/work-graph/unknown-call-review-list.test.ts:165; tests/work-graph/unknown-call-review-list.test.ts:198（按书面改正使用真实状态路径、205 个公开任务及真实水位+A3 门控。）

### T2-004 · F-43 · helper · tests/helpers/S4B-text-search-support.ts:24、94、104、183
- **动作：** delete:tests/helpers/S4B-text-search-support.ts:24、:94、:104、:183 去掉 export
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** 三个 importer（S4B-text-search.test.ts:11、SP-record-store-limits.test.ts:13、SP-text-scan.test.ts:15）都不导入 at/event/change/SearchRequest；它们只在本文件 :99-100/:114/:155/:173/:193 使用。
- **涉及测试：** SP/S4B 文本检索测试只 import keyOf/open/seed/search 等入口
- 来源：DSH；核实：confirmed；规格行：否；估计行数：4
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：撤销 change 导出会破坏 T2-012 合并后保留的 S2A 重开数据库用例。 改法：只撤销 at、event、SearchRequest 的导出；保留 change 导出。与 T2-012、T2-013 同批完成。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S4B-text-search-support.ts:24; tests/helpers/S4B-text-search-support.ts:104（按书面改正保留change导出。）

### T2-010 · D-17 · tamper · tests/record-store/R3a-transaction-boundaries.test.ts:['103-132']
- **动作：** delete
- **覆盖/依据：** 只为篡改：AGENTS.md:33（第 4 条，不恢复篡改数据库才能触发的防御校验/测试）；docs/MVP-BEHAVIOR.md:201
- **核实理由：** 123-124 行直接 UPDATE snapshots 把 Workspace JSON 里的 workspaceId 改掉而不动 revision；拒绝来自 sqlite-record-store.ts:324-345 的 currentRevisionOf 发现正文的 ref 和 ref_key 不符（damaged → invalid），正常写入每次都升 revision、正文由 ref 编码，真实并发只会走 revision_conflict，所以只有篡改能触发。
- **涉及测试：** SQLite rejects a same-revision scope identity change made after the Goal pre-read
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：30
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/R3a-transaction-boundaries.test.ts:123（原地篡改scope仍在。）

### T2-011 · D-19 · handwritten · tests/record-store/R3a-transaction-boundaries.test.ts:['17-29', '50', '81']
- **动作：** convert:createProjectBootstrapServices({records,now,eventId}).projects.createProject -> projects.registerWorkspace（同时把 22-23 行的 TrustedScopeSeeded 事件登记换成 PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events）
- **覆盖/依据：** 公开步骤 src/core/work-graph/configuration/project-bootstrap-contracts.ts:37-45；工厂 project-bootstrap-service.ts:1125；事件登记 project-bootstrap-record-codecs.ts:397-429
- **核实理由：** createProject 写 Project revision 1（project-bootstrap-service.ts:574-594），registerWorkspace 写 Workspace revision 1 且不改 Project revision（669-692），终态与手写 scopeSeed（R3a-transaction-boundaries.test.ts:25-29）相同，request 里的 revision:1 钉不用改；ctx 是 host+human，bindContext 接受（162-186）。注意 GOAL_RECORD_SCHEMAS 不含这两个事件（record-codecs.ts:668-682），转换时 schemas 要加 PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events，已有 tests/helpers/R3e-evidence-fixture.ts:143-145 的先例。
- **涉及测试：** scopeSeed; %s: beforeWrite belongs only to a real Goal write and receipts cannot mutate storage; SQLite rolls back a Goal write when the %s insert fails after earlier writes
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：15
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/R3a-transaction-boundaries.test.ts:17; src/core/work-graph/configuration/project-bootstrap-service.ts:1125（公开注册转换仍可执行。）

### T2-012 · D-33 · helper · tests/record-store/S2A-ordered-lookup.test.ts:24-140
- **动作：** merge-into:tests/helpers/S4B-text-search-support.ts::widgetSchemas 记录/事件部分 + keyOf/widget/event/change/open/seed（先让 helper 的 open 真正返回 dir；S2A 保留自己的三个索引、接受 unknown 的 withLookups、pageThrough/pageOf）
- **覆盖/依据：** tests/helpers/S4B-text-search-support.ts
- **核实理由：** S2A-ordered-lookup.test.ts:33-101、:141-146 与 S4B-text-search-support.ts:36-160 同义，核心属实；但 :103-139 的 pageThrough/pageOf 是 S2A 独有，不算重复；S2A 的 withLookups(unknown)（:47）用于 :342-345 的坏注册，共享版只收 RecordLookupIndex[]（:65）；共享 open 默认是 s4b-text 索引，S2A 的十几处 open(kind) 都要传自己的 schemas；且共享 open 在 :139-145 不返回 dir（类型 :129 声明了），S2A :94-95 的临时目录清理会丢，S4B 自己 :443 的清理也因此从不生效。按这些改，实际可省约 55 行而不是 80。
- **涉及测试：** 私有 keyOf / widget / event / change / widgetSchemas / withLookups / open / seed
- 来源：DSH；核实：partly；规格行：否；估计行数：55
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：共享 open 的 backend 类型缺少 S2A 所需 lookup 和 lookupOrdered。 改法：共享 backend 类型增加 RecordLookupPort、RecordOrderedLookupPort，并实际返回 dir；S2A 保留自己的索引、unknown 注册入口和分页函数，不用强制断言掩盖能力缺失。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/S2A-ordered-lookup.test.ts:47; tests/helpers/S4B-text-search-support.ts:69; tests/helpers/S4B-text-search-support.ts:139（仍需补lookup类型和dir，保留本地特殊注册与分页。）

### T2-013 · D-34 · helper · tests/record-store/S2C-count-lookup.test.ts:34-120
- **动作：** merge-into:tests/helpers/S4B-text-search-support.ts::widgetSchemas 记录/事件部分 + withLookups/keyOf/widget/event/change/open/seed（同 D-33，先修 helper 的 open 返回 dir；S2C 保留自己的五个索引和 countOf）
- **覆盖/依据：** tests/helpers/S4B-text-search-support.ts
- **核实理由：** S2C-count-lookup.test.ts:39-111 与 S2A 的私有构造器逐段相同，也与共享 helper 同义，核心属实；但 :113-118 的 countOf 是 S2C 独有；默认 schemas 不同（:50 五个索引），各处 open(kind) 要传自己的 schemas；共享 open 不返回 dir（S4B-text-search-support.ts:139-145），S2C :97-98 的临时目录清理会丢，需先修 helper。实际可省约 55 行。
- **涉及测试：** 同一组私有构造器
- 来源：DSH；核实：partly；规格行：否；估计行数：55
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：共享 open 的 backend 类型缺少 S2C 所需 countLookup。 改法：共享 backend 类型增加 RecordCountPort，与 T2-012 合成一次修改；保留 S2C 五个索引和 countOf，各次 open 显式传入本文件 schemas。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/S2C-count-lookup.test.ts:53; tests/helpers/S4B-text-search-support.ts:69（仍需补countLookup类型，与012同改。）

### T2-014 · D-25 · duplicate · tests/record-store/S4B-text-search.test.ts:['380-393']
- **动作：** merge-into:tests/record-store/S4B-text-search.test.ts::T-05 %s: two-at-a-time paging walks the refKey order to the end
- **覆盖/依据：** tests/record-store/S4B-text-search.test.ts:361-378::T-05 %s（368-373 对 memory、sqlite 各自断言固定 pages 和 completes）
- **核实理由：** 380-393 只断言两个后端的 pageThrough 结果相等；361-378 对两个后端分别断言同一组固定 pages 和 completes，相等已被蕴含。规格 slice-4-SPEC.md:638 的 T-05“两个后端逐条相同”仍由保留的 it.each 覆盖。
- **涉及测试：** T-05 both: the memory and sqlite backends agree page by page
- 来源：Codex；核实：confirmed；规格行：是；估计行数：14
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/S4B-text-search.test.ts:361; tests/record-store/S4B-text-search.test.ts:380（重复双后端比较例仍在。）

### T2-015 · D-22 · duplicate · tests/record-store/S4B-text-search.test.ts:675-725
- **动作：** merge-into:tests/record-store/S4B-text-search.test.ts::T-05 both: more than 1000 prefix records yield the same records on both backends
- **覆盖/依据：** tests/record-store/S4B-text-search.test.ts:675（并入 next/complete 两条断言后）
- **核实理由：** S4B-text-search.test.ts:675-690、:692-707、:709-724 三个 it 用同一 capRows（:669-673）、同一 request 各建两个后端各搜一次，只分别断言 refs、next、complete；合成一个 it 三条断言不丢任何东西，T-05 行名保留。
- **涉及测试：** T-05 both: more than 1000 prefix records yield the same records / next / complete on both backends（三个 it）
- 来源：DSH；核实：confirmed；规格行：是；估计行数：34
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/S4B-text-search.test.ts:675; tests/record-store/S4B-text-search.test.ts:692; tests/record-store/S4B-text-search.test.ts:709（三个重复准备仍可合并。）

### T2-016 · D-35 · helper · tests/record-store/SP-literal-type.test.ts:34-64；另 tests/record-store/SP-lookup-index-migration.test.ts:38-95
- **动作：** merge-into:tests/helpers/SP-record-store-support.ts（新建；放两文件逐字相同的 recordSchema、event、keyW/keyV、commitRow，typed 加一个可选默认体参数；open 两边不同，各自保留）
- **覆盖/依据：** 新建 helper，SP-literal-type.test.ts 和 SP-lookup-index-migration.test.ts 共用；测试本身不删、不改断言
- **核实理由：** 重复属实：recordSchema（SP-literal-type.test.ts:28-39 / SP-lookup-index-migration.test.ts:31-42）和 event（:41-46 / :48-53）逐字相同；但 DSH 说只有 SP-lookup 有 keyW/keyV/typed/commitRow 不对，SP-literal-type.test.ts:121-139 也有，commitRow 逐字相同，typed 只差 SP-literal 默认带 group:'shared'（:129 对 :63）；open 不同（SP-literal :48-56 内存加 sqlite，SP-lookup :76-84 只有 sqlite 加 newPath），不能合成一个。行号要改成 SP-literal-type :28-56、:121-139，SP-lookup :31-84；两边各删约 35 行、新 helper 约 40 行，改动约 70 行，净减约 30 行。
- **涉及测试：** 两份通用的 recordSchema / event / open / commit 构造器
- 来源：DSH；核实：partly；规格行：否；估计行数：70
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：第二个必须迁移的消费者未列入任何组白名单。 改法：增加 SP-lookup-index-migration.test.ts；共享 typed 的默认体先于调用方正文展开，literal 文件传 group:shared，migration 文件传空默认体，open 各自保留。
- **第一批之后已不存在的文件：** tests/helpers/SP-record-store-support.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/SP-literal-type.test.ts:28; tests/record-store/SP-lookup-index-migration.test.ts:31（重复实现仍在，目标helper原本就是待新建。）

### T2-017 · D-18 · tamper · tests/record-store/lookup.test.ts:['194-201']
- **动作：** delete
- **覆盖/依据：** 只为篡改：AGENTS.md:33；docs/MVP-BEHAVIOR.md:201。前半段 tests/record-store/lookup.test.ts:174-193 保留（测试名去掉“refuses to return a matching damaged row”）
- **核实理由：** 194-198 行直接 UPDATE snapshots，把 alpha 键下的正文 ref 改成 beta，200 行断言 corrupt；正常写入的正文由同一 ref 编码，这种 ref 与 ref_key 不符只能靠改库得到，不是真实边界输入。
- **涉及测试：** SQLite adds an index to an existing database and refuses to return a matching damaged row
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/record-store/lookup.test.ts:174; tests/record-store/lookup.test.ts:194（保留索引重开段，只删篡改段。）

### T2-018 · C07 · duplicate · tests/runtime/B2-04-allowance.test.ts:['72-85']
- **动作：** merge-into:tests/runtime/B2-09-allowance-crash.test.ts::B2-09a: a rejected consumeAllowance commit blocks the call, keeps allowed, then the retry runs
- **覆盖/依据：** tests/runtime/B2-09-allowance-crash.test.ts:41-63
- **核实理由：** B2-04-allowance.test.ts:72-85 的准备步骤、failNextCrrCommit、固定阻断文字和 allowed/revision 2/usedAt null，在 B2-09-allowance-crash.test.ts:47-57 里一样不少，那边还多查了 usedBy null 和重试放行（:60-62）。规格里 B2-04 这一行没有提交失败这一例（slice-K3-SPEC.md:1488），它归 B2-09（:1493）。实际就是删掉这条。
- **涉及测试：** B2-04: a failed consumeAllowance commit blocks the call and keeps the allowance allowed
- 来源：Codex；核实：confirmed；规格行：是；估计行数：14
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/B2-04-allowance.test.ts:72; tests/runtime/B2-09-allowance-crash.test.ts:41（覆盖关系仍成立。）

### T2-019 · C08 · duplicate · tests/runtime/B2-09-allowance-crash.test.ts:['65-92']
- **动作：** merge-into:tests/runtime/B2-04-allowance.test.ts::B2-04: allow_rerun lets exactly the card form run once, records usedBy, then blocks again —— 把 B2-09-allowance-crash.test.ts:82（usedAt 非空）、:84（只有一条 request）、:90（拦下理由含 request_command_rerun）、:91（拦下后仍是 used/revision 3）迁进 B2-04 :54-65，然后删 B2-09b (owner part) :65-92；B2-09a（:41-63）保留。
- **覆盖/依据：** tests/runtime/B2-04-allowance.test.ts:41-70（补断言后）；B2-09 行的崩溃半段 tests/scenarios/B2-09b-allowance-crash.test.ts:104（:221-229 也断言 used/revision 3/usedBy/usedAt/只有一条）
- **核实理由：** B2-09b owner part 的 :77-81、:88-89 和 B2-04 :48-56、:64-65 设置和断言相同；多出的只有 :82、84、90、91 四条，迁进 B2-04 就不丢东西。B2-09 行的崩溃那一半由场景测试 tests/scenarios/B2-09b-allowance-crash.test.ts 承担，行号仍有测试，所以 Codex 的合并比 keep-note 好。DSH 的说明漏了 :91。
- **涉及测试：** B2-09b (owner part): the committed consume leaves the request used with usedBy, and the same command is blocked again
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：28
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/B2-09-allowance-crash.test.ts:65; tests/runtime/B2-04-allowance.test.ts:41（四条独有断言仍需先迁入。）

### T2-020 · C09 · duplicate · tests/runtime/C1-communication-tools.test.ts:['115-120', '187-196']
- **动作：** delete
- **覆盖/依据：** tests/runtime/C2-runtime-platform-tools.test.ts:70-99::publishes the six frozen mailbox names and the workspace_read read-only registration label
- **核实理由：** C2:82-83 断言的 handle.names 和定义名与 C1:118-119 相同；C2:84-95 对三个读工具断言 read_only、三个写工具断言不是 read_only，覆盖了 C1:190-195，另外还查了 requiredCapabilities 和 independentReadOnly。名称和 effectClass 只由 communication-tools.ts:395、:608 决定，跟传入的 context 无关，所以 C1 用 host 上下文、C2 用 work_run 上下文不影响覆盖。删除后 C1:26 的 SESSION_MAILBOX_TOOL_NAMES 导入多出一行要删。
- **涉及测试：** publishes exactly the six fixed names and matching definitions; declares read_only for reads and a real platform side effect for writes
- 来源：Codex；核实：confirmed；规格行：否；估计行数：17
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/C1-communication-tools.test.ts:115; tests/runtime/C1-communication-tools.test.ts:187; tests/runtime/C2-runtime-platform-tools.test.ts:70（重复名称和效果分类例仍在。）

### T2-023 · C-13 · duplicate · tests/runtime/K3-continuation-review-note.test.ts:160-179,321-327 对 tests/runtime/K3-15-blocked-sentence-pure.test.ts:17-56
- **动作：** merge-into:tests/runtime/K3-15-blocked-sentence-pure.test.ts::renders the fixed pre-B3 text, including the marker and the ending —— K3-15:18-19 不用摘要字面量，改用 continuationBriefDigest(baseBrief()) 并断言它等于 a3a97065…；同时加上 K3-continuation-review-note.test.ts:326 的 unknownCallReview:null 与缺席等价断言；然后删 note 文件的 BASE_RENDER（:159-192）和 :321-327 那个测试。
- **覆盖/依据：** tests/runtime/K3-15-blocked-sentence-pure.test.ts::renders the fixed pre-B3 text（:17-56，补断言后）
- **核实理由：** 两处整段字面量逐行相同，可以合并；但 note 测试 :323-324 是用 continuationBriefDigest(brief) 现算摘要，是全 tests 里唯一钉住这个摘要等于 a3a97065… 的地方（K3-15:19 只是传入字面量），合并时要一起迁，DSH 只提了 null 断言。另外 BASE_RENDER 是 :159-192，不是 :160-179，删除行数约 41 行而不是 20 行。
- **涉及测试：** leaves a brief without unknownCallReview byte-identical to the pre-K3 bytes
- 来源：DSH；核实：partly；规格行：是；估计行数：38
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/K3-continuation-review-note.test.ts:160; tests/runtime/K3-continuation-review-note.test.ts:321; tests/runtime/K3-15-blocked-sentence-pure.test.ts:17（摘要字面值和null等价断言仍需一起迁。）

### T2-026 · C14 · tamper · tests/runtime/R4b-session-operations.test.ts:['144-160']
- **动作：** delete
- **覆盖/依据：** 行为已不存在要求：AGENTS.md:33 第 4 条（不恢复篡改数据库才能触发的防御校验/测试）；同文件 :71-142 的正常创建、分页、重试和跨工作区用例保留
- **核实理由：** R4b-session-operations.test.ts:153-155 用 DatabaseSync 直接 UPDATE Kernel 的 session_records，把正常写出的 session.created 改成 '{}'，才走到 session-operations.ts:460 的 verifyOriginalPositionOne。Kernel 自己的写入器不会产生这种记录，没有真实边界输入能到达，只能靠篡改。删掉后 :7 的 DatabaseSync 导入也不用了。
- **涉及测试：** fails closed when the original Kernel session.created record is damaged
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：18
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4b-session-operations.test.ts:144（损坏session.created例仍需删除。）

### T2-027 · C22 · handwritten · tests/runtime/R4b-session-operations.test.ts:['50-60']
- **动作：** convert:projects.createProject → projects.registerWorkspace
- **覆盖/依据：** 原文件 :71-142 用例保留；公开步骤 createProjectBootstrapServices（project-bootstrap-service.ts:1125），配 PROJECT_BOOTSTRAP_RECORD_SCHEMAS，内存和 SQLite 两种后端都能用；例子 tests/helpers/S1-workflow-archive-fixture.ts:306、tests/helpers/S4A-note-fixture.ts:178-181
- **核实理由：** R4b-session-operations.test.ts:50-60 手写快照和 TrustedScopeSeeded（:37），直接 backend.records.commit。公开注册 owner 存在（project-bootstrap-contracts.ts:37-45），依赖只有 GoalRecordTransactionPort，内存和 SQLite 后端都能接。
- **涉及测试：** open()：Session 创建、分页、重试及 scope 用例
- 来源：Codex；核实：confirmed；规格行：否；估计行数：13
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S1-workflow-archive-fixture.ts, tests/helpers/S4A-note-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4b-session-operations.test.ts:50; src/core/work-graph/configuration/project-bootstrap-service.ts:1125（公开注册转换仍成立。）

### T2-034 · C36 · handwritten · tests/runtime/S3-context-assembler.test.ts:['384-434', '660-661']
- **动作：** convert:真实 claimTask → prepareExecution → startRun 在 Run 入口提交后取消（或直接 ExecutionEntryPort.authorizeRuntimeEntry）→ 再 prepareExecution；graph/inputs 读取计数改成包一层转调的计数器
- **覆盖/依据：** 原 CA03/CA04/CA15 保留；tests/runtime/S4C2-assembly.test.ts:275-322::C-03 (%s) a publicly bound execution replays the saved input and never re-assembles 已示范公开绑定和包装计数（314-316）。
- **核实理由：** 419 行 executions.readExecution 直接返回手造的 TaskExecutionRecord（taskRecord 在 211-246 手拼 claim/outbox/run/session），661 行直接往 Run 上填 inputBinding/envelope、跳过 entry；公开步骤今天就有（S4C2-assembly.test.ts:290-301）。转换后 CA04 和 C-03 大部分重叠，但 CA04 是规格行（slice-3-SPEC.md:719），仍然保留。
- **涉及测试：** preparationHarness; CA03 two unbound preparations of the same facts share bytes and ArtifactRefs; CA04 a bound context ignores changed Goal/notes and never rereads graph or inputs; CA15 a throwing extension reader rejects unavailable instead of an empty array
- 来源：Codex；核实：confirmed；规格行：是；估计行数：53
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：绑定路径二选一；harness 仍有多个造值依赖，CA04 直接修改 objective，CA03 的整个假正文库大小无法照搬到真实世界。 改法：固定真实初始化、Runtime创建Session、claim、prepare、start后在入口提交点取消；禁止直接 authorizeRuntimeEntry。替换该 harness 的造值依赖。CA04 通过真实后继计划采用改变 Goal 指针、真实 note 写入改变注记，保留重放及零读取断言；CA03 用真实正文库委托包装统计两次 prepare 的不同 manifest 正文，期望1；CA15 在真实扩展依赖上注入抛错并保留 unavailable 和零正文写入。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/runtime/S3-context-assembler.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/S3-context-assembler.test.ts:385; tests/runtime/S3-context-assembler.test.ts:647; tests/runtime/S3-context-assembler.test.ts:662; tests/runtime/S3-context-assembler.test.ts:855（按书面改正整体转换harness和直接绑定。）

### T2-035 · C29 · handwritten · tests/runtime/S3-graph-tools.test.ts:['866-904']
- **动作：** convert:createProjectBootstrapServices 的 createProject/registerWorkspace（两个 Workspace）→ installCompletionPolicy/activateCompletionPolicy → createArchitectureCatalogService 的 adoptInitialArchitecture
- **覆盖/依据：** 原 GT07、GT08、GT09、GT13 保留（tests/runtime/S3-graph-tools.test.ts:464、490、515、604，都用 openInputFixture）；公开调用见 tests/helpers/S4A-note-fixture.ts:178-200，独立构造见 src/core/work-graph/configuration/project-bootstrap-service.ts:1125、src/core/work-graph/architecture/catalog-service.ts:451。
- **核实理由：** 866-904 手算 digest、直接编码 CompletionPolicyRevision、ArchitectureBaselineRevision、两个 Active 指针和 Project/Workspace，再加一个假的 TrustedScopeSeeded 事件，公开步骤都有。Codex 漏了 GT07（468 行同样调用 openInputFixture），转换时 GT07 也要保留。
- **涉及测试：** openInputFixture：GT08、GT09、GT13
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：39
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：公开注册写 Workspace revision 1，夹具与请求仍用7；schemas 未补齐。 改法：两个 Workspace 公开注册后统一使用手算 revision 1，同步 FX_WORKSPACE_REVISION、请求钉和来源版本；加入 PROJECT_BOOTSTRAP_RECORD_SCHEMAS、ARCHITECTURE_CATALOG_SCHEMAS，移除 TrustedScopeSeeded，保留四条 GT 业务断言。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** src/core/work-graph/architecture/catalog-service.ts, tests/helpers/S4A-note-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/S3-graph-tools.test.ts:866; src/core/work-graph/architecture/catalog-service.ts:450（公开初始化链仍可用，保留revision1和schemas改正。）

### T2-036 · C30 · handwritten · tests/runtime/S3-graph-tools.test.ts:['832-839', '967-983']
- **动作：** convert:claimTask 领取 tA（得到真实 Run A，作为正文 owner）→ claimTask 领取 tB（work_run 主体），不必先跑完 A；正文要在领取 A 之后按真实 Run A 的 ref 存
- **覆盖/依据：** tests/runtime/S3-graph-tools.test.ts:464::GT07、:490::GT08、:515::GT09、:604::GT13 原断言保留；领取公开流程可复用 tests/helpers/task-claim-fixture.ts:160 的 createTaskClaimFixture。
- **核实理由：** 832-839 和 967-983 直写 ended Run A（startedAt/endedAt 却是 null）和 starting Run B，属于手写事实。但输入 owner 只把 A 当正文 owner 读 task/scope（src/core/work-graph/tasks/context-input-service.ts:441-457），只把 B 当主体核对 task/workspace（268-281），都不看状态；DAG 依赖也不卡领取（src/core/work-graph/tasks/eligibility.ts:25-29），所以“先完成 A”多余，只需两次 claimTask。要接上领取所需的 Session/Role 夹具，改动行数比 25 多。
- **涉及测试：** fxRunSnapshot/commitRaw：GT08、GT09、GT13
- 来源：Codex；核实：partly；规格行：是；估计行数：40
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：所荐 task-claim fixture 仍手写 bootstrap 和 Session 事实，身份也不同；只换 Run 写入仍留下正文直写。 改法：在本文件 openInputFixture 中接上 T2-035；计划从真实脚本 Query 保存的 Answer 经 proposeInitialPlanFromAnswer 和采用产生；Runtime 创建两个 Session 后分别 claim tA、tB。返回真实 Run B 上下文；领取A后用 materials.storeArtifact 存正文，删除 rawBodies.put 播种。ArtifactRef 仍按固定正文手算，A不必结束，不修改 TP 的 task-claim helper。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** src/core/work-graph/tasks/context-input-service.ts, tests/helpers/task-claim-fixture.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 保留原公开claim和存正文转换；从真实readTaskInputs结果取得两项declarationId，替换legacy:r1/r2硬编码，并让四个GT调用使用真实Run B上下文。（位置：tests/runtime/S3-graph-tools.test.ts:967; tests/runtime/S3-graph-tools.test.ts:1001; src/core/work-graph/tasks/context-input-service.ts:372; .lead-ref/books/test-rule-sheet-v2.md:32；说明：仍硬编码平台派生的declarationId。）

### T2-037 · C37 · handwritten · tests/runtime/S4C-note-run-task-resolver.test.ts:['33-51']
- **动作：** convert:claimTask → 真实 RecordStore 的委托 readMany → createNoteRunTaskResolver
- **覆盖/依据：** 原 tests/runtime/S4C-note-run-task-resolver.test.ts:54-62::GTN20 保留；真实 records + claimTask 可用 tests/helpers/task-claim-fixture.ts:160,339,373（暴露 records 与 claim service）。recordsReturning/RUN_RECORD 仍被 GTN21（64-72）使用，不随转换删除。
- **核实理由：** 33-51 手写 RunSnapshot JSON 并由假 readMany 返回；解析器只读 task/planRef（src/core/work-graph/tasks/plan-readers.ts:1443-1463，parseRun 1129-1141），公开 claimTask 产出的 Run 满足同样状态，tests/helpers/task-claim-fixture.ts:373 已暴露真实 records 可包一层计数。注意 GTN21 仍用这些辅助。
- **涉及测试：** runJson/recordsReturning/RUN_RECORD; GTN20 resolves a work Run in one readMany and returns goalId/taskId/planRef
- 来源：Codex；核实：confirmed；规格行：是；估计行数：19
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：所荐 fixture 不符合 v1，其固定身份也不能保持 GTN20 的字面期望。 改法：GTN20 在本文件公开建立 p/g/pl/t1 世界，计划经真实 Answer 采用，Runtime 创建 Session 后 claim t1；用实际 RunRef/roleBinding 构造上下文，对同一真实 backend 的 readMany 委托计数，保留精确结果和一次读取。GTN21按原条目保留，不修改 TP helper。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** src/core/work-graph/tasks/plan-readers.ts, tests/helpers/task-claim-fixture.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** GTN20按原公开转换；GTN21用同一真实后端，在rejects中保留非work及缺失Run拒绝并公开核对未变；删除手造损坏记录子例及假端口。（位置：tests/runtime/S4C-note-run-task-resolver.test.ts:54; tests/runtime/S4C-note-run-task-resolver.test.ts:64; src/core/work-graph/tasks/plan-readers.ts:1444; src/core/work-graph/tasks/plan-readers.ts:1453; .lead-ref/books/t-w1-findings.md:27；说明：原样保留GTN21会留下手造记录和假端口。）

### T2-038 · C12 · duplicate · tests/runtime/S4C-note-tools.test.ts:['265-313']
- **动作：** merge-into:tests/runtime/S4C-note-tools.test.ts::GTN02/GTN03/GTN06
- **覆盖/依据：** tests/runtime/S4C-note-tools.test.ts:123-202::GTN02、GTN03、GTN06（把 toMatchObject 改成严格比较），并补 RW-14 独有的 facts:[]、空列表默认、review 无 reason/expectedPointerRevision 默认 null、withdraw 无 reason 默认 null 子例。
- **核实理由：** 处理器在 src/core/agent-runtime/note-tool.ts:290 直接把 recordNoteRequestOf 的结果交给 writeNote/reviewNote/withdrawNote，GTN02/03/06 已经过同一函数，但只用 toMatchObject（137-140、158-159），RW-14（265-313）的严格形状和默认值确实独有，必须迁移；RW-14 是 4C-1 返工编号（books/s4c1-rework.md:99），不是冻结规格表行，合并不丢行为。
- **涉及测试：** RW-14 write: maps the model args to the writeNote request with the trusted commandId and defaults; RW-14 write: an understanding carries sections and no body; absent lists default to empty; RW-14 review: maps verdict/resolution/defaults with the trusted commandId; RW-14 withdraw: maps the withdrawNote request with the trusted commandId
- 来源：Codex；核实：confirmed；规格行：是；估计行数：49
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：合并目标依赖固定返回成功结果的 NoteWrite/NoteCheck 假端口，与当前 v1 冲突。 改法：保留合并方向；lead 先在下一版规则点名 buildNoteTools，仅限本文件适配器参数映射和结果透传测试，不得用于业务 owner 达态。冻结后迁入严格形状及全部默认值子例。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/S4C-note-tools.test.ts:123; tests/runtime/S4C-note-tools.test.ts:265; .lead-ref/books/test-rule-sheet-v2.md:45（A7前置条件已满足，按改正合并。）

### T2-039 · B-04 · duplicate · tests/scenarios/C6-unrelated-adoption.test.ts:163-207
- **动作：** merge-into:tests/scenarios/C6-unrelated-adoption.test.ts::C6 main path
- **覆盖/依据：** tests/scenarios/C6-unrelated-adoption.test.ts:54-160::C6 main path
- **核实理由：** 变体（C6-unrelated-adoption.test.ts:163-205）的每条断言主路径都有，只是行号略有出入：claim 在 P1（92 行）；run/session/lease 不变（118-120）；start 结果（129-130）；轮次在 P2 下开（131）；satisfied 且没有 requeue（134-135）；没有 TaskRequeue（150）；key 相同（156-159）；授权审计记 P2（136-137）。变体只是把采用者换成 Host 身份，直接调 plans.applyPlanChange（support/plan.ts:394-397），被领取 Run 的守卫不看是谁采用的。
- **涉及测试：** C6 / an unrelated adoption after the claim does not stop the claimed Run ↔ C6 main path（54-161）
- 来源：DSH；核实：confirmed；规格行：是；估计行数：45
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/C6-unrelated-adoption.test.ts:54; tests/scenarios/C6-unrelated-adoption.test.ts:163（重复变体仍在。）

### T2-040 · B-15 · helper · tests/scenarios/K3-05-review-round.test.ts:45-58；其余27处见 evidence
- **动作：** merge-into:tests/scenarios/support/process-sandbox-standin.ts::createProcessSandboxStandin（28 个文件改用工厂内动态 import，hoisted 状态加 executeChecks:false；K3-12-14 不动）
- **覆盖/依据：** tests/scenarios/support/process-sandbox-standin.ts:21-69；用法同 tests/scenarios/K3-29-disposition-recovery.test.ts:46-51、K3-44-crr-kind4.test.ts:49-54
- **核实理由：** 逐个比对 28 个文件 class KProcessSandbox 起的 14 行，去掉缩进后的 md5 全部是 ab4cecc7，状态变量都是 sandbox.available。在 executeChecks:false 时，共享替身的 probe 两个分支返回值完全一样（process-sandbox-standin.ts:38-47）。共享替身多出的 execute 只在调用时抛 sandbox_unavailable，这 28 个文件的脚本模型都没有调用 run_readonly_command（只在工具清单断言里出现，比如 K3-42-truncated-command.test.ts:270）。K3-12-14-review-round.test.ts:60-76 有自己的 execute，确实应该排除。
- **涉及测试：** 28处重复 KProcessSandbox 类
- 来源：Codex；核实：confirmed；规格行：否；估计行数：392
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：缺少完整文件清单，21个必改文件不在白名单，四个归其他组；两个源文件即将删除；probe替身还与v1冲突。 改法：冻结26个存活迁移目标：本项files_add中的21个，加原白名单中的K3-05、K3-06、K3-09、K3-16-proposal、K3-19-review-unavailable。K3-13和K3-19-missing-read随删除项消失。先交接TP/T1冲突文件；lead在下一版规则点名本条executeChecks:false的probe用途后迁移，K3-12-14不动。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-05-review-round.test.ts:45; .lead-ref/books/test-rule-sheet-v2.md:59（executeChecks:false的A7前置条件已满足。）

### T2-041 · B-05 · duplicate · tests/scenarios/K3-06-mixed-batch.test.ts:174-239
- **动作：** merge-into:tests/scenarios/K3-05-review-round.test.ts::K3-05: RUN-25 leaves a process item pending（把 K3-06:185 的 toolName:'shell'/contained:true 和 K3-06:219-220 的 rounds[{phase:'review',round:1,result:'finished'}] 移入 K3-05；K3-06 只留 file_edit 和 platform 两例）
- **覆盖/依据：** tests/scenarios/K3-05-review-round.test.ts:86-198
- **核实理由：** K3-06 的 process 一例（K3-06-mixed-batch.test.ts:174-239）与 K3-05（:86-198）准备、脚本回复、断言几乎一字不差，但不是“没有新断言”：多了 :185 的 toolName/contained 和 :219-220 的轮次结果，K3-05 只断言了 kind 和 rounds 长度。裁定 2 那份书在 HANDOFF.md:607 已被认定判错；规格 §10.1（slice-K3-SPEC.md:1786）只要求保留真实的单条链，process 这一类的单条链 K3-05 已经有。所以 Codex 的合并对。
- **涉及测试：** K3-06 (process, L9/L10-L16)
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：63
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：遗漏 ended Run purpose、concluded/resolved 两阶段 item 数量断言，rounds来源行号也错误。 改法：除原清单外迁入 ended Run 的 unknown_call_review/review/round1 purpose，concluded.items和resolved.items各断言长度1；rounds来源修正为229行并保留单元素约束。目标名称带K3-06，再删除process源例。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-06-mixed-batch.test.ts:174; tests/scenarios/K3-05-review-round.test.ts:86（按改正补齐purpose、数量及rounds再合并。）

### T2-042 · B-06 · helper · tests/scenarios/K3-09-restart-between-calls.test.ts:108-135
- **动作：** merge-into:tests/scenarios/support/review-card-round.ts::crashOneCommand（K3-11、K3-17、K3-18、K3-19-missing-read、K3-19-review-unavailable、K3-45 六份与共享版逐字相同，直接改用；其余十份先给共享版加选项：返回 prepared、断言 W-26 报告、延后释放，否则保留）
- **覆盖/依据：** tests/scenarios/support/review-card-round.ts:58-79
- **核实理由：** 共享的 crashOneCommand 在 review-card-round.ts:58-79，不是 143-163（这个文件只有 129 行）。逐份对过：只有六份与共享版完全相同。K3-09:108、K3-37:120、K3-44-hold:80 要返回 prepared 并断言 W-26 报告；K3-10:122 和 K3-13:83 的参数或 id 不同；K3-29 的四个文件和 K3-44-recovery:80 把释放推迟到 crashHandles 或返回的句柄里，在途调用要一直卡着。这十份不能原样替换。
- **涉及测试：** local crashShellRun helpers repeated across the K3 scenario files
- 来源：DSH；核实：partly；规格行：否；估计行数：125
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：否则保留使迁移范围未冻结，选项不足以保持身份、参数、报告、释放时机和K3-37创建后断言。 改法：固定迁移删除项之外的14份。共享helper接收原调用、流程、请求身份及shell参数，返回真实runRef/prepared/report及幂等release，出错自动清理。即时释放者保留原位置；29-disposition、29-maintenance、29-continuation、29-round、44-recovery保持延后释放。各调用方保留W-26断言，K3-37保留创建后断言。删除否则保留。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-09-restart-between-calls.test.ts:108; tests/scenarios/support/review-card-round.ts:58（仍需扩充共享返回值、身份参数和释放责任。）

### T2-043 · B-06 · duplicate · tests/scenarios/K3-13-two-commands.test.ts:107-166
- **动作：** merge-into:tests/scenarios/K3-05-review-round.test.ts::K3-05: RUN-25 leaves a process item pending（并入 alias [1]、observed 精确 toEqual、定稿后 evidence 文本和 open:'no'，名字加 K3-13 映射；K3-13-two-items-owner.test.ts 保留）
- **覆盖/依据：** tests/scenarios/K3-05-review-round.test.ts:86-198；多条目部分在 tests/work-graph/K3-13-two-items-owner.test.ts
- **核实理由：** K3-13-two-commands.test.ts:83-103 只发一个 shell 调用，107-166 的流程（pending、done/unlikely、settle_review、resolved、原因为空）是 K3-05:113-181 的子集；它独有的只有 116 行 alias、118 行精确 observed、157 行 open:'no' 和 161-162 行 evidence 文本。发现里对 slice-K3-SPEC.md:1786 的引用只说了一半：那一行同时写了“真实单条链保留”。合并后这条链由 K3-05 承担，lead 要在 §10.1 注明。
- **涉及测试：** K3-13: the reachable single process item is concluded by the round and settles resolved with no reasons
- 来源：Codex；核实：confirmed；规格行：是；估计行数：60
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：遗漏定稿后items长度1，未明确源文件在唯一测试迁完后的删除。 改法：迁入settled/resolved.items长度1，与T2-041共用一次断言；迁完alias、严格observed、open、evidence后删除整份源文件，目标名称同时保留K3-05、K3-06、K3-13。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-13-two-commands.test.ts:107; tests/scenarios/K3-05-review-round.test.ts:86（独有断言迁完后删除整份源文件。）

### T2-044 · B-07 · helper · tests/scenarios/K3-16-proposal-round.test.ts:110-145
- **动作：** merge-into:tests/scenarios/support/review-card-round.ts::proposalRound（只抽“开 review root → driveReviewUntil(start) → 断言 L13 工具集 → startRun → close”这一段，答卡那一步各自留着）
- **覆盖/依据：** three inline copies; no shared helper exists
- **核实理由：** 三处真正相同的只有十几行提案轮驱动段：K3-16-approval-round.test.ts:122-138、K3-29-startup-variants.test.ts:207-229，以及 K3-16-proposal-round.test.ts:125-145 的一部分；工具集断言 129/131/218 行确实一样。答卡那一步不同：K3-29 是经重启到 awaiting_proposal 的（:190-196）。K3-16-proposal 用两次调用的脚本，并在 prepare 和 start 之间查 manifest（:132-142）。估计行数应从 80 降到 40 左右。
- **涉及测试：** inline proposal-round setup repeated in three files
- 来源：DSH；核实：partly；规格行：否；估计行数：40
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：整段封装没有保留prepare与start之间的检查位置及startup用例需要的RunRef，工具集名称也不够精确。 改法：proposalRound先open/prepare并断言工具恰为read、run_readonly_command、propose_safer_method，返回真实prepared、RunRef、model及绑定该prepared的start/close。调用方在start前保留manifest/writeScope检查，断言start ready并finally close；保留startup的RunRef/重启报告断言，答卡与settle留在调用方。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-16-proposal-round.test.ts:125; tests/scenarios/K3-16-approval-round.test.ts:122; tests/scenarios/K3-29-startup-variants.test.ts:207（按改正拆开prepare/start并保留中间检查。）

### T2-046 · B-09 · helper · tests/scenarios/K3-29-disposition-recovery.test.ts:109-166
- **动作：** merge-into:tests/scenarios/support/review-work-root.ts::openMissingReadReviewRoot(h, { label, hostInstanceId })；createNeedsDecisionRecord（K3-29-disposition 与 K3-44-recovery 两份）一并移入
- **覆盖/依据：** 五份内联副本：tests/scenarios/K3-17-review-answer-shape.test.ts:108、K3-19-missing-read-no-round.test.ts:141、K3-29-disposition-recovery.test.ts:109、K3-44-recovery-answers.test.ts:110、tests/work-graph/K3-18-review-card-queue.test.ts:129；没有共享 helper
- **核实理由：** 副本是五份，不是四份：tests/work-graph/K3-18-review-card-queue.test.ts:129 和 K3-17:108 逐字相同。五份只在 id 和文案上不同，但 K3-29:136、K3-44:137 用的是各自的 hostInstanceId，其余三份是 wp2-scenario-host，所以共享 helper 要把 hostInstanceId 作为参数；createNeedsDecisionRecord 的两份（K3-29:143、K3-44:143）除注释外完全相同。
- **涉及测试：** local openMissingReadReviewRoot / createNeedsDecisionRecord helpers
- 来源：DSH；核实：partly；规格行：否；估计行数：200
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：createNeedsDecisionRecord依赖本地延后释放，迁移未规定释放责任，且漏列三个消费者。 改法：在原目标文件共享两个函数；createNeedsDecisionRecord接收label、hostInstanceId，使用T2-042延后释放路径并返回release，由调用文件在原清理位置执行。保留host身份及settle/needs_decision/open/activeRound断言；不迁T2-045删除的副本。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-29-disposition-recovery.test.ts:109; tests/scenarios/K3-29-disposition-recovery.test.ts:143（仍需共享抽取，保留host身份和延后release。）

### T2-047 · B-02 · stale · tests/scenarios/K3-R1-file-change.test.ts:226-323
- **动作：** merge-into:tests/scenarios/K3-R1-file-change.test.ts::K3-04 (replace, L5/L6)（driveSingleEdit 加一个启动前钩子，写入 git 忽略目录；把 277-282、304、310-312、315-318 的断言搬进 replace 用例，再删注入例，并同步文件头 9-11、18-20 行）
- **覆盖/依据：** tests/scenarios/K3-R1-file-change.test.ts:186-207::K3-04 (replace, L5/L6)；209-224::K3-04 (create, L5/L6)
- **核实理由：** 注入例靠把 edit 改成 read_only + independentReadOnly（K3-R1-file-change.test.ts:83-86）才凑出两个在途调用。K3-13-two-commands.test.ts:5-6 记的裁定 1 禁止为凑并行改工具的作用类别，slice-K3-SPEC.md:1786 也写了“多条目只走无存储的纯测试，不为凑合用篡改状态”。它独有的可见性（notVisible）、受保护文件名、workspaceBaseline 是 Artifact 引用这几条（文件头 17 行把最后一条记成 K3-04 的断言，但两个单调用用例没有断言它），场景层只有这里有，必须先搬过去。
- **涉及测试：** injection example (not R1): a read-only independent stand-in makes a two-entry review reachable
- 来源：Codex；核实：confirmed；规格行：否；估计行数：98
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：启动前钩子的时点不确定，helper不返回manifest，且漏了单条edit的toolName/kind断言。 改法：钩子固定在HostScenario.open后、首次advance前；driveSingleEdit返回实际manifest。迁移原列出的可见性、保护名和baseline断言，replace/create各补toolName:edit、kind:file_edit。仅移除已取消的双调用数量和并行身份断言，再删注入例。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-R1-file-change.test.ts:144; tests/scenarios/K3-R1-file-change.test.ts:186; tests/scenarios/K3-R1-file-change.test.ts:226（注入例仍在，先迁断言再删。）

### T2-048 · B-12 · handwritten · tests/scenarios/K3-r1-seams.test.ts:137-160
- **动作：** delete（K3-r1-seams.test.ts:136-160，连同 appendEvent、DatabaseSync/tempDir 的 import）
- **覆盖/依据：** tests/scenarios/K3-R1-restart-flows.test.ts:84-101（crashSendFlow 在 :90 用 SessionMessageSent + kernelStore 上锁，:97 断言 lock.locked()，K3-01 :146 和 K3-03 :241 都走它）；证据提交点那把锁只有 K3-r1-seams:162-182 在用（见 B-14）
- **核实理由：** 145-160 在自建的假 events 表上手动调 observer。它断言的“按最后一个事件类型上锁”，crashSendFlow 已经经 runtime.startRun 在真实流程里断言过（K3-R1-restart-flows:90、97）。Codex 想转成的 runtime.startRun + lockLedgerAfter 就是这条现成流程，转出来只会多一份重复，所以删是对的。但 DSH 引的覆盖来源 K3-R1-restart-flows:210-238（K3-02）根本不用 lockLedgerAfter，走的是 mailboxSeam（:113-139），覆盖来源要改成上面这条。
- **涉及测试：** locks at ModelRequestEvidenceRecorded (K3-02, before the message) and at SessionMessageSent (K3-01)
- **同一条的其他冲突裁定：** B-14: delete（K3-r1-seams.test.ts:162-182，连同文件头 :19-45 第 3 条的配方说明，以及随之无用的 import：createAG2bSession/AG2B_QUERY_ROLE/WORK_TARGET/openWorkRoot/preparedOf/readSqlite 等）；类别改为 stale
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：否；估计行数：26
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/scenarios/K3-R1-restart-flows.test.ts, tests/scenarios/K3-r1-seams.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/K3-r1-seams.test.ts:137; tests/scenarios/K3-r1-seams.test.ts:162; tests/scenarios/K3-R1-restart-flows.test.ts:90; tests/scenarios/K3-R1-restart-flows.test.ts:97（待删段及真实锁点覆盖仍在。）

### T2-053 · B-24 · trivial · tests/scenarios/harness.test.ts:191-212
- **动作：** delete
- **覆盖/依据：** tests/scenarios/C5-reverify-guards.test.ts::(a) verification_uncovered…（:81-90,:107-116 registerCheck 是新配置修订并被轮次冻结）；tests/scenarios/C8-auto-rework-cap.test.ts::C8 (§13.4 #15, AV-8, GOAL-30)（:62-64 自动返工 #1/cap 3）；tests/scenarios/A11-no-progress.test.ts::A11 #15（:398-408 setAutomation 降上限后 stopped/auto_rework_cap_reached、再推进 waiting 无回执、计数不变）
- **核实理由：** DSH 说 setAutomation/automationPolicy 和 registerCheck 修订断言只见于本用例，不对：A11-no-progress.test.ts:398 同样用 h.setAutomation 并在 :399-408 断言停止、无回执、计数不变，automationPolicy() 在 C8:117 等多处使用，registerCheck 的修订在 C5-reverify-guards.test.ts:81-90,107-116 断言。harness.test.ts:191-212 的断言全部已被覆盖，应删（文件头第 17-18 行同步删）。
- **涉及测试：** platform mode seams: a registered check is a new configuration revision; cap 0 stops the automatic rework
- 来源：DSH；核实：partly；规格行：否；估计行数：22
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：所引A11测试是cap1，覆盖说明缺少cap0的实际断言位置。 改法：覆盖依据增加tests/app/A2-automation-verdict.test.ts:120-133负责cap0保存和TaskRow停止；A11继续负责下调上限、waiting、空receipt、计数不变。删除动作保持不变。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/scenarios/A11-no-progress.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/harness.test.ts:191; tests/scenarios/A11-no-progress.test.ts:398; tests/app/A2-automation-verdict.test.ts:119（按改正后的cap0/cap1覆盖说明删除。）

### T2-054 · B-26 · helper · tests/scenarios/harness.ts:626-632
- **动作：** delete
- **覆盖/依据：** —（无测试使用）
- **核实理由：** 全仓 Grep `kernelRecords(` 只命中定义 harness.ts:627 和 R4-control-runtime.test.ts:82 的同名局部函数；其余都是 h.counts() 返回值的字段 kernelRecords（如 A8-host-restart.test.ts:110,120），方法 626-632 无人调用。
- **涉及测试：** ScenarioBase.kernelRecords()
- 来源：DSH；核实：confirmed；规格行：否；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/harness.ts:627（无调用方法仍在。）

### T2-055 · B-27 · helper · tests/scenarios/harness.ts:1283-1287
- **动作：** delete
- **覆盖/依据：** —（无测试使用）
- **核实理由：** 全仓 Grep setTokenBudget 只命中定义 harness.ts:1284，tests/ 与 src/ 无调用。
- **涉及测试：** PlatformScenario.setTokenBudget()
- 来源：DSH；核实：confirmed；规格行：否；估计行数：5
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/scenarios/harness.ts:1284（无调用方法仍在。）

### T2-056 · D-12 · duplicate · tests/state/S1-anomaly.test.ts:132-138
- **动作：** merge-into:tests/state/S1-anomaly.test.ts::UT19 only a claimed successor carries the anchor, so it is not picked up and the Task waits for dispatch
- **覆盖/依据：** tests/state/S1-anomaly.test.ts::UT19（:106-115）
- **核实理由：** UT21（S1-anomaly.test.ts:132-139）和 UT19（:106-115）都调 deriveSessionAnomalyView(anchor, [])，UT19 断言 pickedUpBy:null、label 中断，待核对、next dispatch，UT21 的三条断言是其子集；函数只收 entered 列表（session-anomaly.ts:55-58），“cancelled 未进入”在这一层无法表达，spec 行 slice-1-SPEC.md:911 的给定值没测到。
- **涉及测试：** UT21 a cancelled successor that never entered carries the anchor but does not pick it up
- 来源：DSH；核实：confirmed；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/state/S1-anomaly.test.ts:106; tests/state/S1-anomaly.test.ts:132（重复输入仍在，合并名称保留编号。）

### T2-060 · D-20 · duplicate · tests/state/command-rerun-request-pure.test.ts:['102-108']
- **动作：** merge-into:tests/state/command-rerun-request.test.ts::CRR-02 refuses an answer that does not name this card (invalid)
- **覆盖/依据：** tests/state/command-rerun-request.test.ts:164-167::CRR-02 refuses an answer that does not name this card (invalid)
- **核实理由：** command-rerun-request-pure.test.ts:102-108 和 command-rerun-request.test.ts:164-167 设置一样（构造器出的 pending@1 记录、allowedAt 都是 2026-01-02 的 allowed 事件、cardMatches:false），断言也一样，都是 guard_failed/invalid。CRR-02 这一行还留着；要删的是整个 describe 块（:101-109）。和 D-21 一起做的话，allowedEvent/messageRef 这几个辅助函数就没人用了，可以顺手去掉。
- **涉及测试：** refuses an answer whose card key does not match, writing nothing
- 来源：Codex；核实：confirmed；规格行：是；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/state/command-rerun-request-pure.test.ts:102; tests/state/command-rerun-request.test.ts:164（重复拒绝例仍可合并。）

### T2-061 · D-21 · duplicate · tests/state/command-rerun-request-pure.test.ts:['91-98']
- **动作：** merge-into:tests/state/K3-B3-shared-rules-pure.test.ts::accepts forms 1..8 and refuses the ninth with capacity (hand literals)（把 command-rerun-request-pure.test.ts:91-98 并入，带上 reason:'guard_failed'；保留 command-rerun-request-pure.test.ts:78-89 的构造器上限）
- **覆盖/依据：** tests/state/K3-B3-shared-rules-pure.test.ts:89-117
- **核实理由：** 重复属实，但方向反了：F-081（K3-B3-shared-rules-pure.test.ts:89-117）逐条 forms_added 接受 1..8、核对 8 条内容、第 9 条 capacity 并核 detail 文字，比 command-rerun-request-pure.test.ts:91-98（直接用构造器装满 8 条，只核 reason/code）更全；按 DSH 删 F-081 会丢逐条追加和 detail，按 Codex 只需把 :97 的 reason 带过去，CRR-01/CRR-07 的 describe 仍由 :78-89 保留。
- **涉及测试：** refuses forms_added on a full eight-form request with capacity
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/state/command-rerun-request-pure.test.ts:91; tests/state/K3-B3-shared-rules-pure.test.ts:89（迁入guard_failed，保留构造器上限例。）

### T2-062 · D-26 · tamper · tests/state/control-intent-machine.test.ts:602-606, 853-857, 859-876
- **动作：** delete
- **覆盖/依据：** 行为已不存在：AGENTS 第 4 条、决定 79-4；两种输入连改库都到不了（ControlIntent 解码 control-record-codecs.ts:302-304 拒绝没有 kind 的记录；Run 解码 materials/record-readers.ts:202-204 拒绝坏的 executionHistory），生产 control-intent-machine.ts:723/756/844 只剩类型收窄
- **核实理由：** 控制意图状态只来自 controlIntentStateOf（control-intent-machine.ts:330-333），非 Absent 时 kind 取自已过解码的记录，解码器 control-record-codecs.ts:302-304 不认 null kind；history:'malformed' 只在 control-service.ts:231 产生，而 Run 解码 record-readers.ts:202-204 已拒绝任何不合格的 executionHistory，所以 :602-606、:853-857、:859-876 测的分支连篡改都走不到，删除无损。小更正：:602-606 用 SUPERSEDED_EVENT、:853-857 用 observedEvent，不是“同输入”。
- **涉及测试：** a recorded state without a kind is malformed（同名两条）；a stored locator that fails the locator codec is unavailable right after the missing-locator row (`control-service.ts:551`)
- 来源：DSH；核实：confirmed；规格行：否；估计行数：28
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：602-606多包含外层describe结束括号。 改法：第一段只删602-605并保留606；另两段删853-857、859-876并保留877。同步修正条目标题和核实理由。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/state/control-intent-machine.test.ts:602; tests/state/control-intent-machine.test.ts:853; tests/state/control-intent-machine.test.ts:859（三段仍在，按改正保留外层结束括号。）

### T2-063 · D-18 · duplicate · tests/state/k3-review-claim.test.ts:92-98
- **动作：** merge-into:tests/state/k3-review-claim.test.ts::K3-38 refuses every review-claim guard with its own row
- **覆盖/依据：** tests/state/k3-review-claim.test.ts:79；ordinary claim 回答 busy 的真实断言在 :100-111
- **核实理由：** k3-review-claim.test.ts:96-97 只断言 reviewClaimProblem(null) 为 illegal/invalid，与 :79 完全相同，标题说的 busy 一条也没断言；真正的 ordinary claim busy 由下一条 :100-111 的 claimBasisProblem 断言，删掉 :92-98 不丢行为。
- **涉及测试：** K3-38 lets an ordinary (first/requeue) claim answer busy while the record is unsettled
- 来源：DSH；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/state/k3-review-claim.test.ts:79; tests/state/k3-review-claim.test.ts:92; tests/state/k3-review-claim.test.ts:100（重复空输入例仍在，保留真正ordinary busy例。）

### T3-028 · E2-40 · helper · tests/business/K3-17-goal-guard.test.ts; tests/business/K3-46-review-advance-failures.test.ts; tests/business/K3-UR7-crr-failed-set.test.ts:62-80; 258-275,282-301,331-370; 152-176
- **动作：** merge-into:tests/helpers/K3-review-card-fixture.ts
- **覆盖/依据：** 不适用（重构：抽出“识别 disposition_applied 提交并拦截”的共用包装器）
- **核实理由：** 同一谓词（UnknownCallReviewChanged 且 JSON.parse(json).change==='disposition_applied'）确有五份：K3-17-goal-guard.test.ts:66-71、K3-46-review-advance-failures.test.ts:263-268/287-292/354-359、K3-UR7-crr-failed-set.test.ts:159-164，tests/helpers 里没有现成的；K3-46:331-370 的 pausedBeforeDisposition 比 K3-17:62-80 多了自建 setGoalControl 和 onConflict 回报，只是外壳同构，抽出时要保留这个参数。
- **涉及测试：** pausedBeforeDisposition; failingDispositionRecords; failingDispositionRecordsPerCard; failingCardCommits
- 来源：DSH；核实：confirmed；规格行：否；估计行数：45
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/business/K3-46-review-advance-failures.test.ts, tests/business/K3-UR7-crr-failed-set.test.ts, tests/helpers/K3-review-card-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/K3-17-goal-guard.test.ts:62; tests/business/K3-46-review-advance-failures.test.ts:255,279,328; tests/business/K3-UR7-crr-failed-set.test.ts:151（抽共用提交拦截包装并保留回调差异。）

### T3-030 · E2-38 · helper · tests/business/K3-46-review-advance-failures.test.ts:124-154,157-173,315-328
- **动作：** merge-into:tests/helpers/K3-review-card-fixture.ts
- **覆盖/依据：** 不适用（重构）
- **核实理由：** 逐段 diff 了 K3-46-review-advance-failures.test.ts:124-154/157-173/315-328 和 K3-UR7-crr-failed-set.test.ts:322-352/179-195/86-99，只差 planId、requestId 和 eventId 前缀、错误文案、一处 as const。全 tests 树只有这两份定义，两个文件都已从 tests/helpers/K3-review-card-fixture.ts 导入。
- **涉及测试：** adoptReorderedPlan; reviewServiceOver; waitForSettledDriver
- 来源：DSH；核实：confirmed；规格行：否；估计行数：62
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：拟抽取的 waitForSettledDriver 使用 setTimeout 轮询，违反新 helper 的规则要求。 改法：创建 driver 时安装 onChange 通知，等待通知后通过 driver.read 检查终态，保留首次立即读取，删除两份睡眠轮询并一起迁移调用点。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/business/K3-46-review-advance-failures.test.ts, tests/helpers/K3-review-card-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/K3-46-review-advance-failures.test.ts:123,156,312; tests/business/K3-UR7-crr-failed-set.test.ts:85,178,318（按书面改正抽取并用通知替换轮询。）

### T3-031 · E2-06 · duplicate · tests/business/K3-UR7-crr-failed-set.test.ts:544-561
- **动作：** merge-into:tests/business/K3-46-review-advance-failures.test.ts::K3-46 (三) (%s) input: every public failedReviewRefs is refused invalid, even a real same-project card（把 failedCardRefs 键和 next 不带 failedCardRefs 的检查并进去）
- **覆盖/依据：** tests/business/K3-46-review-advance-failures.test.ts:629-659（failedReviewRefs 部分）
- **核实理由：** 生产 workflow.ts:725 对 failedReviewRefs 和 failedCardRefs 两个键都拒绝；K3-46:647-653 只测 failedReviewRefs，next 检查 hasFailedReviewRefs（378-380）也只看这一个键。K3-UR7-crr-failed-set.test.ts:548-559 是唯一测 failedCardRefs 被拒的地方，所以只能合并、不能直接删，DSH 的证据已写明这点。
- **涉及测试：** the failed-card set is never a public advance input (both field names are refused); K3-46 (三) (%s) input: every public failedReviewRefs is refused invalid, even a real same-project card
- 来源：DSH；核实：confirmed；规格行：是；估计行数：18
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/business/K3-46-review-advance-failures.test.ts, tests/business/K3-UR7-crr-failed-set.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/K3-UR7-crr-failed-set.test.ts:540; tests/business/K3-46-review-advance-failures.test.ts:626（合并双字段拒绝及next检查，按A6组织。）

### T3-032 · E2-05 · duplicate · tests/business/K3-review-workflow-rows.test.ts:560-575
- **动作：** merge-into:tests/business/K3-15-ur3h.test.ts::K3-15 (六) %s: hold then the next advance cancels the round (RUN-09(U)), UR4 settles it (UCR-08b), zero model calls
- **覆盖/依据：** tests/business/K3-15-ur3h.test.ts:203-248
- **核实理由：** K3-review-workflow-rows.test.ts:560-575 用真实 claim（327-334）+holdReview（399-409）造“held 且有未进入的一轮”，只断言下一次 advance 给 cancel_review_round 和 settleCalls 0；K3-15-ur3h.test.ts:211-224 同样前置、同样断言 cancel 请求（还钉 revision），并继续断言取消、settle 和记录结果，两边都跑 memory/sqlite。
- **涉及测试：** K3 UR8 (%s): a held record with a claimed round is skipped, never prepared or settled; K3-15 (六) %s: hold then the next advance cancels the round (RUN-09(U)), UR4 settles it (UCR-08b), zero model calls
- 来源：DSH；核实：confirmed；规格行：是；估计行数：16
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/K3-review-workflow-rows.test.ts:560; tests/business/K3-15-ur3h.test.ts:203（原合并成立。）

### T3-033 · E2-24 · handwritten · tests/business/K3-review-workflow-rows.test.ts:733-775,936-951
- **动作：** convert:<real claimK3ReviewRound + endK3RunCompleted 起 review Run，经 Workflow perform 真实 settle_review；在 makeRealWorld 的 settleReview 包装（K3-review-workflow-rows.test.ts:299-302）里记下 owner 返回值，断言 receipt.result 与之 toEqual，并断言 next 是 select_work>
- **覆盖/依据：** 不适用（转换，不删）；untouched（746-751）另有 975、1067、1256 三处在用，要留
- **核实理由：** F-045 例用手搓 RunSnapshot 和替身端口（K3-review-workflow-rows.test.ts:735-772，注释自述 over no store），rawRun/performWorld/performOf 只有 941-942 这一处用；同文件 K3 A（878-918）已走真实 claim、end 和真实 settle_review，包装 299-302 能拿到 owner 原样结果，公开步骤今天存在。
- **涉及测试：** K3 settle_review: the owner receipt is preserved field for field and the next selection follows
- 来源：DSH；核实：confirmed；规格行：否；估计行数：30
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：动作指定把捕获的 owner 输出直接作为完整期望，违反独立期望规则。 改法：从固定输入和确定调用序列独立列出完整 expectedOwnerResult，分别比较 owner 结果和 receipt.result；包装原样返回真实结果，并保留 next:select_work。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/K3-review-workflow-rows.test.ts:735,936; tests/helpers/K3-proposal-round.ts:383,526（按书面改正走真实轮次并独立列期望。）

### T3-034 · E2-39 · helper · tests/business/K3-review-workflow-rows.test.ts:972-997,1064-1090,1253-1282
- **动作：** merge-into:tests/business/K3-review-workflow-rows.test.ts::realOwnerWorkflow（加选项：consumerId、记录 apply 结果的回调、messages）
- **覆盖/依据：** 不适用（重构）
- **核实理由：** K3-review-workflow-rows.test.ts:972-994 和 1253-1282 两处内联的 createWorkflow，跟 1063-1090 的 realOwnerWorkflow 参数一样，只差 consumerId、applied.push（1019-1020 断言了 applied）和 messages。合并时要给 helper 加一个收 apply 结果的回调。
- **涉及测试：** K3 UR7 real owner; realOwnerWorkflow; K3 UR7b two real handed-over answers
- 来源：DSH；核实：confirmed；规格行：否；估计行数：50
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：原样合并会把假 Goal settings 和 Map messages 替身带入新 helper。 改法：goalSettings 固定接 world.goalSettings；暴露 world 已创建的真实 mailbox，messages 接该 mailbox，删除 byMessageId 替身；保留 consumerId 和真实 apply 结果观察回调。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/K3-review-workflow-rows.test.ts:972,1064,1253（接真实settings和mailbox后统一。）

### T3-044 · E1-24 · handwritten · tests/composition/WP2-wiring.test.ts:['129-139', '767-772', '934-935', '1039-1050', '1183-1184', '1402-1403', '1542-1543', '1637-1638', '1808-1822', '1950-1951', '2046-2047']
- **动作：** convert: probe 为 missing 的 10 处（helper 131-134 供 F09/F10/F12，F11 767，F13 934，F15 1039/1049，F14 1183/1542/1637，F10p 1950，F10n 2046）改成 moveKernelAside(f.directory) → sessions.readSession(f.ctx, ref).value.record（reconcileRun/reconcileQuery 直接用 record.value.session）→ reconcile.probe(session, signal) → 原 recordSessionHealth/reconcileRun/reconcileQuery → restoreKernel，restore 必须在下一个读写 Kernel 的步骤（prepareExecution、D 的回复 Run、resolveUnknownRun、放行在途 Run）之前；F12 的 ready 在 restore 后真实 probe；ready 的 3 处（F10r 1402，F10q 1808/1821）直接 reconcile.probe(record.value.session)。保留 F09–F15 全部业务断言与提交顺序。
- **覆盖/依据：** src/composition/create-platform.ts:2049-2077::reconcile.probe/recordSessionHealth/reconcileRun/reconcileQuery；src/composition/create-platform.ts:1268::sessions.readSession；tests/helpers/A2-restart-fixture.ts:200-215::moveKernelAside/restoreKernel（今天只在 Host 关闭与重启之间用过）；保留原 F09–F15 断言
- **核实理由：** 核心属实：WP2-wiring.test.ts 所列 11 处都把手写 probe 交给 platform.reconcile 的 owner，而生产路径是先 reconcile.probe 再写（src/app/startup-reconcile.ts:304-308），真实 probe 只按 Kernel 文件是否存在判 missing（src/core/agent-runtime/session-operations.ts:1050-1051），lead 在 L8 验收第 91、104 行已把同类手造探测列进 T。但 action 原文缺了“移开再恢复 Kernel”这一步，照字面走 readSession→probe 会拿到 ready、改掉场景；两个世界共用一个 kernel.sqlite（tests/helpers/WP2-platform-support.ts:415-416），F11、F15 在 D 的在途 Turn 里写健康，F10n、F10p 有在途 Run（Kernel 在 Turn 期间按 databasePath 打开库，observed-model-run.ts:311），所以每处都要在下一个 Kernel 步骤之前恢复，行数也会比 60 多。
- **涉及测试：** F09 reply after unavailable; F10 reply before unavailable、Work reconcile、Query recovery、Work recognition; F11 same-cursor notices; F12 SES-13 recovery; F13 responsible link and wait transfer; F14 Work reply、user answer、Query Answer; F15 failed reply or health commit
- 来源：Codex；核实：partly；规格行：是；估计行数：70
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** src/app/startup-reconcile.ts, src/composition/create-platform.ts, src/core/agent-runtime/session-operations.ts, tests/composition/WP2-wiring.test.ts, tests/helpers/A2-restart-fixture.ts, tests/helpers/WP2-platform-support.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/WP2-wiring.test.ts:134,1403; src/composition/create-platform.ts:2027; tests/helpers/A2-restart-fixture.ts:213,221（移开、真实probe、及时恢复仍适用，原样传结果。）

### T3-077 · F-06 · duplicate · tests/helpers/B2-401-world.ts:185-198（openK3ReviewCardWorld → openK3BlockedReviewServices → seed → answer → openRealRunHarness）
- **动作：** merge-into:tests/helpers/K3-blocked-command-fixture.ts::openK3BlockedCommandWorld('sqlite', { commands, files: FILES })，不需要新选项；B2-401 自己 answer，并把 services.reviews/seeded.run/seeded.claim 改成返回值的 reviews/run/claim
- **覆盖/依据：** openK3BlockedCommandWorld（B2-blocked-runtime.ts:391-398 同用法）
- **核实理由：** 启动段确实相同，但 openK3BlockedCommandWorld 已经收 kind 参数并固定 realKernelCommandFacts:true（K3-blocked-command-fixture.ts:536-551），DSH 说要“暴露成 option”不成立；唯一差别是 seed 的 label（'b2-401' 对 'seed'，:552-554），B2-401-world.ts:185-194 换成一次调用只省约 5 行，不是 14 行。
- **涉及测试：** tests/runtime/B2-401-world.test.ts
- 来源：DSH；核实：partly；规格行：否；估计行数：5
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/K3-blocked-command-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/B2-401-world.ts:185; tests/helpers/K3-blocked-command-fixture.ts:532（共用入口仍适用，无须新选项。）

### T3-078 · F-03 · helper · tests/helpers/B2-crr-world.ts:226-238
- **动作：** delete
- **覆盖/依据：** 无消费者；不删除测试用例或断言。
- **核实理由：** 全库 grep runSnapshotOf 只有 tests/helpers/B2-crr-world.ts:231 的定义，tests/business/K3-UR7-crr-failed-set.test.ts 存在但不引用它。删掉之后 :15 的 RunSnapshot 类型导入就没人用了，也要一起删，所以是 14 行。
- **涉及测试：** runSnapshotOf
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：14
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/business/K3-UR7-crr-failed-set.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/B2-crr-world.ts:231（原删除成立。）

### T3-079 · F-05 · duplicate · tests/helpers/K3-35-continuation-fixture.ts:924-933（review round 链）
- **动作：** merge-into:tests/helpers/K3-proposal-round.ts::runK3ReviewRound，先给 K3ReviewRoundOptions（:783-792）加 planRef? 并在 :809 传给 claimK3ReviewRound；K3-35 改调它后自查 settled.status
- **覆盖/依据：** runK3ReviewRound（加 planRef 选项后）
- **核实理由：** 链条相同（claim→recordConclusion→endRunCompleted→settle，K3-35-continuation-fixture.ts:924-930 对 K3-proposal-round.ts:807-819），但 K3-35 给 claimK3ReviewRound 传了 planRef（:924，taskIdBytes 时来自 adoptK3PlanTask，:826），runK3ReviewRound 只传 phase，会落到 PLAN_B2（:390），不加选项就不是同一行为。
- **涉及测试：** K3-35 场景本身
- 来源：DSH；核实：partly；规格行：否；估计行数：6
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/K3-35-continuation-fixture.ts:924; tests/helpers/K3-proposal-round.ts:783,810（先加planRef透传，再合并。）

### T3-080 · F-23 · helper · tests/helpers/K3-35-continuation-fixture.ts:117-122（re-export 块）、130、157-160、199、212、236
- **动作：** delete：把 K3-35-continuation-fixture.ts:119-122 的转出口收成 APPROVED_COMMAND、K3_35_REQUIRED_REVIEW_BLOCK_ONE、approvedMethodBlockBytes 三项（at/P/W/APPROVED_COMMAND 本文件内部仍在用，import 保留）；:130、:157、:158、:160、:199、:212、:236 七处去掉 export
- **覆盖/依据：** 无外部消费者：25 个 importer（含 K3-review-card-fixture.ts:439 的动态 import）只取 openRealRunHarness、K3_35RealRunHarness、K3_35PublicRecord、openK3_35PublicRecord、readRunBoundary、APPROVED_COMMAND、K3_35_REQUIRED_REVIEW_BLOCK_ONE、approvedMethodBlockBytes、WORST_REASON
- **核实理由：** 核实了所有 importer 取的名字：G、P、W、at、baseBrief、sha、task 都没人从这个文件 import；SAFER_NOTE、K3_35_TASK_ID、K3_35_ANCHORS 和四个 options 类型，全仓只在本文件出现。WORST_REASON（K3-35-approved-methods-brief.test.ts 在用）和 K3_35PublicRecord（:170）保留，DSH 也没动它们。
- **涉及测试：** 取本文件的测试只 import openRealRunHarness、APPROVED_COMMAND、K3_35_REQUIRED_REVIEW_BLOCK_ONE、approvedMethodBlockBytes、WORST_REASON 及类型（grep）
- 来源：DSH；核实：confirmed；规格行：否；估计行数：14
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/K3-35-continuation-fixture.ts:119,130,157,199,212,236（原导出清理成立。）

### T3-084 · F-02 · helper · tests/helpers/K3-proposal-round.ts:898-921
- **动作：** delete：整段删除 K3-proposal-round.ts:898-921（K3AwaitingApprovalState、reachK3AwaitingApproval），并改掉文件头注释 :40、:54 的示例；其余 18 处（117、130、154、225、370、466、489、553、609、644、679、689、726、733、783、794、826、845）只去掉 export
- **覆盖/依据：** 无消费者：reachK3AwaitingApproval 和 K3AwaitingApprovalState 在 tests、src 里只有定义和注释（:40、:54）；其余 18 个名字只在本文件内部使用（例如 :258、:463、:760）
- **核实理由：** 逐个名字 grep 核实：20 个名字在别的文件都搜不到，这点成立。但 reachK3AwaitingApproval 在本文件里也没有调用，只出现在 :40、:54 的注释里；tsconfig.json 没开 noUnusedLocals，只去 export 会留下一段死代码。所以这两项该按 Codex 整段删，其余 18 项按 DSH 去 export。
- **涉及测试：** K3AwaitingApprovalState; reachK3AwaitingApproval
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：44
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/K3-proposal-round.ts:898,910（死函数整删，其余指定项只去export。）

### T3-102 · F-13 · helper · tests/helpers/WP2-platform-support.ts:866-868
- **动作：** delete:删 tests/helpers/WP2-platform-support.ts:52（WP2_AT 别名）；整段删 :865-868 goalSettingsWith 及只为它存在的 :26 GoalSettingsV1 类型 import；:53、:57、:183、:871 去掉 export
- **覆盖/依据：** 无外部消费者（5 个 importer：S4C2-scribe-reminders 只在注释提及，WP2-wiring、S4C2-assembly、WP2-wiring-scenario、S4C2-update-due 均不取这些名字）
- **核实理由：** goalSettingsWith 在 src/tests 全树只有 WP2-platform-support.ts:866 定义，文件内也无调用，Codex 说整个删是对的，DSH“同文件内用”不成立；DSH 另外几项成立：WP2_AT 全仓无人用（:52），WP2_ALL_TOOL_NAMES(:327/:538)、WP2PlatformOptions(:203/:237/:326/:536)、WP2ObservedCommit(:176/:421/:788)、wp2ChecksConfiguration(:413/:780) 只在本文件用。
- **涉及测试：** goalSettingsWith
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：10
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/WP2-platform-support.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/WP2-platform-support.ts:52,183,866,871（原删除及导出清理成立。）

### T3-103 · F-14 · handwritten · tests/helpers/executed-files-stub.ts:22-28（createExecutedFilesStub 返回 not_available DTO）
- **动作：** convert:createGoalExecutedFilesReader，同时在每个用到的 fixture 后端注册 RUN_ACTIVITY_RECORD_SCHEMAS（含 s2b-run-activity-by-goal-last 有序索引）并把 records 按 S5OrderedRecords 传入，再删 stub；改后逐个核对 S5-decision-queue、S5-goal-settings、WP2-context-extensions 的冲突卡。更省事的替代：stub 改为返回真 reader 对无 Run 目标的值（available/[]/false）
- **覆盖/依据：** 真 reader 由 tests/work-graph/S2B-34-executed-files.test.ts:212-255 覆盖
- **核实理由：** 核心属实：stub（executed-files-stub.ts:21-31）返回 not_available，生产 reader 只返回 available（goal-executed-files-reader.ts:203-205），13 个文件 26 处，用它的测试没有断言 not_available。但“直接注入真 reader”不可行：它要读有序索引 s2b-run-activity-by-goal-last（:133），这些 fixture 都没注册 RUN_ACTIVITY_RECORD_SCHEMAS（run-activity-codecs.ts:456），未注册索引会返回 unsupported（lookup-index.ts:253、in-memory-record-store.ts:516），冲突读取会失败；S5Records 类型也没有有序查找（S5-decision-fixture.ts:178-180）。另外它不写记录，归“手写事实”不准；换成 available 还会改 possiblyIncomplete（goal-conflicts.ts:421）。
- **涉及测试：** 13 个文件、26 处调用（5 个 helper 传递注入 + 8 个测试直接用；grep createExecutedFilesStub）
- 来源：DSH；核实：partly；规格行：否；估计行数：60
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：替代方案仍是手造 DTO；三个下游工厂缺真实 lookupOrdered 转发；11个直接调用文件及额外后端工厂不在 T3 白名单。 改法：只用真实 reader；通过 TP 的共用工厂合并统一注册 RUN_ACTIVITY_RECORD_SCHEMAS 并完整转发真实 lookupOrdered，禁止仅类型断言。无归属文件补入 T3，TP/T1 文件由现有负责人完成，全部调用方接线完成后才删除 stub；逐个按真实前置检查冲突卡。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/executed-files-stub.ts:21; tests/helpers/task-claim-fixture.ts:199; tests/helpers/S5-decision-fixture.ts:262,498（按书面改正接真reader、补注册及实际转发。）

### T3-105 · C31 · handwritten · tests/runtime/S5-user-message-tools.test.ts:['247-300']
- **动作：** convert:把 TU07 搬到带真实 Runtime 的夹具（如 tests/helpers/WP2-platform-support.ts 的 createWP2Platform，带 send_user_message 授权）：runtime.prepareExecution → 假 advanceWork 里调 runtime.startRun，脚本模型先发 send_user_message 再在闸门处挂起（tests/helpers/B2-401-world.ts:139-142 的做法），pump 与 consumer 断言不变
- **覆盖/依据：** 原 tests/runtime/S5-user-message-tools.test.ts:400::TU07 保留（slice-5-SPEC.md:1167 规格行）；公开 Runtime 流程实例 tests/runtime/B2-runtime-execution.test.ts:225-246。
- **核实理由：** 手写事实属实：247-266 改 RA 清单的 claim 手造 Prepared，285-297 交虚构 Kernel run/turn/position。但 S5 夹具本身没有 Runtime（入口同样是虚构 Kernel，tests/helpers/S5-decision-fixture.ts:731-748），pumpHarness（318-380）依赖 prepared.enter() 和 f.claimRB 也得重写；而普通 startRun 会在 pump 断言前结束 Run，必须加闸门，所以改动远超 54 行。
- **涉及测试：** preparePumpRun; TU07 keeps a user decision wait out of the real Session consultation consumer and pump
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：130
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：转换仍指定假 Workflow，且要求保留的 harness 使用手造结果、睡眠和数据库快照断言。 改法：接真实 Workflow 的 advanceWork/consumeConsultation，包装只计数、设闸、原样返回；两分支分别由真实 send_user_message/send_session_message 产生状态。等待使用真实闸门和 driver 通知；零变化通过公开读取及真实提交委托计数检查，删除 completedAdvance、手造 consultation 和 storeSnapshot 断言。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S5-decision-fixture.ts, tests/helpers/WP2-platform-support.ts, tests/runtime/B2-runtime-execution.test.ts, tests/runtime/S5-user-message-tools.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/S5-user-message-tools.test.ts:247,324,406; tests/helpers/S2B-runtime-steps-fixture.ts:319（书面改正仍适用，真实Runtime路径可用，尚未完成转换。）
