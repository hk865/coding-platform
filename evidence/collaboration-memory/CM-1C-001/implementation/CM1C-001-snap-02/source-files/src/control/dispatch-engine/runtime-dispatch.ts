import { randomUUID } from 'node:crypto';
import type { StateLedger } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { DispatchOutboxEntrySnapshot, RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { DispatchPort } from '../../contracts/ports.js';
import type { RuntimeReconciliationPort } from '../../contracts/runtime-preparation.js';
import type { DispatchScope, RuntimeDispatchPort, RuntimeDriveRequest, RecoveryResult } from '../../contracts/runtime-dispatch.js';
import { buildRunFactCommand } from '../../contracts/commands/dispatch.js';

export class RuntimeDispatch implements RuntimeDispatchPort {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: {
    ledger: Pick<StateLedger, 'load'>;
    control: Pick<ControlEngine, 'runFact'> & Partial<Pick<ControlEngine, 'reconcileRun'>>;
    outbox: DispatchPort;
    runtime: RuntimeReconciliationPort;
    now: () => string;
  }) {}

  drive(request: RuntimeDriveRequest) {
    const work = this.queue.then(async () => {
      const result = await this.deps.outbox.drive({ reason: request.reason });
      let failed = false;
      for (const failure of result.failures) {
        if (failure.effect === 'none') continue;
        const entry = await this.deps.ledger.load(failure.outboxRef);
        if (entry.status === 'found' && sameRun((entry.snapshot as DispatchOutboxEntrySnapshot).intent.runRef, request.runRef)) failed = true;
      }
      /**
       * CM-1A-001 第 4 步 B 缺陷修复：**已经结束的 Run 不允许被派发/旁路失败改写终态**。
       *
       * 两类失败都在这里被挡住：
       *   · 旁路事实失败（模型调用许可/证据）根本不进 `result.failures`（见 DispatchSideFactFailure），
       *     因此不会产生 `failed`；
       *   · 即便 `failed` 为真（或本地观测记录是 outcome_unknown），只要 canonical Run **已经 ended**，
       *     就既不改写本地观测记录、也不写 outcome_unknown 事实——Run 的终态是权威事实，
       *     不能因为一次旁路事实没落账而被降级成"未知"。
       * 未结束的 Run 仍按既有语义对账（markUnknown + outcome_unknown）：这条既有反例没有放宽。
       */
      const canonicalRun = await this.deps.ledger.load(request.runRef);
      const runEnded = canonicalRun.status === 'found' && (canonicalRun.snapshot as RunSnapshot).status === 'ended';
      const runtime = this.deps.runtime.all().find(record => sameRun(record.spec, request.runRef));
      if (!runEnded && (failed || runtime?.status === 'outcome_unknown')) {
        await this.deps.runtime.markUnknown(request.runRef);
        const loaded = await this.deps.ledger.load(request.runRef);
        if (loaded.status === 'found') {
          const run = loaded.snapshot as RunSnapshot;
          if (run.status !== 'ended' && run.envelope) {
            const receipt = await this.unknown(run, '派发或事件提交失败；未重跑外部执行');
            if (receipt.status !== 'committed') throw Error('派发失败对账未确认：' + JSON.stringify(receipt));
            await this.reconcileRecordedUnknown(run.ref);
          }
        }
      }
      return result;
    });
    this.queue = work.catch(() => {});
    return work;
  }

  async recover(scopes: readonly DispatchScope[]): Promise<RecoveryResult> {
    const result: RecoveryResult = { recorded: 0, rejected: [] };
    for (const record of this.deps.runtime.all()) {
      if (record.spec.mode === 'review') continue;
      if (!scopes.some(scope => scope.projectId === record.spec.projectId && scope.workspaceId === record.spec.workspaceId)) continue;
      const ref: RunRef = { aggregateType: 'Run', projectId: record.spec.projectId, goalId: record.spec.goalId, runId: record.spec.runId };
      const loaded = await this.deps.ledger.load(ref);
      if (loaded.status !== 'found') continue;
      const run = loaded.snapshot as RunSnapshot;
      if (run.status === 'ended') {
        if (run.outcome === 'outcome_unknown') await this.reconcileRecordedUnknown(ref, result);
        continue;
      }
      if (run.controlState?.desiredState === 'cancelled' && record.status === 'prepared' && record.events.length === 0) {
        if (!this.deps.runtime.cancel) { result.rejected.push({ runRef: ref, receipt: 'Runtime cancellation recovery is not connected' }); continue; }
        await this.deps.runtime.cancel(ref);
        const refreshed = this.deps.runtime.all().find(r => sameRun(r.spec, ref));
        if (refreshed) { record.status = refreshed.status; record.events = refreshed.events; }
      }
      if (run.executionAuthorization?.phase === 'authorized' && run.controlState?.desiredState !== 'cancelled') {
        const a = run.executionAuthorization;
        const receipt = await this.deps.control.runFact(buildRunFactCommand({ ...this.identity(ref.projectId),
          actor: { kind: 'system', id: 'runtime-reconciliation' }, runId: ref.runId, expectedRevision: run.revision,
          fact: { kind: 'execution_retry', runRef: ref, generation: a.generation, consumerId: a.consumerId,
            reason: 'Unconsumed execution authorization was atomically revoked before any Runtime entry' } }));
        if (receipt.status === 'committed') { result.recorded++; (result.scheduledRetries ??= []).push(ref); }
        else result.rejected.push({ runRef: ref, receipt });
        continue;
      }
      if (run.envelope === null && record.events.length === 0) continue;
      if (record.status === 'outcome_unknown' || record.status === 'prepared') {
        const receipt = await this.unknown(run, '宿主中断，未自动重跑；需核对工作区副作用');
        if (receipt.status === 'committed') { result.recorded++; await this.reconcileRecordedUnknown(ref, result); }
        else result.rejected.push({ runRef: ref, receipt });
        continue;
      }
      let revision = run.revision;
      for (const event of record.events.filter(event => event.sequence > run.lastEventSeq)) {
        const receipt = await this.deps.control.runFact(buildRunFactCommand({
          ...this.identity(ref.projectId), runId: ref.runId, expectedRevision: revision, fact: { kind: 'runtime_event', event },
        }));
        if (receipt.status !== 'committed') { result.rejected.push({ runRef: ref, receipt }); break; }
        revision = receipt.runRevision;
        result.recorded++;
        if (receipt.terminal) break;
      }
    }
    return result;
  }

  private async reconcileRecordedUnknown(ref: RunRef, result?: RecoveryResult): Promise<void> {
    if (!this.deps.control.reconcileRun) return;
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== 'found') return;
    const id = 'reconcile-' + ref.runId + '-r' + loaded.snapshot.revision;
    const receipt = await this.deps.control.reconcileRun({ commandId: id, commandType: 'ReconcileRun', schemaVersion: 1,
      identity: { projectId: ref.projectId, actor: { kind: 'system', id: 'runtime-reconciliation' }, idempotencyKey: id },
      aggregateId: ref.runId, expectedRevision: loaded.snapshot.revision, correlationId: id, submittedAt: this.deps.now(), payload: { runRef: ref } });
    if (receipt.status === 'rejected' && receipt.code !== 'duplicate_event') {
      if (result) result.rejected.push({ runRef: ref, receipt });
      else throw Error('Unknown execution reconciliation was not recorded: ' + receipt.code);
      return;
    }
    if (result && receipt.status === 'committed') result.recorded++;
    const current = await this.deps.ledger.load(ref);
    if (result && current.status === 'found' && (current.snapshot as RunSnapshot).reconciliation?.status === 'quarantined') (result.quarantined ??= []).push(ref);
  }

  private unknown(run: RunSnapshot, reason: string) {
    return this.deps.control.runFact(buildRunFactCommand({
      ...this.identity(run.ref.projectId), runId: run.ref.runId, expectedRevision: run.revision,
      fact: { kind: 'outcome_unknown', runRef: run.ref, reason },
    }));
  }

  private identity(projectId: string) {
    // Preserve the identity used by persisted pre-migration recovery commands.
    return { projectId, actor: { kind: 'human' as const, id: 'user-1' }, commandId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(), submittedAt: this.deps.now() };
  }
}

function sameRun(a: { projectId: string; goalId: string; runId: string }, b: RunRef) {
  return a.projectId === b.projectId && a.goalId === b.goalId && a.runId === b.runId;
}
