# PC-1b audit 2: the frozen findings table for rework 2 (lead, 2026-10-22 night)

Codex audited rework 1 (`1b5183a`) in four parts and one question (`codex2/pc/a3/P.out.md`, `S.out.md`, `R.out.md`,
`J.out.md`, `X.out.md`): P 违规 5, 不整洁 1; S 违规 6, 不整洁 3; R 不整洁 2; J 违规 5, 不整洁 1; no 会出错. The lead ran
the full suite on a clean clone of `1b5183a` (bubblewrap, 5 workers): build, typecheck, check:architecture and both
generators' `--check` pass; 776 of 792 test files pass; 32 tests fail in 16 files, all from S-01 (putting back the two
early returns makes all 16 pass, 86 tests). A1, red in DSH's run, passes with bubblewrap. Row X below fixes the 16.

Rework 2 does exactly the rows whose ruling is **fix**, as the last column says, and rule T. Each test row: change the
case, show it fails against the mutation the row names (undo it: `git diff` shows no production change left), then
show it passes; report the mutation and both results. Expected values are literals or hand-computed; nothing is taken
from production code, the generated pack, `preparedTexts()` or a captured request, except the two public identifiers
J2-01 names.

## X: the S-01 regression (rule: keep S-01 strict)

S-01 stays: a start always compares the five fields. Production can reach the check without `selection` (the
programmatic Host and platform injection, `src/app/host.ts` ~140, `src/composition/create-platform.ts` ~249), so the
comparison guards production too. The 16 files fail by wiring: the real AG2b Host freezes the model id
`runtimeModelId(...)` (`src/app/runtime-configuration.ts` ~451, ~474), while the scenario Work double
`ag2bWorkRuntime` (`tests/scenarios/harness.ts` ~779) builds the same model without `selection`, so its id falls back
to the revision `ag2b-work-model@1`; preparation runs on the Host, the start on the double. No test means a binding
change.

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| X-01 | 违规 | **fix** | Exactly Codex's patch (`./.dsh-ref/audit/X.out.md` §3): `ag2bWorkRuntime` gains an optional `workModelId`; when given, the Work model carries `selection: { modelId: workModelId, promptPack: 'platform', reasoningReplay: 'current_run' }`. `openWorkRoot` (`tests/scenarios/support/common.ts` ~731) and `openReviewWorkRoot` (`tests/scenarios/support/review-work-root.ts` ~48) pass `runtimeModelId({ provider: 'deepseek', model: 'ag2b-scripted-work', secretEnvironmentVariable: AG2B_SECRET_VAR })`, the id the Host computes from the AG2b startup binding (`tests/helpers/AG2b-collaboration-fixture.ts` ~277). Other callers of `ag2bWorkRuntime` and Query unchanged; no test body changes. One line of comment on the option: why (the double carries the Host's model id so a run the Host prepared starts on it). The lead's probe of this patch: see "Lead probe" below. |

## P

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| P2-01 | 违规 | **rejected** | The spy on the body store's `read` injects a fault; it reads no fact. The frozen fixture stays. P2-02's literal reason proves the entry's own branch answered. |
| P2-02 | 违规 | **fix** | `PC-entry-frozen-continuation` (P-09 case): also assert the public `reason` literally, `the frozen continuation-brief template could not be read: PC injected entry prompt-text read failure`. Mutation: the entry's unreadable branch throws instead of returning (`execution-entry-service.ts` ~1011) → RED. |
| P2-03 | 违规 | **accepted as built** | No public read of the snapshot preparation keeps exists, and none is added. P-10's snapshot sub-item stays covered by the pure `snapshotRuntimeConfiguration` contract case plus the call site (`execution-preparation.ts` ~393–396). Recorded as a book correction. |
| P2-04 | 违规 | **fix** | `PC-prepare-prompt-freeze`: while paused, both cases also change `reasoningReplay` from `none` to `current_run`; the Query case also asserts `packId: 'platform'` and `reasoningReplay: 'none'` literally. Mutations: Work's and Query's `reasoningReplay` read after the await (`execution-preparation.ts` ~538, `query-preparation.ts` ~294); Query's `packId` read after the await → each RED. |
| P2-05 | 违规 | **fix** | Rule T (1): the three old cases in `PC-entry-frozen-continuation` (~75, ~124) and `PC-entry-frozen-review` (~75) lose the 180,000 ms R1 added. |
| P2-06 | 不整洁 | **fix** | Rule T (2). |

## S

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| S2-01 | 违规 | **rejected** | Under S-01 every caller that prepares and starts must use one model binding; `S2B-runtime-steps-fixture` passing the start configuration's model to preparation for every custom-host caller is that rule, and `task-claim-fixture`'s optional `model` is what carries it. L-04's "default unchanged" is superseded (book correction). The callers Codex names pass in the full suite. |
| S2-02 | 违规 | **fix** | `PC-model-budget-preview` (S-06 case): also assert the two requests' `selection.inputTokens` `[700, 700]` and `selection.budget` `[744, 800]` literally, from the public record. Recompute both by hand from the case's window, counter and caps first (`budget = window − cap`); if a real run disagrees, report the field, do not tune. Mutation: the preview alone measures with zero totals (`model-budget.ts` ~108 `this.measure(request, { input: 0, output: 0 })`) → RED. |
| S2-03 | 违规 | **fix** | Same file ~99–100: the reserve expectations become the literals `700` and `256`. |
| S2-04 | 违规 | **fix** | Rule T (1): the old case at ~81 loses the 120,000 ms R1 added. |
| S2-05 | 违规 | **fix** | `PC-send-frozen-prompt` (~56, ~91) and `PC-send-platform-root` (~60, ~96): inject literal input templates and strings, hand-write the whole expected input, compare it whole with the model's message; no expectation from `prepared.input` or a manifest. Mutation: preparation renders a section header wrongly (e.g. `context-rendering.ts` ~34 drops one character) → RED. |
| S2-06 | 违规 | **fix** | `PC-send-start-check`, Query "after entry only observes": after the first entry, make the original binding's resolver answer another provider/model; start again publicly; assert the original execution's observation comes back and no new model call. Mutation: compare the binding again before the observation return (`query-execution.ts` ~226) → RED. |
| S2-07 | 不整洁 | **fix** | Rule T (2). |
| S2-08 | 不整洁 | **fix** | Rule T (2). |
| S2-09 | 不整洁 | **fix** | Rule T (2). |

