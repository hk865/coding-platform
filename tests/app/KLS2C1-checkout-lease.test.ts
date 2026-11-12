/**
 * KLS-2c-1 K22 ([2C1-04], R6): while another Host holds this checkout's knowledge lease, a write is refused and
 * nothing is written; once it lets go, the same write goes through. Two SQLite Hosts in this process, two projects
 * (two project stores, KLS-1a) on one git checkout root. Both get a very large idle threshold (errata 2c1#9), so no
 * idle reconcile takes the lease. A carries `holdGate('committed')` (the build's seam, [2C1-08]): its `notes/write`
 * has committed its records and waits before the first file lands, holding the lease ([2C1-09] order).
 * SQLite only: two Hosts each with its own project store.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { holdGate, openKLS2CHost, type KLS2CHost } from '../helpers/KLS2C-knowledge-host.js';

const NEVER_IDLE_MS = 24 * 60 * 60 * 1000;
const A: CoreScope = { projectId: 'kls2c1-k22-a', workspaceId: 'kls2c1-k22-a-ws' };
const B: CoreScope = { projectId: 'kls2c1-k22-b', workspaceId: 'kls2c1-k22-b-ws' };

type NoteWriteAnswer = { write: { status: string; code?: string; reason?: string; noteId?: string } };

const releases: (() => void)[] = [];
const hosts: KLS2CHost[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const world of hosts.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

/** A person's convention note on `src/module.ts` (a file anchor, so the note has its own file). */
const noteWrite = (scope: CoreScope, commandId: string, topic: string) => plain(scope, {
  commandId, goalId: null, expectedPointerRevision: null,
  note: {
    kind: 'convention', topic, conclusion: `${topic} conclusion`, body: `${topic} body`,
    anchor: { kind: 'file', path: 'src/module.ts' }, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [],
  },
});

/** The note files of one Host's workspace on disk: `.workbench/notes/<workspaceId>/*.md`. */
function noteFiles(world: KLS2CHost): string[] {
  try {
    return readdirSync(join(world.root, '.workbench', 'notes', world.scope.workspaceId)).filter(name => name.endsWith('.md'));
  } catch {
    return [];
  }
}

it('K22 another Host holds the checkout lease: B\'s write is unavailable and unwritten, and goes through after A lets go', async () => {
  const gate = holdGate('committed');
  releases.push(gate.release);
  const a = await openKLS2CHost({ storage: 'sqlite', git: true, scope: A, idleMs: NEVER_IDLE_MS, hold: gate.hold });
  hosts.push(a);
  const b = await openKLS2CHost({ storage: 'sqlite', git: true, root: a.root, scope: B, idleMs: NEVER_IDLE_MS });
  hosts.push(b);

  const aWrite = a.call<NoteWriteAnswer>('notes/write', noteWrite(A, 'k22-a', 'k22-a'));
  aWrite.catch(() => undefined);
  expect(await Promise.race([gate.reached.then(() => 'held'), aWrite.then(() => 'answered')])).toBe('held');

  const refused = await b.call<NoteWriteAnswer>('notes/write', noteWrite(B, 'k22-b-1', 'k22-b'));
  expect(refused.write).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(refused.write.reason).toContain('另一个 Host');
  expect(noteFiles(b)).toEqual([]);

  gate.release();
  expect((await aWrite).write.status).toBe('accepted');
  const retried = await b.call<NoteWriteAnswer>('notes/write', noteWrite(B, 'k22-b-2', 'k22-b'));
  expect(retried.write.status).toBe('accepted');
  expect(noteFiles(b)).toEqual([`${retried.write.noteId}.md`]);
}, 120_000);
