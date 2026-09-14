import { RuntimeObservationJournal } from '../../data/artifact-vault/runtime-observation-journal.js';
import type { RuntimeObservationSource } from '../../contracts/runtime-observations.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, realpath, lstat, copyFile, open, unlink } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { RunPort, RunHandle } from '../../contracts/ports.js';
import type { RuntimeEventV1, RunRef } from '../../contracts/dispatch.js';
import type { ModelClientPort, AgentEvent } from '../../../vendor/coding-agent/dist/public-api.js';
import { assembleRuntimeContext, RuntimeContextError, type RuntimeContextAccess, type RuntimeContextAssembly } from '../../data/context-compiler/runtime-context.js';
import { reviewerSourcePathAllowed } from '../../data/workspace-reader/reviewer-source-reader.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { ModelBudget, ContextCapacityExceeded, type ModelInputCounter, type RuntimeBudget, type MeterEntry } from './model-budget.js';
import { runObservedModel } from './observed-model-run.js';
import { createReviewerMaterialTools } from './reviewer-material-tools.js';
import { COORDINATION_TOOL_NAMES, createCoordinationTools } from './coordination-tools.js';
import type { CoordinationCapabilityGrantV1 } from '../../contracts/coordination-tools.js';
import type { RunSpec } from '../../contracts/runtime-preparation.js';
export type { RunSpec } from '../../contracts/runtime-preparation.js';
export type BoundModel = { configuration: { revision: string; provider: string; model: string; baseUrl: string }; client: ModelClientPort; inputCounter?: ModelInputCounter };
export type RuntimeRecord = { context?: RuntimeContextAssembly; spec: RunSpec; createdAt?: string; status: 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_exhausted' | 'outcome_unknown'; sessionId: string; configuration: BoundModel['configuration'] | null; events: RuntimeEventV1[]; trace: Array<{ type: string; sequence: number; at: string; data: unknown }>; usage: MeterEntry[]; error: string | null; nodeSha256: string | null; workspaceRevision: string | null; cancelRequested: boolean;
  /**
   * 本次运行被授予的**协调能力**及其账本依据（协作通信协议约束 2.3；可审计的持久记录）。
   *
   * 旧记录没有这一项 → `undefined`：表示"没有这条授予记录"，**不回填、不推断**；
   * 是否可用协调工具永远以执行前的准入（canonical 事实）为准，不看本地记录。
   */
  coordinationCapability?: CoordinationCapabilityGrantV1 };
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const keyFor = (r: RunRef | RunSpec) => hash(JSON.stringify([r.projectId, r.goalId, r.runId]));
const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(a as never) === canonicalJson(b as never);
function validateReviewSpec(spec: RunSpec) {
  if (spec.mode !== 'review') {
    if (spec.review) throw Error('普通运行不能携带审阅授权');
    return;
  }
  const review = spec.review, profile = review?.profile;
  if (!review || review.workRef.aggregateType !== 'ReviewWork' || !profile || profile.schemaVersion !== 1 || profile.mode !== 'review'
      || review.workRef.projectId !== spec.projectId || review.workRef.workspaceId !== spec.workspaceId || review.workRef.goalId !== spec.goalId
      || profile.subjectScope.projectId !== spec.projectId || profile.subjectScope.workspaceId !== spec.workspaceId || profile.subjectScope.goalId !== spec.goalId
      || profile.subjectScope.taskId !== spec.taskId || profile.subjectScope.runId === spec.runId
      || !same(profile.permissions, { tools: ['read'], writeScope: [] }) || !same(profile.budget, spec.budget)) {
    throw Error('审阅运行缺少独立工作、精确只读配置或原任务绑定');
  }
}
function checkReviewModel(spec: RunSpec, configuration: BoundModel['configuration']) {
  if (spec.mode !== 'review') return;
  const expected = spec.review!.profile.model;
  if (configuration.revision !== expected.configurationRevision || configuration.provider !== expected.provider
      || configuration.model !== expected.model || configuration.baseUrl !== expected.baseUrl) {
    throw new RuntimeSetupError('审阅模型配置已变化；未使用新配置继续旧审阅。');
  }
}
function compareRecords(a: RuntimeRecord, b: RuntimeRecord): number {
  const occurredAt = (r: RuntimeRecord) => {
    for (const value of [r.createdAt, r.events[0]?.occurredAt, r.trace[0]?.at]) {
      if (!value) continue;
      const time = Date.parse(value); if (Number.isFinite(time)) return time;
    }
    return Infinity;
  };
  const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
  const first = occurredAt(a), second = occurredAt(b);
  if (first !== second) return first < second ? -1 : 1;
  return compareText(a.spec.runId, b.spec.runId) || compareText(keyFor(a.spec), keyFor(b.spec));
}
class RuntimeSetupError extends Error {}
export async function prepareRuntimeWorkspace(root: string): Promise<string> {
  const runtimeDir = join(root, '.platform-runtime');
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const info = await lstat(runtimeDir); if (!info.isDirectory() || info.isSymbolicLink()) throw Error('运行环境目录非法');
  await mkdir(join(runtimeDir, 'bin'), { recursive: true });
  if ((await lstat(join(runtimeDir, 'bin'))).isSymbolicLink()) throw Error('运行环境不能使用链接');
  const node = join(runtimeDir, 'bin/node');
  const digest = createHash('sha256').update(await readFile(process.execPath)).digest('hex');
  try { const nodeInfo = await lstat(node); if (!nodeInfo.isFile() || nodeInfo.isSymbolicLink() || createHash('sha256').update(await readFile(node)).digest('hex') !== digest) throw Error('已有运行环境不匹配'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await copyFile(process.execPath, node); }
  return digest;
}
export class CodingAgentRuntime implements RunPort {
  private closing = false;
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void>; wake: (() => void) | null }>();
  private readonly records = new Map<string, RuntimeRecord>();
  private readonly journal: RuntimeObservationJournal<RuntimeRecord>;
  readonly observations: RuntimeObservationSource<RuntimeRecord>;
  private kernel!: typeof import('../../../vendor/coding-agent/dist/public-api.js');
  constructor(private readonly directory: string, private readonly bind: (runId: string) => Promise<BoundModel>, private readonly deniedRoots: string[] = []) {
    this.journal = new RuntimeObservationJournal(directory, { keyFor: r => keyFor(r.spec), serialize: r => JSON.stringify(r) + '\n', writeOrder: 'per_record', compare: compareRecords });
    this.observations = this.journal.observations;
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.kernel = await import(pathToFileURL(resolve(import.meta.dirname, '../../../vendor/coding-agent/dist/public-api.js')).href) as typeof this.kernel;
    for (const r of await this.journal.init()) {
      this.records.set(keyFor(r.spec), r);
      if (r.status === 'running') { r.status = 'outcome_unknown'; r.error = '宿主服务中断；工作区副作用须核对，未自动重跑。'; await this.save(r); }
    }
  }
  private save(r: RuntimeRecord) {
    return this.journal.save(r);
  }
  all() {
    return [...this.records.values()].sort(compareRecords).map(r => structuredClone(r));
  }
  async preflight(spec: RunSpec) {
    if (this.closing) throw Error('执行器正在关闭，不能接受新的运行');
    validateReviewSpec(spec);
    const root = await realpath(spec.root);
    for (const denied of this.deniedRoots) {
      const d = resolve(denied); if (root === d || root.startsWith(d + sep) || d.startsWith(root + sep)) throw Error('请选择独立项目目录；运行工作区不能包含平台、验收材料或凭据目录');
    }
    if (root === '/' || root !== spec.root) throw Error('运行目录必须是已登记的真实项目路径');
    const existing = this.records.get(keyFor(spec));
    if (existing) { if (JSON.stringify(existing.spec) !== JSON.stringify(spec)) throw Error('同一运行请求的内容已改变'); return; }
    // Reject stale workspace locks, including another GUI data directory using this checkout.
    try { await lstat(join(root, '.platform-runtime/run.lock')); throw Error('工作区存在运行或未对账的中断记录'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const bound = await this.bind(spec.runId); // Fail before claim if unconfigured; bind actual version again at start.
    checkReviewModel(spec, bound.configuration);
  }
  async prepare(spec: RunSpec) {
    await this.preflight(spec);
    if (this.records.has(keyFor(spec))) return;
    const r: RuntimeRecord = { spec, createdAt: new Date().toISOString(), status: 'prepared', sessionId: randomUUID(), configuration: null, events: [], trace: [], usage: [], error: null, nodeSha256: null, workspaceRevision: null, cancelRequested: false };
    this.records.set(keyFor(spec), r); await this.save(r);
  }
  bindModel(runId: string) { return this.bind(runId); }
  capabilities() { return Promise.resolve({ replayable: false, supportsSnapshot: false, maxEnvelopeBytes: 65536 }); }
  async start(envelope: TaskEnvelopeV1, context?: RuntimeContextAccess): Promise<RunHandle> {
    if (this.closing) throw Error('执行器正在关闭，不能开始运行');
    const key = keyFor(envelope.runRef), r = this.records.get(key);
    if (!r || r.spec.taskId !== envelope.taskId || r.spec.workspaceId !== envelope.workspaceId) throw Error('真实运行缺少已登记的任务');
    if (r.spec.mode !== undefined && context?.coordination !== undefined) throw Error('只读探索或独立审阅不能接收协调写入口');
    validateReviewSpec(r.spec);
    const readOnly = !envelope.permissions.tools.some(tool => tool === 'write' || tool === 'shell');
    if (envelope.permissions.tools.some(tool => !['read', 'write', 'shell'].includes(tool)) ||
        (readOnly ? envelope.permissions.writeScope.length !== 0 : !envelope.permissions.writeScope.includes('*')) ||
        ((r.spec.mode === 'explore' || r.spec.mode === 'review') && (!readOnly || envelope.permissions.tools.length !== 1 || envelope.permissions.tools[0] !== 'read'))) throw Error('真实运行权限与任务模式不符');
    if (r.spec.mode === 'review') {
      if (!same(envelope.work, { kind: 'review', reviewWorkRef: r.spec.review!.workRef }) || !envelope.reviewInput
          || !same(envelope.roleBinding, r.spec.review!.profile.roleBinding)) throw Error('审阅信封与已登记工作不匹配');
    } else if (envelope.work || envelope.reviewInput) throw Error('普通运行不能使用审阅信封');
    if (r.status === 'outcome_unknown') throw Error('运行结果未知，需要先核对工作区');
    if (r.status === 'prepared' && !this.active.has(key)) {
      const controller = new AbortController();
      const entry = { controller, done: Promise.resolve(), wake: null as (() => void) | null };
      this.active.set(key, entry);
      entry.done = this.execute(r, envelope, controller, context).catch(() => { r.status = 'outcome_unknown'; r.error = '运行记录未能完整保存，请核对工作区；未自动重跑。'; }).finally(() => { entry.wake?.(); this.active.delete(key); });
    }
    let cursor = 0;
    /**
     * 协作通信可靠投递规则 / 调用证据与参与语义规则：**调用证据**面。
     *
     * 摘要在**实际 stream(request) 边界**算出（ModelBudget.wrap 对最终 outgoing 请求算的
     * inputDigest），这里只把它连同这次运行的 Context 摘要（RuntimeContextManifest.inputDigest）
     * 一起交出去；真正的落账由消费者经 control.runFact 走正式事实通道完成。
     * 取走即推进游标：同一份证据不会被消费两次（去重语义仍在账本上，这里只是不重复投递）。
     */
    let evidenceCursor = 0;
    return {
      runRef: envelope.runRef,
      pollFreshEvents: async () => {
        while (cursor >= r.events.length && this.active.has(key)) await new Promise<void>(resolve => { const active = this.active.get(key); if (active) active.wake = resolve; else resolve(); });
        const events = r.events.slice(cursor); cursor = r.events.length; return events;
      },
      pollModelRequestEvidence: async () => {
        const contextInputDigest = r.context?.manifest.inputDigest ?? "";
        const drafts = r.usage
          .filter(entry => typeof entry.inputDigest === "string" && entry.inputDigest.length === 64)
          .map(entry => ({ requestId: entry.requestId, requestDigest: entry.inputDigest!, contextInputDigest }));
        const fresh = drafts.slice(evidenceCursor);
        evidenceCursor = drafts.length;
        return structuredClone(fresh);
      },
    };
  }
  async markUnknown(ref: RunRef) {
    const r = this.records.get(keyFor(ref)); if (!r) return;
    r.status = 'outcome_unknown'; r.error = '派发或记录未完整确认，请核对工作区；未自动重跑。'; await this.save(r);
  }
  async rejectBeforeStart(envelope: TaskEnvelopeV1, message: string): Promise<RunHandle> {
    const key = keyFor(envelope.runRef), record = this.records.get(key);
    if (!record || record.status !== 'prepared' || this.active.has(key) || record.events.length || record.trace.length) throw Error('无法证明运行尚未启动，必须对账');
    record.status = 'failed';
    record.error = '执行前材料校验失败：' + message;
    await this.event(record, envelope, 'run_crashed', { kind: 'crashed', error: record.error });
    let delivered = false;
    return { runRef: envelope.runRef, pollFreshEvents: async () => {
      if (delivered) return [];
      delivered = true;
      return structuredClone(record.events);
    },
    // 这个句柄只投递"可证明未启动"的失败：没有模型调用，因此没有调用证据可交（空数组）。
    pollModelRequestEvidence: async () => [] };
  }
  async cancel(ref: RunRef) {
    const r = this.records.get(keyFor(ref)); if (!r) throw Error('运行不存在');
    if (r.status !== 'running' && r.status !== 'prepared') return { status: r.status };
    r.cancelRequested = true; await this.save(r);
    if (r.status === 'prepared' && !this.active.has(keyFor(ref)) && r.events.length === 0 && r.trace.length === 0) {
      r.status = 'cancelled'; r.error = '运行在执行前被取消，未调用模型或工具。';
      await this.event(r, { runRef: ref }, 'run_cancelled', { kind: 'cancelled', reason: r.error });
      return { status: 'cancelled', events: structuredClone(r.events) };
    }
    this.active.get(keyFor(ref))?.controller.abort('user_cancel'); return { status: 'cancel_requested' };
  }
  async close() { this.closing = true; for (const a of this.active.values()) a.controller.abort('server_shutdown'); await Promise.all([...this.active.values()].map(a => a.done)); await this.journal.flush(); }
  private async event(r: RuntimeRecord, envelope: Pick<TaskEnvelopeV1, 'runRef'>, eventType: RuntimeEventV1['eventType'], payload: RuntimeEventV1['payload']) {
    const sequence = r.events.length + 1; r.events.push({ schemaVersion: 1, eventId: `${r.sessionId}-${sequence}`, runRef: envelope.runRef, sequence, occurredAt: new Date().toISOString(), eventType, payload });
    await this.save(r); this.active.get(keyFor(r.spec))?.wake?.();
  }
  private async execute(r: RuntimeRecord, envelope: TaskEnvelopeV1, controller: AbortController, context?: RuntimeContextAccess) {
    const readOnly = !envelope.permissions.tools.some(tool => tool === 'write' || tool === 'shell');
    const reviewer = r.spec.mode === 'review' ? context?.reviewer : undefined;
    const assertReviewCurrent = async () => {
      if (r.spec.mode !== 'review') return;
      try {
        if (!reviewer || !same(reviewer.profile, r.spec.review!.profile) || !same(reviewer.input, envelope.reviewInput)
            || !same(reviewer.packet.workRef, r.spec.review!.workRef)) throw Error('审阅运行缺少精确绑定的当前材料');
        await reviewer.assertCurrent();
      } catch (error) {
        controller.abort('review_material_changed');
        throw new RuntimeContextError('stale_review_material', error instanceof Error ? error.message : '审阅材料当前资格无法确认');
      }
    };
    const runtimeDir = join(r.spec.root, '.platform-runtime'); let lock = false; let timer: ReturnType<typeof setTimeout> | undefined; let meter: ModelBudget | undefined;
    try {
      r.status = 'running'; await this.save(r);
      await this.event(r, envelope, 'run_started', { kind: 'started', startedAt: new Date().toISOString() });
      if (r.cancelRequested) controller.abort('user_cancel');
      if (controller.signal.aborted) throw Error('cancelled');
      await assertReviewCurrent();
      r.context = await assembleRuntimeContext(r.spec, envelope, context); await this.save(r);
      if (context?.modelCalls) await context.modelCalls.bind({ inputDigest: r.context.manifest.inputDigest,
        manifestDigest: createHash('sha256').update(canonicalJson(r.context.manifest as never)).digest('hex'),
        materialAccessRefs: context.materials?.deliveryGrantRefs ?? [] });
      await assertReviewCurrent();
      if (!readOnly) await mkdir(runtimeDir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        await this.finishFailure(r, envelope, controller, false, error instanceof Error ? error.message : '运行输入绑定失败'); return;
      }
    }
    try {
      if (!readOnly) {
      if (!(await lstat(runtimeDir)).isDirectory() || (await lstat(runtimeDir)).isSymbolicLink()) throw Error('运行环境目录非法');
      const handle = await open(join(runtimeDir, 'run.lock'), 'wx', 0o600); lock = true; await handle.writeFile(r.sessionId); await handle.close();
      r.nodeSha256 = await prepareRuntimeWorkspace(r.spec.root);
      }
      const deniedPrefixes = ['.evaluator', '.oracle', 'hidden-tests', '.git', '.env', '.env.local', '.platform-runtime'];
      const ws = await this.kernel.WorkspaceSandbox.create(r.spec.root, { deniedPrefixes });
      const profile = await this.kernel.ProcessSandbox.probe(r.spec.root, ws);
      if (!profile.available) throw new RuntimeSetupError('隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。');
      const processSandboxOptions = readOnly ? {} : { readOnlyPaths: ['.platform-runtime'], executablePath: '/workspace/.platform-runtime/bin:/usr/bin:/bin' };
      // Exploration exposes no process or edit tool; its durable state lives outside the source workspace.
      if (!readOnly) {
        const sandbox = new this.kernel.ProcessSandbox(profile, r.spec.root, ws, processSandboxOptions);
        const probe = await sandbox.execute({ command: 'node --version', cwd: '.', timeoutMs: 5000, outputLimitBytes: 1000, signal: controller.signal });
        if (probe.exitCode !== 0) throw new RuntimeSetupError('沙箱 Node 不可用：请检查隔离工作区中的 Node 运行环境；模型尚未调用。');
      }
      r.workspaceRevision = (await ws.captureBaseline()).revision;
      const bound = await this.bind(r.spec.runId);
      checkReviewModel(r.spec, bound.configuration);
      r.configuration = bound.configuration; await this.save(r);
      meter = new ModelBudget(r.spec.budget, async entries => { r.usage = structuredClone(entries); await this.save(r); }, bound.inputCounter);
      const remainingMs = Math.min(r.spec.budget.timeoutMs ?? Infinity, envelope.budget.deadline ? Date.parse(envelope.budget.deadline) - Date.now() : Infinity);
      if (remainingMs <= 0) { controller.abort('deadline'); throw Error('deadline'); }
      if (Number.isFinite(remainingMs)) timer = setTimeout(() => controller.abort('deadline'), remainingMs);
      // 协调 Host 工具：只有宿主（Dispatch 的运行时适配器）在执行前**授予了协调能力**、
      // 并随授予给出访问面时才注入（`coordination` 只能作为 granted 的一部分出现）。
      // 它们**不读也不写**模型的工作区，副作用经 Host Adapter 落在平台 canonical 状态上
      // （见 coordination-tools.ts 与 contracts/coordination-tools.ts 的边界说明）。
      const coordination = context?.coordination;
      if (coordination !== undefined) {
        // 可审计记录：这个 Run 以哪条 canonical 依据被授予了协调能力（协议约束 2.3）。
        r.coordinationCapability = structuredClone(coordination.grant);
        await this.save(r);
      }
      const result = await runObservedModel({
        kernel: this.kernel, bound, meter, root: r.spec.root, databasePath: join(this.directory, keyFor(r.spec) + '.sqlite'),
        sessionId: r.sessionId, input: r.context!.input, budget: r.spec.budget, readOnly, allowedTools: envelope.permissions.tools,
        signal: controller.signal, deniedPrefixes, processSandboxOptions,
        ...(context?.materials?.assertCurrent ? { assertMaterialsCurrent: context.materials.assertCurrent } : {}),
        ...(context?.modelCalls ? { modelCalls: context.modelCalls,
          manifestDigest: createHash('sha256').update(canonicalJson(r.context!.manifest as never)).digest('hex') } : {}),
        ...(coordination === undefined ? {} : {
          coordinationTools: {
            names: COORDINATION_TOOL_NAMES,
            create: () => createCoordinationTools(coordination.access, async () => {
              if (controller.signal.aborted) throw Error('运行已取消，协调工具不再发起新的正式命令');
            }),
          },
        }),
        ...(reviewer ? {
          sourceTools: { includeReadSource: true, allowedPath: reviewerSourcePathAllowed, assertCurrent: assertReviewCurrent },
          materialTools: () => createReviewerMaterialTools(reviewer, assertReviewCurrent),
        } : {}),
        publish: async event => { r.trace.push(event); try { await this.save(r); } catch { controller.abort('evidence_write_failed'); } },
      });
      await assertReviewCurrent();
      if (controller.signal.aborted || result.state.status !== 'completed' || r.trace.some(event => event.type === 'tool.outcome_unknown')) { await this.finishFailure(r, envelope, controller, result.state.outcome?.kind === 'limit_exceeded' || meter.exhausted); }
      else { r.status = 'completed'; await this.event(r, envelope, 'run_completed', { kind: 'completed', exitCode: 0 }); }
    } catch (error) { await this.finishFailure(r, envelope, controller, meter?.exhausted ?? false, error instanceof RuntimeSetupError || error instanceof RuntimeContextError || error instanceof ContextCapacityExceeded ? error.message : undefined); }
    finally { if (timer) clearTimeout(timer); if (lock && r.status !== 'outcome_unknown') await unlink(join(runtimeDir, 'run.lock')).catch(() => {}); }
  }
  private async finishFailure(r: RuntimeRecord, e: TaskEnvelopeV1, controller: AbortController, budget: boolean, contextError?: string) {
    const exhausted = budget || controller.signal.reason === 'deadline' || (r.spec.budget.maxRequests !== null && r.usage.length >= r.spec.budget.maxRequests);
    if (controller.signal.reason === 'evidence_write_failed' || r.trace.some(event => event.type === 'tool.outcome_unknown')) {
      r.status = 'outcome_unknown'; r.error = '工具副作用或运行记录未能确认；保留工作区锁，请核对后再继续。'; await this.save(r);
    } else if (controller.signal.reason === 'user_cancel' || controller.signal.reason === 'server_shutdown') {
      r.status = 'cancelled'; r.error = '运行已取消；已有修改保留，尚未验收。'; await this.event(r, e, 'run_cancelled', { kind: 'cancelled', reason: r.error });
    } else if (exhausted) { r.status = 'budget_exhausted'; r.error = '预算或时间耗尽，或用量未知；未自动重试。'; await this.event(r, e, 'run_budget_exhausted', { kind: 'budget_exhausted', exhaustedAt: new Date().toISOString() }); }
    else { r.status = 'failed'; r.error = contextError ?? '真实执行失败，请检查模型配置、工作区隔离和运行记录。'; await this.event(r, e, 'run_crashed', { kind: 'crashed', error: r.error }); }
  }
}
