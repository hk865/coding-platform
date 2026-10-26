/**
 * H-B primitive rows: the `existing` target, a partial handoff, one assignment with two real tasks, and the saved
 * transfer read. The fixture's step 4 driver is late-binding, so these rows drive the real advance service and the real
 * responsibility child directly; they never build a Workflow, a record or a stage.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { SavedTransferInputV1 } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { transferPinsOf } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { seedS6BHandoffLines } from '../helpers/S6B1-fixture.js';
import { s6b2Advance, s6b2Scene, s6b2Workspace, type S6B2Captured } from '../helpers/S6B2-handoff-scene.js';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealInMemory(captured,
    await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>()));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealSqlite(captured,
    await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>()));

const scene = s6b2Scene();
afterAll(() => scene.closeAll());

describe('existing target and the partial handoff', () => {
  it('moves one task, keeps the first receipt when the second fails, and never archives the source', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const lines = await seedS6BHandoffLines(ws, world.goals.first);
    const advance = s6b2Advance(world, captured);
    const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
      commandId: 's6b-existing-accept', workspace: { ...S6A_SCOPE }, source: lines.source.ref, trigger: 'manual',
      assignments: [{ target: { kind: 'existing', session: lines.target.ref }, tasks: lines.tasks.slice(0, 2) }],
    });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    const operation = accepted.value.operation;
    let revision = 1;
    const step = async () => {
      const result = await advance.advanceHandoff(world.humanContext(),
        { kind: 'continue', operation, expectedRevision: revision });
      if (result.status !== 'committed') throw new Error(`advance failed: ${JSON.stringify(result)}`);
      revision = result.value.revision;
      return result.value;
    };
    // fence -> wait/stopped -> recheck -> existing successor.
    for (let index = 0; index < 4; index += 1) await step();
    let value = await step();
    expect(value.write.stage).toBe('transfer');
    expect(value.write.phase).toBe('before');
    expect(value.write.item).toBe('transfer:0:0');
    const firstSaved = value.write.savedInput;
    expect(firstSaved?.kind).toBe('transfer');
    if (firstSaved?.kind !== 'transfer') return;
    const pins = transferPinsOf(firstSaved);
    expect(pins[0]?.ref).toMatchObject({ sessionId: lines.source.ref.sessionId });
    expect(pins[1]?.ref).toMatchObject({ sessionId: lines.target.ref.sessionId });
    const firstWrite: GraphWrite<{ from: typeof firstSaved.from; to: typeof firstSaved.to;
      target: typeof firstSaved.target }> = { input: { from: firstSaved.from, to: firstSaved.to,
      target: firstSaved.target }, meta: { requestId: firstSaved.requestId, expected: transferPinsOf(firstSaved) } };
    const firstChild = await world.platform.responsibilities.transferSessionResponsibility(world.humanContext(), firstWrite);
    expect(firstChild.status).toBe('committed');

    value = await step();
    expect(value.write.stage).toBe('transfer');
    expect(value.write.phase).toBe('after');
    expect(value.write.receipt).not.toBeNull();
    const firstReceipt = value.write.receipt;
    value = await step();
    expect(value.write.item).toBe('transfer:0:1');
    const secondSaved = value.write.savedInput;
    if (secondSaved?.kind !== 'transfer') return;
    const secondWrite: GraphWrite<{ from: typeof secondSaved.from; to: typeof secondSaved.to;
      target: typeof secondSaved.target }> = { input: { from: secondSaved.from, to: secondSaved.to,
      target: secondSaved.target }, meta: { requestId: secondSaved.requestId, expected: transferPinsOf(secondSaved) } };
    const failedRevision = revision;
    value = await step();
    // The child is not called, so it has not committed: its saved before write comes back unchanged and nothing is
    // written, so the same owner is called again with that arm instead of an empty after receipt.
    expect(value.write).toMatchObject({ stage: 'transfer', item: 'transfer:0:1', phase: 'before',
      savedInput: secondSaved, receipt: null });
    expect(value.stop).toBe('replayed');
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready' || read.value.action.kind !== 'handoff') return;
    const progress = read.value.action.progress;
    expect(read.value.phase).toBe('running');
    expect(read.value.revision).toBe(failedRevision);
    expect(progress.lastRefusal).toBeNull();
    expect(progress.assignments[0]?.transfers[0]?.receipt).toEqual(firstReceipt);
    expect(progress.assignments[0]?.transfers[1]?.receipt).toBeNull();
    expect(progress.archiveRequest).toBeNull();
    const sourceCard = await world.readSession(lines.source.ref);
    expect(sourceCard.links.some(link => link.until === null && link.ref.relation === 'responsible'
      && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === lines.tasks[1]!.taskId)).toBe(true);

    // The real child is called now and records its receipt; the first receipt stays.
    const retry = await world.platform.responsibilities.transferSessionResponsibility(world.humanContext(), secondWrite);
    expect(retry.status).toBe('committed');
    value = await step();
    expect(value.write.phase).toBe('after');
    expect(value.write.receipt).not.toBeNull();
  }, 120_000);
});
