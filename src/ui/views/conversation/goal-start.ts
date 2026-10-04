import type {
  BootstrapExecutionQueryProfile,
  CoreScope,
  PreparedQueryExecution,
  QueriesReadResponse,
  QueryExecutionRecord,
  QueryJobAnswerSnapshot,
  QueryJobRef,
  QueryRunRef,
  SessionRecord,
  SessionRef,
} from '../../../app/core-http-types.js';
import type { WorkbenchDraftReference } from '../../state/layout.js';
import { sameSession } from '../../state/values.js';
import { freshRequestId } from '../../state/workbench.js';

/**
 * Goal-conversation start seam (Stage 1 skeleton, expected red).
 *
 * A first explicit Send in a newly opened workspace must freeze its originating
 * scope and the exact question + references, create the formal Goal exactly once,
 * and only then continue the EXISTING `runExecution(scope, 'investigate')` path
 * when a query profile exists. With no profile it keeps the created Goal and the
 * original draft, offers `选择模型并开始调查`, and never claims a conversation
 * started. Opening/saving settings alone never calls the model. A later draft or
 * scope change must not rewrite the frozen request or leak it across scopes.
 *
 * The SAME controller owns the explicit recovery of an already-occupied original
 * Session: its persisted `occupancy`/`lastExecutionRef` already names a QueryRun,
 * and the formal `queries/read(QueryJobRef)` returns the job/run whose
 * `run.run.executionState.phase` is `claimed` or `prepared`. Recovery re-reads the
 * CURRENT profile for the ORIGINAL scope, verifies the returned run/session and
 * the persisted phase, and then continues `prepare -> start -> answer/history` on
 * that SAME run/session. It never creates a Goal/Session, never submits or claims
 * a fresh Query and never clears occupancy. `entering`/`entered`/`unknown`/
 * `settled` (or an absent phase) must NOT restart: the seam only reads and
 * reports the real state. An already-occupied Session is the valid input; there
 * is no idle precondition.
 *
 * Every field below is derived from the real DTOs (`SessionRecord`,
 * `QueriesReadResponse`/`QueryJobRecord`/`QueryRunSnapshot`/
 * `QueryExecutionStateV1`, `PreparedQueryExecution`, `QueryExecutionRecord`) via
 * `core-http-types`; no shape is invented. The controller is DOM-free and takes
 * the EXISTING operations by injection, so tests pin the contract without
 * booting the browser entry. Stage 1 fixes only the seam and its red tests: every
 * behavior entry fails explicitly until the Stage 2 implementation is approved.
 * No new owner/manager is introduced.
 */

/** The fresh profile gate. Only the identity + consumer id are read; the full
 * `BootstrapExecutionQueryProfile` stays owned by the existing run path. */
export type GoalConversationStartProfile = Pick<BootstrapExecutionQueryProfile, 'id' | 'consumerId'>;

export type GoalConversationStartRequest = {
  origin: CoreScope;
  objective: string;
  question: string;
  references: WorkbenchDraftReference[];
  /** First-Send snapshot only. Explicit start/resume re-reads the CURRENT
   * bootstrap profile for the original scope. */
  profileId: string | null;
  /** Frozen recipient intent captured BEFORE the first await. Absent keeps the
   * live selection for an explicit existing action. */
  fromMain?: boolean;
  /** Exact member Session selected at Send, or null for the main conversation. */
  selectedSession?: SessionRef | null;
};

/** The exact `queries/read(QueryJobRef)` projection the seam verifies: the real
 * `QueryRunSnapshot.ref` plus the persisted `executionState.phase`/`sessionRef`.
 * A `null` executionState is a historical claim and never authorizes a restart. */
export type QueryReadJobValue = Extract<QueriesReadResponse, { status: 'ready' }>['value'];
type PersistedQueryExecutionState = NonNullable<QueryReadJobValue['run']['run']['executionState']>;
export type GoalConversationStartOriginalRun = {
  runRef: QueryReadJobValue['run']['ref'];
  executionState: Pick<PersistedQueryExecutionState, 'phase' | 'sessionRef'> | null;
};

/** The exact `queries/start` projection: the SAME run/session plus the optional
 * answer ref, picked from the real `QueryExecutionRecord`. */
