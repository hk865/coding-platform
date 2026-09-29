/** Private, opt-in real-provider harness. Never imported by the normal suite.
 * Public-writer bootstrap mirrors the frozen AG2b fixture, with a real provider.
 * No internal database writes; credentials and the Host token are never evidence.
 */
import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createLocalWorkbenchHost } from '../../../../../../src/app/host.js';
import { loadWorkbenchCliConfig } from '../../../../../../src/app/main.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER, PLATFORM_TOKEN_META_NAME } from '../../../../../../src/app/core-http-types.js';
import type { CoreScope, CreateSessionRequest, OperationReceipt, SessionRecord, SessionRef } from '../../../../../../src/app/core-http-types.js';
import type { RoleBindingRefV1 } from '../../../../../../src/contracts/dispatch.js';
import type { GoalRef } from '../../../../../../src/contracts/ledger.js';
import type { WorkLinkTarget } from '../../../../../../src/contracts/core/identity.js';
import { spawnSync } from 'node:child_process';
import { createBuiltinProviderRegistry, type ModelClientPort } from '../../../../../../vendor/coding-agent/dist/public-api.js';

export type LiveAdapterInput = {
  root: string; directory: string;
  model: { revision: string; provider: 'deepseek'; model: string; baseUrl: string; options: { thinking: string }; secretEnvironmentVariable: string };
  provider: { registry: unknown; secretSource: { get(name: string): string | undefined } };
  instruction: string;
  budget: { contextWindowTokens: number; perResponseTokens: number; maxRequests: number; maxToolCalls: number; timeoutMs: number; inputTokens: null; outputTokens: null };
};
/** Adapter must use formal bootstrap/RoleSpec/Session/graph writers only.
 * start invokes the real driver HTTP route; inspect reads actual owners.
 */
export type LiveAdapter = {
  url: string;
  seed: unknown;
  start(): Promise<unknown>;
  inspect(): Promise<{ state: string; goalPhase: string; aSessionId: string; aRunIds: string[]; bSessionId: string;
    messages: Array<{ replyMode?: string; response: unknown; recipientSessionId: string }>;
    checkOutcomes: string[]; trace: unknown }>;
  close(): Promise<void>;
};

const instruction = `Complete the retry-library task in the isolated workspace. First use query_task_graph and find_related_sessions to discover the related adviser Session from the real module/task association, then read its card. Ask that Session TWO separate substantive questions using send_session_message with intent=inquiry, needsReply=true, waitAfterSend=true: first about delay and attempt semantics; after receiving its actual reply, ask about caller/error propagation and exhausted retries. There are TWO distinct questions TOTAL for this Task, across all Runs. After each yield you resume the SAME Session with earlier history and a saved reply; do not restart the consultation sequence or repeat answered questions. Do not invent the recipient ID. Read the actual response before continuing each time. Then inspect src/retry.mjs, src/client.mjs and checks/retry.test.mjs, edit the implementation to satisfy the contract, and finish. Use the existing tools only. Your adviser is read-only, but you are the builder and must edit src/retry.mjs after both replies. Do not alter checks or contract.md. Do not claim a check passed merely from reasoning; formal checks run after the Work.`;


type AG2bHost = { base: string; token: string };
const sha256Hex = (text: string) => createHash('sha256').update(text).digest('hex');
export const AG2B_SCOPE: CoreScope = { projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace' };
export const AG2B_PROJECT_REF = { aggregateType: 'Project' as const, projectId: AG2B_SCOPE.projectId };
export const AG2B_WORKSPACE_REF = { aggregateType: 'Workspace' as const, ...AG2B_SCOPE };
export const AG2B_GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' };
export const AG2B_POLICY_REF = { aggregateType: 'CompletionPolicyRevision' as const, projectId: AG2B_SCOPE.projectId,
  policyId: 'ag2b-policy', revision: 1 };
export const AG2B_POLICY_ACTIVE_REF = { aggregateType: 'ProjectCompletionPolicyActive' as const,
  projectId: AG2B_SCOPE.projectId };
export const AG2B_WORK_TASK_ID = 'ag2b-work';
export const AG2B_GATE_TASK_ID = 'ag2b-gate';

export const AG2B_WORK_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
export const AG2B_QUERY_ROLE = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
export const AG2B_WORK_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'ag2b-work-binding', templateId: 'builder', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
export const AG2B_QUERY_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'ag2b-query-binding', templateId: 'advisor', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
export const AG2B_CONSUMER_ID = 'ag2b-consumer';
export const AG2B_QUERY_PROFILE_ID = 'ag2b-consult';
export async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  if (response.status !== 200) throw new Error(`the workbench page did not load: ${response.status}`);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

export const coreUrl = (base: string, suffix: string): string => new URL(CORE_API_PREFIX + suffix, base).toString();

export async function coreGet(base: string, suffix: string, token: string): Promise<Response> {
  return fetch(coreUrl(base, suffix), { headers: { [PLATFORM_TOKEN_HEADER]: token } });
}

export async function corePost(base: string, suffix: string, token: string | undefined, body: unknown): Promise<Response> {
  return fetch(coreUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { [PLATFORM_TOKEN_HEADER]: token }) },
    body: JSON.stringify(body),
  });
}

