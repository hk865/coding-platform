/**
 * PROBE-ONLY driver for the §5.2 D2 byte proof (cases no listed test reaches).
 * apply-probe.py copies this file into tests/runtime/__probe-cases.test.ts in a
 * scratch copy; it never enters the result. It calls the existing public
 * entries (createTargetPlatform / runObservedModel) with a scripted model and
 * relies only on existing test helpers.
 *
 * Cases:
 *   1  Work Run with every coordination group (mailbox, user decision,
 *      whiteboard, session discovery, graph, note)
 *   3  review Run            (needsDecisionCard starts the real review round)
 *   4  proposal Run          (answer safer_method + proposalRound)
 *   5  Run with blocked commands / rerun tool (skip_as_done leaves the binding)
 *   8  fixed-source Run      (read_source + read_material enabled)
 *
 * The eight-case table in README maps 2/6/7 to the checked-in tests.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_AT, AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, permissionRevision,
} from '../helpers/AG2b-collaboration-fixture.js';
import { createScriptedModel, type ScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupScenarios, HostScenario, hostCtx, type Platform } from '../scenarios/harness.js';
import { ag2bWorkRuntime, ag2bWorkspaceBindings } from '../scenarios/harness.js';
import { answerCard, needsDecisionCard, proposalRound } from '../scenarios/support/review-card-round.js';
import { preparedOf, redrivePolicy } from '../scenarios/support/common.js';
import { prepareOn } from '../scenarios/support/shell-work-root.js';

// The same shell seam / process-sandbox stand-in the scenario tests use; no
// host process runs and the fixture's crash chain keeps its call in flight.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('../scenarios/support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

/** openShellWorkRoot's composition, but with a caller-chosen Host tool grant. */
async function openProbeWorkRoot(h: HostScenario, model: ScriptedModel, tools: readonly string[]): Promise<Platform> {
  const base = ag2bWorkRuntime(() => model, { tools });
  return await createTargetPlatform({
    storage: { kind: 'sqlite', directory: h.database },
    workspace: ag2bWorkspaceBindings(h.root, { value: 1 }, permissionRevision(h.stepActor(), AG2B_SCOPE, ['.'])),
    now: () => AG2B_AT,
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(h.database, 'kernel.sqlite') }] },
    runtime: base,
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 1_000_000, deadline: null } }] },
  });
}

describe('probe-only D2 drivers', () => {
  it('probe case 1: Work Run with every coordination group', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const model = createScriptedModel([{ kind: 'text', text: 'probe all-groups work answer' }]);
    const tools = ['read', 'write', 'send_session_message',
      'send_user_message', 'read_user_decision', 'record_decision_application',
      ...WHITEBOARD_TOOL_NAMES,
      'find_related_sessions', 'read_session_card', 'look_graph', 'find_graph', 'record_note'];
    const platform = await openProbeWorkRoot(h, model, tools);
    try {
      const start = await prepareOn(platform, h.select('probe-case-1', AG2B_WORK_TASK_ID));
      const prepared = preparedOf(start);
      const started = await platform.runtime.startRun(hostCtx(), { prepared,
        consumerId: AG2B_CONSUMER_ID, requestId: 'probe-case-1-start' });
      expect(started.status, JSON.stringify(started)).toBe('ready');
    } finally {
      await platform.close();
    }
  }, 180_000);

  it('probe case 3 + 4: review Run then proposal Run', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    // needsDecisionCard starts a real review-phase Run (record_unknown_call_review).
    const { card } = await needsDecisionCard(h, 'probe-case-3');
    // The safer_method answer moves the record to awaiting_proposal.
    const answered = await answerCard(h, card, 'safer_method', 'probe-case-3-answer', 'probe note');
    expect(answered.status, JSON.stringify(answered)).toBe('ready');
    const model = createScriptedModel([{ kind: 'text', text: 'probe proposal answer' }]);
    const round = await proposalRound(h, { model, select: 'probe-case-4', requestId: 'probe-case-4-start' });
    try {
      const started = await round.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
    } finally {
      await round.close();
    }
  }, 300_000);

  it('probe case 5: Work Run with blocked commands (rerun tool)', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { card } = await needsDecisionCard(h, 'probe-case-5');
    // skip_as_done keeps the blocked command binding; the next prepared Run
    // carries it and the driver registers request_command_rerun.
    const skipped = await answerCard(h, card, 'skip_as_done', 'probe-case-5-skip', 'already handled');
    expect(skipped.status, JSON.stringify(skipped)).toBe('ready');
    const model = createScriptedModel([{ kind: 'text', text: 'probe blocked work answer' }]);
    const platform = await openProbeWorkRoot(h, model, ['read', 'write', 'send_session_message']);
    try {
      const start = await prepareOn(platform, h.select('probe-case-5-start', AG2B_WORK_TASK_ID));
      const prepared = preparedOf(start);
      const started = await platform.runtime.startRun(hostCtx(), { prepared,
        consumerId: AG2B_CONSUMER_ID, requestId: 'probe-case-5-start' });
      expect(started.status, JSON.stringify(started)).toBe('ready');
    } finally {
      await platform.close();
    }
  }, 300_000);

  it('probe case 8: fixed-source Run (read_source + read_material)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'probe-fixed-source-'));
    try {
      const root = join(directory, 'workspace');
      await mkdir(root, { recursive: true });
      await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
      const requests: kernel.ModelRequest[] = [];
      const client: kernel.ModelClientPort = {
        async *stream(request) {
          requests.push(structuredClone(request));
          const base = { schemaVersion: 1 as const, requestId: request.requestId };
          yield { ...base, sequence: 1, type: 'text_delta', delta: 'probe fixed-source answer' };
          yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
        },
      };
      const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512,
        maxRequests: 12, maxToolCalls: 16, timeoutMs: 30_000 };
      const readMaterial: ToolDefinition = {
        name: 'read_material', description: 'probe-only read_material definition', inputSchema: kernel.toolSchema.object({}).strict(),
        effectClass: 'read_only', requiredCapabilities: ['workspace_read'], defaultTimeoutMs: 10_000,
        outputLimitBytes: 65_536, independentReadOnly: true,
        summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
        handler: { async execute(call) {
          return { schemaVersion: 1, callId: call.callId, status: 'success', output: [],
            effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
        } },
      };
      const options: ObservedModelRunOptions = {
        kernel,
        bound: { configuration: { revision: 'probe-fixed-source', provider: 'deepseek', model: 'probe-scripted',
          baseUrl: 'http://127.0.0.1' }, client },
        meter: new ModelBudget(budget, async () => {}, {
          count: () => ({ tokens: 256, method: 'model_tokenizer', tokenizer: 'probe-counter' }) }),
        root, databasePath: join(directory, 'kernel.sqlite'), sessionId: 'probe-fixed-source',
        input: 'probe fixed-source turn', budget, taskBudget: { tokenBudget: null, deadline: null },
        readOnly: true, signal: new AbortController().signal, deniedPrefixes: [],
        processSandboxOptions: {}, publish: async () => {},
        allowedTools: ['read'],
        sourceTools: { includeReadSource: true, allowedPath: () => true },
        materialTools: () => [readMaterial],
      };
      const result = await runObservedModel(options);
      expect(result.state.status).toBe('completed');
      expect(requests[0]?.tools.map(tool => tool.name)).toContain('read_source');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
