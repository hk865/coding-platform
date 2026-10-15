# Task: slice 2C — status words, the left column of work lines, pins, hover cards and node details; test-driven

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
- Do not read the spec, the code or the test files yourself beyond what you need to coordinate.
- Give each group of section 6 to its own subagent. Its message contains: sections 1–5 of this message verbatim; its own
  group block verbatim; the instruction to read, in order: (1) `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`;
  (2) the spec sections its block names, always including §0.2 (code facts), §0.3 (L-rules), §0.4, §3 (the tables), §15 and
  §8; (3) the code at the named symbols; then: work through its rows test-first (section 5, rule 1), run
  `npm run typecheck` and its own test files only; reply with FILES, per row the test name(s) and the implementation
  file:symbol, the test numbers of its files, and UNSPECIFIED items.
- Groups write disjoint files (section 6 names the owner of every shared file). A subagent never edits a file of
  another group; if it needs a change there, it stops and tells you, and you pass it on to the owner.

## 1. What this copy is

- **Base:** commit `slice-setup` holds the content of commit 79032271 of the lead's branch plus slice 2A as the lead
  verified it for merging (patch `s2a-code-4`, the whole suite passed with bubblewrap). Wiring package 2, K parts A and
  B and 2A are all in. This copy has its own history; use `slice-setup`, not the outside hashes.
- **Commit `slice-base`** adds the frozen spec (`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md`)
  and `DSH-BASELINE.md`, the baseline of this sandbox.
- **The TDD skill** the user chose for all test writing is in `./.dsh-ref/tdd/` (not committed, excluded from
  `git status`).
- **What you do:** implement **slice 2C** of the spec **test-driven**: for each row of spec §5.2 (2C-01 … 2C-41; 2C-06
  is deleted), write one failing test at the row's entry point (spec §5.1, entries LE1–LE7; the user confirmed them on
  2026-10-14), see it fail for the right reason, write just enough production code to make it pass, go to the next row.
- **This sandbox has no bubblewrap.** Tests that run a registered check or a real sandboxed command fail here with the
  sandbox kind. `DSH-BASELINE.md` lists every such failure; the lead runs those outside with bubblewrap. Never
  instrument a harness to fake a sandbox.
- **Slice 2B is being built at the same time in another copy.** It replaces the executed-files stub and adds counts,
  calendars and track bars. Do not build any of that here (spec §1, §8, L15): 2C's tests inject the executed-files port
  themselves ("有" and "没有", 2C-27, 2C-30); the production composition keeps today's stub.

## 2. Where the rules are (all inside this copy)

The frozen spec, `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md`. Chinese prose, English
identifiers. Read:
- §0.2 (code facts; line numbers were checked before K part A and 2A merged — find the symbol if a line moved; the
  "自动维护、接续" facts describe the code after K, which is now merged);
- §0.3 L1–L24 (binding; L1a's truth table, L1b's read budget);
- §0.4 (seams), §1, §2 (interfaces: names and signatures are binding), §3 (how each word, column word and count is
  computed: binding tables), §4 (rules), §5 (tests), §6, §7, §8;
- §9–§14 record how reviews were handled (background only).

Lead amendments to the spec, binding (decision 56 of `docs/refactor/HANDOFF.md`):
- **A1 — you write the fixtures.** Spec §7 says "Codex writes the fixtures". This session cannot let Codex write, so
  you write them, under the rules of section 4 (L-fixtures). The lead reviews them afterwards.
- **A2 — the read budget is measured on your build.** L1b says the lead measures `LINE_HISTORY_READ_BUDGET` before
  freezing, by running `lines/list` on 2C-25's data with an unlimited budget. That read does not exist before you build
  it, so the measurement moves to acceptance: keep `LINE_HISTORY_READ_BUDGET = 2_000` (injectable, as L1b says); 2C-25
  additionally runs one `lines/list` per backend with an unlimited budget and prints, for every line, the reads of
  the budgeted parts, and the reads and time of the shared costs. Report in NOTES: the largest count m among ordinary
  lines, the counts r and w of lines R and W, the shared-cost reads and times. The lead sets the number from these
  before merging (L1b steps 2–4). Do not assert on the printed numbers.
