/**
 * PC-1 Kernel test fixture (frozen; written by Codex, checked and frozen by the lead, 2026-10-22).
 * Scripted provider, public-entry Kernel harness, hand-checkable previews, a RuntimeRunner harness
 * with a cap-changing hook, adapter transport capture and selectContext input builders. Tests may
 * not edit this file; expectations never come from it.
 */
import {
  appConfigSchema, DeepSeekModelClient, HookExecutor, HookRegistry,
  OpenAIModelClient, ProviderRegistry, RuntimeRunner, runCodingAgent,
  sessionRecordSchema, toolSchema,
  type AgentEvent, type BeforeModelHookPort, type ContextBuilderInput,
  type ModelClientPort, type ModelEvent, type ModelRequest, type RunAppInput,
  type SessionRecord, type ToolCall, type ToolDefinition, type ToolResult,
  type selectContext,
} from '../../vendor/coding-agent/dist/public-api.js';
import {
  ControlledExecutor, RecordingSink, runLimits,
} from './orchestration-fixture.js';
import { createR4HistoryWorld } from './R4-history-turn-support.js';
import { createTempWorkspace } from '../kernel/R4a-legacy-fixtures.js';

type Entry = ContextBuilderInput['transcript'][number];
type PreviewValue = Awaited<ReturnType<NonNullable<RunAppInput['previewRequest']>>>;
type PreviewFn = (request: Readonly<ModelRequest>) => PreviewValue | Promise<PreviewValue>;
type ReportSink = NonNullable<RunAppInput['onContextSelected']>;
type Report = Parameters<ReportSink>[0];
type Configuration = Parameters<NonNullable<RunAppInput['onConfiguration']>>[0];
type RunnerInput = Parameters<RuntimeRunner['run']>[0];
type SelectionOptions = Parameters<typeof selectContext>[1];
type InputSupply = NonNullable<RunAppInput['inputSupply']>;
type SuppliedInput = Awaited<ReturnType<InputSupply>>[number];
type ScriptedCall = Pick<ToolCall, 'callId' | 'name'> & {
  arguments?: ToolCall['arguments'];
};

export interface ScriptedStep {
  text?: string;
  toolCalls?: readonly ScriptedCall[];
  reasoningContent?: string;
  usage?: { inputTokens: number; outputTokens: number };
  beforeReply?: (request: Readonly<ModelRequest>, callNumber: number) => void | Promise<void>;
}

export class ScriptedProvider implements ModelClientPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: readonly ScriptedStep[]) {}
  get callCount(): number { return this.requests.length; }

  async *stream(
    request: Readonly<ModelRequest>, options: { readonly signal: AbortSignal },
  ): AsyncIterable<ModelEvent> {
    const step = this.steps[this.callCount];
    this.requests.push(structuredClone(request));
    options.signal.throwIfAborted();
    if (!step) throw new Error(`PC provider exhausted at call ${this.callCount}`);
    await step.beforeReply?.(structuredClone(request), this.callCount);
    options.signal.throwIfAborted();
    const base = { schemaVersion: 1 as const, requestId: request.requestId };
    let sequence = 1;
    if (step.reasoningContent) {
      yield { ...base, sequence: sequence++, type: 'reasoning_delta', delta: step.reasoningContent };
    }
    if (step.text) yield { ...base, sequence: sequence++, type: 'text_delta', delta: step.text };
    for (const [ordinal, call] of (step.toolCalls ?? []).entries()) {
      yield { ...base, sequence: sequence++, type: 'tool_call_started',
        callId: call.callId, name: call.name, ordinal };
      yield { ...base, sequence: sequence++, type: 'tool_arguments_delta',
        callId: call.callId, delta: JSON.stringify(call.arguments ?? {}) };
    }
    yield { ...base, sequence: sequence++, type: 'usage_snapshot',
      usage: { inputTokens: step.usage?.inputTokens ?? 0,
        outputTokens: step.usage?.outputTokens ?? 0, cachedInputTokens: 0, costUsdMicros: null } };
    yield { ...base, sequence, type: 'completed',
      reason: step.toolCalls?.length ? 'tool_calls' : 'final_answer' };
  }
}

