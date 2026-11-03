/**
 * C-sourcehit (8E L1): the real TypeScript provider keeps a symbol hit's `location`
 * on the name span and reports every navigation declaration span as
 * `declarationRanges`. The public path is the Host's `source/capture` then
 * `source/query` over HTTP: the routes are bound to the real workspace owner, so
 * the capture and the source query are real steps, not a hand-built context.
 *
 * World: the existing `openS6ARequestWorld` memory world plus the two source
 * files the row needs. `runModel` is a three-line function whose name is on line
 * 3, so its name span is 3-3 while its single declaration span is 3-5. `pick` has
 * two overload declarations (1-1, 2-2) and one implementation (3-5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openS6ARequestWorld, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { AG2B_WORKSPACE_REF, plain } from '../helpers/AG2b-collaboration-fixture.js';

const RUN_SOURCE = [
  "import type { Access } from '../contracts/access.js';",
  "import { handlers } from '../wg/registry.js';",
  'export async function runModel(access: Access, id: string) {',
  '  await access.beforeCall(id);',
  '}',
  '',
].join('\n');

const OVERLOAD_SOURCE = [
  'export function pick(id: string): string;',
  'export function pick(id: number): string;',
  'export function pick(id: string | number): string {',
  "  return String(id) + 'overload-key';",
  '}',
  '',
].join('\n');

type LineRange = { startLine: number; endLine: number };
type SymbolItem = {
  kind: string;
  name?: string;
  location?: { start: { line: number }; end: { line: number } };
  declarationRanges?: LineRange[];
};

let world: S6ARequestWorld | null = null;

afterEach(async () => {
  const open = world;
  world = null;
  if (open !== null) await open.close();
});

describe('S8E L1 C-sourcehit', () => {
  it('C-sourcehit: keeps the name span and returns every declaration range', async () => {
    world = await openS6ARequestWorld({ backend: 'memory' });
    await mkdir(join(world.root, 'src/runtime'), { recursive: true });
    await mkdir(join(world.root, 'src/wg'), { recursive: true });
    await writeFile(join(world.root, 'src/runtime/run.ts'), RUN_SOURCE);
    await writeFile(join(world.root, 'src/wg/overload.ts'), OVERLOAD_SOURCE);

    const captured = await world.post('source/capture', plain(S6A_SCOPE, {
      workspace: AG2B_WORKSPACE_REF, workspaceRevision: 1, provider: 'typescript', configPath: 'tsconfig.json',
    }));
    expect(captured.httpStatus).toBe(200);
    expect(captured.body).toMatchObject({ status: 'ready' });
    const captureRef = (captured.body as { value: { ref: unknown } }).value.ref;

    const runPage = await world.post('source/query', plain(S6A_SCOPE, {
      capture: captureRef, query: { kind: 'symbols', path: 'src/runtime/run.ts' }, cursor: null, limit: 10,
    }));
    expect(runPage.httpStatus).toBe(200);
    const runItems = (runPage.body as { value: { items: SymbolItem[] } }).value.items;
    const runModel = runItems.find(item => item.kind === 'symbol' && item.name === 'runModel');
    expect(runModel).toBeDefined();
    expect(runModel!.location!.start.line).toBe(3);
    expect(runModel!.location!.end.line).toBe(3);
    expect(runModel!.declarationRanges).toEqual([{ startLine: 3, endLine: 5 }]);

    const pickPage = await world.post('source/query', plain(S6A_SCOPE, {
      capture: captureRef, query: { kind: 'symbols', path: 'src/wg/overload.ts' }, cursor: null, limit: 10,
    }));
    expect(pickPage.httpStatus).toBe(200);
    const pickItems = (pickPage.body as { value: { items: SymbolItem[] } }).value.items;
    const pick = pickItems.find(item => item.kind === 'symbol' && item.name === 'pick');
    expect(pick).toBeDefined();
    expect(pick!.declarationRanges).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 2 },
      { startLine: 3, endLine: 5 },
    ]);
    expect(pick!.declarationRanges).toHaveLength(3);
  });
});
