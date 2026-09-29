/**
 * AG2 Stage-1 explicit consultation contract.
 *
 * Frozen task-book shape (docs/refactor/tasks/AG2-consultation-2026-09-28.md):
 *   - one plain HTTP route `workflow/consultation` bound to the optional
 *     `WorkflowPort.consumeConsultation`;
 *   - `QueryJobIntentV1.execution.consultation = { messageRef, recipient }` on a
 *     `semantic_query`, whose QueryJob/QueryRun ids come ONLY from the complete
 *     messageRef (`consultation-<hash>` / `consultation-run-<hash>`);
 *   - `SessionMailboxPort.respondFromQueryAnswer` derives a `query_run` reply
 *     sender from the settled official Answer and writes the original message's
 *     single response slot.
 *
 * Production does not publish any of that yet, so each scenario's FIRST RED is
 * the REAL HTTP boundary (`404 unpublished core route workflow/consultation`) or
 * the missing consultation admission at the formal `queries/submit`; it is never
 * a missing import, a wrong fixture or a forged terminal fact. Every assertion
 * below the first RED is the frozen final shape for Stage 2.
 *
 * The chain reuses the R6 execution-entry Host fixture pattern: a real
 * `loadWorkbenchCliConfig` startup file, a real SQLite ledger + Kernel store and
 * a controlled Kernel provider, with the repository vendor Skill root and the
 * real instruction digest. It never edits an internal record.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { loadWorkbenchCliConfig } from '../../src/app/main.js';
import { ProviderRegistry, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { QueryExecutionRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import {
  BOOTSTRAP_SUFFIX,
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  type BootstrapResponse,
  type CoreScope,
  type CreateSessionRequest,
  type OperationReceipt,
  type PreparedQueryExecution,
  type RoleConfigurationRef,
  type SessionCard,
  type SessionMessage,
  type SessionPage,
  type SessionRecord,
  type SessionRef,
} from '../../src/app/core-http-types.js';

const projectDir = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const at = '2026-09-28T00:00:00.000Z';
const scope: CoreScope = { projectId: 'ag2-consultation-project', workspaceId: 'ag2-consultation-workspace' };
const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: 'ag2-goal' };

const SECRET_VAR = 'AG2_CONTROLLED_SECRET';
const SECRET_VALUE = 'ag2-controlled-secret-value';
const QUERY_INSTRUCTION = 'AG2 consultation trusted read-only query guidance';
const CONSUMER_ID = 'ag2-consumer';
const SESSION_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
const QUERY_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'ag2-query-role-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1',
};
const RUNTIME_BUDGET: RuntimeBudget = {
  contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8,
  maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512,
};
const QUERY_BUDGET = { maxTokens: 200000, deadline: null };

let publicDir = '';
const temporary: string[] = [];

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'ag2-consultation-public-'));
  temporary.push(publicDir);
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: projectDir, encoding: 'utf8', env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  if (build.status !== 0) throw new Error(`workbench build failed: ${build.stdout}\n${build.stderr}`);
}, 60_000);

afterAll(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Started = {
  host: LocalWorkbenchHost; base: string; token: string; root: string; database: string;
  scripted: ReturnType<typeof createScriptedModel>;
};

type StartOverrides = {
  root?: string;
  database?: string;
  replies?: readonly ScriptedReply[];
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
};

/** One real Host over the CLI startup file, a real SQLite ledger/Kernel and a
 * controlled Kernel provider. The vendor Skill root and the real instruction
 * digest are the trusted startup facts; nothing here is request input. */
