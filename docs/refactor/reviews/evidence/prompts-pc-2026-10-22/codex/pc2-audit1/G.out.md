只读审查完成；未运行测试、构建或网络操作。以下结论均由代码和 `base/` 差异静态推导。

**1. 发现表**

G-02、G-03 的纯 guard 反例共同使用合法的 continuation 绑定：`schemaVersion=1`、`formatVersion='s3-context-v1'`、`duty='executor'`、`sectionOrder=['role','goal','task','continuation']`，各段 `omitted=0`，预算 4096、驻留字节 0，sources、inputSelections、selectedTaskInputs 均为空。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G-01 | 会出错 | `src/core/work-graph/tasks/execution-entry-service.ts:1140`；`src/core/work-graph/queries/query-execution.ts:1063` | `.lead-ref/books/pc2-book.md:356`，裁定11 | **未比较 binding 与冻结 PromptSet 的顺序。** 两条入口只把 binding 交给 guard。反例：在合法准备结果中，仅交换 binding.sectionOrder 中两个本次未出现的合法可选段，如 footprint、notes，保留 promptSet.sectionOrder，重新存入 manifest 并更新摘要。实际段顺序仍通过，入口可接受；裁定要求逐元素相等，应为 `invalid`。 | 给状态 guard 传入冻结集对应 call kind 的顺序并逐元素比较；Work、Query 均调用，缺少该项也拒绝。 |
| G-02 | 会出错 | `src/core/work-graph/state/context-input.ts:190`；旧版 `.lead-ref/base/src/core/work-graph/state/context-input.ts:206` | `.lead-ref/books/pc2-book.md:54`、`:368` | **删除尾部限制时，也删除了段前双换行限制。** 输入 `R\n\nG\n\nTB`，totalBytes=8；role `[0,1)`、goal `[3,4)`、task `[6,7)`、continuation `[7,8)`，rendered=`B`。旧版返回 `invalid`，新版返回 `null`。此例仍在尾部，变化与允许非尾部无关。review 使用同一 helper，也受影响。 | 在绑定范围前检查两个 LF，保留非尾部支持；不要恢复“必须最后”。 |
| G-03 | 会出错 | `src/core/work-graph/state/context-input.ts:80`、`:190`、`:193` | `.lead-ref/books/pc2-book.md:365`，裁定12的字节相等 | **有损 UTF-8 解码可把错误字节范围判成正确文本。** 输入 `R\n\nG\n\nT\uFFFD\n\n中`，totalBytes=15；role `[0,1)`、goal `[3,4)`、task `[6,10)`、continuation `[12,13)`，rendered=`\uFFFD`。范围只包含“中”的首字节 `E4`，解码却得到替代字符；全文唯一的真实替代字符在 task 内。旧版拒绝，新版两项检查均通过，返回 `null`；正确结果应为 `invalid`。 | 范围内容与 rendered 的 UTF-8 Buffer 做原始字节相等比较，避免用替代字符解码结果证明字节相等。 |
| G-04 | 会出错 | `src/core/work-graph/tasks/execution-entry-service.ts:1299`、`:1582`、`:1650`；`src/core/work-graph/state/context-input.ts:184` | `.lead-ref/books/pc2-book.md:54`、`:370` | **continuation 的提前检查会把结构错误变成 `unavailable`。** 在其余合法、brief 原文正确的 manifest 中令 `contextAssembly.sections=[null]`。旧版最终由结构 guard 返回 `invalid`；新版在完整 guard 之前执行 `section.name`，抛异常后被捕获为 `unavailable`。完整 guard 原本仍能拒绝该输入，见 `context-input.ts:251`。 | 在 continuation verdict 读取范围前，先经状态层完成 binding/sections 的结构校验，并保留 `invalid`。 |
| G-05 | 会出错 | `tests/state/invariants.ts:1879`；`src/contracts/continuation-brief.ts:517` | `.lead-ref/books/pc2-book.md:370`、`:374` | **I-19 仍用当前默认平台包重渲染。** 合法个人包仅把 continuation-brief 的首行改成 `## CUSTOM-BRIEF`，保留全部槽，准备并授权后，entry 使用冻结文本接受；I-19 却调用两参数 renderer，报告 `the manifest continuation range … is not the rendered brief`。应无 I-19 违反。其 manifest 投影也没有携带冻结文本和工具表，见 `invariants.ts:552`。 | I-19 的读取阶段按 manifest 引用读取冻结模板、字符串表和 toolNames，检查时使用这些冻结材料。 |
| G-06 | 会出错 | `tests/state/invariants.ts:1884` | `.lead-ref/books/pc2-book.md:374`，I-19“同样”按范围检查 | **I-19 未校验范围边界，subarray 的截断掩盖越界。** 对一个合法、brief 在末尾的 world，仅令 continuationRange.endByte=`UTF8(input).length+1`。实际仍返回无违反；正确结果应报告非法范围。完整 guard 会在 `context-input.ts:274` 拒绝同类范围。 | I-19 切片前检查安全整数及 `0 ≤ startByte ≤ endByte ≤ inputBytes.length`。 |
| G-07 | 违规 | `tests/work-graph/K3-35-owner-manifest-trim.test.ts:107`；旧版 `.lead-ref/base/tests/work-graph/K3-35-owner-manifest-trim.test.ts:97` | `.lead-ref/books/pc2-book.md:933`、`:938`，只改尾部假设 | **旧断言的双换行保障被一起删除。** 旧测试明确检查 `\n\n${reviewRender}`；新版仅比较段内正文。把 review 前分隔符删掉并同步范围，新断言仍通过，超出了允许删除的“位于末尾”假设。 | 比较 `[startByte-2,endByte)` 与 `\n\n${reviewRender}`，保留原分隔断言。 |
| G-08 | 违规 | `tests/work-graph/PC2-G-entry-guard.test.ts:58` | `.lead-ref/books/run-pc2.md:75` | 新增非尾部成功测试设置 `120_000`，超过明确规定的 `60_000` 上限。 | 将该用例上限降至不超过 `60_000`。 |
| G-09 | 违规 | `tests/runtime/PC2-joint-shrink-entry.test.ts:101`；`tests/runtime/PC2-review-shrink.test.ts:25` | `.lead-ref/books/pc2-book.md:861`、`:864`，PC-21 guard/entry 半边 | **没有把真实 K3 收缩结果送过入口。** review-shrink 用例止于准备和 manifest 检查；joint 的入口用例实际运行 continuation。若入口恢复“review 必须最后”，这些新增用例仍不会失败。冻结夹具已有公开 `start()`，见 `tests/helpers/PC2-pack-fixture.ts:370`。 | 在 G 的入口测试中，用真实 `openPC2ReviewFixture('shrink')` 调用 `start()`，以字面期望验证成功及 review 后提醒保留。无需改夹具。 |

