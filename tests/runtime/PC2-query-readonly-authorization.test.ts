/**
 * PC-2 ruling 16 (Query half): the whole-workspace read gate is a real Host
 * authorization fact at preparation and at start. A Host that enables the
 * read-only command but denies `allowsRead('.')` freezes no such tool; a policy
 * that changes between preparation and start is the prepared-list `forbidden`.
 *
 * The state comes from RL's public Query submit/claim/prepare/start steps; every
 * expected list, code and reason is a hand-written literal.
 */
import { describe, expect, it } from 'vitest';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import {
  createRLQueryFixture, rlQueryHostCtx, type RLQueryFixture,
} from '../helpers/RL-query-fixture.js';

const SCOPE = { projectId: 'rl-query-project', workspaceId: 'rl-query-workspace' };
const PROJECT_REF = { aggregateType: 'Project' as const, projectId: SCOPE.projectId };
const WORKSPACE_REF = { aggregateType: 'Workspace' as const, ...SCOPE };
const GOAL_REF = { aggregateType: 'Goal' as const, projectId: SCOPE.projectId, goalId: 'rl-query-goal' };
const JOB_REF: QueryJobRef = { aggregateType: 'QueryJob', ...SCOPE, queryJobId: 'rl-query-job' };
const RUN_REF: QueryRunRef = { aggregateType: 'QueryRun', ...SCOPE, queryJobId: 'rl-query-job', runId: 'rl-query-run' };
const ROLE = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const ROLE_BINDING = { schemaVersion: 1 as const, bindingId: 'rl-query-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const BUDGET: RuntimeBudget = { contextWindowTokens: 200_000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30_000, perResponseTokens: 512 };

function intent(): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: JOB_REF.queryJobId, ...SCOPE, goalId: GOAL_REF.goalId,
    question: 'PC2 read the workspace', focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
    multiTurn: { maxRounds: 1 }, correlationId: 'pc2-q01',
    execution: { kind: 'initial_coordination', roleBinding: ROLE_BINDING, runtimeBudget: BUDGET },
  };
}

/** RL's public Query chain, stopped after preparation. */
async function prepareQuery(fixture: RLQueryFixture) {
  const ctx = rlQueryHostCtx();
  const platform = fixture.platform;
  const submitted = await platform.queries.submitQueryJob(ctx, {
    input: { queryJobId: JOB_REF.queryJobId, runId: RUN_REF.runId, intent: intent() },
    meta: { requestId: 'pc2-q01-submit', expected: [
      { ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 },
      { ref: GOAL_REF, revision: 1 }, { ref: JOB_REF, revision: 0 }, { ref: RUN_REF, revision: 0 },
    ] },
  });
  if (submitted.status !== 'committed') throw new Error(`PC2 submit: ${JSON.stringify(submitted)}`);
  const created = await platform.runtime.createSession(ctx, { workspace: SCOPE, role: ROLE,
    recommendedRefs: [], initialLinks: [], meta: { requestId: 'pc2-q01-session', expected: [] } });
  if (created.status !== 'completed') throw new Error(`PC2 Session: ${JSON.stringify(created)}`);
  const claimed = await platform.queries.claimQuery(ctx, {
    input: { queryRunRef: RUN_REF, sessionRef: created.value.ref },
    meta: { requestId: 'pc2-q01-claim', expected: [
      { ref: JOB_REF, revision: 1 }, { ref: RUN_REF, revision: 1 },
      { ref: created.value.ref, revision: created.value.revision },
    ] },
  });
  if (claimed.status !== 'committed') throw new Error(`PC2 claim: ${JSON.stringify(claimed)}`);
  const prepared = await platform.runtime.prepareQuery(ctx, {
    queryRunRef: RUN_REF, requestId: 'pc2-q01-prepare',
  });
  if (prepared.status !== 'ready') throw new Error(`PC2 prepare: ${JSON.stringify(prepared)}`);
  const opened = await platform.materials.openArtifact(ctx, {
    ref: prepared.value.bundleRef, usage: 'historical_explanation',
  });
  if (opened.status !== 'ready') throw new Error(`PC2 open manifest: ${JSON.stringify(opened)}`);
  const manifest = JSON.parse(opened.value.body) as PreparedQueryManifestV1;
  return { ctx, prepared: prepared.value, manifest };
}

describe('PC2 ruling 16: the Query read-only command reads the real authorization', () => {
  it('a denied whole-workspace read freezes no read-only command and the start registers none', async () => {
    const fixture = await createRLQueryFixture({
      replies: [{ kind: 'text', text: 'PC2 denied read answer' }],
      tools: ['run_readonly_command'], readonlyCommandAccess: true, allowWholeWorkspace: false,
    });
    try {
      const { ctx, prepared, manifest } = await prepareQuery(fixture);
      expect(manifest.promptSet.toolNames).toEqual([]);
      const started = await fixture.platform.runtime.startQuery(ctx, {
        prepared, consumerId: 'pc2-q01', requestId: 'pc2-q01-start',
      });
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(fixture.scripted.requests[0]?.tools ?? []).toEqual([]);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('a read policy that moves after preparation is the frozen-list forbidden at start', async () => {
    const fixture = await createRLQueryFixture({
      replies: [{ kind: 'text', text: 'PC2 moved read policy answer' }],
      tools: ['run_readonly_command'], readonlyCommandAccess: true, allowWholeWorkspace: true,
    });
    try {
      const { ctx, prepared, manifest } = await prepareQuery(fixture);
      expect(manifest.promptSet.toolNames).toEqual(['run_readonly_command']);
      fixture.state.allowWholeWorkspace = false;
      const started = await fixture.platform.runtime.startQuery(ctx, {
        prepared, consumerId: 'pc2-q01', requestId: 'pc2-q01-start',
      });
      expect(started).toEqual({
        status: 'rejected', code: 'forbidden',
        reason: 'the prepared tool list no longer fits this Run',
      });
      expect(fixture.scripted.calls(), 'no provider call').toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
