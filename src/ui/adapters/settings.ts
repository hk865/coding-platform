/**
 * Settings page's one snapshot read and its write port, plus the pure folds of
 * the three project reads (rules, role limits, and the pages' own constants).
 * The page declares only the snapshot fields it draws (the settings page is
 * new; `src/ui` does not import `src/app`, so the DTO subset is written here).
 * The project name comes from the bootstrap the caller already read, never
 * from the snapshot.
 */
import {
  readyRouteValue, RouteReadError, type CoreScope, type RouteReply,
} from '../host-client.js';
import { asRecord } from '../values.js';
import type { UiClient } from './line-shared.js';
import { dutyWordOf } from './nav.js';
import { localShortAt } from './task-map.js';
import { rawModuleId } from '../../contracts/workspace-module-id.js';
import type { ResumeOnStartupMode } from '../../contracts/task-requeue.js';
import type { RoleLineDutyV1 } from '../../contracts/role-lines.js';
import type { RuleActionV1 } from '../../contracts/goal-decisions.js';

export type SettingsAccessFixed = 'startup_binding' | 'programmatic_runtime';
/** C3–C6 read these fields only; a route answer carrying more stays at the boundary. */
export type SettingsWorkspace = {
  scope: { projectId: string; workspaceId: string };
  name: string;
  root: string;
  writeAllowed: boolean;
  commandsAllowed: boolean;
  accessFixed: SettingsAccessFixed | null;
  /** KLS-2: whether this checkout's architecture and notes stay local and out of git. */
  knowledgeLocalOnly: boolean;
  checks?: SettingsCheck[];
  checkApprovals?: SettingsCheckApproval[];
  withdrawnChecks?: SettingsWithdrawnCheck[];
};
export type SettingsCheck = {
  checkId: string;
  command: string;
  taskIds: 'all' | string[];
};
export type SettingsCheckApproval = {
  checkId: string;
};
export type SettingsWithdrawnCheck = {
  checkId: string;
  withdrawnAt: string;
  plan?: unknown;
};

/** 121-106 / 4-28: why settings may not switch this workspace's two grants. The
 *  Host publishes two codes; `startup_binding` is the start-up configuration
 *  (the draft notes' “有启动绑定 / 启动配置”), the other is a programmatic runtime. */
export const ACCESS_FIXED_TEXT: Record<SettingsAccessFixed, string> = {
  startup_binding: '这个工作区有启动绑定：权限以启动配置为准，这里改不了。要改，改启动配置再重启 Host。',
  programmatic_runtime: '这个工作区由程序在运行时提供：权限由创建它的程序决定，这里改不了。',
};

/** The automation policy the page draws: the stored-or-default pair the Host
 *  publishes. A save installs it at once (`host-settings.ts` :1800). */
export type SettingsAutomation = { autoReworkLimit: number; resumeOnStartup: ResumeOnStartupMode };
export type SettingsResourceCaps = {
  memoryMaxMiB: number | null;
  tasksMax: number | null;
  defaults: { memoryMaxMiB: number; tasksMax: number };
  machine: { status: 'unknown' } | { status: 'available' }
    | { status: 'unavailable'; text: string };
};

/**
 * 抄自 `contracts/task-requeue.ts:140-144`。那个文件经 `fingerprint.ts` 带
 * `node:crypto`，浏览器包不能取值 import（`chain.ts:427-429` 的先例）。
 */
export const DEFAULT_RESUME_ON_STARTUP: ResumeOnStartupMode = 'ask';
export const DEFAULT_AUTO_REWORK_LIMIT = 3;
export const MAX_AUTO_REWORK_LIMIT = 10;
/**
 * 抄自 `contracts/role-lines.ts:35`、`:265-266`，出处和上面同：内存下限和进程数
 * 上下限仍从 `contracts/resource-caps.ts` 取值（那个文件不带 `fingerprint`）。
 */
