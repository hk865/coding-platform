# Group 6: decision queue (DQ) and notices (NR)

Read RULES.md first. You may change ONLY `tests/work-graph/S5-decision-queue.test.ts`,
`tests/work-graph/S5-notices.test.ts` and create at most ONE new helper `tests/helpers/S5-queue-support.ts`.
The shared fixture `tests/helpers/S5-decision-fixture.ts` was just repaired by another group (read its header and
`fxA-result.md` here for the new exports). Do not edit it.

Spec: §5.3 DQ rows and NR rows (memory + SQLite), §4.1–§4.4 (seven sources, cards, conflicts, rework notices),
§2.5 (indexes, notice origin `since`, positions, display token), §3.1 S5-NT-01/02, §3.3 markNoticesSeen order and
pin set (Workspace), rules 8, 9, 20 of the part-1 book.

## Findings — DQ (defects 4, 11, 14; lead-verified where marked)

- DQ01 has no answered planning Query and (before the fixture repair) no overlap (`DQ:183`): checking six total
  cards cannot establish the six required KINDS. Seed each real source the row names (message, goal cause, two
  candidates, planning question from a REAL answered QueryJob whose saved answer parses as needs_decision —
  use the fixture's helper if `fxA-result.md` lists one, otherwise build it in your helper through the existing
  Query service and answer path — and the A/B conflict) and assert each card's kind, source key (D1), options and
  actions, and the honest `capabilities` for not_available sources (note_review, message_release).
- DQ02 (verified `DQ:164`): abandonment with `expected: []` — abandon pins = proposal + Goal; assert the setup
  result instead of ignoring a failed abandonment; establish the concrete Goal cause while the display title is
  RUNNING.
- DQ04 (verified `DQ:218–223`): archives Session S while Run RA still runs (`state/session-availability.ts:623`
  rejects occupied Sessions). Settle RA first through the fixture helper, then archive; the accepted message stays
  pending application with its original sender.
- DQ05 (`DQ:77`): the source key is built from an empty key: use D1 `decisionSourceKey({kind:'message',
  messageRef})`.
- DQ07 checks one closed history item only: assert every count/action change the row names (no answer/apply
  actions, read-only history).
- DQ09: reads every page; "changes nothing" = `storeSnapshot()` equal before/after, model calls 0 (a real counter),
  no message status/Workspace cursor change.

## Findings — NR (defects 15, 16)

- NR01/07/08 round chains are codec-accepted but not production-consistent: `NR:94` discards accumulated basis
  digests (the real successor construction appends predecessor history, `state/verification-machine.ts:650`);
  `NR:96–98` uses placeholder proof/configuration and revision-1 finalized rounds; supporting Runs are not seeded.
  Seed a possible successor chain with coherent supporting facts (accumulated history, correct revisions, the
  Runs), or produce it through the real requeue/reverify owners where they exist. NR07 must also assert that the
  task head points only at R4 while the notices list R2/R3/R4 with counts 1/2/3.
- NR04 (verified `NR:223–227`): the page delivered pos10 but `markNoticesSeen` submits pos20 under that token —
  a correct owner returns `invalid`; the row also never performs the message ack it is about. Perform a real
  message ack after the notice was created, show that the notice keeps its CREATION cursor, mark only delivered
  positions.
- NR06 (`:254–264`) expects `seenThrough` to stay pos10/undefined though the page returned m11/r12 — those are
  delivered-page watermarks, not saved settings: read saved settings separately (Workspace `decisionSettings`),
  save BOTH categories, reopen SQLite, and reread the stored messages (status/response/application unchanged).
- NR03 prefilters member notices (`:207`), avoiding the merged-page truncation condition: build the merged page
  with both categories and a limit that truncates, then show an undelivered rework item never enters the token or
  `seenThrough`, and a forged submission is invalid.
- NR08 inserts another record instead of changing the current cap (`:288`): change the actual current cap
  (policy) and show the old notice still reads cap null / 上限未记录.
- NR02 (read/mark/reread) and NR05 (corruption at the read boundary) are improved: keep.

## Lead measurements on the repaired fixture (2026-10-08 22:35, the copy)

- All 16 NR runs now fail at setup with `RecordSchemaRegistrationError: duplicate record schemaId
  VerificationRoundSnapshot@1`: the repaired fixture now registers the GoalPhase, verification and catalog schemas
  itself (see its header); the NR file still passes them again as additional schemas. Remove the duplicate
  registration in your file (or helper).
- DQ03 now fails with `expected { status: 'ready', … } to match object { status: 'not_found' }` (a setup read the
  file expects to be absent now exists, probably because the fixture adopts real initial plans with governance):
  re-check DQ03's given against the new fixture.
- The fixture does NOT provide an answered planning Query (see `fxA-result.md` UNDETERMINED): build it in your
  helper through the real Query path (submit → claim → frozen preparation/manifest → entry → Query-owned answer
  body → answered), or, if that is not possible with existing entries, list it under UNDETERMINED.
