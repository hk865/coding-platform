import type { StateLedger, AggregateSnapshot } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import { dispatchOutboxRefFor, type DispatchIntentV1 } from '../../contracts/dispatch.js';
import { workContextRefFor } from '../../contracts/context-continuity.js';
import { workParticipationRefFor, type StartWorkParticipationCommand } from '../../contracts/coordination.js';
import { initialAssignmentIds, initialAssignmentEligible } from '../../contracts/initial-work-assignment.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
/** Explicit ordinary first-dispatch transition. Existing work history never authorizes reassignment. */
export async function ensureInitialWorkAssignment(deps: {
    ledger: StateLedger;
    control: ControlEngine;
}, intent: DispatchIntentV1, workId: string): Promise<void> {
    if (intent.admittedWorkRef || intent.work)
        return;
    const work = workContextRefFor(intent.projectId, intent.workspaceId, workId);
    const ids = initialAssignmentIds(work, intent.runRef);
    const part = workParticipationRefFor(intent.projectId, intent.workspaceId, workId, ids.participationId);
    const outbox = dispatchOutboxRefFor(intent.projectId, intent.goalId, intent.taskId, intent.attemptRef.attemptId);
    const actor = { kind: 'agent' as const, id: ids.agentId, runRef: intent.runRef };
    const identity = (key: string) => ({ projectId: intent.projectId, actor, idempotencyKey: key, agentPrincipal: { schemaVersion: 1 as const, agentInstanceId: ids.agentId, workContextRef: work, participationRef: part, roleBinding: intent.roleBinding, runRef: intent.runRef } });
    const key = ids.participationId;
    const command: StartWorkParticipationCommand = { commandType: 'StartWorkParticipation', schemaVersion: 1, commandId: key, aggregateId: key, expectedRevision: 0, identity: identity(key), correlationId: intent.correlationId, submittedAt: intent.requestedAt,
        payload: { workspaceId: intent.workspaceId, workContextRef: work, agentInstanceId: ids.agentId, roleBinding: intent.roleBinding, runRef: intent.runRef, initialDispatchRef: outbox } };
    const cache = new Map<string, AggregateSnapshot>();
    for (const ref of [work, intent.runRef, outbox]) {
        const loaded = await deps.ledger.load(ref);
        if (loaded.status === 'found')
            cache.set(canonicalJson(ref), loaded.snapshot);
    }
    if (!initialAssignmentEligible(command, ref => cache.get(canonicalJson(ref))))
        return;
    const agent = await deps.control.registerAgentInstance({ commandType: 'RegisterAgentInstance', schemaVersion: 1, commandId: ids.agentId, aggregateId: ids.agentId, expectedRevision: 0, identity: identity(ids.agentId), correlationId: intent.correlationId, submittedAt: intent.requestedAt,
        payload: { workspaceId: intent.workspaceId, templateId: intent.roleBinding.templateId, templateRevision: intent.roleBinding.templateRevision } });
    if (agent.status !== 'committed')
        throw Error('Initial Agent assignment rejected: ' + agent.code);
    const receipt = await deps.control.startWorkParticipation(command);
    if (receipt.status !== 'committed')
        throw Error('Initial Work assignment rejected: ' + receipt.code);
}