export type GoalConversationStartStartResult = {
  runRef: QueryExecutionRecord['run']['ref'];
  sessionRef: QueryExecutionRecord['session']['ref'];
  answerRef: QueryJobAnswerSnapshot['ref'] | null;
  /** Narrow run facts for a truthful no-answer report, derived directly from the
   * returned `QueryExecutionRecord` (`QueryRunV1.outcome`/`status` and
   * `executionState.phase`). Optional so a caller that has a real answer keeps
   * the minimal projection. */
  outcome?: QueryExecutionRecord['run']['run']['outcome'];
  phase?: NonNullable<QueryExecutionRecord['run']['run']['executionState']>['phase'] | null;
  status?: QueryExecutionRecord['run']['run']['status'];
};

/** The truthful reading of a Query run that persisted NO answer. The values are
 * the real returned `QueryRunV1` fields: a formally ended run (non-null
 * `outcome`, or a `settled` phase/`closed` status) is never shown as waiting,
 * and nothing is inferred beyond the returned facts. */
export function queryNoAnswerNotice(run: {
  outcome: QueryExecutionRecord['run']['run']['outcome'];
  phase: NonNullable<QueryExecutionRecord['run']['run']['executionState']>['phase'] | null;
  status?: QueryExecutionRecord['run']['run']['status'] | undefined;
}): string {
  if (run.outcome !== null) {
    return `调查已结束（${run.outcome}），没有产生正式回答；可查看原调查事实，不会重新开始。`;
  }
  if (run.phase === 'settled' || run.status === 'closed') {
    return '调查已结束，没有产生正式回答；可查看原调查事实，不会重新开始。';
  }
  return '调查已受理但尚未产生正式回答；可点击“刷新执行状态”查看原调查。';
}

/** The original Session fields used to discover the already-occupied QueryRun:
 * the real `SessionRecord.occupancy` / `lastExecutionRef`. */
export type GoalConversationStartSessionRefs = Pick<SessionRecord, 'occupancy' | 'lastExecutionRef'>;

export type GoalConversationStartDeps = {
  /** Existing `goals/create` cold-start driver; called at most once per Send. */
  createGoal: (input: { origin: CoreScope; objective: string }) => Promise<string>;
  /** Existing `runExecution(scope, 'investigate')` path for a NEW run. It gets
   * the frozen origin scope, question and references and returns the bound main
   * Session. It is never used by the recovery path. */
  continueInvestigation: (input: { origin: CoreScope; goalId: string; profileId: string;
    question: string; references: WorkbenchDraftReference[];
    fromMain?: boolean; selectedSession?: SessionRef | null }) => Promise<{ sessionRef: SessionRef | null }>;
  /** Existing `sessions/history` read for the exact Session (the first-Send main
   * Session or the already-occupied original Session). */
  readHistory: (sessionRef: SessionRef) => Promise<void>;
  /** Existing model/workspace settings surface. Opening/saving it never calls
   * the model, so it never triggers `continueInvestigation`. */
  openSettings: () => void;
  /** CURRENT bootstrap profile for the ORIGINAL scope; re-read on every explicit
   * start/resume so a profile chosen after the first Send is honored. */
  lookupProfile: (origin: CoreScope) => GoalConversationStartProfile | null;
  /** Existing `queries/read` exact read keyed by the ORIGINAL QueryJobRef. */
  readQueryJob: (queryJobRef: QueryJobRef) => Promise<GoalConversationStartOriginalRun>;
  /** Existing `queries/prepare` on the SAME original run. */
  prepareQuery: (queryRunRef: QueryRunRef, requestId: string) => Promise<PreparedQueryExecution>;
  /** Existing `queries/start` on the SAME prepared original run. */
  startQuery: (input: { prepared: PreparedQueryExecution; consumerId: string;
    requestId: string }) => Promise<GoalConversationStartStartResult>;
  /** Existing `queries/answer` read for the SAME run. */
  readAnswer: (answerRef: QueryJobAnswerSnapshot['ref']) => Promise<void>;
};

export type GoalConversationStartStatus =
  | 'idle' | 'creating' | 'needs_profile' | 'investigating' | 'started'
  | 'recovering' | 'recovered' | 'observe_only' | 'unavailable' | 'failed';

export type GoalConversationStartSnapshot = {
  status: GoalConversationStartStatus;
  origin: CoreScope | null;
  objective: string;
  question: string;
  references: WorkbenchDraftReference[];
  goalId: string | null;
  /** Frozen recipient intent, preserved for an explicit missing-profile start. */
  fromMain: boolean;
  selectedSession: SessionRef | null;
  /** Actionable composer copy; null unless the Goal awaits a profile choice. */
  action: '选择模型并开始调查' | null;
  notice: string | null;
};

