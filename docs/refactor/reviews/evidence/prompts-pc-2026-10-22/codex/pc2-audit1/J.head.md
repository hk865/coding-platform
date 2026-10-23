# PC-2 audit, part J: the joint rows and the allowlist

Your part is `J`: `./.lead-ref/parts/J.diff` and `J-files.txt`: the new `tests/app/PC2-joint-*.test.ts` and
`tests/runtime/PC2-joint-*.test.ts`, the old PC-1 joint tests it changed (`tests/runtime/PC-joint-*`), and
`tests/architecture/production-reach-allowlist.json`. You may read the whole tree to judge them. The book §2 rule 3
(the allowlist), §4 (the joint rows and order), §5.1 (the three fixtures), §5.2 PC-03, PC-04 (prepared vs new), PC-05,
PC-06 and PC-08 (PC-2 variants), PC-18, PC-20, PC-21, PC-26.

**Look hardest at:**

- **Each joint row against §5.2, line by line.** For each bullet of each row: which test case carries it (file:line),
  through which public steps (Host routes, preparation, start, resume, `readPromptRecord`), with which literal
  expectations. A bullet with no case is a finding; say whether it can be carried within the frozen fixtures and the
  rules, and how.
  - PC-04 prepared vs new: a save through the route after a preparation; the prepared Run's start uses the old text,
    a new preparation the new one.
  - PC-05: two models with their own packs (markers A and B); no fields → `platform` / `current_run` and the read
    shows none; a restart after a save that omits them still resolves the defaults.
  - PC-06/PC-08: the person's pack changed after preparation (with a `strings.json` label) leaves the prepared run
    unchanged; a model's pack changed in settings after preparation: this execution old pack, a new one the new pack.
  - PC-18: reminder counts (new Session 0, LA-1 seed 1, same-Session reuse 1); placement also with all four budget
    sections omitted; the brief without the sentence; decided once in assembly; a K3 seed and a Query
    `session_history` through the one rule; a Query with basis reads no boundary.
  - PC-20's prepare-to-request part: read; read with edit and shell; no read — through the platform fixture's
    permission `tools`.
  - PC-21: the K3 shrink with a reminder after the review, ranges hand-computed, guard and entry pass, a changed
    character `invalid`, a legal other order followed.
  - PC-26: Work and Query with `list_files`, Work with `record_note`; the changed texts in the request; the frozen
    entry's digest hand-computed; changed again after preparation → start and a Work resume after pause send the
    prepared texts; `readPromptRecord`'s `toolSpecsRef` body holds them; the body store failing only
    `PROMPT_TOOL_TEXT_CONTENT_TYPE` → preparation `unavailable`.
- **Reply §1.3 and §8.5 (fixture defects):** `openPC2QueryHistoryFixture` cannot capture `startQuery` (the Workflow
  calls the Runtime object's method, not the spied port), so the Query-with-basis execution half is uncovered;
  `openPC2ReviewFixture('empty')` gives `invalid` from an empty required slot (`k3.none: ''`); the LA-1 non-empty seed
  is unreachable with the frozen fixtures; read+edit+shell only through renderer literals because the platform
  fixture hard-codes `writeScope: []`; the public no-read list uses `['search']`. For each: confirm by reading
  `tests/helpers/PC2-pack-fixture.ts`, `PC2-host-fixture.ts`, `PC-platform-fixture.ts`; if the fixture is at fault,
  give the smallest fixture patch; if the row can be carried another way within the rules, say how; if the row truly
  cannot be carried by any public path, say so.
- **Test bar:** every expected value a literal or hand-computed (digests as `sha256` of literal strings); no value
  from production code, the generated pack, `preparedTexts()`, a manifest or a captured request; whole texts compared
  whole; no database reads. Name a mutation each row would miss; check DSH's claimed mutations (reply §3, joint line)
  by reading the assertions.
- **The old PC-1 joint tests** (`PC-joint-budget-removal`, `PC-joint-prepare-freeze`, `PC-joint-record-and-failure`):
  each change forced by a ruling (the 57-byte brief sentence, `set.tools`, `base` v2) and nothing else loosened.
- **The allowlist** (book §2 rule 3): DSH removed nothing and changed three `wire-format` notes to "E3 adds the HTTP
  route" (reply §7). Read the allowlist's own test under `tests/architecture/` and the existing entries' categories.
  For each PC-2-touched entry: is the declaration reached by production now (then the entry must go)? Is each kept
  entry's named consumer real? Is any new PC-2 export (A's `resolvePromptPackV1` helpers, H's DTO types, T's
  `rerenderContextV1` / `ContextRenderMaterialV1`, Q's `finalToolNamesOf`, `sessionHistoryDecision`) unreached and
  unlisted, or exported only for a test?
