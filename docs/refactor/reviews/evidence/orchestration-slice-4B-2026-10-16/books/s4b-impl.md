# Task: slice 4B — note search and freshness; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec and this message do not determine something, do not invent behaviour: list it under
UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (`sleep 300`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents; keep your own context small.** Do not read the spec, the code or the tests yourself beyond what
you need to coordinate; use `grep -n` and `sed -n a,bp`, never whole large files. At most **2 subagents at once**, and
never two building subagents on the same file. Each building subagent's message contains sections 1–5 of this message
verbatim, its own group block of section 6 verbatim, and: read `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`;
read the spec sections its block names, always including §0.2, §0.3 L9–L12, L19, L22, L23, §0.4, §8 and §9; work
through its rows test-first; run `npm run typecheck` and its own test files only; reply with FILES, per row the test
name(s) and the implementation file:symbol, the RED/GREEN log, and UNSPECIFIED items (short). After each building
group, a read-only reviewer subagent checks that group's diff against the spec (it does not edit); fix its findings
in the next group or a short last pass.

## 1. What this copy is

- **Base:** commit `slice-setup` holds the content of the lead's branch after slices 2C, RL (resource caps) and 4A
  (the note core) were merged. 4A built the note records, writes, dispositions, the current pointer, scribe scope and
  the per-scope count; 4B builds on it. This copy has its own history; use `slice-setup`, not outside hashes.
- **Commit `slice-base`** adds `DSH-BASELINE.md`, the baseline of this sandbox (tests that fail here only because the
  sandbox has no bubblewrap or systemd user session).
- **The TDD skill** is in `./.dsh-ref/tdd/` (not committed, excluded from `git status`).
- **What you do:** implement **slice 4B** of `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`
  **test-driven**: for each row T-01 … T-09 (entry NE2) and M-01 … M-16 (entry NE3) of spec §5.2 (the user confirmed
  the entries), write one failing test at the entry, see it fail for the right reason, write just enough production code
  to make it pass, go to the next row.
- **4A's own reports and rulings** are in `./.dsh-ref/` (`s4a-final-3.md`, and spec §9, which binds 4B too).

## 2. Where the rules are (all inside this copy)

The frozen spec, slice 4 (Chinese prose, English identifiers). For 4B read: §0.2 (code facts; find the symbol if a line
moved), §0.3 **L9–L12, L19 (the two version lists), L22, L23** (binding), §0.4, §1.1 (the 4B paragraph), §2 (names and
signatures bind; only the parts 4B delivers: the RecordStore full-text port in `record-store/lookup-ports.ts`,
`NoteMemoryReadPort`, `NoteCheckPort`, the 4B fields of the note read types), §3 (S4-NOTE rows 4B reads), §4, §5.1 NE2
and NE3, §5.2 T-01–T-09 and M-01–M-16, §5.3, §6 (the 4B line), §7, §8, and **§9 (4A's construction rulings; they bind
4B)**. L13–L17, L20, L21 belong to 4C: do not build them. Repository rules: `AGENTS.md` (state writes only through
`src/core/work-graph/state/`, rule 9).

What §9 means for 4B in particular:
- a read failure is never a definite answer: lookups, pointers, scope, duty and catalog reads that fail give
  `unavailable`; reads go to the end (no internal caps) unless the spec gives a bound, and going past a spec bound is the
  spec's answer (`complete: false`, `unchecked`, `capacity`), never a silently shorter list;
- the per-scope count of L7 (`NoteScopeReadPort.countCurrentNotes`) counts `accepted`/`reviewed` today; 4B narrows it
  to `currentEligible` per L9 (P1 of the 4A book);
- the project-level review slot is the stored `goalId: null`;
- the symbol locator 4A stores has the range the source query returns (the name span) and a signature digest of that
  text; 4B's read-side symbol check compares against exactly that.

## 3. Frozen files (never change them, not even temporarily)

`DSH-BASELINE.md` and the spec. **No existing test file changes**, except where §5.3 lists one for 4B (then exactly
the before/after it gives). Throw-away probes go under `./.dsh-scratch/` and are deleted at the end; never use `/tmp`.
If the spec seems to contradict an existing test, keep the test, report it under UNSPECIFIED (test id, assertion, spec
line, minimal counter-example) and go on.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only the files of spec §6's 4B line may change (`record-store/lookup-ports.ts`, `lookup-index.ts`,
  `in-memory-record-store.ts`, `sqlite-record-store.ts`, `migrations.ts`; `notes/note-read-model.ts`; new
  `views/note-views.ts`; `architecture/catalog-record-codecs.ts` for the catalog revision sort index; the version-list
  reads), plus the registration of 4B's own parts in `src/composition/create-platform.ts`, new test files whose names
  start with `S4B-` under the fitting `tests/` directory, and new helpers `tests/helpers/S4B-<name>-fixture.ts` or
  `-support.ts`. No `docs/` file, no lock files, no `vendor/`. A file outside this list that you believe must change:
  stop and report it.
