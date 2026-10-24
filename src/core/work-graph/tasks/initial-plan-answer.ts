/**
 * The persisted initial-plan answer facts reader (R5b.4 §11.4). It consumes only
 * the persisted Query owner's formal facts through the injected ports; it never
 * calls Runtime, opens the Kernel store or rescans a transcript.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { PreparedQueryManifestV1 } from '../../../contracts/core/prepared-execution.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { messageOf } from '../../../contracts/error-message.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  QueryJobAnswerRef,
  QueryJobRef,
  QueryJobSnapshot,
  QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { MaterialPort } from '../model/material-contracts.js';
import type { PlanProposal } from '../model/plan-contracts.js';
import {
  decodeQueryJobAnswerSnapshot,
  decodeQueryJobSnapshot,
  decodeQueryRunSnapshotRecord,
} from '../queries/query-record-codecs.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../queries/query-execution.js';
import {
  normalizeInitialPlanningResponseV2,
  parseInitialPlanningResponseV2,
  type InitialPlanAnswerFacts,
} from './initial-plan.js';
import { asWriteRejection, mapStoreReadFailure, type Owned, type Rejection } from './plan-result-helpers.js';

type InitialPlanAnswerDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  materials?: Pick<MaterialPort, 'openArtifact'>;
  initialPlanning?: { bodies: Pick<RawArtifactStorePort, 'read'> };
};

/**
 * `records` is the instance the plan service already took from `deps` when it was built, so the store is read
 * through one instance and `deps.records` is never read a second time. The optional `materials` and
 * `initialPlanning` ports stay on `deps` and are read on each call, where the plan service read them.
 */
