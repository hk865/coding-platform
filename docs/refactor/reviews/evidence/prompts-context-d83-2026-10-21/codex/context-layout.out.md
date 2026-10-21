已按只读方式核对，没有写文件、运行测试或调用模型。以下路径均相对仓库根；“每轮”区分为一次 **Run** 和 Run 内的一次 **模型请求**。

**A. 现状地图**

当前输入分成三部分：`systemPrompt`、独立的 `tools` 字段、按时间排列的 `messages`。任务、角色说明、续做 brief 都在 `messages` 中，通常是 **user 消息**，并不放在 system 中。工具定义与 system 在服务端如何排成 token 序列，仓库代码不能证明。`vendor/coding-agent/dist/core/context/builder/context-builder.js:110`

实际装配和发送关系如下：

| 顺序／位置 | 内容及生成位置 | 消息类型 | 重发与持久化 |
|---|---|---|---|
| 独立字段 | 本次获准工具的名称、描述、参数 schema；最终按工具名排序。`src/core/agent-runtime/observed-model-run.ts:241`；`vendor/coding-agent/dist/core/context/builder/context-builder.js:112` | `tools`，不是消息 | 每次模型请求发送；Session 配置记录工具 schema digest，没有把工具说明正文当历史消息保存。`vendor/coding-agent/dist/app/composition/composition-root.js:124` |
| system 第 1 段 | Kernel 固定基础提示 `coding-agent-v5`，包含工作方式、信任规则、进度、文件一致性、权限等。`vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:2` | system；OpenAI 映射为 `instructions` | 每次请求发送；不是 transcript。`vendor/coding-agent/dist/model/providers/openai/openai-model-client.js:76` |
| system 后续段 | 通用顺序是 additional instructions → instruction skills → reference skills → memories；各组按 priority 降序、id 排序。`vendor/coding-agent/dist/core/context/builder/context-builder.js:12` | system | 当前入口没有传 additional instructions，memory 使用 `EmptyMemoryProvider`；行为 Skill 在每个 Run 启动时读文件，之后随请求重发。`vendor/coding-agent/dist/app/composition/composition-root.js:283`、`:306`、`:346` |
| system 最后一段 | Host 的 `systemInstruction` 原文追加到 Kernel system 后面。`src/core/agent-runtime/observed-model-run.ts:230` | system | Run 内反复发送；本机工作台默认是 `null`。`src/app/host.ts:294` |
| messages 前部 | 所选 Session 可恢复的历史，或指定源 Session 的历史前缀。`src/core/agent-runtime/execution-driver.ts:636` | 原 user／assistant／tool 类型 | 每次请求重新参与装配；可能被预算裁剪。`vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:390` |
| 当前 Run 第一条 | 平台装配的整段 `manifest.input`。`src/core/agent-runtime/execution-driver.ts:934` | **user** | 作为 `turn.started` 中的用户消息保存一次，随后随当前 transcript 重发。`vendor/coding-agent/dist/app/composition/composition-root.js:83`、`:256` |
| 当前 Run 后续输入 | 收到的回复、普通来信、用户决定答复、steer。`src/core/agent-runtime/execution-inputs.ts:103` | **追加 user** | 只在 `before_model` 接受，按 input id 去重；接受事件持久化后加入 transcript。`vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:362`；`vendor/coding-agent/patches/core/runtime/reducer/run-state-reducer.ts:239` |
| 工具循环 | assistant 正文、工具调用及其结果。`vendor/coding-agent/dist/core/context/builder/context-builder.js:63` | assistant → tool | 每次后续请求带回尚未裁掉的交换；事件写入 Session。`vendor/coding-agent/dist/storage/session_event_sink/session-event-sink.js:36` |
| 思考 | assistant 消息上的独立字段 `reasoningContent`。`vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:471` | assistant 的字段，不是单独 user 消息 | Kernel 保存；提供方是否发送见 C。 |

当前 Work 的第一条 user 消息内部，顺序固定为：

