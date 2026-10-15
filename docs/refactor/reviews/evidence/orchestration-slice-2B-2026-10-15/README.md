# 2B 片的执行证据（2026-10-15）：执行计数、补算、活动日历、按时间读任务状态

**是什么。** [2B 片规格](../../../design/orchestration-2026-10/slices/slice-2B-SPEC.md)（L1–L17、§5 的 BE0–BE5 和 2B-01…2B-45；冻结时的限定和实测见 §10，施工和验收中的限定见 §11）：
- 执行结束时从 Kernel 记录算出每 15 分钟的步骤、编辑、改过的文件和用量，在结束执行的同一次提交里存成 `RunActivity`；
- 旧的、结束时没记下的由补算写同一种记录（Host 启动后自动补最近 14 天，更早的由人点）；
- 活动日历、每个执行的活动、轨道上的横条、按时间读任务状态（时间竖条）四个读取和五个路由；
- “执行改过的文件”换掉第 5 片的桩。

**结果。** 验收通过，按决定 44 合入本分支（提交见本目录所在的提交）。
- **测试：** 合进当前分支（5c7a3258）的干净副本，在 WSL 里用真 bwrap 跑全量：371 个测试文件里 370 个全过，只有 2B-09 的两项（真实 `shell`）没过；lead 改了这两个测试文件（夹具把工作区挪出存储目录；git 那一例去掉、取消写文件的拆成单独一条），用 bwrap 重跑 BE1 的 6 个文件、14 项全过（`checks/2B-09-bwrap-rerun.txt`）。产品代码在这之后没改（`checks/merge-verify.tail.txt`）。
- **合并：** 三方合并 没有冲突，125 个文件和施工副本逐个 blob 相同。补丁的 sha256 见 `checks/merge-patch.sha256`。dist 没有改动，`build-kernel-patch.mjs --check` 通过。
- **模型：** 没有调用真实模型。

## 经过

施工前 DSH 先通读（`books/s2b-preread.md` → `dsh/preread-final.md`），lead 把答复 P1–P12 和改过的分组写进说明书。和 2C 在两个副本里同时施工。

| 轮 | 说明书 | DSH 报告 | 用量（DSH） | 要点 |
| --- | --- | --- | --- | --- |
| 通读 | `books/s2b-preread.md` | `dsh/preread-final.md` | 244 秒，224 万 token | 工厂没起名、三个测试工具没导出、桩的使用者漏两个、第三批互相等路由 |
| 1 | `books/s2b-impl.md` | `dsh/final-1.md` | 9,785 秒，973 万 token | 45 行都有测试；约 25 个子任务。Codex 实现审查（`codex/s2bimplrev.out.md`）：12 条必须改 |
| 2 | `books/s2b-impl-2.md` | — | 中断 | 03:28 机器故障（WSL 内存耗尽），第一批做完一半时停下 |
| 2（接着做） | `books/s2b-impl-2b.md` | `dsh/final-2.md` | 4,233 秒，1,045 万 token | 加了内存限制；R1–R13 落实，2B-34 停下报告。Codex 快速核对（`codex/s2bquick.out.md`）：还有 5 处 |
| 3 | `books/s2b-impl-3.md` | `dsh/final-3.md` | 991 秒，1,884 万 token（大半是缓存读） | 最后 5 处 |

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
