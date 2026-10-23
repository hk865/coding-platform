S 尚不能按冻结书验收。以下是静态审计结果；未修改文件，未运行测试、构建或网络操作。文中的 `pc1-book.md`、`run-pc1b.md` 均指 `.lead-ref/books/` 下的文件。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| S-01 | 会出错 | `src/core/agent-runtime/execution-driver.ts:121`；`src/core/agent-runtime/query-execution.ts:100` | `pc1-book.md:299`、`:382`；共同规则 5 | `selection` 缺席就跳过全部五项比较。输入为准备时 `test/test`、启动时 `deepseek/s2b-runtime-steps-model`，且两者都没有 `selection`：裁决要求 `forbidden`，实际比较返回 `true`，继续启动。这也是明确为保住测试加入的生产分支。 | 删除两处提前返回，无条件比较 `promptSelectionOf(model)` 和 provider/model。由 lead 放行修正旧夹具，使准备和启动使用同一模型绑定，保留其原业务断言。 |
| S-02 | 违规 | `src/core/agent-runtime/observed-model-run.ts:350` | 裁决 20，`pc1-book.md:410` | 包装层仍调用 `finalRequest(request)`，再次添加 `responseFormat`；注释 `:221` 也明确说预览和包装层都调用。当前转换幂等，未据此认定正常链路另有字节变化，但它违反“包装层发送 Kernel 交来的请求”。 | 此处改为 `metered.stream(request, options)`；最终转换只留在预览入口。 |
| S-03 | 违规 | `src/core/agent-runtime/model-budget.ts:85`、`:104`、`:117`；`src/core/agent-runtime/observed-model-run.ts:340` | 裁决 21、24，`pc1-book.md:415`、`:439` | 共享测量函数没有计算 `fits`，预览和发送各自判断；事实中的输出上限又复制了一份 `Math.min`。当前公式相同，但没有实现书要求的共同计算来源。 | 让共同测量结果包含 cap、计数和 `fits`，由预览、发送检查和事实装配共同取用，删除外围重复公式。 |
| S-04 | 违规 | `tests/app/PC-host-prompt-selection.test.ts:262` | 裁决 23，`pc1-book.md:432`；`pc1b-whitelist.txt:17` | 平台 Skill 文件删除后，测试仍断言根目录存在。干净结果树没有该目录时，实际为 `false`，断言要求 `true`。这是删除后的测试收口缺口；DSH 无权自行改这个白名单外文件。 | lead 明确放行删除该存在性断言及其无用 import，保留 `:260`、`:261` 的重导出和路径相等断言；不要补 `.gitkeep`。 |
| S-05 | 违规 | `.lead-ref/replies/pc1b-reply.md:105` | PC-15 平台用例，`pc1-book.md:655` | 长 Host 说明、`responseFormat`、紧窗口、可删历史的整条用例没有交付，也没有基线结果。 | lead 补齐并重新冻结所需夹具能力，然后补一个经公开准备/启动的完整用例，以手写请求计算预算，同时留下同输入在基线被计量器拒绝的证据。具体夹具缺口见下文。 |
| S-06 | 违规 | `tests/runtime/PC-model-budget-preview.test.ts:43`、`:67`、`:92` | PC-15 预留用例，`pc1-book.md:652`；期望规则 `:627`；规格 PE3 `slice-6-7-PROMPTS-SPEC.md:400` | 956/900 的分项数字正确，但测试手动持有一个 `ModelBudget`，第二次只预览，没有第二次真实发送；第一轮也只发 `completed: tool_calls`，没有真实工具调用。它会漏掉“发送层为下一轮预览新建 meter”的变异。`:92`、`:93` 还用生产预览结果充当预留期望。 | 经冻结平台夹具跑“真实工具调用→第二次模型请求”，固定计数 700、输出用量 200，字面断言两次 cap 为 256/200、总成本为 956/900，并核对实际请求和记录。 |
| S-07 | 违规 | `tests/runtime/PC-send-frozen-prompt.test.ts:27`、`:63`；`tests/runtime/PC-send-platform-root.test.ts:22`；`tests/runtime/PC-joint-prepare-freeze.test.ts:32`、`:66` | `pc1-book.md:53`、`:627`、`:678` | 冻结发送测试从生产冻结结果取模板正文来构造期望，最后只检查前缀；平台根测试也从生产 Skill 内容取期望，Query 只数调用。PC-06 只检查若干标记和“不含新版”。这些断言会漏掉旧 Skill 丢失、system 尾部多出内容或模板正文与发送正文一起出错。 | 注入已知的字面模板、Skill 和 Host 说明，手工拼接完整期望，比较完整 system 和该行要求的 input；两种运行都断言旧 Skill 确实存在。 |
| S-08 | 违规 | `tests/runtime/PC-send-start-check.test.ts:110` | 裁决 16，`pc1-book.md:382` | Work 覆盖五项单独变化，Query 只有三项；没有 Query 单独变 provider/model，也没有变化绑定的恢复检查。删除 Query 的 provider 比较，现有这八项仍不能发现。 | 补齐 Query 的两个独立字段用例，以及有活句柄恢复的拒绝、无活句柄先 `busy`、Query 进入后只观察的用例；全部检查没有新增模型调用。 |
| S-09 | 违规 | `tests/runtime/PC-joint-record-and-failure.test.ts:141`、`:157` | 裁决 25、PC-10，`pc1-book.md:450`、`:701` | 只检查 `unavailable` 和模型零调用，没有检查授权、Query 预留和 admission 为零。把工具正文等待移到计量器预留之后、提供方调用之前，仍可能满足现有断言。 | 在现有失败用例中同时断言夹具捕获的 Work authorization、Query reservation/admission 均为空，并通过公开读口确认没有请求记录。 |
| S-10 | 违规 | `tests/runtime/PC-joint-freeze-and-pin.test.ts:35` | PC-07，`pc1-book.md:684` | 恢复后直接取 `requests.at(-1)`，没有证明恢复产生了新请求。恢复分支只返回观察结果时，仍可能拿第一次请求与自身比较。 | 记录暂停前请求数，断言恢复后新增请求，再比较新增请求的 system 与第一次逐字节相等。 |
| S-11 | 违规 | `tests/runtime/B1-kernel-assembly.test.ts:219` | `pc1-book.md:56`；`run-pc1b.md:85` | 原测试超时从 60,000 提高到 120,000；差异明确见 `.lead-ref/parts/S.diff:1029`、`:1042`。迁移三个 Skill 场景没有获得延长超时的例外。 | 恢复原来的 60,000 毫秒上限。 |
| S-12 | 违规 | `src/core/agent-runtime/observed-model-run.ts:101`、`:393` | S 的限定职责，`pc1-book.md:425`、`:434`、`:549` | 额外增加了调用方可选的 `onContextSelected` 观察接口；当前生产调用者和本组测试均未使用。书要求的是包装层内部接收 Kernel 报告，没有要求再向外开放一个回调。 | 删除外部可选参数及转发，保留写入 `selections` 的内部 Kernel 回调。 |
| S-13 | 不整洁 | `src/core/agent-runtime/observed-model-run.ts:205` | 注释规则，`pc1-book.md:68` | 注释仍解释 `enabledIds` 的快照和默认选择，但该函数已没有这个选项；选择已移到准备阶段。 | 删除该过时分句，使注释只描述此处仍执行的快照行为。 |

