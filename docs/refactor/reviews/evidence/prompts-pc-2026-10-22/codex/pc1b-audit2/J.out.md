只读审查完成；未修改文件、运行测试或构建，也未联网。确认 **5 项违规、1 项不整洁**；未发现 J 的生产差异引入可证明的行为回归。

| 编号 | 类别 | 位置 | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| J2-01 | 违规 | `tests/runtime/PC-joint-budget-removal.test.ts:39`、`tests/runtime/PC-joint-budget-removal.test.ts:128` | 冻结表 `.lead-ref/books/pc1b-findings.md:107`；运行书 `.lead-ref/books/run-pc1b-r1.md:43` | 两个正则只验证格式，随后抹掉真实值。把简报标记改为另一串合法的 64 位摘要、把轮次改为另一合法 UUID，长度不变，当前比较及预算断言仍可通过。 | 用公开 `readContinuationBrief` 返回的 `digest` 和 `openVerification` 返回的 `ref.roundId` 填入手写期望，再与模型当前输入完整比较，删除正则归一化。公开接口见 `src/core/agent-runtime/ports.ts:81`、`src/core/agent-runtime/runtime.ts:634`；轮次返回值已在测试 `:111` 使用。 |
| J2-02 | 违规 | `tests/runtime/PC-joint-prepare-freeze.test.ts:272`、`tests/runtime/PC-joint-prepare-freeze.test.ts:293`；`tests/runtime/PC-joint-freeze-and-pin.test.ts:116`；`tests/runtime/PC-joint-budget-removal.test.ts:77`、`tests/runtime/PC-joint-budget-removal.test.ts:127` | 本次测试门槛；运行书 `.lead-ref/books/run-pc1b-r1.md:43` | 仍通过 `preparedTexts()` 检查事实；该帮助函数打开 manifest，再调用生产内部 `readPromptTexts`，见 `tests/helpers/PC-platform-fixture.ts:408`、`tests/helpers/PC-platform-fixture.ts:416`。PC-15 还在 `:151` 把它的返回值作为模型输入期望。**J-04 的完整 system 期望已经独立字面化，问题是额外的私有事实读取。** | 删除这些 `preparedTexts()` 调用及附随断言；通过公开步骤、模型请求和必要的公开读口检查。PC-15 直接比较按 J2-01 补齐的手写输入。 |
| J2-03 | 违规 | `tests/runtime/PC-joint-record-and-failure.test.ts:74` | R-12：`.lead-ref/books/pc1b-findings.md:66`；运行书 `.lead-ref/books/run-pc1b-r1.md:43` | 工具正文、摘要和长度期望仍由捕获的 `sent.tools` 计算。工具描述或 schema 同时错误地进入发送请求和保存正文时，`:76` 至 `:79` 仍通过。单独篡改记录摘要的指定变异会失败，但独立期望要求仍未达到。 | 手写 Work、Query 的完整工具数组，由字面数组计算 JSON、SHA-256 和字节数，分别核对模型请求与公开记录。 |
| J2-04 | 违规 | `src/core/agent-runtime/context-rendering.ts:52`；`src/core/agent-runtime/context-assembler.ts:16`；`tests/architecture/production-reach-allowlist.json:1278` | J-07：`.lead-ref/books/pc1b-findings.md:80` | `CONTEXT_SECTION_HEADERS`、重导出及其 `wire-format` 豁免仍在，J-07 未全部完成。DSH 报告的白名单冲突属实。 | lead 放行 `S4C2-assembly`、`S3-role-profiles` 两文件的字面期望迁移；连同已获准的 `S3-context-assembler` 一起迁移，然后删除导出、重导出及豁免。应完成删除，不用 `kept-for` 留住仅供测试使用的常量。 |
| J2-05 | 违规 | `tests/architecture/production-reach-allowlist.json:1286` | J-08：`.lead-ref/books/pc1b-findings.md:81` | `PromptRecordRequestV1` 被写成 `readPromptRecord` 的“request type”。它实际是返回值 `requests[]` 的元素；端口参数是 `ctx, ref`，见 `src/contracts/prompts/prompt-set.ts:56`、`src/contracts/prompts/prompt-set.ts:62`、`src/core/agent-runtime/ports.ts:89`。 | 保留 `wire-format`，将说明改为“`PromptRecordReadResultV1.requests` 的元素类型，由 `RuntimeExecutionPort.readPromptRecord` 返回”。 |
| J2-06 | 不整洁 | `tests/runtime/PC-joint-budget-removal.test.ts:168`、`tests/runtime/PC-joint-prepare-freeze.test.ts:284`，以及下表各处 | 本次“新测试逐例时限”要求 | 四个 joint 文件的单例限时为 120–240 秒，均超过 60 秒且超过整个文件实测耗时的三倍。包含本轮新增四例及 PC-1b 已有八例；后八例没有在本轮抬高。 | 将这十二个 joint 用例的限时统一收至 `60_000`。 |

