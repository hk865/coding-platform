import { afterEach, expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, rm, symlink, writeFile, rename, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSourceTree, inspectSourceTree } from '../../scripts/check-boundaries.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary: string[] = [];
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function fixture(path: string, source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'next-boundary-test-'));
  temporary.push(dir);
  for (const name of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'runtime-assets.json'])
    await cp(join(project, name), join(dir, name));
  for (const name of ['scripts', '.local', 'resources'])
    await cp(join(project, name), join(dir, name), { recursive: true });
  await cp(join(project, 'vendor', 'coding-agent'), join(dir, 'vendor', 'coding-agent'), { recursive: true });
  const file = join(dir, 'src', path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
  return dir;
}

it('accepts target module and shared-contract directions without requiring all eight edges to be used', async () => {
  const dir = await fixture('business/workflow/entry.ts',
    "import type { A } from '../../contracts/a.js';\nimport type { B } from '../../core/agent-runtime/b.js';\n");
  expect(await auditSourceTree(dir)).toEqual([]);
  const report = await inspectSourceTree(dir);
  expect(report.modules).toContainEqual({ name: 'Workflow', directory: true, sourceFiles: 1 });
  expect(report.modules).toContainEqual({ name: 'RecordStore', directory: false, sourceFiles: 0 });
  expect(report.observedEdges).toEqual(['Workflow -> AgentRuntime']);
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
