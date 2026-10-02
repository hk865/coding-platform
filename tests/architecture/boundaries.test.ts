import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, rename, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSourceTree, inspectSourceTree, MODULE_TARGET_PATH } from '../../scripts/check-boundaries.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary: string[] = [];
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }); });

type ModuleTarget = {
  schemaVersion?: number; projectRoot?: string; implementationOwnership?: string;
  modules: Array<{ id: string; path?: string; dependencies?: string[];
    submodules?: Array<{ id: string; path: string; dependencies: string[] }> }>;
};

async function fixture(path: string, source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'next-boundary-test-'));
  temporary.push(dir);
  for (const name of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'runtime-assets.json'])
    await cp(join(project, name), join(dir, name));
  for (const name of ['scripts', '.local', 'resources'])
    await cp(join(project, name), join(dir, name), { recursive: true });
  await cp(join(project, 'vendor', 'coding-agent'), join(dir, 'vendor', 'coding-agent'), { recursive: true });
  await mkdir(join(dir, dirname(MODULE_TARGET_PATH)), { recursive: true });
  await cp(join(project, MODULE_TARGET_PATH), join(dir, MODULE_TARGET_PATH));
  // Declared module directories must exist; the fixture keeps them empty unless a test writes a file.
  // The real submodule layout belongs to the real tree; tests that need submodules declare their own.
  await writeTarget(dir, target => { for (const module of target.modules) delete module.submodules; });
  for (const module of (await readTarget(dir)).modules)
    if (module.path) await mkdir(join(dir, module.path), { recursive: true });
  const file = join(dir, 'src', path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
  return dir;
}

async function readTarget(dir: string): Promise<ModuleTarget> {
  return JSON.parse(await readFile(join(dir, MODULE_TARGET_PATH), 'utf8')) as ModuleTarget;
}

async function writeTarget(dir: string, edit: (target: ModuleTarget) => void) {
  const target = await readTarget(dir);
  edit(target);
  await writeFile(join(dir, MODULE_TARGET_PATH), JSON.stringify(target, null, 2));
}

async function source(dir: string, path: string, text: string) {
  await mkdir(dirname(join(dir, 'src', path)), { recursive: true });
  await writeFile(join(dir, 'src', path), text);
}

it('accepts target module and shared-contract directions without requiring all eight edges to be used', async () => {
  const dir = await fixture('business/workflow/entry.ts',
    "import type { A } from '../../contracts/a.js';\nimport type { B } from '../../core/agent-runtime/b.js';\n");
  expect(await auditSourceTree(dir)).toEqual([]);
  const report = await inspectSourceTree(dir);
  expect(report.modules).toContainEqual({ name: 'Workflow', directory: true, sourceFiles: 1 });
  expect(report.modules).toContainEqual({ name: 'RecordStore', directory: true, sourceFiles: 0 });
  expect(report.observedEdges).toEqual(['Workflow -> AgentRuntime']);
  expect(report.allowedEdgeCount).toBe(8);
});

it('reads module paths and edges from module-target.json instead of a second copy in the script', async () => {
  const dir = await fixture('core/workspace/entry.ts', "\n\nimport '../record-store/store.js';\n");
  expect(await auditSourceTree(dir)).toEqual(['core/workspace/entry.ts:3: forbidden module edge WorkspaceTools -> RecordStore']);
  await writeTarget(dir, target => { target.modules.find(m => m.id === 'WorkspaceTools')!.dependencies = ['RecordStore']; });
  expect(await auditSourceTree(dir)).toEqual([]);
  expect((await inspectSourceTree(dir)).allowedEdgeCount).toBe(9);
});

it('reports the violating file and line for module, contract and escape violations', async () => {
  const dir = await fixture('core/record-store/entry.ts',
    "export const a = 1;\nimport '../work-graph/tasks/a.js';\n// comment\nimport '../../../../src/old.js';\n");
  await source(dir, 'contracts/entry.ts', "export type X = 1;\nexport type { Y } from '../core/workspace/y.js';\n");
  const issues = await auditSourceTree(dir);
  expect(issues).toEqual(expect.arrayContaining([
    'core/record-store/entry.ts:2: forbidden module edge RecordStore -> WorkGraph',
    'core/record-store/entry.ts:4: import escapes next/src: ../../../../src/old.js',
    'contracts/entry.ts:2: shared contracts depend on WorkspaceTools',
  ]));
});

