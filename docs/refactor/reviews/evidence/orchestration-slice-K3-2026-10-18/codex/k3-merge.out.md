这是按 **v2** 合并的草稿；没有修改文件，没有运行测试、构建或检测器。

**有两个冻结缺口必须先说明：**

- 当前材料只有 `b3-helpers.diff`、`b3-src.diff` 和 `b3-stat.txt`，没有测试文件的逐行 diff。统计表不能证明旧测试中的某个命中行是不是 B3 改行。因此，下文保留代码已经核实、但范围尚未核实的测试候选；**不能把这些候选直接冻结，也不能擅自全部移进 T**。
- D1 第 **287、371** 行没有保存旧多行断言的完整内容，报告也没有判定等价。两项继续保持未闭合。

我没有采用目录中另一个 `test-rule-sheet-v2b.md`；本稿只使用用户指定的 v2。

路径缩写：

| 前缀 | 路径 |
|---|---|
| `A/` | `tests/app/` |
| `B/` | `tests/business/` |
| `H/` | `tests/helpers/` |
| `R/` | `tests/runtime/` |
| `S/` | `tests/scenarios/` |
| `ST/` | `tests/state/` |
| `W/` | `tests/work-graph/` |
| `RT/` | `src/core/agent-runtime/` |
| `TG/` | `src/core/work-graph/tasks/` |
| `CM/` | `src/core/work-graph/communication/` |
| `VR/` | `src/core/work-graph/views/` |
| `WF/` | `src/business/workflow/` |
| `SPEC` | `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` |
| `D1:n` | `.lead-ref/d1-k3g4b3-r8.txt:n` |

下文同一文件后的逗号表示多个独立行号。`†` 表示：代码事实已核实，但旧测试的改行范围需要测试 diff 确认。这个范围条件也适用于其他表中涉及旧测试文件的定位，不能用“文件在 B3 清单里”替代逐行判断。

## 1. DROPPED BY v2

这里撤销的是原报告的违规判断，不代表同一个 helper 的其他实现已合规。调用继承不重复计数。

### A1：真实调用者会发送的公开路由请求体

| 原报告定位 | v2 判断及真实路由 |
|---|---|
| G5/F1-01；`H/task-claim-fixture.ts:301`，draft 在 `:280` | Plan draft 是公开输入。对应 `plans/propose`，`src/app/core-routes.ts:384,690,1052`；后续采用走 `plans/apply`，`:385,691,1053`。 |
| G5/F1-02；`H/S5-decision-fixture.ts:585,586` | 同上。不能仅因测试构造 Plan draft 就报 F1。 |
| G5/T；`H/B2-execution-fixture.ts:147` | 同上。该文件其他手造 Runtime 事实仍在 T；这一 Plan 输入本身撤销。 |
| G5/F1-04、H/OPEN-1；`H/K3-review-card-fixture.ts:115`，`extendPlan` 在 `:99` | 同上，公开 `plans/propose`／`plans/apply`。 |
| G5/F1-05、H/OPEN-1；`H/K3-review-card-fixture.ts:353`，disposition draft 在 `:338,341` | 修改任务 disposition 的 Plan draft 仍是公开 `plans/propose` 输入；随后公开采用，`:359`。 |
| H/OPEN-1；`H/K3-proposal-round.ts:203`，`adoptK3PlanTask` 在 `:169` | 同上，公开 propose/apply；apply 调用在 `:211`。 |
| G3/A1 参数限制；`R/S4C2-assembly.test.ts:186` | Note draft 是 `notes/write` 的请求体。路由定义、校验及调用在 `src/app/core-routes.ts:498,888,1153`。 |
| G3/A1 参数限制；`H/S4A-note-fixture.ts:281` | 同上。透传合法 Note draft 不需要改成拆散字段的另一套 helper。 |

**A1 撤销：8 个实现定位。**

### A8：Host 自己提供的输入

| 原报告定位 | 撤销理由 |
|---|---|
| G2/F4-15；`R/K3-12-review-round-tools.test.ts:237` | 初始 Runtime 配置属于 Host 输入。该文件其他假 execution、review、Kernel、sandbox 不随之放行。 |
| G3/F4；`R/K3-35-workspace-baseline-prepare.test.ts:185` | 初始配置允许。 |
| G3/F4；同文件 `:187` | root 指向该测试实际创建的目录；目录建立和使用在 `:163,206`。Host 提供 root/revision 允许。 |
| G3/F4；同文件 `:188` | 对该实际工作区内路径的 Host 授权允许。 |
| G3/F4；`R/K3-review-preparation.test.ts:340` | 初始 Host 配置允许。 |
| G3/F4；同文件 `:397` | 同上。 |
| G3/F4；同文件 `:483` | 同上；其他依赖的假返回另判。 |
| G3/F4；`R/S3-context-assembler.test.ts:395` | 初始 Host 配置允许。 |
| G3/F4；`R/S4C2-assembly.test.ts:144,145` | 通过 Host 配置设置 Runtime／resident budget 允许。 |
| H/D18；`H/K3-35-runtime.ts:112` | Host 提供授权决定，不要求测试另造一个“更真实的授权服务”。仍必须限制在自己的实际 root 内。 |
| G7/F4-20；`H/S5-user-message-support.ts:62` | 这一授权输入撤销；同文件 `:54,55` 的假 duties 不撤销，见 T。 |
| G2/OQ-2；`H/K3-35-runtime.ts:143` | 初始配置适配器由 A8 明确允许，原开放问题的这一部分关闭。 |
| G2/OQ-2；`H/K3-35-prepare.ts:75` | 未调用的 model client 占位也属于 A8 明示允许范围。 |
| H/OPEN-2；`H/K3-35-continuation-fixture.ts:515` | 这里只取 Workspace revision 作 Host 前置 pin，不是通过 store 断言业务结果；按 A8 放行。 |
| G6/A1、H/OPEN-2；`H/K3-proposal-round.ts:331` | 同上。 |
| G6/A1；`W/K3-15-hold-release.test.ts:80` | 同上。 |

**A8 撤销：16 个定位。**

不应一起撤销：

- `H/K3-proposal-round.ts:428`、`H/K3-blocked-command-fixture.ts:146` 是**读取后覆盖配置**，仍为 F2。
- `H/K3-crr-fixture.ts:154,157`、`H/K3-prefix-claim.ts:93,96` 的假 root／固定 digest 仍不允许。
- `R/K3-12-review-round-tools.test.ts:324` 的授权不能按 A8 放行：所用 root 是 `:321` 的硬编码 `/k3-12/workspace`，不是本例建立的真实工作区。

### F9：公开状态的有界轮询

| 原报告定位 | 撤销理由及传播调用 |
|---|---|
| G1–G7、H/D25；`H/K3-proposal-round.ts:356` | `:347` 有次数上限，`:348` 读取公开 execution，等待 entered。属于有界公开状态轮询。 |
| G2、H/D01/D02；`H/B2-401-world.ts:157` | `:147` 公开读取 execution，循环有截止时间。`startNext` 的 `:365` 使用同一机制，不另计一个根因。 |
| G1/F9-01；`B/K3-46-review-advance-failures.test.ts:326` | `:320` 读取公开 driver 状态，循环有截止时间。 |
| G1/F9-02；`B/K3-UR7-crr-failed-set.test.ts:97` | `:91` 读取公开 driver 状态，循环有截止时间。 |
| G4/F9-02；`S/harness.ts:706` | `:703` 的循环有上限，报告涉及的调用读取公开状态。具体传播到 `S/K3-29-startup-variants.test.ts:157`、`S/K3-44-recovery-answers.test.ts:245,306`，以及 `S/harness.ts:211` 的 `waitForFlowToStop`。 |

**F9 撤销：5 个实现根因。**

`H/K3-blocked-command-fixture.ts:350` 轮询的是内部 `watched.calls`，不属于这次放行，保留在 F-009。

**本节合计：29 个撤销定位／实现根因。**

另有两项报告纠正，不能冒充“v2 新放行”：

- 裁定点名的审批摘要削弱没有发生：`W/K3-16-approval-application.test.ts:224` 构造独立完整预期，`:232` 仍做全文 `toBe`；`:238` 是额外子串检查。D1:26 判等价。
- G7/F11-11 对 required-writes 的处理必须服从早先任务书：`.lead-ref/k3-g4b3-rework-6.md:37` 已要求把手造 32 条极值移出 owner 场景。不能因为 `W/K3-48-3-required-writes.test.ts:55` 的小记录不证明近预算准入，就要求恢复被禁止的 owner 造态。可达服务边界问题保留给 lead，见开放问题。

## 2. OUT OF SCOPE → T

下面是**已能确定**的 T。旧 helper／生产行已对照提供的 diff；明确 T 文件按裁定 §1。旧测试中尚缺 diff 的位置不在这里假装已经判定。

| T | file:line | 留给 T 的原因 |
|---|---|---|
| T-001 | `H/task-claim-fixture.ts:227,233` | 旧 backend seed，非 B3 改行。 |
| T-002 | `H/task-claim-fixture.ts:324` | 旧 Kernel Session 写入。 |
| T-003 | `H/task-claim-fixture.ts:327` | 旧 Host Session 写入。 |
| T-004 | `H/task-claim-fixture.ts:245,248,253` | 旧 materials 替身。 |
| T-005 | `H/S5-decision-fixture.ts:698,707,719,728,736` | 旧手造 prepared／entry 前置。 |
| T-006 | `H/S5-decision-fixture.ts:530` | 旧 seed commit。 |
| T-007 | `H/S5-decision-fixture.ts:541,543` | 旧 Project／Workspace 事实种子。 |
| T-008 | `H/S5-decision-fixture.ts:558,568` | 旧治理事实种子。 |
| T-009 | `H/S5-decision-fixture.ts:572,574` | 旧 Goal 事实种子。 |
| T-010 | `H/S5-decision-fixture.ts:811,816,818` | 旧 candidate 造态。 |
| T-011 | `H/S5-decision-fixture.ts:866,869` | 旧 body 写入。 |
| T-012 | `H/S5-decision-fixture.ts:876,881` | 旧第一组消息事实写入。 |
| T-013 | `H/S5-decision-fixture.ts:886,892` | 旧第二组消息事实写入。 |
| T-014 | `H/S5-decision-fixture.ts:898,903,904,906` | 旧 response 覆写／写入。 |
| T-015 | `H/S5-decision-fixture.ts:630` | 旧 Kernel Session 写入。 |
| T-016 | `H/S5-decision-fixture.ts:632` | 旧 Session record 写入。 |
| T-017 | `H/S5-decision-fixture.ts:715` | 旧 manifest body 写入。 |
| T-018 | `H/S5-decision-fixture.ts:733,739` | 旧 begin-entry 写入。 |
| T-019 | `H/S5-decision-fixture.ts:742,744,745` | 旧 entered/history 写入。 |
| T-020 | `H/K3-review-card-fixture.ts:245,247,248` | 旧假 duties，非 B3 改行。 |
| T-021 | `H/K3-review-card-fixture.ts:305`；`H/executed-files-stub.ts:23,24` | 旧 executed-files 替身及旧注入。 |
| T-022 | `H/K3-review-card-fixture.ts:261,264,270` | 旧 receipt adapter；H/OPEN-3 也不扩成 B3 全文件整改。 |
| T-023 | `H/K3-proposal-round.ts:383,384` | 旧整份 review 参数接口。 |
| T-024 | `H/K3-proposal-round.ts:475,476` | 旧整份 round 参数接口。 |
| T-025 | `H/K3-proposal-round.ts:588` | 旧整份 review 参数接口。 |
| T-026 | `H/K3-proposal-round.ts:620` | 旧整份 review 参数接口。 |
| T-027 | `H/K3-proposal-round.ts:654` | 旧整份 review 参数接口。 |
| T-028 | `H/K3-proposal-round.ts:712` | 旧整份 round 参数接口。 |
| T-029 | `H/K3-proposal-round.ts:754,755,756` | 旧把完整 item 交给回调的接口。 |
| T-030 | `H/K3-proposal-round.ts:807,808` | 旧整份 review 参数接口。 |
| T-031 | `H/K3-proposal-round.ts:705,708,760` | 旧手建 ToolCall／直接 handler 路径；新调用的责任另核。 |
| T-032 | `H/K3-proposal-round.ts:594,595` | 旧手选 settlement cause 实现；B3 新调用点不因此豁免。 |
| T-033 | `H/K3-proposal-round.ts:553` | 旧 settlement cause 参数。 |
| T-034 | `H/K3-proposal-round.ts:910` | 旧无调用的 awaiting-approval 出口。 |
| T-035 | `H/K3-tool-seams.ts:79,85,93` | 旧 shell 替身主体；B3 新分派 `:103` 和新消费者仍在 F-002。 |
| T-036 | `H/K-boundary-facts-support.ts:79` | 旧 append accepted-message；新增范围仅调用点，见第 3 节。 |
| T-037 | `H/K-boundary-facts-support.ts:118` | 旧 append running-tool；同上。 |
| T-038 | `H/S5-application-support.ts:58,59,61,62,68,70` | 旧 store 断言 helper；B3 消费者改用公开读。 |
| T-039 | `H/S5-user-message-support.ts:54,55` | 旧假 duties；`:62` 授权输入已由 A8 撤销。 |
| T-040 | `H/K3-mixed-seams.ts:53,70` | 旧假 edit。 |
| T-041 | `S/support/shell-work-root.ts:38,43` | 旧配置读取覆写。 |
| T-042 | `S/support/review-work-root.ts:49,51` | 旧配置读取覆写。 |
| T-043 | `S/support/process-sandbox-standin.ts:38,59,64` | 旧假 sandbox capability。 |
| T-044 | `S/harness.ts:766` | 旧 token-budget 256 设置。 |
| T-045 | `S/harness.ts:683,684,688` | 旧数据库 invariant 检查。 |
| T-046 | `S/support/restart.ts:159`；`S/harness.ts:358,365,371,374` | 旧 SQL／存储计数路径。 |
| T-047 | `H/WP2-platform-support.ts:579` | 旧 policy commit。 |
| T-048 | `H/S4A-note-fixture.ts:239` | 旧 Kernel Session 写入。 |
| T-049 | `H/S4A-note-fixture.ts:242` | 旧 Session record 写入。 |
| T-050 | `H/B2-execution-fixture.ts:200,211,225,274,277` | 裁定明确 T；手造 prepared 等事实。 |
| T-051 | `H/B2-execution-fixture.ts:220` | 明确 T；手写 manifest body。 |
| T-052 | `H/B2-execution-fixture.ts:291` | 明确 T；手写 begin-entry。 |
| T-053 | `H/B2-execution-fixture.ts:297,301` | 明确 T；手写 entered。 |
| T-054 | `H/B2-runtime-fixture.ts:194,195` | 明确 T；旧 role seed。合法 scripted provider 不算缺陷。 |
| T-055 | `H/B2-runtime-fixture.ts:197` | 明确 T；Session 覆写。 |
| T-056 | `H/B2-runtime-fixture.ts:155` | 明确 T；旧 token-budget 设置。 |
| T-057 | `R/K3-14-record-unknown-call-review-tool.test.ts:195` | K3-14 明确 T；review 覆写。 |
| T-058 | 同文件 `:67` | 明确 T；假 receipt。 |
| T-059 | 同文件 `:111` | 明确 T；假 replay。 |
| T-060 | 同文件 `:117` | 明确 T；假 conflict。 |
| T-061 | 同文件 `:125,126` | 明确 T；另一条 invalid 条件遮住目标检查。 |
| T-062 | 同文件 `:146` | 明确 T；假 control 输入。 |
| T-063 | 同文件 `:212` | 明确 T；假 review reader。 |
| T-064 | 同文件 `:213` | 明确 T；假空页。 |
| T-065 | 同文件 `:216` | 明确 T；假 receipt reader。 |
| T-066 | 同文件 `:229` | 明确 T；从生产工具定义取期望。 |
| T-067 | 同文件 `:202` | 明确 T；后端覆盖缺口。 |
| T-068 | `W/K3-48-2-unknown-call-review-model-text-budget.test.ts:213,235,239` | 裁定明确非 proposal 半部为 T；直接 seed。 |
| T-069 | 同文件 `:250` | 同一 T 半部的假 display reader。 |
| T-070 | `TG/command-recognition.ts:134`；`TG/command-rerun-request-service.ts:786,788` | P/M06 只有 P5，超出本轮 P1/P4。 |
| T-071 | `RT/execution-preparation.ts:260,285` | P/M08 的 review 页数上限，只有 P5。 |
| T-072 | `RT/context-assembler.ts:1387,1407` | P/M08 的 review 页数上限，只有 P5。 |
| T-073 | `RT/context-assembler.ts:1419,1439` | P/M08 的 CRR 页数上限，只有 P5。 |
| T-074 | `TG/command-rerun-request-service.ts:515` | P/M08 的请求页数上限，只有 P5。 |
| T-075 | `WF/decision-actions.ts:481` | 旧通用阶段③异常处理，非 B3 改行。 |
| T-076 | `WF/decision-actions.ts:507` | 旧通用阶段②异常处理，非 B3 改行。 |
| T-077 | `WF/decision-actions.ts:538,546` | 旧 coordinator 阶段①返回路径。新 CRR adapter 的责任留在 F-072。 |
| T-078 | `WF/workflow.ts:1378` | 旧仅 UCR 的恢复入口判断。新 CRR 接线问题在 F-073。 |
| T-079 | `WF/workflow.ts:2813` | 旧 answers 分派位置。 |
| T-080 | `WF/contracts.ts:238` | 旧 `failedReviewRefs` 输入类型。 |
| T-081 | `WF/contracts.ts:272` | 旧 `failedReviewRefs` 输出类型。 |
| T-082 | `src/core/work-graph/state/command-rerun-request.ts:142,249,253` | 旧 open-request helper／类型，非 B3 改行；F-080 可以复用其规则，不扩大清理。 |
| T-083 | `RT/context-assembler.ts:381` | 旧 UTF-8 截断实现。F-083 只处理 B3 新重复。 |
| T-084 | `VR/decision-read-model.ts:280` | P/S10 所指旧通用 readGoal。 |
| T-085 | `VR/decision-read-model.ts:306` | P/S10 所指旧 by-key Goal 读取。 |
| T-086 | `src/app/startup-reconcile.ts:31` | P/S11 旧 import。 |
| T-087 | 同文件 `:35` | P/S11 旧 import。 |
| T-088 | `tests/architecture/production-reach-allowlist.json:1121` | 旧 allowlist 项；不能当 B3 新增项删除。 |
| T-089 | 同文件 `:1127` | 同上。 |
| T-090 | 同文件 `:1133` | 同上。 |
| T-091 | 同文件 `:1139` | 同上。 |

