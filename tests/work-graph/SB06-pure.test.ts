/**
 * B06 G1 pure rows (book :771-:773; start rulings §8.1 P1-P3, §4.3, §4.4, §7.2; G1 start rulings 11-12 §2). A5:
 * literal inputs, no store/Host/Runtime/Workflow; expected values by hand from spec §1.2 and book :214-:250, :327-:357.
 * P1 `runWitnessCheck`: FAIL wins over a gap; each knownFailure/hasGap branch has a row with only that cause.
 *   Mutation: `hasGap ? INCONCLUSIVE : knownFailure ? FAIL : PASS` (the two "FAIL with a gap" rows).
 * P2 `pathVerdictsOf`: exact `has` in required order; unsafe or glob → `unknown` (decision 121-10). Mutation: the
 *   unsafe branch returns `absent` (the five unsafe rows).
 * P3 `effectsOf`: changed before unknown; `complete` decides nothing. Mutations: `possible` counted as changed (the
 *   possible-file row); `complete:false` returns `none` early (the last row).
 * C `attachWitnessPaths` via `compileVerificationPlan`: the witness item carries the first-seen deduplicated union of
 *   its covered requirements' paths, `[]` when none; a command item gains no key. Mutations: no dedupe, or a union
 *   over every required obligation (C1); the key left off an empty union (C2).
 */
