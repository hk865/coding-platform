/**
 * Kernel Turn facts reader.
 *
 * Decodes the genuine original Kernel SessionRecords returned by the Session
 * history owner and reduces ONE fixed Turn (the locator's runId/turnId) with the
 * public Kernel reducer. The Work observer reads through it; Run reconciliation
 * and the continuation brief are to share the same reader, so a decoded record
 * and a reduced Turn mean the same thing everywhere. It only reads: it never
 * writes a platform fact and never decides a terminal.
 */
import { createInitialRunState, reduceRunState, sessionRecordSchema } from '../../../vendor/coding-agent/dist/public-api.js';
import type { RunState, SessionRecord as KernelSessionRecord } from '../../../vendor/coding-agent/dist/public-api.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';
import type { SessionHistoryEntry } from './session-operations.js';

/** One original Kernel record at its verified Session position. */
export type DecodedKernelRecord = { position: number; record: KernelSessionRecord };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decode one history entry into its Kernel SessionRecord. A body that is not an
 * inline Kernel record, does not parse, fails the public schema or disagrees
 * with the entry's own position/recordId/Session identity is damaged: `null`.
 */
export function decodeKernelEntry(entry: SessionHistoryEntry): DecodedKernelRecord | null {
  const body: unknown = entry.body;
  if (!isRecord(body) || body['encoding'] !== 'kernel_session_record_json' || typeof body['text'] !== 'string') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body['text']); } catch { return null; }
  const result = sessionRecordSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.position !== entry.source.position || result.data.recordId !== entry.recordId
    || result.data.sessionId !== entry.source.kernelSessionId) return null;
  return { position: result.data.position, record: result.data };
}
function findTurnStart(records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding): { run: Parameters<typeof createInitialRunState>[0]; position: number } | null {
  for (const item of records) {
    if (item.record.recordType !== 'turn.started') continue;
    const payload = item.record.payload as unknown as { run?: Parameters<typeof createInitialRunState>[0] };
    const run = payload.run;
    if (run === undefined || run.runId !== kernel.runId || run.turn.turnId !== kernel.turnId) continue;
    return { run, position: item.position };
  }
  return null;
}
/**
 * Reduce the fixed Turn from its own `turn.started` record. `null` when that
 * record is not among the decoded records.
 */
export function reduceTurnFromStart(records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding): RunState | null {
  const start = findTurnStart(records, kernel);
  if (start === null) return null;
  return applyTurnEvents(createInitialRunState(start.run), records, kernel, start.position);
}
/**
 * Apply this Turn's `agent.event` records after `afterPosition` to an already
 * reduced state. Events of another Run/Turn in the same Session are skipped.
 */
export function applyTurnEvents(state: RunState, records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding, afterPosition: number): RunState {
  let next = state;
  for (const item of records) {
    if (item.position <= afterPosition) continue;
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    next = reduceRunState(next, event);
  }
  return next;
}

/**
 * The calls of a reduced Turn without a determined result (RD-2, LA-7): a batch
 * call `running` or `outcome_unknown` (a `pending` call never started, an
 * `abandoned` one is determined), or a transcript result carrying the formal
 * `outcome_unknown` error. The observer's RUN-08 and the start-up reconcile's
 * RUN-20(i) read the same list.
 */
export function unresolvedToolCallIds(state: RunState): string[] {
  const ids = new Set<string>();
  for (const call of state.toolBatch?.calls ?? []) {
    if (call.status === 'running' || call.status === 'outcome_unknown') ids.add(call.requestedCall.callId);
  }
  for (const entry of state.transcript) {
    if (entry.kind === 'tool_result' && entry.result.status === 'error' && entry.result.error.code === 'outcome_unknown') {
      ids.add(entry.callId);
    }
  }
  return [...ids];
}
