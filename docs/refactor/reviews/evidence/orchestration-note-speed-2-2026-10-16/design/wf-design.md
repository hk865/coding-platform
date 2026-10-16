# Round 2 design: each lookup index covers only its own record type

Basis: HEAD ad2679f3. I only read code, ran no tests and changed no files. Anything marked **ESTIMATE** is my own calculation. Anything marked **(SQLite/Node source knowledge, not verified here)** must be confirmed by the micro-benchmark in section 6.

## 0. Summary

- **70 lookups are registered, across 17 aggregate types.** That is 70 `next_lookup_*` indexes. The 71st index on `snapshots` is very likely the primary-key index `sqlite_autoindex_snapshots_1`. The profiler counted `sqlite_master WHERE type='index' AND tbl_name='snapshots'` (`D:/cc-lead-notes/impl/s4b/prof/sql-micro-3.mjs:26`), which includes it.
- **Dataset row counts** (`docs/refactor/reviews/evidence/orchestration-slice-4B-2026-10-16/checks/measure-4b.out.json:191-194`): NoteHead 20,000, NoteVersion 65,185, CurrentPointer 100, about 1,500 others, total 86,792. NoteVersion has no lookups at all, yet today every one of its rows sits in all 70 indexes.
- **Index size after round 2 (ESTIMATE):** about 6.09 M index entries (70 × 86,950) fall to about 0.27 M (13 × 20,034 NoteHead plus at most about 20 k others). Lookup indexes go from 1,077 MiB to about 50–80 MiB. The file does not shrink without VACUUM.
- **Change:** add `WHERE json_extract(ref_key, '$.aggregateType') = '<Type>'` to every index. Write the same term as a literal (not a bound `?`) in every query on `snapshots`. Put the predicate into the index-name fingerprint. At open, one transaction drops the stale `next_lookup_*` indexes and creates the missing ones.
- **In-memory backend:** already keeps one set of buckets per type (`in-memory-record-store.ts:338-342`). Only the shared registration check changes.
- **The one-parse change (Design S) does not belong in round 2.** Reasons in section 4.

## 1. Inventory

### 1a. Lookup registrations

All are combined in `src/composition/create-platform.ts:541-550`. `SLICE1_LOOKUP_INDEXES` in `model/session-facts-contracts.ts:42-55` is only a cross-check (`create-platform.ts:555-560`), not a registration. "ord" means the index has an `orderBy`, which is text unless marked int. "count" means a `countLookup` caller exists.

