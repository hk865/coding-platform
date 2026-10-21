# 第 6、7 片补充规格：提示词和上下文（决定 83）

**状态：第三稿（lead，2026-10-21）。** 已按 Codex 两轮完整审查（第一轮 23 条、第二轮复核加 9 条新问题，处理见 §7）和你 10-21 的五个答复（§0.1）改过；待最后一次快速核对、待你确认测试入口，冻结前不施工。

第 6、7 片已冻结（决定 64），这一节是冻结后的补充，不改它们已定的行为。它定这几件事：
- 提示词放在哪、谁能改、按什么选；
- 超长时怎么删；
- 任务输入怎么排；
- 怎么记下实际发出的提示词。

依据是 Codex 10-18 的只读调研（冻结时复制进证据）；§0.2 每一条，lead 或 Codex 都对着 `4d874f0b` 的代码核过。

和别的轮的关系：
- **D3（6A 之前的结构一轮，决定 85-1）**：拆上下文装配器时按本节 §2 的模板包和渲染器做，把今天写死的文字**原样**搬进平台包第 1 版，发出的字节不变。
- **PC（提示词和上下文）**：本节的新行为由这个单独的施工片做，排在结构一轮之后、6A 之前。
- **各片**：自己的模板（秘书、派活、等待、转交、干预）在各片里写，用本节的机制（§0.4）。

## 0. 冻结说明（lead）

### 0.1 你 10-21 定的，和还要你定的

1. **秘书接它 Session 的完整历史（P6）。** 你说：“应该是接秘书的完整历史，等到新的目标，任务的时候再新增，或者平台/秘书觉得不太匹配自身的上下文。而且每次从记录重建，你得做语义判断”。
   - 这和 HANDOFF 第 133 行的旧决定一致：请求交给“同一目标、空闲、还不太长”的秘书，都不合适就新开；秘书的记忆靠注记加当前理解。
   - 第 6 片 L8 的“这个请求以前的轮次”只补**不在这个 Session 历史里**的轮次（例如转来以前在别的秘书上跑的）。去重按“跑在哪个 Session 上”机械判断，不用模型。
2. **换手不带完整历史，带一份像压缩一样的简报，加上记忆指针和工具（P7）。** 你说：“类似你的简报，不过必要的工具，记忆指针是需要的”，并且不同层面的记忆、负责的宽度和广度不同。
   - 简报按职责分三种模板（执行者、参谋、秘书），各带自己那一层的记忆指针（架构图和任务图上负责范围里的东西）。
   - 换手前，前任按“写理解”的模板写当前理解，这就是压缩那一步。这几份模板都在包里，可以按模型改。
3. **设置里能选包、能看能改模板（P1、P2）。** 你说：“设置里面选包，改模板不能直接复用我们的那个看文件的那个功能以及编辑文件的工具吗？……我认为这是属于要加的行为，用得上的。”
   - 每个模型在设置里选用哪个包、思考带不带回。
   - 模板在新界面里用看文件、改文件的同一个组件看和改，保存经 Host 校验。
   - 包放在 Host 自己的数据目录里，不放项目工作区：agent 有改工作区文件的工具，放进去等于让 agent 能改自己的提示词。
   - 平台自带的包只读；改它的模板时存进你自己的包（继承平台包，只放改过的）。
4. **任务输入的排法这一轮就做（P10）。** “提醒”挪到最后，各段的先后写在模板里、按包（也就是按模型）变。
   - 开始前的核对、记录格式、入口对接续简报的核对都改成按冻结的顺序核。
   - 预算不够时先省略哪段（保留的先后）不随展示顺序变，照今天。
5. **秘书自己觉得不匹配、把请求转给新秘书：这一轮不加。** 平台挑秘书的规则和太长就换手照第 6 片；秘书觉得不合适时在回答里建议你转交（第 6 片已有人点的转交）。
6. **还要你定：测试入口**（§3.1），确认后施工。

### 0.2 代码事实（`4d874f0b`）

