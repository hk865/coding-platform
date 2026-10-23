未发现本轮需要返工的问题。以下结论来自只读核对，未运行测试、构建或变异。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|

逐行核对如下：

| 行 | 结论 |
|---|---|
| X-01 | **OK**。三个 helper、身份计算输入与探针一致；可选参数注释说明了携带 Host 身份的原因。依据 `.lead-ref/books/pc1b-r2-findings.md:27`；探针 `.lead-ref/checks/pc1b-r1-x-probe.sh:14`；实现 `tests/scenarios/harness.ts:779`、`:794`，`tests/scenarios/support/common.ts:742`，`tests/scenarios/support/review-work-root.ts:51`。 |
| P2-01 | **rejected, untouched**。原故障注入保留；本轮只增加获准的原因断言。依据 `.lead-ref/books/pc1b-r2-findings.md:33`；`tests/work-graph/PC-entry-frozen-continuation.test.ts:97`；`.lead-ref/parts/A.diff:1104`。 |
| P2-02 | **OK**。公开 `reason` 已按要求完整字面比较。依据 `.lead-ref/books/pc1b-r2-findings.md:34`；`tests/work-graph/PC-entry-frozen-continuation.test.ts:117`。 |
| P2-03 | **OK，accepted as built，未改**。保留纯快照契约测试及实际调用点，没有新增快照读口。依据 `.lead-ref/books/pc1b-r2-findings.md:35`；`tests/runtime/PC-prepare-prompt-freeze.test.ts:154`；`src/core/agent-runtime/execution-preparation.ts:396`。 |
| P2-04 | **OK**。两例暂停时均改变 `reasoningReplay`；Query 补齐两个字面断言。依据 `.lead-ref/books/pc1b-r2-findings.md:36`；`tests/runtime/PC-prepare-prompt-freeze.test.ts:128`、`:183`、`:198`。 |
| P2-05 | **OK**。三个旧例已删除显式限时。依据 `.lead-ref/books/pc1b-r2-findings.md:37`；`tests/work-graph/PC-entry-frozen-continuation.test.ts:75`、`:129`；`tests/work-graph/PC-entry-frozen-review.test.ts:75`。 |
| P2-06 | **OK**。相关限时均为 `60_000`。依据 `.lead-ref/books/pc1b-r2-findings.md:38`；`tests/runtime/PC-prepare-architecture-reminders.test.ts:24`，`tests/runtime/PC-prepare-prompt-text-put-failure.test.ts:28`、`:42`，`tests/runtime/PC-prepare-prompt-freeze.test.ts:152`、`:210`，`tests/runtime/PC-prepare-review-freeze.test.ts:71`。 |
| S2-01 | **rejected, untouched**。仍让准备与启动使用同一模型绑定。依据 `.lead-ref/books/pc1b-r2-findings.md:44`；`tests/helpers/S2B-runtime-steps-fixture.ts:405`；`tests/helpers/task-claim-fixture.ts:513`、`:521`。 |
| S2-02 | **OK**。公开记录断言为 `[700,700]`、`[744,800]`；手算为 `1000−min(256,400)=744`、`1000−min(256,400−200)=800`。依据 `.lead-ref/books/pc1b-r2-findings.md:45`；`tests/runtime/PC-model-budget-preview.test.ts:49`、`:53`、`:54`、`:82`、`:83`。 |
| S2-03 | **OK**。预留期望已改为字面量 `700`、`256`。依据 `.lead-ref/books/pc1b-r2-findings.md:46`；`tests/runtime/PC-model-budget-preview.test.ts:105`。 |
| S2-04 | **OK**。旧例的显式限时已删除。依据 `.lead-ref/books/pc1b-r2-findings.md:47`；`tests/runtime/PC-model-budget-preview.test.ts:87`。 |
| S2-05 | **OK**。四例注入本地字面模板和字符串，用手写完整输入比较整段模型消息。依据 `.lead-ref/books/pc1b-r2-findings.md:48`；`tests/runtime/PC-send-frozen-prompt.test.ts:28`、`:109`、`:112`、`:140`、`:165`；`tests/runtime/PC-send-platform-root.test.ts:113`、`:116`、`:146`、`:173`。 |
| S2-06 | **OK**。第一次启动后改变原绑定的 provider/model，再公开启动，核对原执行身份、revision 和零新增模型调用。依据 `.lead-ref/books/pc1b-r2-findings.md:49`；`tests/runtime/PC-send-start-check.test.ts:335`、`:343`、`:348`、`:352`。 |
| S2-07 | **OK**。两处限时降为 `60_000`。依据 `.lead-ref/books/pc1b-r2-findings.md:50`；`tests/runtime/PC-send-start-check.test.ts:263`、`:311`。 |
| S2-08 | **OK**。两个 PC-10 用例限时降为 `60_000`。依据 `.lead-ref/books/pc1b-r2-findings.md:51`；`tests/runtime/PC-joint-record-and-failure.test.ts:188`、`:211`。 |
| S2-09 | **OK**。PC-07 限时降为 `60_000`。依据 `.lead-ref/books/pc1b-r2-findings.md:52`；`tests/runtime/PC-joint-freeze-and-pin.test.ts:103`。 |
| R2-01 | **OK**。四处限时均降为 `60_000`。依据 `.lead-ref/books/pc1b-r2-findings.md:58`；`tests/runtime/PC-read-record-work-query.test.ts:75`、`:115`、`:134`、`:150`。 |
| R2-02 | **OK**。文件头准确描述 ref 校验及完整 Work ref 的 `unavailable`，其余成员仍为 `unsupported`。依据 `.lead-ref/books/pc1b-r2-findings.md:59`；`src/core/agent-runtime/runtime.ts:7`、`:151`、`:158`。 |
| J2-01 | **OK**。只填入公开 brief digest 和 `openVerification` 返回的 roundId；其余输入手写，整段比较，无正则归一化。依据 `.lead-ref/books/pc1b-r2-findings.md:65`；`tests/runtime/PC-joint-budget-removal.test.ts:36`、`:98`、`:134`、`:138`、`:151`。 |
| J2-02 | **OK**。指定 `preparedTexts()` 调用及依附断言已删；必要事实仍由模型请求覆盖。依据 `.lead-ref/books/pc1b-r2-findings.md:66`；`tests/runtime/PC-joint-prepare-freeze.test.ts:276`、`:294`，`tests/runtime/PC-joint-freeze-and-pin.test.ts:123`，`tests/runtime/PC-joint-budget-removal.test.ts:82`、`:151`。 |
| J2-03 | **rejected, untouched**。工具正文与摘要之间的关系断言保留。依据 `.lead-ref/books/pc1b-r2-findings.md:67`；`tests/runtime/PC-joint-record-and-failure.test.ts:69`、`:74`。 |
| J2-04 | **OK**。三份旧测试仅迁移导入和字面段头；导出、重导出、allowlist 条目均删除。依据 `.lead-ref/books/pc1b-r2-findings.md:68`；`.lead-ref/parts/A.diff:9`、`:22`、`:53`；`tests/runtime/S3-context-assembler.test.ts:765`、`tests/runtime/S4C2-assembly.test.ts:358`、`tests/work-graph/S3-role-profiles.test.ts:206`。 |
| J2-05 | **OK**。保留 `wire-format`，说明准确指向返回结果的 requests 元素类型。依据 `.lead-ref/books/pc1b-r2-findings.md:69`；`tests/architecture/production-reach-allowlist.json:1278`；`src/contracts/prompts/prompt-set.ts:62`；`src/core/agent-runtime/ports.ts:89`。 |
| J2-06 | **OK**。四个 joint 文件的 12 处显式限时均为 `60_000`。依据 `.lead-ref/books/pc1b-r2-findings.md:70`；`.lead-ref/parts/A.diff:138`、`:147`、`:158`、`:179`、`:190`、`:199`、`:218`、`:237`、`:248`、`:257`、`:266`、`:275`。 |
| 规则 T | **OK**。三个目录现有 40 处显式单测限时均为 `60_000`；diff 只有 24 处下调、4 处删除，没有其他测试限时改动。依据 `.lead-ref/books/pc1b-r2-findings.md:74`；上述限时行，以及 `.lead-ref/parts/A.diff:295`、`:1099`、`:1120`、`:1131`。 |

