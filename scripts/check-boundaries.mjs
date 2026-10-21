import { readdir, lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, extname, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { PLATFORM_PACK_GENERATED_PATH, readPlatformPack, renderPlatformPackModule } from './build-platform-prompts.mjs';

/** The single source of the module and submodule rules (task C, 2026-10-02). */
export const MODULE_TARGET_PATH = 'docs/refactor/module-target.json';
const MODULE_TARGET_SCHEMA = 2;
const OUTER_LAYER_PREFIXES = ['src/contracts/', 'src/composition/', 'src/app/'];
// Outer-layer owners have fixed rules in checkSpecifier; a JSON module may not borrow their names.
const RESERVED_MODULE_IDS = new Set(['Contracts', 'Composition', 'Host']);
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const APPROVED_NEXT_PACKAGES = new Set(['typescript', 'vitest', '@vitest/coverage-v8', '@types/node', 'marked', 'esbuild']);
const APPROVED_KERNEL_PACKAGES = new Set(['openai', 'zod']);
// Spec §14.5: globals a pure submodule may not use (besides `Date.now`, `Math.random` and an argument-less `Date`).
const PURE_FORBIDDEN_GLOBALS = new Set(['process', 'globalThis', 'fetch', 'setTimeout', 'setInterval', 'setImmediate',
  'queueMicrotask', 'crypto', 'performance']);
const inside =(root, path) => path === root || path.startsWith(root + sep);
// `x.d.ts`, `x.ts` and an `x.js` specifier all name the same module.
const withoutSourceExtension = path => path.replace(/(?:\.d)?\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/, '');
// Ownership compares raw path prefixes, so declared paths must already be normalized.
const isNormalizedPath = path => !path.split('/').slice(0, path.endsWith('/') ? -1 : undefined)
  .some(segment => segment === '' || segment === '.' || segment === '..') && posix.normalize(path) === path;
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

async function isRealDirectory(path) {
  try { const stat = await lstat(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; }
}
async function isRealFile(path) {
  try { const stat = await lstat(path); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
}

/** Returns one dependency cycle as ['A', 'B', 'A'], or null for a DAG. */
function findCycle(nodes, dependenciesOf) {
  const state = new Map();
  const stack = [];
  function visit(node) {
    state.set(node, 'open');
    stack.push(node);
    for (const next of dependenciesOf(node)) {
      if (state.get(next) === 'open') return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) { const cycle = visit(next); if (cycle) return cycle; }
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  }
  for (const node of nodes) if (!state.has(node)) { const cycle = visit(node); if (cycle) return cycle; }
  return null;
}

function checkDependencyList(label, self, value, known, fail) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    fail(`${label} is missing a "dependencies" string array`);
    return [];
  }
  const seen = new Set();
  for (const dependency of value) {
    if (seen.has(dependency)) fail(`${label} lists dependency ${dependency} twice`);
    seen.add(dependency);
    if (dependency === self) fail(`${label} may not depend on itself`);
    else if (!known.has(dependency)) fail(`${label} depends on unknown ${dependency}`);
  }
  return [...seen].filter(dependency => known.has(dependency));
}

/**
 * Reads and validates docs/refactor/module-target.json. Missing fields, paths
 * that do not exist in this repository, overlapping ownership and dependency
 * cycles are reported as issues; callers must not guess rules from a broken file.
 */
export async function loadModuleTarget(projectDir) {
  const project = resolve(projectDir);
  const targetFile = resolve(project, MODULE_TARGET_PATH);
  const issues = [];
  const fail = message => issues.push(`${MODULE_TARGET_PATH}: ${message}`);
  let raw;
  try { raw = JSON.parse(await readFile(targetFile, 'utf8')); }
  catch (error) {
    fail(`cannot be read as JSON (${error?.code ?? error?.message ?? String(error)})`);
    return { modules: [], issues };
  }
  if (!isObject(raw)) { fail('top level must be a JSON object'); return { modules: [], issues }; }
  if (raw.schemaVersion !== MODULE_TARGET_SCHEMA)
    fail(`schemaVersion must be ${MODULE_TARGET_SCHEMA}, found ${JSON.stringify(raw.schemaVersion)}`);
  const base = dirname(targetFile);
  if (typeof raw.projectRoot !== 'string' || !raw.projectRoot) fail('is missing the "projectRoot" string');
  else if (resolve(base, raw.projectRoot) !== project) fail(`projectRoot ${raw.projectRoot} does not resolve to this repository`);
  if (typeof raw.implementationOwnership !== 'string' || !raw.implementationOwnership)
    fail('is missing the "implementationOwnership" string');
  else {
    const checker = resolve(base, raw.implementationOwnership);
    if (checker !== resolve(project, 'scripts/check-boundaries.mjs'))
      fail(`implementationOwnership ${raw.implementationOwnership} must point to scripts/check-boundaries.mjs in this repository`);
    else if (!await isRealFile(checker)) fail(`implementationOwnership ${raw.implementationOwnership} does not exist`);
  }
  // Spec §14.4 (L-8): the top-level list was replaced by `pure: true` on a submodule; a
  // leftover list would otherwise be ignored without a word, so it is refused.
  if (raw.pureDirectories !== undefined)
    fail('"pureDirectories" is no longer read; declare "pure": true on the submodule instead');
  if (!Array.isArray(raw.modules) || raw.modules.length === 0) {
    fail('"modules" must be a non-empty array');
    return { modules: [], issues };
  }
  const ids = new Set();
  for (const [index, entry] of raw.modules.entries()) {
    if (!isObject(entry) || typeof entry.id !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(entry.id)) {
      fail(`modules[${index}] is missing a valid "id"`);
      continue;
    }
    if (RESERVED_MODULE_IDS.has(entry.id)) fail(`module id ${entry.id} is reserved for an outer layer`);
    if (ids.has(entry.id)) fail(`module id ${entry.id} is declared twice`);
    ids.add(entry.id);
  }
  const modules = [];
  for (const entry of raw.modules) {
    if (!isObject(entry) || typeof entry.id !== 'string') continue;
    const label = `module ${entry.id}`;
    if (typeof entry.path !== 'string' || !/^src\/.+\/$/.test(entry.path) || entry.path.includes('..')) {
      fail(`${label} is missing a "path" of the form src/<dir>/`);
      continue;
    }
    if (!isNormalizedPath(entry.path)) {
      fail(`${label} path ${entry.path} must be normalized (no empty, "." or ".." segments)`);
      continue;
    }
    if (OUTER_LAYER_PREFIXES.some(prefix => entry.path.startsWith(prefix)))
      fail(`${label} path ${entry.path} lies inside an outer layer`);
    if (!await isRealDirectory(resolve(project, entry.path))) fail(`${label} path ${entry.path} does not exist`);
    const dependencies = checkDependencyList(label, entry.id, entry.dependencies, ids, fail);
    const prefix = entry.path.slice('src/'.length, -1);
    const module = { id: entry.id, path: entry.path, prefix, dependencies, submodules: null };
    if (entry.submodules !== undefined) module.submodules = await loadSubmodules(project, module, entry.submodules, fail);
    modules.push(module);
  }
  for (const a of modules) for (const b of modules) {
    if (a !== b && (a.prefix + '/').startsWith(b.prefix + '/'))
      fail(`module ${a.id} path ${a.path} overlaps module ${b.id} path ${b.path}`);
  }
  const byId = new Map(modules.map(module => [module.id, module]));
  const cycle = findCycle(modules.map(module => module.id), id => byId.get(id)?.dependencies ?? []);
  if (cycle) fail(`module dependency cycle ${cycle.join(' -> ')}`);
  return { modules, issues };
}

/**
 * A submodule entry: `id`, `path` (a directory ending in / or one source file,
 * relative to the module), `dependencies` (sibling submodule ids) and the
 * optional `pure: true` (spec §14.4, L-8): a pure directory whose files import
 * only src/contracts/, their own submodule and its declared dependencies, and
 * reach no clock, randomness, timer, network or process global (§14.5).
 */
async function loadSubmodules(project, module, value, fail) {
  const label = `module ${module.id}`;
  if (!Array.isArray(value) || value.length === 0) { fail(`${label} "submodules" must be a non-empty array`); return null; }
  const ids = new Set();
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry) || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
      fail(`${label} submodules[${index}] is missing a valid lower-case "id"`);
      continue;
    }
    if (ids.has(entry.id)) fail(`${label} submodule ${entry.id} is declared twice`);
    ids.add(entry.id);
  }
  const submodules = [];
  for (const entry of value) {
    if (!isObject(entry) || typeof entry.id !== 'string') continue;
    const subLabel = `submodule ${module.id}/${entry.id}`;
    const path = entry.path;
    const directory = typeof path === 'string' && path.endsWith('/');
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('..') || path.includes('\\') ||
      (!directory && !sourceExtensions.has(extname(path)))) {
      fail(`${subLabel} is missing a "path" relative to ${module.path} (a directory ending in / or one source file)`);
      continue;
    }
    if (!isNormalizedPath(path)) {
      fail(`${subLabel} path ${path} must be normalized (no empty, "." or ".." segments)`);
      continue;
    }
    const absolute = resolve(project, module.path, path);
    if (!(directory ? await isRealDirectory(absolute) : await isRealFile(absolute)))
      fail(`${subLabel} path ${module.path}${path} does not exist`);
    const dependencies = checkDependencyList(subLabel, entry.id, entry.dependencies, ids, fail);
    if (entry.pure !== undefined && typeof entry.pure !== 'boolean') fail(`${subLabel} "pure" must be true or false`);
    const pure = entry.pure === true;
    if (pure && !directory) fail(`${subLabel} is pure, so its path must be a directory ending in /`);
    submodules.push({ id: entry.id, path, directory, dependencies, pure });
  }
  for (const a of submodules) for (const b of submodules) {
    if (a === b) continue;
    const overlaps = a.path === b.path || (b.directory && a.path.startsWith(b.path));
    if (overlaps) fail(`submodule ${module.id}/${a.id} path ${a.path} overlaps ${module.id}/${b.id} path ${b.path}`);
  }
  const byId = new Map(submodules.map(submodule => [submodule.id, submodule]));
  const cycle = findCycle(submodules.map(submodule => submodule.id), id => byId.get(id)?.dependencies ?? []);
  if (cycle) fail(`submodule dependency cycle ${cycle.map(id => `${module.id}/${id}`).join(' -> ')}`);
  return submodules;
}

