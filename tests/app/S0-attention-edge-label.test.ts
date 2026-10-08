/**
 * Slice 0, part 1: the dependency condition must be written into the attention
 * edge string as `kind:label`, not as the JS object coercion `[object Object]`.
 *
 * The cases run the REAL `createAttentionScanner(...).scan(...)` over fakes that
 * only supply the fields `scan` reads, and inspect the resulting graph stamp and
 * `graphChangedElements` directly. They deliberately do not go through
 * `createAttentionObserver`/`observe`; they check the produced graph stamp.
 *
 * Part 1 ships the failing tests only; part 2 changes the one expression in
 * `src/app/attention-observer.ts` that builds the `depends:` edge.
 */
import { describe, expect, it } from 'vitest';
import {
  createAttentionScanner,
  graphChangedElements,
} from '../../src/app/attention-observer.js';
import type { DependencyRequirement } from '../../src/contracts/plan.js';
import { attentionConfig } from '../helpers/orchestration-fixture.js';

/** The minimal `queryTaskGraph` value that `scan` reads; cast by the caller. */
function taskGraph(requires: DependencyRequirement) {
  return {
    plan: {
      ref: { planId: 'p1' },
      executionDag: { dependsOn: [{ taskId: 't2', dependsOnId: 't1', requires }] },
      taskHierarchy: { parentOf: [] },
    },
    tasks: [
      { ref: { taskId: 't1' }, effectivePhase: 'satisfied', relations: [] },
      { ref: { taskId: 't2' }, effectivePhase: 'ready', relations: [] },
    ],
  };
}

/**
 * Run the real scanner once with the given dependency requirement. Only the
 * seam methods below are consumed by `scan`; the rest of each port is asserted
 * into place with `as never` so the test names exactly what it fakes.
 */
function scan(requires: DependencyRequirement) {
  const deps = {
    workspace: {
      readWorkspace: () => { throw new Error('unexpected readWorkspace'); },
    },
    messages: {
      readInbox: () => { throw new Error('unexpected readInbox'); },
    },
    architecture: {
      readArchitectureRevision: async () => ({ status: 'not_found' }),
    },
    plans: {
      queryTaskGraph: async () => ({ status: 'ready', value: taskGraph(requires) }),
    },
  } as never;
  const scope = {
    scope: { projectId: 'p', workspaceId: 'w' },
    paths: [],
    maxBytes: 1024,
    goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' },
    targetSession: null,
    config: attentionConfig(),
  } as never;
  return createAttentionScanner(deps).scan({} as never, scope);
}

describe('S0 attention edge label', () => {
  it('S0-01 writes the requirement kind and label into the depends edge, not [object Object]', async () => {
    const snapshot = await scan({ kind: 'artifact', label: 'schema.json' });
    expect(snapshot.graph?.edges).toEqual(['depends:t1->t2:artifact:schema.json']);
    expect(snapshot.graph?.revision).toBe('plan:p1');
    expect(snapshot.graphUnreadable).toBe(false);
    expect(snapshot.graph?.edges.some(edge => edge.includes('[object Object]'))).toBe(false);
  });

  it('S0-02 reports both changed edges when only the requirement label changes', async () => {
    const first = await scan({ kind: 'artifact', label: 'schema.json' });
    const second = await scan({ kind: 'artifact', label: 'schema-v2.json' });
    expect(graphChangedElements(first.graph, second.graph)).toEqual({
      changedElements: 2,
      nodes: 0,
      edges: 2,
      statuses: 0,
    });
  });

  it('S0-03 reports both changed edges when only the requirement kind changes', async () => {
    const first = await scan({ kind: 'artifact', label: 'schema.json' });
    const second = await scan({ kind: 'decision', label: 'schema.json' });
    expect(graphChangedElements(first.graph, second.graph)).toEqual({
      changedElements: 2,
      nodes: 0,
      edges: 2,
      statuses: 0,
    });
  });
});
