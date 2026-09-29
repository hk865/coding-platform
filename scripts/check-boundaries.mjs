import { readdir, lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createHash } from 'node:crypto';

const MODULES = [
  ['Workflow', 'business/workflow'],
  ['WorkGraph', 'core/work-graph'],
  ['AgentRuntime', 'core/agent-runtime'],
  ['WorkspaceTools', 'core/workspace'],
  ['RecordStore', 'core/record-store'],
];
const ALLOWED = {
  Workflow: new Set(['WorkGraph', 'AgentRuntime', 'WorkspaceTools']),
  WorkGraph: new Set(['WorkspaceTools', 'RecordStore']),
  AgentRuntime: new Set(['WorkGraph', 'WorkspaceTools', 'RecordStore']),
  WorkspaceTools: new Set(), RecordStore: new Set(),
};
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const APPROVED_NEXT_PACKAGES = new Set(['typescript', 'vitest', '@types/node', 'marked', 'esbuild']);
const APPROVED_KERNEL_PACKAGES = new Set(['openai', 'zod']);
const inside = (root, path) => path === root || path.startsWith(root + sep);
const owner = rel => rel.startsWith('contracts/') ? 'Contracts'
  : rel.startsWith('composition/') ? 'Composition'
  : rel.startsWith('app/') ? 'Host'
  : rel.startsWith('ui/') ? 'UI'
  : MODULES.find(([, prefix]) => rel === prefix || rel.startsWith(prefix + '/'))?.[0] ?? null;
const MODULE_NAMES = new Set(MODULES.map(([name]) => name));

/** Static architecture check. The isolated build separately proves every local
 * import resolves without the old repository. No aliases or generated shims. */