变异声明的静态核对：

| 行 | 点名变异为何会失败 | 该用例仍会漏掉的同规则变异或边界 |
|---|---|---|
| X-01 | 去掉 `openWorkRoot` 的身份传递后，默认 revision 与 Host 冻结身份不同，启动在 begin 前被拒，取锁断言失败。`src/core/agent-runtime/execution-driver.ts:110`、`:599`；`tests/scenarios/A8-host-restart-entry.test.ts:468`、`:476`。 | 单独去掉 review root 的身份传递，不由 A8-2d 这个用例检出；该例调用的是普通 root。`tests/scenarios/A8-host-restart-entry.test.ts:468`；`tests/scenarios/support/review-work-root.ts:51`。 |
| P2-02 | 不可读分支改为抛错，会被外层 catch 加上另一种原因前缀，完整 reason 比较失败。`src/core/work-graph/tasks/execution-entry-service.ts:1012`、`:1637`；`tests/work-graph/PC-entry-frozen-continuation.test.ts:117`。 | 只破坏后续字符串表读取失败分支，此例不会检出：故障停在第一次模板读取。`tests/work-graph/PC-entry-frozen-continuation.test.ts:104`；`src/core/work-graph/tasks/execution-entry-service.ts:1021`。 |
| P2-04 | 两个 reasoningReplay 延迟读取分别得到 `current_run`；Query packId 延迟读取得到 `person-changed`，均不同于字面期望。`tests/runtime/PC-prepare-prompt-freeze.test.ts:128`、`:137`、`:182`、`:183`、`:200`。 | 单看这两个暂停用例，把 reasoningReplay 硬编码为 `none` 仍会通过；两例原值都是 `none`。`tests/runtime/PC-prepare-prompt-freeze.test.ts:118`、`:175`。 |
| S2-02 | preview 独自清零累计量，会把第二次预算仍算成 744，不能满足 `[744,800]`。`src/core/agent-runtime/model-budget.ts:92`、`:108`；`tests/runtime/PC-model-budget-preview.test.ts:83`。 | 把累计量错误改成“只计上一条”，此两请求用例仍会通过，因为第二次之前只有一条用量。`src/core/agent-runtime/model-budget.ts:57`；`tests/runtime/PC-model-budget-preview.test.ts:46`、`:62`。 |
| S2-05 | goal 段头少一个字符，会使四份完整输入偏离手写期望。`src/core/agent-runtime/context-rendering.ts:34`；四处整段比较见上表。 | 仅改坏未出现的 footprint 段头，四例不能检出；空可选段被过滤，四份期望没有该段。`src/core/agent-runtime/context-rendering.ts:36`、`:147`；`tests/runtime/PC-send-frozen-prompt.test.ts:109`、`:112`；`tests/runtime/PC-send-platform-root.test.ts:113`、`:116`。 |
| S2-06 | 观察返回前重新解析并完整比较绑定，会读到改变后的 provider/model，使期望 `ready` 的断言失败。`src/app/host-settings.ts:247`；`tests/runtime/PC-send-start-check.test.ts:343`、`:349`。 | 只重新比较未改变的三个 selection 字段，或额外 resolve 后丢弃结果，仍会通过；当前只改变 provider/model，未断言 resolver 调用数。`tests/runtime/PC-send-start-check.test.ts:343`、`:352`。 |
| J2-01 | 标记摘要末位改变后，公开读取仍返回绑定摘要，完整输入比较失败。`src/contracts/continuation-brief.ts:307`；`src/core/agent-runtime/runtime.ts:625`、`:636`；`tests/runtime/PC-joint-budget-removal.test.ts:139`、`:151`。 | 此例不独立验证摘要算法：若摘要计算本身统一出错，而公开值和标记保持一致，允许的公开标识填充不会揭露它。`src/contracts/continuation-brief.ts:302`；`src/core/agent-runtime/runtime.ts:633`；`tests/runtime/PC-joint-budget-removal.test.ts:139`。 |
| J2-04 | 恢复已删除导出的 allowlist 条目，会命中“条目已消失”的断言。`tests/architecture/production-reach.test.ts:104`。 | 对本行指定的“删除导出及条目”要求，未发现仍漏杀的具体变异。删除位置见 `.lead-ref/parts/A.diff:9`、`:22`、`:53`。 |

