import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { createPersistentSqliteHarness } from '../../src/harness/persistent-harness.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import type { RegisterWorkspaceCommand } from '../../src/contracts/workspace-registration.js';

for (const adapter of ['memory', 'sqlite']) it(adapter + ': registers explicit workspaces without rewriting bootstrap, rejects stale/forged inputs and replays after reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-register-'));
  const persistent = adapter === 'sqlite' ? await createPersistentSqliteHarness({ dir }) : null;
  const h = persistent ?? createInMemoryHarness();
  const at = '2026-09-09T00:00:00.000Z', projectId = 'project', scope = { projectId, workspaceId: 'additional' };
  const command: RegisterWorkspaceCommand = { schemaVersion: 1, commandType: 'RegisterWorkspace', commandId: 'register-one', identity: { projectId, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'register-one' }, workspaceId: scope.workspaceId, bindingDigest: 'a'.repeat(64), expectedProjectRevision: 1, correlationId: 'register-one', submittedAt: at };
  try {
    expect(await h.control.registerWorkspace(command)).toMatchObject({ status: 'rejected' });
    const bootstrap = buildBootstrapCommand({ schemaVersion: 1, entries: [{ projectId, workspaceId: 'main' }] }, { commandId: 'boot', correlationId: 'boot', submittedAt: at });
    const original = await h.bootstrap(bootstrap); expect(original.status).toBe('committed');
    expect(await h.control.registerWorkspace({ ...command, identity: { ...command.identity, actor: { kind: 'system', id: 'automatic-sharing' } } })).toMatchObject({ status: 'rejected', code: 'invalid_commit' });
    expect(await h.control.registerWorkspace({ ...command, expectedProjectRevision: 99 })).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await h.control.registerWorkspace(command)).toMatchObject({ status: 'committed', replayed: false });
    await h.advanceProjection(); expect(await h.consoleSummary(scope)).toMatchObject({ status: 'ready', summary: { goalCount: 0 } });
    expect(await h.collaboration.createGoal({ ...scope, goalId: 'new-workspace-goal', objective: 'New workspace stays scoped', actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'goal' })).toMatchObject({ status: 'persisted' });
    expect(await h.control.registerWorkspace({ ...command, expectedProjectRevision: 999 })).toMatchObject({ status: 'committed', replayed: true });
    expect(await h.control.registerWorkspace({ ...command, bindingDigest: 'b'.repeat(64) })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await h.bootstrap(bootstrap)).toMatchObject({ status: 'committed', replayed: true });
    const events = await h.ledger.events({ afterCursor: null, limit: 256 }); expect(events.events.filter(item => item.event.eventType === 'WorkspaceRegistered')).toHaveLength(1);
    if (persistent) {
      await persistent.close();
      const reopened = await persistent.reopen();
      try { expect(await reopened.control.registerWorkspace(command)).toMatchObject({ status: 'committed', replayed: true }); }
      finally { await reopened.close(); }
    }
  } finally { await persistent?.close(); await rm(dir, { recursive: true, force: true }); }
});
