import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { DispatchIntentV1 } from '../../../contracts/dispatch.js';

/** Shared local capacity, with durable Control/Ledger admission inside each slot. */
export class ExecutionSlots {
  constructor(private readonly maxConcurrentRuns?: number) {}
  private readonly active = new Map<string, { workspace: string; readOnly: boolean }>();
  private readonly waiting: Array<{ key: string; workspace: string; readOnly: boolean; resolve: () => void }> = [];

  /** Local admission avoids predictable lease contention. Pending work stays in
   * the durable outbox until Control grants execution; ledger leases still fence
   * consumers in other processes. A waiting writer cannot be bypassed by readers. */
  async run<T>(intent: DispatchIntentV1, work: () => Promise<T>): Promise<T> {
    const key = canonicalJson(intent.runRef);
    const workspace = canonicalJson({ projectId: intent.projectId, workspaceId: intent.workspaceId });
    const p = intent.declaredPermissions;
    const readOnly = p.tools.length === 1 && p.tools[0] === 'read' && p.writeScope.length === 0;
    await new Promise<void>(resolve => {
      this.waiting.push({ key, workspace, readOnly, resolve });
      this.admitWaiting();
    });
    try { return await work(); } finally { this.active.delete(key); this.admitWaiting(); }
  }

  private admitWaiting(): void {
    const configured = this.maxConcurrentRuns;
    const limit = configured !== undefined && Number.isFinite(configured) ? Math.max(1, Math.min(32, Math.floor(configured))) : 2;
    const blocked = new Set<string>();
    for (let i = 0; i < this.waiting.length && this.active.size < limit;) {
      const candidate = this.waiting[i]!;
      const conflict = [...this.active.values()].some(run => run.workspace === candidate.workspace && (!run.readOnly || !candidate.readOnly));
      if (blocked.has(candidate.workspace) || conflict) {
        blocked.add(candidate.workspace); i++; continue;
      }
      this.waiting.splice(i, 1);
      this.active.set(candidate.key, candidate);
      candidate.resolve();
    }
  }

}
