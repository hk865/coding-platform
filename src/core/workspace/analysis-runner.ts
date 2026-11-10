/**
 * §11.5 / decision 78 — the one NDJSON executor shared by the Python and C/C++
 * import-scan providers. It spawns `<interpreter> -I -S <script> import_graph`,
 * feeds the frozen header and file lines on stdin, merges the per-unit `done`
 * records the script writes on stdout, and owns the timers, exits, restarts,
 * error classes and output caps.
 *
 * The protocol is line oriented in both directions and uses no temporary files.
 * The script is restarted from the next undone unit after a unit timeout, a
 * crash between `start` and `done`, or an exit between units; the same header is
 * resent with a higher `resumeFrom`.
 *
 * `createResidentAnalyzer` (slice-8E2-SPEC W11) is the long-lived mode of the same executor:
 * one process per script mode, started on first use and kept between requests,
 * with the same spawn, line reader, output caps, timeout and kill.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export type AnalysisLanguage = 'cpp' | 'python';
export type AnalysisFileResult = { path: string; status: 'parsed' | 'failed' | 'skipped'; reason?: string };
export type AnalysisRunInput = {
  language: AnalysisLanguage;
  interpreter: string;
  script: string;
  paths: string[];
  files: { path: string; content: string }[];
  config: unknown;
  unitTimeoutMs?: number;
  languageTimeoutMs?: number;
  signal: AbortSignal;
};
export type AnalysisRunOutcome =
  | { status: 'done'; engine: string; engineVersion: string; units: string[]; notes: string[];
      files: Map<string, AnalysisFileResult>;
      /** `count`: distinct `(from, to, specifier)` triples of the pair over every done unit. */
      edges: { from: string; to: string; count: number }[];
      unresolved: { from: string; specifier: string; reason: string | null }[] }
  | { status: 'failed'; reason: string }
  | { status: 'cancelled' };

const READ_FAILED = '分析运行失败：输出读不了';
const OVER_LIMIT = '分析运行失败：输出超过 64 MiB';
const UNAVAILABLE = '分析器不可用';
const TIMEOUT = '超时';
const CRASHED = '分析进程崩溃';
const APPROXIMATE = '近似：不读系统头文件和观测以外的头文件';
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_UNIT_TIMEOUT_MS = 20_000;
const KILL_WAIT_MS = 5_000;
const SOURCE_EXTENSION = /\.(c|cc|cpp|cxx)$/i;

type FileEntry = { path: string; status: 'parsed' | 'failed'; reason?: string };
type DoneRecord = { done: true; files: FileEntry[]; edges: [string, string, string][];
  unresolved: { from: string; specifier: string; reason: string | null }[] };
type UnitRecord = DoneRecord | { done: false; reason: string };
type Ready = { engine: string; engineVersion: string; units: string[]; notes: string[] };
type ExitInfo = { code: number | null; signal: NodeJS.Signals | null };
type StdoutEvent = { kind: 'line'; line: string } | { kind: 'end' } | { kind: 'error'; reason: string };
type Wake = { kind: 'event'; event: StdoutEvent } | { kind: 'unit' } | { kind: 'language' }
  | { kind: 'abort' } | { kind: 'spawn' } | { kind: 'exit' };
type OutputBytes = { total: number };
type LaunchResult = { kind: 'finish' } | { kind: 'restart'; from: number }
  | { kind: 'failed'; reason: string } | { kind: 'cancelled' };

class RunnerFailure extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}
const invalid = () => new RunnerFailure(READ_FAILED);
const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms).unref(); });

/** The stdout side of the protocol, one line per event, thrown read errors included.
 * The byte counter spans every launch of one language run; only the line buffer is
 * per process. */