/**
 * The platform prompt pack is a build-time asset closure: pack.json names the
 * string table, each template file and each tool text file. Every referenced
 * file must be hashed in runtime-assets.json so the generic asset loop catches
 * a missing or edited pack file. This check is deliberately narrow: it reads
 * the pack of the directory it is given and says nothing about the generated
 * module, because the boundaries fixtures copy resources but not src.
 */
async function checkPlatformPromptPackClosure(project, assetPaths, issues) {
  if (assetPaths === null) return;
  const packRoot = resolve(project, 'resources/prompts/platform');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(packRoot, 'pack.json'), 'utf8'));
  } catch (error) {
    // A tree without a platform pack has no closure to check; a malformed one
    // is reported rather than silently passing.
    if (error?.code === 'ENOENT') return;
    issues.push('platform prompt pack is missing or not valid JSON: resources/prompts/platform/pack.json');
    return;
  }
  if (!isObject(manifest) || typeof manifest.strings !== 'string'
    || !isObject(manifest.templates) || !isObject(manifest.tools)) {
    issues.push('platform prompt pack is missing or invalid: resources/prompts/platform/pack.json');
    return;
  }
  const references = [manifest.strings];
  for (const entry of Object.values(manifest.templates))
    if (isObject(entry) && typeof entry.file === 'string') references.push(entry.file);
  for (const file of Object.values(manifest.tools)) if (typeof file === 'string') references.push(file);
  for (const reference of references) {
    const asset = relative(project, resolve(packRoot, reference)).split(sep).join('/');
    if (!assetPaths.has(asset))
      issues.push(`platform prompt pack references a file not listed in runtime-assets.json: ${asset}`);
  }
}

