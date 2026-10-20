/**
 * Slice 4C C1.5 R-02 (RW-15): the node-detail notes column and the hover note
 * counts through the REAL `createTargetPlatform` node-detail reader (the same
 * read the "look" drill-down uses). The note is a real public write on the
 * Task's anchor and the column is compared against the first real `lookup`
 * page read back through `platform.notes`; the anomaly anchor side by side is a
 * real archived Run of the same Task. The unwired and failed notes reads stay
 * `unavailable` (RW-11).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { SessionDutyReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import { createNodeDetailReader } from '../../src/core/work-graph/views/node-detail-reader.js';
import type { WorkLineReaderDeps } from '../../src/core/work-graph/views/work-line-reader.js';
import { createS4CNodeNotesFixture } from '../helpers/S4C-node-notes-fixture.js';
import { nodeReaderOf, openNodeFixture, scriptedExecutedFiles } from '../helpers/S2C-D-node-support.js';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const PAGE = { afterCursor: null, limit: 20 };
const KINDS = ['memory', 'sqlite'] as const;
const TASK = 't1';
const ANCHOR = { kind: 'task' as const, goalId: 's4a-goal', taskId: TASK };

/** One note on the Task anchor, written through the public `notes/write` port. */
function taskNote(): NoteDraftV1 {
  return { kind: 'convention', topic: 'task-note', conclusion: 'task-note conclusion', body: 'body',
    anchor: ANCHOR, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [] };
}

