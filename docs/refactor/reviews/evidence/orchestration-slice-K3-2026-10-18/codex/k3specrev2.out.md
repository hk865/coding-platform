**Not ready to freeze.** I reviewed the fourth draft against `bb924854` and K-A, including §9. No files changed, tests ran, or model calls were made. §0’s decisions are treated as settled.

Below, **K3** means [the fourth-draft specification](D:/cc-lead-notes/specs/k3/slice-K3-SPEC.md); **K** means [slice-K-SPEC.md](D:/cxt/k3-spec/docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md). **M** = must fix before freeze; **S** = should fix; **N** = note.

For the 19 first-review items:

| # | Disposition | Fourth-draft evidence |
|---|---|---|
| 1 | Resolved | K3:15–32, 137–153 correct the baseline and classification precedence. |
| 2 | Resolved | K3:154–165 specify owner-backed identity reconstruction and authoritative misses. |
| 3 | Resolved differently; acceptable | K3:116–133 retain tagged takeover facts and correctly exclude memory-store proof. |
| 4 | Not fully resolved | K3:461–512 define the ordinary transition; the review variant still contradicts classifier ordering—finding 1. |
| 5 | Not fully resolved | K3:166–200 define capture, but the baseline cannot represent pre-existing deletions—finding 5. |
| 6 | Not fully resolved | K3:204–255, 645–683, 875–898 establish persistence; transition and bound gaps remain—findings 2–3, 8. |
| 7 | Not fully resolved | K3:261–320 define purpose, selection exclusion and claims; hold/claim races remain—finding 3. |
| 8 | Not fully resolved | K3:293–303, 531–552 cover K fallback and recovery, with remaining discovery gaps—finding 4. |
| 9 | Resolved | K3:322–329 specify binding, replay-first behavior, revision guards and fresh-call revisions. |
| 10 | Not fully resolved | K3:366–390 define source/application contracts; application repair is incomplete—finding 4. |
| 11 | Not fully resolved | K3:384–415 separate evidence from disposition; hold/proposal paths and B2 remain unsettled. |
| 12 | Resolved | K3:430–451 exclude review Runs and correctly remove human disposition as a reset point. |
| 13 | Not fully resolved | K3:416–429 preserve accounting and suppress duplicate cards; original human-stop fences remain—finding 9. |
| 14 | Resolved | K3:453–457 specify complete pagination, stable windows, direct lookup and existing notices. |
| 15 | Not fully resolved | K3:1058–1076 correct earlier examples but omit a merged WP2 caller—finding 10. |
| 16 | Resolved differently; acceptable for K3 | K3:564 moves feasibility into the separately approved resource slice. |
| 17 | Resolved differently; acceptable for K3 | K3:564 defers sandbox integration rather than claiming it solved. |
| 18 | Resolved differently; acceptable for K3 | K3:564 defers attribution; original finding is preserved in resource notes. |
| 19 | Resolved | K3:564, 1162 remove reopened choices; `resource-limits-notes.md:30` retains decision 53. |

The remaining problems are:

1. **[M] The review RUN-25 variant cannot pass its classifier. — K3:491, 496–501.**  
   G10 exempts review Runs from G8/G11 only in WorkGraph, but the classifier first checks G11 and G8 unconditionally. Review Runs deliberately have no baseline (174), so they become RUN-20 before WorkGraph sees a candidate.  
   **Evidence:** K3:174, 332, 491, 496; the existing classifier submits the unknown result at [run-reconcile.ts:358](D:/cxt/k3-spec/src/core/agent-runtime/run-reconcile.ts:358).  
   **Fix:** Branch on trusted Run purpose in the classifier before these checks. Define the variant’s candidate shape and guard order on both sides; test a review Run with no baseline and more than 32 unresolved calls.

2. **[M] The UCR table is incomplete at three reachable boundaries. — K3:341, 881–887, 926.**  
   - `awaiting_proposal + review_unavailable` selects UR2, but UCR-08 has no such transition.
   - After eight rounds, another `safer_method` answer enters `awaiting_proposal`, while UCR-03 refuses every claim. No exhaustion transition returns control to the user.
   - Two unfinished review Runs can already have recorded every `done/unlikely` conclusion. L16 then finds no pending items or reasons and resolves automatically, contradicting A-group’s “two unfinished rounds → card.”
   
   **Evidence:** K3:91, 221, 340–362, 887, 890.  
   **Fix:** Add explicit unavailable/exhausted/repeated-failure outcomes and reasons. Define retry counting across repeated proposal cycles. Add acceptance cases for all three.