| # | 事实 | 位置 |
|---|---|---|
| F1 | Kernel 基础提示词 `coding-agent-v5` 写死在冻结的 dist 里，约 3,800 字符；第 14 行让模型用 `check`，第 12、15 行讲 `read`、`shell`。Kernel 有 `check` 工具，平台给 Kernel 的工具名里从来没有它 | `vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:2`、`:12`–`:15`；`dist/tools/builtin/check/check-tool.js:96`；`src/core/agent-runtime/observed-model-run.ts:272` |
| F2 | system 由 Kernel 拼：基础提示词 → 附加指令 → 行为说明（instruction Skill）→ 参考 Skill → 记忆。Host 的 `systemInstruction` 和 `responseFormat` 在 Kernel 选完上下文**之后**才加到请求上 | `dist/core/context/builder/context-builder.js:25`；`observed-model-run.ts:261`–`:263` |
| F3 | Skill 正文在每次执行开始时才按目录读文件，不随准备冻结；恢复执行走 `resume-composition`，也重新读 Skill、用固定的基础提示词。`onConfiguration` 是同步回调，Kernel 不等它，平台没接 | `vendor/coding-agent/patches/app/composition/composition-root.ts:117`、`:330`、`:415`、`:423`；`patches/app/composition/resume-composition.ts:311`、`:318`、`:406` |
| F4 | Skill 的形状是 `SkillContext { id, title, content, kind: instruction/reference, priority, source }`；`source` 是 Skill id 加正文 digest，没有目录路径。`onConfiguration` 还必填 `skillResourceRoot` | `dist/core/context/types/context-types.js:50`；`dist/skills/loader/file-skill-loader.js:78`；`context-builder.js:20`；`patches/app/composition/composition-contracts.ts:24` |
| F5 | Work 的任务输入是一条 user 消息，段的先后写死：角色和运行配置、目标、任务、足迹、注记索引、提醒、选定输入、接续简报（K3 复核轮另有复核说明，在最后） | `src/core/agent-runtime/context-assembler.ts:79`、`:93` |
| F6 | 足迹、注记、提醒、选定输入四段共用一个字节预算：按这个固定顺序把各段的行排成一串，保留能放下的最长前缀，其余写“另有 N 条，用‘看’读” | `context-assembler.ts:266`–`:312` |
| F7 | 状态守卫按固定段序核对任务输入，并规定每种调用能有哪些段：秘书是角色、目标、任务、注记、提醒；copy 是角色、目标、任务；每种都必须有角色段。接续简报必须是最后一段、结束在全文末尾，复核说明也必须在最后。入口还会不带模板重新渲染简报，核对它是全文的后缀。有测试直接锁定“简报在全文末尾”（CA12） | `src/core/work-graph/state/context-input.ts:44`–`:72`、`:197`、`:255`、`:282`、`:294`；`execution-entry-service.ts:973`、`:1201`；`tests/runtime/S3-context-assembler.test.ts:813`–`:834` |
| F8 | Kernel 每次模型请求把“以前执行的历史”和“这次执行的对话”分开拿，再拼起来交给预算选择。选择对象是 `ContextBuilderInput`，`ModelRequest` 在选完以后才拼出来 | `patches/core/runtime/loop/runtime-runner.ts:666`、`:686`、`:687` |
| F9 | 超预算时依次删记忆、参考 Skill、附加指令、行为说明，再从最旧的起删旧的 user 消息和带工具调用的整组交换。不删：最新一条 user 消息、没有工具调用的 assistant 消息、没闭合的调用；不留摘要。运行中来信也是 user 消息，所以当前任务那条会被删。删法不在受管补丁清单里 | `dist/core/context/selection_policy/context-selection-policy.js:30`–`:66`、`:92`、`:154`；`scripts/build-kernel-patch.mjs:13` |
| F10 | 两套预算对不上：<br>• Kernel 按“序列化字符数 ÷ 3”估，和上下文窗口比；hook 改过请求后，也用这个估法和同一个窗口复核；<br>• 平台计量器按最终请求（含 Host 说明、`responseFormat`）的 UTF-8 字节加 4,096 估（有分词器时用分词器，可异步），再加输出预留比窗口。输出预留取决于请求的输出上限和累计已用输出。<br>计量器判超时直接拒绝，不回 Kernel 再删 | `context-selection-policy.js:9`；`runtime-runner.ts:714`–`:715`；`src/core/agent-runtime/model-budget.ts:6`、`:52`、`:82`–`:95` |
| F11 | 思考：DeepSeek 适配器把历史里的思考原样带回，OpenAI 适配器一律不带。只有思考、没有正文和工具调用的 assistant 消息是合法记录 | `dist/model/providers/deepseek/deepseek-model-client.js:28`；`dist/core/runtime/loop/model-stream-consumer.js:137`；`dist/core/runtime/state/run-state.js:130` |
| F12 | 工具结果有三种：`success`、`error`（必带 `error`）、`cancelled`（必带 `reason`），都带 `schemaVersion`、`callId`、`output[]`、`effects`；`output` 和错误消息都没有长度上限。两家适配器都把整个结果当 JSON 发 | `dist/core/ports/tool_executor/tool-executor-port.js:53`–`:76`；`deepseek-model-client.js:41`；`openai-model-client.js:39` |
| F13 | Query 的执行接不接 Session 历史由 `sessionContext` 定：`current_turn`（不接）或 `session_history`（接到某个位置） | `src/core/agent-runtime/query-execution.ts:481`–`:501` |
| F14 | Work 的接续 Session 第一轮接原 Session 的历史（LA-1）；归档来源的重新入队不接。图工具的历史分支只认 `RunRef`，读不了 Query 历史；`read_session_card` 不读历史 | `src/core/agent-runtime/execution-driver.ts:929`；`context-assembler.ts:1447`；`graph-tools.ts:358`；`session-discovery-tools.ts:139` |
| F15 | 写死的大段文字：<br>• 初始化回答格式约 8,400 字符；白板工具说明约 3,200；`project_source` 说明约 2,400；`record_note` 约 1,200；接续简报的固定文字几千字符；<br>• 还有角色短句、各段标签、K3 复核和提方案的说明、K3 两个工具的说明、咨询消费指导、“用户答复”前缀 | `query-preparation.ts:50`；`whiteboard-tools.ts:445`；`project-source-tool.ts:237`；`note-tool.ts`；`src/contracts/continuation-brief.ts:345`；`role-profiles.ts:23`；`context-assembler.ts:82`；`src/contracts/core/prepared-execution.ts:97`、`:130`；`unknown-call-review-tools.ts:212`；`command-rerun-tools.ts:206`；`src/business/workflow/consultation.ts:447`；`execution-inputs.ts:59` |
| F16 | 每次模型请求已经有一份记录：<br>• Work：WorkGraph 写许可记录，授权和消费两次各投影一遍，编解码拒绝未知字段；只有整请求 digest、任务输入 digest、manifest digest，没有输出上限；<br>• Query：更新 QueryRun 的请求记录，`reservedOutput` 就是计量器定的输出上限；用量更新时除 `admitted` 外整条重写 | `observed-model-run.ts:249`–`:251`；`model-call-access.ts:63`、`:77`、`:88`；`src/core/work-graph/tasks/model-call-service.ts:163`；`src/core/work-graph/tasks/model-request-codecs.ts:83`；`src/core/work-graph/queries/query-execution.ts:1310`、`:1400`；`src/contracts/query-job.ts:360`、`:366` |
| F17 | prepared manifest 用 `bodies.put` 存成一个 body（有大小上限），不在一次提交里；body 存储第一次写入以后同内容去重 | `src/core/agent-runtime/execution-preparation.ts:561`–`:571`；`query-preparation.ts:366`；`src/core/record-store/body-store.ts:39` |
| F18 | 固定来源读取模式下，Kernel 拿到的读工具是 `read_source`、`read_material`，没有 `read` | `observed-model-run.ts:301` |
| F19 | 配置对不上时：Work 开始和有同进程证明的恢复回 `forbidden`，恢复缺活句柄先回 `busy`；Query 进入以后只观察，没有恢复重入 | `execution-driver.ts:631`、`:824`；`query-execution.ts:176`、`:202` |
| F20 | 设置里的模型项只有 id、名字、provider、model、baseUrl、thinking、reasoningEffort；按 DeepSeek 型号换上下文窗口是 Host 里的一个分支 | `src/app/host-settings-types.ts:10`–`:15`；`src/app/host.ts:260` |
| F21 | 平台 Skill 正文在 `resources/skills/platform-*`，列进 `runtime-assets.json` 的哈希清单；Host 可以换 Skill 目录。W2、AG6 两个测试直接读这些文件和目录配置 | `runtime-assets.json:39`；`src/app/runtime-configuration.ts:58`、`:373`；`tests/runtime/W2-role-skills.test.ts:33`；`tests/app/AG6-agent-assembly.test.ts:178` |
| F22 | Kernel 的 `selectContext` 和 `RuntimeRunner` 都是公开导出 | `vendor/coding-agent/dist/public-api.d.ts:33`、`:40` |

### 0.3 lead 定的技术选择

