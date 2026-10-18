**结论：仍有 1 项真实测试保护缺口，未发现本范围内尚未修复的生产行为错误。F-067 的容量保护已经成立，但冻结要求的完整前置大小 C 手算仍未完成。**

本次只读，未写文件，未运行测试、变异、构建或检测器。核对覆盖所给 `r8..r10` diff 的 139 个文件、冻结未闭行及相关调用链。下文 **STATIC** 表示静态判断，不把 DSH 答复中的通过数当成本次执行证据。

为满足“台账削弱也进入最终表”的要求，另列 3 项**无业务保护损失的台账处置**，由 lead 在冻结时明确接受或记入 T；它们不进入施工，也不重新打开原有 T 项。

以下测试文件省略 `.test.ts`，生产及 helper 文件省略 `.ts`。

| 缩写 | 路径 |
|---|---|
| R／W／B／S／H／ST | `tests/runtime/`／`tests/work-graph/`／`tests/business/`／`tests/scenarios/`／`tests/helpers/`／`tests/state/` |
| RT／TG／WS／WF／VR | `src/core/agent-runtime/`／`src/core/work-graph/tasks/`／`src/core/work-graph/state/`／`src/business/workflow/`／`src/core/work-graph/views/` |
| K44 | `S/K3-44-crr-kind4` |
| ROW | `B/K3-review-workflow-rows` |
| PREP | `R/K3-review-preparation` |
| TOOLS | `R/K3-12-review-round-tools` |
| BUD | `W/K3-48-2-unknown-call-review-model-text-budget` |
| LIST | `W/K3-15-list-by-task` |
| UR7 | `W/B2-UR7-crr-answer` |
| REC | `B/K3-44-crr-recovery` |
| CANCEL | `R/K3-B3-cancellation-cancelled` |
| ORDER | `R/K3-B3-newest-request-order` |

**1．最终表**

| id；file:line | 类别 | r10 后状态 | 根因：上一轮为什么未完成 | 唯一处理 | 谁 | Codex 能否盲写 | 变异补丁及必须失败的断言 |
|---|---|---|---|---|---|---|---|
| **N-01**；`K44:292`；`WF/workflow:2758` | **缺保护** | **new** | **被改弱**：旧“读取已保存 CRR 答复失败”被“③提交失败”替换，后者返回外层 `ready`，走不到原非 ready 分支。 | 保留 G1 新两例；在 `UR7` 现有双后端世界增加 saved-answer 读取失败例：公开 `answerDecision` 只保存①；在 `workflowOf` 的 `decisionMessages.readDecisionAnswer` 注入一次 `unavailable`；指定 `taskId:'k3-20-a'`，交入真实 answer refs；断言等待、准确原因和公开状态不变。 | **Codex test patch** | **yes**：`UR7:51` 的 Workflow、`:87` 的依赖、`:107` 的公开读均已存在；不需要新 Host 重启或时序夹具。红绿和变异结果仍**需要实跑**。 | **M1**：将 `WF/workflow:2758–2763` 替换为 `if (result.status !== 'ready') continue;`。新增测试放在 `UR7:175` 后；必须失败的是 `state:'waiting', next:null` 和准确原因断言。新断言尚不存在，不能编造其落地行号。 |
| **F-067**；`BUD:512–522` | **只是写法** | **partly** | **没做**：固定 cwd 和 proposal 增量已经完成，但 155,989／156,070 只有结果，没有完整前置 C 的逐字段独立手算。 | 保持固定公开输入，按完整记录字段、50 条实际路径、字符串及 JSON 分隔符列出 C；明确区分原记录大小与新增 proposal 的 274 字节；用独立算式核对固定 cwd 457／376、156,720 前置及长短结果，不再由测量值反推 cwd。 | **Opus** | **no**：涉及真实公开链产生的记录、长路径和两后端数值核对，**需要实跑**；不能只补一段未经核对的数字注释。 | **M2**：删除 `WS/unknown-call-review:231–235` 的 optional-text admission 块，现有 `BUD:544` 的 `capacity` 断言应失败。**该变异目前已受保护**；剩余 C 手算不是另一道缺失的生产守卫。 |
| **N-02**；`PREP:192` | **只是写法** | **new** | **规则含糊**：F-054 改成真实前置后，原 `[1,2,3]` 变成 `[1]`，施工者已报告但尚未形成最终处置。 | lead 冻结 **接受 (a)**：真实服务例保留 `[1]`，多条目映射保留 `R/K3-review-input-pure:94`；将这次字面变化记为获准替换，不称“等价移动”。 | **lead，≤10 行** | **yes，仅处置文字**；不需要测试补丁。 | **不适用**：没有确认生产保护丢失，不能虚构一条应由本项杀死的变异。 |
| **N-03**；`K44:262–284、318–333`；旧断言见台账 A21、A22、A24、A28–A31、A34 | **只是写法** | **new** | **被改弱**：真实 Host 改写删除了旧报告投影、枚举数量及该场景内实际重放的若干断言，答复笼统归入 F-020/F-035，没有逐项交代替代关系。 | lead 冻结接受明确分工：真实 Host 两例守自动交接及公开结果；`UR7:162–174` 守实际②③重放；旧报告投影断言不恢复。逐项记为局部删减，不能记为同主体、同 literal 的移动。 | **lead，≤10 行** | **yes，仅处置文字**；没有新增时序或测试。 | **不适用**：G1 交接变异已由新例保护，实际重放仍有 `UR7` 保护；本项没有另一个已确认失守的生产检查。 |
| **N-04**；`K44:290、340`；`W/B2-09-crr-owner:524、536、548` | **只是写法** | **new** | **被改弱**：本轮新增五处 timeout，答复没有准确逐项记账，且将 B2-09 的三处写成两处。 | lead 将**这五处本轮新增扩时**明确记入 F-055/T 的处置记录，修正数量；不恢复旧 F-055 的其他 timeout，不把扩时冒称冻结行要求的等价移动。 | **lead，≤10 行** | **yes，仅处置文字**；不修改时限。 | **不适用**：这是测试时间上限变化，未发现业务断言因此失守；没有对应生产守卫变异。 |

