# M2–M4 验证记录

```yaml
status: current
updated: 2026-08-26
scope: 当前自动测试覆盖、跨进程证据和真实隔离门禁
```

## 自动覆盖

- M2：model→tool→model、请求重试与
  `retryOfRequestId`、usage、模型流乱序/事件上限、上下文闭合组裁剪、Hook 修改后二次预算、只读并行回填顺序、取消、模型/工具限制、Hook
  pause/resume；
- M2：真实长会话拓扑连续删除多个不同长度的 assistant/tool 交换，使用稳定 `messageId + callId[]`
  保持配对，并在下一轮真实 ContextBuilder/Runtime 请求中完成而不是产生孤立 ToolResult；
- M2：required sink 多失败协调与超时、健康 required sink
  sequence 连续、best-effort 失败不改变业务终态；
- M3：路径穿越、最终文件和中间目录 symlink、fd 锚定访问、审批拒绝零副作用、审批等待期间 revision 变化、原子 edit、文件/workspace
  revision 区分、可信只读并行；
- M3：fake
  bwrap 验证 workspace 不暴露宿主路径，`.git`/`.env`/oracle 等路径被覆盖，以及 sandbox 缺失时 fail
  closed；
- M4：InMemory/SQLite 共享 create/append/read/conflict/idempotency/atomicity/checkpoint contract；
- M4：损坏最新 checkpoint 回退旧记录、当前 config/workspace 不兼容拒绝、active
  model 单次 interruption、pending tool 首次执行、running tool 先 `tool.outcome_unknown` 再
  `run.failed` （仅一次、不重放）；
- M6：工具状态矩阵（`pending/running/completed/failed/cancelled/outcome_unknown/abandoned`）——正常取消先落盘
  `tool.cancelled`（真实结果）再
  `run.cancelled`、并行组整体取消、并行组混合中断（协作取消保留真实结果、只有无结果调用标 unknown）、强制中断
  `tool.outcome_unknown(cancelled_while_running)`、多组崩溃恢复终态冲刷合成结果进 transcript、sink 失败不假装取消、合成结果可从恢复后的 transcript 投影为模型输入（Context
  Projection 路径就绪）；配套保障：`tool.started`
  落盘失败不执行工具（executor 调用数 0）、永不返回的工具不阻塞取消（有界 drain）、取消结果的部分写入 revision 进入 checkpoint；
- M4 跨进程：真实 edit 在 ToolResult 前崩溃时先记录 `tool.outcome_unknown`
  且不重放；真实 edit 与 checkpoint 已提交后崩溃时，新进程按最新 workspace
  revision 恢复并继续到 final，副作用、ToolCompleted 和 terminal 均恰好一次。
- 独立评审回归（`tests/review/`）：drain 只在取消后启动（未取消长工具不被截断）、生产恢复对账事件到达 observer/Web
  Projection、runner 路径 containment 与失败分类（YAML/JSON/信号/超时/
  external_dependency_missing）、跨进程恢复模型调用数 0。
- 场景任务包 CI：`tests/scenarios/scenarios.test.ts`
  断言 runner 能发现并校验全部场景、拒绝 base/ 与含 oracle 目录作为 workspace、`--from-base`
  生成隔离工作区，并运行受控完成 fixture 的真实业务验收（bug-hunt 完整实现通过、near-miss 被业务边界黑盒抓住、web-game 完成实现通过）。

完整门禁由 `npm run check`
执行 Prettier、ESLint、TypeScript、Vitest、构建、架构依赖检查和场景任务包校验。

## 环境说明

系统路径没有预装 bubblewrap；工程从 Ubuntu 包提取 bubblewrap
0.9 到被忽略的本地 tooling，并通过绝对路径显式启用。WSL 的 unprivileged
namespace 可用，`CODING_AGENT_REQUIRE_BWRAP=1` 强制门禁已通过：真实
`read → edit → shell → final`、network/隐藏资源隔离、timeout/cancel 进程树、孤儿进程和输出截断均有运行证据。缺少 capability 时仍 fail
closed，不会回退到普通子进程。

M4 的两条 SQLite + 真实 edit 跨进程恢复 E2E 也已通过。