**P1 模板包和编辑。**【lead 定，待审；编辑按你 10-21 定的】
- **包的样子**：一个目录，里面有：
  - `pack.json`；
  - 模板文件；
  - `strings.json`：段标签、“未声明”这类短语；
  - `tools/<工具名>.json`：工具说明和参数说明。
- `pack.json` 列每个模板的 id、文件、版本号（改一个字也加 1）、块外提到的工具名（P9），以及 `extends`（继承哪个包）。
- **两处位置**：
  - 平台包在 `resources/prompts/platform/`，随版本发，只读，和 Skill 一样进 `runtime-assets.json` 的哈希清单，检查脚本复算；
  - 你的包在 Host 设置所在的数据目录下 `prompts/<包 id>/`。不在任何工作区里，agent 的工具碰不到。
- **槽位由代码定**：每个调用配方一张表，写明模板 id 和它有哪些槽位。包只能改文字，不能加减槽位。Work、Query 任务输入的模板还能改段的先后，限制见 P10。
- **语法**只有三样：
  - `{{槽位}}`：放入平台写好的一段文字；
  - `{{#槽位}}…{{/槽位}}`：槽位不空时才出现；
  - `{{#tool:工具名}}…{{/tool:工具名}}`：这次执行最终交给 Kernel 的工具清单里有这个工具时才出现。
  没有表达式、循环、转义和引用别的模板；正文里不许出现别的 `{{`。只有一个块标记的整行，连同换行一起去掉。
- **分工**：事实怎么写成文字（目标、任务、注记索引的条目）仍在代码里，标签从 `strings.json` 取；模板管说明性的话和段的先后。
- **解析**：每个模板取最具体的包里的那一份，记下来自哪个包；你的包没给的模板，从它继承的包取。
- **校验**（加载和保存时都做）：
  - 模板用到的槽位都在代码表里，必填槽位都出现且只出现一次；
  - 引用的文件都在；
  - 段的先后合法（P10）。
  渲染时必填槽位为空算代码错误，准备回 `invalid`。
- **编辑**（Host 路由，只认人，和设置同一类）：
  - 列出包和模板：每个模板的版本、来源包、校验结果；
  - 读一个模板：正文、版本、槽位表、块外工具名；
  - 存一个模板：带 `expectedVersion`，版本对不上回 `revision_conflict`；校验不过回 `invalid` 并列出问题；通过就写文件、版本加 1；
  - 新建一个包（继承平台包）。
  平台包上存模板回 `forbidden`，界面应先让你选或新建自己的包。
- **生效**：每次准备都按当时的包解析，所以存了以后，下一次准备就用新版；已经准备好的执行用冻结的那份（P5）。包坏了（文件被手工改坏），用到它的准备回 `invalid` 并写明包、模板、原因，不悄悄退回平台包。
- **谁能改**：agent 不能改提示词；你在设置里改；运行平台的人也可以直接往数据目录里放包，同样经校验。

**P2 按模型选包和思考策略。**【lead 定，待审；选包按你 10-21 定的】
- “按模型的策略表”就是设置里的模型列表，每个模型项加两项：
  - `promptPack`（缺省 `platform`）；
  - `reasoningReplay`（`current_run` 或 `none`，缺省 `current_run`，P4）。
  不另建一张按型号前缀匹配的表。上下文窗口照今天（`host.ts:260` 不动）。
- Host 配置里直接给的模型绑定（不经设置的）也带这两项，缺省值相同。
- **准备时**按这次执行的模型绑定取一次，把模型项 id、provider、model、包 id、`reasoningReplay` 记进冻结集（P5）。
- **开始和恢复时**，绑定取出的这几项和冻结集不一样，就按今天“配置对不上”处理（F19）：Work 开始和有同进程证明的恢复回 `forbidden`；恢复缺活句柄先回 `busy`。Query 进入以后只观察，不再核。

**P3 超长时的删法（Kernel 受管补丁）。**【lead 定，待审】
- `scripts/build-kernel-patch.mjs` 的补丁清单加 `core/context/selection_policy/context-selection-policy.ts`，源码照已有做法从冻结的 source map 还原。
- **估的就是最后发出去的那个请求（解 F10）。**
  - Host 附加说明并进传入的基础提示词（P5），选上下文时就算在里面。
  - 平台给 Kernel 一个**预估**口，由这次执行的同一个 `ModelBudget` 提供，可以异步。输入是 Kernel 拼好的候选请求，返回四样：
    1. 平台外层改过的最终请求（加 `responseFormat`、定输出上限）；
    2. 输入计数，和计量器同一个计法；
    3. 输出预留，按同一账户的累计用量算；
    4. 放不放得下。
    预估不占预留，真正的预留仍在发出时由计量器做。
  - runner 删每一步都用同一个 builder 拼出候选请求，再调预估。删的先后是固定的、删得越多请求越小，所以可以二分找出“最少删几步就放得下”，最多调 log₂ 次预估。
  - hook 改过请求以后也用预估复核，不再拿旧的估法和窗口比（`runtime-runner.ts:714`–`:715`）。
  - 计量器的检查留着兜底。删到只剩不删的内容还放不下，回今天的 `required_content_over_budget`。
- **不删的：**
  1. 基础提示词和 Host 附加说明（今天也不删）；
  2. 行为说明（instruction Skill），今天会删，改成不删；
  3. **这次执行的任务输入**（这次执行的第一条 user 消息），由 runner 按 F8 的分界标出来；
  4. 最新一条 user 消息；
  5. 没闭合的调用。
- **删的顺序：**
  1. 记忆；
  2. 参考 Skill；
  3. 附加指令；
  4. **以前执行里成功的工具结果的正文**，从最旧的起，换成占位：
     - `output` 换成一个 text 项：“内容因长度省略（工具 <名字>，调用 <id>），需要时重新读”；
     - `schemaVersion`、`callId`、`status`、`effects` 原样；
     - `error`、`cancelled` 的结果这一步不动，到第 5 步随整组删；
     - 调用和结果的配对不动；
  5. 以前执行里的整组交换（带工具调用的 assistant 和它的全部结果）和旧的 user 消息，从最旧的起；
  6. 以前执行里没有工具调用的 assistant 消息（多是那次的结论），从最旧的起。今天不删，现在可删，这是行为变化；放在以前执行里最后才删；
  7. 这次执行里不受保护的整组交换，从最旧的起。
- **删了什么要报给平台**：Kernel 补丁加一个回调，在调模型之前按 `requestId` 报这次删的各类个数、输入计数和预算；恢复执行也一样。平台把它并进这次请求的记录（P5）。

