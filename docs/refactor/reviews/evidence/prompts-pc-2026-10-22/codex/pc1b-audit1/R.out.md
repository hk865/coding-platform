发现 **5 项会出错、9 项违规**。以下结论来自静态核查；未运行测试、构建，未修改文件或访问网络。表中“变异仍可通过”是代码推导，未实际运行变异测试。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| R-01 | 会出错 | `src/core/work-graph/tasks/model-request-codecs.ts:97`；`src/core/record-store/body-codec.ts:50`、`:59` | `.lead-ref/books/pc1-book.md:483`，裁定 26 严格解码 | 合法 Work 授权输入仅在 `prompt.toolSpecsRef` 或其 `source` 加 `extra:true`，应返回 `invalid`；实际通用 `isArtifactRef` 不限制键集合，服务、许可快照和授权事件均接受并保留额外字段（`model-call-service.ts:74`、`:226`、`:235`）。 | 在 Work prompt 校验中加入引用及 source 的精确键集合检查，保留现有值校验；补两种嵌套未知键拒绝用例。 |
| R-02 | 会出错 | `src/core/work-graph/queries/query-execution.ts:464`、`:468`、`:1040` | `.lead-ref/books/pc1-book.md:573`、`:576`，R 所有 manifest loader 必须解码 `promptSet` | 对其他字段、摘要和归属均合法，但缺少或损坏 `promptSet` 的 manifest，`bindPreparedQuery` 应拒绝 `invalid`；实际 loader 直接返回 manifest，绑定可提交为 prepared，直到 Runtime 后续读取才拒绝。 | 在该 loader 返回前调用 `decodePromptSetV1`，失败返回 `invalid`；通过公开绑定入口验证拒绝且不推进状态。 |
| R-03 | 会出错 | `src/core/work-graph/queries/query-execution.ts:1413` | `.lead-ref/books/pc1-book.md:502`、`:504`，裁定 27 | 已 reservation 的同一模型 `requestId`，使用新命令号、当前 revision 准入，仅改变合法 `requestDigest`：应为 `idempotency_conflict`，实际仍返回旧的 `invalid`。相邻 prompt 不一致分支才返回规定的冲突码（`:1414`）。 | 将 reservation 的 `requestDigest` 不一致分支改为 `idempotency_conflict`，补独立准入用例。 |
| R-04 | 会出错 | `src/core/agent-runtime/runtime.ts:636`、`:637`、`:643` | `.lead-ref/books/pc1-book.md:405`、`:529`，逐引用验证正文 | 已绑定 manifest 中，先出现合法模板引用 `{digest:D,sizeBytes:N,contentType:正确类型}`，随后 base 引用同一 D/N、但 `contentType:'bad'`。应拒绝 `invalid`；实际缓存键采用**预期类型**，第二个引用命中缓存后跳过校验，最终返回 `ready`。该输入可经正文存储及公开 Query 绑定提交，无需改数据库；解码器只要求引用类型是字符串（`src/contracts/prompts/prompt-set.ts:141`）。 | 在检查缓存命中之前验证 `target.contentType === contentType`；补同摘要、同大小、不同引用类型的读取用例。 |
| R-05 | 会出错 | `src/core/agent-runtime/runtime.ts:145`、`:537` | `.lead-ref/books/pc1-book.md:521`、`:535`，裁定 29、30 | `createAgentRuntime().port.readPromptRecord(ctx, 完整WorkRef)` 没有 `modelRequestReads`，应返回 `unavailable`，原因是 `"model request reads are not wired"`；实际无参数分支返回 `unsupported` 和骨架文案。书中未给此分支例外。 | 让无依赖工厂的该方法同样校验引用，并对完整 WorkRef 返回规定的未接线拒绝；保留其他骨架方法行为。 |
| R-06 | 违规 | `tests/work-graph/PC-record-model-request-facts.test.ts:94` | `.lead-ref/books/pc1-book.md:53`，禁止读数据库核对事实 | 新测试直接 `records.readMany`，再 `JSON.parse` 检查许可及物理 revision（`:97`、`:98`）。 | 改用 `ModelRequestReadPort` 检查事实和未消费状态，保留随后通过公开消费成功的断言（`:101`）。 |
| R-07 | 违规 | `tests/work-graph/PC-record-model-request-facts.test.ts:118` | `.lead-ref/books/pc1-book.md:627`，期望不得从生产代码生成 | 唯一槽位的期望调用生产 `canonicalJson`；生产和测试共同改变引用序列化时可一起算错，测试仍通过。 | 按规范字段顺序手写预期 JSON 形状，用普通字符串或原生 JSON 序列化构造槽位期望，移除生产序列化函数依赖。 |
| R-08 | 违规 | `tests/work-graph/PC-record-model-request-facts.test.ts:53`；`tests/work-graph/PC-record-model-request-read.test.ts:37` | `.lead-ref/books/pc1-book.md:468`，计数对象是全部已授权许可 | 两处都先消费第一条，再授权第二条。将生产计数错误改成“仅统计已消费许可”，这些测试仍通过；从零开始的一胜一败竞争测试也抓不到（`PC-record-model-request-facts.test.ts:124`）。 | 调整现有读取用例：先连续授权两条并断言第二条 sequence 为 2，再消费第一条，保留最后的公开读取断言。 |
| R-09 | 违规 | `tests/work-graph/PC-query-record-usage.test.ts:302`、`:336` | `.lead-ref/books/pc1-book.md:500`、`:504`，Query 不可变事实 | admission 只单改 `toolsDigest`；usage 只单改 `systemDigest`、`reservedOutput`。把比较削成这些字段仍能通过，漏掉 `requestDigest`、`reservedInput`、引用及 selection 等其他事实，也漏掉 R-03。 | 参数化现有公开入口测试：usage 对每个不可变字段分别改一个合法值；admission 对其携带的各事实及 `requestDigest` 分别改值，逐项断言冲突且公开读取保持原行。 |
| R-10 | 违规 | `tests/work-graph/A2-step1-codecs.test.ts:904`、`:929` | `.lead-ref/books/pc1-book.md:483`、`:735` | Work codec 拒绝矩阵没有单独损坏 `selection.budget`；删除生产中的 budget 值检查（`model-request-codecs.ts:103`），现有新增 codec 用例仍通过。 | 在现有快照及事件拒绝矩阵中补 `selection.budget` 单独缺失、非法值的情况。R-01 的嵌套未知键另随该项修复。 |
| R-11 | 违规 | `tests/work-graph/PC-query-record-codec.test.ts:82`、`:95` | `.lead-ref/books/pc1-book.md:505`，严格检查列表每一项 | 所有列表只有一条；坏值仅覆盖少数字段。只校验 `requests[0]`，或删除工具引用、selection 数值、七个删除计数的值检查，相关用例仍通过。 | 补各新字段单独损坏的拒绝矩阵，并加入第一条合法、第二条单独损坏的列表；同时覆盖未知键层级。 |
| R-12 | 违规 | `tests/runtime/PC-joint-record-and-failure.test.ts:67`、`:116`；`tests/runtime/PC-read-record-work-query.test.ts:57`、`:98` | `.lead-ref/books/pc1-book.md:693`、`:697`，PC-09 每条请求的摘要 | Work 联合用例对 `toolsDigest` 只检查字符串，Query 未核对其内容；小读取用例只要求该键存在。把 Runtime 返回的 `toolsDigest` 映射成 base digest，这些断言仍通过。Query 第二条 `systemDigest` 也未与手拼系统核对。 | 对每条请求独立核对工具 JSON、工具正文及 `toolsDigest`；按书中的字面分节格式重建系统，并核对每条 `systemDigest`。 |
| R-13 | 违规 | `tests/runtime/PC-read-record-work-query.test.ts:18`；`tests/runtime/PC-joint-record-and-failure.test.ts:75`、`:118` | `.lead-ref/books/pc1-book.md:529`，必须返回全部引用正文 | 只遍历**已返回**的 texts 验证摘要，没有验证正文集合完整。删除 Runtime 的模板及字符串表读取（`runtime.ts:648`、`:652`），这些断言仍可通过。 | 汇总 set 的模板、字符串表、base、Skills 及每条请求工具引用的摘要集合，严格比较 `texts` 的键集合，再逐项验证正文。 |
| R-14 | 违规 | `tests/runtime/PC-joint-record-and-failure.test.ts:122` | `.lead-ref/books/pc1-book.md:699`；规格 `slice-6-7-PROMPTS-SPEC.md:181` | Query 重放只改变原有 `reservedOutput`，没有改变本批新增 prompt 事实。若 usage 指纹漏掉整个 `prompt`，这个重放测试仍通过；其他 Query 冲突用例使用新命令号，也不能证明原命令的指纹包含 prompt。 | 增加对捕获的 Query reservation 原命令的重放，仅改变一个合法的新 prompt 事实，断言 `idempotency_conflict`。 |

