/**
 * E1-vr16 (slice 9 G2; rulings §4.3 E1, TS §3.4; book 1248; SPEC §3.4 C :327): `transitionRound` on `review_recorded`
 * (VR-16) from an `open` round with the current pin keeps the same round (still `open`, same revision, no evidence
 * refs, no outcome) and gives exactly four effects in this order: guard the round unchanged, admit the one verdict
 * Evidence once per `review-packet` pair, append the Task evidence index, emit `VerificationReviewEvidenceRecorded`.
 * There is no `guard_round`, so no Round record is written. A stale pin (99), a caller that is not the executor, a
 * finalized round and a round with no `review-packet` item are refused with no effects.
 *
 * World `W-pure` (rule sheet A5): one hand-written open round. Its frozen plan has a static item and one
 * `review-packet` item with two pairs: one requirementId under two obligations is two pairs (SPEC :292). The effects,
 * reasons and codes are written by hand from TS §3.4 (`roundWriteAdmission`'s new arm and `roundOnReviewRecorded`).
 *
 * Named mutations: add the `review_recorded` event arm but no `transitionRound` case (it falls to `unreachable`; the
 * accept row is red); write the Round record (`guard_round`, revision + 1; the accept row's toEqual is red); build the
 * effects before checking the status (the finalized row is accepted; red).
 */
import { describe, expect, it } from 'vitest';
import type { EvidenceCoverageV1, EvidenceRef } from '../../src/contracts/evidence.js';
import type { RoundSnapshot, VerificationCheckPlan } from '../../src/contracts/verification.js';
import {
  rootRoundChain, transitionRound, type RoundEvent, type RoundGuardContext, type VerificationEffect,
} from '../../src/core/work-graph/state/verification-machine.js';

const P = 's9-project', W = 's9-workspace', G = 's9-goal', T = 's9-task';
const PLAN_REF = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' } as const;
const RUN_REF = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'run-1' } as const;
const HOST = { kind: 'system', id: 'local-host' } as const;
const POLICY = { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'policy-1', revision: 1 },
  digest: 'digest-e' } as const;
const BASELINE = { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P, baselineId: 'baseline-1',
  revision: 1 }, digest: 'digest-f' } as const;
const pair = (obligationId: string, requirementId: string): EvidenceCoverageV1 => ({ obligationId, requirementId });
const LINT_DEF = { checkId: 'lint', kind: 'static', command: 'run lint', cwd: '.', timeoutMs: 60_000, taskIds: 'all' } as const;
const LINT_ITEM: VerificationCheckPlan = { checkId: 'lint', kind: 'static', satisfiesKind: 'static',
  coverage: [pair('ob-1', 'r-static')], satisfactionPath: 'predicate' };
const REVIEW_ITEM: VerificationCheckPlan = { checkId: 'review-packet', kind: 'reviewer', satisfiesKind: 'reviewer',
  coverage: [pair('ob-1', 'r-review'), pair('ob-2', 'r-review')], satisfactionPath: 'review-packet' };

