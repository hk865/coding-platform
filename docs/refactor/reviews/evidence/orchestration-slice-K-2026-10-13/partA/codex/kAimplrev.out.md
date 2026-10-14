**Merge after the fixes below.** I made no file changes, ran no tests, and called no additional models. I accept the lead’s reported green WSL checks; the findings below come from source review.

“Spec” references [slice-K-SPEC.md](D:/cxt/kA-review/docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md).

1. **Must fix before merge — the brief reader can misreport an interrupted Turn and omit its facts.**  
   [continuation-brief-assembly.ts:168](D:/cxt/kA-review/src/core/agent-runtime/continuation-brief-assembly.ts:168), especially lines 180–234.

   Without a saved locator, reading starts at the beginning of the Session and stops after 5,000 records. If the target Turn starts later, line 210 reports `not_entered`. If its closure lies beyond that limit, the code can report `not_entered`, or fall back to the old watermark and report `running`/`paused` with zero omissions. That can also retain `lastAssistant`, because suppression depends on detecting `interrupted`.

   The reader also lacks the same-Session condition. For a non-interrupted Turn it bounds the reduced state, but collects accepted messages from the larger, unbounded-by-watermark `decoded` window.

   **Spec:** L9, lines 188–195; M5, lines 552–554.  
   **Fix:** use injected `readTurnBounds` to locate the exact identity and closure boundary; apply the new window only to qualifying same-Session continuations. Report truncation/unavailability honestly, and derive state and accepted messages from the same selected window.

2. **Must fix before merge — facts-chain selection can skip an attested Run that actually entered.**  
   [context-assembler.ts:726](D:/cxt/kA-review/src/core/agent-runtime/context-assembler.ts:726), interacting with [run-state-service.ts:904](D:/cxt/kA-review/src/core/work-graph/tasks/run-state-service.ts:904).

   The assembler selects the last ancestor before checking Kernel identity. The chain builder treats absence of `executionHistory` as “never entered.” Thus, if a requeued Run entered Kernel, lost its position acknowledgement, became unknown, and was then attested and closed, its next continuation can read an older ancestor’s facts instead.

   **Spec:** L9, lines 185–195; KA-09, line 429.  
   **Fix:** distinguish genuinely never-entered Runs from attested Runs with an existing Kernel Turn before choosing the facts source. Add a public continuation case with an entered, locator-less attested Run that itself has a requeue ancestor.

3. **Must fix before merge — concurrent closure can become a definite fallback failure.**  
   [sqlite-stores.ts:881](D:/cxt/kA-review/vendor/coding-agent/patches/storage/adapters/sqlite/sqlite-stores.ts:881), together with lines 205–221.

   Two callers can read the same open Turn. After one commits, the other encounters the deterministic record ID. `append` checks duplicate content **before** revision: differing timestamps or sequences produce `idempotency_conflict`, which `closeOpenTurn` converts to `unreadable`. Workflow then takes the new-Session fallback despite a successfully closed Turn.

   Separately, `already_closed` returns the header read before `readTurnBounds`; a closure between those reads can produce a closed position paired with a stale revision.

   **Spec:** L2 rows 3/6/7, lines 56–64; L7, lines 129–135.  
   **Fix:** reconcile append collisions against refreshed revision/Turn facts, returning the prescribed retryable conflict rather than unreadable; obtain a consistent current revision for row 3. Exercise the actual append race.

4. **Must fix before merge — observers do not implement L1’s no-write/report rule.**  
   [execution-observation.ts:547](D:/cxt/kA-review/src/core/agent-runtime/execution-observation.ts:547) and [query-observation.ts:394](D:/cxt/kA-review/src/core/agent-runtime/query-observation.ts:394).

   Both can confirm mailbox inputs before recognizing the exceptional interrupted state. The Work observer can additionally advance the locator and record `outcome_unknown` at lines 600–606. Otherwise, both can silently return `ready`; neither emits the required `kernel_closed_without_platform_end` report. The early guard in `run-reconcile.ts` is correct but does not cover these observers.

   **Spec:** L1, lines 43–46.  
   **Fix:** detect this inconsistent live-platform-Run condition immediately after reduction, before confirmation or other writes, and report it through the prescribed observation/report mechanism. This does not require database-corruption tests.

