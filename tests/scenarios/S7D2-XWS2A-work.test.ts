/**
 * XWS2A rows XA-09 and XA-11: the join survives a Host restart, and a person still cannot send across
 * workspaces. (XA-07, XA-08 and XA-10 wait for A2; their text is `.dsh-ref/xa/a2-deferred-rows.ts.txt`.)
 *
 * The world is `tests/helpers/XWS2A-world.ts`; every state is a public step and every read is a public route.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { xws2aJoinRef, type XWS2AJoinRow } from '../helpers/XWS2A-world.js';
import { openXWS2AWorld, type XWS2AWorld } from '../helpers/XWS2A-world.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const worlds: XWS2AWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

async function opened(options: Parameters<typeof openXWS2AWorld>[0] = { backend: 'memory' }): Promise<XWS2AWorld> {
  const world = await openXWS2AWorld(options);
  worlds.push(world);
  return world;
}

describe('XWS2A: the join survives a restart and a person still cannot cross workspaces', () => {
  it('XA-09 a Host restart resumes the one join at its saved phase without a second exploration', async () => {
    const world = await opened({ backend: 'sqlite' });
    const before = await world.waitCoarseAnswered();
    const ids = (before.explorations ?? []).map(entry => `${entry.queryRunRef.queryJobId}:${entry.queryRunRef.runId}`);
    await world.base.world.crash();
    const readJoin = async (): Promise<XWS2AJoinRow | null> => {
      try { return await world.join(); } catch { return null; }
    };
    const after = await waitFor(readJoin, row => row !== null, 'the join after the Host restart');
    expect(after!.operation).toEqual(xws2aJoinRef(P, world.second.scope.workspaceId));
    expect(after!.operation.operationId).toBe(xws2aJoinRef(P, world.second.scope.workspaceId).operationId);
    expect(after!.actionPhase).toBe(before.actionPhase);
    expect(after!.phase).toBe(before.phase);
    expect((after!.explorations ?? []).map(entry =>
      `${entry.queryRunRef.queryJobId}:${entry.queryRunRef.runId}`)).toEqual(ids);
    const rows = await world.operations(world.second.scope);
    expect(rows.filter(row => row.action === 'role_line'
      && row.operation.operationId === xws2aJoinRef(P, world.second.scope.workspaceId).operationId)).toHaveLength(1);
  }, 240_000);

  it('XA-11 a person still cannot send across workspaces', async () => {
    const world = await opened();
    const secondCtx: CoreCallContext = world.secondCtx();
    void secondCtx;
    const created = await world.second.workspace.post('sessions/create',
      plain(world.second.scope, {
        workspace: world.second.scope, role: S6A_WORK_ROLE, recommendedRefs: [], initialLinks: [],
        meta: { requestId: 'xws2a-second-line', expected: [] },
      })) as { status: string; value?: { ref: SessionRef } };
    // `sessions/create` answers its own completed shape, not a graph write's `committed`.
    expect(created.status).toBe('completed');
    // `messages/send` takes the plain SessionRef, not the create response's aggregate ref.
    const target: SessionRef = { projectId: created.value!.ref.projectId, sessionId: created.value!.ref.sessionId };
    const sent = await world.base.world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: target, text: 'XWS2A: a person may not cross workspaces', intent: 'notify',
    }, 'xws2a-person-cross-workspace', []));
    const answer = sent.body as { status: string; code?: string; reason?: string };
    expect(answer.status).toBe('rejected');
    expect(['not_found', 'forbidden']).toContain(answer.code);
    const inbox = valueOf<{ items: SessionMessage[] }>((await world.base.world.post('messages/inbox',
      plain(world.second.scope, { recipient: target, page: { limit: 50 } }))).body, 'ready',
    'the second line inbox').items;
    expect(inbox).toEqual([]);
  }, 120_000);
});
