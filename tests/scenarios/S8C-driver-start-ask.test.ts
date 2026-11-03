/**
 * R7a (8C G5): under `ask`, the person's `workflow/driver-start` activates the
 * staged repair that a crash left behind.
 *
 * W-A on SQLite: a real rename (`set_module_name`, a card-bearing repair that
 * deletes no module) is answered through the real `decisions/queue → card →
 * decisions/answer` before the check PASS, so the answer's application is not
 * recorded yet. The Workflow then finalises PASS and its `complete_task` commit
 * lands while its return is held (A3 `holdAfter`, matched by the commit's
 * `r3e-complete-task:` identity, never a `complete_task:` request id); the Host
 * is crashed, so the activation in that arm has not run. With `ask` the start-up
 * scan is skipped: the card still reads `answered_pending_application`, the note
 * is still staged and the catalog revision unchanged. The person's
 * `workflow/driver-start` reaches `startHandle`, which activates once; a second
 * start and two replays of the SAME `decisions/answer` request write no second
 * revision. No record, pin, receipt or context is built by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { waitDriver } from '../helpers/DRV-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS8CRepairWorld, plain, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S8CRepairWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

/** The Host's own `automation/save`, exactly the route its page uses. */
async function saveResumeOnStartup(world: S8CRepairWorld, mode: 'auto' | 'ask' | 'off'): Promise<void> {
  const snapshot = await world.world.settings('snapshot', {});
  if (snapshot.status !== 'ready') {
    throw new Error(`R7a: the Host settings are not readable: ${JSON.stringify(snapshot)}`);
  }
  const saved = await world.world.settings('automation/save', {
    autoReworkLimit: snapshot.value.automation.autoReworkLimit, resumeOnStartup: mode,
  });
  expect(saved.status).toBe('ready');
}

async function readCard(world: S8CRepairWorld, source: DecisionCardV1['source']): Promise<DecisionCardV1> {
  const body = await world.main.route('decisions/card', { source }) as
    { status?: string; value?: DecisionCardV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`R7a: the card is not readable: ${JSON.stringify(body)}`);
  }
  return body.value;
}

/** The person's real `decisions/answer` for the card (same body the route receives). */
async function answerRepairCard(world: S8CRepairWorld, card: DecisionCardV1, optionId: 'approve' | 'reject',
  requestId: string): Promise<ResolveDecisionReadV1> {
  const saved = await readCard(world, card.source);
  const body = await world.main.post('decisions/answer', graphWrite(world.main.scope, {
    source: saved.source, selection: { kind: 'option', optionId }, text: '', annotations: [],
  }, requestId, saved.source.pins)) as { status?: string; value?: ResolveDecisionReadV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`R7a: the answer ${requestId} is not ready: ${JSON.stringify(body)}`);
  }
  return body.value;
}

async function startDriver(world: S8CRepairWorld, flowId: string): Promise<void> {
  const body = await world.main.post('workflow/driver-start', plain(S6A_SCOPE, {
    advance: { schemaVersion: 1, goalRef: world.goal, flowId, sessionHint: null, kind: 'select_work' },
    queryProfileIds: [],
  })) as { status?: string; code?: string; reason?: string };
  if (body.status !== 'ready') {
    throw new Error(`R7a: driver-start ${flowId} was not ready: ${JSON.stringify(body)}`);
  }
}

/** The public architecture read's own commit cursor for the current catalog row. */
async function catalogSince(world: S8CRepairWorld): Promise<string> {
  const read = await world.world.platform.architecture.readArchitectureRevision(world.world.humanContext(),
    { selection: { kind: 'current' } });
  if (read.status !== 'ready' || read.value.catalog.since === null) {
    throw new Error(`R7a: the catalog cursor is not readable: ${JSON.stringify(read)}`);
  }
  return read.value.catalog.since;
}

