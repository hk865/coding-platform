import type { StateLedger } from '../../contracts/ledger.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { PreparedRunFact } from '../../contracts/runtime-preparation.js';
import { DurableWake } from './durable-wake.js';

/** Discover post-run work from saved observations and canonical terminal facts.
 * Every invocation may replay: feedback and verification own their durable
 * identities. This local coalescer is never a completion checkpoint. */
export class TerminalContinuation {
  private readonly wake = new DurableWake();
  constructor(private readonly deps: {
    records: () => PreparedRunFact[];
    scopes: () => readonly { projectId: string; workspaceId: string }[];
    ledger: Pick<StateLedger, 'load'>;
    continue: (record: PreparedRunFact) => Promise<void>;
  }) {}
  scan(): Promise<void> {
    return this.wake.request('terminal-runs', async () => {
      const scopes = this.deps.scopes(), failures: unknown[] = [];
      // Read observations once per pass, not once for every terminal candidate.
      for (const record of this.deps.records()) {
        if (record.spec.mode || ['prepared', 'running', 'outcome_unknown'].includes(record.status)) continue;
        if (!scopes.some(s => s.projectId === record.spec.projectId && s.workspaceId === record.spec.workspaceId)) continue;
        try {
          const loaded = await this.deps.ledger.load({ aggregateType: 'Run', projectId: record.spec.projectId, goalId: record.spec.goalId, runId: record.spec.runId });
          if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'Run') continue;
          const run = loaded.snapshot as RunSnapshot;
          if (run.status !== 'ended' || run.outcome === 'outcome_unknown' || run.workspaceSnapshot.workspaceId !== record.spec.workspaceId) continue;
          await this.deps.continue(record);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Terminal continuations require reconciliation; durable records retained');
    });
  }
  close(): Promise<void> { return this.wake.close(); }
}
