# 第 6、7 片补充规格：提示词和上下文（决定 83）

**状态：lead 第一稿（2026-10-21），待 Codex 审、给你看，冻结前不施工。** 第 6、7 片已冻结（决定 64），这一节是冻结后的补充，不改它们已定的行为，只定提示词放在哪、谁能改、按什么选、超长怎么删、怎么记。依据是 Codex 10-18 的只读调研（冻结时复制进证据），lead 对着 `4d874f0b` 的代码重核过 §0.2 每一条。

和别的轮的关系：
- 6A 之前的结构一轮（决定 85-1）里的 D3 拆上下文装配器，按本节 §2 的模板包和渲染器做，把今天写死的文字**原样**搬进平台包第 1 版，发出的字节不变。
- 本节的新行为由一个单独的施工片 **PC**（提示词和上下文）做，排在结构一轮之后、6A 之前。
- 各片自己的模板（秘书、派活、等待、转交、干预）在各片里写，用本节的机制（§0.4）。

## 0. 冻结说明（lead）

### 0.1 要你定的

1. **秘书每一轮从记录重建上下文，不接它 Session 的完整历史（P6）。**
   - 每轮带：工作区概况、目标列表、这个请求以前的轮次（最多 10 轮，每个回答截到 2 KiB，第 6 片 L8 原样）、当前理解和注记索引。
   - 不带：别的请求的对话；以前轮次里秘书读过的文件和工具调用（结论在回答里）。
   - 好处：同一个秘书管很多请求也不会越拼越长；请求之间不串；秘书换手时接任者照同样的记录重建，不用搬历史。
   - 代价：秘书在请求 A 里读到的东西，到请求 B 里只剩它写进当前理解、注记的部分。lead 建议这样做。
2. **执行者、参谋换手（第 7 片 L18），接任者不带前任的对话历史（P7）。**
   - 接任者拿到接续简报（交出的任务、每个任务的阶段和最后结果、理解指针、旧线链接）和当前理解；要看前任做过什么，用已有的读线工具按需读。
   - 换手常常就是因为太长；带历史等于把问题搬过去。lead 建议这样做。
3. **谁能改提示词（P1）。** lead 建议：
   - 这一轮只有运行平台的人能改，在 Host 配置里加模板包目录，和今天换 Skill 目录一样；
   - 你的设置里不加编辑入口，新界面（E3）只显示这次执行用的是哪个包、哪版；
   - agent 不能改提示词。
   - 另一种做法：E3 设置里也能选包、改单个模板，那要加编辑、校验和版本管理的界面。
4. **测试入口**（§3.1），确认后施工。

### 0.2 代码事实（`4d874f0b`；lead 核过）

