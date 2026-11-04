import { Worker } from 'node:worker_threads';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import { navigationItemsOf, type NavItemV1 } from './single-file-syntax.js';
import { configureTypeScriptProject, TYPESCRIPT_DEFAULT_LIB_FILE, type TypeScriptProjectConfiguration } from './typescript-source-query.js';
import { ProjectSourceFailure, sha256Text, SOURCE_ROOT } from './project-source-snapshot.js';
import { DEFAULT_WORKSPACE_LIMITS, type WorkspaceToolsHandle } from './workspace-tools.js';
import { REFERENCE_ANALYZER_ROLE, REFERENCE_ANALYZER_WORKER_URL, type FromReferenceWorker, type ReferenceWorkerFile,
  type ReferenceWorkerJob, type ReferenceWorkerQuestion, type ToReferenceWorker } from './reference-analyzer-worker.js';
import type { ReferenceAnalyzerPort, ReferenceAnswerV1, ReferenceCheckRequestV1, ReferenceCheckResultV1, ReferencePriority,
  ReferenceQuestionV1, WorkspaceFile, WorkspaceResult } from './ports.js';

/**
 * The second tier's reference analyzer (slice-8E2-SPEC W1–W9), main-thread side.
 *
 * Requests run one at a time (one program at a time), most urgent first, equal ones in arrival
 * order. Each request opens fresh reads with the ctx it received (the caller's platform identity):
 * it relists the workspace's project inputs, reads the files the previous request of this
 * workspace used that are still listed plus the request's own files in one batch, resolves the
 * configuration with `configureTypeScriptProject` (reading its `extends` chain as it asks), finds
 * every X by name (W5), and hands the rest to the one analysis thread, reading whatever files the
 * thread reports missing, one batch per round. A thread that dies answers `failed` for what it had
 * not answered and is started again on the next request; `close` stops it.
 */
export type ReferenceAnalyzerDependencies = {
  readWorkspaceFiles: WorkspaceToolsHandle['readWorkspaceFiles'];
  listWorkspaceInputs: WorkspaceToolsHandle['listWorkspaceInputs'];
};

const RANK: Readonly<Record<ReferencePriority, number>> = { write: 0, run_end: 1, button: 2, agent: 3, background: 4 };
const FAILED: ReferenceAnswerV1 = { status: 'failed' };
const rejected = <T>(code: 'invalid' | 'cancelled' | 'unavailable', reason: string): WorkspaceResult<T> => ({ status: 'rejected', code, reason });

type Read = Map<string, WorkspaceFile | null>;
type Running = { id: number; yieldable: boolean; onMessage(message: FromReferenceWorker): void; onExit(): void };
type Queued = { rank: number; order: number; start(): void };

/** `configureTypeScriptProject` over every listed path; remembers each path whose content it asked for and did not have. */
class ConfigurationTable extends Map<string, { readonly content?: string }> {
  readonly asked: string[] = [];
  override get(key: string): { readonly content?: string } | undefined {
    const entry = super.get(key);
    if (entry !== undefined) this.asked.push(key);
    return entry;
  }
}

const isQuestion = (value: unknown): value is ReferenceQuestionV1 => {
  const question = value as ReferenceQuestionV1 | null;
  return typeof question === 'object' && question !== null && typeof question.definition?.path === 'string' && typeof question.definition.name === 'string'
    && (question.definition.line === null || Number.isSafeInteger(question.definition.line)) && typeof question.evidence?.path === 'string'
    && (question.evidence.ranges === null || (Array.isArray(question.evidence.ranges)
      && question.evidence.ranges.every(range => Number.isSafeInteger(range?.startLine) && Number.isSafeInteger(range?.endLine))));
};

