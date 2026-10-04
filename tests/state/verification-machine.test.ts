/**
 * A.2 step 2 (spec §15.2 第 2 步): the VerificationRound, round-check and
 * TaskEvidenceIndex machines of spec §9 (`state/verification-machine.ts`).
 *
 * - Every (state, event) combination of `transitionRound` and
 *   `transitionCheck`: a legal one asserts `next` (byte for byte against
 *   the open, begin, record and finalize literals `evidence-service.ts` wrote
 *   before A.2 step 3) and `effects`; an illegal one asserts `reason`
 *   and `code` (§9.4).
 * - 改造 rows keep today's result (no VR-01 slot/`chain`/VD-3/VD-9, no VR-02
 *   VD-9, no VR-03 `incompleteCause`, today's VR-07 fold, VR-08 on a finalized
 *   round, today's index CAS); 新增 rows return `illegal`/`invalid` at the
 *   legal cell (VR-04/06) or from every state (VR-09, VR-14/15); VR-05/VR-13
 *   are not written today either.
 * - Guard rows in today's order, and the pure helpers of §9.6 / §13.7 in full
 *   (the chain cases of the planned `verification-chain.test.ts` live here).
 *
 * Pure: no RecordStore, no Kernel, no model.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { EvidenceCoverageV1, EvidenceRef } from '../../src/contracts/evidence.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { ArchitectureBaselinePin, CompletionPolicyPin } from '../../src/contracts/governance.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type {
  CheckHostActor, CheckProcessObservation, RegisteredCommandCheck, ReverifyBasisV1, RoundCheckIncompleteCause,
  RoundCheckSnapshot, RoundSnapshot, TrustedCheckConfiguration, VerificationPlanV1, VerificationRoundRef,
} from '../../src/contracts/verification.js';
import { ROUND_CHAIN_MAX } from '../../src/contracts/verification.js';
import type { VerificationRoundMaterialIdentity } from '../../src/contracts/verification-context.js';
import {
  beginRefusalIsPermanent, buildFinalizedRound, buildOpenedRound, buildSuccessorRound, chainEvidenceIds,
  checkEventAdmission, displayRoundStatus, evidenceSupersededByRequeue, finalizeRoundOutcome, foldVerdictChecks, frozenBindingProblem,
  isFinalizedNonPass, nextTaskEvidenceIndex, outcomeFor, pendingRoundChecks, requiredRoundCoverage, reverifyExemption,
  reverifyFailureClass, rootRoundChain, roundChainHead, roundOpenBasisProblem, roundOpenChecksProblem, roundOpenPointerProblem, roundOpenProblem,
  roundOpenSubjectProblem, roundOrdinalOf, roundReviewerEvidenceProblem, roundSlotKey, roundSlotOwner,
  roundSlotSubjectOf, roundTaskSignal, roundWriteAdmission, taskEvidenceIndexRefOf,
  transitionCheck, transitionRound, withCheckPhase,
  type CheckEvent, type RoundEvent, type RoundFoldFactsV1, type RoundGapV1, type RoundGuardContext,
  type RoundOpenFactsV1, type RoundOpeningV1, type SuccessorRoundBuildV1, type SuccessorRoundInputV1,
  type VerificationEffect,
} from '../../src/core/work-graph/state/verification-machine.js';
import type { Transition, TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

// ------------------------------------------------------------------------ //
// Fixtures                                                                  //
// ------------------------------------------------------------------------ //

const P = 'vr-project', W = 'vr-workspace', G = 'vr-goal', T = 'vr-task';
const AT = '2026-10-04T02:00:00.000Z';
const sha = (char: string): string => char.repeat(64);

const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const planRef2: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-2' };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const roundRef = (roundId: string, runId = 'run-1', taskId = T): VerificationRoundRef =>
  ({ aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId, runId, roundId });
const cov = (requirementId: string, obligationId = 'ob-1'): EvidenceCoverageV1 => ({ obligationId, requirementId });
const evidence = (evidenceId: string): EvidenceRef => ({ aggregateType: 'Evidence', projectId: P, evidenceId });
const operator: CheckHostActor = { kind: 'human', id: 'operator-1' };
const hostExecutor: CheckHostActor = { kind: 'system', id: 'host-checks' };
const REPORT: ArtifactRef = { kind: 'artifact', contentType: 'application/json', digest: sha('d'), sizeBytes: 42,
  source: { kind: 'workspace', refId: W, revision: '1' } };

const def = (checkId: string): RegisteredCommandCheck =>
  ({ checkId, kind: 'static', command: `run ${checkId}`, cwd: '.', timeoutMs: 60_000, taskIds: 'all' });
const configuration = (revision: string, executor: CheckHostActor): TrustedCheckConfiguration => ({
  configurationRevision: revision, workspace: { aggregateType: 'Workspace', projectId: P, workspaceId: W }, executor,
  permissionRevision: 'perm-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
  deniedPrefixes: [], checks: ['lint', 'unit', 'c-pending', 'c-exec', 'c-fin', 'c-int'].map(def) });
const CONFIG = configuration('cfg-1', operator);
const CONFIG2 = configuration('cfg-2', hostExecutor);
const policyPin: CompletionPolicyPin = { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'policy-1', revision: 1 },
  digest: sha('e') };
const baselinePin: ArchitectureBaselinePin = { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P,
  baselineId: 'baseline-1', revision: 1 }, digest: sha('f') };
const identity = (sourceDigest: string, gateSubject?: 'goal' | 'stage' | 'module'): VerificationRoundMaterialIdentity => ({
  schemaVersion: 1,
  scope: { projectId: P, workspaceId: W, goalId: G, runId: 'run-1', taskId: T, ...(gateSubject === undefined ? {} : { gateSubject }) },
  runRef: runRef('run-1'), runRevision: 4, runDigest: sha('1'), planRef, planRevision: 1, planDigest: sha('2'),
  taskDigest: sha('3'), goalRevision: 2, goalDigest: sha('4'), workspaceRevision: 3, workspaceDigest: sha('6'),
  workspaceRoot: '/ws/root', policyPin, baselinePin, sourceDigest, sourceProofDigest: sha('7') });
const IDENTITY = identity(sha('5'));
const SOURCE_PROOF = { kind: 'current-workspace-only', runBaselineKnown: false } as const;
type PlanCheckSpec = { checkId: string; coverage: EvidenceCoverageV1[] };
const verificationPlan = (checks: PlanCheckSpec[],
  uncovered?: VerificationPlanV1['uncovered']): VerificationPlanV1 => ({
  schemaVersion: 1, planId: sha('8'), planDigest: sha('8'), taskRef: task, planRef, planRevision: 1, workspaceRevision: 3,
  pinnedCompletionPolicy: policyPin, pinnedArchitectureBaseline: baselinePin,
  changeScope: { diffClass: 'code-change', changedFiles: ['src/a.ts'], writeSummary: 'edit a' },
  semanticChange: 'semantic', risks: [],
  checks: checks.map((check) => ({ checkId: check.checkId, kind: 'static', satisfiesKind: 'static', coverage: check.coverage,
    satisfactionPath: 'predicate' })),
  ...(uncovered === undefined ? {} : { uncovered }), configurationDigest: sha('9') });
const PLAN2 = verificationPlan([{ checkId: 'lint', coverage: [cov('r1')] }, { checkId: 'unit', coverage: [cov('r2')] }]);
const PLAN4 = verificationPlan(['c-pending', 'c-exec', 'c-fin', 'c-int'].map((checkId) => ({ checkId, coverage: [cov(checkId)] })));

const OPENING: RoundOpeningV1 = { ref: roundRef('round-1'), subject: task, subjectRunRef: runRef('run-1'),
  adoptedPlanRef: planRef, taskBasisRef: planRef, executor: operator, configuration: CONFIG, configurationDigest: sha('a'),
  identity: IDENTITY, sourceProof: SOURCE_PROOF, verificationPlan: PLAN2 };

// Checks and rounds in today's literal key order.
const pendingCheck = (checkId: string, coverage: EvidenceCoverageV1): RoundCheckSnapshot => ({ checkId,
  definition: def(checkId), coverage: [coverage], phase: 'pending', invocationId: null, outcome: null, reportRef: null,
  sourceStatus: null });
const executingCheck = (check: RoundCheckSnapshot, invocationId: string): RoundCheckSnapshot =>
  ({ ...check, phase: 'executing', invocationId });
const finishedCheck = (check: RoundCheckSnapshot, outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'): RoundCheckSnapshot =>
  ({ ...executingCheck(check, `inv-${check.checkId}`), phase: 'finished', outcome, reportRef: REPORT, sourceStatus: 'matched' });
const interruptedCheck = (check: RoundCheckSnapshot, cause: RoundCheckIncompleteCause): RoundCheckSnapshot =>
  ({ ...executingCheck(check, `inv-${check.checkId}`), phase: 'interrupted', incompleteCause: cause });
const LINT = pendingCheck('lint', cov('r1'));
const UNIT = pendingCheck('unit', cov('r2'));
const pendingGap = (checkId: string, requirementId: string): RoundGapV1 =>
  ({ code: 'pending_check', message: `the required check ${checkId} never ran`, coverage: cov(requirementId) });

/** Today's open@1 (the service's former literal, now `buildOpenedRound`): no `chain`. */
const OPEN_PENDING: RoundSnapshot = { ref: roundRef('round-1'), revision: 1, schemaVersion: 1, subject: { ...task },
  subjectRunRef: runRef('run-1'), adoptedPlanRef: planRef, taskBasisRef: planRef, executor: operator, configuration: CONFIG,
  configurationDigest: sha('a'), identity: IDENTITY, sourceProof: SOURCE_PROOF, verificationPlan: PLAN2,
  checks: [LINT, UNIT], status: 'open', outcome: null, gaps: [], evidenceRefs: [] };
const OPEN_EXECUTING: RoundSnapshot = { ...OPEN_PENDING, revision: 2, checks: [executingCheck(LINT, 'inv-lint'), UNIT] };
const OPEN_INTERRUPTED: RoundSnapshot = { ...OPEN_PENDING, revision: 4,
  checks: [finishedCheck(LINT, 'PASS'), interruptedCheck(UNIT, 'host_restart')] };
const OPEN_SETTLED: RoundSnapshot = { ...OPEN_PENDING, revision: 5, checks: [finishedCheck(LINT, 'PASS'), finishedCheck(UNIT, 'PASS')] };
const FINAL_PASS: RoundSnapshot = { ...OPEN_SETTLED, revision: 6, status: 'finalized', outcome: 'PASS', gaps: [],
  evidenceRefs: [evidence('e-1'), evidence('e-2')] };
const FINAL_FAIL: RoundSnapshot = { ...OPEN_SETTLED, revision: 6, checks: [finishedCheck(LINT, 'PASS'), finishedCheck(UNIT, 'FAIL')],
  status: 'finalized', outcome: 'FAIL', gaps: [], evidenceRefs: [evidence('e-1'), evidence('e-3')] };
const FINAL_INCONCLUSIVE: RoundSnapshot = { ...OPEN_PENDING, revision: 2, status: 'finalized', outcome: 'INCONCLUSIVE',
  gaps: [pendingGap('lint', 'r1'), pendingGap('unit', 'r2')], evidenceRefs: [] };
