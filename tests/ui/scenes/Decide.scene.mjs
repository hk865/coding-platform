/**
 * The Decide board-check scene (7D2 batch 10): `Decide.scene.json` carries the
 * queue rows the page draws — a waiting structural proposal card, the reverted
 * notice and the conflict notice — plus the two knowledge reads' answers. This
 * file adds only what one static answer cannot: the two notices read different
 * recovery items, so `knowledge/recovery-items` answers by the `noticeId` the
 * page sent (the same `project_notice:` suffix `boot.ts` slices).
 *
 *   --scene tests/ui/scenes/Decide.scene.mjs
 *
 * The conflict notice's `bad_file` place is recoverable from its snapshot only
 * while the same `itemNo` is still an `unreadable` recovery item
 * (`knowledgeNoticeFactsOf`); the reverted notice lists the two reverted files
 * from the JSON. The structural card's `architecture/proposal-batch-files`
 * answer is the JSON's.
 *
 * 重新提、恢复、标为已读 answer success and move the queue and the recovery
 * items, so the reread after the click shows the next card (with its 详情
 * closed) or the recovered place.
 *
 * The open executor line (`ag2b-work`'s working Session) answers `lines/read`
 * by its session, its running Run answers `executions/read`/`controls/read`,
 * and `lines/page` answers the executions segment (empty pages for the other
 * three sections). A submitted control and 问一问 answer committed/queued.
 *
 * `goals/read` (the scene's own Goal, for a `?goal=` URL) and
 * `architecture/work-scope` (the 当前工作 architecture tab: the conflict files
 * both Goals change) are static in the JSON and agree with its `architecture/read`
 * catalog. `graph/detail` borrows TaskMap's page and re-keys it per the clicked
 * `input.node.ref.taskId`, as the review wrapper did.
 */
import { readFileSync } from 'node:fs';

const HAVE = JSON.parse(readFileSync(new URL('./Decide.scene.json', import.meta.url), 'utf8'));
const TASKMAP = JSON.parse(readFileSync(new URL('./TaskMap.scene.json', import.meta.url), 'utf8'));
const CONFLICT_NOTICE = 'scene-notice-conflict';

/** The conflict notice's one recoverable place: the bad module file, item 1. */
const CONFLICT_RECOVERY = { status: 'ready', value: { items: [
  { itemNo: 1, kind: 'unreadable', path: '.workbench/modules/core.json' },
] } };
const NOTICE_KEYS = ['project_notice:scene-notice-reverted', 'project_notice:scene-notice-conflict'];
const LINE_SESSION = 'session-551d27eedeb86f2be2cb32ca5cc9fcdb2a91c89c8dcbf3fd9f052fcee6317434';
const LINE_RUN = '3dfcce3b-64aa-41f6-a156-ad09250750a5';
const LINE_INTENT = 'scene-line-resume';
const MISSING = { status: 'rejected', code: 'not_found', reason: 'not in the Decide scene' };

/** The four `lines/page` segments; the Decide line view reads only executions. */
const emptyPage = (section) => ({ status: 'ready', value: {
  section, segments: [], scope: 'indexed', items: [], nextCursor: null, sourceCursor: 'c0000000100' } });

/** What the writes move: the answered card leaves the queue, the seen notices leave it,
 * and a recovered item leaves its own notice's list. */
const S = { answered: new Set(), seen: false,
  recovered: { [CONFLICT_NOTICE]: new Set(), 'scene-notice-reverted': new Set() } };
const committedAnswer = (value) => ({ status: 'committed', value: value ?? {} });
let reverified = false;
const recoveryOf = (noticeId) => (noticeId === CONFLICT_NOTICE
  ? structuredClone(CONFLICT_RECOVERY)
  : structuredClone(HAVE.routes['knowledge/recovery-items']));

