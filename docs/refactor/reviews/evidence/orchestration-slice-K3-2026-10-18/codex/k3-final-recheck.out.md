五项分类均同意，未发现清单漏列的“会出错”。**F-021 的关闭依据中有一条错误的 mutation 推断，需要更正；不因此新增测试缺口。** 以下均为静态复核，未写文件、未运行测试或变异。

五个未闭项逐项结论：

| 项目 | 判定及依据 |
|---|---|
| **N-01** | **同意“缺保护”，同意修法和 M1。** [workflow.ts:2758](D:/cxt/k3g4b3-review12/src/business/workflow/workflow.ts:2758) 将读取失败记为 hardFailure；指定 `taskId` 后，`:2789` 返回 waiting。M1 删除这些赋值后，`:2792` 返回 advance、select_work、reason:null，拟补的等待和准确原因断言都会失败。注入应明确返回 `unavailable / the saved answer is not readable`；正常代码返回清单所列原因。可复用 [UR7:51](D:/cxt/k3g4b3-review12/tests/work-graph/B2-UR7-crr-answer.test.ts:51) 的装配；零写断言单独不能杀死 M1。 |
| **F-067** | **同意“只是写法”，同意算式补全方向及 M2。** [预算测试:512](D:/cxt/k3g4b3-review12/tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:512) 确实只给出前置总数，没有完整 C 的独立推导。删除 [optional admission:231](D:/cxt/k3g4b3-review12/src/core/work-graph/state/unknown-call-review.ts:231) 后，162,720 仍低于绝对上限，长 proposal 会获准，`:544` 的 capacity 断言失败；正常代码拒绝。**按你本次分流规则，此形式欠账进 T，不应继续按清单派 Opus。** |
| **N-02** | **同意“只是写法”及接受替换的处置；mutation 不适用。** [prepare:192](D:/cxt/k3g4b3-review12/tests/runtime/K3-review-preparation.test.ts:192) 测真实单条记录；[pure:94](D:/cxt/k3g4b3-review12/tests/runtime/K3-review-input-pure.test.ts:94) 保留 `[1,2,3]` 映射。不是字面等价移动，但未找到由这次替换新增的业务保护缺口。 |
| **N-03** | **同意“只是写法”及明确记录局部删减；mutation 不适用。** [Host 测试:263](D:/cxt/k3g4b3-review12/tests/scenarios/K3-44-crr-kind4.test.ts:263) 检查真实交接结果；[UR7:162](D:/cxt/k3g4b3-review12/tests/work-graph/B2-UR7-crr-answer.test.ts:162) 确实再次提交同一答复，并检查 request/message revision 和 application 不变。第二次无待处理答复的 restart 本身不能冒充重放，清单对此区分正确。 |
| **N-04** | **同意“只是写法”及五处扩时记账；mutation 不适用。** [K44:290](D:/cxt/k3g4b3-review12/tests/scenarios/K3-44-crr-kind4.test.ts:290)、`:340` 两处，以及 [B2-09:524](D:/cxt/k3g4b3-review12/tests/work-graph/B2-09-crr-owner.test.ts:524)、`:536`、`:548` 三处，数量正确。未见因此丢失业务断言。 |

清单 §2 的关闭项：

