/**
 * Slice 0, part 1: the dependency condition must be written into the attention
 * edge string as `kind:label`, not as the JS object coercion `[object Object]`.
 *
 * TQ-001: the cases run the REAL `createAttentionScanner(...).scan(...)` with
 * the REAL `graph-context-reader` reached through
 * `platform.runtime.readAttentionGraph`. A real adopted architecture and a real
 * adopted Plan (plan id `p1`) are built through the public owners on both memory
 * and SQLite storage; the two compared scans differ ONLY in the dependency
 * `requires.kind`/`requires.label`. The revision literal is hand-computed from
 * the fixed baseline content below.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAttentionScanner,
  graphChangedElements,
  type AttentionSnapshot,
} from '../../src/app/attention-observer.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DependencyRequirement, PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { attentionConfig } from '../helpers/orchestration-fixture.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';

const P = 'p';
const W = 'w';
const G = 'g';
const PLAN_ID = 'p1';
const SCOPE = { projectId: P, workspaceId: W };
const PROJECT_REF = { aggregateType: 'Project' as const, projectId: P };
const WORKSPACE_REF = { aggregateType: 'Workspace' as const, projectId: P, workspaceId: W };
const POLICY_REF = { aggregateType: 'CompletionPolicyRevision' as const, projectId: P, policyId: 's0-policy', revision: 1 };
const POLICY_ACTIVE_REF = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: P };
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: G };

/**
 * The fixed baseline content. Its digest is
 * `sha256(canonicalJson({schemaVersion:1,identity:{baselineId},revision:1,content}))`
 * over the literal below, computed independently of the program:
 * {"content":{"constraints":[],"description":"S0 attention edge label baseline","schemaVersion":1},
 *  "identity":{"baselineId":"s0-baseline"},"revision":1,"schemaVersion":1}
 */
const BASELINE_ID = 's0-baseline';
const BASELINE_DESCRIPTION = 'S0 attention edge label baseline';
const BASELINE_DIGEST = '2b4d600c1f196199958385000a2560fe555f11faf8d3abd2f4415490fa04670c';
const REVISION = `plan:${PLAN_ID}|arch:${BASELINE_DIGEST}`;

const HOST_CTX: CoreCallContext = {
  projectId: P, workspaceId: W,
  principal: { kind: 'host', actor: { kind: 'human', id: 's0-operator' } },
  materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: { kind: 'human', id: 's0-operator' } },
  signal: new AbortController().signal,
};

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const openPlatforms: Platform[] = [];

afterEach(async () => {
  for (const platform of openPlatforms.splice(0).reverse()) await platform.close().catch(() => undefined);
  await cleanupRestart();
});

async function openPlatform(kind: 'memory' | 'sqlite'): Promise<Platform> {
  const directory = kind === 'sqlite' ? await tempDir('s0-attention-') : undefined;
  const platform = await createTargetPlatform({
    storage: directory === undefined ? { kind: 'memory' } : { kind: 'sqlite', directory },
    workspace: {
      async resolveRoot() {
        return { status: 'rejected', code: 'not_found', reason: 'the S0 attention fixture has no workspace IO' };
      },
      async authorize() {
        return { status: 'rejected', code: 'forbidden', reason: 'the S0 attention fixture has no workspace IO' };
      },
    },
    // A real Runtime publishes `readAttentionGraph`; this fixture never starts a Run.
    runtime: {
      async resolveConfiguration() {
        return { status: 'rejected', code: 'unsupported', reason: 'the S0 attention fixture never executes a Run' };
      },
    },
    now: () => '2026-10-19T00:00:00.000Z',
  });
  openPlatforms.push(platform);
  return platform;
}

/** The real §5.1 preconditions: Project, Workspace, governance, architecture, Goal. */
async function seedGraph(platform: Platform): Promise<void> {
  const project = await platform.projects.createProject(HOST_CTX, {
    input: { projectId: P },
    meta: { requestId: 's0-project', expected: [{ ref: PROJECT_REF, revision: 0 }] },
  });
  if (project.status !== 'committed') throw new Error(`S0 project create failed: ${JSON.stringify(project)}`);

  const workspace = await platform.projects.registerWorkspace(HOST_CTX, {
    input: { workspace: SCOPE },
    meta: { requestId: 's0-workspace', expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 0 }] },
  });
  if (workspace.status !== 'committed') throw new Error(`S0 workspace register failed: ${JSON.stringify(workspace)}`);

  const installed = await platform.completionPolicies.installCompletionPolicy(HOST_CTX, {
    input: {
      policyId: 's0-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
    },
    meta: { requestId: 's0-policy-install', expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: POLICY_REF, revision: 0 }] },
  });
  if (installed.status !== 'committed') throw new Error(`S0 completion policy install failed: ${JSON.stringify(installed)}`);

  const activated = await platform.completionPolicies.activateCompletionPolicy(HOST_CTX, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 's0-policy-activate', expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: POLICY_ACTIVE_REF, revision: 0 }] },
  });
  if (activated.status !== 'committed') throw new Error(`S0 completion policy activate failed: ${JSON.stringify(activated)}`);

  const adopted = await platform.architecture.adoptInitialArchitecture(HOST_CTX, {
    input: {
      baselineId: BASELINE_ID, description: BASELINE_DESCRIPTION, constraints: [],
      catalog: {
        requireDag: true, dependencies: [],
        modules: [{ ref: { projectId: P, moduleId: 's0-module' }, name: 'S0 module',
          responsibility: 'Own the attention edge label', paths: ['src'], interfaces: [] }],
      },
    },
    meta: { requestId: 's0-architecture', expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }] },
  });
  if (adopted.status !== 'committed') throw new Error(`S0 architecture adoption failed: ${JSON.stringify(adopted)}`);

  const goal = await platform.goals.createGoal(HOST_CTX, {
    input: { goalId: G, workspace: SCOPE, objective: 'S0 attention edge label' },
    meta: { requestId: 's0-goal', expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }] },
  });
  if (goal.status !== 'committed') throw new Error(`S0 Goal creation failed: ${JSON.stringify(goal)}`);
}