1. **前言**：说明这是平台事实装配的当前任务输入。  
2. **角色和运行配置**：权限、工具、写范围；RoleSpec 的目的、职责、所需材料、产出、成功／停止／交接条件；缺少 RoleSpec 时用角色短句。  
3. **目标**：目标正文、工作区版本、自治级别、当前理解和规范。  
4. **任务**：assignment instruction、冻结的 Plan 定义、当前任务阶段、义务、验收、上下游。  
5. **足迹**。  
6. **注记索引**。  
7. **提醒**：异常、待决定、理解待更新、缺输入、架构提醒等。  
8. **选定输入正文摘录**。  
9. **续做 brief**，有时才加，固定在末尾。  

顺序定义在 `src/core/agent-runtime/context-assembler.ts:58`；角色内容在 `:441`，目标在 `:556`，任务在 `:611`，续做后缀在 `:1203`、`:1223`。

这里有几个容易混淆的地方：

- **角色说明和 behavior Skill 是两层。** RoleSpec 正文被装进 user 输入；`resources/skills/*/content.md` 被 Kernel 装进 system。legacy template 的 id/revision/digest 本身不等于一份会被展开的 system 模板。`src/core/agent-runtime/context-assembler.ts:454`；`vendor/coding-agent/dist/core/context/builder/context-builder.js:36`
- **4 KiB 不是整个任务输入上限。** 它是可选常驻部分的默认预算；角色、目标、任务及续做后缀另行处理。选定输入先读最多 4096 字节的首页，再参与这个预算。`src/core/agent-runtime/context-assembler.ts:226`、`:335`、`:1171`、`:1285`
- **读过的文件通常在 tool result。** `read` 返回文本、行范围、截断标记、文件 revision；不会自动复制到 system 或任务 brief。用户主动引用选区时，选区原文、版本、digest 则直接进入用户请求。`vendor/coding-agent/dist/tools/builtin/read/read-tool.js:46`；`src/ui/views/conversation/goal-setup.ts:29`
- **邮箱有两条入口。** 自动送达时，正文成为 user 消息；模型主动调用邮箱读取工具时，消息记录或正文成为 tool result。当前自动送达顺序是指定等待回复 → 旧 outbox 回复 → 转交来的回复 → 普通 inbox → control inputs。`src/core/agent-runtime/execution-inputs.ts:143`、`:156`、`:175`、`:196`、`:210`；`src/core/agent-runtime/communication-tools.ts:101`
- **提醒也有两条入口。** 架构提醒在准备时进入任务的 Reminders；注意力增量、书记提醒先生成 notify 消息，再走输入通道。注意力带文件路径和版本、图变化、计数，没有文件全文。`src/core/agent-runtime/context-assembler.ts:1082`；`src/app/host.ts:1422`、`:1495`
- **Query 与 Work 不同。** 当前 Query 是角色＋目标＋Question，按情况加关注任务或规划摘要；没有 Work 的 selected inputs 和 continuation 后缀。初始规划另追加固定 JSON 回答协议。`src/core/agent-runtime/context-assembler.ts:1319`；`src/core/agent-runtime/query-preparation.ts:312`
- **Kernel 补丁入口确实在受管脚本中。** runtime loop、Session 历史恢复、输入事件/reducer、workspace/process sandbox、shell 工具都由补丁源生成；基础 system、context builder、两个提供方适配器不在这个补丁清单内。`scripts/build-kernel-patch.mjs:13`

**B. Session 复用**