以上为 **91 条 T 记录，162 个不同 file:line，32 个文件**。这不是最终 T 总数；旧测试 diff 可能把第 4 节的部分候选继续移入 T。

## 3. SCOPE ADDITIONS

以下 **31 个文件、33 个调用点**加入范围；只有所列调用加入，不扩成全文审计。

前 30 个调用都归 F-002：

| 文件:行 | 调用 |
|---|---|
| `R/K3-35-review-input-size.test.ts:66` | `shellSeam.definition` |
| `S/K3-05-review-round.test.ts:69` | 同上 |
| `S/K3-06-mixed-batch.test.ts:82` | 同上 |
| `S/K3-08-wait-reply.test.ts:67` | 同上 |
| `S/K3-09-restart-between-calls.test.ts:66` | 同上 |
| `S/K3-10-review-round-cells.test.ts:65` | 同上 |
| `S/K3-11-review-reasons-r2.test.ts:77` | 同上；文件其他内容仍为 T |
| `S/K3-12-14-review-round.test.ts:87` | 同上；不扩大 K3-14 范围 |
| `S/K3-13-two-commands.test.ts:61` | 同上 |
| `S/K3-15-card-hold.test.ts:58` | 同上 |
| `S/K3-16-proposal-round.test.ts:65` | 同上 |
| `S/K3-17-review-answer-shape.test.ts:70` | 同上 |
| `S/K3-18-one-card.test.ts:66` | 同上 |
| `S/K3-19-missing-read-no-round.test.ts:84` | 同上 |
| `S/K3-19-review-unavailable.test.ts:72` | 同上 |
| `S/K3-25-attestation-replay.test.ts:41` | 同上 |
| `S/K3-26-inventory-scenarios.test.ts:150` | 同上 |
| `S/K3-27-review-claim-close.test.ts:83` | 同上 |
| `S/K3-28-attested-continuation.test.ts:56` | 同上 |
| `S/K3-29-disposition-recovery.test.ts:59` | 同上 |
| `S/K3-29-maintenance-review-run.test.ts:64` | 同上 |
| `S/K3-29-recovery-continuation.test.ts:63` | 同上 |
| `S/K3-29-recovery-round.test.ts:76` | 同上 |
| `S/K3-37-stopped-review-round.test.ts:66` | 同上 |
| `S/K3-42-truncated-command.test.ts:71` | 同上 |
| `S/K3-42-unexpanded-r2.test.ts:71` | 同上 |
| `S/K3-44-hold-restart.test.ts:63` | 同上 |
| `S/K3-45-review-incomplete-r2.test.ts:79` | 同上；文件其他内容仍为 T |
| `S/K3-r1-seams.test.ts:71` | 同上 |
| `S/K3-R1-second-cleanup.test.ts:70` | 同上 |
| `S/K-R-attested-facts-source.test.ts:171` | `injectAcceptedMessage`，归 F-013 |
| 同文件 `:309` | `injectRunningToolCall`，归 F-013 |
| 同文件 `:377` | `injectRunningToolCall`，归 F-013 |

最后一个文件不是裁定 T 名单中的 `K-R-close-open-turn`。

## 4. FINDING TABLE

以下是 **97 行候选根因**。共享 helper 的消费者在本节后半完整列出，属于对应根因，不再各建一行。

“完成检查”是将来验收要求，**不是本次已经执行过的检查**。

有三类不能诚实地硬塞进 F1–F12：纯文件隔离、只有 A6 分组／无变化读取缺口、没有历史删减证据的单后端。表中保留真实规则名；不能为了列格式把它们都改叫 F11 或 F12。

### 4.1 共享 helper

| ID／类别 | 实例 | 系统修复及唯一处置 | 完成检查 | 来源 |
|---|---|---|---|---|
| **F-001／F4，兼 F6** | `H/K3-review-card-fixture.ts:139,162,164,200,389,423`；消费者见 C-WORLD、C-RECORD | **helper missing：`H/K3-public-world.ts`。** 用真实项目、工作区、Goal、Plan、Session 公共步骤建立世界，接正式 Kernel command reader、workspace reader、recognizer。`review_unavailable` 必须由缩窄 Host 授权后的 Workflow 产生。旧 S5 种子不在本轮整文件重写；新世界不能继续继承它。现有真实 Kernel reader 可参照 `H/B2-crr-world.ts:206`。 | 默认世界不再返回 map facts／固定 not_found／手造 exact；两后端公开 review、卡片和执行链通过。 | H/D29/D30；G1–G7 |
| **F-002／F4** | `H/K3-tool-seams.ts:103,132,161,168`；消费者见 C-TOOLS 和第 3 节 | **公共路径：修正 `H/K3-tool-seams.ts:103,132`。** gate 包住真实 shell/read/message handler，保留能力声明，放行后执行真实 handler，原样返回结果。不能返回构造 success。 | gate 到达、取消、释放分别有明确屏障；真实工具确实执行；不去掉 `isolated_process`；真实 sandbox 环境验收。 | H/D31–D33；G1–G7 |
| **F-003／F4，兼 F7/F12** | `H/K3-35-continuation-fixture.ts:239,494,545,691,700,711,766,771,889,949`；`B/K3-review-workflow-rows.test.ts:403`；`W/K3-26-unknown-call-review-storage.test.ts:302`；`W/K3-15-disposition-effects.test.ts:185`；`W/K3-18-review-card-queue.test.ts:448`；`W/K3-47-continuation-gate.test.ts:129,147,152,173,179`；其余见 C-HARNESS | **公共路径：修正共享 harness。** 复用 `:637,646,659` 的同一真实 backend/body/platform；提供真实 mailbox 选项和窄公共出口；requeue 使用正式 `claims.requeueTask`；去掉成品 probe 输入，以真实依赖故障得到 probe 结果；去掉 SQLite-only guard；archive/requeue 成功通过公开读取验证。 | RUN-25 两后端；真实 send→yield→reply→consumedWait claim；公开 Run/review/requeue 读取；不得另组第二套 Runtime。 | H/D11–D17、§4/§5；G1–G4、G6/G7 |
| **F-004／F7** | `H/K3-35-prepare.ts:97`；消费者见 C-PREPARE | **公共路径：采用 `H/WP2-platform-support.ts:914,919` 的 prepare＋`materials.openArtifact` 读取形状。** 把实际 prepared 保持在 helper 内，不把 raw body-store read 当验收入口。 | 断言从实际公开 material 读到的 manifest；不调用 raw body-store loader 取断言事实。 | H；G3/G6/G7 |
| **F-005／F2，兼 F4/F6** | `H/K3-proposal-round.ts:428,571,874`；`B/K3-review-workflow-rows.test.ts:338,339`；`R/B2-02-approved-method.test.ts:51`；`W/B2-01-task-read.test.ts:50`；`W/B2-09-crr-owner.test.ts:70`；`W/B2-12-recognition.test.ts:199`；`W/B2-18-request-reads.test.ts:78`；`W/K3-16-approval-application.test.ts:135,174`；`W/K3-16-proposal-write.test.ts:63`；`W/K3-16-second-unfinished-proposal.test.ts:80`；`W/K3-47-claim-gate.test.ts:94`；`W/K3-48-3-required-writes.test.ts:71`；调用集合见 C-PROPOSAL | **helper missing：共享真实 review/proposal 流程。** 初始 Host 配置直接设置权限；真实 prepare 的 display 进入 settlement；能力不可用由 Host 缩权＋Workflow advance 产生；proposal 由真实 proposal Run 的脚本模型调用工具。只收公开标识、命令、理由和脚本回复。旧接口债仍在 T。 | 公开 needs_decision→safer_method→proposal Run→真实工具→settlement；display 与实际 manifest 相同；无读后覆盖、手选不可用原因、直接 handler。 | H/D25–D28；G1/G2/G3/G5/G6/G7 |
| **F-006／F1，兼 F3/F4/F7** | `H/B2-blocked-runtime.ts:95,169,248,260,268,325,413,424`；`R/B2-02-recognition-unified.test.ts:149`；`R/B2-16-hook-reads.test.ts:196`；`R/B2-05-06-denial.test.ts:40,73,92`；`R/B2-16-hook-closure.test.ts:118`；调用见 C-B2 | **helper missing：真实 B2 工具运行链。** 文件写进真实 root；claim→Runtime prepare/start→脚本模型发真实工具；binding 取平台实际 prepared 结果并在 helper 内使用。下一次消费必须来自真实新 Run／新调用；不手调 hook，不构造 entered，不读 event 当断言。 | denial、allowance、closure、重放分别通过真实工具保护；消费提交失败时真实 shell 不进入；公开请求状态正确。 | H/D03–D06；G2/G5 |
| **F-007／F4，兼 F1/F10** | `H/B2-401-world.ts:177,219,225,277`；`R/B2-401-world.test.ts:43,56,79,81` | **公共路径：修正 `openB401World`。** 真实文件、真实 Runtime binding、真实 request tool；工厂收 backend。保留 v2 已允许的公开 entered 轮询。 | 两后端；401 个不同对象确实跨页；最后一页影响答案；在整次公开工具调用外计数。 | H/D01；G2 |
| **F-008／F6，兼 F3/F7/F8** | `H/B2-crr-world.ts:165,193,216,234,239`；`W/B2-07-crr-card.test.ts:71,101,135,162`；调用见 C-CRR | **公共路径：修正 B2 CRR helper。** unavailable 经真实 Host＋Workflow；request 在真实接续 Work Run 中由模型工具发出；Run 用公开 execution 读取；单条前置的预期写死为 1。 | 真实请求／答复／消费链；不伪装已结束 Run 的 principal；不使用 store Run snapshot；独立 blocked 数量断言。 | H/D07/D08；G1/G4/G5 |
| **F-009／F2，兼 F4/F6/F9** | `H/K3-blocked-command-fixture.ts:146,165,350,367,406,416,549`；`R/K3-review-preparation.test.ts:608`；调用见 C-BLOCKED | **公共路径：重做该 helper 的公开运行链。** 初始 Host 配置、真实 mailbox、真实磁盘 reader；内部调用计数等待改为 A3 gate；真实不可用结算；`startPrepared` 改成只收 Run 标识，helper 内真实 prepare/start。 | 不接收 prepared 值；不轮询内部 calls；真实文件改变能改变识别；拒绝后公开状态不变。 | H/D19–D21；G2/G3/G5 |
| **F-010／F4** | `H/K3-crr-fixture.ts:121,154,157,158,160`；调用见 C-CRR-FIXTURE | **公共路径：使用修正后的 F-003 harness。** 真实文件 reader、真实 root/capture、真实 mailbox；公开 requeue→claim→prepare/start。 | 同一世界内真实工作树 digest；下一 Run 真 entered；两后端 request/form 行通过。 | H/D22/D23；G2/G3/G5 |
| **F-011／F4，兼 A1 参数限制** | `H/K3-prefix-claim.ts:93,96,97,99,122`；调用见 C-PREFIX | **公共路径：使用 F-003 harness 的 requeue。** 参数收 Run/ref 等公开标识，helper 内读取所需状态；消除假 root、digest、materials、messages。 | 前缀／foreign Task／alias 行均通过真实 Run；唯一前缀判定不依赖构造 Run。 | H/D24；G2/G5 |
| **F-012／F4** | `H/S1-public-anchor.ts:45,50`；调用 `H/K3-35-continuation-fixture.ts:502` | **公共路径：修正 `failingChangedFilesReader`。** 包住真实 execution/Kernel/workspace 依赖，只在命名读取点注入失败；archive 继续通过公开 request/drive。 | 故障确实命中；非故障方法真实委托；公开 anomaly/requeue 结果可读。 | H/D34；G3 |
| **F-013／F3** | `S/K-R-attested-facts-source.test.ts:171,309,377` | **helper missing：`H/K3-public-boundary-steps.ts`。** 真实 mailbox send→Runtime 接收得到 accepted；脚本模型发真实工具，在实际入口用 gate 得到 running。旧 append helper 留 T。 | 三调用都不再 append Kernel store；被断言的位置来自真实 Kernel/Runtime 产生的记录。 | H/D09/D10、§3 |
| **F-014／A5 默认拒绝** | `H/K3-35-continuation-fixture.ts:181`；`H/K3-35-required-review-block.ts:10`；`R/K3-15-blocked-omission.test.ts:56`；`R/K3-15-blocked-sentence.test.ts:39`；`R/K3-35-renderer-boundary.test.ts:48`；完整消费者见 C-PURE | **纯测试处置：提取 `H/K3-continuation-pure-fixture.ts`**，只含纯构造、纯 assembler 和常量。消费者迁到对应 `*-pure.test.ts`。 | D3＋人工 import 闭包核对，无 platform/store/Runtime/Workflow/stub port。混合生产模块出口边界见 Q-04。 | H/A5；G2/G3 |

