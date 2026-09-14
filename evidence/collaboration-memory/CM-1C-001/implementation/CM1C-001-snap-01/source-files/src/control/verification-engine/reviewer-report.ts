import { ARTIFACT_MAX_SIZE_BYTES, artifactBodyDigest, artifactBodySize } from '../../contracts/artifact.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { ReviewerContextPort, ReviewerPacketV1 } from '../../contracts/reviewer-context.js';
import type { ReviewAssessmentV1, ReviewerCitationV1, ReviewerSemanticReportV1 } from '../../contracts/reviewer-verification.js';
import type { ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';
import { ensure } from './verification-input.js';

const same = (a: unknown, b: unknown) => canonicalJson(a as JsonValue) === canonicalJson(b as JsonValue);
const edge = (c: { obligationId: string; requirementId: string }) => c['obligationId'] + '\0' + c['requirementId'];
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, max = 8192): value is string => typeof value === 'string' && value['trim']().length > 0 && value['length'] <= max;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value['length'] <= 512 && value['every'](v => boundedText(v)) && new Set(value).size === value['length'];
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
class InvalidReport extends Error { }
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new InvalidReport(message); }

/** Read a whole immutable artifact through bounded, current-grant Context pages.
 * Any read failure escapes as a material gap, not a fabricated model verdict. */
export async function readReviewArtifact(context: ReviewerContextPort, work: ReviewWorkSnapshot, ref: ArtifactRef): Promise<string> {
  ensure(ref.sizeBytes >= 0 && ref.sizeBytes <= ARTIFACT_MAX_SIZE_BYTES, '审阅材料超过 Artifact 上限');
  const chunks: string[] = [];
  let offset = 0;
  do {
    const page = await context.readMaterial(work.ref, { ref, offset, maxBytes: 32 * 1024 });
    ensure(same(page.ref, ref) && page.offset === offset && page.totalBytes === ref.sizeBytes, '审阅材料分页身份不一致');
    const bytes = artifactBodySize(page.content);
    ensure(page.nextOffset === offset + bytes && (page.complete || bytes > 0), '审阅材料分页没有向前推进');
    chunks.push(page.content);
    offset = page.nextOffset;
    ensure(offset <= ref.sizeBytes && page.complete === (offset === ref.sizeBytes), '审阅材料分页长度不一致');
  } while (offset < ref.sizeBytes);
  const body = chunks.join('');
  ensure(artifactBodyDigest(body) === ref.digest && artifactBodySize(body) === ref.sizeBytes, '审阅材料正文摘要不一致');
  return body;
}