/** 两页读同样的候选形状，各自保有自己的目标版本和写入结果。 */
export function candidateScene(goalPin, workspaceId, conflictOnFirstAdoption = false) {
  const subject = { kind: 'goal', goalRef: goalPin.ref };
  const entries = ['candidate', 'stale'].map((status, index) => {
    const ref = { aggregateType: 'PlanProposal', projectId: goalPin.ref.projectId, workspaceId,
      proposalId: 'scene-check-reports-' + status };
    const cardKey = JSON.stringify({ kind: 'candidate', goalRef: goalPin.ref, proposalRef: ref });
    const revision = index + 2;
    const pins = [goalPin, { ref, revision }, { ref: { aggregateType: 'PlanRevision',
      projectId: ref.projectId, planId: 'scene-previous-plan' }, revision: 1 }];
    const card = { cardKey, subject, source: { kind: 'candidate', key: cardKey, subject, pins }, state: 'waiting_answer',
      requestRef: null, objects: [], options: [], answer: null, application: null, openedAt: null,
      taskRef: null, runRef: null, readOnly: false, candidateStatus: status, staleReason: index ? '来源已撤回' : null,
      actions: ['answer', index ? 'regenerate' : 'adopt', 'abandon'],
      proposedChecks: [{ checkId: 'report-check', command: 'npm run check:reports' }] };
    const draft = { stages: [{ stageId: 'reports', title: '报告' }], obligations: [],
      tasks: [{ stageId: 'reports', taskId: 'report-check', title: '核对报告目录' }] };
    const proposal = { ref, revision, status: 'candidate', draft,
      reason: { text: index ? '原先要求把报告移回旧目录。' : '报告已经移到新目录，需要一起更新检查。' } };
    return { card, proposal };
  });
  return {
    waiting: () => entries.filter((entry) => entry.proposal.status === 'candidate').map((entry) => entry.card),
    reply(route, input) {
      const ref = route === 'plans/proposal' ? input : input?.proposalRef;
      const entry = entries.find(({ proposal }) => proposal.ref.proposalId === ref?.proposalId);
      if (!entry) return undefined;
      const { card, proposal } = entry;
      if (route === 'plans/proposal') return { status: 'ready', value: proposal };
      if (route === 'decisions/candidate-card') return { status: 'ready', value: { card,
        diagnosis: [], exactReview: { status: 'ready', value: { status: 'decided', verdict: 'pass', findings: [] } },
        exportRead: { status: 'ready', stages: [{ state: 'written', path: 'reports/任务书.md' }] },
        standardChange: { status: 'ready', value: null } } };
      if (route !== 'plans/apply' && route !== 'plans/abandon') return undefined;
      if (route === 'plans/apply' && conflictOnFirstAdoption) {
        conflictOnFirstAdoption = false;
        return { status: 'rejected', code: 'revision_conflict', reason: 'the plan changed' };
      }
      proposal.status = route === 'plans/apply' ? 'accepted' : 'not_adopted';
      return committedAnswer(proposal);
    },
  };
}

const firstStop = HAVE.routes['decisions/queue'].value.waitingAnswer[0];
const goalPin = firstStop.source.pins.find((pin) => pin.ref.aggregateType === 'Goal');
const candidates = candidateScene(goalPin, HAVE.routes.bootstrap.workspaces[0].scope.workspaceId, true);
const interruptKey = 'scene-interrupted_pending_resume';
const interrupted = { ...firstStop, cardKey: interruptKey, taskRef: null, runRef: null, objects: [],
  source: { ...firstStop.source, key: interruptKey, pins: [goalPin] } };
/** 截图可复用的有话状态。草稿由输入事件产生，只写在当前打开的停止卡上。 */
export async function fillStopNote(page) {
  await page.locator('#dc-answer').fill('报告改到 reports/');
}

const oldConflict = HAVE.routes['decisions/queue'].value.answeredPendingApplication[0];
const conflictKey = 'scene-wait-for-earlier-goal';
const conflict = { ...oldConflict, cardKey: conflictKey, source: { ...oldConflict.source, key: conflictKey },
  state: 'waiting_answer', actions: ['answer'], answer: null, application: null, answerMessageRef: null };
let conflictAnswer = null;

