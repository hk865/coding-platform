# T 轮：lead 的验收（2026-10-20）

**结论：** 合入（2026-10-20，`0e381ce4`）。两波施工，每波按决定 80 冻结问题表、最多返工三轮（决定 81）。最后一张表（W2d）返工后 Codex 快速核对 0 条；合入时的全量全过。没有调用真实模型。T 也留下一批要用户定的事，见“留给用户”。

- **合入时的全量：** 合并树 `e99b385`（bubblewrap，5 个并行，scope 7G，同时在跑覆盖率）：766 个测试文件全过，9,774 项过、3 项跳过，3,592 秒；构建、类型检查、模块边界检查都是 0（`checks/full-TMERGE.txt`）。
- **合并副本：** 工作树的 `47cc63e8`（覆盖率的开发依赖）加 `t-base..9a69bdb`，得 `e99b385`。它和 T 的结果只差 `package.json`、`package-lock.json`、`scripts/check-boundaries.mjs`。合入提交 `0e381ce4` 的树就是 `e99b385` 的树：602 个文件 +17,235/−27,385。
- **T 的结果：** `9a69bdb`（基线 `t-base` = `3a9f6d94`）；`t-base..9a69bdb` 37 个提交（DSH 11、Claude Code 26）。

## 合并和 lead 的修

- **wave 1 合并 `11d46d5`**（`books/t-audit-merge-notes.md`）：
  - TP、TQ 各在自己的副本里从 `t-base` 做，两份基线逐字节相同。合并副本从 TP 的 `efa65cd` 开始，把 TQ 的 `t-base..5057649` 三方应用上去。
  - 两个文件冲突。允许清单按 `(file, name)` 逐条合：基线 182、TP 177、TQ 169，结果 164，没有两边都改的条目；合并后对 TP 的 diff 就是 TQ 自己的 diff。`tests/helpers/S5-decision-fixture.ts` 用 TP 的：TP 已经走公开 `adoptInitialArchitecture` 写目录行，TQ 在自己白名单外改的这个文件丢掉。
  - 类型检查 0，模块边界检查过。
- **`5daea2e`：** `R4b-session-directory` 的种子补一行当前格式的 `ArchitectureCatalog`（没有模块，`since: null`）。TQ-091 之后裸 baseline 读作 `unavailable`，书检查漏了这个下游夹具。之后 W1-27 改成公开 `adoptInitialArchitecture`。
- **wave 1 的最后两处 `67d547d`、`d4c4cea`**（决定 81：DSH 三轮用完后 Codex 给补丁，lead 落地）：
  - `67d547d`：`S3-context-inputs` 注册 Session 异常的记录 schema（和 `create-platform.ts:656` 一样），并改用真实邮箱，不再用固定回 `unsupported` 的替身。补丁 `checks/t-lead-fix-P1.patch`。
  - `d4c4cea`：上提的 `makeRunA2` 里收窄一个类型（`checks/t-lead-fix-W1R3.diff`）。
  - 改后 `S3-context-inputs` 32/32（bubblewrap），类型检查 0，账本 0 行。
- **wave 2 合并 `4807e64`：** 一处冲突，`tests/helpers/K3-35-continuation-fixture.ts` 的重导出行（T2 删了 `baseBrief`、`G`、`sha`、`task`，T3 删了 `G`、`task`），取 T1＋T2 一侧。
- **wave 2 返工 1 里 lead 自己做的：**
  - 工作流开始前，W2b-01：`tests/helpers/task-claim-fixture.ts` 给 `createSession` 传 `meta: { requestId: \`admit-${requestId}\` }`，别的测试钉住的 Session 和消息 id 不动（R-15）；
  - W2b-12：名字打出第三个标签值；
  - 一个 agent 被编辑钩子拒了，lead 用它留下的补丁落了 W2b-37、39、40、41、43、45、51；
  - 删掉 W2b-07 之后没用的 `SessionRef` 导入。
  - 之后按副本提交（`9b5c10a`、`3e8f580`、`ed47f57`、`3317425`、`e94ad5d`、`3d05d71`），合成 `722ddf3`；类型检查 0，模块边界检查过。
- **wave 2 返工 3 `9a69bdb`：** lead 改了 W2d-01..W2d-05（5 个测试文件 +15/−6），见“审查和问题表”。

## 用户的决定

- **10-19：**
  - 同意装开发依赖 `@vitest/coverage-v8` 4.1.10（T 前覆盖率要用），提交为 `47cc63e8`，没推送。
  - 14:50 两件。其一：60 个 `core-http-types` 别名和 2 个 `main.ts` CLI 类型留着，允许清单里这 62 条的理由从 pre-batch 改成 wire-format（pre-batch 62 → 0）。其二：决定 79-1，打开库时不加“这是旧版本建的库”的提示。原话：“我们没有启动过旧格式的产品，目前还是未完成”。维持现状，不加标记，不改提示。
- **10-20：**
  - 14:31、14:40，用户让 lead 在 15:00 重置前用完本周额度。lead 用两个工作流（5 个、8 个 agent）先做了返工 1 的一部分行。
  - 14:41：“你可以现在自己就干了，不必等到 DSh。” wave 2 返工 1 改由 Claude 子 agent 做。
  - 18:14，问“第二轮返工交给谁做？”，答“Claude 子 agent”。wave 2 返工 2 也由 Claude 子 agent 做。
- **对分工的影响：** 两次决定各只管那一轮，是对决定 56、81 分工的偏离，记在这里。wave 2 返工 3 是 lead 按决定 80-4 自己改的，不是用户的决定。按 81-1 只数 DSH 返工的口径，wave 2 是 0 轮；按冻结表数是三轮。

## 检查

