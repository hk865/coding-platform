# PC-1a audit 1: the frozen findings table (lead, 2026-10-22)

Codex audited PC-1a in three parts (`codex2/pc/a1/A1.out.md`, `A2.out.md`, `A3.out.md`) on the tree at `afff716`:
会出错 0, 违规 12, 不整洁 5. The lead checked separately what Codex could not: `vendor/coding-agent/dist` changed only
in the 22 artifacts of the six managed sources, `--check` matches all 64, and the frozen fixture is unchanged; the
`tests/kernel` and `tests/app` regressions pass (the one RL-15b failure was a leftover process from a run the lead
stopped, gone on rerun).

Rework 1 does exactly the rows whose ruling is **fix**. Each test row: write the new case, show it fails against a
mutation of the code it guards (the mutation named in the row; undo the mutation afterwards), then show it passes.
Report the mutation and both results. No production change except the rows that ask for one.

| Row | Class | Ruling | What to do |
| --- | --- | --- | --- |
| A1-01 | 违规 | **fix** | PC-14 through the frozen fixture: a history run on the Session, then the current run with a tool loop; inject a message with `inputs.enqueue` during the loop; under a tight budget check the request the model received keeps both current user messages (real ids and texts) and drops the earlier run's content. Mutation: drop the runner's input acceptance (`runtime-runner.ts` ~656). |
| A1-02 | 违规 | **fix** | PC-12 eligibility cases, hand-computed: long `error` and `cancelled` results before a replaceable success; an output exactly as long as the placeholder; an output whose UTF-8 byte length and character length disagree across the placeholder's length; a tool name other than `read`; a two-call group with one long success result only. Budgets chosen so each case separates the rule from these mutations: a hard-coded tool name, characters instead of bytes, `<=` instead of `<`, no partly-closed-group guard. |
| A1-03 | 违规 | **fix** | PC-17: keep the object passed to `selectContext`, snapshot it (deep copy) before, compare after, for both modes; in the real `none` run check that the returned `state.transcript` still holds the original thinking. Mutation: delete `reasoningContent` in place (policy ~157). |
| A1-04 | 违规 | **fix** | A PE4 case with the byte preview: history holds at least two thinking-only messages that the filter removes, current holds the task input and a complete tool exchange; a budget at the edge; check every preview saw the filtered request, the current exchange stays current, the chosen prefix and the report. Mutations: recount history after filtering; count before filtering. |
| A1-05 | 不整洁 | **fix** | Delete the second `it` of PC-11 that only exercises the test's own reference. |
| A1-06 | 不整洁 | **fix** | Rename the PC-17 case as Codex says (DeepSeek sends the thinking-only message, OpenAI has no item for it). |
| A1-07 | 不整洁 | **fix** | Remove the unused `PreviewOutcome.request` member and its property; regenerate `dist` with the script. |
| A1-08 | 不整洁 | **fix** | Remove the unreachable re-preview branch (policy ~479–482), end the search on the cached result for `high`, keep the final `fits` check; regenerate `dist`. |
| A2-01 | 违规 | **rejected** | `readonly SkillContext[]` accepts every array the book's `SkillContext[]` accepts, so no caller breaks; keep it. The book's §4 interface note records it as frozen. |
| A2-02 | 违规 | **fix** | Resume through the public `resumeCodingAgent` as well as the same-identity branch: a real tool loop produces a current message with thinking, then pause; resume with `reasoningReplay: 'none'`; the outgoing request has no thinking, the stored state keeps it; the five inputs reach the resumed run and the report comes once, before the provider. Mutation: drop the `reasoningReplay` forwarding (`composition-root.ts` ~352). |
| A2-03 | 违规 | **fix** | PC-16 third case: count 700 before the hook, 701 on the re-check, reserve 150; 851 fits a window of 900; the report says `inputTokens: 701, budget: 750`. Mutation: keep the first count (`runtime-runner.ts` ~755). |
| A2-04 | 违规 | **fix** | The absence case pins the whole base: sha256 `860d951d7f60787371922438b5935842c76ea90aa8a75fdf75d55297727f7cc2` for the configuration report's base and for the base in the provider's request (cut at the hand-written Skill section). |
| A3-01 | 违规 | **fix** | Remove `LocalWorkbenchHost.runtime`. The test wraps the public `createTargetPlatform`, captures `options.runtime` and calls the real factory, as `tests/app/RL-34-wiring-resource-caps.test.ts` ~38 does. |
| A3-02 | 违规 | **fix** | `PC-prompt-set-v1`: a table of rejections, field by field: top level, templates, strings, base, Skills, every `ArtifactRef` field and its `source`: missing, wrong type, unknown key; enums and digests with illegal values. |
| A3-03 | 违规 | **fix** | Save a settings model with the literal id `"settings-item-1"` through `models/save`, select it through `models/select`, read back `selection.modelId === "settings-item-1"`. Mutation: drop `modelId: model.id` (`host.ts` ~689). |
| A3-04 | 违规 | **fix** | The `origins` expectation is a hand-written table of every template id with `packId: "platform"` and its version, compared whole. |
| A3-05 | 不整洁 | **fix** | The allowlist note for `PROMPT_TOOL_SPECS_CONTENT_TYPE` names the send wrapper's `onConfiguration` store in `observed-model-run.ts` as its consumer, keeping the required prefix. |