逐裁定、逐行结论：

- **裁定 26：R-01、R-06、R-07、R-08、R-10。** 序号实现及丢槽映射正确：计数、claim 和提交在 `model-call-service.ts:211`、`:237`、`:247`；内存与 SQLite 均真实返回 `unique_conflict`（`in-memory-record-store.ts:290`、`sqlite-record-store.ts:424`），服务在 `model-call-service.ts:87` 映射为指定 `busy`，没有重试。两次 prompt 投影在 `model-call-access.ts:76`、`:88`，消费比较整个 prompt 在 `model-call-service.ts:326`，指纹包含输入在 `:182`、`:292`。
- **裁定 27：R-03、R-09、R-11、R-14。** 首写 `admitted:false`、后续仅改四个用量字段、准入仅翻转 admitted 的实现成立（`queries/query-execution.ts:1327`、`:1335`、`:1426`）。
- **裁定 28：实现 OK；序号测试缺口为 R-08。** 独立读端口、注册 lookup 和排序分别在 `model-call-contracts.ts:46`、`model-request-codecs.ts:257`、`model-call-service.ts:112`、`:138`；写端口仍只有两个写方法（`model-call-service.ts:359`）。
- **裁定 29：R-04、R-12、R-13。** 可选接口及真实工厂发布在 `ports.ts:89`、`runtime.ts:885`。
- **裁定 30：R-05。** 依赖字段、默认 source 和真实装配正确（`execution-contracts.ts:217`、`:220`；`runtime.ts:543`；`create-platform.ts:1187`、`:1188`）。
- **§4 R 的 manifest 接缝：R-02。**
- **PC-09：R-08、R-12、R-13、R-14。**
- **§5.3：A2 为 R-10；B2 及 B2 fixture 的旧断言未放松，修改围绕请求事实（`.lead-ref/parts/R.diff:997`、`:1024`、`:1287`）。**

