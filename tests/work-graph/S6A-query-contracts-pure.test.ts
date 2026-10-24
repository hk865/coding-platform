/**
 * The request-contract surface the other 6A-2 groups code against: which rounds
 * are request rounds, the one binding read, and the stored manifest's goal and
 * request facts. A5: pure input → output, every expected value a literal.
 */
import { describe, expect, it } from 'vitest';
import type { QueryJobSnapshot, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { isRequestRound, queryExecutionBindingOf } from '../../src/contracts/query-job.js';
import { queryManifestProblem } from '../../src/core/work-graph/queries/query-record-codecs.js';

const PLAIN_RUNTIME = {
  contextWindowTokens: 128000, inputTokens: 11, outputTokens: 7, maxRequests: 2,
  maxToolCalls: 3, timeoutMs: 4000, perResponseTokens: 4096,
};
const PLAIN_BUDGET = { maxTokens: 4096, deadline: '2026-10-25T09:00:00.000Z' };
const PLAIN_BINDING = {
  schemaVersion: 1 as const, bindingId: 'plain-binding', templateId: 'tpl-plain',
  templateRevision: 'r1', bindingVersion: 1, policyRevision: 'pol-plain',
};
const REQUEST_RUNTIME = {
  contextWindowTokens: 256000, inputTokens: 21, outputTokens: 13, maxRequests: 5,
  maxToolCalls: 9, timeoutMs: 9000, perResponseTokens: 8192,
};
const REQUEST_BUDGET = { maxTokens: 8192, deadline: '2026-10-26T10:00:00.000Z' };
const REQUEST_BINDING = {
  schemaVersion: 1 as const, bindingId: 'request-binding', templateId: 'tpl-request',
  templateRevision: 'r2', bindingVersion: 2, policyRevision: 'pol-request',
};

function job(roundKind: 'request' | null): QueryJobSnapshot {
  return {
    ref: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
    revision: 1,
    schemaVersion: 1,
    job: {
      roundKind,
      intent: {
        execution: { roleBinding: PLAIN_BINDING, runtimeBudget: PLAIN_RUNTIME },
        budget: PLAIN_BUDGET,
      },
    },
  } as unknown as QueryJobSnapshot;
}

type RequestProfile = {
  profileId: string;
  runtimeBudget: typeof REQUEST_RUNTIME;
  budget: typeof REQUEST_BUDGET;
  consumerId: string;
} | null;

function requestRun(profile: RequestProfile): QueryRunSnapshot {
  return {
    ref: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' },
    revision: 2,
    schemaVersion: 1,
    run: {
      schemaVersion: 1,
      queryJobRef: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
      runId: 'qr-1',
      status: 'pending',
      startedAt: null,
      endedAt: null,
      outcome: null,
      executionState: {
        schemaVersion: 1,
        phase: 'claimed',
        sessionRef: { projectId: 'p1', sessionId: 's1' },
        sessionGeneration: 1,
        role: { kind: 'legacy_template', templateId: 'tpl-request', templateRevision: 'r2' },
        roleBinding: REQUEST_BINDING,
        roleResolution: { status: 'absent', roleId: 'role-1', reason: 'no role spec' },
        priorHistoryCursor: null,
        prepared: null,
        entry: null,
        history: null,
        requests: [],
        requestProfile: profile,
      },
    },
  };
}

describe('isRequestRound', () => {
  it('is false for a plain Query and true for every request round kind', () => {
    expect(isRequestRound(job(null))).toBe(false);
    expect(isRequestRound(job('request'))).toBe(true);
  });
});

describe('queryExecutionBindingOf', () => {
  it('reads a plain Query exactly from its intent', () => {
    const plainRun = { run: {} } as unknown as QueryRunSnapshot;
    expect(queryExecutionBindingOf(job(null), plainRun)).toEqual({
      roleBinding: PLAIN_BINDING,
      runtimeBudget: PLAIN_RUNTIME,
      budget: PLAIN_BUDGET,
    });
  });

  it("reads a request round from the attempt's profile, never the intent", () => {
    const profile = {
      profileId: 'prof-1', runtimeBudget: REQUEST_RUNTIME, budget: REQUEST_BUDGET, consumerId: 'consumer-1',
    };
    expect(queryExecutionBindingOf(job('request'), requestRun(profile))).toEqual({
      roleBinding: REQUEST_BINDING,
      runtimeBudget: REQUEST_RUNTIME,
      budget: REQUEST_BUDGET,
    });
  });

  it('throws when a request round has no requestProfile instead of using the intent', () => {
    expect(() => queryExecutionBindingOf(job('request'), requestRun(null))).toThrow(/requestProfile/);
  });
});

const MATERIAL = {
  ref: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
  revision: 3,
  runRef: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' },
  runRevision: 2,
  since: 'c0000000007',
  text: 'do the thing',
  selectedIdea: null,
  relatedCards: [],
};
const REQUEST_FACTS = {
  requestRoot: MATERIAL.ref,
  round: MATERIAL,
  batch: [],
  preparationCursor: 'c0000000008',
  effectiveGoalId: null,
  executionKind: 'semantic_query',
};

describe('queryManifestProblem', () => {
  it('accepts a plain Query manifest with a goal and no request facts, through JSON', () => {
    const plain = {
      schemaVersion: 1,
      kind: 'query_execution',
      contextAssembly: { callKind: 'query-copy' },
      goal: { ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' }, revision: 2 },
      request: null,
    };
    expect(queryManifestProblem(JSON.parse(JSON.stringify(plain)))).toBeNull();
  });

  it('accepts a request round with no goal and its frozen request facts, through JSON', () => {
    const secretary = {
      schemaVersion: 1,
      kind: 'query_execution',
      contextAssembly: { callKind: 'secretary' },
      goal: null,
      request: REQUEST_FACTS,
    };
    expect(queryManifestProblem(JSON.parse(JSON.stringify(secretary)))).toBeNull();
  });

  it('accepts a request round with a goal when the facts name the same goal', () => {
    expect(queryManifestProblem({
      contextAssembly: { callKind: 'secretary' },
      goal: { ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' }, revision: 2 },
      request: { ...REQUEST_FACTS, effectiveGoalId: 'g1' },
    })).toBeNull();
  });
});

describe('rejects: a manifest whose goal and request facts disagree', () => {
  it('a null goal outside a secretary round', () => {
    expect(queryManifestProblem({
      contextAssembly: { callKind: 'query-copy' },
      goal: null,
      request: null,
    })).not.toBeNull();
  });

  it('a secretary round without request facts', () => {
    expect(queryManifestProblem({
      contextAssembly: { callKind: 'secretary' },
      goal: null,
      request: null,
    })).not.toBeNull();
  });

  it('request facts on a non-secretary Query', () => {
    expect(queryManifestProblem({
      contextAssembly: { callKind: 'query-copy' },
      goal: { ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' }, revision: 2 },
      request: { ...REQUEST_FACTS, effectiveGoalId: 'g1' },
    })).not.toBeNull();
  });

  it('a round material whose since is not a commit cursor', () => {
    expect(queryManifestProblem({
      contextAssembly: { callKind: 'secretary' },
      goal: null,
      request: { ...REQUEST_FACTS, round: { ...MATERIAL, since: 'not-a-cursor' } },
    })).not.toBeNull();
  });

  it('a batch round without its run reference', () => {
    expect(queryManifestProblem({
      contextAssembly: { callKind: 'secretary' },
      goal: null,
      request: { ...REQUEST_FACTS, batch: [{ ...MATERIAL, runRef: undefined }] },
    })).not.toBeNull();
  });

  it('a no-goal request that freezes an effective goal', () => {
    expect(queryManifestProblem({
      contextAssembly: { callKind: 'secretary' },
      goal: null,
      request: { ...REQUEST_FACTS, effectiveGoalId: 'g1' },
    })).not.toBeNull();
  });
});