| # | 事实 | 位置 |
|---|---|---|
| F1 | Kernel 基础提示词 `coding-agent-v5` 写死在冻结的 dist 里，约 3,800 字符；第 14 行让模型用 `check`。Kernel 有 `check` 工具，平台给 Kernel 的工具名里从来没有它 | `vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:2`、`:14`；`dist/tools/builtin/check/check-tool.js:96`；`src/core/agent-runtime/observed-model-run.ts:272` |
| F2 | system 由 Kernel 拼：基础提示词 → 附加指令 → 行为说明（instruction Skill）→ 参考 Skill → 记忆；Host 的 `systemInstruction` 原文接在最后 | `dist/core/context/builder/context-builder.js:25`；`observed-model-run.ts:263` |
| F3 | Skill 正文在每次执行开始时才按目录读文件，不随准备冻结；Kernel 有 `onConfiguration` 回调报出实际配置，平台没接 | `vendor/coding-agent/patches/app/composition/composition-root.ts:415`、`:423`；`src` 里没有 `onConfiguration` 的调用 |
| F4 | Work 的任务输入是一条 user 消息，段的先后写死：角色和运行配置、目标、任务、足迹、注记索引、提醒、选定输入、接续简报 | `src/core/agent-runtime/context-assembler.ts:79`、`:93` |
| F5 | 入口核对接续简报时要求它是任务输入的末尾 | `src/core/work-graph/tasks/execution-entry-service.ts:1201` |
| F6 | Kernel 每次模型请求把“以前执行的历史”和“这次执行的对话”分开拿，再拼起来交给预算选择 | `patches/core/runtime/loop/runtime-runner.ts:666`、`:686` |
| F7 | 超预算时依次删记忆、参考 Skill、附加指令、行为说明，最后从最旧的对话整组删；只保护最新一条 user 消息和没闭合的调用；不留摘要。运行中来信也是 user 消息，所以当前任务那条会被删。删法不在受管补丁清单里 | `dist/core/context/selection_policy/context-selection-policy.js:30`、`:92`、`:154`；`scripts/build-kernel-patch.mjs:13` |
| F8 | 思考：DeepSeek 适配器把历史里的思考原样带回，OpenAI 适配器一律不带 | `dist/model/providers/deepseek/deepseek-model-client.js:28`；`dist/model/providers/openai/openai-model-client.js` |
| F9 | Query 的执行接不接 Session 历史由 `sessionContext` 定，已有 `current_turn`（不接）和 `session_history`（接到某个位置）两种 | `src/core/agent-runtime/query-execution.ts:481`–`:501` |
| F10 | Work 的接续 Session 第一轮接原 Session 的历史（LA-1）；归档来源的重新入队不接 | `src/core/agent-runtime/execution-driver.ts:929`；`context-assembler.ts:1447` |
| F11 | 写死的大段文字：初始化回答格式约 8,400 字符，白板工具说明约 3,200，`project_source` 说明约 2,400，`record_note` 约 1,200，接续简报的固定文字几千字符，角色短句，各段标签 | `src/core/agent-runtime/query-preparation.ts:50`；`whiteboard-tools.ts:445`；`project-source-tool.ts:237`；`note-tool.ts`；`src/contracts/continuation-brief.ts:345`；`role-profiles.ts:23`；`context-assembler.ts:82` |
| F12 | 每次模型请求已经写一份许可记录，带整个最终请求的 digest、任务输入 digest、manifest digest；只有 digest，没有正文 | `observed-model-run.ts:249`–`:251`；`src/core/agent-runtime/model-call-access.ts:63` |
| F13 | 模型设置只有 provider、model、baseUrl、thinking、reasoningEffort；按 DeepSeek 型号换上下文预算是 Host 里的一个分支 | `src/app/host-settings-types.ts:7`–`:10`；`src/app/host.ts:260` |
| F14 | 平台 Skill 正文在 `resources/skills/platform-*`，列进 `runtime-assets.json` 的哈希清单；Host 可以换 Skill 目录 | `runtime-assets.json:39`；`src/app/runtime-configuration.ts:58`、`:373` |

### 0.3 lead 定的技术选择

**P1 模板包。**【lead 定，待审】
- 一个模板包是一个目录：`pack.json`、模板文件、`strings.json`（段标签、“未声明”这类短语）、`tools/<工具名>.json`（工具说明和参数说明）。平台自带的包在 `resources/prompts/platform/`，和 Skill 一样进 `runtime-assets.json` 的哈希清单，检查脚本复算。
- `pack.json` 列每个模板的 id、文件、版本号（改一个字也加 1）、块外提到的工具名（P9）。模板 id 和每个模板有哪些槽位由代码定（每个调用配方一张表）；包只能改文字和槽位的先后，不能加减槽位。
- 语法只有三样：
  - `{{槽位}}` 放入平台写好的一段文字；
  - `{{#槽位}}…{{/槽位}}`：槽位不空时才出现；
  - `{{#tool:工具名}}…{{/tool:工具名}}`：这次执行注册了这个工具时才出现。
  没有表达式、循环、转义和引用别的模板；正文里不许出现别的 `{{`。只有一个块标记的整行，连同换行一起去掉。
- 分工：事实怎么写成文字（目标、任务、注记索引的条目）仍在代码里，标签从 `strings.json` 取；模板管说明性的话和各段先后。
- 加载时核：模板用到的槽位都在代码表里，必填槽位都出现且只出现一次，引用的文件都在。渲染时必填槽位为空算代码错误，准备回 `invalid`。
- 覆盖：Host 配置可以加包目录。加的包写 `extends: "platform"`，只给要改的模板；解析时每个模板取最具体的那个，记下来自哪个包。
- 包无效时 Host 启动报配置问题（`WorkbenchRuntimeConfigurationProblem`），这个绑定不能用；不悄悄退回平台包，免得以为改了其实没生效。
- agent 不能改提示词；你的设置里有没有入口见 §0.1 第 3 条。

