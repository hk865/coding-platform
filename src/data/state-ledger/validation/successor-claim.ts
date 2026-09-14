/** Internal StateLedger successor-claim rules. Both adapters invoke these inside their commit protocol. */
import type { AggregateRef, AggregateSnapshot } from '../../../contracts/ledger.js';
import { architectureDeliveryApplies, architectureDeliverySetMatches } from "../../../contracts/architecture-review-values.js";
import { waitAdmissionIntentIdFor } from '../../../contracts/coordination.js';
import { qualifiedAlternativeReport } from '../../../contracts/alternative-report.js';
import { projectRoleSpecActiveRefFor } from '../../../contracts/role-spec.js';
import type { DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from "../../../contracts/dispatch.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { communicationAdmissionRefFor, communicationIntentRefFor } from "../../../contracts/coordination.js";
import { identityMatchesActor } from './batch-identity.js';


/**
 * communication-successor-claim 的形状规则：
 *   - 恰好 TaskClaimed / WaitConditionSatisfied / CommunicationAdmissionRecorded 三个事件
 *     （外加 0..N 个 CommunicationIntentSettled，用于同事务 settle 触发它的 intent）；
 *   - 快照含 TaskLease/TaskAttempt/Run/DispatchOutboxEntry 与 WaitCondition/CommunicationAdmission；
 *   - **outboxIntents 恰好一条**，且与 DispatchOutboxEntry 快照里的 intent 逐字节相同
 *     （后继 Run 的唯一调度记录就是它，没有第二份 pending）；
 *   - TaskLease 由 expected@N 推进到 N+1（承担者从被等待的 Work 转到后继 Run）。
 */
export function validateCommunicationSuccessorClaimCommit(
  batch: import("../../../contracts/coordination.js").CommunicationSuccessorClaimCommitV1,
): boolean {
  try {
    if (batch.schemaVersion !== 1) return false;
    if (batch.outboxIntents.length !== 1) return false;
    const eventTypes = batch.events.map((e) => e.eventType);
    if (eventTypes[0] !== "TaskClaimed") return false;
    if (!eventTypes.includes("WaitConditionSatisfied")) return false;
    if (!eventTypes.includes("CommunicationAdmissionRecorded")) return false;
    if (eventTypes.some((t) => t !== "TaskClaimed" && t !== "WaitConditionSatisfied" &&
      t !== "CommunicationAdmissionRecorded" && t !== "CommunicationIntentSettled" &&
      t !== "CommunicationIntentRecorded")) return false;
    // 协作通信的可靠投递规则：WaitConditionSatisfied 是可路由源事件，这次提交可以同事务登记它触发的
    // 待路由 intent（账本 materializeRouteIntentPlans 补写）。允许的**只有**这一条来源：没有计划
    // 却出现 CommunicationIntentRecorded，或数量对不上，仍然是非法提交（不放宽既有形状）。
    const plannedRecorded = (batch.routeIntentPlans ?? []).length;
    const recordedCount = batch.events.filter((event) => event.eventType === "CommunicationIntentRecorded").length;
    if (recordedCount !== plannedRecorded) return false;
    if (!batch.events.every((event) =>
      identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity))) return false;
    const byType = (type: string) => batch.snapshots.filter((s) => s.ref.aggregateType === type);
    const outboxes = byType("DispatchOutboxEntry") as DispatchOutboxEntrySnapshot[];
    const waits = byType("WaitCondition") as import("../../../contracts/coordination.js").WaitConditionSnapshot[];
    const admissions = byType("CommunicationAdmission") as import("../../../contracts/coordination.js").CommunicationAdmissionSnapshot[];
    if (byType("TaskLease").length !== 1 || byType("TaskAttempt").length !== 1 || byType("Run").length !== 1) return false;
    if (outboxes.length !== 1 || waits.length !== 1 || admissions.length !== 1) return false;
    const outbox = outboxes[0]!;
    if (canonicalJson(outbox.intent as never) !== canonicalJson(batch.outboxIntents[0]! as never)) return false;
    if (outbox.status !== "pending" || outbox.revision !== 1) return false;
    const attempt = byType("TaskAttempt")[0]! as TaskAttemptSnapshot;
    const run = byType("Run")[0]! as RunSnapshot;
    const lease = byType("TaskLease")[0]! as TaskLeaseSnapshot;
    if (attempt.status !== "claimed" || attempt.revision !== 1) return false;
    if (run.status !== "starting" || run.revision !== 1 || run.envelope !== null) return false;
    if (lease.holderRunId !== run.ref.runId || lease.attemptId !== attempt.ref.attemptId) return false;
    if (canonicalJson(attempt.ref) !== canonicalJson(outbox.intent.attemptRef)) return false;
    if (canonicalJson(run.ref) !== canonicalJson(outbox.intent.runRef)) return false;
    if (canonicalJson(run.roleBinding as never) !== canonicalJson(outbox.intent.roleBinding as never)) return false;
    const wait = waits[0]!;
    const admission = admissions[0]!;
    if (wait.wait.status !== "satisfied") return false;
    if (wait.wait.satisfiedRevision === null) return false;
    if (admission.revision !== 1) return false;
    if (canonicalJson(admission.ref) !== canonicalJson(communicationAdmissionRefFor(
      wait.ref.projectId, wait.ref.workspaceId, wait.ref.waitId))) return false;
    if (canonicalJson(admission.admission.waitRef as never) !== canonicalJson(wait.ref as never)) return false;
    if (canonicalJson(admission.admission.runRef as never) !== canonicalJson(run.ref as never)) return false;
    if (canonicalJson(admission.admission.attemptRef as never) !== canonicalJson(attempt.ref as never)) return false;
    if (admission.admission.satisfiedRevision !== wait.wait.satisfiedRevision) return false;
    // 上界：快照总数 = 6 个固定 + 0..N 个 intent
    const extras = batch.snapshots.length - 6;
    if (extras < 0 || byType("CommunicationIntent").length !== extras) return false;
    return true;
  } catch {
    return false;
  }
}


