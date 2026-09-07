# 开发日志与冲突报告 Logbook

```yaml
status: draft
updated: 2026-09-06
scope: Agent 开发流程中的运行时日志、并发冲突与复盘的显式记录；为书记/秘书/参谋层提供可记忆搜索的标记载体
```

## 目的

多个开发 Agent 并行（隔离 worktree 并不消除"同一共享文件上的追加竞态"——P1-05 × P1-06 首次撞上）时，时序冲突不仅是 git 问题，更是 **control-plane 的观测信号**：谁在何时、对哪些文件、做了哪类追加。这类事件本身需要：

- **显式记录**（本目录），与产品/验收证据分离但相互引用；
- **显式标签**（下方 front-matter 字段），供记忆检索 / 语义检索 / 协调者复盘；
- **可执行的教训**（机械合并规则 + 未来并行窗口的流程约束）。

## 索引

| 记录 | 涉及票据 | 类型 | 文件面 |
| --- | --- | --- | --- |
| [P1-05 × P1-06 合并面冲突](./conflict-reports/2026-09-06-p105-p106-merge.md) | P1-05, P1-06 | 并发追加 / 文本级合并冲突 | events.ts, ledger.ts, validation.ts |

## 记录格式约定

每个报告提供下列 front-matter 标签（记忆搜索入口）：

```yaml
id: <yyyymmdd>-<ticket-a>-<ticket-b>-<kind>
kind: conflict | incident | retry | decision
tickets: [P1-xx, P1-yy]
conflict_files: [path, ...]
resolution: mechanical | semantic-review | integrator-ruling
impact: <影响面>
state: closed | open
```

报告正文回答：发生了什么、双方各改了什么、为什么不冲突/如何解决、给并行流程的教训、后续如何预防。
