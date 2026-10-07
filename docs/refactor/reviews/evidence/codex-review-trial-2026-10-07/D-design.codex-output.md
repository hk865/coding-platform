I found **3 must-fix, 4 should-fix, and 2 nits**. No files were changed; no tests were run.

1. **Must-fix — Cancelled-goal requeue still implies resuming the cancelled goal.**  
   [DESIGN.md:249](docs/refactor/design/orchestration-2026-10/DESIGN.md:249), repeated at line 727, says that after “继续” or “重新入队”, queued interventions are delivered “在第一个安全点送达”. [STATUS.md:132](docs/refactor/STATUS.md:132) still says this question needs the user’s decision.  
   Decision 39 explicitly settles it: “取消是终态”; requeue creates “一个新的目标”, and “原来的目标、记录和历史都不动” ([HANDOFF.md:146](docs/refactor/HANDOFF.md:146)). The design must describe the new-goal copy and provenance label, and distinguish its inputs from interventions queued against the cancelled goal.

2. **Must-fix — Compaction’s MVP boundary is still marked undecided.**  
   [DESIGN.md:815](docs/refactor/design/orchestration-2026-10/DESIGN.md:815) says “进不进 MVP。没定。【提议】”. This persists in §0, §8.2, §9.1 item 19, appendix E, and [STATUS.md:102](docs/refactor/STATUS.md:102).  
   Decision 39 settles “不算进 MVP 门槛”, with reconsideration after slice 9 measurements ([HANDOFF.md:147](docs/refactor/HANDOFF.md:147)). Update the approval gate and “18 条还没定” summaries. Detailed K2 behavior can remain proposed, but it should be separated from the settled MVP decision.

3. **Must-fix — Candidate-plan handling still assumes one request per goal.**  
   [DESIGN.md:955](docs/refactor/design/orchestration-2026-10/DESIGN.md:955) says the pending-plan reader need not return multiple candidates, and replacement leaves “最新的一个”. Yet §1.1 permits concurrent requests for the same goal, each with its own plan.  
   The cited code really is goal-wide: [plan-readers.ts:521](src/core/work-graph/tasks/plan-readers.ts:521) selects one proposal by key; [plan-contracts.ts:39](src/core/work-graph/tasks/plan-contracts.ts:39) has no request association. Define request-scoped proposal lineage, iteration replacement, retrieval, and invalidation after another plan is adopted. Otherwise two valid requests can hide or supersede each other’s candidates.

4. **Should-fix — Secretary replies and unfinished requests lack coherent handoff and archival rules.**  
   [DESIGN.md:472](docs/refactor/design/orchestration-2026-10/DESIGN.md:472) resumes asynchronous replies on “这个秘书 Session”. Line 74 promises follow-ups stay with the original secretary, “不换人”; line 681 instead routes unfinished requests to its successor.  
   Moreover, [DESIGN.md:624](docs/refactor/design/orchestration-2026-10/DESIGN.md:624) derives waiting only from a yielded **work** execution, while secretary rounds remain queries. That does not account for their outstanding inquiries when checking “不在等” before archival. Define request completion, pending replies, successor routing, and the handoff exception to original-secretary affinity.

5. **Should-fix — The acknowledged multi-secretary conflict needs an executable resolution rule.**  
   [DESIGN.md:1174](docs/refactor/design/orchestration-2026-10/DESIGN.md:1174) correctly acknowledges opposing dispatches and overwritten current understanding. Its mitigation—“先读当前理解再派工”—does not handle two secretaries reading the same version before either writes or dispatches.  
   Specify the request/plan versions that dispatches reference, rejection or reconciliation of stale instructions, and conflict handling for current-understanding updates. Human plan adoption alone cannot resolve this: the default autonomy level already permits direct dispatch.

6. **Should-fix — §2.11 broadens approval gating beyond decision 37.**  
   [DESIGN.md:469](docs/refactor/design/orchestration-2026-10/DESIGN.md:469) lists four sendable intents, then line 471 generically says “「每步确认」下存成‘待放行’”.  
   Decision 37 gates only “请动手” and “请回答” ([HANDOFF.md:134](docs/refactor/HANDOFF.md:134)); DESIGN line 402 correctly follows that distinction. Restrict §2.11’s rule explicitly, so notifications and decision cards do not themselves require prior release.

7. **Should-fix — A same-goal preference becomes an unsupported requirement.**  
   [DESIGN.md:608](docs/refactor/design/orchestration-2026-10/DESIGN.md:608), marked 【已定（决定 37）】, opens a Session whenever there is no “同目标、空闲、不太长的秘书”.  
   Decision 37 says same-goal secretaries are **preferred**, and opens another when “都忙或都太长” ([HANDOFF.md:133](docs/refactor/HANDOFF.md:133)). The lifecycle table excludes an idle, short secretary from another goal. Align the fallback with the decision, or mark that stricter policy proposed.

8. **Nit — The authoritative UI override presents proposed naming as settled.**  
   [UI-WORKBENCH.md:137](docs/UI-WORKBENCH.md:137) definitively specifies “秘书 · <目标或话题>”. DESIGN line 180 and §9.1 item 17 explicitly leave that naming 【提议】. Add the same qualification to the UI override.

9. **Nit — The waiting/archival summary omits the new retirement exception.**  
   [DESIGN.md:726](docs/refactor/design/orchestration-2026-10/DESIGN.md:726) says “在等的不能直接归档”. But line 710 explicitly allows immediate archival of a retired line while it still awaits replies. The detailed rule is clear; qualify the summary with that exception.

**Code facts:** No incorrect cited implementation fact found. I checked §5.3’s directory-only `readOnlyPaths`, writable workspace mount, unavailable-sandbox rejection, and `commandsAllowed` conjunction; §2.11’s query tools and sender restrictions; §1.8’s reactivation without a health check; and §4.11’s absence of compaction, history selection, unused `removed` result, and prefix-based restoration. Appendix C’s added usage and request-grouping fields are proposals, absent from the current corresponding schemas; its 18-field, 10-index, and four-setting counts match the lists.

**Other consistency and design checks:** Items 2, 4, and 5 correctly reflect decisions 38 and 37; the §9.1/§8.2 approval mappings otherwise agree. Appendix E reflects the revision apart from its stale decision-39 status. Historical “已结束” and single-secretary statements are explicitly superseded. Posting permissions match decision 37. The compaction plan preserves original records and tool/result pairing and acknowledges cache costs; before K2 is frozen, it should specify a target size and stable compaction boundary to avoid repeated prefix rewrites.