- **A3 — §5.3 is applied by you, exactly as written** (the two tables of `tests/architecture/state-writes.test.ts`;
  allowlist entries only where the check reports them, as §5.3's third row says). Every "不改" item of §5.3 is "run it
  and confirm"; if one fails, stop and report it with the test id and first failure line.

## 3. Frozen files (never change them, not even temporarily)

At the end, `sha256sum` of these prints exactly:

```
96727ad0ed226ae01355491a61c3fe391cf3f37ede5e1686e09aa539792fe0c2  DSH-BASELINE.md
35ac3560009e238893580fe3fbd47194015394266de00955f94572e033b7a674  docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md
```

- **No existing test file changes except the §5.3 edits (A3).** `git diff --stat slice-base -- tests` may list only new
  files and the files §5.3 names.
- **Probes:** throw-away scripts go under `./.dsh-scratch/` and are deleted at the end. Never use `/tmp`.
- **If the spec seems to contradict an existing test:** keep that test as it is; report it under UNSPECIFIED with the
  test id, the assertion, the spec line and a minimal counter-example; go on with the other rows.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only the files of spec §6 (production and tests; not the "文档（lead 写）" part) may change, plus new test
  files whose names start with `S2C-` under the existing test directory that fits the entry (`tests/record-store/`,
  `tests/work-graph/`, `tests/composition/`, `tests/scenarios/`, `tests/app/`, `tests/state/`), new helpers
  `tests/helpers/S2C-<name>-fixture.ts` or `tests/helpers/S2C-<name>-support.ts`, and the §5.3 edits. Nothing else: no
  lock files, no `docs/`, no UI components (only the route label table `src/ui/api/routes.ts`), no `vendor/`. A file
  outside this list that you believe must change: stop and report it.
- **L-tdd.** Follow `./.dsh-ref/tdd/` and spec §5:
  - one row → one failing test → minimal code → next row;
  - tests at the row's entry point only, through public interfaces (`countLookup`, `WorkLineReadPort`,
    `WorkLineSettingsPort`, `WorkspaceDecisionSettingsPort`, `NodeDetailReadPort`, the HostScenario routes, the seven
    HTTP routes);
  - **no reading the database or record store to verify** (the user's standing rule);
  - expected words, reasons, counts, orders and identities are literal values in the test or the fixture,
    hand-computed from the spec's tables, never computed with the product's own functions (`deriveLineStatus`,
    `classifyTaskAttention`, `cardLineKeys` and the like are what is tested, not oracles);
  - each test name starts with the row id, for example `2C-12 …`; a row that lists several cases has one assertion per
    case;
  - LE2 and the service-level LE3/LE6 examples run on both backends (memory and SQLite);
  - LE1 is only for the cases the row says cannot be built through public services; everything else goes through the
    real services;
  - no tests whose answer is obvious from reading the code; refactoring is not part of the loop.
- **L-fixtures (amendment A1).** You write the fixtures of spec §7 (the list under "夹具由 Codex 写"):
  - Build every dataset **only through the real public services** (Sessions, claims, Run results, controls,
    responsibility links, messages, archive, provenance, the Workflow's maintenance and archive steps, the Host
    scenario framework of K's KE3 for LE4). Never write records directly, except the exception §7 names: legacy
    Sessions with null provenance and, for 2C-18, the two legacy Run shapes, committed at the storage boundary in shapes
    today's codecs decode; plus the storage wrappers §7 names (inject a failure, or commit once first, on a named call).
  - Each fixture file starts with a comment listing what it builds and through which public calls.
  - The 5,000-Session scale set (2C-25, with lines X, R, W and Z): build once per test file; a slow test may take up to
    1,800 s (one exported constant `S2C_SCALE_TIMEOUT_MS = 1_800_000`, like 2A's `S2A_SCALE_TIMEOUT_MS`).
- **L-reach.** `tests/architecture/production-reach.test.ts` must pass: every new exported declaration is reached from
  production code. Allowlist entries only as §5.3's third row says.
- **L-interfaces.** Names, signatures, DTOs, index ids and route paths exactly as spec §2 and L1–L24 give them.
- **L-state.** State changes go through `src/core/work-graph/state/` (AGENTS.md rule 9): the pin machine
  (`state/line-pin-machine.ts`) and §5.3's two table rows.
- **L-2A.** Ordered reads use 2A's `RecordOrderedLookupPort.lookupOrdered`; `countLookup` is a separate port (L3), added
  to the RecordStore files this slice owns; do not change 2A's ordered-lookup behaviour.

## 5. Rules for every group

1. **Test-first, one row at a time** (L-tdd). Keep a short log per row: the test name, the first failure message you saw
   (RED), and the change that made it pass (GREEN). This log goes into your reply.
2. **Spec §4 rules and §8 hold**, and L1–L24.
3. **Read failures and refusals are returned, never turned into success, zero, "none" or an empty result.** A part that
   was not read in full says so (`partial`, `attentionComplete: false`, `doneEvidence: 'incomplete'`, L1b).
4. **No real model calls.** No network. Do not touch ports 3080, 3099 or 44797.
5. **No git write commands:** no commit, no stash, no checkout of other revisions.
6. **Run one vitest command at a time;** never two in parallel.

**Lead answers to the pre-read (binding; they refine the spec and this book where they were silent).**
- **P1 — §0.2 is partly stale; read the merged code.** K part A is merged: `session-maintenance.ts` already calls the
  close-open-Turn step (`tryCloseDanglingTurn`; around `:436-468`, `:598-605`). The §0.2 note "今天的代码还没有 KA1" is
  out of date; the "自动维护、接续" facts describe exactly this merged code. Line numbers in §0.2 moved by up to ~90
  lines (for example `session.ts` `unavailableSince` `:64`, `SessionWorkLink` `:66`; `session-record-codecs.ts`
  registrations `:947-963`; `create-platform.ts` stub `:671`, owner table `:1476-1479`): find each fact by symbol.
- **P2 — §15 overrides §2's constant comment** ("冻结前 lead 量"): keep `LINE_HISTORY_READ_BUDGET = 2_000` with the comment
  changed to say the lead sets the number before merging (§15); amendment A2 says what 2C-25 prints.
- **P3 — L24 is binding** (starting counts as working; unknown counts as standby); the rule range is L1–L24.
- **P4 — one line assembly, shared by the list and the hover.** `views/work-line-reader.ts` exports one assembly function
  (for example `assembleLineBriefs(...)`: given the store, the call context and the set of line heads, it returns the
  same `LineBriefV1` values `lines/list` returns). `lines/list` and `node-detail-reader.ts` both call it, so the hover's
  `owners` are byte-identical to `lines/list` by construction (2C-10, 2C-30). It is not a new public port; it is reached
  from production through the two readers. Group L writes it first and reports its name and signature; group D starts
  only then (section 6).
- **P5 — 2C-08 registers its own test index** through `RecordBackendSchemas` (text and integer order paths, like 2A's
  QA-15 `lead-integer-by-group`); it does not need the eight L4 indexes. The unsafe integer case (`9007199254740993`)
  is committed at the storage boundary as JSON text through the store's own `commit` (LE2 is the store's own entry, so
  this is not a fixture exception); the assertion is the count the public `countLookup` returns.
- **P6 — 2C-37:** keep the spec's instruction: if no role resolves to executor and can run a Query, stop that row and
  report it; go on with the others.
- **P7 — 2C-40:** build it on the KE3 framework (`tests/scenarios/harness.ts`, `openHostScenario`, `restart()`) through
  public routes. If the framework cannot put the gate's producer Run on Session P while the responsibility link is on
  Session G, stop that row and report the missing hook.
- **P8 — helpers have owners.** Each group writes its own helpers, named `tests/helpers/S2C-<group>-<name>-fixture.ts`
  or `-support.ts` (group letters of section 6). A later group imports an earlier group's helper and never edits it; a
  change goes through you to the owner. The existing `tests/scenarios/harness.ts` and `tests/scenarios/support/*.ts`
  are existing test files: nobody edits them (L-scope); scenario groups build on them in new helper files.
- **P9 — timeouts:** a test may take up to 600 s; only the scale work of 2C-25 and its fixture use
  `S2C_SCALE_TIMEOUT_MS = 1_800_000`.
- **P10 — allowlist reasons:** a route Body/Response alias or a persisted schema id that only registries and tests
  read uses `wire-format`, with a note naming its reader, exactly like `WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID`
  (`tests/architecture/production-reach-allowlist.json:862-867`). Do not use `step5`/`step6`.
- **P11 — `countLookup` is new:** create `RecordCountPort` in `lookup-ports.ts` and both backends as spec §2 and L3 say;
  the distinct count of L3 follows the candidate rules of the index; 2C-08's hand-computed examples on both backends
  are the oracle.
- **P12 — the counting wrapper of L1b** lives in `views/work-line-reader.ts`. It wraps the reader's own store handle and
  counts exactly the calls L1b lists (`lookup` page, `lookupOrdered` page, each `readMany` record, `eventAt`,
  `countLookup`); the anchor and undelivered readers the line uses are built from it through the factories the
  composition root injects (L1b). Export only what production needs.
- **P13 — 2C-25** asserts only public results; that the new reader no longer goes through `findSessions` (so its old
  1,000-candidate and 2,000-link limits are not on the path) is checked by the lead in code review.

## 6. Groups and rows (the lead's recommendation, revised after the pre-read)

The spec's §7 orders the entries LE2 → LE1 → LE3 → LE4 → LE6 → LE5 → LE7. The lead splits that for parallel work.
**You may regroup** (merge, split, reorder) if you see a better cut; if you do, say in NOTES what you changed and why.
Keep two rules whatever you do: groups that run at the same time write disjoint files, and a shared interface is
finished and reported before the groups that use it start.

**Wave 1 — two subagents in parallel.**

*Group C — counting in the store (entry LE2).*
- Production: `src/core/record-store/lookup-ports.ts` (`RecordCountPort`), `lookup-index.ts`,
  `in-memory-record-store.ts`, `sqlite-record-store.ts`.
- Tests: new `tests/record-store/S2C-count-lookup.test.ts` (both backends in one file; its own test indexes, P5).
- Rows: 2C-08.
- Spec: L3, §2 the RecordStore part.

*Group M — interfaces and the pure state functions (entry LE1).* Report the contract and model types first.
- Production: `src/contracts/work-line.ts` (new; the DTOs of §2), `src/core/work-graph/model/work-line-contracts.ts`
  (new; the ports and inputs of §2), `state/line-status.ts` (new; `deriveLineStatus`, `classifyTaskAttention`,
  `cardLineKeys`, `LineFactsV1`, the sort key).
- Tests: new `tests/state/S2C-line-status.test.ts`.
- Rows: 2C-01, 2C-02, 2C-38. The rest of `line-status.ts` is driven by group L's rows (it is the pure core L's reader
  calls); M writes the types and the functions its rows need, and L extends `line-status.ts` in wave 2 (M's subagent has
  finished by then, so L owns the file from wave 2 on).
- Spec: L1, L1a, L2, L24, §3 (all tables), §2 contracts.

**Wave 2 — group L and group P in parallel; group D after L has reported the assembly function (P4).**

*Group L — the line reads (entry LE3).*
- Production: `views/work-line-reader.ts` (new; `LINE_HISTORY_READ_BUDGET`, the counting wrapper P12, the assembly
  function P4 — write and report it first), `state/line-status.ts` (from wave 2 on), the eight index registrations of
  L4 (`sessions/session-record-codecs.ts` five, `tasks/claim-record-codecs.ts` one, `queries/query-record-codecs.ts`
  one, `tasks/session-anomaly-codecs.ts` one), registered as L's rows need them.
- Tests: new `tests/work-graph/S2C-lines-*.test.ts`; helpers `tests/helpers/S2C-L-*` (the D1 dataset of 2C-14, the
  storage wrappers of 2C-12, 2C-14, 2C-18, 2C-36, the legacy-Session exception, the injected clock and numbering).
- Rows: 2C-03, 2C-04, 2C-09, 2C-10, 2C-11, 2C-12, 2C-14, 2C-15, 2C-16, 2C-17, 2C-18, 2C-20, 2C-36, 2C-37.
- Spec: L1–L8, L10, L11, L16–L24 as the rows cite them.

*Group P — pins and line settings (entry LE3).*
- Production: `src/contracts/ledger.ts` (`lineSettings`), `persistence/record-codecs.ts` (the workspace snapshot
  accepts `lineSettings`; `workspaceLineSettingsProblem`), `persistence/line-settings-codecs.ts` (new),
  `state/line-pin-machine.ts` (new; `buildWorkspaceLineSettingsRecord`), `configuration/line-settings-service.ts` (new),
  and the two `tests/architecture/state-writes.test.ts` edits of §5.3.
- Tests: new `tests/work-graph/S2C-pins.test.ts`; helpers `tests/helpers/S2C-P-*`.
- Rows: 2C-07, 2C-19. Where a row reads the order of lines, it reads `lines/list` through L's reader once L has
  reported it; until then write the pin service test-first against `WorkLineSettingsPort` and the settings it stores.
- Spec: L9, §2 the settings part, §5.3.

*Group D — node details and hover cards (entry LE6).* Starts when L has reported the assembly function.
- Production: `views/node-detail-reader.ts` (new; calls L's assembly function for `owners`, P4).
- Tests: new `tests/work-graph/S2C-node-detail*.test.ts`; helpers `tests/helpers/S2C-D-*` (the injected executed-files
  ports "有" with a hand-written file list and "没有" = today's stub answer; 2C-29's storage wrapper).
- Rows: 2C-27, 2C-28, 2C-29, 2C-30.
- Spec: L14, L15, §3 (the hover tables), §2 the node-detail part.

**Wave 3 — first group W alone, then three subagents in parallel.**

*Group W — composition, conversation and routes (entry LE7).*
- Production: `src/composition/create-platform.ts` (the record and event registration, the read and write ports, the
  executed-files port, the pin service's Session read, the four new non-enumerable owner groups),
  `src/composition/work-line-conversation.ts` (new; L12), `src/app/core-routes.ts`, `src/app/core-http-types.ts`,
  `src/ui/api/routes.ts` (seven labels; `GRAPH_WRITE_ROUTES` gains `lines/pin`), allowlist entries (P10).
- Tests: new `tests/app/S2C-line-routes.test.ts`; it imports L's D1 helper.
- Rows: 2C-31.
- Spec: L12, L13, §2 the route part.

*Groups K1 and K2 — the Host scenarios (entry LE4), after W has reported.* Two subagents on disjoint new test files.
K1 writes the shared scenario helper `tests/helpers/S2C-K-scenario-support.ts` first (on top of the existing KE3
framework, P8) and reports it; K2 imports it and starts with its rows that need nothing more. Production fixes go to
the owning group through the coordinator (readers: L and D; pins: P; composition and routes: W; start a new subagent
for that group if its first one has finished).
- K1 rows: 2C-05, 2C-13, 2C-21, 2C-22, 2C-23, 2C-24, 2C-26.
- K2 rows: 2C-32, 2C-33, 2C-34, 2C-35, 2C-39, 2C-40, 2C-41.
- Tests: new `tests/scenarios/S2C-*.test.ts`.
- Spec: the L-rules the rows cite; §0.2 "自动维护、接续" (P1).

*Group X — scale and the budget numbers (entry LE5), after W has reported.*
- Tests: new `tests/work-graph/S2C-lines-scale.test.ts` (both backends), `tests/helpers/S2C-X-scale-fixture.ts`;
  amendment A2's printout.
- Rows: 2C-25.
- Spec: L1, L1b, L5 (whatever the row cites); P13.

**Wave 4 — integration (the coordinator or one subagent).**
- Run every new `S2C-` file and the §5.3 "不改" files; fix what fails in the files of the group that owns them. Then the
  self-check (section 7), then section 8.

## 7. Self-check

When all groups have reported and `npm run typecheck` passes, start one read-only review subagent per group (C, M, L, P,
D, W, K1+K2 together, X), with a fresh context. It reads `./.dsh-ref/tdd/`, spec §5 and the L-rules and §3 tables its
group block names, its group block, and the final diff of the group's files (`git diff slice-base -- <files>` plus the
new files). It answers:
1. Per row: covered or not, with the test name; does the test exercise the row's entry point; is its expected value
   literal and independent; does each case of the row have its own assertion?
2. Per test: any TDD anti-pattern (implementation-coupled, tautological, trivial, a database read, a product function
   used as the oracle).
3. Per fixture: built only through public services, except the exceptions L-fixtures names?
4. Any defect: a status word or count that does not follow §3's tables, a part read only partly but reported as
   complete or as 0/"none", a read that writes, a pin change that loses another field, a route that turns a failure
   into an empty answer.

The owning group fixes what is not done, with a new subagent if needed. Then run section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
node scripts/build-kernel-patch.mjs --check
npx vitest run tests/record-store/S2C- tests/state/S2C- tests/work-graph/S2C- tests/composition/S2C- tests/scenarios/S2C- tests/app/S2C- tests/architecture/ tests/work-graph/S5-notices.test.ts tests/work-graph/S1-codecs-indexes.test.ts tests/work-graph/A1-session-discovery.test.ts tests/app/MVP-ui-entry.test.ts tests/composition/platform.test.ts
npx vitest run
sha256sum DSH-BASELINE.md docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md
git diff --stat slice-base -- tests
git status --short
```

Expected at the end (this sandbox, no bubblewrap):
- typecheck, check:architecture, build and the kernel-patch check exit 0.
- The targeted run: everything passes except baseline entries.
- The full suite: no failure other than those listed in `DSH-BASELINE.md` section A (same tests).
- Every sha256 as in section 3; `git diff --stat slice-base -- tests` lists only new files and the §5.3 file;
  `git status --short` lists only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 9. Reply format

Reply with these five sections and nothing else:
- **FILES CHANGED:** each file changed or added, one per line.
- **ROWS:** one line per row: `row | test name(s) | RED message first seen | implementation file:symbol`.
- **CHECKS:** each command, its exit code; for vitest the `Test Files` and `Tests` lines and, for every file with a
  failure, each failing test id and the first line of its failure, marked `baseline` or `NEW`.
- **UNSPECIFIED:** per L-rule: done with file:symbol, or what was not done and why; each case the spec does not
  describe; each existing test you believe contradicts the spec; every §5.3 row with its outcome.
- **NOTES:** at most fifteen lines: the subagents you ran and in which waves, any regrouping and why, amendment A2's
  numbers (m, r, w, shared-cost reads and times per backend), anything that blocked you, and the wall time of the
  slowest test.
