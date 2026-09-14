import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { roleSpecSourceFor, buildCoordinationPolicyContentWithoutRolesV1 } from '../../src/fixtures/role-spec-fixtures.js';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry, type ModelClientPort, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';

function proposal(name: string) {
  return { kind: 'plan', summary: 'Implement ' + name + ' and independently validate its contract.', assignments: [{ taskId: name, role: 'executor', instruction: 'Implement ' + name + ', produce its public results and validate the stated contract.' }], plan: {
    stages: [{ stageId: name + '-stage', title: name + ' implementation' }], tasks: [
      { taskId: name, stageId: name + '-stage', title: name + ' work', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: name + '-stage' } },
      { taskId: name + '-gate', title: name + ' independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    obligations: [{ obligationId: name + '-contract', title: name + ' contract', requirementLevel: 'required', taskIds: [name, name + '-gate'], verificationRequirements: [{ requirementId: name + '-behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Check ' + name + ' behavior independently' }] }],
    taskHierarchy: { parentOf: [{ parentTaskId: name + '-gate', childTaskId: name }] }, executionDag: { dependsOn: [{ taskId: name + '-gate', dependsOnId: name, requires: { kind: 'artifact', label: name + ' implementation' } }] } } };
}

it('drives initial readonly model proposals through Control and durable dispatch, keeps distinct plans and replays without another model call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'initial-planning-app-')), root = join(dir, 'source'), data = join(dir, 'data'); await mkdir(root); await mkdir(data); await writeFile(join(root, 'README.md'), 'Source for planning protocol acceptance with a labelled model stub.');
  const requests: ModelRequest[] = [], builtin = createBuiltinProviderRegistry();
  const client: ModelClientPort = { async *stream(request) {
    requests.push(structuredClone(request)); const common = { schemaVersion: 1 as const, requestId: request.requestId };
    const planning = JSON.stringify(request.messages).includes('Return one JSON object with kind');
    const name = JSON.stringify(request.messages).includes('documents') ? 'documents' : JSON.stringify(request.messages).includes('beta') ? 'beta' : 'alpha';
    yield { ...common, sequence: 1, type: 'text_delta', delta: planning ? JSON.stringify({ ...proposal(name), assignments: proposal(name).assignments.map(a => ({ ...a, role: name === 'documents' ? 'document-advisor' : a.role })) }) : name + ' public worker report; independent verification remains outstanding.' };
    yield { ...common, sequence: 2, type: 'usage_snapshot', usage: { inputTokens: 100, outputTokens: 70, cachedInputTokens: 0, costUsdMicros: null } };
    yield { ...common, sequence: 3, type: 'completed', reason: 'final_answer' };
  } };
  const options = { workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': root }, modelSettings: { directory: join(dir, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => client } } };
  let app = await createGuiServer(data, options), base = '', token = '';
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); const address = app.server.address(); if (!address || typeof address === 'string') throw Error('no port'); base = 'http://127.0.0.1:' + address.port; token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken; };
  const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as any }; };
  const state = async (scope: Record<string, string>) => (await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json()) as any;
  const until = async (scope: Record<string, string>) => { const deadline = Date.now() + 20000; for (;;) { const value = await state(scope); if (value.liveRuns?.[0]?.status === 'completed') return value; if (Date.now() > deadline) throw Error('timeout ' + JSON.stringify(await post('/api/real/planning', scope))); await new Promise(done => setTimeout(done, 25)); } };
  try {
    await listen(); await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-planning-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    for (const name of ['alpha', 'beta', 'documents']) {
      const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: name + '-goal' }, request = { ...scope, requestId: name + '-work', instruction: 'Implement the ' + name + ' contract from the source.', allowWrite: true };
      await post('/api/goals', { ...scope, requestId: scope.goalId, objective: request.instruction });
      if (name === 'documents') {
        const catalog: Record<string, any> = {};
        for (const roleId of ['planner', 'document-advisor']) {
          const content = roleSpecSourceFor(roleId === 'planner' ? 'planner' : 'investigator').content;
          const installed = await post('/api/real/governance/install', { ...scope, kind: 'RoleSpecRevision', source: { roleId, revision: 3, content: { ...content, label: roleId, purpose: roleId === 'planner' ? content.purpose : 'Review documents and report sourced conclusions' } } });
          expect(installed.body.status, JSON.stringify(installed.body)).toBe('committed');
          const view = await post('/api/real/governance/view', scope);
          catalog[roleId] = view.body.kinds.find((k: any) => k.kind === 'RoleSpecRevision').roleSpecs.find((r: any) => r.roleId === roleId).pin;
          expect((await post('/api/real/governance/activate', { ...scope, kind: 'RoleSpecRevision', pin: catalog[roleId] })).body.status).toBe('committed');
        }
        const content = { ...buildCoordinationPolicyContentWithoutRolesV1(), roles: { catalog, coordinator: { roleId: 'planner', note: 'Coordinate document work' } } };
        const installed = await post('/api/real/governance/install', { ...scope, kind: 'CoordinationPolicy', source: { policyId: 'documents-policy', content } });
        expect(installed.body.status, JSON.stringify(installed.body)).toBe('committed');
        const view = await post('/api/real/governance/view', scope);
        const policy = view.body.kinds.find((k: any) => k.kind === 'CoordinationPolicy').installed.find((v: any) => v.ref.policyId === 'documents-policy');
        expect((await post('/api/real/governance/activate', { ...scope, kind: 'CoordinationPolicy', pin: { ref: policy.ref, digest: policy.contentDigest } })).body.status).toBe('committed');
      }
      expect(await post('/api/real/work', { ...request, allowWrite: false })).toMatchObject({ status: 400 });
      expect(await post('/api/real/work', request)).toMatchObject({ status: 200, body: { status: 'planning', runId: 'real-' + name + '-work' } });
      const complete = await until(scope);
      expect(complete.graph.graph.tasks.map((task: any) => task.taskId)).toEqual([name, name + '-gate']);
      expect(complete.liveRuns[0].spec.instruction).toContain('Implement ' + name);
      if (name === 'documents') {
        expect(complete.liveRuns[0].context.manifest.permissions.tools).toEqual(['read']);
        expect(complete.liveRuns[0].context.manifest.permissions.writeScope).toEqual([]);
        const worker = requests.at(-1)!;
        expect(worker.tools.some(t => ['edit', 'write', 'bash', 'shell'].includes(t.name))).toBe(false);
        expect(JSON.stringify(worker.messages)).toContain('Review documents and report sourced conclusions');
        expect(JSON.stringify(worker.messages)).toContain('document-advisor');
        expect(JSON.stringify(requests.at(-2)!.messages)).toContain('agentTemplates');
      } else expect(complete.liveRuns[0].context.manifest.permissions.tools).toContain('write');
      expect(complete.matrix.matrix.rows.every((task: any) => task.livePhase !== 'satisfied')).toBe(true);
      const planning = await post('/api/real/planning', scope);
      expect(planning.body.rows[0]).toMatchObject({ status: 'plan_accepted', proposal: { status: 'plan', plan: { origin: { kind: 'model_coordination', summary: proposal(name).summary } } }, runs: [{ status: 'completed', kind: 'initial_coordination' }] });
      const count = requests.length; expect((await post('/api/real/work', request)).status).toBe(200); expect(requests).toHaveLength(count);
      expect((await post('/api/real/work', { ...request, instruction: 'Changed instruction' })).status).toBe(400);
    }
    const count = requests.length; await app.close(); app = await createGuiServer(data, options); await listen();
    const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'alpha-goal' };
    expect((await post('/api/real/planning', scope)).body.rows[0].status).toBe('plan_accepted'); expect(requests).toHaveLength(count);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