export function validateSuccessorClaimState(batch: import('../../../contracts/coordination.js').CommunicationSuccessorClaimCommitV1,
  get: (ref: import('../../../contracts/ledger.js').AggregateRef) => import('../../../contracts/ledger.js').AggregateSnapshot | undefined,
  selectReport?: (wait: import('../../../contracts/coordination.js').WaitConditionSnapshot) => import('../../../contracts/alternative-report.js').AlternativeReportResult): boolean {
  // Stale CAS and exact idempotency replays are decided by the generic transaction.
  if (!batch.expectedVersions.every(v => (get(v.ref)?.revision ?? 0) === v.revision)) return true;
  const admission = batch.snapshots[5].admission;
  const oldWait = get(admission.waitRef) as import('../../../contracts/coordination.js').WaitConditionSnapshot | undefined;
  const newWait = batch.snapshots.find(s => s.ref.aggregateType === 'WaitCondition') as import('../../../contracts/coordination.js').WaitConditionSnapshot;
  if (!oldWait || oldWait.wait.mode !== newWait.wait.mode || canonicalJson(oldWait.wait.conditions) !== canonicalJson(newWait.wait.conditions)) return false;
  if(canonicalJson(oldWait.wait.architectureReview??null)!==canonicalJson(newWait.wait.architectureReview??null))return false;
  if(!architectureDeliverySetMatches(oldWait,admission.deliveryRefs))return false;
  for(const ref of admission.deliveryRefs){
    const delivery=get(ref) as import('../../../contracts/coordination.js').DeliverySnapshot|undefined;
    if(delivery?.delivery.origin.kind==='architecture_decision'){
      const review=get(delivery.delivery.origin.reviewRef) as import('../../../contracts/architecture-review.js').ArchitectureReviewSnapshot|undefined;
      if(!architectureDeliveryApplies(review,delivery,oldWait)||!batch.expectedVersions.some(v=>canonicalJson(v.ref)===canonicalJson(review!.ref)&&v.revision===review!.revision))return false;
    }
  }
  if (newWait.wait.mode === 'all' && (newWait.wait.selectedReport || admission.reportQualification)) return false;
  if (oldWait?.wait.mode === 'any') {
    const chosen = selectReport?.(oldWait);
    const nextWait = batch.snapshots.find(s => s.ref.aggregateType === 'WaitCondition') as import('../../../contracts/coordination.js').WaitConditionSnapshot;
    if (chosen?.status !== 'selected' || !admission.reportQualification) return false;
    const winner = qualifiedAlternativeReport(oldWait, chosen.candidates, admission.reportQualification, get);
    if (!winner || !nextWait.wait.selectedReport || canonicalJson(nextWait.wait.selectedReport) !== canonicalJson(winner) ||
        canonicalJson(nextWait.wait.satisfiedIndexes) !== canonicalJson([winner.conditionIndex]) ||
        canonicalJson(admission.deliveryRefs) !== canonicalJson([winner.deliveryRef])) return false;
    const guarded = (ref: import('../../../contracts/ledger.js').AggregateRef, revision: number) => batch.expectedVersions.some(v => canonicalJson(v.ref) === canonicalJson(ref) && v.revision === revision);
    const policyRef = { aggregateType: 'ProjectCoordinationPolicyActive' as const, projectId: oldWait.ref.projectId };
    const policyActive = get(policyRef) as import('../../../contracts/human-role-collaboration.js').ProjectCoordinationPolicyActiveSnapshot | undefined;
    if (!guarded(policyRef, policyActive?.revision ?? 0)) return false;
    if (policyActive) {
      const policy = get(policyActive.activeRevision) as import('../../../contracts/human-role-collaboration.js').CoordinationPolicyRevisionSnapshot | undefined;
      if (!policy || !guarded(policy.ref, policy.revision)) return false;
      const pin = policy.content.roles?.catalog[admission.roleBinding.templateId];
      if (pin) {
        const activeRef = projectRoleSpecActiveRefFor(oldWait.ref.projectId, admission.roleBinding.templateId);
        if (!guarded(pin.ref, get(pin.ref)?.revision ?? 0) || !guarded(activeRef, get(activeRef)?.revision ?? 0)) return false;
      }
    }
    for (const ref of [oldWait.wait.predecessorRunRef,
      { aggregateType: 'Workspace' as const, projectId: oldWait.ref.projectId, workspaceId: oldWait.ref.workspaceId },
      { aggregateType: 'Goal' as const, projectId: oldWait.ref.projectId, goalId: oldWait.wait.predecessorRunRef.goalId }]) {
      const snapshot = get(ref);
      if (!snapshot || !guarded(ref, snapshot.revision)) return false;
    }
    for (const [index, observation] of admission.reportQualification.observations.entries()) {
      const candidate = chosen.candidates[index]!;
      if (!guarded(observation.grantRef, observation.grantRevision) || !guarded(candidate.delivery.ref, candidate.delivery.revision) || !guarded(candidate.request.ref, candidate.request.revision)) return false;
    }
  }
  const ref = communicationIntentRefFor(admission.waitRef.projectId, admission.waitRef.workspaceId,
    waitAdmissionIntentIdFor(admission.waitRef.waitId, admission.satisfiedRevision));
  const prior = get(ref) as import('../../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
  const version = batch.expectedVersions.find(v => canonicalJson(v.ref) === canonicalJson(ref));
  if (!version || version.revision !== (prior?.revision ?? 0)) return false;
  if (!prior) return true;
  const next = batch.snapshots.find(s => canonicalJson(s.ref) === canonicalJson(ref));
  const at = batch.events[0].occurredAt;
  return prior.intent.status === 'leased' && !prior.intent.sideEffectStarted && prior.intent.leaseOwner === batch.identity.actor.id &&
    !!prior.intent.leaseExpiresAt && prior.intent.leaseExpiresAt > at &&
    !!next && canonicalJson(next) === canonicalJson({ ...prior, revision: prior.revision + 1, recordedAt: at, intent: { ...prior.intent, status: 'done', settledAt: at } });
}
