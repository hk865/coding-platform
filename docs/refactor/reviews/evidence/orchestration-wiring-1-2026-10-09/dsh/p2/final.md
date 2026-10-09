FILES CHANGED
- src/contracts/graph-context.ts (W01): implemented pure `goalContextContentV1` / `goalContextDigestV1` (contentVersion 1, goalId/objective/workspaceId via `sha256Hex(canonicalJson(...))`).
- src/core/work-graph/state/context-input.ts (W02): implemented pure `contextGoalContentProblem` in the §2.2 order (undefined→null, rebinding→null, matching Goal `record` source with a string digest ≠ current → `revision_conflict` / `context_goal_changed:`, null digest/legacy→null).
- src/core/agent-runtime/context-assembler.ts (W03): `assembleTask` maps the Goal `record` source digest first, then `sortedSources`; `assembleQuery` and `goalPayload` bytes untouched.
- src/core/work-graph/tasks/execution-entry-service.ts (W04): `contextConsumptionProblem`/`authorizeAdmission` carry the current Goal; entry check added after the Workspace revision loop and before the input-declaration check; rebinding skips; receipt replay untouched; comments updated (e48218a5 sentence + the function doc).
- src/business/workflow/contracts.ts (W05): handover step kinds / continuation provenance types (part-1 types, unchanged this run).
- src/business/workflow/workflow.ts (W06): `start` refusal mapping; E15 handover decision + `transfer_responsibility` / `archive_predecessor` result mapping and post-handover claim; HO-04 recovery in `claimRequeued`; comment accuracy fix.
- src/business/workflow/session-maintenance.ts (W07): `dutyOf(ctx, record)`; retired branch after U1 → `handoff_complete` when a continuation exists and no open non-module responsible link remains, else unchanged.
- src/business/workflow/ports.ts (W08): `SessionDutyResolver` type with optional ctx.
- src/composition/session-duty.ts (W09, new): `createSessionDutyResolver` (§4.1 steps 1–4, always `{status:'ready', value}`, never throws).
- src/composition/create-platform.ts (W10): `defaultSessionDutyResolver` deleted; `sessionDuty` uses `createSessionDutyResolver({readRoleSpec: roleService.readRoleSpec.bind(roleService), configuration: workflowConfiguration})`; `extensions` installed only on `createGraphContextReader`; stale comments fixed.
- src/core/work-graph/views/context-extensions.ts (W11, new): `createContextExtensionsReader` (§4.2 steps 1–5, exact reasons/texts, host rebind, bounded paging).
- src/business/workflow/index.ts: export of the new types.
- 8 frozen WP1 test files and 4 frozen helpers: untouched (hashes match). No other file changed; `.dsh-scratch/` deleted.

CHECKS
- `npm run typecheck`: exit 0.
- `npm run check:architecture`: exit 0 ("next source boundaries: OK"); `state/` still pure.
- New tests (8 files, 63 runs): 61 passed, 2 failed. Both failures are SC01 (`tests/scenarios/WP1-wiring.test.ts:45`) and SC02 (`:106`), each `expected 'waiting' to be 'completed'`; they stop `waiting` at the registered `run_check` step because this sandbox has no `/usr/bin/bwrap` (ENOENT). All assertions before the check pass (SC01's handover-order at :41; SC02's binding/manifest/anomaly assertions at :83–102), consistent with DSH-BASELINE. Not worked around.
- Regression (`npx vitest run $(cat .dsh-scratch/reg.txt)`, 34 files): 50 failed / 295 passed (baseline 49 failed / 296 passed). The 49 are the documented bwrap failures with the same per-file distribution (A7-control 14, A8-host-restart-entry 7, C6-unrelated-adoption 5, A8-host-restart-paused 5, A2-requeue-platform 5, harness 4, A8-host-restart 3, A8-host-restart-rework 2, A8-host-restart-lease 2, S1-archive-restart 1, A7-control-goal29 1). The only delta is the single `production-reach` failure below; no other new failure.
- sha256: all 12 frozen files match section 2 exactly (verified twice). `session-archive.ts` unchanged.

UNSPECIFIED
- Test id: `tests/architecture/production-reach.test.ts:105`. What: after the spec-mandated I-1 wiring, the two `kept-for` allowlist entries `src/core/work-graph/model/configuration-contracts.ts#RoleReadOptions` and `#RoleConfigurationPort.readRoleSpec` are now reached, so the test lists them as "reached now or gone; remove it from the allowlist". Spec line: §6 file list (`wiring-1-SPEC.md:355`, "in principle unchanged … if the check requires a change, DSH lists it under UNSPECIFIED, does not change it itself"), plus §4.1 step 1 (L5) which mandates reading the pinned RoleSpec. File:line: `tests/architecture/production-reach-allowlist.json` entries for those two symbols (~lines 618, 630). Per brief rule 1 I did not edit the allowlist; the lead must remove those two entries (or accept the failure). Note this makes section 5's "production-reach passes" and rule 1's "do not edit the allowlist" mutually exclusive; I followed rule 1.
- No test/spec disagreement found; no other UNSPECIFIED item.

NOTES
- Subagents run: 4 implementation (I1–I4) + 4 fresh adversarial reviews (I1–I4) = 8, all finished and reported. Reviews verified every named state row/rule as done (with file:line) and found only comment-accuracy nits; I fixed the three stale/incomplete comments (create-platform.ts, workflow.ts `canArchivePredecessor`, execution-entry-service.ts `contextConsumptionProblem` doc). Nothing else was changed after the reviews.
- C6-unrelated-adoption (5) and S1-archive-restart (1) fail here only in the documented bwrap way; the GE04 in-sandbox row confirms the unrelated plan adoption still enters. The lead must re-run C6/SC01/SC02/A7/A8/A2-requeue/harness with bubblewrap outside.
- `git status --short` shows exactly the 12 allowed source files (10 modified + 2 new) plus the 8 frozen WP1 test files; no allowlist/helper/test edit, no new file beyond W09/W11.