export interface PreviewLimits {
  window: number;
  outputCap: number;
  cumulativeOutputCap?: number;
  /** Read on every preview; previews never consume or reserve output themselves. */
  usedOutput?: number | (() => number);
}

function measuredPreview(limits: PreviewLimits, count?: number) {
  const calls: { request: ModelRequest; result: PreviewValue }[] = [];
  return {
    calls,
    previewRequest(request: Readonly<ModelRequest>): PreviewValue {
      const used = typeof limits.usedOutput === 'function'
        ? limits.usedOutput() : limits.usedOutput ?? 0;
      const remaining = limits.cumulativeOutputCap === undefined
        ? Infinity : limits.cumulativeOutputCap - used;
      const outputReserve = Math.min(
        request.maxOutputTokens ?? limits.outputCap, limits.outputCap, remaining,
      );
      const outgoing = { ...structuredClone(request), maxOutputTokens: outputReserve };
      // The meter counts the final request, AFTER setting its output reserve.
      const inputTokens = count ?? Buffer.byteLength(JSON.stringify(outgoing), 'utf8') + 4096;
      const result: PreviewValue = {
        outgoing, inputTokens, outputReserve,
        fits: inputTokens + outputReserve <= limits.window,
      };
      calls.push({ request: structuredClone(request), result: structuredClone(result) });
      return result;
    },
  };
}

/**
 * For each prefix, the TEST writes its entire expected ModelRequest literally:
 * system sections/separators, message ids, calls/results, tools and output cap.
 * Count JSON.stringify(that literal) in UTF-8, then add 4096 and the reserve.
 * Do not obtain expected requests from buildModelRequest or these helpers.
 * Match preview calls by their recorded requests; call order does not identify k.
 */
export function bytePreview(limits: PreviewLimits) {
  return measuredPreview(limits);
}

export function fixedCountPreview(limits: PreviewLimits & { count: number }) {
  return measuredPreview(limits, limits.count);
}

function laterTick(probe: ReturnType<typeof bytePreview>) {
  return {
    calls: probe.calls,
    async previewRequest(request: Readonly<ModelRequest>): Promise<PreviewValue> {
      const result = probe.previewRequest(request);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return result;
    },
  };
}

export function asyncBytePreview(limits: PreviewLimits) {
  return laterTick(bytePreview(limits));
}

export function asyncFixedCountPreview(limits: PreviewLimits & { count: number }) {
  return laterTick(fixedCountPreview(limits));
}

export function inputQueue() {
  const pending: SuppliedInput[] = [];
  const supply: InputSupply = async (point, options) => {
    options.signal.throwIfAborted();
    return structuredClone(pending.filter(item => !point.acceptedInputIds.includes(item.inputId)));
  };
  return {
    supply,
    enqueue(inputId: string, text: string, sourceRef: unknown = null): void {
      pending.push(structuredClone({ inputId, text, sourceRef }));
    },
  };
}

export function createRunnerHarness(steps: readonly ScriptedStep[], options: {
  hookOutputCap: number;
  previewRequest: PreviewFn;
  handlers?: ConstructorParameters<typeof ControlledExecutor>[0];
  onContextSelected?: ReportSink;
}) {
  const model = new ScriptedProvider(steps);
  const executor = new ControlledExecutor(options.handlers ?? {});
  const sink = new RecordingSink('pc-runner-events');
  const reports: Report[] = [];
  const hookRequests: ModelRequest[] = [];
  const hook: BeforeModelHookPort = {
    hookId: 'pc-output-cap', point: 'before_model', priority: 0,
    async execute({ request }) {
      hookRequests.push(structuredClone(request));
      return { point: 'before_model', kind: 'modify',
        value: { ...request, maxOutputTokens: options.hookOutputCap } };
    },
  };
  const runner = new RuntimeRunner({
    modelClient: model, toolExecutor: executor, eventSinks: [sink],
    hookExecutor: new HookExecutor(new HookRegistry([hook])),
    limits: runLimits(16), maxModelRetries: 0,
  });
  return {
    model, executor, sink, runner, reports, hookRequests,
    run(input: Omit<RunnerInput, 'previewRequest' | 'onContextSelected'>) {
      return runner.run({
        ...input,
        previewRequest: async request => options.previewRequest(request),
        onContextSelected: report => {
          reports.push(structuredClone(report));
          options.onContextSelected?.(report);
        },
      });
    },
  };
}

