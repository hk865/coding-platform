import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { createGuiService } from '../../src/app/service.js';
import { HistoryMaterials } from '../../src/interaction/human-collaboration/history-materials.js';
import { HistoryMaterialsContext } from '../../src/data/context-compiler/history-materials-context.js';
import * as materialService from '../../src/core/work-graph/materials/material-service.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { HistoryMaterial } from '../../src/contracts/history-materials.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { buildCreateGoalCommand, buildGoalCreateLedgerCommit } from '../contract-support/fixtures/goal-fixtures.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildDispatchClaimLedgerCommit } from '../../src/control/control-engine/records/dispatch.js';

const at = '2026-09-24T00:00:00.000Z';
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'r3b-gui-target' };
const owner: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: 'r3b-gui-source', runId: 'r3b-gui-source-run' };
const reader: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: 'r3b-gui-reader-run' };

it('reads persisted GUI history through the trusted Host material port after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r3b-gui-materials-'));
  const openCalls: { ctx: Omit<CoreCallContext, 'signal'>; input: Parameters<ReturnType<typeof materialService.createMaterialService>['openArtifact']>[1] }[] = [];
  let gui: Awaited<ReturnType<typeof createGuiService>> | undefined;
  try {
    const seed = await createPersistentPlatform({ dir });
    let grantId: string;
    try {
      const boot = buildBootstrapCommand({ schemaVersion: 1, entries: [
        { projectId: 'acceptance-alpha', workspaceId: 'workspace-main' },
        { projectId: 'acceptance-beta', workspaceId: 'workspace-main' },
      ] }, { commandId: 'r3b-gui-boot', correlationId: 'r3b-gui-boot', submittedAt: at });
      expect(await seed.bootstrap(boot)).toMatchObject({ status: 'committed' });
      for (const run of [owner, reader]) {
        const id = run.goalId;
        const goal = buildCreateGoalCommand({ ...scope, goalId: id, objective: 'GUI history material', actor: { kind: 'human', id: 'operator' } },
          { commandId: id, correlationId: id, idempotencyKey: id, submittedAt: at });
        expect(await seed.ledger.commit(buildGoalCreateLedgerCommit(goal,
          { eventId: id, occurredAt: at, projectRevision: 1, workspaceRevision: 1 }))).toMatchObject({ status: 'committed' });
        const claim = buildDispatchClaimCommand({ commandId: run.runId, ...scope, goalId: id,
          taskId: 'task-' + id, runId: run.runId, attemptId: 'attempt-' + id,
          idempotencyKey: run.runId, correlationId: run.runId, submittedAt: at });
        expect(await seed.ledger.commit(buildDispatchClaimLedgerCommit(claim,
          { eventId: run.runId, occurredAt: at, workspaceId: scope.workspaceId,
            planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: 'plan-' + id },
            workspaceRevision: 1 }))).toMatchObject({ status: 'committed' });
      }
      const stored = await seed.vault.put({ contentType: 'text/plain', body: 'Persisted GUI history body',
        sourceRefs: [{ kind: 'workspace', refId: scope.workspaceId, revision: '1' }], ownerRef: owner, requestedAt: at });
      expect(stored.status).toBe('stored');
      if (stored.status !== 'stored') throw Error('fixture artifact failed');
      await seed.advanceProjection();
      const item: HistoryMaterial = { id: 'r3b-gui-report', label: 'Saved report', workspaceId: scope.workspaceId,
        owner, artifactRef: stored.ref };
      const history = new HistoryMaterials({ materials: new HistoryMaterialsContext({ ledger: seed.ledger, vault: seed.vault }),
        catalog: () => [item], control: seed, grants: seed, now: () => at });
      const granted = await history.grant(scope, { requestId: 'r3b-gui-grant', materialId: item.id, runId: reader.runId,
        purpose: 'Read original report', allowHistoricalRead: true });
      grantId = granted.grant.grantId;
      expect(granted.grant.history?.usage).toBe('historical_explanation');
    } finally {
      await seed.close();
    }

    const originalFactory = materialService.createMaterialService;
    const factory = vi.spyOn(materialService, 'createMaterialService').mockImplementation(deps => {
      const real = originalFactory(deps);
      return { ...real, openArtifact: async (ctx, input) => {
        const { signal: _signal, ...identity } = ctx;
        openCalls.push({ ctx: structuredClone(identity), input: structuredClone(input) });
        return real.openArtifact(ctx, input);
      } };
    });
    try {
      gui = await createGuiService(dir);
      const forged = { actor: { kind: 'human', id: 'forged-json' }, principal: { kind: 'work_run', runRef: reader } };
      const opened = await gui.action('/api/real/history/read', { ...scope, grantId, ...forged });
      expect(opened).toMatchObject({ result: { status: 'ready', record: { body: 'Persisted GUI history body' } },
        applicability: 'historical_explanation' });
      expect(factory).toHaveBeenCalled();
      expect(openCalls).toHaveLength(1);
      expect(openCalls[0]!.ctx).toMatchObject({ projectId: scope.projectId,
        principal: { kind: 'host', actor: { kind: 'human', id: 'local-gui' } },
        materialReader: { kind: 'host', projectId: scope.projectId, actor: { kind: 'human', id: 'local-gui' } } });
      expect(openCalls[0]!.ctx.principal.kind).toBe('host');
      expect(openCalls[0]!.input).toMatchObject({ usage: 'historical_explanation' });
      await expect(gui.action('/api/real/history/read', { ...scope, projectId: 'unknown-project', grantId }))
        .rejects.toThrow('未知项目或工作区');
      expect(openCalls).toHaveLength(1);
      await gui.close();
      gui = undefined;
    } finally {
      factory.mockRestore();
    }

    const check = await createPersistentPlatform({ dir });
    try {
      const events = await check.ledger.events({ afterCursor: null, limit: 256 });
      expect(events.events.filter(row => row.event.eventType === 'TaskClaimed')).toHaveLength(2);
    } finally {
      await check.close();
    }
  } finally {
    await gui?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
