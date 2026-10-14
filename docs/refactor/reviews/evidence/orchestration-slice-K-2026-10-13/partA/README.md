# K 片 A 部分的执行证据（2026-10-14）：关闭悬空 Turn，留在原 Session

**是什么。** [K 片规格](../../../../design/orchestration-2026-10/slices/slice-K-SPEC.md) A 部分（L1–L11、§5 的 KE1–KE4 和 KA 行；§9 M1–M9）：
- Kernel 加 `closeOpenTurn`（把没结束的 Turn 关成 `interrupted`，写 `run.interrupted`）和 `readTurnBounds`；
- Runtime 和 Workflow 在原 Session 关闭悬空 Turn 后接着做，关不了的退到新 Session；
- 平台维护对符合条件的退役线先试着关闭；
- 接续说明按 Kernel 身份读被中断那一轮的事实。

旧测试里要翻转的 14 个文件由 lead 先冻结（[kA-flip-decisions.md](../kA-flip-decisions.md)），DSH 的基线见 `checks/DSH-BASELINE.md`。

**结果。** 验收通过，按决定 44 合入本分支（提交见本目录所在的提交）。
- **测试：** 在 WSL 里用真 bwrap 跑全量，K 片 A 的副本 291 个文件、6,037 项全过（`checks/full-suite-4.tail.txt`）；合进当前分支（接线包 2、K 片 B 之后）的干净副本也跑了全量：300 个文件、6,190 项全过（`checks/merge-verify.tail.txt`）。
- **合并：** 三方合并没有冲突，80 个文件和验证用的副本逐个 blob 相同。
- **补丁和 dist：** 合入补丁的 sha256 见 `checks/merge-patch.sha256`。dist 由 `scripts/build-kernel-patch.mjs` 生成，`--check` 通过，没有手改。
- **模型：** 没有调用真实模型。

## 经过

DSH 四个新 Session；每轮之后，lead 用真 bwrap 跑全量，Codex 只读审查。

| 轮 | 说明书 | DSH 报告 | 全量（真 bwrap） | Codex | 要点 |
| --- | --- | --- | --- | --- | --- |
| 1 | `books/kA-impl.md` | `dsh/final-1.md` | 287 / 6,020 全过 | `codex/kAimplrev.out.md`（改完再合入） | 第一版：全部 KA 行，42 项新测试 |
| 2 | `books/kA-impl-2.md` | `dsh/final-2.md` | 290 个文件里 2 个失败，3 项 | — | 审查第 1–6 条和应改的测试行；DSH 的沙箱没有 bwrap，看不到这 3 项失败 |
| 3 | `books/kA-impl-3.md` | `dsh/final-3.md` | 291 / 6,035 全过 | `codex/kAimplrev2.out.md`（改完再合入，5 条） | lead 先做了诊断。D7：身份读不出时，重试或报“不可用”，从不退回旧事实。D8：上一个执行已有结束位置时，不再读 Turn 边界。D9：原因文字。D10：测试断言驱动停在哪一步 |
| 4 | `books/kA-impl-4.md` | `dsh/final-4.md` | 291 / 6,037 全过 | `codex/kAimplrev3.out.md`（只核这一轮改动：可以合入） | D11：只有同一 Session 的接续才扩大读取窗口。D12：事实来源从最近的祖先往外找。D13：测试只经公开入口，不造记录。D14：KA-05 断言具体的冲突。D15：归档断言 |

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
