/**
 * Production reach (rule of 2026-10-04): code that no production path reaches
 * must not stay in `src/`. Exceptions are listed in
 * `production-reach-allowlist.json`, each with its reason:
 *
 * - `step5` / `step6`: A.2 step 5 or 6 wires it. `substep` names the substep
 *   (`5.3`, `5.4b`, …, or `6`) and `wiredBy` the STEP5-FLIPS.md section or spec
 *   §15.2/§15.3 item that wires it, naming that substep (step 6: the §15.2 6
 *   item or the test file). Add a substep to `CLOSED_SUBSTEPS` when it is done:
 *   none of its entries may remain, and none may remain after step 6;
 * - `pre-batch`: already unreached at 790d970; the user decides later;
 * - `wire-format`: a persisted or wire contract that must stay (the note names
 *   its reader).
 *
 * Code that exists only for tests belongs under `tests/`, so there is no
 * reason for it. The test fails when an unreached node is not listed, or when a
 * listed entry is reached now or gone. The analysis and the entry points are
 * described in `production-reach.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProductionReach, type ReachNode } from './production-reach.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWLIST_PATH = join(project, 'tests/architecture/production-reach-allowlist.json');
const REASONS = ['step5', 'step6', 'pre-batch', 'wire-format'] as const;
/** Substeps the lead has closed (`5.3`, …, `6`): an entry of one of them fails. */
const CLOSED_SUBSTEPS: readonly string[] = ['5.1', '5.2', '5.3', '5.4', '5.4b', '5.5', '5.6', '5.7', '5.8'];
/** A wiredBy names the STEP5-FLIPS.md section or the spec §15.2/§15.3 item. */
const WIRING_SOURCE = /STEP5-FLIPS\.md §\d+|§15\.[23]/;

type AllowlistEntry = {
  file: string;
  name: string;
  reason: (typeof REASONS)[number];
  /** Required for `step5` (`5.N` or `5.Nb`) and `step6` (`6`). */
  substep?: string;
  /** Required for `step5`/`step6`. */
  wiredBy?: string;
  note: string;
};

const keyOf = (entry: { file: string; name: string }) => `${entry.file}#${entry.name}`;
const describeNode = (node: ReachNode) => `${node.file}:${String(node.line)} ${node.name} (${node.kind}, ${String(node.lines)} lines)`;

function wiringProblem(entry: AllowlistEntry): string | null {
  const { reason, substep, wiredBy } = entry;
  if (reason !== 'step5' && reason !== 'step6') {
    return substep === undefined && wiredBy === undefined ? null : `only a step5/step6 entry has substep and wiredBy`;
  }
  if (typeof substep !== 'string' || !(reason === 'step5' ? /^5\.\d+b?$/ : /^6$/).test(substep))
    return `a ${reason} entry names its substep (${reason === 'step5' ? '5.N or 5.Nb' : '6'})`;
  if (typeof wiredBy !== 'string' || !WIRING_SOURCE.test(wiredBy))
    return `a ${reason} entry names the STEP5-FLIPS.md section or spec §15.2/§15.3 item that wires it (wiredBy)`;
  const token = reason === 'step5' ? new RegExp(`(?<![\\d.])${substep.replace('.', '\\.')}(?!\\d)`)
    : /§15\.2 6\b|tests\/[\w./-]+\.test\.ts/;
  return token.test(wiredBy) ? null : `wiredBy does not name substep ${substep}`;
}

function readAllowlist(): { entries: AllowlistEntry[]; problems: string[] } {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as { entries?: unknown };
  const problems: string[] = [];
  if (!Array.isArray(raw.entries)) return { entries: [], problems: ['the allowlist has no entries array'] };
  const entries = raw.entries as AllowlistEntry[];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (typeof entry.file !== 'string' || typeof entry.name !== 'string') problems.push(`${key}: file and name must be strings`);
    if (!(REASONS as readonly string[]).includes(entry.reason)) problems.push(`${key}: unknown reason ${String(entry.reason)}`);
    const wiring = wiringProblem(entry);
    if (wiring !== null) problems.push(`${key}: ${wiring}`);
    if (typeof entry.note !== 'string' || entry.note.length === 0) problems.push(`${key}: note must be a non-empty string`);
    if (seen.has(key)) problems.push(`${key}: listed twice`);
    seen.add(key);
  }
  return { entries, problems };
}

