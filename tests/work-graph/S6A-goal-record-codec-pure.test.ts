/**
 * The Goal record carries its creation commit cursor.
 * Pure A5 codec test: the creation cursor is either the bound one or the null
 * placeholder the creating commit fills; a record without it, or with the zero
 * cursor no commit makes, is rejected.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { GoalSnapshot, PendingGoalSnapshot } from '../../src/contracts/ledger.js';
import { decodeGoalSnapshot, encodeGoalSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';

const P = 'project-y';
const W = 'workspace-y';
const G = 'goal-y';
const cursor = (value: string): CommitCursor => value as CommitCursor;

function goal(): GoalSnapshot {
  return {
    ref: { aggregateType: 'Goal', projectId: P, goalId: G },
    workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
    objective: 'Y goal record',
    desiredState: 'active',
    desiredStateRevision: 1,
    desiredStateRequestedBy: null,
    activePlanRevision: null,
    revision: 1,
    settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0, waitForGoalRef: null, parallelRisks: [] },
    continuedFrom: null,
    copiedInterventions: [],
    since: cursor('c0000000007'),
  };
}

describe('Goal record current format', () => {
  it('round-trips a Goal with its bound creation cursor', () => {
    const encoded = encodeGoalSnapshot(goal());
    expect(JSON.parse(encoded.json)).toMatchObject({ since: 'c0000000007' });
    expect(decodeGoalSnapshot(encoded)).toEqual({ status: 'decoded', value: goal() });
  });

  it('encodes the pending since placeholder a creator builds, but decode requires the bound cursor', () => {
    const pending: PendingGoalSnapshot = { ...goal(), since: null };
    const encoded = encodeGoalSnapshot(pending);
    expect(JSON.parse(encoded.json)).toMatchObject({ since: null });
    const result = decodeGoalSnapshot(encoded);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('since');
  });

  it('rejects a Goal record without since', () => {
    const { since: _omitted, ...body } = goal();
    const encoded = { ...encodeGoalSnapshot(goal()), json: JSON.stringify(body) };
    const result = decodeGoalSnapshot(encoded);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('since');
  });

  it('rejects a Goal record whose since is the zero cursor c0000000000', () => {
    const result = decodeGoalSnapshot(encodeGoalSnapshot({ ...goal(), since: cursor('c0000000000') }));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('since');
  });
});
