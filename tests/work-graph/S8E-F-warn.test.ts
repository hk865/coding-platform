/**
 * S8E-2 R F-warn: the Work execution input's "注记" section (E4) with the E3
 * route read, the E5 owner reads and the E6 check, on the one S8E semantic world.
 *
 * Rows and the spec lines their expectations come from:
 * - E-25a, E-25b (8E-2 :807, :808; 8E :740; R5 :352, R6 :365, R7 :374, R11 :388–391):
 *   one `it`, one world; the two scribe `stale` reads are the same request, so
 *   E-25a's "no K1" counts against E-25b's "K1".
 * - E-45 (8E-2 :817; 8E :760; R5 :357, :359, R11 :389).
 * - E2-11 (8E-2 :834; R11 :390).
 * The line texts are `warningLabelOf` (note-read-model.ts:2056–2059) over
 * strings.json:49–54, rendered with `（<noteId> v<version>）`
 * (context-fact-text.ts:115–117, :306–309; strings.json:131–133); the merged
 * line's two strings are R11 :390's first draft. All are written by hand here.
 *
 * E4 (after S8E-R-context.test.ts:88–194): g1's first real Run edits
 * src/runtime/run.ts with the Kernel's `edit` and then fails; the person
 * requeues it over `tasks/requeue`; the Workflow stops before `prepare`. Only
 * then are the row's links written (person `notes/write`, E2) and its files
 * changed; `runtime.prepareExecution` prepares the same not-started Run again
 * after each step (S4C2-assembly.test.ts:274–325). Builds are taken before and
 * after each step (8E-2 :800, §4.1 :708).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { NoteAnchorV1 } from '../../src/contracts/note.js';
import type { SemanticLinkV1, SemanticPageV1 } from '../../src/contracts/semantic-layer.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { NoteItemV1, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCRIBE_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, S8E_SCOPE, S8E_SEMANTIC_WORLD_FILES, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const K1 = S8E_LINKS.K1.conclusion;
const K3 = S8E_LINKS.K3.conclusion;
const BEGIN = 'export const begin = (id: string) => runModel(access, id);';

// The rendered rows (strings.json:49–54, :131–133; R11 :390), by hand.
const versioned = (label: string, noteId: string): string => `${label}（${noteId} v1）`;
const doubtRow = (noteId: string, conclusion: string): string =>
  versioned(`需复查：${noteId} ${conclusion}，不能当现行结论`, noteId);
const brokenRow = (noteId: string, conclusion: string): string =>
  versioned(`证据对不上：${noteId} ${conclusion}，不能当现行结论`, noteId);
const pendingRow = (count: number, noteId: string): string =>
  versioned(`这些节点上另有 ${String(count)} 条联系待核，不能当现行结论`, noteId);

/** A person write that must be accepted (A1); the id comes from the receipt. */
function idOf(write: WriteNoteResult): string {
  if (write.status !== 'accepted') throw new Error(`expected accepted, got ${JSON.stringify(write)}`);
  return write.noteId;
}

/** "第 n 行改成 X": replace line n (1-based) of a world file. */
async function setLine(world: S8ESemanticWorld, path: string, line: number, text: string): Promise<void> {
  const target = join(world.root, path);
  const lines = (await readFile(target, 'utf8')).split('\n');
  lines[line - 1] = text;
  await writeFile(target, lines.join('\n'), 'utf8');
}

function byId<T extends { noteId: string }>(items: readonly T[], noteId: string): T {
  const found = items.find(item => item.noteId === noteId);
  if (found === undefined) throw new Error(`${noteId} is not among ${JSON.stringify(items.map(item => item.noteId))}`);
  return found;
}

/** E3: the project page of `architecture/semantic-links`, the item by `noteId` (as `pageOf`). */
async function linkItem(world: S8ESemanticWorld, noteId: string): Promise<SemanticLinkV1> {
  const result = await world.route('architecture/semantic-links', { scope: { kind: 'project' }, cursor: null, limit: 100 });
  const read = result as ReadResult<SemanticPageV1<SemanticLinkV1>>;
  if (read.status !== 'ready') throw new Error(`the semantic read was not ready: ${JSON.stringify(result)}`);
  return byId(read.value.items, noteId);
}

