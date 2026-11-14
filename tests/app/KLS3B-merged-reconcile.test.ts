/**
 * KLS-3b, run `7d2-gapkls3b`, cells #36/#41: the Host's sweep after a line settles `merged` reconciles that line once
 * more (start rulings draft v2 §2.5, §3 row 3B-11; lead ruling 5). Draft 3B-11's literal answer (`ReconcileResult`'s
 * `trigger`/`changed`/`lineRef`) has no public read through the Host: the sweep discards the result and no route
 * publishes it, so this row is the Host-path proxy the lead approved on 11-14, and 3B-11 itself stays as it is
 * (`tests/work-graph/KLS3B-line-reindex.test.ts`). The proxy is what a person sees: the merged line's unreadable note
 * file comes back as the one `knowledge_conflict` notice, and the merged line's note does not appear in the main
 * line's `notes/list`. The world is `openKLS2CHost` (memory, a real git root, an idle threshold no row reaches): the
 * person adds `git worktree add -b wt`, joins it through `workspaces/open`, and on the line commits one valid note file
 * and one unparseable one. The valid note is not headless: its record head comes from the person's `notes/write` on the
 * main line, and the person moves the file itself onto the line and commits it there (a real file move, A1), while a
 * later `knowledge/commit` of another note on the main line reconciles that line and drops the moved file's old main
 * row. Then `wt` is merged into `main` and the main root is opened again — the already-bound open is a safe point whose
 * `sweepLines` settles `merged` and reconciles the line.
 *
 * Named mutations, each separate: (a) `sweepLines` skips the reconcile after a merged settle — no notice, red at the
 * notice count; (b) the reconcile is called without the settled line's `LineRef` — this sweep's reconcile indexes the
 * merged files on the main line, so `notes/list` on the main scope lists the merged note (`needs_verification`/
 * `merged`), red at the empty list. The other assertion stays green under each.
 * (b) only asserts that THIS sweep's reconcile did not land on the main line's index; the main line's own later
 * indexing of the merged note is not this row's rule. If the main line ever rebuilds its index at that same safe point,
 * this row must change its way of telling the two apart, not the product.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { KLS2C_NEVER_IDLE_MS, kls2cAdopt, kls2cNoteWrite, noteFileText, openKLS2CHost, type KLS2CHost } from '../helpers/KLS2C-knowledge-host.js';
import { commitFile, joinCheckout, mergeBranch } from '../helpers/KLS3B-git-lines.js';
import { addGitWorktree } from '../scenarios/support/git-workspace.js';

const hosts: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of hosts.splice(0)) await world.close();
  await cleanupRestart();
});

describe('KLS-3b the Host\'s sweep reconciles the merged line, not the main line', () => {
  it('#36/#41 the merged line\'s bad note is the one conflict notice and its note is absent from the main notes/list', async () => {
    const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
    hosts.push(world);
    const root = realpathSync(world.root);
    // A catalog, so `notes/list` can read a filed note at all (its check resolves the file anchor); committed first, so
    // the worktree starts with it too.
    await kls2cAdopt(world, ['core']);
    world.git(['add', '--', '.workbench/architecture.json', '.workbench/modules']);
    world.git(['commit', '-q', '-m', 'kls3b architecture']);
    const wt = addGitWorktree(root, join(await tempDir('kls3b-merged-wt-'), 'wt'), 'wt');
    await joinCheckout(world.settings, world.scope.projectId, wt);
    const notes = `.workbench/notes/${world.scope.workspaceId}`;
    // The note's record head comes from the person's `notes/write` on the main line; the person then moves the file
    // itself off the main checkout and commits those bytes on `wt` (a real file move, A1), so the file is only on the
    // line.
    const written = await world.call<{ write: { status: string; noteId?: string } }>('notes/write',
      kls2cNoteWrite(world.scope, 'kls3b-merged-good', { topic: 'KLS3B 合回线的注记',
        anchor: { kind: 'file', path: 'src/module.ts' } }));
    const goodPath = written.write.noteId === undefined ? null : `${notes}/${written.write.noteId}.md`;
    if (written.write.status !== 'accepted' || goodPath === null) {
      throw new Error(`notes/write was not accepted: ${JSON.stringify(written)}`);
    }
    const goodText = world.read(goodPath)?.toString('utf8');
    if (goodText === undefined) throw new Error(`the note file ${goodPath} is not on disk`);
    world.remove(goodPath);
    // The person names themselves in this repository before letting the Host commit (KLS2C2's rows do the same).
    world.git(['config', 'user.name', 'KLS3B Person']);
    world.git(['config', 'user.email', 'kls3b-person@example.invalid']);
    // The main line's index still holds the write's row for the moved file; a person's `knowledge/commit` of a new
    // knowledge file on the main line reconciles that line again (the commit route's `after_commit`), which drops it.
    world.edit(`${notes}/kls3b-main.md`, noteFileText({ kind: 'convention', topic: 'KLS3B 主线自己的注记',
      conclusion: '只留在主线', body: '在 main 线上写的', anchor: { kind: 'file', path: 'src/module.ts' },
      source: { kind: 'user', principalId: 'teammate' } }));
    const committed = await world.call<{ status: string }>('knowledge/commit',
      plain(world.scope, { message: 'kls3b main line note' }));
    if (committed.status !== 'ready') throw new Error(`knowledge/commit: ${JSON.stringify(committed)}`);
    commitFile(wt, goodPath, goodText);
    commitFile(wt, `${notes}/kls3b-bad.md`, 'not a knowledge note\n');
    mergeBranch(root, 'wt');
    // The already-bound main root: its sweep settles `wt` as merged and reconciles the merged line.
    await joinCheckout(world.settings, world.scope.projectId, root);
    /* (a) Named mutation: `sweepLines` skips the reconcile after a merged settle — the unreadable file is never read
     * and the queue holds no `knowledge_conflict` notice. */
    const notices = await world.notices('knowledge_conflict');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.summary).toContain(`${notes}/kls3b-bad.md`);
    /* (b) Named mutation: `reconcile(..., workspaceId, 'line_merged')` without the settled line's `LineRef` — the
     * merged good note lands in the main line's index and `notes/list` lists it as needing verification. */
    const listed = await world.call<ReadResult<{ items: unknown[] }>>('notes/list',
      plain(world.scope, { anchor: { kind: 'file', path: 'src/module.ts' }, limit: 100, cursor: null }));
    if (listed.status !== 'ready') throw new Error(`notes/list: ${JSON.stringify(listed)}`);
    expect(listed.value.items).toEqual([]);
  });
});