- **全量**（都在 WSL 里带 bubblewrap，5 个并行；数字见 `books/t-lead-summary.md` §6 和各 `checks/full-*.txt`）：
  - W1 `5daea2e`：767/772 个文件，24 项失败。8 项是 BLOCKED 的预期（B-02、B-03、W1-26）；16 项是两处合并回归，立为 W1-43、W1-44。
  - W1R1 `ed26c44`、W1R2 `1c31c27`：都是 773/773，9,929 过。
  - W1R3 `254617d`：772/773，IN05 两项失败（查找索引 `session-anomaly-by-task` 没登记），lead 的补丁修了。
  - W2a `4807e64`：760/766，8 项失败。原因有两种：一个共用 helper 移动了 id（W2b-01，R-15）；规模行 30 秒超时（W2b-03、W2b-08、W2b-20）。
  - W2R1 `722ddf3`：765/766，只剩 W2b-20 的 store page 两项，`03b9cfd` 修了。
  - W2R2 `c05c7d7`：766/766，9,774 过。
  - 合入 `e99b385`：766/766，9,774 过。
- **断言账本**：每条删掉或放松的断言都对上一个条目或一行，没有计划外的删除。
  - wave 1 和 wave 2 施工：`dsh/ledger-*.txt`；
  - W2R1：`checks/ledger-W2R1.txt`，88 行和 2 个删掉的文件；
  - W2R2：`checks/ledger-W2R2.txt`，9 条断言、2 个测试；
  - W2R3：`checks/ledger-W2R3.txt`，0 行。
- **lead 带 bubblewrap 补跑的沙箱测试：**
  - `checks/r3-in05.txt`（`254617d`）：`S3-context-inputs` 的 IN05 在两个后端都失败，30 项过；IN11 过。
  - `checks/w2-env-T3.txt`（T3 的 `54380f7`）：10 个文件，71 项过，1 项失败（K3-07 要先构建出 `dist`，全量里会先构建）。

## 逐波判断

| 波 | 组 | 项数 | done | partial | BLOCKED 或没开始 |
|---|---|---:|---:|---:|---|
| 1 | TP | 173 | 157 | 7 | 9 BLOCKED |
| 1 | TQ | 115 | 107 | 3 | 5 BLOCKED |
| 1 | TQ2 | — | 只提交 | — | — |
| 2 | T1 | 69 | 65 | 3 | 1 BLOCKED |
| 2 | T2 | 62 | 58 | 3 | 1 没开始 |
| 2 | T3 | 99 | 97 | 2 | 0 |

- TP 的数按回复的逐项表（`dsh/t-reply-TP.md`）算。最终说明（`dsh/tb-TP-final.md`）写 147／11／15“含被吸收条目”，按逐项表重算不出：9 条被吸收的条目都记 done。
- TQ 的数按回复的逐项表（`dsh/t-reply-TQ.md`）算。回复的交接一节写“100 done”，是加错了：100＋3＋5＝108，不是 115。
- 下面写的是施工时的状态和之后的结局。

### wave 1

**TP 的 partial（TP-025、030、054、099、108、118、165）：**

- TP-025，旧根和旧格式：两个旧根子项先留 BLOCKED。B-02 按 R-4 删了 `:237`、`:477` 两行（覆盖它们的是 `A2-step1-codecs.test.ts` 的坏链编解码测试），`:304` 按 R-2 补 `finalizedAt`。返工后这 3 条不再红。
- TP-030、TP-118，手写的已接受事实：`state.set` 原地改写已接受的请求、授权、Reviewer 摘要，是只有篡改才能造出的状态。B-03 删一条；B-04 逐条断言裁定：三个原地改写的子例按 R-3 删，已结束 Run 的子例改真实 Runtime。
- TP-054：
  - C1 夹具的部分，真实 start 只到 `entering`，模型调用 0 次（B-05）。W1-13 用真实 prepare、start 加 A3 闸门关掉。
  - WP1-units 的部分是 Runtime 替身（B-06 → W1-10），仍 BLOCKED：WF01 没有公开步骤改 Goal 的目标或工作区（`graph-context.ts:181`、`goal-settings-machine.ts:233`）。WF02 的公开原因存在，但同一行有两半，按 R-5 整行保留 R-2 的写法。
- TP-099，S5 的检查点：
  - 治理部分已改公开：政策的安装和启用走公开 bootstrap，架构走 `adoptInitialArchitecture`。
  - Project@1、Workspace@3 和采用前的 Goal@6 仍是两个手写 `seedCommit`（`S5-decision-fixture.ts:560`、`:599`），按 B-14 留 BLOCKED。
  - W2-21 后来用公开的 `createProject`、`registerWorkspace` 加 `setLinePins`、`createGoal` 等走到这些版本（107 个 importer 钉住 Goal @7–@9 和 Workspace@3）。按 R-4 只去掉了持久化的空 `noticeSeen` 前置。
- TP-108，`seedRun` 按 B-08 逐处裁定：
  - B-08(a) 的 late-lower-end 先留 BLOCKED（B-14）。W2-25 后来按 A6 改成真实的游标拒绝行，断言收紧为 `source_stale`。
  - B-08(a) 第二个 Run 的 prepare、start 在返工 1 标 BLOCKED。W2-17 后来改成真实（R-7）；later-Turn 子例按 R-4 删掉，W2-17 仍是 partial。
- TP-165，AD06 和 AD08：
  - AD06 用真实的“没进入就失败”加 Host 对账可以转，W2-10 做了。
  - AD08 的绑定里没有工作区来源，工作区从 @7 到 @8 不会出 `revision_conflict`，在 `t-base` 也是这样。保留基线写法，缺口进 L-1。

**TP 的 BLOCKED（TP-010、072、081、091、117、124、146、148、163）：**

- TP-010，说明书没定：`selectedTaskInputs` 的删除范围和规格后注没定。B-01 后来撤掉：这个字段仍是当前格式，真实 prepare 会写它，不用动。
- TP-072、TP-091，R9 的真实历史没定：先留手写行。W2-20 后来用 103 个真实 Run 改了。
- TP-081，真实 start 到不了：C1 只到 `entering`。W1-13 关掉。
- TP-117，手写的已接受事实（和 TP-030、TP-118 同一原因）：B-04 逐条断言裁定。已接受的 ReviewWork 加 running 的基础状态留 BLOCKED（R-5），因为真实的来源读取对 ReviewWork 回 `unsupported`（`source-authority-reader.ts:158`），属于没有入口。
- TP-124，没有公开入口：Agent requeue 没有 Runtime 工具入口（GAP-46）。真实 start 在任何模型调用之前就拒了 `requeue_task`（`execution-driver.ts:239-243`）。W2-22 仍 BLOCKED，进 L-3。
- TP-146、TP-148、TP-163，说明书没定公开路径：分别是 Kernel slot 冲突的触发点、Host 探测和归档链、GR 世界与 GR06/07 的映射。后来都改成公开步骤：
  - TP-148 按 B-09 在返工 1 做完；W2-08 时探测那一步是 BLOCKED，W3-08 补完。
  - TP-146 按 W2-23 改成 A6 行。
  - TP-163 按 W2-24 改了，并按 R-6 更正了事实。