it('rejects a missing, unreadable or incomplete module target with a precise reason', async () => {
  const dir = await fixture('core/workspace/entry.ts', 'export {};\n');
  await writeFile(join(dir, MODULE_TARGET_PATH), '{ not json');
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringContaining(`${MODULE_TARGET_PATH}: cannot be read as JSON`),
    expect.stringContaining('source files were not checked'),
  ]));
  await cp(join(project, MODULE_TARGET_PATH), join(dir, MODULE_TARGET_PATH));
  await writeTarget(dir, target => {
    delete target.modules.find(m => m.id === 'WorkGraph')!.dependencies;
    delete target.modules.find(m => m.id === 'RecordStore')!.path;
    target.modules.find(m => m.id === 'Workflow')!.dependencies!.push('Missing');
    delete target.schemaVersion;
  });
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    `${MODULE_TARGET_PATH}: schemaVersion must be 2, found undefined`,
    `${MODULE_TARGET_PATH}: module WorkGraph is missing a "dependencies" string array`,
    `${MODULE_TARGET_PATH}: module RecordStore is missing a "path" of the form src/<dir>/`,
    `${MODULE_TARGET_PATH}: module Workflow depends on unknown Missing`,
  ]));
});

it('rejects module paths that do not exist and stale ownership pointers', async () => {
  const dir = await fixture('core/workspace/entry.ts', 'export {};\n');
  await rm(join(dir, 'src/core/record-store'), { recursive: true });
  await writeTarget(dir, target => { target.implementationOwnership = '../../coding-platform/next/scripts/check-boundaries.mjs'; });
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    `${MODULE_TARGET_PATH}: module RecordStore path src/core/record-store/ does not exist`,
    expect.stringContaining('implementationOwnership ../../coding-platform/next/scripts/check-boundaries.mjs must point to scripts/check-boundaries.mjs'),
  ]));
  await writeTarget(dir, target => { target.implementationOwnership = '../../scripts/check-boundaries.mjs'; target.projectRoot = '../../..'; });
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    `${MODULE_TARGET_PATH}: projectRoot ../../.. does not resolve to this repository`,
  ]));
});

it('rejects outer-layer module ids and non-normalized paths', async () => {
  const dir = await fixture('core/workspace/entry.ts', 'export {};\n');
  await writeTarget(dir, target => {
    target.modules.find(m => m.id === 'RecordStore')!.id = 'Composition';
    target.modules.find(m => m.id === 'WorkspaceTools')!.path = 'src/core//workspace/';
    target.modules.find(m => m.id === 'WorkGraph')!.dependencies = ['WorkspaceTools'];
    target.modules.find(m => m.id === 'AgentRuntime')!.dependencies = ['WorkGraph', 'WorkspaceTools'];
  });
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    `${MODULE_TARGET_PATH}: module id Composition is reserved for an outer layer`,
    `${MODULE_TARGET_PATH}: module WorkspaceTools path src/core//workspace/ must be normalized (no empty, "." or ".." segments)`,
  ]));
});

it('rejects a module dependency cycle', async () => {
  const dir = await fixture('core/workspace/entry.ts', 'export {};\n');
  await writeTarget(dir, target => { target.modules.find(m => m.id === 'RecordStore')!.dependencies = ['Workflow']; });
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringMatching(/module dependency cycle (\w+ -> )+\w+/),
  ]));
});

