/**
 * The create arm beside the handoff arm (row 5, memory): a line's creation stores the operation's workspace and no
 * parent handoff, and the operation read answers each record's own arm, so its readers judge the kind first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6ARequestWorld, S6A_SCOPE, S6A_WORK_ROLE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { createS6BLine, governS6B, seedS6BHandoffLines } from '../helpers/S6B1-fixture.js';

let world: S6ARequestWorld | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

describe('S6B the create arm and the operation read', () => {
  it('stores no parent on a creation and answers the handoff arm as a handoff', async () => {
    world = await openS6ARequestWorld({ backend: 'memory' });
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, world.goals);
    const lines = await seedS6BHandoffLines(ws, world.goals.first);
    const creation = { status: 'ready', value: { ref: lines.target.operation, revision: 2, workspaceId: S6A_SCOPE.workspaceId,
      phase: 'completed', action: { kind: 'create', parentOperation: null, workspace: S6A_SCOPE, role: S6A_WORK_ROLE,
        consultation: null } } };
    expect(await ws.route('sessions/operation', lines.target.operation)).toMatchObject(creation);

    const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), { commandId: 's6b-arm',
      workspace: { ...S6A_SCOPE }, source: lines.source.ref, trigger: 'manual',
      assignments: [{ target: { kind: 'existing', session: lines.target.ref }, tasks: lines.tasks }] });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    expect(await ws.route('sessions/operation', accepted.value.operation)).toMatchObject({ status: 'ready', value: {
      ref: accepted.value.operation, revision: 1, workspaceId: S6A_SCOPE.workspaceId, phase: 'accepted', observation: null,
      action: { kind: 'handoff', input: { source: lines.source.ref, trigger: 'manual' }, progress: { stage: 'accepted' } } } });

    // A line created after the accept is still a plain creation.
    const later = await createS6BLine(ws, { label: 's6b-after-handoff', role: S6A_WORK_ROLE });
    expect(await ws.route('sessions/operation', later.operation)).toMatchObject({ ...creation,
      value: { ...creation.value, ref: later.operation } });
  }, 120_000);
});
