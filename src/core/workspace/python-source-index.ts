import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import type { ProjectSourceAccess, ProjectSourceQuery } from './project-source-index.js';

const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const safe = (p: string) => !!p && !/[\\:\0]/.test(p) && !p.split('/').some(s => !s || s === '.' || s === '..');
const source = (p: string) => /\.pyi?$/.test(p);
const configuration = (p: string) => ['pyproject.toml', 'pyrightconfig.json', 'setup.cfg'].includes(posix.basename(p));
const dependency = (p: string) => /^(?:requirements[^/]*\.txt|(?:poetry|uv|Pipfile)\.lock|Pipfile)$/.test(posix.basename(p));
const ignored = (p: string) => p.split('/').some(s => ['.git', '.evaluator', '.oracle', 'hidden-tests', '.platform-runtime', '.venv', '__pycache__', 'node_modules'].includes(s));
type Material = { path: string; content: string; digest: string; kind: 'source' | 'configuration' | 'dependency_manifest' };
type PythonResult = { status: 'sourced'; engine: string; engineVersion: string; results: Array<Record<string, unknown>>; diagnostics: Array<Record<string, unknown>>; coverage: Record<string, unknown> } | { status: 'unsupported' | 'rejected'; message: string };

export class PythonSourceIndex {
  private previous = new Map<string, Material>();
  private snapshot: string | undefined;
  private generation = 0;
  private readonly responses = new Map<string, PythonResult>();
  constructor(private readonly access: ProjectSourceAccess) {}
  dispose() { this.responses.clear(); this.previous.clear(); this.snapshot = undefined; }
  private async capture(signal: AbortSignal) {
    const identity = await this.access.sourceIdentity(), inventory = await this.access.inventory(signal);
    if (inventory.truncated) throw Error('project inventory incomplete');
    const [script, archive, expectedArchive, manifest] = await Promise.all([
      readFile(resolve(import.meta.dirname, '../../../scripts/python-source-query.py')),
      readFile(resolve(import.meta.dirname, '../../../.local/source-analyzers/analyzers.zip')),
      readFile(resolve(import.meta.dirname, '../../../.local/source-analyzers/analyzers.sha256'), 'utf8'),
      readFile(resolve(import.meta.dirname, '../../../.local/source-analyzers/manifest.json')),
    ]);
    const toolchain = { scriptDigest: hash(script), dependencyArchiveDigest: hash(archive), dependencyManifestDigest: hash(manifest) };
    if (toolchain.dependencyArchiveDigest !== expectedArchive.trim()) throw Error('Python analyzer dependency archive integrity mismatch');
    const files: Material[] = [];
    let size = 0;
    for (const path of [...new Set(inventory.paths)].sort()) {
      if (!safe(path) || !(source(path) || configuration(path) || dependency(path)) || !this.access.allowed(path) || ignored(path)) continue;
      signal.throwIfAborted();
      const { content } = await this.access.read(path, 2 * 1024 * 1024);
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw Error('Python material exceeds 2 MiB capacity: ' + path);
      size += Buffer.byteLength(content);
      if (size > 64 * 1024 * 1024) throw Error('Python source snapshot exceeds 64 MiB; narrow workspace');
      if (content.includes('\0')) throw Error('binary Python source or configuration: ' + path);
      const digest = hash(content), old = this.previous.get(path);
      files.push(old?.digest === digest ? old : { path, content, digest, kind: source(path) ? 'source' : configuration(path) ? 'configuration' : 'dependency_manifest' });
    }
    return { files, identity, toolchain, snapshot: hash(JSON.stringify({ provider: 'python-project-v2', toolchain, identity, files: files.map(f => [f.path, f.digest]) })) };
  }
  async query(query: ProjectSourceQuery, signal: AbortSignal = new AbortController().signal) {
    try {
      if (!['symbols', 'definitions', 'references', 'imports', 'calls'].includes(query.operation)) throw Error('invalid operation');
      if (query.configPath && (!safe(query.configPath) || !this.access.allowed(query.configPath) || ignored(query.configPath))) throw Error('config outside readable scope');
      if (query.configPath && !configuration(query.configPath)) return { status: 'unsupported' as const, message: 'Python configuration must be pyrightconfig.json, pyproject.toml or setup.cfg' };
      for (const p of [query.path, query.prefix]) if (p !== undefined && (!safe(p) || !this.access.allowed(p))) throw Error('path outside readable scope');
      if (query.path && !/\.pyi?$/.test(query.path)) return { status: 'unsupported' as const, message: 'Python provider requires .py/.pyi source' };
      const offset = query.offset ?? 0, limit = query.limit ?? 100;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Error('invalid pagination');
      const captured = await this.capture(signal);
      if (query.configPath && !captured.files.some(f => f.path === query.configPath)) throw Error('config unavailable in readable snapshot');
      if (query.expectedSnapshot && query.expectedSnapshot !== captured.snapshot) return { status: 'stale' as const, snapshot: captured.snapshot, message: 'Python source, configuration, dependency manifest, inventory or commit changed' };
      if (['definitions', 'references'].includes(query.operation)) {
        const file = captured.files.find(f => f.path === query.path), line = file?.content.split('\n')[Number(query.line) - 1];
        if (!file || !Number.isSafeInteger(query.line) || !Number.isSafeInteger(query.column) || query.line! < 1 || query.column! < 1 || line === undefined || query.column! > line.length + 1) throw Error('indexed path and valid one-based UTF-16 coordinates required');
        if (/^[\uDC00-\uDFFF]$/.test(line[query.column! - 1] ?? '')) throw Error('UTF-16 query column splits a Unicode character');
      }
      const changed = captured.files.filter(f => this.previous.get(f.path)?.digest !== f.digest).map(f => ({ path: f.path, kind: f.kind }));
      const paths = new Set(captured.files.map(f => f.path)), removed = [...this.previous.values()].filter(f => !paths.has(f.path)).map(f => ({ path: f.path, kind: f.kind }));
      if (captured.snapshot !== this.snapshot) { this.generation += 1; this.responses.clear(); }
      this.previous = new Map(captured.files.map(f => [f.path, f])); this.snapshot = captured.snapshot;
      // Only complete semantic results are cached. Every hit still re-reads the
      // permission-filtered source/config/dependency manifest before and after.
      const semanticQuery = { operation: query.operation, path: query.path, prefix: query.prefix, configPath: query.configPath, line: query.line, column: query.column };
      const key = JSON.stringify([captured.snapshot, semanticQuery]), cached = structuredClone(this.responses.get(key));
      const response = cached ?? await new Promise<PythonResult>((resolveResult, reject) => {
        const child = execFile('/usr/bin/python3', ['-I', resolve(import.meta.dirname, '../../../scripts/python-source-query.py')], { timeout: 60000, maxBuffer: 4 * 1024 * 1024, signal, windowsHide: true }, (error, stdout) => {
          if (error) reject(Error('Python analyzer failed or exceeded capacity: ' + error.message));
          else { try { resolveResult(JSON.parse(stdout) as PythonResult); } catch { reject(Error('invalid Python analyzer response')); } }
        });
        child.stdin?.on('error', () => {}); child.stdin?.end(JSON.stringify({ files: captured.files, query: semanticQuery }));
      });
      if (response.status !== 'sourced') return response;
      if ((await this.capture(signal)).snapshot !== captured.snapshot) return { status: 'stale' as const, message: 'Python sources changed during analysis' };
      if (!cached) {
        if (this.responses.size >= 32) this.responses.delete(this.responses.keys().next().value!);
        this.responses.set(key, structuredClone(response));
      }
      const { results, diagnostics, ...metadata } = response;
      return { ...metadata, snapshot: captured.snapshot, provenance: { ...captured.identity, source: 'working_tree', engine: response.engine, engineVersion: response.engineVersion, toolchain: captured.toolchain },
        index: { generation: this.generation, reusedResult: !!cached, changed: changed.slice(0, 200), removed: removed.slice(0, 200), changesTruncated: changed.length > 200 || removed.length > 200 },
        results: results.slice(offset, offset + limit), nextOffset: offset + limit < results.length ? offset + limit : null, totalResults: results.length,
        diagnostics: diagnostics.slice(0, 30), diagnosticsTruncated: diagnostics.length > 30, sources: captured.files.slice(0, 200).map(({ path, digest, kind }) => ({ path, digest, kind })), sourceCount: captured.files.length, sourcesTruncated: captured.files.length > 200 };
    } catch (error) {
      return signal.aborted ? { status: 'cancelled' as const } : { status: 'rejected' as const, message: error instanceof Error ? error.message : 'Python analysis failed' };
    }
  }
}
