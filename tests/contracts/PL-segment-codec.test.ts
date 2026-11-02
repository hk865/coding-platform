/**
 * PL slice P1: the plan codec's format checks for the two new RuntimeTask
 * fields (spec §5.3.1–§5.3.2). This file is the behavioural red the package can
 * show before its implementation: the codec accepts both fields today.
 *
 * One illegal field per row; every row starts from an otherwise valid
 * PlanRevisionSnapshot. The codec is the exported decode entry, not a private
 * helper.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';

const projectId = 'pl-segment-codec';
const goalRef = { aggregateType: 'Goal', projectId, goalId: 'goal-1' } as const;
const at = '2026-11-01T00:00:00.000Z';

function taskBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: 'work-1',
    stageId: 'stage-1',
    title: 'Work',
    requirementLevel: 'required',
    taskKind: 'work',
    disposition: 'active',
    phase: 'pending',
    scope: { kind: 'stage', stageId: 'stage-1' },
    executionIntent: 'request_execution',
    ...extra,
  };
}

function snapshotBody(taskExtra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: { aggregateType: 'PlanRevision', projectId, planId: 'plan-1' },
    revision: 1,
    schemaVersion: 2,
    goalRef,
    planId: 'plan-1',
    planRevision: 1,
    acceptedAt: at,
    effectiveCompletionPolicy: {
      ref: { aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'policy-1', revision: 1 },
      digest: 'a'.repeat(64),
    },
    effectiveArchitectureBaseline: {
      ref: { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId: 'baseline-1', revision: 1 },
      digest: 'b'.repeat(64),
    },
    stages: [{ stageId: 'stage-1', title: 'First segment' }],
    tasks: [taskBody(taskExtra)],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

function encoded(body: Record<string, unknown>): EncodedRecord {
  return {
    refKey: canonicalJson(body['ref'] as JsonValue),
    schemaId: 'PlanRevisionSnapshot@1',
    revision: body['revision'] as number,
    json: JSON.stringify(body),
  };
}

function decode(taskExtra: Record<string, unknown> = {}) {
  return decodePlanRevisionSnapshot(encoded(snapshotBody(taskExtra)));
}

describe('accepts: estimatedLines and sizeClass', () => {
  it.each([
    ['an estimate of one line', { estimatedLines: 1 }],
    ['the largest safe integer', { estimatedLines: Number.MAX_SAFE_INTEGER }],
    ['no estimate at all', {}],
  ] as const)('accepts %s', (_name, extra) => {
    expect(decode(extra).status).toBe('decoded');
  });

  it.each([
    ['small', 'small'],
    ['medium', 'medium'],
    ['large', 'large'],
    ['explore', 'explore'],
    ['no class at all', undefined],
  ] as const)('accepts sizeClass %s', (_name, value) => {
    expect(decode(value === undefined ? {} : { sizeClass: value }).status).toBe('decoded');
  });
});

describe('rejects: estimatedLines (format only)', () => {
  it.each([
    ['zero', { estimatedLines: 0 }],
    ['a negative integer', { estimatedLines: -1 }],
    ['a fraction', { estimatedLines: 1.5 }],
  ] as const)('rejects %s', (_name, extra) => {
    const result = decode(extra);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain('estimatedLines must be a positive safe integer when present');
    }
  });
});

describe('rejects: sizeClass (format only)', () => {
  it.each([
    ['an unknown literal', { sizeClass: 'huge' }],
    ['a non-string', { sizeClass: 3 }],
  ] as const)('rejects %s', (_name, extra) => {
    const result = decode(extra);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain('sizeClass must be small|medium|large|explore when present');
    }
  });
});
