I measured partial indexes on a copy of the 20,000-note dataset. They shrink the lookup indexes from 1,077 MiB to 38 MiB, write commits are faster, and every query returned exactly what it returns today. One condition decides whether it pays off: aggregateType must become a literal at every site in the same change. If it stays bound (`?`), every execution re-prepares and cached reads get about 15–20× slower.

All runs finished at 14:37. The checkout, measure-4b, prof-4b, the DSH runs and the reserved ports were not touched. Node 24.18, SQLite 3.53.1, warm OS page cache, default pragmas (journal delete, synchronous FULL, cache 2 MB).

**Setup.** I copied `prof-4b/.measure-data/full/storage/ledger.sqlite` (same sha256) to `~/dsh-work/r2-measure/full.sqlite`.
- I also made `full-vac.sqlite` (the full-index file after VACUUM INTO) so the two layouts compare like for like.
- `partial.sqlite` is the migrated copy after VACUUM INTO.

**1. Indexes and rows per type**
- `snapshots` has 70 `next_lookup_*` indexes plus the primary-key autoindex (the "71").
- I mapped each index to its type by recomputing the FNV name suffix; all 70 matched and all 70 are registered in the worktree source.

| Type | Lookup indexes | Rows |
|---|---|---|
| NoteHead | 13 | 20,034 |
| Session | 8 | 202 |
| Run | 6 | 202 |
| DispatchOutboxEntry | 2 | 202 |
| PlanProposal | 2 | 101 |
| PlanRevision | 1 | 101 |
| Goal | 1 | 101 |
| ArchitectureCatalog | 1 | 1 |
| SessionMessage, VerificationRound (9 each), SessionWorkLink (6), QueryRun, SessionAnomalyAnchor (3 each), ControlIntent, TaskRequeue (2 each), QueryJob, RunActivity (1 each) | 36 | 0 |

- Rows with no lookup index of their own: NoteVersion 65,293; CoreOperation, TaskAttempt and TaskLease 202 each; CurrentPointer 101; 5 singleton types. Total 86,950.
- Index entries: today 70 × 86,950 = 6,086,500. Partial: 264,079 (4.3%).

**2. Sizes (dbstat)**

| | File | Lookup indexes |
|---|---|---|
| As is | 1,878,298,624 B (1,791.3 MiB, 565 free pages) | 1,128,890,368 B = 1,076.6 MiB, 13.6–17.3 MiB each |
| Full, vacuumed | 1,724,305,408 B | 935.4 MiB |
| Partial, vacuumed | 783,400,960 B (747.1 MiB) | 38.1 MiB |

- Partial per type:
  - NoteHead: 13 indexes, 38,040 KiB (2,772–3,316 KiB each).
  - Session: 380 KiB. Run: 224 KiB. DispatchOutboxEntry: 132 KiB. PlanProposal: 52 KiB. PlanRevision: 20 KiB. Goal: 16 KiB. ArchitectureCatalog: 4 KiB.
  - The 36 zero-row indexes: 4 KiB (one page) each.
- Unchanged: snapshots 262.3 MiB (260.9 vacuumed), events 303.0 MiB, primary-key index 11.9 MiB, FTS tables about 100 MiB (still present).

**3. Migration (one `BEGIN IMMEDIATE` … `COMMIT`, warm cache)**
- Each index is recreated with the same expressions plus `WHERE json_extract(ref_key,'$.aggregateType') = '<Type>'` and a new name (fingerprint + `\0partial:aggregateType`).
- Drop each, then create its replacement: 7.43 s in total (creates 6.81 s, drops 0.41 s, commit 0.21 s).
  - Each CREATE scans the whole table: 68–90 ms for small types, 145–213 ms per NoteHead index.
  - The file stays 1,878,298,624 B with 266,419 free pages (1.02 GiB).
- Create all, then drop all (the "create registered, then drop stale at open" order): 6.85 s. The file grows to 1,915,973,632 B (+37.7 MB) with 275,617 free pages.
- Nothing shrinks without a VACUUM: VACUUM INTO took 11.2 s and in-place VACUUM 24.1 s, both ending at 783,400,960 B. VACUUM INTO of the full file took 15.2 s.

**4. Query shapes**
- Method: one process holding both files, cases alternated, 54 cases, run twice (against the vacuumed and the unvacuumed full file).
- All 54 results are identical between full and partial in both runs.
- Times are µs per execution. "Fresh" = prepare + execute each time; "reused" = one statement executed repeatedly. LIMIT is always a literal (256 or 64).

