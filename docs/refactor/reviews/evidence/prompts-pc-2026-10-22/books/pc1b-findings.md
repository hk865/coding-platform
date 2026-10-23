# PC-1b audit 1: the frozen findings table (lead, 2026-10-22)

Codex audited PC-1b in four parts (`codex2/pc/a2/P.out.md`, `S.out.md`, `R.out.md`, `J.out.md`) on the tree at
`c1c7af4`: P 会出错 4, 违规 7, 不整洁 1, 建议 1; S 会出错 1, 违规 11, 不整洁 1; R 会出错 5, 违规 9; J 违规 9. The lead
ran the full suite on a clean clone of `c1c7af4` (bubblewrap, 5 workers): build, typecheck, check:architecture and both
generators' `--check` pass; 786 of 789 test files pass, 5 tests fail in 3 files (rows L-01…L-03). A Claude subagent
traced those failures in a separate copy (decision 65); its findings are in the L rows.

Rework 1 does exactly the rows whose ruling is **fix**, as the last column says. Rows marked **same as** are done
once, under the row they name. Each test row: write or change the case, show it fails against the mutation named in
the row or in Codex's report (undo it afterwards: `git diff` shows no production change left), then show it passes.
Report the mutation and both results. Expected values are literals or hand-computed; nothing is taken from
production code, the generated pack included.

