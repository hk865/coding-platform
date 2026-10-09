FILES

Changed only these five assigned files and the permitted helper:

- [S1-provenance.test.ts](/D:/cxt/impl-s1-fx2/tests/work-graph/S1-provenance.test.ts)
- [S1-codecs-indexes.test.ts](/D:/cxt/impl-s1-fx2/tests/work-graph/S1-codecs-indexes.test.ts)
- [S1-session-facts.test.ts](/D:/cxt/impl-s1-fx2/tests/work-graph/S1-session-facts.test.ts)
- [S1-responsibility.test.ts](/D:/cxt/impl-s1-fx2/tests/work-graph/S1-responsibility.test.ts)
- [S1-dispatch-guards.test.ts](/D:/cxt/impl-s1-fx2/tests/work-graph/S1-dispatch-guards.test.ts)
- [S1-session-facts-fixture.ts](/D:/cxt/impl-s1-fx2/tests/helpers/S1-session-facts-fixture.ts) — created.

All 33 case IDs, file assignments, case counts and dual-backend suites are preserved. No Node, npm, npx, tests or typecheck ran. Results below are static predictions.

PER CASE

| Case | Status | Given and expected first part-1 failure |
|---|---|---|
| SV01 | KEPT | Frozen legacy bytes; missing decoder null defaults. |
| SV02 | REWRITTEN | Real creation, messaging, archive, control, anchor and Query entries; `requestSessionArchive`. |
| SV03 | REWRITTEN | Explicit old Outbox encoding; actual SQLite totals across reopen. Expected to pass: existing index behavior. |
| SV04 | REWRITTEN | Two real continuations and fixed copy derivation; missing provenance persistence/index results. |
| SV05 | REWRITTEN | Malformed decoder input and real admission with backend counts; missing decoder rejection. |
| SV06 | REWRITTEN | Real yield and historical Query claim; `readSessionFacts`. |
| SV07 | REWRITTEN | Real send/respond/yield/continuation claim with reverse-sorting ID; `readSessionFacts`. |
| SV08 | REWRITTEN | Saved response, real Work and Query claim attempts; `readSessionFacts`. |
| SV09 | REWRITTEN | Real response, archive request, disposal and cancel; `requestSessionArchive`. |
| SV10 | REWRITTEN | 2,501 complete executions through real entries; `readSessionFacts`. |
| SV11 | REWRITTEN | Two real executions, foreign cursor probes, write/model observations; `listSessionExecutions`. |
| SV12 | REWRITTEN | Old accepted operation, real completion/requeue/claim, injected reader; `backfillSessionProvenance`. |
| SV13 | REWRITTEN | Legacy Session predating requeue, real reuse claim; `backfillSessionProvenance`. |
| SV14 | REWRITTEN | Two real continuation creations and predecessor reads; `findSessionSuccessors`. |
| SV15 | REWRITTEN | Legacy creation/requeue evidence versus real consultation evidence; `deriveLegacySessionProvenance`. |
| SV16 | REWRITTEN | Real link, stopped writer and transfer; `transferSessionResponsibility`. |
| SV17 | REWRITTEN | Real running writer and refusal observations; `transferSessionResponsibility`. |
| SV18 | REWRITTEN | Real competing transfers, exact winner effects; `transferSessionResponsibility`. |
| SV19 | REWRITTEN | Formal completion/disposition histories; all four links submitted; `closeTerminalResponsibility`. |
| SV20 | REWRITTEN | Completed Run without Task satisfaction; `closeTerminalResponsibility`. |
| SV39 | REWRITTEN | Real copy message, fixed derivation and creation; missing persisted copy provenance. |
| SV40 | REWRITTEN | Real yielded wait and pending Query; missing Query wait guard. |
| SV41 | REWRITTEN | Real response and consumed-wait/archive race; `requestSessionArchive`. |
| SV42 | KEPT | Malformed archive execution encoding; missing decoder rejection. |
| SV43 | KEPT | Complete anchor with mismatched outer revision; `decodeSessionAnomalyAnchor`. |
| SV44 | KEPT | Cross-project provenance encoding; missing decoder rejection. |
| SV45 | REWRITTEN | Legacy cycle atop real creation/requeue history; `deriveLegacySessionProvenance`. |
| SV46 | REWRITTEN | Real close/reopen, exact event-location assertions; `deriveLegacySessionProvenance`. |
| SV47 | REWRITTEN | Registered w2 and genuinely created destination Session; `transferSessionResponsibility`. |
| SV51 | REWRITTEN | Real yielded wait, direct ordinary Work claim; missing Work wait guard. |
| SV52 | REWRITTEN | Real Session and archive request; `requestSessionArchive`. |
| SV53 | REWRITTEN | Real Work wait plus permitted old Query/pointer seed; `readSessionFacts`. |
| SV58 | REWRITTEN | Legacy child, real fixed derivation and pending consultation Query; `deriveLegacySessionProvenance`. |

FINDINGS

1. DONE — Legacy operations replace new-admission givens; backfill receives the real reader; SV13 checks saved basis.
2. DONE — Provenance observations use the owner’s backend.
3. DONE — Conflict/cycle counts fixed; SV46 checks the precise reopened-link event.
4. DONE — Planned copy and admission share one creation identity.
5. DONE — SV03 reads actual database totals before and after reopening.
6. DONE — SV10 creates complete Run/Attempt/Outbox histories.
7. DONE — SV08 calls real Work and Query claim entries.
8. DONE — SV06 uses real Query submission and claim; interpretation noted below.
9. DONE — SV07 uses real messaging; SV09 uses archive request/disposal before cancellation.
10. DONE — SV11 checks zero writes and zero model calls.
11. DONE — Ordinary message/response histories use mailbox entries.
12. DONE — The failed fourth link is submitted to terminal-close and remains unchanged.
13. DONE — SV47 creates its destination in registered w2.
14. DONE — SV41 verifies one winner, matching durable state and exact write deltas.
15. DONE — Dispatch givens use real entries; SV58 retains legitimate legacy data and an unclaimed Query.

UNDETERMINED

References below are to `slice-1-SPEC.md`.

- **SV06:** Line 951 requires Query-over-wait coexistence, while the new guard prohibits creating it. Setup uses the real Query entry without facts injection under L1’s preserved historical behavior (line 590); the tested reader is real.
- **SV05, SV11:** Lines 950 and 956 specify rejection codes but no exact reason prefixes.
- **SV18, SV39, SV41, SV52, SV58:** Lines 493, 984, 986, 997 and 1003 do not freeze the applicable CAS/copy/archive-request reason prefixes.
- **SV19, SV20:** Lines 471 and 964–965 do not specify the nonterminal close refusal code/prefix. SV20 specifies archive `busy`, but no corresponding prefix. These assertions avoid inventing those details.

RISKS

- Runtime validation remains outstanding. Lead should check the shared [Work entry/mailbox setup](/D:/cxt/impl-s1-fx2/tests/helpers/S1-session-facts-fixture.ts:257), [Query setup](/D:/cxt/impl-s1-fx2/tests/helpers/S1-session-facts-fixture.ts:322), and [w2 registration](/D:/cxt/impl-s1-fx2/tests/work-graph/S1-responsibility.test.ts:503).
- [SV10](/D:/cxt/impl-s1-fx2/tests/work-graph/S1-session-facts.test.ts:110) may be expensive: 2,501 real executions plus SQLite invariant snapshots after every fresh commit. Its 900-second timeout is unmeasured.
- Shared baseline fixtures retain their historical clocks; newly constructed row-specific owners use `t0`/`t1`.