describe('S4C R-02 node-detail notes column and hover counts', () => {
  it.each(KINDS)('R-02 %s: one note and one anomaly anchor side by side; the hover shows counts only; the look drill-down matches', async kind => {
    const fixture = await createS4CNodeNotesFixture(kind);
    opened.push(fixture);
    // The real archive step produces the Run's anomaly anchor for this Task.
    const runRef = await fixture.archiveRun(TASK, 'r02');
    // A real public note write; read it back through the node detail.
    const written = await fixture.platform.notes.writeNote(fixture.ctx(), { commandId: `rw15-r02-${kind}`,
      note: taskNote(), expectedPointerRevision: null, goalId: fixture.goalRef.goalId });
    if (written.status === 'rejected') throw new Error(`expected an accepted note, got ${JSON.stringify(written)}`);
    expect(written.status).toBe('accepted');

    const node = { kind: 'task' as const, ref: fixture.task(TASK), planRef: fixture.planRef };
    const summary = await fixture.platform.nodeDetail.readNodeDetail(fixture.ctx(),
      { goalRef: fixture.goalRef, node, section: 'summary', page: PAGE });
    if (summary.status !== 'ready' || summary.value.section !== 'summary') {
      throw new Error(`expected a summary, got ${JSON.stringify(summary)}`);
    }
    expect(summary.value.notes.status).toBe('available');
    if (summary.value.notes.status !== 'available') return;

    // The column equals the first real `lookup` page for the same anchor: the
    // same `lookupRead` behind `notes/list` (labels) and `memoryLookup`.
    const listed = await fixture.platform.notes.listNotes(fixture.ctx(), { anchor: ANCHOR, limit: PAGE.limit, cursor: null });
    if (listed.status !== 'ready') throw new Error(`expected a notes/list page, got ${JSON.stringify(listed)}`);
    const lookup = await fixture.platform.notes.memoryLookup(fixture.ctx(),
      { v: 1, op: 'lookup', anchor: ANCHOR, limit: PAGE.limit, cursor: null });
    if (lookup.status !== 'ready') throw new Error(`expected a lookup page, got ${JSON.stringify(lookup)}`);

    expect(summary.value.notes.items).toEqual(listed.value.items);
    expect(summary.value.notes.items.map(row => row.noteId)).toEqual(lookup.value.items.map(row => row.noteId));
    expect(summary.value.notes.items.map(row => row.version)).toEqual(lookup.value.items.map(row => row.version));
    expect(summary.value.notes.items.map(row => row.storedState)).toEqual(lookup.value.items.map(row => row.storedState));
    expect(summary.value.notes.items.map(row => row.label)).toEqual(listed.value.items.map(row => row.label));
    expect(summary.value.notes.next).toBe(lookup.value.next);
    expect(summary.value.notes.complete).toBe(lookup.value.complete);
    expect(summary.value.notes.understanding).toEqual(lookup.value.understanding);

    // The one real note, with its real rendered label.
    expect(summary.value.notes.items).toHaveLength(1);
    expect(summary.value.notes.items[0]!.noteId).toBe(written.noteId);
    expect(summary.value.notes.items[0]!.version).toBe(written.version);
    expect(summary.value.notes.items[0]!.label).toBe(`约定(任务 ${TASK})：task-note conclusion`);

    // The real archived Run's anomaly anchor is its own section (side by side).
    const anomalies = await fixture.platform.nodeDetail.readNodeDetail(fixture.ctx(),
      { goalRef: fixture.goalRef, node, section: 'anomalies', page: PAGE });
    if (anomalies.status !== 'ready' || anomalies.value.section !== 'anomalies') {
      throw new Error(`expected anomalies, got ${JSON.stringify(anomalies)}`);
    }
    expect(anomalies.value.items).toHaveLength(1);
    expect(anomalies.value.items[0]!.anchor.task.taskId).toBe(TASK);
    expect(anomalies.value.items[0]!.anchor.runRef).toEqual(runRef);

    // The hover card only exposes a count per node.
    const hover = await fixture.platform.nodeDetail.readGraphHover(fixture.ctx(), { goalRef: fixture.goalRef });
    if (hover.status !== 'ready') throw new Error(`expected hover, got ${JSON.stringify(hover)}`);
    const taskCount = hover.value.noteCounts.find(entry => entry.node.kind === 'task'
      && entry.node.ref.taskId === TASK);
    expect(taskCount).toBeDefined();
    expect(taskCount!.count).toEqual({ status: 'exact', value: 1 });
    expect(taskCount).not.toHaveProperty('items');
    expect(hover.value).not.toHaveProperty('notes');

    // The "look" drill-down reads the same column.
    const again = await fixture.platform.nodeDetail.readNodeDetail(fixture.ctx(),
      { goalRef: fixture.goalRef, node, section: 'summary', page: PAGE });
    if (again.status !== 'ready' || again.value.section !== 'summary' || again.value.notes.status !== 'available') {
      throw new Error(`expected a summary, got ${JSON.stringify(again)}`);
    }
    expect(again.value.notes.items).toEqual(summary.value.notes.items);
  });

  it('RW-11 nodeReaderOf does not hide the missing notes read: an unwired dependency is unavailable', async () => {
    const fixture = await openNodeFixture('memory');
    opened.push(fixture);
    const node = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const summary = await nodeReaderOf(fixture).reader.readNodeDetail(fixture.ctx,
      { goalRef: fixture.goalRef, node, section: 'summary', page: PAGE });
    if (summary.status !== 'ready' || summary.value.section !== 'summary') {
      throw new Error(`expected a summary, got ${JSON.stringify(summary)}`);
    }
    expect(summary.value.notes).toEqual({ status: 'unavailable', reason: 'the notes read is not wired' });
  });

  it('RW-11 a rejected notes read is unavailable, never an empty available page', async () => {
    const fixture = await openNodeFixture('memory');
    opened.push(fixture);
    const lineDeps: WorkLineReaderDeps = { records: fixture.records,
      dutyFor: (async () => ({ status: 'ready' as const, value: 'executor' })) as SessionDutyReadPort,
      undeliveredRepliesFor: () => undefined, sessionAnomaliesFor: () => fixture.anomalies };
    const reader = createNodeDetailReader({
      records: fixture.records, plans: fixture.plans, catalog: fixture.catalog, anomalies: fixture.anomalies,
      executedFiles: scriptedExecutedFiles({ availability: 'not_available', files: [], possiblyIncomplete: true,
        sourceCursor: null }),
      line: lineDeps,
      notes: async () => ({ status: 'rejected', code: 'unavailable', reason: 'the note store is down' }),
    });
    const node = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const summary = await reader.readNodeDetail(fixture.ctx,
      { goalRef: fixture.goalRef, node, section: 'summary', page: PAGE });
    if (summary.status !== 'ready' || summary.value.section !== 'summary') {
      throw new Error(`expected a summary, got ${JSON.stringify(summary)}`);
    }
    expect(summary.value.notes).toEqual({ status: 'unavailable', reason: 'the notes read failed' });
  });
});
