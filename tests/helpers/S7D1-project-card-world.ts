/**
 * FX-7D1-03 (G4): the project card across two workspaces of one project, its answer, and the one project
 * notice with a per-workspace seen position. Steps 1-5 are the opener; step 6 is a separate exported step
 * (`writeS7D1ProjectNotice`) called only by the notice row.
 *
 * 1. `openS6ATwoWorkspaceWorld` (memory or SQLite) with the project scribe binding, and both workspace handles.
 * 2. The scribe's real governance/Plan/line through `seedS6BScribe` (its one initial adoption), a revised
 *    catalog that adds module M and its child N (`containment.parentOf`), an adviser and a secretary, module
 *    links M/N and a goal link in A, and a project-responsible link on the secretary.
 * 3. The scribe's real Run through `scribeUnderstanding({ structural: true })`: one `note_review` card whose
 *    subject is the project, pending for the person.
 * 4. In A: the queue, the card, `decisions/answer` with the card's own source and pins, and
 *    `decisions/application` with the real application receipt the answer returned.
 * 5. In B: the same card and counts, the card read (with the saved answer), and `decisions/application` with
 *    A's answer pin and receipt, which the pin's workspace check refuses `invalid`.
 * 6. `notifyProject` called directly with the world's real records and clock, its `operation` the real
 *    `OperationRef` of the secretary's public creation receipt read through `sessions/operation`; then
 *    `decisions/notices/seen` in A. B keeps its own (absent) mark.
 *
 * The real project-notice source is W's wiring; this fixture only opens the world and writes through the
 * captured backend in step 6. No store is read, no card/notice/reader is built, nothing is hand-made.
 */
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ModuleRef, SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { NotifyProjectInputV1, ProjectNoticeV1 } from '../../src/contracts/role-lines.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { notifyProject } from '../../src/core/work-graph/communication/project-notice-service.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_SECOND_SCOPE, S6A_SCOPE,
  type S6ABackend, type S6AExtraBinding, type S6ARequestWorld,
} from './S6A-request-fixture.js';
import {
  openS6BRoleLine, scribeUnderstanding, seedS6BScribe, type S6BLine, type S6BScribe,
} from './S6B1-fixture.js';
import { s6b2Backend, type S6B2Captured } from './S6B2-handoff-scene.js';
import { committed, ready } from './S7A-fixture.js';

/** The answer text the person writes; the rows assert it back exactly. */
export const S7D1_ANSWER_TEXT = 'S7D1 G4 project card answer text';
/** The first notice's line; the second notice the notice row writes uses another operation and summary. */
export const S7D1_FIRST_NOTICE_SUMMARY = 'S7D1 G4 first project notice';

const moduleDefinition = (ref: ModuleRef, name: string, paths: string[]): ModuleDefinition =>
  ({ ref, name, responsibility: `${name} responsibility`, paths, interfaces: [] });

