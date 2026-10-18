# Task: K3 group 4 session A, rework 2 — three items from the quick check; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); no fixed limit on subagents (decision 76), files disjoint, every vitest command
`--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 75 minutes** (the
run stops at 85).

## 1. What this copy is

Tag `k3-g4a-r1` (HEAD) = session A after rework 1 (book `./.dsh-ref/k3-g4a-rework.md`, your reply
`./.dsh-ref/k3-g4a-rework1-final.md`). Codex's quick check: `./.dsh-ref/k3g4a-review2.out.md` (Chinese): items 1–4, 7,
8 of the first review are done; three must change. The lead accepted your UNSPECIFIED 1 (a) as the rule and 2–6
(the two dropped 6b variants move to session B).

## 2. Items (binding)

1. **Maintenance: an unreadable goal is not "inactive".** `session-maintenance.ts` ~430/~480: the deferral of UNSPECIFIED
   1 (a) (a `takeover_unresolved` line whose record still awaits a review claim on an active goal is left to the
   Workflow, L12) must tell three answers apart: active → defer; not active → close; the goal read fails → do nothing
   this pass (no close, no write), like the other read failures in maintenance. Test, memory and SQLite: a store wrapper
   fails the goal read once → that pass closes nothing and writes nothing; the next pass (read succeeds) defers on an
   active goal.
2. **No early release left in the recovery fixtures.** `tests/scenarios/K3-29-recovery-round.test.ts` ~287, ~312, ~375,
   ~648 (row 2, its variants and row 4) still call `crashed.release()` before the claim; move every release to the
   `finally` at the end of the flow (the K3-27 pattern), keep the original-Session and final zero-write assertions, and
   grep the K3-29 / recovery tests for any other early release.
3. **The two old close assertions (lead ruling, L27 bullet 3):** `K3-08-wait-reply` (一) ~166 and `K3-R1-restart-flows`
   K3-01 ~177 — assert that after the start-up maintenance the Session is `available` and its latest execution is still
   the original Run, then that the continuation stays in the original Session; drop the requirement that the advance
   contains a `close_open_turn` step. This is the edit the book allows; nothing else in those tests changes.

## 3. Checks

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/K-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`,
`tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`, `tests/architecture/`, the changed
files; `npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are
expected. No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 400 words: files changed (production net; tests), each item RED → GREEN, checks with numbers, UNSPECIFIED.
