S 部分仍有 **6 项违规、3 项不整洁**。以下为只读静态审计；未运行测试、构建或网络操作，未追查交给 X 的 16 个失败文件。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| S2-01 | 违规 | `tests/helpers/S2B-runtime-steps-fixture.ts:400`；`tests/helpers/task-claim-fixture.ts:513` | L-04，`.lead-ref/books/pc1b-findings.md:91` | 当前接法中，两处修改确实互相依赖；但影响没有限定到 S3。`preparationHost` 不传新参数时默认未变（`:521`），S2B 却为所有自定义 `host` 调用者传入启动模型（`:405`），把准备模型从 `test/test` 改成 `deepseek/s2b-runtime-steps-model`。其他受影响调用者包括 `tests/helpers/C1-mailbox-fixture.ts:144`、`tests/helpers/W2-whiteboard-fixture.ts:173`。不满足“or”和其他调用者默认不变。 | 只在 S2B helper 增加显式可选的准备模型绑定，缺省保留原路径；S3 两处调用显式传入匹配绑定。撤回 `task-claim-fixture.ts` 的修改。S3 两处位置为 `tests/work-graph/S3-prepared-context-admission.test.ts:413`、`:656`。 |
| S2-02 | 违规 | `tests/runtime/PC-model-budget-preview.test.ts:75` | S-06；裁决 21，`.lead-ref/books/pc1-book.md:422` | 漏掉“仅预览每次使用新账户”的变异：把 `model-budget.ts:108` 改成 `this.measure(request, { input: 0, output: 0 })`，第二次预览仍预留 256，但真实发送在 `:120` 按累计用量压到 200；现有请求和记录的 cap、成本断言仍通过。错误只留在未检查的 `selection.budget`：第二次为 744，而非 800。报告预算的计算在 `vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:288`。 | 在该公开记录断言中增加字面期望：两次 `selection.inputTokens` 为 `[700,700]`，`selection.budget` 为 `[744,800]`，以此拦住预览单独重置累计用量的变异。 |
| S2-03 | 违规 | `tests/runtime/PC-model-budget-preview.test.ts:99`、`:100` | 冻结表共同期望规则，`.lead-ref/books/pc1b-findings.md:12`；运行书 `.lead-ref/books/run-pc1b-r1.md:43` | 仍有两个期望直接取自生产 `preview()` 的结果。若共同测量把输入计数错误增加 1，这个用例的预览值和预留值一起变化，它仍通过。 | 将这两个期望分别改为字面量 `700`、`256`。 |
| S2-04 | 违规 | `tests/runtime/PC-model-budget-preview.test.ts:81` | 运行书禁止提高时限，`.lead-ref/books/run-pc1b-r1.md:49` | 原用例没有单独时限（`.lead-ref/base/tests/runtime/PC-model-budget-preview.test.ts:74`），使用仓库的 30,000 ms（`vitest.config.ts:9`）；返工改成 120,000 ms。整文件实测仅 2,500 ms（`.lead-ref/checks/full-pc1b-r1-vitest.txt:5404`）。 | 删除新增的 `120_000`，恢复仓库默认 30,000 ms。 |
| S2-05 | 违规 | `tests/runtime/PC-send-frozen-prompt.test.ts:56`、`:91`；`tests/runtime/PC-send-platform-root.test.ts:60`、`:96` | S-07，`.lead-ref/books/pc1b-findings.md:43`；运行书 `.lead-ref/books/run-pc1b-r1.md:43` | 四个 system 已有完整手写期望，但 input 仍以 `prepared.input` 或生产 manifest 的 `input` 为期望。准备时把目标段标题渲染错，发送同一错误正文，这些断言仍通过；前缀检查也发现不了。标题来源见 `src/core/agent-runtime/context-rendering.ts:34`。 | 为这四个场景注入字面输入模板和字符串，手写完整预期 input，并直接与模型消息整段比较；删除从准备结果取 input 期望的做法。 |
| S2-06 | 违规 | `tests/runtime/PC-send-start-check.test.ts:320` | S-08，`.lead-ref/books/pc1b-findings.md:44`；裁决 16，`.lead-ref/books/pc1-book.md:387` | Query“进入后只观察”用例两次启动之间没有改变绑定。若在 `src/core/agent-runtime/query-execution.ts:226` 的观察返回前错误地再次读取并比较绑定，该用例仍通过；因此没有守住“进入后不再重判”的规则。 | 首次进入后，让原绑定的 resolver 返回变化的 provider/model，再次公开启动，断言仍返回原执行的观察且没有新增模型调用。 |
| S2-07 | 不整洁 | `tests/runtime/PC-send-start-check.test.ts:263`、`:311` | 本次审计要求第 7 条 | 两个新增恢复用例各设 120,000 ms；整文件 21,474 ms，两例分别 2,084、2,354 ms（`.lead-ref/checks/full-pc1b-r1-vitest.txt:5263`、`:5275`、`:5276`）。 | 两例均改为 `60_000`。 |
| S2-08 | 不整洁 | `tests/runtime/PC-joint-record-and-failure.test.ts:188`、`:211` | 本次审计要求第 7 条；S-09 | 两个 PC-10 用例各设 120,000 ms；整文件 7,644 ms，两例分别 2,070、1,350 ms（`.lead-ref/checks/full-pc1b-r1-vitest.txt:5338`、`:5341`、`:5342`）。 | 两个 PC-10 用例均改为 `60_000`。 |
| S2-09 | 不整洁 | `tests/runtime/PC-joint-freeze-and-pin.test.ts:103` | 本次审计要求第 7 条；S-10 | PC-07 仍设 180,000 ms；整文件 4,905 ms，该例 2,847 ms（`.lead-ref/checks/full-pc1b-r1-vitest.txt:5361`、`:5362`）。 | 将 PC-07 用例时限改为 `60_000`。 |