| 情况 | 旧 brief、消息、文件结果、思考怎么处理 | 新内容怎么进入 |
|---|---|---|
| 同一 Session 接新任务 | 旧任务输入仍是旧 user 消息；旧交流、文件结果和 assistant 记录按历史恢复，没有按 taskId 自动清除或更新。`src/core/agent-runtime/execution-driver.ts:638`；`vendor/coding-agent/dist/core/ports/session_store/session-history.js:264` | 新任务重新准备成一条 user 消息；不是靠改 system 替换旧任务。`src/core/agent-runtime/execution-driver.ts:936`；`vendor/coding-agent/dist/app/composition/composition-root.js:88` |
| 等待回复后的 continuation | 原 Session 历史继续保留，原来让出的回复按已绑定消息身份取得。`src/core/agent-runtime/execution-inputs.ts:143` | 新 Run 的任务输入＋随后接受的回复 user 消息；**不是所有 continuation 都有 C3 brief**，C3 装配条件是 `run.requeueRef`。`src/core/agent-runtime/context-assembler.ts:1203` |
| requeue／返工 | 原历史按 Session 规则恢复，另外根据持久事实组装 brief；同 Session 已有历史时，brief 不再重复列已接受的 steer 和消息。`src/core/agent-runtime/continuation-brief-assembly.ts:569` | 当前任务输入末尾追加中文 brief，包含前次结果、工具事实、检查、返工原因、新输入、工作区检查点等。`src/contracts/continuation-brief.ts:356` |
| 被标为 interrupted 的旧 Turn | **整轮不进入模型历史**：包括该轮 user 输入、assistant 正文/思考、工具过程；原记录仍保留。brief 也不带该轮最后 assistant 正文，但会列已接受输入和工具事实。`vendor/coding-agent/dist/core/ports/session_store/session-history.js:243`；`src/core/agent-runtime/continuation-brief-assembly.ts:518` | 通过新任务输入和 brief 接着做。`src/core/agent-runtime/context-assembler.ts:1207` |
| 用旧历史播种新 Session | 读源 Session 从头到固定终止边界的原记录投影；没有做语义摘要。要求目标尚无历史、适配器相同。`src/core/agent-runtime/context-assembler.ts:848` | 源历史在前，新 Run user 输入在后；普通接续播种只作用于新 Session 的第一 Run，之后读取新 Session 自己的历史。`src/core/agent-runtime/execution-driver.ts:648`；`docs/refactor/design/orchestration-2026-10/DESIGN.md:996` |
| 归档来源的 requeue | 明确跳过旧线完整历史播种，仅保留事实链和带异常锚点的 brief。`src/core/agent-runtime/context-assembler.ts:904` | 新 Session 的当前输入＋brief。 |
| 秘书多个 Session | 当前通用 Query 根据选定 Session 读取该 Session 历史；没查到已经按第 6 片“请求归属”隔离历史的秘书专用装配。第 6 片另规定请求历史最多 10 轮、每个回答 2 KiB。`src/core/agent-runtime/query-execution.ts:498`；`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:129` |

历史“保留”不等于每次都完整发送：

- 超预算时，Kernel 依次移除 memories、reference skills、additional instructions、instruction skills，再移除旧 user 消息及完整 assistant＋tool 交换；**没有生成摘要，也不删除原 Session 记录**。最新 user 消息、不带工具调用的 assistant 消息、未闭合调用不在这套可删除分组中。`vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:30`、`:92`
- 因为运行中来信也追加为 user 消息，来信可以成为“最新 user”；这时当前任务 brief 所在的第一条 user 已不受该保护。这是上述两段代码共同决定的行为。`vendor/coding-agent/patches/core/runtime/reducer/run-state-reducer.ts:247`；`vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:32`
- 旧文件结果保留的是**当时工具返回的内容**，可能读取时就已按行数/字节数截断；没有在下一 Run 自动换成磁盘上的新正文。`vendor/coding-agent/dist/tools/builtin/read/read-tool.js:55`；`vendor/coding-agent/dist/core/ports/session_store/session-history.js:272`

文件改变后的可见性，目前有几种局部机制：

- 重新 `read` 会返回当前内容及 revision；`source_excerpt` 要求旧 digest，变化时返回 stale；`project_source` 支持当前文件、捕获版本、Git 版本、compare、verify。`vendor/coding-agent/dist/tools/builtin/read/read-tool.js:46`；`src/core/agent-runtime/exploration-tools.ts:190`；`src/core/agent-runtime/project-source-tool.ts:237`
- requeue brief 固定提醒“文件可能已经变化，编辑前先重新读取”，并比较检查轮、requeue、prepare 三类源码检查点；有变化也可能只能说明摘要不同，不能指出具体文件。`src/contracts/continuation-brief.ts:235`、`:463`；`src/core/agent-runtime/continuation-brief-assembly.ts:591`
- prepare 的工作区检查点来自**准备当时**解析出的工作区版本、源码 digest 和 Git 未提交路径；不是把旧 Run 的工作区视为当前状态。`src/core/agent-runtime/context-assembler.ts:791`
- Kernel 的 observed-path 集合属于本次创建的 WorkspaceSandbox；没查到跨 Run 保存“这个 Session 曾读过哪些文件及其版本，再逐一复验”的机制。基础 system 提到 `check`，但当前平台正常工具映射没有启用这个内置工具。`vendor/coding-agent/dist/app/composition/composition-root.js:56`；`vendor/coding-agent/patches/sandbox/workspace/workspace-sandbox.ts:337`；`src/core/agent-runtime/observed-model-run.ts:256`

