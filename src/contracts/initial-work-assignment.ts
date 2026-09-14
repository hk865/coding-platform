import type { AggregateRef, AggregateSnapshot } from './ledger.js';
import type { StartWorkParticipationCommand } from './coordination.js';
import type { RunSnapshot, DispatchOutboxEntrySnapshot } from './dispatch.js';
import type { WorkContextBindingSnapshot } from './context-continuity.js';
import { workParticipationRefFor } from './coordination.js';
import { canonicalJson, sha256Hex } from './fingerprint.js';
export function initialAssignmentIds(work: AggregateRef, run: AggregateRef) { const id = sha256Hex(canonicalJson([work, run])).slice(0, 24); return { agentId: 'initial-agent-' + id, participationId: 'initial-participation-' + id }; }
/** First assignment is a distinct business transition, never a fallback from a denied capability. */
export function initialAssignmentEligible(c: StartWorkParticipationCommand, get: (ref: AggregateRef) => AggregateSnapshot | undefined): boolean {
    if (!c.payload.initialDispatchRef)
        return false;
    const w = get(c.payload.workContextRef) as WorkContextBindingSnapshot | undefined;
    const r = get(c.payload.runRef) as RunSnapshot | undefined;
    const o = get(c.payload.initialDispatchRef) as DispatchOutboxEntrySnapshot | undefined;
    if (!w || !r || !o)
        return false;
    if (w.ref.aggregateType !== 'WorkContextBinding' || r.ref.aggregateType !== 'Run' || o.ref.aggregateType !== 'DispatchOutboxEntry')
        return false;
    const b = w.binding, i = o.intent, ids = initialAssignmentIds(w.ref, r.ref);
    return b.status === 'active' && b.currentParticipationRef == null && b.linkedRunRefs.length === 1 && canonicalJson(b.linkedRunRefs[0] ?? null) === canonicalJson(r.ref) && canonicalJson(b.initialRunRef) === canonicalJson(r.ref)
        && r.status === 'starting' && r.envelope === null && o.status === 'pending' && !i.admittedWorkRef && !i.work
        && canonicalJson(i.runRef) === canonicalJson(r.ref) && canonicalJson(i.roleBinding) === canonicalJson(c.payload.roleBinding) && canonicalJson(r.roleBinding) === canonicalJson(c.payload.roleBinding)
        && canonicalJson(b.roleBindingRef) === canonicalJson(c.payload.roleBinding) && canonicalJson(b.planRef) === canonicalJson(i.planRef) && canonicalJson(r.planRef) === canonicalJson(i.planRef)
        && b.taskId === i.taskId && b.goalId === r.ref.goalId && b.projectId === i.projectId && b.workspaceId === i.workspaceId && r.workspaceSnapshot.workspaceId === i.workspaceId
        && c.payload.workspaceId === b.workspaceId && c.identity.projectId === b.projectId && canonicalJson(c.identity.actor.kind === 'agent' ? c.identity.actor.runRef : null) === canonicalJson(r.ref)
        && canonicalJson(c.identity.agentPrincipal ?? null) === canonicalJson({ schemaVersion: 1, agentInstanceId: ids.agentId, workContextRef: w.ref, participationRef: workParticipationRefFor(b.projectId, b.workspaceId, b.workId, ids.participationId), roleBinding: i.roleBinding, runRef: r.ref })
        && c.aggregateId === ids.participationId && c.payload.agentInstanceId === ids.agentId && c.identity.actor.kind === 'agent' && c.identity.actor.id === ids.agentId;
}