**P2 按模型的策略表。**【lead 定，待审】
- Host 配置 `prompts.strategies`，每行 `{ id, match, pack, reasoningReplay, contextWindowTokens? }`：
  - `match` 是 `{ provider, model }`（精确）、`{ provider, modelPrefix }` 或 `any`；
  - `reasoningReplay` 是 `current_run` 或 `none`（P4）。
- 按顺序取第一条匹配的。平台自带的缺省表最后一行是 `{ id: "default", match: any, pack: "platform", reasoningReplay: "current_run" }`。
- `host.ts:260` 按 DeepSeek 型号换上下文预算的分支挪成缺省表里的行，值不变。
- 匹配用这次执行的可信模型绑定（manifest 记下的那份）。准备时解析一次，记进冻结集（P5），之后不换。
- “上下文怎么排”：任务输入里各段的先后就是 `work-task` 模板里槽位的先后，换排法就是换模板版本，表里不另设一列；system、工具、历史、当前输入这四层的先后由 Kernel 定。

**P3 超长时的删法（Kernel 受管补丁）。**【lead 定，待审】
- `scripts/build-kernel-patch.mjs` 的补丁清单加 `core/context/selection_policy/context-selection-policy.ts`，源码照已有做法从冻结的 source map 还原。
- 不删的：
  1. 基础提示词和 Host 附加说明（今天也不删）；
  2. 行为说明（instruction Skill），今天会删，改成不删；
  3. **这次执行的任务输入**（这次执行的第一条 user 消息），由 runner 按 F6 的分界标出来交给选择；
  4. 最新一条 user 消息；
  5. 没闭合的调用。
- 删的顺序：
  1. 记忆；
  2. 参考 Skill；
  3. 附加指令；
  4. **以前执行里的工具结果正文**，从最旧的起，换成一行占位：工具名、调用 id、“内容因长度省略，需要时重新读”。调用和结果的配对不动。
  5. 以前执行里的整组交换和 user 消息，从最旧的起；
  6. 这次执行里不受保护的整组交换，从最旧的起。
- 删完还超，回今天的 `required_content_over_budget`。
- 每次请求删了什么，按种类计数记进请求记录（P5）。

**P4 思考。**【lead 定，待审】
- `current_run`：拼请求前去掉以前执行（历史）里 assistant 消息的思考，这次执行里的保留。`none`：全部去掉。
- 只改发出去的请求，Kernel 存的原记录不动，原历史照旧能按需读。
- 在 runtime-runner 里做（已在补丁清单），提供方适配器不改。OpenAI 适配器本来就不带思考，表里写什么效果都一样。
- 平台不把思考写成事实、消息或简报：今天就是这样，写成规则。

**P5 记下每次实际发出的整套提示词。**【lead 定，待审】
- **冻结集** `PromptSetV1`：准备时算出，存进 prepared manifest，算进 manifest digest。内容：
  - 策略行 id；
  - 用到的每个模板（id、版本、digest、来自哪个包）；
  - 基础提示词、每个行为说明、Host 附加说明的 digest；
  - `reasoningReplay` 和上下文窗口。
- **准备时就读出 system 侧的全部正文**（基础提示词、行为说明、Host 附加说明）。开始执行时由平台直接交给 Kernel：补丁让 composition-root 接受传入的基础提示词和行为说明，不再按目录读文件。所以准备之后改文件，不影响这次执行（解 F3）。
- **正文按 digest 存一份**：新记录 `PromptTextV1 { digest, text }`，同一 digest 只存一次；准备那次提交写入还没存过的。
- **每次模型请求**，在已有的许可记录上（F12）加：
  - `systemDigest`、`toolsDigest`；
  - `removed`：按 P3 的种类计数。
  工具说明的正文（含 Kernel 内置的 read、edit、shell）第一次出现时，按 digest 存进 `PromptTextV1`，和许可记录同一次提交。
- **读口**：Runtime owner 的只读方法 `readPromptRecord`（执行或查询执行的引用）。返回冻结集、每次请求的 digest 和计数、用到的正文。路由等 E3。
- 冻结集、每次请求的两个 digest、存下的正文，加上 Kernel Session 里的消息记录，能重拼出发出的请求，再和已有的整请求 digest 对。

