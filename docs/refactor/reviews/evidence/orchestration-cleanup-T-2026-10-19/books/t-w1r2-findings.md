# T wave 1: frozen finding table, rework 3 (lead, frozen 2026-10-20 04:30)

Source: the Codex audit of rework 2 (`w1r1..1c31c27`, two groups: `codex2/t-r2-Q1.out.md`, `t-r2-Q2.out.md`; 会出错 1,
违规 9, 不整洁 2). The lead checked each against the rework-2 table, the items and the code; all twelve stand. The
Codex ids in brackets point into those answers. This table binds rework 3, **the last DSH rework** (decision 81).
After it, fixes come as Codex read-only patches that the lead applies.

Copy: `~/dsh-work/slices/s9tbW1`, HEAD `1c31c27` (tag `w1r2` = this commit; `w1r1` = ed26c44).

## 0. Rulings

- **R-1 to R-9** (`t-w1-findings.md` §0 and `t-w1r1-findings.md` §0) still apply.
- **R-10 Tests that need the process sandbox.** Run them with
  `CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap npx vitest run --maxWorkers=2 <file>`. If the
  sandbox still fails inside your environment, list the test as an environment failure with its error text; the lead
  runs it in the full suite. Do not replace the real runner because of it.
- **R-11 Expected values.** A test never computes its expected value with a production function at run time
  (`canonicalJson`, `sha256Hex`, a codec, a constant). Write the literal, with its working (the input and the steps)
  in a comment. A value the platform returns is then used as returned (R-8); the literal is checked against it.
- **R-12 The last rework.** A row you cannot finish is reported `partial` or `BLOCKED` with `file:line`; never work
  around it. What is left goes to Codex patches.

## 1. Findings

