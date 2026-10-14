| Problem | Fixed / not fixed | Evidence |
|---|---|---|
| 1 / D11: cross-Session window | **Fixed** | [continuation-brief-assembly.ts:249](D:/cxt/kA-review/src/core/agent-runtime/continuation-brief-assembly.ts:249) bounds the ordinary read by `endPosition ?? observedThroughPosition`; state and accepted messages use that window. Public regression assertions: [K-R-attested-facts-source.test.ts:305](D:/cxt/kA-review/tests/scenarios/K-R-attested-facts-source.test.ts:305). |
| 2 / D12: intermediate ancestor | **Fixed** | [context-assembler.ts:746](D:/cxt/kA-review/src/core/agent-runtime/context-assembler.ts:746) computes candidate-specific `sameSession` and searches nearest-first. The R1→R2→R3→R4 scenario asserts R2 and one hop at [K-R-attested-facts-source.test.ts:217](D:/cxt/kA-review/tests/scenarios/K-R-attested-facts-source.test.ts:217). |
| 3 / D13: test entry | **Fixed within specified scope** | Public preparation: [previous-turn-bounds:46](D:/cxt/kA-review/tests/composition/K-R-previous-turn-bounds.test.ts:46). Real Kernel closure followed by Runtime/Host observation: [observers-kernel-closed:59](D:/cxt/kA-review/tests/composition/K-R-observers-kernel-closed.test.ts:59), line 95. Health and D5/D6 cases use public-flow state from [K-t1-support.ts:60](D:/cxt/kA-review/tests/helpers/K-t1-support.ts:60). |
| 4 / D14: KA-05 refusal | **Fixed** | [K-interrupted-history.test.ts:429](D:/cxt/kA-review/tests/kernel/K-interrupted-history.test.ts:429) specifically matches `历史前缀包含当前 Turn`. |
| 5 / D15: exclusion/fallback assertions | **Fixed** | Archive and zero-closure assertions: [K-W-maintenance.test.ts:194](D:/cxt/kA-review/tests/scenarios/K-W-maintenance.test.ts:194). All four predecessor-archival assertions: [K-W-workflow-close.test.ts:445](D:/cxt/kA-review/tests/scenarios/K-W-workflow-close.test.ts:445), lines 477, 514, 573. |

**Must-fix items: None within the requested scope.** I found no additional production regression introduced by the two changed production files.

D10 is satisfied: new/rewritten Workflow scenarios assert their intended `start`, `open_checks`, or waiting settlement, including shared setup assertions at [common.ts:491](D:/cxt/kA-review/tests/scenarios/support/common.ts:491). They stop before checks. No rewritten case imports private assembly helpers or fabricates platform Session/Run/requeue records.

The report’s **UNSPECIFIED** items are acceptable with these qualifications:

- **D11 later tool fact:** acceptable; it verifies post-window exclusion and the recorded boundary.
- **D12 public cancel/requeue:** acceptable; R3 is demonstrably never entered.
- **D8 cancelled terminal:** acceptable for the recorded-end gate; it does not establish literal successful-completion coverage.
- **D8/D4 public routes:** acceptable; they reach preparation/observation through supported entries.
- **Earlier KA-12 doubles:** acceptable under the specifically scoped rewrite. However, the report’s whole-file “no fabricated records” claim is inaccurate: [K-R-close-open-turn.test.ts:68](D:/cxt/kA-review/tests/composition/K-R-close-open-turn.test.ts:68) still defines them.
- **Health placeholder:** acceptable for these read-failure cases; execution returns before health recording.
- **Provenance-null omission:** acceptable under D15’s explicit lead qualification.
- **No contradictory frozen tests:** none identified within this targeted review; I did not independently audit all frozen tests.

Read-only review; no edits, tests, or model calls performed.

**Verdict: merge**