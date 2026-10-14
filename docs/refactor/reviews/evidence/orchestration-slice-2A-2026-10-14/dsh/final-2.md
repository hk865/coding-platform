All checks complete. Here is the report.

## FILES CHANGED

**Production (L-scope):**
- `src/core/record-store/lookup-ports.ts`
- `src/core/record-store/lookup-index.ts`
- `src/core/record-store/in-memory-record-store.ts`
- `src/core/record-store/sqlite-record-store.ts`
- `src/core/work-graph/model/decision-contracts.ts`
- `src/core/work-graph/sessions/message-record-codecs.ts`
- `src/core/work-graph/tasks/claim-record-codecs.ts`
- `src/core/work-graph/persistence/evidence-record-codecs.ts`
- `src/core/work-graph/views/decision-read-model.ts`
- `src/core/work-graph/views/goal-conflicts.ts`
- `src/core/work-graph/views/automatic-rework-notices.ts`
- `src/core/work-graph/views/context-extensions.ts`
- `src/core/work-graph/views/undelivered-reply-notices.ts`
- `src/core/work-graph/tasks/plan-readers.ts`
- `src/core/work-graph/tasks/planning-question-reader.ts`
- `src/core/work-graph/communication/mailbox-service.ts`

**Production (OUT of L-scope — flagged, type/comment only):**
- `src/composition/commit-observer.ts`

**Existing test/helper files changed (P8 adaptations + R2):**
- `tests/helpers/S5-decision-fixture.ts` (P8: `S5OrderedRecords` forwarding `lookupOrdered`)
- `tests/work-graph/S5-notices.test.ts` (P8 known case `corruptOrigin` NR05 + `readRework` widened)
- `tests/helpers/S5-application-support.ts` (P8 cast)
- `tests/helpers/S5-queue-support.ts` (P8 cast)
- `tests/work-graph/S5-decision-queue.test.ts` (P8 signature widened)
- `tests/app/change-commit-observer.test.ts` (P8 unused `lookupOrdered` stub)
- `tests/work-graph/WP2-undelivered-notices.test.ts` (R2 setup re-pointing; see CHECKS/UNSPECIFIED)

**Added:**
- `tests/record-store/S2A-ordered-lookup.test.ts`
- `tests/work-graph/S2A-queue-bounds.test.ts`
- `tests/work-graph/S2A-queue-card-semantics.test.ts`
- `tests/work-graph/S2A-queue-derived-cards.test.ts`
- `tests/work-graph/S2A-queue-goal-runs.test.ts`
- `tests/work-graph/S2A-queue-request-candidates.test.ts`
- `tests/work-graph/S2A-queue-window.test.ts`
- `tests/work-graph/S2A-notices-attempt.test.ts`
- `tests/work-graph/S2A-notices-counts.test.ts`
- `tests/work-graph/S2A-notices-overbound.test.ts`
- `tests/work-graph/S2A-notices-rework.test.ts`
- `tests/work-graph/S2A-notices-since.test.ts`
- `tests/work-graph/S2A-notices-workspace.test.ts`
- `tests/app/S2A-decision-routes.test.ts`
- `tests/helpers/S2A-queue-fixture.ts`
- `tests/helpers/S2A-planning-fixture.ts`
- `tests/helpers/S2A-window-fixture.ts`
- `tests/helpers/S2A-notices-support.ts`
- `tests/helpers/S2A-notices-overbound-fixture.ts`
- `tests/helpers/S2A-route-storage-support.ts`

## ROWS

`row | test name(s) | RED first seen | implementation file:symbol`

