# Lead notes for the final review

## Lead choices (binding for this review; spec/table gaps decided by the lead)
- T-R2-1b: PlanRevisionAccepted gets optional top-level `identityKey`/`fingerprint` ONLY when the acceptance carries a
  decision proof (attributed). Reason: T-R2-1 says the composition's `applicationReceipt` (create-platform.ts) reads
  identityKey/fingerprint saved in the event at the commit cursor; plan acceptance events did not save them. Unattributed
  events keep the exact old shape.
- T-R2-1c: the `record_decision_application` tool pre-reads the message pin first (the frozen R2D03 counts that read);
  on a pre-read failure (returned or thrown — lead fix LR3) it asks the owner's read-only `replayDecisionApplication`
  (same identity/fingerprint helper as `recordDecisionApplication`) and returns the original receipt; when the pre-read
  succeeds the owner itself looks up the receipt before reading (LB-2: the pin is not in the fingerprint).
- T-R2-2a: `since` on a PlanProposal record is the CHAIN's creation position (the first candidate's creating commit),
  copied to every later record of the chain (replacement candidates, accept, abandon); the closed card is the end of the
  chain with the latest `since`. Order is identical to per-candidate binding because the unique slot serializes chains.
- T-R2-3a: the Goal≤200 bound is the bound of the Workspace Goal listing; a notices-only read lists no Goals, so it is
  not rejected for >200 Goals (its notice sources have their own 25-page/5000-item windows, enforced).
- T-R2-3b: the 25-page/5000-item bound applies to each index lookup window (SPEC 772 "source lookup … 单次窗口"), as
  `lookupAll` enforces; the message source's three status lookups are three windows. Lead fix LR1: exactly 5000 items /
  exactly 25 pages with no further page is inside the limit.
- Area 3: the settings owner exposes a read-only `readGoalConflictReplay` (same fingerprint helper as
  `resolveGoalConflict`), reached through a local structural type because `GoalSettingsPort` was outside that area's
  write scope; create-platform passes the raw service.
- Area 1: the shared GV-5/coverage helpers live in `state/decision-policy.ts` (task-failure.ts unchanged); the paused gate
  branch re-derives GV-1..GV-10 without GV-0 inline.

## Earlier per-area reviews (Codex, read-only) and what the lead did
- Area 3: accept. Area 1: accept.
- Area 4: exact-5000 rejected (fixed: LR1/LR1b in goal-conflicts.ts); notices-only >200 Goals (T-R2-3a, no change);
  per-status message windows (T-R2-3b, no change); replacement origin (T-R2-2a, no change).
- Area 2: a THROWING pin pre-read skipped the replay (fixed: LR3); out-of-scope event fields (T-R2-1b).

## Known open item (spec-mandated, for the user later)
- `s5-message-by-workspace-status` indexes every SessionMessage of the Workspace; a long-lived Workspace with more than
  5000 read or responded messages makes every card-bearing queue read `capacity`.
