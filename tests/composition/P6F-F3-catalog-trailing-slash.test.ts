/**
 * P6F F3 (lead ruling `p6f-rulings.md` F3; P6 E09 observation-after-pass). Spec: PRODUCT.md:360 and
 * decision 61-3 - an observation is captured after registration, after a formal architecture adoption, and
 * after every formal check PASS. In P6 the adopted catalog carried `tests.paths = ['test/']`, every capture
 * after a PASS was refused, and the observation stayed on the old capture.
 *
 * The ruling lets the builder pick ONE rule, so the two write rows assert only what both choices satisfy:
 * (A) the slashed catalog commits, the next formal check PASS captures, and the current observation changes
 *     (only the outcome: the ruling allows normalising on read with the stored path left as written); or
 * (B) the write is refused, the reason names `test/` and how to write it, and the catalog read is unchanged.
 * The third row is a stored catalog with a slash (the person edits the module file on disk): the ruling has it
 * normalised on read under either choice, so only (A) applies.
 *
 * World: the shared L8 PASS world (`tests/helpers/S8A-L8-pass-world.ts`), memory only, with a `test/` folder in
 * the workspace and the driver connected before any adoption: public writers, the real Workflow and Kernel check
 * (needs bwrap), and the real `createAutoCaptureDriver` on `onArchitectureCaptureTrigger`. Every wait is a
 * bounded poll of the public `observationState` read; nothing is hand-written.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import {
  drive, l8Module, openL8PassWorld, performs, selectWork, type L8PassWorld,
} from '../helpers/S8A-L8-pass-world.js';

const opened: L8PassWorld[] = [];
afterEach(async () => { for (const world of opened.splice(0)) await world.close(); });

const FILES = { 'src/a.ts': 'export const a = 1;\n', 'test/a.test.ts': 'import { a } from "../src/a";\nexport const checked = a;\n' };
const readCatalog = (w: L8PassWorld) =>
  w.platform.architecture.readArchitectureRevision(w.ctx, { selection: { kind: 'current' } });

async function revise(w: L8PassWorld, module: ModuleDefinition) {
  const current = await readCatalog(w);
  if (current.status !== 'ready') throw new Error(`the current catalog read failed: ${JSON.stringify(current)}`);
  const { catalog, baseline } = current.value;
  return w.platform.architecture.reviseArchitectureCatalog(w.ctx, { meta: { requestId: 'p6f-f3-revise', expected: await w.pins() },
    input: { expected: { catalogRef: catalog.ref, baseline: { ref: baseline.ref, digest: baseline.contentDigest } },
      ops: [{ op: 'add_module', module }], responsibilityMoves: [], reason: 'P6F F3 adds the tests module' } });
}

/** The person edits the adopted module file in the workspace: one path string replaced. */
async function editModuleFile(w: L8PassWorld, moduleId: string, from: string, to: string): Promise<void> {
  const modules = join(w.root, '.workbench', 'modules');
  for (const name of await readdir(modules)) {
    const text = await readFile(join(modules, name), 'utf8');
    if ((JSON.parse(text) as { id?: unknown }).id !== moduleId) continue;
    if (!text.includes(JSON.stringify(from))) throw new Error(`the ${moduleId} module file has no path ${from}`);
    await writeFile(join(modules, name), text.replace(JSON.stringify(from), JSON.stringify(to)));
    return;
  }
  throw new Error(`no module file for ${moduleId}`);
}

/** Bounded public poll until request `seq` is satisfied or recorded as failed. */
async function settled(w: L8PassWorld, seq: number): Promise<ArchitectureObservationStateV1> {
  for (let attempt = 0; attempt < 750; attempt += 1) {
    const read = await w.platform.architecture.observationState(w.ctx, { workspace: w.scope });
    if (read.status !== 'ready') throw new Error(`observation-state was not ready: ${JSON.stringify(read)}`);
    const auto = read.value.autoCapture;
    if (auto !== null && auto.requestSeq === seq && (auto.pending === false || auto.status === 'failed')) return read.value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`capture request ${seq} did not settle`);
}

/** Goal, Plan, executor line, then the real Workflow up to and including one finalize PASS. */
async function pass(w: L8PassWorld): Promise<void> {
  await w.seedGoal();
  const driven = await drive(w, selectWork(w, 'p6f-f3-flow'), performs('finalize_checks'));
  if (driven.stopped === null) throw new Error(`the Workflow settled before the finalize: ${JSON.stringify(driven)}`);
  const finalized = await w.platform.workflow.advanceWork(w.ctx, driven.stopped);
  if (finalized.status !== 'ready') throw new Error(`the finalize was not ready: ${JSON.stringify(finalized)}`);
  expect(finalized.value.receipt, 'the real check must reach a finalize PASS').toMatchObject({ kind: 'finalize_checks',
    result: { status: 'committed', replayed: false, value: { outcome: 'PASS', applicable: true } } });
}

/** Hand-computed request sequence: 1 registration, 2 adoption, (3 revision), then the PASS. */
const ROUTES = [
  { route: 'architecture/adopt-initial', passSeq: 3 },
  { route: 'architecture/revise', passSeq: 4 },
  { route: 'module file edited by hand', passSeq: 3 },
] as const;

describe('P6F F3: a catalog path with a trailing slash does not stop the observation after a PASS', () => {
  it.each(ROUTES)('$route with tests.paths [test/]', async ({ route, passSeq }) => {
    const projectId = `p6f-f3-${route.replace(/\W+/g, '-')}`;
    const w = await openL8PassWorld({ backend: 'memory', projectId, files: FILES });
    opened.push(w);
    const tests = l8Module(projectId, 'tests', ['test/']);
    const src = l8Module(projectId, 'A', ['src']);
    w.driver.workspaceRegistered(w.scope);
    await settled(w, 1);
    if (route === 'module file edited by hand') {
      expect(await w.adopt([src, l8Module(projectId, 'tests', ['test'])])).toMatchObject({ status: 'committed' });
      await settled(w, 2);
      await editModuleFile(w, 'tests', 'test', 'test/');
    } else {
      if (route === 'architecture/revise') {
        expect(await w.adopt([src])).toMatchObject({ status: 'committed' });
        await settled(w, 2);
      }
      const before = await readCatalog(w);
      const written = route === 'architecture/adopt-initial' ? await w.adopt([src, tests]) : await revise(w, tests);
      if (written.status !== 'committed') {
        // (B) refused at the write: the reason names the offending path and how to write it; nothing changed.
        expect(written).toMatchObject({ status: 'rejected' });
        const reason = 'reason' in written ? String(written.reason) : '';
        expect(reason).toContain('test/');
        expect(reason).toMatch(/(^|[^\w/.-])test([^\w/.-]|$)|slash|斜杠/i);
        expect(await readCatalog(w)).toEqual(before);
        return;
      }
    }
    // (A) the slashed catalog is in force: the next formal check PASS captures, and the current observation changes.
    const old = (await settled(w, passSeq - 1)).current;
    expect(old, 'an earlier capture is the floor').not.toBeNull();
    await pass(w);
    const after = await settled(w, passSeq);
    expect(after.autoCapture).toMatchObject({ requestSeq: passSeq, trigger: 'check_passed', status: 'requested',
      failure: null, pending: false });
    expect(after.current?.captureRef.captureId).not.toBe(old!.captureRef.captureId);
  }, 90_000);
});