**几个关键结论的证据如下。**

有 Host 说明和 `responseFormat` 时，提供方收到的请求**不保证与基线逐字节相等**；其中 Host 说明的位置变化是书明确允许的，不另列问题。令：

- `B` 为固定 base 原文；
- `K` 为相同 Skill 按原格式拼出的完整区段；
- `H = "HOST"`；
- 其余请求字段、标识、消息、工具和输出 cap 相同。

两者的区别可精确写成：

```text
基线：
systemPrompt = B + "\n\n" + K + "\n\nHOST"
responseFormat = {"type":"json_object"}

当前：
systemPrompt = B + "\n\nHOST\n\n" + K
responseFormat = {"type":"json_object"}
```

基线的尾部追加在 `.lead-ref/base/src/core/agent-runtime/observed-model-run.ts:257`；当前提前合并在 `src/core/agent-runtime/execution-preparation.ts:526`、`query-preparation.ts:298`；Kernel 按 base、Skill 区段拼接在 `vendor/coding-agent/dist/core/context/builder/context-builder.js:24`、`:36`、`:45`。这是 `pc1-book.md:45` 允许的差异。没有这些后续区段时，两种拼法相同；S-02 指的是重复转换违反接口约定，不能把上述允许的顺序变化算到它头上。

裁决 21 的主体已经接上：预览使用现有 meter，异步 counter 被等待，预览不写 entries、不持久化，真实预留仍在 `wrap`；下一次测量重新读取 `totals()`。证据是 `src/core/agent-runtime/model-budget.ts:85`、`:93`、`:102`、`:119`。剩下的是 S-03 的共同计算来源和 S-06 的验收入口问题。

