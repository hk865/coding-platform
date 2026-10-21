# 第 6、7 片补充规格：提示词和上下文（决定 83）

**状态：第二稿（lead，2026-10-21），已按 Codex 第一轮审查（23 条，处理见 §7）改过，待你看、待第二轮审查，冻结前不施工。** 第 6、7 片已冻结（决定 64），这一节是冻结后的补充，不改它们已定的行为，只定：提示词放在哪、谁能改、按什么选、超长怎么删、怎么记。依据是 Codex 10-18 的只读调研（冻结时复制进证据），§0.2 每一条 lead 都对着 `4d874f0b` 的代码核过。

和别的轮的关系：
- 6A 之前的结构一轮（决定 85-1）里的 D3 拆上下文装配器，按本节 §2 的模板包和渲染器做，把今天写死的文字**原样**搬进平台包第 1 版，发出的字节不变。
- 本节的新行为由一个单独的施工片 **PC**（提示词和上下文）做，排在结构一轮之后、6A 之前。
- 各片自己的模板（秘书、派活、等待、转交、干预）在各片里写，用本节的机制（§0.4）。

## 0. 冻结说明（lead）

### 0.1 要你定的

1. **秘书每一轮从记录重建上下文，不接它 Session 的完整历史（P6）。**
   - 每轮带：
     - 这一轮的输入和同一请求合批进来的排队输入（原文，不截）；
     - 这个请求以前的轮次（最多 10 轮，每个回答截到 2 KiB，第 6 片 L8 原样）；
     - 工作区概况、目标列表、当前理解和注记索引。
   - 不带：别的请求的对话；以前轮次里秘书读过的文件和工具调用（结论在回答里）。
   - 好处：同一个秘书管很多请求也不会越拼越长；请求之间不串；秘书换手时接任者照同样的记录重建，不用搬历史。
   - 代价：秘书在请求 A 里读到的东西，到请求 B 里只剩它写进当前理解、注记的部分。
   - lead 建议这样做。
2. **执行者、参谋换手（第 7 片 L18），接任者不带前任的对话历史（P7）。**
   - 接任者拿到接续简报和当前理解。简报里写：
     - 交出的任务，每个任务的阶段和最后结果；
     - 理解指针、旧线链接；
     - 前任最后一次执行的结论；
     - 参谋线另带最近 3 次 Query 的回答（每个截到 2 KiB）。
   - 要看前任 Work 的执行过程，用已有的图工具按需读。参谋的 Query 历史这一轮没有读的工具，所以把要的材料写进简报。
   - 换手常常就是因为太长，带历史等于把问题搬过去。lead 建议这样做。
3. **谁能改提示词（P1）。** lead 建议：
   - 这一轮只有运行平台的人能改，在 Host 配置里加模板包目录，和今天换 Skill 目录一样；
   - 你的设置里不加编辑入口，新界面（E3）只显示这次执行用的是哪个包、哪版；
   - agent 不能改提示词。
   - 另一种做法：E3 设置里也能选包、改单个模板，那要加编辑、校验和版本管理的界面。
4. **上下文的排法这一轮不按模型变（P10；决定 83-2 第 3 项和“当前提醒放最后”的原则这一轮只做一部分）。**
   - 任务输入里各段的先后，是入口和状态守卫都要核对的契约（§0.2 F16）。改它要一起改守卫、绑定格式和预算的取舍顺序（预算不够时先省略哪段）。
   - 这一轮先不动：提醒仍在“选定输入”之前，接续简报仍在最后。策略表能按模型换的是包（文字）和思考带不带回。
   - 真实模型重跑后，如果看到排法确实影响效果，再单独开一轮。
   - lead 建议这样做。
5. **测试入口**（§3.1），确认后施工。

### 0.2 代码事实（`4d874f0b`；lead 核过）