**P6 秘书的请求历史（§0.1 第 1 条）。**【待你定】
- 秘书一轮用 `sessionContext: current_turn`（F9 已有），不接 Session 历史。上下文每轮按第 6 片 L8 的输入从记录重建，用 `secretary-round` 模板。
- 以前轮次只从请求记录来：原话、回答（截到 2 KiB）、你的选择、候选计划的引用。Kernel 历史里的工具调用和读过的文件不带。
- 边界是同一请求：`requestRoot` 那一条链，含追问、合批、换手转来的轮次。别的请求一律不带，哪怕是同一个秘书处理的。
- 秘书换手（第 6 片 L10）因此不用搬历史。
- 角色探索、干预规划、问一问这些 Query 照今天接所在线的历史，受 P3 约束。

**P7 换手的历史边界（§0.1 第 2 条）。**【待你定】
- 第 7 片 L18 建接任 Session 时不写 `sessionBasis`，不带前任的对话历史。
- 接任者的上下文：
  - `handoff-brief` 模板写成的接续简报：交出的任务、每个任务的阶段和最后结果、理解指针、旧线链接、旧线最后一次执行的结论（只取正文，不取思考）；
  - 任务输入目标段里本来就有的当前理解；
  - 已有的读线工具（`read_session_card`、执行历史读取），按需读。
- 已有的两种接历史照旧：K3 L12 的复核轮、LA-1 接续 Session 的第一轮（F10）。
- 结构审查 B4（拆接续简报，7C 之前）的范围：把简报的事实收集（`continuation-brief-assembly.ts`）和写成文字（`continuation-brief.ts`）分开；文字进 `continuation-brief` 和 `handoff-brief` 两个模板，共用一个渲染。

**P8 接新任务时的旧文件提醒。**【lead 定，待审】
- 一次执行要接 Session 历史时（`session_history`，含播种），提醒段加一条统一提醒（`stale-files-reminder` 模板）：以前读过的文件内容可能已过期，改动或依据它们之前先重新读。不接历史就不加。Work 和 Query 一样。
- 接续简报里原来那句“文件可能已经变化，编辑前先重新读取。”（`continuation-brief.ts:345`）删掉，只在提醒里说一次。
- 不改写旧的工具结果。超长时最先省略的就是旧的工具结果正文（P3）。
- 不逐个文件比版本、列出哪些变了：Kernel 不跨执行记读过哪些文件，要做得加记录，等真实模型重跑后看要不要。

**P9 `check` 和提示词里提到的工具。**【lead 定，待审】
- 不开 Kernel 的 `check`：
  - session 范围只看这次执行读过的路径，跨执行的旧文件归 P8；
  - workspace 范围在几条线共用一个工作区时，会把别的线的改动都报成漂移。
- 平台包的 `base` 模板 = 今天 `coding-agent-v5` 的正文，再改两处：
  - 去掉 `check` 那一行；
  - 讲 edit、shell 的句子放进 `{{#tool:edit}}`、`{{#tool:shell}}` 块，只读的执行看不到它们（今天只读的 Query 也读到“用 edit”“用 shell”）。
  Kernel 补丁让 composition-root 用传入的基础提示词（P5）。
- 每个模板在 `pack.json` 里声明块外提到的工具名。准备时核这些工具都在这次执行的工具清单里；不在就拒绝准备，回 `invalid`，原因写模板 id 和工具名。平台包另有一个测试：扫块外文字里出现的已知工具名，和声明比对。

**P10 任务输入的排法和简报核对。**【lead 定，待审】
- 平台包第 2 版的 `work-task` 模板按“越稳定越靠前”排：角色和运行配置 → 目标 → 任务 → 足迹 → 注记索引 → 选定输入 → 接续简报 → 提醒。提醒最易变，放最后。
- 入口对简报的核对（F5）改成按渲染器报出的槽位位置核：简报原文正好在 `continuation` 槽的位置，只出现一次。不再要求在末尾。

**P11 采用由谁串（第 6 片开头的注；不属提示词，lead 在这里一起定）。**【lead 定，待审】
- 由服务端一个组合动作串旧界面的那 8 个路由，不交给新界面。一个路由（暂名 `setup/adopt-initial`），只认人，带 `commandId`。
- 步骤就是那 8 个路由背后的 owner 调用，按旧界面的顺序：
  1. 登记工作区（还没登记时）；
  2. 读架构；
  3. 采用初始架构；
  4. 读完成标准；
  5. 安装完成标准；
  6. 启用完成标准；
  7. 批准检查；
  8. 写目标输入。
