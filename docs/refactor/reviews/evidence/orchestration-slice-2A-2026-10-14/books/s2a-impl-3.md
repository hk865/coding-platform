# Task: slice 2A, round 3 — the fixes from Codex's implementation review

You are working in the slice copy (the current directory). Rounds 1 and 2 built slice 2A; the lead committed their
result as `dsh: 2A rounds 1-2` on top of `slice-base`. This is a NEW session. Read first:

- `./.dsh-ref/s2aimplrev.out.md` — Codex's review (M1–M7, S1–S2).
- `docs/refactor/design/orchestration-2026-10/slices/slice-2A-SPEC.md` — the frozen spec (L1, L4, §2.5, §5).
- `./.dsh-ref/s2a-impl.md` (first book: section 4 rules P1–P14) and `./.dsh-ref/s2a-impl-2.md` (R1–R5).

No git write commands, no network, no real model calls. Throw-away files go under `./.dsh-scratch/` and are deleted at
the end; never use `/tmp`. Finish within 120 minutes.

**This run is headless. When your turn ends, the whole run ends.** You may use subagents (for example one for the
`src/` items, one for the test items); they edit disjoint files. Stay in your turn until every one has reported (wait
with `sleep 300`, then `list_agents`).

## 1. Frozen — never change

`DSH-BASELINE.md`, `tests/work-graph/S5R2-queue-history.test.ts`, `tests/work-graph/WP2-context-extensions.test.ts`,
`tests/work-graph/WP2-undelivered-notices.test.ts` (sha256 = `ff6cf385f3c94857eb088b262c283ba6276d723178713a7fa026840a51226e10`),
and every other existing test's assertions. Check the four sha256 values at the end.

## 2. The lead's rulings (binding)

**Code.**

- **M1 (first half) — fix.** In `src/core/work-graph/views/automatic-rework-notices.ts`, every record read from a
  legacy group (`S2A_REQUEUE_LEGACY_LOOKUP` at :192 and `S2A_ROUND_REVERIFY_LEGACY_LOOKUP` at :235) goes through
  `decodeNoticeOrigin` first, as it did before 2A. A decode failure (for example a persisted `since: null`) returns
  `unavailable` with the same reason style as `orderedSince`; only a genuinely absent `since` is a legacy position.
  **No new test:** a persisted `null` only arises from a damaged database (AGENTS.md rule 4).
- **M1 (second half) — not required.** Do not add a check of continuation pages against `after`; the store's own
  continuation is covered by the ordered-lookup tests on both backends.
- **M2 — fix.** In `src/core/record-store/sqlite-record-store.ts:626`, write the continuation as the row-value
  comparison L1 names: `(<order expression>, ref_key) > (?, ?)` ascending, `<` descending, with only two parameters,
  joined to the bound with `AND`. Keep `ORDER BY` as it is. Run the ordered-lookup tests on SQLite and memory. The lead
  checks the query plans.
- **S1 — fix.** In `createLookupIndexes` (:99), an index without `orderBy` keeps exactly today's fingerprint string
  `${aggregateType}\u0000${paths.join('\u0000')}` (no separator appended), so existing databases keep their index
  names. Only an ordered index appends `\u0000${path}\u0000${valueType}`. Add one test through the public store API
  only if one exists that can see index names without reading the database; otherwise no test (say so).
- **S2 — fix.** In `src/composition/commit-observer.ts`, keep the original minimum
  `GoalRecordTransactionPort & RecordLookupPort` and make `observeRecordCommits` generic over the records type, so a
  caller gets back the same type it passed in (for example
  `<R extends GoalRecordTransactionPort & RecordLookupPort>(backend: { readonly records: R; close(): Promise<void> }, …)
  : Promise<{ readonly records: R; close(): Promise<void> }>`). Callers must compile without casts.

**Tests (all in the new 2A test files and helpers; no frozen file changes).**

- **M3 — fix.** QA-09(一) in `tests/work-graph/S2A-queue-derived-cards.test.ts:42` must pick the card that sorts LAST
  in the single-card source's index order (the order the old 25×200 window read), not creation number 5,001. Either make
  the planning fixture's ids zero-padded so creation order equals index order, or select the byte-last id. Write that
  card's expected identity as a literal in the test. Then prove it: in `./.dsh-scratch/` (or by a temporary edit you
  revert), put the old 25-page cap back in the single-card source and confirm QA-09(一) fails; restore and confirm it
  passes. Report both results.
