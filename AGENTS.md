# Agent Platform 产品代码根

```yaml
status: in_progress (P1-00)
updated: 2026-09-05
scope: 产品代码；规范与计划的权威位置是文档根，不在本目录
```

本目录是 Agent Platform 的产品代码。规范、计划、Ticket 与验收记录的权威位置：

- 文档根（规范与规划）：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform`
  - 工作 Agent 入口：[文档根 AGENTS.md](../../../mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/AGENTS.md)
  - 建项与派发：[project-location.md](../../../mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/agent/project-location.md)
- 当前实施票据：`dev_docs/planning/proposed/P1-foundation/tickets/00-contract-pack.md`（位于文档根）
- 交接与状态：[IMPLEMENTATION-HANDOFF.md](./IMPLEMENTATION-HANDOFF.md)

技术栈：TypeScript（NodeNext、strict）+ vitest；与执行内核 coding-agent 的工具链一致。
测试命令：`pnpm test`（全量）、`pnpm vitest run <路径>`（定向）、`pnpm typecheck`。
