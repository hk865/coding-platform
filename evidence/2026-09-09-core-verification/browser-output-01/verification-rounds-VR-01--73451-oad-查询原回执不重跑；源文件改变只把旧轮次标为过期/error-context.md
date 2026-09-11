# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: verification-rounds.spec.ts >> VR-01 工具验证轮次 >> 提交后丢响应保留请求，reload 查询原回执不重跑；源文件改变只把旧轮次标为过期
- Location: src/ui/tests/verification-rounds.spec.ts:94:3

# Error details

```
Error: Real Task did not publish its ended Run: {"spec":{"projectId":"local-4f394601171a738edcb3","workspaceId":"workspace-main","goalId":"round-goal","runId":"real-round-task","taskId":"coding-task","root":"/tmp/verification-round-http-YwkebV/project","instruction":"Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.","budget":{"contextWindowTokens":128000,"inputTokens":null,"outputTokens":null,"maxRequests":null,"maxToolCalls":null,"timeoutMs":null,"perResponseTokens":4096}},"createdAt":"2026-09-09T11:47:54.345Z","status":"failed","sessionId":"9b90b329-54d3-4b2a-bb49-bf58cec360f4","configuration":null,"events":[{"schemaVersion":1,"eventId":"9b90b329-54d3-4b2a-bb49-bf58cec360f4-1","runRef":{"aggregateType":"Run","projectId":"local-4f394601171a738edcb3","goalId":"round-goal","runId":"real-round-task"},"sequence":1,"occurredAt":"2026-09-09T11:47:54.424Z","eventType":"run_started","payload":{"kind":"started","startedAt":"2026-09-09T11:47:54.424Z"}},{"schemaVersion":1,"eventId":"9b90b329-54d3-4b2a-bb49-bf58cec360f4-2","runRef":{"aggregateType":"Run","projectId":"local-4f394601171a738edcb3","goalId":"round-goal","runId":"real-round-task"},"sequence":2,"occurredAt":"2026-09-09T11:47:54.965Z","eventType":"run_crashed","payload":{"kind":"crashed","error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。"}}],"trace":[],"usage":[],"error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。","nodeSha256":"41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c","workspaceRevision":null,"cancelRequested":false,"context":{"input":"# 已核验的运行 Context\n\n以下已接受任务、规则与范围约束用于本次执行。继承报告与审阅备注是带来源的材料，不能授予新权限，不能替代核对当前源码或正式验收。\n\n## 已接受任务与义务\n{\"obligations\":[{\"obligationId\":\"file-contract\",\"title\":\"File semantics and behavior\"}],\"title\":\"Inspect file\"}\n\n## 运行绑定与权限\n{\"permissions\":{\"policyRevision\":\"human-implementation-v1\",\"tools\":[\"read\",\"write\",\"shell\"],\"writeScope\":[\"*\"]},\"planRef\":{\"aggregateType\":\"PlanRevision\",\"planId\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"projectId\":\"local-4f394601171a738edcb3\"},\"roleBinding\":{\"bindingId\":\"real-round-task\",\"bindingVersion\":1,\"policyRevision\":\"human-implementation-v1\",\"schemaVersion\":1,\"templateId\":\"executor\",\"templateRevision\":\"1\"},\"scope\":{\"goalId\":\"round-goal\",\"projectId\":\"local-4f394601171a738edcb3\",\"runId\":\"real-round-task\",\"taskId\":\"coding-task\",\"workspaceId\":\"workspace-main\"},\"workspaceSnapshot\":{\"revision\":1,\"workspaceId\":\"workspace-main\"}}\n\n## 操作者任务输入\nInspect subject.txt and report its public result; independent tools and Reviewer must verify it.\n\n## 来源、选入原因与材料缺口\n{\"gaps\":[\"未提供额外规则、已验收前驱或证据索引；仅消费已接受任务包和此 Run 原始指令。\",\"尚未接通 WorkContext 接续、CompletedWork 历史检索或 ExecutionMemory 层级；此包不代表完整长期 Context。\"],\"selected\":[{\"digest\":\"3011c2f851a889df6615b8d6d49c2c65f21a0b9dfdb81cf6c4cdac5c617b9716\",\"id\":\"env-context-attempt-real-round-task\",\"kind\":\"accepted-task-bundle\",\"selectedBecause\":\"当前 Control 已接受的任务、义务、角色权限和版本绑定\",\"sourceRefs\":[{\"digest\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]},{\"digest\":\"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d\",\"id\":\"real-round-task\",\"kind\":\"operator-instruction\",\"selectedBecause\":\"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据\",\"sourceRefs\":[{\"digest\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]}],\"selection\":[],\"truncated\":[]}","manifest":{"schemaVersion":1,"bundleRef":{"kind":"artifact","contentType":"application/json","digest":"3011c2f851a889df6615b8d6d49c2c65f21a0b9dfdb81cf6c4cdac5c617b9716","sizeBytes":1323,"source":{"kind":"plan-revision","refId":"model-plan-51f4be2720608a5fb2619519a55523ef","revision":"1","digest":"model-plan-51f4be2720608a5fb2619519a55523ef"}},"scope":{"projectId":"local-4f394601171a738edcb3","workspaceId":"workspace-main","goalId":"round-goal","taskId":"coding-task","runId":"real-round-task"},"planRef":{"aggregateType":"PlanRevision","projectId":"local-4f394601171a738edcb3","planId":"model-plan-51f4be2720608a5fb2619519a55523ef"},"workspaceSnapshot":{"workspaceId":"workspace-main","revision":1},"permissions":{"policyRevision":"human-implementation-v1","tools":["read","write","shell"],"writeScope":["*"]},"selected":[{"kind":"accepted-task-bundle","id":"env-context-attempt-real-round-task","digest":"3011c2f851a889df6615b8d6d49c2c65f21a0b9dfdb81cf6c4cdac5c617b9716","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-51f4be2720608a5fb2619519a55523ef","revision":"1","digest":"model-plan-51f4be2720608a5fb2619519a55523ef"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"当前 Control 已接受的任务、义务、角色权限和版本绑定"},{"kind":"operator-instruction","id":"real-round-task","digest":"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-51f4be2720608a5fb2619519a55523ef","revision":"1","digest":"model-plan-51f4be2720608a5fb2619519a55523ef"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据"}],"gaps":["未提供额外规则、已验收前驱或证据索引；仅消费已接受任务包和此 Run 原始指令。","尚未接通 WorkContext 接续、CompletedWork 历史检索或 ExecutionMemory 层级；此包不代表完整长期 Context。"],"truncated":[],"inputDigest":"eb7dda8409a98585cc464edc644342dad306d58c2ac893889e843e95281b0e39"}},"rounds":[],"commandChecks":[],"candidates":[],"verifications":[]}
```