/** Legacy PASS with gaps (VD-4): a pending check whose requirement another PASS covered. */
const FINAL_PASS_GAPS: RoundSnapshot = { ...OPEN_PENDING, revision: 3, checks: [finishedCheck(LINT, 'PASS'), UNIT],
  status: 'finalized', outcome: 'PASS', gaps: [pendingGap('unit', 'r2')], evidenceRefs: [evidence('e-5')] };

/** One open round with a check in every phase, for the check machine. */
const C_PENDING = pendingCheck('c-pending', cov('c-pending'));
const MIXED: RoundSnapshot = { ...OPEN_PENDING, revision: 7, verificationPlan: PLAN4, checks: [
  C_PENDING,
  executingCheck(pendingCheck('c-exec', cov('c-exec')), 'inv-exec'),
  finishedCheck(pendingCheck('c-fin', cov('c-fin')), 'PASS'),
  interruptedCheck(pendingCheck('c-int', cov('c-int')), 'host_restart'),
] };
const MIXED_FINALIZED: RoundSnapshot = { ...MIXED, revision: 8, status: 'finalized', outcome: 'INCONCLUSIVE',
  gaps: [pendingGap('c-pending', 'c-pending')], evidenceRefs: [] };

/** Today's services read no VD-9 facts, chain or TaskRequeue cover: step 5 adds them with their rows. */
const ctxOf = (state: RoundSnapshot | null, over: Partial<RoundGuardContext> = {}): RoundGuardContext => ({
  callerIsExecutor: true, expectedRevision: state === null ? null : state.revision, instanceLeaseHeld: true, ...over });

const endedRun: Pick<RunSnapshot, 'status' | 'outcome' | 'reconciliation'> = { status: 'ended', outcome: 'completed' };
const OPEN_FACTS: RoundOpenFactsV1 = { planIsActive: true, taskBasisResolved: true,
  relation: { kind: 'work', runTaskIsSubject: true }, subjectRun: endedRun };
const APPLICABLE = { applicability: 'APPLICABLE', basis: 'same-plan', reason: 'the evidence Plan is the adopted Plan' } as const;
const FOLD_OK: RoundFoldFactsV1 = { decisions: { lint: APPLICABLE, unit: APPLICABLE }, sourceCurrent: true, contextGaps: [] };

