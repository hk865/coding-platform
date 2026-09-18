import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { setupP107Scenario } from '../coordination/runtime-concurrency-fixture.js';
import { buildDispatchClaimCommand, FAKE_RUNTIME_SCRIPT_COMPLETED_V1, type FakeRuntimeScriptV1 } from '../../src/fixtures/dispatch-fixtures.js';
import { P107_PROJECT, P107_WORKSPACE, P107_SCHEMA } from '../contract-support/fixtures/workspace-fixtures.js';
import { P107_GOAL, P107_TASK_READER_A, P107_ROLE_BINDING_READER_V1, P107_DECLARED_READ_PERMISSIONS_V1, P107_BUDGET_READER_V1 } from '../contract-suite/p1-07-harness.js';
import type { ControlIntentSnapshot, ReconcileControlIntentCommand } from '../../src/contracts/control-intent.js';

for (const backend of ['memory', 'sqlite'] as const) for (const outcome of ['cancelled', 'completed', 'outcome_unknown'] as const) {
  it(`${backend}: reconciles ${outcome} from canonical Run with no invented safe-point acknowledgement`, async () => {
    const script: FakeRuntimeScriptV1 = outcome === 'completed' ? FAKE_RUNTIME_SCRIPT_COMPLETED_V1 : {
      schemaVersion: 1, items: outcome === 'outcome_unknown' ? [] : [{ sequence: 1, eventType: 'run_cancelled', occurredAt: P107_SCHEMA, payload: { kind: 'cancelled', reason: 'deterministic runtime witness' } }],
    };
    const dir = backend === 'sqlite' ? await mkdtemp(join(tmpdir(), 'cancel-intent-')) : null;
    const h = dir ? await createPersistentPlatform({ dir, runtimeScript: script }) : createInMemoryHarness({ runtimeScript: script });
    try {
      await setupP107Scenario(h);
      const runRef = { aggregateType: 'Run' as const, projectId: P107_PROJECT, goalId: P107_GOAL, runId: 'cancel-witness' };
      expect(await h.claimTask(buildDispatchClaimCommand({ projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_READER_A,
        runId: runRef.runId, attemptId: 'attempt-witness', commandId: 'claim', idempotencyKey: 'claim', correlationId: 'claim', submittedAt: P107_SCHEMA,
        roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1 }))).toMatchObject({ status: 'committed' });
      await h.drive({ reason: 'deterministic-terminal' });
      if (outcome === 'outcome_unknown') {
        const running = await h.ledger.load(runRef);
        if (running.status !== 'found') throw Error('Run missing');
        expect(await h.control.runFact({ schemaVersion: 1, commandType: 'RunFact', commandId: 'unknown',
          identity: { projectId: P107_PROJECT, actor: { kind: 'system', id: 'recovery' }, idempotencyKey: 'unknown' },
          aggregateId: runRef.runId, expectedRevision: running.snapshot.revision, correlationId: 'unknown', submittedAt: P107_SCHEMA,
          payload: { fact: { kind: 'outcome_unknown', runRef, reason: 'Explicit unknown receipt' } } })).toMatchObject({ status: 'committed' });
      }
      expect(await h.ledger.load(runRef)).toMatchObject({ status: 'found', snapshot: { status: 'ended', outcome } });
      const intentRef = { aggregateType: 'ControlIntent' as const, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, intentId: 'cancel' };
      expect(await h.control.submitControl({ schemaVersion: 1, commandType: 'SubmitControl', commandId: 'cancel',
        identity: { projectId: P107_PROJECT, actor: { kind: 'human', id: 'user-1' }, idempotencyKey: 'cancel' },
        aggregateId: 'cancel', expectedRevision: 0, correlationId: 'cancel', submittedAt: P107_SCHEMA,
        payload: { intent: { schemaVersion: 1, intentId: 'cancel', projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, kind: 'cancel',
          scope: { projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, goalId: P107_GOAL, taskId: P107_TASK_READER_A, runRef },
          reason: null, steer: null, desiredState: 'cancelled', status: 'queued', acks: [], resumeFromIntentRef: null, submittedAt: P107_SCHEMA, updatedAt: P107_SCHEMA } } })).toMatchObject({ status: 'committed' });
      const command: ReconcileControlIntentCommand = { schemaVersion: 1, commandType: 'ReconcileControlIntent', commandId: 'reconcile',
        identity: { projectId: P107_PROJECT, actor: { kind: 'system', id: 'recovery' }, idempotencyKey: 'reconcile' },
        expectedRevision: 1, submittedAt: P107_SCHEMA, payload: { intentRef } };
      expect(await h.control.reconcileControlIntent!({ ...command, identity: { ...command.identity, actor: { kind: 'human', id: 'user-1' } } })).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await h.control.reconcileControlIntent!({ ...command, expectedRevision: 0 })).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      const commit = h.ledger.commit.bind(h.ledger);
      let guarded = false;
      h.ledger.commit = async batch => {
        if (batch.commitKind === 'control-intent-reconcile') {
          const forged = structuredClone(batch);
          forged.identity.idempotencyKey += '-forged';
          forged.events[0].idempotencyKey = forged.identity.idempotencyKey;
          forged.fingerprint = '0'.repeat(64) as typeof forged.fingerprint;
          forged.snapshots[0].intent.status = outcome === 'cancelled' ? 'rejected' : 'applied';
          forged.events[0].payload.snapshot = structuredClone(forged.snapshots[0]);
          expect(await commit(forged)).toMatchObject({ status: 'rejected' });
          guarded = true;
        }
        return commit(batch);
      };
      expect(await h.control.reconcileControlIntent!(command)).toMatchObject({ status: 'committed', revision: 2 });
      expect(guarded).toBe(true);
      h.ledger.commit = commit;
      const expected = outcome === 'cancelled' ? 'applied' : outcome === 'completed' ? 'rejected' : 'outcome_unknown';
      const result = await h.ledger.load(intentRef);
      expect(result).toMatchObject({ status: 'found', snapshot: { revision: 2, intent: { status: expected, acks: [], reconciliation: { runRef, outcome } } } });
      expect(await h.control.reconcileControlIntent!(command)).toMatchObject({ status: 'unchanged' });
      const events = await h.ledger.events({ afterCursor: null, limit: 1000 });
      expect(events.events.filter(e => e.event.eventType === 'ControlIntentReconciled')).toHaveLength(1);
      expect(events.events.filter(e => e.event.eventType === 'SafePointAcknowledged')).toHaveLength(0);
      await h.advanceProjection();
      expect(await h.controlTimelineView({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE })).toMatchObject({ status: 'ready', entries: [{ status: expected, ackCount: 0 }] });
    } finally { if (dir) { await (h as Awaited<ReturnType<typeof createPersistentPlatform>>).close(); await rm(dir, { recursive: true, force: true }); } }
  });
}
