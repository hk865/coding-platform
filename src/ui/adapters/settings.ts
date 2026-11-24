/**
 * Settings page's one read and one write port. The page declares only the
 * snapshot fields it draws (the settings page is new; `src/ui` does not import
 * `src/app`, so the DTO subset is written here). The project name comes from
 * the bootstrap the caller already read, never from the snapshot.
 */
import {
  readyRouteValue, RouteReadError, type RouteReply,
} from '../host-client.js';
import { asRecord } from '../values.js';
import type { UiClient } from './line-shared.js';
import { localShortAt } from './task-map.js';

export type SettingsAccessFixed = 'startup_binding' | 'programmatic_runtime';
/** C3–C6 read these fields only; a route answer carrying more stays at the boundary. */
export type SettingsWorkspace = {
  scope: { projectId: string; workspaceId: string };
  name: string;
  root: string;
  writeAllowed: boolean;
  commandsAllowed: boolean;
  accessFixed: SettingsAccessFixed | null;
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
const ACCESS_FIXED_TEXT: Record<SettingsAccessFixed, string> = {
  startup_binding: '这个工作区有启动绑定：权限以启动配置为准，这里改不了。要改，改启动配置再重启 Host。',
  programmatic_runtime: '这个工作区由程序在运行时提供：权限由创建它的程序决定，这里改不了。',
};

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
};
export type SettingsData = {
  projectName: string;
  projectId: string;
  workspaces: SettingsWorkspaceRow[];
  structural: SettingsStructuralSwitches;
  commandReviewLine: SettingsSnapshot['commandReviewLine'];
};

const switchOf = (mode: StructuralApprovalMode, fallback: StructuralApprovalMode): SettingsStructuralSwitch => ({
  mode,
  autoOn: mode === 'auto',
  askOn: mode === 'ask',
  /* 表一 4: the factory default is marked on the button it names, not on the saved mode. */
  autoIsDefault: fallback === 'auto',
  askIsDefault: fallback === 'ask',
});

const settingsScopeKeyOf = (scope: { projectId: string; workspaceId: string }): string =>
  `${scope.projectId}\u0000${scope.workspaceId}`;

const taskIdsTextOf = (taskIds: 'all' | string[]): string =>
  taskIds === 'all' ? '全部任务' : taskIds.join('、');

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
  };
}

/** The page's data: the snapshot subset plus the project identity the page needs. */
export function adaptSettings(snapshot: SettingsSnapshot, projectName = '', projectId = ''): SettingsData {
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
  };
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
): Promise<SettingsData> {
  const reply = await client.settings('snapshot', {});
  return adaptSettings(readyRouteValue<SettingsSnapshot>(reply, 'settings/snapshot'), '', projectId);
}

/** One settings write; the answer's own snapshot is the new page data, with no
 * second read. Some routes answer `{settings, bootstrap}` instead of the
 * snapshot itself, so the snapshot is taken from `.settings` when present. */
export async function saveSettings(
  client: UiClient, route: string, input: unknown, projectId = '',
): Promise<SettingsData> {
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