export const ROLE_LINE_DUTY_ORDER: readonly RoleLineDutyV1[] = ['secretary', 'adviser', 'scribe', 'executor'];
export const ROLE_LINE_DEFAULT_RUNNING: Record<RoleLineDutyV1, number> =
  { secretary: 4, adviser: 4, scribe: 2, executor: 8 };
export const ROLE_LINE_DEFAULT_OPEN: Record<RoleLineDutyV1, number> =
  { secretary: 8, adviser: 8, scribe: 4, executor: 16 };

/** One check the page lists under its workspace. `source` is the page's rule:
 *  the snapshot's `checkApprovals` names it → a plan brought it; otherwise the
 *  approved list does. */
export type SettingsCheckRow = {
  checkId: string;
  command: string;
  tasksText: string;
  source: 'plan' | 'approved';
  sourceText: string;
};
/** One withdrawn check, with the same two sources and the Host's withdrawal time. */
export type SettingsWithdrawnRow = {
  checkId: string;
  source: 'plan' | 'approved';
  sourceText: string;
  withdrawnText: string;
};
/** One workspace row: the two grants plus everything drawn under it. */
export type SettingsWorkspaceRow = {
  key: string;
  scope: { projectId: string; workspaceId: string };
  name: string;
  path: string;
  writeAllowed: boolean;
  commandsAllowed: boolean;
  fixed: boolean;
  fixedText: string;
  commandDisabled: boolean;
  checks: SettingsCheckRow[];
  withdrawn: SettingsWithdrawnRow[];
  hasWithdrawn: boolean;
  noChecks: boolean;
  withdrawnText: string;
  knowledgeLocalOnly: boolean;
};

export type StructuralApprovalMode = 'auto' | 'ask';
export type SettingsStructuralApproval = {
  proposals: StructuralApprovalMode;
  repairs: StructuralApprovalMode;
};
/** One drawn structural switch: the stored-or-default mode, the factory default
 *  mark on the button that matches it, and the two buttons' classes. */
export type SettingsStructuralSwitch = {
  mode: StructuralApprovalMode;
  autoOn: boolean;
  askOn: boolean;
  autoIsDefault: boolean;
  askIsDefault: boolean;
};
export type SettingsStructuralSwitches = {
  proposals: SettingsStructuralSwitch;
  repairs: SettingsStructuralSwitch;
};
export type SettingsSnapshot = {
  workspaces: SettingsWorkspace[];
  structuralApproval: {
    saved: Readonly<Record<string, SettingsStructuralApproval>>;
    defaults: SettingsStructuralApproval;
  };
  commandReviewLine: { saved: number | null; effective: number; default: number };
  automation: SettingsAutomation;
  workRunTokenBudget: { saved: number | null; effective: number; max: number };
  resourceCaps: SettingsResourceCaps;
};

/**
 * One `autonomy-rules` answer's rule, narrowed to what the page draws
 * (`contracts/role-lines.ts:391-404`).
 */
type SettingsAutonomyRule = {
  ref: { ruleId: string };
  revision: number;
  actions: readonly RuleActionV1[];
  scope: readonly (
    | { kind: 'project' }
    | { kind: 'goal'; goalRef: { projectId: string; goalId: string } }
    | { kind: 'region'; moduleRef: { projectId: string; moduleId: string } }
  )[];
  limits: { open?: Partial<Record<RoleLineDutyV1, number>> } | null;
  expiresAt: string | null;
  approvedFrom: { cardKey: string; answerMessageRef: unknown } | null;
  state: 'active' | 'revoked';
};
export type SettingsRuleView = {
  set: { revision: number };
  rules: SettingsAutonomyRule[];
};
/** One Goal row the rule sub-lines name; merged across the project's workspaces. */
export type SettingsGoalName = { ordinal: number | null; objective: string };
/** What one rule's source card read answered: its date and the card's subject. */
export type SettingsRuleAnswer = {
  at: string;
  scope: 'goal' | 'project';
  goalId: string | null;
};
export type SettingsRuleRow = {
  ruleId: string;
  revision: number;
  name: string;
  sub: string;
  /** `YYYY-MM-DD` for the expiry editor's prefill; null when the rule never expires. */
  expiryDate: string | null;
};
export type SettingsRules = {
  /** `view.set.revision`, the set guard every rule write sends back. */
  setRevision: number;
  active: SettingsRuleRow[];
  revoked: SettingsRuleRow[];
};
export type SettingsRoleLimitRow = {
  duty: RoleLineDutyV1;
  name: string;
  running: number;
  open: number;
  runningDefault: number;
  openDefault: number;
  now: number | null;
};
export type SettingsRoleLimits = { revision: number; rows: SettingsRoleLimitRow[] };