describe('R7a (a): ask leaves the answer pending until driver-start activates it', () => {
  it('activates once at the Goal-level start and replays without a second revision', async () => {
    const world = await openS8CRepairWorld({ label: 'r7a', backend: 'sqlite' });
    worlds.push(world);
    const before = await world.readCatalog();
    const staged = await world.writeRepair({ ops: [{ op: 'set_module_name', moduleId: 's6a-core',
      name: 'S6A core renamed' }] });
    expect(staged.version).toBe(1);

    // The rename needs the card before PASS; the answer is stored, its
    // application is not (the round is not a finalised PASS yet).
    const card = (await world.main.readCards(world.goal))
      .find(entry => entry.source.kind === 'repair_approval');
    if (card === undefined) throw new Error('R7a: the repair_approval card is missing');
    expect(card.state).toBe('waiting_answer');
    const answered = await answerRepairCard(world, card, 'approve', 'r7a-answer');
    expect(answered.answer.status).toBe('committed');
    expect(answered.state).toBe('answered');
    expect(answered.application).toBeNull();
    expect(await world.readCatalog()).toBe(before);
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });

    const outcome = await world.pass(staged);
    expect(outcome.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    if (outcome.next === null || outcome.next.kind !== 'perform'
      || outcome.next.operation.kind !== 'complete_task') {
      throw new Error(`R7a: the PASS did not stop before complete_task: ${JSON.stringify(outcome.next)}`);
    }
    // The answer is still the pending application the crash must leave behind.
    expect((await readCard(world, card.source)).state).toBe('answered_pending_application');

    await saveResumeOnStartup(world, 'ask');
    const hold = commitBarrier.holdAfter(byIdentityPrefix('r3e-complete-task:'), 'R7a complete_task return');
    const driving = world.world.post('workflow/advance', plain(S6A_SCOPE, outcome.next))
      .then(() => undefined, () => undefined);
    try {
      await hold.reached;
      await world.world.crash();
      // `ask`: the start-up scan is skipped, so the staged note and the
      // answered-but-unapplied card survive the restart untouched.
      expect(await world.readCatalog()).toBe(before);
      expect(await world.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });
      expect((await readCard(world, card.source)).state).toBe('answered_pending_application');

      // The person's Goal-level start is the only activation here.
      await startDriver(world, 'r7a-driver');
      expect(await world.readCatalog()).toBe(before + 1);
      expect(await world.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
      // Before the later starts and answer replays, the start must have handed
      // the saved answer back: the card is applied and carries that receipt.
      const startedCard = await readCard(world, card.source);
      expect(startedCard.state).toBe('applied');
      expect(startedCard.answerMessageRef).not.toBeNull();
      expect(startedCard.application).toMatchObject({
        receipt: { identityKey: expect.stringMatching(/^s4-note-activate:/) },
        changes: [{ after: { revision: 2 } }],
      });
      const activationCursor = await catalogSince(world);

      // A second press, same seed: the start is a replay, no second revision.
      await waitDriver(world.world, world.goal, undefined,
        snapshot => snapshot.state !== 'running' && snapshot.state !== 'stopping', 'the Goal driver to settle');
      await startDriver(world, 'r7a-driver');
      expect(await world.readCatalog()).toBe(before + 1);
      expect(await world.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
      expect(await catalogSince(world)).toBe(activationCursor);

      // The same `decisions/answer` request twice: the original source pins are
      // the ones the first answer stored, and the activation replay keeps the
      // one revision (G5-05's receipt mutations have no second revision).
      for (let replay = 0; replay < 2; replay += 1) {
        const body = await world.main.post('decisions/answer', graphWrite(world.main.scope, {
          source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
        }, 'r7a-answer', card.source.pins)) as { status?: string; value?: ResolveDecisionReadV1 };
        expect(body.status).toBe('ready');
        expect(body.value?.answer.status).toBe('committed');
      }
      expect(await world.readCatalog()).toBe(before + 1);
      expect(await world.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
      expect(await catalogSince(world)).toBe(activationCursor);
    } finally {
      hold.release();
      await driving;
    }
  });

  it('R7a (b): under ask, a no-answer small repair waits for driver-start and replays there', async () => {
    const world = await openS8CRepairWorld({ label: 'r7a-auto', backend: 'sqlite' });
    worlds.push(world);
    const before = await world.readCatalog();
    const staged = await world.writeRepair({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core',
      text: 'R7a auto repaired core' }] });
    expect(staged.version).toBe(1);
    // A small repair at the auto level needs no card, so this variant has no
    // answer to hand back: only the start's own retry can activate it.
    expect((await world.main.readCards(world.goal))
      .filter(entry => entry.source.kind === 'repair_approval')).toEqual([]);

    const outcome = await world.pass(staged);
    expect(outcome.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    if (outcome.next === null || outcome.next.kind !== 'perform'
      || outcome.next.operation.kind !== 'complete_task') {
      throw new Error(`R7a (b): the PASS did not stop before complete_task: ${JSON.stringify(outcome.next)}`);
    }

    await saveResumeOnStartup(world, 'ask');
    const hold = commitBarrier.holdAfter(byIdentityPrefix('r3e-complete-task:'), 'R7a auto complete_task return');
    const driving = world.world.post('workflow/advance', plain(S6A_SCOPE, outcome.next))
      .then(() => undefined, () => undefined);
    try {
      await hold.reached;
      await world.world.crash();
      // `ask` skips the start-up scan and the held arm never reached the
      // retry, so the new Host starts with the note still staged.
      expect(await world.readCatalog()).toBe(before);
      expect(await world.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });

      // The person's start is the direct `attemptRepairsForGoal` retry.
      await startDriver(world, 'r7a-auto-driver');
      expect(await world.readCatalog()).toBe(before + 1);
      expect(await world.readNote(staged.noteId)).toMatchObject({
        version: 2, storedState: 'accepted', confirmedByUser: false });
      const activationCursor = await catalogSince(world);

      // A second press, same seed: the start is a replay, no second revision.
      await waitDriver(world.world, world.goal, undefined,
        snapshot => snapshot.state !== 'running' && snapshot.state !== 'stopping', 'the Goal driver to settle');
      await startDriver(world, 'r7a-auto-driver');
      expect(await world.readCatalog()).toBe(before + 1);
      expect(await world.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
      expect(await catalogSince(world)).toBe(activationCursor);
    } finally {
      hold.release();
      await driving;
    }
  });
});