**2. 逐裁定、逐行核对**

- 裁定5（省略标记）：OK。固定字面和计数核对保留，见 `src/core/work-graph/state/context-input.ts:55`、`:57`、`:108`。
- 裁定9（G 的合法集合与顺序）：OK。role 首位、合法名、重复名、必需 goal/task、实际段顺序分别检查，见 `src/core/work-graph/state/context-input.ts:234`、`:237`、`:238`、`:241`、`:257`。
- 裁定10（G 的冻结工具表透传）：OK。brief、review、提前 brief verdict 都传冻结 toolNames，见 `src/core/work-graph/tasks/execution-entry-service.ts:1055`、`:1139`、`:1297`。
- 裁定11：G-01。
- 裁定12：G-02、G-03、G-04、G-05、G-06。
- 裁定14（G 的 manifest 布尔字段）：OK。Work、Query 都检查 `takesSessionHistory` 类型，见 `src/core/work-graph/tasks/execution-entry-service.ts:494`、`src/core/work-graph/queries/query-execution.ts:473`。
- Query 新字段检查：结构检查 OK，冻结顺序对应关系为 G-01。Query 调用严格 decoder；decoder 检查 sectionOrder、toolNames、tools，见 `src/core/work-graph/queries/query-execution.ts:468`、`src/contracts/prompts/prompt-set.ts:176`、`:185`、`:207`。
- PE9 错误范围：OK；但该公开用例同时平移起止点，单独看会漏掉“只比较起点”的变异，见 `tests/helpers/PC2-pack-fixture.ts:527`。旧 ST08 的仅缩短终点用例能补充发现这一变异，见 `tests/state/context-input.test.ts:183`。
- PE9 重复文本：OK；第二份文本实际插入 goal 段，能发现把唯一性检查改成 `includes` 的变异，见 `tests/helpers/PC2-pack-fixture.ts:530`、`tests/work-graph/PC2-G-entry-guard.test.ts:33`。
- PE9 非尾部成功：行为断言 OK，测试限制为 G-08，见 `tests/work-graph/PC2-G-entry-guard.test.ts:51`。
- PE9 改字符：OK，字面断言为 `invalid`，见 `tests/work-graph/PC2-G-entry-guard.test.ts:42`。
- PC-21 的 G/入口半边：G-09；冻结顺序一致性另见 G-01。
- I-19：G-05、G-06。
- PC2-G-context-order：role 首位、合法名、重复名、顺序四例均能命中对应检查，见 `tests/state/PC2-G-context-order.test.ts:74`、`:82`、`:88`、`:102`。它们都只输入 binding，无法发现“合法但不同于冻结集”的 G-01。
- 旧测试：除 G-07 外，所见改动属于指定机械调整。对应位置：`tests/state/WP1-goal-content.test.ts:57`、`tests/helpers/WP1-units-fixture.ts:437`、`:474`、`:523`、`:551`、`tests/work-graph/S3-prepared-context-admission.test.ts:95`、`:208`、`:550`、`tests/state/context-input.test.ts:163`、`tests/state/invariants.test.ts:1379`、`tests/runtime/K3-unknown-call-review-section.test.ts:123`。
- 范围：G 文件清单符合所有权及白名单；交付差异未列出四个冻结夹具，见 `.lead-ref/parts/G-files.txt:1`、`.lead-ref/books/pc2-book.md:765`、`:778`、`.lead-ref/books/pc2-whitelist.txt:10`、`:17`。新增 helper 有实际生产消费者，并非仅供测试，见 `src/core/work-graph/tasks/execution-entry-service.ts:1298`。

