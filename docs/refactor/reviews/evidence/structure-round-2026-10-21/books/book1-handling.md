# s85 book check 1 (Codex, 10-21 16:09): handling (lead)

| # | Handling |
|---|---|
| B-01 | S4 files now list runtime-assets.json, slot-tables.ts (three main tables) and the pack owner's files |
| B-02 | ruling 2: closure check in inspectSourceTree; generated-module check only in the CLI branch and `build-platform-prompts.mjs --check` before build |
| B-03 | row 46 added (three context-extensions.ts texts) to S3; §4 lists context-extensions.ts and package.json as edited after SC |
| B-04 | ruling 3: full types (manifest, ToolTextV1, ResolvedPromptPackV1, TemplateSlotTableV1, SlotRangeV1, renderTemplate); empty/missing required throws; optional absent; ranges only for non-empty; ruling 4: S3 writes all ten slot tables, S4 may change only the three main ones |
| B-05 | ruling 6: path syntax, only .describe arguments change, shared schema texts in strings.json, mapping table in reply |
| B-06 | ruling 7: generated data `as const satisfies`, old constants keep literal types; brief tail array same shape, one source |
| B-07 | ruling 11: one pack owner per run, key table first, consumers hand texts |
| B-08 | S3 proof 3 and D2 proof: capture before Kernel (registration order) and at the model client (sorted by Kernel) |
| B-09 | name corrected to private blockedCommandsLinesZh; bridges only in the copies |
| B-10 | §5.0 rule 4 comparison protocol by type; inline expressions wrapped in copies only |
| B-11 | S3 proof 2: guide constant bytes and the appended Query input; every moved text proven in its own run |
| B-12 | S4 proof 2 (full return union) and 3 (bodies.put raw manifest and digests) |
| B-13 | S4 proof 4: recording proxy on deps and clock; unreached read points listed separately |
| B-14 | §5.0 rule 3: determinism at the source in both copies, no pattern erasing, two base runs equal, else "not byte-proven" |
| B-15 | D2 proof rewritten: wrap the natural callback, no extra factory calls, eight cases with named tests or probe drivers, zero-capture reported |
| B-16 | §5.0 rule 1: `$S85_SCRATCH` outside the repository copy, named by the run sheet |
| B-17 | B1 factory types written out (bodyProblem is the checkers' real `(value: unknown)` signature) |
| B-18 | C1 binding table; A6 two-part proof; C2 per-loop table and call logs (calendar and Run list have no exact-count tests) |
| B-19 | import-direction paragraph in §4 |
| B-20 | §6 sizes per run (S2 700–820, total 7,300–9,200), time limits, night-1 merge + daily suite + audit, after S4 full + scale batch |

# Quick check (Codex, 10-21 16:27): B solved 17, partly 3, unsolved 0; new 3 — handling (lead)

| # | Handling |
|---|---|
| Q-04/Q-21 | manifest field `id` -> `packId` (frozen spec §2) |
| Q-08 | D2 proof also captures the complete `tools` at the scripted provider's input, compared unsorted with the base |
| Q-17/Q-22 | createEventCodec's constraint = encodeEventEnvelope's (`eventId, eventType, schemaVersion, occurredAt`); leftover `EventFormat<T>` removed |
| Q-23 | K3-unknown-call-review-section.test.ts removed from the assembler capture list (hand-built layouts), kept as a regression check |

Book frozen as v3 (`s85-book.md`); v1, v2 kept. No further Codex rounds on the book (decision 56 cap).
