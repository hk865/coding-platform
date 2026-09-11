import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { VerificationContextCompiler } from '../../src/data/context-compiler/verification-context.js';
import { VerificationWorkspaceReader } from '../../src/data/workspace-reader/verification-workspace-reader.js';
import { CandidateWorkspaceReader } from '../../src/data/workspace-reader/candidate-workspace-reader.js';
import type { AggregateSnapshot, StateLedger, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { CompletionPolicyRevisionSnapshot, ArchitectureBaselineRevisionSnapshot } from '../../src/contracts/governance.js';
import { buildReduceTaskCommand } from '../../src/contracts/commands/evidence.js';
import { buildReduceGoalCommand } from '../../src/contracts/commands/goal-phase.js';
import type { VerificationRoundScope, VerificationRuntimeFacts, VerificationRoundSourcePort, VerificationRoundMaterialResult } from '../../src/contracts/verification-context.js';
import {
  prepareP107Scenario, runP107Task, toP1_07Harness, P107_PROJECT, P107_WORKSPACE, P107_GOAL, P107_SCHEMA,
  P107_TASK_WRITER_B, P107_ROLE_BINDING_WRITER_V1, P107_BUDGET_WRITER_V1, P107_DECLARED_WRITE_PERMISSIONS_V1,
} from '../contract-suite/p1-07-harness.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const ready = (result: VerificationRoundMaterialResult) => {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(JSON.stringify(result));
  return result.material;
};

async function scenario() {
  const root = await mkdtemp(join(tmpdir(), 'verification-round-context-')); roots.push(root);
  await writeFile(join(root, 'source.txt'), 'accepted source\n');
  const h = createInMemoryHarness({ deps: { clock: () => P107_SCHEMA } });
  const p107 = toP1_07Harness(h);
  await prepareP107Scenario(p107);
  await runP107Task(p107, { taskId: P107_TASK_WRITER_B, runId: 'round-run', attemptId: 'round-attempt',
    roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1 });
  const scope: VerificationRoundScope = { projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, goalId: P107_GOAL, taskId: P107_TASK_WRITER_B, runId: 'round-run' };
  const observations: ReturnType<VerificationRuntimeFacts['all']> = [{ spec: scope, status: 'completed' }];
  let mutate: (snapshot: AggregateSnapshot) => AggregateSnapshot = value => value;
  const ledger = Object.create(h.ledger) as StateLedger;
  ledger.load = async ref => {
    const result = await h.ledger.load(ref);
    return result.status === 'found' ? { status: 'found', snapshot: mutate(structuredClone(result.snapshot)) } : result;
  };
  const source = new VerificationWorkspaceReader();
  const compiler = (roundSource: VerificationRoundSourcePort = source) => new VerificationContextCompiler({
    ledger, vault: h.vault, runtime: { all: () => structuredClone(observations) }, rootFor: () => root,
    workspaceSource: new CandidateWorkspaceReader(), roundSource,
  });
  return { h, scope, root, observations, source, compiler, mutate: (fn: typeof mutate) => { mutate = fn; } };
}

