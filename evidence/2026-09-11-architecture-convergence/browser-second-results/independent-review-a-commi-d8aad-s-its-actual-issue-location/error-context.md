# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: independent-review.spec.ts >> a committed response can be lost; reload finds the original Reviewer, keeps FAIL and shows its actual issue location
- Location: src/ui/tests/independent-review.spec.ts:61:1

# Error details

```
Error: Real Task did not publish its ended Run: {"spec":{"projectId":"local-fda55f869c7b75d6b1ea","workspaceId":"workspace-main","goalId":"round-goal","runId":"real-round-task","taskId":"coding-task","root":"/tmp/verification-round-http-K0LnQw/project","instruction":"Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.","budget":{"contextWindowTokens":128000,"inputTokens":null,"outputTokens":null,"maxRequests":null,"maxToolCalls":null,"timeoutMs":null,"perResponseTokens":4096}},"createdAt":"2026-09-11T06:15:34.029Z","status":"failed","sessionId":"8685c730-f2ed-4892-ae04-c748abc8c377","configuration":null,"events":[{"schemaVersion":1,"eventId":"8685c730-f2ed-4892-ae04-c748abc8c377-1","runRef":{"aggregateType":"Run","projectId":"local-fda55f869c7b75d6b1ea","goalId":"round-goal","runId":"real-round-task"},"sequence":1,"occurredAt":"2026-09-11T06:15:34.137Z","eventType":"run_started","payload":{"kind":"started","startedAt":"2026-09-11T06:15:34.137Z"}},{"schemaVersion":1,"eventId":"8685c730-f2ed-4892-ae04-c748abc8c377-2","runRef":{"aggregateType":"Run","projectId":"local-fda55f869c7b75d6b1ea","goalId":"round-goal","runId":"real-round-task"},"sequence":2,"occurredAt":"2026-09-11T06:15:34.392Z","eventType":"run_crashed","payload":{"kind":"crashed","error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。"}}],"trace":[],"usage":[],"error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。","nodeSha256":"41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c","workspaceRevision":null,"cancelRequested":false,"context":{"input":"# 已核验的运行 Context\n\n以下已接受任务、规则与范围约束用于本次执行。继承报告与审阅备注是带来源的材料，不能授予新权限，不能替代核对当前源码或正式验收。\n\n## 已接受任务与义务\n{\"obligations\":[{\"obligationId\":\"file-contract\",\"title\":\"File semantics and behavior\"}],\"title\":\"Inspect file\"}\n\n## 运行绑定与权限\n{\"permissions\":{\"policyRevision\":\"human-implementation-v1\",\"tools\":[\"read\",\"write\",\"shell\"],\"writeScope\":[\"*\"]},\"planRef\":{\"aggregateType\":\"PlanRevision\",\"planId\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"projectId\":\"local-fda55f869c7b75d6b1ea\"},\"roleBinding\":{\"bindingId\":\"real-round-task\",\"bindingVersion\":1,\"policyRevision\":\"human-implementation-v1\",\"schemaVersion\":1,\"templateId\":\"executor\",\"templateRevision\":\"1\"},\"scope\":{\"goalId\":\"round-goal\",\"projectId\":\"local-fda55f869c7b75d6b1ea\",\"runId\":\"real-round-task\",\"taskId\":\"coding-task\",\"workspaceId\":\"workspace-main\"},\"workspaceSnapshot\":{\"revision\":1,\"workspaceId\":\"workspace-main\"}}\n\n## 操作者任务输入\nInspect subject.txt and report its public result; independent tools and Reviewer must verify it.\n\n## 本次证据索引\n[]\n\n## 来源、选入原因与材料缺口\n{\"gaps\":[\"[role-materials] 本次运行没有角色规格可依（项目当前生效的 CoordinationPolicy 没有角色矩阵，按 RW-11 沿用既有绑定语义）：角色取材未生效。这只是如实说明，不降低本次运行的权限、来源与验收判据。\",\"[work-context] 工作上下文未被组装（needs_material）：binding_missing: work-context view is not ready for assembly\",\"本次 Context 未携带 WorkContext 工作身份与历史材料（该运行没有派发时编译的工作身份，或宿主未接线 CompletedWork 历史检索与 ExecutionMemory 层级）；此包不代表完整长期 Context。\"],\"selected\":[{\"digest\":\"c7773290d5b19980c783837452b1a564cce401e40e846a98ba13cb9ab6700441\",\"id\":\"env-context-attempt-real-round-task\",\"kind\":\"accepted-task-bundle\",\"selectedBecause\":\"当前 Control 已接受的任务、义务、角色权限和版本绑定\",\"sourceRefs\":[{\"digest\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]},{\"digest\":\"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d\",\"id\":\"real-round-task\",\"kind\":\"operator-instruction\",\"selectedBecause\":\"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据\",\"sourceRefs\":[{\"digest\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]},{\"digest\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"id\":\"coding-task\",\"kind\":\"evidence-index\",\"selectedBecause\":\"当前直接前驱正式验收的证据索引；仅索引，不将未读取正文当作已核验事实\",\"sourceRefs\":[]}],\"selection\":[],\"truncated\":[]}","manifest":{"schemaVersion":1,"bundleRef":{"kind":"artifact","contentType":"application/json","digest":"c7773290d5b19980c783837452b1a564cce401e40e846a98ba13cb9ab6700441","sizeBytes":1323,"source":{"kind":"plan-revision","refId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb","revision":"1","digest":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"}},"scope":{"projectId":"local-fda55f869c7b75d6b1ea","workspaceId":"workspace-main","goalId":"round-goal","taskId":"coding-task","runId":"real-round-task"},"planRef":{"aggregateType":"PlanRevision","projectId":"local-fda55f869c7b75d6b1ea","planId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"},"workspaceSnapshot":{"workspaceId":"workspace-main","revision":1},"permissions":{"policyRevision":"human-implementation-v1","tools":["read","write","shell"],"writeScope":["*"]},"selected":[{"kind":"accepted-task-bundle","id":"env-context-attempt-real-round-task","digest":"c7773290d5b19980c783837452b1a564cce401e40e846a98ba13cb9ab6700441","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb","revision":"1","digest":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"当前 Control 已接受的任务、义务、角色权限和版本绑定"},{"kind":"operator-instruction","id":"real-round-task","digest":"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb","revision":"1","digest":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据"},{"kind":"evidence-index","id":"coding-task","digest":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","sourceRefs":[],"selectedBecause":"当前直接前驱正式验收的证据索引；仅索引，不将未读取正文当作已核验事实"}],"gaps":["[role-materials] 本次运行没有角色规格可依（项目当前生效的 CoordinationPolicy 没有角色矩阵，按 RW-11 沿用既有绑定语义）：角色取材未生效。这只是如实说明，不降低本次运行的权限、来源与验收判据。","[work-context] 工作上下文未被组装（needs_material）：binding_missing: work-context view is not ready for assembly","本次 Context 未携带 WorkContext 工作身份与历史材料（该运行没有派发时编译的工作身份，或宿主未接线 CompletedWork 历史检索与 ExecutionMemory 层级）；此包不代表完整长期 Context。"],"truncated":[],"inputDigest":"acce0faef1f1141c7c7b602c698637d35e6ee01b03ef68b45854dd42fa09ff7a","selection":[]}},"reviews":[],"rounds":[],"commandChecks":[],"candidates":[],"verifications":[]}
```

