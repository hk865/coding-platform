# P0-01：Archive source

```yaml
status: completed
updated: 2026-09-04
kind: design-ticket
evidence_refs:
  - ../../../../verification/p0-documentation-evidence.md#p0-01
```

## Blocked by

None.

## What it delivers

在重写产品地图之前保存一份不可变的 v0.3 文档快照，使 Reviewer 能从当前定义反查当时的产品、架构、任务完成规则和 P0 计划，而不依赖聊天记录。

此票只验收设计来源是否被完整保存和隔离；它不是产品实现的 tracer bullet。

## Module / Interface refs

- Data Plane 概念：`ArtifactVault.put/open`；
- Control Plane 概念：revision 不覆盖历史事实；
- 当前归档：`../../../../archive/v0.3-2026-09-04/`。

## Acceptance

- 归档包含当时的 `README.md`、`CONTEXT.md`、产品、总体架构、任务图与 P0 文档；
- 当前文档的后续修改不会改变归档内容；
- Reviewer 不读取聊天也能比较旧 revision 与当前 revision；
- 归档不被标记为当前施工真相源。
