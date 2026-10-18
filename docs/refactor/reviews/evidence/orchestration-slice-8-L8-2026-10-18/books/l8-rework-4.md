# Task: slice 8 L8, rework 4 — the last rework (decision 80): three production fixes, delete the hand-built rows, restore one check; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books, the test rule sheet and the lead's rulings are binding; do not make design decisions; report anything
undetermined under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** This book is small: work alone or with at most two
subagents on disjoint files (`./.dsh-ref/coordinator-mode.md`); the test rule sheet `./.dsh-ref/test-rule-sheet.md`
(v3) binds every test. Every vitest command `--maxWorkers=2`, one at a time in the close-out. **Do not end your turn
while a subagent has not reported back.** **Finish within 80 minutes** (the run stops at 90). Delete `./.dsh-scratch/`
(the directory too) before you end.

## 1. What this copy is

Tag `s8l8-r3` (HEAD) = L8 rework 3 (book `./.dsh-ref/l8-rework-3.md`, your reply `./.dsh-ref/l8-rework3-final.md`).
Codex verified it (`./.dsh-ref/l8-verify3.out.md`, Chinese, `V3§n`): 20 ids fixed, 13 partly, 1 ledger weakening,
17 new rule-sheet instances, 3 production defects. Your reply's "A–K done, BLOCKED none" did not hold.