const executed = (over: Partial<Extract<CheckProcessObservation, { kind: 'executed' }>> = {}): CheckProcessObservation => ({
  kind: 'executed', startedAt: AT, finishedAt: AT, exitCode: 0, signal: null, timedOut: false, cancelled: false,
  stdout: { text: 'ok', totalBytes: 2, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
  effects: { workspaceRevision: 'ws-3', changedPaths: [] }, sandboxProfileVersion: 'bwrap-1', ...over });
const OBSERVED_OK = { permissionRevision: 'perm-1', workspaceRoot: '/ws/root', sourceDigest: sha('5') };

// ------------------------------------------------------------------------ //
// Expectation helpers                                                        //
// ------------------------------------------------------------------------ //

type Expect =
  | { ok: true; same: true; effects: readonly VerificationEffect[] }
  | { ok: true; same: false; next: RoundSnapshot; effects: readonly VerificationEffect[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError; notYet?: true };

const keep = (effects: readonly VerificationEffect[] = []): Expect => ({ ok: true, same: true, effects });
const to = (next: RoundSnapshot, effects: readonly VerificationEffect[]): Expect => ({ ok: true, same: false, next, effects });
const no = (reason: TransitionRejectReason, code: CoreError): Expect => ({ ok: false, reason, code });
const II = no('illegal', 'invalid');
const IB = no('illegal', 'busy');
const SB = no('stale', 'busy');
const DB = no('duplicate', 'busy');
const GI = no('guard_failed', 'incomplete');
const GF = no('guard_failed', 'forbidden');
/** A 新增 (or not-yet-written) row: `illegal`/`invalid` until step 5. */
const NY: Expect = { ok: false, reason: 'illegal', code: 'invalid', notYet: true };

function check(actual: Transition<RoundSnapshot, unknown, VerificationEffect>, expected: Expect, state: RoundSnapshot | null): void {
  if (!expected.ok) {
    expect(actual).toMatchObject({ ok: false, reason: expected.reason, code: expected.code });
    if (!actual.ok) {
      expect(actual.detail.length).toBeGreaterThan(0);
      expect(actual.detail.includes('not implemented before A.2 step 5')).toBe(expected.notYet === true);
    }
    return;
  }
  if (expected.same) {
    expect(actual).toEqual({ ok: true, next: state, effects: expected.effects });
    if (actual.ok) expect(actual.next).toBe(state);
    return;
  }
  expect(actual).toEqual({ ok: true, next: expected.next, effects: expected.effects });
  // Same bytes as today's literals, so the step 3 refactor stores identical rows.
  if (actual.ok) expect(JSON.stringify(actual.next)).toBe(JSON.stringify(expected.next));
}

const row = <L extends string>(labels: readonly L[], ...cells: Expect[]): Record<L, Expect> => {
  expect(cells).toHaveLength(labels.length);
  return Object.fromEntries(labels.map((label, index) => [label, cells[index]!])) as Record<L, Expect>;
};

// ------------------------------------------------------------------------ //
// transitionRound: every (state, event)                                      //
// ------------------------------------------------------------------------ //

const ROUND_STATES = {
  absent: null,
  open_pending: OPEN_PENDING,
  open_executing: OPEN_EXECUTING,
  open_interrupted: OPEN_INTERRUPTED,
  open_settled: OPEN_SETTLED,
  final_pass: FINAL_PASS,
  final_fail: FINAL_FAIL,
  final_inconclusive: FINAL_INCONCLUSIVE,
  final_pass_gaps: FINAL_PASS_GAPS,
} satisfies Record<string, RoundSnapshot | null>;
type RoundStateLabel = keyof typeof ROUND_STATES;
const R_COLS = Object.keys(ROUND_STATES) as RoundStateLabel[];
const r = (...cells: Expect[]): Record<RoundStateLabel, Expect> => row(R_COLS, ...cells);

/** Evidence refs per state for `round_finalized`: one per admission of today's fold (2 for the settled round). */
const finalizeEvent = (state: RoundSnapshot | null): RoundEvent => ({ kind: 'round_finalized', reviewerEvidenceCount: 0,
  fold: FOLD_OK, evidenceRefs: state === OPEN_SETTLED ? [evidence('e-1'), evidence('e-2')] : [] });

const ROUND_EVENTS = {
  round_opened: (): RoundEvent => ({ kind: 'round_opened', opening: OPENING, facts: OPEN_FACTS }),
  evidence_submitted: (): RoundEvent => ({ kind: 'evidence_submitted' }),
  round_finalized: finalizeEvent,
  round_reverified: (): RoundEvent => ({ kind: 'round_reverified', actorClass: 'system' }),
  task_requeued: (): RoundEvent => ({ kind: 'task_requeued', actorClass: 'human' }),
} satisfies Record<RoundEvent['kind'], (state: RoundSnapshot | null) => RoundEvent>;
type RoundEventLabel = keyof typeof ROUND_EVENTS;

const OPENED_EFFECTS: VerificationEffect[] = [{ kind: 'guard_round', expectedRevision: null }, { kind: 'guard_open_read_set' },
  { kind: 'emit_event', eventType: 'VerificationRoundOpened' }];
const CLAIM_EFFECTS: VerificationEffect[] = [{ kind: 'admit_claim_evidence', coverage: [cov('r1'), cov('r2')] },
  { kind: 'append_task_evidence_index' }, { kind: 'emit_event', eventType: 'EvidenceAdmitted' }];
const finalizedEffects = (revision: number, admissions: { ref: EvidenceRef; checkId: string; coverage: EvidenceCoverageV1 }[]):
VerificationEffect[] => [{ kind: 'guard_round', expectedRevision: revision }, { kind: 'admit_verdict_evidence', admissions },
  { kind: 'append_task_evidence_index' }, { kind: 'emit_event', eventType: 'VerificationRoundFinalized' }];
/** Today's finalized round (the service's former literal, now `buildFinalizedRound`). */
const FINALIZED_FROM_PENDING: RoundSnapshot = { ...OPEN_PENDING, revision: 2, status: 'finalized', outcome: 'INCONCLUSIVE',
  gaps: [pendingGap('lint', 'r1'), pendingGap('unit', 'r2')], evidenceRefs: [] };
const FINALIZED_FROM_SETTLED: RoundSnapshot = { ...OPEN_SETTLED, revision: 6, status: 'finalized', outcome: 'PASS', gaps: [],
  evidenceRefs: [evidence('e-1'), evidence('e-2')] };

const ROUND_TABLE: Record<RoundEventLabel, () => Record<RoundStateLabel, Expect>> = {
  // VR-01 from ∅ only; an existing round is never re-opened (§9.4 "回到 open").
  round_opened: () => r(to(OPEN_PENDING, OPENED_EFFECTS), II, II, II, II, II, II, II, II),
  // VR-08 today: also on a finalized round (VD-2 flips it to busy in step 5.3); the round is not written.
  evidence_submitted: () => r(II, keep(CLAIM_EFFECTS), keep(CLAIM_EFFECTS), keep(CLAIM_EFFECTS), keep(CLAIM_EFFECTS),
    keep(CLAIM_EFFECTS), keep(CLAIM_EFFECTS), keep(CLAIM_EFFECTS), keep(CLAIM_EFFECTS)),
  // VR-07 today: executing and interrupted both refuse (`finalizeRoundOutcome`); finalized is busy (`roundWriteAdmission`).
  round_finalized: () => r(II, to(FINALIZED_FROM_PENDING, finalizedEffects(1, [])), GI, GI,
    to(FINALIZED_FROM_SETTLED, finalizedEffects(5, [
      { ref: evidence('e-1'), checkId: 'lint', coverage: cov('r1') },
      { ref: evidence('e-2'), checkId: 'unit', coverage: cov('r2') },
    ])), IB, IB, IB, IB),
  // VR-14/15 (新增) and VR-09 (新增).
  round_reverified: () => r(NY, NY, NY, NY, NY, NY, NY, NY, NY),
  task_requeued: () => r(NY, NY, NY, NY, NY, NY, NY, NY, NY),
};

describe('transitionRound: every (state, event) combination', () => {
  for (const eventLabel of Object.keys(ROUND_EVENTS) as RoundEventLabel[]) {
    for (const stateLabel of R_COLS) {
      it(`${stateLabel} × ${eventLabel}`, () => {
        const state = ROUND_STATES[stateLabel];
        check(transitionRound(state, ROUND_EVENTS[eventLabel](state), ctxOf(state)), ROUND_TABLE[eventLabel]()[stateLabel], state);
      });
    }
  }
});

// ------------------------------------------------------------------------ //
// transitionCheck: every (state, event)                                      //
// ------------------------------------------------------------------------ //

/** The check's state is selected by the event's checkId inside an open (or finalized) round. */
const CHECK_STATES = {
  pending: { round: MIXED, checkId: 'c-pending', invocationId: 'inv-none' },
  executing: { round: MIXED, checkId: 'c-exec', invocationId: 'inv-exec' },
  finished: { round: MIXED, checkId: 'c-fin', invocationId: 'inv-c-fin' },
  interrupted: { round: MIXED, checkId: 'c-int', invocationId: 'inv-c-int' },
  missing: { round: MIXED, checkId: 'c-missing', invocationId: 'inv-none' },
  finalized: { round: MIXED_FINALIZED, checkId: 'c-fin', invocationId: 'inv-c-fin' },
} satisfies Record<string, { round: RoundSnapshot; checkId: string; invocationId: string }>;
type CheckStateLabel = keyof typeof CHECK_STATES;
const C_COLS = Object.keys(CHECK_STATES) as CheckStateLabel[];
const c = (...cells: Expect[]): Record<CheckStateLabel, Expect> => row(C_COLS, ...cells);

const reportFacts = (checkId: string, invocationId: string) => ({ roundRef: MIXED.ref, checkId, invocationId,
  outcome: 'PASS' as const, sourceStatus: 'matched' as const, reportRef: REPORT, bodiesAgree: true });
const CHECK_EVENTS = {
  'check_begun': (checkId: string): CheckEvent => ({ kind: 'check_begun', checkId, invocationId: 'inv-new', observed: OBSERVED_OK }),
  'check_result_recorded': (checkId: string, invocationId: string): CheckEvent => ({ kind: 'check_result_recorded', checkId,
    invocationId, observation: executed(), sourceStatus: 'matched', reportRef: REPORT }),
  'check_interrupted:host_restart': (checkId: string, invocationId: string): CheckEvent => ({ kind: 'check_interrupted', checkId,
    invocationId, cause: 'host_restart', hostInstanceId: 'host-2' }),
  'check_interrupted:ticket_invalid': (checkId: string, invocationId: string): CheckEvent => ({ kind: 'check_interrupted', checkId,
    invocationId, cause: 'ticket_invalid', ticketProblem: 'the ticket has no workspaceRoot' }),
  'check_abandoned': (checkId: string, invocationId: string): CheckEvent => ({ kind: 'check_abandoned', checkId, invocationId,
    cause: 'caller_cancelled', provenNotStarted: true }),
  'check_report_booked': (checkId: string, invocationId: string): CheckEvent => ({ kind: 'check_report_booked', checkId,
    invocationId, hostInstanceId: 'host-2', report: reportFacts(checkId, invocationId) }),
} satisfies Record<string, (checkId: string, invocationId: string) => CheckEvent>;
type CheckEventLabel = keyof typeof CHECK_EVENTS;

/** Today's begin / record literals (the service's former `withCheck` spreads, now `withCheckPhase`). */
const BEGUN = { ...MIXED, revision: MIXED.revision + 1, checks: MIXED.checks.map((one) => one.checkId === 'c-pending'
  ? { ...one, ...{ phase: 'executing' as const, invocationId: 'inv-new' } } : one) };
const RECORDED = { ...MIXED, revision: MIXED.revision + 1, checks: MIXED.checks.map((one) => one.checkId === 'c-exec'
  ? { ...one, ...{ phase: 'finished' as const, outcome: 'PASS' as const, reportRef: REPORT, sourceStatus: 'matched' as const } } : one) };
const guardAt = (revision: number): VerificationEffect => ({ kind: 'guard_round', expectedRevision: revision });

const CHECK_TABLE: Record<CheckEventLabel, () => Record<CheckStateLabel, Expect>> = {
  // VR-02; executing/finished/interrupted busy (D-12); unknown check invalid; finalized busy (`checkEventAdmission`).
  'check_begun': () => c(to(BEGUN, [guardAt(7), { kind: 'emit_event', eventType: 'VerificationCheckBegun' }]), IB, IB, IB, II, IB),
  // VR-03; pending/finished busy (`checkEventAdmission`), a late result on interrupted is stale busy.
  'check_result_recorded': () => c(IB,
    to(RECORDED, [guardAt(7), { kind: 'emit_event', eventType: 'VerificationCheckResultRecorded' }]), IB, SB, II, IB),
  // VR-04 (新增): only executing; the same interruption again is a duplicate.
  'check_interrupted:host_restart': () => c(II, NY, II, DB, II, IB),
  // VR-13 (改造, not written today); another cause on an interrupted check is illegal.
  'check_interrupted:ticket_invalid': () => c(II, NY, II, II, II, IB),
  // VR-05 (改造, not written today); interrupted never returns to pending (D-12).
  'check_abandoned': () => c(II, NY, II, II, II, IB),
  // VR-06 (新增): finished busy, interrupted stale busy (D-12), pending invalid.
  'check_report_booked': () => c(II, NY, IB, SB, II, IB),
};

describe('transitionCheck: every (state, event) combination', () => {
  for (const eventLabel of Object.keys(CHECK_EVENTS) as CheckEventLabel[]) {
    for (const stateLabel of C_COLS) {
      it(`${stateLabel} × ${eventLabel}`, () => {
        const { round, checkId, invocationId } = CHECK_STATES[stateLabel];
        const event = CHECK_EVENTS[eventLabel](checkId, invocationId);
        check(transitionCheck(round, event, ctxOf(round)), CHECK_TABLE[eventLabel]()[stateLabel], round);
      });
    }
  }
});

// ------------------------------------------------------------------------ //
// Guard rows of the round events                                             //
// ------------------------------------------------------------------------ //

const openWith = (facts: Partial<RoundOpenFactsV1>, ctx: Partial<RoundGuardContext> = {}, opening: RoundOpeningV1 = OPENING) =>
  transitionRound(null, { kind: 'round_opened', opening, facts: { ...OPEN_FACTS, ...facts } }, ctxOf(null, ctx));

describe('VR-01 round_opened guards (today)', () => {
  it('refuses a caller that is not the configured executor before any subject fact', () => {
    expect(openWith({ planIsActive: false }, { callerIsExecutor: false }))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the call context is not the registered check Host executor' });
  });

  it('keeps source_stale for a planRef that is not the active Plan, before the basis and Run checks', () => {
    expect(openWith({ planIsActive: false, taskBasisResolved: false, subjectRun: { status: 'running', outcome: null } }))
      .toMatchObject({ ok: false, reason: 'stale', code: 'source_stale' });
  });

  it('refuses an unresolved task basis after the pointer and before the Run checks (`roundOpenBasisProblem`)', () => {
    expect(openWith({ taskBasisResolved: false, relation: { kind: 'work', runTaskIsSubject: false },
      subjectRun: { status: 'running', outcome: null } }))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'incomplete', detail: `the subject task ${T} has no resolved task-state basis` });
  });

  it('splits the subject guards into one step per read, in today order', () => {
    // After the Goal read: only the pointer is known.
    expect(roundOpenPointerProblem(true)).toBeNull();
    expect(roundOpenPointerProblem(false)).toEqual({ ok: false, reason: 'stale', code: 'source_stale',
      detail: 'the requested planRef is not the Goal current adopted Plan' });
    // After the Plan read: the basis.
    expect(roundOpenBasisProblem(true, task)).toBeNull();
    expect(roundOpenBasisProblem(false, task)).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    // After the Run read: relation, then ended; no pointer or basis fact needed.
    expect(roundOpenSubjectProblem({ relation: OPEN_FACTS.relation, subjectRun: endedRun }, task)).toBeNull();
    expect(roundOpenSubjectProblem({ relation: { kind: 'work', runTaskIsSubject: false },
      subjectRun: { status: 'running', outcome: null } }, task)).toMatchObject({ code: 'forbidden',
      detail: 'the subject task is not the subject Run task' });
    expect(roundOpenSubjectProblem({ relation: OPEN_FACTS.relation, subjectRun: { status: 'running', outcome: null } }, task))
      .toMatchObject({ code: 'forbidden', detail: 'the subject Run has not formally ended' });
    // The composed guard is the three steps in that order.
    expect(roundOpenProblem(OPEN_FACTS, task)).toBeNull();
    expect(roundOpenProblem({ ...OPEN_FACTS, planIsActive: false, taskBasisResolved: false }, task)).toMatchObject({ code: 'source_stale' });
    expect(roundOpenProblem({ ...OPEN_FACTS, taskBasisResolved: false, subjectRun: { status: 'running', outcome: null } }, task))
      .toMatchObject({ code: 'incomplete' });
  });

  it('checks the subject relation in today order (`roundOpenSubjectProblem`)', () => {
    expect(openWith({ relation: { kind: 'work', runTaskIsSubject: false } }))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the subject task is not the subject Run task' });
    const gate = (gateAdopted: boolean, producer: 'ok' | 'not_goal_work_run' | 'not_adopted_work' | 'other_workspace') =>
      openWith({ relation: { kind: 'gate', gateSubject: 'goal', gateAdopted, producer } });
    expect(gate(false, 'not_goal_work_run'))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'invalid', detail: `the gate subject ${T} is not an adopted goal gate` });
    expect(gate(true, 'not_goal_work_run')).toMatchObject({ code: 'forbidden', detail: 'the gate producer Run is not a work Run of the same Goal' });
    expect(gate(true, 'not_adopted_work')).toMatchObject({ code: 'forbidden', detail: 'the gate producer Run is not an adopted work task of the same Plan' });
    expect(gate(true, 'other_workspace')).toMatchObject({ code: 'forbidden', detail: 'the gate producer Run belongs to another workspace' });
    const gateOpening: RoundOpeningV1 = { ...OPENING, identity: identity(sha('5'), 'goal') };
    const opened = transitionRound(null, { kind: 'round_opened', opening: gateOpening,
      facts: { ...OPEN_FACTS, relation: { kind: 'gate', gateSubject: 'goal', gateAdopted: true, producer: 'ok' } } }, ctxOf(null));
    expect(opened).toEqual({ ok: true, next: { ...OPEN_PENDING, identity: identity(sha('5'), 'goal') }, effects: OPENED_EFFECTS });
  });

  it('refuses a subject Run that has not ended; today any ended outcome opens (VD-3 is step 5.3)', () => {
    for (const status of ['starting', 'running'] as const) {
      expect(openWith({ subjectRun: { status, outcome: null } }))
        .toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the subject Run has not formally ended' });
    }
    for (const outcome of ['cancelled', 'crashed', 'outcome_unknown', 'yielded'] as const) {
      expect(openWith({ subjectRun: { status: 'ended', outcome } })).toMatchObject({ ok: true, next: OPEN_PENDING });
    }
  });

  it('today writes no chain and claims no slot (step 5 adds the chain, cover and VD-9 facts with their guards)', () => {
    const opened = openWith({});
    expect(opened.ok && 'chain' in opened.next).toBe(false);
    expect(opened.ok && opened.effects.some((effect) => effect.kind === 'claim_round_slot')).toBe(false);
  });

  it('refuses a compiled plan check the frozen configuration does not register (`roundOpenChecksProblem`)', () => {
    const ghost: RoundOpeningV1 = { ...OPENING, verificationPlan: verificationPlan([{ checkId: 'ghost', coverage: [cov('r1')] }]) };
    expect(openWith({}, {}, ghost))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'incomplete', detail: 'the compiled plan names an unregistered check ghost' });
    // The same guard as a step after the compile, before the identity and the round id.
    expect(roundOpenChecksProblem(OPENING.verificationPlan, OPENING.configuration)).toBeNull();
    expect(roundOpenChecksProblem(ghost.verificationPlan, ghost.configuration))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'incomplete', detail: 'the compiled plan names an unregistered check ghost' });
  });

  it('opens with the uncovered requirements as gaps (`buildOpenedRound`)', () => {
    const plan = verificationPlan([{ checkId: 'lint', coverage: [cov('r1')] }],
      [{ obligationId: 'ob-2', requirementId: 'r9', kind: 'dynamic' }]);
    const opened = openWith({}, {}, { ...OPENING, verificationPlan: plan });
    expect(opened).toMatchObject({ ok: true, next: { checks: [LINT], gaps: [{ code: 'uncovered_requirement',
      message: 'no registered check covers required requirement r9', coverage: cov('r9', 'ob-2') }] } });
  });
});

