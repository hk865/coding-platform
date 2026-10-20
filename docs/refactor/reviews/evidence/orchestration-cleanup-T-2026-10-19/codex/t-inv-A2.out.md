A2 清点完成：**43 项发现，涉及约 987 行删除或改写候选**。其中待裁定项计 0 行。这个数字不是净删行数，转换夹具可能增加代码。

全程只读，未写文件，未运行测试、构建、网络请求或模型调用。

以下删除建议中的“行为已不存在”，指**决定 79-1 已取消该兼容要求**，不表示当前实现已经删掉对应分支。依据为 `docs/refactor/HANDOFF.md:565–569`；手写事实只转换、不删除，依据为 `docs/refactor/HANDOFF.md:584–591`。冻结规格行按 `.lead-ref/t-common.md:39–45` 保护。

表内 `WG/` 完整展开为 `tests/work-graph/`；JSON 使用完整路径。行数只计 A2 内代码，不计引用的跨区 helper。

| 编号 | 类别 | 位置、测试名称 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---:|---|---|
| A2-01 | 过时 | `WG/S2B-activity-calendar.test.ts:215–262`，`2B-24 … counts legacy rounds as unplaced` | 旧分支在 235–241、257–260；helper 先真实开轮，再删除 `since`，见 `tests/helpers/S2B-activity-fixture.ts:250–264`。这正是旧格式容忍。 | `delete`：只删旧 Round 子段，保留正常按小时、Task 归属断言。 | 旧格式要求由 `docs/refactor/HANDOFF.md:565–569` 取消；本测试 221–233、249–256 保留当前行为。 | 13 | 是 | 高 |
| A2-02 | 过时 | `WG/S2B-activity-calendar-tasks.test.ts:51–79,146–208`，两个 `2B-26` Session 过滤用例 | `seedLegacyRun` 手写没有 history/dispatch 的旧 Run；155–157、182–185 加入旧记录，164、196、204 钉住旧来源未知、未回填分支。 | `delete`：删除旧 Run helper 和旧数据子段；重新手算剩余正常 Run 的计数，保留两个过滤场景。 | 旧格式要求由 `docs/refactor/HANDOFF.md:565–569` 取消；本文件 152–153、162–163、178–181、193–194 的真实 Run 过滤断言保留。 | 51 | 是 | 高 |
| A2-03 | 过时 | `WG/S2B-r2-keyed-cap.test.ts:61–77`，`R7 readActivityCalendar charges an absent dispatch claim for an unplaced Run` | 64–69 明确构造“旧 Run、没有 history locator、没有 dispatch claim”，73–76 的容量边界专门包含这个不存在的 claim。 | `delete`。 | 旧形态由 `docs/refactor/HANDOFF.md:565–569` 取消；当前缺 activity/epoch 的容量边界保留于本文件 21–59。 | 17 | 是 | 高 |
| A2-04 | 过时 | `WG/S2B-r2-never-entered.test.ts:23–37`，`R5 a V1 authorization phase authorized does not prove non-entry` | 26–30 直接构造 V1 授权，35–36 验证其未知归类；不是当前 V2 准入流程。 | `delete`：仅 V1 行。 | V1 兼容要求由 `docs/refactor/HANDOFF.md:565–569` 取消；本文件 39–75 保留 V2/当前授权场景。 | 15 | 是 | 高 |
| A2-05 | 过时 | `WG/S2B-r2-r5-not-entered.test.ts:36–52`，`2B-r2 R5 a V1 authorization does not prove non-entry` | 42–43 换成 V1 授权并删除 history，49–51 钉住旧形态的未知结果。 | `delete`：仅 V1 行，不连带删除后面的 R5 行。 | V1 兼容要求由 `docs/refactor/HANDOFF.md:565–569` 取消；当前形态的其余 R5 行在本文件 54–92。 | 17 | 是 | 高 |
| A2-06 | 过时 | `WG/S2C-lines-page.test.ts:394–421`，`2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session` | 397 创建无 provenance 的旧 Session；403–414 明说公开 Query 入口拒绝此 Session，因此直接提交 QueryRun。 | `delete`。 | 旧 Session 兼容要求由 `docs/refactor/HANDOFF.md:565–569` 取消；当前 Work/Query 分页保留于本文件 97–129，`2C-18 executions page by generation, with the within-segment boundary`。 | 28 | 是 | 高 |
| A2-07 | 过时 | `WG/S2C-lines-d1.test.ts:32–73`，`2C-14 (1)` D1 计数、`2C-14 (2)` pin 排序 | 38–39 的归档上下界来自旧 Session；52、63–65 依赖 D1 的旧 L。L 的构造见 `tests/helpers/S2C-L-line-support.ts:466–474,710–711`。 | `delete`：仅删除旧 L 的兼容断言；pin 排序换用真实 Session。D1 字面计数须由 lead 同步改规格，不能删整行测试。 | 旧兼容要求由 `docs/refactor/HANDOFF.md:565–569` 取消；本文件 42–56 的各工作线状态及 66–72 的排序断言保留。 | 8 | 是 | 中 |
| A2-08 | 过时 | `WG/S3-prepared-context-admission.test.ts:499–508`，`AD05: an old manifest without contextAssembly authorizes as before and is not migrated` | 501 主动省去 binding，507 断言不加字段；旧兼容要求原列于 `docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:740`。 | `delete`。 | 该旧 manifest 兼容要求由 `docs/refactor/HANDOFF.md:565–569` 取消；当前有 binding 的准入保留于本文件 438 起的 AD01。 | 10 | 是 | 高 |
| A2-09 | 过时 | `WG/S5-request-candidates.test.ts:305–341`，`RC11 a legacy v1 proposal remains a read-only candidate without added request fields or claims` | 308–325 手写 v1 proposal，330–331 要求读成 `legacy_v1`，337–340 要求原形不变。 | `delete`。 | v1 存量读取要求由 `docs/refactor/HANDOFF.md:565–569` 取消；当前 candidate/request 行为仍由本文件 RC01 起的测试覆盖。 | 37 | 是 | 高 |
| A2-10 | 过时 | `WG/S5-user-messages.test.ts:277–345`，`UM12 a genuinely old absent-field Session message keeps its frozen ack DTO/receipt and origin absence` | 294–300 制造本片之前缺字段的记录和事件；303–344 验证缺省投影、冻结回执及不补字段。 | `delete`。 | 旧记录保形要求由 `docs/refactor/HANDOFF.md:565–569` 取消；当前 Session 发信、答复保留于本文件 243–264 的 UM10。UM10 不等同旧 ack 回执测试，后者删除依据是行为取消。 | 69 | 是 | 高 |
| A2-11 | 过时 | `WG/S5-notices.test.ts:195–209`，NR05 的 legacy 排序子段 | 197 请求旧 requeue，199–200 验证缺 `since`，208 要求 `position.kind='legacy'`。 | `delete`：只删旧位置排序子段；209 的当前 commit 位置断言保留。210–212 另见 A2-43。 | 旧位置兼容由 `docs/refactor/HANDOFF.md:565–569` 取消；本文件 NR06 238–244 覆盖真实 requeue 的 commit 位置。 | 10 | 是 | 高 |
| A2-12 | 过时 | `WG/S5-notices.test.ts:271–284`，`NR08 legacy reverify retains an unknown cap after the current policy cap changes` | 272 开启 `legacyRounds`；274 强制缺 `noticeAutomationCap`；277–283 钉住旧记录的未知上限。 | `delete`。 | 缺字段旧 Round 兼容由 `docs/refactor/HANDOFF.md:565–569` 取消；本文件 NR07 258–269 保留真实自动后继轮的通知及计数。 | 14 | 是 | 高 |
| A2-13 | 过时 | `WG/WP2-undelivered-notices.test.ts:221–272`，M05 的旧位置缺失子段 | 237 删除 `unavailableSince`，247、254 删除消息位置；265–272 验证旧记录导致 `position_missing`。 | `delete`：只删旧数据子段；274–285 的来源不一致断言不能随整例删除。 | 缺字段旧数据兼容由 `docs/refactor/HANDOFF.md:565–569` 取消；当前真实通知位置流程保留于本文件 113–126、147–165。 | 52 | 是 | 高 |
| A2-14 | 过时 | `WG/S4B-memory-version-lists.test.ts:77–81`，跳过的 `M-10 an old plan version without a recorded reason shows the missing label` | 注释已说明公开初次采用和 `proposePlan` 都记录原因，无法构造此旧行。 | `delete`：删除跳过占位及对应说明，不算减少一个实际执行用例。 | 旧缺原因记录要求由 `docs/refactor/HANDOFF.md:565–569` 取消；本文件 51–75 覆盖三个真实计划版本的原因、时间和顺序。 | 5 | 是 | 高 |
| A2-15 | 过时 | `WG/WP1-goal-content-entry.test.ts:79–85`，`GE03 commits the same unbound manifest when the stored Goal digest is null` | 82 主动将 Goal digest 设为 null；兼容动机明确写于 `docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md:25`。 | `delete`：仅旧 digest 缺省豁免行。 | 旧 manifest 豁免由 `docs/refactor/HANDOFF.md:565–569` 取消；本文件 GE01 55–61、GE04 87–97 保留真实 digest 和无关计划采用行为。 | 7 | 是 | 高 |
| A2-16 | 重复 | `WG/S4A-note-history.test.ts:464–489`，`N-08 %s accepting a pending general note on a goal anchor leaves the pointer` | 源测试 484、487 断言 pointer 和原理解状态不变；`WG/S4A-note-write.test.ts:517–521` 已有同样断言，并多验版本不变；486–500 还覆盖原先无 pointer。 | `merge-into:tests/work-graph/S4A-note-write.test.ts::N-08 %s accepting a pending general note on a goal anchor leaves the pointer` | 保留端 `WG/S4A-note-write.test.ts:481–523`，同名 N-08。 | 26 | 是 | 高 |
| A2-17 | 重复 | `WG/S4A-note-history.test.ts:493–513`，`N-06 %s accepting a pending replacement supersedes its target in that commit` | 505、508、511 的“旧 accepted→新 accepted→旧 superseded”已在 `WG/S4A-note-write.test.ts:714–724`；后者另验历史版本和 withdrawn 目标不变。 | `merge-into:tests/work-graph/S4A-note-write.test.ts::N-10 accepting a pending note supersedes its current replaces targets`，保留 N-06 的规格追踪标记。 | `WG/S4A-note-write.test.ts:699–735`，N-10。 | 21 | 是 | 高 |
| A2-18 | 重复 | `WG/S4C-note-protection.test.ts:257–268`，`D-16 %s: the write is accepted directly with no user reason` | 264–266 与 `WG/S4C2-D-rows.test.ts:281–285` 同验直接 accepted、旧用户注记仍 accepted、coexist；后者再验无卡片。两边 anchor/goal 布置不同，应带入保留端参数，不能直接丢掉。 | `merge-into:tests/work-graph/S4C2-D-rows.test.ts::D-16 %s: a replaced user note also in coexistWith is admitted directly, no card` | `WG/S4C2-D-rows.test.ts:274–286`，D-16。 | 12 | 是 | 中 |
| A2-19 | 重复 | `WG/S8A-path-ownership-dedupe.test.ts:18–28`，`S8A-06b the canonical decision keeps the 4C-1/8A semantics` | 四个结果分别重复 `WG/S4C-note-path-ownership.test.ts:44,50,57,62` 的 root 命中、具体前缀优先、root 平手、空路径。 | `merge-into:tests/work-graph/S4C-note-path-ownership.test.ts::RW-13`，将 S8A-06b 追踪标记并入四个现有行。 | `WG/S4C-note-path-ownership.test.ts:42–63`，四个 RW-13 root 用例；源文件 13–16 的导出对象 identity 测试保留。 | 11 | 是 | 高 |
| A2-20 | 重复 | `WG/S8A-L8-reminders-pure.test.ts:130–169`，四行顺序、unknown 后缀、10+遗漏上限、无观测四例 | 相同业务结果已由真实 capture→prepare 流程断言：`WG/S8A-L8-reminders-public.test.ts:66,110–113,129–131,144–145`。 | `merge-into:tests/work-graph/S8A-L8-reminders-public.test.ts::renders the four literal rows in order after two real captures (%s)`；其余三组断言分别保留在该文件 97、120、138 起的现有用例中。 | 上述四个 public 用例。纯测试 171–175 的 catalog-null 空行条件及后续 T25 等独立表格行不在合并范围。 | 37 | 是 | 高 |
| A2-21 | 重复 | `WG/S4B-memory-version-lists.test.ts:102–131`，`M-10 %s: two catalog versions list newest first with the 8A reason label` | 117–129 与 `WG/S8A-catalog-version-time.test.ts:50–65` 重复版本顺序、时间、原因、初始 null 和完整性；后者另验 commit cursor 和真实时间区间。源 125 的最新 `reasonLabel` 断言需迁入。 | `merge-into:tests/work-graph/S8A-catalog-version-time.test.ts::binds the revised record to its event cursor so the list shows that event time and reason` | `WG/S8A-catalog-version-time.test.ts:21–66`。 | 30 | 是 | 高 |
| A2-22 | 重复 | `WG/UCR-settle-review.test.ts:297–358`，`K3-10 … $verdict+$crash` 十二格 | 字面矩阵 309–321 与 `tests/scenarios/K3-10-review-round-cells.test.ts:106–118` 相同；真实审查轮已在后者 157–183 断言 status、reasons、activeRound、结论。源测试还验双后端、`open` 和 owner 回执。 | `keep-note`：可合并矩阵维护，但不能以场景覆盖为由删除 memory 后端或 `open`/回执断言。 | `tests/scenarios/K3-10-review-round-cells.test.ts:205–210::K3-10 $verdict+$crash settles to the literal L17 cell`；独有断言仍在源 346–355。 | 0 | 是 | 高 |
| A2-23 | 手写事实 | `WG/S5-request-candidates.test.ts:269–289`，RC09 | 271–274 手删字段后 seed。但当前无 request 的独立 candidate 本来就不附加 `requestRef`，见 `src/core/work-graph/state/plan-machine.ts:1083–1085`，不能因标题含 old 就删。 | `convert:proposePlan（省略 requestRef）`；保留读不写、无关联 claim 等断言。入口今天存在。 | 原 RC09 保留；转换依据为上述当前 state 规则。 | 6 | 是 | 高 |
| A2-24 | 手写事实 | `WG/S3-context-inputs.test.ts:471–490,501–502`，IN 系列共享 Run/Message 布置 | 483–489 直接写 ended/starting Run，501 编码 replied Message。实际 Run 流程已有 `tests/helpers/S2B-activity-fixture.ts:466–508`；当前 Query 也已在本文件 514–530 走 owner。 | `convert:claimTask→authorizeRuntimeEntry→beginRuntimeEntry→recordRunResult；sendMessage→respondMessage`。仅转换 Run 和回复消息，不把 A2-25 的链一起算入。 | 原 IN 场景和断言保留，非删除。公开执行流程见上述 helper；当前 Session 回复例见 `WG/S5-user-messages.test.ts:243–264`。 | 35 | 是 | 中 |
| A2-25 | 手写事实 | `WG/S3-context-inputs.test.ts:337–388,494–499`，IN11/IN12 的 finalized Round 链 | 375–388 给 PASS 前驱拼一个 `reverify` FAIL 后继；但公开 `reverifyRound` 明确只接受 finalized **non-PASS** 链头，见 `src/core/work-graph/model/evidence-contracts.ts:155–166`。 | `keep-note`：没有核实到能生成这条“同链 PASS→FAIL”的当前公开步骤；不得声称直接改用 reverify 即可。lead 需确定 IN12 要测跨 Run 的新验证，还是废除该不可达链。 | 原 `WG/S3-context-inputs.test.ts:799` 的 IN12 暂保留；尚无等价公开替代证明。 | 0 | 是 | 高 |
| A2-26 | 手写事实 | `WG/S3-graph-context.test.ts:388–470,543–550,580–594,746–758`，GR 系列共享事实、GR10 换计划 | 直接写 Goal/Plan/Session/空壳 Round；真实 claim 后又直接将 Run 改 ended；换计划直接改 Goal pointer。 | `convert:createGoal→proposePlan→applyPlanChange；recordSessionCreated；openVerification；recordRunResult`。GR10 再真实采用 P2。用真实记录替换空壳，保留各 GR 读断言。 | 同文件 563–576 已走真实 claim；公开计划采用示例在 `WG/S3-context-inputs.test.ts:460–467`；真实开轮在 `tests/helpers/S2B-activity-fixture.ts:233–247`。 | 120 | 是 | 中 |
| A2-27 | 手写事实 | `WG/S3-prepared-context-admission.test.ts:274–281,518–523,548–556`，上游 Run、AD06、AD08 | 上游 Run 直接写入；AD06 直接改授权 phase=revoked；AD08 直接覆盖 Workspace@8。 | `convert:真实 Run 流程；beginRuntimeEntry→reconcileRun(not_entered)；setLinePins`。保留 AD06 错 binding 拒绝及 AD08 版本冲突断言。 | 真实撤销示例 `tests/helpers/WP1-entry-fixture.ts:333–347`、`WG/WP1-goal-content-entry.test.ts:99–109`；pin 导致版本+1 见 `WG/S2C-pins.test.ts:76–78`。 | 24 | 是 | 高 |
| A2-28 | 手写事实 | `WG/W2-agent-whiteboard.test.ts:189–219,383–387,463–467`，Agent apply、异 Run candidate、重放、提交后中止 | 四处调用 `seedAgentCandidate`；该 helper 直接写 proposal/event，见 `tests/helpers/W2-whiteboard-fixture.ts:329–357`。两个 Run 已真实进入，见该 helper 175–217。 | `convert:proposeAsWorkRun/proposeAsSecondWorkRun→applyAsWorkRun`；使用真实返回 ref/revision，保留原四组断言。 | 本文件 171–187 的 `real claim -> B2 entered -> Agent propose commits a sourced candidate` 已证明公开生成路径。 | 12 | 是 | 高 |
| A2-29 | 手写事实 | `WG/W1-future-plan.test.ts:276–323,363–367,470–471,534–537,744–749`，正常 scenario 1/2、4、7、6 的前置事实 | `seedAcceptedPlan/seedRun/seedLease/seedReduction` 直接拼记录；正常场景需要的“已运行 A、已满足 C、后来采用 P2”可由现有业务入口产生。 | `convert:proposePlan→applyPlanChange；claimTask→真实执行；openVerification→beginCheck→recordCheckResult→finalizeChecks→completeTask`。不包括 A2-42 的虚构新 Task 痕迹。 | 归约入口为 `src/core/work-graph/model/task-contracts.ts:64–73` 的 `completeTask`；验证入口为 `src/core/work-graph/model/evidence-contracts.ts:168–184`。原 scenario 断言保留。 | 48 | 是 | 中 |
| A2-30 | 手写事实 | `WG/WP2-context-extensions.test.ts:309–320`，F07 候选分页夹具 | 循环直接 seed 100 个 candidate；同一函数 296–307 已建好真实 plans owner 并公开 propose/apply。 | `convert:循环调用 proposePlan，保存返回 proposalId`，保留命名尾项跨页断言。 | 原 F07 `WG/WP2-context-extensions.test.ts:402` 保留；入口实例已在 296–300。 | 12 | 是 | 高 |
| A2-31 | 手写事实 | `WG/WP2-message-duties.test.ts:83–100`，`seedRoleMatrix`，M01/M02 角色矩阵 | 94–99 直接写 CoordinationPolicyRevision 和 active pointer。当前 `RoleConfigurationPort` 只有 install/read/activate RoleSpec 与 resolve，见 `src/core/work-graph/model/configuration-contracts.ts:15–28`；源码搜索未找到对应策略安装/激活 owner。 | `keep-note`：今天没有查到等价公开写入口，不编造 `installCoordinationPolicy` 转换方案，也不删角色行为测试。 | 原 M01/M02 保留；公开替代未落实。 | 0 | 是 | 中 |
| A2-32 | 手写事实 | `WG/UCR-settle-review.test.ts:58–96,142–165,194–210`，UCR-07/UCR-15 共享 setup、hold、无轮状态 | 手工建审查，再直接应用 `round_claimed`、`hold_applied` 并提交；无轮分支直接抹掉 activeRound。 | `convert:真实未知调用审查创建→带 review 参数的 claim→holdReview/settleReview`；review_unavailable 从真实未认领审查开始。结论也走 `recordConclusion`。 | 现有链见 `tests/helpers/K3-proposal-round.ts:243–269,383–398,474–486`；`holdReview` 为 `src/core/work-graph/tasks/unknown-call-review-service.ts:979`。原 owner 断言保留。 | 80 | 是 | 高 |
| A2-33 | 手写事实 | `WG/unknown-call-review-list.test.ts:45–74`，listReviews 共享 seed | 59–60 强行指定 status/open，69 却统一提交 change=`created`，没有真实状态路径。 | `convert:创建真实 pending review，再经 settleReview/recordConclusion/holdReview 取得所需状态`；保留分页、Goal/status 隔离和双后端。 | 原本文件 80 起的 listReviews 用例保留；公开创建与结论链同 A2-32 的 `tests/helpers/K3-proposal-round.ts:243–269,474–486`。 | 30 | 否 | 高 |
| A2-34 | 手写事实 | `WG/S4C2-U3.test.ts:47–108`，`rejects a forged proof whose acknowledgementRef names another answer as invalid` | 手拼 NoteHead、NoteVersion、`NoteDispositionChanged` 并直接提交，最终只是测试回执与另一个 answer 不匹配。这个错误可以通过交叉提供两个真实答复/回执产生。 | `convert:真实创建并处理两张注记卡片，将 B 的正式 disposition receipt 交给 A 的 proof reader`。保留 invalid 断言；不按篡改删除。 | 真实卡片应用已有 `WG/S4C2-D17.test.ts:53–70`；本文件 112–178 的 ordinary disposition/incomplete 是另一行为，保留。 | 62 | 是 | 中 |
| A2-35 | 手写事实 | `WG/goal-independent.test.ts:18–27,47`，`Goal creation uses only the new Store transaction, including exact replay and conflict` | 直接 seed Project/Workspace；被测 createGoal 本身已走 owner。 | `convert:createProject→registerWorkspace`，扩充所需 schema，保留 Goal 重放、冲突及后端独立性断言。 | 公开入口在 `src/core/work-graph/configuration/project-bootstrap-service.ts:528,601`；原测试 50–68 保留。 | 11 | 否 | 高 |
| A2-36 | 手写事实 | `WG/material-readers.test.ts:20–48,61–73`，`canonical material records use complete refs and returned values are isolated` | Workspace/Goal/Run/QueryRun 全部手写后 raw commit；业务要求是完整 ref 隔离和返回值拷贝隔离。 | `convert:createProject/registerWorkspace/createGoal/proposePlan/applyPlanChange/claimTask/submitQueryJob`，保留跨项目、Goal、Workspace 同名 ID。 | 原 75–82 的隔离断言保留；公开 Query 创建示例 `WG/S3-context-inputs.test.ts:514–530`。81 行改的是返回副本，不是存储篡改。 | 45 | 否 | 高 |
| A2-37 | 手写事实 | `WG/S8A-file-layer.test.ts:101–112`，文件层共享 scope 初始化 | 自造 `TrustedArchitectureScopeSeeded`，直接编码 Project/Workspace。 | `convert:createProject→registerWorkspace`，保留所有 S8A 文件层业务行。 | 当前入口 `src/core/work-graph/configuration/project-bootstrap-service.ts:528,601`；原文件层测试继续承担覆盖。 | 12 | 是 | 高 |
| A2-38 | 只为篡改候选 | `WG/S2B-r4-session-workspace.test.ts:44–86`，两个 `2B-r3 R4` foreign Session 用例 | 48–55、68–74 手写 Run history 指向另一 Workspace 的 Session；正常 claim 会拒绝 foreign Session，见 `src/core/work-graph/tasks/claim-service.ts:1025`。 | `keep-note`：这是持久化事实被拼坏后的防御行；因冻结 R4 不直接删，交 lead 决定是否退役该分支/规格行。 | 当前调用者 workspace 隔离另见 `WG/S2B-r2-workspace-binding.test.ts:30–85`；它不等同此坏记录检查。 | 0 | 是 | 高 |
| A2-39 | 只为篡改候选 | `WG/S2C-lines-failure.test.ts:173–184`，`2C-14 … an undecodable open responsible link marks the line B4` | 177 先正常 link，178 将存储 lookup schema 换成 `BogusLink@1`，182 才得到 unavailable。没有经过真实请求输入边界。 | `keep-note`：冻结 B4 行，lead 核定该存储损坏检查是否保留后再处理。 | 本文件 122–143 的真实读失败注入仍须保留；并不能据此宣称坏 schema 行已被完整覆盖。 | 0 | 是 | 高 |
| A2-40 | 只为篡改候选 | `WG/S3-graph-context.test.ts:260–277,1103–1109`，`GR14 a damaged catalog codec is unavailable and never a ready empty graph` | 272 把已存 catalog JSON 换为 `{"broken":`，1107 验证 unavailable；损坏的是内部记录，不是用户提交的文件内容。 | `keep-note`：冻结 GR14，待 lead 裁定防御行后处理。 | 原 GR14 暂保留；未找到等价真实外部输入场景，不能直接按重复删除。 | 0 | 是 | 高 |
| A2-41 | 只为篡改候选 | `WG/S5-decision-application.test.ts:365–382`，`AP12 a corrupt formal receipt event is unavailable and leaves application null with zero writes` | 正式 receipt 已真实生成；372 把 eventAt 返回的已存事件 JSON 改成 `{`，再测 unavailable、零写入。 | `keep-note`：这是内部已存事件损坏分支；冻结 AP12，待 lead 决定，不连带删真实收据校验。 | 原 AP12 暂保留；相邻 AP13 从 384 起测试真实 cursor 不一致，属于不同规则。 | 0 | 是 | 高 |
| A2-42 | 只为篡改候选 | `WG/W1-future-plan.test.ts:705–732`，scenario 9 中 added-run/lease/reduction 及顺序行 | 705 说明 B1/B2 是此次尚待加入的 Task；710–713、717–725 却提前 seed 它们的 Run/Lease/Reduction。只写 Lease、没有配套 claim 的行也无法由正常 claim 得到同形事实。 | `keep-note`：不能把全部 seed 机械改成 claim；保留正常“已有 Task 执行后不可改”的场景，将新增 Task 的幽灵痕迹行交 lead 裁定。 | A2-29 转换正常可达流程；本文件这些防御顺序行目前没有等价公开重现路径。 | 0 | 是 | 高 |
| A2-43 | 只为篡改候选 | `WG/S5-notices.test.ts:79–95,210–212`，NR05 的 corrupt null origin 子段 | `corruptOrigin` 将记录位置改为 null；211 要求 unavailable、212 零写入。与 A2-11 的旧字段缺失排序是两个问题。 | `keep-note`：旧位置排序可删；本防御子段是冻结 NR05 的另一部分，先由 lead 裁定。 | 当前真实位置仍由本文件 NR06 238–244 覆盖；非法 null 拒绝无等价公开生成路径。 | 0 | 是 | 高 |

