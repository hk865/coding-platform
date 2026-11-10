/**
 * B1-11 and B1-12 of the frozen test sheet (`darr-b1-tests.frozen.md` §2.2, decision 79-1/R8):
 * the current code reads only the current (v3) observation; a v2 SQLite ledger captured by the
 * previous commit (`d20f1e39`) through the public routes is refused, never migrated and never
 * defaulted to `count:1`.
 *
 * B1-11 is SQLite only: it opens a real Host on the fixture ledger after the fixture's own public
 * capture, then reads the public routes. B1-12 writes one new capture with the current code,
 * reopens the Host on the same directory and reads the same capture ref.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cp, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hostModule from '../../src/app/host.js';
import { S6A_SCOPE, openS6ARequestWorld, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { openS8B1CountWorld, readS8B1FilePages, readS8B1Neighborhood,
  type S8B1CountWorld } from '../helpers/S8B1-count-world.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { storeDirOf } from '../helpers/KLS1B-host-store.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/s8b1-observation-v2', import.meta.url));

const opened: S6ARequestWorld[] = [];
const counts: S8B1CountWorld[] = [];
afterEach(async () => {
  for (const handle of counts.splice(0).reverse()) await handle.world.close();
  for (const world of opened.splice(0).reverse()) await world.close();
});

type Manifest = {
  projectId: string; workspaceId: string;
  captureRef: { aggregateType: 'ObservedArchitecture'; projectId: string; workspaceId: string; captureId: string };
  persistedRef: Record<string, unknown>;
};

describe('S8B1 old and current observation formats', () => {
  it('B1-11 (SQLite only) a v2 capture written by the previous commit is refused, not read as ready with count:1', async () => {
    const manifest = JSON.parse(await readFile(join(FIXTURE, 'manifest.json'), 'utf8')) as Manifest;
    const world = await openS6ARequestWorld({ backend: 'sqlite' });
    opened.push(world);
    // The fixture's ledger replaces this world's ledger between the reopen's close and its start;
    // the Host factory is the fixture's public restart seam (the same delegating spy `openS6ATwoWorkspaceWorld` uses).
    // KLS-1b (121-75): the project store follows its workspace; `database` is the Host's old storage directory.
    const store = storeDirOf(world.database);
    const real = hostModule.createLocalWorkbenchHost;
    const spy = vi.spyOn(hostModule, 'createLocalWorkbenchHost').mockImplementation(async options => {
      for (const file of await readdir(FIXTURE)) {
        if (file.endsWith('.sqlite')) await cp(join(FIXTURE, file), join(store, file), { force: true });
      }
      return real(options);
    });
    try {
      await world.reopen();
    } finally {
      spy.mockRestore();
    }

    const answer = await world.post('architecture/query', plain(S6A_SCOPE, {
      selection: { kind: 'observed', capture: manifest.persistedRef },
      depth: 2, relations: ['dependency', 'interface'], page: { limit: 200 },
    }));
    expect(answer.httpStatus).not.toBe(500);
    expect(answer.body).not.toMatchObject({ status: 'ready' });
    const query = answer.body as { status: string; code?: string };
    expect(query.status).toBe('rejected');
    expect(['unavailable', 'invalid']).toContain(query.code);

    const state = await world.post('architecture/observation-state', plain(S6A_SCOPE, { workspace: S6A_SCOPE }));
    expect(state.httpStatus).not.toBe(500);
    expect(state.body).not.toMatchObject({ status: 'ready' });
    const observation = state.body as { status: string; code?: string };
    expect(observation.status).toBe('rejected');
    expect(['unavailable', 'invalid']).toContain(observation.code);
  }, 120_000);

  it('B1-12 (SQLite only: reopen) one new v3 capture reads back ready with the same counts', async () => {
    const handle = await openS8B1CountWorld('sqlite');
    counts.push(handle);
    const before = await readS8B1Neighborhood(handle);
    const beforeEdges = (before['edges'] as Array<{ fromNode: string; toNode: string; count?: number }>)
      .map(edge => ({ fromNode: edge.fromNode, toNode: edge.toNode, count: edge.count }));
    await handle.world.reopen();
    const pages = await readS8B1FilePages(handle);
    expect(pages.edges.length).toBe(5);
    expect(pages.edges.map(edge => edge['count']).sort()).toEqual([1, 1, 2, 2, 2]);
    const after = await readS8B1Neighborhood(handle);
    const afterEdges = (after['edges'] as Array<{ fromNode: string; toNode: string; count?: number }>)
      .map(edge => ({ fromNode: edge.fromNode, toNode: edge.toNode, count: edge.count }));
    expect(afterEdges).toEqual(beforeEdges);
  }, 120_000);
});