async function startConsultationHost(overrides: StartOverrides = {}): Promise<Started> {
  const root = overrides.root ?? await mkdtemp(join(tmpdir(), 'ag2-consultation-ws-'));
  const database = overrides.database ?? await mkdtemp(join(tmpdir(), 'ag2-consultation-db-'));
  const configDir = await mkdtemp(join(tmpdir(), 'ag2-consultation-config-'));
  if (overrides.root === undefined) temporary.push(root);
  if (overrides.database === undefined) temporary.push(database);
  temporary.push(configDir);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'module.ts'), 'export const ag2Marker = "AG2_CONSULTATION_SOURCE";\n');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
  }));
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  const scripted = createScriptedModel(overrides.replies ?? [], overrides.beforeReply);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => scripted.client,
  });
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [{
      id: 'ag2-query-binding', label: 'AG2 query runtime', scope, role: SESSION_ROLE,
      configurationRevision: 'ag2-query-host@1',
      model: { revision: 'ag2-query-model@1', provider: 'deepseek', model: 'ag2-scripted-query', secretEnvironmentVariable: SECRET_VAR },
      grant: {
        budget: RUNTIME_BUDGET,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(QUERY_INSTRUCTION) },
        tools: ['read', 'project_source'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
        systemInstruction: QUERY_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      },
    }],
    queryProfiles: [{
      id: 'ag2-consult', label: 'AG2 read-only consultation', scope, runtimeBindingId: 'ag2-query-binding',
      sessionRole: SESSION_ROLE, roleBinding: QUERY_ROLE_BINDING, runtimeBudget: RUNTIME_BUDGET,
      budget: QUERY_BUDGET, consumerId: CONSUMER_ID,
    }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: CONSUMER_ID,
    bindings: [{ workspace: scope, sessionRole: SESSION_ROLE, roleBinding: QUERY_ROLE_BINDING,
      budget: { tokenBudget: 100000, deadline: null } }],
  };
  const configPath = join(configDir, 'workbench.json');
  await writeFile(configPath, JSON.stringify({
    sqliteDirectory: database,
    actor: { kind: 'human', id: 'ag2-operator' },
    workspaces: [{ scope, name: 'AG2 consultation workspace', root, workspaceRevision: 1, readPrefixes: ['src'] }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 'ag2-kernel', storeKey: 'ag2-kernel-store', workspace: scope,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtime,
    workflow,
  }));
  const loaded = await loadWorkbenchCliConfig(configPath);
  const host = await createLocalWorkbenchHost({
    ...loaded,
    publicDir,
    now: () => at,
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === SECRET_VAR ? SECRET_VALUE : undefined } },
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token, root, database, scripted };
}

async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

const coreUrl = (base: string, suffix: string): string => new URL(CORE_API_PREFIX + suffix, base).toString();

async function coreGet(base: string, suffix: string, token: string): Promise<Response> {
  return fetch(coreUrl(base, suffix), { headers: { [PLATFORM_TOKEN_HEADER]: token } });
}