# Test source

```ts
  1   | import { createServer, type Server } from 'node:http';
  2   | import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
  3   | import { tmpdir } from 'node:os';
  4   | import { join } from 'node:path';
  5   | import type { GuiState } from '../../src/ui/src/api/types.js';
  6   | 
  7   | /** Real HTTP host, kernel and SQLite/Vault; only the external model is a local stub. */
  8   | type ApplicationFactory = (directory: string, options: { modelSettings: { directory: string } }) => Promise<{ server: Server; close(): Promise<void> }>;
  9   | export type ReviewProtocolRequest = { tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ role: string; content?: unknown; tool_call_id?: string }> };
  10  | export type ReviewProtocolReply = { content?: string; calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> };
  11  | export async function verificationRoundFixture(cleanup: Array<() => Promise<void>>, reviewerRequired: boolean, createApplication: ApplicationFactory,
  12  |   // `plan` 只在需要换一份初始规划提案时给出（默认仍是本夹具原有的计划形状）：
  13  |   // 它是模型桩对规划调用的回答，不是产品语义的一部分。
  14  |   options: { reviewer?: (request: ReviewProtocolRequest) => Promise<ReviewProtocolReply>; plan?: () => unknown } = {}) {
  15  |   const directory = await mkdtemp(join(tmpdir(), 'verification-round-http-'));
  16  |   cleanup.push(() => rm(directory, { recursive: true, force: true }));
  17  |   const root = join(directory, 'project');
  18  |   await mkdir(root);
  19  |   await writeFile(join(root, 'subject.txt'), 'expected\n');
  20  |   let modelRequests = 0;
  21  |   const provider = createServer(async (request, response) => {
  22  |     let raw = '';
  23  |     for await (const chunk of request) raw += chunk;
  24  |     const body = JSON.parse(raw) as ReviewProtocolRequest;
  25  |     modelRequests++;
  26  |     if (options.reviewer && body.tools?.some(tool => tool.function?.name === 'read_source')) {
  27  |       try {
  28  |         const reply = await options.reviewer(body);
  29  |         response.writeHead(200, { 'content-type': 'text/event-stream' });
  30  |         response.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {
  31  |           ...(reply.content !== undefined ? { content: reply.content } : {}),
  32  |           ...(reply.calls ? { tool_calls: reply.calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
  33  |         }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reply.calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 100 } }) + '\n\ndata: [DONE]\n\n');
  34  |       } catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : 'Protocol fixture failed'); }
  35  |       return;
  36  |     }
  37  |     const planning = reviewerRequired && !body.tools?.some(tool => tool.function?.name === 'edit');
  38  |     response.writeHead(200, { 'content-type': 'text/event-stream' });
  39  |     response.end('data: ' + JSON.stringify({
  40  |       choices: [{ index: 0, delta: { content: planning ? JSON.stringify((options.plan ?? roundReviewProposal)()) : 'Ready for independent verification.' }, finish_reason: null }],
  41  |     }) + '\n\ndata: ' + JSON.stringify({
  42  |       choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  43  |       usage: { prompt_tokens: 20, completion_tokens: 10 },
  44  |     }) + '\n\ndata: [DONE]\n\n');
  45  |   });
  46  |   await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
  47  |   cleanup.push(async () => {
  48  |     provider.closeAllConnections();
  49  |     await new Promise<void>(done => provider.close(() => done()));
  50  |   });
  51  |   const providerAddress = provider.address();
  52  |   if (!providerAddress || typeof providerAddress === 'string') throw Error('No local model address');
  53  |   const data = join(directory, 'data');
  54  |   const applicationOptions = { modelSettings: { directory: join(directory, 'model-settings') } };
  55  |   let app = await createApplication(data, applicationOptions);
  56  |   cleanup.push(() => app.close());
  57  |   let base = '', token = '';
  58  |   async function listen() {
  59  |     await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  60  |     const address = app.server.address();
  61  |     if (!address || typeof address === 'string') throw Error('No application address');
  62  |     base = `http://127.0.0.1:${address.port}`;
  63  |     token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  64  |   }
  65  |   async function post<T = Record<string, unknown>>(path: string, input: unknown) {
  66  |     const response = await fetch(base + path, {
  67  |       method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(input),
  68  |     });
  69  |     return { status: response.status, body: await response.json() as T };
  70  |   }
  71  |   await listen();
  72  |   await post('/api/model-settings', { provider: 'deepseek', model: 'verification-protocol-stub', baseUrl: `http://127.0.0.1:${providerAddress.port}`, apiKey: 'local-test-only' });
  73  |   const project = await post<{ projectId: string; workspaceId: string }>('/api/projects/add', { path: root });
  74  |   const scope = { projectId: project.body.projectId, workspaceId: project.body.workspaceId, goalId: 'round-goal' };
  75  |   await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Verify subject.txt through registered checks and independent review' });
  76  |   const submitted = await post(reviewerRequired ? '/api/real/work' : '/api/real/tasks', { ...scope, requestId: 'round-task', instruction: 'Inspect subject.txt; leave independent checking and semantic review to the platform.', allowWrite: true });
  77  |   if (submitted.status !== 200) throw Error(JSON.stringify(submitted));
  78  |   let runId = '';
  79  |   const taskId = 'coding-task';
  80  |   const state = async () => (await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json()) as GuiState;
  81  |   const deadline = Date.now() + 20000;
  82  |   for (;;) {
  83  |     const current = await state();
  84  |     const run = current.liveRuns?.find(value => value.spec.taskId === taskId);
  85  |     if (run?.status === 'completed' && current.agents.status === 'ready' && current.agents.agents.rows.some(value => value.runRef.runId === run.spec.runId && value.displayState === 'completed_run')) { runId = run.spec.runId; break; }
> 86  |     if (Date.now() >= deadline) throw Error('Real Task did not publish its ended Run: ' + JSON.stringify(run));
      |                                       ^ Error: Real Task did not publish its ended Run: {"spec":{"projectId":"local-fda55f869c7b75d6b1ea","workspaceId":"workspace-main","goalId":"round-goal","runId":"real-round-task","taskId":"coding-task","root":"/tmp/verification-round-http-K0LnQw/project","instruction":"Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.","budget":{"contextWindowTokens":128000,"inputTokens":null,"outputTokens":null,"maxRequests":null,"maxToolCalls":null,"timeoutMs":null,"perResponseTokens":4096}},"createdAt":"2026-09-11T06:15:34.029Z","status":"failed","sessionId":"8685c730-f2ed-4892-ae04-c748abc8c377","configuration":null,"events":[{"schemaVersion":1,"eventId":"8685c730-f2ed-4892-ae04-c748abc8c377-1","runRef":{"aggregateType":"Run","projectId":"local-fda55f869c7b75d6b1ea","goalId":"round-goal","runId":"real-round-task"},"sequence":1,"occurredAt":"2026-09-11T06:15:34.137Z","eventType":"run_started","payload":{"kind":"started","startedAt":"2026-09-11T06:15:34.137Z"}},{"schemaVersion":1,"eventId":"8685c730-f2ed-4892-ae04-c748abc8c377-2","runRef":{"aggregateType":"Run","projectId":"local-fda55f869c7b75d6b1ea","goalId":"round-goal","runId":"real-round-task"},"sequence":2,"occurredAt":"2026-09-11T06:15:34.392Z","eventType":"run_crashed","payload":{"kind":"crashed","error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。"}}],"trace":[],"usage":[],"error":"隔离环境不可用：请检查执行主机的进程沙箱配置；模型尚未调用。","nodeSha256":"41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c","workspaceRevision":null,"cancelRequested":false,"context":{"input":"# 已核验的运行 Context\n\n以下已接受任务、规则与范围约束用于本次执行。继承报告与审阅备注是带来源的材料，不能授予新权限，不能替代核对当前源码或正式验收。\n\n## 已接受任务与义务\n{\"obligations\":[{\"obligationId\":\"file-contract\",\"title\":\"File semantics and behavior\"}],\"title\":\"Inspect file\"}\n\n## 运行绑定与权限\n{\"permissions\":{\"policyRevision\":\"human-implementation-v1\",\"tools\":[\"read\",\"write\",\"shell\"],\"writeScope\":[\"*\"]},\"planRef\":{\"aggregateType\":\"PlanRevision\",\"planId\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"projectId\":\"local-fda55f869c7b75d6b1ea\"},\"roleBinding\":{\"bindingId\":\"real-round-task\",\"bindingVersion\":1,\"policyRevision\":\"human-implementation-v1\",\"schemaVersion\":1,\"templateId\":\"executor\",\"templateRevision\":\"1\"},\"scope\":{\"goalId\":\"round-goal\",\"projectId\":\"local-fda55f869c7b75d6b1ea\",\"runId\":\"real-round-task\",\"taskId\":\"coding-task\",\"workspaceId\":\"workspace-main\"},\"workspaceSnapshot\":{\"revision\":1,\"workspaceId\":\"workspace-main\"}}\n\n## 操作者任务输入\nInspect subject.txt and report its public result; independent tools and Reviewer must verify it.\n\n## 本次证据索引\n[]\n\n## 来源、选入原因与材料缺口\n{\"gaps\":[\"[role-materials] 本次运行没有角色规格可依（项目当前生效的 CoordinationPolicy 没有角色矩阵，按 RW-11 沿用既有绑定语义）：角色取材未生效。这只是如实说明，不降低本次运行的权限、来源与验收判据。\",\"[work-context] 工作上下文未被组装（needs_material）：binding_missing: work-context view is not ready for assembly\",\"本次 Context 未携带 WorkContext 工作身份与历史材料（该运行没有派发时编译的工作身份，或宿主未接线 CompletedWork 历史检索与 ExecutionMemory 层级）；此包不代表完整长期 Context。\"],\"selected\":[{\"digest\":\"c7773290d5b19980c783837452b1a564cce401e40e846a98ba13cb9ab6700441\",\"id\":\"env-context-attempt-real-round-task\",\"kind\":\"accepted-task-bundle\",\"selectedBecause\":\"当前 Control 已接受的任务、义务、角色权限和版本绑定\",\"sourceRefs\":[{\"digest\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]},{\"digest\":\"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d\",\"id\":\"real-round-task\",\"kind\":\"operator-instruction\",\"selectedBecause\":\"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据\",\"sourceRefs\":[{\"digest\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"kind\":\"plan-revision\",\"refId\":\"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb\",\"revision\":\"1\"},{\"kind\":\"workspace\",\"refId\":\"workspace-main\",\"revision\":\"1\"}]},{\"digest\":\"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\",\"id\":\"coding-task\",\"kind\":\"evidence-index\",\"selectedBecause\":\"当前直接前驱正式验收的证据索引；仅索引，不将未读取正文当作已核验事实\",\"sourceRefs\":[]}],\"selection\":[],\"truncated\":[]}","manifest":{"schemaVersion":1,"bundleRef":{"kind":"artifact","contentType":"application/json","digest":"c7773290d5b19980c783837452b1a564cce401e40e846a98ba13cb9ab6700441","sizeBytes":1323,"source":{"kind":"plan-revision","refId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb","revision":"1","digest":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"}},"scope":{"projectId":"local-fda55f869c7b75d6b1ea","workspaceId":"workspace-main","goalId":"round-goal","taskId":"coding-task","runId":"real-round-task"},"planRef":{"aggregateType":"PlanRevision","projectId":"local-fda55f869c7b75d6b1ea","planId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"},"workspaceSnapshot":{"workspaceId":"workspace-main","revision":1},"permissions":{"policyRevision":"human-implementation-v1","tools":["read","write","shell"],"writeScope":["*"]},"selected":[{"kind":"accepted-task-bundle","id":"env-context-attempt-real-round-task","digest":"c7773290d5b19980c783837452b1a564cce401e40e846a98ba13cb9ab6700441","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb","revision":"1","digest":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"当前 Control 已接受的任务、义务、角色权限和版本绑定"},{"kind":"operator-instruction","id":"real-round-task","digest":"0dedb4d60164175972e42586f72533f594ab0e6082a92cd615a5ad3b6ae12f8d","sourceRefs":[{"kind":"plan-revision","refId":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb","revision":"1","digest":"model-plan-d56c9a07bc0c4a9bb2c5d9a2d7219feb"},{"kind":"workspace","refId":"workspace-main","revision":"1"}],"selectedBecause":"此 Run 持久化的操作者任务输入；不代表额外权限或完成证据"},{"kind":"evidence-index","id":"coding-task","digest":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","sourceRefs":[],"selectedBecause":"当前直接前驱正式验收的证据索引；仅索引，不将未读取正文当作已核验事实"}],"gaps":["[role-materials] 本次运行没有角色规格可依（项目当前生效的 CoordinationPolicy 没有角色矩阵，按 RW-11 沿用既有绑定语义）：角色取材未生效。这只是如实说明，不降低本次运行的权限、来源与验收判据。","[work-context] 工作上下文未被组装（needs_material）：binding_missing: work-context view is not ready for assembly","本次 Context 未携带 WorkContext 工作身份与历史材料（该运行没有派发时编译的工作身份，或宿主未接线 CompletedWork 历史检索与 ExecutionMemory 层级）；此包不代表完整长期 Context。"],"truncated":[],"inputDigest":"acce0faef1f1141c7c7b602c698637d35e6ee01b03ef68b45854dd42fa09ff7a","selection":[]}},"reviews":[],"rounds":[],"commandChecks":[],"candidates":[],"verifications":[]}
  87  |     await new Promise(done => setTimeout(done, 25));
  88  |   }
  89  |   return {
  90  |     directory, root, data, scope, runId, taskId, post, state, baseUrl: () => base, modelRequests: () => modelRequests,
  91  |     restart: async () => { await app.close(); app = await createApplication(data, applicationOptions); await listen(); },
  92  |   };
  93  | }
  94  | 
  95  | /** Explicit policy obligations enter through the real initial-planning admission path. */
  96  | function roundReviewProposal() {
  97  |   return {
  98  |     kind: 'plan', summary: 'Check the actual file with tools, then independently review its semantics.',
  99  |     assignments: [{ taskId: 'coding-task', role: 'executor', instruction: 'Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.' }],
  100 |     plan: {
  101 |       stages: [{ stageId: 'work', title: 'File task' }],
  102 |       tasks: [
  103 |         { taskId: 'coding-task', stageId: 'work', title: 'Inspect file', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'work' } },
  104 |         { taskId: 'gate-goal', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  105 |       ],
  106 |       obligations: [{ obligationId: 'file-contract', title: 'File semantics and behavior', requirementLevel: 'required', taskIds: ['coding-task', 'gate-goal'], verificationRequirements: [
  107 |         { requirementId: 'behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Run all registered behavior checks.' },
  108 |         { requirementId: 'semantics', requirementLevel: 'required', kind: 'reviewer', description: 'Independent semantic review of this source version.' },
  109 |       ] }],
  110 |       taskHierarchy: { parentOf: [{ parentTaskId: 'gate-goal', childTaskId: 'coding-task' }] },
  111 |       executionDag: { dependsOn: [{ taskId: 'gate-goal', dependsOnId: 'coding-task', requires: { kind: 'gate-result', label: 'Current Task verification' } }] },
  112 |     },
  113 |   };
  114 | }
  115 | 
```