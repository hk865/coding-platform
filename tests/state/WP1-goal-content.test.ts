/**
 * Wiring 1 W12 (spec §5.2 rows GC01, GC02, CG01–CG05): the pure Goal-record
 * content/digest of `src/contracts/graph-context.ts` §2.1 and the pure binding
 * guard `contextGoalContentProblem` of
 * `src/core/work-graph/state/context-input.ts` §2.2.
 *
 * One `it` per row. These functions are pure: no store, no Kernel, no clock and
 * no model. GC01/GC02 reach `goalContextContentV1`/`goalContextDigestV1`; the CG
 * rows build their own literal binding with one Goal `record` source (the row's
 * `p`/`g` ids and the exact `context_goal_changed:` reason).
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ContextAssemblyBindingV1, ContextSourceV1 } from '../../src/contracts/graph-context.js';
import { goalContextContentV1, goalContextDigestV1 } from '../../src/contracts/graph-context.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { contextGoalContentProblem } from '../../src/core/work-graph/state/context-input.js';

const PROJECT = 'p';
const GOAL = 'g';
const WORKSPACE = 'w';
const OBJECTIVE = 'Ship A\n第二行';

/** The GC01/GC02 Goal literal. `revision`/`activePlanRevision`/`desiredState` are not shown content. */
function goal(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    ref: { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL },
    workspaceRef: { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE },
    objective: OBJECTIVE,
    desiredState: 'active',
    desiredStateRevision: 1,
    desiredStateRequestedBy: null,
    activePlanRevision: null,
    revision: 1,
    since: 'c0000000001' as GoalSnapshot['since'],
    ...overrides,
  };
}

const CLAIM_GOAL = { projectId: PROJECT, goalId: GOAL };
const CURRENT_DIGEST = sha256Hex('current Goal content');
const OTHER_DIGEST = sha256Hex('other Goal content');

const GOAL_CHANGED = {
  status: 'rejected',
  code: 'revision_conflict',
  reason: 'context_goal_changed: the Goal content shown by the prepared context changed after preparation; prepare the context again',
} as const;

function goalRecord(digest: string | null, goalId = GOAL, revision = 1): ContextSourceV1 {
  return { kind: 'record', ref: { aggregateType: 'Goal', projectId: PROJECT, goalId }, revision, digest };
}

/** Only `sources` is read by the pure guard; the rest is a well-formed literal binding. */
function bindingWith(sources: ContextSourceV1[]): ContextAssemblyBindingV1 {
  return {
    schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor',
    sectionOrder: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs'],
    residentBudgetBytes: 4096, residentBytes: 0, totalBytes: 0,
    sections: [], sources, inputSelections: [],
    extensions: { notes: 'not_implemented', anomalies: 'not_implemented', footprint: 'not_implemented',
      goalSettings: 'not_implemented', decisions: 'not_implemented' },
  };
}

describe('wiring 1 Goal content', () => {
  it('GC01 goalContextContentV1 projects exactly the shown Goal-record content and its digest', () => {
    const input = goal();
    expect(goalContextContentV1(input)).toEqual({
      contentVersion: 1, goalId: 'g', objective: 'Ship A\n第二行', workspaceId: 'w',
    });
    const content = { contentVersion: 1, goalId: 'g', objective: 'Ship A\n第二行', workspaceId: 'w' };
    const digest = goalContextDigestV1(input);
    expect(digest).toBe(sha256Hex(canonicalJson(content as unknown as JsonValue)));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GC02 the digest ignores revision/activePlanRevision/desiredState and changes with objective', () => {
    const base = goal();
    const otherMetadata = goal({
      revision: 9,
      activePlanRevision: { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'p2' },
      desiredState: 'paused',
    });
    const otherObjective = goal({ objective: 'Ship B\n第二行' });
    expect(goalContextDigestV1(otherMetadata)).toBe(goalContextDigestV1(base));
    expect(goalContextDigestV1(otherObjective)).not.toBe(goalContextDigestV1(base));
  });

  it('CG01 an equal Goal record digest passes', () => {
    const binding = bindingWith([goalRecord(CURRENT_DIGEST)]);
    expect(contextGoalContentProblem({
      binding, claimGoal: CLAIM_GOAL, currentGoalDigest: CURRENT_DIGEST, rebinding: false,
    })).toBeNull();
  });

  it('CG02 a different Goal record digest is the exact context_goal_changed refusal', () => {
    const binding = bindingWith([goalRecord(OTHER_DIGEST)]);
    expect(contextGoalContentProblem({
      binding, claimGoal: CLAIM_GOAL, currentGoalDigest: CURRENT_DIGEST, rebinding: false,
    })).toEqual(GOAL_CHANGED);
  });

  it('CG03 a rebinding skips the Goal-content check', () => {
    const binding = bindingWith([goalRecord(OTHER_DIGEST)]);
    expect(contextGoalContentProblem({
      binding, claimGoal: CLAIM_GOAL, currentGoalDigest: CURRENT_DIGEST, rebinding: true,
    })).toBeNull();
  });

  it('CG04 another Goal source passes', () => {
    expect(contextGoalContentProblem({
      binding: bindingWith([goalRecord(OTHER_DIGEST, 'other')]),
      claimGoal: CLAIM_GOAL, currentGoalDigest: CURRENT_DIGEST, rebinding: false,
    })).toBeNull();
  });

  it('CG05 one matching and one different Goal source rejects', () => {
    const binding = bindingWith([goalRecord(CURRENT_DIGEST, GOAL, 1), goalRecord(OTHER_DIGEST, GOAL, 2)]);
    expect(contextGoalContentProblem({
      binding, claimGoal: CLAIM_GOAL, currentGoalDigest: CURRENT_DIGEST, rebinding: false,
    })).toEqual(GOAL_CHANGED);
  });
});
