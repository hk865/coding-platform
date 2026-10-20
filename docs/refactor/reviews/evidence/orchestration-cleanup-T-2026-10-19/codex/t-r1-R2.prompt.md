# T wave 1 rework 1 audit, group R2 (decision 80)

**Your files:** `./.lead-ref/groups/R2-files.txt` (`tests/work-graph`). Your diff is `./.lead-ref/groups/R2.diff`.
Group R1 audits production, `tests/helpers` and the other test folders in parallel; where a test here relies on a
helper there (for example `graph-session-fixture.ts` for B-10), read the helper too.

**Look hardest at:**

- **B-02** `A2-gate-chain-facts.test.ts`, `R3e-reverify.test.ts`: the R-4 deletions (is the refused state really
  unreachable, and is no current refusal lost that must stay as an A6 row?); the FORMAT seed at
  `A2-gate-chain-facts.test.ts:273-277` (`finalizedAt`, R-2).
- **B-08, B-09** `R4c-execution-history-index`, `R4c-execution-read`, `R4c-task-claim-concurrency`: the deletions
  (race, occupied slot, unmapped Run, the `planRef` rewrite) and the public chain end → requeue → claim → probe →
  archive.
- **B-10, B-11** `A1-session-lifecycle.test.ts` (public adopt, createGoal, propose, read, apply; a real archive chain)
  and `A1-independent-review.test.ts` (an R-4 deletion; cover `plan-machine:670`).
- **B-12, B-13** `S3-context-inputs.test.ts`: IN04 and IN12 deleted under R-4; IN11, IN14 and three handwritten Run
  seeds kept BLOCKED. Are the reasons (`mailbox-service.ts:750`, `:1329`, `:1361`, `:1369-1382`;
  `evidence-service.ts:1070`; `run-state-service.ts:526`, `:538`) true? Could the shared real-Runtime steps
  (`tests/helpers/S2B-runtime-steps-fixture.ts`, now used by C1 for W1-13) reach an entered Run here?
- **W1-43** `S3-prepared-context-admission.test.ts`: the world now adopts its baseline through
  `adoptInitialArchitecture`. AD06 stays BLOCKED (lead-accepted); AD08 is on the base path (a product gap the lead
  holds as L-1). Check that every other test reaches the state it names.
- **W1-27** `R4b-session-directory.test.ts`: the two schema registrations added so the public adopt works (reply
  §9.6). Only what the public adopt needs?
- **W1-16** `S2B-r2-s-preentry-control.test.ts` (restored) and `S2B-32-task-timeline-fold.test.ts` (fold order (a)
  removed).
- **W1-21 BLOCKED** (lead-accepted): left in its wave-1 form?
- The renames and title fixes (W1-29, W1-34, W1-40, W1-42) and W1-28 `S5-request-candidates.test.ts` (the internal
  reads replaced by public reads).

## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This copy is T round wave 1 after **DSH rework 1** (HANDOFF decision 79-4, decisions 80 and 81). You audited the
merged wave 1 earlier (your answers are in `./.lead-ref/wave1-audit/`). The lead deduped them into a frozen finding
table, and DSH reworked from it in two segments, committed as one commit `T W1 rework 1`. You now audit only that
rework: the change from tag `w1-merged` to this HEAD. Your findings decide whether a rework 2 is needed (at most three
reworks in all). So report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **Your group:** `groups/<G>.diff` (the change against `w1-merged` for your files) and `groups/<G>-files.txt`.
  `base/` holds the `w1-merged` version of every changed file, at the same relative path.
- **What binds the rework:** `t-w1-findings.md` (the frozen finding table: §0 rulings R-1 to R-6, rows W1-01 to
  W1-44 and B-01 to B-15), `books/test-rule-sheet-v2.md` (binds the rows the table names; v1 elsewhere),
  `books/test-rule-sheet-v1.md`, `books/t-run-W1R1.md` (segment 1's run file: scope, deletions, conversions,
  production rules), `books/t-run-W1R1b.md` (segment 2's run file, with **the lead's rulings on segment 1**: R-6
  accepted for W1-19 and W1-01; W1-21, W1-25 and W1-26 AD06 accepted as BLOCKED for this rework; one FORMAT seed and
  two out-of-row files accepted). Where a row cites TP or TQ items: `books/t-items-TP.md`, `books/t-items-TQ.md`,
  `books/t-book.md`.