逐行结论：

- **S-01：S2-01。** 生产修改和新增用例本身符合要求：两处无条件比较五字段，见 `src/core/agent-runtime/execution-driver.ts:118`、`src/core/agent-runtime/query-execution.ts:97`；用例确实去掉 selection、准备为 `test/test`、启动改 provider/model，并断言 `forbidden` 和零调用，见 `tests/runtime/PC-send-start-check.test.ts:184`、`:192`。
- **S-02：rejected, untouched。** 共享转换及两个调用点保留，见 `src/core/agent-runtime/observed-model-run.ts:222`、`:350`、`:390`。
- **S-03：OK。** 共同结果含 cap、count、fits；preview、发送检查和事实 cap 分别取用它，见 `src/core/agent-runtime/model-budget.ts:91`、`:108`、`:120`，以及 `src/core/agent-runtime/observed-model-run.ts:333`。
- **S-04：OK，同 L-01。** 保留两条所需断言，见 `tests/app/PC-host-prompt-selection.test.ts:259`、`:260`。
- **S-05：归 J，本部分不判定。** 对应 PC-15，见 `.lead-ref/books/pc1b-findings.md:41`。
- **S-06：S2-02、S2-03、S2-04。** 公开准备/启动、真实 read 调用、第二次请求和所要求的四组数字已经加入，见 `tests/runtime/PC-model-budget-preview.test.ts:48`、`:57`、`:65`、`:67`、`:74`、`:77`。
- **S-07：S2-05。** 完整 system 和旧 Skill 正向断言已具备，input 期望仍不合格，见上述四处。
- **S-08：S2-06、S2-07。** Query 两个独立字段拒绝、有句柄拒绝、无句柄先 busy 的断言已加入，见 `tests/runtime/PC-send-start-check.test.ts:234`、`:240`、`:258`、`:305`。
- **S-09：S2-08。** 行要求的零授权、零预留、零 admission 和公开空记录断言已补，见 `tests/runtime/PC-joint-record-and-failure.test.ts:178`、`:182`、`:201`、`:205`。
- **S-10：S2-09。** 公开观察暂停、第一次正常 await、新请求数量和身份、system 全等均已补，见 `tests/runtime/PC-joint-freeze-and-pin.test.ts:65`、`:75`、`:86`、`:89`、`:90`。
- **S-11：OK。** 已恢复 60,000 ms，见 `tests/runtime/B1-kernel-assembly.test.ts:219`。
- **S-12：OK。** 外部选项和转发已删；内部仍按 requestId 存报告，见 `src/core/agent-runtime/observed-model-run.ts:99`、`:391`。搜索所得其他同名调用属于 Kernel 接口，例如 `tests/helpers/PC-kernel-fixture.ts:189`，不属于被删除的外部选项。
- **S-13：OK。** 注释已删除 enabledIds 分句，见 `src/core/agent-runtime/observed-model-run.ts:201`。
- **L-01：OK。** 差异仅删除 import 和存在性断言，见 `.lead-ref/parts/S.diff:224`、`:232`。
- **L-02：OK。** 仅在构建 runtime 前补写指定两个 Skill 文件，内容与参照夹具相同，见 `tests/helpers/S1-workflow-archive-fixture.ts:598`、`tests/helpers/B2-runtime-fixture.ts:186`。
- **L-04：S2-01。** task-claim helper 自身默认保持，S2B 自定义 host 分支的其他调用者默认没有保持。

