/**
 * KLS-2a-1 Host rows H1 and H6 (level 1): a real Host over a real git root (`openHostScenario` with
 * `gitWorkspace`), SQLite stores. H1 starts a Host on sources only; H6 lets the scenario's seed adopt the
 * catalog through the public `architecture/adopt-initial` route, closes the Host and starts a new one on the
 * same root. The checks are the files under the root and the public `architecture/read` route.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { AG2B_SCOPE, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, openHostScenario, type HostScenario } from '../scenarios/harness.js';

afterEach(cleanupScenarios);

async function currentModuleIds(scenario: HostScenario): Promise<string[]> {
  const read = await scenario.post<ReadResult<ArchitectureRevision>>('architecture/read',
    plain(AG2B_SCOPE, { selection: { kind: 'current' } }));
  if (read.status !== 'ready') throw new Error(`architecture/read is not ready: ${JSON.stringify(read)}`);
  return read.value.catalog.catalog.modules.map(module => module.ref.moduleId);
}

it('H1 a Host started on a git root holding only sources makes the root\'s .workbench/ folder', async () => {
  const scenario = await openHostScenario({ gitWorkspace: true, workIds: null });
  const folder = join(scenario.root, '.workbench');
  expect(existsSync(folder) && statSync(folder).isDirectory()).toBe(true);
}, 120_000);

it('H6 (SQLite only: a Host restart) keeps architecture.json byte for byte and the public read on it', async () => {
  const scenario = await openHostScenario({ gitWorkspace: true });
  const path = join(scenario.root, '.workbench', 'architecture.json');
  const before = existsSync(path) ? readFileSync(path) : null;
  expect(before).not.toBeNull();
  expect(await currentModuleIds(scenario)).toEqual(['ag2b-work']);
  await scenario.restart();
  expect(existsSync(path) ? readFileSync(path) : null).toEqual(before);
  expect(await currentModuleIds(scenario)).toEqual(['ag2b-work']);
}, 180_000);