旧数据的结论需要分开：缺 prompt 的旧 Query **事件请求行会拒绝**（`query-record-codecs.ts:424`、`:442`）；旧 Query **快照仍可能通过原有浅校验**，它未检查 requests 的 prompt（`materials/record-readers.ts:318`；`queries/query-record-codecs.ts:762`）。书不要求兼容旧库，明确旧库重建，因此不应为旧事件补缺省 prompt 或迁移路径（`.lead-ref/books/pc1-book.md:30`；规格 `slice-6-7-PROMPTS-SPEC.md:184`）。

DSH 回复中与 R 有关的项目：

- **§4.1：成立。** 冻结的是独立读接口，没有冻结工厂形状；真实组合根使用同一个后端创建读写服务（回复 `pc1b-reply.md:50`；书 `pc1-book.md:506`；代码 `create-platform.ts:1173`、`:1180`、`:1187`）。
- **§4.4：成立，就 Runtime 默认 source 而言。** 缺省安装已实现；无参数读取的拒绝码仍有 R-05（回复 `pc1b-reply.md:53`；代码 `runtime.ts:543`）。
- **§4.7：成立，就最小 Query manifest 读取方案而言。** 它校验调用 scope、manifest owner、完整 QueryRun 身份、正文摘要与大小，并解码 promptSet；不能借此读取另一项目或另一 Run 的 manifest（`queries/query-execution.ts:1789`；`runtime.ts:93`、`:97`、`:101`、`:110`、`:114`）。子正文缓存问题另见 R-04；WorkGraph loader 遗漏另见 R-02。
- **§4.9：成立。** 冻结 fixture 的该处变化仅为类型断言，运行表达式不变（`tests/helpers/PC-platform-fixture.ts:529`；`.lead-ref/base/tests/helpers/PC-platform-fixture.ts:529`）。
- **§9.5：成立。** 书未规定由哪个工厂提供读口，独立工厂不构成接口违规（回复 `pc1b-reply.md:116`；书 `pc1-book.md:510`）。
- **§9.6：成立，但已由运行表说明。** 实际名字是 `RuntimeExecutionDependencies`（回复 `pc1b-reply.md:117`；运行表 `run-pc1b.md:71`；代码 `execution-contracts.ts:208`）。
- **§1、§8：没有额外的 R 专属待裁定项。** 所列启动选择、夹具、目录删除及 PC-15 问题属于 P/S 或联合步其他行，不能替 R 的遗漏提供豁免（回复 `pc1b-reply.md:5`、`:8`、`:105`）。

