/** Internal StateLedger run-facts rules. Both adapters invoke these inside their commit protocol. */
import type { AggregateRef, AggregateSnapshot } from '../../../contracts/ledger.js';
import { nextRunSnapshotForRuntimeEvent, nextRunSnapshotForOutcomeUnknown, nextAttemptSnapshotForTerminal, nextOutboxSnapshotForTerminal } from '../../../contracts/run-lifecycle-fold.js';
import { foldRunReconciliation } from '../../../contracts/run-reconciliation.js';
import { executionRetryState } from '../../../contracts/execution-authorization.js';
import { runtimeInputMaterialGuards } from '../../../contracts/runtime-input-authorization.js';

import type { RunFactLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot } from "../../../contracts/dispatch.js";
import { isTerminalRuntimeEvent } from "../../../contracts/dispatch.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { identityMatchesActor } from './batch-identity.js';


// ------------------------------------------------------------------------ //
// run-fact (dispatch)                                                           //
// ------------------------------------------------------------------------ //

export function validateRunFactCommit(batch: RunFactLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;

  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const event0 = batch.events[0]!;
  if (event0.eventType === 'RunReconciled') {
    const next = event0.payload.run;
    if (!next.reconciliation || batch.identity.actor.kind !== 'system' || event0.aggregateId !== next.ref.runId || event0.aggregateRevision !== next.revision ||
        canonicalJson(batch.snapshots[0]!) !== canonicalJson(next) || event0.workspaceId !== next.workspaceSnapshot.workspaceId ||
        !identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity)) return false;
    if (batch.snapshots.length !== (next.reconciliation.observation.kind === 'runtime_terminal' ? 2 : 1) || batch.expectedVersions.length !== batch.snapshots.length) return false;
    return batch.snapshots.every(s => batch.expectedVersions.filter(v => canonicalJson(v.ref) === canonicalJson(s.ref) && v.revision === s.revision - 1).length === 1);
  }
  if (event0.eventType === 'ExecutionEntered' || event0.eventType === 'ExecutionRetryScheduled') {
    if (!run || batch.identity.actor.kind !== 'system' || event0.aggregateId !== run.ref.runId || event0.aggregateRevision !== run.revision ||
        !identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity)) return false;
    if (batch.snapshots.length !== (event0.eventType === 'ExecutionEntered' ? 1 : 3) || batch.expectedVersions.length !== batch.snapshots.length) return false;
    return batch.snapshots.every(s => batch.expectedVersions.filter(v => canonicalJson(v.ref) === canonicalJson(s.ref) && v.revision === s.revision - 1).length === 1);
  }
  if (event0.eventType === 'DispatchDeferred') {
    const outbox = batch.snapshots[0] as DispatchOutboxEntrySnapshot;
    if (batch.snapshots.length !== 1 || outbox.ref.aggregateType !== 'DispatchOutboxEntry' ||
        batch.expectedVersions.length !== 2 || outbox.status !== 'pending' || !outbox.schedule ||
        outbox.revision < 2 || event0.aggregateRevision !== outbox.revision || event0.aggregateId !== outbox.ref.attemptId ||
        canonicalJson(event0.payload.outbox) !== canonicalJson(outbox) ||
        canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(outbox.intent.runRef) ||
        canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(outbox.ref) ||
        batch.expectedVersions[1]!.revision !== outbox.revision - 1) return false;
    if (!Number.isInteger(outbox.schedule.attemptCount) || outbox.schedule.attemptCount < 1 ||
        !Number.isFinite(Date.parse(outbox.schedule.availableAt)) || !outbox.schedule.lastFailure) return false;
    return identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity);
  }
  if (event0.eventType === "ModelRequestAuthorized" || event0.eventType === "ModelRequestEvidenceRecorded") {
    /**
     * 模型调用证据：记录许可签发与**一次**调用尝试。
     *
     * 这两条事实**只**写许可聚合，**不**写 Run 快照、**不**推进 Run 的 revision：
     *   · 它们不是 Run 的生命周期事件，因此不污染 RuntimeEventType；
     *   · 更重要的是，Run 的 revision 序列是**多个消费者**（ordinary drive / handoff drive /
     *     workspace drive / reviewer）共用的单写者 CAS 计数器，任何非生命周期提交去推进它，
     *     都会让按既有序列读取的消费者 revision_conflict，从而丢掉这个 Run 的终态事实。
     *   · Run 侧的准入（exact Run、未结束、信封存在）由 **Control** 的 authorizeModelRequest
     *     在同一次调用里判定；账本负责的是**许可聚合自己的 CAS**。
     *
     * 「一次许可只能对应一次尝试」因此仍由**账本**保证：许可只有 @1（已签发）与 @2（已尝试）
     * 两态，第二次尝试提交 expectedVersions=[Permit@1] 时当前已是 @2，CAS 失败 → 提交被拒。
     */
    const permitSnapshot = batch.snapshots.find(
      (s): s is import("../../../contracts/dispatch.js").ModelRequestPermitSnapshot => s.ref.aggregateType === "ModelRequestPermit",
    );
    if (permitSnapshot === undefined) return false;
    if (batch.snapshots.length !== 1) return false;
    if (batch.expectedVersions.length < 3) return false;
    const policyGuard = batch.expectedVersions.filter(v => v.ref.aggregateType === 'ProjectCoordinationPolicyActive' && v.ref.projectId === permitSnapshot.permit.runRef.projectId);
    if (policyGuard.length !== 1) return false;
    if (new Set(batch.expectedVersions.map(v => canonicalJson(v.ref))).size !== batch.expectedVersions.length) return false;
    const runGuard = batch.expectedVersions.filter(v => canonicalJson(v.ref) === canonicalJson(permitSnapshot.permit.runRef));
    if (runGuard.length !== 1 || runGuard[0]!.revision < 2) return false;
    if (!permitSnapshot.permit.requestId || !/^[0-9a-f]{64}$/.test(permitSnapshot.permit.requestDigest ?? '') ||
        !/^[0-9a-f]{64}$/.test(permitSnapshot.permit.contextInputDigest ?? '') ||
        !/^[0-9a-f]{64}$/.test(permitSnapshot.permit.manifestDigest ?? '')) return false;
    if (event0.aggregateType !== "ModelRequestPermit") return false;
    if (event0.aggregateId !== permitSnapshot.ref.permitId) return false;
    if (event0.aggregateRevision !== permitSnapshot.revision) return false;
    if (permitSnapshot.schemaVersion !== 1) return false;
    if (canonicalJson(permitSnapshot.permit as never) !== canonicalJson((event0.payload as { permit: unknown }).permit as never)) return false;
    const permitExpected = batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(permitSnapshot.ref as never));
    if (permitExpected.length !== 1) return false;
    if (permitSnapshot.revision !== permitExpected[0]!.revision + 1) return false;
    if (event0.eventType === "ModelRequestAuthorized") {
      if (permitSnapshot.revision !== 1 || permitExpected[0]!.revision !== 0) return false;
      if (permitSnapshot.permit.consumedByAttemptId !== null || permitSnapshot.permit.consumedAt !== null) return false;
    } else {
      const evidence = (event0.payload as { evidence: import("../../../contracts/dispatch.js").ModelRequestEvidenceV1 }).evidence;
      if (permitSnapshot.revision !== 2 || permitExpected[0]!.revision !== 1) return false;
      if (evidence.permitId !== permitSnapshot.permit.permitId) return false;
      if (permitSnapshot.permit.consumedByAttemptId !== evidence.attemptId) return false;
      if (permitSnapshot.permit.consumedAt === null) return false;
      if (canonicalJson(evidence.deliveryRefs as never) !== canonicalJson(permitSnapshot.permit.deliveryRefs as never)) return false;
      if (!/^[0-9a-f]{64}$/.test(evidence.requestDigest)) return false;
      if (evidence.requestDigest !== permitSnapshot.permit.requestDigest || evidence.contextInputDigest !== permitSnapshot.permit.contextInputDigest || evidence.attemptId !== permitSnapshot.permit.requestId) return false;
    }
    return identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity);
  }
  if (run === undefined) return false;
  if (event.aggregateType !== "Run" || event.aggregateId !== run.ref.runId) return false;
  if (event.aggregateRevision !== run.revision) return false;
  if (run.schemaVersion !== 1) return false;

  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const terminal = event.eventType === "RunOutcomeUnknown" || (event.eventType === "RunEventRecorded" && isTerminalRuntimeEvent(event.payload.runtimeEvent));

  if (!terminal) {
    if (batch.snapshots.length !== 1) return false;
    if (attempt !== undefined || outbox !== undefined) return false;
    if (event.eventType !== 'RuntimeInputBound' && batch.expectedVersions.length !== 1) return false;
    if (batch.expectedVersions[0]!.revision !== run.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(run.ref)) return false;
    if (event.eventType !== "RunEventRecorded" && event.eventType !== 'RuntimeInputBound') return false;
    if (event.eventType === 'RuntimeInputBound' && (!run.inputBinding ||
        canonicalJson(run.inputBinding) !== canonicalJson(event.payload.binding) ||
        !/^[0-9a-f]{64}$/.test(run.inputBinding.inputDigest) || !/^[0-9a-f]{64}$/.test(run.inputBinding.manifestDigest))) return false;
    if (run.outcome !== null || run.endedAt !== null) return false;
    if (run.exitCode !== null) return false;
  } else {
    if (batch.snapshots.length !== 3) return false;
    if (attempt === undefined || outbox === undefined) return false;
    if (batch.expectedVersions.length !== 3) return false;
    if (attempt.schemaVersion !== 1 || outbox.schemaVersion !== 1) return false;
    if (!Number.isInteger(attempt.revision) || attempt.revision < 2) return false;
    if (outbox.revision < 2) return false;
    if (batch.expectedVersions[0]!.revision !== run.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(run.ref)) return false;
    if (batch.expectedVersions[1]!.revision !== attempt.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(attempt.ref)) return false;
    if (batch.expectedVersions[2]!.revision !== outbox.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[2]!.ref) !== canonicalJson(outbox.ref)) return false;
    if (attempt.endedAt === null || attempt.endOutcome === null) return false;
    if (outbox.status !== "done" || outbox.doneAt === null) return false;
  }

  if (event.eventType === "RunEventRecorded") {
    const rt = event.payload.runtimeEvent;
    if (rt.schemaVersion !== 1) return false;
    if (canonicalJson(rt.runRef) !== canonicalJson(run.ref)) return false;
    if (event.payload.taskId !== run.task.taskId) return false;
    if (rt.sequence !== run.lastEventSeq) return false;
    if (rt.eventId !== run.lastRuntimeEventId) return false;
    if (event.eventId !== run.lastFactEventId) return false;
    if (terminal) {
      if (run.status !== "ended" || run.outcome === null) return false;
      if (run.endedAt !== rt.occurredAt) return false;
      if (rt.payload.kind === "completed") {
        if (run.exitCode !== rt.payload.exitCode) return false;
      } else {
        if (run.exitCode !== null) return false;
      }
    } else {
      if (run.status !== "running" || run.outcome !== null || run.endedAt !== null) return false;
      if (run.exitCode !== null) return false;
    }
  } else if (event.eventType === "RunOutcomeUnknown") {
    if (run.status !== "ended" || run.outcome !== "outcome_unknown") return false;
    if (run.endedAt !== event.payload.observedAt) return false;
    if (run.exitCode !== null) return false;
    if (attempt?.endOutcome !== "outcome_unknown") return false;
    if (attempt?.endedAt !== event.payload.observedAt) return false;
  } else if (event.eventType === 'RuntimeInputBound') {
    if (!run.inputBinding || run.status === 'ended') return false;
  } else {
    return false;
  }

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}


