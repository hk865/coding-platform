/** AP/RC support: real owners, persisted observations and a two-writer commit barrier. */
import { expect } from 'vitest';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { DecodeResult, PreparedCommit, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import type { MessageDutiesFactsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import { decodeGoalSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createPlanService, createRequestCandidateService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createPlanningQuestionReader } from '../../src/core/work-graph/tasks/planning-question-reader.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createAutomaticReworkNoticeSource } from '../../src/core/work-graph/views/automatic-rework-notices.js';
import { createDecisionReadModel, createGoalCauseCardSource, createPlanningQuestionCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { asS5OrderedRecords, GOAL_B, OPERATOR, WORKSPACE_SCOPE, type S5DecisionFixture, type S5Records } from './S5-decision-fixture.js';

export const keyOf = (ref: object): string => canonicalJson(ref as JsonValue);
export const pin = (ref: VersionPin['ref'], revision: number): VersionPin => ({ ref, revision });

export function committed<T>(result: WriteResult<T>): Extract<WriteResult<T>, { status: 'committed' }> {
  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw new Error(`expected committed: ${JSON.stringify(result)}`);
  return result;
}

export function ready<T>(result: ReadResult<T>): T {
  expect(result).toMatchObject({ status: 'ready' });
  if (result.status !== 'ready') throw new Error(`expected ready: ${JSON.stringify(result)}`);
  return result.value;
}

export function decoded<T>(result: DecodeResult<T>): T {
  expect(result).toMatchObject({ status: 'decoded' });
  if (result.status !== 'decoded') throw new Error(`expected decoded: ${result.reason}`);
  return result.value;
}

export async function recordAt(records: S5Records, ref: object) {
  const batch = await records.readMany([keyOf(ref)]);
  if (batch.status !== 'ready') throw new Error(`record read failed: ${JSON.stringify(batch)}`);
  expect(batch.value.missing).toEqual([]);
  expect(batch.value.records).toHaveLength(1);
  const record = batch.value.records[0];
  if (record === undefined) throw new Error(`missing record ${keyOf(ref)}`);
  return record;
}

export const goalAt = async (records: S5Records, ref: GoalRef = GOAL_B) =>
  decoded(decodeGoalSnapshot(await recordAt(records, ref)));
export const messageAt = async (records: S5Records, ref: SessionMessageRef) =>
  decoded(decodeSessionMessageRecord(await recordAt(records, ref)));

/** Optional page widths threaded into the owner deps; omitted widths keep production defaults. */
export type OwnerReadWidths = {
  decision?: { sourcePageLimit?: number; lookupPageLimit?: number };
  planningQuestion?: { lookupPageLimit?: number };
  automaticRework?: { orderedPageLimit?: number };
};

/**
 * All services share the fixture's observed Store and allocation counters, also
 * after reopen. No Runtime/model port is installed: these owners and readers
 * have only persistence/material dependencies. Store snapshots also enumerate
 * any ModelRequest records, so read/rejection assertions cannot hide such writes.
 */
export function owners(f: S5DecisionFixture, records: S5Records = f.records, bodies: RawArtifactStorePort = f.bodies,
  widths: OwnerReadWidths = {}) {
  const roles = createRoleConfigurationService({ records, now: f.now, eventId: f.newId });
  const materials = createMaterialService({ bodies, authority: createMaterialRecordReaders(records).authority, now: f.now });
  const mailboxDeps: SessionMailboxDependencies = {
    records, sessions: createSessionDirectory({ records, lookups: records }),
    executions: createRunStateReader({ records }), roles, materials, systemActor: { ...OPERATOR },
    now: f.now, newId: f.newId,
    duties: ({
      async readMessageDutiesFacts(_ctx, input) {
        if (input.roleBinding.templateId !== f.runRA.roleBinding.templateId
          || input.roleBinding.templateRevision !== f.runRA.roleBinding.templateRevision) {
          return { status: 'rejected', code: 'unsupported', reason: 'no exact duties mapping exists for this Role binding' };
        }
        return { status: 'ready', value: { duties: [...f.duties], readOnlyCopy: false, independentReview: false, guards: [] } };
      },
    } satisfies MessageDutiesFactsPort),
  };
  const decisions = createDecisionMessageService({ records, now: f.now, newId: f.newId, operatorActor: { ...OPERATOR },
    messages: createSessionMailbox(mailboxDeps), materials, messageWrites: createMessageWriteOwner(mailboxDeps),
    sources: createDecisionSourceFacts({ records }) });
  const planDeps = { records, materials, initialPlanning: { bodies }, now: f.now, eventId: f.newId };
  const plans = createPlanService(planDeps);
  const causes = createGoalDecisionCauseReader({ records, plans });
  // The real ordered port forwarded through the same records the test wraps
  // (faults and counters still apply); the executed-files reader and the
  // automatic-rework source both read through it.
  const orderedRecords = asS5OrderedRecords(records);
  // Conditional spreads keep `exactOptionalPropertyTypes` honest: an omitted
  // width is absent from the deps object, so the production default applies.
  const decisionWidths = {
    ...(widths.decision?.sourcePageLimit === undefined ? {} : { sourcePageLimit: widths.decision.sourcePageLimit }),
    ...(widths.decision?.lookupPageLimit === undefined ? {} : { lookupPageLimit: widths.decision.lookupPageLimit }),
  };
  const planningQuestionWidths = {
    ...(widths.planningQuestion?.lookupPageLimit === undefined
      ? {} : { lookupPageLimit: widths.planningQuestion.lookupPageLimit }),
  };
  const automaticReworkWidths = {
    ...(widths.automaticRework?.orderedPageLimit === undefined
      ? {} : { orderedPageLimit: widths.automaticRework.orderedPageLimit }),
  };
  // The production composition's source wiring. Message/candidate projection must
  // be implemented by the production reader; this helper never manufactures cards.
  const reads = createDecisionReadModel({ records, ...decisionWidths,
    cardSources: [createGoalCauseCardSource(causes),
      createPlanningQuestionCardSource(createPlanningQuestionReader({ records, plans, ...planningQuestionWidths }))],
    noticeSources: [createAutomaticReworkNoticeSource({ records: orderedRecords, ...automaticReworkWidths })],
    conflicts: createGoalConflictAssembler({ records: orderedRecords,
      catalog: createArchitectureCatalogService({ records: orderedRecords }),
      executedFiles: createGoalExecutedFilesReader({ records: orderedRecords }),
      ...(widths.decision?.lookupPageLimit === undefined
        ? {} : { lookupPageLimit: widths.decision.lookupPageLimit }) }),
    positions: createNoticePositionComparator(), displayTokens: createNoticeDisplayToken(new Uint8Array(32)),
  });
  return { decisions, plans, causes, reads,
    settings: createGoalSettingsService({ records, now: f.now, newId: f.newId, operatorActor: { ...OPERATOR } }),
    requests: createRequestCandidateService(planDeps),
  };
}

export async function queue(f: S5DecisionFixture, records: S5Records = f.records) {
  return ready(await owners(f, records).reads.queryDecisionQueue(f.ctx, {
    workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 },
  }));
}

export async function control(f: S5DecisionFixture, action: 'pause' | 'resume', requestId: string, records: S5Records = f.records) {
  const goal = await goalAt(records);
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: GOAL_B.projectId, goalId: GOAL_B.goalId };
  const phase = await readGoalPhase(records, phaseRef);
  if (phase.status !== 'ready') throw new Error(`phase read failed: ${JSON.stringify(phase)}`);
  return committed(await setGoalControlFromHost({ records, now: f.now, eventId: f.newId }, f.ctx, {
    input: { goalRef: GOAL_B, control: action, reason: null },
    meta: { requestId, expected: [pin(GOAL_B, goal.revision), pin(phaseRef, phase.snapshot?.revision ?? 0)] },
  }));
}

export type CapturedCommit = { input: PreparedCommit; receipt: Extract<StoreCommitReceipt, { status: 'committed' }> };
export function captureCommits(records: S5Records) {
  const commits: CapturedCommit[] = [];
  const wrapped: S5Records = { ...records, async commit(input) {
    const receipt = await records.commit(input);
    if (receipt.status === 'committed') commits.push({ input, receipt });
    return receipt;
  } };
  return { records: wrapped, commits };
}

/** Both writers reach commit with their pre-write reads before either mutates the Store. */
export function commitBarrier(records: S5Records) {
  let arrivals = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const both = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const wrapped: S5Records = { ...records, async commit(input) {
    arrivals += 1;
    if (arrivals === 1) timer = setTimeout(() => reject(new Error('second writer did not reach commit')), 2000);
    if (arrivals === 2) { clearTimeout(timer); release(); }
    await both;
    return records.commit(input);
  } };
  return { records: wrapped, arrivals: () => arrivals };
}
