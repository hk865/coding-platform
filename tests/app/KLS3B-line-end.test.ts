/**
 * KLS-3b (test writer, decision 117): rows 3B-02..07 and 3B-09 of the start rulings draft v2 §3, the line's end and
 * its branch refresh as the person sees them, plus the two gap rows of run `7d2-gapkls3b` (#40 a switch to another
 * branch and back; #42 the end at an idle round, with every heartbeat idle). The world: one `openKLS2CHost` (memory, a
 * real git root on `main`) whose idle threshold no row reaches, so the Host judges its lines only at the named safe
 * points; the person adds a `git worktree add -b wt` checkout and opens it inside the project (`workspaces/open`, the
 * join). Each row then does real git (commits, merges, a removed worktree, a deleted branch, a branch switch), opens
 * the main root again (the already-bound open is a safe point: the sweep runs before it answers, draft §2.5) and reads
 * `workspaces/lines`. Expected values are the rulings' literals (`merged`/`removed`/`open`; the base line is the
 * earliest, ruling 1; a branch switch resets the fork point to the HEAD then, ruling 7) and the test's own git.
 *
 * Red today (a2b618dd): there is no join, so the worktree opens as a workspace of its own and the main workspace has
 * one line (every row stops at the line lookup); nothing judges a line's end or refreshes its branch either. Green when
 * KLS-3b lands the join, `sweepLines` at the open, `nextLineStatus`, `settleLine` and the branch refresh in
 * `registerHostLine`/`registerLine`. None of the named mutations below can be shown on today's tree (they all live in
 * the package).
 */
import { chmodSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LineSnapshot } from '../../src/contracts/line.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { KLS2C_NEVER_IDLE_MS, openKLS2CHost, type KLS2CHost } from '../helpers/KLS2C-knowledge-host.js';
import { commitFile, joinCheckout, mergeBranch, removeWorktree, workspaceLines } from '../helpers/KLS3B-git-lines.js';
import { addGitWorktree, gitIn } from '../scenarios/support/git-workspace.js';

type TwoLines = { world: KLS2CHost; root: string; wt: string };

const hosts: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of hosts.splice(0)) await world.close();
  await cleanupRestart();
});

async function openTwoLines(): Promise<TwoLines> {
  const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS });
  hosts.push(world);
  const wt = addGitWorktree(world.root, join(await tempDir('kls3b-wt-'), 'wt'), 'wt');
  await joinCheckout(world.settings, world.scope.projectId, wt);
  return { world, root: realpathSync(world.root), wt };
}

/** The person opens the main root again (a safe point); then the main workspace's line at each folder. */
async function linesAfterOpen(lines: TwoLines, ...folders: string[]): Promise<LineSnapshot[]> {
  await joinCheckout(lines.world.settings, lines.world.scope.projectId, lines.root);
  const read = await workspaceLines(lines.world.call, lines.world.scope, lines.world.scope.workspaceId);
  return folders.map(folder => {
    const line = read.find(candidate => candidate.folder === folder);
    if (line === undefined) throw new Error(`no line at ${folder} in the main workspace: ${JSON.stringify(read)}`);
    return line;
  });
}

/** `[status, closed]` of a line: a line that ended has a `closedAt`, an open one has none. */
const ending = (line: LineSnapshot): [string, boolean] => [line.status, line.closedAt !== null];

