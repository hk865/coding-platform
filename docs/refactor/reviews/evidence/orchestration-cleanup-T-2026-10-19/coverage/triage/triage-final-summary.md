# Coverage triage after T: final (decision 79-4)

795 rows (A 218 = lost their last test in T; B 100 = lines T added or rewrote; C 477 = functions never executed, outside src/ui).

## By class

| class | rows | A | B | C |
|---|---|---|---|---|
| D1 | 55 | 2 | 0 | 53 |
| D2 | 156 | 55 | 30 | 71 |
| U | 157 | 87 | 36 | 34 |
| F | 161 | 23 | 12 | 126 |
| G | 265 | 51 | 22 | 192 |
| N | 1 | 0 | 0 | 1 |
| 待定 | 0 | 0 | 0 | 0 |

## By action

- test-gap: 426
- delete: 161
- keep-untested: 82
- lead: 65
- keep?: 50
- delete-guard: 10
- none: 1

## By source

- agreed: 333
- skeptic-upheld: 248
- judge: 167
- tiebreak: 28
- verifier: 19

Judge winners (167 rows): {'neither': 12, 'codex': 68, 'claude': 87}

Tiebreak (28 challenged agreed rows): agreed class stands 17, changed 11
  - A2-041 src/core/work-graph/views/track-read-model.ts:157: U -> G
  - A2-053 src/core/work-graph/views/track-read-model.ts:1180: U -> G
  - A3-002 src/contracts/continuation-brief.ts:604: D2 -> U
  - A3-003 src/contracts/continuation-brief.ts:687: D2 -> U
  - C1-009 src/core/work-graph/persistence/execution-entry-codecs.ts:140: D2 -> U
  - C1-010 src/core/work-graph/persistence/execution-entry-codecs.ts:148: D2 -> U
  - C1-020 src/core/work-graph/state/no-progress.ts:348: D2 -> U
  - C1-048 src/core/work-graph/tasks/execution-entry-service.ts:391: D2 -> U
  - C1-049 src/core/work-graph/tasks/execution-entry-service.ts:399: D2 -> U
  - C2-003 src/contracts/core/prepared-execution.ts:149: D2 -> U
  - C2-010 src/contracts/query-job.ts:262: D2 -> U

## Findings against T (all 8 clusters upheld by the verifier)

- TQ-114 B-12 IN04 + TQ-115 B-13 IN12: A1-032, A1-034, A1-035, A1-036 (G); upheld True
- T1-062 changed-lease / added-lease: A1-059, A1-061 (F); upheld True
- TP-109 RUN-16 pause variant: A1-077 (F); upheld True
- TP-172 M05 otherGoal read: A2-054, A2-055 (G); upheld True
- T1-038 T5x source_moving: A2-059, A2-060, A2-061, A2-062, A2-063 (F); upheld True
- T3-063 symlink in the A-07 merge: A3-038 (G); upheld True
- TP-026 tsconfig include assertion: A3-039 (G); upheld True
- TQ-093 display-preference empty state: A3-040, A3-041, A3-042 (G); upheld True

## Delete candidates by file (D1/D2 delete, U delete-guard)

