已完成只读核对；没有写文件、运行测试或构建。**当前分类：D2 33、U 37、F 10、G 18、待定 2。** 以下把“当前可达性”和“旧测试归因”分开；历史归因未核实的地方明确保留待定。

为压缩表格，路径前缀统一如下：

- `W/`＝`D:/cxt/t-docs/tree/src/core/work-graph/`
- `R/`＝`D:/cxt/t-docs/tree/src/core/record-store/`
- `现/`＝`D:/cxt/t-docs/tree/`
- `前/`＝`D:/cxt/t-inv/`
- `E/`＝`D:/cxt/t-docs/evidence/books/`

表中 `P1…P15` 是表后的具体补测步骤。`if/0` 等表示题目给定的类型和 arm，不把未覆盖直接解释成不可达。处置遵守当前格式约束及不恢复篡改测试的要求。（`现/docs/refactor/HANDOFF.md:566`；`现/AGENTS.md:33`）

| row | path:line_after | kind | class | reason（file:line） | proposal | before-T test 与 T 项 |
|---|---|---|---|---|---|---|
| A1-001 | `W/persistence/commit-compiler.ts:228` | if/0 | G | 调用者可以提交不等于实读版本的 Project pin；不要求 Project 真升过版。（同文件:217、:228） | P1 | `前/tests/work-graph/R3a-goal-replay-boundaries.test.ts:41` 的旧 scope 升版；T1-025 改公开初始化，取消手造 Project@2。（`E/t-items-T1-w2.md:148`、:151） |
| A1-002 | `W/persistence/decision-record-codecs.ts:396` | if/1 | U | 缺 `since` 仍被读成空 origin；当前 requeue writer 绑定提交位置。（`W/tasks/requeue-service.ts:1116`） | 删除缺 `since` 的旧格式接受路径；保留格式拒绝，不补篡改测试 | NR05 legacy 半段、QA-11。（`前/tests/work-graph/S5-notices.test.ts:195`；`前/tests/work-graph/S2A-notices-rework.test.ts:37`）；TP-166。（`E/t-items-TP.md:1226`） |
| A1-003 | `W/persistence/graph-repository.ts:335` | switch/3 | U | 实际旧路径是同 revision 改 Workspace 身份，提交时返回 corrupt。（`R/sqlite-record-store.ts:412`；`前/tests/record-store/R3a-transaction-boundaries.test.ts:123`） | 保留 corrupt 到 unavailable 的边界映射，不补篡改测试 | “same-revision scope identity change”。（前述测试:103）；T2-010 删除篡改例。（`E/t-items-T2-w2.md:104`） |
| A1-004 | `W/persistence/graph-repository.ts:336` | switch/4 | **待定** | `corrupt` 与 `unsupported` 共享落点，前一 case 还会贯穿；仅此行和 arm 无法确认历史计数代表独立 unsupported，还是贯穿计数。（同文件:335） | 先核原始 branchMap/locations；独立 unsupported 再按完整生产 schema 接线判 D2，贯穿则随 003 判 U | 不能把 T2-010 直接认作独立 unsupported 测试；需原始覆盖映射。（`E/t-items-T2-w2.md:107`） |
| A1-005 | `W/persistence/note-record-codecs.ts:197` | cond-expr/0 | U | codec 接受 platform source，但公开 note writer 只生成 user/agent，system 被拒。（`W/notes/note-service.ts:142`、:174） | 删除 platform source 的接受变体；未知 kind 继续拒绝 | `前/tests/work-graph/S4C2-U3.test.ts:47` 的手写 platform 来源；T1-053 改真实来源。（`E/t-items-T1-w2.md:377`） |
| A1-006 | `W/persistence/note-record-codecs.ts:197` | if/0 | U | 同 005 的 platform source 分支。（`W/notes/note-service.ts:142`、:174） | 同 005 | 同一旧用例；T1-053。（`前/tests/work-graph/S4C2-U3.test.ts:58`；`E/t-items-T1-w2.md:377`） |
| A1-007 | `W/persistence/plan-record-codecs.ts:126` | if/0 | U | 该臂要求右侧链没有创建位置；当前新候选绑定 `since`，替换沿用原链 origin。（`W/tasks/plan-service.ts:1423`、:3354） | 删除无位置链排序兼容，收紧 origin 后只比较真实 cursor | **历史归因待定**：已定位缺位置排序逻辑，但未定位最后执行该臂的旧测试；需旧 branchMap/逐测试命中。（本文件:114） |
| A1-008 | `W/persistence/plan-record-codecs.ts:727` | cond-expr/1 | D2 | 进入业务层的 proposal 只可能是 candidate_v2；其他 kind 在 codec 拒绝。（同文件:740、:790） | 删除非 candidate 的三元回退，直接读 requestRef | RC11 调 `candidateRequestRef`。（`前/tests/work-graph/S5-request-candidates.test.ts:334`）；TP-168 删除 v1。（`E/t-items-TP.md:1241`） |
| A1-009 | `W/persistence/plan-record-codecs.ts:740` | if/1 | U | 这是原始记录边界对非当前 kind 的拒绝；旧 v1 或外部写入才需要它。（同文件:790） | 保留未知格式拒绝且不补旧格式测试 | RC11 手写 v1。（`前/tests/work-graph/S5-request-candidates.test.ts:324`）；TP-168。（`E/t-items-TP.md:1242`） |
| A1-010 | `W/state/control-intent-machine.ts:581` | cond-expr/0 | D2 | malformed history 先被 Run codec 拒绝。（`W/materials/record-readers.ts:202`） | 删除下游 malformed 特判，简化状态事实类型 | “stored locator fails codec”。（`前/tests/state/control-intent-machine.test.ts:859`）；T2-062。（`E/t-items-T2-w2.md:403`） |
| A1-011 | `W/state/control-intent-machine.ts:723` | if/0 | D2 | 非 Absent 的 kind 来自已解码记录；codec 不接受 null kind。（同文件:330；`W/persistence/control-record-codecs.ts:302`） | 删除 recorded-state 的 null-kind 防御 | “recorded state without a kind”。（`前/tests/state/control-intent-machine.test.ts:853`）；T2-062。（`E/t-items-T2-w2.md:401`） |
| A1-012 | `W/state/control-intent-machine.ts:756` | if/0 | D2 | 同 011；superseded 路径也没有合法 null kind。（同文件:330；`W/persistence/control-record-codecs.ts:302`） | 删除该 null-kind 防御 | 同名 superseded 用例。（`前/tests/state/control-intent-machine.test.ts:602`）；T2-062。（`E/t-items-T2-w2.md:407`） |
| A1-013 | `W/state/line-status.ts:289` | binary-expr/1 | U | unavailable Session 的现行写入带具体 conclusion；null 是旧形状。（`W/sessions/session-health.ts:121`） | 删除 null→旧退休原因回退；同步收紧相应状态类型 | “legacy null conclusion …”。（`前/tests/state/S2C-line-status.test.ts:148`）；T2-059。（`E/t-items-T1-w2.md:573`） |
| A1-014 | `W/state/line-status.ts:293` | binary-expr/3 | F | RUN-20 unknown 可以保留 Session 占用；未必经过 unavailable 健康分支。（`W/tasks/run-reconcile-service.ts:569`、:580） | P2 | **历史归因待定**。不能归给 T2-059：该旧例 health=unavailable，已在 :289 返回。（`前/tests/state/S2C-line-status.test.ts:151`） |
| A1-015 | `W/state/line-status.ts:447` | if/0 | F | 当前旧来源计数查询仍存在；查询失败得到 unavailable，退休行的 `retiredUnchecked` 为真。（`W/views/work-line-reader.ts:310`、:313；本文件:445） | P3；如按 79 删除整条旧来源计数链，应连查询和标记一起删，不能称当前代码不可达 | 2C-26 标记断言。（`前/tests/scenarios/S2C-K-legacy-provenance.test.ts:478`）；TP-122 原本要求连生产链一起清理。（`E/t-items-TP.md:896`、:897） |
| A1-016 | `W/state/line-status.ts:824` | switch/3 | U | retired_unrecorded 对应旧 null conclusion；现行健康 writer 写明原因。（`W/sessions/session-health.ts:121`） | 删除旧默认原因；保留当前 missing/damaged 等原因 | `前/tests/state/S2C-line-status.test.ts:155`；T2-059。（`E/t-items-T1-w2.md:576`） |
| A1-017 | `W/state/plan-machine.ts:1253` | switch/1 | D2 | 当前 kind 已被缩为 candidate_v2，default 无合法输入。（`W/persistence/plan-record-codecs.ts:790`） | 简化单 kind switch；保留编译期穷尽约束 | **同臂历史归因待定**：旧 switch 多一个 legacy case，不能沿用 arm 序号。（`前/src/core/work-graph/state/plan-machine.ts:1250`）；相关清理 TP-132。（`E/t-items-TP.md:975`） |
| A1-018 | `W/state/run-machine.ts:1217` | if/0 | D2 | 不合法 locator 先被 Run codec 拒绝。（`W/materials/record-readers.ts:202`） | 删除下游 locator 形状复验 | malformed startPosition=0。（`前/tests/state/run-machine.test.ts:852`）；TP-134。（`E/t-items-TP.md:987`） |
| A1-019 | `W/state/run-machine.ts:1252` | if/0 | D2 | 同 018；已存 locator 不可能越过相同 codec 校验。（`W/materials/record-readers.ts:202`） | 删除重复形状防御 | 同一 malformed 子段。（`前/tests/state/run-machine.test.ts:853`）；TP-134。（`E/t-items-TP.md:984`） |
| A1-020 | `W/state/run-machine.ts:1310` | switch/3 | U | starting+entered 只能外部改写；进入 writer 同时写 running。（同文件:875） | 保留损坏组合拒绝且不补测试；不要恢复旧状态样本 | “fresh entry … outside eight states”。（`前/tests/state/run-machine.test.ts:1022`）；TP-134。（`E/t-items-TP.md:987`） |
| A1-021 | `W/state/run-machine.ts:1311` | switch/4 | U | starting+unknown 不由当前组合写入产生。（`E/t-items-TP.md:987`） | 保留异常组合拒绝，不测篡改 | 同一 outside-eight-states 测试。（`前/tests/state/run-machine.test.ts:1022`）；TP-134。（`E/t-items-TP.md:985`） |
| A1-022 | `W/state/run-machine.ts:1312` | switch/5 | U | starting+settled 与现行终态 writer 不符；writer 同时写 ended。（同文件:886） | 保留异常组合拒绝，不测篡改 | 同一测试。（`前/tests/state/run-machine.test.ts:1022`）；TP-134。（`E/t-items-TP.md:985`） |
| A1-023 | `W/state/session-availability.ts:301` | binary-expr/1 | D2 | Session codec 已要求非空 provenance。（`W/sessions/session-record-codecs.ts:736`） | 删除 `?? null` 兼容回退 | 旧矩阵底座 provenance:null。（`前/tests/state/session-availability.test.ts:80`）；TP-135 改底座。（`E/t-items-TP.md:992`） |
| A1-024 | `W/state/session-availability.ts:600` | switch/9 | D2 | 当前 SessionEvent 穷尽后 default 无合法输入。（同文件:581） | 删除运行时旧事件兜底，保持类型穷尽 | **同臂历史归因待定**：旧 arm 9 是 legacy_provenance_backfilled，当前是 default。（`前/src/core/work-graph/state/session-availability.ts:614`）；TP-135。（`E/t-items-TP.md:991`） |
| A1-025 | `W/state/task-failure.ts:1115` | cond-expr/0 | U | none 链先返回；head=null 剩下 invalid 链，旧例通过两条无槽根制造。（同文件:1109；`前/tests/work-graph/A2-gate-chain-facts.test.ts:221`） | 保留坏链诊断不测；删除旧根兼容输入 | invalid gate chain / GAP-52。（前述测试:218；`前/tests/state/task-failure.test.ts:198`）；TP-025、B-02。（`E/t-items-TP.md:180`；`E/t-w1-findings.md:134`） |
| A1-026 | `W/state/verification-machine.ts:821` | binary-expr/1 | U | interrupted writer 必带 incompleteCause；缺原因属于旧记录。（同文件:989） | 删除中断缺原因回退，收紧对应解码 | 旧无原因中断。（`前/tests/state/verification-machine.test.ts:879`）；TP-137。（`E/t-items-TP.md:1008`） |
| A1-027 | `W/state/verification-machine.ts:823` | cond-expr/0 | U | 与 026 相同的缺原因记录。（同文件:989） | 删除空原因字符串兼容 | 同一旧子段。（`前/tests/state/verification-machine.test.ts:879`）；TP-137。（`E/t-items-TP.md:1009`） |
| A1-028 | `W/tasks/claim-record-codecs.ts:216` | if/0 | U | TaskAttempt 原始 JSON 解码边界；旧例直接伪造损坏 JSON。（`前/tests/work-graph/R4c-execution-read.test.ts:266`） | 保留解析失败拒绝，不恢复篡改测试 | “damaged Attempt”；TP-149。（前述测试:256；`E/t-items-TP.md:1101`） |
| A1-029 | `W/tasks/claim-record-codecs.ts:281` | if/0 | U | DispatchOutbox 原始 JSON 解码边界。（`前/tests/work-graph/R4c-execution-read.test.ts:267`） | 保留解析失败拒绝，不恢复篡改测试 | “damaged outbox”；TP-149。（前述测试:256；`E/t-items-TP.md:1104`） |
| A1-030 | `W/tasks/completion.ts:162` | cond-expr/0 | G | 此臂同时接受 none 和 invalid；未开验证轮是公开可达的 none，且先于指定 round 的读取。（同文件:352、:359） | P4 | 旧 invalid-chain complete 及不存在 round 的拒绝。（`前/tests/work-graph/A2-verification-chain.test.ts:188`、:196）；TP-140。（`E/t-items-TP.md:1030`） |
| A1-031 | `W/tasks/context-input-service.ts:432` | cond-expr/0 | U | 旧无 owner origin 已拒绝；仍可进入 null 的 TaskAttempt 原始来源不由公开材料 owner 写出。（`R/body-codec.ts:160`；`W/materials/material-service.ts:284`；`W/materials/applicability.ts:98`） | 删除无 owner 兼容；若保留 TaskAttempt 边界拒绝，保持不测 | IN18 owner-less。（`前/tests/work-graph/S3-context-inputs.test.ts:874`）；TQ-079。（`E/t-items-TQ.md:487`） |
| A1-032 | `W/tasks/context-input-service.ts:453` | if/0 | G | 公开请求可引用另一 Workspace 的真实 Run 材料；不要求伪造“同 Goal 异 Workspace Run”。（同文件:490、:506、:453） | P5 | IN04。（`前/tests/work-graph/S3-context-inputs.test.ts:711`）；TQ-114/B-12 删除跨 Workspace 假 Run。（`E/t-items-TQ.md:744`；`E/t-w1-findings.md:144`） |
| A1-033 | `W/tasks/context-input-service.ts:497` | if/0 | U | provenance=null 对应 031 的非 owner 来源。（`W/materials/applicability.ts:96`；`R/body-codec.ts:188`） | 保留非法来源拒绝不测，删除旧来源接受链 | IN18。（`前/tests/work-graph/S3-context-inputs.test.ts:875`）；TQ-079。（`E/t-items-TQ.md:488`） |
| A1-034 | `W/tasks/context-input-service.ts:509` | if/0 | G | 公开跨 Workspace 材料在 canonicalOwnerScope 被拒后传播。（同文件:453、:508） | P5 | IN04。（`前/tests/work-graph/S3-context-inputs.test.ts:713`）；TQ-114/B-12。（`E/t-w1-findings.md:144`） |
| A1-035 | `W/tasks/context-input-service.ts:594` | if/0 | G | 首个 gate 轮次为 FAIL、或轮次仍 open，都能到达；不需要 PASS→FAIL 非法后继。（同文件:577、:594） | P6 | IN12 原断言 missing/source=null。（`前/tests/work-graph/S3-context-inputs.test.ts:799`）；TQ-115/B-13。（`E/t-w1-findings.md:145`） |
| A1-036 | `W/tasks/context-input-service.ts:990` | if/0 | G | readTaskInputs 传播上述公开范围拒绝。（同文件:453、:509、:990） | P5 | IN04 的 readInputs。（`前/tests/work-graph/S3-context-inputs.test.ts:713`）；TQ-114。（`E/t-w1-findings.md:144`） |
| A1-037 | `W/tasks/context-input-service.ts:1055` | if/0 | G | readTaskInputPage 同样可传播跨 Workspace 拒绝。（同文件:453、:1055） | P5，必须覆盖 page 入口 | 旧命中为 IN18 的 page 拒绝；其旧来源删除正确。（`前/tests/work-graph/S3-context-inputs.test.ts:880`）；TQ-079。（`E/t-items-TQ.md:488`） |
| A1-038 | `W/tasks/execution-entry-service.ts:607` | if/0 | F | hold guard 不只检查占用，还检查 Session health；Host 真实探测失败可写 unavailable。（`W/state/run-machine.ts:1085`；`W/sessions/session-health.ts:103`） | P7；不恢复 occupancy 清空样本 | “entered Run lost its Session”。（`前/tests/work-graph/B2-model-request.test.ts:12`）；TP-145。（`E/t-items-TP.md:1075`） |
| A1-039 | `W/tasks/execution-entry-service.ts:724` | binary-expr/1 | F | 038 的非空 MachineRefusal 会求值 `refused.ok`。（同文件:606、:724） | P7 | 同一旧 lost-Session 测试。（`前/tests/work-graph/B2-model-request.test.ts:16`）；TP-145。（`E/t-items-TP.md:1073`） |
| A1-040 | `W/tasks/execution-entry-service.ts:724` | cond-expr/1 | F | 同一真实健康拒绝会调用 runRefusal。（同文件:607、:724） | P7 | 同一旧测试；另有 Lease 释放样本被 TP-144 删除。（`前/tests/work-graph/B2-model-request.test.ts:27`；`E/t-items-TP.md:1064`） |
| A1-041 | `W/tasks/execution-history-service.ts:266` | if/0 | U | 旧例直接改 receipt 对应事件中的 Run revision，正常提交不会单独改历史事件。（`前/tests/work-graph/R4c-execution-history-index.test.ts:951`） | 保留重放一致性拒绝，不测篡改 | replay event 修订不符例。（前述测试:934）；T1-032。（`E/t-items-T1-w2.md:204`） |
| A1-042 | `W/tasks/plan-readers.ts:219` | if/1 | U | 现行 TaskReduction 构造必写 completion；缺它是旧手写记录。（`W/state/task-machine.ts:499`） | completion 改必需，删除可缺字段接受路径 | W1 seedReduction。（`前/tests/work-graph/W1-future-plan.test.ts:708`）；T1-062 改真实完成链。（`E/t-items-T1-w2.md:445`） |
| A1-043 | `W/tasks/plan-readers.ts:765` | binary-expr/1 | U | 候选均登记进 positions；null 来自旧缺 since origin，而非正常 map 漏项。（同文件:697；`W/tasks/plan-service.ts:1423`） | 收紧 origin 后删除 null 排序回退 | **历史归因待定**：需缺 since 闭链旧用例及逐 arm 命中；不能仅凭 helper 迁移指定 T 项。（本文件:751） |
| A1-044 | `W/tasks/plan-readers.ts:1131` | if/0 | D2 | 真实 RecordStore 在返回 ready 前已解析并应用 Run schema。（`R/sqlite-record-store.ts:375`、:382） | 删除业务读者重复 JSON 失败路径，复用正式解码结果 | GTN21 手造损坏 Run。（`前/tests/runtime/S4C-note-run-task-resolver.test.ts:64`）；T2-037 删除该子例。（`E/t-items-T2-w2.md:259`） |
| A1-045 | `W/tasks/plan-readers.ts:1145` | if/0 | D2 | 非法 Lease 形状不能从正式 schema 验证后的 ready 批次进入。（`R/sqlite-record-store.ts:382`） | 删除下游重复 Lease 形状防御 | W1 corruptLeaseB。（`前/tests/work-graph/W1-future-plan.test.ts:670`）；T1-065。（`E/t-items-T1-w2.md:475`） |
| A1-046 | `W/tasks/plan-readers.ts:1201` | if/0 | U | canonical reader 要求 lookup/readMany 同水位；claim 又同批写 Run、Lease，正常并发不会留下这里的缺 holder。（同文件:1654；`W/tasks/claim-service.ts:1272`） | 保留保守占用兜底不测，或随跨记录约束收紧删除 | **历史归因待定**；候选是 W1 单独 seedLease，但不能确认其最后命中本臂。（`前/tests/work-graph/W1-future-plan.test.ts:707`；`E/t-items-T1-w2.md:452`） |
| A1-047 | `W/tasks/plan-readers.ts:1283` | if/0 | U | 旧例把 gate 轮次的 subject 改成外国身份；不是公开轮次 owner 写法。（`前/tests/work-graph/A2-gate-chain-facts.test.ts:298`；`E/t-items-T1-w2.md:45`） | 保留范围一致性拒绝，不恢复篡改例 | foreign-subject 子例；T1-007。（前述测试:304；`E/t-items-T1-w2.md:45`） |
| A1-048 | `W/tasks/plan-readers.ts:1336` | binary-expr/1 | D2 | 两个生产调用者都在 plan 非 null 时才调用。（`W/views/note-views.ts:423`；`W/notes/note-update-due.ts:187`） | 参数改非 null，直接读 tasks | S4C2-3e plan=null。（`前/tests/work-graph/S4C2-goal-triggers.test.ts:181`）；T1-054。（`E/t-items-T1-w2.md:394`） |
| A1-049 | `W/tasks/plan-readers.ts:1365` | if/1 | D2 | 非空 Plan 至少有 work，reductionKeys 因而非空；无 Plan 已由调用者挡住。（`W/tasks/plan-validation.ts:59`；本文件:1359） | 去掉空 refKeys 分支，直接执行批读 | S4C2-3e/3h 的空事实布局。（`前/tests/work-graph/S4C2-goal-triggers.test.ts:181`、:190）；T1-054。（`E/t-items-T1-w2.md:394`） |
| A1-050 | `W/tasks/plan-readers.ts:1390` | if/0 | U | codec 仍容纳其他 phase，但唯一 Reduction writer 只写 satisfied。（`W/state/task-machine.ts:473`、:487） | 将 Reduction phase 收窄为 satisfied，删除过滤；不造非 satisfied 记录 | S4C2-3b。（`前/tests/work-graph/S4C2-goal-triggers.test.ts:116`）；T1-054，L-2。（`E/t-items-T1-w2.md:394`；`ref/t-end-list.md:23`） |
| A1-051 | `W/tasks/plan-readers.ts:1394` | if/1 | D2 | 与 048 相同，两个调用点都排除 null Plan。（`W/views/note-views.ts:423`；`W/notes/note-update-due.ts:187`） | 删除 if 包装 | S4C2-3e；T1-054。（`前/tests/work-graph/S4C2-goal-triggers.test.ts:181`；`E/t-items-T1-w2.md:394`） |
| A1-052 | `W/tasks/plan-readers.ts:1457` | if/0 | D2 | parseRun 失败已在正式 store ready 之前拒绝。（`R/sqlite-record-store.ts:381`、:382） | 删除重复失败分支 | GTN21。（`前/tests/runtime/S4C-note-run-task-resolver.test.ts:64`）；T2-037。（`E/t-items-T2-w2.md:259`） |
| A1-053 | `W/tasks/plan-readers.ts:1526` | if/0 | F | 读 requeue/refusal 的 backend 故障会返回失败，不能整体按未注册 schema 删掉。（同文件:1525、:1528） | P8 | 旧 R3c adoption fixture 缺 claim schemas，触发的是 unsupported。（`前/tests/work-graph/R3c-plan-adoption.test.ts:59`）；TP-147 转完整真实 fixture。（`E/t-items-TP.md:1088`） |
| A1-054 | `W/tasks/plan-readers.ts:1527` | if/0 | D2 | 正式平台注册 claim schemas；此“窄测试后端无 schema 当空”的特例无生产需要。（`现/src/composition/create-platform.ts:628`） | 删除 unsupported→空结果回退，统一失败传播 | 同 053 的旧窄 schema fixture；TP-147。（`前/tests/work-graph/R3c-plan-adoption.test.ts:59`；`E/t-items-TP.md:1088`） |
| A1-055 | `W/tasks/plan-readers.ts:1716` | if/0 | U | 旧例隐藏不可变来源 Plan；正常 owner 不删除该历史来源。（`前/tests/work-graph/W1-future-plan.test.ts:634`；`E/t-items-T1-w2.md:466`） | 保留缺来源拒绝不测 | scenario 8 missing source；T1-064。（前述测试:634；`E/t-items-T1-w2.md:463`） |
| A1-056 | `W/tasks/plan-readers.ts:1754` | if/0 | D2 | ready 记录已经通过 UnknownCallReview 注册 schema；后续再次解码不应失败。（`R/sqlite-record-store.ts:382`） | 删除重复 codec 失败分支；保留上游真实读取失败处理 | K3-26 损坏记录投影段。（`前/tests/work-graph/K3-26-unknown-call-review-storage.test.ts:857`）；T1-021。（`E/t-items-T2-w2.md:48`） |
| A1-057 | `W/tasks/plan-readers.ts:1790` | if/0 | U | 旧测试改不可变来源定义或来源 Goal；公开继承从同 Goal、相同定义建立 basis。（`E/t-items-T1-w2.md:457`、:466） | 保留来源一致性拒绝，不恢复改库测试 | W1 scenario 1/2、8。（`前/tests/work-graph/W1-future-plan.test.ts:416`、:634）；T1-063/064。（`E/t-items-T1-w2.md:454`、:463） |
| A1-058 | `W/tasks/plan-readers.ts:1803` | if/0 | U | 当前 Run 固定引用其领取 Plan；缺 origin Plan 要靠隐藏/破坏不可变历史。（同文件:1678；`W/tasks/claim-service.ts:1272`；`E/t-items-T1-w2.md:466`） | 保留不可解析历史的保守处理，不造缺 Plan 测试 | **历史归因待定**：不能用 scenario 8 的早退自动证明它执行过 :1803；需旧覆盖位置与触发用例 |
| A1-059 | `W/tasks/plan-readers.ts:2074` | if/0 | F | future reader 的 Run lookup 与 Lease 批读之间可发生真实 claim；这里没有 canonical reader 的同水位重试。（同文件:2041、:2048；对照:1654） | P9 | changed-lease / lease-before-reduction。（`前/tests/work-graph/W1-future-plan.test.ts:707`、:729）；T1-062 删除为不可达。（`E/t-items-T1-w2.md:452`） |
| A1-060 | `W/tasks/plan-readers.ts:2076` | if/0 | D2 | 坏 Lease JSON 已由正式 store 拒绝，不能进入 ready 后的 parse-null。（`R/sqlite-record-store.ts:382`） | 删除下游重复解析防御 | undecodable-lease。（`前/tests/work-graph/W1-future-plan.test.ts:740`）；T1-065。（`E/t-items-T1-w2.md:475`） |
| A1-061 | `W/tasks/plan-readers.ts:2076` | if/1 | F | P9 产生的是正式 claim 写出的有效 Lease，会走此臂。（同文件:2041、:2048；`W/tasks/claim-service.ts:1272`） | P9 | changed-lease。（`前/tests/work-graph/W1-future-plan.test.ts:707`）；T1-062。（`E/t-items-T1-w2.md:452`） |
| A1-062 | `W/tasks/plan-readers.ts:2081` | if/0 | G | gate 可完成并写 Reduction，生产完成代码明确覆盖 gate；不需要该 gate 的 Run。（`W/tasks/completion.ts:367`、:427、:469） | P10 | changed-reduction 等。（`前/tests/work-graph/W1-future-plan.test.ts:708`）；T1-062 的“真实完成先有 Run”理由遗漏 gate。（`E/t-items-T1-w2.md:447`） |
| A1-063 | `W/tasks/plan-readers.ts:2083` | if/1 | G | P10 写出的正式 gate Reduction 可解码，走非 null 臂。（`W/tasks/completion.ts:448`、:469） | P10 | 同一 changed-reduction。（`前/tests/work-graph/W1-future-plan.test.ts:708`）；T1-062。（`E/t-items-T1-w2.md:452`） |
| A1-064 | `W/tasks/plan-service.ts:1878` | if/1 | D2 | 只读 proposal 已经通过仅 candidate_v2 的 codec。（`W/persistence/plan-record-codecs.ts:790`） | 删除整个 legacy 授权 else 块 | RC11 readPlanProposal。（`前/tests/work-graph/S5-request-candidates.test.ts:329`）；TP-168。（`E/t-items-TP.md:1242`） |
| A1-065 | `W/tasks/plan-service.ts:1880` | if/1 | D2 | 位于 064 的不可进入块内。（同文件:1878；`W/persistence/plan-record-codecs.ts:790`） | 同 064 | RC11；TP-168。（`前/tests/work-graph/S5-request-candidates.test.ts:329`；`E/t-items-TP.md:1241`） |
| A1-066 | `W/tasks/plan-service.ts:1882` | binary-expr/0 | D2 | 位于非 candidate_v2 分支内。（同文件:1878；`W/persistence/plan-record-codecs.ts:790`） | 同 064 | RC11；TP-168。（`前/tests/work-graph/S5-request-candidates.test.ts:329`；`E/t-items-TP.md:1241`） |
| A1-067 | `W/tasks/plan-service.ts:1882` | binary-expr/1 | D2 | 同一不可进入的旧授权表达式。（同文件:1878） | 同 064 | RC11；TP-168。（`前/tests/work-graph/S5-request-candidates.test.ts:329`；`E/t-items-TP.md:1241`） |
| A1-068 | `W/tasks/plan-service.ts:1882` | if/1 | D2 | 外层旧 kind 分支已被 codec 排除。（同文件:1878；`W/persistence/plan-record-codecs.ts:790`） | 同 064 | RC11；TP-168。（`前/tests/work-graph/S5-request-candidates.test.ts:329`；`E/t-items-TP.md:1241`） |
| A1-069 | `W/tasks/plan-service.ts:1882` | if/1 | D2 | 虽与 068 的表面位置重复，但整个所在块均不可进入，分类不依赖区分两个 if。（同文件:1878） | 同 064 | RC11；TP-168。（`前/tests/work-graph/S5-request-candidates.test.ts:329`；`E/t-items-TP.md:1241`） |
| A1-070 | `W/tasks/plan-service.ts:2861` | if/0 | G | 第二次问状态机检查 scope、pins、Goal cancelled；合法调用可以被这些条件拒绝。（同文件:2857；`W/state/plan-machine.ts:915`） | P11 | change-no-decision 其实沿用 v1 draft。（`前/tests/work-graph/R3c-plan-adoption.test.ts:81`、:307）；TP-050 清 v1。（`E/t-items-TP.md:360`） |
| A1-071 | `W/tasks/plan-service.ts:2864` | binary-expr/0 | G | scoped refusal 会计算 pinsCurrent；错误 pin 可公开提交。（`W/state/plan-machine.ts:918`） | P11 | 同一旧 v1 future 拒绝；TP-050。（`前/tests/work-graph/R3c-plan-adoption.test.ts:307`；`E/t-items-TP.md:360`） |
| A1-072 | `W/tasks/plan-service.ts:2865` | binary-expr/0 | G | 非 stale 拒绝也会求值 `refused.reason==='stale'`；cancelled Goal 可产生它。（`W/state/plan-machine.ts:922`） | P11，增加 cancelled Goal 分支 | 同一旧 v1 future 拒绝；TP-050。（`前/tests/work-graph/R3c-plan-adoption.test.ts:307`；`E/t-items-TP.md:360`） |
| A1-073 | `W/tasks/plan-service.ts:2865` | cond-expr/1 | G | cancelled Goal 的 refusal 不带 stale current 回退。（`W/state/plan-machine.ts:922`） | P11 | 同一旧 v1 future 拒绝；TP-050。（`前/tests/work-graph/R3c-plan-adoption.test.ts:307`；`E/t-items-TP.md:360`） |
| A1-074 | `W/tasks/plan-service.ts:2993` | if/0 | F | future facts 的真实 lookup/readMany 失败会在此传播。（`W/tasks/plan-readers.ts:2042`、:2049） | P8 | 旧 undecodable-lease 触发此传播。（`前/tests/work-graph/W1-future-plan.test.ts:740`）；T1-065 删篡改例，不能据此删故障传播。（`E/t-items-T1-w2.md:475`） |
| A1-075 | `W/tasks/plan-task-basis.ts:282` | if/0 | U | 来源被改到另一 Goal 的旧测试；正常 basis 从同 Goal 来源建立。（`E/t-items-T1-w2.md:466`） | 保留范围拒绝不测 | W1 scenario 8 cross-goal。（`前/tests/work-graph/W1-future-plan.test.ts:634`）；T1-064。（`E/t-items-T1-w2.md:463`） |
| A1-076 | `W/tasks/reconcile-intents.ts:139` | cond-expr/1 | D2 | 当前已进入的 steer/history 及 RUN-16 都带 V2 binding；无授权旧未进入控制路径已退役。（`W/state/run-machine.ts:2209`；`E/t-items-TP.md:801`） | 删除旧无 entry 回退；相应调用签名要求当前 binding | pre-D7 W-04。（`前/tests/runtime/A2-reconcile-runtime.test.ts:521`、:552）；TP-109。（`E/t-items-TP.md:799`） |
| A1-077 | `W/tasks/reconcile-intents.ts:166` | cond-expr/0 | F | 当前 RUN-16 仍能结算 Entering 时排队的 pause/cancel；pause 分支明确存在。（`W/state/run-machine.ts:2217`、:2223） | P12 | 旧 W-04 pause 子例。（`前/tests/runtime/A2-reconcile-runtime.test.ts:546`）；TP-109 删除旧账本正确，但未覆盖当前 RUN-16 pause。（`E/t-items-TP.md:801`） |
| A1-078 | `W/tasks/reconcile-intents.ts:166` | cond-expr/1 | **待定** | 同一行有两个三元：外层 false 可进入合法 cancel；内层 false 是 resumed，当前 RUN-16 只结算 pause/cancel。列表没有列位置，无法区分。（同文件:166；`W/state/run-machine.ts:2219`） | 需 branchId 和 column；外层 false 判 F，内层 resumed 判 D2 并删回退 | 旧 W-04 含 cancel/pause/resume。（`前/tests/runtime/A2-reconcile-runtime.test.ts:546`）；TP-109。（`E/t-items-TP.md:803`） |
| A1-079 | `W/tasks/run-reconcile-service.ts:136` | function | G | owner 对不处于 unknown 状态的 Run 发 resolveUnknownRun，状态机仍可拒绝并调用此映射。（同文件:901、:946） | P13 | W-04 resume 在 Goal paused 时的 busy。（`前/tests/runtime/A2-reconcile-runtime.test.ts:574`）；TP-109。（`E/t-items-TP.md:799`） |
| A1-080 | `W/tasks/run-reconcile-service.ts:592` | cond-expr/1 | D2 | 当前 reconcile end 需已进入/Entering 的 V2 binding；RUN-16 也先验 binding。（同文件:595；`W/state/run-machine.ts:2209`） | 删除无授权旧结束路径的 null entry 回退 | W-04 未授权 cancel。（`前/tests/runtime/A2-reconcile-runtime.test.ts:552`、:587）；TP-109。（`E/t-items-TP.md:805`） |
| A1-081 | `W/tasks/run-state-service.ts:233` | if/0 | U | Run 与 claim 的 Workspace 不一致来自改写不可变关联；claim 同批产生关联记录。（`W/tasks/claim-service.ts:1272`） | 保留关联拒绝，不补篡改例 | “Run workspace disagrees”。（`前/tests/work-graph/R4c-execution-read.test.ts:271`）；TP-149。（`E/t-items-TP.md:1104`） |
| A1-082 | `W/tasks/run-state-service.ts:242` | if/0 | U | outbox claim 被改指另一 Run。（`前/tests/work-graph/R4c-execution-read.test.ts:268`）；正常同批写入。（`W/tasks/claim-service.ts:1272`） | 保留关联拒绝不测 | “outbox points at another Run”；TP-149。（前述测试:268；`E/t-items-TP.md:1101`） |
| A1-083 | `W/tasks/run-state-service.ts:256` | if/0 | U | 旧例从已采用 Plan 原地删除 Task；公开变更拒绝物理移除。（`前/tests/work-graph/R4c-execution-read.test.ts:274`；`W/tasks/plan-validation.ts:337`） | 保留坏关联拒绝不测 | “Plan omits Task”；TP-149。（前述测试:274；`E/t-items-TP.md:1104`） |
| A1-084 | `W/tasks/run-state-service.ts:264` | if/0 | U | Session Workspace 被原地改写，与 claim 不符。（`前/tests/work-graph/R4c-execution-read.test.ts:277`；`W/tasks/claim-service.ts:1272`） | 保留关联拒绝不测 | “Session workspace disagrees”；TP-149。（前述测试:277；`E/t-items-TP.md:1101`） |
| A1-085 | `W/tasks/run-state-service.ts:462` | if/0 | D2 | 正式 store 已在 ready 前验证 Run schema。（`R/sqlite-record-store.ts:382`） | 删除下游重复 decode-failed 分支 | “damaged Run”绕过 store 返回坏 JSON。（`前/tests/work-graph/R4c-execution-read.test.ts:265`）；TP-149。（`E/t-items-TP.md:1104`） |
| A1-086 | `W/tasks/run-state-service.ts:481` | if/0 | D2 | 正式 store 已验证 outbox schema。（`R/sqlite-record-store.ts:382`） | 删除重复 decode-failed 分支 | “damaged outbox”。（`前/tests/work-graph/R4c-execution-read.test.ts:267`）；TP-149。（`E/t-items-TP.md:1104`） |
| A1-087 | `W/tasks/run-state-service.ts:543` | if/0 | D2 | 正式 store 已验证 Attempt schema。（`R/sqlite-record-store.ts:382`） | 删除重复 decode-failed 分支 | “damaged Attempt”。（`前/tests/work-graph/R4c-execution-read.test.ts:266`）；TP-149。（`E/t-items-TP.md:1104`） |
| A1-088 | `W/tasks/run-state-service.ts:564` | if/0 | U | 汇总 081—084 的跨记录关系损坏；单记录 schema 不保证这些关系，真实 claim 原子建立。（`W/tasks/claim-service.ts:1272`） | 保留关系拒绝不测；不能与 085—087 的重复解码混删 | inconsistent cross-links 循环。（`前/tests/work-graph/R4c-execution-read.test.ts:268`、:281）；TP-149。（`E/t-items-TP.md:1104`） |
| A1-089 | `W/tasks/session-facts.ts:78` | binary-expr/3 | G | queries/successors cursor 是当前公开分页格式；queries 非 executions 会继续求值。（同文件:65、:387） | P14 | **历史归因待定**：TQ-088 改过同一 decoder，但不能证明删掉哪个分页命中。（`前/src/core/work-graph/tasks/session-facts.ts:85`、:88；`E/t-items-TQ.md:548`） |
| A1-090 | `W/tasks/session-facts.ts:78` | binary-expr/4 | G | successors 或错误 kind 的公开 cursor 会求值第三个 kind 比较。（同文件:78、:506） | P14 | 同 089，需旧 branchMap/逐测试命中；不把删除旧 Query 指针测试等同删除 successors 分页。（`E/t-items-TQ.md:550`） |
| A1-091 | `W/tasks/session-facts.ts:307` | binary-expr/1 | D2 | workspace 候选 Session 已通过非空 provenance codec。（同文件:302；`W/sessions/session-record-codecs.ts:736`） | 删除 `?? null` | 旧 provenance 场景及 SV12—SV14 旧来源部分；TP-062。（`前/tests/work-graph/S1-provenance.test.ts:293`；`E/t-items-TP.md:449`、:452） |
| A1-092 | `W/tasks/session-facts.ts:307` | if/0 | D2 | 同 091，合法已解码 candidate 不可能缺 provenance。（`W/sessions/session-record-codecs.ts:736`） | 删除缺 provenance 分支及无效扫描用途 | 同一旧来源场景；TP-062。（`前/tests/work-graph/S1-provenance.test.ts:293`；`E/t-items-TP.md:452`） |
| A1-093 | `W/tasks/session-facts.ts:310` | binary-expr/1 | D2 | 主 Session 也受同一必填约束。（`W/sessions/session-record-codecs.ts:736`） | 直接读 session.provenance | SV12 等旧来源读取；TP-062。（`前/tests/work-graph/S1-provenance.test.ts:293`；`E/t-items-TP.md:449`） |
| A1-094 | `W/tasks/task-service.ts:261` | if/1 | U | 本组丢失的是 corrupt 穿过三次分类后转 unavailable；真实 SQLite IO 异常是抛出，不是该返回值。（`W/persistence/graph-repository.ts:335`；`R/sqlite-record-store.ts:501`） | 保留错误映射，不恢复同 revision 篡改 | same-revision scope tamper。（`前/tests/record-store/R3a-transaction-boundaries.test.ts:123`）；T2-010。（`E/t-items-T2-w2.md:104`） |
| A1-095 | `W/tasks/task-service.ts:264` | if/1 | U | 同 094 的 corrupt 结果继续穿过 idempotency 检查。（同文件:261、:268） | 同 094 | 同一测试:127；T2-010。（`前/tests/record-store/R3a-transaction-boundaries.test.ts:127`；`E/t-items-T2-w2.md:107`） |
| A1-096 | `W/tasks/task-service.ts:267` | if/1 | U | 同一路径最终转 unavailable。（同文件:267、:268） | 同 094 | 同一测试:127；T2-010。（`前/tests/record-store/R3a-transaction-boundaries.test.ts:127`；`E/t-items-T2-w2.md:107`） |
| A1-097 | `W/tasks/unknown-call-review-service.ts:801` | if/1 | D2 | cache hit 要同轮第二个 process；当前串行非只读执行只能留下一个 process，已冻结到该限制。（`现/tests/work-graph/K3-06-mixed-kinds-owner.test.ts:6`；`E/t-items-T2-w2.md:75`） | 删除多 process 专用缓存命中优化；组合矩阵留纯聚合测试 | L16 D6 multi-item read-once。（`前/tests/work-graph/UCR-settle-review.test.ts:278`）；T1-061。（`E/t-items-T2-w2.md:75`） |
| A1-098 | `W/tasks/unknown-call-review-service.ts:805` | if/0 | U | 正式 reader 的 not_found 指 Run 缺失或 envelope=null；真实正文故障返回 rejection，走 :812。（`现/src/composition/create-platform.ts:739`、:743、:746） | 保留异常引用拒绝不测；正文故障测现有 rejection 路径 | L16 D6 假 reader 返回 not_found。（`前/tests/work-graph/UCR-settle-review.test.ts:269`）；T1-061 改真实 manifest 失败。（`E/t-items-T2-w2.md:75`） |
| A1-099 | `W/tasks/unknown-call-review-service.ts:1501` | binary-expr/1 | G | 空 ledger 的真实 watermark 是 null；listReviews 只验请求 scope，不要求先有 Workspace 记录。（同文件:1418、:1470；`R/in-memory-record-store.ts:256`） | P15 | **历史归因待定**：旧 list 的水位测试只造非空 cursor，不能冒认它命中 null。（`前/tests/work-graph/unknown-call-review-list.test.ts:213`）；相关转换 T1-070。（`E/t-items-T2-w2.md:92`） |
| A1-100 | `W/tasks/unknown-call-review-service.ts:1504` | binary-expr/1 | G | 空 ledger 的单个 lookup 页水位为 null，稳定检查成立后此处回落 null。（同文件:1472、:1502；`R/in-memory-record-store.ts:259`） | P15 | **历史归因待定**，同 099；需原始逐测试覆盖证据。（`前/tests/work-graph/unknown-call-review-list.test.ts:198`；`E/t-items-T2-w2.md:92`） |

