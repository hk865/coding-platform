/**
 * The Plan page adapter (E3 Plan A §2.1/§2.7–§2.9): one pure conversion from
 * the Main read's pages, the `plans/request-candidate` read and the
 * `plans/versions` page into the flat `props.data` of `Plan.dc.html`. It
 * touches no DOM, no network and no app module.
 *
 * The centre stays Main's: `MainData` is spread as-is and this adapter only
 * adds the goal card, the candidate, the adopted plan versions and the two
 * counts the plan page reads. The JSON boundary shapes below name only the
 * fields the page reads; the plan draft itself is `PlanRevisionDraft` from the
 * published contracts.
 */
import type { QueryJobRef } from '../../contracts/query-job.js';
import type { PlanRevisionDraft } from '../../contracts/plan.js';
import type { GoalAutonomyV1 } from '../../contracts/goal-decisions.js';
import { asRecord, asText } from '../values.js';
import { AUTONOMY_TEXT, goalTaskIdsOf, taskStageOf } from './goals.js';
import { decideTextOf, goalControlsOf, type NavInbox } from './nav.js';
import { gapTextOf } from './task-map.js';
import {
  askCheckDraftOf, candidateFactsOf, candidateStaleTextOf, subjectGoalId, type CandidateFactsRead,
} from './decide.js';
import {
  lastAnsweredRoundOf, requestRootKey, type MainData, type MainPageCursorV1, type MainPageV1, type MainRequestRead, type MainRoundRead,
} from './main.js';

/** The JSON ref of one candidate, four fields; never a copy of a core type. */
export type PlanProposalRef = {
  aggregateType: 'PlanProposal'; projectId: string; workspaceId: string; proposalId: string;
};

type PlanIssue = { path: string; code: string; message: string };

/** `plans/request-candidate`'s `head`, narrowed to what the page reads. */
export type PlanProposalShape = {
  ref: PlanProposalRef; revision: number; status: string;
  issues: readonly PlanIssue[];
  draft: PlanRevisionDraft;
};

/** The goal-card draft row of a round (`GoalCardDraftViewV1`), narrowed. */
type PlanGoalCardDraft = {
  index: number;
  draft: { objective: string; completion: string[]; autonomy: GoalAutonomyV1 };
  confirmedGoalRef: unknown | null;
};

/** One round of a request (`RequestRoundViewV1`), the fields plan.ts reads. */
type PlanRoundRead = MainRoundRead & {
  goalCardDrafts: PlanGoalCardDraft[];
  selectedIdea: { round: QueryJobRef; index: number } | null;
};

/** One request root (`RequestCoreViewV1`), widened beside Main's own type. */
type PlanRequestRead = Omit<MainRequestRead, 'rounds'> & {
  goalId: string | null;
  candidate: unknown | null;
  /** D49-21: a request opened from a completed Goal's line names that Goal. */
  source?: { goalRef: { goalId: string } };
  rounds: PlanRoundRead[];
};

/** `main/read`'s page, widened beside Main's `MainPageV1` without re-copying
 * its fields; structurally a `MainPageV1`. */
export type MainPageRead = {
  notices: MainPageV1['notices'];
  requests: PlanRequestRead[]; next: MainPageCursorV1 | null;
};

export type PlanGoalCard = {
  draft: {
    requestRoot: QueryJobRef; round: QueryJobRef; index: number;
    objective: string; completion: string[]; autonomyText: string;
    /** D49-21: the completed Goal this request was opened from, when it names one. */
    fromGoal: { ordinal: number | null; objective: string } | null;
  } | null;
  confirmed: { text: string }[];
};

/** `decisions/candidate-card`'s value as the Plan page reads it: A1's four
 * facts plus the card's own status and stale reason. */
export type PlanCandidateFacts = CandidateFactsRead & {
  card: { candidateStatus: string | null; staleReason: string | null };
};

export type PlanCandidateRead = {
  head: PlanProposalShape | null;
  status: 'candidate' | 'stale' | 'closed';
  impact: { marks: { taskId: string; change: 'changed' | 'cancelled' | 'superseded';
    after: { task: { title: string } } }[] };
  /** P1: null when the candidate-card read failed; the card then says so per row. */
  facts: PlanCandidateFacts | null;
  error: boolean;
};

