/**
 * KLS-2c-1d (split ruling 11-12 §7, lead after the merge). A knowledge write whose records committed and whose files
 * have not all landed leaves its write logs `pending`: a current architecture read (`architecture/read`, and the
 * conflicts window and the decision queue reading through it) that meets an architecture or module file's log on a
 * line it reads answers `unavailable` (no waiting), and a writer on that line is refused with "有未确认的知识写"; an
 * `unconfirmed` log (a recovery item 2c-1b1's reconciliation handed to the person) stops neither. The notes window
 * moves on the log of a note it reads (R2, the builder's D-2 moved here; lead after the merge). The decision queue
 * isolates one bad note instead of failing whole. Platform level, memory
 * (business rows, S3): `openKLS2AWorld` with the Host's `knowledgeWriteHold` seam armed by the row (`armedSeam`):
 * `hold()` keeps one write between its commit and its first file, `fail()` stops one there for good. Waiting
 * reviews come from the world's real executor Run; the project notice from the platform's one notice writer.
 * Every assertion reads a public answer or the files.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { armedSeam } from '../helpers/KLS2C-knowledge-host.js';

const releases: (() => void)[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const close of closers.splice(0).reverse()) await close();
});

async function knowledgeWorld(seam?: ReturnType<typeof armedSeam>): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld(seam === undefined ? {} : { platform: { knowledgeWriteHold: seam.seam } });
  closers.push(() => world.close());
  return world;
}

const NOTICE = 'KLS2C1 的项目通知';
const notePath = (noteId: string): string => `.workbench/notes/ws/${noteId}.md`;
const note = (topic: string, over: Partial<NoteDraftV1> = {}): NoteDraftV1 => ({ kind: 'decision', topic,
  conclusion: `${topic} 的结论`, body: 'b', anchor: { kind: 'module', moduleId: 'core' }, extraAnchors: [], facts: [],
  basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], ...over }) as NoteDraftV1;
const fileNote = (topic: string, path: string): NoteDraftV1 => note(topic, { anchor: { kind: 'file', path } });

function write(world: KLS2AWorld, commandId: string, draft: NoteDraftV1, by: 'host' | 'work_run' = 'host'):
  Promise<WriteNoteResult> {
  return world.platform.notes.writeNote(world.ctx(by), { commandId, note: draft, expectedPointerRevision: null,
    goalId: world.goalRef.goalId });
}

const scope = (world: KLS2AWorld) => ({ projectId: world.projectId, workspaceId: world.workspaceId });
const queueRead = (world: KLS2AWorld) => world.platform.decisions.queryDecisionQueue(world.ctx(),
  { workspace: scope(world), sections: ['waiting_answer', 'notices'], page: { limit: 100 } });
async function readyQueue(world: KLS2AWorld): Promise<DecisionQueueReadV1> {
  const read = await queueRead(world);
  expect(read, JSON.stringify(read)).toMatchObject({ status: 'ready' });
  return (read as { value: DecisionQueueReadV1 }).value;
}
/** A review card's note (its first object); the waiting review cards' notes, sorted; the project notices' summaries. */
function subjectOf(card: DecisionCardV1): string | null {
  const subject = card.objects[0];
  return card.source.kind === 'note_review' && subject?.kind === 'aggregate'
    ? (subject.pin.ref as { noteId: string }).noteId : null;
}
const reviewed = (read: DecisionQueueReadV1): string[] => read.waitingAnswer.flatMap(card => subjectOf(card) ?? []).sort();
const noticed = (read: DecisionQueueReadV1): string[] =>
  read.notices.filter(item => item.category === 'project_notice').map(item => item.summary);

