# Write the PC-1 Kernel test fixture (read only: give the file in your answer)

The tree at `D:\cxt\pc` is the lead branch at `dc462a95`. The PC-1 task book follows below; its group K changes the
Kernel patch (rulings 1–10). DSH writes the tests row by row (PC-11…PC-17, book §5.2) against a fixture you write
now; the lead checks it and freezes it, and DSH may not edit it. Do not change any file; no tests, builds, git or
network. Give the complete new file in your answer, in one fenced block, ready to save as
`tests/helpers/PC-kernel-fixture.ts`. It will not typecheck until group K adds the new Kernel inputs; write it
against the names the book freezes (rulings 2, 3, 8) and import only public Kernel exports
(`vendor/coding-agent/dist/public-api.js` and its types, as the existing tests do) plus the platform's existing test
helpers.

## What the fixture must give (no production code, no database reads, no network)

1. **A scripted provider** (`ModelClientPort`) for `runCodingAgent` and `RuntimeRunner`. Each scripted step returns
   text, tool calls, `reasoningContent` (including a thinking-only reply: no text, no calls), and usage (input,
   output tokens). It records a deep copy of every request it receives. It counts calls.
2. **Running the Kernel through its public entry** (`runCodingAgent`, as `tests/kernel/R4a-frozen-public.test.ts`
   ~494–556 does), with the new optional inputs passed through: `baseSystemPrompt`, `skills`, `reasoningReplay`,
   `previewRequest`, `onContextSelected`. It also gives:
   - two runs on the same Session, so the second has history;
   - a user input injected during a run, through the public input path (`run.input_accepted`, runner ~823–856);
   - the public history read, to show what the Kernel stored (as `tests/runtime/R5b-query-session-loop.test.ts`
     ~231 does through the platform, or the Kernel's own public history export). Never the `readRecords` SQLite
     helper.
3. **Previews whose numbers a test can compute by hand:**
   - `bytePreview({ window, outputCap, cumulativeOutputCap?, usedOutput? })`:
     - `inputTokens` = UTF-8 bytes of `JSON.stringify(request)` + 4,096 (the meter's rule, `model-budget.ts` ~86–87);
     - `outputReserve` = min(cap, remaining cumulative), as `model-budget.ts` ~82;
     - `fits` = `inputTokens + outputReserve <= window`;
     - `outgoing` = the request with `maxOutputTokens` set to the reserve.
   - `fixedCountPreview({ count, window, outputCap, … })`: the same with a fixed input count.
   - An `async` variant of each that resolves on a later tick.
   - Each records every call (k is not known to the test; the request is). Explain in a comment how a test lists a
     prefix's request by hand.
4. **A `RuntimeRunner` harness** (as `tests/helpers/orchestration-fixture.ts` ~43, ~147 and
   `tests/kernel/R4-tool-group-barrier.test.ts` ~408 build one) with a request hook that changes `maxOutputTokens`,
   with the preview and report inputs.
5. **Adapter transport capture.** For the DeepSeek and the OpenAI model clients, their public `transport` option
   (`dist/model/providers/*/…-model-client.d.ts` ~3) records the request body JSON. It returns a minimal legal stream
   for a text reply and for a tool-call reply.
6. **`selectContext` inputs for PE4.** Small builders for `ContextBuilderInput` entries with explicit message ids:
   - a user message;
   - an assistant with tool calls, and one without;
   - an assistant with `reasoningContent`;
   - tool results with status `success` (with a chosen `output`), `error`, `cancelled`.
   Also the `options` of ruling 3: the history id set, the protected ids, a preview.
   Builders only assemble data the way the Kernel's own types require (check `context-types`, `run-state`,
   `tool-executor-port` declarations); they never compute an expected value.

Keep it under about 400 lines. After the file, list: each export with its signature, and every place where you were
unsure of a Kernel public type or name (with the declaration you used).

---

# The PC-1 book
