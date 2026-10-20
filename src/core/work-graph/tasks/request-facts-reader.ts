/**
 * Slice 5 §2.6 request-facts seam (F26).
 *
 * The transitional `CandidateRequestFactsPort`: it is built from the saved
 * first-round QueryJob (its goal and initiator) and is replaced by the formal
 * root/current-secretary facts in slice 6. It reads only the existing QueryJob
 * record and, when the snapshot carries the formal submission locator, the
 * ORIGINAL `QueryJobSubmitted` event to recover the real actor. It creates no
 * Request aggregate and no table.
 *
 * Reading changes nothing (spec §4.2/rule 20): every path here is read-only.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { decodeQueryJobSnapshot, decodeQueryJobSubmittedEvent } from '../queries/query-record-codecs.js';
import type { CandidateRequestFactsPort } from '../model/decision-contracts.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function forbidden(reason: string): { status: 'rejected'; code: 'forbidden'; reason: string } {
  return { status: 'rejected', code: 'forbidden', reason };
}
function notFound(reason: string): { status: 'rejected'; code: 'not_found'; reason: string } {
  return { status: 'rejected', code: 'not_found', reason };
}
function unavailable(reason: string): { status: 'rejected'; code: 'unavailable'; reason: string } {
  return { status: 'rejected', code: 'unavailable', reason };
}
function sameActor(left: { kind: string; id: string }, right: { kind: string; id: string }): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/**
 * The one Store seam this transitional reader uses, the same instance every
 * other WorkGraph reader shares. It reads records/lookups only.
 */
export type CandidateRequestFactsReaderDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
};

/** Builds the transitional request-facts reader; slice 6 replaces only its facts. */
export function createCandidateRequestFactsReader(
  deps: CandidateRequestFactsReaderDependencies,
): CandidateRequestFactsPort {
  const { records } = deps;

  /** The trusted operator the bound context names, if any (Host/system principal). */
  function boundActor(ctx: CoreCallContext): { kind: string; id: string } | null {
    const principal = (ctx as unknown as { principal?: unknown }).principal;
    if (!isRecord(principal)) return null;
    if (principal['kind'] !== 'host' && principal['kind'] !== 'session') return null;
    const actor = principal['actor'];
    if (!isRecord(actor) || !nonEmpty(actor['id'])) return null;
    if (actor['kind'] !== 'human' && actor['kind'] !== 'system') return null;
    return { kind: actor['kind'], id: actor['id'] };
  }

  async function submittedActor(
    job: { submission: { identityKey: string; fingerprint: string } },
  ): Promise<{ kind: string; id: string } | null> {
    const receipt = await records.lookupCommit({ identityKey: job.submission.identityKey, fingerprint: job.submission.fingerprint });
    if (receipt.status !== 'ready') return null;
    const at = await records.eventAt(receipt.value.cursor);
    if (at.status !== 'ready') return null;
    const decoded = decodeQueryJobSubmittedEvent(at.value.event);
    if (decoded.status !== 'decoded') return null;
    const actor = decoded.value.actor;
    return { kind: actor.kind, id: actor.id };
  }

  return {
    async readCandidateRequestFacts(ctx: CoreCallContext, input: { requestRef: QueryJobRef; goalRef: GoalRef }) {
      if (input.requestRef.projectId !== ctx.projectId || input.requestRef.workspaceId !== ctx.workspaceId) {
        return forbidden('the request belongs to another project or workspace');
      }
      const key = canonicalJson(input.requestRef as unknown as JsonValue);
      let read: Awaited<ReturnType<GoalRecordTransactionPort['readMany']>>;
      try {
        read = await records.readMany([key]);
      } catch (error) {
        return unavailable(`the request facts could not be read: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return unavailable(`the request facts read failed: ${read.code}`);
      const record = read.value.records.find((candidate) => candidate.refKey === key);
      if (record === undefined) return notFound('the request QueryJob does not exist');
      const decoded = decodeQueryJobSnapshot(record);
      if (decoded.status !== 'decoded') return unavailable(`the request QueryJob is corrupt: ${decoded.reason}`);
      const job = decoded.value.job;
      // S5-PLAN-01 guard "request root 同 Goal": the saved QueryJob's Goal is the
      // candidate's Goal. A QueryJob of another Goal is never this request's root.
      const root = job.goalId === input.goalRef.goalId
        && job.projectId === input.goalRef.projectId && job.workspaceId === input.requestRef.workspaceId;
      // The real actor from the formal submission locator decides the operator
      // fact; an unreadable locator never guesses an operator.
      const actor = await submittedActor(decoded.value);
      const bound = boundActor(ctx);
      const initiatedByOperator = actor !== null && bound !== null && sameActor(actor, bound);
      const guards: readonly RecordGuard[] = [{ refKey: key, expectedRevision: record.revision }];
      return { status: 'ready' as const, value: { root, initiatedByOperator, currentSecretary: null, guards } };
    },
  };
}