| File:line | Name | Type | Paths | orderBy / count |
|---|---|---|---|---|
| sessions/session-record-codecs.ts:955 | SESSION_BY_WORKSPACE | Session | ref.projectId, workspaceId | – |
| :956-957 | SESSION_BY_WORKSPACE_LIFECYCLE | Session | +lifecycle | count (work-line-reader.ts:1713) |
| :958-959 | …LEGACY_ROLE | Session | +role.kind, role.templateId, role.templateRevision | – |
| :960-961 | …SPEC_ROLE | Session | +role.kind, role.pin.ref.roleId, role.pin.ref.revision, role.pin.digest | – |
| :962 | SESSION_WORK_LINKS | SessionWorkLink | ref.projectId, ref.sessionId | – |
| :963-964 | SESSION_LINKS_BY_MODULE | SessionWorkLink | ref.projectId, ref.target.kind, ref.target.ref.moduleId, ref.relation | – |
| :965-966 | SESSION_LINKS_BY_TASK | SessionWorkLink | ref.projectId, ref.target.kind, ref.target.ref.goalId, ref.target.ref.taskId, ref.relation | – |
| :967-968 | SESSION_LINKS_BY_WORK | SessionWorkLink | ref.projectId, ref.target.ref.workspaceId, ref.target.kind, ref.target.ref.workId, ref.relation | – |
| :969-970 | SESSION_BY_PROVENANCE | Session | ref.projectId, workspaceId, provenance.from.sessionId | – |
| :972-973 | S2C_SESSION_BY_KIND_FROM | Session | ref.projectId, workspaceId, provenance.kind, provenance.from.sessionId | count with distinctPath (work-line-reader.ts:1764-1766) |
| :974-975 | S2C_SESSION_BY_LIFECYCLE_KIND | Session | ref.projectId, workspaceId, lifecycle, provenance.kind | count, including a `null` value, so the `IS NULL` shape (work-line-reader.ts:1742-1743, :1761-1763) |
| :976-978 | S2C_SESSION_ARCHIVED_AT | Session | ref.projectId, workspaceId, lifecycle | ord archivedAt; ordered count (work-line-reader.ts:1715) |
| :979-980 | S2C_OPEN_LINKS_BY_SESSION | SessionWorkLink | ref.projectId, ref.sessionId, ref.relation, until | – |
| :981-983 | S2C_CLOSED_TASK_LINKS | SessionWorkLink | ref.projectId, ref.sessionId, ref.relation, ref.target.kind | ord until; ordered count (work-line-reader.ts:1033-1034) |
| sessions/message-record-codecs.ts:96-97 | …BY_SENDER_SESSION | SessionMessage | ref.projectId, ref.workspaceId, sender.sessionRef.sessionId | – |
| :98-102 | …BY_RECIPIENT | SessionMessage | …, recipient.sessionId | – |
| :103-107 | …BY_RECIPIENT_STATUS | SessionMessage | …, recipient.sessionId, status | – |
| :108-112 | …BY_SENDER_RUN | SessionMessage | …, sender.runRef.goalId, sender.runRef.runId | – |
| :113-117 | SESSION_REPLY_BY_HANDLER | SessionMessage | …, replyHandler.sessionRef.sessionId | – |
| :127-131 | S5_USER_MESSAGE_BY_GOAL | SessionMessage | …, recipient.kind, goalRef.goalId | – |
| :132-136 | S5_MESSAGE_BY_WORKSPACE_STATUS | SessionMessage | …, status | – |
| :137-141 | S5_DECISION_ANSWER_BY_SOURCE | SessionMessage | …, decision.source.kind, decision.source.key | – |
| :149-153 | S2A_USER_MESSAGES | SessionMessage | …, recipient.kind | – |
| persistence/note-record-codecs.ts:653-655 | s4-note-by-anchor-0…4 (5 indexes) | NoteHead | ref.projectId, anchorKeyN | – |
| :656-657 | s4-note-by-review-status | NoteHead | ref.projectId, goalId, state | – |
| :658-659 | s4-note-by-staged-run | NoteHead | ref.projectId, stagedRunKey | – |
| :662-664 | s4b-note-by-path-0…4 (5 indexes) | NoteHead | ref.projectId | ord anchorKeyN |
| :666-667 | s4-note-text | NoteHead | ref.projectId (text paths topic, conclusion, body) | – |
| tasks/plan-readers.ts:309 | RUN_BY_GOAL | Run | ref.projectId, ref.goalId | – |
| :310 | RUN_BY_TASK | Run | +task.taskId | – |
| :314-315 | RUN_BY_WORKSPACE_STATUS | Run | ref.projectId, workspaceSnapshot.workspaceId, status | – |
| :316-317 | RUN_BY_WORKSPACE_OUTCOME | Run | …, outcome | – |
| :318 | GOAL_BY_WORKSPACE | Goal | ref.projectId, workspaceRef.workspaceId | – |
| :319-320 | S2B_RUN_BY_GOAL_ENDED | Run | ref.projectId, ref.goalId | ord endedAt |
| :321-322 | S2B_RUN_BY_WORKSPACE_ENDED | Run | ref.projectId, workspaceSnapshot.workspaceId | ord endedAt |
| persistence/plan-record-codecs.ts:1141-1145 | PLAN_PROPOSAL_LOOKUP_INDEX | PlanProposal | goalRef.projectId, goalRef.goalId | – |
| :1148-1152 | S5_PLAN_PROPOSAL_BY_REQUEST | PlanProposal | ref.projectId, ref.workspaceId, goalRef.goalId, requestRef.queryJobId | – |
| :1156-1161 | s2b-plan-revision-by-goal | PlanRevision | goalRef.projectId, goalRef.goalId | ord acceptedAt |
| persistence/control-record-codecs.ts:584 | CONTROL_BY_WORKSPACE_STATUS | ControlIntent | ref.projectId, ref.workspaceId, status | – |
| :585-586 | S2B_CONTROL_BY_RUN | ControlIntent | …, runRef.goalId, runRef.runId | – |
| tasks/claim-record-codecs.ts:847-848 | WORK_EXECUTION_BY_SESSION | DispatchOutboxEntry | claim.task.projectId, claim.workspaceId, claim.sessionRef.sessionId | – |
| :849-851 | s2c-work-claim-by-session-generation | DispatchOutboxEntry | same | ord int claim.generation |
| :63-68 | s2a-requeue-by-project | TaskRequeue | ref.projectId | ord since |
| :69-73 | s2a-requeue-legacy | TaskRequeue | ref.projectId, since | – (legacy group, reads null) |
| queries/query-record-codecs.ts:792-793 | QUERY_RUN_BY_SESSION | QueryRun | ref.projectId, ref.workspaceId, run.executionState.sessionRef.sessionId | – |
| :794-796 | S2C_QUERY_RUN_BY_SESSION_GENERATION | QueryRun | same | ord int run.executionState.sessionGeneration |
| :769-773 | S5_QUERY_JOB_BY_GOAL | QueryJob | ref.projectId, ref.workspaceId, job.goalId | – |
| :781-786 | s2b-query-run-by-session-ended | QueryRun | same as QUERY_RUN_BY_SESSION | ord run.endedAt |
| tasks/session-anomaly-codecs.ts:392-393 | SESSION_ANOMALY_BY_TASK | SessionAnomalyAnchor | ref.projectId, workspaceId, task.goalId, task.taskId | – |
| :394-395 | SESSION_ANOMALY_BY_GOAL | SessionAnomalyAnchor | …, task.goalId | – |
| :396-397 | S2C_ANOMALY_BY_SESSION | SessionAnomalyAnchor | …, sessionRef.sessionId | – |
| persistence/run-activity-codecs.ts:490-495 (via execution-entry-codecs.ts:858-860) | S2B_RUN_ACTIVITY_BY_GOAL_LAST | RunActivity | ref.projectId, ref.goalId | ord span.lastAt |
| architecture/catalog-record-codecs.ts:513-518 (:531) | S4B_CATALOG_REVISION_BY_PROJECT | ArchitectureCatalog | ref.projectId | ord int ref.revision |
| persistence/evidence-record-codecs.ts:807-808 | VERIFICATION_ROUND_ORIGINAL | VerificationRound | ref.projectId, ref.workspaceId, ref.goalId, ref.taskId, ref.runId | – |
| :809-810 | …BY_TASK | VerificationRound | …, ref.taskId | – |
| :811-812 | …BY_STATUS | VerificationRound | ref.projectId, ref.workspaceId, status | – |
| :747-752 | s2a-round-reverify | VerificationRound | ref.projectId, ref.workspaceId, chain.reverify.actorClass | ord since |
| :753-757 | s2a-round-reverify-legacy | VerificationRound | …, since | – (legacy, null) |
| :771-776 | s2b-round-by-goal | VerificationRound | …, ref.goalId | ord since |
| :777-781 | …legacy | VerificationRound | …, ref.goalId, since | – (null) |
| :782-787 | …finalized | VerificationRound | …, ref.goalId | ord finalizedAt |
| :788-792 | …unfinalized | VerificationRound | …, ref.goalId, finalizedAt | – (null) |