async function* readLines(stream: NodeJS.ReadableStream, bytes: OutputBytes): AsyncGenerator<string> {
  const iterator = (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  let buffer: Buffer = Buffer.alloc(0);
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) break;
    bytes.total += value.length;
    if (bytes.total > MAX_TOTAL_BYTES) throw new RunnerFailure(OVER_LIMIT);
    buffer = buffer.length === 0 ? value : Buffer.concat([buffer, value]);
    for (;;) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      if (line.length > MAX_LINE_BYTES) throw new RunnerFailure(READ_FAILED);
      yield line.toString('utf8');
    }
    if (buffer.length > MAX_LINE_BYTES) throw new RunnerFailure(READ_FAILED);
  }
  if (buffer.length > 0) yield buffer.toString('utf8');
}

class EventQueue {
  private readonly items: StdoutEvent[] = [];
  private waiter: (() => void) | null = null;
  push(item: StdoutEvent): void {
    this.items.push(item);
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }
  async shift(): Promise<StdoutEvent> {
    if (this.items.length === 0) await new Promise<void>(resolve => { this.waiter = resolve; });
    return this.items.shift()!;
  }
}

/** Start draining stdout immediately so a large stdin feed and a chatty child cannot deadlock. */
function startReader(stream: NodeJS.ReadableStream, bytes: OutputBytes): EventQueue {
  const queue = new EventQueue();
  void (async () => {
    try {
      for await (const line of readLines(stream, bytes)) queue.push({ kind: 'line', line });
      queue.push({ kind: 'end' });
    } catch (error) {
      queue.push({ kind: 'error', reason: error instanceof RunnerFailure ? error.reason : READ_FAILED });
    }
  })();
  return queue;
}

/** The one spawn of an analyzer script: `<interpreter> -I -S <script> <mode>`, a minimal
 * environment, stderr discarded, detached as its own process group so `terminate` can kill
 * everything it started. Some spawn errors throw synchronously (ENOTDIR); others arrive as
 * the child's `error` event. */
function spawnAnalyzer(interpreter: string, script: string, mode: string): ChildProcess {
  return spawn(interpreter, ['-I', '-S', script, mode], {
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'ignore'], detached: true,
  });
}

/** §11.5: only ENOENT/EACCES mean the analyzer is unavailable; every other spawn error keeps
 * its own `<exception type>: <message>` class. */
function spawnFailureReason(error: NodeJS.ErrnoException | null): string {
  if (error !== null && (error.code === 'ENOENT' || error.code === 'EACCES')) return UNAVAILABLE;
  return `${error?.name ?? 'Error'}: ${(error?.message ?? 'spawn failed').slice(0, 200)}`;
}

/** Settles once with the child's end, whichever of exit, error and close comes first. */
function exitOf(child: ChildProcess): Promise<ExitInfo> {
  return new Promise<ExitInfo>(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null }));
    child.once('close', () => resolve({ code: child.exitCode, signal: child.signalCode }));
  });
}

/** Kill the child's whole process group (the child is started detached as its leader). */
async function terminate(child: ChildProcess, exited: Promise<ExitInfo>): Promise<void> {
  const pid = child.pid;
  if (pid !== undefined) {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* the group is already gone */ }
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  await Promise.race([exited, sleep(KILL_WAIT_MS)]);
}

async function writeInput(child: ChildProcess, input: AnalysisRunInput, resumeFrom: number): Promise<void> {
  const stdin = child.stdin;
  if (!stdin) return;
  stdin.on('error', () => { /* a child that exits early closes the pipe; the exit path decides */ });
  const write = async (text: string): Promise<boolean> => {
    if (input.signal.aborted || stdin.destroyed) return false;
    let accepted: boolean;
    try { accepted = stdin.write(text); } catch { return false; }
    if (accepted) return true;
    await new Promise<void>(resolve => {
      const done = () => {
        stdin.removeListener('drain', done);
        stdin.removeListener('close', done);
        stdin.removeListener('error', done);
        input.signal.removeEventListener('abort', done);
        resolve();
      };
      stdin.once('drain', done);
      stdin.once('close', done);
      stdin.once('error', done);
      input.signal.addEventListener('abort', done, { once: true });
    });
    return !input.signal.aborted && !stdin.destroyed;
  };
  const header = { t: 'header', v: 1, paths: input.paths, config: input.config, resumeFrom };
  if (!await write(JSON.stringify(header) + '\n')) return;
  for (const file of input.files) {
    if (!await write(JSON.stringify({ t: 'file', path: file.path, content: file.content }) + '\n')) return;
  }
  try { stdin.end(); } catch { /* already closed */ }
}

