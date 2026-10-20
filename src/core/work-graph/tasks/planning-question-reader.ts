/**
 * Slice 5 §4.2 source 5 (F28): the formally saved planning-question reader.
 *
 * It reads a Goal's answered QueryJobs through the §4.2
 * `query-job-by-workspace-goal` lookup, opens only the formal Answer
 * Job/Run/manifest/body through the named `PlanTaskPort.readInitialPlanAnswerFacts`
 * seam, and reuses the original
 * `tasks/initial-plan.ts:parseInitialPlanningResponseV2` questions. It never
 * calls `proposeInitialPlanFromAnswer` (which may write a candidate). Every path
 * here is READ-ONLY (rule 20).
 *
 * [lead S5-A6] The dependency types expose ONLY read/lookup capabilities and
 * the named `PlanTaskPort` reader; no `GoalRecordTransactionPort.commit`.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  DEFAULT_GOAL_SETTINGS_V1,
  decisionSourceKey,
  type GoalDecisionBasisV1,
} from '../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { S5_QUERY_JOB_BY_GOAL, decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import type { DecisionCardV1, DecisionSourceAttempt, DecisionSourcePageV1 } from '../model/decision-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import { parseInitialPlanningResponseV2 } from './initial-plan.js';

/** The read-only Store subset: canonical reads and lookup only. */
export type PlanningQuestionReaderRecords =
  Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>;

/**
 * The narrow record readers plus the `PlanTaskPort.readInitialPlanAnswerFacts`
 * seam (spec §4.2 line 816), the same dependency bag the Plan service uses. The
 * named seam exports the original Job/manifest/body checks; the reader must not
 * copy them (§4.2 line 821).
 */
export type PlanningQuestionReaderDependencies = {
  records: PlanningQuestionReaderRecords;
  plans: Pick<PlanTaskPort, 'readInitialPlanAnswerFacts'>;
};

/** §4.2: one page of the saved planning questions, as decision cards, read-only. */
export interface PlanningQuestionReader {
  readPlanningQuestions(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor;
      attempt?: DecisionSourceAttempt } },
  ): Promise<ReadResult<DecisionSourcePageV1<DecisionCardV1>>>;
}

const LOOKUP_PAGE_LIMIT = 200;

function basisOf(goal: GoalSnapshot): GoalDecisionBasisV1 {
  return {
    goalRef: goal.ref, workspaceRef: goal.workspaceRef, objective: goal.objective,
    activePlanRef: goal.activePlanRevision, settings: goal.settings ?? DEFAULT_GOAL_SETTINGS_V1,
  };
}

