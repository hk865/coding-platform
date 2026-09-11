import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GuiState } from '../../src/ui/src/api/types.js';

/** Real HTTP host, kernel and SQLite/Vault; only the external model is a local stub. */
type ApplicationFactory = (directory: string, options: { modelSettings: { directory: string } }) => Promise<{ server: Server; close(): Promise<void> }>;
export type ReviewProtocolRequest = { tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ role: string; content?: unknown; tool_call_id?: string }> };
export type ReviewProtocolReply = { content?: string; calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> };
export async function verificationRoundFixture(cleanup: Array<() => Promise<void>>, reviewerRequired: boolean, createApplication: ApplicationFactory,
  // `plan` 只在需要换一份初始规划提案时给出（默认仍是本夹具原有的计划形状）：
  // 它是模型桩对规划调用的回答，不是产品语义的一部分。
  options: { reviewer?: (request: ReviewProtocolRequest) => Promise<ReviewProtocolReply>; plan?: () => unknown } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'verification-round-http-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'project');
  await mkdir(root);
  await writeFile(join(root, 'subject.txt'), 'expected\n');
  let modelRequests = 0;
  const provider = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as ReviewProtocolRequest;
    modelRequests++;
    if(JSON.stringify(body.messages).includes('execution_coordination')) {
      // Exercise the real QueryRun read tool before declaring sourced repair
      // material. Its verification requirements are kept by formal acceptance.
      const read=body.messages?.find(message=>message.role==='tool' && JSON.stringify(message.content).includes('subject.txt') && JSON.stringify(message.content).includes('revision'));
      const reply:ReviewProtocolReply=read?{content:JSON.stringify({kind:'feedback_resolution',action:'adjust_plan',availability:'available',
        summary:'Read current subject.txt and investigate the retained verification failure.',
        material:'Inspect the current subject.txt, whose expected fixture content is expected followed by a newline. Address the reported failure while preserving all existing acceptance obligations, registered checks and independent Reviewer requirements. A tool failure remains unresolved until a current successful verification.',sourcePaths:['subject.txt']})}:
        {calls:[{id:'coordination-read-subject',name:'read',arguments:{path:'subject.txt'}}]};
      response.writeHead(200,{'content-type':'text/event-stream'});
      response.end('data: '+JSON.stringify({choices:[{index:0,delta:{...(reply.content!==undefined?{content:reply.content}:{}),
        ...(reply.calls?{tool_calls:reply.calls.map((call,index)=>({index,id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}))}:{})},finish_reason:null}]})+
        '\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:reply.calls?'tool_calls':'stop'}],usage:{prompt_tokens:200,completion_tokens:100}})+'\n\ndata: [DONE]\n\n');
      return;
    }
    if (options.reviewer && body.tools?.some(tool => tool.function?.name === 'read_source')) {
      try {
        const reply = await options.reviewer(body);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {
          ...(reply.content !== undefined ? { content: reply.content } : {}),
          ...(reply.calls ? { tool_calls: reply.calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
        }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: reply.calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 100 } }) + '\n\ndata: [DONE]\n\n');
      } catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : 'Protocol fixture failed'); }
      return;
    }
    const planning = reviewerRequired && !body.tools?.some(tool => tool.function?.name === 'edit');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({
      choices: [{ index: 0, delta: { content: planning ? JSON.stringify((options.plan ?? roundReviewProposal)()) : 'Ready for independent verification.' }, finish_reason: null }],
    }) + '\n\ndata: ' + JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
  cleanup.push(async () => {
    provider.closeAllConnections();
    await new Promise<void>(done => provider.close(() => done()));
  });
  const providerAddress = provider.address();
  if (!providerAddress || typeof providerAddress === 'string') throw Error('No local model address');
  const data = join(directory, 'data');
  const applicationOptions = { modelSettings: { directory: join(directory, 'model-settings') } };
  let app = await createApplication(data, applicationOptions);
  cleanup.push(() => app.close());
  let base = '', token = '';
  async function listen() {
    await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw Error('No application address');
    base = `http://127.0.0.1:${address.port}`;
    token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  }
  async function post<T = Record<string, unknown>>(path: string, input: unknown) {
    const response = await fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(input),
    });
    return { status: response.status, body: await response.json() as T };
  }
  await listen();
  await post('/api/model-settings', { provider: 'deepseek', model: 'verification-protocol-stub', baseUrl: `http://127.0.0.1:${providerAddress.port}`, apiKey: 'local-test-only' });
  const project = await post<{ projectId: string; workspaceId: string }>('/api/projects/add', { path: root });
  const scope = { projectId: project.body.projectId, workspaceId: project.body.workspaceId, goalId: 'round-goal' };
  await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Verify subject.txt through registered checks and independent review' });
  const submitted = await post(reviewerRequired ? '/api/real/work' : '/api/real/tasks', { ...scope, requestId: 'round-task', instruction: 'Inspect subject.txt; leave independent checking and semantic review to the platform.', allowWrite: true });
  if (submitted.status !== 200) throw Error(JSON.stringify(submitted));
  let runId = '';
  const taskId = 'coding-task';
  const state = async () => (await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json()) as GuiState;
  const deadline = Date.now() + 20000;
  for (;;) {
    const current = await state();
    const run = current.liveRuns?.find(value => value.spec.taskId === taskId);
    if (run?.status === 'completed' && current.agents.status === 'ready' && current.agents.agents.rows.some(value => value.runRef.runId === run.spec.runId && value.displayState === 'completed_run')) { runId = run.spec.runId; break; }
    if (Date.now() >= deadline) throw Error('Real Task did not publish its ended Run: ' + JSON.stringify(run));
    await new Promise(done => setTimeout(done, 25));
  }
  return {
    directory, root, data, scope, runId, taskId, post, state, baseUrl: () => base, modelRequests: () => modelRequests,
    restart: async () => { await app.close(); app = await createApplication(data, applicationOptions); await listen(); },
  };
}

/** Explicit policy obligations enter through the real initial-planning admission path. */
function roundReviewProposal() {
  return {
    kind: 'plan', summary: 'Check the actual file with tools, then independently review its semantics.',
    assignments: [{ taskId: 'coding-task', role: 'executor', instruction: 'Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.' }],
    plan: {
      stages: [{ stageId: 'work', title: 'File task' }],
      tasks: [
        { taskId: 'coding-task', stageId: 'work', title: 'Inspect file', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'work' } },
        { taskId: 'gate-goal', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      obligations: [{ obligationId: 'file-contract', title: 'File semantics and behavior', requirementLevel: 'required', taskIds: ['coding-task', 'gate-goal'], verificationRequirements: [
        { requirementId: 'behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Run all registered behavior checks.' },
        { requirementId: 'semantics', requirementLevel: 'required', kind: 'reviewer', description: 'Independent semantic review of this source version.' },
      ] }],
      taskHierarchy: { parentOf: [{ parentTaskId: 'gate-goal', childTaskId: 'coding-task' }] },
      executionDag: { dependsOn: [{ taskId: 'gate-goal', dependsOnId: 'coding-task', requires: { kind: 'gate-result', label: 'Current Task verification' } }] },
    },
  };
}
