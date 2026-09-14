import { validateInitialParticipationState, validateInitialParticipationCommit, validateSuccessorClaimState } from '../../src/data/state-ledger/ledger-validation.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from '../../src/harness/persistent-harness.js';
import { CodingAgentRuntime } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';
import { WorkMaterialDrive } from '../../src/control/dispatch-engine/work-material-drive.js';
import { LedgerRoleSpecRead } from '../../src/control/dispatch-engine/role-spec-read.js';
import { WorkRunMaterialCompiler } from '../../src/data/context-compiler/work-run-materials.js';
import { DeliveryMaterialCompiler } from '../../src/data/context-compiler/delivery-materials.js';
import { readAdmittedSuccessor } from '../../src/control/dispatch-engine/coordination-admission-read.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { workContextRefFor } from '../../src/contracts/context-continuity.js';
import { workParticipationRefFor, type CommunicationAdmissionSnapshot, type WaitConditionSnapshot } from '../../src/contracts/coordination.js';
import { runRefFor } from '../../src/contracts/dispatch.js';
import type { SourceApplicabilityPort } from '../../src/contracts/material-access.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { buildReduceGoalCommand } from '../../src/contracts/commands/goal-phase.js';
import { goalPhaseRefFor } from '../../src/contracts/goal-phase.js';
import { setupP107Scenario } from './runtime-concurrency-fixture.js';
import { P107_PROJECT as P, P107_WORKSPACE as W, P107_SCHEMA as AT, P107_GOAL as G, P107_TASK_READER_A, P107_TASK_READER_B, P107_TASK_WRITER_B, P107_ROLE_BINDING_READER_V1 as ROLE } from '../contract-support/fixtures/workspace-fixtures.js';
import { ArchitectureReviewEntry } from '../../src/interaction/human-collaboration/architecture-review.js';
import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
export async function architectureReviewScenario(outcome: 'accept' | 'reject' | 'defer' | 'modify', hooks: {
    initialAssignments?: boolean;
    fault?: 'after_delivery' | 'before_bind' | 'after_bind';
    successorModel?: {
        configuration: {
            revision: string;
            provider: string;
            model: string;
            baseUrl: string;
        };
        client: ModelClientPort;
    };
    completed?: (result: unknown) => Promise<void>;
    choose?: (entry: ArchitectureReviewEntry, ledger: import('../../src/contracts/ledger.js').StateLedger, scope: {
        projectId: string;
        workspaceId: string;
    }, input: Record<string, unknown>) => Promise<import('../../src/contracts/architecture-review.js').ArchitectureReviewReceipt>;
} = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'cm-c1-host-')), root = join(dir, 'source');
    await mkdir(root);
    const requests = new Map<string, ModelRequest[]>();
    const responses: Record<string, string[]> = {};
    const model = (runId: string): ModelClientPort => ({ async *stream(request, options): AsyncIterable<ModelEvent> {
            const rows = requests.get(runId) ?? [];
            requests.set(runId, rows);
            rows.push(structuredClone(request));
            const common = { schemaVersion: 1 as const, requestId: request.requestId };
            if (runId === 'c1-c' && rows.length === 1) {
                expect(request.tools.map(t => t.name)).toContain('report_architecture_conflict');
                const callId = 'report-conflict';
                yield { ...common, sequence: 1, type: 'tool_call_started', callId, name: 'report_architecture_conflict', ordinal: 0 };
                yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId, delta: JSON.stringify({ key: 'interface-v1', description: 'Reader A expects a string ID; reader B expects a numeric ID. Decide before implementing the shared interface.', proposedDescription: 'Use string IDs in both read packages.', affectedWorkIds: ['c1-work-a', 'c1-work-b'], affectedRefs: { moduleRefs: ['reader-a', 'reader-b'], interfaceRefs: ['Record.id'], pathRefs: [] } }) };
                yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
                return;
            }
            if (runId === 'c1-c')
                expect(JSON.stringify(request.messages)).toContain('ArchitectureReview');
            if (!['c1-a', 'c1-b', 'c1-c'].includes(runId)) {
                expect(JSON.stringify(request.messages)).toContain('architecture_review');
                expect(JSON.stringify(request.messages)).toContain(outcome === 'modify' ? 'Use opaque string IDs' : 'Use string IDs');
            }
            if (hooks.successorModel && !['c1-a', 'c1-b', 'c1-c'].includes(runId)) {
                for await (const event of hooks.successorModel.client.stream(request, options)) {
                    if (event.type === 'text_delta')
                        (responses[runId] ??= []).push(event.delta);
                    yield event;
                }
                return;
            }
            yield { ...common, sequence: 1, type: 'text_delta', delta: 'Reported or continued under the current formal baseline. No workspace edits or verification claim.' };
            yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
        } });
    const createRuntime = async () => {
        const value = new CodingAgentRuntime(join(dir, 'runs'), async (runId) => ({
            configuration: hooks.successorModel?.configuration ?? { revision: 'local', provider: 'deepseek', model: 'c1-captured', baseUrl: 'http://127.0.0.1' }, client: model(runId)
        }));
        await value.init();
        return value;
    };
    let runtime = await createRuntime();
    const source: SourceApplicabilityPort = { capture: async (query) => ({ status: 'sourced', pin: { schemaVersion: 1, projectId: query.projectId, workspaceId: query.workspaceId,
                sourceSet: query.sourceSet, identity: { workspace: root, commit: null }, manifestDigest: sha256Hex('c1-three-readers-source') } }) };
    let h!: PersistentSqliteHarness;
    let currentTime = AT;
    try {
        h = await createPersistentSqliteHarness({ dir, initialWorkAssignments: hooks.initialAssignments ?? false, deps: { clock: () => currentTime, eventId: randomUUID }, sourceApplicability: source,
            runtimePreparation: { all: () => runtime.all(), prepare: spec => runtime.prepare(spec), preflight: spec => runtime.preflight(spec) }, workspaceRootFor: () => root,
            runtime: { capabilities: () => runtime.capabilities(), start: (envelope, access) => new LeasedWorkerRuntime({ runtime,
                    lease: () => h.workspaceLease, vault: () => h.vault, now: () => AT,
                    coordination: spec => h.coordinationGrant(runRefFor(spec.projectId, spec.goalId, spec.runId)),
                    materials: (spec, current) => new WorkMaterialDrive({ ledger: h.ledger,
                        control: { resolveTaskWorkIdentity: query => h.control.resolveTaskWorkIdentity(query), grantMaterialAccess: async (command) => {
                                const receipt = await h.control.grantMaterialAccess(command);
                                if (receipt.status === 'committed')
                                    await h.advanceProjection();
                                return receipt;
                            } },
                        compiler: new WorkRunMaterialCompiler({ ledger: h.ledger, vault: h.vault, workContext: h.workContext, completedWork: h.completedWork, roleSpec: new LedgerRoleSpecRead({ ledger: h.ledger }) }),
                        deliveries: new DeliveryMaterialCompiler({ admitted: h.admittedDeliveryRead, vault: h.vault, source }),
                    }).assembleRun(spec, current),
                }).start(envelope, access) } });
        const scenario = await setupP107Scenario(h);
        let initialCount = 0;
        if (hooks.initialAssignments) {
            const commitInitial = h.ledger.commit.bind(h.ledger);
            h.ledger.commit = async (batch) => {
                if (batch.commitKind === 'initial-participation-start') {
                    initialCount++;
                    expect(validateInitialParticipationCommit(batch)).toBe(true);
                    const refs = [batch.command.payload.workContextRef, batch.command.payload.runRef, batch.command.payload.initialDispatchRef!, { aggregateType: 'AgentInstance' as const, projectId: P, workspaceId: W, agentInstanceId: batch.command.payload.agentInstanceId }];
                    const cache = new Map<string, import('../../src/contracts/ledger.js').AggregateSnapshot>();
                    for (const ref of refs) {
                        const r = await h.ledger.load(ref);
                        if (r.status === 'found')
                            cache.set(canonicalJson(ref), r.snapshot);
                    }
                    const get = (ref: import('../../src/contracts/ledger.js').AggregateRef) => cache.get(canonicalJson(ref));
                    expect(validateInitialParticipationState(batch, get)).toBe(true);
                    const work = cache.get(canonicalJson(refs[0]!)) as import('../../src/contracts/context-continuity.js').WorkContextBindingSnapshot;
                    for (const binding of [{ ...work.binding, currentParticipationRef: (batch.snapshots[0] as import('../../src/contracts/coordination.js').WorkParticipationSnapshot).ref }, { ...work.binding, linkedRunRefs: [...work.binding.linkedRunRefs, runRefFor(P, G, 'old-run')] }, { ...work.binding, roleBindingRef: { ...ROLE, bindingVersion: 99 } }]) {
                        cache.set(canonicalJson(work.ref), { ...work, binding });
                        expect(validateInitialParticipationState(batch, get)).toBe(false);
                    }
                    cache.set(canonicalJson(work.ref), work);
                    const forged = structuredClone(batch);
                    (forged.snapshots[0] as import('../../src/contracts/coordination.js').WorkParticipationSnapshot).participation.roleBinding.bindingVersion = 99;
                    expect(await commitInitial(forged)).toMatchObject({ status: 'rejected', code: 'invalid_commit' });
                    const wrongTime = structuredClone(batch);
                    (wrongTime.snapshots[0] as import('../../src/contracts/coordination.js').WorkParticipationSnapshot).recordedAt = '2000-01-01T00:00:00.000Z';
                    expect(await commitInitial(wrongTime)).toMatchObject({ status: 'rejected', code: 'invalid_commit' });
                }
                return commitInitial(batch);
            };
        }
        for (const [name, taskId] of [['a', P107_TASK_READER_A], ['b', P107_TASK_READER_B], ['c', P107_TASK_WRITER_B]] as const) {
            currentTime = new Date(Date.parse(currentTime) + 1000).toISOString();
            const runRef = runRefFor(P, G, 'c1-' + name), work = workContextRefFor(P, W, 'c1-work-' + name), part = workParticipationRefFor(P, W, work.workId, 'c1-part-' + name);
            const actor = { kind: 'agent' as const, id: 'c1-agent-' + name, runRef };
            const identity = (id: string) => ({ projectId: P, actor, idempotencyKey: id, agentPrincipal: { schemaVersion: 1 as const, agentInstanceId: actor.id, workContextRef: work, participationRef: part, roleBinding: ROLE, runRef } });
            expect(await h.claimTask(buildDispatchClaimCommand({ projectId: P, goalId: G, taskId, runId: runRef.runId, attemptId: 'c1-attempt-' + name,
                commandId: 'claim-' + name, correlationId: 'c1', idempotencyKey: 'claim-' + name, submittedAt: AT, roleBinding: ROLE,
                declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 1000000, deadline: null } }))).toMatchObject({ status: 'committed' });
            expect(await h.bindWorkContext({ commandType: 'BindWorkContext', commandId: 'bind-' + name, schemaVersion: 1, aggregateId: work.workId, expectedRevision: 0, correlationId: 'c1', submittedAt: AT,
                identity: { projectId: P, actor: { kind: 'system', id: 'c1-host' }, idempotencyKey: 'bind-' + name },
                payload: { workspaceId: W, workKind: name === 'c' && !hooks.initialAssignments ? 'coordination' : 'task', goalId: G, taskId: name === 'c' && !hooks.initialAssignments ? null : taskId,
                    planRef: scenario.planRef, planRevision: scenario.planSnapshot.revision, roleBindingRef: ROLE, initialRunRef: runRef } })).toMatchObject({ status: 'committed' });
            if (!hooks.initialAssignments) {
                expect(await h.control.registerAgentInstance({ commandType: 'RegisterAgentInstance', commandId: 'agent-' + name, schemaVersion: 1, aggregateId: actor.id, expectedRevision: 0,
                    correlationId: 'c1', submittedAt: AT, identity: identity('agent-' + name), payload: { workspaceId: W, templateId: ROLE.templateId, templateRevision: ROLE.templateRevision } })).toMatchObject({ status: 'committed' });
                expect(await h.control.startWorkParticipation({ commandType: 'StartWorkParticipation', commandId: 'part-' + name, schemaVersion: 1, aggregateId: part.participationId, expectedRevision: 0,
                    correlationId: 'c1', submittedAt: AT, identity: identity('part-' + name), payload: { workspaceId: W, workContextRef: work, agentInstanceId: actor.id, roleBinding: ROLE, runRef } })).toMatchObject({ status: 'committed' });
            }
            await runtime.prepare({ projectId: P, workspaceId: W, goalId: G, taskId, runId: runRef.runId, root, instruction: 'Read-only work ' + name + '. If a formal architecture review is delivered, explain its outcome and exact proposal briefly in Chinese; state which activation or permission guards still apply. Do not call tools or change files.',
                budget: { contextWindowTokens: 1000000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 } });
            if (hooks.initialAssignments) {
                const initial = await h.drive({ reason: 'ordinary-first-assignment', maxIntents: 1 });
                expect(initial.failures, JSON.stringify(initial)).toEqual([]);
            }
        }
        const first = await h.drive({ reason: 'real-report-before-tests', maxIntents: 3 });
        expect(first.failures, JSON.stringify(first)).toEqual([]);
        if (hooks.initialAssignments)
            expect(initialCount).toBe(3);
        const scope = { projectId: P, workspaceId: W };
        let view = await architectureReviewView(h.ledger, scope);
        expect(view.rows).toHaveLength(1);
        let row = view.rows[0]!;
        expect(row.review.status).toBe('pending');
        expect(row.targets).toHaveLength(hooks.initialAssignments ? 3 : 4);
        expect(row.targets.filter(t => t.mode === 'resume')).toHaveLength(2);
        expect(row.brief.impact.affectedInterfaces).toEqual(['Record.id']);
        expect([...requests.keys()].sort()).toEqual(['c1-a', 'c1-b', 'c1-c']);
        const stalePage = await h.ledger.events({ afterCursor: null, limit: 1000 });
        const grant = await h.coordinationGrant(runRefFor(P, G, 'c1-c'));
        expect(grant.status).toBe('granted');
        if (grant.status === 'granted') {
            await expect(new ArchitectureReviewEntry({ ledger: h.ledger, control: h.control, vault: h.vault, inspection: h.inspection, now: () => currentTime }).report(grant.access.principal, { key: 'interface-v1', description: 'Reader A expects a string ID; reader B expects a numeric ID. Decide before implementing the shared interface.', proposedDescription: 'Use string IDs in both read packages.', affectedWorkIds: ['c1-work-a', 'c1-work-c'], affectedRefs: { moduleRefs: ['reader-a', 'reader-b'], interfaceRefs: ['Record.id'], pathRefs: [] } })).rejects.toThrow('idempotency_conflict');
        }
        const before = await h.ledger.load({ aggregateType: 'ProjectArchitectureBaselineActive', projectId: P });
        const entry = () => new ArchitectureReviewEntry({ ledger: h.ledger, control: h.control, vault: h.vault, inspection: h.inspection, now: () => currentTime });
        const input = { requestId: 'human-choice', reviewId: row.review.ref.reviewId, expectedRevision: row.review.revision, proposalDigest: row.review.proposalDigest, outcome, summary: 'Human selected ' + outcome, description: 'Use opaque string IDs and document the conversion.' };
        const choice = await (hooks.choose ? hooks.choose(entry(), h.ledger, scope, input) : entry().decide(scope, input));
        expect(choice, JSON.stringify(choice)).toMatchObject({ status: 'committed' });
        if (outcome === 'modify') {
            view = await architectureReviewView(h.ledger, scope);
            const modified = view.rows[0]!;
            expect(modified.review.status).toBe('pending');
            expect(modified.proposal.proposalId).not.toBe(row.proposal.proposalId);
            expect(await entry().decide(scope, { ...input, requestId: 'stale-old-choice', outcome: 'accept' })).toMatchObject({ status: 'rejected' });
            row = modified;
            expect(await entry().decide(scope, { ...input, requestId: 'accept-new', expectedRevision: row.review.revision, proposalDigest: row.review.proposalDigest, outcome: 'accept' })).toMatchObject({ status: 'committed' });
        }
        // Decision committed; restart before delivery. Durable intents must be enough.
        await runtime.close();
        await h.close();
        runtime = await createRuntime();
        h = await h.reopen();
        let checkedAdmission = 0;
        let injected = false;
        const commit = h.ledger.commit.bind(h.ledger);
        h.ledger.commit = async (batch) => {
            if (batch.commitKind === 'communication-successor-claim') {
                const cache = new Map<string, import('../../src/contracts/ledger.js').AggregateSnapshot>();
                for (const guard of batch.expectedVersions) {
                    const loaded = await h.ledger.load(guard.ref);
                    if (loaded.status === 'found')
                        cache.set(canonicalJson(guard.ref), loaded.snapshot);
                }
                const forged = structuredClone(batch);
                forged.snapshots[5].admission.deliveryRefs = [];
                expect(validateSuccessorClaimState(forged, ref => cache.get(canonicalJson(ref)))).toBe(false);
                checkedAdmission++;
            }
            const binding = batch.events.find(e => e.eventType === 'RuntimeInputBound' && e.payload.binding.deliveryRefs.length > 0);
            const inject = !injected && ((hooks.fault === 'after_delivery' && batch.commitKind === 'architecture-review-delivery') || ((hooks.fault === 'before_bind' || hooks.fault === 'after_bind') && binding));
            if (inject && hooks.fault === 'before_bind') {
                injected = true;
                throw Error('injected interruption before decision input bind');
            }
            const receipt = await commit(batch);
            if (inject && receipt.status === 'committed') {
                injected = true;
                throw Error('injected interruption ' + hooks.fault);
            }
            return receipt;
        };
        const admit = h.control.admitWaitSuccessor.bind(h.control);
        h.control.admitWaitSuccessor = async (command) => {
            expect(await admit({ ...command, payload: { ...command.payload, deliveryRefs: [] } })).toMatchObject({ status: 'rejected' });
            return admit(command);
        };
        for (let i = 0; i < 4; i++) {
            const results = await Promise.all(Array.from({ length: hooks.initialAssignments ? 3 : 1 }, (_, n) => h.drive({ reason: 'decision-restart-' + i + '-' + n, maxIntents: 64 })));
            for (const result of results) {
                if (hooks.initialAssignments)
                    expect(result.failures.every(f => f.effect === 'none'), JSON.stringify(result)).toBe(true);
                else
                    expect(result.failures, JSON.stringify(result)).toEqual([]);
            }
        }
        const eventsRead = h.ledger.events.bind(h.ledger);
        let firstPage = true;
        h.ledger.events = async (query) => { if (firstPage && query.afterCursor === null) {
            firstPage = false;
            return stalePage;
        } return eventsRead(query); };
        view = await architectureReviewView(h.ledger, scope);
        h.ledger.events = eventsRead;
        if (hooks.initialAssignments)
            expect(checkedAdmission).toBeGreaterThanOrEqual(2);
        else
            expect(checkedAdmission).toBe(2);
        expect(view.rows[0]!.allNotified, JSON.stringify(view)).toBe(true);
        expect(view.rows[0]!.allRequiredAttempted, JSON.stringify({ targets: view.rows[0]!.targets, requests: [...requests.keys()], runs: runtime.all().map(r => ({ id: r.spec.runId, status: r.status, error: r.error })), evidenceCount: (await h.ledger.events({ afterCursor: null, limit: 1000 })).events.filter(r => r.event.eventType === 'ModelRequestEvidenceRecorded').length })).toBe(!hooks.fault || hooks.fault === 'after_delivery');
        if (hooks.fault) {
            expect(injected).toBe(true);
            if (hooks.fault !== 'after_delivery') {
                expect(view.rows[0]!.targets.filter(t => t.stage === 'failed')).toHaveLength(1);
                expect(view.rows[0]!.targets.filter(t => t.stage === 'attempted')).toHaveLength(1);
            }
        }
        expect(await h.ledger.load({ aggregateType: 'ProjectArchitectureBaselineActive', projectId: P })).toEqual(before);
        const counts = [...requests].map(([id, rows]) => [id, rows.length]);
        currentTime = new Date(Date.parse(currentTime) + 10000).toISOString();
        expect(await entry().decide(scope, input)).toMatchObject({ status: 'committed', replayed: true });
        await runtime.close();
        await h.close();
        runtime = await createRuntime();
        h = await h.reopen();
        await h.drive({ reason: 'restart-after-provider-attempt', maxIntents: 64 });
        expect([...requests].map(([id, rows]) => [id, rows.length])).toEqual(counts);
        const events = await h.ledger.events({ afterCursor: null, limit: 1000 });
        expect(events.events.filter(r => r.event.eventType === 'CommunicationAdmissionRecorded')).toHaveLength(2);
        expect(events.events.filter(r => r.event.eventType === 'EvidenceAdmitted')).toHaveLength(0);
        if (hooks.successorModel) {
            expect(Object.keys(responses)).toHaveLength(2);
            expect(Object.values(responses).every(chunks => chunks.join('').trim().length > 0)).toBe(true);
            expect(runtime.all().filter(r => !['c1-a', 'c1-b', 'c1-c'].includes(r.spec.runId)).every(r => r.status === 'completed')).toBe(true);
        }
        await hooks.completed?.({ outcome, view, requests: Object.fromEntries(requests), responses, events: events.events });
    }
    finally {
        await runtime.close();
        if (h)
            await h.close();
        await rm(dir, { recursive: true, force: true });
    }
}
