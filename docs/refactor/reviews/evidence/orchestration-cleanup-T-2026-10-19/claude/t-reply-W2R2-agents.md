
######## v2:4ec81aae8c62575fc0dcf8a146623147db0fdcdec236bacc8626b7d868d34f78
{
 "group": "w2r2-C (rows W2c-04, W2c-05)",
 "rows": [
  {
   "row": "W2c-04",
   "result": "done",
   "files": [
    "tests/composition/A1-graph-session-platform.test.ts"
   ],
   "what": "tests/composition/A1-graph-session-platform.test.ts:110 contentDigest is now the literal '27272b141e404048373f9886a5c179a23d500d987d486619fae262023fb055d5' instead of adopted.value.baseline.contentDigest. The literal feeds expectedArchitecture, which is used at :119, :122, :179 and :225. The comment at :97-105 now gives the digest formula, the canonical text on one line (written over two comment lines), its byte count (183 bytes of UTF-8), and says the SHA-256 was computed by hand with node:crypto over that text. I wrote the text by hand from catalog-record-codecs.ts:193-202 (the object {schemaVersion, identity:{baselineId}, revision:contentRevision, content}), with the inputs taken from catalog-service.ts:517-518, keys sorted by UTF-16 code unit as fingerprint.ts:45 does and no spaces. The text is {\"content\":{\"constraints\":[],\"description\":\"An adopted source-tools responsibility\",\"schemaVersion\":1},\"identity\":{\"baselineId\":\"a1-platform-baseline\"},\"revision\":1,\"schemaVersion\":1}. A standalone node script in the scratchpad (w2r2-C-digest.mjs, no repo imports) printed 183 bytes and the same hex. That matches the audit's figures, which I checked rather than copied. The test passes, so the hand-written text matches production.",
   "deviations": "The test runs only on SQLite (storage kind 'sqlite' at :50), so 'both backends' means just that one backend here. Nothing else differs from the row."
  },
  {
   "row": "W2c-05",
   "result": "done",
   "files": [
    "tests/composition/R3d-R3g-platform.test.ts"
   ],
   "what": "tests/composition/R3d-R3g-platform.test.ts:195-203 (new, inside the reopened platform's try, after the replay check and before the close-drain block, so before the reopened platform closes). reopened.architecture.observationState(ctx, { workspace: scope }) must be ready, and state.value.current?.captureRef must toEqual { aggregateType: 'ObservedArchitecture', ...scope, captureId: secondCapture!.value.capture.captureId } (the captureId is used as returned). This replaces the old :230-232. reopened.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } }) must toEqual { status: 'not_found' }, which replaces the old :233-235. In the SQLite tail I removed the JSON.parse of the pointer record, the observedRef assertion and the ProjectArchitectureBaselineActive readMany (old :230-235). The tail keeps only the pointer revision check (now :239) and the readThrough check (now :241). New comment at :232-234: R-20 (missing entry point, src/contracts/architecture-observation.ts:53-60); the public observation state carries neither the pointer's revision nor its read-through cursor. W2b-55 stays partial for those two facts.",
   "deviations": "None. The new captureId expression is direct (secondCapture!.value.capture.captureId) rather than the old ternary, because it sits after the existing committed-status guard at :183. The typecheck accepts it."
  }
 ],
 "typecheck": "flock /home/han001/dsh-work/scratch/tc.lock npm run -s typecheck: exit 0, 0 errors",
 "tests": "One invocation: npx vitest run --maxWorkers=2 tests/composition/A1-graph-session-platform.test.ts tests/composition/R3d-R3g-platform.test.ts. Result: 2 files passed, 3 tests passed (A1: 2, R3d-R3g: 1), 0 failed, 0 skipped. Duration 4.41s (tests 2.01s).",
 "diffStat": " tests/composition/A1-graph-session-platform.test.ts | 10 +++++++---\n tests/composition/R3d-R3g-platform.test.ts          | 18 ++++++++++++------\n 2 files changed, 19 insertions(+), 9 deletions(-)",
 "noticed": "tests/composition/R3d-R3g-platform.test.ts:16 and :53: inspectSchemas still registers PLAN_GOVERNANCE_RECORD_SCHEMAS.records. It may only have been needed for the ProjectArchitectureBaselineActive read that W2c-05 removed. I left it as is because the row does not name it. Untracked .lead-ref/ is in the clone, as provided."
}
######## v2:4f7e2c2499ea55656b682a93da9ead9405d9ec80d24471f81a5c672e496dd8c2
{
 "group": "w2r2-B (rows W2c-02, W2c-03), clone /home/han001/dsh-work/scratch/w2r2-B",
 "rows": [
  {
   "row": "W2c-02",
   "result": "done",
   "files": [
    "tests/runtime/R4b-session-recovery.test.ts",
    "tests/runtime/R4b-session-input-boundaries.test.ts"
   ],
   "what": "tests/runtime/R4b-session-recovery.test.ts:248: `expect(wrongSession.status).toBe('rejected')` became `expect(wrongSession).toMatchObject({ status: 'rejected', code: 'invalid' })`. The before/after `histories()` comparison at :244-245 and :249 is kept. tests/runtime/R4b-session-input-boundaries.test.ts:137: the other-principal row's expected value `{ status: 'rejected' }` became `{ status: 'rejected', code: 'invalid' }`. It goes through the existing `expectRefusedWithoutChange` frame, which compares with toMatchObject at :126 and keeps the whole-history before/after reads at :124 and :127. The other-principal read does refuse with `invalid`: the cursor's principal differs from the binding, so `cursorMatches` fails at session-operations.ts:426.",
   "deviations": "None. `toMatchObject` is used because the rejection also carries a `reason` field (session-operations.ts:116-118), and that matches how the neighbouring frame already compares. The frame's parameter type `code?: 'invalid'` (:117) is left as it is."
  },
  {
   "row": "W2c-03",
   "result": "done",
   "files": [
    "tests/runtime/R4c-execution-history.test.ts"
   ],
   "what": "tests/runtime/R4c-execution-history.test.ts. In the `expectRefusedWithoutChange` frame:\n- comment lines :132-137 explain the W2c-03 reason and the mechanism;\n- new optional third parameter `options: { noLowerRequest?: true } = {}` (:140);\n- when it is set, the reader gets the real history through the file's `spyOn` (:94): `const spy = options.noLowerRequest === true ? spyOn(world.history) : null` and `createExecutionHistoryReader({ history: spy?.history ?? world.history })` (:145-146);\n- once the cursor is set up, the recorded requests are cleared with `spy?.requests.splice(0)` (:154);\n- after the refused call, `if (spy !== null) expect(spy.requests).toHaveLength(0)` (:160).\nThe refusal-code assertion (:159) and the public before/after reads of both Sessions (:155-158, :161) are unchanged.\nThe other-Session row (:332-334) and the `it.each([0, 201, 1.5])` limit rows (:352-355) now pass `{ noLowerRequest: true }`. No other row changed.\nTeeth check: in the clone I temporarily removed the `decoded.sessionRef.sessionId !== sessionRef.sessionId` line (observation-recovery.ts:269) and the limit `if` block (:260-262), then ran R4c-execution-history.test.ts. Exactly these four rows failed, each with `AssertionError: expected [ { sessionRef: { …(2) }, …(3) } ] to have a length of +0 but got 1`: the call was delegated to the layer below, which still refused it with `invalid`. The other 14 tests passed. I restored the file with `git checkout -- src/core/agent-runtime/observation-recovery.ts`, and `git diff -- src` is empty.",
   "deviations": "None in substance. The spy is wired only for the four rows the table names, through an opt-in parameter on `expectRefusedWithoutChange`. The other five cursor rows and the forbidden row keep reading through `world.history` directly."
  }
 ],
 "typecheck": "`flock /home/han001/dsh-work/scratch/tc.lock npm run -s typecheck` in the clone: exit 0, no output, so 0 errors.",
 "tests": "One run after the change: `npx vitest run --maxWorkers=2 tests/runtime/R4b-session-recovery.test.ts tests/runtime/R4b-session-input-boundaries.test.ts tests/runtime/R4c-execution-history.test.ts` gave 3 files passed, 28 tests passed, 0 failed, 0 skipped, in 20.55 s (R4b-session-input-boundaries 5 tests in 5.8 s, R4b-session-recovery 5 tests in 5.1 s, R4c-execution-history 18 tests in 18.3 s).\nProbe run, with the src checks temporarily removed: `npx vitest run --maxWorkers=2 tests/runtime/R4c-execution-history.test.ts` gave 1 file failed, 4 tests failed (the four W2c-03 rows) and 14 passed. Duration was not captured, because the output was filtered. src was restored right after this run.",
 "diffStat": " tests/runtime/R4b-session-input-boundaries.test.ts |  2 +-\n tests/runtime/R4b-session-recovery.test.ts         |  2 +-\n tests/runtime/R4c-execution-history.test.ts        | 18 ++++++++++++++----\n 3 files changed, 16 insertions(+), 6 deletions(-)",
 "noticed": "1. In tests/runtime/R4b-session-input-boundaries.test.ts:117, both rows that use `expectRefusedWithoutChange` now pass `code: 'invalid'`, so the parameter type's `code?: 'invalid'` could be made required. I left it unchanged because no row names it.\n2. The other-principal row in R4c-execution-history.test.ts (:302-309) is refused only by the layer below, through the principal-bound cursor at session-operations.ts:426. It therefore makes 1 lower request and is not in W2c-03's set. Whether the reader is meant to have its own principal check is a spec question I did not look into.\n3. The R4b wrong-Session and other-principal rows (W2c-02) were not probed for teeth. The task notes allow a probe only on observation-recovery.ts, not on session-operations.ts."
}
######## v2:f24f8cca3f4e305a1bf6ed2c2471b53a1d8d239e57370d89b7ae4792992639b6
{
 "group": "w2r2-D (rows W2c-07, W2c-08, W2c-09, W2c-10, W2c-12, W2c-13), clone /home/han001/dsh-work/scratch/w2r2-D at 03b9cfd, uncommitted",
 "rows": [
  {
   "row": "W2c-07",
   "result": "done",
   "files": [
    "tests/scenarios/B2-09b-allowance-crash.test.ts",
    "tests/scenarios/K3-05-review-round.test.ts",
    "tests/scenarios/K3-06-mixed-batch.test.ts",
    "tests/scenarios/K3-08-wait-reply.test.ts",
    "tests/scenarios/K3-09-restart-between-calls.test.ts",
    "tests/scenarios/K3-10-review-round-cells.test.ts",
    "tests/scenarios/K3-11-review-reasons-r2.test.ts",
    "tests/scenarios/K3-15-card-hold.test.ts",
    "tests/scenarios/K3-16-approval-round.test.ts",
    "tests/scenarios/K3-16-proposal-round.test.ts",
    "tests/scenarios/K3-17-review-answer-shape.test.ts",
    "tests/scenarios/K3-18-one-card.test.ts",
    "tests/scenarios/K3-19-review-unavailable.test.ts",
    "tests/scenarios/K3-26-inventory-scenarios.test.ts",
    "tests/scenarios/K3-27-review-claim-close.test.ts",
    "tests/scenarios/K3-28-attested-continuation.test.ts",
    "tests/scenarios/K3-29-maintenance-review-run.test.ts",
    "tests/scenarios/K3-29-recovery-continuation.test.ts",
    "tests/scenarios/K3-29-recovery-round.test.ts",
    "tests/scenarios/K3-29-startup-variants.test.ts",
    "tests/scenarios/K3-37-stopped-review-round.test.ts",
    "tests/scenarios/K3-42-truncated-command.test.ts",
    "tests/scenarios/K3-42-unexpanded-r2.test.ts",
    "tests/scenarios/K3-44-crr-kind4.test.ts",
    "tests/scenarios/K3-44-hold-restart.test.ts",
    "tests/scenarios/K3-45-review-incomplete-r2.test.ts",
    "tests/scenarios/K3-R1-second-cleanup.test.ts"
   ],
   "what": "Removed all 53 places in 27 files. In each file the hoisted line `const sandbox = vi.hoisted(() => ({ available: true as boolean, executeChecks: false as boolean }));` is now `const sandbox = vi.hoisted(() => ({ available: true as boolean }));`. In 26 of the files the `sandbox.executeChecks = false;` line is deleted from `afterEach`; K3-R1-second-cleanup.test.ts:43 had the field and no reset. That is 26x2+1 = 53. Hoisted lines (unchanged line numbers): B2-09b:50, K3-05:48, K3-06:45, K3-08:41, K3-09:39, K3-10:38, K3-11:51, K3-15:31, K3-16-approval:42, K3-16-proposal:38, K3-17:38, K3-18:39, K3-19:44, K3-26:124, K3-27:38, K3-28:30, K3-29-maintenance:37, K3-29-recovery-continuation:37, K3-29-recovery-round:49, K3-29-startup:43, K3-37:37, K3-42-truncated:45, K3-42-unexpanded:45, K3-44-crr:49, K3-44-hold:36, K3-45:52, K3-R1:43. Deleted resets (old line numbers): B2-09b:79, K3-05:70, K3-06:101, K3-08:62, K3-09:86, K3-10:60, K3-11:73, K3-15:53, K3-16-approval:64, K3-16-proposal:60, K3-17:59, K3-18:61, K3-19:66, K3-26:146, K3-27:80, K3-28:51, K3-29-maintenance:59, K3-29-recovery-continuation:71, K3-29-recovery-round:99, K3-29-startup:65, K3-37:59, K3-42-truncated:75, K3-42-unexpanded:80, K3-44-crr:74, K3-44-hold:58, K3-45:74. `grep -rn executeChecks tests` now finds 0 places.",
   "deviations": "None. No hoisted object or afterEach body became empty: every hoisted object keeps `available`, and every afterEach keeps its other lines (`shellSeam.release()` or `reviewToolSeam.skip = 0`, `sandbox.available = true`, the cleanups). So nothing extra was needed to keep the code valid."
  },
  {
   "row": "W2c-08",
   "result": "done",
   "files": [
    "tests/helpers/K3-review-card-fixture.ts"
   ],
   "what": "tests/helpers/K3-review-card-fixture.ts:337-338: the comment's line references `(S5-decision-fixture.ts:471, :497, :515)` are replaced by the symbol names: `(S5-decision-fixture.ts` / `` `additionalSchemas`, `forwarded`, `observeRecords`). `` The comment is now wrapped onto two lines. Checked that the three symbols exist in tests/helpers/S5-decision-fixture.ts (:484, :531, :270).",
   "deviations": "None. Comment only, as the row says. The only test run was the typecheck."
  },
  {
   "row": "W2c-09",
   "result": "done",
   "files": [
    "tests/helpers/R4-history-turn-support.ts"
   ],
   "what": "tests/helpers/R4-history-turn-support.ts:56-57: `/** Extra scripted replies after the first text reply. */` is now `/** The Run's scripted replies; when given, `replies` replaces the single `text` reply. */`, over two lines. This matches :128-129, `replies: input.replies === undefined ? [{ kind: 'text', text: input.text }] : input.replies`.",
   "deviations": "None. Comment only. The only test run was the typecheck."
  },
  {
   "row": "W2c-10",
   "result": "done",
   "files": [
    "tests/composition/K-R-previous-turn-bounds.test.ts"
   ],
   "what": "tests/composition/K-R-previous-turn-bounds.test.ts:27-29: new comment: \"the identity seam is made absent over the REAL Runtime. A call would answer `unsupported` and the brief could not be built, so a recorded `endPosition` must never reach it.\" I checked this against src: src/core/agent-runtime/session-operations.ts:1004-1006 answers `unsupported` when the seam is absent, and src/core/agent-runtime/continuation-brief-assembly.ts:575-576 turns that into `retry`/`unavailable`. :30: the hoisted object is now `({ absent: false })` (`calls` deleted). The counter wrapper (old :33, `const wrapped = ...`) is deleted. :35: the getter now returns `real` instead of `wrapped`. :37: afterEach is now `{ seam.absent = false; }`. The old :93 assertion `expect(seam.calls, 'an absent seam is never consulted').toBe(0)` is deleted. Nothing else read `calls`, so it was removed too.",
   "deviations": "None. The line `const real = actual['readTurnBounds'] as (...args: unknown[]) => unknown;` (:32) is left unchanged; the getter still needs `real`."
  },
  {
   "row": "W2c-12",
   "result": "done",
   "files": [
    "tests/runtime/S3-context-assembler.test.ts"
   ],
   "what": "tests/runtime/S3-context-assembler.test.ts:687-689: added a comment right before `expect(counts.graph).toBe(0); expect(counts.inputs).toBe(0);` (now :690-691): \"This world declares no inputs; input reads inside the graph read go through the raw owner and are counted in `counts.graph`; `counts.inputs` only guards a direct page read by the assembler.\" I checked this against src/composition/create-platform.ts:1116-1123: the graph reader gets the raw `taskInputsOwner`, while `f.platform.taskInputs` is the wrapped port at :1161.",
   "deviations": "None. Comment only; no assertion changed. The only test run was the typecheck."
  },
  {
   "row": "W2c-13",
   "result": "done",
   "files": [
    "tests/app/session-rendering.test.ts"
   ],
   "what": "tests/app/session-rendering.test.ts:447: `expect(html).toContain('future.unknown')` is replaced by `expect(html).toContain('未识别记录 · <code>future.unknown</code>')`. I read the label from src/ui/views/history/timeline.ts:277: `未识别记录 · <code>${escapeHtml(parsed.recordType)}</code>`. The separator is U+00B7 with an ordinary space on each side. escapeHtml leaves 'future.unknown' unchanged. :448 is kept.",
   "deviations": "None."
  }
 ],
 "typecheck": "wrun.sh <clone> 'flock /home/han001/dsh-work/scratch/tc.lock npm run -s typecheck': exit 0, no output, 0 errors (run after all six rows were applied).",
 "tests": "One vitest invocation covered the 27 changed scenario files (W2c-07) plus tests/composition/K-R-previous-turn-bounds.test.ts (W2c-10) and tests/app/session-rendering.test.ts (W2c-13). The command was `npx vitest run --maxWorkers=2 $(git diff --name-only -- tests/scenarios) tests/composition/K-R-previous-turn-bounds.test.ts tests/app/session-rendering.test.ts`. Result: 29 test files passed out of 29; 92 tests passed, 0 failed, 0 skipped. Duration 158.12 s (wall clock 18:20:21-18:22:47). W2c-08, W2c-09 and W2c-12 had no test run beyond the typecheck, as the notes say. No timeout was added or raised.",
 "diffStat": " tests/app/session-rendering.test.ts                  |  2 +-\n tests/composition/K-R-previous-turn-bounds.test.ts   | 13 ++++++-------\n tests/helpers/K3-review-card-fixture.ts              |  3 ++-\n tests/helpers/R4-history-turn-support.ts             |  3 ++-\n tests/runtime/S3-context-assembler.test.ts           |  3 +++\n tests/scenarios/B2-09b-allowance-crash.test.ts       |  3 +--\n tests/scenarios/K3-05-review-round.test.ts           |  3 +--\n tests/scenarios/K3-06-mixed-batch.test.ts            |  3 +--\n tests/scenarios/K3-08-wait-reply.test.ts             |  3 +--\n tests/scenarios/K3-09-restart-between-calls.test.ts  |  3 +--\n tests/scenarios/K3-10-review-round-cells.test.ts     |  3 +--\n tests/scenarios/K3-11-review-reasons-r2.test.ts      |  3 +--\n tests/scenarios/K3-15-card-hold.test.ts              |  3 +--\n tests/scenarios/K3-16-approval-round.test.ts         |  3 +--\n tests/scenarios/K3-16-proposal-round.test.ts         |  3 +--\n tests/scenarios/K3-17-review-answer-shape.test.ts    |  3 +--\n tests/scenarios/K3-18-one-card.test.ts               |  3 +--\n tests/scenarios/K3-19-review-unavailable.test.ts     |  3 +--\n tests/scenarios/K3-26-inventory-scenarios.test.ts    |  3 +--\n tests/scenarios/K3-27-review-claim-close.test.ts     |  3 +--\n tests/scenarios/K3-28-attested-continuation.test.ts  |  3 +--\n tests/scenarios/K3-29-maintenance-review-run.test.ts |  3 +--\n tests/scenarios/K3-29-recovery-continuation.test.ts  |  3 +--\n tests/scenarios/K3-29-recovery-round.test.ts         |  3 +--\n tests/scenarios/K3-29-startup-variants.test.ts       |  3 +--\n tests/scenarios/K3-37-stopped-review-round.test.ts   |  3 +--\n tests/scenarios/K3-42-truncated-command.test.ts      |  3 +--\n tests/scenarios/K3-42-unexpanded-r2.test.ts          |  3 +--\n tests/scenarios/K3-44-crr-kind4.test.ts              |  3 +--\n tests/scenarios/K3-44-hold-restart.test.ts           |  3 +--\n tests/scenarios/K3-45-review-incomplete-r2.test.ts   |  3 +--\n tests/scenarios/K3-R1-second-cleanup.test.ts         |  2 +-\n 32 files changed, 41 insertions(+), 63 deletions(-)\n(untracked: .lead-ref/ only, as provided)",
 "noticed": "1. tests/composition/K-R-previous-turn-bounds.test.ts:87-88 (new numbering). The comment at :88, \"The four assertions of the counted case, now under an absent seam\", refers to a counted case that no longer exists in this file. Also, :87 `expect(continued.briefPreviousRunId, ...).not.toBe('')` is implied by :89's `.toBe(continued.cancelledRunId)`, which carries the same message. Not changed. 2. test-rule-sheet-v2.md A7 entry 3 still says `executeChecks: false`. This is already covered by the A7 note in t-w2r2-findings.md §0, and the fix belongs to the next sheet version. Not changed."
}
######## v2:025473665d9639f727dea84b72e5630bb6c8cf7e715b4ce76806c2db22e03bd0
{
 "group": "w2r2-A (W2c-01, W2c-06, W2c-11, W2c-14)",
 "rows": [
  {
   "row": "W2c-01",
   "result": "done",
   "files": [
    "/home/han001/dsh-work/scratch/w2r2-A/tests/work-graph/S4C2-goal-triggers.test.ts"
   ],
   "what": "tests/work-graph/S4C2-goal-triggers.test.ts:529-538 (was :537-547): the BLOCKED comment and the `archiveAt` taken from the reader's own output are replaced. `archiveAt` is now the `requestedAt` of the `rework.entries` item whose `ref` equals `archiveRef` (compared by canonicalJson), on the archive Task's TaskRow, from the graph read the test already makes after the archive (`graph`, :488-490 now). The item is used as returned, and the test throws if it is missing. The pairwise-different checks and the whole-result `toEqual` are unchanged and now pin the archive `at` to that public value. Deleted: the old :564-678 (the blank line, the section comment, the BLOCKED comment :569-577 and the whole `w2-base` describe). Deleted imports and names that only that describe used: `describe` (vitest), `ActorRef`, `TaskAttemptRef` and `TaskTriple` (dispatch import cut to `RunRef`), `NoProgressKeyV1`, `TaskRequeueSnapshotV1` (task-requeue import cut to `TaskRequeueRef`), the lookup-ports import (`RecordLookupPort`, `RecordLookupRequest`), the ports import (`EncodedRecord`, `GoalRecordTransactionPort`) and `encodeTaskRequeueSnapshot`. Its constants (P, G, PLAN_AT, REWORK_AT, ARCHIVE_AT) were inside the describe and went with it. Header :22-29: removed the BLOCKED/R-20 sentence and the 'Apart from that one w2-base test,' clause. The file ends at the 3d test's `});`. Test run: S4C2-goal-triggers 3 of 3 passed (3a, 3c, 3d).",
   "deviations": "Three small wording changes inside the header lines the row names (:24-30). (1) 'the rework's and the Plan's are read back' became 'the rework's, the Plan's and the archive's are read back from their own records through a public read', so the header stays true now that the archive time is also read publicly. (2) 'No lookup port, …' starts the sentence after the deleted clause. (3) The next three header lines (:31-33 old) were rewrapped, wording unchanged. The new code comment at :529-532 replaces the deleted BLOCKED comment and describes the new read. Equality of `ref` with `archiveRef` is tested with canonicalJson (already imported and used in this test), not a field-by-field check."
  },
  {
   "row": "W2c-06",
   "result": "done",
   "files": [
    "/home/han001/dsh-work/scratch/w2r2-A/tests/helpers/S2B-r2-track-support.ts"
   ],
   "what": "tests/helpers/S2B-r2-track-support.ts: deleted `seedRawRunVariant` with its JSDoc (old :42-82), the `canonicalJson, type JsonValue` import (old :13), the `RunRef` import (old :14) and `const RUN_SCHEMA_ID` (old :16) with the blank line after it. grep confirmed no caller of seedRawRunVariant anywhere in tests/. The file is now the header, the S2B-track-fixture import, R2_DAY_FROM/R2_DAY_TO and seedRealTrackRuns. Typecheck 0 errors. The direct importers (S2B-r3-consultation-cap, S2B-r2-r7-keyed-read-cap, S2B-r2-r3-track-pagination, S2B-r2-r4-bound-workspace) all passed.",
   "deviations": ""
  },
  {
   "row": "W2c-11",
   "result": "done",
   "files": [
    "/home/han001/dsh-work/scratch/w2r2-A/tests/work-graph/A2-disposition-change.test.ts"
   ],
   "what": "tests/work-graph/A2-disposition-change.test.ts:361-364: a comment only, added to the guard-2 `unknownOutcome` JSDoc. It says that, unlike `restartedHost`, which rebuilds `entry` under the new Host, the `entry` passed here is the B2 fixture's (`b2.entry`). It is not used on this W-14 missing path (`src/core/agent-runtime/run-reconcile.ts:303-308`); only the Kernel-terminal branch records through it (`:397`, the only `deps.entry` use in that file). No code change. Typecheck 0 errors.",
   "deviations": "The comment also names `:397` as the only place that uses `entry` (from the row's own problem text, checked with grep). Nothing else."
  },
  {
   "row": "W2c-14",
   "result": "done",
   "files": [
    "/home/han001/dsh-work/scratch/w2r2-A/tests/work-graph/unknown-call-review-list.test.ts"
   ],
   "what": "tests/work-graph/unknown-call-review-list.test.ts:289: `later` is now `const later = await createPending(world, laterTask, 'k3-list-cursor-later')` (was an unassigned `createNeedsDecision`). Comment :287 now says pending_review. :302-310: the pending-only query with `wider.value.nextCursor` as returned now asserts `toMatchObject({ status: 'ready', value: { nextCursor: null } })` and then `expect(page.value.items).toEqual([later])` (exactly [later]). Comment :302-304 updated: only `later` is left, `pending` sorts before the bound, and the cursor is not `invalid`. The wider-page part of the row is unchanged. The store-page test was not touched or run. Ran only this test with -t 'a cursor outside the filter is a keyset bound, not invalid': memory and SQLite both passed (2 passed, 9 skipped).",
   "deviations": "'Exactly [later]' is checked with `toEqual` on `page.value.items`, after a `toMatchObject` on status and `nextCursor: null` and a narrowing guard. This is the original single `toMatchObject` split in two so the item comparison is exact rather than a subset match."
  }
 ],
 "typecheck": "flock /home/han001/dsh-work/scratch/tc.lock npm run -s typecheck (tsc -p tsconfig.json, which includes tests/**, and tsc -p tsconfig.ui.json): exit 0, 0 errors.",
 "tests": "1) npx vitest run --maxWorkers=2 tests/work-graph/S4C2-goal-triggers.test.ts tests/work-graph/S2B-r3-consultation-cap.test.ts tests/work-graph/S2B-r2-r7-keyed-read-cap.test.ts tests/work-graph/S2B-r2-r3-track-pagination.test.ts tests/work-graph/S2B-r2-r4-bound-workspace.test.ts: 5 files passed, 17 tests passed, 0 failed, 0 skipped. Duration 23.06 s. S4C2-goal-triggers 3/3 (was 4 before the w2-base describe was deleted). 2) npx vitest run --maxWorkers=2 tests/work-graph/unknown-call-review-list.test.ts -t \"a cursor outside the filter is a keyset bound, not invalid\": 1 file passed, 2 tests passed (memory 1096 ms, sqlite 3402 ms), 9 skipped by the name filter, 0 failed. Duration 7.92 s.",
 "diffStat": " tests/helpers/S2B-r2-track-support.ts             |  46 -------\n tests/work-graph/A2-disposition-change.test.ts    |   5 +-\n tests/work-graph/S4C2-goal-triggers.test.ts       | 160 +++-------------------\n tests/work-graph/unknown-call-review-list.test.ts |  11 +-\n 4 files changed, 29 insertions(+), 193 deletions(-)",
 "noticed": "S4C2-goal-triggers.test.ts header :31 (new numbering) still says platform-issued times are what the public steps returned '(or a public task-timeline read)'. The archive time now comes from the task-graph read. That is also a public step's return, so the line is not false, but it does not name the graph read. Left as it was, since it is outside the row's lines. Nothing else noticed. The clone's working files stay LF; git's 'LF will be replaced by CRLF' warning comes from the clone's autocrlf setting, and the bytes are unchanged."
}