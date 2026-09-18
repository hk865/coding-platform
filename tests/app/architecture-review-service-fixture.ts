import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect } from 'vitest';
import { roleSpecSourceFor, buildCoordinationPolicyContentWithoutRolesV1 } from '../../src/fixtures/role-spec-fixtures.js';
import { createGuiServer as sourceGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry, type ModelClientPort, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { workIdFor } from '../../src/contracts/task-work-identity.js';
import type { ArchitectureReviewView } from '../../src/contracts/architecture-review.js';
const createGuiServer:typeof sourceGuiServer=process.env['C1_SERVICE_BROWSER']?(await import(pathToFileURL(resolve('dist/app/server.js')).href)).createGuiServer:sourceGuiServer;
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'c1-service-goal' };
function architecturePlan() { const names = ['reader-a', 'reader-b', 'coordinator']; return { kind: 'plan', summary: 'Inspect two readers and coordinate an interface decision before implementation.', assignments: names.map(name => ({ taskId: name, role: 'document-advisor', instruction: 'C1_' + name + ' read-only report. Independent implementation and verification remain outstanding.' })), plan: { stages: [{ stageId: 'inspect', title: 'Inspect interface' }], tasks: [...names.map(taskId => ({ taskId, stageId: 'inspect', title: taskId, taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'inspect' } })), { taskId: 'gate', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }], obligations: [{ obligationId: 'contract', title: 'Shared interface', requirementLevel: 'required', taskIds: [...names, 'gate'], verificationRequirements: [{ requirementId: 'behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Independently verify the shared interface contract' }] }], taskHierarchy: { parentOf: names.map(childTaskId => ({ parentTaskId: 'gate', childTaskId })) }, executionDag: { dependsOn: names.map(dependsOnId => ({ taskId: 'gate', dependsOnId, requires: { kind: 'artifact', label: 'report' } })) } } }; }
export type ArchitectureServiceHooks = {
  readSharedSource?: boolean;
  queryClient?: ModelClientPort;
  afterReported?: (context: any) => Promise<void>;
  afterRestart?: (context: any) => Promise<void>;
};
export async function architectureServiceScenario(outcome: 'accept' | 'reject' | 'defer' | 'modify', hooks: ArchitectureServiceHooks = {}) {
        const dir = await mkdtemp(join(tmpdir(), 'c1-service-')), root = join(dir, 'source'), data = join(dir, 'data');
        await mkdir(root);
        await mkdir(data);
        await writeFile(join(root, 'README.md'), 'SHARED_RECORD_SOURCE_V1: Reader A uses opaque string Record.id; Reader B expects a number. Both consumers must follow the human decision. Protocol stub, not a model-quality evaluation.');
        const requests: ModelRequest[] = [], builtin = createBuiltinProviderRegistry();
        let reported = false, initialReaders = 0, readersOverlapped = false, readersTimedOut = false;
        let releaseReaders!: () => void, rejectReaders!: (error: Error) => void;
        const bothReaders = new Promise<void>((resolve, reject) => { releaseReaders = resolve; rejectReaders = reject; });
        let readersTimer: ReturnType<typeof setTimeout> | undefined;
        const client: ModelClientPort = { async *stream(request) {
                requests.push(structuredClone(request));
                const common = { schemaVersion: 1 as const, requestId: request.requestId }, text = JSON.stringify(request.messages);
                if (text.includes('Return one JSON object with kind')) {
                    yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify(architecturePlan()) };
                    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
                    return;
                }
                if (hooks.queryClient && text.includes('semantic_query')) {
                    yield* hooks.queryClient.stream(request, { signal: new AbortController().signal });
                    return;
                }
                if (!reported && initialReaders < 2) {
                    initialReaders++;
                    if (initialReaders === 1) readersTimer = setTimeout(() => { readersTimedOut = true; rejectReaders(Error('Accepted independent planned readers did not overlap')); }, 15000);
                    else { readersOverlapped = !readersTimedOut; clearTimeout(readersTimer); releaseReaders(); }
                    await bothReaders;
                }
                if (hooks.readSharedSource && !request.messages.some(message => message.role === 'tool' && JSON.stringify(message).includes('SHARED_RECORD_SOURCE_V1'))) {
                    yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'shared-source', name: 'read', ordinal: 0 };
                    yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'shared-source', delta: JSON.stringify({ path: 'README.md' }) };
                    yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
                    return;
                }
                if (!reported && text.includes('C1_coordinator') && request.tools.some(t => t.name === 'report_architecture_conflict')) {
                    reported = true;
                    const callId = 'c1-report';
                    yield { ...common, sequence: 1, type: 'tool_call_started', callId, name: 'report_architecture_conflict', ordinal: 0 };
                    yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId, delta: JSON.stringify({ key: 'interface-v1', description: 'Reader A uses string IDs; Reader B uses numbers. Decide before implementing Record.id.', proposedDescription: 'Use opaque string IDs.', affectedWorkIds: ['reader-a', 'reader-b'].map(id => workIdFor(scope, id)), affectedRefs: { moduleRefs: ['reader-a', 'reader-b'], interfaceRefs: ['Record.id'], pathRefs: [] } }) };
                    yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
                    return;
                }
                yield { ...common, sequence: 1, type: 'text_delta', delta: 'Read-only report. Follow the formal architecture decision, with baseline activation and permissions still required.' };
                yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
            } };
        const options = { workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': root }, modelSettings: { directory: join(dir, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => client } } };
        let app = await createGuiServer(data, options), base = '', token = '';
        const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); const address = app.server.address(); if (!address || typeof address === 'string')
            throw Error('no port'); base = 'http://127.0.0.1:' + address.port; token = ((await (await fetch(base + '/api/meta')).json()) as {
            workspaceToken: string;
        }).workspaceToken; };
        const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as any }; };
        const state = async (scope: Record<string, string>) => (await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json()) as any;
        const oldUntil = async (scope: Record<string, string>) => { const deadline = Date.now() + 20000; for (;;) {
            const value = await state(scope);
            if (value.liveRuns?.[0]?.status === 'completed')
                return value;
            if (Date.now() > deadline)
                throw Error('timeout ' + JSON.stringify(await post('/api/real/planning', scope)));
            await new Promise(done => setTimeout(done, 25));
        } };
        const view = async () => { const r = await post('/api/real/architecture-reviews/view', scope); expect(r.status).toBe(200); return r.body as ArchitectureReviewView; };
        const until = async (check: (v: ArchitectureReviewView) => boolean) => { const end = Date.now() + 45000; for (;;) {
            const v = await view();
            if (check(v))
                return v;
            if (Date.now() > end)
                throw Error('timeout ' + JSON.stringify({ view: v, planning: await post('/api/real/planning', scope), state: await state(scope), requests: requests.length }));
            await new Promise(r => setTimeout(r, 40));
        } };
        try {
            await listen();
            await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-c1-service-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
            await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Inspect two readers and decide their shared Record.id contract.' });
            const catalog: Record<string, any> = {};
            for (const roleId of ['planner', 'document-advisor']) {
                const content = roleSpecSourceFor(roleId === 'planner' ? 'planner' : 'investigator').content;
                const installed = await post('/api/real/governance/install', { ...scope, kind: 'RoleSpecRevision', source: { roleId, revision: 3, content: { ...content, label: roleId, purpose: roleId === 'planner' ? content.purpose : 'Review documents and report sourced conclusions' } } });
                expect(installed.body.status, JSON.stringify(installed.body)).toBe('committed');
                const governanceView = await post('/api/real/governance/view', scope);
                catalog[roleId] = governanceView.body.kinds.find((k: any) => k.kind === 'RoleSpecRevision').roleSpecs.find((r: any) => r.roleId === roleId).pin;
                expect((await post('/api/real/governance/activate', { ...scope, kind: 'RoleSpecRevision', pin: catalog[roleId] })).body.status).toBe('committed');
            }
            const content = { ...buildCoordinationPolicyContentWithoutRolesV1(), roles: { catalog, coordinator: { roleId: 'planner', note: 'Coordinate document work' } } };
            const installed = await post('/api/real/governance/install', { ...scope, kind: 'CoordinationPolicy', source: { policyId: 'documents-policy', content } });
            expect(installed.body.status, JSON.stringify(installed.body)).toBe('committed');
            const governanceView = await post('/api/real/governance/view', scope);
            const policy = governanceView.body.kinds.find((k: any) => k.kind === 'CoordinationPolicy').installed.find((v: any) => v.ref.policyId === 'documents-policy');
            expect((await post('/api/real/governance/activate', { ...scope, kind: 'CoordinationPolicy', pin: { ref: policy.ref, digest: policy.contentDigest } })).body.status).toBe('committed');
            expect(await post('/api/real/work', { ...scope, requestId: 'c1-work', instruction: 'Inspect two readers then report the cross-interface conflict.', allowWrite: true })).toMatchObject({ status: 200, body: { status: 'planning' } });
            let v = await until(v => v.rows.length === 1);
            expect(readersOverlapped, 'Both independent planned readers must enter the provider before either returns').toBe(true);
            let row = v.rows[0]!;
            expect(row.review.status).toBe('pending');
            expect(row.targets.filter(t => t.mode === 'resume')).toHaveLength(2);
            const fixed = structuredClone(row.review);
            expect((await post('/api/real/memory/profile/maintain', { requestId: 'c1-preference', expectedRevision: 0, edits: [{ operation: 'remember', entryId: 'style', content: 'Explain briefly in Chinese. This is a presentation preference.' }] })).body).toMatchObject({ status: 'committed' });
            expect((await view()).rows[0]!.review).toEqual(fixed);
            await hooks.afterReported?.({ post, state: () => state(scope), scope, root, requests });
            let input = { ...scope, requestId: 'c1-human', reviewId: row.review.ref.reviewId, expectedRevision: row.review.revision, proposalDigest: row.review.proposalDigest, outcome, summary: 'Human ' + outcome, description: 'Use opaque string IDs and document conversion.' };
            if (process.env['C1_SERVICE_BROWSER']) {
                const requireUi = createRequire(resolve('src/ui/package.json'));
                const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
                const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
                try {
                    const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
                    page.setDefaultTimeout(15000);
                    page.setDefaultNavigationTimeout(20000);
                    const navigation = await page.goto(base + '/workbench?' + new URLSearchParams(scope));
                    expect(navigation?.status(), 'The built workbench must be served before browser interaction').toBe(200);
                    await page.getByTestId('goal-' + scope.goalId).click();
                    const card = page.getByTestId('architecture-review');
                    await card.waitFor();
                    expect(await card.innerText()).toContain(row.review.proposalDigest);
                    expect(await card.innerText()).toContain('Record.id');
                    await page.getByLabel('决定说明', { exact: true }).fill(input.summary);
                    if (outcome === 'modify')
                        await page.getByLabel('修改后的方案说明（修改会产生新提案）', { exact: true }).fill(input.description);
                    const output = resolve('evidence/collaboration-memory/batch/integration/browser-service', String(Date.now()));
                    await mkdir(output, { recursive: true });
                    await page.screenshot({ path: join(output, outcome + '-pending.png'), fullPage: true });
                    const response = page.waitForResponse((r: any) => r.url().endsWith('/api/real/architecture-reviews/decide'));
                    await page.getByRole('button', { name: { accept: '接受', reject: '拒绝', defer: '延后', modify: '修改并重新待决' }[outcome], exact: true }).click();
                    const received = await response;
                    expect(await received.json()).toMatchObject({ status: 'committed' });
                    Object.assign(input, received.request().postDataJSON());
                    await expect.poll(async () => card.innerText(), { timeout: 15000 }).toContain(outcome === 'modify' ? '版本 2' : ({ accept: '已接受', reject: '已拒绝', defer: '已延后' } as const)[outcome]);
                    await page.screenshot({ path: join(output, outcome + '-recorded.png'), fullPage: true });
                }
                finally {
                    await browser.close();
                }
            }
            else {
                expect((await post('/api/real/architecture-reviews/decide', input)).body).toMatchObject({ status: 'committed' });
            }
            if (outcome === 'modify') {
                v = await view();
                row = v.rows[0]!;
                expect(row.review.proposalDigest).not.toBe(fixed.proposalDigest);
                expect(row.review.status).toBe('pending');
                expect((await post('/api/real/architecture-reviews/decide', { ...input, requestId: 'stale', outcome: 'accept' })).body.status).toBe('rejected');
                input = { ...input, requestId: 'c1-human-accept', expectedRevision: row.review.revision, proposalDigest: row.review.proposalDigest, outcome: 'accept' as typeof outcome };
                expect((await post('/api/real/architecture-reviews/decide', input)).body.status).toBe('committed');
            }
            v = await until(v => v.rows[0]!.allRequiredAttempted);
            expect(v.rows[0]!.allNotified).toBe(true);
            const targets = v.rows[0]!.targets.filter(t => t.mode === 'resume');
            expect(targets.every(t => t.stage === 'attempted')).toBe(true);
            await expect.poll(async () => {
                const current = await state(scope);
                return targets.every(target => current.liveRuns.some((run: any) => run.spec.runId === target.runId && run.status === 'completed'));
            }, { timeout: 30000 }).toBe(true);
            const calls = requests.filter(r => JSON.stringify(r.messages).includes('architecture_review'));
            expect(calls.length).toBeGreaterThanOrEqual(2);
            expect(calls.every(r => !r.tools.some(t => ['edit', 'write', 'bash', 'shell'].includes(t.name)))).toBe(true);
            await app.close();
            app = await createGuiServer(data, options);
            await listen();
            expect((await post('/api/real/architecture-reviews/decide', input)).body).toMatchObject({ status: 'committed', replayed: true });
            const after = await view();
            expect(after.rows[0]!.targets.filter(t => t.mode === 'resume').map(t => t.runId)).toEqual(targets.map(t => t.runId));
            expect(requests.filter(r => JSON.stringify(r.messages).includes('architecture_review'))).toHaveLength(calls.length);
            await hooks.afterRestart?.({ post, state: () => state(scope), scope, root, requests });
        }
        finally {
            await app.close();
            await rm(dir, { recursive: true, force: true });
        }
}
