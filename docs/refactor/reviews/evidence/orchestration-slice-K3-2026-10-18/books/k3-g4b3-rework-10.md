# Task: K3 group 4 session B3, rework 10 (decision 81: rework 2 of 3) — the regressions, then the business rows Codex's check left open; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books, the test rule sheet and the lead's rulings are binding; do not make design decisions; report anything
undetermined under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); the test rule sheet `./.dsh-ref/test-rule-sheet.md` (v3) binds every brief. Files
disjoint between subagents, every vitest command `--maxWorkers=2`, the close-out runs one vitest command at a time.
**Do not end your turn while a subagent has not reported back.** **Time: you have 270 minutes (the run stops at 285).
Do not end your turn while a row is still open and more than 20 minutes are left.** An unfinished row at the end is
reported, not half-done. Delete `./.dsh-scratch/` before you end.

## 1. What this copy is, and why this round matters

Tag `k3-g4b3-r9b` (HEAD) = rework 9's second session (books `./.dsh-ref/k3-g4b3-rework-9.md` and
`./.dsh-ref/k3-g4b3-rework-9b.md`, replies `./.dsh-ref/k3-g4b3-rework9a-final.md`, `./.dsh-ref/k3-g4b3-rework9b-final.md`).
Their rulings still bind unless §2 says otherwise.

Three lead checks of that tag are your input:
- Codex's read-only check of 9a + 9b: `./.dsh-ref/k3-verify9.out.md` (Chinese): 67 must-fix rows = 45 fixed, 22 partly;
  10 ledger weakenings (§3); 6 fake-guard groups and one new production defect (§4); its view of your FOUND/UNSPECIFIED (§5).
- The lead's mutation runs: `./.dsh-ref/k3-mutation-r9b.txt`. All five fake guards G1, G2, G3, G5, G6 are confirmed:
  with the guarded production check removed, the named tests still pass.
- The lead's runs with bubblewrap: the K3 check set (`./.dsh-ref/k3-check-files.txt`, 371 files) had **104 failures
  in 20 files** (`./.dsh-ref/k3-r9b-failing-files.txt`, log `./.dsh-ref/k3-r9b-check.log`), and the whole suite
  (`./.dsh-ref/k3-r9b-full-failing-files.txt`, log `./.dsh-ref/k3-r9b-full.log`): **122 failures in 29 of 712 files**,
  the same 20 plus 9 outside the K3 set (`tests/app/S2B-*` and `tests/work-graph/S2B-r2-activity-run-ended-at`), all
  "prepare rejected". Your 9b checks ran only the 50 changed files, so these were not seen.

Under decision 81 (product owner, 2026-10-18), rework 9a + 9b was rework 1 of at most three DSH reworks; this is
rework 2. After it, Codex lists everything still open once and the lead freezes that list as the final table; a third
round, if any, does only that. A row left half-done here is expensive, so finish rows completely.

## 2. Rulings for this session

Codex checked this book read-only (`./.dsh-ref/k3-book10.out.md`, Chinese). Its two open points and its locations
are folded in below; where this book and that check differ, this book's wording is final. Its item 3 (G1, G2 paths)
and item 4 (per-row notes) are binding guidance.

1. **Regressions first (package R).** Rework 9a made the Task review reader required in prepare (F-071; correct, the
   reader stays required). Every old harness that builds prepare without it now fails with `the Task review reader is
   not wired` (most of the 104; Codex attributes all 19 test files to it). Wire the real Task review owner over the
   same records, the way your 9b did for `S4C2` (`tests/runtime/S4C2-assembly.test.ts:147–154`) and `K3-35`
   (`K3-35-workspace-baseline-prepare.test.ts:168`, `world.reviews`), once in each shared harness that builds the
   prepare dependencies: `tests/helpers/B2-runtime-fixture.ts:218` (returned at `:273`),
   `tests/helpers/S2B-runtime-store-fixture.ts:157` (`:195`), `tests/helpers/S1-runtime-scenario-fixture.ts:235`,
   `tests/helpers/WP1-entry-fixture.ts:203` (the review schemas and indexes are already registered in
   `task-claim-fixture.ts:168`, `:178`). Two files build it themselves and are wired separately:
   `tests/business/S1-archive-flow.test.ts:255` and `tests/runtime/S3-context-assembler.test.ts:391` (the latter has no
   real records yet: a narrow real-reader backend addition). The 9 files only the whole suite showed are not in Codex's
   list: find the harness each uses (grep for where it builds prepare) and wire it the same way. No production change
   for this.
   `tests/architecture/production-reach-allowlist.json:1122`, `:1128`, `:1134`, `:1140`: remove the four entries the
   test names (`src/core/work-graph/state/command-rerun-request.ts#OpenCommandRerunRequestForAliasInputV1`,
   `#openRequestForAlias`, `#sameTask`, `#sameReviewRef`). Any failure in the two lists that is not one of these two
   causes: fix it if it is a direct consequence of rework 9, otherwise report it under FOUND with the message.
