## Slice 8 L8 rework 1 — complete, PASS rows bwrap-blocked

The close-out subagent died before reporting; I ran its exact list myself, one vitest command at a time.

**Items**
1. **Trigger only on new registration.** RED: both restart tests failed `expected { requestSeq: 3, … } to match { requestSeq: 1, pending: false }` (restore wrote 2, retry 3). `openWorkspaceImpl` now sets `registeredNow = !registered.replayed` only in the registration branch and triggers only then; restore is left to `retryPending`. GREEN: 2/2 `(sqlite)` rows (satisfied restart stays seq 1; pending restart retries exactly once, seq 3 `startup_retry`, no seq 4).
2. **Final order.** Rows are sorted by ruling 11, capped, then keyed `architecture:000000…`; the omission row takes the next sequence. RED through public `prepare`: `src/a-inner` before `src/a`; GREEN. The exact `src/a` / `src/a/inner` pair is proved in the pure builder (a filesystem cannot hold both), the public proof uses `src/a` + `src/a-inner` (same `/`<`:` hazard). `architectureReminderRows` deleted; no allowlist change.
3. **Failures recorded.** Driver catalog rejection/throw (not cancellation, `not_found` legal) now goes to the same fail exit with the start snapshot’s revision; a stale revision writes nothing. Pure state tests added (5): 2,500 → first 2,000 chars, 2,000 kept, codec rejects 2,001 with “at most 2000”. `failed` event `occurredAt` = write time; record keeps `requestedAt` (public record assertion). No public event reader.
4. **One mapping rule.** `mappings` optional; absent → server `moduleMappingsOf(active catalog)`, `[]` without a catalog; explicit callers unchanged. UI no longer sends mappings and its `map` is gone; `core-http-types` derives from the port. RED: `captureSourceChanges requires explicit module/interface mappings`; GREEN 10/10 both backends. Also additive `current.persistedRef` + `previousPersistedRef`, used by the driver’s previous ref.
5. **Observation-state through public steps.** Project/Workspace via `createProjectBootstrapServices`, real driver triggers, moved-root failure, kept `gatedTools`; proves identity (`auto-capture:<p>:<w>:<seq>`, replay), watermark, and failure guard (seq 1 fails after seq 2 exists → no failed write; seq 2 then succeeds). 12/12 both backends.
6. **§3 coverage.** A-03 variants 12→10 + `另有 2 条…`, `，不确定`, `还没有观测`, empty — public `prepare` on both; failure-after-success both (old rows/time before retry, `previous` = old current); settings/manual/failed-trigger both backends, Host-start rows named `(sqlite)`; gated concurrency/close 9/9 (serial two workspaces, merged trigger, B not entered before close, unbound pending not retried). Measured reads: **12 = 6 + 6 latest chunks** (no previous) and **21 = 8 + 7 latest + 6 previous** (with previous; 12/13 files, chunkBytes 500).
7. **Three PASS rows.** 6/6 fail only on:
   `AssertionError: ENOENT: no such file or directory, access '/usr/bin/bwrap': expected 'rejected' to be 'ready'`
   (3 unique messages for memory/sqlite × 3 rows; no assertion mismatch). Rows assert non-replayed PASS, seq +1 `check_passed`, `pending:false`, new current, `previous` = old current; replay `replayed:true`, seq/current/previous unchanged. Not skipped or `.todo`.
8. **Production reach.** `architectureReminderRows` deleted; `production-reach` 4/4 green.
9. **Z01 counted read.** Wait on public `architecture/observation-state` until `pending:false` before `commitsBefore`; assertion unchanged; 2/2 (4 repeat runs). Counted-read grep: only Z01 runs the real Host driver; all other `commitsBefore`/`commits.length`/event-count hits are `createWP2Platform`/`createTargetPlatform`/service fixtures with no driver, or pagination/construction counters — untouched.

**Accepted suggestions:** start-snapshot previous ref (driver reads `observationState`, passes `persistedRef`); persisted refs returned; failed reminder read gives one `架构提醒不可用` and continues (cancelled still cancels); dead `signal`, queue `trigger`, `running.key` deleted; random-ID inequality and duplicated ownership test deleted.

**Production lines:** **+249 / −97 (net +152)** across 9 files. Tests: changed +1,065/−574, new 1,516 lines.

**Checks:** 20 commands, one at a time, `--maxWorkers=2`: **19 files / 217 tests passed**; PASS file **6 failed (bwrap only)**. `npm run typecheck` 0; `npm run check:architecture` “next source boundaries: OK”; `npm run build` 0. `git diff --check` clean. No `.dsh-scratch/` exists.

**Fact grep:** no direct store writes, encoded Project/Workspace snapshots, `.todo`/`.skip`, or remaining `architectureReminderRows`. Allowed hits: pure codec tests (`encode/decodeArchitectureAutoCapture`), public `requestAutoCapture`/`failAutoCapture` in the record-time test, and read-only pointer/chunk reads in the observation-state test (no facts written).

**UNSPECIFIED (smallest options).**
1. Catalog `not_ready` and a failed start `observationState` read leave the request pending (no failed write); the book names rejected/throws only. Keep, or map both to the failure exit.
2. Persisted ref shape is additive (`current.persistedRef`, top-level `previousPersistedRef`); `previous` stays the capture ref.
3. Resolved mappings/previous are excluded from the caller fingerprint (absent stays absent; replay test proves it).
4. `failed` event `occurredAt` has no public reader — implementation-checked only.
5. Public order proof uses `src/a` + `src/a-inner`; exact literal pair only in the pure builder.
6. Two workspaces with byte-identical content make the later previous-observation load fail on stored chunk origin (gate test uses distinct trees). Pre-existing body-origin behavior; production note.
7. Z01 RED was timing-dependent (31 pre-fix runs passed); a temporary 1 s pause reproduced 41 vs 40, then the wait was added and passed repeatedly.