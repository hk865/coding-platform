**VERDICT: reject**

**FINDINGS**

1. **Major — [decision-read-model.ts:341](D:/cxt/s5r2-rv4a/src/core/work-graph/views/decision-read-model.ts:341): exactly 5,000 messages are rejected.** H2, T-R2-3 and SPEC §4.1:772 explicitly permit this boundary. With exactly 5,000 pending messages and no others, `lookupAll` marks the final page truncated before checking `next === null` ([goal-conflicts.ts:159](D:/cxt/s5r2-rv4a/src/core/work-graph/views/goal-conflicts.ts:159)); the new branch returns `capacity`. Fix the overflow detection so an exhausted exact-limit page remains valid.

2. **Major — [decision-read-model.ts:300](D:/cxt/s5r2-rv4a/src/core/work-graph/views/decision-read-model.ts:300): notices-only reads bypass the Goal limit.** H2/T-R2-3 require `capacity` for an unfiltered Workspace queue containing more than 200 Goals. With 201 Goals, `sections:['notices']` and no `goalRef`, `wantsGoals` is false, so the check never runs and the queue can return `ready`. Enforce the unfiltered Goal limit independently of requested sections.

3. **Major — [decision-read-model.ts:1050](D:/cxt/s5r2-rv4a/src/core/work-graph/views/decision-read-model.ts:1050): message capacity is checked separately per status.** H2/T-R2-3 and SPEC §4.1:772 bound the source window. With 3,000 pending and 2,001 responded messages, neither lookup reports truncation, so the new capacity branch permits a 5,001-item source window. Apply one item/page budget across the message source’s status lookups.

4. **Minor — [plan-service.ts:1384](D:/cxt/s5r2-rv4a/src/core/work-graph/tasks/plan-service.ts:1384), also `:3284`: replacement creation uses a different origin mechanism.** H1/T-R2-2 specify binding each new candidate’s creating commit and preserving that origin on subsequent updates. P1 created at c1 and replacement P2 created at c2 instead both store `since=c1`. Current serialized chains still select the correct history head, but the persisted origin differs from the prescribed mechanism. Bind new replacements to their own creation commit and derive chain order from the first candidate.

**ITEMS**

- **H1 — done differently.** Both history entrances share the comparator at [plan-record-codecs.ts:148](D:/cxt/s5r2-rv4a/src/core/work-graph/persistence/plan-record-codecs.ts:148), and adoption/abandonment preserve origin; replacement creation differs as above. Origin plumbing also extends beyond the brief’s literal encode-site regions, including [plan-service.ts:2783](D:/cxt/s5r2-rv4a/src/core/work-graph/tasks/plan-service.ts:2783).
- **H2 — not done completely.** Capacity checks were added, but findings 1–3 remain.
- **H3 — done.** [decision-read-model.ts:645](D:/cxt/s5r2-rv4a/src/core/work-graph/views/decision-read-model.ts:645) passes the call’s bound Workspace after scope checks; answer lookup no longer depends on `goalBases`.

**UNSPECIFIED**

Equal non-null `since` cursors fall back to refKey ordering in [plan-record-codecs.ts:160](D:/cxt/s5r2-rv4a/src/core/work-graph/persistence/plan-record-codecs.ts:160); T-R2-2 does not specify that tie case. The capacity gaps above are specified requirements, not unspecified behavior.

Read-only review; no Node or tests run.