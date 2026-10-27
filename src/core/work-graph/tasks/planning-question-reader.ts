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
 * Three source families feed one page, each discovered its own way: plain answers by the by-Goal QueryJob index,
 * bindings by the binding's by-Goal index, and `prepared_goal` by the answered request rounds frozen for this Goal.
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
  decisionSourceKey,
  type GoalDecisionBasisV1,
  type PlanningQuestionIdentityV1,
} from '../../../contracts/goal-decisions.js';
import type { InitializationBindingRef, InitializationBindingV1 } from '../../../contracts/initialization-binding.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { InitialPlanAnswerFacts, QueryJobAnswerRef, QueryJobSnapshot } from '../../../contracts/query-job.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { S5_QUERY_JOB_BY_GOAL, decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import type { DecisionCardV1, DecisionSourceAttempt, DecisionSourcePageV1 } from '../model/decision-contracts.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import { QUERY_OPEN_BY_WORKSPACE_INDEX } from '../model/request-contracts.js';
import { sameRef } from '../state/ref-equality.js';
import { parseInitialPlanningResponseV2 } from './initial-plan.js';
import { laterCursor } from './plan-readers.js';

/** The read-only Store subset: canonical reads and lookup only. */
export type PlanningQuestionReaderRecords =
  Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>;

/**
 * The narrow record readers plus the `PlanTaskPort.readInitialPlanAnswerFacts`
 * seam (spec §4.2 line 816), the same dependency bag the Plan service uses. The
 * named seam exports the original Job/manifest/body checks; the reader must not
 * copy them (§4.2 line 821). `bindings` is the initialization binding read the
 * binding sources are enumerated from.
 */
export type PlanningQuestionReaderDependencies = {
  records: PlanningQuestionReaderRecords;
  plans: Pick<PlanTaskPort, 'readInitialPlanAnswerFacts'>;
  bindings: InitializationBindingReadPort;
  /** The page width of one lookup batch; the default stays today's 200. */
  lookupPageLimit?: number;
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
    activePlanRef: goal.activePlanRevision, settings: goal.settings,
  };
}

/** One parsed `needs_decision` answer, kept so every Goal builds only its own page from it. */
type AnsweredRound = {
  answerRef: QueryJobAnswerRef;
  answerText: string;
  job: QueryJobSnapshot;
  goalRef: GoalRef;
};

