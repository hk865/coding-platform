**M1 done** — `legacySince` decodes origin (`automatic-rework-notices.ts:168`), applied at :211 (requeue) and :256 (round); continuation-page check not added.

**M2 done** — row-value `(order, ref_key COLLATE BINARY) > (?, ?)`, 2 params ANDed (`sqlite-record-store.ts:631`).

**S1 done** — unordered keeps `${aggregateType}\0${paths}` (no separator); ordered appends `\0${path}\0${valueType}` (`sqlite-record-store.ts:101`). No test: no public store API exposes index names (`lookup.test.ts` reads `sqlite_master` directly).

**S2 done** — generic `observeRecordCommits<R>` with minimum `GoalRecordTransactionPort & RecordLookupPort`; returns `ObservedBackend<R>` = `Omit<R,'commit'> & {commit: base}` so all callers (incl. the `change-commit-observer` double) compile cast-free and keep ordered lookup (`commit-observer.ts:41,68`).

**M3 done** — ids zero-padded (`S2A-planning-fixture.ts:55`); QA-09 reads literal `S2A-PQ-05000` (`S2A-queue-derived-cards.test.ts:45`). **Fail** (25-page cap restored): `2 failed | 2 skipped`, both backends `incomplete … expected 'rejected' to be 'ready'`; **pass** (cap reverted): file 4 tests passed.

**M4 done** — replaced candidates `revision:2/not_adopted/replacedBy:next`; last stays `candidate/1`; live pin unchanged (`S2A-queue-request-candidates.test.ts:67`).

**M5 done** — each category's order asserted against identities recorded from the public writes (`S2A-notices-counts.test.ts:31,59,64,87`).

**M6 done** — QA-12 builds two populated workspaces with W/W2 contexts and literal keys (`S2A-notices-workspace.test.ts:21`; new `S2A-notices-workspace2-fixture.ts`). W2's Workspace+governance are the same raw `seedCommit` exception as `openManyTaskWorld` — public `registerWorkspace`/`installCompletionPolicy`/`activateCompletionPolicy` are impossible because the frozen S5 fixture registers no `PROJECT_BOOTSTRAP_RECORD_SCHEMAS` (probe: `event s5-id-7 uses unregistered schema ProjectWorkspaceRegistered@1`); Goal/Plan/Session/claim/entry/end/requeue are public. QA-18 now uses mailbox → page → `markNoticesSeen` → system round 3 (`S2A-notices-rework.test.ts:100`); QA-18b removed.

**M7 not done (allowed fallback)** — `S2A-notices-support.ts:146` keeps the frozen `noticeWork` `seedCommit` governance seeding; documented in-line, no shared fixture changed.

**T1 done** — `S2A_SCALE_TIMEOUT_MS = 1_800_000` (`S2A-queue-fixture.ts:30`) used in bounds QA-04/05, derived-cards (hook+2), request candidates, goal runs, overbound, decision routes (hook+2); dataset sizes untouched.

**Checks** — typecheck pass; `check:architecture` OK. Tests: 18 files/107 + 2 files/25 + 6 files/52 = **26 files / 184 tests passed** (both backends; S5R2, WP2×2 included). sha256 unchanged: DSH-BASELINE `4133c9ee…`, S5R2 `0f3b59a9…`, WP2-context `348fe889…`, WP2-undelivered `ff6cf385…`.

`git status --short`: 15 modified (3 `src/`, 12 `tests/`) plus `?? tests/helpers/S2A-notices-workspace2-fixture.ts`; nothing in `docs/` or `vendor/`. Scratch files deleted.