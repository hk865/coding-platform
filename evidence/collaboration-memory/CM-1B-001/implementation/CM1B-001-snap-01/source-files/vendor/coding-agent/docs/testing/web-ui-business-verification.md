# Web UI、长会话故障与真实业务测试说明

```yaml
status: current
updated: 2026-08-27
scope: Web Session 可观察性、推理/工具协议、权限预算、上下文窗口和真实故障回归
```

## 本次真实故障是什么

Session `e21dd629-c7b2-4906-8867-ea5856890bed`
的任务是只读检查本地 coding-agent 并介绍项目。运行没有配置 deadline，7 次模型请求和 17 次工具调用均未达到上限；四次 shell 也都在人工批准后成功完成。因此“约 200 秒”只是包含人工审批等待的墙钟时间，不是 timeout。

真正终态是
`internal/runner_internal`：上下文选择器先保存所有待删除历史组的数组下标，删除第一组后数组位置发生变化，随后继续使用旧下标，最终让 assistant
ToolCall 与 ToolResult 失配。ContextBuilder 在下一次真实模型请求前检测到孤立 ToolResult，Run 因此失败。

修复后，裁剪组由稳定的 `messageId + callId[]`
表达；删除通过这些业务标识完成，不再依赖可漂移的数组位置。默认 `runtime.tokenBudget`
也从 32K 改为 1M，语义是当前模型路由的最大上下文窗口。模型窗口不同的部署仍应在配置中覆盖它。

Session `9b6f9a44-9300-4fc1-9270-d470744bffe8` 是另一类真实故障。它累计输入约 79,041
token，最后一轮输入约 24,906 token，远低于 1M；实际触发的是
`tool_calls: 25 / 24`。24 个已开始工具中 21 个是 shell，且模型多次使用宿主绝对路径或把 `/workspace`
传给只接受工作区相对路径的 read。修复因此不是继续扩大 Context，而是：正式系统提示明确路径与工具选择；补全 Tool
schema 描述；默认启用内置 Skill；把默认模型/工具上限提高为 64/128 并允许页面配置；UI 分别显示模型轮次、工具调用和上下文占用。

Session `b78cbd6b-3810-48fe-a355-8f08f0b02a06` 暴露的是可观察性问题。第一轮 assistant 的 `content`
确实为空，Provider 只在 `reasoning_content` 中说明准备执行
`pwd`，随后请求 shell；工具完成后第二轮才返回最终正文。因此旧页面既有结构问题（把所有正文追加到顶部“最终输出”），也有提示词问题（工具轮没有强制用户可见进度），但不能把历史记录里本来为空的正文误判为前端丢包。

修复后，正文和 reasoning 增量都携带明确
`requestId + chunkIndex + elapsedMs`，传输层不再合并 chunk；每轮 assistant 完成事件分别保存
`assistantText`、`reasoningText` 和
`progress/final`。页面按事件时间线创建消息节点，流式重绘安全 Markdown，最终回答出现在实际结束轮次。系统提示升级为
`coding-agent-v3`，要求每批工具调用前及工具结果后的下一步都使用普通 assistant 正文给出简短进度，并在广泛命令或可能存在并发修改时使用 check 对账。如果 Provider 仍返回空正文，页面会明确标记，而不会伪造内容。

## 自动测试到底测了什么

