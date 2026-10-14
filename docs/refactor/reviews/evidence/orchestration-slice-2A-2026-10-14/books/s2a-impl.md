# Task: slice 2A — the decision queue reads only what it needs, never refuses for size, and pages to the end; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec and this message do not determine something, do not invent behaviour: list it under
UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
Earlier runs lost all their work that way: they started subagents and then ended the turn.
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- No notification wakes you after your turn ends.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents.** You are the coordinator; keep your own context small.
- Do not read the spec, the code or the test files yourself.
- Give each group of section 6 to its own subagent. Its message contains: sections 1–5 of this message verbatim; its own
  group block verbatim; the instruction to read, in order: (1) `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`;
  (2) the spec sections its block names, always including §0.3 L1–L11, §0.4 and §8; (3) the code at the named symbols;
  then: work through its rows test-first (section 5, rule 1), run `npm run typecheck` and its own test files only; reply
  with FILES, per row the test name(s) and the implementation file:symbol, the test numbers of its files, and
  UNSPECIFIED items.
- Groups write disjoint files. A subagent never edits a file of another group; if it needs a change there, it stops and
  tells you, and you pass it on.

## 1. What this copy is

- **Base:** commit `slice-setup` holds the content of commit a9de6822 of the lead's branch (wiring package 2, K slice
  parts A and B merged). This copy has its own history, so `a9de6822` itself is not in it; use `slice-setup`.
- **Commit `slice-base`** adds, on top: the lead-frozen changes to 3 old test files (5 tests, section 3), a baseline fix, and
  `DSH-BASELINE.md`, the lead's measured baseline.
- **The TDD skill** the user chose for all test writing is in `./.dsh-ref/tdd/` (not committed, excluded from
  `git status`).
- **What you do:** implement **slice 2A** of the spec **test-driven**: for each row of spec §5.2 QA-01..QA-18, write one
  failing test at the row's entry point (spec §5.1), see it fail for the right reason, write just enough production code
  to make it pass, go to the next row.
- **The 5 frozen old tests** (R2A07 on both backends, R2A09, F07, M07) describe the behaviour after 2A; today they fail
  with `capacity`. They must pass at the end. You never edit them.
- **This sandbox has no bubblewrap.** Tests that run a registered check or a real sandboxed command fail here with the
  sandbox kind. `DSH-BASELINE.md` lists every such failure; the lead runs those outside with bubblewrap. Never
  instrument a harness to fake a sandbox. 2A's own rows do not need a sandbox.

## 2. Where the rules are (all inside this copy)

The frozen spec, `docs/refactor/design/orchestration-2026-10/slices/slice-2A-SPEC.md`. Chinese prose, English
identifiers. Read:
- §0.3 L1–L11 (binding) and §0.4 (which bounds go and which stay; the table is binding);
- §1, §2 (interfaces), §3, §4 (rules), §5 (tests: §5.1 entries QE1–QE4, §5.2 rows QA-01..QA-18, §5.3), §6, §7, §8;
- §9 records how reviews were handled (background only).

Two lead amendments to the spec, binding (decision 56 of `docs/refactor/HANDOFF.md`):
- **A1 — you write the fixtures.** Spec §7 says "Codex writes the large-dataset fixtures and the two exceptions". This
  session cannot let Codex write, so you write them, under the rules of section 4 (L-fixtures). The lead and Codex
  review them afterwards.
- **A2 — §5.3's placeholder for wiring package 2 is filled.** The lead froze two of its tests: F07
  (`tests/work-graph/WP2-context-extensions.test.ts`) and M07 (`tests/work-graph/WP2-undelivered-notices.test.ts`), now
  expecting 5,001 items to be read without `capacity`. M10's four whole-window attempts do not change.

## 3. Frozen files (never change them, not even temporarily)

At the end, `sha256sum` of these prints exactly:

```
4133c9ee218aaac96ce5e2eb5a0dc0c00272fa2e62328a7cef59b1501e0844bd  DSH-BASELINE.md
0f3b59a9315fb0efaf7422802789a503149a80fa5bd4247b932528ecafe6339f  tests/work-graph/S5R2-queue-history.test.ts
348fe88921267be4db0b604339bb616f9f27ef9141572bb00ff466cf82e3c8cb  tests/work-graph/WP2-context-extensions.test.ts
b7dbe545074d68e19610a26edfb1cf60d8e2a3d5e55dc131047a326b35c50d4f  tests/work-graph/WP2-undelivered-notices.test.ts
```

