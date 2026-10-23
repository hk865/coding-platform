/**
 * PC-2 ruling 18, PC-19 (preparation half): a used template's declared tools
 * must be in the frozen final list, the initial guide renders with that list,
 * and an empty required slot is the preparation's own invalid. The packs are
 * real chains resolved by A's resolver; every preparation runs through a frozen
 * fixture's public steps and every reason is a hand-written literal.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { openPCWorkFixture, openPCQueryFixture } from '../helpers/PC-platform-fixture.js';
import {
  openPC2ReviewFixture, pc2PackEntry, pc2ResolvedSource,
} from '../helpers/PC2-pack-fixture.js';
import { rlQueryHostCtx } from '../helpers/RL-query-fixture.js';

// The frozen PC2 review fixture starts a real blocked Run: §5.1's stand-in
// `shell` must be armed so the Run is held at its call.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

async function queryManifest(
  fixture: Awaited<ReturnType<typeof openPCQueryFixture>>,
  prepared: PreparedQueryExecution,
): Promise<PreparedQueryManifestV1> {
  const opened = await fixture.base.platform.materials.openArtifact(rlQueryHostCtx(), {
    ref: prepared.bundleRef, usage: 'historical_explanation',
  });
  if (opened.status !== 'ready') throw new Error(`PC-19 open manifest: ${JSON.stringify(opened)}`);
  return JSON.parse(opened.value.body) as PreparedQueryManifestV1;
}

const QUERY_BUDGET: RuntimeBudget = { contextWindowTokens: 200_000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30_000, perResponseTokens: 512 };

/**
 * One real semantic QueryRun on the fixture's completed Session, submitted and
 * claimed through the public Query owners, then prepared. The expected pins use
 * the fixture's own project/workspace/Goal/Session revisions.
 */
async function prepareSemanticQuery(
  fixture: Awaited<ReturnType<typeof openPCWorkFixture>>,
): Promise<PreparedQueryManifestV1> {
  const { base, runtime } = fixture;
  const platform = base.platform;
  const ctx = base.ctx;
  await fixture.work.prepare();
  const work = await fixture.work.start();
  if (work.status !== 'ready') throw new Error(`PC-19 Work start: ${JSON.stringify(work)}`);
  const goal = await platform.plans.queryGoal(ctx, base.goalRef);
  const workspace = await platform.projects.readWorkspaceRegistration(ctx, base.scope);
  const session = await platform.sessions.readSession(ctx, base.sessionRef);
  if (goal.status !== 'ready' || workspace.status !== 'ready' || session.status !== 'ready') {
    throw new Error('PC-19 the Query pins could not be read');
  }
  const queryJobRef: QueryJobRef = {
    aggregateType: 'QueryJob', ...base.scope, queryJobId: 'pc2-q03-job',
  };
  const queryRunRef: QueryRunRef = {
    aggregateType: 'QueryRun', ...base.scope, queryJobId: queryJobRef.queryJobId, runId: 'pc2-q03-run',
  };
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, ...base.scope, goalId: base.goalRef.goalId,
    question: 'PC2 semantic question', focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
    multiTurn: { maxRounds: 1 }, correlationId: 'pc2-q03',
    execution: { kind: 'semantic_query', roleBinding: base.roleBinding, runtimeBudget: QUERY_BUDGET },
  };
  const submitted = await platform.queries.submitQueryJob(ctx, {
    input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
    meta: { requestId: 'pc2-q03-submit', expected: [
      { ref: base.fixture.projectRef, revision: 1 },
      { ref: base.fixture.workspaceRef, revision: workspace.value.workspace.revision },
      { ref: base.goalRef, revision: goal.value.goal.revision },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
    ] },
  });
  if (submitted.status !== 'committed') throw new Error(`PC-19 Query submit: ${JSON.stringify(submitted)}`);
  const claimed = await platform.queries.claimQuery(ctx, {
    input: { queryRunRef, sessionRef: base.sessionRef },
    meta: { requestId: 'pc2-q03-claim', expected: [
      { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: session.value.record.ref, revision: session.value.record.revision },
    ] },
  });
  if (claimed.status !== 'committed') throw new Error(`PC-19 Query claim: ${JSON.stringify(claimed)}`);
  if (runtime.prepareQuery === undefined) throw new Error('PC-19 the Runtime has no prepareQuery');
  const prepared = await runtime.prepareQuery(ctx, { queryRunRef, requestId: 'pc2-q03-prepare' });
  if (prepared.status !== 'ready') throw new Error(`PC-19 Query prepare: ${JSON.stringify(prepared)}`);
  const opened = await platform.materials.openArtifact(ctx, {
    ref: prepared.value.bundleRef, usage: 'historical_explanation',
  });
  if (opened.status !== 'ready') throw new Error(`PC-19 Query manifest: ${JSON.stringify(opened)}`);
  return JSON.parse(opened.value.body) as PreparedQueryManifestV1;
}