- 每步的请求 id 由 `commandId` 派生；重试从第一个没做完的步骤接着做。某一步被拒，就停在那里，回报第几步、原因。
- 不加新权限：采用仍是你的动作，这个路由就是你的动作。
- 放在 Host 还是核心、输入和回执、和 6B 的 `InitializationBindingV1` 怎么接，写进 6B 的任务书，在 6B 实现和验收（R-14 的采用部分本来在 6B）。
- 为什么不交给界面：这串步骤的中断、重试和幂等不该放在浏览器里；E3 只调一个路由；测试经公开路由直接测。

### 0.4 和别的片、别的轮的接缝

- **结构一轮的 D3（决定 85-1）**：
  - 按 P1 的格式建渲染器和平台包第 1 版，把今天写死的文字原样搬进去：
    - Work 和 Query 的前言、段标签；
    - 角色短句；
    - 初始化回答格式；
    - 接续简报的固定文字；
    - 平台工具的说明：白板、`record_note`、`project_source`、探索工具、只读命令、邮箱、图、Session 发现；
    - 各类提醒的短句。
  - 验收：同一组输入，搬前搬后渲染出的完整字节相同。
  - 不搬：
    - Kernel 的基础提示词和内置工具说明（要补丁，归 PC）；
    - `resources/skills/platform-*`：Kernel 给 Skill 加的标头里有路径，搬了字节会变，归 PC。
- **PC**：P2–P5、P8–P10、包的覆盖、Kernel 补丁、平台包第 2 版（加 `base`，`work-task` 改排法，加 `stale-files-reminder`，平台行为说明搬进包里）。
- **6A**：`secretary-round`、`secretary-answer` 两个模板（L7 的回答和 0 个或 2–3 个思路），以及 P6。**6B**：P11、秘书换手。
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
  - Kernel 补丁：删法、思考、传入基础提示词和行为说明、标出这次执行的任务输入（P3、P4、P5）；
  - 冻结集、`PromptTextV1`、请求记录的新字段和读口（P5）；
  - 旧文件提醒（P8）；
  - 工具声明核对（P9）；
  - 新排法和简报核对（P10）。
- **各片交付**：§0.4 列的模板和 P6、P7、P11。

## 2. 接口（第一稿，冻结时细调）

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
  schemaVersion: 1; strategyId: string; reasoningReplay: 'current_run' | 'none'; contextWindowTokens: number;
  templates: { id: string; version: number; digest: string; packId: string }[];
  base: { digest: string }; behaviours: { skillId: string; digest: string }[]; hostInstruction: { digest: string } | null;
};
type PromptTextV1 = { digest: string; text: string };   // 新记录，按 digest 只存一次
// 每次模型请求的许可记录加
type ModelRequestPromptFactsV1 = {
  systemDigest: string; toolsDigest: string;
  removed: { memory: number; skillReference: number; additionalInstruction: number;
             toolResultBody: number; historyGroup: number; currentGroup: number };
};
// Kernel 补丁的新输入（runCodingAgent）
//   baseSystemPrompt?: string; providedSkills?: SkillDefinition[]; reasoningReplay?: 'current_run' | 'none'
// 渲染器
//   renderTemplate(resolved, templateId, slots, registeredTools) → { text; slotOffsets: Record<string, [number, number]> }
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
| PE3 | 冻结集和实际发出的请求 | 用已有的 Work、Query 执行测试装置和脚本化的假模型，看假模型收到的请求和 `readPromptRecord` |
| PE4 | 删法和思考 | Kernel 的公开入口 `runCodingAgent`，脚本化的假提供方，小预算 |
| PE5 | 旧文件提醒、新排法、简报核对 | 经准备和入口的公开路径 |
| PE6 | 秘书重建（6A 里）、换手不带历史（7C 里） | 各片自己的入口 |

### 3.2 验收行为（第一稿；冻结时补全期望值，期望写字面值或手算）