- src/composition/create-platform.ts: 15
- src/core/work-graph/tasks/plan-readers.ts: 11
- src/core/work-graph/tasks/unknown-call-review-service.ts: 7
- src/core/workspace/typescript-source-query.ts: 7
- src/core/work-graph/views/work-line-reader.ts: 7
- src/core/agent-runtime/runtime.ts: 7
- src/core/agent-runtime/source-capture-access.ts: 6
- src/core/work-graph/tasks/plan-service.ts: 6
- src/core/work-graph/tasks/run-reconcile-service.ts: 4
- src/core/work-graph/views/note-views.ts: 4
- src/core/agent-runtime/context-assembler.ts: 4
- src/app/host.ts: 4
- src/core/work-graph/tasks/run-state-service.ts: 3
- src/core/work-graph/communication/mailbox-service.ts: 3
- src/core/work-graph/tasks/command-rerun-request-service.ts: 3
- src/core/agent-runtime/execution-driver.ts: 3
- src/app/core-routes.ts: 3
- src/core/work-graph/state/control-intent-machine.ts: 3
- src/core/work-graph/tasks/session-facts.ts: 3
- src/core/work-graph/tasks/session-anomaly-service.ts: 3
- src/core/agent-runtime/execution-control.ts: 3
- src/core/work-graph/state/line-status.ts: 2
- src/core/work-graph/state/session-availability.ts: 2
- src/core/work-graph/tasks/reconcile-intents.ts: 2
- src/core/work-graph/queries/query-execution.ts: 2
- src/core/work-graph/tasks/requeue-service.ts: 2
- src/core/workspace/source-index.ts: 2
- src/core/work-graph/views/activity-read-model.ts: 2
- src/core/work-graph/views/undelivered-reply-notices.ts: 2
- src/core/work-graph/state/run-machine.ts: 2
- src/core/work-graph/state/verification-machine.ts: 2
- src/app/attention-observer.ts: 2
- src/core/record-store/body-codec.ts: 2
- src/core/agent-runtime/run-reconcile.ts: 2
- src/core/work-graph/tasks/plan-write-admission.ts: 2
- src/core/agent-runtime/session-discovery-tools.ts: 2
- src/business/workflow/decision-actions.ts: 2
- src/business/workflow/workflow.ts: 2
- src/core/work-graph/persistence/graph-repository.ts: 1
- src/core/work-graph/persistence/plan-record-codecs.ts: 1
- src/core/work-graph/evidence/evidence-service.ts: 1
- src/core/work-graph/materials/applicability.ts: 1
- src/core/record-store/body-store.ts: 1
- src/core/agent-runtime/run-limits.ts: 1
- src/core/work-graph/architecture/catalog-service.ts: 1
- src/core/agent-runtime/query-execution.ts: 1
- src/app/collaboration-driver.ts: 1
- src/core/work-graph/communication/decision-service.ts: 1
- src/core/work-graph/evidence/verification-plan.ts: 1
- src/core/work-graph/views/decision-read-model.ts: 1
- src/core/work-graph/views/graph-context-reader.ts: 1
- src/core/work-graph/tasks/execution-history-service.ts: 1
- src/core/work-graph/views/goal-conflicts.ts: 1
- src/core/work-graph/views/task-state-timeline.ts: 1
- src/core/agent-runtime/check-execution.ts: 1
- src/core/agent-runtime/kernel-store-locator.ts: 1
- src/core/agent-runtime/continuation-brief-assembly.ts: 1
- src/core/agent-runtime/execution-observation.ts: 1
- src/core/work-graph/queries/query-job-service.ts: 1
- src/core/work-graph/tasks/model-request-codecs.ts: 1
- src/core/work-graph/state/plan-machine.ts: 1
- src/core/work-graph/state/ref-equality.ts: 1
- src/core/work-graph/tasks/request-facts-reader.ts: 1
- src/core/record-store/commit-extensions.ts: 1
- src/app/host-settings.ts: 1
- src/core/workspace/capture.ts: 1

66 files.

## Rows to look at (keep?, lead, pending)

