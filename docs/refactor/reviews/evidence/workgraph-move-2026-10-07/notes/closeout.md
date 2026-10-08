# Task D stage Closeout (decision 40): notes

Commit **df97cec7** on `feat/reliability-and-structure` (parent 0cd45508):
"docs: record task D as done (X1, X2, the DSH move and its checks) (decision 40)". 4 files, +29 −9. Not pushed.
Docs only; no code, no tests run (none needed for a docs commit), no DSH, no Codex, no product model. Ports untouched.
Worktree clean afterwards.

## What changed

- `docs/refactor/STATUS.md` (rewritten in place)
  - 当前状态: task D done (X2, X1, DSH two-stage move, byte-identical to the reference, 0cd45508); remaining =
    module-target.json step + 收尾; latest full suite on 0cd45508: 216 files / 5245 tests, same as 2ba9b46b, per-file
    counts identical; `verify:isolated` not run yet.
  - 已完成: three new rows after A.2 第 7 步: the recomputed proposal (688589cc, 6d5b3024, decision 40 d8cfa5b1);
    X2/X1 (d91208e3, 58ea2fdc; 140 files / 4548 tests; Codex xhigh ~10 min, 1.46M input / 1.33M cached, no findings);
    the move 0cd45508 (165 files +392/−392, 18 renames, 380 specifiers in 158 files, 12 path strings; checks;
    DSH 183 s / 1.00M / 26 calls + ≈205 s active (292 s wall, 87 s host sleep) / 1.17M / 14 calls = ≈6.5 min / 2.17M /
    40 calls; lead: DSH stage ≈56 calls / 47 min (≈37 waiting, 22 host sleep), bring-in ≈47 calls / 25 min (≈17 suite);
    X1/X2 and prepare stage call counts and the lead's tokens were not recorded).
  - 简化后的行数: X2 +2, X1 +28 service lines (computed: `git show --numstat` over src/ minus src/ui and
    work-graph/state; the move is 0 net), so 77,532 at 0cd45508 (checked with `wc -l` over the same file set). The
    area table stays at 7f137117 with the old directories; the final report recomputes with the new ones. The old path
    `tasks/contracts.ts` in that paragraph got "后者任务 D 后是 `model/task-contracts.ts`" (one of the 82 doc lines in
    stale-paths.md §2, so that list now has 81 lines in 12 files left).
  - 进行中: one sentence that the recomputed split was confirmed (decision 40) and task D is done.
  - 剩余: 1 = write the submodule rules into `module-target.json` (target.json, `tasks → architecture`, fix B; measured
    0 violations / 0 submodule cycles; strict 10-02 declaration only `model/plan-contracts.ts:19`). 2 = 收尾 with all
    old sub-items kept; the "check IMPLEMENTED-CAPABILITIES and module docs paths" item folded into a new stale-path
    sub-item (38 comments/titles: 24 wrong; 82 doc lines in 13 docs; history left alone; list in the lead's temp dir
    `taskd/stale-paths.md`); new sub-item for task D's evidence directory and the DSH-WORKFLOW cost entry (TASK-D-PLAN
    §8.5); the "无环" rule per decision 40 noted under the decision-31 check; the three D checks noted as done at
    0cd45508 under 行为没变. `verify:isolated` stays in "全量测试和 `verify:isolated`".
- `docs/refactor/HANDOFF.md`: appended "**2026-10-07 任务 D 完成（决定 32、34、40）：**" with 8 bullets at the end of
  the top section (after "决定 29 和第 7 步完成"), before "## 2026-10-05 …". Nothing above it changed.
- `AGENTS.md`: only the 批次状态 paragraph of the 2026-10-07 block: task D committed (X2/X1 commits, DSH, 0cd45508,
  full suite 216/5245); next = module-target.json step and 收尾. In the same paragraph "38 条决定 … 20–38" became
  "40 条决定 … 20–40" (HANDOFF's top section has had decisions 39 and 40 since 0f0512dc and d8cfa5b1).
- `docs/refactor/reviews/evidence/workgraph-split-2026-10-07/README.md`: a dated blockquote under the title:
  carried out, X2 d91208e3, X1 58ea2fdc, move 0cd45508 (byte-identical to the reference), the 58ea2fdc recount
  (totals the same; 23/357 instead of 26/354 because of X2), module-target step not done; the original
  "状态：提案，等用户确认" note kept below it.

## Facts checked before writing

- Commit times: d8cfa5b1 19:09, d91208e3 19:16, 58ea2fdc 19:21, 0cd45508 21:41.
- Numbers come from x12.md, prepare.md, dsh.md, bringin.md, stale-paths.md in this directory; nothing new measured
  except the service line count above.
- All four files keep CRLF on disk (autocrlf true); `git diff --check` clean.

## Not done (still open, listed in STATUS 剩余)

- `module-target.json` submodule rules (decision 40, separate step).
- `verify:isolated`; task D's evidence directory (`reviews/evidence/workgraph-move-…`) and the DSH-WORKFLOW cost entry
  (TASK-D-PLAN §8.5); the stale-path follow-up edits.
- `~/dsh-work/ladder/LTd-1` and `LTd-ref` still exist (kept for the evidence step).

## Lead effort

About 25 tool calls in about 15 minutes, all reading and writing; no machine waits.