function parseFiles(value: unknown): FileEntry[] {
  if (!Array.isArray(value)) throw invalid();
  return value.map(entry => {
    if (typeof entry !== 'object' || entry === null) throw invalid();
    const row = entry as Record<string, unknown>;
    if (typeof row['path'] !== 'string' || (row['status'] !== 'parsed' && row['status'] !== 'failed')) throw invalid();
    if (row['reason'] !== undefined && typeof row['reason'] !== 'string') throw invalid();
    return { path: row['path'], status: row['status'], ...(row['reason'] === undefined ? {} : { reason: row['reason'] }) };
  });
}

function parseTriples(value: unknown): [string, string, string][] {
  if (!Array.isArray(value)) throw invalid();
  return value.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(item => typeof item === 'string')) throw invalid();
    return [entry[0] as string, entry[1] as string, entry[2] as string];
  });
}

function parseUnresolved(value: unknown): DoneRecord['unresolved'] {
  if (!Array.isArray(value)) throw invalid();
  return value.map(entry => {
    if (typeof entry !== 'object' || entry === null) throw invalid();
    const row = entry as Record<string, unknown>;
    if (typeof row['from'] !== 'string' || typeof row['specifier'] !== 'string') throw invalid();
    if (row['reason'] !== undefined && row['reason'] !== null && typeof row['reason'] !== 'string') throw invalid();
    return { from: row['from'], specifier: row['specifier'], reason: typeof row['reason'] === 'string' ? row['reason'] : null };
  });
}

function parseReady(value: Record<string, unknown>): Ready {
  const { engine, engineVersion, units, notes } = value;
  if (typeof engine !== 'string' || typeof engineVersion !== 'string') throw invalid();
  if (!Array.isArray(units) || !units.every(unit => typeof unit === 'string')) throw invalid();
  if (notes !== undefined && (!Array.isArray(notes) || !notes.every(note => typeof note === 'string'))) throw invalid();
  return { engine, engineVersion, units: [...units], notes: notes === undefined ? [] : [...notes] };
}

const sameReady = (left: Ready, right: Ready) => JSON.stringify(left) === JSON.stringify(right);
const exitLabel = (info: ExitInfo) => info.signal !== null ? `信号 ${info.signal}` : `退出码 ${info.code ?? 'null'}`;