digest 的绑定分三层，含义不同：

| digest | 绑定什么 |
|---|---|
| `inputDigest` | 完整装配后的任务输入字符串。`src/core/agent-runtime/execution-preparation.ts:296` |
| `continuationBriefDigest` | brief 对象的 canonical JSON；渲染文本含此 digest 标记。`src/contracts/continuation-brief.ts:190` |
| brief 内 `sourceDigest` | 某个工作区检查点的源码状态，不是提示词摘要。`src/core/agent-runtime/context-assembler.ts:824` |

输入和 brief 随 prepared manifest 保存；入口会复算 brief digest，并检查它确实是输入末尾的原样后缀。**同一个已经绑定的 Run 不会重新 prepare**，因此 prepare 后的变化不会悄悄改写这份输入。`src/core/agent-runtime/execution-preparation.ts:193`、`:305`、`:348`；`src/core/work-graph/tasks/execution-entry-service.ts:1261`

**C. 思考块**

Kernel 内部把思考保存为 assistant 的 `reasoningContent`，历史恢复和通用 context builder 没有按型号过滤它；只要消息仍在选中的上下文里，该字段就继续存在。`vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:471`；`vendor/coding-agent/dist/core/context/builder/context-builder.js:70`

| 提供方 | 历史轮次 | 同一 Run 工具循环 |
|---|---|---|
| DeepSeek | 非空 `reasoningContent` 原样映射成 `reasoning_content`；没查到按型号、最后一条 user 边界或历史轮次剥离的分支。`vendor/coding-agent/dist/model/providers/deepseek/deepseek-model-client.js:19` | 同样带回；`thinking` 开关与消息映射是分开的。`vendor/coding-agent/dist/model/providers/deepseek/deepseek-model-client.js:73`、`:95` |
| OpenAI | 映射 assistant 正文和 function calls，忽略通用字段 `reasoningContent`。`vendor/coding-agent/dist/model/providers/openai/openai-model-client.js:22` | 同样忽略；当前适配使用 Responses，`store:false`，没查到 reasoning item 的恢复/回传实现。`vendor/coding-agent/dist/model/providers/openai/openai-model-client.js:76` |

平台侧，**没查到自动把 reasoning 提炼成正式事实、交流消息或 brief 的流程**：Query 正式回答取 `message.content`，brief 的“最后助手输出”也只取 `message.content`。但是读取原始执行历史时，原记录中的思考字段可以作为历史数据返回；这与自动写成结论是两回事。`src/core/agent-runtime/query-observation.ts:147`；`src/core/agent-runtime/continuation-brief-assembly.ts:512`；`src/core/agent-runtime/graph-execution-history.ts:269`

第 6 片的 `ideas: {title, detail}[]` 是给用户看的方案选项，不是 Kernel reasoning 字段。`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:125`

**D. 缓存与顺序**

- **已有稳定排序，但没查到显式缓存控制。** 工具按名称排序，system 各组按 priority/id 排序；当前 OpenAI、DeepSeek 出站参数没有 `cache_control`、prompt cache key 或类似配置。两个适配器会读取返回的 cached token 用量。`vendor/coding-agent/dist/core/context/builder/context-builder.js:12`、`:112`；`vendor/coding-agent/dist/model/providers/deepseek/deepseek-model-client.js:64`、`:82`；`vendor/coding-agent/dist/model/providers/openai/openai-model-client.js:57`、`:76`
- **通常稳定内容在前。** Kernel system 和选中的行为 Skill 在前；任务、当前理解、文件摘录、提醒位于后面的 user 输入。当前没有把会变化的注记塞进 Kernel memory/system。`vendor/coding-agent/dist/app/composition/composition-root.js:306`；`src/core/agent-runtime/context-assembler.ts:1223`
- **任务输入内部有易变前缀。** role binding、工作区版本、目标理解、任务阶段在 selected inputs 和 continuation 前面；架构提醒还含“几分钟前”的相对时间。初始规划的约 8.4 千字符固定回答协议又排在具体问题后面。因此这些后部固定段落不能仅凭自身稳定就认为能跨请求共享前缀。`src/core/agent-runtime/context-assembler.ts:447`、`:556`、`:635`；`src/core/agent-runtime/architecture-reminders.ts:123`；`src/core/agent-runtime/query-preparation.ts:312`
- **system 前缀也可能变化。** Skill 的 source 标头包含正文 digest；更换 Skill、Host systemInstruction、工具授权，或预算裁掉 Skill，都会改变请求内容。没查到对这些变化的缓存命中保证。`vendor/coding-agent/dist/skills/loader/file-skill-loader.js:78`；`vendor/coding-agent/dist/core/context/builder/context-builder.js:20`；`vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:126`
- DESIGN 已要求 system/工具尽量稳定、注记放其后、按实际用量验证命中；这是设计要求，不是已经验证了第 6、7 片长期 Session 的缓存效果。`docs/refactor/design/orchestration-2026-10/DESIGN.md:1005`