唯一性检查使用 **UTF-16 字符串索引**，但没有把这些索引当作字节偏移比较。`indexOf` 与 `lastIndexOf` 会计入重叠出现，也会计入其他段里的出现；普通中文前缀不会自行造成错位。真正的不一致是 G-03 的有损解码，见 `src/core/work-graph/state/context-input.ts:80`、`:193`。

缺少必需段、越界、重叠这些旧拒绝仍保留，见 `src/core/work-graph/state/context-input.ts:185`、`:271`、`:275`、`:282`。entry 的模板和字符串表确实读冻结 body，未改读当前包，也未新增 Runtime 模块导入，见 `src/core/work-graph/tasks/execution-entry-service.ts:49`、`:1001`、`:1015`、`:1025`。

**3. DSH 自述核对**

- §3 G 的四个入口用例、四类顺序变异存在：**成立**；但不能据此宣称裁定12完整满足，见 G-02—G-06、G-08。自述位置：`.lead-ref/replies/pc2-reply.md:20`。
- “旧测试只机械补字段、去最后假设”：**不成立**，G-07 还删除了双换行保障。自述位置：`.lead-ref/replies/pc2-reply.md:24`。
- joint 已覆盖 PC-21 的 guard/entry：**不成立**，真实 K3 收缩没有启动，见 G-09。自述位置：`.lead-ref/replies/pc2-reply.md:22`。
- §8.2 的 Query 只记录当前模板对应 call kind：**成立**，代码按 planning/copy 模板存在性写入；这不能替代 G-01 的入口比较。见 `.lead-ref/replies/pc2-reply.md:56`、`src/core/agent-runtime/context-rendering.ts:114`。
- §1.3／§8.5 所述 empty review 会触发空必需槽：**成立**；把它当作夹具不可用的缺陷则**不成立**。夹具故意令 `k3.none=''`，writtenLines 是必需槽，该路径正可承载 PE8；G 的收缩入口行使用已有 shrink/start 即可，无需夹具补丁。见 `.lead-ref/replies/pc2-reply.md:7`、`:59`、`tests/helpers/PC2-pack-fixture.ts:338`、`:348`、`:370`、`src/contracts/prompts/slot-tables.ts:54`、`src/contracts/core/prepared-execution.ts:136`。

**4. JSON**