### 4.2 测试自身的装配、断言和行为缺口

| ID／类别 | 每个实例 | 系统修复及唯一处置 | 完成检查 | 来源 |
|---|---|---|---|---|
| **F-015／F4，兼内部输入越界** | `B/K3-15-ur3h.test.ts:120,127`；`B/K3-46-review-advance-failures.test.ts:199,209,216,246,554,566,728`；`B/K3-UR7-crr-failed-set.test.ts:209,238,248,255,302,393,394,490,504`；`B/K3-review-workflow-rows.test.ts:158,169,176,223,235,242,281,733,736,743,744,746,749,759,776,788,898,990,1135,1147,1159` | **helper missing：`workflowOfPublicWorld`。** 从 F-001/F-003 的正式平台取 Workflow、Runtime、evidence、checks、goalSettings、mailbox；观察只包 A3。failed-card 集合由真实 driver 保留并传递，不能测试手塞第三参数。`performWorld`、`answersWorld` 全部迁往此路径。 | 真实 select/perform/driver；无 unsupported/空成功/缓存消息替身；真实 other-source 卡答复证明 UR7b；两后端。 | G1/F4、默认拒绝；rulings §3.6 待解释 |
| **F-016／F4** | `A/K3-15-review-routes.test.ts:66`；`B/K3-41-release-hold.test.ts:331`；`B/K3-46-review-advance-failures.test.ts:389` | **公共路径：真实 platform route bindings。** 不用 Proxy 为未提供端口构造 unsupported。 | 公开路由调用实际 owner；观察 wrapper 原样返回。 | G1/F4-01/08/13 |
| **F-017／F4** | `A/K3-15-review-routes.test.ts:81,83`；`B/K3-15-ur3h.test.ts:107,110`；`B/K3-41-release-hold.test.ts:373`；`W/K3-15-hold-release.test.ts:159,162`；`W/K3-26-unknown-call-review-storage.test.ts:852,855`；`W/K3-43-continuation-vs-hold.test.ts:133`；`W/K3-47-claim-gate.test.ts:140,143` | **公共路径：F-003 的公开 requeue。** 使用真实 `VerificationWorkspaceReader.captureDigest` 和真实 mailbox；已有真实 capture 委托例在 `B/K3-41-release-hold.test.ts:365,371`。 | 文件改变导致真实 digest 改变；消息存在／不存在均由实际 mailbox 得出。 | G1/G6/G7；rulings §3.4 |
| **F-018／F4** | `W/K3-06-mixed-kinds-owner.test.ts:100`；`W/K3-15-hold-release.test.ts:230,233`；`W/K3-26-unknown-call-review-storage.test.ts:216`；`W/K3-43-continuation-vs-hold.test.ts:235`；`S/K3-29-startup-reconcile-2b.test.ts:215,243`；`S/K3-20-review-card-paging.test.ts:273,283` | **公共路径：正式 read model。** display 来自真实 prepared；空卡来自实际空状态；taskProjection 失败用包住真实 reader 的 A2 故障。 | 正常读真实委托；故障点被触发；不能通过缺依赖或假空结果得到预期。 | G4/G6/G7 |
| **F-019／F4** | `R/K3-35-T-by-hand.test.ts:58,60`；`R/K3-35-approved-methods-brief.test.ts:28`；`S/B2-09b-allowance-crash.test.ts:64`；`S/K3-16-approval-round.test.ts:56`；`S/K3-29-startup-variants.test.ts:57`；`W/K3-18-review-card-queue.test.ts:62,72`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:48,58` | **公共路径：真实 ProcessSandbox 能力。** 在有 bwrap 的环境执行；需要不可用时缩窄 Host 授权或包装真实 probe 失败。 | 不 mock available／执行成功；真实 capability 和真实只读执行生效。 | G3/G4/G6/G7；SPEC 冲突 |
| **F-020／F4** | `S/K3-29-startup-answers.test.ts:85,90,101`；`S/K3-29-startup-reconcile-2b.test.ts:172,177,188`；`S/K3-44-crr-kind4.test.ts:52,54,56,57,62,65` | **helper missing：正式 startup→Workflow 世界。** Session、Goal、answers、readers 都来自平台；空结果通过真实空世界产生。 | restart/启动读取真实保存答复；②／③重驱次数和公开 revisions 正确。 | G4 |
| **F-021／F4** | `R/B2-02-recognition-unified.test.ts:103`；`R/B2-16-hook-reads.test.ts:133`；`W/B2-11-expansion-levels.test.ts:31`；`W/B2-11-script-expansion.test.ts:26`；`W/B2-12-recognition.test.ts:159,171,183,228`；`W/B2-09-crr-owner.test.ts:130`；`W/B2-18-request-reads.test.ts:112,114,146,148` | **helper missing：真实文件展开路径。** 把输入文件写进世界 root，正式 workspace reader 读取；计数／故障只包真实 reader。 | 嵌套目录、缓存、截断、失败均由真实文件触发；不构造 WorkspaceFile。 | G2/G5 |
| **F-022／F3，兼 F11** | `W/B2-09-crr-owner.test.ts:171,230,248,253,382` | **helper missing：真实答复后消费。** 公开卡片答复保存消息，脚本模型实际发 shell，由正式 hook 消费 allowance；在消费 commit 上注入失败。 | usedBy 来自实际调用；commit 失败时真实 handler 零进入；公开 allowance 不变。 | G5/F3/F11-08 |
| **F-023／F2，兼 F8** | `W/B2-07-crr-card.test.ts:124,126,131,148,157,159,167` | **纯测试：`W/B2-07-crr-card-pure.test.ts`，测 `commandRerunRequestCardFacts`／summary。** 构造时间和旧请求只作为纯函数输入，期望独立。 | earlier 五条、过滤、顺序和全文断言；同时间规则等 Q-07 冻结。 | G5 |
| **F-024／F7** | `W/B2-08-crr-answer.test.ts:72`；`W/B2-09-crr-owner.test.ts:238` | **纯测试：`W/B2-command-rerun-request-event-pure.test.ts`，测对应 event 编解码。** 服务行只验公开状态。 | proof/usedBy 事件形状由纯 codec 行保护；服务断言不读 event store。 | G5 |
| **F-025／F7** | `B/K3-17-goal-guard.test.ts:102`；`B/K3-46-review-advance-failures.test.ts:339`；`B/K3-41-release-hold.test.ts:527,537,544,577,584`；`B/K3-review-workflow-rows.test.ts:1056,1058,1060`；`R/B2-04-allowance.test.ts:58`；`R/K3-review-preparation.test.ts:572,593`；`S/K3-29-startup-variants.test.ts:119,165`；`S/K3-44-recovery-answers.test.ts:237,254,287,315`；`W/K3-15-hold-release.test.ts:177,189`；`W/K3-16-approval-application.test.ts:307,365`；`W/K3-16-proposal-write.test.ts:110`；`W/K3-18-review-card-queue.test.ts:126`；`W/K3-26-unknown-call-review-storage.test.ts:785,805,889,913`；`W/K3-41-disposition-proof.test.ts:72,90,133,136`；`W/K3-43-continuation-vs-hold.test.ts:207,252`；`W/K3-43-review-claim-vs-hold.test.ts:115`；`W/K3-47-claim-gate.test.ts:242,295,306,320`；`W/K3-47-continuation-gate.test.ts:212` | **helper missing：公共状态快照／运行历史读取。** 调 `plans.queryGoal/queryTaskGraph`、公开 execution/review/message/requeue read；历史通过实际 history owner。已有 Task 读法在 `W/K3-18-autonomy-facts.test.ts:119`，历史读法在 `H/K3-35-continuation-fixture.ts:850`。 | 每项原业务断言保留；无 DB、canonical facts、raw event、raw body 断言。 | G1–G7 |
| **F-026／F8** | `B/K3-46-review-advance-failures.test.ts:498`；`B/K3-review-workflow-rows.test.ts:578`；`R/B2-02-recognition-unified.test.ts:203`；`R/B2-04-allowance.test.ts:80`；`R/B2-09-allowance-crash.test.ts:53`；`R/B2-16-hook-reads.test.ts:218`；`S/B2-09b-allowance-crash.test.ts:112,146,218`；`S/K3-16-approval-round.test.ts:163`；`S/K3-20-review-card-paging.test.ts:120,241`；`W/B2-01-blocked-commands.test.ts:77,110,130,169,170`；`W/B2-01-task-read.test.ts:93`；`W/B2-03-crr-request.test.ts:89`；`W/B2-07-crr-card.test.ts:51,58,59,60,97`；`W/B2-09-crr-owner.test.ts:278,285`；`W/B2-12-rewrite-prefix.test.ts:71,73`；`W/B2-14-crr-forms.test.ts:76,92,93`；`W/K3-16-approval-application.test.ts:214,215`；`W/K3-26-unknown-call-review-storage.test.ts:355` | **公共路径处置：保留修正后的真实链，替换为规格字面量／手算例子。** hash 输入、排序窗口、source key、错误文字不得再调用被测生产规则或复制输出。 | 改变生产常量／key／排序／digest 规则会使独立预期失败。审批 label 的独立出处先由 Q-10 冻结。 | G1–G7 |
| **F-027／F8** | `R/K3-19-review-admission-pure.test.ts:38,67,73,91,97`；`R/K3-26-unknown-call-review-pure.test.ts:159`；`ST/command-normalization.test.ts:47,48`；`ST/command-rerun-request.test.ts:144,287,290` | **纯测试处置。** 前两文件保留；后两迁到 `ST/command-normalization-pure.test.ts`、`ST/command-rerun-request-pure.test.ts`。测 admission、card key、`commandSha256`、new/transition；固定独立 key/hash/九种 form 预期。 | 不再用同一个生产 formatter/hash/常量生成 actual 与 expected。 | G2/G5 |
| **F-028／F10** | `R/B2-03-request-tool.test.ts:69`；`R/B2-15-replay.test.ts:161`；`R/B2-401-world.test.ts:81`；`W/B2-07-crr-card-closed.test.ts:140`；`W/B2-18-request-reads.test.ts:94` | **helper missing：一次公开操作的计数窗口。** 在真实 request tool／公开卡片操作外重置并结束 A3 计数，包含该操作全部下游读取。 | 内层重复读、额外 lookup、最后一页都计入；R=0 上界等 Q-08。 | G2/G5 |
| **F-029／F5** | `R/B2-02-recognition-unified.test.ts:228` | **公共路径：真实第二次工具调用。** 用新 callId／真实原因触发，取消无新原因重发 hook。 | 每次真实调用只识别一次；合法 replay 单独走真实 Kernel 路径。 | G2/F5 |
| **F-030／F11** | `R/B2-01-shell-hook.test.ts:85` | **公共路径：拆成真实 unparsed 与 all-irrelevant 两个命令例子。** 每个只命中目标 fallback。 | 两例都精确保留一个 whole-normalized action；不能用普通 command 顶替。 | G2/F11 |
| **F-031／F11** | `R/B2-02-recognition-unified.test.ts:122` | **公共路径：A8 时钟造不同 createdAt，ID 顺序故意反向。** | 删除按时间排序后失败，不能被相同时间／相同 ID 排序掩盖。 | G2/F11 |
| **F-032／F11** | `R/B2-401-world.test.ts:50`；`W/K3-15-list-by-task.test.ts:54,84`；`S/K3-20-review-card-paging.test.ts:137,165` | **公共路径：真实分页反例。** 401 个不同对象，最后页参与结果；同 Task 多记录并含其他 Task；Goal B 竞争在同一次公开查询窗口内以 gate 发生。 | 删除跨页、Task 过滤或一致性重试中的目标检查会改变结果；避免单项／空数组 vacuous pass。 | G2/G4/G6 |
| **F-033／F11** | `R/K3-19-review-admission.test.ts:61,76` | **公共路径：实际 review/proposal 状态后缩窄 Host 只读授权，再推进 Workflow。** | 不可用／proposal-missing 分支分别命中，零模型调用；memory/SQLite。 | G2；rulings §3.5 |
| **F-034／F11** | `S/K3-29-startup-reconcile-2b.test.ts:267` | **公共路径：先形成 held activeRound，再结束该 Run。** | 场景只由 kind 2 命中，kind 1 不能同时解释通过。 | G4 |
| **F-035／F11** | `S/K3-44-crr-kind4.test.ts:95`；`W/B2-UR7-crr-answer.test.ts:49` | **公共路径：保存真实答复后走 startup＋Workflow advance。** 不以直接 coordinator 调用代替入口。 | 真实选择并执行②／③；重驱一次；公开请求、消息、application revisions 不重复增加。 | G4/G5 |
| **F-036／F11／A6** | `A/K3-15-review-routes.test.ts:151`；`B/K3-46-review-advance-failures.test.ts:635,671`；`B/K3-UR7-crr-failed-set.test.ts:546`；`B/K3-review-workflow-rows.test.ts:588,594,596`；`W/B2-03-crr-request.test.ts:160`；`W/B2-08-crr-answer.test.ts:110`；`W/B2-09-crr-owner.test.ts:193,214`；`W/B2-12-rewrite-prefix.test.ts:104,134,156,172`；`W/B2-14-crr-forms.test.ts:98`；`W/K3-06-mixed-kinds-owner.test.ts:212`；`W/K3-15-list-by-task.test.ts:75`；`W/K3-16-proposal-write.test.ts:160,171,172,173,174,175,176,235`；`W/K3-16-approval-application.test.ts:465`；`W/K3-26-unknown-call-review-storage.test.ts:380,436,450,464,478,493,502,638` | **公共拒绝路径。** 每行放 `describe('rejects: …')`，真实前置、一个错误、精确拒绝、紧随其后的公开 unchanged。关闭卡使用新 revision 和其余有效 pins；33-item／wrong-kind 不再附带 unreadable；513-byte 不再同时遗漏另一个 recorded callId。 | 单删目标检查会失败；拒绝前后公共状态逐行相同。仅分组或 unchanged 缺口不冒称已经证明 F11。 | G1/G5/G6/G7；H/A6 |
| **F-037／F11** | `W/B2-11-expansion-levels.test.ts:169,176` | **纯测试：`W/B2-11-blocked-commands-bytes-pure.test.ts`，测 `TG/unknown-call-review-service.ts:106` 的 `blockedCommandsBytes`。** 每例只改变一个字段，预期为手算精确字节差。 | 每个字段遗漏都会失败；不一次改变多个字段只验总量。 | G5 |
| **F-038／F11／默认拒绝** | `W/B2-17-disposition-reads.test.ts:62`；`W/B2-08-crr-cancel.test.ts:67,68`；`S/K3-44-crr-kind4.test.ts:102`；`A/K3-15-review-routes.test.ts:125`；`B/K3-15-ur3h.test.ts:221,300`；`B/K3-46-review-advance-failures.test.ts:751`；`S/K3-29-startup-reconcile-2b.test.ts:196`；`W/K3-receipt-replay.test.ts:103` | **删除。** 分别是两世界不能证明单次 per-command budget、常量自证、冗余内部 predicate／配置表检查、已移除内部参数、空 startup 纯桩、独立 decoder 伪服务覆盖。业务保护由对应公开路径行承担。 | D1 每个删除逐项关联本行；公开行为覆盖仍在，不把被删内部自证记为验收。 | G1/G4/G5/G7 |
| **F-039／F11** | `R/K3-15-blocked-sentence.test.ts:141` | **纯测试：`R/K3-15-blocked-sentence-pure.test.ts`，测 `renderContinuationBriefZh`。** 用完整固定旧文字替代输出自比。 | 固定句或布局被改会失败。 | G2 |
| **F-040／F11** | `W/K3-18-review-card-queue.test.ts:195,197,214` | **公共路径：实际发送暂停请求，并公开设置 `every_step`。** 当前 `:197` 只生成请求体；正式控制 helper 在 `S/support/control.ts:106`。 | 公开读确认 Goal 已暂停、autonomy 正确，再执行被测 advance。 | G6 |
| **F-041／F11** | `W/K3-26-unknown-call-review-storage.test.ts:593` | **公共路径：共享 RUN-25 的真实合并提交处注入一次失败。** | 失败后公开 Run/review 均无部分提交；重试后两者一起出现；两后端。仅最终两个对象存在不算通过。 | G7/F11-04；H §4 |
| **F-042／F11** | `W/K3-47-claim-gate.test.ts:254,267,276` | **公共路径：完整 requeue→claim。** absent 例必须成功；pending busy 例公开状态不变；人类 requeue 成功后继续用实际 requeueRef claim 并命中 review 门。 | 三条各守自己的结果，不能以任意 rejected 或只测 requeue 代替。 | G7 |
| **F-043／F11** | `W/K3-47-reader-facts.test.ts:159,169` | **公共路径：继续用同文件 `:85` 的 `taskRow` 查询。** 加完整 `automation.verdict` 独立预期。 | 删除 AV-2b 判断会失败；仅 facts unreadable 不算覆盖。 | G7 |
| **F-044／F11** | `B/K3-41-release-hold.test.ts:105,242,269,257,286,299,311` | **helper missing：真实 paused-shell review Host。** 真 shell 在途→unknown→review→hold；release 的指定提交边界真实崩溃；重启后同请求重放。 | 符合规格的 shell／崩溃顺序；公开 continuation 精确一次；pause 不冒充 crash。 | G1 |
| **F-045／F11** | `B/K3-15-ur3h.test.ts:245`；`B/K3-review-workflow-rows.test.ts:856,1062` | **公共路径：补齐目标操作的完整窗口。** 真 perform cancel→公开 cancelled→settle；真实完整 receipt 各字段保持；“不重复写”基线在第一次目标操作之前取得。 | 删除取消执行、receipt 字段传递或③幂等保护会失败。 | G1 |
| **F-046／A5，兼 F8** | `R/K3-35-renderer-boundary.test.ts:117,133,144,160`；`R/K3-review-preparation.test.ts:122,149,163,178,418,432`；`W/B2-12-recognition.test.ts:87`；`W/K3-15-disposition-effects.test.ts:264,303,313,325,345,355,365,409,416`；`W/K3-18-review-card-queue.test.ts:301,311,321,337,354,358,361,368`；`W/K3-18-requeue-confirmed.test.ts:137,150,153`；`W/K3-26-unknown-call-review-storage.test.ts:138,142,149,168,171`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:405` | **纯测试迁移，目标唯一对应如下。** renderer→`R/K3-35-renderer-boundary-pure.test.ts`；review build/render/fit→`R/K3-review-input-pure.test.ts`；recognizer 无 I/O 行→`W/B2-12-recognition-pure.test.ts`；disposition assembler/render/codec→`R/K3-15-disposition-effects-pure.test.ts`；card facts/options/targets→`R/K3-18-review-card-pure.test.ts`；confirmation predicate→`R/K3-18-requeue-confirmed-pure.test.ts`；codec→`R/K3-26-unknown-call-review-codec-pure.test.ts`；budget state/admission→`R/K3-48-2-proposal-budget-pure.test.ts`。 | D3；独立字面量；nullable 结果先明确断言非空，不用条件分支绕过断言。 | G3/G5/G6/G7 |
| **F-047／F2** | `W/K3-26-unknown-call-review-storage.test.ts:800` | **公共故障路径：复用 `W/K3-47-reader-facts.test.ts:75` 的真实 reader 包装形状。** 不改已编码 JSON。 | 故障实际命中；通过公开 `queryTaskGraph` 检查 unreadable/automation。 | G7 |
| **F-048／F4** | `W/K3-receipt-replay.test.ts:28,115,129,130` | **helper missing：真实 owner receipt 重放。** 真 owner 提交得到 receipt；读故障只包真实依赖；legacy Note 通过公开 Note 创建及重放。 | 重放 revision/cursor/结果保持；故障真实触发；无九组构造 receipt 端口。 | G7 |
| **F-049／F3** | `B/K3-review-workflow-rows.test.ts:141`；`S/K3-29-startup-reconcile-2b.test.ts:152`；`W/K3-18-requeue-confirmed.test.ts:86` | **公共路径：真实 Host reconcile／Goal control。** 不直接写 Session health 或内部 Goal control。 | 通过公开状态确认 health/control 变化，随后执行被测操作。 | G1/G4/G6 |
| **F-050／F2** | `W/B2-08-crr-cancel.test.ts:60` | **公共路径：重新读当前卡，使用实际 source/pins。** | 旧 key／新 key 行分别使用实际版本，不能 spread 改来源。 | G5 |
| **F-051／F4** | `W/K3-18-review-card-queue.test.ts:389,412,474` | **公共路径：同一真实工作区把文件 A 改为 B。** 使用真实 mailbox/duties、capture 和公开卡。 | 旧批注拒绝→重读→新 objectKey 批注成功；成功缺口另见 F-058。 | G6 |
| **F-052／F4** | `W/B2-09-crr-owner.test.ts:121,143` | **公共路径：真实 Plan disposition 导致 Task closure。** 失败例只包装正式 closure reader。 | 关闭、supersede、故障均由实际前置产生，不修改布尔 closure 变量。 | G5 |
| **F-053／F11** | `W/K3-48-3-required-writes.test.ts:70` | **公共路径保留并改名为 UCR-07。** 当前前置是 pending_review，不能登记为 UCR-08c。 | 名称／验收登记与 `SPEC:1259` 一致；UCR-08c 的 awaiting_proposal/proposal_missing 不被虚报覆盖。 | G7/F11-12 |
| **F-054／逐行后端要求** | 见下方“F-054 后端实例清单” | **公共路径：参数化 memory/SQLite。** 使用修正后的共享世界；没有真实 Host restart 理由的单后端全部补齐。已有单后端不等于历史 F12。 | 每个服务行为在两后端各执行；明确纯行不扩后端；真正 restart 专属例保留理由。 | G1–G7；H；rulings §3.2/§3.5 |

