/**
 * Python and C++ single-file lookup (slice-8E2-SPEC W11): the functions and classes of one
 * file with the span of each name, for the first-tier read (R3, `mode: 'read'`) and the
 * note write gate (G8, `mode: 'write'`). One resident Python `ast` process and one resident
 * libclang process per port, both through the resident mode of `analysis-runner.ts`.
 *
 * C++ reads the workspace root's `compile_commands.json` on every lookup with the caller's
 * context and hands the process the entries that may name this file; the process asks for
 * every workspace header it needs, and they are read here through the same context, never
 * by the process. With an entry the process parses precisely (the entry's arguments, the
 * workspace headers, and the compiler's own header directories when this machine can use
 * them) and keeps the translation unit with its preamble; a read without a usable kept unit
 * gets the single-file parse (`exact: false`) and warms that unit in the background.
 */
import { posix, resolve } from 'node:path';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import { messageOf } from '../../contracts/error-message.js';
import { createResidentAnalyzer, type ResidentMessage, type ResidentOutcome, type ResidentStep } from './analysis-runner.js';
import { isSafeSourceRelativePath } from './path-validation.js';
import type { WorkspaceError, WorkspaceFile, WorkspaceResult } from './ports.js';
import { DEFAULT_WORKSPACE_LIMITS, type WorkspaceToolsHandle } from './workspace-tools.js';

export type NativeSymbolV1 = { name: string; kind: string;
  start: { line: number; column: number }; end: { line: number; column: number } };   // the name itself; kind is the analyzer's own
export type NativeLookupV1 =
  | { status: 'parsed'; exact: boolean; symbols: NativeSymbolV1[] }
  // exact: C++ parsed with this file's compile_commands.json arguments (workspace headers plus the
  // compiler's own header directories, W11 rule 1) and that parse had no error/fatal diagnostic (as
  // cpp-source-query.py `hasErrors`); a parse with errors, a missed candidate header or the fallback is false; Python true
  | { status: 'unsupported' } | { status: 'unavailable'; reason: string } | { status: 'syntax_error'; line: number; message: string };
  // unsupported: the interpreter or libclang 18 is unavailable or the compile arguments are not recognized;
  // unavailable: timeout, crash, interpreter/process failure; syntax_error: a Python parse failure (line, SyntaxError.msg)
export interface NativeSingleFilePort {
  lookup(ctx: CoreCallContext, input: { language: 'python' | 'cpp'; path: string; text: string; digest: string;
    mode: 'read' | 'write' }): Promise<NativeLookupV1>;
  close(): Promise<void>;
}

/** The analyzers' defaults when the Host injects none (as cpp-source-index.ts and python-source-index.ts). */
const DEFAULT_PYTHON = '/usr/bin/python3';
const DEFAULT_LIBCLANG = '/usr/lib/llvm-18/lib/libclang.so.1';
/** Only the database at the workspace root is read. */
const DATABASE = 'compile_commands.json';
const CLOSED = '单文件查已关闭';
/** Candidate headers that read back with these codes are not in the VFS and the compiler searches on:
 * not_found and forbidden (whose content is never handed over); so is an `unsupported` of kind
 * `not_file` (a directory at a candidate path, which the compiler skips too). Over the limit:
 * `fileService`; any other read failure, a binary or non-UTF-8 header included, fails the lookup. */
const ABSENT: ReadonlySet<WorkspaceError> = new Set(['not_found', 'forbidden']);

const scriptPath = (name: string) => resolve(import.meta.dirname, '../../../scripts', name);

