import * as ts from 'typescript';
import { posix } from 'node:path';
import { isSafeSourcePath, isSourcePath, ProjectSourceFailure, sha256Text, SOURCE_ROOT, type CapturedProjectFile, type ProjectSourceSnapshot } from './project-source-snapshot.js';

/**
 * WorkspaceTools — frozen TS/JS project analysis.
 *
 * `TypeScriptSourceAnalyzer` owns the TypeScript Language Service and the AST query
 * implementations. It receives one immutable `ProjectSourceSnapshot` and answers
 * `analyze()` synchronously from that material only: no access port, host, disk,
 * registry, pagination or `expectedSnapshot` reaches this component. The public
 * `ProjectSourceIndex` keeps capture/verification/permission semantics and shapes
 * the wire response from these results.
 */

/** Query surface of the frozen analysis; the original tool fields minus pagination and snapshot pinning. */
export type TypeScriptSourceQuery = {
  operation: 'symbols' | 'definitions' | 'references' | 'imports' | 'calls';
  configPath?: string;
  prefix?: string;
  path?: string;
  line?: number;
  column?: number;
};

/** One resolved source position, one-based line and UTF-16 column. */
export type SourceLocation = {
  path: string;
  digest: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  symbolId: string;
};

export type SymbolQueryResult = SourceLocation & { name: string; kind: string };
export type ImportQueryResult = SourceLocation & {
  module: string;
  resolution: 'resolved' | 'unknown';
  targets: SourceLocation[];
};
export type CallQueryResult = SourceLocation & {
  expression: string;
  resolution: 'static_candidate' | 'unknown';
  target: SourceLocation | null;
  uncertainty: string;
};
/** Discriminated by `operation`, so every consumer can name the exact shape it reads. */
export type TypeScriptQueryResult = SourceLocation | SymbolQueryResult | ImportQueryResult | CallQueryResult;

export type SourceFileEntry = { path: string; digest: string };
export type SourceDiagnosticEntry = { path: string; code: number; message: string };

/** Installed-input delta of one analysis, relative to the analyzer's previous installed files. */
export type ProjectSourceChanges = { added: string[]; modified: string[]; deleted: string[]; total: number };

export type TypeScriptSourceCoverage = {
  projectConfiguration: string | null;
  permissionFiltered: true;
  sourceCount: number;
  indexedSourceCount: number;
  externalDependencies: string;
  fullCallGraph: false;
  languages: string[];
  unverifiedLanguages: string[];
  snapshotAtomic: false;
  note: string;
};

export type TypeScriptSourceAnalysis = {
  results: TypeScriptQueryResult[];
  sources: SourceFileEntry[];
  indexedSources: SourceFileEntry[];
  changes: ProjectSourceChanges;
  diagnostics: SourceDiagnosticEntry[];
  diagnosticsTruncated: boolean;
  coverage: TypeScriptSourceCoverage;
};

/**
 * The language service forwards `hasInvalidatedResolutions` to its program host at
 * runtime (`CompilerHost`), but `LanguageServiceHost` does not declare it.
 */
type ResolutionInvalidatingHost = ts.LanguageServiceHost & {
  hasInvalidatedResolutions?(filePath: ts.Path): boolean;
};

/** Incremental language service over frozen captures. Configs are data;
 * no plugins, project scripts, resolvers or package lifecycle hooks are executed. */
export class TypeScriptSourceAnalyzer {
  private service: ts.LanguageService | undefined;
  private options: ts.CompilerOptions = {};
  private rootNames: string[] = [];
  /** Parsed options + root list: only a genuinely changed configuration rebuilds the service. */
  private configKey = '';
  /** Last installed frozen material: the service host and `changes` both read this one baseline. */
  private installed: ReadonlyMap<string, CapturedProjectFile> = new Map();
  /** Advances when installed names/content change so the language service re-synchronizes. */
  private projectVersion = 0;
  /** Set when the last install changed anything: forces resolution invalidation on the next sync. */
  private resolutionsInvalidated = false;

  /** Release TypeScript resources only. The installed baseline survives for `changes` and incremental reuse. */
  dispose() {
    this.releaseService();
    this.options = {};
    this.rootNames = [];
  }

