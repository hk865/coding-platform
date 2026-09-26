/**
 * R4.3b Kernel 历史投影接缝（阶段一骨架）。
 *
 * 只通过冻结公开入口 `vendor/coding-agent/dist/public-api.js` 使用真实
 * `runCodingAgent`、`projectTerminalTranscript`、`assertTranscriptExchangeIntegrity`、
 * `SqliteStores` 与脚本化模型；不导入 Kernel 私有路径，也不 raw seed RunState。
 *
 * 场景：脚本模型一次声明两个串行组；第一组真实结算，第二组在真实取消后从未 started，
 * 由原 `run-state-reducer` 在终态标为 abandoned。原记录仍含第二组声明且没有它的结果。
 *
 * 阶段一预期：只发布了 `projectTerminalTranscript` 的签名与消费者接缝，函数显式抛
 * `StoreError('version_unsupported', ...)`。因此本测试在首次投影处即为首红，且失败必须
 * 来自该接缝；投影算法与后继前缀消费留待阶段二，本测试后续断言此时尚未到达。
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProviderRegistry,
  SqliteStores,
  appConfigSchema,
  assertTranscriptExchangeIntegrity,
  projectTerminalTranscript,
  runCodingAgent,
  toolSchema as z,
  type ModelClientPort,
  type ModelEvent,
  type ModelRequest,
  type RunLimits,
  type SessionRecord,
  type ToolCall,
  type ToolDefinition,
  type ToolGroupBarrier,
  type ToolResult,
} from '../../vendor/coding-agent/dist/public-api.js';

const SKILL_ROOT = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type ScriptedReply =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tools'; readonly calls: readonly { readonly callId: string; readonly name: string }[] };

class ScriptedModel implements ModelClientPort {
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
    if (!reply) throw new Error('R4.3b ScriptedModel: replies exhausted');
    const base = { schemaVersion: 1 as const, requestId: request.requestId };
    let sequence = 1;
    if (reply.kind === 'text') {
      yield { ...base, sequence: sequence++, type: 'text_delta', delta: reply.text };
      yield { ...base, sequence, type: 'completed', reason: 'final_answer' };
      return;
    }
    for (const [ordinal, call] of reply.calls.entries()) {
      yield {
        ...base,
        sequence: sequence++,
        type: 'tool_call_started',
        callId: call.callId,
        name: call.name,
        ordinal,
      };
      yield {
        ...base,
        sequence: sequence++,
        type: 'tool_arguments_delta',
        callId: call.callId,
        delta: '{}',
      };
    }
    yield { ...base, sequence, type: 'completed', reason: 'tool_calls' };
  }
}

function serialTool(
  name: string,
  execute: (call: ToolCall) => Promise<ToolResult>,
): ToolDefinition {
  return {
    name,
    description: `${name} R4.3b fixture`,
    inputSchema: z.object({}).strict(),
    effectClass: 'workspace_write',
    requiredCapabilities: ['workspace_write'],
    defaultTimeoutMs: 1_000,
    outputLimitBytes: 1_024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call) => execute(structuredClone(call) as ToolCall) },
  };
}

function successResult(callId: string): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: 'success',
    output: [{ kind: 'text', text: `${callId}:ok` }],
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
  };
}

function limits(maxModelRequests: number): RunLimits {
  return {
    maxModelRequests,
    maxToolCalls: 8,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  };
}

async function readRecords(databasePath: string, sessionId: string): Promise<SessionRecord[]> {
  const store = await SqliteStores.open(databasePath);
  try {
    const all: SessionRecord[] = [];
    let position = 0;
    for (;;) {
      const page = await store.read(sessionId, position, 256, {
        signal: new AbortController().signal,
      });
      all.push(...page.records);
      position = page.records.at(-1)?.position ?? position;
      if (page.nextPosition === null) return all;
    }
  } finally {
    await store.close();
  }
}

function startedCallIds(records: readonly SessionRecord[]): string[] {
  return records.flatMap((record) =>
    record.recordType === 'agent.event' && record.payload.event.type === 'tool.started'
      ? [record.payload.event.payload.call.callId]
      : [],
  );
}

async function cancelHarness() {
  const root = await mkdtemp(path.join(tmpdir(), 'r43b-kernel-'));
  tempRoots.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  const databasePath = path.join(root, 'session.sqlite');
  const config = appConfigSchema.parse({
    schemaVersion: 1,
    model: { provider: 'deepseek', model: 'r43b-local', options: {}, maxOutputTokens: 128 },
    runtime: { tokenBudget: 20_000, maxModelRequests: 8, maxToolCalls: 8 },
    tools: { enabledNames: ['r43b-tool-a', 'r43b-tool-b'] },
    storage: { databasePath },
    skills: { resourceRoot: SKILL_ROOT, enabledIds: ['coding-safety'] },
    memory: { provider: 'empty' },
  });
  const model = new ScriptedModel([
    {
      kind: 'tools',
      calls: [
        { callId: 'r43b-g1', name: 'r43b-tool-a' },
        { callId: 'r43b-g2', name: 'r43b-tool-b' },
      ],
    },
    { kind: 'text', text: 'this provider reply must never run after the boundary cancel' },
  ]);
  const providerRegistry = new ProviderRegistry().register({
    id: 'deepseek',
    secretEnvironmentVariable: 'DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => model,
  });
  const sessionId = 'r43b-session';
  return {
    model,
    databasePath,
    sessionId,
    common: {
      config,
      workspaceRoot,
      sessionId,
      providerRegistry,
      secretSource: { get: () => 'synthetic-fixture-key' },
    },
  };
}

describe('R4.3b Kernel terminal transcript projection seam', () => {
  it('removes only the reducer-proven abandoned declaration from a copy and preserves the original cancelled records', async () => {
    const h = await cancelHarness();
    const controller = new AbortController();
    const invocations: string[] = [];
    const barrier: ToolGroupBarrier = async (invocation) => {
      invocations.push(`${invocation.point}:${invocation.callIds.join(',')}`);
      if (invocation.point === 'after_group' && invocation.callIds.includes('r43b-g1')) {
        controller.abort('caller_requested');
      }
      return { kind: 'continue' };
    };
    const result = await runCodingAgent({
      ...h.common,
      input: 'declare two serial groups, settle the first, cancel the second',
      executionIdentity: { runId: 'r43b-run', turnId: 'r43b-turn' },
      limits: limits(4),
      additionalTools: () => [
        serialTool('r43b-tool-a', async (call) => successResult(call.callId)),
        serialTool('r43b-tool-b', async (call) => successResult(call.callId)),
      ],
      hostAuthorizedTools: ['r43b-tool-a', 'r43b-tool-b'],
      toolGroupBarrier: barrier,
      signal: controller.signal,
    });

    // The real Kernel is genuinely cancelled exactly at the serial group boundary.
    expect(result.state.status).toBe('cancelled');
    expect(invocations).toEqual(['before_group:r43b-g1', 'after_group:r43b-g1']);
    expect(h.model.requests).toHaveLength(1);
    const abandoned = result.state.toolBatch?.calls.find(
      (call) => call.requestedCall.callId === 'r43b-g2',
    );
    expect(abandoned).toMatchObject({ status: 'abandoned', result: null });
    const settled = result.state.toolBatch?.calls.find(
      (call) => call.requestedCall.callId === 'r43b-g1',
    );
    expect(settled?.status).toBe('completed');

    // The original reduced transcript still declares BOTH calls and carries only
    // the settled g1 result; the strict pairing therefore rejects the original.
    const originalAssistant = result.state.transcript.find(
      (entry) => entry.kind === 'assistant_message',
    );
    expect(originalAssistant?.kind).toBe('assistant_message');
    if (originalAssistant?.kind !== 'assistant_message') return;
    expect(originalAssistant.toolCalls.map((call) => call.callId)).toEqual(['r43b-g1', 'r43b-g2']);
    expect(
      result.state.transcript
        .filter((entry) => entry.kind === 'tool_result')
        .map((entry) => entry.callId),
    ).toEqual(['r43b-g1']);
    expect(() =>
      assertTranscriptExchangeIntegrity(result.state.transcript, 'r43b-original'),
    ).toThrow();

    // The persisted raw records keep the genuine cancellation and never started g2.
    const records = await readRecords(h.databasePath, h.sessionId);
    expect(
      records.filter(
        (record) =>
          record.recordType === 'agent.event' && record.payload.event.type === 'run.cancelled',
      ),
    ).toHaveLength(1);
    expect(startedCallIds(records)).toEqual(['r43b-g1']);

    // Stage-2 target: the shared pure projection omits ONLY the never-started
    // declaration from a copy, keeps the settled result, and never mutates the
    // borrowed state. In stage 1 this call is the first red at the published
    // `version_unsupported` seam; the assertions below are the not-yet-reached tail.
    const stateSnapshot = structuredClone(result.state);
    const projected = projectTerminalTranscript(result.state);
    expect(result.state).toEqual(stateSnapshot);
    const projectedAssistant = projected.find((entry) => entry.kind === 'assistant_message');
    expect(projectedAssistant, 'the projection must keep the assistant message').toBeDefined();
    expect(projectedAssistant?.kind, 'the projection must keep an assistant_message').toBe('assistant_message');
    if (projectedAssistant?.kind !== 'assistant_message') return;
    expect(projectedAssistant.toolCalls.map((call) => call.callId)).toEqual(['r43b-g1']);
    expect(projectedAssistant.message.content).toBe(originalAssistant.message.content);
    expect(projectedAssistant.message.reasoningContent).toBe(originalAssistant.message.reasoningContent);
    expect(
      projected.filter((entry) => entry.kind === 'tool_result').map((entry) => entry.callId),
    ).toEqual(['r43b-g1']);
    expect(() =>
      assertTranscriptExchangeIntegrity(projected, 'r43b-projected'),
    ).not.toThrow();
  });
});
