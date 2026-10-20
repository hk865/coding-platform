# T wave 1 rework 1 audit, group R1 (decision 80)

**Your files:** `./.lead-ref/groups/R1-files.txt` (production `src/`, `tests/helpers`, and every test folder except
`tests/work-graph`). Your diff is `./.lead-ref/groups/R1.diff`. Group R2 audits `tests/work-graph` in parallel; where
a helper here serves a test there (for example `graph-session-fixture.ts` for B-10), check the helper and say what
the test side must show.

**Look hardest at:**

- **Production (W1-01 to W1-04).** W1-02: every current writer of `SessionOperationRecord.action` writes a non-null
  `provenance`. W1-01: the narrowing cleanup in `src/app/startup-reconcile.ts` and the other listed sites removes only
  the legacy branch. The changes in `src/core/work-graph/state/run-machine.ts`, `session-availability.ts` and
  `src/contracts/run-activity.ts`: which row asks for each hunk?
- **W1-13** `tests/helpers/C1-mailbox-fixture.ts` and `S2B-runtime-steps-fixture.ts`: a real prepare and start, a
  supported provider, a scripted model and an A3 gate, as the row says. The new `host` grant and `withMailbox`
  options of the shared helper: is the default path (no `host`) really unchanged for its other importers?
- **W1-17 / W1-18** `S5-decision-fixture.ts`, `S5-queue-support.ts`: the fixture-only duty mapping is gone and the
  production `platform-adviser/s3.1` template is used. `S5-queue-support.ts` now accepts both `builder/1` and
  `platform-adviser/s3.1` in its mailbox Host grant check (reply §9.6): needed, and safe for every importer (check 9)?
  The importer edits in `S2A-planning-fixture.ts`, `K3-46-…`, `K3-UR7-…`, `S5-user-message-tools.test.ts`: only role
  bindings, no assertion changed?
- **W1-15 BLOCKED** `S2B-track-fixture.ts`: back to `w1-merged` except W1-37's comment. Is the comment now true of the
  code? Is DSH's reason (`execution-entry-service.ts:1921-1931`, `run-activity-service.ts:159-163`) true?
- **W1-10 BLOCKED** (WF01, `WP1-*`): is there really no public route or owner step that changes a Goal's objective or
  Workspace after creation, so `context_goal_changed` has no public cause?
- **W1-20, B-03, B-04** `tests/runtime/source-binding-migration.test.ts`: the memory and SQLite runs share one real
  backend and one A3 gate; the R-3 deletions are really tamper-only; B-04's ReviewWork base BLOCKED reason
  (`source-authority-reader.ts:156-159`).
- **B-08(a) BLOCKED** `tests/runtime/R4c-graph-history.test.ts`: the second Run is only claimed, not prepared and
  started. Is DSH's conflict between the test's own Kernel identity and the RunRef-derived one
  (`execution-driver.ts:618-621`, `:993-1008`; `run-machine.ts:875-878`, `:1250-1257`) real, or could the test take
  the identity the real start writes instead of binding its own?
- **W1-44, W1-35, W1-36**: `S1-archive-service-fixture.ts` (the hand-built second brief is gone),
  `S1-workflow-archive-fixture.ts`, the dead imports in `S2C-L-runs-support.ts` and `S2C-X-scale-fixture.ts`.
- **W1-12** `tests/composition/platform.test.ts`: the A6 `describe('rejects: …')` block and its import.

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
