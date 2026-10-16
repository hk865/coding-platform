# Task: slice 4B round 2 — fix the checked review findings; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec, the earlier rulings and this message do not determine something, do not invent
behaviour: list it under UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (`sleep 300`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents; keep your own context small.** Use `grep -n` and `sed -n a,bp`, never whole large files. At most
**2 subagents at once**, and never two building subagents on the same file. Each building subagent's message contains
sections 1–5 of this message verbatim, its own group block of section 7 verbatim, the items of section 6 its group
owns verbatim, and: read `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`; read the spec sections its items name,
always including §0.2, §0.3 L9–L12, L19, L22, L23, §0.4, §8 and §9, and section 10 of `./.dsh-ref/s4b-impl.md` (the
round-1 answers P1–P14, still binding unless section 5 below changes them); work through its items test-first; run
`npm run typecheck` and its own test files only; reply with FILES, per item the test name(s) and the implementation
file:symbol, the RED/GREEN log, and UNSPECIFIED items (short). After each building group, a read-only reviewer subagent
checks that group's diff against the items and the spec (it does not edit); fix its findings in the next group or a
short last pass.

## 1. What this copy is

- **Base:** commit `slice-setup` holds the lead branch after 2C, RL and 4A were merged; `slice-base` adds
  `DSH-BASELINE.md`; the next commit, **`lead: 4B round 1`**, holds round 1 of slice 4B exactly as it was reviewed.
  Your work is round 2 on top of it. This copy has its own history; use these commits, not outside hashes.
- **Round 1's report** is `./.dsh-ref/s4b-final-1.md`; its book (with the binding answers P1–P14 in section 10) is
  `./.dsh-ref/s4b-impl.md`. The implementation review that found the items is `./.dsh-ref/s4b-implrev.out.md`; each of
  its 15 must-fix items and one should-fix item was then checked by a separate reader against the spec and the code.
  Section 6 holds those checked items; section 5 holds the lead's rulings on the questions they raised.
- **The TDD skill** is in `./.dsh-ref/tdd/` (not committed, excluded from `git status`).

## 2. Where the rules are (all inside this copy)

The frozen spec `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` (Chinese prose, English
identifiers): §0.2, §0.3 L9–L12, L19, L22, L23, §0.4, §1.1 (4B), §2 (the 4B parts), §3, §4, §5.1 NE2 and NE3, §5.2
T-01–T-09 and M-01–M-16, §5.3, §6 (4B), §7, §8, and §9 (4A's construction rulings; they bind 4B). Then P1–P14, then
section 5 of this message. Repository rules: `AGENTS.md` (state writes only through `src/core/work-graph/state/`).

## 3. Frozen files (never change them, not even temporarily)

`DSH-BASELINE.md` and the spec. **No existing test file changes** except: round-1 `S4B-*` tests and `tests/helpers/S4B-*`
(they are this slice's own and may be rewritten where an item says so), and the single 4A helper change section 5 R16
allows. Throw-away probes go under `./.dsh-scratch/` and are deleted at the end; never use `/tmp`. If the spec seems to
contradict an existing test, keep the test, report it under UNSPECIFIED (test id, assertion, spec line, minimal
counter-example) and go on.

## 4. Lead decisions for this round (binding)

- **L-scope.** Round 1's scope (book section 4 and P8) plus: `src/core/work-graph/notes/note-service.ts` only for R15
  (a `../` basis path at write answers `invalid`, not `unavailable`), and `tests/helpers/S4A-note-fixture.ts` only for
  R16. No `docs/` file, no lock files, no `vendor/`. A file outside this list that you believe must change: stop and
  report it.
- **L-tdd, L-fixtures, L-reach, L-interfaces, L-state:** as round 1's book section 4, with section 5's changes. In
  particular the NE3 tests now go through the real `platform.notes` holder (R16), on **both backends**.

## 5. Lead rulings on the questions the checked items raised (binding)

- **R1 — facts (item MF1).** A record pointer resolves when the record exists and its current revision is **≥** the
  pointer's revision (an older revision cannot be read, F6; treat it as resolved, like `note` pointers); a pointer
  revision above the current one is `version_ahead`. A record pointer's `digest`, when present, is not compared. A
  `file` fact whose digest is not 64 lowercase hex is unresolved with the new reason `invalid_file_digest` (lead
  amends §2's reason list; it mirrors `invalid_commit_format`); a path outside the workspace is `forbidden`. An
  `artifact` fact is checked for existence through the raw artifact store (the system check reads no body and is not
  authorization-gated: the note shows its own text, never the artifact's): missing → `not_found`, read failure →
  `unavailable`. A `kernel_history` fact is checked through the Run record and its execution-history locator: no Run →
  `not_found`; a Run without a locator → `not_found` (the section does not exist); positions past the observed range →
  `version_ahead`; read failure → `unavailable`. No fact kind is left `unchecked` for want of a reader; only
  well-formed `commit` facts keep P6's exemption.
- **R2 — caches (MF2).** Allocate per `checkNotes` call; key plans by project and goal; nothing survives the call.
- **R3 — one observation pass and one budget (MF3).** `NoteCheckV1` gains `observedFiles` (lead amends §2): every file
  the check read for this item — basis files, file-anchor paths (including symbol rechecks) and `file` facts — with
  its outcome. All of these share one per-page budget of `NOTE_READ_FILES_MAX` distinct paths, passed into
  `checkNotes` by the read model; an item that needs a path past the budget is `unchecked` (reason `capacity` for the
  budget). The read model takes `observedFiles` from the check; it never reads files itself. `coverage` counts every
  candidate the page examined (checked and unchecked), including those a filter then dropped; `filesRead` = distinct
  paths read on the page.
- **R4 — symbol rechecks (MF4).** Recheck by `qualifiedName`; the stored range only picks among several hits with the
  same name (the one at the stored range, else `unchecked`). A scan stopped at `NOTE_SYMBOL_HITS_MAX`, an unsupported
  language or a failed analysis → `unchecked`, never `symbol_missing`. The digest compares the same name-span text 4A
  stores (§9).
- **R5 — task and stage anchors (MF5).** Each anchor resolves against its own goal's plans. A stage anchor is live
  while its `stageId` is present in **every** adopted plan revision from the anchor's `planRevision` through the
  current one (continuity); a stage id removed and later reused does not revive it.
- **R6 — path prefixes and combined filters (MF6a, MF6b).** Fix the range as the item says. One trailing `/` of
  `pathPrefix` is stripped; an empty prefix is `invalid` (reason `path_prefix_empty`). Every supplied filter applies
  (AND): `find` with an anchor and a `pathPrefix`, `stale` with a `goalId` and an anchor. Anchor-scoped `stale` covers
  `accepted` and `reviewed`, like the goal route.
- **R7 — `'all'` and `unsupported` (MF7a, MF7b, should-fix).** Option B: `'all'` pages through the port in refKey order;
  its cursor carries the last port refKey examined; each page reads port pages until `limit` filtered matches or the
  port's per-call candidate cap, then returns `complete: false` with a cursor (empty pages are valid, L12). `'all'`
  results carry no `ranking` field. `'any'`: acquisition stops at `TEXT_SEARCH_CANDIDATE_MAX` checked matches; the
  partial set is the first `cap` filtered matches in refKey order on both backends. FTS `unsupported` passes through
  `memoryFind` unchanged. Its NE3 test may reuse the T-06 probe double only by building the record store with
  `fullTextProbe: () => false` in an S4B helper and handing that store to the platform through its existing store
  input; no new `createPlatform` option.
- **R8 — FTS validity across reopen cycles (MF8).** Amend P5: the meta row also records the ledger cursor the FTS table
  is maintained through, updated in the same transaction as every indexed write. At open, a different cursor (or a
  missing row) → rebuild; at read time, a mismatch → `unavailable`, reason `index_not_ready`. Rebuild and the meta
  update are one transaction. When the probe says FTS5 is unavailable, nothing is maintained and the port answers
  `unsupported`; a later open with FTS5 available rebuilds.
- **R9 — lookup, absent and retired anchors (MF9).** `lookup` lists the anchor's heads in `accepted`, `reviewed`,
  `pending_review` and `staged`, subject to cross-goal visibility (L9: other goals' items only when `reviewed` or
  `confirmedByUser`); it never filters by `currentEligible` — that field says which items count as current
  conclusions (M-08: a stale item is listed with `currentEligible: false`; rewrite round 1's M-08 test accordingly).
  Retired heads are listed and marked `retired`. `lookup`, `conflicts` and `find` with an anchor check the anchor's
  existence independently of matches. Approved §2 amendment: the three reads return `NoteMemoryReadResult<T>` =
  `ReadResult<T>` or `{ status: 'rejected'; code: 'not_found'; reason: 'anchor_not_found'; anchorCandidates: string[] }`
  (at most `NOTE_ANCHOR_CANDIDATES_MAX`), declared in `model/note-contracts.ts`; `results.ts` is not changed.
- **R10 — cursors (MF10).** Ordinary memory cursors bind the full caller identity, the whole request (minus the cursor),
  the actual rule-version constant and the record cursor. A body cursor binds the caller, `{ noteId, version }`, the
  rule version and the note's head version; the note changing → `revision_conflict`; any other mismatch →
  `cursor_mismatch`; an offset not on a UTF-8 boundary or out of range → `cursor_mismatch`. The outer cursor binds the
  body target `{ noteId, version }`, not the body cursor, so items and body page independently.
- **R11 — versioned reads (MF11).** Only the head version can be `currentEligible: true`. A historical item's snapshot
  fields (stored state, relations, `confirmedByUser` as 4A derives it for versions) come from that version; `conflicting`,
  `overQuota`, freshness and anchor status are computed now. `history` pages first and checks only the page. The body
  attaches to the item whose `noteId` **and** version match; a body target not on the page gives a warning
  `body_target_not_on_page` and no body. `memoryNeighbors` reads the requested version's relations.
- **R12 — the 48 KiB bound (MF12).** Trim items until the JSON fits, recomputing `readBasis.observedFiles` and coverage
  over the returned items only. A single item that alone exceeds the bound is returned alone with the warning
  `result_over_byte_bound` and `complete: false` when more remain.
- **R13 — hints (MF13).** Attribute files to modules with the existing longest-prefix rule (`mapExecutedFilesToModules`);
  the root `"."` owns nothing until 8A (§9). `basis_outside_anchor`: none of the basis files is attributed to an
  anchored module (module and interface anchors by `moduleId`, file anchors by their attributed module).
  `file_module_mismatch`: only for agent-written notes, comparing the authoring Run's task scope in **the Run's bound
  plan** with the attributed modules of the file anchors; other sources give no hint; a failed read → `unavailable`.
  `deleted_path_unverified`: for every `deleted: true` file anchor, proof is a `file` fact for the same path or a
  `counted` RunActivity that lists the path in `changedFiles` (the `possible` list is not proof). For a proving `file`
  fact, the outcome `deleted` is the expected state and does not make the note stale. If no public seam builds a
  RunActivity, skip that one case and report it.
- **R14 — version metadata (MF14).** Lead amends P8: `VersionListPageV1.items[].at` is `string | null`; catalog items
  give `null` until 8A links a revision to its event (the 8A post-note covers time and reason). The initial plan
  adoption shows its recorded reason when it has one. M-10's "old version without a reason" half is not constructible
  through public services: record it as such.
- **R15 — `../` at write (from MF15).** If a basis path outside the workspace answers `unavailable` at write, fix
  `notes/note-service.ts` minimally so it answers `invalid` (L11); test it in an S4B test.
- **R16 — fixtures (MF15).** NE3 tests use the real `platform.notes` holder built by the composition root (no replaced
  wiring, no separately built readers), on both backends. Expose `checkNotes` on the `notes` holder now (L22's second
  call site; 4C binds it) so M-13 runs through it. If widened `noteLimits` must reach the platform, prefer an S4B
  helper; if impossible, one additive change to `tests/helpers/S4A-note-fixture.ts` that forwards options and changes
  no S4A behaviour (all S4A tests must still pass). Add the missing flows the item lists (M-07's race half through
  `tests/helpers/S4A-note-interleave-fixture.ts`, unchanged; the reachable M-11/M-14 failure cases; M-15's satisfied
  task stays live). Replace product-output expectations with literal values. The module-removal cases stay skipped
  (the catalog guard is not weakened); M-16's retired-heads case is built with interface removal or file deletion.

## 6. The items (checked findings; the fix and the tests are binding unless section 5 says otherwise)

Each item: what the check found (code and spec facts), the fix and the tests the checker proposed, and the ruling that settles its open questions. Line numbers are round 1's; find the symbol if a line moved. Where an item offers two ways, section 5 decides; where it asks the lead a question, the named ruling answers it.

### Item MF8 — group G1; ruling R8

**Found (holds).** sqlite-text-search.ts:146-186 only looks at the indexes registered in this open, and rebuilds only when `stored?.code !== code || !tableExists` (152). Nothing invalidates the meta row or table of an index that this open did not register. With a false probe (132-134), `indexRecord` does nothing and the meta table is left as it was. The only write path is upsertSnapshot plus indexRecord (sqlite-record-store.ts:483-484). So: open with the index, reopen without it, write, reopen with it. The code still matches and the table exists, so the stale table is served. A pre-4B build (4A writes NoteHeads today) cannot run any invalidate-at-open code either. The rebuild at 153-185 runs in autocommit: the store's only BEGINs are at :294 and :313. Suppose the table went missing while the code still matched. A crash after DROP, CREATE and part of the INSERTs then leaves a partial table that later opens accept. T-06 (S4B-text-search.test.ts:456) only covers the first open without the index. Spec L10 line 165; P5.

**Fix.** sqlite-text-search.ts plus the commit and searchText in sqlite-record-store.ts. (1) The meta row becomes (name, code, through), where through = the events.id the table is current through. Inside the commit's BEGIN IMMEDIATE, after appendEvents: `UPDATE next_fts_meta SET through=:last WHERE name IN (registered) AND through=:prevMax`, with prevMax = MAX(events.id) read before the append. The advance is conditional, so another writer's gap is never covered. (2) At open, also rebuild when through !== MAX(events.id), compared null-safe. (3) Run each rebuild in one BEGIN IMMEDIATE…COMMIT, with ROLLBACK on a throw: DROP, CREATE, inserts, then upsert (code, through = MAX(id) read inside that transaction). (4) searchText checks through against MAX(id) in its read transaction; on a mismatch it returns `unavailable` with `index_not_ready`. The probe-false path needs no change, because its commits never advance through.

**Tests.** NE2, SQLite only, T-06 cases. (a) Open with widgetSchemas and seed n1 {topic:'架构图需要重画'}; close. Reopen with lookups:[], seed n2 {topic:'架构说明'} and n1 rev 2 {topic:'令牌刷新'} (expectedRevision 1); close. Reopen with widgetSchemas: refs(search ['架构']) = [keyOf('p1','n2')] and refs(search ['令牌']) = [keyOf('p1','n1')]. Today both return []. (b) Open with the default probe and seed n1 as above; close. Reopen with fullTextProbe:()=>false and seed n2 {topic:'架构说明'}; close. Reopen with the default probe: ['架构'] gives [keyOf('p1','n1'), keyOf('p1','n2')]. Today it gives [n1]. Atomicity cannot be tested without tampering with the DB (AGENTS rule 4), so it is checked by code review only.

**Questions the checker raised (answered by R8).** Amend P5: the meta row also records the ledger event id the table is maintained through; a mismatch at open triggers the rebuild; a mismatch at read time answers `unavailable/index_not_ready` (L10's own wording). This extends '代号不对'.

### Item MF1 — group G2; ruling R1

**Found (holds).** note-views.ts:482-500: `fact.revision` is never read, so a Goal fact at revision 999 resolves `untouched`. The `kind_mismatch` test at 495-498 can never fire, because the refKey is `canonicalJson(fact.ref)`. The file branch (472-481) has no 64-hex digest check and no path check: a bad digest comes back `changed`/stale (not fresh), and a `..` path comes back `unavailable` (readWorkspace answers `invalid`, mapped at 179-191). artifact/kernel_history (501-504) return `unchecked`; 623 only pushes to `uncheckedFacts` and never sets `unchecked`, so 664-675 give `fresh` with `currentEligible:true`. That breaks L22 (spec line 251: only `commit` is exempt) and P6. P9 says these two kinds have existing readers, so UNSPECIFIED 7's fallback is not allowed.

**Fix.** In `resolveFact`: record facts give `version_ahead` when `fact.revision > record.revision`, and the other cases follow the lead's ruling. File facts: check `/^[0-9a-f]{64}$/` and the path shape before reading. Artifact facts: inject an existing reader into `NoteCheckDependencies`, either `MaterialPort.openArtifact(ctx,{ref,usage:'historical_explanation'})` (model/material-contracts.ts:15; `rawMaterials` at create-platform.ts:579) or the raw `RawArtifactStorePort.read` (body-ports.ts:26). Map not_found to `not_found`, forbidden to `forbidden`, anything else to `unavailable`. Kernel history: read the Run through records plus `decodeRun` (already imported at :45) and compare `executionHistory` (execution-history.ts:7-15): no Run gives not_found; identity mismatch gives kind_mismatch; `throughPosition` beyond `endPosition ?? observedThroughPosition` gives version_ahead. The Kernel entries themselves can only be read in AgentRuntime, which views cannot import (module-target.json:186-192). A missing reader gives `unavailable`, never `unchecked`.

**Tests.** NE3, memory and sqlite, host ctx, accepted note. (a) Goal fact `revision:999` gives `unresolvedFacts:[{index:0,reason:'version_ahead'}]`, `freshness:'unchecked'`, `currentEligible:false`. (b) A fact at the revision `queryGoal` reports gives `[]`, `'fresh'`, `true`. (c) Artifact stored through `platform.materials.storeArtifact` gives `[]`/`uncheckedFacts:[]`; the same ref with digest `'0'.repeat(64)` gives `[{index:0,reason:'not_found'}]`, `'unchecked'`. (d) A Run whose locator is set through `platform.executions.recordExecutionHistory` (start 10, observed 20): positions 12–15 give `[]`; 12–25 give `version_ahead`.

**Questions the checker raised (answered by R1).** (1) Record revision below current: F6 means the old revision cannot be read. Treat it as resolved (as `note` facts are), or as sourceUnavailable? Exact match would void every message fact once the message is acked. (2) Should a non-null record `digest` be compared? (3) Malformed file digest: the frozen union has no code for it, so keep `changed` or add a reason to §2. Out-of-workspace path: `forbidden`? (4) Artifact facts: `openArtifact` lets a Run read only its own material (applicability.ts:87-93), so other executors would always get `forbidden`. The raw-store check returns no body. (5) Is the Run-locator check enough for kernel_history? A Run with no locator gives `unavailable`?

### Item MF2 — group G2; ruling R2

**Found (holds).** note-views.ts:150-151 creates planCache/architectureCache once per createNoteCheck, and create-platform.ts:1294 builds one instance per platform. checkNotes clears both on entry (700-701) and then awaits per item (708-715), so an overlapping call can clear or fill the other call's caches. architectureCache has no key (208-220), but the catalog is per project (catalog-service.ts:765-769). planCache is keyed by goalId only (196-204), and goal ids are chosen by the caller (task-service.ts:323), so two projects can both have 's4a-goal'. Rejected outcomes are cached too (202, 217), so one call's failed read can make a concurrent call return unavailable. This also goes against L22 '只读，不写记录、不存东西'. Within one project the effect is only reads from different moments; across projects it gives wrong anchorStatus and stale reasons.

**Fix.** In checkNotes, allocate `{ plans: Map<string, Outcome>, architecture?: Outcome }` and pass it through checkOne to currentPlan/currentArchitecture (via definitionStaleness, anchorStatusOf, classFiveHints and the staged-repair branch). Key plans by `${ctx.projectId}\u0000${goalId}`. Remove the closure fields and the clear() and delete calls.

**Tests.** NE3 through platform.notes on both backends. The S4B helper binds a second project P2 on the same platform. P1: N1 on interface m/i, then a catalog revision removes i. P2: N2 on interface m/i, with i kept. Run Promise.all([readNote(ctxP1,N1), readNote(ctxP2,N2)]) in both orders. Expected: N1 anchorStatus 'retired', anchorRetiredReasons ['interface_removed'], currentEligible false; N2 anchorStatus 'live', anchorRetiredReasons [], freshness 'fresh', currentEligible true. Plan variant: goalId 's4a-goal' in both projects, and an adopted v2 cancels t1 in P1 only. Expected: N1 ['task_ended']; N2 'live'.

**Questions the checker raised (answered by R2).** None. L22 already says the check stores nothing.

### Item MF3 — group G2 (check half) and G3 (read half); ruling R3

**Found (holds).** (a) Two passes: the read model observes basis files with its own default budget and a fixed NOTE_BASIS_FILE_MAX_BYTES (note-read-model.ts:376-377, 605, 888-890, 1027-1036). Then withCheck (417) calls checkNotes, which builds a second budget with the injected limits (note-views.ts:702-706) and reads every basis file again (605). Symbol rechecks are charged only to that second budget (324-329). So an item can be 'unchecked' while its observedFiles say 'same', and an edit between the two passes makes them disagree. coverage.filesRead counts only the first budget (632). (b) Reads outside the budget: file anchors (302), the symbol file read before the budget test (320 vs 324), and file facts (473). §4 rule 13 ('一次读最多 256 个不同文件') covers these literally. L11 names basis files, L23 names only rechecks, and L22 gives facts their own budget. (c) Coverage is computed after filtering. lookup keeps only currentEligible items (990-993), so uncheckedItems is always 0, which loses L11's '写"未核对 n 条"'. stale (1195) and conflicts (1108) undercount checked items.

**Fix.** The check owns the only observation. Use one budget per call with a path→result map. Every workspace read goes through it, the budget is tested before reading, and each path is read once. Past the budget: a basis file is 'unchecked', a fact goes to uncheckedFacts, and an anchor or recheck makes the item unchecked. checkOne returns observedFiles. The read model drops observeNoteFiles. filesRead counts distinct paths actually read. Coverage is computed over checkedPage's full list before filtering, and recomputed up to the cursor after byte trimming.

**Tests.** NE3 on both backends. T1: readFilesMax 2. N1 has a main anchor on file sym.ts (`export function alpha() {\n  return 1;\n}\n`, symbol alpha) and basis [a.txt]. N2 is on project with basis [b.txt]. Append '// x\n' to sym.ts, then memoryFind({}). Expected: N1 'fresh'; N2 'unchecked' with observedFiles [{path:'b.txt',digest:null,outcome:'unchecked'}]; coverage {checkedItems:1,uncheckedItems:1,filesRead:2}. Today N2's observedFiles show 'same'. T2: readFilesMax 1, N1 basis [a.txt], N2 basis [b.txt], then memoryLookup(project). Expected: items [N1], coverage {1,1,1}; today it reports 0 unchecked. memoryStale with a.txt edited: expected coverage {2,0,2}; today {1,0,2}. T3, after the ruling: readFilesMax 1, a file fact on c.txt. Expected: uncheckedFacts [0], freshness 'unchecked'.

**Questions the checker raised (answered by R3).** (1) Add observedFiles to NoteCheckV1 (§2 has it only on NoteItemV1), and decide whether it also lists anchor, symbol and fact files. (2) Decide whether file-anchor and file-fact reads use the 256-file budget, and confirm that a file anchor past the budget makes the item 'unchecked'. (3) Define coverage as the examined candidates, including the ones the filter drops.

### Item MF4 — group G2; ruling R4

**Found (holds).** Both halves of the finding are confirmed. Paths are under src/core/work-graph unless they start with tests/.

(1) The old line range is used as a filter. views/note-views.ts:330-331 passes `range: anchor.symbol.range` into 4A's resolveSymbol, which drops every hit whose start or end line differs (notes/note-anchors.ts:317-319). The stored range is the line of the symbol's name (§9 symbol bullet; typescript-source-query.ts:162-163 uses `nameSpan`). L23 (spec:256) says to re-resolve by `qualifiedName`. The builder knew about this: tests/work-graph/S4B-note-anchor-status.test.ts:160 edits 'the SAME line so the stored line range still matches'. So one line inserted above an unchanged symbol gives `symbol_missing`.

(2) Incomplete checks become a definite `symbol_missing`. note-views.ts:335-337 maps both `unresolved` and `ambiguous` to `symbol_missing`. resolveSymbol returns `unresolved` in all of these cases:
- no capture or querySource (note-anchors.ts:283);
- a language it does not resolve (:286);
- capture or page `unsupported` (:292, :313);
- a scan stopped at the cap with 0 or 1 match, including the target found once before the cap (:329-333);
- the file missing from the capture (:340-344).
Lead notes §2 says going past a spec bound gives `unchecked`, and §9 says a read failure is never a definite answer.

**Fix.** In views/note-views.ts, add a read-side recheck that replaces the resolveSymbol call at :330. It reuses the exported `signatureDigestOf` and the same capture, querySource (symbols) and readWorkspace (capture version) calls, and releases the capture in `finally`. It matches by name only. Outcomes:
- full scan (cursor null) with 0 name hits: `symbol_missing`;
- exactly 1 hit: compare `signatureDigest`; if different, `symbol_signature_changed` (stale);
- 2 or more hits: use the hit at the stored range if there is one, otherwise `unchecked`;
- scan stopped at the cap, `unsupported`, no capture support, file not in the capture, or any read failure: `unchecked`, not retired.

**Tests.** NE3, run on memory and sqlite, through f.notes.readNote with the user context. The note has a file anchor on src/a/x.ts (starts as 'export const a = 1;\n') with symbolRequest {typescript, 'a'}.

(a) 'M-15 a line inserted above a symbol keeps it live': rewrite the file as '// moved\nexport const a = 1;\n'. Expect anchorStatus 'live', anchorRetiredReasons [], staleReasons [], freshness 'fresh', currentEligible true. Today it gives retired ['symbol_missing'].

(b) 'M-15 a capped symbol scan is unchecked': fixture option check {symbolHitsMax: 2}; rewrite as 'export const a = 2;\nexport const b = 2;\nexport const c = 3;\n'. Expect anchorStatus 'live', anchorRetiredReasons [], freshness 'unchecked', currentEligible false.

(c) Depends on the ruling: rewrite as 'export const a = 1;\nnamespace N { export const a = 2; }\n'. Expect 'live' (the hit at the stored line 1).

The `unsupported` path cannot be reached for a stored typescript locator through public files, so do not invent a double for it. Keep the existing symbol_missing test.

**Questions the checker raised (answered by R4).** Confirm three points:
- §9's '4B 读侧按这个比' means hashing the same name-span text. It does not mean the range filters hits on recheck (L23 re-resolves by qualifiedName).
- When 2 or more hits share the name: use the hit at the stored range, otherwise `unchecked`.
- A scan stopped at NOTE_SYMBOL_HITS_MAX, or an unsupported analysis, gives `unchecked`, never `symbol_missing`.

### Item MF5 — group G2; ruling R5

**Found (holds).** Both halves are confirmed; the stage half's fix needs a lead ruling. Paths are under src/core/work-graph unless they start with tests/.

One plan for every anchor: views/note-views.ts:265-270 takes the goalId of the first anchor that has one and reads only that goal's plan. The task check (:290-294) and the stage check (:296-298) look up every anchor in that one plan. The user and the scribes may anchor any goal (spec L2a:91; note-service.ts:651-668 limits only callers that are neither the user nor a scribe). The main anchor is always first, so the wrong plan only reaches extra anchors, and the effect is a wrong `retiredExtraAnchors`:
- a live task of another goal is listed as retired;
- a cancelled task of another goal is missed when goal 1 has a task with the same id (for example 't1').

`planRevision` ignored: :298 compares `stageId` only and never reads `anchor.planRevision`. The spec says stages cannot be identified across plans by id alone (L2:76; MEMORY-LOOKUP §3.1; spec:204 'ids may repeat'). So s1 removed in v2 and re-added in v3 makes the old anchor live again. The 4A write gate (§9 basis bullet, the 4A ruling R5) does accept an agent's stage when the id is in both its bound plan and the current plan.

**Fix.** In views/note-views.ts anchorStatusOf:
- Read `currentPlan` for each distinct `anchor.goalId` of the task and stage anchors. Any read failure still gives `unavailable`.
- The task and stage branches use the plan of their own goal.
- Stage check, recommended reading (consistent with R5): live only if `stageId` is in every adopted PlanRevision of that goal from `anchor.planRevision` through the current one. Read them through S2B_PLAN_REVISION_BY_GOAL_LOOKUP, as basisPlanByNumber does. If the anchor's own revision is missing, the result is `unchecked`.

**Tests.** NE3, run on memory and sqlite, with the user context. A new S4B helper creates goal 's4b-goal-2' with a plan (stage s2, tasks t1 and t9) through the public calls, copying tests/helpers/S4A-note-scope-fixture.ts:214-234.

(a) Main anchor task:s4a-goal/t1, extra anchor task:s4b-goal-2/t9. Expect retiredExtraAnchors [] and anchorStatus 'live'. Today it gives ['task:s4b-goal-2/t9'].
(b) Extra anchor task:s4b-goal-2/t1; a goal-2 revision cancels its t1 while goal 1's t1 stays active. Expect ['task:s4b-goal-2/t1'].
(c) Stage anchor {s4a-goal, s1}, stored at revision 1:
- v2 has stages [s2] only (tasks moved to s2): anchorStatus 'retired', ['stage_not_in_current_plan'];
- v3 has stages [s1 'Another stage', s2]: still 'retired', ['stage_not_in_current_plan']. Today v3 gives 'live'.
(d) Depends on the ruling: a v2 that keeps s1 gives 'live' under the continuity reading and 'retired' under the strict one.

**Questions the checker raised (answered by R5).** Decide what 'the stage is in the current plan' means for a versioned anchor:
- Continuity (recommended): the id is in every adopted revision from the anchor's revision through the current one.
- Strict: the current revision must equal the anchor's revision. This conflicts with R5, because an agent's stage note written against an older bound plan would be retired at once.

### Item MF13 — group G2; ruling R13

**Found (partly holds).** basis_outside_anchor (note-views.ts:426-436) uses `pathUnderModule` (119-126): a file counts if it sits under any anchored module path, and `'.'` matches everything. L2a (spec line 92) assigns files to modules by longest prefix. Fixture modules (S4A-note-fixture.ts:163-167): anchor A with basis `src/a/one/x.ts` (owned by A1) and anchor R (`'.'`) with basis `src/b/y.ts` both get no hint today. file_module_mismatch (438-452) takes the note's task anchors, but L2a line 87 says "the task of this execution", meaning the authoring Run. The existing test S4B-note-hints.test.ts:59-71 locks in the wrong rule: a host-written note gets the hint. deleted_path_unverified (652-657) checks only the main anchor and ignores RunActivity facts (L2a line 94). Codex's "mere presence of a file fact" point does not hold: the spec only asks for a `file` fact pointing to that path.

**Fix.** Attribute files with the existing rule in views/goal-conflicts.ts:470 `mapExecutedFilesToModules` (ties give null; `'.'` matches nothing, as §9 leaves the root to 8A), and drop `pathUnderModule`. basis_outside_anchor: the hint fires when basis files exist and none is attributed to an anchored module (module and interface anchors by `moduleId`). file_module_mismatch: add `source` to `CheckBody`. For `source.kind==='agent'` with a `runRef`, read the Run (records plus decodeRun) and its bound plan (`run.planRef`, decodePlanRevisionSnapshot); a failed read gives `unavailable`. When the task scope is `module`, compare it with the attributed module of every file anchor. Any other source gives no hint. deleted_path_unverified: for every `deleted:true` file anchor, the proof is a `file` fact with the same path, or a RunActivity record fact (decodeRunActivitySnapshot, run-activity-codecs.ts:363) with status `counted` whose `changedFiles` lists the path.

**Tests.** NE3, memory and sqlite. Anchor module A with basis `src/a/one/x.ts` gives `hints:['basis_outside_anchor']`; with basis `src/a/x.ts` it gives `[]`; anchor R with basis `src/b/y.ts` gives `['basis_outside_anchor']`. With t2 scoped to module B, a note written in `workCtx(claimRun('m','t2'))` with anchor file `src/a/x.ts` gives `['file_module_mismatch']`, and with `src/b/y.ts` it gives `[]`. Rewrite hints.test:59-71: host, task t2 anchor plus file `src/a/x.ts` gives `[]`. Extra anchor `{file 'src/gone.ts', deleted:true}` with a commit fact gives `['deleted_path_unverified']`. RunActivity proof gives `[]` (needs a seam).

**Questions the checker raised (answered by R13).** (1) Does the root `'.'` module own files now, or only from 8A on? (2) Do file anchors' modules count for basis_outside_anchor? (3) Is the declared module taken from the bound plan or the current plan? (4) Does RunActivity's `possible` list count as proof? (5) The `file` fact that serves as proof resolves to `changed/deleted` (lines 475, 625), so the note stays stale forever. Should it count as `same`? (6) Which seam builds the RunActivity (S2B kernel fixture)?

### Item MF6a — group G3; ruling R6

**Found (holds).** note-read-model.ts:528-529 range-reads each ordered path index from `file:${prefix}` inclusive; :536 breaks out of that slot's scan at the first key failing `matchesPathPrefix` (:516-519). The ordered text order is UTF-8 byte order (lookup-index.ts:562-583 compareOrderedValues -> compareRefKeys; SQLite orders with BINARY). '-' is 0x2D and '.' is 0x2E, both below '/' 0x2F, so `file:src/a-b/y.ts` and `file:src/a.ts` sort between `file:src/a` and `file:src/a/x.ts`. The scan stops at the sibling and never reaches the real subtree. Ordinary layouts hit this, for example `src/notes.ts` next to `src/notes/`. P7 says to stop only "when the key leaves it" (the prefix range) and to apply the directory check in code. The existing M-09 test (S4B-memory-find-stale.test.ts:54-68) uses `src/ab`, which sorts after '/', so it passes by accident.

**Fix.** In `headsOnPathPrefix`, each ordinal reads two ranges: (1) from bound `base` inclusive, keep keys equal to `base` and stop at the first different key; (2) from bound `${base}/` inclusive, keep keys while they start with `${base}/` and stop at the first that does not. The P7-literal alternative also works: break only on `!slot.startsWith(base)` and `continue` on a failed boundary check. It returns the same results but scans every `src/a*` sibling. No other file changes.

**Tests.** NE3, `createS4BNoteCheckFixture('memory')` and `('sqlite')`. The workspace has src/a/x.ts; add src/a-b/y.ts and src/a.ts. Write nIn (file src/a/x.ts), nDash (file src/a-b/y.ts) and nDot (file src/a.ts). `memoryFind({v:1,op:'find',pathPrefix:'src/a',limit:20,cursor:null})` -> status 'ready', item noteIds = [nIn], complete true. Today it returns []. Optionally add nExtra (anchor project, extraAnchors [file src/a/x.ts]) to cover slot 1; then expect {nIn, nExtra}.

**Questions the checker raised (answered by R6).** None needed for the fix (P7 covers it). Small adjacent point the spec leaves open: `pathPrefix: 'src/a/'` (trailing slash) or `''` currently returns an empty page with complete true. The lead should rule whether to normalize the trailing '/' or reject such a prefix as `invalid`.

### Item MF6b — group G3; ruling R6

**Found (holds).** In `memoryFind`, the terms branch applies both anchor and pathPrefix (note-read-model.ts:1248-1256). The no-terms anchor branch (:1266-1271) filters only by anchor and `headMatchesFilters`, so a supplied `pathPrefix` is dropped without notice, even though the cursor binds it (:1212-1214). In `memoryStale`, `goalId` wins (:1180-1183) and a supplied `anchor` is ignored, though the request binds it (:1171). Spec §2 (:434, :436) allows both fields together, and no code path rejects the pair. L12 (:178) says "锚点或路径…的组合" and "目标或锚点范围". Either reading (AND, or exclusive) rules out silently returning notes outside the scope the caller asked for. For stale this widens the scribe's to-do list. The behaviour is also inconsistent inside `memoryFind`: the terms branch already ANDs the two.

**Fix.** `find`: add one `headInScope(head, input)` (anchor-key membership AND the pathPrefix directory match AND `headMatchesFilters`) and apply it in all four branches. The candidate source stays as it is (the anchor index when an anchor is given). `stale` with both fields: take candidates from the anchor indexes, filtered by `head.goalId === input.goalId` and state in {accepted, reviewed}. The alternative is to reject the pair as `invalid`. Related: the anchor branch has no state filter (:1186-1188), while the goal branch reads only accepted/reviewed (:1181). A superseded or withdrawn note with a changed file therefore shows up in stale-by-anchor.

**Tests.** NE3, both backends. find: nA on file src/a/x.ts. `memoryFind({anchor:{kind:'file',path:'src/a/x.ts'},pathPrefix:'src/b',limit:20,cursor:null})` -> {items:[], complete:true} under AND, or rejected 'invalid' if the lead picks exclusivity. Today it returns [nA]. stale: goal g. n1 (goalId g, anchor goal g, basis src/a/x.ts) and n2 (goalId g, anchor file src/b/y.ts, basis src/b/y.ts); change both files. `memoryStale({goalId:g, anchor:{kind:'goal',goalId:g}})` -> [n1]. Today it returns both.

**Questions the checker raised (answered by R6).** Yes. (1) Do find's anchor+pathPrefix and stale's goalId+anchor combine with AND, or is supplying both `invalid`? (2) Which states does anchor-scoped `stale` cover: only accepted/reviewed like the goal route, or all stored states? P7 does not say.

### Item MF7a — group G3; ruling R7

**Found (holds).** `rankMatches` sorts by noteId and keeps only the first `textSearchCandidateMax` (note-read-model.ts:750-754). `memoryFind` uses it for both match modes (:1257-1265), so for 'all' `ordered` is the truncated list. `complete` is `next===null && ranking==='full'` (:1303), so the last page has next null and complete false, and no cursor reaches matches past the cap (1,000 by default). Spec L10 (:161) gives the partial rule for ranking and then says "`match: 'all'` 时 L10/L12 照旧". The L10 limit line (:166) says: return what was checked, `complete:false` and a continuation cursor. T-08 (:631) keeps refKey order. For 'all', every term is in every match, so r(t)=ln(1+U/U)=ln 2 and the score does not depend on the match set. No truncation is needed to compute it.

**Fix.** Option A (minimal): for 'all', skip the cap (rank the whole filtered set), set ranking 'full' and emit no warning. `collectSearch` already drains, so every match becomes reachable. Option B (closer to the spec text): the 'all' cursor carries the last port refKey examined. Each page reads port pages from there until `limit` filtered matches, or until the port stops after its 1,000 candidates, and returns `complete:false` with a cursor. L12 (:181) allows empty pages. B also covers the should-fix. Recommend B.

**Tests.** NE3, both backends, fixture `textSearchCandidateMax: 2`. Write three notes with topics 'alpha flow one/two/three', plus 'alpha only'. `memoryFind({terms:['alpha','flow'],match:'all',limit:20,cursor:null})` -> noteIds = the three ids sorted by byte order, ranking 'full', complete true, warnings [], each matchedTerms ['alpha','flow'], each score 4.1589 (2 x 3 x ln 2). With limit 1: three pages, and the third has next null and complete true. Today: 2 items, 'partial', complete false.

**Questions the checker raised (answered by R7).** Choose A or B. Confirm that 'all' reports `ranking: 'full'`.

### Item MF7b — group G3; ruling R7

**Found (holds).** `collectSearch` returns `asOutcome(page)` for any non-ready page (note-read-model.ts:718). `mapStoreFailure` sends every code it does not list to 'unavailable' (:78-84), and `ReadFailureCode` (:64) has no 'unsupported'. The SQLite `searchText` answers `unsupportedFailure` when FTS5 is missing (sqlite-record-store.ts:794-796). The spec's error list (:412) keeps `unsupported` for FTS5 only; L10 (:165) says the port reports `unsupported`. A caller therefore gets 'unavailable', which means retry later, for a permanent lack of capability.

**Fix.** In `collectSearch`: if `page.status !== 'ready' && page.code === 'unsupported'`, return `{ok:false, code:'unsupported', reason}`. Widen `collectSearch`'s outcome type to allow 'unsupported'; `memoryFind`'s `rejected(records.code, …)` already accepts it as a CoreError. Do not change `mapStoreFailure`: the 4A writer and the other reads share it (:75).

**Tests.** NE3, 'sqlite' with the FTS5 probe returning false. `memoryFind({terms:['alpha'],limit:20,cursor:null})` -> {status:'rejected', code:'unsupported'}. On the same store, `memoryFind({anchor:{kind:'project'},limit:20,cursor:null})` -> status 'ready' (P7: no full-text read without terms). Wiring: create-platform.ts:555 does not pass `fullTextProbe`. The test can wrap `createSqliteRecordBackend` with `vi.spyOn` in an S4B helper, the same way S4B-note-check-fixture.ts:84-95 wraps the memory backend, and inject `fullTextProbe: () => false`.

**Questions the checker raised (answered by R7).** Yes. §7 lists the FTS5-unavailable simulation as a test double only for T-06, and P5 says "not used anywhere else". The lead must either allow reusing it for this NE3 row, or accept NE2 T-06 plus a code review as the only coverage of this mapping.

### Item should-fix — group G3; ruling R7

**Found (holds).** `collectSearch` reads every port page to the end (note-read-model.ts:712-723), once per term for 'any' (:1232-1239) and once for 'all' (:1241). All matches are decoded and filtered before `rankMatches` caps them (:1257). Every continuation page repeats the full drain. Spec L10 (:161) says the partial cursor "不再往后读候选", and the limit line (:166) bounds checked candidates per lookup. P14 says the read model's `TEXT_SEARCH_*` bounds the match set it ranks. The cap limits what is returned, not the work done. Results are correct; the work bound from the spec is missing.

**Fix.** For 'any': open one port stream per term (each in refKey order), merge them by `compareRefKeys`, dedupe, decode, apply the non-text filters, and stop when the filtered union reaches cap+1 (partial: keep the first cap) or every stream ends (full). 'all': see 7a option B. The result set is identical to today's (sort by noteId, keep the first cap), because a NoteHead refKey is canonical JSON {aggregateType, noteId, projectId} (note-record-codecs.ts:326), so refKey order equals noteId order within one project. Caveat: with selective filters the read can still pass many unfiltered matches; bounding that would need candidates sourced from anchors or paths, which the spec does not ask for.

**Tests.** Make T-09 literal: cap 2, three 'alpha' notes -> items = the sorted ids' first two, each score 2.0794 (3 x ln 2), ranking 'partial', complete false. With limit 1: page 2 has the second id, next null, complete false. Do not assert the work bound itself; §7 says to measure at the 20,000-note scale and record it without asserting.

**Questions the checker raised (answered by R7).** Confirm that the partial set is the first `cap` filtered matches in refKey (noteId) order on both backends. The spec says only "返回已核对的".

### Item MF9 — group G3; ruling R9

**Found (holds).** note-read-model.ts:986-989: memoryLookup keeps only `item.currentEligible && …`. Retired items have currentEligible false (note-views.ts:674-675), and file deletion makes an item retired today (note-views.ts:300-304). So 'gone anchor with heads' returns []/complete, the same answer as 'exists, no notes', which L12 (line 184) forbids. M-16's third case is it.skip. The same filter hides stale items, and S4B-memory-current-filter.test.ts asserts that. But M-08 says stale items appear as '需复查的（不算现行）', in contrast to '跨目标只收下的（不出现）', and C-02 needs stale notes for its warning rows. memoryConflicts (1095-1101) and memoryFind (1207-1328, every branch) have no anchorExistsNow check. anchorExistsNow (454-466) drops the bounded anchorCandidates/candidatesUnavailable that resolveNoteAnchors already returns (note-anchors.ts:52-55, 771-772). ReadResult/CoreRejection (results.ts:18-29) has no field for them (UNSPECIFIED 1).

**Fix.** (1) memoryLookup: replace `item.currentEligible` with storedState ∈ {accepted, reviewed} and keep the cross-goal visibility conjunct; the other flags only mark items. (2) anchorExistsNow returns the resolver's candidates. (3) memoryConflicts (anchor branch, when `seen` is empty) and memoryFind (whenever an anchor is given: one headsByAnchorKey read, independent of terms) return not_found with those candidates. (4) UNSPECIFIED 1, the smallest change, only in model/note-contracts.ts: `export type NoteAnchorNotFoundV1 = { status:'rejected'; code:'not_found'; reason:'anchor_not_found'; anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean }; export type NoteMemoryReadResult<T> = ReadResult<T> | NoteAnchorNotFoundV1;` memoryLookup, memoryConflicts and memoryFind return it. It is a subtype of CoreRejection, so ReadResult consumers still compile and results.ts is unchanged. The shape matches WriteNoteResult (§2:375), bounded by NOTE_ANCHOR_CANDIDATES_MAX.

**Tests.** NE3, both backends, via platform.notes. (a) The user writes N on {file 'src/a/x.ts'} and the file is then deleted. Lookup returns ready, items [N], anchorStatus 'retired', anchorRetiredReasons ['file_deleted'], currentEligible false, complete true. (b) Lookup {module 'A2'} returns rejected, not_found, anchor_not_found, with anchorCandidates [A/'A', A1/'A1', B/'B', R/'R'] (kind module). Lookup {file 'src/a/z.ts'} returns candidates [{file,'src/a/x.ts','src/a/x.ts'}, {file,'src/a/one/x.ts','src/a/one/x.ts'}]. (c) conflicts and find (with and without terms ['架构']) on {module 'A2'} give the same rejection. conflicts on {module 'B'} returns []/complete. find on deleted 'src/a/x.ts' with terms ['zzzz'] returns []/complete. (d) M-08: the stale note is present with currentEligible false.

**Questions the checker raised (answered by R9).** (a) Rule that lookup filters by stored state plus cross-goal visibility, not by currentEligible. This changes the M-08 test. Also rule whether pending_review and staged appear. (b) Approve the §2 signature amendment (NoteMemoryReadResult) for the three reads.

### Item MF10 — group G3; ruling R10

**Found (holds).** The body-cursor part fully holds. The ordinary-cursor part holds but is latent. note-read-model.ts:835-836 writes the body cursor as {v, op:'body', noteId, version, offset}, and 825-827 checks only those fields: caller, request, rule version and record cursor are not bound (L12). In an unpinned body read, page 1 stores head version 1. After reviewNote the head is v2, so 825 returns invalid/cursor_mismatch. L12 says a note that changed between pages gives revision_conflict. A cursor from a work_run, or one from memoryHistory, is accepted by the host's lookup. The offset is only checked as a non-negative integer: an offset past the end returns '' with next:null, and one inside a character silently rewinds. Ordinary cursors: callerIdentityOf (495-500) drops the host actor.kind, the run goalId and queryJobId, unlike 4A's principalOf (note-service.ts:217-225, §9). The cursor carries a literal v:1 (575) rather than RULE_VERSION (477). The two are equal today but not bound.

**Fix.** bodyPageOf: encode {v, op:'body', id: callerIdentityOf, readOp:'lookup'|'history', noteId, requestedVersion (or null), rule: RULE_VERSION, at: resolved version, offset}. On parse: a mismatch in id, readOp, noteId, requestedVersion or rule → invalid/cursor_mismatch. Unpinned and head.version ≠ at → revision_conflict. Offset > byteLength or not on a UTF-8 boundary → cursor_mismatch. Make callerIdentityOf use exactly 4A's principalOf projection, copied into note-read-model. encodeMemoryCursor/parseMemoryCursor: add and check rule: RULE_VERSION.

**Tests.** NE3 through platform.notes.memoryLookup, on both backends. (1) The host writes N with body '中'×1000. lookup with body {noteId:N, cursor:null} → c1. reviewNote(N, expectedVersion 1, 'review'). lookup with body {N, cursor:c1} → {status:'rejected', code:'revision_conflict'}. (2) Get c1 under f.inner.workCtx(run) and reuse it under the host ctx → {rejected, 'invalid', 'cursor_mismatch'}. (3) Pass a body cursor from memoryHistory(N) to memoryLookup's body → {rejected, 'invalid', 'cursor_mismatch'}. The rule version and principal fields cannot be observed without forging a cursor, so leave them to review.

**Questions the checker raised (answered by R10).** (a) For the body cursor, is the "记录游标" the global store cursor (as the outer cursors use, so any write in the store breaks body paging) or the note's resolved head version (recommended)? (b) The outer request binding includes body.cursor (964, 1016), so items and body cannot page together. Rule that the outer cursor binds only body {noteId, version}.

### Item MF11 — group G3; ruling R11

**Found (holds).** memoryHistory (note-read-model.ts:1027-1041) reads every version, runs confirmedByUserOfVersion (O(n²) reads), observes files and calls withCheck on all versions before slicing (1045-1053). Page 2 is therefore checked after versions not on the page have used the per-page file, fact and recheck budgets (L11 '这一页'). The impact is small: a note has about 4–5 versions. 1060-1061 attaches the body to every item with that noteId, so every history row gets it. At 1002, lookup puts an old version's body on the head row. memoryNeighbors uses version only in the cursor request (1121), reads the head (1129), and returns ready for version 99. In checkOne (note-views.ts:584-595, 668-675), stateEligible uses the version's state, ownGoal uses head.confirmedByUser, and conflicting/overQuota use the head, while the item shows the historical confirmedByUser (885, 1033). Concrete case: A is accepted, then B replaces A, so A v2 is superseded. readNote(A, {version:1}) returns storedState 'accepted' with currentEligible true.

**Fix.** memoryHistory: list version numbers from head down to 1, slice by the cursor, then read, confirm, observe and check only the page. bodyPageOf returns the resolved version; attach the body only where both noteId and version match. memoryNeighbors: when version is given, read that version (not_found if absent) and use its replaces, contradicts and anchors. checkOne: apply the ruling below.

**Tests.** (1) A, then B with replaces [A] (host): readNote(A, {version:1}) → storedState 'accepted', currentEligible false. memoryHistory(A).items.map(i => [i.version, i.storedState, i.currentEligible]) → [[2,'superseded',false],[1,'accepted',false]]. (2) N with body 'hello body', then reviewed: memoryHistory(N, body {noteId:N, version:1, cursor:null}) → items.map(i => [i.version, i.body?.text ?? null]) = [[2,null],[1,'hello body']]. (3) memoryNeighbors(A, {version:99}) → {status:'not_found'}. (4) Check readFactsMax 3: A has 3 note facts (B1–B3) and is reviewed. History with limit 1, page 2 (v1) → freshness 'fresh', uncheckedFacts [] (today 'unchecked', [0,1,2]).

**Questions the checker raised (answered by R11).** UNSPECIFIED 11. Recommended: currentEligible is true only for the head version. Snapshot fields (state, relations, confirmedByUser) come from the version; conflicting, overQuota, freshness and anchor status are computed now. Codex's fully historical reading would mark a superseded note's v1 as eligible. Also rule what happens when the body target is not on the page (today it is silently dropped).

### Item MF12 — group G3; ruling R12

**Found (holds).** fitToByteBound (note-read-model.ts:640-655) drops trailing items only while more than one is left. readBasis is built before trimming (basisOf 657-659, observedFilesOf 619-623), so it keeps the observations of dropped items. observeNoteFiles (239-241) also records over-budget paths as 'unchecked' entries, so readBasis can hold up to limit×32 paths. Example: memoryFind with limit 100 over 100 notes, each with 5 distinct basis paths of about 80 characters. readBasis is about 55 KB, the loop stops at 1 item, and the response is over 48 KiB. A single item can also exceed the bound by itself: 32 paths of up to 4096 characters each (note-anchors.ts:376) appear in observedFiles, changedFiles and readBasis. topics (≤50) and understanding are bounded.

**Fix.** fitToByteBound takes a builder and recomputes readBasis = basisOf(recordCursor, kept) and coverage on every iteration. Then handle the 1-item case as ruled. Apply this in all six reads.

**Tests.** Fixture with resultMaxBytes 5000. Write 4 project-anchored notes; note k has the 4 distinct basis files `src/a/k${k}-${'x'.repeat(200)}-${j}.ts`, created in f.root before the write. Page memoryFind(anchor project, limit 100) to the end. Every page: byteLength ≤ 5000; exactly 1 item (note k, in write order); readBasis.observedFiles deep-equals that note's 4 {path, digest: fileDigestOf(file), outcome:'same'}; the union of ids is the 4 notes. By hand estimate: 1 item ≈ 3.8 KB, 2 items ≈ 7.1 KB; today page 1 ≈ 7.7 KB with 16 observations. The test author recomputes these sizes.

**Questions the checker raised (answered by R12).** L12 does not say what to do when one item alone exceeds the bound. Pick one: (a) return it alone with complete:false and a warning (e.g. 'result_over_byte_bound'); (b) truncate that item's observedFiles and flag it; or (c) reject. Also confirm that readBasis covers only the returned items.

### Item MF14 — group G4; ruling R14

**Found (holds).** note-version-lists.ts:141 sets `at: record.refKey`, but P8 defines `at` as the plan's acceptedAt or the catalog revision time. ArchitectureCatalogRecord (catalog-contracts.ts:73-79) and the baseline snapshot (52-60, content 41-48) carry no time, and neither does EncodedRecord (record-store/ports.ts:72-80). The time exists only as occurredAt on the ArchitectureCatalogAdopted/Revised events, and P2 deferred that link to 8A. Line 90 (`if (proposal.basedOn === null) continue;`) discards the initial candidate's recorded reason; S4A-note-fixture.ts:192 records 'S4A plan'. The M-10 test only shows '没有记下原因' because of that discard. L19 gives the label only to old versions with no recorded reason and forbids inventing one (不编); hiding a recorded reason also contradicts it.

**Fix.** In note-contracts.ts:191, change the item type to `at: string | null`. Catalog items get `at: null` until 8A links each revision to its event; that one link supplies both occurredAt and the reason. Plan items keep acceptedAt. Delete line 90 and keep matching by draft.planId.

**Tests.** Catalog, 2 revisions: items.map(i => [i.revision, i.at, i.reason]) → [[2,null,null],[1,null,null]], with the literal label. Plan, 3 versions: reasonLabel and reason → ['third reason','second reason','S4A plan']. items[0].at equals platform.plans.queryTaskGraph(...).value.plan.acceptedAt, and the three `at` values are strictly descending ISO strings. These replace the not-equal checks on `at`.

**Questions the checker raised (answered by R14).** (a) Amend P8 so the catalog `at` is nullable, and add an 8A post-note that the revision–event link also supplies the time. (b) Confirm that the initial adoption shows its recorded reason. M-10's case of an old version without a reason then needs a PlanRevision with no accepted candidate_v2. legacy_v1 is decode-only and cannot be created through public services, so record that half as not constructible, like M-02's removal half.

### Item MF15 — group G0 (fixtures) and G4 (missing flows); ruling R15, R16

**Found (holds).** S4B-note-check-fixture.ts:99-107 spies createNoteReadModel and replaces production's injected check (create-platform.ts:1293-1299). Lines 119-127 then build a second check, a second read model (`memory`) and separate version lists. No test calls platform.notes.memory* or listPlanVersions, so a wiring defect in production would pass. All NE3 files use 'memory' only, although §5 says service-level examples run on both backends, and the readMany fault spy (:86) is memory-only. §7 and §9 list the allowed doubles; a read-model factory spy is not one of them. S4B-text-search.test.ts:450 and :480 compare against refs(before), which is never asserted literally. Missing flows: the M-07 race half; M-11 write-side missing/forbidden/out-of-workspace/unavailable (no test mentions basis_file_missing) and read-side forbidden/unavailable; M-03 workspace-unavailable; M-14 forbidden; M-15 satisfied task.

**Fix.** Drop the read-model spy and the extra readers; tests call f.inner.platform.notes.*. Widen noteLimits (create-platform.ts:254) to the check and read-model limits; it is already spread into both factories. Keep the fault spies, add a SQLite backend spy (the interleave-fixture pattern), and run the NE3 rows with it.each(['memory','sqlite']).

**Tests.** M-07 race: createS4AInterleaveFixture(kind), then an N-14 interleave on src/a/x.ts. memoryConflicts(host, that anchor) → both ids, each with conflicting true and currentEligible false. M-11 write: ['src/a/missing.ts'] → {rejected, invalid, basis_file_missing, draft}; ['.env'] → invalid, basis_file_forbidden; ['../out.txt'] → invalid (likely `unavailable` today, note-service.ts:704); the workspace-unavailable double → {rejected, unavailable}. M-11/M-03 read: that double → outcome 'unavailable', freshness 'unchecked'. Swapping the basis file for an in-workspace symlink (sandbox ELOOP) → 'forbidden'; verify this in WSL. M-14: the fact {file, '.env', '0'×64} → unresolvedFacts [{index:0, reason:'forbidden'}]. M-15: satisfy t1 through the real completion path (the S2C-L-check-support pattern) → anchorStatus 'live', anchorRetiredReasons []. Lines 450/480 → [keyOf('p1','n1')].

**Questions the checker raised (answered by R15, R16).** M-13 needs checkNotes with withSimilar, which is not on the notes holder. Either keep a check-only instance for M-13 or expose checkNotes on platform.notes now (4C binds it). Also rule on the '../' write mapping if the test fails.

## 7. Groups (order and cut)

- **G0 — fixtures first (R16, item MF15's fixture part).** Rebuild the NE3 helpers on the real `platform.notes` holder
  and both backends; expose `checkNotes` on the holder; keep round 1's tests green on the new helpers (rewrite them
  where R9/R16 say). Files: `tests/helpers/S4B-*`, the `S4B-*` tests, `create-platform.ts` (holder member only), and R16's
  optional S4A helper change.
- **G1 — the full-text store (item MF8, R8; the T-row literal expectations of MF15).** Files: `record-store/*` and
  `tests/record-store/S4B-text-search.test.ts`. **G0 and G1 may run at the same time** (no shared file).
- **G2 — the check port (items MF1, MF2, MF3's check half, MF4, MF5, MF13; R1–R5, R13).** Files:
  `views/note-views.ts`, `model/note-contracts.ts`, S4B tests. After G0.
- **G3 — the reads (items MF3's read half, MF6a, MF6b, MF7a, MF7b, should-fix, MF9, MF10, MF11, MF12; R3, R6, R7,
  R9–R12, R15).** Files: `notes/note-read-model.ts`, `model/note-contracts.ts`, `notes/note-service.ts` (R15 only), S4B
  tests. After G2.
- **G4 — version lists and the missing flows (items MF14 and MF15's remaining flows; R14, R16).** Files:
  `notes/note-version-lists.ts`, `model/note-contracts.ts`, S4B tests. After G3.
- **Last:** registration check in `create-platform.ts`, the allowlist (at most one `kept-for` group, as round 1), and
  the checks of section 8.

Finish within 145 minutes (the run stops at 150). If you run short, finish whole items rather than half of many, and say which are left.

## 8. Checks

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`; the
S4B test files; all `tests/work-graph/S4A-*.test.ts` and `tests/composition/platform.test.ts`; the full suite once
(`--maxWorkers=4`) compared with `DSH-BASELINE.md` §A and §B — list every failure outside them. `git status --short`
must show only files of the L-scope.

## 9. Reply

FILES CHANGED; per item (MF1 … MF15, MF6a/b, MF7a/b, should-fix) the test name(s), the implementation file:symbol and
RED/GREEN in one line each; items or cases not built and why; the reviewers' findings and what was done; CHECKS with
numbers; UNSPECIFIED (short, each with the spec line or ruling); NOTES (regrouping, sizes).