import { describe, expect, it } from 'vitest';
import type { AcceptanceObligation, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import type {
  CheckCapabilityV1, VerificationCheckPlan, WitnessCheckInput, WitnessCheckResult, WitnessPathVerdict, WitnessReadSet,
} from '../../src/contracts/verification.js';
import { compileVerificationPlan } from '../../src/core/work-graph/evidence/verification-plan.js';
import { pathVerdictsOf } from '../../src/core/work-graph/evidence/witness-path-verdicts.js';
import { effectsOf, runWitnessCheck } from '../../src/core/work-graph/state/witness-check.js';
import { countedFacts } from '../helpers/S2B-activity-fixture.js';

const CLEAN: WitnessCheckInput = { run: { state: 'applicable' }, report: { state: 'present', text: 'a.ts exports f.' },
  reads: { state: 'known', paths: ['a.ts'] }, paths: [{ path: 'a.ts', state: 'present' }], source: 'matched',
  effects: 'none' };
const NOT_APPLICABLE = { state: 'not_applicable', reason: 'x' } as const;
const result = (outcome: WitnessCheckResult['outcome'], incompleteCause: 'source_not_matched' | null = null,
  missingPaths: string[] = []): WitnessCheckResult => ({ outcome, incompleteCause, missingPaths });

const verdictRows: [string, Partial<WitnessCheckInput>, WitnessCheckResult][] = [
  ['clean', {}, result('PASS')],
  ['no required path, one successful read', { paths: [] }, result('PASS')],
  ['report absent', { report: { state: 'absent' } }, result('FAIL')],
  ['known zero reads', { reads: { state: 'known', paths: [] }, paths: [] }, result('FAIL')],
  ['absent paths, missingPaths in input order', { paths: [{ path: 'a.ts', state: 'present' },
    { path: 'b.ts', state: 'absent' }, { path: 'c.ts', state: 'absent' }] }, result('FAIL', null, ['b.ts', 'c.ts'])],
  ['effects changed', { effects: 'changed' }, result('FAIL')],
  ['run not applicable', { run: NOT_APPLICABLE }, result('INCONCLUSIVE')],
  ['run unknown', { run: { state: 'unknown', reason: 'x' } }, result('INCONCLUSIVE')],
  ['report unknown', { report: { state: 'unknown', reason: 'x' } }, result('INCONCLUSIVE')],
  ['reads unknown, no required path', { reads: { state: 'unknown', reason: 'x' }, paths: [] }, result('INCONCLUSIVE')],
  ['a path unknown', { paths: [{ path: 'a.ts', state: 'unknown' }] }, result('INCONCLUSIVE')],
  ['effects unknown', { effects: 'unknown' }, result('INCONCLUSIVE')],
  ['source changed on an applicable run', { source: 'changed' }, result('INCONCLUSIVE', 'source_not_matched')],
  ['source changed on a run not applicable', { run: NOT_APPLICABLE, source: 'changed' }, result('INCONCLUSIVE')],
  ['FAIL with a gap: report absent, run not applicable', { report: { state: 'absent' }, run: NOT_APPLICABLE },
    result('FAIL')],
  ['FAIL with a gap: effects changed, source changed', { effects: 'changed', source: 'changed' }, result('FAIL')],
];

describe('P1 runWitnessCheck: FAIL before INCONCLUSIVE before PASS', () => {
  it.each(verdictRows)('%s', (_name, change, expected) => {
    expect(runWitnessCheck({ ...CLEAN, ...change })).toEqual(expected);
  });
});

const unsafe = (path: string): [string, string[], WitnessReadSet, WitnessPathVerdict[]] =>
  [`unsafe ${path}`, [path], { state: 'known', paths: [path] }, [{ path, state: 'unknown' }]];
const pathRows: [string, string[], WitnessReadSet, WitnessPathVerdict[]][] = [
  ['exact has, case kept, required order', ['src/c.ts', 'src/a.ts', 'Src/B.ts'],
    { state: 'known', paths: ['src/a.ts', 'src/b.ts'] },
    [{ path: 'src/c.ts', state: 'absent' }, { path: 'src/a.ts', state: 'present' }, { path: 'Src/B.ts', state: 'absent' }]],
  unsafe('../x'), unsafe('/abs'), unsafe('a/../b'), unsafe('./a'), unsafe('src/*.ts'),
  ['reads unknown', ['src/a.ts', 'src/b.ts'], { state: 'unknown', reason: 'x' },
    [{ path: 'src/a.ts', state: 'unknown' }, { path: 'src/b.ts', state: 'unknown' }]],
  ['no normalize', ['b'], { state: 'known', paths: ['a/../b'] }, [{ path: 'b', state: 'absent' }]],
];

describe('P2 pathVerdictsOf: present, absent or unknown per required path', () => {
  it.each(pathRows)('%s', (_name, required, reads, expected) => {
    expect(pathVerdictsOf(required, reads)).toEqual(expected);
  });
});

const AT = '2026-11-12T00:00:00.000Z';
const counted = (input: Omit<Parameters<typeof countedFacts>[0], 'turnStartedAt' | 'lastRecordAt'> = {}) =>
  countedFacts({ turnStartedAt: AT, lastRecordAt: AT, ...input });
const DEFINITE = { definite: ['src/a.ts'] };
const NOT_COMPLETE = { added: 0, deleted: 0, complete: false };
const effectRows: [string, RunActivityFactsV1, 'none' | 'changed' | 'unknown'][] = [
  ['all clear', counted(), 'none'],
  ['a definite file', counted({ changedFiles: DEFINITE }), 'changed'],
  ['definite files omitted', counted({ changedFiles: { definiteOmitted: 1 } }), 'changed'],
  ['lines added', counted({ changedLines: { added: 1, deleted: 0, complete: true } }), 'changed'],
  ['lines deleted', counted({ changedLines: { added: 0, deleted: 1, complete: true } }), 'changed'],
  ['a possible file', counted({ changedFiles: { possible: ['src/a.ts'] } }), 'unknown'],
  ['possible files omitted', counted({ changedFiles: { possibleOmitted: 1 } }), 'unknown'],
  ['possibly incomplete', counted({ changedFiles: { possiblyIncomplete: true, incompleteBecause: ['command_ran'] } }),
    'unknown'],
  ['the Turn not terminal', counted({ turnTerminal: false }), 'unknown'],
  ['an unresolved call', counted({ unresolvedCalls: 1 }), 'unknown'],
  ['status unknown', { status: 'unknown', ruleVersion: 2, reason: 'history_read_failed', detail: 'x' }, 'unknown'],
  ['definite and possible', counted({ changedFiles: { ...DEFINITE, possible: ['src/b.ts'] } }), 'changed'],
  ['complete:false, all clear', counted({ changedLines: NOT_COMPLETE }), 'none'],
  ['complete:false with a definite file', counted({ changedFiles: DEFINITE, changedLines: NOT_COMPLETE }), 'changed'],
];

describe('P3 effectsOf: the stored RunActivity facts only', () => {
  it.each(effectRows)('%s', (_name, facts, expected) => {
    expect(effectsOf(facts)).toBe(expected);
  });
});

const P = 'sb06-project', G = 'sb06-goal';
const PLAN_REF = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' } as const;
const requirement = (requirementId: string, kind: string, requiredReadPaths?: string[]) => ({ requirementId,
  requirementLevel: 'required' as const, kind, description: requirementId,
  ...(requiredReadPaths === undefined ? {} : { requiredReadPaths }) });
const obligation = (obligationId: string, taskId: string,
  ...verificationRequirements: ReturnType<typeof requirement>[]): AcceptanceObligation =>
  ({ obligationId, title: obligationId, requirementLevel: 'required', taskIds: [taskId], verificationRequirements });
const task = (taskId: string): RuntimeTask => ({ taskId, title: taskId, requirementLevel: 'required', taskKind: 'work',
  disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
const PLAN: PlanRevisionSnapshot = {
  ref: PLAN_REF, revision: 1, schemaVersion: 2, goalRef: { aggregateType: 'Goal', projectId: P, goalId: G },
  planId: 'plan-1', planRevision: 1, acceptedAt: AT,
  effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'policy-1',
    revision: 1 }, digest: 'e'.repeat(64) },
  effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P,
    baselineId: 'baseline-1', revision: 1 }, digest: 'f'.repeat(64) },
  stages: [], tasks: [task('t1'), task('t2')], obligations: [],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
};
const CAPABILITIES: CheckCapabilityV1[] = [
  { checkId: 'lint', kind: 'static', coversKinds: ['static'], replayable: false },
  { checkId: 'platform:witness', kind: 'witness', coversKinds: ['witness'], replayable: false },
];
const witnessItem = (coverage: { obligationId: string; requirementId: string }[], requiredReadPaths: string[]) =>
  ({ checkId: 'platform:witness', kind: 'witness', satisfiesKind: 'witness', coverage, satisfactionPath: 'predicate',
    requiredReadPaths });
