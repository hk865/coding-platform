import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

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
    expect(Object.keys(platform).sort()).toEqual(['architecture', 'claims', 'close', 'executions', 'goals', 'materials', 'plans', 'roles', 'runtime', 'sessions', 'workflow', 'workspace']);
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
    expect(await platform.workflow.handleGoalInput(ctx, {
      meta: { requestId: 'workflow-not-yet-ready', expected: [] },
      goal: { goalId: 'goal-1', workspace: { projectId: workspace.projectId, workspaceId: workspace.workspaceId }, objective: 'Do work' },
      requestBodyRef: stored.ref, text: 'Do work', action: { kind: 'request_work', executeWithinRequest: false },
    })).toMatchObject({ status: 'rejected', code: 'unsupported' });
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