| 项目 | 复核结论 |
|---|---|
| **F-020** | **同意关闭。** [K44:254](D:/cxt/k3g4b3-review12/tests/scenarios/K3-44-crr-kind4.test.ts:254) 证明重启前 pending，`:263`、`:322` 等待重启后的实际结果；禁用 `host.ts:1036` 的 driver 启动会使等待失败。 |
| **F-021** | **同意业务关闭，但不同意所列 mutation 证明。** [B2-02:93](D:/cxt/k3g4b3-review12/tests/runtime/B2-02-recognition-unified.test.ts:93) 已接真实 reader；[B2-12:166](D:/cxt/k3g4b3-review12/tests/work-graph/B2-12-recognition.test.ts:166) 已恢复 throw，`:180` 检查 declared 请求成功。下面说明证据错误。 |
| **F-026** | **同意关闭。** [B2-01:77](D:/cxt/k3g4b3-review12/tests/work-graph/B2-01-blocked-commands.test.ts:77)、`:113–114`、`:138–139`，B2-03 `:89`、B2-14 `:77` 均为独立 hash 字面量；[K3-46:501](D:/cxt/k3g4b3-review12/tests/business/K3-46-review-advance-failures.test.ts:501) 不再复制实际错误文字。 |
| **F-032** | **同意关闭。** [list-by-task:64](D:/cxt/k3g4b3-review12/tests/work-graph/K3-15-list-by-task.test.ts:64)、`:75` 建立同 Task 两个不同 Run；`:90`、`:97` 严格检查两条和分页结果。过滤后只保留一条会失败。 |
| **F-035** | **同意关闭。** Host 交接由 F-020 覆盖；[UR7:156](D:/cxt/k3g4b3-review12/tests/work-graph/B2-UR7-crr-answer.test.ts:156) 恢复 allowed，`:163–174` 保留实际②③重放及幂等检查。 |
| **F-054** | **同意关闭。** [workflow-rows:816](D:/cxt/k3g4b3-review12/tests/business/K3-review-workflow-rows.test.ts:816)、`:859/:878/:914`，[preparation:166](D:/cxt/k3g4b3-review12/tests/runtime/K3-review-preparation.test.ts:166)、`:212`，[tools:126](D:/cxt/k3g4b3-review12/tests/runtime/K3-12-review-round-tools.test.ts:126) 七行均参数化两后端，前置来自真实 owner；N-02 的字面替换另行记账正确。 |
| **F-069** | **同意关闭。** [owner 测试:514](D:/cxt/k3g4b3-review12/tests/work-graph/B2-09-crr-owner.test.ts:514)、`:526/:538` 确实在 owner 的 `listTaskReviews` 返回故障；若将 `command-rerun-request-service.ts:741` 改成非 ready 使用空集合，准确拒绝断言会失败。 |
| **F-072** | **同意关闭。** [recovery:85](D:/cxt/k3g4b3-review12/tests/business/K3-44-crr-recovery.test.ts:85) 在①之后第二次 Goal 读取抛错，进入 adapter。删除 `decision-actions.ts:277` 的异常捕获会令 `:156` 的 await 抛出，测试失败；严格说不是在 `:159` 断言处失败。 |
| **F-073** | **同意关闭。** [recovery:191](D:/cxt/k3g4b3-review12/tests/business/K3-44-crr-recovery.test.ts:191) 仅使②提交失败；`:209–213` 证明①存在、②未提交。恢复 `applied === null → continue` 后，`:134` 的长度从 1 变成 0。 |
| **F-076** | **同意关闭。** [cancellation:164](D:/cxt/k3g4b3-review12/tests/runtime/K3-B3-cancellation-cancelled.test.ts:164) 命中 sibling-request 分页故障；将 `decision-read-model.ts:566/641` 的取消传播改回 unavailable，`:193` 失败。未 abort caller 的写法差异不掩盖这个分支。 |
| **F-098** | **同意关闭。** [order:79](D:/cxt/k3g4b3-review12/tests/runtime/K3-B3-newest-request-order.test.ts:79) 建立同刻 `a/B`；底层返回 ref 升序，删 brief 排序会先取 B，使`:122`失败；删 card 排序会得到 B、a，使`:170`失败。 |
| **F-100** | **同意关闭。** [goal-basis:115](D:/cxt/k3g4b3-review12/tests/work-graph/K3-10-crr-goal-basis.test.ts:115) 的内容变化例保护 service `:1038`；`:156` 的 pause/resume 例保护“只改 revision 仍接受”。前者不是被另一道 Goal 旧版本检查遮蔽。 |
| **F-101** | **同意关闭限定范围。** [cancellation:132](D:/cxt/k3g4b3-review12/tests/runtime/K3-B3-cancellation-cancelled.test.ts:132) 真走 prepare、读取期间 abort；将 `context-assembler.ts:1281` 改为非 ready 返回空 ready facts，`:143` 会失败。页帽、停滞仍属 T。 |
| **F-046 恢复断言** | **同意关闭这七项。** [disposition-pure:207](D:/cxt/k3g4b3-review12/tests/runtime/K3-15-disposition-effects-pure.test.ts:207)、`:211/:236–239/:245–246/:318–319` 恢复单目标、负断言、完整文字和顺序；不代表整个 F-046 已完成。 |
| **G1** | **同意主交接关闭**，依据 F-020/F-035；N-01 单列正确。 |
| **G2** | **同意关闭**，依据 F-073 的未提交②前置及枚举断言。 |
| **G3** | **同意转 T，不是已修。** [runtime-fail-closed:28](D:/cxt/k3g4b3-review12/tests/runtime/K3-B3-runtime-fail-closed.test.ts:28)、`:48` 只测 reader；移除 `execution-preparation.ts:412` 的消费失败处理，这些测试仍会通过。 |
| **G4** | **同意关闭**，依据 F-076/F-101；清单没有把 r9b 的生产缺陷记录冒充额外 mutation 执行，正确。 |
| **G5** | **同意转 T，不是已修。** [shared-rules-pure:56](D:/cxt/k3g4b3-review12/tests/state/K3-B3-shared-rules-pure.test.ts:56)、`:59` 仍用生产 key 自比，错误共享实现仍可能通过。 |
| **G6** | **同意关闭**，依据 F-098 的真实顺序反例。 |

**F-021 的具体更正：**单独删除 [command-expansion.ts:133](D:/cxt/k3g4b3-review12/src/core/work-graph/tasks/command-expansion.ts:133) 的 catch，指定测试仍会通过，因为 reader 的 throw 已被 [command-recognition.ts:86](D:/cxt/k3g4b3-review12/src/core/work-graph/tasks/command-recognition.ts:86) 转成 unavailable。若要用该故障证明整体异常降级，应同时移除这两层转换、保留正常读取路径，让异常外抛；此时 B2-12 `:180` 将收到 rejected，而非 committed。现有测试能够区分该业务退化，需改的是清单的证明。

台账方面，**未发现另有“要求／等价”实际掩盖业务削弱的行**。L1 前一行仍严格检查两个 refs；容量相关常量都有固定数值约束。A14、N-03 所列局部删减、五处扩时，以及 A35–A38/D12 的真实保护丢失，清单已分别记账，没有冒称等价。72 行的计数正确，`MOVED:21` 不能算作逐项证据。

按你本次分流规则，N-01 交 Codex 测试补丁；其余形式欠账进入 T／冻结记账，不触发第三轮 DSH。

分类：5 项同意、0 项不同意；闭合结论同意，F-021 的变异证明有异议，G3/G5 维持 T；漏报会出错：无。