N-02～N-04 是本轮台账处置项，**不是新增业务必修**。其中 N-04 只列 r10 新变化，不重开 book 10 已送 T 的旧 F-055 项。

N-01 的冻结变异应当是可执行的逻辑删减，而不是制造编译错误：

```diff
--- a/src/business/workflow/workflow.ts
+++ b/src/business/workflow/workflow.ts
@@
-      if (result.status !== 'ready') {
-        hardFailure = true;
-        cardFailure = true;
-        addFailedCardRef(failedCards, card);
-        if (failure === null) failure = dispositionReadFailure(result);
-        continue;
-      }
+      if (result.status !== 'ready') continue;
```

新增测试应明确包含：

```ts
expect(result).toMatchObject({
  status: 'ready',
  value: { state: 'waiting', next: null },
});
expect(result.value.reason)
  .toBe('unavailable: the saved answer is not readable');
```

变异后 STATIC 预期是 `advance / select_work / reason:null`，因此以上两处必须失败。公开 request/message revision、application 不变也必须检查，但**零写断言本身杀不死这个变异**。

现有相近测试不能替代：

- `ROW:666` 是普通选择阶段的 `review_unreadable`，没有 handed-over answers。
- `ROW:713` 在读取 message 时已经失败，走 `WF/workflow:2703`，不是 `:2758`。
- `ROW:1231` 是③失败，coordinator 外层仍为 `ready`，走 `:2777`。
- `REC:148、191` 的②失败同样封装在外层 `ready` 中。

**2．本轮关闭的冻结行**

以下按业务义务判断关闭；N-01 是改写中新丢失的独立保护，不否认 G1 主交接已补成。