/** `sessions/link` on `line` in `ws`'s workspace: the session pin a public read returned and the new link pin 0. */
export async function linkS7D1Line(ws: S6ACardsWorkspace, line: { ref: SessionRef },
  target: WorkLinkTarget, label: string) {
  const card = ready<SessionCard>(await ws.route('sessions/read', line.ref), `the Session ${label}`);
  const link = { ...line.ref, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
  return committed(await ws.post('sessions/link', graphWrite(ws.scope, {
    sessionRef: line.ref, target, relation: 'responsible', active: true,
  }, `s7d1-link-${label}`, [
    { ref: card.record.ref, revision: card.record.revision }, { ref: link, revision: 0 },
  ])), `the ${label} link`);
}

/** `sessions/archive-line` in `ws`'s own workspace (the second workspace's card is not readable from A's read). */
export async function archiveS7D1Line(ws: S6ACardsWorkspace, line: { ref: SessionRef }, label: string) {
  const card = ready<SessionCard>(await ws.route('sessions/read', line.ref), `the Session ${label}`);
  const archived = ready<{ state: string }>(await ws.post('sessions/archive-line', graphWrite(ws.scope, {
    sessionRef: line.ref, reason: `S7D1 ${label}`, tasks: [], wait: null,
  }, `s7d1-archive-${label}`, [{ ref: card.record.ref, revision: card.record.revision }])), `the ${label} archive`);
  if (archived.state !== 'archived') throw new Error(`S7D1: ${label} is not archived: ${JSON.stringify(archived)}`);
  return archived;
}

export type S7D1ProjectCardWorld = {
  world: S6ARequestWorld;
  a: S6ACardsWorkspace;
  b: S6ACardsWorkspace;
  projectId: string;
  catalog: { moduleM: ModuleRef; moduleN: ModuleRef };
  lines: { adviser: S6BLine; secretary: S6BLine; scribe: S6BScribe };
  card: DecisionCardV1;
  aCounts: DecisionQueueReadV1['counts'];
  bCounts: DecisionQueueReadV1['counts'];
  bCards: DecisionCardV1[];
  bCard: DecisionCardV1;
  answer: { messageRef: SessionMessageRef; messageRevision: number; text: string;
    receipt: DecisionApplicationReceiptV1 };
  bApplication: unknown;
};

/** Step 6's result: the one trusted notice write, A's mark and B's own (absent) position. */
export type S7D1ProjectNoticeStep = {
  operations: { adviser: OperationRef; secretary: OperationRef };
  notice: ProjectNoticeV1;
  noticeInput: NotifyProjectInputV1;
  marks: { a: DecisionQueueReadV1['seenThrough']; b: DecisionQueueReadV1['seenThrough'] };
  notices: { a: DecisionQueueReadV1['notices']; b: DecisionQueueReadV1['notices'] };
  records: ReturnType<typeof s6b2Backend>['records'];
};

/** Steps 1-5; the caller closes `world`. Step 6 is `writeS7D1ProjectNotice`, called only by the notice row. */
const S7D1_EXTRA_BINDINGS: S6AExtraBinding[] = [{
  binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding,
  mergeTools: ['send_session_message'],
}];

export async function openS7D1ProjectCardWorld(options: { backend: S6ABackend }):
Promise<S7D1ProjectCardWorld> {
  const opened = await openS6ATwoWorkspaceWorld({ backend: options.backend, scribe: true,
    extraBindings: S7D1_EXTRA_BINDINGS });
  const { world } = opened;
  const a = s6aCardsWorkspace(world, S6A_SCOPE);
  const b = s6aCardsWorkspace(world, S6A_SECOND_SCOPE);
  const projectId = world.scope.projectId;
  try {
    // 2. The scribe's governance/Plan/line, the catalog with M > N, the two lines and their links.
    const scribe = await seedS6BScribe(world);
    await world.settleDetached();
    const current = ready<ArchitectureRevision>(await a.route('architecture/read',
      { selection: { kind: 'current' } }), 'the current architecture');
    const moduleM: ModuleRef = { projectId, moduleId: 's7d1-module-m' };
    const moduleN: ModuleRef = { projectId, moduleId: 's7d1-module-n' };
    const registration = ready<{ project: { revision: number }; workspace: { revision: number } }>(
      await a.route('workspaces/registration', { projectId, workspaceId: world.scope.workspaceId }),
      'the workspace registration');
    committed<ArchitectureRevision>(await world.platform.architecture.reviseArchitectureCatalog(a.humanContext(), {
      meta: { requestId: 's7d1-g4-catalog', expected: [
        { ref: { aggregateType: 'Project', projectId }, revision: registration.project.revision },
        { ref: { aggregateType: 'Workspace', ...world.scope }, revision: registration.workspace.revision },
      ] },
      input: {
        expected: { catalogRef: current.catalog.ref,
          baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } },
        ops: [
          { op: 'add_module', module: moduleDefinition(moduleM, 'S7D1 module M', ['src/s7d1-m']) },
          { op: 'add_module', module: moduleDefinition(moduleN, 'S7D1 module N', ['src/s7d1-m/n']) },
          { op: 'set_parent', moduleId: moduleN.moduleId, parentId: moduleM.moduleId },
        ],
        responsibilityMoves: [], reason: 'S7D1 G4 adds module M and its child N' },
    }), 'the revised architecture');
    await world.settleDetached();
    // T4a: both duty lines open with their scopes through `role-lines/open`; the scribe keeps its own link step.
    const adviser = await openS6BRoleLine(a, { label: 's7d1-adviser', duty: 'adviser', requestId: 's7d1-open-s7d1-adviser', scope: [
      { kind: 'region', moduleRef: moduleM }, { kind: 'region', moduleRef: moduleN },
      { kind: 'goal', goalRef: world.goals.first }] });
    const secretary = await openS6BRoleLine(a, { label: 's7d1-secretary', duty: 'secretary',
      requestId: 's7d1-open-s7d1-secretary', scope: [{ kind: 'project' }] });
    await linkS7D1Line(a, scribe.line, { kind: 'project', ref: { projectId } }, 'scribe-project');

    // 3. The scribe's real Run leaves the project understanding pending for the person.
    const understood = await scribeUnderstanding(world, scribe, { label: 'g4-project-card', structural: true });
    if (understood.note.storedState !== 'pending_review' || understood.note.goalId !== null) {
      throw new Error('S7D1: the scribe understanding is not a pending project note');
    }

    // 4. In A: the pending project card, its answer with the row's exact text, and the application receipt.
    const aQueue = ready<DecisionQueueReadV1>(await a.route('decisions/queue', {
      workspace: { ...a.scope }, sections: ['waiting_answer', 'answered_pending_application', 'history'],
      page: { limit: 100 },
    }), 'the A queue');
    const waiting = aQueue.waitingAnswer.find((candidate) => candidate.source.kind === 'note_review'
      && candidate.subject.kind === 'project');
    if (waiting === undefined) throw new Error('S7D1: the project note card is not waiting in A');
    const card = ready<DecisionCardV1>(await a.route('decisions/card', { source: waiting.source }),
      'the A project card');
    const answered = ready<ResolveDecisionReadV1>(await a.post('decisions/answer', graphWrite(a.scope, {
      source: card.source, selection: { kind: 'option', optionId: 'accept' }, text: S7D1_ANSWER_TEXT, annotations: [],
    }, 's7d1-g4-answer', card.source.pins)), 'the project card answer');
    if (answered.answer.status !== 'committed') throw new Error('S7D1: the project card answer did not commit');
    const answerMessage = answered.answer.value;
    if (answered.application === null || answered.application.status !== 'committed') {
      throw new Error('S7D1: the project card answer has no committed application');
    }
    const receipt = answered.application.value.application?.receipt;
    if (receipt === undefined) throw new Error('S7D1: the project card answer has no application receipt');
    const expected = [{ ref: answerMessage.ref, revision: answerMessage.revision }];
    committed(await a.post('decisions/application', graphWrite(a.scope, {
      messageRef: answerMessage.ref, receipt,
    }, 's7d1-g4-application', expected)), 'the A application');
    const aAfter = ready<DecisionQueueReadV1>(await a.route('decisions/queue', {
      workspace: { ...a.scope }, sections: ['waiting_answer', 'answered_pending_application', 'history'],
      page: { limit: 100 },
    }), 'the A queue after the answer');

    // 5. In B: the same card/counts, the card's answer, and the pin's workspace refusal.
    const bQueue = ready<DecisionQueueReadV1>(await b.route('decisions/queue', {
      workspace: { ...b.scope }, sections: ['waiting_answer', 'answered_pending_application', 'history'],
      page: { limit: 100 },
    }), 'the B queue');
    const bCard = ready<DecisionCardV1>(await b.route('decisions/card', { source: card.source }),
      'the B project card');
    const bApplication = await b.post('decisions/application', graphWrite(b.scope, {
      messageRef: answerMessage.ref, receipt,
    }, 's7d1-g4-b-application', expected));

    return {
      world, a, b, projectId, catalog: { moduleM, moduleN },
      lines: { adviser, secretary, scribe },
      card, aCounts: aAfter.counts, bCounts: bQueue.counts,
      bCards: [...bQueue.waitingAnswer, ...bQueue.answeredPendingApplication, ...bQueue.history],
      bCard,
      answer: { messageRef: answerMessage.ref, messageRevision: answerMessage.revision,
        text: S7D1_ANSWER_TEXT, receipt },
      bApplication,
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** Step 6: the one trusted project-notice writer, then A's mark; B keeps its own (absent) position. */
export async function writeS7D1ProjectNotice(opened: S7D1ProjectCardWorld, options: { captured: S6B2Captured }):
Promise<S7D1ProjectNoticeStep> {
  const { world, a, b, projectId } = opened;
  const adviserOperation = ready<{ ref: OperationRef }>(
    await a.route('sessions/operation', opened.lines.adviser.operation), 'the adviser creation operation');
  const secretaryOperation = ready<{ ref: OperationRef }>(
    await a.route('sessions/operation', opened.lines.secretary.operation), 'the secretary creation operation');
  const records = s6b2Backend(options.captured).records;
  const noticeInput: NotifyProjectInputV1 = {
    projectRef: { projectId }, kind: 'module_maintainer_assigned', summary: S7D1_FIRST_NOTICE_SUMMARY,
    operation: secretaryOperation.ref,
  };
  const written = await notifyProject({ records, now: () => world.clock.now() }, noticeInput);
  if (written.status !== 'committed') throw new Error(`S7D1: the project notice did not commit: ${JSON.stringify(written)}`);
  const notice = written.value;
  const aNoticePage = ready<DecisionQueueReadV1>(await a.route('decisions/queue', {
    workspace: { ...a.scope }, sections: ['notices'], categories: ['project_notice'], page: { limit: 100 },
  }), 'the A project notice page');
  if (aNoticePage.notices.length !== 1 || aNoticePage.displayToken === null) {
    throw new Error(`S7D1: A does not read the one project notice: ${JSON.stringify(aNoticePage.notices)}`);
  }
  const marked = await a.markSeen({ label: 'g4-first-notice', displayToken: aNoticePage.displayToken,
    seenThrough: aNoticePage.seenThrough });
  if (marked['status'] !== 'committed') throw new Error(`S7D1: A's notice mark did not commit: ${JSON.stringify(marked)}`);
  const aNotices = await a.readNotices({ categories: ['project_notice'] });
  const bNotices = await b.readNotices({ categories: ['project_notice'] });
  if (aNotices.notices.length !== 0 || bNotices.notices.length !== 1) {
    throw new Error(`S7D1: the per-workspace marks disagree: ${JSON.stringify([aNotices.notices, bNotices.notices])}`);
  }
  return {
    operations: { adviser: adviserOperation.ref, secretary: secretaryOperation.ref },
    notice, noticeInput,
    marks: { a: aNoticePage.seenThrough, b: {} as DecisionQueueReadV1['seenThrough'] },
    notices: { a: aNotices.notices, b: bNotices.notices },
    records,
  };
}