时限证据如下；各行限时按文件中的测试顺序排列。

| 文件及限时位置 | 单例限时 | 文件实测 |
|---|---|---|
| `tests/runtime/PC-joint-prepare-freeze.test.ts:195`、`:234`、`:284`、`:305` | 120、120、180、180 秒 | 7.809 秒，`.lead-ref/checks/full-pc1b-r1-vitest.txt:5209` |
| `tests/runtime/PC-joint-freeze-and-pin.test.ts:103`、`:132` | 180、120 秒 | 4.905 秒，`.lead-ref/checks/full-pc1b-r1-vitest.txt:5361` |
| `tests/runtime/PC-joint-record-and-failure.test.ts:122`、`:163`、`:188`、`:211` | 180、180、120、120 秒 | 7.644 秒，`.lead-ref/checks/full-pc1b-r1-vitest.txt:5338` |
| `tests/runtime/PC-joint-budget-removal.test.ts:168`、`:265` | 240、120 秒 | 5.015 秒，`.lead-ref/checks/full-pc1b-r1-vitest.txt:5345` |

其中本轮新增四例实测分别为 2796、1192、3112、1902 ms，见日志 `:5212`、`:5213`、`:5346`、`:5347`。原八例的限时可对照 `.lead-ref/base/tests/runtime/PC-joint-prepare-freeze.test.ts:48`、`.lead-ref/base/tests/runtime/PC-joint-freeze-and-pin.test.ts:40`、`.lead-ref/base/tests/runtime/PC-joint-record-and-failure.test.ts:92`。

**PC-15 的独立复算**

(a) 从测试手写输入和工具数组计算，未使用捕获请求或生产渲染结果作为字节期望。来源是 `tests/runtime/PC-joint-budget-removal.test.ts:34`、`:36`、`:37`。

- `e1 = 原文1973 + 51个LF转义增量 + 112个引号转义增量 = 2136`。
- 将两个占位值按实际固定长度填入后，`e2 = 原文8018 + 90 + 112 = 8220`。
- 九个工具对象的 JSON 字节数依次为：`918 + 1369 + 593 + 8142 + 1367 + 838 + 798 + 577 + 381 = 14983`；再加八个逗号、两个方括号，`t = 14993`。

当前 user、base `"B"`、cap 256 的请求固定开销为：

`17(schemaVersion) + 50(requestId) + 79(runId) + 18(systemPrompt) + 92(messages空内容) + 8(tools键) + 21(maxOutputTokens) + 8(外层括号和逗号) = 293`。

字段形状对应 `vendor/coding-agent/dist/core/context/builder/context-builder.js:56`、`:116`。由此：

- `C = 293 + e2 + t = 23506`。
- 旧历史增量 `D = (79 + e1) + (99 + 16384) + 2个数组逗号 = 18700`。
- Host 增量为 `18700 + 两个LF的JSON长度4 = 18704`。
- 删除旧历史后的请求为 `23506 + 18704 = 42210` 字节。
- 输入计量 `42210 + 4096 = 46306`。
- `W = 46306 + 256 = 46562`。
- `W + D = 46562 + 18700 = 65262 ≤ 100000`。

这些值与测试 `tests/runtime/PC-joint-budget-removal.test.ts:45`、`:61`、`:162` 一致。

| 候选 | 输入计量＋输出预留 |
|---|---:|
| 有 Host、全部旧历史 | `46562 + 18700 = 65262`，超窗 |
| 有 Host、只删旧 user | `46562 + 16484 = 63046`，超窗 |
| 有 Host、两条旧历史都删 | `46562`，恰好放下 |
| base 变异：选择时没有 Host，保留旧历史 | `46562 - 4 = 46558`，放下 |
| base 变异：发送前追加一次 Host | `65262`，meter 拒绝 |