- **Totals:** Session 8, SessionWorkLink 6, SessionMessage 9, NoteHead 13, Run 6, Goal 1, PlanProposal 2, PlanRevision 1, ControlIntent 2, DispatchOutboxEntry 2, TaskRequeue 2, QueryRun 3, QueryJob 1, SessionAnomalyAnchor 3, RunActivity 1, ArchitectureCatalog 1, VerificationRound 9. That is 70 indexes, 19 of them ordered (3 integer).
- **Count users:** only the five work-line-reader sites listed in the table.
- **Several lookups read a missing field as `null`**, so they use the `IS NULL` shape: the "legacy" groups and the `null` kind. A partial index on type alone keeps every row of that type, missing fields included. Paths must never get an `IS NOT NULL` filter.

### 1b. SQL that filters by aggregateType

All three lookup queries bind the type today. All three must switch to the literal.

| File:line | What | Today |
|---|---|---|
| sqlite-record-store.ts:582-583 (prepared :596-598) | `lookupInside` | `json_extract(ref_key,'$.aggregateType') = ?` |
| :639-640 (prepared :696-698) | `lookupOrderedInside` | bound |
| :735-736 (prepared :767-769 COUNT, :778-780 DISTINCT) | `countInside` | bound |
| sqlite-text-search.ts:203-207 | FTS rebuild at open. Round 1 keeps this query in its replacement file `sqlite-text-scan.ts` (text-port.draft.md:126) | bound |
| sqlite-text-search.ts:301-302 | FTS candidates, on `f.ref_key` | bound. Round 1 removes this query. It filters the FTS table, not `snapshots`, so it would not trigger the problem anyway, but if any of it survives, make it literal too |
| sqlite-record-store.ts:98, :115 | index DDL leading column | expression only, no WHERE |

