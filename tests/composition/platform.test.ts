import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { InitialPlanningGoalInput } from '../../src/business/workflow/contracts.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { SessionHandoffWorkflowPort } from '../../src/core/work-graph/model/session-handoff-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { seedS6BArchiveSource } from '../helpers/S6B1-fixture.js';
import { s6b2Accept, s6b2Scene, s6b2Workspace } from '../helpers/S6B2-handoff-scene.js';

const at = '2026-09-24T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 'trusted-test-human' };
const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'platform-project', workspaceId: 'workspace-main' };
const context = (): CoreCallContext => ({ projectId: workspace.projectId, workspaceId: workspace.workspaceId,
  principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
  signal: new AbortController().signal });
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'next-platform-'));
  directories.push(dir);
  const root = join(dir, 'workspace');
  await mkdir(root);
  await writeFile(join(root, 'note.txt'), 'The real workspace says hello.\n');
  const calls = { roots: 0, authorizations: 0 };
  const bindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      calls.roots++;
      return requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unregistered workspace' };
    },
    async authorize(ctx, requested) {
      calls.authorizations++;
      const reader = ctx.materialReader;
      return ctx.projectId === workspace.projectId && ctx.workspaceId === workspace.workspaceId &&
        requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId &&
        ctx.principal.kind === 'host' && ctx.principal.actor.id === actor.id &&
        reader.kind === 'host' && reader.projectId === workspace.projectId &&
        reader.workspaceId === workspace.workspaceId && reader.actor.id === actor.id
        ? { status: 'ready', value: { subjectKey: 'trusted-human:' + actor.id,
          permissionRevision: 'host-policy-1', allowsRead: (path: string) => path === 'note.txt' } }
        : { status: 'rejected', code: 'forbidden', reason: 'no matching Host read grant' };
    },
  };
  return { dir, bindings, calls };
}