5. **Must fix before merge — M2 checks only one injected capability.**  
   [runtime.ts:262](D:/cxt/kA-review/src/core/agent-runtime/runtime.ts:262).

   Runtime reads `deps.kernel.closeOpenTurn`, but never reads injected `readTurnBounds`. If only the latter is absent, closure can still write instead of returning `unsupported`. Calling the patch’s lexical `readTurnBounds` internally does not satisfy the injected, call-time capability contract.

   **Spec:** M2, lines 544–547; L2, line 70.  
   **Fix:** resolve both injected functions at call time and refuse unsupported when either is absent. Test their availability independently.

6. **Should fix — an available Session’s `host_config` probe incorrectly triggers fallback.**  
   [runtime.ts:257](D:/cxt/kA-review/src/core/agent-runtime/runtime.ts:257).

   This returns `unsupported`, which Workflow treats as definite failure, rather than the specified retryable `transient`.

   **Spec:** L4, line 113; L7, lines 130–135.  
   **Fix:** map this probe result to `transient`.

The acceptance-test assessment follows. “Covered” means the assertions meaningfully exercise the stated behavior; it does not mean I reran them. KA-01–03 use the public-store interface explicitly prescribed by KE1; that exception does not extend to KE2.

| Row | Assessment, severity, and required correction |
|---|---|
| **KA-01** | **Covered.** [K-close-open-turn.test.ts:31](D:/cxt/kA-review/tests/kernel/K-close-open-turn.test.ts:31) checks append, cleared IDs, revision increment, unchanged preceding records, and manually specified event sequence/elapsed/payload. |
| **KA-02** | **Should fix:** [K-close-open-turn.test.ts:148](D:/cxt/kA-review/tests/kernel/K-close-open-turn.test.ts:148) derives expected bounds/positions from stored output, including lines 191–206. Replace those expectations with positions calculated from the handwritten fixture. Cases themselves are present. **Spec:** lines 398, 422. |
| **KA-03** | **Covered.** [K-close-open-turn.test.ts:243](D:/cxt/kA-review/tests/kernel/K-close-open-turn.test.ts:243) exercises the required starting states, pending/started tool outcomes, retry, and other terminal statuses. |
| **KA-04** | **Covered.** [K-interrupted-history.test.ts:126](D:/cxt/kA-review/tests/kernel/K-interrupted-history.test.ts:126) uses public Kernel execution and handwritten expected model history before/after closure. |
| **KA-05** | **Must fix before merge:** [K-interrupted-history.test.ts:198](D:/cxt/kA-review/tests/kernel/K-interrupted-history.test.ts:198) omits the third refusal. It **is publicly reachable**: close B, then call `runCodingAgent` with a fresh run ID, B’s turn ID, and a history cursor at B’s closure. [composition-root.ts:311](D:/cxt/kA-review/vendor/coding-agent/patches/app/composition/composition-root.ts:311) restores history before execution-content checks or append; the retained overlap guard rejects it. Add that case. **Spec:** line 425. |
| **KA-06** | **Must fix before merge:** [K-interrupted-history.test.ts:414](D:/cxt/kA-review/tests/kernel/K-interrupted-history.test.ts:414) verifies through checkpoint/store readback, including assertions at 427/446, outside KE1. The zero-tool claim is also vacuous: the fixture pauses before any model/tool work. Use permitted boundary write instrumentation and a replay fixture with tool work that must not execute. **Spec:** lines 397, 407, 426; M7. |
| **KA-07** | **Covered.** [K-W-workflow-close.test.ts:153](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:153), reinforced by the frozen paused-restart/WP1 flips, exercises public same-Session continuation and absence of fallback operations. |
| **KA-08** | **Covered.** [K-W-workflow-close.test.ts:338](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:338) and line 356 check new delivery and non-redelivery of accepted input, including public brief/model-input observations. |
| **KA-09** | **Must fix before merge:** [K-R-interrupted-brief.test.ts:19](D:/cxt/kA-review/tests/scenarios/K-R-interrupted-brief.test.ts:19) imports private assembly helpers and fabricates platform records. The ancestor test at line 294 supplies its own chosen `factsRecord`, so it cannot catch finding 2. The public “flow half” checks reuse but not the post-restart brief. Exercise each required variant through KE3 and `executions/brief`, with known message/steer/tool IDs. **Spec:** lines 408, 429. |
| **KA-10** | **Must fix before merge, partial coverage.** [K-W-maintenance.test.ts:29](D:/cxt/kA-review/tests/scenarios/K-W-maintenance.test.ts:29) covers RUN-19/24; KA-14 covers attestation; RUN-23 relies on frozen [A8-host-restart.test.ts:530](D:/cxt/kA-review/tests/scenarios/A8-host-restart.test.ts:530). The cited S1/WP1 business fixtures omit `turnClosure`, so they cannot catch the new insertion running for successor/archive/provenance exclusions. Add those cases with closure enabled. **Spec:** lines 430, 543. |
| **KA-11** | **Must fix before merge, partial coverage.** [K-W-workflow-close.test.ts:229](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:229) removes the database until explicit restoration, rather than failing exactly the next read once; it also does not explicitly assert `waiting`. Pin the specified one-shot boundary fault and waiting result. The health-written/restart and startup-recovery cases are useful. **Spec:** line 431. |
| **KA-12** | **Must fix before merge:** [K-R-close-open-turn.test.ts:124](D:/cxt/kA-review/tests/composition/K-R-close-open-turn.test.ts:124) tests Runtime responses using platform doubles, not the four KE4 workflows. [K-W-workflow-close.test.ts:314](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:314) covers disabled closure only. Add reachable cases for each required cause, checking new Session, handover/archive, and readable history or honest refusal. The defensive L2 row-5 exemption still applies. **Spec:** lines 409, 432. |
| **KA-13** | **Should fix:** [K-W-fallback.test.ts:41](D:/cxt/kA-review/tests/scenarios/K-W-fallback.test.ts:41) leaves closure disabled after restart. Handover replay is meaningfully checked, but re-enable closure before rebuilding Host to prove the predecessor remains protected when closure becomes available. **Spec:** line 433. |
| **KA-14** | **Must fix before merge, partial coverage.** [K-W-maintenance.test.ts:169](D:/cxt/kA-review/tests/scenarios/K-W-maintenance.test.ts:169) asserts a **confirmed** tool call. It does not prove that unknown-outcome steps reach the public continuation brief. Add the required unknown call IDs/statuses through KE3. The occupancy/attestation/same-Session flow is covered. **Spec:** line 434. |
| **KA-15** | **Must fix before merge:** [K-W-workflow-close.test.ts:59](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:59) decrements `expectedRevision`; it injects no concurrent append. Thus it misses finding 3 and the required append-time race. Inject at the Kernel store boundary and assert `waiting`, no fallback/archive, then recovery. **Spec:** line 435. |
| **KA-16** | **Covered across new and old tests.** [K-W-fallback.test.ts:82](D:/cxt/kA-review/tests/scenarios/K-W-fallback.test.ts:82) checks the open Query line; SES-10 coverage remains in [A8-host-restart-lease.test.ts:503](D:/cxt/kA-review/tests/scenarios/A8-host-restart-lease.test.ts:503). |
| **KA-17** | **Covered.** [K-R-runtime-capabilities.test.ts:76](D:/cxt/kA-review/tests/app/K-R-runtime-capabilities.test.ts:76) uses the public capability route and spec-derived wording. The production texts match M6, including the two specified replacements. |

