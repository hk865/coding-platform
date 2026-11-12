/**
 * KLS-2c-1b1, unconfirmed writes ([2C1-12], [2C1-14], the split ruling's §7 `unconfirmed`): a note write whose records committed
 * while its file could not be written (the person's notes folder is read-only) is left as the file is; the next
 * reconciliation sends one `knowledge_write_unconfirmed` notice of one write, and a later one sends no second notice
 * and counts no new item. Through the published `platform.knowledge.reconcile` and the decision queue's public read.
 * Memory only: a business rule (S3).
 */
import { chmod, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createS4ANoteFixture, type S4ANoteFixture } from '../helpers/S4A-note-fixture.js';

async function projectNotices(f: S4ANoteFixture): Promise<string[]> {
  const read = await f.platform.decisions.queryDecisionQueue(f.ctx(), { workspace: f.scope, sections: ['notices'],
    categories: ['project_notice'], page: { limit: 50 } });
  if (read.status !== 'ready') throw new Error(`decision queue: ${JSON.stringify(read)}`);
  return read.value.notices.map(notice => notice.summary);
}

it('a committed write whose file never landed: one unconfirmed-write notice, the file stays missing, no second notice', async () => {
  const f = await createS4ANoteFixture('memory');
  const notes = join(f.root, '.workbench', 'notes', f.scope.workspaceId);
  try {
    await mkdir(notes, { recursive: true });
    await chmod(notes, 0o555);
    await f.write(f.ctx(), { kind: 'pitfall', topic: 'b1 unconfirmed', conclusion: 'b1 conclusion', body: 'b1 body',
      anchor: { kind: 'file', path: 'src/a/x.ts' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
      replaces: [], contradicts: [], coexistWith: [] }, null);
    await chmod(notes, 0o755);

    const first = await f.platform.knowledge.reconcile(f.ctx(), f.scope.workspaceId, 'idle');
    expect(first).toMatchObject({ status: 'ready', value: { unconfirmed: 1 } });
    expect(await projectNotices(f)).toEqual(['平台有 1 次写没确认落盘']);
    expect(await readdir(notes)).toEqual([]);

    const second = await f.platform.knowledge.reconcile(f.ctx(), f.scope.workspaceId, 'idle');
    expect(second).toMatchObject({ status: 'ready', value: { unconfirmed: 0 } });
    expect(await projectNotices(f)).toEqual(['平台有 1 次写没确认落盘']);
  } finally {
    await chmod(notes, 0o755).catch(() => undefined);
    await f.close();
  }
});
