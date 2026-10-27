/** Row 35a's pure table: birth/accept, the six state functions, the shared progress rule and the codecs (A5: pure only). */
import { describe, expect, it } from 'vitest';
import type {
  AdoptionSaveAfterInputV1, AdoptionSaveBeforeInputV1, AdoptionStageProgressV1, AdoptionStageResultV1,
  InitializationAdoptionRecordV1,
} from '../../src/contracts/initialization-adoption.js';
import { adoptionProgressProblem } from '../../src/contracts/validation/initialization-adoption.js';
import {
  acceptExistingInitializationAdoption, advanceInitializationAdoption, committedAdoptionRecord,
  completeInitializationAdoption, newInitializationAdoptionRecord, nextAdoptionStage, stopInitializationAdoption,
} from '../../src/core/work-graph/state/initialization-adoption.js';
import {
  INITIALIZATION_ADOPTION_SCHEMAS, initializationAdoptionCodec,
} from '../../src/core/work-graph/persistence/initialization-adoption-codecs.js';
import { aggregateRefProblem } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';

const REF = { aggregateType: 'InitializationAdoption' as const, projectId: 'p-j', operationId: 'op-j' };
const SCOPE = { projectId: 'p-j', workspaceId: 'w-j' };
const ANSWER_REF = {
  aggregateType: 'QueryJobAnswer' as const, projectId: 'p-j', workspaceId: 'w-j', queryJobId: 'qj-j', answerId: 'a-j',
};
const SOURCE = { kind: 'prepared_goal' as const, answerRef: ANSWER_REF };
const GOAL = { ref: { aggregateType: 'Goal' as const, projectId: 'p-j', goalId: 'g-j' }, revision: 1 };
const PINS = {
  project: { ref: { aggregateType: 'Project' as const, projectId: 'p-j' }, revision: 1 },
  goal: { ref: GOAL.ref, revision: 1 }, architecture: null, policy: null, checks: null,
};
const CHECKS = { checkId: 'check-1', kind: 'static' as const, command: 'true', cwd: '.', timeoutMs: 1000, taskIds: 'all' as const };
const CHECKS_VALUE = {
  configuration: {
    configurationRevision: 'cfg-1',
    workspace: { aggregateType: 'Workspace' as const, projectId: 'p-j', workspaceId: 'w-j' },
    executor: { kind: 'human' as const, id: 'person-j' }, permissionRevision: 'perm-1',
    sourceAccess: 'verification_workspace' as const, processAccess: 'all_except_denied' as const,
    deniedPrefixes: ['/tmp'], checks: [CHECKS],
  },
  settings: { answerRef: ANSWER_REF, answerDigest: 'f'.repeat(64) }, contentDigest: '1'.repeat(64),
};
const CONFIRMATION = { configurationRevision: 'cfg-1', contentDigest: '1'.repeat(64), settings: null, checks: [CHECKS] };
const APPLY_RECEIPT = {
  plan: { aggregateType: 'PlanRevision' as const, projectId: 'p-j', planId: 'pl-j' }, cursor: makeCommitCursor(9),
};
const stopFailure = {
  status: 'pending' as const, operationRef: REF, stage: 'freeze' as const, completedSteps: ['admission' as const],
  retryable: true, failure: { code: 'unavailable' as const, reason: 'the freeze child is unavailable' },
};
const SIX = ['admission', 'freeze', 'architecture', 'policy_install', 'policy_activate', 'checks'] as const;

function birth(): InitializationAdoptionRecordV1 {
  return newInitializationAdoptionRecord({
    ref: REF, scope: SCOPE, principal: { kind: 'human', id: 'person-j' }, commandId: 'cmd-1',
    fingerprint: 'b'.repeat(64), generation: 1, source: SOURCE, expectedAnswerDigest: 'c'.repeat(64), expectedGoal: GOAL,
  });
}

function beforeInput(stage: AdoptionStageProgressV1['stage'], generation: number): AdoptionSaveBeforeInputV1 {
  return {
    commandId: `op-j/${stage}`, operationRef: REF, stage, generation,
    child: { commandId: `op-j/${stage}`, identityKey: `op-j/${stage}`, fingerprint: 'a'.repeat(64) },
    savedInput: { stage }, pins: PINS,
  };
}