  private releaseService() {
    this.service?.dispose();
    this.service = undefined;
    this.configKey = '';
  }

  /** Analyse one capture synchronously; the same capture can be revisited after a newer one.
   * Optional limits bound collection while walking: an oversized query/diagnostic set is
   * rejected as capacity instead of being accumulated and sliced afterwards. */
  analyze(snapshot: ProjectSourceSnapshot, query: TypeScriptSourceQuery, signal: AbortSignal,
    limits: { maxResults?: number; maxDiagnostics?: number } = {}): TypeScriptSourceAnalysis {
    signal.throwIfAborted();
    const maxResults = limits.maxResults, maxDiagnostics = limits.maxDiagnostics ?? 30;
    const changes = this.install(snapshot.files);
    const configPath = this.configure(query.configPath);
    const service = this.service!;
    const files = this.installed;
    const program = service.getProgram();
    if (!program) throw new ProjectSourceFailure('unsupported', 'no TS/JS project sources');
    // The service has now synchronized with the installed map, so any pending resolution
    // invalidation was consumed by this program.
    this.resolutionsInvalidated = false;
    const checker = program.getTypeChecker();
    const location = (name: string, start: number, length: number): SourceLocation | null => {
      const file = files.get(name), parsed = program.getSourceFile(name);
      if (!file || !parsed) return null;
      const begin = parsed.getLineAndCharacterOfPosition(start), end = parsed.getLineAndCharacterOfPosition(start + length);
      return { path: file.path, digest: file.digest, line: begin.line + 1, column: begin.character + 1, endLine: end.line + 1, endColumn: end.character + 1,
        symbolId: sha256Text(`${file.path}:${file.digest}:${start}:${length}`) };
    };
    const results: TypeScriptQueryResult[] = [];
    let overflow = false;
    const push = (result: TypeScriptQueryResult) => {
      if (maxResults !== undefined && results.length >= maxResults) { overflow = true; return; }
      results.push(result);
    };
    if (query.operation === 'definitions' || query.operation === 'references') {
      const name = SOURCE_ROOT + query.path, file = program.getSourceFile(name), content = files.get(name)?.content;
      if (!file || content === undefined || !Number.isSafeInteger(query.line) || !Number.isSafeInteger(query.column) || query.line! < 1 || query.column! < 1) throw new ProjectSourceFailure('rejected', 'indexed path and one-based UTF-16 coordinates required');
      const lines = content.split('\n');
      if (query.line! > lines.length || query.column! > lines[query.line! - 1]!.replace(/\r$/, '').length + 1) throw new ProjectSourceFailure('rejected', 'position outside source');
      const position = file.getPositionOfLineAndCharacter(query.line! - 1, query.column! - 1);
      const found = query.operation === 'definitions' ? service.getDefinitionAtPosition(name, position) : service.getReferencesAtPosition(name, position);
      for (const entry of found ?? []) { if (overflow) break; const loc = location(entry.fileName, entry.textSpan.start, entry.textSpan.length); if (loc) push(loc); }
    } else {
      // Prefix scopes the analysed program files; readable dependencies outside it still resolve.
      const scoped = program.getSourceFiles().filter(file => files.has(file.fileName) && (!query.path || file.fileName === SOURCE_ROOT + query.path) && (!query.prefix || files.get(file.fileName)!.path.startsWith(query.prefix + '/') || files.get(file.fileName)!.path === query.prefix));
      for (const file of scoped) {
        if (overflow) break;
        signal.throwIfAborted();
        if (query.operation === 'symbols') {
          const visit = (item: ts.NavigationTree) => { if (overflow) return; const span = item.nameSpan ?? item.spans[0];
            if (span) { const located = location(file.fileName, span.start, span.length); if (located) push({ name: item.text, kind: item.kind, ...located }); }
            item.childItems?.forEach(visit); };
          service.getNavigationTree(file.fileName).childItems?.forEach(visit);
        } else {
          const visit = (node: ts.Node) => {
            if (overflow) return;
            if (query.operation === 'imports' && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
              const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
              const targets = (symbol?.declarations ?? []).flatMap(declaration => { const loc = location(declaration.getSourceFile().fileName, declaration.getStart(), declaration.getWidth()); return loc ? [loc] : []; });
              const located = location(file.fileName, node.getStart(), node.getWidth());
              if (located) push({ module: node.moduleSpecifier.text, ...located, resolution: targets.length ? 'resolved' : 'unknown', targets });
            }
            if (query.operation === 'calls' && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
              const declaration = checker.getResolvedSignature(node)?.declaration;
              const target = declaration ? location(declaration.getSourceFile().fileName, declaration.getStart(), declaration.getWidth()) : null;
              const located = location(file.fileName, node.getStart(), node.getWidth());
              if (located) push({ expression: node.expression.getText().slice(0, 200), ...located, resolution: target ? 'static_candidate' : 'unknown', target,
                uncertainty: 'Static signature candidates do not prove runtime dispatch.' });
            }
            if (!overflow) ts.forEachChild(node, visit);
          }; ts.forEachChild(file, visit);
        }
      }
    }
    if (overflow) throw new ProjectSourceFailure('capacity', 'query result capacity exceeded; narrow the query scope');
    // Diagnostics are collected up to the bound; the truncation flag is exact, not guessed.
    const diagnostics: SourceDiagnosticEntry[] = [];
    let diagnosticsTruncated = false;
    for (const file of program.getSourceFiles()) {
      if (!files.has(file.fileName)) continue;
      const entries = [...service.getSyntacticDiagnostics(file.fileName), ...service.getSemanticDiagnostics(file.fileName).filter(diagnostic => [2307, 2792, 2688].includes(diagnostic.code))];
      for (const diagnostic of entries) {
        if (diagnostics.length >= maxDiagnostics) { diagnosticsTruncated = true; break; }
        diagnostics.push({ path: files.get(file.fileName)!.path, code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') });
      }
      if (diagnosticsTruncated) break;
    }
    const sources = [...files.values()].map(file => ({ path: file.path, digest: file.digest }));
    const names = new Set(program.getSourceFiles().map(file => file.fileName));
    const indexedSources = [...files.entries()].filter(([name]) => names.has(name)).map(([, file]) => ({ path: file.path, digest: file.digest }));
    return {
      results,
      sources,
      indexedSources,
      changes,
      diagnostics,
      diagnosticsTruncated,
      coverage: { projectConfiguration: configPath, permissionFiltered: true, sourceCount: sources.length, indexedSourceCount: indexedSources.length,
        externalDependencies: 'only readable files inside workspace; inaccessible imports remain unknown', fullCallGraph: false,
        languages: ['typescript', 'javascript'], unverifiedLanguages: ['python', 'cpp'], snapshotAtomic: false,
        note: 'Inventory and every content digest are rechecked; no atomic filesystem snapshot. Config plugins never execute. Renames appear as delete plus add.' },
    };
  }

  /**
   * Install one frozen capture as the current baseline: `changes` is relative to the
   * previous baseline, and the language service host reads the new map from now on.
   */
  private install(files: ReadonlyMap<string, CapturedProjectFile>): ProjectSourceChanges {
    const added: string[] = [], modified: string[] = [], deleted: string[] = [];
    for (const [name, file] of files) { const previous = this.installed.get(name); if (!previous) added.push(file.path); else if (previous.digest !== file.digest) modified.push(file.path); }
    for (const [name, file] of this.installed) if (!files.has(name)) deleted.push(file.path);
    this.installed = files;
    if (added.length || modified.length || deleted.length) this.projectVersion++;
    // Any installed change can change module resolution (a dependency appeared, disappeared or
    // re-pointed through a changed package entry); TypeScript's public hook re-resolves the
    // program's imports without rebuilding the language service. An invalidation stays pending
    // until a program actually synchronizes: a rejected configuration (or a delta-free repeat)
    // must not drop it.
    if (added.length || modified.length || deleted.length) this.resolutionsInvalidated = true;
    return { added: added.slice(0, 200), modified: modified.slice(0, 200), deleted: deleted.slice(0, 200), total: added.length + modified.length + deleted.length };
  }

  /** Resolve default/explicit config against the installed capture; rebuild only on a real config/root change. */
  private configure(configPath?: string): string | null {
    const path = configPath ?? (this.installed.has(SOURCE_ROOT + 'tsconfig.json') ? 'tsconfig.json' : this.installed.has(SOURCE_ROOT + 'jsconfig.json') ? 'jsconfig.json' : undefined);
    const readFile = (name: string) => this.installed.get(posix.normalize(name))?.content;
    const matches = (name: string, base: string, pattern: string) => {
      const full = posix.resolve(base, pattern);
      return posix.matchesGlob(name, full) || (!/[?*]/.test(pattern) && name.startsWith(full.replace(/\/$/, '') + '/'));
    };
    const readDirectory: ts.ParseConfigHost['readDirectory'] = (base, extensions, excludes, includes, depth) => [...this.installed.keys()].filter(name =>
      name.startsWith(base.replace(/\/$/, '') + '/') && (!extensions || extensions.some(extension => name.endsWith(extension))) &&
      (!depth || posix.relative(base, name).split('/').length <= depth + 1) &&
      (includes ?? ['**/*']).some(pattern => matches(name, base, pattern)) && !(excludes ?? []).some(pattern => matches(name, base, pattern)));
    let errors: readonly ts.Diagnostic[] = [];
    let options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, allowJs: true, checkJs: true, noLib: true, types: [] };
    let roots = [...this.installed.keys()].filter(name => isSourcePath(name) && !name.includes('/node_modules/') && !name.includes('/dist/') && !name.includes('/build/'));
    if (path) {
      if (!isSafeSourcePath(path)) throw new ProjectSourceFailure('rejected', 'config outside readable scope');
      const text = readFile(SOURCE_ROOT + path);
      if (text === undefined) throw new ProjectSourceFailure('rejected', 'config unavailable');
      const config = ts.parseConfigFileTextToJson(SOURCE_ROOT + path, text);
      if (config.error) errors = [config.error];
      else {
        const parsed = ts.parseJsonConfigFileContent(config.config, { useCaseSensitiveFileNames: true, readFile, fileExists: name => this.installed.has(posix.normalize(name)), readDirectory }, posix.dirname(SOURCE_ROOT + path), undefined, SOURCE_ROOT + path);
        options = { ...parsed.options, noEmit: true, plugins: [] };
        roots = parsed.fileNames.filter(name => this.installed.has(name));
        errors = parsed.errors;
        if (parsed.projectReferences?.length) throw new ProjectSourceFailure('unsupported', 'solution project references require querying each referenced config explicitly');
      }
    }
    if (errors.length) throw new ProjectSourceFailure('rejected', 'invalid or inaccessible project configuration: ' + errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, ' ')).join('; '));
    const key = JSON.stringify({ options, roots });
    this.options = options; this.rootNames = roots;
    if (!this.service || key !== this.configKey) {
      this.releaseService();
      // One service serves successive frozen captures: every host read resolves against the
      // currently installed map, while project/script versions push incremental re-analysis.
      const host: ResolutionInvalidatingHost = {
        getCompilationSettings: () => this.options, getCurrentDirectory: () => SOURCE_ROOT,
        getDefaultLibFileName: () => SOURCE_ROOT + 'node_modules/typescript/lib/lib.d.ts',
        getScriptFileNames: () => this.rootNames, getScriptVersion: name => this.installed.get(name)?.digest ?? '',
        getScriptSnapshot: name => { const file = this.installed.get(name); return file ? ts.ScriptSnapshot.fromString(file.content) : undefined; },
        getProjectVersion: () => String(this.projectVersion), useCaseSensitiveFileNames: () => true,
        hasInvalidatedResolutions: () => this.resolutionsInvalidated,
        fileExists: name => this.installed.has(posix.normalize(name)), readFile,
        directoryExists: name => [...this.installed.keys()].some(candidate => candidate.startsWith(name.replace(/\/$/, '') + '/')),
        readDirectory: (path, extensions, excludes, includes, depth) => [...readDirectory(path, extensions ?? [], excludes, includes ?? ['**/*'], depth)],
      };
      this.service = ts.createLanguageService(host);
      this.configKey = key;
    }
    return path ?? null;
  }
}
