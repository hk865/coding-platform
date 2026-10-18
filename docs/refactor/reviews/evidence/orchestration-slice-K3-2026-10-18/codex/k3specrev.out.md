**The draft is not ready to freeze.** I reviewed the current checkout (`e3a512e6`), K including M1–M12, the cited decisions, state machines, implementation and official resource-control documentation. No files changed; no tests or probe scripts ran.

Below, **K3 lines** refer to [slice-K3-SPEC.md](D:/cxt/k3-spec/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md). **M** = must fix before freezing; **S** = should fix; **N** = note.

1. **[S] K3:10–12, 65–73 — Several descriptions of today’s code are inaccurate.**  
   The brief already lists unknown calls individually, including identity, name and target; it is not just one warning. Kernel has `edit`; platform permission `write` maps to it. Current coordination tools include user-decision tools and Session discovery, but no annotation-writing/“记” tool.  
   **Evidence:** [continuation-brief.ts:417](D:/cxt/k3-spec/src/contracts/continuation-brief.ts:417), [observed-model-run.ts:244](D:/cxt/k3-spec/src/core/agent-runtime/observed-model-run.ts:244), [execution-driver.ts:79](D:/cxt/k3-spec/src/core/agent-runtime/execution-driver.ts:79).  
   **Fix:** Correct the baseline, distinguish future tools, and freeze classification precedence: read-only platform tools must not require mutation receipts.

2. **[M] K3:72–74 — Request identity and receipt lookup are underspecified.**  
   The request hash includes **Run, Session, operation and callId**, not merely Run/callId. Mailbox receipt identity additionally incorporates workspace and sender generation; its fingerprint includes payload and pins. There is no generic lookup by the stated request number alone.  
   **Evidence:** [execution-driver.ts:459](D:/cxt/k3-spec/src/core/agent-runtime/execution-driver.ts:459), [mailbox-service.ts:727](D:/cxt/k3-spec/src/core/work-graph/communication/mailbox-service.ts:727), [ports.ts:183](D:/cxt/k3-spec/src/core/record-store/ports.ts:183).  
   **Fix:** Specify an owner-backed lookup for each supported mutation. Only an authoritative lookup miss means “not committed”; unreadable, unsupported or conflicting lookup remains undetermined.

3. **[M] K3:37, 161, 168 — The proposed lease proof cannot currently be constructed.**  
   Successful HL-03 returns `heldBy:null`; the previous instance ID is discarded. HL-01 means an absent lock, and memory has no previous file owner. Neither supplies the mandatory old PID/instance fields. Lease ownership also does not by itself prove arbitrary extension-tool effects have stopped; built-in process termination depends on sandbox containment.  
   **Evidence:** [host-instance-lease.ts:39](D:/cxt/k3-spec/src/app/host-instance-lease.ts:39), [host-instance-lease.ts:143](D:/cxt/k3-spec/src/app/host-instance-lease.ts:143), [process-sandbox.ts:337](D:/cxt/k3-spec/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:337).  
   **Fix:** Define tagged HL-01/HL-03/memory proof variants, retain actual takeover evidence, pass it through composition, and state the containment assumptions.

4. **[M] K3:160–182 — RUN-25 needs a complete transition row, including terminal-Turn handling.**  
   Source states are unspecified. Existing reconciliation scans Entering, Running and EndedUnknown. RUN-20(i) also covers a **terminal** Kernel Turn with unresolved tools; K refuses to close another terminal and retains its strict history checks. Blindly applying RUN-25 then SES-06/K closure is inconsistent.  
   **Evidence:** [startup-reconcile.ts:224](D:/cxt/k3-spec/src/app/startup-reconcile.ts:224), [run-reconcile.ts:312](D:/cxt/k3-spec/src/core/agent-runtime/run-reconcile.ts:312), [K:54](D:/cxt/k3-spec/docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md:54).  
   **Fix:** Specify source states, terminal precedence, applied/unresolved control handling, accepted inputs/steers, claim generations, entry/history fields, Attempt/Outbox effects, CAS and replay. Restrict automatic closure to supported open-Turn cases unless another explicit path is defined.