const compilerRows: [string, AcceptanceObligation[], VerificationCheckPlan[]][] = [
  ['C1 the covered union, first seen, deduplicated; t2 and the command item untouched', [
    obligation('ob1', 't1', requirement('s1', 'static'), requirement('w1', 'witness', ['src/a.ts', 'src/b.ts'])),
    obligation('ob2', 't1', requirement('w2', 'witness', ['src/b.ts', 'src/c.ts'])),
    obligation('ob3', 't2', requirement('w3', 'witness', ['src/z.ts'])),
  ], [
    { checkId: 'lint', kind: 'static', satisfiesKind: 'static', coverage: [{ obligationId: 'ob1', requirementId: 's1' }],
      satisfactionPath: 'predicate' },
    witnessItem([{ obligationId: 'ob1', requirementId: 'w1' }, { obligationId: 'ob2', requirementId: 'w2' }],
      ['src/a.ts', 'src/b.ts', 'src/c.ts']),
  ] as VerificationCheckPlan[]],
  ['C2 no requirement lists a path: an empty list', [obligation('ob1', 't1', requirement('w1', 'witness'))],
    [witnessItem([{ obligationId: 'ob1', requirementId: 'w1' }], [])] as VerificationCheckPlan[]],
];

describe('C attachWitnessPaths through compileVerificationPlan', () => {
  it.each(compilerRows)('%s', (_name, obligations, expected) => {
    const compiled = compileVerificationPlan({ schemaVersion: 1, taskRef: { projectId: P, goalId: G, taskId: 't1' },
      planRef: PLAN_REF, planSnapshot: { ...PLAN, obligations }, workspaceRevision: 3,
      changeScope: { diffClass: 'code-change', changedFiles: [], writeSummary: 'read only' }, semanticChange: 'none',
      checkCapabilities: CAPABILITIES, policy: { requirementKinds: ['static', 'witness'] } });
    if (compiled.status !== 'ready') throw new Error(`compile rejected: ${compiled.code}`);
    expect(compiled.plan.checks).toStrictEqual(expected);
  });
});
