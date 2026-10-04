/**
 * A.2 step 2 (spec §15.2 第 2 步): `state/no-progress.ts`, the §13 keys.
 *
 * - Guard domain, every combination: Run status × outcome × chain head ×
 *   basis lookup for `noProgressKey`; head × basis for `reverifyBasis`. A
 *   built key is `ok:true` with `effects:[]` (SD-1).
 * - `runFailureOrigin` over every reconciliation observation × outcome (ND-5).
 * - Key stability (§13.6): ids, reason, time, report bodies, actor class,
 *   requested budget, trigger and automatic count never move the digest; check
 *   order never matters; `phase` and `cause` do; legacy checks read
 *   `cause: null`; `exhaustedTokenBudget` only for `budget_exhausted`; `plan`
 *   is the Task's effective basis (L-4); new inputs are a canonical set (order,
 *   repeats, wider refs and an Artifact's `source` never matter: an Artifact
 *   counts by its content key, hard limit 2).
 * - `roundFailureFacts` over every check phase × outcome.
 * - §13.4 and §13.7 examples at the key level. The skip rules (ND-5, ND-6),
 *   budget, cap and the refusal record are guards of `task-machine.ts` /
 *   `verification-machine.ts` and are tested there; here a comparison is the
 *   ND-3 rule "same digest as any earlier key".
 *
 * Pure: no RecordStore, no kernel, no clock.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type {
  RunOutcome, RunReconciliationV1, RunRef, RunStatus, RuntimeEventV1, TaskTriple,
} from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ArchitectureBaselinePin, CompletionPolicyPin } from '../../src/contracts/governance.js';
import {
  MANIFEST_CONTENT_TYPE, REPORT_CONTENT_TYPE, newBasisInputProblem, type NewBasisInputRefV1, type NoProgressKeyV1,
} from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type {
  ReverifyBasisV1, RoundCheckSnapshot, RoundSnapshot, VerificationRoundRef,
} from '../../src/contracts/verification.js';
import {
  keyCheckFacts, newBasisInputDigest, noProgressKey, reverifyBasis, roundFailureFacts, runFailureOrigin,
  type KeyRoundV1, type NoProgressKeyInputV1, type ReverifyBasisInputV1, type TaskBasisLookupV1,
} from '../../src/core/work-graph/state/no-progress.js';
import { buildEffectiveTaskBasis } from '../../src/core/work-graph/tasks/plan-task-basis.js';

// ------------------------------------------------------------------------ //
// Fixtures                                                                  //
// ------------------------------------------------------------------------ //
const P = 'np-project', G = 'np-goal', T = 'np-task', W = 'np-workspace';
const taskRef: TaskTriple = { projectId: P, goalId: G, taskId: T };
const planRef = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: P, planId });
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const time = (second: number): string => `2026-10-04T00:00:${String(second).padStart(2, '0')}.000Z`;
const src = (seed: string, workspaceRevision = 3) => ({ workspaceRevision, sourceDigest: sha256Hex(`source:${seed}`) });
const artifact = (seed: string, contentType = 'text/markdown'): ArtifactRef => ({
  kind: 'artifact', contentType, digest: sha256Hex(`artifact:${seed}`), sizeBytes: 40,
  source: { kind: 'workspace', refId: W, revision: '3' },
});
const artifactInput = (seed: string): NewBasisInputRefV1 => ({ kind: 'artifact', ref: artifact(seed) });
const messageInput = (messageId: string): NewBasisInputRefV1 => ({
  kind: 'session_message', ref: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId },
});
const intentRef = (intentId: string): ControlIntentRef => ({ aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId });

type KeyRun = NoProgressKeyInputV1['afterRun'];
const run = (runId: string, outcome: RunOutcome | null = 'completed', extra: Partial<KeyRun> = {}): KeyRun => ({
  ref: runRef(runId), status: 'ended', outcome, budget: { tokenBudget: 100_000, deadline: null }, ...extra,
});
const runtimeEvent = (runId: string, payload: RuntimeEventV1['payload'], at = time(1)): RuntimeEventV1 => ({
  eventType: payload.kind === 'crashed' ? 'run_crashed' : payload.kind === 'cancelled' ? 'run_cancelled' : 'run_completed',
  schemaVersion: 1, eventId: `evt-${runId}`, runRef: runRef(runId), sequence: 7, occurredAt: at, payload,
});
const reconciliation = (observation: RunReconciliationV1['observation'], recordedAt = time(2)): RunReconciliationV1 =>
  ({ status: 'done', observation, basis: { kind: 'live_clean' }, recordedAt });
/** RUN-19 (executing) or RUN-24 (paused-interrupted, C4): synthesized `crashed`, error `host_interrupted`. */
const hostInterrupted = (runId: string, pausedIntent: ControlIntentRef | null = null, at = time(2)): KeyRun =>
  run(runId, 'crashed', { reconciliation: reconciliation({
    kind: 'interrupted_clean', event: runtimeEvent(runId, { kind: 'crashed', error: 'host_interrupted' }, at),
    lastPosition: 4, kernelPaused: pausedIntent !== null, pausedIntentRef: pausedIntent,
  }, at) });
/** A Kernel-reported crash observed in process: no reconciliation. */
const kernelCrash = (runId: string): KeyRun => run(runId, 'crashed');

const reportOf = (checkId: string, invocation: number): ArtifactRef =>
  artifact(`report:${checkId}:${invocation}`, REPORT_CONTENT_TYPE);
const check = (checkId: string, outcome: RoundCheckSnapshot['outcome'], extra: Partial<RoundCheckSnapshot> = {}): RoundCheckSnapshot => ({
  checkId,
  definition: { checkId, kind: 'static', command: `npm run ${checkId}`, cwd: '.', timeoutMs: 60_000, taskIds: 'all' },
  coverage: [],
  phase: 'finished',
  invocationId: `inv-${checkId}-1`,
  outcome,
  reportRef: reportOf(checkId, 1),
  sourceStatus: 'matched',
  incompleteCause: null,
  ...extra,
});
const roundRef = (roundId: string, runId = 'run-1'): VerificationRoundRef => ({
  aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId: T, runId, roundId,
});
const round = (
  checks: RoundCheckSnapshot[], gapCodes: string[] = [], status: RoundSnapshot['status'] = 'finalized', roundId = 'round-1',
): KeyRoundV1 => ({
  ref: roundRef(roundId), status, checks, gaps: gapCodes.map((code) => ({ code, message: `gap ${code} in ${roundId}` })),
});
/** The same failure re-run: new round id, invocation ids and report bodies (ND-1). */
const rerun = (base: KeyRoundV1, roundId: string, runId: string, invocation: number): KeyRoundV1 => ({
  ref: roundRef(roundId, runId),
  status: base.status,
  checks: base.checks.map((item) => ({
    ...item, invocationId: `inv-${item.checkId}-${invocation}`,
    reportRef: item.reportRef === null ? null : reportOf(item.checkId, invocation),
  })),
  gaps: base.gaps.map((gap) => ({ ...gap, message: `${gap.message} (${roundId})` })),
});