export function createInitialPlanAnswerReader(deps: InitialPlanAnswerDependencies, records: InitialPlanAnswerDependencies['records']) {
  /**
   * R5b.4 §11.4 the narrow fact read. It consumes only the persisted Query
   * owner's formal facts (Answer/Job/Run + the frozen prepared manifest body)
   * through the same records/materials/bodies instances; it never calls Runtime,
   * opens the Kernel store or rescans a transcript.
   */
  async function readInitialPlanAnswerFacts(
    ctx: CoreCallContext,
    answerRef: QueryJobAnswerRef,
  ): Promise<ReadResult<InitialPlanAnswerFacts>> {
    const materials = deps.materials;
    const bodies = deps.initialPlanning?.bodies;
    if (materials === undefined || bodies === undefined) {
      return rejected('unsupported', 'the initial-plan answer consumption requires the injected materials and prepared-body stores');
    }
    if (!isRecord(answerRef) || answerRef.aggregateType !== 'QueryJobAnswer'
      || !nonEmpty(answerRef.projectId) || !nonEmpty(answerRef.workspaceId)
      || !nonEmpty(answerRef.queryJobId) || !nonEmpty(answerRef.answerId)) {
      return rejected('invalid', 'the initial-plan consumer requires a complete QueryJobAnswerRef');
    }
    const wanted = answerRef as QueryJobAnswerRef;
    const answerKey = canonicalJson(wanted as unknown as JsonValue);
    let answerRead;
    try { answerRead = await records.readMany([answerKey]); }
    catch (error) { return rejected('unavailable', `the Query answer read failed: ${messageOf(error)}`); }
    if (answerRead.status !== 'ready') return mapStoreReadFailure(answerRead, 'the Query answer is not readable');
    const answerRecord = answerRead.value.records.find((record) => record.refKey === answerKey);
    if (answerRecord === undefined) {
      return answerRead.value.missing.includes(answerKey)
        ? { status: 'not_found' } : rejected('unavailable', 'the Query answer read was not reported');
    }
    const decodedAnswer = decodeQueryJobAnswerSnapshot(answerRecord);
    if (decodedAnswer.status !== 'decoded') {
      return rejected('unavailable', `the Query answer is not decodable: ${decodedAnswer.reason}`);
    }
    const answer = decodedAnswer.value;
    if (answer.ref.answerId !== wanted.answerId || answer.ref.queryJobId !== wanted.queryJobId
      || answer.ref.projectId !== wanted.projectId || answer.ref.workspaceId !== wanted.workspaceId) {
      return rejected('invalid', 'the stored Query answer does not match the requested answer identity');
    }
    const jobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: wanted.projectId,
      workspaceId: wanted.workspaceId, queryJobId: wanted.queryJobId };
    const runRef = answer.answer.runRef;
    if (!isRecord(runRef) || runRef.aggregateType !== 'QueryRun'
      || runRef.projectId !== wanted.projectId || runRef.workspaceId !== wanted.workspaceId
      || runRef.queryJobId !== wanted.queryJobId || !nonEmpty(runRef.runId)) {
      return rejected('invalid', 'the stored Query answer carries an inconsistent QueryRunRef');
    }
    const jobKey = canonicalJson(jobRef as unknown as JsonValue);
    const runKey = canonicalJson(runRef as unknown as JsonValue);
    let coreRead;
    try { coreRead = await records.readMany([jobKey, runKey]); }
    catch (error) { return rejected('unavailable', `the Query Job/Run read failed: ${messageOf(error)}`); }
    if (coreRead.status !== 'ready') return mapStoreReadFailure(coreRead, 'the Query Job/Run are not readable');
    const present = new Map(coreRead.value.records.map((record) => [record.refKey, record]));
    const jobRecord = present.get(jobKey);
    if (jobRecord === undefined) return rejected('not_found', 'the QueryJob record does not exist');
    const runRecord = present.get(runKey);
    if (runRecord === undefined) return rejected('not_found', 'the QueryRun record does not exist');
    const decodedJob = decodeQueryJobSnapshot(jobRecord);
    if (decodedJob.status !== 'decoded') return rejected('unavailable', `the QueryJob is not decodable: ${decodedJob.reason}`);
    const decodedRun = decodeQueryRunSnapshotRecord(runRecord);
    if (decodedRun.status !== 'decoded') return rejected('unavailable', `the QueryRun is not decodable: ${decodedRun.reason}`);
    const job: QueryJobSnapshot = decodedJob.value;
    const run: QueryRunSnapshot = decodedRun.value;
    // Same formal scope, the initial_coordination kind and the real answered facts.
    if (job.ref.projectId !== wanted.projectId || job.ref.workspaceId !== wanted.workspaceId
      || job.ref.queryJobId !== wanted.queryJobId
      || job.job.projectId !== wanted.projectId || job.job.workspaceId !== wanted.workspaceId) {
      return rejected('forbidden', 'the QueryJob is outside the requested answer scope');
    }
    if (job.job.intent.execution.kind !== 'initial_coordination') {
      return rejected('invalid', 'the QueryJob intent is not an initial_coordination request');
    }
    if (!nonEmpty(job.job.goalId)) return rejected('incomplete', 'the QueryJob intent has no Goal');
    if (job.job.runRef === null || job.job.runRef.runId !== runRef.runId) {
      return rejected('invalid', 'the QueryJob does not point at the answered QueryRun');
    }
    if (job.job.status !== 'answered') return rejected('incomplete', 'the QueryJob is not formally answered');
    if (!job.job.answerRefs.some((ref) => canonicalJson(ref as unknown as JsonValue) === answerKey)) {
      return rejected('invalid', 'the QueryJob does not carry this answer');
    }
    if (run.ref.projectId !== wanted.projectId || run.ref.workspaceId !== wanted.workspaceId
      || run.ref.queryJobId !== wanted.queryJobId || run.ref.runId !== runRef.runId) {
      return rejected('forbidden', 'the QueryRun is outside the requested answer scope');
    }
    if (run.run.status !== 'answered' || run.run.outcome !== 'answered') {
      return rejected('incomplete', 'the QueryRun is not formally answered');
    }
    const state = run.run.executionState;
    if (state === undefined || state.phase !== 'settled') {
      return rejected('incomplete', 'the QueryRun has no settled execution observation');
    }
    if (state.history === null) return rejected('incomplete', 'the QueryRun has no saved history locator');
    if (state.prepared === null) return rejected('incomplete', 'the QueryRun has no frozen prepared manifest reference');
    // The exact persisted answer body, opened as a Host historical explanation.
    let opened;
    try {
      opened = await materials.openArtifact(ctx, {
        ref: answer.answer.bodyRef, usage: 'historical_explanation' });
    } catch (error) { return rejected('unavailable', `the Query answer body read failed: ${messageOf(error)}`); }
    if (opened.status !== 'ready') return opened;
    const body = opened.value;
    if (body.body !== answer.answer.answer || body.ref.digest !== answer.answer.bodyRef.digest
      || sha256Hex(body.body) !== answer.answer.bodyRef.digest) {
      return rejected('invalid', 'the stored Query answer body disagrees with the recorded answer');
    }
    if (body.ownerRunRef === null || body.ownerRunRef === undefined
      || canonicalJson(body.ownerRunRef as unknown as JsonValue) !== runKey) {
      return rejected('forbidden', 'the stored Query answer body is not owned by this QueryRun');
    }
    // The frozen prepared manifest body, re-read through the same raw body store.
    const prepared = state.prepared;
    const bundleRef = prepared.bundleRef;
    if (bundleRef.contentType !== QUERY_MANIFEST_CONTENT_TYPE) {
      return rejected('invalid', 'the prepared Query manifest reference is not a bounded query-execution manifest');
    }
    let storedManifest;
    try { storedManifest = await bodies.read(bundleRef); }
    catch (error) { return rejected('unavailable', `reading the prepared Query manifest failed: ${messageOf(error)}`); }
    if (storedManifest.status !== 'ready') {
      return rejected('invalid', 'the frozen prepared Query manifest body is not readable');
    }
    const raw = storedManifest.value;
    if (raw.ref.contentType !== bundleRef.contentType || raw.ref.digest !== bundleRef.digest
      || raw.ref.sizeBytes !== bundleRef.sizeBytes
      || sha256Hex(raw.body) !== bundleRef.digest
      || Buffer.byteLength(raw.body, 'utf8') !== bundleRef.sizeBytes) {
      return rejected('invalid', 'the stored Query manifest body disagrees with the prepared reference');
    }
    if (raw.origin.kind !== 'run'
      || canonicalJson(raw.origin.owner as unknown as JsonValue) !== runKey) {
      return rejected('forbidden', 'the prepared Query manifest is not owned by this QueryRun');
    }
    let parsedManifest: unknown;
    try { parsedManifest = JSON.parse(raw.body); }
    catch { return rejected('invalid', 'the prepared Query manifest is not valid JSON'); }
    if (!isRecord(parsedManifest) || parsedManifest['schemaVersion'] !== 1
      || parsedManifest['kind'] !== 'query_execution'
      || typeof parsedManifest['input'] !== 'string' || !nonEmpty(parsedManifest['inputDigest'])) {
      return rejected('invalid', 'the prepared Query manifest is incomplete');
    }
    const manifest = parsedManifest as unknown as PreparedQueryManifestV1;
    if (canonicalJson(manifest.queryRunRef as unknown as JsonValue) !== runKey) {
      return rejected('invalid', 'the prepared Query manifest disagrees with the QueryRun');
    }
    if (sha256Hex(manifest.input) !== manifest.inputDigest || manifest.inputDigest !== prepared.inputDigest) {
      return rejected('invalid', 'the prepared Query manifest input digest is inconsistent');
    }
    if (!isRecord(manifest.goal) || !isRecord(manifest.goal.ref)
      || manifest.goal.ref.projectId !== wanted.projectId || manifest.goal.ref.goalId !== job.job.goalId
      || manifest.workspace.ref.workspaceId !== wanted.workspaceId) {
      return rejected('invalid', 'the prepared Query manifest does not pin this Goal/Workspace');
    }
    return { status: 'ready', value: {
      answer: answer.answer, answerRef: { ...answer.ref }, job, run, manifest,
      answerText: answer.answer.answer } };
  }

  /**
   * R5b.4 §11.4 the apply-side provenance proof: the candidate must be the
   * UNIQUE normalization of its real persisted answer. The actual read versions
   * join the original local CAS; a mismatch is an explicit rejection and never a
   * repair of the stored draft.
   */
  async function verifyModelCoordinationDraft(
    ownedContext: Owned<CoreCallContext>,
    proposal: Extract<PlanProposal, { kind: 'candidate_v2' }>,
  ): Promise<{ guards: RecordGuard[] } | { rejection: Rejection }> {
    const origin = proposal.draft.origin;
    if (origin === undefined || origin.kind !== 'model_coordination') {
      return { rejection: rejected('invalid', 'the candidate does not carry the model-coordination origin it claims') };
    }
    if (deps.materials === undefined || deps.initialPlanning === undefined) {
      return { rejection: rejected('unsupported', 'model-coordination adoption requires the injected materials and prepared-body stores') };
    }
    if (ownedContext.status === 'invalid') return { rejection: rejected('invalid', ownedContext.reason) };
    const factsRead = await readInitialPlanAnswerFacts(ownedContext.value, origin.answerRef);
    if (factsRead.status !== 'ready') {
      return { rejection: asWriteRejection(factsRead, 'the initial-plan answer facts are not readable') };
    }
    const facts = factsRead.value;
    const parsed = parseInitialPlanningResponseV2(facts.answerText);
    if (parsed.status === 'rejected') return { rejection: parsed };
    const normalized = normalizeInitialPlanningResponseV2(parsed.response, facts);
    if (normalized.status !== 'plan') {
      return { rejection: rejected('invalid', 'the real answer no longer normalizes to the proposed plan') };
    }
    if (canonicalJson(normalized.draft as unknown as JsonValue)
      !== canonicalJson(proposal.draft as unknown as JsonValue)) {
      return { rejection: rejected('invalid', 'the candidate draft is not the unique normalization of the real answer') };
    }
    return { guards: [
      { refKey: canonicalJson(origin.answerRef as unknown as JsonValue), expectedRevision: 1 },
      { refKey: canonicalJson(facts.job.ref as unknown as JsonValue), expectedRevision: facts.job.revision },
      { refKey: canonicalJson(facts.run.ref as unknown as JsonValue), expectedRevision: facts.run.revision },
    ] };
  }

  return { readInitialPlanAnswerFacts, verifyModelCoordinationDraft };
}