**P4 思考。**【lead 定，待审】
- `current_run`：拼请求前去掉以前执行（历史）里 assistant 消息的思考，这次执行里的保留。`none`：全部去掉。
- 去掉思考以后既没有正文、也没有工具调用的 assistant 消息，从发出的那份里拿掉（F11 那种合法记录不能变成空消息）。
- 只改发出的那份，Kernel 存的原记录不动，原历史照旧能按需读。
- 在 runtime-runner 里做（已在补丁清单），提供方适配器不改。OpenAI 适配器本来就不带思考，选什么效果都一样。
- 平台不把思考写成事实、消息或简报：今天就是这样，写成规则。

**P5 冻结和记下每次实际发出的整套提示词。**【lead 定，待审】
- **冻结集** `PromptSetV1`：准备时算出，存进 prepared manifest，算进 manifest digest。内容：
  - 模型项 id、provider、model、包 id、`reasoningReplay`；
  - 每种调用的段序（P10）；
  - 用到的每个模板：id、版本、来自哪个包、digest、正文的 body 引用；
  - 基础提示词（已并入 Host 附加说明）：模板 id、版本、digest、body 引用；
  - 每个 Skill 的完整 `SkillContext`（F4，含 reference Skill）：元数据、digest、正文的 body 引用。
- **准备时就读出 system 侧的全部正文和用到的模板正文。**
  - Skill 照今天的选择规则选：平台自己的行为说明从包里取，Host 另配的 Skill 目录照今天的 loader 读；明确选了空的就是空。
  - 每段正文在存 manifest 之前用 `bodies.put` 存（和 manifest 同一个存法，F17；同内容只存一份）。manifest 只记引用和 digest，免得超大小上限。
  - Work、Query 两条准备路径都这样做。
- **开始和恢复执行时，平台把冻结的正文直接交给 Kernel。**
  - 补丁让 `composition-root` 和 `resume-composition` 都接受传入的基础提示词（带模板 id 和版本）和 `SkillContext` 列表，不再按目录读文件、不再用固定的基础提示词。所以准备之后改了包或文件，这次执行不受影响，暂停后恢复也不受影响（解 F3）。
  - `onConfiguration` 照原形状回报：`systemPromptVersion` 写“模板 id@版本”；`skills` 是传入的那份；`skillResourceRoot` 写固定值 `"provided-by-host"`。
- **入口对接续简报的重新渲染**，用冻结集里那份 `continuation-brief` 模板的正文（按 body 引用读回）。
- **每次模型请求的记录**（F16）：
  - 加 `systemDigest`、`toolsDigest`、`toolSpecsRef`，和 P3 回调报的删除个数、输入计数、预算；
  - Work 另加 `maxOutputTokens`；Query 用已有的 `reservedOutput`，不另加同义字段。
  - 这些都是请求的**不可变部分**：
    - Work 的授权、消费两次投影都带它们；
    - 进事件、重放和幂等指纹；
    - 同一请求 id 带不同的这些事实，回 `idempotency_conflict`；
    - Query 的用量更新只改用量字段，不再整条重写。
  - 决定 79：不兼容旧记录，开发时旧库重建。
- **`toolSpecsRef`**：
  - Kernel 回报配置时，平台同步记下工具说明（含 read、edit、shell 这些内置工具），开始存成一个 body，保存这个存储的 Promise；
  - 第一次 `beforeCall` 之前，在共用的请求包装层等它存完、核对 digest；存失败就不调模型，这次执行按 `unavailable` 失败；
  - 同一次执行的后续请求沿用这个引用；Work、Query、恢复都一样。
- **读口**：Runtime owner 的只读方法 `readPromptRecord`（执行或查询执行的引用），返回冻结集、每次请求的记录、用到的正文。路由和界面在 E3。
- **“对得上”指什么**：
  - 每次请求的 system 和工具说明能逐字还原，digest 和记录对得上；
  - 用了哪个包、哪版模板、怎么排、删了多少、输出上限多少，都查得到；
  - 消息部分在 Kernel Session 记录里，选了哪些由删除个数和固定的删法定。
  - 不承诺逐字节还原整个请求、对上整请求 digest：那要么每次存整个请求（太大），要么重放 Kernel 的拼装。

**P6 秘书的上下文（你 10-21 定的）。**
- 秘书一轮照普通 Query 接它 Session 的已完成历史（`session_history`，F13），受 P3 的删法约束；太长就按第 6 片 L10 换手。
- `secretary-round` 模板落在状态守卫给秘书定的段里（角色、目标、任务、注记、提醒；F7），不加新段。请求的内容在“任务”段，分三个槽：
  1. **这一轮**：本轮的输入（你的话，或追问、选择、回复、到期、转来的说明）；
  2. **合批的**：第 6 片 L5 合进这一轮的同请求排队输入，按 `since` 顺序原文全放，不截、不算进 10 轮；
  3. **不在本 Session 历史里的以前轮次**：这个请求以前跑在**别的** Session 上的执行轮（例如换手、转交以前），最多 10 轮，每个回答截到 2 KiB，截断加一行省略说明。每个执行轮连同合进它的轮次的原话一起带。跑在本 Session 上的轮次已经在历史里，不重复。
- 工作区概况、目标列表、当前理解和注记索引照第 6 片 L8 每轮都给。

**P7 换手的上下文（你 10-21 定的）。**
- 第 6 片 L10 的秘书换手、第 7 片 L18 的执行者和参谋换手，建接任 Session 时都不写 `sessionBasis`，不带前任的对话历史。
- **换手前先写理解**：第 6 片 L10 第 1 步、第 7 片 L18 要求前任写当前理解。请它写的那段话是模板 `handoff-write-understanding-<职责>`，写明要写什么。这就是压缩那一步，保留哪些信息由这份模板决定。
- **接任者的简报**：模板 `handoff-brief-<职责>`，按职责的层面各带：
  - **执行者**（任务这一层）：
    - 交出的任务，每个任务的阶段和最后结果；
    - 前任最后一次执行的结论（只取正文，不取思考）；
    - 任务涉及模块的注记索引。
  - **参谋**（阶段或区域这一层）：
    - 负责范围内任务的状态；
    - 负责区域的模块和注记索引；
    - 未决的决定；
    - 最近 3 次 Query 的回答，每个截到 2 KiB（Query 历史这一轮没有读的工具，F14）。
  - **秘书**（项目和目标这一层）：
    - 归属在它手上的未完请求，每个带原话和最后一次回答；
    - 相关目标的当前理解指针。
  - 三种都带：前任写的那份当前理解的指针、旧线链接。
