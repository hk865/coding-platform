# K3 group 3, session 4 reply

## FILES CHANGED
Production: **none** — `git diff --stat -- src/ vendor/` is empty; every change is a test.
Tracked tests: 8 modified, +720/−831 — `helpers/K3-mixed-seams.ts` (86), `runtime/K3-19-review-admission.ts` (21), `runtime/K3-35-review-input-size.ts` (403), `scenarios/K3-06-mixed-batch.ts` (317), `scenarios/K3-11-review-reasons-r2.ts` (247), `scenarios/K3-13-two-commands.ts` (129), `scenarios/K3-42-truncated-command.ts` (236), `work-graph/K3-11-review-reasons.ts` (112).
New: 7 files, 1,869 lines — `helpers/K3-large-review-input.ts` (504), `scenarios/K3-19-missing-read-no-round.ts` (214), `scenarios/K3-42-unexpanded-r2.ts` (201), `scenarios/K3-45-review-incomplete-r2.ts` (247), `work-graph/K3-06-mixed-kinds-owner.ts` (282), `work-graph/K3-13-two-items-owner.ts` (189), `work-graph/K3-35-owner-manifest-trim.ts` (232).

## A. Rulings 1–3
- **K3-06.** The `read_only`+`independentReadOnly` stand-ins are gone; `K3-mixed-seams.ts` now blocks only an `edit` call with the real `workspace_write` class. Owner (new, memory+sqlite): create → claim → `recordConclusion(alias 3)` → `settleReview`; aliases `[1,2,3]`, kinds `['platform','file_edit','process']`, platform `not_done`, edit `compare_in_continuation`, one round, `resolved`; a wrong-kind item is refused `invalid`. RED: kind-order `:181`; R2 process `:185`; file_edit `:253`; platform `:279`. R2 = three single-item Runs (process full round; file_edit/platform resolve at creation; `h.advance` claims no round).
- **K3-13.** Injection seam deleted. Owner (new, memory+sqlite) two process items: item 2 `undetermined`/`settlement`/`核对轮没有给出结论`, reasons `['undetermined','crash_undetermined']`. RED: the two-call premise produced **one** item (real serialization). R2 = the reachable single-item chain; the owner case went green at once (UCR-07 already complete).
- **K3-35 (一).** New owner file + `K3-large-review-input.ts`: 32 codec-legal items (real `sha256Hex`, ≤512-char summaries) create/write/settle memory+sqlite, aliases 1..32, record ≤158,720. Real `createExecutionPreparation` over the Kernel-facts reader double: manifest ≤262,144, render ≤65,536, trim sample→notVisible→items-from-back, all 32 aliases retained, no callId — literals only. RED: `argumentsDigest:'sha'` rejected by the codec; trim RED on a wrong 68,849>65,536 measure. R2 = one Run, >4 KiB control-char command from the real Kernel args, 512-byte callId, 200 real paths; `materials/open`, model-request assertions, real settlement; no DB open.

## B. Ruling 4
- **K3-11 R2.** Two rounds, each writing `partial` through the real tool, Goal-pause + crash (no call in flight) → `unfinished`, Workflow settles: exactly `['review_incomplete','partial','confirm_each_step']`. `second_consecutive` on the real continuation chain (A RUN-25 → A resolves → B command → RUN-20(i) → `executions/resolve-unknown` → B's round → settle). `inventory_incomplete` now via the real `resolveUnknownRun` (memory+sqlite). RED `:202` pending observation; `:320` empty reasons; `:312` status.
- **K3-45 (一) R2** (new): two unfinished rounds, each concluded through the tool, Workflow settles → `needs_decision`, `['review_incomplete']`, `rounds ['unfinished','unfinished']`. RED `:197` `pending_review`.

## C. Ruling 5
- **K3-42 (二)** (new file): the real prepare produces `unexpanded`; the scripted call is executed by the real `record_unknown_call_review` adapter; the round ends through the real entry port; the real owner `settleReview` is fed the real display map → `undetermined`/`by:'settlement'`, self-check `undetermined`, model text kept, no `crash_possible`; read via the owner's public read port. **Open gap:** the Workflow `settle_review` step + HTTP `unknown-call-reviews/read` are not attachable — no public route binds a 32-item record/round into a `HostScenario` (`K3-large-review-input.ts:187`; `create-platform.ts:659`); reported, no production route added. (一)/(三) DB read removed.

## D. Rulings 6–7
- DB/artifact opens removed from K3-35 and K3-42; public `materials/open` + observed requests.
- B1: proposal-phase Runtime admission rejected `proposal_phase_unsupported`, not entered, 0 model calls (RED `:81`).
- A1: new real-Workflow case; binding grants `run_readonly_command` without `read` → `reviewCapability` unavailable, no `claim_task`/`prepare`/`start`, `settle_review{review_unavailable}`, 0 model calls.

## CHECKS (`--maxWorkers=2`)
- 13 touched test files: **13/13, 36 passed** (my run). Every `K3-*`: **47 files, 243 passed, 0 failed**. `tests/runtime/`: 57 files, 450 passed. `tests/state/`: 38 files, 3,829 passed / 1 failed / 29 skipped (both baseline; §A:155/156). `A8-*`: 20 passed / 21 failed — 20 baseline + `A8-host-restart-paused` "A8-3n closing unsupported" (`:474`), same signature/timeout as its baseline sibling §A:102. WP1+S1: 24 passed. Touched Workflow: 30 passed. platform+WP2: 38 passed. architecture: 52 passed. `typecheck` 0, `check:architecture` 0, `build` 0. Two test-side type fixes by close-out (`K3-42-unexpanded-r2:73`, `K3-45-…-r2:160`).

## UNSPECIFIED
1. K3-06 blocked-send L4 verdict: `not_done`/`not_committed`.
2. K3-06 file_edit/platform "settlement": L9 `resolved` at creation + `advanceWork` continuation, no separate settle step.
3. K3-11 `second_consecutive` timing: written per L17 but emitted at settlement per L9/L16; asserted at settlement.
4. A1 unavailable reason is the generic switch-off text (missing `read` indistinguishable).
5. Owner-level K3-35 prepare wraps the real owner record in a synthetic review-purpose round Run.

## SUBAGENTS
9 tasks: K3-06, K3-13, K3-35, K3-11, K3-45, K3-42, ruling-7, read-only verifier, close-out; ~15–40 min each; **most at once: 3** (strictly).