/** Cross-check persisted facts inside the transaction, in addition to batch
 * shape and CAS. A direct commit cannot change the pinned input or consume a
 * different permit body by merely keeping the same revision. */
export function validateRunFactState(batch: RunFactLedgerCommitV1,
  get: (ref: import('../../../contracts/ledger.js').AggregateRef) => import('../../../contracts/ledger.js').AggregateSnapshot | undefined): boolean {
  const event = batch.events[0];
  if (event?.eventType === 'RunReconciled') {
    const next = event.payload.run, prior = get(next.ref) as RunSnapshot | undefined;
    if (!prior || !next.reconciliation) return false;
    const expected = foldRunReconciliation(prior, next.reconciliation.observation, event.occurredAt);
    if (!expected || canonicalJson(expected) !== canonicalJson(next)) return false;
    if (batch.snapshots.length === 2) {
      const attempt = batch.snapshots[1] as TaskAttemptSnapshot, pa = get(attempt.ref) as TaskAttemptSnapshot | undefined;
      if (!pa || pa.runId !== prior.ref.runId || pa.endOutcome !== 'outcome_unknown' || pa.ref.attemptId !== prior.attemptId ||
          canonicalJson(attempt) !== canonicalJson({ ...pa, revision: pa.revision + 1, endOutcome: next.outcome, endedAt: next.endedAt })) return false;
    }
    return true;
  }
  if (event?.eventType === 'ExecutionEntered') {
    const next = batch.snapshots[0] as RunSnapshot, prior = get(next.ref) as RunSnapshot | undefined;
    if (!prior || prior.status !== 'running' || !prior.envelope || prior.executionAuthorization?.phase !== 'authorized' ||
        prior.controlState?.desiredState === 'cancelled' || prior.controlState?.desiredState === 'paused' ||
        prior.executionAuthorization.consumerId !== event.actor.id) return false;
    return canonicalJson(next) === canonicalJson({ ...prior, revision: prior.revision + 1,
      executionAuthorization: { ...prior.executionAuthorization, phase: 'entered' } }) && canonicalJson(event.payload.authorization) === canonicalJson(next.executionAuthorization!);
  }
  if (event?.eventType === 'ExecutionRetryScheduled') {
    const { run, attempt, outbox, reason } = event.payload;
    const previous = get(run.ref) as RunSnapshot | undefined, pa = get(attempt.ref) as TaskAttemptSnapshot | undefined, po = get(outbox.ref) as DispatchOutboxEntrySnapshot | undefined;
    if (!previous || !pa || !po) return false;
    const expected = executionRetryState(previous, pa, po, reason, event.occurredAt);
    return !!expected && canonicalJson(expected) === canonicalJson({ run, attempt, outbox }) && canonicalJson(batch.snapshots) === canonicalJson([run, attempt, outbox]);
  }
  if (event?.eventType === 'DispatchDeferred') {
    const next = event.payload.outbox;
    const previous = get(next.ref) as DispatchOutboxEntrySnapshot | undefined;
    const run = get(next.intent.runRef) as RunSnapshot | undefined;
    if (!previous || !run || run.envelope || run.status !== 'starting' || previous.status !== 'pending' || previous.schedule?.quarantined ||
        next.schedule?.attemptCount !== (previous.schedule?.attemptCount ?? 0) + 1) return false;
    return canonicalJson(next) === canonicalJson({ ...previous, revision: previous.revision + 1, schedule: next.schedule });
  }
  if (event?.eventType === 'RuntimeInputBound') {
    const next = batch.snapshots[0] as RunSnapshot;
    const previous = get(next.ref) as RunSnapshot | undefined;
    if (!previous || previous.status === 'ended' || previous.inputBinding || !previous.envelope || (previous.executionAuthorization && previous.executionAuthorization.phase !== 'entered')) return false;
    const guards = runtimeInputMaterialGuards(previous, event.payload.binding, get);
    if (!guards || !guards.every(guard => batch.expectedVersions.some(v => canonicalJson(v) === canonicalJson(guard)))) return false;
    return canonicalJson(next) === canonicalJson({ ...previous, revision: previous.revision + 1, inputBinding: event.payload.binding });
  }
  if (event?.eventType === 'RunEventRecorded' || event?.eventType === 'RunOutcomeUnknown') {
    const next = batch.snapshots[0] as RunSnapshot, prior = get(next.ref) as RunSnapshot | undefined;
    if (!prior || prior.status === 'ended') return false;
    let expected: RunSnapshot;
    if (event.eventType === 'RunEventRecorded') {
      const rt = event.payload.runtimeEvent;
      if (rt.sequence <= prior.lastEventSeq || (prior.executionAuthorization && prior.executionAuthorization.phase !== 'entered' &&
          !(rt.eventType === 'run_cancelled' && prior.controlState?.desiredState === 'cancelled'))) return false;
      expected = nextRunSnapshotForRuntimeEvent({ ...prior, revision: prior.revision + 1 }, rt);
      expected.lastFactEventId = event.eventId;
    } else expected = nextRunSnapshotForOutcomeUnknown({ ...prior, revision: prior.revision + 1 }, { observedAt: event.payload.observedAt });
    if (canonicalJson(next) !== canonicalJson(expected)) return false;
    if (next.status === 'ended') {
      const attempt = batch.snapshots[1] as TaskAttemptSnapshot, outbox = batch.snapshots[2] as DispatchOutboxEntrySnapshot;
      const pa = get(attempt.ref) as TaskAttemptSnapshot | undefined, po = get(outbox.ref) as DispatchOutboxEntrySnapshot | undefined;
      if (!pa || !po || pa.runId !== prior.ref.runId || canonicalJson(po.intent.runRef) !== canonicalJson(prior.ref)) return false;
      if (canonicalJson(attempt) !== canonicalJson(nextAttemptSnapshotForTerminal(pa, next.outcome!, next.endedAt!)) ||
          canonicalJson(outbox) !== canonicalJson(nextOutboxSnapshotForTerminal(po, next.endedAt!))) return false;
    }
    return true;
  }
  if (event?.eventType !== 'ModelRequestAuthorized' && event?.eventType !== 'ModelRequestEvidenceRecorded') return true;
  const permit = event.payload.permit;
  const run = get(permit.runRef) as RunSnapshot | undefined;
  if (!run?.inputBinding || !run.envelope || (run.executionAuthorization && run.executionAuthorization.phase !== 'entered') || run.status === 'ended' || run.controlState?.desiredState === 'cancelled' || run.controlState?.desiredState === 'paused') return false;
  const guards = runtimeInputMaterialGuards(run, run.inputBinding, get);
  if (!guards || !guards.every(guard => batch.expectedVersions.some(v => canonicalJson(v) === canonicalJson(guard)))) return false;
  if (permit.contextInputDigest !== run.inputBinding.inputDigest || permit.manifestDigest !== run.inputBinding.manifestDigest ||
      canonicalJson(permit.deliveryRefs) !== canonicalJson(run.inputBinding.deliveryRefs) ||
      canonicalJson(permit.permissions) !== canonicalJson({ tools: run.envelope.permissions.tools, writeScope: run.envelope.permissions.writeScope })) return false;
  if (event.eventType === 'ModelRequestEvidenceRecorded') {
    const previous = get(batch.snapshots[0]!.ref) as import('../../../contracts/dispatch.js').ModelRequestPermitSnapshot | undefined;
    if (!previous || previous.revision !== 1 || previous.permit.consumedByAttemptId !== null) return false;
    if (canonicalJson(permit) !== canonicalJson({ ...previous.permit, consumedByAttemptId: event.payload.evidence.attemptId, consumedAt: event.payload.evidence.observedAt })) return false;
  }
  return true;
}