export type GoalConversationStartController = {
  snapshot(): GoalConversationStartSnapshot;
  /** The first explicit Send (the single Goal + optional follow-up). */
  begin(request: GoalConversationStartRequest): Promise<void>;
  /** Explicit `开始调查` on an existing Goal, even with no Session yet. It uses
   * the FRESH profile lookup, never the first-Send snapshot. */
  startInvestigation(): Promise<void>;
  /** Explicit resume of an already claimed/prepared ORIGINAL QueryRun on its
   * already-occupied Session. */
  resumeOriginal(queryRunRef: QueryRunRef, sessionRef: SessionRef): Promise<void>;
  /** Opens the existing settings (model/workspace selection). */
  openModelSettings(): void;
};

/** The original QueryRun an already-occupied Session owns, read from the exact
 * `SessionRecord` fields. Occupancy wins over `lastExecutionRef`; a non-QueryRun
 * execution ref (a Work Run) is not this seam's target. */
export function goalConversationQueryRunRef(session: GoalConversationStartSessionRefs): QueryRunRef | null {
  const occupied = session.occupancy;
  const candidate = occupied !== null && occupied.kind === 'execution' ? occupied.executionRef : session.lastExecutionRef;
  return candidate !== null && candidate.aggregateType === 'QueryRun' ? candidate : null;
}

/** The positively-read original QueryRun of one displayed Session. Only a ready
 * `queries/read` whose returned run and `executionState.sessionRef` match the
 * original scope/Session produces this value; it is a display/action candidate,
 * never a permission to start. */
export type ResumableOriginalRun = {
  session: SessionRef;
  queryRunRef: QueryRunRef;
  phase: NonNullable<GoalConversationStartOriginalRun['executionState']>['phase'];
};

/** Same QueryRun identity (aggregate + scope + job + run), never a title. */
export function sameQueryRunRef(left: QueryRunRef, right: QueryRunRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId && left.queryJobId === right.queryJobId && left.runId === right.runId;
}

export function queryJobRefOf(queryRunRef: QueryRunRef): QueryJobRef {
  return { aggregateType: 'QueryJob', projectId: queryRunRef.projectId,
    workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId };
}

/** Stage 2 seam factory. It drives the EXISTING GoalSetupRun/ExecutionRun
 * pipelines and keeps only the frozen first-Send intent plus the positively-read
 * recovery candidate. It is not a second owner and introduces no new store. */
