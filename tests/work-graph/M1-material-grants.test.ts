/** M1 independent Stage 1: real claim/MaterialPort/W1 fixtures; only the new writer is missing. */
import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { RawArtifactBodyStore, type ArtifactBodyRows } from '../../src/core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { artifactBodyKey } from '../../src/core/record-store/body-codec.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { artifactBodyDigest, artifactBodySize, type ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { MaterialBasisV1, MaterialSourceCaptureResult, SourceApplicabilityPort } from '../../src/contracts/material-access.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { WorkspaceSourceApplicability } from '../../src/core/workspace/source-applicability.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialGrantService } from '../../src/core/work-graph/materials/grant-service.js';
import { MATERIAL_GRANT_EVENT_SCHEMAS } from '../../src/core/work-graph/materials/grant-record-codecs.js';
import type { GrantMaterialAccessInput, MaterialGrantPort } from '../../src/core/work-graph/materials/grant-contracts.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'r4c-claim-project', workspaceId = 'r4c-claim-workspace', goalId = 'r4c-claim-goal';
const actor = { kind: 'human' as const, id: 'r4c-claim-operator' };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'query', runId: 'query-run' };
let producerRef: RunRef, consumerRef: RunRef;
let roleBinding: import('../../src/contracts/dispatch.js').RoleBindingRefV1;
const hostCtx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor }, materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
class TestBodyRows implements ArtifactBodyRows {
    readonly rows = new Map<string, string>();
    get(key: string) { return this.rows.get(key); }
    putIfAbsent(key: string, json: string) {
        const previous = this.rows.get(key);
        if (previous !== undefined)
            return { json: previous, inserted: false };
        this.rows.set(key, json);
        return { json, inserted: true };
    }
}
async function buildFixture(kind: 'memory' | 'sqlite') {
    const f = await createTaskClaimFixture(kind, { records: [], events: [...MATERIAL_GRANT_EVENT_SCHEMAS] });
    const bodies = kind === 'sqlite' ? createSqliteRawArtifactStore(join(f.directory, 'm1-bodies.sqlite')) : new RawArtifactBodyStore();
    try {
        roleBinding = f.roleBinding;
        await mkdir(join(f.directory, 'src'));
        await writeFile(join(f.directory, 'src/input.txt'), 'source version one');
        const access = createWorkspaceAccessFactory({ resolveRoot: async () => ({ status: 'ready', value: { root: f.directory, workspaceRevision: 1 } }),
            authorize: async () => ({ status: 'ready', value: { subjectKey: 'host:m1', permissionRevision: 'p1', allowsRead: () => true } }) });
        let captureCount = 0;
        const source: SourceApplicabilityPort = { async capture(q, signal = hostCtx.signal) {
                captureCount++;
                const opened = await access.open({ ...hostCtx, signal }, { aggregateType: 'Workspace', projectId: q.projectId, workspaceId: q.workspaceId });
                if (opened.status !== 'ready')
                    return { status: 'unavailable', issues: [opened.reason] };
                const a = opened.value;
                try {
                    return await new WorkspaceSourceApplicability(() => ({ allowed: p => a.authorization.allowsRead(p),
                        inventory: () => a.listFiles(60000), read: (p, max) => a.read(p, max), sourceIdentity: () => a.sourceIdentity() })).capture(q, signal);
                }
                finally {
                    await a.release();
                }
            } };
        const sourceSet = { kind: 'workspace_paths' as const, paths: ['src/input.txt'] };
        const captured = await source.capture({ projectId, workspaceId, sourceSet });
        expect(captured.status, JSON.stringify(captured)).toBe('sourced');
        if (captured.status !== 'sourced')
            throw Error('source fixture');
        const sourcePin = captured.pin;
        const reads = createMaterialRecordReaders(f.records);
        let eventSeq = 0;
        const materials = createMaterialService({ bodies, authority: reads.authority, grants: createMaterialAccessResolver(reads.authority, reads.index, source), now: () => AT });
        const producer = await f.service.claimTask(f.ctx, await f.buildRequest({ requestId: 'm1-producer' }));
        expect(producer.status, 'formal producer claim').toBe('committed');
        if (producer.status !== 'committed')
            throw Error(JSON.stringify(producer));
        producerRef = producer.value.runRef;
        const producerCtx: CoreCallContext = { ...hostCtx, principal: { kind: 'work_run', runRef: producerRef, roleBinding }, materialReader: { kind: 'run', requester: producerRef } };
        const put = async (body: string) => {
            const result = await materials.storeArtifact(producerCtx, { body, contentType: 'text/plain', sources: [{ kind: 'workspace', refId: workspaceId, revision: '1' }], origin: { kind: 'execution', ref: producerRef } });
            expect(result.status, 'real MaterialPort store').toBe('stored');
            if (result.status !== 'stored')
                throw Error(JSON.stringify(result));
            return result.ref;
        };
        const artifact = await put('exact reference body'), absent = await put('absent reference body'), unused = await put('unused reference body');
        const p = f.plan;
        const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'm1-current-input', planRevision: p.planRevision + 1, goalId,
            stages: structuredClone(p.stages), tasks: structuredClone(p.tasks), assignments: structuredClone(p.assignments ?? []),
            obligations: structuredClone(p.obligations), taskHierarchy: structuredClone(p.taskHierarchy), executionDag: structuredClone(p.executionDag),
            taskRelations: [], inputRequirements: [{ requirementId: 'needed', consumerTaskId: f.tasks.second.taskId, kind: 'artifact', artifactRef: artifact }] };
        const proposed = await f.plans.proposePlan(hostCtx, { meta: { requestId: 'm1-propose-input', expected: [await f.goalPin()] }, input: { goalRef, basedOn: f.planRef, draft, reason: { text: 'ordinary reference', sources: [] } } });
        expect(proposed.status, 'formal W1 proposal').toBe('committed');
        if (proposed.status !== 'committed')
            throw Error(JSON.stringify(proposed));
        expect(proposed.value.issues).toEqual([]);
        const adopted = await f.plans.applyPlanChange(hostCtx, { meta: { requestId: 'm1-adopt-input', expected: [await f.goalPin()] }, input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
        expect(adopted.status, 'formal W1 adoption').toBe('committed');
        if (adopted.status !== 'committed')
            throw Error(JSON.stringify(adopted));
        const planRef = adopted.value.ref;
        const consumer = await f.service.claimTask(hostCtx, await f.buildRequest({ requestId: 'm1-consumer', input: { taskId: f.tasks.second.taskId, sessionRef: f.sessions.second, planRef } }));
        expect(consumer.status, 'formal consumer claim').toBe('committed');
        if (consumer.status !== 'committed')
            throw Error(JSON.stringify(consumer));
        consumerRef = consumer.value.runRef;
        // QueryRun is only a negative owner-boundary fixture; never a grant/TaskInput producer.
        const qr: QueryRunSnapshot = { ref: queryRunRef, revision: 1, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef: { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: queryRunRef.queryJobId }, runId: queryRunRef.runId, status: 'pending', startedAt: null, endedAt: null, outcome: null } };
        expect((await f.commitRaw([{ refKey: canonicalJson(queryRunRef as unknown as JsonValue), schemaId: 'QueryRunSnapshot@1', revision: 1, json: JSON.stringify(qr) }])).status).toBe('committed');
        const currentBasis = (): MaterialBasisV1 => ({ planRef, workspaceRevision: 1, sourceDigest: sourcePin.manifestDigest, sourcePin });
        const consumerCtx = (): CoreCallContext => ({ ...hostCtx, principal: { kind: 'work_run', runRef: consumerRef, roleBinding }, materialReader: { kind: 'run', requester: consumerRef, currentBasis: currentBasis() } });
        const goalPin = await f.goalPin();
        const grantRequest = (overrides: Partial<GrantMaterialAccessInput> = {}): GraphWrite<GrantMaterialAccessInput> => ({ meta: { requestId: 'm1-grant-request', expected: [structuredClone(goalPin), { ref: f.workspaceRef, revision: 1 }] },
            input: { goalRef, reader: consumerRef, materials: [artifact], sourceSet: structuredClone(sourceSet), purpose: 'Share the exact reference note', ...overrides } });
        const makeGrantService = (records: GoalRecordTransactionPort = f.records): MaterialGrantPort => createMaterialGrantService({ records, authority: reads.authority, materials, source, now: () => AT, eventId: () => `m1-event-${++eventSeq}` });
        const plans = createPlanService({ records: f.records, materials, now: () => AT, eventId: () => `m1-plan-${++eventSeq}` });
        return { f, bodies, directory: f.directory, records: f.records, authority: reads.authority, materials, plans, grant: makeGrantService(), source, sourcePin, captures: () => captureCount,
            artifact, absent, unused, planRef, consumerTaskId: f.tasks.second.taskId, consumerCtx, currentBasis, grantRequest, makeGrantService,
            async close() {
                if ('close' in bodies)
                    await bodies.close();
                await f.close();
            } };
    }
    catch (e) {
        if ('close' in bodies)
            await bodies.close();
        await f.close();
        throw e;
    }
}
const dirs: string[] = [];
afterEach(async () => {
    for (const dir of dirs.splice(0))
        await rm(dir, { recursive: true, force: true });
});
it.each(['memory', 'sqlite'] as const)('%s: formal producer stores its body, Host grants a starting consumer, and current TaskInput reads original text', async (kind) => {
    const fixture = await buildFixture(kind);
    try {
        // Real setup facts: the Host can historically open the producer body and
        // observe its TRUE owner; the consumer is a formal starting Run; the plan
        // is accepted and current.
        await expect(fixture.materials.openArtifact(hostCtx, { ref: fixture.artifact,
            usage: 'historical_explanation' })).resolves.toMatchObject({ status: 'ready',
            value: { ref: fixture.artifact, body: 'exact reference body', ownerRunRef: producerRef,
                applicability: 'historical_explanation' } });
        await expect(fixture.authority.load(consumerRef)).resolves.toMatchObject({ status: 'found',
            snapshot: { status: 'starting' } });
        // The formal writer must be the producer of the grant; a seed grant is
        // never accepted as the production chain.
        const granted = await fixture.grant.grantMaterialAccess(hostCtx, fixture.grantRequest());
        expect(granted).toMatchObject({ status: 'committed', replayed: false,
            value: { revision: 1, schemaVersion: 1,
                grant: { reader: consumerRef, materials: [fixture.artifact],
                    issuedBy: { aggregateType: 'Control', projectId, goalId },
                    purpose: 'Share the exact reference note',
                    basis: { planRef: fixture.planRef, workspaceRevision: 1, sourcePin: fixture.sourcePin } } } });
        if (granted.status !== 'committed')
            throw new Error('M1 grant did not commit');
        expect(granted.value.revocation).toBeUndefined();
        // The consumer's real starting Run reads through the unchanged current path.
        await expect(fixture.plans.readTaskInput(fixture.consumerCtx(), { goalRef, planRef: fixture.planRef,
            taskId: fixture.consumerTaskId, requirementId: 'needed' })).resolves.toMatchObject({ status: 'ready',
            value: { ref: fixture.artifact, body: 'exact reference body', applicability: 'current' } });
        await expect(fixture.authority.load(granted.value.ref)).resolves.toMatchObject({ status: 'found', snapshot: granted.value });
        await expect(fixture.authority.load(consumerRef)).resolves.toMatchObject({ status: 'found', snapshot: { status: 'starting', outcome: null } });
        await writeFile(join(fixture.directory, 'outside.txt'), 'unselected content');
        await expect(fixture.materials.openArtifact(fixture.consumerCtx(), { ref: fixture.artifact, usage: 'current' })).resolves.toMatchObject({ status: 'ready' });
        await writeFile(join(fixture.directory, 'src/input.txt'), 'selected content changed');
        await expect(fixture.materials.openArtifact(fixture.consumerCtx(), { ref: fixture.artifact, usage: 'current' })).resolves.toMatchObject({ status: 'rejected', code: 'source_stale' });
        // Reading a material is never task completion or evidence.
        const graph = await fixture.plans.queryTaskGraph(fixture.consumerCtx(), { goalRef });
        expect(graph).toMatchObject({ status: 'ready' });
    }
    finally {
        await fixture.close();
    }
});
it('rejects non-Host callers and spoofed payload fields with zero grant writes', async () => {
    const fixture = await buildFixture('memory');
    try {
        const committed: string[] = [];
        const countingRecords: GoalRecordTransactionPort = { ...fixture.records,
            commit: input => { committed.push(input.identityKey); return fixture.records.commit(input); } };
        const grant = fixture.makeGrantService(countingRecords);
        const workCtx: CoreCallContext = { ...fixture.consumerCtx() };
        const queryCtx: CoreCallContext = { projectId, workspaceId,
            principal: { kind: 'query_run', queryRunRef, initiator: actor },
            materialReader: { kind: 'run', requester: queryRunRef, currentBasis: fixture.currentBasis() },
            signal: new AbortController().signal };
        const mismatchCtx: CoreCallContext = { ...hostCtx,
            materialReader: { kind: 'host', projectId, workspaceId, actor: { kind: 'system', id: 'other' } } };
        const crossScopeCtx: CoreCallContext = { ...hostCtx, workspaceId: 'another-workspace',
            materialReader: { kind: 'host', projectId, workspaceId: 'another-workspace', actor } };
        const spoofed = { ...fixture.grantRequest().input,
            grantId: 'forged', issuedBy: { aggregateType: 'Control', projectId, goalId },
            basis: fixture.currentBasis(), sourcePin: fixture.sourcePin, sourceDigest: 'f'.repeat(64),
            grantedAt: AT, history: { owner: producerRef, usage: 'historical_explanation' } } as unknown as GrantMaterialAccessInput;
        const results = [
            await grant.grantMaterialAccess(workCtx, fixture.grantRequest()),
            await grant.grantMaterialAccess(queryCtx, fixture.grantRequest()),
            await grant.grantMaterialAccess(mismatchCtx, fixture.grantRequest()),
            await grant.grantMaterialAccess(crossScopeCtx, fixture.grantRequest()),
            await grant.grantMaterialAccess(hostCtx, { ...fixture.grantRequest(),
                input: { ...fixture.grantRequest().input, reader: { ...consumerRef, runId: 'missing-run' } } }),
            await grant.grantMaterialAccess(hostCtx, { ...fixture.grantRequest(), input: spoofed }),
        ];
        // The skeleton must not have written anything, even on rejection.
        expect(committed).toEqual([]);
        expect(results.map(result => result.status === 'rejected' ? result.code : result.status))
            .toEqual(['forbidden', 'forbidden', 'forbidden', 'forbidden', 'not_found', 'invalid']);
    }
    finally {
        await fixture.close();
    }
});
it('checks the real material owner and refuses ownerless/platform/QueryRun/cross-goal bodies', async () => {
    const fixture = await buildFixture('memory');
    try {
        const sourceRef = { kind: 'workspace' as const, refId: workspaceId, revision: '1' };
        const rows = new TestBodyRows();
        const bodies = new RawArtifactBodyStore(rows);
        const put = async (body: string, origin: Parameters<RawArtifactBodyStore['put']>[0]['origin']) => {
            const result = await bodies.put({ body, contentType: 'text/plain', sourceRefs: [sourceRef], origin, requestedAt: AT });
            if (result.status !== 'ready')
                throw new Error('owner fixture put failed');
            return result.value.ref;
        };
        const platformBody = await put('platform note', { kind: 'platform_operation', projectId,
            workspaceId, requestId: 'm1-platform', actor });
        const queryBody = await put('query note', { kind: 'run', owner: queryRunRef });
        const otherGoal = 'm1-other-goal';
        const original = await fixture.authority.load(producerRef);
        if (original.status !== 'found')
            throw Error('negative-owner fixture missing producer');
        const foreignRef = { aggregateType: 'Run' as const, projectId, goalId: otherGoal, runId: 'other-run' };
        const foreign = { ...original.snapshot, ref: foreignRef, task: { projectId, goalId: otherGoal, taskId: 'other' } };
        expect((await fixture.f.commitRaw([{ refKey: canonicalJson(foreignRef), schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(foreign) }])).status).toBe('committed');
        const crossBody = await put('cross goal note', { kind: 'run',
            owner: { aggregateType: 'Run', projectId, goalId: otherGoal, runId: 'other-run' } });
        // A legacy ownerless row can be decoded but never newly encoded.
        const legacySource = { kind: 'workspace' as const, refId: workspaceId, revision: '1' };
        const legacyRef: ArtifactRef = { kind: 'artifact', contentType: 'text/plain',
            digest: artifactBodyDigest('legacy note'), sizeBytes: artifactBodySize('legacy note'), source: legacySource };
        rows.rows.set(artifactBodyKey(legacyRef), JSON.stringify({ ref: legacyRef, body: 'legacy note',
            sourceRefs: [legacySource], ownerRunRef: null }));
        const reads = createMaterialRecordReaders(fixture.records);
        const materials = createMaterialService({ bodies, authority: reads.authority,
            grants: createMaterialAccessResolver(reads.authority, reads.index, fixture.source), now: () => AT });
        const grant = createMaterialGrantService({ records: fixture.records, authority: reads.authority,
            materials, source: fixture.source, now: () => AT, eventId: () => 'm1-owner-event' });
        await expect(materials.openArtifact(hostCtx, { ref: queryBody, usage: 'historical_explanation' })).resolves.toMatchObject({ status: 'ready', value: { ownerRunRef: queryRunRef } });
        await expect(materials.openArtifact(hostCtx, { ref: crossBody, usage: 'historical_explanation' })).resolves.toMatchObject({ status: 'ready', value: { ownerRunRef: foreignRef } });
        // Setup: the Host historical path really sees these materials, so the grant
        // rejection below is about the owner rule, not an unreadable fixture.
        await expect(materials.openArtifact(hostCtx, { ref: platformBody, usage: 'historical_explanation' }))
            .resolves.toMatchObject({ status: 'ready', value: { applicability: 'historical_explanation' } });
        await expect(materials.openArtifact(hostCtx, { ref: legacyRef, usage: 'historical_explanation' }))
            .resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
        await expect(materials.openArtifact(hostCtx, { ref: fixture.absent, usage: 'historical_explanation' }))
            .resolves.toMatchObject({ status: 'not_found' });
        const request = (material: ArtifactRef) => ({ ...fixture.grantRequest(),
            input: { ...fixture.grantRequest().input, materials: [material] } });
        const results = [
            await grant.grantMaterialAccess(hostCtx, request(platformBody)),
            await grant.grantMaterialAccess(hostCtx, request(queryBody)),
            await grant.grantMaterialAccess(hostCtx, request(crossBody)),
            await grant.grantMaterialAccess(hostCtx, request(legacyRef)),
        ];
        expect(results.map(result => result.status === 'rejected' ? result.code : result.status))
            .toEqual(['forbidden', 'forbidden', 'forbidden', 'forbidden']);
    }
    finally {
        await fixture.close();
    }
});
it('rejects malformed materials, source sets and payloads and never uses caller metadata as a pin', async () => {
    const fixture = await buildFixture('memory');
    try {
        const tooMany = Array.from({ length: 65 }, () => fixture.artifact);
        const cases: {
            label: string;
            input: GrantMaterialAccessInput;
        }[] = [
            { label: 'empty materials', input: { ...fixture.grantRequest().input, materials: [] } },
            { label: 'duplicate materials', input: { ...fixture.grantRequest().input,
                    materials: [fixture.artifact, fixture.artifact] } },
            { label: 'too many materials', input: { ...fixture.grantRequest().input, materials: tooMany } },
            { label: 'empty purpose', input: { ...fixture.grantRequest().input, purpose: '' } },
            { label: 'oversized purpose', input: { ...fixture.grantRequest().input, purpose: 'x'.repeat(1025) } },
            { label: 'unsorted source paths', input: { ...fixture.grantRequest().input,
                    sourceSet: { kind: 'workspace_paths', paths: ['src/z.txt', 'src/a.txt'] } } },
            { label: 'duplicate source paths', input: { ...fixture.grantRequest().input,
                    sourceSet: { kind: 'workspace_paths', paths: ['src/a.txt', 'src/a.txt'] } } },
            { label: 'unsafe source path', input: { ...fixture.grantRequest().input,
                    sourceSet: { kind: 'workspace_paths', paths: ['../outside.txt'] } } },
        ];
        const results = [];
        for (const entry of cases)
            results.push(await fixture.grant.grantMaterialAccess(hostCtx, { ...fixture.grantRequest(), input: entry.input }));
        const verification = { ...fixture.grantRequest().input,
            sourceSet: { kind: 'verification_workspace', paths: ['.'] } } as unknown as GrantMaterialAccessInput;
        results.push(await fixture.grant.grantMaterialAccess(hostCtx, { ...fixture.grantRequest(), input: verification }));
        expect(results.map(result => result.status === 'rejected' ? result.code : result.status))
            .toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'unsupported']);
    }
    finally {
        await fixture.close();
    }
});
it('treats a missing/unavailable/stale source provider as a refusal, never a metadata match', async () => {
    const fixture = await buildFixture('memory');
    try {
        const unavailable = createMaterialGrantService({ records: fixture.records, authority: fixture.authority,
            materials: fixture.materials, now: () => AT, eventId: () => 'm1-unavailable',
            source: { capture: async (): Promise<MaterialSourceCaptureResult> => ({ status: 'unavailable', issues: ['no provider'] }) } });
        const stale = createMaterialGrantService({ records: fixture.records, authority: fixture.authority,
            materials: fixture.materials, now: () => AT, eventId: () => 'm1-stale',
            source: { capture: async (): Promise<MaterialSourceCaptureResult> => ({ status: 'stale', issues: ['changed'] }) } });
        const unavailableResult = await unavailable.grantMaterialAccess(hostCtx, fixture.grantRequest());
        const staleResult = await stale.grantMaterialAccess(hostCtx, fixture.grantRequest());
        expect([unavailableResult, staleResult].map(result => result.status === 'rejected' ? result.code : result.status))
            .toEqual(['unavailable', 'source_stale']);
    }
    finally {
        await fixture.close();
    }
});
it('replays the identical grant request without a second capture and conflicts on changed payload', async () => {
    const fixture = await buildFixture('memory');
    try {
        const before = fixture.captures();
        const first = await fixture.grant.grantMaterialAccess(hostCtx, fixture.grantRequest());
        const replay = await fixture.grant.grantMaterialAccess(hostCtx, fixture.grantRequest());
        const changed = await fixture.grant.grantMaterialAccess(hostCtx, { ...fixture.grantRequest(),
            input: { ...fixture.grantRequest().input, purpose: 'a different audit note' } });
        expect(first).toMatchObject({ status: 'committed' });
        expect(replay).toMatchObject({ status: 'committed', replayed: true });
        expect(changed).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
        expect(fixture.captures()).toBe(before + 1);
    }
    finally {
        await fixture.close();
    }
});
it('revokes CAS 1 to 2 without rewriting the grant and without requiring a current basis', async () => {
    const fixture = await buildFixture('memory');
    try {
        const granted = await fixture.grant.grantMaterialAccess(hostCtx, fixture.grantRequest());
        expect(granted).toMatchObject({ status: 'committed' });
        if (granted.status !== 'committed')
            throw new Error('M1 grant did not commit');
        const ref = granted.value.ref;
        await writeFile(join(fixture.directory, 'src/input.txt'), 'stale before revoke');
        const revoked = await fixture.grant.revokeMaterialAccess(hostCtx, { meta: { requestId: 'm1-revoke',
                expected: [{ ref, revision: 1 }] }, input: { grantRef: ref, reason: 'withdrawn' } });
        expect(revoked).toMatchObject({ status: 'committed', value: { revision: 2,
                grant: granted.value.grant, revocation: { reason: 'withdrawn', actor, revokedAt: AT } } });
        const replay = await fixture.grant.revokeMaterialAccess(hostCtx, { meta: { requestId: 'm1-revoke',
                expected: [{ ref, revision: 1 }] }, input: { grantRef: ref, reason: 'withdrawn' } });
        expect(replay).toMatchObject({ status: 'committed', replayed: true });
        const late = await fixture.grant.revokeMaterialAccess(hostCtx, { meta: { requestId: 'm1-revoke-late',
                expected: [{ ref, revision: 1 }] }, input: { grantRef: ref, reason: 'again' } });
        expect(late).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
        await expect(fixture.materials.openArtifact(fixture.consumerCtx(), { ref: fixture.artifact, usage: 'current' })).resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
        await expect(fixture.grant.grantMaterialAccess(hostCtx, fixture.grantRequest())).resolves.toEqual({ ...granted, replayed: true });
    }
    finally {
        await fixture.close();
    }
});
it('fails closed for Host current reads and grant-less Run current reads and never refreshes history', async () => {
    const fixture = await buildFixture('memory');
    try {
        await expect(fixture.materials.openArtifact(hostCtx, { ref: fixture.artifact, usage: 'current' }))
            .resolves.toMatchObject({ status: 'rejected', code: 'source_stale' });
        await expect(fixture.materials.openArtifact(fixture.consumerCtx(), { ref: fixture.artifact, usage: 'current' }))
            .resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
        const granted = await fixture.grant.grantMaterialAccess(hostCtx, fixture.grantRequest());
        expect(granted).toMatchObject({ status: 'committed' });
    }
    finally {
        await fixture.close();
    }
});
it('restores original SQLite receipts after restart and does not revive a revoked grant', async () => {
    const t = await buildFixture('sqlite');
    try {
        const granted = await t.grant.grantMaterialAccess(hostCtx, t.grantRequest());
        expect(granted.status).toBe('committed');
        if (granted.status !== 'committed')
            return;
        const request = { meta: { requestId: 'restart-revoke', expected: [{ ref: granted.value.ref, revision: 1 }] },
            input: { grantRef: granted.value.ref, reason: 'withdraw before restart' } };
        const revoked = await t.grant.revokeMaterialAccess(hostCtx, request);
        expect(revoked.status).toBe('committed');
        if (revoked.status !== 'committed')
            return;
        const before = t.captures();
        await t.f.closeBackend();
        const reopened = await t.f.reopenService();
        try {
            const reads = createMaterialRecordReaders(reopened.records);
            const materials = createMaterialService({ bodies: t.bodies, authority: reads.authority,
                grants: createMaterialAccessResolver(reads.authority, reads.index, t.source), now: () => AT });
            const writer = createMaterialGrantService({ records: reopened.records, authority: reads.authority,
                materials, source: t.source, now: () => 'later', eventId: () => 'not-a-new-event' });
            await expect(writer.grantMaterialAccess(hostCtx, t.grantRequest())).resolves.toEqual({ ...granted, replayed: true });
            await expect(writer.revokeMaterialAccess(hostCtx, request)).resolves.toEqual({ ...revoked, replayed: true });
            expect(t.captures()).toBe(before);
            await expect(materials.openArtifact(t.consumerCtx(), { ref: t.artifact, usage: 'current' }))
                .resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
            await expect(reads.authority.load(granted.value.ref)).resolves.toMatchObject({ status: 'found', snapshot: revoked.value });
        }
        finally {
            await reopened.close();
        }
    }
    finally {
        await t.close();
    }
});
it('does not mistake a later identical-body writer for its persisted first owner', async () => {
    const t = await buildFixture('memory');
    try {
        const copied = await t.materials.storeArtifact(t.consumerCtx(), { contentType: 'text/plain', body: 'exact reference body',
            sources: [t.artifact.source], origin: { kind: 'execution', ref: consumerRef } });
        expect(copied).toMatchObject({ status: 'stored', ref: t.artifact });
        await expect(t.materials.openArtifact(hostCtx, { ref: t.artifact, usage: 'historical_explanation' }))
            .resolves.toMatchObject({ status: 'ready', value: { ownerRunRef: producerRef } });
        await expect(t.grant.grantMaterialAccess(hostCtx, t.grantRequest())).resolves.toMatchObject({ status: 'committed' });
    }
    finally {
        await t.close();
    }
});
it('guards Workspace changes during capture and refuses cancellation before a new write', async () => {
    const t = await buildFixture('memory');
    try {
        const source: SourceApplicabilityPort = { async capture(q, signal) {
                const result = await t.source.capture(q, signal);
                const ref = t.f.workspaceRef;
                // Use the existing registered encoder, not a guessed aggregate schema.
                const { encodeWorkspaceSnapshot } = await import('../../src/core/work-graph/persistence/record-codecs.js');
                const changed = await t.f.commitRaw([encodeWorkspaceSnapshot({ ref, revision: 2 })], [{ refKey: canonicalJson(ref), expectedRevision: 1 }]);
                expect(changed.status).toBe('committed');
                return result;
            } };
        const service = createMaterialGrantService({ records: t.records, authority: t.authority, materials: t.materials,
            source, now: () => AT, eventId: () => 'racing-grant' });
        await expect(service.grantMaterialAccess(hostCtx, t.grantRequest())).resolves.toMatchObject({ status: 'rejected', code: 'revision_conflict' });
        const cancelled = new AbortController();
        cancelled.abort();
        await expect(t.grant.grantMaterialAccess({ ...hostCtx, signal: cancelled.signal }, t.grantRequest()))
            .resolves.toMatchObject({ status: 'rejected', code: 'cancelled' });
    }
    finally {
        await t.close();
    }
});
it('snapshots requests before awaiting and reports committed results despite late cancellation', async () => {
    const t = await buildFixture('memory');
    try {
        const request = t.grantRequest();
        const original = structuredClone(request);
        const stop = new AbortController();
        const records: GoalRecordTransactionPort = { ...t.records,
            async lookupCommit(input) {
                request.input.materials.length = 0;
                request.input.purpose = 'mutated after call';
                return t.records.lookupCommit(input);
            },
            async commit(input) {
                const result = await t.records.commit(input);
                if (result.status === 'committed')
                    stop.abort();
                return result;
            } };
        const result = await t.makeGrantService(records).grantMaterialAccess({ ...hostCtx, signal: stop.signal }, request);
        expect(result).toMatchObject({ status: 'committed', value: { grant: { materials: original.input.materials, purpose: original.input.purpose } } });
        expect(stop.signal.aborted).toBe(true);
    }
    finally {
        await t.close();
    }
});