## P

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| P-01 | 会出错 | **fix** | `architecture-reminders.ts` joins the scope. Its render chain takes `PromptTextsV1`; preparation passes the resolved pack (`context-work-recipe.ts` ~151); only the no-argument pure call keeps the platform default. Test through public preparation: a pack whose `architecture.noObservation` is a literal `CUSTOM`, no observation, ample budget → the input holds `CUSTOM`. Mutation: read the generated pack again at ~193. |
| P-02 | 会出错 | **rejected for PC-1** | A required slot that renders empty is a pack problem; PC-2 owns it (book v4 rule at ~169–171: one error class mapped to `invalid`). In PC-1 only the platform pack and test sources reach preparation. |
| P-03 | 会出错 | **fix** | The platform branch normalizes ids as the old loader did (trim) before the `PLATFORM_SKILLS` lookup; an unknown id after trimming is `invalid`. Test: `enabledIds: [' platform-secretary ']` selects the secretary Skill. Mutation: drop the trim. |
| P-04 | 会出错 | **rejected for PC-1** | PC-2 rule 5 (book v4 ~186–188) fixes the omission markers: a person's pack may not override them and the guard keeps its literals. No change now. |
| P-05 | 违规 | **fix** | `W2-role-skills`: restore the real-request assertions of the base (secretary+scribe, the explicit empty selection, zero model calls on the error cases) and the 60,000 ms limit; change only the wiring to the frozen inputs. |
| P-06 | 违规 | **fix** | `PC-prepare-skill-selection`, `PC-prepare-review-freeze`, `PC-prompt-texts-store`: inject platform Skill contents and review strings that differ from the generated pack (literals), check the frozen content, metadata and `source` against hand-written values and hand-computed digests. Mutation: the selector ignores the passed texts and reads the generated pack. |
| P-07 | 违规 | **fix** | Digest negatives use bodies of the same UTF-8 byte length with a different digest; keep a separate length negative. Mutation: delete the digest check in `checkPromptBody` (`prompt-set.ts` ~212). |
| P-08 | 违规 | **fix** | Both entry tests (`PC-entry-frozen-continuation`, `PC-entry-frozen-review`) inject a literal for a string the entry's re-render actually uses, change it after preparation, start, and check the frozen result. Mutation: the entry renders the frozen template with the generated pack's strings. |
| P-09 | 违规 | **fix** | Fail the prompt-text read only at the entry step (not in the driver's earlier read), from a real public preparation; assert the entry's `unavailable` and zero model calls. Mutation: delete the entry's own unreadable branch. |
| P-10 | 违规 | **fix** | Work and Query public preparation with a pausable, counting `PromptPackSourcePort`: while paused, change the original configuration object; assert the frozen selection, provider and model are the originals, Work's snapshot keeps `selection`, and `resolve` ran exactly once. Mutations: read the selection after the await; resolve twice. |
| P-11 | 违规 | **fix** | With the fixture's `failPutContentType`, fail the prompt-text put (`PROMPT_TEXT_CONTENT_TYPE`) for Work and Query: preparation `unavailable`, nothing startable, zero model calls. Mutation: map the failure to `invalid`. |
| P-12 | 不整洁 | **fix** | Correct the two comments (`execution-preparation.ts` ~62, `query-preparation.ts` ~160): a missing source installs the platform default. |
| P-13 | 建议 | **rejected** | No refactor in a rework; the two tables agree today. PC-2 may move the table when it changes the guard. |

## S

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| S-01 | 会出错 | **fix** | Delete both early returns (`execution-driver.ts` ~121, `query-execution.ts` ~100); always compare the five fields through `promptSelectionOf`. `S3-prepared-context-admission` then prepares and starts with the same model binding (the lead allows the smallest change to that test's setup, or to the helper it uses, see L-04); its business assertions stay. Test: a model without `selection`, prepared as `test/test`, started as another provider/model → `forbidden`, zero model calls. |
| S-02 | 违规 | **rejected** | The Kernel's `previewRequest` returns a verdict, not a request, and the Kernel hands the wrapper the request without `responseFormat` (`observed-model-run.ts` ~390, ~350). Without `finalRequest` at ~350, `responseFormat` would never be sent. One transform shared by the preview and the wrapper is what ruling 20 is for (the preview measures what is sent); the book's "it sends what the Kernel hands it" is corrected to that. PC-15 (b) guards it. |
| S-03 | 违规 | **fix** | One shared measuring result carries the cap, the count and `fits`; the preview, the send check and the facts' `maxOutputTokens` all take it; delete the outer copies of the formula. |
| S-04 | 违规 | **fix** | Same as L-01. |
| S-05 | 违规 | **fix** | PC-15's platform case, split by the lead (see "PC-15" below). |
| S-06 | 违规 | **fix** | The reserve case goes through the platform's public preparation and start: a real tool call, then a second model request; counter 700, first output usage 200; literal assertions: caps 256 and 200, costs 956 and 900, on the requests and in the records. Mutation: a new meter per request. |
| S-07 | 违规 | **fix** | `PC-send-frozen-prompt`, `PC-send-platform-root`: inject literal templates, Skills and Host instruction; hand-build the whole expected system (and the input the row names); compare whole; assert the old Skill is present in both kinds of run. PC-06's joint half is J-01. |
| S-08 | 违规 | **fix** | Add Query's provider and model changed alone; resume with a live handle and a changed binding → `forbidden`; resume without a live handle → `busy` first; Query after entry only observes. Zero new model calls in each. |
| S-09 | 违规 | **fix** | PC-10: also assert no Work authorization and no Query reservation or admission was captured, and the public read shows no request record. Mutation: await the tool-spec put after the reservation. |
| S-10 | 违规 | **fix** | PC-07: assert the paused state through the public observation, let the first run end normally (no swallowed error), assert the resume added a request with a new identity, compare its system byte for byte with the first. (J-03 same as this.) |
| S-11 | 违规 | **fix** | `B1-kernel-assembly`: restore the 60,000 ms limit. |
| S-12 | 违规 | **fix** | Remove the external `onContextSelected` option and its forwarding (`observed-model-run.ts` ~101, ~393); keep the internal callback that records reports by `requestId`. |
| S-13 | 不整洁 | **fix** | Remove the stale `enabledIds` clause of the comment at `observed-model-run.ts` ~205. |

## R

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| R-01 | 会出错 | **fix** | Work prompt validation checks the exact key sets of `toolSpecsRef` and its `source`; add the two nested unknown-key rejections (authorization input, permit snapshot, event). |
| R-02 | 会出错 | **fix** | The WorkGraph Query manifest loader (`queries/query-execution.ts` ~468) decodes `promptSet` with `decodePromptSetV1`; a missing or broken set is `invalid` at `bindPreparedQuery`, and the state does not move. Test through the public bind. |
| R-03 | 会出错 | **rejected** | The admission's comparison of the reservation's `requestDigest` existed before PC-1b and keeps its `invalid` (§2 rule 1). Ruling 27's `idempotency_conflict` covers the prompt facts at admission and every immutable fact at the usage writes, as built. |
| R-04 | 会出错 | **fix** | In `readPromptRecord`, check `target.contentType` against the expected type before the cache lookup (`runtime.ts` ~636); test: same digest and size, another content type → `invalid`. |
| R-05 | 会出错 | **fix** | The no-dependency `createAgentRuntime()`'s `readPromptRecord` validates the ref and answers a complete Work ref with `unavailable`, "model request reads are not wired"; add the case. |
| R-06 | 违规 | **fix** | Replace the direct `records.readMany` check with `ModelRequestReadPort`; keep the public consumption that follows. |
| R-07 | 违规 | **fix** | The claim-slot expectation is hand-written (plain string or `JSON.stringify` of a hand-written object), not `canonicalJson`. |
| R-08 | 违规 | **fix** | Authorize two permits in a row and assert the second has `sequence: 2`, then consume the first; keep the final read. Mutation: count only consumed permits. |
| R-09 | 违规 | **fix** | Usage writes: each immutable fact (`requestDigest`, `reservedInput`, `reservedOutput`, each prompt fact) changed alone → `idempotency_conflict`, the public read keeps the row. Admission: each prompt fact changed alone → `idempotency_conflict`; `requestDigest` stays `invalid` (R-03). |
| R-10 | 违规 | **fix** | Add `selection.budget` missing and illegal to the Work codec rejection tables (snapshot and event). |
| R-11 | 违规 | **fix** | Query codec: each new field malformed alone, unknown keys at each level, and a list whose first element is valid and second broken. |
| R-12 | 违规 | **fix** | PC-09: for each request of both runs, check the tool JSON, its body, `toolsDigest` and `toolSpecsRef.digest` agree, and every `systemDigest` against the hand-rebuilt system. (J-05 same as this.) |
| R-13 | 违规 | **fix** | Collect the digests the set and the requests refer to (templates, strings, base, Skills, tool specs) and compare the `texts` key set exactly, then verify each body. Mutation: skip the template and string reads (`runtime.ts` ~648, ~652). |
| R-14 | 违规 | **fix** | Replay the captured Query reservation command with only one new prompt fact changed → `idempotency_conflict`. |

## J

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| J-01 | 违规 | **fix** | PC-06 joint: change a real section label (not the prelude) and the Skill file after preparation; compare the whole system and input against hand-written text for Work and Query; assert the old Skill is present; check each frozen text's hand-computed digest (templates, strings, base, Skills). Mutation: the send path drops the Skills. |
| J-02 | 违规 | **fix** | PC-06 joint, the entry half: a continuation and a K3 review through the frozen fixture; a relevant string changed after preparation; the entry passes and the model receives the hand-written frozen content. |
| J-03 | 违规 | **same as S-10** | |
| J-04 | 违规 | **fix** | PC-08: inject a literal base and Skill, no Host instruction, hand-write the old binding's whole system; after the new binding is installed compare against that literal, not against `preparedTexts()`. |
| J-05 | 违规 | **same as R-12** | |
| J-06 | 违规 | **same as S-05** | |
| J-07 | 违规 | **fix** | Delete the seven exports used only by tests and the private `DEFAULT_BRIEF_TEXTS`, and their eight allowlist entries. The lead lets the old tests that import them use literal expectations of today's values instead, nothing else changed in them: `tests/contracts/A2-rework-contract-helpers.test.ts`, `tests/scenarios/A1-rework-same-session.test.ts`, `tests/runtime/S3-context-assembler.test.ts`, `tests/work-graph/R5b-initial-plan.test.ts`. |
| J-08 | 违规 | **fix** | The two port members and the five private helpers become `kept-for` with a note matching the check, e.g. `slice 6 of the orchestration design (decision 83, prompts and context): <consumer>; E3 adds the route`; the three result types stay `wire-format` with their reader notes corrected. |
| J-09 | 违规 | **same as S-01** | |

## L (the lead's full suite)

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| L-01 | 违规 | **fix** | `tests/app/PC-host-prompt-selection.test.ts` ~262 asserts the deleted directory exists; a clean checkout fails it. The lead lets this file change: remove the existence assertion and its unused import; keep the re-export and absolute-path assertions (~260–261). No placeholder file. |
| L-02 | 违规 | **fix** | `tests/business/S1-archive-flow.test.ts` IT16, IT27 (sqlite) fail with ENOENT realpath `<tmp>/skills`. Test wiring: `workflowForFixture` (`tests/helpers/S1-workflow-archive-fixture.ts` ~607–610) builds a Host double that selects `b2-trusted-skill` under `<dir>/skills` and never creates that directory; the old code loaded Skills only at start, which this fixture never reaches (~597). Production is unchanged in outcome (a missing custom directory failed at start inside the Kernel; it now fails at preparation, as ruling 15 intends). The lead lets `tests/helpers/S1-workflow-archive-fixture.ts` change: write `skills/b2-trusted-skill/{skill.json,content.md}` under `base.directory` before the runtime is built, as `tests/helpers/B2-runtime-fixture.ts` ~186–189 does (the subagent's probe, `./.dsh-ref/pc1b-l-probe.diff`, passes S1-archive-flow and S1-session-maintenance 18/18). Nothing else in that file. |
| L-03 | 违规 | **fix** | `tests/work-graph/R3c-plan-adoption.test.ts` (memory, sqlite) fail with "the Kernel is not wired to load a custom Skill directory" (`prompt-set-texts.ts` ~281): direct preparation callers (`tests/helpers/task-claim-fixture.ts` ~592–598) pass no `kernel`, and preparation's `kernel` is optional. Production always passes it (`execution-contracts.ts` ~273, `create-platform.ts` ~1233). Ruling 15 says the public `FileSkillLoader`: default to it, `options.kernel?.FileSkillLoader ?? FileSkillLoader` imported from `vendor/coding-agent/dist/public-api.js` (the probe passes R3c 2/2 and `PC-prepare-skill-selection` 5/5). Delete the `unavailable` branch. |
| L-04 | — | **scope** | For S-01: if `S3-prepared-context-admission` cannot use one model binding for preparation and start by changing the test file alone, the lead lets `tests/helpers/S2B-runtime-steps-fixture.ts` or `tests/helpers/task-claim-fixture.ts` gain an optional parameter for the model binding, default unchanged; report which. |

## PC-15 (rows S-05, J-06)

The frozen fixture is enough; no fixture change. Codex worked out the construction read-only
(`./.dsh-ref/audit/pc15.out.md`; it withdraws S-05's claim that a crashed run cannot give history). The lead splits the
row in two, in a new file `tests/runtime/PC-joint-budget-removal.test.ts`:

- **(a) The platform case, Work, through the frozen fixture's public steps.** Pack base the literal `"B"`, an explicit
  empty Skill list, tools `['read']`. Run 1 answers with 16,384 ASCII `X` and no tool call and ends `completed`. Close
  its verification through the platform's public steps (`registerCheckConfiguration` with an empty check list,
  `evidence.openVerification`, `finalizeChecks`: the round ends `INCONCLUSIVE`), then `continuation()`, `prepare()`,
  `start()` on the same Session. Before run 2's first `prepare()`, install the binding with the long Host instruction,
  the window, cap 256 and `inputCounter: null` (the byte counter). The sizes come from pc15.out.md §3: hand-write the
  expected inputs and the tool JSON, compute `e1`, `e2`, `t` from them, and set `hostLength = 16,564 + e1`,
  `window = 21,213 + e1 + e2 + t`; check `W + D ≤ 100,000` (the task budget). Assert: different runs, same Session;
  run 2's system is exactly `"B\n\n" + host`; no old user or assistant message id in its request; the current input
  whole; run 2 `completed`; `readPromptRecord` shows one request with `maxOutputTokens: 256`,
  `selection.inputTokens === selection.budget === W − 256`, and the removal counts `historyExchange: 1,
  historyConclusion: 1`, all others 0. Do not assert that no `X` appears: the brief carries the first 4,000.
  **Base proof by mutation:** give the Kernel the unmerged `"B"` and append the Host instruction once just before the
  meter (the base's late append: `git show pc1b-base:src/core/agent-runtime/observed-model-run.ts` ~257); run 2 then never reaches the
  model and fails with the capacity error (`iterator_threw`, projected as crashed). Undo it.
- **(b) `responseFormat`, a direct `runObservedModel` call** with `tests/runtime/PC-frozen-prompt.ts`: base `"B"`, no
  Host instruction, the reference Skill `project-conventions` selected, `input: 'Q'`, `allowedTools: []`,
  `responseFormat: { type: 'json_object' }`, an async counter returning the final request's UTF-8 bytes + 4,096,
  window 5,314, cap 256 (pc15.out.md §4: 236 + 726 + 40 + 4,096 + 256 = 5,354 does not fit; without the Skill 4,628
  fits). Assert the Skill is removed (`removed.skillReference: 1`, the rest 0), the model receives
  `systemPrompt: 'B'`, the user `"Q"`, no tools and the `responseFormat`; one meter entry with `inputBytes: 276`,
  `reservedInput: 4,372`, `reservedOutput: 256`; the report `inputTokens: 4,372`, `budget: 5,058`. Mutation:
  `previewRequest: request => o.meter.preview(request)` (no final transform) → zero model calls, no meter entry, the
  capacity error.

The numbers are Codex's static arithmetic. Recompute each by hand from the hand-written request; if a real run
disagrees, find the field that differs and report it; do not tune a number until the test passes.

## Scope added for rework 1

`src/core/agent-runtime/architecture-reminders.ts` (P-01); `tests/app/PC-host-prompt-selection.test.ts` (L-01);
`tests/helpers/S1-workflow-archive-fixture.ts` (L-02); the four old tests of J-07; `tests/helpers/S2B-runtime-steps-fixture.ts`
or `tests/helpers/task-claim-fixture.ts` only as L-04 says; the new `tests/runtime/PC-joint-budget-removal.test.ts`.
The frozen fixtures `tests/helpers/PC-platform-fixture.ts` and `PC-kernel-fixture.ts` stay unchanged.

## Book corrections (recorded for the evidence)

- Ruling 20: the wrapper and the preview share the one final-request transform (S-02).
- §5.3 missed `tests/app/PC-host-prompt-selection.test.ts` (L-01), the old fixtures of L-02 and L-03, and the old
  tests that import the constants of J-07.
- §5.1's `frozenPromptInputs(...)` passes `tools: []`, which the WP2 Role install rejects; DSH's
  `tests/runtime/PC-frozen-prompt.ts` stands in for it (Codex: argument plumbing only).