type KernelOptions = Pick<RunAppInput,
  'baseSystemPrompt' | 'skills' | 'reasoningReplay' | 'onContextSelected' | 'onConfiguration'
> & {
  previewRequest?: PreviewFn;
  window?: number;
  outputCap?: number;
  tools?: readonly ToolDefinition[];
};

export async function createKernelHarness(
  steps: readonly ScriptedStep[], defaults: KernelOptions = {},
) {
  const workspace = await createTempWorkspace('pc-kernel-');
  const world = await createR4HistoryWorld('memory').catch(async error => {
    await workspace.cleanup();
    throw error;
  });
  const close = async () => {
    try { await world.close(); } finally { await workspace.cleanup(); }
  };
  try {
    const sessionRef = world.sessions.first;
    const { kernelSessionId: sessionId } = await world.sessionKernel(sessionRef);
    const model = new ScriptedProvider(steps);
    const inputs = inputQueue();
    const reports: Report[] = [];
    const configurations: Configuration[] = [];
    const events: AgentEvent[] = [];
    const providerRegistry = new ProviderRegistry().register({
      id: 'deepseek', secretEnvironmentVariable: 'PC_FIXTURE_UNUSED_SECRET',
      defaultBaseUrl: 'https://invalid.test',
      capabilities: { streaming: true, toolCalls: true, usage: true },
      create: () => model,
    });
    let throughPosition: number | undefined;
    let turn = 0;

    async function readHistory(): Promise<SessionRecord[]> {
      const records: SessionRecord[] = [];
      let afterCursor: string | null = null;
      let throughCursor: string | null = null;
      for (;;) {
        const page = await world.history.readSessionHistory(world.ctx, {
          sessionRef, afterCursor, throughCursor, limit: 200,
        });
        if (page.status !== 'ready') throw new Error(`PC history: ${JSON.stringify(page)}`);
        if (page.value.basis.kind !== 'session') throw new Error('PC history has no Session basis');
        throughCursor ??= page.value.basis.cursor;
        for (const item of page.value.items) {
          if (!('encoding' in item.body) || item.body.encoding !== 'kernel_session_record_json') {
            throw new Error('PC history requires the public inline Kernel record body');
          }
          records.push(sessionRecordSchema.parse(JSON.parse(item.body.text)));
        }
        if (page.value.nextCursor === null) return records;
        afterCursor = page.value.nextCursor;
      }
    }

    async function run(input: string, overrides: KernelOptions = {}) {
      const options = { ...defaults, ...overrides };
      const tools = options.tools ?? [];
      const identity = { runId: `pc-run-${++turn}`, turnId: `pc-turn-${turn}` };
      const result = await runCodingAgent({
        config: appConfigSchema.parse({
          schemaVersion: 1,
          model: { provider: 'deepseek', model: 'pc-model', options: {},
            maxOutputTokens: options.outputCap ?? 100 },
          runtime: { tokenBudget: options.window ?? 100_000,
            maxModelRequests: 16, maxToolCalls: 16 },
          tools: { enabledNames: tools.map(tool => tool.name) },
          storage: { databasePath: world.databasePath },
          skills: { resourceRoot: workspace.resolve('absent-skills'), enabledIds: [] },
          memory: { provider: 'empty' },
        }),
        input, sessionId, executionIdentity: identity, workspaceRoot: workspace.root,
        providerRegistry, secretSource: { get: () => 'synthetic-pc-key' },
        additionalTools: () => tools, inputSupply: inputs.supply,
        baseSystemPrompt: options.baseSystemPrompt ?? { templateId: 'pc-base', version: 1, text: 'BASE' },
        skills: options.skills ?? [], reasoningReplay: options.reasoningReplay ?? 'current_run',
        ...(throughPosition === undefined ? {} : {
          sessionContext: { version: 1, mode: 'session_history', throughPosition },
        }),
        ...(options.previewRequest === undefined ? {} : {
          previewRequest: async request => options.previewRequest!(request),
        }),
        onContextSelected: report => {
          reports.push(structuredClone(report));
          options.onContextSelected?.(report);
        },
        onConfiguration: configuration => {
          configurations.push(structuredClone(configuration));
          options.onConfiguration?.(configuration);
        },
        observerEventSinks: [{
          sinkId: 'pc-public-observer', delivery: 'best_effort',
          async publish(event) { events.push(structuredClone(event)); },
        }],
      });
      // A real terminal event supplies the next run's boundary, never a guessed position.
      if (['completed', 'failed', 'cancelled', 'limit_exceeded', 'yielded', 'interrupted']
        .includes(result.state.status)) {
        const boundary = (await readHistory()).find(record =>
          record.recordType === 'agent.event'
          && record.payload.event.meta.runId === result.state.runId
          && record.payload.event.type === `run.${result.state.status}`);
        if (!boundary) throw new Error('PC run has no publicly readable terminal event');
        throughPosition = boundary.position;
      }
      return result;
    }

    return {
      model, inputs, reports, configurations, events, sessionId, workspace,
      run, readHistory, close,
      async twoRuns(first: string, second: string,
        firstOptions: KernelOptions = {}, secondOptions: KernelOptions = {}) {
        return [await run(first, firstOptions), await run(second, secondOptions)] as const;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

type WireReply = Pick<ScriptedStep, 'text' | 'toolCalls' | 'usage'>;

function adapterCapture(provider: 'deepseek' | 'openai', replies: readonly WireReply[]) {
  const bodies: Record<string, unknown>[] = [];
  const bodyJson: string[] = [];
  const transport: ConstructorParameters<typeof DeepSeekModelClient>[0]['transport'] = {
    async create(body, signal) {
      const reply = replies[bodies.length];
      const json = JSON.stringify(body);
      bodyJson.push(json);
      bodies.push(JSON.parse(json));
      signal.throwIfAborted();
      if (!reply) throw new Error('PC transport replies exhausted');
      const calls = reply.toolCalls ?? [];
      const input = reply.usage?.inputTokens ?? 0;
      const output = reply.usage?.outputTokens ?? 0;
      return (async function* (): AsyncIterable<unknown> {
        if (provider === 'deepseek') {
          yield {
            id: 'pc-chat', object: 'chat.completion.chunk', created: 0, model: 'pc-model',
            choices: [{ index: 0, delta: {
              role: 'assistant', ...(reply.text === undefined ? {} : { content: reply.text }),
              ...(calls.length === 0 ? {} : { tool_calls: calls.map((call, index) => ({
                index, id: call.callId, type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
              })) }),
            }, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
          };
          return;
        }
        let sequence = 0;
        const finalItems: Record<string, unknown>[] = [];
        for (const [index, call] of calls.entries()) {
          const item = { type: 'function_call', id: `pc-fc-${index}`, call_id: call.callId,
            name: call.name, arguments: JSON.stringify(call.arguments ?? {}), status: 'completed' };
          yield { type: 'response.output_item.added', sequence_number: sequence++, output_index: index,
            item: { ...item, arguments: '', status: 'in_progress' } };
          yield { type: 'response.function_call_arguments.delta', sequence_number: sequence++,
            item_id: item.id, output_index: index, delta: item.arguments };
          yield { type: 'response.output_item.done', sequence_number: sequence++, output_index: index, item };
          finalItems.push(item);
        }
        if (reply.text) {
          const item = { type: 'message', id: 'pc-message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: reply.text, annotations: [], logprobs: [] }] };
          yield { type: 'response.output_item.added', sequence_number: sequence++, output_index: calls.length,
            item: { ...item, status: 'in_progress', content: [] } };
          yield { type: 'response.output_text.delta', sequence_number: sequence++, item_id: item.id,
            output_index: calls.length, content_index: 0, delta: reply.text, logprobs: [] };
          yield { type: 'response.output_item.done', sequence_number: sequence++, output_index: calls.length, item };
          finalItems.push(item);
        }
        yield { type: 'response.completed', sequence_number: sequence, response: {
          id: 'pc-response', object: 'response', created_at: 0, model: 'pc-model',
          status: 'completed', output: finalItems,
          usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
        } };
      })();
    },
  };
  const client = provider === 'deepseek'
    ? new DeepSeekModelClient({ model: 'pc-model', transport })
    : new OpenAIModelClient({ model: 'pc-model', transport });
  return { client, transport, bodies, bodyJson, get callCount() { return bodies.length; } };
}

export function deepSeekCapture(replies: readonly WireReply[]) {
  return adapterCapture('deepseek', replies);
}

export function openAICapture(replies: readonly WireReply[]) {
  return adapterCapture('openai', replies);
}

export function userEntry(messageId: string, content: string): Extract<Entry, { kind: 'user_message' }> {
  return { kind: 'user_message', message: { schemaVersion: 1, messageId, role: 'user', content } };
}

export function assistantEntry(messageId: string, content = '', toolCalls: readonly ToolCall[] = [],
  reasoningContent?: string): Extract<Entry, { kind: 'assistant_message' }> {
  return { kind: 'assistant_message', toolCalls: structuredClone(toolCalls),
    message: { schemaVersion: 1, messageId, role: 'assistant', content,
      ...(reasoningContent === undefined ? {} : { reasoningContent }) } };
}

function resultEntry(result: ToolResult): Extract<Entry, { kind: 'tool_result' }> {
  // Tool entries have callId, not messageId, in the public transcript type.
  return { kind: 'tool_result', callId: result.callId, result: structuredClone(result) };
}

function effects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}

export function successEntry(callId: string, output: ToolResult['output'],
  effect: ToolResult['effects'] = effects()) {
  return resultEntry({ schemaVersion: 1, callId, status: 'success', output, effects: effect });
}

export function errorEntry(callId: string, message: string, output: ToolResult['output'] = []) {
  return resultEntry({ schemaVersion: 1, callId, status: 'error', output, effects: effects(),
    error: { code: 'execution_failed', message, retryable: false } });
}

export function cancelledEntry(callId: string, reason: string, output: ToolResult['output'] = []) {
  return resultEntry({ schemaVersion: 1, callId, status: 'cancelled', reason, output, effects: effects() });
}

export function contextInput(input: Pick<ContextBuilderInput, 'transcript'> & Partial<ContextBuilderInput>)
  : ContextBuilderInput {
  return structuredClone({ requestId: 'pc-request', runId: 'pc-run', baseSystemPrompt: 'BASE',
    additionalInstructions: [], tools: [], skills: [], memories: [],
    tokenBudget: 100_000, maxOutputTokens: 100, ...input });
}

export function selectionOptions(
  idsAndBuilder: Omit<SelectionOptions, 'previewRequest' | 'reasoningReplay'>,
  previewRequest: PreviewFn, reasoningReplay: NonNullable<RunAppInput['reasoningReplay']> = 'current_run',
): SelectionOptions {
  // Caller supplies the history-id set, protected ids and builder using K's public
  // options type. Their field spellings are not specified by ruling 3.
  return { ...idsAndBuilder, reasoningReplay, previewRequest: async request => previewRequest(request) };
}

export function fixtureTool(name: string, execute: ToolDefinition['handler']['execute']): ToolDefinition {
  return { name, description: `${name} fixture`, inputSchema: toolSchema.object({}),
    handler: { execute }, effectClass: 'read_only', requiredCapabilities: [],
    defaultTimeoutMs: 5_000, outputLimitBytes: 1_000_000, independentReadOnly: true,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }) };
}