| 测试层                          | 实际执行内容                                                                                                                 | 对应真实业务                                                                                                      | 明确不证明什么                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `context-selection` 单元回归    | 构造三个长度不同的 assistant/tool 原子交换，一次选择中连续删除前两组，再交给真实 `DeterministicContextBuilder` 校验          | 精确覆盖本次“删除一次后下标漂移、后续配对损坏”                                                                    | 不调用模型、不访问文件系统                                                |
| `runtime-resilience` 集成回归   | 真实运行 `RuntimeRunner`，依次经历模型→单 read→模型→单 read→模型→双 read→连续裁剪→最终回答                                   | 对应人类让 Agent 连续阅读 README、配置、Runtime、Context 源码后总结项目的会话拓扑；旧实现会在第四次模型请求前失败 | ModelClient 和 read 结果是确定性测试桩，不证明公网 Provider 或磁盘权限    |
| `web-event-projection` 单元测试 | 投递“进度正文 + reasoning + shell + Markdown 最终回答”的两轮事件，核对消息字段、阶段、Token、次数、TPS、耗时和失败码         | 对应 `b78...` 这类“工具前中间回复 → 工具结果 → 最终回答”的真实运行拓扑                                            | 当前没有首 token 事件，TPS 是输出 token / 整轮模型耗时，不是纯 decode TPS |
| `web-run-manager` 单元测试      | 验证正文/reasoning 携带 requestId 与逐请求 chunkIndex，历史和在线订阅都保留独立 chunk，并覆盖配置、审批、取消和 API Key 脱敏 | 对应浏览器实时流和 SSE 重连回放时不串轮，以及 shell 任务级授权仍不扩散到 edit                                     | 不启动 HTTP server，不执行真实命令                                        |
| `m6-web-ui` HTTP 集成测试       | 启动真实本机 HTTP/SSE 服务，用两个 gate 分别释放 chunk 1/2，确认第二块未释放时客户端已收到第一块                             | 对应浏览器在模型完成前真实收到正文，而不是结束后一次性回放或前端打字动画                                          | 不替代浏览器视觉/可用性人工检查                                           |
| 强制 bwrap E2E                  | 真实 Linux namespace 中执行 read/edit/shell，验证隐藏资源、断网、timeout/cancel、孤儿进程和输出截断                          | 对应 Agent 在真实项目上执行命令和修改文件时的安全边界                                                             | 使用本地离线模型回放，不评价模型推理能力                                  |
| Provider smoke                  | 连接真实 DeepSeek/OpenAI endpoint，校验流式文本、ToolCall 协议和 usage                                                       | 对应生产模型连接与协议兼容                                                                                        | 无副作用 ToolCall 不覆盖完整编码任务；没有凭据的 Provider 不会被假装通过  |
| benchmark preflight/replay      | 校验 task/evaluator/trace/digest 稳定性和 base/oracle/near-miss 分类                                                         | 对应版本比较工具本身可信                                                                                          | oracle replay 不是模型成绩；真实 baseline 才是 Agent 能力证据             |

这里把测试桩和真实边界分开，是为了避免“全部绿灯”被误读。确定性 ModelClient 的价值是稳定复现 Runtime 状态机和数据结构故障；真实 bwrap 证明操作系统隔离；真实 Provider
smoke 证明网络协议；真实 benchmark 才评价模型与 Agent 的联合任务能力。

本轮还新增三条协议/业务回归：

- `model-stream`：验证 `reasoning_delta` 与最终正文分别聚合，并实时交给 Web 回调；
- `m5-providers`：验证 DeepSeek thinking + ToolCall 不再被拒绝，上一轮 `reasoning_content`
  会与 assistant ToolCall、ToolResult 一起进入下一次真实请求 body；
- `web-run-manager`：验证选择“本任务允许 shell”后，第二个 shell 审批请求会自动通过，同时仍要求上游 Policy 为每个操作产生独立请求；授权不会变成全局配置。
- `m5-composition-smoke`：验证真实 Runtime 把同一个模型请求 ID 同时交给正文与 reasoning 流，而不是由页面猜测当前轮次；
- `web-event-projection`：验证有 ToolCall 的 assistant 是 `progress`，无 ToolCall 的后一轮是
  `final`，两者正文和 reasoning 独立保存。
- `m3-tools`：验证 Git porcelain
  revision、非 Git 稀疏 fallback、Session 路径树与 workspace 基线对账；read、硬拒绝和 capability 缺失路径不会触发 revision。
- `m4-storage`：验证 SQLite Session
  append/recovery 语义；实现使用 revision 校验投影缓存，避免同进程长会话每次 append 全量重放。

## 本轮性能证据与快照取舍

在 336MB、13,118 个文件的真实 coding-agent 工作区：

| 路径               |                            修改前 |                                        修改后 |
| ------------------ | --------------------------------: | --------------------------------------------: |
| workspace revision | 6.4–10.5 秒，读取并哈希全目录内容 |    Git 主线 28–48ms；非 Git fallback 54–121ms |
| Sandbox 能力探针   |              前后各做一次完整快照 |                          24ms，不生成业务快照 |
| 空 shell           |             历史真实运行 21–53 秒 |            102ms；命令 8.6ms，前后对账约 93ms |
| read               |           历史真实运行 4.9–7.6 秒 | 不再生成 workspace revision，只做目标文件读取 |

