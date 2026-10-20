已完成 **137/137 行**静态审查：**D1 3、D2 8、U 13、F 37、G 76、N 0、待定 0**。本组全部是 C 组函数，不能据此认定“T 删除了最后一个覆盖它的测试”。清单依据：`lists/list-C4.tsv:2` 至 `lists/list-C4.tsv:138`。未写文件，未运行测试或构建。

为控制表宽，以下路径采用明确的相对根：

- 表中生产路径相对于 `D:/cxt/t-docs/tree/src/core/work-graph/`；理由中仅写文件名时，沿用该行所在目录。
- `S/`＝`D:/cxt/t-docs/tree/src/`；`T/`＝`D:/cxt/t-docs/tree/tests/work-graph/`；`H/`＝`D:/cxt/t-docs/tree/tests/helpers/`。
- `lists/`、`ref/` 相对于 `D:/cxt/t-cov/`。

补测建议中复用的注入入口如下；这些建议均通过真实 owner 建立状态：

| 简称 | 已有接缝及用法 |
|---|---|
| R：存储读故障 | 按目标 refKey 包装 `lookup/readMany`，返回不可用；已有实现见 `H/S4A-note-fault-fixture.ts:58`、`:81`。需要 `lookupCommit/eventAt` 或抛异常时，沿用完整后端包装结构：`T/S3-graph-context.test.ts:228`、`:238`、`:246`。 |
| W：事务故障 | `beforeWrite` 抛错、`failNextWrite`；内存和 SQLite 后端都已有入口：`H/graph-session-fixture.ts:278`、`:284`、`:286`、`:470`。 |
| C：真实并发 | 包装后端并设屏障，让另一真实 owner 调用先完成；已有 gate/commit 包装：`H/S4A-note-interleave-fixture.ts:44`、`:53`、`:92`。下面需要读间屏障的位置，沿用该包装方式。 |
| B：正文存储故障 | 包装真实 `RawArtifactStorePort`，在指定 `put` 返回失败；已有委托包装：`T/R3d-observed-architecture.test.ts:162`。 |
| V：工作区／源码故障 | 在实际 workspace/source 接口注入目录失效、读取失败或捕获期间变化；已有 source 委托及依赖注入：`H/R3e-evidence-fixture.ts:320`、`:322`、`:325`。 |

下表的 A 专属列均为“—”，因为清单没有 A 行；不为 C 行追认不存在的“被 T 删除的最后测试”（`lists/list-C4.tsv:2`、`lists/list-C4.tsv:138`）。