对应 JSON：

```json
[
  {
    "id": "A2-01",
    "category": "stale",
    "file": "tests/work-graph/S2B-activity-calendar.test.ts",
    "lines": "215-262；删除子段235-241、257-260",
    "tests": ["2B-24 attributes begun checks to the round start hour and its task and counts legacy rounds as unplaced"],
    "evidence": "tests/helpers/S2B-activity-fixture.ts:250-264 在真实开轮后删除 since；docs/refactor/HANDOFF.md:565-569 取消旧格式容忍。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；保留本测试221-233、249-256的当前归属断言。",
    "est_lines": 13,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-02",
    "category": "stale",
    "file": "tests/work-graph/S2B-activity-calendar-tasks.test.ts",
    "lines": "51-79,146-208；仅旧记录helper和子段",
    "tests": [
      "2B-26 filters a cell to one line with sessionRefs and counts Runs whose claiming Session is unknown",
      "2B-26 sessionRefs skips a foreign-line uncounted Run and counts an unresolvable claiming Session"
    ],
    "evidence": "51-79手写无history/dispatch的旧Run；155-157、182-185加入旧记录，164、196、204断言旧来源未知及未回填。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；保留本文件152-153、162-163、178-181、193-194的真实Run过滤场景并重新手算计数。",
    "est_lines": 51,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-03",
    "category": "stale",
    "file": "tests/work-graph/S2B-r2-keyed-cap.test.ts",
    "lines": "61-77",
    "tests": ["R7 readActivityCalendar charges an absent dispatch claim for an unplaced Run"],
    "evidence": "64-69明确制造无history locator及dispatch claim的旧Run；73-76容量边界包含这个旧形态的claim miss。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件21-59保留当前缺activity/epoch的容量边界。",
    "est_lines": 17,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-04",
    "category": "stale",
    "file": "tests/work-graph/S2B-r2-never-entered.test.ts",
    "lines": "23-37",
    "tests": ["R5 a V1 authorization phase authorized does not prove non-entry"],
    "evidence": "26-30直接构造V1授权，35-36断言旧形态的未知结果。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件39-75保留V2及当前授权场景。",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-05",
    "category": "stale",
    "file": "tests/work-graph/S2B-r2-r5-not-entered.test.ts",
    "lines": "36-52",
    "tests": ["2B-r2 R5 a V1 authorization does not prove non-entry"],
    "evidence": "42-43换成V1授权并删除history，49-51断言旧形态的未知结果。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件54-92的其他R5行不在删除范围。",
    "est_lines": 17,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-06",
    "category": "stale",
    "file": "tests/work-graph/S2C-lines-page.test.ts",
    "lines": "394-421",
    "tests": ["2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session"],
    "evidence": "397创建旧Session；403-414说明公开Query拒绝其null provenance，因此直接提交QueryRun。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；当前分页保留于tests/work-graph/S2C-lines-page.test.ts:97-129::2C-18 executions page by generation, with the within-segment boundary。",
    "est_lines": 28,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-07",
    "category": "stale",
    "file": "tests/work-graph/S2C-lines-d1.test.ts",
    "lines": "32-73；仅旧L相关部分",
    "tests": [
      "2C-14 (1) the literal D1 counts are working 3, standby 6 and the archived range",
      "2C-14 (2) a pinned line sorts first and the rest follow by attention then latest activity"
    ],
    "evidence": "38-39、52、63-65依赖旧L；旧Session构造见tests/helpers/S2C-L-line-support.ts:466-474,710-711。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；保留本文件42-56和66-72，pin改用真实Session，D1计数字面规格由lead同步修订。",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "A2-08",
    "category": "stale",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "lines": "499-508",
    "tests": ["AD05: an old manifest without contextAssembly authorizes as before and is not migrated"],
    "evidence": "501省去binding、507断言不加字段；原旧兼容行见docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:740。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；当前绑定准入保留于tests/work-graph/S3-prepared-context-admission.test.ts:438::AD01。",
    "est_lines": 10,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-09",
    "category": "stale",
    "file": "tests/work-graph/S5-request-candidates.test.ts",
    "lines": "305-341",
    "tests": ["RC11 a legacy v1 proposal remains a read-only candidate without added request fields or claims"],
    "evidence": "308-325手写v1 proposal，330-331要求legacy_v1，337-340要求原形不变。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；当前candidate/request行为保留于本文件58起的RC01及后续行。",
    "est_lines": 37,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-10",
    "category": "stale",
    "file": "tests/work-graph/S5-user-messages.test.ts",
    "lines": "277-345",
    "tests": ["UM12 a genuinely old absent-field Session message keeps its frozen ack DTO/receipt and origin absence"],
    "evidence": "294-300制造旧缺字段记录及事件，303-344验证缺省投影、旧ack回执和不补字段。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；当前Session消息流程保留于tests/work-graph/S5-user-messages.test.ts:243-264::UM10，UM10不作为旧ack回执的等价覆盖。",
    "est_lines": 69,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-11",
    "category": "stale",
    "file": "tests/work-graph/S5-notices.test.ts",
    "lines": "195-209；仅legacy排序子段",
    "tests": ["NR05 legacy precedes a bound creation position and corrupt null origin is unavailable"],
    "evidence": "197制造旧requeue，199-200验证缺since，208要求legacy位置。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件238-244::NR06覆盖真实commit位置。保留209；210-212另见A2-43。",
    "est_lines": 10,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-12",
    "category": "stale",
    "file": "tests/work-graph/S5-notices.test.ts",
    "lines": "271-284",
    "tests": ["NR08 legacy reverify retains an unknown cap after the current policy cap changes"],
    "evidence": "272开启legacyRounds，274缺noticeAutomationCap，277-283要求未知上限持续不变。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件258-269::NR07保留真实自动后继轮的通知和计数。",
    "est_lines": 14,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-13",
    "category": "stale",
    "file": "tests/work-graph/WP2-undelivered-notices.test.ts",
    "lines": "221-272；仅旧数据位置缺失子段",
    "tests": ["M05 old data missing a position blocks only its Goal; a damaged position is refused"],
    "evidence": "237删除unavailableSince，247和254删除消息位置；265-272要求position_missing。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；当前通知位置流程在本文件113-126、147-165；274-285的来源不一致子段保留。",
    "est_lines": 52,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-14",
    "category": "stale",
    "file": "tests/work-graph/S4B-memory-version-lists.test.ts",
    "lines": "77-81",
    "tests": ["M-10 an old plan version without a recorded reason shows the missing label"],
    "evidence": "77-80已经说明公开初始采用和proposePlan都记录原因，该旧行不可公开构造；81是it.skip。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件51-75::M-10 three plan versions覆盖当前原因、时间和顺序。不计为减少实际执行用例。",
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-15",
    "category": "stale",
    "file": "tests/work-graph/WP1-goal-content-entry.test.ts",
    "lines": "79-85",
    "tests": ["GE03 commits the same unbound manifest when the stored Goal digest is null"],
    "evidence": "82主动设Goal digest为null；旧manifest豁免动机见docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md:25。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件55-61::GE01、87-97::GE04保留真实digest及无关计划采用行为。",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-16",
    "category": "duplicate",
    "file": "tests/work-graph/S4A-note-history.test.ts",
    "lines": "464-489",
    "tests": ["N-08 %s accepting a pending general note on a goal anchor leaves the pointer"],
    "evidence": "484、487的pointer和原理解状态断言已在tests/work-graph/S4A-note-write.test.ts:517-521；保留端486-500另有无pointer分支。",
    "action": "merge-into:tests/work-graph/S4A-note-write.test.ts::N-08 %s accepting a pending general note on a goal anchor leaves the pointer",
    "covered_by": "tests/work-graph/S4A-note-write.test.ts:481-523::N-08 %s accepting a pending general note on a goal anchor leaves the pointer",
    "est_lines": 26,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-17",
    "category": "duplicate",
    "file": "tests/work-graph/S4A-note-history.test.ts",
    "lines": "493-513",
    "tests": ["N-06 %s accepting a pending replacement supersedes its target in that commit"],
    "evidence": "505、508、511与tests/work-graph/S4A-note-write.test.ts:714-724相同；保留端另验历史版本和withdrawn目标。需保留N-06规格追踪标记。",
    "action": "merge-into:tests/work-graph/S4A-note-write.test.ts::N-10 accepting a pending note supersedes its current replaces targets",
    "covered_by": "tests/work-graph/S4A-note-write.test.ts:699-735::N-10 accepting a pending note supersedes its current replaces targets",
    "est_lines": 21,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-18",
    "category": "duplicate",
    "file": "tests/work-graph/S4C-note-protection.test.ts",
    "lines": "257-268",
    "tests": ["D-16 %s: the write is accepted directly with no user reason"],
    "evidence": "264-266与tests/work-graph/S4C2-D-rows.test.ts:281-285同验accepted、旧用户注记仍accepted和coexist；保留端另验无卡。anchor/goal差异须迁入参数。",
    "action": "merge-into:tests/work-graph/S4C2-D-rows.test.ts::D-16 %s: a replaced user note also in coexistWith is admitted directly, no card",
    "covered_by": "tests/work-graph/S4C2-D-rows.test.ts:274-286::D-16 %s: a replaced user note also in coexistWith is admitted directly, no card",
    "est_lines": 12,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "A2-19",
    "category": "duplicate",
    "file": "tests/work-graph/S8A-path-ownership-dedupe.test.ts",
    "lines": "18-28",
    "tests": ["S8A-06b the canonical decision keeps the 4C-1/8A semantics"],
    "evidence": "四个结果重复tests/work-graph/S4C-note-path-ownership.test.ts:44,50,57,62。将S8A-06b追踪并入RW-13；源13-16的导出identity测试保留。",
    "action": "merge-into:tests/work-graph/S4C-note-path-ownership.test.ts::RW-13",
    "covered_by": "tests/work-graph/S4C-note-path-ownership.test.ts:42-63::RW-13 root matches、concrete prefix beats root、two roots tie、root never matches empty",
    "est_lines": 11,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-20",
    "category": "duplicate",
    "file": "tests/work-graph/S8A-L8-reminders-pure.test.ts",
    "lines": "130-169",
    "tests": [
      "A-03: the four rows in kind order, each with the 3-hour observation time",
      "an unknown dependency finding ends with ，不确定",
      "caps at 10 rows and adds 另有 N 条架构提醒没列出",
      "no successful observation -> 还没有观测"
    ],
    "evidence": "真实capture到prepare的同结果断言在tests/work-graph/S8A-L8-reminders-public.test.ts:66,110-113,129-131,144-145；171-175的catalog-null空行及后续独立表格行不合并。",
    "action": "merge-into:tests/work-graph/S8A-L8-reminders-public.test.ts::renders the four literal rows in order after two real captures (%s)",
    "covered_by": "tests/work-graph/S8A-L8-reminders-public.test.ts:54::renders the four literal rows in order after two real captures (%s)；97::caps twelve real ungrouped rows at ten plus one omission line (%s)；120::renders an unknown dependency finding with ，不确定 after one real capture (%s)；138::renders 还没有观测 when no capture has succeeded (%s)",
    "est_lines": 37,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-21",
    "category": "duplicate",
    "file": "tests/work-graph/S4B-memory-version-lists.test.ts",
    "lines": "102-131",
    "tests": ["M-10 %s: two catalog versions list newest first with the 8A reason label"],
    "evidence": "117-129与tests/work-graph/S8A-catalog-version-time.test.ts:50-65重复；保留端另验真实cursor和时间区间。源125的最新reasonLabel断言须迁入。",
    "action": "merge-into:tests/work-graph/S8A-catalog-version-time.test.ts::binds the revised record to its event cursor so the list shows that event time and reason",
    "covered_by": "tests/work-graph/S8A-catalog-version-time.test.ts:21-66::binds the revised record to its event cursor so the list shows that event time and reason",
    "est_lines": 30,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-22",
    "category": "duplicate",
    "file": "tests/work-graph/UCR-settle-review.test.ts",
    "lines": "297-358",
    "tests": ["K3-10 memory $verdict+$crash", "K3-10 sqlite $verdict+$crash"],
    "evidence": "309-321与tests/scenarios/K3-10-review-round-cells.test.ts:106-118是同一十二格；后者157-183通过真实审查轮断言相同结果。源346-355仍有双后端、open及owner回执独有检查。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/K3-10-review-round-cells.test.ts:205-210::K3-10 $verdict+$crash settles to the literal L17 cell；不删除源测试独有断言或memory后端。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-23",
    "category": "handwritten",
    "file": "tests/work-graph/S5-request-candidates.test.ts",
    "lines": "269-289；主要改271-275",
    "tests": ["RC09 an old v2 candidate gains neither optional fields nor a request claim on read"],
    "evidence": "271-274手删字段后seed；src/core/work-graph/state/plan-machine.ts:1083-1085证明当前无request的候选仍不附requestRef，不能按旧标题删除。",
    "action": "convert:proposePlan（省略requestRef）",
    "covered_by": "原RC09全部业务断言保留；公开生成规则见src/core/work-graph/state/plan-machine.ts:1083-1085。",
    "est_lines": 6,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-24",
    "category": "handwritten",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "lines": "471-490,501-502",
    "tests": ["IN系列共享Run事实", "IN14 a decision with only a reply and no application is missing"],
    "evidence": "483-489直接写ended/starting Run，501编码replied Message。实际执行链已有tests/helpers/S2B-activity-fixture.ts:466-508；Round链单列A2-25。",
    "action": "convert:claimTask→authorizeRuntimeEntry→beginRuntimeEntry→recordRunResult；sendMessage→respondMessage",
    "covered_by": "原IN断言保留；公开执行示例tests/helpers/S2B-activity-fixture.ts:466-508，Session回复示例tests/work-graph/S5-user-messages.test.ts:243-264。",
    "est_lines": 35,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "A2-25",
    "category": "handwritten",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "lines": "337-388,494-499",
    "tests": ["IN11", "IN12 a finalized FAIL suppresses an older PASS for the same check"],
    "evidence": "375-388拼出PASS前驱的reverify FAIL后继；src/core/work-graph/model/evidence-contracts.ts:155-166规定公开reverifyRound只接finalized non-PASS链头。",
    "action": "keep-note",
    "covered_by": "原tests/work-graph/S3-context-inputs.test.ts:799::IN12暂保留；没有查明同链PASS→FAIL的等价公开步骤，需lead确定跨Run新验证或退役不可达链。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-26",
    "category": "handwritten",
    "file": "tests/work-graph/S3-graph-context.test.ts",
    "lines": "388-470,543-550,580-594,746-758",
    "tests": ["GR系列共享事实", "GR10计划切换"],
    "evidence": "直接写Goal/Plan/Session/空壳Round；真实claim后又直接改Run为ended；换计划直接改Goal pointer。563-576已存在真实claim。",
    "action": "convert:createGoal→proposePlan→applyPlanChange；recordSessionCreated；openVerification；recordRunResult",
    "covered_by": "原GR断言保留；公开计划采用示例tests/work-graph/S3-context-inputs.test.ts:460-467，真实开轮示例tests/helpers/S2B-activity-fixture.ts:233-247。",
    "est_lines": 120,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "A2-27",
    "category": "handwritten",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "lines": "274-281,518-523,548-556",
    "tests": ["共享上游Run", "AD06 revoked Run binding", "AD08 Workspace revision conflict"],
    "evidence": "直接写上游Run、直接改授权phase=revoked、直接覆盖Workspace@8。真实撤销见tests/helpers/WP1-entry-fixture.ts:333-347；pin改动使版本+1见tests/work-graph/S2C-pins.test.ts:76-78。",
    "action": "convert:真实Run流程；beginRuntimeEntry→reconcileRun(not_entered)；setLinePins",
    "covered_by": "原AD06/AD08断言保留；tests/work-graph/WP1-goal-content-entry.test.ts:99-109::GE05证明真实撤销链。",
    "est_lines": 24,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-28",
    "category": "handwritten",
    "file": "tests/work-graph/W2-agent-whiteboard.test.ts",
    "lines": "189-219,383-387,463-467",
    "tests": [
      "Agent apply adopts its own sourced candidate and preserves unchanged task basis",
      "a candidate sourced from another Run cannot be adopted by this Run",
      "exact apply replays its original receipt after terminal/revocation; changed Plan/Proposal pins conflict",
      "a signal aborted after the actual commit preserves that invocation committed result"
    ],
    "evidence": "seedAgentCandidate在tests/helpers/W2-whiteboard-fixture.ts:329-357直接写proposal/event；两个Run已在该helper175-217真实进入。",
    "action": "convert:proposeAsWorkRun/proposeAsSecondWorkRun→applyAsWorkRun",
    "covered_by": "原四组断言保留；tests/work-graph/W2-agent-whiteboard.test.ts:171-187::real claim -> B2 entered -> Agent propose commits a sourced candidate。",
    "est_lines": 12,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-29",
    "category": "handwritten",
    "file": "tests/work-graph/W1-future-plan.test.ts",
    "lines": "276-323,363-367,470-471,534-537,744-749；仅正常可达场景",
    "tests": [
      "scenario 1/2: future-only B edit + prompt edge keep A running and C satisfied after real adoption",
      "scenario 4: a stale proposal revision or an inactive source is rejected with zero writes",
      "scenario 7: authorized split adopts from the source; coverage/role weakening is zero-write rejected",
      "scenario 6 (memory): explicit old Plan excludes later Run + global Lease; active reads stay authoritative"
    ],
    "evidence": "seedAcceptedPlan/seedRun/seedLease/seedReduction直接拼记录；正常前置状态有公开流程。completeTask见src/core/work-graph/model/task-contracts.ts:64-73，验证步骤见model/evidence-contracts.ts:168-184。",
    "action": "convert:proposePlan→applyPlanChange；claimTask→真实执行；openVerification→beginCheck→recordCheckResult→finalizeChecks→completeTask",
    "covered_by": "原scenario断言保留；不含A2-42的新增Task幽灵痕迹，不能将该部分机械改成claim。",
    "est_lines": 48,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "A2-30",
    "category": "handwritten",
    "file": "tests/work-graph/WP2-context-extensions.test.ts",
    "lines": "309-320",
    "tests": ["F07 follows the real page boundary and keeps the named tail Task card under focus"],
    "evidence": "309-320循环seed candidate；同函数296-307已有真实plans owner及propose/apply。",
    "action": "convert:循环调用proposePlan并保存返回proposalId",
    "covered_by": "原tests/work-graph/WP2-context-extensions.test.ts:402::F07保留，真实入口已在296-300。",
    "est_lines": 12,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-31",
    "category": "handwritten",
    "file": "tests/work-graph/WP2-message-duties.test.ts",
    "lines": "83-100",
    "tests": ["M01/M02使用的seedRoleMatrix"],
    "evidence": "94-99直接写CoordinationPolicyRevision及active；src/core/work-graph/model/configuration-contracts.ts:15-28未提供策略安装/激活入口，源码搜索也未找到相应owner。",
    "action": "keep-note",
    "covered_by": "原M01/M02保留；今天没有查明等价公开写入口，不虚构installCoordinationPolicy转换方案。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "A2-32",
    "category": "handwritten",
    "file": "tests/work-graph/UCR-settle-review.test.ts",
    "lines": "58-96,142-165,194-210",
    "tests": ["UCR-07正常结束结算", "UCR-07 review_unavailable", "UCR-15 hold共享布置"],
    "evidence": "手写审查及round_claimed/hold_applied提交，198直接清空activeRound。真实链见tests/helpers/K3-proposal-round.ts:243-269,383-398,474-486。",
    "action": "convert:真实未知调用审查创建→带review参数的claim→recordConclusion/holdReview/settleReview",
    "covered_by": "原owner断言保留；review_unavailable从真实未认领审查开始。holdReview入口为src/core/work-graph/tasks/unknown-call-review-service.ts:979。",
    "est_lines": 80,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-33",
    "category": "handwritten",
    "file": "tests/work-graph/unknown-call-review-list.test.ts",
    "lines": "45-74",
    "tests": ["listReviews共享seed及80起的分页/过滤用例"],
    "evidence": "59-60强行赋status/open，69统一写created事件；未经过实际状态路径。",
    "action": "convert:创建真实pending review→settleReview/recordConclusion/holdReview",
    "covered_by": "原分页、Goal/status隔离及双后端保留；公开链见tests/helpers/K3-proposal-round.ts:243-269,474-486。",
    "est_lines": 30,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "A2-34",
    "category": "handwritten",
    "file": "tests/work-graph/S4C2-U3.test.ts",
    "lines": "47-108",
    "tests": ["rejects a forged proof whose acknowledgementRef names another answer as invalid"],
    "evidence": "47-86手拼NoteHead/NoteVersion/NoteDispositionChanged并提交；实际要测的是另一answer的回执。真实卡片应用已有tests/work-graph/S4C2-D17.test.ts:53-70。",
    "action": "convert:真实处理两张注记卡片，将B的正式disposition receipt交给A的proof reader",
    "covered_by": "原invalid断言保留；本文件112-178的ordinary disposition/incomplete行为独立保留。",
    "est_lines": 62,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "A2-35",
    "category": "handwritten",
    "file": "tests/work-graph/goal-independent.test.ts",
    "lines": "18-27,47",
    "tests": ["%s: Goal creation uses only the new Store transaction, including exact replay and conflict"],
    "evidence": "直接seed Project/Workspace；被测createGoal已走owner。公开初始化入口见src/core/work-graph/configuration/project-bootstrap-service.ts:528,601。",
    "action": "convert:createProject→registerWorkspace",
    "covered_by": "原tests/work-graph/goal-independent.test.ts:50-68的Goal重放、冲突和后端独立性断言保留。",
    "est_lines": 11,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "A2-36",
    "category": "handwritten",
    "file": "tests/work-graph/material-readers.test.ts",
    "lines": "20-48,61-73",
    "tests": ["%s: canonical material records use complete refs and returned values are isolated"],
    "evidence": "手写Workspace/Goal/Run/QueryRun并raw commit；公开Query示例见tests/work-graph/S3-context-inputs.test.ts:514-530。81行仅修改返回副本，不是存储篡改。",
    "action": "convert:createProject/registerWorkspace/createGoal/proposePlan/applyPlanChange/claimTask/submitQueryJob",
    "covered_by": "本文件75-82的完整ref隔离、not_found及返回值拷贝隔离全部保留。",
    "est_lines": 45,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "A2-37",
    "category": "handwritten",
    "file": "tests/work-graph/S8A-file-layer.test.ts",
    "lines": "101-112",
    "tests": ["S8A文件层测试共享scope初始化"],
    "evidence": "直接编码Project/Workspace并自造TrustedArchitectureScopeSeeded；当前公开入口见src/core/work-graph/configuration/project-bootstrap-service.ts:528,601。",
    "action": "convert:createProject→registerWorkspace",
    "covered_by": "原S8A文件层业务测试全部保留，仅替换初始化。",
    "est_lines": 12,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-38",
    "category": "tamper",
    "file": "tests/work-graph/S2B-r4-session-workspace.test.ts",
    "lines": "44-86",
    "tests": [
      "2B-r3 R4 a track run bar whose Session is in another workspace is forbidden",
      "2B-r3 R4 a calendar cell Session in another workspace is forbidden"
    ],
    "evidence": "48-55、68-74手写跨Workspace的Run history；正常claim在src/core/work-graph/tasks/claim-service.ts:1025拒绝foreign Session。",
    "action": "keep-note",
    "covered_by": "冻结R4暂保留，lead裁定持久化坏事实防御行；tests/work-graph/S2B-r2-workspace-binding.test.ts:30-85覆盖正常调用者workspace边界，但非等价坏记录覆盖。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-39",
    "category": "tamper",
    "file": "tests/work-graph/S2C-lines-failure.test.ts",
    "lines": "173-184",
    "tests": ["2C-14 (review item 2) an undecodable open responsible link marks the line B4, never no responsibility"],
    "evidence": "177真实link后，178把内部lookup schema替换为BogusLink@1，182才得到unavailable。",
    "action": "keep-note",
    "covered_by": "冻结B4暂保留，lead裁定；本文件122-143的真实读失败测试保留，不能冒充坏schema行的完整覆盖。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-40",
    "category": "tamper",
    "file": "tests/work-graph/S3-graph-context.test.ts",
    "lines": "260-277,1103-1109",
    "tests": ["GR14 a damaged catalog codec is unavailable and never a ready empty graph"],
    "evidence": "272把内部已存catalog JSON替换为截断JSON，1107验证unavailable；不是外部文件输入解码。",
    "action": "keep-note",
    "covered_by": "冻结GR14暂保留；尚无等价真实外部输入场景，需lead裁定防御行。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-41",
    "category": "tamper",
    "file": "tests/work-graph/S5-decision-application.test.ts",
    "lines": "365-382",
    "tests": ["AP12 a corrupt formal receipt event is unavailable and leaves application null with zero writes"],
    "evidence": "366先真实生成receipt，372再把内部eventAt返回JSON改为{，377-381检查unavailable和零写入。",
    "action": "keep-note",
    "covered_by": "冻结AP12暂保留；本文件384起AP13的真实cursor不一致是不同规则，不能据此删除AP12。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-42",
    "category": "tamper",
    "file": "tests/work-graph/W1-future-plan.test.ts",
    "lines": "705-732",
    "tests": ["scenario 9的added-run/added-lease/added-reduction及防御检查顺序子段"],
    "evidence": "705说明B1/B2尚待加入计划，710-713、717-725却提前seed其执行痕迹；单独Lease也缺配套claim。没有同形公开生成步骤。",
    "action": "keep-note",
    "covered_by": "正常可达的已有Task执行场景按A2-29转换；新增Task幽灵痕迹与防御顺序行交lead裁定，暂不删除冻结规格。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "A2-43",
    "category": "tamper",
    "file": "tests/work-graph/S5-notices.test.ts",
    "lines": "79-95,210-212",
    "tests": ["NR05 corrupt null origin is unavailable子段"],
    "evidence": "corruptOrigin把内部记录位置改为null；211-212验证unavailable及零写入，与A2-11的旧缺字段排序分开。",
    "action": "keep-note",
    "covered_by": "冻结NR05防御子段暂保留；本文件238-244::NR06覆盖当前真实位置，非法null没有等价公开生成路径。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  }
]
```

