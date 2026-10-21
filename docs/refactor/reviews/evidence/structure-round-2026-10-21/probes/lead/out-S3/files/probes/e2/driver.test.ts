/**
 * COPY-ONLY probe driver (S3/D3a). It covers the cases no repository test
 * reaches through `runObservedModel`'s `additionalTools` seam: the whiteboard
 * group's other three tools, the three user-decision tools, the review tool,
 * the proposal tool, the blocked-command rerun tool and `read_source`.
 *
 * Copied into a scratch copy under tests/probe-e2/ by run-capture.sh; it calls
 * the existing public entry `runObservedModel` with a local scripted client.
 * It adds no production export.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import {
  SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES, createSessionMailboxTools,
} from '../../src/core/agent-runtime/communication-tools.js';
import { WHITEBOARD_TOOL_NAMES, createWhiteboardTools } from '../../src/core/agent-runtime/whiteboard-tools.js';
import { SESSION_DISCOVERY_TOOL_NAMES, createSessionDiscoveryTools } from '../../src/core/agent-runtime/session-discovery-tools.js';
import { GRAPH_TOOL_NAMES, createGraphTools } from '../../src/core/agent-runtime/graph-tools.js';
import { NOTE_TOOL_NAMES, createNoteTools } from '../../src/core/agent-runtime/note-tool.js';
import {
  RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME, createUnknownCallReviewTools,
} from '../../src/core/agent-runtime/unknown-call-review-tools.js';
import {
  REQUEST_COMMAND_RERUN_TOOL_NAME, createCommandRerunTools,
} from '../../src/core/agent-runtime/command-rerun-tools.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const context = {
  projectId: 'e2-project',
  workspaceId: 'e2-workspace',
  principal: {
    kind: 'work_run' as const,
    runRef: { aggregateType: 'Run' as const, projectId: 'e2-project', goalId: 'e2-goal', runId: 'e2-run' },
    roleBinding: { schemaVersion: 1 as const, bindingId: 'e2-binding', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
  },
  materialReader: { kind: 'run' as const, requester: { aggregateType: 'Run' as const, projectId: 'e2-project', goalId: 'e2-goal', runId: 'e2-run' } },
  signal: new AbortController().signal,
};
const goalRef = { aggregateType: 'Goal' as const, projectId: 'e2-project', goalId: 'e2-goal' };
const requestIdForCall = (call: { callId: string }) => `e2:${call.callId}`;

function scriptedClient() {
  const requests: unknown[] = [];
  const client = {
    async *stream(request: { requestId: string }) {
      requests.push(structuredClone(request));
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      let sequence = 0;
      yield { ...base, sequence: ++sequence, type: 'text_delta' as const, delta: 'e2 probe answer' };
      yield { ...base, sequence: ++sequence, type: 'completed' as const, reason: 'final_answer' as const };
    },
  };
  return { client, requests };
}

function coordination() {
  const mailbox = createSessionMailboxTools({
    mailbox: {} as never,
    decisionMessages: {} as never,
    context: context as never,
    sessionRef: { aggregateType: 'Session', projectId: 'e2-project', sessionId: 'e2-session' } as never,
    requestIdForCall,
  });
  const whiteboard = createWhiteboardTools({
    plans: {} as never, context: context as never, goalRef, requestIdForCall,
  });
  const discovery = createSessionDiscoveryTools({ sessions: {} as never, context: context as never });
  const graph = createGraphTools({
    context: context as never, goalRef, graph: {} as never, inputs: {} as never, history: {} as never,
  });
  const note = createNoteTools({
    context: context as never, notes: {} as never, check: {} as never, requestIdForCall,
  });
  const handles = [mailbox, whiteboard, discovery, graph, note];
  return {
    names: [
      ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES,
      ...SESSION_DISCOVERY_TOOL_NAMES, ...GRAPH_TOOL_NAMES, ...NOTE_TOOL_NAMES,
    ],
    create: () => handles.flatMap(handle => handle.create({} as never)),
  };
}

function reviewTool(phase: 'review' | 'proposal') {
  const handle = createUnknownCallReviewTools({
    reviews: {} as never,
    context: context as never,
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'e2-project', goalId: 'e2-goal', runId: 'e2-origin-run' } as never,
    requestIdForCall,
    phase,
  });
  return { handle, definition: handle.create({} as never)[0]! };
}

async function runOnce(extra: Partial<ObservedModelRunOptions>) {
  const directory = await mkdtemp(join(tmpdir(), 's85-e2-probe-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  const budget = {
    ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512,
    maxRequests: 4, maxToolCalls: 4, timeoutMs: 30_000,
  };
  const scripted = scriptedClient();
  const options: ObservedModelRunOptions = {
    kernel,
    bound: {
      configuration: { revision: 'e2-probe', provider: 'deepseek', model: 'e2-scripted', baseUrl: 'http://127.0.0.1' },
      client: scripted.client as never,
    },
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 8, method: 'model_tokenizer', tokenizer: 'e2-probe-counter' }),
    }),
    root, databasePath: join(directory, 'kernel.sqlite'), sessionId: 'e2-probe-session',
    input: 'E2 probe turn.', budget,
    taskBudget: { tokenBudget: null, deadline: null },
    readOnly: true, allowedTools: ['read'], signal: new AbortController().signal,
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
    sourceTools: { includeReadSource: true },
    ...extra,
  };
  const result = await runObservedModel(options);
  expect(result.state.status).toBe('completed');
  expect(scripted.requests.length).toBeGreaterThan(0);
}

it('probe e2: every coordination group, read_source, review and rerun register once through the real seam', async () => {
  const review = reviewTool('review');
  const rerun = createCommandRerunTools({
    requests: {} as never, context: context as never,
    task: { projectId: 'e2-project', goalId: 'e2-goal', taskId: 'e2-task' } as never,
    requestIdForCall,
  });
  const rerunDefinition = rerun.create({} as never)[0]!;
  expect(rerunDefinition.name).toBe(REQUEST_COMMAND_RERUN_TOOL_NAME);
  await runOnce({
    coordinationTools: coordination(),
    unknownCallReviewTool: () => review.definition,
    unknownCallReviewToolName: RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
    commandRerunTool: () => rerunDefinition,
    commandRerunToolName: REQUEST_COMMAND_RERUN_TOOL_NAME,
  });
}, 60_000);

it('probe e2: the proposal round registers propose_safer_method through the real seam', async () => {
  const proposal = reviewTool('proposal');
  await runOnce({
    unknownCallReviewTool: () => proposal.definition,
    unknownCallReviewToolName: proposal.definition.name,
  });
}, 60_000);