export type PlanDoc = {
  requestRoot: QueryJobRef;
  round: QueryJobRef;
  askRound: QueryJobRef;
  selectable: boolean;
  proposal: PlanProposalShape | null;
  live: boolean;
  error: boolean;
  stText: string;
  /** P1: the selected candidate's diagnosis, review, taskbook and standard change. */
  facts: { k: string; v: string }[];
  /** P1: `plans/request-candidate` says stale, or the candidate card does. */
  stale: boolean;
  /** P1: the reason word for a stale candidate; the adopt button's title. */
  staleText: string;
  /** P1: the foot is drawn for a live or a stale candidate (lead 1 乙). */
  foot: boolean;
  hasDelta: boolean;
  delta: { dm: 'changed' | 'cancelled' | 'superseded'; text: string; ref: string }[];
  ideas: { title: string; detail: string }[];
  selectedIndex: number | null;
  tasks: { name: string; items: { taskId: string; name: string }[] }[];
  checks: { k: string; v: string }[];
};

export type PlanVersionRow = { revision: number; at: string; reasonLabel: string };

/** The adopted card (prototype `Plan.dc.html:4506` 已采用): after `plans/apply`
 * the request's candidate closes, so the page reads the adopted proposal back
 * and keeps its tasks and checks on the read-only card. */
export function adoptedPlanDoc(doc: PlanDoc, proposal: PlanProposalShape): PlanDoc {
  return { ...doc, proposal, live: false, selectable: false, stText: '已采用',
    facts: [], stale: false, staleText: '', foot: false,
    tasks: tasksOf(proposal.draft), checks: planChecksOf(proposal.draft) };
}

/** §2.2 step 4: `plans/versions`' `VersionListPageV1` rows at the JSON edge. */
export function versionRowsOf(page: { items: { revision: number; at: string | null; reasonLabel: string }[] }): PlanVersionRow[] {
  return page.items.map((item) => ({ revision: item.revision, at: item.at ?? '', reasonLabel: item.reasonLabel }));
}

export type PlanData = MainData & {
  /** The Tasks the right panel's task map draws (`goalTaskIdsOf`); a Task not
   * here has no node to select (B3). */
  mapTaskIds: string[];
  goalCard: PlanGoalCard;
  plan: PlanDoc | null;
  versions: PlanVersionRow[];
  gaps: { taskId: string; text: string; draft: string }[];
  /** P4: this Goal's `plan_notice` lines, already the page's words. */
  planNotices: string[];
  /** P2: the auto re-adoption's one-shot failure, written to the composer foot. */
  adoptError: { text: string; keep: boolean } | null;
  /** P2: "采用中…" on the plan card's foot while a re-adoption waits. */
  adoptNote: string;
  inbox: NavInbox & { local: boolean; remote: boolean };
  gb: { canPause: boolean; canResume: boolean; canCancel: boolean; canRequeue: boolean };
};

/** The one gap word the Plan page draws; the phrase stays in `gapTextOf`'s table. */
const UNCOVERED_TEXT = gapTextOf(['uncovered_requirement']);

/** 121-147/121-171: an active Task whose failure round has no check covering a
 * required requirement is a current-state note on the conversation's tail. The
 * row keeps only the fact; its button prefills the composer with `draft`. No
 * other gap code belongs here. */
function gapsOf(tasks: MainData['tasks']): PlanData['gaps'] {
  if (tasks === null) return [];
  const gaps: PlanData['gaps'] = [];
  for (const task of tasks.tasks) {
    if (task.disposition !== 'active') continue;
    const codes = task.failure?.round?.gapCodes;
    if (!Array.isArray(codes) || !codes.includes('uncovered_requirement')) continue;
    gaps.push({
      taskId: task.definition.taskId,
      text: '缺项：' + task.definition.title + '：' + UNCOVERED_TEXT + '。',
      draft: askCheckDraftOf(task.definition.title),
    });
  }
  return gaps;
}