| 冻结行 | 修复及证明；STATIC 删守卫判断 |
|---|---|
| **F-020** | `K44:218–231` 在①真实持久化后 gate 旧 Host；`:261、317` 真 crash restart；`:263–275、322–333` 验证新 Host 自己做②③。把 `src/app/host:1036` 改成 `if (false as boolean) await collaborationDriver.start(...)`，两个用例分别在 `K44:263、322` 等不到目标状态。**STATIC：失败。** |
| **F-021** | `R/B2-02-recognition-unified:93、104` 接真实 workspace reader；`W/B2-12-recognition:166–168` 恢复 reader **throw**，`:180–182` 断言真实 declared 退化结果。删除 `TG/command-expansion:133–134` 的异常转 unavailable，后者不能正常得到原结果。**STATIC：失败。** |
| **F-026** | 六处独立预期已写入：`W/B2-01-blocked-commands:77、113–114、138–139`，`W/B2-03-crr-request:89`，`W/B2-14-crr-forms:76`，`B/K3-46-review-advance-failures:501`。hash 不再跟随生产计算，原因固定为 `revision_conflict: record version changed`。改变 `WS/command-normalization:39` 的摘要结果会撞上固定预期。**STATIC：独立保护成立。** |
| **F-032** | `LIST:64、73、75` 真实创建同 Task 的两个不同 Run，`:80` 另一个 Task；`:87、90、97、99–100` 严格验证两条、分页、无重复。窄 recognizer 接线让第二 Run 到达 shell。`TG/unknown-call-review-service:1570` 若过滤后仅保留一条，`:90` 失败。原 401 条及一致性重试保护保留。**STATIC：失败。** |
| **F-035** | G1 真交接同 F-020；`UR7:156` 恢复公开 `state:'allowed'`；`:162–174` 仍真正重放②③并检查不重复增长。**STATIC：删除 Host 自动交接，新 K44 失败；重放义务未被第二次“无未落实答复”的 restart 冒充。** |
| **F-054** | 七行均改真实 backend 前置及双后端：`ROW:816、859、878、914`，`PREP:166、212`，`TOOLS:126`。证明分别在 `ROW:851–856、888–911、928–933`，`PREP:180–196、221–229`，`TOOLS:138–139`。这是执行矩阵修复，没有单一可删生产检查；`[1]` 的字面处置单列 N-02。 |
| **F-069** | `TG/command-rerun-request-service:741–744` 的非 ready 守卫由 `W/B2-09-crr-owner:514、526、538` 实际命中；`:519、531、543` 检查准确拒绝，随后公开请求不存在、零提交。将守卫改为“非 ready 使用空 reviews”会失败。**STATIC：失败。** 仅硬删后产生 TypeError 不应作为最终冻结变异。 |
| **F-072** | `WF/decision-actions:277–287` 捕获② adapter 异常；`REC:85–90、148` 在①之后第二次 Goal read 抛错，`:159、168` 要求准确失败，`:171–176` 查已保存答复与未改请求，`:181–188` 重驱成功。删除 catch，`:159` 无法通过。**STATIC：失败。** |
| **F-073** | `TG/unknown-call-review-answers:206–211` 保留②未提交的答复；`REC:191` 只让 `crr-answer:` 的②提交失败一次，`:209–213` 证明①存在、②未做；`:134` 枚举恰好一条，`:218–225` 完成重驱。`:206` 后插入 `if (applied === null) continue;`，`:134` 得到 0。**STATIC：失败。** |
| **F-076** | `VR/decision-read-model:566、641` 保留取消；`RT/context-assembler:1282、1331` 传播取消。`CANCEL:147` 的公开队列读取在 `:164–167` 收到 cancelled，`:193` 必须仍是 cancelled，`:196–197` 请求不变。将上述 decision-read-model 返回改成 unavailable，`:193` 失败。**STATIC：失败。** |
| **F-098** | 唯一比较器在 `TG/command-rerun-request-card:143–149`；brief `RT/context-assembler:1465` 与 card `:177` 共用。`ORDER:79–114` 建同刻 `a:denied / B:allowed`，`:122–123` 核 brief；`:147–173` 建较晚第三请求后核 earlier 顺序。brief 改 `const newest = forAlias[0];`，`:122` 失败；去掉 card `:177` 排序，`:170` 失败。**STATIC：失败。** |
| **F-100** | `W/K3-10-crr-goal-basis:115` 保存答复后改 Goal 内容，`:143–146` 要求准确 T02 拒绝；`:156` pause/resume 只改 revision，`:194–201` 必须落实。把 `TG/command-rerun-request-service:1038` 的内容基础检查条件改成 false，前例失败；误按 revision 拒绝则后例失败。**STATIC：两侧均受保护。** |
| **F-101** | `CANCEL:91` 通过真实 prepare，`:131` 传 caller signal，`:138` 读取中 abort，`:143` 要求 cancelled。assembler 前最后一次取消检查在 `RT/execution-preparation:377`，之后 `:461` 仅传播结果。把 `RT/context-assembler:1281–1284` 改回非 ready 一律返回 ready facts，会得到 ready，`:143` 失败。**STATIC：失败。** 页帽／停滞仍 T。 |
| **F-046，仅裁定 5 的丢失断言** | `R/K3-15-disposition-effects-pure:207、210–211、236–239、245–246、318–319` 恢复 A72、A74、A77、A78、A80、A82、A84 的单目标、负断言、完整文字和顺序。**这只关闭丢失断言子项，纯迁移余项仍 T。** |

F-076 的 decision-read 测试注入了 `cancelled`，但没有同时 abort caller signal；它与 book 10 指定造法不完全相同。目标传播分支确实被保护，属于写法差异，不再列假保护。