- **No other existing test file changes either.** `git diff --stat slice-base -- tests` may list only new files.
- **Probes:** throw-away scripts go under `./.dsh-scratch/` and are deleted at the end. Never use `/tmp`.
- **If the spec seems to contradict an existing or frozen test:** keep that test as it is; report it under UNSPECIFIED
  with the test id, the assertion, the spec line and a minimal counter-example; go on with the other rows.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only these may change (plus `src/core/work-graph/model/decision-contracts.ts`, P7, and the adapted doubles of P8):
  - RecordStore: `src/core/record-store/lookup-ports.ts`, `lookup-index.ts`, `in-memory-record-store.ts`,
    `sqlite-record-store.ts`;
  - index registrations: `src/core/work-graph/sessions/message-record-codecs.ts`,
    `src/core/work-graph/tasks/claim-record-codecs.ts`, `src/core/work-graph/persistence/evidence-record-codecs.ts`;
  - the queue: `src/core/work-graph/views/decision-read-model.ts`, `views/goal-conflicts.ts`,
    `views/automatic-rework-notices.ts`, `views/context-extensions.ts`, `views/undelivered-reply-notices.ts`,
    `src/core/work-graph/tasks/plan-readers.ts`, `tasks/planning-question-reader.ts`;
  - the `since` fix: `src/core/work-graph/communication/mailbox-service.ts`, and any other write the L5 audit finds
    that loses `since` the same way (name each one in your reply);
  - new test files whose names start with `S2A-` under `tests/record-store/`, `tests/work-graph/` or `tests/app/`, and
    new helpers `tests/helpers/S2A-<name>-fixture.ts` or `tests/helpers/S2A-<name>-support.ts`.
  - Nothing else: no lock files, no `docs/`, no UI, no `vendor/`, no existing test or helper file. At the end
    `git status --short` lists only these.
- **L-caps.** Remove exactly the rows of spec §0.4 marked 去; keep every row marked 留. The lead rechecked the
  wiring-2 rows on this base: `views/context-extensions.ts:45–46` and `:300–307` (`DECISION_MAX_PAGES`,
  `DECISION_MAX_ITEMS`, `decision_index_page_limit`); `views/undelivered-reply-notices.ts:38–41`, `:184–195`, `:383`
  (`MAX_SOURCE_PAGES`, `MAX_SOURCE_ITEMS`, the `findSessions` listing that §0.4 row 5 replaces). Keep the request check
  at `undelivered-reply-notices.ts:80–82` (page limit 1–200; it is request validation). `context-extensions.ts:36`
  (`LOOKUP_MAX_PAGES`, the anomaly-anchor read) is not on the queue path: keep it.
- **L-tdd.** Follow `./.dsh-ref/tdd/` and spec §5:
  - one row → one failing test → minimal code → next row;
  - tests at the row's entry point only, through public interfaces;
  - **no reading the database or record store to verify** (the user's standing rule): assertions go through the public
    reads the entry names;
  - expected identities, orders and counts are literal values in the test or the fixture, never computed with the
    product's comparison functions (spec §5, including `compareNoticePositions` and L1's ordering);
  - service-level examples run on both backends (memory and SQLite); the examples that cross the old bounds (5,001,
    201) really cross them on both backends;
  - each test name starts with the row id, for example `QA-05 …`; a row that lists several cases has one assertion per
    case;
  - no tests whose answer is obvious from reading the code; refactoring is not part of the loop.
- **L-fixtures (amendment A1).** You write the fixtures of spec §7:
  - Build every dataset **only through the real public services** (sending messages, decision requests, creating
    Goals and Tasks, requeues, reverifications, notices). Never write records directly, except the two exceptions below.
  - Exception 1 (QA-11): the three valid historical requeues without `since` that QA-11 needs, committed at the storage boundary, that today's
    codecs decode. Assertions only through public reads.
  - Exception 2 (QA-16): a storage-port test double that wraps the real store and commits exactly once in the middle of a
    named read. Plus QA-14's storage wrapper that makes reads fail. No other doubles.
  - Each fixture file starts with a comment that lists what it builds and through which public calls.
  - Keep large datasets fast enough: build once per test file where the rows allow it; the slowest test may take up to
    600 s (P12).
- **L-reach.** `tests/architecture/production-reach.test.ts` must still pass: every new exported declaration is reached
  from production code. The allowlist cannot be edited.
- **L-interfaces.** Names, signatures and fields exactly as spec §2 and L1–L11 give them: `RecordOrderedLookupPort`,
  `lookupOrdered`, `orderBy.valueType` `'text' | 'integer'`, and the five new indexes of §1.1 item 2.
- **L-state.** State changes go through `src/core/work-graph/state/` (AGENTS.md rule 9). 2A adds no state row.

**Lead answers to the pre-read (binding; they refine the spec where it was silent).**
- **P1 — one assembly per attempt (L11).** At the start of each window attempt the read model creates an
  attempt-scoped object and passes it to every source it reads in that attempt; a source builds its whole collection
  once per attempt (member notices `decision-read-model.ts:998–1034`, planning questions
  `planning-question-reader.ts:137–159, 201–208`) and serves its pages from it. The object is dropped when the attempt
  ends. No module-level or cross-call cache.