2. **Scope (decisions 80-6 and 81-2).** Only rows that guard business behavior. Not done here, moved to T: `F-014`,
   `F-027`, `F-046` (except the lost assertions of ruling 5), `F-055`; the test parts of `F-071`, `F-075`, `F-088`
   (fake guards G3 and G5 are real but guard hygiene fixes); `F-101`'s page-cap and stall branches (already T).
3. **Production rows (the only production changes allowed).**
   - `F-076` / `F-101` (G4): a cancellation stays `cancelled`. `src/core/work-graph/views/decision-read-model.ts:550`,
     `:562`, `:634` must not turn a cancelled command-rerun-request page read into `unavailable`;
     `src/core/agent-runtime/context-assembler.ts:1275` (`if (read.status !== 'ready') return facts;`) must not drop a
     cancelled read: following the cancellation test at `context-assembler.ts:1240`, `reviewCommandFacts` returns the
     cancellation, and `assembleReviewForContext` (`:1319`, `:1719–1720`) carries it to prepare, which ends cancelled;
     it must not be thrown into the `unavailable` catch of `execution-preparation.ts:458`. Any other non-ready result
     keeps today's behavior. Tests through the public prepare (a real review prepare paused at the Kernel window read,
     then aborted) and the public decision read (an unanswered pending card, the cancellation injected while the
     sibling requests of the Task are listed); `listRequests` (`:374`) does not check the signal itself, so use an A2
     fault wrapper that answers cancelled, not an abort followed by plain delegation. No write happens.
   - `F-098` (verify9 §4): one order for "the newest request" in the brief and on the card. The brief
     (`context-assembler.ts:1454–1456`, `localeCompare`) uses the card's order (`src/core/work-graph/tasks/command-rerun-request-card.ts:142`:
     `createdAt` descending, then the request ref key by code-unit order descending). One shared comparator, no second
     copy. Test (G6) through the public owner request entry (`requestRerun` takes `meta.requestId` and the injected
     clock, `command-rerun-request-service.ts:869–872`; the Runtime tool path generates its own ids, so not that):
     two requests for the same alias at the same `createdAt` (fixed A8 clock) with request ids `a` and `B` (locale
     and code-unit order disagree); after `a` is denied, use another Run for `B` (avoids `denied_in_this_run`); `B`
     allowed. First assert the brief names `a`'s state as the newest. Then consume `B`'s allowance for real, create a
     third, pending request at a later time, read its card publicly and assert its earlier requests are listed `a`,
     `B` (the card leaves out same-time siblings, `:171–173`, so the third request is needed; keep the strictly-earlier
     filter). Removing the shared sort (the lead's mutation `const newest = forAlias[0];`) must fail it.
4. **The confirmed fake guards (`./.dsh-ref/k3-mutation-r9b.txt`).**
   - G1 (`F-020`, `F-035`): one test through a **real Host restart**: the start-up re-drive (`src/app/host.ts:1029–1045`)
     hands the saved command-rerun-request answer to the Workflow, which runs ② and ③, once for success and once for
     failure. No hand-built start-up dependencies, no hand-passed answers. Path: answer through
     `h.post('decisions/answer', …)` (`tests/scenarios/harness.ts:1074`); hold the old Host with `commitGate` after ① or
     ② is durable (`:142–149`; `:1063` drops the wrapper for the new Host); `h.restart({ crash: true })` (`:1097`) with
     `resumeOnStartup: true`. Precedent: `tests/scenarios/A8-host-restart-entry.test.ts:91`, `:120–125` (automatic
     advance, no manual advance). The chain is `startup-reconcile.ts:543` → `host.ts:1036` → the Workflow's ② and ③.
     The success case reads back `allowed` and the application; the failure case also proves the ② fault was hit, not
     only "still not applied". The lead's mutation (`if (false as boolean) await collaborationDriver.start(` at
     `host.ts:1036`) must make it fail.
   - G2 (`F-073`): the precondition "① saved, ② not committed" (`applied === null` at
     `src/core/work-graph/tasks/unknown-call-review-answers.ts:206`): after the public answer commits ①, make only the ②
     commit whose identity starts with `crr-answer:` (`command-rerun-request-service.ts:1067`; identity in the codecs
     `:418`) fail once **before** it calls the real commit; every other call delegates to the real backend. Do not use
     the existing `failNextApplicationCommit` (`K3-review-card-fixture.ts:233` stops ③). Read back publicly the answer,
     the pending request and the empty application, then the ordinary advance or a restart replays it. The lead's
     mutation (`if (applied === null) continue;` after `:206`) must make it fail.
   - G6: ruling 3, `F-098`.
   For each, the reply names the mutation you ran and the assertion it failed on.
