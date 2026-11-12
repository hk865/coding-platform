/**
 * KLS-2c-1 K17 ([2C1-07], [2C1-12], [2C1-16]): the startup reconcile finishes a knowledge write whose Host died after
 * the files landed. A real Host adopts `core` and closes; a child Host from `dist/` on the same project store and root
 * takes a person's `notes/write` on `module:core` and is killed at `applied` (`crashAt`, [2C1-08]: every file landed,
 * the completion not recorded); a new Host starts on the same store and root with an idle threshold no heartbeat
 * reaches, so only its startup reconcile runs. The file is already what the write meant: the write is completed
 * without a notice, the file is left as it is, and the note is indexed and reads. Completed, not left pending: the
 * Host closes, a person edits the note, and a Host started again on them sends no unconfirmed-write notice.
 * F1 (2c-1d, split ruling §7 and the d rulings' F-1): an architecture revision killed after its commit, before its
 * files (`crashAt` at `committed`), is handed to the person by the startup reconcile ([2C1-12]: a recovery item,
 * the logs `unconfirmed`); from then on the files rule, so the current architecture read and the note read answer
 * and a write on that line goes through: only a `pending` log is in flight. F2 (lead after the merge): the reads look
 * at the logs of each workspace's current line only, so the same crash left on one branch does not stop the reads of
 * another branch the person switched to before the restart (its logs stay `pending` on the first branch).
 * SQLite only (a killed Host and a new one on its store); `npm run build` first (the child runs `dist/`).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { gitIn } from '../scenarios/support/git-workspace.js';
import {
  crashAt, kls2cAdopt, kls2cNoteWrite, kls2cReviseBody, KLS2C_SCOPE, openKLS2CHost, type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';

const CORE = { kind: 'module', moduleId: 'core' } as const;
const TOPIC = 'k17 崩溃时的写';
const NOTES = `.workbench/notes/${KLS2C_SCOPE.workspaceId}`;
/** An idle threshold no heartbeat of a row reaches (a day). */
const STARTUP_ONLY_MS = 24 * 60 * 60 * 1000;

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  await cleanupRestart();
});

it('K17 a write killed after its files landed is completed by the startup reconcile: no notice, the file stays, the note reads', async () => {
  const first = await openKLS2CHost({ storage: 'sqlite', git: true });
  const { database, root } = first;
  await kls2cAdopt(first, ['core']);
  await first.close();
  await crashAt({ point: 'applied', database, root, write: call => {
    void call('notes/write', kls2cNoteWrite(KLS2C_SCOPE, 'kls2c1-k17', { topic: TOPIC, anchor: CORE }));
  } });
  const folder = join(root, NOTES);
  const landed = (existsSync(folder) ? readdirSync(folder) : []).filter(name => name.endsWith('.md'));
  expect(landed).toHaveLength(1);
  const name = landed[0]!;
  const bytes = readFileSync(join(folder, name));

  // A very large idle threshold: only the startup reconcile runs on this Host.
  const world = await openKLS2CHost({ storage: 'sqlite', git: true, database, root, idleMs: STARTUP_ONLY_MS });
  worlds.push(world);
  expect(await world.notices('knowledge_write_unconfirmed')).toEqual([]);
  expect(world.read(`${NOTES}/${name}`)).toEqual(bytes);
  const page = await world.call<{ status: string; value?: { items: { noteId: string; topic: string }[] } }>(
    'notes/list', plain(world.scope, { anchor: CORE, limit: 100, cursor: null }));
  expect(page.value?.items.find(item => item.noteId === name.slice(0, -'.md'.length))?.topic, JSON.stringify(page))
    .toBe('k17 崩溃时的写');

  // The write is completed, not left pending: a person's later edit of the note is no unconfirmed write at the next start.
  await worlds.pop()?.close();
  const text = bytes.toString('utf8');
  if (!text.includes('"conclusion": "k17 崩溃时的写 结论"')) throw new Error(`the note file has no k17 conclusion: ${text}`);
  writeFileSync(join(folder, name), text.replace('"conclusion": "k17 崩溃时的写 结论"', '"conclusion": "k17 人后来改的结论"'));
  const reopened = await openKLS2CHost({ storage: 'sqlite', git: true, database, root, idleMs: STARTUP_ONLY_MS });
  worlds.push(reopened);
  expect(await reopened.notices('knowledge_write_unconfirmed')).toEqual([]);
}, 180_000);

/** A Host adopts `core` and closes; a child Host's `set_responsibility` revision is killed after its commit, before its files. */
async function revisionKilledBeforeFiles(requestId: string): Promise<{ database: string; root: string }> {
  const first = await openKLS2CHost({ storage: 'sqlite', git: true });
  const { database, root } = first;
  await kls2cAdopt(first, ['core']);
  const revise = await kls2cReviseBody(first, 'core', '没落盘的职责', requestId);
  await first.close();
  await crashAt({ point: 'committed', database, root, write: call => { void call('architecture/revise', revise); } });
  return { database, root };
}

/** `architecture/read` of the current revision: the module responsibilities, the whole answer when not ready. */
async function responsibilities(world: KLS2CHost): Promise<unknown> {
  const read = await world.call<{ status: string; value?: { catalog: { catalog: { modules: { responsibility: string }[] } } } }>(
    'architecture/read', plain(world.scope, { selection: { kind: 'current' } }));
  return read.value?.catalog.catalog.modules.map(module => module.responsibility) ?? read;
}

it('F1 an architecture revision killed before its files is handed to the person at startup (`unconfirmed`): the '
  + 'architecture read and the note read answer from the files, and a write on the line goes through', async () => {
  const { database, root } = await revisionKilledBeforeFiles('kls2c1-f1-revise');
  const world = await openKLS2CHost({ storage: 'sqlite', git: true, database, root, idleMs: STARTUP_ONLY_MS });
  worlds.push(world);
  expect(await world.notices('knowledge_write_unconfirmed')).toHaveLength(1);
  expect(await responsibilities(world)).toEqual(['own core']);
  const page = await world.call<{ status: string }>('notes/list', plain(world.scope, { anchor: CORE, limit: 100, cursor: null }));
  expect(page.status, JSON.stringify(page)).toBe('ready');
  const written = await world.call<{ write?: { status: string } }>('notes/write',
    kls2cNoteWrite(KLS2C_SCOPE, 'kls2c1-f1-note', { topic: 'f1 之后的注记', anchor: CORE }));
  expect(written.write?.status, JSON.stringify(written)).toBe('accepted');
});

it('F2 an architecture revision killed before its files on one branch: after a switch to another branch and a restart '
  + 'its logs stay pending there, and the architecture read of the new branch answers', async () => {
  const { database, root } = await revisionKilledBeforeFiles('kls2c1-f2-revise');
  gitIn(root, 'checkout', '-q', '-b', 'kls2c1-f2-other');
  const world = await openKLS2CHost({ storage: 'sqlite', git: true, database, root, idleMs: STARTUP_ONLY_MS });
  worlds.push(world);
  expect(await world.notices('knowledge_write_unconfirmed')).toEqual([]);
  expect(await responsibilities(world)).toEqual(['own core']);
});
