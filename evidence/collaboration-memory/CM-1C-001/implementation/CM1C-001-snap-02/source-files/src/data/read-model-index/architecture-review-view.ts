import type { StateLedger } from '../../contracts/ledger.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { DomainEvent } from '../../contracts/events.js';
import type { ArchitectureReviewRef, ArchitectureReviewSnapshot, ArchitectureReviewView } from '../../contracts/architecture-review.js';
import { architectureReviewDeliveryId } from '../../contracts/architecture-review.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { deliveryRefFor, communicationAdmissionRefFor, type DeliverySnapshot, type CommunicationAdmissionSnapshot } from '../../contracts/coordination.js';
import type { ArchitectureCandidateProposalSnapshot, ArchitectureDecisionBriefSnapshot } from '../../contracts/architecture-inspection.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
/** Read every recorded target, then derive progress from canonical delivery/admission/input facts. */
async function readArchitectureReviewView(ledger: Pick<StateLedger, 'load' | 'events'>, scope: {
    projectId: string;
    workspaceId: string;
}): Promise<ArchitectureReviewView> {
    const refs = new Map<string, ArchitectureReviewRef>(), attempts: Extract<DomainEvent, {
        eventType: 'ModelRequestEvidenceRecorded';
    }>[] = [];
    const reportSummaries = new Map<string, string>();
    let cursor: CommitCursor | null = null, complete = false;
    for (let i = 0; i < 200; i++) {
        const page = await ledger.events({ afterCursor: cursor, limit: 1000 });
        for (const { event, cursor: position } of page.events) {
            cursor = position;
            if (event.projectId !== scope.projectId || !('workspaceId' in event) || event.workspaceId !== scope.workspaceId)
                continue;
            if (event.eventType === 'ArchitectureReviewRecorded') {
                const key = canonicalJson(event.payload.snapshot.ref);
                refs.set(key, event.payload.snapshot.ref);
                if (event.payload.action === 'open')
                    reportSummaries.set(key, event.payload.snapshot.summary);
            }
            if (event.eventType === 'ModelRequestEvidenceRecorded')
                attempts.push(event);
        }
        if (!page.hasMore) {
            complete = true;
            break;
        }
    }
    if (!complete || refs.size > 64)
        throw Error('Architecture review history exceeds view capacity; no partial result returned');
    const rows: ArchitectureReviewView['rows'] = [];
    for (const ref of refs.values()) {
        const loaded = await ledger.load(ref);
        if (loaded.status !== 'found')
            throw Error('Recorded architecture review is missing');
        const review = loaded.snapshot as ArchitectureReviewSnapshot;
        const p = await ledger.load(review.proposalRef), b = await ledger.load(review.briefRef);
        if (p.status !== 'found' || b.status !== 'found')
            throw Error('Architecture review source is missing');
        const targets: ArchitectureReviewView['rows'][number]['targets'] = [];
        for (const target of review.targets) {
            const row: typeof targets[number] = { workId: target.ref.workId, mode: target.mode, stage: 'pending', reason: review.status === 'pending' ? (target.mode === 'resume' ? '该方案等待人的决定；现行规范仍有效' : '独立工作可按现行规范继续') : '等待投递', runId: null, requestDigest: null };
            const d = await ledger.load(deliveryRefFor(ref.projectId, ref.workspaceId, architectureReviewDeliveryId(ref, review.revision, target.ref)));
            if (d.status === 'found') {
                const delivery = (d.snapshot as DeliverySnapshot).delivery;
                row.stage = 'delivered';
                row.reason = '已通知';
                const continuation = delivery.continuation;
                if (continuation?.status === 'unavailable') {
                    row.stage = 'failed';
                    row.reason = continuation.reason;
                }
                if (continuation?.waitRef) {
                    row.stage = 'waiting';
                    row.reason = '等待前驱结束及当前接续守卫';
                    const admissionResult = await ledger.load(communicationAdmissionRefFor(ref.projectId, ref.workspaceId, continuation.waitRef.waitId));
                    if (admissionResult.status === 'found') {
                        const admission = (admissionResult.snapshot as CommunicationAdmissionSnapshot).admission;
                        row.runId = admission.runRef.runId;
                        const r = await ledger.load(admission.runRef);
                        if (r.status === 'found') {
                            const run = r.snapshot as RunSnapshot;
                            const binding = run.inputBinding;
                            if (binding?.deliveryRefs.some(pin => canonicalJson(pin) === canonicalJson(d.snapshot.ref))) {
                                row.stage = 'bound';
                                row.reason = '后继输入已绑定本次决定';
                            }
                            const attempted = attempts.find(e => canonicalJson(e.payload.permit.runRef) === canonicalJson(admission.runRef) && e.payload.evidence.contextInputDigest === binding?.inputDigest && e.payload.evidence.deliveryRefs.some(pin => canonicalJson(pin) === canonicalJson(d.snapshot.ref)));
                            if (attempted) {
                                row.stage = 'attempted';
                                row.reason = '实际模型调用已尝试采用该输入';
                                row.requestDigest = attempted.payload.evidence.requestDigest;
                            }
                            else if (run.status === 'ended' || run.outcome === 'outcome_unknown') {
                                row.stage = 'failed';
                                row.reason = '运行已结束或结果未知，尚无本次决定的调用采用证据';
                            }
                        }
                    }
                }
            }
            targets.push(row);
        }
        rows.push({ review, reportSummary: reportSummaries.get(canonicalJson(ref)) ?? '原始报告不可读', brief: (b.snapshot as ArchitectureDecisionBriefSnapshot).brief, proposal: (p.snapshot as ArchitectureCandidateProposalSnapshot).proposal, targets, allNotified: review.status !== 'pending' && targets.every(t => t.stage !== 'pending'), allRequiredAttempted: review.status !== 'pending' && targets.some(t => t.mode === 'resume') && targets.filter(t => t.mode === 'resume').every(t => t.stage === 'attempted') });
    }
    return { observedCursor: cursor, rows: rows.sort((a, b) => b.review.recordedAt.localeCompare(a.review.recordedAt)) };
}
/** A concurrent model attempt must never become a false terminal failure in a mixed view. */
export async function architectureReviewView(ledger: Pick<StateLedger, 'load' | 'events'>, scope: {
    projectId: string;
    workspaceId: string;
}): Promise<ArchitectureReviewView> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const view = await readArchitectureReviewView(ledger, scope);
        const tail = await ledger.events({ afterCursor: view.observedCursor, limit: 1 });
        if (tail.events.length === 0 && !tail.hasMore)
            return view;
    }
    throw Error('架构决定事实正在变化；请重试获取一致进度');
}
