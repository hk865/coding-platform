import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, rename, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry, type ModelClientPort, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { buildCoordinationPolicyContentWithoutRolesV1 } from '../../src/fixtures/role-spec-fixtures.js';

it('V19/V21 actual public work experience reaches current Query input only with scope, copy and source authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'memory-reuse-'));
  const rootA = join(directory, 'source-a'), rootB = join(directory, 'source-b'), data = join(directory, 'data');
  await mkdir(rootA); await mkdir(rootB); await writeFile(join(rootA, 'RULES.md'), 'While the interface is unresolved, identify all affected consumers before handoff.');
  await writeFile(join(rootB, 'README.md'), 'Separate project with no inherited work or permissions.');
  const requests: ModelRequest[] = [], observations: Record<string, unknown> = {};
  let releaseReport!: () => void, enteredReport!: () => void;
  const reportEntered = new Promise<void>(resolve => { enteredReport = resolve; });
  const release = new Promise<void>(resolve => { releaseReport = resolve; });
  let publicReportHeld = false;
  const registry = createBuiltinProviderRegistry();
  const client: ModelClientPort = { async *stream(request) {
    requests.push(structuredClone(request));
    const common = { schemaVersion: 1 as const, requestId: request.requestId }, text = JSON.stringify(request.messages);
    if (text.includes('semantic_query')) {
      const selected = ['PORTABLE_PROFILE', 'EXPERIENCE_A', 'GOVERNED_EXPERIENCE'].filter(marker => text.includes(marker));
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'explanation', text: selected.length ? 'Applicable current guidance: ' + selected.join(', ') : 'No applicable saved project guidance.', basis: [] }] }) };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' }; return;
    }
    if (!request.messages.some(message => message.role === 'tool')) {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'read-rules', name: 'read', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'read-rules', delta: JSON.stringify({ path: 'RULES.md' }) };
      yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' }; return;
    }
    yield { ...common, sequence: 1, type: 'text_delta', delta: 'Public report: the actual RULES.md requires naming affected consumers before interface handoff. Verification remains outstanding.' };
    if (!publicReportHeld) { publicReportHeld = true; enteredReport(); await release; }
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  } };
  const options = { workspaceRoots: { 'acceptance-alpha': rootA, 'acceptance-beta': rootA }, modelSettings: { directory: join(directory, 'settings'), registry: { list: () => registry.list(), get: (id: string) => registry.get(id), create: () => client } } };
  let app = await createGuiServer(data, options), base = '', token = '';
  const a = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'experience-goal' };
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); const address = app.server.address(); if (!address || typeof address === 'string') throw Error('No port'); base = 'http://127.0.0.1:' + address.port; token = (await (await fetch(base + '/api/meta')).json() as { workspaceToken: string }).workspaceToken; };
  const post = async (path: string, body: unknown, status = 200): Promise<any> => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); const result = await response.json(); expect(response.status, path + ': ' + JSON.stringify(result)).toBe(status); return result; };
  const state = async (scope: typeof a): Promise<any> => (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
  const query = async (scope: typeof a, id: string, purpose: 'progress' | 'reply' = 'progress', focusTaskId?: string) => {
    const before = requests.length;
    await post('/api/real/queries', { ...scope, requestId: id, question: 'Organize the next progress report using currently applicable guidance.', responsePurpose: purpose, ...(focusTaskId ? { focusTaskId } : {}) });
    let run: any;
    await expect.poll(async () => { run = (await post('/api/real/queries/runs', scope)).runs.find((r: any) => r.runRef.runId === 'real-query-' + id); return run?.status; }, { timeout: 30000 }).toBe('completed');
    const actual = requests.slice(before); expect(actual).toHaveLength(1);
    expect(actual[0]!.tools.every(t => !['edit', 'shell'].includes(t.name))).toBe(true);
    const compiled = JSON.parse(run.input), input = JSON.stringify(actual[0]!.messages);
    observations[id] = { runRef: run.runRef, inputDigest: run.inputDigest, result: run.result, maintainedPreferences: compiled.maintainedPreferences };
    return { run, compiled, input };
  };
  try {
    await listen();
    await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-memory-reuse-protocol-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    const mountedB = await post('/api/projects/add', { path: rootB });
    const b = { projectId: mountedB.projectId, workspaceId: mountedB.workspaceId, goalId: 'isolated-goal' };
    await post('/api/goals', { ...a, requestId: a.goalId, objective: 'Inspect current rules and preserve conditional experience without satisfying verification.' });
    await post('/api/goals', { ...b, requestId: b.goalId, objective: 'Keep project isolation while applying permitted user guidance.' });
    expect(await post('/api/real/memory/profile/maintain', { requestId: 'profile', expectedRevision: 0, edits: [{ operation: 'remember', entryId: 'portable', content: 'PORTABLE_PROFILE: Briefly state current progress, blocker and next step.' }] })).toMatchObject({ status: 'committed', revision: 1 });
    const profile = await post('/api/real/memory/profile/view', {});
    await post('/api/real/tasks', { ...a, requestId: 'source-work', instruction: 'PUBLIC_WORK: Read RULES.md and report its handoff condition. Do not claim task completion.', allowWrite: true });
    await Promise.race([reportEntered, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('Real public report barrier not reached')), 30000); timer.unref(); })]);
    const working = (await state(a)).liveRuns.find((r: any) => r.spec.runId === 'real-source-work');
    expect(working).toMatchObject({ status: 'running', canonicalStatus: 'running' });
    expect(working.trace.some((e: any) => e.type === 'tool.completed')).toBe(true);
    const experience = { ...a, requestId: 'during-work', expectedRevision: 0, runId: 'real-source-work', summary: 'EXPERIENCE_A: Name every affected consumer before handing off an unresolved interface.', reason: 'The current public Run read RULES.md and reported this concrete coordination condition; this is guidance, not a verification result.' };
    expect(await post('/api/real/memory/project/record-experience', experience)).toMatchObject({ status: 'committed', revision: 1 });
    expect(await post('/api/real/memory/project/record-experience', experience)).toMatchObject({ status: 'committed', replayed: true });
    const sourceMemory = (await post('/api/real/memory/project/view', a)).snapshot;
    expect(sourceMemory.entries).toHaveLength(1);
    expect(sourceMemory.entries[0]).toMatchObject({ entryId: 'note-during-work', revision: 1, source: { kind: 'work_note', workspaceRevision: 1, memoryRevision: 1 }, conditions: { purposes: ['planning', 'progress', 'handoff', 'execution'] } });
    expect(sourceMemory.entries[0].source.governance).toHaveLength(4);
    releaseReport();
    await expect.poll(async () => (await state(a)).liveRuns.find((r: any) => r.spec.runId === 'real-source-work')?.canonicalStatus, { timeout: 30000 }).toBe('ended');
    const taskId = working.spec.taskId;
    const first = await query(a, 'source-progress', 'progress', taskId);
    expect(first.input).toContain('EXPERIENCE_A'); expect(first.run.result.answer).toContain('EXPERIENCE_A');
    expect(first.compiled.maintainedPreferences.entries.some((row: any) => row.entry.source.kind === 'work_note' && row.entry.source.noteDigest === sourceMemory.entries[0].source.noteDigest)).toBe(true);
    const offPurpose = await query(a, 'source-reply', 'reply', taskId);
    expect(offPurpose.compiled.maintainedPreferences.entries.some((row: any) => row.entry.entryId === 'note-during-work')).toBe(false);
    const isolated = await query(b, 'b-isolated'); expect(isolated.input).toContain('PORTABLE_PROFILE'); expect(isolated.input).not.toContain('EXPERIENCE_A');
    const copy = { ...b, requestId: 'copy-selected', expectedRevision: 0, sourceProjectId: a.projectId, sourceEntryId: 'note-during-work', sourceRevision: 1 };
    await post('/api/real/memory/project/copy', copy, 400);
    expect((await post('/api/real/memory/project/view', b)).snapshot.entries).toHaveLength(0);
    await post('/api/real/memory/project/copy', { ...copy, requestId: 'wrong-revision', sourceRevision: 2, allowCopy: true }, 400);
    expect(await post('/api/real/memory/project/copy', { ...copy, allowCopy: true })).toMatchObject({ status: 'committed', revision: 1 });
    const copied = (await post('/api/real/memory/project/view', b)).snapshot.entries[0];
    expect(copied.source).toMatchObject({ kind: 'copy', scope: { kind: 'project', projectId: a.projectId }, entryId: 'note-during-work', revision: 1, digest: sourceMemory.entries[0].digest });
    const adopted = await query(b, 'b-copied'); expect(adopted.input).toContain('EXPERIENCE_A'); expect(adopted.run.result.answer).toContain('EXPERIENCE_A');
    expect(adopted.compiled.maintainedPreferences.entries.some((row: any) => row.entry.entryId === 'copy-copy-selected' && row.entry.source.revision === 1)).toBe(true);
    const bFacts = await state(b); expect(bFacts.liveRuns).toHaveLength(0); expect(bFacts.evidence).toHaveLength(0);
    expect(bFacts.goals.find((g: any) => g.goal?.goalId === b.goalId).goal.activePlanRevision).toBeNull();
    expect(await post('/api/real/memory/project/maintain', { ...a, requestId: 'remove-source', expectedRevision: 1, edits: [{ operation: 'remove', entryId: 'note-during-work', expectedEntryRevision: 1 }] })).toMatchObject({ status: 'committed', revision: 2 });
    const retired = await query(b, 'b-source-retired'); expect(retired.input).not.toContain('EXPERIENCE_A'); expect(retired.run.result.answer).not.toContain('EXPERIENCE_A');
    expect(retired.compiled.maintainedPreferences.excluded).toContainEqual({ entryId: 'copy-copy-selected', reason: 'source_changed_or_retired' });
    expect(await post('/api/real/memory/project/copy', { ...copy, allowCopy: true })).toMatchObject({ status: 'committed', replayed: true });
    expect((await query(b, 'b-replay-still-retired')).input).not.toContain('EXPERIENCE_A');
    expect(await post('/api/real/memory/project/record-experience', { ...a, requestId: 'governed', expectedRevision: 2, runId: 'real-source-work', summary: 'GOVERNED_EXPERIENCE: Keep the current coordination convention while its formal policy remains active.', reason: 'This is a new explicit statement anchored to the existing actual public report and current governance.' })).toMatchObject({ status: 'committed', revision: 3 });
    expect((await query(a, 'before-policy-change', 'progress', taskId)).input).toContain('GOVERNED_EXPERIENCE');
    expect(await post('/api/real/governance/install', { ...a, kind: 'CoordinationPolicy', source: { policyId: 'updated-coordination', content: buildCoordinationPolicyContentWithoutRolesV1() } })).toMatchObject({ status: 'committed' });
    const policies = await post('/api/real/governance/view', a);
    const policy = policies.kinds.find((k: any) => k.kind === 'CoordinationPolicy').installed.find((p: any) => p.ref.policyId === 'updated-coordination');
    expect(await post('/api/real/governance/activate', { ...a, kind: 'CoordinationPolicy', pin: { ref: policy.ref, digest: policy.contentDigest } })).toMatchObject({ status: 'committed' });
    const invalidated = await query(a, 'after-policy-change', 'progress', taskId);
    expect(invalidated.compiled.maintainedPreferences.entries.some((row: any) => row.entry.entryId === 'note-governed')).toBe(false);
    expect(invalidated.compiled.maintainedPreferences.excluded).toContainEqual({ entryId: 'note-governed', reason: 'source_changed_or_retired' });
    expect(invalidated.input).not.toContain('GOVERNED_EXPERIENCE');
    await app.close();
    // Reinitialize only this temporary dynamic project's store. Archive it,
    // preserving profile and other projects; no public reset UI is claimed.
    const oldStore = await realpath(join(data, 'projects', encodeURIComponent(b.projectId))), isolation = await realpath(directory);
    const inside = relative(isolation, oldStore); expect(inside && !inside.startsWith('..') && !isAbsolute(inside)).toBeTruthy();
    await rename(oldStore, join(directory, 'archived-project-b'));
    app = await createGuiServer(data, options); await listen();
    expect(await post('/api/real/memory/profile/view', {})).toEqual(profile);
    expect((await post('/api/real/memory/project/view', b)).snapshot.entries).toHaveLength(0);
    const resetScope = { ...b, goalId: 'after-reinitialize' };
    await post('/api/goals', { ...resetScope, requestId: resetScope.goalId, objective: 'Read the preserved user profile after fresh project bootstrap.' });
    const resetInput = await query(resetScope, 'b-reinitialized');
    expect(resetInput.input).toContain('PORTABLE_PROFILE'); expect(resetInput.input).not.toContain('EXPERIENCE_A');
    expect(resetInput.compiled.maintainedPreferences.profileScope).toEqual(profile.snapshot.scope);
    expect(resetInput.compiled.maintainedPreferences.profileRevision).toBe(1);
    expect(resetInput.compiled.maintainedPreferences.projectRevision).toBe(0);
    observations['status'] = 'PASS';
  } catch (error) { observations['status'] = 'FAIL'; observations['error'] = String(error); throw error; }
  finally {
    releaseReport(); await app.close();
    const output = resolve('evidence/collaboration-memory/batch/integration/memory-reuse'); await mkdir(output, { recursive: true });
    await writeFile(join(output, 'scenario-' + Date.now() + '.json'), JSON.stringify(observations, null, 2));
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);

