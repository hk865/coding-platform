只读审查完成；未修改文件，未运行测试、构建或网络操作。G-04 仍有一个可证明的错误，其余发现涉及测试证据、修改范围和注释。

**1. 发现表**

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G2-01 | 会出错 | `src/core/work-graph/tasks/execution-entry-service.ts:1306`、`:1658`；`src/core/work-graph/state/context-input.ts:215` | G-04：`.lead-ref/audit1/G.out.md:12`；冻结裁定 `.lead-ref/books/pc2-findings.md:107` | **外层 binding 的结构检查仍然晚于读取。** 在其余合法的 continuation manifest 中令 `contextAssembly=null`，重新保存并更新 manifest 摘要。loader 未检查该字段（`execution-entry-service.ts:432`），verdict 在进入新增 helper 前就读取 `.sections`，异常被转为 `unavailable`；应返回的 `invalid` 检查在 `context-input.ts:267`，尚未到达。缺少 `contextAssembly` 同样如此。现有新增例只覆盖 `sections=[null]`（`tests/work-graph/PC2-G-entry-guard.test.ts:125`）。 | 在读取 `manifest.contextAssembly.sections` 前，先调用状态层的 binding／sections 结构检查并返回 `invalid`；公开入口测试补上 binding 为 `null` 和缺失两例。 |
| G2-02 | 违规 | `tests/work-graph/PC2-G-entry-guard.test.ts:93`、`:109`；`tests/state/PC2-G-context-order.test.ts:117` | G-01；决定80：`.lead-ref/books/pc2-findings.md:9`、`:104` | **没有证明 Query 入口确实执行冻结顺序检查。** 新增入口反例均调用 Work 的 `startRun`（同文件 `:51`）；另外两例只直接调用纯 helper。DSH 所称 helper `return null` 会被发现，但仅删除 Query 的调用与拒绝分支（`src/core/work-graph/queries/query-execution.ts:1072`）仍不会使这些测试失败。 | 新增经公开 `bindPreparedQuery` 的两条反例：自身合法但与冻结顺序不同、冻结集缺少对应 call kind；均断言 `invalid`。以仅绕过 Query 这次检查的变异验证测试。 |
| G2-03 | 违规 | `tests/state/PC2-G-I19-frozen.test.ts:22`、`:31`、`:33`、`:61`、`:66` | G-05、G-06；独立期望要求：`.lead-ref/books/pc2-findings.md:9`；`.lead-ref/books/run-pc2-r1.md:45` | **I-19 的“正确全文”与被测检查同源，冻结材料也未充分区分。** 测试从生成包取得模板、字符串和工具表，再调用生产 renderer 生成 `manifest.input` 与范围；checker 又调用同一 renderer（`tests/state/invariants.ts:1932`）。虽然最终期望是字面量 `[]`，正文正确性仍是自证。字符串表完全等于平台表，模板只改标题且没有工具条件（平台原文 `resources/prompts/platform/templates/continuation-brief.txt:1`）；因此把 checker 的工具参数改为 `[]`，或把传入字符串表换回平台表，这两例仍通过。 | 在新增 PC2 文件中重写这组证据：brief 摘要、个人模板、不同于平台的字符串、明确的工具列表、正确全文及边界均用独立字面量或手算值；模板加入能区分工具列表的条件，分别验证忽略冻结字符串、忽略工具列表及删除边界检查的变异。不得用生产 renderer 生成正确全文。 |
| G2-04 | 违规 | `tests/state/invariants.test.ts:37`、`:1397` | 旧测试范围：`.lead-ref/books/pc2-book.md:913`、`:922`；返工范围 `.lead-ref/books/run-pc2-r1.md:48`；G-05/G-06 唯一改法 `.lead-ref/audit1/G.out.md:13`、`:14` | **新增29行不在该旧测试获准的修改范围内。** 文件确属 G（book `:778`），也在白名单（`.lead-ref/books/pc2-r1-whitelist.txt:22`），但 §5.3 只允许跟随段序／范围断言调整。G-05、G-06要求修改 I-19 的读取与检查，没有授权在旧文件追加个人包和越界测试；F3 的增补清单也没有该项（`.lead-ref/books/pc2-findings.md:48`）。所有权和白名单不能替代具体修改授权。 | 撤回本轮在该旧文件新增的 import 和28行测试块；G-05/G-06 的新增验收放在允许新增的 `PC2-` 测试文件中，按 G2-03 修正。 |
| G2-05 | 不整洁 | `src/core/work-graph/state/context-input.ts:212`、`:233`、`:239`；`src/core/work-graph/tasks/execution-entry-service.ts:1148`；`src/core/work-graph/queries/query-execution.ts:1070` | 本次审查要求6；注释规则 `.lead-ref/books/pc2-book.md:64` | 新增生产注释写入 `G-01`、`G-02`、`G-03`、`G-04` 返工行号。规则及原因有保留，但混入了施工标记。 | 删除这些生产注释中的返工行号，保留规则、原因及规格裁定引用。 |
| G2-06 | 不整洁 | `tests/state/PC2-G-context-order.test.ts:113`、`:115`、`:116` | G-01 的反例条件：`.lead-ref/audit1/G.out.md:9` | 注释说被交换的两个可选段“不在实际输入中”，但 `parts` 明确包含 `FOOTPRINT`、`NOTES`；实际段顺序与 binding 顺序也相反。这不是注释所说的“自身合法、仅不同于冻结集”的 binding。直接测试 helper 仍能发现不等，但该输入说明不实。 | 将该例的 `parts` 改为 `[ROLE, GOAL, TASK]`，保留两份 order 中的可选段及交换，使输入符合声明的反例条件。 |

