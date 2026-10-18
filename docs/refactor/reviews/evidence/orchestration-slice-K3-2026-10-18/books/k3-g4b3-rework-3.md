# Task: K3 group 4 session B3, rework 3 — one real-Run fixture for the K3 tests; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read its sections "How tests reach their state: no hand-written facts" and
"Before you build: what the reworks were about" first; both bind every brief**, and the close-out runs one vitest
command at a time). No fixed limit on subagents at once (decision 76), files disjoint, every vitest command
`--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 180 minutes** (the
run stops at 190). Finish whole items; an unfinished item is reported, not half-done. Delete `./.dsh-scratch/` (the
directory too) before you end.

## 1. What this copy is

Tag `k3-g4b3-r2` (HEAD) = B3 rework 2 (book `./.dsh-ref/k3-g4b3-rework-2.md`, your reply
`./.dsh-ref/k3-g4b3-rework2-final.md`). Codex's quick check of it: `./.dsh-ref/k3g4b3-review3.out.md` (Chinese, with
file:line and the fix approach). Production code is done except item 1; the rest of this round is the tests. This is
the third round in which hand-written facts were found in the K3 fixtures, one file at a time. **The cause is that the
K3 tests have no single real-Run path:** `tests/helpers/` has 17 K3/B2 helpers, several of which build the same prior
state in different ways (`B2-execution-fixture.ts`, `B2-runtime-fixture.ts`, `B2-blocked-runtime.ts`,
`K3-35-runtime.ts`, `K3-35-prepare.ts`, `K3-prefix-claim.ts`, `K3-proposal-round.ts`, …). This round fixes the cause.

## 2. Items (binding)

1. **The hook's allowance consumption reads the closure once.** Today one hook call reads it twice
   (`execution-driver.ts` ~469 and ~497 into `command-rerun-request-service.ts` ~485 and ~1067). Pass the closure read
   for this call through the trusted internal call; add the count assertion for the consumption branch (one closure
   read per hook call).
2. **One shared real-Run fixture (the cause).** First, one subagent reads the 17 helpers and reports, per helper: what
   prior state it builds, which parts go through public steps and which are hand-built. Then build or extend ONE helper
   (pick the existing one closest to it, say which) that does:
   public claim → real `prepare` → `runtime.startRun` with a scripted model whose tool calls go through the real tools
   (the stand-in `shell` of §5.1, the platform tools, the injected blocking seams) and get recorded by the Kernel →
   the Run ends, stops or is interrupted by fault injection (a crash at a named point, a stop) so the Runtime records
   its own boundary, position and cursor → the next Run through the public requeue/claim. It accepts injected
   dependencies (clock, id generator, blocking tools); it never takes a Kernel identity, position, cursor, review item,
   observed item or `closed` value as input. Its functions replace the hand-building ones in the other helpers; delete
   what no test uses afterwards (report the helper line count before and after).
3. **Move these tests onto it** (Codex's list):
   - **B2-18:** the first record comes from a real blocked Run; every continuation goes through `startRun` with its real
     context, asks, is refused through `decisions/answer`, ends, is requeued. R stays 401. A new unknown call per
     round is not needed. Report the time.
   - **B2-16:** the same; no made-up Run ids (`B2-16-hook-reads.test.ts` ~219).
   - **K3-35:** the original Run makes the platform calls in its own tool batch (31 in one batch is fine) and the
     observed items come from the draft reader; no hand-filled observed items or appended platform items
     (`K3-35-continuation-fixture.ts` ~214, ~616–618). The proposal round goes through real `prepare`/`startRun`; no
     hand-built manifest, prepared input, Kernel identity or position (`K3-proposal-round.ts` ~586–636). The crash
     boundary comes from a real stop or failure the Runtime records; no self-made cursor or "+1" position
     (`K3-35-continuation-fixture.ts` ~456–464; production takes the real history position and canonical cursor,
     `execution-observation.ts` ~731–737). Re-derive the totals on what the real path produces and show the
     arithmetic in the test comment.
   - **The closed case** (`K3-review-preparation.test.ts` ~515): close the Task through the public plan change
     (`K3-review-card-fixture.ts` ~318), not a `ready{closed:true}` stand-in.
   - Combinations the real path cannot produce stay only in pure renderer or codec tests.
4. **Restore the deleted assertion.** The near-limit whole required-section literal (deleted in rework 2; see `git diff k3-g4b3-r1 k3-g4b3-r2 -- tests`)
   moves into the pure boundary test (`K3-35-renderer-boundary.test.ts` ~147), so a dropped anchor or method line
   fails it.
5. **One latch for the two blocking seams** (`K3-tool-seams.ts` ~26, ~96).

Your UNSPECIFIED 4 and 5 are accepted; 1, 2, 3 and 6 are items 3 above.

## 3. Checks

`--maxWorkers=2`, **one vitest command at a time**: every `tests/**/K3-*.test.ts`, `tests/**/B2-*.test.ts`,
`tests/**/K-*.test.ts`, `tests/**/S5*.test.ts`, `tests/**/S4C2-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`,
`tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`, `tests/app/S4C*.test.ts`,
`tests/architecture/`, `tests/runtime/`, `tests/**/*brief*.test.ts`, the changed files; `npm run typecheck`,
`npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected (no bwrap). The
close-out greps every K3/B2 test and helper (not only the changed ones) for hand-written facts and lists each hit with
why it is allowed. No real model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 900 words: the helper survey (one line per helper), which helper became the shared one, helper lines before and
after, production net (item 1), each item RED → GREEN or how it was checked, the K3-35 totals with their arithmetic,
B2-18's time, the fact-grep list, checks with numbers, UNSPECIFIED.
