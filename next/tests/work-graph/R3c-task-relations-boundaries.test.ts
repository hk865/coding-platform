/**
 * R3c boundary counterexamples that the existing R3c suites do not pin.
 *
 * Scope (DSH phase one only):
 * - `evaluateEligibility` must never invent a `pending` phase for a task whose
 *   canonical phase was not read; the frozen reason `task_state_incomplete`
 *   already exists in `src/contracts/dispatch.ts`.
 * - The one registered Store codec has stable `schemaId` and accepts explicit
 *   body versions 1|2. Unknown versions and v1 bodies carrying v2-only
 *   whiteboard/exact-input fields must fail, never be silently dropped.
 *
 * The upstream-running half of the candidate rule ("a running predecessor does
 * not by itself reject a pending/free implementation") is already pinned by
 * `R3c-task-graph.test.ts`; it is intentionally not duplicated here.
 */
import { expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import { evaluateEligibility } from '../../src/core/work-graph/tasks/eligibility.js';
import {
  decodePlanRevisionSnapshot,
  encodePlanRevisionSnapshot,
} from '../../src/core/work-graph/tasks/plan-record-codecs.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'r3c-boundaries';
const goalRef = { aggregateType: 'Goal', projectId, goalId: 'goal-1' } as const;

function snapshotBody(schemaVersion: 1 | 2, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: { aggregateType: 'PlanRevision', projectId, planId: 'plan-1' },
    revision: 1,
    schemaVersion,
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
    stages: [],
    tasks: [{
      taskId: 'work-1', title: 'Work', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
    }],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
    ...extra,
  };
}

function encodedRecord(schemaId: string, body: Record<string, unknown>): EncodedRecord {
  return { refKey: canonicalJson(body['ref'] as JsonValue), schemaId,
    revision: body['revision'] as number, json: JSON.stringify(body) };
}

it('does not treat an absent canonical task phase as pending', () => {
  const plan = {
    tasks: [
      { taskId: 'design', taskKind: 'work', disposition: 'active', phase: 'pending' },
      { taskId: 'implement', taskKind: 'work', disposition: 'active', phase: 'pending' },
    ],
    executionDag: { dependsOn: [] },
  } as unknown as PlanRevisionSnapshot;
  const result = evaluateEligibility({
    plan,
    goalDesiredState: 'active',
    taskId: 'implement',
    // 'implement' has no canonical phase here; defaulting it to pending would
    // produce a false positive because the lease is free and the DAG is empty.
    effectivePhases: new Map([['design', 'satisfied']] as const),
    lease: { status: 'free' },
  });
  expect(result.eligible).toBe(false);
  expect(result.reasons).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'task_state_incomplete', taskId: 'implement' }),
  ]));
});

it('uses one stable Store codec family and explicit Plan content versions', () => {
  const v1 = snapshotBody(1);
  const v2 = snapshotBody(2, { taskRelations: [], inputRequirements: [] });
  expect(decodePlanRevisionSnapshot(encodedRecord('PlanRevisionSnapshot@1', v1)).status).toBe('decoded');
  expect(decodePlanRevisionSnapshot(encodedRecord('PlanRevisionSnapshot@1', v2)).status).toBe('decoded');
  expect(decodePlanRevisionSnapshot(encodedRecord('PlanRevisionSnapshot@2', v2)).status).toBe('invalid');
  expect(decodePlanRevisionSnapshot(encodedRecord('PlanRevisionSnapshot@1', { ...v2, schemaVersion: 99 })).status).toBe('invalid');
  expect(encodePlanRevisionSnapshot(v2 as unknown as PlanRevisionSnapshot).schemaId).toBe('PlanRevisionSnapshot@1');
});

it('rejects a v1 PlanRevisionSnapshot that carries v2-only fields', () => {
  const v1WithV2Fields = snapshotBody(1, { taskRelations: [], inputRequirements: [] });
  expect(decodePlanRevisionSnapshot(encodedRecord('PlanRevisionSnapshot@1', v1WithV2Fields)).status).toBe('invalid');
});