```json
[
  {
    "id": "G-01",
    "class": "会出错",
    "file": "src/core/work-graph/tasks/execution-entry-service.ts",
    "line": 1140,
    "basis": ".lead-ref/books/pc2-book.md:356，裁定11",
    "problem": "Work 和 Query 仅验证 binding 自身顺序，未与 promptSet.sectionOrder[callKind] 逐元素比较。仅交换两个未出现的合法可选段并更新 manifest 摘要，入口仍可接受；规格要求 invalid。Query 对应位置为 src/core/work-graph/queries/query-execution.ts:1063。",
    "fix": "状态 guard 接收冻结集对应 call kind 的顺序并逐元素比较；Work、Query 均调用，缺少该项也拒绝。"
  },
  {
    "id": "G-02",
    "class": "会出错",
    "file": "src/core/work-graph/state/context-input.ts",
    "line": 190,
    "basis": ".lead-ref/books/pc2-book.md:54、368",
    "problem": "删除尾部限制时连带删除了段前双 LF 检查。合法 continuation 绑定输入 R\\n\\nG\\n\\nTB，范围依次为 [0,1)、[3,4)、[6,7)、[7,8)，rendered=B，旧 guard invalid，新 guard null。review 共用 helper，同样受影响。",
    "fix": "在绑定范围前检查两个 LF，同时保留非尾部支持。"
  },
  {
    "id": "G-03",
    "class": "会出错",
    "file": "src/core/work-graph/state/context-input.ts",
    "line": 190,
    "basis": ".lead-ref/books/pc2-book.md:365，裁定12",
    "problem": "UTF-8 切片解码会用替代字符掩盖不完整字节。输入 R\\n\\nG\\n\\nT\\uFFFD\\n\\n中，totalBytes=15，role [0,1)、goal [3,4)、task [6,10)、continuation [12,13)，rendered 为 U+FFFD。范围的 E4 字节解码成 U+FFFD，全文唯一真实 U+FFFD 却在 task 内；旧 guard 拒绝，新 guard 返回 null，应 invalid。",
    "fix": "将范围内原始 UTF-8 Buffer 与 rendered 的 UTF-8 Buffer 做字节相等比较。"
  },
  {
    "id": "G-04",
    "class": "会出错",
    "file": "src/core/work-graph/tasks/execution-entry-service.ts",
    "line": 1299,
    "basis": ".lead-ref/books/pc2-book.md:54、370",
    "problem": "continuation verdict 在完整结构 guard 前使用 sections。其余合法的 manifest 若 contextAssembly.sections=[null]，context-input.ts:184 访问 section.name 抛异常，execution-entry-service.ts:1650 将其转成 unavailable；旧路径由结构 guard 返回 invalid。",
    "fix": "在 continuation verdict 读取范围前，经状态层校验 binding 和 sections 的结构，错误保持 invalid。"
  },
  {
    "id": "G-05",
    "class": "会出错",
    "file": "tests/state/invariants.ts",
    "line": 1879,
    "basis": ".lead-ref/books/pc2-book.md:370、374",
    "problem": "I-19 两参数调用 renderer，使用默认平台包而非冻结文本和工具表。个人包合法修改 continuation-brief 首行后，entry 接受，I-19 却报告范围不是渲染简报；预期应无违反。InvariantManifest 投影也未携带冻结渲染材料。",
    "fix": "按 manifest 引用读取冻结模板、字符串表和 toolNames，I-19 使用这些材料重渲染。"
  },
  {
    "id": "G-06",
    "class": "会出错",
    "file": "tests/state/invariants.ts",
    "line": 1884,
    "basis": ".lead-ref/books/pc2-book.md:374",
    "problem": "I-19 切片前不检查范围边界。合法尾部 brief 的 endByte 改成 UTF8(input).length+1 后，Buffer.subarray 截断终点，I-19 仍无违反；应报告非法范围。",
    "fix": "切片前检查安全整数及 0 <= startByte <= endByte <= inputBytes.length。"
  },
  {
    "id": "G-07",
    "class": "违规",
    "file": "tests/work-graph/K3-35-owner-manifest-trim.test.ts",
    "line": 107,
    "basis": ".lead-ref/books/pc2-book.md:933、938，旧测试只改尾部假设",
    "problem": "旧版第97至100行明确检查 review 前双换行；新版仅检查段内正文。删除分隔符并同步范围后，新断言仍通过，弱化了获准改动之外的断言。",
    "fix": "比较 [startByte-2,endByte) 与双 LF 加 reviewRender，保留原分隔保障。"
  },
  {
    "id": "G-08",
    "class": "违规",
    "file": "tests/work-graph/PC2-G-entry-guard.test.ts",
    "line": 58,
    "basis": ".lead-ref/books/run-pc2.md:75",
    "problem": "新增非尾部成功用例设置 120_000 毫秒，超过 60_000 毫秒上限。",
    "fix": "将该用例上限降至不超过 60_000 毫秒。"
  },
  {
    "id": "G-09",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-shrink-entry.test.ts",
    "line": 101,
    "basis": ".lead-ref/books/pc2-book.md:861、864，PC-21 guard/entry 半边",
    "problem": "joint 入口测试运行 continuation；PC2-review-shrink.test.ts:25 的真实 K3 shrink 仅准备和检查 manifest，没有启动。恢复 review 必须最后的入口限制不会使这些新增用例失败。冻结夹具在 tests/helpers/PC2-pack-fixture.ts:370 已提供 start。",
    "fix": "在 G 入口测试中用真实 openPC2ReviewFixture('shrink') 调用 start，以字面期望验证成功及 review 后提醒保留，无需修改夹具。"
  }
]
```

会出错 6，违规 3，不整洁 0，建议 0