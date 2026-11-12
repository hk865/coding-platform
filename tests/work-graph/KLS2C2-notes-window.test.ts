/**
 * D13 (2c-2 start ruling 5): a queue window's notes read moves only on a `pending` write of a note it reads (2c-1d);
 * a person's note committed and not landed that no card reads leaves the decision queue ready. Platform level, memory:
 * `openKLS2AWorld` with `armedSeam` (A2); the waiting review from the world's real executor Run. An architecture write
 * in flight has no such read: the queue reads the conflicts' architecture first and is refused whole there (R4).
 */
import { afterEach, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { armedSeam } from '../helpers/KLS2C-knowledge-host.js';

const releases: (() => void)[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const close of closers.splice(0).reverse()) await close();
});

const draftNote = (topic: string, over: Partial<NoteDraftV1> = {}): NoteDraftV1 => ({ kind: 'decision', topic,
  conclusion: `${topic} 的结论`, body: 'b', anchor: { kind: 'module', moduleId: 'core' }, extraAnchors: [], facts: [],
  basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], ...over }) as NoteDraftV1;
const writeAs = (world: KLS2AWorld, commandId: string, note: NoteDraftV1, by: 'host' | 'work_run'): Promise<WriteNoteResult> =>
  world.platform.notes.writeNote(world.ctx(by), { commandId, note, expectedPointerRevision: null,
    goalId: world.goalRef.goalId });
/** The waiting review cards' notes (each card's first object). */
const reviewedNotes = (read: DecisionQueueReadV1): string[] => read.waitingAnswer.flatMap(card => {
  const subject = card.objects[0];
  return card.source.kind === 'note_review' && subject?.kind === 'aggregate' ? [(subject.pin.ref as { noteId: string }).noteId] : [];
});

it('D13 a person\'s note committed and not landed, which no card reads, leaves the decision queue ready with the '
  + 'waiting card', async () => {
  const seam = armedSeam('committed');
  const world = await openKLS2AWorld({ platform: { knowledgeWriteHold: seam.seam } });
  closers.push(() => world.close());
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls2c2-d13-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls2c2-d13', description: 'd', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: [{ ref: { projectId: world.projectId, moduleId: 'core' }, name: 'core', responsibility: 'own core',
        paths: ['src/core'], interfaces: [] }] } } });
  if (adopted.status !== 'committed') throw new Error(`KLS2C2: the adoption did not commit: ${JSON.stringify(adopted)}`);
  await world.claimExecutorRun();
  const person = await writeAs(world, 'kls2c2-d13-a', draftNote('kls2c2-d13-a'), 'host');
  const waiting = person.status !== 'accepted' ? person
    : await writeAs(world, 'kls2c2-d13-p', draftNote('kls2c2-d13-p', { contradicts: [person.noteId] }), 'work_run');
  if (waiting.status !== 'pending_review') throw new Error(`KLS2C2: no waiting review: ${JSON.stringify([person, waiting])}`);
  const gate = seam.hold();
  releases.push(gate.release);
  const aside = writeAs(world, 'kls2c2-d13-aside', draftNote('kls2c2-d13-aside',
    { anchor: { kind: 'file', path: 'README.md' } }), 'host');
  aside.catch(() => undefined);
  const stopped = await Promise.race([gate.reached.then(() => 'held'), aside.then(() => 'answered', () => 'answered')]);
  if (stopped !== 'held') throw new Error(`KLS2C2: the aside note was not held after its commit: ${JSON.stringify(await aside)}`);
  const read = await world.platform.decisions.queryDecisionQueue(world.ctx(), { workspace: { projectId: world.projectId,
    workspaceId: world.workspaceId }, sections: ['waiting_answer'], page: { limit: 100 } });
  // 具名改坏：注记窗看这条线上任何在途写（prepareNoteFiles 的“写日志是本窗注记的”改成“有在途写”）→ 红在这一句。
  expect(read).toMatchObject({ status: 'ready' });
  expect(reviewedNotes((read as { value: DecisionQueueReadV1 }).value)).toEqual([waiting.noteId]);
  gate.release();
  expect(await aside).toMatchObject({ status: 'accepted' });
});