| # | 事实 | 位置 |
|---|---|---|
| F1 | Kernel 基础提示词 `coding-agent-v5` 写死在冻结的 dist 里，约 3,800 字符；第 14 行让模型用 `check`，第 12、15 行讲 `read`、`shell`。Kernel 有 `check` 工具，平台给 Kernel 的工具名里从来没有它 | `vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:2`、`:12`–`:15`；`dist/tools/builtin/check/check-tool.js:96`；`src/core/agent-runtime/observed-model-run.ts:272` |
| F2 | system 由 Kernel 拼：基础提示词 → 附加指令 → 行为说明（instruction Skill）→ 参考 Skill → 记忆。Host 的 `systemInstruction` 和 `responseFormat` 在 Kernel 选完上下文**之后**才加到请求上 | `dist/core/context/builder/context-builder.js:25`；`observed-model-run.ts:261`–`:263` |
| F3 | Skill 正文在每次执行开始时才按目录读文件，不随准备冻结。恢复执行走 `resume-composition`，也重新读 Skill、用固定的基础提示词。Kernel 的 `onConfiguration` 回调平台没接 | `vendor/coding-agent/patches/app/composition/composition-root.ts:330`、`:415`、`:423`；`patches/app/composition/resume-composition.ts:311`、`:406` |
| F4 | Skill 的形状是 `SkillContext { id, title, content, kind: instruction/reference, priority, source }`；`source` 是 Skill id 加正文 digest，没有目录路径 | `dist/core/context/types/context-types.js:50`；`dist/skills/loader/file-skill-loader.js:78`；`context-builder.js:20` |
| F5 | Work 的任务输入是一条 user 消息，段的先后写死：角色和运行配置、目标、任务、足迹、注记索引、提醒、选定输入、接续简报 | `src/core/agent-runtime/context-assembler.ts:79`、`:93` |
| F6 | Kernel 每次模型请求把“以前执行的历史”和“这次执行的对话”分开拿，再拼起来交给预算选择 | `patches/core/runtime/loop/runtime-runner.ts:666`、`:686` |
| F7 | 超预算时依次删记忆、参考 Skill、附加指令、行为说明，再从最旧的起删旧的 user 消息和带工具调用的整组交换。不删的：最新一条 user 消息、没有工具调用的 assistant 消息、没闭合的调用；不留摘要。运行中来信也是 user 消息，所以当前任务那条会被删。删法不在受管补丁清单里 | `dist/core/context/selection_policy/context-selection-policy.js:30`–`:66`、`:92`、`:154`；`scripts/build-kernel-patch.mjs:13` |
| F8 | 两套预算对不上：Kernel 按“序列化字符数 ÷ 3”估、和上下文窗口比；平台计量器按最终请求（含 Host 说明、输出预留）的 UTF-8 字节加 4,096 估（有分词器时用分词器）。计量器判超时直接拒绝，不回 Kernel 再删 | `context-selection-policy.js:9`；`src/core/agent-runtime/model-budget.ts:82`–`:95` |
| F9 | 思考：DeepSeek 适配器把历史里的思考原样带回，OpenAI 适配器一律不带。只有思考、没有正文和工具调用的 assistant 消息是合法记录 | `dist/model/providers/deepseek/deepseek-model-client.js:28`；`dist/core/runtime/loop/model-stream-consumer.js:137`；`dist/core/runtime/state/run-state.js:130` |
| F10 | 工具结果的形状是 `{ schemaVersion, callId, status: success/error, output[], effects, error? }`，两家适配器都把整个结果当 JSON 发 | `dist/core/ports/tool_executor/tool-executor-port.js:57`；`deepseek-model-client.js:41`；`openai-model-client.js:39` |
| F11 | Query 的执行接不接 Session 历史由 `sessionContext` 定，已有 `current_turn`（不接）和 `session_history`（接到某个位置）两种 | `src/core/agent-runtime/query-execution.ts:481`–`:501` |
| F12 | Work 的接续 Session 第一轮接原 Session 的历史（LA-1）；归档来源的重新入队不接 | `src/core/agent-runtime/execution-driver.ts:929`；`context-assembler.ts:1447` |
| F13 | 写死的大段文字：初始化回答格式约 8,400 字符，白板工具说明约 3,200，`project_source` 说明约 2,400，`record_note` 约 1,200，接续简报的固定文字几千字符；还有角色短句、各段标签、K3 复核和提方案的说明、K3 两个工具的说明、咨询消费指导、“用户答复”前缀 | `query-preparation.ts:50`；`whiteboard-tools.ts:445`；`project-source-tool.ts:237`；`note-tool.ts`；`src/contracts/continuation-brief.ts:345`；`role-profiles.ts:23`；`context-assembler.ts:82`；`src/contracts/core/prepared-execution.ts:97`、`:130`；`unknown-call-review-tools.ts:212`；`command-rerun-tools.ts:206`；`src/business/workflow/consultation.ts:447`；`execution-inputs.ts:59` |
| F14 | 每次模型请求已经有一份记录：Work 由 WorkGraph 写许可记录，Query 更新 QueryRun。都只有整个最终请求的 digest、任务输入 digest、manifest digest，没有正文、没有输出上限 | `observed-model-run.ts:249`–`:251`；`model-call-access.ts:63`；`src/core/work-graph/tasks/model-call-service.ts:163`；`src/core/work-graph/queries/query-execution.ts:1400` |
| F15 | prepared manifest 用 `bodies.put` 存成一个 body（有大小上限），不在一次提交里 | `src/core/agent-runtime/execution-preparation.ts:561`–`:571`；`query-preparation.ts:366` |
| F16 | 状态守卫按固定段序核对任务输入，规定每种调用能有哪些段（秘书：角色、目标、任务、注记、提醒；copy：角色、目标、任务）；接续简报必须是最后一段、结束在全文末尾；入口还会重新渲染简报核对。足迹、注记、提醒、选定输入四段共用一个预算，可以整段省略 | `src/core/work-graph/state/context-input.ts:44`–`:72`、`:197`、`:255`、`:294`；`execution-entry-service.ts:973`、`:1201`；`context-assembler.ts:275` |
| F17 | 固定来源读取模式下，Kernel 拿到的读工具是 `read_source`、`read_material`，没有 `read` | `observed-model-run.ts:301` |
| F18 | 模型设置只有 provider、model、baseUrl、thinking、reasoningEffort；按 DeepSeek 型号换上下文窗口是 Host 里的一个分支 | `src/app/host-settings-types.ts:7`–`:10`；`src/app/host.ts:260` |
| F19 | 平台 Skill 正文在 `resources/skills/platform-*`，列进 `runtime-assets.json` 的哈希清单；Host 可以换 Skill 目录 | `runtime-assets.json:39`；`src/app/runtime-configuration.ts:58`、`:373` |