describe('KLS-3b a line ends when its work is merged back, its folder or branch goes, never on its own base', () => {
  it.each<[string, (lines: TwoLines) => void, string]>([
    /* 3B-02. Named mutations: the already-bound open does not run `sweepLines`, or the sweep asks `isAncestor` with
     * the base and the line swapped — wt stays open. (Dropping a merge guard makes more lines merge; 3B-03..05 and
     * 3B-10 catch those.) */
    ['3B-02 both branches commit, wt is merged into main, both trees clean: wt is merged', ({ root, wt }) => {
      commitFile(wt, 'src/wt.ts', 'export const wt = 1;\n');
      commitFile(root, 'src/main.ts', 'export const main = 1;\n');
      mergeBranch(root, 'wt');
    }, 'merged'],
    /* 3B-03. Named mutation: drop `head === forkPoint` — a line just opened (an ancestor of main, clean) is merged. */
    ['3B-03 a line just opened, no commit of its own yet: wt is open', () => undefined, 'open'],
    /* 3B-04 (design rule 19). Named mutation: the sweep judges the base line like any other line (`isBaseLine` false) — the
     * main line (moved past its fork point, its own ancestor, clean) is merged. */
    ['3B-04 only the base line commits: both lines are open', ({ root }) => {
      commitFile(root, 'src/main.ts', 'export const main = 1;\n');
    }, 'open'],
    /* 3B-06. Named mutation: the sweep skips a line whose folder is gone, or `nextLineStatus` drops the folder and
     * branch rule — wt stays open. */
    ['3B-06 the person removes the worktree: wt is removed', ({ root, wt }) => removeWorktree(root, wt), 'removed'],
    /* 3B-07. Named mutation: drop `branchExists` — wt stays open. The branch ref goes while the folder still names it
     * (a detached HEAD would be a branch switch to `HEAD`, which the refresh records, draft §1 4). */
    ['3B-07 the line\'s branch is deleted, its folder stays: wt is removed', ({ root }) => {
      gitIn(root, 'update-ref', '-d', 'refs/heads/wt');
    }, 'removed'],
  ])('%s', async (_row, arrange, expected) => {
    const lines = await openTwoLines();
    arrange(lines);
    const [main, wt] = await linesAfterOpen(lines, lines.root, lines.wt);
    expect([ending(main!), ending(wt!)]).toEqual([['open', false], [expected, expected !== 'open']]);
  });

  it('3B-05 uncommitted code in the merged line keeps it open; once the tree is clean it is merged (design rule 11)', async () => {
    /* Named mutation: `nextLineStatus` drops the `worktreeClean` check — merged at the first open. */
    const lines = await openTwoLines();
    commitFile(lines.wt, 'src/wt.ts', 'export const wt = 1;\n');
    mergeBranch(lines.root, 'wt');
    writeFileSync(join(lines.wt, 'src/draft.ts'), 'export const draft = 1;\n');
    const [dirty] = await linesAfterOpen(lines, lines.wt);
    rmSync(join(lines.wt, 'src/draft.ts'));
    const [clean] = await linesAfterOpen(lines, lines.wt);
    expect([ending(dirty!), ending(clean!)]).toEqual([['open', false], ['merged', true]]);
  });

  it('3B-07 (lead 11-14) a line whose folder git cannot read for a while keeps its branch and stays open', async () => {
    /* Named mutations: `registerHostLine` refreshes on an `unreadable` probe (wt reads branch '' while locked), or
     * `sweepLines` reads an `unreadable` HEAD as a gone branch (wt is removed). The person locks the folder (no
     * permission); git cannot enter it and says so, which is not "no repository". */
    const lines = await openTwoLines();
    chmodSync(lines.wt, 0o000);
    const locked = await linesAfterOpen(lines, lines.wt).finally(() => chmodSync(lines.wt, 0o755));
    const back = await linesAfterOpen(lines, lines.wt);
    expect([locked, back].map(([line]) => [line!.branch, ...ending(line!)]))
      .toEqual([['wt', 'open', false], ['wt', 'open', false]]);
  });

  it('3B-09 the base line switches to `next`: its branch and fork point follow, and a line merged into `next` is merged', async () => {
    /* Named mutation: `registerHostLine`/`registerLine` does not refresh with `nextLineIdentity` — the base line stays
     * on `main` with its first fork point. */
    const lines = await openTwoLines();
    const { root } = lines;
    gitIn(root, 'checkout', '-q', '-b', 'next');
    commitFile(root, 'src/next.ts', 'export const next = 1;\n');
    const switched = gitIn(root, 'rev-parse', 'HEAD').trim();
    await linesAfterOpen(lines, root);
    const wt2 = addGitWorktree(root, join(await tempDir('kls3b-wt2-'), 'wt2'), 'wt2');
    await joinCheckout(lines.world.settings, lines.world.scope.projectId, wt2);
    commitFile(wt2, 'src/wt2.ts', 'export const wt2 = 1;\n');
    mergeBranch(root, 'wt2');
    const [base, wt, second] = await linesAfterOpen(lines, root, lines.wt, wt2);
    expect([base!.branch, base!.forkPoint, base!.revision, ending(base!)]).toEqual(['next', switched, 2, ['open', false]]);
    expect([ending(wt!), ending(second!)]).toEqual([['open', false], ['merged', true]]);
  });

  it('#40 a line switching to another branch and back stays one line, refreshed to revision 2 and then 3', async () => {
    /* Named mutation: `src/app/host.ts:1103` drops the line revision from `identity` — the switch back to `wt` at HEAD
     * H replays the line's first registration, so the line stays on `other` at revision 2. */
    const lines = await openTwoLines();
    const head = gitIn(lines.wt, 'rev-parse', 'HEAD').trim();
    gitIn(lines.wt, 'checkout', '-q', '-b', 'other');
    const [other] = await linesAfterOpen(lines, lines.wt);
    expect(gitIn(lines.wt, 'rev-parse', 'HEAD').trim()).toBe(head);
    gitIn(lines.wt, 'checkout', '-q', 'wt');
    const [back] = await linesAfterOpen(lines, lines.wt);
    expect([other!.branch, other!.revision, other!.status]).toEqual(['other', 2, 'open']);
    expect([back!.branch, back!.revision, back!.status]).toEqual(['wt', 3, 'open']);
    expect([other!.closedAt, back!.closedAt]).toEqual([null, null]);
  });

  it('#42 an idle round ends the line whose worktree was removed and leaves the main line open', async () => {
    /* Named mutation: `src/app/host.ts:3853` drops the idle job's `await sweepLines(workspace.scope)` — no safe point
     * judges the removed folder, so the line stays `open` through every idle round. */
    const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: 0 });
    hosts.push(world);
    const root = realpathSync(world.root);
    const wt = addGitWorktree(root, join(await tempDir('kls3b-idle-wt-'), 'wt'), 'wt');
    await joinCheckout(world.settings, world.scope.projectId, wt);
    const read = async (): Promise<LineSnapshot[]> =>
      await workspaceLines(world.call, world.scope, world.scope.workspaceId);
    expect((await read()).length).toBe(2);
    removeWorktree(root, wt);
    let lines = await read();
    for (let round = 0; round < 20; round += 1) {
      await world.idle();
      lines = await read();
      if (lines.find(line => line.folder === wt)?.status === 'removed') break;
    }
    const wtLine = lines.find(line => line.folder === wt);
    const main = lines.find(line => line.folder === root);
    expect([wtLine?.status, wtLine?.closedAt !== null]).toEqual(['removed', true]);
    expect([main?.status, main?.closedAt !== null]).toEqual(['open', false]);
  });
});