5. **[M] K3:41, 76, 89, 154–165 — “Git capture succeeded” lacks a precise meaning.**  
   L7 conditions the restriction on file/process items, while decision 52 requires Git capture for automatic cleanup generally. Existing capture compares **current HEAD**, not Run-start state, and returns changed paths rather than textual diffs.  
   **Evidence:** [HANDOFF:309](D:/cxt/k3-spec/docs/refactor/HANDOFF.md:309), [verification-workspace-reader.ts:63](D:/cxt/k3-spec/src/core/workspace/verification-workspace-reader.ts:63), [context-assembler.ts:641](D:/cxt/k3-spec/src/core/agent-runtime/context-assembler.ts:641).  
   **Fix:** Make the prerequisite unconditional; define baseline/time, untracked/ignored/binary files, capture instability, truncation and retained evidence. Preserve `runBaselineKnown:false`; absence from a diff never proves “not done.” Use safe owner reads, respecting protected paths.

6. **[M] K3:82–114, 171 — The review record is not an implementable persistence contract.**  
   Missing: storage owner/key, revision/ref, events/codecs, public read/list ports, indices, reviewer binding, concurrency guards and numerical bounds. The promised links/full arguments/diffs have no durable representation. An unreadable Kernel after human attestation could also produce an empty record that immediately resolves.  
   **Evidence:** [run-reconcile-service.ts:513](D:/cxt/k3-spec/src/core/work-graph/tasks/run-reconcile-service.ts:513), [run-machine.ts:2316](D:/cxt/k3-spec/src/core/work-graph/state/run-machine.ts:2316).  
   **Fix:** Define the aggregate and atomic creation for both origins, explicit inventory completeness, immutable evidence references and bounded display summaries. Incomplete inventory must never mean “nothing needs review.”

7. **[M] K3:115–142, 172–176 — Nothing specifies how review blocks ordinary execution.**  
   Existing Workflow selects automatic requeue before other work. A normal Work Run can become the Task’s latest execution and enter its verification/completion flow; empty write scope does not distinguish review purpose.  
   **Evidence:** [workflow.ts:1298](D:/cxt/k3-spec/src/business/workflow/workflow.ts:1298), [execution-preparation.ts:220](D:/cxt/k3-spec/src/core/agent-runtime/execution-preparation.ts:220).  
   **Fix:** Define durable review purpose/binding, scheduling and authorization; gate selection, perform, direct claim/start and restart redrive. Review success must neither complete the original Task nor replace its failure/continuation ancestry. Specify model/budget selection and unavailable-tool behavior.

8. **[M] K3:116, 134–135, 176 — Review restart and K fallback paths are missing.**  
   A crash can occur before review starts, after some conclusions, after the last conclusion, or before continuation. Startup currently discovers open/unknown executions, not pending reviews attached to already-ended Runs. “Same Session” also conflicts with K’s mandatory unsupported/unreadable/handover fallback.  
   **Evidence:** [startup-reconcile.ts:213](D:/cxt/k3-spec/src/app/startup-reconcile.ts:213), [K:127](D:/cxt/k3-spec/docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md:127), [K:539](D:/cxt/k3-spec/docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md:539).  
   **Fix:** Add a recovery table and pending-review discovery. Preserve committed conclusions, handle unfinished review deterministically, prevent recursive review chains, and carry the original facts through a permitted replacement Session.

9. **[M] K3:119–134 — “Pending only” contradicts “last write wins”; replay is undefined.**  
   After the first conclusion the item is no longer pending, so a second write must both fail and overwrite. Target `callId` alone is not a write identity.  
   **Evidence:** K3:127–128; existing replay convention in [decision-service.ts:983](D:/cxt/k3-spec/src/core/work-graph/communication/decision-service.ts:983).  
   **Fix:** Bind the tool to the active review Run and original record; define revision guards and request fingerprints. Replay identical requests before current-state checks, reject changed payloads under one identity, and explicitly allow or prohibit revision by a fresh call. Finalization must race safely with writes.

