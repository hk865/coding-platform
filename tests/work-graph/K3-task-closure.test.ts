/**
 * K3 rework 1 item 4 / 12.1 / 12.3 / 12.4: pure unit tests for the shared
 * foundation. Every input here is a CONSTRUCTED value handed to a pure function
 * (allowed by the coordinator-mode rule); no reader, codec or store is faked.
 */
import { describe, expect, it } from 'vitest';
import type { CanonicalTaskFacts } from '../../src/core/work-graph/tasks/plan-readers.js';
import { taskClosureOf } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import { pinRevision } from '../../src/core/work-graph/tasks/revision-guard.js';
import {
  hasOnlyKeys, isInt, isNonNeg, isObject, isPos, isSha256Hex, nonEmpty, parseObject, utf8Bytes,
} from '../../src/core/work-graph/tasks/codec-fields.js';
import {
  nestedSourceObject, parseDecisionSourceKey,
} from '../../src/core/work-graph/tasks/decision-source-identity.js';

function planWith(tasks: Array<Pick<RuntimeTask, 'taskId' | 'disposition'>>): PlanRevisionSnapshot {
  return { schemaVersion: 1, tasks } as unknown as PlanRevisionSnapshot;
}

function factsWith(entries: Array<[string, string]>): CanonicalTaskFacts {
  return {
    byTaskId: new Map(entries.map(([taskId, effectivePhase]) => [taskId, { taskId, effectivePhase }])),
  } as unknown as CanonicalTaskFacts;
}

describe('taskClosureOf (item 4: one canonical closure derivation)', () => {
  it('is closed as satisfied from the canonical task state', () => {
    expect(taskClosureOf(planWith([{ taskId: 't1', disposition: 'active' }]), factsWith([['t1', 'satisfied']]), 't1'))
      .toEqual({ closed: true, cause: 'satisfied' });
  });

  it('is closed as cancelled from the task definition disposition', () => {
    expect(taskClosureOf(planWith([{ taskId: 't1', disposition: 'cancelled' }]), factsWith([['t1', 'pending']]), 't1'))
      .toEqual({ closed: true, cause: 'cancelled' });
  });

  it('is closed as superseded from the task definition disposition', () => {
    expect(taskClosureOf(planWith([{ taskId: 't1', disposition: 'superseded' }]), factsWith([['t1', 'blocked']]), 't1'))
      .toEqual({ closed: true, cause: 'superseded' });
  });

  it('orders satisfied before cancelled when both hold', () => {
    expect(taskClosureOf(planWith([{ taskId: 't1', disposition: 'cancelled' }]), factsWith([['t1', 'satisfied']]), 't1'))
      .toEqual({ closed: true, cause: 'satisfied' });
  });

  it('is open with no cause for a live task', () => {
    expect(taskClosureOf(planWith([{ taskId: 't1', disposition: 'active' }]), factsWith([['t1', 'in_progress']]), 't1'))
      .toEqual({ closed: false, cause: null });
  });
});

describe('pinRevision (item 12.1: one revision guard)', () => {
  const ref = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
  const pin = (revision: number, at = ref): VersionPin => ({ ref: at, revision } as unknown as VersionPin);

  it('returns the single exact pin revision', () => {
    expect(pinRevision([pin(1, { aggregateType: 'Goal', projectId: 'p', goalId: 'other' }), pin(3)], ref)).toBe(3);
  });

  it('returns null when the pin is absent', () => {
    expect(pinRevision([pin(1, { aggregateType: 'Goal', projectId: 'p', goalId: 'other' })], ref)).toBeNull();
  });

  it('returns null for a repeated or malformed pin', () => {
    expect(pinRevision([pin(1), pin(2)], ref)).toBeNull();
    expect(pinRevision([pin(-1)], ref)).toBeNull();
    expect(pinRevision([pin(1.5)], ref)).toBeNull();
    expect(pinRevision([{ ref, revision: '1' } as unknown as VersionPin], ref)).toBeNull();
  });

  it('returns null for a non-record ref', () => {
    expect(pinRevision([pin(1)], 'not-a-ref')).toBeNull();
  });
});

describe('codec field primitives (item 12.3: one copy)', () => {
  it('checks records, strings and integers', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(nonEmpty('x')).toBe(true);
    expect(nonEmpty('')).toBe(false);
    expect(isInt(0)).toBe(true);
    expect(isInt(1.5)).toBe(false);
    expect(isNonNeg(0)).toBe(true);
    expect(isNonNeg(-1)).toBe(false);
    expect(isPos(1)).toBe(true);
    expect(isPos(0)).toBe(false);
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(hasOnlyKeys({ a: 1 }, ['a'])).toBe(true);
    expect(hasOnlyKeys({ a: 1, b: 2 }, ['a'])).toBe(false);
    expect(utf8Bytes('é')).toBe(2);
    expect(parseObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseObject('[]')).toBeNull();
    expect(parseObject('not json')).toBeNull();
  });
});

describe('parseDecisionSourceKey (item 12.4: one source-identity parse)', () => {
  it('parses an object key with a non-empty kind', () => {
    expect(parseDecisionSourceKey({ key: '{"kind":"command_rerun_request","revision":2}' }))
      .toEqual({ kind: 'command_rerun_request', body: { kind: 'command_rerun_request', revision: 2 } });
  });

  it('refuses a non-JSON, non-object or kind-less key', () => {
    expect(parseDecisionSourceKey({ key: 'not json' })).toBeNull();
    expect(parseDecisionSourceKey({ key: '[]' })).toBeNull();
    expect(parseDecisionSourceKey({ key: '{"kind":""}' })).toBeNull();
    expect(parseDecisionSourceKey({ key: '{"kind":7}' })).toBeNull();
  });

  it('reads a nested object field', () => {
    expect(nestedSourceObject({ requestRef: { requestId: 'r' } }, 'requestRef')).toEqual({ requestId: 'r' });
    expect(nestedSourceObject({ requestRef: [] }, 'requestRef')).toBeNull();
    expect(nestedSourceObject({}, 'requestRef')).toBeNull();
  });
});
