# PC-2 audit, part Q: preparation to request (rulings 13's call, 14, 16, 18, 19, 20)

Your part is `Q`: `./.lead-ref/parts/Q.diff` and `Q-files.txt`: `src/core/agent-runtime/{execution-preparation,
query-preparation,execution-driver,query-execution,observed-model-run,tool-group-assembly,prompt-set-texts,
context-history-facts,runtime}.ts`, Q's new tests (`tests/runtime/PC2-declaration-prepare`, `PC2-history-decision-pure`,
`PC2-review-shrink`, `PC2-tool-texts-freeze`) and the old tests it changed (`K3-35-manifest-trim-pure`,
`K3-review-preparation`, `tests/contracts/PC-prompt-texts-store`, `tests/runtime/PC-prepare-*`,
`PC-read-record-work-query`, `PC-send-*`). The book rulings 13 (the shrink's calls), 14 (the decision, the boundary
read, start), 16 (the final tool list), 18 (declarations), 19 (storing tool texts), 20 (start and resume), §4 (Q's
row), §5.2 PC-18, PC-19, PC-21 (shrink), PC-26, §5.3 (Q's lines).

**Look hardest at:**

- **Ruling 16, `finalToolNamesOf`.** Every input field from the fact the book names; `reviewSource` independent of
  `frozenSource`; rejections first (unknown selected name, a selected family missing its owner, a review phase
  without the `unknownCallReviews` owner), then the array in today's `kernelEnabledToolNames` order, never sorted;
  the rerun tool only on a Work Run with blocked commands and no review purpose. Preparation computes it once after
  the permissions, frozen-source and material facts are fixed; start recomputes and compares a ready result exactly
  and in order, `forbidden` on a difference. Compare the output for every combination with what `base/`'s start-time
  registration produced: a list that differs from the tools the Run actually registers is **会出错**.
- **Reply §1.2 (behaviour moved).** DSH says ruling 16 moves the rejection of an unknown authorization to preparation:
  `requeue_task` / `reverify_round` are `unsupported` at prepare, and `C2` GAP-46, `invariants-fuzz` seeds
  4/14/16/23/43, `A2-requeue-service`, `R3e-reverify`, `S5-notices` expected prepare ready and start rejected. Trace
  it: where do `requeue_task` and `reverify_round` come from (a Role's tools, a workflow's permission set)? In
  `pc1-final`, does any **production** flow prepare with them and then start successfully (are they registered by some
  group at start that `finalToolNamesOf` does not know)? If a real flow now fails at prepare that used to run, that is
  **会出错**; if every such Run was rejected at start anyway, it is the ruling's consequence and the tests need a
  ruling — give, per test file, what it asserts and the exact change.
- **Reply §8.4:** preparation freezes by the capability set's owners and start rechecks the actual owners; the
  Query read-only gate judged by the frozen capability, the real policy rechecked at registration; "a Query final list
  keeps only its graph family" (commit `2f9a826`) — is that today's Query registration, or a narrowing? Check each
  against `base/`.
- **Ruling 14.** One rule `sessionHistoryDecision`; Work and a Query without basis pass the real completed boundary,
  read once in preparation; a Query with `sessionBasis` passes none and reads none (C7); the recipe calls the rule
  once; Q freezes `takesSessionHistory` from `historyDecision` unchanged; at start the rule runs again and a frozen
  `false` forces `current_turn`. **Reply §8.4, commit `af84802`:** `readCompletedHistoryBoundary` treats a stored
  cursor the platform cannot decode as "no decodable completed history" → `{cursor: null, position: 0}`, so the Run
  starts `current_turn`. What did `base/` do with such a cursor at start (pass it through to the Kernel, reject)? Which
  real flow writes such a cursor (DSH names the S1 tests' Workflow)? If a real Session with history now loses it, that
  is **会出错**; give the input and both outputs, and the fix you would rule (DSH says a stricter rule needs
  `session-operations.ts` or the S1 fixture, outside the whitelist).
- **Ruling 13's call.** The shrink calls `rerenderContextV1` per candidate and replaces input, sections, digest and
  the manifest measure from its result; no prefix cut remains; the algorithm and order of the shrink otherwise as
  before (redo one candidate by hand).
- **Ruling 18** at preparation: each **used** template's `origins[…].mentionsTools` ⊆ the frozen list, else `invalid`
  naming template and tool. **Ruling 19:** for each frozen name with an entry, the canonical body stored, `{ name,
  packId: toolOrigins[name], digest, ref }` recorded, sorted by name, inside the digest and the size measure; a failed
  put `unavailable`. **Ruling 20:** `readPromptTexts` verifies digest, size and content type; the Work driver and the
  Query execution call it once before building any tool and pass `tools` to every factory route the ruling lists
  (`runObservedModel`, `selectWorkToolGroup`, `createReviewToolGroup`, `createRerunToolGroup`,
  `registerReadonlyCommandTool`, the Query graph group and read-only command); `readPromptRecord` reads the tool-text
  bodies. A route that still builds a tool without the frozen texts is a finding.
- **A pack problem at preparation is `invalid`** (ruling 4's last bullet): `PromptRenderError` mapped to `invalid` in
  Work and Query; other renderer failures keep their codes.
- **Tests:** PC2-history-decision-pure (each branch of Work and Query), PC2-declaration-prepare, PC2-review-shrink,
  PC2-tool-texts-freeze; the old tests changed only mechanically. Name a mutation each would miss.
