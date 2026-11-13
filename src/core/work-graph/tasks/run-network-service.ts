/**
 * The owner of a Run's host record (`contracts/run-network.ts`, decision 121-112): the proxy notes each host before
 * it connects, and the `network/read` route and the unknown-call review draft read the record.
 *
 * A note's identity is (subject, host, port, verdict), so a repeat of an entry, from the same command or a later
 * proxy route of the same Run, replays the first receipt (`unchanged`) and never writes or counts twice. Only the
 * trusted Host writes: the proxy runs in the Host process.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import {
  RunNetworkFormat, RunNetworkHostNotedFormat, RunNetworkHostShape, RunNetworkRefShape,
  type RunNetworkHostV1, type RunNetworkRef, type RunNetworkSnapshotV1,
} from '../../../contracts/run-network.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../persistence/field-table-codec.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { nextRunNetwork } from '../state/run-network.js';
import { trustedContextOf } from './trusted-context.js';

export const runNetworkCodec = createRecordCodec(RunNetworkFormat);
export const runNetworkHostNotedCodec = createEventCodec(RunNetworkHostNotedFormat);
export const RUN_NETWORK_SCHEMAS = formatSchemas([runNetworkCodec, runNetworkHostNotedCodec]);

export interface RunNetworkPort {
  /** The proxy calls this before it connects; a repeat of an entry is `unchanged` and writes nothing. */
  noteRunNetworkHost(ctx: CoreCallContext, input: { subject: RunRef | QueryRunRef; entry: RunNetworkHostV1 }):
    Promise<WriteResult<{ outcome: 'created' | 'appended' | 'unchanged' }>>;
  /** The record of one Run or QueryRun of the caller's project; `null` when its commands asked the proxy nothing. */
  readRunNetwork(ctx: CoreCallContext, input: { subject: RunRef | QueryRunRef }):
    Promise<ReadResult<RunNetworkSnapshotV1 | null>>;
}

/** The subject when it is a complete RunRef or QueryRunRef, by the record ref's own field check. */
function subjectOf(value: unknown): RunRef | QueryRunRef | null {
  const ref = { aggregateType: 'RunNetwork', subject: value };
  return checkShape(RunNetworkRefShape, ref, 'stored') === null ? (ref as RunNetworkRef).subject : null;
}

export function createRunNetworkService(deps: {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'lookupCommit' | 'commit'>;
  now(): string;
  eventId(): string;
}): RunNetworkPort {
  /** The record, or null when the Run's commands asked the proxy nothing. */
  async function readCurrent(key: string) {
    const read = await readOwnerRecord({ store: deps.records, refKey: key, decode: runNetworkCodec.decode,
      readError: message => rejected('unavailable', `the RunNetwork read failed: ${message}`) });
    if (read.ok) return { ok: true as const, current: read.value };
    return 'notFound' in read ? { ok: true as const, current: null } : read;
  }

  return {
    async noteRunNetworkHost(ctx, input) {
      const trusted = trustedContextOf(ctx, {
        label: 'a RunNetwork write', reject: rejected, isSignal: signal => signal instanceof AbortSignal,
      });
      if (!trusted.ok) return trusted.rejection;
      const raw = input as unknown;
      const subject = isRecord(raw) ? subjectOf(raw['subject']) : null;
      if (subject === null) return rejected('invalid', 'noteRunNetworkHost requires a RunRef or QueryRunRef subject');
      const entryProblem = checkShape(RunNetworkHostShape, (raw as { entry?: unknown }).entry, 'stored');
      if (entryProblem !== null) return rejected('invalid', entryProblem);
      if (subject.projectId !== trusted.scope.projectId) return rejected('forbidden', 'the Run belongs to another project');
      const entry = input.entry;
      const ref: RunNetworkRef = { aggregateType: 'RunNetwork', subject };
      const key = canonicalJson(ref as unknown as JsonValue);
      // The command is "this triple was seen": address and time belong to the first sighting only.
      const identityKey = sha256Hex(canonicalJson({ kind: 'run-network-host', ref, host: entry.host, port: entry.port,
        verdict: entry.verdict } as unknown as JsonValue));
      const fingerprint = identityKey;
      const prior = await deps.records.lookupCommit({ identityKey, fingerprint });
      if (prior.status === 'ready') {
        return { status: 'committed', value: { outcome: 'unchanged' }, replayed: true, cursor: prior.value.cursor };
      }
      if (prior.code !== 'not_found') return storeFailureToRejection(prior);
      const read = await readCurrent(key);
      if (!read.ok) return read.rejection;
      const planned = nextRunNetwork(read.current, { subject, entry, at: deps.now() });
      // Every entry in the record was written under its own identity, which the lookup above would have found.
      if (!planned.changed) return rejected('unavailable', 'the RunNetwork record holds this entry without its receipt');
      const receipt = await deps.records.commit({
        identityKey, fingerprint,
        guards: [{ refKey: key, expectedRevision: read.current?.revision ?? null }],
        records: [runNetworkCodec.encode(planned.next)], claims: [], indexGuards: [], indexChanges: [],
        events: [runNetworkHostNotedCodec.encode({ eventId: deps.eventId(), eventType: 'RunNetworkHostNoted',
          schemaVersion: 1, occurredAt: planned.next.updatedAt, projectId: subject.projectId, ref,
          revision: planned.next.revision, entry })],
      });
      if (receipt.status !== 'committed') return storeFailureToRejection(receipt);
      const outcome = receipt.replayed ? 'unchanged' : read.current === null ? 'created' : 'appended';
      return { status: 'committed', value: { outcome }, replayed: receipt.replayed, cursor: receipt.cursor };
    },

    async readRunNetwork(ctx, input) {
      const raw = input as unknown;
      const subject = isRecord(raw) ? subjectOf(raw['subject']) : null;
      if (subject === null) return rejected('invalid', 'readRunNetwork requires a RunRef or QueryRunRef subject');
      if (subject.projectId !== ctx.projectId) return rejected('forbidden', 'the Run belongs to another project');
      const read = await readCurrent(canonicalJson({ aggregateType: 'RunNetwork', subject } as unknown as JsonValue));
      return read.ok ? { status: 'ready', value: read.current } : read.rejection;
    },
  };
}
