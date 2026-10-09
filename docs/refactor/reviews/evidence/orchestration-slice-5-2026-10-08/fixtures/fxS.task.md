# Group S: state unit rows (pure, no IO)

Read RULES.md first. You may change ONLY:
- `tests/state/S5-request-candidate.test.ts` (PC01–PC10, spec §5.2 + §3.1 S5-PLAN-01…05 + §2.4)
- `tests/state/S5-goal-settings.test.ts` (GS01–GS15, §5.2 + §3.1 S5-GS rows + §2.2/§2.8)
- `tests/state/S5-notice-settings.test.ts` (NS01–NS08, §5.2 + §3.1 S5-NT rows; the frozen signatures in §3.1)
- `tests/state/S5-message-decision.test.ts` (MD01–MD14, §5.2 + §3.1 S5-MSG rows + §2.3)
No new helper file. Do not touch `tests/state/S5-decision-policy.test.ts` (no findings). Unit rows use no
RecordStore, no clock; they call the pure state functions (and pure helpers named by the spec, e.g. the real
default readers/decoders, `goalDecisionBasisMatches`, `derivePlanProposalStatus`, `derivePlanProposalReadVerdict`).
These files today fail mostly with `not implemented` from the new transitions; keep that shape: assert the
row's complete expected next record AND effects, so that only a correct part-2 transition passes.

## Lead decision D2 applies here (see RULES.md)

The new plan events/effects are in `src/core/work-graph/state/plan-machine.ts` (search `S5-T3-D2`). Update the
events in this file (`requestedBy`, `at` on proposal_replaced/proposal_abandoned; `adoptionPolicy` in
`PlanRequestCandidateFacts`) and assert:
- PC01: `next` = U1 candidate@1 WITH `requestRef: Q1`, and effects contain exactly one
  `{kind:'request_slot', goalRef: B, requestRef: Q1, expectedOwner: null, nextOwner: U1}` plus the
  write_proposal / PlanProposalRecorded effects. (Today PC01 passes although production drops `requestRef` —
  `plan-machine.ts` `newCandidateProposal` around :1020: a false green. After your change it must fail in part 1.)
- PC02: `next` = U3 candidate@1 requestRef Q1; effects contain `write_replaced_proposal` whose record is U1
  `not_adopted` revision 2, `notAdopted = {reason:'replaced', requestedBy, at, replacedBy: U3}`, two
  `PlanProposalRecorded` append effects, and `request_slot` U1→U3.
- PC03/PC04: also assert no `request_slot` / no U3 construction (rejection has no next).
- PC06: adoption of U1 releases the slot (`request_slot` U1→null) besides the existing adoption effects; U2 stays
  stored candidate@1 and derives stale.
- PC08: U2 `not_adopted`@2 with `notAdopted = {reason:'abandoned', requestedBy, at, replacedBy:null}` and
  `request_slot` U2→null; no `abandoned` status.
- PC09: two null-request candidates: assert no `request_slot` effect on either.
- PC10 stays (genuine).

## Findings for these files (review-codex2.md defects 17, 29, 30, 31; PC items verified by the lead)

- `sPC:156` PC01 false green (above); `sPC:162` PC02 checks only U3, not U1's terminal value/slot transfer;
  `sPC:251` PC09 never checks slot effects.
- `sGS:142–151` GS01 requires a default `order0` WRITE: the row is a READ of an old Goal without `settings`
  (default after_plan_confirmation, order 0, wait null, risks []): read it through the real production default
  reader/decoder (find it: `persistence/record-codecs.ts` decodeGoal/… or the settings helper in
  `state/goal-settings-machine.ts`), no write builder.
- `sGS:282` GS14 manufactures its own proof: build captured B@7 and current B@9 that differ only in Goal control
  fields (desiredState/desiredStateRevision/…), call `goalDecisionBasisMatches(basis, current)` (true) and assert
  the settings migration's before is B@9 through the real transition.
- `sNS:68` NS01 uses a test-local fallback: read the legacy Workspace (no `decisionSettings`) through the real
  decoder/default and assert `noticeSeen = {}`.
- `sMD:206` MD01 checks its own flag: assert the transition's next record (pending@1, needsReply=true,
  response=null, recipient user, goalRef B, decision metadata) from real inputs.
- `sMD:349–356` MD11 builds and checks its own synthetic record: call the S5-MSG-03 transition
  (`synthetic_decision_answered`) and assert responded@1, sender = operator, syntheticAnswer=true from its next.
- Normalise identities to §5.1 (P/W, Goals A/B/C, PA1/PB1, Q1/Q2, U1/U2, T) where the files still use others.
- Source keys in MD rows via D1 `decisionSourceKey`.