### 0.3 lead 定的技术选择

**P1 模板包。**【lead 定，待审】
- 一个模板包是一个目录：
  - `pack.json`；
  - 模板文件；
  - `strings.json`：段标签、“未声明”这类短语；
  - `tools/<工具名>.json`：工具说明和参数说明。
- 平台自带的包在 `resources/prompts/platform/`，和 Skill 一样进 `runtime-assets.json` 的哈希清单，检查脚本复算。
- `pack.json` 列每个模板的 id、文件、版本号（改一个字也加 1）、块外提到的工具名（P9）。
- 模板 id 和每个模板有哪些槽位由代码定（每个调用配方一张表）。包只能改文字，不能加减槽位。Work、Query 任务输入的模板也不能改段的先后（P10）；别的模板里槽位的先后可以改。
- 语法只有三样：
  - `{{槽位}}` 放入平台写好的一段文字；
  - `{{#槽位}}…{{/槽位}}`：槽位不空时才出现；
  - `{{#tool:工具名}}…{{/tool:工具名}}`：这次执行最终交给 Kernel 的工具清单里有这个工具时才出现。
  没有表达式、循环、转义和引用别的模板；正文里不许出现别的 `{{`。只有一个块标记的整行，连同换行一起去掉。
- 分工：事实怎么写成文字（目标、任务、注记索引的条目）仍在代码里，标签从 `strings.json` 取；模板管说明性的话。
- 加载时核：模板用到的槽位都在代码表里，必填槽位都出现且只出现一次，引用的文件都在。渲染时必填槽位为空算代码错误，准备回 `invalid`。
- 覆盖：Host 配置可以加包目录。加的包写 `extends: "platform"`，只给要改的模板；解析时每个模板取最具体的那个，记下来自哪个包。
- 包无效时，Host 启动报配置问题（`WorkbenchRuntimeConfigurationProblem`），这个绑定不能用；不悄悄退回平台包，免得以为改了其实没生效。
- agent 不能改提示词；你的设置里有没有入口见 §0.1 第 3 条。

**P2 按模型的策略表。**【lead 定，待审】
- Host 配置 `prompts.strategies`，每行 `{ id, match, pack, reasoningReplay, contextWindowTokens? }`：
  - `match` 是 `{ provider, model }`（精确）、`{ provider, modelPrefix }` 或 `any`；
  - `reasoningReplay` 是 `current_run` 或 `none`（P4）。
- 按顺序取第一条匹配的。平台自带的缺省表最后一行是 `{ id: "default", match: any, pack: "platform", reasoningReplay: "current_run" }`。
- 上下文窗口：
  - `host.ts:260` 按 DeepSeek 型号换窗口的分支，挪成缺省表里的行，值不变；
  - 解析出的窗口就是这个绑定的 Host 预算里的 `contextWindowTokens`，只有这一个来源；
  - Work 照今天在开始时用 Host 预算；Query 照今天取请求和 Host 预算的交集；
  - 行里不写窗口时，用今天的缺省值。
- 准备时用这次执行的 Host 绑定解析一次，把策略行 id、provider、model 记进冻结集（P5）。开始和恢复时，绑定解析出的行、provider、model 和冻结集不一样，就按今天“配置 revision 对不上”的拒绝处理。

**P3 超长时的删法（Kernel 受管补丁）。**【lead 定，待审】
- `scripts/build-kernel-patch.mjs` 的补丁清单加 `core/context/selection_policy/context-selection-policy.ts`，源码照已有做法从冻结的 source map 还原。
- **估的就是最后发出去的那个请求**（解 F8）：
  - Host 附加说明并进传入的基础提示词（P5），选上下文时就算在里面；
  - Kernel 补丁让平台传入两样：
    - 估算函数：对 Kernel 拼好的请求，先做和平台外层一样的改动（加 `responseFormat`、定输出上限），再按计量器同样的方法计数；
    - 本次预算：上下文窗口减去本次的输出预留，算法和计量器一样。
  - runner 拿它们选上下文。选完后 hook 改过请求时，也用同一个估算复核（今天用的是 Kernel 自己的估算，`runtime-runner.ts:715`）。
  - 计量器的检查留着兜底。选完仍超（只剩不删的内容），回今天的 `required_content_over_budget`。
- **不删的：**
  1. 基础提示词和 Host 附加说明（今天也不删）；
  2. 行为说明（instruction Skill），今天会删，改成不删；
  3. **这次执行的任务输入**（这次执行的第一条 user 消息），由 runner 按 F6 的分界标出来交给选择；
  4. 最新一条 user 消息；
  5. 没闭合的调用。