**F-054 后端实例清单：**

- `B/K3-UR7-crr-failed-set.test.ts:355,401,446,465,542`；`B/K3-review-workflow-rows.test.ts:521,796,809,820,845`。
- `R/B2-01-shell-hook.test.ts:34`；`R/B2-02-approved-method.test.ts:43`；`R/B2-02-recognition-unified.test.ts:76,127`；`R/B2-03-request-tool.test.ts:26`；`R/B2-04-allowance.test.ts:29`；`R/B2-05-06-denial.test.ts:30`；`R/B2-09-allowance-crash.test.ts:41,65`；`R/B2-13-allow-one-form.test.ts:30`；`R/B2-15-replay.test.ts:121,165`；`R/B2-16-hook-closure.test.ts:50`；`R/B2-16-hook-reads.test.ts:63`。
- `R/K3-12-review-round-tools.test.ts:230†`；`R/K3-19-review-admission.test.ts:48`；`R/K3-35-T-by-hand.test.ts:102,155`；`R/K3-35-approved-methods-brief.test.ts:83`；`R/K3-35-workspace-baseline-prepare.test.ts:179†`；`R/K3-review-preparation.test.ts:333,376,496,507,528†`。
- `R/S3-context-assembler.test.ts:618,629,727,753,794,813,826†`；`R/S4C2-assembly.test.ts:418†`。
- `S/K3-44-crr-kind4.test.ts:33`。
- `W/B2-01-blocked-commands.test.ts:93,114,139,148`；`W/B2-03-crr-request.test.ts:80`；`W/B2-07-crr-card-closed.test.ts:41,64,99`；`W/B2-07-crr-card.test.ts:40`；`W/B2-08-crr-answer.test.ts:58,88,102`；`W/B2-08-crr-cancel.test.ts:33`；`W/B2-09-answer-replay.test.ts:29`；`W/B2-09-crr-owner.test.ts:66`；`W/B2-12-recognition.test.ts:195`；`W/B2-12-rewrite-prefix.test.ts:53`；`W/B2-14-crr-forms.test.ts:68`；`W/B2-17-disposition-reads.test.ts:37`；`W/B2-18-request-reads.test.ts:70,138`；`W/B2-UR7-crr-answer.test.ts:32`。
- `W/K3-15-disposition-effects.test.ts:150`；`W/K3-26-unknown-call-review-storage.test.ts:158`。
- `H/B2-401-world.ts:177` 的固定 SQLite 随 F-007 修，不重复建立后端根因。
- `H/K3-35-continuation-fixture.ts:889` 的历史新增 SQLite-only guard 随 F-003 修，并保留其 F12 性质。

### 4.3 断言削弱

