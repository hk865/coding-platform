# P0-05：Proposed build DAG

```yaml
status: completed
updated: 2026-09-04
kind: design-ticket
evidence_refs:
  - ../../../../verification/p0-documentation-evidence.md#p0-05
```

## Blocked by

- [P0-04 First-slice contract pack](./04-first-slice-contracts.md) — 已满足。

## What it delivers

把 P1 切成一串用户可观察、失败可定位的 vertical slices，而不是先建完整数据库层、再建控制层、最后才接 UI。每一票都从 Command/Intent 或故障注入开始，以 View、Evidence、Handoff 或 DecisionBrief 结束。

## Module / Interface refs

- [P1 候选 DAG](../../../proposed/P1-foundation/DAG.md)；
- [P1 tickets](../../../proposed/P1-foundation/tickets/)；
- [评价门禁](../../../../evaluation/mvp-scenario.md)；
- 全部深 Module Interface 见 [P0-03](./03-module-dag.md)。

## Acceptance

- P1 DAG 无环；
- 每个实现 ticket 都包含 `Blocked by`、vertical outcome、Module/Interface 引用和可证伪验收；
- 第一票不依赖生产 LLM、真实 coding-agent、完整 UI 或远程基础设施；
- A→B 换手与双 Reader+单 Writer 是不同验收；
- Human Collaboration 和 Architecture Reconciliation 在基础闭环后接入，但仍贯穿到用户可见结果；
- DAG 边明确为开发先后，不被描述成长期架构 import。