- **P2 — QA-11 has three legacy requeues,** as the row says (the book's "one record" meant one kind of exception).
- **P3 — Session listing for undelivered replies (§0.4 row 5).** Use the existing Session-by-workspace index
  (`session-record-codecs.ts:948`) in its key order; QA-10's "目录顺序" means that order. The source's `sessions`
  dependency stays declared (callers and the frozen M07/M11 build it) but is no longer read for the listing; say so in
  a one-line comment.
- **P4 — QA-16's "middle of a read".** The double counts read-port calls per window attempt and commits exactly once
  right after the attempt's first data read (the first `readMany`, `lookup` or `lookupOrdered` after the attempt's
  watermark read). The fixture names which attempts are interrupted.
- **P5 — `LookupBatch.truncated` stays in the type and is always `false`** (L10: `lookupAll` reads to the end).
- **P6 — the context-extension page size stays.** In §0.4 row 1 only the 50-page/5,000-card bound and its `capacity`
  go; `DECISION_PAGE_LIMIT` (100) is a page size and stays.
- **P7 — the ordered port reaches the queue by type, as spec §2 says.** Where code reads in order it takes
  `RecordLookupPort & RecordOrderedLookupPort` (for the queue: `DecisionReadRecordsPort & RecordOrderedLookupPort`).
  `src/core/work-graph/model/decision-contracts.ts` joins L-scope, only for these types. Index-name constants are
  exported from the codec file that registers each index (the existing pattern, e.g. `S5_MESSAGE_BY_WORKSPACE_STATUS`).
  The two legacy indexes are plain equality indexes with no `orderBy`.
- **P8 — adapting existing doubles (L-adapt).** An existing test or helper file (never one of the 3 frozen files) may
  change only to give a records double or a records type the `lookupOrdered` method the new types require. The double
  delegates to the real store and applies to `lookupOrdered` the same corruption or fault it applies to `lookup`. No
  assertion, name or data changes. List every such file and line in your reply. Known case:
  `tests/work-graph/S5-notices.test.ts` `corruptOrigin` (NR05): add `lookupOrdered` that corrupts `since` like the
  other two.
- **P9 — index/record mismatch is a read failure.** A record returned by an ordered index whose decoded order value is
  missing or outside the request (for example `since: null` from `s2a-requeue-by-project`) makes the source report
  `unavailable`; never skip it silently. This keeps NR05's expectation.
- **P10 — `readThrough`** of `lookupOrdered` means the same as `lookup`'s today: the ledger watermark the page was read
  at.
- **P11 — QA-10(二) drops the "available Session with 2,001 responsibility links" case.** Building 2,001 links through
  public services takes 2,001 claims on one Session; the new listing reads no links at all, and the lead checks that in
  code review (the source never calls `findSessions` or a work-link lookup). The rest of QA-10(二) stays.
- **P12 — timeouts.** The 5,001-scale tests may use up to 600 s each. Report each test's wall time.
- **P13 — the L5 audit starts here:** every caller of the encode functions of the message, requeue, verification-round
  and plan-proposal codecs, and every use of `preservedNoticeOrigin`. Report the list with file:line and whether each
  keeps `since`.
- **P14 — `plan-readers.ts`:** the 25-page bound is at `:509` (`:1431–1434` in spec §0.4 is a caller).

## 5. Rules for every group

1. **Test-first, one row at a time** (L-tdd). Keep a short log per row: the test name, the first failure message you saw
   (RED), and the change that made it pass (GREEN). This log goes into your reply.
2. **Spec §4 rules and §8 hold**, and L1–L11.
3. **Read failures and refusals are returned, never turned into success or an empty result.**
4. **No real model calls.** No network. Do not touch ports 3080, 3099 or 44797.
5. **No git write commands:** no commit, no stash, no checkout of other revisions.
6. **Run one vitest command at a time;** never two in parallel.

## 6. Groups and rows

Order: **wave 1** group O alone. **Wave 2**, after O has reported its exported names: groups Q and N in parallel.
**Wave 3**: group H, then group I. Then the self-check (section 7).

**Group O — ordered lookup and the new indexes (entry QE1).**
- Production: the RecordStore files of L-scope; the index registrations of the three codec files.
- Tests: new `tests/record-store/S2A-ordered-lookup.test.ts` (both backends in one file).
- Rows: QA-01, QA-02, QA-03, QA-15.
- Spec: L1; §2 the RecordStore part; §1.1 items 1–2.
- Report the exact exported names, signatures and index ids as soon as they exist.

**Group Q — the queue and its cards (entry QE2).**
- Production: `decision-read-model.ts`, `goal-conflicts.ts`, `plan-readers.ts` (`readLookupKeys`),
  `planning-question-reader.ts`, `context-extensions.ts`.
