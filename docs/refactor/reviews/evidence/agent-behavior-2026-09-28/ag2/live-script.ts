import { it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions } from '../src/app/host.js';
import { createBuiltinProviderRegistry, type ModelClientPort } from '../vendor/coding-agent/dist/public-api.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER, PLATFORM_TOKEN_META_NAME } from '../src/app/core-http-types.js';

it('explicit consultation uses the original idle Session and persists the formal answer reply', async () => {
  const keyPath = process.env.DEEPSEEK_API_KEY_FILE;
  if (!keyPath) throw Error('DEEPSEEK_API_KEY_FILE required');
  const apiKey = (await readFile(keyPath, 'utf8')).match(/\bsk-[A-Za-z0-9_-]+\b/)?.[0];
  if (!apiKey) throw Error('No recognized credential');
  const directory = await mkdtemp(join(tmpdir(), 'ag2-live-'));
  const root = join(directory, 'toy');
  await mkdir(join(root, 'src'), { recursive: true });
  const marker = 'CONSULT_' + randomBytes(8).toString('hex');
  await writeFile(join(root, 'src', 'consultation.ts'), `export const boundaryMarker = ${JSON.stringify(marker)};\n// Reader reads source; Index owns derived search indexes only.\n`);
  const scope = { projectId: 'ag2-live-project', workspaceId: 'ag2-live-workspace' };
  const projectRef = { aggregateType: 'Project', projectId: scope.projectId };
  const workspaceRef = { aggregateType: 'Workspace', ...scope };
  const goalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'ag2-live-goal' };
  const role = { kind: 'legacy_template' as const, templateId: 'ag2-adviser', templateRevision: '1' };
  const roleBinding = { schemaVersion: 1, bindingId: 'ag2-adviser-binding', templateId: role.templateId, templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
  const budget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 6, maxToolCalls: 6, timeoutMs: 120000, perResponseTokens: 2048 };
  const instruction = '你是受邀咨询的参谋。先实际使用 project_source 读取问题指定的小型源码，再给中文答复，准确引用文件路径、原始常量值和职责边界。只调查和回答，不写文件、不把咨询说成完成Task，不虚构已调用工具。';
  let requests = 0;
  const toolnames: string[] = [];
  const providerErrors: string[] = [];
  const registry = createBuiltinProviderRegistry();
  const trackedRegistry = {
    get: registry.get.bind(registry),
    create(...args: Parameters<typeof registry.create>) {
      const client = registry.create(...args);
      const tracked: ModelClientPort = { async *stream(request, options) {
        requests++;
        for await (const event of client.stream(request, options)) {
          if (event.type === 'tool_call_started') toolnames.push(event.name);
          if (['failed', 'error', 'cancelled', 'truncated'].includes(event.type)) providerErrors.push(event.type);
          yield event;
        }
      } };
      return tracked;
    },
  };
  const options: LocalWorkbenchHostOptions = {
    storage: { kind: 'sqlite', directory: join(directory, 'platform') },
    actor: { kind: 'human', id: 'ag2-live-operator' },
    workspaces: [{ scope, name: 'AG2 isolated consultation toy', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    kernelStores: { entries: [{ adapterId: 'ag2-live-kernel', storeKey: 'ag2-live-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtimeConfiguration: JSON.parse(JSON.stringify({ schemaVersion: 1, bindings: [{ id: 'adviser', label: 'AG2 adviser', scope, role, configurationRevision: 'ag2-live-v1', model: { revision: 'ag2-live-model', provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', options: { thinking: 'disabled' }, secretEnvironmentVariable: 'AG2_PRIVATE_KEY' }, grant: { budget, tools: ['read', 'project_source'], writeScope: [], skills: { bundle: 'platform', behaviors: ['adviser'] }, systemInstruction: instruction, hostTemplate: { templateId: role.templateId, revision: '1', digest: createHash('sha256').update(instruction).digest('hex') }, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } }], queryProfiles: [{ id: 'ag2-adviser', label: 'AG2 consultation', scope, runtimeBindingId: 'adviser', sessionRole: role, roleBinding, runtimeBudget: budget, budget: { maxTokens: 200000, deadline: null }, consumerId: 'ag2-live-consumer' }] })),
    runtimeProvider: { registry: trackedRegistry, secretSource: { get: name => name === 'AG2_PRIVATE_KEY' ? apiKey : undefined } },
    publicDir: resolve('dist/app/public/workbench'),
  };
  let host: LocalWorkbenchHost | undefined;
  let base = '', token = '';
  const evidence: any = { schemaVersion: 1, recordedAt: new Date().toISOString(), scope, goalRef, model: 'deepseek-flash', thinking: 'disabled', status: 'running', requests: 0, toolnames, providerErrors, answer: null, sessionRef: null, messageRef: null, answerRef: null, queryRef: null, replayProviderDelta: null, reopenProviderDelta: null, noCallsOnSend: null, elapsedMs: 0, notCovered: ['automatic wakeup', 'sender Work automatic continuation', 'full MVP', 'multi-Agent scheduling'], senderKind: 'host:human (explicit consultation requester; not an impersonated Agent)' };
  const startedAt = Date.now();
  const startHost = async () => {
    host = await createLocalWorkbenchHost(options);
    const address = await host.listen(0); base = address.url;
    const html = await (await fetch(base)).text();
    token = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html)?.[1] ?? '';
    if (!token) throw Error('Host page token unavailable; build UI first');
    evidence.url = base;
  };
  const post = async (route: string, body: unknown): Promise<any> => {
    const response = await fetch(new URL(CORE_API_PREFIX + route, base), { method: 'POST', headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token }, body: JSON.stringify(body) });
    return response.json();
  };
  const plain = (input: unknown) => ({ scope, input });
  const write = (input: unknown, requestId: string, expected: unknown[] = []) => ({ scope, request: { input, meta: { requestId, expected } } });
  const save = async () => {
    evidence.requests = requests; evidence.elapsedMs = Date.now() - startedAt;
    const dest = 'docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag2/live-result.json';
    await mkdir(join(dest, '..'), { recursive: true }); await writeFile(dest, JSON.stringify(evidence, null, 2) + '\n');
  };
  try {
    await mkdir(join(directory, 'platform'), { recursive: true });
    await startHost();
    expect(await post('projects/create', write({ projectId: scope.projectId }, 'project', [{ ref: projectRef, revision: 0 }]))).toMatchObject({ status: 'committed' });
    expect(await post('workspaces/register', write({ workspace: scope }, 'workspace', [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }]))).toMatchObject({ status: 'committed' });
    expect(await post('goals/create', write({ goalId: goalRef.goalId, workspace: scope, objective: 'Read the toy source and answer one explicit consultation; no coding Task required' }, 'goal', [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }]))).toMatchObject({ status: 'committed' });
    const session = await post('sessions/create', plain({ workspace: scope, role, recommendedRefs: [], initialLinks: [], meta: { requestId: 'recipient', expected: [] } }));
    expect(session.status).toBe('completed');
    const recipient = { projectId: scope.projectId, sessionId: session.value.ref.sessionId }; evidence.sessionRef = recipient;
    const beforeSend = requests;
    const sent = await post('messages/send', write({ recipient, text: '请实际读取 src/consultation.ts，告诉我 boundaryMarker 的完整值，并基于注释解释 Reader 与 Index 的职责边界。请引用路径；不要猜常量，不改文件。' }, 'consultation-message'));
    expect(sent.status).toBe('committed'); evidence.messageRef = sent.value.ref;
    evidence.noCallsOnSend = requests - beforeSend; expect(evidence.noCallsOnSend).toBe(0);
    const input = { schemaVersion: 1, messageRef: sent.value.ref, goalRef, roleBinding, runtimeBudget: budget, budget: { maxTokens: 200000, deadline: null }, consumerId: 'ag2-live-consumer' };
    const processed = await post('workflow/consultation', plain(input));
    expect(processed).toMatchObject({ status: 'ready', value: { state: 'responded', message: { status: 'responded', response: { sender: { kind: 'query_run', sessionRef: recipient } } } } });
    const answer = processed.value.answer; evidence.answerRef = answer.ref; evidence.queryRef = processed.value.query?.job?.ref ?? null;
    expect(processed.value.message.response.sender.answerRef).toEqual(answer.ref);
    const body = await post('messages/body', plain({ messageRef: sent.value.ref, part: 'response' }));
    expect(body.status).toBe('ready'); evidence.answer = body.value.text;
    expect(body.value.text).toContain(marker);
    expect(toolnames).toContain('project_source'); expect(providerErrors).toEqual([]);
    const artifact = await post('materials/open', plain({ ref: answer.answer.bodyRef, usage: 'historical_explanation' }));
    expect(artifact.status).toBe('ready'); expect(body.value.text).toBe(artifact.value.body);
    const fixedCalls = requests;
    expect(await post('workflow/consultation', plain(input))).toMatchObject({ status: 'ready', value: { state: 'responded' } });
    evidence.replayProviderDelta = requests - fixedCalls; expect(evidence.replayProviderDelta).toBe(0);
    await host!.close(); host = undefined; await startHost();
    expect(await post('messages/read', plain(sent.value.ref))).toMatchObject({ status: 'ready', value: { status: 'responded' } });
    expect(await post('workflow/consultation', plain(input))).toMatchObject({ status: 'ready', value: { state: 'responded' } });
    evidence.reopenProviderDelta = requests - fixedCalls; expect(evidence.reopenProviderDelta).toBe(0);
    const card = await post('sessions/read', plain(recipient)); expect(card).toMatchObject({ status: 'ready', value: { availability: 'idle' } });
    evidence.status = 'passed'; await save();
    if (process.env.AG2_KEEP_HOST === '1') {
      // Separate request reserved for an actual user/browser click. Never consume it here.
      const beforePending = requests;
      const pending = await post('messages/send', write({ recipient, text: '浏览器手动咨询：请实际读取 src/consultation.ts，核对 boundaryMarker 完整值，并解释 Index 能否替代 Reader 成为源码事实源。引用路径，不修改文件，不声称完成编码任务。' }, 'browser-pending-consultation'));
      expect(pending).toMatchObject({ status: 'committed', value: { status: 'pending', response: null } });
      expect(requests).toBe(beforePending);
      evidence.browserPending = { scope, sessionRef: recipient, messageRef: pending.value.ref, goalRef, queryProfileId: 'ag2-adviser', statusAtHandoff: 'pending', providerDeltaOnEnqueue: requests - beforePending };
      await save();
      console.log('AG2 workbench: ' + base);
      console.log('AG2 browser target: ' + JSON.stringify(evidence.browserPending));
      // Explicit temporary browser inspection mode; not a product scheduler.
      await new Promise<void>(resolveStop => { process.once('SIGINT', resolveStop); process.once('SIGTERM', resolveStop); });
      // Inspect the UI's completed action through ordinary formal reads only.
      const beforeFinalReads = requests;
      const finalMessage = await post('messages/read', plain(pending.value.ref));
      const finalBody = await post('messages/body', plain({ messageRef: pending.value.ref, part: 'response' }));
      evidence.browserProviderDelta = beforeFinalReads - beforePending;
      evidence.browserFinal = {
        messageRef: pending.value.ref,
        readStatus: finalMessage.status,
        status: finalMessage.value?.status ?? null,
        sender: finalMessage.value?.response?.sender ?? null,
        bodyStatus: finalBody.status,
        answer: finalBody.value?.text ?? null,
        providerDeltaOnRead: requests - beforeFinalReads,
      };
      await save();
      expect(finalMessage).toMatchObject({ status: 'ready', value: { status: 'responded', response: { sender: { kind: 'query_run', sessionRef: recipient } } } });
      expect(finalBody.status).toBe('ready');
      expect(finalBody.value.text).toContain(marker);
      expect(requests).toBe(beforeFinalReads);
    }
  } catch (error) {
    evidence.status = 'failed'; evidence.errorStatus = 'live_acceptance_failed'; throw error;
  } finally {
    await save(); await host?.close(); await rm(directory, { recursive: true, force: true });
  }
});