六组单独结账：

| 组 | r10 状态 |
|---|---|
| **G1** | 主交接保护关闭，见 F-020/F-035；另有新 N-01，不能用③故障替代 saved-answer 读取故障。 |
| **G2** | 关闭；插入 `applied === null → continue`，`REC:134` 应失败。 |
| **G3** | **仍不能保护 prepare 消费层失败，但已由 book 10 §2.2 移 T。** `R/K3-B3-runtime-fail-closed:28、48` 直接测 reader，不能称已补入口保护。 |
| **G4** | 关闭，见 F-076/F-101。所给 r9b 日志对 G4 记录的是已存在生产缺陷，**没有执行一次额外变异**；不能把它写成六组均有独立 mutation 运行记录。 |
| **G5** | **原自算／自比保护问题仍在，按 book 10 §2.2 移 T。** 不称已修，也不重开。 |
| **G6** | 关闭；真实公开前置能区分 code-unit 与 locale 顺序，见 F-098。 |

F-102 在 verify9 已关闭；r10 未破坏 owner 传 preferred、同次识别选择 preferred、hook 不传 preferred 的接线，不重复计入本轮关闭。

**3．D1 台账**

实际数量是 **3 + 1 + 5 + 49 + 14 = 72 行**，不是答复的 75。`MOVED:21` 只有汇总，没有逐项内容；不能把这个标题当作 21 条已提供的定位。删除测试文件为 0；D3 的 0 是所给台账结果，本次未重跑。

“要求”表示冻结行要求更换前置或验收方式；只有主体、literal 和检查均保留时才称“等价”。

新增常量、“放松”和 timeout：

| 编号 | 台账位置 | 判定 |
|---|---|---|
| C1 | `TOOLS:138` | **要求 F-054**。`EXPECTED_REVIEW_TOOLS` 来自本文件 `:64–66` 的规格字面量，不是生产常量。 |
| C2 | `BUD:520` | **要求 F-067**。158,720／156,720 是本地字面量；完整 C 欠账仍见 F-067。 |
| C3 | `BUD:565` | **要求 F-067**。`SHORT_TOTAL` 在 `:554–555` 独立算出并严格等于 157,020。 |
| L1 | `LIST:91`，旧 `:61` | **要求 F-032，没有实际放松**。`:90` 仍严格等于两个同 Task refs；`:91` 是附加排除 B。 |
| T1 | `K44:290`，300,000 | **扩时削弱 → N-04/T**。旧成功例 120,000；真实重启改变了成本，但不是同限时移动。 |
| T2 | `K44:340`，300,000 | **扩时削弱 → N-04/T**。旧失败例使用默认时限。 |
| T3 | `W/B2-09-crr-owner:524`，120,000 | F-069 新 not_ready 例；**新增扩时 → N-04/T**，不是删行为断言。 |
| T4 | 同文件 `:536`，120,000 | F-069 新 cancelled 例；**新增扩时 → N-04/T**。 |
| T5 | 同文件 `:548`，120,000 | F-069 新 unavailable 例；**新增扩时 → N-04/T**。答复写“两处”，实际三处。 |

49 条删除断言，旧定位均取自台账：