async function architecture(world: KLS2AWorld) {
  const read = await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
  if (read.status !== 'ready') throw new Error(`KLS2C1: the architecture is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function adoptCore(world: KLS2AWorld): Promise<void> {
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls2c1-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls2c1-baseline', description: 'd', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: [{ ref: { projectId: world.projectId, moduleId: 'core' }, name: 'core', responsibility: 'core 的旧职责',
        paths: ['src/core'], interfaces: [] }] } } });
  if (adopted.status !== 'committed') throw new Error(`KLS2C1: the adoption did not commit: ${JSON.stringify(adopted)}`);
}

async function revise(world: KLS2AWorld, text: string) {
  const current = await architecture(world);
  return world.platform.architecture.reviseArchitectureCatalog(world.ctx(), {
    meta: { requestId: 'kls2c1-revise', expected: await world.scopePins() },
    input: { expected: { catalogRef: current.catalog.ref,
      baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } },
    ops: [{ op: 'set_responsibility', moduleId: 'core', text }], responsibilityMoves: [], reason: 'KLS2C1 R1' } });
}

/**
 * The queue rows' world: n person's notes `a1…an` on `core`, n executor notes `p1…pn` each contradicting its `a`
 * (waiting for review, each a card), and one project notice; the queue then reads ready with all of them.
 */
async function reviewWorld(world: KLS2AWorld, n: number):
  Promise<{ person: string[]; pending: string[]; cards: DecisionCardV1[] }> {
  await adoptCore(world);
  await world.claimExecutorRun();
  const person: string[] = [];
  const pending: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const a = await write(world, `kls2c1-a${i}`, note(`kls2c1-a${i}`));
    const p = a.status === 'rejected' ? a
      : await write(world, `kls2c1-p${i}`, note(`kls2c1-p${i}`, { contradicts: [a.noteId] }), 'work_run');
    if (a.status !== 'accepted' || p.status !== 'pending_review') {
      throw new Error(`KLS2C1: a${i}/p${i} are not a person's note and its waiting review: ${JSON.stringify([a, p])}`);
    }
    person.push(a.noteId);
    pending.push(p.noteId);
  }
  const notice = await world.platform.projectNoticeWriter({ projectRef: { projectId: world.projectId },
    kind: 'automatic_adjustment', summary: NOTICE,
    operation: { aggregateType: 'CoreOperation', projectId: world.projectId, operationId: 'kls2c1-notice' } });
  const before = await queueRead(world);
  if (notice.status !== 'committed' || before.status !== 'ready'
    || JSON.stringify([reviewed(before.value), noticed(before.value)]) !== JSON.stringify([[...pending].sort(), [NOTICE]])) {
    throw new Error(`KLS2C1: the review world's queue is not as built: ${JSON.stringify([notice, before])}`);
  }
  return { person, pending, cards: before.value.waitingAnswer };
}

/** Whether a started write stopped at the armed seam ('held') or answered first; a failed row lets it go after. */
async function stopped(gate: { reached: Promise<void>; release(): void }, writing: Promise<unknown>): Promise<string> {
  releases.push(gate.release);
  writing.catch(() => undefined);
  return await Promise.race([gate.reached.then(() => 'held'), writing.then(() => 'answered', () => 'answered')]);
}

/** A write that stops for good after its commit (the armed `fail()`): its log stays `pending`, no file landed. */
async function leavePending(world: KLS2AWorld, seam: ReturnType<typeof armedSeam>): Promise<void> {
  seam.fail();
  await write(world, 'kls2c1-stopped', fileNote('kls2c1-stopped', 'src/a.ts')).catch(() => null);
  expect(world.files('.workbench/notes/ws')).toEqual([]);
}

/** 2c-1b1's `platform.knowledge` (seam §ops, non-enumerable); absent before it lands. */
type KnowledgeOps = { reconcile(ctx: CoreCallContext, workspaceId: string, trigger: 'idle'): Promise<{ status: string }> };
function knowledgeOps(world: KLS2AWorld): KnowledgeOps {
  const ops = (world.platform as unknown as { knowledge?: KnowledgeOps }).knowledge;
  if (ops === undefined) throw new Error('KLS2C1: platform.knowledge.reconcile (2c-1b1) is not published');
  return ops;
}