裁决 22 的必需输入及五项 Kernel 接线存在：`src/core/agent-runtime/observed-model-run.ts:80`、`:387`；Work 从冻结集读回在 `execution-driver.ts:656`，Query 在 `query-execution.ts:238`。`PromptSkillV1` 与 Kernel `SkillContext` 同形，分别见 `prompt-set-texts.ts:27` 和 `vendor/coding-agent/dist/core/context/types/context-types.d.ts:40`，没有发现这个别名导致接口缺项。

裁决 24 的报告确实按 `requestId` 存取，事实在进入 meter 前生成；Work 传完整事实，Query 的共同投影删除 cap。`requestDigest` 仍计算 meter 内的最终请求。证据是 `observed-model-run.ts:229`、`:336`、`:348`，`model-call-access.ts:77`、`:88`，`query-execution.ts:156`、`:180`、`:469`，以及 `model-budget.ts:116`。cap 的重复计算另列 S-03。

裁决 25 的实现顺序正确：同步复制数组、按英文名称排序、序列化、开始 put、立即附加 rejection handler；发送前等待并逐请求校验 tools digest，失败时尚未进入 meter。Kernel 返回后重新抛出 `RuntimeModelCallRejected('unavailable')`，两种 driver 都保留该错误码。证据是 `observed-model-run.ts:397`、`:413`、`:328`、`:350`、`:475`，`execution-driver.ts:1053`，`query-execution.ts:612`。测试未守住全部顺序，见 S-09。

关于删除和目录：

- 十个文件及十项资产删除均在差异内，见 `.lead-ref/parts/S.diff:1`、`:58`、`:72`、`:95`、`:109`、`:155`、`:169`、`:216`、`:230`、`:281`、`:295`。
- 对 `runtime-assets.json:1` 的剩余 **61 项**逐项执行了只读 SHA-256 核对，全部匹配。
- 给定的完整导出树没有其他 `resources/skills` 文件，连该目录也不存在。本副本没有 `.git`，因此我没有把目录枚举冒充为独立的 Git 索引核验。
- 生产代码中的该路径用于 Host 选择和路径比较；平台分支从包取内容，只有其他根才调用文件 loader：`src/app/runtime-configuration.ts:421`、`src/core/agent-runtime/prompt-set-texts.ts:268`、`:283`。仍要求实际目录存在的是 S-04 的旧测试。

关于缺少 `selection`：

现有生产模型构造路径会填入 `selection`，准备快照也保留它，见 `src/app/runtime-configuration.ts:471`、`:474`，`src/core/agent-runtime/execution-preparation.ts:676`；没有找到现有生产构造路径主动省略它。类型允许省略并不授权跳过比较：回退值已经由 `src/contracts/prompts/prompt-set.ts:111` 定义。

旧测试的冲突是真实的：准备模型在 `tests/helpers/task-claim-fixture.ts:519`，启动模型在 `tests/helpers/S2B-runtime-steps-fixture.ts:385`；后者在 `:400` 又选择了不同的准备 Host。**这个不一致输入按裁决 16 应当 `forbidden`。** 修复方向是让旧测试准备和启动采用同一模型绑定，而非改变其原业务断言或豁免生产比较。无活句柄先 `busy` 的实现顺序目前正确，见 `execution-driver.ts:415`；Query 进入后先返回观察也正确，见 `query-execution.ts:230`。

关于 helper 和 PC-15：

冻结 helper 的失败确实存在：`tests/helpers/PC-platform-fixture.ts:617` 传 `tools: []`，WP2 用它安装 Role，见 `tests/helpers/WP2-platform-support.ts:560`、`:571`；拒绝条件是 `src/contracts/validation/role.ts:57` 调用不允许空数组的校验，实际拒绝在 `src/contracts/validation/common.ts:85`。

