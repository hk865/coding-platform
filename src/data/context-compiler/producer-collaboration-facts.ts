import type { StateLedger, AggregateRef, AggregateSnapshot } from '../../contracts/ledger.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { DeliverySnapshot } from '../../contracts/coordination.js';
import type { ArchitectureReviewSnapshot } from '../../contracts/architecture-review.js';
import type { WorkContextBindingSnapshot } from '../../contracts/context-continuity.js';
import type { MaterialAccessGrantSnapshot, SourceApplicabilityPort } from '../../contracts/material-access.js';
import { runtimeInputMaterialGuards } from '../../contracts/runtime-input-authorization.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';

const json = (v: unknown) => canonicalJson(v as JsonValue);
function ensure(v: unknown, message: string): asserts v { if (!v) throw Error(message); }

/** Independent canonical corroboration of decisions in this producer's bound
 * input and formal ArchitectureReviews reported by this exact Run.
 * No mailbox scan, private input copy, new grant or semantic acceptance is performed. */
export async function producerCollaborationFacts(ledger: StateLedger, source: SourceApplicabilityPort | undefined, run: RunSnapshot, signal?: AbortSignal): Promise<JsonValue | undefined> {
  signal?.throwIfAborted();
  const binding = run.inputBinding;
  if (!binding) return undefined; // Historical input absence is not fabricated into evidence.
  ensure(run.envelope && Array.isArray(binding.deliveryRefs) && binding.deliveryRefs.length <= 64, 'Producer delivery binding is invalid');
  const captured = new Map<string, AggregateSnapshot>();
  const load = async (ref: AggregateRef) => {
    signal?.throwIfAborted();
    const key = json(ref), prior = captured.get(key);
    if (prior) return prior;
    const loaded = await ledger.load(ref);
    signal?.throwIfAborted();
    ensure(loaded.status === 'found' && json(loaded.snapshot.ref) === key, 'Producer collaboration fact is unavailable');
    captured.set(key, loaded.snapshot); return loaded.snapshot;
  };
  const deliveries: DeliverySnapshot[] = [], inputDeliveries: Array<object> = [];
  for (const ref of binding.deliveryRefs) {
    ensure(ref.aggregateType === 'Delivery' && ref.projectId === run.ref.projectId && ref.workspaceId === run.envelope.workspaceId, 'Producer delivery belongs to another scope');
    const entry = await load(ref) as DeliverySnapshot;
    ensure(entry.schemaVersion === 1 && entry.revision === 1 && entry.delivery.schemaVersion === 1 &&
      json(entry.ref) === json(ref) && entry.delivery.deliveryId === ref.deliveryId &&
      entry.delivery.projectId === ref.projectId && entry.delivery.workspaceId === ref.workspaceId &&
      entry.delivery.targetWorkContextRef.projectId === ref.projectId && entry.delivery.targetWorkContextRef.workspaceId === ref.workspaceId &&
      Array.isArray(entry.delivery.sourceRefs) && typeof entry.delivery.createdAt === 'string', 'Producer input Delivery is invalid');
    inputDeliveries.push({ ref: entry.ref, origin: entry.delivery.origin, targetWorkContextRef: entry.delivery.targetWorkContextRef,
      bodyRef: entry.delivery.bodyRef, sourceRefs: entry.delivery.sourceRefs, createdAt: entry.delivery.createdAt });
    if (entry.delivery.origin.kind === 'architecture_decision') deliveries.push(entry);
  }
  ensure(json(await load(run.ref)) === json(run), 'Producer Run changed during collaboration capture');
  const reportedReviews: Array<{ recorded: object; current: object }> = [];
  let cursor: import('../../contracts/command-event.js').CommitCursor | null = null;
  for (;;) {
    signal?.throwIfAborted();
    const page = await ledger.events({ afterCursor: cursor, limit: 500 });
    signal?.throwIfAborted();
    for (const { event } of page.events) {
      if (event.eventType !== 'ArchitectureReviewRecorded' || event.projectId !== run.ref.projectId || event.workspaceId !== run.envelope.workspaceId || event.payload.action !== 'open') continue;
      const recorded = event.payload.snapshot;
      if (json(recorded.reporterRunRef) !== json(run.ref)) continue;
      ensure(recorded.status === 'pending' && recorded.decisionRef === null, 'Producer ArchitectureReview opening state is invalid');
      const current = await load(recorded.ref) as ArchitectureReviewSnapshot;
      ensure(json(current.ref) === json(recorded.ref) && json(current.reporterRunRef) === json(run.ref) && current.revision >= recorded.revision,
        'Producer ArchitectureReview no longer matches its reporter');
      reportedReviews.push({
        recorded: { ref: recorded.ref, revision: recorded.revision, reporterRunRef: recorded.reporterRunRef, status: recorded.status,
          proposalDigest: recorded.proposalDigest, targets: recorded.targets, summary: recorded.summary, recordedAt: recorded.recordedAt },
        current: { ref: current.ref, revision: current.revision, reporterRunRef: current.reporterRunRef, status: current.status,
          proposalDigest: current.proposalDigest, decisionRef: current.decisionRef, targets: current.targets, summary: current.summary, recordedAt: current.recordedAt },
      });
      ensure(reportedReviews.length <= 64, 'Producer reported too many ArchitectureReviews');
    }
    if (!page.hasMore) break;
    ensure(page.throughCursor !== cursor, 'Producer ArchitectureReview event cursor did not advance');
    cursor = page.throughCursor;
  }
  if (!inputDeliveries.length && !reportedReviews.length) return undefined;
  if (deliveries.length) {
    ensure(source, 'Producer collaboration source capability is unavailable');
    ensure(Array.isArray(binding.materialAccessRefs) && binding.materialAccessRefs.length <= 64, 'Producer grants are unavailable');
    for (const ref of binding.materialAccessRefs) await load(ref);
    ensure(runtimeInputMaterialGuards(run, binding, ref => captured.get(json(ref))), 'Producer collaboration grants are stale, revoked or incomplete');
    for (const ref of binding.materialAccessRefs) {
      const grant = (await load(ref) as MaterialAccessGrantSnapshot).grant, pin = grant.basis.sourcePin!;
      const current = await source.capture({ projectId: pin.projectId, workspaceId: pin.workspaceId, sourceSet: pin.sourceSet }, signal);
      signal?.throwIfAborted();
      ensure(current.status === 'sourced' && json(current.pin) === json(pin), 'Producer collaboration source has changed');
    }
  }
  const decisions = [];
  for (const delivery of deliveries) {
    const origin = delivery.delivery.origin;
    ensure(origin.kind === 'architecture_decision', 'Decision origin changed');
    const review = await load(origin.reviewRef) as ArchitectureReviewSnapshot;
    ensure(review.ref.projectId === run.ref.projectId && review.ref.workspaceId === run.envelope.workspaceId &&
      review.revision === origin.reviewRevision && review.status !== 'pending' && review.decisionRef &&
      json(review.bodyRef) === json(delivery.delivery.bodyRef) &&
      json(review.targets[origin.targetIndex]?.ref) === json(delivery.delivery.targetWorkContextRef), 'Delivered architecture decision is stale or has a different target');
    const recipient = await load(delivery.delivery.targetWorkContextRef) as WorkContextBindingSnapshot;
    ensure(recipient.binding.goalId === run.ref.goalId && recipient.binding.taskId === run.task.taskId &&
      json(recipient.binding.planRef) === json(run.planRef) && recipient.binding.linkedRunRefs.some(ref => json(ref) === json(run.ref)), 'Decision was not bound to this producer Work');
    const works = [];
    for (const target of review.targets) {
      ensure(target.ref.projectId === run.ref.projectId && target.ref.workspaceId === run.envelope.workspaceId, 'Decision Work crosses workspace scope');
      const work = await load(target.ref) as WorkContextBindingSnapshot;
      ensure(work.binding.workId === target.ref.workId && work.binding.projectId === target.ref.projectId && work.binding.workspaceId === target.ref.workspaceId, 'Canonical Work identity differs');
      works.push({ ref: work.ref, bindingRevision: work.revision, goalId: work.binding.goalId, taskId: work.binding.taskId, mode: target.mode, decisionTargetRevision: target.revision });
    }
    decisions.push({ deliveryRef: delivery.ref, recipientWorkRef: recipient.ref,
      review: { ref: review.ref, revision: review.revision, status: review.status, proposalDigest: review.proposalDigest,
        decisionRef: review.decisionRef, summary: review.summary, proposalContent: review.proposalContent, recordedAt: review.recordedAt }, works });
  }
  const facts = { schemaVersion: 1, kind: 'producer-collaboration-facts', producerRunRef: run.ref, inputDigest: binding.inputDigest, inputDeliveries, decisions, reportedReviews,
    authority: 'inputDeliveries is the complete bounded Delivery set bound to this Run input. Canonical decisions delivered to this Run and ArchitectureReviews reported by this Run are separate. A reported review and its later current status are not received by this Run as a decision. Work participants are not source-code consumers. These facts do not activate a baseline, prove source behavior or satisfy verification.' };
  ensure(Buffer.byteLength(json(facts), 'utf8') <= 128 * 1024, 'Producer collaboration facts exceed bounded capacity');
  for (const original of captured.values()) {
    signal?.throwIfAborted();
    const current = await ledger.load(original.ref);
    signal?.throwIfAborted();
    ensure(current.status === 'found' && json(current.snapshot) === json(original), 'Producer collaboration facts changed during capture');
  }
  if (deliveries.length) {
    for (const ref of binding.materialAccessRefs) {
      const pin = (captured.get(json(ref)) as MaterialAccessGrantSnapshot).grant.basis.sourcePin!;
      const current = await source!.capture({ projectId: pin.projectId, workspaceId: pin.workspaceId, sourceSet: pin.sourceSet }, signal);
      signal?.throwIfAborted();
      ensure(current.status === 'sourced' && json(current.pin) === json(pin), 'Producer collaboration source changed during capture');
    }
  }
  return facts as JsonValue;
}
