/**
 * The ONE trusted resolver for a running secretary QueryRun.
 *
 * It reads only the stored QueryRun named by the caller principal, that run's
 * execution state, its QueryJob, the Session the execution names, the manifest
 * the execution is bound to (for the Plan frozen at preparation) and the
 * manifest's frozen request materials, whose carrier Jobs are re-read for the
 * command each carries now; nothing comes from input. A refusal is `forbidden` when the caller is not a QueryRun
 * or names none that is stored, the QueryRun is not entered, it is not a
 * request round, the Session is a read-only copy, or the Session's duty, read
 * as ready, is not `secretary`. A failed or thrown read (of the store or of the
 * duty), a missing Session, QueryJob or carrier Job, an undecodable record, a damaged
 * binding (an absent `requestProfile` or `prepared`, a generation that is not
 * positive, a malformed Session ref), a request round whose QueryJob names
 * no request root and a bound manifest that cannot be read are `unavailable`: those facts
 * cannot be trusted, which is not a caller without the identity. A default
 * never stands in for a fact.
 *
 * The resolver lives in `tasks/` because it reads `queries/` and `sessions/`,
 * which `notes/` may not import (`docs/refactor/module-target.json`).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { SessionRefShape } from '../../../contracts/data-format-refs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { isPos } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { SecretaryQueryRunPort } from '../model/secretary-query-run-contracts.js';
import type { QueryExecutionDependencies } from '../queries/contracts.js';
import { currentUnderstandingMaterials, currentUnderstandingOperations, loadQueryManifest } from '../queries/query-execution.js';
import { decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import { readRequestRounds, type RequestRoundsStore } from '../queries/request-rounds-read.js';
import {
  decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { liveUnderstandingGrants } from '../state/request-rounds.js';
import { readOwnerRecord } from './owner-record-read.js';

export type SecretaryQueryRunDependencies = {
  /**
   * The full request-rounds store when a current carrier command exists, so the note-time
   * grant read takes the root owner from the one request-rounds read. A caller
   * that supplies only `readMany` gets `unavailable` rather than a second owner
   * derivation.
   */
  records: Pick<GoalRecordTransactionPort, 'readMany'>
    & Partial<Pick<RequestRoundsStore, 'eventAt' | 'lookup' | 'lookupOrdered'>>;
  duties: SessionDutyReadPort;
  /** The raw body store the bound manifest is read from (the Query execution's). */
  bodies: QueryExecutionDependencies['bodies'];
};

const unavailable = (reason: string): CoreRejection => rejected('unavailable', reason);