以上漏杀边界不等于冻结行未完成；冻结表指定的变异均能由当前断言检出。S2-03、J2-02 没有另行点名行为变异，其字面期望替换和删除要求均已完成（`.lead-ref/books/pc1b-r2-findings.md:46`、`:66`）。

S2-06 的对象链成立：夹具把 `first` 交给注册表，并将注册表 resolver 接到 Host；注册表保存对象引用，后续调用该对象当前的 resolver。因此测试替换的正是重新解析时会读到的原绑定（`tests/helpers/PC-platform-fixture.ts:317`、`:323`；`src/app/host-settings.ts:224`、`:247`、`:255`）。测试确实 spy 了生产 Host 工厂的导出，不能表述为“完全不碰生产模块”；但这里只捕获注入参数并改变 Host 回答，没有读取私有 pin、数据库事实或改造 Query 执行状态（`tests/runtime/PC-send-start-check.test.ts:320`、`:343`）。

范围核对：25 个文件的基线及当前内容与 diff 的 blob 标识一致，全部路径在白名单内；每个 hunk 均可归入对应冻结行或规则 T。完整变更清单没有两份冻结夹具，未提供其基线副本，因此不额外声称做过夹具逐字比较（`.lead-ref/parts/A-files.txt:1`、`:25`；`.lead-ref/books/pc1b-r2-whitelist.txt:1`、`:34`）。