const c1Fail = (): KeyRoundV1 => round([check('c1', 'FAIL'), check('c2', 'PASS')]);
const keyInput = (over: Partial<NoProgressKeyInputV1> = {}): NoProgressKeyInputV1 => ({
  taskRef, afterRun: run('run-1'), head: c1Fail(), source: src('S1'), basisPlan: planRef('plan-1'), newInputRefs: [], ...over,
});
function keyOf(input: NoProgressKeyInputV1): NoProgressKeyV1 {
  const result = noProgressKey(input);
  if (!result.ok) throw new Error(`noProgressKey rejected: ${result.code} ${result.detail}`);
  return result.next;
}
/** ND-3: the first earlier key with the same digest, or -1. */
function sameBasisIndex(key: { digest: string }, priors: readonly { digest: string }[]): number {
  return priors.findIndex((prior) => prior.digest === key.digest);
}

const policyPin = (seed = 'policy', revision = 1): CompletionPolicyPin => ({
  ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'policy-1', revision }, digest: sha256Hex(seed),
});
const baselinePin = (seed = 'baseline', revision = 1): ArchitectureBaselinePin => ({
  ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P, baselineId: 'baseline-1', revision }, digest: sha256Hex(seed),
});
const timedOut = (): KeyRoundV1 => round([check('c1', 'INCONCLUSIVE', { incompleteCause: 'process_timed_out' })]);
const reverifyInput = (over: Partial<ReverifyBasisInputV1> = {}): ReverifyBasisInputV1 => ({
  subject: taskRef, subjectRunId: 'run-1', predecessor: timedOut(), source: src('S1'),
  configuration: { configurationRevision: 'cfg-1', configurationDigest: sha256Hex('cfg-1') },
  basisPlan: planRef('plan-1'), completionPolicyPin: policyPin(), architectureBaselinePin: baselinePin(), newInputRefs: [], ...over,
});
function reverifyKeyOf(input: ReverifyBasisInputV1): ReverifyBasisV1 {
  const result = reverifyBasis(input);
  if (!result.ok) throw new Error(`reverifyBasis rejected: ${result.code} ${result.detail}`);
  return result.next;
}

/** A small accepted Plan: v2 with an explicit `taskStateBasis`, or legacy (every Task its own basis). */
const plan = (planId: string, basis: Record<string, string> | null, taskIds: string[] = [T, 'other-task']): PlanRevisionSnapshot => ({
  schemaVersion: 2, planId, ref: planRef(planId), tasks: taskIds.map((taskId) => ({ taskId })),
  ...(basis === null ? {} : {
    taskStateBasis: { schemaVersion: 1, entries: Object.entries(basis).map(([taskId, id]) => ({ taskId, planRef: planRef(id) })) },
  }),
}) as unknown as PlanRevisionSnapshot;
const effectiveBasis = (active: PlanRevisionSnapshot, taskId = T): TaskBasisLookupV1 => buildEffectiveTaskBasis(active).get(taskId);

const RUN_STATUSES = Object.keys({ starting: 0, running: 0, ended: 0 } satisfies Record<RunStatus, 0>) as RunStatus[];
const RUN_OUTCOMES = Object.keys({
  completed: 0, failed: 0, cancelled: 0, budget_exhausted: 0, crashed: 0, outcome_unknown: 0, yielded: 0,
} satisfies Record<RunOutcome, 0>) as RunOutcome[];
const CHECK_PHASES = Object.keys({ pending: 0, executing: 0, finished: 0, interrupted: 0 } satisfies
  Record<RoundCheckSnapshot['phase'], 0>) as RoundCheckSnapshot['phase'][];
const CHECK_OUTCOMES: RoundCheckSnapshot['outcome'][] = ['PASS', 'FAIL', 'INCONCLUSIVE', null];

// ------------------------------------------------------------------------ //
// Guard domain (every combination)                                          //
// ------------------------------------------------------------------------ //
describe('noProgressKey guard domain: Run status × outcome × head × basis', () => {
  type HeadCase = 'none' | 'open' | 'finalized';
  type BasisCase = 'resolved' | 'unsupported' | 'missing';
  const heads: Record<HeadCase, KeyRoundV1 | null> = {
    none: null, open: round([check('c1', null, { phase: 'executing', reportRef: null })], [], 'open'), finalized: c1Fail(),
  };
  const bases: Record<BasisCase, TaskBasisLookupV1> = {
    resolved: planRef('plan-1'), unsupported: { status: 'unsupported', reason: 'carries a taskStateBasis without the task' },
    missing: undefined,
  };
  /** §13.2 step 3 order: Run state → open head → basis. */
  function expected(status: RunStatus, outcome: RunOutcome | null, head: HeadCase, basis: BasisCase):
    { ok: true } | { ok: false; code: 'busy' | 'incomplete'; detail: RegExp } {
    if (status !== 'ended') return { ok: false, code: 'busy', detail: /has not ended/ };
    if (outcome === null) return { ok: false, code: 'busy', detail: /without an outcome/ };
    if (outcome === 'outcome_unknown') return { ok: false, code: 'busy', detail: /unknown outcome; reconcile it first/ };
    if (head === 'open') return { ok: false, code: 'busy', detail: /^finalize_first: round round-1 is open$/ };
    if (basis !== 'resolved') return { ok: false, code: 'incomplete', detail: /basis/ };
    return { ok: true };
  }

  for (const status of RUN_STATUSES) {
    for (const outcome of [null, ...RUN_OUTCOMES]) {
      for (const head of Object.keys(heads) as HeadCase[]) {
        for (const basis of Object.keys(bases) as BasisCase[]) {
          it(`${status} × ${String(outcome)} × head ${head} × basis ${basis}`, () => {
            const result = noProgressKey(keyInput({
              afterRun: run('run-1', outcome, { status }), head: heads[head], basisPlan: bases[basis],
            }));
            const want = expected(status, outcome, head, basis);
            if (want.ok) {
              expect(result).toMatchObject({ ok: true, effects: [] });
              if (!result.ok) return;
              expect(result.next.failure.outcome).toBe(outcome);
              expect(result.next.plan).toEqual(planRef('plan-1'));
              expect(result.next.failure.checks).toEqual(head === 'none' ? [] : [
                { checkId: 'c1', phase: 'finished', outcome: 'FAIL', cause: null },
              ]);
            } else {
              expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: want.code });
              if (result.ok) return;
              expect(result.detail).toMatch(want.detail);
            }
          });
        }
      }
    }
  }

  it('the basis detail names why it is unresolvable', () => {
    const unsupported = noProgressKey(keyInput({ basisPlan: bases.unsupported }));
    expect(unsupported).toMatchObject({ ok: false, code: 'incomplete' });
    if (!unsupported.ok) expect(unsupported.detail).toContain('carries a taskStateBasis without the task');
    const missing = noProgressKey(keyInput({ basisPlan: undefined }));
    if (!missing.ok) expect(missing.detail).toBe(`task ${T} has no effective basis in the active Plan`);
  });
});