- A1-005 src/core/work-graph/persistence/note-record-codecs.ts:197 [U lead]: Keep it untested: write no test that hand-writes a platform-source note. slice-4-SPEC.md:344 explicitly reserves {kind:'platform'} for slice 8, so keep the member and this branch; the slice that adds the platform writer 
- A1-006 src/core/work-graph/persistence/note-record-codecs.ts:197 [U lead]: Same as A1-005: keep untested and keep the member while slice-4-SPEC.md:344 reserves it for slice 8; if the reservation is dropped, delete contracts/note.ts:65 and this arm.
- A1-017 src/core/work-graph/state/plan-machine.ts:1253 [D2 keep?]: Drop the one-case outer switch (plan-machine.ts:1238-1255) and keep the inner status switch with its unreachable default; keep the compile-time exhaustiveness on state.status. No test was lost.
- A1-031 src/core/work-graph/tasks/context-input-service.ts:432 [U lead]: Delete the old-format acceptance: remove TaskAttemptRef from MaterialOrigin (body-ports.ts:7-9) and its branch in normalizeOrigin (body-codec.ts:160-162), so such rows decode as corrupt; decision 79 rebuilds old developm
- A1-033 src/core/work-graph/tasks/context-input-service.ts:497 [U lead]: Delete together with A1-031: narrow MaterialOrigin/body codec to Run/QueryRun owners; the null-provenance check at :497-499 then has no reachable state and goes. If the boundary rejection is kept for a foreign row, keep 
- C1-050 src/core/work-graph/tasks/execution-entry-service.ts:521 [U lead]: Keep it untested; do not delete and do not add a hand-seeded policy test (AGENTS.md rule 4). When the CoordinationPolicy writer lands, the arm becomes reachable only by installing/activating a policy that makes the curre
- A1-062 src/core/work-graph/tasks/plan-readers.ts:2081 [U lead]: Keep the reduction read and the untraced rule's reduction branch untested: do not restore T1-062's raw-seeded changed-reduction/added-reduction/task-order cases (AGENTS rule 4, decision 79). Do not delete :2080-2086 eith
- A2-035 src/core/work-graph/views/node-detail-reader.ts:1387 [U lead]: Keep the missing-Session guard and leave it untested; do not restore the fabricated `s1` anchor test (AGENTS.md rule 4 and decision 79: no test that only tampering or a foreign writer can trigger). Deleting the guard wou
- A2-049 src/core/work-graph/views/track-read-model.ts:647 [U lead]: Delete the fallback under 79-1: readCheckStart returns `since: CommitCursor` and throws rejected('unavailable', 'round <refKey> is missing its since cursor') when it is absent, as activity-read-model.ts:452-453 already d
- A2-075 src/core/work-graph/views/work-line-reader.ts:1774 [U lead]: Delete the two null-kind counts (UArchived/UActive, :1752-1753), the u sum (:1768-1769) and the partial return (:1774-1776); countArchived then returns exact c. Drop `null` from S's kinds (:1751). Do it in the same batch
- C2-019 src/core/agent-runtime/context-assembler.ts:867 [D2 keep?]: Keep the not_implemented placeholder as a declared future section (contract graph-context.ts:99 and WORK_SECTIONS in context-input.ts:51 reserve footprint), set footprint: [] and delete the row map (:867); when a footpri
- A3-014 src/core/agent-runtime/run-reconcile.ts:548 [D2 keep?]: Map every refusal to 'failed' (:547-548); keep the owner's lease guard at run-reconcile-service.ts:1020 (it is still the correct guard) or delete it in the same batch if the lead accepts that the only caller never submit
- C2-066 src/core/agent-runtime/run-reconcile.ts:93 [U lead]: Keep the guard at :327-335 untested (AGENTS.md rule 4: it turns a non-reducible stored history into a 'failed' report instead of an exception out of the start-up reconcile). Delete the dead try/catch at :116-119 so readT
- A3-024 src/core/agent-runtime/source-capture-access.ts:596 [U lead]: Delete the request-equality check at :596-597: the accepted execution is immutable once the QueryRun is running, and the running check at :592 stays. If the lead prefers keeping a defence-in-depth line, keep it untested 
- C2-086 src/core/agent-runtime/source-capture-access.ts:667 [U lead]: Delete the unreachable ctx-identity checks at :672-680 (the context is always querySourceContext's clone), and either delete the execution comparison :684-685 with the helper or keep it untested as defence in depth. Do n
- B-039 src/core/work-graph/architecture/catalog-record-codecs.ts:459 [U lead]: Keep it untested: do not fabricate a revised event with a non-null cursor to execute the check (a tamper test is exactly what decision 79 / AGENTS.md rule 4 exclude). If the lead wants the dead sub-check gone, replace :4
- C1-007 src/core/work-graph/persistence/decision-record-codecs.ts:203 [U lead]: Keep it untested and keep the member: the code comment (decision-record-codecs.ts:109-113) and spec §3.3 line 625 ask the shared check to cover every AggregateRef type, and #22 was a lead review item for the SessionWorkL
- C1-008 src/core/work-graph/persistence/decision-record-codecs.ts:213 [U lead]: Goes with C1-007: keep untested with the shape check (no hand-written record per AGENTS rule 4), or delete with the function if the ledger-wide AggregateRef completeness check is dropped.
- C1-026 src/core/work-graph/tasks/claim-service.ts:684 [U lead]: Keep it untested now (no raw-store seed test): the matrix writer is a named but unimplemented slice, so keep this arm and the matrix phases. When the CoordinationPolicy writer lands it becomes G - install and activate Ro
- C1-034 src/core/work-graph/tasks/completion.ts:98 [U lead]: Keep the three refusals untested and do not add Codex's bogus-round test: the projection guard refuses a non-head round first, and reaching :223 needs a deleted/foreign snapshot (AGENTS.md rule 4: no tamper test). If the
- C1-045 src/core/work-graph/tasks/evidence-coverage.ts:50 [U lead]: Keep missingDefinition untested and add no inconsistent Evidence/Plan fixture (AGENTS.md rule 4); the fallback only fills the evidenceDefinition field of the OUT_OF_SCOPE decision already produced at :168-172. If the lea
- C2-061 src/core/agent-runtime/query-observation.ts:54 [U lead]: Keep the guard at :286-292 untested (no test may hand-write a non-reducible Kernel history: AGENTS.md rule 4, decision 79). Delete the two dead try wrappers at :253-257 and :455-463 so their callers' returned rejections 
- C2-093 src/core/record-store/in-memory-record-store.ts:458 [D2 keep?]: Replace :457-458 with `const positioned = direct !== undefined && direct.cursor === cursor ? direct : undefined;`; results are identical in every state the store can produce and the linear scan disappears. Keep the notFo
- C3-012 src/app/core-routes.ts:643 [D2 keep?]: Tighten CoreRoutePlatform and the optional method types so the real owners are required, delete `unsupported` (:643-645) and the absent-owner fallbacks, and let the narrow test platforms supply the owners; keep it as tes
- C3-049 src/app/runtime-configuration.ts:361 [D2 keep?]: Keep, do not delete: the R6 spec explicitly defines this default ("默认取既有 public registry 和只读指定 env 名的函数", docs/refactor/tasks/R6-execution-entry-skeleton.md:59) for this Host-internal factory, so it is not an old-data or
- C3-062 src/business/workflow/session-maintenance.ts:358 [D2 keep?]: Add the slice-1 §2.2 creation check at session-directory.ts:710-712: for kind 'readonly_copy' the message must exist, and its consultationDerivation.childSessionRef (or the creation's fixed derivation) must be the planne
- C3-063 src/business/workflow/session-maintenance.ts:359 [D2 keep?]: Same fix and deletion as C3-062: implement the §2.2 creation check at session-directory.ts:710-712, then delete the ordinary-input branch at session-maintenance.ts:356-360 (both the outer entry callback at :358 and the i
- C3-080 src/composition/create-platform.ts:1285 [D1 keep?]: Do not delete on coverage grounds: decision 6 keeps the member unwired and the allowlist records it as kept-for (production-reach-allowlist.json:503-507). If the user drops that kept-for entry, delete this fallback toget
- C3-081 src/composition/create-platform.ts:1287 [D1 keep?]: Same as C3-080: keep while decision 6 reserves the member (allowlist kept-for, production-reach-allowlist.json:508-512); if the entry is dropped, delete the fallback together with the activateRoleSpec wrapper (trackedCal
- C4-022 src/core/work-graph/communication/decision-application.ts:96 [D2 keep?]: Keep it untested as the explicit slice-6 placeholder the file and spec name (decision-application.ts:18-19, :52-53, :95); do not delete unless that spec line is edited first (after deletion the default at :104 would answ
- C4-023 src/core/work-graph/communication/decision-application.ts:98 [D2 keep?]: Keep it untested with C4-022 as the slice-6 placeholder named at decision-application.ts:52-53 and :95; delete both only together with the spec edit. No new test.
- C4-090 src/core/work-graph/sessions/session-record-codecs.ts:332 [U lead]: Keep the stored-record guard untested (AGENTS.md rule 4: no new test that hand-writes a failure) or, following decision 79, delete checkFailure and the branch at :686-689 and require failure === null. Narrowing SessionOp
- C4-098 src/core/work-graph/views/decision-read-model.ts:1683 [U lead]: Replace the fallback at :1683 with `return null` and drop the comment that implies a generic fallback; no test that hand-writes a rejected proposal (AGENTS.md rule 4). If the lead treats 'rejected' as a status reserved f
- C4-123 src/core/work-graph/views/undelivered-reply-notices.ts:325 [U lead]: Keep the conflicting-Goal rejection and do not add a tamper test: silently re-attributing such a record to sender.runRef would file the notice under the wrong Goal. If decision 79's no-old-data line is preferred over the
- A1-002 src/core/work-graph/persistence/decision-record-codecs.ts:396 [U lead]: Delete the tolerance (decision 79): decodeNoticeOrigin returns invalid when since is undefined. mailbox-service.ts:198-200 then becomes redundant, and evidence-service.ts:306 assigns since without the condition. No new t
- A1-007 src/core/work-graph/persistence/plan-record-codecs.ts:126 [U lead]: Delete the absent-since tolerance only together with the fixture: let seedCommit (:569-586) accept commitCursorBindings and have seedCandidateProposal (:1233) commit encodePlanProposal(proposal, { since: null }) with com
- A1-016 src/core/work-graph/state/line-status.ts:824 [U lead]: Delete with A1-013: once the codec requires the conclusion, switch over SessionHealthConclusion without this default. || codex: 删除旧默认原因；保留当前 missing/damaged 等原因
- A1-025 src/core/work-graph/state/task-failure.ts:1115 [U lead]: Keep untested (rule 4). The GV-2/P20/GOAL-30 state rows stay in tests/state/task-machine.test.ts and goal-machine.test.ts. Note for the lead: the frozen GAP-52 row tests/state/task-failure.test.ts:1288 passes gate(INVALI
- A1-046 src/core/work-graph/tasks/plan-readers.ts:1201 [U lead]: Keep it untested (rule 4). This is probably one of L-2's 'T1-062 rows' guards'. || codex: 保留保守占用兜底不测，或随跨记录约束收紧删除
- A1-088 src/core/work-graph/tasks/run-state-service.ts:564 [U lead]: Keep untested (AGENTS rule 4). It is the single return point of the chain checks above. || codex: 保留关系拒绝不测；不能与 085—087 的重复解码混删
- A2-004 src/core/work-graph/communication/mailbox-service.ts:1338 [U lead]: Keep it untested. It is the exact-owner fence for fresh mail, and rule 4 rules out a tamper test. Deleting it is possible because :1330 covers this case under the owner invariant; that is the lead's call. || codex: 删除此重复
- A2-005 src/core/work-graph/communication/mailbox-service.ts:1344 [U lead]: Keep it untested (rule 4). Deletion is possible for the same reason as A2-004; lead's call. || codex: 删除 released Lease 的重复防御，不恢复手改 Lease 测试。
- B-047 src/core/work-graph/communication/mailbox-service.ts:1358 [D2 keep?]: Fold it into :1361 as `authorization?.phase !== 'entered' || ...`. That removes the separate branch and keeps the type narrowing. || codex: 删除旧 running/无授权兼容检查，收窄 running facts 类型；保留 phase/generation 校验。
- B-050 src/core/work-graph/communication/mailbox-service.ts:2786 [D2 keep?]: Replace the conditional with `authorization?.kernel`; kernelMatches already treats undefined as no match (mailbox-service.ts:2802). If the lead counts direct facade calls as public steps, this becomes G: platform.message
- A2-007 src/core/work-graph/configuration/role-memory-service.ts:92 [U lead]: Keep it untested. It guards against a corrupt event and costs nothing; no tamper test. Lead's alternative: delete :253, :289 and actorRefEquals as redundant with the identity key. || codex: 保留事件回放的身份完整性检查，不补篡改测试。
- A2-008 src/core/work-graph/configuration/role-memory-service.ts:253 [U lead]: Keep it untested (rule 4), or delete it together with A2-007/A2-009 as redundant; lead's call. || codex: 保留回放拒绝出口，不测篡改。
- A2-009 src/core/work-graph/configuration/role-memory-service.ts:289 [U lead]: Keep it untested (rule 4), or delete it with A2-007/A2-008; lead's call. || codex: 保留回放拒绝出口，不新增热切换生命周期测试。
- A2-016 src/core/work-graph/evidence/evidence-service.ts:310 [U lead]: Delete per decision 79: in preservedRoundNoticeOrigin, treat a missing since as damaged (unavailable), or copy since unconditionally. Add no test. || codex: 删除缺 since 兼容，并统一要求当前轮次来源有 since。
- C4-044 src/core/work-graph/evidence/evidence-service.ts:953 [D2 keep?]: Collapse lines 951-953 to always invalid(...), or turn the non-invalid arm into an unreachable throw. Optionally drop the unused codes unknown_check and no_check_coverage from VerificationPlanRejectionCode (verification-
- B-070 src/core/work-graph/sessions/session-record-codecs.ts:736 [U lead]: Keep it, untested (AGENTS rule 4). It is the current-format check that replaced the old backfill path T deleted; dispatch reads facts.session.provenance directly (query-execution.ts:924-927 after T). || codex: 保留、免补测：拒绝旧
- A2-028 src/core/work-graph/views/activity-read-model.ts:345 [U lead]: Delete under 79-1. run-activity-service.ts:302 should refuse a missing dispatch claim as `unavailable`, as activity-read-helpers.ts:187 has done since W2b-57. RunActivitySnapshot.sessionRef should become non-null (contra
- A2-029 src/core/work-graph/views/activity-read-model.ts:367 [U lead]: Delete together with A2-028: once sessionRef is non-null, the `if (session !== null)` wrapper at :367 goes and the body runs unconditionally. Or keep untested. || codex: 同 A2-028，简化为有归属的计数。
- A2-031 src/core/work-graph/views/activity-read-model.ts:496 [U lead]: Lead's call, together with A2-041 and A2-050. Option 1: delete the R4 re-check block at activity-read-model.ts:486-502. Its only job is this check, so the block also stops costing one Session read per distinct Session; r
- A2-032 src/core/work-graph/views/goal-conflicts.ts:267 [D2 keep?]: The skeptic's objection to the agreed deletion is upheld: codex's 'narrow the ready result and delete the arm' would narrow the frozen slice-5 port DTO (src/core/work-graph/model/decision-contracts.ts:61; docs/refactor/d
- A2-050 src/core/work-graph/views/track-read-model.ts:1078 [U lead]: Keep the :1078-1079 workspace check untested (rule 4; T3-089's refresh says keep the production guard under R-3), or if reducing, delete only the Session read/arm at :1071-1079. Do not delete sessionProblemOf :1059-1093 
- A2-070 src/core/work-graph/views/work-line-reader.ts:1517 [D2 keep?]: Drop `?? null` here and the `provenance === null ||` test at :1518. Do it in the same batch as A2-066. || codex: 删除 provenance 缺省分支，保留真正的环检测。
- A2-073 src/core/work-graph/views/work-line-reader.ts:1627 [D2 keep?]: Write `session.provenance.kind !== 'readonly_copy'`. Same batch as A2-066. || codex: 删除 null 回退，保留非 copy 过滤。
- C4-127 src/core/work-graph/views/work-line-reader.ts:144 [D1 keep?]: No test. To remove it, narrow the wrapper's type: give undeliveredRepliesFor (:100) and the line mailbox a read-only records port, after which countingStore can drop lookupCommit/commit. Otherwise keep it as a type-requi
- C4-128 src/core/work-graph/views/work-line-reader.ts:145 [D1 keep?]: Same as C4-127: either narrow the port types so the wrapper no longer needs commit, or keep it as a type-required pass-through. No test. || codex: 从 WorkLineStore 契约与包装中删除 commit。
- C4-130 src/core/work-graph/views/work-line-reader.ts:1033 [U lead]: Keep the decode-damage guard without a test (AGENTS rule 4: no new tamper test). Simplify the D2 parts: drop `|| link.until === null` at :1004 and the non-task fallback in targetTaskOf (:1038). After that, unknownTask is
- C4-131 src/core/work-graph/views/work-line-reader.ts:1542 [U lead]: Keep untested, as the spec says (slice-2C-SPEC.md:1343), and add no tamper test (AGENTS rule 4). Deleting it would mean removing N9 from the 2C spec, which is the lead's call. Lists and pages would still terminate withou
- C4-132 src/core/work-graph/views/work-line-reader.ts:1556 [U lead]: Keep untested, same as C4-131. Deletion depends on dropping N9 from the spec. || codex: 删除仅服务环补偿的过滤逻辑；保留正常链头选择。
- C4-135 src/core/work-graph/views/work-line-reader.ts:2354 [U lead]: Keep untested per slice-2C-SPEC.md:1343, with no tamper test (AGENTS rule 4). Removing the 'cycle' kind and this helper would be a 2C spec change (N9), which the lead decides. || codex: 删除 cycleRepresentativeOf 及调用处的环补偿；
- C4-136 src/core/work-graph/views/work-line-reader.ts:2355 [U lead]: Same as C4-135: keep untested, or delete together with N9 if the spec changes. || codex: 随环代表函数一起删除，不单独保留或补测。
- A3-002 src/contracts/continuation-brief.ts:604 [U lead]: Keep the null-endedAt arm untested (AGENTS rule 4 / 79-4: no new tamper test). If deleting it per 79, also narrow ContinuationBriefV1.previous.endedAt to string (src/contracts/continuation-brief.ts:202) and reject null i
- A3-015 src/core/agent-runtime/session-operations.ts:470 [U lead]: Keep untested (AGENTS rule 4). The one bounded head read is cheap, and it keeps a truncated Kernel file from yielding a seemingly valid empty terminal page. || codex: 保留现有游标完整性检查、不补测；不能恢复删除历史记录的测试。
- A3-016 src/core/agent-runtime/source-capture-access.ts:71 [U lead]: Keep untested (AGENTS rule 4). These leaf checks turn a corrupted envelope into 'unavailable' instead of a TypeError inside a tool call. Deletion is possible if the lead prefers, since the only writer guarantees the leav
- A3-017 src/core/agent-runtime/source-capture-access.ts:94 [U lead]: Keep untested, with A3-016 and A3-020 (one decision for the three leaf checks). || codex: 随上一行删除重复身份拒绝分支，不恢复篡改输入。
- A3-021 src/core/agent-runtime/source-capture-access.ts:457 [D1 keep?]: Keep the review binding (:455-459), authorizeReviewWork (:476-516) and the candidate-exclusion test (:227-266) untested as retained slice-9 Reviewer groundwork. If the lead chooses deletion, delete reviewerSourcePathAllo
- B-029 src/core/agent-runtime/source-capture-access.ts:636 [U lead]: Delete the per-status label and keep the throw. With B-030, format the detail as `submissionRead.status === 'rejected' ? code + reason : submissionRead.status`. No test (AGENTS rule 4). || codex: 保留、免补测：明确报告提交链损坏，不能退回扫描旧
- B-035 src/core/agent-runtime/source-capture-access.ts:651 [D2 keep?]: Narrow the QueryJobSubmitted actor to human/system in the codec (query-record-codecs.ts:498), then delete :651, or keep it as a type narrowing. Either way, no test. || codex: 删除重复 actor 拒绝，收窄 submission actor 类型。
- A3-026 src/core/record-store/body-codec.ts:165 [U lead]: Keep, untested (AGENTS rule 4: no tamper test). It is the terminal fall-through of normalizeOrigin (body-codec.ts:184) that makes the function never return an unchecked origin; it cannot be deleted without silently accep
- B-037 src/core/record-store/body-codec.ts:188 [U lead]: Delete decodeOrigin's undefined check (:188) and call normalizeOrigin directly. The behaviour stays corrupt and only the message changes. No test. || codex: 保留、免补测：继续拒绝缺 origin，不恢复 legacy 解码。
- A3-033 src/core/record-store/sqlite-record-store.ts:333 [U lead]: Keep, untested (rule 4); it is the corrupt-not-conflict plumbing described at sqlite-record-store.ts:317-323 and cannot be removed without the caller treating an invalid decode as a revision. || codex: 保留“不把坏正文伪装成版本竞争”的现
- C3-073 src/composition/create-platform.ts:1148 [D2 keep?]: Keep the rejection half of the drain cleanup at src/composition/create-platform.ts:1147-1148 (pending.add plus both handlers); do not delete it. Optionally state in trackDetached's doc comment (:1143-1146) that the Host'
- C3-082 src/composition/create-platform.ts:1290 [D1 keep?]: Keep create-platform.ts:1284-1291, including resolveRoleBinding at :1290, under decision 6 / the kept-for allowlist entry; no test. Only if the user drops the kept-for entry should it be deleted, together with RoleConfig
- C3-083 src/composition/create-platform.ts:1290 [D1 keep?]: Keep with C3-082 under decision 6 (docs/refactor/HANDOFF.md:782; production-reach-allowlist.json:514-519); no test. Delete only together with the facade and the contract member if the user drops the kept-for entry.
- C3-098 src/composition/create-platform.ts:1604 [D2 keep?]: Replace `await opened.value.release().catch(() => undefined)` with `await opened.value.release()` (deleting the callback). Nothing else simplifies. || codex: 删 release 的 catch，保留 finally release。
- C3-099 src/composition/create-platform.ts:2028 [D2 keep?]: Nothing to delete on its own: the fallback is trackedCall's required whenClosed argument (create-platform.ts:1135-1136). Removing it would need a separate drain helper for the internal reconcile seam, which is not worth 
- C3-100 src/composition/create-platform.ts:2045 [D2 keep?]: Keep untested, for the same reason as C3-099: it is trackedCall's required whenClosed argument (create-platform.ts:1135). || codex: 同 C3-099，删此专用 fallback，不删 reconcileRun。
- C3-102 src/composition/create-platform.ts:2060 [D2 keep?]: Same as C3-101: keep it. The argument is required by trackedCall (create-platform.ts:1135), and bypassing trackedCall would break the single close path. No test. || codex: 同 C3-099，删 `:2061` 的专用 fallback。
- B-053 src/core/work-graph/persistence/evidence-record-codecs.ts:334 [U lead]: Keep it, untested (AGENTS rule 4). It is the registered current-format check for VerificationRound. Without it, a finalized round missing finalizedAt would decode and then drop out of the finalized-by-Goal index the view
- B-067 src/core/work-graph/queries/query-record-codecs.ts:446 [U lead]: Keep it, untested (AGENTS rule 4). It is the current-format check that source-authority-reader and query-execution rely on when they read the submission locator (T removed the 'no exact submission locator' fallbacks, que
- B-089 src/core/work-graph/views/automatic-rework-notices.ts:194 [U lead]: Keep it untested; it narrows the shared type cap: number|null (contracts/task-requeue.ts:156). Optionally, type automation as a union keyed by automatic and drop the check. No tamper test. || codex: 保留、免补测：拒绝不完整自动返工记录。
- B-091 src/core/work-graph/views/decision-read-model.ts:1564 [U lead]: Keep the undefined check untested and drop the dead '|| since === null' half. No tamper test. || codex: 保留、免补测：不恢复旧时间排序 fallback。
- C1-009 src/core/work-graph/persistence/execution-entry-codecs.ts:140 [U lead]: Keep the declared field (src/contracts/dispatch.ts:304, src/contracts/core/prepared-execution.ts:192; the frozen skeleton DTO declares it at docs/refactor/tasks/B2-execution-state-skeleton.md:49) and keep the entry guard
- C1-020 src/core/work-graph/state/no-progress.ts:348 [U lead]: Delete keyFact and the canonical tie-break at :345; compareCheckFacts then compares checkId only, and the stable Array.sort keeps a foreign duplicate-id round's stored order deterministically, so no behaviour for platfor
- C1-060 src/core/work-graph/tasks/goal-executed-files-reader.ts:48 [U lead]: Keep the guards untested. They are the decoder's required narrowing of a union result, not an extra defensive check, and AGENTS rule 4 forbids a test that tampers with the store to reach them. Nothing to delete. || codex
- C2-003 src/contracts/core/prepared-execution.ts:149 [U lead]: Delete only the redundant re-sort at prepared-execution.ts:149: a spread followed by .map is byte-identical for every platform-written manifest, because buildUnknownCallReviewInputV1 copies and sorts platformTargets at c
- C2-010 src/contracts/query-job.ts:262 [U lead]: Do not delete now. The protocol is deliberately deferred, not dead: docs/refactor/tasks/R5b-query-planning-skeleton.md:101 keeps execution_coordination unsupported, and docs/refactor/design/orchestration-2026-10/DESIGN.m
- C2-022 src/core/agent-runtime/context-assembler.ts:916 [D2 keep?]: Keep queryPlanSummary (context-assembler.ts:915-920) and its call at :2000-2001 for now. The lead must first decide the conflict: either drop or rewrite slice-3-SPEC.md:502, or change the initial_coordination/no-Plan rul
- C2-023 src/core/agent-runtime/context-assembler.ts:917 [D2 keep?]: Contingent on C2-022: keep the stage.map as long as queryPlanSummary is kept; delete it with the function only after the lead drops or rewrites slice-3-SPEC.md:502.
- C2-024 src/core/agent-runtime/context-assembler.ts:918 [D2 keep?]: Contingent on C2-022: keep the task.map while queryPlanSummary is kept; delete it with the function only after the lead drops or rewrites slice-3-SPEC.md:502.
- C2-030 src/core/agent-runtime/context-assembler.ts:1429 [D2 keep?]: No test. A delete candidate: in production this sorts a list of at most 1 element. However, the K3 spec defines multi-item records (L7 creation budget, K3-46 mixed card; pure tests K3-16-review-extremes-pure.test.ts:106-
- C2-031 src/core/agent-runtime/context-assembler.ts:1439 [D2 keep?]: Keep the projection at context-assembler.ts:1434-1440 (the owner/pure fixtures are its only coverage) and keep it untested under rule 79-4; do not reduce it to []. If the lead wants it gone, first amend slice-K3-SPEC.md:
- C2-050 src/core/agent-runtime/exploration-tools.ts:239 [D2 keep?]: No test. The line is deletable because it never fires, but it is a zero-cost unhandled-rejection guard; the lead may keep it. || codex: 删除重复吞拒绝回调，保留 inFlight 清理；不通过违反 handler 结果契约的替身补覆盖。
- C2-094 src/core/record-store/migrations.ts:113 [U lead]: Keep untested (AGENTS rule 4: no tamper test). Optionally drop the `.sort(...)`, since any multi-column key already mismatches the single expected key; or, under decision 79, consider whether the whole legacy-schema comp
- C3-001 src/app/auto-capture-driver.ts:99 [D2 keep?]: The rejected state cannot arise, so deletion is allowed. But this is the one rejection sink in the shared detach helper. Without it, `settled` could reject and `settled.finally` (101) would raise an unhandled rejection t
- C3-004 src/app/collaboration-driver.ts:556 [D2 keep?]: The state cannot arise. Deletion is allowed: replace with a bare `void pass;`. Nothing else simplifies, and a future throw in runRendezvous would then become an unhandled rejection. Either delete or keep it untested. || 
- C3-006 src/app/collaboration-driver.ts:766 [D2 keep?]: The state cannot arise. Deletion is allowed: `await pumpDone`. Nothing else simplifies. Either delete or keep it untested as a sink. || codex: 改为直接 await pumpDone，保留 drain。
- C3-007 src/app/collaboration-driver.ts:884 [D2 keep?]: Same as C3-006: deletion is allowed (`await pumpDone`). Either delete or keep it untested. || codex: 删 catch，继续等待原 pump。
- C3-008 src/app/collaboration-driver.ts:1011 [D2 keep?]: The state cannot arise. Deletion is allowed (`await handle.done`). Either delete or keep it untested. || codex: 直接 await handle.done；保留前后两次取消。
- C3-009 src/app/collaboration-driver.ts:1114 [D2 keep?]: The state cannot arise. Deletion is allowed: `Promise.all(all.map(stopHandle))`. Either delete or keep it untested. || codex: 删 map 内 catch，保留 `Promise.all` 排空。
- C3-016 src/app/goal-fan-out-driver.ts:218 [D2 keep?]: The state cannot arise. Deletion is allowed: `void work.finally(() => into.delete(work))`. Note that create-platform's trackDetached uses the `then(del, del)` form instead (create-platform.ts:1146-1150). Either delete or
- C3-017 src/app/goal-fan-out-driver.ts:514 [D2 keep?]: The state cannot arise. Deletion is allowed: `await fanOut(...)`. Either delete or keep it untested. || codex: 删 fanOut 的重复 catch。
- C3-018 src/app/goal-fan-out-driver.ts:525 [D2 keep?]: The state cannot arise. Deletion is allowed (`await checkWatches()`). Either delete or keep it untested. || codex: 删 checkWatches 的重复 catch。
- C3-026 src/app/host-settings.ts:529 [D2 keep?]: There is little to gain from deleting it. Dropping this arm, and the second `operation` at host-settings.ts:528, would leave `dispatchQueue` rejected after any future unexpected throw, and every later settings call would
- C3-048 src/app/main.ts:222 [D2 keep?]: Replace with `void probeResourceCaps();` and drop the `.catch`, or keep it as a cheap guard against a vendor change; the lead decides. Nothing else simplifies. || codex: 删外层 catch，保留启动探测。
- C3-070 src/business/workflow/workflow.ts:2924 [D2 keep?]: Keep the `?? (() => new Date().toISOString())` fallback and the optional `now`; leave it untested and owe no test. Do not make `now` required unless the lead first amends slice-1-SPEC.md:600.
- C3-104 src/core/workspace/analysis-runner.ts:340 [D2 keep?]: The `.catch(...)` can be deleted with no behaviour change. It is also a free guard against an unhandled rejection if writeInput is edited later, so the lead may keep it. No test either way. || codex: 删 writeInput 外层 catc
- C3-105 src/core/workspace/capture.ts:341 [D1 keep?]: Keep the member as the spec'd type stub and delete nothing; if the narrowing is wanted, amend slice-8-SPEC.md:316/:323 first and then use `Pick<ProjectSourceAccess,...>`. Nothing to test today.
- C4-025 src/core/work-graph/communication/decision-source-facts.ts:201 [U lead]: Keep the damaged mapping untested (no tamper test, AGENTS rule 4). It is reached only by a foreign source ref whose aggregate type does not match the decoder, a shape no platform writer produces. Optionally map that case
- C4-048 src/core/work-graph/notes/note-anchors.ts:677 [D2 keep?]: Keep the one-line guard, which is behaviour-neutral today, or if deleting it also narrow catalogModuleFactsOf/readCatalogModuleFacts to exclude not_ready so the fallback and the seam typecheck; no test is owed either way
- C4-049 src/core/work-graph/notes/note-read-model.ts:438 [U lead]: Delete the fallback rather than keep it. readNote(version) with a missing head should return rejected unavailable 'the note head is missing', and the then-dead headSnapshots === undefined branch in withCheck (note-read-m
- C4-122 src/core/work-graph/views/undelivered-reply-notices.ts:315 [U lead]: Delete :314-316. Line :317 still returns the non-ready read, never a silent item. Do not add a tamper test (AGENTS rule 4). || codex: 保留稳定损坏诊断且不测，避免把丢失消息静默当成无通知。
