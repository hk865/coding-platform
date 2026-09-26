import { expect, it, vi } from 'vitest';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { HistoryMaterials } from '../../src/interaction/human-collaboration/history-materials.js';
import { HistoryMaterialsContext } from '../../src/data/context-compiler/history-materials-context.js';
import type { HistoryMaterial, HistoryMaterialPort } from '../../src/contracts/history-materials.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { buildBootstrapLedgerCommit } from '../contract-support/fixtures/bootstrap-fixture-v1.js';
import { buildCreateGoalCommand, buildGoalCreateLedgerCommit } from '../contract-support/fixtures/goal-fixtures.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildDispatchClaimLedgerCommit } from '../../src/control/control-engine/records/dispatch.js';
import { createMaterialAccessResolver } from '../../src/data/artifact-vault/material-access-policy.js';
import type { StateLedger } from '../../src/contracts/ledger.js';

const at = '2026-09-24T00:00:00.000Z';
const scope = { projectId: 'r3b-host-project', workspaceId: 'target-workspace', goalId: 'target-goal' };
const owner: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: 'source-goal', runId: 'source-run' };
const reader: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: 'reader-run' };
const grantInput = { requestId: 'host-history-grant', materialId: 'report', runId: reader.runId,
  purpose: 'Explicit historical use', allowHistoricalRead: true };

async function historicalFixture() {
  const h = createInMemoryHarness();
  const boot = buildBootstrapCommand({ schemaVersion: 1, entries: [scope,
    { projectId: scope.projectId, workspaceId: 'source-workspace' }] },
  { commandId: 'boot-r3b-host', correlationId: 'boot-r3b-host', submittedAt: at });
  expect(await h.ledger.commit(buildBootstrapLedgerCommit(boot,
    { eventIds: ['project-r3b', 'target-r3b', 'source-r3b'], occurredAt: at }))).toMatchObject({ status: 'committed' });
  for (const [run, workspaceId] of [[owner, 'source-workspace'], [reader, scope.workspaceId]] as const) {
    const id = run.goalId;
    const goal = buildCreateGoalCommand({ ...scope, workspaceId, goalId: id,
      objective: 'Host history material', actor: { kind: 'human', id: 'operator' } },
    { commandId: id, correlationId: id, idempotencyKey: id, submittedAt: at });
    expect(await h.ledger.commit(buildGoalCreateLedgerCommit(goal,
      { eventId: id, occurredAt: at, projectRevision: 1, workspaceRevision: 1 }))).toMatchObject({ status: 'committed' });
    const claim = buildDispatchClaimCommand({ commandId: run.runId, ...scope, goalId: id,
      taskId: 'task-' + id, runId: run.runId, attemptId: 'attempt-' + id,
      idempotencyKey: run.runId, correlationId: run.runId, submittedAt: at });
    expect(await h.ledger.commit(buildDispatchClaimLedgerCommit(claim,
      { eventId: run.runId, occurredAt: at, workspaceId,
        planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: 'plan-' + id },
        workspaceRevision: 1 }))).toMatchObject({ status: 'committed' });
  }
  const stored = await h.vault.put({ contentType: 'text/plain', body: 'Original cross-workspace report',
    sourceRefs: [{ kind: 'workspace', refId: 'source-workspace', revision: '1' }], ownerRef: owner, requestedAt: at });
  if (stored.status !== 'stored') throw Error('fixture body not stored');
  const item: HistoryMaterial = { id: 'report', label: 'Original report', workspaceId: 'source-workspace',
    owner, artifactRef: stored.ref };
  return { h, item };
}