/** The note's stored main anchor (`readNote`, ready required). */
async function anchorOf(world: S8ESemanticWorld, noteId: string): Promise<NoteAnchorV1> {
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (read.status !== 'ready') throw new Error(`readNote ${noteId} was not ready: ${JSON.stringify(read)}`);
  return read.value.anchor;
}

/** E5: the owner `lookup` on the anchor, the item by `noteId` (as `S8E-R-tools.test.ts:92–99`). */
async function lookupItem(world: S8ESemanticWorld, anchor: NoteAnchorV1, noteId: string): Promise<NoteItemV1> {
  const read = await world.platform.notes.memoryLookup(world.humanContext(),
    { v: 1, op: 'lookup', anchor, limit: 100, cursor: null });
  if (read.status !== 'ready') throw new Error(`the lookup was not ready: ${JSON.stringify(read)}`);
  return byId(read.value.items, noteId);
}

/** E5: the scribe `stale` read on the anchor (request shape `S4B-memory-find-stale.test.ts:30`). */
async function staleItems(world: S8ESemanticWorld, anchor: NoteAnchorV1): Promise<NoteItemV1[]> {
  const read = await world.platform.notes.memoryStale(world.humanContext(),
    { v: 1, op: 'stale', anchor, limit: 100, cursor: null });
  if (read.status !== 'ready') throw new Error(`the stale read was not ready: ${JSON.stringify(read)}`);
  return read.value.items;
}

/**
 * The exact lines of one rendered `##` section (`S8E-R-context.test.ts:48–60`);
 * a section with no rows is not rendered at all, so an absent header is no lines.
 */
function sectionLines(input: string, header: string): string[] {
  const lines = input.split('\n');
  const start = lines.indexOf(header);
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return body;
}

async function runRefOf(world: S8ESemanticWorld, taskId: string): Promise<RunRef> {
  const graph = await world.route('tasks/query', { goalRef: world.goalRef }) as
    ReadResult<{ tasks: { ref: { taskId: string }; execution: RunRef | null }[] }>;
  if (graph.status !== 'ready') throw new Error(`tasks/query was not ready: ${JSON.stringify(graph)}`);
  const execution = graph.value.tasks.find(row => row.ref.taskId === taskId)?.execution ?? null;
  if (execution === null) throw new Error(`the task ${taskId} has no Run`);
  return execution;
}

/** One world per row with the real-Run grant (`S8E-R-context.test.ts:89–96`). */
const openRunWorld = async (): Promise<S8ESemanticWorld> => await openS8ESemanticWorld({
  scribeTasks: 3,
  extraBindings: [{ binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding,
    mergeTools: ['write'], mergeWriteScope: ['.'] }],
});

/**
 * E4: g1's first Run edits run.ts and fails, the person requeues, the Workflow
 * stops before `prepare`. Returns "prepare the same Run again, read the notes
 * section".
 */