/** §2.7: the newest round carrying goal-card drafts, and its request root. */
function goalCardOf(pages: readonly MainPageRead[], goals: MainData['goals']): PlanGoalCard {
  for (const page of pages) {
    for (const request of page.requests) {
      for (let index = request.rounds.length - 1; index >= 0; index -= 1) {
        const round = request.rounds[index]!;
        if (round.goalCardDrafts.length === 0) continue;
        const confirmed = round.goalCardDrafts
          .filter((row) => row.confirmedGoalRef !== null)
          .map((row) => ({ text: '已确认目标卡，自治档位：' + AUTONOMY_TEXT[row.draft.autonomy] }));
        const first = round.goalCardDrafts.find((row) => row.confirmedGoalRef === null) ?? null;
        const sourceId = request.source?.goalRef.goalId ?? '';
        const source = sourceId === '' ? undefined : goals.find((goal) => goal.goalId === sourceId);
        return {
          draft: first === null ? null : {
            requestRoot: request.requestRoot,
            round: round.ref,
            index: first.index,
            objective: first.draft.objective,
            completion: first.draft.completion,
            autonomyText: AUTONOMY_TEXT[first.draft.autonomy],
            fromGoal: source === undefined ? null : { ordinal: source.ordinal, objective: source.objective },
          },
          confirmed,
        };
      }
    }
  }
  return { draft: null, confirmed: [] };
}

/** §2.8: the newest round with ideas and its request, only requests belonging to this page's Goal. */
export function ideasRoundOf(
  pages: readonly MainPageRead[], goalId: string | null,
): { request: PlanRequestRead; round: PlanRoundRead } | null {
  for (const page of pages) {
    for (const request of page.requests) {
      if (request.effectiveGoalId !== goalId) continue;
      for (let index = request.rounds.length - 1; index >= 0; index -= 1) {
        const round = request.rounds[index]!;
        if (round.ideas.length > 0) return { request, round };
      }
    }
  }
  return null;
}

/** P4: one `plan_notice` summary in the page's words. The three shapes the
 * server writes today are rewritten without machine prefixes, task ids, route
 * names or duty codes; any other shape draws nothing rather than the raw text. */
export function planNoticeTextOf(summary: string): string {
  if (summary.startsWith('阶段 ')) return stageNoticeTextOf(summary);
  if (summary.includes('usage:') && summary.includes('lines:')) return deviationNoticeTextOf(summary);
  const noLine = /^任务 \S+「(.+?)」的检查已跑完，执行结果审阅在等：/.exec(summary);
  if (noLine !== null) return '任务 ' + noLine[1]! + '的检查已跑完，执行结果审阅在等；项目里没有审阅线。';
  return '';
}

/** One token reading in the page's words. The server writes `1200000` and
 * `at least 900000, incomplete` in deviation summaries; stage summaries write
 * the same reading as `至少 900000，不全`. `unknown`, a reason tail and any
 * unreadable value are `未知`, never the English reason. */
function tokenReadingOf(raw: string): string {
  const text = raw.trim();
  const english = /^(at least )?(\d+)(, incomplete)?$/.exec(text);
  if (english !== null) {
    return (english[1] === undefined ? '' : '至少 ') + english[2]! + ' token'
      + (english[3] === undefined ? '' : '（不全）');
  }
  const chinese = /^至少 (\d+)，不全$/.exec(text);
  if (chinese !== null) return '至少 ' + chinese[1]! + ' token（不全）';
  return '未知';
}

/** Stage end: keep the three readings and the rework count; drop the stage and
 * task ids, the next stage's size classes and the over-line tail. */
function stageNoticeTextOf(summary: string): string {
  const parts = summary.split(' · ');
  const after = (prefix: string): string => {
    const part = parts.find((entry) => entry.startsWith(prefix));
    return part === undefined ? '' : part.slice(prefix.length);
  };
  const token = after('token ');
  const growth = after('增长 ');
  const lines = after('行数 ');
  if (token === '' || growth === '' || lines === '') return '';
  const rework = after('返工 ');
  /* A line reading has no added/deleted counts; an unknown one drops the
     server's English reason the same way the tokens do. */
  const lineText = lines.startsWith('未知') ? '未知' : lines;
  return '阶段结束：用量 ' + tokenReadingOf(token) + '，增长 ' + tokenReadingOf(growth) + '，改了 ' + lineText + '。'
    + (rework === '' ? '' : '返工 ' + rework + '。');
}

/** Deviation: the two readings plus the adviser's own words. A summary whose
 * numbers cannot be read is the one fixed sentence, never the raw prefixes. */