function afterInput(
  stage: AdoptionStageProgressV1['stage'], generation: number, outcome: 'skipped' | 'reused' | 'installed',
  result: AdoptionStageResultV1,
): Extract<AdoptionSaveAfterInputV1, { branch: 'advance' }> {
  return { commandId: `op-j/${stage}`, operationRef: REF, stage, generation, branch: 'advance', outcome, result };
}

function mark(
  stage: AdoptionStageProgressV1['stage'], outcome: AdoptionStageProgressV1['outcome'],
  result: AdoptionStageProgressV1['result'],
): AdoptionStageProgressV1 {
  return {
    stage, child: { commandId: `op-j/${stage}`, identityKey: `op-j/${stage}`, fingerprint: 'a'.repeat(64) },
    savedInput: { stage }, pins: PINS, generation: 1, outcome, result,
  };
}

function stopped(): InitializationAdoptionRecordV1 {
  const admission = advanceInitializationAdoption(
    nextAdoptionStage(birth(), beforeInput('admission', 1)), afterInput('admission', 1, 'installed', { kind: 'none' }),
  );
  return stopInitializationAdoption(nextAdoptionStage(admission, beforeInput('freeze', 1)), {
    commandId: 'op-j/freeze', operationRef: REF, stage: 'freeze', generation: 1, branch: 'stop',
    outcome: 'failed', result: { kind: 'none' }, failure: stopFailure.failure, retryable: true,
  });
}

/** One standalone literal record: the caller passes prefix, revision and marks, so no expectation is derived. */
function literalRecord(
  prefix: readonly AdoptionStageProgressV1['stage'][], revision: number, marks: readonly AdoptionStageProgressV1[],
): InitializationAdoptionRecordV1 {
  return { ...birth(), revision, completedSteps: [...prefix], stages: [...marks], result: null };
}

function checksRecord(confirmation: typeof CONFIRMATION | null): InitializationAdoptionRecordV1 {
  return literalRecord(SIX, 7, [
    mark('admission', 'installed', { kind: 'none' }), mark('freeze', 'installed', { kind: 'none' }),
    mark('architecture', 'reused', { kind: 'none' }), mark('policy_install', 'reused', { kind: 'none' }),
    mark('policy_activate', 'skipped', { kind: 'none' }),
    mark('checks', 'installed', { kind: 'checks', save: { status: 'saved', value: CHECKS_VALUE }, confirmation }),
  ]);
}