替代 helper 只把工具设为 `['read']`，再走生产 prepare/read，见 `tests/runtime/PC-frozen-prompt.ts:27`、`:40`；冻结输入的恢复仍由 `tests/helpers/PC-platform-fixture.ts:416` 完成。它是参数装配，没有手写提示词事实，这个替代本身成立。冻结夹具的唯一实际改动是 `:529` 的类型断言，差异见 `.lead-ref/parts/P.diff:3457`，没有运行行为修改。

DSH 对 PC-15 的解释只能部分成立：

- 夹具确实没有 `responseFormat` 输入，见 `tests/helpers/PC-platform-fixture.ts:55`；生产侧现有选项只在 `observed-model-run.ts:86`。因此当前冻结夹具不能直接完成整行。
- “只能产生小历史”不成立。`wp2-read.txt` 的短文本只是初始化内容，夹具公开了其目录；见 `WP2-platform-support.ts:553`、`:844`。脚本模型也接受任意长度正文及真实工具调用，见 `PC-kernel-fixture.ts:36`、`:63`。读权限只限定路径，没有在这里限定这段测试正文必须很短，见 `WP2-platform-support.ts:774`。
- 正常终答后直接 `continuation()` 被验证状态挡住，有明确依据：`PC-platform-fixture.ts:466` 直接 requeue，`src/core/work-graph/state/task-machine.ts:1216` 要求先完成验证。现有“先 crash 再接续”的测试不能替代完成历史用例，因为 driver 取的是 completed history boundary，见 `tests/work-graph/PC-entry-frozen-continuation.test.ts:29`、`execution-driver.ts:719`。

我会裁定的最小夹具补充是：**通过公开验证/领取步骤取得同 Session 的完成历史，并提供把 `responseFormat` 传入既有发送参数的受控装配入口**。然后只需一段已完成的长正文历史、长 Host 说明和一次紧预算启动。预算由手写的删前、删后完整请求计算。无需因此新增生产 Host 设置功能，也不能注入伪造历史来绕过公开步骤。依据是规格 PE3/PE5（`slice-6-7-PROMPTS-SPEC.md:400`、`:402`）和 `pc1-book.md:655`。

旧调用者的参数迁移与断言核对结果：

| 测试 | 核对结果及会漏掉的变异 |
|---|---|
| `tests/runtime/B1-kernel-assembly.test.ts:183` | 三个 Skill 场景已移到公开 prepare/start，保留自定义、显式空选和准备后变化被忽略的期望；超时违规见 S-11。仅检查内容标记，单改 Skill 的 priority/source 不一定失败（`:191`、`:203`、`:213`）。 |
| `tests/data/cpp-source-index.test.ts:150` | 差异只补参数和所需 import，原断言保留；没有传 `responseFormat`，会漏掉删除格式转换的变异。 |
| `tests/runtime/R4c-execution-history.test.ts:68` | 同上；会漏掉删除格式转换。 |
| `tests/runtime/R4c-graph-history.test.ts:248` | 同上；会漏掉删除格式转换。 |
| `tests/runtime/R4c-session-continuity.test.ts:40` | 同上；会漏掉删除格式转换。 |
| `tests/runtime/source-text-loop-migration.test.ts:182` | 同上；会漏掉删除格式转换。 |
| `tests/runtime/source-tool-lifecycle.test.ts:115` | 同上；会漏掉删除格式转换。 |

这些旧测试的覆盖边界本身不要求顺手扩充；格式与预算的新增保证应由 PC-15 承担。S 的 27 个路径均匹配白名单；额外未请求的接口见 S-12，旧测试越界改动见 S-11（`.lead-ref/parts/S-files.txt:1`，`pc1b-whitelist.txt:1`、`:9`、`:12`、`:16`、`:18`）。

逐裁决、逐行：

- 裁决 16：S-01、S-08。
- 裁决 20：S-02。
- 裁决 21：S-03、S-06。
- 裁决 22：必需输入和五项接线 OK；S-07、S-12、S-13。
- 裁决 23：删除及剩余资产摘要 OK；S-04。
- 裁决 24：请求关联、事实传递和 digest 含义 OK；S-03。
- 裁决 25：实现顺序 OK；S-09。
- §4 S 行及冻结接缝：S-02、S-03、S-12；`PromptSkillV1` 同形接缝 OK。
- §5.1 参数 helper：OK。
- PC-06（S 半）：S-07。
- PC-07：S-10。
- PC-08：OK；第二次解析改变包的拒绝见 `PC-send-start-check.test.ts:58`，真实 registry 钉住旧绑定见 `PC-joint-freeze-and-pin.test.ts:53`。
- PC-10（S 半）：S-09。
- PC-15 预留：S-06。
- PC-15 平台：S-05。
- §5.3 S 旧调用者：参数迁移和原期望 OK；S-11。

