1. **VERDICT: reject.** Blocker (5) remains partly fixed.

2. **FINDINGS**

- **Major — user-visible: automatic-rework notices silently truncate.** [automatic-rework-notices.ts:72](D:/cxt/s5r2-rvfinal/src/core/work-graph/views/automatic-rework-notices.ts:72) and [line 116](D:/cxt/s5r2-rvfinal/src/core/work-graph/views/automatic-rework-notices.ts:116) ignore `lookupAll().truncated`. With 5,001 ended Runs and an automatic requeue belonging to a Run beyond the first 5,000, a notices-only query returns `ready` while omitting that notice. The outer pagination check cannot detect the truncated underlying scan. This breaks SPEC §4.1:772, T-R2-3 and lead T-R2-3a/b. **Fix:** propagate `capacity` from every overflowing underlying index lookup before projecting notices.

- **Minor — user-visible: candidate overflow returns the wrong rejection.** [plan-readers.ts:509](D:/cxt/s5r2-rvfinal/src/core/work-graph/tasks/plan-readers.ts:509) returns `incomplete`, propagated by the queue; [decision-read-model.ts:1143](D:/cxt/s5r2-rvfinal/src/core/work-graph/views/decision-read-model.ts:1143) returns `unavailable` for the equivalent direct request-card lookup. A request with 5,001 proposal records therefore receives neither required `capacity` response. This breaks SPEC §4.1:772 and T-R2-3/b. **Fix:** distinguish capacity exhaustion from missing data or an unstable window and propagate `capacity` through both entrances.

3. **BLOCKERS**

| Item | Status | Evidence |
|---|---|---|
| (1) Paused gate card remains answerable | **fixed** | `state/decision-policy.ts:238`; `tasks/goal-decision-reader.ts:362` |
| (2) Agent adoption attribution and application receipt | **fixed** | `agent-runtime/whiteboard-tools.ts:330`; `tasks/plan-service.ts:3425` |
| (3) Original receipts survive failing current-fact reads | **fixed**, under lead T-R2-1c | `business/workflow/decision-actions.ts:269`; `agent-runtime/communication-tools.ts:557` |
| (4) Formal closed-request head order | **fixed** | `tasks/plan-service.ts:1426`; `tasks/plan-readers.ts:733`; `views/decision-read-model.ts:1169` |
| (5) Capacity responses and 200-Goal limit | **partly** — Goal limit fixed; source overflow gaps above remain | `views/decision-read-model.ts:300`; findings above |
| N-R2-1 Workflow source answer lookup | **fixed** | `business/workflow/workflow.ts:1206`; `views/decision-read-model.ts:646` |

Paths in this table are relative to `src/core/work-graph/` unless they explicitly start with `agent-runtime/` (`src/core/`) or `business/` (`src/`).

4. **UNSPECIFIED**

[whiteboard-tools.ts:346](D:/cxt/s5r2-rvfinal/src/core/agent-runtime/whiteboard-tools.ts:346) converts a throwing `applicationReceipt` dependency into a successful committed result with `applicationReceipt:null`. T-R2-1 specifies absent dependencies and null results, but not exceptions. This is a reasonable choice, not a finding; the production composition already handles receipt-read exceptions similarly.

Static review only; no files changed and no tests run.