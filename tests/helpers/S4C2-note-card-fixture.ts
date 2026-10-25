/**
 * Slice 4C-2 acceptance fixture for the N rows (item 8): ONE real platform over
 * memory and SQLite, reached only through public writes and dispositions.
 *
 * It builds on the real `createS4ANoteScopeFixture(kind)`: Goals g1 (`s4a-goal`,
 * real scribe `s0`/`sa` and executor Runs) and g2 (`s4a-goal-2`, executor
 * `executor2`), the real architecture/plan/Session/claim setup. Nothing here
 * writes a `NoteVersion` or fills a `noticeClass` by hand: the tests write
 * drafts through `platform.notes.writeNote` as the real Host or as a real Run,
 * then disposition them through `platform.notes.reviewNote`/`withdrawNote` as a
 * real scribe Run. Note ids come from the injected `noteNewId` counter, so an
 * `itemKey` is a literal, and `markNoticesSeen` runs against the configured
 * operator.
 *
 * Assertions in the tests use only `platform.decisions.queryDecisionQueue`,
 * `readDecisionCard`, `platform.workflow.resolveDecision`, the public note
 * routes (`readNote`, `listByAnchor`, `listNotes`, `memoryHistory`,
 * `readScribeTodos`), `platform.goals.setGoalControl` and the real Plan service
 * for the D-13 stage retirement; this fixture reads the workspace registration
 * only to obtain the Workspace revision pin the Seen command requires (a
 * public read, not an assertion).
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { NoteAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { RoleBindingRefV1, RunRef, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { DecisionSubjectV1 } from '../../src/contracts/goal-decisions.js';
import type { MemoryHistoryResultV1, NoteDispositionResult, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import {
  createS4ANoteScopeFixture,
  type S4ANoteScopeFixture,
  type S4ANoteScopeFixtureKind,
  type ScribeHandle,
} from './S4A-note-scope-fixture.js';

export type S4C2NoteCardFixtureKind = S4ANoteScopeFixtureKind;

export const S4C2_GOAL_ANCHOR: NoteAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
export const S4C2_PROJECT_ANCHOR: NoteAnchorV1 = { kind: 'project' };
/** A module anchor with no region scribe, so the real project scribe manages it. */
export function moduleAnchor(moduleId: string): NoteAnchorV1 {
  return { kind: 'module', moduleId };
}

export type S4C2NoteCardFixture = {
  kind: S4C2NoteCardFixtureKind;
  platform: S4ANoteScopeFixture['platform'];
  notes: S4ANoteScopeFixture['notes'];
  scope: S4ANoteScopeFixture['scope'];
  projectRef: S4ANoteScopeFixture['projectRef'];
  workspaceRef: WorkspaceRef;
  goalRef: GoalRef;
  goal2Ref: GoalRef;
  /** The project scribe (t1 in g1); it manages every note in this Workspace. */
  scribe: ScribeHandle;
  /** A second real scribe (t4 in g1), for a second disposition actor. */
  scribe2: ScribeHandle;
  /** The g1 executor (t3). */
  executor: ScribeHandle;
  /** The g2 executor (t9). */
  executor2: ScribeHandle;
  ctx(): CoreCallContext;
  workCtx(runRef: RunRef): CoreCallContext;
  /** The literal note id the `sequence`-th write receives (1-based). */
  noteId(sequence: number): string;
  writeUser(draft: NoteDraftV1, goalId: string | null,
    options?: { commandId?: string; expectedPointerRevision?: number | null }): Promise<WriteNoteResult>;
  writeAgent(handle: ScribeHandle, draft: NoteDraftV1, goalId: string | null,
    options?: { commandId?: string; expectedPointerRevision?: number | null }): Promise<WriteNoteResult>;
  review(handle: ScribeHandle, noteId: string, options: {
    verdict: 'review' | 'accept' | 'reject';
    resolution?: 'supersede' | 'coexist';
    expectedVersion?: number;
    expectedPointerRevision?: number | null;
    reason?: string | null;
  }): Promise<NoteDispositionResult>;
  withdraw(handle: ScribeHandle, noteId: string,
    options?: { expectedVersion?: number; reason?: string | null }): Promise<NoteDispositionResult>;
  /** The real queue, notice-only by default, with the note_review category. */
  queue(options?: { limit?: number; cursor?: string; categories?: ('note_review')[]; goalRef?: GoalRef }): Promise<DecisionQueueReadV1>;
  markSeen(page: DecisionQueueReadV1): Promise<void>;
  /** The live `waiting_answer` cards of the whole Workspace (or one Goal). */
  waitingCards(options?: { goalRef?: GoalRef; limit?: number }): Promise<DecisionCardV1[]>;
  /** The live waiting card whose NoteHead pin is `noteId@version`, or null. */
  cardOf(noteId: string, options?: { version?: number }): Promise<DecisionCardV1 | null>;
  /**
   * `readDecisionCard` by a constructed NoteHead source: open, closed or null.
   * `projectSubject: true` asks for the project subject (a goal-less note's card).
   */
  readCard(noteId: string, options?: { version?: number; goalRef?: GoalRef; projectSubject?: boolean }):
    Promise<DecisionCardV1 | null>;
  /** The real coordinator: answer + application for one note card. */
  resolve(card: DecisionCardV1, optionId: string, requestId: string, text?: string):
    ReturnType<NonNullable<S4ANoteScopeFixture['platform']['workflow']['resolveDecision']>>;
  /** A user's own withdraw (the user is never limited by the scribe scope). */
  withdrawUser(noteId: string, options?: { expectedVersion?: number; reason?: string | null }): Promise<NoteDispositionResult>;
  /** `notes/control cancel` through the real Goal service. */
  cancelGoal(goalRef?: GoalRef): ReturnType<S4ANoteScopeFixture['platform']['goals']['setGoalControl']>;
  /** The public `memoryHistory` of one note (it carries each version's relations). */
  history(noteId: string): Promise<MemoryHistoryResultV1>;
  close(): Promise<void>;
};

