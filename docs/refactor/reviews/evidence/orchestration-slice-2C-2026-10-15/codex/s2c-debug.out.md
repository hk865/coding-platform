**Must fix before merging 2C**

1. **Repair (3)’s remaining construction gap.** Awaiting `xAdvance` fixes the revision race, but the test still does not exercise its advertised ordering. Starting X runs maintenance, which closes Y before X is dropped (`src/business/workflow/workflow.ts:2046`, `src/business/workflow/session-maintenance.ts:590`). Thus `tests/scenarios/S2C-K-archive-tags-checks.test.ts:166` incorrectly claims the archive closes Y afterward.

   Concrete fix: after X’s advance settles, reopen S→Y’s `responsible` link through `sessions/link(active:true)`, using fresh public Session/link revisions; immediately submit `sessions/archive-line`, dropping only X. The public link writer supports reopening (`src/core/work-graph/sessions/session-lifecycle.ts:535`). Check through public responses that Y was open before archiving and closes after X. Retain literal `plain / standby / complete`. This restores the required “newer terminal closure must not conceal the drop” case.

2. **Update the contradictory descriptions and specification post-notes listed below.** Keep X; do not apply Y.

**Should fix / follow-ups and diagnosis**

**A8-3n: the diagnosis and ruling are correct.** Startup reconciliation invokes maintenance before re-drive (`src/app/startup-reconcile.ts:343`); the captured log already shows S1 archived immediately after restart (`.lead-ref/logs/out-a8n-base2.txt:5`). Closure returns `unsupported`; maintenance falls through. Item 10 supplies the open responsibility, and `pausedIntentRef:null` makes this a clean RUN-19 interruption, so the exemption fails and retirement archival applies (`src/business/workflow/session-maintenance.ts:473`, `src/business/workflow/session-maintenance.ts:615`). S1’s archived lifecycle subsequently selects the ordinary-selection branch (`src/business/workflow/workflow.ts:1074`).

No frozen text, read together, requires Y. `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md:155` expressly preserves existing archival logic after definite failure; `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md:161` gives archived Sessions ordinary selection. `docs/refactor/HANDOFF.md:165` supplies the anchor/drop, and `docs/refactor/HANDOFF.md:175` explicitly permits reuse. Decision 54 protects RUN-24, not this resumed RUN-19; decision 45’s occupied/unknown exception also does not apply. S1-AUTO-02 agrees (`docs/refactor/STATE-MACHINES-SPEC.md:5287`). Y would introduce an additional maintenance exemption.

The **new X assertions** follow these rules and scripted facts: idle reuse, `retired_archive`, Run1’s single edited path, and Run2 picking up the anchor. History seeding remains valid because the idle Session has an empty cursor and the same adapter (`src/core/agent-runtime/context-assembler.ts:669`). Strictly, the whole existing test is not exclusively an independent oracle: `tests/scenarios/A8-host-restart-paused.test.ts:499` uses production `continuationBriefMarker` and copies `throughPosition` from the returned brief. Those check consistency, not the independently correct boundary; that limitation predates X.

Required replacement meanings:

- `tests/scenarios/A8-host-restart-paused.test.ts:20`, `tests/scenarios/A8-host-restart-paused.test.ts:65`, `tests/scenarios/A8-host-restart-paused.test.ts:390`, title :391: unsupported closure here leads to retirement archival and ordinary reassignment.
- `tests/scenarios/A8-host-restart-paused.test.ts:400`: Run2 runs in the reused idle Session, not a newly created continuation Session.
- `tests/scenarios/A8-host-restart-paused.test.ts:430`: unchanged maintenance archives S1, drops responsibility, and writes the anchor.
- `tests/scenarios/A8-host-restart-paused.test.ts:461`: the ordinary claim must reuse the eligible idle Session.
- `tests/scenarios/A8-host-restart-paused.test.ts:465`: re-drive requeues uncounted and claims idle; no `create_session{requeue}`.
- `tests/scenarios/A8-host-restart-paused.test.ts:480`, :504: say “another, reused Session”; exclusion of S1 remains correct.
- `docs/refactor/STATE-MACHINES-SPEC.md:2629`, also :1067/:5622: archived/excluded branch takes precedence; mandatory creation applies only to the remaining eligible fallback branch. Reuse does not *always* lose history—empty-cursor, same-adapter reuse can seed it.
- `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md:178`: qualify creation/handover by L7’s selection precedence; already-archived predecessors undergo ordinary reassignment.

**Checks (3)–(5).** Their reported failures are construction/expectation problems, not evidence of a 2C product defect:

- **(3):** stale revision; synchronization fixes it, but ordering coverage still needs the repair above.
- **(3′):** sequential claims close earlier terminal links, leaving X’s drop newest; DE3 correctly yields `complete`. The rebuild—drop X, reactivate, complete 21 distinct Tasks on S—faithfully creates 22 closures with X outside the newest 21, yielding DE5 `incomplete / done_unproven` (`tests/scenarios/S2C-K-archive-tags-checks.test.ts:188`).
- **(4):** goal-level advance reclaims the dropped Task elsewhere; completing it again on S would overwrite that link interval. Two distinct Tasks plus `sessionHint` correctly preserve the old drop (`tests/scenarios/S2C-K-archive-tags-checks.test.ts:260`). Expected DE3 is `complete`; the unclaimed anchor also gives `anomaly_pending`. Current assertions only check `plain/standby`.
- **(5):** crashed P must hit A1 `retired` before A3. Healthy P plus actual handoff transfer correctly exercises `handed_to` (`tests/scenarios/S2C-K-archive-tags-checks.test.ts:300`, `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1122`).

These rebuilt label checks use literal expectations, public reads/writes, and no database or production-function oracle. Add post-notes to `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1302`: (3) requires deliberately preserving/reopening Y; (3′) uses ordered reconstruction; (4) requires a distinct Task to retain the old close; (5) requires healthy P. Qualify `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1492` and L1a: retained link closures are not an append-only interval history.

**Other findings:**

- **(a) Confirmed, pre-existing since K `cfe355509`, medium-severity maintenance liveness bug.** Runtime counts handoffs (`src/core/agent-runtime/runtime.ts:183`); maintenance facts count only continuations (`src/core/work-graph/tasks/session-facts.ts:297`); `handed_over` repeatedly skips (`src/business/workflow/session-maintenance.ts:467`). Smallest sound fix: reread facts after this refusal and re-enter normal maintenance decisions **without retrying closure during that evaluation**. Preserve continuation HM01/HM02 behavior; do not relabel handoffs as continuations or blindly archive using stale facts. This is a K follow-up, not a demonstrated 2C regression.
- **(b) Confirmed:** `runMaintenance` uses a runtime-less direct root, eight days later (`tests/helpers/S2C-K-scenario-support.ts:154`, `tests/scenarios/harness.ts:987`). It cannot validate Host closure behavior.
- **(c) Confirmed:** one current link per tuple; reopening replaces its interval (`src/core/work-graph/tasks/claim-service.ts:948`, :1116). Historical events remain; L1a no longer follows the overwritten close.

Read-only review completed; no files edited, tests run, or models called.

merge after listed fixes