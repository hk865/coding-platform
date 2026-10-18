I have enough to report. No files were changed.

# K3 group 3 read-through

## 1. Unclear (question / smallest options)

1. **U4 result type unnamed.** The book says "one finite result per task: `pass`, `skip` (with source), or a `review` step" but gives no type, source enum, or home. (a) local union in `workflow.ts`; (b) exported from `business/workflow/contracts.ts`. Also is `review` one value or the three step kinds (`claim`/`close`/`create`, `settle_review`)?
2. **§3 item 5 injection point.** "Host's denied prefixes passed into WorkspaceTools" vs the module constant `WORKSPACE_DENIED_PREFIXES` used at `context-assembler.ts:677`. (a) new `ContextAssemblerDependencies` field; (b) keep the constant, fix only `lstat`/realpath; (c) route through Kernel `WorkspaceSandbox`.
3. **§3 item 5 precedence.** A symlink whose *recorded* path is protected: reason `not_text` or `protected`? (a) `lstat` first → `not_text`; (b) protection first.
4. **§3 item 9(b) public read.** `materials/open` opens Material artifacts, but the prepared manifest lives in the raw artifact store (`bodies.read(bundleRef)`, `create-platform.ts:1529`). The only public read of the prepared note is `executions/brief` → `runtime.readContinuationBrief` (`core-routes.ts:379`, `ports.ts:79`). Question: is `executions/brief` the intended replacement (it returns `{brief,digest}`, so `manifestOf` disappears), or is a new read required? The book says report if none exists.
5. **`settleReview` dependencies.** `createUnknownCallReviewService` is built with `{records}` only (`create-platform.ts:637`); settlement must read the round's Run/pointer and the prepared manifest. (a) extend `UnknownCallReviewServiceDependencies`; (b) a second write service constructed where the workflow reads exist.
6. **§3 item 3 fact plumbing.** The three checks need `facts.run.reconciliation?.observation` and recorded `unresolvedToolCallIds`; `validatedReviewDraft` (`:199`) is pure. (a) extra `reviewFacts` param computed by `runStateOf`; (b) read inside the function.
7. **§3 item 9(a).** "One frozen, hand-computed literal request id for one fixed input": no input or value is given. (a) freeze the K3-39 claim-Session/run/tool/callId tuple's sha256; (b) ask the lead for the literal.

## 2. Spec/book differs from the code

- **Bare paths wrong.** `tool-commit-arguments.ts` = `src/core/work-graph/model/`; `unknown-call-draft.ts` = `src/core/agent-runtime/`; `decision-service.ts` = `src/core/work-graph/communication/`. Grep by the book's paths misses them.
- **`execution-preparation.ts:292–295`** is the unsourceable-materials rejection; the capacity check is at **`:352`**.
- **`run-reconcile.ts:470–475`**: G11 (`inventory !== 'complete'`) is at **`:468`**; 470–473 is the proof return.
- **`workflow.ts:895`**: `isUnadmittedStarting` starts at **`:898`**; the paused/cancelled exclusion is **`:908`** (book says 905).
- **`continuation-brief-assembly.ts:225–233`**: `changeOf` is at **`:227–234`**. `plan-service.ts:2287–2289`: actor id is at **2288–2291**. `claim-service.ts:1135–1157`: guards are at **1142–1160** (1135 is `claimRecords`).
- **§4 item 2 partly done.** `leaseReleasedForContinuation` is already wired in `attempt-machine.ts:767`; `claim-service.ts:269` and `requeue-service.ts:854` still compare `runId` directly.
- **§5.3 already done** by group 2: `tests/composition/platform.test.ts:56` already lists `unknownCallReviews`; `A8-host-restart-attestation`, `S1 IT26`, `WP1`/`WP2` fixtures already pass a `review` draft.
- Good news: group 1 already implemented the full state layer (`state/unknown-call-review.ts` UCR-03..15, `AttemptClaimBasis` `review`, `TASK-03r` effect, `RUN-01r`, `readUnknownCallReviewDraft`); group 3 is wiring, not state-machine writing.

## 3. Tests that will break

- **`tests/helpers/WP1-handover-fixture.ts:370–397`** — `attestedStop` builds an `incomplete` record then calls `f.requeue()` with no `holdReview`/`releaseHold`. Once the L11 claim gate lands, the continuation claim returns `unknown_call_review_pending`; breaks `tests/business/WP1-continuation-handover.test.ts` and other WP1 users. §5.3 says this fixture must call hold→release.
- **`tests/architecture/production-reach.test.ts` + `production-reach-allowlist.json`** — the new Workflow/owner reach breaks the exact-reach assertion until the "K3 group 3 wires it" entries are updated.
- **`tests/architecture/state-writes.test.ts`** — new owner→state writes must be registered (`ALLOWED_DECODERS`/write allowlist).
- **`tests/runtime/A2-reconcile-runtime.test.ts:943`** — `it.skip('K3-21 review_round…')` must be unskipped (item 6).
- **At risk:** `tests/scenarios/S1-archive-flow.test.ts:586+` (IT26) and `tests/scenarios/A8-host-restart*.test.ts` assert "quiet restart" after creating `needs_decision` records; once the 2b/6b paths run, any follow-on claim waits. Book says assertions stay unchanged; verify per file.

## 4. Plan (2 at a time, disjoint files)

| # | Subagent task / files | Est. |
|---|---|---|
| 1 | **Shared first:** §3 items 1–2 (request-id) — `tool-commit-lookup.ts`, `tool-commit-arguments.ts`, `unknown-call-draft.ts`, `decision-service.ts`, `plan-service.ts`, `plan-write-admission.ts`; request-id part of 9(a) | 45 m |
| 2 | **Parallel:** §3 items 5–8,10 — `context-assembler.ts`, `continuation-diff-reads.ts`, `continuation-brief-assembly.ts`, `workspace-change-capture.ts`, `run-reconcile.ts` | 45 m |
| 3 | §3 items 3–4 + tests 9(b)(b′)(c) — `run-reconcile-service.ts`, `task-failure.ts`, `K3-R1-*.test.ts` | 40 m |
| 4 | **Shared writes:** item 1 owner + `listReviews`/route + item 2 review claim — `unknown-call-review-service.ts`, `-codecs.ts`, `claim-service.ts`, `core-routes.ts`, `create-platform.ts` | 50 m |
| 5 | **Parallel:** U5 + item 3 capability — `readonly-command-tool.ts`, `execution-driver.ts`, `query-execution.ts`, `ports.ts` | 30 m |
| 6 | Item 3 round + item 4 UR rows/U4 + item 6 — `execution-preparation.ts`, `unknown-call-review-tools.ts`, `workflow.ts`, `workflow/contracts.ts` | 55 m |
| 7 | R2 rows K3-05/06/10..14/19/35(一)/37/42/45 + close-out | 50 m |

That is ≈315 m. **200 min is not enough.** I would finish §3, items 1–2, U5, the round + UR rows (6), and the end-to-end R2 pair K3-05/K3-10 (7 partial), and **leave** K3-35(一) (worst-case 256 KiB), K3-45(二)–(四) (stateEntry/round-slot matrix), K3-19(二), K3-13, and the K3-11 multi-reason combination, each reported individually.