async function corePost(base: string, suffix: string, token: string | undefined, body: unknown): Promise<Response> {
  return fetch(coreUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { [PLATFORM_TOKEN_HEADER]: token }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const graphWrite = (input: unknown, requestId: string, expected: unknown[] = []) =>
  ({ scope, request: { input, meta: { requestId, expected } } });
const plain = (input: unknown) => ({ scope, input });

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

/** The frozen `consultationQueryRefs(messageRef)` identity: the canonical
 * SHA-256 of the complete messageRef decides the one QueryJob/QueryRun pair. */
function consultationQueryRefs(messageRef: SessionMessageRef): { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef } {
  const hash = sha256Hex(canonicalJson(messageRef as unknown as JsonValue));
  const queryJobId = `consultation-${hash}`;
  return {
    queryJobRef: { aggregateType: 'QueryJob', projectId: messageRef.projectId, workspaceId: messageRef.workspaceId, queryJobId },
    queryRunRef: { aggregateType: 'QueryRun', projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
      queryJobId, runId: `consultation-run-${hash}` },
  };
}

function refsFor(queryJobId: string, runId: string): { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef } {
  return {
    queryJobRef: { aggregateType: 'QueryJob', ...scope, queryJobId },
    queryRunRef: { aggregateType: 'QueryRun', ...scope, queryJobId, runId },
  };
}

/** The frozen `ConsultationInput`: no caller-supplied recipient, no answerRef. */
function consultationInput(messageRef: SessionMessageRef): Record<string, unknown> {
  return {
    schemaVersion: 1,
    messageRef,
    goalRef,
    roleBinding: QUERY_ROLE_BINDING,
    runtimeBudget: RUNTIME_BUDGET,
    budget: QUERY_BUDGET,
    consumerId: CONSUMER_ID,
  };
}

/** A consultation-bound semantic query built through a JSON boundary so the
 * not-yet-typed `execution.consultation` field is a runtime fact, not a TS
 * literal. */
function consultationIntent(
  messageRef: SessionMessageRef, recipient: SessionRef, question: string,
  refs: { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef }, correlationId: string,
): QueryJobIntentV1 {
  return JSON.parse(JSON.stringify({
    schemaVersion: 1, intentId: refs.queryJobRef.queryJobId, projectId: scope.projectId, workspaceId: scope.workspaceId,
    goalId: goalRef.goalId, question, focusTaskRefs: [], budget: QUERY_BUDGET, multiTurn: { maxRounds: 1 }, correlationId,
    execution: { kind: 'semantic_query', roleBinding: QUERY_ROLE_BINDING, runtimeBudget: RUNTIME_BUDGET,
      consultation: { messageRef, recipient } },
  })) as QueryJobIntentV1;
}

function plainIntent(refs: { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef }, question: string, correlationId: string): QueryJobIntentV1 {
  return JSON.parse(JSON.stringify({
    schemaVersion: 1, intentId: refs.queryJobRef.queryJobId, projectId: scope.projectId, workspaceId: scope.workspaceId,
    goalId: goalRef.goalId, question, focusTaskRefs: [], budget: QUERY_BUDGET, multiTurn: { maxRounds: 1 }, correlationId,
    execution: { kind: 'semantic_query', roleBinding: QUERY_ROLE_BINDING, runtimeBudget: RUNTIME_BUDGET },
  })) as QueryJobIntentV1;
}

function submitBody(refs: { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef }, intent: QueryJobIntentV1, requestId: string) {
  return graphWrite({ queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId, intent }, requestId, [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 1 },
    { ref: refs.queryJobRef, revision: 0 }, { ref: refs.queryRunRef, revision: 0 },
  ]);
}

function claimBody(refs: { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef }, sessionRef: SessionRef, sessionRevision: number, requestId: string) {
  return graphWrite({ queryRunRef: refs.queryRunRef, sessionRef }, requestId, [
    { ref: refs.queryJobRef, revision: 1 }, { ref: refs.queryRunRef, revision: 1 },
    { ref: sessionRef, revision: sessionRevision },
  ]);
}

async function seedGoal(started: Started, suffix: string): Promise<void> {
  const project = await corePost(started.base, 'projects/create', started.token,
    graphWrite({ projectId: scope.projectId }, `ag2-project-${suffix}`, [{ ref: projectRef, revision: 0 }]));
  expect(await project.json()).toMatchObject({ status: 'committed' });
  const workspace = await corePost(started.base, 'workspaces/register', started.token,
    graphWrite({ workspace: scope }, `ag2-workspace-${suffix}`, [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }]));
  expect(await workspace.json()).toMatchObject({ status: 'committed' });
  const goal = await corePost(started.base, 'goals/create', started.token,
    graphWrite({ goalId: goalRef.goalId, workspace: scope, objective: 'Deliver the AG2 explicit consultation' },
      `ag2-goal-${suffix}`, [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }]));
  expect(await goal.json()).toMatchObject({ status: 'committed' });
}

async function createSession(started: Started, requestId: string): Promise<{ sessionRef: SessionRef; sessionAggregateRef: SessionRef; revision: number }> {
  const response = await corePost(started.base, 'sessions/create', started.token, plain({
    workspace: scope, role: SESSION_ROLE, recommendedRefs: [], initialLinks: [],
    meta: { requestId, expected: [] },
  } satisfies CreateSessionRequest));
  expect(response.status).toBe(200);
  const body = await response.json() as OperationReceipt<SessionRecord>;
  expect(body.status).toBe('completed');
  if (body.status !== 'completed') throw new Error(`real Session creation did not complete: ${JSON.stringify(body)}`);
  // The mailbox takes the plain SessionRef; the Query claim's CAS pins require
  // the full Session aggregate ref. Both come from the same created record and
  // are never reconstructed from a fixture constant.
  const sessionRef: SessionRef = { projectId: body.value.ref.projectId, sessionId: body.value.ref.sessionId };
  const sessionAggregateRef: SessionRef = body.value.ref;
  return { sessionRef, sessionAggregateRef, revision: body.value.revision };
}