describe('reverifyBasis guard domain: predecessor status × basis', () => {
  const bases: Record<string, TaskBasisLookupV1> = {
    resolved: planRef('plan-1'), unsupported: { status: 'unsupported', reason: 'no entry' }, missing: undefined,
  };
  for (const status of ['open', 'finalized'] as const) {
    for (const [basis, lookup] of Object.entries(bases)) {
      it(`predecessor ${status} × basis ${basis}`, () => {
        const result = reverifyBasis(reverifyInput({
          predecessor: round([check('c1', 'INCONCLUSIVE', { incompleteCause: 'process_timed_out' })], [], status),
          basisPlan: lookup,
        }));
        if (status === 'open') {
          expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'finalize_first: round round-1 is open' });
        } else if (basis !== 'resolved') {
          expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete' });
        } else {
          expect(result).toMatchObject({ ok: true, effects: [] });
        }
      });
    }
  }
});

// ------------------------------------------------------------------------ //
// Failure origin (ND-5)                                                     //
// ------------------------------------------------------------------------ //
describe('runFailureOrigin: every reconciliation observation × outcome (ND-5)', () => {
  const observations = {
    none: undefined,
    runtime_terminal: reconciliation({ kind: 'runtime_terminal', event: runtimeEvent('run-1', { kind: 'crashed', error: 'boom' }), digest: sha256Hex('e') }),
    unresolved: { ...reconciliation({ kind: 'unresolved', reason: 'tool call running', observedThroughPosition: 3, unresolvedToolCallIds: ['t1'] }), status: 'quarantined' as const },
    not_entered: reconciliation({ kind: 'not_entered', kernel: { adapterId: 'a', kernelSessionId: 'k', runId: 'kr', turnId: 'kt' }, revokedGeneration: 1 }),
    interrupted_clean: reconciliation({ kind: 'interrupted_clean', event: runtimeEvent('run-1', { kind: 'crashed', error: 'host_interrupted' }), lastPosition: 2, kernelPaused: false, pausedIntentRef: null }),
    human_attested: reconciliation({ kind: 'human_attested', attestedBy: { kind: 'human', id: 'user-1' }, reason: 'checked the Kernel log' }),
  } satisfies Record<RunReconciliationV1['observation']['kind'] | 'none', RunReconciliationV1 | undefined>;
  const want = (kind: keyof typeof observations, outcome: RunOutcome) =>
    kind === 'interrupted_clean' ? (outcome === 'crashed' ? 'host_interrupted' : 'observed')
      : kind === 'human_attested' ? 'human_attested' : 'observed';

  for (const [kind, value] of Object.entries(observations) as [keyof typeof observations, RunReconciliationV1 | undefined][]) {
    for (const outcome of RUN_OUTCOMES) {
      it(`${kind} × ${outcome} → ${want(kind, outcome)}`, () => {
        const subject = value === undefined ? { outcome } : { outcome, reconciliation: value };
        expect(runFailureOrigin(subject)).toBe(want(kind, outcome));
      });
    }
  }

  it('RUN-24 paused-interrupted and RUN-19 are host_interrupted; RUN-23 reconcile-time cancel is observed', () => {
    expect(runFailureOrigin(hostInterrupted('run-1', intentRef('pause-1')))).toBe('host_interrupted');
    expect(runFailureOrigin(hostInterrupted('run-1'))).toBe('host_interrupted');
    const reconcileCancel = run('run-1', 'cancelled', { reconciliation: reconciliation({
      kind: 'interrupted_clean', event: runtimeEvent('run-1', { kind: 'cancelled', reason: 'queued cancel' }),
      lastPosition: 2, kernelPaused: false, pausedIntentRef: null,
    }) });
    expect(runFailureOrigin(reconcileCancel)).toBe('observed');
    expect(keyOf(keyInput({ afterRun: hostInterrupted('run-1', intentRef('pause-1')), head: null })).failure.origin).toBe('host_interrupted');
  });
});