Git 只负责高效基线，不取代 Sandbox。单文件 read/edit 仍用内容 SHA-256 和 O_NOFOLLOW 能力；shell 仍在 bubblewrap 中断网执行。Agent 内存只保留当前 workspace 基线、当前 Session 的路径覆盖树以及执行中的 before/after 临时投影；新基线替换旧基线。SQLite
recovery
checkpoint 每个 Run 最多保留最近 3 个，但生产路径暂不启用同步 CheckpointingEventSink，避免把派生快照重新放回每事件热路径。

## Web Session 里现在能看到什么

- Turn、模型轮次、工具调用次数；
- 模型轮次与工具调用的 `当前 / 上限`，以及可编辑的 64/128 默认预算；
- Provider 上报的输入、输出和缓存 Token；
- 总耗时、模型累计耗时、工具累计耗时和整轮 TPS；
- 最近一次模型输入相对于 1M 上下文窗口的占用；
- 工具名称、参数摘要、运行/成功/失败状态、单次耗时；
- 可展开的完整参数与有界命令/读取/编辑结果；
- 每轮 Provider 返回的 `reasoning_content`，并明确标注已保存、会在 ToolResult 后回传；
- 每轮用户可见 assistant 正文的流式输出；工具前的中间进度和最终回答按真实事件顺序分别展示；
- 标题、段落、强调、链接、列表、引用、表格、行内代码和 fenced code
  block 的安全 Markdown；原始 HTML 不执行；
- 当前系统提示词版本和正文、启用的 Tool/Skill、模型推理设置与预算；
- 审批的 effect class、Policy 原因/版本、workspace
  revision、失效时间，以及一次/本任务/拒绝三种选择；
- `category/code/message` 形式的精确运行失败原因。

运行轨迹只投影已经通过 required SessionSink 提交的 AgentEvent；推理流来自 Provider 的公开
`reasoning_content`，模型完成后随 assistant 消息进入本机 Session。Provider 不返回该字段时，界面会显示“本轮未返回”，不会伪造隐藏推理。

当前页面是“当前运行时间线”，并保存 Web 进程内供 SSE 重连使用的有界事件历史；它还不是完整的持久化 Session 浏览器。刷新页面或重启服务后，输入旧 Session
ID 并恢复会继续运行，但不会把 SQLite 中全部旧事件重建成历史界面。这是后续 Durable Session
Projection/Viewer 的独立工作。

## 人工如何验收

1. 运行 `npm run web`，打开 `http://127.0.0.1:4173`。
2. 选择 coding-agent 工作区，输入只读任务：“先说明下一步，再读取 README；看到结果后先总结发现，再检查 package.json；最后用 Markdown 标题、列表和代码块给出结论。不要修改文件”。
3. 展开“运行配置”，核对 system prompt、`read/check/edit/shell`、两个默认 Skill、1M
   Context 与 64/128 预算。
4. 确认每次模型请求都会增加“模型轮次”，DeepSeek 推理卡实时增长；其后出现独立的“中间进度”流式消息，再出现 read 卡片的名称、路径、状态、耗时和可展开输出。
5. 再运行一个需要多个 shell 的任务；第一次选择“本任务允许此工具”，确认后续 shell 自动通过，同时 edit 仍单独询问。审批弹窗应展示 Policy 原因和 workspace
   revision。
6. 在另一个任务中审批停留一段时间后允许一次。确认工具耗时只统计执行事件边界，任务不会因为人工等待约 30 秒就被误报为 timeout。
7. 人为给出非法 Provider 凭据，确认页面显示精确失败信息但不会回显 API Key。
8. 完成后确认 Markdown 最终回答位于最后一轮，而不是页面顶部；核对 Session
   ID、Token/TPS/工具次数和终态。失败时先展开最后一个模型或工具卡片。
9. 选择 Session 路径模式，读取一个文件后在外部修改它，再让 Agent 调用 check
   session，应报告该路径；选择 workspace 或 strict 后重复，确认 Git 主线对账可发现整个工作区漂移，strict 会让待审批的风险操作先失效并要求重新读取。

自动门禁使用 `npm run check`；真实隔离追加执行
`npm run test:e2e:bwrap`。真实 Provider 与 benchmark 需要对应凭据和干净工作树，不能用模拟结果代替。
