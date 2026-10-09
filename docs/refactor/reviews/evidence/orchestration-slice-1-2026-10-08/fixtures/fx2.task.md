# Group fx2: codecs and indexes, Session facts, provenance, responsibility, dispatch guards (work-graph services)

Read RULES.md first (same folder). Your files:

- `tests/work-graph/S1-provenance.test.ts` — SV12, SV13, SV14, SV15, SV45, SV46 (spec §5.3; §2.2; §3.3 `backfillSessionProvenance`, `SessionProvenanceFactsPort`; §0.2 T4)
- `tests/work-graph/S1-codecs-indexes.test.ts` — SV01, SV02, SV03, SV04, SV05, SV42, SV43, SV44 (spec §5.3; §2.1, §2.2, §2.8, §2.9)
- `tests/work-graph/S1-session-facts.test.ts` — SV06, SV07, SV08, SV09, SV10, SV11, SV53 (spec §5.3; §3.3 `SessionFactsPort`; §0.2 L1)
- `tests/work-graph/S1-responsibility.test.ts` — SV16, SV17, SV18, SV19, SV20, SV47 (spec §5.3; §2.4; §3.2 S1-LINK-01/02)
- `tests/work-graph/S1-dispatch-guards.test.ts` — SV39, SV40, SV41, SV51, SV52, SV58 (spec §5.3; §3.2 S1-DISPATCH-01/02)
- New helper allowed: `tests/helpers/S1-session-facts-fixture.ts` (only if needed).

## Lead decisions for this group (binding)

- **D4 (legacy givens).** "Old / legacy" Sessions (null provenance, old Operation, old Outbox, old Query pointer) are
  legitimately seeded as old-format records (spec §5.1 codec rule; SV01, SV03, SV12, SV13, SV15, SV45, SV46, SV53,
  SV58). Do not create them through today's admission when the row needs a legacy record: in part 2 a newly created
  Session gets `provenance: {kind:'new'}` or a continuation, so it is no longer legacy.
- **D5 (inject the reader).** Owners that need `SessionFactsPort` / the legacy provenance reader must receive the real
  instance (§0.2 L1: without injection the new sessions entries return `unsupported`). Build the directory / claim
  service under test with the real reader injected (in your helper if `tests/helpers/task-claim-fixture.ts` does not
  allow it; do not edit that helper).

## Findings for your files (from review-codex2.md)

1. SV12/SV13 (`S1-provenance.test.ts:264`): backfill calls `base.sessionsPort`, constructed without
   `legacyProvenance` (`tests/helpers/task-claim-fixture.ts:233`); the real reader created at `:155` is not injected
   → part 2 must answer `unsupported`. Also `createChild()` at `:224` uses today's admission → part 2 gives it
   `provenance: new`, so it is not the null-provenance legacy record SV12/SV13 need (D4, D5). Same legacy-given
   problem in SV15, SV45, SV46. SV13: the reused old Session must be a real old record whose `historySource` names
   another Session; expected backfill `new`, basis `no_reliable_predecessor`.
2. Provenance zero-write oracle (`S1-provenance.test.ts:272`) uses `base.spy` (the wrapped claim service), not the
   store the provenance owner writes; count records / events on the store.
3. SV15/SV45: legacy given and zero-commit counter as in 1 and 2. SV46: the initial link `since` must point at a
   later `linkChanged` (real close / reopen) on a legacy Session, and assert the exact event location used as basis.
4. SV04 (`S1-codecs-indexes.test.ts:495`, `:523`): `plannedCopy` derived from `s1-sv04-copy-1` but admission uses
   `s1-sv04-admit-copy-1`; derive both from the same creation identity.
5. SV03: the counters observe wrapper commits; assert actual before/after record and event totals of the database
   across the old-schema write and the new-schema reopen.
6. SV10 (`S1-session-facts.test.ts:216–233`): 2,500 Outbox candidates without their Run / Attempt records → a correct
   reader may reject on the missing Run before the page limit. Supply complete valid execution candidates (2501, 26
   pages) so that the page limit is the only failure; expected `incomplete` / reason prefix `session_facts_page_limit:`,
   not `wait = null`.
7. SV08 (`:343–344`): calls the pure helpers `workClaimDispatchProblem` / `queryClaimDispatchProblem`. Call the real
   Work claim and Query claim entries and observe their persisted effects (busy, nothing written).
8. SV06 (`:187–207`): the newest Query and its `lastExecutionRef` pointer are raw-written; SV06 is about a NEW Query
   covering the pointer → real Query claim. (SV53 is the old-pointer row: raw old pointer is right there.)
9. SV07: the message / response history is raw-seeded → real send / respond. SV09: the row's given is "the source wait
   was archive-cancelled" → use `requestSessionArchive` + `disposeArchiveWait` (stubs in part 1), not an ordinary
   cancel; expected wait null and the message response unchanged.
10. SV11: add zero-write and zero-model observations.
11. `S1-session-facts.test.ts:263` and `S1-dispatch-guards.test.ts:178`: ordinary message / response raw writes →
    real mailbox entries.
12. SV19 (`S1-responsibility.test.ts:447–456`): the fourth (failed, non-terminal) Task's link is never submitted to
    terminal-close, so "still open" proves nothing. Submit all four to the terminal-close path; three close (each keeps
    its `since`), the failed one stays open.
13. SV47 (`:487`): the foreign workspace is fabricated by rewriting D; create a real Session in workspace w2.
14. SV41 (`S1-dispatch-guards.test.ts:429`): the final occupancy assertion does not establish the R / claim / Lease /
    Run relationship; assert exactly one winner and, for the winner, the matching R or claim + Lease + Run, and no
    double occupancy.
15. SV39/40/51/52/58: several ordinary message / response givens are still raw-written (G1) → real entries. SV58 is
    the legacy-copy row: the old copy record without provenance is a legit legacy seed; the fixed message.child
    relation is saved; the Query not yet claimed.