- **工具**：接任者有它职责的全套工具：看、找（记忆）、图工具（任务图，含 Work 历史分支，F14）、读文件。简报里写明“细节用这些工具按需读”。
- 已有的两种接历史照旧：K3 L12 的复核轮、LA-1 接续 Session 的第一轮（F14）。
- 结构审查 B4（拆接续简报，7C 之前）的范围：把简报的事实收集（`continuation-brief-assembly.ts`）和写成文字（`continuation-brief.ts`）分开；文字进 `continuation-brief` 和三份 `handoff-brief-<职责>` 模板，共用一个渲染。

**P8 接新任务时的旧文件提醒。**【lead 定，待审】
- 一次执行**实际接了** Session 历史时（`session_history`，含 LA-1 和 K3 的播种），加一条统一提醒（`stale-files-reminder` 模板）：以前读过的文件内容可能已过期，改动或依据它们之前先重新读。没有实际接历史就不加。
- 放在**角色段的末尾**：每种调用都有角色段（F7），它不在可省略的预算段里，所以一定能收到。不放进提醒段：copy、planning 没有提醒段，Work 的提醒段又可能整段省略。
- 接续简报里原来那句“文件可能已经变化，编辑前先重新读取。”（`continuation-brief.ts:345`）删掉，只在角色段说一次。
- 不改写旧的工具结果。超长时最先省略的就是旧的工具结果正文（P3）。
- 不逐个文件比版本、列出哪些变了：Kernel 不跨执行记读过哪些文件，要做得加记录，等真实模型重跑后看要不要。

**P9 `check` 和提示词里提到的工具。**【lead 定，待审】
- 不开 Kernel 的 `check`：
  - session 范围只看这次执行读过的路径，跨执行的旧文件归 P8；
  - workspace 范围在几条线共用一个工作区时，会把别的线的改动都报成漂移。
- 平台包的 `base` 模板 = 今天 `coding-agent-v5` 的正文，再改两处：
  - 去掉 `check` 那一行；
  - **讲到工具的每一句都放进工具块**。按最终交给 Kernel 的工具清单（F18）分四种情况：有 `read`；只有 `read_source`、`read_material`；没有读文件的工具；有、没有 `edit`、`shell`。
  - 今天只读的 Query 也读到“用 edit”“用 shell”，以后看不到。
- 每个模板在 `pack.json` 里声明块外提到的工具名，平台包的 `base` 声明为空。准备时核声明的工具都在这次执行的工具清单里；不在就拒绝准备，回 `invalid`，原因写模板 id 和工具名。平台包另有一个测试：扫块外文字里出现的已知工具名，和声明比对。

**P10 任务输入的排法（你 10-21 定的：这一轮就做）。**【细节 lead 定，待审】
- **段序写在模板里**：Work、Query 各调用类任务输入的模板，按槽位的先后定段的先后。冻结集按调用类记下段序（P5），所以按包变，也就是按模型变。
- **合法的段序**（加载、保存、准备都核）：
  - 每种调用能有哪些段照今天（F7），不增不减；
  - 角色段必须第一；
  - 其余段可以任意排，每段最多一次。
- **平台包第 2 版的段序**按“越稳定越靠前、最易变的放最后”：
  1. 角色和运行配置；
  2. 目标；
  3. 任务；
  4. 足迹；
  5. 注记索引；
  6. 选定输入；
  7. 接续简报；
  8. 复核说明（K3 复核轮才有）；
  9. 提醒。
  只有其中几段的调用类，按这个相对顺序。
- **预算保留的先后不随展示变**：四个可省略段仍按足迹、注记、提醒、选定输入的先后排成一串、保留最长前缀（F6），模板改不了这个先后。只是展示时各段放到模板定的位置；省略说明留在各自段里。
- **守卫和入口**：
  - 状态守卫不再按固定的 `SECTION_ORDER` 核，改为按绑定里记下的冻结段序核：段按这个顺序出现，角色第一，每种调用的合法段不变；
  - 接续简报和复核说明不再要求在最后、结束在全文末尾，改为按绑定里记的字节区间核：那一段的字节等于用冻结模板重新渲染的结果，并且只出现一次；
  - 绑定格式加一个 `sectionOrder`。
- 这些都在 `src/core/work-graph/state/` 里改（AGENTS 第 9 条）。

**P11 采用由谁串（第 6 片开头的注；不属提示词，lead 在这里定方向）。**【lead 定方向，细节在 6B 冻结前补】
- 由服务端串，不交给新界面：
  - Host 上一个组合动作、一个路由，只认人；
  - 采用仍是你的动作，这个路由就是你的动作，不加新权限。
- 已知的难处（审查一 D83-17、D83-18）：
  - 第一步 `workspaces/registration` 是**读**登记，没登记回 `not_found`，组合动作在这一步停；
  - `checks/approve` 在 Host 设置里，没有 `commandId`，先存私有设置再通知 Host，通知失败时设置可能已存。
- 6B 开工前，lead 写一份补充，经 Codex 审后冻结，在 6B 实现和验收（R-14 的采用部分本来在 6B）。补充要写：
  - 组合动作的 owner 和持久的阶段记录；
  - 每步的输入和版本；
  - “已存、未确认安装”的恢复判据；
  - 和 `InitializationBindingV1` 怎么接。
- 为什么不交给界面：这串步骤的中断、重试和幂等不该放在浏览器里；E3 只调一个路由；测试经公开路由直接测。

### 0.4 和别的片、别的轮的接缝

- **结构一轮的 D3（决定 85-1）**：
  - 按 P1 的格式建渲染器和平台包第 1 版，把今天写死的文字原样搬进去（F15 列的全部）：
    - Work 和 Query 的前言、段标签；
    - 角色短句；
    - 初始化回答格式；
    - 接续简报的固定文字；
    - K3 复核和提方案的说明；
    - 咨询消费指导；
    - “用户答复”前缀；
    - 各类提醒的短句；
    - 平台工具的说明：白板、`record_note`、`project_source`、探索工具、只读命令、邮箱、图、Session 发现、K3 的两个工具。
  - 第 1 版的段序就是今天的段序。
  - 验收：同一组输入，搬前搬后渲染出的完整字节相同。
  - 不搬，归 PC（要先有 Kernel 补丁才能把正文传进去）：
    - Kernel 的基础提示词和内置工具说明；
    - `resources/skills/platform-*`。
    Skill 的标头只有 id 和正文 digest（F4），以后搬进包里只要正文、id、kind、priority 不变，发出的字节就不变。
