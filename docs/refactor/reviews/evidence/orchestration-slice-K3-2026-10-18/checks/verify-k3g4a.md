# Verification of Codex's K3 g4a review (Claude subagent a88d3d50, 2026-10-17, read-only, no tests run)

File:line references are to `D:/cxt/k3g4a-review` (= `s9k3g4` tag `k3-g4a`, bb1b942).

| # | Item | Verdict | Rule |
|---|---|---|---|
| 1 | A failed review read counts as "no record" | PARTLY: code departs from the rule text and the three places disagree; production cannot reach it | L7 fail-closed (spec :265) |
| 2 | Wait-reply continuation not gated | PARTLY: only `unreadable` reachable, only by fault injection | L11 (:325), L7 (:265), D3 (:336) |
| 3 | release-hold reports a read failure as `requeue:null` | CONFIRMED | book §8.4 (ruling 4) |
| 4 | Replaying release-hold re-reads the derived requeue's pins | CONFIRMED (edge case) | L21 D9 "各自幂等" (:604), ruling 4 |
| 5 | L27 review-round exception missing | CONFIRMED as a missing dependency (no group was given it) | L27 (:711, :713) |
| 6 | Recovery tests weakened | CONFIRMED rows 3, 6, 8, 9, 11; PARTLY row 13 | K3-29 row (:1460) |
| 7 | K3-48 (三) no worst case, fact injection | CONFIRMED | K3-48 (三) (:1440), §5.1 (:1399), book §4 |
| 8 | Start-up 2b bypasses the owner; K3-47 memory only | CONFIRMED K3-47; PARTLY 2b | §5.1 "R4 两个后端" (:1389), book §4 |

## 1. Read failure treated as absence

- SQLite `readMany` checks the schema before the row (`sqlite-record-store.ts:359-363`): `unsupported` = the store
  registered no `UnknownCallReview` schema; `invalid` = malformed key (`:357-358`); damaged row = `corrupt`.
- Production always registers the schema (`create-platform.ts:578/589/600`); every service gets the full backend
  (`:849`, `:865`). Codex's counterexample needs a wrapper answering `unsupported` (a capability answer production
  never gives).
- The three places disagree: `plan-readers.ts:1739` treats `invalid` as unreadable; `claim-service.ts:1210` and
  `requeue-service.ts:472` still treat `invalid` as absent.
- The requeue owner reads the record a second time (`:468`, called at `:901`), outside the window, unguarded, although
  `readRequeueWindow` already has `window.canonical.unknownCallReview` (from `readCanonicalTaskFacts`, `:416`).
- The claim's probe read (`claim-service.ts:1205-1211`) exists only to tell absence from a store without the schema.
- Fixtures: no single shared schema registration. About 22 places list schemas without it — 9 helpers
  (`graph-session-fixture`, `S1-session-facts-fixture`, `S1-workflow-archive-fixture`, `S2C-D-node-support`,
  `S5-decision-fixture`, `S5-goal-settings-support`, `S5R2-c-support`, `S5R2-d-support`, `task-claim-fixture`) and about
  13 test files with their own list. 23 K3 test files already pass it through `additionalSchemas` into B2/task-claim,
  so adding it to `task-claim-fixture` needs a de-dup (else "duplicate record aggregateType"). DSH's "81" failing files
  is plausible (plan-readers marks every Run `unreadable`, AV-2b fires).
- Fix: (a) drop `invalid` at `claim-service.ts:1210`, `requeue-service.ts:472`; (b) delete `selectedReviewBlocker`
  (about −28), requeue owner uses `window.canonical.unknownCallReview` (about +8); (c) `unsupported`: A = treat as
  unreadable at `plan-readers.ts:1739`, replace the claim probe with a direct `expectedRevision:null` guard (−8),
  register the schema in the 22 places with a ~6-line de-dup in `task-claim-fixture`; B = keep the exception, post-note
  L7, one composition test that the production schema set contains `UnknownCallReview`.
- Tests: extend K3-47 (二) on both backends with a wrapper failing any `readMany` containing a review key with
  `{code:'unavailable'}`: ordinary claim `unavailable`; system and human requeue `unavailable`; no new Run, no
  `TaskRequeued`; task row `unknownCallReview:{status:'unreadable'}`.

## 2. Wait-reply continuation (`consumedWait`) not gated

- `task-machine.ts:896` gates only `first` and `requeue`; `run-machine.ts:666` continuation ignores `reviewBlocker`;
  unreadable read (`claim-service.ts:1213-1214`) adds no guard and refuses nothing.
- Reachability: a record exists only on a `crashed` Run (RUN-25, or RUN-22 whose attestation always ends `crashed`,
  `run-machine.ts:341`); a continuation needs the prior Run `YieldedWait` and the last lease holder
  (`claim-service.ts:399`), so `pending`/`held` are unreachable; only `unreadable` from a real read fault is reachable,
  and then the claim proceeds with neither refusal nor guard (breaks L11 "记录读不出时同样拦", L7, D3). Practical effect
  nil, rule text broken. Codex's side note is wrong: in K3-43 "接续" correctly means the requeue continuation.