describe('KLS2C1 a pending knowledge write moves the read windows and stops the next writer on its line', () => {
  // Lead 11-12: the architecture readers look at the architecture and module files' pending logs only.
  it.each<[string, (world: KLS2AWorld) => Promise<{ status: string }>]>([
    ['R1 the conflicts window', world => world.platform.decisions.queryGoalConflicts(world.ctx(), { workspace: scope(world) })],
    ['R3 `architecture/read`', world =>
      world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } })],
    ['R4 the decision queue', queueRead],
  ])('%s: an architecture revision committed and not landed is unavailable, never the new revision over the old '
    + 'files; once it lands it reads revision 2 with the new text', async (_row, read) => {
    const seam = armedSeam('committed');
    const world = await knowledgeWorld(seam);
    await adoptCore(world);
    expect(await read(world)).toMatchObject({ status: 'ready' });
    const gate = seam.hold();
    const revising = revise(world, 'core 的新职责');
    expect(await stopped(gate, revising)).toBe('held');
    expect(await read(world)).toMatchObject({ status: 'rejected', code: 'unavailable' });
    gate.release();
    expect(await revising).toMatchObject({ status: 'committed' });
    expect(await read(world)).toMatchObject({ status: 'ready' });
    const landed = await architecture(world);
    expect([landed.catalog.ref.revision, landed.catalog.catalog.modules.map(module => module.responsibility)])
      .toEqual([2, ['core 的新职责']]);
  });

  // Lead after the merge: the notes window goes by the notes it reads, and the queue reads a waiting note in flight.
  it('R2 a waiting note committed and not landed: the decision queue is unavailable, the architecture read is not; '
    + 'once it lands its card is there', async () => {
    const seam = armedSeam('committed');
    const world = await knowledgeWorld(seam);
    const { person, pending } = await reviewWorld(world, 1);
    const gate = seam.hold();
    const writing = write(world, 'kls2c1-r2', note('kls2c1-r2', { contradicts: [person[0]!] }), 'work_run');
    expect(await stopped(gate, writing)).toBe('held');
    expect(await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } }))
      .toMatchObject({ status: 'ready' });
    expect(await queueRead(world)).toMatchObject({ status: 'rejected', code: 'unavailable' });
    gate.release();
    const waiting = await writing;
    expect(waiting).toMatchObject({ status: 'pending_review' });
    expect(reviewed(await readyQueue(world))).toEqual([...pending, (waiting as { noteId: string }).noteId].sort());
  });

  it('W1 a write log left pending on this line refuses the next write on the line as unavailable, '
    + '"有未确认的知识写", and writes nothing', async () => {
    const seam = armedSeam('committed');
    const world = await knowledgeWorld(seam);
    await leavePending(world, seam);
    const next = await write(world, 'kls2c1-w1', fileNote('kls2c1-w1', 'README.md'));
    expect(next).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(next.status === 'rejected' ? next.reason : '').toContain('有未确认的知识写');
    expect(world.files('.workbench/notes/ws')).toEqual([]);
  });

  it('W2 (needs 2c-1b1) once a reconciliation has handed that log to the person (`unconfirmed`), the next write goes '
    + 'through and the queue reads', async () => {
    const seam = armedSeam('committed');
    const world = await knowledgeWorld(seam);
    await leavePending(world, seam);
    expect(await knowledgeOps(world).reconcile(world.ctx(), world.workspaceId, 'idle')).toMatchObject({ status: 'ready' });
    const next = await write(world, 'kls2c1-w2', fileNote('kls2c1-w2', 'README.md'));
    expect(next).toMatchObject({ status: 'accepted' });
    expect(await queueRead(world)).toMatchObject({ status: 'ready' });
  });
});

describe('KLS2C1 the decision queue isolates one bad note', () => {
  it('Q1 a person points a waiting note\'s relation at a note number that does not exist: the queue is ready, the '
    + 'other card and the notice are there, nothing names that number; that note\'s own card still reads', async () => {
    const world = await knowledgeWorld();
    const { person, pending, cards } = await reviewWorld(world, 2);
    const ghost = person[0]!.slice(0, -1) + (person[0]!.endsWith('0') ? '1' : '0');
    const text = world.file(notePath(pending[0]!));
    const from = `"contradicts": [\n    "${person[0]!}"\n  ]`;
    if (text === null || !text.includes(from)) throw new Error(`KLS2C1: p1's file has no ${from}`);
    world.edit(notePath(pending[0]!), text.replace(from, `"contradicts": [\n    "${ghost}"\n  ]`));
    const read = await readyQueue(world);
    expect(reviewed(read)).toContain(pending[1]);
    expect(noticed(read)).toEqual([NOTICE]);
    expect(JSON.stringify(read.waitingAnswer)).not.toContain(ghost);
    const own = cards.find(card => subjectOf(card) === pending[0])!;
    expect(await world.platform.decisions.readDecisionCard(world.ctx(), { source: own.source }))
      .toMatchObject({ status: 'ready' });
  });

  it('Q2 one waiting note\'s file deleted and another\'s broken: neither shows a card, the third card and the notice '
    + 'are there', async () => {
    const world = await knowledgeWorld();
    const { pending } = await reviewWorld(world, 3);
    rmSync(join(world.root, notePath(pending[0]!)));
    world.edit(notePath(pending[1]!), '这不是注记文件\n');
    const read = await readyQueue(world);
    expect([reviewed(read), noticed(read)]).toEqual([[pending[2]], [NOTICE]]);
  });
});