- **删的顺序：**
  1. 记忆；
  2. 参考 Skill；
  3. 附加指令；
  4. **以前执行里成功的工具结果的正文**，从最旧的起，换成占位：`output` 换成一个 text 项“内容因长度省略（工具 <名字>，调用 <id>），需要时重新读”；`schemaVersion`、`callId`、`status`、`effects` 原样。失败的结果（`status: error`）本来短，不换。调用和结果的配对不动；
  5. 以前执行里的整组交换（带工具调用的 assistant 和它的结果）和旧的 user 消息，从最旧的起；
  6. 以前执行里没有工具调用的 assistant 消息（多是那次的结论），从最旧的起；
  7. 这次执行里不受保护的整组交换，从最旧的起。
  第 6 类今天不删，现在可删，这是行为变化：放在以前执行里的最后才删。
- **删了什么要报给平台**：Kernel 补丁加一个回调，按 `requestId` 报这次请求删的各类个数、估算值和预算，在调模型之前调用；恢复执行也一样。平台把它并进这次请求的记录（P5）。

**P4 思考。**【lead 定，待审】
- `current_run`：拼请求前去掉以前执行（历史）里 assistant 消息的思考，这次执行里的保留。`none`：全部去掉。
- 去掉思考以后既没有正文、也没有工具调用的 assistant 消息，从发出的那份里拿掉（解 F9 那种合法记录变成空消息）。
- 只改发出的那份，Kernel 存的原记录不动，原历史照旧能按需读。
- 在 runtime-runner 里做（已在补丁清单），提供方适配器不改。OpenAI 适配器本来就不带思考，表里写什么效果都一样。
- 平台不把思考写成事实、消息或简报：今天就是这样，写成规则。

**P5 记下每次实际发出的整套提示词。**【lead 定，待审】
- **冻结集** `PromptSetV1`：准备时算出，存进 prepared manifest，算进 manifest digest。内容：
  - 策略行 id、provider、model、`reasoningReplay`；
  - 用到的每个模板：id、版本、digest、来自哪个包；
  - 基础提示词（已并入 Host 附加说明）的引用；
  - 每个 Skill 的完整 `SkillContext`（F4，含 reference Skill）的引用。
- **准备时就读出 system 侧的全部正文。** Skill 照今天的选择规则选，平台自己的行为说明从包里取，Host 另配的 Skill 目录照今天的 loader 读；明确选了空的就是空。
- **开始和恢复执行时，平台把冻结的正文直接交给 Kernel。** 补丁让 `composition-root` 和 `resume-composition` 都接受传入的基础提示词和 `SkillContext` 列表，不再按目录读文件、不再用固定的基础提示词。所以准备之后改文件，不影响这次执行，暂停后恢复也不影响（解 F3）。
- `onConfiguration` 照原形状回报：`systemPromptVersion` 写成“基础提示词的模板 id@版本”，`skills` 是传入的那份。
- **正文怎么存**：
  - 基础提示词和每个 Skill 的正文，在存 manifest 之前各用 `bodies.put` 存一份（和 manifest 同一个存法，F15），manifest 只记引用和 digest，免得 manifest 超大小上限；
  - 同样的正文是否只存一份，取决于 body 存储，不另建记录种类。
- **每次模型请求的记录**：Work 在 WorkGraph 的许可记录上，Query 在 QueryRun 的请求记录上（F14），各加：
  - `systemDigest`、`toolsDigest`；
  - `maxOutputTokens`，计量器定下的那个值；
  - P3 回调报的删除个数、估算值和预算；
  - `toolSpecsRef`：这次执行第一次请求前，把 Kernel 回报的工具说明（含 read、edit、shell 这些内置工具）存成一个 body，同一次执行的后续请求沿用这个引用。
- **读口**：Runtime owner 的只读方法 `readPromptRecord`（执行或查询执行的引用），返回冻结集、每次请求的记录、用到的正文。路由等 E3。
- **“对得上”指什么**：
  - 每次请求的 system 和工具说明能逐字还原，digest 和记录对得上；
  - 用了哪版模板、哪个策略、删了多少、输出上限多少，都查得到。
  - 消息部分还在 Kernel Session 记录里，选了哪些由删除个数和固定的删法定。这一轮不承诺逐字节还原整个请求、也不承诺对上整请求 digest：那要么每次存整个请求（太大），要么重放 Kernel 的拼装。

**P6 秘书的请求历史（§0.1 第 1 条）。**【待你定】
- 秘书一轮用 `sessionContext: current_turn`（F11 已有），不接 Session 历史，上下文每轮从记录重建。
- `secretary-round` 模板落在状态守卫给秘书定的段里（角色、目标、任务、注记、提醒；F16），不加新段。请求的内容在“任务”段，分三个槽：
  1. **这一轮**：本轮的输入（你的话，或追问、选择、回复、到期、转来的说明）；
  2. **合批的**：第 6 片 L5 合进这一轮的同请求排队输入，按 `since` 顺序原文全放，不截、不算进 10 轮；
  3. **以前的轮次**：这个请求以前已经回答过的轮次，最多 10 轮，每个回答截到 2 KiB，截断加一行省略说明；不含上面两类。