- Fix: `task-machine.ts:896` condition → `claimBasis.kind !== 'review'`; `run-machine.ts:666` calls `pendingReview()`
  first. About 3 lines.
- Tests: state test (`k3-review-claim.test.ts`) continuation basis with `reviewBlocker:'unreadable'` → `unavailable`;
  owner-level, memory and SQLite: real yield + reply, continuation claim with the review-read fault wrapper →
  `unavailable`, no Run, zero writes.

## 3. release-hold hides read failures

- `core-routes.ts:909-910`: Run read fails/throws → `null`; `:915-916`: failed intent read leaves `pointer=null`,
  `reworkFenceOf` (`task-failure.ts:137-144`) returns `'none'`, `:918` returns `null`.
- Example: K3-41 setup (human-paused Run, attested, held); `releaseHold` commits, `readControl` fails once → response
  `{committed, requeue:null}`, task at AV-4 with no TaskRequeue. Ruling 4: `null` means "fence not human".
- Fix: both failures (thrown included) → `{status:'rejected', code:<read code or 'unavailable'>, reason}` in `requeue`.
  About 8 lines.
- Tests: business K3-41-style with a platform wrapper failing `controls.readControl` once →
  `{status:'committed', value:{hold:{status:'committed'}, requeue:{status:'rejected', code:'unavailable'}}}`, 0
  `TaskRequeued`; re-click with the same request id → `hold.replayed:true`, requeue committed, one continuation.

## 4. Replay re-reads the derived requeue's pins

- Request id stable (`core-routes.ts:935`), Goal and Run pins re-read every time (`:925`, `:938-939`); the requeue
  fingerprint includes the pins (`requeue-service.ts:832-833`); same identity + different fingerprint =
  `idempotency_conflict` (`sqlite-record-store.ts:526`, mapped at `requeue-service.ts:838`).
- Example: both steps commit, the Goal changes (pause, resume), the same release-hold is re-sent → `requeue:{rejected}`
  though the continuation exists. K3-41 (三) passes only because its first requeue never committed.
- Smallest correct design: TaskRequeue is keyed by `(task, afterRunId)` (`task-machine.ts:733`), its `since` bound to
  its creation cursor (`requeue-service.ts:1114-1116`). Add an owner read beside `readTaskRequeue` (~30 lines): read
  TaskRequeue(task, R) → `eventAt(since)` → decode `TaskRequeued` → compare `identityKey` with
  `identityOf(actor, scope, requestId)`; match → `{requeue, cursor}`, else `not_found`. The route (~10 lines) calls it
  first: hit → `{status:'committed', value:{kind:'requeued', requeue}, replayed:true, cursor}`; miss → fresh pins as
  today. A TaskRequeue from a separate `tasks/requeue` click falls through to a state refusal (still one continuation,
  row 13). No CAS change, no rotating ids.
- Tests: new K3-41 example on both backends: both steps commit, the Goal changes through a public route, the same
  request re-sent → `hold.replayed:true`, `requeue.replayed:true`, same TaskRequeue ref and cursor, one `TaskRequeued`.

## 5. L27 review-round exception missing

- `runtime.ts:271-277`: a paused-interrupted Run (RUN-24) needs a TaskRequeue with `afterRunId` = that Run (`:153`);
  review rounds are never requeued → always `continuation_not_authorized`.
