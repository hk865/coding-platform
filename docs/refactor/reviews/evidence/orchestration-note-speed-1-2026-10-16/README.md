# 注记查找提速第一轮的执行证据（2026-10-16）

**是什么。** 决定 66 的第一轮：4B 的注记查找去掉重复劳动、全文改在内存里扫、带锚点或路径前缀的查找只在那些注记里找。说明书 `books/s4f-impl.md` 第 4 节的 S1–S3：
- **S1 全文端口换成内存里扫。** 两个后端共用纯模块 `src/core/record-store/text-scan.ts`（行的派生、按前缀分桶的内存索引、扫描）。SQLite 另有 `sqlite-text-scan.ts`：每个全文索引一张紧凑表 `next_text_*` 和 `next_text_meta`，打开时按代号重建，旧的 FTS5 表在打开时删掉，读的时候按代际和游标追上别的连接的提交。`sqlite-text-search.ts` 删除。
- **S2 读模型。** 带锚点或路径前缀的 `find` 只在范围内的注记头里找；一次调用一份头缓存；已经读过的头和版本直接交给核对，核对不再重读；调用内的备忘；历史的确认读法不再是平方的。
- **S3 RecordStore 的读开销。**
  - 语句缓存：打开后自己跑过 DDL 就清空。
  - LIMIT 写成字面量：取不小于 `limit + 1` 的 2 的幂。
  - 查询里的 `aggregateType` 写成字面量（`sqlite-sql-literals.ts`），有一个扫源码的测试守着。

**结果。** 已合入（2026-10-16）。说明书要求的测试都写了，4B 的回归网照旧全过。没有调用真实模型。

## 经过

| 轮 | 说明书 | 报告 | 用量（DSH 主会话） | 要点 |
| --- | --- | --- | --- | --- |
| 设计 | `design/*.draft.md`、`design/*.review.md` | — | Claude 子 agent | 三块（全文端口、读模型、存储读法）各起草一份，各审一次；lead 合成 `books/s4f-impl.md` 第 4 节 |
| 书面核对 | — | `codex/s4f-bookcheck.out.md` | Codex | 说明书施工前的核对 |
| 通读 | `books/s4f-preread.md` | `dsh/preread-final.md` | 297 秒，560 万 token | lead 答复写进 `books/s4f-impl.md` 第 9 节 |
| 1 | `books/s4f-impl.md` | `dsh/final-1.md` | 1,531 秒，4,113 万 token | S1–S3 都做了；S2.7 的“一次调用只解码一次”按第 9 节顺延 |
| 实现审查 | — | `codex/s4f-impl-review.clean.md` | Codex | “必须改项完成并经快速核对前，不应合入”：8 条必须改、4 条建议 |
| 核实 | Claude 子 agent（只读，决定 65） | `checks/verify-findings.json` | — | 5 条成立，3 条部分成立，1 条不成立（第 7 条：命中读取的引擎错误和别的读口一样） |
| 2 | `books/s4f-impl-2.md` | `dsh/final-2.md` | 682 秒，1,866 万 token | F1–F7 |
| 快速核对 | — | `codex/s4f-quick.clean.md` | Codex | “改完列出的几处再合入”：3 条 |
| 3 | `books/s4f-impl-3.md` | `dsh/final-3.md` | 500 秒，762 万 token | 3 条都改了 |
| 全量和规模测量 | — | `checks/` | lead | 见 `lead-acceptance.md` |

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