const NOTE_ID_PREFIX = 's4c2-note-';

/** A real ordinary note draft (the tests override what each row needs). */
export function generalNote(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion',
    anchor: S4C2_GOAL_ANCHOR, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}

/** A real goal-understanding draft with the five required sections. */
export function understandingNote(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
  return { kind: 'understanding', topic: 'understanding', conclusion: 'current', anchor: S4C2_GOAL_ANCHOR,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], sections, ...overrides } as NoteDraftV1;
}

/**
 * The literal card key (the `NoteHead@version` pin identity) of one note card,
 * built by hand as JCS canonical JSON (keys sorted, strings quoted):
 * `{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":…,"projectId":…},"revision":…}}`.
 */
export function noteCardKey(projectId: string, noteId: string, version = 1): string {
  return `{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead",`
    + `"noteId":${JSON.stringify(noteId)},"projectId":${JSON.stringify(projectId)}},`
    + `"revision":${JSON.stringify(version)}}}`;
}

/** The canonical `note_review` source of one subject (pins are not re-read). */
export function noteCardSubjectSource(subject: DecisionSubjectV1, projectId: string, noteId: string,
  version: number): { kind: 'note_review'; key: string; subject: DecisionSubjectV1;
    pins: { ref: { aggregateType: 'NoteHead'; projectId: string; noteId: string }; revision: number }[] } {
  return { kind: 'note_review', key: noteCardKey(projectId, noteId, version), subject,
    pins: [{ ref: { aggregateType: 'NoteHead', projectId, noteId }, revision: version }] };
}

/** The canonical `note_review` source a by-key read uses (pins are not re-read). */
export function noteCardSource(projectId: string, noteId: string, version: number,
  goalRef: GoalRef): ReturnType<typeof noteCardSubjectSource> {
  return noteCardSubjectSource({ kind: 'goal', goalRef }, projectId, noteId, version);
}

type PlanAdditions = {
  tasks?: PlanRevisionSnapshot['tasks'];
  assignments?: NonNullable<PlanRevisionSnapshot['assignments']>;
  /** Add the new tasks to this obligation too (a claimable future task). */
  obligationId?: string;
};

const AUX_AT = '2026-10-15T02:00:00.000Z';
let auxClock = 0;
const auxNow = (): string => new Date(Date.parse(AUX_AT) + (++auxClock) * 1000).toISOString();
const AUX_BUDGET: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };

