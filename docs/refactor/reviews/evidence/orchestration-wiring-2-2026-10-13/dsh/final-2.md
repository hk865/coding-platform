**FILES CHANGED:**
src/composition/create-platform.ts
src/contracts/core/session.ts
src/core/agent-runtime/context-assembler.ts
src/core/record-store/commit-extensions.ts
src/core/record-store/ports.ts
src/core/record-store/record-codec.ts
src/core/work-graph/communication/decision-service.ts
src/core/work-graph/communication/mailbox-service.ts
src/core/work-graph/configuration/message-duties-adapter.ts
src/core/work-graph/model/communication-contracts.ts
src/core/work-graph/queries/query-execution.ts
src/core/work-graph/sessions/message-record-codecs.ts
src/core/work-graph/sessions/session-health.ts
src/core/work-graph/sessions/session-record-codecs.ts
src/core/work-graph/state/message-machine.ts
src/core/work-graph/state/session-availability.ts
src/core/work-graph/tasks/planning-question-reader.ts
src/core/work-graph/tasks/run-reconcile-service.ts
src/core/work-graph/views/context-extensions.ts
src/core/work-graph/views/undelivered-reply-notices.ts (new)
tests/composition/WP2-wiring.test.ts
tests/helpers/WP2-platform-support.ts
tests/record-store/WP2-notice-cursors.test.ts
tests/runtime/WP2-context-assembly.test.ts
tests/scenarios/WP2-wiring-scenario.test.ts
tests/state/WP2-positions.test.ts
tests/work-graph/WP2-context-extensions.test.ts
tests/work-graph/WP2-message-duties.test.ts
tests/work-graph/WP2-undelivered-notices.test.ts