describe('canonical verification round materials', () => {
  it('ignores extra round fields when reading committed revisions for the next Control CAS', async () => {
    const s = await scenario(), context = s.compiler();
    const identity = { projectId: s.scope.projectId, goalId: s.scope.goalId, actor: { kind: 'system' as const, id: 'control-engine' }, submittedAt: P107_SCHEMA };
    const reduceTask = (expectedRevision: number) => s.h.reduceTask(buildReduceTaskCommand({
      ...identity, taskId: s.scope.taskId, expectedRevision,
      commandId: `context-task-${expectedRevision}`, idempotencyKey: `context-task-${expectedRevision}`, correlationId: 'context-cas',
    }));
    const reduceGoal = (expectedRevision: number) => s.h.reduceGoal(buildReduceGoalCommand({
      ...identity, expectedRevision,
      commandId: `context-goal-${expectedRevision}`, idempotencyKey: `context-goal-${expectedRevision}`, correlationId: 'context-cas',
    }));
    expect(await reduceTask(0)).toMatchObject({ status: 'committed' });
    expect(await reduceGoal(0)).toMatchObject({ status: 'committed' });
    // The real caller carries workspace/run as well as task identity. These
    // unrelated fields must not make a committed record look absent (revision 0).
    const taskRevision = await context.taskReductionRevision(s.scope);
    const goalRevision = await context.goalPhaseRevision(s.scope);
    expect(taskRevision).toBe(1);
    expect(goalRevision).toBe(1);
    expect(await reduceTask(taskRevision)).toMatchObject({ status: 'committed' });
    expect(await reduceGoal(goalRevision)).toMatchObject({ status: 'committed' });
    const beforeReads = await s.h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(await context.taskReductionRevision(s.scope)).toBe(2);
    expect(await context.goalPhaseRevision(s.scope)).toBe(2);
    expect(await s.h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(beforeReads);
  });

  it('reads an accepted Task/Run and exact policy/baseline, keeps non-Git change scope unknown and writes no state', async () => {
    const s = await scenario(), context = s.compiler();
    const before = await s.h.ledger.events({ afterCursor: null, limit: 1000 });
    const material = ready(await context.resolveRound(s.scope));
    expect(material).toMatchObject({ task: { taskId: s.scope.taskId }, semanticChange: 'semantic',
      sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
      changeScope: { diffClass: 'unclassified-current-workspace', changedFiles: [] },
      identity: { scope: s.scope, workspaceRoot: s.root, workspaceRevision: 1, runRevision: material.run.revision,
        policyPin: material.plan.effectiveCompletionPolicy, baselinePin: material.plan.effectiveArchitectureBaseline } });
    expect(material.gaps).not.toHaveLength(0);
    expect(material.sourceDigest).toBe(await new CandidateWorkspaceReader().digest(s.root));
    expect(ready(await context.resolveRound(s.scope, material.identity))).toEqual(material);
    material.task.title = 'caller mutation';
    material.policyContent.requirementKinds.length = 0;
    expect(ready(await context.resolveRound(s.scope)).task.title).not.toBe('caller mutation');
    expect(await s.h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
    // Extra caller claims are not a source proof and cannot enable a fast path.
    const claimed = { ...s.scope, semanticChange: 'none', changeScope: { changedFiles: [], diffClass: 'docs-only' } };
    expect(ready(await context.resolveRound(claimed)).semanticChange).toBe('semantic');
  });

  it('rejects cross-project/workspace/goal/task/run requests and incomplete scopes', async () => {
    const s = await scenario(), context = s.compiler();
    for (const key of ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId'] as const) {
      expect((await context.resolveRound({ ...s.scope, [key]: 'foreign' })).status).toBe('rejected');
      expect(await context.resolveRound({ ...s.scope, [key]: '' })).toMatchObject({ status: 'rejected', code: 'invalid_scope' });
    }
  });

  it('rejects a Run whose canonical task/envelope disagree even when the public observation matches', async () => {
    const s = await scenario();
    s.mutate(snapshot => snapshot.ref.aggregateType === 'Run' ? { ...snapshot, task: { ...(snapshot as RunSnapshot).task, taskId: 'other-task' } } as AggregateSnapshot : snapshot);
    expect(await s.compiler().resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'scope_mismatch' });
  });

  it('requires the current active Plan to belong to this exact goal and contain the task', async () => {
    const s = await scenario();
    s.mutate(snapshot => snapshot.ref.aggregateType === 'PlanRevision' ? { ...snapshot, goalRef: { aggregateType: 'Goal', projectId: s.scope.projectId, goalId: 'other-goal' } } as AggregateSnapshot : snapshot);
    expect(await s.compiler().resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'scope_mismatch' });
    s.mutate(snapshot => snapshot.ref.aggregateType === 'PlanRevision' ? { ...snapshot, tasks: [] } as AggregateSnapshot : snapshot);
    expect(await s.compiler().resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'not_found' });
    s.mutate(snapshot => snapshot.ref.aggregateType === 'Goal' ? { ...snapshot, activePlanRevision: { aggregateType: 'PlanRevision', projectId: s.scope.projectId, planId: 'new-plan' } } as AggregateSnapshot : snapshot);
    expect(await s.compiler().resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'stale_material' });
  });

  for (const kind of ['CompletionPolicyRevision', 'ArchitectureBaselineRevision'] as const) {
    it(`rejects corrupted ${kind} content even if its stored digest is unchanged`, async () => {
      const s = await scenario();
      s.mutate(snapshot => {
        if (snapshot.ref.aggregateType !== kind) return snapshot;
        if (kind === 'CompletionPolicyRevision') {
          const policy = snapshot as CompletionPolicyRevisionSnapshot;
          return { ...policy, content: { ...policy.content, requirementKinds: [...policy.content.requirementKinds, 'corrupted'] } };
        }
        const baseline = snapshot as ArchitectureBaselineRevisionSnapshot;
        return { ...baseline, content: { ...baseline.content, description: 'corrupted' } };
      });
      expect(await s.compiler().resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'dangling_ref' });
    });
  }

  it('rejects changed numeric workspace revision with identical source and detects a change during source I/O', async () => {
    const s = await scenario(), context = s.compiler();
    const material = ready(await context.resolveRound(s.scope));
    const advanceWorkspace = (snapshot: AggregateSnapshot): AggregateSnapshot => snapshot.ref.aggregateType === 'Workspace' ? { ...(snapshot as WorkspaceSnapshot), revision: snapshot.revision + 1 } : snapshot;
    s.mutate(advanceWorkspace);
    expect(await context.resolveRound(s.scope, material.identity)).toMatchObject({ status: 'rejected', code: 'stale_material' });
    s.mutate(snapshot => snapshot);
    const changing = s.compiler({ capture: async root => { const result = await s.source.capture(root); s.mutate(advanceWorkspace); return result; } });
    expect(await changing.resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'stale_material' });
  });

  it('rejects source changes before a check, between checks, or after a stored report using the same frozen identity', async () => {
    const s = await scenario(), context = s.compiler();
    const material = ready(await context.resolveRound(s.scope));
    for (const stage of ['before-check', 'between-checks', 'after-report']) {
      await writeFile(join(s.root, 'source.txt'), stage);
      expect(await context.resolveRound(s.scope, material.identity)).toMatchObject({ status: 'rejected', code: 'stale_material' });
    }
  });

  it('rejects same-ref Plan body changes and comparison-root changes', async () => {
    const s = await scenario(), context = s.compiler();
    const material = ready(await context.resolveRound(s.scope));
    s.mutate(snapshot => snapshot.ref.aggregateType === 'PlanRevision' ? { ...snapshot, acceptedAt: '2026-09-10T00:00:00.000Z' } as AggregateSnapshot : snapshot);
    expect(await context.resolveRound(s.scope, material.identity)).toMatchObject({ status: 'rejected', code: 'stale_material' });
    s.mutate(snapshot => snapshot);
    expect(await context.resolveRound(s.scope, { ...material.identity, workspaceRoot: s.root + '-another' })).toMatchObject({ status: 'rejected', code: 'stale_material' });
  });

  it('refuses unresolved Runtime effects and active work in the same scope, but ignores a foreign project', async () => {
    const s = await scenario(), context = s.compiler();
    s.observations.push({ spec: { ...s.scope, projectId: 'foreign-project', runId: 'active-run' }, status: 'running' });
    ready(await context.resolveRound(s.scope));
    s.observations[1]!.spec.projectId = s.scope.projectId;
    expect(await context.resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'run_unsettled' });
    s.observations.pop(); s.observations[0]!.status = 'outcome_unknown';
    expect(await context.resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'run_unsettled' });
    s.observations[0]!.status = 'completed';
    s.mutate(snapshot => snapshot.ref.aggregateType === 'Run' ? { ...snapshot, outcome: 'outcome_unknown' } as AggregateSnapshot : snapshot);
    expect(await context.resolveRound(s.scope)).toMatchObject({ status: 'rejected', code: 'run_unsettled' });
  });

  it('returns explicit gaps for missing source configuration and incomplete source reads', async () => {
    const s = await scenario();
    const missing = new VerificationContextCompiler({ ledger: s.h.ledger, vault: s.h.vault });
    expect(await missing.resolveRound(s.scope)).toMatchObject({ status: 'incomplete', code: 'material_unavailable' });
    expect(await s.compiler({ capture: async () => ({ status: 'incomplete', code: 'source_unavailable', missing: ['file count exceeded'] }) }).resolveRound(s.scope)).toEqual({ status: 'incomplete', code: 'source_unavailable', missing: ['file count exceeded'] });
  });
});