- `session-maintenance.ts:422-433` (`closableWorkRun`) excludes paused Runs and also `takeover_unresolved` (Codex missed
  the second; L27's third bullet covers RUN-25 lines too).
- Group 2c built only L27's first bullet (RUN-25 in `closeOpenTurn`); no book assigned bullets 2 and 3; g4a's book does
  not name L27. A gap of groups 2/3, but g4a's L29 rows depend on it.
- Public scenario: K3-29 row 4b (`review_stopped`) → direct hold → release-hold (R is RUN-25, route only releases) →
  automatic requeue → `claimRequeued` → `close_open_turn{afterRunRef: round, requeueRef: TaskRequeue(R)}` refused →
  fallback to a new Session; L27 wants the same Session.
- Fix: `runtime.ts`, before the paused branch (~15 lines): if `run.purpose?.kind==='unknown_call_review'`, the ending is
  RUN-19/22/23/24, and the TaskRow from the existing `deps.plans.queryTaskGraph` read (`:153-161`) shows
  `unknownCallReview.ref == purpose.reviewRef` and `activeRound?.runRef.runId !== run.ref.runId`, authorize without a
  TaskRequeue. `closableWorkRun`: add `takeover_unresolved` and review-purpose RUN-24 (~6 lines).
- Tests: continue K3-29 row 4b through hold, release-hold and the continuation on the corrected fixture →
  `close_open_turn` `{status:'closed'}` with `afterRunRef` = round, claim in the round's Session, one `TaskRequeued`,
  final zero-write restart. Maintenance example: a retired line whose latest Run is RUN-25, no continuation →
  maintenance closes it; Session `available`, not archived.

## 6. Recovery tests weakened

- Rows 3 (clean :508; unresolved :634): accept "R's Session archived" instead of a close; the unresolved variant ends
  at a prepared second round (`:658`), no continuation, no card stop.
- Row 6 (`recovery-continuation.test.ts:119`): stops before `start`, no final restart; asserts a fallback Session
  (`:147-157`).
- Rows 8, 9, 11 (`:319`, `:354`, `:214`): no final restart; row 8 ends at a prepared round, no continuation.
- Row 13 (`K3-29-extras.test.ts:81`): pausing the Goal is a legitimate route to the durable state; but no restart and
  no final zero-write restart (PARTLY).
- Row 3's archive is not a production defect: `crashShellRun` releases the blocked shell inside the still-live
  in-process root right after the "crash" (`K3-29-recovery-round.test.ts:176-181`; called `:466`, `:580`); R's Kernel
  Turn finishes; the round-1 claim's close gets `already_terminal` (`sqlite-stores.js:625-626`) → runtime `mismatch`
  (`runtime.ts:358`) → fallback Session, E15 handover archives R's Session. The "PRODUCTION GAP" comment is
  contradicted: `closableWorkRun` ignores `purpose`, RUN-19/RUN-22 need no TaskRequeue (`runtime.ts:263-280`).
- Fix (tests only): release the shell seam after the flow in `finally` as K3-27 does
  (`K3-27-review-claim-close.test.ts:221-223`); remove archived branches; assert the close (Workflow or maintenance,
  `afterRunRef` = round 1) and the same Session; build row 8's definite failure the K3-27 "unsupported" way; drive
  every example to one continuation or the card/hold stop, then `expectQuietHarnessRestart`; row 13: a Host restart
  between the two steps and a final one.

## 7. K3-48 (三)

- One `process` item with 8 × 15,000-character paths (`K3-48-3-required-writes.test.ts:52-60`); record only checked
  `> 100_000` (`:132`); hold text `null` (`:145`); the over-MAX case rewrites the read result (`:170-185`) = fact
  injection of a state ruling 9 says a legitimate write never reaches. The near-threshold record itself is illegal (L7
  caps paths at 512 characters, :243; production gives `process` items no paths, `unknown-call-draft.ts:67/87/96`);
  admitted only through a codec gap (below).
- Smallest legitimate construction: the lead-ruled shared fixture `createK3LargeReviewRecord(kind)`
  (`tests/helpers/K3-large-review-input.ts:186`): 32 codec-legal process items through the real RUN-22 owner, memory and
  SQLite; pad legally toward B (512 three-byte characters per command summary, 32 `notVisible` entries; hand-compute
  the size). Assert `inventory:'complete'`, 32 items, created bytes ≤ 158,720; `settleReview{review_unavailable}`
  committed ≤ 524,288; `holdReview` with `text` = 2,000 three-byte characters committed ≤ 524,288; `releaseHold`
  committed ≤ 524,288. Delete the inflated-read case; add a pure `admitUnknownCallReview` case
  (`tests/state/unknown-call-review.test.ts`): a required write of 524,289 serialized bytes → `capacity`.

## 8. Start-up 2b and K3-47

- K3-47 memory only (`K3-47-claim-gate.test.ts:36` defaults to memory; `K3-47-reader-facts.test.ts:95` fixed to
  memory); the book allowed dropping only the SQLite twins of K3-43 and K3-48 (三). Fix: `describe.each(['memory',
  'sqlite'])` (~5 lines).
- 2b test (`K3-29-startup-reconcile-2b.test.ts:38` hand-built records; `:71` fakes `listReviews`) = fact injection by
  the book's rule. Real path partly covered (real-Host `report.reviews` in K3-29 rows 3 and 4b, K3-44 (二)).
  Recommended: make the states through real owners (RUN-22 → `needs_decision inventory_incomplete`; RUN-25/RUN-22 →
  `pending_review`; a direct hold with no round, not listed because `open='no'`) and read them through the production
  `listReviews` on the `open` index; keep one fault case (a wrapper fails page 2 → a `problems` line, page-1 lines
  stay). The 100×100 page bound needs a ruling (keep as a stated seam test, or drop; 10,001 real records is 2A-scale).

## What Codex missed

1. A fixture artefact behind rows 3, 6, 8, 9: the early release also happens in `recovery-continuation.test.ts:96-100`
   (in `finally`, straight after the crash). Because of it, row 6 asserts a fallback Session; under L12/K a RUN-25 R's
   Turn closes without a TaskRequeue and the continuation stays in R's Session (K3-27's success case). Row 8's
   "determined close failure" is the artefact. A state a real crash cannot create (AGENTS rule 4). Not run; one
   diagnostic run logging the round-1 `close_open_turn` receipt (expect `mismatch`) would confirm.
2. Codec gap on L7's per-path limit: `unknown-call-review-codecs.ts:319` checks at most 8 non-empty paths, not "每个 512
   字符" (:243). Fix: one line + an owner case where a draft with a 513-character path → `invalid`.
3. RUN-25 lines never closed by maintenance (`closableWorkRun` lacks `takeover_unresolved`): folded into item 5.