- 以前轮次只从请求记录来：原话、回答、你的选择、候选计划的引用。Kernel 历史里的工具调用和读过的文件不带。
- 边界是同一请求（`requestRoot` 那一条链，含追问、换手转来的轮次）。别的请求一律不带，哪怕是同一个秘书处理的。
- 第 6 片 L10 的换手阈值照旧，按这个秘书最近一次的模型输入量算；秘书换手因此不用搬历史。
- 角色探索、干预规划、问一问这些 Query 照今天接所在线的历史，受 P3 约束。

**P7 换手的历史边界（§0.1 第 2 条）。**【待你定】
- 第 7 片 L18 建接任 Session 时不写 `sessionBasis`，不带前任的对话历史。
- 接任者的上下文：
  - `handoff-brief` 模板写成的接续简报：
    - 交出的任务，每个任务的阶段和最后结果；
    - 理解指针、旧线链接；
    - 前任最后一次执行的结论（只取正文，不取思考）；
    - 前任是参谋线时，另带它最近 3 次 Query 的回答，每个截到 2 KiB；
  - 任务输入目标段里本来就有的当前理解；
  - 前任 Work 的执行过程，用已有的图工具历史分支按需读（`graph-tools.ts:358`，只认 `RunRef`）。
- 读 Query 历史的工具这一轮不做；`read_session_card` 不读历史（`session-discovery-tools.ts:139`），不拿它当读历史的办法。
- 已有的两种接历史照旧：K3 L12 的复核轮、LA-1 接续 Session 的第一轮（F12）。
- 结构审查 B4（拆接续简报，7C 之前）的范围：把简报的事实收集（`continuation-brief-assembly.ts`）和写成文字（`continuation-brief.ts`）分开；文字进 `continuation-brief` 和 `handoff-brief` 两个模板，共用一个渲染。

**P8 接新任务时的旧文件提醒。**【lead 定，待审】
- 一次执行**实际接了** Session 历史时（`sessionContext` 是 `session_history`，含 LA-1 和 K3 的播种），加一条统一提醒（`stale-files-reminder` 模板）：以前读过的文件内容可能已过期，改动或依据它们之前先重新读。没有实际接历史就不加。
- 放在**角色段的末尾**：每种调用都有角色段（F16），它不在可省略的预算段里，所以一定能收到。不放进提醒段，因为 copy、planning 没有提醒段，Work 的提醒段又可能整段省略。
- 接续简报里原来那句“文件可能已经变化，编辑前先重新读取。”（`continuation-brief.ts:345`）删掉，只在角色段说一次。
- 不改写旧的工具结果。超长时最先省略的就是旧的工具结果正文（P3）。
- 不逐个文件比版本、列出哪些变了：Kernel 不跨执行记读过哪些文件，要做得加记录，等真实模型重跑后看要不要。

**P9 `check` 和提示词里提到的工具。**【lead 定，待审】
- 不开 Kernel 的 `check`：
  - session 范围只看这次执行读过的路径，跨执行的旧文件归 P8；
  - workspace 范围在几条线共用一个工作区时，会把别的线的改动都报成漂移。
- 平台包的 `base` 模板 = 今天 `coding-agent-v5` 的正文，再改两处：
  - 去掉 `check` 那一行；
  - **讲到工具的每一句都放进工具块**。按最终交给 Kernel 的工具清单（F17）分四种情况：
    - 有 `read`；
    - 只有 `read_source`、`read_material`；
    - 没有读文件的工具；
    - 有、没有 `edit`、`shell`。
  - 今天只读的 Query 也读到“用 edit”“用 shell”，以后看不到。
- 每个模板在 `pack.json` 里声明块外提到的工具名，平台包的 `base` 声明为空。准备时核声明的工具都在这次执行的工具清单里；不在就拒绝准备，回 `invalid`，原因写模板 id 和工具名。平台包另有一个测试：扫块外文字里出现的已知工具名，和声明比对。

**P10 任务输入的排法（§0.1 第 4 条）。**【待你定】
- 这一轮不改段的先后：守卫、绑定格式、入口对简报的核对、预算的取舍顺序都不动（F16）。
- 包里 Work、Query 任务输入的模板只能改文字。

**P11 采用由谁串（第 6 片开头的注；不属提示词，lead 在这里定方向）。**【lead 定方向，细节在 6B 冻结前补】
- 由服务端串，不交给新界面：
  - Host 上一个组合动作、一个路由，只认人；
  - 采用仍是你的动作，这个路由就是你的动作，不加新权限。
- 已知的难处（审查一 D83-17、D83-18）：
  - 第一步 `workspaces/registration` 是**读**登记，没登记回 `not_found`，组合动作在这一步停；
  - `checks/approve` 在 Host 设置里，没有 `commandId`，先存私有设置再通知 Host，通知失败时设置可能已存。
  所以“每步按 `commandId` 派生请求 id、从第一个没做完的步骤接着做”不能直接套。
- 6B 开工前，lead 写一份补充：
  - 组合动作的 owner 和持久的阶段记录；
  - 每步的输入和版本；
  - “已存、未确认安装”的恢复判据；
  - 和 `InitializationBindingV1` 怎么接。
  经 Codex 审后冻结，在 6B 实现和验收（R-14 的采用部分本来在 6B）。
