Rewrote all 24 cases in the four permitted files. No Node commands, tests, or typecheck were run.

**FILES**

- [S1-requeue.test.ts](D:/cxt/impl-s1-fx1/tests/work-graph/S1-requeue.test.ts)
- [S1-archive-owner.test.ts](D:/cxt/impl-s1-fx1/tests/work-graph/S1-archive-owner.test.ts)
- [S1-wait-disposal.test.ts](D:/cxt/impl-s1-fx1/tests/work-graph/S1-wait-disposal.test.ts)
- Created [S1-archive-service-fixture.ts](D:/cxt/impl-s1-fx1/tests/helpers/S1-archive-service-fixture.ts)

**PER CASE**

First-stub predictions below are based on static inspection.

- SV21 — REWRITTEN: claim → enter → register → result → final; first stub: `requestSessionArchive`.
- SV22 — REWRITTEN: result → responsibility disposal → barrier-controlled health write on S; first stub: `requestSessionArchive`.
- SV23 — REWRITTEN: send → yield → retire → dispose wait/link → final; first stub: `requestSessionArchive`.
- SV24 — REWRITTEN: real link/entry; repeat original request with changed choices; first stub: `requestSessionArchive`.
- SV25 — REWRITTEN: register → result → final → reactivate → replay; first stub: `requestSessionArchive`.
- SV30 — REWRITTEN: yield → transfer → cancel wait → respond → Kernel acceptance in D; first stub: `requestSessionArchive`.
- SV31 — REWRITTEN: transfer → failed wait-cancel → same-store reopen → retry/replay; first stub: `requestSessionArchive`.
- SV32 — REWRITTEN: saved response → transfer → D accepts original response; first stub: `requestSessionArchive`.
- SV33 — REWRITTEN: yield → retire → archive → late response; first stub: `requestSessionArchive`.
- SV34 — REWRITTEN: yield → retire → create continuation → archive → late response; first stub: `requestSessionArchive`.
- SV35 — REWRITTEN: three automatic requeues → register → cancel/deliver/observe → anchor; first stub: `requestSessionArchive`.
- SV36 — REWRITTEN: genuine archive stop/anchor, then nonexistent request origin; first stub: `requestSessionArchive`.
- SV37 — REWRITTEN: pause/deliver/reconcile → retired archive → anchor → dispose responsibility; first stub: `requestSessionArchive`.
- SV38 — REWRITTEN: archive stop/anchor → requeue → complete receipt replay; first stub: `requestSessionArchive`.
- SV48 — REWRITTEN: genuine archive stop with absent anchor; first stub: `requestSessionArchive`.
- SV49 — REWRITTEN: genuine r0 archive anchor → subsequent claims/results through r2; first stub: `requestSessionArchive`.
- SV50 — REWRITTEN: ordinary crashes and three automatic requeues; expected **passes in part 1**, exercising existing cap behavior.
- SV54 — REWRITTEN: real S Kernel acceptance/yield → transfer → delayed confirmation refusal; first stub: `requestSessionArchive`.
- SV55 — REWRITTEN: response → transfer/cancel → persisted D Kernel acceptance; first stub: `requestSessionArchive`.
- SV56 — REWRITTEN: final clears R, then original step replay; first stub: `requestSessionArchive`.
- SV57 — REWRITTEN: real send/yield → wait disposal/cancel → wait-origin requeue; first stub: `requestSessionArchive`.
- SV59 — REWRITTEN: ordinary failures → retirement → automated archive anchor → cap refusal; first stub: `requestSessionArchive`.
- SV60 — REWRITTEN: lose real committed-control response → reopen → original-pin replay → explicit delivery; first stub: `SessionArchivePort.archiveLine`.
- SV61 — REWRITTEN: fail cancel commit → competing pause → stale-pin recovery; first stub: `SessionArchivePort.archiveLine`.

**FINDINGS**

1. DONE — Removed `refusal.automation`; derive count from persisted chains.
2. DONE — Capture assertions use action deltas.
3. DONE — Dispose responsibility before final archive.
4. DONE — Register before deterministic cancellation; real delivery/observation, cap history and replay checks.
5. NOT DONE — Exact new refusal prefixes are unspecified; code, nonempty reason and zero-write observations implemented.
6. DONE — Genuine r0 evidence; request targets r2.
7. DONE — Latest ordinary failure comes from the result owner.
8. DONE — Real yielded wait; persisted anchor/ConsumedWait checks.
9. DONE — Real failure, then health-owner retirement and anchor.
10. DONE — Legal race on S; exact conflict pin and unchanged link cursor.
11. DONE — Compare encoded message independently of global cursor.
12. DONE — SV61 expects `partial`; fictitious waits removed.
13. NOT DONE — Durable recovery and explicit original-intent delivery covered; automatic archive-service delivery lacks a declared dependency.
14. DONE — Retirement/archive precede late replies; no invented disposition.
15. DONE — Retry failed wait-cancel on the same store; count both disposal steps.
16. DONE — Original body, handler, cancellation, acceptance and complete replay checked.
17. DONE — D consumes the original persisted response.
18. DONE — Observe actual persisted record/event/receipt deltas.
19. DONE — Acceptance uses D’s persisted Kernel event and exact identities.
20. DONE — Removed raw ordinary message, control, reconciliation and outcome writes.

**UNDETERMINED**

- SV22: literal post-read yield cannot be constructed after occupancy release and R blocking new claims. Uses a legal health write on S instead. Spec: §3.4, §5.3 line 967.
- SV36/SV48/SV49: exact forbidden reason prefixes are not specified. Spec: §3.4; lines 981, 993–994.
- SV60: automatic delivery is required at lines 246/1005, but `SessionArchiveDependencies` exposes no runtime delivery port.

**RISKS**

- [Fixture invariant call](D:/cxt/impl-s1-fx1/tests/helpers/S1-archive-service-fixture.ts:92): existing [I-12](D:/cxt/impl-s1-fx1/tests/state/invariants.ts:1372) derives requeue classification without archive context. This appears to conflict with valid archive interruptions; the checker is outside my edit scope.
- [Continuation preparation](D:/cxt/impl-s1-fx1/tests/helpers/S1-archive-service-fixture.ts:178) and [scripted Kernel acceptance](D:/cxt/impl-s1-fx1/tests/helpers/S1-archive-service-fixture.ts:380) were checked against current declarations and guards but remain execution-unverified.

Static checks confirmed 9/8/7 cases, retained backend parameterization, valid relative import paths, and no trailing whitespace.