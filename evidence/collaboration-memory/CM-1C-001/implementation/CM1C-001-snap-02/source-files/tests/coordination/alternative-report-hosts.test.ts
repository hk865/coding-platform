import { expect, it } from 'vitest';
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
import { P107_PROJECT as P, P107_WORKSPACE as W, P107_SCHEMA as AT, P107_GOAL as G, P107_TASK_READER_A, P107_TASK_READER_B, P107_TASK_WRITER_B,
  P107_ROLE_BINDING_READER_V1 as ROLE } from '../contract-support/fixtures/workspace-fixtures.js';

type ToolValue = { operation?: string; accepted?: boolean; references?: { kind: string; id: string }[];
  requests?: { requestId: string; toWorkId: string }[] };
function results(request: ModelRequest): ToolValue[] {
  return request.messages.flatMap(message => {
    if (message.role !== 'tool') return [];
    const output = (message.result as unknown as { output?: { kind: string; value?: ToolValue }[] }).output ?? [];
    return output.flatMap(item => item.kind === 'json' && item.value ? [item.value] : []);
  });
}
const userInput = (requests: ModelRequest[]) => requests.flatMap(request => request.messages.filter(message => message.role === 'user').map(message => message.content)).join('\n');

it('three distinct Works use real Host tools: first report resumes the coordinator, late reporter continues, restart does not repeat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cm-m06-three-hosts-')), root = join(dir, 'source');
  await mkdir(root);
  const nonceA = 'M06-late-A-' + randomUUID(), nonceB = 'M06-winner-B-' + randomUUID();
  const requests = new Map<string, ModelRequest[]>();
  let releaseA!: () => void;
  const allowA = new Promise<void>(resolve => { releaseA = resolve; });
  const model = (runId: string): ModelClientPort => ({ async *stream(request): AsyncIterable<ModelEvent> {
    let rows = requests.get(runId); if (!rows) { rows = []; requests.set(runId, rows); }
    rows.push(structuredClone(request));
    const index = rows.length - 1, common = { schemaVersion: 1 as const, requestId: request.requestId };
    const call = (name: string, params: Record<string, unknown>): ModelEvent[] => {
      expect(request.tools.map(tool => tool.name)).toContain(name);
      const callId = runId + '-' + index;
      return [{ ...common, sequence: 1, type: 'tool_call_started', callId, name, ordinal: 0 },
        { ...common, sequence: 2, type: 'tool_arguments_delta', callId, delta: JSON.stringify(params) },
        { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' }];
    };
    const values = results(request);
    if (runId === 'm06-c') {
      if (index === 0) { yield* call('coordination_subscribe', { topics: ['DirectedRequestResponded'], key: 'reports' }); return; }
      if (index === 1 || index === 2) { const target = index === 1 ? 'a' : 'b'; yield* call('coordination_request', { toWorkId: 'm06-work-' + target, statement: 'Read-only optional report ' + target, body: 'Investigate ' + target, key: target }); return; }
      if (index === 3) {
        const ids = values.filter(value => value.operation === 'request' && value.accepted).flatMap(value => value.references ?? []).filter(ref => ref.kind === 'DirectedRequest').map(ref => ref.id);
        expect(ids).toHaveLength(2);
        yield* call('coordination_wait', { mode: 'any', requestIds: ids, key: 'first-report' }); return;
      }
    } else if (runId === 'm06-a' || runId === 'm06-b') {
      if (runId === 'm06-a') await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('late reporter release timeout')), 20_000);
        void allowA.then(() => { clearTimeout(timer); resolve(); }, reject);
      });
      if (index === 0) { yield* call('coordination_mailbox', {}); return; }
      if (index === 1) {
        const incoming = values.flatMap(value => value.requests ?? []).find(row => row.toWorkId === 'm06-work-' + runId.at(-1));
        expect(incoming).toBeDefined();
        yield* call('coordination_respond', { requestId: incoming!.requestId, body: runId === 'm06-a' ? nonceA : nonceB, key: 'report' }); return;
      }
    } else {
      expect(userInput([request])).toContain(nonceB);
      expect(userInput([request])).not.toContain(nonceA);
    }
    yield { ...common, sequence: 1, type: 'text_delta', delta: 'Read-only work finished; no verification conclusion.' };
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  } });
  const createRuntime = async () => { const value = new CodingAgentRuntime(join(dir, 'runs'), async runId => ({
    configuration: { revision: 'local', provider: 'deepseek', model: 'm06-captured', baseUrl: 'http://127.0.0.1' }, client: model(runId) })); await value.init(); return value; };
  let runtime = await createRuntime();
  const source: SourceApplicabilityPort = { capture: async query => ({ status: 'sourced', pin: { schemaVersion: 1, projectId: query.projectId, workspaceId: query.workspaceId,
    sourceSet: query.sourceSet, identity: { workspace: root, commit: null }, manifestDigest: sha256Hex('m06-three-readers-source') } }) };
  let h!: PersistentSqliteHarness;
  let currentTime = AT;
  let ongoing: Promise<unknown> | undefined;
  try {
    h = await createPersistentSqliteHarness({ dir, deps: { clock: () => currentTime, eventId: randomUUID }, sourceApplicability: source,
      runtimePreparation: { all: () => runtime.all(), prepare: spec => runtime.prepare(spec), preflight: spec => runtime.preflight(spec) }, workspaceRootFor: () => root,
      runtime: { capabilities: () => runtime.capabilities(), start: (envelope, access) => new LeasedWorkerRuntime({ runtime,
        lease: () => h.workspaceLease, vault: () => h.vault, now: () => AT,
        coordination: spec => h.coordinationGrant(runRefFor(spec.projectId, spec.goalId, spec.runId)),
        materials: (spec, current) => new WorkMaterialDrive({ ledger: h.ledger,
          control: { resolveTaskWorkIdentity: query => h.control.resolveTaskWorkIdentity(query), grantMaterialAccess: async command => {
            const receipt = await h.control.grantMaterialAccess(command); if (receipt.status === 'committed') await h.advanceProjection(); return receipt; } },
          compiler: new WorkRunMaterialCompiler({ ledger: h.ledger, vault: h.vault, workContext: h.workContext, completedWork: h.completedWork, roleSpec: new LedgerRoleSpecRead({ ledger: h.ledger }) }),
          deliveries: new DeliveryMaterialCompiler({ admitted: h.admittedDeliveryRead, vault: h.vault, source }),
        }).assembleRun(spec, current),
      }).start(envelope, access) } });
    const scenario = await setupP107Scenario(h);
    for (const [name, taskId] of [['c', P107_TASK_WRITER_B], ['b', P107_TASK_READER_B], ['a', P107_TASK_READER_A]] as const) {
      currentTime = new Date(Date.parse(currentTime) + 1000).toISOString();
      const runRef = runRefFor(P, G, 'm06-' + name), work = workContextRefFor(P, W, 'm06-work-' + name), part = workParticipationRefFor(P, W, work.workId, 'm06-part-' + name);
      const actor = { kind: 'agent' as const, id: 'm06-agent-' + name, runRef };
      const identity = (id: string) => ({ projectId: P, actor, idempotencyKey: id, agentPrincipal: { schemaVersion: 1 as const, agentInstanceId: actor.id, workContextRef: work, participationRef: part, roleBinding: ROLE, runRef } });
      expect(await h.claimTask(buildDispatchClaimCommand({ projectId: P, goalId: G, taskId, runId: runRef.runId, attemptId: 'm06-attempt-' + name,
        commandId: 'claim-' + name, correlationId: 'm06', idempotencyKey: 'claim-' + name, submittedAt: AT, roleBinding: ROLE,
        declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 1_000_000, deadline: null } }))).toMatchObject({ status: 'committed' });
      expect(await h.bindWorkContext({ commandType: 'BindWorkContext', commandId: 'bind-' + name, schemaVersion: 1, aggregateId: work.workId, expectedRevision: 0, correlationId: 'm06', submittedAt: AT,
        identity: { projectId: P, actor: { kind: 'system', id: 'm06-host' }, idempotencyKey: 'bind-' + name },
        payload: { workspaceId: W, workKind: name === 'c' ? 'coordination' : 'task', goalId: G, taskId: name === 'c' ? null : taskId,
          planRef: scenario.planRef, planRevision: scenario.planSnapshot.revision, roleBindingRef: ROLE, initialRunRef: runRef } })).toMatchObject({ status: 'committed' });
      expect(await h.control.registerAgentInstance({ commandType: 'RegisterAgentInstance', commandId: 'agent-' + name, schemaVersion: 1, aggregateId: actor.id, expectedRevision: 0,
        correlationId: 'm06', submittedAt: AT, identity: identity('agent-' + name), payload: { workspaceId: W, templateId: ROLE.templateId, templateRevision: ROLE.templateRevision } })).toMatchObject({ status: 'committed' });
      expect(await h.control.startWorkParticipation({ commandType: 'StartWorkParticipation', commandId: 'part-' + name, schemaVersion: 1, aggregateId: part.participationId, expectedRevision: 0,
        correlationId: 'm06', submittedAt: AT, identity: identity('part-' + name), payload: { workspaceId: W, workContextRef: work, agentInstanceId: actor.id, roleBinding: ROLE, runRef } })).toMatchObject({ status: 'committed' });
      await runtime.prepare({ projectId: P, workspaceId: W, goalId: G, taskId, runId: runRef.runId, root, instruction: 'M06 distinct read-only ' + name,
        budget: { contextWindowTokens: 1_000_000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 } });
    }
    const first = await h.drive({ reason: 'coordinator-registers', maxIntents: 1 });
    expect(first.failures, JSON.stringify(first)).toEqual([]);
    const second = await h.drive({ reason: 'report-b-first', maxIntents: 1 });
    expect(second.failures, JSON.stringify(second)).toEqual([]);
    ongoing = h.drive({ reason: 'resume-c-while-a-is-reading', maxIntents: 20 });
    await expect.poll(() => [...requests.keys()].filter(key => !['m06-a', 'm06-b', 'm06-c'].includes(key)), { timeout: 30_000 }).toHaveLength(1);
    const successorId = [...requests.keys()].find(key => !['m06-a', 'm06-b', 'm06-c'].includes(key))!;
    expect(userInput(requests.get(successorId)!)).toContain(nonceB);
    expect(userInput(requests.get(successorId)!)).not.toContain(nonceA);
    const admitted = await readAdmittedSuccessor(h.ledger, { projectId: P, workspaceId: W, runId: successorId });
    expect(admitted.status).toBe('found'); if (admitted.status !== 'found') throw Error('admission missing');
    const admission = admitted.facts.admission as CommunicationAdmissionSnapshot;
    expect(admission.admission.deliveryRefs).toHaveLength(1);
    const wait = await h.ledger.load(admission.admission.waitRef);
    expect(wait.status).toBe('found'); if (wait.status !== 'found') throw Error('wait missing');
    expect((wait.snapshot as WaitConditionSnapshot).wait.selectedReport?.conditionIndex).toBe(1);
    releaseA(); await ongoing;
    await h.drive({ reason: 'late-report-routing', maxIntents: 20 });
    const mailbox = await h.control.mailboxView(workContextRefFor(P, W, 'm06-work-c'));
    expect(mailbox.status).toBe('ready'); if (mailbox.status !== 'ready') throw Error('mailbox missing');
    expect(mailbox.view.requests.map(row => row.request.toWorkContextRef.workId).sort()).toEqual(['m06-work-a', 'm06-work-b']);
    expect(mailbox.view.requests.every(row => row.request.status === 'responded')).toBe(true);
    expect(mailbox.view.requests.map(row => row.request.response!.authorRunRef.runId).sort()).toEqual(['m06-a', 'm06-b']);
    expect(mailbox.view.deliveries.filter(row => row.delivery.origin.kind === 'subscription')).toHaveLength(2);
    const count = requests.get(successorId)!.length;
    await runtime.close(); await h.close(); runtime = await createRuntime(); h = await h.reopen();
    await h.drive({ reason: 'restart-after-late-report', maxIntents: 20 });
    expect(requests.get(successorId)).toHaveLength(count);
    const events = await h.ledger.events({ afterCursor: null, limit: 1000 });
    expect(events.hasMore).toBe(false);
    expect(events.events.filter(row => row.event.eventType === 'CommunicationAdmissionRecorded')).toHaveLength(1);
    expect(events.events.filter(row => row.event.eventType === 'EvidenceAdmitted')).toHaveLength(0);
    expect(scenario.planSnapshot.obligations.some(obligation => obligation.requirementLevel === 'required' &&
      obligation.verificationRequirements.some(requirement => requirement.requirementLevel === 'required'))).toBe(true);
    const phase = await h.ledger.load(goalPhaseRefFor(P, G));
    const reduced = await h.reduceGoal(buildReduceGoalCommand({ commandId: 'm06-required-still-unmet', correlationId: 'm06-required-still-unmet',
      submittedAt: currentTime, expectedRevision: phase.status === 'found' ? phase.snapshot.revision : 0,
      projectId: P, goalId: G, actor: { kind: 'system', id: 'm06-host' }, idempotencyKey: 'm06-required-still-unmet' }));
    expect(reduced.status).toBe('committed');
    if (reduced.status !== 'committed') throw Error('goal reduction failed');
    expect(reduced.phase).not.toBe('COMPLETED');
    expect(reduced.reasonCodes).toContain('guard_required_obligation_unsatisfied');
    expect(runtime.all().find(row => row.spec.runId === 'm06-a')?.cancelRequested).not.toBe(true);
  } finally {
    releaseA(); await ongoing?.catch(() => undefined); await runtime.close(); if (h) await h.close(); await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