指定 base 变异因此会使第二轮到不了模型，测试的完成状态和调用次数断言会失败；meter 在记账前拒绝的位置是 `src/core/agent-runtime/model-budget.ts:128`、`:131`。这与审查 1 的构造一致，见 `.lead-ref/audit1/pc15.out.md:129`。这里只确认静态效果，未独立复验 DSH 声称的 RED/GREEN。

其余规定断言已具备：不同 Run、同 Session、精确 system、无 `responseFormat`、完整工具表、只剩当前 user、完成状态、公开单条记录、cap 和两种历史删除计数，见 `tests/runtime/PC-joint-budget-removal.test.ts:135`、`:143`、`:148`、`:158`、`:164`。单条 user 的结构断言已能排除旧 assistant 消息保留；当前输入比较的问题归 J2-01/J2-02。

(b) `pc15-json` 比平台的 69 字符 Run ID 少 60 字符；当前输入 `"Q"` 加一字节，空工具数组占两字节，因此无 Skill、无格式字段时：

`293 - 60 + 1 + 2 = 236` 字节。

调用参数见 `tests/runtime/PC-joint-budget-removal.test.ts:217`、`:219`、`:221`、`:223`。

`project-conventions` 正文各行字节为 `97、0、125、111、122、101`，加六个 LF，共 `562`；JSON 转义后为 `568`。节头与分隔原长 `151`，三个 LF、四个引号的转义再加七字节，成为 `158`，故 Skill 增量 `568 + 158 = 726`。正文和节格式见 `vendor/coding-agent/resources/skills/project-conventions/content.md:1`、`vendor/coding-agent/dist/core/context/builder/context-builder.js:20`。

- 格式字段 `,"responseFormat":{"type":"json_object"}`：40 字节。
- 漏算格式：`236 + 726 + 4096 + 256 = 5314`，恰好放下。
- 正确计入：`236 + 726 + 40 + 4096 + 256 = 5354`，超窗 40。
- 删除 Skill：`236 + 40 + 4096 + 256 = 4628`。
- `inputBytes = 276`；`reservedInput = 276 + 4096 = 4372`；`reservedOutput = 256`；报告预算 `5314 - 256 = 5058`。

要求的断言均在 `tests/runtime/PC-joint-budget-removal.test.ts:227`、`:246`、`:255`。把预览改为未经转换的请求、保留发送转换，会在发送时以 `5354 > 5314` 拒绝，产生零模型调用、零 meter entry；对应 `src/core/agent-runtime/observed-model-run.ts:350`、`:390` 和 `src/core/agent-runtime/model-budget.ts:128`。没有发现需要改动上述数值的字段差异。

**J-07、J-08 和范围核对**

`CONTEXT_SECTION_HEADERS` 的测试 importer 全集是：

- `tests/runtime/S3-context-assembler.test.ts:57`；
- `tests/runtime/S4C2-assembly.test.ts:29`，使用在 `:358`；
- `tests/work-graph/S3-role-profiles.test.ts:39`，使用在 `:206`。

另有 `src/core/agent-runtime/context-assembler.ts:16` 的重导出。后两个测试确实未列入白名单，见 `.lead-ref/books/pc1b-r1-whitelist.txt:16`、`:22`、`:29`。因此应由 lead 补许可完成 J2-04，不能认定 DSH 擅自改了白名单外文件。

四个旧测试的增量没有扩大业务范围：

- S3 的增长是导入调整、两条 prelude 字面值和完整 guide 字面值；没有新增测试体，见 `tests/runtime/S3-context-assembler.test.ts:65`、`:66`、`:888`。
- R5b 的增长是删除导入、补完整 guide 字面值，见 `.lead-ref/parts/J.diff:1424`、`tests/work-graph/R5b-initial-plan.test.ts:457`。
- A1 仅换 standing 字面值，见 `tests/scenarios/A1-rework-same-session.test.ts:208`。
- A2 除 standing 字面值外，确有两组循环和输入赋值，并非每个新增行都是文本；它们通过既有 renderer 核对原来的五个 failure label、三个 actor label，属于删除导出后的等价观测迁移，见 `tests/contracts/A2-rework-contract-helpers.test.ts:387`、`:493`，原断言见 `.lead-ref/parts/J.diff:221`。

