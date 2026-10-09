# Read-only re-review: wiring package 1, the guided round on the Workflow handover

You review, you do not edit. Node is not available: do not run node, npm, npx or tests.

This checkout = commit 67dfee7a + the whole uncommitted implementation of "wiring package 1" (see `git status`).
A previous review of the same implementation (spec `docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md`,
§0 L1–L17 win; §3 W1-HO-01…04; §4.4; §7 rules) reported three defects in `src/business/workflow/workflow.ts`; an
implementer then changed ONLY that file. The state of `workflow.ts` BEFORE that round, as a diff against 67dfee7a, is
`D:/cxt/impl-w1-fx-msg/rv3-workflow-before-round.diff`; compare it with today's `git diff -- src/business/workflow/workflow.ts`.

The three defects:
- F1: `transferStepFor` pinned a CLOSED successor C→T `responsible` link as absent (revision 0); the owner compares
  `destinationLink?.revision ?? 0` (`src/core/work-graph/sessions/session-responsibility-service.ts` around line 476),
  so the transfer conflicted forever (select_work → W1-HO-04 recovery → same zero pin). Spec §4.4 item 5: 0 only when
  the link record does not exist.
- F2: a replayed `create_session` (same request performed again after its handover already committed) built the
  claim with the receipt's creation-time revision of C, so the claim was refused and the Workflow ended `waiting`.
  Spec §7 rule 2 / L10 and W1-HO-01 ("原回执重放时下一步按当时的事实重算").
- F3: a comment in case `start` said the re-prepare derives a new prepare request id (L4: the prepare id is the same;
  the following start id differs).

Check: (1) each of F1–F3 is fixed correctly and completely (any other path that still pins a closed successor link as
0, or still claims with a stale `create_session` revision, e.g. the W1-HO-04 recovery or the claim after a handover
step?); (2) the round changed nothing else in behaviour: §4.4 item 8 (no `deps.responsibilities` → exactly the old
behaviour, receipt revision used), HO09/HO10 (no continuation provenance → plain claim with the receipt revision),
the W1-HO-02/W1-HO-03 result mappings; (3) the new transfer to a C whose T link is closed: what does the owner do with
it (reopen, refuse, conflict)? If it refuses with a non-conflict code, the mapping goes to the claim — say whether any
loop or `waiting` remains possible; (4) the new read in `create_session` does not change the order of existing reads
in a way a frozen test would see (tests in `tests/business/WP1-continuation-handover.test.ts`, `R5c-workflow.test.ts`,
`A2-workflow-*.test.ts` that count `readSession` calls or inspect the claim pins).

Output (English): per item F1–F3 `FIXED` / `NOT FIXED` / `FIXED DIFFERENTLY` with file:line; then any new finding:
file:line, severity (must-fix / should-fix / nit), the spec rule, evidence, direction (no code). Verify every claim in
the code before reporting it.
