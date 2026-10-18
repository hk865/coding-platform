# Task: K3 group 4 session B1, rework 3 — one item and one clean-up from the third quick check; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); files disjoint, every vitest command `--maxWorkers=2`. **Do not end your turn while
a subagent has not reported back.** **Finish within 60 minutes** (the run stops at 70).

## 1. What this copy is

Tag `k3-g4b1-r2` (HEAD) = session B1 after rework 2 (book `./.dsh-ref/k3-g4b1-rework-2.md`, your reply
`./.dsh-ref/k3-g4b1-rework2-final.md`). Codex's third quick check: `./.dsh-ref/k3g4b1-review3.out.md` (Chinese): items
2–5 done, your UNSPECIFIED (i)–(v) accepted; item 1 is half done.

## 2. Items (binding)

1. **No busy loop between failing cards (rework-2 item 1).** Today each failure rebuilds the exclusion set for the
   current card only, and the returned `next` step does not carry earlier exclusions (`workflow.ts` ~2441, ~398); the
   Host driver runs the `next` steps one after another (`collaboration-driver.ts` ~793, ~884), so with two tasks A, B
   whose answered cards keep failing ② the driver alternates A → B → A and never reaches a claimable task C. Carry the
   set of cards that failed in this continuous selection on the `next` step (the advance input), add to it on each
   failure, and drop it when the continuous selection ends (the driver stops or the selection returns anything but a
   step that continues it). A designated task still answers `waiting` with its reason. Test through the Host driver
   (the continuous advance, not one step): A and B fail ② persistently (store wrapper), C is claimable → C is claimed in
   that drive, A and B are each applied at most once in it, and both reasons are reported.
2. **One check fixture (suggestion).** The two sandbox-execution helpers added in rework 2
   (`K3-29-disposition-recovery.test.ts` ~55, `K3-44-recovery-answers.test.ts` ~56) become one helper under
   `tests/scenarios/support/`; both tests use it; no assertion changes.

## 3. Checks

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`,
`tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`, `tests/architecture/`, the changed
files; `npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are
expected (no bwrap; `A8-3n` included). No real model calls, no git writes, never ports 3080/3099/44797; probes under
`./.dsh-scratch/`, deleted.

## 4. Reply

Under 350 words: files changed (production net; tests), each item RED → GREEN, checks with numbers, UNSPECIFIED.
