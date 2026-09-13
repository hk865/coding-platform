# 小范围偏好记忆：Hermes / OpenClaw 复用调查

状态：只读调查证据；研究日期：2026-09-12。委托：`CM-RESEARCH-MEMORY-REUSE`，来源为用户本轮对计划的纠正。本文支持 [PLAN](PLAN.md) / [READINESS](READINESS.md) 修订，不是实现 Ticket，不冻结本项目 Interface。未运行两个上游产品或测试套件；下文的“源码事实”表示已读取代码与测试定义，不表示在本项目完成运行验证。

## 1. 结论与调查基线

**[复用建议]** 首版采用少量可维护偏好与项目习惯，优先复用 Hermes 的记忆工具操作规则、容量与纠错经验，再采用 OpenClaw 的每次相关回话重新读取机制。没有证据支持将其中任一完整记忆子系统直接引入本项目；两个项目的记忆、运行身份、文件写入与 Context 生命周期都与本产品不同。无需为这个小闭环引入自动画像、embedding、知识图谱、后台 dreaming 或 Skill 自动演化。

**[用户已明确]** 本产品先是单用户、多项目。用户记忆默认跨项目，项目记忆默认隔离，经用户允许才跨项目引用或继承。用户明确要求记住／纠正，已经给出保存依据，不增加首次生效的二次确认。生效验收关注保存后的下一次相关回话，可以在同一 Task 的后续 Run；是否能进入同一 Run 的后续模型调用，取决于真实 Runtime 接入点，不能用“需要新 Task”替代。