/** §11.4/§11.5 merge over every acknowledged unit record; every claimed path gets a result. */
function mergeOutcome(input: AnalysisRunInput, ready: Ready, records: ReadonlyMap<number, UnitRecord>): AnalysisRunOutcome {
  const claimed = new Set(input.paths);
  const seen = new Map<string, { unit: number; status: 'parsed' | 'failed'; reason?: string }[]>();
  let unfinished = false;
  for (let i = 0; i < ready.units.length; i += 1) {
    const record = records.get(i);
    if (record === undefined || !record.done) {
      unfinished = true;
      const path = ready.units[i]!;
      if (record !== undefined && claimed.has(path)) {
        const rows = seen.get(path) ?? [];
        rows.push({ unit: i, status: 'failed', reason: record.reason });
        seen.set(path, rows);
      }
      continue;
    }
    // §11.4: a unit that could not be done at all reports only its failed main file;
    // for the never-read rule that unit counts as unfinished. A per-file preprocessing
    // failure (`预处理出错：…`) is a completed unit, not a whole-unit failure.
    const only = record.files.length === 1 ? record.files[0]! : null;
    if (only !== null && only.path === ready.units[i] && only.status === 'failed' &&
        claimed.has(only.path) && (only.reason === undefined || !only.reason.startsWith('预处理出错：')))
      unfinished = true;
    for (const file of record.files) {
      if (!claimed.has(file.path)) continue;
      const rows = seen.get(file.path) ?? [];
      rows.push({ unit: i, status: file.status, ...(file.reason === undefined ? {} : { reason: file.reason }) });
      seen.set(file.path, rows);
    }
  }
  const files = new Map<string, AnalysisFileResult>();
  for (const path of input.paths) {
    const rows = seen.get(path);
    if (rows !== undefined) {
      if (rows.some(row => row.status === 'parsed')) { files.set(path, { path, status: 'parsed' }); continue; }
      const main = (unit: number) => ready.units[unit]!;
      const first = rows.filter(row => row.status === 'failed')
        .sort((left, right) => main(left.unit) < main(right.unit) ? -1 : main(left.unit) > main(right.unit) ? 1 : left.unit - right.unit)[0];
      files.set(path, { path, status: 'failed', ...(first?.reason === undefined ? {} : { reason: first.reason }) });
      continue;
    }
    if (unfinished) files.set(path, { path, status: 'skipped', reason: '有编译单元没有做完' });
    else if (input.language === 'cpp' && SOURCE_EXTENSION.test(path))
      files.set(path, { path, status: 'skipped', reason: '源文件不在编译数据库里' });
    else files.set(path, { path, status: 'skipped', reason: '没有编译单元包含它' });
  }

  // A reference is one `(from, to, specifier)` triple, de-duplicated across
  // every done unit. The script's own set is per process and starts empty after a
  // restart, so a shared header read by units on both sides of a restart is sent
  // again; only the first sighting of a triple adds 1 to its `(from, to)` count.
  const edges: { from: string; to: string; count: number }[] = [];
  const edgeByKey = new Map<string, { from: string; to: string; count: number }>();
  const triples = new Set<string>();
  const edgePairs = new Set<string>();
  const droppedSelfPairs = new Set<string>();
  const reasons = new Map<string, { from: string; specifier: string; reason: string | null }>();
  for (let i = 0; i < ready.units.length; i += 1) {
    const record = records.get(i);
    if (record === undefined || !record.done) continue;
    for (const [from, to, specifier] of record.edges) {
      const pair = from + '\0' + specifier;
      if (from === to) { droppedSelfPairs.add(pair); continue; }
      edgePairs.add(pair);
      const triple = from + '\0' + to + '\0' + specifier;
      if (triples.has(triple)) continue;
      triples.add(triple);
      const key = from + '\0' + to;
      const edge = edgeByKey.get(key);
      if (edge !== undefined) { edge.count += 1; continue; }
      const created = { from, to, count: 1 };
      edgeByKey.set(key, created);
      edges.push(created);
    }
  }
  const unresolved: { from: string; specifier: string; reason: string | null }[] = [];
  for (let i = 0; i < ready.units.length; i += 1) {
    const record = records.get(i);
    if (record === undefined || !record.done) continue;
    for (const item of record.unresolved) {
      const pair = item.from + '\0' + item.specifier;
      if (droppedSelfPairs.has(pair)) continue;
      if (input.language === 'cpp' && edgePairs.has(pair)) continue;
      const existing = reasons.get(pair);
      if (existing === undefined) {
        const row = { from: item.from, specifier: item.specifier, reason: item.reason };
        reasons.set(pair, row);
        unresolved.push(row);
      } else if (item.reason !== null && (existing.reason === null || item.reason < existing.reason)) {
        existing.reason = item.reason;
      }
    }
  }
  const notes = [...ready.notes];
  if (input.language === 'cpp' && input.paths.length > 0) notes.push(APPROXIMATE);
  return { status: 'done', engine: ready.engine, engineVersion: ready.engineVersion, units: ready.units,
    notes, files, edges, unresolved };
}

