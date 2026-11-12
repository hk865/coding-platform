/**
 * KLS-2c-2a B's entry through a real Host (K36; [2C2-10], [2C2-11]; errata 2c2#1, #13). Project A writes a note on
 * its checkout R; project B, already a Host project on a folder of its own, joins R through the settings route
 * `workspaces/open {projectId: B, path: R, writeAllowed: true, commandsAllowed: false}`. B gets its own scope back; in B
 * the note waits to be verified because B joined a checkout another project already had, and A's read of the same note
 * is unchanged. R is A's second workspace and the note is on a file there; B reads R as its own second workspace. No
 * Host route reads a note by noteId (`notes/list` lists record heads, and B has no record of A's note), so the reads are
 * the public owner `notes.readNote` of each project's platform, as KLS2C1 K02 reads it. The platforms come from an A3
 * delegating wrapper at the platform factory (the shape of `S7B2-WK-restart.test.ts`): it keeps what the factory built,
 * in build order (A at the Host's start, B when its folder opens a new project), and returns it unchanged. Index rows:
 * memory and SQLite.
 *
 * The last row is the builder's (memory; merged here at the dedupe; the lead's ruling after the 2c-2a test hand-back,
 * item 3): B joins the checkout that is A's main workspace. B reads A's `architecture.json` as a second workspace's (the
 * baseline it carries left out, B's own baseline read), B's write carries that baseline back as it is, and A reads as
 * before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import type { ProjectPlatform } from '../../src/composition/project-runtime.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { hostCtx } from '../helpers/KLS1A-project-store-fixture.js';
import { plain, readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cAdoptBody, kls2cNoteWrite, kls2cReviseResponsibility, openKLS2CHost, type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';
import { initGitWorkspace } from '../scenarios/support/git-workspace.js';
import { settingsPost } from './support/S8A-L8-host.js';

const built = vi.hoisted(() => ({ platforms: [] as ProjectPlatform[] }));
vi.mock('../../src/composition/create-platform.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/composition/create-platform.js')>();
  return { ...actual, openTargetPlatform: async (...args: Parameters<typeof actual.openTargetPlatform>) => {
    const made = await actual.openTargetPlatform(...args);
    built.platforms.push(made.platform);
    return made;
  } };
});

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  built.platforms.splice(0);
  await cleanupRestart();
});

/** The world's settings route `workspaces/open`: the scope it opened (any other answer throws). */
async function folderOpener(world: KLS2CHost): Promise<(body: object) => Promise<CoreScope>> {
  const { url } = await world.host.listen();
  const token = await readPageToken(url);
  return async body => {
    const answer = await (await settingsPost(url, 'workspaces/open', token, body)).json() as
      { status: string; value?: { scope: CoreScope } };
    if (answer.status !== 'ready' || answer.value === undefined) throw new Error(`workspaces/open: ${JSON.stringify(answer)}`);
    return answer.value.scope;
  };
}

describe.each(['memory', 'sqlite'] as const)('%s', storage => {
  it('K36 project B joins a checkout of project A: B\'s own scope comes back, A\'s note waits to be verified in B as '
    + 'joined_existing_checkout, and A still reads it unmarked', async () => {
    const world = await openKLS2CHost({ storage, git: true });
    worlds.push(world);
    await kls2cAdopt(world, ['core']);
    const openFolder = await folderOpener(world);
    const root = await tempDir('kls2c2-k36-r-');
    await initGitWorkspace(root);
    const onR = await openFolder({ projectId: world.scope.projectId, path: root, writeAllowed: true, commandsAllowed: false });
    const written = await world.call<{ write: { status: string; noteId?: string } }>('notes/write',
      kls2cNoteWrite(onR, 'kls2c2-k36', { topic: 'k36', anchor: { kind: 'file', path: 'src/module.ts' } }));
    const noteId = written.write.noteId;
    if (written.write.status !== 'accepted' || noteId === undefined) throw new Error(`notes/write: ${JSON.stringify(written)}`);
    const projectB = await openFolder({ path: await tempDir('kls2c2-k36-b-'), writeAllowed: true, commandsAllowed: false });
    await kls2cAdopt({ ...world, scope: projectB }, ['core']);
    const joined = await openFolder({ projectId: projectB.projectId, path: root, writeAllowed: true, commandsAllowed: false });
    expect(joined.projectId).toBe(projectB.projectId);
    expect(built.platforms).toHaveLength(2);
    const [platformA, platformB] = built.platforms;
    await world.idle();
    const inB = await platformB!.notes.readNote(hostCtx(joined.projectId, joined.workspaceId), { noteId });
    // 具名改坏 [2C2-10]「sharedWith 时不调 markJoinedCheckout」→ B 的对账只把它标成 external_edit，红在这一句。
    expect(inB.status === 'ready' ? inB.value.verify : inB)
      .toEqual({ state: 'needs_verification', reason: 'joined_existing_checkout' });
    const inA = await platformA!.notes.readNote(hostCtx(onR.projectId, onR.workspaceId), { noteId });
    // 具名改坏 [2C2-11]「markJoinedCheckout 也标别的项目的索引」→ A 读到待核实，红在这一句。
    expect(inA.status === 'ready' ? inA.value.verify : inA).toBeNull();
  }, 120_000);
});