- 上面的 BLOCKED 都对过 `books/t-w1-findings.md` §5–§6 和 `books/t-w1r1-findings.md` §3、§5：没有只凭回复保留的 BLOCKED，每条都有拒绝它的检查或缺失入口的 `file:line`。

**TQ：**

- TQ-001（partial）：真实的初始计划入口把 planId 定成 `initial-plan-<hash>`，造不出 `plan:p1`，DSH 请 lead 裁定。lead 在 B-15 按 R-1 关掉：`plans/propose` 的草稿正文是公开输入，S0 走 propose 加测试草稿是允许的，Codex 的 v2 清单也确认了。§5 不采纳 G3-03。
- TQ-091（partial）：
  - 生产端的收窄做完了。回复记下两处下游夹具仍种裸 baseline，当前读回 `unavailable`。
  - `task-claim-fixture` 由 wave 1 合并关掉：TP-107 已改成公开 `adoptInitialArchitecture`。
  - `R4b-session-directory` 先由 lead 的 `5daea2e` 补当前格式的目录行，再由 W1-27 改成公开 `adoptInitialArchitecture`。
  - W1-43 另修 `S3-prepared-context-admission` 自己世界里的裸 baseline，这是 TQ-091 和 TP-054 合在一起后的回归。
  - B-15 记为关闭。
- TQ-111（partial）：22–62 行要“计划把 Task 物理移除”，公开的计划改动会拒绝（`plan-validation.ts:338`）。B-11 在返工 1 按 R-4 删了这一行，W2-14 确认删除成立；目录竞争那半段保留 wave 1 的转换。物理移除的检查（`plan-validation.ts:337-338`）没有直接测试，进 L-2。
- TQ-103、TQ-104、TQ-112（BLOCKED）：`seedAcceptedTask`、占用、取消、链接、归档都要一个合法的已接受 Plan。B-10 让先公开 propose、review、adopt，再按书的路由走（R-5）。
  - 返工 1 做完了：`seedAcceptedTask` 改走公开的 adopt → createGoal → proposePlan → readPlanProposal → applyPlanChange。
  - 归档链改成公开的 claim（不开负责链接）→ busy → 真实取消没进入的 Run → 开链接 → 归档被拒 → 关链接 → 归档。
  - `graph-session-fixture.ts` 不再有 `overwriteSession`。三条都关掉了。
- TQ-114（BLOCKED）：混合世界和 IN14。B-12 让 IN14 用真实的 send 和 reply，跨工作区的 Run 行按 R-4 删，其余 Plan、Run 改公开（R-5）。W2-18 后来把三个 Run 种子和 IN14 改成真实 claim、start、finish。
- TQ-115（BLOCKED）：IN11、IN12。B-13 让 IN11 走真实的 open、begin、result、finalize；IN12 的 FAIL 后继到不了，按 R-4 删。W3-05 后来用真实 runner。
- TQ2（19:42–19:45）只提交 `5057649`，没有做条目。

### wave 2

- T1-025、T1-068：事件子项没有公开的事件读口。§0 定了留给用户（L-5），不在这一轮修。
- T3-106：A2-disposition 的 guard 2、9 还留着 `seedRun`、`seedLease`、`humanStop`，BLOCKED 的理由不成立。W2b-10 改成真实的 `outcome_unknown`，取消放进 A3 提交包装里真实发出。
- T1-036：`S2B-r2-r5-not-entered.test.ts` 手造旧形状的 Run，改了它就会红，DSH 回退以保住提交。W2b-57 删掉这个只测旧形状的测试（79-1）。生产端改成：Run 没有 `executionHistory`、要回头读派发记录而派发记录又不在时，抛 `unavailable`。`provenNotEnteredKernel` 从此没有测试，进 L-2。
- T1-070：第二个 Goal 被 `K3-35-runtime.ts:113` 收窄的授权挡住。W2b-20 加了第二个 Goal 的可选授权和真实链。
- T3-080：`K3_35_TASK_ID` 还有外部 importer。§0 接受保留这个导出，按接受的适配关掉。
- T3-103：`executed-files-stub.ts` 还在。DSH 说三个调用方不在白名单，但其中 `K3-review-card-fixture.ts` 和 `S2A-window-fixture.ts` 就在 T2 的白名单上，只有 `S5-decision-routes.test.ts` 不在。W2b-26 把三处都接上真实读取器，删了替身。
- T2-034：segment a 到时间上限，没开始。W2b-35 做了真实的 init → Session → claim → prepare → start，在进入提交时取消。
- T2-025：observer-down 行留着直接调用，因为 `publish` 固定什么都不做（`execution-driver.ts:1253`），没有 observer 接缝。W2b-53 按 R-20 有三处，W2b-49 按 R-18，条目仍 partial。
- T3-064：“所有语言问题为空”到不了，`dist/z.ts` 是合法的跳过。W2b-44 改成恰好一条跳过的问题，原因用手写字面量。
- T3-067：W2b-47 把被删的 `tests/data/S8D-platform-fixture.test.ts` 第二次抓取的那一例原样恢复（h.py → g.py 的边，Python 文件数 3）。T3-067 对这一例没做，进“留给用户”。

## 审查和问题表

六张表各自冻结，行号不重编。

### W1：W1-01..W1-44、B-01..B-15（R-1..R-6）