**The product owner decided (2026-10-18) that this last round fixes only what matters to the business.** The partly
rows that are about test form (row A's per-await cancellation rows through a requeue, row B's real composition
callback, row J's `input = null`) and the code that no public step reaches go to the later test-cleanup round (T);
**do not work on them.** This book is the whole must-fix list; Codex checked it (`./.dsh-ref/l8-book6.out.md`, Chinese) and its points are in §3, whose wording is final. If a row cannot be done as written, stop that row and report BLOCKED with the exact refusal (file:line, message); never weaken a test or change a literal to get past it. Anything else you find goes under FOUND, not fixed.

## 2. Rulings

1. **Your UNSPECIFIED.** (1) Accepted: the internal union `{status:'ready';value}|{status:'cancelled'}`. (2), (3),
   (5): to T, no work. (4): to T (static check only).
2. **Unreachable cancellation.** The driver makes a fresh controller for every acceptance and never aborts it
   (`src/app/auto-capture-driver.ts:109`), and it never re-sends a command (rework 3 ruling 5). So the cancellation and
   replay branches of `requestAutoCapture` and `failAutoCapture` are reached by no public step: their production code
   stays as rework 3 shaped it, untested; the lead lists them on T.

## 3. The rows (do every row)

| Row | What | How |
| --- | --- | --- |
| P1 Capture released when cancelled at the return | V3§4 defect 1: `architecture-service.ts:1087` returns `cancelled` after `workspace.captureObservation` returned ready, **outside** the `try/finally` (`:1090`, `:1251–1253`) that releases the capture, so the retained capture is never released (it counts against the retained-capture and byte caps). | A ready capture whose signal is set at that boundary returns `cancelled` **and** is released; a non-ready capture keeps today's precedence. Test (memory and SQLite): the public `architecture/capture` request (its public body, no `requestSeq`, as the kept manual-capture rows send it) on a real platform; an A3 gate holds the real `captureObservation` after it returned ready; abort; let it go → `rejected`/`cancelled`; an A3 counting wrapper around the real `workspace.releaseCapture` (delegates unchanged) shows exactly 1 call; a public read shows `current` unchanged. Build the platform as `S8A-L8-auto-capture-gate.test.ts:151` (`openPlatform`) with `installCaptureActivity` (`:72`, `:83–102`), moving the gate to after the real result returns; assert at the platform method, not over HTTP. RED first. |
| P2 Cleanup does not rewrite an earlier error | V3§4 defect 2: the outer `catch` (`:1255–1257`) runs after the `finally` cleanup and turns a throw that happened with the signal **not** set into `cancelled` when the signal was set during the cleanup. | Rework 3 ruling 2: decide `cancelled` versus the throw when the throw is caught, before the cleanup; the cleanup never changes the main result. A throw with the signal already set stays `cancelled`. Test (memory and SQLite): the same public request; an A2 wrapper makes the real `workspace.verifyCapture` throw once with the signal not set; an A3 gate holds the real `releaseCapture`, abort while it is held, let it go → the call rejects with the injected error (not `cancelled`); release count 1. The cleanup keeps its own fresh signal (`:457`); keep `hasCommittedReceipt` and its late-restore results. Same platform build and assertion layer as P1. RED first. |
| P3 The archive reader keeps the caller's cancellation | V3§4 defect 3, `session-anomaly-facts.ts` `readArchiveChangedFiles`: the execution read (`:168`) that resolves with the signal set continues to ready; its throw with the signal set (`:170`) returns `unavailable`; a Turn read answering `not_entered` with the signal set (`:174`, `:179`) returns ready; the workspace helper's ready return (`:136`) is not re-checked. | Rework 3 ruling 4 for this reader: after the awaits at `:123`, `:136`, `:168`, `:174`, `:191` and before every ready exit (`:149`, `:156`, `:179`, `:186` and the last return), the original signal set → `rejected`/`cancelled` (`:123` uses its existing `retry`/`cancelled`); the `:170` catch checks the signal first, then keeps `unavailable`; with the signal not set, today's results stay. Do not add a cancelled result to a port that has none. The original signal is the archive call's own (over HTTP: the request controller, `src/app/server.ts:227`, aborted on disconnect at `:228`, passed through `session-archive.ts`), not the Run's stop controller. Test: trigger the archive through its public step (the not-entered Run precondition of `S1-archive-files-brief.test.ts:168`), hold the real execution read's return (A3), abort the archive call's signal, let it go; an A3 wrapper that observes the real `readArchiveChangedFiles` unchanged shows `rejected`/`cancelled`, not `not_entered`/ready; one row for the throw. The archive's own fallback (`session-archive.ts:244–248`, cancelled → unavailable facts) stays unchanged (T). |
| D Delete the hand-built rows | V3§3 instances 1–15: the `S8A-L8-capture-start.test.ts` cases at `:416`, `:437`, `:458`, `:482`, `:514`, `:533`, `:561`, `:584`, `:615`, `:636`, `:662`, `:686`, `:708`, `:738`, `:772` (both backends) call driver-only owner methods with bodies the driver produces (`captureBody` with `requestSeq`, `requestBody`, `failureBody`). | Delete these cases, the helpers only they use (`:391–404`, including `failureBody`'s closing brace), and the comment at `:409–413` that says no command is hand-built. Keep the read rows (`:798`, `:818` and the others not listed). List each deleted assertion in the reply under this row. |
| R Restore one check | Ledger line `S8A-L8-auto-capture-host.test.ts:51` (old). | Right after the replayed registration's reply, a public read shows `autoCapture` `{ requestSeq: 1, pending: false }` (the old subject and literal); keep your later adoption check (request 2) after it as the completion boundary. |

## 4. Close-out

- Production reach: a new helper is reached from production or deleted; never add to the allowlist.
- Detectors, both: `python3 -I .dsh-ref/d1-ledger.py . slice-base WORKTREE` and
  `python3 -I .dsh-ref/d1-ledger.py . s8l8-r3 WORKTREE`. Every round line must belong to row D (or be a moved line);
  anything else is a weakening: undo it or report BLOCKED. D3 0 hits.
- Checks: the changed test files (exact list, one vitest command at a time, `--maxWorkers=2`), then typecheck,
  check:architecture and build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 600 words: per row P1, P2, P3, D, R: done (RED → GREEN) or BLOCKED with the exact refusal; production
lines added and removed; the round D1 with a row per line, the cumulative D1 count, D3; the checks with numbers; FOUND
and UNSPECIFIED.