export const graphWrite = (scope: CoreScope, input: unknown, requestId: string, expected: unknown[] = []) =>
  ({ scope, request: { input, meta: { requestId, expected } } });
export const plain = (scope: CoreScope, input: unknown) => ({ scope, input });

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

/** The frozen R5c graph relationship seed over the real HTTP routes: project,
 * workspace, completion policy, initial architecture, Goal and an adopted Plan
 * with one ordinary work plus the Goal gate. */
export async function seedAG2bWorkGraph(host: AG2bHost): Promise<{ workTarget: WorkLinkTarget; goalRef: GoalRef }> {
  const post = (suffix: string, body: unknown) => corePost(host.base, suffix, host.token, body);
  const committed = async (response: Response): Promise<unknown> => {
    const body = await response.json() as unknown;
    if (asRecord(body)['status'] !== 'committed') {
      throw new Error(`the formal seed write did not commit: ${JSON.stringify(body)}`);
    }
    return asRecord(body)['value'];
  };
  await committed(await post('projects/create', graphWrite(AG2B_SCOPE, { projectId: AG2B_SCOPE.projectId },
    'ag2b-project', [{ ref: AG2B_PROJECT_REF, revision: 0 }])));
  await committed(await post('workspaces/register', graphWrite(AG2B_SCOPE, { workspace: AG2B_SCOPE },
    'ag2b-workspace', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 0 }])));
  const installed = await committed(await post('completion-policies/install', graphWrite(AG2B_SCOPE, {
    policyId: 'ag2b-policy', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  }, 'ag2b-policy-install', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_POLICY_REF, revision: 0 }]))) as Record<string, unknown>;
  await committed(await post('completion-policies/activate', graphWrite(AG2B_SCOPE, {
    target: { ref: asRecord(installed)['ref'], digest: asRecord(installed)['contentDigest'] },
  }, 'ag2b-policy-activate', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_POLICY_ACTIVE_REF, revision: 0 }])));
  await committed(await post('architecture/adopt-initial', graphWrite(AG2B_SCOPE, {
    baselineId: 'ag2b-baseline', description: 'AG2b isolated module boundary', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId: AG2B_SCOPE.projectId, moduleId: 'ag2b-work' },
      name: 'AG2b work', responsibility: 'Consult then write the isolated project', paths: ['src'], interfaces: [] }] },
  }, 'ag2b-architecture', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }])));
  await committed(await post('goals/create', graphWrite(AG2B_SCOPE, {
    goalId: AG2B_GOAL_REF.goalId, workspace: AG2B_SCOPE, objective: 'Deliver the AG2b continuous communication closure',
  }, 'ag2b-goal', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }])));
  const draft = {
    schemaVersion: 2, planId: 'ag2b-plan', planRevision: 1, goalId: AG2B_GOAL_REF.goalId, stages: [{ stageId: 'retry-stage', title: 'Retry module' }],
    tasks: [
      { taskId: AG2B_WORK_TASK_ID, title: 'Consult B then write the isolated project', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId: 'retry-stage', moduleRef: 'ag2b-work' }, executionIntent: 'request_execution' },
      { taskId: AG2B_GATE_TASK_ID, title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: AG2B_WORK_TASK_ID, role: 'builder', instruction }],
    obligations: [{ obligationId: 'ag2b-obligation', title: 'Deliver the AG2b work', requirementLevel: 'required',
      taskIds: [AG2B_WORK_TASK_ID, AG2B_GATE_TASK_ID],
      verificationRequirements: [{ requirementId: 'ag2b-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const proposed = await committed(await post('plans/propose', graphWrite(AG2B_SCOPE, {
    goalRef: AG2B_GOAL_REF, basedOn: null, draft, reason: { text: 'AG2b initial plan', sources: [] },
  }, 'ag2b-plan-propose', []))) as Record<string, unknown>;
  await committed(await post('plans/apply', graphWrite(AG2B_SCOPE, {
    proposalRef: asRecord(proposed)['ref'], expectedProposalRevision: asRecord(proposed)['revision'], decisionRefs: [],
  }, 'ag2b-plan-apply', [])));
  return {
    workTarget: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID } },
    goalRef: AG2B_GOAL_REF,
  };
}