Other queries on `snapshots` are safe:
- The primary-key reads (:347, :387, :831) and the upsert (:246-248) do not filter by type. A bare `ref_key = ?` term cannot match the partial-index WHERE (section 3).
- No module outside `src/core/record-store` queries `snapshots` (grep).
- The in-memory backend filters in JS (in-memory-record-store.ts:339), not in SQL.

## 2. The partial-index rule

### DDL

One builder produces both the index DDL and the query term:

```sql
CREATE INDEX IF NOT EXISTS "next_lookup_<sanitized name>_<suffix>" ON snapshots (
  json_extract(ref_key, '$.aggregateType'),
  json_type(snapshot_json, '$.p1'), json_extract(snapshot_json, '$.p1'), …,
  [json_extract(snapshot_json, '$.<orderBy>'),]
  ref_key)
WHERE json_extract(ref_key, '$.aggregateType') = '<Type>'
```

- **The query must contain the same term, character for character in structure:** `json_extract(ref_key, '$.aggregateType') = '<Type>'`. Expression on the left, literal on the right, from the same helper (section 3).
- **SQLite uses a partial index only if a query term structurally equals the index WHERE.** When that term is a literal, SQLite also skips it as a per-row filter (`whereApplyPartialIndexConstraints`) (SQLite source knowledge, not verified here).
- **Keep the leading type column (recommended).** Columns stay exactly as today (`sqlite-record-store.ts:98-107`), only the WHERE is new, so plans keep today's shape: `SEARCH … USING COVERING INDEX (<expr>=… …)`, `D:/cc-lead-notes/impl/s4b/prof/raw/sql-micro-3.json`.
  - It also keeps round 1's text-table rebuild as an index SEARCH instead of a full scan. That answers risk 9 in text-port.draft.md:307.
  - Cost: roughly 10 bytes per index entry (ESTIMATE).
  - Dropping the column is possible later (the term is then satisfied by the index WHERE alone), but it changes every plan. Not this round.

### Name and fingerprint

- Today the suffix is FNV-1a (`lookupIndexSuffix`, :76-83) of `type\0paths`, plus `\0orderPath\0valueType` for ordered indexes (:111-114). The S1 comment at :108-110 deliberately kept unordered names stable.
- Round 2 renames every index once. The suffix becomes FNV-1a of: `LOOKUP_INDEX_RULE_VERSION` (= 2), `\0`, the raw registered `index.name`, `\0`, and the exact DDL body after the name (`ON snapshots (…) WHERE …`).
- Any change to columns, predicate or rule version gives a new name. Including the raw name also separates two names that sanitize alike, such as `a-b` and `a_b`.
- The prefix stays `next_lookup_`. sha256 (node:crypto is already used at sqlite-text-search.ts:28) would also work. FNV keeps one hash in the module, and the sanitized name already separates the 70 indexes.
- Do **not** also compare the stored `sqlite_master.sql` of an index that has the expected name. Only tampering or a hash collision could make it differ, and AGENTS rule 4 forbids defensive checks that only tampering can trigger.

### Open-time migration

New function `migrateLookupIndexes(db, lookups)`. It replaces `createLookupIndexes` at :178, runs before the text module at :181 and before the statement cache exists, and uses raw `db.exec`/`db.prepare`. Put it in sqlite-record-store.ts or a new `sqlite-lookup-indexes.ts`. Not in migrations.ts, whose header (:5-8) promises it never drops anything.

1. Build `expected`: name → DDL, for each entry of `lookups.indexes`.
2. List the existing indexes: `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='snapshots' AND name LIKE 'next\_lookup\_%' ESCAPE '\'`, then confirm `startsWith('next_lookup_')` in JS.
   - This query only matches `next_lookup_*` indexes on `snapshots`. It never touches round 1's `next_text_*` tables and their `_seq` indexes, the FTS tables, `memory_*`, or anything else.
3. Plan: `drop` = existing names not in `expected` (narrowed by the drop rule below); `create` = expected names not existing.
   - If both are empty, return with no transaction. Steady-state open stays at today's ~3.3 ms (p50 3.33 ms in measure-4b-final.out.json, reopen.plain.open). ESTIMATE: unchanged.
4. Otherwise `BEGIN IMMEDIATE` and re-plan inside the transaction, since another process may have migrated meanwhile. Then `DROP INDEX IF EXISTS` each stale name, `CREATE INDEX IF NOT EXISTS` each missing one, and `COMMIT`.
   - On a throw: `ROLLBACK` and rethrow. The factory then closes and rethrows as today (:182-189).
   - DDL is transactional in SQLite, and a crash rolls back through the hot journal at the next open, so the migration simply runs again.
   - Order: drop first, so the new pages reuse the freed ones and the file does not grow. Those reused pages must be journaled (about the size of the new indexes, ESTIMATE 50–80 MB). Creating first would grow the file by that amount but write almost no journal. Either is correct.
