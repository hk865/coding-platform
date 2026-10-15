/**
 * 2C-29 (LE6): the node detail's notes欄 and a failed Run read.
 *
 * Real services build the Session, its responsibility link and the claimed
 * Run; the executed-files port is the stub answer. A storage wrapper fails the
 * one `readMany` for the Run, and the `executions` item must stay with a
 * `problem` instead of disappearing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { failingRunRead, nodeReaderOf, openNodeFixture, scriptedExecutedFiles, type NodeFixture } from '../helpers/S2C-D-node-support.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const page = { afterCursor: null, limit: 20 };

describe.each(['memory', 'sqlite'] as const)('2C-29 node detail (%s)', (kind) => {
  it('2C-29 notes say not_available/slice_4 and a failed Run read keeps its executions item with a problem', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const session = await fixture.createSession('s1');
    await fixture.link(session, fixture.tasks['task-a']!, 'responsible', true);
    const claim = await fixture.claim('task-a', session);

    const node = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const healthy = nodeReaderOf(fixture, {
      executedFiles: scriptedExecutedFiles({ availability: 'not_available', files: [], possiblyIncomplete: true, sourceCursor: null }),
    });

    const summary = await healthy.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'summary', page });
    expect(summary.status).toBe('ready');
    if (summary.status !== 'ready' || summary.value.section !== 'summary') throw new Error(JSON.stringify(summary));
    expect(summary.value.notes).toEqual({ availability: 'not_available', reason: 'slice_4' });
    expect(summary.value.task?.actualFiles).toEqual({
      availability: 'unavailable', cause: 'not_recorded', reason: '执行改过的文件还没有记录（2B）',
    });

    const executions = await healthy.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'executions', page });
    expect(executions.status).toBe('ready');
    if (executions.status !== 'ready' || executions.value.section !== 'executions') throw new Error(JSON.stringify(executions));
    expect(executions.value.items).toHaveLength(1);
    expect(executions.value.items[0]).toEqual({ runRef: claim.runRef, revision: 1, problem: null });

    const runKey = canonicalJson(claim.runRef as unknown as JsonValue);
    const broken = nodeReaderOf({ ...fixture, records: failingRunRead(fixture.records, runKey) });
    const failed = await broken.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'executions', page });
    expect(failed.status).toBe('ready');
    if (failed.status !== 'ready' || failed.value.section !== 'executions') throw new Error(JSON.stringify(failed));
    expect(failed.value.items).toHaveLength(1);
    expect(failed.value.items[0]!.runRef).toEqual(claim.runRef);
    expect(failed.value.items[0]!.revision).toBeNull();
    expect(failed.value.items[0]!.problem).toContain('injected Run read failure');
  });
});
