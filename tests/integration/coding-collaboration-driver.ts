import assert from 'node:assert/strict';
import { waitForReaderOverlap } from './reader-overlap.js';
import { createCollaborationHttpClient } from './collaboration-http-client.js';
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createGuiServer as sourceGuiServer } from '../../src/app/server.js';
import { createModelSettings } from '../../src/app/model-settings.js';
import { openCollaborationBrowser } from './coding-collaboration-browser.js';
import { ControlEngineImpl as SourceControlEngine } from '../../src/control/control-engine/control-engine.js';
import { roleSpecSourceFor, buildCoordinationPolicyContentWithoutRolesV1 } from '../../src/fixtures/role-spec-fixtures.js';
import { workIdFor } from '../../src/contracts/task-work-identity.js';
import { createBuiltinProviderRegistry, type ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';
import { deterministicReview, verifyCodingLineage, verifyCodingProducer } from './coding-collaboration-verification.js';
const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const createGuiServer: typeof sourceGuiServer = config.browser ? (await import(pathToFileURL(resolve('dist/app/server.js')).href)).createGuiServer : sourceGuiServer;
const ControlEngineImpl: typeof SourceControlEngine = config.browser ? (await import(pathToFileURL(resolve('dist/control/control-engine/control-engine.js')).href)).ControlEngineImpl : SourceControlEngine;
const bound = config.realModel ? await (await createModelSettings(config.data, { directory: '/home/han001/.config/agent-platform/2925e9d16dbd6c81bc7fcb84' })).bindRun('coding-collaboration-' + config.phase) : null;
// Real14 was still reading/generating at the old 240s observation deadline.
// This test-only allowance never enters the persisted RuntimeBudget.
const realReviewObservation = bound ? { reviewTimeoutMs: 600000 } : {};
let afterProfileRevision = 0;
let browserSession: Awaited<ReturnType<typeof openCollaborationBrowser>> | undefined;
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'coding-collaboration' };
const names = ['coordinator', 'reader-a', 'reader-b'];
const workNames = ['coding', ...names];
const plan = { kind: 'plan', summary: 'Repair then inspect the real todo contract together before deciding a proposed interface change.', assignments: [{ taskId: 'coding', role: 'executor', instruction: 'CC_CODING: Read RULES.md and src/utils/grouping.mjs. Repair only the no-deadline far regression back to today using read/edit expectedRevision. Preserve all other branches, caller identity, date.mjs and check.mjs. Formal verification remains mandatory.' }, ...names.map(taskId => ({ taskId, role: 'document-advisor', instruction: `CC_${taskId}: Read RULES.md, src/utils/grouping.mjs and the actual check.mjs consumer. Investigate the repaired current source and a proposed change from today to far. Produce a sourced report through coordination tools. On receiving a human architecture decision, reread those three files in the new Run and explain the exact decision, source versions and current behavior in the final public report. Preserve all source; independent verification remains required.` }))], plan: {
  stages: [{ stageId: 'inspect', title: 'Repair and investigate todo grouping' }], tasks: [...workNames.map(taskId => ({ taskId, title: taskId, taskKind: 'work', stageId: 'inspect', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'inspect' } })), { taskId: 'goal-gate', title: 'Accept real todo behavior', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
  obligations: [...workNames, 'goal-gate'].map(taskId => ({ obligationId: 'todo-' + taskId, title: 'Current todo contract ' + taskId, requirementLevel: 'required', taskIds: [taskId], verificationRequirements: [{ requirementId: 'behavior', kind: names.includes(taskId) ? 'static' : 'dynamic', requirementLevel: 'required', description: names.includes(taskId) ? 'Qualify this current final read-only report: successful complete reads of RULES.md and src/utils/grouping.mjs at their current exact versions, nonempty final report, no write effects. This mechanical qualification does not assess report truth or quality.' : 'Independently execute immutable todo behavior checks at the current workspace version.' }, { requirementId: 'review', kind: 'reviewer', requirementLevel: 'required', description: names.includes(taskId) ? 'Independently read the actual original final report and current source. Assess its sourced explanation of today versus proposed far, caller identity, affected consumers, and any received exact human decision without claiming baseline activation or acceptance.' : 'Read current source and original behavior evidence independently; work report alone does not satisfy this obligation.' }] })), taskHierarchy: { parentOf: workNames.map(childTaskId => ({ parentTaskId: 'goal-gate', childTaskId })) }, executionDag: { dependsOn: [...names.map(taskId => ({ taskId, dependsOnId: 'coding', requires: { kind: 'artifact', label: 'repaired implementation' } })), ...workNames.map(dependsOnId => ({ taskId: 'goal-gate', dependsOnId, requires: { kind: 'gate-result', label: 'Independent current verification' } }))] },
} };
function objects(value: any): any[] { if (Array.isArray(value)) return value.flatMap(objects); if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(objects)]; if (typeof value !== 'string') return []; try { return objects(JSON.parse(value)); } catch { return value.split(/\n+/).flatMap(s => { try { return objects(JSON.parse(s)); } catch { return []; } }); } }
const observations: any = config.phase === 'initial' ? { scope, pid: process.pid, stages: [] } : JSON.parse(readFileSync(config.observations, 'utf8'));
afterProfileRevision = observations.afterProfileRevision ?? 0;
const stageDirectory = join(config.output, 'stages'); mkdirSync(stageDirectory, { recursive: true });
const audit = (event: string) => appendFileSync(join(config.output, `${config.phase}-lifecycle.jsonl`), JSON.stringify({ event, pid: process.pid, at: new Date().toISOString() }) + '\n', { flush: true });
let lastFailure = JSON.stringify([observations.timeout?.detectedAt, observations.error]), failureSequence = 0;
const save = () => {
  writeFileSync(config.observations, JSON.stringify(observations, null, 2), { flush: true });
  writeFileSync(join(config.output, `${config.phase}-progress.json`), JSON.stringify({ pid: process.pid, at: new Date().toISOString(),
    completedQueryStages: observations.stages.map((stage: any) => stage.requestId),
    verification: Object.fromEntries(Object.entries(observations.verification ?? {}).filter(([key]) => key !== 'latestState').map(([key, value]: [string, any]) =>
      [key, { reviewPhase: value.review?.phase ?? null, taskPhase: value.review?.formal?.taskPhase ?? null }])) }), { flush: true });
  const failure = JSON.stringify([observations.timeout?.detectedAt, observations.error]);
  if (failure !== lastFailure) {
    writeFileSync(join(config.output, `${config.phase}-${process.pid}-failure-${++failureSequence}.json`), JSON.stringify(observations), { flush: true, flag: 'wx' });
    lastFailure = failure;
  }
};
audit('process-start');
if (config.phase === 'initial') {
  const admit = ControlEngineImpl.prototype.admitWaitSuccessor;
  ControlEngineImpl.prototype.admitWaitSuccessor = async function(command: any) {
    const result = await admit.call(this, command);
    if (result.status === 'committed') { observations.waitAdmissions ??= []; observations.waitAdmissions.push({ waitRef: command.payload.waitRef, expectedRevision: command.expectedRevision, leaseGeneration: command.payload.intentClaim?.leaseGeneration, predecessorRunRef: command.payload.predecessorRunRef, receipt: result }); save(); }
    return result;
  };
  const original = ControlEngineImpl.prototype.recordArchitectureReview;
  ControlEngineImpl.prototype.recordArchitectureReview = async function(command: any) {
    const result = await original.call(this, command);
    if (command.action.kind === 'decide' && result.status === 'committed') {
      save(); const receipt = JSON.stringify({ pid: process.pid, fault: 'SIGKILL-after-decision-commit-before-wake', receipt: result });
      writeFileSync(config.receipt, receipt, { flush: true }); writeFileSync(join(config.output, 'receipt.json'), receipt, { flush: true });
      audit('decision-committed-before-wake'); await browserSession?.close(); process.kill(process.pid, 'SIGKILL'); await new Promise<never>(() => {});
    }
    return result;
  };
}
let releaseReaders!: () => void, readers = new Set<string>();
const overlap = new Promise<void>(resolve => { releaseReaders = resolve; });
let releaseExperience!: () => void;
const experienceRelease = new Promise<void>(resolve => { releaseExperience = resolve; });
let heldExperience = false;
let experienceObserved = false;
let releaseRequests!: () => void;
const requestsReady = new Promise<void>(resolve => { releaseRequests = resolve; });
let releaseSecondRequest!: () => void, releaseFirstReader!: () => void;
const secondRequestReady = new Promise<void>(resolve => { releaseSecondRequest = resolve; });
const firstReaderEntered = new Promise<void>(resolve => { releaseFirstReader = resolve; });
const queries: any[] = [];
const registry = createBuiltinProviderRegistry();
const client: ModelClientPort = { async *stream(request, options) {
  const text = JSON.stringify(request.messages), values = objects(request.messages.filter(m => m.role === 'tool'));
  const who = names.find(name => text.includes('CC_' + name));
  const answerReviewRequest = request.runId.endsWith('-answer-review');
  const queryRequest = !answerReviewRequest && text.includes('semantic_query');
  const reviewerRequest = request.tools.some(t => t.name === 'read_source');
  const userText = request.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
  const semanticCoordinator = !queryRequest && !reviewerRequest && who === 'coordinator' && userText.includes('REPORT_A_CURRENT') && userText.includes('REPORT_B_CURRENT') && !text.includes('architecture_review');
  if (queryRequest) queries.push(structuredClone(request));
  const common = { schemaVersion: 1 as const, requestId: request.requestId };
  appendFileSync(config.counter, JSON.stringify({ pid: process.pid, who, request }) + '\n', { flush: true });
  if (bound && (answerReviewRequest || queryRequest || request.tools.some(t => ['edit', 'read_source'].includes(t.name)) || semanticCoordinator)) {
    const branch = answerReviewRequest ? 'query-answer-review' : queryRequest ? 'query' : semanticCoordinator ? 'coordinator-report' : request.tools.some(t => t.name === 'read_source') ? 'reviewer' : 'coding';
    observations.model ??= { configuration: bound.configuration, boundary: 'Real Coding, independent Reviewer, Query and report-producing coordinator after actual wait-all Delivery. Planning, report-request mechanics, reader reports and decision acknowledgments are deterministic controls. Model quality requires separate rubric assessment.' };
    save();
    for await (const event of bound.client.stream(request, options)) {
      appendFileSync(config.counter + '.events', JSON.stringify({ pid: process.pid, branch, event: /reasoning|thinking/.test(event.type) ? { type: event.type, requestId: event.requestId, sequence: event.sequence } : event }) + '\n', { flush: true });
      yield event;
    }
    return;
  }
  const call = function* (name: string, args: any) {
    assert(request.tools.some(t => t.name === name), `Tool unavailable: ${who}/${name}`);
    const callId = request.requestId + '-' + name;
    yield { ...common, sequence: 1, type: 'tool_call_started' as const, callId, name, ordinal: 0 };
    yield { ...common, sequence: 2, type: 'tool_arguments_delta' as const, callId, delta: JSON.stringify(args) };
    yield { ...common, sequence: 3, type: 'completed' as const, reason: 'tool_calls' as const };
  };
  let answer = 'Read-only report; implementation and independent verification remain outstanding.';
  if (answerReviewRequest) {
    const reviewed = JSON.parse(request.messages.find(m => m.role === 'user')!.content);
    answer = JSON.stringify({ blocks: reviewed.blocks.map((entry: any) => ({ index: entry.index, verdict: 'supported', claims: [], outsideScope: true })) });
  } else if (text.includes('Return one JSON object with kind')) answer = JSON.stringify(plan);
  else if (request.tools.some(t => t.name === 'read_source')) {
    const step = deterministicReview(request); if (step.call) { yield* call(step.call.name, step.call.arguments); return; } answer = JSON.stringify(step.answer);
  } else if (request.tools.some(t => t.name === 'edit')) {
    assert(text.includes('CC_CODING'));
    const source = values.find(v => v.path === 'src/utils/grouping.mjs' && v.revision);
    if (!values.some(v => v.path === 'RULES.md')) { yield* call('read', { path: 'RULES.md' }); return; }
    if (!source) { yield* call('read', { path: 'src/utils/grouping.mjs' }); return; }
    if (!request.messages.some(m => m.role === 'tool' && m.result.effects.sideEffect === 'confirmed')) { yield* call('edit', { mode: 'replace', path: 'src/utils/grouping.mjs', expectedRevision: source.revision, oldText: 'out.far.push(t)\n      continue', newText: 'out.today.push(t)\n      continue' }); return; }
    answer = 'Repaired the isolated current no-deadline branch. Independent investigation and verification remain outstanding.';
  } else if (text.includes('semantic_query')) {
    answer = text.includes('ONE_REPLY_EXCEPTION') ? 'One detailed exception.' : text.includes('ARCHITECTURE_DETAIL') ? 'Detailed architecture: purpose, boundary, alternatives and impact.' : 'Brief: progress, blockers and next step.';
    if (text.includes('PROJECT_PROTOCOL')) answer += ' Name affected consumers before handoff.';
    const blocks: any[] = [];
    if (!text.includes('ONE_REPLY_EXCEPTION')) {
      const captured = objects(request.messages.filter(m => m.role === 'user')).find(v => v.kind === 'semantic_query' && v.material);
      assert(captured, 'Deterministic Query must consume the actual captured material');
      const goal = captured.material.goalPhase;
      const pointer = goal?.phase ? '/material/goalPhase' : '/material/humanActions';
      const assertion = goal?.phase ? { kind: 'goal_phase', expected: goal.phase } : { kind: 'observation_status', expected: captured.material.humanActions.status };
      const cited = values.find(v => v.pointer === pointer && v.marker);
      if (!cited) { yield* call('read_query_fact', { pointer, assertion }); return; }
      blocks.push({ kind: 'fact', citation: cited.marker });
    }
    blocks.push({ kind: 'explanation', text: answer, basis: [] });
    answer = JSON.stringify({ schemaVersion: 1, language: 'en', blocks });
  } else if (text.includes('architecture_review')) {
    assert(!request.tools.some(t => ['edit', 'shell'].includes(t.name)));
    const decision = objects(request.messages.filter(m => m.role === 'user')).find(v => v.kind === 'architecture_review' && v.proposalDigest && v.status);
    assert(decision, 'A decision acknowledgment must consume the actual structured decision, not a fixture-side outcome');
    for (const path of ['RULES.md', 'src/utils/grouping.mjs', 'check.mjs']) {
      if (!values.some(v => v.path === path && v.revision)) { yield* call('read', { path }); return; }
    }
    const sources = ['RULES.md', 'src/utils/grouping.mjs', 'check.mjs'].map(path => ({ path, revision: values.find(v => v.path === path && v.revision).revision }));
    const runId = objects(request.messages.filter(m => m.role === 'user')).find(v => v.scope?.taskId === who && v.scope?.runId)?.scope.runId;
    assert(runId, 'Final report must retain its actual current Run binding');
    observations.decisionReports ??= []; observations.decisionReports.push({ pid: process.pid, who, runId, requestId: request.requestId, sources, proposalDigest: decision.proposalDigest, revision: decision.revision, status: decision.status }); save();
    answer = `Current read-only investigation for ${who}: I reread ${JSON.stringify(sources)} in this Run. The no-deadline branch places the original todo object in today and preserves caller identity; the proposed far classification conflicts with RULES.md. The actual source consumer in this workspace is check.mjs: it imports groupTodos and asserts that no-deadline input remains the identical object in today, with far empty. A far-policy change would require updating this consumer contract and independent checks; shared/date.mjs behavior must remain protected. I received human decision ${decision.status} at revision ${decision.revision}, proposal ${decision.proposalDigest}: ${decision.summary}. This records the proposal decision only. Existing today behavior and baseline remain in force; no implementation change, new write permission, completed migration or independent verification is claimed. reader-a and reader-b are affected collaboration Works receiving this decision, not source-code consumers; no outside application consumer has been established by these workspace reads.`;
  } else if (who) {
    const refused = values.find(v => typeof v.operation === 'string' && v.accepted === false);
    assert(!refused, `Deterministic coordination cannot retry a refused operation: ${JSON.stringify(refused)}`);
    if (who !== 'coordinator' && !readers.has(who)) {
      if (who === 'reader-a') releaseFirstReader();
      readers.add(who); if (readers.size === 2) releaseReaders();
      await waitForReaderOverlap(overlap, options.signal);
    }
    if (!values.some(v => v.path === 'RULES.md' && v.revision)) { yield* call('read', { path: 'RULES.md' }); return; }
    if (!values.some(v => v.path === 'src/utils/grouping.mjs' && v.revision)) { yield* call('read', { path: 'src/utils/grouping.mjs' }); return; }
    if (!values.some(v => v.path === 'check.mjs' && v.revision)) { yield* call('read', { path: 'check.mjs' }); return; }
    if (who !== 'coordinator') {
      observations.reads ??= {};
      observations.reads[who] = ['RULES.md', 'src/utils/grouping.mjs', 'check.mjs'].map(path => ({ path, revision: values.find(v => v.path === path && v.revision).revision }));
      save();
    }
    if (who === 'reader-a' && !heldExperience) {
      heldExperience = true;
      yield { ...common, sequence: 1, type: 'text_delta', delta: 'Public report: RULES.md and the repaired grouping branch require no-deadline todos today. A proposed change to far conflicts with this current contract; record affected consumers before interface handoff.' };
      experienceObserved = true; await experienceRelease;
      await Promise.race([requestsReady, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('Coordinator could not register requests while readers were running')), config.realModel ? 240000 : 25000); timer.unref(); })]);
      yield { ...common, sequence: 2, type: 'tool_call_started', callId: 'after-report-mailbox', name: 'coordination_mailbox', ordinal: 0 };
      yield { ...common, sequence: 3, type: 'tool_arguments_delta', callId: 'after-report-mailbox', delta: '{}' };
      yield { ...common, sequence: 4, type: 'completed', reason: 'tool_calls' }; return;
    }
    if (who === 'coordinator') {
      const user = request.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      if (user.includes('REPORT_A_CURRENT') && user.includes('REPORT_B_CURRENT')) {
        if (!values.some(v => v.operation === 'architecture_report' && v.accepted)) {
          yield* call('report_architecture_conflict', { key: 'todo-date-contract', description: 'RULES.md and repaired grouping.mjs classify no-deadline todos as today. A proposed interface policy would instead classify them as far, conflicting with the current contract shared by grouping and date consumers; decide before implementing that proposal. The coordinator report also depends on the resolution.', proposedDescription: 'Consider changing the documented no-deadline classification to far. No baseline activation or implementation permission is implied.', affectedWorkIds: names.map(id => workIdFor(scope, id)), affectedRefs: { moduleRefs: ['grouping', 'date'], interfaceRefs: ['groupTodos'], pathRefs: ['src/utils/grouping.mjs', 'shared/date.mjs', 'RULES.md'] } }); return;
        }
        answer = 'Investigation at the time of reporting: both delivered REPORT_A_CURRENT and REPORT_B_CURRENT agree that the current RULES.md and src/utils/grouping.mjs put no-deadline todos in today, preserve caller identity and require shared/date.mjs behavior to remain unchanged. The proposed far classification conflicts with that rule. I read both current source files and formally reported the proposal with both reader-a and reader-b as affected collaboration Works. The human decision is pending at this report frontier; no baseline activation, implementation or verification is claimed.';
      } else {
        if (!values.some(v => v.operation === 'subscribe' && v.accepted)) { yield* call('coordination_subscribe', { topics: ['DirectedRequestResponded'], key: 'both-investigations' }); return; }
        const secondStage = user.includes('REPORT_A_CURRENT');
        if (secondStage && !values.some(v => Array.isArray(v.requests))) { yield* call('coordination_mailbox', {}); return; }
        const history = values.flatMap(v => v.requests ?? []).filter(v => v.fromWorkId === workIdFor(scope, 'coordinator'));
        if (secondStage) assert(history.some(v => v.toWorkId === workIdFor(scope, 'reader-a') && v.status === 'responded'), 'Second coordinator must read the actual prior answered request from its mailbox');
        const ids = [...new Set([...history.map(v => v.requestId), ...values.filter(v => v.operation === 'request' && v.accepted).flatMap(v => v.references ?? []).filter(v => v.kind === 'DirectedRequest').map(v => v.id)])];
        const count = secondStage ? 2 : 1;
        if (ids.length < count) {
          await firstReaderEntered;
          if (secondStage) assert(readers.has('reader-b'), 'B must have actually entered before addressing its Work');
          yield* call('coordination_request', { toWorkId: workIdFor(scope, secondStage ? 'reader-b' : 'reader-a'), statement: 'Report the exact shared todo source and contract.', body: 'Return the actual read-only todo investigation through coordination_respond.', key: secondStage ? 'reader-b' : 'reader-a' }); return;
        }
        if (!values.some(v => v.operation === 'wait' && v.accepted)) { yield* call('coordination_wait', { mode: 'all', requestIds: ids, key: secondStage ? 'all-readers' : 'first-reader' }); return; }
        if (secondStage) releaseSecondRequest(); else releaseRequests();
      }
    } else {
      await Promise.race([who === 'reader-a' ? requestsReady : secondRequestReady, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('Reader could not observe current directed request')), config.realModel ? 240000 : 25000); timer.unref(); })]);
      if (!values.some(v => v.requests)) { yield* call('coordination_mailbox', {}); return; }
      const incoming = values.flatMap(v => v.requests ?? []).find(v => v.toWorkId === workIdFor(scope, who));
      if (incoming && !values.some(v => v.operation === 'respond' && v.accepted)) { yield* call('coordination_respond', { requestId: incoming.requestId, body: who === 'reader-a' ? 'REPORT_A_CURRENT: The shared RULES.md and repaired grouping code place no-deadline todos today. The far-policy proposal conflicts with that contract.' : 'REPORT_B_CURRENT: The same rules and grouping source must retain caller identity and date.mjs behavior. A far-policy proposal needs an explicit decision.', key: 'exact-report' }); return; }
    }
  } else throw Error('Unrecognized real kernel request: ' + text.slice(0, 1000));
  yield { ...common, sequence: 1, type: 'text_delta', delta: answer };
  yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
} };
const app = await createGuiServer(config.data, { ...(config.queryAnswerReviewPolicy ? { queryAnswerReviewPolicy: config.queryAnswerReviewPolicy } : {}), workspaceRoots: { 'acceptance-alpha': config.root }, modelSettings: { directory: config.settings, registry: { list: () => registry.list(), get: id => registry.get(id), create: () => client } } });
await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + (app.server.address() as any).port;
const token = (await (await fetch(base + '/api/meta')).json() as any).workspaceToken;
if (config.browser && config.phase === 'recover') browserSession = await openCollaborationBrowser(base, scope, join(config.output, 'browser-' + config.phase));
const transport = createCollaborationHttpClient(base, token, (kind, observation) => {
  const key = kind === 'retry' ? 'transportRetries' : 'transportFailures';
  observations[key] ??= [];
  observations[key].push({ pid: process.pid, ...observation }); save();
});
const post = transport.post;
const state = () => transport.state(scope);
async function until(read: () => Promise<any>, check: (v: any) => boolean, pollMs = 25, observationMs = config.realModel ? 240000 : 60000) {
  const end = Date.now() + observationMs;
  for (;;) {
    const v = await read();
    if (check(v)) return v;
    if (Date.now() > end) {
      // Persist the triggering failure before a potentially expensive state
      // diagnostic; the parent may kill this process while that read waits.
      observations.timeout = { last: v, detectedAt: new Date().toISOString() }; save();
      throw Error('Scenario wait failed; see persistent observations: ' + config.observations);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
async function query(purpose: string, requestId: string, question = '请根据当前事实说明这项工作的进展、已决定和待处理事项。', target = scope, focusTaskId: string | null = 'reader-a') {
  const before = queries.length;
  await post('/api/real/queries', { ...target, ...(focusTaskId ? { focusTaskId } : {}), requestId, responsePurpose: purpose, question, ...(bound ? { budget: { contextWindowTokens: 1_000_000, perResponseTokens: 131072 } } : {}) });
  const view = await until(() => post('/api/real/queries/runs', target), v => {
    const observed = v.runs.find((r: any) => r.runRef.runId === 'real-query-' + requestId);
    assert.notEqual(observed?.status, 'failed', 'Query Runtime rejected the answer: ' + JSON.stringify(observed?.result));
    return observed?.status === 'completed';
  });
  if (bound) assert(queries.length > before); else assert.equal(queries.length, before + (question.includes('ONE_REPLY_EXCEPTION') ? 1 : 2));
  const run = view.runs.find((r: any) => r.runRef.runId === 'real-query-' + requestId);
  const input = JSON.stringify(queries.slice(before).flatMap(r => r.messages)), compiled = JSON.parse(run.input);
  assert.equal(run.result.outcome, 'answered');
  // Runtime output is not the Control/Ledger Answer. Observe the same public
  // state consumed by the UI, without a tight full-state polling loop.
  const formalState = await until(() => transport.state(target), value => {
    const job = value.queries?.find((q: any) => q.status === 'ready' && q.job.queryJobId === run.runRef.queryJobId);
    assert.notEqual(job?.job.status, 'closed', 'Query closed without a formal Answer: ' + JSON.stringify(job?.job.closeReason));
    return job?.job.status === 'answered' && !!job.currentAnswer;
  }, 2000);
  const formal = formalState.queries.find((q: any) => q.status === 'ready' && q.job.queryJobId === run.runRef.queryJobId);
  assert.deepEqual(formal.currentAnswer.runRef, run.runRef);
  assert.equal(formal.run.status, 'answered');
  assert.equal(formal.currentAnswer.answer, run.result.answer);
  const completed = { requestId, pid: process.pid, run, formalAnswer: formal.currentAnswer, formalSourceCursor: formal.sourceCursor, request: queries.at(-1) };
  const requestIds = new Set(run.trace.filter((event: any) => event.type === 'model.request_started').map((event: any) => event.data.requestId));
  const actualRequests = queries.slice(before).filter(request => requestIds.has(request.requestId));
  assert.equal(actualRequests.length, requestIds.size, 'Every observed model request must be archived for this exact Run');
  assert(/^[a-z0-9-]+$/.test(requestId));
  // Archive all actual requests and the formal Answer immediately. /tmp and
  // a parent's finally block do not survive a host/WSL restart.
  writeFileSync(join(stageDirectory, `${config.phase}-${requestId}.json`), JSON.stringify({ ...completed, requests: actualRequests }), { flush: true, flag: 'wx' });
  observations.stages.push(completed); save(); audit('formal-answer:' + requestId);
  return { input, compiled, run };
}
async function projectB() {
  const root = join(config.root, '../project-b'); mkdirSync(root, { recursive: true }); writeFileSync(join(root, 'README.md'), 'Isolated second project; no imported execution rights or completion.');
  const added = await post('/api/projects/add', { path: root });
  const other = { projectId: added.projectId, workspaceId: added.workspaceId, goalId: 'portable-preference' };
  await post('/api/goals', { ...other, requestId: other.goalId, objective: 'Check portable user preference with explicit selected project-memory inheritance.' });
  const next = (purpose: string, id: string) => query(purpose, id, 'Explain currently applicable guidance for this project.', other, null);
  const portable = await next('architecture', 'b-isolated'); assert(portable.input.includes('ARCHITECTURE_DETAIL')); assert(!portable.input.includes('PROJECT_PROTOCOL'));
  const source = (await post('/api/real/memory/project/view', scope)).snapshot.entries.find((e: any) => e.entryId === 'note-running-experience'); assert(source);
  const copy = { ...other, requestId: 'copy-current-experience', expectedRevision: 0, sourceProjectId: scope.projectId, sourceEntryId: source.entryId, sourceRevision: source.revision };
  await post('/api/real/memory/project/copy', copy, 400);
  await post('/api/real/memory/project/copy', { ...copy, allowCopy: true, sourceRevision: source.revision + 1 }, 400);
  assert.equal((await post('/api/real/memory/project/copy', { ...copy, allowCopy: true })).status, 'committed');
  const inherited = await next('progress', 'b-explicit-copy'); assert(inherited.input.includes('PROJECT_PROTOCOL'));
  assert(inherited.compiled.maintainedPreferences.entries.some((e: any) => e.entry.source.kind === 'copy' && e.entry.source.revision === source.revision && e.entry.source.digest === source.digest));
  const facts = await (await fetch(base + '/api/state?' + new URLSearchParams(other))).json() as any;
  assert.equal(facts.liveRuns.length, 0); assert.equal(facts.evidence.length, 0); assert.equal(facts.goals.find((g: any) => g.goal?.goalId === other.goalId).goal.activePlanRevision, null);
  assert(queries.at(-1).tools.every((t: any) => !['edit', 'shell'].includes(t.name)));
  assert.equal((await post('/api/real/memory/project/maintain', { ...scope, requestId: 'retire-experience', expectedRevision: 1, edits: [{ operation: 'remove', entryId: source.entryId, expectedEntryRevision: source.revision }] })).status, 'committed');
  const retired = await next('progress', 'b-retired-copy'); assert(!retired.input.includes('PROJECT_PROTOCOL'));
  assert(retired.compiled.maintainedPreferences.excluded.some((e: any) => e.reason === 'source_changed_or_retired'));
  observations.projectB = { scope: other, root, copiedSource: source, profile: await post('/api/real/memory/profile/view', {}) }; save();
}
try {
  if (config.phase === 'reinitialize') {
    const other = { ...observations.projectB.scope, goalId: 'after-project-reinitialize' };
    assert.deepEqual(await post('/api/real/memory/profile/view', {}), observations.projectB.profile);
    assert.equal((await post('/api/real/memory/project/view', other)).snapshot.entries.length, 0);
    await post('/api/goals', { ...other, requestId: other.goalId, objective: 'Use preserved user preferences after this isolated project store is reinitialized.' });
    const next = await query('progress', 'b-reinitialized', 'Give current progress guidance.', other, null);
    assert(next.input.includes('PROGRESS_BRIEF')); assert(!next.input.includes('PROJECT_PROTOCOL'));
    assert.equal(next.compiled.maintainedPreferences.profileRevision, afterProfileRevision + 1); assert.equal(next.compiled.maintainedPreferences.projectRevision, 0);
    process.stdout.write(JSON.stringify({ pid: process.pid, profileRevision: afterProfileRevision + 1, projectRevision: 0 }));
  } else if (config.phase === 'initial') {
    await post('/api/model-settings', { provider: 'deepseek', model: bound?.configuration.model ?? 'labelled-coding-collaboration-protocol', baseUrl: bound?.configuration.baseUrl ?? 'http://127.0.0.1', ...(bound?.configuration.reasoningEffort ? { reasoningEffort: bound.configuration.reasoningEffort } : {}), apiKey: 'LOCAL_TEST_KEY' });
    await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Repair actual isolated todo grouping under current rules, investigate the interface proposal together and preserve human decisions and memory.' });
    if (config.browser) browserSession = await openCollaborationBrowser(base, scope, join(config.output, 'browser-initial'));
    const catalog: Record<string, any> = {};
    for (const roleId of ['planner', 'document-advisor', 'executor', 'independent-reviewer']) {
      const content = roleSpecSourceFor(roleId === 'document-advisor' ? 'investigator' : roleId).content;
      const builtIn = roleId === 'executor' || roleId === 'independent-reviewer';
      assert.equal((await post('/api/real/governance/install', { ...scope, kind: 'RoleSpecRevision', source: { roleId, revision: builtIn ? 1 : 3, content: builtIn ? content : { ...content, label: roleId } } })).status, 'committed');
      const v = await post('/api/real/governance/view', scope); catalog[roleId] = v.kinds.find((k: any) => k.kind === 'RoleSpecRevision').roleSpecs.find((r: any) => r.roleId === roleId).pin;
      assert.equal((await post('/api/real/governance/activate', { ...scope, kind: 'RoleSpecRevision', pin: catalog[roleId] })).status, 'committed');
    }
    assert.equal((await post('/api/real/governance/install', { ...scope, kind: 'CoordinationPolicy', source: { policyId: 'coding-collaboration-policy', content: { ...buildCoordinationPolicyContentWithoutRolesV1(), roles: { catalog, coordinator: { roleId: 'planner', note: 'Coordinate actual todo investigation and coding' } } } } })).status, 'committed');
    const governance = await post('/api/real/governance/view', scope), policy = governance.kinds.find((k: any) => k.kind === 'CoordinationPolicy').installed.find((p: any) => p.ref.policyId === 'coding-collaboration-policy');
    observations.baselineBefore = governance.kinds.find((k: any) => k.kind === 'ArchitectureBaseline').active;
    assert.equal((await post('/api/real/governance/activate', { ...scope, kind: 'CoordinationPolicy', pin: { ref: policy.ref, digest: policy.contentDigest } })).status, 'committed');
    await post('/api/real/work', { ...scope, requestId: 'one-coding-lineage', instruction: 'Repair the isolated no-deadline regression under current RULES, then investigate the repaired actual todo contract in parallel, collect both reports, and surface the proposed incompatible no-deadline policy without activating it.', allowWrite: true, ...(bound ? { budget: { contextWindowTokens: 1_000_000, perResponseTokens: 131072 } } : {}) });
    const coded = await until(state, v => v.liveRuns.some((r: any) => r.spec.taskId === 'coding' && r.status === 'completed' && r.canonicalStatus === 'ended'));
    observations.verification = {};
    await verifyCodingProducer({ post, state, scope, taskId: 'coding', run: coded.liveRuns.find((r: any) => r.spec.taskId === 'coding'), evidence: observations.verification, ...realReviewObservation }); save();
    await until(state, v => {
      const failed = v.liveRuns.filter((r: any) => names.includes(r.spec.taskId) && ['failed', 'outcome_unknown', 'cancelled', 'budget_exhausted'].includes(r.status));
      assert.equal(failed.length, 0, 'Investigation failed; inspect provider requests and runtime errors before attributing its boundary: ' + JSON.stringify(failed.map((r: any) => ({ taskId: r.spec.taskId, runId: r.spec.runId, status: r.status, error: r.error }))));
      return experienceObserved;
    });
    const running = (await state()).liveRuns.find((r: any) => r.spec.taskId === 'reader-a'); assert.equal(running.canonicalStatus, 'running');
    assert.equal((await post('/api/real/memory/project/record-experience', { ...scope, requestId: 'running-experience', expectedRevision: 0, runId: running.spec.runId, summary: 'PROJECT_PROTOCOL: Identify affected consumers before handing off a conflicting todo interface proposal.', reason: 'Current running Work has actually read the shared rules and repaired grouping implementation and published the proposed far-policy conflict with that current contract.' })).status, 'committed');
    releaseExperience();
    if (browserSession) observations.styleId = await browserSession.remember('ALL_BRIEF: 请用中文简洁回应，先给结论，再说明真实变化、阻塞和需要我决定的事项。');
    else {
      assert.equal((await post('/api/real/memory/profile/maintain', { requestId: 'brief', expectedRevision: 0, edits: [{ operation: 'remember', entryId: 'style', content: 'ALL_BRIEF: 请用中文简洁回应，先给结论，再说明真实变化、阻塞和需要我决定的事项。' }] })).revision, 1);
      observations.styleId = 'style';
    }
    for (const purpose of ['reply', 'architecture', 'progress']) assert((await query(purpose, 'before-' + purpose)).input.includes('ALL_BRIEF'));
    const architectureStyle = 'ARCHITECTURE_DETAIL: 架构解释请用中文充分说明目的、职责边界、替代方案及对真实消费者的影响，区分已决定和仍未完成的事项。', progressStyle = 'PROGRESS_BRIEF: 进度请用中文简短说明变化、真实阻塞、需要我决定的事项和下一步，不把报告或人的决定当作验证完成。', replyStyle = 'REPLY_BRIEF: 日常接话请用中文简短自然地回应用户，不展开不相关的架构细节。';
    if (browserSession) afterProfileRevision = await browserSession.correct(architectureStyle, progressStyle, replyStyle);
    else {
      const correction = await post('/api/real/memory/profile/maintain', { requestId: 'correct', expectedRevision: 1, edits: [{ operation: 'correct', entryId: observations.styleId, expectedEntryRevision: 1, content: architectureStyle, conditions: { purposes: ['architecture'], expiresAt: null } }, { operation: 'remember', entryId: 'progress', content: progressStyle, conditions: { purposes: ['progress'], expiresAt: null } }, { operation: 'remember', entryId: 'reply', content: replyStyle, conditions: { purposes: ['reply'], expiresAt: null } }] });
      assert.equal(correction.revision, 2); afterProfileRevision = correction.revision;
    }
    observations.afterProfileRevision = afterProfileRevision; save();
    const pending = await until(() => post('/api/real/architecture-reviews/view', scope), v => v.rows.length === 1, 25, config.architectureObservationMs);
    assert.deepEqual(observations.reads['reader-a'], observations.reads['reader-b'], 'Both actual readers must consume the same exact source revisions');
    const initialRuns = (await state()).liveRuns;
    const a = initialRuns.find((r: any) => r.spec.taskId === 'reader-a').coordinationCapability, b = initialRuns.find((r: any) => r.spec.taskId === 'reader-b').coordinationCapability;
    assert.notEqual(a.agentInstanceId, b.agentInstanceId); assert.equal(a.roleBinding.templateId, b.roleBinding.templateId); assert.equal(a.roleBinding.templateRevision, b.roleBinding.templateRevision);
    const row = pending.rows[0];
    const resumedWorks = row.targets.filter((t: any) => t.mode === 'resume').map((t: any) => t.workId);
    assert.equal(new Set(resumedWorks).size, resumedWorks.length, 'No duplicate affected Work');
    for (const reader of ['reader-a', 'reader-b']) assert(resumedWorks.includes(workIdFor(scope, reader)), 'Both actual source investigators must receive the decision');
    assert(resumedWorks.every((id: string) => names.some(name => workIdFor(scope, name) === id)), 'This investigation may also resume its coordinator, but must not invent an affected Work');
    await until(state, v => v.liveRuns.filter((r: any) => names.includes(r.spec.taskId)).every((r: any) => r.status === 'completed' && r.canonicalStatus === 'ended'));
    const joined = await state(), joins = joined.communication.waits.filter((w: any) => w.workId === workIdFor(scope, 'coordinator'));
    assert.equal(joins.length, 2); assert.deepEqual(joins.map((j: any) => j.total).sort(), [1, 2]);
    for (const join of joins) { assert.equal(join.mode, 'all'); assert.equal(join.matched, join.total); assert.equal(join.status, 'satisfied'); }
    for (const join of joins) {
      const admissions = observations.waitAdmissions.filter((a: any) => a.receipt.waitRef.waitId === join.waitId);
      assert(admissions.length > 0); assert.equal(new Set(admissions.map((a: any) => a.receipt.runRef.runId)).size, 1, 'Each formal wait generation admits exactly one successor');
      const runId = admissions[0].receipt.runRef.runId;
      assert.equal(joined.liveRuns.filter((r: any) => r.spec.runId === runId && r.status === 'completed' && r.canonicalStatus === 'ended').length, 1);
    }
    assert.equal(joined.liveRuns.filter((r: any) => r.spec.taskId === 'coordinator' && r.coordinationCapability).length, 3, 'One original coordinator and one successor per wait generation, not a duplicate start per report');
    observations.before = await state(); observations.pending = row; save();
    let input = { ...scope, requestId: 'human-decision', reviewId: row.review.ref.reviewId, expectedRevision: row.review.revision, proposalDigest: row.review.proposalDigest, outcome: config.outcome, summary: 'Record the proposal decision; existing baseline, write permission and verification still govern implementation.', description: 'Modify the proposal to clarify that no-deadline policy changes require a separate future baseline migration; preserve today in the present accepted contract.' };
    if (config.outcome === 'modify') {
      if (browserSession) assert.equal((await browserSession.decision(input, row, submitted => { input = submitted; })).status, 'committed');
      else assert.equal((await post('/api/real/architecture-reviews/decide', input)).status, 'committed');
      const amended = (await post('/api/real/architecture-reviews/view', scope)).rows[0];
      assert.equal(amended.review.status, 'pending'); assert.equal(amended.review.revision, row.review.revision + 1); assert.notEqual(amended.review.proposalDigest, row.review.proposalDigest);
      assert.equal((await post('/api/real/architecture-reviews/decide', { ...input, requestId: 'stale-old-proposal', outcome: 'accept' })).status, 'rejected');
      observations.modified = amended; save();
      input = { ...input, requestId: 'accept-modified-proposal', expectedRevision: amended.review.revision, proposalDigest: amended.review.proposalDigest, outcome: 'accept' };
    }
    writeFileSync(config.input, JSON.stringify(input), { flush: true });
    if (browserSession) await browserSession.decision(input, config.outcome === 'modify' ? observations.modified : row, submitted => { writeFileSync(config.input, JSON.stringify(submitted), { flush: true }); });
    else await post('/api/real/architecture-reviews/decide', input);
    throw Error('Decision crash hook missed');
  } else {
    assert.notEqual(process.pid, observations.pid, 'Recovery and replay must run in a new OS process');
    const input = JSON.parse(readFileSync(config.input, 'utf8'));
    const replay = await post('/api/real/architecture-reviews/decide', input); assert.equal(replay.replayed, true);
    const view = await until(() => post('/api/real/architecture-reviews/view', scope), v => v.rows[0]?.allRequiredAttempted);
    assert.deepEqual((await post('/api/real/governance/view', scope)).kinds.find((k: any) => k.kind === 'ArchitectureBaseline').active, observations.baselineBefore, 'Human review does not silently activate the candidate baseline in any outcome branch');
    const ids = view.rows[0].targets.filter((t: any) => t.mode === 'resume').map((t: any) => t.runId);
    await until(state, v => ids.every((id: string) => v.liveRuns.some((r: any) => r.spec.runId === id && r.canonicalStatus === 'ended')));
    if (config.phase === 'recover') {
      if (browserSession) await browserSession.recovered(view.rows[0], observations.pid);
      const received = readFileSync(config.counter, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      for (const target of view.rows[0].targets.filter((t: any) => t.mode === 'resume')) {
        const actual = received.find((r: any) => createHash('sha256').update(JSON.stringify(r.request)).digest('hex') === target.requestDigest);
        assert(actual, 'Each affected Work must have its own exact actual model-request witness'); assert.equal(actual.pid, process.pid);
        const userInput = JSON.stringify(actual.request.messages.filter((m: any) => m.role === 'user'));
        assert(userInput.includes(view.rows[0].review.proposalDigest)); assert(userInput.includes(view.rows[0].review.status));
        assert(actual.request.tools.every((t: any) => !['edit', 'shell'].includes(t.name)));
        const report = observations.decisionReports.find((r: any) => r.runId === target.runId);
        assert(report, 'Each latest decision Run must reread sources and produce its own final report');
        assert.equal(report.pid, process.pid); assert.equal(report.status, view.rows[0].review.status); assert.equal(report.proposalDigest, view.rows[0].review.proposalDigest);
        assert.deepEqual(report.sources, observations.reads['reader-a'], 'Every decision recipient, including the coordinator when affected, must actually reread the unchanged shared source revisions');
      }
      let currentFacts: any;
      for (const purpose of ['reply', 'architecture', 'progress']) {
        const next = await query(purpose, 'after-' + purpose); assert.equal(next.compiled.maintainedPreferences.profileRevision, afterProfileRevision); assert(!next.input.includes('ALL_BRIEF')); assert.equal(next.input.includes('ARCHITECTURE_DETAIL'), purpose === 'architecture');
        assert.equal(next.input.includes('REPLY_BRIEF'), purpose === 'reply'); assert.equal(next.input.includes('PROGRESS_BRIEF'), purpose === 'progress');
        if (purpose === 'progress') assert(next.input.includes('PROJECT_PROTOCOL'));
        assert(!queries.at(-1).messages.some((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content === 'ALL_BRIEF: 请用中文简洁回应，先给结论，再说明真实变化、阻塞和需要我决定的事项。'));
        currentFacts = next.compiled.material.collaborationWork;
      }
      const current = await state(), runByTask: Record<string, any> = {};
      for (const taskId of workNames) {
        const selected = currentFacts.find((r: any) => r.taskId === taskId)?.latestRun;
        assert(selected?.matchesCurrentPlan && selected.status === 'ended' && selected.outcome === 'completed', 'Use the current TaskLease holder, not an old completed attempt');
        runByTask[taskId] = current.liveRuns.find((r: any) => r.spec.runId === selected.ref.runId); assert(runByTask[taskId]);
      }
      await verifyCodingLineage({ post, state, scope, runByTask, decisionRecipientRunIds: ids, evidence: observations.verification, ...realReviewObservation }); save();
      const final = await query('progress', 'final-goal-progress');
      assert.equal(final.compiled.material.goalPhase.phase, 'COMPLETED'); assert.equal(final.compiled.material.goalPhase.matchesCurrentPlan, true);
      assert.deepEqual(final.compiled.material.goalPhase.ref, { aggregateType: 'GoalPhase', projectId: scope.projectId, goalId: scope.goalId });
      assert.deepEqual(final.compiled.material.goalPhase.planRef, final.compiled.material.acceptedPlan.ref);
      assert.equal(final.compiled.material.goalPhase.revision, observations.verification.final.goalStatus.goal.aggregateRevision);
      assert.deepEqual(final.compiled.material.goalPhase.planRef, observations.verification.final.goalStatus.goal.planRef);
      if (!bound) { assert(final.run.result.answer.includes('phase: COMPLETED')); assert(final.run.result.presentation.blocks.some((b: any) => b.kind === 'fact')); }
      if (browserSession) await browserSession.adopted('final-goal-progress', final.run.inputDigest);
      if (browserSession) await browserSession.completed(observations.verification.final, observations.verification);
      const exception = await query('reply', 'temporary-exception', 'ONE_REPLY_EXCEPTION: Be detailed just this once without saving.'); if (!bound) assert.equal(exception.run.result.answer, 'Explanation：One detailed exception.');
      assert(!(await query('reply', 'exception-cleared')).input.includes('ONE_REPLY_EXCEPTION'));
      await projectB();
      assert.equal((await post('/api/real/memory/profile/maintain', { requestId: 'delete-style', expectedRevision: afterProfileRevision, edits: [{ operation: 'remove', entryId: observations.styleId, expectedEntryRevision: 2 }] })).revision, afterProfileRevision + 1);
      assert(!(await query('architecture', 'deleted-style')).input.includes('ARCHITECTURE_DETAIL'));
      observations.projectB.profile = await post('/api/real/memory/profile/view', {}); save();
    }
    process.stdout.write(JSON.stringify({ pid: process.pid, row: view.rows[0] }));
  }
} catch (error) { observations.error = String(error); save(); audit('diagnostic-state-start'); try { observations.state = await state(); } catch (stateError) { observations.stateReadError = String(stateError); } audit('diagnostic-state-end'); save(); throw error; }
finally { releaseReaders(); releaseExperience(); releaseRequests(); releaseSecondRequest(); releaseFirstReader(); audit('browser-close-start'); await browserSession?.close(); audit('browser-close-end'); audit('app-close-start'); await app.close(); audit('app-close-end'); }
