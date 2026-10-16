**Adversarial review: round 2 (lookup indexes limited to their own record type)**

Basis: HEAD 26fc5613 (no source changes since ad2679f3), the measurement files in `D:/cc-lead-notes/impl/s4f/r2-measure/`, and the design text. I only read files. Node is not installed on this Windows host, so I ran nothing.

## Problems

**1. One site that still binds the type makes that shape 15–20× slower, and no test can see it. Nothing mechanical catches a missed site, and round 1's code was not inventoried.**
- Evidence:
  - The inventory in section 1b is taken at HEAD. Round 2 lands on top of round 1, whose new SQL (`sqlite-text-scan.ts`, the statement-cache helper, any batched read) nobody has listed yet.
  - The rule in the construction book names only the bare form `json_extract(ref_key, '$.aggregateType') = ?`. The 4B code already queries `snapshots` through an alias (`JOIN snapshots s`, `sqlite-text-search.ts:316`). A bound `json_extract(s.ref_key, …) = ?` is the same column of the `snapshots` cursor, so it would also re-prepare.
  - Results are identical whether the type is bound or literal (54 of 54 cases), so T1–T5 and the regression suites pass with a missed site.
- Fix:
  - Redo the inventory against round 1's merged code.
  - Add a source-scanning architecture test, following the precedent of `tests/architecture/state-writes.test.ts` (AGENTS rule 9). It fails on any `aggregateType'\)\s*=\s*\?` in `src/core/record-store/*.ts`, with any alias.
  - Make the DDL builder, the three query builders and the text rebuild all call the one `aggregateTypeTerm` helper.

**2. The planned acceptance evidence does not exercise the shipped SQL, and it leaves out shapes the design lists.**
- Evidence:
  - `04-queries-ab.mjs` (`sqlOf`) builds the SQL by hand.
  - `sql-micro-4`, which review item 7 says to re-run, binds the type. On a partial-index file it will show re-prepares that the shipped code no longer has, and it cannot show whether the shipped builders emit the literal.
  - The measurement set has no number matcher (`json_type IN ('integer','real') AND … = ?`), no boolean matcher, no integer-ordered `asc` with `bound`, and no integer-ordered count. Section 6 lists all of these.
  - Decision 69 item 1 asks for cost acceptance rows measured before merge. Item 5 asks for a line budget and a reuse statement, and applies "from tonight's round 1". The design has only the "~10 µs" target, and that target is round 1's.
- Fix:
  - Measure each shape through the public port on the 20k copy, reused and steady-state. A per-execution re-prepare adds 70–140 µs (measured), which is visible.
  - Add the missing matcher and ordered shapes.
  - Write the rows with numbers:
    - lookup-index bytes at 20k (about 38 MiB);
    - 0 re-prepares per execution for every shape;
    - upgrade time at open;
    - steady-state open unchanged;
    - fresh-database open time (item 6);
    - `S2A-notices-overbound` write cost no worse;
    - store reads per call unchanged;
    - a line budget, and "reuse round 1's statement cache and literal pattern".

**3. The migration blocks readers too, not only writers, and at 20k it outlasts `busy_timeout`.**
- Evidence:
  - The ledger runs in rollback-journal mode. No `journal_mode` pragma is set in `sqlite-record-store.ts:176`; WAL is set only for `artifacts.sqlite` (`sqlite-body-store.ts:79`, `create-platform.ts:571`).
  - The SQLite cache is 2 MB, and the transaction writes about 38 MB of new index pages. Spilling the cache needs an EXCLUSIVE lock, so after the first spill other connections cannot even read (SQLite source knowledge).
  - Measured: 7.43 s in one transaction, against `busy_timeout = 5000` (`:176`).
  - A Host that does not get the instance lease still opens the platform ("serves reads and owner writes only", `host.ts:458-466`). So a second Host, a CLI or an evidence script started during the upgrade fails with SQLITE_BUSY.
  - Risk 2 says "a write lock" and "other connections give up", which understates this.
- Fix: correct risk 2 and record that a 20k upgrade exceeds the busy timeout. Add the Host log line. The lead accepts the behaviour or sizes the timeout.

**4. Under the recommended rule (C′), T4 makes no schema change, so it cannot cover "re-prepare after another connection's DDL".**
- Evidence: B registers only W.
  - A's V indexes are not registered by B, and B registers no V lookup, so (C′) keeps them.
  - A's W indexes are registered by both.
  - B's plan is empty, so no DDL runs. The design's "under (A) or (C′)" is wrong for (C′).