- **QA-01** | `QA-01 memory/sqlite: text order is UTF-8 byte order, non-candidates never appear, and same-order rows continue by refKey`; `QA-01 memory/sqlite: rows with the SAME order value break ties by the UTF-8 bytes of the refKey` | first session, not recorded (new tie-break test: RED none) | `in-memory-record-store.ts:lookupOrdered`, `sqlite-record-store.ts:lookupOrdered`, `lookup-index.ts:ordered index`
- **QA-02** | `QA-02 memory/sqlite: inclusive and exclusive bounds…`; `…bound and after intersect…`; `…every malformed ordered request is invalid…`; `…registration rejects an unsafe orderBy path…` | first session, not recorded | `lookup-index.ts:decodeOrderedLookupRequest`, `orderedLookupPage`
- **QA-03** | `QA-03 sqlite: an ordered index built on existing rows finds them after reopen` | first session, not recorded | `sqlite-record-store.ts:lookupOrdered` + `SESSION_RECORD_SCHEMAS` registration
- **QA-04** | `QA-04 - 5001 member-to-member messages do not enter the queue; 3 waiting and 2 answered user cards remain` | first session, not recorded | `decision-read-model.ts:queryDecisionQueue` + `goal-conflicts.ts:listWorkspaceGoals`
- **QA-05** | `QA-05 - 5001 waiting cards on one Goal page to the end with limit 50, no duplicates and count 5001` | first session, not recorded | `decision-read-model.ts:queryDecisionQueue` (read-to-end)
- **QA-06** | `QA-06 - an unfiltered queue over 201 Goals is read; the hand-computed reason cards are unchanged` | first session, not recorded | `decision-read-model.ts:queryDecisionQueue` + `goal-conflicts.ts`
- **QA-07** | `QA-07 - 5001 planning jobs on one Goal still yield the question cards, count literal, no incomplete` | first session, not recorded | `decision-read-model.ts:readGoalQueue` + `planning-question-reader.ts:lookupKeys`
- **QA-08** | `QA-08 (a) - a cancelled Goal moves its waiting card to read-only history`; `QA-08 (b) - an answered-and-applied synthetic answer is applied history, not an open card` (planning/conflict cases covered by existing `S5-decision-queue.test.ts:226 DQ07`) | first session, not recorded | `decision-read-model.ts` card history/`readDecisionCard`
- **QA-09** | `QA-09 (一) - a derived planning card past the old 25x200 window is read by readDecisionCard`; `QA-09 (二) - 5001 candidates on one request resolve to the live head through card and queue` | first session, not recorded (QA-09二 dataset = R3 exception 3) | `decision-read-model.ts:readDecisionCard`/`findCandidateProposal`
- **QA-10** | `QA-10 30 requeues, 10 reverifies and 20 member notices: counts stay literal…`; `QA-10 (二) a 5,001-Session directory, 5,001 undelivered replies and 5,001 member notices page to the end without capacity` | first session, not recorded for (一); (二) pre-2A returned `capacity/undelivered_reply_page_limit:` past 50 pages | `automatic-rework-notices.ts:readAttempt/assembleAttempt`, `undelivered-reply-notices.ts:readAttempt/assembleAttempt`
- **QA-11** | `QA-11 legacy requeues without since order by occurredAt before the commit-position requeues` | first session, not recorded (exception-1 seed) | `automatic-rework-notices.ts` ordered+legacy requeue reads; `message-record-codecs.ts` index
- **QA-12** | `QA-12 two Goals of one project: each workspace read returns only the notices whose Goal lives there`; `QA-12 a cancelled Goal and a completed Goal both keep their notices` | first session, not recorded (2nd case re-verified) | `automatic-rework-notices.ts` workspace scope
- **QA-13** | `QA-13 a disposed waiting notification keeps its commit position and is not hidden by an earlier seen position` | first session, not recorded | `mailbox-service.ts:disposeArchiveWait` (`since` fix) + `decision-read-model.ts` built-in member source
- **QA-14** | `QA-14 (a) - the route returns the first page and a cursor, then pages to all 5,001 cards`; `QA-14 (b) - a storage read failure is carried out of the route, never an empty ready queue` | `expected 'not_found' to be 'ready'`; `expected { status: 'not_found' } to deeply equal { status: 'rejected', … }` | no production change (`src/app/core-routes.ts` route already forwards)
- **QA-15** | `QA-15 memory/sqlite: integer order is numeric, same-value pages continue by refKey, and non-integers are not candidates`; `…legal integer bounds are inclusive/exclusive exactly as asked`; `…request values of the wrong type, unsafe integers, fractions, NaN and Infinity are invalid` | first session, not recorded (new `after.order` cases: RED none) | `lookup-index.ts:orderedValueProblem` + RecordStore `lookupOrdered`
- **QA-16** | `QA-16 (一) - a commit in attempt 1 is retried…`; `QA-16 (二) - attempts 1-3 are interrupted and attempt 4 succeeds…`; `QA-16 (三) - four interrupted attempts report unavailable…` | first session, not recorded | `decision-read-model.ts` whole-window retry (`WINDOW_MAX_ATTEMPTS`)
- **QA-17** | `QA-17 - a Goal with 5001 Runs still yields its hand-computed reason card, no incomplete` | first session, not recorded (dataset = R3 exception 4) | `plan-readers.ts:readLookupKeys` + `goal-conflicts.ts`
- **QA-18** | `QA-18 the ordered reverify index names only the subject; the chain verifies and only new system rounds appear`; `QA-18b a legacy reverify whose persisted origin is the null placeholder is unavailable, not a cap-null success` | QA-18 first session, not recorded; QA-18b RED: pre-fix returned `ready` with `cap: 3` (both backends) | `automatic-rework-notices.ts:decodeCapOf/addRoundCandidate`; `claim-record-codecs.ts` ordered reverify index

