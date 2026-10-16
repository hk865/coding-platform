# 4B 片的执行证据（2026-10-16）：查找和新鲜度

**是什么。** [第 4 片规格](../../../design/orchestration-2026-10/slices/slice-4-SPEC.md)的 4B 部分（L9–L12、L19、L22、L23，§2 的全文端口、`NoteMemoryReadPort`、`NoteCheckPort`，§5 的 NE2、NE3 和 T-01…T-09、M-01…M-16；施工和验收中的限定见 §10）：
- RecordStore 的全文端口，两个后端：比较文字的规范化、两个码点的窗口、FTS5 表和它的代号、打开时重建；
- 核对端口 `checkNotes`：新鲜度（文件、定义、方案采用、依据注记退役）、来源不可用、作废、冲突、事实的解析、锚点状态和符号重解、第 5 类提示、相近注记；
- 六种读法：`lookup`、`neighbors`、`history`、`conflicts`、`find`（`'any'` 的算分排序和部分排序）、`stale`，游标、48 KiB、正文分页；
- 计划和目录的两个版本列表；
- 都挂在平台不可枚举的 `notes` 持有者上；只有后端，没有路由（4C 接）。

**结果。** 已合入（2026-10-16）。T-01…T-09、M-01…M-16 除 M-12（挪到 4C）都有测试；几处因为公开服务造不出来而跳过或没有测试，见 `lead-acceptance.md`。没有调用真实模型。

## 经过

| 轮 | 说明书 | 报告 | 用量（DSH 主会话） | 要点 |
| --- | --- | --- | --- | --- |
| 通读 | `books/s4b-preread.md` | `dsh/preread-final.md`（事件记录截在 8,000 字） | 232 秒，335 万 token | 报出端口类型放不下排序、目录原因读不到、“该更新”没有来源等；lead 答复 P1–P14，写进 `books/s4b-impl.md` 第 10 节 |
| 1 | `books/s4b-impl.md` | `dsh/final-1.md` | 6,057 秒，1,826 万 token | 25 行做了 24 行（M-12 挪到 4C）；全量没有新失败 |
| 实现审查 | — | `codex/s4b-implrev.out.md` | Codex | “还不能合入”：15 条必须改 |
| 核实 | 子 agent 6 个（Claude，只读，决定 65） | `checks/verify-findings.json` | 约 118 万 token | 18 项都成立（第 13 条部分成立）；没有要用户定的产品取舍；lead 的裁定 R1–R16 |
| 2 | `books/s4b-impl-2.md` | `dsh/final-2.md` | 5,912 秒，906 万 token | 18 项全改，NE3 改走真实的 `platform.notes`、两个后端 |
| 快速核对 | — | `codex/s4b-quick.out.md` | Codex | “改完列出的几处再合入”：8 条必须改 |
| 3 | `books/s4b-impl-3.md` | `dsh/final-3.md` | 668 秒，1,761 万 token | 8 条全改；两条的测试造不出来（见验收） |
| 规模测量 | 子 agent（Claude） | `checks/measure-4b.mjs`、`measure-4b.out.json` | — | 第 1 轮的代码，2 万条注记，见验收 |

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