- 来源：Codex 对合并后 wave 1 副本的 7 组全审（`codex/t-aud-G1..G7`），去重前 会出错 5、违规 35、不整洁 20。lead 逐条对书、对代码后冻结 44 行和 15 条 B 裁定。合并副本全量的 16 项回归立为 W1-43、W1-44。
- 怎么关：返工 1 `ed26c44` → 返工 2 `1c31c27` → 返工 3 `254617d`。Codex 对返工 3 的审查又出 1 条会出错（IN05）和 1 条违规，lead 按决定 81 落了 `67d547d`、`d4c4cea`。wave 1 收在 `d4c4cea`。
- 结局：44 行里 40 行 done，2 行 partial（W1-26：AD06 转了，AD08 留着；W1-28：claim 子项经 W2-11 仍 BLOCKED），2 行 BLOCKED（W1-10、W1-15）。W1-21、W1-25 返工 1 后是 BLOCKED，分别经 W2-16、W2-15 做完。
- B 行：B-01 撤掉；B-02..B-13 都按裁定处理（B-12、B-13 由 W2-18、W2-19 和 W3 的行收口）；B-14 在返工 1 后另列 7 条仍 BLOCKED；B-15 关掉。
- 不采纳：§5 的 4 条（7 个 Codex 发现）不改。G2-02 的文字本来就对；G6-05 的真实 prepare 已是当前格式的最小路径；G7-04、G7-05 按 R-2 不动；G3-03、G5-02、G7-03 按 R-1 是公开输入。W1-19 按 R-6 改用 `historical_explanation`，没有照原样落。
- B-14 的 7 条由 W2 表 §3 裁定。Codex 的评估（`codex/t-r1-B14`）是：改 5 条，按 R-4 删 1 条（TP-099 只删到不了的持久化空 `noticeSeen` 前置），保留 1 条。返工 2 把其中 6 条改成公开链：
  - W2-20：TP-072、TP-091，用 103 个真实 Run；
  - W2-21：TP-099；
  - W2-23：TP-146，A6；
  - W2-24：TP-163，GR 世界的公开链；
  - W2-25：TP-108(a)，A6，断言收紧为 `source_stale`。
  只有 TP-124 仍 BLOCKED（W2-22，没有入口，`execution-driver.ts:239-243`）。
- 最后仍 BLOCKED 的：
  - W1-10：WF01 没有公开步骤改 Goal 的内容，到不了；
  - W1-15：真实 finish 写最终的 RunActivity，回填不替换，到不了；
  - W1-26 的 AD08：产品缺口（L-1）；
  - B-04 的已接受 ReviewWork：没有来源读取的 provider，属于没有入口。

### W2：W2-01..W2-25（R-7..R-9）

- 来源，合计 25 行：
  - Codex 对返工 1 的两组审查（`codex/t-r1-R1`、`t-r1-R2`），会出错 1、违规 7、不整洁 6。lead 对回返工 1 的表和代码，14 条全部成立，成为 W2-01..W2-14。
  - 同两组审查对 BLOCKED 的核对给出了公开路径，lead 按 R-7 重开 5 个 BLOCKED 部分，成为 W2-15..W2-19（W1-25、W1-21、B-08(a)、B-12、B-13）。
  - Codex 对 B-14 的逐条评估（`codex/t-r1-B14`）成为 6 条裁定，即 W2-20..W2-25。
- 怎么关：返工 2 `1c31c27`，25 行都处理了。W2-08 的探测那一步后来由 W3-08 关掉；W2-17 的 later-Turn 子例按 R-4 删，条目仍 partial；W2-14 只改回复。
- 不采纳：没有整行不采纳。W2-14 只更正了 B-11 的覆盖来源：`plan-validation.ts:337-338` 的物理移除检查没有直接测试，进 L-2。
- 仍 BLOCKED：
  - W2-11：没有入口，没有公开读能显示请求槽没有 claim（`plan-readers.ts:598`、`decision-contracts.ts:247`）；
  - W2-22：GAP-46，没有入口；
  - W1 的 W1-10、W1-15、B-04 的 ReviewWork、AD08 继续保留。

### W3：W3-01..W3-12（R-10..R-12）

- 来源：Codex 对返工 2 的两组审查（`codex/t-r2-Q1`、`t-r2-Q2`），会出错 1、违规 9、不整洁 2。
- 怎么关：DSH 返工 3 `254617d`，回复报 12 行全部 done；W3-12 只更正回复里的账本配对（`S3-graph-context.test.ts:917` 属 W2-24）。
- 复核时发现 W3-01 的 done 不成立：W1R3 全量 772/773，IN05 在两个后端都失败（查找索引 `session-anomaly-by-task` 没登记；DSH 的环境没有 bubblewrap，没跑到）。Codex 的 `codex/t-r3-P1` 的 1 条会出错和 1 条违规都归 W3-01，其余 11 行没问题。lead 按决定 81 落了 `67d547d`、`d4c4cea`。
- 不采纳 0；BLOCKED 0（W3-08 的探测是真实步骤）。

### W2b：W2b-01..W2b-57（R-13..R-22）

- 来源：
  - Claude 预审 6 部分：40 确认、4 否决；
  - Claude 账本覆盖 11 块：15 确认、4 否决；
  - Codex 6 部分：会出错 15、违规 47、不整洁 8；
  - wave 2 合并全量（`checks/full-W2a.txt`）：760/766 个文件，8 项失败，9,724 过、3 跳过、2,797 秒；
  - segment a 剩下的。
  lead 逐条核后冻结 57 行。R-22 在 17:10 补上。
- 怎么关：按用户 14:41 的决定交 Claude 子 agent，三个工作流共 18 个 agent（5＋8＋5），另 3 个单 agent（W2b-36、W2b-09、W2b-20）。lead 自己做的几行见“合并和 lead 的修”。lead 逐个看 diff，按副本提交，合成 `722ddf3`；W2b-20 由 `03b9cfd` 补上，R-22 给它 `600_000` 的超时。
- 结局：
  - 55 行 done，2 行 partial：W2b-17 的 C Reduction 没有公开读；W2b-55 的观测指针版本和 `readThrough` 没有公开读。两条都按 R-20 记为没有入口。
  - W2b-09 返工 1 时是 partial，W2c-01 按 R-24 改成 done。
  - W2b-42 在返工 1 做完：在锁定的范围里跑真实 Query，用返回的 `answerRef` 批准，断言 `forbidden` 且设置快照不变，两行拒绝都按 R-18。返工 2 时 lead 只更正了表 §6 里“只跑 SQLite”的理由：memory Host 给了 `settingsDirectory` 也有设置（`src/app/host.ts:324-329`）。这一行仍只跑 SQLite。