export async function runAnalysis(input: AnalysisRunInput): Promise<AnalysisRunOutcome> {
  const unitTimeoutMs = input.unitTimeoutMs ?? DEFAULT_UNIT_TIMEOUT_MS;
  const languageTimeoutMs = input.languageTimeoutMs ?? (input.language === 'cpp' ? 300_000 : 120_000);
  if (input.signal.aborted) return { status: 'cancelled' };
  const records = new Map<number, UnitRecord>();
  let firstReady: Ready | null = null;
  let languageDeadline: number | null = null;

  const nextUndone = (): number | null => {
    const units = firstReady?.units ?? [];
    for (let i = 0; i < units.length; i += 1) if (!records.has(i)) return i;
    return null;
  };

  const outputBytes: OutputBytes = { total: 0 };

  const runLaunch = async (launch: number, resumeFrom: number): Promise<LaunchResult> => {
    if (languageDeadline === null) languageDeadline = Date.now() + languageTimeoutMs;
    let child: ChildProcess;
    try {
      child = spawnAnalyzer(input.interpreter, input.script, 'import_graph');
    } catch (error) {
      // Node throws synchronously for some spawn errors (for example ENOTDIR when a
      // path component is a regular file); keep the same §11.5 classes.
      return { kind: 'failed', reason: spawnFailureReason(error as NodeJS.ErrnoException) };
    }
    let spawnError: NodeJS.ErrnoException | null = null;
    const spawnFailed = new Promise<void>(resolve => child.once('error', error => {
      spawnError = error as NodeJS.ErrnoException;
      resolve();
    }));
    const exited = exitOf(child);
    const spawnReason = (): string => spawnFailureReason(spawnError);
    const queue = child.stdout ? startReader(child.stdout, outputBytes) : new EventQueue();
    void writeInput(child, input, resumeFrom).catch(() => { /* judged through the exit paths */ });

    let pendingEvent: Promise<StdoutEvent> | null = null;
    const nextEvent = () => (pendingEvent ??= queue.shift());
    let current: number | null = null;
    let unitDeadline: number | null = null;
    let launchHadStart = false;
    let exitInfo: ExitInfo | null = null;
    let stdoutEnded = child.stdout === null;
    let protocolEnd = false;

    const failUnit = (reason: string): LaunchResult => {
      records.set(current!, { done: false, reason });
      current = null;
      unitDeadline = null;
      const from = nextUndone();
      return from === null ? { kind: 'finish' } : { kind: 'restart', from };
    };

    /** Decide after stdout is drained: unreadable output already won when it arrived,
     * then the protocol end, then the §11.5 exit-between-units rules. */
    const conclude = async (viaEnd: boolean): Promise<LaunchResult> => {
      await terminate(child, exited);
      if (spawnError !== null) return { kind: 'failed', reason: spawnReason() };
      if (current !== null) return failUnit(CRASHED);
      if (firstReady === null)
        return { kind: 'failed', reason: `分析运行失败：进程在第一个单元前退出（${exitLabel(exitInfo!)}）` };
      const from = nextUndone();
      if (from === null) return { kind: 'finish' };
      if (!viaEnd && !launchHadStart) {
        if (launch === 0)
          return { kind: 'failed', reason: `分析运行失败：进程在第一个单元前退出（${exitLabel(exitInfo!)}）` };
        const reason = `分析运行失败：重启后的进程在新单元前退出（${exitLabel(exitInfo!)}）`;
        for (let i = 0; i < firstReady.units.length; i += 1) if (!records.has(i)) records.set(i, { done: false, reason });
        return { kind: 'finish' };
      }
      return { kind: 'restart', from };
    };

    for (;;) {
      const wake = await new Promise<Wake>(resolve => {
        let settled = false;
        const timers: NodeJS.Timeout[] = [];
        const onAbort = () => finish({ kind: 'abort' });
        const finish = (wake: Wake) => {
          if (settled) return;
          settled = true;
          for (const timer of timers) clearTimeout(timer);
          input.signal.removeEventListener('abort', onAbort);
          resolve(wake);
        };
        input.signal.addEventListener('abort', onAbort, { once: true });
        if (input.signal.aborted) { finish({ kind: 'abort' }); return; }
        if (unitDeadline !== null) timers.push(setTimeout(() => finish({ kind: 'unit' }), Math.max(0, unitDeadline - Date.now())));
        if (languageDeadline !== null) timers.push(setTimeout(() => finish({ kind: 'language' }), Math.max(0, languageDeadline - Date.now())));
        nextEvent().then(event => finish({ kind: 'event', event }));
        spawnFailed.then(() => finish({ kind: 'spawn' }));
        if (exitInfo === null) exited.then(info => { exitInfo = info; finish({ kind: 'exit' }); });
      });

      if (wake.kind === 'abort') { await terminate(child, exited); return { kind: 'cancelled' }; }
      if (wake.kind === 'spawn') { await terminate(child, exited); return { kind: 'failed', reason: spawnReason() }; }
      if (wake.kind === 'language') {
        await terminate(child, exited);
        if (firstReady === null) return { kind: 'failed', reason: '分析运行失败：没有给出单元清单就到时' };
        for (let i = 0; i < firstReady.units.length; i += 1) if (!records.has(i)) records.set(i, { done: false, reason: TIMEOUT });
        return { kind: 'finish' };
      }
      if (wake.kind === 'unit') {
        await terminate(child, exited);
        return failUnit(TIMEOUT);
      }
      if (wake.kind === 'exit') {
        // The process is gone; drain stdout before deciding, unreadable output first.
        if (stdoutEnded) return conclude(protocolEnd);
        continue;
      }

      pendingEvent = null;
      const event = wake.event;
      if (event.kind === 'error') { await terminate(child, exited); return { kind: 'failed', reason: event.reason }; }
      if (event.kind === 'end') {
        stdoutEnded = true;
        // A process that closes stdout and hangs is left to the unit/language timers
        // and to cancellation; do not await its exit outside this loop.
        if (spawnError !== null) { await terminate(child, exited); return { kind: 'failed', reason: spawnReason() }; }
        if (exitInfo !== null) return conclude(protocolEnd);
        continue;
      }

      try {
        const row = JSON.parse(event.line) as Record<string, unknown>;
        if (typeof row !== 'object' || row === null) throw invalid();
        const type = row['t'];
        if (type === 'unavailable') {
          await terminate(child, exited);
          return { kind: 'failed', reason: UNAVAILABLE };
        }
        if (type === 'failed') {
          if (typeof row['reason'] !== 'string') throw invalid();
          await terminate(child, exited);
          return { kind: 'failed', reason: row['reason'] };
        }
        if (type === 'ready') {
          const ready = parseReady(row);
          if (firstReady === null) firstReady = ready;
          else if (!sameReady(firstReady, ready)) throw invalid();
          continue;
        }
        if (type === 'start') {
          const units = firstReady?.units;
          const index = row['i'];
          if (units === undefined || !Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= units.length ||
              units[index as number] !== row['path'] || current !== null || records.has(index as number)) throw invalid();
          current = index as number;
          unitDeadline = Date.now() + unitTimeoutMs;
          launchHadStart = true;
          continue;
        }
        if (type === 'done') {
          if (firstReady === null || current === null || row['i'] !== current) throw invalid();
          const files = parseFiles(row['files']);
          const edges = parseTriples(row['edges']);
          const unresolved = parseUnresolved(row['unresolved']);
          records.set(current, { done: true, files, edges, unresolved });
          current = null;
          unitDeadline = null;
          continue;
        }
        if (type === 'end') {
          // Keep reading: output after the protocol end is still parsed, and an
          // unreadable line after it wins over the recorded results.
          if (firstReady === null) throw invalid();
          protocolEnd = true;
          continue;
        }
        throw invalid();
      } catch (error) {
        await terminate(child, exited);
        return { kind: 'failed', reason: error instanceof RunnerFailure ? error.reason : READ_FAILED };
      }
    }
  };

  let resumeFrom = 0;
  for (let launch = 0; ; launch += 1) {
    const result = await runLaunch(launch, resumeFrom);
    if (result.kind === 'cancelled') return { status: 'cancelled' };
    if (result.kind === 'failed') return { status: 'failed', reason: result.reason };
    if (result.kind === 'finish') break;
    resumeFrom = result.from;
  }
  return mergeOutcome(input, firstReady!, records);
}