// ------------------------------------------------------------------------ //
// roundFailureFacts                                                         //
// ------------------------------------------------------------------------ //
describe('roundFailureFacts', () => {
  for (const phase of CHECK_PHASES) {
    for (const outcome of CHECK_OUTCOMES) {
      it(`phase ${phase} × outcome ${String(outcome)} is ${outcome === 'PASS' ? 'excluded' : 'a failing fact'}`, () => {
        const facts = roundFailureFacts(round([check('c1', outcome, { phase })]));
        expect(facts.checks).toEqual(outcome === 'PASS' ? [] : [
          { checkId: 'c1', phase, outcome, cause: null, reportRef: reportOf('c1', 1) },
        ]);
      });
    }
  }

  it('gives every non-PASS check, interrupted and not-run included, sorted by checkId', () => {
    const facts = roundFailureFacts(round([
      check('e-pass', 'PASS'),
      check('d-pending', null, { phase: 'pending', invocationId: null, reportRef: null }),
      check('b-interrupted', null, { phase: 'interrupted', reportRef: null, incompleteCause: 'host_restart' }),
      check('c-timeout', 'INCONCLUSIVE', { incompleteCause: 'process_timed_out' }),
      check('a-fail', 'FAIL'),
    ], ['uncovered_requirement', 'interrupted_check', 'uncovered_requirement']));
    expect(facts.checks.map((item) => [item.checkId, item.phase, item.outcome, item.cause])).toEqual([
      ['a-fail', 'finished', 'FAIL', null],
      ['b-interrupted', 'interrupted', null, 'host_restart'],
      ['c-timeout', 'finished', 'INCONCLUSIVE', 'process_timed_out'],
      ['d-pending', 'pending', null, null],
    ]);
    expect(facts.gapCodes).toEqual(['interrupted_check', 'uncovered_requirement']);
  });

  it('reads a legacy check without incompleteCause as cause null', () => {
    const legacy = check('c1', 'INCONCLUSIVE');
    delete legacy.incompleteCause;
    expect('incompleteCause' in legacy).toBe(false);
    expect(roundFailureFacts(round([legacy])).checks[0]?.cause).toBeNull();
  });

  it('the read-model version keeps reportRef; the key version drops it', () => {
    const facts = roundFailureFacts(round([check('c1', 'FAIL')]));
    expect(facts.checks[0]?.reportRef).toEqual(reportOf('c1', 1));
    expect(keyCheckFacts(facts.checks)).toEqual([{ checkId: 'c1', phase: 'finished', outcome: 'FAIL', cause: null }]);
    expect(keyOf(keyInput()).failure.checks.every((item) => !('reportRef' in item))).toBe(true);
  });

  it('a round without checks or gaps has no failure facts', () => {
    expect(roundFailureFacts(round([]))).toEqual({ checks: [], gapCodes: [] });
  });
});

// ------------------------------------------------------------------------ //
// Key stability (§13.6)                                                     //
// ------------------------------------------------------------------------ //
describe('noProgressKey stability', () => {
  it('the digest is sha256 over the canonical key without the digest, and covers exactly the §13.1 members', () => {
    const key = keyOf(keyInput({ newInputRefs: [messageInput('m-1')] }));
    const { digest, ...rest } = key;
    expect(digest).toBe(sha256Hex(canonicalJson(rest as unknown as JsonValue)));
    expect(Object.keys(rest).sort()).toEqual(['actionKind', 'failure', 'newInputDigest', 'plan', 'source', 'taskRef']);
    expect(Object.keys(key.failure).sort()).toEqual(['checks', 'exhaustedTokenBudget', 'gapCodes', 'origin', 'outcome']);
    expect(key).toMatchObject({ actionKind: 'requeue', taskRef, source: src('S1'), plan: planRef('plan-1') });
  });

  it('ids, report bodies and times never change the digest', () => {
    const base = keyOf(keyInput({ afterRun: hostInterrupted('run-1', null, time(2)), head: c1Fail() }));
    const later = keyOf(keyInput({ afterRun: hostInterrupted('run-2', null, time(9)), head: rerun(c1Fail(), 'round-2', 'run-2', 2) }));
    expect(later.digest).toBe(base.digest);
  });

  it('reason, actor, actor class, requested budget, trigger and automatic count are not key inputs', () => {
    const base = keyOf(keyInput());
    const wide = {
      ...keyInput(),
      reason: 'try again, I changed my mind', requestedBy: { kind: 'agent', id: 'a-1', runRef: runRef('run-9') },
      actorClass: 'agent', budget: { tokenBudget: 900_000, deadline: null },
      trigger: { kind: 'goal_resume', resumedEpoch: 2, pausedEpoch: 1 }, autoCount: 4, requestedAt: time(30),
    };
    expect(keyOf(wide).digest).toBe(base.digest);
  });

  it('wider ref objects never leak extra members into the key', () => {
    const base = keyOf(keyInput());
    const wideTask = { ...taskRef, aggregateType: 'Task', title: 'x' };
    const wideSource = { ...src('S1'), changedFiles: ['a.ts'] };
    const widePlan = { ...planRef('plan-1'), revision: 9 };
    const key = keyOf(keyInput({ taskRef: wideTask, source: wideSource, basisPlan: widePlan }));
    expect(key.digest).toBe(base.digest);
    expect(key.taskRef).toEqual(taskRef);
    expect(key.source).toEqual(src('S1'));
    expect(key.plan).toEqual(planRef('plan-1'));
  });

  it('the order of checks and gaps in the round never matters', () => {
    const checks = [check('c3', 'INCONCLUSIVE', { incompleteCause: 'process_abnormal' }), check('c1', 'FAIL'), check('c2', 'FAIL')];
    const forward = keyOf(keyInput({ head: round(checks, ['g2', 'g1']) }));
    const backward = keyOf(keyInput({ head: round([...checks].reverse(), ['g1', 'g2', 'g1']) }));
    expect(backward.digest).toBe(forward.digest);
    expect(forward.failure.checks.map((item) => item.checkId)).toEqual(['c1', 'c2', 'c3']);
    expect(forward.failure.gapCodes).toEqual(['g1', 'g2']);
  });

  it('a check phase and cause take part in the digest (C1)', () => {
    const timeout = keyOf(keyInput({ head: round([check('c1', 'INCONCLUSIVE', { incompleteCause: 'process_timed_out' })]) }));
    const abnormal = keyOf(keyInput({ head: round([check('c1', 'INCONCLUSIVE', { incompleteCause: 'process_abnormal' })]) }));
    expect(abnormal.digest).not.toBe(timeout.digest);
    const interrupted = keyOf(keyInput({ head: round([check('c1', null, { phase: 'interrupted', reportRef: null })]) }));
    const pending = keyOf(keyInput({ head: round([check('c1', null, { phase: 'pending', reportRef: null })]) }));
    expect(pending.digest).not.toBe(interrupted.digest);
  });

  it('a legacy check without incompleteCause keys as cause null', () => {
    const legacy = check('c1', 'INCONCLUSIVE');
    delete legacy.incompleteCause;
    const explicit = check('c1', 'INCONCLUSIVE', { incompleteCause: null });
    expect(keyOf(keyInput({ head: round([legacy]) })).digest).toBe(keyOf(keyInput({ head: round([explicit]) })).digest);
    expect(keyOf(keyInput({ head: round([legacy]) })).failure.checks).toEqual([
      { checkId: 'c1', phase: 'finished', outcome: 'INCONCLUSIVE', cause: null },
    ]);
  });

  it('two budget_exhausted afterRuns that differ only in tokenBudget give different digests', () => {
    const at100k = keyOf(keyInput({ afterRun: run('run-1', 'budget_exhausted'), head: null }));
    const at200k = keyOf(keyInput({ afterRun: run('run-2', 'budget_exhausted', { budget: { tokenBudget: 200_000, deadline: null } }), head: null }));
    expect(at100k.failure.exhaustedTokenBudget).toBe(100_000);
    expect(at200k.failure.exhaustedTokenBudget).toBe(200_000);
    expect(at200k.digest).not.toBe(at100k.digest);
  });

  it('every other outcome keys exhaustedTokenBudget as null, whatever the Run budget', () => {
    for (const outcome of RUN_OUTCOMES.filter((value) => value !== 'budget_exhausted' && value !== 'outcome_unknown')) {
      const small = keyOf(keyInput({ afterRun: run('run-1', outcome) }));
      const large = keyOf(keyInput({ afterRun: run('run-2', outcome, { budget: { tokenBudget: 999_000, deadline: time(50) } }) }));
      expect(small.failure.exhaustedTokenBudget).toBeNull();
      expect(large.digest).toBe(small.digest);
    }
  });

  it('every key member moves the digest: task, outcome, origin, checks, gaps, source, plan, new inputs', () => {
    const base = keyOf(keyInput());
    const variants: NoProgressKeyV1[] = [
      keyOf(keyInput({ taskRef: { ...taskRef, taskId: 'other-task' } })),
      keyOf(keyInput({ afterRun: run('run-1', 'failed') })),
      keyOf(keyInput({ head: round([check('c1', 'FAIL'), check('c2', 'FAIL')]) })),
      keyOf(keyInput({ head: round([check('c1', 'FAIL')], ['uncovered_requirement']) })),
      keyOf(keyInput({ source: src('S2') })),
      keyOf(keyInput({ source: src('S1', 4) })),
      keyOf(keyInput({ basisPlan: planRef('plan-2') })),
      keyOf(keyInput({ newInputRefs: [artifactInput('diagnosis-1')] })),
    ];
    const digests = new Set([base.digest, ...variants.map((key) => key.digest)]);
    expect(digests.size).toBe(variants.length + 1);
    const crashedObserved = keyOf(keyInput({ afterRun: kernelCrash('run-1'), head: null }));
    const crashedInterrupted = keyOf(keyInput({ afterRun: hostInterrupted('run-1'), head: null }));
    expect(crashedInterrupted.digest).not.toBe(crashedObserved.digest);
  });

  it('plan is the Task effective basis (L-4): unrelated W16 and disposition-only TASK-19 keep it; a change of this Task moves it', () => {
    const plan1 = plan('plan-1', null);
    const unrelated = plan('plan-2', { [T]: 'plan-1', 'other-task': 'plan-2' });
    const deferred = plan('plan-3', { [T]: 'plan-1', 'other-task': 'plan-2' });
    const reactivated = plan('plan-4', { [T]: 'plan-1', 'other-task': 'plan-2' });
    const changed = plan('plan-5', { [T]: 'plan-5', 'other-task': 'plan-2' });
    const keys = [plan1, unrelated, deferred, reactivated].map((active) => keyOf(keyInput({ basisPlan: effectiveBasis(active) })));
    expect(new Set(keys.map((key) => key.digest)).size).toBe(1);
    expect(keys[1]?.plan).toEqual(planRef('plan-1'));
    expect(keyOf(keyInput({ basisPlan: effectiveBasis(changed) })).digest).not.toBe(keys[0]?.digest);
  });

  it('an unresolvable basis is incomplete, never "same"', () => {
    const withoutEntry = plan('plan-6', { 'other-task': 'plan-6' });
    expect(noProgressKey(keyInput({ basisPlan: effectiveBasis(withoutEntry) }))).toMatchObject({ ok: false, code: 'incomplete' });
    expect(noProgressKey(keyInput({ basisPlan: effectiveBasis(plan('plan-7', null, ['other-task'])) })))
      .toMatchObject({ ok: false, code: 'incomplete' });
  });
});

