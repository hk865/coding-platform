/**
 * Slice 2B BE0 fixture: the Kernel record builder named by spec §7.
 *
 * What it builds: one synthetic Kernel Turn as a list of `DecodedKernelRecord`s
 * (`{ position, record }`) — a `turn.started` Session record followed by
 * `agent.event` Session records with continuous positions and continuous
 * `meta.sequence`. It is the only BE0 path, and it is built exactly as §7 names:
 * every hand-written event is validated by the Kernel's real `agentEventSchema`,
 * wrapped as an `agent.event` Session record validated by the real
 * `sessionRecordSchema` (F1/F2), and the sequence is replayed through the real
 * `reduceRunState` so a fixture that is not a reducible Turn fails immediately.
 * The `recordedAt` of each record is its event's `occurredAt` (F2).
 *
 * Through which public calls: `vendor/coding-agent/dist/public-api.js`
 * (`agentEventSchema`, `runSchema`, `sessionRecordSchema`, `createInitialRunState`,
 * `reduceRunState`). Nothing here writes a store, calls a model or touches the
 * network; the records live in memory and the caller passes them to the pure
 * `tallyTurnActivity`.
 */
import { createHash } from 'node:crypto';

import {
  agentEventSchema,
  createInitialRunState,
  reduceRunState,
  runSchema,
  sessionRecordSchema,
  UNLIMITED_RUN_LIMITS,
} from '../../vendor/coding-agent/dist/public-api.js';
import type { RunState, SessionRecord as KernelSessionRecord } from '../../vendor/coding-agent/dist/public-api.js';

import type { DecodedKernelRecord } from '../../src/core/agent-runtime/kernel-turn-facts.js';
import type { KernelExecutionBinding } from '../../src/core/work-graph/model/execution-entry-contracts.js';

/** The default wall clock the fixture writes into records; callers may move it. */
export const S2B_KERNEL_TURN_AT = '2026-10-14T10:00:00.000Z';

/** A structurally valid `turn.started` config that never reaches a provider (R4c pattern). */
const CONFIG = {
  modelConfigId: 's2b-tally-fixture',
  limits: UNLIMITED_RUN_LIMITS,
  enabledToolSchemaDigest: 'a'.repeat(64),
  policyVersion: 's2b-tally-policy',
  sandboxProfileVersion: 's2b-tally-sandbox',
  baseConfigDigest: 'b'.repeat(64),
} as const;

const WORKSPACE = { identity: 'workspace-s2b-tally', revision: '1', reference: 'workspace://s2b-tally' } as const;

export type KernelToolCall = { schemaVersion: 1; callId: string; name: string; arguments: Record<string, unknown> };
export type KernelToolEffects = { sideEffect: 'none' | 'possible' | 'confirmed'; changedPaths: string[];
  workspaceRevision: string | null; artifactRefs: string[] };
export type KernelToolResult = { schemaVersion: 1; callId: string; status: 'success' | 'error' | 'cancelled';
  output: readonly unknown[]; effects: KernelToolEffects;
  error?: { code: string; message: string; retryable: boolean }; reason?: string };

/** The Kernel identity the fixture's records and the tally's `kernel` input share. */
export function tallyKernelBinding(overrides: Partial<KernelExecutionBinding> = {}): KernelExecutionBinding {
  return { adapterId: 's2b-tally-adapter', kernelSessionId: 's2b-tally-session',
    runId: 's2b-tally-run', turnId: 's2b-tally-turn', ...overrides };
}

export function kernelToolCall(callId: string, name: string, args: Record<string, unknown>): KernelToolCall {
  return { schemaVersion: 1, callId, name, arguments: args };
}
export function editReplaceCall(callId: string, path: string, oldText: string, newText: string,
  expectedRevision: string | null = 'rev-1'): KernelToolCall {
  return kernelToolCall(callId, 'edit', { mode: 'replace', path, oldText, newText, expectedRevision });
}
export function editCreateCall(callId: string, path: string, newText: string): KernelToolCall {
  return kernelToolCall(callId, 'edit', { mode: 'create', path, newText });
}
export function shellCall(callId: string, command: string, extra: Record<string, unknown> = {}): KernelToolCall {
  return kernelToolCall(callId, 'shell', { command, ...extra });
}
export function readCall(callId: string, path: string): KernelToolCall {
  return kernelToolCall(callId, 'read', { path });
}

export function effects(overrides: Partial<KernelToolEffects> = {}): KernelToolEffects {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [], ...overrides };
}
export function successResult(callId: string, options: { output?: readonly unknown[]; effects?: Partial<KernelToolEffects> } = {}): KernelToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: options.output ?? [],
    effects: effects(options.effects) };
}
export function failedResult(callId: string, options: { code: string; message?: string; retryable?: boolean;
  effects?: Partial<KernelToolEffects> }): KernelToolResult {
  return { schemaVersion: 1, callId, status: 'error', output: [],
    effects: effects(options.effects), error: { code: options.code, message: options.message ?? options.code,
      retryable: options.retryable ?? false } };
}
export function cancelledResult(callId: string, options: { reason?: string; effects?: Partial<KernelToolEffects> } = {}): KernelToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', output: [],
    effects: effects(options.effects), reason: options.reason ?? 'tool cancelled' };
}

/** The window a caller hands to `tallyTurnActivity`; the fixture defaults to the whole Turn. */
export type TallyWindow = { fromPosition: number; throughPosition: number; bound: 'end_position' | 'turn_bounds' | 'reconcile_observation' | 'kernel_tail' };

/**
 * One synthetic Kernel Turn. `event()` is the only mutator: it parses the event
 * with the real `agentEventSchema`, appends it as a continuous `agent.event`
 * record, and replays it through `reduceRunState`.
 */