| row | path:line_after | kind | class | reason（file:line） | proposal | A：旧测试／T 项 |
|---|---|---|---|---|---|---|
| C4-001 | architecture/architecture-delta.ts:79 | function | G | 至少两个强连通环组件才执行排序比较器；生产比较入口存在（`architecture-delta.ts:72`；`architecture-service.ts:1615`）。 | 建立两组独立 import 环→捕获前后版本→`compareArchitecture`；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-002 | architecture/architecture-delta.ts:113 | function | G | 至少两个 unresolved 项才执行比较器（`architecture-delta.ts:113`）。 | 建立两个未解析 import→捕获两版→比较；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-003 | architecture/architecture-record-codecs.ts:782 | function | G | 自动捕获请求的幂等恢复会解码原事件（`architecture-service.ts:887`、`:1301`）。 | 相同 requestId、trigger、requestedAt 连续调用 `requestAutoCapture`；补入 `T/S8A-L8-observation-state.test.ts:431`。 | — |
| C4-004 | architecture/architecture-service.ts:393 | function | F | 捕获／历史读取的真实存储拒绝进入映射（`architecture-service.ts:532`、`:603`）。 | 捕获或查询架构→R 使目标 `readMany` 不可用；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-005 | architecture/architecture-service.ts:420 | function | F | 捕获持久化正文或分块失败会进入映射（`architecture-service.ts:1171`、`:1182`）。 | `captureSourceChanges`→B 使正文 `put` 失败；补入 `T/R3d-observed-architecture.test.ts:155`。 | — |
| C4-006 | architecture/architecture-service.ts:427 | function | G | 查询支持 `atLeastCursor`，会比较来源水位（`architecture-service.ts:1582`）。 | 捕获→把返回 cursor 传给架构查询的水位参数；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-007 | architecture/architecture-service.ts:558 | function | G | 文件差异分类数组排序需要多个元素（`architecture-service.ts:558`）。 | 两次捕获间分别增加、修改、删除至少两个文件，覆盖全部差异比较器；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-008 | architecture/architecture-service.ts:558 | function | G | 文件差异分类数组排序需要多个元素（`architecture-service.ts:558`）。 | 两次捕获间分别增加、修改、删除至少两个文件，覆盖全部差异比较器；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-009 | architecture/architecture-service.ts:878 | function | G | 自动捕获同身份重试直接调用恢复函数（`architecture-service.ts:1301`）。 | 完成 `requestAutoCapture`→原请求重试并核对原回执；补入 `T/S8A-L8-observation-state.test.ts:431`。 | — |
| C4-010 | architecture/catalog-service.ts:77 | function | G | 公开 adoption 输入可以无效，例如空 baselineId（`catalog-service.ts:468`）。 | 调用 adoption，传空 baselineId，断言 invalid；补入 `T/A1-architecture-catalog.test.ts:41`。 | — |
| C4-011 | architecture/catalog-service.ts:79 | function | F | 历史 revision 的存储读取失败进入转换（`catalog-service.ts:434`）。 | 真实 adoption→读取该 revision→R 使读取失败；补入 `T/S8A-catalog-version-time.test.ts:21`。 | — |
| C4-012 | architecture/catalog-service.ts:564 | function | F | adoption 提交冲突后，找到同身份成功回执才调用恢复回调（`catalog-service.ts:337`、`:564`）。 | 两个相同 adoption 请求；C 卡住一个提交，让另一个先成功，再核对恢复；补入 `T/A1-architecture-catalog.test.ts:41`。 | — |
| C4-013 | architecture/catalog-service.ts:648 | function | F | 活动指针两次读取间变化会产生 source_stale，再恢复同身份回执（`catalog-service.ts:379`、`:386`、`:648`）。 | revise 第一次指针读取后设 C 屏障→同请求另一调用提交→恢复读取；补入 `T/S8A-catalog-version-time.test.ts:21`。 | — |
| C4-014 | architecture/catalog-service.ts:659 | function | F | 早期回执未命中后，同身份并发提交可使 basedOn 过时（`catalog-service.ts:631`、`:653`）。 | C 卡住早期未命中后的 revise→另一相同请求提交→继续并恢复原回执；补入 `T/S8A-catalog-version-time.test.ts:21`。 | — |
| C4-015 | architecture/catalog-service.ts:686 | function | F | 已读目录后，Workspace 可被公开设置操作推进，导致 scope pin 冲突（`catalog-service.ts:683`；`configuration/line-settings-service.ts:88`、`:214`）。 | C 卡在目录读完后→同身份 revise 先提交→`setLinePins` 推进 Workspace→恢复首调用；补入 `T/S8A-catalog-version-time.test.ts:21`。 | — |
| C4-016 | architecture/catalog-service.ts:745 | function | F | revise 提交 CAS 冲突后可恢复同身份已提交事件（`catalog-service.ts:725`、`:742`）。 | 两个相同 revise 请求，C 控制提交先后；核对原回执；补入 `T/S8A-catalog-version-time.test.ts:21`。 | — |
| C4-017 | architecture/formal-comparison.ts:122 | function | D2 | 已先排除不支持及 `parsed < files`；当前生产扫描器的 failed/skipped 必然减少 parsed，故到此 issues 为空（`formal-comparison.ts:120`；`S/core/workspace/typescript-light-scan.ts:414`、`:423`；`S/core/workspace/architecture-language-provider.ts:155`）。 | 删除此冗余 `issues.some`；前置判断通过后直接返回 true。保留上游完整性判断。 | — |
| C4-018 | architecture/graph-index.ts:139 | function | G | 邻域搜索某层有至少两个节点时执行排序（`graph-index.ts:139`、`:177`）。 | 捕获一个文件依赖两个文件的图→查询其邻域；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-019 | architecture/graph-index.ts:226 | function | G | 影响分析有多个种子时执行初始排序（`graph-index.ts:213`、`:226`）。 | 同次修改至少两个文件→捕获→`queryImpact`；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-020 | architecture/graph-index.ts:238 | function | G | 反向遍历层有多个依赖者时执行比较器（`graph-index.ts:238`）。 | 两个文件依赖同一文件→修改被依赖文件→`queryImpact`；补入 `T/R3d-observed-architecture.test.ts:10`。 | — |
| C4-021 | communication/decision-application.ts:34 | function | F | 应用回执的 `lookupCommit/eventAt` 失败会进入映射（`decision-application.ts:116`、`:130`）。 | 回答真实 decision→执行正式动作→记录应用时用 R 使回执读取失败；补入 `T/S5-decision-application.test.ts:131`。 | — |
| C4-022 | communication/decision-application.ts:96 | function | G | 对实际 adoption 回执的“不支持事件”解码器可由公开错误输入触发；事件先于关联校验被解码（`decision-application.ts:96`、`:145`、`:153`）。 | adoption 取得真实回执→回答 decision→把该回执传给应用记录，断言拒绝；补入 `T/S5-decision-application.test.ts:131`。 | — |
| C4-023 | communication/decision-application.ts:98 | function | G | 对实际 policy activation 回执的拒绝解码器同样可达（`decision-application.ts:98`、`:145`）。 | 激活完成策略取得真实回执→回答 decision→以该回执记录应用，断言拒绝；补入 `T/S5-decision-application.test.ts:131`。 | — |
| C4-024 | communication/decision-service.ts:452 | function | G | 非 host 的 query_run 回答读取者会解析其 Session（`decision-service.ts:917`、`:943`、`:468`）。 | 提交／执行 Query→产生 needs_decision→host 回答→该 Query Session 读回答；补入 `T/S5-decision-application.test.ts:131`。 | — |
| C4-025 | communication/decision-source-facts.ts:201 | function | U | 仅持久记录解码失败调用 damaged 回调；正常读取失败另行处理（`decision-source-facts.ts:250`）。 | 保留现有不可用诊断，不补篡改测试；它避免把损坏来源当作有效事实。 | — |
| C4-026 | communication/decision-source-facts.ts:209 | function | U | saved-answer 的 damaged 回调同样仅来自存储内容解码失败（`decision-source-facts.ts:250`、`:999`）。 | 保留现有损坏诊断且不测；不恢复旧格式兼容或手写 answer 记录。 | — |
| C4-027 | communication/decision-source-facts.ts:213 | function | F | `readStoredRecord` 的真实存储拒绝进入该函数（`decision-source-facts.ts:234`）。 | 建立真实 Query／回答→读 decision source→R 拒绝指定读取；补入 `T/S5-decision-queue.test.ts:92`。 | — |
| C4-028 | communication/decision-source-facts.ts:421 | function | G | planning question 来源通过保存的 answer.runRef 解析读取 Session（`decision-source-facts.ts:657`）。 | planning Query→保存 needs_decision 回答→读取 decision queue/source；补入 `T/S5-decision-queue.test.ts:92`。 | — |
| C4-029 | communication/decision-source-facts.ts:641 | function | G | 已有正式 answerRefs 的 QueryJob 会执行 `some` 回调（`decision-source-facts.ts:641`）。 | planning Query→正式保存回答→读取其 question source；补入 `T/S5-decision-queue.test.ts:92`。 | — |
| C4-030 | communication/mailbox-service.ts:740 | function | G | `sendUserMessage` 将用户 expected 送入写路径；多个 pin 可先触发排序，即使后续被拒绝（`mailbox-service.ts:3407`）。 | host 调用 `sendUserMessage`，传两个结构合法 pin，断言公开校验结果；补入 `T/S5-user-messages.test.ts:1`。 | — |
| C4-031 | communication/mailbox-service.ts:2799 | function | G | 已有 acceptedInputs 时，下一真实输入接纳会执行查找回调（`mailbox-service.ts:2767`、`:2799`）。 | 发送并消费消息→回复→消费回复，使用不同真实输入事件；补入 `T/C1-session-mailbox.test.ts:42`。 | — |
| C4-032 | communication/mailbox-service.ts:3081 | function | G | archive wait disposal 检查已有 acceptedInputs（`mailbox-service.ts:3081`）。 | 消费原消息→形成回复／等待→请求归档→`disposeArchiveWait`；补入 `T/S1-wait-disposal.test.ts:66`。 | — |
| C4-033 | communication/mailbox-service.ts:3657 | function | F | 这是内部 persist 的命中恢复；外层已先查询，普通串行重试通常提前返回（`decision-service.ts:722`；`mailbox-service.ts:3710`）。 | 两个同身份消息写请求；C 在外层未命中与内部查询之间让另一调用提交；补入 `T/C1-session-mailbox.test.ts:42`。 | — |
| C4-034 | communication/mailbox-service.ts:3661 | function | D1 | 私有 `recheckPersist` 只有定义，没有调用；实际恢复走其他已接线入口（`mailbox-service.ts:3661`、`:3710`）。 | 删除该私有包装函数；不删被其他路径使用的公共回执恢复实现。 | — |
| C4-035 | evidence/evidence-service.ts:141 | function | G | 合法形状但不存在的 round 会返回 notFound（`evidence-service.ts:423`）。 | 对不存在的 round 调用 `beginCheck/readRound`；补入 `T/R3e-evidence.test.ts:120`。 | — |
| C4-036 | evidence/evidence-service.ts:144 | function | F | 开启验证前或提交前取消可达（`evidence-service.ts:1038`、`:397`）。 | 完成真实 subject Run→中止调用 signal→`openVerification`；复用 `H/R3e-evidence-fixture.ts:161`，补入 `T/R3e-evidence.test.ts:72`。 | — |
| C4-037 | evidence/evidence-service.ts:177 | function | G | `openVerification` 读取不存在的 Goal 会映射拒绝，不要求故障（`evidence-service.ts:1042`）。 | 传结构合法但不存在的 Goal ref 调用公开入口；补入 `T/R3e-evidence.test.ts:120`。 | — |
| C4-038 | evidence/evidence-service.ts:180 | function | F | 工作区 root 解析或授权失败由此映射（`evidence-service.ts:920`、`:923`）。 | 完成真实 Run→V 使目录解析／访问失败→开启验证；补入 `T/R3e-evidence.test.ts:72`。 | — |
| C4-039 | evidence/evidence-service.ts:185 | function | G | 真实计划下，不存在的 subjectRunRef 可使执行读取返回失败（`evidence-service.ts:1070`）。 | 建立 Goal/Plan→用不存在的 Run ref 开启验证；补入 `T/R3e-evidence.test.ts:120`。 | — |
| C4-040 | evidence/evidence-service.ts:190 | function | F | 源码捕获返回 incomplete/source_stale 等真实失败时进入映射（`evidence-service.ts:932`）。 | 完成 Run→V 在捕获时模拟 IO 失败或目录变化→开启验证；补入 `T/R3e-evidence.test.ts:72`。 | — |
| C4-041 | evidence/evidence-service.ts:192 | function | F | 捕获失败携带非空 issues 时执行 issue 映射（`evidence-service.ts:192`、`:933`）。 | V 返回含实际文件问题的 source_stale/incomplete→`openVerification`；补入 `T/R3e-evidence.test.ts:72`。 | — |
| C4-042 | evidence/evidence-service.ts:915 | function | F | 准备验证时的失败包装由 root 解析等失败调用（`evidence-service.ts:921`）。 | 完成 Run→V 使 root 读取失败→开启验证；补入 `T/R3e-evidence.test.ts:72`。 | — |
| C4-043 | evidence/evidence-service.ts:952 | function | G | 显式 request_execution 任务不受旧 required-obligation 模板限制，编译仍可给出 invalid issues（`tasks/plan-validation.ts:65`；`verification-plan.ts:72`）。 | 公开采纳无 required obligation 的显式任务→执行→开启验证，断言 invalid 明细；补入 `T/R3e-evidence-coverage.test.ts:53`。 | — |
| C4-044 | evidence/evidence-service.ts:953 | function | D2 | 非 invalid 编译错误只有 pin_mismatch；生产 adapter 传入同一计划和已核验成员任务，reverify 也核验相同绑定（`verification-plan.ts:64`；`evidence-service.ts:942`、`:1063`、`:1866`、`:1991`）。 | 删除 adapter 中不可达的非 invalid issue 映射，收窄内部结果类型；独立编译器的边界校验可保留。 | — |
| C4-045 | evidence/verification-plan.ts:118 | function | D2 | 唯一生产编译调用固定传 `risks: []`，因此 map 回调没有元素可执行（`evidence-service.ts:941`、`:944`）。 | 删除当前生产契约中的风险映射，输出空列表并收窄入参；不编造风险记录补覆盖。 | — |
| C4-046 | notes/note-anchors.ts:199 | function | G | 缺失文件的候选匹配有至少两个同名路径时需要排序（`note-anchors.ts:199`、`:217`）。 | 创建 `a/foo.ts`、`b/foo.ts`→写指向缺失 `x/foo.ts` 的 note→检查候选；补入 `T/S4A-note-write.test.ts:94`。 | — |
| C4-047 | notes/note-anchors.ts:426 | function | F | anchor Goal facts 读取拒绝会调用此映射（`note-anchors.ts:514`、`:519`）。 | 建立真实 Goal/note anchor→写 note 时 R 使事实读取失败；补入 `T/S4A-note-failures.test.ts:137`。 | — |
| C4-048 | notes/note-anchors.ts:677 | function | D2 | 此回调只处理 not_ready；实际 catalogModuleFacts 适配器只产生 ready/not_found/rejected（`note-anchors.ts:699`、`:706`；`architecture/catalog-service.ts:355`、`:813`；`architecture/architecture-service.ts:1054`）。 | 删除 not_ready 分支及该回调，收窄适配器返回类型。 | — |
| C4-049 | notes/note-read-model.ts:438 | function | U | 仅“版本存在但 head 缺失”的历史读取走无 head 回退；owner 原子写 head 与版本（`note-read-model.ts:2127`；`note-service.ts:829`、`:834`、`:1504`）。 | 删除孤立版本的 `checkNotes` 回退；不支持旧／外写孤儿记录，不补篡改测试。 | — |
| C4-050 | notes/note-read-model.ts:1525 | function | G | related 搜索 `match: all` 的非空词集合会执行 map（`note-read-model.ts:1442`、`:1525`）。 | 写入关联且匹配多词的 note→related `memoryFind(match: all)`；补入 `T/S4C-note-related-find.test.ts:155`。 | — |
| C4-051 | notes/note-read-model.ts:1550 | function | G | related all 搜索第一页的候选处理中会执行该回调（`note-read-model.ts:1538`、`:1550`）。 | 写入匹配关联 note→读取 related/all 第一页；补入 `T/S4C-note-related-find.test.ts:155`。 | — |
| C4-052 | notes/note-read-model.ts:1610 | function | G | related 段耗尽后，项目段非空 allTermHeads 会执行回调（`note-read-model.ts:1607`）。 | 写关联与非关联匹配 note→小页 related/all 查询→沿 next 进入项目段；补入 `T/S4C-note-related-find.test.ts:179`。 | — |
| C4-053 | notes/note-read-model.ts:1855 | function | G | Goal 桶有多个同类 note 时执行排序；无 anchor 列表调用该读取（`note-read-model.ts:1855`、`:2213`）。 | 同 Goal 写多个同 review 状态 note→`listNotes`；补入 `T/S4B-memory-version-lists.test.ts:50`。 | — |
| C4-054 | notes/note-read-model.ts:2325 | function | G | history 字节裁剪调用 afterOf，非故障路径（`note-read-model.ts:801`、`:2325`）。 | 公开多次更新长 note→大条数 history 请求触发字节裁剪→翻页；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-055 | notes/note-read-model.ts:2326 | function | G | history 字节裁剪需要生成继续游标（`note-read-model.ts:826`、`:2326`）。 | 公开产生多版本长 note→触发 history 字节裁剪→使用 next 验证续页；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-056 | notes/note-read-model.ts:2415 | function | G | conflicts 超字节预算时调用 afterOf（`note-read-model.ts:801`、`:2415`）。 | 公开写多条长标题矛盾 note→`memoryConflicts`→触发裁剪；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-057 | notes/note-read-model.ts:2416 | function | G | conflicts 裁剪需要构造继续游标（`note-read-model.ts:826`、`:2416`）。 | 公开建立多组矛盾 note→裁剪 conflicts 页→沿 next 读取；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-058 | notes/note-read-model.ts:2467 | function | G | 至少两个邻接 note 才调用排序比较器（`note-read-model.ts:2467`）。 | 通过 replaces/contradicts 建立多个真实邻居→`memoryNeighbors`；补入 `T/S4B-memory-history.test.ts:83`。 | — |
| C4-059 | notes/note-read-model.ts:2477 | function | G | neighbors 字节裁剪调用 afterOf（`note-read-model.ts:801`、`:2477`）。 | 写多个长内容邻居→`memoryNeighbors` 触发字节裁剪；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-060 | notes/note-read-model.ts:2478 | function | G | neighbors 字节裁剪需要生成游标（`note-read-model.ts:826`、`:2478`）。 | 建立多个长内容邻居→裁剪→使用返回 next；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-061 | notes/note-read-model.ts:2535 | function | G | stale 页超字节预算时调用 afterOf（`note-read-model.ts:801`、`:2535`）。 | 依据文件写多条 note→公开修改文件→`memoryStale` 触发裁剪；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-062 | notes/note-read-model.ts:2536 | function | G | stale 字节裁剪需要继续游标（`note-read-model.ts:826`、`:2536`）。 | 写文件依据 note→修改文件→裁剪 stale 页→沿 next 读取；补入 `T/S4B-memory-l12-bounds.test.ts:29`。 | — |
| C4-063 | notes/note-related-scope.ts:182 | function | F | 显式 Task 的计划窗口或目录读取可能真实失败（`note-related-scope.ts:307`、`:392`、`:395`）。 | 真实 Task/note→relatedTask 搜索→R 拒绝计划或目录读取；补入 `T/S4C-related-scope.test.ts:51`。 | — |
| C4-064 | notes/note-related-scope.ts:190 | function | F | callerTaskScope 的计划读取失败被转换（`note-related-scope.ts:408`）。 | 真实固定 Role 的 work caller→related caller 搜索→R 拒绝 Plan 读取；补入 `T/S4C-related-scope.test.ts:51`。 | — |
| C4-065 | notes/note-service.ts:505 | function | F | disposition 回执恢复的 onFailure 指向该函数（`note-service.ts:584`）。 | 完成公开 disposition→同请求重试→R 使原事件读取失败；补入 `T/S4A-note-failures.test.ts:81`。 | — |
| C4-066 | queries/query-execution.ts:133 | function | F | claim 的 Role facts 读取失败会被映射；无需 Role 热切换（`query-execution.ts:935`、`:941`）。 | 真实固定 Role/QueryJob→claim→R 拒绝 Role 事实读取；补入 `T/R5b-query-execution.test.ts:100`。 | — |
| C4-067 | queries/query-execution.ts:139 | function | F | claim 的 core facts 读取不可用会转换为拒绝（`query-execution.ts:875`）。 | 真实提交 QueryJob→claim 时 R 拒绝 core 读取；补入 `T/R5b-query-execution.test.ts:100`。 | — |
| C4-068 | queries/query-execution.ts:161 | function | G | revisionConflict 构造当前 pins；客户端使用过期 pin 即可触发（`query-execution.ts:780`、`:878`）。 | 提交／claim 推进版本→新请求使用旧 expected pin→核对 current；补入 `T/R5b-query-execution.test.ts:100`。 | — |
| C4-069 | queries/query-execution.ts:173 | function | F | 执行提交失败进入 mapCommitFailure（`query-execution.ts:610`）。 | 提交真实 QueryJob→claim 时 W 使事务失败；补入 `T/R5b-query-execution.test.ts:100`。 | — |
| C4-070 | queries/query-execution.ts:413 | function | G | 非空 focusTaskRefs 会读取并查找真实 Plan；提交入口允许该输入（`query-execution.ts:401`；`query-job-service.ts:694`）。 | 建立计划任务→提交带 focusTaskRefs 的 Query→claim/prepare；补入 `T/R5b-query-execution.test.ts:100`。 | — |
| C4-071 | queries/query-execution.ts:779 | function | G | expected pin 与当前版本不一致直接进入该函数（`query-execution.ts:878`）。 | 公开操作推进 Query 状态→以旧 pin 发新 claim 请求；补入 `T/R5b-query-execution.test.ts:100`。 | — |
| C4-072 | queries/query-job-service.ts:79 | function | F | lookup 或 commit 抛异常会调用 messageOf（`query-job-service.ts:421`、`:785`）。 | 提交真实 Query 请求→R 抛读取异常或 W 抛事务异常；补入 `T/R5b-query-job.test.ts:137`。 | — |
| C4-073 | queries/query-job-service.ts:806 | function | F | QueryJob 读取的后端拒绝由此映射（`query-job-service.ts:835`、`:854`）。 | 提交 Job→`readQueryJob` 时 R 拒绝读取；补入 `T/R5b-query-job.test.ts:137`。 | — |
| C4-074 | queries/query-job-service.ts:876 | function | G | 无 runtime 的正式 composition 不装配 queryExecution；执行方法返回 unsupported（`S/composition/create-platform.ts:829`、`:837`；`query-job-service.ts:889`）。 | 不带 runtime 创建平台→提交 Job→调用 claim/readQueryAnswer，断言 unsupported；补入 `T/R5b-query-job.test.ts:137`。 | — |
| C4-075 | sessions/lifecycle-record-codecs.ts:444 | function | G | 归档请求释放会正式写入该事件，触发外层 validator（`session-lifecycle.ts:1325`、`:1343`）。 | 请求归档→结束占用→`releaseSessionArchiveRequest`；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-076 | sessions/lifecycle-record-codecs.ts:444 | function | G | 同一释放事件的 body validator 是提交验证的一部分（`lifecycle-record-codecs.ts:444`、`:445`；`session-lifecycle.ts:1343`）。 | 请求归档→满足释放条件→公开释放并核对事件结果；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-077 | sessions/message-body-envelope.ts:63 | function | G | conflict_wait/parallel/order 决策正文都会校验 Goal ref（`message-body-envelope.ts:82`、`:91`）。 | 建立两个真实 Goal 冲突→选择上述回答→读取保存的回答；补入 `T/S5-decision-application.test.ts:131`。 | — |
| C4-078 | sessions/session-directory.ts:914 | function | F | operation 先读为 accepted，随后并发注册可使 Session 查询非空；串行已完成状态会先被拒绝或重放（`session-directory.ts:857`、`:898`、`:907`、`:912`）。 | 两个同身份注册；C 卡在旧 operation/未命中之后，让另一注册提交，再继续读取；补入 `T/R4b-session-directory.test.ts:168`。 | — |
| C4-079 | sessions/session-health.ts:73 | function | F | 健康观察的回执读取或提交可能失败（`session-health.ts:131`、`:147`）。 | 真实 Session→健康探测报告 missing→R/W 使持久化失败；探测入口 `H/WP2-notices-fixture.ts:133`。 | — |
| C4-080 | sessions/session-health.ts:156 | function | F | 身份含所读 Session revision；需并发观察同一旧版本才能命中该恢复路径（`session-health.ts:127`、`:130`、`:148`）。 | 两个真实健康观察读同一版本→C 让一个先提交→另一个恢复；沿用 `H/WP2-notices-fixture.ts:133`。 | — |
| C4-081 | sessions/session-lifecycle.ts:763 | function | F | 归档相关 Session facts 读取失败会映射（`session-lifecycle.ts:838`、`:1155`）。 | 真实 Session→请求归档时 R 拒绝 facts 读取；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-082 | sessions/session-lifecycle.ts:790 | function | G | 释放归档请求主动调用 deriveStopQueued（`session-lifecycle.ts:1311`）。 | 占用中的 Session 请求归档→正常取消／结束→调用释放；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-083 | sessions/session-lifecycle.ts:805 | function | G | work 类型归档请求读取实际 Run 时会执行查找回调（`session-lifecycle.ts:805`、`:1311`）。 | 建立真实 work Run→请求归档→释放请求；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-084 | sessions/session-lifecycle.ts:820 | function | G | 正式取消产生的控制意图可被释放检查读取（`session-lifecycle.ts:820`）。 | 请求归档→通过公开取消入口产生 intent→调用释放并核对忙碌／释放结果；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-085 | sessions/session-lifecycle.ts:886 | function | G | holder 与 wait.runRef 不同会收集两个 pin；排序在后续归档裁决之前（`session-lifecycle.ts:869`、`:876`、`:947`）。 | 建立两个真实 Run→其中一个占用 Session→请求归档时 wait 指另一个；断言正式拒绝结果；补入 `T/S1-wait-disposal.test.ts:66`。 | — |
| C4-086 | sessions/session-lifecycle.ts:927 | function | G | 非取消的归档尝试拒绝会调用 recheck，不限定并发（`session-lifecycle.ts:1052`）。 | 公开推进 Session 版本→旧 expected pin 请求归档→核对 recheck 后仍拒绝；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-087 | sessions/session-lifecycle.ts:1256 | function | G | 释放归档请求有正式路由接线（`S/app/core-routes.ts:451`、`:1124`）。 | 请求归档→结束占用／清除待处理停止→释放请求；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-088 | sessions/session-lifecycle.ts:1295 | function | G | 公开释放函数读取现存 Session 时执行查找（`session-lifecycle.ts:1256`、`:1295`）。 | 对真实已有归档请求的 Session 调用释放；补入 `T/S1-archive-owner.test.ts:43`。 | — |
| C4-089 | sessions/session-links.ts:21 | function | F | 工作链接 lookup 的存储失败进入映射（`session-links.ts:45`）。 | 创建并链接真实 Session→读取含 links 的目录结果→R 使 lookup 失败；补入 `T/R4b-session-directory.test.ts:168`。 | — |
| C4-090 | sessions/session-record-codecs.ts:332 | function | U | 仅非 null CoreOperation.failure 调用校验；两个生产写点都写 null（`session-record-codecs.ts:687`；`session-directory.ts:788`、`:981`）。 | 删除非 null failure 的当前格式支持及 helper，收窄模型；不为不存在的失败生命周期补测试。 | — |
| C4-091 | sessions/session-responsibility-service.ts:76 | function | F | 转移／关闭责任的 basis 读取可能失败（`session-responsibility-service.ts:418`、`:617`）。 | 建立真实责任链接→转移／关闭时 R 拒绝 Session facts 读取；补入 `T/S1-responsibility.test.ts:319`。 | — |
| C4-092 | sessions/session-targets.ts:29 | function | F | 正式链接目标校验读取 Goal/Plan 时可能失败（`session-targets.ts:78`、`:101`）。 | 建立 Task→创建／链接 Session 到 Task→R 拒绝目标读取；补入 `T/S1-responsibility.test.ts:319`。 | — |
| C4-093 | views/activity-read-model.ts:763 | function | D2 | 默认 now 闭包只在缺依赖时执行；生产 composition 始终传 now（`activity-read-model.ts:763`；`S/composition/create-platform.ts:1092`）。 | 将 now 改为必需依赖，删除默认时钟闭包。 | — |
| C4-094 | views/decision-read-model.ts:330 | function | D2 | note 来源的 closedReasonOf 固定 null；收集器在调用 closed keyOf 前返回（`decision-read-model.ts:283`、`:285`、`:332`）。 | 收窄来源契约，去掉 note 的无用 closed keyOf 回调；不构造不存在的关闭 note 卡。 | — |
| C4-095 | views/decision-read-model.ts:1192 | function | F | 卡片读取捕获真实读取错误并转换；Goal 读取拒绝可触发（`decision-read-model.ts:1182`、`:1713`）。 | 建立真实 decision→`readDecisionCard` 时 R 拒绝 Goal 读取；补入 `T/S5-decision-queue.test.ts:92`。 | — |
| C4-096 | views/decision-read-model.ts:1270 | function | G | 真实 goal_conflict 的 pair 非空会执行 some（`decision-read-model.ts:1270`）。 | 建立两 Goal 冲突→查询冲突→用返回 source 读取卡片；补入 `T/S5-decision-queue.test.ts:92`。 | — |
| C4-097 | views/decision-read-model.ts:1344 | function | G | 非空冲突集合的卡片查找会执行 find（`decision-read-model.ts:1344`）。 | 建立真实 Goal 冲突→读取相应 decision card；补入 `T/S5-decision-queue.test.ts:92`。 | — |
| C4-098 | views/decision-read-model.ts:1683 | function | U | 需非空候选链既无 live、也无合法终点；正式替换原子维护链，分页还检查稳定窗口（`decision-read-model.ts:1671`、`:1682`；`state/plan-machine.ts:1607`；`persistence/lookup-all.ts:43`）。 | 删除任意候选兜底选择；没有合法卡则返回空，不为损坏替换链补测试。 | — |
| C4-099 | views/goal-conflicts.ts:101 | function | F | 目录读取抛错会转换为 unavailableReason（`goal-conflicts.ts:371`）。 | 建立真实 Goal/目录→`queryGoalConflicts` 时 R 抛读取错误；补入 `T/S2B-r2-conflict-catalog.test.ts:1`。 | — |
| C4-100 | views/graph-context-reader.ts:97 | function | F | 批量读或 round lookup 抛错进入 messageOf（`graph-context-reader.ts:481`、`:745`）。 | 真实图上下文→`readContextFacts/lookGraph` 时 R 抛错；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-101 | views/graph-context-reader.ts:112 | function | F | 批量读／round lookup 返回存储拒绝会转换（`graph-context-reader.ts:483`、`:747`）。 | 真实图上下文→R 返回 unavailable→读取图；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-102 | views/graph-context-reader.ts:702 | function | G | 历史 Run 不在初始 latest 缓存时，ensureRuns 的 pending 非空（`graph-context-reader.ts:826`、`:1473`、`:1490`）。 | 同 Task 正式执行多次→查看历史 Run 或 executions 关系；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-103 | views/graph-context-reader.ts:896 | function | G | 模块作用域任务需要查找对应目录模块（`graph-context-reader.ts:896`）。 | adoption 模块→采纳 module scope Task→读上下文／Task 卡；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-104 | views/graph-context-reader.ts:1023 | function | G | 多个任务的执行来源进入排序（`graph-context-reader.ts:1023`、`:1363`）。 | 两个 Task 分别真实执行→一次读取两个 focusTaskIds；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-105 | views/graph-context-reader.ts:1069 | function | G | 多个验证轮来源会执行排序（`graph-context-reader.ts:1069`）。 | 执行 Task→开启／结束验证→reverify 产生第二轮→读上下文；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-106 | views/graph-context-reader.ts:1104 | function | G | Stage children 中的模块任务会查找目录模块（`graph-context-reader.ts:1104`）。 | adoption 模块→采纳含模块任务的 Stage→查看 Stage.children；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-107 | views/graph-context-reader.ts:1123 | function | G | 非空模块 parentOf 关系会执行子模块过滤（`graph-context-reader.ts:1123`）。 | adoption 父子模块 containment→查看父模块 children；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-108 | views/graph-context-reader.ts:1124 | function | G | 匹配父模块的 child 关系会执行映射（`graph-context-reader.ts:1124`）。 | adoption 父子模块→读取父模块 children 并核对子节点；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-109 | views/graph-context-reader.ts:1150 | function | G | Task 的模块邻居查找可由 module scope 触发（`graph-context-reader.ts:1150`）。 | 采纳模块及其 Task→查看 Task.neighbours；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-110 | views/graph-context-reader.ts:1240 | function | G | 模块节点存在性检查遍历正式目录（`graph-context-reader.ts:1240`）。 | adoption 非空目录→查看真实 module card；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-111 | views/graph-context-reader.ts:1242 | function | G | Session 节点存在性检查遍历真实 Session（`graph-context-reader.ts:1242`）。 | 公开创建 Session→查看其 graph card；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-112 | views/graph-context-reader.ts:1255 | function | G | Stage 卡片查找正式计划中的 stage（`graph-context-reader.ts:1255`）。 | propose/adopt 含 Stage 的 Plan→查看 Stage card；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-113 | views/graph-context-reader.ts:1328 | function | D2 | 仅缺少 listExecutions 时进入回退；生产注入的 executionReader 总提供该方法（`graph-context-reader.ts:1307`；`S/composition/create-platform.ts:1122`；`tasks/run-state-service.ts:902`）。 | 将依赖中的 listExecutions 设为必需，删除单 current Run 回退及其 map。 | — |
| C4-114 | views/graph-context-reader.ts:1500 | function | G | Task.checks 关系有真实验证轮时执行映射（`graph-context-reader.ts:1500`）。 | 完成 Task Run→开启验证→查看 Task.checks；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-115 | views/graph-context-reader.ts:1501 | function | G | Task.checks 非空轮集合会执行后续回调（`graph-context-reader.ts:1501`）。 | 完成 Run→建立验证轮→读取 checks 关系并核对返回项；补入 `T/S3-graph-context.test.ts:879`。 | — |
| C4-116 | views/node-detail-reader.ts:1249 | function | G | module summary 直接查找目录模块；summary 已暴露（`node-detail-reader.ts:1249`、`:1430`）。 | adoption 模块→`readNodeDetail(section: summary)`；补入 `T/S2C-node-detail-hover.test.ts:20`。 | — |
| C4-117 | views/node-detail-reader.ts:1256 | function | G | 文件事实 available 时，filesView 调用 module summary 的投影（`node-detail-reader.ts:188`、`:1256`）。 | 真实执行并记录文件活动→读取 module summary；补入 `T/S2C-node-detail-hover.test.ts:20`。 | — |
| C4-118 | views/node-detail-reader.ts:1267 | function | G | 文件事实 available 时会调用 Session summary 的投影（`node-detail-reader.ts:188`、`:1267`）。 | Session 真实执行并记录文件活动→读取 Session summary；补入 `T/S2C-node-detail-hover.test.ts:20`。 | — |
| C4-119 | views/note-views.ts:846 | function | G | 删除证明可以来自真实 counted RunActivity，而不必是直接 file fact（`note-views.ts:837`、`:851`）。 | Run 实际删除文件并完成观察→以该活动作 note 依据→检查删除文件 anchor；补入 `T/S4B-note-anchor-status.test.ts:1`。 | — |
| C4-120 | views/track-read-model.ts:206 | function | G | Query 分页会生成自有继续游标，下一页调用该解码器（`track-read-model.ts:239`、`:887`、`:900`）。 | 公开产生多个 Query bar→小页 `readTrackBars`→传回 next；补入 `T/S2B-r2-r3-track-pagination.test.ts:38`。 | — |
| C4-121 | views/track-read-model.ts:918 | function | G | readonly copy 内部跨页时按保存的 Query key 找续读位置（`track-read-model.ts:918`）。 | 真实 continuation/copy 携带多条 Query 历史→在 copy 内分页→使用 next；补入 `T/S2B-r2-r3-track-pagination.test.ts:38`。 | — |
| C4-122 | views/undelivered-reply-notices.ts:315 | function | U | DTO 来自真实消息；稳定水位下“DTO 有而消息无”不是正常并发，窗口变化会先重试（`communication/mailbox-service.ts:3282`；`undelivered-reply-notices.ts:396`）。 | 保留稳定损坏诊断且不测，避免把丢失消息静默当成无通知。 | — |
| C4-123 | views/undelivered-reply-notices.ts:325 | function | U | 正式写入校验 Goal 与 work sender 的一致性；并发水位变化不执行该损坏回调（`communication/mailbox-service.ts:3396`；`undelivered-reply-notices.ts:403`）。 | 保留现有归属不一致拒绝且不测，避免错误归属通知。 | — |
| C4-124 | views/undelivered-reply-notices.ts:341 | function | U | reply DTO 直接复制消息 responseSince；稳定窗口内不一致需外写／损坏（`communication/mailbox-service.ts:3296`、`:3310`；`undelivered-reply-notices.ts:403`）。 | 保留现有位置不一致诊断且不测；不制造错位 DTO/记录。 | — |
| C4-125 | views/undelivered-reply-notices.ts:381 | function | F | 通知首先要求源 Session health=unavailable；已有原消息 acceptedInputs 即会执行 some 回调（`communication/mailbox-service.ts:3249`；`undelivered-reply-notices.ts:381`）。 | 消费原消息→保存回复→健康探测报告 Kernel missing→读取通知；使用 `H/WP2-notices-fixture.ts:133`，补入 `T/WP2-undelivered-notices.test.ts:153`。 | — |
| C4-126 | views/undelivered-reply-notices.ts:486 | function | D2 | 前级 comparator 已比较 cursor 和 itemKey；相同 key 又已去重，第二 tie-break 不会执行（`views/notice-position.ts:48`；`undelivered-reply-notices.ts:274`、`:296`）。 | 删除第二层比较及本地 compareText，直接使用共享位置比较器。 | — |
| C4-127 | views/work-line-reader.ts:144 | function | D1 | countingStore 供本文件预算读取使用，没有 lookupCommit 调用路径（`work-line-reader.ts:124`、`:144`、`:327`）。 | 收窄 WorkLineStore 为实际读取接口，删除该委托闭包。 | — |
| C4-128 | views/work-line-reader.ts:145 | function | D1 | 同一预算读取包装没有写事务调用路径（`work-line-reader.ts:124`、`:145`、`:327`）。 | 从 WorkLineStore 契约与包装中删除 commit。 | — |
| C4-129 | views/work-line-reader.ts:394 | function | G | 开放责任链接可以指向 module，进入 otherLinks 映射（`work-line-reader.ts:729`、`:394`）。 | adoption 模块→Session 正式链接该模块责任→读取工作线；补入 `T/S2C-lines-done-evidence.test.ts:38`。 | — |
| C4-130 | views/work-line-reader.ts:1033 | function | U | unknownTask 仅补偿损坏 closed link／错误 target；正式索引限定 task，并排除未关闭项（`work-line-reader.ts:1005`、`:1039`；`sessions/session-record-codecs.ts:950`；`S/core/record-store/lookup-index.ts:542`）。 | 保留现有 unknown 占位且不测，避免损坏链接显示成已知完成任务；不兼容旧链接格式。 | — |
| C4-131 | views/work-line-reader.ts:1542 | function | U | 此 reduce 只为 provenance 环挑代表；创建 owner 校验前驱链并拒绝环（`work-line-reader.ts:1542`；`sessions/session-directory.ts:616`、`:765`）。 | 删除环代表计算及相应补偿分支，不补手写 provenance 环测试。 | — |
| C4-132 | views/work-line-reader.ts:1556 | function | U | 该 filter 的非空输入来自环代表集合；正式 provenance writer 不产生环（`work-line-reader.ts:1544`、`:1556`；`sessions/session-directory.ts:616`）。 | 删除仅服务环补偿的过滤逻辑；保留正常链头选择。 | — |
| C4-133 | views/work-line-reader.ts:2237 | function | G | 用户 decision_request 消息生成的 queue card 需要解析消息 key（`work-line-reader.ts:2135`、`:2194`、`:2237`）。 | `sendUserMessage(decision_request)`→读取工作线 attention；补入 `T/S2C-lines-attention.test.ts:29`。 | — |
| C4-134 | views/work-line-reader.ts:2270 | function | G | 公开页接口接收到无效 cursor 会调用 invalidPage（`work-line-reader.ts:2594`、`:2797`）。 | 对真实工作线读取 executions/messages，传无效 cursor；补入 `T/S2C-lines-page.test.ts:96`。 | — |
| C4-135 | views/work-line-reader.ts:2354 | function | U | cycleRepresentativeOf 只服务 provenance 环补偿；正式链创建拒绝环（`work-line-reader.ts:2370`、`:3062`；`sessions/session-directory.ts:616`、`:765`）。 | 删除 cycleRepresentativeOf 及调用处的环补偿；不恢复篡改测试。 | — |
| C4-136 | views/work-line-reader.ts:2355 | function | U | 该 reduce 是上述环代表函数内部计算，正常 owner 链不会进入（`work-line-reader.ts:2354`；`sessions/session-directory.ts:616`）。 | 随环代表函数一起删除，不单独保留或补测。 | — |
| C4-137 | views/work-line-reader.ts:2450 | function | G | 当前责任为 gate 且至少两个真实检查轮时执行排序（`work-line-reader.ts:2423`、`:2426`、`:2450`）。 | Session 负责 gate→完成验证轮→reverify 产生第二轮→读取工作线执行／检查列表；补入 `T/S2C-lines-page.test.ts:96`。 | — |

按上表逐行计数：

| class | 行数 |
|---|---:|
| D1 走不到 | 3 |
| D2 不会发生 | 8 |
| U 只有篡改才会发生 | 13 |
| F 外部故障 | 37 |
| G 公开步骤能到、没测 | 76 |
| N 不适用 | 0 |
| 待定 | 0 |
| **合计** | **137** |

关于针对 T 的发现：**本组没有符合所指定定义的 A 类发现**，因此没有可列出的“错误删除理由＋T item＋恢复步骤”。本组清单全部为 C：它们在 T 前后都没有函数覆盖；上表 F/G 是既有测试缺口，不能仅据此归因于 T 删除测试（`lists/list-C4.tsv:2`、`lists/list-C4.tsv:138`）。

关于 L-2：**与 C4 清单的交集为空**。L-2 列的是 `provenNotEnteredKernel`、`plan-readers.ts:1390`、T1-061/T1-062 guards、`plan-validation.ts:337-338` 和 B-03 后的重查；这些都不是本组列出的目标函数，因此没有需要在这里逐项赋类的 L-2 行（`ref/t-end-list.md:22`、`:23`、`:24`；`lists/list-C4.tsv:2` 至 `:138`）。