| 编号 | 位置 | 行 | 问题 | 改法 |
|---|---|---|---|---|
| W3-01 [Q1-01] 违规 | `tests/work-graph/S3-context-inputs.test.ts:778` (base `:469`, `:689`) | W2-18 | IN05's owner changed from the same Task's `runA2` to `runB`, and the third Run went. No row allows that. `src/core/work-graph/state/run-machine.ts:646` refuses only a second **first** claim; the requeue claim branch is still there (`:649`). | Put IN05's `runA2 → runA` input back. Make runA2 for real in that case: runA completed, a real FAIL verification (`check_failed`, `src/core/work-graph/state/task-failure.ts:325`, `:439`), a public requeue, a second claim carrying the returned `requeueRef` (pattern `tests/work-graph/R4c-task-claim-concurrency.test.ts:137`, `:146`), and a real finish. Keep the `forbidden` assertion. |
| W3-02 [Q1-02] 违规 | `tests/work-graph/S3-context-inputs.test.ts:283-289` | W2-18 (B-12, TQ-114) | The Project and both Workspaces are still `commitRaw`ed, with a handwritten Workspace@7. B-12 asked for the other Plan and Run parts on public steps, and TQ-114 names the public project and Workspace registration (`t-items-TQ.md:751`). | Public `createProject` and two `registerWorkspace`; take each Workspace to the revision the tests need with a real Session and public `setLinePins` (as W2-15 did in `S3-prepared-context-admission`). Delete the three raw snapshots. |
| W3-03 [Q1-03] 违规 | `tests/work-graph/S3-context-inputs.test.ts:446`, `:450` | W2-18 (TQ-114) | old-A and new-A are still written with `rawBodies.put`; TQ-114 names this write for removal (`t-items-TQ.md:752`). | Once the real owner exists, write them through the real `materials.storeArtifact` (`src/core/work-graph/materials/material-service.ts:119`, `:138`, `:151`): a Run context and an execution origin for execution material, the Host context for platform material. The missing-body case still writes no old-A. |
| W3-04 [Q1-04] 违规 | `tests/work-graph/S3-context-inputs.test.ts:480`, `:492`, `:673` | W2-18 | The message is sent publicly, but the reply and the read use a `messageRef` the test rebuilt, not the one the send returned (R-8). | Use the literal only for the frozen Plan label and its own assertion (`expect(sent.value.ref.messageId).toBe(DECISION_MESSAGE_ID)`). The reply, the version pin and the read use `sent.value.ref` as returned. |
| W3-05 [Q1-05] 违规 | `tests/work-graph/S3-context-inputs.test.ts:580-584`, `:628` | W2-19 (B-13, TQ-115) | IN11 hands `recordCheckResult` a handwritten observation (`exitCode:0`, stdout, effects, sandbox version) after a direct begin; the registered `check-b.js` is never created. TQ-115 asks for the real runner (`t-items-TQ.md:761`). | Create the registered script; run it with `createRegisteredCheckRunner(...).runRegisteredCheck` on the real Kernel sandbox (`src/core/agent-runtime/check-execution.ts:172`, `:234`, `:241`; R-10), then finalize. Delete the handwritten observation and the direct begin/result calls. |
| W3-06 [Q1-06] 违规 | `tests/work-graph/S3-context-inputs.test.ts:854-859` | W2-19 | The revision has its working, but the report type has no expectation of its own; the whole report ref comes from the program's return (`:638`, `:646`). W2-19 asks for both by hand. | Keep the comparison with the real report ref, and add a literal assertion that its `contentType` is `application/vnd.coding-platform.verification-check-report+json;version=1`, with a comment that the registered-check-report write produces it (`src/core/work-graph/evidence/evidence-service.ts:832`, `:847`). Do not import the production constant. |
| W3-07 [Q1-07] 违规 | `tests/work-graph/S3-graph-context.test.ts:364`, `:510` | W2-24 | `derivedSessionId` computes the expected ids at run time with the production `canonicalJson` and `sha256Hex` (R-11). | Delete `derivedSessionId`. Write the three ids as literals with their canonical JSON input in a comment: A `gr-session-88` → `session-2756a7606765207ade5e4a1939f9f49472a6af969cf7910d74a4719cd799ce73`; B `gr-session-92` → `session-51c986a1fca760447cad3a47f0786809fd73d20318d8c6c6c439e282d170d79a`; Q `gr-session-44` → `session-dcf115308e5f3d0062a8d7e00ce65a374476573c8356d8414c43f4d70a3cd3a9` (input `{"actor":{"id":"u","kind":"human"},"projectId":"p","requestId":"…"}`, `src/core/work-graph/sessions/session-directory.ts:140`). Check each against the id the public create returns; keep the no-`b` check; later steps use the returned refs. |
| W3-08 [Q2-01] 违规 | `tests/work-graph/R4c-execution-read.test.ts:246` | W2-08 | The Host probe step was kept BLOCKED, but A2 allows a dependency failing at a named point: the real probe returns `missing` when the Kernel database file is gone, and maps a store error to `missing`/`damaged` (`src/core/agent-runtime/session-operations.ts:1028`, `:1044`). | After the real failed end and the new claim, move this test's Kernel database aside, run the real probe, hand its result to `healthOn().recordSessionHealth` (`src/core/work-graph/sessions/session-health.ts:121`), put the database back, then archive. Delete the `retire()` call and the BLOCKED note. Keep the Session and Lease assertions. |
| W3-09 [Q2-02] 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:664`, `:670` | W2-10 | After the real unentered failure, the test reads the Kernel store itself and commits `probe:'ready'`, `result:'not_entered'`, `basis:'live_clean'`: the Host's judgement made by the test (F1). The real classifier would answer `left` for that input (`src/core/agent-runtime/run-reconcile.ts:273`; W-05 at `:318-322`). | Keep the failure injection and its restore. Then use the public `readExecution`, the real Kernel owner's `probe` and `reconcileRunAtStartup` (W-05, `run-reconcile.ts:221`, `:322`), so the real write service revokes the Run. Delete the test's own store read and committed verdict. Keep the refusal and unchanged assertions. |
| W3-10 [Q2-03] 会出错 | `tests/scenarios/S2C-K-legacy-provenance.test.ts:77` (base `:39`, `:45`) | W2-16 | A `sessions/create` that omits provenance used to be asserted strictly as `{schemaVersion:1, kind:'new'}`. P still omits it, but only C's explicit continuation is checked now. No row allowed dropping it. | After creating P, assert the strict `new` provenance through the public `readSession`. Keep C's continuation and all the two-segment assertions. |
| W3-11 [Q2-04] 不整洁 | `tests/work-graph/S3-prepared-context-admission.test.ts:167` | W2-10 | The `basePrepare` comment still says it serves two BLOCKED rows. | Words: AD08's BLOCKED base path, and AD06's one refused input. |
| W3-12 [Q1-08] 不整洁 | rework-2 reply §7 | W2-24 | The LOOSENED line is a ledger mis-pairing, but in `tests/work-graph/S3-graph-context.test.ts:917` (W2-24), not `R4c-graph-history.test.ts` (W2-17). | In this rework's reply, state the correction. No test change. |

## 2. Confirmed this round (no change)

- W2-11 BLOCKED: no public read shows a request slot's claim (`plan-readers.ts:598`, `decision-contracts.ts:247`).
- W2-17's later-Turn sub-case deleted under R-4 (`composition-root.ts:276-286`, `run-machine.ts:1261`).
- W2-20, W2-21 and their literals; the shared helper options; W1-15, B-04, AD08 as in `t-w1r1-findings.md` §5.

## 3. Full suite on `1c31c27`

The bubblewrap full suite on `1c31c27` is green: 773 files, 9,929 passed, 5 skipped, 3,072 s
(`checks/full-W1R2.txt`). No row may leave a test red.

## 4. Lead items (not for DSH)

- **L-4 Test time.** The suite went from 2,457 s to 3,072 s. Rework 2's real worlds explain part of it:
  `S3-graph-context` 20 s → 122 s, `S3-context-inputs` 10 s → 58 s. The rest is the existing scale files running
  slower under load. Look after T; not a rework row.
