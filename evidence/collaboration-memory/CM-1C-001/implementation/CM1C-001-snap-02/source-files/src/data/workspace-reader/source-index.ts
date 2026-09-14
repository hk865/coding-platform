import * as ts from 'typescript';
import { createHash } from 'node:crypto';

/** A bounded, read-only working-tree index. No project configuration or code executes. */
export type SourceAccess = {
  read(path: string, maxBytes: number): Promise<{ content: string }>;
  allowed(path: string): boolean;
};
export type SourceQuery = {
  paths: string[];
  operation: 'symbols' | 'definitions' | 'references';
  path?: string;
  /** One-based UTF-16 source coordinates, as used by TypeScript. */
  line?: number;
  column?: number;
  expectedSnapshot?: string;
  limit?: number;
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const validPath = (p: string) => typeof p === 'string' && p.length > 0 && p.length <= 1024 && !/[\\:\0]/.test(p) && !p.split('/').some(v => !v || v === '..' || v === '.');
const supported = (p: string) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(p);
const root = '/source/';
const FILE_BYTES = 256 * 1024;
type File = { path: string; content: string; digest: string };
class ReadFailure extends Error {
  constructor(readonly status: 'rejected' | 'unsupported' | 'stale', message: string) { super(message); }
}

export class SourceIndex {
  constructor(private readonly access: SourceAccess) {}

  private async file(path: string): Promise<File> {
    if (!validPath(path) || !this.access.allowed(path)) throw new ReadFailure('rejected', 'path outside readable scope');
    let content: string;
    try { content = (await this.access.read(path, FILE_BYTES)).content; }
    catch { throw new ReadFailure('rejected', 'source unavailable, denied or exceeds per-file capacity'); }
    if (Buffer.byteLength(content) > FILE_BYTES || content.includes('\0')) throw new ReadFailure('rejected', 'source is too large or binary');
    return { path, content, digest: hash(content) };
  }

  private async capture(paths: string[], signal: AbortSignal): Promise<File[]> {
    const files: File[] = []; let bytes = 0;
    for (const path of paths) {
      signal.throwIfAborted();
      const file = await this.file(path); bytes += Buffer.byteLength(file.content);
      if (bytes > 4 * 1024 * 1024) throw new ReadFailure('rejected', 'selected source exceeds 4 MiB; narrow the scope');
      files.push(file);
    }
    return files;
  }

  async query(query: SourceQuery, signal: AbortSignal = new AbortController().signal) {
    let service: ts.LanguageService | undefined;
    try {
      if (!Array.isArray(query.paths) || query.paths.length < 1 || query.paths.length > 64 ||
          !['symbols', 'definitions', 'references'].includes(query.operation) ||
          (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200))) {
        throw new ReadFailure('rejected', 'invalid query or result capacity');
      }
      const paths = [...new Set(query.paths)].sort();
      if (paths.some(p => !validPath(p) || !this.access.allowed(p))) throw new ReadFailure('rejected', 'path outside readable scope');
      if (paths.some(p => !supported(p))) throw new ReadFailure('unsupported', 'semantic index supports TS/JS only; use syntax analysis for Python');
      const files = await this.capture(paths, signal);
      const sources = files.map(({ path, digest }) => ({ path, digest }));
      const snapshot = hash(JSON.stringify({ engine: ts.version, sources }));
      if (query.expectedSnapshot !== undefined && query.expectedSnapshot !== snapshot) return { status: 'stale' as const, snapshot, message: 'selected working-tree sources changed' };
      const memory = new Map(files.map(f => [root + f.path, f]));
      const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, checkJs: true, noLib: true,
        types: [], jsx: ts.JsxEmit.Preserve, allowImportingTsExtensions: true };
      const host: ts.LanguageServiceHost = {
        getCompilationSettings: () => options, getCurrentDirectory: () => root,
        getDefaultLibFileName: () => root + 'unavailable-lib.d.ts',
        getScriptFileNames: () => [...memory.keys()], getScriptVersion: name => memory.get(name)?.digest ?? '',
        getScriptSnapshot: name => { const f = memory.get(name); return f ? ts.ScriptSnapshot.fromString(f.content) : undefined; },
        fileExists: name => memory.has(name), readFile: name => memory.get(name)?.content,
        directoryExists: name => [...memory.keys()].some(p => p.startsWith(name.replace(/\/$/, '') + '/')),
        readDirectory: () => [], useCaseSensitiveFileNames: () => true,
        getCancellationToken: () => ({ isCancellationRequested: () => signal.aborted, throwIfCancellationRequested: () => signal.throwIfAborted() }),
      };
      service = ts.createLanguageService(host);
      const program = service.getProgram()!;
      const locate = (name: string, span: ts.TextSpan) => {
        const file = memory.get(name), parsed = program.getSourceFile(name);
        if (!file || !parsed) return null;
        const start = parsed.getLineAndCharacterOfPosition(span.start), end = parsed.getLineAndCharacterOfPosition(span.start + span.length);
        return { path: file.path, digest: file.digest, line: start.line + 1, column: start.character + 1,
          endLine: end.line + 1, endColumn: end.character + 1 };
      };
      const results: Array<Record<string, unknown>> = [];
      if (query.operation === 'symbols') {
        for (const file of files) {
          const visit = (item: ts.NavigationTree) => {
            const span = item.nameSpan ?? item.spans[0];
            if (span) results.push({ name: item.text, kind: item.kind, ...locate(root + file.path, span) });
            item.childItems?.forEach(visit);
          };
          service.getNavigationTree(root + file.path).childItems?.forEach(visit);
        }
      } else {
        if (!query.path || !paths.includes(query.path) || !Number.isSafeInteger(query.line) || !Number.isSafeInteger(query.column) || query.line! < 1 || query.column! < 1) {
          throw new ReadFailure('rejected', 'a selected path and one-based line/column are required');
        }
        const name = root + query.path, parsed = program.getSourceFile(name)!;
        const lines = memory.get(name)!.content.split('\n');
        if (query.line! > lines.length || query.column! > lines[query.line! - 1]!.replace(/\r$/, '').length + 1) throw new ReadFailure('rejected', 'position outside source');
        const position = parsed.getPositionOfLineAndCharacter(query.line! - 1, query.column! - 1);
        const entries = query.operation === 'definitions' ? service.getDefinitionAtPosition(name, position) : service.getReferencesAtPosition(name, position);
        for (const entry of entries ?? []) {
          const location = locate(entry.fileName, entry.textSpan);
          if (location) results.push({ ...location, ...('isWriteAccess' in entry ? { isWriteAccess: entry.isWriteAccess } : {}) });
        }
      }
      // Missing standard libraries are intentional here, so ordinary type
      // diagnostics would misrepresent partial context as project errors.
      const diagnostics = files.flatMap(f => [...service!.getSyntacticDiagnostics(root + f.path),
        ...service!.getSemanticDiagnostics(root + f.path).filter(d => d.code === 2307 || d.code === 2792)]
        .map(d => ({ path: f.path, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') })));
      const verified = await this.capture(paths, signal);
      if (verified.some((f, i) => f.digest !== files[i]!.digest)) return { status: 'stale' as const, message: 'sources changed during indexing; repeat query' };
      const limit = query.limit ?? 100;
      return { status: 'sourced' as const, snapshot, sources, results: results.slice(0, limit),
        truncated: results.length > limit, diagnostics: diagnostics.slice(0, 30), diagnosticsTruncated: diagnostics.length > 30,
        provenance: { source: 'working_tree', engine: 'typescript-language-service', engineVersion: ts.version },
        coverage: { paths, semanticResolution: 'selected TS/JS sources only', fullCallGraph: false,
          projectConfiguration: false, externalDependencies: false, partial: true, diagnosticsScope: 'syntax and unresolved modules; not a typecheck',
          note: 'No tsconfig, package metadata, external libraries or project plugins loaded. Unselected imports and dynamic behavior may be unresolved.' } };
    } catch (error) {
      if (signal.aborted) return { status: 'cancelled' as const };
      if (error instanceof ReadFailure) return { status: error.status, message: error.message };
      throw error;
    } finally { service?.dispose(); }
  }

  async excerpt(path: string, expectedDigest: string, startLine: number, endLine: number) {
    try {
      if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine >= 200) throw new ReadFailure('rejected', 'invalid digest or line range');
      const file = await this.file(path);
      if (file.digest !== expectedDigest) return { status: 'stale' as const, message: 'source changed since the cited index', digest: file.digest };
      const lines = file.content.split('\n');
      if (endLine > lines.length) throw new ReadFailure('rejected', 'line range outside source');
      const content = lines.slice(startLine - 1, endLine).join('\n');
      if (Buffer.byteLength(content) > 32 * 1024) throw new ReadFailure('rejected', 'excerpt exceeds 32 KiB; narrow the range');
      if ((await this.file(path)).digest !== file.digest) return { status: 'stale' as const, message: 'source changed during read' };
      return { status: 'sourced' as const, path, digest: file.digest, startLine, endLine, content, source: 'working_tree' };
    } catch (error) {
      if (error instanceof ReadFailure) return { status: error.status, message: error.message };
      throw error;
    }
  }
}