DSH 自述中涉及 S 的条目：

- §1.1、§4.2、§9.3：**不成立**。模型不一致事实成立，生产豁免不成立；而且 §5.3 已点名 S3，只允许补 manifest，见 `pc1-book.md:723`、`:729`，不能解释为未点名或允许跳过比较。
- §1.2、§4.3、§9.2：**成立**。空工具表确实被拒；替代 helper 确实经生产准备和读取，仅装配参数。证据见上面的 `role.ts:57`、`common.ts:85`、`PC-frozen-prompt.ts:40`。
- §1.3、§9.1：**成立**。目录存在性断言与删除冲突，且修改需要 lead 放行；见 S-04。
- §1.4、§8、§9.4：**不成立（作为完整归因）**。未完成和格式注入缺口成立；“只能小历史”不成立，完成后接续缺少验证步骤也不能归结为历史正文能力不足。见上述夹具证据及 S-05。
- §4.5 中 S 的工具正文 `sourceRefs`：**成立**。正文存储要求非空来源，见 `src/core/record-store/body-codec.ts:174`；实际治理引用在 `observed-model-run.ts:404`，没有改动冻结签名。
- §4.6：**成立**。别名同形，见 `prompt-set-texts.ts:27` 和 Kernel `context-types.d.ts:40`。
- §4.9：**成立**。唯一变化是类型断言，见 `.lead-ref/parts/P.diff:3457`。
- §9.6：**成立，但不是新增问题**。运行表已经说明两个依赖名称的对应，见 `run-pc1b.md:71`。

