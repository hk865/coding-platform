# M6 验收与 Benchmark 验证记录

```yaml
status: openai_smoke_pending
updated: 2026-08-27
scope: M6 质量门禁、canary、结果协议、安全验收和剩余外部环境门禁
```

## 已完成

- `npm run check` 已纳入格式、ESLint、strict typecheck、全部测试、build、架构检查和 benchmark
  preflight；
- 本机 Web
  Session 已从简单状态文本升级为已提交事件投影，展示模型/工具轨迹、Token、缓存、整轮TPS、工具次数、模型轮次、耗时、上下文占用和精确失败码；
- 修复真实 Session `e21dd629-c7b2-4906-8867-ea5856890bed`
  暴露的连续历史裁剪下标漂移：默认上下文窗口改为1M，裁剪改用稳定 `messageId + callId[]`
  分组，并加入 Runtime 全链路业务回归；
- 新增真实 CLI child-process 固定回放：本地 DeepSeek-compatible SSE 驱动
  `read → final`、非交互 edit 拒绝和模型等待期间 SIGINT；
- 修复 SIGINT 竞态：调用方取消现在优先产生唯一 `run.cancelled`，CLI 稳定退出 130；
- 使用项目本地 bubblewrap 0.9 运行 `CODING_AGENT_REQUIRE_BWRAP=1`，M3/M5 共 6/6 E2E 通过，覆盖
  `read → edit → shell → final`、PTY 交互审批、隐藏资源、network、timeout、cancel、孤儿进程和输出截断；
- prompt-injection 验收证明公开文件诱导读取隐藏 oracle 时被 Policy 拒绝，秘密不进入 transcript 且工作区不变；
- CI 分成确定性门禁、真实 bubblewrap E2E 和 replay baseline artifact；
- 实现 strict benchmark task/trial/summary schema、结果分类、trace、diff、evaluator log 和汇总；
- 4 个 `internal-mvp@0.1.0` canary 均通过 base/oracle/near-miss/重复 evaluator 预检；
- 固定 oracle replay baseline 为 4/4 resolved。它只证明 harness 与 evaluator，不是模型成绩。
- 新增可重复的真实 Provider smoke：每个 Provider 固定执行 text 与不落地的 ToolCall，strict
  summary 只保存 commit/模型/预算、事件类型、usage 和内容哈希；
- DeepSeek 官方 endpoint 已在提交 `f2f8f4048322a0c9f92beb21164e6dd35a7c3b08` 上完成真实
  `deepseek-v4-flash` smoke（run
  `m6-deepseek-smoke-f2f8f40`，`thinking=disabled`）：text 为 9 个事件、input/output
  34/7；`record_smoke_result` ToolCall 为 15 个事件、input/output
  337/49，函数未执行，两个场景均 passed；
- 真实 baseline 现在拒绝 dirty worktree，并复用生产支持的绝对
  `CODING_AGENT_BWRAP_PATH`；避免把旧 commit 或缺少系统 bwrap 误记为可信成绩；
- 真实 baseline 排障修复了三个旧架构稳定性问题：模型侧 Tool
  schema 使用跨 Provider 保守子集且保持 object 根；当时 DeepSeek 临时固定
  `thinking=disabled`；Runtime `elapsedMs` 在墙钟回拨时保持单调，sandbox profile `bwrap-m3-v3`
  禁止 Python 字节码缓存污染工作区。当前协议已进一步支持保存并回传
  `reasoning_content`，因此生产 Web 默认启用 thinking + ToolCall；
- benchmark 子进程耗时改用单调时钟，metrics 层仍将异常负值 fail
  safe 为 0，避免系统校时污染严格结果 schema；
- 稳定基线已提交为 `a91cde6` 并推送到 GitHub `main`。
- GitHub Actions 的确定性质量门禁和 replay artifact job 已有实际成功记录；最初的 sandbox
  job 在测试前被 Ubuntu 24.04 AppArmor 的 user namespace 默认限制挡住。
- 分支提交 `1cdbdfc` 已固定 sandbox runner 为 Ubuntu 24.04、显式开启临时 runner 的 user
  namespace，并升级到当前官方 Actions 主版本；修复后的
  [run #3](https://github.com/hk865/coding-agent/actions/runs/32994978405) 三个 job 全部成功。

## DeepSeek 真实 canary baseline

正式成绩来自干净提交 `bbf1be112fa53a5878275d8262e66678cab5daed`：

| 字段       | 固定值                                        |
| ---------- | --------------------------------------------- |
| run        | `m6-real-deepseek-bbf1be1`                    |
| dataset    | `internal-mvp@0.1.0`，4 个合成 canary         |
| Provider   | DeepSeek 官方 endpoint                        |
| model      | `deepseek-v4-flash`                           |
| options    | `thinking=disabled`                           |
| prompt     | `m6-canary-v1`                                |
| isolation  | `bubblewrap-required`，network disabled       |
| 总结果     | 4 resolved，`resolvedAt1 = 1`                 |
| 非成绩错误 | agent/environment/evaluator/policy error 均 0 |

| 任务                        | 结果     | model/tool requests | input/output/cached tokens |
| --------------------------- | -------- | ------------------- | -------------------------- |
| `node-bearer-auth`          | resolved | 5 / 5               | 8339 / 822 / 6912          |
| `python-slug-normalization` | resolved | 5 / 6               | 8295 / 779 / 6784          |
| `recovery-exactly-once`     | resolved | 5 / 5               | 8303 / 819 / 6912          |
| `ts-nullish-timeout`        | resolved | 5 / 4               | 7315 / 558 / 6016          |

四项均由 Agent 在各自 30 秒固定预算内产生终态并通过 evaluator。前序 run
`m6-real-deepseek-7faa619`、`m6-real-deepseek-973ceb3` 和 `m6-real-deepseek-0b7024c`
含请求层/Agent/Policy 错误，只作为排障证据，不计入模型成绩；`m6-real-deepseek-dda8bdf` 的 3
resolved + 1 timeout 成绩已由当前最终候选 run 取代。

## 尚未关闭

- DeepSeek text 与无副作用 function ToolCall 已通过；当前仍没有
  `OPENAI_API_KEY`，因此 OpenAI 真实 text/ToolCall 尚未运行，双 Provider 总门禁仍不能勾选；
- 大规模约 40 个任务和外部 benchmark 仍属于 MVP 后扩容。

## 结果解释

`resolved` 和 `unresolved`
是任务能力结果；`agent_error`、`timeout`、`environment_error`、`evaluator_error`、`policy_violation`
分开统计。`agent_error`、环境、evaluator 和 Policy 错误不计为模型能力失败，但会阻止可信版本比较；
`timeout` 是固定任务预算内的能力结果。