## R

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| R2-01 | 不整洁 | **fix** | Rule T (2). |
| R2-02 | 不整洁 | **fix** | `runtime.ts` file header: the no-argument factory's `readPromptRecord` validates the ref and answers a complete Work ref `unavailable`; every other member stays `unsupported`. |

## J

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| J2-01 | 违规 | **fix** | `PC-joint-budget-removal` (a): drop the two regex normalizations. Fill the hand-written expected input with the brief digest from the public `readContinuationBrief` and the round id from `openVerification`'s returned ref (both public identifiers, not behaviour), then compare the model's current input whole. Mutation: where the input renders the brief reference, write another digest of the same length (e.g. the last hex digit changed) → RED. |
| J2-02 | 违规 | **fix** | Delete the `preparedTexts()` calls and the assertions that hang on them (`PC-joint-prepare-freeze` ~272, ~293; `PC-joint-freeze-and-pin` ~116; `PC-joint-budget-removal` ~77, ~127, ~151). Where the row still needs the fact, take it from the model request or `readPromptRecord`; PC-15 (a) compares the hand-written input of J2-01. |
| J2-03 | 违规 | **rejected** | R-12 asks the tool JSON, body, `toolsDigest` and `toolSpecsRef.digest` to agree, a relation, and that is built. The Work tools' content is checked literally by PC-15 (a)'s `EXPECTED_TOOLS`. |
| J2-04 | 违规 | **fix** | J-07 completed. The lead lets `tests/runtime/S4C2-assembly.test.ts` and `tests/work-graph/S3-role-profiles.test.ts` use literal expectations of today's header values instead of `CONTEXT_SECTION_HEADERS`, nothing else changed in them; `S3-context-assembler.test.ts` likewise. Then delete the export (`context-rendering.ts` ~52), the re-export (`context-assembler.ts` ~16) and its allowlist entry. Mutation: put the allowlist entry back → the reach test RED. |
| J2-05 | 违规 | **fix** | Allowlist ~1286: `PromptRecordRequestV1` stays `wire-format`; its note says it is the element type of `PromptRecordReadResultV1.requests`, returned by `RuntimeExecutionPort.readPromptRecord`. |
| J2-06 | 不整洁 | **fix** | Rule T (2). |

## Rule T: per-test limits in the `PC-` test files

1. The old cases P2-05 and S2-04 name lose the explicit limit rework 1 added; they run under the repository default.
2. Every other explicit per-test limit in `tests/runtime/PC-*`, `tests/work-graph/PC-*` and `tests/contracts/PC-*` is
   `60_000` (S2-07, S2-08, S2-09, J2-06, P2-06, R2-01). Lowering a limit is not raising one.

No other test's limit changes.

## DSH's own items (rework 1 reply §7)

- §7.1 (J-07 partly done): stopping at the whitelist was right; J2-04 completes it.
- §7.2 (A1 red): an environment failure; it passes with bubblewrap. Closed.
- §7.3 (regex placeholders): replaced by J2-01.
- §7.4 (`.gitignore` and `git init/add` in `PC-joint-freeze-and-pin`): accepted; the Kernel refuses a resume when the
  workspace identity changed (`vendor/coding-agent/dist/core/runtime/recovery/recovery-coordinator.js` ~265–268), and the
  test hides no prompt behaviour.
- §7.5: P-10 → P2-03 accepted; R-04's fault injection through the public `RawArtifactStorePort.put` accepted.

## Scope added for rework 2

`tests/scenarios/harness.ts`, `tests/scenarios/support/common.ts`, `tests/scenarios/support/review-work-root.ts` (X-01);
`tests/runtime/S4C2-assembly.test.ts`, `tests/work-graph/S3-role-profiles.test.ts` (J2-04). The frozen fixtures
`tests/helpers/PC-platform-fixture.ts` and `PC-kernel-fixture.ts` stay unchanged.

## Book corrections (recorded for the evidence)

- S-01: the start check guards production as well (programmatic injection can pass a model without `selection`); the
  lead's earlier "only tests reach it" was wrong.
- L-04: "default unchanged" is superseded by S-01: a helper that prepares and starts uses one model binding.
- P-10: the snapshot's `selection` has no public read; the pure contract case stands for it.

## Lead probe

The lead applied X-01's three helper changes in a clean clone of `1b5183a` (S-01 strict) and ran every test file that
reaches `openWorkRoot`, `openReviewWorkRoot`, `authorizeWithoutBegin` or their review, shell, brief and fuzz supports,
with bubblewrap: 56 files, 192 tests, all pass, the 16 failing files among them (`impl/pc/pc1b-r1-x-probe.{sh,log}`).
The clone was restored afterwards. The probe edits are the lead's check, not the code to commit: build X-01 from the
row and Codex's patch.