- 不采纳：§5 的 12 条（引了 16 个发现）。
  - 6 条不改：B2 的历史位置按 R-16；guard 2 的顺序让真实路径成立；S3-host 的计划正文是公开输入；`vi.mock` 的捕获按 R-21；T1-015 只是回复的措辞；P T1a-06、P T3b-07 被怀疑者驳回。
  - 3 条已落成行：W2b-04、W2b-17、W2b-46。
  - 3 条按 §0 处理：T2-051 按接受的适配；K3-19 是白名单漏的；S5 的默认路径交用户。
- 仍 BLOCKED 的类别：W2b-17（没有入口，`plan-contracts.ts:89-125`、`goal-phase.ts:21-31`）、W2b-55（没有入口，`architecture-observation.ts:53-60`）；W2b-53、W2b-54 的 R-20 子部分让 T2-025、T2-029、T2-031、T2-032 保持 partial。W2b-57 是这一轮唯一的生产改动（见上面 T1-036）。

### W2c：W2c-01..W2c-14（R-23、R-24）

- 来源：
  - Codex 对返工 1 的 3 部分（`codex/t-w2r1a-P1..P3`）：会出错 3、不整洁 1；
  - Claude 4 部分，各带对抗核对（`claude/w2r1-claude-audit.md`）：19 条，13 确认、6 驳回；
  - W2R1 全量（`checks/full-W2R1.txt`）：765/766，9,773 过、3 跳过、3,017 秒，唯一的失败是 W2b-20 的 store page 两项（30 秒），`03b9cfd` 修了。
- 怎么关：按用户 18:14 的决定交 Claude 子 agent，4 个副本。lead 看 diff，按副本提交 `222cd58`、`fc63710`、`36fa14b`、`9aef728`，合成 `c05c7d7`；14 行全 done。
- 不采纳：§3 的 8 条。
  - 5 条不新开行：gate 只有一个承载者、`k3_35` 的导出，不改；第二个 F07，进用户的清单；K3-48-2 的 Session、K3 审查轮的 Session，归 S5 默认路径，交用户。
  - 1 条路线冲突，选了 task-graph 读（W2c-01）。
  - 2 条落成行：W2b-55 的尾巴作为表的更正落成 W2c-05；W2b-41 作为建议落成 W2c-13。
- 仍 BLOCKED：W2b-55 的观测指针版本和 `readThrough` 仍按 R-20 记为没有入口。W2c-04 的 183 字节、`27272b14…55d5` 的摘要，lead 自己重算相等。

### W2d：W2d-01..W2d-05

- 来源：
  - Codex 对返工 2 的两部分：0 条；
  - Claude 两部分，各带对抗核对（`claude/w2r2-claude-audit.md`）：5 条，5 确认，其中不整洁 3、建议 2；
  - W2R2 全量（`checks/full-W2R2.txt`）：766/766，9,774 过、3 跳过、3,476 秒。
- 怎么关：五行都是一两行的小改，lead 在 `w2r2-A` 副本里自己改（决定 80-4）→ `9a69bdb`，5 个测试文件 +15/−6。类型检查 0；相关测试 6/6，游标测试 2/2；Codex 快速核对 `codex/t-w2r3q` 0 条。wave 2 的三轮返工到此结束。
- 不采纳 0；BLOCKED 0。

## 裁定 R-1..R-24

1. **R-1（t-w1）** 规则表 v2 约束返工；公开路由或工具从外面收到的值是公开输入，即使它的类型叫草稿（`plans/propose` 的正文是一例）。
2. **R-2（t-w1）** 必须保留的种子可以补到当前格式：只加当前编解码要求的字段，值取当前写入方写的值，其余和断言都不动，回复里记为 FORMAT。
3. **R-3（t-w1）** 只有原地改写已接受的记录才造得出的行，是只有篡改才有的状态：删掉这一行，写出说明没有公开步骤能造出它的 `file:line`；生产检查保留。
4. **R-4（t-w1）** 没有公开步骤到得了的行删掉，写出拒绝那个状态的检查的 `file:line`；这一行要说的如果是一个现有检查会做的拒绝，就保留为 A6 行。
5. **R-5（t-w1）** 裁定说“改”，但公开步骤仍到不了时，这一行标 BLOCKED 并留证据，保留 wave 1 或 R-2 的写法，不另造第三条路。
6. **R-6（t-w1）** 问题里说的事实和代码不符（那一行写的不是它说的）时不照着改，在回复里带 `file:line` 报出来。
7. **R-7（t-w1r1）** 共用的真实 Runtime helper 能到“已进入”“运行中”“已结束”，“没有接 Runtime”不再算 BLOCKED 的理由；BLOCKED 要写出拒绝它的检查或缺失入口的 `file:line`。
8. **R-8（t-w1r1）** Runtime 发出的值（Kernel 身份、位置、消息 id）从公开读按返回的用，测试不自己编一个替代值。
9. **R-9（t-w1r1）** 保持 BLOCKED 的部分保留 `ed26c44` 的写法，除非那一行另有说明。
10. **R-10（t-w1r2）** 要进程沙箱的测试用 `CODING_AGENT_BWRAP_PATH` 跑；沙箱在 DSH 的环境里仍失败时，报为环境失败，由 lead 在全量里跑，不换掉真实的 runner。
11. **R-11（t-w1r2）** 期望值不能在运行时用生产函数算（`canonicalJson`、`sha256Hex`、编解码、常量），要写字面量，并在注释里写出算法；平台返回的值按返回的用，字面量用来核对它。
12. **R-12（t-w1r2）** 最后一轮返工里做不完的行报 partial 或 BLOCKED，带 `file:line`，不绕路；剩下的交 Codex 补丁。
13. **R-13（t-w2b）** note-tools 适配器的 A7 豁免覆盖它自己的整个契约：参数映射、默认值、透传、工具名、`effectClass`、metadata、严格 schema 的拒绝。
14. **R-14（t-w2b）** 不擅自加大超时；只有某一行明确允许时，最多 `120_000`，只加在那个测试上，注释和回复里写 `--maxWorkers=2` 的实测时间。
15. **R-15（t-w2b）** 改共用 helper 不能让别的测试钉住的 id、位置或时间移动；改完要跑所有直接或间接用它的测试文件。
16. **R-16（t-w2b）** Kernel 历史位置由平台发出：测试按返回的比较（两次公开读之间，或 Runtime 提交的窗口），不写位置字面量；数量和长度才写手算的字面量。
17. **R-17（t-w2b）** 并成一个的测试，名字里要带每个来源的规格行 id。
18. **R-18（t-w2b）** 改过来的拒绝行放在 `describe('rejects: …')` 里，一行一个错误，前后各一次公开读证明没变。
19. **R-19（t-w2b）** 服务层的行在 memory 和 SQLite 上都跑；只跑 SQLite 的行要写理由（Host 重启）。
20. **R-20（t-w2b）** 这张表送进 BLOCKED 的子部分原样回到 `w2-base` 的写法，回复里写类别（只有篡改才有、到不了、没有入口）和 `file:line`，条目记 partial，不绕路。
21. **R-21（t-w2b）** 包住真实后端工厂、把平台自己的真实后端原样交给测试的包装，算 A4。
22. **R-22（t-w2b）** W2b-20 的 store page 行是规模行：205 个真实的 blocked Run，实测 memory 65–69 秒、SQLite 162–168 秒；只有这个测试可以用最多 `600_000` 的超时，实测时间写在注释里，并进用户的 L-4。
23. **R-23（t-w2r2）** 对测试自己定的输入算的摘要，是用 `node:crypto` 手算的字面量（注释里写规范文本和字节数），不经过生产的编解码；对测试没定的材料算的摘要，按返回的往下传。
24. **R-24（t-w2r2）** W2b-09 和 W2b-55 的 BLOCKED 部分撤销：有些事实有公开读（W2c-01、W2c-05），R-20 只在表里写明的地方保留。