5. **Side effect:** on a fresh database, today's 70 separate autocommit CREATE INDEX transactions (:115, no BEGIN) become one transaction. That should make every fresh SQLite open in the test suite faster (ESTIMATE about 0.1–0.4 s per open on ext4; not measured).

### Drop rule (lead to choose)

- **(A) Minimal, as ordered:** drop every `next_lookup_*` index on `snapshots` that is not in the registered set.
  - Evidence against it: `tests/scenarios/support/plan.ts:805-807` (`raceWindow`) opens a second backend on the **live** scenario ledger with `platformRecordSchemas()` (`tests/state/invariants.ts:288-300`). That set has no note, decision or line-settings schemas. Under (A) it drops the 13 NoteHead indexes from under the running platform.
  - Results stay correct (full scans; cached statements re-prepare after the schema change), but the schema changes mid-test.
  - `measure-4b-final.mjs:212` opens the 20 k ledger with `NOTE_RECORD_SCHEMAS` only. Under (A) that drops the 57 other indexes, and the next full open rebuilds them: 57 full scans, about 8–20 s (ESTIMATE).
- **(C′) Recommended:** drop an unregistered `next_lookup_*` index only if one of these holds:
  - its stored SQL has no type predicate of our exact form, meaning it is a pre-round-2 full index. The form is `/ WHERE json_extract\(ref_key, '\$\.aggregateType'\) = '([A-Za-z][A-Za-z0-9_]*)'$/`;
  - or this backend registers at least one lookup for that predicate's type.
  - That leaves `raceWindow`, the measurement script, `lookups: []` seeders and Goal-records-only test backends alone. It still removes legacy indexes and orphans left by a registration change.
  - The price: an orphan of a type the product stops registering at all stays forever. It costs only that type's rows.
  - **The type comes from `sqlite_master.sql`, which SQLite stores as `CREATE INDEX "name" …`** from the name token onward, without the `IF NOT EXISTS` (SQLite source knowledge, not verified here).

### Time (ESTIMATE; no measured number covers a CREATE INDEX or DROP INDEX)

- **Basis:**
  - `snapshots` is 262 MiB, about 67 k pages of 4 KiB (measure-4b.out.json:1383). The old indexes are 1,076.6 MiB (:1381).
  - Every CREATE INDEX does a full table scan and evaluates the WHERE on every row. Only matching rows compute the columns.
  - Every DROP reads every page of the index it drops.
  - SQLite's page cache is the default 2 MB (profile summary.md:44).
- **At 87 k rows:**

  | Step | Cost (ESTIMATE) |
  |---|---|
  | Drop the 70 old indexes (about 1.08 GB of page reads) | 1–3 s |
  | Create 70 new ones (each a full scan of about 0.15–0.35 s through the OS cache) | 10–25 s |
  | Build about 0.27 M entries | 1–2 s |
  | Commit | under 0.5 s |
  | **Total, once per existing ledger** | **about 12–30 s** |

  - A temporary `PRAGMA cache_size` of about −300000 (about 300 MiB) on the migrating connection would keep the table in SQLite's cache after the first scan: about 3–8 s.
  - If the ledger lives on a WSL `/mnt/<drive>` (9p) path, page reads are 10–50× slower: minutes.
- **At 870 k rows** (about 2.6 GiB table, about 10.5 GiB old indexes): 70 scans of about 2–2.5 s, plus about 10–20 s of drop, about **3–5 minutes** (ESTIMATE). A cache bump cannot hold the table; `mmap_size` might roughly halve it.
  - No such ledger exists today, and one built under the old rule would also have about 10 GiB of indexes.
- **Recommendation:** first cut without pragmas. Measure the upgrade on the profiler's `prof-4b` copy, then decide on the cache bump.

### What an older build sees