describe('submodule rules', () => {
  async function graphFixture() {
    const dir = await fixture('core/work-graph/persistence/store.ts', "export const store = 1;\n");
    await source(dir, 'core/work-graph/tasks/claim.ts', "import { store } from '../persistence/store.js';\nexport const claim = store;\n");
    await source(dir, 'core/work-graph/shared.ts', 'export type Shared = 1;\n');
    await writeTarget(dir, target => {
      target.modules.find(m => m.id === 'WorkGraph')!.submodules = [
        { id: 'model', path: 'shared.ts', dependencies: [] },
        { id: 'persistence', path: 'persistence/', dependencies: ['model'] },
        { id: 'tasks', path: 'tasks/', dependencies: ['persistence', 'model'] },
      ];
    });
    return dir;
  }

  it('accepts declared submodule directions and reports observed submodule edges', async () => {
    const dir = await graphFixture();
    expect(await auditSourceTree(dir)).toEqual([]);
    const report = await inspectSourceTree(dir);
    expect(report.observedSubmoduleEdges).toEqual(['WorkGraph/tasks -> WorkGraph/persistence']);
    expect(report.submodules).toEqual(expect.arrayContaining([
      { name: 'WorkGraph/tasks', sourceFiles: 1 }, { name: 'WorkGraph/model', sourceFiles: 1 },
    ]));
  });

  it('rejects a reverse submodule import, including type-only imports, with file and line', async () => {
    const dir = await graphFixture();
    await source(dir, 'core/work-graph/persistence/store.ts',
      "export const store = 1;\nimport type { Claim } from '../tasks/claim.js';\nimport '../shared.js';\n");
    expect(await auditSourceTree(dir)).toEqual([
      'core/work-graph/persistence/store.ts:2: forbidden submodule edge WorkGraph/persistence -> WorkGraph/tasks',
    ]);
  });

  it('requires every module file to have exactly one submodule owner', async () => {
    const dir = await graphFixture();
    await source(dir, 'core/work-graph/stray.ts', 'export {};\n');
    expect(await auditSourceTree(dir)).toEqual([
      `core/work-graph/stray.ts: source file has no WorkGraph submodule owner in ${MODULE_TARGET_PATH}`,
    ]);
  });

  it('fails closed on an import that resolves to no submodule and matches declaration files by name', async () => {
    const dir = await graphFixture();
    await source(dir, 'core/work-graph/model.d.ts', 'export type M = 1;\n');
    await writeTarget(dir, target => {
      target.modules.find(m => m.id === 'WorkGraph')!.submodules!.push({ id: 'decl', path: 'model.d.ts', dependencies: [] });
    });
    await source(dir, 'core/work-graph/persistence/store.ts',
      "export const store = 1;\nimport type { M } from '../model.js';\nimport '../ghost/thing.js';\n");
    expect(await auditSourceTree(dir)).toEqual([
      'core/work-graph/persistence/store.ts:2: forbidden submodule edge WorkGraph/persistence -> WorkGraph/decl',
      'core/work-graph/persistence/store.ts:3: import targets no WorkGraph submodule (../ghost/thing.js)',
    ]);
  });

  it('rejects non-normalized submodule paths', async () => {
    const dir = await graphFixture();
    await writeTarget(dir, target => {
      target.modules.find(m => m.id === 'WorkGraph')!.submodules![2]!.path = './tasks/';
    });
    expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
      `${MODULE_TARGET_PATH}: submodule WorkGraph/tasks path ./tasks/ must be normalized (no empty, "." or ".." segments)`,
    ]));
  });

  it('rejects submodule cycles, overlaps, unknown dependencies and missing paths', async () => {
    const dir = await graphFixture();
    await writeTarget(dir, target => {
      const graph = target.modules.find(m => m.id === 'WorkGraph')!;
      graph.submodules![0]!.dependencies = ['tasks'];
      graph.submodules!.push({ id: 'nested', path: 'tasks/inner/', dependencies: ['ghost'] });
    });
    expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
      expect.stringMatching(/submodule dependency cycle WorkGraph\/\w+ -> .*WorkGraph\/\w+/),
      `${MODULE_TARGET_PATH}: submodule WorkGraph/nested path src/core/work-graph/tasks/inner/ does not exist`,
      `${MODULE_TARGET_PATH}: submodule WorkGraph/nested depends on unknown ghost`,
      `${MODULE_TARGET_PATH}: submodule WorkGraph/nested path tasks/inner/ overlaps WorkGraph/tasks path tasks/`,
      'source files were not checked (ownership, imports, symlinks, UI rules) because docs/refactor/module-target.json is invalid',
    ]));
  });
});

it('rejects omitted skills and substituted analyzer helpers in an otherwise valid copy', async () => {
  const dir = await fixture('core/workspace/entry.ts', 'export {};\n');
  await rm(join(dir, 'vendor/coding-agent/resources/skills/coding-safety/content.md'));
  await writeFile(join(dir, 'scripts/python-source-query.py'), '# substituted helper\n');
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringContaining('runtime asset missing or not physical: vendor/coding-agent/resources/skills/coding-safety/content.md'),
    expect.stringContaining('runtime asset hash differs: scripts/python-source-query.py'),
  ]));
});

it('allows only the frozen Kernel public entry and rejects its internal modules', async () => {
  const dir = await fixture('core/workspace/entry.ts',
    "import { WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';\n");
  expect(await auditSourceTree(dir)).toEqual([]);
  await writeFile(join(dir, 'src', 'core', 'workspace', 'entry.ts'),
    "import '../../../vendor/coding-agent/dist/internal/sandbox.js';\n");
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([expect.stringContaining('escapes next/src')]));
});

