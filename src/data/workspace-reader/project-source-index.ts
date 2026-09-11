import * as ts from 'typescript';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { SourceAccess } from './source-index.js';

export type ProjectSourceAccess = SourceAccess & {
  inventory(signal: AbortSignal): Promise<{ paths: string[]; truncated: boolean }>;
  /** Trusted host supplies only HEAD identity, never history or repository code execution. */
  sourceIdentity(): Promise<{ workspace: string; commit: string | null }>;
};
export type ProjectSourceQuery = {
  operation: 'symbols' | 'definitions' | 'references' | 'imports' | 'calls';
  configPath?: string;
  prefix?: string;
  path?: string;
  line?: number;
  column?: number;
  expectedSnapshot?: string;
  offset?: number;
  limit?: number;
};
type SourceFile = { path: string; content: string; digest: string };
const ROOT = '/workspace/';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sourcePath = (p: string) => /\.(?:[cm]?[jt]sx?)$/.test(p);
const ignored = (p: string) => p.split('/').some(s => ['.git', '.platform-runtime', '.evaluator', '.oracle', 'hidden-tests', '.pnpm', '.cache', '__pycache__'].includes(s));
const safe = (p: string) => !!p && !/[\\:\0]/.test(p) && !p.split('/').some(s => !s || s === '.' || s === '..');
const relevant = (p: string) => sourcePath(p) || p.endsWith('.json');
class IndexFailure extends Error { constructor(readonly status: 'rejected' | 'unsupported' | 'stale', message: string) { super(message); } }

/** Incremental language service over permission-checked snapshots. Configs are data;
 * no plugins, project scripts, resolvers or package lifecycle hooks are executed. */
export class ProjectSourceIndex {
  private files = new Map<string, SourceFile>();
  private service: ts.LanguageService | undefined;
  private options: ts.CompilerOptions = {};
  private rootNames: string[] = [];
  private generation = 0;
  private configKey = '';
  constructor(private readonly access: ProjectSourceAccess) {}

  dispose() { this.service?.dispose(); this.service = undefined; }

  /** Full permission-filtered material for the graph consumer; never the display manifest's first page. */
  async architectureMaterials(configPath?: string, signal: AbortSignal = new AbortController().signal) {
    const imports: Array<Record<string, unknown>> = []; let offset = 0; let snapshot: string | undefined;
    for (;;) {
      const result = await this.query({operation:'imports', ...(configPath ? {configPath} : {}), ...(snapshot ? {expectedSnapshot:snapshot} : {}), offset, limit:200}, signal);
      if (result.status !== 'sourced') throw Error('architecture source unavailable: ' + JSON.stringify(result));
      snapshot = result.snapshot; imports.push(...result.results);
      if (imports.length > 10000) throw Error('architecture import capacity exceeded; narrow project configuration');
      if (result.nextOffset === null) {
        const names = new Set(this.service!.getProgram()!.getSourceFiles().map(f => f.fileName));
        return {snapshot, provenance:result.provenance, imports, configPath:result.coverage.projectConfiguration,
          sources:[...this.files.entries()].filter(([name]) => names.has(name)).map(([,f]) => ({path:f.path,digest:f.digest}))};
      }
      offset = result.nextOffset;
    }
  }

  private async capture(signal: AbortSignal) {
    const identity = await this.access.sourceIdentity();
    const inventory = await this.access.inventory(signal);
    if (inventory.truncated) throw new IndexFailure('rejected', 'project inventory incomplete; choose a narrower workspace');
    const paths = [...new Set(inventory.paths)].filter(p => safe(p) && !ignored(p) && this.access.allowed(p) && relevant(p)).sort();
    const files = new Map<string, SourceFile>();
    let bytes = 0;
    for (const path of paths) {
      signal.throwIfAborted();
      let content: string;
      try { content = (await this.access.read(path, 2 * 1024 * 1024)).content; }
      catch { throw new IndexFailure('rejected', 'source unavailable, denied or exceeds file capacity: ' + path); }
      bytes += Buffer.byteLength(content);
      if (bytes > 128 * 1024 * 1024) throw new IndexFailure('rejected', 'project snapshot exceeds 128 MiB capacity; narrow workspace scope');
      if (content.includes('\0')) throw new IndexFailure('rejected', 'binary source: ' + path);
      files.set(ROOT + path, { path, content, digest: hash(content) });
    }
    const snapshot = hash(JSON.stringify({ engine: ts.version, identity, sources: [...files.values()].map(f => [f.path, f.digest]) }));
    return { files, identity, snapshot };
  }