export function createSecretaryQueryRun(deps: SecretaryQueryRunDependencies): SecretaryQueryRunPort {
  return {
    async resolveSecretaryQueryRun(ctx: CoreCallContext) {
      const principal = ctx.principal;
      if (principal.kind !== 'query_run') {
        return rejected('forbidden', 'only a running QueryRun may write a secretary note');
      }
      const queryRunRef = principal.queryRunRef;

      // The one owner single-record read catches a thrown read; every failure
      // it reports (a thrown or failed read, an undecodable record) is
      // `unavailable` here. Its decoder also refuses a stored ref that is not
      // the key it was read by, so the run below is the principal's.
      const runRead = await readOwnerRecord({ store: deps.records, refKey: canonicalJson(queryRunRef as unknown as JsonValue),
        decode: decodeQueryRunSnapshotRecord, readError: unavailable });
      if (!runRead.ok) {
        return 'notFound' in runRead ? rejected('forbidden', 'the caller QueryRun is not the stored running round')
          : unavailable(`the QueryRun cannot be read: ${runRead.rejection.reason}`);
      }
      const run = runRead.value;

      const execution = run.run.executionState;
      if (execution === undefined || execution.phase !== 'entered') {
        return rejected('forbidden', 'the QueryRun is not entered');
      }
      if (execution.requestProfile === null || execution.prepared === null) {
        return rejected('forbidden', 'the QueryRun is not a secretary request round');
      }
      // The shared decoder leaves an absent `requestProfile` or `prepared` and
      // the generation unjudged and sees only that the Session ref is an
      // object; the binding this resolver hands on must be whole.
      if (execution.requestProfile === undefined || execution.prepared === undefined
        || !isPos(execution.sessionGeneration) || checkShape(SessionRefShape, execution.sessionRef, 'stored') !== null) {
        return unavailable('the QueryRun binding is damaged');
      }

      const sessionRef = execution.sessionRef;
      const sessionRead = await readOwnerRecord({ store: deps.records,
        refKey: sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef)), decode: decodeSessionRecord,
        readError: unavailable });
      if (!sessionRead.ok) {
        return unavailable('notFound' in sessionRead ? 'the round Session is missing'
          : `the round Session cannot be read: ${sessionRead.rejection.reason}`);
      }
      const session = sessionRead.value;
      if (session.provenance.kind === 'readonly_copy') {
        return rejected('forbidden', 'a read-only copy cannot write a secretary note');
      }

      let duty: Awaited<ReturnType<SessionDutyReadPort>>;
      try {
        duty = await deps.duties(session.role, ctx);
      } catch {
        return unavailable('the round Session duty cannot be read');
      }
      if (duty.status !== 'ready') return unavailable('the round Session duty cannot be read');
      if (duty.value !== 'secretary') return rejected('forbidden', 'the round Session is not the secretary duty');

      const jobRef = run.run.queryJobRef;
      const jobRead = await readOwnerRecord({ store: deps.records, refKey: canonicalJson(jobRef as unknown as JsonValue),
        decode: decodeQueryJobSnapshot, readError: unavailable });
      if (!jobRead.ok) {
        return unavailable('notFound' in jobRead ? 'the round QueryJob is not stored'
          : `the round QueryJob cannot be read: ${jobRead.rejection.reason}`);
      }
      const requestRoot = jobRead.value.job.requestRoot;
      if (requestRoot === null) return unavailable('the round QueryJob names no request root');

      // The Plan frozen at preparation is the bound manifest's `focusPlan`,
      // read through the one loader (owner, bytes, digest and shape checked).
      const bound = await loadQueryManifest(deps.bodies, { queryRunRef,
        bundleRef: execution.prepared.bundleRef, inputDigest: execution.prepared.inputDigest });
      if (bound.status !== 'ready') {
        return unavailable(`the round manifest cannot be read: ${'reason' in bound ? bound.reason : bound.status}`);
      }

      // The note-time grant set is the same live rule over the manifest's frozen
      // material list, re-reading each carrier Job in its frozen order and using
      // the command it carries now, judged against the current operation records
      // and the request root's current owner. A missing or damaged carrier or
      // operation is `unavailable`, never an empty set. The result is copied into
      // the mutable list the note owner consumes; the effective goal never comes
      // from it.
      const frozenRequest = bound.value.manifest.request;
      if (frozenRequest === null) return unavailable('the round manifest carries no request facts');
      const materialRead = await currentUnderstandingMaterials(deps, frozenRequest);
      if (materialRead.status !== 'ready') return materialRead;
      const goals: GoalRef[] = [];
      if (materialRead.materials.some((material) => material.command !== null)) {
        if (deps.records.eventAt === undefined || deps.records.lookup === undefined
          || deps.records.lookupOrdered === undefined) {
          return unavailable('the request rounds read is not available');
        }
        const store = deps.records as RequestRoundsStore;
        let requestFacts: Awaited<ReturnType<typeof readRequestRounds>>;
        try {
          requestFacts = await readRequestRounds(store, ctx, { requestRoot });
        } catch {
          return unavailable('the request rounds cannot be read');
        }
        if (requestFacts.status !== 'ready') return unavailable('the request rounds cannot be read');
        const operationRead = await currentUnderstandingOperations(deps, materialRead.materials, requestFacts.value.owner);
        if (operationRead.status !== 'ready') return operationRead;
        goals.push(...liveUnderstandingGrants({ materials: materialRead.materials, requestRoot,
          operations: operationRead.operations }));
      }

      return { status: 'ready', value: {
        principal,
        session: sessionRef,
        duty: 'secretary',
        scope: { projectId: run.ref.projectId, workspaceId: run.ref.workspaceId },
        round: jobRef,
        run: queryRunRef,
        effectiveGoalId: execution.prepared.requestEffectiveGoalId,
        planRef: bound.value.manifest.focusPlan === null ? null : bound.value.manifest.focusPlan.ref,
        requestRoot,
        sessionGeneration: execution.sessionGeneration,
        goals,
      } };
    },
  };
}