- **DSH's reply** (claims, not evidence): `replies/t-reply-W1R1.md`. §1 to §8 are segment 1, §9 is segment 2; where
  §9 changes a §1 result, §9 wins. The ledger `replies/ledger-W1R1-w1merged.txt` lists every REMOVED or LOOSENED
  assertion and every removed test; §9.4 maps each to a row.
- **Tests:** the lead runs the bubblewrap full suite separately. DSH's sandbox has no bwrap, so tests it lists as
  failing at `w1-merged` too are environment failures unless you show otherwise.

Find a row with `rg -n "^\| W1-13 " ./.lead-ref/t-w1-findings.md`.

## Check every hunk in your diff

1. **It belongs to a row.** It does what that row's fix says (with §0 and the lead's rulings in `t-run-W1R1b.md`):
   no more, no less. A hunk no row asks for is a finding, unless the reply lists it as an out-of-row file (§6, §9.6)
   and it is only what the row's change needs to compile or run. Say for each out-of-row change whether that is so.
2. **Rows claimed done.** The fix is complete. A row the reply calls done whose fix is missing, partial or different
   is a finding (类别 by its effect).
3. **Deletions.** Every ledger line in your files maps to a row that authorizes it (§9.4).
   - R-3 (tamper-only): check that no public step makes the prior state (`file:line`).
   - R-4 (unreachable): check the refusing check exists (`file:line`). If the row's claim is a refusal that a current
     check makes, it must stay as an A6 row, not be deleted.
   - A deletion of a current behaviour that no row names, or whose cover is gone, is 会出错.
4. **Kept assertions** stay exactly as they were, except the changes a row spells out. A weakened, loosened or
   re-pointed assertion is 违规. A test that now passes without reaching the state it names is 会出错.
5. **Conversions** (rule sheet v2 for the named rows, v1 elsewhere):
   - the handwritten state is really replaced by the public step the row names;
   - every helper is an allowed form (A1 to A7; A7 has exactly the three helpers v2 names);
   - no forbidden form remains (F1 to F12), including values the platform issues that the test rebuilt or invented
     (v2 A1, "Values the platform issues");
   - expected values come from the spec or a hand calculation, not from a source constant or the program's output.
6. **FORMAT seeds** (R-2): only the fields the current codec requires, with the value the current writer writes;
   nothing else changed; listed in the reply.
7. **Production** (rows W1-01 to W1-04; segment 1). Behaviour on current-format data does not change: the same error
   codes, texts, check order, field presence and stored bytes. Where a decoder now **requires** a field it used to
   tolerate missing (W1-02: `SessionOperationRecord.action.provenance`), find every current writer (`rg`) and show
   that each always writes it non-null. A writer that can omit it is 会出错 (give `file:line` and the input).
8. **BLOCKED parts** in your files (the reply's §2 and §9.2, and the lead-accepted ones above):
   - the part is left in its `w1-merged` or R-2 form, with no workaround (a workaround is a finding);
   - DSH's reason is true or not (`file:line`);
   - a public step reaches the state after all (name it, with `file:line`), or it is really unreachable today.

   The lead uses this to rule on them; it is not a finding unless DSH worked around the block.
9. **Test helpers' checks.** A helper change that makes a check accept more than before (for example a grant or
   template check that now accepts two values) must be what its row needs, and must not let a wrong input pass in any
   other importer. Name the importers it affects.

## Answer

1. **Findings table:** 编号 (`<G>-01` …) | 类别 | 位置 (`file:line`) | 行 (W1-xx / B-xx) | 问题 | 唯一改法.
   The classes:
   - **会出错:** behaviour on current data changes, a behaviour is left untested, or a test passes without exercising
     its claim. Give the concrete input and the old and new result.
   - **违规:** against the finding table, the run files or the rule sheet.
   - **不整洁:** works, but leaves something stale (a comment or note naming a deleted symbol, a dead import).
   - **建议:** optional.
2. **Per row:** one line per row that touches your files: `W1-13: OK` or `W1-13: <G>-nn, <G>-mm`.
3. **BLOCKED parts:** row | part | DSH's reason true? (`file:line`) | reachable by a public step? (name it, or
   "不可达" with the reason).
4. **The same findings as JSON**, in one fenced ` ```json ` block:
   `[{"id", "class", "file", "line", "row", "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