**Group I** ran the section-8 targeted command and made no production change. **Group H** made no production change (see QA-14).

## CHECKS

| command | exit | result |
|---|---|---|
| `npm run typecheck` | 0 | `tsc --noEmit` both configs |
| `npm run check:architecture` | 0 | `next source boundaries: OK`; 7/8 module edges, 49 submodule edges |
| `npm run build` | 0 | `tsc -p tsconfig.build.json` + workbench published |
| `node scripts/build-kernel-patch.mjs --check` | 0 | all `matches: true` |
| targeted vitest (section 8) | 0 | `Test Files 21 passed (21)` / `Tests 186 passed (186)`; 445.89s |
| `npx vitest run` | 1 | `Test Files 48 failed \| 266 passed (314)` / `Tests 150 failed \| 6076 passed \| 29 skipped (6255)`; 523.43s |

- Full-suite failures: every one of the 150 is in `DSH-BASELINE.md` section A (`comm -23 <run failures> <baseline>` is empty); **no NEW failure**. The baseline's other 5 failures — `S5R2-queue-history` R2A07 (memory+sqlite), R2A09, `WP2-context-extensions` F07, `WP2-undelivered-notices` M07 — now **pass**, exactly the 2A flip. Plus the baseline's 1 sandbox failed suite `tests/state/invariants.test.ts` (29 skipped). Failed files (all baseline, sandbox kind), with failing tests: `A2-verification-chain` 8, `C7-supersede` 3, `C5-reverify-guards` 5, `A7-control-goal29` 2, `harness` 4, `C3-reply-other-session` 3, `C6-unrelated-adoption` 5, `C8-human-stop-respected` 2, `A2-requeue-platform` 5, `C3-brief-idempotency` 4, `A2-verification-chain-platform` 6, `C7-defer-reactivate` 3, `A8-host-restart-lease` 2, `change-emitters` 1, `A2-automation-verdict` 2, `A8-host-restart-entry` 7, `C3-paused-continue-brief` 1, `R5c-workflow-platform` 3, `WP1-wiring` 3, `A8-host-restart-rework` 2, `C8-budget` 1, `C3-not-entered-chain` 1, `S5-goal-conflict-rework` 1, `A4-duplicate-receipts` 4, `C5-gate-fix` 2, `C3-workspace-changed` 1, `R5b-initial-planning-workflow` 1, `A1-rework-same-session` 1, `C5-gate-fix-open` 1, `A2-reverify-route` 1, `MVP-workbench-tools` 1, `C8-auto-rework-cap` 1, `K-readonly-sandbox` 15, `A2-requeue-route` 1, `A2-reverify-platform` 1, `R3e-completion-platform` 1, `R3e-command-check-platform` 2, `A11-no-progress` 7, `R6-host` 1, `S1-archive-restart` 1, `A7-control` 14, `A8-host-restart-paused` 7, `orchestration-mechanism` 1, `A10-check-recovery` 6, `A8-host-restart` 3, `AG2b-collaboration` 2, `state/invariants-fuzz` 1.
- `sha256sum`: `DSH-BASELINE.md` `4133c9ee…` ✅; `S5R2-queue-history.test.ts` `0f3b59a9…` ✅; `WP2-context-extensions.test.ts` `348fe889…` ✅; `WP2-undelivered-notices.test.ts` `ff6cf385f3c94857eb088b262c283ba6276d723178713a7fa026840a51226e10` (changed only per R2).
- `git diff --stat slice-base -- tests`: 7 modified existing files (6 P8 type-only adaptations + `WP2-undelivered-notices.test.ts`), plus the new S2A files — not "only new files" literally, but each existing change is P8/R2-legal.
- `git status --short`: the 16 in-scope production files, `decision-contracts.ts`, the 7 existing test/helper files, and 19 new S2A files. The only out-of-L-scope production path is `src/composition/commit-observer.ts` (see UNSPECIFIED).
- `./.dsh-scratch/` deleted; no commit.