/** Open, revision 5, the command check finished PASS, nothing folded yet. */
const OPEN: RoundSnapshot = {
  ref: { aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId: T, runId: 'run-1',
    roundId: 'round-1' },
  revision: 5, schemaVersion: 1, subject: { projectId: P, goalId: G, taskId: T }, subjectRunRef: RUN_REF,
  adoptedPlanRef: PLAN_REF, taskBasisRef: PLAN_REF, executor: HOST,
  configuration: { configurationRevision: 'cfg-1', workspace: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
    executor: HOST, permissionRevision: 'perm-1', sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied', deniedPrefixes: [], checks: [LINT_DEF] },
  configurationDigest: 'digest-a',
  identity: { schemaVersion: 1, scope: { projectId: P, workspaceId: W, goalId: G, runId: 'run-1', taskId: T },
    runRef: RUN_REF, runRevision: 4, runDigest: 'digest-1', planRef: PLAN_REF, planRevision: 1, planDigest: 'digest-2',
    taskDigest: 'digest-3', goalRevision: 2, goalDigest: 'digest-4', workspaceRevision: 3, workspaceDigest: 'digest-6',
    workspaceRoot: '/ws/root', policyPin: POLICY, baselinePin: BASELINE, sourceDigest: 'digest-5',
    sourceProofDigest: 'digest-7' },
  sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
  verificationPlan: { schemaVersion: 1, planId: 'digest-8', planDigest: 'digest-8', taskRef: { projectId: P, goalId: G, taskId: T },
    planRef: PLAN_REF, planRevision: 1, workspaceRevision: 3, pinnedCompletionPolicy: POLICY,
    pinnedArchitectureBaseline: BASELINE,
    changeScope: { diffClass: 'code-change', changedFiles: ['src/a.ts'], writeSummary: 'edit a' },
    semanticChange: 'semantic', risks: [], checks: [LINT_ITEM, REVIEW_ITEM] },
  checks: [{ checkId: 'lint', definition: LINT_DEF, coverage: [pair('ob-1', 'r-static')], phase: 'finished',
    invocationId: 'inv-lint', outcome: 'PASS', sourceStatus: 'matched',
    reportRef: { kind: 'artifact', contentType: 'application/json', digest: 'digest-d', sizeBytes: 42,
      source: { kind: 'workspace', refId: W, revision: '3' } } }],
  status: 'open', outcome: null, gaps: [], evidenceRefs: [], chain: rootRoundChain(), stagedRepairs: [], until: null,
};
const FINALIZED: RoundSnapshot = { ...OPEN, revision: 6, status: 'finalized', outcome: 'PASS',
  evidenceRefs: [{ aggregateType: 'Evidence', projectId: P, evidenceId: 'ev-lint' }] };
const NO_REVIEW_ITEM: RoundSnapshot = { ...OPEN, verificationPlan: { ...OPEN.verificationPlan, checks: [LINT_ITEM] } };

const E: EvidenceRef = { aggregateType: 'Evidence', projectId: P, evidenceId: 'ev-review-1' };
const EVENT: RoundEvent = { kind: 'review_recorded', evidenceRef: E };
/** The row's call: the caller's pin is the round's revision, the executor books, no instance lease. */
const ctxOf = (round: RoundSnapshot, over: Partial<RoundGuardContext> = {}): RoundGuardContext =>
  ({ expectedRevision: round.revision, callerIsExecutor: true, instanceLeaseHeld: false, ...over });

describe('E1-vr16: transitionRound on review_recorded (VR-16)', () => {
  it('books on the same open round: four effects in order, no Round record', () => {
    const effects: VerificationEffect[] = [
      { kind: 'guard_round_unchanged', revision: 5 },
      { kind: 'admit_verdict_evidence', admissions: [
        { ref: E, checkId: 'review-packet', coverage: pair('ob-1', 'r-review') },
        { ref: E, checkId: 'review-packet', coverage: pair('ob-2', 'r-review') },
      ] },
      { kind: 'append_task_evidence_index' },
      { kind: 'emit_event', eventType: 'VerificationReviewEvidenceRecorded' },
    ];
    // `next` deep-equals the input: still `open`, revision 5, `evidenceRefs: []`, `outcome: null`.
    expect(transitionRound(OPEN, EVENT, ctxOf(OPEN))).toEqual({ ok: true, next: OPEN, effects });
  });

  it.each([
    { name: 'a stale pin (99)', round: OPEN, over: { expectedRevision: 99 }, reason: 'stale', code: 'revision_conflict' },
    { name: 'a caller that is not the executor', round: OPEN, over: { callerIsExecutor: false },
      reason: 'guard_failed', code: 'forbidden' },
    { name: 'a finalized round', round: FINALIZED, over: {}, reason: 'illegal', code: 'busy' },
    { name: 'a round with no review-packet item', round: NO_REVIEW_ITEM, over: {}, reason: 'guard_failed', code: 'invalid' },
  ])('refuses $name with no effects', ({ round, over, reason, code }) => {
    expect(transitionRound(round, EVENT, ctxOf(round, over)))
      .toEqual({ ok: false, reason, code, detail: expect.any(String) });
  });
});