**2. 逐行结论**

- G-01：G2-02、G2-05、G2-06。实现的逐元素比较和缺项拒绝正确，Work、Query 均已接入：`src/core/work-graph/state/context-input.ts:98`、`:104`；`src/core/work-graph/tasks/execution-entry-service.ts:1150`；`src/core/work-graph/queries/query-execution.ts:1072`。
- G-02：G2-05。功能与反例 OK；删除双 LF 检查会使新增反例失败：`src/core/work-graph/state/context-input.ts:236`；`tests/state/PC2-G-continuation-range.test.ts:40`。
- G-03：G2-05。原始字节比较正确；换回有损解码比较会使新增反例失败：`src/core/work-graph/state/context-input.ts:241`；`tests/state/PC2-G-continuation-range.test.ts:54`。
- G-04：G2-01、G2-05。`sections=[null]` 已修，DSH 指定的删除元素检查变异会被发现；外层 binding 仍漏检：`tests/work-graph/PC2-G-entry-guard.test.ts:121`；`src/core/work-graph/tasks/execution-entry-service.ts:1306`。
- G-05：G2-03、G2-04。读取冻结模板、字符串和工具表的代码已接通：`tests/state/invariants.ts:545`、`:553`、`:567`、`:1932`。恢复两参数 renderer 会失败，但不能据此证明字符串和工具列表均受测试保护。
- G-06：G2-03、G2-04。安全整数及完整范围边界检查正确；删除边界检查会使新增纯 checker 用例失败：`tests/state/invariants.ts:1943`；`tests/state/PC2-G-I19-frozen.test.ts:65`。
- G-07：OK。已恢复 `[startByte-2,endByte)` 与双 LF 加正文的比较：`tests/work-graph/K3-35-owner-manifest-trim.test.ts:109`；单 LF／同步偏移的变异不能通过该断言。
- G-08：OK。目标用例已降为 `60_000`：`tests/work-graph/PC2-G-entry-guard.test.ts:91`。
- G-09：same as J-11，OK。真实收缩例断言手算范围、完整 review／reminder，然后调用 `start()` 并要求成功：`tests/runtime/PC2-joint-shrink-entry.test.ts:143`、`:157`、`:160`。恢复“review 必须最后”会使该入口断言失败。

附带的 `WP1-units-fixture.ts` 三处改动是 F1 必需的接口适配，没有改断言：`tests/helpers/WP1-units-fixture.ts:438`、`:475`、`:551`；对应冻结要求见 `.lead-ref/books/pc2-findings.md:26`。

**3. DSH 自报事项**

- §1.5 中 G-09 按 J-11 完成：**成立**；真实 shrink 已进入公开启动步骤，见 `tests/runtime/PC2-joint-shrink-entry.test.ts:160`。
- §1.6 中 `invariants.test.ts` 的 `finalize_first` 属无 bubblewrap 的环境后果：**成立**。测试配置真实命令检查（`tests/state/invariants.test.ts:168`）；沙箱不可用时，在 `beginCheck` 前返回 `unsupported`（`src/core/agent-runtime/check-execution.ts:164`、`:169`、`:172`）；工作流因此返回 `waiting/next:null`（`src/business/workflow/workflow.ts:2472`、`:528`）；测试驱动遇到 `next:null` 就返回，随即 requeue（`tests/state/invariants.test.ts:264`、`:297`）；开放 round 被拒为 `finalize_first`（`src/core/work-graph/state/no-progress.ts:179`、`:281`）。基线已有相同驱动及 requeue 顺序：`.lead-ref/base/tests/state/invariants.test.ts:263`、`:296`。这不是本轮29行导致的失败；DSH“实际复现过”的执行声明未在本审查中重跑。
- §1.6 中“29个 bwrap 跳过导致 fuzz coverage 红”的具体解释：**不成立为已证实结论**。coverage 只在全部11个 seed 完成后检查操作计数，并不读取跳过数量（`tests/state/invariants-fuzz.test.ts:212`、`:216`、`:217`）；fuzz 的 `gate.skipped` 指没有新写入而省略不变量检查（`tests/scenarios/support/fuzz.ts:174`）。缺沙箱可以造成操作覆盖不足，但仅凭回复中的“29”不能证明这次 coverage 失败的具体原因。