## UNSPECIFIED

- **L-scope:** done for every listed file. **Deviation:** `src/composition/commit-observer.ts` (lines 17, 33–36, 79–81) is a production file outside the enumerated L-scope. It is type/comment-only: `ObservableRecords` gains `RecordOrderedLookupPort` so the observed records type satisfies R1.4's non-optional ordered port. No runtime change (the spread already forwarded the method). Flagged for the lead.
- **L-caps (every §0.4 row):** removed — context-extensions 50-page/5,000-card + `capacity` (`context-extensions.ts:273–300`); undelivered directory 50 pages, per-line 50 pages, output 5,000 (`undelivered-reply-notices.ts:233–286`); decision-read-model per-source 25 pages/5,000 + per-source `capacity`, goal-limit 200 + truncation, message/answer/request-candidate truncation (loops now end on `next===null`); `goal-conflicts.ts` `lookupAll` cap 5,000; `plan-readers.ts:readLookupKeys` 25 pages; `planning-question-reader.ts` 25 pages; `automatic-rework-notices.ts` ended-Run/round window `capacity`. Kept — `SOURCE_PAGE_LIMIT=200`, `DECISION_PAGE_LIMIT=100`, queue page 1–100, `LOOKUP_PAGE_LIMIT=200`, ordered per-page 1–200, request `page.limit` 1–200, whole-window 4 attempts, `ROUND_CHAIN_MAX`, write-size caps, and `context-extensions.ts:LOOKUP_MAX_PAGES=25` (anomaly anchor, not on the queue path). §0.4 row 5: `findSessions` is no longer read for the listing (R1.5); `findSessions` itself is unchanged for its other callers.
- **L-tdd:** done. Two residual non-literal expectations a reviewer flagged: `S2A-notices-counts.test.ts:102–103` continuation sequences are the source's own first-page output (itemKeys embed generated run/message ids, so hard-coded literals are not cheaply possible; counts and uniqueness remain literal); `decisionSourceKey`-derived identities in some Q tests. Not fixed; reported.
- **L-fixtures:** exception 1 QA-11 (`S2A-notices-support.ts:104–122`), exception 2 QA-16/QA-14 (`S2A-window-fixture.ts:57–92`, `S2A-route-storage-support.ts`), R3 exception 3 QA-09(二) and exception 4 QA-17 (`S5-decision-fixture.ts:533` normal `records.commit`, real codecs, public reads). All three R3 conditions hold (codec-decodable, normal commit API, public-read assertions). QA-10(二) overbound: 5,001 Sessions/replies/member notices via real `admitSessionCreation/recordSessionCreated`, `sendMessage/respondMessage`, `recordSessionHealth`, `sendUserMessage`; the only `seedCommit` is the governance checkpoint also used by the frozen `noticeWork`.
- **L-reach:** passes (reviewer ran the analyzer: unreached-not-allowlisted none; production callers exist).
- **L-interfaces:** `RecordOrderedLookupPort`, `lookupOrdered`, `orderBy.valueType 'text'|'integer'` done; five new indexes registered in the three codec files.
- **L-state:** no state row added; state changes still via `src/core/work-graph/state/`.
- **Frozen-test conflict (R2):** the lead named only the two `M10` tests, but `M04` and `M05` also scripted `sessions.findSessions`; after R1.5 their injection would be ignored and the frozen file would be red (`M05`: `expect(affected.code).toBe('incomplete')` → `'unavailable'`; `M04`: `expect(page.status).toBe('rejected')` → `'ready'`). The lead's R2 principle was applied to them too: setup-only re-pointing to `records.lookup` of `SESSION_BY_WORKSPACE_LOOKUP`. A verifier confirmed 137 `it/test/expect(` lines are byte-identical (normalized diff empty); only the import and the M04/M05/M10 setup differ, with comment wording changed only where the old text named `source_stale`.
- **Self-check fixes:** QA-01 refKey tie-break added (RED none; production already `Buffer.compare`/`COLLATE BINARY`); QA-15 `after.order` 2^53/NaN/±Infinity added (RED none); `decodeCapOf` fixed so a failed `decodeNoticeOrigin` returns `unavailable` (QA-18b, RED observed), while a decoded origin with no cap still yields `cap: null` (NR08 preserved). QA-08's planning/conflict cancellation is covered by existing DQ07.
- **Minor, not fixed:** QA-06 passes `limit:500` (reader clamps to 50); `S2A-notices-attempt.test.ts` is implementation-coupled on the ordered-read count (the intended L11 proxy); QA-12/QA-18 call the source directly rather than through `markNoticesSeen`.