- Tests: new `tests/work-graph/S2A-*.test.ts` files; fixtures `tests/helpers/S2A-*-fixture.ts` (L-fixtures).
- Rows: QA-04, QA-05, QA-06, QA-07, QA-08, QA-09, QA-16, QA-17.
- Must pass at the end: the frozen R2A07 (both backends), R2A09, F07; and, unchanged, `tests/work-graph/S5-decision-queue.test.ts`,
  `S5-notices.test.ts`, `S5-user-messages.test.ts` (UM09's write-size `capacity` stays), `tests/app/S5-decision-routes.test.ts`.
- Spec: L2, L3, L6, L7, L8, L9, L10, L11; §0.4.

**Group N — the notices (entry QE3).**
- Production: `automatic-rework-notices.ts`, `undelivered-reply-notices.ts`, `mailbox-service.ts` (and any other write
  the L5 audit names). If you need a change in `decision-read-model.ts` (group Q's file), stop and tell the coordinator.
- Tests: new `tests/work-graph/S2A-notices*.test.ts`; fixtures as L-fixtures (QA-11's exception lives here).
- Rows: QA-10, QA-11, QA-12, QA-13, QA-18.
- Must pass at the end: the frozen M07; `tests/work-graph/WP2-undelivered-notices.test.ts` M10 unchanged.
- Spec: L4, L5, L7; §0.4 the wiring-2 rows.

**Group H — the HTTP route (entry QE4).**
- Production: none expected (the route already exists); if a change is needed, stop and report it.
- Tests: new `tests/app/S2A-decision-routes.test.ts`, on QA-05's dataset through the real route.
- Rows: QA-14.

**Group I — integration.**
- Run the 3 frozen files and every new `S2A-` file; fix what fails in the files of the group that owns them (start a
  new subagent for that group if its first one has finished). Never change a frozen file.
- Then run the full suite once (section 8) and compare with `DSH-BASELINE.md`.

## 7. Self-check

When all groups have reported and `npm run typecheck` passes, start one read-only review subagent per group O, Q, N
(group H's test file goes to Q's reviewer),
with a fresh context. It reads `./.dsh-ref/tdd/`, spec §5 and §0.4, its group block, and the final diff of the group's
files (`git diff slice-base -- <files>` plus the new files). It answers:
1. Per row: covered or not, with the test name; does the test exercise the row's entry point; is its expected value
   literal and independent; does each case of the row have its own assertion?
2. Per test: any TDD anti-pattern (implementation-coupled, tautological, trivial, a database read).
3. Per fixture: built only through public services, except the two named exceptions?
4. Per §0.4 row of its group: removed / kept as the table says, with file:line.
5. Any defect: a bound that still refuses the whole queue, a truncated page reported as complete, a read failure turned
   into an empty result, a card or notice whose content changed (§8), a frozen file changed.

The owning group fixes what is not done, with a new subagent if needed. Then run section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
node scripts/build-kernel-patch.mjs --check
npx vitest run tests/work-graph/S5R2-queue-history.test.ts tests/work-graph/WP2-context-extensions.test.ts tests/work-graph/WP2-undelivered-notices.test.ts tests/work-graph/S5-decision-queue.test.ts tests/work-graph/S5-notices.test.ts tests/work-graph/S5-user-messages.test.ts tests/app/S5-decision-routes.test.ts tests/record-store/S2A- tests/work-graph/S2A- tests/app/S2A-
npx vitest run
sha256sum DSH-BASELINE.md tests/work-graph/S5R2-queue-history.test.ts tests/work-graph/WP2-context-extensions.test.ts tests/work-graph/WP2-undelivered-notices.test.ts
git diff --stat slice-base -- tests
git status --short
```

Expected at the end (this sandbox, no bubblewrap):
- typecheck, check:architecture, build and the kernel-patch check exit 0.
- The targeted run: everything passes.
- The full suite: no failure other than those listed in `DSH-BASELINE.md` section A (same files, same tests).
- Every sha256 as in section 3; `git diff --stat slice-base -- tests` lists only new files; `git status --short` lists
  only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 9. Reply format

Reply with these five sections and nothing else:
- **FILES CHANGED:** each file changed or added, one per line.
- **ROWS:** one line per row: `row | test name(s) | RED message first seen | implementation file:symbol`.
- **CHECKS:** each command, its exit code; for vitest the `Test Files` and `Tests` lines and, for every file with a
  failure, each failing test id and the first line of its failure, marked `baseline` or `NEW`.
- **UNSPECIFIED:** per L-rule: done with file:symbol, or what was not done and why; each case the spec does not
  describe; each existing or frozen test you believe contradicts the spec; every §0.4 row with its fate.
- **NOTES:** at most ten lines: the subagents you ran, anything that blocked you, and the wall time of the slowest test.
