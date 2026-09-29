/**
 * Goal-conversation start — Stage 1 red contract.
 *
 * A first explicit Send in a newly opened workspace (empty modelId/queryProfiles)
 * must capture the originating scope and the exact question + references, create
 * the formal Goal exactly once, and then either
 *   - continue the EXISTING `runExecution(scope, 'investigate')` path when a
 *     query profile exists, or
 *   - keep the created Goal and the original draft, offer the actionable
 *     `选择模型并开始调查` settings action and never claim a conversation started.
 *
 * The explicit `开始调查` after settings selection must re-read the CURRENT
 * bootstrap profile for the ORIGINAL scope; it may not reuse the null first-Send
 * snapshot. An already-occupied original Session that owns a QueryRun in phase
 * `claimed`/`prepared` is resumed in place (same run/session, prepare -> start ->
 * answer/history, no fresh Goal/Session/submit/claim and no occupancy clear);
 * `entering`/`entered`/`unknown`/`settled` only report the persisted state.
 *
 * These tests pin that contract through the import-safe exported seam in
 * `src/ui/main.ts`. Importing `main.ts` must not boot the DOM. Stage 1 owns only
 * the seam, so every behavior below is EXPECTED RED until Stage 2 is approved.
 */
import { describe, expect, it } from 'vitest';
import { createGoalConversationStart, goalConversationQueryRunRef } from '../../src/ui/main.js';
import type {
  GoalConversationStartDeps,
  GoalConversationStartOriginalRun,
  GoalConversationStartProfile,
  GoalConversationStartRequest,
  GoalConversationStartSessionRefs,
  GoalConversationStartStartResult,
} from '../../src/ui/main.js';
import type {
  CoreScope,
  PreparedQueryExecution,
  QueryJobAnswerSnapshot,
  QueryJobRef,
  QueryRunRef,
  SessionRef,
} from '../../src/app/core-http-types.js';

const ORIGIN: CoreScope = { projectId: 'project-origin', workspaceId: 'workspace-origin' };
const SESSION: SessionRef = { projectId: ORIGIN.projectId, sessionId: 'session-original' };
const BOUND_SESSION: SessionRef = { projectId: ORIGIN.projectId, sessionId: 'session-bound' };
const MEMBER_SESSION: SessionRef = { projectId: ORIGIN.projectId, sessionId: 'session-member-later' };
const QUESTION = '请阅读当前来源并给出正式回答';
const PATH_REFERENCE = { kind: 'path' as const, path: 'src/index.ts' };

const QUERY_JOB: QueryJobRef = { aggregateType: 'QueryJob', projectId: ORIGIN.projectId,
  workspaceId: ORIGIN.workspaceId, queryJobId: 'qjob-original' };
const QUERY_RUN: QueryRunRef = { aggregateType: 'QueryRun', projectId: ORIGIN.projectId,
  workspaceId: ORIGIN.workspaceId, queryJobId: QUERY_JOB.queryJobId, runId: 'qrun-original' };
const ANSWER_REF: QueryJobAnswerSnapshot['ref'] = { aggregateType: 'QueryJobAnswer',
  projectId: ORIGIN.projectId, workspaceId: ORIGIN.workspaceId,
  queryJobId: QUERY_JOB.queryJobId, answerId: 'answer-original' };
const PREPARED: PreparedQueryExecution = {
  queryRunRef: QUERY_RUN,
  bundleRef: { kind: 'artifact', contentType: 'application/json', digest: 'sha256:prepared', sizeBytes: 1,
    source: { kind: 'workspace', refId: ORIGIN.workspaceId, revision: '1' } },
  inputDigest: 'sha256:input',
};

type ResumePhase = NonNullable<GoalConversationStartOriginalRun['executionState']>['phase'];
type InvestigationInput = Parameters<GoalConversationStartDeps['continueInvestigation']>[0];
type GoalInput = Parameters<GoalConversationStartDeps['createGoal']>[0];
type StartInput = Parameters<GoalConversationStartDeps['startQuery']>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function originalRun(phase: ResumePhase, sessionRef: SessionRef): GoalConversationStartOriginalRun {
  return { runRef: QUERY_RUN, executionState: { phase, sessionRef } };
}

