/**
 * S8B1-C: the one count world of the architecture observation rows (B1-01..05, B1-14).
 *
 * Every prior state comes from a public step: the real request Host
 * (`openS6ARequestWorld`, the S6A/AG2b app fixture), the fixed workspace files written to its
 * root, the public `architecture/adopt-initial` of the frozen `src` / `other` / `lib` /
 * `one` / `two` catalog (two same-named `model` interfaces, one per module), and the
 * observation the public `architecture/capture` / automatic capture writes. The rows read
 * `architecture/query` or `platform.architecture.listFiles`; nothing here reads a record or
 * the store.
 *
 * The expected literals (the five non-self edges and their counts) are the frozen test
 * sheet's hand computation, not this helper's.
 *
 * B1-16/B1-17 (lead rulings R23/R24) use the same Host with their own files and catalog
 * (`openS8B1AdoptedWorld`): the adoption's automatic capture alone writes the observation, and
 * `readS8B1FileOwners` reads one file's stored owners through a `{kind:'file'}` query anchor.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ObservedCaptureRef } from '../../src/contracts/architecture-inspection.js';
import type { PersistedSourceCaptureRef } from '../../src/contracts/core/source.js';
import { openS6ARequestWorld, S6A_SCOPE, type S6ABackend, type S6ARequestWorld } from './S6A-request-fixture.js';
import { asRecord, committedValue } from './S6A-memory-fixture.js';
import { graphWrite, plain, settleAutoCapture } from './AG2b-collaboration-fixture.js';

export const S8B1_FILE_TEXTS: Readonly<Record<string, string>> = {
  'src/a.ts': "import { bx } from './b';\nimport { by } from './b';\nexport const a = bx + by;\n",
  'src/b.ts': 'export const b = 1;\n',
  'src/c/c.ts': "import { bx } from '../b';\nimport { by } from '../b';\nexport const c = bx + by;\n",
  'src/other/x.ts': "import { yx } from '../../lib/y';\nimport { yy } from '../../lib/y';\nexport const x = yx + yy;\n",
  'lib/y.ts': 'export const y = 1;\n',
  'src/one/a.ts': "import { b } from '../two/b';\nexport const a = b;\n",
  'src/two/b.ts': "import { a } from '../one/a';\nexport const b = a;\n",
  'src/one/model/m.ts': 'export const m = 1;\n',
  'src/two/model/m.ts': 'export const m = 1;\n',
};

/** The frozen catalog of §1.1: two modules (`one`, `two`) each declare an interface `model`. */
export function s8b1Catalog(projectId: string): { modules: ModuleDefinition[] } {
  const moduleOf = (moduleId: string, paths: string[], interfaces: ModuleDefinition['interfaces']): ModuleDefinition =>
    ({ ref: { projectId, moduleId }, name: moduleId, responsibility: `S8B1 ${moduleId}`, paths, interfaces });
  return { modules: [
    moduleOf('src', ['src'], [
      { id: 'a', description: 'src/a.ts', paths: ['src/a.ts'] },
      { id: 'b', description: 'src/b.ts', paths: ['src/b.ts'] },
      { id: 'c', description: 'src/c/c.ts', paths: ['src/c/c.ts'] },
    ]),
    moduleOf('other', ['src/other'], []),
    moduleOf('lib', ['lib'], []),
    moduleOf('one', ['src/one'], [{ id: 'model', description: 'one model', paths: ['src/one/model'] }]),
    moduleOf('two', ['src/two'], [{ id: 'model', description: 'two model', paths: ['src/two/model'] }]),
  ] };
}

export type S8B1CountWorld = {
  readonly world: S6ARequestWorld;
  readonly backend: S6ABackend;
  /** The observation's capture ref (the `listFiles` input). */
  readonly captureRef: ObservedCaptureRef;
  /** The observation's persisted ref (the `architecture/query` selection). */
  readonly persistedRef: PersistedSourceCaptureRef;
};


