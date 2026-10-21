# SC findings, frozen (lead, 2026-10-21 evening; decision 80)

The Codex audit of SC (`105ba68`, `efa2303`) in five parts: 11 会出错, 10 违规, 4 不整洁 by Codex's count (24 rows
here; P1-01 and P2-01 are the same defect seen from both sides). The lead checked P1-01 to P1-04 against the code
(true), adopts every row, and adds L-01 and L-02. The bubblewrap full suite on `efa2303` had one failure,
`tests/architecture/production-reach.test.ts` (`goal-conflicts.ts:87 GOAL_LOOKUP_PAGE_LIMIT` unreached): P1-06 fixes it.

## 0. Rulings (bind every row)

- **R-SC-1 (the small-case rule).** Every daily small case meets the book §4 item 2 in full: **every read layer the
  case is about crosses at least two pages, and the decisive item is on the last page of every layer** (except where
  the book's table says the rule does not apply); the count of each layer includes the fixture's own records; each
  layer's order and page split are written in a comment, hand-computed (the order from the key the store sorts by:
  UTF-8 bytes of the index key, `src/core/record-store/lookup-index.ts:568–573`). Each row's fix is the default way.
  If it does not work when you build it, use another way that meets this rule and say why in the reply.
- **R-SC-2 (defaults belong to the owner).** A test helper or a production caller passes a width only when one was
  given to it; it never fills in a default itself (absent stays absent down to the owner, so the owner's constant
  decides). P1-04 and L-02 apply this.
- **R-SC-3 (scale files and fixture defaults).** The `.scale.test.ts` files do not change in this rework. A fixture's
  default path does exactly what it did at `sc-base` (same calls in the same order); a new option changes only the
  path that passes it (P1-02).
- **R-SC-4 (expected values).** Expected keys and values are literals in the spec's format; an id that a public
  creation step returned may be put into the literal. Never a production function or constant (P4-01, P4-02).
- **R-SC-5 (wrong hand calculations).** Where a row says a comment's count or order is wrong (P2-03, P5-04, P5-05),
  fix the comment in the test file and give the corrected calculation in the reply; DSH's earlier reply is not
  edited.

## 1. Rows