补测方案如下；均只描述施工步骤，没有执行。

| 方案 | 公开步骤、故障接缝与归属 |
|---|---|
| **P1** | `createProject → registerWorkspace → createGoal`，请求给 Project pin=2，真实记录保持@1；断言 revision_conflict/current@1。放回 `现/tests/work-graph/R3a-goal-replay-boundaries.test.ts`；比较逻辑确实接受并核对调用者 pin。（`W/persistence/commit-compiler.ts:217`、:228） |
| **P2** | 真实 claim、prepare、start；工具保持在执行中，重启 reconcile 得到 outcome_unknown 且保留占用，再读取 line。复用现有 W-13 工具闸门，补入 line 场景测试。（`现/tests/runtime/A2-reconcile-runtime.test.ts:268`、:277、:285`；`现/tests/scenarios/S2C-K-unknown-outcome.test.ts:45`） |
| **P3** | 真实 Session 经 Kernel 缺失与 Host 重启成为 retired；读 line 时仅令 provenance 计数的 `countLookup` 失败。复用已有 backend 包装接缝，补在 `S2C-lines-d1.test.ts`；不能改 Session provenance。（`现/tests/scenarios/S2C-K-unknown-outcome.test.ts:50`；`现/tests/helpers/S2C-L-line-support.ts:580`；`现/tests/work-graph/S2C-lines-d1.test.ts:75`） |
| **P4** | 公开采用 Plan，尚未开验证轮时调用 `completeTask`，传格式合法但不存在的 roundRef；断言在投影阶段拒绝。补入 `A2-verification-chain.test.ts`，覆盖 none→null，而不是重建双旧根。（`W/tasks/completion.ts:353`、:359；`前/tests/work-graph/A2-verification-chain.test.ts:196`） |
| **P5** | 在 w2 的真实 Goal 创建/领取 Run，由该 Run `storeArtifact`；w1 的 Plan 输入声明引用该 artifact；用 w1 consumer 分别调用 `readTaskInputs`、`readTaskInputPage`，断言 forbidden 且无正文。补 `S3-context-inputs.test.ts`；当前 inputRequirements 会直接生成该声明，材料写入绑定真实 owner。（`W/tasks/context-input-service.ts:363`、:490`；`W/materials/material-service.ts:138`、:151`；`现/tests/work-graph/S3-context-inputs.test.ts:316`） |
| **P6** | 沿当前 IN11 的真实 gate 检查链，将登记脚本改为实际退出码非零，执行 `openVerification → runRegisteredCheck → finalizeChecks → readTaskInputs`；断言 missing/source=null。也可另测 open 轮次。放 `S3-context-inputs.test.ts`。（`现/tests/work-graph/S3-context-inputs.test.ts:764`、:776、:783；`W/tasks/context-input-service.ts:594`） |
| **P7** | 真实 entered Run 后制造 Kernel 读取故障，由 Host 的实际探测链调用 `recordSessionHealth`；在 reconcile 改写 Run 前，以原有效 permit 请求 `authorizeModelRequest`，验证 unavailable health 的 hold 拒绝。故障接缝用已有 Kernel 缺失场景；归属 `B2-model-request.test.ts`。不得清空 occupancy 或更换运行中 Role。（`现/tests/scenarios/S2C-K-unknown-outcome.test.ts:50`；`W/sessions/session-health.ts:103`、:121；`W/tasks/execution-entry-service.ts:606`） |
| **P8** | 分别公开建立“有 Run 的 graph 读取”和“合法 future-plan 采用”；只在目标 rework/future-facts `readMany` 注入 unavailable。复用现有 `failingReadMany` 的真实 backend 包装，分别补 `R3c-plan-adoption.test.ts`、`W1-future-plan.test.ts`。（`现/tests/helpers/S2C-L-line-support.ts:552`；`W/tasks/plan-readers.ts:1525`、:2048；`W/tasks/plan-service.ts:2993`） |
| **P9** | 公开建尚未领取的 work Task 及修改其定义的候选；`applyPlanChange` 的 Run lookup 返回空页后，在包装接缝中执行真实 `claimTask`，随后放行 Lease 批读；应以 Lease trace 拒绝。沿用已有“lookup 后公开 claim”包装方式，补 W1 scenario 9。（`现/tests/work-graph/R3c-plan-adoption.test.ts:319`、:326`；`W/tasks/plan-readers.ts:2041`、:2074`） |
| **P10** | 真实 work Run 完成，打开以 gate 为 subject 的验证轮，真实登记检查 PASS、finalize、`completeTask(gate)`；随后公开提案修改该 gate 的 title 并 apply，应以 Reduction trace 拒绝。补 W1 scenario 9。gate 轮次使用 work producer，完成提交只写 Reduction。（`W/tasks/completion.ts:367`、:427、:469；`现/tests/work-graph/S3-context-inputs.test.ts:767`） |
| **P11** | 当前 v2 候选创建后，分别以不匹配的 Goal/Workspace pin apply，以及公开取消 Goal 后持当前 pin apply；前者断言 revision_conflict/current，后者断言 cancelled 对应拒绝。归属 `R3c-plan-adoption.test.ts`。（`W/tasks/plan-service.ts:2857`、:2864；`W/state/plan-machine.ts:918`、:922） |
| **P12** | 复用 W-05：真实 begin 已提交，Kernel `runCodingAgent` 未返回；这次公开提交 pause，再重启 reconcile；断言 intent 结算为 paused。现有测试只对 withCancel 分支作此验证。归属 `A2-reconcile-runtime.test.ts`。（`现/tests/runtime/A2-reconcile-runtime.test.ts:230`、:243；`W/state/run-machine.ts:2223`） |
| **P13** | 对真实创建、仍非 unknown 的 Run，以完整合法请求调用 `resolveUnknownRun`；由 owner 的状态机返回非法状态拒绝，核对零写入。放 `A2-reconcile-runtime.test.ts`；调用处确实把拒绝交给 runRefusal。（`W/tasks/run-reconcile-service.ts:905`、:939、:947） |
| **P14** | 公开创建至少两个 Query/continuation successor，limit=1 取下一页 cursor，再续读；分别覆盖 queries、successors。还可向分页入口提交编码正确但 kind 不识别的请求 cursor——这是请求校验，不是篡改数据库。归属 `S1-session-facts.test.ts`、`S1-provenance.test.ts`。（`W/tasks/session-facts.ts:78`、:387、:506；`现/tests/work-graph/S1-provenance.test.ts:97`） |
| **P15** | 打开已注册正式 schemas、尚无事件的真实 backend，以完整 Host scope 调 `listReviews({open:'yes'})`；断言空 items、null readThrough。补 `unknown-call-review-list.test.ts`，不伪造 lookup 页。（`W/tasks/unknown-call-review-service.ts:1418`、:1472、:1504；`R/in-memory-record-store.ts:259`） |

计数如下，覆盖 A1-001—A1-100 全部行；“历史归因待定”不改变已经能由当前代码确定的分类。（`lists/list-A1.tsv:2`、`:101`）

| class | 行数 |
|---|---:|
| D1 | 0 |
| D2 | 33 |
| U | 37 |
| F | 10 |
| G | 18 |
| N | 0 |
| 待定 | 2 |
| **合计** | **100** |

对 T 的删除范围提出以下五项复核。这里均不要求恢复原来的非法夹具，而是保留被它顺带覆盖的当前行为：

1. **T1-062：A1-059、A1-061，遗漏真实 claim 竞态。** “Run 与 Lease 原子写，所以 Lease 分支不可达”不适用于两个不同水位的读取。按 P9 恢复测试：空 Run lookup → 真实 claim → Lease read → 拒绝采用。（`E/t-items-T1-w2.md:452`；`W/tasks/plan-readers.ts:2041`、:2048）

2. **T1-062：A1-062、A1-063，遗漏 gate 的 Reduction。** “真实完成先留下 Run”只说明 work 的情况；gate 完成也写 Reduction，其 producer 是另一个 work Task 的 Run。按 P10 恢复 gate 完成后不可改定义的测试。（`E/t-items-T1-w2.md:447`；`W/tasks/completion.ts:367`、:427、:469）

3. **TQ-114 / B-12：A1-032、A1-034、A1-036，跨 Workspace 材料拒绝仍可公开到达。** 原“同 Goal 的 Run 被放在 w2”确实非法，但换成 w2 自己 Goal 的真实 Run，即可保留原 forbidden/无正文断言。按 P5 重建 IN04；不要恢复手写 Run。（`E/t-items-TQ.md:744`；`E/t-w1-findings.md:144`；`W/tasks/context-input-service.ts:453`）

4. **TQ-115 / B-13：A1-035，合法 FAIL/open head 的拒绝丢失。** PASS→FAIL 后继应删，但原 `missing`、`source=null` 断言可以由首个 FAIL 轮次恢复；B-13 本身也要求保留可达后继所表达的断言。按 P6 补测。（`前/tests/work-graph/S3-context-inputs.test.ts:804`；`E/t-w1-findings.md:145`；`W/tasks/context-input-service.ts:594`）

5. **TP-140：A1-030，“不会少覆盖”的核销范围过大。** blocked/failed 共用后面的拒绝分支，并不能覆盖前面 `chainHeadOf` 的 none/invalid→null。双旧根应删；无验证轮时调用 completeTask 是合法拒绝场景，按 P4 保留。（`E/t-items-TP.md:1033`；`W/tasks/completion.ts:162`、:353）

TP-145 的 occupancy 篡改例、TP-109 的 pre-D7 账本例，其原删除理由成立；表中的 F 缺口是它们曾顺带覆盖的其他当前路径，不应因此恢复旧样本。（`E/t-items-TP.md:1072`、:801；`W/state/run-machine.ts:1085`、:2223）

`ref/t-end-list.md` 的 L-2 明确点名过滤器，并笼统引用 T1-061/T1-062 guards；与本清单对应的条件及两侧 arm 如下。（`ref/t-end-list.md:22`、`:23`）

| L-2 对应处 | A1 行 | 分类 |
|---|---|---|
| 非 satisfied Reduction 过滤 | A1-050 | U；收紧 Reduction 格式后删除过滤。（`W/state/task-machine.ts:487`） |
| 无 Run lookup 命中后发现 Lease | A1-059 | F；真实 claim 竞态。（`W/tasks/plan-readers.ts:2041`、:2048） |
| Lease 解码失败臂；具体旧测试属 T1-065 | A1-060 | D2；上游 schema 已拒绝。（`R/sqlite-record-store.ts:382`；`E/t-items-T1-w2.md:475`） |
| 同一 Lease 条件的有效记录臂 | A1-061 | F。（`W/tasks/plan-readers.ts:2076`） |
| 无该 Task Run 的 Reduction | A1-062 | G；gate 完成。（`W/tasks/completion.ts:427`） |
| 同一 Reduction 条件的有效记录臂 | A1-063 | G。（`W/tasks/completion.ts:469`） |
| UCR 每轮 display cache 命中 | A1-097 | D2；多 process 前置不可产生。（`E/t-items-T2-w2.md:75`） |
| UCR display reader 返回 not_found | A1-098 | U；真实正文故障走 rejected。（`现/src/composition/create-platform.ts:739`、:746） |

A1-042、A1-046 也与 T1-062 的旧 fixture 有关联，但 L-2 没逐一列出它们；不把“同一 T 项”自动等同“已登记的 L-2 guard”。两行在上表分别判 U，是否纳入 L-2 台账需 lead 补确切行号。（`ref/t-end-list.md:23`；`W/tasks/plan-readers.ts:219`、:1201）