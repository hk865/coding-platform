# Task: K3 group 4 session B1, rework 4 — one item from the fourth quick check; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); files disjoint, every vitest command `--maxWorkers=2`. **Do not end your turn while
a subagent has not reported back.** **Finish within 50 minutes** (the run stops at 60).

## 1. What this copy is

Tag `k3-g4b1-r3` (HEAD) = session B1 after rework 3 (book `./.dsh-ref/k3-g4b1-rework-3.md`, your reply
`./.dsh-ref/k3-g4b1-rework3-final.md`). Codex's fourth quick check: `./.dsh-ref/k3g4b1-review4.out.md` (Chinese):
rework-3 items 1 and 2 done, your UNSPECIFIED accepted; one must-change item, below.

## 2. Item (binding)

1. **The failed-card set is not public input.** Today `failedReviewRefs` is a field of the public advance input
   (`contracts.ts` ~205, parsed at `workflow.ts` ~660); the public route `workflow/advance` (`core-routes.ts` ~1083)
   passes its input through, so a caller can put a same-project real card's ref there and skip an answer that was never
   tried (`workflow.ts` ~1309). Change it so only the Host driver can carry the set:
   - `failedReviewRefs` leaves `WorkflowAdvanceInput`. A public advance input that has this key → `invalid` (the
     message names the key). The `next` step returned to any caller does not contain it.
   - The Workflow's advance takes the set through an internal parameter that the route does not pass (for example a
     third argument `advanceWork(ctx, input, { failedReviewRefs })`; `core-routes.ts` keeps calling with two). The
     result gives the set to the driver beside `next` (a separate field, not inside the next input); a caller can see
     it but cannot send it back.
   - The Host driver keeps the set on its handle for the continuous selection, passes it when it runs the next step,
     and drops it when the continuous selection ends (the driver stops, or the step is anything but a continuation of
     the selection) — the same lifetime as rework 3.
   - Tests (public entries, no fact injection): through the public route, an advance input carrying a same-project
     real card's ref (a card that has an applicable answer) → `invalid`, and the card is still applied by a following
     advance without the key; through the public route, a failing card's advance returns a `next` with no
     `failedReviewRefs` in it; the rework-3 Host-driver test (A, B fail persistently, C claimed, each applied at most
     once, both reasons reported) still passes unchanged in its assertions.

## 3. Checks

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`,
`tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`, `tests/architecture/`,
`tests/app/`, the changed files; `npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in
`DSH-BASELINE.md` are expected (no bwrap; `A8-3n` included). No real model calls, no git writes, never ports
3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 300 words: files changed (production net; tests), the item RED → GREEN, checks with numbers, UNSPECIFIED.