describe('the adoption record table', () => {
  it('birth is revision 1, generation 1, empty and uncommitted', () => {
    expect(birth()).toEqual({
      ref: REF, revision: 1, scope: SCOPE, principal: { kind: 'human', id: 'person-j' }, commandId: 'cmd-1',
      fingerprint: 'b'.repeat(64), generation: 1, source: SOURCE, expectedAnswerDigest: 'c'.repeat(64),
      expectedGoal: GOAL, completedSteps: [], stages: [], result: null, since: null,
    });
  });

  it('acceptExisting raises revision and generation and rewrites only the accept identity', () => {
    const record = stopped();
    const accepted = acceptExistingInitializationAdoption(record, {
      commandId: 'cmd-2', fingerprint: 'd'.repeat(64), principal: { kind: 'human', id: 'person-2' },
      source: SOURCE, expectedAnswerDigest: 'e'.repeat(64), expectedGoal: GOAL,
    });
    expect(accepted).toEqual({
      ...record, revision: record.revision + 1, generation: 2, commandId: 'cmd-2', fingerprint: 'd'.repeat(64),
      principal: { kind: 'human', id: 'person-2' }, expectedAnswerDigest: 'e'.repeat(64),
    });
    expect(accepted.completedSteps).toEqual(['admission']);
    expect(accepted.stages).toEqual(record.stages);
    expect(accepted.result).toEqual(stopFailure);
  });

  it('nextAdoptionStage appends the before-mark, keeps the prefix and clears a stopped result', () => {
    const first = nextAdoptionStage(birth(), beforeInput('admission', 1));
    expect(first).toEqual({
      ...birth(), revision: 2,
      stages: [{
        stage: 'admission', child: { commandId: 'op-j/admission', identityKey: 'op-j/admission', fingerprint: 'a'.repeat(64) },
        savedInput: { stage: 'admission' }, pins: PINS, generation: 1, outcome: null, result: null,
      }],
      result: null,
    });
    const retry = nextAdoptionStage(stopped(), beforeInput('freeze', 2));
    expect(retry.completedSteps).toEqual(['admission']);
    expect(retry.stages[1]).toEqual({
      stage: 'freeze', child: { commandId: 'op-j/freeze', identityKey: 'op-j/freeze', fingerprint: 'a'.repeat(64) },
      savedInput: { stage: 'freeze' }, pins: PINS, generation: 2, outcome: null, result: null,
    });
    expect(retry.result).toBeNull();
    expect(() => nextAdoptionStage(birth(), beforeInput('checks', 1))).toThrow('the before-mark is not for the current stage');
    expect(() => nextAdoptionStage(first, beforeInput('architecture', 1))).toThrow('the before-mark is not for the current stage');
    expect(() => nextAdoptionStage(stopped(), beforeInput('admission', 1))).toThrow('the before-mark is not for the current stage');
  });

  it('advance completes exactly the current mark, extends the prefix and writes no record result', () => {
    const advanced = advanceInitializationAdoption(
      nextAdoptionStage(birth(), beforeInput('admission', 1)), afterInput('admission', 1, 'installed', { kind: 'none' }),
    );
    expect(advanced.completedSteps).toEqual(['admission']);
    expect(advanced.stages[0]).toEqual(mark('admission', 'installed', { kind: 'none' }));
    expect(advanced.result).toBeNull();
    expect(advanced.revision).toBe(3);
  });

  it.each([
    { name: 'advance', after: (record: InitializationAdoptionRecordV1) =>
      advanceInitializationAdoption(record, afterInput('admission', 2, 'installed', { kind: 'none' })) },
    { name: 'stop', after: (record: InitializationAdoptionRecordV1) => stopInitializationAdoption(record, {
      commandId: 'op-j/admission', operationRef: REF, stage: 'admission', generation: 2, branch: 'stop',
      outcome: 'failed', result: { kind: 'none' },
      failure: { code: 'unavailable', reason: 'the admission child is unavailable' }, retryable: true,
    }) },
  ])('the $name after-write stamps a carried before-mark with the write generation', ({ after }) => {
    const carried = acceptExistingInitializationAdoption(nextAdoptionStage(birth(), beforeInput('admission', 1)), {
      commandId: 'cmd-2', fingerprint: 'd'.repeat(64), principal: { kind: 'human', id: 'person-2' },
      source: SOURCE, expectedAnswerDigest: 'e'.repeat(64), expectedGoal: GOAL,
    });
    expect(carried.stages[0]?.generation).toBe(1);
    expect(after(carried).stages[0]?.generation).toBe(2);
  });

  it('stop keeps the real outcome and result, keeps the prefix and records the pending stop', () => {
    const record = stopped();
    expect(record.revision).toBe(5);
    expect(record.completedSteps).toEqual(['admission']);
    expect(record.stages[1]).toEqual(mark('freeze', 'failed', { kind: 'none' }));
    expect(record.result).toEqual(stopFailure);
  });

  it('complete writes the apply mark, all eight stages and the committed receipt', () => {
    const beforeApply = literalRecord([...SIX, 'propose'], 9, [
      mark('admission', 'installed', { kind: 'none' }), mark('freeze', 'installed', { kind: 'none' }),
      mark('architecture', 'skipped', { kind: 'none' }), mark('policy_install', 'skipped', { kind: 'none' }),
      mark('policy_activate', 'skipped', { kind: 'none' }), mark('checks', 'reused', { kind: 'none' }),
      mark('propose', 'skipped', { kind: 'none' }), { ...mark('apply', null, null), generation: 1 },
    ]);
    const applyResult: AdoptionStageResultV1 = {
      kind: 'ledger', receipt: { commandId: 'op-j/apply', cursor: makeCommitCursor(8), value: { planId: 'pl-j' } },
    };
    const done = completeInitializationAdoption(beforeApply, {
      commandId: 'op-j/apply', operationRef: REF, stage: 'apply', generation: 2, branch: 'complete',
      outcome: 'installed', result: applyResult, receipt: APPLY_RECEIPT, replayed: false,
    });
    expect(done.completedSteps).toEqual([
      'admission', 'freeze', 'architecture', 'policy_install', 'policy_activate', 'checks', 'propose', 'apply',
    ]);
    expect(done.stages[7]).toEqual({
      ...beforeApply.stages[7], generation: 2, outcome: 'installed', result: applyResult,
    });
    expect(done.result).toEqual({ status: 'committed', receipt: APPLY_RECEIPT, replayed: false });
    expect(done.revision).toBe(10);
  });
});