```json
[
  {
    "id": "R-01",
    "class": "会出错",
    "file": "src/core/work-graph/tasks/model-request-codecs.ts",
    "line": 97,
    "basis": ".lead-ref/books/pc1-book.md:483，裁定26严格解码",
    "problem": "合法prompt.toolSpecsRef或其source加入extra:true，应invalid；通用isArtifactRef不检查未知键，授权、许可快照和事件实际接受并保留该字段。",
    "fix": "在Work prompt校验中严格检查toolSpecsRef及source的精确键集合，保留值校验，并补两个嵌套未知键拒绝用例。"
  },
  {
    "id": "R-02",
    "class": "会出错",
    "file": "src/core/work-graph/queries/query-execution.ts",
    "line": 468,
    "basis": ".lead-ref/books/pc1-book.md:573、576，R的manifest loader接缝",
    "problem": "loadQueryManifest未调用decodePromptSetV1；其他内容合法但promptSet缺失或损坏的manifest，应在bindPreparedQuery返回invalid，实际可提交为prepared。",
    "fix": "在loader返回前解码promptSet，失败返回invalid，并通过公开绑定入口验证拒绝且状态不推进。"
  },
  {
    "id": "R-03",
    "class": "会出错",
    "file": "src/core/work-graph/queries/query-execution.ts",
    "line": 1413,
    "basis": ".lead-ref/books/pc1-book.md:502、504，裁定27不可变事实冲突",
    "problem": "同一已预留requestId，以新命令号和当前revision准入，仅改变合法requestDigest，应idempotency_conflict，实际返回invalid。",
    "fix": "将reservation的requestDigest不一致分支改为idempotency_conflict，并补独立准入用例。"
  },
  {
    "id": "R-04",
    "class": "会出错",
    "file": "src/core/agent-runtime/runtime.ts",
    "line": 636,
    "basis": ".lead-ref/books/pc1-book.md:405、529，逐引用验证正文",
    "problem": "模板引用先成功读取后，base引用若具有相同digest和sizeBytes但错误contentType，会命中采用预期类型构造的缓存键，跳过checkPromptBody；应invalid，实际ready。可经公开正文写入和Query绑定达到，无需修改数据库。",
    "fix": "在缓存命中判断前验证target.contentType等于预期类型，并补同摘要同大小但引用类型不同的读取用例。"
  },
  {
    "id": "R-05",
    "class": "会出错",
    "file": "src/core/agent-runtime/runtime.ts",
    "line": 145,
    "basis": ".lead-ref/books/pc1-book.md:521、535，裁定29和30",
    "problem": "无参数createAgentRuntime发布的readPromptRecord，对完整WorkRef返回unsupported和骨架文案；缺modelRequestReads时应返回unavailable及model request reads are not wired。",
    "fix": "让无依赖工厂的该方法同样校验引用，并对完整WorkRef返回规定的未接线拒绝；补无参数构造用例。"
  },
  {
    "id": "R-06",
    "class": "违规",
    "file": "tests/work-graph/PC-record-model-request-facts.test.ts",
    "line": 94,
    "basis": ".lead-ref/books/pc1-book.md:53，禁止数据库读取断言",
    "problem": "新测试直接records.readMany并JSON.parse验证许可事实和物理revision。",
    "fix": "通过ModelRequestReadPort检查事实及未消费状态，保留随后公开消费成功的断言，删除直接存储读取。"
  },
  {
    "id": "R-07",
    "class": "违规",
    "file": "tests/work-graph/PC-record-model-request-facts.test.ts",
    "line": 118,
    "basis": ".lead-ref/books/pc1-book.md:627，期望必须独立手算",
    "problem": "claimKey期望调用生产canonicalJson；生产和期望共同改变引用序列化时可同错而通过。",
    "fix": "按规范字段顺序手写预期JSON形状，以普通字符串或原生JSON序列化构造槽位期望。"
  },
  {
    "id": "R-08",
    "class": "违规",
    "file": "tests/work-graph/PC-record-model-request-read.test.ts",
    "line": 37,
    "basis": ".lead-ref/books/pc1-book.md:468，序号按已授权许可计数",
    "problem": "序号用例均先消费首条再授权第二条；PC-record-model-request-facts.test.ts:53同样如此。仅统计已消费许可的错误实现仍可通过，包括从零开始的一胜一败竞争用例。",
    "fix": "先连续授权两条并断言第二条sequence为2，再消费第一条，保留最终读取断言。"
  },
  {
    "id": "R-09",
    "class": "违规",
    "file": "tests/work-graph/PC-query-record-usage.test.ts",
    "line": 302,
    "basis": ".lead-ref/books/pc1-book.md:500、504，Query不可变事实",
    "problem": "admission仅改变toolsDigest；usage仅改变systemDigest和reservedOutput。只比较这些字段的错误实现仍能通过，其他不可变字段未独立覆盖。",
    "fix": "参数化公开入口用例，对usage的每个不可变字段、admission可传入的各事实及requestDigest分别改变一个合法值，断言冲突及公开读取保持原行。"
  },
  {
    "id": "R-10",
    "class": "违规",
    "file": "tests/work-graph/A2-step1-codecs.test.ts",
    "line": 904,
    "basis": ".lead-ref/books/pc1-book.md:483、735，新增字段接受和拒绝",
    "problem": "没有单独损坏selection.budget的用例；删除Work codec的budget值检查，现有新增codec测试仍通过。",
    "fix": "在现有快照及事件拒绝矩阵中补selection.budget单独缺失及非法值用例。"
  },
  {
    "id": "R-11",
    "class": "违规",
    "file": "tests/work-graph/PC-query-record-codec.test.ts",
    "line": 95,
    "basis": ".lead-ref/books/pc1-book.md:505，严格检查每个请求元素",
    "problem": "只测单元素请求列表和少数坏字段；仅检查requests[0]，或删除工具引用、selection数值及七个删除计数的值检查，相关测试仍通过。",
    "fix": "补各新增字段独立坏值及未知键层级的拒绝矩阵，并加入第一元素合法、第二元素损坏的列表。"
  },
  {
    "id": "R-12",
    "class": "违规",
    "file": "tests/runtime/PC-joint-record-and-failure.test.ts",
    "line": 67,
    "basis": ".lead-ref/books/pc1-book.md:693、697，PC-09每条请求的摘要",
    "problem": "工具摘要未与实际工具内容核对；小读取测试仅要求texts[toolsDigest]存在。将Runtime返回的toolsDigest映射为base摘要仍可通过；Query第二条systemDigest也未核对。",
    "fix": "逐请求独立核对工具JSON、工具正文及toolsDigest，并按书中的字面分节格式重建系统，核对每条systemDigest。"
  },
  {
    "id": "R-13",
    "class": "违规",
    "file": "tests/runtime/PC-read-record-work-query.test.ts",
    "line": 18,
    "basis": ".lead-ref/books/pc1-book.md:529，返回所有引用正文",
    "problem": "读取测试和联合测试仅检查已返回texts的摘要，没有检查集合完整性；删除模板及字符串表正文读取，相关断言仍可通过。",
    "fix": "汇总模板、字符串表、base、Skills及请求工具引用的摘要集合，严格比较texts键集合，再逐项验证正文。"
  },
  {
    "id": "R-14",
    "class": "违规",
    "file": "tests/runtime/PC-joint-record-and-failure.test.ts",
    "line": 122,
    "basis": ".lead-ref/books/pc1-book.md:699；docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:181",
    "problem": "Query重放只改变旧字段reservedOutput，未验证新增prompt事实进入幂等指纹；指纹漏掉整个prompt时该测试仍通过。",
    "fix": "增加对捕获的Query reservation原命令的重放，仅改变一个合法的新prompt事实，并断言idempotency_conflict。"
  }
]
```

会出错 5，违规 9，不整洁 0，建议 0