describe('VR-07 / VR-08 guards (today)', () => {
  const finalize = (state: RoundSnapshot, over: Partial<Extract<RoundEvent, { kind: 'round_finalized' }>> = {},
    ctx: Partial<RoundGuardContext> = {}) =>
    transitionRound(state, { ...(finalizeEvent(state) as Extract<RoundEvent, { kind: 'round_finalized' }>), ...over }, ctxOf(state, ctx));

  it('refuses reviewer evidence before anything else (`roundReviewerEvidenceProblem`)', () => {
    expect(finalize(FINAL_PASS, { reviewerEvidenceCount: 1 }, { callerIsExecutor: false }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'unsupported' });
    // The same guard as a step the owner runs before the scope check and the receipt lookup.
    expect(roundReviewerEvidenceProblem(0)).toBeNull();
    expect(roundReviewerEvidenceProblem(2)).toEqual({ ok: false, reason: 'guard_failed', code: 'unsupported',
      detail: 'reviewer evidence finalization is not implemented in R3e.1' });
  });

  it('then finalized (busy), executor (forbidden) and the pin (revision_conflict)', () => {
    expect(finalize(FINAL_PASS, {}, { callerIsExecutor: false, expectedRevision: 1 })).toMatchObject({ code: 'busy' });
    expect(finalize(OPEN_SETTLED, {}, { callerIsExecutor: false, expectedRevision: 1 })).toMatchObject({ code: 'forbidden' });
    expect(finalize(OPEN_SETTLED, {}, { expectedRevision: 4 })).toEqual({ ok: false, reason: 'stale',
      code: 'revision_conflict', detail: 'the round changed since the caller read it' });
    expect(finalize(OPEN_EXECUTING, {}, { expectedRevision: 1 })).toMatchObject({ code: 'revision_conflict' });
    expect(finalize(OPEN_EXECUTING)).toEqual({ ok: false, reason: 'guard_failed', code: 'incomplete',
      detail: 'the check lint is executing; its result window is not reconciled' });
  });

  it('needs one evidence ref per admission', () => {
    expect(finalize(OPEN_SETTLED, { evidenceRefs: [evidence('e-1')] })).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('today an applicable FAIL folds to INCONCLUSIVE with the blocker admitted (D-2 is step 5.3)', () => {
    const failing: RoundSnapshot = { ...OPEN_SETTLED, checks: [finishedCheck(LINT, 'PASS'), finishedCheck(UNIT, 'FAIL')] };
    const result = finalize(failing, { evidenceRefs: [evidence('e-1'), evidence('e-3')] });
    expect(result).toMatchObject({ ok: true, next: { status: 'finalized', outcome: 'INCONCLUSIVE', gaps: [],
      evidenceRefs: [evidence('e-1'), evidence('e-3')] } });
    expect(result.ok && result.effects[1]).toEqual({ kind: 'admit_verdict_evidence', admissions: [
      { ref: evidence('e-1'), checkId: 'lint', coverage: cov('r1') }, { ref: evidence('e-3'), checkId: 'unit', coverage: cov('r2') }] });
  });

  it('VR-08: refuses a non-executor and a round without required coverage', () => {
    expect(transitionRound(OPEN_PENDING, { kind: 'evidence_submitted' }, ctxOf(OPEN_PENDING, { callerIsExecutor: false })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the evidence author is not the round executor' });
    const bare: RoundSnapshot = { ...OPEN_PENDING, verificationPlan: verificationPlan([]), checks: [] };
    expect(transitionRound(bare, { kind: 'evidence_submitted' }, ctxOf(bare))).toEqual({ ok: false, reason: 'guard_failed',
      code: 'incomplete', detail: 'the round has no required verification coverage to attach a claim to' });
    // Today the round is not pinned (VD-2 adds the guard): a stale pin still admits.
    expect(transitionRound(OPEN_PENDING, { kind: 'evidence_submitted' }, ctxOf(OPEN_PENDING, { expectedRevision: 9 })))
      .toMatchObject({ ok: true });
  });

  it('roundWriteAdmission is the pre-IO part of the same rows', () => {
    expect(roundWriteAdmission(OPEN_PENDING, { kind: 'round_opened' }, ctxOf(OPEN_PENDING))).toMatchObject({ code: 'invalid' });
    expect(roundWriteAdmission(null, { kind: 'round_opened' }, ctxOf(null))).toBeNull();
    expect(roundWriteAdmission(null, { kind: 'evidence_submitted' }, ctxOf(null))).toMatchObject({ code: 'invalid' });
    expect(roundWriteAdmission(OPEN_EXECUTING, { kind: 'round_finalized', reviewerEvidenceCount: 0 }, ctxOf(OPEN_EXECUTING))).toBeNull();
    expect(roundOpenProblem(OPEN_FACTS, task)).toBeNull();
  });
});

// ------------------------------------------------------------------------ //
// Guard rows of the check events                                             //
// ------------------------------------------------------------------------ //

describe('check event guards (today order)', () => {
  const run = (event: CheckEvent, ctx: Partial<RoundGuardContext> = {}, round: RoundSnapshot = MIXED) =>
    transitionCheck(round, event, ctxOf(round, ctx));
  const begin = (checkId = 'c-pending', observed = OBSERVED_OK): CheckEvent =>
    ({ kind: 'check_begun', checkId, invocationId: 'inv-new', observed });
  const record = (invocationId = 'inv-exec', observation = executed(), sourceStatus: 'matched' | 'changed' = 'matched'): CheckEvent =>
    ({ kind: 'check_result_recorded', checkId: 'c-exec', invocationId, observation, sourceStatus, reportRef: REPORT });

  it('VR-02: finalized, executor, checkId, pin, phase (`checkEventAdmission`)', () => {
    expect(run(begin(), { callerIsExecutor: false }, MIXED_FINALIZED)).toMatchObject({ code: 'busy',
      detail: 'the round is finalized; no fresh check may begin' });
    expect(run(begin(), { callerIsExecutor: false })).toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden',
      detail: 'the check executor is not the round executor' });
    expect(run(begin('c-missing'), { expectedRevision: 1 })).toEqual({ ok: false, reason: 'illegal', code: 'invalid',
      detail: 'the round has no registered check c-missing' });
    // The pin comes before the phase for a begin.
    expect(run(begin('c-exec'), { expectedRevision: 1 })).toMatchObject({ reason: 'stale', code: 'revision_conflict' });
    expect(run(begin('c-exec'))).toEqual({ ok: false, reason: 'illegal', code: 'busy', detail: 'the check c-exec is already executing' });
    expect(run(begin(), { expectedRevision: null })).toMatchObject({ ok: true });
  });

  it('VR-02: the frozen permission, root and source in that order', () => {
    expect(run(begin('c-pending', { ...OBSERVED_OK, permissionRevision: 'perm-2', workspaceRoot: '/other' }))).toEqual({
      ok: false, reason: 'guard_failed', code: 'forbidden',
      detail: 'the current Host permission revision is not the trusted configuration binding' });
    expect(run(begin('c-pending', { ...OBSERVED_OK, workspaceRoot: '/other', sourceDigest: sha('0') }))).toEqual({
      ok: false, reason: 'guard_failed', code: 'source_stale', detail: 'the current workspace root is not the round fixed root' });
    expect(run(begin('c-pending', { ...OBSERVED_OK, sourceDigest: sha('0') }))).toEqual({ ok: false, reason: 'guard_failed',
      code: 'source_stale', detail: 'the current verification source is not the round fixed source' });
    expect(frozenBindingProblem(MIXED, { permissionRevision: 'perm-1', workspaceRoot: '/ws/root' })).toBeNull();
    // Today's reasons carry no VD-8 marker, so the Workflow keeps waiting (step 5.3 adds them).
    const refused = run(begin('c-pending', { ...OBSERVED_OK, sourceDigest: sha('0') }));
    expect(!refused.ok && beginRefusalIsPermanent({ reason: refused.detail })).toBe(false);
  });

  it('VR-03: finalized, executor, checkId, phase, invocation, pin (`checkEventAdmission`)', () => {
    expect(run(record(), { callerIsExecutor: false })).toMatchObject({ code: 'forbidden' });
    expect(run(record('inv-other'))).toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden',
      detail: 'the ticket is not the begun invocation of this check' });
    expect(run(record('inv-other'), { expectedRevision: 1 })).toMatchObject({ code: 'forbidden' });
    expect(run(record(), { expectedRevision: 1 })).toMatchObject({ reason: 'stale', code: 'revision_conflict' });
    const onPending: CheckEvent = { ...record(), checkId: 'c-pending' } as CheckEvent;
    expect(run(onPending, { expectedRevision: 1 })).toEqual({ ok: false, reason: 'illegal', code: 'busy',
      detail: 'the check c-pending is pending, not executing' });
  });

  it('VR-03: the outcome of each observation, written without incompleteCause today', () => {
    const recorded = (observation: CheckProcessObservation, sourceStatus: 'matched' | 'changed' = 'matched') => {
      const result = run(record('inv-exec', observation, sourceStatus));
      if (!result.ok) throw new Error(result.detail);
      return result.next.checks.find((one) => one.checkId === 'c-exec')!;
    };
    expect(recorded(executed())).toMatchObject({ phase: 'finished', outcome: 'PASS', sourceStatus: 'matched', reportRef: REPORT });
    expect(recorded(executed({ exitCode: 1 })).outcome).toBe('FAIL');
    expect(recorded(executed(), 'changed')).toMatchObject({ outcome: 'INCONCLUSIVE', sourceStatus: 'changed' });
    expect(recorded(executed({ timedOut: true })).outcome).toBe('INCONCLUSIVE');
    expect(recorded({ kind: 'not_started', reason: 'launch_failed', startedAt: AT, finishedAt: AT }).outcome).toBe('INCONCLUSIVE');
    for (const observation of [executed({ timedOut: true }), executed({ exitCode: 1 }), executed()]) {
      expect('incompleteCause' in recorded(observation)).toBe(false);
    }
  });

  it('VR-04 (R): no executor check, then the instance lease; invocation and pin still apply', () => {
    const interrupt = (invocationId = 'inv-exec'): CheckEvent =>
      ({ kind: 'check_interrupted', checkId: 'c-exec', invocationId, cause: 'host_restart', hostInstanceId: 'host-2' });
    check(run(interrupt(), { callerIsExecutor: false }), NY, MIXED);
    expect(run(interrupt(), { instanceLeaseHeld: false })).toEqual({ ok: false, reason: 'guard_failed', code: 'busy',
      detail: 'another live Host holds the instance lease' });
    expect(run(interrupt('inv-other'))).toMatchObject({ code: 'forbidden' });
    expect(run(interrupt(), { expectedRevision: 1 })).toMatchObject({ code: 'revision_conflict' });
    // Another invocation already interrupted: not a duplicate.
    const other: CheckEvent = { kind: 'check_interrupted', checkId: 'c-int', invocationId: 'inv-old', cause: 'host_restart',
      hostInstanceId: 'host-2' };
    expect(run(other)).toMatchObject({ reason: 'illegal', code: 'invalid' });
  });

  it('VR-13 (P): executor, then the proof of an invalid ticket', () => {
    const invalid = (ticketProblem: string | null): CheckEvent =>
      ({ kind: 'check_interrupted', checkId: 'c-exec', invocationId: 'inv-exec', cause: 'ticket_invalid', ticketProblem });
    expect(run(invalid('no root'), { callerIsExecutor: false })).toMatchObject({ code: 'forbidden' });
    expect(run(invalid(null))).toMatchObject({ reason: 'guard_failed', code: 'unavailable' });
    check(run(invalid('no root')), NY, MIXED);
  });

  it('VR-05 (P): executor, then the proof that no process started', () => {
    const abandon = (provenNotStarted: boolean): CheckEvent =>
      ({ kind: 'check_abandoned', checkId: 'c-exec', invocationId: 'inv-exec', cause: 'root_changed', provenNotStarted });
    expect(run(abandon(true), { callerIsExecutor: false })).toMatchObject({ code: 'forbidden' });
    expect(run(abandon(false))).toMatchObject({ reason: 'guard_failed', code: 'unavailable' });
    check(run(abandon(true)), NY, MIXED);
  });

  it('VR-06 (R): the instance lease, then the located report identity and agreement', () => {
    const book = (report: Partial<ReturnType<typeof reportFacts>> = {}): CheckEvent => ({ kind: 'check_report_booked',
      checkId: 'c-exec', invocationId: 'inv-exec', hostInstanceId: 'host-2', report: { ...reportFacts('c-exec', 'inv-exec'), ...report } });
    check(run(book(), { callerIsExecutor: false }), NY, MIXED);
    expect(run(book(), { instanceLeaseHeld: false })).toMatchObject({ code: 'busy' });
    expect(run(book({ roundRef: roundRef('round-9') }))).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(run(book({ checkId: 'c-fin' }))).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(run(book({ invocationId: 'inv-old' }))).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(run(book({ bodiesAgree: false }))).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
  });

  it('checkEventAdmission is the pre-IO part of the same rows', () => {
    expect(checkEventAdmission(MIXED, { kind: 'check_begun', checkId: 'c-pending' }, ctxOf(MIXED))).toBeNull();
    expect(checkEventAdmission(MIXED, { kind: 'check_result_recorded', checkId: 'c-exec', invocationId: 'inv-exec' }, ctxOf(MIXED)))
      .toBeNull();
    expect(checkEventAdmission(MIXED_FINALIZED, { kind: 'check_result_recorded', checkId: 'c-exec', invocationId: 'inv-exec' },
      ctxOf(MIXED_FINALIZED))).toMatchObject({ code: 'busy', detail: 'the round is finalized; no fresh result may be recorded' });
  });
});