- Fix: B registers W with a changed path set (same name), so B drops and creates a W index while A holds cached W and V statements.

**5. Test-list problems.**
- **T3 duplicates existing tests.**
  - 2C-08 (`S2C-count-lookup.test.ts:325-348`, `s2c-count-reopen` with `['group']` then `['group','tone']`) and QA-03 (`S2A-ordered-lookup.test.ts:362-385`, the same name changed from unordered to ordered) already reopen with the same name and changed paths.
  - Under round 2 they already run the (C′) "registered type, stale name" drop.
  - Drop T3 (AGENTS rule 3).
- **T2 can only catch a throw.**
  - Answers do not depend on whether an index exists.
  - Its raw-DDL setup from a second connection is not in the slice-4 closed list of fixture exceptions (`slice-4-SPEC.md:698`).
  - It needs a lead ruling, or it moves to evidence (dbstat plus a `sqlite_master` listing on a copied 4B ledger).
- **T1–T4 pass on today's code.** They are characterization tests, not failing-first TDD cases, and should be classified as such before freezing.
- **T5 can pass for the wrong reason.** `lookup-index.ts:90-92` rejects a lookup whose type has no registered record schema, and that check runs first. T5 must register record schemas of the odd types (`record-codec.ts:159` accepts any non-empty string) and assert the new rule's error.

**6. The measurements contradict most of the design's time and size estimates.**
- Migration at 87k rows: estimated 12–30 s, measured 7.43 s.
  - Drops: estimated 1–3 s, measured 0.41 s.
  - Each CREATE: estimated 0.15–0.35 s, measured 0.068–0.213 s.
  - The 36 indexes of types with no rows still scan the whole table: about 2.4–3.2 s of the 6.81 s of creates (36 × 68–90 ms).
- Rule (A) after a narrow open: estimated 57 rebuilds at 8–20 s; at the measured 68–90 ms each that is about 4–5 s.
- Downgrade: estimated 30–90 s. VACUUM INTO of the full file, which rebuilds all 70 full indexes, took 15.2 s, so roughly 15–20 s.
- At 870k rows: estimated 3–5 minutes. Scaling the warm measurement gives roughly 1–1.5 minutes.
- Index size after round 2: estimated 50–80 MiB, measured 38.1 MiB.
- The cache bump ("about 3–8 s") is unsupported. The migration is already 7.4 s warm without it, and the cost is 70 table scans that no pragma removes. Drop the option or measure it.
- Fresh-database open (section 2, item 5): estimated 0.1–0.4 s saved.
  - The measured commit cost on this WSL disk is about 14–15 ms (synchronous FULL).
  - `:115` runs 70 autocommit CREATE INDEX statements, and `migrations.ts:148` adds 4 autocommit CREATE TABLEs.
  - So a fresh SQLite open costs about 1.1 s today, and one transaction removes about 1 s of it (ESTIMATE from measured numbers, if test temp directories are on the same disk).
  - This may be round 2's biggest effect on the test suite. Measure it as an acceptance row.
- Index-scope reads: the measurement shows no cached-read gain (gaps within noise), only 2–3× cheaper prepares on a cache miss. State that round 2 pays for itself in size and write cost (10–25% at FULL), not read speed.

**7. Five NoteHead indexes look unused. Decision 69 item 2 makes unused indexes a cost item.**
- Evidence:
  - Measured in both files: the NoteHead path-ordered query uses `s4_note_by_anchor_0`, not `s4b_note_by_path_0`.
  - The anchor index columns (type, json_type(projectId), json_extract(projectId), json_type(anchorKeyN), json_extract(anchorKeyN), ref_key) serve that query, because the query carries `json_type(anchorKeyN) = 'text'` as an equality (`sqlite-record-store.ts:650`).
  - The 5 `s4b-note-by-path-*` physical indexes are about 14.5 MiB and 5 of the 13 NoteHead index writes per head write.
- Fix: the EXPLAIN evidence lists every physical index with the shapes that use it. The lead decides whether to keep building those 5 (the registration stays, for `orderBy` decoding). That could be outside round 2.

**8. "Ship rounds 1 and 2 close together" cannot be enforced.**
- Evidence:
  - Round 1 runs tonight and, per the task, without the literal type.
  - Measured: one partial index is enough to make every bound-type query re-prepare (`00b-mixed-check`).
  - So any round-1-only or older build that opens a ledger a round-2 build has opened gets the 15–20× slowdown on every lookup and count. This includes DSH copies, evidence scripts, worktrees sharing a storage directory, and the pushed remote branch. An older build also rebuilds the 70 full indexes (+1 GB).