export const scene = {
  now: HAVE.now,
  routes: HAVE.routes,
  reply(route, input, body) {
    const winput = body && body.request ? body.request.input : (input ?? null);
    const candidate = candidates.reply(route, winput);
    if (candidate !== undefined) return candidate;
    if (route === 'decisions/queue') {
      const queue = structuredClone(HAVE.routes['decisions/queue']);
      queue.value.waitingAnswer.push(...candidates.waiting(), interrupted);
      if (conflictAnswer === null) queue.value.waitingAnswer.push(conflict);
      else if (conflictAnswer.state === 'applied') queue.value.history.unshift(conflictAnswer);
      else queue.value.answeredPendingApplication.unshift(conflictAnswer);
      if (S.answered.size > 0) {
        queue.value.waitingAnswer = queue.value.waitingAnswer.filter((card) => !S.answered.has(card.cardKey));
      }
      if (S.seen) queue.value.notices = queue.value.notices.filter((notice) => !NOTICE_KEYS.includes(notice.itemKey));
      queue.value.counts.waitingAnswer = queue.value.waitingAnswer.length;
      queue.value.counts.answeredPendingApplication = queue.value.answeredPendingApplication.length;
      if (input?.sections?.includes('history')) {
        queue.value.waitingAnswer = [];
        queue.value.notices = [];
      }
      return queue;
    }
    if (route === 'knowledge/recovery-items') {
      const noticeId = input?.noticeId;
      const answer = recoveryOf(noticeId);
      const gone = S.recovered[noticeId] || new Set();
      answer.value.items = answer.value.items.filter((item) => !gone.has(item.itemNo));
      if (answer.value.items.length === 0) return { status: 'rejected', code: 'not_found', reason: 'no recovery items' };
      return answer;
    }
    if (route === 'decisions/answer') {
      const key = winput && winput.source ? winput.source.key : '';
      if (key === conflictKey) {
        const applied = conflictAnswer !== null;
        conflictAnswer = { ...conflict, state: applied ? 'applied' : 'answered_pending_application',
          answer: { decision: { selection: winput.selection }, respondedAt: HAVE.now, bodyRef: null },
          actions: [], readOnly: true };
        return { status: 'ready', value: { answer: committedAnswer(), state: applied ? 'applied' : 'application_not_recorded' } };
      }
      S.answered.add(key);
      return { status: 'committed', value: { answer: { status: 'committed' } } };
    }
    if (route === 'knowledge/recover') {
      const noticeId = winput && winput.noticeId;
      if (S.recovered[noticeId]) S.recovered[noticeId].add(winput.itemNo);
      return committedAnswer({ path: '.workbench/modules/core.json' });
    }
    if (route === 'decisions/notices/seen') {
      S.seen = true;
      return committedAnswer();
    }
    if (route === 'settings/checks/withdraw') {
      return { status: 'ready', value: { settings: structuredClone(HAVE.routes['settings/snapshot'].value) } };
    }
    if (route === 'verification/reverify') {
      if (reverified) return { status: 'committed', value: { kind: 'reverified' } };
      reverified = true;
      return { status: 'committed', value: { kind: 'refused', refusal: { code: 'verification_uncovered' } } };
    }
    if (route === 'lines/page') {
      const section = winput && winput.section;
      return section === 'executions' ? HAVE.routes['lines/page'] : emptyPage(section);
    }
    if (route === 'lines/read') {
      return winput && winput.key && winput.key.sessionId === LINE_SESSION ? HAVE.routes['lines/read'] : MISSING;
    }
    if (route === 'executions/read') {
      return winput && winput.runId === LINE_RUN ? HAVE.routes['executions/read'] : MISSING;
    }
    if (route === 'controls/read') {
      return winput && winput.intentId === LINE_INTENT ? HAVE.routes['controls/read'] : MISSING;
    }
    if (route === 'controls/submit') {
      return committedAnswer({ intent: HAVE.routes['controls/read'].value, runRevision: 4 });
    }
    if (route === 'graph/detail') {
      /* The committed Decide scene has no graph/detail: borrow TaskMap's page and
         re-key the Task the card head or the right panel names. */
      const node = winput && winput.node;
      const id = node && node.ref && node.ref.taskId ? node.ref.taskId : 'ag2b-work';
      const row = HAVE.routes['tasks/query'].value.tasks.find((task) => task.ref.taskId === id);
      const text = JSON.stringify(TASKMAP.routes['graph/detail'])
        .replaceAll('ple34b-scene-plan', 'ag2b-plan').replaceAll('ple34b', 'ag2b-collab-project')
        .replaceAll('"g1"', '"ag2b-goal"').replaceAll('"T13"', JSON.stringify(id))
        .replaceAll('重新入队与失败类别', row ? row.definition.title : id);
      return JSON.parse(text);
    }
    if (route === 'queries/ask') return { status: 'queued' };
    return HAVE.routes[route];
  },
};
