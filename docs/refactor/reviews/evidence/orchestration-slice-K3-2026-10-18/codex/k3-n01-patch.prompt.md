Write one test, as a patch in your answer (decision 81-5). You stay read-only: do not write any file, do not run anything. This repository copy is tag `k3-g4b3-r10` (exported, no .git). The frozen row and its mutation are in `./.lead-ref/k3-final-freeze.md` (row N-01); background in `./.lead-ref/k3-final-list.out.md` (N-01) and `./.lead-ref/k3-final-recheck.out.md`.

**The row (N-01, 缺保护).** When the Workflow re-drives handed-over answers of command rerun requests, a saved answer that cannot be read must make the advance wait with an exact reason and write nothing (`src/business/workflow/workflow.ts:2758–2763`, then `:2789`). The old test of this was replaced in rework 10 by a ③ commit failure, which never reaches that branch. Add a new case to `tests/work-graph/B2-UR7-crr-answer.test.ts`, after the existing cases (around `:175`), running on both backends like the rest of the file, reusing its world (`:51` Workflow, `:87` dependencies, `:107` public reads):
- the public `answerDecision` saves ① only (the answer message), as the existing cases do;
- inject exactly one `unavailable` result at the Workflow's `decisionMessages.readDecisionAnswer` (a delegating wrapper over the real reader; only the first read of that answer fails);
- advance with `taskId: 'k3-20-a'` and the real answer refs;
- assert `status: 'ready'`, `value.state: 'waiting'`, `value.next: null`, and the exact reason string the code produces for an unavailable saved-answer read (derive it from `dispositionReadFailure` and its callers; write the literal, do not compute it from production code);
- assert through public reads that the request revision, the answer message revision and its application are unchanged.

**Rules.** Test rule sheet `./.lead-ref/test-rule-sheet.md` (v3): only public steps, fault injection by a delegating wrapper, backend seams; no hand-written records, no reading the database to check, no production constants as expected values. Only this one file may change. No new helpers in other files. Keep the existing cases unchanged.

**The check the lead runs (you cannot change it).** On `k3-g4b3-r10` the new case passes on both backends. With mutation M1 (in the freeze note) applied, the new case fails on the `waiting`/`next: null` assertion and on the reason assertion. The D1 ledger shows no weakening.

**Output.** First, three lines: the reason literal and where it comes from (file:line); the exact name of the new test; which assertion you expect to fail under M1. Then the patch: one fenced `diff` block, a unified git diff with `a/` and `b/` paths against `k3-g4b3-r10`, LF line endings, only `tests/work-graph/B2-UR7-crr-answer.test.ts`. If the row cannot be written through public steps and a wrapper, answer BLOCKED with the reason instead of a patch.