分类合计如下。`keep-note` 不预先计入删改收益；重复项的行数只估算来源端，保留端补充断言的增量尚未扣除。

| 类别 | 项数 | 估计删除或改写行数 |
|---|---:|---:|
| stale／过时 | 15 | 353 |
| duplicate／重复 | 7 | 137 |
| trivial／琐碎 | 0 | 0 |
| handwritten／手写事实 | 15 | 497 |
| tamper／只为篡改候选 | 6 | 0 |
| helper／辅助 | 0 | 0 |
| **合计** | **43** | **987** |

阅读覆盖为 `.lead-ref/t-area-A2.txt:1–163` 的全部 **163 个文件、37,288 行**：每个文件均扫描了测试声明、参数化行、直接事实写入和旧格式/损坏注入位置；候选项再展开相关上下文，并在整个 `tests/` 树内检索覆盖用例和公开流程。环境没有可用 `rg`，使用本地文件递归检索替代。没有执行被阅读的测试或 helper。

全文阅读 **21 个文件，共 2,268 行**。下列文件均位于 `tests/work-graph/`：

```text
S2B-r2-keyed-cap.test.ts
S2B-r2-never-entered.test.ts
S2B-r2-r5-not-entered.test.ts
S2B-r4-session-workspace.test.ts
S2C-lines-d1.test.ts
S2C-node-detail-executions.test.ts
S4B-memory-conflicts-read.test.ts
S4B-memory-version-lists.test.ts
S4B-note-basis-path.test.ts
S4B-note-check-head-version.test.ts
S4B-note-conflicts.test.ts
S4C-note-path-ownership.test.ts
S4C2-U3.test.ts
S4C2-goal-triggers.test.ts
S8A-catalog-version-time.test.ts
S8A-path-ownership-dedupe.test.ts
UCR-settle-review.test.ts
WP1-goal-content-entry.test.ts
goal-independent.test.ts
material-readers.test.ts
unknown-call-review-list.test.ts
```