// ------------------------------------------------------------------------ //
// outcomeFor (VR-03, C5)                                                     //
// ------------------------------------------------------------------------ //

describe('outcomeFor', () => {
  it('derives the outcome and the INCONCLUSIVE cause in `outcomeFor` order', () => {
    const notStarted: CheckProcessObservation = { kind: 'not_started', reason: 'sandbox_unavailable', startedAt: AT, finishedAt: AT };
    expect(outcomeFor(notStarted, 'changed')).toEqual({ outcome: 'INCONCLUSIVE', incompleteCause: 'not_started' });
    expect(outcomeFor(executed({ timedOut: true }), 'changed')).toEqual({ outcome: 'INCONCLUSIVE', incompleteCause: 'source_not_matched' });
    expect(outcomeFor(executed(), 'unavailable')).toEqual({ outcome: 'INCONCLUSIVE', incompleteCause: 'source_not_matched' });
    expect(outcomeFor(executed(), 'permission_changed').incompleteCause).toBe('source_not_matched');
    expect(outcomeFor(executed({ timedOut: true, cancelled: true }), 'matched'))
      .toEqual({ outcome: 'INCONCLUSIVE', incompleteCause: 'process_timed_out' });
    expect(outcomeFor(executed({ cancelled: true, signal: 'SIGTERM' }), 'matched'))
      .toEqual({ outcome: 'INCONCLUSIVE', incompleteCause: 'process_cancelled' });
    expect(outcomeFor(executed({ signal: 'SIGKILL', exitCode: null }), 'matched').incompleteCause).toBe('process_abnormal');
    expect(outcomeFor(executed({ exitCode: null }), 'matched').incompleteCause).toBe('process_abnormal');
    expect(outcomeFor(executed({ effects: { workspaceRevision: null, changedPaths: [] } }), 'matched'))
      .toEqual({ outcome: 'INCONCLUSIVE', incompleteCause: 'process_abnormal' });
    expect(outcomeFor(executed(), 'matched')).toEqual({ outcome: 'PASS', incompleteCause: null });
    expect(outcomeFor(executed({ exitCode: 2 }), 'matched')).toEqual({ outcome: 'FAIL', incompleteCause: null });
  });
});

// ------------------------------------------------------------------------ //
// Record constructors (§14.1)                                                //
// ------------------------------------------------------------------------ //