**E. 提示词配置化**

**E1. 写死的提示文本**

下面按主动构造模型输入的**文本块**列出；长度是静态字符量粗估，不是 token 数，不含任务正文等插值。工具还会透传各业务服务的拒绝理由和异常原文，这部分没有逐句穷举，不能把下表称为“所有可达 tool-result 字符串”的完整清单。透传入口可见 `src/core/agent-runtime/communication-tools.ts:119`。

| 文本块 | 大概长度 | 位置 |
|---|---:|---|
| Work／Query 两段英文前言 | 各约 120／140 字符 | `src/core/agent-runtime/context-assembler.ts:73` |
| Runtime context、Goal、Accepted task、Footprint、Note index、Reminders、Selected inputs 等段落标签 | 每条约 7–20 | `src/core/agent-runtime/context-assembler.ts:58` |
| Runtime binding／Role specification 及 purpose、required materials、exit 等字段标签 | 合计约 250–350 | `src/core/agent-runtime/context-assembler.ts:447` |
| 五种角色 label/purpose；例如 “Execute the assigned task.” | purpose 每条约 25–49 | `src/core/agent-runtime/role-profiles.ts:19` |
| Goal、Task、Query focus、Plan summary 的字段标签及“未声明”“未定义”等 | 合计约 350–500 | `src/core/agent-runtime/context-assembler.ts:556`、`:635`、`:726`、`:735` |
| 当前理解来源、“需复查”“不能当现行结论”“还没有当前理解”“该更新了” | 每条约 3–30，另加动态内容 | `src/core/agent-runtime/context-assembler.ts:508`、`:521`、`:706` |
| missing input、no current execution record | 每条约 25–70 | `src/core/agent-runtime/context-assembler.ts:655` |
| Context omissions、“另有 N 条，用‘看’读”、attention 标头及省略提示 | 每条约 15–25 | `src/core/agent-runtime/context-assembler.ts:303`、`:350`、`:388` |
| 注记/异常未接入、架构提醒不可用 | 每条约 7–12 | `src/core/agent-runtime/context-assembler.ts:1068`、`:1093` |
| 架构提醒四类标签、相对时间、没有观测、省略说明 | 每条约 2–20，合计约百余字 | `src/core/agent-runtime/architecture-reminders.ts:26`、`:123`、`:188` |
| 待决定、待决来源未接入、归档中断待核对 | 每条约 10–40，另加引用 | `src/core/work-graph/views/context-extensions.ts:125`、`:135`、`:178` |
| 书记提醒“待审 N 条，该更新 N 条。锚点……” | 固定部分约 25 | `src/app/host.ts:1422` |
| 用户决定答复前缀“用户答复” | 4 字＋换行 | `src/core/agent-runtime/execution-inputs.ts:59` |
| 初始规划完整 JSON 回答协议及示例 | 约 **8,400** | `src/core/agent-runtime/query-preparation.ts:50` |
| 浏览器规划前言、完成策略/架构缺失说明、合法角色说明、用户请求标题 | 合计约 300–400 | `src/ui/views/execution/planning.ts:34` |
| 默认查询“请阅读当前来源并给出正式回答” | 约 16 字 | `src/ui/views/execution/query-flow.ts:224` |
| `[引用文件]`、`[引用选区]`、version/digest/source 包装 | 每段固定约 6–40 | `src/ui/views/conversation/goal-setup.ts:33` |
| 咨询消费指导：“Process the original received input…” | 固定约 250–300 | `src/business/workflow/consultation.ts:446` |
| brief 的固定“继续之前”四条说明 | 合计约 120 字 | `src/contracts/continuation-brief.ts:235` |
| brief 的段落、状态翻译、截断、终态和接续方式说明 | 多个短句，静态文字合计约数千字符 | `src/contracts/continuation-brief.ts:228`、`:254`、`:356`、`:544`、`:582` |
| 异常锚点说明、混合改动归属提醒、结尾提醒 | 两条主提醒约 35／30 字，另有若干短标签 | `src/contracts/continuation-brief.ts:496` |