- **Upgrade (old ledger, new build):** the 70 full indexes are legacy, so they are dropped under both (A) and (C′), and the partial indexes are created.
- **Downgrade (new ledger, older build):**
  - The older build runs `CREATE INDEX IF NOT EXISTS` with its old names at :115, so it rebuilds all 70 full indexes, one autocommit transaction each. ESTIMATE: 30–90 s at 87 k rows, with the file growing back by about 1 GB. It drops nothing.
  - Results stay correct: SQLite maintains every index on every write, whichever build writes.
  - Speed suffers: its bound type compared against the partial indexes forces a re-prepare on every execution (section 3). `countInside` goes from about 3.7 µs to about 150 µs; lookup and ordered lookup already re-prepare today because of the bound `LIMIT ?`.
  - **A round-1-only build** (statement cache and literal LIMIT, type still bound) loses round 1's gain on such a ledger. Ship rounds 1 and 2 close together, or add the literal type helper already in round 1. That is harmless without partial indexes.
  - When the new build reopens, it drops the full indexes again.

**After round 2:** writes evaluate 70 cheap WHERE clauses per written row (`json_extract` on the roughly 100-byte `ref_key`). They maintain only their own type's entries: 0 for NoteVersion and 13 for NoteHead, against 70 today. ESTIMATE: writes get cheaper. Re-measure `S2A-notices-overbound`.

## 3. The literal aggregateType helper

- **Registration check:** in `createRecordLookupRegistry` (lookup-index.ts:89-92, next to the existing non-empty check), add `AGGREGATE_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/` and export it.
  - The message shows the value with `JSON.stringify`, so a NUL is visible.
  - Both backends share this registry, so they reject the same registrations. lookup-index.ts still exposes no SQL (:9-10).
  - Do not add the check to record-schema registration (record-codec.ts:159). A record type only reaches SQL through a lookup, because a lookup requires a registered record schema of its type (lookup-index.ts:90-92).
- **Type names in use:**
  - The 17 lookup types above, and all 49 distinct `aggregateType` literals in `src` (including Workspace, Project, TaskAttempt, ObservedArchitecture, WorkspaceArchitectureObservationCurrent and the rest), match the pattern.
  - All test literals match too (Widget, Other, Artifact, …).
  - Dynamic test values come from registered schemas, for example `sv03-census-${schema.aggregateType}` in tests/work-graph/S1-codecs-indexes.test.ts:238.
  - No test checks a lookup registration error text.
- **The helper:** a new small SQLite-side module, imported by sqlite-record-store.ts and round 1's sqlite-text-scan.ts:

  ```ts
  aggregateTypeTerm(type) {
    if (!AGGREGATE_TYPE_PATTERN.test(type)) throw new Error(…);   // re-checked in the builder, like round 1's limitLiteral
    return `json_extract(ref_key, '$.aggregateType') = '${type}'`;
  }
  ```

  The pattern allows no quote, no NUL and no non-ASCII character, so there is nothing to escape and the helper does no escaping.
  - **The NUL rule matters:** `db.prepare` and `db.exec` pass the text NUL-terminated, so an embedded NUL would cut the SQL short (Node source knowledge, not verified here).
- **Sites that switch from bound to literal** (remove the matching `params` entry):
  - :582-583 (lookupInside)
  - :639-640 (lookupOrderedInside)
  - :735-736 (countInside, both forms)
  - the text-table rebuild (sqlite-text-search.ts:205 or its round-1 replacement)
  - and the new DDL WHERE. SQLite does not allow bound parameters in a partial-index WHERE at all.
- **Statement cache:** keys gain about one variant per type for shapes that two types used to share. That is negligible next to round 1's power-of-two LIMIT variants.
- **Why a bound type hurts once any partial index exists** (SQLite source knowledge, not verified here):
  1. For every partial index on the table, the planner calls `whereUsablePartialIndex`, which compares each query term with the index WHERE (`sqlite3ExprImpliesExpr`, then `sqlite3ExprCompare`).
  2. For `json_extract(ref_key,'$.aggregateType') = ?` the left sides are equal, so SQLite reaches the `?`. `exprCompareVariable` then marks that parameter in the statement's expmask (`sqlite3VdbeSetVarmask`).
  3. On the first prepare no value is bound yet, so the comparison fails and the partial index is not used.
  4. Every later `sqlite3_bind_*` on that parameter expires the statement, and the next step re-prepares. node:sqlite binds every parameter on every `get`/`all`, so a reused statement re-plans every time. That is the same mechanism as the measured `LIMIT ?` cost: 154 µs against 3.2 µs (raw/sql-micro-4.json).
  5. It happens when compared against any type's partial index. `countInside`, which has no LIMIT, would go from about 3.7 µs to about 150 µs.
- **Only that one term shape triggers it.** Other terms fail the comparison before SQLite reaches their `?`: `ref_key = ?` differs on the left side; `json_extract(snapshot_json,…) = ?` differs in its column argument; range terms, row values and `IN` lists use a different operator.
- **Rule for the construction book:** never put `?` on the right of `json_extract(ref_key, '$.aggregateType') =` in any query on `snapshots`. Do not run ANALYZE: with STAT4 statistics, other bound values could trigger the same re-prepare (store-reads.draft.md:106).

