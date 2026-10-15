/**
 * 2C-27 (LE6): task detail — planned modules, owners vs participants, risks and
 * the three executed-files injections (L15).
 *
 * Real services build the Plan (module scopes A→B→C), the Sessions, their
 * responsibility/participation links and the claimed Runs. The executed-files
 * port is the only injected dependency: the stub, a rejecting port, and a
 * hand-written available list.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { failingIndexRead, nodeReaderOf, openNodeFixture, rejectingExecutedFiles, scriptedExecutedFiles, type NodeFixture } from '../helpers/S2C-D-node-support.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const page = { afterCursor: null, limit: 20 };
const M = (fixture: NodeFixture) => fixture.moduleRef('M');
const N = (fixture: NodeFixture) => fixture.moduleRef('N');

describe.each(['memory', 'sqlite'] as const)('2C-27 task detail (%s)', (kind) => {
  it('2C-27 planned modules, owners/participants split, same-module risks and the three executed-files answers', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const node = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const owner = await fixture.createSession('owner');
    const participant = await fixture.createSession('participant');
    const other = await fixture.createSession('other');
    await fixture.link(owner, fixture.tasks['task-a']!, 'responsible', true);
    await fixture.link(participant, fixture.tasks['task-a']!, 'participates', true);
    const runA = await fixture.claim('task-a', owner);
    const runD = await fixture.claim('task-d', other);

    // (a) today's stub: both fields are unavailable/not_recorded, never empty.
    const stub = nodeReaderOf(fixture, {
      executedFiles: scriptedExecutedFiles({ availability: 'not_available', files: [], possiblyIncomplete: true, sourceCursor: null }),
    });
    const a = await stub.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'summary', page });
    expect(a.status).toBe('ready');
    if (a.status !== 'ready' || a.value.section !== 'summary') throw new Error(JSON.stringify(a));
    expect(a.value.task?.plannedModules).toEqual([M(fixture)]);
    expect(a.value.task?.actualFiles).toEqual({ availability: 'unavailable', cause: 'not_recorded', reason: '执行改过的文件还没有记录（2B）' });
    expect(a.value.fileRisks).toEqual({ availability: 'unavailable', cause: 'not_recorded', reason: '执行改过的文件还没有记录（2B）' });

    // (b) a rejecting port: read_failed with the error code.
    const rejected = nodeReaderOf(fixture, { executedFiles: rejectingExecutedFiles('unavailable') });
    const b = await rejected.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'summary', page });
    expect(b.status).toBe('ready');
    if (b.status !== 'ready' || b.value.section !== 'summary') throw new Error(JSON.stringify(b));
    expect(b.value.task?.actualFiles).toEqual({ availability: 'unavailable', cause: 'read_failed', reason: 'unavailable: executed-files read failed' });

    // (c) a hand-written available port.
    const available = nodeReaderOf(fixture, { executedFiles: scriptedExecutedFiles({
      availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      files: [
        { runRef: runA.runRef, path: 'm/a.ts', certainty: 'definite' },
        { runRef: runA.runRef, path: 'm/b.ts', certainty: 'possible' },
        { runRef: runD.runRef, path: 'm/a.ts', certainty: 'definite' },
      ],
    }) });
    const c = await available.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'summary', page });
    expect(c.status).toBe('ready');
    if (c.status !== 'ready' || c.value.section !== 'summary') throw new Error(JSON.stringify(c));
    expect(c.value.task?.actualFiles).toEqual({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      value: [
        { runRef: runA.runRef, path: 'm/a.ts', certainty: 'definite' },
        { runRef: runA.runRef, path: 'm/b.ts', certainty: 'possible' },
      ] });
    expect(c.value.fileRisks).toEqual({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      value: { riskCount: { status: 'exact', value: 1 } } });

    const risks = await available.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'risks', page });
    expect(risks.status).toBe('ready');
    if (risks.status !== 'ready' || risks.value.section !== 'risks') throw new Error(JSON.stringify(risks));
    const sharedFiles = risks.value.items.filter((item) => item.shared.kind === 'file').map((item) => item.task.taskId);
    const sharedModules = risks.value.items.filter((item) => item.shared.kind === 'module').map((item) => item.task.taskId);
    expect(sharedModules).toContain('task-c');
    expect(sharedModules).not.toContain('task-b');
    expect(sharedModules).not.toContain('task-cancel');
    expect(sharedModules).not.toContain('task-super');
    expect(sharedFiles).toEqual(['task-d']);

    const participants = await available.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'participants', page });
    expect(participants.status).toBe('ready');
    if (participants.status !== 'ready' || participants.value.section !== 'participants') throw new Error(JSON.stringify(participants));
    const vias = participants.value.items.map((item) => item.via).sort();
    expect(vias).toEqual(['participates', 'responsible']);

    // possiblyIncomplete true: the file count is partial, not exact.
    const partial = nodeReaderOf(fixture, { executedFiles: scriptedExecutedFiles({
      availability: 'available', possiblyIncomplete: true, sourceCursor: null,
      files: [{ runRef: runA.runRef, path: 'm/a.ts', certainty: 'definite' }, { runRef: runD.runRef, path: 'm/a.ts', certainty: 'definite' }],
    }) });
    const d = await partial.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'summary', page });
    expect(d.status).toBe('ready');
    if (d.status !== 'ready' || d.value.section !== 'summary') throw new Error(JSON.stringify(d));
    expect(d.value.fileRisks).toEqual({ availability: 'available', possiblyIncomplete: true, sourceCursor: null,
      value: { riskCount: { status: 'partial', atLeast: 1, reason: '执行改过的文件可能不全' } } });
  });

  it('2C-27 fileRisks excludes directly dependent tasks, like the risk rows', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const node = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const a = await fixture.createSession('risk-a');
    const b = await fixture.createSession('risk-b');
    await fixture.link(a, fixture.tasks['task-a']!, 'responsible', true);
    await fixture.link(b, fixture.tasks['task-b']!, 'responsible', true);
    const runA = await fixture.claim('task-a', a);
    const runB = await fixture.claim('task-b', b);
    const { reader } = nodeReaderOf(fixture, { executedFiles: scriptedExecutedFiles({
      availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      files: [
        { runRef: runA.runRef, path: 'm/a.ts', certainty: 'definite' },
        { runRef: runB.runRef, path: 'm/a.ts', certainty: 'definite' },
      ] }) });
    const summary = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'summary', page });
    expect(summary.status).toBe('ready');
    if (summary.status !== 'ready' || summary.value.section !== 'summary') throw new Error(JSON.stringify(summary));
    // task-b depends directly on task-a, so it is excluded from the risk count too.
    expect(summary.value.fileRisks).toEqual({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      value: { riskCount: { status: 'exact', value: 0 } } });
  });

  it('2C-27 a failed link read is propagated, not a shorter participants list', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const node = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const records = failingIndexRead(fixture.records, 'session-links-by-task', 'injected link read failure');
    const { reader } = nodeReaderOf({ ...fixture, records });
    const participants = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'participants', page });
    expect(participants.status).toBe('rejected');
    if (participants.status !== 'rejected') throw new Error(JSON.stringify(participants));
    expect(participants.reason).toContain('injected link read failure');
  });
});