| ID／类别 | 实例 | 唯一处置 | 完成检查 | 来源 |
|---|---|---|---|---|
| **F-055／F12** | `W/K3-15-hold-release.test.ts:220`；`W/K3-16-approval-application.test.ts:240,334,387,410,426,458,471`；`W/K3-16-proposal-round-fixture.test.ts:119,135,166,218,246,270`；`W/K3-16-proposal-write.test.ts:151,164,187,201,249`；`W/K3-18-autonomy-facts.test.ts:154,169,191`；`W/K3-18-review-card-queue.test.ts:494`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:403`；`W/K3-48-3-required-writes.test.ts:109` | **公共路径修复后恢复原 timeout。** D1:33–50 的 18 项新增 timeout 撤回；D1:53–59 的七项恢复原 120,000ms。不包括 R6 明确授权的 K3-35 hooks。 | D1 不再有这 25 项未授权延长；测试在原时限内完成。 | G6/F12-T01–T23；G7/F12-03/04 |
| **F-056／F12** | `R/K3-06-mixed-kinds-pure.test.ts:114,166,179`；D1:154,171,174,186,187 | **纯测试：该文件的 `newUnknownCallReview`／`transitionUnknownCallReview`。** 恢复 contained、创建／定稿后双 alias 顺序、argumentsDigest、定稿 kind 保留。 | 五个旧义务逐项有独立输出断言；不恢复 owner 多条目造态。 | G6/F12-D01–D05 |
| **F-057／F12** | `W/K3-15-disposition-effects.test.ts:313`；D1:194,200,202,203 | **纯测试：`R/K3-15-disposition-effects-pure.test.ts`。** 测 assembler/renderer；先断言各行存在，再断言作用对象→平台条目→固定提醒顺序。 | 四项旧义务承接，不能用 `indexOf(-1)` 比大小自证。 | G6/F12-D06/D08–D10 |
| **F-058／F12** | `W/K3-15-disposition-effects.test.ts:298,383`；`W/K3-18-review-card-queue.test.ts:483,485`；D1:199,204 | **公共路径：真实文件故障／capture／卡答复。** 恢复无目标卡 rerun 固定行、`workspace.status='captured'`，以及新摘要批注成功。 | 拒绝→重读→通过完整三段；公开 review 保留 captured。 | G6/F12-D07/D11/D22；R6:60,61 |
| **F-059／F12** | `R/K3-16-review-extremes-pure.test.ts:94`；D1:213,214,225–229 | **纯测试：`R/K3-16-targets-pure.test.ts`，测 `newUnknownCallReview`。** 验证 proposal/disposition targets 是输出推导，不手填期望目标集合当输入。 | 两个 process＋平台条目：目标数量、平台包含／排除、kind 保留逐项正确。 | G6/F12-D12/D13/D15–D19 |
| **F-060／F12** | `R/K3-16-review-extremes-pure.test.ts:117`；D1:219 | **纯测试：该文件测 `unknownCallReviewSummary`。** 使用混合条目，恢复摘要最后的混合提示。 | 完整独立后缀断言。 | G6/F12-D14 |
| **F-061／F12** | `R/K3-16-review-extremes-pure.test.ts:198`；`W/K3-16-proposal-write.test.ts:244`；D1:235,245 | **纯测试：`R/K3-16-proposals-pure.test.ts`，测 `transitionUnknownCallReview` 的 `proposal_recorded`。** | 保存 12 个 proposals，保存数组按 alias 排序；不能以 12 items 或 renderer 排序替代。 | G6/F12-D20/D21 |
| **F-062／F12** | `R/K3-35-manifest-trim-pure.test.ts:275,288,289,372,386,397,401,413,415`；D1:315,316,323–327,340,341 | **纯测试：该文件的 build/fit/render。** 恢复两个独立超限前置、toolName、保留行文字、unexpanded 固定句、command 非 null/truncated，以及整份 manifest 排除 callId。 | 各旧断言逐项恢复；“至少一个预算超限”和“只看 rendered/fitted 子对象”不算等价。 | G7/F12-07–13/17/18 |
| **F-063／F12** | `W/K3-35-owner-manifest-trim.test.ts:58,62`；D1:300,342 | **公共路径：真实单项 review prepare＋公开 material 读取。** | 平台产生的 argumentsDigest 格式正确；真实 manifest input 与 review render 的两换行拼接关系仍被验到。 | G7/F12-05/19 |
| **F-064／F12** | `W/K3-35-owner-manifest-trim.test.ts:58`；D1:301 | **纯测试：`R/K3-26-unknown-call-review-codec-pure.test.ts`，测 `unknownCallReviewBodyProblem`。** | summary command 的 512/513 边界分别接受／拒绝。 | G7/F12-06 |
| **F-065／F12** | `R/K3-35-approved-methods-brief.test.ts:116,118,119,167,171`；`R/K3-35-renderer-boundary.test.ts:78,144,150,155,156,157,163,165`；`R/K3-35-T-by-hand.test.ts:159`；对应 D1 见第 5 节 | **纯测试：`R/K3-35-renderer-boundary-pure.test.ts`，测完整 `renderContinuationBriefZh`。** 恢复八锚点、长原因、16 位省略数、T512/T600、完整必需文字、whole-output callId 排除及精确字节算例。 | 不以 `requiredReviewBlock` 子串相等代替完整输出；16396、704 等原手算关系按原义承接。 | G3/F12；H requiredReviewBlock |
| **F-066／F12** | `R/K3-35-T-by-hand.test.ts:166,168`；D1:136,137,433 | **helper missing：合法公开 T600 容量链。** 真实形成八个实际渲染锚点及规格要求的其他前置，再通过 Runtime prepare 验 capacity。 | 真实服务拒绝且不删必需内容。当前 12,764 字节 ready 不能代替原拒绝义务；此行等待 Q-06。 | G3/F12、Q2 |
| **F-067／F12，兼 F11** | `W/K3-48-2-unknown-call-review-model-text-budget.test.ts:374,388,392,399`；D1:23,27,367–370,479 | **helper missing：真实公开 near-budget proposal 前置。** 用合法标识、真实文件/capture/历史形成精确 `B−2000`；真实 proposal 工具或公开 owner 写入。 | 两后端；精确前置；capacity；公开读回逐字节不变；同一前置缩短理由后接受。当前远低于预算的成功不算。 | G7/F11-10、F12-01/02/14–16 |
| **F-068／F12，兼 F8** | `B/K3-15-ur3h.test.ts:241`；D1:70 | **公共路径：保留真实创建，预期恢复为输入手算的 `['k3-15-ur3h-call-1']`。** 输入在同文件 `:208`。 | 不从 `created.items` 生成 targets 预期。 | G1/F8-01、F12-01 |

### 4.4 生产代码：只保留 P1/P4

| ID／类别 | 每个实例 | 唯一处置：生产修复 | 完成检查 | 来源 |
|---|---|---|---|---|
| **F-069／P1** | `TG/command-rerun-request-service.ts:758` | 非 ready 不降成空 review 数组；只有真正 `ready([])` 是空集合。 | 实际 not_ready/rejected/cancelled 各不产生“无阻塞”的成功结果。 | P/M01 |
| **F-070／P1** | `RT/execution-driver.ts:536,537` | recognizer throw／非 ready 时失败关闭；只允许已确认的无匹配继续。保留合法 package 不可用降级语义。 | 实际 shell 不进入；取消不误写成功；需同步修正 `R/B2-02-recognition-unified.test.ts:192,196` 当前继续执行预期。 | P/M02 |
| **F-071／P1** | `RT/execution-preparation.ts:256` | 缺失／不可读 review 不当作空数组继续 prepare。 | 正式 review reader 故障时 prepare 不产生成功 prepared。 | P/M03 |
| **F-072／P1** | `WF/decision-actions.ts:284`；`TG/command-rerun-request-service.ts:985` | 在 B3 新 CRR adapter 边界处理②读取异常，保留①已保存事实，返回结构化失败；不能把未知提交结果说成未写。 | ①成功、②读故障后公开答复仍在；结果表达失败；后续可重驱。旧通用 coordinator 不顺手重构。 | P/M04 |
| **F-073／P1** | `TG/unknown-call-review-answers.ts:207`；`src/app/startup-reconcile.ts:545` | 恢复枚举覆盖 CRR 已保存但②尚未完成的答复，不能只保留已 applied 的候选。 | ①保存→②失败→重启／普通 advance→②③各完成一次。 | P/M05 |
| **F-074／P4** | `RT/context-assembler.ts:1409,1443`；`RT/execution-preparation.ts:309`；`TG/command-recognition.ts:42` | 统一 blocked-command 的全局展平与排序规则，不在一处按 record-first、另一处按全局 alias/time。 | 交错 A2/B1 等手算输入在 prepare、brief、recognition 顺序一致。 | P/M07 |
| **F-075／P4** | `RT/execution-preparation.ts:248`；`RT/context-assembler.ts:1383`；`src/composition/create-platform.ts:764` | 提取一个 Task review 分页读取实现，保留完整 cursor／失败语义。 | 三消费者使用同一实现；跨空页／末页／读取失败行为一致。P5 上限裁决不夹带进来。 | P/S01 |
| **F-076／P1** | `RT/context-assembler.ts:1199,1221`；`CM/decision-source-facts.ts:842,845,851,866`；`VR/decision-read-model.ts:562,642,653`；`TG/unknown-call-review-service.ts:186,190,198,202`；`TG/command-rerun-request-service.ts:362,370`；`RT/execution-preparation.ts:461` | 各层保留 cancelled／原失败语义，不统一变成 not_ready、unavailable 或空事实。 | 每条新边界的取消从入口到返回可追踪；不能据此声称现状会执行已取消 shell。 | P/M14 |
| **F-077／P4** | `WF/workflow.ts:517,523,1957,1959` | 清掉 B3 新增的旧 `failedReviewRefs` 投影／清理支路；内部只保留当前 failed-card 表达。 | 公开旧字段仍被拒绝；真实 driver 传递正确；旧 contracts 行留 T。 | P/M09 |
| **F-078／P4** | `TG/command-rerun-request-card.ts:77`；`VR/decision-read-model.ts:609,656`；`CM/decision-source-facts.ts:823,873` | 删除 card 未使用的 Run 参数及只为它发生的读取；保留 Kernel 命令读取真正需要的 execution。 | 卡片内容不变；公共操作少掉专供死参数的 I/O。 | P/M10 |
| **F-079／P4** | `TG/command-expansion.ts:111,115,228` | 删除无消费者的 `actions` 返回字段及其计算。 | 所有正式消费者类型检查通过；实际被使用的 body actions 不受删减。 | P/M11 |
| **F-080／P4** | `TG/command-rerun-request-service.ts:826,835` | 复用 state 层已有 `openRequestForAlias` 规则，去掉两份 owner 重写。 | pending/allowed/denied_final 的选择与正式状态规则一致；旧 allowlist 不自动编辑。 | P/M12 |
| **F-081／P4** | `TG/command-rerun-request-service.ts:85,657` | form 数量上限由正式状态转换统一负责；移除 owner 的重复业务规则，保留 codec 形状检查。 | 八项接受、第九项拒绝；只有一个业务上限判断。 | P/M13 |
| **F-082／P4** | `RT/context-assembler.ts:1411,1443`；`RT/continuation-brief-assembly.ts:333`；`CM/decision-source-facts.ts:833`；`VR/decision-read-model.ts:622` | 已经解码为当前合法 record 的必需 `blockedCommands` 不再 `?? []`。 | 当前 codec 必需字段约束与消费者一致；合法可选 brief/manifest 字段不误删。 | P/S02 |
| **F-083／P4** | `src/contracts/continuation-brief.ts:509`；`TG/command-expansion.ts:69`；`TG/command-rerun-request-service.ts:187` | B3 新增的 UTF-8 截断统一到一个纯实现。 | 中文、代理对、边界字节的独立纯例；输出不拆 UTF-8 字符。旧 `RT/context-assembler.ts:381` 留 T。 | P/S03 |
| **F-084／P4** | `WF/decision-actions.ts:277` | 去掉前面已验证 identity 后的重复计算／空值分支。 | 有效身份一次通过；无效身份仍在原边界拒绝。 | P/S04 |
| **F-085／P4** | `TG/command-rerun-request-service.ts:614` | 删除未使用 ctx 参数及对应调用实参。 | 类型检查及原行为检查通过。 | P/S05 |
| **F-086／P4** | `TG/command-rerun-request-card.ts:46,53` | 删除过时 AggregateRef 说明和双重 cast。 | 直接类型成立；真实 card source 不变。 | P/S06 |
| **F-087／P4** | `RT/execution-contracts.ts:339` | 注释改成当前失败关闭契约，与正式 driver 守卫一致。 | 注释与 `RT/execution-driver.ts:525` 的实际条件相符。 | P/S07 |
| **F-088／P4** | `TG/command-expansion.ts:41`；`TG/command-recognition.ts:149,156`；`TG/unknown-call-review-service.ts:232,234` | 动作 key/hash 的相同规范化算法收为一个纯函数，保留 whole-text fallback。 | 同一手算 command 在三路径得到同一 key；fallback 独立例不改变。 | P/S08 |
| **F-089／P4** | `TG/command-rerun-request-service.ts:91,94,97,100,103`；`TG/revision-guard.ts:14` | 复用 `TG/codec-fields.ts:14,17,30,36,39` 的相同字段谓词，消除重复定义。 | 空串、整数、非负数、plain object、revision 的接受／拒绝边界保持。 | P/S09 |

### 4.5 必须等待旧测试 diff 的集中候选

这七行不能直接冻结；它们不是“已确认在范围内”。

| ID／类别 | 实例 | 唯一处置，限范围确认后 | 完成检查 | 来源 |
|---|---|---|---|---|
| **F-090／F4†** | `R/K3-12-review-round-tools.test.ts:206,233,235,238,239,249,292,299,324` | **helper missing：真实 review prepare／只读执行链。** 实际 root、真实 Run/role/review/Kernel、真实 sandbox；Host 初始配置 `:237` 不再报错。 | 真只读写入失败、权限及公开 manifest；两后端服务部分。 | G2 |
| **F-091／F4†** | `R/K3-35-workspace-baseline-prepare.test.ts:120,141,182,183,211` | **公共路径：真实世界＋2001 个实际工作树变化＋Runtime prepare。** `:185,187,188` 的 Host 输入已放行。 | 公开 manifest 的 baseline 为 too_many_changes；无假 execution/assembler/body-store 验收。 | G3 |
| **F-092／F4†** | `R/K3-review-preparation.test.ts:308,336,338,341,342,353,393,395,398,399,409,572` | **公共路径：真实单项 review prepare 和真实 capture。** 输入与全文从公开 material 读取。 | L13 工具、空 write scope、sessionBasis、200/250 路径关系由真实准备链证明。 | G3 |
| **F-093／F4†** | `R/S3-context-assembler.test.ts:250,283,294,315,377,386,392,393,568,626,633,635,636,734,758,797,805,808,815,827` | **helper missing：真实 context／Query prepare 链。** 真实 Goal/Task/input/extension；脚本模型观察实际 input；扩展失败包真实 reader。 | binding 重用、不重读、输入预算、缺 upstream、Query 原文和故障传播各有公开前置。 | G3 |
| **F-094／F4，兼 F11†** | `R/S4C2-assembly.test.ts:68,138,200,227,338,382,425` | **公共路径：真实 Note 写入＋正式 Work/Query prepare。** 恢复真实 overlap／零预算／恰一条 warning 的独立反例。Note draft 本身允许。 | 公共 material 中正确正文／source；零预算不靠假 Query，warning 次数精确。 | G3 |
| **F-095／F8／A5†** | `R/S3-context-assembler.test.ts:590,595,596,597,602,655,671,676,684,701,709,711,718,719,720,721,770` | **纯测试：`R/S3-context-renderer-pure.test.ts`，测 `renderContext`／`renderContinuationBriefZh`。** 预期 header/prelude 独立。 | 无 Runtime/store 装配；完整独立输出；生产纯导出边界先解决 Q-04。 | G3 |
| **F-096／F1†** | `R/S3-context-assembler.test.ts:746` | **纯测试：`R/S3-task-payload-pure.test.ts`，测 `RT/context-assembler.ts:769` 的 `taskPayload`。** plan-only 组合不得作为实际 Run 前置。该函数当前非导出，提取出口需 lead 明确范围并由生产包承担。 | 纯输入输出覆盖 plan-only；不制造公开 claim 无法产生的 Run。 | G3 |
| **F-097／F11** | `W/B2-07-crr-card.test.ts:78,103,106` | **公共路径：真实 request 后修改 package.json，再公开读卡。** 对真实 reader 作计数，保留原 stored match。 | 卡片不重新读取／展开；删掉“不重展开”保护时失败。当前仅比较 stored 文本不能证明零重读。 | G5/F11-01 |

### 4.6 helper 消费者索引

以下列表是表中对应 helper 根因的一部分。旧测试调用仍受逐行 Scope 约束；第 3 节的额外调用则已经明确加入。

#### C-WORLD → F-001

`openK3ReviewCardWorld` 的 92 个调用：

- `A/K3-15-review-routes.test.ts:74`。
- `B/K3-15-ur3h.test.ts:96`；`B/K3-17-goal-guard.test.ts:87`；`B/K3-41-release-hold.test.ts:356`；`B/K3-46-review-advance-failures.test.ts:421,453,478,503,526,627,661,690,739`；`B/K3-review-workflow-rows.test.ts:206,872,1069,1089,1116`；`B/K3-UR7-crr-failed-set.test.ts:356,402,447,466,543`。
- `H/B2-401-world.ts:177`；`H/K3-35-continuation-fixture.ts:893`；`H/K3-blocked-command-fixture.ts:534`。
- `R/B2-02-approved-method.test.ts:43`；`R/B2-02-recognition-unified.test.ts:76,127`；`R/K3-19-review-admission.test.ts:48`。
- `S/K3-20-review-card-paging.test.ts:78`；`S/K3-29-startup-answers.test.ts:116,149`；`S/K3-29-startup-reconcile-2b.test.ts:202,232,261,282`；`S/K3-44-crr-kind4.test.ts:33`。
- `W/B2-01-task-read.test.ts:77`；`W/B2-07-crr-card-closed.test.ts:41,64,99`；`W/B2-07-crr-card.test.ts:35,79,118,172`；`W/B2-08-crr-answer.test.ts:58,88,102`；`W/B2-08-crr-cancel.test.ts:31`；`W/B2-09-answer-replay.test.ts:29`；`W/B2-09-crr-owner.test.ts:66`；`W/B2-12-recognition.test.ts:195`；`W/B2-12-rewrite-prefix.test.ts:105,135,157,173`；`W/B2-18-request-reads.test.ts:95,138`；`W/B2-UR7-crr-answer.test.ts:30`。
- `W/K3-06-mixed-kinds-owner.test.ts:119,183`；`W/K3-13-two-items-owner.test.ts:52`；`W/K3-15-disposition-effects.test.ts:151`；`W/K3-15-hold-release.test.ts:65`；`W/K3-15-list-by-task.test.ts:52,71`；`W/K3-16-approval-application.test.ts:60`；`W/K3-16-proposal-round-fixture.test.ts:64`；`W/K3-16-proposal-write.test.ts:55`；`W/K3-16-second-unfinished-proposal.test.ts:42`；`W/K3-17-disposition-replay.test.ts:56`；`W/K3-18-autonomy-facts.test.ts:64`；`W/K3-18-requeue-confirmed.test.ts:117,161`；`W/K3-18-review-card-queue.test.ts:424`。
- `W/K3-26-unknown-call-review-storage.test.ts:207,551,710,736,752,779,875`；`W/K3-35-owner-manifest-trim.test.ts:41`；`W/K3-41-disposition-proof.test.ts:47`；`W/K3-43-continuation-vs-hold.test.ts:70`；`W/K3-43-review-claim-vs-hold.test.ts:47`；`W/K3-47-claim-gate.test.ts:61`；`W/K3-47-continuation-gate.test.ts:60`；`W/K3-47-reader-facts.test.ts:63`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:277`；`W/K3-48-3-required-writes.test.ts:56`。