export async function inspectSourceTree(projectDir) {
  const project = resolve(projectDir);
  const sourceRoot = resolve(project, 'src');
  const vendorRoot = resolve(project, 'vendor/coding-agent');
  const publicKernelEntry = resolve(project, 'vendor/coding-agent/dist/public-api.js');
  const issues = [];
  const moduleFileCounts = new Map(MODULES.map(([name]) => [name, 0]));
  const observedEdges = new Set();
  // Executable helpers and skills are runtime dependencies even though they
  // are not JavaScript imports. Keep the frozen asset closure physical and
  // complete, so a successful typecheck cannot hide a missing runtime file.
  try {
    const assets = JSON.parse(await readFile(resolve(project, 'runtime-assets.json'), 'utf8'));
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
  let uiDirectory = false;
  try { uiDirectory = (await lstat(resolve(sourceRoot, 'ui'))).isDirectory(); } catch { uiDirectory = false; }
  if (uiDirectory) {
    try { await lstat(resolve(project, 'tsconfig.ui.json')); }
    catch { issues.push('tsconfig.ui.json is required while src/ui exists'); }
  }
  for (const configName of ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.ui.json']) {
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
    const content = await readFile(path, 'utf8');
    const file = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
    const uiDtoModules = new Set(['core-http-types', 'host-settings-types'].map(name => resolve(sourceRoot, 'app', name)));
    const withoutJsExtension = candidate => candidate.replace(/\.(mjs|cjs|js|jsx)$/, '');
    // Browser rule, applied BEFORE the generic Node/Kernel/npm exemptions so a
    // `node:` builtin, the frozen Kernel entry, a bare package, or an arbitrary
    // Host/Contracts value import cannot be waived by an early return. The only
    // Host import remains TYPE-ONLY. The existing Markdown adapter alone may
    // consume its bundled browser parser; no other bare-package exemption.
    function checkUiSpecifier(specifier, typeOnly) {
      if (typeof specifier !== 'string') { issues.push(`${rel}: computed import/require is forbidden`); return; }
      if (specifier.startsWith('node:')) { issues.push(`${rel}: the browser UI may not import a Node builtin (${specifier})`); return; }
      if (rel === 'ui/markdown.ts' && specifier === 'marked') return;
      if (!specifier.startsWith('.')) { issues.push(`${rel}: the browser UI may not import a bare package (${specifier})`); return; }
      const target = resolve(dirname(path), specifier);
      if (!inside(sourceRoot, target)) { issues.push(`${rel}: the browser UI import escapes next/src: ${specifier}`); return; }
      if (owner(relative(sourceRoot, target).split(sep).join('/')) === 'UI') return;
      if (uiDtoModules.has(withoutJsExtension(target))) {
        if (!typeOnly) issues.push(`${rel}: the browser UI may only type-only import app/core-http-types`);
        return;
      }
      issues.push(`${rel}: the browser UI may only use local UI modules and the type-only HTTP DTO (${specifier})`);
    }
    function checkSpecifier(specifier, typeOnly = false) {
      if (from === 'UI') { checkUiSpecifier(specifier, typeOnly); return; }
      if (typeof specifier !== 'string') { issues.push(`${rel}: computed import/require is forbidden`); return; }
      if (specifier === 'node:module') { issues.push(`${rel}: node:module is forbidden in product source`); return; }
      if (specifier.startsWith('node:')) return;
      if (!specifier.startsWith('.')) {
        const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!dependencies.has(packageName)) issues.push(`${rel}: undeclared or absolute import ${specifier}`);
        return;
      }
      const target = resolve(dirname(path), specifier);
      // A frozen Kernel public build is the one non-src source dependency.
      // Internal Kernel files and the former repository's vendor tree remain forbidden.
      if (target === publicKernelEntry) return;
      if (!inside(sourceRoot, target)) { issues.push(`${rel}: import escapes next/src: ${specifier}`); return; }
      const to = owner(relative(sourceRoot, target).split(sep).join('/'));
      if (!to) { issues.push(`${rel}: import targets no target module: ${specifier}`); return; }
      // Host and UI are outer layers: the Host may use composition plus the
      // public module ports; the browser UI may only use local views and a
      // TYPE-ONLY view of the Host HTTP DTO. Core modules never depend on them.
      if (to === 'Host' || to === 'UI') {
        if (from === to) return;
        if (from === 'Host' && to === 'UI') { issues.push(`${rel}: Host may not depend on the browser UI`); return; }
        if (from === 'UI' && to === 'Host') {
          if (!typeOnly) issues.push(`${rel}: the browser UI may only type-only import the Host HTTP DTO`);
          return;
        }
        issues.push(`${rel}: ${from} may not depend on the ${to} layer`);
        return;
      }
      if (from === 'Host') {
        if (to === 'Composition' || to === 'Contracts' || MODULE_NAMES.has(to)) return;
        issues.push(`${rel}: Host may only depend on composition, contracts and public module ports (${to})`);
        return;
      }
      if (from === 'Contracts' && to !== 'Contracts') issues.push(`${rel}: shared contracts depend on ${to}`);
      else if (to === 'Composition' && from !== 'Composition') issues.push(`${rel}: ${from} depends on composition`);
      else if (from === 'Composition') return;
      else if (from && from !== to && to !== 'Contracts' && !ALLOWED[from]?.has(to))
        issues.push(`${rel}: forbidden module edge ${from} -> ${to}`);
      else if (from && from !== to && to !== 'Contracts') observedEdges.add(`${from} -> ${to}`);
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const typeOnly = ts.isImportDeclaration(node)
          ? node.importClause?.isTypeOnly === true
          : node.isTypeOnly === true;
        checkSpecifier(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null, typeOnly);
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
        checkSpecifier(ts.isStringLiteral(node.moduleReference.expression) ? node.moduleReference.expression.text : null);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        checkSpecifier(ts.isStringLiteral(node.argument.literal) ? node.argument.literal.text : null, true);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.getText(file) === 'require.resolve'))) {
        const arg = node.arguments[0];
        checkSpecifier(arg && ts.isStringLiteral(arg) ? arg.text : null);
      }
      ts.forEachChild(node, walk);
    }
    walk(file);
  }
  await visit(sourceRoot);
  const modules = [];
  for (const [name, prefix] of MODULES) {
    let directory = false;
    try { directory = (await lstat(resolve(sourceRoot, prefix))).isDirectory(); } catch { /* absent module */ }
    modules.push({ name, directory, sourceFiles: moduleFileCounts.get(name) });
  }
  return { issues, modules, observedEdges: [...observedEdges].sort() };
}

export async function auditSourceTree(projectDir) {
  return (await inspectSourceTree(projectDir)).issues;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { issues, modules, observedEdges } = await inspectSourceTree(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  for (const module of modules) process.stdout.write(`${module.name}: directory=${module.directory}, sourceFiles=${module.sourceFiles}\n`);
  process.stdout.write(`observed module edges: ${observedEdges.length}/8 allowed (${observedEdges.join(', ') || 'none'})\n`);
  if (issues.length) { for (const issue of issues) process.stderr.write(`${issue}\n`); process.exitCode = 1; }
  else process.stdout.write('next source boundaries: OK\n');
}