/** Owner of a path relative to the module directory, compared without extension. */
function submoduleOwner(module, pathInModule) {
  if (!module.submodules) return null;
  const bare = withoutSourceExtension(pathInModule);
  return module.submodules.find(submodule => submodule.directory
    ? pathInModule.startsWith(submodule.path)
    : withoutSourceExtension(submodule.path) === bare)?.id ?? null;
}

/** Static architecture check. The isolated build separately proves every local
 * import resolves without the old repository. No aliases or generated shims. */
export async function inspectSourceTree(projectDir) {
  const project = resolve(projectDir);
  const sourceRoot = resolve(project, 'src');
  const vendorRoot = resolve(project, 'vendor/coding-agent');
  const publicKernelEntry = resolve(project, 'vendor/coding-agent/dist/public-api.js');
  const target = await loadModuleTarget(project);
  const issues = [...target.issues];
  const MODULES = target.modules;
  const MODULE_BY_NAME = new Map(MODULES.map(module => [module.id, module]));
  const MODULE_NAMES = new Set(MODULE_BY_NAME.keys());
  const ALLOWED = Object.fromEntries(MODULES.map(module => [module.id, new Set(module.dependencies)]));
  const owner = rel => rel.startsWith('contracts/') ? 'Contracts'
    : rel.startsWith('composition/') ? 'Composition'
    : rel.startsWith('app/') ? 'Host'
    : MODULES.find(({ prefix }) => rel === prefix || rel.startsWith(prefix + '/'))?.id ?? null;
  const moduleFileCounts = new Map(MODULES.map(({ id }) => [id, 0]));
  const submoduleFileCounts = new Map();
  const observedEdges = new Set();
  const observedSubmoduleEdges = new Set();
  // Executable helpers and skills are runtime dependencies even though they
  // are not JavaScript imports. Keep the frozen asset closure physical and
  // complete, so a successful typecheck cannot hide a missing runtime file.
  let runtimeAssetPaths = null;
  try {
    const assets = JSON.parse(await readFile(resolve(project, 'runtime-assets.json'), 'utf8'));
    if (Array.isArray(assets)) runtimeAssetPaths = new Set(assets.map(asset => asset.path));
    for (const asset of assets) {
      const path = resolve(project, asset.path);
      if (!inside(project, path)) { issues.push(`runtime asset escapes next: ${asset.path}`); continue; }
      try {
        for (let cursor = path; cursor !== project; cursor = dirname(cursor)) {
          if ((await lstat(cursor)).isSymbolicLink()) throw Error('symlink');
        }
        const hash = createHash('sha256').update(await readFile(path)).digest('hex');
        if (hash !== asset.sha256) issues.push(`runtime asset hash differs: ${asset.path}`);
      } catch { issues.push(`runtime asset missing or not physical: ${asset.path}`); }
    }
  } catch { issues.push('runtime asset manifest is missing or invalid'); }
  await checkPlatformPromptPackClosure(project, runtimeAssetPaths, issues);
  const packageJson = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8'));
  const dependencies = new Set([...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {})]);
  async function checkDependencies(manifest, approved, roots, label) {
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (!approved.has(name)) issues.push(`${label}: unapproved dependency ${name}`);
      if (typeof version !== 'string' || /^(?:file|link|workspace):/.test(version))
        issues.push(`${label}: local dependency protocol is forbidden for ${name}`);
      let found = false;
      let anyRoot = false;
      for (const root of roots) {
        let installRoot;
        try { installRoot = await realpath(root); anyRoot = true; } catch { continue; }
        try {
          const resolvedPackage = await realpath(resolve(root, name));
          found = true;
          if (!inside(installRoot, resolvedPackage))
            issues.push(`${label}: dependency ${name} resolves outside installed third-party packages`);
          break;
        } catch { /* package may be installed in the next search root */ }
      }
      if (anyRoot && !found) issues.push(`${label}: installed dependency ${name} is missing`);
    }
  }
  await checkDependencies(packageJson, APPROVED_NEXT_PACKAGES,
    [resolve(project, 'node_modules')], 'package.json');
  const checkedConfigs = new Set();
  function checkConfig(path) {
    if (checkedConfigs.has(path)) return;
    checkedConfigs.add(path);
    if (!inside(project, path)) { issues.push(`${relative(project, path)}: TypeScript extends escapes next`); return; }
    if (ts.sys.realpath && !inside(project, ts.sys.realpath(path))) {
      issues.push(`${relative(project, path)}: TypeScript extends resolves outside next`);
      return;
    }
    const config = ts.readConfigFile(path, ts.sys.readFile);
    if (config.error) { issues.push(`${relative(project, path)}: invalid TypeScript configuration`); return; }
    const rel = relative(project, path);
    if (config.config?.compilerOptions?.paths || config.config?.compilerOptions?.baseUrl ||
      config.config?.compilerOptions?.rootDirs) issues.push(`${rel}: path aliases and alternate roots are forbidden`);
    for (const key of ['outDir', 'rootDir']) {
      const value = config.config?.compilerOptions?.[key];
      if (typeof value === 'string' && !inside(project, resolve(dirname(path), value)))
        issues.push(`${rel}: ${key} escapes next`);
    }
    if (Array.isArray(config.config?.include)) {
      for (const entry of config.config.include) {
        if (typeof entry !== 'string') continue;
        const prefix = entry.replace(/[\\/]?\*.*$/, '');
        if (!inside(project, resolve(dirname(path), prefix))) issues.push(`${rel}: include escapes next: ${entry}`);
      }
    }
    const parent = config.config?.extends;
    if (parent !== undefined) {
      if (typeof parent !== 'string' || !parent.startsWith('.')) {
        issues.push(`${rel}: TypeScript extends must be a local next configuration`);
      } else {
        const target = resolve(dirname(path), parent);
        checkConfig(target.endsWith('.json') ? target : target + '.json');
      }
    }
  }
  for (const configName of ['tsconfig.json', 'tsconfig.build.json']) {
    try { await lstat(resolve(project, configName)); } catch { continue; }
    checkConfig(resolve(project, configName));
  }

  const kernelSeen = new Set();
  async function safeKernelPath(path) {
    for (let cursor = path; inside(vendorRoot, cursor); cursor = dirname(cursor)) {
      let stat;
      try { stat = await lstat(cursor); }
      catch { issues.push(`${relative(project, path)}: frozen Kernel dependency is missing`); return false; }
      if (stat.isSymbolicLink()) { issues.push(`${relative(project, cursor)}: frozen Kernel symlink is forbidden`); return false; }
      if (cursor === vendorRoot) break;
    }
    if (!inside(vendorRoot, await realpath(path))) {
      issues.push(`${relative(project, path)}: frozen Kernel dependency escapes next/vendor`);
      return false;
    }
    return true;
  }
  async function auditKernelClosure(path, vendorDependencies) {
    if (kernelSeen.has(path)) return;
    kernelSeen.add(path);
    if (!await safeKernelPath(path)) return;
    const content = await readFile(path, 'utf8');
    const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
    const dependenciesToVisit = [];
    function checkKernelSpecifier(specifier) {
      if (typeof specifier !== 'string') { issues.push(`${relative(project, path)}: computed Kernel import is forbidden`); return; }
      if (specifier.startsWith('node:')) return;
      if (!specifier.startsWith('.')) {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!vendorDependencies.has(name)) issues.push(`${relative(project, path)}: undeclared Kernel dependency ${specifier}`);
        return;
      }
      const target = resolve(dirname(path), specifier);
      if (!inside(resolve(vendorRoot, 'dist'), target)) {
        issues.push(`${relative(project, path)}: Kernel import escapes frozen dist: ${specifier}`);
        return;
      }
      dependenciesToVisit.push(target);
    }
    function walkKernel(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        checkKernelSpecifier(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const arg = node.arguments[0];
        checkKernelSpecifier(arg && ts.isStringLiteral(arg) ? arg.text : null);
      }
      ts.forEachChild(node, walkKernel);
    }
    walkKernel(file);
    for (const target of dependenciesToVisit) await auditKernelClosure(target, vendorDependencies);
  }
  // Only the public entry is callable by the product. Its frozen transitive
  // runtime imports must themselves remain real files inside the copied build.
  try {
    if (await safeKernelPath(resolve(vendorRoot, 'package.json'))) {
      const kernelPackage = JSON.parse(await readFile(resolve(vendorRoot, 'package.json'), 'utf8'));
      const vendorDependencies = new Set(Object.keys(kernelPackage.dependencies ?? {}));
      await checkDependencies({ dependencies: kernelPackage.dependencies }, APPROVED_KERNEL_PACKAGES,
        [resolve(vendorRoot, 'node_modules')],
        'vendor/coding-agent/package.json');
      await auditKernelClosure(publicKernelEntry, vendorDependencies);
    }
  } catch (error) { issues.push(`frozen Kernel closure cannot be read: ${String(error)}`); }
  async function visit(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) { issues.push(`${relative(project, path)}: source symlink is forbidden`); return; }
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(resolve(path, name));
      return;
    }
    if (!sourceExtensions.has(extname(path))) return;
    const rel = relative(sourceRoot, path).split(sep).join('/');
    const from = owner(rel);
    if (moduleFileCounts.has(from)) moduleFileCounts.set(from, moduleFileCounts.get(from) + 1);
    if (!from) issues.push(`${rel}: source file has no target module or contracts owner`);
    const fromModule = MODULE_BY_NAME.get(from);
    const fromSubmodule = fromModule?.submodules ? submoduleOwner(fromModule, rel.slice(fromModule.prefix.length + 1)) : null;
    const fromSubmoduleEntry = fromSubmodule ? fromModule.submodules.find(submodule => submodule.id === fromSubmodule) : null;
    const pure = fromSubmoduleEntry?.pure === true;
    if (fromModule?.submodules) {
      if (!fromSubmodule) issues.push(`${rel}: source file has no ${from} submodule owner in ${MODULE_TARGET_PATH}`);
      else {
        const key = `${from}/${fromSubmodule}`;
        submoduleFileCounts.set(key, (submoduleFileCounts.get(key) ?? 0) + 1);
      }
    }
    const content = await readFile(path, 'utf8');
    const file = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
    // Every import diagnostic names the file and the 1-based line of the import.
    const at = node => `${rel}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
    // Spec §14.4: a pure submodule imports only src/contracts/, its own files and
    // its declared submodule dependencies (types or values). Checked BEFORE the
    // generic exemptions, so a `node:` builtin, a package, the Kernel entry or
    // another source cannot pass; an allowed sibling still meets the submodule rules.
    function pureImportAllowed(specifier) {
      if (!specifier.startsWith('.')) return false;
      const targetRel = relative(sourceRoot, resolve(dirname(path), specifier)).split(sep).join('/');
      if (targetRel.startsWith('contracts/')) return true;
      if (!targetRel.startsWith(fromModule.prefix + '/')) return false;
      const toSubmodule = submoduleOwner(fromModule, targetRel.slice(fromModule.prefix.length + 1));
      return toSubmodule === fromSubmodule || fromSubmoduleEntry.dependencies.includes(toSubmodule);
    }
    // Spec §14.1/§14.5: a pure submodule does no IO and reads no clock, so it
    // may not reach the clock, randomness, timers, the network or the process
    // through globals either; `now` and ids arrive through ctx or event payloads.
    function pureGlobalUse(node) {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
        const name = `${node.expression.text}.${node.name.text}`;
        return name === 'Date.now' || name === 'Math.random' ? name : null;
      }
      if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression)
        && node.expression.text === 'Date' && (node.arguments?.length ?? 0) === 0)
        return ts.isNewExpression(node) ? 'new Date()' : 'Date()';
      if (!ts.isIdentifier(node) || !PURE_FORBIDDEN_GLOBALS.has(node.text)) return null;
      // A value reference, not a property or declaration name and not a type position.
      const parent = node.parent;
      if (ts.isShorthandPropertyAssignment(parent)) return node.text;
      if (parent.name === node || parent.propertyName === node || parent.label === node) return null;
      if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) return null;
      return node.text;
    }
    function checkSpecifier(specifier, node) {
      const loc = at(node);
      if (typeof specifier !== 'string') { issues.push(`${loc}: computed import/require is forbidden`); return; }
      if (pure && !pureImportAllowed(specifier)) {
        issues.push(`${loc}: pure directory may not import ${specifier}`);
        return;
      }
      if (specifier === 'node:module') { issues.push(`${loc}: node:module is forbidden in product source`); return; }
      if (specifier.startsWith('node:')) return;
      if (!specifier.startsWith('.')) {
        const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!dependencies.has(packageName)) issues.push(`${loc}: undeclared or absolute import ${specifier}`);
        return;
      }
      const target = resolve(dirname(path), specifier);
      // A frozen Kernel public build is the one non-src source dependency.
      // Internal Kernel files and the former repository's vendor tree remain forbidden.
      if (target === publicKernelEntry) return;
      if (!inside(sourceRoot, target)) { issues.push(`${loc}: import escapes next/src: ${specifier}`); return; }
      const targetRel = relative(sourceRoot, target).split(sep).join('/');
      const to = owner(targetRel);
      if (!to) { issues.push(`${loc}: import targets no target module: ${specifier}`); return; }
      // The Host is an outer layer: it may use composition plus the public
      // module ports. Core modules never depend on it.
      if (to === 'Host') {
        if (from === 'Host') return;
        issues.push(`${loc}: ${from} may not depend on the Host layer`);
        return;
      }
      if (from === 'Host') {
        if (to === 'Composition' || to === 'Contracts' || MODULE_NAMES.has(to)) return;
        issues.push(`${loc}: Host may only depend on composition, contracts and public module ports (${to})`);
        return;
      }
      if (from === 'Contracts' && to !== 'Contracts') issues.push(`${loc}: shared contracts depend on ${to}`);
      else if (to === 'Composition' && from !== 'Composition') issues.push(`${loc}: ${from} depends on composition`);
      else if (from === 'Composition') return;
      else if (from && from !== to && to !== 'Contracts' && !ALLOWED[from]?.has(to))
        issues.push(`${loc}: forbidden module edge ${from} -> ${to}`);
      else if (from && from !== to && to !== 'Contracts') observedEdges.add(`${from} -> ${to}`);
      else if (from && from === to && fromSubmodule) {
        // Submodule rules apply to every import inside one module, type-only included.
        const toSubmodule = submoduleOwner(fromModule, targetRel.slice(fromModule.prefix.length + 1));
        // Fail closed: an import that resolves to no submodule cannot be proven to follow the rules.
        if (!toSubmodule) { issues.push(`${loc}: import targets no ${from} submodule (${specifier})`); return; }
        if (toSubmodule === fromSubmodule) return;
        const edge = `${from}/${fromSubmodule} -> ${from}/${toSubmodule}`;
        const allowed = fromModule.submodules.find(submodule => submodule.id === fromSubmodule)?.dependencies ?? [];
        if (allowed.includes(toSubmodule)) observedSubmoduleEdges.add(edge);
        else issues.push(`${loc}: forbidden submodule edge ${edge}`);
      }
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        checkSpecifier(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null, node);
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
        checkSpecifier(ts.isStringLiteral(node.moduleReference.expression) ? node.moduleReference.expression.text : null, node);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        checkSpecifier(ts.isStringLiteral(node.argument.literal) ? node.argument.literal.text : null, node);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.getText(file) === 'require.resolve'))) {
        const arg = node.arguments[0];
        checkSpecifier(arg && ts.isStringLiteral(arg) ? arg.text : null, node);
      }
      if (pure) {
        const global = pureGlobalUse(node);
        if (global !== null) issues.push(`${at(node)}: pure directory may not use ${global}`);
      }
      ts.forEachChild(node, walk);
    }
    walk(file);
  }
  // A broken module target has no trustworthy ownership; do not report a flood
  // of derived "no owner" issues on top of the precise target issues.
  if (target.issues.length)
    issues.push(`source files were not checked (ownership, imports, symlinks) because ${MODULE_TARGET_PATH} is invalid`);
  else await visit(sourceRoot);
  const modules = [];
  for (const { id, path } of MODULES)
    modules.push({ name: id, directory: await isRealDirectory(resolve(project, path)), sourceFiles: moduleFileCounts.get(id) });
  const submodules = [];
  const pureSubmodules = [];
  for (const module of MODULES) for (const submodule of module.submodules ?? []) {
    submodules.push({ name: `${module.id}/${submodule.id}`, sourceFiles: submoduleFileCounts.get(`${module.id}/${submodule.id}`) ?? 0 });
    if (submodule.pure) pureSubmodules.push(`${module.id}/${submodule.id}`);
  }
  const allowedEdgeCount = MODULES.reduce((count, module) => count + module.dependencies.length, 0);
  return {
    issues, modules, submodules, allowedEdgeCount, pureSubmodules,
    observedEdges: [...observedEdges].sort(), observedSubmoduleEdges: [...observedSubmoduleEdges].sort(),
  };
}

export async function auditSourceTree(projectDir) {
  return (await inspectSourceTree(projectDir)).issues;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { issues, modules, submodules, allowedEdgeCount, pureSubmodules, observedEdges, observedSubmoduleEdges } =
    await inspectSourceTree(project);
  // This branch only runs on a real repository, so it may compare the committed
  // generated module with a fresh generation. The boundaries fixtures do not
  // copy src and must keep inspectSourceTree free of that comparison.
  try {
    const expected = renderPlatformPackModule(await readPlatformPack(project));
    let committed;
    try { committed = await readFile(resolve(project, PLATFORM_PACK_GENERATED_PATH), 'utf8'); }
    catch { issues.push(`platform prompt pack generated module is missing: ${PLATFORM_PACK_GENERATED_PATH}`); }
    if (committed !== undefined && committed !== expected)
      issues.push(`platform prompt pack generated module is stale: run node scripts/build-platform-prompts.mjs`);
  } catch (error) {
    issues.push(`platform prompt pack cannot be generated: ${error?.message ?? String(error)}`);
  }
  for (const module of modules) process.stdout.write(`${module.name}: directory=${module.directory}, sourceFiles=${module.sourceFiles}\n`);
  process.stdout.write(`observed module edges: ${observedEdges.length}/${allowedEdgeCount} allowed (${observedEdges.join(', ') || 'none'})\n`);
  for (const submodule of submodules) process.stdout.write(`  ${submodule.name}: sourceFiles=${submodule.sourceFiles}\n`);
  if (submodules.length)
    process.stdout.write(`observed submodule edges: ${observedSubmoduleEdges.length} (${observedSubmoduleEdges.join(', ') || 'none'})\n`);
  if (pureSubmodules.length) process.stdout.write(`pure submodules: ${pureSubmodules.join(', ')}\n`);
  if (issues.length) { for (const issue of issues) process.stderr.write(`${issue}\n`); process.exitCode = 1; }
  else process.stdout.write('next source boundaries: OK\n');
}