async function setupE4(world: S8ESemanticWorld, label: string): Promise<() => Promise<string[]>> {
  const task = world.tasks[0]!;
  const line = await createS6BLine(s6aCardsWorkspace(world, world.scope),
    { label: `s8e-warn-${label}`, role: S6A_SCRIBE_ROLE, tasks: [task] });
  const runTs = S8E_SEMANTIC_WORLD_FILES.find(file => file.path === 'src/runtime/run.ts')!.content;
  const before = world.model.calls();
  world.clock.advance(1000);
  world.scriptReplies([
    { kind: 'calls', calls: [{ callId: `${label}-edit`, name: 'edit', args: {
      mode: 'replace', path: 'src/runtime/run.ts', oldText: '  await access.beforeCall(id);',
      newText: '  await access.beforeCall(id);\n  // S8E F-warn: the real edited run\n',
      expectedRevision: sha256Hex(runTs),
    } }] },
    { kind: 'error', code: `${label}_after_edit` },
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goalRef, flowId: `${label}-run-1`,
    sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, { stopBefore: 'requeue_task' });
  if (world.model.calls() !== before + 2) throw new Error('E4: the first Run did not make its two model calls');
  const run1Ref = await runRefOf(world, task.taskId);

  const goal = await world.route('goals/read', world.goalRef) as ReadResult<{ goal: GoalSnapshot }>;
  if (goal.status !== 'ready') throw new Error(`goals/read was not ready: ${JSON.stringify(goal)}`);
  const execution = await world.route('executions/read', run1Ref) as ReadResult<{ run: { revision: number } }>;
  if (execution.status !== 'ready') throw new Error(`executions/read was not ready: ${JSON.stringify(execution)}`);
  const requeued = (await world.post('tasks/requeue', graphWrite(S8E_SCOPE, {
    taskRef: task, afterRunRef: run1Ref, reason: 'S8E F-warn: the edited run failed',
  }, `${label}-requeue`, [
    { ref: world.goalRef, revision: goal.value.goal.revision },
    { ref: run1Ref, revision: execution.value.run.revision },
  ]))).body as WriteResult<TaskRequeueOutcomeV1>;
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
    throw new Error(`the public requeue was refused: ${JSON.stringify(requeued)}`);
  }
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goalRef, flowId: `${label}-run-2`,
    sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, { stopBefore: 'prepare' });
  const run2Ref = await runRefOf(world, task.taskId);
  if (run2Ref.runId === run1Ref.runId) throw new Error('E4: the requeue made no second Run');

  let prepares = 0;
  return async () => {
    prepares += 1;
    const prepared = await world.platform.runtime.prepareExecution(world.humanContext(),
      { runRef: run2Ref, requestId: `${label}-prepare-${String(prepares)}` });
    if (prepared.status !== 'ready') throw new Error(`prepareExecution was not ready: ${JSON.stringify(prepared)}`);
    const artifact = await world.platform.materials.openArtifact(world.humanContext(),
      { ref: prepared.value.envelope.bundleRef, usage: 'historical_explanation' });
    if (artifact.status !== 'ready') throw new Error(`the manifest was not readable: ${JSON.stringify(artifact)}`);
    const manifest = JSON.parse(artifact.value.body) as { input?: unknown };
    if (typeof manifest.input !== 'string') throw new Error('the prepared manifest has no string input');
    return sectionLines(manifest.input, '## Note index');
  };
}

const ofNote = (rows: readonly string[], noteId: string): string[] => rows.filter(row => row.includes(noteId));
const forbidden = { status: 'rejected' as const, code: 'forbidden' as const, reason: 'S8E F-warn: forbidden' };