- **PC**：
  - P1–P5、P8–P10；
  - Kernel 补丁；
  - 平台包第 2 版：加 `base`，加 `stale-files-reminder`，平台行为说明搬进包里，接续简报去掉那句，新段序；
  - 包的编辑路由。
- **6A**：`secretary-round`、`secretary-answer` 两个模板（L7 的回答和 0 个或 2–3 个思路），以及 P6。**6B**：P11 的补充和实现、秘书换手和它的两份模板。
- **7A、7B**：消息送达时写成 user 消息的那几段话，各一个模板：
  - `action-request-delivery`（请动手）；
  - `inquiry-delivery`（请回答）；
  - `notify-delivery`（请知悉）；
  - `wait-reply-delivery`（等的回复到了）；
  - `wait-expiry-delivery`（问题到期）；
  - `intervention-delivery`（插话）。
  7B L11 的 `intervention-planning`。**7C**：B4、执行者和参谋换手的四份模板，以及 P7。
- **K2**（压缩，不在 MVP）不变；以后的摘要提示词也是包里的一个模板。
- **E3**（新界面，冻结时加进 E3-UI-ITEMS）：
  - 设置里每个模型选包和思考策略；
  - 用看文件、改文件的组件看和改模板，显示校验问题；平台包只读，改时先选或新建自己的包；
  - 每次执行显示用了哪个包、哪版（读 P5）。

## 1. 范围

- **D3 里做**：P1 的格式、渲染器、平台包第 1 版（原样搬）。
- **PC 交付**：
  - 平台包第 2 版；
  - 你的包的位置、解析、校验和编辑路由（P1）；
  - 设置里模型项的两项（P2）；
  - Kernel 补丁：
    - 删法（P3）：预估口、二分、hook 复核、报删除个数、标出这次执行的任务输入；
    - 思考（P4）；
    - 新执行和恢复都接受传入的基础提示词和 Skill（P5）；
  - 冻结集、正文存储、请求记录的新字段、读口（P5）；
  - 旧文件提醒（P8）；
  - 工具声明核对（P9）；
  - 段序：模板、守卫、绑定、入口核对（P10）。
- **各片交付**：§0.4 列的模板和 P6、P7、P11。

## 2. 接口（第三稿，冻结时细调）

```ts
// pack.json（平台包 resources/prompts/platform/；你的包 <Host 数据目录>/prompts/<packId>/）
type PromptPackManifestV1 = {
  schemaVersion: 1; packId: string; extends: string | null;       // 平台包 extends 为 null
  templates: Record<string, { file: string; version: number; mentionsTools: string[] }>;
  strings: string;                       // strings.json 的文件名
  tools: Record<string, string>;         // 工具名 → tools/<name>.json
};
// 设置里的模型项加两项（Host 配置直接给的模型绑定同样）
type SettingsModel = { /* 今天的字段 */ promptPack?: string; reasoningReplay?: 'current_run' | 'none' };
// prepared manifest 里
type PromptSetV1 = {
  schemaVersion: 1; modelId: string; provider: string; model: string; packId: string;
  reasoningReplay: 'current_run' | 'none';
  sectionOrder: Partial<Record<ContextCallKindV1, ContextSectionNameV1[]>>;
  templates: { id: string; version: number; packId: string; digest: string; ref: ArtifactRef }[];
  base: { templateId: string; version: number; digest: string; ref: ArtifactRef };   // 已并入 Host 附加说明
  skills: { id: string; title: string; kind: 'instruction' | 'reference'; priority: number;
            source: string; digest: string; ref: ArtifactRef }[];
};
// 绑定格式加
//   ContextAssemblyBindingV1.sectionOrder: ContextSectionNameV1[]
// 每次模型请求的记录加（Work 许可记录；Query 的请求记录，输出上限用已有的 reservedOutput）
type ModelRequestPromptFactsV1 = {
  systemDigest: string; toolsDigest: string; toolSpecsRef: ArtifactRef;
  maxOutputTokens?: number;              // 只 Work
  selection: { inputTokens: number; budget: number;
    removed: { memory: number; skillReference: number; additionalInstruction: number; toolResultBody: number;
               historyExchange: number; historyConclusion: number; currentExchange: number } };
};
// Kernel 补丁的新输入（runCodingAgent 和恢复入口都有）
//   baseSystemPrompt: { templateId: string; version: number; text: string };
//   skills: SkillContext[]; reasoningReplay: 'current_run' | 'none';
//   previewRequest(request: ModelRequest): Promise<{ outgoing: ModelRequest; inputTokens: number;
//                                                    outputReserve: number; fits: boolean }>;
//   onContextSelected(report: { requestId: string; inputTokens: number; budget: number; removed: … }): void;
// 渲染器
//   renderTemplate(resolved, templateId, slots, finalToolNames) → { text; sectionRanges }
// 编辑路由（Host，只认人）
//   settings/prompts/packs/list · settings/prompts/packs/create
//   settings/prompts/templates/read · settings/prompts/templates/save { packId, templateId, expectedVersion, text, mentionsTools }
// 读口
//   readPromptRecord(ctx, ref: RunRef | QueryRunRef) → ReadResult<{ set: PromptSetV1;
//     requests: ({ requestId: string } & ModelRequestPromptFactsV1)[]; texts: Record<string, string> }>
```

## 3. 测试（TDD，DSH 一条一条写；不调真实模型）

### 3.1 测试入口（**待你确认**）

| 入口 | 测什么 | 怎么测 |
|---|---|---|
| PE1 | 模板包、渲染器、段序校验 | 公开的加载和渲染函数，手写的小包 |
| PE2 | 包的编辑和选包 | Host 的编辑路由和设置路由，假的数据目录 |
| PE3 | 从准备到发出：冻结、恢复、请求记录、配置对不上的拒绝、旧文件提醒、工具清单和段序在最终请求里的样子 | 已有的 Work、Query 执行测试装置和脚本化的假模型，看假模型收到的请求和 `readPromptRecord` |
| PE4 | 删法的先后 | Kernel 公开的 `selectContext`，小输入加可手算的预估 |
| PE5 | 删法和思考在执行里的效果：历史分界、受保护的消息、工具循环、思考、异步预估 | Kernel 公开的 `runCodingAgent`，脚本化的假提供方 |
| PE6 | hook 改过请求后的复核 | Kernel 公开的 `RuntimeRunner`（`runCodingAgent` 的控制 hook 不许改请求） |
| PE7 | 两家适配器的出站形状 | 两家适配器已有的测试方式，看占位结果和去掉思考后的消息发出去仍然合法、配对完整 |
| PE8 | 准备时的拒绝：工具声明、包坏了、必填槽位为空 | 经准备的公开路径 |
| PE9 | 守卫和入口按冻结段序、按字节区间核 | 状态守卫和入口的公开函数 |
| PE10 | 秘书上下文（6A 里）、换手简报（6B、7C 里） | 各片自己的入口 |

