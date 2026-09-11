import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ProjectSourceAccess, ProjectSourceQuery } from './project-source-index.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const safe = (p: string) => !!p && !/[\\:\0]/.test(p) && !p.split('/').some(s => !s || s === '.' || s === '..');
const source = (p: string) => /\.(?:c|cc|cpp|cxx|C|h|hh|hpp|hxx|inc|ipp|inl|tcc|def)$/.test(p) || !p.split('/').at(-1)!.includes('.');
const ignored = (p: string) => p.split('/').some(s => ['.git', '.evaluator', '.oracle', 'hidden-tests', '.platform-runtime', '.venv', '__pycache__', 'node_modules'].includes(s));
type File = { path: string; content: string; digest: string };
type AnalyzerResult = { status: 'sourced'; engine: 'libclang'; engineVersion: string; engineDigest: string; adapterDigest: string; results: Array<Record<string, unknown>>; diagnostics: Array<Record<string, unknown>>; coverage: Record<string, unknown> } | { status: 'unsupported' | 'rejected'; message: string };

/** Permission-filtered project snapshots parsed by libclang, never by a project's
 * compiler executable. The fixed helper permits only mapped source paths through
 * a redirect-only VFS, disables plugins/modules, and rejects unknown options. */
export class CppSourceIndex {
  private previous = new Map<string, string>();
  constructor(private readonly access: ProjectSourceAccess, private readonly options: { libraryPath?: string; pythonPath?: string } = {}) {}

  private async capture(signal: AbortSignal) {
    const identity = await this.access.sourceIdentity(), inventory = await this.access.inventory(signal);
    if (inventory.truncated) throw Error('C/C++ project inventory incomplete; narrow workspace');
    const files: File[] = [], excludedFiles: Array<{ path: string; reason: string }> = []; let bytes = 0;
    for (const path of [...new Set(inventory.paths)].sort()) {
      if (!safe(path) || ignored(path) || !this.access.allowed(path) || (!source(path) && !path.endsWith('compile_commands.json'))) continue;
      signal.throwIfAborted();
      let content: string;
      try {
        content = (await this.access.read(path, 2 * 1024 * 1024)).content;
        if (content.includes('\0') || Buffer.byteLength(content) > 2 * 1024 * 1024) throw Error('binary or oversized source');
      } catch {
        // Extensionless files can be headers or compiled binaries. Record the
        // gap instead of mistaking every build executable for required source.
        if (!path.split('/').at(-1)!.includes('.')) { excludedFiles.push({ path, reason: 'Extensionless input unreadable, binary or exceeds 2 MiB; any include of it remains unresolved' }); continue; }
        throw Error('C/C++ snapshot source unavailable, binary or exceeds 2 MiB: ' + path);
      }
      bytes += Buffer.byteLength(content);
      if (bytes > 64 * 1024 * 1024) throw Error('C/C++ snapshot exceeds 64 MiB; narrow workspace');
      files.push({ path, content, digest: hash(content) });
    }
    return { identity, files, excludedFiles, snapshot: hash(JSON.stringify({ identity, files: files.map(f => [f.path, f.digest]), excludedFiles })) };
  }