/** The workspace files, written to the world's root (real files on disk). */
async function writeS8B1Files(world: S6ARequestWorld, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const target = join(world.root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}

/** The project and workspace pins of the world's registration (revision 1 each). */
const S8B1_PINS = [
  { ref: { aggregateType: 'Project' as const, projectId: S6A_SCOPE.projectId }, revision: 1 },
  { ref: { aggregateType: 'Workspace' as const, ...S6A_SCOPE }, revision: 1 },
];

/** The public `architecture/adopt-initial` of one catalog; it must commit. */
async function adoptS8B1Catalog(world: S6ARequestWorld, input: { baselineId: string; description: string;
  requestId: string; catalog: { modules: ModuleDefinition[] } }): Promise<void> {
  committedValue((await world.post('architecture/adopt-initial', graphWrite(S6A_SCOPE, {
    baselineId: input.baselineId,
    description: input.description,
    constraints: [],
    catalog: { requireDag: true, dependencies: [], ...input.catalog },
  }, input.requestId, S8B1_PINS))).body, 'the catalog adoption');
}

/** Write the fixed files, adopt the frozen catalog and wait for the public observation. */
export async function openS8B1CountWorld(backend: S6ABackend = 'memory'): Promise<S8B1CountWorld> {
  const world = await openS6ARequestWorld({ backend });
  try {
    await writeS8B1Files(world, S8B1_FILE_TEXTS);
    const scope = S6A_SCOPE;
    const pins = S8B1_PINS;
    await adoptS8B1Catalog(world, { baselineId: 's8b1-baseline', description: 'S8B1 observation counts',
      requestId: 's8b1-adopt', catalog: s8b1Catalog(scope.projectId) });
    // The adoption starts the platform's automatic capture; the explicit capture is the
    // frozen sheet's step and is used only when the automatic one did not produce a current
    // observation (a public read decides, never a store read).
    await world.settleDetached();
    let state = asRecord((await world.post('architecture/observation-state', plain(scope, { workspace: scope }))).body);
    let captureRef = asRecord(asRecord(state['value'])['current'])['captureRef'];
    let persistedRef = asRecord(asRecord(state['value'])['current'])['persistedRef'];
    if (state['status'] !== 'ready' || captureRef === undefined || persistedRef === undefined) {
      committedValue((await world.post('architecture/capture', graphWrite(scope, {
        workspace: scope, previous: null,
      }, 's8b1-capture', pins))).body, 'the explicit capture');
      for (let turn = 0; turn < 500; turn += 1) {
        state = asRecord((await world.post('architecture/observation-state', plain(scope, { workspace: scope }))).body);
        captureRef = asRecord(asRecord(state['value'])['current'])['captureRef'];
        persistedRef = asRecord(asRecord(state['value'])['current'])['persistedRef'];
        if (state['status'] === 'ready' && captureRef !== undefined && persistedRef !== undefined) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    if (state['status'] !== 'ready' || captureRef === undefined || persistedRef === undefined) {
      throw new Error(`S8B1-C: the observation did not settle: ${JSON.stringify(state)}`);
    }
    return { world, backend, captureRef: captureRef as ObservedCaptureRef,
      persistedRef: persistedRef as PersistedSourceCaptureRef };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** B1-16/B1-17: a world of the row's own files and catalog, observed by the automatic capture only. */
export type S8B1AdoptedWorld = {
  readonly world: S6ARequestWorld;
  /** The `architecture/observation-state` value, read once after the adoption's automatic capture settled. */
  readonly state: Record<string, unknown>;
};

/**
 * The same request Host, the row's files on disk and the public `architecture/adopt-initial` of the
 * row's catalog. The adoption starts the platform's automatic capture; this waits for it through the
 * one public settle (`settleAutoCapture`: `observation-state` until not pending, or failed) and never
 * runs an explicit `architecture/capture`, so a refused automatic capture stays in `state.autoCapture`.
 */
export async function openS8B1AdoptedWorld(label: string, files: Readonly<Record<string, string>>,
  catalog: { modules: ModuleDefinition[] }): Promise<S8B1AdoptedWorld> {
  const world = await openS6ARequestWorld({ backend: 'memory' });
  try {
    await writeS8B1Files(world, files);
    await adoptS8B1Catalog(world, { baselineId: `s8b1-${label}-baseline`, description: `S8B1 ${label}`,
      requestId: `s8b1-${label}-adopt`, catalog });
    await world.settleDetached();
    await settleAutoCapture(world.ag2b);
    const state = asRecord((await world.post('architecture/observation-state',
      plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body);
    if (state['status'] !== 'ready') throw new Error(`S8B1 ${label}: observation-state was not ready: ${JSON.stringify(state)}`);
    return { world, state: asRecord(state['value']) };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The adopted world's current observation as a count-world handle (refs as the state read returned them). */
export function observedS8B1Handle(adopted: S8B1AdoptedWorld): S8B1CountWorld {
  const current = asRecord(adopted.state['current']);
  if (current['captureRef'] === undefined || current['persistedRef'] === undefined) {
    throw new Error(`S8B1: the workspace has no current observation: ${JSON.stringify(adopted.state)}`);
  }
  return { world: adopted.world, backend: 'memory', captureRef: current['captureRef'] as ObservedCaptureRef,
    persistedRef: current['persistedRef'] as PersistedSourceCaptureRef };
}

/**
 * One `architecture/query` read of the count world's observation (the B1-01/02/05/14 entry); with
 * `anchorPath`, the read is seeded from that workspace file (`{kind:'file'}` anchor).
 */
export async function readS8B1Neighborhood(handle: S8B1CountWorld,
  options: { anchorPath?: string; depth?: number } = {}): Promise<Record<string, unknown>> {
  const answer = await handle.world.post('architecture/query', plain(S6A_SCOPE, {
    selection: { kind: 'observed', capture: handle.persistedRef },
    ...(options.anchorPath === undefined ? {}
      : { anchor: { kind: 'file', workspace: { ...S6A_SCOPE }, path: options.anchorPath } }),
    depth: options.depth ?? 2, relations: ['dependency', 'interface'], page: { limit: 200 },
  }));
  const body = asRecord(answer.body);
  if (body['status'] !== 'ready') throw new Error(`S8B1-C: the query was not ready: ${JSON.stringify(answer.body)}`);
  return asRecord(body['value']);
}

/**
 * The stored owners of one workspace file: the nodes a file anchor seeds at depth 0 (the query walks
 * no edge), sorted. A file in an interface answers its interface node and its module node; a file in
 * no interface answers its module node only.
 */
export async function readS8B1FileOwners(handle: S8B1CountWorld, path: string): Promise<string[]> {
  const value = await readS8B1Neighborhood(handle, { anchorPath: path, depth: 0 });
  return nodesOf(value).map(node => String(node['nodeId'])).sort();
}

/** `platform.architecture.listFiles`, paged to `nextCursor: null`, in page order. */
export async function readS8B1FilePages(handle: S8B1CountWorld): Promise<{
  nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>;
}> {
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let turn = 0; turn < 500; turn += 1) {
    const page = await handle.world.platform.architecture.listFiles(
      handle.world.humanContext(), { captureRef: handle.captureRef, cursor });
    if (page.status !== 'ready') throw new Error(`S8B1-C: listFiles was not ready: ${JSON.stringify(page)}`);
    for (const node of page.value.nodes) nodes.push(node as unknown as Record<string, unknown>);
    for (const edge of page.value.edges) edges.push(edge as unknown as Record<string, unknown>);
    cursor = page.value.nextCursor;
    if (cursor === null) return { nodes, edges };
  }
  throw new Error('S8B1-C: listFiles did not reach nextCursor null');
}

/** The edge fields the rows read, with the current-format `count` typed locally. */
export type S8B1Edge = { fromNode: string; toNode: string; kind: string; edgeId: string;
  structuralKey: string; count?: number };
export type S8B1FileEdge = { from: string; to: string; count?: number };

export const edgesOf = (value: Record<string, unknown>): S8B1Edge[] =>
  (Array.isArray(value['edges']) ? value['edges'] : []) as S8B1Edge[];
export const nodesOf = (value: Record<string, unknown>): Array<Record<string, unknown>> =>
  (Array.isArray(value['nodes']) ? value['nodes'] : []) as Array<Record<string, unknown>>;
