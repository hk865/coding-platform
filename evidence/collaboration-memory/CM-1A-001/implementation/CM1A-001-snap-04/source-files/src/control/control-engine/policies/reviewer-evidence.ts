import type { EvidenceV1 } from '../../../contracts/evidence.js';
import { requirementKeyOf } from '../../../contracts/evidence.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { ReviewProjectionFacts } from '../../../contracts/read-model.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(a as never) === canonicalJson(b as never);
/** Pure review qualification over observed canonical facts. A missing projection
 * cannot manufacture a PASS; historical rows are still returned by the view. */
export function qualifyProjectedReviewEvidence(evidence: EvidenceV1[], plan: PlanRevisionSnapshot, facts?: ReviewProjectionFacts): EvidenceV1[] {
  const positive: EvidenceV1[] = [], negative: EvidenceV1[] = [];
  for (const e of evidence) {
    const adopted = plan.reviewAdmissionProtocol === 'independent-review-v1' || facts?.protocols.some(p => p.ref.projectId === e.subject.projectId && p.ref.goalId === e.subject.goalId && p.ref.taskId === e.subject.taskId && p.ref.planId === plan.planId);
    if (!adopted) { positive.push(e); continue; }
    const keys = new Set(plan.obligations.filter(o => o.taskIds.includes(e.subject.taskId)).flatMap(o => o.verificationRequirements.filter(v => v.kind === 'reviewer').map(v => requirementKeyOf({ obligationId: o.obligationId, requirementId: v.requirementId }))));
    if (!e.coverage.some(c => keys.has(requirementKeyOf(c))) || e.kind === 'claim') { positive.push(e); continue; }
    if (e.outcome !== 'PASS') { negative.push(e); continue; }
    const admission = e.reviewAdmission, work = facts?.works.find(w => same(w.ref, admission?.workRef)), result = facts?.results.find(r => same(r.ref, admission?.resultRef)), run = facts?.runs.find(r => same(r.ref, work?.reviewerRunRef));
    const protocol = facts?.protocols.find(p => same(p.ref, work?.protocolRef));
    const valid = admission?.protocol === 'independent-review-v1' && work && result && run && protocol && (protocol.workRefs ?? [protocol.firstWorkRef]).some(ref => same(ref, work.ref)) && same(protocol.planRef, work.planRef)
      && work.protocol === admission.protocol && result.protocol === admission.protocol && result.validationVersion === 'review-report-v1'
      && same(work.subject, e.subject) && same(work.planRef, plan.ref) && same(work.resultRef, result.ref) && same(result.workRef, work.ref) && same(result.output, work.output)
      && result.decision.status === 'accepted' && result.decision.evidenceRefs.some(ref => ref.evidenceId === e.evidenceId && ref.projectId === e.subject.projectId)
      && run.status === 'ended' && run.outcome === 'completed' && run.exitCode === 0 && e.kind === 'verdict' && same(e.source.runRef, run.ref)
      && same(run.work, { kind:'review', reviewWorkRef:work.ref }) && same(run.envelope?.work, run.work) && same(run.envelope?.reviewInput, work.input)
      && same(run.envelope?.permissions.tools,['read']) && run.envelope?.permissions.writeScope.length === 0 && same(run.roleBinding,work.roleBinding)
      && same(e.summary.artifactRef, work.output?.reportRef) && work.output?.terminalEventId === run.lastRuntimeEventId && work.output?.terminalEventSeq === run.lastEventSeq && work.output?.runRevision === run.revision
      && !!work.output?.sessionId && !!work.output.observationId && !!work.input && work.input.descriptorDigest === work.descriptorRef.digest && work.output.descriptorDigest === work.input.descriptorDigest && work.output.packetDigest === work.input.packetDigest && work.output.inputDigest === work.input.inputDigest
      && same(e.coverage, result.decision.requirements.filter(r => r.outcome === 'PASS').map(({ obligationId, requirementId }) => ({ obligationId, requirementId })));
    const current = valid ? e : { ...e, coverage: e.coverage.filter(c => !keys.has(requirementKeyOf(c))) };
    if (current.coverage.length) positive.push(current);
  }
  return [...positive, ...negative];
}