describe('the committed record projection', () => {
  it('drops the advanced event envelope and fills the committed since', () => {
    const { since: _since, ...fields } = stopped();
    const event = {
      eventId: 'evt-adoption-1', eventType: 'InitializationAdoptionAdvanced', schemaVersion: 1,
      occurredAt: '2026-10-27T00:00:00.000Z', ...fields,
    };
    expect(committedAdoptionRecord(event, makeCommitCursor(5))).toEqual({ ...fields, since: makeCommitCursor(5) });
  });
});

describe('the shared progress rule', () => {
  it('accepts a completed checks mark only with its matching real confirmation', () => {
    expect(adoptionProgressProblem(checksRecord(CONFIRMATION))).toBeNull();
    expect(adoptionProgressProblem(checksRecord(null))).toBe('an installed checks stage has no real confirmation');
    expect(adoptionProgressProblem(checksRecord({ ...CONFIRMATION, contentDigest: '2'.repeat(64) })))
      .toBe('the checks confirmation does not match the saved configuration');
  });

  it('lets only a failed stage be retryable', () => {
    expect(adoptionProgressProblem({ ...stopped(), result: { ...stopFailure, retryable: false } })).toBeNull();
    expect(adoptionProgressProblem({
      ...stopped(), stages: [stopped().stages[0]!, { ...stopped().stages[1]!, outcome: 'not_saved' }],
      result: { ...stopFailure, retryable: true },
    })).toBe('only a failed stage may be retryable');
  });

  it('keeps the ledger, checks and none child results apart', () => {
    const split = literalRecord(['admission', 'freeze', 'architecture'], 4, [
      mark('admission', 'installed', { kind: 'none' }), mark('freeze', 'installed', { kind: 'none' }),
      mark('architecture', 'installed', {
        kind: 'ledger', receipt: { commandId: 'op-j/architecture', cursor: makeCommitCursor(1), value: { baselineId: 'b1' } },
      }),
    ]);
    expect(adoptionProgressProblem(split)).toBeNull();
  });

  it('registers the adoption ref and shape-checks the binding ref in the shared aggregate table', () => {
    expect(aggregateRefProblem(REF)).toBeNull();
    expect(aggregateRefProblem({ aggregateType: 'InitializationAdoption', projectId: 'p-j' }))
      .toBe('an aggregate ref InitializationAdoption requires a non-empty operationId');
    expect(aggregateRefProblem({
      aggregateType: 'InitializationBinding', projectId: 'p-j', answerRef: ANSWER_REF, draftIndex: 0,
    })).toBeNull();
    expect(aggregateRefProblem({
      aggregateType: 'InitializationBinding', projectId: 'p-j', answerRef: { ...ANSWER_REF, answerId: '' }, draftIndex: 0,
    })).toBe('InitializationBindingRef.answerRef.answerId is invalid');
  });
});

describe('the adoption codec', () => {
  it('round-trips the record, refuses a damaged one and registers exactly two event types', () => {
    const stored: InitializationAdoptionRecordV1 = { ...stopped(), since: makeCommitCursor(5) };
    const encoded = initializationAdoptionCodec.encode(stored);
    expect(encoded).toMatchObject({ schemaId: 'InitializationAdoption@1', revision: 5 });
    expect(encoded.refKey).toBe('{"aggregateType":"InitializationAdoption","operationId":"op-j","projectId":"p-j"}');
    const decoded = initializationAdoptionCodec.decode(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(stored);
    const checks = initializationAdoptionCodec.encode({ ...checksRecord(CONFIRMATION), since: makeCommitCursor(7) });
    expect(initializationAdoptionCodec.decode(checks).status).toBe('decoded');
    const damaged = { ...encoded, json: JSON.stringify({ ...JSON.parse(encoded.json), revision: 0 }) };
    expect(initializationAdoptionCodec.decode(damaged).status).toBe('invalid');
    expect(INITIALIZATION_ADOPTION_SCHEMAS.events.map(event => event.eventType))
      .toEqual(['InitializationAdoptionAccepted', 'InitializationAdoptionAdvanced']);
    expect(INITIALIZATION_ADOPTION_SCHEMAS.records[0]?.commitCursorFields).toEqual(['since']);
  });
});
