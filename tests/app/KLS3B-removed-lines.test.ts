/**
 * KLS-3b (test writer, decision 117): row 3B-08 of the start rulings draft v2 §3. A workspace that leaves the project
 * ends its lines with it (wd ruling 3, 121-90; draft §1 6): after the person withdraws the second workspace (wd's
 * `workspaces/withdraw`, before it entered the architecture graph), the project's `workspaces/lines` shows that
 * workspace's line `removed` with a `closedAt`, the main workspace's line still open, and no record gone. The world is
 * wd's (`openDwdWorld`: the XWS2A second workspace opened through `workspaces/open`, memory); the read is from the main
 * workspace without a `workspaceId` (the whole project). After that the person opens the main root again (a safe point
 * that sweeps the project) and the lines read the same.
 *
 * Red today (a2b618dd): the withdrawal stamps `removedAt` on the workspace but nothing ends its line, so the second
 * workspace's line is still `open`. Green when KLS-3b's Host `removeWorkspace` runs `sweepLines`, which reads
 * `removedAt` and settles every open line of that workspace `removed`.
 * Named mutations: `sweepLines` ignores `removedAt`, or the Host's `removeWorkspace` does not call it — the second line
 * stays open (not shown: both live in the package).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LineSnapshot } from '../../src/contracts/line.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openDwdWorld, remove, type DwdWorld } from '../helpers/S7D2-DWD-world.js';

const worlds: DwdWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

describe('KLS-3b 3B-08 a withdrawn workspace\'s lines end with it', () => {
  it('3B-08 the second workspace\'s line is removed, the main one stays open, no line record goes', async () => {
    const world = await openDwdWorld({ backend: 'memory' });
    worlds.push(world);
    const second = world.second.scope.workspaceId;
    /** `[workspace, status, closed]` of each line of the project, by workspace name (the read's order is not the row's). */
    const projectLines = async (): Promise<[string, string, boolean][]> => valueOf<{ lines: LineSnapshot[] }>(
      (await world.base.world.post('workspaces/lines', plain(S6A_SCOPE, {}))).body, 'ready', 'the project lines').lines
      .map((line): [string, string, boolean] => [line.ref.workspaceId === S6A_SCOPE.workspaceId ? 'main'
        : line.ref.workspaceId === second ? 'second' : line.ref.workspaceId, line.status, line.closedAt !== null])
      .sort(([a], [b]) => a.localeCompare(b));
    expect(await projectLines()).toEqual([['main', 'open', false], ['second', 'open', false]]);
    expect((await remove(world, 'withdraw')).status).toBe('ready');
    expect(await projectLines()).toEqual([['main', 'open', false], ['second', 'removed', true]]);
    const reopened = await world.base.world.settings('workspaces/open', { path: world.base.world.root,
      projectId: S6A_SCOPE.projectId, writeAllowed: false, commandsAllowed: false });
    expect(reopened.status).toBe('ready');
    expect(await projectLines()).toEqual([['main', 'open', false], ['second', 'removed', true]]);
  });
});
