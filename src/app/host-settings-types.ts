/** Host-local settings DTOs. These never form an Agent tool or a domain writer. */
import type { CoreScope, BootstrapResponse } from './core-http-types.js';
import type { QueryJobAnswerRef } from '../contracts/query-job.js';
import type { RegisteredCommandCheck } from '../contracts/verification.js';
import type { ResumeOnStartupMode, TaskAutomationPolicyV1 } from '../contracts/task-requeue.js';
import type { ResourceCapUnavailableReasonV1 } from '../contracts/resource-caps.js';
import type {
  PromptPackProblemV1, TemplateSlotTableV1, ToolTextV1,
} from '../contracts/prompts/prompt-pack.js';
import type {
  ChecksConfirmationPort, ChecksEntryPort, SavedChecksReadPort, SettingsSerialGatePort,
} from '../core/work-graph/model/initialization-adoption-contracts.js';

export const SETTINGS_API_PREFIX = '/api/real/settings/';
export type SettingsProvider = 'deepseek' | 'openai';
export type SettingsModel = {
  id: string; label: string; provider: SettingsProvider; model: string; baseUrl: string;
  credentialConfigured: boolean;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  /** The person's prompt pack for this model; absent means `platform`. */
  promptPack?: string;
  /** The reasoning-replay policy; absent means `current_run`. */
  reasoningReplay?: 'current_run' | 'none';
};
export type SettingsWorkspace = {
  scope: CoreScope; name: string; root: string; modelId: string | null;
  writeAllowed: boolean; commandsAllowed: boolean;
  /** R6: user-approved registered checks for exactly this workspace scope.
   * Absent for a scope that never approved any. The model's own suggestion is
   * never stored here; only an explicit Host user approval is. */
  checks?: RegisteredCommandCheck[];
};
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
};
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
 * C8 / LA-6 Host setting `automation` (route `automation/save`): the whole
 * policy, `autoReworkLimit` an integer 0..10 (`MAX_AUTO_REWORK_LIMIT`; 0 allows
 * no counted automatic requeue) and `resumeOnStartup` (what a start does with
 * the Goals it interrupted: auto / ask / off). The Host installs it at once,
 * without a restart.
 */
export type SaveAutomationSettings = { autoReworkLimit: number; resumeOnStartup: ResumeOnStartupMode };
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
  /** Omitted clears the stored policy (it resolves to `current_run`). */
  reasoningReplay?: 'current_run' | 'none';
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
  'checks/approve': { input: ApproveWorkspaceChecks; value: HostSettingsSnapshot };
  'automation/save': { input: SaveAutomationSettings; value: HostSettingsSnapshot };
  'resource-caps/save': { input: SaveResourceCapSettings; value: HostSettingsSnapshot };
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