工具描述及参数说明也属于写死的提示词：

| 工具／说明 | 大概长度 | 位置 |
|---|---:|---|
| 六个邮箱工具的 `Session mailbox: <name>` | 每个约 30–45 | `src/core/agent-runtime/communication-tools.ts:389` |
| 三个用户决定工具的 `User decision: <name>` | 每个约 30–45 | `src/core/agent-runtime/communication-tools.ts:499` |
| `find_related_sessions`／`read_session_card` | 243／181 | `src/core/agent-runtime/session-discovery-tools.ts:146` |
| `look_graph`／`find_graph` | 340／373 | `src/core/agent-runtime/graph-tools.ts:327` |
| 四个 whiteboard 工具描述 | 136／132／354／321 | `src/core/agent-runtime/whiteboard-tools.ts:434` |
| whiteboard 的 draft schema 解释 | 约 **3,200** | `src/core/agent-runtime/whiteboard-tools.ts:220` |
| whiteboard 其余参数说明：版本 pin、basedOn、reason、proposal、acknowledgement | 每条约 40–265，合计约 1,100 | `src/core/agent-runtime/whiteboard-tools.ts:194`、`:219`、`:227`、`:234` |
| `record_note` 的写法和行为规则 | 约 1,230 | `src/core/agent-runtime/note-tool.ts:223` |
| `project_source` 捕获、分页、读、比较、验证、释放说明 | 约 **2,370** | `src/core/agent-runtime/project-source-tool.ts:237` |
| `project_index` | 763 | `src/core/agent-runtime/exploration-tools.ts:177` |
| `read_source` | 200 | `src/core/agent-runtime/exploration-tools.ts:179` |
| `cpp_index`／`python_index` | 698／693 | `src/core/agent-runtime/exploration-tools.ts:186` |
| `code_index`／`source_excerpt` | 303／157 | `src/core/agent-runtime/exploration-tools.ts:189` |
| `list_files`／`search`／`symbols` | 155／203／225 | `src/core/agent-runtime/exploration-tools.ts:191`、`:198`、`:221` |
| list/search 的 prefix 参数说明 | 约 110／150 | `src/core/agent-runtime/exploration-tools.ts:191`、`:198` |
| 只读命令工具描述及三个参数说明 | 约 900＋190 | `src/core/agent-runtime/readonly-command-tool.ts:59`、`:332` |
| Kernel 补丁里的 shell 描述及参数说明 | 约 320＋145 | `vendor/coding-agent/patches/tools/builtin/shell/shell-tool.ts:18`、`:187` |

工具结果里还会出现主动编写的说明句：

- 探索工具的覆盖范围、只做文本分析、Python 解析器不可用、不可读/过大文件等说明，每条约 14–150 字符。`src/core/agent-runtime/exploration-tools.ts:58`、`:196`、`:208`、`:219`、`:231`
- 只读命令期间工作区改变的提醒，以及内存/进程上限尾注；主提醒约 130 字符，尾注约 9–20 字。`src/core/agent-runtime/readonly-command-tool.ts:46`、`:90`
- Kernel shell 的超时、非零退出、失败、取消及资源上限说明，多为十几到几十字符。`vendor/coding-agent/patches/tools/builtin/shell/shell-tool.ts:41`、`:116`、`:149`、`:180`
- 邮箱未就绪、记录不存在等固定错误，及业务拒绝原文。`src/core/agent-runtime/communication-tools.ts:136`

另有两点需要单独说明：