另外一条（`t-w2r2` §0）：规则表 v2 的 A7 第 3 条还写着 `executeChecks: false`；W2b-27 之后替身没有这个选项了，读作“替身只回答可不可用，它的 probe 和 execute 都拒绝”。下一版规则表改这句。T 的 v2 是从 v1 分出来的，不含 K3、L8 那份 v3 的 A7 透传进程沙箱一条和崩溃夹具的写法；下一片之前两份合成一份（lead 的事）。

## C1 交给 T 的

lead 在合并树 `e99b385` 上核过，`grep` 都按当前的 `src`、`tests` 算。

- 裁定 3，N0 来源行 → TP-002（Codex P1-183）。T 之前在 31 个文件的第 1 行：`src/contracts/` 下 24 个，`src/contracts/core/` 4 个，`src/contracts/validation/` 3 个。TP-002 只删这一行注释；其中 7 个文件的声明由别的条目另改（如 TP-011、TP-013、TP-014、TP-017）。现在 `grep -rn "Migrated contract declarations" src` 为 0。
- 裁定 8，旧游标的容忍 → TP-064（P1-184）、TP-066（P2a-14）。`track-read-model.ts` 的 `decodeQueryCursor` 现在要求 `ca` 是字符串或 null，缺了就回 null（游标无效）；`ca ?? null` 和“earlier versions”那句注释删了。
- 裁定 12，`TaskClaimOutbox` 的重复形状和 `TaskDispatchStateV1` → TP-003（P1-186）、TP-040（P1-185）。现在 `TaskClaimOutbox = DispatchOutboxRecord`；`TaskDispatchStateV1` 在 `src` 和 `tests` 里都是 0 处。
- 裁定 14，RL-15b 的下界 → TQ-092（P1-187）。下界 9,900 ms（`:360`、`:403`），上界 12,000 没动。
- 决定 85-4，`N0GoalInput` → TP-001（P1-188）。`src` 和 `tests` 里 0 处。

## 覆盖率

- **T 之前**（`coverage/before-summary.txt`）：
  - Claude 子 agent 在副本 `s9tcov` 里跑，13:29–15:25，跑了两次。第一次没写报告，因为 `coverage.reportOnFailure` 默认关着；第二次加上这个开关。
  - 两次都只有 `tests/architecture/boundaries.test.ts` 的 13 项失败，原因是当时还没批准新依赖 `@vitest/coverage-v8`。
  - 结果：语句 75.38%、分支 69.58%、函数 89.02%、行 83.78%；1,129 个函数、23,577 条分支没执行到，30 个文件一行都没执行（29 个在旧界面 `src/ui`，加 `src/contracts/reviewer-work.ts`）；报告里 487 个文件。
- **T 之后**（`coverage/after-summary.txt`，合并树 `e99b385`，4 个并行，4,727 秒）：
  - 766 个文件全过。
  - 语句 75.33%、分支 69.46%、函数 89.09%、行 83.78%；1,113 个函数、23,214 条分支没执行到；一行都没执行的文件仍是那 30 个。
- **前后对比**（`coverage/mapped-summary.txt`，按 T 的 diff 把 T 之前的行号对到 T 之后再比；在 T 没改的文件上和直接按行比的结果一致）：
  - T 之前执行到、T 之后没执行到的：212 条分支、6 个函数。这是 T 删掉或改掉了最后一个执行到它的测试。
  - T 新写或改写的行上没执行到的：100 条分支。
  - T 前后都没执行到的：22,902 条分支、1,107 个函数（630 个在 `src/ui`；T 之后 `src/ui` 里没执行到的函数是 631 个，多出的 1 个是 T 删测试后才没执行到的）。