function auxRoleRef(role: 'executor' | 'scribe'): RoleConfigurationRef {
  return { kind: 'legacy_template',
    templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor', templateRevision: 's3.1' };
}

function auxBindingFor(role: 'executor' | 'scribe', id: string): RoleBindingRefV1 {
  return { schemaVersion: 1, bindingId: `s4c2-aux-${id}-binding`,
    templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor',
    templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' };
}

/**
 * A fresh real Session: D-13 needs a Run bound to a REVISED Plan, and every
 * fixture Session is already occupied by its own claim.
 */
export async function createAuxSession(f: S4C2NoteCardFixture, requestId: string,
  role: 'executor' | 'scribe'): Promise<SessionRef> {
  const ctx = f.ctx();
  const admitted = await f.platform.sessions.admitSessionCreation(ctx, {
    meta: { requestId: `s4c2-aux-admit-${requestId}`, expected: [] },
    input: { workspace: f.scope, kernelStore: { adapterId: 's4a-kernel', storeKey: 's4a-kernel-store' },
      role: auxRoleRef(role), recommendedRefs: [], initialLinks: [] },
  });
  if (admitted.status !== 'committed') throw new Error(`S4C2 aux admit failed: ${JSON.stringify(admitted)}`);
  const admittedValue = admitted.value as unknown as { action: { plannedSessionRef: SessionRef };
    ref: { projectId: string; sessionId: string } };
  const kernelSessionId = `s4c2-aux-kernel-${requestId}-${String(++auxClock)}`;
  await f.platform.kernelStores.withStore('s4a-kernel', store => store.create({
    sessionId: kernelSessionId, recordId: `s4c2-aux-kernel-record-${requestId}`, createdAt: auxNow(),
  }, { signal: ctx.signal }));
  const registered = await f.platform.sessions.recordSessionCreated(ctx, {
    meta: { requestId: `s4c2-aux-record-${requestId}`, expected: [] },
    input: { operationRef: admittedValue.ref as never, sessionRef: admittedValue.action.plannedSessionRef,
      adapterId: 's4a-kernel', kernelSessionId, historyCursor: null, observedAt: auxNow() },
  });
  if (registered.status !== 'committed') throw new Error(`S4C2 aux record failed: ${JSON.stringify(registered)}`);
  const registeredRef = registered.value.ref as SessionRef;
  return { projectId: registeredRef.projectId, sessionId: registeredRef.sessionId };
}

/** RW-5: claim a Run bound to an EXPLICIT Plan revision. */
export async function claimWithPlan(f: S4C2NoteCardFixture, suffix: string,
  sessionRef: SessionRef, taskId: string, role: 'executor' | 'scribe', planRef: PlanRevisionRef,
  goalRef: GoalRef = f.goalRef): Promise<RunRef> {
  const ctx = f.ctx();
  const goal = await f.platform.plans.queryGoal(ctx, goalRef);
  if (goal.status !== 'ready') throw new Error(`S4C2 claim goal read failed: ${JSON.stringify(goal)}`);
  const card = await f.platform.sessions.readSession(ctx, sessionRef);
  if (card.status !== 'ready') throw new Error(`S4C2 claim session read failed: ${JSON.stringify(card)}`);
  const claimed = await f.platform.claims.claimTask(ctx, {
    input: { goalRef, planRef, taskId, sessionRef, roleBinding: auxBindingFor(role, suffix), budget: AUX_BUDGET },
    meta: { requestId: `s4c2-claim-${suffix}`, expected: [
      { ref: goalRef, revision: goal.value.goal.revision },
      { ref: f.workspaceRef, revision: 1 },
      { ref: { aggregateType: 'Session', projectId: sessionRef.projectId, sessionId: sessionRef.sessionId },
        revision: card.value.record.revision },
    ] } });
  if (claimed.status !== 'committed') throw new Error(`S4C2 claim failed: ${JSON.stringify(claimed)}`);
  return claimed.value.runRef;
}

/** RW-5: adopt one more Plan revision through the real Plan services (D-13). */
export async function reviseNoteStages(f: S4C2NoteCardFixture, previous: PlanRevisionSnapshot,
  stages: PlanRevisionSnapshot['stages'], additions: PlanAdditions = {},
  goalRef: GoalRef = f.goalRef): Promise<PlanRevisionSnapshot> {
  const ctx = f.ctx();
  const before = await f.platform.plans.queryGoal(ctx, goalRef);
  if (before.status !== 'ready') throw new Error('S4C2 revise goal read failed');
  const revision = previous.planRevision + 1;
  const stageIds = new Set(stages.map(candidate => candidate.stageId));
  const fallbackStage = stages[0]?.stageId;
  const remapped = previous.tasks.map(task => {
    if (task.stageId === undefined || stageIds.has(task.stageId) || fallbackStage === undefined) return task;
    return { ...task, stageId: fallbackStage };
  });
  const extraTasks = structuredClone(additions.tasks ?? []);
  const extraTaskIds = extraTasks.map(task => task.taskId);
  const tasks = [...remapped, ...extraTasks];
  const assignments = [...(previous.assignments ?? []), ...(additions.assignments ?? [])];
  const obligations = (previous.obligations ?? []).map(obligation =>
    additions.obligationId !== undefined && obligation.obligationId === additions.obligationId
      ? { ...obligation, taskIds: [...obligation.taskIds, ...extraTaskIds] } : obligation);
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `s4a-plan-${String(revision)}`, planRevision: revision, goalId: goalRef.goalId,
    stages: structuredClone(stages), tasks: structuredClone(tasks),
    assignments: structuredClone(assignments), obligations: structuredClone(obligations),
    taskHierarchy: structuredClone(previous.taskHierarchy), executionDag: structuredClone(previous.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await f.platform.plans.proposePlan(ctx, {
    meta: { requestId: `s4c2-revise-propose-${String(revision)}`,
      expected: [{ ref: goalRef, revision: before.value.goal.revision }] },
    input: { goalRef, basedOn: previous.ref, reason: { text: 'S4C2 revise stages', sources: [] }, draft } });
  if (proposed.status !== 'committed') throw new Error(`S4C2 revise propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.platform.plans.queryGoal(ctx, goalRef);
  if (after.status !== 'ready') throw new Error('S4C2 revise goal re-read failed');
  const applied = await f.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `s4c2-revise-apply-${String(revision)}`,
      expected: [{ ref: goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`S4C2 revise apply failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

/** The Goal's current adopted Plan snapshot (the next `reviseNoteStages` base). */
export async function currentPlanOf(f: S4C2NoteCardFixture, goalRef: GoalRef = f.goalRef): Promise<PlanRevisionSnapshot> {
  const graph = await f.platform.plans.queryTaskGraph(f.ctx(), { goalRef });
  if (graph.status !== 'ready') throw new Error(`S4C2 current plan read failed: ${JSON.stringify(graph)}`);
  return graph.value.plan;
}

export async function createS4C2NoteCardFixture(kind: S4C2NoteCardFixtureKind): Promise<S4C2NoteCardFixture> {
  let noteSeq = 0;
  const noteId = (sequence: number): string => `${NOTE_ID_PREFIX}${String(sequence)}`;
  let commandSeq = 0;
  let seenSeq = 0;
  const f = await createS4ANoteScopeFixture(kind, {
    noteNewId: () => noteId(++noteSeq),
    // The scope fixture's Host actor; `markNoticesSeen` accepts only this one.
    operatorActor: { kind: 'human', id: 's4a-scope-operator' },
  });

  const nextCommand = (label: string): string => `s4c2-note-${label}-${String(++commandSeq)}`;

  return {
    kind, platform: f.platform, notes: f.notes, scope: f.scope, projectRef: f.projectRef,
    workspaceRef: f.workspaceRef, goalRef: f.goalRef, goal2Ref: f.goal2Ref,
    scribe: f.scribes.s0, scribe2: f.scribes.sa, executor: f.scribes.executor, executor2: f.scribes.executor2,
    ctx: f.ctx,
    workCtx: f.workCtx,
    noteId,
    async writeUser(draft, goalId, options = {}) {
      return f.write(f.ctx(), draft, goalId, {
        commandId: options.commandId ?? nextCommand('write-user'),
        expectedPointerRevision: options.expectedPointerRevision ?? null,
      });
    },
    async writeAgent(handle, draft, goalId, options = {}) {
      return f.write(f.workCtx(handle.runRef), draft, goalId, {
        commandId: options.commandId ?? nextCommand('write-agent'),
        expectedPointerRevision: options.expectedPointerRevision ?? null,
      });
    },
    async review(handle, targetId, options) {
      return f.platform.notes.reviewNote(f.workCtx(handle.runRef), {
        commandId: nextCommand('review'), noteId: targetId,
        expectedVersion: options.expectedVersion ?? 1,
        expectedPointerRevision: options.expectedPointerRevision ?? null,
        verdict: options.verdict, reason: options.reason ?? 'S4C2 acceptance disposition',
        ...(options.resolution === undefined ? {} : { resolution: options.resolution }),
      });
    },
    async withdraw(handle, targetId, options = {}) {
      return f.platform.notes.withdrawNote(f.workCtx(handle.runRef), {
        commandId: nextCommand('withdraw'), noteId: targetId,
        expectedVersion: options.expectedVersion ?? 1, reason: options.reason ?? null,
      });
    },
    async withdrawUser(targetId, options = {}) {
      return f.platform.notes.withdrawNote(f.ctx(), {
        commandId: nextCommand('withdraw-user'), noteId: targetId,
        expectedVersion: options.expectedVersion ?? 1, reason: options.reason ?? null,
      });
    },
    async waitingCards(options = {}) {
      const read = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
        workspace: f.scope, sections: ['waiting_answer'],
        ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
        page: { limit: options.limit ?? 100 },
      });
      if (read.status !== 'ready') throw new Error(`S4C2 note-card waiting queue read failed: ${JSON.stringify(read)}`);
      return read.value.waitingAnswer;
    },
    async cardOf(targetId, options = {}) {
      const cardKey = noteCardKey(f.scope.projectId, targetId, options.version ?? 1);
      const read = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
        workspace: f.scope, sections: ['waiting_answer'], page: { limit: 100 },
      });
      if (read.status !== 'ready') throw new Error(`S4C2 note-card waiting queue read failed: ${JSON.stringify(read)}`);
      return read.value.waitingAnswer.find(card => card.source.key === cardKey) ?? null;
    },
    async readCard(targetId, options = {}) {
      // The default is the Goal subject (today's path). `projectSubject` asks for
      // the project subject a goal-less note's card carries.
      const subject: DecisionSubjectV1 = options.projectSubject === true
        ? { kind: 'project', projectRef: { projectId: f.scope.projectId } }
        : { kind: 'goal', goalRef: options.goalRef ?? f.goalRef };
      const read = await f.platform.decisions.readDecisionCard(f.ctx(), {
        source: noteCardSubjectSource(subject, f.scope.projectId, targetId, options.version ?? 1),
      });
      if (read.status === 'not_found') return null;
      if (read.status !== 'ready') throw new Error(`S4C2 readDecisionCard failed: ${JSON.stringify(read)}`);
      return read.value;
    },
    resolve(card, optionId, requestId, text = '') {
      const resolve = f.platform.workflow.resolveDecision;
      if (resolve === undefined) throw new Error('the composition publishes no resolveDecision');
      return resolve(f.ctx(), {
        input: { source: card.source, selection: { kind: 'option', optionId }, text, annotations: [] },
        meta: { requestId, expected: card.source.pins },
      });
    },
    async cancelGoal(goalRef = f.goalRef) {
      const goal = await f.platform.plans.queryGoal(f.ctx(), goalRef);
      if (goal.status !== 'ready') throw new Error(`S4C2 cancel goal read failed: ${JSON.stringify(goal)}`);
      const graph = await f.platform.plans.queryTaskGraph(f.ctx(), { goalRef });
      if (graph.status !== 'ready') throw new Error(`S4C2 cancel graph read failed: ${JSON.stringify(graph)}`);
      const phaseRevision = graph.value.completion?.status === 'recorded'
        ? graph.value.completion.snapshot.revision : 0;
      return f.platform.goals.setGoalControl(f.ctx(), {
        input: { goalRef, control: 'cancel', reason: 'S4C2 acceptance cancel' },
        meta: { requestId: nextCommand('cancel-goal'), expected: [
          { ref: goalRef, revision: goal.value.goal.revision },
          { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId },
            revision: phaseRevision },
        ] },
      });
    },
    async history(targetId) {
      const read = await f.platform.notes.memoryHistory(f.ctx(), {
        v: 1, op: 'history', noteId: targetId, limit: 50, cursor: null,
      });
      if (read.status !== 'ready') throw new Error(`S4C2 note history read failed: ${JSON.stringify(read)}`);
      return read.value;
    },
    async queue(options = {}) {
      const read = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
        workspace: f.scope, sections: ['notices'], categories: options.categories ?? ['note_review'],
        ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
        page: { limit: options.limit ?? 50, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) },
      });
      if (read.status !== 'ready') throw new Error(`S4C2 note-card queue read failed: ${JSON.stringify(read)}`);
      return read.value;
    },
    async markSeen(page) {
      if (page.displayToken === null) throw new Error('the page carries no display token');
      const workspace = await f.platform.projects.readWorkspaceRegistration(f.ctx(), f.scope);
      if (workspace.status !== 'ready') throw new Error(`S4C2 workspace read failed: ${JSON.stringify(workspace)}`);
      const marked = await f.platform.workspaceDecisionSettings.markNoticesSeen(f.ctx(), {
        input: { workspace: f.scope, displayToken: page.displayToken, seenThrough: page.seenThrough },
        meta: { requestId: `s4c2-note-seen-${String(++seenSeq)}`,
          expected: [{ ref: workspace.value.workspace.ref, revision: workspace.value.workspace.revision }] },
      });
      if (marked.status !== 'committed') throw new Error(`S4C2 mark seen failed: ${JSON.stringify(marked)}`);
    },
    async close() { await f.close(); },
  };
}