function makeDeps() {
  const goalGate = deferred<string>();
  const goalCalls: GoalInput[] = [];
  const investigationCalls: InvestigationInput[] = [];
  const historyCalls: SessionRef[] = [];
  const profileLookups: CoreScope[] = [];
  const queryReads: QueryJobRef[] = [];
  const prepareCalls: QueryRunRef[] = [];
  const startCalls: StartInput[] = [];
  const answerCalls: QueryJobAnswerSnapshot['ref'][] = [];
  const trace: string[] = [];
  let settingsOpened = 0;
  let currentProfile: GoalConversationStartProfile | null = null;
  let queryReadValue: GoalConversationStartOriginalRun = originalRun('claimed', SESSION);
  let startResult: GoalConversationStartStartResult = { runRef: QUERY_RUN,
    sessionRef: { ...SESSION, aggregateType: 'Session' }, answerRef: ANSWER_REF };
  const deps: GoalConversationStartDeps = {
    createGoal: input => { goalCalls.push(input); return goalGate.promise; },
    continueInvestigation: async input => { trace.push('continueInvestigation'); investigationCalls.push(input);
      return { sessionRef: BOUND_SESSION }; },
    readHistory: async sessionRef => { trace.push('readHistory'); historyCalls.push(sessionRef); },
    openSettings: () => { settingsOpened += 1; },
    lookupProfile: origin => { trace.push('lookupProfile'); profileLookups.push(origin); return currentProfile; },
    readQueryJob: async ref => { trace.push('readQueryJob'); queryReads.push(ref); return queryReadValue; },
    prepareQuery: async (ref, requestId) => { trace.push('prepareQuery'); prepareCalls.push(ref); void requestId; return PREPARED; },
    startQuery: async input => { trace.push('startQuery'); startCalls.push(input); return startResult; },
    readAnswer: async ref => { trace.push('readAnswer'); answerCalls.push(ref); },
  };
  return { deps, goalCalls, investigationCalls, historyCalls, profileLookups, queryReads,
    prepareCalls, startCalls, answerCalls, trace,
    resolveGoal: (id = 'goal-1') => goalGate.resolve(id),
    setProfile: (profile: GoalConversationStartProfile | null) => { currentProfile = profile; },
    setQueryRead: (value: GoalConversationStartOriginalRun) => { queryReadValue = value; },
    setStartResult: (value: GoalConversationStartStartResult) => { startResult = value; },
    settingsOpened: () => settingsOpened };
}

function request(profileId: string | null): GoalConversationStartRequest {
  return { origin: { ...ORIGIN }, objective: '让项目跑起来', question: QUESTION,
    references: [{ ...PATH_REFERENCE }], profileId, fromMain: true, selectedSession: null };
}