| 编号 | 旧位置 | 判定及当前检查 |
|---|---|---|
| A1 | `B/K3-46-review-advance-failures:498` | **要求 F-026**；现 `:501` 为准确独立 literal `revision_conflict: record version changed`。 |
| A2 | `ROW:825` | **要求 F-054**；现 `:853` 检查 `w.applied=[]`，`:854–856` 另核无③及 review 不变。 |
| A3 | `ROW:845` | **要求 F-054**；现 `:888–889` 检查真实 backend 的 advance／settle_review 结构。 |
| A4 | `ROW:857` | **要求 F-054**；现 `:897` 保留 `round_ended`，reviewRef 来自同一真实记录。 |
| A5 | `ROW:858` | **要求 F-054**；现 `:898` 钉真实公开读到的 revision；旧固定 7 未保留，不能称 literal 等价。 |
| A6 | `ROW:859` | **要求 F-054**；现 `:909` 钉第二次真实 revision，`:907` 证明 revision 已变化；旧固定 8 未保留。 |
| A7 | `ROW:860` | **等价**；现 `:910` 检查第一个 requestId truthy。 |
| A8 | `ROW:861` | **等价**；现 `:911` 检查两次 requestId 不相同。 |
| A9 | `R/B2-02-recognition-unified:288` | **要求 F-021**；现 `:283–285` 用真实 reader，保留完整 block 原因。 |
| A10 | `TOOLS:263` | **等价**；现 `:138`，同一 prepared envelope 解包后检查相同 tools。 |
| A11 | `TOOLS:264` | **等价**；现 `:139`，writeScope 仍严格 `[]`。 |
| A12 | `R/K3-B3-runtime-fail-closed:113` | **要求 F-098/G6**；删除构造 port 的假保护，替代为 `ORDER:122–123、170–173` 的真实 brief/card 结果。不是同主体移动。 |
| A13 | `PREP:270` | **要求 F-054**；现 `:187–189` 检查原 Run 的真实 kernelSessionId，throughPosition 仍 null；旧 `'ks'` 未保留。 |
| A14 | `PREP:271` | **局部削弱 → N-02**；现 `:192` 为 `[1]`，不是 `[1,2,3]` 的等价移动；多条纯例仍在 `R/K3-review-input-pure:94`。 |
| A15 | `PREP:275` | **等价**；现 `:196`，同一 manifest digest 与 prepared binding digest 比较。 |
| A16 | `PREP:325` | **要求 F-054**；现 `:227` 检查真实首路径 `changed/path-000.ts`，不是旧 `path-0.ts` literal。 |
| A17 | `PREP:326` | **要求 F-054**；现 `:228` 检查第 200 项 `changed/path-199.ts`；`:226、229` 保留 200／省略 50。 |
| A18 | `K44:212` | **要求 G1**；旧前置已 denied，现 `:254` 是 pending，`:272` 由重启变 allowed；②已做③未做另由 `UR7:131–159` 保留。 |
| A19 | `K44:213` | **要求 G1**；现 `:254` 前置同 revision，`:272` 重启后 +1；不是前置断言等价移动。 |
| A20 | `K44:217` | **要求 G1**；现 `:262` 检查真实 Host report 的 problems 为 `[]`。 |
| A21 | `K44:218` | **局部削弱 → N-03**；原 `redriveGoals.length===1` 没有同 literal 现址。新例检查实际交接效果。 |
| A22 | `K44:223` | **局部削弱 → N-03**；原 goal/scope/taskIds 精确投影未原样保留。当前 `:263–275` 验证真实目标请求、答复结果。 |
| A23 | `K44:228` | **要求 G1**；手交 handed 数组改为真实 Host 交接后的 `:263–275` 公开效果；不是同主体移动。 |
| A24 | `K44:233` | **局部削弱 → N-03**；CRR answers 长度 1 未原样保留。 |
| A25 | `K44:247` | **要求 G1**；现 `:272` 检查 request revision=before+1，②现在由重启执行。 |
| A26 | `K44:248` | **等价并加强**；现 `:263–266`，同一保存消息 application 非 null，并检查 schemaVersion。 |
| A27 | `K44:249` | **等价**；现 `:273`，同一消息 revision+1。 |
| A28 | `K44:256` | **局部削弱 → N-03**；新第二次 restart 不等于实际重放；真正重放的 applied receipt 仍在 `UR7:167–170`。 |
| A29 | `K44:261` | **场景内删减 → N-03**；新 `:282–283` 检查第二次 restart 后完整 request 不变；实际重放的相同 revision 检查在 `UR7:172`。 |
| A30 | `K44:262` | **场景内删减 → N-03**；新 `:284` 检查完整 message 不变；实际重放 revision 检查在 `UR7:173`。 |
| A31 | `K44:263` | **场景内删减 → N-03**；新 `:284` 包含 application 不变；实际重放 application 检查在 `UR7:174`。 |
| A32 | `K44:272` | **要求 G1**；现 `:318` 检查真实 Host problems=`[]`。 |
| A33 | `K44:274` | **要求 G1**；手交数组改为真实重启效果 `:322–333`；不是同主体移动。 |
| A34 | `K44:277` | **局部削弱 → N-03**；失败例原 CRR answers 长度 1 未原样保留。 |
| A35 | `K44:284` | **保护削弱 → N-01**；读取失败时 waiting／next:null 消失，当前③失败不是同分支。 |
| A36 | `K44:289` | **保护削弱 → N-01**；读取失败的 unavailable 原因断言消失。 |
| A37 | `K44:291` | **保护削弱 → N-01**；读取失败时 request revision 不变消失；现 `:326` 期待②成功 +1，不能替代。 |
| A38 | `K44:292` | **保护削弱 → N-01**；现 `:331` 虽检查 message revision 不变，但故障是③提交，非答复读取，不能称等价。 |
| A39 | `W/B2-01-blocked-commands:132` | **要求 F-026**；现 `:138–139` 固定 `cc5562be…`，`:135–137` 给出 canonical JSON 输入。 |
| A40 | `LIST:60` | **要求 F-032**；现 `:87` 严格检查两个相同 Task ID，增强。 |
| A41 | `LIST:61` | **要求 F-032**；现 `:90` 严格检查两个不同 Run refs，增强。 |
| A42 | `LIST:64` | **要求 F-032**；现 `:97` 分页严格等于两个 refs，`:100` 与一页结果相同。 |
| A43 | `BUD:512` | **要求 F-067**；现 `:519–520` 保留 156,720 本地 literal。 |
| A44 | `BUD:513` | **要求 F-067**；现 `:535–538` 算完整增量并严格等于 162,720。 |
| A45 | `BUD:515` | **要求 F-067**；现 `:554–555` 严格等于 157,020。 |
| A46 | `BUD:516` | **要求 F-067**；现 `:556` 保留 157,020≤B。 |
| A47 | `BUD:523` | **要求 F-067**；现 `:546` 检查 LONG_TOTAL；它已在 `:538` 严格等于 162,720。 |
| A48 | `BUD:527` | **等价并加强**；现 `:550` 比较同一 before 对象大小，`:549` 另检查完整 JSON 不变。 |
| A49 | `BUD:539` | **要求 F-067**；现 `:565` 检查 SHORT_TOTAL，它已在 `:555` 严格等于 157,020。 |