10. **[M] K3:143–153 — Slice 5 does not automatically apply these answers.**  
    Non-conflict selections currently only save an answer; application proofs whitelist Goal-settings and Plan-adoption events. The new source also lacks canonical key/pins, availability, history and stale-answer rules.  
    **Evidence:** [decision-actions.ts:243](D:/cxt/k3-spec/src/business/workflow/decision-actions.ts:243), [decision-application.ts:60](D:/cxt/k3-spec/src/core/work-graph/communication/decision-application.ts:60), [goal-decisions.ts:78](D:/cxt/k3-spec/src/contracts/goal-decisions.ts:78).  
    **Fix:** Specify the source adapter, review revision pin, answer/application operations and receipts, free-text/annotation behavior, cancellation/pause semantics and closure derivation. Keep cards derived rather than adding another card store.

11. **[M] K3:148–153 — Unconditional `resolved` permits premature execution.**  
    “Safer method” still requires a proposal and **second approval**; “I’ll handle it” requires a persistent pause. “Treat as not done” must not overwrite evidence that a command actually completed. Whole-card answers also need an explicit target set.  
    **Evidence:** [HANDOFF:315](D:/cxt/k3-spec/docs/refactor/HANDOFF.md:315), [HANDOFF:322](D:/cxt/k3-spec/docs/refactor/HANDOFF.md:322); K3:149–153.  
    **Fix:** Separate observed verdict from authorized disposition. Define proposal/approval/wait states, bind approval to exact proposed execution, preserve proven platform commits, and retain unknown historical results when the user chooses to skip.

12. **[M] K3:140, 166 — “Consecutive” has two incompatible, incomplete definitions.**  
    One rule checks a previous review containing process calls; the other checks RUN-25. Neither explains intervening review Runs, yielded continuations, human attestation/requeue, replacement Sessions or reset conditions. These gaps can restore the automatic-cleanup allowance accidentally.  
    **Evidence:** existing ancestry traversal in [task-failure.ts:463](D:/cxt/k3-spec/src/core/work-graph/state/task-failure.ts:463).  
    **Fix:** Define both predicates over the complete Task identity and original work ancestry; explicitly exclude review-only Runs and enumerate reset/non-reset examples.

13. **[M] K3:135, 141–142, 172 — Autonomy and rework integration need explicit rules.**  
    Autonomy lives in `Goal.settings`, defaults to `after_plan_confirmation`, and uses `every_step`. Existing Workflow already emits requeue confirmation; human-attested crashes remain `run_failed`, while `interrupted` is exempt from counting.  
    **Evidence:** [goal-decisions.ts:19](D:/cxt/k3-spec/src/contracts/goal-decisions.ts:19), [workflow.ts:1130](D:/cxt/k3-spec/src/business/workflow/workflow.ts:1130), [task-failure.ts:235](D:/cxt/k3-spec/src/core/work-graph/state/task-failure.ts:235).  
    **Fix:** Specify reads/rechecks, precedence against the existing confirmation card, pause/cancel controls, and approved-action replay. Exempt review itself without resetting existing counts or silently extending RUN-25’s exemption to human-attested failures.

14. **[M] K3:143, 172 — The new source must integrate with slice 2A.**  
    Current injected sources have a 25-page/5,000-item ceiling; 2A removes it. The draft gives no enumeration/index strategy.  
    **Evidence:** [decision-read-model.ts:408](D:/cxt/k3-spec/src/core/work-graph/views/decision-read-model.ts:408), [2A:99](D:/cxt/k3-spec/docs/refactor/design/orchestration-2026-10/slices/slice-2A-SPEC.md:99).  
    **Fix:** Specify workspace/Goal-scoped complete pagination, stable-window participation, single-card lookup and availability reporting. Reuse the existing exempt-requeue recovery notice, preserving its identity and `since`.

15. **[S] K3:196 — The old-test flip list is wrong.**  
    A8-3f is missing Kernel storage; A8-3g restores a paused Turn without the specified unresolved-call trigger. A8-3e is covered in the runtime test, not the named scenario file.  
    **Evidence:** [A8-host-restart.test.ts:609](D:/cxt/k3-spec/tests/scenarios/A8-host-restart.test.ts:609), [same:665](D:/cxt/k3-spec/tests/scenarios/A8-host-restart.test.ts:665), [A2-reconcile-runtime.test.ts:6](D:/cxt/k3-spec/tests/runtime/A2-reconcile-runtime.test.ts:6).  
    **Fix:** List exact assertions individually; retain unreadable-Kernel and late-evidence coverage where RUN-25 does not apply.