describe('record constructors', () => {
  it('buildOpenedRound writes today`s open@1 byte for byte, without a chain', () => {
    const opened = buildOpenedRound(OPENING);
    expect(JSON.stringify(opened)).toBe(JSON.stringify(OPEN_PENDING));
    expect('chain' in opened).toBe(false);
    expect(() => buildOpenedRound({ ...OPENING, verificationPlan: verificationPlan([{ checkId: 'ghost', coverage: [] }]) }))
      .toThrow('unregistered check ghost');
    expect(pendingRoundChecks(PLAN2, CONFIG)).toEqual({ ok: true, checks: [LINT, UNIT] });
    expect(pendingRoundChecks(verificationPlan([{ checkId: 'ghost', coverage: [] }]), CONFIG)).toEqual({ ok: false, checkId: 'ghost' });
  });

  it('withCheckPhase writes each phase and keeps every other byte', () => {
    const exec = MIXED.checks[1]!;
    const interrupted = withCheckPhase(MIXED, 'c-exec', { phase: 'interrupted', incompleteCause: 'ticket_invalid' });
    expect(interrupted.revision).toBe(8);
    expect(interrupted.checks[1]).toEqual({ ...exec, phase: 'interrupted', outcome: null, reportRef: null, sourceStatus: null,
      incompleteCause: 'ticket_invalid' });
    expect(interrupted.checks[1]?.invocationId).toBe('inv-exec');
    expect(withCheckPhase(MIXED, 'c-exec', { phase: 'pending' }).checks[1]).toEqual({ ...exec, phase: 'pending', invocationId: null });
    const finished = withCheckPhase(MIXED, 'c-exec', { phase: 'finished', outcome: 'INCONCLUSIVE', reportRef: REPORT,
      sourceStatus: 'matched', incompleteCause: 'process_timed_out' });
    expect(finished.checks[1]).toEqual({ ...exec, phase: 'finished', outcome: 'INCONCLUSIVE', reportRef: REPORT,
      sourceStatus: 'matched', incompleteCause: 'process_timed_out' });
    expect(JSON.stringify(withCheckPhase(MIXED, 'c-pending', { phase: 'executing', invocationId: 'inv-new' })))
      .toBe(JSON.stringify(BEGUN));
    expect(JSON.stringify({ ...finished, checks: MIXED.checks })).toBe(JSON.stringify({ ...MIXED, revision: 8 }));
    expect(() => withCheckPhase(MIXED, 'c-missing', { phase: 'pending' })).toThrow('no registered check c-missing');
  });

  it('withCheckPhase: VR-05 back to pending clears the invocation, the result fields and any cause', () => {
    const withCause: RoundSnapshot = { ...MIXED, checks: MIXED.checks.map((one) => one.checkId === 'c-exec'
      ? { ...one, incompleteCause: null } : one) };
    const back = withCheckPhase(withCause, 'c-exec', { phase: 'pending' }).checks[1]!;
    expect(back).toEqual({ ...pendingCheck('c-exec', cov('c-exec')) });
    expect('incompleteCause' in back).toBe(false);
    // Same bytes as a check compiled pending at open.
    expect(JSON.stringify(back)).toBe(JSON.stringify(pendingCheck('c-exec', cov('c-exec'))));
  });

  it('withCheckPhase refuses every source phase §9.3 has no row for, and a finalized round', () => {
    const finished = { phase: 'finished', outcome: 'PASS', reportRef: REPORT, sourceStatus: 'matched' } as const;
    // executing ← pending only (VR-02).
    for (const checkId of ['c-exec', 'c-fin', 'c-int']) {
      expect(() => withCheckPhase(MIXED, checkId, { phase: 'executing', invocationId: 'inv-new' }))
        .toThrow('it becomes executing only from pending');
    }
    // finished, interrupted and pending ← executing only (VR-03/06, VR-04/13, VR-05).
    for (const checkId of ['c-pending', 'c-fin', 'c-int']) {
      expect(() => withCheckPhase(MIXED, checkId, finished)).toThrow('it becomes finished only from executing');
      expect(() => withCheckPhase(MIXED, checkId, { phase: 'interrupted', incompleteCause: 'host_restart' }))
        .toThrow('it becomes interrupted only from executing');
      expect(() => withCheckPhase(MIXED, checkId, { phase: 'pending' })).toThrow('it becomes pending only from executing');
    }
    // D-12: an interrupted check never returns to pending.
    expect(() => withCheckPhase(MIXED, 'c-int', { phase: 'pending' }))
      .toThrow('the check c-int is interrupted; it becomes pending only from executing');
    // I-7: a finalized round's checks are settled.
    const finalizedExecuting: RoundSnapshot = { ...MIXED, status: 'finalized', outcome: 'INCONCLUSIVE' };
    expect(() => withCheckPhase(finalizedExecuting, 'c-exec', finished)).toThrow('is finalized');
    expect(() => withCheckPhase(finalizedExecuting, 'c-pending', { phase: 'executing', invocationId: 'inv-new' }))
      .toThrow('is finalized');
  });

  it('withCheckPhase refuses a finished cause that does not match the outcome (§9.1)', () => {
    const finish = (outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE', incompleteCause: RoundCheckIncompleteCause | null) =>
      () => withCheckPhase(MIXED, 'c-exec', { phase: 'finished', outcome, reportRef: REPORT, sourceStatus: 'matched', incompleteCause });
    expect(finish('PASS', 'process_timed_out')).toThrow('a finished PASS check cannot carry the cause process_timed_out');
    expect(finish('FAIL', 'not_started')).toThrow('cannot carry the cause');
    expect(finish('INCONCLUSIVE', 'host_restart')).toThrow('cannot carry the cause host_restart');
    expect(finish('INCONCLUSIVE', 'ticket_invalid')).toThrow('cannot carry the cause ticket_invalid');
    expect(finish('PASS', null)().checks[1]).toMatchObject({ phase: 'finished', outcome: 'PASS', incompleteCause: null });
    expect(finish('INCONCLUSIVE', 'source_not_matched')().checks[1]).toMatchObject({ incompleteCause: 'source_not_matched' });
  });

  it('buildFinalizedRound writes today`s finalized round', () => {
    expect(JSON.stringify(buildFinalizedRound(OPEN_SETTLED, { outcome: 'PASS', gaps: [], evidenceRefs: [evidence('e-1'), evidence('e-2')] })))
      .toBe(JSON.stringify(FINALIZED_FROM_SETTLED));
  });

  it('buildFinalizedRound refuses an executing check (I-7) and a finalized round (§9.4), allows interrupted', () => {
    const result = { outcome: 'INCONCLUSIVE' as const, gaps: [], evidenceRefs: [] };
    expect(() => buildFinalizedRound(OPEN_EXECUTING, result)).toThrow('the check lint is executing; the round cannot be finalized');
    expect(() => buildFinalizedRound(MIXED, result)).toThrow('the check c-exec is executing');
    expect(() => buildFinalizedRound(FINAL_FAIL, { outcome: 'PASS', gaps: [], evidenceRefs: [] }))
      .toThrow('the round round-1 is already finalized; its outcome is not rewritten');
    expect(() => buildFinalizedRound(FINAL_INCONCLUSIVE, result)).toThrow('is already finalized');
    // An interrupted check is no bar for the constructor: the D-2 target (step 5.3) counts it as a gap.
    expect(buildFinalizedRound(OPEN_INTERRUPTED, result)).toMatchObject({ revision: 5, status: 'finalized', outcome: 'INCONCLUSIVE' });
  });

  it('nextTaskEvidenceIndex keeps today`s CAS and zero-append write (VR-11/12 flip in step 5.3)', () => {
    const ref = taskEvidenceIndexRefOf(OPEN_PENDING);
    expect(ref).toEqual({ aggregateType: 'TaskEvidenceIndex', projectId: P, goalId: G, taskId: T });
    const absent = { ref, exists: false, revision: 0, evidenceIds: [] };
    // VR-10: ∅ + k → @k, CAS null.
    expect(nextTaskEvidenceIndex(absent, ['e-1', 'e-2'])).toEqual({ write: true, expectedRevision: null,
      record: { ref, revision: 2, schemaVersion: 1, evidenceIds: ['e-1', 'e-2'] } });
    // VR-11: @n + k → @n+k, CAS n.
    expect(nextTaskEvidenceIndex({ ref, exists: true, revision: 2, evidenceIds: ['e-1', 'e-2'] }, ['e-3'])).toEqual({ write: true,
      expectedRevision: 2, record: { ref, revision: 3, schemaVersion: 1, evidenceIds: ['e-1', 'e-2', 'e-3'] } });
    // Today: a stored legacy @0 row is still guarded with null (the trap of VR-11).
    expect(nextTaskEvidenceIndex({ ref, exists: true, revision: 0, evidenceIds: [] }, ['e-1'])).toMatchObject({ expectedRevision: null });
    // Today: VR-12 zero-append still writes (@0 on a missing row, @n with CAS n).
    expect(nextTaskEvidenceIndex(absent, [])).toEqual({ write: true, expectedRevision: null,
      record: { ref, revision: 0, schemaVersion: 1, evidenceIds: [] } });
    expect(nextTaskEvidenceIndex({ ref, exists: true, revision: 1, evidenceIds: ['e-1'] }, [])).toMatchObject({
      write: true, expectedRevision: 1, record: { revision: 1 } });
  });

  it('rootRoundChain is the ordinal-1 chain of C5', () => {
    expect(rootRoundChain()).toEqual({ schemaVersion: 1, ordinal: 1, predecessorRoundRef: null, predecessorRevision: null,
      supersededEvidenceIds: [], basisDigests: [], autoCount: 0, reverify: null });
  });
});

// ------------------------------------------------------------------------ //
// D-2 fold, today (VR-07)                                                    //
// ------------------------------------------------------------------------ //

describe('finalizeRoundOutcome (today`s fold)', () => {
  const fold = (checks: RoundCheckSnapshot[], facts: Partial<RoundFoldFactsV1> = {}, plan: VerificationPlanV1 = PLAN2) =>
    finalizeRoundOutcome({ ...FOLD_OK, ...facts, round: { checks, verificationPlan: plan } });

  it('refuses an executing or interrupted check', () => {
    expect(fold(OPEN_EXECUTING.checks)).toEqual({ status: 'incomplete',
      detail: 'the check lint is executing; its result window is not reconciled' });
    expect(fold(OPEN_INTERRUPTED.checks)).toEqual({ status: 'incomplete',
      detail: 'the check unit is interrupted; its result window is not reconciled' });
  });

  it('applicable PASS on every requirement → PASS with the coverage admitted', () => {
    expect(fold(OPEN_SETTLED.checks)).toEqual({ status: 'folded', outcome: 'PASS', gaps: [],
      admissions: [{ checkId: 'lint', coverage: cov('r1') }, { checkId: 'unit', coverage: cov('r2') }] });
  });

  it('today an applicable FAIL is a blocker → INCONCLUSIVE; a null outcome reads INCONCLUSIVE', () => {
    expect(fold([finishedCheck(LINT, 'PASS'), finishedCheck(UNIT, 'FAIL')])).toMatchObject({ outcome: 'INCONCLUSIVE', gaps: [],
      admissions: [{ checkId: 'lint', coverage: cov('r1') }, { checkId: 'unit', coverage: cov('r2') }] });
    const nullOutcome = { ...finishedCheck(UNIT, 'PASS'), outcome: null };
    expect(fold([finishedCheck(LINT, 'PASS'), nullOutcome])).toMatchObject({ outcome: 'INCONCLUSIVE' });
  });

  it('today a pending check whose requirement another PASS covers → PASS with gaps (VD-4 is step 5.3)', () => {
    const plan = verificationPlan([{ checkId: 'lint', coverage: [cov('r1')] }, { checkId: 'unit', coverage: [cov('r1')] }]);
    const unitOnR1 = pendingCheck('unit', cov('r1'));
    expect(fold([finishedCheck(LINT, 'PASS'), unitOnR1], {}, plan)).toEqual({ status: 'folded', outcome: 'PASS',
      gaps: [pendingGap('unit', 'r1')], admissions: [{ checkId: 'lint', coverage: cov('r1') }] });
  });

  it('gaps in plan-check order, then uncovered, then the context gaps', () => {
    const plan = verificationPlan([{ checkId: 'gone', coverage: [cov('r0')] }, { checkId: 'lint', coverage: [cov('r1')] },
      { checkId: 'unit', coverage: [cov('r2')] }], [{ obligationId: 'ob-2', requirementId: 'r9', kind: 'dynamic' }]);
    const context: RoundGapV1 = { code: 'source_changed', message: 'the current verification source no longer matches the round fixed source' };
    const redefined = { applicability: 'OUT_OF_SCOPE', basis: 'redefined', reason: 'the frozen task definition changed' } as const;
    const result = fold([finishedCheck(LINT, 'PASS'), UNIT], { decisions: { lint: redefined }, contextGaps: [context] }, plan);
    expect(result).toEqual({ status: 'folded', outcome: 'INCONCLUSIVE', admissions: [], gaps: [
      { code: 'missing_check', message: 'the round is missing required check gone' },
      { code: 'evidence_redefined', message: 'check lint: the frozen task definition changed', coverage: cov('r1') },
      pendingGap('unit', 'r2'),
      { code: 'uncovered_requirement', message: 'no registered check covers required requirement r9', coverage: cov('r9', 'ob-2') },
      context,
    ] });
  });

  it('a stale source or an unreadable Plan admits nothing', () => {
    expect(fold(OPEN_SETTLED.checks, { sourceCurrent: false })).toEqual({ status: 'folded', outcome: 'INCONCLUSIVE', gaps: [],
      admissions: [] });
    // An unreadable Plan: OUT_OF_SCOPE without an evidence gap.
    expect(fold(OPEN_SETTLED.checks, { decisions: null })).toEqual({ status: 'folded', outcome: 'INCONCLUSIVE', gaps: [],
      admissions: [] });
    // A STALE decision is still an evidence gap (`evidence_same-basis`).
    const stale = { applicability: 'STALE', basis: 'same-basis', reason: 'the pinned policy moved' } as const;
    expect(fold(OPEN_SETTLED.checks, { decisions: { lint: stale, unit: APPLICABLE } })).toMatchObject({ outcome: 'INCONCLUSIVE',
      gaps: [{ code: 'evidence_same-basis', message: 'check lint: the pinned policy moved', coverage: cov('r1') }],
      admissions: [{ checkId: 'unit', coverage: cov('r2') }] });
  });

  it('admissions: the first PASS per requirement, then every blocker in candidate order', () => {
    const plan = verificationPlan([{ checkId: 'lint', coverage: [cov('r1'), cov('r2')] }, { checkId: 'unit', coverage: [cov('r1')] },
      { checkId: 'c-fin', coverage: [cov('r1')] }]);
    const lint = finishedCheck({ ...LINT, coverage: [cov('r1'), cov('r2')] }, 'PASS');
    const unit = finishedCheck({ ...UNIT, coverage: [cov('r1')] }, 'FAIL');
    const extra = finishedCheck(pendingCheck('c-fin', cov('r1')), 'INCONCLUSIVE');
    expect(fold([lint, unit, extra], { decisions: { lint: APPLICABLE, unit: APPLICABLE, 'c-fin': APPLICABLE } }, plan)).toEqual({
      status: 'folded', outcome: 'INCONCLUSIVE', gaps: [], admissions: [
        { checkId: 'lint', coverage: cov('r1') }, { checkId: 'lint', coverage: cov('r2') },
        { checkId: 'unit', coverage: cov('r1') }, { checkId: 'c-fin', coverage: cov('r1') }] });
  });

  it('two applicable PASS on one requirement: the first in plan-check order is admitted (`coverage.ts:96-101`)', () => {
    const lint = finishedCheck(LINT, 'PASS');
    const unitOnR1 = finishedCheck(pendingCheck('unit', cov('r1')), 'PASS');
    const both = { decisions: { lint: APPLICABLE, unit: APPLICABLE } };
    const lintFirst = verificationPlan([{ checkId: 'lint', coverage: [cov('r1')] }, { checkId: 'unit', coverage: [cov('r1')] }]);
    const unitFirst = verificationPlan([{ checkId: 'unit', coverage: [cov('r1')] }, { checkId: 'lint', coverage: [cov('r1')] }]);
    // The round's check order does not matter; the plan's does.
    expect(fold([lint, unitOnR1], both, lintFirst)).toEqual({ status: 'folded', outcome: 'PASS', gaps: [],
      admissions: [{ checkId: 'lint', coverage: cov('r1') }] });
    expect(fold([lint, unitOnR1], both, unitFirst)).toEqual({ status: 'folded', outcome: 'PASS', gaps: [],
      admissions: [{ checkId: 'unit', coverage: cov('r1') }] });
  });

  it('foldVerdictChecks: the finished checks in plan-check order, up to where the fold stops', () => {
    const ids = (round: Pick<RoundSnapshot, 'checks' | 'verificationPlan'>) => foldVerdictChecks(round).map((one) => one.checkId);
    expect(foldVerdictChecks(OPEN_SETTLED)).toEqual(OPEN_SETTLED.checks);
    expect(ids({ checks: [...OPEN_SETTLED.checks].reverse(), verificationPlan: PLAN2 })).toEqual(['lint', 'unit']);
    // Missing and pending checks give no verdict; the walk ends at an executing or interrupted check.
    expect(ids(OPEN_PENDING)).toEqual([]);
    expect(ids(OPEN_EXECUTING)).toEqual([]);
    expect(ids(OPEN_INTERRUPTED)).toEqual(['lint']);
    const plan = verificationPlan([{ checkId: 'gone', coverage: [cov('r0')] }, { checkId: 'c-pending', coverage: [cov('c-pending')] },
      { checkId: 'c-fin', coverage: [cov('c-fin')] }, { checkId: 'c-exec', coverage: [cov('c-exec')] },
      { checkId: 'c-int', coverage: [cov('c-int')] }]);
    expect(ids({ checks: MIXED.checks, verificationPlan: plan })).toEqual(['c-fin']);
  });
});

// ------------------------------------------------------------------------ //
// Pure helpers                                                               //
// ------------------------------------------------------------------------ //

describe('display, coverage, refusal markers and slots', () => {
  it('displayRoundStatus maps the §9.1 design names', () => {
    expect(displayRoundStatus(OPEN_EXECUTING)).toBe('running');
    expect(displayRoundStatus({ status: 'open', checks: [interruptedCheck(LINT, 'host_restart'), finishedCheck(UNIT, 'PASS')] }))
      .toBe('interrupted');
    expect(displayRoundStatus({ status: 'open', checks: [interruptedCheck(LINT, 'host_restart'), UNIT] })).toBe('incomplete');
    expect(displayRoundStatus(OPEN_SETTLED)).toBe('incomplete');
    expect(displayRoundStatus(OPEN_PENDING)).toBe('incomplete');
    expect(displayRoundStatus(FINAL_FAIL)).toBe('completed');
  });

  it('requiredRoundCoverage dedupes the plan coverage and adds the uncovered requirements', () => {
    const plan = verificationPlan([{ checkId: 'lint', coverage: [cov('r1'), cov('r2')] }, { checkId: 'unit', coverage: [cov('r1')] }],
      [{ obligationId: 'ob-1', requirementId: 'r2', kind: 'static' }, { obligationId: 'ob-2', requirementId: 'r9', kind: 'dynamic' }]);
    expect(requiredRoundCoverage({ verificationPlan: plan })).toEqual([cov('r1'), cov('r2'), cov('r9', 'ob-2')]);
  });

  it('beginRefusalIsPermanent reads only the three L-9 prefixes', () => {
    for (const marker of ['frozen_permission_changed', 'frozen_root_changed', 'frozen_source_changed']) {
      expect(beginRefusalIsPermanent({ reason: `${marker}: the binding changed` })).toBe(true);
      expect(beginRefusalIsPermanent({ reason: `${marker} the binding changed` })).toBe(false);
      expect(beginRefusalIsPermanent({ reason: `wait: ${marker}: later` })).toBe(false);
    }
    expect(beginRefusalIsPermanent({ reason: 'the current workspace root is not the round fixed root' })).toBe(false);
  });

  it('roundSlotKey: work per subject Run, gate per gate (no runId); the owner is the round refKey', () => {
    const work = roundSlotSubjectOf(OPEN_PENDING);
    expect(work).toEqual({ kind: 'work', projectId: P, workspaceId: W, goalId: G, taskId: T, runId: 'run-1' });
    expect(roundSlotKey(work)).toBe(`verification-round-subject:${canonicalJson({ projectId: P, workspaceId: W, goalId: G,
      taskId: T, runId: 'run-1' })}`);
    const gate = roundSlotSubjectOf({ ref: roundRef('round-1', 'run-7'), identity: identity(sha('5'), 'stage') });
    expect(gate).toEqual({ kind: 'gate', projectId: P, workspaceId: W, goalId: G, taskId: T });
    expect(roundSlotKey(gate)).toBe(`verification-round-gate:${canonicalJson({ projectId: P, workspaceId: W, goalId: G, taskId: T })}`);
    // Every producer Run of the same gate shares the one gate slot (VD-15).
    expect(roundSlotKey(gate)).toBe(roundSlotKey(roundSlotSubjectOf({ ref: roundRef('round-2', 'run-8'),
      identity: identity(sha('5'), 'stage') })));
    expect(roundSlotOwner(OPEN_PENDING.ref)).toBe(canonicalJson(OPEN_PENDING.ref));
  });
});

// ------------------------------------------------------------------------ //
// Round chain (VD-5, VD-12..VD-15; planned verification-chain.test.ts)       //
// ------------------------------------------------------------------------ //

const basis = (digest: string): ReverifyBasisV1 => ({ subject: task, subjectRunId: 'run-1', actionKind: 'reverify',
  failure: { checks: [{ checkId: 'unit', phase: 'finished', outcome: 'FAIL', cause: null }], gapCodes: [] },
  source: { workspaceRevision: 3, sourceDigest: sha('c') },
  configuration: { configurationRevision: 'cfg-2', configurationDigest: sha('b') },
  verificationInputs: { basisPlanRef: planRef, completionPolicyPin: policyPin, architectureBaselinePin: baselinePin },
  newInputDigest: null, digest });
const IDENTITY2 = identity(sha('c'));
const BUILD: SuccessorRoundBuildV1 = { adoptedPlanRef: planRef2, taskBasisRef: planRef, configuration: CONFIG2,
  configurationDigest: sha('b'), identity: IDENTITY2, sourceProof: SOURCE_PROOF, verificationPlan: PLAN2 };
const WORKFLOW = { kind: 'system', id: 'workflow:auto-rework' } as const;
const successorInput = (predecessor: RoundSnapshot, roundId: string, over: Partial<SuccessorRoundInputV1['reverify']> = {}):
SuccessorRoundInputV1 => ({ predecessor, roundId, build: BUILD, reverify: { requestedBy: WORKFLOW, actorClass: 'system',
  requestedAt: AT, basis: basis(sha('1')), newInputRefs: [], reason: 'auto-reverify:check_failed#1', ...over } });
const finalizedAs = (round: RoundSnapshot, outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE', ids: string[], gaps: RoundGapV1[] = []) =>
  buildFinalizedRound(round, { outcome, gaps, evidenceRefs: ids.map(evidence) });
const interruptedGap: RoundGapV1 = { code: 'interrupted_check', message: 'unit was interrupted by a Host restart' };

describe('buildSuccessorRound (VR-14 record, VD-12/VD-13)', () => {
  it('writes the successor @1 on the predecessor subject with the chain linked to it', () => {
    const before = JSON.stringify(FINAL_FAIL);
    const successor = buildSuccessorRound(successorInput(FINAL_FAIL, 'round-2'));
    const expected: RoundSnapshot = { ref: roundRef('round-2'), revision: 1, schemaVersion: 1, subject: { ...task },
      subjectRunRef: runRef('run-1'), adoptedPlanRef: planRef2, taskBasisRef: planRef, executor: hostExecutor, configuration: CONFIG2,
      configurationDigest: sha('b'), identity: IDENTITY2, sourceProof: SOURCE_PROOF, verificationPlan: PLAN2, checks: [LINT, UNIT],
      status: 'open', outcome: null, gaps: [], evidenceRefs: [],
      chain: { schemaVersion: 1, ordinal: 2, predecessorRoundRef: FINAL_FAIL.ref, predecessorRevision: 6,
        supersededEvidenceIds: ['e-1', 'e-3'], basisDigests: [sha('1')], autoCount: 1,
        reverify: { requestedBy: WORKFLOW, actorClass: 'system', failureClass: 'check_failed', requestedAt: AT, basis: basis(sha('1')),
          exemption: 'none', sourceChanged: true, newInputRefs: [], reason: 'auto-reverify:check_failed#1' } } };
    expect(JSON.stringify(successor)).toBe(JSON.stringify(expected));
    // VR-15: the predecessor is never written.
    expect(JSON.stringify(FINAL_FAIL)).toBe(before);
  });

  it('accumulates R1 → R2 → R3: ordinal, superseded ids (ancestors first) and basis digests', () => {
    const r2 = finalizedAs(buildSuccessorRound(successorInput(FINAL_FAIL, 'round-2')), 'INCONCLUSIVE', ['e-4']);
    const r3 = buildSuccessorRound(successorInput(r2, 'round-3', { requestedBy: operator, actorClass: 'human',
      basis: basis(sha('2')), reason: 'operator reverify' }));
    expect(r3.chain).toMatchObject({ ordinal: 3, predecessorRoundRef: roundRef('round-2'), predecessorRevision: 2,
      supersededEvidenceIds: ['e-1', 'e-3', 'e-4'], basisDigests: [sha('1'), sha('2')], autoCount: 0,
      reverify: { actorClass: 'human', failureClass: 'check_incomplete', sourceChanged: false } });
    expect(roundChainHead([r3, FINAL_FAIL, r2])).toEqual({ kind: 'head', head: r3, chain: [FINAL_FAIL, r2, r3] });
    expect(chainEvidenceIds(r2)).toEqual(['e-1', 'e-3', 'e-4']);
  });

  it('autoCount: human 0, Host interruption keeps it, otherwise +1 (legacy root reads 0)', () => {
    const interrupted: RoundSnapshot = finalizedAs({ ...OPEN_PENDING, checks: [finishedCheck(LINT, 'PASS'),
      interruptedCheck(UNIT, 'host_restart')], chain: { ...rootRoundChain(), autoCount: 0 } }, 'INCONCLUSIVE', ['e-6'], [interruptedGap]);
    const counted = (predecessorAuto: number, round: RoundSnapshot, actorClass: 'human' | 'system' | 'agent') =>
      buildSuccessorRound(successorInput({ ...round, chain: { ...(round.chain ?? rootRoundChain()), autoCount: predecessorAuto } },
        'round-x', { actorClass })).chain?.autoCount;
    expect(counted(2, interrupted, 'agent')).toBe(2);
    expect(counted(2, interrupted, 'human')).toBe(0);
    expect(counted(2, FINAL_FAIL, 'system')).toBe(3);
    const notStarted = { ...interrupted, checks: [finishedCheck(LINT, 'PASS'),
      { ...finishedCheck(UNIT, 'INCONCLUSIVE'), incompleteCause: 'not_started' as const }], gaps: [] };
    expect(counted(2, notStarted, 'system')).toBe(3);
    expect(buildSuccessorRound(successorInput(FINAL_FAIL, 'round-2')).chain?.autoCount).toBe(1);
  });

  it('takes only the built fields: a full opening keeps the predecessor subject and the configured executor (VD-12)', () => {
    // VR-14 shares `prepareRoundOpening` with VR-01, which returns a full opening with its own ref and the caller as executor.
    const fullOpening: RoundOpeningV1 = { ...BUILD, ref: roundRef('round-x', 'run-9', 'other-task'),
      subject: { ...task, taskId: 'other-task' }, subjectRunRef: runRef('run-9'), executor: operator };
    const successor = buildSuccessorRound({ ...successorInput(FINAL_FAIL, 'round-2'), build: fullOpening });
    expect(JSON.stringify(successor)).toBe(JSON.stringify(buildSuccessorRound(successorInput(FINAL_FAIL, 'round-2'))));
    expect(successor).toMatchObject({ ref: roundRef('round-2'), subject: task, subjectRunRef: runRef('run-1'),
      executor: CONFIG2.executor });
  });

  it('refuses a predecessor that is not a finalized non-PASS head', () => {
    expect(() => buildSuccessorRound(successorInput(FINAL_PASS, 'round-2'))).toThrow('no successor');
    expect(() => buildSuccessorRound(successorInput(OPEN_SETTLED, 'round-2'))).toThrow('no successor');
    expect(buildSuccessorRound(successorInput(FINAL_PASS_GAPS, 'round-2')).chain?.reverify?.failureClass).toBe('check_incomplete');
  });
});

describe('roundChainHead (VD-14)', () => {
  const r2 = finalizedAs(buildSuccessorRound(successorInput(FINAL_FAIL, 'round-2')), 'FAIL', ['e-4']);

  it('none, a single legacy root, and a chain in any input order', () => {
    expect(roundChainHead([])).toEqual({ kind: 'none' });
    expect(roundChainHead([OPEN_PENDING])).toEqual({ kind: 'head', head: OPEN_PENDING, chain: [OPEN_PENDING] });
    expect(roundChainHead([r2, FINAL_FAIL])).toEqual({ kind: 'head', head: r2, chain: [FINAL_FAIL, r2] });
    const rooted = { ...OPEN_PENDING, chain: rootRoundChain() };
    expect(roundChainHead([rooted])).toMatchObject({ kind: 'head', head: rooted });
    expect(roundOrdinalOf(OPEN_PENDING)).toBe(1);
    expect(roundOrdinalOf(r2)).toBe(2);
  });

  it('a legacy PASS with gaps may have a successor', () => {
    const next = buildSuccessorRound(successorInput(FINAL_PASS_GAPS, 'round-2'));
    expect(roundChainHead([FINAL_PASS_GAPS, next])).toMatchObject({ kind: 'head', head: next });
  });

  it('invalid: two roots, an ordinal gap or repeat, a wrong predecessor, a PASS/open predecessor, two runIds', () => {
    const invalid = (rounds: RoundSnapshot[]) => roundChainHead(rounds).kind;
    expect(invalid([OPEN_PENDING, { ...FINAL_FAIL, ref: roundRef('round-0') }])).toBe('invalid');
    expect(invalid([FINAL_FAIL, { ...r2, chain: { ...r2.chain!, ordinal: 3 } }])).toBe('invalid');
    expect(invalid([FINAL_FAIL, r2, { ...r2, ref: roundRef('round-2b') }])).toBe('invalid');
    expect(invalid([{ ...FINAL_FAIL, ref: roundRef('round-0') }, r2])).toBe('invalid');
    expect(invalid([{ ...FINAL_FAIL, status: 'open', outcome: null }, r2])).toBe('invalid');
    expect(invalid([{ ...FINAL_FAIL, outcome: 'PASS', gaps: [] }, r2])).toBe('invalid');
    expect(invalid([{ ...OPEN_PENDING, chain: { ...rootRoundChain(), predecessorRoundRef: roundRef('round-0') } }])).toBe('invalid');
    expect(invalid([{ ...r2, chain: { ...r2.chain!, ordinal: 0 } }])).toBe('invalid');
    // A gate chain read by task must stay on one anchored producer Run.
    const gateRoot = (runId: string, roundId: string): RoundSnapshot => ({ ...FINAL_FAIL, ref: roundRef(roundId, runId) });
    expect(roundChainHead([gateRoot('run-1', 'g-1'), gateRoot('run-2', 'g-2')])).toEqual({ kind: 'invalid',
      reason: 'round g-2 belongs to another subject than round g-1' });
    expect(roundChainHead([OPEN_PENDING, { ...FINAL_FAIL, ref: roundRef('round-0') }])).toEqual({ kind: 'invalid',
      reason: 'rounds round-1 and round-0 are both chain roots' });
  });
});

describe('chain evidence, failure class and exemption', () => {
  it('chainEvidenceIds and evidenceSupersededByRequeue keep first-occurrence order without repeats', () => {
    expect(chainEvidenceIds(FINAL_FAIL)).toEqual(['e-1', 'e-3']);
    expect(chainEvidenceIds({ evidenceRefs: [evidence('e-9')], chain: { ...rootRoundChain(), ordinal: 2,
      predecessorRoundRef: roundRef('round-0'), predecessorRevision: 3, supersededEvidenceIds: ['e-1', 'e-9'] } }))
      .toEqual(['e-1', 'e-9']);
    const requeues: Pick<TaskRequeueSnapshotV1, 'supersededEvidenceIds'>[] = [{ supersededEvidenceIds: ['e-1', 'e-3'] },
      { supersededEvidenceIds: [] }, { supersededEvidenceIds: ['e-3', 'e-7'] }];
    expect(evidenceSupersededByRequeue(requeues)).toEqual(['e-1', 'e-3', 'e-7']);
    expect(evidenceSupersededByRequeue([])).toEqual([]);
  });

  it('reverifyFailureClass and isFinalizedNonPass', () => {
    expect(reverifyFailureClass(FINAL_FAIL)).toBe('check_failed');
    expect(reverifyFailureClass(FINAL_INCONCLUSIVE)).toBe('check_incomplete');
    expect(reverifyFailureClass(FINAL_PASS_GAPS)).toBe('check_incomplete');
    expect(reverifyFailureClass(FINAL_PASS)).toBeNull();
    expect(reverifyFailureClass(OPEN_SETTLED)).toBeNull();
    expect([FINAL_FAIL, FINAL_INCONCLUSIVE, FINAL_PASS_GAPS, FINAL_PASS, OPEN_PENDING].map(isFinalizedNonPass))
      .toEqual([true, true, true, false, false]);
  });

  it('reverifyExemption (§13.7 point 3)', () => {
    const withChecks = (checks: RoundCheckSnapshot[], gaps: RoundGapV1[] = [interruptedGap]) => reverifyExemption({ checks, gaps });
    const finished = (cause: RoundCheckIncompleteCause | null) =>
      cause === null ? finishedCheck(UNIT, 'INCONCLUSIVE') : { ...finishedCheck(UNIT, 'INCONCLUSIVE'), incompleteCause: cause };
    const pass = finishedCheck(LINT, 'PASS');
    expect(withChecks([pass, interruptedCheck(UNIT, 'host_restart')])).toBe('host_interruption');
    expect(withChecks([pass, finished('not_started')], [])).toBe('not_started');
    expect(withChecks([interruptedCheck(LINT, 'host_restart'), finished('not_started')])).toBe('not_started');
    expect(withChecks([pass, interruptedCheck(UNIT, 'ticket_invalid')])).toBe('none');
    expect(withChecks([pass, finished('process_timed_out')], [])).toBe('none');
    expect(withChecks([pass, finished('process_cancelled')], [])).toBe('none');
    expect(withChecks([pass, interruptedCheck(UNIT, 'host_restart')], [interruptedGap,
      { code: 'uncovered_requirement', message: 'no check covers r9' }])).toBe('none');
    // A legacy check has no cause.
    expect(withChecks([pass, { ...interruptedCheck(UNIT, 'host_restart'), incompleteCause: null }])).toBe('none');
    expect(withChecks([pass, finished(null)], [])).toBe('none');
    expect(withChecks([pass], [])).toBe('none');
    expect(withChecks([pass, UNIT], [pendingGap('unit', 'r2')])).toBe('none');
  });
});

describe('roundTaskSignal (projection input, §4 P7–P13, P20)', () => {
  it('maps the chain head', () => {
    expect(roundTaskSignal([])).toEqual({ kind: 'none' });
    expect(roundTaskSignal([OPEN_PENDING, { ...FINAL_FAIL, ref: roundRef('round-0') }])).toMatchObject({ kind: 'invalid' });
    expect(roundTaskSignal([OPEN_INTERRUPTED])).toEqual({ kind: 'open', head: OPEN_INTERRUPTED, ordinal: 1,
      predecessorRoundRef: null, interruptedCheckIds: ['unit'], unsettled: false });
    const interruptedPending = { ...OPEN_PENDING, checks: [interruptedCheck(LINT, 'host_restart'), UNIT] };
    expect(roundTaskSignal([interruptedPending])).toMatchObject({ kind: 'open', interruptedCheckIds: ['lint'], unsettled: true });
    expect(roundTaskSignal([FINAL_FAIL])).toEqual({ kind: 'fail', head: FINAL_FAIL, ordinal: 1, failedCheckIds: ['unit'] });
    expect(roundTaskSignal([FINAL_INCONCLUSIVE])).toEqual({ kind: 'inconclusive', head: FINAL_INCONCLUSIVE, ordinal: 1,
      gapCodes: ['pending_check'], legacyPassWithGaps: false });
    expect(roundTaskSignal([FINAL_PASS_GAPS])).toMatchObject({ kind: 'inconclusive', legacyPassWithGaps: true });
    expect(roundTaskSignal([FINAL_PASS])).toEqual({ kind: 'pass', head: FINAL_PASS, ordinal: 1 });
    const successor = buildSuccessorRound(successorInput(FINAL_FAIL, 'round-2'));
    expect(roundTaskSignal([FINAL_FAIL, successor])).toMatchObject({ kind: 'open', ordinal: 2,
      predecessorRoundRef: FINAL_FAIL.ref, unsettled: true });
  });

  it('the chain lookup limit leaves room for ROUND_CHAIN_MAX rounds', () => {
    let head: RoundSnapshot = FINAL_FAIL;
    const rounds = [head];
    for (let ordinal = 2; ordinal <= ROUND_CHAIN_MAX; ordinal += 1) {
      head = finalizedAs(buildSuccessorRound(successorInput(head, `round-${ordinal}`, { basis: basis(sha(String(ordinal % 10))) })),
        'FAIL', [`x-${ordinal}`]);
      rounds.push(head);
    }
    const result = roundChainHead([...rounds].reverse());
    expect(result).toMatchObject({ kind: 'head', head });
    expect(roundOrdinalOf(head)).toBe(ROUND_CHAIN_MAX);
    expect(head.chain?.supersededEvidenceIds).toHaveLength(2 + ROUND_CHAIN_MAX - 2);
    // I-20: n ≤ ROUND_CHAIN_MAX, so the head at the limit has no successor (VR-14 refuses first, step 5.9).
    expect(() => buildSuccessorRound(successorInput(head, `round-${ROUND_CHAIN_MAX + 1}`)))
      .toThrow(`round round-${ROUND_CHAIN_MAX} is at the chain limit ${ROUND_CHAIN_MAX} and has no successor`);
  });
});
