你是只读调研员。仓库就是当前目录（独立仓库根）。不要写任何文件，不要运行测试，不要建议改代码；只报“现在是怎样”和“缺什么”。每条结论带 file:line。用中文回答，平实语言。

背景：一个 Session 可能被复用（同一 Session 接后续任务、续做、requeue、用旧历史播种新 Session、秘书有多个 Session），任务和文件都可能在两次之间变化。用户想知道：任务、交流消息、读过的代码文件、模型的思考过程，分别放在模型上下文的哪里。lead 需要一张“现状地图”来对照。另外用户提醒：第 6、7 片（秘书主对话、派活/等待/转交/干预）对每个模型的提示词工程要求很高，提示词必须配置化，不要硬编码。

请回答以下六部分：

A. 现状地图：一次 Run 发给模型的输入由哪些部分组成，按实际发送顺序列出（工具定义、system prompt、角色指导/模板、behavior skill 正文、任务 brief/assignment、续做 brief、会话历史、收件箱/交流消息、读过的文件内容、思考块、各种提醒）。每部分：在哪生成（file:line）；放在 system、user 消息、assistant 还是 tool result；每轮重发还是只发一次；是否随 Session 持久化。重点看 src/core/agent-runtime/context-assembler.ts、continuation-brief-assembly.ts、execution-preparation.ts、communication-tools.ts、role-profiles.ts、src/app/runtime-configuration.ts、src/composition/create-platform.ts、resources/skills/，以及 Kernel 如何接收这些输入（vendor/coding-agent/dist 只读，和 scripts/build-kernel-patch.mjs 的补丁）。

B. Session 复用：同一 Session 接新任务、续做（continuation）、requeue、用旧 Session 已完成历史播种新 Session 时，旧任务的 brief、旧消息、旧文件读取结果、旧思考分别怎样处理（保留原样、截断、摘要、重放、丢弃）？新任务用什么形式进入（改 system 还是追加 user 消息）？文件在两次读取之间被改了，模型有没有办法知道（提醒、版本号、digest）？brief 绑定的 digest 和“prepare 时按工作区当时状态组装”的规则在哪里？

C. 思考块：Kernel 调模型时，历史轮次里的 thinking/reasoning 块怎么处理（原样带回、剥离、按提供方/型号区分）？工具调用循环中间是否原样带回？平台有没有把思考内容写进事实、消息或 brief？

D. 缓存与顺序：有没有为 prompt caching 安排稳定前缀（cache_control 或等价机制，可能在 Kernel 或提供方适配里）？有没有易变内容（任务、时间、计数、文件内容）排在稳定内容前面、会让缓存失效？

E. 提示词配置化：
  1. 列出所有写死在 TS（src/ 和 Kernel 补丁）里、会进入模型输入的自然语言文本：角色指导、brief 的段落标签和说明句、工具描述、提醒语、系统提示片段。每条给 file:line 和大概长度。
  2. 区分已经外置在 resources/skills/*（及 runtime-assets.json 的哈希锁定）里的部分；这些文件能否由用户或 Host 设置覆盖，还是只能随发布更新。
  3. 有没有按模型（提供方、型号）切换提示词或上下文布局的机制（例如模板 revision、Role 绑定、模型能力表）。
  4. docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md 和 slice-7-SPEC.md 里，对秘书和派活相关提示词有没有要求可配置、按模型区分；缺哪些要求。也看 DESIGN.md、STRUCTURE-DRAFT.md、docs/refactor/AGENT-ROLE-ACTIONS.md 里相关条目。

F. 最后列 3–10 条“缺口”，每条一句话，按对第 6、7 片的影响从大到小排，标出哪些是第 6、7 片施工前就该写进规格的。

不确定的地方直接写“没查到”或“不确定”，不要猜。
