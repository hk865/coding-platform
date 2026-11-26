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
  } | null;
  confirmed: { text: string }[];
};

export type PlanCandidateRead = {
  head: PlanProposalShape | null;
  status: 'candidate' | 'stale' | 'closed';
  impact: { marks: { taskId: string; change: 'changed' | 'cancelled' | 'superseded';
    after: { task: { title: string } } }[] };
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
  gaps: { taskId: string; text: string }[];
  inbox: NavInbox & { local: boolean; remote: boolean };
  gb: { canPause: boolean; canResume: boolean; canCancel: boolean; canRequeue: boolean };
};

/** The one gap word the Plan page draws; the phrase stays in `gapTextOf`'s table. */
const UNCOVERED_TEXT = gapTextOf(['uncovered_requirement']);

/** 121-147: an active Task whose failure round has no check covering a
 * required requirement is a current-state note on the conversation's tail. No
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
      text: '缺项：' + task.definition.title + '：' + UNCOVERED_TEXT
        + '。要补检查，在主对话里说，参谋会起草带新检查的计划。',
    });
  }
  return gaps;
}

/** §2.7: the newest round carrying goal-card drafts, and its request root. */
function goalCardOf(pages: readonly MainPageRead[]): PlanGoalCard {
  for (const page of pages) {
    for (const request of page.requests) {
      for (let index = request.rounds.length - 1; index >= 0; index -= 1) {
        const round = request.rounds[index]!;
        if (round.goalCardDrafts.length === 0) continue;
        const confirmed = round.goalCardDrafts
          .filter((row) => row.confirmedGoalRef !== null)
          .map((row) => ({ text: '已确认目标卡，自治档位：' + AUTONOMY_TEXT[row.draft.autonomy] }));
        const first = round.goalCardDrafts.find((row) => row.confirmedGoalRef === null) ?? null;
        return {
          draft: first === null ? null : {
            requestRoot: request.requestRoot,
            round: round.ref,
            index: first.index,
            objective: first.draft.objective,
            completion: first.draft.completion,
            autonomyText: AUTONOMY_TEXT[first.draft.autonomy],
          },
          confirmed,
        };
      }
    }
  }
  return { draft: null, confirmed: [] };
}

/** §2.8: the newest round with ideas and its request. */
export function ideasRoundOf(pages: readonly MainPageRead[]): { request: PlanRequestRead; round: PlanRoundRead } | null {
  for (const page of pages) {
    for (const request of page.requests) {
      for (let index = request.rounds.length - 1; index >= 0; index -= 1) {
        const round = request.rounds[index]!;
        if (round.ideas.length > 0) return { request, round };
      }
    }
  }
  return null;
}

export function planChecksOf(draft: PlanRevisionDraft): { k: string; v: string }[] {
  const checks: { k: string; v: string }[] = [];
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
function planOf(pages: readonly MainPageRead[], cand: PlanCandidateRead | null): PlanDoc | null {
  const found = ideasRoundOf(pages);
  if (found === null) return null;
  const { request, round } = found;
  const later = [...request.rounds].reverse().find((entry) => entry.selectedIdea !== null
    && requestRootKey(entry.selectedIdea.round) === requestRootKey(round.ref)) ?? null;
  const askRound = lastAnsweredRoundOf(request) ?? round.ref;
  const proposal = cand?.head ?? null;
  const error = cand?.error === true;
  const live = !error && cand?.status === 'candidate' && proposal?.status === 'candidate';
  return {
    requestRoot: request.requestRoot,
    round: round.ref,
    askRound,
    selectable: round.ref.queryJobId === askRound.queryJobId,
    proposal,
    live,
    error,
    stText: error ? '还没接通' : proposal === null ? '' : live ? '未采用'
      : cand?.status === 'stale' ? '已由新的一版取代' : '',
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
}): PlanData {
  const main = input.main;
  return {
    ...main,
    mapTaskIds: goalTaskIdsOf(main.tasks),
    goalCard: goalCardOf(input.pages),
    plan: planOf(input.pages, input.cand),
    versions: input.versions,
    gaps: gapsOf(main.tasks),
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
    error: false,
  };
}
