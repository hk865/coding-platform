# Coding Agent、DSH 与 Pi 的关系

```yaml
status: researched
baseline_commit: a91cde6
jsonl_sha256: c863f322bddc7c21bfcd777ecedb35005fe7e06cb005b1416c2786f19fb6672f
updated: 2026-08-27
```

## 先说结论

Coding Agent **不是 DSH 或 Pi 的 fork，也没有依赖它们的包**。三者的关系是架构问题相似、取舍不同：

- DSH 更像可组合的 Agent 平台：插件、Profile、事件和能力接缝丰富；
- Pi 更像轻巧而好改的 coding harness：循环清楚，扩展、树形 Session、分支和压缩实用；
- Coding Agent 更像严格的执行内核：状态机、提交屏障、权限沙箱和恢复不变量更强调“失败时也说真话”。

我们的目标不是复制某一方，而是保留现有严格内核，吸收 DSH 的 Profile/Inbox/能力接缝，以及 Pi 的简单循环、内容块、会话分支和扩展体验。

## 同一问题的三种答案

| 问题       | 当前 Coding Agent                                             | DSH                                           | Pi                                                                  | 下一步选择                                                      |
| ---------- | ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| 持久事实   | required sink 写 SessionRecord；RunState 可由 AgentEvent 重放 | append-only Session 事件是事实源，多种投影    | Agent core 以内存状态驱动；coding-agent 产品另有 JSONL 树形 Session | 明确日志是唯一持久事实，RunState 是已验证投影                   |
| 扩展       | Hook + 静态 Provider/Tool/Skill Registry                      | Cordis 插件、Profile、capability seam         | TypeScript extensions、动态工具、事件总线                           | Profile 启动时组合并冻结；扩展有 install/start/dispose 生命周期 |
| 输入排队   | 每个 Run 直接接一个 Turn                                      | Inbox 与 splice 事件                          | steering/follow-up 队列                                             | 增加 durable Inbox，由 AgentDriver 串行消费                     |
| 上下文     | string message + 确定性选择器                                 | “模型可见就应被记录”，由事件投影上下文        | AgentMessage 到 LLM message 的转换，支持 content block              | 增加 ContentBlock 和独立 Context Projection                     |
| 压缩/分支  | 尚未实现                                                      | Session fork/seed/lineage                     | 树形 Session、branch、compaction                                    | 原日志不删；摘要作为新事实；fork 产生新 Session                 |
| 多 Agent   | 尚未实现                                                      | 每个 Agent 有 Scope/Session，可 fork 子 Agent | 核心不内置；subagent 以扩展示例提供                                 | Supervisor 管理独立子 Agent，不共享可变状态                     |
| 安全与恢复 | 强类型事件、Reducer、校验和、乐观并发、Sandbox                | 平台事件与插件能力丰富                        | 小而灵活，由宿主/扩展选择更多策略                                   | 严格内核不放松，灵活性放在外层                                  |

## 本地 JSONL 给出的证据

分析对象是 `agent_learn` 中解压会话的 `session.jsonl`，共 2,994 条记录、3,902,182 字节。关键统计：

| 记录                        |    数量 | 说明                          |
| --------------------------- | ------: | ----------------------------- |
| `turn/start` / `turn/end`   | 22 / 22 | Turn 边界完整                 |
| `step/start` / `step/end`   | 57 / 57 | Step 边界完整                 |
| `tool/call` / `tool/result` | 87 / 87 | 工具调用可以配对审计          |
| `agent/inbox/spliced`       |      53 | 运行中输入需要一等 Inbox 语义 |
| `assistant/chunk`           |     636 | 流式内容也进入事件历史        |
| `reasoning-chunks`          |     707 | 模型可见/产生内容有明确记录层 |

Header 还保存了 `parentSession`、`seedLength`、`delegationDepth` 和固定
`agentPreset`。这些不是装饰字段，它们回答了四个恢复问题：从哪里来、继承到哪里、嵌套多深、用哪套能力组合。

这份材料支持三个改造：

1. Session 增加 lineage 与 Profile 摘要；
2. 运行输入先进入可持久化 Inbox；
3. 模型上下文必须是日志的投影，而不能由无法恢复的内存偷偷拼接。

JSONL 中早期讨论把 Coding
Agent 描述为“RunState 是真相、日志只是副作用”，这与当前代码不完全一致。现在 required
sink 在 Reducer 前提交，恢复也重放 Session 中的 AgentEvent；更准确的说法是：**Session 日志是持久事实，RunState 是控制循环使用的已验证投影。**

## 可以借鉴，但不能照搬

### 从 DSH 借鉴

- Profile/Bundle 的组合思路；
- 一个 Agent 一个 Inbox；
- “模型可见即有日志依据”；
- capability 的 definition/provider/consumer 接缝；
- Session lineage、fork 和每 Agent 独立 Scope。

不能直接照搬插件总线到
`RuntimeRunner`。现有 Runner 的价值正是状态变化路径单一；动态能力应由外层 Profile 和 Driver 管理。

### 从 Pi 借鉴

- 保持 Agent loop 小、顺序清楚；
- `transformContext` / `convertToLlm` 一类显式上下文边界；
- steering、follow-up 和下一轮判断；
- ContentBlock、多媒体、树形 Session、branch、compaction；
- 低门槛扩展体验。

不能把产品 Session 的灵活行为直接混入内核状态。扩展可以提出请求或贡献能力，但不能绕过事件、权限、提交和 Reducer。

## 上游一手资料

- DSH：[Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[Session subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)、[Events](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md)
- Pi：[Agent types](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts)、[Agent loop](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)、[Session manager](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)、[Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)

这些链接用于确认当前实现；Pi 仓库中的 Harness v2 文档是提案，不当作已经实现的事实。