其余 **142 个文件、35,020 行属于略读加候选段展开**，没有声称逐行全文审读。其精确文件集合为 `.lead-ref/t-area-A2.txt` 的以下行：

```text
1–9、12–13、15–20、22–27、29–43、45–60、62–71、73–74、
76、78–79、81–93、95–110、112–114、116–141、143–144、
146–151、153–156、158–160
```

仍需 lead 裁定或特别保留的边界：

- **不可达事实不能假装有转换入口。** A2-25 的 PASS→FAIL 同链、A2-31 的 CoordinationPolicy 安装、A2-42 的未加入 Task 执行痕迹，都没有落实等价公开步骤。A2-07 的 D1 计数还牵连冻结字面规格和跨区共享夹具。
- **没有因 `legacy` 字样批量删除。** `legacy_template` 当前有效，依据 `docs/refactor/HANDOFF.md:597`；`S3-role-profiles.test.ts:220–239` 实际通过当前 `installRoleSpec` 安装缺 duty 的内容；`W2-agent-whiteboard.test.ts:109–114` 的无 `submittedBy` Host candidate 也不能仅凭标题判旧。
- **当前初始采用产生的 null 不是当然的旧数据。** `S8A-catalog-version-time.test.ts:22–29,62–64` 使用现有真实夹具得到初始目录 null；A2-21 建议合并重复覆盖，未建议删除这个行为。
- **没有把纯规格表或合法故障注入归为琐碎。** `S4C2-goal-triggers.test.ts:115–198` 是明确的冻结 reader 行；其编码假记录与公开流程能否逐行等价，尚未证明，未提出删除。`S5-goal-cause-at-least-cursor.test.ts:20` 的空提交用于推进水位，也未当成手写业务事实。
- **没有把所有 malformed 检查归为存储篡改。** `WP2-undelivered-notices.test.ts:317–351` 是将非法下一版提交给 Store schema，并在写入前拒绝；它与“修改已存记录后触发读防御”不同，本轮没有据此提出删除。`material-readers.test.ts:81–82` 修改返回副本，属于有效隔离断言。
- **双后端与真实边界继续保留。** K3 十二格有重复，但不能用 Host 场景替代 memory 后端覆盖；这也符合 `docs/refactor/HANDOFF.md:683` 的决定 85-4。以上均为静态清点结论，不是运行覆盖率或完整产品验收结论。