- **M4 — fix.** In `tests/work-graph/S2A-queue-request-candidates.test.ts:56`, seed closed candidates the way the public
  replacement writes them (`src/core/work-graph/state/plan-machine.ts:1639`): each replaced candidate has
  `revision: 2`, `status: 'not_adopted'` and `notAdopted.replacedBy` = the ref of the next candidate (index + 1); the
  last one stays `status: 'candidate'`, `revision: 1`. The expected live-head pin stays `{ ref: liveRef, revision: 1 }`.
- **M5 — fix only the notice order.** In `tests/work-graph/S2A-notices-counts.test.ts:72`, the order of `full.notices`
  must be checked against an independently written expectation: record each notice's identity in creation order when
  the fixture creates it (from the public send/requeue results), and assert each category's item order equals creation
  order (the spec orders notices by creation position). Use `decisionSourceKey`/`canonicalJson` for identity only where
  the existing tests do; comparing sorted sets of keys built with `decisionSourceKey` stays as it is (the same pattern
  as the frozen R2A09 flip).
- **M6 — fix both.**
  - QA-12 (`tests/work-graph/S2A-notices-workspace.test.ts:23`): two workspaces of the same project, BOTH populated with
    a Goal and an automatic rework, each created through public services; the read for each workspace returns only its
    own notice (literal expected keys), and each read uses a context for that workspace. If the fixture cannot create or
    bind a second workspace through public services without changing a shared fixture, stop this item and report what is
    missing.
  - QA-18 (`tests/work-graph/S2A-notices-rework.test.ts:114`): replace the fabricated `after` with the public flow
    QA-18 describes: after round 2, deliver a notice (for example a member notice through the mailbox), read it through
    the notices page, mark it seen with `markNoticesSeen` (the harness `mark` the counts test uses) using that page's
    display token and `seenThrough`; then the system opens round 3; the next read shows exactly round 3 among
    automatic-rework notices, and rounds 1 and 2 never appear.
- **M7 — governance seeding:** in `tests/helpers/S2A-notices-support.ts:156`, use the public
  `installCompletionPolicy` / `activateCompletionPolicy` (as `tests/helpers/S1-workflow-archive-fixture.ts:294–300`
  does) if the S5 decision fixture gives you that service without changing a shared fixture. If it does not, leave the
  seeding as it is (it copies the frozen S5 helper `noticeWork`, `tests/helpers/S5-queue-support.ts:301–312`) and say
  so.
- **M7 — QA-18b: remove it** (`tests/work-graph/S2A-notices-rework.test.ts:143`, the corruption double). It is outside
  the four allowed exceptions.

**Full-suite timeouts (found by the lead's full run with real bubblewrap, 24 CPUs, all files in parallel).**

- **T1 — fix.** The lead's full run (314 files) passed everything except two 2A timeouts under parallel load:
  `S2A-queue-derived-cards.test.ts` (sqlite) `beforeAll` timed out at 900,000 ms (the file took 1,313 s), and
  `S2A-notices-overbound.test.ts` QA-10(二) (sqlite) took 1,057 s against its 600,000 ms limit. Your isolated times were
  180–263 s, so the load makes them 4–6 times slower. Put one constant in a 2A test helper,
  `S2A_SCALE_TIMEOUT_MS = 1_800_000`, with a one-line comment saying why (5,001-item datasets through public services,
  measured up to 1,434 s per file in the full parallel suite on 2026-10-14), and use it for every 5,001-scale test and
  every hook that builds a 5,001-scale dataset (bounds, derived cards, request candidates, goal runs, notices overbound,
  notices attempt if it builds one, decision routes). Do not change the dataset sizes. Do not change
  `vitest.config.ts`.

## 3. Checks before you finish

1. `npm run typecheck` and `npm run check:architecture` pass.
2. Run the 2A test files and the ordered-lookup / record-store test files you touched (both backends). All pass.
3. Run `tests/work-graph/S5R2-queue-history.test.ts`, `WP2-context-extensions.test.ts`,
   `WP2-undelivered-notices.test.ts`: all pass.
4. The four frozen sha256 values in section 1 are unchanged.
5. `git status --short` lists only files under `src/` and `tests/` (plus nothing in `docs/`, nothing in `vendor/`).

## 4. Reply

Under 400 words: each item (M1–M7, S1, S2, T1) done / not done (why), with file:line; the M3 fail-then-pass result; the
test counts from section 3; the four sha256 values; and `git status --short`.