export class KernelTurnRecords {
  readonly kernel: KernelExecutionBinding;
  readonly sessionId: string;
  private readonly entries: DecodedKernelRecord[] = [];
  private state: RunState;
  private sequence = 0;
  private lastElapsed = 0;
  private lastAt: string;

  constructor(options: { kernel?: KernelExecutionBinding; at?: string } = {}) {
    this.kernel = options.kernel ?? tallyKernelBinding();
    this.sessionId = this.kernel.kernelSessionId;
    this.lastAt = options.at ?? S2B_KERNEL_TURN_AT;
    const run = runSchema.parse({
      schemaVersion: 1,
      runId: this.kernel.runId,
      turn: { turnId: this.kernel.turnId,
        userMessage: { schemaVersion: 1, messageId: `${this.kernel.turnId}-user`, role: 'user', content: 's2b tally' } },
      createdAt: this.lastAt,
    });
    this.appendRecord('turn.started', { run, config: CONFIG, workspace: WORKSPACE }, this.lastAt);
    this.state = createInitialRunState(run);
  }

  /** The continuous positions of everything appended so far. */
  records(): DecodedKernelRecord[] {
    return [...this.entries];
  }
  position(): number {
    return this.entries.length;
  }
  window(bound: TallyWindow['bound'] = 'end_position'): TallyWindow {
    return { fromPosition: 1, throughPosition: this.entries.length, bound };
  }

  event(input: { type: string; payload: unknown; at?: string | undefined }): this {
    this.sequence += 1;
    const at = input.at ?? this.lastAt;
    this.lastElapsed += 1;
    this.lastAt = at;
    const event = agentEventSchema.parse({ type: input.type,
      meta: { schemaVersion: 1, eventId: `s2b-event-${this.sequence}`, runId: this.kernel.runId,
        turnId: this.kernel.turnId, sequence: this.sequence, occurredAt: at, elapsedMs: this.lastElapsed },
      payload: input.payload });
    this.appendRecord('agent.event', { event }, at);
    this.state = reduceRunState(this.state, event);
    return this;
  }

  runStarted(at?: string): this { return this.event({ type: 'run.started', payload: {}, at }); }
  modelRequestStarted(requestId: string, at?: string): this {
    return this.event({ type: 'model.request_started', payload: { requestId, retryOfRequestId: null }, at });
  }
  modelUsageRecorded(requestId: string, delta: { inputTokens: number; outputTokens: number; cachedInputTokens: number;
    costUsdMicros: number | null }, at?: string): this {
    return this.event({ type: 'model.usage_recorded', payload: { requestId, delta }, at });
  }
  assistantMessage(messageId: string, toolCalls: readonly KernelToolCall[], at?: string): this {
    return this.event({ type: 'assistant.message_completed',
      payload: { requestId: this.activeRequestId(), message: { schemaVersion: 1, messageId, role: 'assistant', content: '' },
        toolCalls }, at });
  }
  toolStarted(call: KernelToolCall, at?: string): this {
    return this.event({ type: 'tool.started', payload: { call }, at });
  }
  toolCompleted(callId: string, result: KernelToolResult, at?: string): this {
    return this.event({ type: 'tool.completed', payload: { callId, result }, at });
  }
  toolFailed(callId: string, phase: 'pre_execution' | 'execution', result: KernelToolResult, at?: string): this {
    return this.event({ type: 'tool.failed', payload: { callId, phase, result }, at });
  }
  toolCancelled(callId: string, result: KernelToolResult, at?: string): this {
    return this.event({ type: 'tool.cancelled', payload: { callId, result }, at });
  }
  toolOutcomeUnknown(callId: string, options: { toolName: string; effectClass: 'read_only' | 'workspace_write' | 'process';
    reason?: 'process_interrupted' | 'cancelled_while_running'; recordedCallEventId?: string;
    synthesized?: Partial<KernelToolResult> }, at?: string): this {
    const synthesized = { schemaVersion: 1, callId, status: 'error' as const, output: [],
      effects: effects({ sideEffect: options.effectClass === 'read_only' ? 'none' : 'possible' }),
      error: { code: 'outcome_unknown', message: 'outcome unknown', retryable: false },
      ...options.synthesized } as KernelToolResult;
    return this.event({ type: 'tool.outcome_unknown', payload: { callId, toolName: options.toolName,
      effectClass: options.effectClass, reason: options.reason ?? 'cancelled_while_running',
      retryPolicy: 'never_automatic', recordedCallEventId: options.recordedCallEventId ?? `s2b-recording-${callId}`,
      synthesizedResult: synthesized }, at });
  }
  runCancelled(at?: string, reason: 'caller_requested' | 'user_interrupt' | 'process_signal' = 'caller_requested'): this {
    return this.event({ type: 'run.cancelled', payload: { reason }, at });
  }

  private activeRequestId(): string {
    const request = this.state.activeModelRequest;
    if (request === null) throw new Error('assistantMessage needs an open model request');
    return request.requestId;
  }

  private appendRecord(recordType: string, payload: unknown, recordedAt: string): void {
    const position = this.entries.length + 1;
    const content = { recordId: `s2b-record-${position}`, sessionId: this.sessionId, position,
      schemaVersion: 1 as const, recordedAt, recordType, payload };
    const checksum = checksumOf(content);
    const record = sessionRecordSchema.parse({ ...content, checksum }) as KernelSessionRecord;
    this.entries.push({ position, record });
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
/** The Kernel's own record checksum (canonical JSON, sha256) so the wrapper is genuine. */
function checksumOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