### 3.2 验收行为（第三稿；冻结时补全期望值，期望写字面值或手算）

- **包、渲染和编辑**
  - PC-01 渲染：手写模板和槽位，输出逐字节等于手写结果；块的整行去掉；`{{#tool:edit}}` 在有、没有 edit 时各一例。
  - PC-02 加载拒绝：用了代码表里没有的槽位、必填槽位缺或出现两次、文件缺、正文里多一个 `{{`、角色段不在第一、多出调用类不许的段，各回一个问题，写明包、模板、原因。
  - PC-03 继承：你的包只改 `base`，其余模板来自平台包；冻结集里每个模板的来源包对。
  - PC-04 编辑（PE2）：
    - 存模板，版本加 1；
    - 带旧版本存，回 `revision_conflict`；
    - 校验不过，回 `invalid` 并列出问题、文件不变；
    - 在平台包上存，回 `forbidden`；
    - 存了以后下一次准备用新版，存之前已准备的执行仍用旧版。
  - PC-05 选包（PE2、PE3）：设置里两个模型各选一个包，各自的执行用各自的包；不选时用 `platform` 和 `current_run`。
- **冻结、恢复和记录（PE3）**
  - PC-06 冻结：准备以后改你的包和磁盘上的行为说明，执行开始后假模型收到的 system 仍是准备时的正文；冻结集里的 digest 等于手算的 sha256。
  - PC-07 恢复：执行暂停，改包，再恢复，假模型收到的 system 不变。
  - PC-08 配置对不上：准备后改设置里这个模型的包，Work 开始回 `forbidden`。
  - PC-09 请求记录：
    - 一次执行两次模型请求，**第二次结束后重新读**记录，两次都有两个 digest、删除个数、输出上限（Work 是 `maxOutputTokens`，Query 是 `reservedOutput`）；
    - 两次的 `toolSpecsRef` 相同；
    - 按读口取回的正文算出的 digest 等于记录里的；
    - 同一请求 id 带不同事实重放，回 `idempotency_conflict`。
  - PC-10 工具说明存失败：存 body 失败时不调模型，执行按 `unavailable` 失败；Work、Query 各一例。
- **删法和思考**
  - PC-11 删法顺序（PE4）：构造七类都有的输入，逐步调小预算，删的先后和个数等于手算；第 6 类在第 5 类之后；二分得到的结果和逐步删一样。
  - PC-12 占位（PE4、PE7）：以前执行成功的工具结果被省略时，`output` 换成占位那一项，其余字段原样；`error`、`cancelled` 的不换；两家适配器发出的请求体合法、配对完整。
  - PC-13 行为说明不删：预算连受保护的加行为说明都放不下时，回 `required_content_over_budget`，不删行为说明。
  - PC-14 保护当前任务（PE5）：执行中来了一条消息，预算只够放下当前任务和这条消息，删掉的是以前执行的内容，任务输入还在。
  - PC-15 两套预算一致（PE5、PE3）：
    - Host 附加说明很长、`responseFormat` 也在、窗口很紧时，选上下文就把它们算进去，计量器不再拒绝同一个请求，而今天会；
    - 第二次请求时累计输出变了，预算跟着变；
    - 预估是异步的分词器时照样工作。
  - PC-16 hook 复核（PE6）：hook 改了输出上限，复核用新的预留。
  - PC-17 思考（PE5、PE7）：
    - `current_run` 时以前执行的 assistant 消息不带思考、这次的带；`none` 时都不带；
    - 只有思考的历史消息从发出的那份里拿掉；
    - Kernel 里存的原记录不变。
- **提醒、工具和段序**
  - PC-18 旧文件提醒（PE3）：
    - 三种情况：新 Session 没有历史，没有提醒；LA-1 播种，有；普通复用同一 Session，有；
    - 有提醒时在角色段末尾；四个可省略段都省略时也有；
    - 接续简报里不再有那句。
  - PC-19 工具声明（PE8）：一个包的 `base` 在块外提到 `check`，准备回 `invalid`，原因带模板 id 和 `check`；平台包的扫描测试通过。
  - PC-20 四种工具清单（PE3）：有 `read`、只有 `read_source`/`read_material`、没有读文件的工具、有没有 edit/shell，各一例，最终 system 里讲工具的句子和清单对得上。
  - PC-21 新段序（PE3、PE9）：
    - 平台包第 2 版下，提醒在最后，接续简报在提醒之前；守卫和入口都通过；
    - 简报被改一个字，入口拒绝（今天的拒绝码）；
    - 你的包换一种合法段序，最终输入按它排；
    - 预算不够时省略的先后和今天一样（手算一例：提醒排在最后，但仍比选定输入先保留）。
  - PC-22 不合法段序：角色不在第一、出现调用类不许的段、同一段两次，在保存（PE2）和准备（PE8）时都拒绝。

### 3.3 要改断言的旧测试（冻结时 lead 列全）

- Kernel 删法的旧测试里“删行为说明”的断言（P3 改成不删）；
- 断言接续简报含“文件可能已经变化”那句的测试（P8）；
- 断言基础提示词原文或版本 `coding-agent-v5` 的测试（P9）；
- CA12（`S3-context-assembler.test.ts:813`–`:834`，简报在全文末尾）：改成验冻结段序下简报在它的位置、只出现一次、提醒在它后面；D3 阶段保持原断言（P10）；
- 守卫按固定段序拒绝的测试（`context-input.ts` 的段序规则；P10）；
- W2（`W2-role-skills.test.ts`）、AG6（`AG6-agent-assembly.test.ts`）：平台行为说明改验从包加载和冻结结果；显式子集、空选择、自定义 Skill 目录的行为照旧覆盖。不能靠留一份旧目录的正文让旧断言继续过。

## 4. 文件（影响面；施工时以实际为准，超出要报）

- **Kernel 补丁**：
  - `vendor/coding-agent/patches/` 下的 `core/runtime/loop/runtime-runner.ts`、`app/composition/composition-root.ts`、`app/composition/resume-composition.ts`、`app/composition/composition-contracts.ts`、`public-api.ts`；
  - 新加 `core/context/selection_policy/context-selection-policy.ts`；
  - `scripts/build-kernel-patch.mjs`；dist 只由脚本生成。