- **分拣**（决定 79-4：真不会发生的才删，会发生但没测的记成测试缺口，不删）：
  - 分拣范围：上面前两组（218 行和 100 行），加上第三组里 `src/ui` 以外的 477 个函数，共 795 行。第三组的 22,902 条分支没有分拣：T 之前就没执行到，不是 T 造成的。
  - 做法：
    - Codex 分 8 组只读分拣（`codex/t-cov-*`）；Claude 子 agent 独立分拣同样的 795 行（35 个 agent）。两边一致 628 行，不一致或有一边待定的 167 行（`coverage/triage/triage-merged.tsv`）。
    - DSH 裁定（`books/t-cov-judge.md`，`dsh/tb-Tjudge-final.md`，逐批结果在 `coverage/triage/judge-out/`）：
      - 不一致的 167 行逐行裁定：Codex 对 68 行、Claude 对 87 行、两边都不对 12 行；
      - 两边都说 T 删错测试的 19 行（8 处），逐处找反例；
      - 两边一致判 D1、D2、U 的 276 行逐行找反例；被质疑的 28 行再裁一次，原判成立 17 行、改判 11 行（2 行 U → G，9 行 D2 → U）。
    - 两边一致判 G、F 的 352 行里，19 行就是上面那 8 处，已经专门核过；其余 333 行没有再复查：它们只记成测试缺口，不删代码；万一判错，补测试时会发现走不到。
    - DSH 报 IN05“在合并树上看起来是红的”，不成立：IN05 没有跳过，合入全量 766 个文件全过；它只是执行不到这里的几行。DSH 的总结说被质疑的有 29 行，实际是 28 行（以 `judge-out/tie-skep-*.json` 里的行为准）。
  - 结果（`coverage/triage/triage-final.tsv`、`triage-final-summary.md`）：

    | 类 | 行数 | A（T 删了最后一个测试） | B（T 新写或改写） | C（从没执行到的函数） |
    |---|---|---|---|---|
    | D1 走不到 | 55 | 2 | 0 | 53 |
    | D2 不会发生 | 156 | 55 | 30 | 71 |
    | U 只有篡改才会发生 | 157 | 87 | 36 | 34 |
    | F 外部故障能到、没测 | 161 | 23 | 12 | 126 |
    | G 公开步骤能到、没测 | 265 | 51 | 22 | 192 |
    | N 不适用 | 1 | 0 | 0 | 1 |
    | 待定 | 0 | 0 | 0 | 0 |

  - 处置（决定 79-4）：
    - D1、D2 共 211 行是删除候选。少数要留：给后面分片打的底（例如 A3-021，第 9 片 Reviewer 用的审查绑定），或者删了会收窄已冻结接口的（例如 A2-032，第 5 片端口的结果类型）。逐行写进删除的任务书。
    - U 157 行不补测试（AGENTS 第 4 条）。只为旧格式留的容忍按决定 79 删；防存储损坏的完整性检查留着。
    - F、G 共 426 行记成测试缺口，不删代码。
  - **T 删错的测试：8 处、19 行。** DSH 逐处找反例，都没推翻：T 之后没有别的测试测到这些行为，T 写的理由对这些行不成立。补回的步骤在 `coverage/triage/judge-out/tw-01.json` 到 `tw-08.json`。
    1. TQ-114（裁定 B-12）删了 IN04：引用另一个工作区里的 Run 材料要被拒（`forbidden`）。B-12 的理由“要另一个工作区里本 Goal 的 Run，走不到”只对手造的那种形状成立：第二个工作区里另一个 Goal 的真实 Run 走得到。TQ-115（B-13）还删了 IN12 里“最终 FAIL 的门 → `missing`”那一断言。行 A1-032、034、035、036，G。
    2. T1-062 删了 changed-lease、added-lease 两行，理由是“Lease 单独存在，走不到”；真实 claim 和读取之间的并发走得到。行 A1-059、061，F。
    3. TP-109 删 A8-1d 的暂停变体时说“现在的行为由 W-05 覆盖”，不成立：在 Entering 时提交的暂停，由 RUN-16 撤销后还排着，再由对账写成 `paused`（`STATE-MACHINES-SPEC.md:1879`），W-05 没有这一变体。行 A1-077，F。
    4. TP-172 删 M05 时，连“按当前 Goal 过滤”的那次读一起删了；这次读和旧数据无关。行 A2-054、055，G。
    5. T1-038 删了 2C-14／L11（读工作线时来源正在变 → `source_moving`），理由是“只有改写读回内容才到得了”；并发写入就能到。行 A2-059 至 063，F。
    6. T3-063 把 A-07 并进 S8E 时，书写明要带上“符号链接不进清单”的输入和断言，否则保留原测试。输入带上了，但夹具的读取授权只认写过的文件，这一行到不了，断言是空过的。行 A3-038，G。
    7. TP-026 删旧索引时，书要求把 tsconfig `include` 的断言挪到 `typescript-source-query.test.ts`；只挪了通配的那种，具体文件名的 `include` 没有测试。行 A3-039，G。
    8. TQ-093 删 v1 迁移测试时，把“没有存储记录时显示偏好为空”的现行行为一起删了（`UI-WORKBENCH.md:256`）。行 A3-040 至 042，G。

## 留给用户

逐项的出处和细节见 `books/t-end-list.md`。

1. **L-1 AD08，生产缺口。** 第 3 片规格 AD08 要求：装配之后工作区从 @7 变到 @8，进入时要回 `revision_conflict`。生产的绑定里没有工作区来源（`graph-context-reader.ts:1010`），`t-base` 时就这样；旧测试是靠 helper 手加工作区来源才过的。选生产修复（T 之后做，像决定 85-5 的两处小修）或改规格。
2. **L-3 TP-124／GAP-46。** Agent 要重新入队时没有 Runtime 工具入口：真实 start 在任何模型调用之前就拒了 `requeue_task`（`execution-driver.ts:239-243`）。
3. **没有公开读口的几处。** 下面的测试还直接读存储或留着替身，因为没有公开读能显示这些事实。加公开读，或接受缺口：
   - W2b-17／T1-062：一个 Task 完整的 TaskReduction（只有 `completeTask` 的返回）；
   - W2b-53／T2-025、T2-031、T2-032：执行历史的三个子部分（两个到不了，一个没有等待入口）；
   - W2b-54／T2-029：没有平台映射的 Kernel Session（目录只读已映射的记录）；
   - W2b-55／T3-038：观测指针的版本和 `readThrough`；
   - L-5：T1-025、T1-068 的事件子项（没有公开的事件读）；T2-025 的 observer-down（没有 observer 接缝）。