七条 `kept-for` 均匹配 `production-reach.test.ts:40` 的模式；注记位于 `tests/architecture/production-reach-allowlist.json:1304`、`:1310`、`:1316`、`:1322`、`:1328`、`:1334`、`:1340`。所述调用链存在于 `src/core/agent-runtime/runtime.ts:664`、`:707`、`:736`、`:101` 及 `src/core/work-graph/tasks/model-call-service.ts:379`。三项 DTO 保留 `wire-format` 正确，只有 J2-05 的说明仍错。

J 的十二个变更文件均符合白名单，所给 J 差异未触碰冻结夹具；生产 hunk 仅删除常量及导出，没有新增测试专用分支或出口，见 `.lead-ref/parts/J-files.txt:1`、`.lead-ref/parts/J.diff:1`、`:29`、`:42`；Query 对应删除在 `.lead-ref/parts/P.diff:213`、`:234`。

**逐行结论**（J2-06 均仅指时限）

- J-01：J2-06；业务修复 OK。完整 system/input、旧 Skill 和各类字面摘要均有，丢 Skills 会失败，见 `tests/runtime/PC-joint-prepare-freeze.test.ts:131`、`:171`、`:177`、`:208`、`:214`。
- J-02：J2-02、J2-06；两种入口及相关字符串变更已补齐，使用生成 strings 的变异会失败，见 `tests/runtime/PC-joint-prepare-freeze.test.ts:270`、`:276`、`:291`、`:297`。
- J-03：same as S-10；J2-06。公开暂停、正常等待首次执行、新请求身份和 system 比较均有，见 `tests/runtime/PC-joint-freeze-and-pin.test.ts:65`、`:75`、`:84`、`:89`。
- J-04：J2-02、J2-06；字面完整 system 已修好，见 `tests/runtime/PC-joint-freeze-and-pin.test.ts:41`、`:128`。
- J-05：same as R-12；J2-03、J2-06。
- J-06：same as S-05／PC-15；J2-01、J2-02、J2-06。
- J-07：J2-04。
- J-08：J2-05。
- J-09：same as S-01；OK，两处早退已删除并比较五字段，见 `src/core/agent-runtime/execution-driver.ts:118`、`src/core/agent-runtime/query-execution.ts:97`；未重查已知十六文件。
- S-10 联合部分：J2-06；仅返回 observation 的变异会被新增请求断言抓住，见 `tests/runtime/PC-joint-freeze-and-pin.test.ts:84`。
- R-12 联合部分：J2-03、J2-06；每条 systemDigest 已独立核对，见 `tests/runtime/PC-joint-record-and-failure.test.ts:82`。
- R-13 联合部分：J2-06；精确键集和逐正文摘要符合该行特许的关系断言，跳过模板／字符串读取会失败，见 `tests/runtime/PC-joint-record-and-failure.test.ts:59`、`:67`。
- S-09 的 PC-10 部分：J2-06；授权、预约、admission、模型调用及公开请求记录均检查为空，见 `tests/runtime/PC-joint-record-and-failure.test.ts:177`、`:200`。
- R-14：J2-06；重放捕获 reservation 只改单个 prompt 事实，见 `tests/runtime/PC-joint-record-and-failure.test.ts:148`。
- PC-15(a)：J2-01、J2-02、J2-06；算术和指定 base 变异成立。
- PC-15(b)：J2-06；算术、所列断言和指定变异成立。

**DSH 自报事项**

- §7.1：**成立**。两个白名单外 importer 确实存在；按运行书停在范围边界合理，但 J-07 仍未完成，见 `.lead-ref/replies/pc1b-r1-reply.md:134`、`.lead-ref/books/run-pc1b-r1.md:55`及 J2-04。
- §7.2：**作为当前树的遗留失败项不成立**。lead 的 bubblewrap 日志中 A1 已通过，见 `.lead-ref/checks/full-pc1b-r1-vitest.txt:4504`；这不用于否定 DSH 当时环境下的失败报告。
- §7.3：**不成立**。“只能从内部读取”不对：公开简报读口返回摘要，公开开轮结果已返回轮次编号；两个占位符确实能放过同长度错误值，见 J2-01。
- §7.4：**成立**。这里只在夹具临时目录初始化 Git、配置本地身份、忽略 SQLite 文件并提交 `.gitignore`、`wp2-read.txt`；随后才准备执行，没有伪造平台状态或跳过暂停恢复，见 `tests/runtime/PC-joint-freeze-and-pin.test.ts:32`、`:60`。
- §7.5 涉及 J 的生产差异说明：**成立**。给定差异中的相关生产修改是删除导出，见 `.lead-ref/parts/J.diff:1`、`:29`、`:42`及 `.lead-ref/parts/P.diff:217`；未据此推断其未提供的变异执行过程。