it('uses trusted Host material reads for ordinary history while preserving the canonical grant and cross-workspace gate', async () => {
  const { h, item } = await historicalFixture();
  const actor = { kind: 'human' as const, id: 'local-gui' };
  const boundContext: CoreCallContext = { projectId: scope.projectId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: scope.projectId, actor },
    signal: new AbortController().signal };
  const readHostContext = vi.fn((requested: typeof scope) => {
    if (requested.projectId !== scope.projectId || requested.workspaceId !== scope.workspaceId)
      throw Error('unverified history scope');
    return boundContext;
  });
  let staleBasis = false;
  const authorityReads: Pick<StateLedger, 'load'> = { load: async ref => {
    const loaded = await h.ledger.load(ref);
    if (staleBasis && ref.aggregateType === 'Workspace' && ref.workspaceId === scope.workspaceId && loaded.status === 'found')
      return { ...loaded, snapshot: { ...loaded.snapshot, revision: loaded.snapshot.revision + 1 } } as typeof loaded;
    return loaded;
  } };
  const grantAuthority = createMaterialAccessResolver(authorityReads as StateLedger, h.readModel);
  const openArtifact = vi.fn(async (_ctx: CoreCallContext, input: { ref: typeof item.artifactRef; usage: 'current' | 'historical_explanation' }) => ({
    status: 'ready' as const, value: { ref: input.ref, body: 'Original cross-workspace report',
      sourceRefs: [{ kind: 'workspace' as const, refId: 'source-workspace', revision: '1' }], ownerRunRef: owner,
      applicability: 'historical_explanation' as const },
  }));
  const oldOpen = vi.fn(async () => { throw Error('ordinary Host path used legacy vault.open'); });
  const context = new HistoryMaterialsContext({ ledger: h.ledger, vault: { open: oldOpen },
    materials: { openArtifact }, readHostContext, grantAuthority });
  const history: HistoryMaterialPort = new HistoryMaterials({ materials: context, catalog: () => [item],
    control: h, grants: h, now: () => at });
    expect(await history.view(scope)).toMatchObject({ materials: [item] });
    expect(oldOpen).not.toHaveBeenCalled();
    // A body in another workspace is selectable only as a source; it is not readable
    // as page history before a canonical human grant exists.
    await expect(history.read(scope, { grantId: 'absent' })).rejects.toThrow('授权不存在');
    const beforeReadCalls = openArtifact.mock.calls.length;
    const { grant } = await history.grant(scope, grantInput);
    await h.advanceProjection();
    expect(await grantAuthority.grantsFor(item.artifactRef, reader)).toEqual([grant]);
    expect(await grantAuthority.currentBasisValid!(grant)).toBe(true);
    expect(grant.history?.crossWorkspace).toMatchObject({ sourceWorkspaceId: 'source-workspace',
      authorizedBy: { kind: 'human', id: 'local-gui' } });
    const opened = await history.read(scope, { grantId: grant.grantId, actor: { kind: 'human', id: 'forged-json' } });
    expect(opened).toMatchObject({ grant, result: { status: 'ready', record: { body: 'Original cross-workspace report' } },
      applicability: 'historical_explanation' });
    expect(openArtifact.mock.calls.length).toBeGreaterThan(beforeReadCalls);
    for (const [ctx, request] of openArtifact.mock.calls) {
      expect(ctx).toEqual(boundContext);
      expect(ctx.principal).toEqual({ kind: 'host', actor });
      expect(ctx.materialReader).toEqual({ kind: 'host', projectId: scope.projectId, actor });
      expect(request.ref).toEqual(item.artifactRef);
    }
    expect(readHostContext).toHaveBeenCalledWith(scope);
    expect(oldOpen).not.toHaveBeenCalled();
    const readsBeforeStale = openArtifact.mock.calls.length;
    staleBasis = true;
    expect(await grantAuthority.currentBasisValid!(grant)).toBe(false);
    expect(await history.read(scope, { grantId: grant.grantId })).toMatchObject({
      grant, result: { status: 'rejected', code: 'stale' }, applicability: 'historical_explanation',
    });
    expect(openArtifact).toHaveBeenCalledTimes(readsBeforeStale);
    staleBasis = false;
    const readsBeforeRevocation = openArtifact.mock.calls.length;
    expect(await history.revoke(scope, { grantId: grant.grantId, requestId: 'revoke-r3b-host', reason: 'ended' }))
      .toMatchObject({ status: 'committed' });
    await expect(history.read(scope, { grantId: grant.grantId })).rejects.toThrow('已撤销');
    expect(await grantAuthority.grantsFor(item.artifactRef, reader)).toEqual([]);
    await expect(history.read({ ...scope, workspaceId: 'source-workspace' }, { grantId: grant.grantId }))
      .rejects.toThrow('授权不存在');
    expect(openArtifact).toHaveBeenCalledTimes(readsBeforeRevocation);
});