S-03 的平台请求行为静态比对未发现变化：cap 和完整 JSON 字节计数公式与基线一致，见 `src/core/agent-runtime/model-budget.ts:92`、`:96`，对照 `.lead-ref/base/src/core/agent-runtime/model-budget.ts:88`、`:92`；容量拒绝文本逐字相同，见当前 `:17` 与基线 `:12`。搜索未发现外围累计输出 cap 或 fits 公式副本；事实已直接读取测量结果，见 `src/core/agent-runtime/observed-model-run.ts:333`。

DSH 自述核对：

- **§2 S-06：不成立，作为完整变异证明。** 全局忽略 totals 会被现有 cap 断言抓住，但仅重置预览账户仍漏过；证据和唯一补法见 S2-02。
- **§2 S-07：不成立。** “手拼整段 input”的说法与实际生产来源期望不符，见 `.lead-ref/replies/pc1b-r1-reply.md:32` 和 S2-05。
- **§2 L-04：不成立，作为默认不变的结论。** 自述确实报告了两个文件，但 S2B 对其他自定义 host 调用者的准备绑定也变了，见 `.lead-ref/replies/pc1b-r1-reply.md:39` 和 S2-01。
- **§7.2：不成立，作为当前未决失败。** lead 的 bubblewrap 检查和全量日志均显示 A1 通过，见 `.lead-ref/checks/full-pc1b-r1.txt:1`、`.lead-ref/checks/full-pc1b-r1-vitest.txt:4504`；未重新追查。
- **§7.4：成立。** Kernel 拒绝点是 `vendor/coding-agent/dist/core/runtime/recovery/recovery-coordinator.js:265`：workspace 的 identity、revision、reference 任一不等，`:268` 抛出“当前 workspace 与 Session 记录不兼容”。夹具确实将平台库及 Kernel 库放在工作目录，见 `tests/helpers/WP2-platform-support.ts:786`、`:793`；Git 快照使用 `--ignored=no`，见 `vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js:478`。测试在准备前建立基线并忽略 `*.sqlite*`，见 `tests/runtime/PC-joint-freeze-and-pin.test.ts:32`、`:60`。**这没有隐藏 PC-07 应观察的提示词行为**：变化的 Skill 文件在独立临时目录，见 `tests/helpers/PC-platform-fixture.ts:145`、`:157`；恢复后的请求仍实际比较完整 system，见 `tests/runtime/PC-joint-freeze-and-pin.test.ts:90`。
- **§7.5 中 S-11/S-12/S-13：成立。** 三项静态修改与自述一致，位置分别为 `tests/runtime/B1-kernel-assembly.test.ts:219`、`src/core/agent-runtime/observed-model-run.ts:391`、`:201`。

