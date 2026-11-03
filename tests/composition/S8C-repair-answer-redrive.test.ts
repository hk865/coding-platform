/**
 * The answer handed over after a repair activation records its
 * application from the activation commit's own receipt.
 *
 * W-A: a real rename repair is answered through `decisions/queue` ->
 * `decisions/card` -> `decisions/answer` before the check PASS, so the answer
 * is stored while its application is not. The Workflow then settles the round
 * PASS and the real `complete_task` step activates the note and hands the
 * unapplied answer back through the same advance. The application must read
 * `applied` from the `s4-note-activate:` receipt, not
 * `application_not_recorded`; replaying the SAME `decisions/answer` request
 * writes no second revision and keeps the activation cursor. No receipt, pin,
 * round or context is built by hand.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS8CRepairWorld, plain, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';

const worlds: S8CRepairWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function readCard(world: S8CRepairWorld, source: DecisionCardV1['source']): Promise<DecisionCardV1> {
  const body = await world.main.route('decisions/card', { source }) as
    { status?: string; value?: DecisionCardV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`the card is not readable: ${JSON.stringify(body)}`);
  }
  return body.value;
}

async function answerRepairCard(world: S8CRepairWorld, card: DecisionCardV1, requestId: string):
Promise<ResolveDecisionReadV1> {
  const saved = await readCard(world, card.source);
  const body = await world.main.post('decisions/answer', graphWrite(world.main.scope, {
    source: saved.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
  }, requestId, saved.source.pins)) as { status?: string; value?: ResolveDecisionReadV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`the answer ${requestId} is not ready: ${JSON.stringify(body)}`);
  }
  return body.value;
}

/** The public architecture read's own commit cursor for the current catalog row. */
async function catalogSince(world: S8CRepairWorld): Promise<string> {
  const read = await world.world.platform.architecture.readArchitectureRevision(world.world.humanContext(),
    { selection: { kind: 'current' } });
  if (read.status !== 'ready' || read.value.catalog.since === null) {
    throw new Error(`the catalog cursor is not readable: ${JSON.stringify(read)}`);
  }
  return read.value.catalog.since;
}

describe('the repair answer handed over after activation', () => {
  it('records the application from the activation receipt and replays without a second revision', async () => {
    const world = await openS8CRepairWorld({ label: 'redrive' });
    worlds.push(world);
    const before = await world.readCatalog();
    const staged = await world.writeRepair({ ops: [{ op: 'set_module_name', moduleId: 's6a-core',
      name: 'S6A core renamed' }] });
    expect(staged.version).toBe(1);

    // The rename needs the card before PASS; the answer is stored, its
    // application is not (the bound round is not a settled PASS yet).
    const card = (await world.main.readCards(world.goal))
      .find(entry => entry.source.kind === 'repair_approval');
    if (card === undefined) throw new Error('the repair_approval card is missing');
    expect(card.state).toBe('waiting_answer');
    const answered = await answerRepairCard(world, card, 'redrive-answer');
    expect(answered.answer.status).toBe('committed');
    expect(answered.state).toBe('answered');
    expect(answered.application).toBeNull();
    expect(await world.readCatalog()).toBe(before);
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });

    const outcome = await world.pass(staged);
    expect(outcome.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    if (outcome.next === null || outcome.next.kind !== 'perform'
      || outcome.next.operation.kind !== 'complete_task') {
      throw new Error(`the PASS did not stop before complete_task: ${JSON.stringify(outcome.next)}`);
    }
    expect((await readCard(world, card.source)).state).toBe('answered_pending_application');

    // The real `complete_task` step activates the repair and hands the answer
    // back; its application is now recorded from the activation receipt.
    await world.world.post('workflow/advance', plain(S6A_SCOPE, outcome.next));
    expect(await world.readCatalog()).toBe(before + 1);
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
    const activationCursor = await catalogSince(world);
    const appliedCard = await readCard(world, card.source);
    expect(appliedCard.state).toBe('applied');
    expect(appliedCard.application).toMatchObject({
      receipt: { identityKey: expect.stringMatching(/^s4-note-activate:/), cursor: activationCursor },
      changes: [{ after: { revision: 2 } }],
    });

    // The same answer request replays the original application: one revision,
    // the same activation cursor, and the application stays committed.
    const replay = await answerRepairCard(world, card, 'redrive-answer');
    expect(replay.answer.status).toBe('committed');
    expect(replay.application).toMatchObject({ status: 'committed' });
    expect(replay.state).toBe('applied');
    expect(await world.readCatalog()).toBe(before + 1);
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
    expect(await catalogSince(world)).toBe(activationCursor);
    expect((await readCard(world, card.source)).state).toBe('applied');
  });
});