- 为什么不交给界面：这串步骤的中断、重试和幂等不该放在浏览器里；E3 只调一个路由；测试经公开路由直接测。

### 0.4 和别的片、别的轮的接缝

- **结构一轮的 D3（决定 85-1）**：
  - 按 P1 的格式建渲染器和平台包第 1 版，把今天写死的文字原样搬进去（F13 列的全部）：
    - Work 和 Query 的前言、段标签；
    - 角色短句；
    - 初始化回答格式；
    - 接续简报的固定文字；
    - K3 复核和提方案的说明；
    - 咨询消费指导；
    - “用户答复”前缀；
    - 各类提醒的短句；
    - 平台工具的说明：白板、`record_note`、`project_source`、探索工具、只读命令、邮箱、图、Session 发现、K3 的两个工具。
  - 验收：同一组输入，搬前搬后渲染出的完整字节相同。
  - 不搬（归 PC，要先有 Kernel 补丁才能把正文传进去）：
    - Kernel 的基础提示词和内置工具说明；
    - `resources/skills/platform-*`。
    Skill 的标头只有 id 和正文 digest（F4），以后搬进包里只要正文、id、kind、priority 不变，发出的字节就不变。
- **PC**：P2–P5、P8、P9、包的覆盖、Kernel 补丁、平台包第 2 版（加 `base`，加 `stale-files-reminder`，平台行为说明搬进包里，接续简报去掉那句）。
- **6A**：`secretary-round`、`secretary-answer` 两个模板（L7 的回答和 0 个或 2–3 个思路），以及 P6。**6B**：P11 的补充和实现、秘书换手。
- **7A、7B**：消息送达时写成 user 消息的那几段话，各一个模板：
  - `action-request-delivery`（请动手）；
  - `inquiry-delivery`（请回答）；
  - `notify-delivery`（请知悉）；
  - `wait-reply-delivery`（等的回复到了）；
  - `wait-expiry-delivery`（问题到期）；
  - `intervention-delivery`（插话）。
  7B L11 的 `intervention-planning`。**7C**：B4 和 `handoff-brief`，以及 P7。
- **K2**（压缩，不在 MVP）不变；以后的摘要提示词也是包里的一个模板。
- **E3**：界面显示这次执行用了哪个包、哪版（读 P5）；设置里的入口按 §0.1 第 3 条。

## 1. 范围

- **D3 里做**：P1 的格式、渲染器、平台包第 1 版（原样搬）。
- **PC 交付**：
  - 平台包第 2 版；
  - Host 配置的包目录和策略表（P1、P2）；
  - Kernel 补丁：
    - 删法（P3）：传入估算和预算、报删除个数；
    - 思考（P4）；
    - 新执行和恢复都接受传入的基础提示词和 Skill（P5）；
    - 标出这次执行的任务输入（P3）；
  - 冻结集、正文存储、请求记录的新字段、读口（P5）；
  - 旧文件提醒（P8）；
  - 工具声明核对（P9）。
- **各片交付**：§0.4 列的模板和 P6、P7、P11。

## 2. 接口（第二稿，冻结时细调）

```ts
// resources/prompts/<pack>/pack.json
type PromptPackManifestV1 = {
  schemaVersion: 1; packId: string; extends: string | null;
  templates: Record<string, { file: string; version: number; mentionsTools: string[] }>;
  strings: string;                       // strings.json 的文件名
  tools: Record<string, string>;         // 工具名 → tools/<name>.json
};
// Host 配置里的一行
type PromptStrategyRowV1 = {
  id: string;
  match: { provider: string; model: string } | { provider: string; modelPrefix: string } | 'any';
  pack: string; reasoningReplay: 'current_run' | 'none'; contextWindowTokens?: number;
};
// prepared manifest 里
type PromptSetV1 = {
  schemaVersion: 1; strategyId: string; provider: string; model: string;
  reasoningReplay: 'current_run' | 'none';
  templates: { id: string; version: number; digest: string; packId: string }[];
  base: { ref: ArtifactRef; digest: string };                    // 已并入 Host 附加说明
  skills: { id: string; title: string; kind: 'instruction' | 'reference'; priority: number;
            source: string; ref: ArtifactRef; digest: string }[];  // 正文在 ref 里
};
// 每次模型请求的记录（Work 许可记录、Query 的 QueryRun 请求记录）加
type ModelRequestPromptFactsV1 = {
  systemDigest: string; toolsDigest: string; toolSpecsRef: ArtifactRef; maxOutputTokens: number;
  selection: { estimate: number; budget: number;
    removed: { memory: number; skillReference: number; additionalInstruction: number; toolResultBody: number;
               historyExchange: number; historyConclusion: number; currentExchange: number } };
};
// Kernel 补丁的新输入（runCodingAgent 和恢复入口都有）
//   baseSystemPrompt: string; skills: SkillContext[]; reasoningReplay: 'current_run' | 'none';
//   contextSelection: { estimate(request: ModelRequest): number; budget(): number };
//   onContextSelected(report: { requestId: string; estimate: number; budget: number; removed: … }): void;
// 渲染器
//   renderTemplate(resolved, templateId, slots, finalToolNames) → { text }
// 读口
//   readPromptRecord(ctx, ref: RunRef | QueryRunRef) → ReadResult<{ set: PromptSetV1;
//     requests: ({ requestId: string } & ModelRequestPromptFactsV1)[]; texts: Record<string, string> }>
```