describe('newBasisInputDigest (a canonical set, hard limit 2)', () => {
  const A = artifactInput('d-1'), B = messageInput('m-1');

  it('is null without inputs and sha256 over the input identities sorted by canonical text otherwise', () => {
    expect(newBasisInputDigest([])).toBeNull();
    // An Artifact enters as its content key only (`sameArtifactRef`): no `source`.
    const full = artifact('d-1');
    const keyA = { kind: 'artifact', ref: { kind: 'artifact', contentType: full.contentType, digest: full.digest, sizeBytes: full.sizeBytes } };
    const sorted = [keyA, B].sort((left, right) => {
      const l = canonicalJson(left as unknown as JsonValue), r = canonicalJson(right as unknown as JsonValue);
      return l < r ? -1 : l > r ? 1 : 0;
    });
    expect(newBasisInputDigest([B, A])).toBe(sha256Hex(canonicalJson(sorted as unknown as JsonValue)));
  });

  it('request order and repeated refs never change it', () => {
    const base = newBasisInputDigest([A, B]);
    expect(newBasisInputDigest([B, A])).toBe(base);
    expect(newBasisInputDigest([A, B, A, B])).toBe(base);
    expect(newBasisInputDigest([A, A])).toBe(newBasisInputDigest([A]));
  });

  it('extra runtime members on an input, a ref or an Artifact source never change it', () => {
    const wideArtifact = {
      kind: 'artifact', note: 'decoded from a request body',
      ref: { ...artifact('d-1'), body: 'inline body', source: { ...artifact('d-1').source, extra: 1 } },
    } as unknown as NewBasisInputRefV1;
    const wideMessage = {
      kind: 'session_message', ref: { ...messageInput('m-1').ref, status: 'responded', respondedAt: time(5) },
    } as unknown as NewBasisInputRefV1;
    expect(newBasisInputDigest([wideArtifact])).toBe(newBasisInputDigest([A]));
    expect(newBasisInputDigest([wideMessage])).toBe(newBasisInputDigest([B]));
    expect(newBasisInputDigest([wideMessage, wideArtifact])).toBe(newBasisInputDigest([A, B]));
  });

  it('an Artifact counts by its content key: another source, source revision or source digest is the same input', () => {
    const base = newBasisInputDigest([A]);
    const withSource = (source: ArtifactRef['source']): NewBasisInputRefV1 => ({ kind: 'artifact', ref: { ...artifact('d-1'), source } });
    const original = artifact('d-1').source;
    expect(newBasisInputDigest([withSource({ ...original, revision: '9' })])).toBe(base);
    expect(newBasisInputDigest([withSource({ ...original, digest: sha256Hex('s') })])).toBe(base);
    expect(newBasisInputDigest([withSource({ kind: 'artifact', refId: 'other-artifact', revision: '1' })])).toBe(base);
    expect(newBasisInputDigest([A, withSource({ ...original, revision: '9' })])).toBe(base);
  });

  it('a genuinely new ref or a different content key member changes it', () => {
    const base = newBasisInputDigest([A]);
    expect(newBasisInputDigest([A, B])).not.toBe(base);
    expect(newBasisInputDigest([artifactInput('d-2')])).not.toBe(base);
    expect(newBasisInputDigest([{ kind: 'artifact', ref: artifact('d-1', 'text/plain') }])).not.toBe(base);
    expect(newBasisInputDigest([{ kind: 'artifact', ref: { ...artifact('d-1'), sizeBytes: 41 } }])).not.toBe(base);
    expect(newBasisInputDigest([messageInput('m-2')])).not.toBe(newBasisInputDigest([B]));
  });

  it('both keys use it: reordered, repeated or wider refs keep the requeue and the reverify digest', () => {
    const wideA = { ...A, ref: { ...artifact('d-1'), extra: true } } as unknown as NewBasisInputRefV1;
    expect(keyOf(keyInput({ newInputRefs: [B, wideA, A] })).digest).toBe(keyOf(keyInput({ newInputRefs: [A, B] })).digest);
    expect(reverifyKeyOf(reverifyInput({ newInputRefs: [B, wideA, A] })).digest)
      .toBe(reverifyKeyOf(reverifyInput({ newInputRefs: [A, B] })).digest);
  });
});