function deviationNoticeTextOf(summary: string): string {
  const usage = /usage: ([^;\n]+); growth: ([^\n]+)/.exec(summary);
  const lines = /lines: (at least )?(\d+) \(added (\d+), deleted (\d+)\)(, incomplete)?/.exec(summary);
  if (usage === null || lines === null) return '偏差的读数暂时读不到。';
  const humanAt = summary.indexOf(' · 参谋不改计划 · ');
  const human = humanAt < 0 ? '' : summary.slice(humanAt + ' · 参谋不改计划 · '.length).trim();
  return '偏差：用量 ' + tokenReadingOf(usage[1]!) + '，增长 ' + tokenReadingOf(usage[2]!) + '，改了 '
    + (lines[1] === undefined ? '' : '至少 ') + lines[2]! + ' 行（新增 ' + lines[3]! + '、删除 ' + lines[4]! + '）'
    + (lines[5] === undefined ? '' : '，不全')
    + (human === '' ? '' : '；参谋不改计划：' + human);
}

export function planChecksOf(draft: PlanRevisionDraft): { k: string; v: string }[] {  const checks: { k: string; v: string }[] = [];
  for (const obligation of draft.obligations) {
    if (obligation.verificationRequirements.length === 0) checks.push({ k: obligation.title, v: '' });
    for (const requirement of obligation.verificationRequirements) {
      checks.push({ k: obligation.title, v: requirement.description });
    }
  }
  return checks;
}

/** A task's stage is `taskStageOf`'s; a task without one (goal scope) is
 * still listed, in a group without a stage name, as the task tree hangs it on
 * its goal (lead 11-12); an undeclared stage is named by its id. */