16. **[M] K3:208–226 — Resource feasibility is conditional; guaranteed failure/Host survival is overstated.**  
    User scopes with available delegated controllers are viable. However, TasksMax counts threads too and rejects fork/clone rather than killing the command; programs may handle that and exit successfully. MemoryMax does not guarantee whole-command termination or protection against aggregate/global pressure.  
    **Evidence:** [kernel cgroup documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html#pid), [systemd delegation](https://systemd.io/CGROUP_DELEGATION/).  
    **Fix:** State these limits, probe actual effective controls, define whole-group OOM policy and report cap events separately. Local timings demonstrate one environment, not production guarantees.

17. **[M] K3:220 — Integration is more than prefixing argv.**  
    ProcessSandbox currently supplies only PATH, inherits workspace fd 3 and terminates a process group. A user-manager connection needs appropriate trusted environment; wrappers must preserve fd closure, cancellation and parent-death behavior.  
    **Evidence:** [process-sandbox.ts:248](D:/cxt/k3-spec/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:248), [check-execution.ts:229](D:/cxt/k3-spec/src/core/agent-runtime/check-execution.ts:229), [systemd-run documentation](https://github.com/systemd/systemd/blob/main/man/systemd-run.xml).  
    **Fix:** Specify Host-setting propagation to every constructor, capability probing, unique scope identity, output/exit handling and literal argument preservation (`--expand-environment=no` where supported). Preserve K’s M10–M12 result/security rules. Never retry uncapped after a possibly-started capped invocation.

18. **[M] K3:226 — `oom_kill` alone cannot attribute a kill to this cap.**  
    It counts victims of **any** OOM killer. An in-scope observer may die, and the production sandbox does not expose the host cgroup filesystem.  
    **Evidence:** [kernel memory-event definitions](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files), [process-sandbox.ts:362](D:/cxt/k3-spec/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:362).  
    **Fix:** Observe from outside the capped scope, retain evidence before removal, correlate memory/pids counter deltas with unit/exit facts, and support uncertain attribution. Exit 137/143 is insufficient.

19. **[S] K3:225, 227–228 — Settled choices are presented as open again.**  
    Decision 53 already selects uncapped fallback with disclosure, defaults/settings, and a separate post-K-B slice.  
    **Evidence:** [HANDOFF:323](D:/cxt/k3-spec/docs/refactor/HANDOFF.md:323).  
    **Fix:** Remove those choices. “No resource cap” must not imply bypassing an unavailable sandbox.

**R1–R5 are sufficient entry categories, but their current descriptions are not sufficient acceptance criteria.** Lead should freeze these rows:

| Entry | Acceptance rows to add |
|---|---|
| **R1** | Abrupt real Host-process death; authoritative platform receipt hit/miss/read failure; file/create/untracked evidence; process review before continuation; exactly one cleanup/review/continuation across replay; unchanged original unknown tool facts; no premature Task completion. Include a mixed-tool batch and waiting-message send. |
| **R2** | Full verdict × crash-suspicion matrix, especially `done + possible`; six reasons individually and combined; enforced read-only permissions; partial/no conclusions; duplicate/conflicting tool submissions; all four dispositions, second approval and persistent manual pause; stale/free-text answers; queue and single-card reads beyond 5,000 sources. |
| **R3** | Every RUN-25 guard failure: lease ownership, probe variants, terminal/incomplete Turn, accepted-input failure, pause/cancel variants, second interruption, non-Git/failed capture; existing unknown ends and late evidence. Assert no unauthorized cleanup or execution. |
| **R4** | Public human attestation and receipt replay; complete/incomplete/unreadable inventories; K closure success, retry and fallback; preserved reason/actor; review restart at each durable boundary; original-task ancestry and ordinary rework accounting retained. |
| **R5** | Complete RUN-25 and review transition tables; paired effects and CAS rejection; immutable evidence versus human disposition; streak/reset examples; autonomy precedence; count/no-progress exemptions; final-state replay and rejected late writes. |

Resource-cap acceptance belongs to the separately approved slice: use the actual ProcessSandbox, including fd isolation, cancellation, Host death, handled fork denial, uncertain OOM attribution and unsupported-cap fallback.