- PC-01 渲染：手写模板和槽位，输出逐字节等于手写结果；块的整行去掉；`{{#tool:edit}}` 在有、没有 edit 时各一例。
- PC-02 加载拒绝：用了代码表里没有的槽位、必填槽位缺或出现两次、文件缺、正文里多一个 `{{`，各回一个配置问题，写明包、模板、原因。
- PC-03 覆盖：加的包只改 `base`，其余模板来自平台包；冻结集里每个模板的来源包对。
- PC-04 策略表：两行 DeepSeek 精确型号、一行前缀、一行缺省，各种模型都选到第一条匹配的；原 `host.ts:260` 的预算值不变。
- PC-05 冻结：准备以后改磁盘上的行为说明和模板，执行开始后假模型收到的 system 仍是准备时的正文；冻结集的 digest 等于手算的 sha256。
- PC-06 请求记录：一次执行两次模型请求，每次都有 `systemDigest`、`toolsDigest`；正文各存一份；第二次执行用同一套，不再多存。
- PC-07 读口：`readPromptRecord` 读出的正文加 Kernel 记录重拼出的请求，digest 等于许可记录里的整请求 digest。
- PC-08 删法保护：执行中来了一条消息，预算只够放下当前任务和这条消息，删掉的是以前执行的内容，任务输入还在。
- PC-09 删法顺序：构造各类都有的输入，逐步调小预算，删的先后和 `removed` 计数等于手算。
- PC-10 占位：以前执行的工具结果被省略时，调用还在，结果换成占位那一行，配对完整。
- PC-11 行为说明不删：预算连受保护的加行为说明都放不下时，回 `required_content_over_budget`，不删行为说明。
- PC-12 思考：`current_run` 时以前执行的 assistant 消息不带思考、这次的带；`none` 时都不带；Kernel 里存的原记录不变。
- PC-13 旧文件提醒：接历史的执行有这条提醒，新 Session 的第一次执行没有；接续简报里不再有那句。
- PC-14 新排法：提醒在接续简报之后；入口按槽位位置核对简报通过；简报被改一个字时入口拒绝（原拒绝码）。
- PC-15 工具声明：一个包的 `base` 在块外提到 `check`，准备回 `invalid`，原因带模板 id 和 `check`；平台包的扫描测试通过。
- PC-16 只读执行：只读 Query 收到的 system 里没有 edit、shell 的句子。

### 3.3 要改断言的旧测试（冻结时 lead 列全）

- Kernel 删法的旧测试里“删行为说明”的断言（P3 改成不删）；
- 断言任务输入里提醒在选定输入之前的测试（P10）；
- 断言接续简报含“文件可能已经变化”那句的测试（P8）。

## 4. 文件（影响面；施工时以实际为准，超出要报）

- Kernel 补丁：`vendor/coding-agent/patches/` 下的 `core/runtime/loop/runtime-runner.ts`、`app/composition/composition-root.ts`、`app/composition/composition-contracts.ts`，新加 `core/context/selection_policy/context-selection-policy.ts`；`scripts/build-kernel-patch.mjs`；dist 只由脚本生成。
- 包：`resources/prompts/platform/**`、`runtime-assets.json`、`scripts/check-boundaries.mjs`。
- 平台：D3 拆出的渲染器和调用配方；`execution-preparation.ts`、`query-preparation.ts`、`query-execution.ts`、`execution-driver.ts`、`observed-model-run.ts`、`model-call-access.ts`；`src/core/work-graph/tasks/execution-entry-service.ts`（简报核对）；`src/contracts/` 里冻结集和记录的类型；记录种类的登记（`ledger.ts`、组合根）；`src/app/runtime-configuration.ts`、`host.ts`（包目录和策略表）。

## 5. 施工

- 顺序：本节冻结 → 结构一轮（含 D3）→ PC → 6A。
- PC 估 1,500–2,200 行（含测试），DSH 施工、Codex 审、lead 验收，合入前跑全量和规模批（决定 86-6）。
- 这些都不等于真实模型验收：PC 和 6A 合入后，用真实模型重跑时核三件事：DeepSeek 在 `current_run` 下工具循环正常；缓存命中按用量记录看；秘书多请求时上下文长度稳定。

## 6. 不做的事

- 摘要和压缩（K2，不在 MVP）。
- 显式的缓存参数（`cache_control`、`prompt_cache_key`）；“删一次就多删一些、好让前缀稳定”的滞后删法。先按 P5 的计数在真实重跑里看损失，再定。
- OpenAI 推理条目的回传（Responses API 的 reasoning item）。
- 逐个文件比版本的过期清单（P8）。
- agent 提议或修改提示词；按效果自动挑模板。
- 你的设置里的编辑入口（除非 §0.1 第 3 条定要）。
