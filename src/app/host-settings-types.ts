/** Host-local settings DTOs. These never form an Agent tool or a domain writer. */
import type { CoreScope, BootstrapResponse } from './core-http-types.js';
import type { QueryJobAnswerRef } from '../contracts/query-job.js';
import type { RegisteredCommandCheck } from '../contracts/verification.js';
import type { ResumeOnStartupMode, TaskAutomationPolicyV1 } from '../contracts/task-requeue.js';
import type { ResourceCapUnavailableReasonV1 } from '../contracts/resource-caps.js';
import type { PlanLoopLimitsV1 } from '../contracts/plan-loop-limits.js';
import type { StructuralApprovalV1 } from '../contracts/architecture-proposal.js';
import type {
  PromptPackProblemV1, TemplateSlotTableV1, ToolTextV1,
} from '../contracts/prompts/prompt-pack.js';
import type { ReasoningReplayV1 } from '../contracts/prompts/prompt-set.js';
import type {
  ChecksConfirmationPort, ChecksEntryPort, SavedChecksReadPort, SettingsSerialGatePort,
} from '../core/work-graph/model/initialization-adoption-contracts.js';

export const SETTINGS_API_PREFIX = '/api/real/settings/';
/** The Work Run token budget a Host uses until `run-budget/save` stores one. */
export const DEFAULT_WORK_RUN_TOKEN_BUDGET = 400_000_000;
/** The largest Work Run token budget a save may store. */
export const MAX_WORK_RUN_TOKEN_BUDGET = 600_000_000;
export type SettingsProvider = 'deepseek' | 'openai';
export type SettingsModel = {
  id: string; label: string; provider: SettingsProvider; model: string; baseUrl: string;
  credentialConfigured: boolean;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  /** The person's prompt pack for this model; absent means `platform`. */
  promptPack?: string;
  /** The reasoning-replay policy; absent means `all`. */
  reasoningReplay?: ReasoningReplayV1;
};
/** 121-106 / 4-28: whose two switches settings may change. A start-up runtime binding keeps the grant its start-up
 *  configuration declares, so settings do not rebuild it; a programmatic runtime is never rebuilt from settings;
 *  `null` means `workspaces/access` may switch this workspace. */
export type SettingsAccessFixed = 'startup_binding' | 'programmatic_runtime';
export type SettingsWorkspace = {
  scope: CoreScope; name: string; root: string; modelId: string | null;
  writeAllowed: boolean; commandsAllowed: boolean;
  accessFixed: SettingsAccessFixed | null;
  /** R6: user-approved registered checks for exactly this workspace scope.
   * Absent for a scope that never approved any. The model's own suggestion is
   * never stored here; only an explicit Host user approval is. */
  checks?: RegisteredCommandCheck[];
  /** U8: where the workspace's project store lives; absent for a memory store or a project that is not open. */
  storeLocation?: SettingsStoreLocation;
  /** KLS-2: whether the architecture and notes of this workspace's current checkout stay local and out of git. It is
   *  kept per checkout, so every project mounting the same checkout sees it; a folder in no git work tree is false. */
  knowledgeLocalOnly: boolean;
};
/** A project store's place and, only for the local data directory, the one sentence saying why. */
export type SettingsStoreLocation = { place: 'git-common' | 'workspace-local' | 'user-data'; reason: string | null };
export type HostSettingsSnapshot = {
  models: SettingsModel[]; workspaces: SettingsWorkspace[];
  /**
   * C8 automatic-rework policy (Host setting `automation`) as stored: the
   * saved policy, or the defaults (3 / ask) when none was saved. A save
   * installs it in the Host at once, unless `automation/save` answered
   * `unavailable` (saved, Host configuration not confirmed); then the Host
   * may still apply the previous policy until a retry of the same save
   * installs it. The backend publishes it since A.2 step 5.8 (`automation/save`).
   */
  automation: TaskAutomationPolicyV1;
  /**
   * L13/决定 55: the Host resource-cap setting as stored, its machine-computed
   * defaults, the effective values and this machine's Kernel capability status.
   * The backend publishes it since `resource-caps/save`.
   */
  resourceCaps: SettingsResourceCaps;
  /**
   * The Work Run token budget as stored (`saved: null` means no value was
   * saved), the effective budget (`saved ?? DEFAULT_WORK_RUN_TOKEN_BUDGET`)
   * and the largest value a save accepts. A save installs it in the Host at
   * once and the next Work Run uses it; a Run already claimed keeps its budget.
   */
  workRunTokenBudget: { saved: number | null; effective: number; max: number };
  /**
   * PL/§10.3: the plan-loop limits as stored (`saved: null` means none was
   * saved), the effective table (`saved ?? defaults`) the next deviation
   * judgment uses, and the frozen defaults. The backend publishes it since
   * `plan-loop-limits/save`.
   */
  planLoopLimits: { saved: PlanLoopLimitsV1 | null; effective: PlanLoopLimitsV1; defaults: PlanLoopLimitsV1 };
  /**
   * SHT-2 (121-112): the project review line in minutes as stored (`saved:
   * null` means none was saved), the effective value (`saved ?? 60`) and the
   * default. The Host installs it at once; a command already over the old line
   * is not re-noticed.
   */
  commandReviewLine: { saved: number | null; effective: number; default: number };
  /**
   * 121-106 item 5, 121-109: each project's structural auto-approval as stored (`saved`, keyed by projectId; a
   * project without an entry uses `defaults`, the factory "auto" for both switches).
   */
  structuralApproval: { saved: Readonly<Record<string, StructuralApprovalV1>>; defaults: StructuralApprovalV1 };
};
/**
 * PL/§10.3: the whole `plan-loop-limits` setting. `null` clears the saved table
 * and restores `DEFAULT_PLAN_LOOP_LIMITS`; any other value is one complete
 * schema-1 table, never filled from the defaults.
 */