For the five **UNSPECIFIED** items:

- **Owner position-window/reducer instead of `readTurnBounds`: not acceptable**—findings 1, 2, and 5 show substantive differences.
- **Missing Session → `readTurnBounds.unreadable`: acceptable.** Consistent with L2’s missing-Session classification; `not_found` describes a missing Turn within a readable Session.
- **Unusable successor enumeration → `transient`: acceptable.** It avoids treating an unproven absence as permission to close or create a successor.
- **Keep `lastToolGroup`/`toolCalls`, drop `lastAssistant`: acceptable.** The group retains an ID/count and tool facts, not raw assistant transcript.
- **KA-05 overlap refusal allegedly unreachable: not acceptable.** The public route described above reaches it before duplicate-record handling.

The remaining source paths support the intended design: interrupted reduction clears active work without invented results; history restoration skips interrupted content while retaining boundaries and identity checks; other history validation remains intact. M1’s absent dependency, Host-principal SES-13 wiring, and API version 3 are present. Maintenance preserves the human-paused RUN-24 line, and authorized continuation closes it before reuse.

I found no ordinary guarded path that closes an active/occupied, foreign-lease or lease-less, archived, archive-requested, or handed-over line, nor a Kernel entry that admits continuation over an unclosed Turn. The coverage gaps above limit how strongly the tests establish those conclusions. Keep the lead’s frozen flips; place the missing acceptance cases in the new K tests.

**Verdict: merge after listed fixes.**