/** `architecture/read` of the current architecture: its module ids and baseline description, else the answer. */
async function current(world: KLS2CHost, scope: CoreScope): Promise<unknown> {
  const read = await world.call<{ status: string; value?: { baseline: { content: { description: string } };
    catalog: { catalog: { modules: { ref: { moduleId: string } }[] } } } }>(
    'architecture/read', plain(scope, { selection: { kind: 'current' } }));
  return read.status !== 'ready' || read.value === undefined ? read
    : { modules: read.value.catalog.catalog.modules.map(module => module.ref.moduleId),
      description: read.value.baseline.content.description };
}
const baselineInFile = (world: KLS2CHost): unknown =>
  (JSON.parse(world.read('.workbench/architecture.json')?.toString('utf8') ?? '{}') as { baseline?: unknown }).baseline;

it('a checkout that is project A\'s main workspace reads as project B\'s second once B joins it, and B\'s write keeps '
  + 'the baseline A\'s file carries; A reads as before', async () => {
  const world = await openKLS2CHost({ storage: 'memory', git: true });
  worlds.push(world);
  await kls2cAdopt(world, ['core']);
  const openFolder = await folderOpener(world);
  const B = { ...world,
    scope: await openFolder({ path: await tempDir('kls2c2-b-'), writeAllowed: true, commandsAllowed: false }) };
  // B 的 baseline 说明（svc）和 A 的（KLS2C）不同，B 读到的是不是自己主工作区的 baseline 才看得出。
  const adopt = await kls2cAdoptBody(B, ['svc']) as { request: { input: object } };
  expect(await world.call('architecture/adopt-initial', { ...adopt,
    request: { ...adopt.request, input: { ...adopt.request.input, description: 'svc' } } })).toMatchObject({ status: 'committed' });
  expect(await current(world, world.scope)).toEqual({ modules: ['core'], description: 'KLS2C' });
  const joined = await openFolder({ projectId: B.scope.projectId, path: world.root, writeAllowed: false, commandsAllowed: false });
  const baseline = baselineInFile(world);
  expect(baseline).toEqual({ constraints: [], description: 'KLS2C' });
  // Named mutation: a second workspace's file may not carry `baseline` again → B's read is unavailable.
  expect(await current(world, B.scope)).toEqual({ modules: [`/@ws:${joined.workspaceId}/core`, 'svc'], description: 'svc' });
  expect(await world.call('notes/list', plain(B.scope, { anchor: { kind: 'module', moduleId: 'svc' }, limit: 10, cursor: null })))
    .toMatchObject({ status: 'ready', value: { items: [] } });
  expect(await current(world, world.scope)).toEqual({ modules: ['core'], description: 'KLS2C' });
  // B revises its own module: one write plans every line of B, the joined checkout's too.
  await kls2cReviseResponsibility(B, 'svc', 'B 改的职责', 'kls2c2a-revise');
  // Named mutation: a second workspace's file written without the baseline it carried → A's read is unavailable.
  expect(baselineInFile(world)).toEqual(baseline);
  expect(await current(world, world.scope)).toEqual({ modules: ['core'], description: 'KLS2C' });
}, 120_000);