export type SavePlanLoopLimitsSettings = { planLoopLimits: PlanLoopLimitsV1 | null };
/**
 * L13: the resource-cap setting projection. `memoryMaxMiB`/`tasksMax` are the
 * STORED values (`null` means the default); `defaults` is the L13 formula over
 * `os.totalmem()`; `effective` is stored-or-default; `machine` is read from the
 * Kernel cache through the optional assembly member, never by probing.
 */
export type SettingsResourceCaps = {
  memoryMaxMiB: number | null;
  tasksMax: number | null;
  defaults: { memoryMaxMiB: number; tasksMax: number };
  effective: { memoryMaxMiB: number; tasksMax: number };
  machine: { status: 'unknown' } | { status: 'available' }
    | { status: 'unavailable'; reason: ResourceCapUnavailableReasonV1; text: string };
};
/** L13: the whole `resourceCaps` setting; both fields are required, `null` is the default. */
export type SaveResourceCapSettings = { memoryMaxMiB: number | null; tasksMax: number | null };
/**
 * `run-budget/save`: the whole Work Run token budget setting. `null` clears the
 * stored value and restores `DEFAULT_WORK_RUN_TOKEN_BUDGET`; any other value
 * must be an integer 1..`MAX_WORK_RUN_TOKEN_BUDGET`.
 */
export type SaveWorkRunTokenBudgetSettings = { workRunTokenBudget: number | null };
/**
 * SHT-2 (121-112): the whole project review-line setting, in minutes. `null`
 * clears the stored value and restores `DEFAULT_COMMAND_REVIEW_LINE_MINUTES`;
 * any other value must be a positive safe integer (no upper bound).
 */
export type SaveCommandReviewLineSettings = { commandReviewLineMinutes: number | null };
/**
 * C8 / LA-6 Host setting `automation` (route `automation/save`): the whole
 * policy, `autoReworkLimit` an integer 0..10 (`MAX_AUTO_REWORK_LIMIT`; 0 allows
 * no counted automatic requeue) and `resumeOnStartup` (what a start does with
 * the Goals it interrupted: auto / ask / off). The Host installs it at once,
 * without a restart.
 */
export type SaveAutomationSettings = { autoReworkLimit: number; resumeOnStartup: ResumeOnStartupMode };
/** KLS-2 (route `knowledge-local`): keep the knowledge of the workspace's current checkout local, or stop. The Host
 *  finds the checkout itself; the body names no path. */
export type SaveKnowledgeLocalSettings = { projectId: string; workspaceId: string; localOnly: boolean };
/** 121-109 (route `structural-approval/save`): one project's two structural switches; `null` restores the factory
 *  default. */
export type SaveStructuralApprovalSettings = { projectId: string; value: StructuralApprovalV1 | null };
/** 121-106 (route `workspaces/access`): switch one registered workspace's write and command access. Commands require
 *  write. NET-B adds its network field here later. */
export type SaveWorkspaceAccess = { scope: CoreScope; writeAllowed: boolean; commandsAllowed: boolean };
export type DirectoryListing = {
  path: string; parent: string | null;
  directories: { name: string; path: string }[]; truncated: boolean;
};
export type SaveSettingsModel = {
  id?: string; label: string; provider: SettingsProvider; model: string; baseUrl?: string;
  /** Omitted/empty retains an existing key. The server never sends a key back. */
  apiKey?: string;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  /** Omitted clears the stored pack (it resolves to `platform`). */
  promptPack?: string;
  /** Omitted clears the stored policy (it resolves to `all`). */
  reasoningReplay?: ReasoningReplayV1;
};
export type OpenSettingsWorkspace = {
  path: string; name?: string; modelId?: string;
  /** Omit to open a new project; set to add a workspace under an existing Host project. */
  projectId?: string;
  writeAllowed: boolean; commandsAllowed: boolean;
};

