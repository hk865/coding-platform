# T wave 2: frozen finding table, rework 3 (lead, frozen 2026-10-20 19:00)

Sources, each finding checked by the lead against the rework-2 table and the code:

- **[C]** the Codex audit of rework 2, two parts (`codex2/t-w2r2a-P1.out.md`: rework 2, 14 rows; `t-w2r2a-P2.out.md`:
  W2b-20, which Codex had not seen): **0 findings** in either part;
- **[A]** the Claude audit of rework 2, two parts, each with an adversarial verifier (`checks/w2r2-claude-audit.md`;
  workflow `wf_46bc24aa-554`): 5 findings, 5 confirmed (不整洁 3, 建议 2);
- **[FS]** the bubblewrap full suite on `w2r2` (`checks/full-W2R2.txt`; running when this table was frozen; a failure
  in it is added below as a row of this rework).

This is rework 3, the last one (decision 81). All five rows are one- or two-line edits, so the **lead applies them**
in the clone `~/dsh-work/scratch/w2r2-A` (at `w2r2` = `c05c7d7`), as rework 1 planned for its **lead** rows; nothing
here goes to DSH or a subagent. Line numbers are at `w2r2`. Rulings R-1 … R-24 apply.

## 1. Rows

| 编号 | 位置 | 条目 | 问题 | 改法 |
|---|---|---|---|---|
| W2d-01 [A Pa-01] 不整洁 · W2c-01 | `tests/work-graph/S4C2-goal-triggers.test.ts:29` | T1-054 | The header says issued times are what public steps returned "(or a public task-timeline read)"; two of 3d's three times now come from the task-graph read (`:487`, `:523`, `:533-538`). | "(or a public task-timeline or task-graph read)". |
| W2d-02 [A Pb-01] 不整洁 · W2c-05 | `tests/composition/R3d-R3g-platform.test.ts:16`, `:53` | T3-038 | W2c-05 removed the only read that needed `PLAN_GOVERNANCE_RECORD_SCHEMAS` (`ProjectArchitectureBaselineActive`); the import and its spread in `inspectSchemas` are dead. | Delete the import and the spread. |
| W2d-03 [A Pb-02] 不整洁 · W2c-10 | `tests/composition/K-R-previous-turn-bounds.test.ts:88` | T3-036 | "The four assertions of the counted case, now under an absent seam": no counted case is left. | Say what the four assertions show: the brief is built from the recorded end. |
| W2d-04 [A Pa-02] 建议, adopted · W2c-14 | `tests/work-graph/unknown-call-review-list.test.ts:310` | T1-070 | W2c-14's own problem ("nothing shows the cursor sits after `decided`") is only half closed: the pending-only query filters `decided` out anyway, so a cursor wrongly after `pending` still gives `[later]`. | Continue the wider query (both open statuses, limit 2) with `wider.value.nextCursor` as returned: exactly `[later]`, `nextCursor: null` (a cursor after `pending` would return `decided` again). |
| W2d-05 [A Pa-03] 建议, adopted · W2c-02 | `tests/runtime/R4b-session-input-boundaries.test.ts:117` | T2-030 | The refusal frame's `code?: 'invalid'` lets a later row assert only `rejected`, the weak form W2c-02 removed; both callers pass the code. | Make `code` required. |

## 2. Not adopted

None.

## 3. Rework 3 result (`w2r3` = `9a69bdb`)

The lead applied all five rows in `~/dsh-work/scratch/w2r2-A` (commit `9a69bdb` on `c05c7d7`; 5 test files, +15/−6):
W2d-01 header wording; W2d-02 the import and spread deleted; W2d-03 the comment says what the four assertions show;
W2d-04 the continued wider query asserts exactly `[later]` and `nextCursor: null`; W2d-05 `code` required. Typecheck 0
errors; `R3d-R3g-platform` and `R4b-session-input-boundaries` 6/6; the cursor test 2/2 (memory, SQLite). Codex quick
check (`codex2/t-w2r3q.out.md`): 0 findings, each row OK with `file:line` (W2d-04: a cursor after `pending` would return
`[decided, later]`). `s9tb2M` fast-forwarded, tag `w2r3`. The rework-2 full suite (`checks/full-W2R2.txt`) is green; rework
3's files are covered by the merge full suite (`checks/full-TMERGE.txt`). Wave 2's reworks are closed (3 of 3).
