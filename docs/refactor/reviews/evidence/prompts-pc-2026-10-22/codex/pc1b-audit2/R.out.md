只读静态核对完成；未修改文件、运行测试或构建、联网。发现两项“不整洁”，未发现 R 分片新的“会出错”或“违规”。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| R2-01 | 不整洁 | `tests/runtime/PC-read-record-work-query.test.ts:150` | R-05（`.lead-ref/books/pc1b-findings.md:59`）；本轮检查第 7 条 | 新增无依赖测试设置了 120,000 ms 限时。整个文件四项测试仅耗时 4,535 ms（`.lead-ref/checks/full-pc1b-r1-vitest.txt:5372`），该限时超过 60 秒，也超过文件耗时三倍。 | 将此新增测试的限时改为 5,000 ms。 |
| R2-02 | 不整洁 | `src/core/agent-runtime/runtime.ts:6` | R-05（`.lead-ref/books/pc1b-findings.md:59`） | 文件头仍声称无参数工厂的每个成员都返回 `unsupported`；此次新增的引用校验及完整 Work 引用分别返回 `invalid`、`unavailable`（同文件 `:153`、`:156`），说明已不准确。 | 仅修正文件头，写清无参数 `readPromptRecord` 的引用校验及完整 Work 引用返回 `unavailable` 的例外。 |

逐行结果：

- **R-01: OK**。ref/source 键检查在共同校验器（`src/core/work-graph/tasks/model-request-codecs.ts:101`、`:106`）；授权、快照、事件的新增拒绝测试分别在 `tests/work-graph/B2-model-request.test.ts:30`、`tests/work-graph/A2-step1-codecs.test.ts:942`、`:958`。
- **R-02: OK**。loader 在绑定提交前解码（`src/core/work-graph/queries/query-execution.ts:468`、`:1045`）；两种损坏经真实准备调用公开绑定，断言 `invalid`、revision 和 claimed 状态不变（`tests/work-graph/PC-query-record-usage.test.ts:373`；调用链 `src/core/agent-runtime/query-preparation.ts:356`）。
- **R-03: rejected, untouched**。生产仍返回 `invalid`（`src/core/work-graph/queries/query-execution.ts:1418`）；新增相应断言属于 R-09（`tests/work-graph/PC-query-record-usage.test.ts:428`）。
- **R-04: OK**。类型检查先于缓存命中（`src/core/agent-runtime/runtime.ts:656`、`:660`）；同摘要、同大小、错误类型引用的公开读测试在 `tests/work-graph/PC-query-record-usage.test.ts:386`。
- **R-05: R2-01、R2-02**。功能及消息正确，测试精确比较 `"model request reads are not wired"`（`tests/runtime/PC-read-record-work-query.test.ts:147`）。
- **R-06: OK**。已改用公开读取端口，并保留随后成功消费（`tests/work-graph/PC-record-model-request-facts.test.ts:94`、`:101`）。
- **R-07: OK**。槽位预期使用手写字段顺序及原生 `JSON.stringify`（`tests/work-graph/PC-record-model-request-facts.test.ts:120`）。
- **R-08: OK**。两处均先授权两张许可、断言第二张序号为 2，再消费第一张；“只统计已消费许可”会使第二次授权或序号断言失败（`tests/work-graph/PC-record-model-request-facts.test.ts:49`；`tests/work-graph/PC-record-model-request-read.test.ts:38`；计数生产点 `src/core/work-graph/tasks/model-call-service.ts:216`）。
- **R-09: OK**。逐项只改变一个合法 prompt 事实；usage 另外分别改变三个既有不可变事实；拒绝后公开读取原行（`tests/work-graph/PC-query-record-usage.test.ts:113`、`:417`、`:457`、`:477`）。
- **R-10: OK**。快照与事件均补了 budget 缺失、非法值（`tests/work-graph/A2-step1-codecs.test.ts:932`、`:952`）。
- **R-11: OK**。新增字段逐项损坏、各层未知键、第二元素损坏均有断言；只检查首元素的变异会被最后一项抓住（`tests/work-graph/PC-query-record-codec.test.ts:132`、`:162`、`:177`）。
- **R-12: OK（本分片生产侧）**。Work、Query 均投影记录中的两个摘要及工具引用（`src/core/agent-runtime/runtime.ts:711`、`:739`）；联合测试按本次分工归 J。
- **R-13: OK（本分片）**。测试先精确比较键集，再逐正文核对哈希（`tests/runtime/PC-read-record-work-query.test.ts:29`、`:35`、`:36`）；生产遍历模板、字符串表、base、Skills、请求工具引用（`src/core/agent-runtime/runtime.ts:671`、`:675`、`:677`、`:679`、`:683`）。
- **R-14: OK**。重放捕获的原 reservation，仅改变 `prompt.systemDigest`，断言冲突（`tests/runtime/PC-joint-record-and-failure.test.ts:147`）；生产指纹包含整个输入，且先查询重放（`src/core/work-graph/queries/query-execution.ts:1293`）。