| 来源 | 本次核实版本 | 本文采用的证据 |
| --- | --- | --- |
| Hermes Agent | `53c57871d67ee7d2202861aacc4ea0ef6ef93112`；通过官方仓库 `git ls-remote ... HEAD` 与 commit API 核实 | [官方记忆文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)、该 SHA 下的工具、存储、提示词及测试源码 |
| OpenClaw | `9e267031cd9d73aea91332f9245570ddd5bebef0`；同样核实 HEAD 与 commit API | [官方概览](https://docs.openclaw.ai/concepts/memory)、[用户模型文档](https://docs.openclaw.ai/concepts/user-model)、该 SHA 下的 bootstrap、模板、memory-core 源码与测试 |
| 本产品 | 本轮主计划的代码调查基线 | [当前模块状态](../../../../human/module-status.md)、[已有调用链证据](CURRENT-CALLCHAIN-EVIDENCE.md)；本次没有修改产品源码 |

在线文档会变化，因此关键实现判断使用下面的固定 SHA 链接。上游的 Session、turn、attempt 不自动等价于本产品的 Task、Work 或 Run。

## 2. Hermes：适合借用小工具语义，默认刷新策略不满足本需求

### 2.1 值得记录什么，以及如何增删改

**[源码事实]** `MemoryStore` 是有字符容量的两个文本集合：`USER.md` 保存用户信息，`MEMORY.md` 保存一般记事，默认分别为 1,375 / 2,200 字符。文件正文以分隔符组织条目；不是带独立身份、revision、scope、source 的领域记录。路径来自当前 Hermes profile 的 home。见 [存储及默认容量](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L66)、[目录解析](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool.py#L38)。

**[源码事实]** 单个 `memory` 工具支持 `add`、`replace`、`remove` 和 `operations` batch。新增精确重复内容为无操作成功；修改／删除通过唯一子串识别旧条目，多个不同匹配会拒绝。batch 在工作副本上逐项运算，以最终容量验证，通过后才持久化；失败返回当前条目／容量以便模型纠正。它没有语义去重或自动判断两句偏好矛盾的确定性算法。见 [工具入口](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool.py#L172)、[匹配与单项操作](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L214)、[batch](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L299)。

**[源码事实]** 当前工具 schema 要求少量高信号信息，排除临时进展、日志、容易重新发现的事实和原始大块数据；可复用程序进入 Skill。当前 `build_memory_guidance` 更进一步，把特定任务种类的习惯与纠正也导向相应 Skill，只将跨任务稳定事实保留在记忆中。它要求以陈述事实记录偏好，并解释不应让历史偏好覆盖用户当前请求。见 [当前 schema](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool.py#L262)、[当前筛选提示词](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/agent/prompt_builder.py#L161)。

**[文档与源码差异]** 在线记忆文档仍将项目规范、完成工作日记、有效技巧列作 memory 示例；当前源码的 schema 则排除完成工作日志，并把 task-specific 知识导向 Skill。不能把文档的广义示例与最新提示词拼成一套“已验证规则”。本产品近期项目习惯仍需要独立 project scope，不应为照搬 Hermes 而强制把它们全部改写成 Skill。见 [文档的记录范围](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/#what-to-save-vs-skip) 与上面固定版本源码。

### 2.2 明确记住、推测与确认

**[源码事实]** 通用写入确认开关默认关闭；打开后，前台 CLI 可以内联确认，其他入口或后台写入进入 pending。该开关按 memory / skills 子系统与前台／后台来源判断，没有将“用户明确要求保存”和“模型推测偏好”编码成两种 admission 类型。因此它不是本产品所需的完整接纳政策。见 [默认开关与决定](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/write_approval.py#L43)、[evaluate_gate](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/write_approval.py#L170)。

**[源码事实]** 即使通用开关关闭，当前无人值守 review 的 `replace` / `remove` 也被单独暂存为提案，`add` 仍可用。这是后台整理的额外限制，不是用户明确纠正必须再次确认。pending 保存函数自身注明是 best-effort；不得把其返回的 staged 当成本产品所需的可靠落盘回执。见 [后台删除保护](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool.py#L129)、[pending 写入](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/write_approval.py#L73)。

**[复用建议]** 借用前台明确操作和后台候选的区别；本产品直接接纳用户明确要求保存、更新和删除的适用偏好，模型推测记录为带来源的候选。近期不必建设自动推测机制；如果仅保留候选入口，也不能把未确认推测混入已确认偏好。具体 schema 由真实消费者验证后再定。

### 2.3 加载、刷新、多写者与版本

**[源码事实]** `load_from_disk` 捕获 `_system_prompt_snapshot`；工具修改 live entries 与磁盘，不改变该快照。`format_for_system_prompt` 读取冻结值，system prompt 组装消费该值。上游测试明确断言 load 后新增条目不出现在原快照。见 [load 与冻结](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L111)、[快照读取](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L340)、[prompt 接入](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/agent/system_prompt.py#L460)、[测试定义](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tests/tools/test_memory_tool.py#L273)。

这不表示写入后的当前模型一定忘记：工具调用与原对话仍可能在 Context 中。它表示无法用冻结快照机制证明“旧对话不再提供时，下一次相关回话仍读取刚保存的偏好”。普通回话刷新应借用另一种接入方式；特殊压缩／重建路径不作为本次保证。

**[源码事实]** 当前存储已有 `.lock` 文件，Unix 使用 `flock`、Windows 使用 `msvcrt`；锁内重读最新文件后计算修改，并经临时文件原子替换。读取失败会拒绝覆盖，外部格式漂移另有保护与备份。不能声称它“没有任何并发保护”。见 [文件锁](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L135)、[锁内修改](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L190)、[原子写入与漂移备份](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L394)。

**[官方运行限制]** 官方同时明确要求一个 Hermes home 对应一个 agent process，并建议其他 Agent 用独立 profile、共享记忆另接 provider。文件锁减少丢失更新，不解决多 Agent 对共同语义、范围与归属的冲突。该机制也不提供本产品的 Control 幂等命令、版本比较、授权撤销和消费者回执；`.bak` 不是完整修订链。见 [官方运行约束](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/#how-it-works)。

## 3. OpenClaw：回话刷新与简洁用户文件更接近需求，但完整插件较重

### 3.1 记录与纠正的使用方式

**[源码／模板事实]** `USER.md` 模板要求一条偏好一条行为指导，保留 observed 日期与 `active` / `superseded`；纠正时在原位置维护替换关系，避免同时保留互相矛盾的有效偏好。生成的 workspace 指令还要求写前读取，用户要求记住时写入相应文件。这里多数“值得记录”和“合并纠正”的决定仍由模型执行提示词，不是自动可靠的语义分类器。见 [USER 模板](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/docs/reference/templates/USER.md#L10)、[memory 维护指令](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/docs/reference/templates/AGENTS.md#L26)。

**[取舍]** OpenClaw 推荐 imperative directive，而 Hermes 当前提示词推荐 declarative fact。两边设计目的分别强调可执行性和避免旧记忆越过当前指令。对于本产品，可借用“单一有效偏好、来源与适用条件、纠正替代”的共同部分，渲染成明确的行为偏好，同时保持当前请求和正式规范的优先级。无需把某一种 Markdown 语法冻结成共享领域协议。

**[源码事实]** `memory-core` 注册的记忆工具主体为 `memory_search` / `memory_get`，另有 standing intent；其插件入口不是 Hermes 式简单 CRUD 仓库。`memory_get` 会委派到受约束的 `readAgentMemoryFile`，搜索有单独的索引、stale/partial/unavailable 结果。普通偏好文件编辑、curated promotion 与 forget 不是一个轻量独立工具的不同 action。见 [工具注册](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/index.ts#L269)、[读取入口](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/src/tools.ts#L565)、[工具 contract](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/src/memory-tool-contract.ts#L83)。

### 3.2 同会话下一次回话的真实刷新路径

**[源码事实]** `prepareEmbeddedAttemptBootstrap` 调用 `resolveBootstrapFilesForRun`，后者经 `getOrLoadBootstrapFiles` 每次重读文件，再比较内容与来源身份；未变化时可复用对象，变化则更新 session cache。默认 `contextInjection` 是 `always`。因此在默认、允许 bootstrap 的下一次 attempt / turn，长会话能看到 `USER.md` 文件更新，机制不以新 Session 为前提。见 [runner 接入](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/embedded-agent-runner/run/attempt-bootstrap-prepare.ts#L53)、[bootstrap 调用](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/bootstrap-files.ts#L322)、[每次读取的 cache](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/bootstrap-cache.ts#L44)、[默认模式](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/bootstrap-files.ts#L61)。

**[限制]** `continuation-skip` / `never`、轻量后台上下文以及独立 finalization 等分支会省略 bootstrap；不可把“每回话刷新”推广为所有模式、所有 provider 调用都自动重新编译。当前读取链也不足以证明一个已经运行的 attempt 内，每次工具之后都会再次加载 `USER.md`。同一 Run 的后续调用如需立即生效，仍需本产品明确检查点或 memory read/tool-result 接入，并验证最终模型输入。见 [跳过分支](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/embedded-agent-runner/run/attempt-context-engine-helpers.ts#L23)、[runner 例外](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/embedded-agent-runner/run/attempt-bootstrap-prepare.ts#L42)。

**[源码事实]** `USER.md` 有独立的 4,000 字符上限，同时受总 bootstrap 容量限制；它提供的是可裁剪注入，不是永不丢失必需偏好的保证。测试覆盖了第二次读取、内容变更和来源身份变更引起 cache 刷新，但本次没有运行这些测试。见 [容量实现](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/embedded-agent-helpers/bootstrap.ts#L89)、[注入时容量](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/embedded-agent-helpers/bootstrap.ts#L401)、[测试定义](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/bootstrap-cache.test.ts#L55)。

### 3.3 Scope、并发与后台复杂性

**[源码事实]** OpenClaw 以 Agent workspace 为 bootstrap 来源；执行项目的 `AGENTS.md` 可以在其后分层。另有 project annotation：带项目标注的 curated 条目只有在全部标注项目匹配 active project keys 时才保留；用户级偏好不应加项目标注。这个模式与“用户范围加项目范围”相近，但默认 workspace 身份不直接等同本产品的唯一用户身份。见 [来源分层](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/embedded-agent-runner/run/attempt-bootstrap-prepare.ts#L35)、[项目过滤](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/project-memory-bootstrap.ts#L26)、[写入范围指导](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/project-memory-bootstrap.ts#L159)。

**[源码事实]** Subagent、cron、群组等还受不同 bootstrap 文件过滤；本次看到 subagent 只保留 `AGENTS.md`。不能据 USER 文件已存在就声称秘书、参谋、书记、Worker 都自动获得相同记忆。它们在本产品必须有各自实际 Context 消费者和最少必要范围。见 [bootstrap session 过滤](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/src/agents/workspace.ts#L1334)。

**[源码事实]** memory-core 内部已有 workspace keyed queue、跨进程条件登记与锁主身份检查；curated 写入还有 preimage/hash 冲突检测、原子替换及对外部编辑竞争的说明。可借鉴并发案例，但这些锁建立在 OpenClaw plugin state 与宿主接口之上，不能推断所有 shell／编辑器／普通文件工具写入都服从同一锁。见 [workspace lock](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/src/memory-workspace-lock.ts#L119)、[curated commit](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/src/short-term-promotion-memory-write.ts#L167)。

**[源码事实]** 索引监视器跟踪 `USER.md`、`MEMORY.md` 和 memory 目录，变化标记 dirty 后调度同步；该异步索引路径与每 turn bootstrap 读取路径不同。小偏好闭环不需要先依赖 embedding/index 的新鲜度。见 [watcher](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/src/memory/manager-watch-ops.ts#L112)。

**[源码事实／范围建议]** 当前 OpenClaw 还包含 pre-compaction flush 和 dreaming。flush 提示只要求向每日文件追加，保持 bootstrap／reference 材料只读；它不是“下一次主界面回话直接采用最新已确认偏好”的替代。完整 dreaming、候选评分和知识 wiki 属于本轮已收缩的后续范围。见 [flush 提示构造](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/src/flush-plan.ts#L13)；高级能力仅按 [官方概览](https://docs.openclaw.ai/concepts/memory#dreaming) 记录方向，本次不把它们评为可整块复用的已验证模块。

## 4. 可以复用的具体单位与成本

| 候选单位 | 复用方式与理由 | 必要适配／不能照搬部分 |
| --- | --- | --- |
| Hermes `MEMORY_SCHEMA`、`MemoryStore.add/replace/remove/apply_batch`、匹配／容量测试案例 | 优先作为小工具语义和测试来源；可选取纯操作逻辑做有来源的移植 | Python 模块依赖 Hermes home/config/registry/threat scanner，原样 import 不适配 TypeScript 产品。唯一子串可作用户工具体验参考，产品权威修改需绑定稳定记录与当前版本；不得另立自由写文件权威 |
| Hermes `build_memory_guidance` 中“少量、稳定、可影响未来行为、排除临时日志”的准则 | 有选择地改写为本项目可审阅的筛选提示词 | 其“任务相关全部写 Skill”超出本轮范围；不要复制自动 Skill 写入、固定全会话快照或其容量数值为产品承诺 |
| OpenClaw `USER.md` 模板的单条偏好、日期和纠正替代方式 | 复用维护惯例和 UI before/after 场景 | 不照搬 imperative 最高权威；日期与文本 status 不足以代替 Control 的版本／授权；格式保持候选 |
| OpenClaw `bootstrap-cache`、runner 调用及刷新测试 | 复用“每次相关回话检查最新持久版本，未变才复用选材”的机制 | 本产品从 ContextCompiler 的真实消费者切入；不能将该文件单独复制后声称 Runtime 已支持同 Run 热注入 |
| OpenClaw project annotation / project filtering 案例 | 借用适用范围和用户偏好不归项目的测试思路 | 本产品用现有 Project/Workspace 与稳定本地用户身份；跨项目引用／继承仍需本产品授权，不以字符串标注取代权限 |
| 两者并发、冲突、重复／容量失败案例 | 转成本产品 Control/Vault 的集成失败用例 | 共享权威复用本产品 Ledger/Control；不再加一层独立文件锁数据库、第三方网关或第二套审批状态 |
| 整体 Hermes memory provider / OpenClaw memory-core 插件 | 暂不推荐直接依赖 | Hermes 与 Agent hook/runtime 绑定；OpenClaw memory-core 是 `private` workspace package，依赖宿主 SDK、state、LLM、索引与插件注册；拆出来并非“加一个 npm 包” |

具体依赖可见 [Hermes tool imports](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool.py#L7)、[Hermes store imports](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/tools/memory_tool_store.py#L6)、[OpenClaw package manifest](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/package.json)、[OpenClaw plugin host 接入](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/extensions/memory-core/index.ts#L225)。本次只确定值得进入后续适配验证的候选，未宣称已完成可编译提取。

**[许可事实]** 两个本次固定版本的根许可证均为 MIT，要求复制／实质性复用保留版权与许可声明。OpenClaw 还列有第三方 notices。实施时对实际选取文件及依赖逐项保留 notice，并记录 SHA、来源文件和本地适配；根 MIT 不意味着任意依赖都可省略许可核对。见 [Hermes LICENSE](https://github.com/NousResearch/hermes-agent/blob/53c57871d67ee7d2202861aacc4ea0ef6ef93112/LICENSE)、[OpenClaw LICENSE](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/LICENSE)、[OpenClaw 第三方 notices](https://github.com/openclaw/openclaw/blob/9e267031cd9d73aea91332f9245570ddd5bebef0/THIRD_PARTY_NOTICES.md)。

## 5. 对小纵向验证的建议

以下均为 **[待验证建议]**，不固定文件写入边界或强迫先建设完整记忆框架：

1. **实际消费者先明确。** 在主界面，用户要求“以后进度先说结果、少用术语”，保存后下一次相关回话读取当前版本。分别以秘书的接话、参谋的方案解释、书记的进度／阻塞反馈证明行为改变；角色由本产品既有角色机制表达，不为记忆另造角色系统。
2. **区分 Context 和持久记忆。** 同 Task、不同 Run 为必测；删除原始偏好消息或在压缩后重建输入，再检查仍采用当前版本。新 Task 是附加覆盖，不是唯一验收。若同 Run 后续模型调用没有重新组装机会，工具结果可让本次调用链知道成功，但产品应准确说明持久版本在哪个真实边界被重新读取。
3. **单用户、多项目。** 为同一个稳定本地用户建立用户范围，无需账户系统；切到项目 B 后用户偏好可用，项目 A 的习惯不可用；用户授权引用或继承 A 的项目习惯后再开放相应内容。引用跟随版本还是继承为独立副本，需要按已授权用途在后续真实消费者中明确，不自动复制全部项目记忆。
4. **纠正与适用条件。** 用户把“简洁”改为“设计解释详细、进度仍简洁”，只保留一致的当前适用偏好；旧版不再误导后续输入。项目规范、当次明确要求与用户偏好冲突时，按正式优先级处理并保留范围，不让总结文本覆盖规范。
5. **查看、删除、失败回执。** 用户可查看记住的内容、来源和范围，纠正或删除。保存失败不报告已记住；删除后下一次相关输入不再选择被删除内容。历史审计的保留与正文删除另按本产品决定，不能以旧对话已删除为由声称所有模型 Context 立即撤回。
6. **真实输入与并发。** 两个角色同时更新同一偏好时只接纳明确的当前版本，重复请求不重复新增；重启后继续可见。记录所选 memory revision 与最终 provider 输入，并用输出行为检验实际采用；仅 UI 显示已保存、文件存在或工具返回 success 均不足。
7. **复用可读性。** 小范围移植要能说明借用了哪些函数／规则、改了哪些宿主依赖、有哪组上游测试案例落到本产品。若提取成本逼近完整插件重建，继续采用最小规则与现有 Ledger/Vault 能力，不以“复用开源”名义引入第二套存储和调度。

自动提炼只需保留来源明确的候选提交方向：执行中发现值得积累的习惯可以提交，用户纠正可以直接更新；不必等阶段结束，也不必在首版启用自动画像或持续后台复核。结构化领域知识库、复杂经验提炼、Skill 自动修改／激活在当前小闭环之外，待实际使用提出稳定消费者再扩展。

## 6. 尚未证明的事项

- 未运行 Hermes/OpenClaw，未复现实模型偏好采用率；源码测试定义只能支持机制判断。
- 未提取独立可编译库、未估算迁移工作量；上表的“可复用”是已定位具体单位的适配候选。
- 未验证本产品同 Run 的安全注入点；不能由 OpenClaw 下一 turn 重读推导本产品可热注入正在执行的模型请求。
- 未证明文本提示词能可靠区分明确偏好、临时要求、推测与通用知识；小闭环应先覆盖明确表达，自动推测以后用样例集验证。
- 上游快速演进且存在文档／源码措辞差异；正式引入前复核选取 SHA、依赖与许可，不将在线 `main` 当作稳定接口。

本轮只增加这份证据文件，没有修改上游／产品源码、提交或推送 Git；计划整合由主代理负责。