| row | class | where | problem (Codex) | fix |
|---|---|---|---|---|
| P1-01 | 会出错 | `src/core/work-graph/views/decision-read-model.ts:837` | 队列直接调用 listWorkspaceGoals 时漏传 lookupPageLimit，仍按默认 200 读取。QA-06 和 R2A07/08 的 5 个 Goal 在这一层实际只有 1 页，而非注释声称的 2、2、1；冲突组装器的独立注入没有覆盖这条路径。 | 在此调用添加第三参数 deps.lookupPageLimit，经 listWorkspaceGoals 传到 lookupAll。 |
| P1-02 | 会出错 | `tests/helpers/S2A-notices-overbound-fixture.ts:108` | 默认 creation 从基线逐条 send→respond，变成先发送全部、再回复全部。两条时从 send1/reply1/send2/reply2 变成 send1/send2/reply1/reply2，改变提交顺序及编号分配；未传 replyOrder 的规模文件也受到影响。基线见 .lead-ref/base/tests/helpers/S2A-notices-overbound-fixture.ts:91，规模调用见 tests/work-graph/S2A-notices-overbound.scale.test.ts:27。 | 默认分支恢复原先逐条发送并立即回复；仅显式 message-key 分支先收集、排序、再回复。 |
| P1-03 | 违规 | `tests/helpers/B2-401-world.ts:243` | 计数包装器新增 Math.min 截断所有 lookup 请求，并记录截断后的 limit，形成任务书未要求的缩页机制。即使 D 未生效、owner 请求 200，包装器仍把 5 条读成 2、2、1，计数器仍显示 [2,2,2]，遮住接缝错误。基线包装器在 .lead-ref/base/tests/helpers/B2-401-world.ts:219 原样转发。 | 删除包装器 lookupPageLimit 参数和截断逻辑，恢复 base.lookup(request) 并记录 request.limit；小用例仅通过 taskRequestPageLimit: 2 缩页。 |
| P1-04 | 违规 | `tests/helpers/B2-401-world.ts:202` | helper 在调用者省略 taskRequestPageLimit 时补成 200，并在第 290 行显式传入 owner。tests/runtime/B2-401-world.scale.test.ts:48 的无参调用因此没有覆盖 owner 自己的默认选择。 | 删除 helper 对 taskRequestPageLimit 的默认补值，仅在调用者明确提供时条件展开该字段。 |
| P1-05 | 违规 | `tests/helpers/S2C-X-scale-fixture.ts:278` | 新代码直接读取并解码 Project 后将 revision 放入 expected，并在第 266 行调用内部 readCurrentCatalogWindow 取得 basedOn 指纹。没有新增直接写业务记录，但这些平台派生值并非经公共读取步骤取得；第 286 行调用公共修订入口不能使此前的内部读取合法化。 | 通过公共 projects.readWorkspaceRegistration 获取 Project/Workspace 修订号，通过公共 catalog.readArchitectureRevision 的 current selection 获取基线和目录，再使用其返回值调用 reviseArchitectureCatalog。 |
| P1-06 | 不整洁 | `src/core/work-graph/views/goal-conflicts.ts:87` | 新增 GOAL_LOOKUP_PAGE_LIMIT 没有运行时代码引用，第 65、126 行注释却声称默认使用它；实际默认来自 lookupAll。 | 删除未使用常量，将两处注释改为省略参数时沿用 lookupAll 的默认 200。 |
| P2-01 | 会出错 | `tests/work-graph/S2A-queue-bounds.test.ts:119` | 同样影响 tests/work-graph/S5R2-queue-history.test.ts:136。decision-read-model.ts:837 的主 Goal 列表漏传 lookupPageLimit，5 条仍按默认 200 一页读完。goal-conflicts.ts:235 的另一条读取虽收到宽度 2，不能替代主列表覆盖。 | 在 src/core/work-graph/views/decision-read-model.ts:837 为 listWorkspaceGoals 传入第三参数 deps.lookupPageLimit，使主列表实际读取 2、2、1。 |
| P2-02 | 会出错 | `tests/work-graph/S2A-queue-request-candidates.test.ts:80` | 漏算 tests/helpers/S5-decision-fixture.ts:788、807 保留的 PB1 已采用提案。B′实际6条、2/2/2；按 src/core/record-store/lookup-index.ts:568 的字节序，S2AQ09-2 排第3，在第2页而非末页。A实际4条、2/2，活候选位于末页。.lead-ref/replies/sc-reply.md:194 的纠正仍错误。 | 仅将日常例改为5个候选、lookupPageLimit为4：A共6条分4/2，B′共8条分4/4，活候选排第5且两层均在末页；同步名称、注释和回复，保留规模例原文。 |
| P2-03 | 会出错 | `.lead-ref/replies/sc-reply.md:142` | R2A09被算成3页，tests/work-graph/S5R2-queue-history.test.ts:188 也只说明新增五张卡。夹具另外保留两张候选、一张原因、一张冲突卡（tests/work-graph/S5-decision-queue.test.ts:232），实际9张、宽2、5页；消息索引另含两条旧消息（tests/helpers/S5-decision-fixture.ts:1111），实际7条、宽2、4页。 | 将回复和日常注释补为完整队列9张、2/2/2/2/1，以及消息索引7条、2/2/2/1，写明顺序和末页项；保留现有集合与只读断言，不删除夹具卡片。 |
| P2-04 | 违规 | `tests/work-graph/S2A-queue-bounds.test.ts:60` | 同文件:104及 tests/app/S2A-decision-routes.test.ts:120 同样只写数量分组，没有逐层实际顺序和末页身份。.lead-ref/replies/sc-reply.md:193 的7条消息、4页计算成立，但消息ID由 mailbox-service.ts:750 哈希生成，lookup-index.ts:568 按字节序读取，创建顺序不能代替读取顺序。 | 补写逐页实际顺序并点名末页：QA04消息层为waiting-2，QA05内外层均为send-0，QA14内外层均为send-3；保持造数和断言不变。 |
| P3-01 | 会出错 | `tests/work-graph/WP2-undelivered-notices.test.ts:523` | 目录实际顺序为[S(a636…),闲置(c9bd…)]/[D(e703…)]，唯一退役的源Session是第一页的S。目录只读第一页，全部4/5条回复仍可返回，长度断言仍通过。依据：tests/helpers/task-claim-fixture.ts:374、tests/helpers/B2-execution-fixture.ts:166、src/core/work-graph/sessions/session-directory.ts:140、tests/helpers/S1-archive-service-fixture.ts:288、tests/work-graph/WP2-undelivered-notices.test.ts:555、579。 | 只在小版本交换双方职责：末页的D发信并退役，S回复；通过现有enter/send/yieldWait/respond/health参数完成，保留全部断言，并写明完整目录页序。 |
| P3-02 | 违规 | `tests/work-graph/WP2-undelivered-notices.test.ts:537` | 按当前夹具请求序列及消息标识公式静态计算，4条世界的内层页序为[4,3]/[2,1]，被尾项断言点名的第4条在内层第一页、外层末页；5条世界为[4,3]/[2,1]/[5]。总数断言仍能检测回复截断，但指定尾项没有同时处于各层末页。依据：tests/helpers/S1-archive-service-fixture.ts:187、tests/helpers/WP2-notices-fixture.ts:125、src/core/work-graph/communication/mailbox-service.ts:750、3253、tests/work-graph/WP2-undelivered-notices.test.ts:562。 | 在小版本replyLine中按消息键升序安排实际回复，返回同序消息和回复数组，保留原断言形状；结合P3-01重新手算并注明两个世界的内外层页序。 |
| P3-03 | 违规 | `tests/work-graph/S2A-notices-overbound.test.ts:48` | 遗漏A层用户消息索引扫描：基础2条加新增5条，共7条，宽度2为2,2,2,1四页。以N0至N4表示通知创建顺序，静态推导为[N0,基础已答]/[N4,N3]/[基础待答,N2]/[N1]；被断言的memberTailKey是N4，处于第2页而非第4页。依据：tests/helpers/S5-decision-fixture.ts:1111、1112、src/core/work-graph/views/decision-read-model.ts:875、1614、tests/helpers/S2A-notices-overbound-fixture.ts:142、tests/work-graph/S2A-notices-overbound.test.ts:78。 | 给现有夹具增加可选通知请求标识参数，默认保持原行为；日常例使用手算过的标识，使最后提交的通知也位于A层末页。补写A层四页和成员来源层三页的完整顺序，保留原断言。 |
| P3-04 | 违规 | `tests/work-graph/S2A-notices-attempt.test.ts:21` | 注释正确写出2+1页和重复组装时4次读取，但未写排序依据及末页requeue身份。实际逐个提交rework-000、001、002，见tests/work-graph/S2A-notices-attempt.test.ts:27、29。 | 补明ordered层按提交位置升序，来源层沿同一通知顺序；两层均为[rework-000,rework-001]/[rework-002]，并说明总数3依赖末页的rework-002。 |
| P3-05 | 不整洁 | `tests/work-graph/S2A-notices-overbound.test.ts:27` | 新名称称a 5-Session directory，但目录实际为基础2加新增5加responder 1，共8个；同例正文已写对，见tests/work-graph/S2A-notices-overbound.test.ts:35。 | 名称明确区分新增5个Session和目录共8个Session，同时保留回复、通知及页宽尺寸。 |
| P4-01 | 违规 | `tests/work-graph/S2A-queue-derived-cards.test.ts:47` | 第47、63行调用生产函数 decisionSourceKey，结果在第51、68行用作卡片键的期望值，违反小例期望值不得由生产函数计算的要求。 | 将两处断言的期望键按规格写成末项00004的字面字符串；请求构造与规模文件保持原样。 |
| P4-02 | 违规 | `tests/work-graph/WP2-context-extensions.test.ts:543` | 第543至546行的四个种子行键由生产函数 decisionSourceKey 计算，随后用于第550、571行的成员断言。 | 按规格格式字面构造四个期望行键，仅代入公开创建步骤返回的标识；移除这些期望值对 decisionSourceKey 的调用。 |
| P4-03 | 违规 | `tests/work-graph/WP2-context-extensions.test.ts:439` | 第439、513行起的注释没有写全内层顺序和分页：B′为4个候选加1个已采纳初始提案，共5条，分2/2/1；消息层含夹具原有两条消息，分别为6条分2/2/2、7条分2/2/2/1。注释也未标明内层末页记录。 | 在两个小例旁补齐B′、A层的完整记录顺序、逐页分组和断言依赖的末页记录；保留现有规模及断言。 |
| P4-04 | 不整洁 | `tests/work-graph/WP2-context-extensions.test.ts:9` | 文件头仍称本文件验证每页100和5000卡边界，实际每日用例已改为页宽2、4个候选及新增4/5条请求。 | 更新文件头，说明每日文件验证缩小后的分页行为，原规模边界由相邻规模文件保留。 |
| P5-01 | 会出错 | `tests/work-graph/S2C-lines-scale.test.ts:46` | archivedPairs、archivedCopies 都缩成 0，公式退化为 5−(1−1)=5（同文件:78）。即使漏掉归档前任扣减、直接返回 S，断言仍通过；归档列表也无法检出遗漏前任／副本过滤。实际扣减和过滤在 work-line-reader.ts:1768、1665、1669。 | 保留 5 个归档头，将归档 pair、copy 各设为 1：S=6、F=2、A=1，结果为 5。按夹具归档顺序指定秒数 [5,0,1,2,3,4,6]，使 7 条候选按页宽 2 返回的头数为 [0,2,2,1]，最后一页仍有决定项；同步修改手算注释。 |
| P5-02 | 会出错 | `tests/work-graph/S2C-lines-scale.test.ts:134` | W 的锚点层为 4/2=2 页，但接手 Run 层三个任务各 2 条、最后一个任务 1 条，宽度 2 时全部只有一页（S2C-X-scale-fixture.ts:427、440、448）。readEnteredAnchors 即使只读首页，日常两例仍通过；循环在 work-line-reader.ts:2003、2038。sc-reply.md:196 承认这一点，但未满足跨层要求。 | 将日常 listPageLimit 改为 1，使三个已接手任务分别读 [原 Run]、[picker]，决定性的 picker 位于第二页。同步重算 R 为 1+8×3=25，W 为 4+3×4+2=18；保留默认预算完整、预算 10 为 partial 的断言。 |
| P5-03 | 会出错 | `tests/runtime/B2-401-world.test.ts:58` | 日常调用还将测试包装的 lookupPageLimit 设为 2。包装强制使用 min(request.limit,2)，计数器记录截后的值（B2-401-world.ts:243、246）。即使生产钩子或请求路径漏传 D、仍请求 200，包装也制造 [2,2,1] 三页，页宽断言仍通过；真实传参点在 command-rerun-request-service.ts:467、582。 | 删除日常调用中的 lookupPageLimit: SMALL_PAGE，只通过 taskRequestPageLimit: 2 注入 D，让请求路径由 D 传到 A；删除日常文件中宣称包装也需缩页的说明。 |
| P5-04 | 会出错 | `tests/work-graph/S2C-lines-scale.test.ts:86` | 注释写成 [task,module1]、[module2]。实际键由 canonicalJson(ref) 生成（session-record-codecs.ts:970），按 UTF-8 字节排序（lookup-index.ts:573），module 在 task 前，正确页序为 [module1,module2]、[task]。任务确实位于末页、断言有效，错误在手算；sc-reply.md:84 同样写错。 | 将日常注释及对应回复改为 [module1,module2]、[task]，明确任务是第二页唯一记录。 |
| P5-05 | 会出错 | `tests/work-graph/S2C-lines-scale.test.ts:74` | 注释将本例 active-copy 专用索引读取算成 2 页。listWorkLines 实际从已读取的 16 个 active Session 建立副本索引（work-line-reader.ts:3011），并跳过专用读取（:293），所以本例该索引读取是 0 次。专用的 3 条／2 页读取发生在归档列表组装路径（:3050、295）。 | 分开注明两条路径：例 (1) 为 active Session 共 16 条、8 页，副本索引在内存建立；将专用副本索引每次 [2,1] 的说明放到例 (2)，并补齐 active Session 的手写页序。 |
| L-01 | 不整洁 | `src/core/work-graph/views/goal-conflicts.ts:84` | SC1 reworded an unrelated comment ("a source lookup window" → "one source lookup window"). | Restore the `sc-base` text of that comment. |
| L-02 | 不整洁 | `src/core/work-graph/views/decision-read-model.ts:876`, `:912`, `:930`, `:1341` | The lookup width is passed as `deps.lookupPageLimit ?? SOURCE_PAGE_LIMIT`: the same value (200) today, but the owner's constant of the read (`lookupAll`'s, `readLookupKeys`'s) no longer decides when the width is absent (R-SC-2). | Pass `deps.lookupPageLimit` as it is (absent stays absent: `lookupAll`'s `options?.pageLimit ?? LOOKUP_PAGE_LIMIT` and `readLookupKeys`'s default parameter apply); the two private helpers take `pageLimit?: number`. P1-01's new argument at `:837` follows the same rule. `sourcePageLimit` (`:958`, `:1027`, `:1379`) stays as it is: `SOURCE_PAGE_LIMIT` is that read's own constant. |