## 4. One parse inside the store (Design S, with the review's corrections)

**The design:**

- **Contract (review item 12): an additive change to `ports.ts:154-160`.**
  - It adds `validateBody?(record: EncodedRecord, body: Readonly<Record<string, unknown>>): DecodeResult<EncodedRecord>` to `EncodedRecordSchema`.
  - Document that it is called only after `decodeRecordBody`, so `refKey === canonical(body.ref)` and `revision === body.revision` already hold.
  - `createRecordSchemaRegistry` (record-codec.ts:155-169) must check it is a function and copy it into the frozen schema at :164-169, or it is silently dropped.
- **New function** `decodeStoredRecord(schema, refKey, json)` in record-codec.ts:
  - it runs `decodeRecordBody` (:269-308, the only full parse, at :276);
  - then the same type check and wrapper reasons as `applyRecordSchema` (:373-395);
  - then `validateBody(Object.freeze({...record}), decoded.parsed)` when registered, otherwise `validate`.
- **Used by:**
  - `readManyInside` (sqlite-record-store.ts:397-407);
  - `readManyKeys` (in-memory-record-store.ts:241-247);
  - `decodeGuardedRevision` (guarded-revision.ts:19-22).
- **Not used on the write path** (`planPreparedCommit`, `bindPreparedRecords`, record-codec.ts:560-641, :730-739), which stays on `validate`. The isolation guarantee at record-codec.ts:365-367 depends on it.
- **Note codecs** (note-record-codecs.ts:451-507): split each decoder into `parseObject` (:116-123) plus `decodeXBody(record, body)`, and register those at :672-686.
  - `decodeXBody` may skip the canonical-ref check (:455-456, :478-479, :501-502).
  - **Correction to the draft:** NoteHead must keep `body.version === record.revision` (:457). `decodeRecordBody` proves `body.revision`, not `version`.
  - NoteVersion's revision check (:480) and CurrentPointer's (:503) are already implied by `decodeRecordBody`.
- **Failures and their reasons are unchanged:** `parseObject` rejects a subset of what `decodeRecordBody` already rejects first.
- **Tests, per review item 4:**
  - a pure codec-equivalence test on fixture JSON strings and mutated variants, with no database;
  - a synthetic-Widget `validateBody` test through public `commit`/`readMany`: commit still uses `validate`, reads use `validateBody`, a rejection gives `corrupt` with the wrapper reason;
  - no tampering tests.

**Not in round 2:**
- Decision 66 puts "read once, parse once" in round 1 (HANDOFF.md:421); round 2 is index scope only.
- S touches different files: ports.ts, record-codec.ts, guarded-revision.ts, the note codecs and both backends' read paths.
- It is a contract change that needs its own review.
- After round 1's head-cache fix, its gain is about 1–3 ms per call (store-reads.draft.md section 5, ESTIMATE).
- If the lead wants it, run it as a separate small follow-up after round 2's measurements.

## 5. In-memory backend

**No change to index scope:**
- The buckets are per registration (in-memory-record-store.ts:110-117).
- They are maintained only for records of the index's type (:338-342) and undone on rollback (:380-383).
- The query rules are shared (lookup-index.ts).

The only effect is the new registration check, shared with SQLite, so both backends reject the same registrations. Missing fields map to `null`, composite values are never candidates (lookup-index.ts:496-504) — the same as SQLite with a type-only predicate.

## 6. Tests

**Existing tests that read the schema:**
- `tests/record-store/lookup.test.ts:187-192` checks that some index SQL on `snapshots` contains `group` and `status`. The partial DDL still does, so it **passes unchanged**. Do not tighten it.
- `tests/scenarios/harness.ts:283-286` lists tables only (on kernel.sqlite).
- No test names `next_lookup_` or `next_fts_` (grep).
- The tampering step in `lookup.test.ts:194-198` keeps `ref_key`, so the row stays in the Widget index and the result is still `corrupt`.

**Tests affected without changes:**
- `S1-codecs-indexes.test.ts:434-442` (narrower registration, then the full one, on one file): the reopen now creates partial indexes in one transaction; the counts stay the same.
- `raceWindow` (plan.ts:807) and `invariants.ts:348`, which opens a `VACUUM INTO` copy (:318-326): no change under (C′); under (A) they drop NoteHead indexes, on the live ledger and on the copy respectively.
- `lookup.test.ts`, `S2A-ordered-lookup.test.ts` and `S2C-count-lookup.test.ts` remain the regression net for every query shape on both backends.