3. **[M] Direct hold is incompatible with several active-round states and lacks a complete race fence. — K3:408–415, 873, 888, 894–895.**  
   Holding a claimed-but-unentered round changes the record to `resolved`; UR3a still starts it, but RUN-02 rejects its state. Releasing a hold before a running round settles produces `resolved/released`, which neither UCR-04 nor UCR-08b accepts. Separately, UCR-15’s “original Run still selected” check needs protection against a concurrent ordinary claim; record revision alone does not guard a claim that leaves that record unchanged.  
   **Evidence:** K3:328, 409, 873, 888, 919; claim commit guards are assembled at [claim-service.ts:1104](D:/cxt/k3-spec/src/core/work-graph/tasks/claim-service.ts:1104).  
   **Fix:** Define hold/release behavior for claimed, running and ended-unsettled rounds. Guard ordinary claims against the review revision and hold against the relevant lease/selection facts. Test both race orders.

4. **[M] Restart discovery and application repair do not cover the states promised. — K3:383, 532–535, 546, 923.**  
   Startup excludes all `resolved` records, including held records with an unsettled round and dispositions whose application bookkeeping is missing. Existing automation discovery cannot recover a held task. UR7b also examines only the latest disposition: direct hold can overwrite an earlier card disposition before its application is recorded.  
   **Evidence:** K3:410, 532–535, 923; [startup-reconcile.ts:395](D:/cxt/k3-spec/src/app/startup-reconcile.ts:395) selects pending automation verdicts only.  
   **Fix:** Discover outstanding round settlement and unapplied answer receipts independently of review status and current disposition. Repair bookkeeping without authorizing continuation. Cover overwrite-before-repair and restart while held.

5. **[M] The start baseline cannot encode a tracked file already deleted at preparation. — K3:171, 176, 679–680.**  
   Every dirty entry requires a mode and blob ID. There is no deletion tombstone. Overlaying this baseline onto HEAD therefore restores a file that was absent at the start, producing incorrect “since-start” changes when it remains absent or is recreated.  
   **Evidence:** Existing comparison explicitly distinguishes absent entries at [verification-workspace-reader.ts:68](D:/cxt/k3-spec/src/core/workspace/verification-workspace-reader.ts:68).  
   **Fix:** Use a tagged present/deleted baseline entry and define overlay semantics. Test pre-deleted files remaining absent, being recreated, and changing type.

6. **[M] Truncated commands have no model-accessible route to their full arguments. — K3:312–317.**  
   The prompt directs the reviewer to a Kernel record, but its whitelist omits `look_graph`, the existing scoped history tool. Workspace reads cannot reliably retrieve platform Kernel history. The next round also loses interrupted-turn transcript content under K-A.  
   **Evidence:** [graph-tools.ts:262](D:/cxt/k3-spec/src/core/agent-runtime/graph-tools.ts:262), K:71–85.  
   **Fix:** Include an appropriately scoped public history-reading capability, or explicitly force incomplete evidence to `undetermined`. Test retrieval beyond the displayed 4 KiB without database access.

7. **[M] Safer-method targets disagree across the card, tool and settlement contracts. — K3:372, 393, 397, 883, 887.**  
   Card targets include undetermined platform operations; proposals are specified only for process calls; settlement requires a proposal for every target. A platform-only card therefore has no coherent successful proposal path.  
   **Evidence:** K3:372 versus 393 and UCR-08 at 887.  
   **Fix:** Define separate disposition and proposal target sets, plus behavior when no process target exists. Test platform-only and mixed cards.