## 2. Groups (disjoint files)

| group | rows | files |
|---|---|---|
| A | P1-01, P1-06, L-01, L-02, P2-01, P2-02, P2-03, P2-04 | `src/core/work-graph/views/decision-read-model.ts`, `src/core/work-graph/views/goal-conflicts.ts`, `tests/work-graph/S2A-queue-bounds.test.ts`, `tests/work-graph/S5R2-queue-history.test.ts`, `tests/app/S2A-decision-routes.test.ts`, `tests/work-graph/S2A-queue-request-candidates.test.ts` |
| B | P1-03, P1-04, P5-03 | `tests/helpers/B2-401-world.ts`, `tests/runtime/B2-401-world.test.ts` |
| C | P1-02, P3-01, P3-02, P3-03, P3-04, P3-05 | `tests/helpers/S2A-notices-overbound-fixture.ts`, `tests/work-graph/S2A-notices-overbound.test.ts`, `tests/work-graph/S2A-notices-attempt.test.ts`, `tests/work-graph/WP2-undelivered-notices.test.ts` (and, for P3-03's option, the fixture that issues the notice request ids) |
| D | P1-05, P5-01, P5-02, P5-04, P5-05 | `tests/helpers/S2C-X-scale-fixture.ts`, `tests/work-graph/S2C-lines-scale.test.ts` |
| E | P4-01, P4-02, P4-03, P4-04 | `tests/work-graph/S2A-queue-derived-cards.test.ts`, `tests/work-graph/WP2-context-extensions.test.ts` |