export type AG2bSession = { sessionRef: SessionRef; sessionAggregateRef: SessionRef; revision: number };

/** Create one real Session through the HTTP route, optionally joining the real
 * AG1 work-link to the seeded Task in the SAME formal writer call. */
export async function createAG2bSession(
  host: AG2bHost, requestId: string, role: typeof AG2B_QUERY_ROLE | typeof AG2B_WORK_ROLE = AG2B_QUERY_ROLE,
  initialLinks: CreateSessionRequest['initialLinks'] = [],
): Promise<AG2bSession> {
  const response = await corePost(host.base, 'sessions/create', host.token, plain(AG2B_SCOPE, {
    workspace: AG2B_SCOPE, role, recommendedRefs: [], initialLinks, meta: { requestId, expected: [] },
  } satisfies CreateSessionRequest));
  if (response.status !== 200) throw new Error(`Session creation failed with ${response.status}`);
  const body = await response.json() as OperationReceipt<SessionRecord>;
  if (body.status !== 'completed') throw new Error(`Session creation did not complete: ${JSON.stringify(body)}`);
  const sessionRef: SessionRef = { projectId: body.value.ref.projectId, sessionId: body.value.ref.sessionId };
  return { sessionRef, sessionAggregateRef: body.value.ref, revision: body.value.revision };
}

