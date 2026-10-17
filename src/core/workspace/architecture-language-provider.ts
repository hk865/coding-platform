/**
 * Slice 8A (decision 63-3; spec §2/L12) — the language provider seam for the
 * file-level observation graph.
 *
 * Placement note (spec does not fix it): this interface is put in
 * `src/core/workspace/` because it consumes `ProjectSourceAccess`, which is
 * defined in `src/core/workspace/project-source-snapshot.ts`. `src/contracts/`
 * must not import `src/core/`, so the interface cannot live in Contracts even
 * though the pure observation DTOs do.
 *
 * A provider works ONLY over the capture owner's frozen, permission-filtered
 * `ProjectSourceAccess` material; it never reads a different worktree state on
 * its own. TS/JS is covered by the capture's one light scan (§11.2); C/C++ and
 * Python providers arrive with 8D; Rust and Go keep this interface only.
 */
import { resolve } from 'node:path';
import type { LanguageCoverageV1 } from '../../contracts/architecture-inspection.js';
import type { ProjectSourceAccess } from './project-source-snapshot.js';
import { runAnalysis, type AnalysisFileResult } from './analysis-runner.js';

export interface ArchitectureLanguageProviderV1 {
  readonly language: 'typescript' | 'cpp' | 'python' | 'rust' | 'go' | string;
  /** Which files this provider claims (by workspace-relative path). */
  claims(path: string): boolean;
  /**
   * Spec §11.5 target interface. The provider reads only the owner's frozen
   * `ProjectSourceAccess` material; `skipped` is the capture's whole skip list
   * (used only to choose a configuration by existence) and `configOnly` is empty
   * in this segment. `files` and `complete` are computed by the capture owner.
   */
  extractImports(input: {
    source: ProjectSourceAccess;
    skipped: { path: string; reason: string }[];
    configOnly: ReadonlyMap<string, { content: string; digest: string }>;
    signal: AbortSignal;
  }): Promise<{
    /** Workspace-relative `(from, to)` edges. */
    edges: { from: string; to: string }[];
    /** Unresolved specifiers with the provider's reason (`null` when unknown). */
    unresolved: { from: string; specifier: string; reason: string | null }[];
    /** Full (untruncated) per-language coverage; the capture owner caps stored issues. */
    coverage: {
      parsed: number;
      edges: 'supported' | 'unsupported' | 'failed';
      reason: string | null;
      notes: string[];
      issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[];
    };
  }>;
}

/**
 * One node of the assembled project file graph (§10 item 2). The full node is
 * stored once in the file layer; pages project only path/language/nonBlankLines.
 */
export type ProjectFileGraphNodeV1 = {
  path: string;
  digest: string;
  byteSize: number;
  language: string;
  nonBlankLines: number;
  /** Walked by the TS scan for TS/JS and walked `.json`; `parsed` for C/C++ and
   * Python; `false` otherwise (§10 item 2, lead answer 8). */
  indexed: boolean;
};

/**
 * The assembled file-level observation graph across all language providers for
 * one frozen capture: nodes, edges, kept `unresolved` entries, per-language
 * coverage, and whether every provider completed.
 */
export type ProjectFileGraphV1 = {
  nodes: ProjectFileGraphNodeV1[];
  edges: { from: string; to: string }[];
  unresolved: { from: string; specifier: string; reason: string | null }[];
  languages: LanguageCoverageV1[];
  complete: boolean;
  /** §10 item 1: which enumeration supplied the observation inventory. Every
   * capture writes it; the current format has no whole-`null` value. */
  inventory: { source: 'git' | 'skip_list'; reason: string | null };
};

/** The L12 extension table; every other extension is `other`. */
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc']);
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi']);
const RUST_EXTENSIONS = new Set(['.rs']);
const GO_EXTENSIONS = new Set(['.go']);

/** Recognized language of one workspace-relative path, by the L12 extension table. */
export function languageOfPath(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : '';
  if (TYPESCRIPT_EXTENSIONS.has(extension)) return 'typescript';
  if (CPP_EXTENSIONS.has(extension)) return 'cpp';
  if (PYTHON_EXTENSIONS.has(extension)) return 'python';
  if (RUST_EXTENSIONS.has(extension)) return 'rust';
  if (GO_EXTENSIONS.has(extension)) return 'go';
  return 'other';
}

const IMPORT_FILE_BYTES = 2 * 1024 * 1024;

type ExtractResult = Awaited<ReturnType<ArchitectureLanguageProviderV1['extractImports']>>;

const EMPTY_COVERAGE = (): ExtractResult => ({
  edges: [], unresolved: [],
  coverage: { parsed: 0, edges: 'supported', reason: null, notes: [], issues: [] },
});

const wholeLanguageFailure = (reason: string): ExtractResult => ({
  edges: [], unresolved: [],
  coverage: { parsed: 0, edges: 'failed', reason, notes: [],
    issues: [] as { path: string; kind: 'skipped' | 'failed'; reason: string }[] },
});

const basenameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const databaseName = 'compile_commands.json';
const scriptPath = (name: string) => resolve(import.meta.dirname, '../../../scripts', name);
const PYTHON_CONFIGURATION_NAMES = ['pyrightconfig.json', 'pyproject.toml', 'setup.cfg'];

/** The whole readable inventory, original case; the capture froze it sorted. */
async function readablePaths(source: ProjectSourceAccess, signal: AbortSignal): Promise<string[]> {
  const inventory = await source.inventory(signal);
  return [...new Set(inventory.paths)].filter(path => source.allowed(path));
}

/** Read one frozen file, or the `configOnly` content when the capture supplied it there. */
async function readFrozen(source: ProjectSourceAccess, path: string,
  configOnly: ReadonlyMap<string, { content: string; digest: string }>): Promise<string> {
  const only = configOnly.get(path);
  if (only !== undefined) return only.content;
  return (await source.read(path, IMPORT_FILE_BYTES)).content;
}

/** Read the runner's file lines in inventory order; one read per claimed path. */
async function readFiles(source: ProjectSourceAccess, paths: readonly string[]): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  for (const path of paths) files.push({ path, content: (await source.read(path, IMPORT_FILE_BYTES)).content });
  return files;
}

/** Spec §11.5: a cancelled runner throws so the capture reports the whole request cancelled. */
function requireDone(outcome: Awaited<ReturnType<typeof runAnalysis>>) {
  if (outcome.status === 'cancelled') throw Error('import analysis cancelled');
  return outcome.status === 'failed' ? wholeLanguageFailure(outcome.reason) : null;
}

/**
 * Spec §11.5: convert the runner's per-file map into coverage counts. Every claimed
 * file has a result, and every non-parsed row is an issue (a skipped row keeps the
 * runner's reason). Kept in one place so the C/C++ and Python providers cannot drift.
 */
function coverageFromFiles(files: ReadonlyMap<string, AnalysisFileResult>): {
  parsed: number; issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[];
} {
  let parsed = 0;
  const issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[] = [];
  for (const file of files.values()) {
    if (file.status === 'parsed') { parsed += 1; continue; }
    issues.push({ path: file.path, kind: file.status, reason: file.reason! });
  }
  return { parsed, issues };
}

/** Spec §11.4: the frozen database choice over every known database path. */
function selectCppDatabases(candidates: readonly string[]): { selected: string[] } | { reason: string } {
  const paths = [...new Set(candidates)].sort();
  if (paths.includes(databaseName)) return { selected: [databaseName] };
  if (paths.length === 1) return { selected: paths };
  const parts = (path: string) => path.split('/');
  const isDatabase = (path: string) => basenameOf(path) === databaseName;
  // The colcon aggregate `B/compile_commands.json` wins alone when every other
  // database is `B/<one subdirectory>/compile_commands.json` under the same B.
  const aggregates = paths.filter(candidate => {
    if (!isDatabase(candidate)) return false;
    const own = parts(candidate);
    if (own.length < 2) return false;
    const base = own.slice(0, -1).join('/');
    if (base === '') return false;
    return paths.every(other => {
      if (other === candidate) return true;
      const row = parts(other);
      return row.length === own.length + 1 && isDatabase(other) && row[own.length - 1] !== '' &&
        row.slice(0, own.length - 1).join('/') === base;
    });
  });
  if (aggregates.length === 1) return { selected: [aggregates[0]!] };
  // Every database is `B/<one subdirectory>/compile_commands.json` under one common,
  // non-root B: merge them all in path order and note the count.
  const bases = new Set<string>();
  const allChildren = paths.every(path => {
    const row = parts(path);
    if (!isDatabase(path) || row.length < 3 || row[row.length - 2] === '') return false;
    const base = row.slice(0, -2).join('/');
    if (base === '') return false;
    bases.add(base);
    return true;
  });
  if (allChildren && bases.size === 1) return { selected: paths };
  return { reason: '有多个编译数据库' };
}

/** The L12 C/C++ claims, plus the includable-but-unclaimed text files the VFS accepts. */
const cppIncludable = (path: string) => /\.def$/.test(path) || !basenameOf(path).includes('.');

/**
 * The C/C++ provider over the capture's frozen `ProjectSourceAccess`: it selects the
 * compile databases and their hints here, then hands the selected databases, the
 * workspace roots and every claimed/includable text file to the shared §11.5 runner.
 */
