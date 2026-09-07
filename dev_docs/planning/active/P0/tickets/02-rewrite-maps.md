# P0-02：Rewrite maps

```yaml
status: completed
updated: 2026-09-04
kind: design-ticket
evidence_refs:
  - ../../../../verification/p0-documentation-evidence.md#p0-02
```

## Blocked by

- [P0-01 Archive source](./01-archive-source.md) — 已满足。

## What it delivers

把用户提出的多 Project/Workspace、Human Interaction、二维任务图、证据归约、架构演进和多 Agent 门禁写入当前地图。用一个查询/命令场景贯穿：用户从统一入口提出请求，平台从事实回答或提交 Command，Worker 只提交 claim，Controller 最终归约状态并由 Read Model 展示。

## Module / Interface refs

- [文档入口](../../../../../README.md)；
- [产品定义](../../../../../PRODUCT.md)；
- [领域词典](../../../../../CONTEXT.md)；
- [架构地图](../../../../../ARCHITECTURE.md)；
- [Task→Goal Completion Policy](../../../../interfaces/completion-policy.md)。
- [工作入口与系统结构图](../../../../design/agent-entry-and-system-map.md)；
- [用户需求原文](../../../../product/用户需求原文.md)，只作为意图追溯源。

## Acceptance

- README、CONTEXT、产品定义、总体架构、任务图和 P0 使用同一组权威术语；
- Todo/PlanMatrix 明确为投影，Worker/Reviewer 无权直接完成 Task；
- 目标变更、验证、人类裁决和 ArchitectureBaseline 演进均有唯一写路径；
- 当前设计仍明确标记 `draft`，没有把目标架构描述成已实现能力。
