/**
 * Group R fix round support (spec §5.1 KE3 "Kernel 存储是系统边界，故障可以在这里注入";
 * KA-09 variant "平台 Run 上的位置记录落后于 Kernel 里的记录，后面的事实也列出").
 *
 * Appends one genuine Kernel fact to an already-open Turn through the public
 * `SqliteStores.append` surface, so a test can model a durable fact the platform
 * Run never observed (its locator lags). It is used only at the Kernel store
 * boundary, exactly as `tests/scenarios/K-W-maintenance.test.ts` KA-14b does; the
 * appended record is a fact of the Turn, never a fabricated platform record.
 * The helper reads the store only to continue the event sequence; no assertion
 * reads it back.
 */
import { join } from 'node:path';
import { agentEventSchema, SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';

type BoundaryMeta = { schemaVersion: number; eventId: string; runId: string; turnId: string; sequence: number;
  occurredAt: string; elapsedMs: number };
type BoundaryEvent = { type: string; meta: BoundaryMeta; payload: Record<string, unknown> };
type BoundaryRecord = { recordType: string; position: number; payload: { event: BoundaryEvent } };
/** The narrow public Kernel store surface this helper uses (drafts stay untyped). */
type BoundaryStore = {
  read(sessionId: string, afterPosition: number, limit: number, options: { signal: AbortSignal }):
    Promise<{ records: readonly BoundaryRecord[]; nextPosition: number | null }>;
  get(sessionId: string, options: { signal: AbortSignal }): Promise<{ revision: number }>;
  append(sessionId: string, expectedRevision: number, drafts: readonly unknown[], options: { signal: AbortSignal }): Promise<unknown>;
  close(): Promise<void>;
};

/** The last `agent.event` of the open Turn; every fact append continues its sequence. */
async function lastOpenEvent(store: BoundaryStore, kernelSessionId: string): Promise<BoundaryEvent> {
  const signal = new AbortController().signal;
  const records: BoundaryRecord[] = [];
  let position = 0;
  for (;;) {
    const page = await store.read(kernelSessionId, position, 256, { signal });
    records.push(...page.records);
    const last = page.records.at(-1);
    if (page.nextPosition === null || last === undefined) break;
    position = last.position;
  }
  const lastEvent = [...records].reverse().find((record) => record.recordType === 'agent.event');
  if (lastEvent === undefined) throw new Error('the boundary injection needs an open Kernel Turn');
  return lastEvent.payload.event;
}

/**
 * Append one `run.input_accepted` for `messageId` to the open Turn of
 * `kernelSessionId`. The source ref names a real Session message, so the brief's
 * accepted-input list is exactly the Kernel fact, never a rewritten copy. A Turn
 * the Runtime left `paused` (the A8-2d crash point) is resumed first, because an
 * input is only accepted at a drained `before_model` boundary.
 */
export async function injectAcceptedMessage(database: string, kernelSessionId: string, input: {
  messageId: string; projectId: string; workspaceId: string; text: string; at?: string;
}): Promise<void> {
  const signal = new AbortController().signal;
  const store = await SqliteStores.open(join(database, 'kernel.sqlite')) as unknown as BoundaryStore;
  try {
    const previous = await lastOpenEvent(store, kernelSessionId);
    const at = input.at ?? '2026-10-14T00:40:00.000Z';
    const meta = (sequence: number): Pick<BoundaryMeta, 'runId' | 'turnId' | 'sequence' | 'elapsedMs'> => ({ runId: previous.meta.runId,
      turnId: previous.meta.turnId, sequence, elapsedMs: previous.meta.elapsedMs + 10 * (sequence - previous.meta.sequence) });
    const events: BoundaryEvent[] = [];
    if (previous.type === 'run.paused') {
      events.push(agentEventSchema.parse({ type: 'run.resumed',
        meta: { schemaVersion: 1, eventId: `k-boundary-resume:${input.messageId}`, ...meta(previous.meta.sequence + 1), occurredAt: at },
        payload: { resumedBy: 'runtime' } }) as BoundaryEvent);
    }
    events.push(agentEventSchema.parse({
      type: 'run.input_accepted',
      meta: { schemaVersion: 1, eventId: `k-boundary-input:${input.messageId}`, ...meta(previous.meta.sequence + events.length + 1),
        occurredAt: at },
      payload: { input: { inputId: `k-boundary-input:${input.messageId}`, messageId: input.messageId, text: input.text,
        sourceRef: { kind: 'SessionMessage', part: 'message',
          messageRef: { aggregateType: 'SessionMessage', projectId: input.projectId, workspaceId: input.workspaceId,
            messageId: input.messageId } } } },
    }) as BoundaryEvent);
    const header = await store.get(kernelSessionId, { signal });
    await store.append(kernelSessionId, header.revision, events.map((event) => (
      { recordId: `agent-event:${event.meta.eventId}`, recordType: 'agent.event', schemaVersion: 1, recordedAt: at,
        payload: { event } })), { signal });
  } finally {
    await store.close();
  }
}

/**
 * Complete the Turn's in-flight model request with a real assistant step and a
 * `tool.started` for `callId` (the KA-14b pattern), so a Run whose platform
 * locator stopped before this boundary has a later tool fact in its Turn. The
 * request identity is read from the last event; no assertion reads it back.
 */
export async function injectRunningToolCall(database: string, kernelSessionId: string, input: {
  callId: string; messageId: string; path?: string; at?: string;
}): Promise<void> {
  const signal = new AbortController().signal;
  const store = await SqliteStores.open(join(database, 'kernel.sqlite')) as unknown as BoundaryStore;
  try {
    const previous = await lastOpenEvent(store, kernelSessionId);
    const requestId = previous.payload['requestId'];
    if (typeof requestId !== 'string' || requestId.length === 0) {
      throw new Error('the running-tool injection needs an in-flight model request to complete');
    }
    const at = input.at ?? '2026-10-14T00:40:00.000Z';
    const meta = (sequence: number): Pick<BoundaryMeta, 'runId' | 'turnId' | 'sequence' | 'elapsedMs'> => ({ runId: previous.meta.runId,
      turnId: previous.meta.turnId, sequence, elapsedMs: previous.meta.elapsedMs + 10 * (sequence - previous.meta.sequence) });
    const call = { schemaVersion: 1, callId: input.callId, name: 'read', arguments: { path: input.path ?? 'src/module.ts' } };
    const events: BoundaryEvent[] = [
      agentEventSchema.parse({ type: 'assistant.message_completed',
        meta: { schemaVersion: 1, eventId: `k-boundary-assistant:${input.callId}`, ...meta(previous.meta.sequence + 1), occurredAt: at },
        payload: { requestId, message: { schemaVersion: 1, messageId: input.messageId, role: 'assistant', content: '' },
          toolCalls: [call] } }) as BoundaryEvent,
      agentEventSchema.parse({ type: 'tool.started',
        meta: { schemaVersion: 1, eventId: `k-boundary-tool:${input.callId}`, ...meta(previous.meta.sequence + 2), occurredAt: at },
        payload: { call } }) as BoundaryEvent,
    ];
    const header = await store.get(kernelSessionId, { signal });
    await store.append(kernelSessionId, header.revision, events.map((event) => (
      { recordId: `agent-event:${event.meta.eventId}`, recordType: 'agent.event', schemaVersion: 1, recordedAt: at,
        payload: { event } })), { signal });
  } finally {
    await store.close();
  }
}