## NOTES

1. Subagents this session: Group N follow-up (R1/R2), Group I integration, three read-only self-check reviewers (O, Q+H, N), and one surgical self-check-fix rework.
2. Group I's post-fix targeted run: 21 files / 186 tests, exit 0, 445.89s; full suite has no NEW failure.
3. Headless run stayed in-turn; every subagent finished before this reply.
4. No `.dsh-scratch/`, no commit, no git writes.
5. Slowest 5,001-scale test: QA-10(二) memory 263.4s / sqlite 180.3s; file 443.6s (P12 cap 600s).
6. The only unresolved lead decision is the `commit-observer.ts` out-of-scope type change and the R2 extension to M04/M05.
7. The first session's O/Q RED logs were not recorded; new tests captured RED where they failed.

## R-RULINGS

- **R1 — done.**
  - **R1.1 QA-10(二):** `tests/work-graph/S2A-notices-overbound.test.ts:23` (+ `tests/helpers/S2A-notices-overbound-fixture.ts`), 5,001 Sessions / 5,001 replies / 5,001 member notices through public services; P11's 2,001-link case dropped. RED: old source returned `capacity/undelivered_reply_page_limit:` past 50 pages. Impl `undelivered-reply-notices.ts:readAttempt/assembleAttempt`.
  - **R1.2 QA-12 second case:** `tests/work-graph/S2A-notices-workspace.test.ts:42`, each Goal its own assertion; passes.
  - **R1.3 L11 cache:** `automatic-rework-notices.ts:172–175, 288–289, 297–304`, key workspace+goal+category; `S2A-notices-attempt.test.ts` passes.
  - **R1.4 P7 inline type:** `automatic-rework-notices.ts:64–66` `Pick<S5RecordPort,'readMany'|'lookup'> & RecordOrderedLookupPort`; runtime `lookupOrdered === undefined` probe removed; no alias in `decision-contracts.ts`. Cost: the out-of-scope `commit-observer.ts` type widening + P8 caller/double adaptations.
  - **R1.5 P3 Session listing:** `undelivered-reply-notices.ts:234–249` uses `records.lookup(SESSION_BY_WORKSPACE_LOOKUP)` in key order and decodes only Session health; `findSessions` never called; `sessions` stays declared with a comment.
