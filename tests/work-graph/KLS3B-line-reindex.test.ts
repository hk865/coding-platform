/**
 * KLS-3b (test writer, decision 117): row 3B-11 of the start rulings draft v2 §3. Once a line is merged back, the
 * knowledge is reconciled on that line's own folder (lead ruling KLS-3b 5 and 6; draft §1 5, §2.6): the platform port
 * the Host calls after `settleLine('merged')`, `platform.knowledge.reconcile(ctx, workspaceId, 'line_merged', line)`,
 * indexes the merged line's files and answers for that line, not for the main one. The world is `openKLS2AWorld` (a
 * real platform over a real git root, memory): the reconcile port is a platform owner no Host route publishes, as in
 * the KLS-2c reconcile rows. Its two lines come from the public owner `projects.registerLine` (`registerKLS2ALine`,
 * as the KLS-3a1 rows), the second a `git worktree add -b wt` checkout. In `wt` a person puts down one note file
 * (`noteFileText`, the [2A1-13] file form) and commits it; `wt` is merged into `main`. Expected values: the trigger
 * is the ruling's literal; the line key is `canonicalJson([workspaceId, folder])` (KLS-3a ruling 2), here
 * `JSON.stringify([workspaceId, wt])`; the never-indexed line has at least that one new file.
 *
 * Red today (a2b618dd): `reconcile` takes no line (and `ReconcileTrigger` has no `line_merged`), so the round runs on
 * the workspace's main line and answers its `lineRef`. Green when KLS-3b passes the line through `reconcile`,
 * `KnowledgeLines.line` and `resolveKnowledgeLine`.
 * Named mutation: `resolveKnowledgeLine` ignores the given line (the workspace root, the main line) — `lineRef` is the
 * main line's. Shown today: it is today's behaviour, and the row is red at `lineRef`.
 */
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kls3a1Checkout, openKLS2AWorld, registerKLS2ALine, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { noteFileText } from '../helpers/KLS2C-knowledge-host.js';
import { must } from '../helpers/KLS3A1-gap-world.js';
import { commitFile, mergeBranch } from '../helpers/KLS3B-git-lines.js';
import { addGitWorktree } from '../scenarios/support/git-workspace.js';

const worlds: KLS2AWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('KLS-3b 3B-11 the merged line is reconciled on its own folder', () => {
  it('3B-11 reconcile(\'line_merged\', wt) answers the trigger, wt\'s line key and its new file', async () => {
    const world = await openKLS2AWorld();
    worlds.push(world);
    must('main line', await registerKLS2ALine(world, world.root, 'kls3b-11-main'));
    const wt = addGitWorktree(world.root, join(dirname(world.root), 'wt'), 'wt');
    must('wt line', await registerKLS2ALine(world, wt, 'kls3b-11-wt'));
    commitFile(wt, `.workbench/notes/${world.workspaceId}/kls3b-11.md`, noteFileText({ kind: 'convention', topic: 'KLS3B 合回线的约定', conclusion: '合回后重新索引',
      body: '在 wt 线上写的', anchor: { kind: 'file', path: 'src/a.ts' }, source: { kind: 'user', principalId: 'teammate' } }));
    mergeBranch(world.root, 'wt');
    const { line } = kls3a1Checkout(wt);
    const answer = await world.platform.knowledge.reconcile(world.ctx(), world.workspaceId, 'line_merged',
      { repoKey: line.repoKey, folder: line.folder, branch: line.branch });
    if (answer.status !== 'ready') throw new Error(`reconcile: ${JSON.stringify(answer)}`);
    expect([answer.value.trigger, answer.value.lineRef, answer.value.changed >= 1])
      .toEqual(['line_merged', JSON.stringify([world.workspaceId, wt]), true]);
  });
});