it('rejects old-source escape, undeclared alias, computed import and reverse module edges', async () => {
  const dir = await fixture('core/workspace/entry.ts',
    "import '../work-graph/tasks/a.js';\nimport '../../../../src/old.js';\nimport '#old/adapter';\nconst name = './x.js'; import(name);\n");
  const issues = await auditSourceTree(dir);
  expect(issues).toEqual(expect.arrayContaining([
    expect.stringContaining('WorkspaceTools -> WorkGraph'),
    expect.stringContaining('escapes next/src'),
    expect.stringContaining('undeclared or absolute import'),
    expect.stringContaining('computed import'),
  ]));
});

it('rejects contracts depending on a module and any source symlink', async () => {
  const dir = await fixture('contracts/entry.ts', "import '../core/work-graph/tasks/a.js';\n");
  await symlink(join(dir, 'src', 'contracts', 'entry.ts'), join(dir, 'src', 'contracts', 'linked.ts'));
  const issues = await auditSourceTree(dir);
  expect(issues).toEqual(expect.arrayContaining([
    expect.stringContaining('shared contracts depend on WorkGraph'),
    expect.stringContaining('source symlink is forbidden'),
  ]));
});

it('rejects path aliases even when no source imports them yet', async () => {
  const dir = await fixture('core/record-store/entry.ts', 'export {};\n');
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { '@old/*': ['../src/*'] } } }));
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([expect.stringContaining('path aliases')]));
});

it('rejects createRequire, import-equals and executable .cts escapes', async () => {
  const dir = await fixture('core/workspace/entry.cts',
    "import { createRequire as makeRequire } from 'node:module';\nconst load = makeRequire(import.meta.url); load('/old/src');\nimport old = require('../../../../src/legacy.js');\n");
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringContaining('node:module is forbidden'),
    expect.stringContaining('import escapes next/src'),
  ]));
});

it('rejects inherited aliases and TypeScript configurations outside next', async () => {
  const dir = await fixture('core/record-store/entry.ts', 'export {};\n');
  await writeFile(join(dir, 'base.json'), JSON.stringify({ compilerOptions: { rootDirs: ['src', '../src'] } }));
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ extends: './base.json' }));
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([expect.stringContaining('path aliases') ]));
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ extends: '../outside.json' }));
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([expect.stringContaining('extends escapes next')]));
  await symlink(join(project, 'tsconfig.json'), join(dir, 'linked.json'));
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ extends: './linked.json' }));
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([expect.stringContaining('resolves outside next')]));
});

it('checks the copied Kernel public dependency closure for symlinks', async () => {
  const dir = await fixture('core/workspace/entry.ts',
    "import { WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';\n");
  const dependency = join(dir, 'vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js');
  await rename(dependency, dependency + '.saved');
  await symlink(dependency + '.saved', dependency);
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringContaining('frozen Kernel symlink is forbidden'),
  ]));
});

it('permits the composition root to depend on modules but forbids reverse imports', async () => {
  const dir = await fixture('composition/platform.ts',
    "import type { Store } from '../core/record-store/ports.js';\nimport type { Goal } from '../core/work-graph/materials/record-ports.js';\n");
  expect(await auditSourceTree(dir)).toEqual([]);
  await mkdir(join(dir, 'src/core/record-store'), { recursive: true });
  await writeFile(join(dir, 'src/core/record-store/back-edge.ts'),
    "import '../../composition/platform.js';\n");
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringContaining('RecordStore depends on composition'),
  ]));
});

it('rejects local or unapproved package declarations and package links into old source', async () => {
  const dir = await fixture('core/record-store/entry.ts', "import ts from 'typescript';\n");
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>; dependencies?: Record<string, string>;
  };
  manifest.dependencies = { 'old-business': 'file:../src' };
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringContaining('unapproved dependency old-business'),
    expect.stringContaining('local dependency protocol is forbidden for old-business'),
  ]));
  manifest.dependencies = { typescript: '6.0.3' };
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
  await mkdir(join(dir, 'node_modules'));
  const externalPackage = await mkdtemp(join(tmpdir(), 'next-external-package-'));
  temporary.push(externalPackage);
  await writeFile(join(externalPackage, 'package.json'), '{"name":"typescript"}');
  await symlink(externalPackage, join(dir, 'node_modules', 'typescript'));
  expect(await auditSourceTree(dir)).toEqual(expect.arrayContaining([
    expect.stringContaining('dependency typescript resolves outside installed third-party packages'),
  ]));
});
