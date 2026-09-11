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
    control: Pick<ControlEngine, 'runFact'>;
    outbox: DispatchPort;
    runtime: RuntimeReconciliationPort;
    now: () => string;
  }) {}

  drive(request: RuntimeDriveRequest) {
    const work = this.queue.then(async () => {
      const result = await this.deps.outbox.drive({ reason: request.reason });
      let failed = false;
      for (const failure of result.failures) {
        const entry = await this.deps.ledger.load(failure.outboxRef);
        if (entry.status === 'found' && sameRun((entry.snapshot as DispatchOutboxEntrySnapshot).intent.runRef, request.runRef)) failed = true;
      }
      const runtime = this.deps.runtime.all().find(record => sameRun(record.spec, request.runRef));
      if (failed || runtime?.status === 'outcome_unknown') {
        await this.deps.runtime.markUnknown(request.runRef);
        const loaded = await this.deps.ledger.load(request.runRef);
        if (loaded.status === 'found') {
          const run = loaded.snapshot as RunSnapshot;
          if (run.status !== 'ended' && run.envelope) {
            const receipt = await this.unknown(run, '派发或事件提交失败；未重跑外部执行');
            if (receipt.status !== 'committed') throw Error('派发失败对账未确认：' + JSON.stringify(receipt));
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
      if (run.status === 'ended' || run.envelope === null) continue;
      if (record.status === 'outcome_unknown' || record.status === 'prepared') {
        const receipt = await this.unknown(run, '宿主中断，未自动重跑；需核对工作区副作用');
        if (receipt.status === 'committed') result.recorded++;
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