// ---------------------------------------------------------------------------
// Resident mode (slice-8E2-SPEC W11).
// ---------------------------------------------------------------------------

export type ResidentAnalyzerOptions = {
  interpreter: string;
  script: string;
  /** argv[1] of the script; the script routes on it like `import_graph`. */
  mode: string;
  /** The first line written after every start. The script answers it with one
   * `ready` line, or `unavailable` (the analyzer cannot run on this machine), or
   * `failed` with a reason. */
  hello: unknown;
  /** Bound on one exchange, a start included; defaults to the batch unit timeout. */
  requestTimeoutMs?: number;
};
export type ResidentMessage = Record<string, unknown>;
/** What the caller does with one reply: write another line, or end the exchange. */
export type ResidentStep<T> = { send: unknown } | { done: T };
export type ResidentOutcome<T> =
  | { status: 'done'; value: T }
  /** The interpreter is missing (spawn ENOENT/EACCES) or the script answered `unavailable`. */
  | { status: 'unavailable' }
  /** Timeout, crash, unreadable output, a failed start, or the analyzer was closed. */
  | { status: 'failed'; reason: string };
export interface ResidentAnalyzer {
  /**
   * One request: writes `first`, then hands every reply line to `next` until it
   * returns `done`. Exchanges run one at a time in call order. The deadline covers
   * the whole exchange, `next` included; at the deadline, on a crash or on
   * unreadable output the process is killed and the exchange fails; the next
   * exchange starts a new process.
   */
  exchange<T>(first: unknown, next: (reply: ResidentMessage) => Promise<ResidentStep<T>>): Promise<ResidentOutcome<T>>;
  /** Ends the input so the script cleans up and exits, kills it after KILL_WAIT_MS if not; later exchanges fail without starting one. */
  close(): Promise<void>;
}

