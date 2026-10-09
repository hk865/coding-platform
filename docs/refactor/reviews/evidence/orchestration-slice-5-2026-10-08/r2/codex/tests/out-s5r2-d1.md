**FILES**

- [S5R2-agent-application.test.ts](D:/cxt/s5r2-d1/tests/runtime/S5R2-agent-application.test.ts)
- [S5R2-driver-safe-point.test.ts](D:/cxt/s5r2-d1/tests/app/S5R2-driver-safe-point.test.ts)
- [S5R2-d-support.ts](D:/cxt/s5r2-d1/tests/helpers/S5R2-d-support.ts)

**PER ROW** — expected outcomes; tests were not executed.

- R2D01: Real Agent proposal → operator answer → attributed apply; asserts stored proof and receipt. RED at apply’s success assertion: strict schema rejects acknowledgementRef (`src/core/agent-runtime/whiteboard-tools.ts:211,351`).
- R2D02: Repeats D01, then records application; asserts revision +1, exact application, applied card, count −1. RED first at D01’s apply assertion, same source lines.
- R2D03: Repeats D02, then injects answer-read failure on same-callId retry; asserts fault reached, exact replay and zero writes. RED first at D01; afterward at retry success because pre-read rejection returns before owner replay (`src/core/agent-runtime/communication-tools.ts:556`).
- R2D04: Agent proposal and answer → operator adoption → real read tool; asserts original answer and zero writes.
- R2D05: Same proposal/answer, foreign-Workspace acknowledgement; asserts forbidden and zero writes.
- R2D06: Real Agent proposal → unattributed apply; asserts success and absent acknowledgement/proof/receipt keys.
- R2D07: Real reorder plus simultaneous starts sharing a Session; asserts B→A and exactly one ordering call.
- R2D08: Same with null Session hints; asserts B→A.
- R2D09: Ordering wrapper returns unsupported; asserts A→B and both handles complete.
- R2D10: Ordering wrapper throws; asserts A→B and both handles complete.
- R2D11: Scripted complete_task receipt and pinned observation; asserts ordering-call counts `[1,1,2]`.
- R2D12: B’s advance remains pending while A is stopped at admission; asserts A stopped without an advance call.
- R2D13: A’s advance remains pending before B starts; asserts A→B and A’s signal remains un-aborted.

**UNDETERMINED**

R2D01–R2D03: T-R2-1 does not specify the trusted answer/receipt-reader bindings absent from `WhiteboardToolsConfig` (`src/core/agent-runtime/whiteboard-tools.ts:62`). Flagged at runtime test line 103 for resolution before freezing; no API was invented.

**RISKS**

No Node, npm, tests, or typecheck ran, per RULES. Check the adapted fixture’s grant/entry first (`S5R2-d-support.ts:425,507`) and future draft (`S5R2-agent-application.test.ts:49`). Static checks confirmed imports resolve and fixture construction differs only by factory name and pre-entry grants.