async function createAG2bLiveAdapter(input: LiveAdapterInput): Promise<LiveAdapter> {
  const actor = { kind: 'human' as const, id: 'ag2b-operator' };
  const database = join(input.directory, 'platform');
  const adviserInstruction = 'You are the read-only retry-library adviser. Read contract.md and the relevant src/retry.mjs, src/client.mjs and checks/retry.test.mjs before answering the consultation. Explain precise attempt, delay, and original-error propagation behavior supported by those files. Produce a concise useful final answer. Never modify files.';
  const queryBudget = { ...input.budget, maxRequests: 6, maxToolCalls: 8, timeoutMs: 120000, perResponseTokens: 2048 };
  const binding = (id: string, role: typeof AG2B_WORK_ROLE | typeof AG2B_QUERY_ROLE, text: string, query: boolean) => ({
    id, label: id, scope: AG2B_SCOPE, role, configurationRevision: `${id}@1`, model: input.model,
    grant: { budget: query ? queryBudget : input.budget,
      hostTemplate: { templateId: role.templateId, revision: '1', digest: sha256Hex(text) },
      tools: query ? ['read', 'project_source'] : ['read', 'write', 'query_task_graph', 'find_related_sessions', 'read_session_card', 'send_session_message'],
      writeScope: query ? [] : ['.'], skills: { resourceRoot: resolve('resources/skills'), enabledIds: query ? ['platform-work', 'platform-adviser'] : ['platform-work'] },
      systemInstruction: text, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null }
  });
  // This binary is mounted by the existing ProcessSandbox. Never widen mounts.
  const command = '/usr/bin/node --test checks/retry.test.mjs';
  const sandboxNodeVersion = spawnSync('/usr/bin/node', ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (sandboxNodeVersion.status !== 0) throw Error('Existing sandbox Node binary is unavailable');
  const readVerificationRounds = () => {
    // Acceptance evidence only: the production owner remains the sole writer.
    // encodeVerificationRoundSnapshot stores the RoundSnapshot directly as JSON.
    const db = new DatabaseSync(join(database, 'ledger.sqlite'), { readOnly: true });
    try {
      return db.prepare("SELECT snapshot_json FROM snapshots WHERE json_extract(snapshot_json, '$.ref.aggregateType') = 'VerificationRound' AND json_extract(snapshot_json, '$.ref.projectId') = ? AND json_extract(snapshot_json, '$.ref.goalId') = ?")
        .all(AG2B_SCOPE.projectId, AG2B_GOAL_REF.goalId)
        .map(row => JSON.parse(String(row.snapshot_json))) as Array<{ ref: unknown; status: string; outcome: string | null; checks: Array<{ checkId: string; phase: string; outcome: string | null; sourceStatus: string | null }> }>;
    } finally { db.close(); }
  };
  const configPath = join(input.directory, 'workbench.json');
  await writeFile(join(input.root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', allowJs: true }, include: ['src/**/*.mjs'] }));
  await writeFile(configPath, JSON.stringify({ sqliteDirectory: database, actor,
    workspaces: [{ scope: AG2B_SCOPE, name: 'AG2b real retry project', root: input.root, workspaceRevision: 1, readPrefixes: ['.'] }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE, databasePath: join(database, 'kernel.sqlite') }] },
    runtime: { schemaVersion: 1, bindings: [binding('ag2b-work-binding', AG2B_WORK_ROLE, input.instruction, false), binding('ag2b-query-binding', AG2B_QUERY_ROLE, adviserInstruction, true)],
      queryProfiles: [{ id: AG2B_QUERY_PROFILE_ID, label: 'Retry adviser', scope: AG2B_SCOPE, runtimeBindingId: 'ag2b-query-binding', sessionRole: AG2B_QUERY_ROLE, roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: queryBudget, budget: { maxTokens: 200000, deadline: null }, consumerId: AG2B_CONSUMER_ID }] },
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 200000, deadline: null } }] },
    checks: { configurationRevision: 'ag2b-checks@1', workspace: AG2B_WORKSPACE_REF, executor: actor,
      permissionRevision: `host-permission-v1:${sha256Hex(JSON.stringify({ subject: actor, scope: AG2B_SCOPE, readPrefixes: ['.'] }))}`,
      sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
      checks: [{ checkId: 'ag2b-static', kind: 'static', command, cwd: '.', timeoutMs: 30000, taskIds: 'all' }] }
  }));
  const loaded = await loadWorkbenchCliConfig(configPath);
  const host = await createLocalWorkbenchHost({ ...loaded, publicDir: resolve('dist/app/public/workbench'), runtimeProvider: input.provider as NonNullable<Parameters<typeof createLocalWorkbenchHost>[0]['runtimeProvider']> });
  try {
    const address = await host.listen();
    const fx = { base: address.url, token: await readPageToken(address.url) };
    await seedAG2bWorkGraph(fx);
    const a = await createAG2bSession(fx, 'ag2b-live-a', AG2B_WORK_ROLE);
    const b = await createAG2bSession(fx, 'ag2b-live-b', AG2B_QUERY_ROLE, [{ target: { kind: 'module', ref: { projectId: AG2B_SCOPE.projectId, moduleId: 'ag2b-work' } }, relation: 'participates' }]);
    const post = async (suffix: string, input: unknown) => { const response = await corePost(fx.base, suffix, fx.token, plain(AG2B_SCOPE, input)); const body = await response.json(); if (!response.ok) throw Error(`${suffix}: HTTP ${response.status}`); return body; };
    const trace: unknown[] = [];
    const allMessages = new Map<string, any>();
    let prior = '';
    return { url: address.url, seed: { goalRef: AG2B_GOAL_REF, a: a.sessionRef, b: b.sessionRef, bLink: { kind: 'module', moduleId: 'ag2b-work' }, graph: await post('tasks/query', { goalRef: AG2B_GOAL_REF }), checkCommand: command, sandboxCheckRuntime: { executable: '/usr/bin/node', version: sandboxNodeVersion.stdout.trim() }, repositoryRuntime: process.version },
      start: () => post('workflow/driver-start', { advance: { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'ag2b-live-flow', sessionHint: a.sessionRef, kind: 'select_work' }, queryProfileIds: [AG2B_QUERY_PROFILE_ID] }),
      async inspect() {
        const driver = await post('workflow/driver-read', { goalRef: AG2B_GOAL_REF });
        const graph = await post('tasks/query', { goalRef: AG2B_GOAL_REF });
        const current = driver.status === 'ready' ? driver.value : { state: 'not_started', messages: [] };
        const signature = JSON.stringify(current);
        if (signature !== prior) { trace.push(current); prior = signature; }
        for (const message of current.messages ?? []) allMessages.set(message.ref.messageId, message);
        for (const [id, known] of allMessages) {
          const fresh = await post('messages/read', known.ref);
          if (fresh.status === 'ready') {
            const item = fresh.value;
            const body = item.response ? await post('messages/body', { messageRef: item.ref, part: 'response' }) : null;
            allMessages.set(id, { ...item, responseText: body?.status === 'ready' ? body.value.text : null });
          }
        }
        const messages = [...allMessages.values()];
        const verificationRounds = readVerificationRounds();
        return { state: current.state, goalPhase: graph.value?.completion?.snapshot?.phase ?? '', aSessionId: a.sessionRef.sessionId, bSessionId: b.sessionRef.sessionId,
          aRunIds: messages.filter((m: any) => m.sender.kind === 'work_run' && m.sender.sessionRef.sessionId === a.sessionRef.sessionId).map((m: any) => m.sender.runRef.runId),
          messages: messages.map((m: any) => ({ ...m, recipientSessionId: m.recipient.sessionId })), checkOutcomes: verificationRounds.flatMap(round => round.checks.map(check => check.phase === 'finished' && check.outcome !== null ? check.outcome : check.phase)), trace: { driver: trace, graph, verificationRounds } };
      }, close: () => host.close() };
  } catch (error) { await host.close(); throw error; }
}