#### C-RECORD → F-001

`createK3NeedsDecisionRecord`／`world.createRecord`：

`B/K3-17-goal-guard.test.ts:89`；`B/K3-46-review-advance-failures.test.ts:423,455,480,505,528,529,629,663,692,693,741,742`；`B/K3-UR7-crr-failed-set.test.ts:364,404,411,471`；`H/K3-review-card-fixture.ts:319`；`W/K3-15-disposition-effects.test.ts:201,221,292,351`；`W/K3-15-list-by-task.test.ts:54,55,73`；`W/K3-17-disposition-replay.test.ts:58`；`W/K3-18-requeue-confirmed.test.ts:120,164`；`W/K3-41-disposition-proof.test.ts:49,99`；`W/K3-43-continuation-vs-hold.test.ts:88`。

#### C-TOOLS → F-002

98 个 shell definition 调用中，30 个 B3 外调用已经逐项列在第 3 节；其余 68 个如下：

- `A/K3-15-review-routes.test.ts:48`。
- `B/K3-15-ur3h.test.ts:49`；`B/K3-17-goal-guard.test.ts:37`；`B/K3-41-release-hold.test.ts:64`；`B/K3-46-review-advance-failures.test.ts:58`；`B/K3-review-workflow-rows.test.ts:56`；`B/K3-UR7-crr-failed-set.test.ts:65`。
- `R/B2-01-shell-hook.test.ts:21`；`R/B2-02-approved-method.test.ts:28`；`R/B2-02-recognition-unified.test.ts:41`；`R/B2-03-request-tool.test.ts:19`；`R/B2-04-allowance.test.ts:21`；`R/B2-05-06-denial.test.ts:22`；`R/B2-09-allowance-crash.test.ts:26`；`R/B2-13-allow-one-form.test.ts:19`；`R/B2-15-replay.test.ts:42`；`R/B2-16-hook-closure.test.ts:32`；`R/B2-16-hook-reads.test.ts:45`；`R/B2-401-world.test.ts:31`；`R/K3-19-review-admission.test.ts:37`；`R/K3-35-approved-methods-brief.test.ts:53`；`R/K3-35-T-by-hand.test.ts:83`；`R/K3-review-preparation.test.ts:53`。
- `S/B2-09b-allowance-crash.test.ts:78`；`S/K3-16-approval-round.test.ts:70`；`S/K3-20-review-card-paging.test.ts:45`；`S/K3-29-startup-answers.test.ts:38`；`S/K3-29-startup-reconcile-2b.test.ts:58`；`S/K3-29-startup-variants.test.ts:71`；`S/K3-44-crr-kind4.test.ts:24`；`S/K3-44-recovery-answers.test.ts:60`。
- `W/B2-01-blocked-commands.test.ts:29`；`W/B2-01-task-read.test.ts:36`；`W/B2-03-crr-request.test.ts:21`；`W/B2-07-crr-card-closed.test.ts:30`；`W/B2-07-crr-card.test.ts:26`；`W/B2-08-crr-answer.test.ts:24`；`W/B2-08-crr-cancel.test.ts:22`；`W/B2-09-answer-replay.test.ts:20`；`W/B2-09-crr-owner.test.ts:43`；`W/B2-12-recognition.test.ts:31`；`W/B2-12-rewrite-prefix.test.ts:34`；`W/B2-14-crr-forms.test.ts:22`；`W/B2-17-disposition-reads.test.ts:21`；`W/B2-18-request-reads.test.ts:48`；`W/B2-UR7-crr-answer.test.ts:21`。
- `W/K3-06-mixed-kinds-owner.test.ts:57`；`W/K3-13-two-items-owner.test.ts:38`；`W/K3-15-disposition-effects.test.ts:57`；`W/K3-15-hold-release.test.ts:45`；`W/K3-15-list-by-task.test.ts:23`；`W/K3-16-approval-application.test.ts:48`；`W/K3-16-proposal-round-fixture.test.ts:38`；`W/K3-16-proposal-write.test.ts:38`；`W/K3-16-second-unfinished-proposal.test.ts:34`；`W/K3-17-disposition-replay.test.ts:27`；`W/K3-18-autonomy-facts.test.ts:40`；`W/K3-18-requeue-confirmed.test.ts:43`；`W/K3-18-review-card-queue.test.ts:94`；`W/K3-26-unknown-call-review-storage.test.ts:81`；`W/K3-35-owner-manifest-trim.test.ts:32`；`W/K3-41-disposition-proof.test.ts:26`；`W/K3-43-continuation-vs-hold.test.ts:50`；`W/K3-43-review-claim-vs-hold.test.ts:32`；`W/K3-47-claim-gate.test.ts:46`；`W/K3-47-reader-facts.test.ts:40`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:71`；`W/K3-48-3-required-writes.test.ts:40`。

其他两个工具出口：

- read：`A/K3-15-review-routes.test.ts:54`；`W/K3-15-disposition-effects.test.ts:52`；`W/K3-15-hold-release.test.ts:51`；`W/K3-18-requeue-confirmed.test.ts:38`；`W/K3-43-continuation-vs-hold.test.ts:45`；`W/K3-47-continuation-gate.test.ts:46`；`W/K3-47-reader-facts.test.ts:46`。
- mailbox handle：`W/B2-01-blocked-commands.test.ts:39`。

#### C-HARNESS → F-003

`openRealRunHarness`：

`B/K3-41-release-hold.test.ts:383`；`B/K3-review-workflow-rows.test.ts:119,401`；`H/B2-401-world.ts:189`；`H/B2-blocked-runtime.ts:143`；`H/B2-crr-world.ts:116,181`；`H/K3-35-continuation-fixture.ts:896`；`H/K3-blocked-command-fixture.ts:435`；`H/K3-review-card-fixture.ts:417`；`S/K3-29-startup-reconcile-2b.test.ts:87`；`W/K3-06-mixed-kinds-owner.test.ts:185`；`W/K3-15-disposition-effects.test.ts:166`；`W/K3-18-autonomy-facts.test.ts:79`；`W/K3-18-review-card-queue.test.ts:427`；`W/K3-26-unknown-call-review-storage.test.ts:218,555`；`W/K3-47-claim-gate.test.ts:182`；`W/K3-47-continuation-gate.test.ts:130`；`W/K3-47-reader-facts.test.ts:104`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:279`。

`prepareAndStart`：

`B/K3-41-release-hold.test.ts:387`；`H/B2-401-world.ts:298,356`；`H/B2-crr-world.ts:125`；`H/K3-35-continuation-fixture.ts:911,967,1040`；`H/K3-review-card-fixture.ts:424`；`S/K3-29-startup-reconcile-2b.test.ts:92`；`W/K3-06-mixed-kinds-owner.test.ts:196`；`W/K3-15-disposition-effects.test.ts:172`；`W/K3-18-autonomy-facts.test.ts:86`；`W/K3-18-review-card-queue.test.ts:433`；`W/K3-26-unknown-call-review-storage.test.ts:247,283,575`；`W/K3-47-claim-gate.test.ts:187`；`W/K3-47-reader-facts.test.ts:109`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:286`。

`createRecord`：

`B/K3-41-release-hold.test.ts:400`；`H/B2-crr-world.ts:128`；`H/K3-35-continuation-fixture.ts:982`；`H/K3-blocked-command-fixture.ts:357`；`H/K3-review-card-fixture.ts:434`；`S/K3-29-startup-reconcile-2b.test.ts:97`；`W/K3-15-disposition-effects.test.ts:185`；`W/K3-18-autonomy-facts.test.ts:98`；`W/K3-18-review-card-queue.test.ts:448`；`W/K3-26-unknown-call-review-storage.test.ts:293`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:294`。

probe-capable 出口：

- `reconcileUnknown`：`B/K3-review-workflow-rows.test.ts:403`；`H/K3-35-continuation-fixture.ts:744`；`W/K3-06-mixed-kinds-owner.test.ts:206`；`W/K3-26-unknown-call-review-storage.test.ts:257,600`。
- `reconcileUnknownTwice`：`W/K3-26-unknown-call-review-storage.test.ts:628`。
- `replayRecord`：`W/K3-26-unknown-call-review-storage.test.ts:290`。
- K3-35 公共极值世界：`R/K3-35-approved-methods-brief.test.ts:83`；`R/K3-35-T-by-hand.test.ts:102,155`。

这些出口的无 override 调用本身不是 F5；问题是开放成品 probe 输入及相关假依赖。

#### C-PREPARE → F-004

- `prepareContinuation`：`H/K3-35-continuation-fixture.ts:566`；`H/K3-proposal-round.ts:434`；`W/K3-47-continuation-gate.test.ts:152,179`。
- `prepareWorstCase`：`R/K3-35-approved-methods-brief.test.ts:149`；`R/K3-35-T-by-hand.test.ts:135,167`。

#### C-PROPOSAL → F-005

- claim：`B/K3-review-workflow-rows.test.ts:351,400,449,461`；`H/K3-35-continuation-fixture.ts:994,1013`；`H/K3-proposal-round.ts:810,885`；`R/B2-02-approved-method.test.ts:60`；`R/K3-19-review-admission.test.ts:64`；`S/K3-29-startup-reconcile-2b.test.ts:267`；`W/B2-01-blocked-commands.test.ts:158`；`W/K3-06-mixed-kinds-owner.test.ts:145`；`W/K3-13-two-items-owner.test.ts:66`；`W/K3-16-approval-application.test.ts:114,166`；`W/K3-16-proposal-round-fixture.test.ts:154,160`；`W/K3-16-proposal-write.test.ts:69`；`W/K3-16-second-unfinished-proposal.test.ts:92,113,151,173,182`；`W/K3-26-unknown-call-review-storage.test.ts:886`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:305,321`。
- settle：`B/K3-review-workflow-rows.test.ts:339,355`；`H/K3-35-continuation-fixture.ts:1000,1019`；`H/K3-blocked-command-fixture.ts:367`；`H/K3-proposal-round.ts:818,874,915`；`H/K3-review-card-fixture.ts:389`；`R/B2-02-approved-method.test.ts:51,63`；`W/B2-01-blocked-commands.test.ts:163`；`W/B2-01-task-read.test.ts:50`；`W/B2-09-crr-owner.test.ts:68`；`W/B2-12-recognition.test.ts:197`；`W/B2-18-request-reads.test.ts:78`；`W/K3-06-mixed-kinds-owner.test.ts:164`；`W/K3-13-two-items-owner.test.ts:77`；`W/K3-16-approval-application.test.ts:117,135,172,174`；`W/K3-16-proposal-round-fixture.test.ts:113,129,152,157,163`；`W/K3-16-proposal-write.test.ts:63`；`W/K3-16-second-unfinished-proposal.test.ts:80,105,117,148,153,176,185`；`W/K3-26-unknown-call-review-storage.test.ts:906`；`W/K3-47-claim-gate.test.ts:94`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:311`；`W/K3-48-3-required-writes.test.ts:71`。
- write proposals：`B/K3-review-workflow-rows.test.ts:352`；`H/K3-proposal-round.ts:889`；`R/B2-02-approved-method.test.ts:61`；`W/B2-01-blocked-commands.test.ts:159`；`W/K3-16-approval-application.test.ts:115`；`W/K3-16-proposal-round-fixture.test.ts:155,161`；`W/K3-16-second-unfinished-proposal.test.ts:102,114,174,183`。
- run round：`W/K3-16-proposal-round-fixture.test.ts:146,258`；`W/K3-16-second-unfinished-proposal.test.ts:72`；`W/K3-35-owner-manifest-trim.test.ts:62`。
- reach awaiting proposal：`H/K3-proposal-round.ts:913`；`R/K3-19-review-admission.test.ts:80`；`W/K3-16-proposal-round-fixture.test.ts:77,124,173,223`。

这里列的是调用关系；helper 内未改的旧调用不因列出关系就从 T 自动转成 B3 finding。

#### C-B2 → F-006

`openB2BlockedWorld`：

`R/B2-01-shell-hook.test.ts:34`；`R/B2-03-request-tool.test.ts:26`；`R/B2-04-allowance.test.ts:29`；`R/B2-05-06-denial.test.ts:30`；`R/B2-09-allowance-crash.test.ts:41,65`；`R/B2-13-allow-one-form.test.ts:30`；`R/B2-15-replay.test.ts:121,165`；`R/B2-16-hook-closure.test.ts:50`；`R/B2-16-hook-reads.test.ts:63`。

`openB2HookWorld`：

`R/B2-02-approved-method.test.ts:78`；`R/B2-02-recognition-unified.test.ts:83`；`H/B2-blocked-runtime.ts:402`。

`runHook`：

`R/B2-01-shell-hook.test.ts:55,64,69,76,82`；`R/B2-02-approved-method.test.ts:84,87,90`；`R/B2-02-recognition-unified.test.ts:156,174,185,196,202,218,228`；`R/B2-04-allowance.test.ts:52,63,67,79`；`R/B2-05-06-denial.test.ts:64,65,85,86`；`R/B2-09-allowance-crash.test.ts:52,59,77,87`；`R/B2-13-allow-one-form.test.ts:46,52,57`；`R/B2-16-hook-closure.test.ts:80,95`；`R/B2-16-hook-reads.test.ts:182,209,217`；`R/B2-401-world.test.ts:56`。

`runTool`：