8. **[M] The “accepted proposals always fit” guarantee remains unproved and is false for currently permitted identities. — K3:315, 395–403, 963.**  
   The 8,192-byte limit excludes call IDs and rendering overhead. Thirty-two 512-byte call IDs already consume 16 KiB before commands or anchors; K3 bounds neither those IDs nor their mandatory rendering. Existing anchor rendering also includes full identifiers. Manifest capacity additionally measures serialized structured data and rendered input, not the review section alone.  
   **Evidence:** [continuation-brief.ts:522](D:/cxt/k3-spec/src/contracts/continuation-brief.ts:522), [execution-preparation.ts:280](D:/cxt/k3-spec/src/core/agent-runtime/execution-preparation.ts:280).  
   **Fix:** Freeze a complete encoded-size budget, including identifiers, JSON expansion and duplicated representations. Use bounded display aliases or admission checks; extend K3-35 beyond ordinary-length IDs.

9. **[M] Review approval does not release an original human-stop fence. — K3:385, 414, 421.**  
   A Run blocked by G4 can later be human-attested with its pause/cancel pointer retained. Resolving its review or releasing `handle_myself` only suppresses confirmation; the original AV-4 still prevents automatic requeue.  
   **Evidence:** [task-failure.ts:136](D:/cxt/k3-spec/src/core/work-graph/state/task-failure.ts:136), [task-failure.ts:393](D:/cxt/k3-spec/src/core/work-graph/state/task-failure.ts:393), [task-failure.ts:779](D:/cxt/k3-spec/src/core/work-graph/state/task-failure.ts:779).  
   **Fix:** Specify whether that answer/release authorizes a human requeue or requires another explicit action. Preserve ordinary accounting. Test G4 → attestation → review answer/release → continuation.

10. **[M] §5.3 misses a current owner caller. — K3:1058–1076.**  
    `WP2-notices-fixture.workUnavailable(attest=true)` directly invokes `resolveUnknownRun` without the newly mandatory draft.  
    **Evidence:** [WP2-notices-fixture.ts:236](D:/cxt/k3-spec/tests/helpers/WP2-notices-fixture.ts:236).  
    **Fix:** Add its exact incomplete draft and review affected notice assertions. Also classify the merged Host-level attestation scenario at [WP2-wiring.test.ts:2046](D:/cxt/k3-spec/tests/composition/WP2-wiring.test.ts:2046); it should receive the new record through composition.

11. **[S] Several acceptance assertions sit outside their declared entry. — K3:982, 1050–1056.**  
    Pure R5 cannot demonstrate formal receipt replay, RecordStore read failure, real lease acquisition, or successful `requeueTask` service commits. K3-34’s literal one-to-one name comparison also fails on permission alias `write`, which becomes Kernel tool `edit`.  
    **Evidence:** [execution-driver.ts:97](D:/cxt/k3-spec/src/core/agent-runtime/execution-driver.ts:97), [observed-model-run.ts:255](D:/cxt/k3-spec/src/core/agent-runtime/observed-model-run.ts:255).  
    **Fix:** Split pure assertions from owner/runtime/lease cases and map the alias explicitly. Add service coverage for the non-mailbox lookup owners, inventory overflow/undecodable calls, and the paths above. The proposed mocks and storage wrappers do not inherently require database reads or test-only production hooks; K3-07 correctly remains the real containment check.

For the two B-group choices:

- **B1 — [M], K3:100, 332, 491.** It is an explicit exception to decision 52’s unconditional two restrictions, not already authorized by its text ([HANDOFF:309](D:/cxt/k3-spec/docs/refactor/HANDOFF.md:309)). The stated “no” direction is reasonable but incomplete: remove the classifier and owner variants, define their rejection reason, update K3-09/29/30, and distinguish unresolved-call interruptions from existing clean RUN-19 recovery.

- **B2 — [M], K3:101, 389, 399.** Prompt-only enforcement is a weaker interpretation of “skip” and “run the approved method.” It needs the requested user acknowledgment; decision 52 does not explicitly settle enforcement mechanics ([HANDOFF:315](D:/cxt/k3-spec/docs/refactor/HANDOFF.md:315)). **No rejection fallback is specified.** Define one before freeze—either enforce the approved disposition through an execution capability contract, or retain the hold until an acceptable execution path is explicitly authorized.

**[N]** The ordinary RUN-25 precedence, tagged lease proof, containment assumptions, K-A closure fallback, review selection exclusion, owner receipt lookup, and L23 streak definition are substantially improved. Update K3:8’s stale baseline description to reflect merged K-B/WP2.

**Verdict: not ready.** Resolve the must-fix paths, complete both B-group fallbacks, and obtain the two stated product decisions before freezing.