export function createCppLanguageProvider(options: {
  libraryPath?: string; pythonPath?: string; unitTimeoutMs?: number; languageTimeoutMs?: number;
  /** Host root and its realpath; null when a test double has no roots. */
  workspaceRoot?: string; workspaceRealRoot?: string;
} = {}): ArchitectureLanguageProviderV1 {
  const claims = (path: string) => languageOfPath(path) === 'cpp';
  return {
    language: 'cpp',
    claims,
    async extractImports({ source, skipped, configOnly, signal }) {
      const paths = await readablePaths(source, signal);
      const claimed = paths.filter(claims);
      if (claimed.length === 0) return EMPTY_COVERAGE();
      const skippedByPath = new Map(skipped.map(entry => [entry.path, entry.reason]));
      const known = [...new Set([...paths, ...skipped.map(entry => entry.path), ...configOnly.keys()])].sort();
      const candidates = known.filter(path => basenameOf(path) === databaseName);
      if (candidates.length === 0) {
        const names = new Set([...paths, ...skipped.map(entry => entry.path)].map(basenameOf));
        const colcon = '没有 compile_commands.json；可以用 colcon build --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 生成';
        const cmake = '没有 compile_commands.json；可以用 cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 生成';
        return wholeLanguageFailure(names.has('package.xml') ? colcon : names.has('CMakeLists.txt') ? cmake : '没有 compile_commands.json');
      }
      const selected = selectCppDatabases(candidates);
      if ('reason' in selected) return wholeLanguageFailure(selected.reason);
      // One unreadable selected database fails the language with the first one by path.
      const unreadable = selected.selected.find(path => skippedByPath.has(path));
      if (unreadable !== undefined)
        return wholeLanguageFailure(`${basenameOf(unreadable)} 读不了：${skippedByPath.get(unreadable)!}`);
      const databases: { path: string; content: string }[] = [];
      for (const path of selected.selected) databases.push({ path, content: await readFrozen(source, path, configOnly) });
      const files = await readFiles(source, claimed);
      for (const path of paths) {
        if (claims(path) || !cppIncludable(path)) continue;
        files.push({ path, content: (await source.read(path, IMPORT_FILE_BYTES)).content });
      }
      const outcome = await runAnalysis({
        language: 'cpp',
        interpreter: options.pythonPath ?? '/usr/bin/python3',
        script: scriptPath('cpp-source-query.py'),
        paths: claimed,
        files,
        config: {
          libraryPath: options.libraryPath ?? '/usr/lib/llvm-18/lib/libclang.so.1',
          databases,
          workspaceRoot: options.workspaceRoot ?? null,
          workspaceRealRoot: options.workspaceRealRoot ?? null,
        },
        ...(options.unitTimeoutMs === undefined ? {} : { unitTimeoutMs: options.unitTimeoutMs }),
        ...(options.languageTimeoutMs === undefined ? {} : { languageTimeoutMs: options.languageTimeoutMs }),
        signal,
      });
      const failed = requireDone(outcome);
      if (failed !== null) return failed;
      if (outcome.status !== 'done') return wholeLanguageFailure('分析器不可用');
      const { parsed, issues } = coverageFromFiles(outcome.files);
      // The script computes `合并了 <n> 个编译数据库` from the databases it is given.
      return { edges: outcome.edges, unresolved: outcome.unresolved,
        coverage: { parsed, edges: 'supported', reason: null, notes: outcome.notes, issues } };
    },
  };
}

/**
 * The Python provider over the capture's frozen `ProjectSourceAccess`: it chooses the
 * configuration by existence (read, skipped or config-only) and passes it to the
 * shared §11.5 runner; an unreadable selected configuration fails the whole language.
 */
export function createPythonLanguageProvider(options: {
  pythonPath?: string; unitTimeoutMs?: number; languageTimeoutMs?: number;
} = {}): ArchitectureLanguageProviderV1 {
  const claims = (path: string) => languageOfPath(path) === 'python';
  return {
    language: 'python',
    claims,
    async extractImports({ source, skipped, configOnly, signal }) {
      const paths = await readablePaths(source, signal);
      const claimed = paths.filter(claims);
      if (claimed.length === 0) return EMPTY_COVERAGE();
      const skippedByPath = new Map(skipped.map(entry => [entry.path, entry.reason]));
      const known = new Set([...paths, ...skipped.map(entry => entry.path), ...configOnly.keys()]);
      const configPath = PYTHON_CONFIGURATION_NAMES.find(name => known.has(name)) ?? null;
      let config: { path: string; content: string } | null = null;
      if (configPath !== null) {
        const skipReason = skippedByPath.get(configPath);
        if (skipReason !== undefined)
          return wholeLanguageFailure(`${basenameOf(configPath)} 读不了：${skipReason}`);
        config = { path: configPath, content: await readFrozen(source, configPath, configOnly) };
      }
      const outcome = await runAnalysis({
        language: 'python',
        interpreter: options.pythonPath ?? '/usr/bin/python3',
        script: scriptPath('python-source-query.py'),
        paths: claimed,
        files: await readFiles(source, claimed),
        config,
        ...(options.unitTimeoutMs === undefined ? {} : { unitTimeoutMs: options.unitTimeoutMs }),
        ...(options.languageTimeoutMs === undefined ? {} : { languageTimeoutMs: options.languageTimeoutMs }),
        signal,
      });
      const failed = requireDone(outcome);
      if (failed !== null) return failed;
      if (outcome.status !== 'done') return wholeLanguageFailure('分析器不可用');
      const { parsed, issues } = coverageFromFiles(outcome.files);
      return { edges: outcome.edges, unresolved: outcome.unresolved,
        coverage: { parsed, edges: 'supported', reason: null, notes: outcome.notes, issues } };
    },
  };
}