`R/B2-02-recognition-unified.test.ts:165`；`R/B2-03-request-tool.test.ts:60,74,75,84,89,98,107,118,120`；`R/B2-04-allowance.test.ts:42,73`；`R/B2-05-06-denial.test.ts:58,67,80,88`；`R/B2-09-allowance-crash.test.ts:46,71`；`R/B2-13-allow-one-form.test.ts:35`；`R/B2-16-hook-closure.test.ts:63`。

其他直接使用出口：`R/B2-05-06-denial.test.ts:49`；`R/B2-16-hook-closure.test.ts:112,118`；`R/B2-02-recognition-unified.test.ts:116`；`R/B2-16-hook-reads.test.ts:172`。`bindingOf` 的其他内部消费者为 `H/B2-blocked-runtime.ts:325,355`、`H/B2-401-world.ts:277`。

#### C-CRR → F-008

- `blockedRecord`：`H/K3-proposal-round.ts:261`；`B/K3-UR7-crr-failed-set.test.ts:358,405,449,468`；`S/K3-44-crr-kind4.test.ts:35`；`W/B2-07-crr-card-closed.test.ts:43,66,126`；`W/B2-07-crr-card.test.ts:40,81,120,174`；`W/B2-08-crr-answer.test.ts:60,90,104`；`W/B2-08-crr-cancel.test.ts:33`；`W/B2-09-answer-replay.test.ts:31`；`W/B2-UR7-crr-answer.test.ts:32`。
- `blockedRecordWithClaim`：`H/B2-crr-world.ts:104`；`B/K3-review-workflow-rows.test.ts:208`；`W/B2-07-crr-card-closed.test.ts:111`；`W/K3-26-unknown-call-review-storage.test.ts:670`。
- `requestRerunOf`：`S/K3-44-crr-kind4.test.ts:37`；`W/B2-07-crr-card-closed.test.ts:45,68,116,133,134`；`W/B2-07-crr-card.test.ts:42,84,122,176`；`W/B2-08-crr-answer.test.ts:62,92,106`；`W/B2-08-crr-cancel.test.ts:35`；`W/B2-09-answer-replay.test.ts:33`；`W/B2-UR7-crr-answer.test.ts:34`。
- raw Run snapshot：`H/B2-crr-world.ts:227`；`W/B2-07-crr-card.test.ts:71,101,135,162`；context 消费 `H/B2-crr-world.ts:238`、`B/K3-UR7-crr-failed-set.test.ts:130`。

#### C-BLOCKED → F-009

- services：`H/B2-401-world.ts:182`；`H/K3-blocked-command-fixture.ts:535`；`H/K3-prefix-claim.ts:49`；`W/B2-18-request-reads.test.ts:70`。
- seed：`H/B2-401-world.ts:183`；`H/K3-blocked-command-fixture.ts:536,542`；`H/K3-prefix-claim.ts:72`；`W/B2-18-request-reads.test.ts:71`。
- world：`H/B2-blocked-runtime.ts:391`；`H/K3-crr-fixture.ts:62`；`W/B2-01-blocked-commands.test.ts:52,94,98,120,149`；`W/B2-17-disposition-reads.test.ts:37,52,63,67`。
- createNeedsDecision：`W/B2-03-crr-request.test.ts:164`。
- startPrepared：`R/K3-review-preparation.test.ts:608`。

#### C-CRR-FIXTURE → F-010

`R/K3-review-preparation.test.ts:466,467`；`W/B2-03-crr-request.test.ts:80,100,114,124,136,147,161`；`W/B2-14-crr-forms.test.ts:68,82,99,119,136,152`。

#### C-PREFIX → F-011

`R/B2-02-recognition-unified.test.ts:78,129,133,134`；`W/B2-12-rewrite-prefix.test.ts:53,56,57,83,139`。

#### C-PURE → F-014

- baseBrief：`R/K3-15-blocked-omission.test.ts:56`；`R/K3-15-blocked-sentence.test.ts:39,48,53,59,63,67,75,79,105,122,138,141`；`R/K3-35-renderer-boundary.test.ts:48,108`。
- sha：`R/K3-15-blocked-sentence.test.ts:40,60,64,72`；`R/K3-35-renderer-boundary.test.ts:43,62,88,94`。
- requiredReviewBlock：`R/K3-35-approved-methods-brief.test.ts:167`；`R/K3-35-renderer-boundary.test.ts:155`；`R/K3-35-T-by-hand.test.ts:141,174`。

## 5. LEDGER

以下区间均为闭区间，**区间内每一行得到相同判定**；不是抽样。

分类：

- **E：等价搬移／等价改写。** 只说明这次断言变更没有削弱；不说明新夹具符合 v2。
- **B：早先任务书要求。**
- **W：削弱。** 必须关联本稿 finding。
- **U：材料不足，未闭合。**

### 5.1 逐行覆盖

| 报告 | E：等价 | B：早先任务必需 |
|---|---|---|
| G1 | 64–66、69、71–75、78–88、90–92、388–427 | 62–63、67–68、76–77、89 |
| G2 | 94、96 | 4–5、93、95、97、428–429 |
| G3 | 101–102、106、116–122、128–130、138 | 6–16、32、98–100、103–105、107、112–113、115、430–431 |
| G4 | 142–146 | 139–141、434–439 |
| G5 | — | 17–20 |
| G6 | 26、149–153、155–158、160–162、164–166、169–170、172–173、176、178、180–185、188–190、195、197–198、201、205、208–212、215–218、220–224、230–234、238–239、241–242、244、246、442–450、452–467 | 147–148、159、163、167–168、175、177、179、191–193、196、206–207、236–237、240、243、247–248、440–441、451、468 |
| G7 | 252–256、259、261–265、268、270–272、274、276–278、280–286、288、290–296、302–303、305–306、309–310、314、319、321–322、328–339、345–352、355–366、374–376、378、380–382 | 249–251、257–258、260、266–267、269、273、275、279、289、297–299、304、307–308、311–313、317–318、320、343–344、353–354、372–373、377、379、383–385、469–478、480–483 |

W 的逐行映射：

| D1 行 | finding |
|---|---|
| 33–50、53–59 | F-055：25 项 timeout |
| 70 | F-068：targets 从输出自取 |
| 108–111、114、123–127、131–135、432 | F-065：纯 renderer 义务丢失 |
| 136–137、433 | F-066：T600 服务拒绝变成功 |
| 154、171、174、186–187 | F-056：多条目输出字段／顺序未承接 |
| 194、200、202–203 | F-057：混合行存在／顺序未承接 |
| 199、204 | F-058：真实无目标 rerun／captured 断言丢失 |
| 213–214、225–229 | F-059：targets 推导未承接 |
| 219 | F-060：混合摘要提示未承接 |
| 235、245 | F-061：proposals 数量／保存顺序未承接 |
| 300、342 | F-063：真实 digest／prepare 装配关系丢失 |
| 301 | F-064：summary 边界丢失 |
| 315–316、323–327、340–341 | F-062：manifest trim 断言丢失／收窄 |
| 23、27、367–370、479 | F-067：proposal 后端／边界／拒绝／不变／重试削弱 |

未闭合：

| D1 行 | 当前证据 | 处置 |
|---|---|---|
| **287** | `W/K3-26-unknown-call-review-storage.test.ts:892` 当前是 `toContain(roundRunRef)`；ledger 只保存旧 `.map(...)` 开头。 | 补旧完整断言后再判，不能先归 E。 |
| **371** | `W/K3-48-2-unknown-call-review-model-text-budget.test.ts:397` 当前是字段匹配；ledger 只保存旧 `toMatchObject({` 开头。 | 同上。 |

**466 条有定位记录全部对齐：E 253、B 126、W 85、U 2。**

85 是 ledger 行数，不是 85 个独立削弱根因。D1:432、433、479 等包含对前面同一变更的聚合／重复记载，finding 已合并。

### 5.2 早先任务书依据

B 分类主要依赖这些明确要求，而不是“换了实现所以可以删断言”：

- R6 的公开前置替换：`.lead-ref/k3-g4b3-rework-6.md:40,47`。
- K3-48-3 的多条目 owner 极值移纯：同文件 `:37`。
- 文件批注必须保留 rejection、re-read、passing：同文件 `:60,61`。
- 极值纯测试必须保留完整 manifest 义务：同文件 `:67`。
- timeout 授权只针对指定 K3-35 hooks：同文件 `:70`。
- R7 的纯迁移／双后端：`.lead-ref/k3-g4b3-rework-7.md:32,40,42,56`。
- R8 的真实前置、33 项拒绝命名、RUN-25、purpose 覆写移纯：`.lead-ref/k3-g4b3-rework-8.md:29,33,37,44`。

D1:486 另列删除 `H/K3-large-review-input.ts`，不是上述 466 条之一。九份报告没有给它独立逐行判语；它的旧造态退出与 R6:37 的方向一致，但本稿**不把“0 tests、0 expects”当成删除已证明等价**。冻结时应给这条删除补明确归属，不能让它从 ledger 中消失。

D1:29 的 MOVED 汇总也不是额外 91 条可独立判定的删除；不重复加进 466。

## 6. WORK PACKAGES

建议 **两包**。共享 helper 的调用面过大，硬拆三包会让同一个测试文件同时接受 helper 迁移、断言补回和后端修改，破坏文件互斥。

以下是**文件所有权安排**，不是现在授权执行；`†` 项先完成 Scope 核定。

### 包 A：测试、helper 和消费者

**行：F-001–F-068、F-090–F-097，共 76 行候选。**

文件集合精确定义为：

1. 第 4 节这些行实例栏中的所有 `tests/` 文件；
2. 第 4.6 节对应消费者索引中的所有 `tests/` 文件；
3. 第 3 节的 31 个额外调用文件；
4. 下列明确的新文件／迁移目标。

前三项去重后是 **130 个现有文件的候选影响集**。其中包含仅需核对、未必需要修改的消费者；不能把它写成“已确定改 130 个文件”。T 节旧 helper 不因为被调用就整文件加入改写。

现有 helper 所有权：

`H/B2-401-world.ts`、`H/B2-blocked-runtime.ts`、`H/B2-crr-world.ts`、`H/K3-35-continuation-fixture.ts`、`H/K3-35-prepare.ts`、`H/K3-35-required-review-block.ts`、`H/K3-blocked-command-fixture.ts`、`H/K3-crr-fixture.ts`、`H/K3-prefix-claim.ts`、`H/K3-proposal-round.ts`、`H/K3-review-card-fixture.ts`、`H/K3-tool-seams.ts`、`H/S1-public-anchor.ts`。

新文件／迁移目标，**22 个路径**：

- `H/K3-public-world.ts`
- `H/K3-public-boundary-steps.ts`
- `H/K3-continuation-pure-fixture.ts`
- `R/K3-15-blocked-omission-pure.test.ts`
- `R/K3-15-blocked-sentence-pure.test.ts`
- `R/K3-35-renderer-boundary-pure.test.ts`
- `R/K3-review-input-pure.test.ts`
- `W/B2-12-recognition-pure.test.ts`
- `R/K3-15-disposition-effects-pure.test.ts`
- `R/K3-18-review-card-pure.test.ts`
- `R/K3-18-requeue-confirmed-pure.test.ts`
- `R/K3-26-unknown-call-review-codec-pure.test.ts`
- `R/K3-48-2-proposal-budget-pure.test.ts`
- `W/B2-07-crr-card-pure.test.ts`
- `W/B2-command-rerun-request-event-pure.test.ts`
- `W/B2-11-blocked-commands-bytes-pure.test.ts`
- `ST/command-normalization-pure.test.ts`
- `ST/command-rerun-request-pure.test.ts`
- `R/K3-16-targets-pure.test.ts`
- `R/K3-16-proposals-pure.test.ts`
- `R/S3-context-renderer-pure.test.ts`†
- `R/S3-task-payload-pure.test.ts`†

内部顺序：

1. **先 helper**：F-001/F-002/F-003/F-012/F-013/F-014。
2. 再 B2、CRR、proposal 和公共读取适配：F-004–F-011。
3. 再改全部消费者及本地装配：F-015–F-025、F-047–F-052。
4. 再补行为反例、独立预期、拒绝行和后端。
5. 最后承接纯测试、补回 ledger 义务、恢复 timeout，生成逐项 D1 对照。

估算：**约 7,000–12,000 行新增／删除／修改量**，不是净新增；主要取决于旧测试实际 Scope 和真实公共世界能复用多少现有代码。

等待项：

- F-066、F-067 等待容量边界裁定／合法可达样例，不能靠延长 timeout 或恢复手造事实结束。
- F-090–F-096 等待测试 diff。
- F-014/F-046/F-095/F-096 若需要提取生产纯导出，必须由包 B 拥有对应 `src` 修改，先由 lead 确认范围。
- `R/B2-02-recognition-unified.test.ts:192,196` 的失败关闭预期和 CRR 恢复验收，需要包 B 的 F-070/F-073 实现。

### 包 B：生产 P1/P4 和独立验证文件

**行：F-069–F-089，共 21 行。**

现有生产文件，**19 个**：

- `src/app/startup-reconcile.ts`
- `WF/decision-actions.ts`
- `WF/workflow.ts`
- `src/composition/create-platform.ts`
- `src/contracts/continuation-brief.ts`
- `RT/context-assembler.ts`
- `RT/continuation-brief-assembly.ts`
- `RT/execution-contracts.ts`
- `RT/execution-driver.ts`
- `RT/execution-preparation.ts`
- `CM/decision-source-facts.ts`
- `TG/command-expansion.ts`
- `TG/command-recognition.ts`
- `TG/command-rerun-request-card.ts`
- `TG/command-rerun-request-service.ts`
- `TG/revision-guard.ts`
- `TG/unknown-call-review-answers.ts`
- `TG/unknown-call-review-service.ts`
- `VR/decision-read-model.ts`

为避免与包 A 抢文件，包 B 的新增验证固定使用独立文件，例如：

- `R/K3-B3-fail-closed.test.ts`
- `W/K3-B3-recovery.test.ts`
- `ST/K3-B3-shared-rules-pure.test.ts`

新共用实现文件也归包 B：

- `src/core/work-graph/tasks/task-review-reader.ts`
- `src/core/work-graph/tasks/command-action-key.ts`
- `src/contracts/utf8.ts`

内部顺序：

1. 先共用纯规则／分页 helper：F-074/F-075/F-080/F-081/F-083/F-088/F-089。
2. 再失败传播和恢复：F-069–F-073/F-076。
3. 再死参数、旧字段、重复分支和注释：其余 P4。
4. 最后用包 A 提供的真实公共世界完成服务验收。

估算：**生产约 600–1,200 行，验证约 400–800 行**。

包 B 可以先实现生产部分和纯验证；其真实服务验证需要等待包 A 的公共 helper 接口。包 A、B **不共同编辑任何现有文件**。合流后才能验收跨包场景，不能把各自副本里的局部通过当作整片完成。

## 7. SPEC CONFLICTS