describe('S8E-2 R F-warn: the notes section lines of a doubtful or broken link', () => {
  it('E-25a, E-25b a wire line without `authorize` but with the import `Access` reads doubtful, then checks broken [1]', async () => {
    const world = await openRunWorld();
    try {
      const notes = await setupE4(world, 'e-25');
      const k1 = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1)));
      const anchor = await anchorOf(world, k1);
      await setLine(world, 'src/compose.ts', 7, 'const access: Access = { beforeCall: async () => {} };');

      // E-25a (8E-2 :807): R5 rule 4's top-level half fails (the import name `Access` is there).
      const reads = world.linkCheck.builds();
      const first = await linkItem(world, k1);
      expect(first.verification).toEqual({ status: 'unchecked', reason: 'refs_pending' });
      expect(first).toMatchObject({ currentEligible: false,
        from: { anchorStatus: 'live' }, to: { anchorStatus: 'live' }, via: { anchorStatus: 'live' } });
      expect((await staleItems(world, anchor)).map(item => item.noteId)).not.toContain(k1);
      expect(ofNote(await notes(), k1)).toEqual([doubtRow(k1, K1)]);
      expect(world.linkCheck.builds() - reads).toBe(0);

      // E-25b (8E-2 :808): the check builds once and finds no `authorize` on line 7.
      const checking = world.linkCheck.builds();
      expect(await world.route('architecture/semantic-links/check', { items: [{ noteId: k1, version: 1 }] }))
        .toEqual({ status: 'ready', value: { items: [{ noteId: k1, version: 1,
          verification: { status: 'broken', missing: [1] } }] } });
      expect(world.linkCheck.builds() - checking).toBe(1);
      const rereading = world.linkCheck.builds();
      expect((await linkItem(world, k1)).verification).toEqual({ status: 'broken', missing: [1] });
      expect(world.linkCheck.builds() - rereading).toBe(0);
      expect(byId(await staleItems(world, anchor), k1).staleReasons).toContain('link_evidence_broken:1');
      expect(ofNote(await notes(), k1)).toEqual([brokenRow(k1, K1)]);
    } finally { await world.close(); }
  }, 300_000);

  it('E-45 a changed basis file reads one "needs recheck" line, also when the via file is unreadable; broken reads one broken line', async () => {
    const world = await openRunWorld();
    try {
      const notes = await setupE4(world, 'e-45');
      const k1 = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1, { basisFiles: ['src/compose.ts'] })));
      const anchor = await anchorOf(world, k1);

      // ① line 10 renamed: stale by the basis file and doubtful.
      await setLine(world, 'src/compose.ts', 10, BEGIN);
      const changed = await lookupItem(world, anchor, k1);
      const changedRows = await notes();
      expect(changed.freshness).toBe('stale');
      expect(changed.staleReasons).toEqual(['file_changed']);
      expect(ofNote(changedRows, k1)).toEqual([doubtRow(k1, K1)]);
      expect(changed.link?.verification).toEqual({ status: 'unchecked', reason: 'refs_pending' });

      // ② the "via" file cannot be read: `unchecked` over `stale`, the line stays (R11 :389).
      world.linkCheck.faultReads(request => request.path === 'src/contracts/access.ts' ? forbidden : null);
      let unreadable: NoteItemV1;
      let unreadableRows: string[];
      try {
        unreadable = await lookupItem(world, anchor, k1);
        unreadableRows = await notes();
      } finally { world.linkCheck.faultReads(null); }
      expect(unreadable.freshness).toBe('unchecked');
      expect(unreadable.staleReasons).toEqual(['file_changed']);
      expect(unreadable.link?.verification).toEqual({ status: 'unchecked', reason: 'unavailable' });
      expect(ofNote(unreadableRows, k1)).toEqual([doubtRow(k1, K1)]);

      // ③ line 7 loses `beforeCall`: broken and still stale, one broken line only.
      await setLine(world, 'src/compose.ts', 7, 'const access: Access = { before: authorize };');
      const broken = await lookupItem(world, anchor, k1);
      const brokenRows = await notes();
      expect(broken.link?.verification).toMatchObject({ status: 'broken' });
      expect(broken.freshness).toBe('stale');
      expect(ofNote(brokenRows, k1)).toEqual([brokenRow(k1, K1)]);
    } finally { await world.close(); }
  }, 300_000);

  it('E2-11 four doubtful links merge into one pending line; three are three "needs recheck" lines', async () => {
    const world = await openRunWorld();
    try {
      const notes = await setupE4(world, 'e2-11');
      const k1 = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1)));
      const k3 = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K3)));
      const k3a = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K3, { topic: 'E2-11-a' })));
      const k3b = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K3, { topic: 'E2-11-b' })));
      await setLine(world, 'src/compose.ts', 10, BEGIN);

      // Four doubtful only: one merged line, numbered with the smallest noteId (R11 :390).
      const smallest = [k1, k3, k3a, k3b].sort()[0]!;
      expect(await notes()).toEqual([pendingRow(4, smallest)]);

      // The person withdraws one (`notes/withdraw`, shape `S4C-note-routes.test.ts:96–97`).
      const withdrawn = await world.route('notes/withdraw',
        { commandId: 'e2-11-withdraw', noteId: k3b, expectedVersion: 1, reason: null }) as { status?: unknown };
      if (withdrawn.status !== 'done') throw new Error(`the withdraw was refused: ${JSON.stringify(withdrawn)}`);
      expect([...await notes()].sort())
        .toEqual([doubtRow(k1, K1), doubtRow(k3, K3), doubtRow(k3a, K3)].sort());
    } finally { await world.close(); }
  }, 300_000);
});