/** Match actual saved reply content in a subsequent provider request, plus the
 * owner's committed input-acceptance identity. No tool-result wait assumption. */
function consumedReplyEvidence(requests: unknown[], snapshot: Awaited<ReturnType<LiveAdapter['inspect']>> | undefined) {
  if (!snapshot) return [];
  return snapshot.messages.flatMap((message: any) => {
    const text = message.responseText;
    const accepted = message.acceptedInputs?.filter((entry: any) => entry.part === 'response') ?? [];
    if (typeof text !== 'string' || !text.trim() || accepted.length === 0) return [];
    const seen = requests.filter((raw: any) => raw.tools.includes('send_session_message')
      && JSON.stringify(raw.messages).includes(JSON.stringify(text).slice(1,-1)));
    return seen.length === 0 ? [] : [{ messageRef: message.ref, accepted,
      subsequentRequestIds: seen.map((r: any) => r.requestId) }];
  });
}

it('common orchestration: repeated yield, derived inquiry, original Session continuation and real engineering result', async () => {
  const seedOnly = process.env.AG2B_SEED_ONLY === '1';
  if (!seedOnly && process.env.AG2B_LIVE !== '1') throw Error('Opt in with AG2B_LIVE=1; no model was called');
  const keyFile = process.env.DEEPSEEK_API_KEY_FILE;
  if (!seedOnly && !keyFile) throw Error('DEEPSEEK_API_KEY_FILE is required');
  const key = seedOnly ? 'ag2b-seed-only-dummy' : (await readFile(keyFile!, 'utf8')).match(/\bsk-[A-Za-z0-9_-]+\b/)?.[0];
  if (!key) throw Error('No recognized private credential');
  const directory = await mkdtemp(join(tmpdir(), 'ag2b-live-'));
  const root = join(directory, 'retry-project');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'checks'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test checks/retry.test.mjs' } }, null, 2));
  await writeFile(join(root, 'contract.md'), 'retry(operation,{maxAttempts,delayMs,sleep}) calls operation with 1-based attempt. maxAttempts includes the first attempt. On success return immediately; on failure sleep exactly delayMs only BETWEEN remaining attempts. Final failure throws the original Error object. callClient delegates the same policy unchanged; no wall-clock sleeps in checks.\n');
  await writeFile(join(root, 'src/retry.mjs'), 'export async function retry(operation, options) { return operation(0); }\n');
  await writeFile(join(root, 'src/client.mjs'), "import { retry } from './retry.mjs';\nexport const callClient = (operation, options) => retry(operation, options);\n");
  await writeFile(join(root, 'checks/retry.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { callClient } from '../src/client.mjs';\ntest('success on third attempt keeps policy and delays',async()=>{const attempts=[],delays=[];const value=await callClient(async n=>{attempts.push(n);if(n<3)throw Error('transient');return 17;},{maxAttempts:3,delayMs:25,sleep:async ms=>delays.push(ms)});assert.equal(value,17);assert.deepEqual(attempts,[1,2,3]);assert.deepEqual(delays,[25,25]);});\ntest('exhaustion preserves the exact error and does not sleep after final attempt',async()=>{const failure=Error('upstream');const attempts=[],delays=[];await assert.rejects(()=>callClient(async n=>{attempts.push(n);throw failure;},{maxAttempts:2,delayMs:7,sleep:async ms=>delays.push(ms)}),e=>e===failure);assert.deepEqual(attempts,[1,2]);assert.deepEqual(delays,[7]);});\n`);
  const check = () => { const p = spawnSync(process.execPath, ['--test', 'checks/retry.test.mjs'], { cwd: root, encoding: 'utf8', timeout: 30000 }); return { status: p.status, stdout: p.stdout, stderr: p.stderr }; };
  const originalChecks = await readFile(join(root, 'checks/retry.test.mjs'), 'utf8');
  const originalContract = await readFile(join(root, 'contract.md'), 'utf8');
  const before = check();
  expect(before.status).not.toBe(0);
  const evidenceDir = resolve(process.env.AG2B_EVIDENCE_DIR ?? 'docs/refactor/reviews/evidence/orchestration-2026-09-28/live');
  await mkdir(evidenceDir, { recursive: true });
  const requests: unknown[] = [], providerErrors: string[] = [], toolErrors: Array<{ callId: string; status: string; error: unknown; outputs: unknown[]; classification: string }> = [], toolnames: string[] = [];
  const seenToolErrors = new Set<string>();
  const transportErrors: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      const response = await originalFetch(input, init);
      if (url.startsWith('https://api.deepseek.com/') && !response.ok) transportErrors.push({ status: response.status });
      return response;
    } catch (error) {
      if (url.startsWith('https://api.deepseek.com/')) transportErrors.push({ name: (error as Error).name, causeCode: (error as any).cause?.code ?? null });
      throw error;
    }
  };
  let streams = 0;
  const original = createBuiltinProviderRegistry();
  const registry = { get: original.get.bind(original), create(...args: Parameters<typeof original.create>) {
    if (seedOnly) throw Error('SEED_ONLY forbids model client creation');
    const client = original.create(...args);
    return { async *stream(request, options) {
      if (++streams > 32) throw Error('AG2B real-provider total request ceiling reached');
      const tools = request.messages.filter(m => m.role === 'tool');
      for (const m of tools) if (m.role === 'tool' && m.result.status !== 'success' && !seenToolErrors.has(m.callId)) {
        seenToolErrors.add(m.callId);
        // An explicit argument/owner rejection is a model decision to correct, not a broken transport/tool implementation.
        // Keep every original result for review; unexpected execution errors remain acceptance failures.
        const parameterRejection = m.result.error?.code === 'invalid_arguments' || m.result.output.some(o => o.kind === 'json' && typeof o.value === 'object' && o.value !== null && 'status' in o.value && o.value.status === 'rejected');
        toolErrors.push({ callId: m.callId, status: m.result.status, error: m.result.error, outputs: m.result.output, classification: parameterRejection ? 'model_argument_or_owner_rejection' : 'execution_error' });
      }
      requests.push({ requestId: request.requestId, tools: request.tools.map(t => t.name), messages: request.messages });
      for await (const event of client.stream(request, options)) {
        if (event.type === 'tool_call_started') toolnames.push(event.name);
        if (['failed', 'error', 'cancelled', 'truncated'].includes(event.type)) providerErrors.push(event.type);
        yield event;
      }
    } } satisfies ModelClientPort;
  } };
  let adapter: LiveAdapter | undefined;
  let snapshot: Awaited<ReturnType<LiveAdapter['inspect']>> | undefined;
  let failure: string | null = null;
  try {
    adapter = await createAG2bLiveAdapter({ root, directory,
      model: { revision: 'ag2b-live-model@1', provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', options: { thinking: 'disabled' }, secretEnvironmentVariable: 'AG2B_PRIVATE_KEY' },
      provider: { registry, secretSource: { get: name => name === 'AG2B_PRIVATE_KEY' ? key : undefined } }, instruction,
      budget: { contextWindowTokens: 200000, perResponseTokens: 4096, maxRequests: 16, maxToolCalls: 24, timeoutMs: 600000, inputTokens: null, outputTokens: null } });
    if (seedOnly) { expect(streams).toBe(0); console.log('AG2B seed-only bootstrap passed; zero model calls.'); return; }
    if (process.env.AG2B_MANUAL_START !== '1') await adapter.start();
    console.log('AG2B isolated workbench:', adapter.url, 'project:', root);
    await writeFile(join(evidenceDir, 'live-host.json'), JSON.stringify({ url: adapter.url, root, seed: adapter.seed }));
    const until = Date.now() + 780000;
    while (Date.now() < until) {
      snapshot = await adapter.inspect();
      await writeFile(join(evidenceDir, 'live-progress.json'), JSON.stringify({ state: snapshot.state, streams, toolnames, transportErrors, providerErrors, toolErrors }));
      if (['completed', 'waiting', 'failed', 'stopped'].includes(snapshot.state)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    expect(snapshot?.state).toBe('completed');
    expect(snapshot?.goalPhase).toBe('COMPLETED');
    expect(new Set(snapshot?.aRunIds).size).toBeGreaterThanOrEqual(2);
    expect(snapshot?.messages.filter(m => (m.waitAfterSend === true || m.replyMode === 'wait') && m.response && m.recipientSessionId === snapshot?.bSessionId).length).toBeGreaterThanOrEqual(2);
    expect(consumedReplyEvidence(requests, snapshot).length).toBeGreaterThanOrEqual(2);
    expect(snapshot?.checkOutcomes.length).toBeGreaterThan(0);
    expect(snapshot?.checkOutcomes.every(x => x === 'passed' || x === 'PASS')).toBe(true);
    expect(await readFile(join(root, 'checks/retry.test.mjs'), 'utf8')).toBe(originalChecks);
    expect(await readFile(join(root, 'contract.md'), 'utf8')).toBe(originalContract);
    expect(toolnames).toEqual(expect.arrayContaining(['query_task_graph', 'find_related_sessions', 'read_session_card', 'send_session_message', 'edit']));
    expect(check().status).toBe(0);
    expect(providerErrors).toEqual([]);
    expect(transportErrors).toEqual([]);
    expect(toolErrors.filter(error => error.classification === 'execution_error')).toEqual([]);
    await writeFile(join(evidenceDir, seedOnly ? 'seed-only.json' : 'live.json'), JSON.stringify({ at: new Date().toISOString(), root, seedOnly, seed: adapter?.seed, before, after: check(), streams, toolnames, providerErrors, transportErrors, toolErrors, snapshot, consumedReplyRefs: consumedReplyEvidence(requests, snapshot), failure, requests }, null, 2).replaceAll(key, '[redacted]'));
    if (process.env.AG2B_KEEP_HOST === '1') { console.log('AG2B completed Host retained for browser read-only inspection; interrupt to close.'); await new Promise<void>(resolve => { const finish = () => { process.off('SIGINT', finish); process.off('SIGTERM', finish); resolve(); }; process.once('SIGINT', finish); process.once('SIGTERM', finish); }); }
  } catch (error) { failure = error instanceof Error ? error.message.replaceAll(key, '[redacted]') : 'unconfirmed'; throw error; }
  finally {
    // Structured request content has no provider configuration, headers or secrets.
    await writeFile(join(evidenceDir, seedOnly ? 'seed-only.json' : 'live.json'), JSON.stringify({ at: new Date().toISOString(), root, seedOnly, seed: adapter?.seed, before, after: check(), streams, toolnames, providerErrors, transportErrors, toolErrors, snapshot, consumedReplyRefs: consumedReplyEvidence(requests, snapshot), failure, requests }, null, 2).replaceAll(key, '[redacted]'));
    await adapter?.close();
    globalThis.fetch = originalFetch;
  }
}, process.env.AG2B_KEEP_HOST === '1' ? 86400000 : 900000);
