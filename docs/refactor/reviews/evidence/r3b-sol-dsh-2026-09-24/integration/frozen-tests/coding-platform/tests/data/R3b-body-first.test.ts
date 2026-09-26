import { expect, it, vi } from 'vitest';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createLegacyArtifactPort, createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { ArtifactPort, ArtifactRef } from '../../src/contracts/artifact.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { buildCreateGoalCommand } from '../contract-support/fixtures/goal-fixtures.js';
import { buildApplyPlanCommand } from '../../src/fixtures/plan-fixtures.js';
import { buildDispatchClaimCommand, DISPATCH_PLAN_REVISION_FIXTURE_V1, DISPATCH_ELIGIBLE_TASK_ID } from '../../src/fixtures/dispatch-fixtures.js';
import { COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1, buildInstallCommand, buildActivateCommand } from '../../src/fixtures/governance-fixtures.js';
import { completionPolicyPinFor, architectureBaselinePinFor } from '../../src/contracts/governance.js';

const at = '2026-09-24T00:00:00.000Z';
const scope = { projectId: 'body-first-project', workspaceId: 'body-first-workspace', goalId: 'body-first-goal' };
const runId = 'body-first-run';
const identity = (id: string) => ({ projectId: scope.projectId, commandId: id, correlationId: id,
  idempotencyKey: id, submittedAt: at });

async function dispatchFixture(failBodyPut = false) {
  const raw = new RawArtifactBodyStore();
  const storedRefs: ArtifactRef[] = [];
  const bodies: RawArtifactStorePort = { read: ref => raw.read(ref), put: async input => {
    if (failBodyPut) return { status: 'rejected', code: 'unavailable', reason: 'injected body persistence failure' };
    const result = await raw.put(input);
    if (result.status === 'ready') storedRefs.push(result.value.ref);
    return result;
  } };
  let h!: ReturnType<typeof createInMemoryHarness>;
  const materialDeps = { bodies, authority: { load: (ref: Parameters<NonNullable<typeof h>['ledger']['load']>[0]) => h.ledger.load(ref) },
    grants: { grantsFor: async () => [] }, now: () => at };
  const legacy = createLegacyArtifactPort(materialDeps);
  const materials = createMaterialService(materialDeps);
  const vault: ArtifactPort = { put: record => legacy.put(record), open: (ref, query) => legacy.open(ref, query) };
  h = createInMemoryHarness({ vault, deps: { clock: () => at } });
  expect(await h.bootstrap(buildBootstrapCommand({ schemaVersion: 1, entries: [scope] }, identity('boot'))))
    .toMatchObject({ status: 'committed' });
  for (const [index, definition] of [COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1].entries()) {
    const installed = buildInstallCommand(definition, identity('install-' + index));
    expect(await h.install(installed)).toMatchObject({ status: 'committed' });
    const pin = installed.commandType === 'InstallCompletionPolicyRevision'
      ? completionPolicyPinFor(installed) : architectureBaselinePinFor(installed);
    expect(await h.activate(buildActivateCommand(pin, { ...identity('activate-' + index), expectedRevision: 1 })))
      .toMatchObject({ status: 'committed' });
  }
  expect(await h.control.submit(buildCreateGoalCommand({ ...scope, objective: 'Body-first dispatch',
    actor: { kind: 'human', id: 'operator' } }, identity('goal')))).toMatchObject({ status: 'committed' });
  const plan = { ...structuredClone(DISPATCH_PLAN_REVISION_FIXTURE_V1), goalId: scope.goalId, planId: 'body-first-plan' };
  expect(await h.applyPlan(buildApplyPlanCommand(plan, { ...identity('plan'), expectedRevision: 1 })))
    .toMatchObject({ status: 'committed' });
  expect(await h.claimTask(buildDispatchClaimCommand({ ...identity('claim'), goalId: scope.goalId,
    taskId: DISPATCH_ELIGIBLE_TASK_ID, runId, attemptId: 'body-first-attempt',
    budget: { tokenBudget: 1000000, deadline: null } }))).toMatchObject({ status: 'committed' });
  return { h, raw, storedRefs, vault, materials };
}

it('retains a readable raw body without a successful Run envelope when the real start commit rejects', async () => {
  const { h, raw, storedRefs, vault, materials } = await dispatchFixture();
  const originalCommit = h.ledger.commit.bind(h.ledger);
  let deniedStarts = 0;
  const spy = vi.spyOn(h.ledger, 'commit').mockImplementation(async batch => {
    if (batch.events.some(event => event.eventType === 'RunStarted')) {
      deniedStarts += 1;
      return { status: 'rejected', code: 'revision_conflict' };
    }
    return originalCommit(batch);
  });
  try {
    const drive = await h.drive({ reason: 'body-first-commit-fault', maxIntents: 1 });
    expect(deniedStarts).toBe(1);
    expect(drive.started).toBe(0);
    expect(drive.failures).toEqual([expect.objectContaining({ code: 'rejected', message: expect.stringContaining('revision_conflict') })]);
    expect(storedRefs).toHaveLength(1);
    const ref = storedRefs[0]!;
    expect(await raw.read(ref)).toMatchObject({ status: 'ready', value: { ref, body: expect.any(String) } });
    expect(await vault.open(ref, { requesterRunRef: { aggregateType: 'Run', projectId: scope.projectId,
      goalId: scope.goalId, runId } })).toMatchObject({ status: 'ready', record: { ref } });
    const hostActor = { kind: 'human' as const, id: 'operator' };
    expect(await materials.openArtifact({ projectId: scope.projectId, workspaceId: scope.workspaceId,
      principal: { kind: 'host', actor: hostActor },
      materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: hostActor },
      signal: new AbortController().signal }, { ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'ready', value: { ref } });
    expect(await h.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId }))
      .toMatchObject({ status: 'found', snapshot: { envelope: null } });
    const events = await h.ledger.events({ afterCursor: null, limit: 256 });
    expect(events.events.some(row => row.event.eventType === 'RunStarted')).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it('does not attempt formal Run registration when the real body store rejects the bundle', async () => {
  const { h, storedRefs } = await dispatchFixture(true);
  const start = vi.spyOn(h.control, 'startRun');
  try {
    const drive = await h.drive({ reason: 'body-first-put-fault', maxIntents: 1 });
    expect(drive.started).toBe(0);
    expect(drive.failures).toEqual([expect.objectContaining({ code: 'context_rejected',
      message: expect.stringContaining('injected body persistence failure') })]);
    expect(storedRefs).toEqual([]);
    expect(start).not.toHaveBeenCalled();
    expect(await h.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId }))
      .toMatchObject({ status: 'found', snapshot: { envelope: null } });
  } finally {
    start.mockRestore();
  }
});