  private configure(configPath?: string) {
    const path = configPath ?? (this.files.has(ROOT + 'tsconfig.json') ? 'tsconfig.json' : this.files.has(ROOT + 'jsconfig.json') ? 'jsconfig.json' : undefined);
    const readFile = (name: string) => this.files.get(posix.normalize(name))?.content;
    const matches = (name: string, base: string, pattern: string) => {
      const full = posix.resolve(base, pattern);
      return posix.matchesGlob(name, full) || (!/[?*]/.test(pattern) && name.startsWith(full.replace(/\/$/, '') + '/'));
    };
    const readDirectory: ts.ParseConfigHost['readDirectory'] = (base, extensions, excludes, includes, depth) => [...this.files.keys()].filter(name =>
      name.startsWith(base.replace(/\/$/, '') + '/') && (!extensions || extensions.some(e => name.endsWith(e))) &&
      (!depth || posix.relative(base, name).split('/').length <= depth + 1) &&
      (includes ?? ['**/*']).some(pattern => matches(name, base, pattern)) && !(excludes ?? []).some(pattern => matches(name, base, pattern)));
    let errors: readonly ts.Diagnostic[] = [];
    let options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, allowJs: true, checkJs: true, noLib: true, types: [] };
    let roots = [...this.files.keys()].filter(name => sourcePath(name) && !name.includes('/node_modules/') && !name.includes('/dist/') && !name.includes('/build/'));
    if (path) {
      if (!safe(path) || !this.access.allowed(path)) throw new IndexFailure('rejected', 'config outside readable scope');
      const text = readFile(ROOT + path);
      if (text === undefined) throw new IndexFailure('rejected', 'config unavailable');
      const config = ts.parseConfigFileTextToJson(ROOT + path, text);
      if (config.error) errors = [config.error];
      else {
        const parsed = ts.parseJsonConfigFileContent(config.config, { useCaseSensitiveFileNames: true, readFile, fileExists: name => this.files.has(posix.normalize(name)), readDirectory }, posix.dirname(ROOT + path), undefined, ROOT + path);
        options = { ...parsed.options, noEmit: true, plugins: [] };
        roots = parsed.fileNames.filter(name => this.files.has(name));
        errors = parsed.errors;
        if (parsed.projectReferences?.length) throw new IndexFailure('unsupported', 'solution project references require querying each referenced config explicitly');
      }
    }
    if (errors.length) throw new IndexFailure('rejected', 'invalid or inaccessible project configuration: ' + errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('; '));
    // The language service receives only files the sandbox has authorized.
    const key = JSON.stringify({ options, roots });
    if (key !== this.configKey) { this.dispose(); this.configKey = key; }
    this.options = options; this.rootNames = roots;
    if (!this.service) this.service = ts.createLanguageService({
      getCompilationSettings: () => this.options, getCurrentDirectory: () => ROOT,
      getDefaultLibFileName: () => ROOT + 'node_modules/typescript/lib/lib.d.ts',
      getScriptFileNames: () => this.rootNames, getScriptVersion: name => this.files.get(name)?.digest ?? '',
      getScriptSnapshot: name => { const f = this.files.get(name); return f ? ts.ScriptSnapshot.fromString(f.content) : undefined; },
      getProjectVersion: () => String(this.generation), useCaseSensitiveFileNames: () => true,
      fileExists: name => this.files.has(posix.normalize(name)), readFile,
      directoryExists: name => [...this.files.keys()].some(p => p.startsWith(name.replace(/\/$/, '') + '/')),
      readDirectory: (path, extensions, excludes, includes, depth) => [...readDirectory(path, extensions ?? [], excludes, includes ?? ['**/*'], depth)],
    });
    return path ?? null;
  }

  async query(query: ProjectSourceQuery, signal: AbortSignal = new AbortController().signal) {
    try {
      if (!['symbols', 'definitions', 'references', 'imports', 'calls'].includes(query.operation) ||
          (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200)) ||
          (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))) throw new IndexFailure('rejected', 'invalid operation or pagination');
      for (const p of [query.path, query.prefix, query.configPath]) if (p !== undefined && (!safe(p) || !this.access.allowed(p) || ignored(p))) throw new IndexFailure('rejected', 'path outside readable scope');
      if (query.path && !sourcePath(query.path)) throw new IndexFailure('unsupported', 'this project service supports TS/JS; other languages require their declared provider');
      const captured = await this.capture(signal);
      // Config selection and query scope are part of the index identity.
      const snapshot = hash(JSON.stringify({ sources: captured.snapshot, config: query.configPath ?? null, prefix: query.prefix ?? null }));
      if (query.expectedSnapshot && query.expectedSnapshot !== snapshot) return { status: 'stale' as const, snapshot, message: 'project contents, inventory, configuration, scope or commit changed' };
      const added: string[] = [], modified: string[] = [], deleted: string[] = [];
      for (const [name, file] of captured.files) { if (!this.files.has(name)) added.push(file.path); else if (this.files.get(name)!.digest !== file.digest) modified.push(file.path); }
      for (const [name, file] of this.files) if (!captured.files.has(name)) deleted.push(file.path);
      if (added.length || modified.length || deleted.length) this.generation++;
      this.files = captured.files;
      const configPath = this.configure(query.configPath);
      const service = this.service!, program = service.getProgram();
      if (!program) throw new IndexFailure('unsupported', 'no TS/JS project sources');
      const checker = program.getTypeChecker();
      const location = (name: string, start: number, length: number) => {
        const file = this.files.get(name), parsed = program.getSourceFile(name);
        if (!file || !parsed) return null;
        const begin = parsed.getLineAndCharacterOfPosition(start), end = parsed.getLineAndCharacterOfPosition(start + length);
        return { path: file.path, digest: file.digest, line: begin.line + 1, column: begin.character + 1, endLine: end.line + 1, endColumn: end.character + 1,
          symbolId: hash(`${file.path}:${file.digest}:${start}:${length}`) };
      };
      const results: Array<Record<string, unknown>> = [];
      if (query.operation === 'definitions' || query.operation === 'references') {
        const name = ROOT + query.path, file = program.getSourceFile(name), content = this.files.get(name)?.content;
        if (!file || content === undefined || !Number.isSafeInteger(query.line) || !Number.isSafeInteger(query.column) || query.line! < 1 || query.column! < 1) throw new IndexFailure('rejected', 'indexed path and one-based UTF-16 coordinates required');
        const lines = content.split('\n');
        if (query.line! > lines.length || query.column! > lines[query.line! - 1]!.replace(/\r$/, '').length + 1) throw new IndexFailure('rejected', 'position outside source');
        const position = file.getPositionOfLineAndCharacter(query.line! - 1, query.column! - 1);
        const found = query.operation === 'definitions' ? service.getDefinitionAtPosition(name, position) : service.getReferencesAtPosition(name, position);
        for (const entry of found ?? []) { const loc = location(entry.fileName, entry.textSpan.start, entry.textSpan.length); if (loc) results.push(loc); }
      } else {
        const files = program.getSourceFiles().filter(file => this.files.has(file.fileName) && (!query.path || file.fileName === ROOT + query.path) && (!query.prefix || this.files.get(file.fileName)!.path.startsWith(query.prefix + '/') || this.files.get(file.fileName)!.path === query.prefix));
        for (const file of files) {
          signal.throwIfAborted();
          if (query.operation === 'symbols') {
            const visit = (item: ts.NavigationTree) => { const span = item.nameSpan ?? item.spans[0]; if (span) results.push({ name: item.text, kind: item.kind, ...location(file.fileName, span.start, span.length) }); item.childItems?.forEach(visit); };
            service.getNavigationTree(file.fileName).childItems?.forEach(visit);
          } else {
            const visit = (node: ts.Node) => {
              if (query.operation === 'imports' && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
                const targets = (symbol?.declarations ?? []).flatMap(d => { const loc = location(d.getSourceFile().fileName, d.getStart(), d.getWidth()); return loc ? [loc] : []; });
                results.push({ module: node.moduleSpecifier.text, ...location(file.fileName, node.getStart(), node.getWidth()), resolution: targets.length ? 'resolved' : 'unknown', targets });
              }
              if (query.operation === 'calls' && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
                const declaration = checker.getResolvedSignature(node)?.declaration;
                const target = declaration ? location(declaration.getSourceFile().fileName, declaration.getStart(), declaration.getWidth()) : null;
                results.push({ expression: node.expression.getText().slice(0, 200), ...location(file.fileName, node.getStart(), node.getWidth()), resolution: target ? 'static_candidate' : 'unknown', target,
                  uncertainty: 'Static signature candidates do not prove runtime dispatch.' });
              }
              ts.forEachChild(node, visit);
            }; ts.forEachChild(file, visit);
          }
        }
      }
      const diagnostics = program.getSourceFiles().filter(f => this.files.has(f.fileName)).flatMap(f => [...service.getSyntacticDiagnostics(f.fileName), ...service.getSemanticDiagnostics(f.fileName).filter(d => [2307, 2792, 2688].includes(d.code))].map(d => ({ path: this.files.get(f.fileName)!.path, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') })));
      const verified = await this.capture(signal);
      if (verified.snapshot !== captured.snapshot) return { status: 'stale' as const, message: 'project changed during query; repeat against current snapshot' };
      const offset = query.offset ?? 0, limit = query.limit ?? 100;
      const sources = [...this.files.values()].map(({ path, digest }) => ({ path, digest }));
      return { status: 'sourced' as const, snapshot, provenance: { ...captured.identity, source: 'working_tree', engine: 'typescript-language-service', engineVersion: ts.version, manifestDigest: captured.snapshot },
        results: results.slice(offset, offset + limit), nextOffset: offset + limit < results.length ? offset + limit : null, totalResults: results.length,
        sources: sources.slice(0, 200), sourceCount: sources.length, sourcesTruncated: sources.length > 200,
        changes: { added: added.slice(0, 200), modified: modified.slice(0, 200), deleted: deleted.slice(0, 200), total: added.length + modified.length + deleted.length },
        diagnostics: diagnostics.slice(0, 30), diagnosticsTruncated: diagnostics.length > 30,
        coverage: { projectConfiguration: configPath, permissionFiltered: true, sourceCount: sources.length, indexedSourceCount: program.getSourceFiles().filter(f => this.files.has(f.fileName)).length,
          externalDependencies: 'only readable files inside workspace; inaccessible imports remain unknown', fullCallGraph: false,
          languages: ['typescript', 'javascript'], unverifiedLanguages: ['python', 'cpp'], snapshotAtomic: false,
          note: 'Inventory and every content digest are rechecked; no atomic filesystem snapshot. Config plugins never execute. Renames appear as delete plus add.' } };
    } catch (error) {
      if (signal.aborted) return { status: 'cancelled' as const };
      if (error instanceof IndexFailure) return { status: error.status, message: error.message };
      throw error;
    }
  }
}
