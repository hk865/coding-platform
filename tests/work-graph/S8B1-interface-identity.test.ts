/**
 * B1-14 of the frozen test sheet (`darr-b1-tests.frozen.md` §2.1): the two same-named `model`
 * interfaces of modules `one` and `two` keep separate identities and separate members.
 *
 * The world is S8B1-C (`S8B1-count-world.ts`): one real Host, the fixed files, the public
 * catalog adoption and capture. The read is `architecture/query` (the interface/module nodes)
 * and the published `platform.architecture.listFiles` page (the members' paths); ownership is
 * the one public `pathOwnershipOf` rule the capture uses, applied to the sheet's hand-computed
 * expectations.
 *
 * B1-16 and B1-17 are lead rulings R23 and R24 (`darr-rulings-2-1110.md`, review DAR1cr items 1
 * and 2), each in its own world of the same Host (`openS8B1AdoptedWorld`): the row's files, the
 * public adoption of the row's catalog, and the observation the adoption's AUTOMATIC capture writes
 * (no explicit capture). A file's stored owners are read through a `{kind:'file'}` anchor of
 * `architecture/query` at depth 0. Expected literals are hand-computed in each row.
 */
import { afterEach, expect, it } from 'vitest';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { pathOwnershipOf } from '../../src/contracts/path-ownership.js';
import { S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import {
  nodesOf, observedS8B1Handle, openS8B1AdoptedWorld, openS8B1CountWorld, readS8B1FileOwners, readS8B1FilePages,
  readS8B1Neighborhood, s8b1Catalog, type S8B1CountWorld,
} from '../helpers/S8B1-count-world.js';

const opened: S8B1CountWorld[] = [];
afterEach(async () => {
  for (const handle of opened.splice(0).reverse()) await handle.world.close();
});

const adopted: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of adopted.splice(0).reverse()) await world.close();
});

const iface = (moduleId: string, interfaceId: string): string =>
  `interface:${canonicalJson([moduleId, interfaceId] as unknown as never)}`;

/** One member path's owner among the frozen catalog's modules and interfaces (the one rule). */
function ownerOf(path: string): { moduleId: string; interfaceId: string | null } | null {
  const projectId = S6A_SCOPE.projectId;
  const catalog = s8b1Catalog(projectId).modules;
  const candidates = catalog.flatMap(module => [
    { value: { moduleId: module.ref.moduleId, interfaceId: null as string | null }, paths: module.paths },
    ...module.interfaces.map(entry => ({
      value: { moduleId: module.ref.moduleId, interfaceId: entry.id }, paths: entry.paths,
    })),
  ]);
  const ownership = pathOwnershipOf(path, candidates);
  return ownership.status === 'owner' ? ownership.owner : null;
}

it('B1-14 both model interfaces exist with their own members; neither module steals the other', async () => {
  const handle = await openS8B1CountWorld('memory');
  opened.push(handle);
  const value = await readS8B1Neighborhood(handle);
  const nodes = nodesOf(value);
  const nodeIds = nodes.map(node => node['nodeId']);

  // The capture succeeded (the helper's public observation read) and both groups exist; the
  // old bare `interface:model` identity must not appear.
  expect(nodeIds).toContain(iface('one', 'model'));
  expect(nodeIds).toContain(iface('two', 'model'));
  expect(nodeIds).not.toContain('interface:model');

  // The two nodes carry their own content digests, so neither group's members were stolen.
  const oneModel = nodes.find(node => node['nodeId'] === iface('one', 'model'))!;
  const twoModel = nodes.find(node => node['nodeId'] === iface('two', 'model'))!;
  expect(oneModel['contentDigest']).not.toBe(twoModel['contentDigest']);

  // The sheet's members: the two model files belong to the matching interface group, the
  // non-interface files to their module only.
  expect(ownerOf('src/one/model/m.ts')).toEqual({ moduleId: 'one', interfaceId: 'model' });
  expect(ownerOf('src/two/model/m.ts')).toEqual({ moduleId: 'two', interfaceId: 'model' });
  expect(ownerOf('src/one/a.ts')).toEqual({ moduleId: 'one', interfaceId: null });
  expect(ownerOf('src/two/b.ts')).toEqual({ moduleId: 'two', interfaceId: null });

  // The same four paths are the page's real members, never fabricated values.
  const pages = await readS8B1FilePages(handle);
  const paths = pages.nodes.map(node => node['path']);
  expect(paths).toEqual(expect.arrayContaining(['src/one/model/m.ts', 'src/two/model/m.ts',
    'src/one/a.ts', 'src/two/b.ts']));
});

/** The bare interface id of one file's stored owners (`null`: the file is in no interface group). */
function interfaceIdOf(owners: readonly string[]): string | null {
  const node = owners.find(nodeId => nodeId.startsWith('interface:'));
  return node === undefined ? null : (JSON.parse(node.slice('interface:'.length)) as [string, string])[1];
}

/** R23's world: module `src` declares `wide` over all of `src` and two interfaces X and Y on the same `src/x`. */
const TIE_FILES: Readonly<Record<string, string>> = {
  'src/root.ts': 'export const root = 1;\n',
  'src/x/a.ts': 'export const a = 1;\n',
};
const tieCatalog = (projectId: string): { modules: ModuleDefinition[] } => ({ modules: [{
  ref: { projectId, moduleId: 'src' }, name: 'src', responsibility: 'S8B1 R23 interface tie', paths: ['src'],
  interfaces: [
    { id: 'wide', description: 'all of src', paths: ['src'] },
    { id: 'X', description: 'src/x, first claim', paths: ['src/x'] },
    { id: 'Y', description: 'src/x, second claim', paths: ['src/x'] },
  ],
}] });

