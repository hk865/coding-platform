/**
 * Shared fixtures for the common-orchestration mechanism tests.
 *
 * Two independent seams live here and nothing else:
 *   - the real Kernel `RuntimeRunner` harness (scripted model + controlled tool
 *     executor + required sink) used to observe the `run.yielded` terminal;
 *   - the pure mechanical attention stamps/config used by the observer tests.
 *
 * The harness deliberately imports ONLY the frozen public Kernel entry, exactly
 * like the accepted R4.2 barrier tests; it never reaches a private path.
 */
import {
  RuntimeRunner,
  type AgentEvent,
  type EventSinkPort,
  type ModelClientPort,
  type ModelEvent,
  type ModelRequest,
  type Run,
  type RunLimits,
  type RunState,
  type ToolCall,
  type ToolExecutorPort,
  type ToolGroupBarrier,
  type ToolResult,
} from '../../vendor/coding-agent/dist/public-api.js';
import type { FileAttentionStamp, GraphAttentionStamp, AttentionConfigV1 } from '../../src/app/attention-observer.js';

export const ORCHESTRATION_AT = '2026-09-28T00:00:00.000Z';

export type ScriptedReply =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'tools';
      readonly calls: readonly {
        readonly callId: string;
        readonly name: string;
        readonly arguments?: Readonly<Record<string, unknown>>;
      }[];
    };

/** A deterministic model client: one reply per provider request, no network. */
export class ScriptedModel implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  readonly #replies: ScriptedReply[];

  constructor(replies: readonly ScriptedReply[]) {
    this.#replies = [...replies];
  }

  async *stream(
    request: Readonly<ModelRequest>,
    options: { readonly signal: AbortSignal },
  ): AsyncIterable<ModelEvent> {
    options.signal.throwIfAborted();
    const reply = this.#replies.shift();
    this.requests.push(structuredClone(request));
    if (!reply) throw new Error('ScriptedModel: replies exhausted');
    const base = { schemaVersion: 1 as const, requestId: request.requestId };
    let sequence = 1;
    if (reply.kind === 'text') {
      yield { ...base, sequence: sequence++, type: 'text_delta', delta: reply.text };
      yield { ...base, sequence, type: 'completed', reason: 'final_answer' };
      return;
    }
    for (const [ordinal, call] of reply.calls.entries()) {
      yield { ...base, sequence: sequence++, type: 'tool_call_started', callId: call.callId, name: call.name, ordinal };
      yield { ...base, sequence: sequence++, type: 'tool_arguments_delta', callId: call.callId, delta: JSON.stringify(call.arguments ?? {}) };
    }
    yield { ...base, sequence, type: 'completed', reason: 'tool_calls' };
  }
}

type ToolHandlerFn = (call: ToolCall, options: Readonly<{ signal: AbortSignal }>) => Promise<ToolResult>;

export class ControlledExecutor implements ToolExecutorPort {
  readonly calls: ToolCall[] = [];
  readonly #handlers: Readonly<Record<string, ToolHandlerFn>>;
  constructor(handlers: Readonly<Record<string, ToolHandlerFn>>) {
    this.#handlers = handlers;
  }
  async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
    const snapshot = structuredClone(call) as ToolCall;
    this.calls.push(snapshot);
    const handler = this.#handlers[call.name];
    if (!handler) throw new Error(`ControlledExecutor: no handler for ${call.name}`);
    return await handler(snapshot, options);
  }
}

export class RecordingSink implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery = 'required' as const;
  readonly events: AgentEvent[] = [];
  constructor(sinkId: string) {
    this.sinkId = sinkId;
  }
  async publish(event: Readonly<AgentEvent>): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

export function successResult(callId: string, text = 'ok'): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: 'success',
    output: [{ kind: 'text', text }],
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
  };
}

export function baseRun(runId: string, turnId: string): Run {
  return {
    schemaVersion: 1,
    runId,
    turn: {
      turnId,
      userMessage: { schemaVersion: 1, messageId: `user-${turnId}`, role: 'user', content: 'common-mechanism fixture input' },
    },
    createdAt: ORCHESTRATION_AT,
  };
}

export function runnerInput(run: Run, toolNames: readonly string[]) {
  return {
    run,
    baseSystemPrompt: 'common-mechanism Kernel fixture.',
    tools: toolNames.map(name => ({ name, description: `${name} fixture`, inputSchema: { type: 'object' } })),
    tokenBudget: 20_000,
  };
}

export function runLimits(maxModelRequests = 8): RunLimits {
  return {
    maxModelRequests,
    maxToolCalls: 4,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  };
}

export function isYielded(state: RunState): boolean {
  return state.status === 'yielded';
}

/** A real runner over the frozen public entry; the caller supplies the barrier. */
export function createRunner(input: {
  replies: readonly ScriptedReply[];
  handlers: Readonly<Record<string, ToolHandlerFn>>;
  sinkId: string;
  barrier?: ToolGroupBarrier;
  limits?: RunLimits;
  /** Fixed clock; defaults to the frozen ORCHESTRATION_AT instant. */
  now?: () => Date;
}) {
  const model = new ScriptedModel(input.replies);
  const executor = new ControlledExecutor(input.handlers);
  const sink = new RecordingSink(input.sinkId);
  const runner = new RuntimeRunner({
    modelClient: model,
    toolExecutor: executor,
    eventSinks: [sink],
    ...(input.barrier === undefined ? {} : { toolGroupBarrier: input.barrier }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    clock: { now: input.now ?? (() => new Date(ORCHESTRATION_AT)) },
  });
  return { model, executor, sink, runner };
}

// --------------------------------------------------------------------------
// Mechanical attention fixtures
// --------------------------------------------------------------------------

export function attentionConfig(overrides: Partial<AttentionConfigV1> = {}): AttentionConfigV1 {
  return {
    schemaVersion: 1,
    heartbeatMs: 1_000,
    maxCoalesceMs: 5_000,
    files: { minChangedLines: 100, minRatio: 0.5, scopePrefixes: ['.'], ...(overrides.files ?? {}) },
    graph: { minChangedElements: 10, minRatio: 0.5, ...(overrides.graph ?? {}) },
    ...(overrides.heartbeatMs === undefined ? {} : { heartbeatMs: overrides.heartbeatMs }),
    ...(overrides.maxCoalesceMs === undefined ? {} : { maxCoalesceMs: overrides.maxCoalesceMs }),
  };
}

export function fileStamp(path: string, version: string | null, content: string | null): FileAttentionStamp {
  return { path, version, content };
}

export function graphStamp(
  nodes: readonly string[],
  edges: readonly string[],
  statuses: Readonly<Record<string, string>> = {},
): GraphAttentionStamp {
  return { nodes: [...nodes], edges: [...edges], statuses: { ...statuses } };
}