describe('production reach of src/', () => {
  it('reaches every declaration from a production entry point, or allowlists it with its reason', () => {
    const report = analyzeProductionReach(project);
    expect(report.files).toBeGreaterThan(300);
    expect(report.surfaces.length).toBeGreaterThan(40);
    expect(report.entries.filter(entry => entry.exports === 'none').map(entry => entry.file))
      .toEqual(['src/app/main.ts', 'src/ui/main.ts', 'src/ui/views.ts']);
    const { entries, problems } = readAllowlist();
    const allowed = new Set(entries.map(keyOf));
    const unreached = new Set(report.unreached.map(keyOf));
    expect(problems).toEqual([]);
    expect(report.unreached.filter(node => !allowed.has(keyOf(node))).map(describeNode)).toEqual([]);
    expect(entries.filter(entry => !unreached.has(keyOf(entry)))
      .map(entry => `${keyOf(entry)} (${entry.reason}) is reached now or gone; remove it from the allowlist`)).toEqual([]);
    expect(entries.filter(entry => entry.substep !== undefined && CLOSED_SUBSTEPS.includes(entry.substep))
      .map(entry => `${keyOf(entry)}: substep ${String(entry.substep)} is closed, so it must be reached or deleted`)).toEqual([]);
  }, 120_000);
});

// -------------------------------------------------------------------------- //
// The analysis on a fixture project of the same layout                        //
// -------------------------------------------------------------------------- //

const FIXTURE: Record<string, string> = {
  'package.json': '{ "name": "reach-fixture", "private": true, "type": "module" }\n',
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext',
    lib: ['ES2024'], types: [], strict: true, noEmit: true, skipLibCheck: true }, include: ['src/**/*.ts'], exclude: ['src/ui'] }),
  'tsconfig.ui.json': JSON.stringify({ compilerOptions: { target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler',
    lib: ['ES2024', 'DOM'], types: [], strict: true, noEmit: true, skipLibCheck: true }, include: ['src/ui/**/*.ts'] }),
  'scripts/build-workbench.mjs': "const entries = ['main', 'views'];\n",
  'scripts/demo.mjs': "import { demoRoot } from '../dist/lib/demo.js';\nconsole.log(demoRoot());\n",
  'scripts/smoke.mjs': `spawn(['-e', "const { lateRoot } = await import('./dist/lib/demo.js'); lateRoot();"]);\n`,
  'src/app/main.ts': `import { used } from '../lib/barrel.js';
import { unusedImport } from '../lib/impl.js';
import type { Shape } from '../lib/types.js';
import { Store, type Port } from '../lib/store.js';
import { api } from '../lib/api.js';
import '../lib/side.js';
import { Failure } from '../lib/errors.js';
import type { CounterPort } from '../lib/ports.js';
import { createCounterService } from '../lib/counter-service.js';
import { createStatsService, show } from '../lib/stats.js';
import { FileSink, MapRows, closeWith, readWith } from '../lib/rows.js';

const shape: Shape = { size: used() };
const port: Port = new Store();
port.read();
api.handle();
if (shape.size < 0) throw new Failure('negative');
const counter = createCounterService();
const bumpers: CounterPort['bump'][] = [];
if (counter.read() < bumpers.length) throw new Failure('counter');
show(createStatsService());
readWith(new MapRows());
closeWith(new FileSink());
`,
  'src/lib/impl.ts': `export function used(): number { return helper(); }
function helper(): number { return 1; }
export function unused(): number { return deadHelper(); }
function deadHelper(): number { return 2; }
export function unusedImport(): void {}
`,
  'src/lib/barrel.ts': "export { used } from './impl.js';\n",
  'src/lib/types.ts': 'export type Shape = { size: Size };\nexport type Size = number;\nexport type Orphan = { a: string };\n',
  'src/lib/store.ts': `export interface Port { read(): number; write(): void }
export class Store implements Port {
  private cache = 0;
  read(): number { return this.load(); }
  write(): void {}
  private load(): number { return this.cache; }
  dead(): void {}
  toString(): string { return 'store'; }
}
export class Unused { method(): void {} }
`,
  'src/lib/api.ts': `import { register } from './registry.js';
function handle(): void { register('api'); }
function orphanHandler(): void {}
export const api = { handle };
`,
  'src/lib/side.ts': "import { register } from './registry.js';\nregister('side');\nexport function sideUnused(): void {}\n",
  'src/lib/registry.ts': 'const names: string[] = [];\nexport function register(name: string): void { names.push(name); }\n',
  'src/lib/errors.ts': `export class Failure extends Error {
  override readonly name = 'Failure';
  detail(): string { return this.message; }
}
`,
  'src/lib/demo.ts': `export function demoRoot(): string { return 'demo'; }
export function lateRoot(): string { return 'late'; }
export function demoOther(): string { return 'other'; }
`,
  'src/lib/ports.ts': `export type Step = number;
export type DropReason = string;
export interface CounterPort {
  read(): number;
  bump(by: Step): void;
  drop?(why: DropReason): void;
  idle?(): void;
}
`,
  'src/lib/counter-service.ts': `import type { CounterPort, DropReason, Step } from './ports.js';
export function createCounterService(): CounterPort {
  let value = 0;
  function read(): number { return value + current(); }
  function bump(by: Step): void { value += step(by); }
  function drop(why: DropReason): void { value = reset(why); }
  return { read, bump, drop };
}
function current(): number { return 0; }
function step(by: Step): number { return by; }
function reset(why: DropReason): number { return why.length; }
`,
  'src/lib/stats.ts': `export type StatsApi = { count(): number; reset(): void };
export function createStatsService(): StatsApi {
  return { count: () => 1, reset: () => wipe() };
}
function wipe(): void {}
export function show(source: { count(): number }): number { return source.count(); }
`,
  'src/lib/rows.ts': `export interface Reader { get(key: string): string | undefined }
export interface Closer { flush(): void; dispose(): void }
export class MapRows {
  get(key: string): string | undefined { return key; }
  dispose(): void {}
}
export class FileSink {
  flush(): void {}
  dispose(): void {}
}
export function readWith(reader: Reader): string { return reader.get('k') ?? ''; }
export function closeWith(closer: Closer): void { closer.flush(); closer.dispose(); }
`,
  'src/ui/main.ts': `import { renderUsed } from './views.js';
import type { Shape } from '../lib/types.js';
const shape: Shape = { size: 1 };
document.title = renderUsed(shape);
`,
  'src/ui/views.ts': "export { renderUsed, renderTestOnly } from './render.js';\n",
  'src/ui/render.ts': `import type { Shape } from '../lib/types.js';
export function renderUsed(shape: Shape): string { return String(shape.size); }
export function renderTestOnly(): string { return ''; }
`,
};