// ------------------------------------------------------------------------ //
// §13.4 examples (key level)                                                //
// ------------------------------------------------------------------------ //
describe('§13.4 examples at the key level', () => {
  const first = (): NoProgressKeyV1 => keyOf(keyInput());
  /** Run2 failed the same way without touching files: new ids, reports and time (#2). */
  const sameAgain = (over: Partial<NoProgressKeyInputV1> = {}): NoProgressKeyV1 =>
    keyOf(keyInput({ afterRun: run('run-2'), head: rerun(c1Fail(), 'round-2', 'run-2', 2), ...over }));

  it('#1 first requeue has nothing to compare with', () => {
    expect(sameBasisIndex(first(), [])).toBe(-1);
  });
  it('#2 same failure, source, plan and inputs → same key as the first requeue (no_new_basis)', () => {
    expect(sameBasisIndex(sameAgain(), [first()])).toBe(0);
  });
  it('#3 Run2 changed files → sourceDigest differs', () => {
    expect(sameBasisIndex(sameAgain({ source: src('S2', 4) }), [first()])).toBe(-1);
  });
  it('#4 a responded message as new input → newInputDigest differs', () => {
    expect(sameBasisIndex(sameAgain({ newInputRefs: [messageInput('reply-1')] }), [first()])).toBe(-1);
  });
  it('#5 / #22 only the reason text changed → same key', () => {
    const withReason = { ...keyInput({ afterRun: run('run-2'), head: rerun(c1Fail(), 'round-2', 'run-2', 2) }), reason: 'please really fix it' };
    expect(sameBasisIndex(keyOf(withReason), [first()])).toBe(0);
  });
  it('#6 an unrelated Plan adoption keeps the effective basis → same key', () => {
    const active = plan('plan-2', { [T]: 'plan-1', 'other-task': 'plan-2' });
    expect(sameBasisIndex(sameAgain({ basisPlan: effectiveBasis(active) }), [first()])).toBe(0);
  });
  it('#7 c1 now PASS but c2 FAIL → failure.checks differ', () => {
    const head = round([check('c1', 'PASS'), check('c2', 'FAIL')], [], 'finalized', 'round-2');
    expect(sameBasisIndex(sameAgain({ head }), [first()])).toBe(-1);
  });
  it('#8 outcome_unknown never reaches a comparison → busy', () => {
    expect(noProgressKey(keyInput({ afterRun: run('run-2', 'outcome_unknown') }))).toMatchObject({ ok: false, code: 'busy' });
  });
  it('#9 two Kernel-reported crashes without a round or change → same key (origin observed)', () => {
    const run1 = keyOf(keyInput({ afterRun: kernelCrash('run-1'), head: null }));
    const run2 = keyOf(keyInput({ afterRun: kernelCrash('run-2'), head: null }));
    expect(run1.failure.origin).toBe('observed');
    expect(sameBasisIndex(run2, [run1])).toBe(0);
  });
  it('#10 S1→S2→S1 with the same failure matches the first requeue (ND-3: all earlier keys)', () => {
    const atS1 = first();
    const atS2 = sameAgain({ source: src('S2', 4) });
    const backAtS1 = keyOf(keyInput({ afterRun: run('run-3'), head: rerun(c1Fail(), 'round-3', 'run-3', 3), source: src('S1') }));
    expect(sameBasisIndex(backAtS1, [atS2])).toBe(-1);
    expect(sameBasisIndex(backAtS1, [atS1, atS2])).toBe(0);
  });
  it('#11 a manual edit after the failure → sourceDigest differs (ND-2)', () => {
    expect(sameBasisIndex(sameAgain({ source: src('S1-edited') }), [first()])).toBe(-1);
  });
  it('#12 / #17 two Host-restart interruptions key alike with origin host_interrupted (the guard skips the comparison)', () => {
    const run1 = keyOf(keyInput({ afterRun: hostInterrupted('run-1'), head: null }));
    const run2 = keyOf(keyInput({ afterRun: hostInterrupted('run-2', null, time(9)), head: null }));
    expect([run1.failure.origin, run2.failure.origin]).toEqual(['host_interrupted', 'host_interrupted']);
    expect(run2.digest).toBe(run1.digest);
  });
  it('#13 an interruption then a Kernel crash with no source change → origin differs', () => {
    const run1 = keyOf(keyInput({ afterRun: hostInterrupted('run-1'), head: null }));
    const run2 = keyOf(keyInput({ afterRun: kernelCrash('run-2'), head: null }));
    expect(sameBasisIndex(run2, [run1])).toBe(-1);
  });
  it('#14 another Run edited an unrelated file in the same workspace → sourceDigest differs (ND-4)', () => {
    expect(sameBasisIndex(sameAgain({ source: src('S1+unrelated', 4) }), [first()])).toBe(-1);
  });
  it('#15 four failures, each after a file change → four distinct keys (the cap is a separate guard)', () => {
    const keys = ['S1', 'S2', 'S3', 'S4'].map((seed, index) =>
      keyOf(keyInput({ afterRun: run(`run-${index + 1}`), head: rerun(c1Fail(), `round-${index + 1}`, `run-${index + 1}`, index + 1), source: src(seed, index + 3) })));
    keys.forEach((key, index) => expect(sameBasisIndex(key, keys.slice(0, index))).toBe(-1));
  });
  it('#16 exhaustion at 100k, 200k, 400k → three distinct keys; the third refusal is the budget guard, not the key', () => {
    const exhausted = (runId: string, tokenBudget: number): NoProgressKeyV1 =>
      keyOf(keyInput({ afterRun: run(runId, 'budget_exhausted', { budget: { tokenBudget, deadline: null } }), head: null }));
    const keys = [exhausted('run-1', 100_000), exhausted('run-2', 200_000), exhausted('run-3', 400_000)];
    expect(sameBasisIndex(keys[1]!, keys.slice(0, 1))).toBe(-1);
    expect(sameBasisIndex(keys[2]!, keys.slice(0, 2))).toBe(-1);
  });
  it('#18 a human-cancelled Run still gets a key (cancelled, observed); ND-6 skips the comparison in the guard', () => {
    const key = keyOf(keyInput({ afterRun: run('run-1', 'cancelled'), head: null }));
    expect(key.failure).toMatchObject({ outcome: 'cancelled', origin: 'observed', exhaustedTokenBudget: null, checks: [], gapCodes: [] });
  });
  it('#19 budget_exhausted pins the exhausted budget in the key', () => {
    expect(keyOf(keyInput({ afterRun: run('run-1', 'budget_exhausted'), head: null })).failure.exhaustedTokenBudget).toBe(100_000);
  });
  it('#20 a new diagnosis Artifact passes once; the same Artifact next time matches', () => {
    const withDiagnosis = sameAgain({ newInputRefs: [artifactInput('diagnosis-1')] });
    expect(sameBasisIndex(withDiagnosis, [first()])).toBe(-1);
    const again = keyOf(keyInput({ afterRun: run('run-3'), head: rerun(c1Fail(), 'round-3', 'run-3', 3), newInputRefs: [artifactInput('diagnosis-1')] }));
    expect(sameBasisIndex(again, [first(), withDiagnosis])).toBe(1);
  });
  it('#20 the same Artifact repeated, or earlier inputs reordered, is not a new basis', () => {
    const diagnosis = artifactInput('diagnosis-1'), reply = messageInput('reply-1');
    const once = sameAgain({ newInputRefs: [diagnosis] });
    const repeated = keyOf(keyInput({ afterRun: run('run-3'), head: rerun(c1Fail(), 'round-3', 'run-3', 3), newInputRefs: [diagnosis, diagnosis] }));
    expect(sameBasisIndex(repeated, [first(), once])).toBe(1);
    const both = sameAgain({ newInputRefs: [diagnosis, reply] });
    const reordered = keyOf(keyInput({ afterRun: run('run-3'), head: rerun(c1Fail(), 'round-3', 'run-3', 3), newInputRefs: [reply, diagnosis] }));
    expect(sameBasisIndex(reordered, [first(), both])).toBe(1);
  });
  it('#20 the same diagnosis body referenced again with another source is not a new basis', () => {
    const once = sameAgain({ newInputRefs: [artifactInput('diagnosis-1')] });
    const resourced: NewBasisInputRefV1 = {
      kind: 'artifact',
      ref: { ...artifact('diagnosis-1'), source: { kind: 'workspace', refId: W, revision: '8', digest: sha256Hex('S8') } },
    };
    const again = keyOf(keyInput({ afterRun: run('run-3'), head: rerun(c1Fail(), 'round-3', 'run-3', 3), newInputRefs: [resourced] }));
    expect(sameBasisIndex(again, [first(), once])).toBe(1);
    const reverifyOnce = reverifyKeyOf(reverifyInput({ newInputRefs: [artifactInput('diagnosis-1')] }));
    expect(reverifyKeyOf(reverifyInput({ predecessor: rerun(timedOut(), 'round-2', 'run-1', 2), newInputRefs: [resourced] })).digest)
      .toBe(reverifyOnce.digest);
  });
  it('#21 another Task Run ended without editing → key unchanged; with an edit → differs', () => {
    expect(sameBasisIndex(sameAgain(), [first()])).toBe(0);
    expect(sameBasisIndex(sameAgain({ source: src('S1+other-task-edit', 4) }), [first()])).toBe(-1);
  });
  it('#22 a stored human note is new once; the same note body gives the same Artifact ref and matches', () => {
    const note = artifactInput('note: the fixture path changed');
    const withNote = sameAgain({ newInputRefs: [note] });
    expect(sameBasisIndex(withNote, [first()])).toBe(-1);
    const sameNote = keyOf(keyInput({ afterRun: run('run-3'), head: rerun(c1Fail(), 'round-3', 'run-3', 3), newInputRefs: [artifactInput('note: the fixture path changed')] }));
    expect(sameBasisIndex(sameNote, [first(), withNote])).toBe(1);
  });
  it('#23 paused-interrupted (RUN-24) keys with origin host_interrupted', () => {
    expect(keyOf(keyInput({ afterRun: hostInterrupted('run-1', intentRef('pause-1')), head: null })).failure.origin).toBe('host_interrupted');
  });
  it('#25 a task manifest or check report is refused as a new input before any key (ND-9)', () => {
    expect(newBasisInputProblem({ kind: 'artifact', ref: artifact('m', MANIFEST_CONTENT_TYPE) }, { kind: 'artifact' })).not.toBeNull();
    expect(newBasisInputProblem({ kind: 'artifact', ref: reportOf('c1', 2) }, { kind: 'artifact' })).not.toBeNull();
  });
  it('#26 deferred then reactivated (TASK-19 twice) keeps the effective basis → same key', () => {
    const deferred = plan('plan-2', { [T]: 'plan-1', 'other-task': 'plan-2' });
    const reactivated = plan('plan-3', { [T]: 'plan-1', 'other-task': 'plan-2' });
    expect(sameBasisIndex(sameAgain({ basisPlan: effectiveBasis(deferred) }), [first()])).toBe(0);
    expect(sameBasisIndex(sameAgain({ basisPlan: effectiveBasis(reactivated) }), [first()])).toBe(0);
  });
});