  async query(query: ProjectSourceQuery, signal: AbortSignal = new AbortController().signal) {
    try {
      if (!['symbols', 'definitions', 'references', 'imports', 'calls'].includes(query.operation)) throw Error('invalid C/C++ operation');
      for (const p of [query.path, query.prefix, query.configPath]) if (p !== undefined && (!safe(p) || ignored(p) || !this.access.allowed(p))) throw Error('path outside readable scope');
      const offset = query.offset ?? 0, limit = query.limit ?? 100;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Error('invalid pagination');
      const captured = await this.capture(signal);
      const configs = captured.files.filter(f => f.path.endsWith('compile_commands.json'));
      const configPath = query.configPath ?? (configs.some(f => f.path === 'compile_commands.json') ? 'compile_commands.json' : configs.length === 1 ? configs[0]!.path : undefined);
      if (!configPath) return { status: 'unsupported' as const, message: configs.length ? 'Multiple compilation databases; select configPath explicitly' : 'C/C++ semantic analysis requires a readable compile_commands.json; no compiler flags are invented' };
      if (!captured.files.some(f => f.path === configPath)) throw Error('compilation database unavailable');
      if (query.path && !captured.files.some(f => f.path === query.path && source(f.path))) throw Error('C/C++ source unavailable or outside indexed scope');
      if (['definitions', 'references'].includes(query.operation)) {
        const file = captured.files.find(f => f.path === query.path), line = file?.content.split('\n')[Number(query.line) - 1];
        if (!file || !Number.isSafeInteger(query.line) || !Number.isSafeInteger(query.column) || query.line! < 1 || query.column! < 1 || line === undefined || query.column! > line.length + 1) throw Error('indexed path and valid one-based UTF-16 coordinates required');
      }
      const response = await new Promise<AnalyzerResult>((resolveResult, reject) => {
        const child = execFile(this.options.pythonPath ?? '/usr/bin/python3', ['-I', '-S', resolve(import.meta.dirname, '../../scripts/cpp-source-query.py')], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, signal, windowsHide: true, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } }, (error, stdout) => {
          if (error) reject(Error('C/C++ analyzer unavailable, failed or exceeded capacity: ' + error.message));
          else { try { resolveResult(JSON.parse(stdout) as AnalyzerResult); } catch { reject(Error('invalid C/C++ analyzer response')); } }
        });
        child.stdin?.on('error', () => {});
        child.stdin?.end(JSON.stringify({ files: captured.files, query: { ...query, configPath }, libraryPath: this.options.libraryPath ?? '/usr/lib/llvm-18/lib/libclang.so.1' }));
      });
      if (response.status !== 'sourced') return response;
      const snapshot = hash(JSON.stringify({ sources: captured.snapshot, configPath, engineVersion: response.engineVersion, engineDigest: response.engineDigest, adapterDigest: response.adapterDigest, scope: query.prefix ?? null }));
      if (query.expectedSnapshot && query.expectedSnapshot !== snapshot) return { status: 'stale' as const, snapshot, message: 'C/C++ sources, configuration, scope, analyzer or commit changed' };
      if ((await this.capture(signal)).snapshot !== captured.snapshot) return { status: 'stale' as const, message: 'C/C++ sources changed during analysis' };
      const current = new Map(captured.files.map(f => [f.path, f.digest]));
      const changes = { added: [...current.keys()].filter(p => !this.previous.has(p)), modified: [...current.keys()].filter(p => this.previous.has(p) && this.previous.get(p) !== current.get(p)), deleted: [...this.previous.keys()].filter(p => !current.has(p)) };
      this.previous = current;
      const { results, diagnostics, ...metadata } = response;
      return { ...metadata, snapshot, provenance: { ...captured.identity, source: 'working_tree', engine: response.engine, engineVersion: response.engineVersion, engineDigest: response.engineDigest, adapterDigest: response.adapterDigest }, changes,
        excludedFiles: captured.excludedFiles.slice(0, 100), excludedFileCount: captured.excludedFiles.length, excludedFilesTruncated: captured.excludedFiles.length > 100,
        results: results.slice(offset, offset + limit), nextOffset: offset + limit < results.length ? offset + limit : null, totalResults: results.length,
        diagnostics: diagnostics.slice(0, 40), diagnosticsTruncated: diagnostics.length > 40, sources: captured.files.slice(0, 200).map(({ path, digest }) => ({ path, digest })), sourceCount: captured.files.length, sourcesTruncated: captured.files.length > 200 };
    } catch (error) {
      return signal.aborted ? { status: 'cancelled' as const } : { status: 'rejected' as const, message: error instanceof Error ? error.message : 'C/C++ analysis failed' };
    }
  }
}
