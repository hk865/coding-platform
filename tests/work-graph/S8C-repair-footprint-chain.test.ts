/**
 * 8C G3 R5a/R5b/R5c — the real footprint chain on W-A.
 *
 * The staged repair is written by the real `record_note` tool of a scripted
 * Work Run, the real Workflow settles the check round PASS and the real
 * `complete_task` advance is the activation trigger. The answer is the real
 * `decisions/answer`; the queue and the card are the platform's own reads. The
 * activity shape has two real arms: `dropRunActivity` removes the RunActivity
 * record at its real end commit (missing footprint), and a real `shell` call in
 * the Run produces a counted activity with `command_ran` (incomplete footprint).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RunActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  openS8CRepairWorld, plain, type S8CHeldRepair, type S8CRepairOutcome, type S8CRepairWorld,
  type S8CStagedRepair,
} from '../helpers/S8C-repair-world.js';
import { runView } from '../helpers/PL-readings-fixture.js';

const worlds: S8CRepairWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function world(label: string, dropRunActivity = true, shell = false): Promise<S8CRepairWorld> {
  const opened = await openS8CRepairWorld({ label, dropRunActivity, shell });
  worlds.push(opened);
  return opened;
}

const small = [{ op: 'set_responsibility' as const, moduleId: 's6a-core', text: 'S8C repaired core' }];

function repairCards(cards: readonly DecisionCardV1[]): DecisionCardV1[] {
  return cards.filter(card => card.source.kind === 'repair_approval');
}

async function answerRepair(world: S8CRepairWorld, card: DecisionCardV1, optionId: 'approve' | 'reject',
  requestId: string): Promise<ResolveDecisionReadV1> {
  const body = await world.main.post('decisions/answer', graphWrite(world.main.scope, {
    source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [],
  }, requestId, card.source.pins)) as { status?: string; value?: ResolveDecisionReadV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`S8C R5: the answer ${requestId} is not ready: ${JSON.stringify(body)}`);
  }
  return body.value;
}

async function completeTask(world: S8CRepairWorld, outcome: S8CRepairOutcome): Promise<void> {
  if (outcome.next === null || outcome.next.kind !== 'perform' || outcome.next.operation.kind !== 'complete_task') {
    throw new Error(`S8C R5: the PASS did not stop before complete_task: ${JSON.stringify(outcome.next)}`);
  }
  await world.world.post('workflow/advance', plain(S6A_SCOPE, outcome.next));
}

function notePin(world: S8CRepairWorld, staged: S8CStagedRepair) {
  return { ref: { aggregateType: 'NoteHead', projectId: world.goal.projectId, noteId: staged.noteId },
    revision: staged.version };
}

const extraModule = (projectId: string) => ({ op: 'add_module' as const, module: {
  ref: { projectId, moduleId: 's8c-extra' }, name: 'S8C extra', responsibility: 'S8C extra module',
  paths: ['docs'], interfaces: [] } });

describe('S8C R5a/R5b approve against the real footprint', () => {
  it('R5a: a real approve of an unknown-footprint PASS repair activates it once', async () => {
    const w = await world('r5a-approve-unknown');
    const before = await w.readCatalog();
    const staged = await w.writeRepair({ ops: [extraModule(w.goal.projectId)] });
    expect(staged.version).toBe(1);
    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });

    const cards = repairCards(await w.main.readCards(w.goal));
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card).toMatchObject({ state: 'waiting_answer',
      source: { kind: 'repair_approval', pins: [notePin(w, staged)], goalBases: [] } });
    const answered = await answerRepair(w, card, 'approve', 's8c-r5a-answer');
    // The answer adapter applies the approval through the same activation owner:
    // the settled PASS plus the approved unknown footprint is an activation, not
    // a stored-but-unapplied answer.
    expect(answered).toMatchObject({ state: 'applied' });
    expect(await w.readCatalog()).toBe(before + 1);
    expect(await w.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });

    // The real complete_task advance still calls the same activation owner; the
    // identical `activate:<noteId>:<version>` command replays, never a second revision.
    await completeTask(w, passed);
    expect(await w.readCatalog()).toBe(before + 1);
    expect(await w.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
    expect(await w.owner.activateRepair(w.world.humanContext(), {
      commandId: `activate:${staged.noteId}:${staged.version}`,
      noteId: staged.noteId, expectedVersion: staged.version,
    })).toMatchObject({ status: 'activated', noteId: staged.noteId, version: 2 });
    expect(await w.readCatalog()).toBe(before + 1);
  });

  it('R5b: approve does not clear a proven outside literal path', async () => {
    const w = await world('r5b-approve-outside', false);
    const before = await w.readCatalog();
    const staged = await w.writeRepair({ ops: [
      extraModule(w.goal.projectId),
      { op: 'add_path', moduleId: 's6a-core', path: 'tsconfig.json' },
    ] });
    expect(staged.version).toBe(1);
    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });

    const cards = repairCards(await w.main.readCards(w.goal));
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    const answered = await answerRepair(w, card, 'approve', 's8c-r5b-answer');
    expect(answered.state).toBe('answered');

    await completeTask(w, passed);
    expect(await w.owner.activateRepair(w.world.humanContext(), {
      commandId: `activate:${staged.noteId}:${staged.version}`,
      noteId: staged.noteId, expectedVersion: staged.version,
    })).toMatchObject({ status: 'forbidden', reason: 'outside_footprint', paths: ['tsconfig.json'] });
    expect(await w.readCatalog()).toBe(before);
    expect(await w.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });
  });
});

describe('S8C R5c a running Run without a bound round has no card', () => {
  it('R5c: a held running Run has no repair_approval card; after PASS with an unknown footprint it has one', async () => {
    const w = await world('r5c-running-run');
    const held: S8CHeldRepair = await w.writeRepairHeld({ ops: small });
    expect(held.version).toBe(1);
    // The note is staged, the Run is still running at its held model request and
    // no check round binds the note: the queue must not project a card.
    expect(repairCards(await w.main.readCards(w.goal))).toHaveLength(0);

    const staged = await held.release();
    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    const cards = repairCards(await w.main.readCards(w.goal));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.source).toMatchObject({ kind: 'repair_approval', pins: [notePin(w, staged)] });
  });
});

describe('S8C R5d the real shell Run footprint', () => {
  it('R5d: a Run that ran shell is counted possiblyIncomplete and cards the repair after PASS', async () => {
    // A real shell call in the same Run: the Run keeps its real RunActivity
    // record (`dropRunActivity: false`), so the footprint is not missing but
    // incomplete (`command_ran`). The Work binding gets the Host's real shell
    // grant through the configured Host factory; no fixture file is changed.
    const w = await world('r5d-shell-incomplete', false, true);
    const staged = await w.writeRepair({ ops: small, shell: true });
    expect(staged.version).toBe(1);

    const runs = await w.main.route('activity/runs', { runRefs: [staged.run] }) as
      { status?: string; value?: RunActivityViewV1[] };
    expect(runs.status).toBe('ready');
    const view = runView(runs.value ?? [], staged.run);
    expect(view.status).toBe('counted');
    expect(view.changedFiles).toMatchObject({ possiblyIncomplete: true });

    // The round is not bound yet, so the counted incomplete footprint alone
    // does not card the repair.
    expect(repairCards(await w.main.readCards(w.goal))).toHaveLength(0);

    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });

    const card = await w.readRepairCard();
    expect(card).toMatchObject({ state: 'waiting_answer',
      source: { kind: 'repair_approval', pins: [notePin(w, staged)], goalBases: [] } });
    expect(card.options.map(option => option.id)).toEqual(['approve', 'reject']);
  });
});
