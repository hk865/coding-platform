import { verificationRoundFixture, type ReviewProtocolRequest } from './verification-round-fixture.js';
import type { ReviewerPacketV1, ReviewerProfileResult } from '../../src/contracts/reviewer-context.js';
import type { ReviewerSemanticReportV1, ReviewRequestResult, ReviewRequestView } from '../../src/contracts/reviewer-verification.js';
import type { VerificationRoundResult } from '../../src/contracts/verification-round.js';

/** Decode only text actually sent to the model. The protocol substitute never
 * reads the application journal, Vault database, or the workspace directly. */
function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === 'object') return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)];
  if (typeof value !== 'string') return [];
  const result: Record<string, unknown>[] = [];
  for (const text of value.split('\n\n')) {
    try { result.push(...objects(JSON.parse(text))); } catch { /* Instruction prose is not material JSON. */ }
  }
  return result;
}

type Factory = Parameters<typeof verificationRoundFixture>[2];
export async function independentReviewFixture(cleanup: Array<() => Promise<void>>, createApplication: Factory, options: {
  result?: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  beforeReport?: () => Promise<void>;
  transformReport?: (report: ReviewerSemanticReportV1) => unknown;
} = {}) {
  const requests: ReviewProtocolRequest[] = [];
  const fixture = await verificationRoundFixture(cleanup, true, createApplication, { reviewer: async request => {
    requests.push(structuredClone(request));
    const material = objects(request.messages);
    const packet = material.find(value => value['kind'] === 'independent-review-packet') as ReviewerPacketV1 | undefined;
    const binding = material.find(value => typeof value['reviewId'] === 'string' && typeof value['packetDigest'] === 'string');
    if (!packet || !binding) throw Error('Model did not receive its independent review packet and binding');
    const returned = objects(request.messages?.filter(message => message.role === 'tool'));
    const failed = returned.find(value => value['status'] === 'error' || value['status'] === 'cancelled');
    if (failed) throw Error('Actual Reviewer tool refused material: ' + JSON.stringify(failed));
    const source = returned.find(value => value['materialId'] === 'source:subject.txt' && typeof value['sourceDigest'] === 'string');
    if (!source) return { calls: [{ id: 'review-read-source', name: 'read_source', arguments: { path: 'subject.txt', startLine: 1, maxLines: 1 } }] };
    for (const entry of packet.materials) {
      const pages = returned.filter(value => value['ref'] && (value['ref'] as Record<string, unknown>)['digest'] === entry.ref.digest && typeof value['nextOffset'] === 'number');
      if (pages.some(page => page['complete'] === true)) continue;
      const offset = Math.max(0, ...pages.map(page => Number(page['nextOffset'])));
      return { calls: [{ id: 'review-material-' + entry.materialId + '-' + offset, name: 'read_material', arguments: { materialId: entry.materialId, offset, maxBytes: 32768 } }] };
    }
    await options.beforeReport?.();
    const result = options.result ?? 'PASS';
    const coverage = packet.coverage.map(({ obligationId, requirementId }) => ({ obligationId, requirementId }));
    const tool = packet.materials.find(entry => entry.kind === 'tool-report');
    if (!tool) throw Error('Original tool report missing from the packet');
    const report: ReviewerSemanticReportV1 = {
      schemaVersion: 1, kind: 'independent-review-result', reviewId: packet.workRef.reviewId,
      descriptorDigest: packet.descriptorDigest, packetDigest: binding['packetDigest'] as string, sourceDigest: packet.materialIdentity.sourceDigest,
      citations: [
        { citationId: 'source', materialId: 'source:subject.txt', digest: source['sourceDigest'] as string, location: { kind: 'source-lines', path: 'subject.txt', startLine: 1, endLine: 1 } },
        { citationId: 'tool', materialId: tool.materialId, digest: tool.ref.digest, location: { kind: 'artifact-section', pointer: '/result' } },
      ],
      requirements: coverage.map(item => ({ ...item, result,
        rationale: result === 'PASS' ? 'The current subject.txt contains expected, and the original behavior check reports PASS at the same source version.' : 'This deterministic protocol case preserves an independent reviewer finding or uncertainty against the cited current source and original tool report.',
        citationIds: ['source', 'tool'], issueIds: result === 'FAIL' ? ['finding'] : [], unknowns: result === 'INCONCLUSIVE' ? ['The protocol fixture deliberately leaves this semantic requirement unresolved.'] : [],
      })),
      issues: result === 'FAIL' ? [{ issueId: 'finding', coverage, description: 'Deterministic reviewer failure for lifecycle verification.', impact: 'Blocks the required semantic requirement.', citationIds: ['source'] }] : [],
    };
    return { content: JSON.stringify(options.transformReport ? options.transformReport(report) : report) };
  } });
  const scope = { ...fixture.scope, runId: fixture.runId, taskId: fixture.taskId };
  const round = async (requestId = 'review-tools', command = 'test "$(cat subject.txt)" = expected') => fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
    ...scope, requestId, allowExecute: true, configuration: { checks: [{ checkId: 'subject-check', kind: 'dynamic', command, cwd: '.', timeoutMs: 3000, appliesTo: { workspaceId: scope.workspaceId, taskIds: [scope.taskId] } }] },
  });
  const profile = () => fixture.post<ReviewerProfileResult>('/api/real/verifications/reviews/profile', scope);
  const read = (requestId = 'independent') => fixture.post<ReviewRequestView>('/api/real/verifications/reviews/read', { ...scope, requestId });
  const start = async (requestId = 'independent', roundRequestId = 'review-tools') => {
    const configured = await profile();
    if (configured.status !== 200 || configured.body.status !== 'ready') throw Error('Actual Reviewer profile unavailable: ' + JSON.stringify(configured));
    const input = { ...scope, requestId, roundRequestId, reviewerConfigRef: configured.body.ref, allowExecute: true };
    return { input, response: await fixture.post<ReviewRequestResult>('/api/real/verifications/reviews/start', input) };
  };
  return { ...fixture, reviewScope: scope, reviewerRequests: requests, round, profile, read, start };
}
