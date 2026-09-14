import { RuntimeObservationJournal } from '../../data/artifact-vault/runtime-observation-journal.js';
import type { RuntimeObservationSource } from '../../contracts/runtime-observations.js';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as kernel from '../../../vendor/coding-agent/dist/public-api.js';
import type { BoundModel } from './coding-agent-runtime.js';
import { ModelBudget, type MeterEntry, type RuntimeBudget } from './model-budget.js';
import { runObservedModel } from './observed-model-run.js';
import type { ReadOnlyQueryPort, ReadOnlyQueryResultV1, QueryRunRef } from '../../contracts/query-job.js';
import type { QueryExecutionMaterialPort } from '../../contracts/query-execution-context.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

type Request = Parameters<ReadOnlyQueryPort['startQuery']>[0];
export type QueryRuntimeRecord = {
  id: string; runRef: QueryRunRef; fingerprint: string; sessionId: string; status: 'running' | 'completed' | 'failed' | 'outcome_unknown';
  kind: string; goalId?: string | null; roleBinding: unknown; input: string; inputDigest: string; budget: RuntimeBudget;
  configuration: BoundModel['configuration'] | null; usage: MeterEntry[];
  trace: Array<{ type: string; sequence: number; at: string; data: unknown }>;
  sourceBefore: string | null; sourceAfter: string | null; result: ReadOnlyQueryResultV1 | null;
  /** Added for new records; old durable results are replayed without execution. */
  deadline?: string | null;
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
/** Source witnesses come from successful public tool results, not model text. */
function readWitnesses(record: QueryRuntimeRecord) {
  const calls=new Map<string,string>();
  for(const event of record.trace) if(event.type==='tool.started') {
    const call=(event.data as {call?:{callId:string;name:string;arguments?:{path?:string}}}).call;
    if(call?.name==='read' && typeof call.arguments?.path==='string') calls.set(call.callId,call.arguments.path);
  }
  const witnesses=[];
  for(const event of record.trace) if(event.type==='tool.completed') {
    const data=event.data as {callId:string;result?:{status:string;output?:Array<{kind:string;value?:{path?:string;revision?:string;truncated?:boolean;utf8Bytes?:number;startLine?:number;endLine?:number;totalLines?:number;totalLinesKnown?:boolean}}>}};
    if(data.result?.status!=='success' || !calls.has(data.callId)) continue;
    const metadata=data.result.output?.find(x=>x.kind==='json' && x.value?.path===calls.get(data.callId))?.value;
    if(metadata?.revision && metadata.truncated===false) witnesses.push({kind:metadata.utf8Bytes===0 && metadata.startLine===1 && metadata.totalLinesKnown===true && metadata.endLine===metadata.totalLines?'workspace_read_empty':'workspace_read',refKey:metadata.path!,version:metadata.revision});
  }
  return [...new Map(witnesses.map(w=>[canonicalJson(w),w])).values()].slice(0,32);
}

/** Runs on a separate kernel session and readonly tool set. It neither polls nor
 * modifies an implementation Run, and does not take its workspace write lease. */
export class ReadOnlyQueryRuntime implements ReadOnlyQueryPort {
  private closing = false;
  private readonly cancelled = new Set<string>();
  private readonly starting = new Map<string, { fingerprint: string; done: Promise<ReadOnlyQueryResultV1> }>();
  private readonly records = new Map<string, QueryRuntimeRecord>();
  private readonly active = new Map<string, { controller: AbortController; done: Promise<ReadOnlyQueryResultV1> }>();
  private readonly journal: RuntimeObservationJournal<QueryRuntimeRecord>;
  readonly observations: RuntimeObservationSource<QueryRuntimeRecord>;
  constructor(private readonly directory: string, private readonly deps: {
    materials: QueryExecutionMaterialPort; rootFor: (projectId: string, workspaceId: string) => string;
    bind: (runId: string) => Promise<BoundModel>;
  }) {
    this.journal = new RuntimeObservationJournal(directory, { keyFor: record => record.id, serialize: record => JSON.stringify(record), writeOrder: 'global' });
    this.observations = this.journal.observations;
  }
  async init() {
    for (const record of await this.journal.init()) {
      if (record.status === 'running') { record.status = 'outcome_unknown'; await this.save(record); }
      this.records.set(record.id, record);
    }
  }
  all() { return structuredClone([...this.records.values()]); }
  capabilities() { return { supported: true, readOnly: true as const, maxQuestionBytes: 4096, maxAnswerBytes: 16384 }; }
  async close() { this.closing = true; for (const run of this.active.values()) run.controller.abort('host_shutdown'); await Promise.allSettled([...this.starting.values()].map(run => run.done)); }
  private save(record: QueryRuntimeRecord) {
    return this.journal.save(record);
  }
  async cancelQuery(runRef: QueryRunRef): Promise<void> {
    this.cancelled.add(canonicalJson(runRef));
    const work: Promise<ReadOnlyQueryResultV1>[] = [];
    for (const [id, active] of this.active) {
      if (canonicalJson(this.records.get(id)?.runRef ?? null) !== canonicalJson(runRef)) continue;
      active.controller.abort('cancelled'); work.push(active.done);
    }
    await Promise.allSettled(work);
  }
  async inspectQuery(request: Request): Promise<Awaited<ReturnType<NonNullable<ReadOnlyQueryPort['inspectQuery']>>>> {
    const id = sha(canonicalJson([request.runRef, request.bundleRef.digest]));
    const starting = this.starting.get(id);
    if (starting?.fingerprint === sha(canonicalJson(request))) return { status: 'active' };
    const record = this.journal.read(id);
    if (!record || record.fingerprint !== sha(canonicalJson(request))) return { status: 'unavailable', message: 'No durable result matches the exact query request.' };
    if (this.active.has(id)) return { status: 'active' };
    if (record.result) return { status: 'result', result: structuredClone(record.result) };
    return { status: 'unavailable', message: 'Prior query ended without a durable result; external outcome is unknown.' };
  }
  async startQuery(request: Request): Promise<ReadOnlyQueryResultV1> {
    const id = sha(canonicalJson([request.runRef, request.bundleRef.digest]));
    const fingerprint = sha(canonicalJson(request)), prior = this.starting.get(id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error('query runtime idempotency conflict');
      return prior.done;
    }
    const done = this.startPreparedQuery(request).finally(() => this.starting.delete(id));
    this.starting.set(id, { fingerprint, done });
    return done;
  }
  private async startPreparedQuery(request: Request): Promise<ReadOnlyQueryResultV1> {
    const fingerprint = sha(canonicalJson(request)), id = sha(canonicalJson([request.runRef, request.bundleRef.digest]));
    const existing = this.records.get(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Error('query runtime idempotency conflict');
      if (this.active.has(id)) return this.active.get(id)!.done;
      const persisted = this.journal.read(id);
      if (persisted?.result) return structuredClone(persisted.result);
      return this.failure(request, 'failed', 'Prior query process ended without a durable result; no implicit restart.');
    }
    const material = await this.deps.materials.assemble(request);
    if (material.status !== 'ready') {
      if (material.code === 'unavailable') return this.failure(request, 'gap', material.message);
      throw Error(material.message);
    }
    if (this.closing || this.cancelled.has(canonicalJson(request.runRef))) return this.failure(request, 'failed', 'Query cancellation was already requested.');
    const { input, budget, kind, goalId, roleBinding, deadline } = material;
    const record: QueryRuntimeRecord = { id, runRef: request.runRef, fingerprint, sessionId: randomUUID(), status: 'running', kind, goalId, roleBinding,
      input, inputDigest: sha(input), budget, deadline, configuration: null, usage: [], trace: [], sourceBefore: null, sourceAfter: null, result: null };
    this.records.set(id, record); await this.save(record);
    const controller = new AbortController();
    if (this.closing || this.cancelled.has(canonicalJson(request.runRef))) controller.abort('cancelled');
    const done = this.execute(request, record, controller).finally(() => this.active.delete(id)); this.active.set(id, { controller, done }); return done;
  }
  private failure(request: Request, outcome: 'failed' | 'gap' | 'timeout', message: string): ReadOnlyQueryResultV1 {
    return { schemaVersion: 1, runRef: request.runRef, outcome, answer: null, sources: [], message, endedAt: new Date().toISOString() };
  }
  private async execute(request: Request, record: QueryRuntimeRecord, controller: AbortController): Promise<ReadOnlyQueryResultV1> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (controller.signal.aborted) throw Error('Query cancellation was already requested.');
      const root = this.deps.rootFor(request.runRef.projectId, request.runRef.workspaceId);
      const deniedPrefixes = ['.evaluator', '.oracle', 'hidden-tests', '.git', '.env', '.env.local', '.platform-runtime'];
      const workspace = await kernel.WorkspaceSandbox.create(root, { deniedPrefixes });
      record.sourceBefore = (await workspace.captureBaseline()).revision;
      const bound = await this.deps.bind(request.runRef.runId); record.configuration = bound.configuration; await this.save(record);
      const meter = new ModelBudget(record.budget, async usage => { record.usage = structuredClone(usage); await this.save(record); }, bound.inputCounter);
      const deadline = record.deadline ?? null;
      const remaining = Math.min(record.budget.timeoutMs ?? Infinity, deadline ? Date.parse(deadline) - Date.now() : Infinity);
      if (remaining <= 0) { controller.abort('deadline'); throw Error('deadline'); }
      if (Number.isFinite(remaining)) timer = setTimeout(() => controller.abort('deadline'), remaining);
      const result = await runObservedModel({ kernel, bound, meter, root, databasePath: join(this.directory, record.id + '.sqlite'), sessionId: record.sessionId,
        input: record.input, budget: record.budget, readOnly: true, signal: controller.signal, deniedPrefixes, processSandboxOptions: {},
        publish: async event => { record.trace.push(event); try { await this.save(record); } catch { controller.abort('evidence_write_failed'); } } });
      record.sourceAfter = (await workspace.captureBaseline()).revision;
      if (controller.signal.aborted || result.state.status !== 'completed') throw Error(controller.signal.reason === 'deadline' ? 'deadline' : 'Read-only model run did not complete.');
      const last = record.trace.filter(event => event.type === 'assistant.message_completed').at(-1)?.data as { message?: { content?: string } } | undefined;
      const answer = last?.message?.content;
      if (!answer?.trim() || Buffer.byteLength(answer) > 16384) throw Error('Query final answer is missing or exceeds the report bound.');
      if (record.sourceBefore !== record.sourceAfter) record.result = this.failure(request, 'gap', 'Source changed during analysis; result is not current.');
      else record.result = { schemaVersion: 1, runRef: request.runRef, outcome: 'answered', answer, sources: [
        { kind: 'artifact', refKey: request.bundleRef.digest, version: request.bundleRef.digest },
        { kind: 'workspace_source', refKey: canonicalJson({ projectId: request.runRef.projectId, workspaceId: request.runRef.workspaceId }), version: record.sourceAfter }, ...readWitnesses(record)], message: null, endedAt: new Date().toISOString() };
    } catch (error) { record.result = this.failure(request, controller.signal.reason === 'deadline' ? 'timeout' : 'failed', error instanceof Error ? error.message : 'Read-only run failed.'); }
    finally { if (timer) clearTimeout(timer); }
    record.status = record.result!.outcome === 'answered' ? 'completed' : 'failed'; await this.save(record); return structuredClone(record.result!);
  }
}