14 条删除 test／describe：

| 编号 | 旧位置 | 判定及现址 |
|---|---|---|
| D1 | `ROW:815` | **要求 F-054**；现 `:816`，双后端同业务行。 |
| D2 | `ROW:828` | **要求 F-054**；现 `:859`，双后端真实 Run。 |
| D3 | `ROW:839` | **要求 F-054**；现 `:878`，双后端真实 revision／identity。 |
| D4 | `ROW:864` | **要求 F-054**；现 `:914`，双后端真实 outcome_unknown。 |
| D5 | `TOOLS:233` | **要求 F-054**；现 `:126`，双后端，权限断言保留。 |
| D6 | `R/K3-B3-runtime-fail-closed:86` | **要求 F-098/G6**；新文件 `ORDER:69`。 |
| D7 | 同文件 `:87` | **要求 F-098/G6**；`ORDER:70` 的真实请求顺序例。 |
| D8 | `PREP:245` | **要求 F-054**；现 `:166`；alias 字面削弱另入 N-02。 |
| D9 | `PREP:288` | **要求 F-054**；现 `:212`，真实 250 路径 capture。 |
| D10 | `K44:205` | **要求 F-020/F-035/G1**；现 `:234`，真实 Host describe。 |
| D11 | `K44:206` | **要求 G1**；现 `:235` 真重启成功例；SQLite-only 有真实 Host 持久化理由，双后端局部服务例仍保留。 |
| D12 | `K44:266` | **保护削弱 → N-01**；旧 saved-answer 读取失败整例消失，现 `:292` 的③故障不能替代。与 A35–A38 合并计一项。 |
| D13 | `LIST:51` | **要求 F-032**；现 `:53`，同 Task 两 Run 的严格分页例。 |
| D14 | `BUD:490` | **要求 F-067**；现 `:471`，两后端均保留，cwd 改为固定输入。 |

verify9 的旧十项削弱也已核对：D27 在 `UR7:156` 恢复；D82 在 `W/B2-12-recognition:166–182` 恢复；A72/A74/A77/A78/A80/A82/A84 在上述 disposition pure 文件恢复；D10 的 `1_200_000` 有 book 10 裁定 5 授权。

**4．Package R**

**七处都接了真实 review service，但只有六处满足“与被测执行事实使用同一 records 世界”。S3 是例外。**