- **包**：`resources/prompts/platform/**`、`runtime-assets.json`、`scripts/check-boundaries.mjs`。
- **平台**：
  - D3 拆出的渲染器和调用配方；
  - `execution-preparation.ts`、`query-preparation.ts`、`query-execution.ts`、`execution-driver.ts`、`observed-model-run.ts`、`model-budget.ts`、`model-call-access.ts`；
  - `src/core/work-graph/state/context-input.ts`（段序和字节区间核对）、`src/core/work-graph/tasks/execution-entry-service.ts`（简报重新渲染）；
  - `src/core/work-graph/tasks/model-call-service.ts`、`model-request-codecs.ts`、`src/core/work-graph/queries/query-execution.ts`（请求记录的新字段、编解码、用量更新）；
  - `src/contracts/` 里冻结集、绑定和记录的类型；
  - `src/app/host-settings*.ts`、`host.ts`、`core-routes.ts` 或设置路由（模型项两项、编辑路由）、`runtime-configuration.ts`。

## 5. 施工

- 顺序：本节冻结 → 结构一轮（含 D3）→ PC → 6A。
- PC 估 3,000–4,000 行（含测试），比第二稿多，是因为加了编辑路由和段序。可以拆成两段：
  - PC-1：Kernel 补丁、冻结、记录、删法、思考；
  - PC-2：包的编辑、选包、段序、提醒、工具声明。
- DSH 施工、Codex 审、lead 验收，合入前跑全量和规模批（决定 86-6）。
- 这些都不等于真实模型验收。PC 和 6A 合入后，用真实模型重跑时核三件事：
  - DeepSeek 在 `current_run` 下工具循环正常；
  - 按请求记录里的用量看缓存命中；
  - 秘书接完整历史时，多久到换手阈值。

## 6. 不做的事

- 摘要和压缩（K2，不在 MVP）；换手时的“写理解”是前任自己写，不是平台压缩。
- 秘书自己觉得不匹配就把请求转给新秘书（§0.1 第 5 条）。
- 显式的缓存参数（`cache_control`、`prompt_cache_key`）；“删一次就多删一些、好让前缀稳定”的滞后删法。先看真实重跑里的缓存损失，再定。
- 逐字节还原整个请求（P5）。
- OpenAI 推理条目的回传（Responses API 的 reasoning item）。
- 逐个文件比版本的过期清单（P8）。
- 读 Query 历史的模型工具（P7）。
- 改预算保留的先后（P10）。
- agent 提议或修改提示词；按效果自动挑模板。

## 7. Codex 审查的处理（`D:/cc-lead-notes/codex2/d83/review1.out.md`、`review2.out.md`，冻结时复制进证据）

**第一轮（23 条）**，第二轮复核后的结论：

| 条 | 处理 |
|---|---|
| D83-01 排法会被守卫拒绝 | 你定这一轮就做：守卫、入口按冻结段序和字节区间核，入口用冻结模板重新渲染（P10、P5） |
| D83-02 两套预算 | 同一个 `ModelBudget` 的预估口，可异步，二分，hook 复核也用它（P3） |
| D83-03 纯 assistant 消息不删 | 改正事实；成为第 6 类，写明是行为变化（P3） |
| D83-04 占位形状 | 只换成功结果的 `output`（P3），两家适配器出站测试（PC-12） |
| D83-05 去思考后的空消息 | 从发出的那份拿掉（P4） |
| D83-06 恢复路径 | 恢复入口也接受传入正文（P5、PC-07） |
| D83-07 Skill 形状 | 冻结完整 `SkillContext`；基础提示词带模板 id 和版本；`skillResourceRoot` 写固定值（P5） |
| D83-08 Skill 标头没有路径 | 改正理由（§0.4） |
| D83-09 写入者和提交 | 正文用 `bodies.put`；请求事实是不可变部分，贯通投影、事件、重放、指纹；不兼容旧记录（P5） |
| D83-10 重拼整请求 | 记输出上限；“对得上”收窄（P5） |
| D83-11 删除个数怎么传 | Kernel 回调按 `requestId` 报（P3） |
| D83-12 模型身份和窗口 | 冻结集记模型项；窗口照今天；拒绝码按 F19（P2） |
| D83-13 合批和历史 | 你定接完整历史后，第三个槽只补别的 Session 上的轮次，连同合进去的原话（P6） |
| D83-14 读参谋的 Query 历史 | 不做工具，参谋简报带最近 3 次回答（P7） |
| D83-15 提醒放哪 | 角色段末尾（P8） |
| D83-16 `read` 也要分情况 | 所有讲工具的句子都进工具块，四种清单（P9） |
| D83-17 登记是读 | 改正（P11） |
| D83-18 采用的步骤不能统一续做 | 本节只定方向，细节在 6B 前补并审（P11） |
| D83-19 D3 清单漏项 | 补进 F15 和 §0.4 |
| D83-20 `runCodingAgent` 测不了全部类别 | 删法先后用 `selectContext`（PE4） |
| D83-21 提醒和播种 | 按“实际接了历史”判断（P8、PC-18） |
| D83-22 CA12 | 排法这一轮做，列进 §3.3 |
| D83-23 预算取舍顺序 | 保留的先后照今天，模板改不了（P10、PC-21） |

**第二轮新提的（9 条）：**

| 条 | 处理 |
|---|---|
| N-01 估算不能同步、要先拼请求 | 预估口可异步，每步先用同一个 builder 拼候选请求（P3、PC-15） |
| N-02 预算从哪个账户取 | 同一个 `ModelBudget`，按同一账户的累计用量算预留，hook 复核也用它（P3、PC-16） |
| N-03 Query 记录会被用量更新覆盖 | 请求事实是不可变部分，用量更新只改用量字段；第二次请求后重读断言（P5、PC-09） |
| N-04 工具说明存完没有等待点 | 第一次 `beforeCall` 前在共用包装层等，存失败不调模型（P5、PC-10） |
| N-05 第三个槽漏了合批的原话 | 执行轮连同合进去的原话一起带（P6） |
| N-06 入口不对 | 改入口表：PE3 管从准备到发出，PE6 用 `RuntimeRunner` 测 hook（§3.1） |
| N-07 W2、AG6 | 列进 §3.3 |
| N-08 结果有三种 | 改正 F12；`error`、`cancelled` 第 4 步不动（P3） |
| N-09 Query 已有输出上限 | 改正 F16；Query 用 `reservedOutput`（P5） |