function parse(body: string, work: ReviewWorkSnapshot, packet: ReviewerPacketV1): ReviewerSemanticReportV1 {
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { throw new InvalidReport('report_json: 原始报告必须是完整 JSON 对象'); }
  check(isObject(raw) && keys(raw, ['schemaVersion', 'kind', 'reviewId', 'descriptorDigest', 'packetDigest', 'sourceDigest', 'citations', 'requirements', 'issues']), 'report_schema: 报告字段不符合版本 1');
  check(raw['schemaVersion'] === 1 && raw['kind'] === 'independent-review-result', 'report_version: 不支持的原始报告版本');
  check(raw['reviewId'] === work.ref.reviewId && raw['descriptorDigest'] === work.descriptorRef.digest && raw['packetDigest'] === work.input?.packetDigest && raw['sourceDigest'] === packet.materialIdentity.sourceDigest, 'report_binding: 报告没有绑定本 Work、输入包与来源');
  check(Array.isArray(raw['requirements']) && raw['requirements'].length === work.descriptor.requiredReviewerCoverage.length, 'coverage: Reviewer 要求必须完整且仅出现一次');
  const expected = new Set(work.descriptor.requiredReviewerCoverage.map(edge));
  const seen = new Set<string>();
  for (const value of raw['requirements']) {
    check(isObject(value) && keys(value, ['obligationId', 'requirementId', 'result', 'rationale', 'citationIds', 'issueIds', 'unknowns']), 'requirement_schema: 无效的逐 VR 结论');
    check(boundedText(value['obligationId'], 128) && boundedText(value['requirementId'], 128), 'coverage: 无效的 VR 身份');
    const key = edge(value as { obligationId: string; requirementId: string });
    check(expected.has(key) && !seen.has(key), 'coverage: 重复或额外的 Reviewer VR');
    seen.add(key);
    check(['PASS', 'FAIL', 'INCONCLUSIVE'].includes(String(value['result'])) && boundedText(value['rationale']) && artifactBodySize(value['rationale']) <= 4096, 'requirement_result: 结论与有界理由缺失');
    check(strings(value['citationIds']) && value['citationIds'].length > 0 && strings(value['issueIds']) && strings(value['unknowns']), 'requirement_references: 必须有真实材料引用');
    check(value['result'] !== 'FAIL' || value['issueIds'].length > 0, 'failure_issue: FAIL 必须关联具体问题');
    check(value['result'] !== 'INCONCLUSIVE' || value['unknowns'].length > 0, 'inconclusive_reason: INCONCLUSIVE 必须保留未知项');
    check(value['result'] !== 'PASS' || value['issueIds'].length === 0 && value['unknowns'].length === 0, 'pass_conflict: PASS 不能同时声明阻断问题或未知项');
  }
  check(Array.isArray(raw['citations']) && raw['citations'].length > 0 && raw['citations'].length <= 512, 'citations: 缺少有界材料引用');
  const citationIds = new Set<string>();
  for (const value of raw['citations']) {
    check(isObject(value) && keys(value, ['citationId', 'materialId', 'digest', 'location']) && boundedText(value['citationId'], 128) && boundedText(value['materialId'], 2048) && typeof value['digest'] === 'string' && /^[a-f0-9]{64}$/.test(value['digest']), 'citation_schema: 无效的材料引用');
    check(!citationIds.has(value['citationId']), 'citation_identity: 引用身份重复');
    citationIds.add(value['citationId']);
    check(isObject(value['location']), 'citation_location: 引用位置缺失');
    const location = value['location'];
    if (location['kind'] === 'source-lines') {
      check(keys(location, ['kind', 'path', 'startLine', 'endLine']) && boundedText(location['path'], 1024) && !location['path'].includes('\\') && !location['path'].startsWith('/') && !location['path'].includes('\0') && !location['path'].split('/').some(p => p === '..' || p === '.' || p === '') && !/^[A-Za-z]:/.test(location['path']), 'source_path: 来源路径必须是工作区内的规范相对路径');
      check(Number.isSafeInteger(location['startLine']) && Number.isSafeInteger(location['endLine']) && Number(location['startLine']) >= 1 && Number(location['endLine']) >= Number(location['startLine']) && Number(location['endLine']) - Number(location['startLine']) < 200, 'source_lines: 无效的来源行范围');
      check(value['materialId'] === 'source:' + location['path'], 'source_identity: 来源引用与路径不一致');
    } else {
      check(location['kind'] === 'artifact-section' && keys(location, ['kind', 'pointer']) && typeof location['pointer'] === 'string' && location['pointer'].length <= 2048 && (location['pointer'] === '' || location['pointer'].startsWith('/')), 'artifact_pointer: 无效的 JSON Pointer');
    }
  }
  check(Array.isArray(raw['issues']) && raw['issues'].length <= 512, 'issues_schema: 问题集合无效');
  const issueIds = new Set<string>();
  for (const value of raw['issues']) {
    check(isObject(value) && keys(value, ['issueId', 'coverage', 'description', 'impact', 'citationIds']) && boundedText(value['issueId'], 128) && boundedText(value['description']) && boundedText(value['impact']) && strings(value['citationIds']) && value['citationIds'].length > 0, 'issue_schema: 问题必须包含身份、影响和材料引用');
    check(!issueIds.has(value['issueId']), 'issue_identity: 问题身份重复');
    issueIds.add(value['issueId']);
    check(Array.isArray(value['coverage']) && value['coverage'].length > 0 && value['coverage'].every(c => isObject(c) && keys(c, ['obligationId', 'requirementId']) && boundedText(c['obligationId'], 128) && boundedText(c['requirementId'], 128) && expected.has(edge(c as { obligationId: string; requirementId: string }))), 'issue_coverage: 问题覆盖不属于本次 Reviewer 要求');
    check(new Set(value['coverage'].map(c => edge(c as { obligationId: string; requirementId: string }))).size === value['coverage'].length, 'issue_coverage: 问题覆盖重复');
  }
  const report = raw as ReviewerSemanticReportV1;
  for (const result of report.requirements) {
    check(result.citationIds.every(id => citationIds.has(id)), 'citation_missing: 逐 VR 引用了不存在的材料');
    check(result.issueIds.every(id => issueIds.has(id)), 'issue_missing: 逐 VR 引用了不存在的问题');
    for (const issue of report.issues) {
      const covers = issue.coverage.some(c => edge(c) === edge(result));
      check(covers === result.issueIds.includes(issue.issueId), 'issue_binding: 问题与逐 VR 结论的覆盖不一致');
    }
  }
  check(report.issues.every(i => i.citationIds.every(id => citationIds.has(id))), 'issue_citation: 问题引用了不存在的材料');
  return report;
}