describe('goal-conversation start seam (expected red until Stage 2)', () => {
  it('freezes the originating scope, question + references and MAIN target while createGoal is still awaiting', async () => {
    const calls = makeDeps();
    const controller = createGoalConversationStart(calls.deps);
    const sent = request('profile-1');

    const begun = controller.begin(sent);
    // Mutate the live draft/scope AND select another member in the SAME scope
    // while the first Send is awaiting its Goal. Continuation must stay the
    // original MAIN conversation, not the later selection.
    sent.origin.workspaceId = 'workspace-changed';
    sent.question = 'changed while createGoal awaits';
    sent.references.length = 0;
    sent.fromMain = false;
    sent.selectedSession = MEMBER_SESSION;
    calls.resolveGoal('goal-1');
    await begun;

    expect(calls.goalCalls).toEqual([{ origin: ORIGIN, objective: '让项目跑起来' }]);
    expect(calls.investigationCalls).toEqual([{ origin: ORIGIN, goalId: 'goal-1', profileId: 'profile-1',
      question: QUESTION, references: [PATH_REFERENCE], fromMain: true, selectedSession: null }]);
    const snapshot = controller.snapshot();
    expect(snapshot.origin).toEqual(ORIGIN);
    expect(snapshot.question).toBe(QUESTION);
    expect(snapshot.references).toEqual([PATH_REFERENCE]);
    expect(snapshot.fromMain).toBe(true);
    expect(snapshot.selectedSession).toBeNull();
  });

  it('turns a first-Send double click into exactly one Goal and one investigation', async () => {
    const calls = makeDeps();
    const controller = createGoalConversationStart(calls.deps);

    const first = controller.begin(request('profile-1'));
    const second = controller.begin(request('profile-1'));
    calls.resolveGoal('goal-1');
    await Promise.all([first, second]);

    expect(calls.goalCalls).toHaveLength(1);
    expect(calls.investigationCalls).toHaveLength(1);
  });

  it('re-reads the CURRENT profile on explicit start after a missing-profile first Send', async () => {
    const calls = makeDeps();
    const controller = createGoalConversationStart(calls.deps);

    const begun = controller.begin(request(null));
    calls.resolveGoal('goal-1');
    await begun;
    expect(calls.investigationCalls).toHaveLength(0);
    expect(controller.snapshot().status).toBe('needs_profile');
    expect(controller.snapshot().action).toBe('选择模型并开始调查');

    // Opening settings is an explicit settings action, never a model call.
    controller.openModelSettings();
    expect(calls.settingsOpened()).toBe(1);
    expect(calls.investigationCalls).toHaveLength(0);

    // The user selected a model/workspace; the CURRENT bootstrap now has a
    // profile for the ORIGINAL scope, and explicit start honors it.
    calls.setProfile({ id: 'profile-fresh', consumerId: 'consumer-fresh' });
    await controller.startInvestigation();

    expect(calls.profileLookups).toEqual([ORIGIN]);
    expect(calls.goalCalls).toHaveLength(1);
    expect(calls.investigationCalls).toHaveLength(1);
    expect(calls.investigationCalls[0]).toMatchObject({ origin: ORIGIN, goalId: 'goal-1',
      profileId: 'profile-fresh' });
  });

  it.each(['claimed', 'prepared'] as const)(
    'resumes the SAME original %s run/session without a fresh Goal or Query submission',
    async phase => {
      const calls = makeDeps();
      const controller = createGoalConversationStart(calls.deps);
      calls.setProfile({ id: 'profile-1', consumerId: 'consumer-1' });
      calls.setQueryRead(originalRun(phase, SESSION));

      const occupied: GoalConversationStartSessionRefs = {
        occupancy: { kind: 'execution', executionRef: QUERY_RUN, generation: 1 },
        lastExecutionRef: QUERY_RUN,
      };
      const original = goalConversationQueryRunRef(occupied);
      expect(original).toEqual(QUERY_RUN);
      if (original === null) throw new Error('the occupied Session must name its QueryRun');

      await controller.resumeOriginal(original, SESSION);

      expect(calls.trace[0]).toBe('lookupProfile');
      expect(calls.profileLookups).toEqual([ORIGIN]);
      expect(calls.queryReads).toEqual([QUERY_JOB]);
      expect(calls.prepareCalls).toEqual([QUERY_RUN]);
      expect(calls.startCalls).toHaveLength(1);
      expect(calls.startCalls[0]?.prepared).toBe(PREPARED);
      expect(calls.startCalls[0]?.consumerId).toBe('consumer-1');
      expect(calls.answerCalls).toEqual([ANSWER_REF]);
      expect(calls.historyCalls).toEqual([SESSION]);
      expect(calls.goalCalls).toHaveLength(0);
      expect(calls.investigationCalls).toHaveLength(0);
      expect(controller.snapshot().status).toBe('recovered');
    },
  );

  it('reports an original run that ended without an answer truthfully on resume', async () => {
    const calls = makeDeps();
    const controller = createGoalConversationStart(calls.deps);
    calls.setProfile({ id: 'profile-1', consumerId: 'consumer-1' });
    calls.setQueryRead(originalRun('claimed', SESSION));
    calls.setStartResult({ runRef: QUERY_RUN, sessionRef: { ...SESSION, aggregateType: 'Session' },
      answerRef: null, outcome: 'timeout', phase: 'settled', status: 'closed' });

    await controller.resumeOriginal(QUERY_RUN, SESSION);

    const snapshot = controller.snapshot();
    expect(snapshot.status).toBe('recovered');
    expect(snapshot.notice).toContain('timeout');
    expect(snapshot.notice).not.toContain('尚未产生正式回答');
    expect(calls.answerCalls).toHaveLength(0);
    expect(calls.historyCalls).toEqual([SESSION]);
  });

  it.each(['entering', 'entered', 'unknown', 'settled'] as const)(
    'does not restart an original %s run and only reports the persisted state',
    async phase => {
      const calls = makeDeps();
      const controller = createGoalConversationStart(calls.deps);
      calls.setProfile({ id: 'profile-1', consumerId: 'consumer-1' });
      calls.setQueryRead(originalRun(phase, SESSION));

      await controller.resumeOriginal(QUERY_RUN, SESSION);

      expect(calls.prepareCalls).toHaveLength(0);
      expect(calls.startCalls).toHaveLength(0);
      expect(calls.answerCalls).toHaveLength(0);
      expect(calls.historyCalls).toHaveLength(0);
      expect(calls.goalCalls).toHaveLength(0);
      expect(calls.investigationCalls).toHaveLength(0);
      expect(controller.snapshot().status).toBe('observe_only');
    },
  );

  it('refuses recovery when queries/read reports a different run or session', async () => {
    const calls = makeDeps();
    const controller = createGoalConversationStart(calls.deps);
    calls.setProfile({ id: 'profile-1', consumerId: 'consumer-1' });
    calls.setQueryRead({ runRef: { ...QUERY_RUN, runId: 'qrun-other' },
      executionState: { phase: 'claimed', sessionRef: SESSION } });

    await controller.resumeOriginal(QUERY_RUN, SESSION);

    expect(calls.prepareCalls).toHaveLength(0);
    expect(calls.startCalls).toHaveLength(0);
    expect(controller.snapshot().status).toBe('unavailable');
  });
});