- **R2 — done, extended.** The import + M04/M05/M10 setup injections in `tests/work-graph/WP2-undelivered-notices.test.ts` were re-pointed to `records.lookup` of the Session index; assertions/names byte-identical (normalized diff empty), comments changed only in M10 where they named `source_stale`. The lead named only the two M10 tests; M04/M05 also scripted `findSessions` and are included so the frozen file stays green (justification and exact failing assertions above). File diff is 86 lines; the lead re-freezes it.
- **R3 — done.** QA-09(二) (`S5-decision-fixture.ts:1024/533`) and QA-17 (`S2A-queue-goal-runs.test.ts:46`) are the two accepted storage-boundary datasets (exceptions 3 and 4); each seeded record is decode-able by today's codecs, written through `records.commit`, and asserted only through public reads. Measured public alternatives: the first session recorded them as quadratic/infeasible and left no measured time; both exceptions are listed in UNSPECIFIED.
- **R4 — done except the R2 file.** `DSH-BASELINE.md`, `S5R2-queue-history.test.ts`, `WP2-context-extensions.test.ts` sha256 match exactly. `git diff slice-base -- tests/work-graph/WP2-undelivered-notices.test.ts` touches only the import and the M04/M05/M10 setup injections (assertions/names byte-identical) — i.e. the two M10 tests **plus M04/M05**, as justified under R2.
- **R5 — done.** Group I integration ran the section-8 targeted command (21 files/186 tests, exit 0). One read-only reviewer per O, Q+H, N ran; the owning areas were fixed by a follow-up subagent (QA-01 refKey, QA-15 `after.order`, `decodeCapOf`).

**Wall time of every 5,001-scale test** (post-fix targeted run; file if a whole file took >60s):

| test | memory | sqlite |
|---|---|---|
| QA-04 (5,001 member messages) | 9.2s | 25.8s |
| QA-05 (5,001 waiting cards) | 107.3s | 91.0s |
| QA-06 (201 Goals) | 1.0s | 9.8s |
| QA-07 (5,001 planning jobs) | 6.0s | 6.0s |
| QA-09(一) (past 25×200) | 2.8s | 2.5s |
| QA-09(二) (5,001 candidates) | 4.2s | 15.4s |
| QA-10(二) (5,001 Sessions/replies/member) | 263.4s | 180.3s |
| QA-14(a) (5,001 cards via route) | 95.1s | 70.7s |
| QA-17 (5,001 Runs) | 3.1s | 13.9s |
| F07 (frozen; 5,001 waiting cards) | 97.8s | — |
| M07 (frozen; 5,001 replies) | 122.4s | — |
| R2A09 (frozen; 5,001 requests) | 108.6s | — |

Whole files >60s: `S2A-notices-overbound` 443.6s, `S2A-queue-bounds` 234.5s, `S2A-queue-derived-cards` 207.4s, `S2A-decision-routes` 204.8s, `S2A-notices-attempt` 17.7s+ (L11 201-requeue, not 5,001). All under the 600s per-test cap.