**New tests, through public interfaces only** (expected values computed by hand; setup through public `commit`, except T2's allowed storage-migration fixture):

| # | Backends | What it does |
|---|---|---|
| T1 | both | Type isolation. Schemas W and V with identically named paths and values, plus a row missing a path in each. `lookup` (including `null`), `lookupOrdered` (asc and desc, with `bound` and `after`), and `countLookup` (plain, ordered, distinct) on W's indexes return only W's rows, and the reverse for V; both backends agree. Catches a dropped or wrong type literal. |
| T2 | SQLite | Upgrade. Open with `lookups: []`, commit, close. The fixture runs the frozen pre-round-2 DDL text of the same registrations (old names, no WHERE). Open with the registration: answers equal the in-memory backend's; a commit made after the upgrade is visible; a second reopen gives the same answers. |
| T3 | SQLite | Changed registration on one file (same name, paths `group` then `status`, then back). Results follow the registration each time. |
| T4 | SQLite | Second backend on the same file. A (W and V lookups) looks up, so its statement is cached. B opens with only W. A's pages for W and V are unchanged, A's new V commit is visible, and a reopen gives the same answers. Covers re-prepare after another connection's DDL under (A) or (C′). |
| T5 | both | Registration check. Lookup types `Wid'get`, `Wid\u0000get`, `1Widget`, `Wid-get`, `Wid get` and `Ẃidget` are rejected before the backend exists; `Widget_2` is accepted. |

- **"Stale indexes are gone" cannot be shown through a public interface.** Either keep it to evidence (dbstat and EXPLAIN), or the lead rules that one `sqlite_master` assertion is allowed (precedent: lookup.test.ts:187-192).
- **Evidence outside the suite** (review item 7), on the 20 k copy, before and after:
  - a micro over every shape, each fresh and reused: `lookupInside` with and without `after` × string / number / boolean / `IS NULL`; `lookupOrderedInside` asc/desc × text/integer × bound / after / keyset; `countInside` plain / ordered / distinct; the text rebuild query; the primary-key read;
  - EXPLAIN shows each query on its own type's index. Target: a reused small result at about 10 µs or less;
  - dbstat sizes;
  - upgrade time at open, with the default cache and with the cache bump;
  - `S2A-notices-overbound` write cost;
  - the full suite with bwrap and 8 workers.

## 7. Risks and open questions for the lead

1. **Drop rule:** (A) or (C′) (section 2). Evidence for (C′): plan.ts:805-807, invariants.ts:288-300, measure-4b-final.mjs:212.
2. **One-time upgrade at open:** about 12–30 s at 87 k rows, minutes at 870 k (ESTIMATE). It holds a write lock for the whole time; other connections give up after the 5 s `busy_timeout` (:176). Accept a silent delay? Add a Host log line or notice? Add the cache bump?
3. **The file stays about 1.8 GB** with about 1 GB of free pages until VACUUM. Recommendation: no automatic VACUUM; manual step yes or no?
4. **Downgrade or branch switching** rebuilds the full indexes (slow open, +1 GB), and a round-1-only build re-prepares every lookup on a round-2 ledger. Consider moving the literal type helper into round 1.
5. **Planner:** without statistics every partial index is estimated at half the table, and all of one type's indexes share that estimate, so the choice between them works as today. Every shape must still be checked with EXPLAIN (section 6). Keep the leading type column (recommended).
6. **Tampering-only behaviour shifts:** malformed `snapshot_json` becomes writable by raw UPDATE for types with no lookups (NoteVersion, CurrentPointer). Today any `json_extract` index rejects it (store-reads.draft.md:213). Production writes always go through `JSON.stringify` (:487), so this has no production effect. Separately, an existing row of an indexed type with malformed JSON would now fail the upgrade's CREATE; only tampering or legacy data can produce that.
7. **Text index generic lookup** (text-port.draft.md:309): keep creating it. After round 2 it holds 20 k entries and serves the rebuild SEARCH.
8. **Docs the lead owns:**
   - the comments at sqlite-record-store.ts:4-7, :22-23 and :90-95;
   - the "safe expression indexes" wording in the R3c/N0 spec;
   - IMPLEMENTED-CAPABILITIES, record-store.md, and the decision 66 evidence.
   - migrations.ts:5-8 stays true only if the drop lives outside migrations.ts.