**4. 同一发现的 JSON**

```json
[
  {
    "id": "G2-01",
    "class": "会出错",
    "file": "src/core/work-graph/tasks/execution-entry-service.ts",
    "line": 1306,
    "basis": "G-04；.lead-ref/audit1/G.out.md:12；.lead-ref/books/pc2-findings.md:107",
    "problem": "contextAssembly 为 null 或缺失时，continuation verdict 在进入结构检查前读取 .sections，异常在 execution-entry-service.ts:1658 转为 unavailable；应返回 invalid。新增测试仅覆盖 sections=[null]。",
    "fix": "在读取 .sections 前调用状态层的 binding/sections 结构检查并返回 invalid；公开入口测试补上 null 和缺失 binding 两例。"
  },
  {
    "id": "G2-02",
    "class": "违规",
    "file": "tests/work-graph/PC2-G-entry-guard.test.ts",
    "line": 93,
    "basis": "G-01；.lead-ref/books/pc2-findings.md:9、:104",
    "problem": "新增反例只经过 Work startRun 或直接调用纯 helper；仅绕过 src/core/work-graph/queries/query-execution.ts:1072 的冻结顺序检查，这些测试仍通过。",
    "fix": "新增经公开 bindPreparedQuery 的合法但不同顺序、缺少对应冻结顺序两例，断言 invalid，并用仅绕过 Query 检查的变异验证。"
  },
  {
    "id": "G2-03",
    "class": "违规",
    "file": "tests/state/PC2-G-I19-frozen.test.ts",
    "line": 33,
    "basis": "G-05、G-06；.lead-ref/books/pc2-findings.md:9；.lead-ref/books/run-pc2-r1.md:45",
    "problem": "正确全文和范围来自生成包及生产 renderer，checker 又用同一 renderer 自证。字符串表等于平台表，模板没有工具条件；忽略冻结工具列表或改回平台字符串仍能通过。",
    "fix": "用独立字面量或手算值重写 brief 摘要、个人模板、不同的字符串表、工具列表、正确全文及范围；加入能区分工具列表的条件，验证忽略冻结字符串、忽略工具列表和删除边界检查的变异。"
  },
  {
    "id": "G2-04",
    "class": "违规",
    "file": "tests/state/invariants.test.ts",
    "line": 1397,
    "basis": ".lead-ref/books/pc2-book.md:913、:922；.lead-ref/books/run-pc2-r1.md:48；.lead-ref/audit1/G.out.md:13、:14",
    "problem": "新增29行虽位于G所有且白名单允许的文件，却超出旧测试获准的段序/范围断言调整；G-05、G-06及F3均未授权追加这些旧测试。",
    "fix": "撤回本轮新增的 import 和28行测试块；新增验收放在允许新增的 PC2 测试文件中，并按 G2-03 修正。"
  },
  {
    "id": "G2-05",
    "class": "不整洁",
    "file": "src/core/work-graph/state/context-input.ts",
    "line": 212,
    "basis": "本次审查要求6；.lead-ref/books/pc2-book.md:64",
    "problem": "新增生产注释包含返工行号：context-input.ts:212、:233、:239，execution-entry-service.ts:1148，query-execution.ts:1070。",
    "fix": "删除生产注释中的 G-01 至 G-04 施工行号，保留规则、原因及规格裁定引用。"
  },
  {
    "id": "G2-06",
    "class": "不整洁",
    "file": "tests/state/PC2-G-context-order.test.ts",
    "line": 115,
    "basis": "G-01反例条件；.lead-ref/audit1/G.out.md:9",
    "problem": "注释声称交换的可选段未出现在输入中，parts 却包含 FOOTPRINT 和 NOTES，实际段顺序也与 binding 相反，不符合所声明的反例条件。",
    "fix": "将该例 parts 改为 [ROLE, GOAL, TASK]，保留两份 order 中的可选段及交换。"
  }
]
```

会出错 1，违规 3，不整洁 2，建议 0