# Task: slice 2B, round 3 — the last five fixes; test-driven

You are working in the slice-2B copy (the current directory). Rounds 1 and 2 are **uncommitted in the working tree —
keep them**. This is a NEW session. No git write commands, no network, no real model calls. Throw-away files under
`./.dsh-scratch/` (delete at the end); never `/tmp`. Finish within 60 minutes. Do not start subagents.

Memory limits (binding): every vitest command adds `--maxWorkers=4`; one vitest command at a time; do not run the full
suite (the lead runs it).

Read first: `./.dsh-ref/s2b-impl.md` sections 1–5 (L-scope, L-tdd), `./.dsh-ref/s2b-impl-2.md` section 1 (R1–R13), and
the quick check `./.dsh-ref/s2bquick.out.md`. The frozen spec is
`docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md`.

## Fix these five, each test-first (a failing test showing the defect, then the fix)

1. **R3, consultation bars** (`track-read-model.ts` around :997): page the readonly-copy provenance lookup, keep its
   position in the cursor, stop when the page is full. Test: `limit: 2` with thousands of later copies stays within an
   injected cap.
2. **R4, referenced Sessions** (`activity-read-model.ts` around :486, `track-read-model.ts` around :1180): read each
   referenced Session record and check its `workspaceId` against the caller's bound workspace (cache per read, charge the
   reads to the cap). Test: a Session in the same project but another workspace is not returned (or the read is
   `forbidden` where the spec says so).
3. **R5, no Kernel identity** (`src/contracts/run-activity.ts` around :85): the "never entered" predicate also requires
   no `authorization.kernel`. Use this one predicate in `runtime.ts` (around :453) and `run-activity-service.ts` (around
   :588) instead of their duplicates. Test: a V2-authorized Run with a Kernel identity is not "never entered".
4. **R6, cancellation around bounds** (`runtime.ts` around :489–514): check the caller's cancellation immediately after
   awaiting the bounds read, before interpreting `unreadable`/`not_found`; cancelled → `retry_later`, nothing written.
   Test: the bounds owner answers `unreadable` because of cancellation → `retry_later`.
5. **R8, closed interval at the window start** (`activity-read-model.ts` around :405): an unknown span `[09:00, 10:00]`
   with `from = 10:00` marks the first cell (inclusive endpoint inside `[from, to)`). Test exactly that case.

## Checks

```
npm run typecheck
npm run check:architecture
npx vitest run tests/runtime/S2B- tests/work-graph/S2B- tests/composition/S2B- tests/scenarios/S2B- tests/app/S2B- tests/architecture/ --maxWorkers=4
sha256sum DSH-BASELINE.md docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md
git status --short
```

Expected: typecheck and architecture 0; the targeted run fails only the three 2B-09 shell tests (sandbox) and SC02 is not
in this list; the two sha256 unchanged.

## Reply

Under 300 words: per fix the test name and file:symbol; check results; anything not done and why.