const CLOSED = '分析器已关闭';

type Resident = {
  child: ChildProcess; exited: Promise<ExitInfo>; queue: EventQueue; bytes: OutputBytes;
  pending: Promise<StdoutEvent> | null; gone: boolean; spawnError: NodeJS.ErrnoException | null;
};
type LineWait = { line: string } | { failure: string };

function residentMessage(line: string): ResidentMessage | null {
  try {
    const value = JSON.parse(line) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as ResidentMessage : null;
  } catch { return null; }
}

/**
 * The resident mode of this executor: at most one live process, started on first
 * use and again on the first use after any exit. The line cap is the batch one;
 * the total cap counts one exchange, since the process lives as long as its owner.
 */
export function createResidentAnalyzer(options: ResidentAnalyzerOptions): ResidentAnalyzer {
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_UNIT_TIMEOUT_MS;
  let live: Resident | null = null;
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();

  const send = (resident: Resident, message: unknown): void => {
    try { resident.child.stdin?.write(JSON.stringify(message) + '\n'); } catch { /* the read side reports the exit */ }
  };

  const nextLine = (resident: Resident, deadline: number): Promise<LineWait> => new Promise(resolve => {
    const timer = setTimeout(() => resolve({ failure: TIMEOUT }), Math.max(0, deadline - Date.now()));
    resident.pending ??= resident.queue.shift();
    void resident.pending.then(event => {
      resident.pending = null;
      clearTimeout(timer);
      if (event.kind === 'line') resolve({ line: event.line });
      else resolve({ failure: event.kind === 'error' ? event.reason : CRASHED });
    });
  });

  /** Kill, then classify: a spawn error decides over the symptom that surfaced it. */
  const fail = async (resident: Resident, reason: string): Promise<ResidentOutcome<never>> => {
    if (live === resident) live = null;
    await terminate(resident.child, resident.exited);
    const cause = resident.spawnError === null ? reason : spawnFailureReason(resident.spawnError);
    return cause === UNAVAILABLE ? { status: 'unavailable' } : { status: 'failed', reason: cause };
  };

  const start = async (deadline: number): Promise<{ resident: Resident } | { outcome: ResidentOutcome<never> }> => {
    let child: ChildProcess;
    try { child = spawnAnalyzer(options.interpreter, options.script, options.mode); }
    catch (error) {
      const reason = spawnFailureReason(error as NodeJS.ErrnoException);
      return { outcome: reason === UNAVAILABLE ? { status: 'unavailable' } : { status: 'failed', reason } };
    }
    const bytes: OutputBytes = { total: 0 };
    const resident: Resident = { child, exited: exitOf(child), bytes, pending: null, gone: false, spawnError: null,
      queue: child.stdout ? startReader(child.stdout, bytes) : new EventQueue() };
    child.once('error', error => { resident.spawnError = error as NodeJS.ErrnoException; });
    child.stdin?.on('error', () => { /* a child that exits early closes the pipe; the read side decides */ });
    void resident.exited.then(() => { resident.gone = true; });
    live = resident;
    send(resident, options.hello);
    const first = await nextLine(resident, deadline);
    if ('failure' in first) return { outcome: await fail(resident, first.failure) };
    const row = residentMessage(first.line);
    if (row?.['t'] === 'ready') return { resident };
    if (row?.['t'] === 'unavailable') return { outcome: await fail(resident, UNAVAILABLE) };
    if (row?.['t'] === 'failed' && typeof row['reason'] === 'string') return { outcome: await fail(resident, row['reason']) };
    return { outcome: await fail(resident, READ_FAILED) };
  };

  const run = async <T>(first: unknown, next: (reply: ResidentMessage) => Promise<ResidentStep<T>>): Promise<ResidentOutcome<T>> => {
    if (closed) return { status: 'failed', reason: CLOSED };
    const deadline = Date.now() + timeoutMs;
    let resident = live;
    if (resident !== null && resident.gone) { await fail(resident, CRASHED); resident = null; }
    if (resident === null) {
      const started = await start(deadline);
      if ('outcome' in started) return started.outcome;
      resident = started.resident;
    }
    resident.bytes.total = 0;
    let message = first;
    for (;;) {
      send(resident, message);
      const reply = await nextLine(resident, deadline);
      if ('failure' in reply) return fail(resident, reply.failure);
      const row = residentMessage(reply.line);
      if (row === null) return fail(resident, READ_FAILED);
      let timer: NodeJS.Timeout | undefined;
      // A `next` that throws leaves the script waiting for a line it will never get.
      const step = await Promise.race([
        next(row).then(value => ({ value }), () => ({ failure: READ_FAILED })),
        new Promise<{ failure: string }>(resolve => {
          timer = setTimeout(() => resolve({ failure: TIMEOUT }), Math.max(0, deadline - Date.now()));
        }),
      ]);
      clearTimeout(timer);
      if ('failure' in step) return fail(resident, step.failure);
      if ('done' in step.value) return { status: 'done', value: step.value.done };
      message = step.value.send;
    }
  };

  return {
    exchange<T>(first: unknown, next: (reply: ResidentMessage) => Promise<ResidentStep<T>>): Promise<ResidentOutcome<T>> {
      const result = tail.then(() => run(first, next));
      tail = result.catch(() => { /* each caller sees its own outcome */ });
      return result;
    },
    async close() {
      closed = true;
      const resident = live;
      live = null;
      if (resident === null) return;
      // End of input: the script leaves its loop and its own `finally`/`with` remove its temporary files.
      resident.child.stdin?.end();
      await Promise.race([resident.exited, sleep(KILL_WAIT_MS)]);
      await terminate(resident.child, resident.exited);
    },
  };
}