describe('production reach analysis', () => {
  let fixture = '';
  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'next-production-reach-'));
    for (const [path, text] of Object.entries(FIXTURE)) {
      await mkdir(dirname(join(fixture, path)), { recursive: true });
      await writeFile(join(fixture, path), text);
    }
  });
  afterAll(async () => { await rm(fixture, { recursive: true, force: true }); });

  it('reads the CLI, the browser bundles and the dist imports of scripts as entry points', () => {
    expect(analyzeProductionReach(fixture).entries.map(entry => [entry.file, entry.exports, entry.via])).toEqual([
      ['src/app/main.ts', 'none', 'workbench CLI: node dist/app/main.js <config> (README, WORKBENCH_CLI_USAGE)'],
      ['src/ui/main.ts', 'none', 'browser bundle of scripts/build-workbench.mjs'],
      ['src/ui/views.ts', 'none', 'browser bundle of scripts/build-workbench.mjs'],
      ['src/lib/demo.ts', ['demoRoot'], 'scripts/demo.mjs'],
      ['src/lib/demo.ts', ['lateRoot'], 'scripts/smoke.mjs'],
    ]);
  });

  it('follows aliases, re-exports, type-only use, shorthand properties, module evaluation, class and port members', () => {
    const report = analyzeProductionReach(fixture);
    // `*Port` types and the declared return type of a `create*Service` factory.
    expect(report.surfaces).toEqual(['src/lib/ports.ts#CounterPort', 'src/lib/stats.ts#StatsApi', 'src/lib/store.ts#Port']);
    // Not reached: an import that is never used, a bundle export nothing imports, members no
    // reached code calls (also through the interface), and everything only they reference.
    // Port members: implementing one (`return { bump }`) is not calling it, so the factory's inner
    // function and the helpers only it calls stay unreached; `CounterPort['bump']` names the
    // member's types (`Step`), not the member. `StatsApi.count` is read through a structural type
    // StatsApi is assignable to. A class member is reached through a type its class is assignable
    // to (`MapRows.get` as a `Reader`), not through any type with a member of that name
    // (`MapRows.dispose` is no `Closer.dispose`).
    expect(report.unreached.map(node => `${node.file}#${node.name}`)).toEqual([
      'src/lib/api.ts#orphanHandler',
      'src/lib/counter-service.ts#step',
      'src/lib/counter-service.ts#reset',
      'src/lib/demo.ts#demoOther',
      'src/lib/errors.ts#Failure.detail',
      'src/lib/impl.ts#unused',
      'src/lib/impl.ts#deadHelper',
      'src/lib/impl.ts#unusedImport',
      'src/lib/ports.ts#DropReason',
      'src/lib/ports.ts#CounterPort.bump',
      'src/lib/ports.ts#CounterPort.drop',
      'src/lib/ports.ts#CounterPort.idle',
      'src/lib/rows.ts#MapRows.dispose',
      'src/lib/side.ts#sideUnused',
      'src/lib/stats.ts#StatsApi.reset',
      'src/lib/stats.ts#wipe',
      'src/lib/store.ts#Port.write',
      'src/lib/store.ts#Store.write',
      'src/lib/store.ts#Store.dead',
      'src/lib/store.ts#Unused',
      'src/lib/types.ts#Orphan',
      'src/ui/render.ts#renderTestOnly',
    ]);
  });

  it('refuses a script that loads a dist module in a form it does not read', async () => {
    await writeFile(join(fixture, 'scripts/odd.mjs'), "const path = 'dist/lib/demo.js';\nawait import('./' + path);\n");
    try {
      expect(() => analyzeProductionReach(fixture)).toThrow(/scripts\/odd\.mjs names a dist\/\*\.js file/);
    } finally {
      await rm(join(fixture, 'scripts/odd.mjs'));
    }
  });
});