- **基础 system 虽不在补丁 TS 内，也不是外置资源。** 冻结 `dist` 中约 3,840 字符；内置 read/edit 描述约 216／211 字符，参数说明也写在冻结实现里。`vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:3`；`vendor/coding-agent/dist/tools/builtin/read/read-tool.js:121`；`vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js:121`
- `LOCAL_WORKBENCH_GUIDANCE` 约 430 字符确实写死在 TS，但当前只用于计算 Host template digest；本机 grant 的 systemInstruction 为 null，**没查到这段正文实际进入模型输入**。`src/app/runtime-configuration.ts:90`、`:103`；`src/app/host.ts:294`

**E2. 已外置的部分和覆盖能力**

| 外置文件 | 大概字符数 |
|---|---:|
| `resources/skills/platform-work/content.md:1` | 2,075 |
| `resources/skills/platform-secretary/content.md:1` | 1,853 |
| `resources/skills/platform-adviser/content.md:1` | 2,624 |
| `resources/skills/platform-scribe/content.md:1` | 1,798 |
| `resources/skills/platform-reviewer/content.md:1` | 521 |

这些正文和 `skill.json` 都列入 `runtime-assets.json` 哈希清单，边界检查会复算发布资产的 hash。Kernel 运行时的 loader 则直接读所选目录、计算正文 digest，并没有读取这张发布清单来限制可用 Skill。`runtime-assets.json:15`；`scripts/check-boundaries.mjs:236`；`vendor/coding-agent/dist/skills/loader/file-skill-loader.js:63`

**Host 可以覆盖，不限于随发布更新**：配置支持显式 `resourceRoot + enabledIds`；`bundle:'platform'` 才固定指向仓库的资源目录。Host 也能配置 `systemInstruction`，RoleSpec 的目的、职责和退出条件本身也是数据。`src/app/runtime-configuration.ts:53`、`:371`；`src/core/agent-runtime/execution-contracts.ts:138`；`src/core/agent-runtime/context-assembler.ts:454`

**用户设置界面没有查到对应编辑入口**：当前保存的模型设置主要是 provider、model、baseUrl、thinking、reasoningEffort；没有提示词正文、Skill 目录或模板选择字段。`src/app/host-settings-types.ts:9`

还有一个版本边界：prepared manifest 保存了任务输入、Role 解析结果和配置 revision；Skill 正文却在 Kernel 启动时重新读文件。Kernel 有返回完整配置的 `onConfiguration` 回调，但当前平台没有接它来保存整套提示正文。`src/core/agent-runtime/execution-preparation.ts:305`；`vendor/coding-agent/dist/app/composition/composition-root.js:283`；`src/core/agent-runtime/observed-model-run.ts:262`

**E3. 按模型切换的能力**

- 有 provider/model/options 配置，也能在一条可信 binding 中同时指定模型、Skill 和 systemInstruction；这是 Host 显式配对。解析 binding 的键是完整工作区＋Role 配置，**没查到依据 provider/model 自动选择提示词变体或上下文布局的规则**。`src/app/runtime-configuration.ts:44`、`:125`、`:360`
- 有 Role revision、legacy templateRevision、`s3-context-v1` 和 `coding-agent-v5` 等版本标识，但这些不是“按型号选择模板”的表。`src/core/agent-runtime/role-profiles.ts:26`；`src/core/agent-runtime/context-assembler.ts:55`；`vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:2`
- 提供方能力表只有 streaming、toolCalls、usage；DeepSeek 有 thinking/effort 参数，OpenAI 和 DeepSeek 使用不同 API 映射。没查到按型号定义的 reasoning 保留、工具描述变体或布局能力表。`vendor/coding-agent/dist/model/providers/registry/builtin-provider-registry.js:6`
- 本机确有按具体 DeepSeek 型号切换 context budget 的分支；它只改预算，不改提示词或排列方式。`src/app/host.ts:260`

**E4. 第 6、7 片及相关设计文档**