| 装配点 | 当前接线 | 判断 |
|---|---|---|
| `H/B2-runtime-fixture:219` | `:220` 创建真实 RunStateReader；`:223` 用同一 records 创建 owner；`:279` 返回依赖，`:295–298` 建 Runtime。 | **同 records，真实 owner**；rebuildDeps 同样补齐。 |
| `H/S2B-runtime-store-fixture:158` | `:159` reader，`:162` owner，`:201` 返回，`:228、235–236` 建 Runtime。 | **同 records，真实 owner**；rebuild/reopen 路径一致。 |
| `H/S1-runtime-scenario-fixture:164` | records→`:168` reader→`:238` owner→`:241` deps→`:246` Runtime→`:255` prepare。 | **同 records，真实 owner**。 |
| `H/WP1-entry-fixture:129` | executions 使用 base.records；`:204` owner 同 base.records；`:208、210` 同时进入 assembler、prepare；`:216` 调 prepare。 | **同 records，真实 owner**。 |
| `H/S1-workflow-archive-fixture:1202` | records→`:1207` reader→`:1242` owner→`:1257` Runtime→`:1288` Workflow。 | **同 records，真实 owner**。 |
| `B/S1-archive-flow:204` | records→`:212` reader→`:245` buildRuntime→`:265` owner→`:295` Runtime。 | **同 records，真实 owner**。 |
| `R/S3-context-assembler:409` | 新建空 review backend；`:411–413` owner/reader 使用它；`:417、425` 接 assembler/prepare；但 `:420` executions 仍返回预制执行记录。 | **真实 owner，但不是同一事实世界**。空 review backend 与 stub execution 并存，不能写成“七处全部同 records”。 |

S3 没有继续用假的 review reader；残留的是既有执行记录 stub。未发现这次窄接线造成新的业务假保护，按既有旧片／写法 T 处理，不据此扩大 Package R。

29 文件逐条路径如下。表中 B2、S2B、S1、WP1 对应上表装配链；最终真实 prepare 进入 `RT/execution-preparation:408` 的 Task review 读取。

| # | 失败清单文件 | 当前到达路径 |
|---:|---|---|
| 1 | `R/A2-reconcile-runtime` | `:85` B2；`:109` rebuildDeps→`:200` prepare。 |
| 2 | `R/B2-runtime-execution` | `:36` B2→`:70` prepare。 |
| 3 | `W/WP1-goal-content-entry` | `:56` openGoalContentEntry→WP1 `:204、210、216`。 |
| 4 | `R/S1-archive-files-brief` | `:32` S1→`:96` f.prepare→S1 `:255`。 |
| 5 | `R/K-readonly-command` | `:553` 经 `H/K-readonly-work-support:64` B2；`:680` 直接 B2→`:695` prepare。 |
| 6 | `R/R4-control-runtime` | `:58` B2→`:166` prepare。 |
| 7 | `tests/app/S2B-r2-r6-probe-verdicts` | `:40` S2B→`:47` rebuildDeps→`:49` prepare。 |
| 8 | `tests/app/S2B-be2-startup-reconcile-activity` | `:50` S2B→`:62` rebuildDeps→`:63` BE2 support；support `:94、98` prepare。 |
| 9 | `R/S2B-38-run08-unknown-activity` | `:124` S2B→`:130` prepare；`:163、178` 同链。 |
| 10 | `R/S1-routed-replies` | `:39` S1→`:170` f.prepare→S1 `:255`。 |
| 11 | `R/K3-24-unknown-outcome-stability` | `:75` B2→`:103` rebuildDeps→`:167` prepare。 |
| 12 | `tests/app/S2B-be2-late-evidence-activity` | `:51` S2B→`:60` rebuildDeps→`:63` BE2→support `:98` prepare。 |
| 13 | `R/S3-context-assembler` | `:647` preparationHarness→`:409–425` 接线→`:433` preparation→`:648` 调用；同世界例外见上。 |
| 14 | `R/R2e-git-source-loop` | `:45` B2→`:90` prepare；`:141、195` 同链。 |
| 15 | `B/S1-archive-flow` | 自建 Runtime `:245、265、295`→真实 Workflow `:390、396`→`:405` prepare receipt；另一入口 `:303、305` 经 S1-workflow-archive-fixture。 |
| 16 | `tests/app/S2B-r2-backfill-real-kernel` | `:98、138`→`H/S2B-r2-backfill-kernel-support:81` S2B→`:89` prepare。 |
| 17 | `tests/app/S2B-r2-backfill-probe-first` | `:66` S2B→`:73` rebuildDeps→`:75` prepare。 |
| 18 | `tests/app/S2B-be2-run23-activity` | `:60` S2B→`:72` rebuildDeps→`:74` BE2→support `:98`。 |
| 19 | `W/S2B-r2-activity-run-ended-at` | `:52` S2B→`:79` rebuildDeps→`:82` BE2→support `:98`。 |
| 20 | `R/S2B-r2-run08-current-revision` | `:92` S2B→`:101` rebuildDeps→`:126` prepare。 |
| 21 | `R/S2B-45-inprocess-run21-activity` | `:74` S2B→`:83` rebuildDeps→`:86` prepare。 |
| 22 | `R/S2B-44-backfill-late-evidence-race` | `:91` S2B→`:100` rebuildDeps→`:103` prepare。 |
| 23 | `R/S2B-37-observer-reread-failure` | `:42` S2B→`:66` prepare。 |
| 24 | `R/S2B-36-observer-cancel-reread` | `:46` S2B→`:68` prepare。 |
| 25 | `R/S2B-15-end-retry-activity` | `:33` B2→`:45` prepare。 |
| 26 | `tests/architecture/production-reach` | **不走 prepare**；检查四个已实际生产可达的符号，见下。 |
| 27 | `tests/app/S2B-be2-run18-activity` | `:35` S2B→`:47` rebuildDeps→`:51` BE2→support `:98`。 |
| 28 | `tests/app/S2B-be2-run09-activity` | `:62` S2B→`:66` rebuildDeps→`:70` BE2→support `:98`；`:38` 首例不是本次 prepare 回归入口。 |
| 29 | `tests/app/S2B-41-decision54-backfill-bound` | `:148` S2B→`:179` rebuildDeps→`:182` prepare；`:242` 第二 Run 同 fx.runtime。 |