**ROWS:** (row | test name(s) | RED message first seen | implementation file:symbol)
Z01 | `Z01 automatic world: after the member is interrupted…a notice appears, seen clears it, and SES-13 recovery keeps it out` | first session | create-platform.ts:createTargetPlatform; views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource
Z02 | `Z02 automatic advancement: a secretary member asks the user to decide…answering removes the card` | first session | create-platform.ts:createTargetPlatform
F01 | `F01 a real entered secretary Run calling send_user_message commits and leaves exactly one waiting decision card` | first session | create-platform.ts:createTargetPlatform
F02 | `F02 an executor and an ordinary reviewer Run may notify but a decision request is refused and leaves no card` | first session | create-platform.ts:createTargetPlatform
F03 | `F03 a read-only copy Session is refused at the real claim admission and produces no decision card` | first session | create-platform.ts:createTargetPlatform
F04 | `F04 after a successful tool request, broken role facts refuse the next request…` + `F04 a role-fact read failure rejects after an earlier successful duties read` | first session | configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter; create-platform.ts
F05 | `F05 a changed autonomy level reaches the new context read…` + `F05 the reader returns the real Goal autonomy saved by the owner` + `F05 the assembled Goal section shows the saved autonomy…` | first session | views/context-extensions.ts:createContextExtensionsReader; agent-runtime/context-assembler.ts:goalPayload
F06 | `F06 a waiting decision card becomes a decision reminder row…` + `F06 waiting-answer cards become L5 decision rows…` + 3 more | first session | views/context-extensions.ts:decisionRows; context-assembler.ts:optionalRowsFromExtensions
F07 | `F07 a focus task keeps a Goal-level decision card…` + `F07 focus keeps same-Goal task cards and Goal-level cards…` + `F07 the 5,000 input-card cap counts every card the queue returned…` | first session; fix RED `AssertionError: expected 'ready' to be 'rejected' // Object.is equality` | views/context-extensions.ts:decisionRows
F08 | `F08 the composition extension read serves the bound scope…` + `F08 an installed Goal-settings read failure fails the whole context read` + `F08 an invalid decision-queue read is returned unchanged…` + 3 more | first session; fix RED `AssertionError: expected { status: 'ready', value: {…} } to deeply equal { status: 'rejected', … }` | views/context-extensions.ts:createContextExtensionsReader
F09 | `F09 [memory|sqlite] a reply saved after its Session already became unavailable appears once and archiving keeps it` + `F09 a reply saved after the Session became unavailable appears once` + `F09 a derived Query Answer on an already-unavailable Session still becomes a notice…` | first session; fix RED `Error: {"status":"rejected","code":"incomplete","reason":"undelivered_reply_position_missing: <messageId> (Session <sourceId>)"}` | views/undelivered-reply-notices.ts:projectReply; create-platform.ts
F10 | `F10 [memory|sqlite] a reply saved before its Session becomes unavailable becomes a new unseen notice at the later health position` + `F10 a reply saved before the Session became unavailable becomes unseen when it later does` | first session | views/undelivered-reply-notices.ts:projectReply; create-platform.ts
F11 | `F11 marking one displayed notice leaves the later same-cursor notice and a later reply unseen, before and after a reopen` | first session | views/undelivered-reply-notices.ts:projectReply
F12 | `F12 [memory|sqlite] SES-13 recovery removes the notice and a later re-entry produces a new unseen one` + `F12 SES-13 recovery removes the notice…` | first session | views/undelivered-reply-notices.ts:projectReply
F13 | `F13 [memory]`/`[sqlite] archiving the unavailable member keeps the notice; a real execution accepting the reply removes it` | first session; memory backend added by fix | views/undelivered-reply-notices.ts:projectReply
F14 | `F14 the Work reply position equals the reply receipt cursor and survives a retry and an SQLite reopen` + `F14 the user-answer writer preserves its one response across a retry and an SQLite reopen` | first session; fix RED `AssertionError: expected 'undefined' to be 'c0000000022'` (then reported as an accepted spec-vs-existing-test conflict) | views/undelivered-reply-notices.ts; sessions/session-health.ts:recordSessionHealth; communication/mailbox-service.ts:commitPreparedSessionMessage
F15 | `F15 [memory|sqlite] a failed reply or health commit leaves no half state, and a committed reply recovers exactly once on retry` + `F15 [sqlite] a committed reply whose receipt was lost recovers exactly once after a reopen` | GREEN on first run (pre-existing test; not trivial: real pre-write store-commit fault on both backends, then replay-before-business-read with a stale expected revision) | create-platform.ts:createTargetPlatform; record-store/record-codec.ts:bindPreparedRecords
M01 | `M01 each of the five legacy platform templates resolves to its exact duty` + 3 more | first session | configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter
M02 | 8 tests under `M02 conflicting duty, identity and guard facts are rejected` | first session; fix tightened to exact-reason `toEqual` | configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter
M03 | 9 tests under `M03 role, Session and role-spec read failures never become a default duty` | first session; fix RED `AssertionError: expected 1 to be +0 // Object.is equality` (for the never-reads-the-Session case) | configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter
M04 | `M04 the same message+reply pair is deduplicated when its metadata agrees and refused when it conflicts` | first session; rewritten by fix | views/undelivered-reply-notices.ts:projectReply
M05 | `M05 old data missing a position blocks only its Goal; a damaged position is refused` + `M05 the source checks Host identity, cancellation and the explicit Goal before reading` | first session; fix RED `AssertionError: expected 'ready' to be 'rejected'` | views/undelivered-reply-notices.ts:readPage
M06 | `M06 an empty directory or reply page still follows its cursor to the later qualifying item` | first session | views/undelivered-reply-notices.ts:projectReply
M07 | `M07 exactly 5000 items succeed; one more is a capacity rejection without half a page` | first session | views/undelivered-reply-notices.ts:capacity guard
M08 | `M08 same-position items page by the complete key and an incompatible cursor is refused` | first session | views/undelivered-reply-notices.ts:page key
M09 | `M09 a changed window is retried as a whole and recovers; a stable mismatch fails after four attempts` + `M09 a message-level mismatch first rechecks the window and retries before reporting damage` | first session; fix RED `Error: {"status":"rejected","code":"unavailable","reason":"undelivered_reply_source_mismatch: <messageId> names another response"}` | views/undelivered-reply-notices.ts:stableDamage
M10 | `M10 a source_stale directory page reloads the whole window; four unstable attempts fail` | first session | views/undelivered-reply-notices.ts:window retry
M11 | `M11 an installed-but-empty source is available, a missing one is not_available, freshness is not_ready, and a read failure is not empty` | first session; freshness case added by fix | views/undelivered-reply-notices.ts:readPage
P01 | 5 tests in tests/state/WP2-positions.test.ts | first session | state/session-availability.ts:releaseSessionRecord/observeSessionHealthRecord; state/message-machine.ts:nextSessionMessageRecord