// ------------------------------------------------------------------------ //
// §13.7 reverify key                                                        //
// ------------------------------------------------------------------------ //
describe('reverifyBasis (§13.7 point 1)', () => {
  it('covers exactly the §13.7 members; no outcome, origin, exhausted budget, planDigest or taskDigest', () => {
    const key = reverifyKeyOf(reverifyInput());
    const { digest, ...rest } = key;
    expect(digest).toBe(sha256Hex(canonicalJson(rest as unknown as JsonValue)));
    expect(Object.keys(rest).sort()).toEqual([
      'actionKind', 'configuration', 'failure', 'newInputDigest', 'source', 'subject', 'subjectRunId', 'verificationInputs',
    ]);
    expect(Object.keys(key.failure).sort()).toEqual(['checks', 'gapCodes']);
    expect(Object.keys(key.verificationInputs).sort()).toEqual(['architectureBaselinePin', 'basisPlanRef', 'completionPolicyPin']);
    expect(key).toMatchObject({ actionKind: 'reverify', subjectRunId: 'run-1', verificationInputs: { basisPlanRef: planRef('plan-1') } });
    expect(key.failure.checks).toEqual([{ checkId: 'c1', phase: 'finished', outcome: 'INCONCLUSIVE', cause: 'process_timed_out' }]);
  });

  it('round ids, invocation ids, report digests, check order, reason and time never move it', () => {
    const base = reverifyKeyOf(reverifyInput({
      predecessor: round([check('c2', 'FAIL'), check('c1', 'INCONCLUSIVE', { incompleteCause: 'process_timed_out' })], ['g1']),
    }));
    const successor = rerun(round([check('c1', 'INCONCLUSIVE', { incompleteCause: 'process_timed_out' }), check('c2', 'FAIL')], ['g1', 'g1']), 'round-2', 'run-1', 2);
    const wide = { ...reverifyInput({ predecessor: successor }), reason: 'auto-reverify:check_incomplete#2', requestedAt: time(40), autoCount: 2, onlyIfSourceChanged: true };
    expect(reverifyKeyOf(wide).digest).toBe(base.digest);
  });

  it('moves with source, configuration, policy pin, baseline pin, check cause, new input, subject Run and basis', () => {
    const base = reverifyKeyOf(reverifyInput());
    const variants = [
      reverifyInput({ source: src('S2', 4) }),
      reverifyInput({ configuration: { configurationRevision: 'cfg-2', configurationDigest: sha256Hex('cfg-1') } }),
      reverifyInput({ configuration: { configurationRevision: 'cfg-1', configurationDigest: sha256Hex('cfg-2') } }),
      reverifyInput({ completionPolicyPin: policyPin('policy', 2) }),
      reverifyInput({ architectureBaselinePin: baselinePin('baseline-2') }),
      reverifyInput({ predecessor: round([check('c1', 'INCONCLUSIVE', { incompleteCause: 'process_abnormal' })]) }),
      reverifyInput({ newInputRefs: [artifactInput('note-1')] }),
      reverifyInput({ subjectRunId: 'run-2' }),
      reverifyInput({ basisPlan: planRef('plan-2') }),
    ].map(reverifyKeyOf);
    expect(new Set([base.digest, ...variants.map((key) => key.digest)]).size).toBe(variants.length + 1);
  });

  it('unrelated adoption and disposition-only changes keep it (basis, not plan digests)', () => {
    const before = reverifyKeyOf(reverifyInput({ basisPlan: effectiveBasis(plan('plan-1', null)) }));
    const after = reverifyKeyOf(reverifyInput({ basisPlan: effectiveBasis(plan('plan-2', { [T]: 'plan-1', 'other-task': 'plan-2' })) }));
    expect(after.digest).toBe(before.digest);
  });

  it('never equals a requeue key over the same facts (separate key spaces)', () => {
    const requeue = keyOf(keyInput({ head: timedOut() }));
    const reverify = reverifyKeyOf(reverifyInput());
    expect(reverify.digest).not.toBe(requeue.digest);
  });

  it('13.7 examples: a repeated timeout without change matches the earlier chain key; a changed workspace or a new note does not', () => {
    const round1 = reverifyKeyOf(reverifyInput());
    const round2Same = reverifyKeyOf(reverifyInput({ predecessor: rerun(timedOut(), 'round-2', 'run-1', 2) }));
    expect(sameBasisIndex(round2Same, [round1])).toBe(0);
    const round2Changed = reverifyKeyOf(reverifyInput({ predecessor: rerun(timedOut(), 'round-2', 'run-1', 2), source: src('S2', 4) }));
    expect(sameBasisIndex(round2Changed, [round1])).toBe(-1);
    const note = artifactInput('note: raise the timeout');
    const withNote = reverifyKeyOf(reverifyInput({ predecessor: rerun(timedOut(), 'round-2', 'run-1', 2), newInputRefs: [note] }));
    expect(sameBasisIndex(withNote, [round1])).toBe(-1);
    const sameNoteAgain = reverifyKeyOf(reverifyInput({ predecessor: rerun(timedOut(), 'round-3', 'run-1', 3), newInputRefs: [artifactInput('note: raise the timeout')] }));
    expect(sameBasisIndex(sameNoteAgain, [round1, withNote])).toBe(1);
  });

  it('two Host-restart interrupted predecessors key alike (the exemption, not the key, lets them pass)', () => {
    const interrupted = (roundId: string, invocation: number): KeyRoundV1 => rerun(round(
      [check('c1', null, { phase: 'interrupted', reportRef: null, incompleteCause: 'host_restart' })], ['interrupted_check'],
    ), roundId, 'run-1', invocation);
    expect(reverifyKeyOf(reverifyInput({ predecessor: interrupted('round-2', 2) })).digest)
      .toBe(reverifyKeyOf(reverifyInput({ predecessor: interrupted('round-1', 1) })).digest);
  });
});