BE2 support 的完整路径是 `tests/helpers/S2B-be2-reconcile-support.ts`。

四个移出 production-reach allowlist 的符号**确实被生产使用**：

`TG/command-rerun-request-service:818、827`
→ `WS/command-rerun-request:153` 的 `openRequestForAlias`
→ `:155` 使用 `OpenCommandRerunRequestForAliasInputV1`
→ `:160、161` 调用 `sameTask / sameReviewRef`，定义在 `:249、253`。

因此四项删除成立；它们不是靠测试调用冒充生产可达。以上只能证明接线和可达性，**不能代替 lead 的 29 文件实跑结果**。

**5．r10 答复的 FOUND／UNSPECIFIED**

| 项目 | 代码实际做什么 | 类别 | 唯一建议裁定 |
|---|---|---|---|
| **F-054 `[1,2,3] → [1]`** | `PREP:166` 的真实服务前置生成当前这一条 review item；`:192` 检查 `[1]`。多条目 builder 的 `[1,2,3]` 仍在 `R/K3-review-input-pure:94`。 | **只是写法** | **接受 (a)**，见 N-02。不能称字面等价；也不凭静态判断宣称一切真实多条目路径不可达。当前七行的双后端业务要求已完成。 |
| **`BUD:213–217` 手编码并提交 UnknownCallReview** | `fixture()` 在 `:203–223` 构造、transition、encode 后直接 commit，确实手造事实；服务于旧 conclusion/evidence 容量行。**F-067 使用的是 `nearBudgetProposalFixture():316–363`，没有调用这段。** | **只是写法** | 保持既有 T；纠正答复“这就是 F-067 near-budget 前置”的混淆，不重开已成立的 proposal 容量保护。 |
| **`H/B2-blocked-runtime:260–271` 构造 WorkspaceFile** | 从 `files[input.path]` 取字符串，手算 digest/size，返回 ready WorkspaceFile；`:274` 给默认 recognizer 使用，并非真实文件读取。 | **只是写法** | 保持既有 T。F-021 点名两处已修；未发现这个旧默认在 r10 新增了业务假保护。 |
| **claim-only 步骤留在本地** | `PREP`、`TOOLS` 的本地步骤通过真实 owner claim，保存真实 activeRound；没有因 helper 未抽共享而改变业务事实。 | **只是写法** | 接受本地窄步骤；不另开共享 helper 重构。 |
| **F-066 的 15,030／15,031** | 算术差异仍未成为独立公开 prepare 实测；两数均小于 16,384。 | **没有可见后果** | 遵守 book 10 裁定 6：保持 T；关闭依据是 lead 裁定，不能改写为已证明公开路径不可达。 |

本表没有要求改生产代码。按决定 81-2/81-3，**“缺保护”属于测试行，不等于需要改变生产行为的业务行**；因此当前是 Codex 测试补丁、Opus 算术核对及 lead 冻结处置，不应仅因存在“缺保护”就再开 DSH 第三轮。

**未闭合计数：会出错 0／缺保护 1／只是写法 4／没有可见后果 0；DSH 0／Codex 1／Opus 1／lead 3（冻结记账）；仍有缺保护，无会出错——按决定 81-3，不启动 DSH 返工 3。**