function workspaceRefOf(ctx: CoreCallContext): WorkspaceRef {
  return { aggregateType: 'Workspace', projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
}

const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
function positionOf(value: unknown): { line: number; column: number } {
  const row = value as Record<string, unknown> | null;
  if (typeof row !== 'object' || row === null || !positive(row['line']) || !positive(row['column'])) throw Error('invalid position');
  return { line: row['line'], column: row['column'] };
}
function symbolsOf(value: unknown): NativeSymbolV1[] {
  if (!Array.isArray(value)) throw Error('invalid symbols');
  return value.map(item => {
    const row = item as Record<string, unknown> | null;
    if (typeof row !== 'object' || row === null || typeof row['name'] !== 'string' || typeof row['kind'] !== 'string')
      throw Error('invalid symbol');
    return { name: row['name'], kind: row['kind'], start: positionOf(row['start']), end: positionOf(row['end']) };
  });
}

/** The script's last line of a lookup. Anything else is a protocol error: the runner kills the process. */
function finalOf(reply: ResidentMessage, language: 'python' | 'cpp'): NativeLookupV1 {
  if (reply['t'] === 'result')
    return { status: 'parsed', exact: language === 'python' || reply['exact'] === true, symbols: symbolsOf(reply['symbols']) };
  if (reply['t'] === 'unsupported') return { status: 'unsupported' };
  if (reply['t'] === 'parse_failed' && language === 'python' && positive(reply['line']) && typeof reply['message'] === 'string') return { status: 'syntax_error', line: reply['line'], message: reply['message'] };
  if (reply['t'] === 'failed' && typeof reply['reason'] === 'string') return { status: 'unavailable', reason: reply['reason'] };
  throw Error('invalid single-file reply');
}

function lookupOf(outcome: ResidentOutcome<NativeLookupV1>): NativeLookupV1 {
  if (outcome.status === 'done') return outcome.value;
  return outcome.status === 'unavailable' ? { status: 'unsupported' } : { status: 'unavailable', reason: outcome.reason };
}

/** A pre-filter in the process's own terms (`names_source`): an entry whose normalized
 * `directory` + `file` is this path or ends with `/` + path; the process decides exactly. */
function mayName(entry: unknown, path: string): boolean {
  const row = entry as Record<string, unknown> | null;
  if (typeof row !== 'object' || row === null || typeof row['directory'] !== 'string' || typeof row['file'] !== 'string') return false;
  const physical = posix.normalize(posix.join(row['directory'].replaceAll('\\', '/'), row['file'].replaceAll('\\', '/')));
  return physical === path || physical.endsWith('/' + path);
}

type CppDone = { lookup: NativeLookupV1; warm: boolean };

/**
 * `deps.readWorkspaceFiles` is the workspace tools handle's batch read (one access, raw-byte
 * digests); it is called detached. `sourceAnalyzers` are the Host's trusted interpreter and
 * libclang, as `workspace-tools.ts` takes them.
 */
export function createNativeSingleFile(deps: { readWorkspaceFiles: WorkspaceToolsHandle['readWorkspaceFiles'];
  sourceAnalyzers?: { pythonPath?: string; cppLibraryPath?: string } }): NativeSingleFilePort {
  const readFiles = deps.readWorkspaceFiles;
  const interpreter = deps.sourceAnalyzers?.pythonPath ?? DEFAULT_PYTHON;
  const python = createResidentAnalyzer({ interpreter, script: scriptPath('python-source-query.py'), mode: 'single_file',
    hello: { t: 'hello' } });
  const cpp = createResidentAnalyzer({ interpreter, script: scriptPath('cpp-source-query.py'), mode: 'single_file',
    hello: { t: 'hello', libraryPath: deps.sourceAnalyzers?.cppLibraryPath ?? DEFAULT_LIBCLANG } });
  const maxBytes = DEFAULT_WORKSPACE_LIMITS.maxFileBytes;
  // Background builds end with the port, not with the read that asked for them.
  const lifetime = new AbortController();
  const warming = new Set<string>();
  let closed = false;
  let parsedDatabase: { digest: string; entries: unknown[] | null } | null = null;

  /** The root database's entries that may name `path`; `null` entries: no database. */
  const databaseEntries = async (ctx: CoreCallContext, workspace: WorkspaceRef, path: string):
    Promise<{ entries: unknown[] | null } | { early: NativeLookupV1 }> => {
    let batch: WorkspaceResult<WorkspaceResult<WorkspaceFile>[]>;
    try { batch = await readFiles(ctx, { workspace, paths: [DATABASE], maxBytes }); }
    catch (error) { return { early: { status: 'unavailable', reason: messageOf(error) } }; }
    if (batch.status !== 'ready') return { early: { status: 'unavailable', reason: batch.reason } };
    const file = batch.value[0];
    if (file === undefined) return { early: { status: 'unavailable', reason: 'compile_commands.json was not read' } };
    if (file.status !== 'ready') {
      if (file.code === 'not_found' || file.code === 'forbidden') return { entries: null };
      // Too large, binary or not UTF-8: a database that cannot be parsed.
      if (file.code === 'capacity' || file.code === 'unsupported') return { early: { status: 'unsupported' } };
      return { early: { status: 'unavailable', reason: file.reason } };
    }
    if (parsedDatabase?.digest !== file.value.digest) {
      let entries: unknown[] | null = null;
      try {
        const value = JSON.parse(file.value.content) as unknown;
        if (Array.isArray(value)) entries = value;
      } catch { /* not JSON: unsupported below */ }
      parsedDatabase = { digest: file.value.digest, entries };
    }
    if (parsedDatabase.entries === null) return { early: { status: 'unsupported' } };
    return { entries: parsedDatabase.entries.filter(entry => mayName(entry, path)) };
  };

  /** Answers the process's `read` lines for one lookup: each path is read at most once per
   * lookup, through `ctx`, so every digest and content the process sees is from this lookup. */
  const fileService = (ctx: CoreCallContext, workspace: WorkspaceRef) => {
    const read = new Map<string, WorkspaceResult<WorkspaceFile>>();
    let failure: string | null = null;
    // A candidate header over the read limit exists, so the real compile would use it; handed over as
    // absent, the search may land on a later same-named header, so this lookup's parse is not exact.
    let overLimit = false;
    const failed = (reason: string): ResidentStep<CppDone> => { failure = reason; return { send: { t: 'files', failed: reason } }; };
    return async (reply: ResidentMessage): Promise<ResidentStep<CppDone>> => {
      if (reply['t'] !== 'read') {
        let lookup: NativeLookupV1 = failure !== null && reply['t'] === 'failed' ? { status: 'unavailable', reason: failure } : finalOf(reply, 'cpp');
        if (overLimit && lookup.status === 'parsed') lookup = { ...lookup, exact: false };
        return { done: { lookup, warm: reply['warm'] === true } };
      }
      const paths = reply['paths'];
      if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) throw Error('invalid read request');
      // A name no workspace path can have (`:` or `\` in an include) is simply absent.
      const unread = [...new Set(paths.filter(path => isSafeSourceRelativePath(path) && !read.has(path)))];
      if (unread.length > 0) {
        let batch: WorkspaceResult<WorkspaceResult<WorkspaceFile>[]>;
        try { batch = await readFiles(ctx, { workspace, paths: unread, maxBytes }); }
        catch (error) { return failed(messageOf(error)); }
        if (batch.status !== 'ready') return failed(batch.reason);
        if (batch.value.length !== unread.length) return failed('workspace read returned a different number of files');
        unread.forEach((path, index) => read.set(path, batch.value[index]!));
      }
      const files: Record<string, unknown>[] = [];
      for (const path of paths) {
        const file = read.get(path);
        if (file === undefined) files.push({ path, absent: true });
        else if (file.status === 'ready')
          files.push(reply['content'] === true ? { path, digest: file.value.digest, content: file.value.content } : { path, digest: file.value.digest });
        else if (ABSENT.has(file.code) || (file.code === 'unsupported' && file.kind === 'not_file')) files.push({ path, absent: true });
        else if (file.code === 'capacity') { overLimit = true; files.push({ path, absent: true }); }
        else return failed(file.reason);
      }
      return { send: { t: 'files', files } };
    };
  };

  /** One background precise build per file and entry set at a time; its answer is dropped. */
  const warm = (ctx: CoreCallContext, path: string, text: string, entries: unknown[]): void => {
    const key = path + '\0' + JSON.stringify(entries);
    if (closed || warming.has(key)) return;
    warming.add(key);
    const background: CoreCallContext = { ...ctx, signal: lifetime.signal };
    void cpp.exchange({ t: 'lookup', path, text, mode: 'write', entries }, fileService(background, workspaceRefOf(ctx)))
      .finally(() => warming.delete(key));
  };

  const lookupCpp = async (ctx: CoreCallContext, input: { path: string; text: string; mode: 'read' | 'write' }): Promise<NativeLookupV1> => {
    const workspace = workspaceRefOf(ctx);
    const database = await databaseEntries(ctx, workspace, input.path);
    if ('early' in database) return database.early;
    const outcome = await cpp.exchange({ t: 'lookup', path: input.path, text: input.text, mode: input.mode, entries: database.entries },
      fileService(ctx, workspace));
    if (outcome.status !== 'done') return lookupOf(outcome);
    if (outcome.value.warm && database.entries !== null) warm(ctx, input.path, input.text, database.entries);
    return outcome.value.lookup;
  };

  return {
    async lookup(ctx, input) {
      if (closed) return { status: 'unavailable', reason: CLOSED };
      if (!isSafeSourceRelativePath(input.path)) return { status: 'unavailable', reason: 'path must be a normalized workspace-relative path' };
      if (input.language === 'cpp') return lookupCpp(ctx, input);
      return lookupOf(await python.exchange({ t: 'lookup', path: input.path, digest: input.digest, text: input.text },
        async reply => ({ done: finalOf(reply, 'python') })));
    },
    async close() {
      closed = true;
      lifetime.abort();
      await Promise.all([python.close(), cpp.close()]);
    },
  };
}