function pointerExists(body: string, pointer: string) {
  if (pointer === '') return true;
  let value: unknown;
  try { value = JSON.parse(body); } catch { return false; }
  for (const encoded of pointer.slice(1).split('/')) {
    if (/~(?![01])/.test(encoded)) return false;
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}

async function validateCitation(citation: ReviewerCitationV1, work: ReviewWorkSnapshot, packet: ReviewerPacketV1, context: ReviewerContextPort, cache: Map<string, string>) {
  if (citation.location['kind'] === 'source-lines') {
    const location = citation.location;
    let page;
    // Context proves the frozen source before/after reading. Compare the report's
    // claimed digest here so a fabricated digest is invalid, not transient stale.
    try { page = await context.readSource(work.ref, { path: location['path'], startLine: location['startLine'], endLine: location['endLine'] }); }
    catch (error) {
      if (isObject(error) && error['code'] === 'invalid_reference') throw new InvalidReport('source_citation: 引用的路径、摘要或行范围不属于固定来源');
      throw error;
    }
    check(page.materialId === citation.materialId && page.path === location['path'] && page.digest === citation.digest && page.startLine === location['startLine'] && page.endLine === location['endLine'], 'source_citation: 引用的来源版本或行范围不存在');
    return;
  }
  const material = packet.materials.find(m => m.materialId === citation.materialId);
  check(material && material.ref.digest === citation.digest, 'material_citation: 引用不在正式输入包的完整材料索引中');
  let body = cache.get(material.ref.digest);
  if (body === undefined) { body = await readReviewArtifact(context, work, material.ref); cache.set(material.ref.digest, body); }
  check(pointerExists(body, citation.location['pointer']), 'artifact_citation: 引用的材料位置不存在');
}

/** Syntax/meaning failures are durable rejected assessments. Permission/source
 * read failures propagate so the lifecycle retains a material gap instead. */
export async function assessReviewerReport(input: {
  work: ReviewWorkSnapshot; packet: ReviewerPacketV1; body: string;
  context: ReviewerContextPort; materialIdentityDigest: string;
}): Promise<ReviewAssessmentV1> {
  const { work, packet, context } = input;
  ensure(work.output, '正式 Work 尚未绑定原始报告');
  const base = { schemaVersion: 1 as const, kind: 'independent-review-assessment' as const,
    validationVersion: 'review-report-v1' as const, workRef: work.ref, rawReportRef: work.output.reportRef,
    descriptorDigest: work.descriptorRef.digest, materialIdentityDigest: input.materialIdentityDigest };
  try {
    check(artifactBodyDigest(input.body) === work.output.reportDigest && artifactBodySize(input.body) === work.output.reportRef.sizeBytes, 'report_integrity: 原始报告正文摘要或大小错误');
    const report = parse(input.body, work, packet), cache = new Map<string, string>();
    for (const citation of report.citations) await validateCitation(citation, work, packet, context, cache);
    return { ...base, decision: { status: 'accepted', requirements: report.requirements.map(r => ({
      obligationId: r.obligationId, requirementId: r.requirementId, outcome: r.result, summary: r.rationale,
    })) } };
  } catch (error) {
    if (!(error instanceof InvalidReport)) throw error;
    return { ...base, decision: { status: 'rejected', reasonCodes: [error['message']] } };
  }
}