**CHECKS:**
- `npm run typecheck` → exit 0 (tsconfig.json + tsconfig.ui.json).
- `npm run check:architecture` → exit 0; "next source boundaries: OK"; no allowlist change.
- `npm run build` → exit 0; workbench published.
- `npx vitest run WP2-` → exit 0; **Test Files 8 passed (8)**, **Tests 86 passed (86)**. Per file: WP2-positions 5, WP2-notice-cursors 4, WP2-context-extensions 10, WP2-context-assembly 4, WP2-message-duties 22, WP2-undelivered-notices 17, WP2-wiring-scenario 2, WP2-wiring 22. Every §5.2 row id F01–F15, M01–M11, P01, Z01–Z02 has a test name starting with its id (the extra `W23` match is `W231`, E's helper test).
- 50-file regression run → exit 1; **Test Files 5 failed | 45 passed (50)**, **Tests 18 failed | 1184 passed (1202)**. Failures only: `tests/scenarios/A8-host-restart-entry.test.ts` (7), `A8-host-restart.test.ts` (3), `C6-unrelated-adoption.test.ts` (5), `S1-archive-restart.test.ts` (1), `WP1-wiring.test.ts` (2). All 18 are the bwrap kind and byte-identical in kind to the 18 in `DSH-BASELINE.md` (`expected 'waiting' to be 'stopped'/'completed'` ×14, `{| stopped:null |} to match {state:'completed'}` ×2, the two start-up re-drive messages). The 7 intended-RED tests now pass (`session-availability` 128, `S1-wait-disposal` 14, `state-writes` 19).
- `sha256sum` of the 10 frozen files → all ten match §3 exactly.
- `git diff --stat slice-base -- tests` → empty (no existing test file changed; all new test files are untracked).
- `git status --short` → 29 paths: 19 modified production files, the new `undelivered-reply-notices.ts`, and 9 new test/helper files. `.dsh-scratch/` and check logs removed. `git log` still shows the two commits.

**UNSPECIFIED:**
- Group E: done (W228–W230 + W231); no defects.
- Group A: done (W201; M01–M03, F04 read-failure half). M02's two/three resolved-conflict paths are unreachable through the real resolver (legacy `s3.1` revision fails `roleSpecRevisionFromBinding`; the adapter forces binding == pin before the resolver) and stay as documented failure-shape doubles; F04's "replay unchanged" half has no seam here and belongs to E1/D.
- Group C: done (W202, W203); the reviewer's real defect (a rejected/invalid decision read was swallowed into a `ready` context) is fixed test-first; the 5,000 cap now counts input cards; F06/F07/F08 call-sequence/count assertions rewritten at the public result; F08 Query-preparation gap closed.
- Group B: done (W205, W217–W223, W225–W227, W236). **Spec-vs-existing-test conflict:** spec §2.3 line 176 / §3 W2-P02 / §5.2 P01 require `nextSessionMessageRecord`'s `decision_answered` branch to set `responseSince:null`, but existing `tests/state/S5-message-decision.test.ts:260-262` asserts the exact old whole object (`toEqual` ignores `undefined`, not `null`). Kept the test passing; reported, not fixed.
- Group D: done (W204; W210, W239). `recordInputAccepted` is already declared on `SessionMailboxPort` (communication-contracts.ts:322) and §2 does not enumerate the composition's returned `messages` port, so it is kept; check:architecture and production-reach pass. Z01/Z02 could not be routed through the stock `tests/scenarios/support/common.ts` harness (fixed `AG2B_WORK_TOOLS` grant with no `send_user_message`; `HostScenario.direct()` has no Runtime/instance lease and no health route) — documented in the file header; Z02 does drive real automatic `workflow.advanceWork`. F13 forwarding and the F14 Query-Answer writer at E3, and F07 Task narrowing at E2, are documented as not constructible at those entries without out-of-scope fixture/host changes; their module entries (E4) cover them.
- **Out-of-§6 change (reported, not hidden):** `src/core/work-graph/tasks/planning-question-reader.ts` (+5). C's spec-correct strict propagation exposed a latent defect: the reader called `readInitialPlanAnswerFacts` on non-`initial_coordination` QueryJobs, which answers `rejected/code:invalid`, and that propagated out of the decision queue and made existing `IT20` (`S1-wait-copy-retirement.test.ts`) fail. The reader now skips non-`initial_coordination` jobs (a selection mismatch, not a read failure). Needed to keep the existing IT20 test green while satisfying spec §4.3.1/F08; flagging per spec line 417 ("give file:symbol, do not bypass checks").

**NOTES:**
- Subagents: F15 ×1; self-check reviewers ×5 (E, A, C, B, D); fixers ×4 (A, B, C, D). All finished and reported; none left running. F15 test pre-existed (mtime 21:11, before this session); the F15 subagent kept it and reported GREEN on first run with the reason (real store-boundary fault, both backends, replay-before-business-read); D later strengthened it (absent-field assertion + committed-but-receipt-lost reopen test).
- Reviewer findings, one line each: E — no defects (W231 is a shared-registration regression guard, in-memory only). A — M02 resolved-conflict tests implementation-coupled (premise falsified, tightened/documented instead of converted); M03 "never reads the Session" unprovable (fixed test-first); F04 replay half unscoped. C — rejected/invalid decision read swallowed into a `ready` context (real defect, fixed test-first); 5,000 cap counted rows not inputs (fixed); Task-pin guard stricter than spec (documented, unreachable); call-count/sequence assertions (rewritten); F08 Query gap (test added). B — `decision_answered` missing `responseSince` (blocked by existing test, reported); mailbox DTO gate lost derived Query-Answer positions (fixed without changing the frozen DTO); missing §4.4 window recheck (fixed test-first); missing Host/cancel/goalRef pre-checks (fixed test-first); writers JSON-parse discovery (documented); weak F09/F10/F12/M04/M11 assertions (rewritten, position-cursor literals asserted). D — `recordInputAccepted` scope (documented/kept); F15 gaps (fixed); Z01/Z02 harness and F13 forwarding/F14 Query-Answer/F07 narrowing (documented); missing F09/F10/F12 E3 rows (added); orphan JSDoc (removed).
- L-bwrap: the 18 expected bwrap failures remain; Z01/Z02 and the group-D drive stop before the unregistered `open_checks` check without bwrap, so no L-bwrap exception row applies.
- One unplanned extra production file (`planning-question-reader.ts`, +5) is the only path outside L-scope; everything else is within the §6 set.