import type { CommitCursor } from '../../contracts/command-event.js';
import type { EventPage, GoalSnapshot, StateLedger } from '../../contracts/ledger.js';
import { seqOfCommitCursor } from '../../contracts/ledger.js';
import type { QueryJobRef, QueryJobSnapshot } from '../../contracts/query-job.js';
import type { CatalogScope, ScopeCatalogPort } from '../../contracts/scope-catalog.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

/** StateLedger read-only repository. The log discovers exact identities; load
 * supplies canonical records. This is not a ReadModel view and owns no business
 * reduction. A failed scan preserves its last complete page for safe retry. */
export class LedgerScopeCatalog implements ScopeCatalogPort {
  private cursor: CommitCursor | null = null;
  private readonly goalRefs = new Map<string, Required<CatalogScope>>();
  private readonly jobRefs = new Map<string, QueryJobRef>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly ledger: Pick<StateLedger, 'load' | 'events'>) {}

  private advance() {
    const work = this.queue.then(async () => {
      for (;;) {
        const page = await this.ledger.events({ afterCursor: this.cursor, limit: 256 });
        this.validatePage(page);
        for (const { event } of page.events) {
          if (event.eventType === 'GoalCreated') {
            const scope = { projectId: event.projectId, workspaceId: event.workspaceId, goalId: event.aggregateId };
            this.goalRefs.set(canonicalJson(scope), scope);
          }
          if (event.eventType === 'QueryJobSubmitted') {
            const job = event.payload.job;
            const ref: QueryJobRef = { aggregateType: 'QueryJob', projectId: job.projectId, workspaceId: job.workspaceId, queryJobId: job.queryJobId };
            this.jobRefs.set(canonicalJson(ref), ref);
          }
        }
        this.cursor = page.throughCursor;
        if (!page.hasMore) return;
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }

  private validatePage(page: EventPage) {
    if (page.afterCursor !== this.cursor || page.events.length > 256 || (page.hasMore && !page.events.length)) throw Error('invalid scope catalog event page');
    let sequence = this.cursor === null ? 0 : seqOfCommitCursor(this.cursor);
    for (const { cursor, event } of page.events) {
      if (seqOfCommitCursor(cursor) !== ++sequence) throw Error('noncontiguous scope catalog event page');
      if (event.eventType === 'QueryJobSubmitted' && (event.projectId !== event.payload.job.projectId ||
        event.workspaceId !== event.payload.job.workspaceId || event.aggregateId !== event.payload.job.queryJobId)) throw Error('scope catalog query identity mismatch');
    }
    if (page.throughCursor !== (page.events.at(-1)?.cursor ?? this.cursor)) throw Error('invalid scope catalog through cursor');
  }

  async goals(scope: CatalogScope): Promise<string[]> {
    await this.advance();
    const goals: string[] = [];
    for (const candidate of this.goalRefs.values()) {
      if (candidate.projectId !== scope.projectId || candidate.workspaceId !== scope.workspaceId) continue;
      const ref = { aggregateType: 'Goal' as const, projectId: candidate.projectId, goalId: candidate.goalId };
      const loaded = await this.ledger.load(ref);
      if (loaded.status !== 'found') continue;
      if (canonicalJson(loaded.snapshot.ref) !== canonicalJson(ref)) throw Error('scope catalog goal identity mismatch');
      const goal = loaded.snapshot as GoalSnapshot;
      if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) throw Error('scope catalog goal workspace mismatch');
      goals.push(candidate.goalId);
    }
    return goals;
  }

  async jobs(scope?: CatalogScope): Promise<QueryJobSnapshot[]> {
    await this.advance();
    const rows: QueryJobSnapshot[] = [];
    for (const ref of this.jobRefs.values()) {
      if (scope && (ref.projectId !== scope.projectId || ref.workspaceId !== scope.workspaceId)) continue;
      const loaded = await this.ledger.load(ref);
      if (loaded.status !== 'found') continue;
      if (canonicalJson(loaded.snapshot.ref) !== canonicalJson(ref)) throw Error('scope catalog query identity mismatch');
      const snapshot = loaded.snapshot as QueryJobSnapshot, job = snapshot.job;
      if (job.projectId !== ref.projectId || job.workspaceId !== ref.workspaceId || job.queryJobId !== ref.queryJobId) throw Error('scope catalog query scope mismatch');
      if (!scope?.goalId || job.goalId === scope.goalId) rows.push(snapshot);
    }
    return rows;
  }
}