/** 7D2 §5 lead's action words. The record makes a new `RuleActionV1` a type error
 *  instead of a wordless rule row. */
const RULE_ACTION_TEXT: Record<RuleActionV1, string> = {
  refine_future: '范围内细化',
  system_requeue: '系统自动重新入队',
  agent_requeue: 'agent 发起的返工',
  auto_reverify: '自动重新检查',
  minor_semantic_patch: '小的语义修补',
  agent_dispatch: 'agent 发起的派活',
  agent_stop: 'agent 发起的叫停',
  short_handoff: '短期线换手',
  secretary_too_long: '秘书太长换手',
  create_member: '创建成员',
  role_line_add: '加角色线',
  module_maintainer: '指定模块维护者',
  role_line_split: '拆范围',
  role_line_reuse: '复用待命的线',
  goal_queue_assign: '把排队的目标分给参谋',
  short_change_duty: '短期线换职责',
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const switchOf = (mode: StructuralApprovalMode, fallback: StructuralApprovalMode): SettingsStructuralSwitch => ({
  mode,
  autoOn: mode === 'auto',
  askOn: mode === 'ask',
  /* 表一 4: the factory default is marked on the button it names, not on the saved mode. */
  autoIsDefault: fallback === 'auto',
  askIsDefault: fallback === 'ask',
});

/** The workspace key both the settings rows and the git read use. */
export const settingsScopeKeyOf = (scope: { projectId: string; workspaceId: string }): string =>
  `${scope.projectId}\u0000${scope.workspaceId}`;

/** 7D2 §2/C2: the structured task list only. An all-task check says so; otherwise the
 *  count, never the joined task ids (the check's command is the row's name). */
const taskIdsTextOf = (taskIds: 'all' | string[]): string =>
  taskIds === 'all' ? '全部任务' : `${String(taskIds.length)} 个任务`;

const checkSourceOf = (planIds: ReadonlySet<string>, checkId: string): 'plan' | 'approved' =>
  planIds.has(checkId) ? 'plan' : 'approved';

const sourceTextOf = (source: 'plan' | 'approved'): string =>
  source === 'plan' ? '计划带来的' : '已批准清单';

/** One workspace's drawn row. A check whose id is also in the approved list wins
 *  over the withdrawn trace (D121-149-1: the page's rule, the backend keeps both). */
function workspaceRowOf(workspace: SettingsWorkspace): SettingsWorkspaceRow {
  const planIds = new Set((workspace.checkApprovals ?? []).map((approval) => approval.checkId));
  const seen = new Set<string>();
  const checks: SettingsCheckRow[] = [];
  for (const check of workspace.checks ?? []) {
    if (seen.has(check.checkId)) continue;
    seen.add(check.checkId);
    const source = checkSourceOf(planIds, check.checkId);
    checks.push({
      checkId: check.checkId,
      command: check.command,
      tasksText: taskIdsTextOf(check.taskIds),
      source,
      sourceText: sourceTextOf(source),
    });
  }
  const withdrawn: SettingsWithdrawnRow[] = (workspace.withdrawnChecks ?? [])
    .filter((check) => !seen.has(check.checkId))
    .map((check) => {
      const source: 'plan' | 'approved' = check.plan === undefined ? 'approved' : 'plan';
      return {
        checkId: check.checkId,
        source,
        sourceText: sourceTextOf(source),
        withdrawnText: localShortAt(check.withdrawnAt),
      };
    });
  const fixed = workspace.accessFixed !== null;
  const fixedText = workspace.accessFixed === null ? '' : ACCESS_FIXED_TEXT[workspace.accessFixed];
  return {
    key: settingsScopeKeyOf(workspace.scope),
    scope: workspace.scope,
    name: workspace.name,
    path: workspace.root,
    writeAllowed: workspace.writeAllowed,
    commandsAllowed: workspace.commandsAllowed,
    fixed,
    fixedText,
    /* The draft's own rule: a command grant without a write grant is not a
       representable state, so the command box is off while writing is off. */
    commandDisabled: fixed || !workspace.writeAllowed,
    checks,
    withdrawn,
    hasWithdrawn: withdrawn.length > 0,
    /* 表一 8: only a workspace with neither an installed nor a withdrawn check is empty. */
    noChecks: checks.length === 0 && withdrawn.length === 0,
    withdrawnText: `已撤回 ${withdrawn.length} 条`,
    knowledgeLocalOnly: workspace.knowledgeLocalOnly,
  };
}

/** The snapshot subset the page draws, before the four project reads are merged in. */
export type SettingsSnapshotData = {
  projectName: string;
  projectId: string;
  workspaces: SettingsWorkspaceRow[];
  structural: SettingsStructuralSwitches;
  commandReviewLine: SettingsSnapshot['commandReviewLine'];
  automation: SettingsAutomation;
  automationDefaults: SettingsAutomation;
  automationMax: number;
  tokenBudget: SettingsSnapshot['workRunTokenBudget'];
  resourceCaps: SettingsResourceCaps;
};
/** The whole page: the snapshot plus the four reads `readSettingsBoard` adds.
 *  `scope` is the project's first workspace and every project write's range. */
export type SettingsData = SettingsSnapshotData & {
  scope: CoreScope | null;
  rules: SettingsRules | null;
  roleLimits: SettingsRoleLimits | null;
  knowledgeGit: Record<string, boolean | null>;
};

/** The page's snapshot data: the snapshot subset plus the project identity the page needs. */
export function adaptSettings(snapshot: SettingsSnapshot, projectName = '', projectId = ''): SettingsSnapshotData {
  const workspaces = snapshot.workspaces;
  const currentProjectId = projectId !== '' ? projectId : workspaces[0]?.scope.projectId ?? '';
  /* 62-3: a project without a saved entry uses the factory default (both auto);
     the page draws `saved[current] ?? defaults`, never another project's row. */
  const modes = snapshot.structuralApproval.saved[currentProjectId]
    ?? snapshot.structuralApproval.defaults;
  const defaults = snapshot.structuralApproval.defaults;
  return {
    projectName,
    projectId: currentProjectId,
    workspaces: workspaces.map(workspaceRowOf),
    structural: {
      proposals: switchOf(modes.proposals, defaults.proposals),
      repairs: switchOf(modes.repairs, defaults.repairs),
    },
    commandReviewLine: snapshot.commandReviewLine,
    automation: snapshot.automation,
    automationDefaults: { autoReworkLimit: DEFAULT_AUTO_REWORK_LIMIT, resumeOnStartup: DEFAULT_RESUME_ON_STARTUP },
    automationMax: MAX_AUTO_REWORK_LIMIT,
    tokenBudget: snapshot.workRunTokenBudget,
    resourceCaps: snapshot.resourceCaps,
  };
}

/** `YYYY-MM-DD` in the page's own time zone for a rule's stored expiry. */
function localDateOf(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const at = new Date(ms);
  return `${String(at.getFullYear())}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** `MM-DD` in the page's own time zone for an answer's `createdAt`. */
function localMonthDayOf(iso: string): string {
  const at = new Date(iso);
  return `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** One Goal's page name: “目标 n · 〈objective〉”; a missing ordinal writes the
 *  objective alone and a missing row says the name is not readable. */
function goalTextOf(goals: Readonly<Record<string, SettingsGoalName>> | null, goalId: string,
  missing: string): string {
  const goal = goals?.[goalId];
  if (goal === undefined) return missing;
  return goal.ordinal === null ? goal.objective : `目标 ${String(goal.ordinal)} · ${goal.objective}`;
}

function ruleScopeTextOf(rule: SettingsAutonomyRule,
  goals: Readonly<Record<string, SettingsGoalName>> | null): string {
  return rule.scope.map((item) => {
    if (item.kind === 'project') return '整个项目';
    if (item.kind === 'goal') return goalTextOf(goals, item.goalRef.goalId, '目标（暂时读不到名字）');
    return `模块 ${rawModuleId(item.moduleRef.moduleId).moduleId}`;
  }).join('、');
}

/** “〈职责〉最多保留 n 条” for each duty the rule caps; none capped reads “不限条数”
 *  (`state/autonomy-rules.ts:96-98`: an absent open cap is no cap). */
function ruleLimitsTextOf(rule: SettingsAutonomyRule): string {
  const open = rule.limits?.open;
  const parts: string[] = [];
  for (const duty of ROLE_LINE_DUTY_ORDER) {
    const n = open?.[duty];
    if (typeof n === 'number') parts.push(`${dutyWordOf(duty)}最多保留 ${String(n)} 条`);
  }
  return parts.length === 0 ? '不限条数' : parts.join('、');
}

function ruleSourceTextOf(rule: SettingsAutonomyRule,
  goals: Readonly<Record<string, SettingsGoalName>> | null,
  answers: Readonly<Record<string, SettingsRuleAnswer>>): string {
  if (rule.approvedFrom === null) return '你直接建的';
  const answer = answers[rule.ref.ruleId];
  if (answer === undefined) return '你答卡时存的';
  const subject = answer.scope === 'goal' && answer.goalId !== null
    ? goalTextOf(goals, answer.goalId, '目标')
    : '项目';
  const label = subject === '项目' ? subject : `“${subject}”`;
  return `你在 ${localMonthDayOf(answer.at)} 答的${label}那张卡上存的`;
}

/**
 * One `autonomy-rules` answer, the project's Goal names, and the answers the
 * source cards yielded → the rules block. A revoked rule keeps only its scope:
 * the Host has no revocation time or execution count (`contracts/role-lines.ts:391-404`).
 */
export function settingsRulesOf(view: SettingsRuleView,
  goals: Readonly<Record<string, SettingsGoalName>> | null,
  answers: Readonly<Record<string, SettingsRuleAnswer>>): SettingsRules {
  const active: SettingsRuleRow[] = [];
  const revoked: SettingsRuleRow[] = [];
  for (const rule of view.rules) {
    const row = {
      ruleId: rule.ref.ruleId,
      revision: rule.revision,
      name: rule.actions.map((action) => RULE_ACTION_TEXT[action]).join('、'),
      expiryDate: rule.expiresAt === null ? null : localDateOf(rule.expiresAt),
    };
    const scopeText = ruleScopeTextOf(rule, goals);
    if (rule.state === 'revoked') {
      revoked.push({ ...row, sub: `${scopeText} · 已撤销` });
      continue;
    }
    const expiryText = rule.expiresAt === null ? '不过期' : `到 ${localShortAt(rule.expiresAt)}`;
    active.push({ ...row, sub: [scopeText, ruleLimitsTextOf(rule), expiryText,
      ruleSourceTextOf(rule, goals, answers)].join(' · ') });
  }
  return { setRevision: view.set.revision, active, revoked };
}

/**
 * One `projects/role-limits` answer and the allocation read → the four rows.
 * `now` counts the duty's holders, the same measure as “保留”; the number of
 * lines actually running has no read (`contracts/role-lines.ts:272-275`).
 */
export function settingsRoleLimitsOf(
  view: { revision: number; running: Record<RoleLineDutyV1, number>; open: Record<RoleLineDutyV1, number> },
  allocation: { duties: Record<RoleLineDutyV1, { holders: readonly unknown[] }> } | null,
): SettingsRoleLimits {
  const rows = ROLE_LINE_DUTY_ORDER.map((duty): SettingsRoleLimitRow => ({
    duty,
    name: dutyWordOf(duty),
    running: view.running[duty],
    open: view.open[duty],
    runningDefault: ROLE_LINE_DEFAULT_RUNNING[duty],
    openDefault: ROLE_LINE_DEFAULT_OPEN[duty],
    now: allocation === null ? null : allocation.duties[duty].holders.length,
  }));
  return { revision: view.revision, rows };
}

/** A date from the expiry editor (`YYYY-MM-DD`) as the day's local 23:59 instant. */
export function ruleExpiresAtOf(date: string): string {
  const [yearText = '0', monthText = '1', dayText = '1'] = date.split('-');
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText), 23, 59).toISOString();
}

