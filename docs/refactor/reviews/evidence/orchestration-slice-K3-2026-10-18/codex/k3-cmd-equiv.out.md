**建议 MVP 暂不加入临时的 LLM 等价判定调用。保留确定性拦截，先补齐“等价改写也能申请人工批准”的闭环；下一步优先做有界的语法解析与脚本展开。** 模型可以增加识别覆盖，但“模型认为安全／不等价”不能代替决定 57 要求的人类许可。

本报告基于 2026-10-16 检索和本地 `1e0b1383`，仅作研究与针对性设计评价，未修改文件、未运行测试或真实模型。

1．通常怎么做

从一手资料看，各家组合使用命令规则、沙箱、模型审查和人工审批；**风险分类与证明两个命令等价，是不同能力。**

| 工具 | 可核实的做法 |
|---|---|
| Claude Code | Bash 支持精确／通配／前缀规则；识别 `&&`、`;`、管道等，逐个子命令检查，任一命中 deny/ask 就处理；剥离部分包装器和环境赋值。官方明确：换调用形式可能绕过文字规则，规则不是程序级安全边界。[权限规则](https://code.claude.com/docs/en/permissions) |
| Claude Code auto mode | 使用独立分类模型审查动作是否符合用户请求；显式 ask 仍要求人工。2026-03 工程文章介绍过“快速过滤→深入判定”两阶段，并承认漏判；其具体模型和实现不能当作今天的固定配置。[当前模式](https://code.claude.com/docs/en/permission-modes)、[较早工程说明](https://www.anthropic.com/engineering/claude-code-auto-mode) |
| Codex CLI | 沙箱限制能力，审批策略决定何时申请；规则按参数前缀匹配，能解析的简单 shell 链逐段判断、取最严格结果。当前 Auto-review 将部分审批交给独立 reviewer，不审查所有沙箱内动作。[安全](https://learn.chatgpt.com/docs/agent-approvals-security)、[规则](https://learn.chatgpt.com/docs/agent-configuration/rules)、[自动审查](https://learn.chatgpt.com/docs/sandboxing/auto-review) |
| Codex known-safe parsing | **历史版本 `rust-v0.50.0`**：确定性命令／参数检查；`bash -lc` 的简单组合必须每段都 known-safe。不是调用模型判断。当前对应源码路径未取到，不据此断言现版白名单。[固定版本源码](https://github.com/openai/codex/blob/rust-v0.50.0/codex-rs/core/src/command_safety/is_safe_command.rs) |
| Cursor | 当前桌面支持 Allowlist、沙箱、Auto-review、Run Everything；分类器可只读查看脚本，官方明确其会误判、不是安全边界。CLI 另有 `Shell(commandBase)`、参数通配及 deny 优先规则。[桌面模式](https://cursor.com/docs/agent/security/run-modes)、[CLI 权限](https://cursor.com/docs/cli/reference/permissions) |
| Gemini CLI | Policy Engine 用前缀／正则及优先级产生 allow、deny、ask_user；shell 文档描述拆分 `&&`、`||`、`;` 后逐段验证。该 shell 页标注更新于 **2026-05**，且混有已废弃配置说明。[策略](https://geminicli.com/docs/reference/policy-engine/)、[Shell](https://geminicli.com/docs/tools/shell/) |
| OpenHands | SecurityAnalyzer 与确认策略分开。当前 SDK 的 `LLMSecurityAnalyzer` **直接读取动作中的 `security_risk`**；`ConfirmRisky` 默认要求 HIGH、UNKNOWN 确认，不能把类名理解为每次另调一个模型。[分析器源码](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/security/llm_analyzer.py)、[确认策略](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/security/confirmation_policy.py) |
| Aider | 对模型建议的 shell 命令询问是否执行；提供 `--yes-always` 等确认配置。本次未找到独立的命令等价裁判。[执行源码](https://github.com/Aider-AI/aider/blob/main/aider/coders/base_coder.py)、[选项](https://aider.chat/docs/config/options.html) |
| Cline／Roo | Cline 由生成命令的模型设置 `requires_approval`，结合自动批准开关；并非独立裁判。Roo 使用允许／拒绝前缀，最长匹配优先，同等长度 deny 优先，并检查危险替换语法；其文档更新于 **2026-05**。[Cline](https://docs.cline.bot/features/auto-approve)、[Roo](https://roocodeinc.github.io/Roo-Code/features/auto-approving-actions/) |

2．用模型判断：能补覆盖，不能承担许可保证

Llama Guard 主要分类内容安全，Prompt Guard 分类提示注入／越狱；它们没有直接提供“是否重复这项被用户禁止的动作”的能力，需要另定任务和评测。[Llama Guard 模型卡](https://huggingface.co/meta-llama/Llama-Guard-4-12B)、[Prompt Guard 模型卡](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M)

模型的价值是识别跨工具、跨脚本的相似效果。但命令由 agent 自己生成，注释、字符串、脚本内容都可能夹带影响裁判的指令。**2026-09 的预印本**已展示恶意 agent 对动作监控器实施提示注入；这不等于本仓库的实测失败率。[研究原文](https://arxiv.org/abs/2609.19587) 官方建议也采用护栏、结构化数据和工具确认组合，而非单一模型判断。[OpenAI 指南，现归入 Legacy](https://developers.openai.com/api/docs/guides/agent-builder-safety)

若以后做 C，我建议满足以下条件：

- **何时调用：** 无阻断项的 Task 不调用；A/B 命中直接进入人工许可流程。其余调用若不能确定排除重做，再交裁判。仅按 `npm`、`migrate` 等关键词筛选会漏掉包装脚本；“低风险／只读”也不是用户已许可的证据。
- **输入与输出：** 输入可信的原命令、处置与批准记录、拟执行命令、cwd、已保存的脚本依据；命令和脚本明确视为数据。判断“是否包含被禁止的重做动作”，而非严格的整程序等价。输出 `equivalent / not_equivalent / unsure`；不确定、超时、格式错误均阻断并请求人工，不能覆盖 `denied_final`。
- **回放：** 按 Run/工具 callId 保存输入指纹、阻断记录版本、模型／提示版本和最终 verdict；**落盘后才作执行决定**。回放先读原回执，不重新判、不重新读变化后的脚本、不再次消耗许可。调用已发出但 verdict 丢失时，不靠重问模型猜回原结果。
- **测试：** fake judge 覆盖三种结论、异常、超时、崩溃窗口、重复调用、许可并发消费；回放断言 judge 调用数为零。fake 能验证控制流程，不能证明模型识别率。

固定温度或 seed 不能充当回放协议；OpenAI **2023 年归档文档**也明确 seed 不保证相同输出，这里仅用作历史依据。[原文](https://developers.openai.com/cookbook/examples/reproducible_outputs_with_the_seed_parameter)

成本尚不能报实测值：未选模型、输入规模和部署。若每次假设输入 2,000、输出 100 token，单价分别为每百万 token 的 \(P_i、P_o\)，一次判定费用是 `(2000Pi + 100Po)/10⁶`。被筛入比例为 \(q\)，平均每条 shell 增加 \(q\) 次请求；被筛入的调用增加一次串行模型延迟。

**本仓库接线不是“钩子里加一次 API”。** 检查生产 `src` 后，Work、Query 均汇入 [`runObservedModel`](D:/cxt/s4b-search/src/core/agent-runtime/observed-model-run.ts:213)，携带 Run/Session；Work 还有[持久模型许可与消费](D:/cxt/s4b-search/src/core/agent-runtime/model-call-access.ts:41)。未发现独立平台裁判调用路径。[现有钩子](D:/cxt/s4b-search/src/core/agent-runtime/execution-driver.ts:766)目前检查 `read`，K3 shell 拦截尚属草稿。未来 C 宜由 Workflow 调度专用判定 Run/Session、Runtime 执行，钩子消费已保存的结论；需补预算、取消、恢复及状态记录，不能直接绕过现有调用链。

3．确定性方法能做到哪一步

[tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash)、[mvdan/sh（含 shfmt）](https://github.com/mvdan/sh)提供语法解析；[bashlex](https://github.com/idank/bashlex)可生成 AST，但其文档明确有算术表达式等限制。**解析器识别语法，不自动证明效果相同。**

以下是针对本案的设计建议：

- 用 AST 拆 `&&`、`;`、`|`、换行及嵌套执行节点；静态字符串形式的 `bash -c`／`sh -c`可有限递归展开。任何执行段命中就阻断整次调用；不能用字符串切割误把 `echo 'npm run db:migrate'` 当执行。
- 仅归一化能确定的字面量引用差异。环境赋值可在**保守阻断匹配**时忽略，但必须保留给人工看；不能据此证明等价或授权。简单 alias 只展开已有可信静态定义，不执行 profile、`eval` 来“查清”。
- 若已保存的 `package.json` 是 `"db:migrate": "npx prisma migrate deploy"`，展开后即可发现直接执行 `npx prisma migrate deploy` 重复了脚本主体。npm、pnpm、yarn 需要各自的解析规则。[npm](https://docs.npmjs.com/cli/v11/commands/npm-run/)、[pnpm](https://pnpm.io/cli/run)、[Yarn](https://yarnpkg.com/cli/run)

但 npm 还有 pre/post 脚本、PATH 和工作目录规则；npx 还可能选择本地或下载的包。因此脚本展开适合发现“包含同一动作”，不宜宣称全部效果相等。[生命周期](https://docs.npmjs.com/cli/v11/using-npm/scripts/)、[运行环境](https://docs.npmjs.com/cli/v11/commands/npm-run/)、[npx](https://docs.npmjs.com/cli/v11/commands/npx/)

B 也必须保存解析依据和版本：事后只读当前 `package.json`，不能证明崩溃时脚本是什么；缺历史依据应保留未知。动态变量、函数、生成代码、外部文件及运行环境变化，均超出简单展开的可靠范围。

4．对比与本次建议

下表是本仓库的工程判断，不是外部产品性能测量。

| 方案 | 能抓住什么／漏掉什么 | 误拦 | 代码与运行成本 | 对“人必须知道并允许”的作用 |
|---|---|---|---|---|
| A：当前文字规范化 | 相同文字及空白变化；漏包装、脚本别名和改写 | cwd 被忽略；引号内空白、换行被折叠可能合并不同语义 | 最小；无模型请求 | 只对命中项强制人审，其他依赖 agent 遵守 |
| B：A＋解析、脚本展开 | 常见链式命令、静态包装、已知脚本主体；动态代码仍漏 | 不可达分支、不同环境；两条脚本仅共享 `cd` 等准备段也可能误判 | 中至高；解析器、递归上限、文件快照及版本管理；无模型费用 | 扩大强制人审覆盖，不能保证任意等价识别 |
| C：A＋模型裁判 | 有机会识别跨形式、跨语言重做；仍会误判和被绕过 | 保守判定及 `unsure` 增加审批 | 接线成本高；网络、token、延迟和恢复记录 | 只能决定是否送人审，不能代替许可 |
| D：B＋C＋人工 | 覆盖最广，确定命中不能被模型推翻 | 叠加误拦，可用人工处置 | 最高；B 先处理，C 检查剩余项 | 分层增强，但仍不是任意程序等价的硬保证 |

**本次 K3：保留 A，修复批准闭环；B 作为下一步有界加固，C 等正式裁判基础设施和评测具备后再做。** 已有 bwrap 与[内存／进程限制](D:/cxt/s4b-search/src/contracts/resource-caps.ts:48)限制影响范围，但不能证明某项允许范围内的迁移没有被重复执行。

L19a 最需要修的是：它要求改写命令先请求，却在文字未命中时返回“可以直接跑”。建议 lead 修改以下句子：

| 草稿位置 | 建议修改 |
|---|---|
| [L466 入参](D:/cxt/s4b-search/.lead-ref/slice-K3-SPEC.v7.md:466) | 增加关联原阻断项的明确引用，使 agent 能申报“这是该命令的等价改写”。 |
| [L467 “没被拦…可以直接跑”](D:/cxt/s4b-search/.lead-ref/slice-K3-SPEC.v7.md:467) | 改为“未命中文字规则不代表已获重跑许可”；申报等价时照样建卡，并将拟执行形式纳入等待／拒绝期间的拦截。 |
| [L474 “规范化以后相同…放行一次”](D:/cxt/s4b-search/.lead-ref/slice-K3-SPEC.v7.md:474) | 区分阻断匹配键与批准绑定：许可只对应人看过的具体调用，保留原文、引用、换行及执行上下文；不自动覆盖整个等价类。既有先消费、后执行规则保留。 |
| [L478 卡面](D:/cxt/s4b-search/.lead-ref/slice-K3-SPEC.v7.md:478) | 同时展示原阻断命令、实际拟执行命令与原因；说明“自动识别仅覆盖文字规则，等价改写仍须申请”。同步 §0、L19、接续说明。 |
| [L480 拒绝范围](D:/cxt/s4b-search/.lead-ref/slice-K3-SPEC.v7.md:480) | 已关联的改写请求继承原阻断项的 `deny_final`，不能换文字重新申请。自治不得代答保持不变。 |

如果产品要求**任何等价改写都绝不自动执行**，A/B/C 都不足以单独承诺。需要把该 Task 中无法确定排除重做的 shell 交给人工，或收窄为受控的结构化动作；这是交互与能力边界的产品选择。

5．不确定与未查到的部分

没有查到上述产品提供通用命令等价保证，也没有本仓库真实命令分布上的误判率、费用和延迟数据。OpenHands 的[文档](https://docs.openhands.dev/sdk/guides/security)描述独立模型分析，但与本次读取的 SDK 类实现不一致，报告以具体源码为准。

Cursor 旧桌面 auto-run denylist 曾在 **2025-07** 被移除，不能与当前 CLI 的 deny 配置混为一谈。[历史公告](https://cursor.com/changelog/1-3) Codex 历史源码、Gemini/Roo 较早文档和研究预印本均已分别标明时间或范围；没有将它们当成现版全覆盖保证。