it('recovers a lost commit acknowledgement only from the actual durable receipt', async () => {
    const t = await buildFixture('memory');
    try {
        let durable: Extract<Awaited<ReturnType<GoalRecordTransactionPort['commit']>>, { status: 'committed' }> | undefined;
        let original: import('../../src/contracts/material-access.js').MaterialAccessGrantSnapshot | undefined;
        const lost = t.makeGrantService({ ...t.records, async commit(batch) {
            const receipt = await t.records.commit(batch);
            expect(receipt.status).toBe('committed');
            if (receipt.status !== 'committed') throw Error('real Store prerequisite failed');
            durable = receipt;
            original = JSON.parse(batch.records[0]!.json);
            throw Error('acknowledgement transport lost after the durable commit');
        } });
        const request = t.grantRequest();
        const recovered = await lost.grantMaterialAccess(hostCtx, request);
        expect(durable).toBeDefined();
        expect(recovered).toEqual({ status: 'committed', value: original, replayed: true, cursor: durable?.cursor });
        const captures = t.captures();
        expect(await t.grant.grantMaterialAccess(hostCtx, request)).toEqual(recovered);
        expect(t.captures()).toBe(captures);
        if (!original) throw Error('the real grant snapshot must have committed');
        expect(await t.authority.load(original.ref)).toMatchObject({ status: 'found', snapshot: original });
        expect(await t.materials.openArtifact(t.consumerCtx(), { ref: t.artifact, usage: 'current' }))
            .toMatchObject({ status: 'ready', value: { body: 'exact reference body' } });

        // The same error class without a durable write has no receipt to recover.
        // A catch block must not fabricate committed from a prospective snapshot.
        let attemptedKey: string | undefined;
        const unknown = t.makeGrantService({ ...t.records, async commit(batch) {
            attemptedKey = batch.records[0]!.refKey;
            throw Error('commit acknowledgement unavailable; durable outcome unknown');
        } });
        const newRequest = t.grantRequest();
        newRequest.meta.requestId = 'm1-no-durable-receipt';
        const unresolved = await unknown.grantMaterialAccess(hostCtx, newRequest);
        expect(unresolved).toMatchObject({ status: 'rejected', code: 'unavailable' });
        if (unresolved.status === 'rejected') expect(unresolved.reason).not.toMatch(/not committed|before commit|未提交/);
        expect(attemptedKey).toBeDefined();
        if (!attemptedKey) throw Error('the commit boundary must have been reached');
        expect(await t.records.readMany([attemptedKey])).toMatchObject({ status: 'ready', value: { records: [], missing: [attemptedKey] } });
    } finally {
        await t.close();
    }
});
