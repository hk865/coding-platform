import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../contracts/core/identity.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import { rejected } from '../../contracts/core/rejections.js';
import { messageOf } from '../../contracts/error-message.js';
import type { RoleLimitsPort } from '../work-graph/sessions/role-limits-service.js';
import type { SessionDirectoryPort } from '../work-graph/model/session-contracts.js';
import type { ExecutionReadPort } from '../work-graph/model/execution-read-contracts.js';
import type { QueryExecutionPort } from '../work-graph/queries/contracts.js';
import { plainSessionRefKey } from '../work-graph/sessions/session-record-codecs.js';
import { admitModelCall, countRunningAdmission, runningGroupOf,
  type RunningAdmissionPhase, type RunningGroup } from '../work-graph/state/running-admission.js';

export type ModelAdmissionInput = {
  projectId: string;
  duty: PlatformDutyV1 | 'unknown';
  ref: RunRef | QueryRunRef;          // the waiting call's identity; never a stored counter
  kind: 'run' | 'query';
};
export type RunningAdmissionGrant = { status: 'admitted'; release(): void };
export type ModelAdmissionResult = RunningAdmissionGrant | CoreRejection;

export type ModelAdmissionDependencies = {
  limits: Pick<RoleLimitsPort, 'readRoleLimits'>;
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  queries: Pick<QueryExecutionPort, 'readQueryExecution'>;
  /** The one Session-duty resolver (`composition/session-duty.ts:51`), never a second role/template map. */
  dutyOfRole: (role: RoleConfigurationRef, ctx?: CoreCallContext) =>
    Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;
};
export interface ModelAdmissionPort {
  /** Counts under the per-(project, group) lock and returns the hold the caller releases after `begin`. */
  admitModelCall(ctx: CoreCallContext, input: ModelAdmissionInput): Promise<ModelAdmissionResult>;
}

export function createModelAdmission(deps: ModelAdmissionDependencies): ModelAdmissionPort {
  const tails = new Map<string, Promise<void>>();   // in-memory lock only, no persisted counter

  async function acquire(key: string): Promise<() => void> {
    const previous = tails.get(key) ?? Promise.resolve();
    let open!: () => void;
    const held = new Promise<void>(resolve => { open = resolve; });
    const next = previous.then(() => held);
    tails.set(key, next);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      open();
      if (tails.get(key) === next) tails.delete(key);
    };
  }

  function readProblem(result: { status: 'not_found' } | { status: 'not_ready' } | CoreRejection,
    what: string): CoreRejection {
    if (result.status === 'rejected') return result;
    return result.status === 'not_found'
      ? rejected('not_found', `${what} was not found`)
      : rejected('unavailable', `${what} is not readable at the required watermark`);
  }

  /** Rebuild-by-phase on every call: no cached count, so a Host restart needs no seed. */
  async function runningCountOf(ctx: CoreCallContext, projectId: string): Promise<ReadResult<Record<RunningGroup, number>>> {
    const entries: { duty: PlatformDutyV1 | 'unknown'; phase: RunningAdmissionPhase }[] = [];
    // D-10: pages by the last card's Session key, never the directory cursor: a cursor binds the ledger head, so a
    // commit between two pages answers `source_stale` (session-directory.ts:1954–:1955).
    let afterSessionKey: string | undefined;
    for (;;) {
      const found = await deps.sessions.findSessions(ctx, {
        workspace: { projectId }, includeArchived: false,
        page: { limit: 200, ...(afterSessionKey === undefined ? {} : { afterSessionKey }) },
      });
      if (found.status !== 'ready') return readProblem(found, 'the Session list for the running cap');
      for (const card of found.value.items) {
        afterSessionKey = plainSessionRefKey(card.record.ref);
        const occupancy = card.record.occupancy;
        if (occupancy === null || occupancy.kind !== 'execution') continue;
        // The card's own workspace, with the original Host identity and signal (ruling :548–:550).
        const sessionCtx = { ...ctx, workspaceId: card.record.workspaceId };
        const duty = await deps.dutyOfRole(card.record.role, sessionCtx);
        if (duty.status !== 'ready') return readProblem(duty, 'the Session duty');
        const ref = occupancy.executionRef;
        if (ref.aggregateType === 'Run') {
          const run = await deps.executions.readExecution(sessionCtx, ref);
          if (run.status !== 'ready') return readProblem(run, 'the Run phase');
          entries.push({ duty: duty.value, phase: run.value.run.executionAuthorization?.phase });
        } else {
          const query = await deps.queries.readQueryExecution(sessionCtx, ref);
          if (query.status !== 'ready') return readProblem(query, 'the Query phase');
          entries.push({ duty: duty.value, phase: query.value.run.run.executionState?.phase });
        }
      }
      if (found.value.nextCursor === null) break;
    }
    return { status: 'ready', value: countRunningAdmission(entries) };   // A1a-01: the one pure count
  }

  return {
    async admitModelCall(ctx, input) {
      const group = runningGroupOf(input.duty);
      const release = await acquire(`${input.projectId}\u0000${group}`);
      let done = false;
      const releaseOnce = (): void => { if (!done) { done = true; release(); } };
      try {
        const limits = await deps.limits.readRoleLimits(ctx, { projectRef: { projectId: input.projectId } });
        if (limits.status !== 'ready') { releaseOnce(); return readProblem(limits, 'the project role limits'); }
        const counts = await runningCountOf(ctx, input.projectId);
        if (counts.status !== 'ready') { releaseOnce(); return readProblem(counts, 'the running count'); }
        const verdict = admitModelCall({ duty: input.duty, limits: limits.value.running, counts: counts.value });
        if (verdict.status !== 'admitted') { releaseOnce(); return verdict; }
        return { status: 'admitted', release: releaseOnce };
      } catch (error) {
        releaseOnce();
        return rejected('unavailable', `the running admission failed: ${messageOf(error)}`);
      }
    },
  };
}