export function createReferenceAnalyzer(deps: ReferenceAnalyzerDependencies): ReferenceAnalyzerPort {
  const readWorkspaceFiles = deps.readWorkspaceFiles, listWorkspaceInputs = deps.listWorkspaceInputs;
  const queue: Queued[] = [];
  /** W3 prefetch: per workspace, the paths the last request used (main-thread memory, gone on restart). */
  const lastUsed = new Map<string, string[]>();
  let active: { rank: number; running: Running | null } | null = null;
  let worker: Worker | null = null;
  let running: Running | null = null;
  let nextId = 0, order = 0, closed = false;

  const post = (message: ToReferenceWorker) => worker?.postMessage(message);
  const startWorker = (): Worker => {
    const created = new Worker(new URL(REFERENCE_ANALYZER_WORKER_URL), { workerData: { role: REFERENCE_ANALYZER_ROLE } });
    created.on('message', (message: FromReferenceWorker) => { if (running?.id === message.id) running.onMessage(message); });
    created.on('error', () => {});
    created.on('exit', () => {
      if (worker !== created) return;
      worker = null;
      running?.onExit();
    });
    return created;
  };
  const pump = () => {
    if (active !== null || queue.length === 0) return;
    queue.sort((left, right) => left.rank - right.rank || left.order - right.order);
    queue.shift()!.start();
  };
  const schedule = <T>(priority: ReferencePriority, run: (slot: { running: Running | null }) => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const rank = RANK[priority];
      queue.push({ rank, order: order++, start: () => {
        const slot = { rank, running: null as Running | null };
        active = slot;
        run(slot).then(resolve, reject).finally(() => { active = null; pump(); });
      } });
      // W2: a waiting request more urgent than a running background one stops it between groups.
      if (active !== null && active.running?.yieldable === true && rank < active.rank) post({ type: 'preempt', id: active.running.id });
      pump();
    });

  /** Run one job on the thread; groups answered before a failure or a stop are kept, the rest stay unanswered. */
  const runOnWorker = (job: ReferenceWorkerJob, slot: { running: Running | null }, answered: (index: number, answers: (string | null)[]) => void,
    need: (names: string[]) => Promise<ReferenceWorkerFile[] | null>): Promise<string[] | null> =>
    new Promise(resolve => {
      worker ??= startWorker();
      worker.ref();
      const finish = (used: string[] | null) => { running = null; slot.running = null; worker?.unref(); resolve(used); };
      running = { id: job.id, yieldable: job.yieldable,
        onMessage: message => {
          if (message.type === 'need') void need(message.names).then(files => post({ type: 'files', id: job.id, files }), () => post({ type: 'files', id: job.id, files: null }));
          else if (message.type === 'group') answered(message.index, message.answers);
          else finish(message.type === 'done' ? message.used : null);
        },
        onExit: () => finish(null) };
      slot.running = running;
      post(job);
      // A more urgent request that arrived while this background one was still reading.
      if (job.yieldable && queue.some(waiting => waiting.rank < RANK.background)) post({ type: 'preempt', id: job.id });
    });

  async function verifyOne(ctx: CoreCallContext, request: ReferenceCheckRequestV1, slot: { running: Running | null }): Promise<WorkspaceResult<ReferenceCheckResultV1>> {
    if (closed) return rejected('cancelled', 'reference analyzer closed');
    if (ctx.signal.aborted) return rejected('cancelled', 'request cancelled');
    const workspace = request.workspace;
    const workspaceKey = JSON.stringify([workspace.projectId, workspace.workspaceId]);
    const listed = await listWorkspaceInputs(ctx, { workspace });
    if (listed.status !== 'ready') return listed;
    const inventory = new Set(listed.value.paths);
    const read: Read = new Map();
    const readBatch = async (paths: readonly string[]): Promise<WorkspaceResult<null>> => {
      const wanted = [...new Set(paths)].filter(path => inventory.has(path) && !read.has(path));
      if (wanted.length === 0) return { status: 'ready', value: null };
      const files = await readWorkspaceFiles(ctx, { workspace, paths: wanted, maxBytes: DEFAULT_WORKSPACE_LIMITS.maxFileBytes });
      if (files.status !== 'ready') return files;
      wanted.forEach((path, index) => { const file = files.value[index]!; read.set(path, file.status === 'ready' ? file.value : null); });
      return { status: 'ready', value: null };
    };
    const questionPaths = request.groups.flatMap(group => group.flatMap(question => [question.definition.path, question.evidence.path]));
    const first = await readBatch([...questionPaths, ...(lastUsed.get(workspaceKey) ?? [])]);
    if (first.status !== 'ready') return first;

    // W3: the configuration rule is the capture's; its `extends` chain is read as it asks for it.
    let configuration: TypeScriptProjectConfiguration | 'project_references' | 'unreadable';
    let chain: string[];
    for (;;) {
      const table = new ConfigurationTable([...inventory].map(path => {
        const file = read.get(path);
        return [SOURCE_ROOT + path, file ? { content: file.content } : {}] as const;
      }));
      const asked = () => [...new Set(table.asked)].map(key => key.slice(SOURCE_ROOT.length));
      try { configuration = configureTypeScriptProject(table); chain = asked(); break; }
      catch (error) {
        chain = asked();
        if (error instanceof ProjectSourceFailure && error.status === 'unsupported') { configuration = 'project_references'; break; }
        const unread = chain.filter(path => !read.has(path));
        if (unread.length === 0) {
          // A configuration file that cannot be read leaves the program unknowable: `failed`.
          if (chain.some(path => read.get(path) === null)) { configuration = 'unreadable'; break; }
          return rejected('unavailable', error instanceof Error ? error.message : String(error));
        }
        const more = await readBatch(unread);
        if (more.status !== 'ready') return more;
      }
    }
    const configPath = typeof configuration === 'string' ? chain[0] ?? null : configuration.resolvedConfigPath;
    const configFile = configPath === null ? undefined : read.get(configPath);
    const config = configPath === null || !configFile ? null : { path: configPath, digest: sha256Text(configFile.content) };
    const analysed = () => [...read].flatMap(([path, file]) => file ? [{ path, digest: file.digest }] : []);
    if (configuration === 'unreadable' || (configPath !== null && config === null))
      return { status: 'ready', value: { answers: request.groups.map(group => group.map(() => FAILED)), analysed: analysed(), config } };
    if (configuration === 'project_references') {
      const answer: ReferenceAnswerV1 = { status: 'unverifiable', reason: 'project_references' };
      return { status: 'ready', value: { answers: request.groups.map(group => group.map(() => answer)), analysed: analysed(), config } };
    }

    // W5 and the questions the main thread can answer without a program.
    const projectFiles = new Set(configuration.rootNames);
    const items = new Map<string, NavItemV1[]>();
    const answers: (ReferenceAnswerV1 | null)[][] = request.groups.map(group => group.map(() => null));
    const groups: (ReferenceWorkerQuestion | null)[][] = request.groups.map((group, groupIndex) => group.map((question, index) => {
      const decide = (value: ReferenceAnswerV1) => { answers[groupIndex]![index] = value; return null; };
      const { definition, evidence } = question;
      if (!inventory.has(definition.path) || !inventory.has(evidence.path)) return decide({ status: 'not_found' });
      const definitionFile = read.get(definition.path), evidenceFile = read.get(evidence.path);
      if (!definitionFile || !evidenceFile) return decide(FAILED);
      if (!projectFiles.has(SOURCE_ROOT + definition.path) || !projectFiles.has(SOURCE_ROOT + evidence.path))
        return decide({ status: 'unverifiable', reason: 'not_in_project' });
      let navigation = items.get(definition.path);
      if (navigation === undefined) { navigation = navigationItemsOf(definition.path, definitionFile.content); items.set(definition.path, navigation); }
      const named = navigation.filter(item => item.name === definition.name);
      if (named.length === 0) return decide({ status: 'not_found' });
      const chosen = named.length === 1 ? named[0] : named.find(item => definition.line !== null && item.start.line === definition.line);
      if (chosen === undefined) return decide(FAILED);
      return { evidence: SOURCE_ROOT + evidence.path, ranges: evidence.ranges, definition: SOURCE_ROOT + definition.path,
        line: chosen.start.line, column: chosen.start.column, name: definition.name };
    }));
    const result = (): WorkspaceResult<ReferenceCheckResultV1> => ({ status: 'ready', value: {
      answers: answers.map(group => group.map(answer => answer ?? FAILED)), analysed: analysed(), config } });
    if (groups.every(group => group.every(question => question === null))) return result();
    if (closed || ctx.signal.aborted) return result();

    const rootPaths = [...new Set(questionPaths)].filter(path => read.get(path));
    const files = (paths: Iterable<string>): ReferenceWorkerFile[] => [...paths].map(path => {
      const file = read.get(path);
      return file ? { name: SOURCE_ROOT + path, content: file.content, version: file.digest } : { name: SOURCE_ROOT + path, unreadable: true as const };
    });
    const job: ReferenceWorkerJob = { type: 'verify', id: nextId++, workspaceKey, options: configuration.options,
      currentDirectory: SOURCE_ROOT, defaultLibFileName: TYPESCRIPT_DEFAULT_LIB_FILE,
      roots: [...new Set([...rootPaths.map(path => SOURCE_ROOT + path), ...configuration.rootNames.filter(name => name.endsWith('.d.ts'))])],
      inventory: [...inventory].map(path => SOURCE_ROOT + path), files: files([...read.keys()].filter(path => read.get(path))), groups,
      yieldable: request.priority === 'background' };
    const used = await runOnWorker(job, slot, (groupIndex, worked) => {
      worked.forEach((answer, index) => {
        if (answer === null || answers[groupIndex]?.[index] !== null) return;
        answers[groupIndex]![index] = answer === 'found' ? { status: 'found' } : answer === 'not_found' ? { status: 'not_found' }
          : answer === 'undecided' ? { status: 'unverifiable', reason: 'undecided' } : FAILED;
      });
    }, async names => {
      if (closed || ctx.signal.aborted) return null;
      const paths = names.map(name => name.slice(SOURCE_ROOT.length));
      const more = await readBatch(paths);
      return more.status === 'ready' ? files(paths) : null;
    });
    if (used !== null) lastUsed.set(workspaceKey, [...new Set([...chain, ...questionPaths,
      ...used.map(name => name.slice(SOURCE_ROOT.length))])].filter(path => read.get(path)));
    return result();
  }

  return {
    verify(ctx, request) {
      if (closed) return Promise.resolve(rejected('cancelled', 'reference analyzer closed'));
      if (!request || typeof request !== 'object' || !request.workspace || request.workspace.aggregateType !== 'Workspace'
        || !Object.hasOwn(RANK, request.priority) || !Array.isArray(request.groups)
        || !request.groups.every(group => Array.isArray(group) && group.every(isQuestion)))
        return Promise.resolve(rejected('invalid', 'reference check request malformed'));
      return schedule(request.priority, slot => verifyOne(ctx, request, slot).catch(error => {
        if (ctx.signal.aborted || closed) return rejected<ReferenceCheckResultV1>('cancelled', 'request cancelled');
        return rejected<ReferenceCheckResultV1>('unavailable', error instanceof Error ? error.name + ': ' + error.message.slice(0, 200) : String(error));
      }));
    },
    async close() {
      closed = true;
      for (const waiting of queue.splice(0)) waiting.start();
      const stopping = worker;
      worker = null;
      if (stopping !== null) { await stopping.terminate(); running?.onExit(); }
    },
  };
}
