/**
 * Test-local formats and commands for the write executor: `exchangeSchemas` is registered through
 * `open(kind, { schemas })`; `exchangeCommand` returns a test-local `WriteCommand` whose prior records are all
 * written by `executeWriteCommand`; `script` counts a call or injects one failure and then delegates unchanged.
 */
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { DecodeResult, EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, RecordBackendSchemas, RecordGuard, StoreFailure, UniqueClaimChange } from '../../src/core/record-store/ports.js';
import type { CommandResult, CommitFragment, CommittedReceipt, WriteCommand } from '../../src/core/work-graph/persistence/command-executor.js';
import { executeWriteCommand } from '../../src/core/work-graph/persistence/command-executor.js';

export const exchangeSchemas: RecordBackendSchemas = {
  records: [{
    schemaId: 'Exchange@1', aggregateType: 'Exchange', commitCursorFields: ['since'],
    validate: (record) => {
      const body = JSON.parse(record.json) as { ref?: unknown };
      return body.ref === undefined ? { status: 'invalid', reason: 'exchange ref missing' } : { status: 'decoded', value: record };
    },
  }],
  events: [{ eventType: 'ExchangeCommitted', schemaVersion: 1, validate: (event) => ({ status: 'decoded', value: event }) }],
};
export const keyOf = (id: string): string => JSON.stringify({ aggregateType: 'Exchange', exchangeId: id, projectId: 'p1' });
export const pin = (id: string, revision: number): VersionPin => ({ ref: JSON.parse(keyOf(id)) as VersionPin['ref'], revision });
export const record = (id: string, revision: number): EncodedRecord => ({ refKey: keyOf(id), schemaId: 'Exchange@1', revision, json: JSON.stringify({ ref: JSON.parse(keyOf(id)), revision }) });
export const event = (id: string, change: { eventId?: string; eventType?: string; schemaVersion?: number } = {}): EncodedDomainEvent => {
  const eventId = change.eventId ?? id, eventType = change.eventType ?? 'ExchangeCommitted', schemaVersion = change.schemaVersion ?? 1;
  const occurredAt = '2026-10-24T00:00:00.000Z';
  return { eventId, eventType, schemaVersion, occurredAt, json: JSON.stringify({ eventId, eventType, schemaVersion, occurredAt, id, revision: 1 }) };
};
export type FragmentOptions = {
  id?: string; revision?: number; expected?: number | null; records?: readonly EncodedRecord[]; events?: readonly EncodedDomainEvent[];
  guards?: readonly RecordGuard[]; claims?: readonly UniqueClaimChange[]; ledgerHorizon?: CommitCursor | null;
};
export function fragment(options: FragmentOptions = {}): CommitFragment {
  const id = options.id ?? 'x1';
  return {
    guards: options.guards ?? [{ refKey: keyOf(id), expectedRevision: options.expected ?? null }],
    records: options.records ?? [record(id, options.revision ?? 1)], events: options.events ?? [event(id)], claims: options.claims ?? [],
    ...(options.ledgerHorizon === undefined ? {} : { ledgerHorizon: options.ledgerHorizon }),
  };
}
export type ExchangeFacts = { entry: string | null };
export type ExchangeDecision = { id: string; revision: number; expected: number | null };
export type ExchangeRefusal = { code: string; reason: string };
export type ExchangeDecoded = { id: string; revision: number };
export type ExchangeResult = ExchangeDecoded & { cursor: CommitCursor };
export type ExchangeCommand = WriteCommand<ExchangeFacts, ExchangeDecision, ExchangeRefusal, ExchangeDecoded, ExchangeResult>;
export type CommandOptions = {
  facts?: ExchangeFacts; fingerprintInput?: ExchangeCommand['fingerprintInput']; read?: ExchangeCommand['read']; decide?: ExchangeCommand['decide'];
  build?: ExchangeCommand['build']; eventType?: string; schemaVersion?: number; decode?: ExchangeCommand['result']['decode'];
  validate?: ExchangeCommand['result']['validate']; project?: ExchangeCommand['result']['project']; retryable?: ExchangeCommand['retryable'];
};
export function decodeEvent(event: EncodedDomainEvent): DecodeResult<ExchangeDecoded> {
  try {
    const body = JSON.parse(event.json) as { id?: unknown; revision?: unknown };
    return typeof body.id === 'string' && typeof body.revision === 'number'
      ? { status: 'decoded', value: { id: body.id, revision: body.revision } } : { status: 'invalid', reason: 'not an exchange' };
  } catch { return { status: 'invalid', reason: 'not JSON' }; }
}
export function exchangeCommand(options: CommandOptions = {}): ExchangeCommand {
  const decision: ExchangeDecision = { id: 'x1', revision: 1, expected: null };
  return {
    operation: 'exchange.commit', scope: { projectId: 'p1', workspaceId: null }, principal: { kind: 'system', id: 'test' },
    commandId: 'c1', fingerprintInput: options.fingerprintInput ?? { id: 'x1' },
    read: options.read ?? (async () => ({ status: 'ready', facts: options.facts ?? { entry: 'x1' } })),
    decide: options.decide ?? (() => ({ decision })),
    build: options.build ?? ((next) => fragment({ id: next.id, revision: next.revision, expected: next.expected })),
    result: {
      eventType: options.eventType ?? 'ExchangeCommitted', schemaVersion: options.schemaVersion ?? 1,
      decode: options.decode ?? decodeEvent, validate: options.validate ?? (() => null), project: options.project ?? ((decoded, cursor) => ({ ...decoded, cursor })),
    },
    ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
  };
}
/** A second command for prior state: its commandId keeps its identity apart from the command under test. */
export function seedCommand(options: CommandOptions = {}): ExchangeCommand {
  return { ...exchangeCommand(options), commandId: 'seed' };
}
export async function committed(records: GoalRecordTransactionPort, command: ExchangeCommand): Promise<Extract<CommandResult<ExchangeResult, ExchangeRefusal>, { status: 'committed' }>> {
  const result = await executeWriteCommand(records, command);
  if (result.status !== 'committed') throw new Error(`expected committed, got ${result.status}`);
  return result;
}
export type Point = 'lookupCommit' | 'commit' | 'eventAt';
export type Step = 'real' | { fail: StoreFailure } | { throws: Error } | { realThenThrows: Error } | { patch: (value: unknown) => unknown };
/** Counting wrapper that may replay `steps` at `point`, then delegates unchanged. */
export function script(port: GoalRecordTransactionPort, point: Point, steps: readonly Step[] = []): { records: GoalRecordTransactionPort; calls: () => number } {
  let calls = 0;
  const next = async <T>(active: boolean, run: () => Promise<T>): Promise<T> => {
    if (!active) return run();
    calls += 1;
    const step = steps[calls - 1] ?? 'real';
    if (step === 'real') return run();
    if ('fail' in step) return step.fail as unknown as T;
    if ('throws' in step) throw step.throws;
    if ('realThenThrows' in step) { await run(); throw step.realThenThrows; }
    return step.patch(await run()) as T;
  };
  return {
    calls: () => calls,
    records: {
      readMany: (keys) => port.readMany(keys),
      lookupCommit: (input) => next(point === 'lookupCommit', () => port.lookupCommit(input)),
      commit: (input) => next(point === 'commit', () => port.commit(input)),
      eventAt: (cursor) => next(point === 'eventAt', () => port.eventAt(cursor)),
    },
  };
}
export const changeReceipt = (change: Partial<CommittedReceipt>): Step => ({ patch: (value) => ({ ...(value as CommittedReceipt), ...change }) });
/** `lookupCommit` answers `{ status: 'ready', value: receipt }`; patch the receipt inside it. */
export const changeLookupReceipt = (change: Partial<CommittedReceipt>): Step => ({
  patch: (value) => {
    const found = value as { status: 'ready'; value: CommittedReceipt };
    return { ...found, value: { ...found.value, ...change } };
  },
});
export const changeEvent = (change: Partial<EncodedDomainEvent>, cursor?: CommitCursor): Step => ({
  patch: (value) => {
    const found = value as { status: 'ready'; value: { cursor: CommitCursor; event: EncodedDomainEvent } };
    return { ...found, value: { cursor: cursor ?? found.value.cursor, event: { ...found.value.event, ...change } } };
  },
});