```json
[
  {
    "id": "S-01",
    "class": "会出错",
    "file": "src/core/agent-runtime/execution-driver.ts",
    "line": 121,
    "basis": "pc1-book.md:299、382；共同规则5",
    "problem": "此处及 query-execution.ts:100 在 selection 缺席时跳过全部五项比较。准备 test/test、启动 deepseek/s2b-runtime-steps-model 时，应 forbidden，实际比较通过并继续启动；该分支专为保住旧测试加入。",
    "fix": "删除两处提前返回，无条件使用 promptSelectionOf 比较五项；由 lead 放行让旧夹具准备和启动使用同一模型绑定，保留原业务断言。"
  },
  {
    "id": "S-02",
    "class": "违规",
    "file": "src/core/agent-runtime/observed-model-run.ts",
    "line": 350,
    "basis": "裁决20，pc1-book.md:410",
    "problem": "客户端包装层仍调用 finalRequest 再次添加 responseFormat，违反发送 Kernel 所交请求的约定；当前转换幂等，未据此认定额外字节变化。",
    "fix": "改为 metered.stream(request, options)，最终转换只留在预览入口。"
  },
  {
    "id": "S-03",
    "class": "违规",
    "file": "src/core/agent-runtime/model-budget.ts",
    "line": 85,
    "basis": "裁决21、24，pc1-book.md:415、439",
    "problem": "共同测量函数不返回 fits，预览和发送分别判断；observed-model-run.ts:340 又复制 cap 公式。",
    "fix": "共同测量结果统一包含 cap、计数和 fits，由预览、发送检查和事实装配取用，删除外围重复公式。"
  },
  {
    "id": "S-04",
    "class": "违规",
    "file": "tests/app/PC-host-prompt-selection.test.ts",
    "line": 262,
    "basis": "裁决23，pc1-book.md:432；pc1b-whitelist.txt:17",
    "problem": "删除平台 Skill 后干净结果树没有 resources/skills，但旧测试仍要求该目录存在；该文件不在本轮允许修改范围。",
    "fix": "由 lead 放行删除存在性断言和无用 import，保留重导出及绝对路径相等断言，不补占位文件。"
  },
  {
    "id": "S-05",
    "class": "违规",
    "file": ".lead-ref/replies/pc1b-reply.md",
    "line": 105,
    "basis": "PC-15 平台用例，pc1-book.md:655",
    "problem": "长 Host 说明、responseFormat、紧窗口和可删历史的整条用例未交付，也没有基线拒绝结果。",
    "fix": "由 lead 补齐并冻结公开完成历史及 responseFormat 装配入口，再交付以手写请求计算预算的整条测试和基线对照证据。"
  },
  {
    "id": "S-06",
    "class": "违规",
    "file": "tests/runtime/PC-model-budget-preview.test.ts",
    "line": 43,
    "basis": "pc1-book.md:627、652；slice-6-7-PROMPTS-SPEC.md:400",
    "problem": "956/900 用例只手动操作一个 meter，第二次没有真实发送，第一轮没有实际工具调用，不能证明发送链复用同一账户；92、93行还取生产预览结果作期望。",
    "fix": "经平台公开准备和启动跑真实工具循环，固定计数700、第一轮输出200，字面核对两次请求及记录的256/200预留和956/900总成本。"
  },
  {
    "id": "S-07",
    "class": "违规",
    "file": "tests/runtime/PC-send-frozen-prompt.test.ts",
    "line": 27,
    "basis": "pc1-book.md:53、627、678",
    "problem": "Work/Query 从生产冻结正文构造期望且仅检查前缀；平台根测试从生产 Skill 取期望，PC-06只检查标记。旧Skill丢失或system尾部多内容可能漏检。",
    "fix": "注入字面模板、Skill和Host说明，手工拼接完整期望，比较完整system及规定input，并在两种运行中断言旧Skill确实存在。"
  },
  {
    "id": "S-08",
    "class": "违规",
    "file": "tests/runtime/PC-send-start-check.test.ts",
    "line": 110,
    "basis": "裁决16，pc1-book.md:382",
    "problem": "Query缺少单独改变provider和model的用例，也没有变化绑定的恢复检查及拒绝顺序覆盖。",
    "fix": "补齐Query两字段独立变化、有活句柄恢复拒绝、无活句柄先busy和Query进入后只观察的用例，检查没有新增模型调用。"
  },
  {
    "id": "S-09",
    "class": "违规",
    "file": "tests/runtime/PC-joint-record-and-failure.test.ts",
    "line": 141,
    "basis": "裁决25及PC-10，pc1-book.md:450、701",
    "problem": "失败测试只检查unavailable和模型零调用，不能发现失败前已经留下预算预留或授权的变异。",
    "fix": "同时断言捕获的Work authorization、Query reservation/admission均为空，并通过公开读口确认没有请求记录。"
  },
  {
    "id": "S-10",
    "class": "违规",
    "file": "tests/runtime/PC-joint-freeze-and-pin.test.ts",
    "line": 35,
    "basis": "PC-07，pc1-book.md:684",
    "problem": "恢复后取最后一条请求，但未证明有新增请求；恢复只返回观察结果时可能把第一次请求与自身比较。",
    "fix": "断言恢复后请求数量增加，再将新增请求的system与第一次逐字节比较。"
  },
  {
    "id": "S-11",
    "class": "违规",
    "file": "tests/runtime/B1-kernel-assembly.test.ts",
    "line": 219,
    "basis": "pc1-book.md:56；run-pc1b.md:85",
    "problem": "旧测试超时由60000毫秒提高到120000毫秒，违反禁止延长超时的规定。",
    "fix": "恢复原60000毫秒上限。"
  },
  {
    "id": "S-12",
    "class": "违规",
    "file": "src/core/agent-runtime/observed-model-run.ts",
    "line": 101,
    "basis": "pc1-book.md:425、434、549",
    "problem": "新增未被生产调用者或本组测试使用的外部onContextSelected选项；冻结书只要求包装层内部接收Kernel报告。",
    "fix": "删除外部选项及393行转发，保留内部按requestId记录报告的Kernel回调。"
  },
  {
    "id": "S-13",
    "class": "不整洁",
    "file": "src/core/agent-runtime/observed-model-run.ts",
    "line": 205,
    "basis": "pc1-book.md:68",
    "problem": "注释仍解释已不存在的enabledIds选项及其默认选择行为。",
    "fix": "删除过时分句，只描述此处实际执行的快照行为。"
  }
]
```

会出错 1，违规 11，不整洁 1，建议 0