- **L-tdd.** One row → one failing test → minimal code → next row; tests at the entry (NE2: the public RecordStore
  `searchText` on both backends; NE3: the public `NoteMemoryReadPort` with the real workspace tools and files in a
  temporary workspace, plans and catalogs changed through the real services); **no reading the database or record store
  to verify** (the user's standing rule) — assertions go through the public reads; expected values are literal,
  hand-computed from the spec (T-07's ranking is computed in the spec row: use those numbers), never computed with the
  product's own functions; each test name starts with the row id (`T-05 …`, `M-09 …`); a row with several cases has one
  assertion per case; no tests whose answer is obvious from the code.
- **L-fixtures.** Build every dataset only through the real public services (4A's `platform.notes` writes and
  dispositions, goals, plans, tasks, Sessions, Runs, catalog adoption and revision, workspace files). Exceptions, exactly
  as spec §7 names them (for T-06, the way the row itself allows to make "the FTS table missing or its version wrong");
  4A's two doubles (the storage commit gate, the read-fault double) may be reused for the same purposes. Each fixture
  file starts with a comment listing what it builds and through which public calls.
- **L-reach.** `tests/architecture/production-reach.test.ts` must pass: every new exported declaration is reached from
  production code (4B adds no route; 4C binds the reads to routes). If a 4B read has no production consumer until 4C,
  add exactly one allowlist group `kept-for` "slice 4 of the orchestration design" naming its 4C reader, and list it.
- **L-interfaces.** Names, signatures, record and index ids exactly as spec §2 and the L-rows give them.
- **L-state.** 4B adds no state transition; if you believe one is needed, stop and report it.

## 5. Rules for every group

1. Test-first, one row at a time; keep the RED/GREEN log per row for the reply.
2. Spec §4 rules, §8 and §9 hold, and L9–L12, L19, L22, L23.
3. Read failures and refusals are returned, never turned into success, zero or an empty result.
4. No real model calls, no network; do not touch ports 3080, 3099 or 44797.
5. No git write commands.
6. One vitest command at a time per agent, `--maxWorkers=4`; the full suite only once at the end (section 8).
7. SQLite FTS5: if the build or the platform lacks it, the port answers `unsupported` (NE2); never fake it.

## 6. Groups (order and cut; the read-through may propose a better cut)

- **G1 — the full-text port (NE2: T-01 … T-09).** RecordStore files only: `normalizeSearchText`, `bigramWindows`, the
  full-text registration, `searchText` on both backends, the FTS table in `migrations.ts`, `'all'` and `'any'` with the
  ranking and the partial ranking (T-07–T-09).
- **G2 — the reads that do not search (NE3: M-01 … M-07, M-11, M-14 … M-16).** Freshness (files, definitions, the 256
  file budget, retired basis notes, `sourceUnavailable`, invalid repairs, conflicts), workspace observation at write,
  the after-write check, anchor status, `not_found` versus empty. Files: `notes/note-read-model.ts`,
  `views/note-views.ts`. G2 touches no RecordStore file, so **G1 and G2 may run at the same time**.
- **G3 — the reads that page, list versions and search (NE3: M-08 … M-10, M-12, M-13, and `find` over the G1 port).**
  The current-conclusion filter and cross-goal order, paging and cursors, the two version lists (L19, with the catalog
  revision sort index), `UnderstandingStatusV1.updateDue`, similar notes, and `find`'s ranked search. After G1 and G2.
- **Last:** narrow 4A's per-scope count to `currentEligible` (§2 above), registration in `create-platform.ts`, the
  checks of section 8.

## 7. Size and time

Finish within 230 minutes (section 10 P13). If you run short, finish whole rows rather than half of many, and say which rows are left.

## 8. Checks

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`; the
4B test files; all `tests/work-graph/S4A-*.test.ts` (4A must still pass); the full suite once (`--maxWorkers=4`)
compared with `DSH-BASELINE.md` §A — list every failure outside it. `git status --short` must show only files of the
L-scope.

## 9. Reply

FILES CHANGED; per row T-01–T-09 and M-01–M-16 the test name(s), the implementation file:symbol and RED/GREEN in one line
each; rows or cases not built and why, grouped "4C 联动补验" or other named slices; the reviewers' findings and what was
done; CHECKS with numbers; UNSPECIFIED (short, each with the spec line); NOTES (regrouping, sizes).

## 10. Lead answers to the read-through (binding; they amend sections 1–9 above)

The read-through (`s4b-preread`) was checked against the spec and the code. Where an answer changes a section above, the
answer wins.

- **P1 — the full-text port is AND only; ranking lives in the read model (preread 1.1, 1.2, 2.2, 3.3).** The frozen
  `TextSearchRequest`/`TextSearchPage` stay exactly as spec §2 gives them (no `match`, no score). `searchText` returns the
  records whose comparison text contains **every** term as a substring (today's rule, `'all'`), in refKey byte order,
  after the window candidates are checked; at most `limit` (≤ 100) records per page and at most
  `TEXT_SEARCH_CANDIDATE_MAX` checked candidates per call (then `complete: false` and `next`). The port normalizes the
  terms itself with `normalizeSearchText`; `values` are the equality prefix values (the project id); `terms` must be
  1–8 terms of 2–64 code points without whitespace, else `invalid` (an empty `terms` is `invalid` too). `'any'` is built
  in `memoryFind`: one port read per term (each term's own windows ANDed, so each read is a superset of that term's
  matches), the union deduplicated, then the L10 score, `matchedTerms`, the order and `ranking: 'full' | 'partial'`
  computed in code. So **T-01–T-06 and T-08 are NE2 rows** (the port, both backends; T-08 at the port is the AND rule in
  refKey order), and **T-07 and T-09 are NE3 rows** tested through `memoryFind` (G3). T-09 may inject a small
  `TEXT_SEARCH_CANDIDATE_MAX` (every spec constant is injectable, spec §2); the test states the injected value.
- **P2 — catalog version reasons move to 8A (preread 1.3, 3.1).** Confirmed: no record links a catalog revision to its
  `ArchitectureCatalogRevised` event (the reason is only on the event; the catalog and baseline records carry no cursor),
  and adding the link means changing the catalog revision commit, which slice 8 rewires. 4B builds the catalog version
  list (the sort index, order, revision numbers, paging) and gives every catalog item `reason: null` and
  `reasonLabel: '原因记在目录修订里，第 8 片接上后显示'`; the plan version list gives the real reason or
  `'没有记下原因'`. The lead adds a post-note to L19 and to slice 8 (8A links the revision commit to its reason). M-10's
  catalog half asserts the order, the revision numbers, the paging and that label; it does not assert reasons.
- **P3 — `updateDue` moves to 4C (preread 3.4, 4.5).** No trigger source or cursor rule is defined for "task ended,
  rework, plan adopted, Session archived or regrouped after the last text version", and L16 (4C) is its only consumer and
  also needs `latestTriggerCursor`. The lead defines both in the 4C book. In 4B: every `NoteItemV1.updateDue` is `null`;
  `UnderstandingStatusV1.updateDue` becomes `boolean | null` and 4B returns `null` there with
  `latestTriggerCursor: null` (lead post-note on L9 and §2). **M-12 is not built in 4B** (list it under "4C 联动补验").
  `updateDue` is not part of `currentEligible`, so nothing else changes.
- **P4 — the per-scope count is not narrowed (preread 1.4).** L7's count sizes the scribe's work, and a stale note is
  still the scribe's work; narrowing it to `currentEligible` would read files without bound for a count. 4A's count
  (`accepted`/`reviewed`, deduplicated by note identity) stays as it is; `notes/scribe-scope.ts` is not touched. The
  "Last" step of section 6 is only the registration and the checks. (Lead post-note on §9.)
- **P5 — the FTS table, its code and the rebuild (preread 1.5, 2.5, 3.2, 4.6).** `migrations.ts` keeps its contract and
  is not changed. The FTS table, its code and the rebuild go into a new file `src/core/record-store/sqlite-text-search.ts`,
  called from the SQLite backend's open. The **code** is a digest of the full-text registration (index name, aggregate
  type, prefix paths, text paths) plus a normalization rule version constant; it is stored with the FTS table (in a small
  table owned by this file, or in the FTS table name — your choice, say which). At open: FTS5 probe (temporary table, one
  Chinese and one English sample); unavailable → the port answers `unsupported`; table missing or code different → drop
  that index's FTS table and rebuild it from the head records before the store answers (the spec's `index_not_ready`
  answer applies only while a rebuild is running). **T-06 triggers** through public use only: (a) open a store without
  the test text index registered, write records, close, reopen with it registered (table missing → rebuild); (b) reopen
  with a changed registration (code different → rebuild); both give the same results as before. **FTS5 unavailable:**
  add one optional option to the SQLite backend options, e.g. `fullTextProbe?: () => boolean` (default: the real probe);
  T-06 passes `() => false`. This is the double spec §7 names; it is not used anywhere else.
- **P6 — commit facts (preread 1.6).** Confirmed: a well-formed `commit` fact goes to `uncheckedFacts` and changes neither
  `freshness` nor `currentEligible`; only facts past the `NOTE_READ_FACTS_MAX` budget make the item `unchecked`.
- **P7 — find and stale without terms (preread 1.7).** Candidates come from the existing head indexes, never from the
  full-text port without terms: an anchor → the five anchor indexes (merge, dedupe by `noteId`); `pathPrefix` → five new
  **ordered** indexes on `NoteHead` (paths `['ref.projectId']`, `orderBy: { path: 'anchorKeyN' }`, N = 0–4), range-read
  from the file anchor key of the prefix and stopped when the key leaves it, with the directory-boundary check in code
  (`src/a` matches `src/a` and `src/a/…`, not `src/ab`); terms → P1; none of anchor, `pathPrefix` or terms → the review
  status index `(project, goal slot, state)` over the requested state (or every stored state) and the goal slots (the
  project's goals plus the stored project slot `goalId: null`, spec §9). `stale` with `goalId` reads the status index
  `(project, goalId, accepted | reviewed)`; with an anchor, the anchor indexes. All of these read to the end with the
  stable paging and cursors of L12 (no internal caps; the spec's bounds and `complete: false` apply).
- **P8 — where the 4B types go, and the scope (preread 2.1, 2.3, 2.8, 4.1, 4.4, 4.9).** Section 4's L-scope gains:
  `src/core/work-graph/model/note-contracts.ts` (every 4B type and constant of spec §2: `NoteMemoryReadPort`,
  `NoteCheckPort`, the request/result types, `NoteCheckV1`, `NoteHintV1`, `NoteSimilarV1`, `UnderstandingStatusV1` as P3
  changes it, the constants); `src/core/work-graph/persistence/note-record-codecs.ts` (only the full-text registration
  on `NoteHead` and the five ordered indexes of P7); new `src/core/record-store/sqlite-text-search.ts` (P5); new
  `src/core/work-graph/notes/note-version-lists.ts` (L19); `tests/architecture/production-reach-allowlist.json` (at most
  one `kept-for` group, as section 4 L-reach says). The version lists: `listPlanVersions(ctx, { goalId, limit, cursor })`
  and `listCatalogVersions(ctx, { limit, cursor })` → `ReadResult<VersionListPageV1>`, with `VersionListPageV1 =
  { items: { revision: number; at: string; reason: string | null; reasonLabel: string }[]; next: string | null;
  complete: boolean }` (`at` = the plan's `acceptedAt` or the catalog revision time; at most 50 per page, newest first);
  types in `model/note-contracts.ts`, members of the platform `notes` holder (the 4C routes bind them). The check port:
  `createNoteCheck(deps): NoteCheckPort` in `views/note-views.ts`; `createNoteReadModel` gains an optional injected
  `check: NoteCheckPort` dependency (notes never imports views); the composition root wires it, and the six reads go
  through it (L22). `NoteMemoryReadPort` is implemented by `notes/note-read-model.ts` and exposed on the `notes` holder.
- **P9 — what `NoteCheckPort` reads (preread 4.2).** It resolves each fact pointer by its kind with the existing readers
  available to `views`: record pointers by refKey through the record transaction port (version as L22 says), messages
  through the existing message record decoders, artifacts and history sections through their existing reads, `note`
  pointers through the note head, `file` through `WorkspaceToolsPort`, `commit` by format only. "检查记录" are the
  verification rounds and check results that already exist (`VerificationRound` and its check records). No new index, no
  new store port. If a fact kind cannot be read through an existing reader, stop and report it.
- **P10 — FTS5 is available here (preread 2.4).** Node 24 / SQLite 3.53 has FTS5; the `unsupported` path is tested only
  with the P5 option.
- **P11 — stale spec facts (preread 2.6, 2.7).** F16's `architecture-catalog.ts:18` is now
  `architecture/catalog-contracts.ts`/`catalog-record-codecs.ts`; F1 predates 4A (`NOTE_RECORD_SCHEMAS` is registered).
  Use the code.
- **P12 — similar notes (preread 4.8).** `normalizeSearchText` applied to `topic` and to `conclusion` separately, joined
  with `"\n"`, then `bigramWindows`, Jaccard over the window sets (M-13's 10/11 is computed this way).
- **P13 — groups (amends section 6).** G1 = T-01–T-06, T-08 (record-store files and `sqlite-text-search.ts`). G2 = M-01–
  M-07, M-11, M-14–M-16 (`views/note-views.ts`, `notes/note-read-model.ts`, the 4B types in `model/note-contracts.ts`).
  **G1 and G2 may run at the same time** (no shared file). G3 after both = M-08–M-10, M-13, T-07, T-09, `find` and
  `stale` (P1, P7), the version lists, the five ordered indexes and the full-text registration in
  `note-record-codecs.ts`. Last = registration in `create-platform.ts` and the checks of section 8. M-12 is not built
  (P3). Finish within 230 minutes.
- **P14 — constants across the module line.** RecordStore imports nothing from WorkGraph: the port's own bounds (100 records per page, 1,000 checked candidates per call, the term rules) are record-store constants next to the port in `lookup-ports.ts`; the read model's `TEXT_SEARCH_*` constants live in `model/note-contracts.ts` and bound the read model's own work (for example the size of the match set it ranks, T-09).
