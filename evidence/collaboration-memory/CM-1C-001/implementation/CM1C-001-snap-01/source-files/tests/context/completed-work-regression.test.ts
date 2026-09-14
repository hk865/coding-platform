import { expect, it } from 'vitest';
import { CompletedWorkContextCompilerImpl } from '../../src/data/context-compiler/completed-work-context-compiler.js';
import { ArtifactVault } from '../../src/data/artifact-vault/artifact-vault.js';
import { buildP117Request } from '../contract-support/fixtures/completed-work-fixtures.js';
import { buildExecutionNoteV1, buildWorkContextBindingV1 } from '../contract-support/fixtures/context-fixtures.js';
import { workContextRefFor, executionNoteRefFor } from '../../src/contracts/context-continuity.js';
import { makeCommitCursor, type StateLedger } from '../../src/contracts/ledger.js';
import type { ReadModelIndex } from '../../src/contracts/goal-view.js';

function fixture() {
  const request = buildP117Request();
  const run = { ...request.requestedByRunRef, goalId: 'old-goal', runId: 'old-run' };
  const ref = workContextRefFor(request.projectId, request.workspaceId, 'old-work');
  const noteRef = executionNoteRefFor(request.projectId, request.workspaceId, ref.workId, 'note');
  const note = buildExecutionNoteV1({ projectId: request.projectId, workId: ref.workId, noteId: 'note', runRef: run,
    summary: 'src/query uses explicit versions', reason: 'Avoid reusing stale assumptions' });
  note.applicableVersions = { ...request.applicableVersions };
  const binding = { ref, revision: 3, schemaVersion: 1 as const, binding: buildWorkContextBindingV1({
    projectId: request.projectId, workspaceId: request.workspaceId, workId: ref.workId,
    goalId: run.goalId, taskId: 'old-task', initialRunRef: run,
  }) };
  const cursor = makeCommitCursor(8);
  // RW-15：视图行必须显式写出归并事实（0 = 没有发生归并），本替身也不例外。
  const row = { workRef: ref, workKind: 'task', goalId: run.goalId, taskId: 'old-task', noteCount: 1, continuationCount: 0, sourceCursor: cursor, duplicateIdentityCount: 0, droppedWorkRefs: [] };
  const index = { completedWorkView: async () => ({ status: 'ready', rows: [row], sourceCursor: cursor }),
    workContext: async () => ({ status: 'ready', binding, notes: [{ noteRef, kind: note.kind, summary: note.summary,
      runRef: run, createdAt: note.createdAt, sourceCursor: cursor }], continuations: [], sourceCursor: cursor }),
  } as unknown as ReadModelIndex;
  const ledger = { load: async (requested: unknown) => JSON.stringify(requested) !== JSON.stringify(noteRef) ? { status: 'not_found' } : ({ status: 'found', snapshot: { ref: noteRef, revision: 1, schemaVersion: 1, note, recordedAt: note.createdAt } }) } as unknown as StateLedger;
  const vault = new ArtifactVault();
  const compiler = new CompletedWorkContextCompilerImpl({ ledger, vault, readModel: index, now: () => '2026-09-08T00:00:00.000Z' });
  async function assemble() {
    const result = await compiler.assembleCompletedWorkContext(request);
    if (result.status !== 'ready') throw Error(JSON.stringify(result));
    const opened = await vault.open(result.selectionRef, { requesterRunRef: request.requestedByRunRef });
    if (opened.status !== 'ready') throw Error('body not ready');
    return { result, body: JSON.parse(opened.record.body), bytes: Buffer.byteLength(opened.record.body) };
  }
  return { request, note, noteRef, ledger, compiler, assemble };
}

it('does not invent a changed premise for identical nonzero versions; keeps recorded reasons and exact bytes', async () => {
  const f = fixture();
  const { body, result, bytes } = await f.assemble();
  expect(body.changedPremises).toEqual([]);
  expect(body.selected[0].applicability.status).toBe('applicable');
  expect(body.selected[0].notes[0].reason).toBe(f.note.reason);
  expect(result.manifest.totalBytes).toBe(bytes);
});

it('downgrades matching text to historical explanation when the recorded workspace version differs', async () => {
  const f = fixture(); f.note.applicableVersions.workspaceRevision = 0;
  const { body } = await f.assemble();
  expect(body.selected[0].applicability.status).toBe('historical_explanation');
  expect(body.changedPremises).toHaveLength(1);
});

it('rejects a requesting run from another project before selecting material', async () => {
  const f = fixture(); f.request.requestedByRunRef.projectId = 'other';
  expect(await f.compiler.assembleCompletedWorkContext(f.request)).toMatchObject({ status: 'rejected' });
});

it('does not claim applicability for an unverified explicit related-source version', async () => {
  const f = fixture(); f.request.relatedRefs[0]!.version = 'unverified-revision';
  const { body } = await f.assemble();
  expect(body.selected[0].applicability.status).toBe('historical_explanation');
  expect(body.selected[0].applicability.because).toContain('unverified');
});


it('selects only relevant active memory and never revives an old revision when a newer one is outside the projection', async () => {
  const { workMemoryNoteId } = await import('../../src/contracts/context-continuity.js');
  const f = fixture();
  f.note.memory = { key: 'source-policy', revision: 1, state: 'active', topics: [f.request.relatedRefs[0]!.refKey] };
  f.note.noteId = workMemoryNoteId('source-policy', 1); f.noteRef.noteId = f.note.noteId;
  expect((await f.assemble()).body.selected[0].notes[0].memory.revision).toBe(1);
  f.note.memory.state = 'retired';
  expect((await f.assemble()).body.selected[0].notes).toEqual([]);
  f.note.memory.state = 'active'; f.note.memory.topics = ['unrelated'];
  expect((await f.assemble()).body.selected[0].notes).toEqual([]);
  f.note.memory.topics = [f.request.relatedRefs[0]!.refKey];
  const load = f.ledger.load.bind(f.ledger);
  f.ledger.load = async ref => 'noteId' in ref && ref.noteId === workMemoryNoteId('source-policy', 2)
    ? { status: 'found', snapshot: { ref: { ...f.noteRef, noteId: ref.noteId }, schemaVersion: 1, revision: 1, recordedAt: f.note.createdAt,
      note: { ...f.note, noteId: ref.noteId, memory: { ...f.note.memory!, revision: 2, state: 'retired' } } } }
    : load(ref);
  expect((await f.assemble()).body.selected[0].notes).toEqual([]);
});