| 规格行 | 冲突形状 | v2 给出的处置 |
|---|---|---|
| `SPEC:1384`，R4“认定入口的草稿” | 容易把平台根据 Kernel 构造的 review draft 当成人的公开输入。 | 实际公开 `executions/resolve-unknown` 只接受 Run 和操作者理由，见 `src/app/core-routes.ts:439`；draft 由平台生成。成功接收手造 draft 为 F1；拒绝测试按 A6；纯组合按 A5。 |
| `SPEC:1389`，D11 拆分 | 明文建议手写分类器依赖喂 Kernel Turn。 | 不能用返回构造事实的端口冒充 A2。使用真实 Kernel／脚本模型；故障包真实依赖。纯分类／排序／codec 边界移纯。 |
| `SPEC:1392` | shell 替身去掉 `isolated_process`，阻塞后构造执行结果。 | F4。A3 gate 必须保留原能力、调用真实 handler、原样返回真实结果。对应 F-002。 |
| `SPEC:1393` | 假 capability probe 宣布只读命令可用。 | F4。用真实 sandbox；不可用通过 A2／A8 真实输入制造。对应 F-019。 |
| `SPEC:1399` | 通过 32 条条目把真实 owner record 凑近预算。 | 已撤回的多条目 owner 造态不能恢复。不可达组合进 A5 纯函数；真实服务边界必须另有公开可达前置。 |
| `SPEC:1413`，K3-06 | 同一批三种条目、单 owner round。 | rulings §2：真实可达单项链保留；混合多项由 new/transition/renderer 等纯函数承接。对应 F-056。 |
| `SPEC:1427`，K3-13 | 双命令 owner 场景。 | 同上；双 alias、kind、digest、定稿补齐规则移纯，不能直接丢掉断言。 |
| `SPEC:1435`，K3-35（一）（二） | 32 条、16 位省略数、32 targets 等作为真实准备前置。 | 极端组合进纯 build/fit/render；真实单项 prepare 的装配关系仍保留。对应 F-062/F-063/F-065。 |
| `SPEC:1435`，K3-35（三） | T600 的服务层 capacity 与现有真实小样例 ready 不一致。 | 实现者无权自行改验收；F-066 先寻找合法公开容量链，找不到报告确切阻挡，由 lead 裁定。 |
| `SPEC:1440`，K3-48（一）（三） | 通过手造多条目近预算 owner record 验创建／必需写。 | R6:37 已要求极值移纯、owner 用可达状态。不能要求恢复禁止形状。 |
| `SPEC:1440`，K3-48（二） | 可选文字容量原先依赖违规近预算前置。 | 前置改公共链，不等于授权把拒绝改成功；F-067 保留精确边界、capacity、不变和短文本重试义务。 |
| `SPEC:1457`，K3-26（七） | owner 接受手造 `too_many_calls` draft，32 items＋omitted=1。 | 成功接受平台产物是 F1；组合／codec 进纯测试。真实可达认定通过公开 Run＋reason。 |
| `SPEC:1457`，K3-26（八） | owner 接受手造 `undecodable_call` draft。 | 同上。wrong-kind 拒绝可以按 A6，但必须真实前置、仅一个错误、公开不变。 |
| `SPEC:1457`，K3-26（九） | 513-byte provider callId 与直接手造 owner draft 混写。 | provider callId 是公开模型输入，可保留真实链；拒绝 draft 必须 A6，不能同时有另一 recorded ID 遗漏。对应 F-036。 |
| `SPEC:1672`，历史 D11 决定记录 | 再次要求 owner 草稿极值和手写分类器例子。 | 保留历史原义，当前测试入口由 v2／撤回裁定替代；lead 更新现行映射，不能删除历史来掩盖冲突。 |

`SPEC:1498,1500` 的整次公开操作读取预算没有被 v2 放行取消。A3 计数允许，但必须数完整公开操作，见 F-028。

## 8. OPEN QUESTIONS

下面合并所有报告的开放问题，并把已由 v2 解决的部分明确关闭。

| 问题 | 最小选项 | 代码／裁定倾向 |
|---|---|---|
| **Q-01：旧测试 Scope 如何核实？** | 提供 `k3-g4b3^..k3-g4b3-r8` 测试 diff；或把相关候选保持未冻结。 | v2 Scope 要求改行证据。不能依据 stat 或“审过整个文件”认定全部在范围内。 |
| **Q-02：D1:287、371 的旧完整断言是什么？** | 补旧多行断言；或明确两项未闭合。 | 现有单行 ledger 不足以判等价，也不足以判削弱；G7/Q1。 |
| **Q-03：rulings §3.6 的 Accepted 是否豁免 UR7b 桩实现？** | Accepted 只涵盖真实 pause/probe，UR7b 改公共路径；或 lead 在新规则版本明确例外。 | `B/K3-review-workflow-rows.test.ts:776,793` 实际构造 Workflow，不是纯测试；A7 为空，当前倾向公共路径，F-015。 |
| **Q-04：A5 对混合模块／传递 imports 的边界？** | 纯导出移到无平台依赖模块；或下一版规则明确允许经核实的混合模块纯出口。 | 测试纯 helper 混入 Runtime 的问题明确，应提取；`R/K3-16-review-extremes-pure.test.ts:23` 导入的 `RT/context-assembler.ts:51,55,59` 又导入运行期 reader，不能仅凭函数体纯就自动放行。G2/OQ-1。 |
| **Q-05：A1 点名 continuation helper 是整份实现豁免吗？** | 仅接受其公共步骤形状；或逐项在新版本列例外。 | A7 为空；`H/K3-35-continuation-fixture.ts:239,494,691` 的假 mailbox／probe 不因文件被点名而合法。倾向第一项。G3/Q1。 |
| **Q-06：T600 和 near-budget 公共服务前置是否可达？** | 继续给出真实公开样例并保留服务拒绝；或 lead 正式改验收边界，说明纯极值和服务映射分别承担什么。 | `R/K3-35-T-by-hand.test.ts:168,172` 只证明当前小样例 ready；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:388` 只证明远低于预算。均不能证明所有合法公开输入不可达。倾向先寻找公开反例；F-066/F-067 待定。 |
| **Q-07：以前请求相同 createdAt 时怎样排序？** | 冻结 request-ref 降序；或只要求集合／时间约束，不冻结 tie。 | `W/B2-07-crr-card.test.ts:164` 固定 z 在 a 前；`TG/command-rerun-request-card.ts:146` 承认规格未规定。代码倾向降序，但不能代替产品决定。G5/Q1。 |
| **Q-08：R=0 时读取预算是 0 还是至少一页？** | 严格 `ceil(R/200)`，并给出无需读即可知道为空的正式依据；或冻结 `max(1,ceil(R/200))`。 | `W/B2-18-request-reads.test.ts:123` 要求查空一次，当前实现形状倾向至少一次；`SPEC:1500` 文字尚需明确。G5/Q2。 |
| **Q-09：“没有自查依据”是否逐字契约？** | 找到既有冻结出处；或只冻结 evidence/verdict 语义。 | `W/K3-13-two-items-owner.test.ts:88` 的文字能追到 state 实现，不能由实现反推规格；未找到独立文字依据。G6/Q1。 |
| **Q-10：审批 approve/decline label 的独立来源？** | 指出既有冻结文案；或由 lead 明确冻结两个 label。 | `W/K3-16-approval-application.test.ts:214,215` 当前引用生产常量；`SPEC:432` 只明确 ID。不应让 DSH自行发明预期。G6/Q3。 |
| **Q-11：cwd 给出时能否为空？** | 明确给出时必须非空；或定义空串的公开归一化语义。 | `TG/unknown-call-review-service.ts:689` 拒绝，`TG/unknown-call-review-codecs.ts:273` 接受长度 0；`SPEC:550,1202` 只写最大值。owner 倾向非空，但代码冲突需 lead 裁定。G6/Q2。 |
| **Q-12：精确 codec 英文错误句式的冻结依据？** | 补返工 2 第 12 项；或明确是否为兼容契约。 | `W/K3-50-codec-shape-checks.test.ts:2,41,54` 引用未附旧书；不能自动放宽。G7/Q2。 |
| **Q-13：失败后继续、FIRST failure、T02 中文映射的正式来源？** | 补 B1 rework-2 item 1 并登记正式别名；或在现行规格登记这些 UR7 扩展。 | `B/K3-46-review-advance-failures.test.ts:420,452,477,502,525,626,660,689,738` 不是 `SPEC:1439` 所述 K3-46 两组。倾向先找旧冻结来源，不把生产注释当 oracle。G1/Q2。 |
| **Q-14：CRR ②是否继承当前 goalBases 守卫？** | 继承 T02并共用守卫；或明确 CRR 豁免。 | `TG/command-rerun-request-service.ts:985` 只读当前 Goal；UCR 的检查在 `TG/unknown-call-review-service.ts:1307`；`SPEC:536` 说照 L19，文字倾向继承。P/Q1。 |
| **Q-15：前16个动作本身仍超过16KiB如何退化？** | 允许继续删动作并说明识别后果；或保留比较键、精确定义展示裁剪。 | `TG/unknown-call-review-service.ts:114` 可把 actionCap 降至0；`SPEC:487` 只授权丢第16个以后的动作。现有文字不支持擅自继续删，具体格式需 lead。P/Q2。 |
| **Q-16：不同请求同 createdAt 的 newest 如何定序？** | 确定性 requestRef 平局规则；或正式创建／声明顺序。 | `RT/context-assembler.ts:1447` 用跨聚合 revision，不代表创建先后。倾向确定性 ref，避免比较不相干 revision；仍需统一 Q-07。P/Q3。 |
| **Q-17：必需段刚好占满预算时，省略提示能否消失？** | 为提示预留并规定优先级；或明确该极限允许无提示。 | `src/contracts/continuation-brief.ts:499` 当前可只返回 head+suffix；尚无受支持极限的可达证明。代码现状不能作为批准依据。P/Q4。 |
| **Q-18：Kernel 到64页／cursor停滞应怎样返回？** | 保留有界读并明确 partial；或未读完统一 unavailable。 | `RT/context-assembler.ts:1195,1217` 当前返回已收集部分；失败关闭倾向 unavailable，但报告没有证明“缺全文仍成功写入”。P/Q5。 |
| **Q-19：required-writes 近预算敏感性如何登记？** | 以 R6 已指定的纯极值＋可达 owner 链分别登记；或 lead 要求并证明额外合法公开 near-budget 服务前置。 | `.lead-ref/k3-g4b3-rework-6.md:37` 明确移纯，倾向先按既有拆分登记；不恢复手造32条 owner 状态。G7/F11-11 与早先任务书合并裁定。 |
| **Q-20：规则无 F 编号的缺口怎样放进冻结表？** | 类别列允许 A5/A6/逐行后端要求；或下一版规则正式补分类。 | v2 明说 Forbidden 只是例子。不能把缺后端自动叫 F12，也不能把缺 rejects 分组自动叫 F11。本稿采用真实规则名。 |

已关闭的报告开放问题：

- **H/OPEN-1：Plan draft**——A1 路由输入，已在第 1 节撤销。
- **G2/OQ-2：初始 Host 配置、授权、未用 model placeholder**——A8 已明确；不包括读后覆盖、假 digest 和假文件事实。
- **H/OPEN-2：Workspace revision pin**——本稿按 A8 放行，不当 F7 断言。
- **H/OPEN-3：receipt adapter**——当前所指实现是未改旧行，进入 T-022；新路径不借这个旧 adapter 获得豁免。

RUN-25 双后端问题已有静态答案：**可达**。`H/K3-35-continuation-fixture.ts:450` 建真实 git 工作树，`:637,646` 共享 memory records/bodies，`:555,576` 真 Runtime prepare/start，`:687,691,694` 真 read/probe/reconcile；`W/K3-26-unknown-call-review-storage.test.ts:593,623` 已参数化两后端。这里证明的是路径存在，**没有声称本次执行通过**。

真实 mailbox 也有确定实施路径：复用 `H/K3-35-continuation-fixture.ts:659` 的缓存 platform；正式 mailbox 在 `src/composition/create-platform.ts:816,1312`；脚本调用 `send_session_message`、等待实际 yielded，再由另一 Run 调 `respond_session_message`，工具定义／执行在 `RT/communication-tools.ts:309,414,421,332,462`。当前 harness 的 `:836` 没有 `platform()` 出口，不能把它写成现成 API。

## 9. TOTALS

### 9.1 可以确定的合并数量

| 项目 | 数量 |
|---|---:|
| 草稿根因行 | **97** |
| 包 A 候选行 | **76** |
| 包 B P1/P4 行 | **21** |
| v2 撤销定位／实现根因 | **29**：A1 8、A8 16、F9 5 |
| 已确定 T 记录 | **91** |
| 已确定 T 不同 file:line | **162** |
| T 涉及文件 | **32** |
| 范围新增调用 | **33** |
| 范围新增文件 | **31** |
| D1 已对齐定位记录 | **466** |
| D1 等价／早先必需／削弱／未闭合 | **253／126／85／2** |

### 9.2 按类别的草稿计数

为防止虚假精确，这里把“实例”分成两个概念：

- **根因行**：表的 F-001…F-097。
- **定位点**：实例栏中不同 `file:line`。同一点在多个根因提供证据时只计一次，归最先出现的主类；消费者传播列表不再算新缺陷。

| 主类 | 根因行 | 去重定位点 |
|---|---:|---:|
| F1 | 2 | 15 |
| F2 | 5 | 33 |
| F3 | 3 | 11 |
| F4 | 22 | 209 |
| F5 | 1 | 1 |
| F6 | 1 | 9 |
| F7 | 3 | 44 |
| F8 | 3 | 62 |
| F9 | 0 个独立根因；内部等待并入 F-009 | — |
| F10 | 1 | 4 |
| F11，含相关 A6 行 | 18 | 83 |
| F12 | 14 | 67 |
| A5 默认拒绝 | 2 | 42 |
| 逐行后端要求 | 1 | 68 |
| P1 | 6 | 24 |
| P4 | 15 | 46 |
| **合计** | **97** | **718** |

F9 并入 helper 根因不表示剩余 F9 已清零；`H/K3-blocked-command-fixture.ts:350` 仍在 F-009。

### 9.3 文件与包

| 包 | 根因行 | 实例栏定位点 | 实例栏现有文件 | 加调用关系后的候选影响集 | 明确规划的新路径 |
|---|---:|---:|---:|---:|---:|
| A | 76 | 648 | 98 | 130 | 22 |
| B | 21 | 70 | 19 | 19 | 6 |
| 合计 | 97 | 718 | 117 | 149 | 28 |

这些是**草稿定位／影响集数量，不是已经冻结的改文件数**。最终“范围内实例数、转 T 数、实际修改文件数”还不能签字：必须先补旧测试逐行 diff，关闭 D1:287/371，并由 lead 裁定容量、纯模块边界等开放项。不能用上述 718 个定位点替代这个尚缺的范围判断。