4. **L-2，只剩生产守卫、没有测试的几处。** T 删了只靠篡改才到得了它们的测试：
   - `provenNotEnteredKernel`（`src/contracts/run-activity.ts:91`；删掉的 `S2B-r2-r5-not-entered.test.ts` 经 `readTrackBars` 走到它，`track-read-model.ts:312`）；
   - `plan-readers.ts:1390` 的过滤；
   - T1-061、T1-062 两行的守卫；
   - `plan-validation.ts:337-338` 的物理移除检查；
   - B-03 后面的复查。

   “只靠篡改才到得了”是 T 删除时的判断；分拣后的结论如下，以这里为准：
   - `provenNotEnteredKernel` 的四个分支（B-009 至 012）是 G：授权之后、开始之前取消就能走到，记成测试缺口；
   - `plan-readers.ts:1390` 的过滤（A1-050）是 U，不补测试；
   - T1-061、T1-062 的守卫：A1-059、061 是 F，属于 T 删错的第 2 处；A1-060、A1-097 是 D2；A1-062、063、A1-098 是 U；
   - B-03 后面的复查：`source-capture-access.ts:596`（A3-024）是 U；同一文件的 A3-018、023、025 是 G；
   - `plan-validation.ts:337` 的物理移除检查 T 之前就没执行到，不在这次分拣的 795 行里。
5. **覆盖率分拣的结果**，见上一节。
6. **T 漏删的旧数据代码。** Session 记录现在必须有 `provenance`（`session-record-codecs.ts:736`），但处理“来历为空”的一整条链还在生产代码里：`session-facts.ts` 的 `legacyPending`，读它的维护、对账和异常读取，工作线的 `provenance_unchecked` 标记。TP-122 写了要和生产端的补来历一起删；补来历删了（TP-007、TP-062），这些没删。按决定 79 应删，可以和分拣里要删的一起做一次小修。
7. **K3 和 L8 原定进 T、T 没列成条目的欠账。** T 的盘点覆盖整套测试，碰到同一文件时顺带改了一部分：
   - K3：T1-023 的 K3-48-2、TP-142 的 F-052、TP-110 的 F-091 一部分、T3-081 的 F-014、T2-022 的 F-027、W2b-27 的 F-019 替身、第 7 本书里的旧 T 文件；
   - L8：T3-044 的 K4-25–K4-41、TP-107 的 T33、T1-003 加 W2b-01 的 T35、T3-039 的重放测试。
   其余还是 T 之前的样子：
   - K3：F-067、F-066、G3、G5、N-04 的五个超时、`B2-blocked-runtime` 的手造 WorkspaceFile、T-040，以及没碰到的形式行；
   - L8：没有公开步骤到得了的重放分支、接受请求时取消不了、主机 scope key 里的 NUL、归档把取消读成读不到，以及测试形式的 A、B、J、UNSPECIFIED 2–5、P3 的夹具、WP2 的 K4-42–K4-53、T34、T36–T69、Q6、Pub:332。
   可以再做一轮 T 式的清理，可以并进以后碰同一文件的片，也可以记为有日期的限制。
8. **L-4，测试变慢。** 全量从 T 前约 2,520 秒（决定 85-5 合入时那次），到 2,457 秒（W1R1）、3,072 秒（W1R2）、3,017 秒（W2R1）、3,476 秒（W2R2）、3,592 秒（合入时）；最后两次是和覆盖率同时跑的。慢的原因是真实世界换掉了手写状态。两个测试按裁定加大了超时：W2b-08 是 `120_000`（SQLite 34–49 秒）；W2b-20 的 store page 是 `600_000`（205 个真实 blocked Run：memory 65–69 秒、SQLite 162–168 秒；R-22）。
9. **条目以外还剩的手写状态**（规则表 v2 只管 T 的条目）：
   - S5 决定夹具的默认路径：手写的 Session 和“已进入”，K3 的世界继承它；W2b-21 在旁边加了一条真实路径，改过的行用它；
   - T1-053 剩下的：`S4C2-note-card-fixture.ts` 的 `createAuxSession` 自己写 Kernel Session；
   - 条目以外的 F1 实例（v2 清单）；
   - `WP2-context-extensions.test.ts` 的第二个 F07：5,000 张卡，期望的 key 用 `decisionSourceKey` 算，`anomalyDouble`，只跑 memory；
   - T3-067 恢复的那一例（见 wave 2）。
   可以再做一轮，也可以留着。
10. **规格的小问题。** 执行历史的读取器自己不查调用者是谁；另一个调用者的游标只由下面的 Session 历史 owner 拒绝（`session-operations.ts:426`）。

## lead 自己的事

- 下一版测试规则表：T 的 v2 和 K3、L8 的 v3 合成一份，连同 A7 第 3 条的措辞，下一片之前做。
- 决定 83-3 说“基础提示词让模型用 `check`，平台却没给这个工具”，这处矛盾放进 C1 或 T；两轮都没做，转进第 6、7 片的“提示词和上下文”一节。
- 下一次小修时顺手改 `create-platform.ts:941-943` 的注释：它还说测试用的 executed-files 替身由第 5 片的测试注入，替身已经删了。
- 全仓 `--noUnusedLocals` 下有 293 个没用的名字（T 碰过的文件里 12 个，都早于 T），只记下。
- 这次合入的文档提交里已改：能力索引里提到已删文件或已删行为的行、STATE-MACHINES-SPEC 的 S1-SES-02 和 `replyMode`、`docs/refactor/modules/core/workspace.md`、第 1 片规格 SV03 的后注、DSH-WORKFLOW 的 §6.10 和规则表一节。

## 已知限制

- 没有调用真实模型；整个 MVP 还没完成。
- 全量都在 WSL 里带 bubblewrap 跑。DSH 的沙箱里没有 bubblewrap，沙箱测试由 lead 补跑（R-10）。
- 覆盖率由 V8 统计，只看执行到没有，不说明断言是否有用；分拣只看了上面的 795 行，T 之前就有的另外约 2 万条没执行到的分支只按文件统计。