/**
 * The Host's “saved, but the Host configuration was not confirmed” answer
 * (`host-settings.ts` :1911/:2018/:2048, `checks/withdraw` :1534/:1569):
 * `status:'rejected'`, `code:'unavailable'`, and a reason saying the value was
 * saved while the Host configuration was not confirmed. The save did change the
 * stored setting, so the page must draw “已保存，尚未生效” and let the person
 * resend the same write, never the generic failure text (draft notes §8).
 */
export class SettingsNotEffectiveError extends Error {
  readonly pending = true;
  constructor(readonly route: string) {
    super(`${route} was saved but the Host configuration was not confirmed`);
    this.name = 'SettingsNotEffectiveError';
  }
}

/** The two reason spellings of that answer: the English routes and the Chinese
 *  `checks/withdraw`. The distinction is the Host's reason, not the route. */
const SAVED_NOT_CONFIRMED = /saved but the Host configuration was not confirmed|撤回已保存，Host 还没确认/;

/** One `settings/snapshot`; a rejected or unready answer is the page's read error. */
export async function readSettings(
  client: UiClient, _goalId: string | null, projectId = '',
): Promise<SettingsSnapshotData> {
  const reply = await client.settings('snapshot', {});
  return adaptSettings(readyRouteValue<SettingsSnapshot>(reply, 'settings/snapshot'), '', projectId);
}

/** One settings write; the answer's own snapshot is the new page data, with no
 * second read. Some routes answer `{settings, bootstrap}` instead of the
 * snapshot itself, so the snapshot is taken from `.settings` when present. */
export async function saveSettings(
  client: UiClient, route: string, input: unknown, projectId = '',
): Promise<SettingsSnapshotData> {
  let reply: RouteReply;
  try {
    reply = await client.settings(route, input);
  } catch (error) {
    if (error instanceof RouteReadError && error.code === 'unavailable'
      && SAVED_NOT_CONFIRMED.test(error.reason)) {
      throw new SettingsNotEffectiveError(route);
    }
    throw error;
  }
  const value = readyRouteValue<unknown>(reply, route);
  const record = asRecord(value);
  const snapshot = (record.settings ?? value) as SettingsSnapshot;
  if (typeof snapshot !== 'object' || snapshot === null || !Array.isArray(snapshot.workspaces)) {
    throw new RouteReadError(route, 'invalid', 'the settings answer carries no snapshot');
  }
  return adaptSettings(snapshot, '', projectId);
}