it.each(['memory', 'sqlite'] as const)('%s: public composition wires Host material and real workspace reads with narrow unsupported gaps', async kind => {
  const f = await fixture();
  const platform = await createTargetPlatform({ storage: kind === 'memory' ? { kind: 'memory' } :
    { kind: 'sqlite', directory: join(f.dir, 'storage') }, workspace: f.bindings, now: () => at });
  let closed = false;
  try {
    expect(Object.keys(platform).sort()).toEqual(['architecture', 'automationPolicy', 'checks', 'claims', 'close', 'completionPolicies', 'controls', 'evidence', 'executions', 'goals', 'kernelStores', 'materials', 'messages', 'plans', 'projects', 'queries', 'reconcile', 'registerAutomationPolicy', 'registerCheckConfiguration', 'registerWorkflowBinding', 'resolveUnknownQueryRun', 'resolveUnknownRun', 'roles', 'runtime', 'sessions', 'unknownCallReviews', 'workflow', 'workspace']);
    const ctx = context();
    const stored = await platform.materials.storeArtifact(ctx, {
      contentType: 'text/plain', body: 'A trusted Host note',
      sources: [{ kind: 'workspace', refId: workspace.workspaceId, revision: '1' }],
      origin: { kind: 'platform_operation', projectId: workspace.projectId,
        workspaceId: workspace.workspaceId, requestId: 'host-note-1', actor },
    });
    expect(stored).toMatchObject({ status: 'stored', replayed: false });
    if (stored.status !== 'stored') throw Error('Host material was not stored');
    expect(await platform.materials.openArtifact(ctx, { ref: stored.ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'ready', value: { body: 'A trusted Host note', applicability: 'historical_explanation' } });
    const captured = await platform.workspace.captureSourceChanges(ctx,
      { workspace, workspaceRevision: 1, provider: 'text' });
    expect(captured).toMatchObject({ status: 'ready', value: { coverage: { provider: 'text', complete: true } } });
    if (captured.status !== 'ready') throw Error('real workspace capture unavailable');
    expect(await platform.workspace.querySource(ctx, { capture: captured.value.ref,
      query: { kind: 'text', text: 'real workspace', caseSensitive: true }, cursor: null, limit: 10 }))
      .toMatchObject({ status: 'ready', value: { items: [ { kind: 'text' } ] } });
    expect(f.calls.roots).toBeGreaterThan(0);
    expect(f.calls.authorizations).toBeGreaterThan(0);
    expect(await platform.runtime.capabilities(ctx, { projectId: workspace.projectId, workspaceId: workspace.workspaceId }))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
    await platform.close();
    closed = true;
    if (kind === 'sqlite') {
      const reopened = await createTargetPlatform({ storage: { kind: 'sqlite', directory: join(f.dir, 'storage') },
        workspace: f.bindings, now: () => at });
      try {
        expect(await reopened.materials.openArtifact(context(), { ref: stored.ref, usage: 'historical_explanation' }))
          .toMatchObject({ status: 'ready', value: { body: 'A trusted Host note' } });
      } finally { await reopened.close(); }
    }
  } finally { if (!closed) await platform.close(); }
});

it('rejects: the four published handoff entries admit only the Host that holds the lease', async () => {
  const scene = s6b2Scene();
  const opened = await scene.open('sqlite', { requestDriver: 'off' });
  const seededWorld = opened.world;
  let held: Awaited<ReturnType<typeof createTargetPlatform>> | null = null;
  try {
    // The source, basis and both operations are the S6B2 fixture's real public steps; the held platform opens the
    // same SQLite store, so one public read after the four refusals can show that nothing moved.
    const ws = await s6b2Workspace(seededWorld);
    const handoffSeed = await seedS6BArchiveSource(ws, 'held-handoff');
    const archiveSeed = await seedS6BArchiveSource(ws, 'held-archive');
    const handoff = await s6b2Accept(seededWorld, { commandId: 'held-lease-handoff', source: handoffSeed.source });
    const accepted = await seededWorld.platform.sessionArchive.acceptArchive(seededWorld.humanContext(), {
      commandId: 'held-lease-archive', source: archiveSeed.source,
      choices: archiveSeed.requests.map(request => ({ requestRoot: request.requestRoot, to: archiveSeed.other })),
    });
    if (accepted.status !== 'committed') {
      throw new Error(`the manual archive accept failed: ${JSON.stringify(accepted)}`);
    }
    const archive = accepted.value.operation;
    const basis = await seededWorld.platform.readSecretaryHandoffBasis(seededWorld.systemContext(), handoffSeed.source);
    if (basis.status !== 'ready') throw new Error(`the handoff basis is not readable: ${JSON.stringify(basis)}`);
    held = await createTargetPlatform({ storage: { kind: 'sqlite', directory: seededWorld.database },
      workspace: (await fixture()).bindings, now: () => at,
      hostInstance: { hostInstanceId: 'held-peer', lease: 'held_by_other' } });
    const ctx = seededWorld.systemContext();
    const readOperations = async () => {
      const handoffRead = await held!.sessions.getSessionOperation(ctx, handoff);
      const archiveRead = await held!.sessions.getSessionOperation(ctx, archive);
      if (handoffRead.status !== 'ready' || archiveRead.status !== 'ready') {
        throw new Error(`the seeded operations are not readable: ${JSON.stringify([handoffRead, archiveRead])}`);
      }
      return [handoffRead.value, archiveRead.value] as const;
    };
    const before = await readOperations();
    const calls: readonly { entry: string;
      call: (owner: SessionHandoffWorkflowPort, context: CoreCallContext) => Promise<unknown> }[] = [
      { entry: 'startHandoff', call: (owner, context) => owner.startHandoff(context, { source: handoffSeed.source, basis: basis.value }) },
      { entry: 'continueHandoff', call: (owner, context) => owner.continueHandoff(context, { operation: handoff }) },
      { entry: 'advance', call: (owner, context) => owner.advance(context, { operation: handoff }) },
      { entry: 'manualArchive', call: (owner, context) => owner.manualArchive(context, { operation: archive }) },
    ];
    for (const { entry, call } of calls) {
      expect(await call(held.workflow.sessionHandoff, ctx), entry).toMatchObject({ status: 'rejected', code: 'busy' });
    }
    expect(await readOperations()).toEqual(before);
  } finally {
    if (held !== null) await held.close();
    await scene.closeAll();
  }
});

const GOAL_REF = { aggregateType: 'Goal' as const, projectId: workspace.projectId, goalId: 'platform-goal' };
const PROJECT_REF = { aggregateType: 'Project' as const, projectId: workspace.projectId };
const WORKSPACE_REF = { aggregateType: 'Workspace' as const, projectId: workspace.projectId,
  workspaceId: workspace.workspaceId };

const PROPOSAL_DRAFT: PlanRevisionDraft = {
  schemaVersion: 2, planId: 'platform-plan', planRevision: 1, goalId: GOAL_REF.goalId,
  stages: [],
  tasks: [{ taskId: 'platform-task', title: 'Check the platform goal input',
    requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'plan_only' }],
  assignments: [], obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  taskRelations: [], inputRequirements: [],
};

describe('rejects: the Workflow goal input kind', () => {
  it.each(['memory', 'sqlite'] as const)('%s: an unknown kind is unsupported and changes nothing', async kind => {
    const f = await fixture();
    const platform = await createTargetPlatform({ storage: kind === 'memory' ? { kind: 'memory' } :
      { kind: 'sqlite', directory: join(f.dir, 'storage') }, workspace: f.bindings, now: () => at });
    try {
      const ctx = context();
      // Public prior state: a real Goal and a real candidate Plan.
      expect(await platform.projects.createProject(ctx, { meta: { requestId: 'platform-project',
        expected: [{ ref: PROJECT_REF, revision: 0 }] }, input: { projectId: workspace.projectId } }))
        .toMatchObject({ status: 'committed' });
      expect(await platform.projects.registerWorkspace(ctx, { meta: { requestId: 'platform-workspace',
        expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 0 }] },
        input: { workspace: { projectId: workspace.projectId, workspaceId: workspace.workspaceId } } }))
        .toMatchObject({ status: 'committed' });
      expect(await platform.goals.createGoal(ctx, { meta: { requestId: 'platform-goal',
        expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }] },
        input: { goalId: GOAL_REF.goalId, workspace: { projectId: workspace.projectId,
          workspaceId: workspace.workspaceId }, objective: 'Reject an unknown Workflow goal input kind' } }))
        .toMatchObject({ status: 'committed' });
      const proposed = await platform.plans.proposePlan(ctx, { meta: { requestId: 'platform-plan-propose',
        expected: [] }, input: { goalRef: GOAL_REF, basedOn: null, draft: PROPOSAL_DRAFT,
        reason: { text: 'The candidate Plan for the rejected continuation', sources: [] } } });
      expect(proposed).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2' } });
      if (proposed.status !== 'committed') throw new Error('the candidate Plan must be committed');

      const goalBefore = await platform.plans.queryGoal(ctx, GOAL_REF);
      const proposalBefore = await platform.plans.readPlanProposal(ctx, proposed.value.ref);
      expect(goalBefore).toMatchObject({ status: 'ready' });
      expect(proposalBefore).toMatchObject({ status: 'ready', value: proposed.value });

      // The complete valid `adopt_initial_plan` continuation; only the kind changes.
      const valid = { schemaVersion: 1 as const, goalRef: GOAL_REF, flowId: 'platform-unknown-kind',
        sessionHint: null, executeWithinRequest: true, kind: 'adopt_initial_plan' as const,
        request: { meta: { requestId: 'platform-adopt-initial-plan', expected: [] },
          input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision,
            decisionRefs: [] } } };
      const refused = await platform.workflow.handleGoalInput(ctx,
        { ...valid, kind: 'unknown_goal_input' } as unknown as InitialPlanningGoalInput);
      expect(refused).toMatchObject({ status: 'rejected', code: 'unsupported' });
      expect(await platform.plans.queryGoal(ctx, GOAL_REF)).toEqual(goalBefore);
      expect(await platform.plans.readPlanProposal(ctx, proposed.value.ref)).toEqual(proposalBefore);
    } finally { await platform.close(); }
  });
});