```json
[
  {
    "id": "S2-01",
    "class": "违规",
    "file": "tests/helpers/S2B-runtime-steps-fixture.ts",
    "line": 400,
    "basis": "L-04；.lead-ref/books/pc1b-findings.md:91",
    "problem": "两处 helper 修改互相依赖，但 S2B 为所有自定义 host 调用者传入启动模型，改变了 S3 之外调用者默认的准备绑定。task-claim-fixture.ts:521 的自身默认未变；C1-mailbox-fixture.ts:144、W2-whiteboard-fixture.ts:173 等调用者受到 S2B 默认变化影响。",
    "fix": "只在 S2B helper 增加显式可选的准备模型绑定，缺省保留原路径；S3-prepared-context-admission.test.ts:413、:656 显式传入匹配绑定；撤回 task-claim-fixture.ts 的修改。"
  },
  {
    "id": "S2-02",
    "class": "违规",
    "file": "tests/runtime/PC-model-budget-preview.test.ts",
    "line": 75,
    "basis": "S-06；.lead-ref/books/pc1-book.md:422",
    "problem": "仅把 model-budget.ts:108 的预览测量改为使用零 totals，真实发送仍将第二次 cap 压到 200，现有 cap 和成本断言继续通过；第二次 selection.budget 错为 744 而非 800，却未被检查。报告预算计算见 vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:288。",
    "fix": "在公开记录断言中增加字面期望 selection.inputTokens 为 [700,700]、selection.budget 为 [744,800]，拦住预览单独重置累计用量的变异。"
  },
  {
    "id": "S2-03",
    "class": "违规",
    "file": "tests/runtime/PC-model-budget-preview.test.ts",
    "line": 99,
    "basis": ".lead-ref/books/pc1b-findings.md:12；.lead-ref/books/run-pc1b-r1.md:43",
    "problem": "第 99、100 行仍从生产 preview 结果取得预留期望，共同测量出错时该用例两侧会一起变化。",
    "fix": "将 reservedInput、reservedOutput 的期望分别改为字面量 700、256。"
  },
  {
    "id": "S2-04",
    "class": "违规",
    "file": "tests/runtime/PC-model-budget-preview.test.ts",
    "line": 81,
    "basis": ".lead-ref/books/run-pc1b-r1.md:49",
    "problem": "原用例在 .lead-ref/base/tests/runtime/PC-model-budget-preview.test.ts:74 没有单独时限，使用 vitest.config.ts:9 的 30000 ms；返工提高至 120000 ms。整文件实测 2500 ms，见 .lead-ref/checks/full-pc1b-r1-vitest.txt:5404。",
    "fix": "删除新增的 120_000，恢复仓库默认 30000 ms。"
  },
  {
    "id": "S2-05",
    "class": "违规",
    "file": "tests/runtime/PC-send-frozen-prompt.test.ts",
    "line": 56,
    "basis": "S-07；.lead-ref/books/pc1b-findings.md:43；.lead-ref/books/run-pc1b-r1.md:43",
    "problem": "本文件第 56、91 行及 PC-send-platform-root.test.ts:60、:96 的 input 期望仍来自 preparedTexts 或生产 manifest。准备与发送使用同一错误正文时断言仍通过。",
    "fix": "四个场景均注入字面输入模板和字符串，手写完整预期 input，与模型消息整段比较，删除生产来源的 input 期望。"
  },
  {
    "id": "S2-06",
    "class": "违规",
    "file": "tests/runtime/PC-send-start-check.test.ts",
    "line": 320,
    "basis": "S-08；.lead-ref/books/pc1b-findings.md:44；.lead-ref/books/pc1-book.md:387",
    "problem": "Query 两次启动之间未改变绑定。在 query-execution.ts:226 的观察返回前错误地再次比较绑定，该用例仍通过，未守住进入后只观察的规则。",
    "fix": "首次进入后，让原绑定的 resolver 返回变化的 provider/model，再次公开启动，断言仍返回原执行的观察且没有新增模型调用。"
  },
  {
    "id": "S2-07",
    "class": "不整洁",
    "file": "tests/runtime/PC-send-start-check.test.ts",
    "line": 263,
    "basis": "本次审计要求第 7 条",
    "problem": "第 263、311 行两个恢复用例各设 120000 ms；整文件 21474 ms，两例分别 2084、2354 ms。证据：.lead-ref/checks/full-pc1b-r1-vitest.txt:5263、:5275、:5276。",
    "fix": "两个恢复用例均改为 60_000。"
  },
  {
    "id": "S2-08",
    "class": "不整洁",
    "file": "tests/runtime/PC-joint-record-and-failure.test.ts",
    "line": 188,
    "basis": "本次审计要求第 7 条；S-09",
    "problem": "第 188、211 行两个 PC-10 用例各设 120000 ms；整文件 7644 ms，两例分别 2070、1350 ms。证据：.lead-ref/checks/full-pc1b-r1-vitest.txt:5338、:5341、:5342。",
    "fix": "两个 PC-10 用例均改为 60_000。"
  },
  {
    "id": "S2-09",
    "class": "不整洁",
    "file": "tests/runtime/PC-joint-freeze-and-pin.test.ts",
    "line": 103,
    "basis": "本次审计要求第 7 条；S-10",
    "problem": "PC-07 设 180000 ms；整文件 4905 ms，该例 2847 ms。证据：.lead-ref/checks/full-pc1b-r1-vitest.txt:5361、:5362。",
    "fix": "将 PC-07 用例时限改为 60_000。"
  }
]
```

会出错 0，违规 6，不整洁 3，建议 0