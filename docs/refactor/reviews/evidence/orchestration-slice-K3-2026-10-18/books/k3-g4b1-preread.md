# Task: read-through before K3 group 4 session B1 (no code changes)


You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/k3-g4b1-impl.md`: the construction book a new session (coordinator mode, `./.dsh-ref/coordinator-mode.md`,
  no fixed limit on subagents, decision 76) will build from right after this.
- `./.dsh-ref/k3-g4b-rulings.md` (the lead's rulings for group 4 session B; this session uses ruling 1 and the
  "one Workflow step" part of ruling 4) and `./.dsh-ref/k3g4-facts.md` (Chinese; code facts from before group 4, line
  numbers older than this copy).
- `./.dsh-ref/k3-g4a-final.md`, `k3-g4a-rework1-final.md`, `k3-g4a-rework2-final.md` (what session A built, its "B left" list, and the two reworks; the lead accepted its UNSPECIFIED items, and the two 6b variants it dropped moved to this session).
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (L9, L17, L18,
  L19, L21's card entry, L22, L28, L29 rows 5, 5b, 10, 11; §3.2, §3.4; the §5.2 rows in book section 3).
- The 4C-2 session B pieces the book says to reuse: `createCollectionCardSource`
  (`src/core/work-graph/views/decision-read-model.ts`) and the note source (`notes/note-decision-source.ts`);
  `DecisionApplicationAdapter` / `decisionApplications` (`src/business/workflow/decision-actions.ts`);
  `PROOF_EVENT_DECODERS` (`src/core/work-graph/communication/decision-application.ts`).
- The code those touch: `unknown-call-review-service.ts`, `unknown-call-review-contracts.ts`,
  `state/unknown-call-review.ts`, the UCR codecs, `sessions/message-record-codecs.ts` (the answer indexes),
  `business/workflow/workflow.ts` and `contracts.ts` (the operation table, UR6/UR7/UR7b), `startup-reconcile.ts`
  (6b (c)), `continuation-brief.ts` / `continuation-brief-assembly.ts` (the disposition fields),
  `goal-decision-reader.ts` and `task-failure.ts` (`requeueConfirmed`), `create-platform.ts`.

## Report (under 900 words)

1. **Unclear:** every rule, ruling or row you could not implement without guessing; the question and the smallest
   options.
2. **Book, spec, rulings or facts file differs from the code:** a name, file, function, field or line that is
   different.
3. **Tests that will break:** existing tests you expect to fail after this work beyond the ones the book names, with
   file:line and why.
4. **B1/B2/B3 split:** any row assertion in book section 3 that needs the proposal round (B2) or L19a (B3), and any
   B2/B3 piece you think B1 cannot avoid.
5. **Plan:** your split into subagents (disjoint files; as many at once as the work allows) and a time estimate per item, and the
   production line estimate.