| Shape | Full, literal or bound (fresh / reused) | Partial, literal (fresh / reused) | Partial, bound (fresh / reused) |
|---|---|---|---|
| lookupInside, small or empty (6 rows, after, 0 rows, Run 2 rows, empty-type, null matcher) | 182–348 / 3.9–6.5 | 67–104 / 3.8–6.6 | 117–199 / 74–113 |
| lookupInside pages (256, 32, 202 rows) | 290–344 / 70–93 | 137–170 / 71–102 | 199–226 / 140–173 |
| lookupOrdered small or empty (PlanRevision desc ± after, integer desc ± after, QueryRun asc) | 200–323 / 4–21 | 90–138 / 3.6–18 | 177–271 / 96–144 |
| lookupOrdered pages (NoteHead asc bound, asc keyset after, desc) | 321–356 / 113–128 | 204–214 / 115–123 | 258–304 / 206–223 |
| countInside (plain 141 / 0 / 202, ordered-index count, distinct 202 / 0) | 151–234 / 4.3–21.8 | 90–118 / 4.6–20.9 | 178–278 / 101–143 |
| Primary-key read (hit / miss) | 16 / 10, reused 8.5 / 3.2 | same | – |
| `MAX(events.id)` | 10.5 / 3.5 | same | – |
| Open-time NoteHead type scan (20,034 rows) | about 143–150 ms | same | – |

- **Bound type on the partial file.** I counted recompiles with the authorizer callback (calls during an already prepared statement's execution).
  - Every execution re-prepares: 5–27 authorizer calls each time, the same count as the original prepare.
  - The partial index is still used, but only because of that re-prepare. The plan compiled before any value is bound is a full `SCAN snapshots` (with a temporary B-tree for the ordered shapes).
  - Literal type: 0 recompiles in every case. Full file, bound type: 0 recompiles.
- **Literal type, reused statements** (what round 1's statement cache gives): no difference between full and partial; all gaps are within noise. Partial indexes speed up only the prepare on a cache miss (about 2–3× cheaper), not cached reads.
- **One partial index is enough** to make bound-type queries of other types, even ones served by a full index, re-prepare on every execution (`00b-mixed-check`). So every bound aggregateType site has to switch together, including `sqlite-text-search.ts:205/:301` or whatever round 1 puts in their place. This confirms review item 6.
- **Control.** A bound `LIMIT ?` re-prepares in both files: full 389 fresh / 194 reused, partial 133 / 71. This also checks that the authorizer method works.
- **Index choice.** In both files the NoteHead path-ordered query uses the `s4_note_by_anchor_0` index rather than `s4b_note_by_path_0`; the results are the same.
- **Rough estimate per call (not measured).** For 264 index lookups, as in "stale goal": about 1.3 ms with a literal type and the cache, about 21 ms with a bound type on partial indexes.

**5. Write cost (1,000 transactions of one write each; mean ms per transaction, run 1 / run 2 in reversed order)**

| Write | synchronous=FULL (store default), full | FULL, partial | synchronous=OFF, full | OFF, partial |
|---|---|---|---|---|
| NoteHead insert (copied row, new id) | 19.71 / 19.65 | 15.37 / 14.71 | 0.93 / 1.05 | 0.197 / 0.216 |
| NoteHead update (version + 1) | 17.57 / 18.83 | 14.69 / 16.56 | 1.07 / 1.30 | 0.177 / 0.183 |
| NoteVersion insert | 17.45 / 18.30 | 14.32 / 16.01 | 0.85 / 1.03 | 0.071 / 0.066 |
| Commit-like (event + snapshot + idempotency row) | 17.74 / 18.12 | 15.32 / 16.48 | 1.05 / 1.17 | 0.237 / 0.240 |

- With the store's defaults, fsync on this WSL disk takes about 14–15 ms per commit, so partial indexes save about 2–5 ms per commit (about 10–25%).
- Without fsync the database work is 4.5–15× cheaper.
- Bytes written per transaction (`/proc/self/io` write_bytes, run 2): FULL 2,805 / 1,014 / 2,710 / 2,717 KiB on full vs 631 / 255 / 119 / 640 KiB on partial; OFF 615 / 316 / 622 / 625 KiB vs 132 / 68 / 21 / 155 KiB. This counter includes rollback-journal writes and ext4 effects, so read it only as a comparison between files.

**Not measured.** A cold OS page cache (dropping caches needs root), memory use, a variant without the constant aggregateType column, and the real store's open path. Run-to-run noise is about ±15% for fresh prepares.

**Leftover copies.** About 12 GB in `~/dsh-work/r2-measure`, all mine and safe to delete: `full.sqlite`, `full-vac.sqlite`, `partial.sqlite`, `migrate-dropfirst.sqlite`, `migrate-createfirst.sqlite` (vacuumed in place, now 783 MB), and four `write-*.sqlite`.

Everything is in `D:/cc-lead-notes/impl/s4f/r2-measure/` (`/mnt/d/...` in WSL):
- Scripts: `00-mechanism-check.mjs`, `00b-mixed-check.mjs`, `01-inventory.mjs`, `02-sample.mjs`, `03-migrate.mjs`, `04-queries.mjs`, `04-queries-ab.mjs`, `05-write.mjs`
- Raw JSON:
  - `inventory-{full,full-vac,partial,migrate-dropfirst}.json`, `samples.json`
  - `migrate-{dropfirst,createfirst}.json`, `vacuum-into.json`, `vacuum-inplace.json`
  - `queries-ab-fullvac-vs-partial.json`, `queries-ab-asis-vs-partial.json`, `queries-{full-vac,partial,full-asis}.json`
  - `mechanism-check.json`, `mixed-check.json`
  - `write-{full-vac,partial}-{full,off}[-r2].json`