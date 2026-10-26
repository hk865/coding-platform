/**
 * The one too-long rule and the one reader of the shared basis.
 *
 * `secretaryHandoffBasis` is the pure table: `tooLong = usage !== null && inputTokens >= threshold`, with
 * `threshold = min(SECRETARY_HANDOFF_INPUT_TOKENS, floor(0.8 × contextWindowTokens))`. The caller gives the profile's
 * real window; there is no unknown-window branch and no zero default.
 *
 * `readSecretaryHandoffBasis` pages one ordered index (`S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP`) to its end through
 * the one complete ordered reader, newest generation first, and inside each run walks the model requests last-to-first
 * until one reports `inputTokens`. It returns the run and request index the usage came from and the ordered read's
 * watermark. `run`/`requestIndex` are `null` only when there is no usage at all; `readThrough` is `null` only for an
 * empty ledger. A read failure or a damaged QueryRun is a rejection (`unavailable`), never "not too long".
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { SECRETARY_HANDOFF_INPUT_TOKENS } from '../model/request-contracts.js';
import type { SecretaryHandoffBasisV1 } from '../model/secretary-lifecycle-contracts.js';
import { readAllOrdered } from '../persistence/lookup-ordered-all.js';
import {
  decodeQueryRunSnapshotRecord, S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
} from '../queries/query-record-codecs.js';

/**
 * The pure table: `tooLong = usage !== null && inputTokens >= threshold`. `readThrough` is the reader's watermark,
 * unchanged.
 */
export function secretaryHandoffBasis(input: {
  contextWindowTokens: number;
  usage: { inputTokens: number; run: QueryRunRef; requestIndex: number } | null;
  readThrough: CommitCursor | null;
}): SecretaryHandoffBasisV1 {
  const threshold = Math.min(SECRETARY_HANDOFF_INPUT_TOKENS,
    Math.floor(0.8 * input.contextWindowTokens));
  const usage = input.usage;
  return {
    tooLong: usage !== null && usage.inputTokens >= threshold,
    threshold,
    lastInputTokens: usage === null ? null : usage.inputTokens,
    run: usage === null ? null : usage.run,
    requestIndex: usage === null ? null : usage.requestIndex,
    readThrough: input.readThrough,
  };
}

/** The basis over the Session's QueryRuns; every failure is `unavailable`, never an empty or "not too long" basis. */
export async function readSecretaryHandoffBasis(
  records: Pick<RecordOrderedLookupPort, 'lookupOrdered'>,
  scope: WorkspaceScope,
  session: SessionRef,
  contextWindowTokens: number,
): Promise<ReadResult<SecretaryHandoffBasisV1>> {
  type OrderedAll = Awaited<ReturnType<typeof readAllOrdered>>;
  let read: OrderedAll;
  try {
    read = await readAllOrdered(records, { index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
      values: [scope.projectId, scope.workspaceId, session.sessionId], direction: 'desc' });
  } catch (error) {
    return { status: 'rejected', code: 'unavailable',
      reason: `the Session QueryRuns could not be read: ${messageOf(error)}` };
  }
  if (read.status !== 'ready') {
    return { status: 'rejected', code: 'unavailable',
      reason: `the Session QueryRuns read failed: ${read.code}: ${read.reason}` };
  }
  for (const record of read.value.records) {
    const decoded = decodeQueryRunSnapshotRecord(record);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `a Session QueryRun is damaged: ${decoded.reason}` };
    }
    const run = decoded.value;
    if (run.ref.workspaceId !== scope.workspaceId) continue;
    const requests = run.run.executionState?.requests ?? [];
    for (let index = requests.length - 1; index >= 0; index -= 1) {
      const tokens = requests[index]!.inputTokens;
      if (tokens === null) continue;
      return { status: 'ready', value: secretaryHandoffBasis({ contextWindowTokens,
        usage: { inputTokens: tokens, run: run.ref, requestIndex: index },
        readThrough: read.value.readThrough }) };
    }
  }
  return { status: 'ready', value: secretaryHandoffBasis({
    contextWindowTokens, usage: null, readThrough: read.value.readThrough }) };
}
