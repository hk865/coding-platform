# 注记查找提速第二轮的执行证据（2026-10-16）

**是什么。** 决定 66 的第二轮：SQLite 的每个查找索引只收自己那种记录。以前每个 `next_lookup_*` 索引给 `snapshots` 里的每一行都建了一项，不管是不是它那种记录。现在：
- 每个索引带 `WHERE <记录类型的字面量>`，条件和查询用同一个函数（`aggregateTypeTerm`）拼，列不变；
- 名字的后缀按规则版本、登记名和整段 DDL 算，DDL 一变名字就变；
- 打开时迁移：先在事务外列出现有索引，没事可做就不开事务；要做就在 `BEGIN IMMEDIATE` 里重列一遍，先删旧的再建新的，出错回滚；
- 删除规则（C′）让两套登记不同的后端能共用一个文件。

说明书 `books/s4g-impl.md`，lead 的裁定 `books/r2-lead-decisions.md`（R2-1 … R2-10）；设计和原型实测在 `design/`。

**结果。** 已合入（2026-10-16）。没有调用真实模型。

## 经过

| 轮 | 说明书 | 报告 | 用量（DSH 主会话） | 要点 |
| --- | --- | --- | --- | --- |
| 设计和原型实测 | — | `design/wf-design.md`、`design/wf-review.md`、`design/wf-measure.md` | Claude 工作流 | 在 2 万条注记的副本上用原型量过：索引 1,077 MiB → 38 MiB，54 种查询形状结果一样；查询里的记录类型必须是字面量（第一轮已做） |
| 1 | `books/s4g-impl.md` | `dsh/final-1.md` | 334 秒 | 裁定 1–6 都做了；4 个测试是锁住现状的特性测试（公开端口看不到索引） |
| 实现审查 | — | `codex/s4g-impl-review.clean.md` | Codex | “可以合入”；一条注释的建议，lead 改了 |
| 全量和实测 | — | `checks/` | lead | 见 `lead-acceptance.md` |