async function sendMessage(started: Started, recipient: SessionRef, text: string, requestId: string, intent: 'inquiry' | 'action_request' = 'inquiry'): Promise<SessionMessageRef> {
  const response = await corePost(started.base, 'messages/send', started.token, graphWrite({ recipient, text, intent, needsReply: true }, requestId, []));
  expect(response.status).toBe(200);
  const body = await response.json() as WriteResult<SessionMessage>;
  expect(body).toMatchObject({ status: 'committed', value: { status: 'pending', recipient } });
  if (body.status !== 'committed') throw new Error(`real Host message send did not commit: ${JSON.stringify(body)}`);
  return body.value.ref;
}

async function sessionCount(started: Started): Promise<number> {
  const response = await corePost(started.base, 'sessions/find', started.token,
    plain({ workspace: scope, includeArchived: true, page: { limit: 50 } }));
  const body = await response.json() as ReadResult<SessionPage<SessionCard>>;
  expect(body).toMatchObject({ status: 'ready' });
  return body.status === 'ready' ? body.value.items.length : -1;
}

describe('AG2 explicit consultation over the real Host HTTP', () => {
  // 1. The happy path: one idle recipient, the model reads the real source
  // through the existing tool and the formal Answer is attached verbatim.
  it('answers the original question from the saved formal Query answer and replies on the original message', async () => {
    const question = 'AG2 consultation: read src/module.ts and report the marker';
    const answerText = 'AG2 formal consultation answer from the read source';
    const started = await startConsultationHost({
      replies: [
        { kind: 'calls', calls: [{ callId: 'ag2-source', name: 'project_source',
          args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } }] },
        { kind: 'text', text: answerText },
      ],
      beforeReply: async (request, index) => {
        if (index === 0) {
          expect(JSON.stringify(request.messages), 'the model must see the original message question').toContain(question);
          expect(request.tools.map(tool => tool.name)).toContain('project_source');
        }
        if (index === 1) {
          expect(JSON.stringify(request.messages), 'the real source read result must reach the answer turn')
            .toContain('AG2_CONSULTATION_SOURCE');
        }
      },
    });
    let messageRef: SessionMessageRef | undefined;
    try {
      // The public bootstrap is the real safe projection of the trusted profile.
      const bootstrap = await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token);
      expect(bootstrap.status).toBe(200);
      const bootstrapBody = await bootstrap.json() as BootstrapResponse;
      expect(bootstrapBody.execution.queryProfiles).toHaveLength(1);
      expect(bootstrapBody.execution.queryProfiles[0]?.id).toBe('ag2-consult');
      expect(JSON.stringify(bootstrapBody)).not.toContain(SECRET_VALUE);

      await seedGoal(started, 'happy');
      const created = await createSession(started, 'ag2-happy-session');
      const recipientRef = created.sessionRef;
      messageRef = await sendMessage(started, recipientRef, question, 'ag2-happy-message');
      // Receiving durable mail never starts a model and never wakes the idle
      // recipient or changes its lifecycle.
      expect(started.scripted.calls()).toBe(0);
      expect(await (await corePost(started.base, 'sessions/read', started.token, plain(recipientRef))).json())
        .toMatchObject({ status: 'ready', value: { availability: 'idle',
          record: { lifecycle: 'active', occupancy: null } } });

      const refs = consultationQueryRefs(messageRef);
      const consultation = await corePost(started.base, 'workflow/consultation', started.token, plain(consultationInput(messageRef)));
      // FIRST RED (Stage 1): the route is not published yet, so the real HTTP
      // boundary answers 404 `unpublished core route workflow/consultation`.
      expect(consultation.status).toBe(200);
      const body = await consultation.json() as unknown;
      const value = asRecord(asRecord(body)['value']);
      expect(asRecord(body)).toMatchObject({ status: 'ready' });
      expect(value).toMatchObject({ state: 'responded', reason: null });

      const message = value['message'] as SessionMessage;
      expect(message).toMatchObject({ ref: messageRef, status: 'responded' });
      expect(asRecord(asRecord(value['query'])['job'])).toMatchObject({ ref: refs.queryJobRef });
      const answer = asRecord(value['answer']);
      expect(asRecord(answer['answer'])).toMatchObject({ answer: answerText, runRef: refs.queryRunRef });
      const answerRef = asRecord(answer['ref']);
      const sender = asRecord(asRecord(message.response)['sender']);
      // A′ answers from its own isolated child Session, never from the busy/source
      // recipient; the original message keeps that recipient as its formal target.
      expect(sender).toMatchObject({ kind: 'query_run' });
      const senderRef = asRecord(sender['sessionRef']);
      expect(senderRef).toMatchObject({ projectId: recipientRef.projectId });
      expect(senderRef['sessionId']).not.toBe(recipientRef.sessionId);
      expect(asRecord(sender['queryRunRef'])).toMatchObject({ runId: refs.queryRunRef.runId });
      expect(asRecord(sender['answerRef'])).toMatchObject({ answerId: answerRef['answerId'] });

      const responseBody = await corePost(started.base, 'messages/body', started.token,
        plain({ messageRef, part: 'response' }));
      expect(await responseBody.json()).toMatchObject({ status: 'ready', value: { text: answerText, part: 'response' } });
      // The one tool round plus the final text: exactly two provider streams.
      expect(started.scripted.calls()).toBe(2);

      // Ordinary reads never ack, call a model or create a Task/Plan.
      const callsAfterAnswer = started.scripted.calls();
      const sessionsAfterAnswer = await sessionCount(started);
      expect(await (await corePost(started.base, 'messages/inbox', started.token,
        plain({ recipient: recipientRef, page: { limit: 10 } }))).json())
        .toMatchObject({ status: 'ready', value: { items: [{ ref: messageRef, status: 'responded' }] } });
      expect(await (await corePost(started.base, 'messages/read', started.token, plain(messageRef))).json())
        .toMatchObject({ status: 'ready', value: { status: 'responded' } });
      expect(await (await corePost(started.base, 'messages/body', started.token,
        plain({ messageRef, part: 'message' }))).json())
        .toMatchObject({ status: 'ready', value: { text: question, usage: 'message' } });
      expect(await (await corePost(started.base, 'tasks/query', started.token, plain({ goalRef }))).json())
        .toMatchObject({ status: 'not_found' });
      expect(started.scripted.calls()).toBe(callsAfterAnswer);
      expect(await sessionCount(started)).toBe(sessionsAfterAnswer);

      // Replaying the same consultation reuses the saved pair and adds nothing.
      const replay = await corePost(started.base, 'workflow/consultation', started.token, plain(consultationInput(messageRef)));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ status: 'ready', value: { state: 'responded' } });
      expect(started.scripted.calls()).toBe(callsAfterAnswer);
      expect(await sessionCount(started)).toBe(sessionsAfterAnswer);
    } finally {
      await started.host.close();
    }

    // Reopen the SAME ledger/Kernel: the saved reply is an original fact and
    // processing again must not call the model or create another Session.
    if (messageRef === undefined) throw new Error('the happy-path message was not sent');
    const reopened = await startConsultationHost({ root: started.root, database: started.database, replies: [] });
    try {
      expect(await (await corePost(reopened.base, 'messages/read', reopened.token, plain(messageRef))).json())
        .toMatchObject({ status: 'ready', value: { status: 'responded' } });
      const replay = await corePost(reopened.base, 'workflow/consultation', reopened.token, plain(consultationInput(messageRef)));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ status: 'ready', value: { state: 'responded' } });
      expect(reopened.scripted.calls()).toBe(0);
    } finally {
      await reopened.host.close();
    }
  });

  // 2. A busy recipient stays occupied while its read-only child answers.
  // A consultation bound to another Session is refused by formal submit/claim.
  it('consults a busy source through an isolated child and refuses a non-recipient binding', async () => {
    const question = 'AG2 busy-recipient consultation';
    const started = await startConsultationHost({ replies: [{ kind: 'text', text: 'The isolated source context was consulted.' }] });
    try {
      await seedGoal(started, 'busy');
      const recipient = await createSession(started, 'ag2-busy-recipient');
      const other = await createSession(started, 'ag2-busy-other');

      // Occupy the recipient with a real Query claim; nothing is fabricated.
      const busyRefs = refsFor('ag2-busy-job', 'ag2-busy-run');
      const submitted = await corePost(started.base, 'queries/submit', started.token,
        submitBody(busyRefs, plainIntent(busyRefs, 'occupy the recipient Session', 'ag2-busy-corr'), 'ag2-busy-submit'));
      expect(await submitted.json()).toMatchObject({ status: 'committed' });
      const claimed = await corePost(started.base, 'queries/claim', started.token,
        claimBody(busyRefs, recipient.sessionAggregateRef, recipient.revision, 'ag2-busy-claim'));
      expect(await claimed.json()).toMatchObject({ status: 'committed' });
      expect(await (await corePost(started.base, 'sessions/read', started.token,
        plain(recipient.sessionRef))).json())
        .toMatchObject({ status: 'ready', value: { availability: 'busy' } });

      // Mail still lands while busy, and never wakes the recipient.
      const messageRef = await sendMessage(started, recipient.sessionRef, question, 'ag2-busy-message');
      expect(started.scripted.calls()).toBe(0);
      expect(await (await corePost(started.base, 'messages/inbox', started.token,
        plain({ recipient: recipient.sessionRef, page: { limit: 10 } }))).json())
        .toMatchObject({ status: 'ready', value: { items: [{ ref: messageRef, status: 'pending' }] } });

      const sessionsBefore = await sessionCount(started);
      const consultation = await corePost(started.base, 'workflow/consultation', started.token, plain(consultationInput(messageRef)));
      // FIRST RED (Stage 1): the unpublished route answers 404 before any
      // busy/archive policy can be reached.
      expect(consultation.status).toBe(200);
      const body = await consultation.json() as unknown;
      const status = asRecord(body)['status'];
      expect(status).toBe('ready');
      if (status === 'ready') {
        expect(asRecord(asRecord(body)['value'])).toMatchObject({ state: 'responded', message: { ref: messageRef } });
      }
      // The isolated A′ runs in its own child Session; the busy SOURCE is never
      // occupied, so the inquiry proceeds without waking or blocking it.
      expect(started.scripted.calls()).toBe(1);
      expect(await sessionCount(started)).toBe(sessionsBefore + 1);

      // The formal writers must refuse a consultation whose bound recipient is
      // not the original message recipient.
      const mismatchRefs = consultationQueryRefs(messageRef);
      const mismatchIntent = consultationIntent(messageRef, other.sessionRef, question, mismatchRefs, 'ag2-mismatch-corr');
      const mismatch = await corePost(started.base, 'queries/submit', started.token,
        submitBody(mismatchRefs, mismatchIntent, 'ag2-mismatch-submit'));
      expect(await mismatch.json()).toMatchObject({ status: 'rejected' });
      // Claim a real, correctly bound pending Query on the wrong Session; a
      // missing Query would prove nothing about recipient ownership. The first
      // message already has its derived Query, so use a fresh message identity.
      const freshMessageRef = await sendMessage(started, recipient.sessionRef, 'AG2 wrong-session claim', 'ag2-wrong-message');
      const validRefs = consultationQueryRefs(freshMessageRef);
      const validIntent = consultationIntent(freshMessageRef, recipient.sessionRef, 'AG2 wrong-session claim', validRefs, 'ag2-valid-corr');
      expect(await (await corePost(started.base, 'queries/submit', started.token,
        submitBody(validRefs, validIntent, 'ag2-valid-submit'))).json())
        .toMatchObject({ status: 'committed' });
      const mismatchClaim = await corePost(started.base, 'queries/claim', started.token,
        claimBody(validRefs, other.sessionAggregateRef, other.revision, 'ag2-mismatch-claim'));
      expect([400, 403, 409]).toContain(mismatchClaim.status);
      expect(await mismatchClaim.json()).toMatchObject({ status: 'rejected' });
    } finally {
      await started.host.close();
    }
  });

  // 3. The reachable window: a formal Answer exists while the reply association
  // has not been committed. The consumer only attaches it, the original submit
  // replay keeps its original result, and another message cannot reuse it.
  it('attaches a reply to an already-saved formal answer without re-running the model', async () => {
    const question = 'AG2 window: read the saved formal answer and reply';
    const firstAnswer = 'AG2 saved-answer window reply';
    const secondAnswer = 'AG2 second-message independent answer';
    const started = await startConsultationHost({
      replies: [{ kind: 'text', text: firstAnswer }, { kind: 'text', text: secondAnswer }],
    });
    try {
      await seedGoal(started, 'window');
      const recipient = await createSession(started, 'ag2-window-recipient');
      const messageRef = await sendMessage(started, recipient.sessionRef, question, 'ag2-window-message', 'action_request');
      const refs = consultationQueryRefs(messageRef);
      const intent = consultationIntent(messageRef, recipient.sessionRef, question, refs, 'ag2-window-corr');
      const submit = submitBody(refs, intent, 'ag2-window-submit');

      // Public submit/claim/prepare/start save the official Answer with no reply
      // association yet.
      expect(await (await corePost(started.base, 'queries/submit', started.token, submit)).json())
        .toMatchObject({ status: 'committed' });
      expect(await (await corePost(started.base, 'queries/claim', started.token,
        claimBody(refs, recipient.sessionAggregateRef, recipient.revision, 'ag2-window-claim'))).json())
        .toMatchObject({ status: 'committed' });
      const prepared = await corePost(started.base, 'queries/prepare', started.token,
        plain({ queryRunRef: refs.queryRunRef, requestId: 'ag2-window-prepare' }));
      const preparedBody = await prepared.json() as ReadResult<PreparedQueryExecution>;
      expect(preparedBody).toMatchObject({ status: 'ready' });
      if (preparedBody.status !== 'ready') throw new Error(`window preparation was not ready: ${JSON.stringify(preparedBody)}`);
      const startedQuery = await corePost(started.base, 'queries/start', started.token,
        plain({ prepared: preparedBody.value, consumerId: CONSUMER_ID, requestId: 'ag2-window-start' }));
      const startedBody = await startedQuery.json() as ReadResult<QueryExecutionRecord>;
      expect(startedBody).toMatchObject({ status: 'ready' });
      if (startedBody.status !== 'ready') throw new Error(`window query start was not ready: ${JSON.stringify(startedBody)}`);
      const firstAnswerRef = startedBody.value.answer?.ref;
      if (firstAnswerRef === undefined) throw new Error('the window QueryRun did not record a formal answer');
      expect(started.scripted.calls()).toBe(1);
      // Before the consumer runs, the original message has no response slot.
      expect(await (await corePost(started.base, 'messages/read', started.token, plain(messageRef))).json())
        .toMatchObject({ status: 'ready', value: { status: 'pending', response: null } });

      // The consumer must only attach the saved answer; no second model call.
      const consultation = await corePost(started.base, 'workflow/consultation', started.token, plain(consultationInput(messageRef)));
      // FIRST RED (Stage 1): the unpublished route answers 404.
      expect(consultation.status).toBe(200);
      expect(await consultation.json()).toMatchObject({ status: 'ready', value: {
        state: 'responded', answer: { ref: firstAnswerRef } } });
      expect(started.scripted.calls()).toBe(1);

      // Replaying the original submit keeps the original result, and replaying
      // the consumer keeps the original reply without a new run.
      expect(await (await corePost(started.base, 'queries/submit', started.token, submit)).json())
        .toMatchObject({ status: 'committed', replayed: true });
      const replay = await corePost(started.base, 'workflow/consultation', started.token, plain(consultationInput(messageRef)));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ status: 'ready', value: {
        state: 'responded', answer: { ref: firstAnswerRef } } });
      expect(started.scripted.calls()).toBe(1);

      // A different message gets its own deterministic identity and can never
      // bind the first message's saved Answer.
      const otherMessage = await sendMessage(started, recipient.sessionRef, 'AG2 window second message', 'ag2-window-message-2');
      const otherRefs = consultationQueryRefs(otherMessage);
      expect(otherRefs.queryJobRef.queryJobId).not.toBe(refs.queryJobRef.queryJobId);
      const other = await corePost(started.base, 'workflow/consultation', started.token, plain(consultationInput(otherMessage)));
      expect(other.status).toBe(200);
      const otherValue = asRecord(asRecord(await other.json() as unknown)['value']);
      expect(otherValue).toMatchObject({ state: 'responded', answer: {
        ref: { aggregateType: 'QueryJobAnswer' }, answer: { answer: secondAnswer, runRef: otherRefs.queryRunRef },
      } });
      expect(asRecord(otherValue['answer'])['ref']).not.toEqual(firstAnswerRef);
      expect(started.scripted.calls()).toBe(2);
    } finally {
      await started.host.close();
    }
  });

  // 4. Stage-1 target: a consultation whose formal Query already ended closed
  // with no Answer is NOT waiting and is NOT re-run. It reports the real
  // ended result projection with the accepted message and Query facts preserved.
  it('reports an already-terminal unanswered consultation without waiting or re-running it', async () => {
    const question = 'AG2 terminal consultation without a formal answer';
    const started = await startConsultationHost({ replies: [{ kind: 'text', text: '' }] });
    try {
      await seedGoal(started, 'terminal');
      const recipient = await createSession(started, 'ag2-terminal-recipient');
      const messageRef = await sendMessage(started, recipient.sessionRef, question, 'ag2-terminal-message');
      const refs = consultationQueryRefs(messageRef);
      const intent = consultationIntent(messageRef, recipient.sessionRef, question, refs, 'ag2-terminal-corr');

      // Drive the ONE deterministic Query to its real closed terminal through
      // the public writers; the turn produces no bounded answer text.
      expect(await (await corePost(started.base, 'queries/submit', started.token,
        submitBody(refs, intent, 'ag2-terminal-submit'))).json()).toMatchObject({ status: 'committed' });
      expect(await (await corePost(started.base, 'queries/claim', started.token,
        claimBody(refs, recipient.sessionAggregateRef, recipient.revision, 'ag2-terminal-claim'))).json())
        .toMatchObject({ status: 'committed' });
      const prepared = await corePost(started.base, 'queries/prepare', started.token,
        plain({ queryRunRef: refs.queryRunRef, requestId: 'ag2-terminal-prepare' }));
      const preparedBody = await prepared.json() as ReadResult<PreparedQueryExecution>;
      expect(preparedBody).toMatchObject({ status: 'ready' });
      if (preparedBody.status !== 'ready') throw new Error(`terminal preparation was not ready: ${JSON.stringify(preparedBody)}`);
      const startedQuery = await corePost(started.base, 'queries/start', started.token,
        plain({ prepared: preparedBody.value, consumerId: CONSUMER_ID, requestId: 'ag2-terminal-start' }));
      const startedBody = await startedQuery.json() as ReadResult<QueryExecutionRecord>;
      expect(startedBody).toMatchObject({ status: 'ready' });
      if (startedBody.status !== 'ready') throw new Error(`terminal query start was not ready: ${JSON.stringify(startedBody)}`);
      expect(startedBody.value.run.run.status, 'the Query really ended closed').toBe('closed');
      expect(startedBody.value.answer, 'a closed Query recorded no formal answer').toBeNull();
      expect(startedBody.value.job.job.answerRefs).toEqual([]);
      const callsAfterTerminal = started.scripted.calls();
      expect(callsAfterTerminal).toBe(1);

      const consultation = await corePost(started.base, 'workflow/consultation', started.token, plain({ ...consultationInput(messageRef), budget: { maxTokens: null, deadline: null } }));
      expect(consultation.status).toBe(200);
      const body = await consultation.json() as unknown;
      expect(asRecord(body)).toMatchObject({ status: 'ready', value: {
        state: 'ended', message: { ref: messageRef },
        query: { run: { ref: refs.queryRunRef, run: { status: 'closed' } } }, answer: null,
      } });
      expect(String(asRecord(asRecord(body)['value'])['reason'])).toMatch(/without a formal answer|no formal answer/i);
      // No fabricated state, no second run and no model stream.
      expect(started.scripted.calls()).toBe(callsAfterTerminal);
    } finally {
      await started.host.close();
    }
  });
});
