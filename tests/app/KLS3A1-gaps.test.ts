/**
 * KLS-3a1 gap rows C1–C3 (Astra fix 3, `7d2-kls3a1b-reply.md` §I). A bound, registered workspace whose checkout could
 * not be named when the records were written gets its line on the next open (C1, `host.ts:2173`) and at the next Host
 * start (C2, `host.ts:2525`); a folder with no Workspace record keeps today's flow (C3, `host.ts:1071`). The start-up
 * config lists the scope on `root` and passes `database`, which makes `openKLS2CHost` skip its own records
 * (`KLS2C-knowledge-host.ts:124`), so the row writes them itself. A start-up root must resolve, so each row starts
 * with the folder present, removes it while the records are written, and has a git checkout when the open/start runs.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { kls3a1Checkout } from '../helpers/KLS2A-knowledge-world.js';
import { openKLS2CHost, type KLS2CHost } from '../helpers/KLS2C-knowledge-host.js';
import { lineRecordFor } from '../helpers/KLS3A1-gap-world.js';
import { gitIn, initGitWorkspace } from '../scenarios/support/git-workspace.js';
import { projectRef, workspaceRef } from './support/S8A-L8-host.js';

const hosts: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of hosts.splice(0)) await world.close();
  await cleanupRestart();
});

/** One Host whose start-up config lists `scope` on `root`; `database` makes the helper create no records. */
async function openHost(storage: 'memory' | 'sqlite', root: string, database: string): Promise<KLS2CHost> {
  const world = await openKLS2CHost({ storage, git: false, root, database });
  hosts.push(world);
  return world;
}

/** The person's two records: the Project (rev 0), then the Workspace (project rev 1, workspace rev 0). */
async function registerScope(world: KLS2CHost): Promise<void> {
  const scope = world.scope;
  for (const [suffix, input, expected] of [
    ['projects/create', { projectId: scope.projectId }, [{ ref: projectRef(scope), revision: 0 }]],
    ['workspaces/register', { workspace: scope },
      [{ ref: projectRef(scope), revision: 1 }, { ref: workspaceRef(scope), revision: 0 }]],
  ] as [string, unknown, unknown[]][]) {
    const answer = await world.call<{ status: string }>(suffix, graphWrite(scope, input, `kls3a1-gaps-${suffix}`, expected));
    expect(answer.status, JSON.stringify(answer)).toBe('committed');
  }
}

/** `workspaces/lines` of the world's workspace: its lines, or the row fails with the answer. */
async function linesOf(world: KLS2CHost): Promise<unknown[]> {
  const read = await world.call<{ status: string; value?: { lines: unknown[] } }>('workspaces/lines',
    plain(world.scope, { workspaceId: world.scope.workspaceId }));
  if (read.status !== 'ready' || read.value === undefined) throw new Error(`workspaces/lines: ${JSON.stringify(read)}`);
  return read.value.lines;
}

describe('KLS-3a1 gaps: the line of a bound workspace, on open, on restart, and the no-record shortcut', () => {
  it('C1 a bound, registered workspace whose root was absent at registration gets its line on the next open', async () => {
    /* Named mutation: `host.ts:2173` `registerHostLine(...)` -> `null`; the open stays `ready`, `workspaces/lines` `[]`. */
    const root = join(await tempDir('kls3a1-gaps-c1-'), 'repo');
    mkdirSync(root);
    const world = await openHost('memory', root, await tempDir('kls3a1-gaps-c1-store-'));
    rmSync(root, { recursive: true, force: true });
    await registerScope(world);
    mkdirSync(root, { recursive: true });
    await initGitWorkspace(root);
    gitIn(root, 'commit', '--allow-empty', '-q', '-m', 'kls3a1 gap');
    const { line, head } = kls3a1Checkout(root);
    const opened = await world.settings<{ status: string; value?: { scope: CoreScope } }>('workspaces/open',
      { path: root, writeAllowed: false, commandsAllowed: false });
    expect(opened.status, JSON.stringify(opened)).toBe('ready');
    expect(opened.value?.scope).toEqual(world.scope);
    expect(await linesOf(world)).toEqual([lineRecordFor(world.scope, line, head)]);
  });

  it('C2 the same workspace gets its line at the next Host start after a restart', async () => {
    /* Named mutation: delete the `registerHostLine` call at `host.ts:2525`; the restart's `workspaces/lines` is `[]`.
     * SQLite only (in-process reopen, no `npm run build`). The folder is inside the `base` repository so the project
     * store in its git common dir survives the folder's removal; an independent checkout's store would go with it. */
    const base = await tempDir('kls3a1-gaps-c2-');
    await initGitWorkspace(base);
    const root = join(base, 'repo');
    const database = await tempDir('kls3a1-gaps-c2-store-');
    mkdirSync(root);
    const first = await openHost('sqlite', root, database);
    rmSync(root, { recursive: true, force: true });
    await registerScope(first);
    hosts.splice(hosts.indexOf(first), 1);
    await first.close();
    mkdirSync(root);
    const { line, head } = kls3a1Checkout(root);
    const reopened = await openHost('sqlite', root, database);
    expect(await linesOf(reopened)).toEqual([lineRecordFor(reopened.scope, line, head)]);
  });

  it("C3 a folder with no Workspace record keeps today's flow: the open is ready with the config scope", async () => {
    /* Named mutation: delete the `not_found` guard at `host.ts:1071`; the open answers `unavailable` with
     * "the workspace line could not be registered: ..." instead of keeping today's flow. */
    const root = await tempDir('kls3a1-gaps-c3-');
    const world = await openHost('memory', root, await tempDir('kls3a1-gaps-c3-store-'));
    const opened = await world.settings<{ status: string; reason?: string }>('workspaces/open',
      { path: root, writeAllowed: false, commandsAllowed: false });
    expect(opened.status, JSON.stringify(opened)).toBe('ready');
  });
});