生产差异只有 J2-04 的删除和 R2-02 的注释修正，没有新增测试专用执行路径，也未证明返工 2 引入了可给出输入及前后输出的行为回归（`.lead-ref/parts/A.diff:1`、`:14`、`:28`）。新增注释没有施工经过；但原有的 “previous N0” 仍在，不能声称整份生产文件已清除历史措辞。它是原样上下文，不在本轮要求的清理范围内（`src/core/agent-runtime/runtime.ts:6`；`.lead-ref/base/src/core/agent-runtime/runtime.ts:6`；`.lead-ref/books/run-pc1b-r2.md:39`）。

DSH §8 逐项核对：

- **规则 6：成立。** 未发现冻结 fix 行因无法完成而被留下；各项证据见逐行表（`.lead-ref/replies/pc1b-r2-reply.md:180`）。
- **S2-06 接缝说明：成立。** 捕获并修改的是原绑定；限定是 Host 工厂注入接缝，不是私有执行事实读取（`.lead-ref/replies/pc1b-r2-reply.md:181`；`tests/helpers/PC-platform-fixture.ts:317`；`src/app/host-settings.ts:247`）。
- **S2-05 字面期望说明：成立。** 四份完整输入均在测试中手写，没有从 prepared、manifest 或捕获请求生成期望（`.lead-ref/replies/pc1b-r2-reply.md:182`；`tests/runtime/PC-send-frozen-prompt.test.ts:109`、`:112`；`tests/runtime/PC-send-platform-root.test.ts:113`、`:116`）。
- **X 环境失败说明：成立，按冻结的环境归类。** 运行书明确该环境没有 bubblewrap；lead 的独立探针记录 56 文件、192 项通过。不过当前 `68dfb10` 全量文件只有构建等检查结果，没有最终测试汇总，不能据此认定该提交全量已通过（`.lead-ref/books/run-pc1b-r2.md:46`；`.lead-ref/checks/pc1b-r1-x-probe.log:6`、`:8`、`:11`、`:14`、`:17`、`:20`、`:23`；`.lead-ref/checks/full-pc1b-r2.txt:1`、`:7`）。

```json
[]
```

会出错 0，违规 0，不整洁 0，建议 0