- **第 6 片写了输入内容和交互协议**：同请求排队输入原文合批；正式回答带 0 或 2–3 个 ideas；选项形成 followup；秘书输入包括工作区、目标列表、最多 10 轮请求历史和当前理解。**没查到要求这些提示词外置、可由 Host 配置或按模型区分的条款。** `docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:119`、`:125`、`:129`
- **第 7 片写了动作与输入顺序**：用户消息优先，其次等待回复/到期，再次 agent 消息；干预不自动消费等待；换手 brief 列出任务和理解指针。**没查到派活、等待、转交、干预各自提示模板的配置和模型适配要求。** `docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:116`、`:124`、`:171`
- **DESIGN 有缓存和未来压缩提示词要求**，包括稳定前缀、保留用户原话、来源、未完事项等；具体摘要提示词留给 K2 冻结前确定，K2 当前不算 MVP 门槛，不能据此认定第 6、7 片提示词合同已经齐全。`docs/refactor/design/orchestration-2026-10/DESIGN.md:998`、`:1005`、`:1027`
- **STRUCTURE-DRAFT 有固定八段、确定性字节和不同调用携带材料的安排**，没有按提供方/型号选择模板的要求；其中部分产品描述还是旧草案，不能替代已冻结分片规则。`docs/refactor/design/orchestration-2026-10/STRUCTURE-DRAFT.md:426`、`:441`、`:455`
- **AGENT-ROLE-ACTIONS 已明确把判断行为放进 Skill/Prompt，把模型、预算和 Skill 选择放进配置**；但没有展开成第 6、7 片可验收的模板目录、变量、覆盖范围和模型矩阵。文档也明确现有真实调用接通不证明语义可靠。`docs/refactor/AGENT-ROLE-ACTIONS.md:158`、`:160`、`:166`

**F. 缺口，按对第 6、7 片的影响排序**

1. **【施工前入规格】缺完整的提示词配置合同**：秘书、派活、等待、转交、干预的模板、变量、覆盖范围和版本要求尚未写明，当前仍有大段协议直接写在 TS。`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:129`；`docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:117`；`src/core/agent-runtime/query-preparation.ts:50`
2. **【施工前入规格】缺当前任务与新来信在模型上下文中的优先级和保留规则**：新来信成为 user 消息后，当前任务 brief 可以进入预算淘汰范围。`vendor/coding-agent/patches/core/runtime/reducer/run-state-reducer.ts:247`；`vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:32`
3. **【施工前入规格】缺秘书“请求历史”与完整 Session 历史的合并、去重和跨请求边界规则**：规格限制请求历史为 10 轮，但现有 Query 会恢复所选 Session 的历史。`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:132`；`src/core/agent-runtime/query-execution.ts:498`
4. **【施工前入规格】缺按提供方/型号确定提示词、布局和 thinking 回传的要求**：当前 DeepSeek 带回思考、OpenAI 忽略思考，尚无对应模型策略表。`vendor/coding-agent/dist/model/providers/deepseek/deepseek-model-client.js:28`；`vendor/coding-agent/dist/model/providers/openai/openai-model-client.js:27`；`src/app/runtime-configuration.ts:360`
5. **【施工前入规格】缺整套实际提示正文的冻结与重放边界**：任务输入有 digest，Skill 正文仍在 Run 启动时读当前文件，配置 revision 不等于保存了那次完整 system 和工具说明。`src/core/agent-runtime/execution-preparation.ts:305`；`vendor/coding-agent/dist/app/composition/composition-root.js:124`、`:283`
6. **【施工前入规格】缺 Session 接新任务时统一的文件时效说明**：旧读取结果会继续出现，已有版本工具和 requeue 提醒，但没有覆盖所有复用入口的旧文件复验规则。`vendor/coding-agent/dist/core/ports/session_store/session-history.js:272`；`src/contracts/continuation-brief.ts:235`；`src/core/agent-runtime/context-assembler.ts:1203`
7. **【施工前入规格】缺换手时历史到底带到哪一轮的明确上下文合同**：当前完整历史播种仅作用于接任 Session 第一 Run，归档来源又明确不播种，而第 7 片仅要求 brief 列任务和理解指针。`src/core/agent-runtime/execution-driver.ts:648`；`src/core/agent-runtime/context-assembler.ts:904`；`docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:176`
8. **【施工前入规格】缺提示内容与实际工具清单的一致性要求**：基础 system 要求使用 `check`，当前正常平台工具映射却没有该工具。`vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:14`；`src/core/agent-runtime/observed-model-run.ts:256`
9. **【后续实测缺口】缺第 6、7 片长期 Session 的实际缓存与语义可靠性证据**：已有稳定排序和缓存计量读取，但设计仍要求按真实用量验证，已有行为 Skill 的真实调用记录也明确不证明语义可靠。`docs/refactor/design/orchestration-2026-10/DESIGN.md:1009`；`docs/refactor/AGENT-ROLE-ACTIONS.md:160`