export function createGoalConversationStart(deps: GoalConversationStartDeps): GoalConversationStartController {
  const state: GoalConversationStartSnapshot = {
    status: 'idle', origin: null, objective: '', question: '', references: [], goalId: null,
    fromMain: true, selectedSession: null, action: null, notice: null,
  };
  const cloneReferences = (references: WorkbenchDraftReference[]): WorkbenchDraftReference[] =>
    references.map(reference => ({ ...reference }));
  const uniqueRequestId = (key: string): string => `${key}-${freshRequestId(key)}`;

  const begin = async (request: GoalConversationStartRequest): Promise<void> => {
    // Singleflight is set synchronously before the first await, so a double
    // click can never create a second Goal or a second Query.
    if (state.status === 'creating' || state.status === 'investigating') return;
    if (state.goalId !== null && state.status !== 'failed') return;
    const origin = { ...request.origin };
    const question = request.question;
    const references = cloneReferences(request.references);
    // Freeze the recipient intent from THIS Send: a later member selection in
    // the same scope must not reroute the original main conversation.
    const fromMain = request.fromMain ?? (request.selectedSession === undefined || request.selectedSession === null);
    const selectedSession = request.selectedSession === undefined || request.selectedSession === null
      ? null : { ...request.selectedSession };
    state.origin = { ...origin };
    state.objective = request.objective;
    state.question = question;
    state.references = cloneReferences(references);
    state.fromMain = fromMain;
    state.selectedSession = selectedSession === null ? null : { ...selectedSession };
    state.goalId = null;
    state.action = null;
    state.notice = null;
    state.status = 'creating';
    let goalId: string;
    try {
      goalId = await deps.createGoal({ origin: { ...origin }, objective: request.objective });
    } catch (error) {
      state.status = 'failed';
      state.notice = `创建目标失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.goalId = goalId;
    // The first-Send snapshot decides only the IMMEDIATE continuation; explicit
    // later start/resume always re-reads the CURRENT bootstrap for the scope.
    if (request.profileId === null) {
      state.status = 'needs_profile';
      state.action = '选择模型并开始调查';
      state.notice = '目标已创建；当前工作区没有可用的模型/调查配置。';
      return;
    }
    state.status = 'investigating';
    try {
      await deps.continueInvestigation({ origin, goalId, profileId: request.profileId,
        question, references: cloneReferences(references), fromMain,
        selectedSession: selectedSession === null ? null : { ...selectedSession } });
    } catch (error) {
      state.status = 'failed';
      state.notice = `开始调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.status = 'started';
  };

  const startInvestigation = async (): Promise<void> => {
    if (state.status === 'creating' || state.status === 'investigating') return;
    if (state.goalId === null || state.origin === null) {
      state.status = 'unavailable';
      state.notice = '没有可开始调查的已创建目标。';
      return;
    }
    const origin = { ...state.origin };
    // Explicit start re-reads the CURRENT bootstrap profile for the ORIGINAL
    // scope; the first-Send null snapshot is never reused.
    const profile = deps.lookupProfile(origin);
    if (profile === null) {
      state.status = 'needs_profile';
      state.action = '选择模型并开始调查';
      state.notice = '当前工作区仍没有可用的模型/调查配置。';
      return;
    }
    state.status = 'investigating';
    state.action = null;
    try {
      await deps.continueInvestigation({ origin, goalId: state.goalId, profileId: profile.id,
        question: state.question, references: cloneReferences(state.references),
        fromMain: state.fromMain,
        selectedSession: state.selectedSession === null ? null : { ...state.selectedSession } });
    } catch (error) {
      state.status = 'failed';
      state.notice = `开始调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.status = 'started';
    state.notice = null;
  };

  const resumeOriginal = async (queryRunRef: QueryRunRef, sessionRef: SessionRef): Promise<void> => {
    if (state.status === 'recovering') return;
    const origin: CoreScope = { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId };
    state.origin = { ...origin };
    state.status = 'recovering';
    state.notice = null;
    state.action = null;
    // Profile gate FIRST. An already-occupied Session never needs to be idle,
    // but continuation does need a CURRENT profile for the original scope.
    const profile = deps.lookupProfile(origin);
    if (profile === null) {
      state.status = 'needs_profile';
      state.action = '选择模型并开始调查';
      state.notice = '当前工作区没有可用的模型/调查配置，无法继续准备原调查。';
      return;
    }
    let read: GoalConversationStartOriginalRun;
    try {
      read = await deps.readQueryJob(queryJobRefOf(queryRunRef));
    } catch (error) {
      state.status = 'unavailable';
      state.notice = `读取原调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    const persisted = read.executionState;
    if (!sameQueryRunRef(read.runRef, queryRunRef)
      || persisted === null || !sameSession(persisted.sessionRef, sessionRef)) {
      state.status = 'unavailable';
      state.notice = '原调查的运行或会话身份与当前会话不一致，不能继续。';
      return;
    }
    if (persisted.phase !== 'claimed' && persisted.phase !== 'prepared') {
      state.status = 'observe_only';
      state.notice = `原调查已进入 ${persisted.phase}，只能读取事实，不能重新开始。`;
      return;
    }
    let started: GoalConversationStartStartResult;
    try {
      const prepared = await deps.prepareQuery(read.runRef, uniqueRequestId('queries-prepare'));
      started = await deps.startQuery({ prepared, consumerId: profile.consumerId,
        requestId: uniqueRequestId('queries-start') });
    } catch (error) {
      state.status = 'failed';
      state.notice = `继续准备原调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (!sameQueryRunRef(started.runRef, queryRunRef) || !sameSession(started.sessionRef, sessionRef)) {
      state.status = 'unavailable';
      state.notice = '继续准备返回了不同的运行或会话，已停止且未重试。';
      return;
    }
    try {
      if (started.answerRef !== null) await deps.readAnswer(started.answerRef);
      await deps.readHistory(sessionRef);
    } catch (error) {
      state.status = 'failed';
      state.notice = `读取原调查结果失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.status = 'recovered';
    state.notice = started.answerRef !== null
      ? '已在原会话继续准备原调查。'
      : queryNoAnswerNotice({ outcome: started.outcome ?? null, phase: started.phase ?? null, status: started.status });
  };

  return {
    snapshot: () => ({ ...state, origin: state.origin === null ? null : { ...state.origin },
      references: state.references.map(reference => ({ ...reference })),
      selectedSession: state.selectedSession === null ? null : { ...state.selectedSession } }),
    begin,
    startInvestigation,
    resumeOriginal,
    openModelSettings: () => deps.openSettings(),
  };
}