- Fix:
  - Put the literal switch in the same commit as the first partial index.
  - Record in STATUS that a ledger opened by round 2 must not be opened by an older build.
  - Or add a small round-1 follow-up for the literal helper, which is harmless on full indexes (measured).

**9. Fingerprinting the exact DDL text also renames indexes after cosmetic edits (low).**
- Any whitespace, quoting or column-join change in the builder renames all 70 indexes and costs every ledger a 70-scan migration.
- The design's choice is the safe one. Either add a comment on the builder saying "any text change here migrates every ledger", or hash a structure plus `LOOKUP_INDEX_RULE_VERSION`, as `codeOf` does (`sqlite-text-search.ts:88-100`), and bump the version on semantic changes.
- Including the raw name in the hash is harmless but only matters for names that sanitize alike.

## Confirmed correct

**Inventory and sites**
- 70 lookups across 17 types; 19 are ordered, 3 of them integer. The 71st index is `sqlite_autoindex_snapshots_1`. The per-type counts match the measurement exactly.
- The three bound sites are `sqlite-record-store.ts:582-583`, `:639-640` and `:735-736`.
- The only other type-filtered queries are `sqlite-text-search.ts:205` and `:301`. Neither causes the per-execution slowdown:
  - `:205` runs once per rebuild; switching it is for uniformity.
  - `:301` filters `f.ref_key`, a different table's column, so the comparison fails before reaching the `?` (SQLite source reasoning). The measurement summary's "must switch :301" is broader than needed.
- Primary-key reads (`:347`, `:387`, `:831`) and the upsert (`:246-248`) do not filter by type.
- Nothing else in `src` queries `snapshots`. Test SQL is literal or has no type term (`A8-host-restart.test.ts:258`, `S5-decisions.ts:159`, `invariants.ts:374`).

**Partial-index mechanism**
- Every builder puts the type term as a top-level AND term, including the DISTINCT subquery, so a literal term implies the index WHERE.
- Measured: 0 recompiles in every literal-type case, including bound path values, `after`, row-value keysets, the ±safe-integer bounds and `IS NULL`.
- Measured: a bound type re-prepares on every execution, and the plan compiled before binding is `SCAN`.
- Measured: a bound `LIMIT ?` re-prepares in both files.
- Section 3's account of the mechanism matches all of these.

**Stored SQL and the drop rule**
- `sqlite_master.sql` is stored without `IF NOT EXISTS` (0 occurrences in `inventory-full.json`) and ends with the WHERE literal (`inventory-partial.json`). (C′)'s end-anchored regex works on that form.
- (C′) is the right choice over (A). Additional evidence: `S4B-text-search.test.ts:506-519` opens a `lookups: []` backend while the first backend is still open; under (A) that drops every Widget index from under it.
- Keeping the drop out of `migrations.ts` is correct; its header (`:5-8`) promises it never drops anything.
- Not comparing the stored SQL of an index that already has the expected name is correct under AGENTS rule 4.

**Index layout and migration**
- Keeping the leading type column keeps the plan shapes and gives identical results.
- No path may get an `IS NOT NULL` filter.
- One transaction is crash-safe, so a file is never left half-migrated.
- Drop-first keeps the file size; create-first grows it by 37.7 MB.
- Only VACUUM shrinks the file (measured 11.2 s INTO, 24.1 s in place).

**Writes and the in-memory backend**
- Writes get cheaper: measured 10–25% at FULL, and 4.5–15× less database work without fsync.
- The in-memory backend is already per type (`in-memory-record-store.ts:110-117`, `:338-342`, `:380-383`), so only the shared registration check changes.

**Registration check and tests**
- `^[A-Za-z][A-Za-z0-9_]*$` matches every aggregateType literal in `src`, `tests`, `scripts` and the 4B evidence (grep).
- `lookup.test.ts:187-192` still passes, and its tamper step keeps `ref_key`, so the row stays in the Widget index and the result stays `corrupt`.
- No test names `next_lookup_`, and no `.sqlite` fixtures are committed.
- Tests have no raw writes of malformed JSON, so risk 6 changes no existing test.

**Scope**
- Downgrades stay correct; they are only slower.
- Leaving Design S out of round 2 matches decision 66.