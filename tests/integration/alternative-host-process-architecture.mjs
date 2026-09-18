import '../coordination/process-loader.mjs';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { createGuiServer } = await import('../../src/app/server.ts');
const { ControlEngineImpl } = await import('../../src/control/control-engine/control-engine.ts');
const { roleSpecSourceFor, buildCoordinationPolicyContentWithoutRolesV1 } = await import('../../src/fixtures/role-spec-fixtures.ts');
const { workIdFor } = await import('../../src/contracts/task-work-identity.ts');
const { createBuiltinProviderRegistry } = await import('../../vendor/coding-agent/dist/public-api.js');
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'architecture-process' };
const names = ['reader-a', 'reader-b', 'coordinator'];
const plan = { kind: 'plan', summary: 'Inspect then request a human interface decision.', assignments: names.map(taskId => ({ taskId, role: 'document-advisor', instruction: 'PROCESS_' + taskId + ' read-only report; independent verification remains.' })), plan: { stages: [{ stageId: 'inspect', title: 'Inspect' }], tasks: [...names.map(taskId => ({ taskId, stageId: 'inspect', title: taskId, taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'inspect' } })), { taskId: 'gate', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }], obligations: [{ obligationId: 'contract', title: 'Contract', requirementLevel: 'required', taskIds: [...names, 'gate'], verificationRequirements: [{ requirementId: 'behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Verify contract independently' }] }], taskHierarchy: { parentOf: names.map(childTaskId => ({ parentTaskId: 'gate', childTaskId })) }, executionDag: { dependsOn: names.map(dependsOnId => ({ taskId: 'gate', dependsOnId, requires: { kind: 'artifact', label: 'report' } })) } } };
if (config.fault) {
  const record = ControlEngineImpl.prototype.recordArchitectureReview;
  ControlEngineImpl.prototype.recordArchitectureReview = async function (command) {
    const receipt = await record.call(this, command);
    if (command.action.kind === 'decide' && receipt.status === 'committed') {
      writeFileSync(config.receipt, JSON.stringify({ pid: process.pid, receipt }), { flush: true }); process.exit(86);
    }
    return receipt;
  };
}
let reported = false;
const registry = createBuiltinProviderRegistry();
const client = { async *stream(request) {
  const text = JSON.stringify(request.messages), returning = text.includes('architecture_review');
  appendFileSync(config.counter, JSON.stringify({ pid: process.pid, returning, requestId: request.requestId, writer: request.tools.some(t => ['edit', 'shell'].includes(t.name)) }) + '\n', { flush: true });
  const common = { schemaVersion: 1, requestId: request.requestId };
  if (text.includes('Return one JSON object with kind')) {
    yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify(plan) };
  } else if (!reported && text.includes('PROCESS_coordinator') && request.tools.some(t => t.name === 'report_architecture_conflict')) {
    reported = true;
    yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'report', name: 'report_architecture_conflict', ordinal: 0 };
    yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'report', delta: JSON.stringify({ key: 'id-type', description: 'Reader A expects string IDs; Reader B expects numbers.', proposedDescription: 'Use opaque strings.', affectedWorkIds: ['reader-a', 'reader-b'].map(id => workIdFor(scope, id)), affectedRefs: { moduleRefs: ['reader-a', 'reader-b'], interfaceRefs: ['Record.id'], pathRefs: [] } }) };
    yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' }; return;
  } else {
    yield { ...common, sequence: 1, type: 'text_delta', delta: 'Read-only report acknowledges the current formal decision; independent checking remains.' };
  }
  yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
} };
const app = await createGuiServer(config.data, { workspaceRoots: { 'acceptance-alpha': config.root, 'acceptance-beta': config.root }, modelSettings: { directory: config.settings, registry: { list: () => registry.list(), get: id => registry.get(id), create: () => client } } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + app.server.address().port;
const token = (await (await fetch(base + '/api/meta')).json()).workspaceToken;
async function post(path, body) { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); const value = await r.json(); assert.equal(r.status, 200, JSON.stringify(value)); return value; }
async function until(check) { const end = Date.now() + 45000; for (;;) { const value = await post('/api/real/architecture-reviews/view', scope); if (check(value)) return value; if (Date.now() > end) throw Error('Architecture process timeout: ' + JSON.stringify({ view: value, planning: await post('/api/real/planning', scope), state: await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json() })); await new Promise(resolve => setTimeout(resolve, 20)); } }
try {
  if (config.fault) {
    await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-architecture-process-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Decide a shared interface and preserve complete impact routing.' });
    const catalog = {};
    for (const roleId of ['planner', 'document-advisor']) {
      const content = roleSpecSourceFor(roleId === 'planner' ? 'planner' : 'investigator').content;
      assert.equal((await post('/api/real/governance/install', { ...scope, kind: 'RoleSpecRevision', source: { roleId, revision: 3, content: { ...content, label: roleId, purpose: 'Coordinate read-only documents' } } })).status, 'committed');
      const view = await post('/api/real/governance/view', scope);
      catalog[roleId] = view.kinds.find(k => k.kind === 'RoleSpecRevision').roleSpecs.find(r => r.roleId === roleId).pin;
      assert.equal((await post('/api/real/governance/activate', { ...scope, kind: 'RoleSpecRevision', pin: catalog[roleId] })).status, 'committed');
    }
    const content = { ...buildCoordinationPolicyContentWithoutRolesV1(), roles: { catalog, coordinator: { roleId: 'planner', note: 'Coordinate documents' } } };
    assert.equal((await post('/api/real/governance/install', { ...scope, kind: 'CoordinationPolicy', source: { policyId: 'documents-policy', content } })).status, 'committed');
    const view = await post('/api/real/governance/view', scope);
    const policy = view.kinds.find(k => k.kind === 'CoordinationPolicy').installed.find(v => v.ref.policyId === 'documents-policy');
    assert.equal((await post('/api/real/governance/activate', { ...scope, kind: 'CoordinationPolicy', pin: { ref: policy.ref, digest: policy.contentDigest } })).status, 'committed');
    await post('/api/real/work', { ...scope, requestId: 'work', instruction: 'Inspect readers and report the interface conflict.', allowWrite: true });
    const pending = await until(v => v.rows.length === 1);
    const row = pending.rows[0]; assert.equal(row.review.status, 'pending'); assert.equal(row.targets.filter(t => t.mode === 'resume').length, 2);
    const input = { ...scope, requestId: 'human-accept', reviewId: row.review.ref.reviewId, expectedRevision: row.review.revision, proposalDigest: row.review.proposalDigest, outcome: 'accept', summary: 'Use opaque string IDs.' };
    writeFileSync(config.input, JSON.stringify(input), { flush: true });
    await post('/api/real/architecture-reviews/decide', input);
    throw Error('Fault boundary was missed');
  } else {
    const input = JSON.parse(readFileSync(config.input, 'utf8'));
    const replay = await post('/api/real/architecture-reviews/decide', input);
    const view = await until(v => v.rows[0]?.allRequiredAttempted);
    const state = await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
    const targetIds = view.rows[0].targets.filter(t => t.mode === 'resume').map(t => t.runId);
    // allRequiredAttempted proves admission; also require actual kernel terminals.
    const end = Date.now() + 30000;
    for (;;) {
      const s = await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
      if (targetIds.every(id => s.liveRuns.some(r => r.spec.runId === id && r.canonicalStatus === 'ended'))) break;
      if (Date.now() > end) throw Error('Decision consumers did not end');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    process.stdout.write(JSON.stringify({ pid: process.pid, replay, row: view.rows[0] }) + '\n');
  }
} finally { await app.close(); }