两处重点说明：

- **其他解码器仍有宽松路径，但不是本轮遗漏。** QueryRun 快照只浅验 `executionState`，没有严格检查其中的 requests/prompt（`src/core/work-graph/materials/record-readers.ts:318`；`src/core/work-graph/queries/query-record-codecs.ts:762`）。审查一已记明此事（`.lead-ref/audit1/R.out.md:31`）；本轮 R-11 及裁定 27 明确要求的是事件解码（`.lead-ref/books/pc1b-findings.md:65`；`.lead-ref/books/pc1-book.md:505`）。
- **R-13 的顺序要求落实在测试断言。** 生产逐引用读取、校验并构造 `texts`（`src/core/agent-runtime/runtime.ts:663`、`:666`、`:668`），没有另一份输入 `texts` 可提前比较。返回值多一个键，或引用集合多一个未返回正文的摘要，都会在精确键集断言失败（`tests/runtime/PC-read-record-work-query.test.ts:35`）；set 顶层多未知字段也会被解码器拒绝（`src/contracts/prompts/prompt-set.ts:162`）。

DSH 自报事项：

- **§7.5 的 R-04：成立。** 它没有制造摘要碰撞正文，而是在公开 `RawArtifactStorePort.put` 接缝上改写 manifest 的 base 引用，复制首模板的 digest/size、换成错误 contentType，再交真实存储生成新 manifest 引用（`tests/work-graph/PC-query-record-usage.test.ts:171`、`:181`、`:184`；端口 `src/core/record-store/body-ports.ts:23`）。之后经过公开绑定及读取，能触发原缓存漏洞；没有新增生产测试专用入口（`src/core/agent-runtime/query-preparation.ts:356`；`tests/work-graph/PC-query-record-usage.test.ts:398`）。

```json
[
  {
    "id": "R2-01",
    "class": "不整洁",
    "file": "tests/runtime/PC-read-record-work-query.test.ts",
    "line": 150,
    "basis": "R-05（.lead-ref/books/pc1b-findings.md:59）；本轮检查第7条",
    "problem": "新增无依赖测试设置120000ms限时；全量日志.lead-ref/checks/full-pc1b-r1-vitest.txt:5372显示整个文件四项测试仅4535ms，超过60秒且超过文件耗时三倍。",
    "fix": "将此新增测试的限时改为5000ms。"
  },
  {
    "id": "R2-02",
    "class": "不整洁",
    "file": "src/core/agent-runtime/runtime.ts",
    "line": 6,
    "basis": "R-05（.lead-ref/books/pc1b-findings.md:59）",
    "problem": "文件头仍称无参数工厂每个成员均返回unsupported，但新增readPromptRecord在第153、156行分别返回invalid和unavailable，说明已不准确。",
    "fix": "仅修正文件头，写清无参数readPromptRecord的引用校验及完整Work引用返回unavailable的例外。"
  }
]
```

会出错 0，违规 0，不整洁 2，建议 0