/** Builds the saved planning-question reader; the factory itself never throws. */
export function createPlanningQuestionReader(
  deps: PlanningQuestionReaderDependencies,
): PlanningQuestionReader {
  const { records, plans } = deps;

  async function readGoal(goalRef: GoalRef): Promise<{ ok: true; goal: GoalSnapshot } | { ok: false; rejection: CoreRejection }> {
    const key = canonicalJson(goalRef as unknown as JsonValue);
    let read: Awaited<ReturnType<PlanningQuestionReaderRecords['readMany']>>;
    try {
      read = await records.readMany([key]);
    } catch (error) {
      return { ok: false, rejection: { status: 'rejected', code: 'unavailable',
        reason: `the Goal could not be read: ${error instanceof Error ? error.message : String(error)}` } };
    }
    // A read failure is returned, never converted into `not_found`; absence is
    // the `record === undefined` case below. A store `not_found` stays
    // `not_found`; every other store failure is `unavailable`.
    if (read.status !== 'ready') {
      return { ok: false, rejection: { status: 'rejected',
        code: read.code === 'not_found' ? 'not_found' : 'unavailable', reason: read.reason } };
    }
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) {
      return { ok: false, rejection: { status: 'rejected', code: 'not_found', reason: 'the Goal does not exist' } };
    }
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: { status: 'rejected', code: 'unavailable',
        reason: `the Goal is corrupt: ${decoded.reason}` } };
    }
    return { ok: true, goal: decoded.value };
  }

  /** Every matching refKey of one real lookup index, paged to the very end
   * (2A L10: no whole-window page cap; an over-capacity read no longer fails). */
  async function lookupKeys(
    index: string,
    values: readonly (string | number | boolean | null)[],
  ): Promise<{ refKeys: string[]; readThrough: CommitCursor | null } | null> {
    const refKeys: string[] = [];
    let after: string | undefined;
    let watermark: CommitCursor | null = null;
    for (;;) {
      const result = await records.lookup(after === undefined
        ? { index, values, limit: LOOKUP_PAGE_LIMIT }
        : { index, values, after, limit: LOOKUP_PAGE_LIMIT });
      if (result.status !== 'ready') return null;
      for (const record of result.value.records) refKeys.push(record.refKey);
      watermark = result.value.readThrough ?? watermark;
      if (result.value.next === null) return { refKeys, readThrough: watermark };
      after = result.value.next;
    }
  }

  return {
    async readPlanningQuestions(ctx, input) {
      if (input.goalRef.projectId !== ctx.projectId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Goal belongs to another project' };
      }
      const goalRead = await readGoal(input.goalRef);
      if (!goalRead.ok) return goalRead.rejection;
      const goal = goalRead.goal;
      if (goal.workspaceRef.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Goal belongs to another workspace' };
      }
      const reader = plans.readInitialPlanAnswerFacts;
      if (reader === undefined) {
        return { status: 'ready', value: { availability: 'not_available', items: [], nextCursor: null, sourceCursor: null } };
      }
      // L11/P1: within one queue window attempt the whole question set is built
      // once and every internal page is served from that one assembly.
      const cacheKey = `s2a-planning:${canonicalJson(input.goalRef as unknown as JsonValue)}`;
      type Built = { cards: DecisionCardV1[]; readThrough: CommitCursor | null };
      let built = input.page.attempt?.cache.get(cacheKey) as Built | undefined;
      if (built === undefined) {
        const found = await lookupKeys(S5_QUERY_JOB_BY_GOAL,
          [input.goalRef.projectId, goal.workspaceRef.workspaceId, input.goalRef.goalId]);
        if (found === null) {
          return { status: 'rejected', code: 'incomplete', reason: 'the query-job-by-workspace-goal lookup is not available' };
        }
        const canonical = await records.readMany(found.refKeys);
        if (canonical.status !== 'ready') {
          return { status: 'rejected', code: 'unavailable', reason: `the planning jobs could not be read: ${canonical.code}` };
        }
        const cards: DecisionCardV1[] = [];
        for (const refKey of found.refKeys) {
          const record = canonical.value.records.find((candidate) => candidate.refKey === refKey);
          if (record === undefined) {
            return { status: 'rejected', code: 'unavailable', reason: 'a listed planning QueryJob is missing' };
          }
          const decoded = decodeQueryJobSnapshot(record);
          if (decoded.status !== 'decoded') {
            return { status: 'rejected', code: 'unavailable', reason: `a listed planning QueryJob is corrupt: ${decoded.reason}` };
          }
          const job = decoded.value;
          if (job.job.status !== 'answered') continue;
          // A planning-question read consumes only initial_coordination jobs. For
          // any other intent `readInitialPlanAnswerFacts` answers `invalid` ("not
          // an initial_coordination request"), which is a selection mismatch, not
          // a read failure: skip the job instead of returning it as a rejection.
          if (job.job.intent.execution.kind !== 'initial_coordination') continue;
          for (const answerRef of job.job.answerRefs) {
            const facts = await reader.call(plans, ctx, answerRef);
            // §4.2 rule: a failed formal Answer read is RETURNED, never skipped
            // into an apparently complete (or empty) page.
            if (facts.status !== 'ready') {
              if (facts.status === 'rejected') {
                return { status: 'rejected', code: facts.code, reason: facts.reason };
              }
              if (facts.status === 'not_found') {
                return { status: 'rejected', code: 'unavailable', reason: 'the formal planning answer does not exist' };
              }
              return { status: 'rejected', code: 'incomplete', reason: 'the formal planning answer is not readable' };
            }
            const parsed = parseInitialPlanningResponseV2(facts.value.answerText);
            if (parsed.status !== 'parsed' || parsed.response.kind !== 'needs_decision') continue;
            for (const [questionIndex] of parsed.response.questions.entries()) {
              const source = decisionSourceKey({ kind: 'planning_question', answerRef, questionIndex });
              const pins: VersionPin[] = [
                { ref: goal.ref, revision: goal.revision },
                { ref: answerRef, revision: 1 },
                { ref: job.ref, revision: job.revision },
              ];
              cards.push({
                cardKey: source,
                source: { kind: 'planning_question', key: source, goalRef: goal.ref, pins, goalBases: [basisOf(goal)] },
                state: 'waiting_answer',
                goalRef: goal.ref,
                senderSessionRef: null,
                requestRef: null,
                objects: [],
                options: [],
                answerMessageRef: null,
                answer: null,
                application: null,
                candidateStatus: null,
                staleReason: null,
                closedReason: null,
                readOnly: false,
                actions: ['answer'],
              });
            }
          }
        }
        built = { cards, readThrough: found.readThrough };
        input.page.attempt?.cache.set(cacheKey, built);
      }
      const cards = built.cards;
      const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
      const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
      const end = Math.min(cards.length, start + input.page.limit);
      return { status: 'ready', value: {
        availability: 'available',
        items: cards.slice(start, end),
        nextCursor: end < cards.length ? String(end) : null,
        sourceCursor: built.readThrough,
      } };
    },
  };
}