## 3. 测试（TDD，DSH 一条一条写；不调真实模型）

### 3.1 测试入口（**待你确认**）

| 入口 | 测什么 | 怎么测 |
|---|---|---|
| PE1 | 模板包和渲染器 | 公开的加载和渲染函数，手写的小包 |
| PE2 | 策略表和包的覆盖 | Host 配置 → 解析结果；无效配置在 Host 启动时报出 |
| PE3 | 冻结集、正文和请求记录 | 用已有的 Work、Query 执行测试装置和脚本化的假模型，看假模型收到的请求和 `readPromptRecord` |
| PE4 | 删法的先后 | Kernel 已公开的 `selectContext`（`public-api.d.ts:33`），小输入加可手算的估算 |
| PE5 | 删法和思考在执行里的效果 | Kernel 的公开入口 `runCodingAgent`，脚本化的假提供方：历史分界、受保护的消息、工具循环、思考 |
| PE6 | 两家适配器的出站形状 | 两家适配器已有的测试方式，看占位结果和去掉思考后的消息发出去仍然合法、配对完整 |
| PE7 | 旧文件提醒、工具声明核对 | 经准备的公开路径 |
| PE8 | 秘书重建（6A 里）、换手简报（7C 里） | 各片自己的入口 |

### 3.2 验收行为（第二稿；冻结时补全期望值，期望写字面值或手算）

- **渲染和包**
  - PC-01 渲染：手写模板和槽位，输出逐字节等于手写结果；块的整行去掉；`{{#tool:edit}}` 在有、没有 edit 时各一例。
  - PC-02 加载拒绝：用了代码表里没有的槽位、必填槽位缺或出现两次、文件缺、正文里多一个 `{{`，各回一个配置问题，写明包、模板、原因。
  - PC-03 覆盖：加的包只改 `base`，其余模板来自平台包；冻结集里每个模板的来源包对。
  - PC-04 策略表：两行 DeepSeek 精确型号、一行前缀、一行缺省，各种模型都选到第一条匹配的；原 `host.ts:260` 的窗口值不变；配置改了以后开始执行，按配置 revision 不一致拒绝。
- **冻结和记录**
  - PC-05 冻结：准备以后改磁盘上的行为说明，执行开始后假模型收到的 system 仍是准备时的正文；冻结集里的 digest 等于手算的 sha256。
  - PC-06 恢复：执行暂停，改磁盘上的行为说明，再恢复，假模型收到的 system 不变。
  - PC-07 请求记录：一次执行两次模型请求，每次都有两个 digest、输出上限、删除个数；两次的 `toolSpecsRef` 相同；按读口取回的正文算出的 digest 等于记录里的。
- **删法和思考**
  - PC-08 删法顺序（`selectContext`）：构造七类都有的输入，逐步调小预算，删的先后和个数等于手算；第 6 类（以前执行的结论）在第 5 类之后。
  - PC-09 占位：以前执行成功的工具结果被省略时，调用还在，结果的 `output` 换成占位那一项，其余字段原样；失败的结果不换。
  - PC-10 行为说明不删：预算连受保护的加行为说明都放不下时，回 `required_content_over_budget`，不删行为说明。
  - PC-11 保护当前任务（`runCodingAgent`）：执行中来了一条消息，预算只够放下当前任务和这条消息，删掉的是以前执行的内容，任务输入还在。
  - PC-12 两套预算一致：Host 附加说明很长、窗口很紧时，选上下文就把它算进去；计量器不再因同一个请求超限而拒绝，而以前会。
  - PC-13 思考：`current_run` 时以前执行的 assistant 消息不带思考、这次的带；`none` 时都不带；只有思考的历史消息从发出的那份里拿掉；Kernel 里存的原记录不变。
  - PC-14 出站形状（两家适配器）：占位结果和去掉思考后的消息，发出去的请求体合法、调用和结果配对完整。
- **提醒和工具声明**
  - PC-15 旧文件提醒，三种情况：
    - 新 Session 没有历史：没有提醒；
    - LA-1 播种：有；
    - 普通复用同一 Session：有。
    有的时候在角色段末尾；零常驻预算（四个可省略段都省略）时也有。接续简报里不再有那句。
  - PC-16 工具声明：一个包的 `base` 在块外提到 `check`，准备回 `invalid`，原因带模板 id 和 `check`；平台包的扫描测试通过。
  - PC-17 四种工具清单：有 `read`、只有 `read_source`/`read_material`、没有读文件的工具、有没有 edit/shell，各一例，system 里讲工具的句子和清单对得上。

### 3.3 要改断言的旧测试（冻结时 lead 列全）

- Kernel 删法的旧测试里“删行为说明”的断言（P3 改成不删）；
- 断言接续简报含“文件可能已经变化”那句的测试（P8）；
- 断言基础提示词原文或版本 `coding-agent-v5` 的测试（P9）；
- 断言上下文窗口来自 `host.ts:260` 那个分支的测试（P2，值不变，只是来源变）。