```json
[
  {
    "id": "J2-01",
    "class": "违规",
    "file": "tests/runtime/PC-joint-budget-removal.test.ts",
    "line": 39,
    "basis": ".lead-ref/books/pc1b-findings.md:107；.lead-ref/books/run-pc1b-r1.md:43",
    "problem": "摘要和轮次 UUID 经正则归一化后失去值校验；另一合法且同长度的错误值仍可通过输入比较和预算断言。公开 readContinuationBrief 返回 digest，openVerification 已返回 ref.roundId。",
    "fix": "删除正则归一化，用公开简报摘要和开轮返回的 roundId 填入手写期望，完整比较模型当前输入。"
  },
  {
    "id": "J2-02",
    "class": "违规",
    "file": "tests/runtime/PC-joint-prepare-freeze.test.ts",
    "line": 272,
    "basis": "本次测试门槛；.lead-ref/books/run-pc1b-r1.md:43",
    "problem": "该文件:272、:293，PC-joint-freeze-and-pin.test.ts:116，以及PC-joint-budget-removal.test.ts:77、:127仍通过preparedTexts检查事实；帮助函数在tests/helpers/PC-platform-fixture.ts:416调用生产内部readPromptTexts。预算测试:151还将其返回输入作为期望。J-04的完整system期望本身已经字面化。",
    "fix": "删除这些preparedTexts调用和附随断言，改由公开步骤、模型请求及必要公开读口检查；PC-15直接比较补齐公开动态标识的手写输入。"
  },
  {
    "id": "J2-03",
    "class": "违规",
    "file": "tests/runtime/PC-joint-record-and-failure.test.ts",
    "line": 74,
    "basis": ".lead-ref/books/pc1b-findings.md:66；.lead-ref/books/run-pc1b-r1.md:43",
    "problem": "工具正文、摘要和长度期望由捕获的sent.tools生成；错误工具描述或schema同时进入发送与保存正文时，断言仍通过。",
    "fix": "手写Work和Query完整工具数组，由字面数组计算JSON、SHA-256及字节数，分别比较模型请求和公开记录。"
  },
  {
    "id": "J2-04",
    "class": "违规",
    "file": "src/core/agent-runtime/context-rendering.ts",
    "line": 52,
    "basis": ".lead-ref/books/pc1b-findings.md:80",
    "problem": "CONTEXT_SECTION_HEADERS、context-assembler.ts:16重导出及production-reach-allowlist.json:1278豁免仍保留。S4C2-assembly.test.ts:29和S3-role-profiles.test.ts:39确实是白名单外importer，J-07因此部分完成。",
    "fix": "lead放行这两个测试的字面期望迁移；连同已获准的S3-context-assembler一起迁移，随后删除导出、重导出及allowlist项。"
  },
  {
    "id": "J2-05",
    "class": "违规",
    "file": "tests/architecture/production-reach-allowlist.json",
    "line": 1286,
    "basis": ".lead-ref/books/pc1b-findings.md:81",
    "problem": "PromptRecordRequestV1被说明为readPromptRecord的request type；实际是返回结果requests数组的元素，端口输入为ctx和ref。",
    "fix": "保留wire-format，将说明改为PromptRecordReadResultV1.requests的元素类型，由RuntimeExecutionPort.readPromptRecord返回。"
  },
  {
    "id": "J2-06",
    "class": "不整洁",
    "file": "tests/runtime/PC-joint-budget-removal.test.ts",
    "line": 168,
    "basis": "本次审查要求第7项；.lead-ref/checks/full-pc1b-r1-vitest.txt:5209、:5338、:5345、:5361",
    "problem": "四个PC-joint文件的十二个单例限时为120至240秒，而文件实测分别为prepare-freeze 7.809秒、record-and-failure 7.644秒、budget-removal 5.015秒、freeze-and-pin 4.905秒，全部超过60秒且超过文件实测三倍。其中四例本轮新增，其余八例继承原限时，没有在本轮抬高。",
    "fix": "将十二个joint用例的限时统一收至60000毫秒。"
  }
]
```

会出错 0，违规 5，不整洁 1，建议 0