# 2A 片的执行证据（2026-10-14—15）：决定队列只读要用的、不因数量多拒绝、能翻到底

**是什么。** [2A 片规格](../../../design/orchestration-2026-10/slices/slice-2A-SPEC.md)（L1–L11、§5 的 QE1–QE4 和 QA-01…QA-18；施工和验收中的限定见规格 §10）：
- RecordStore 加按顺序查找 `lookupOrdered`（两个后端；SQLite 的续读能在索引上定位）；
- 决定队列、任务卡、计划问题、请知悉的几个来源去掉“超过多少就报 `capacity`”的上限，按页读到底，整个窗口最多试 4 次；
- 自动返工、未送达回复的提醒按已看位置之后的提交位置读；
- 修了一处写入时丢掉 `since` 的地方。

旧测试里 lead 先冻结了 3 个文件的 5 项（R2A07 两个后端、R2A09、F07、M07，2A 以前都报 `capacity`），DSH 的基线见 `checks/DSH-BASELINE.md`。

**结果。** 验收通过，按决定 44 合入本分支（提交见本目录所在的提交）。
- **测试：** 合进当前分支（79032271）的干净副本，在 WSL 里用真 bwrap 跑全量：314 个测试文件、6,257 项全过（约 24 分钟）（`checks/merge-verify.tail.txt`）。
- **查询计划：** lead 按规格 D3 查了 12 种查法（三个排序索引 × 正倒序 × 有无续读和下界），都按索引前缀查找、不另排序；10 万行里深处一页和第一页一样快（`checks/plan-check-final.txt`，检查脚本 `checks/lead-plan-check.test.ts.txt`）。
- **合并：** 三方合并没有冲突，47 个文件和施工副本逐个 blob 相同。补丁的 sha256 见 `checks/merge-patch.sha256`。dist 没有改动，`build-kernel-patch.mjs --check` 通过。
- **模型：** 没有调用真实模型。

## 经过

施工前 DSH 先通读一遍说明书和规格（`books/s2a-preread.md` → `dsh/preread-final.md`），lead 把答复 P1–P14 写进第 1 轮说明书。之后 DSH 四个新 Session。

| 轮 | 说明书 | DSH 报告 | 用量（DSH） | 要点 |
| --- | --- | --- | --- | --- |
| 通读 | `books/s2a-preread.md` | `dsh/preread-final.md` | 225 秒，288 万 token | 报了 6 处看不懂、5 处矛盾；lead 找出基线文件里一处自己的错（F07 误列在 §A） |
| 1 | `books/s2a-impl.md` | `dsh/final-1.md`、`dsh/r1-group-H-report.txt` | 8,179 秒，149 万 token | 网络断了，第 1 轮中途结束：O、Q、H 三组做完，N 组没做完。lead 定了 R2（M10 的注入点挪到 Session 索引的查找，断言不变，重新冻结）、R3（两个存储边界的数据集作例外） |
| 2 | `books/s2a-impl-2.md` | `dsh/final-2.md` | 4,930 秒，604 万 token | N 组余下、整合、自查；DSH 沙箱全量只有基线 §A 的 150 项失败。lead 用真 bwrap 跑全量，两个规模测试在全量并行时超时（T1） |
| 3 | `books/s2a-impl-3.md` | `dsh/final-3.md` | 1,199 秒，2,709 万 token | Codex 实现审查（`codex/s2aimplrev.out.md`，改完再合入）的 M1–M7、S1、S2 照 lead 的裁定改，T1 统一时限 |
| 4 | `books/s2a-impl-4.md` | `dsh/final-4.md` | 1,103 秒，237 万 token | lead 查查询计划发现续读不能在索引上定位（`checks/deep-page-r3.txt`：深处一页 10.6 毫秒，第一页 0.1 毫秒）；改成排序列上只放一个下界和至多一个上界 |

DSH 合计约 3,990 万 token。第 4 轮之后 Codex 快速核对了第 3、4 轮的改动（`codex/s2aquick.out.md`，“改完列出的几处”）：lead 改了第 3 条（一个测试例子的值），另外两条不改，理由见 `lead-acceptance.md`。

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