5. **Ledger weakenings (verify9 §3).** Restore: `D27` (`B2-UR7-crr-answer.test.ts:59`, the public request read's
   `state: 'allowed'`); `D82` (`B2-12-recognition.test.ts:125`, the owner's reader **throw** as the fault, not "read
   ok, no script"); `A72`, `A74`, `A77`, `A78`, `A80`, `A82`, `A84` (the K3 disposition texts lost in the `F-046`
   move: write each lost assertion back, literal for literal, as the original test asserted it, in the file that now
   holds the case). `D10` (`B2-401-world.test.ts:112`, `1_200_000`): the lead authorizes it; the file's other 401-world
   rows use the same value.
6. **`F-066`.** Your 9b reported the eight-anchor case BLOCKED (mandatory 15,030 bytes under 16,384; Codex's own
   difference sum gives 15,031 and calls the base unproven). The lead moves this row to T by ruling, with your
   arithmetic attached; it is not recorded as proven unreachable. The pure renderer test of the capacity throw stays. Remove the step entry 9b added for it (`K3-35-continuation-fixture.ts:942`, `K3-35-prepare.ts:121`)
   if nothing calls it.
7. **`F-032`, the `K3-15` sub-row.** Authorized narrow helper fix: wire the recognizer so that a second Run of the same
   Task reaches its shell call (the refusal was at `K3-35-continuation-fixture.ts:517` via `B2-crr-world.ts:125`, "the
   Run settled before its shell call"), then add that second blocked Run in `K3-15-list-by-task.test.ts:54`. If it is
   still refused, BLOCKED with the exact refusal.
8. **Helpers.** Rework 9b's ruling 1 stands: no shared-helper rework; narrow additions only (public inputs, A1/A8, no
   existing call shape changed), each listed in the reply.

## 3. The business rows still open (do every row)

Each row: verify9 §1 says what is missing; test first, RED then GREEN, memory and SQLite for service rows; expected
values from the spec or a hand computation, never from production constants or functions.

| Row | What is missing (verify9 §1) |
| --- | --- |
| `F-069` | The owner (`command-rerun-request-service.ts:741`) actually meeting a not-ready, rejected and cancelled Task review read, through the public request step with an injected reader failure; deleting the guard must fail it. |
| `F-072` | "① saved, ② read throws, the public read returns the answer, then the re-drive" (`src/business/workflow/decision-actions.ts:277`); the fault must be inside ②, for example its `readGoal` (`command-rerun-request-service.ts:1027`) throws; the existing `K3-44:279` fails earlier, in the coordinator. |
| `F-073` | Ruling 4, G2. |
| `F-100` | Two tests (`command-rerun-request-service.ts:959`), each first forming "① saved, ② not committed" (else the receipt replay at `:959` bypasses the Goal-basis guard): a change of the Goal content then refuses it; a pause/resume that changes only the revision still accepts it. |
| `F-020`, `F-035` | Ruling 4, G1; plus `D27`. |
| `F-021` | `B2-02-recognition-unified.test.ts:90` still returns a constructed `WorkspaceFile`: use the real reader (`K3-real-workspace.ts:48`). `B2-12-recognition`: `D82`. |
| `F-026` | Sites that still compute expected values with production hashing, normalization or reason text: `B2-01-blocked-commands.test.ts:77`, `:110`, `:132`; `B2-03-crr-request.test.ts:89`; `B2-14-crr-forms.test.ts:76`; `K3-46-review-advance-failures.test.ts:498`. Hand-computed literals (a hash written out, with the input it hashes in a comment) and spec texts. |
| `F-032` | Ruling 7. The second Run uses a different command; to repeat the original command it first needs a real one-time allowance. |
| `F-054` | Both backends for `K3-review-workflow-rows.test.ts:815`, `:828`, `:839`, `:864`; `K3-review-preparation.test.ts:245`, `:288`; `K3-12-review-round-tools.test.ts:233`. Each must really run on both backends; a `.each` around the old stub does not count. |
| `F-066` | Ruling 6. |
| `F-067` | Replace the precondition derived from the production record size (`K3-48-2-unknown-call-review-model-text-budget.test.ts:497–503`) with a fixed public precondition and an independent hand computation of the whole increment. |

## 4. Close-out

Detectors, both: `python3 -I .dsh-ref/d1-ledger.py . k3-g4b3^ WORKTREE` and `python3 -I .dsh-ref/d1-ledger.py .
k3-g4b3-r9b WORKTREE`; every round line cites a row or ruling; D3 0 hits. Checks: **the whole K3 check set**, one
vitest command with the file list `./.dsh-ref/k3-check-files.txt` (`--maxWorkers=2`), plus every other file of
`./.dsh-ref/k3-r9b-full-failing-files.txt`; report failures, separating those that fail only because this sandbox has
no bubblewrap (the lead reruns them with it). Then typecheck, check:architecture, build. No real model calls, no git
writes, never ports 3080/3099/44797.

Reply under 900 words: package R (how the reader was wired, files, the before/after failure counts); per row done
(RED → GREEN) or BLOCKED with the exact refusal; the two mutations of ruling 4 and the one of `F-098` with the failing
assertion; the narrow helper additions; production lines added and removed; the round D1 with an id per line; checks
with numbers; FOUND and UNSPECIFIED.