type ChangeScopeFold = (catalog: unknown, files: Array<{ path: string; certainty: 'definite' | 'possible' }>,
  complete: boolean, sourceCursor: null) => { files: Array<{ path: string; interfaceId: string | null;
    moduleRef: { projectId: string; moduleId: string } | null; certainty: string }> };

it('B1-16 (R23) an X/Y tie stays interface null on the write side, never the shorter wide; change-scope gives the same owners', async () => {
  const world = await openS8B1AdoptedWorld('r23', TIE_FILES, tieCatalog(S6A_SCOPE.projectId));
  adopted.push(world.world);
  const handle = observedS8B1Handle(world);
  const WIDE = iface('src', 'wide');

  // Hand computation (T2): both files are in module `src` (its only path). Among src's interfaces,
  // `src/root.ts` lies only under `wide` ("src"; "src/x" is not its prefix) -> wide. `src/x/a.ts`
  // lies under wide ("src", length 3) and under X and Y ("src/x", length 5); the longest length is a
  // tie, which owns nothing -> interface null. A tie never falls back to the shorter `wide`.
  const rootOwners = await readS8B1FileOwners(handle, 'src/root.ts');
  const tiedOwners = await readS8B1FileOwners(handle, 'src/x/a.ts');
  expect(rootOwners).toEqual([WIDE, 'module:src']);
  expect(tiedOwners).toEqual(['module:src']);

  // Members on the write side: X and Y own no file and have no node; `wide` holds the world's
  // `src/module.ts` and `src/root.ts` but not `src/x/a.ts`, while module `src` holds all three, so the
  // two member digests differ (they would be equal if the tied file had gone to `wide`).
  const nodes = nodesOf(await readS8B1Neighborhood(handle));
  const nodeIds = nodes.map(node => node['nodeId']);
  expect(nodeIds).toEqual(expect.arrayContaining([WIDE, 'module:src']));
  expect(nodeIds).not.toContain(iface('src', 'X'));
  expect(nodeIds).not.toContain(iface('src', 'Y'));
  const digestOf = (nodeId: string): unknown => nodes.find(node => node['nodeId'] === nodeId)?.['contentDigest'];
  expect(digestOf(WIDE)).not.toBe(digestOf('module:src'));

  // The change-scope side: B1's fold behind `architecture/change-scope` (the B1-07 seam) over the same
  // catalog and the same two paths gives the same owners as the stored graph.
  // @ts-ignore -- the B1 read module is not in the pre-build tree (as in S8B1-change-scope-pure.test.ts).
  const reader = await import('../../src/core/work-graph/views/architecture-change-scope-reader.js');
  const changeScopeOf = (reader as unknown as { changeScopeOf: ChangeScopeFold }).changeScopeOf;
  const scope = changeScopeOf({ requireDag: true, dependencies: [], ...tieCatalog(S6A_SCOPE.projectId) }, [
    { path: 'src/root.ts', certainty: 'definite' },
    { path: 'src/x/a.ts', certainty: 'definite' },
  ], true, null);
  const moduleRef = { projectId: S6A_SCOPE.projectId, moduleId: 'src' };
  expect(scope.files).toEqual([
    { path: 'src/root.ts', moduleRef, interfaceId: 'wide', certainty: 'definite' },
    { path: 'src/x/a.ts', moduleRef, interfaceId: null, certainty: 'definite' },
  ]);
  expect({ 'src/root.ts': interfaceIdOf(rootOwners), 'src/x/a.ts': interfaceIdOf(tiedOwners) })
    .toEqual(Object.fromEntries(scope.files.map(file => [file.path, file.interfaceId])));
});

/** R24's world: module `src`; its interface `api` names `src/api` here and `src/api` of another workspace `ws2`. */
const PROJECTED_FILES: Readonly<Record<string, string>> = {
  'src/api/h.ts': 'export const h = 1;\n',
  'src/main.ts': 'export const main = 1;\n',
};
const projectedCatalog = (projectId: string): { modules: ModuleDefinition[] } => ({ modules: [{
  ref: { projectId, moduleId: 'src' }, name: 'src', responsibility: 'S8B1 R24 projected interface', paths: ['src'],
  interfaces: [{ id: 'api', description: 'src/api here and in ws2', paths: ['src/api', '/@ws:ws2/src/api'] }],
}] });

it('B1-17 (R24) the automatic capture projects a workspace-prefixed interface path onto this workspace and is not refused invalid', async () => {
  const world = await openS8B1AdoptedWorld('r24', PROJECTED_FILES, projectedCatalog(S6A_SCOPE.projectId));
  adopted.push(world.world);

  // The adoption's automatic capture ran and committed: its request is the adoption's, nothing is
  // pending and no failure (the old refusal was `invalid` for the `/@ws:ws2/...` path).
  expect(world.state['autoCapture']).toMatchObject({ trigger: 'catalog_adopted', status: 'requested',
    failure: null, pending: false });

  // Hand computation: the world's workspace is the project's main one, so the projection keeps the
  // bare paths and drops `/@ws:ws2/src/api` (ws2's). Module `src` keeps "src", interface `api` keeps
  // "src/api": `src/api/h.ts` is in module src and interface api; `src/main.ts` is in module src only.
  const handle = observedS8B1Handle(world);
  expect(await readS8B1FileOwners(handle, 'src/api/h.ts')).toEqual([iface('src', 'api'), 'module:src']);
  expect(await readS8B1FileOwners(handle, 'src/main.ts')).toEqual(['module:src']);
});