describe('PC-19 the declaration check at preparation', () => {
  it('PC-19 a base declaring check outside every block is invalid, naming base and check', async () => {
    const pack = pc2PackEntry('pc2-mentions', {
      templates: { base: { text: 'PC2 BASE\n- Use check for receipts.\n', mentionsTools: ['check'] } },
    });
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCWorkFixture({
      promptPacks: source, selection: { promptPack: pack.packId },
    });
    try {
      const prepared = await fixture.runtime.prepareExecution(fixture.base.ctx, {
        runRef: fixture.work.runRef, requestId: 'pc2-mentions-prepare',
      });
      expect(prepared).toMatchObject({ status: 'rejected', code: 'invalid' });
      if (prepared.status !== 'rejected') throw new Error('PC-19 expected a rejection');
      expect(prepared.reason).toContain('base');
      expect(prepared.reason).toContain('check');
    } finally {
      await fixture.close();
    }
  });

  it('PC-19 required-slot-empty: the empty review pack is invalid, naming pack, template and slot', async () => {
    const fixture = await openPC2ReviewFixture('empty');
    try {
      // No start: the preparation itself is the rejected result.
      expect(fixture.preparation).toEqual({
        status: 'rejected', code: 'invalid',
        reason: 'the prompt pack pc2-review-empty template "unknown-call-review" slot "writtenLines": '
          + 'required slot "writtenLines" is empty in template "unknown-call-review"',
      });
      expect(fixture.manifest).toBeNull();
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('PC-19 a semantic Query never reads the initial guide, so its check declaration stays unused', async () => {
    const pack = pc2PackEntry('pc2-q03-semantic', {
      templates: {
        'initial-planning-answer': { text: 'PC2 SEMANTIC GUIDE', mentionsTools: ['check'] },
      },
    });
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCWorkFixture({
      promptPacks: source, selection: { promptPack: pack.packId },
    });
    try {
      // The semantic preparation is ready; reading the guide would mark it used
      // and its `check` declaration would reject it.
      const manifest = await prepareSemanticQuery(fixture);
      expect(manifest.promptSet.templates.map(template => template.id))
        .not.toContain('initial-planning-answer');
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('PC-19 an initial Query renders the guide tool blocks with the frozen tool list', async () => {
    // The full expected input of each arm, hand-written from the frozen RL Query
    // fixture and this pack's guide template: prelude, role, goal, question.
    const expectedWithRead = '# Verified read-only Query input\n\n'
      + 'This is the current bounded Query context assembled from formal platform facts; it is not a transcript.\n\n'
      + '## Runtime context\n'
      + '## Runtime binding\n'
      + 'roleBinding: {"policyRevision":"rl-query-host@1","tools":["read"],"writeScope":[]}\n'
      + 'tools: read\n'
      + 'writeScope: (none)\n\n'
      + '## Role specification\n'
      + 'role: advisor (absent)\n'
      + 'the project has no active coordination policy, so there is no role matrix\n'
      + 'label: Executor\n'
      + 'purpose: Execute the assigned task.\n'
      + 'responsibility: execution\n\n'
      + 'duty: executor\n\n'
      + 'contextResidentBytes: 4096\n\n'
      + '## Goal\n'
      + 'goal: rl-query-goal\n'
      + 'objective: Answer one RL reading question\n'
      + 'workspace: rl-query-workspace@1\n'
      + 'autonomy: after_plan_confirmation\n'
      + 'current understanding: 目标 rl-query-goal：还没有当前理解\n'
      + '## Question\n'
      + 'Read the workspace and answer\n\n'
      + 'PC2 GUIDE\nREAD-LINE\nEND';
    const expectedWithoutRead = '# Verified read-only Query input\n\n'
      + 'This is the current bounded Query context assembled from formal platform facts; it is not a transcript.\n\n'
      + '## Runtime context\n'
      + '## Runtime binding\n'
      + 'roleBinding: {"policyRevision":"rl-query-host@1","tools":[],"writeScope":[]}\n'
      + 'tools: (none)\n'
      + 'writeScope: (none)\n\n'
      + '## Role specification\n'
      + 'role: advisor (absent)\n'
      + 'the project has no active coordination policy, so there is no role matrix\n'
      + 'label: Executor\n'
      + 'purpose: Execute the assigned task.\n'
      + 'responsibility: execution\n\n'
      + 'duty: executor\n\n'
      + 'contextResidentBytes: 4096\n\n'
      + '## Goal\n'
      + 'goal: rl-query-goal\n'
      + 'objective: Answer one RL reading question\n'
      + 'workspace: rl-query-workspace@1\n'
      + 'autonomy: after_plan_confirmation\n'
      + 'current understanding: 目标 rl-query-goal：还没有当前理解\n'
      + '## Question\n'
      + 'Read the workspace and answer\n\n'
      + 'PC2 GUIDE\nEND';
    const pack = pc2PackEntry('pc2-q03-initial', {
      templates: {
        'initial-planning-answer': {
          text: 'PC2 GUIDE\n{{#tool:read}}\nREAD-LINE\n{{/tool:read}}\nEND', mentionsTools: [],
        },
      },
    });
    const source = await pc2ResolvedSource([pack]);
    const withRead = await openPCQueryFixture({
      promptPacks: source, selection: { promptPack: pack.packId }, tools: ['read'],
    });
    try {
      const prepared = await withRead.prepare();
      const manifest = await queryManifest(withRead, prepared);
      expect(manifest.input).toBe(expectedWithRead);
    } finally {
      await withRead.close();
    }

    const withoutRead = await openPCQueryFixture({
      promptPacks: source, selection: { promptPack: pack.packId }, tools: [],
    });
    try {
      const prepared = await withoutRead.prepare();
      const manifest = await queryManifest(withoutRead, prepared);
      expect(manifest.input).toBe(expectedWithoutRead);
    } finally {
      await withoutRead.close();
    }
  }, 60_000);
});
