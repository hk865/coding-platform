# 007 跨轮重复的工具调用号：记录时只改后一个，保留第一次和整条历史的唯一性

状态：采用（7D2 DKTID K1–K9，2026-11-10）
日期：2026-11-10

## 背景和约束

- Kernel 把整条 Session 历史的工具调用号当唯一键：同一条 assistant 内的重复在
  `vendor/coding-agent/patches/core/ports/session_store/session-history.ts:141` 被拒，
  整个历史前缀的最后一道检查在 `:492`。OpenAI 兼容服务可能每次回复都从 `call_0`
  起编号，所以同一条线的第二轮就会撞号。
- 平台已经把 callId 当身份：未知调用审查（`src/core/work-graph/tasks/unknown-call-review-service.ts:232`）、
  命令重跑（`src/core/work-graph/tasks/command-rerun-request-service.ts:1074`）、
  K2 压缩桩（`src/core/agent-runtime/context-history-facts.ts:274`、`:300`）、
  白板工具的 requestId（`src/core/agent-runtime/whiteboard-tools.ts:347`）、
  接续说明（`src/contracts/continuation-brief-render.ts:788`、`:966`）。
  任何方案都不能让这些身份变得有歧义。
- 冻结的 Kernel 检查是安全边界，不是可随手放松的校验；
  `tests/kernel/B2-history-public-export.test.ts:197` 把“跨 assistant 复用 callId 被拒”
  固定成行为。
- 这一篇只定“跨轮撞号怎么办”；同一条 assistant 消息内部的重复仍是模型协议错误
  （`vendor/coding-agent/patches/core/runtime/events/agent-events.ts:344–:346`），
  不在本篇放松。

## 选项

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| **A. 记录时只改撞号的那一个（选）** | 在 `assistant.message_completed` 提交前，用“目标 Session 已落盘 + 恢复前缀 + 当前 Turn”判断；撞号才改成 `<id>@<turnId>` | 保留第一次的 id、既有测试和调试可读性；整条历史仍唯一；模型看到的新 id 与持久化一致 | 要在 commit 点拿三份集合；Kernel 补丁 + 生成物 |
| B. 每个调用号都加 Run/请求前缀 | 所有 id 改成 `<runId>:<callId>` | 唯一性证明最简单 | 所有旧测试、请求记录、日志里的 id 都变；id 变长；没有额外收益 |
| C. 唯一性检查只管一轮之内 | 改 `assertTranscriptExchangeIntegrity` 的集合按 Turn 重置 | 改动最小 | 放松冻结的安全检查；平台按 callId 找结果会跨轮歧义；provider 可能拒绝同一条请求里的重复 id；`B2-history-public-export.test.ts:197` 必须改，违反 D1 |
| D. 平台侧在写请求前改 | Runtime 的 `runObservedModel` 改写 | 不动 Kernel | 请求记录、观察恢复、K2 桩各自看到不同 id；第二个副本；`recordQueryObservation` 的 callId 身份会漂 |

## 选了什么，为什么

选 A。它同时满足三件事：整条历史唯一（Kernel 检查不动）、平台的 callId 身份仍唯一
（撞号只在记录时改成新 id，之后所有人都读新 id）、旧测试和第一次出现的 id 不变。
B 是不必要的全局改名；C 放松了冻结检查；D 把同一个规则放到第二个地方，必然和
Kernel 的记录漂移。

K7 把查重集合补成“目标 Session 已落盘记录 ∪ 恢复前缀 ∪ 当前 Turn 已提交”。只取
`historyTranscript` 不够：`current_turn` 根本不恢复历史，压缩摘要也会把旧轮
transcript 移走；`current_turn` 的第二个 Turn 在旧树上甚至不读第一个 Turn 的记录。
集合在 `src/core/runtime/loop/runtime-runner.ts` 的提交点并一次；两个组合根只负责把
目标 Session 的记录带进来。

## 代价，以及因此要守的规矩

- **撞号规则只有一份：** `runtime-runner.ts` 的 `uniqueToolCallIds`。组合根、observer、
  QueryStageDriver 都不再改 id。
- **后缀用 `turnId`，不用随机数；** 同一份记录重放时必须得到同一个 id。
- **同一条 assistant 消息内部的重复不在这里处理，** 留给 `duplicate_id`。
- **第一次出现的 id 原样保留。** 这是为了不改变请求记录、观察恢复和 K2 压缩桩按原 id
  找结果的行为；不要因为“统一格式”把第一次也改掉。
- **旧数据不迁移；** 旧历史里的撞号由 `history_rejected` 的失败路径结束。
- **Work 的失败必须先补 entered 登记再走 observer。** Kernel 可以在任何模型请求之前
  自己写 `run.failed`；平台的 observer 只读 `entered`（`src/core/agent-runtime/execution-observation.ts:529–:534`）。
  `src/core/agent-runtime/execution-driver.ts` 的 entered 登记必须抽成 hook 和
  Kernel 返回后共用的一个步骤；否则 Run 会卡在 `starting`。
- **给人看的原因必须带稳定码和原始拒绝原因。** Work 的终态只保存 `failure.message`
  （`execution-observation.ts:128–:139`），所以 Kernel 的 `history_rejected` 失败
  `message` 里要同时有 `history_rejected` 和原始 `重复 ToolCall ...` 文本。

## 什么情况变了要重新考虑

- **某个 provider 对 `tool_call_id` 的字符集/长度有硬限制，** `@`/`#` 或加长后的 id 被拒。
  那时改成只含 `[A-Za-z0-9_-]` 的后缀，或把 provider 原 id 另存一个字段；不要恢复
  “每条都加前缀”。
- **平台某个消费者需要 provider 的原始 id（而不仅是本线的唯一 id）。** 那时在 Kernel
  记录里同时保留 `providerCallId`，但仍然只让一个 id 做身份；不要造第二套身份。
- **Kernel 的未来版本自己保证跨轮唯一，或 OpenAI 兼容服务不再从 `call_0` 起编号。**
  那时可以删掉 `uniqueToolCallIds`，但 `history_rejected` 的失败路径仍要留（旧数据）。
- **同一条 assistant 消息内部的重复也要被容错。** 那是另一条规则，要改
  `agent-events.ts:344–:346` 和 `B2-history-public-export.test.ts:197`；不要把它塞进
  `uniqueToolCallIds`。

## 来源

- lead 裁定 K1–K9（2026-11-10，7D2 DKTID；`ktid-rulings-1110.md`）。
- 任务书 `run-7d2-dktid2.md`；证据 `7d2-k2fix-reply.md:37–:44`。
- 决定 121-70（技术取舍记录模板）。
- 代码：`vendor/coding-agent/patches/core/ports/session_store/session-history.ts:119–:158`、`:313–:318`、`:432`、`:492`；
  `vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts:705–:712`、`:829–:839`；
  `src/core/agent-runtime/execution-driver.ts:873–:967`、`:1260–:1266`；
  `src/core/agent-runtime/execution-observation.ts:128–:139`、`:529–:534`；
  `src/core/agent-runtime/query-observation.ts:430–:438`、`:592–:611`；
  `src/business/workflow/query-stage-driver.ts:157–:159`；
  `src/business/workflow/workflow.ts:663–:667`、`:3196`；
  `src/core/work-graph/state/task-failure.ts:273–:278`、`:695–:708`。
