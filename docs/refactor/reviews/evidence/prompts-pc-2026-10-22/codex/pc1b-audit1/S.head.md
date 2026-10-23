# PC-1b audit, part S: the send path (rulings 16, 20–25)

Your part is `S`: `./.lead-ref/parts/S.diff` and `S-files.txt`: `src/core/agent-runtime/{model-budget,observed-model-run,
execution-driver,query-execution}.ts`, the deletion of `resources/skills/platform-*` and its `runtime-assets.json`
entries, the new helper `tests/runtime/PC-frozen-prompt.ts`, the new `tests/runtime/PC-model-budget-preview`,
`PC-send-*` tests, and the old direct `runObservedModel` tests (`B1-kernel-assembly`, `cpp-source-index`, the three
`R4c-*`, `source-text-loop-migration`, `source-tool-lifecycle`). The book §3.4, §4 (S's row), §5.2 PC-15, §5.3 (S's
lines).

**Look hardest at:**

- **Ruling 20.** One "make the final request" transform, used by the preview; the client wrapper no longer adds
  `systemInstruction` (now inside the base) or `responseFormat`. With a Host instruction and a `responseFormat`, is
  the request the provider receives byte-equal to the base tree's? Give both if not.
- **Ruling 21.** The preview is a method of the run's existing `ModelBudget`; the measuring is one side-effect-free
  async function shared with `wrap`; the preview pushes, persists and reserves nothing; async counters are awaited;
  the next preview reads the same `totals()`.
- **Ruling 22.** The required `prompt` option replaces `skills` and `systemInstruction`; the drivers fill it from
  `promptSet` through `prompt-set-texts.ts`; `runObservedModel` passes `baseSystemPrompt`, `skills`,
  `reasoningReplay`, `previewRequest` and `onContextSelected` to the Kernel.
- **Ruling 23.** Both files of each platform Skill and the ten asset entries deleted (hash `runtime-assets.json`'s
  remaining entries against the files). DSH's question (reply §1 item 3, §9 item 1): git keeps no empty directory, so
  a clean checkout has no `resources/skills`; `tests/app/PC-host-prompt-selection.test.ts:262` asserts that
  `PLATFORM_SKILL_RESOURCE_ROOT` exists. Confirm whether anything else is tracked under `resources/skills`, whether
  that test fails from a clean checkout, and what else reads that directory. Give the fix you would rule (that test
  is outside PC-1b's whitelist).
- **Ruling 16.** The start and resume check compares `promptSelectionOf(model)`'s three fields plus `provider` and
  `model` with `promptSet`; a difference is `forbidden`; a resume without a live handle still answers `busy` first;
  Query compares before entry only. **DSH skips the whole comparison when `model.selection` is undefined** (reply §1
  item 1, §4 item 2) to keep `tests/work-graph/S3-prepared-context-admission.test.ts` green, which prepares with one
  model (`test/test`) and starts with another (`deepseek/s2b-runtime-steps-model`). Is that a test-only path in
  production (rule 5 of the common part)? Under ruling 16, should that old test now be `forbidden`, and is the right
  fix to start it with the model it prepared with? Can any production path build a `BoundModel` without `selection`?
- **Reply §1 item 2, §4 item 3:** the frozen fixture's `frozenPromptInputs` uses `tools: []`, which the WP2 Role
  install rejects; DSH added `tests/runtime/PC-frozen-prompt.ts` instead. Is the helper argument plumbing only, built
  with the production functions of rulings 14–15 (§5.1)? Is the fixture's failure real (cite the rejecting line)?
- **Ruling 24.** Reports keyed by `requestId`, never "the last report"; the facts computed before the meter reserves,
  from the request handed to the wrapper; `maxOutputTokens` = the cap the meter applies, for both kinds of run; Work
  stores the whole facts, Query drops `maxOutputTokens`; `requestDigest` keeps its meaning.
- **Ruling 25.** `onConfiguration` stays synchronous: copy, sort as `buildModelRequest` does, `JSON.stringify`, start
  the put, keep the promise, attach a rejection handler at once; awaited before the first request reaches the meter;
  each request's tools digest checked; a failed store or a mismatch → no reservation, no `beforeCall`, no provider
  call, the run fails `unavailable` through `RuntimeModelCallRejected`; later requests reuse the ref on start and
  resume.
- **Reply §4 item 6:** `SkillContext` through P's `PromptSkillV1` alias.
- **PC-15's platform case is not done** (reply §8). Is DSH's account of the fixture's limits true (cite the lines)?
  What is the shortest test that meets §5.2 within the frozen fixture, or what must the fixture gain?
- **The tests:** PC-15's reserve case (956 / 900 hand-computed), PC-10's S half, the start check (`PC-send-start-check`,
  each field changed alone, model called zero times), the old callers (arguments only; B1's three `skills` cases moved
  to preparation with the same three expectations). Name a mutation each would miss.