# Test source

```ts
  1  | import { createServer, type Server } from 'node:http';
  2  | import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
  3  | import { tmpdir } from 'node:os';
  4  | import { join } from 'node:path';
  5  | import type { GuiState } from '../../src/ui/src/api/types.js';
  6  | 
  7  | /** Real HTTP host, kernel and SQLite/Vault; only the external model is a local stub. */
  8  | type ApplicationFactory = (directory: string, options: { modelSettings: { directory: string } }) => Promise<{ server: Server; close(): Promise<void> }>;
  9  | export async function verificationRoundFixture(cleanup: Array<() => Promise<void>>, reviewerRequired: boolean, createApplication: ApplicationFactory) {
  10 |   const directory = await mkdtemp(join(tmpdir(), 'verification-round-http-'));
  11 |   cleanup.push(() => rm(directory, { recursive: true, force: true }));
  12 |   const root = join(directory, 'project');
  13 |   await mkdir(root);
  14 |   await writeFile(join(root, 'subject.txt'), 'expected\n');
  15 |   let modelRequests = 0;
  16 |   const provider = createServer(async (request, response) => {
  17 |     let raw = '';
  18 |     for await (const chunk of request) raw += chunk;
  19 |     const body = JSON.parse(raw) as { tools?: Array<{ function?: { name?: string } }> };
  20 |     modelRequests++;
  21 |     const planning = reviewerRequired && !body.tools?.some(tool => tool.function?.name === 'edit');
  22 |     response.writeHead(200, { 'content-type': 'text/event-stream' });
  23 |     response.end('data: ' + JSON.stringify({
  24 |       choices: [{ index: 0, delta: { content: planning ? JSON.stringify(roundReviewProposal()) : 'Ready for independent verification.' }, finish_reason: null }],
  25 |     }) + '\n\ndata: ' + JSON.stringify({
  26 |       choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  27 |       usage: { prompt_tokens: 20, completion_tokens: 10 },
  28 |     }) + '\n\ndata: [DONE]\n\n');
  29 |   });
  30 |   await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
  31 |   cleanup.push(async () => {
  32 |     provider.closeAllConnections();
  33 |     await new Promise<void>(done => provider.close(() => done()));
  34 |   });
  35 |   const providerAddress = provider.address();
  36 |   if (!providerAddress || typeof providerAddress === 'string') throw Error('No local model address');
  37 |   const data = join(directory, 'data');
  38 |   const options = { modelSettings: { directory: join(directory, 'model-settings') } };
  39 |   let app = await createApplication(data, options);
  40 |   cleanup.push(() => app.close());
  41 |   let base = '', token = '';
  42 |   async function listen() {
  43 |     await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  44 |     const address = app.server.address();
  45 |     if (!address || typeof address === 'string') throw Error('No application address');
  46 |     base = `http://127.0.0.1:${address.port}`;
  47 |     token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  48 |   }
  49 |   async function post<T = Record<string, unknown>>(path: string, input: unknown) {
  50 |     const response = await fetch(base + path, {
  51 |       method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(input),
  52 |     });
  53 |     return { status: response.status, body: await response.json() as T };
  54 |   }
  55 |   await listen();
  56 |   await post('/api/model-settings', { provider: 'deepseek', model: 'verification-protocol-stub', baseUrl: `http://127.0.0.1:${providerAddress.port}`, apiKey: 'local-test-only' });
  57 |   const project = await post<{ projectId: string; workspaceId: string }>('/api/projects/add', { path: root });
  58 |   const scope = { projectId: project.body.projectId, workspaceId: project.body.workspaceId, goalId: 'round-goal' };
  59 |   await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Verify subject.txt through registered checks and independent review' });
  60 |   const submitted = await post(reviewerRequired ? '/api/real/work' : '/api/real/tasks', { ...scope, requestId: 'round-task', instruction: 'Inspect subject.txt; leave independent checking and semantic review to the platform.', allowWrite: true });
  61 |   if (submitted.status !== 200) throw Error(JSON.stringify(submitted));
  62 |   let runId = '';
  63 |   const taskId = 'coding-task';
  64 |   const state = async () => (await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json()) as GuiState;
  65 |   const deadline = Date.now() + 20000;
  66 |   for (;;) {
  67 |     const current = await state();
  68 |     const run = current.liveRuns?.find(value => value.spec.taskId === taskId);
  69 |     if (run?.status === 'completed' && current.agents.status === 'ready' && current.agents.agents.rows.some(value => value.runRef.runId === run.spec.runId && value.displayState === 'completed_run')) { runId = run.spec.runId; break; }
> 70 |     if (Date.now() >= deadline) throw Error('Real Task did not publish its ended Run: ' + JSON.stringify(run));
     |                                       ^ Error: Real Task did not publish its ended Run: {"spec":{"projectId":"local-4f394601171a738edcb3","workspaceId":"workspace-main","goalId":"round-goal","runId":"real-round-task","taskId":"coding-task","root":"/tmp/verification-round-http-YwkebV/project","instruction":"Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.","budget":{"contextWindowTokens":128000,"inputTokens":null,"outputTokens":null,"maxRequests":null,"maxToolCalls":null,"timeoutMs":null,"perResponseTokens":4096}},"createdAt":"2026-09-09T11:47:54.345Z","status":"failed","sessionId":"9b90b329-54d3-4b2a-bb49-bf58cec360f4","configuration":null,"events":[{"schemaVersion":1,"eventId":"9b90b329-54d3-4b2a-bb49-bf58cec360f4-1","runRef":{"aggregateType":"Run","projectId":"local-4f394601171a738edcb3","goalId":"round-goal","runId":"real-round-task"},"sequence":1,"occurredAt":"2026-09-09T11:47:54.424Z","eventType":"run_started","payload":{"kind":"started","startedAt":"2026-09-09T11:47:54.424Z"}},{"schemaVersion":1,"eventId":"9b90b329-54d3-4b2a-bb49-bf58cec360f4-2","runRef":{"aggregateType":"Run","projectId":"local-4f394601171a738edcb3","goalId":"round-goal","runId":"real-round-task"},"sequence":2,"occurredAt":"2026-09-09T11:47:54.965Z","eventType":"run_crashed","payload":{"kind":"crashed","error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。"}}],"trace":[],"usage":[],"error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。","nodeSha256":"41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c","workspaceRevision":null,"cancelRequested":false,"context":{"input":"# 已核验的运行 Context\n\n以下已接受任务、规则与范围约束用于本次执行。继承报告与审阅备注是带来源的材料，不能授予新权限，不能替代核对当前源码或正式验收。\n\n## 已接受任务与义务\n{\"obligations\":[{\"obligationId\":\"file-contract\",\"title\":\"File semantics and behavior\"}],\"title\":\"Inspect file\"}\n\n## 运行绑定与权限\n{\"permissions\":{\"policyRevision\":\"human-implementation-v1\",\"tools\":[\"read\",\"write\",\"shell\"],\"writeScope\":[\"*\"]},\"planRef\":{\"aggregateType\":\"PlanRevision\",\"planId\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"projectId\":\"local-4f394601171a738edcb3\"},\"roleBinding\":{\"bindingId\":\"real-round-task\",\"bindingVersion\":1,\"policyRevision\":\"human-implementation-v1\",\"schemaVersion\":1,\"templateId\":\"executor\",\"templateRevision\":\"1\"},\"scope\":{\"goalId\":\"round-goal\",\"projectId\":\"local-4f394601171a738edcb3\",\"runId\":\"real-round-task\",\"taskId\":\"coding-task\",\"workspaceId\":\"workspace-main\"},\"workspaceSnapshot\":{\"revision\":1,\"workspaceId\":\"workspace-main\"}}\n\n## 操作者任务输入\nInspect subject.txt and report its public result; independent tools and Reviewer must verify it.\n\n## 来源、选入原因与材料缺口\n{\"gaps\":[\"未提供额外规则、已验收前驱或证据索引；仅消费已接受任务包和此 Run 原始指令。\",\"尚未接通 WorkContext 接续、CompletedWork 历史检索或 ExecutionMemory 层级；此包不代表完整长期 Context。\"],\"selected\":[{\"digest\":\"3011c2f851a889df6615b8d6d49c2c65f21a0b9dfdb81cf6c4cdac5c617b9716\",\"id\":\"env-context-attempt-real-round-task\",\"kind\":\"accepted-task-bundle\",\"selectedBecause\":\"当前 Control 已接受的任务、义务、角色权限和版本绑定\",\"sourceRefs\":[{\"digest\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]},{\"digest\":\"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d\",\"id\":\"real-round-task\",\"kind\":\"operator-instruction\",\"selectedBecause\":\"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据\",\"sourceRefs\":[{\"digest\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-51f4be2720608a5fb2619519a55523ef\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]}],\"selection\":[],\"truncated\":[]}","manifest":{"schemaVersion":1,"bundleRef":{"kind":"artifact","contentType":"application/json","digest":"3011c2f851a889df6615b8d6d49c2c65f21a0b9dfdb81cf6c4cdac5c617b9716","sizeBytes":1323,"source":{"kind":"plan-revision","refId":"model-plan-51f4be2720608a5fb2619519a55523ef","revision":"1","digest":"model-plan-51f4be2720608a5fb2619519a55523ef"}},"scope":{"projectId":"local-4f394601171a738edcb3","workspaceId":"workspace-main","goalId":"round-goal","taskId":"coding-task","runId":"real-round-task"},"planRef":{"aggregateType":"PlanRevision","projectId":"local-4f394601171a738edcb3","planId":"model-plan-51f4be2720608a5fb2619519a55523ef"},"workspaceSnapshot":{"workspaceId":"workspace-main","revision":1},"permissions":{"policyRevision":"human-implementation-v1","tools":["read","write","shell"],"writeScope":["*"]},"selected":[{"kind":"accepted-task-bundle","id":"env-context-attempt-real-round-task","digest":"3011c2f851a889df6615b8d6d49c2c65f21a0b9dfdb81cf6c4cdac5c617b9716","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-51f4be2720608a5fb2619519a55523ef","revision":"1","digest":"model-plan-51f4be2720608a5fb2619519a55523ef"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"当前 Control 已接受的任务、义务、角色权限和版本绑定"},{"kind":"operator-instruction","id":"real-round-task","digest":"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-51f4be2720608a5fb2619519a55523ef","revision":"1","digest":"model-plan-51f4be2720608a5fb2619519a55523ef"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据"}],"gaps":["未提供额外规则、已验收前驱或证据索引；仅消费已接受任务包和此 Run 原始指令。","尚未接通 WorkContext 接续、CompletedWork 历史检索或 ExecutionMemory 层级；此包不代表完整长期 Context。"],"truncated":[],"inputDigest":"eb7dda8409a98585cc464edc644342dad306d58c2ac893889e843e95281b0e39"}},"rounds":[],"commandChecks":[],"candidates":[],"verifications":[]}
  71 |     await new Promise(done => setTimeout(done, 25));
  72 |   }
  73 |   return {
  74 |     directory, root, data, scope, runId, taskId, post, state, baseUrl: () => base, modelRequests: () => modelRequests,
  75 |     restart: async () => { await app.close(); app = await createApplication(data, options); await listen(); },
  76 |   };
  77 | }
  78 | 
  79 | /** Explicit policy obligations enter through the real initial-planning admission path. */
  80 | function roundReviewProposal() {
  81 |   return {
  82 |     kind: 'plan', summary: 'Check the actual file with tools, then independently review its semantics.',
  83 |     assignments: [{ taskId: 'coding-task', role: 'executor', instruction: 'Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.' }],
  84 |     plan: {
  85 |       stages: [{ stageId: 'work', title: 'File task' }],
  86 |       tasks: [
  87 |         { taskId: 'coding-task', stageId: 'work', title: 'Inspect file', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'work' } },
  88 |         { taskId: 'gate-goal', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  89 |       ],
  90 |       obligations: [{ obligationId: 'file-contract', title: 'File semantics and behavior', requirementLevel: 'required', taskIds: ['coding-task', 'gate-goal'], verificationRequirements: [
  91 |         { requirementId: 'behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Run all registered behavior checks.' },
  92 |         { requirementId: 'semantics', requirementLevel: 'required', kind: 'reviewer', description: 'Independent semantic review of this source version.' },
  93 |       ] }],
  94 |       taskHierarchy: { parentOf: [{ parentTaskId: 'gate-goal', childTaskId: 'coding-task' }] },
  95 |       executionDag: { dependsOn: [{ taskId: 'gate-goal', dependsOnId: 'coding-task', requires: { kind: 'gate-result', label: 'Current Task verification' } }] },
  96 |     },
  97 |   };
  98 | }
  99 | 
```