export function tasksOf(draft: PlanRevisionDraft): { name: string; items: { taskId: string; name: string }[] }[] {
  const groups = draft.stages.map((stage) => ({
    id: stage.stageId, name: stage.title, items: [] as { taskId: string; name: string }[],
  }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const task of draft.tasks) {
    const id = taskStageOf(task);
    let group = byId.get(id);
    if (group === undefined) {
      group = { id, name: id, items: [] };
      byId.set(id, group);
      groups.push(group);
    }
    group.items.push({ taskId: task.taskId, name: task.title });
  }
  return groups.filter((group) => group.items.length > 0).map(({ name, items }) => ({ name, items }));
}

/** §2.2 step 3/§2.8: the shown candidate and its request. */
function planOf(pages: readonly MainPageRead[], cand: PlanCandidateRead | null, nav: MainData): PlanDoc | null {
  const found = ideasRoundOf(pages, nav.selectedGoalId);
  if (found === null) return null;
  const { request, round } = found;
  const later = [...request.rounds].reverse().find((entry) => entry.selectedIdea !== null
    && requestRootKey(entry.selectedIdea.round) === requestRootKey(round.ref)) ?? null;
  const askRound = lastAnsweredRoundOf(request) ?? round.ref;
  const proposal = cand?.head ?? null;
  const error = cand?.error === true;
  /* P1: the card's own status decides the stale reason; `plans/request-candidate`
     alone keeps the old sentence (the card read can fail on its own). */
  const cardStale = cand?.facts?.card.candidateStatus === 'stale';
  const stale = cand?.status === 'stale' || cardStale;
  const live = !error && !stale && cand?.status === 'candidate' && proposal?.status === 'candidate';
  const staleText = cardStale ? candidateStaleTextOf(cand?.facts?.card.staleReason) : '已由新的一版取代';
  return {
    requestRoot: request.requestRoot,
    round: round.ref,
    askRound,
    selectable: round.ref.queryJobId === askRound.queryJobId,
    proposal,
    live,
    error,
    stText: error ? '还没接通' : proposal === null ? '' : live ? '未采用' : stale ? staleText : '',
    facts: cand === null ? [] : candidateFactsOf(cand.facts, proposal?.draft ?? null, nav),
    stale,
    staleText,
    foot: live || stale,
    hasDelta: live && (cand?.impact.marks.length ?? 0) > 0,
    delta: (cand?.impact.marks ?? []).map((mark) => ({ dm: mark.change, text: mark.after.task.title, ref: mark.taskId })),
    ideas: round.ideas,
    selectedIndex: later?.selectedIdea?.index ?? null,
    tasks: proposal === null ? [] : tasksOf(proposal.draft),
    checks: proposal === null ? [] : planChecksOf(proposal.draft),
  };
}

/** §2.4/§2.9: the plan page's inbox counts only the selected Goal; the notice
 * count stays the workspace's (Y1). The four controls are one shared rule. */
function inboxOf(main: MainData): PlanData['inbox'] {
  const rows = main.decisions === null ? [] : main.decisions.sections
    .flatMap((section) => section.rows)
    .filter((row) => row.level === 'decide' && row.goalId === main.selectedGoalId);
  const local = rows.length > 0;
  /* 121-146：队列整次没读到（`decisions` 为 null）也是下限，远端那一行写“暂时读不到”，不写 0。 */
  const partial = main.decisions === null || !main.decisions.counts.complete;
  return {
    ...main.inbox,
    local,
    remote: !local,
    decideN: rows.length,
    /* 121-146/U4：这个目标自己的行数是下限时写“至少”，0 张时写“暂时读不到”（和左栏同一条规则）。 */
    decideText: decideTextOf(rows.length, partial),
    hasDecide: local,
  };
}

/** §2.1: one flat object; every value the Plan page reads comes from here. */
export function adaptPlan(input: {
  main: MainData; pages: MainPageRead[]; cand: PlanCandidateRead | null;
  versions: PlanVersionRow[];
  adoptNote: string; adoptError: { text: string; keep: boolean } | null;
}): PlanData {
  const main = input.main;
  const notices = input.pages[0]?.notices ?? [];
  return {
    ...main,
    mapTaskIds: goalTaskIdsOf(main.tasks),
    goalCard: goalCardOf(input.pages, main.goals),
    plan: planOf(input.pages, input.cand, main),
    versions: input.versions,
    gaps: gapsOf(main.tasks),
    planNotices: main.selectedGoalId === null ? [] : notices
      .filter((notice) => notice.category === 'plan_notice' && subjectGoalId(notice.subject) === main.selectedGoalId)
      .map((notice) => planNoticeTextOf(notice.summary))
      .filter((text) => text !== ''),
    adoptError: input.adoptError,
    adoptNote: input.adoptNote,
    inbox: inboxOf(main),
    gb: goalControlsOf(main.selectedDisplay),
  };
}

/** The route value's own three fields as this edge reads them. The named shape
 * keeps `impact` this route's field: a read on a bare record counts as a read of
 * every member called `impact` (`tests/architecture/production-reach.ts`). */
type CandidateValue = { head: unknown; status: unknown; impact: { marks: unknown } };

/** The request-candidate route's value at the JSON edge (`ready` only). */
export function candidateReadOf(value: unknown): PlanCandidateRead {
  const row = asRecord(value) as CandidateValue;
  const headRaw = row.head;
  let head: PlanProposalShape | null = null;
  if (headRaw !== null && headRaw !== undefined) {
    const proposal = asRecord(headRaw);
    const ref = asRecord(proposal.ref);
    head = {
      ref: {
        aggregateType: 'PlanProposal',
        projectId: asText(ref.projectId), workspaceId: asText(ref.workspaceId),
        proposalId: asText(ref.proposalId),
      },
      revision: typeof proposal.revision === 'number' ? proposal.revision : 0,
      status: asText(proposal.status),
      issues: (Array.isArray(proposal.issues) ? proposal.issues : []).map((issue) => {
        const entry = asRecord(issue);
        return { path: asText(entry.path), code: asText(entry.code), message: asText(entry.message) };
      }),
      draft: proposal.draft as PlanRevisionDraft,
    };
  }
  const marks = asRecord(row.impact).marks;
  return {
    head,
    status: asText(row.status) as 'candidate' | 'stale' | 'closed',
    impact: {
      marks: (Array.isArray(marks) ? marks : []).map((mark) => {
        const entry = asRecord(mark);
        const change = asText(entry.change);
        return {
          taskId: asText(entry.taskId),
          change: change as 'changed' | 'cancelled' | 'superseded',
          after: { task: { title: asText(asRecord(asRecord(entry.after).task).title) } },
        };
      }),
    },
    facts: null,
    error: false,
  };
}