/** The Plan draft: identical apart from the one dependency requirement. */
function planDraft(requires: DependencyRequirement, planRevision: number): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: PLAN_ID, planRevision, goalId: G, stages: [],
    tasks: [
      { taskId: 't1', title: 'T1', requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 't2', title: 'T2', requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
    ],
    assignments: [
      { taskId: 't1', role: 'builder', instruction: 'Do T1' },
      { taskId: 't2', role: 'builder', instruction: 'Do T2' },
    ],
    obligations: [{
      obligationId: 's0-obligation', title: 'Deliver the dependency edge', requirementLevel: 'required',
      taskIds: ['t1', 't2'],
      verificationRequirements: [{ requirementId: 's0-check', requirementLevel: 'required', kind: 'static',
        description: 'The registered static check' }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 't2', dependsOnId: 't1', requires }] },
    taskRelations: [],
    inputRequirements: [],
  };
}

/** Put the real Plan with plan id `p1` through the public owners. */
async function seedPlan(platform: Platform, requires: DependencyRequirement): Promise<void> {
  const proposed = await platform.plans.proposePlan(HOST_CTX, {
    input: {
      goalRef: GOAL_REF, basedOn: null, draft: planDraft(requires, 1),
      reason: { text: 'S0 initial plan', sources: [] },
    },
    meta: { requestId: 's0-plan-propose', expected: [] },
  });
  if (proposed.status !== 'committed') throw new Error(`S0 plan proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await platform.plans.applyPlanChange(HOST_CTX, {
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 's0-plan-apply', expected: [] },
  });
  if (applied.status !== 'committed') throw new Error(`S0 plan adoption failed: ${JSON.stringify(applied)}`);
}

function scannerOf(platform: Platform) {
  const readAttentionGraph = platform.runtime.readAttentionGraph;
  if (readAttentionGraph === undefined) throw new Error('the platform runtime must publish readAttentionGraph');
  return createAttentionScanner({
    workspace: platform.workspace,
    messages: platform.messages,
    readAttentionGraph: readAttentionGraph.bind(platform.runtime),
  });
}

function attentionScope() {
  return {
    scope: SCOPE, paths: [], maxBytes: 1024, goalRef: GOAL_REF, targetSession: null,
    config: attentionConfig(),
  };
}

/**
 * One real platform, one real adopted architecture and one real Plan `p1`.
 * A comparison opens TWO such platforms: the Plan id, revision and architecture
 * content are identical, and only the passed dependency requirement differs.
 */
async function scanWith(kind: 'memory' | 'sqlite', requires: DependencyRequirement): Promise<AttentionSnapshot> {
  const platform = await openPlatform(kind);
  await seedGraph(platform);
  await seedPlan(platform, requires);
  return await scannerOf(platform).scan(HOST_CTX, attentionScope());
}

const READS = ['memory', 'sqlite'] as const;

describe.each(READS)('S0 attention edge label (%s)', (kind) => {
  it('S0-01 writes the requirement kind and label into the depends edge, not [object Object]', async () => {
    const snapshot = await scanWith(kind, { kind: 'artifact', label: 'schema.json' });
    expect(snapshot.graph?.edges).toEqual(['depends:t1->t2:artifact:schema.json']);
    expect(snapshot.graph?.revision).toBe(REVISION);
    expect(snapshot.graphUnreadable).toBe(false);
    expect(snapshot.graph?.edges.some(edge => edge.includes('[object Object]'))).toBe(false);
  });

  it('S0-02 reports both changed edges when only the requirement label changes', async () => {
    const first = await scanWith(kind, { kind: 'artifact', label: 'schema.json' });
    const second = await scanWith(kind, { kind: 'artifact', label: 'schema-v2.json' });
    expect(graphChangedElements(first.graph, second.graph)).toEqual({
      changedElements: 2,
      nodes: 0,
      edges: 2,
      statuses: 0,
    });
  });

  it('S0-03 reports both changed edges when only the requirement kind changes', async () => {
    const first = await scanWith(kind, { kind: 'artifact', label: 'schema.json' });
    const second = await scanWith(kind, { kind: 'decision', label: 'schema.json' });
    expect(graphChangedElements(first.graph, second.graph)).toEqual({
      changedElements: 2,
      nodes: 0,
      edges: 2,
      statuses: 0,
    });
  });
});
