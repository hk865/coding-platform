# Task: K3 group 3, session 5 — two test findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once — strictly**, every vitest command `--maxWorkers=2`.
**Finish within 80 minutes** (the run stops at 90).

## 1. What this copy is

- Tag `k3-g3d` (HEAD) = session 4 (tests only; book `./.dsh-ref/k3-g3-impl-4.md`, your reply
  `./.dsh-ref/k3-g3d-final.md`). Codex checked it read-only (`./.dsh-ref/k3g3d-review.out.md`, Chinese): rulings 1, 3,
  4, 6, 7 done; two must-fix in tests; production stays unchanged.

## 2. Items (binding; production code must not change — if a test shows a production defect, stop and report it)

1. **K3-13's owner case is built by hand** (`tests/work-graph/K3-13-two-items-owner.test.ts` ~81–102: a record for a
   Run that was never created, made with the state constructor and committed straight into the store; the digest is
   `'d'.repeat(64)`). Rebuild it as K3-06's owner case does: `reconcileRun → resolveUnknownRun → claimTask(review)`
   through the owners, two process items with real SHA-256 digests, a real review Run; keep the settlement assertions
   (the second item `undetermined`, `settlement`, `核对轮没有给出结论`); memory and SQLite.
2. **K3-42 (二) through the real chain** (`tests/scenarios/K3-42-unexpanded-r2.test.ts`: a fake model request, a
   hand-run handler, an empty admitted manifest, the display map handed to settlement by hand). Use Codex's public
   route: a long task instruction through `plans/propose` / `plans/apply` (`AG2b-collaboration-fixture.ts` ~369/372;
   the instruction enters the task context as is) plus one long control-character command, sized so the manifest
   expanded is over 262,144 bytes and fits once reduced to its floor → the real prepare produces `unexpanded`
   (`execution-preparation.ts` ~98/425). Then the real Runtime runs the scripted model, which writes the conclusion
   through `record_unknown_call_review`; the Workflow settles; read back through HTTP `unknown-call-reviews/read`.
   Assert `undetermined` / `crash_undetermined`, no `crash_possible`, the model text kept. Note Codex's warning: more
   commands or paths alone do not work (the command is cut to 4 KiB, paths are cut before items).
3. **K3-35's owner-level prepare** (Codex suggestion 5): replace the synthetic review-purpose round Run
   (`K3-large-review-input.ts` ~444/473) with the Run a public review claim returns (reuse the claim step at
   `K3-35-owner-manifest-trim.test.ts` ~73), so it matches the owner's `activeRound`.
4. A1's test locks `unavailable` and "no claim", not the reason's wording (Codex suggestion 4).

## 3. Checks

Every `K3-*` test file, `tests/scenarios/A8-host-restart*.test.ts`, `tests/architecture/`, with `--maxWorkers=2`; then
`npm run typecheck`. No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
deleted.

## 4. Reply

Under 400 words: files changed (tests; production none), each item RED → GREEN, checks with numbers, UNSPECIFIED,
subagents (most at once).
