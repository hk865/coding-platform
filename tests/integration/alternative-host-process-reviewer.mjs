import '../coordination/process-loader.mjs';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { roundReviewProposal, reviewerReply } from './alternative-host-process-reviewer-protocol.mjs';
const { createGuiServer } = await import('../../src/app/server.ts');
const { ReviewerDispatch } = await import('../../src/control/dispatch-engine/reviewer-dispatch.ts');
const { createBuiltinProviderRegistry } = await import('../../vendor/coding-agent/dist/public-api.js');
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'reviewer-process' };
function snapshots(type) {
  const db = new DatabaseSync(join(config.data, 'ledger.sqlite'), { readOnly: true });
  try { return db.prepare("SELECT snapshot_json FROM snapshots WHERE json_extract(snapshot_json, '$.ref.aggregateType') = ? ORDER BY ref_key").all(type).map(r => JSON.parse(r.snapshot_json)); } finally { db.close(); }
}
if (config.fault === 'after_work_commit') ReviewerDispatch.prototype.drive = async function (workRef) {
  const work = snapshots('ReviewWork').find(w => w.ref.reviewId === workRef.reviewId);
  assert.ok(work, 'ReviewWork must be committed before injected exit');
  writeFileSync(config.receipt, JSON.stringify({ pid: process.pid, work, run: snapshots('Run').find(r => r.ref.runId === work.reviewerRunRef.runId) }), { flush: true });
  process.exit(86);
};
const registry = createBuiltinProviderRegistry();
const client = { async *stream(request) {
  const review = request.tools.some(t => t.name === 'read_source');
  const writer = request.tools.some(t => ['edit', 'shell'].includes(t.name));
  appendFileSync(config.counter, JSON.stringify({ pid: process.pid, review, writer, tools: request.tools.map(t => t.name), requestId: request.requestId }) + '\n', { flush: true });
  if (review && config.fault === 'provider_effect') process.exit(86);
  const common = { schemaVersion: 1, requestId: request.requestId };
  const reply = review ? reviewerReply(request) : { content: request.tools.some(t => t.name === 'edit') ? 'Ready for independent verification.' : JSON.stringify(roundReviewProposal()) };
  if (reply.call) {
    yield { ...common, sequence: 1, type: 'tool_call_started', callId: reply.call.id, name: reply.call.name, ordinal: 0 };
    yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: reply.call.id, delta: JSON.stringify(reply.call.arguments) };
    yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
  } else {
    yield { ...common, sequence: 1, type: 'text_delta', delta: reply.content };
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  }
} };
const app = await createGuiServer(config.data, { workspaceRoots: { 'acceptance-alpha': config.root, 'acceptance-beta': config.root }, modelSettings: { directory: config.settings, registry: { list: () => registry.list(), get: id => registry.get(id), create: () => client } } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + app.server.address().port;
const token = (await (await fetch(base + '/api/meta')).json()).workspaceToken;
async function post(path, body) { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); const value = await r.json(); assert.equal(r.status, 200, path + ': ' + JSON.stringify(value)); return value; }
const state = async () => (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
async function until(read, check) { const end = Date.now() + 45000; for (;;) { const value = await read(); if (check(value)) return value; if (Date.now() > end) throw Error('Reviewer process timeout: ' + JSON.stringify({ value, state: await state() })); await new Promise(resolve => setTimeout(resolve, 25)); } }
try {
  if (config.fault) {
    await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-reviewer-process-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Verify the actual subject file and preserve independent Reviewer recovery.' });
    await post('/api/real/work', { ...scope, requestId: 'work', instruction: 'Inspect subject.txt; leave independent checking and semantic review to the platform.', allowWrite: true });
    const completed = await until(state, s => s.liveRuns.some(r => r.spec.taskId === 'coding-task' && r.status === 'completed' && r.canonicalStatus === 'ended'));
    const run = completed.liveRuns.find(r => r.spec.taskId === 'coding-task');
    const reviewScope = { ...scope, runId: run.spec.runId, taskId: 'coding-task' };
    const round = await post('/api/real/verifications/rounds/start', { ...reviewScope, requestId: 'review-tools', allowExecute: true, configuration: { checks: [{ checkId: 'subject-check', kind: 'dynamic', command: 'test "$(cat subject.txt)" = expected', cwd: '.', timeoutMs: 3000, appliesTo: { workspaceId: scope.workspaceId, taskIds: ['coding-task'] } }] } });
    const profile = await post('/api/real/verifications/reviews/profile', reviewScope); assert.equal(profile.status, 'ready', JSON.stringify(profile));
    const input = { ...reviewScope, requestId: 'independent', roundRequestId: 'review-tools', reviewerConfigRef: profile.ref, allowExecute: true };
    writeFileSync(config.input, JSON.stringify(input), { flush: true });
    await post('/api/real/verifications/reviews/start', input);
    await until(state, () => false);
  } else {
    const input = JSON.parse(readFileSync(config.input, 'utf8'));
    const view = await until(() => post('/api/real/verifications/reviews/read', input), v => v.work && (v.phase === 'settled' || snapshots('Run').some(r => r.ref.runId === v.work.reviewerRunRef.runId && r.outcome === 'outcome_unknown')));
    // Observe automatic restart completion before exercising the idempotent public retry.
    const replay = await post('/api/real/verifications/reviews/start', input);
    const run = (await state()).liveRuns.find(r => r.spec.runId === view.work.reviewerRunRef.runId);
    process.stdout.write(JSON.stringify({ pid: process.pid, view, replay, run: { status: run.status, mode: run.spec.mode, canonicalStatus: run.canonicalStatus, toolCompleted: run.trace.some(e => e.type === 'tool.completed') }, works: snapshots('ReviewWork'), results: snapshots('ReviewResult'), evidence: snapshots('Evidence') }) + '\n');
  }
} finally { await app.close(); }