/**
 * R6 cold-start explicit user approval of the checks suggested by one saved
 * initial-plan Answer. The model suggestion is only a candidate; this route is
 * the narrow Host-user action that turns it into this workspace's trusted check
 * configuration. `answerRef` binds the approval to the real saved Answer and
 * `scope` binds it to exactly one workspace. Checks that a registered command
 * could execute require the workspace's real write+command grant.
 */
export type ApproveWorkspaceChecks = {
  scope: CoreScope;
  answerRef: QueryJobAnswerRef;
  checks: RegisteredCommandCheck[];
};
export type PromptPackListV1 = {
  packs: {
    packId: string;
    extends: string | null;
    problems: readonly PromptPackProblemV1[];
    templates: readonly {
      templateId: string; version: number; fromPack: string; problems: readonly PromptPackProblemV1[];
    }[];
  }[];
};

export type PromptPackCreateV1 = {
  packId: string;
  extends: 'platform';
  templates: readonly [];
  strings: Readonly<Record<string, never>>;
  tools: Readonly<Record<string, never>>;
};

export type PromptTemplateReadV1 = {
  templateId: string;
  version: number;
  fromPack: string;
  text: string;
  slots: TemplateSlotTableV1;
  mentionsTools: readonly string[];
};

export type PromptTemplateSaveV1 = PromptTemplateReadV1;
export type PromptToolReadV1 = {
  toolName: string;
  fromPack: string;
  entry: ToolTextV1;
  digest: string;
};
export type PromptToolSaveV1 = PromptToolReadV1;

export type SettingsRoutes = {
  snapshot: { input: Record<string, never>; value: HostSettingsSnapshot };
  directories: { input: { path?: string; showHidden?: boolean }; value: DirectoryListing };
  'models/save': { input: SaveSettingsModel; value: HostSettingsSnapshot };
  'models/select': { input: { scope: CoreScope; modelId: string }; value: HostSettingsSnapshot };
  'workspaces/open': { input: OpenSettingsWorkspace; value: { settings: HostSettingsSnapshot; bootstrap: BootstrapResponse; scope: CoreScope } };
  'workspaces/access': { input: SaveWorkspaceAccess; value: { settings: HostSettingsSnapshot; bootstrap: BootstrapResponse } };
  'checks/approve': { input: ApproveWorkspaceChecks; value: HostSettingsSnapshot };
  'automation/save': { input: SaveAutomationSettings; value: HostSettingsSnapshot };
  'resource-caps/save': { input: SaveResourceCapSettings; value: HostSettingsSnapshot };
  'run-budget/save': { input: SaveWorkRunTokenBudgetSettings; value: HostSettingsSnapshot };
  'command-review/save': { input: SaveCommandReviewLineSettings; value: HostSettingsSnapshot };
  'plan-loop-limits/save': { input: SavePlanLoopLimitsSettings; value: HostSettingsSnapshot };
  'knowledge-local': { input: SaveKnowledgeLocalSettings; value: HostSettingsSnapshot };
  'structural-approval/save': { input: SaveStructuralApprovalSettings; value: HostSettingsSnapshot };
  'prompts/packs/list': { input: Record<string, never>; value: PromptPackListV1 };
  'prompts/packs/create': { input: { packId: string }; value: PromptPackCreateV1 };
  'prompts/templates/read': { input: { packId: string; templateId: string }; value: PromptTemplateReadV1 };
  'prompts/templates/save': {
    input: { packId: string; templateId: string; expectedVersion: number; text: string; mentionsTools: string[] };
    value: PromptTemplateSaveV1;
  };
  'prompts/tools/read': { input: { packId: string; toolName: string }; value: PromptToolReadV1 };
  'prompts/tools/save': {
    input: { packId: string; toolName: string; expectedDigest: string; entry: ToolTextV1 };
    value: PromptToolSaveV1;
  };
};
export type SettingsRoute = keyof SettingsRoutes;
export type SettingsResponse<T> = { status: 'ready'; value: T }
  | { status: 'rejected'; code: 'invalid' | 'forbidden' | 'not_found' | 'revision_conflict' | 'unavailable' | 'unsupported';
      reason: string; problems?: readonly PromptPackProblemV1[] };
export interface HostSettingsPort {
  call<K extends SettingsRoute>(route: K, input: SettingsRoutes[K]['input']): Promise<SettingsResponse<SettingsRoutes[K]['value']>>;
}

/**
 * The checks entry published on the settings object: the narrow adoption save, the saved-state read, the
 * installed confirmation, and the one settings serial queue. Callers use these methods; there is no second
 * settings writer or installed-configuration map.
 */
export interface ChecksAdoptionEntryPort
  extends ChecksEntryPort, ChecksConfirmationPort, SavedChecksReadPort, SettingsSerialGatePort {}