/** Builds the saved planning-question reader; the factory itself never throws. */
export function createPlanningQuestionReader(
  deps: PlanningQuestionReaderDependencies,
): PlanningQuestionReader {
  const { records, plans, bindings } = deps;
  const lookupPageLimit = deps.lookupPageLimit ?? LOOKUP_PAGE_LIMIT;

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
        ? { index, values, limit: lookupPageLimit }
        : { index, values, after, limit: lookupPageLimit });
      if (result.status !== 'ready') return null;
      for (const record of result.value.records) refKeys.push(record.refKey);
      watermark = result.value.readThrough ?? watermark;
      if (result.value.next === null) return { refKeys, readThrough: watermark };
      after = result.value.next;
    }
  }

  /** The formal answer read's failures are RETURNED, never skipped into an apparently complete or empty page. */
  function answerFailure(facts: ReadResult<InitialPlanAnswerFacts>): CoreRejection | null {
    if (facts.status === 'ready') return null;
    if (facts.status === 'rejected') return { status: 'rejected', code: facts.code, reason: facts.reason };
    if (facts.status === 'not_found') {
      return { status: 'rejected', code: 'unavailable', reason: 'the formal planning answer does not exist' };
    }
    return { status: 'rejected', code: 'incomplete', reason: 'the formal planning answer is not readable' };
  }

  /** The `needs_decision` questions of one saved answer as cards of the given Goal and binding selector. */
  function questionCards(input: {
    answerRef: QueryJobAnswerRef; answerText: string; job: QueryJobSnapshot;
    goal: GoalSnapshot; binding?: InitializationBindingRef;
  }): DecisionCardV1[] {
    const parsed = parseInitialPlanningResponseV2(input.answerText);
    if (parsed.status !== 'parsed' || parsed.response.kind !== 'needs_decision') return [];
    const pins: VersionPin[] = [
      { ref: structuredClone(input.goal.ref), revision: input.goal.revision },
      { ref: structuredClone(input.answerRef), revision: 1 },
      { ref: structuredClone(input.job.ref), revision: input.job.revision },
    ];
    if (input.binding !== undefined) pins.push({ ref: structuredClone(input.binding), revision: 1 });
    const cards: DecisionCardV1[] = [];
    for (const [questionIndex] of parsed.response.questions.entries()) {
      const identity: PlanningQuestionIdentityV1 = {
        kind: 'planning_question', answerRef: input.answerRef, questionIndex,
        ...(input.binding === undefined ? {} : { binding: input.binding }),
      };
      const source = decisionSourceKey(identity);
      cards.push({
        cardKey: source,
        source: { kind: 'planning_question', key: source,
          subject: { kind: 'goal', goalRef: input.goal.ref }, pins, goalBases: [basisOf(input.goal)] },
        state: 'waiting_answer',
        subject: { kind: 'goal', goalRef: input.goal.ref },
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
    return cards;
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
      const attempt = input.page.attempt;
      // L11/P1: within one queue window attempt the whole question set is built
      // once and every internal page is served from that one assembly.
      const cacheKey = `s2a-planning:${canonicalJson(input.goalRef as unknown as JsonValue)}`;
      const bindingsKey = `s2a-planning:bindings:${ctx.projectId}:${ctx.workspaceId}`;
      const answeredKey = `s2a-planning:answered:${ctx.projectId}:${ctx.workspaceId}`;
      type Built = { cards: DecisionCardV1[]; readThrough: CommitCursor | null };
      let built = attempt?.cache.get(cacheKey) as Built | undefined;
      if (built === undefined) {
        const cards: DecisionCardV1[] = [];
        let readThrough: CommitCursor | null = null;
        // ---- the plain Query answers of this Goal (today's branch) ----------
        const found = await lookupKeys(S5_QUERY_JOB_BY_GOAL,
          [input.goalRef.projectId, goal.workspaceRef.workspaceId, input.goalRef.goalId]);
        if (found === null) {
          return { status: 'rejected', code: 'incomplete', reason: 'the query-job-by-workspace-goal lookup is not available' };
        }
        readThrough = laterCursor(readThrough, found.readThrough);
        const canonical = await records.readMany(found.refKeys);
        if (canonical.status !== 'ready') {
          return { status: 'rejected', code: 'unavailable', reason: `the planning jobs could not be read: ${canonical.code}` };
        }
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
            const failure = answerFailure(facts);
            if (failure !== null) return failure;
            if (facts.status !== 'ready') continue;
            cards.push(...questionCards({ answerRef, answerText: facts.value.answerText, job: facts.value.job, goal }));
          }
        }
        // ---- the binding answers of this Goal (by the binding's Goal index) --
        // The assembly's binding cache is indexed by Goal and then by binding ref; a later page re-reads none.
        const goalKey = canonicalJson(input.goalRef as unknown as JsonValue);
        type BindingIndex = Map<string, Map<string, InitializationBindingV1>>;
        let index = attempt?.cache.get(bindingsKey) as BindingIndex | undefined;
        if (index === undefined) {
          index = new Map();
          attempt?.cache.set(bindingsKey, index);
        }
        let own = index.get(goalKey);
        if (own === undefined) {
          own = new Map();
          index.set(goalKey, own);
        }
        const goalBindings = own;
        const byGoal = await bindings.readBindingByGoal(ctx, { goalRef: input.goalRef });
        if (byGoal.status === 'not_found') {
          return { status: 'rejected', code: 'unavailable', reason: 'the initialization bindings by Goal are not readable' };
        }
        if (byGoal.status !== 'ready') return byGoal;
        // One by-Goal read per Goal in the assembly; this Goal's own bindings answer every later page.
        for (const binding of byGoal.value) {
          const refKey = canonicalJson(binding.ref as unknown as JsonValue);
          if (!goalBindings.has(refKey)) goalBindings.set(refKey, binding);
        }
        for (const binding of goalBindings.values()) {
          const facts = await reader.call(plans, ctx, binding.answerRef,
            { kind: 'binding', answerRef: binding.answerRef, draftIndex: binding.draftIndex });
          const failure = answerFailure(facts);
          if (failure !== null) return failure;
          if (facts.status !== 'ready') continue;
          cards.push(...questionCards({ answerRef: binding.answerRef, answerText: facts.value.answerText,
            job: facts.value.job, goal, binding: binding.ref }));
        }
        // ---- the workspace's answered goal requests, once per assembly ------
        let answered = attempt?.cache.get(answeredKey) as
          { rounds: AnsweredRound[]; readThrough: CommitCursor | null } | undefined;
        if (answered === undefined) {
          const rounds: AnsweredRound[] = [];
          let answeredThrough: CommitCursor | null = null;
          const listed = await lookupKeys(QUERY_OPEN_BY_WORKSPACE_INDEX,
            [ctx.projectId, ctx.workspaceId, 'request', 'answered']);
          if (listed === null) {
            return { status: 'rejected', code: 'incomplete', reason: 'the answered-request lookup is not available' };
          }
          answeredThrough = listed.readThrough;
          const jobsRead = await records.readMany(listed.refKeys);
          if (jobsRead.status !== 'ready') {
            return { status: 'rejected', code: 'unavailable', reason: `the answered request rounds could not be read: ${jobsRead.code}` };
          }
          const recordsByRefKey = new Map(jobsRead.value.records.map((record) => [record.refKey, record] as const));
          for (const refKey of listed.refKeys) {
            const record = recordsByRefKey.get(refKey);
            if (record === undefined) {
              return { status: 'rejected', code: 'unavailable', reason: 'a listed answered request round is missing' };
            }
            const decoded = decodeQueryJobSnapshot(record);
            if (decoded.status !== 'decoded') {
              return { status: 'rejected', code: 'unavailable', reason: `a listed answered request round is corrupt: ${decoded.reason}` };
            }
            const job = decoded.value;
            if (job.job.status !== 'answered') continue;
            // The plain branch owns initial_coordination Jobs; a goal request's Job is identified by its frozen manifest.
            if (job.job.intent.execution.kind === 'initial_coordination') continue;
            for (const answerRef of job.job.answerRefs) {
              const facts = await reader.call(plans, ctx, answerRef, { kind: 'prepared_goal', answerRef });
              // source_stale is the read's verdict that this answer is not a prepared_goal source.
              if (facts.status === 'rejected' && facts.code === 'source_stale') continue;
              const failure = answerFailure(facts);
              if (failure !== null) return failure;
              if (facts.status !== 'ready') continue;
              const resolution = facts.value.resolution;
              rounds.push({ answerRef, answerText: facts.value.answerText, job: facts.value.job,
                goalRef: resolution.goal });
            }
          }
          answered = { rounds, readThrough: answeredThrough };
          attempt?.cache.set(answeredKey, answered);
        }
        readThrough = laterCursor(readThrough, answered.readThrough);
        for (const round of answered.rounds) {
          if (!sameRef(round.goalRef, input.goalRef)) continue;
          cards.push(...questionCards({ answerRef: round.answerRef, answerText: round.answerText,
            job: round.job, goal }));
        }
        built = { cards, readThrough };
        attempt?.cache.set(cacheKey, built);
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