## 4. 文件（影响面；施工时以实际为准，超出要报）

- **Kernel 补丁**：
  - `vendor/coding-agent/patches/` 下的 `core/runtime/loop/runtime-runner.ts`、`app/composition/composition-root.ts`、`app/composition/resume-composition.ts`、`app/composition/composition-contracts.ts`、`public-api.ts`；
  - 新加 `core/context/selection_policy/context-selection-policy.ts`；
  - `scripts/build-kernel-patch.mjs`；dist 只由脚本生成。
- **包**：`resources/prompts/platform/**`、`runtime-assets.json`、`scripts/check-boundaries.mjs`。
- **平台**：
  - D3 拆出的渲染器和调用配方；
  - `execution-preparation.ts`、`query-preparation.ts`、`query-execution.ts`、`execution-driver.ts`、`observed-model-run.ts`、`model-budget.ts`、`model-call-access.ts`；
  - `src/core/work-graph/tasks/model-call-service.ts`、`src/core/work-graph/queries/query-execution.ts`（请求记录的新字段和编解码）；
  - `src/contracts/` 里冻结集和记录的类型；
  - `src/app/runtime-configuration.ts`、`host.ts`（包目录和策略表）。

## 5. 施工

- 顺序：本节冻结 → 结构一轮（含 D3）→ PC → 6A。
- PC 估 2,000–2,800 行（含测试）。DSH 施工、Codex 审、lead 验收，合入前跑全量和规模批（决定 86-6）。
- 这些都不等于真实模型验收。PC 和 6A 合入后，用真实模型重跑时核三件事：
  - DeepSeek 在 `current_run` 下工具循环正常；
  - 按请求记录里的用量看缓存命中；
  - 秘书处理多个请求时上下文长度稳定。

## 6. 不做的事

- 摘要和压缩（K2，不在 MVP）。
- 按模型改任务输入的排法（§0.1 第 4 条）。
- 显式的缓存参数（`cache_control`、`prompt_cache_key`）；“删一次就多删一些、好让前缀稳定”的滞后删法。先看真实重跑里的缓存损失，再定。
- 逐字节还原整个请求（P5）。
- OpenAI 推理条目的回传（Responses API 的 reasoning item）。
- 逐个文件比版本的过期清单（P8）。
- 读 Query 历史的模型工具（P7）。
- agent 提议或修改提示词；按效果自动挑模板。
- 你的设置里的编辑入口（除非 §0.1 第 3 条定要）。

## 7. Codex 第一轮审查的处理（`D:/cc-lead-notes/codex2/d83/review1.out.md`，冻结时复制进证据）

| 条 | 处理 |
|---|---|
| D83-01 新排法会被守卫拒绝 | 采纳：这一轮不改排法（P10，§0.1 第 4 条） |
| D83-02 两套预算 | 采纳：估最后发出的请求，平台传入估算和预算（P3） |
| D83-03 纯 assistant 消息不删 | 采纳：改正 F7；成为第 6 类，写明是行为变化（P3） |
| D83-04 占位形状 | 采纳：只换成功结果的 `output`（P3），两家适配器出站测试（PC-14） |
| D83-05 去思考后的空消息 | 采纳：从发出的那份拿掉（P4、PC-13） |
| D83-06 恢复路径 | 采纳：恢复入口也接受传入正文（P5、PC-06） |
| D83-07 Skill 形状 | 采纳：冻结完整 `SkillContext`，含 reference 和空选择（P5） |
| D83-08 Skill 标头没有路径 | 采纳：改正理由（§0.4） |
| D83-09 写入者和提交 | 采纳：正文用 `bodies.put`，请求事实进各自已有的记录（P5） |
| D83-10 重拼整请求 | 采纳：记输出上限；“对得上”收窄到 system、工具说明、版本和删除个数（P5） |
| D83-11 删除个数怎么传 | 采纳：Kernel 回调按 `requestId` 报（P3） |
| D83-12 模型身份和窗口 | 采纳：冻结集记 provider/model，窗口只来自 Host 预算（P2） |
| D83-13 合批和历史 | 采纳：三个槽（P6） |
| D83-14 读参谋的 Query 历史 | 采纳：不做工具，简报带最近 3 次回答（P7） |
| D83-15 提醒放哪 | 采纳：放角色段末尾（P8） |
| D83-16 `read` 也要分情况 | 采纳：所有讲工具的句子都进工具块，四种清单（P9、PC-17） |
| D83-17 登记是读 | 采纳：改正（P11） |
| D83-18 采用的步骤不能统一续做 | 采纳：本节只定方向，细节在 6B 前补并审（P11） |
| D83-19 D3 清单漏项 | 采纳：补进 F13 和 §0.4 |
| D83-20 `runCodingAgent` 测不了全部类别 | 采纳：删法先后改用 `selectContext`（PE4） |
| D83-21 提醒和播种 | 采纳：按“实际接了历史”判断，三种情况（P8、PC-15） |
| D83-22 CA12 | 不排法后不涉及 |
| D83-23 预算取舍顺序 | 不排法后不涉及 |
