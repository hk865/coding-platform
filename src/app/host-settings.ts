/**
 * Host real-directory and model-settings backend (Stage 2 implementation).
 *
 * Settings are Host-local user state, never an Agent tool and never a domain
 * writer. The shared DTO (`host-settings-types.ts`) is the only request/response
 * shape. A credential is write-only: it lives in the private persisted file and
 * the private Host callback snapshot, and is never returned, logged, put in
 * `process.env` or published in a snapshot.
 *
 * The startup `await createHostSettings(...)` reads the private file and restores
 * every persisted directory through the Host assembly BEFORE the Host listens;
 * a corrupt file fails startup explicitly instead of degrading to an empty
 * configuration. After every persisted change the validated private snapshot is
 * pushed to `onConfigurationChanged`; the Host keeps its original
 * bindings/grants and installs a NEW immutable runtime version.
 */
import { randomUUID } from 'node:crypto';
import type { QueryJobAnswerRef } from '../contracts/query-job.js';
import { checkBaselineProblem, checkDigestOf } from '../contracts/check-review.js';
import type { InstalledCheckOriginEntryV1 } from '../contracts/check-output.js';
import {
  checkConflictProblem, isRegisteredCommandCheck, proposedCheckSplit,
  type RegisteredCommandCheck, type TrustedCheckConfiguration,
} from '../contracts/verification.js';
import type {
  ChecksConfigurationPinV1, ChecksConfirmationV1, ChecksSaveResultV1, ChecksSettingsSourceV1,
} from '../contracts/initialization-adoption.js';
import { rejected } from '../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../contracts/core/results.js';
import type { PlanProposalRef } from '../core/work-graph/model/plan-contracts.js';
import type {
  ChecksConfirmationPort, StoredChecksStateV1,
} from '../core/work-graph/model/initialization-adoption-contracts.js';
import type { RepoKey } from '../core/work-graph/model/line-knowledge.js';
import {
  DEFAULT_STRUCTURAL_APPROVAL, structuralApprovalOf, type StructuralApprovalV1,
} from '../contracts/architecture-proposal.js';
import { applyKnowledgeExclude } from '../core/workspace/knowledge-exclude.js';
import { gitCommonDir } from '../core/workspace/workspace-change-capture.js';
import { mountReliability } from '../composition/project-store-location.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, MAX_AUTO_REWORK_LIMIT, RESUME_ON_STARTUP_MODES,
  type ResumeOnStartupMode, type TaskAutomationPolicyV1,
} from '../contracts/task-requeue.js';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import { hasOnlyKeys, isNonNeg, isPos, isRecord, isSha256Hex, nonEmpty } from '../contracts/validation/common.js';
import {
  checksConfigurationPinProblem,
} from '../contracts/validation/initialization-adoption.js';
import type { PromptPackChainEntryV1, PromptPackManifestV1, PromptPackProblemV1, ToolTextV1 } from '../contracts/prompts/prompt-pack.js';
import { resolvePromptPackV1 } from '../contracts/prompts/resolve-pack.js';
import {
  canonicalToolTextBody, isReasoningReplayV1, promptToolTextDigest, type ReasoningReplayV1,
} from '../contracts/prompts/prompt-set.js';
import { TEMPLATE_SLOTS } from '../contracts/prompts/slot-tables.js';
import {
  createDiskPromptPack, effectiveTemplateVersionOf, effectiveToolTextOf, isPromptPackId,
  listDiskPromptPacks, preparePackWriteTarget, readDiskPromptPack,
  type DiskPromptPackReadV1,
} from './prompt-packs.js';
import {
  MIB, RESOURCE_CAP_MAX_TASKS, RESOURCE_CAP_MIN_MEMORY_MIB, RESOURCE_CAP_MIN_TASKS,
  defaultResourceCapSettings, type ResourceCapSettingsV1, type ResourceCapUnavailableReasonV1,
} from '../contracts/resource-caps.js';
import { RESOURCE_CAP_NONE_TEXT } from '../../vendor/coding-agent/dist/public-api.js';
import type { ResourceCapCapability } from '../../vendor/coding-agent/dist/public-api.js';
import {
  DEFAULT_PLAN_LOOP_LIMITS, type PlanLoopLimitsV1, type TaskSizeClassV1,
} from '../contracts/plan-loop-limits.js';
import type { BootstrapResponse, CoreScope } from './core-http-types.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type {
  QueryRuntimeConfigurationInput,
  RuntimeConfigurationInput,
  RuntimeHostBindings,
} from '../core/agent-runtime/execution-contracts.js';
import { contextWindowTokensOf } from './runtime-configuration.js';
import type { WorkbenchRuntimeProviderDependencies } from './runtime-configuration.js';
import type {
  CheckApprovalV1,
  CheckApproverV1,
  ChecksAdoptionEntryPort,
  DirectoryListing,
  HostSettingsPort,
  HostSettingsSnapshot,
  OpenSettingsWorkspace,
  ReplacedPlanCheckV1,
  SaveResourceCapSettings,
  SettingsAccessFixed,
  SettingsModel,
  SettingsProvider,
  SettingsResourceCaps,
  SettingsResponse,
  SettingsRoute,
  SettingsRoutes,
  SettingsStoreLocation,
  PromptPackCreateV1,
  PromptPackListV1,
  PromptTemplateReadV1,
  PromptToolReadV1,
} from './host-settings-types.js';
import { DEFAULT_WORK_RUN_TOKEN_BUDGET, MAX_WORK_RUN_TOKEN_BUDGET } from './host-settings-types.js';
import { DEFAULT_COMMAND_REVIEW_LINE_MINUTES } from '../contracts/resource-caps.js';
import { DEFAULT_REPLY_DEADLINE_MINUTES, MAX_REPLY_DEADLINE_MINUTES } from '../contracts/mailbox.js';
import type { WorkspaceRemovalKindV1, WorkspaceRemovalViewV1 } from '../contracts/workspace-removal.js';

/** The published settings route set. `SettingsRoutes` stays the type truth. */
export const SETTINGS_ROUTE_SUFFIXES = [
  'snapshot', 'directories', 'models/save', 'models/select', 'workspaces/open', 'workspaces/access',
  'workspaces/withdraw', 'workspaces/remove', 'projects/forget', 'checks/approve', 'checks/withdraw',
  'automation/save',
  'resource-caps/save', 'run-budget/save', 'command-review/save', 'plan-loop-limits/save', 'prompts/packs/list', 'prompts/packs/create', 'prompts/templates/read',
  'prompts/templates/save', 'prompts/templates/restore', 'prompts/tools/read', 'prompts/tools/save',
  'knowledge-local', 'structural-approval/save',
  'reply-deadline/save',
] as const satisfies readonly SettingsRoute[];

export function isSettingsRoute(value: string): value is SettingsRoute {
  return (SETTINGS_ROUTE_SUFFIXES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Base URL contract. A snapshot echoes `baseUrl` back, so the value may never
// carry a secret: only an absolute http(s) URL without userinfo and without a
// credential-bearing query parameter is accepted. No host is contacted.
// ---------------------------------------------------------------------------

export type SettingsBaseUrlRejection = { code: 'invalid'; reason: string };

const CREDENTIAL_QUERY_NAMES = new Set([
  'api_key', 'apikey', 'api-key', 'key', 'token', 'access_token', 'accesstoken',
  'secret', 'client_secret', 'password', 'passwd', 'pwd', 'authorization', 'auth',
  'credential', 'credentials',
]);

export function validateSettingsBaseUrl(value: string): SettingsBaseUrlRejection | null {
  let url: URL;
  try { url = new URL(value); }
  catch { return { code: 'invalid', reason: 'baseUrl must be an absolute http(s) URL' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { code: 'invalid', reason: 'baseUrl must use http or https' };
  if (url.username !== '' || url.password !== '')
    return { code: 'invalid', reason: 'baseUrl must not carry URL userinfo' };
  for (const [name, parameterValue] of url.searchParams) {
    if (parameterValue.length > 0 && CREDENTIAL_QUERY_NAMES.has(name.toLowerCase()))
      return { code: 'invalid', reason: 'baseUrl must not carry a credential in its query string' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trusted types and the Host seam.
// ---------------------------------------------------------------------------

/** One trusted STARTUP model catalog entry. `secretEnvironmentVariable` is a
 * variable NAME only; the value is read lazily from the SecretSource. */
export type HostSettingsModelDefinition = {
  id: string;
  label: string;
  provider: SettingsProvider;
  model: string;
  baseUrl?: string;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  promptPack?: string;
  reasoningReplay?: ReasoningReplayV1;
  secretEnvironmentVariable?: string;
};

/** Private stored model. `apiKey` is NEVER part of an HTTP response. */
export type HostSettingsStoredModel = {
  id: string;
  label: string;
  provider: SettingsProvider;
  model: string;
  baseUrl?: string;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  promptPack?: string;
  reasoningReplay?: ReasoningReplayV1;
  secretEnvironmentVariable?: string;
  apiKey?: string;
};

/** `selection` maps `projectId` + NUL + `workspaceId` to a model id (or null).
 * The Host keeps its original bindings/grants and turns this into a new
 * immutable runtime version; it is never serialized to a response. */
export type HostSettingsPrivateSnapshot = {
  models: HostSettingsStoredModel[];
  selection: Readonly<Record<string, string | null>>;
  /** R6 cold-start: the persisted per-workspace user-approved checks together
   * with the SAVED Answer source they came from, the adoption child that wrote
   * them (`null` for a direct approval) and the monotonic save counter. It is a
   * projection of the real settings file, never model input. */
  checks: { scope: CoreScope; checks: RegisteredCommandCheck[];
    answerRef: QueryJobAnswerRef; answerDigest: string;
    child: { commandId: string; identityKey: string; fingerprint: string } | null;
    checksRevision: number }[];
  /** 121-136: the checks plans brought for a workspace with no approved answer list (its `checks` entry above already
   *  ends with them when it has one); the Host installs them after its own start-up checks of that workspace. R2：人撤过检查
   *  的工作区撤到一条不剩时也在这里出一份空配置，不退回“没有检查配置”。 */
  planOnlyChecks: { scope: CoreScope; checks: RegisteredCommandCheck[] }[];
  /** 每个工作区设置里的检查各从哪来（已批准清单、计划），按内容摘要；没有已批准清单的工作区，Host 再接上它启动配置的
   *  检查，交给平台写进没过的检查的输出（`checkOrigins`）。 */
  checkOrigins: { scope: CoreScope; origins: InstalledCheckOriginEntryV1[] }[];
  /** RC：每个工作区里人采用一份计划时装上的检查，带 id 和当前内容摘要；跳过 `planAdoption` 仍指向同一候选的待结条目
   *  （那一次采用还没提交，不能算“已采用”）。这是派生读，不是新记录。 */
  adoptedPlanChecks: { scope: CoreScope; checks: { checkId: string; digest: string }[] }[];
  /** RC L-2：每个工作区里计划来源的已装检查（不论当初是谁批准的），带 id 和当前内容摘要；规划提交按它判可替换。 */
  planSourceChecks: { scope: CoreScope; checks: { checkId: string; digest: string }[] }[];
  /** C8 automatic-rework policy as stored, or the defaults (3 / true) when the
   * file has none. The Host installs it from A.2 step 5.6 on; `automation/save`
   * (5.8) changes it at runtime. */
  automation: TaskAutomationPolicyV1;
  /** L13: the effective resource-cap values in bytes and task count. The Host
   * installs them into its holder from `resourceCaps/save`; they never enter the
   * runtime configuration version. */
  resourceCaps: { memoryMaxBytes: number; tasksMax: number };
  /** The effective Work Run token budget. The Host installs it from
   * `run-budget/save` and re-registers the trusted Workflow bindings; it never
   * enters the runtime configuration version, so a Run already claimed keeps
   * the budget it started with. */
  workRunTokenBudget: number;
  /** PL/§10.3: the effective plan-loop limits. The Host installs them from
   * `plan-loop-limits/save` and hands them to the shared deviation judgment, so
   * the next judgment uses the saved table while an already claimed Run keeps
   * the budget it started with. Every settings push carries them, and so does
   * the pre-settings seed snapshot (`host.ts`'s initial bindings). */
  planLoopLimits: PlanLoopLimitsV1;
  /** SHT-2 (121-112): the effective project review line in minutes. The Host installs it from
   *  `command-review/save`; the next heartbeat and the next read use it (a command already over the old line and
   *  noticed is not noticed again, and one not yet noticed is judged by the new line). */
  commandReviewLineMinutes: number;
  /** KLS-2: the checkouts, by repository key, whose architecture and notes stay local and out of
   *  git. The Host keeps the last copy pushed to it; the knowledge status and commit read it there. */
  knowledgeLocalOnly: Readonly<Record<RepoKey, true>>;
  /** 121-109: each project's saved structural auto-approval, by projectId; a project without one uses the factory
   *  default. The Host reads its last copy when a proposal freezes or a note is written. */
  structuralApproval: Readonly<Record<string, StructuralApprovalV1>>;
  /** Q20: each project's saved default reply deadline in minutes, by projectId; a project without one uses the
   *  factory default. The Host reads its last copy at each reply-asking send that names no deadline. */
  replyDeadlineMinutes: Readonly<Record<string, number>>;
};

/** Trusted facts about one Host-registered workspace, read from the Host. */
export type HostSettingsWorkspaceFacts = {
  scope: CoreScope;
  name: string;
  root: string;
  workspaceRevision: number;
  modelId: string | null;
  writeAllowed: boolean;
  commandsAllowed: boolean;
  accessFixed: SettingsAccessFixed | null;
  /** Where the workspace's project store lives (U8); null for a memory store or a project that is not open. */
  storeLocation: SettingsStoreLocation | null;
  /** KLS-2: the repository key of the workspace's checkout; null (or absent) for a folder in no git work tree. */
  knowledgeRepoKey?: RepoKey | null;
  /** Whether the workspace's root is still a directory; a missing folder is what `projects/forget` may remove. */
  folderPresent: boolean;
  /** G8B B4：这个工作区的项目本次打开了没有。库打不开的项目留着登记的范围，但没有运行时，本次进程里也不会再打开。 */
  projectOpen: boolean;
};

/** Host-owned result of opening (or finding) one directory. */
export type HostSettingsOpenedHost = { scope: CoreScope };

/** Host-owned registration/assembly surface the settings backend drives. It is
 * implemented in `host.ts` over the ONE platform/owner set.
 *
 * `openWorkspace` receives the shared DTO `OpenSettingsWorkspace` directly. On a
 * repeated canonical root + target project it answers `ready` with the SAME
 * scope; a different project never overwrites an existing root. */
export interface HostSettingsAssembly {
  listWorkspaces(): readonly HostSettingsWorkspaceFacts[];
  /** Read the exact saved Answer proposal. Absence means approval unsupported;
   * a missing source must never become a trusted check configuration. */
  readCheckProposal?(scope: CoreScope, answerRef: QueryJobAnswerRef): Promise<SettingsResponse<{
    answerRef: QueryJobAnswerRef; answerDigest: string; checks: RegisteredCommandCheck[];
  }>>;
  /** 121-136: read the checks one plan candidate brings, their digest and where its adoption stands: `adopted`
   *  (accepted, by whoever), `open` (still a candidate the owner may adopt) or `ended` (not adopted, refused, stale, or
   *  its Goal cancelled). Absence means installing them is unsupported. */
  readPlanCheckProposal?(scope: CoreScope, proposalRef: PlanProposalRef): Promise<SettingsResponse<{
    checksDigest: string; checks: RegisteredCommandCheck[]; adoption: 'adopted' | 'open' | 'ended';
  }>>;
  /** KLS-2: the checkout behind one registered workspace, through the Host's one line resolution: its repository key
   *  (the real common git directory) or `notGit`. Absence means the setting is unsupported. */
  knowledgeCheckout?(scope: CoreScope): Promise<SettingsResponse<{ repoKey: RepoKey } | { notGit: true }>>;
  /** 121-106: switch one registered workspace's write and command access in place; answers the two values it had.
   *  not_found: unregistered; unsupported: access fixed (the reason names which); unavailable: project store not open. */
  setWorkspaceAccess?(scope: CoreScope, access: { writeAllowed: boolean; commandsAllowed: boolean }):
    SettingsResponse<{ writeAllowed: boolean; commandsAllowed: boolean }>;
  /** 7D2 WD: withdraw a workspace that never entered the graph or remove one that did. The settings module passes
   *  the save that temporarily drops the descriptor and selection entry, persists and notifies; the assembly calls
   *  it after the core commit and unmounts only once it returned. Absence means unsupported. */
  removeWorkspace?(scope: CoreScope, kind: WorkspaceRemovalKindV1, save: () => Promise<void>):
    Promise<SettingsResponse<WorkspaceRemovalViewV1>>;
  /** R-M6: hide every registration of a project from `listWorkspaces`; open runtimes stay, a closed project's
   *  workspaces are unmounted. */
  forgetProject(projectId: string): void;
  openWorkspace(request: OpenSettingsWorkspace & { workspaceId?: string }): Promise<SettingsResponse<HostSettingsOpenedHost>>;
  bootstrap(): BootstrapResponse;
  /** Boolean-only probe: whether the trusted Host can resolve the named secret.
   * The value itself never crosses this seam and never enters a response. */
  secretConfigured(name: string): boolean;
  /** L13: the machine's current Kernel resource-cap status, read from the cache
   * WITHOUT probing. Absence is reported as `unknown`. */
  resourceCapStatus?(): ResourceCapCapability | { status: 'unknown' };
}

/** The narrow checks entry: the same argument the Host freezes for the checks stage. It stores the caller's child
 *  tuple and derives no identity of its own. */
type ApplyChecksForAdoption = (
  ctx: CoreCallContext,
  input: {
    scope: { projectId: string; workspaceId: string };
    source: ChecksConfigurationPinV1;
    child: { commandId: string; identityKey: string; fingerprint: string };
    previous: ChecksConfigurationPinV1 | null;
  },
) => Promise<ChecksSaveResultV1>;

/** The installed-configuration read; only the Host's callback may report a checks stage `installed`. */
type ConfirmInstalledChecks = (
  ctx: CoreCallContext,
  input: { scope: { projectId: string; workspaceId: string } },
) => Promise<ReadResult<ChecksConfirmationV1>>;

/** The saved-state read: the settings file's own facts, never the installed configuration. */
type ReadSavedChecks = (
  ctx: CoreCallContext,
  input: { scope: { projectId: string; workspaceId: string } },
) => Promise<ReadResult<StoredChecksStateV1>>;

/** The optional adoption callbacks: the Host's one configuration builder and the
 * installed-configuration confirmation. Absent means the adoption methods answer
 * `unsupported`; the saved-state read never reads the installed map. */
export type ChecksAdoptionHostCallbacks = {
  buildConfiguration(input: {
    scope: { projectId: string; workspaceId: string };
    /** `null` only for a workspace whose saved checks are only plans' (121-136). */
    source: ChecksSettingsSourceV1 | null;
    checks: readonly RegisteredCommandCheck[];
  }): TrustedCheckConfiguration;
  confirmInstalledChecks:
    ChecksConfirmationPort['confirmInstalledChecks'];
};

/** The one Host callback. It receives a validated private snapshot (key only
 * internal); the Host keeps its original bindings/grants and installs a NEW
 * immutable runtime version. */
export type HostSettingsCallbacks = {
  onConfigurationChanged(snapshot: HostSettingsPrivateSnapshot): void | Promise<void>;
  /** The optional adoption callbacks; absent means the adoption methods are `unsupported`. */
  adoption?: ChecksAdoptionHostCallbacks;
};

/** Trusted settings startup configuration. `settingsDirectory` is only an
 * override: the Host enables settings by default beside a SQLite ledger and
 * treats an in-memory store with no explicit persistent directory as
 * `unsupported`. The provider seam is Host-internal. */
export type HostSettingsConfig = {
  settingsDirectory?: string;
  /** The real `<settings directory>/prompts` the Host created at start-up; the
   * editing routes read and write exactly this tree. */
  promptsRoot?: string;
  models?: HostSettingsModelDefinition[];
  /** Trusted startup selection projected from the Host runtime configuration.
   * Used only when no private file exists yet; an explicit user selection later
   * overwrites it. */
  seedSelection?: Readonly<Record<string, string | null>>;
  /** V12: start-up workspaces to add to the project list after the restore, in one write; an entry already listed is
   *  skipped. The Host passes only those whose project opened and has its Project record. */
  declareWorkspaces?: readonly PersistedWorkspaceRef[];
  provider?: WorkbenchRuntimeProviderDependencies;
  now?: () => string;
};

export type HostSettingsOptions = HostSettingsConfig & { assembly: HostSettingsAssembly };

// ---------------------------------------------------------------------------
// Immutable resolver versioning.
// ---------------------------------------------------------------------------

/**
 * A Host-level delegate over one or more immutable `RuntimeHostBindings`
 * versions. The FIRST SUCCESSFUL (ready) `resolveConfiguration` /
 * `resolveQueryConfiguration` for a complete RunRef/QueryRunRef pins the version
 * current at that moment. A rejected resolution (for example no model or no key
 * yet) is NEVER pinned, so the same not-yet-prepared execution can retry after
 * the settings change. After a ready pin, a later settings change installs a new
 * version for new refs but never revokes or re-keys the pinned execution.
 */
export interface HostRuntimeResolverRegistry extends RuntimeHostBindings {
  install(bindings: RuntimeHostBindings): number;
}

export function createHostRuntimeResolverRegistry(initial: RuntimeHostBindings): HostRuntimeResolverRegistry {
  let current = initial;
  let version = 0;
  const workPins = new Map<string, RuntimeHostBindings>();
  const queryPins = new Map<string, RuntimeHostBindings>();
  const refKey = (ref: unknown): string => canonicalJson(ref as JsonValue);
  return {
    install(bindings: RuntimeHostBindings): number { current = bindings; version += 1; return version; },
    async resolveConfiguration(ctx: CoreCallContext, input: RuntimeConfigurationInput) {
      const key = refKey(input.runRef);
      const pinned = workPins.get(key);
      if (pinned !== undefined) return pinned.resolveConfiguration(ctx, input);
      const bindings = current;
      const result = await bindings.resolveConfiguration(ctx, input);
      if (result.status === 'ready') workPins.set(key, bindings);
      return result;
    },
    async resolveQueryConfiguration(ctx: CoreCallContext, input: QueryRuntimeConfigurationInput) {
      const key = refKey(input.queryRunRef);
      const pinned = queryPins.get(key);
      if (pinned !== undefined) {
        if (pinned.resolveQueryConfiguration === undefined) {
          return { status: 'rejected', code: 'unsupported', reason: 'the pinned Host has no Query configuration binding' };
        }
        return pinned.resolveQueryConfiguration(ctx, input);
      }
      const bindings = current;
      const resolveQuery = bindings.resolveQueryConfiguration;
      if (resolveQuery === undefined) {
        return { status: 'rejected', code: 'unsupported', reason: 'the Host has no Query configuration binding' };
      }
      const result = await resolveQuery(ctx, input);
      if (result.status === 'ready') queryPins.set(key, bindings);
      return result;
    },
    // R3 (L13/U5): no RunRef to pin; the capability always reads the current
    // settings version, exactly like a fresh Work Run's binding lookup.
    async readonlyCommandAccess(input) {
      return current.readonlyCommandAccess?.(input) ?? null;
    },
    // A-07: the no-Run pre-claim check has no RunRef to pin, so the same "current
    // settings version" rule applies. The current binding owns the capability; a
    // binding without it keeps the existing `unsupported` answer.
    async resolveRoleConfiguration(ctx, input) {
      const resolveRole = current.resolveRoleConfiguration;
      if (resolveRole === undefined) {
        return { status: 'rejected', code: 'unsupported', reason: 'the Host has no no-Run configuration binding' };
      }
      return resolveRole(ctx, input);
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence and HTTP-route implementation.
// ---------------------------------------------------------------------------

type PersistedWorkspaceV1 = {
  scope: CoreScope;
  name: string;
  root: string;
  writeAllowed: boolean;
  commandsAllowed: boolean;
  /** R6 cold-start: only an explicit Host-user approval writes this. */
  checks?: RegisteredCommandCheck[];
  /** The exact saved-Answer source the checks were approved from. */
  checksSource?: { answerRef: QueryJobAnswerRef; answerDigest: string };
  /** The adoption child that wrote `checks`/`checksSource`; absent (never null) for a direct Host approval. */
  checksChild?: { commandId: string; identityKey: string; fingerprint: string };
  /** The monotonic checks save counter; absent in old files and read as 0. */
  checksRevision?: number;
  /** 121-136: the checks plans brought, each with where it came from, who approved it and when; installed after
   *  `checks`. A whole-list approval (`checks/approve`, the initialization's checks stage) replaces them too. */
  planChecks?: PlanCheckEntryV1[];
  /** 121-136 A3: the plan a person's adoption installed checks for (in `planChecks`) and is not known adopted yet:
   *  written in the same save as those checks, removed once settled (`settlePlanAdoption`). */
  planAdoption?: CheckApprovalV1['plan'];
  /** G8B B2、R2：人撤回过的检查的留痕（来自计划写 `plan`，来自已批准清单写 `answer`），整批替换也留着；人采用的计划把同一个
   *  checkId 装回时去掉（`closePlanAdoption`）。 */
  withdrawnChecks?: WithdrawnCheckEntryV1[];
};
/** One check a plan brought, as the settings file keeps it. */
type PlanCheckEntryV1 = Omit<CheckApprovalV1, 'checkId'> & { check: RegisteredCommandCheck };
/** G8B B2：设置文件里的一条撤回留痕，id 取自检查本身。R2：来源二选一——计划（`plan`），或已批准清单的保存回答（`answer`）。 */
type WithdrawnCheckEntryV1 = { check: RegisteredCommandCheck; withdrawnAt: string }
  & ({ plan: CheckApprovalV1['plan']; answer?: undefined }
    | { answer: { answerRef: QueryJobAnswerRef; answerDigest: string }; plan?: undefined });
/** One listed workspace as the project list holds it: the Host's start-up manifest. */
export type PersistedWorkspaceRef = Pick<PersistedWorkspaceV1, 'scope' | 'name' | 'root' | 'writeAllowed' | 'commandsAllowed'>;
/** The saved-state read's two real outcomes: a saved entry or none at all. */
type SavedChecksState = { status: 'ready'; value: StoredChecksStateV1 } | { status: 'not_found' };
type PersistedSettingsV1 = {
  schemaVersion: 1;
  models: HostSettingsStoredModel[];
  selection: Record<string, string | null>;
  workspaces: PersistedWorkspaceV1[];
  /** C8 automatic-rework policy. Absent in files written before A.2; it stays
   * absent on the next save of another setting and reads as
   * `DEFAULT_TASK_AUTOMATION_POLICY` until `automation/save` stores one. */
  automation?: TaskAutomationPolicyV1;
  /** L13 Host setting `resourceCaps`. Absent in files written before RL and
   * stays absent on the next save of another setting. */
  resourceCaps?: ResourceCapSettingsV1;
  /** The Work Run token budget. Absent in old files and in a file whose value
   * was cleared; it stays absent on the next save of another setting and reads
   * as `DEFAULT_WORK_RUN_TOKEN_BUDGET`. */
  workRunTokenBudget?: number;
  /** PL/§10.3 Host setting `planLoopLimits`. Absent in files written before PL
   * and in a file whose value was cleared; it stays absent on the next save of
   * another setting and reads as `DEFAULT_PLAN_LOOP_LIMITS`. A present but
   * invalid table refuses Host startup instead of reading the defaults. */
  planLoopLimits?: PlanLoopLimitsV1;
  /** SHT-2 Host setting `commandReviewLineMinutes`. Absent in old files and in a file whose value was cleared; it
   *  stays absent on the next save of another setting and reads as `DEFAULT_COMMAND_REVIEW_LINE_MINUTES`. A present
   *  but invalid value refuses Host startup instead of reading the default. */
  commandReviewLineMinutes?: number;
  /** KLS-2: the checkouts whose knowledge stays local, by repository key (not per project and not in a workspace
   *  entry). Absent in old files and while no checkout has it; absent reads as the empty table. */
  knowledgeLocalOnly?: Record<RepoKey, true>;
  /** 121-109: each project's structural auto-approval, by projectId. Absent in old files and while no project has
   *  one; absent reads as the empty table. */
  structuralApproval?: Record<string, StructuralApprovalV1>;
  /** Q20: each project's default reply deadline in minutes, by projectId. Absent in old files and while no project has
   *  one; absent reads as the empty table. A present but invalid table refuses Host startup. */
  replyDeadlineMinutes?: Record<string, number>;
};

const scopeKey = (scope: CoreScope): string => `${scope.projectId}\u0000${scope.workspaceId}`;

function validScope(value: unknown): value is CoreScope {
  return isRecord(value) && nonEmpty(value['projectId']) && nonEmpty(value['workspaceId']);
}

function parseStoredChecks(value: unknown): RegisteredCommandCheck[] {
  if (!Array.isArray(value) || !value.every(isRegisteredCommandCheck)) {
    throw new Error('the private host settings file is invalid');
  }
  return value.map(check => structuredClone(check));
}

/** A plan as a stored check or a pending adoption names it: the candidate and its checks' digest. */
function validPlanRef(value: unknown): value is { proposalRef: PlanProposalRef; checksDigest: string } {
  return isRecord(value) && isRecord(value['proposalRef']) && value['proposalRef']['aggregateType'] === 'PlanProposal'
    && nonEmpty(value['proposalRef']['projectId']) && nonEmpty(value['proposalRef']['workspaceId'])
    && nonEmpty(value['proposalRef']['proposalId']) && nonEmpty(value['checksDigest']);
}

/** RC：人采用改同 id 检查定义的候选时随待结记录存下的旧条目；每条检查、来源、批准者、时间都要是存得下的形状。 */
function validReplacedPlanChecks(value: unknown): value is ReplacedPlanCheckV1[] {
  return Array.isArray(value) && value.every(entry => isRecord(entry)
    && isRegisteredCommandCheck(entry['check']) && validPlanRef(entry['plan']) && validApprovedBy(entry)
    && nonEmpty(entry['approvedAt']) && typeof entry['index'] === 'number'
    && Number.isSafeInteger(entry['index']) && entry['index'] >= 0);
}

/** A plan as a stored check or a pending adoption names it: the candidate, its checks' digest and, on a pending
 *  adoption, the old entries a person's replacement displaced. */
function validPlanSource(value: unknown): value is CheckApprovalV1['plan'] {
  if (!validPlanRef(value)) return false;
  const replaced = (value as { replaced?: unknown }).replaced;
  return replaced === undefined || validReplacedPlanChecks(replaced);
}

/** G8B B1f：批准者是人，或带职责、批准线和回答的 agent；agent 批的条目另带作者和改动前的事实。 */
function validApprovedBy(entry: Record<string, unknown>): boolean {
  const by = entry['approvedBy'];
  if (!isRecord(by)) return false;
  if (by['kind'] === 'person') return entry['author'] === undefined && entry['baseline'] === undefined;
  const session = by['session'];
  const author = entry['author'];
  return by['kind'] === 'agent' && (by['duty'] === 'adviser' || by['duty'] === 'reviewer')
    && isRecord(session) && nonEmpty(session['projectId']) && nonEmpty(session['sessionId']) && isRecord(by['answerRef'])
    && isRecord(author) && (author['duty'] === 'secretary' || author['duty'] === 'adviser')
    && checkBaselineProblem(entry['baseline']) === null;
}

function parseStoredPlanChecks(value: unknown): PlanCheckEntryV1[] {
  const valid = (entry: unknown): boolean => isRecord(entry) && isRegisteredCommandCheck(entry['check'])
    && validPlanSource(entry['plan']) && validApprovedBy(entry) && nonEmpty(entry['approvedAt']);
  if (!Array.isArray(value) || !value.every(valid)) throw new Error('the private host settings file is invalid');
  return structuredClone(value as PlanCheckEntryV1[]);
}

function parseStoredWithdrawnChecks(value: unknown): WithdrawnCheckEntryV1[] {
  const valid = (entry: unknown): boolean => isRecord(entry) && isRegisteredCommandCheck(entry['check'])
    && nonEmpty(entry['withdrawnAt'])
    && (entry['plan'] !== undefined
      ? entry['answer'] === undefined && validPlanSource(entry['plan'])
      : validChecksSource(entry['answer']));
  if (!Array.isArray(value) || !value.every(valid)) throw new Error('the private host settings file is invalid');
  return structuredClone(value as WithdrawnCheckEntryV1[]);
}

function parseStoredPlanAdoption(value: unknown): CheckApprovalV1['plan'] {
  if (!validPlanSource(value)) throw new Error('the private host settings file is invalid');
  return structuredClone(value);
}

/** The checks plans brought to one workspace, in install order. */
const savedPlanChecks = (entry: PersistedWorkspaceV1 | undefined): RegisteredCommandCheck[] =>
  (entry?.planChecks ?? []).map(planned => structuredClone(planned.check));

/** RC：每个工作区里计划来源的已装检查（带 id 和当前摘要），不管当初是谁批准的。 */
const planSourceChecksOf = (workspaces: readonly PersistedWorkspaceV1[]):
  { scope: CoreScope; checks: { checkId: string; digest: string }[] }[] =>
  workspaces.map(workspace => ({ scope: { ...workspace.scope },
      checks: (workspace.planChecks ?? []).map(planned => ({ checkId: planned.check.checkId,
        digest: checkDigestOf(planned.check) })) }));

/** RC：人采用一份计划装上、且那次采用已提交的检查；`planAdoption` 还指向同一候选时不算。 */
const adoptedPlanChecksOf = (workspaces: readonly PersistedWorkspaceV1[]):
  { scope: CoreScope; checks: { checkId: string; digest: string }[] }[] =>
  workspaces.map(workspace => ({ scope: { ...workspace.scope },
      checks: (workspace.planChecks ?? [])
        .filter(planned => planned.approvedBy.kind === 'person'
          && (workspace.planAdoption === undefined
            || !sameJson(planned.plan.proposalRef, workspace.planAdoption.proposalRef)))
        .map(planned => ({ checkId: planned.check.checkId, digest: checkDigestOf(planned.check) })) }));

/** 一个工作区设置里的检查各从哪来：先是已批准清单本身（不含后接的计划检查，绑着那次保存的回答），再是计划带来的每一条。 */
function savedCheckOrigins(entry: PersistedWorkspaceV1): InstalledCheckOriginEntryV1[] {
  const source = entry.checksSource;
  const listed = entry.checks === undefined || source === undefined ? [] : entry.checks.map(
    (check): InstalledCheckOriginEntryV1 => ({ checkDigest: checkDigestOf(check),
      origin: { kind: 'approved_list', answerRef: structuredClone(source.answerRef) } }));
  const planned = (entry.planChecks ?? []).map((planCheck): InstalledCheckOriginEntryV1 => ({
    checkDigest: checkDigestOf(planCheck.check), origin: { kind: 'plan', proposalRef: { ...planCheck.plan.proposalRef },
      approvedBy: planCheck.approvedBy.kind === 'person' ? 'person' : planCheck.approvedBy.duty } }));
  return [...listed, ...planned];
}

/** R2：一份保存回答的来源（引用和摘要）形状对不对；设置文件的 `checksSource` 和 R2 的撤回留痕共用。 */
function validChecksSource(value: unknown): value is { answerRef: QueryJobAnswerRef; answerDigest: string } {
  if (!isRecord(value) || !isRecord(value['answerRef']) || !nonEmpty(value['answerDigest'])) return false;
  const ref = value['answerRef'];
  return ref['aggregateType'] === 'QueryJobAnswer' && nonEmpty(ref['projectId']) && nonEmpty(ref['workspaceId'])
    && nonEmpty(ref['queryJobId']) && nonEmpty(ref['answerId']);
}

function parseStoredChecksSource(value: unknown): { answerRef: QueryJobAnswerRef; answerDigest: string } {
  if (!validChecksSource(value)) throw new Error('the private host settings file is invalid');
  const ref = value['answerRef'];
  return {
    answerRef: { aggregateType: 'QueryJobAnswer', projectId: ref['projectId'], workspaceId: ref['workspaceId'],
      queryJobId: ref['queryJobId'], answerId: ref['answerId'] },
    answerDigest: value['answerDigest'],
  };
}

/** The adoption checks child tuple: three non-empty strings, the fingerprint a sha256. */
function validChecksChild(value: unknown): value is {
  commandId: string; identityKey: string; fingerprint: string;
} {
  return isRecord(value) && nonEmpty(value['commandId']) && nonEmpty(value['identityKey'])
    && isSha256Hex(value['fingerprint']);
}

function parseStoredChecksChild(value: unknown): { commandId: string; identityKey: string; fingerprint: string } {
  if (!validChecksChild(value)) throw new Error('the private host settings file is invalid');
  return { commandId: value.commandId, identityKey: value.identityKey, fingerprint: value.fingerprint };
}

const parseStoredChecksRevision = (value: unknown): number => {
  if (!isNonNeg(value)) throw new Error('the private host settings file is invalid');
  return value;
};

/**
 * A complete frozen configuration pin. `configurationRevision`/`contentDigest`
 * are nullable because the pin also names the static fallback and the absence of
 * a configuration; the settings backend never recomputes either.
 */
function validChecksPin(value: unknown): value is ChecksConfigurationPinV1 {
  return checksConfigurationPinProblem(value) === null;
}

function parseStoredAutomation(value: unknown): TaskAutomationPolicyV1 {
  if (!isRecord(value) || value['schemaVersion'] !== 1
    || !(RESUME_ON_STARTUP_MODES as readonly unknown[]).includes(value['resumeOnStartup'])) {
    throw new Error('the private host settings file is invalid');
  }
  const limit = value['autoReworkLimit'];
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || limit > MAX_AUTO_REWORK_LIMIT) {
    throw new Error('the private host settings file is invalid');
  }
  return { schemaVersion: 1, autoReworkLimit: limit, resumeOnStartup: value['resumeOnStartup'] as ResumeOnStartupMode };
}

/** SF-2 / L13: a stored `resourceCaps` must be a schema-1 object with `null` or a
 * value in the valid range in each field (`memoryMaxMiB` a whole MiB floor of the
 * safe-integer space at least `RESOURCE_CAP_MIN_MEMORY_MIB`, `tasksMax` in
 * `RESOURCE_CAP_MIN_TASKS..RESOURCE_CAP_MAX_TASKS`). A stored value above this
 * machine's memory is kept as stored (a machine change is not an error); an
 * out-of-range value fails Host start-up instead of silently reading defaults. */
function parseStoredResourceCaps(value: unknown): ResourceCapSettingsV1 {
  if (!isRecord(value) || value['schemaVersion'] !== 1) {
    throw new Error('the private host settings file is invalid');
  }
  const memoryMaxMiB = value['memoryMaxMiB'];
  const tasksMax = value['tasksMax'];
  const memoryCeilingMiB = Math.floor(Number.MAX_SAFE_INTEGER / MIB);
  if (memoryMaxMiB !== null && (typeof memoryMaxMiB !== 'number' || !Number.isSafeInteger(memoryMaxMiB)
    || memoryMaxMiB < RESOURCE_CAP_MIN_MEMORY_MIB || memoryMaxMiB > memoryCeilingMiB)) {
    throw new Error('the private host settings file is invalid');
  }
  if (tasksMax !== null && (typeof tasksMax !== 'number' || !Number.isSafeInteger(tasksMax)
    || tasksMax < RESOURCE_CAP_MIN_TASKS || tasksMax > RESOURCE_CAP_MAX_TASKS)) {
    throw new Error('the private host settings file is invalid');
  }
  return { schemaVersion: 1, memoryMaxMiB, tasksMax };
}

/** The stored Work Run token budget is one integer 1..`MAX_WORK_RUN_TOKEN_BUDGET`;
 * an absent field is the default, exactly like `resourceCaps`. A present value
 * outside that range fails Host start-up with the existing invalid-file wording. */
function parseStoredWorkRunTokenBudget(value: unknown): number {
  if (!isPos(value) || value > MAX_WORK_RUN_TOKEN_BUDGET) {
    throw new Error('the private host settings file is invalid');
  }
  return value;
}

/** SHT-2: the stored project review line is one positive safe integer of minutes, with no upper bound; an absent
 *  field is the default. A present but invalid value fails Host start-up, exactly like `resourceCaps`. */
function parseStoredCommandReviewLineMinutes(value: unknown): number {
  if (!isPos(value)) throw new Error('the private host settings file is invalid');
  return value;
}

/**
 * PL/§10.3: one `planLoopLimits` table is schema 1 with both complete four-tier
 * tables (exactly the `TaskSizeClassV1` keys the default table names), every
 * value a positive safe integer, each tier's two-times line at or above its
 * reminder line, and a line multiplier of at least 1. Anything else is refused
 * as it stands: it is never filled from the defaults, and a stored value is
 * never migrated.
 */
function planLoopLimitsOf(value: unknown): PlanLoopLimitsV1 | null {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return null;
  const sizeClasses = Object.keys(DEFAULT_PLAN_LOOP_LIMITS.taskReminderTokens) as TaskSizeClassV1[];
  const reminder = value['taskReminderTokens'];
  const twoTimes = value['taskTwoTimesTokens'];
  if (!isRecord(reminder) || !isRecord(twoTimes)
    || !hasOnlyKeys(reminder, sizeClasses) || !hasOnlyKeys(twoTimes, sizeClasses)) return null;
  const taskReminderTokens = {} as Record<TaskSizeClassV1, number>;
  const taskTwoTimesTokens = {} as Record<TaskSizeClassV1, number>;
  for (const sizeClass of sizeClasses) {
    const reminderLine = reminder[sizeClass];
    const twoTimesLine = twoTimes[sizeClass];
    if (!isPos(reminderLine) || !isPos(twoTimesLine) || twoTimesLine < reminderLine) return null;
    taskReminderTokens[sizeClass] = reminderLine;
    taskTwoTimesTokens[sizeClass] = twoTimesLine;
  }
  const { lineMultiplier, stageLineBudget, stageTokenBudget } = value;
  if (!isPos(lineMultiplier) || !isPos(stageLineBudget) || !isPos(stageTokenBudget)) return null;
  return { schemaVersion: 1, taskReminderTokens, taskTwoTimesTokens, lineMultiplier, stageLineBudget, stageTokenBudget };
}

/** A stored table must be valid; a present but invalid one fails Host start-up. */
function parseStoredPlanLoopLimits(value: unknown): PlanLoopLimitsV1 {
  const limits = planLoopLimitsOf(value);
  if (limits === null) throw new Error('the private host settings file is invalid');
  return limits;
}

/** KLS-2: a present table maps each repository key to `true`; anything else fails Host start-up. */
function parseStoredKnowledgeLocalOnly(value: unknown): Record<RepoKey, true> {
  if (!isRecord(value) || !Object.entries(value).every(([key, entry]) => key.length > 0 && entry === true))
    throw new Error('the private host settings file is invalid');
  return { ...value } as Record<RepoKey, true>;
}

/** 121-109: a present table maps each projectId to both switches; anything else fails Host start-up. */
function parseStoredStructuralApproval(value: unknown): Record<string, StructuralApprovalV1> {
  if (!isRecord(value)) throw new Error('the private host settings file is invalid');
  const table: Record<string, StructuralApprovalV1> = {};
  for (const [projectId, entry] of Object.entries(value)) {
    const modes = structuralApprovalOf(entry);
    if (projectId.length === 0 || modes === null) throw new Error('the private host settings file is invalid');
    table[projectId] = modes;
  }
  return table;
}

/** Q20: a saved default reply deadline is a positive safe integer of minutes, at most one year. */
function isReplyDeadlineMinutes(value: unknown): value is number {
  return isPos(value) && value <= MAX_REPLY_DEADLINE_MINUTES;
}

/** Q20: a present table maps each projectId to its minutes; anything else fails Host start-up. */
function parseStoredReplyDeadlineMinutes(value: unknown): Record<string, number> {
  if (!isRecord(value)
    || !Object.entries(value).every(([projectId, minutes]) => projectId.length > 0 && isReplyDeadlineMinutes(minutes)))
    throw new Error('the private host settings file is invalid');
  return { ...value } as Record<string, number>;
}

/** The published/saved tables never share a mutable object with the defaults. */
const copyPlanLoopLimits = (limits: Readonly<PlanLoopLimitsV1>): PlanLoopLimitsV1 => ({
  ...limits,
  taskReminderTokens: { ...limits.taskReminderTokens },
  taskTwoTimesTokens: { ...limits.taskTwoTimesTokens },
});

type SettingsRejection = Extract<SettingsResponse<never>, { status: 'rejected' }>;
const invalid = (reason: string): SettingsRejection => ({ status: 'rejected', code: 'invalid', reason });
const notFound = (reason: string): SettingsRejection => ({ status: 'rejected', code: 'not_found', reason });
const unavailable = (reason: string): SettingsRejection => ({ status: 'rejected', code: 'unavailable', reason });

function parseStoredModel(value: unknown): HostSettingsStoredModel {
  if (!isRecord(value) || !nonEmpty(value['id']) || !nonEmpty(value['label'])
    || (value['provider'] !== 'deepseek' && value['provider'] !== 'openai') || !nonEmpty(value['model']))
    throw new Error('the private host settings file is invalid');
  if (value['baseUrl'] !== undefined) {
    if (typeof value['baseUrl'] !== 'string' || validateSettingsBaseUrl(value['baseUrl']) !== null)
      throw new Error('the private host settings file is invalid');
  }
  if (value['promptPack'] !== undefined && !isPromptPackId(value['promptPack']))
    throw new Error('the private host settings file is invalid');
  if (value['reasoningReplay'] !== undefined && !isReasoningReplayV1(value['reasoningReplay']))
    throw new Error('the private host settings file is invalid');
  return {
    id: value['id'], label: value['label'], provider: value['provider'], model: value['model'],
    ...(value['baseUrl'] === undefined ? {} : { baseUrl: value['baseUrl'] }),
    ...(value['thinking'] === 'enabled' || value['thinking'] === 'disabled' ? { thinking: value['thinking'] } : {}),
    ...(value['reasoningEffort'] === 'low' || value['reasoningEffort'] === 'high' || value['reasoningEffort'] === 'max'
      ? { reasoningEffort: value['reasoningEffort'] } : {}),
    ...(value['promptPack'] === undefined ? {} : { promptPack: value['promptPack'] }),
    ...(value['reasoningReplay'] === undefined ? {} : { reasoningReplay: value['reasoningReplay'] }),
    ...(nonEmpty(value['secretEnvironmentVariable']) ? { secretEnvironmentVariable: value['secretEnvironmentVariable'] } : {}),
    ...(typeof value['apiKey'] === 'string' && value['apiKey'].length > 0 ? { apiKey: value['apiKey'] } : {}),
  };
}

function parsePersisted(text: string): PersistedSettingsV1 {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error('the private host settings file is invalid'); }
  if (!isRecord(raw) || raw['schemaVersion'] !== 1 || !Array.isArray(raw['models'])
    || !isRecord(raw['selection']) || !Array.isArray(raw['workspaces']))
    throw new Error('the private host settings file is invalid');
  const models = (raw['models'] as unknown[]).map(parseStoredModel);
  const selection: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw['selection'] as Record<string, unknown>)) {
    if (value !== null && typeof value !== 'string') throw new Error('the private host settings file is invalid');
    selection[key] = value;
  }
  const workspaces = (raw['workspaces'] as unknown[]).map(entry => {
    if (!isRecord(entry) || !validScope(entry['scope']) || !nonEmpty(entry['name']) || !nonEmpty(entry['root'])
      || typeof entry['writeAllowed'] !== 'boolean' || typeof entry['commandsAllowed'] !== 'boolean')
      throw new Error('the private host settings file is invalid');
    return {
      scope: { projectId: entry['scope'].projectId, workspaceId: entry['scope'].workspaceId },
      name: entry['name'], root: entry['root'],
      writeAllowed: entry['writeAllowed'], commandsAllowed: entry['commandsAllowed'],
      ...(entry['checks'] === undefined ? {} : { checks: parseStoredChecks(entry['checks']) }),
      ...(entry['checksSource'] === undefined ? {} : { checksSource: parseStoredChecksSource(entry['checksSource']) }),
      ...(entry['checksChild'] === undefined ? {} : { checksChild: parseStoredChecksChild(entry['checksChild']) }),
      ...(entry['checksRevision'] === undefined
        ? {} : { checksRevision: parseStoredChecksRevision(entry['checksRevision']) }),
      ...(entry['planChecks'] === undefined ? {} : { planChecks: parseStoredPlanChecks(entry['planChecks']) }),
      ...(entry['planAdoption'] === undefined ? {} : { planAdoption: parseStoredPlanAdoption(entry['planAdoption']) }),
      ...(entry['withdrawnChecks'] === undefined
        ? {} : { withdrawnChecks: parseStoredWithdrawnChecks(entry['withdrawnChecks']) }),
    };
  });
  return { schemaVersion: 1, models, selection, workspaces,
    ...(raw['automation'] === undefined ? {} : { automation: parseStoredAutomation(raw['automation']) }),
    ...(raw['resourceCaps'] === undefined ? {} : { resourceCaps: parseStoredResourceCaps(raw['resourceCaps']) }),
    ...(raw['workRunTokenBudget'] === undefined
      ? {} : { workRunTokenBudget: parseStoredWorkRunTokenBudget(raw['workRunTokenBudget']) }),
    ...(raw['planLoopLimits'] === undefined
      ? {} : { planLoopLimits: parseStoredPlanLoopLimits(raw['planLoopLimits']) }),
    ...(raw['commandReviewLineMinutes'] === undefined
      ? {} : { commandReviewLineMinutes: parseStoredCommandReviewLineMinutes(raw['commandReviewLineMinutes']) }),
    ...(raw['knowledgeLocalOnly'] === undefined
      ? {} : { knowledgeLocalOnly: parseStoredKnowledgeLocalOnly(raw['knowledgeLocalOnly']) }),
    ...(raw['structuralApproval'] === undefined
      ? {} : { structuralApproval: parseStoredStructuralApproval(raw['structuralApproval']) }),
    ...(raw['replyDeadlineMinutes'] === undefined
      ? {} : { replyDeadlineMinutes: parseStoredReplyDeadlineMinutes(raw['replyDeadlineMinutes']) }) };
}

/** The settings file of one directory: null when it does not exist. A present but unreadable or corrupt file is an
 *  explicit startup failure, never silently treated as an empty configuration. */
async function readPersistedSettings(settingsDirectory: string): Promise<PersistedSettingsV1 | null> {
  try {
    return parsePersisted(await readFile(join(settingsDirectory, 'host-settings.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('the private host settings file could not be loaded');
  }
}

/** The Host's start-up project list: the listed workspaces in file order, `[]` when there is no file. */
export async function readPersistedWorkspaces(settingsDirectory: string): Promise<PersistedWorkspaceRef[]> {
  const persisted = await readPersistedSettings(settingsDirectory);
  return (persisted?.workspaces ?? []).map(entry => ({ scope: { ...entry.scope }, name: entry.name, root: entry.root,
    writeAllowed: entry.writeAllowed, commandsAllowed: entry.commandsAllowed }));
}

function toStoredModel(model: HostSettingsModelDefinition): HostSettingsStoredModel {
  if (model.baseUrl !== undefined && validateSettingsBaseUrl(model.baseUrl) !== null)
    throw new Error('a trusted startup settings model has an invalid baseUrl');
  return {
    id: model.id, label: model.label, provider: model.provider, model: model.model,
    ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
    ...(model.thinking === undefined ? {} : { thinking: model.thinking }),
    ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
    ...(model.promptPack === undefined ? {} : { promptPack: model.promptPack }),
    ...(model.reasoningReplay === undefined ? {} : { reasoningReplay: model.reasoningReplay }),
    ...(model.secretEnvironmentVariable === undefined ? {} : { secretEnvironmentVariable: model.secretEnvironmentVariable }),
  };
}

export const WORKSPACE_REMOVED_REASON = 'the workspace was removed';

/**
 * 2.5a A13: the Host's optional judgement of the candidate version an automatic adoption is bound to. The settings
 * queue calls it before installing the candidate's checks and again before the adoption; `null` passes, a rejection
 * stops the adoption with the owner's retriable answer (`settlePlanAdoption` rolls back after an install).
 */
export type PlanAdoptionJudgeV1 = () => Promise<CoreRejection | null>;

/** The checks entry with that optional judgement beside the existing adopt/replay pair (the port itself is unchanged). */
export type ChecksAdoptionEntryPortWithJudge = Omit<ChecksAdoptionEntryPort, 'adoptWithPlanChecks'> & {
  adoptWithPlanChecks<T>(ctx: CoreCallContext,
    input: { scope: CoreScope; proposalRef: PlanProposalRef; checks: readonly RegisteredCommandCheck[];
      approval: CheckApproverV1 },
    adopt: { replay: () => Promise<WriteResult<T> | { status: 'not_found' }>; apply: () => Promise<WriteResult<T>> },
    judge?: PlanAdoptionJudgeV1): Promise<WriteResult<T>>;
};

export async function createHostSettings(
  options: HostSettingsOptions,
  callbacks: HostSettingsCallbacks,
): Promise<HostSettingsPort & ChecksAdoptionEntryPortWithJudge> {
  const settingsDirectory = options.settingsDirectory;
  if (!nonEmpty(settingsDirectory)) throw new Error('host settings require an explicit persistent directory');
  const assembly = options.assembly;
  const filePath = join(settingsDirectory, 'host-settings.json');
  const promptsRoot = options.promptsRoot ?? join(settingsDirectory, 'prompts');
  const now = options.now ?? (() => new Date().toISOString());

  const persisted: PersistedSettingsV1 = await readPersistedSettings(settingsDirectory) ?? {
    schemaVersion: 1,
    models: (options.models ?? []).map(toStoredModel),
    selection: { ...(options.seedSelection ?? {}) },
    workspaces: [],
  };

  const models: HostSettingsStoredModel[] = persisted.models;
  const selection: Record<string, string | null> = persisted.selection;
  const workspaces: PersistedWorkspaceV1[] = persisted.workspaces;
  /**
   * R-M6: the descriptions a `projects/forget` hid while the project's runtime stayed open. They are not part of the
   * registration list written to the file, but they keep feeding this Host's runtime configuration (checks and
   * plan adoptions) until the project is reopened (then `listDescriptor` takes the entry back) or this Host ends.
   * A project that is already closed drops its descriptions instead.
   */
  const hiddenWorkspaceDescriptions: PersistedWorkspaceV1[] = [];
  /** Kept exactly as stored (absent stays absent) until `automation/save` writes it. */
  let automation: TaskAutomationPolicyV1 | undefined = persisted.automation;
  /** L13: kept exactly as stored (absent stays absent) until `resource-caps/save`. */
  let resourceCapSetting: ResourceCapSettingsV1 | undefined = persisted.resourceCaps;
  /** The Work Run token budget as stored (absent is the default) until
   * `run-budget/save` writes it; `null` on that route clears it again. */
  let workRunTokenBudget: number | undefined = persisted.workRunTokenBudget;
  /** PL/§10.3: the plan-loop limits as stored (absent is the defaults) until
   * `plan-loop-limits/save` writes them; `null` on that route clears them. */
  let planLoopLimitSetting: PlanLoopLimitsV1 | undefined = persisted.planLoopLimits;
  /** SHT-2: the project review line as stored (absent is the default) until `command-review/save` writes it; `null`
   *  on that route clears it again. */
  let commandReviewLineSetting: number | undefined = persisted.commandReviewLineMinutes;
  /** KLS-2: the checkouts whose knowledge stays local, by repository key; `knowledge-local` changes it. */
  const knowledgeLocalOnly: Record<RepoKey, true> = { ...persisted.knowledgeLocalOnly };
  /** 121-109: each project's structural auto-approval, by projectId; `structural-approval/save` changes it. */
  const structuralApproval: Record<string, StructuralApprovalV1> = { ...persisted.structuralApproval };
  /** Q20: each project's default reply deadline in minutes, by projectId; `reply-deadline/save` changes it. The
   *  null-prototype table makes any projectId (including `__proto__`) an ordinary own key. */
  const replyDeadlineMinutes: Record<string, number> =
    Object.assign(Object.create(null) as Record<string, number>, persisted.replyDeadlineMinutes);
  const effectiveWorkRunTokenBudget = (): number => workRunTokenBudget ?? DEFAULT_WORK_RUN_TOKEN_BUDGET;
  const effectivePlanLoopLimits = (): Readonly<PlanLoopLimitsV1> =>
    planLoopLimitSetting ?? DEFAULT_PLAN_LOOP_LIMITS;
  const effectiveCommandReviewLine = (): number =>
    commandReviewLineSetting ?? DEFAULT_COMMAND_REVIEW_LINE_MINUTES;
  const totalMemoryBytes = totalmem();
  const capDefaults = defaultResourceCapSettings(totalMemoryBytes);
  const memoryUpperMiB = Math.floor(totalMemoryBytes / MIB);
  const effectiveResourceCaps = (): { memoryMaxMiB: number; tasksMax: number } => ({
    memoryMaxMiB: resourceCapSetting?.memoryMaxMiB ?? capDefaults.memoryMaxMiB,
    tasksMax: resourceCapSetting?.tasksMax ?? capDefaults.tasksMax,
  });
  const resourceCapStatusOf = (): SettingsResourceCaps['machine'] => {
    let status: ResourceCapCapability | { status: 'unknown' };
    try { status = assembly.resourceCapStatus?.() ?? { status: 'unknown' }; }
    catch { return { status: 'unknown' }; }
    if (status.status === 'available') return { status: 'available' };
    if (status.status === 'unavailable') {
      const reason = status.reason as ResourceCapUnavailableReasonV1;
      return { status: 'unavailable', reason, text: RESOURCE_CAP_NONE_TEXT[reason] };
    }
    return { status: 'unknown' };
  };

  const privateSnapshot = (): HostSettingsPrivateSnapshot => {
    // R-M6: a project forgotten while its runtime stays open keeps its descriptions (and their checks) here, so this
    // Host's installed check configuration survives the notify that follows the forget.
    const all = [...workspaces, ...hiddenWorkspaceDescriptions];
    return {
      models: structuredClone(models),
      selection: { ...selection },
      checks: all
        .filter((workspace): workspace is PersistedWorkspaceV1 & { checks: RegisteredCommandCheck[];
          checksSource: { answerRef: QueryJobAnswerRef; answerDigest: string } } =>
          workspace.checks !== undefined && workspace.checksSource !== undefined)
        .map(workspace => ({ scope: { ...workspace.scope }, checks: [...structuredClone(workspace.checks), ...savedPlanChecks(workspace)],
          answerRef: structuredClone(workspace.checksSource.answerRef), answerDigest: workspace.checksSource.answerDigest,
          child: workspace.checksChild === undefined ? null : { ...workspace.checksChild },
          checksRevision: workspace.checksRevision ?? 0 })),
      // R2（121-144 的待办）：人撤过检查的工作区不退回“没有检查配置”。撤到一条不剩时 Host 装一份空配置（已批准的空清单同一个做法，
      // `host.ts:2178-2179`），检查轮照开，没检查覆盖的必需要求读作缺项，人看得见。
      planOnlyChecks: all
        .filter(workspace => workspace.checksSource === undefined
          && (savedPlanChecks(workspace).length > 0 || workspace.withdrawnChecks !== undefined))
        .map(workspace => ({ scope: { ...workspace.scope }, checks: savedPlanChecks(workspace) })),
      checkOrigins: all.map(workspace => ({ scope: { ...workspace.scope }, origins: savedCheckOrigins(workspace) })),
      // RC：人采用一份计划装上的检查才算“已采用”，而且那一次采用要已提交：`planAdoption` 还指着同一个候选时，条目只是装上了、
      // 还没结清，不能报给平台。
      adoptedPlanChecks: adoptedPlanChecksOf(all),
      planSourceChecks: planSourceChecksOf(all),
      automation: { ...(automation ?? DEFAULT_TASK_AUTOMATION_POLICY) },
      resourceCaps: {
        memoryMaxBytes: effectiveResourceCaps().memoryMaxMiB * MIB,
        tasksMax: effectiveResourceCaps().tasksMax,
      },
      workRunTokenBudget: effectiveWorkRunTokenBudget(),
      planLoopLimits: copyPlanLoopLimits(effectivePlanLoopLimits()),
      commandReviewLineMinutes: effectiveCommandReviewLine(),
      knowledgeLocalOnly: { ...knowledgeLocalOnly },
      structuralApproval: structuredClone(structuralApproval),
      replyDeadlineMinutes: { ...replyDeadlineMinutes },
    };
  };

  const persist = async (): Promise<void> => {
    const payload: PersistedSettingsV1 = { schemaVersion: 1, models, selection, workspaces,
      ...(automation === undefined ? {} : { automation }),
      ...(resourceCapSetting === undefined ? {} : { resourceCaps: resourceCapSetting }),
      ...(workRunTokenBudget === undefined ? {} : { workRunTokenBudget }),
      ...(planLoopLimitSetting === undefined ? {} : { planLoopLimits: planLoopLimitSetting }),
      ...(commandReviewLineSetting === undefined ? {} : { commandReviewLineMinutes: commandReviewLineSetting }),
      ...(Object.keys(knowledgeLocalOnly).length === 0 ? {} : { knowledgeLocalOnly }),
      ...(Object.keys(structuralApproval).length === 0 ? {} : { structuralApproval }),
      ...(Object.keys(replyDeadlineMinutes).length === 0 ? {} : { replyDeadlineMinutes }) };
    await mkdir(settingsDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(settingsDirectory, `.host-settings.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, JSON.stringify(payload), { mode: 0o600 });
    await rename(temporaryPath, filePath);
  };

  const notify = async (): Promise<void> => { await callbacks.onConfigurationChanged(privateSnapshot()); };

  /** Everything a settings call touches (shared arrays, selection, the file)
   * runs through ONE promise queue, so concurrent requests cannot interleave a
   * mutation with an await and roll back each other. It is a Host-local
   * operation gate, never a workspace writer or a second store/CAS. */
  let dispatchQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = dispatchQueue.then(operation, operation);
    dispatchQueue = run.then(() => undefined, () => undefined);
    return run;
  };

  /** Closes a settled plan adoption; a close that cannot be written stays in the file only and settles the same way.
   *  G8B B2：采用上了的计划还带着它装的检查，其中人撤回过的，留痕一起去掉（agent 批准装不回撤回过的，只能是人采用）；
   *  没采用上的，检查已经收回，留痕不动。RC：关掉待结记录后要再推一次快照，否则 Host 的 `adoptedPlanChecks`
   *  读到的还是“采用未提交”的上一版（那版按待结记录滤掉了新条目）。这次推送只刷新内存快照，失败不改已提交的采用；
   *  下一次设置推送或 Host 启动会重读。 */
  const closePlanAdoption = async (scope: CoreScope): Promise<void> => {
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    const entry = workspaces[index];
    if (entry?.planAdoption === undefined) return;
    const { planAdoption: settled, withdrawnChecks, ...closed } = entry;
    const back = new Set((entry.planChecks ?? []).filter(planned => sameJson(planned.plan.proposalRef, settled.proposalRef))
      .map(planned => planned.check.checkId));
    const still = (withdrawnChecks ?? []).filter(withdrawn => !back.has(withdrawn.check.checkId));
    workspaces[index] = still.length === 0 ? closed : { ...closed, withdrawnChecks: still };
    // RC R-1：采用提交后的顺序是先发布已结清的采用事实（`notify` 同步换掉 Host 的派生读），再落盘关记录；
    // 这样提交引出的 Goal 唤醒（下一个事件循环排空）一定读到新的 `adoptedPlanChecks`，不会继续等旧的
    // `system_requeue` 卡。落盘失败只留记录，下一次设置推送或 Host 启动照旧重读。
    await notify().catch(() => undefined);
    await persist().catch(() => undefined);
  };

  /**
   * 121-136 A3: settles one workspace's pending plan adoption, if any, inside the settings queue every adoption entry
   * takes (the Host runs the platform's own adoptions in it too). The candidate's own record, read here, answers
   * whether it was adopted (`accepted` is written in the adoption's commit, whoever adopted it). Adopted keeps the
   * checks. Not adopted first takes this plan's checks back out of the saved configuration (a person's replacements put
   * the displaced entries back) and, with `install`, out of the Host's (a workspace left with no saved checks goes back
   * to its start-up checks, or none; R2：人撤过检查的工作区装空配置,
   * `planOnlyChecks`); the start passes
   * `false` and installs once, after every record settled. Either way the record then closes. A candidate that cannot
   * be read, or a take-back that cannot be saved or installed, stays pending and answers why; `null`: nothing pending.
   */
  const settlePlanAdoption = async (scope: CoreScope, install: boolean):
    Promise<ReturnType<typeof rejected<'unavailable'>> | null> => {
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    const entry = workspaces[index];
    const pending = entry?.planAdoption;
    if (entry === undefined || pending === undefined) return null;
    const stillPending = (reason: string) => rejected('unavailable', `the adoption of plan candidate `
      + `${pending.proposalRef.proposalId}, which installed its checks, is still pending: ${reason}; it settles at the `
      + 'next adoption in this workspace or the next Host start');
    let read;
    try { read = await assembly.readPlanCheckProposal?.(scope, pending.proposalRef); }
    catch { read = undefined; }
    if (read?.status !== 'ready') return stillPending('the plan candidate could not be read');
    if (read.value.adoption !== 'adopted') {
      const displaced = pending.replaced ?? [];
      const displacedIds = new Set(displaced.map(old => old.check.checkId));
      // RC L-4：先去掉本候选的新条目和已经回填过的 displaced 编号（中途停机后重跑会看到上一次回填的旧条目），
      // 再按原位置回填一遍。清单和配置版本因此可重复。
      const kept = (entry.planChecks ?? []).filter(planned =>
        !sameJson(planned.plan.proposalRef, pending.proposalRef) && !displacedIds.has(planned.check.checkId));
      for (const old of [...displaced].sort((left, right) => left.index - right.index)) {
        const { index, ...oldEntry } = old;
        kept.splice(Math.min(index, kept.length), 0, structuredClone(oldEntry));
      }
      const { planChecks: _taken, ...rest } = entry;
      workspaces[index] = kept.length === 0 ? rest : { ...rest, planChecks: kept };
      try { await persist(); }
      catch {
        workspaces[index] = entry;
        return stillPending('taking its checks back could not be written to the settings file');
      }
      if (install) {
        try { await notify(); }
        catch { return stillPending('the Host did not confirm the configuration without its checks'); }
      }
    }
    await closePlanAdoption(scope);
    return null;
  };

  /**
   * The saved checks state of one scope, read from the parsed settings map only.
   * A workspace with no saved checks is `not_found`; a direct approval's child is
   * `null`; an old file's absent counter reads as 0. It never reads the installed
   * configuration (only `confirmInstalledChecks` does, through the Host callback).
   */
  const savedChecksOf = (scope: CoreScope): SavedChecksState => {
    const entry = workspaces.find(workspace => scopeKey(workspace.scope) === scopeKey(scope));
    if (entry === undefined || entry.checks === undefined || entry.checksSource === undefined)
      return { status: 'not_found' };
    return { status: 'ready', value: {
      source: { answerRef: structuredClone(entry.checksSource.answerRef), answerDigest: entry.checksSource.answerDigest },
      checks: structuredClone(entry.checks),
      checksRevision: entry.checksRevision ?? 0,
      child: entry.checksChild === undefined ? null : { ...entry.checksChild },
    } };
  };

  /**
   * R-M6: one scope keeps one description. The visible entry is the one in the file; the hidden copy is the
   * description `projects/forget` kept for a still-open runtime until this scope is written again.
   */
  const savedDescriptorOf = (scope: CoreScope): PersistedWorkspaceV1 | undefined => {
    const key = scopeKey(scope);
    return workspaces.find(entry => scopeKey(entry.scope) === key)
      ?? hiddenWorkspaceDescriptions.find(entry => scopeKey(entry.scope) === key);
  };

  /** R-M6: a visible save takes the scope's hidden copy with it; the returned undo puts it back at its old place. */
  const takeHiddenDescriptor = (scope: CoreScope): (() => void) => {
    const index = hiddenWorkspaceDescriptions.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    if (index < 0) return () => undefined;
    const [entry] = hiddenWorkspaceDescriptions.splice(index, 1);
    return () => { hiddenWorkspaceDescriptions.splice(index, 0, entry!); };
  };

  /**
   * One checks descriptor save: replaces or appends the workspace entry, persists
   * the whole file and restores the previous descriptor when the write fails. It
   * never notifies; each caller maps notification failure to its own result. A whole
   * approved list replaces the checks plans brought as well (121-136).
   * G8B B2：撤回留痕照旧留着：整批替换不等于人重新批了被撤回的那条。
   * R-M6：同 scope 的隐藏描述一起取走，写失败一起放回。
   */
  const saveChecksDescriptor = async (
    scope: CoreScope,
    facts: HostSettingsWorkspaceFacts,
    proposal: { answerRef: QueryJobAnswerRef; answerDigest: string; checks: RegisteredCommandCheck[] },
    checksRevision: number | ((previous: PersistedWorkspaceV1 | undefined) => number),
    child?: { commandId: string; identityKey: string; fingerprint: string },
  ): Promise<boolean> => {
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    const previous = savedDescriptorOf(scope);
    const undoHidden = takeHiddenDescriptor(scope);
    const next: PersistedWorkspaceV1 = {
      scope: { ...scope },
      name: facts.name,
      root: facts.root,
      writeAllowed: facts.writeAllowed,
      commandsAllowed: facts.commandsAllowed,
      checks: structuredClone(proposal.checks),
      checksSource: { answerRef: structuredClone(proposal.answerRef), answerDigest: proposal.answerDigest },
      checksRevision: typeof checksRevision === 'function' ? checksRevision(previous) : checksRevision,
      ...(child === undefined ? {} : { checksChild: { ...child } }),
      ...(previous?.withdrawnChecks === undefined ? {} : { withdrawnChecks: structuredClone(previous.withdrawnChecks) }),
    };
    if (index >= 0) workspaces[index] = next; else workspaces.push(next);
    try { await persist(); return true; }
    catch {
      if (index >= 0 && previous !== undefined) workspaces[index] = previous; else workspaces.pop();
      undoHidden();
      return false;
    }
  };

  const publicModel = (model: HostSettingsStoredModel): SettingsModel => {
    let envConfigured = false;
    if (model.secretEnvironmentVariable !== undefined) {
      try { envConfigured = assembly.secretConfigured(model.secretEnvironmentVariable); }
      catch { envConfigured = false; }
    }
    return {
      id: model.id, label: model.label, provider: model.provider, model: model.model,
      baseUrl: model.baseUrl ?? '',
      contextWindowTokens: contextWindowTokensOf(model),
      credentialConfigured: (typeof model.apiKey === 'string' && model.apiKey.length > 0) || envConfigured,
      ...(model.thinking === undefined ? {} : { thinking: model.thinking }),
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
      ...(model.promptPack === undefined ? {} : { promptPack: model.promptPack }),
      ...(model.reasoningReplay === undefined ? {} : { reasoningReplay: model.reasoningReplay }),
    };
  };

  const snapshotOf = (): HostSettingsSnapshot => {
    const adoptedPlanChecks = adoptedPlanChecksOf(workspaces);
    return {
    models: models.map(publicModel),
    adoptedPlanChecks,
    workspaces: assembly.listWorkspaces().map(facts => {
      const persistedFacts = workspaces.find(entry => scopeKey(entry.scope) === scopeKey(facts.scope));
      return {
        scope: { projectId: facts.scope.projectId, workspaceId: facts.scope.workspaceId },
        name: facts.name,
        root: facts.root,
        modelId: selection[scopeKey(facts.scope)] ?? facts.modelId ?? null,
        writeAllowed: facts.writeAllowed,
        commandsAllowed: facts.commandsAllowed,
        accessFixed: facts.accessFixed,
        ...(persistedFacts?.checks === undefined && persistedFacts?.planChecks === undefined
          ? {} : { checks: [...structuredClone(persistedFacts.checks ?? []), ...savedPlanChecks(persistedFacts)] }),
        ...(persistedFacts?.planChecks === undefined ? {} : { checkApprovals: persistedFacts.planChecks.map(planned =>
          ({ checkId: planned.check.checkId, plan: structuredClone(planned.plan),
            approvedBy: structuredClone(planned.approvedBy),
            ...(planned.author === undefined ? {} : { author: { ...planned.author } }),
            ...(planned.baseline === undefined ? {} : { baseline: { ...planned.baseline } }),
            approvedAt: planned.approvedAt })) }),
        ...(persistedFacts?.withdrawnChecks === undefined ? {} : { withdrawnChecks: persistedFacts.withdrawnChecks
          .map(withdrawn => ({ checkId: withdrawn.check.checkId, withdrawnAt: withdrawn.withdrawnAt,
            ...(withdrawn.answer === undefined
              ? { plan: structuredClone(withdrawn.plan) }
              : { answerRef: structuredClone(withdrawn.answer.answerRef) }) })) }),
        ...(facts.storeLocation === null
          ? {} : { storeLocation: { place: facts.storeLocation.place, reason: facts.storeLocation.reason,
            reasonCode: facts.storeLocation.reasonCode } }),
        knowledgeLocalOnly: facts.knowledgeRepoKey != null && knowledgeLocalOnly[facts.knowledgeRepoKey] === true,
        folderPresent: facts.folderPresent,
      };
    }),
    // C8 (A.2 step 5.8): the stored policy, the defaults when none was saved (after an
    // unconfirmed `automation/save` the Host may still apply the previous one until a retry).
    automation: { ...(automation ?? DEFAULT_TASK_AUTOMATION_POLICY) },
    resourceCaps: {
      memoryMaxMiB: resourceCapSetting?.memoryMaxMiB ?? null,
      tasksMax: resourceCapSetting?.tasksMax ?? null,
      defaults: { ...capDefaults },
      effective: effectiveResourceCaps(),
      machine: resourceCapStatusOf(),
    },
    workRunTokenBudget: {
      saved: workRunTokenBudget ?? null,
      effective: effectiveWorkRunTokenBudget(),
      max: MAX_WORK_RUN_TOKEN_BUDGET,
    },
    planLoopLimits: {
      saved: planLoopLimitSetting === undefined ? null : copyPlanLoopLimits(planLoopLimitSetting),
      effective: copyPlanLoopLimits(effectivePlanLoopLimits()),
      defaults: copyPlanLoopLimits(DEFAULT_PLAN_LOOP_LIMITS),
    },
    commandReviewLine: {
      saved: commandReviewLineSetting ?? null,
      effective: effectiveCommandReviewLine(),
      default: DEFAULT_COMMAND_REVIEW_LINE_MINUTES,
    },
    structuralApproval: { saved: structuredClone(structuralApproval), defaults: { ...DEFAULT_STRUCTURAL_APPROVAL } },
    replyDeadline: { saved: { ...replyDeadlineMinutes }, default: DEFAULT_REPLY_DEADLINE_MINUTES },
    };
  };

  // Restore every persisted directory registration through the real owners
  // BEFORE the Host listens. A failed restore is an explicit startup failure.
  // Each entry is handled by its own project: an unavailable project keeps its
  // listed scope (a root that still resolves is checked; a gone one has no proof
  // to make), and an open project's root is checked before it registers.
  let droppedRemoved = false;
  for (const entry of [...workspaces]) {
    const opened = await assembly.openWorkspace({
      path: entry.root, projectId: entry.scope.projectId, workspaceId: entry.scope.workspaceId,
      name: entry.name, writeAllowed: entry.writeAllowed, commandsAllowed: entry.commandsAllowed,
    });
    if (opened.status === 'ready') continue;
    // WD-19: a registration the core already marked removed is dropped, not a start failure; the one persist after
    // the loop is what keeps it from coming back on the next start.
    if (opened.code === 'not_found' && opened.reason === WORKSPACE_REMOVED_REASON) {
      const index = workspaces.findIndex(listed => scopeKey(listed.scope) === scopeKey(entry.scope));
      if (index >= 0) workspaces.splice(index, 1);
      droppedRemoved = true;
      continue;
    }
    throw new Error(opened.reason);
  }
  if (droppedRemoved) await persist();
  // V12: the start-up workspaces the Host declares join the list in one write, so the next start opens their project
  // from the list.
  const declared = (options.declareWorkspaces ?? [])
    .filter(entry => !workspaces.some(listed => scopeKey(listed.scope) === scopeKey(entry.scope)));
  if (declared.length > 0) {
    workspaces.push(...declared.map(entry => ({ scope: { ...entry.scope }, name: entry.name, root: entry.root,
      writeAllowed: entry.writeAllowed, commandsAllowed: entry.commandsAllowed })));
    await persist();
  }
  // 121-136 A3: every adoption that installed a plan's checks and was cut off settles before the first install, which
  // then publishes the settled configuration once. One that cannot settle stops the start, as a failed restore does.
  // G8B B4：只有已打开项目的记录结不清才停止启动。项目本次没打开（库不可用）的记录读不到候选，跳过它：记录留着待
  // 恢复，往标准错误写一行。它的检查本次不装（Host 只往打开的项目里装），下次启动再结清。
  const listed = assembly.listWorkspaces();
  for (const entry of [...workspaces]) {
    const waiting = entry.planAdoption;
    if (waiting !== undefined
      && listed.find(facts => scopeKey(facts.scope) === scopeKey(entry.scope))?.projectOpen === false) {
      process.stderr.write(`[platform] 项目 ${entry.scope.projectId} 本次没有打开，工作区 ${entry.scope.workspaceId} `
        + `里计划候选 ${waiting.proposalRef.proposalId} 装检查的采用没有结清：读不到这份候选。记录留着，下次启动再结清\n`);
      continue;
    }
    const pending = await settlePlanAdoption(entry.scope, false);
    if (pending !== null) throw new Error(pending.reason);
  }
  await notify();

  async function directoriesRoute(input: unknown): Promise<SettingsResponse<DirectoryListing>> {
    const record = isRecord(input) ? input : {};
    const requestedPath = record['path'];
    if (requestedPath !== undefined && typeof requestedPath !== 'string') return invalid('path must be a string');
    const showHidden = record['showHidden'] === true;
    let canonical: string;
    try { canonical = await realpath(requestedPath ?? homedir()); }
    catch { return notFound('the requested directory does not exist'); }
    let info;
    try { info = await stat(canonical); }
    catch { return notFound('the requested directory does not exist'); }
    if (!info.isDirectory()) return invalid('the requested path is not a directory');
    let entries;
    try { entries = await readdir(canonical, { withFileTypes: true }); }
    catch { return unavailable('the directory could not be read'); }
    const isGitRepository = (await gitCommonDir(canonical)) !== null;
    const driveReliability = await mountReliability(canonical);
    const LIMIT = 1000;
    const directories = entries
      .filter(entry => entry.isDirectory() && (showHidden || !entry.name.startsWith('.')))
      .map(entry => ({ name: entry.name, path: join(canonical, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const parentDirectory = dirname(canonical);
    return { status: 'ready', value: {
      path: canonical,
      parent: parentDirectory === canonical ? null : parentDirectory,
      directories: directories.slice(0, LIMIT),
      truncated: directories.length > LIMIT,
      isGitRepository,
      driveReliability,
    } };
  }

  async function saveModelRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input)) return invalid('models/save requires an object body');
    if (!nonEmpty(input['label'])) return invalid('label is required');
    if (input['provider'] !== 'deepseek' && input['provider'] !== 'openai') return invalid('provider must be deepseek or openai');
    if (!nonEmpty(input['model'])) return invalid('model is required');
    if (input['baseUrl'] !== undefined) {
      if (typeof input['baseUrl'] !== 'string') return invalid('baseUrl must be a string');
      const problem = validateSettingsBaseUrl(input['baseUrl']);
      if (problem !== null) return invalid(problem.reason);
    }
    if (input['thinking'] !== undefined && input['thinking'] !== 'enabled' && input['thinking'] !== 'disabled')
      return invalid('thinking must be enabled or disabled');
    if (input['reasoningEffort'] !== undefined && input['reasoningEffort'] !== 'low'
      && input['reasoningEffort'] !== 'high' && input['reasoningEffort'] !== 'max')
      return invalid('reasoningEffort must be low, high, max');
    if (input['promptPack'] !== undefined && !isPromptPackId(input['promptPack']))
      return invalid('promptPack must be a pack id');
    if (input['reasoningReplay'] !== undefined && !isReasoningReplayV1(input['reasoningReplay']))
      return invalid('reasoningReplay must be current_run, none or all');
    if (input['id'] !== undefined && !nonEmpty(input['id'])) return invalid('id must be a non-empty string when present');
    if (input['apiKey'] !== undefined && typeof input['apiKey'] !== 'string') return invalid('apiKey must be a string when present');

    const label = input['label'];
    const provider = input['provider'];
    const modelName = input['model'];
    const baseUrl = typeof input['baseUrl'] === 'string' ? input['baseUrl'] : undefined;
    const thinking = input['thinking'] === 'enabled' || input['thinking'] === 'disabled' ? input['thinking'] : undefined;
    const reasoningEffort = input['reasoningEffort'] === 'low' || input['reasoningEffort'] === 'high'
      || input['reasoningEffort'] === 'max' ? input['reasoningEffort'] : undefined;
    const promptPack = typeof input['promptPack'] === 'string' ? input['promptPack'] : undefined;
    const reasoningReplay = isReasoningReplayV1(input['reasoningReplay']) ? input['reasoningReplay'] : undefined;
    const modelId = nonEmpty(input['id']) ? input['id'] : randomUUID();
    const existingIndex = models.findIndex(entry => entry.id === modelId);
    const previous = existingIndex >= 0 ? models[existingIndex] : undefined;
    const nextApiKey = typeof input['apiKey'] === 'string' && input['apiKey'].length > 0
      ? input['apiKey'] : previous?.apiKey;
    const next: HostSettingsStoredModel = {
      id: modelId, label, provider, model: modelName,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(thinking === undefined ? {} : { thinking }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      // Ruling 7: a save without the field CLEARS it; absence is what resolves to
      // `platform` / `all`, so a later save never inherits the old pack.
      ...(promptPack === undefined ? {} : { promptPack }),
      ...(reasoningReplay === undefined ? {} : { reasoningReplay }),
      ...(previous?.secretEnvironmentVariable === undefined ? {} : { secretEnvironmentVariable: previous.secretEnvironmentVariable }),
      ...(nextApiKey === undefined ? {} : { apiKey: nextApiKey }),
    };
    if (existingIndex >= 0) models[existingIndex] = next; else models.push(next);
    try { await persist(); }
    catch {
      if (existingIndex >= 0 && previous !== undefined) models[existingIndex] = previous; else models.pop();
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      // The model IS saved; only the runtime re-assembly is unconfirmed. Never
      // answer as if nothing was stored.
      return unavailable('the model was saved but the runtime configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  async function selectModelRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input)) return invalid('models/select requires an object body');
    if (!validScope(input['scope'])) return invalid('a complete project/workspace scope is required');
    if (!nonEmpty(input['modelId'])) return invalid('modelId is required');
    const key = scopeKey(input['scope']);
    if (!assembly.listWorkspaces().some(workspace => scopeKey(workspace.scope) === key))
      return notFound('the workspace is not registered');
    if (!models.some(entry => entry.id === input['modelId'])) return notFound('the model does not exist');
    const previous = selection[key];
    selection[key] = input['modelId'];
    try { await persist(); }
    catch {
      if (previous === undefined) delete selection[key]; else selection[key] = previous;
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the selection was saved but the runtime configuration was not confirmed; retry the same selection');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /** The switch validation both `workspaces/open` and `workspaces/access` use: both values are required booleans, and
   *  commands require write because a command can change files anywhere in the workspace (host.ts's command shell
   *  grant). */
  const accessProblem = (input: Record<string, unknown>): string | null => {
    if (typeof input['writeAllowed'] !== 'boolean' || typeof input['commandsAllowed'] !== 'boolean')
      return 'writeAllowed and commandsAllowed are required booleans';
    if (input['commandsAllowed'] === true && input['writeAllowed'] !== true)
      return 'commandsAllowed requires writeAllowed';
    return null;
  };

  /** Write one workspace's REAL Host registration facts onto the settings list, keeping its saved checks. A workspace
   *  joining an open project none of whose workspaces is listed yet first puts the project's main workspace, its first
   *  in the Host, on the list (X2). Returns the undo of the hidden copies it took, for a caller that rolls the visible
   *  list back on a failed write. */
  const listDescriptor = (facts: HostSettingsWorkspaceFacts): (() => void) => {
    // The persisted descriptor is the REAL Host registration fact. A repeated open with wider flags can never
    // silently widen the stored permissions; a description hidden by a forget keeps its saved checks.
    const descriptorOf = (source: HostSettingsWorkspaceFacts,
      prior: PersistedWorkspaceV1 | undefined): PersistedWorkspaceV1 => ({
      scope: { ...source.scope },
      name: source.name,
      root: source.root,
      writeAllowed: source.writeAllowed,
      commandsAllowed: source.commandsAllowed,
      ...(prior?.checks === undefined ? {} : { checks: structuredClone(prior.checks) }),
      ...(prior?.checksSource === undefined ? {} : { checksSource: structuredClone(prior.checksSource) }),
      ...(prior?.checksChild === undefined ? {} : { checksChild: { ...prior.checksChild } }),
      ...(prior?.checksRevision === undefined ? {} : { checksRevision: prior.checksRevision }),
      ...(prior?.planChecks === undefined ? {} : { planChecks: structuredClone(prior.planChecks) }),
      ...(prior?.planAdoption === undefined ? {} : { planAdoption: structuredClone(prior.planAdoption) }),
      ...(prior?.withdrawnChecks === undefined ? {} : { withdrawnChecks: structuredClone(prior.withdrawnChecks) }),
    });
    const key = scopeKey(facts.scope);
    // R-M6: a hidden description of the same scope is this workspace coming back; its saved checks return with it.
    const existing = savedDescriptorOf(facts.scope);
    const descriptor = descriptorOf(facts, existing);
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === key);
    const undoHidden = takeHiddenDescriptor(facts.scope);
    let undoMainHidden = (): void => undefined;
    // X2 (KLS-1b): the start opens a project from its first listed workspace (its main one, whose root places the
    // store). A workspace joining an open project none of whose workspaces is listed yet (a start-up workspace
    // V12 did not list) puts the project's main workspace, its first in the Host, on the list before itself.
    if (index < 0 && !workspaces.some(entry => entry.scope.projectId === facts.scope.projectId)) {
      const main = assembly.listWorkspaces().find(workspace => workspace.scope.projectId === facts.scope.projectId);
      if (main !== undefined && scopeKey(main.scope) !== key) {
        // R-M6: the main workspace may itself be hidden by the same forget; take its checks back the same way and
        // never leave a second, checkless copy of the scope in the hidden list.
        const mainKey = scopeKey(main.scope);
        const mainExisting = savedDescriptorOf(main.scope);
        workspaces.push(descriptorOf(main, mainExisting));
        undoMainHidden = takeHiddenDescriptor(main.scope);
      }
    }
    if (index >= 0) workspaces[index] = descriptor; else workspaces.push(descriptor);
    return () => { undoMainHidden(); undoHidden(); };
  };

  async function openWorkspaceRoute(input: unknown): Promise<SettingsResponse<SettingsRoutes['workspaces/open']['value']>> {
    if (!isRecord(input)) return invalid('workspaces/open requires an object body');
    if (!nonEmpty(input['path'])) return invalid('path is required');
    const problem = accessProblem(input);
    if (problem !== null) return invalid(problem);
    if (input['name'] !== undefined && !nonEmpty(input['name'])) return invalid('name must be a non-empty string when present');
    if (input['projectId'] !== undefined && !nonEmpty(input['projectId'])) return invalid('projectId must be a non-empty string when present');
    if (input['modelId'] !== undefined && !nonEmpty(input['modelId'])) return invalid('modelId must be a non-empty string when present');
    if (nonEmpty(input['modelId']) && !models.some(entry => entry.id === input['modelId'])) return notFound('the model does not exist');

    const depthInput = input['explorationDepth'];
    if (depthInput !== undefined && depthInput !== 1 && depthInput !== 2 && depthInput !== 3)
      return invalid('explorationDepth must be 1, 2 or 3');
    const explorationDepth = depthInput === 1 || depthInput === 2 || depthInput === 3 ? depthInput : undefined;
    if (input['gitInit'] !== undefined && typeof input['gitInit'] !== 'boolean')
      return invalid('gitInit must be a boolean');

    let create: { name: string } | undefined;
    if (input['create'] !== undefined) {
      const value = input['create'];
      if (!isRecord(value) || !nonEmpty(value['name'])) return invalid('create.name must be a non-empty string');
      create = { name: value['name'] };
    }

    const request: OpenSettingsWorkspace = {
      path: input['path'], writeAllowed: input['writeAllowed'] as boolean, commandsAllowed: input['commandsAllowed'] as boolean,
      ...(nonEmpty(input['name']) ? { name: input['name'] } : {}),
      ...(nonEmpty(input['projectId']) ? { projectId: input['projectId'] } : {}),
      ...(nonEmpty(input['modelId']) ? { modelId: input['modelId'] } : {}),
      ...(create === undefined ? {} : { create }),
      ...(explorationDepth === undefined ? {} : { explorationDepth }),
      ...(typeof input['gitInit'] === 'boolean' ? { gitInit: input['gitInit'] } : {}),
    };
    const opened = await assembly.openWorkspace(request);
    if (opened.status !== 'ready') return opened;

    const key = scopeKey(opened.value.scope);
    const facts = assembly.listWorkspaces().find(workspace => scopeKey(workspace.scope) === key);
    if (facts === undefined) return unavailable('the opened workspace is not visible in the Host registration');
    listDescriptor(facts);
    if (request.modelId !== undefined) selection[key] = request.modelId;
    try { await persist(); }
    catch {
      // The workspace IS registered and mounted in this Host; do not answer as
      // if it were absent. A created folder now exists, so the recovery is the
      // same path without `create`, which takes the existing-root branch.
      return unavailable('the workspace was mounted but the settings file could not be written; '
        + 'retry workspaces/open with the same path and without create');
    }
    try { await notify(); }
    catch {
      return unavailable('the workspace was saved but the runtime configuration was not confirmed; '
        + 'retry workspaces/open with the same path and without create');
    }
    return { status: 'ready', value: {
      settings: snapshotOf(),
      bootstrap: assembly.bootstrap(),
      scope: { ...opened.value.scope },
    } };
  }

  /** Where proposed checks come from: the owner ref the scope is judged by, its name in a refusal, and its reader. */
  type CheckProposalSource<P> = { owner: { projectId: string; workspaceId: string }; what: string;
    read: (() => Promise<SettingsResponse<P>>) | undefined };
  const answerSource = (scope: CoreScope, answerRef: QueryJobAnswerRef): CheckProposalSource<{
    answerRef: QueryJobAnswerRef; answerDigest: string; checks: RegisteredCommandCheck[] }> =>
    ({ owner: answerRef, what: 'saved Answer',
      read: assembly.readCheckProposal === undefined ? undefined : () => assembly.readCheckProposal!(scope, answerRef) });

  /**
   * The one proposal validation the direct `checks/approve` route, the adoption entry and (121-136) a person's adoption
   * of a plan that brings checks use: the source's scope, the registered workspace and its real write+command grant,
   * the source's reader and its error map, the proposed checks' shape, and — for the direct route — the exact requested
   * list. The adoption entry passes `null` and compares the proposal against its own frozen source/digest instead of a
   * request body.
   */
  async function trustedCheckProposal<P extends { checks: RegisteredCommandCheck[] }>(
    scope: CoreScope,
    source: CheckProposalSource<P>,
    requested: readonly RegisteredCommandCheck[] | null,
  ): Promise<{ status: 'ready'; value: { facts: HostSettingsWorkspaceFacts; proposal: P } }
    | { status: 'rejected'; response: SettingsRejection }> {
    if (source.owner.projectId !== scope.projectId || source.owner.workspaceId !== scope.workspaceId) {
      return { status: 'rejected', response: invalid(`the ${source.what} belongs to another workspace scope`) };
    }
    const facts = assembly.listWorkspaces().find(workspace => scopeKey(workspace.scope) === scopeKey(scope));
    if (facts === undefined) return { status: 'rejected', response: notFound('the workspace is not registered') };
    if (facts.writeAllowed !== true || facts.commandsAllowed !== true) {
      return { status: 'rejected', response: { status: 'rejected', code: 'forbidden',
        reason: 'approving command checks requires the workspace real write and command grant' } };
    }
    if (source.read === undefined) {
      return { status: 'rejected', response: { status: 'rejected', code: 'unsupported',
        reason: `the Host does not publish the ${source.what} check proposal reader` } };
    }
    let proposal;
    try {
      proposal = await source.read();
    } catch {
      return { status: 'rejected', response: unavailable(`the ${source.what} check proposal could not be read`) };
    }
    if (proposal.status !== 'ready') return { status: 'rejected', response: proposal };
    if (!Array.isArray(proposal.value.checks) || !proposal.value.checks.every(isRegisteredCommandCheck)) {
      return { status: 'rejected', response: invalid(`the ${source.what} proposal checks are invalid`) };
    }
    if (requested !== null) {
      let approvedJson: string;
      let proposalJson: string;
      try {
        approvedJson = canonicalJson(requested as unknown as JsonValue);
        proposalJson = canonicalJson(proposal.value.checks as unknown as JsonValue);
      } catch {
        return { status: 'rejected', response: invalid('the approved checks are not canonicalizable JSON') };
      }
      if (approvedJson !== proposalJson) {
        return { status: 'rejected', response: invalid('the approved checks do not match the saved Answer proposal') };
      }
    }
    return { status: 'ready', value: { facts, proposal: structuredClone(proposal.value) } };
  }

  /**
   * R6 cold-start: the ONE explicit Host-user approval that turns a saved
   * Answer's suggested checks into this workspace's trusted check
   * configuration. The saved Answer is the authority: `readCheckProposal`
   * returns the exact source/ref/digest/checks, the request must approve that
   * exact check list, and the workspace must already carry its real write and
   * command grant. Nothing here can widen a permission or accept a model-authored
   * check that the saved Answer did not propose.
   */
  async function approveChecksRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input)) return invalid('checks/approve requires an object body');
    if (!validScope(input['scope'])) return invalid('a complete project/workspace scope is required');
    const answerRef = input['answerRef'];
    if (!isRecord(answerRef) || answerRef['aggregateType'] !== 'QueryJobAnswer'
      || !nonEmpty(answerRef['projectId']) || !nonEmpty(answerRef['workspaceId'])
      || !nonEmpty(answerRef['queryJobId']) || !nonEmpty(answerRef['answerId'])) {
      return invalid('checks/approve requires a complete saved QueryJobAnswerRef');
    }
    const requested = input['checks'];
    if (!Array.isArray(requested) || !requested.every(isRegisteredCommandCheck)) {
      return invalid('checks/approve requires an array of registered command checks');
    }
    const scope = { projectId: input['scope'].projectId, workspaceId: input['scope'].workspaceId };
    const checked = await trustedCheckProposal(scope, answerSource(scope, answerRef as unknown as QueryJobAnswerRef),
      requested);
    if (checked.status === 'rejected') return checked.response;
    const { facts, proposal } = checked.value;
    // A direct approval replaces the adoption child that described the old checks;
    // the counter still moves so a frozen `previous` sees the replacement.
    if (!await saveChecksDescriptor(scope, facts, proposal, previous => (previous?.checksRevision ?? 0) + 1))
      return unavailable('the approved checks could not be persisted');
    try { await notify(); }
    catch {
      return unavailable('the checks were saved but the Host configuration was not confirmed; retry the same approval');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * G8B B2；决定 121-149（lead 改判 G8B-1b，依据 121-141、121-111）：人撤回一条装上的检查——计划装上的，或已批准清单里的。设置路由只有 Host 的使用者
   * 能调，agent 够不着，所以不另判身份。在设置队列里先结清这个工作区待恢复的采用（结不清回它的 `unavailable`），再：
   * - 计划装上的：从 `planChecks` 去掉，留痕写 `plan`；
   * - 已批准清单里的：从 `checks` 去掉，留痕写 `answer`（这份清单的保存回答）。清单仍绑原回答；留痕只说明谁
   *   撤过、从哪撤的，不用来推算清单内容（整批批准装回以后留痕还在，人采用的计划装回同一个 id 时留痕去掉）。`checksRevision` 加一、`checksChild` 去掉，和 `checks/approve` 一样，冻结的旧 pin 看得出它变了。
   * 存盘，推给 Host；Host 按新内容算配置版本。计划不动；已开的检查轮照旧用冻结的配置；同一个 checkId 以后只有人能装回。
   */
  async function withdrawCheckRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input) || !validScope(input['scope']) || !nonEmpty(input['checkId']))
      return invalid('checks/withdraw 要完整的项目/工作区范围和 checkId');
    const scope = { projectId: input['scope'].projectId, workspaceId: input['scope'].workspaceId };
    const checkId = input['checkId'];
    const earlier = await settlePlanAdoption(scope, true);
    if (earlier !== null) return earlier;
    const notConfirmed = (): SettingsResponse<never> => unavailable('撤回已保存，Host 还没确认；重做同一个撤回');
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    const entry = workspaces[index];
    const planned = entry?.planChecks?.find(candidate => candidate.check.checkId === checkId);
    // 已批准清单要连着它的来源一起在（`savedChecksOf` 同一个条件）。
    const listed = planned === undefined && entry?.checksSource !== undefined
      ? entry.checks?.find(check => check.checkId === checkId) : undefined;
    if (entry === undefined || (planned === undefined && listed === undefined)) {
      if (entry?.withdrawnChecks?.some(withdrawn => withdrawn.check.checkId === checkId) !== true)
        return notFound(`这个工作区的设置里没有检查 ${checkId}（Host 启动配置里的检查在启动配置里改）`);
      // 重做同一个撤回：原样回快照，上一次没确认的推送这次补上。
      try { await notify(); }
      catch { return notConfirmed(); }
      return { status: 'ready', value: snapshotOf() };
    }
    const withdrawnAt = now();
    if (planned !== undefined) {
      const { planChecks, ...rest } = entry;
      const kept = (planChecks ?? []).filter(candidate => candidate !== planned);
      workspaces[index] = { ...rest, ...(kept.length === 0 ? {} : { planChecks: kept }),
        withdrawnChecks: [...(entry.withdrawnChecks ?? []),
          { check: structuredClone(planned.check), plan: structuredClone(planned.plan), withdrawnAt }] };
    } else {
      const { checksChild: _replaced, ...rest } = entry;
      workspaces[index] = { ...rest, checks: entry.checks!.filter(check => check !== listed),
        checksRevision: (entry.checksRevision ?? 0) + 1,
        withdrawnChecks: [...(entry.withdrawnChecks ?? []),
          { check: structuredClone(listed!), answer: structuredClone(entry.checksSource!), withdrawnAt }] };
    }
    try { await persist(); }
    catch {
      workspaces[index] = entry;
      return unavailable('撤回没能写进设置文件');
    }
    try { await notify(); }
    catch { return notConfirmed(); }
    return { status: 'ready', value: snapshotOf() };
  }

  const readSavedChecks: ReadSavedChecks = async (_ctx, input) => {
    if (!isRecord(input) || !validScope(input['scope']))
      return rejected('invalid', 'a complete project/workspace scope is required');
    return savedChecksOf({ projectId: input.scope.projectId, workspaceId: input.scope.workspaceId });
  };

  const confirmInstalledChecks: ConfirmInstalledChecks = async (ctx, input) => {
    const adoption = callbacks.adoption;
    if (adoption === undefined)
      return rejected('unsupported', 'the Host does not publish the P11 adoption callbacks');
    if (!isRecord(input) || !validScope(input['scope']))
      return rejected('invalid', 'a complete project/workspace scope is required');
    return await adoption.confirmInstalledChecks(ctx, {
      scope: { projectId: input.scope.projectId, workspaceId: input.scope.workspaceId },
    });
  };

  const notSaved = (code: CoreError, reason: string): ChecksSaveResultV1 =>
    ({ status: 'not_saved', rejection: rejected(code, reason) });
  const checksMoved = (): ChecksSaveResultV1 =>
    notSaved('revision_conflict', 'the saved checks moved relative to the frozen previous state');

  /**
   * The narrow checks entry. It reuses the direct approval's validation and its
   * persist/rollback/notify path, and adds the stored child identity and the save
   * counter. The same child/source/checks first returns the real saved result and
   * sends only the missed notification: it never persists twice. A different
   * child with a source and checks that still match the frozen `previous` is a
   * legal replacement.
   */
  const applyChecksForAdoption: ApplyChecksForAdoption = async (ctx, input) => {
    const adoption = callbacks.adoption;
    if (adoption === undefined)
      return notSaved('unsupported', 'the Host does not publish the P11 adoption callbacks');
    if (!isRecord(input) || !validScope(input['scope']) || !validChecksPin(input['source'])
      || !validChecksChild(input['child'])
      || (input['previous'] !== null && !validChecksPin(input['previous']))) {
      return notSaved('invalid', 'the adoption checks input is invalid');
    }
    const scope = { projectId: input.scope.projectId, workspaceId: input.scope.workspaceId };
    const saved = savedChecksOf(scope);
    const savedState = saved.status === 'ready' ? saved.value : null;
    const source = input.source;
    let savedDigest: string | undefined;
    const checksDigestOf = (state: StoredChecksStateV1): string =>
      savedDigest ??= sha256Hex(canonicalJson(state.checks as unknown as JsonValue));

    if (savedState !== null && source.settings !== null && savedState.child !== null
      && sameJson(savedState.child as unknown as JsonValue, input.child as unknown as JsonValue)
      && sameJson(savedState.source as unknown as JsonValue, source.settings as unknown as JsonValue)
      && savedState.checksRevision === source.checksRevision) {
      const contentDigest = checksDigestOf(savedState);
      if (contentDigest === source.contentDigest) {
        // The missed notification still runs so a new Host installs this exact
        // configuration; the file and its child are not written again.
        const value = {
          configuration: adoption.buildConfiguration({
            scope, source: savedState.source, checks: savedState.checks,
          }),
          settings: {
            answerRef: structuredClone(savedState.source.answerRef),
            answerDigest: savedState.source.answerDigest,
          },
          contentDigest,
        };
        try { await notify(); }
        catch { return { status: 'saved_unconfirmed', value }; }
        return { status: 'saved', value };
      }
    }

    if (source.settings === null) return checksMoved();
    const checked = await trustedCheckProposal(scope, answerSource(scope, source.settings.answerRef), null);
    if (checked.status === 'rejected') return { status: 'not_saved', rejection: checked.response };
    const { facts, proposal } = checked.value;
    const proposalDigest = sha256Hex(canonicalJson(proposal.checks as unknown as JsonValue));

    if (!sameJson({ answerRef: proposal.answerRef, answerDigest: proposal.answerDigest } as unknown as JsonValue,
      source.settings as unknown as JsonValue)
      || proposalDigest !== source.contentDigest) {
      return notSaved('revision_conflict', 'the saved checks moved relative to the frozen source');
    }

    if (savedState !== null) {
      if (input.previous === null || input.previous.settings === null) return checksMoved();
      if (!sameJson(savedState.source as unknown as JsonValue,
        input.previous.settings as unknown as JsonValue)
        || savedState.checksRevision !== input.previous.checksRevision
        || checksDigestOf(savedState) !== input.previous.contentDigest) return checksMoved();
    } else if (input.previous !== null && input.previous.settings === null) {
      // No saved checks is not proof the static fallback did not move: compare
      // the real installed configuration, keeping a read failure as unavailable.
      const confirmed = await adoption.confirmInstalledChecks(ctx, { scope });
      if (confirmed.status === 'rejected') return { status: 'not_saved', rejection: confirmed };
      if (confirmed.status !== 'ready')
        return notSaved('unavailable', 'the installed check configuration could not be read');
      if (confirmed.value.configurationRevision !== input.previous.configurationRevision
        || confirmed.value.contentDigest !== input.previous.contentDigest) return checksMoved();
    } else if (input.previous !== null) {
      return checksMoved();
    }

    if (!await saveChecksDescriptor(scope, facts, proposal, source.checksRevision, input.child))
      return notSaved('unavailable', 'the approved checks could not be persisted');
    const value = {
      configuration: adoption.buildConfiguration({
        scope, source: { answerRef: structuredClone(proposal.answerRef), answerDigest: proposal.answerDigest },
        checks: proposal.checks,
      }),
      settings: {
        answerRef: structuredClone(source.settings.answerRef), answerDigest: source.settings.answerDigest,
      },
      contentDigest: proposalDigest,
    };
    try { await notify(); }
    catch { return { status: 'saved_unconfirmed', value }; }
    return { status: 'saved', value };
  };

  /**
   * 121-136 A3: an adoption of a plan that brings its own checks, as one recoverable whole under the settings queue,
   * in the initialization adoption's order: record with the state before, install, adopt, close. Inside the queue, in
   * order: an earlier adoption of this workspace left pending settles; the adoption owner's original receipt answers a
   * replay (`replay`), with no read of the current checks and no install; a candidate whose adoption has ended (adopted,
   * not adopted, stale) gets the owner's own answer from `apply` with nothing installed; a plan whose checks are all
   * installed already or replaced by identical entries (nothing in `proposedCheckSplit`) is the plain `apply`, with no
   * install grant. Otherwise the plan's checks pass the proposal validation a saved Answer's do (`trustedCheckProposal`);
   * the ones not installed, and a person's redefinitions of checks plans brought, are saved with the plan, the approver
   * and the time in the same write as the pending record (`planAdoption`, which also keeps the displaced entries), then
   * installed, and `apply` adopts with the request's own identity. Committed closes the record; any other answer settles
   * it (`settlePlanAdoption`), and a settle that cannot finish answers that it is pending. The Host's platform adoption
   * also passes `judge`, the A13 decision bound to its candidate version: it runs before the install and again before
   * `apply`, so a candidate that moved while queued is not installed, and a post-install refusal settles the record.
   */
  const adoptWithPlanChecks: ChecksAdoptionEntryPortWithJudge['adoptWithPlanChecks'] = (ctx, input, { replay, apply }, judge) =>
    serialize(async () => {
    const { scope, proposalRef } = input;
    const notInstalled = (code: CoreError, reason: string) => rejected(code, `the plan's checks `
      + `${input.checks.map(check => check.checkId).join(', ')} cannot be installed, so the plan was not adopted: ${reason}`);
    const adoption = callbacks.adoption;
    const readProposal = assembly.readPlanCheckProposal;
    if (adoption === undefined || readProposal === undefined) {
      return notInstalled('unsupported', 'the Host does not publish the installed-check or the plan-check read');
    }
    const earlier = await settlePlanAdoption(scope, true);
    if (earlier !== null) return earlier;
    const original = await replay();
    if (original.status !== 'not_found') return original;
    let read: Awaited<ReturnType<typeof readProposal>>;
    try { read = await readProposal(scope, proposalRef); }
    catch { read = unavailable('the plan candidate could not be read'); }
    if (read.status !== 'ready') return notInstalled(read.code, read.reason);
    if (read.value.adoption !== 'open') return await apply();
    // 2.5a A13: the queue reads the candidate again for its checks, so the judgement bound to the version the
    // wrapper judged runs before anything is installed; a moved or now-refused version installs nothing.
    const refusedBefore = judge === undefined ? null : await judge();
    if (refusedBefore !== null) return refusedBefore;
    const installed = await adoption.confirmInstalledChecks(ctx, { scope });
    if (installed.status !== 'ready') return notInstalled('unavailable', 'the installed checks could not be read');
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    const previous = savedDescriptorOf(scope);
    const approval = input.approval;
    // RC：只有人采用能把一条已装的计划检查换成同 id 的新定义（旧条目随待结记录存下）；agent 批准和平台自动采用仍判冲突。
    // 可替换 id 还要求当前装的那条同 id 检查就是计划带来的那一条（同摘要），启动配置/已批准清单的同 id 检查不算。
    const installedById = new Map(installed.value.checks.map(check => [check.checkId, check]));
    const replaceable = approval.kind === 'person' && previous !== undefined
      ? new Set((previous.planChecks ?? []).filter(planned => {
        const installedCheck = installedById.get(planned.check.checkId);
        return installedCheck !== undefined && checkDigestOf(installedCheck) === checkDigestOf(planned.check);
      }).map(planned => planned.check.checkId)) : undefined;
    const { added, replaced, conflicts } = proposedCheckSplit(installed.value.checks, read.value.checks, replaceable);
    if (conflicts.length > 0) return notInstalled('invalid', checkConflictProblem(conflicts));
    // 121-136 A1: a check identical to an installed one is installed already; only a real addition or replacement needs
    // the grant.
    if (added.length === 0 && replaced.length === 0) return await apply();
    // G8B B1f：agent 批准的每条新检查都要有改动前跑会失败的事实（同 id、同摘要）。
    // 拒绝（人的决定不能被 agent 推翻）：人撤回过的检查（B2 的留痕），只有人采用能再装上。
    const withdrawn = previous?.withdrawnChecks ?? [];
    const retaken = approval.kind === 'agent'
      ? added.find(check => withdrawn.some(entry => entry.check.checkId === check.checkId)) : undefined;
    if (retaken !== undefined) return notInstalled('forbidden', `检查 ${retaken.checkId} 被人撤回过，只有人采用能再装上`);
    const baselineOf = (check: RegisteredCommandCheck) => approval.kind === 'agent' ? approval.baselines.find(baseline =>
      baseline.checkId === check.checkId && baseline.checkDigest === checkDigestOf(check) && baseline.outcome === 'failed')
      : undefined;
    // 拒绝（产品规则：平台自动采用的新检查要在改动前失败）。会发生：请批之后、采用之前有人整批替换了检查清单
    // （checks/approve），原来已装的检查又成了新增。
    const unproved = approval.kind === 'agent' ? added.find(check => baselineOf(check) === undefined) : undefined;
    if (unproved !== undefined) return notInstalled('forbidden', `检查 ${unproved.checkId} 没有改动前跑会失败的事实`);
    const ready = read;
    const checked = await trustedCheckProposal(scope, { owner: proposalRef, what: 'plan', read: async () => ready }, null);
    if (checked.status === 'rejected') return notInstalled(checked.response.code, checked.response.reason);

    const { facts, proposal } = checked.value;
    const planRef = { proposalRef: structuredClone(proposalRef), checksDigest: proposal.checksDigest };
    const replacedIds = new Set(replaced.map(check => check.checkId));
    // RC L-4：旧条目连同它原来在 `planChecks` 里的位置一起存进待结记录；回滚按原位置放回，
    // 重跑（停机、通知失败）也得到同一份清单和同一个配置版本。
    const displaced = (previous?.planChecks ?? []).map((planned, index) => ({ index, planned }))
      .filter(({ planned }) => replacedIds.has(planned.check.checkId));
    const planAdoption: CheckApprovalV1['plan'] = {
      ...planRef,
      ...(displaced.length === 0 ? {} : { replaced: displaced.map(({ index, planned }) =>
        ({ index, ...structuredClone(planned) })) }),
    };
    const approvedAt = now();
    const addedEntries = added.map((check): PlanCheckEntryV1 => ({
      check: structuredClone(check), plan: structuredClone(planRef),
      // 人批的条目字节不变；agent 批的另记批准线、作者和这条检查的改动前事实。
      ...(approval.kind === 'person' ? { approvedBy: { kind: 'person' as const } } : {
        approvedBy: { kind: 'agent' as const, duty: approval.duty, session: { ...approval.session },
          answerRef: structuredClone(approval.answerRef) },
        author: { duty: approval.author }, baseline: { ...baselineOf(check)! } }),
      approvedAt }));
    // RC：替换来的新条目是人批的，旧条目原样进待结记录。
    const replacedEntries = replaced.map((check): PlanCheckEntryV1 => ({
      check: structuredClone(check), plan: structuredClone(planRef),
      approvedBy: { kind: 'person' }, approvedAt }));
    const next: PersistedWorkspaceV1 = {
      ...(previous ?? { scope: { ...scope }, name: facts.name, root: facts.root,
        writeAllowed: facts.writeAllowed, commandsAllowed: facts.commandsAllowed }),
      planChecks: [...(previous?.planChecks ?? []).filter(planned => !replacedIds.has(planned.check.checkId)),
        ...addedEntries, ...replacedEntries],
      planAdoption,
    };
    const undoHidden = takeHiddenDescriptor(scope);
    if (index >= 0) workspaces[index] = next; else workspaces.push(next);
    try { await persist(); }
    catch {
      if (index >= 0 && previous !== undefined) workspaces[index] = previous; else workspaces.pop();
      undoHidden();
      return notInstalled('unavailable', 'the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return await settlePlanAdoption(scope, true)
        ?? notInstalled('unavailable', 'the Host configuration was not confirmed; retry the same adoption');
    }
    // 2.5a A13: the same bound judgement again before the adoption; the checks are installed by now, so a refusal
    // settles them and the candidate stays the existing card (the next round shows it).
    const refusedAfter = judge === undefined ? null : await judge();
    if (refusedAfter !== null) return await settlePlanAdoption(scope, true) ?? refusedAfter;
    const result = await apply();
    if (result.status !== 'committed') return await settlePlanAdoption(scope, true) ?? result;
    await closePlanAdoption(scope);
    return result;
  });

  /**
   * C8 / LA-6 (A.2 step 5.8): the Host user's automatic-rework policy. The
   * whole policy is saved (`autoReworkLimit` 0..10, `resumeOnStartup`), stored
   * in the private file and pushed to the Host, which installs it at once
   * (`registerAutomationPolicy`): the requeue owner, the failure facts and
   * their automation verdict, and the capability report read it on their next
   * call; the start-up re-drive reads it at the next start.
   */
  async function saveAutomationRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input)) return invalid('automation/save requires an object body');
    const limit = input['autoReworkLimit'];
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || limit > MAX_AUTO_REWORK_LIMIT) {
      return invalid(`autoReworkLimit must be an integer from 0 to ${String(MAX_AUTO_REWORK_LIMIT)}`);
    }
    if (!(RESUME_ON_STARTUP_MODES as readonly unknown[]).includes(input['resumeOnStartup'])) {
      return invalid(`resumeOnStartup must be one of ${RESUME_ON_STARTUP_MODES.join(', ')}`);
    }
    const previous = automation;
    automation = { schemaVersion: 1, autoReworkLimit: limit, resumeOnStartup: input['resumeOnStartup'] as ResumeOnStartupMode };
    try { await persist(); }
    catch {
      automation = previous;
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the automation policy was saved but the Host configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * L13: the whole `resourceCaps` setting. `null` in a field means the default.
   * The write is validated, persisted and pushed exactly like `automation/save`;
   * the effective byte/count values go to the Host holder, never into a runtime
   * configuration version.
   */
  async function saveResourceCapsRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input)) return invalid('resource-caps/save requires an object body');
    if (!('memoryMaxMiB' in input) || !('tasksMax' in input)) {
      return invalid('resource-caps/save requires both memoryMaxMiB and tasksMax');
    }
    const memoryMaxMiB = input['memoryMaxMiB'];
    if (memoryMaxMiB !== null && (typeof memoryMaxMiB !== 'number' || !Number.isSafeInteger(memoryMaxMiB)
      || memoryMaxMiB < RESOURCE_CAP_MIN_MEMORY_MIB || memoryMaxMiB > memoryUpperMiB)) {
      return invalid(`memoryMaxMiB must be null or an integer from ${String(RESOURCE_CAP_MIN_MEMORY_MIB)} to ${String(memoryUpperMiB)}`);
    }
    const tasksMax = input['tasksMax'];
    if (tasksMax !== null && (typeof tasksMax !== 'number' || !Number.isSafeInteger(tasksMax)
      || tasksMax < RESOURCE_CAP_MIN_TASKS || tasksMax > RESOURCE_CAP_MAX_TASKS)) {
      return invalid(`tasksMax must be null or an integer from ${String(RESOURCE_CAP_MIN_TASKS)} to ${String(RESOURCE_CAP_MAX_TASKS)}`);
    }
    const previous = resourceCapSetting;
    const next: SaveResourceCapSettings = { memoryMaxMiB, tasksMax };
    resourceCapSetting = { schemaVersion: 1, ...next };
    try { await persist(); }
    catch {
      resourceCapSetting = previous;
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the resource caps were saved but the Host configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * `run-budget/save`: the Work Run token budget. `null` removes the stored key
   * and restores the default. The write is validated, persisted and pushed
   * exactly like `resource-caps/save`; the Host re-registers the trusted Workflow
   * bindings from the effective value, so the next Work Run uses it without a
   * restart while an already claimed Run keeps its old budget.
   */
  async function saveRunBudgetRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input)) return invalid('run-budget/save requires an object body');
    const value = input['workRunTokenBudget'];
    let next: number | undefined;
    if (value !== null) {
      try { next = parseStoredWorkRunTokenBudget(value); }
      catch { return invalid(`workRunTokenBudget must be null or an integer from 1 to ${String(MAX_WORK_RUN_TOKEN_BUDGET)}`); }
    }
    const previous = workRunTokenBudget;
    workRunTokenBudget = next;
    try { await persist(); }
    catch {
      workRunTokenBudget = previous;
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the work run token budget was saved but the Host configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * SHT-2 (121-112): the project review line. `null` removes the stored key and restores
   * `DEFAULT_COMMAND_REVIEW_LINE_MINUTES`; any other value is a positive safe integer of minutes with no upper bound.
   * The write is validated, persisted and pushed exactly like `run-budget/save`; the Host installs the effective value
   * at once, and a command already over the old line is not re-noticed.
   */
  async function saveCommandReviewLineRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input)) return invalid('command-review/save requires an object body');
    const value = input['commandReviewLineMinutes'];
    let next: number | undefined;
    if (value !== null) {
      if (!isPos(value)) return invalid('commandReviewLineMinutes must be null or a positive integer');
      next = value;
    }
    const previous = commandReviewLineSetting;
    commandReviewLineSetting = next;
    try { await persist(); }
    catch {
      commandReviewLineSetting = previous;
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the command review line was saved but the Host configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * PL/§10.3: the whole `planLoopLimits` setting. `null` removes the stored key
   * and restores `DEFAULT_PLAN_LOOP_LIMITS`. The write is validated, persisted
   * and pushed exactly like `run-budget/save`; a present but invalid table is
   * refused as it stands, never filled from the defaults or migrated.
   */
  async function savePlanLoopLimitsRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input) || !('planLoopLimits' in input)) {
      return invalid('plan-loop-limits/save requires a planLoopLimits value');
    }
    const value = input['planLoopLimits'];
    let next: PlanLoopLimitsV1 | undefined;
    if (value !== null) {
      const limits = planLoopLimitsOf(value);
      if (limits === null) {
        return invalid('planLoopLimits must be null or one complete schema-1 table with both four-tier tables, '
          + 'positive safe integers, each two-times line at or above its reminder line and a multiplier of at least 1');
      }
      next = limits;
    }
    const previous = planLoopLimitSetting;
    planLoopLimitSetting = next;
    try { await persist(); }
    catch {
      planLoopLimitSetting = previous;
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the plan loop limits were saved but the Host configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * KLS-2: "architecture and notes stay local, not in git" for the checkout behind one workspace.
   * The Host finds the checkout through its one line resolution, never from the body; a folder in no git work tree
   * has no such choice. Git's local exclude file is changed first, and only then the per-checkout setting is saved,
   * persisted and pushed to the Host like `automation/save`. When the settings file cannot be written, the exclude
   * file goes back to the state it had before this call, so the two never disagree; a retry starts from there.
   */
  async function knowledgeLocalRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input) || !nonEmpty(input['projectId']) || !nonEmpty(input['workspaceId']))
      return invalid('knowledge-local requires a projectId and a workspaceId');
    const localOnly = input['localOnly'];
    if (typeof localOnly !== 'boolean') return invalid('localOnly must be a boolean');
    if (assembly.knowledgeCheckout === undefined)
      return { status: 'rejected', code: 'unsupported', reason: 'the Host does not publish the checkout reader' };
    const scope = { projectId: input['projectId'], workspaceId: input['workspaceId'] };
    let checkout;
    try { checkout = await assembly.knowledgeCheckout(scope); }
    catch { return unavailable('the checkout of the workspace could not be read'); }
    if (checkout.status !== 'ready') return checkout;
    if ('notGit' in checkout.value)
      return { status: 'rejected', code: 'unsupported', reason: 'the checkout is not a git repository' };
    // The repository key is the real common git directory, which holds the local exclude file.
    const repoKey = checkout.value.repoKey;
    const excluded = await applyKnowledgeExclude(repoKey, localOnly);
    if (excluded.status !== 'ready') return unavailable(excluded.reason);
    const previous = knowledgeLocalOnly[repoKey];
    if (localOnly) knowledgeLocalOnly[repoKey] = true; else delete knowledgeLocalOnly[repoKey];
    try { await persist(); }
    catch {
      if (previous === undefined) delete knowledgeLocalOnly[repoKey]; else knowledgeLocalOnly[repoKey] = previous;
      // Only a call that changed the exclude file has something to undo; the file's state before it was the opposite.
      const restored = excluded.value.changed ? await applyKnowledgeExclude(repoKey, !localOnly) : excluded;
      if (restored.status !== 'ready') {
        return unavailable(`the settings file could not be written, and the exclude file could not be restored: ${restored.reason}`);
      }
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the setting was saved but the Host configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * 121-106 item 5, 121-109: save one project's two structural switches (`null` goes back to the factory default),
   * persisted and pushed to the Host like `automation/save`. The Host reads them when a proposal freezes or a note is
   * written or staged; a card already waiting stays a card (62-6).
   */
  async function structuralApprovalRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input) || !nonEmpty(input['projectId']) || !('value' in input))
      return invalid('structural-approval/save requires a projectId and a value');
    const value = input['value'] === null ? null : structuralApprovalOf(input['value']);
    if (input['value'] !== null && value === null)
      return invalid("value must be null or { proposals, repairs }, each 'auto' or 'ask'");
    return await saveProjectEntry(structuralApproval, input['projectId'], value);
  }

  /**
   * DESIGN §1.9 (Q20): save one project's default reply deadline in whole minutes, at most one year (`null` goes back to
   * the factory 24 hours), persisted and pushed to the Host like `structural-approval/save`. That project's next
   * reply-asking send that names no deadline reads it; a message already sent keeps the deadline frozen at its send.
   */
  async function replyDeadlineRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input) || !nonEmpty(input['projectId']) || !('minutes' in input))
      return invalid('reply-deadline/save requires a projectId and minutes');
    const minutes = input['minutes'];
    if (minutes !== null && !isReplyDeadlineMinutes(minutes))
      return invalid(`minutes must be null or a whole number from 1 to ${MAX_REPLY_DEADLINE_MINUTES}`);
    return await saveProjectEntry(replyDeadlineMinutes, input['projectId'], minutes);
  }

  /**
   * One project's entry of a per-project setting table (`null` removes it), persisted and pushed to the Host. The
   * setting belongs to a project this Host has open, so a mistyped id is refused rather than shown as saved; a failed
   * write restores the entry.
   */
  async function saveProjectEntry<T>(
    table: Record<string, T>, projectId: string, value: T | null,
  ): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!assembly.listWorkspaces().some(workspace => workspace.scope.projectId === projectId))
      return notFound('the project is not open on this Host');
    const previous = table[projectId];
    if (value === null) delete table[projectId]; else table[projectId] = value;
    try { await persist(); }
    catch {
      if (previous === undefined) delete table[projectId]; else table[projectId] = previous;
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch {
      return unavailable('the setting was saved but the Host configuration was not confirmed; retry the same save');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  /**
   * 121-106: switch one registered workspace's write and command access in place. The Host changes the two values it
   * already publishes, so the person's very next save/command reads them and an agent's next preparation does too; an
   * already prepared Run keeps the version it pinned. A write failure puts both the stored descriptor and the Host
   * back, so the two never disagree.
   */
  async function workspaceAccessRoute(input: unknown): Promise<SettingsResponse<SettingsRoutes['workspaces/access']['value']>> {
    if (!isRecord(input) || !validScope(input['scope'])) return invalid('workspaces/access requires a complete project/workspace scope');
    const problem = accessProblem(input);
    if (problem !== null) return invalid(problem);
    if (assembly.setWorkspaceAccess === undefined)
      return { status: 'rejected', code: 'unsupported', reason: 'the Host does not publish the workspace access switch' };
    const scope = { projectId: input['scope'].projectId, workspaceId: input['scope'].workspaceId };
    const changed = assembly.setWorkspaceAccess(scope,
      { writeAllowed: input['writeAllowed'] as boolean, commandsAllowed: input['commandsAllowed'] as boolean });
    if (changed.status !== 'ready') return changed;
    const listed = [...workspaces];
    const undoHidden = listDescriptor(assembly.listWorkspaces().find(w => scopeKey(w.scope) === scopeKey(scope))!);  // just switched: registered
    try { await persist(); }
    catch {
      workspaces.splice(0, workspaces.length, ...listed);
      undoHidden();
      assembly.setWorkspaceAccess(scope, changed.value);            // the Host goes back to the values it had
      return unavailable('the settings file could not be written');
    }
    try { await notify(); }
    catch { return unavailable('the workspace access was saved but the Host configuration was not confirmed; retry the same save'); }
    return { status: 'ready', value: { settings: snapshotOf(), bootstrap: assembly.bootstrap() } };
  }

  /**
   * 7D2 WD: the two settings routes over the Host's one withdraw/remove owner. Both first prove the descriptor is in
   * this Host, then let the assembly commit through the core before the save temporarily drops the descriptor and the
   * scope's model selection, persists and notifies. A failed save restores both in memory and keeps the mount, so the
   * same-session retry still reaches the core's `removedAt` branch (WD-21, WD-28).
   */
  async function workspaceRemovalRoute(kind: WorkspaceRemovalKindV1, input: unknown):
    Promise<SettingsResponse<SettingsRoutes['workspaces/withdraw']['value']>> {
    if (!isRecord(input) || !validScope(input['scope'])) {
      return invalid(`workspaces/${kind} requires a complete project/workspace scope`);
    }
    const scope = { projectId: input['scope'].projectId, workspaceId: input['scope'].workspaceId };
    if (!workspaces.some(entry => scopeKey(entry.scope) === scopeKey(scope))) {
      return notFound('the workspace is not open in this Host');
    }
    if (assembly.removeWorkspace === undefined) {
      return { status: 'rejected', code: 'unsupported',
        reason: 'the Host does not publish workspace withdrawal and removal' };
    }
    const save = async (): Promise<void> => {
      const key = scopeKey(scope);
      const index = workspaces.findIndex(entry => scopeKey(entry.scope) === key);
      const descriptor = workspaces[index]!;
      const previousSelection = selection[key];
      workspaces.splice(index, 1);
      delete selection[key];
      const restore = (): void => {
        workspaces.splice(index, 0, descriptor);
        if (previousSelection !== undefined) selection[key] = previousSelection;
      };
      try { await persist(); }
      catch (error) {
        restore();
        throw new Error(`the settings file could not be written: ${error instanceof Error ? error.message : String(error)}`);
      }
      try { await notify(); }
      catch (error) {
        restore();
        throw new Error('the workspace was saved but the Host configuration was not confirmed: '
          + `${error instanceof Error ? error.message : String(error)}; retry the same request`);
      }
    };
    const removed = await assembly.removeWorkspace(scope, kind, save);
    if (removed.status !== 'ready') return removed;
    return { status: 'ready', value: { settings: snapshotOf(), bootstrap: assembly.bootstrap() } };
  }

  /**
   * R-M6: drop a project whose folder is gone from the settings list. Only a project with at least one missing
   * workspace folder may go; the list is written before the Host hides the project, so a failed write changes
   * nothing. Disk contents, lines and notifications are never touched. A project whose runtime is still open keeps
   * its descriptions as this Host's runtime configuration source; a closed project drops them with the registration.
   */
  async function forgetProjectRoute(input: unknown): Promise<SettingsResponse<HostSettingsSnapshot>> {
    if (!isRecord(input) || !nonEmpty(input['projectId'])) return invalid('projects/forget requires a projectId');
    const projectId = input['projectId'];
    const projectWorkspaces = assembly.listWorkspaces()
      .filter(workspace => workspace.scope.projectId === projectId);
    if (projectWorkspaces.length === 0) return notFound('the project is not open on this Host');
    if (!projectWorkspaces.some(workspace => !workspace.folderPresent))
      return invalid('this project has no missing folder');
    const projectOpen = projectWorkspaces.some(workspace => workspace.projectOpen);
    const previous = [...workspaces];
    workspaces.splice(0, workspaces.length, ...previous.filter(entry => entry.scope.projectId !== projectId));
    try { await persist(); }
    catch {
      workspaces.splice(0, workspaces.length, ...previous);
      return unavailable('the settings file could not be written');
    }
    if (projectOpen) {
      hiddenWorkspaceDescriptions.push(...previous.filter(entry => entry.scope.projectId === projectId));
    }
    assembly.forgetProject(projectId);
    try { await notify(); }
    catch {
      return unavailable('the project was forgotten but the Host configuration was not confirmed');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  // -------------------------------------------------------------------------
  // Prompt-pack editing routes. They read the disk tree at
  // `<settings directory>/prompts`, validate the whole resulting chain before
  // writing and replace `pack.json` atomically, so a failed save leaves the
  // visible version unchanged.
  // -------------------------------------------------------------------------

  const forbidden = (reason: string): SettingsResponse<never> => ({ status: 'rejected', code: 'forbidden', reason });
  const revisionConflict = (reason: string): SettingsResponse<never> =>
    ({ status: 'rejected', code: 'revision_conflict', reason });
  const invalidProblems = (reason: string, problems: readonly PromptPackProblemV1[]): SettingsResponse<never> =>
    ({ status: 'rejected', code: 'invalid', reason, problems });

  /** A request-shape rejection on a prompt route carries the same `problems`
   * contract as a broken pack, so the caller sees which request field failed. */
  const invalidRequest = (
    reason: string, packId?: unknown, templateId?: unknown, toolName?: string,
  ): SettingsResponse<never> => invalidProblems(reason, [{
    packId: typeof packId === 'string' ? packId : '',
    templateId: typeof templateId === 'string' ? templateId : null,
    ...(toolName === undefined ? {} : { toolName }),
    kind: 'file_problem',
    reason,
  }]);
  type ReadyPackRead = Extract<DiskPromptPackReadV1, { status: 'ready' }>;

  async function packForRoute(packId: unknown): Promise<
    { kind: 'ready'; read: ReadyPackRead } | { kind: 'rejected'; response: SettingsResponse<never> }
  > {
    if (typeof packId !== 'string' || !isPromptPackId(packId))
      return { kind: 'rejected', response: notFound('the prompt pack does not exist') };
    const read = await readDiskPromptPack(promptsRoot, packId);
    if (read.status === 'not_found') return { kind: 'rejected', response: notFound('the prompt pack does not exist') };
    if (read.status === 'unreadable') return { kind: 'rejected', response: unavailable(read.reason) };
    if (read.status === 'rejected')
      return { kind: 'rejected', response: invalidProblems('the prompt pack is invalid', read.problems) };
    return { kind: 'ready', read };
  }

  type SavePackRead = {
    chain: readonly PromptPackChainEntryV1[];
    directory: string | null;
    problems: readonly PromptPackProblemV1[];
  };

  /** Reads a pack for a save without requiring it to be valid as a whole: the
   * effective version or digest decides the conflict and the candidate pack is
   * validated after the replacement. A manifest that cannot be read cannot be
   * replaced, so that case stays an explicit rejection. */
  async function packChainForSave(packId: string): Promise<
    { kind: 'ready'; read: SavePackRead } | { kind: 'rejected'; response: SettingsResponse<never> }
  > {
    const read = await readDiskPromptPack(promptsRoot, packId);
    if (read.status === 'not_found') return { kind: 'rejected', response: notFound('the prompt pack does not exist') };
    if (read.status === 'unreadable') return { kind: 'rejected', response: unavailable(read.reason) };
    const problems = read.status === 'rejected' ? read.problems : [];
    if (read.chain.length === 0 || read.chain[0]?.packId !== packId)
      return { kind: 'rejected', response: invalidProblems('the prompt pack is invalid', problems) };
    const directory = await realpath(join(promptsRoot, packId)).catch(() => null);
    return { kind: 'ready', read: { chain: read.chain, directory, problems } };
  }

  /** Rewrites the requested pack's manifest once: callers mutate the parsed
   * object and return the file table that changed; only `chain[0]` is replaced. */
  function rewriteFirstManifest(
    chain: readonly PromptPackChainEntryV1[],
    mutate: (manifest: PromptPackManifestV1) => Partial<Pick<PromptPackChainEntryV1, 'templates' | 'tools'>>,
  ): PromptPackChainEntryV1[] {
    const first = chain[0]!;
    const manifest = JSON.parse(first.manifest.text) as PromptPackManifestV1;
    const files = mutate(manifest);
    return [
      { ...first, ...files, manifest: { file: 'pack.json', text: JSON.stringify(manifest) } },
      ...chain.slice(1),
    ];
  }

  function proposeTemplateChain(
    chain: readonly PromptPackChainEntryV1[], templateId: string,
    file: string, version: number, mentionsTools: readonly string[], text: string,
  ): PromptPackChainEntryV1[] {
    return rewriteFirstManifest(chain, manifest => {
      // Replace an entry only in an object table. A non-object original stays as
      // written, so the whole-pack validation reports it instead of this throwing.
      if (isRecord(manifest.templates))
        manifest.templates[templateId] = { file, version, mentionsTools: [...mentionsTools] };
      return { templates: { ...chain[0]!.templates, [templateId]: { file, text } } };
    });
  }

  function proposeToolChain(
    chain: readonly PromptPackChainEntryV1[], toolName: string, file: string, text: string,
  ): PromptPackChainEntryV1[] {
    return rewriteFirstManifest(chain, manifest => {
      // The same rule as a template: keep a non-object table for validation.
      if (isRecord(manifest.tools)) manifest.tools[toolName] = file;
      return { tools: { ...chain[0]!.tools, [toolName]: { file, text } } };
    });
  }

  /** Removes this pack's own declaration; a parent may still declare the
   * template. Only the version this restore removed is remembered; the next
   * save starts above both that number and the current declaration, skipping
   * every old file still on disk. */
  function removeTemplateFromChain(
    chain: readonly PromptPackChainEntryV1[], templateId: string, version: number,
  ): PromptPackChainEntryV1[] {
    return rewriteFirstManifest(chain, manifest => {
      if (isRecord(manifest.templates)) delete manifest.templates[templateId];
      const restored = manifest.restoredVersions ?? {};
      restored[templateId] = [version];
      manifest.restoredVersions = restored;
      const templates = { ...chain[0]!.templates };
      delete templates[templateId];
      return { templates };
    });
  }

  /** The version the last restore removed for this template, if any. */
  function restoredVersionOf(
    chain: readonly PromptPackChainEntryV1[], templateId: string,
  ): number | null {
    // The chain came from a successful save read, so its first manifest parsed.
    const manifest = JSON.parse(chain[0]!.manifest.text) as PromptPackManifestV1;
    const versions = manifest.restoredVersions?.[templateId];
    const version = Array.isArray(versions) ? versions[0] : undefined;
    return typeof version === 'number' && Number.isSafeInteger(version) ? version : null;
  }

  /** Drops the freed-version record once a save has moved past it. */
  function dropRestoredVersion(
    chain: readonly PromptPackChainEntryV1[], templateId: string,
  ): PromptPackChainEntryV1[] {
    return rewriteFirstManifest(chain, manifest => {
      if (isRecord(manifest.restoredVersions)) delete manifest.restoredVersions[templateId];
      return {};
    });
  }

  /** Temp file and rename: a failure before the rename leaves the old manifest. */
  async function replacePackManifest(directory: string, chain: readonly PromptPackChainEntryV1[]): Promise<void> {
    const manifest = chain[0]!.manifest;
    const temporary = join(directory, `.pack.${randomUUID()}.tmp`);
    await writeFile(temporary, manifest.text, 'utf8');
    try { await rename(temporary, join(directory, 'pack.json')); }
    catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async function packsListRoute(): Promise<SettingsResponse<PromptPackListV1>> {
    try {
      return { status: 'ready', value: { packs: await listDiskPromptPacks(promptsRoot) } };
    } catch {
      return unavailable('the prompt packs could not be read');
    }
  }

  async function packsCreateRoute(input: unknown): Promise<SettingsResponse<PromptPackCreateV1>> {
    if (!isRecord(input)) return invalidRequest('prompts/packs/create requires an object body');
    const packId = input['packId'];
    if (packId === 'platform') return forbidden('the platform prompt pack cannot be created');
    if (typeof packId !== 'string' || !isPromptPackId(packId))
      return invalidRequest('packId must be a pack id', packId);
    const created = await createDiskPromptPack(promptsRoot, packId);
    if (created.status === 'exists') return invalid('the prompt pack already exists');
    if (created.status === 'unavailable') return unavailable(created.reason);
    return { status: 'ready', value: { packId, extends: 'platform', templates: [], strings: {}, tools: {} } };
  }

  async function templateReadRoute(input: unknown): Promise<SettingsResponse<PromptTemplateReadV1>> {
    if (!isRecord(input)) return invalidRequest('prompts/templates/read requires an object body');
    const read = await packForRoute(input['packId']);
    if (read.kind === 'rejected') return read.response;
    const templateId = input['templateId'];
    if (typeof templateId !== 'string' || !Object.hasOwn(TEMPLATE_SLOTS, templateId))
      return notFound('the prompt template does not exist');
    const text = read.read.value.templates[templateId];
    const origin = read.read.value.origins[templateId];
    if (text === undefined || origin === undefined) return notFound('the prompt template does not exist');
    return { status: 'ready', value: {
      templateId, version: origin.version, fromPack: origin.packId, text,
      slots: TEMPLATE_SLOTS[templateId]!, mentionsTools: [...origin.mentionsTools],
    } };
  }

  async function templateSaveRoute(input: unknown): Promise<SettingsResponse<PromptTemplateReadV1>> {
    if (!isRecord(input)) return invalidRequest('prompts/templates/save requires an object body');
    const packId = input['packId'];
    // The platform pack is forbidden before anything else.
    if (packId === 'platform') return forbidden('the platform prompt pack cannot be saved');
    if (typeof packId !== 'string' || !isPromptPackId(packId))
      return notFound('the prompt pack does not exist');
    const templateId = input['templateId'];
    if (typeof templateId !== 'string' || !Object.hasOwn(TEMPLATE_SLOTS, templateId))
      return notFound('the prompt template does not exist');
    const expectedVersion = input['expectedVersion'];
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion))
      return invalidRequest('expectedVersion must be an integer', packId, templateId);
    const read = await packChainForSave(packId);
    if (read.kind === 'rejected') return read.response;
    // The effective version is the nearest declaration's, so an old body that
    // breaks the pack does not block saving a valid replacement. The conflict
    // is compared before the request text is checked.
    const effectiveVersion = effectiveTemplateVersionOf(read.read.chain, templateId);
    if (effectiveVersion === null) {
      return invalidProblems('the prompt pack is invalid', read.read.problems.length > 0 ? read.read.problems
        : [{ packId, templateId, kind: 'file_problem', reason: 'the template has no declared version' }]);
    }
    if (expectedVersion !== effectiveVersion)
      return revisionConflict('the prompt template version changed since it was read');
    const text = input['text'];
    if (typeof text !== 'string') return invalidRequest('text must be a string', packId, templateId);
    const mentionsTools = input['mentionsTools'];
    if (!Array.isArray(mentionsTools) || !mentionsTools.every(value => typeof value === 'string'))
      return invalidRequest('mentionsTools must be a string array', packId, templateId);
    const directory = read.read.directory;
    if (directory === null) return unavailable('the prompt pack has no directory');
    let newVersion = effectiveVersion + 1;
    const restoredFrom = restoredVersionOf(read.read.chain, templateId);
    if (restoredFrom !== null) {
      // A restore removed this pack's declaration but kept the old files. The
      // next save starts above both the current declaration (a parent may have
      // moved on since the restore) and the removed version, then skips every
      // number an old file occupies. A missing templates directory has none.
      let names: string[] = [];
      try { names = await readdir(join(directory, 'templates')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          return unavailable('the prompt templates could not be read');
      }
      const taken = new Set<number>();
      for (const name of names) {
        if (!name.startsWith(`${templateId}@`) || !name.endsWith('.txt')) continue;
        const number = Number(name.slice(templateId.length + 1, -4));
        if (Number.isSafeInteger(number)) taken.add(number);
      }
      newVersion = Math.max(effectiveVersion + 1, restoredFrom + 1);
      while (taken.has(newVersion)) newVersion += 1;
    }
    let file = `templates/${templateId}@${String(newVersion)}.txt`;
    let chain = proposeTemplateChain(read.read.chain, templateId, file, newVersion, mentionsTools, text);
    // A successful manifest write clears the record; a failed one keeps it, so
    // the next attempt still starts above both versions.
    if (restoredFrom !== null) chain = dropRestoredVersion(chain, templateId);
    const unsafeTarget = (reason: string): SettingsResponse<never> =>
      invalidProblems('the prompt pack has an unsafe save target',
        [{ packId, templateId, kind: 'file_problem', reason }]);
    const validation = resolvePromptPackV1(chain);
    if (validation.status === 'rejected')
      return invalidProblems('the prompt pack would be invalid', validation.problems);
    const target = await preparePackWriteTarget(promptsRoot, directory, file, text);
    if (target.status === 'rejected') return unsafeTarget(target.reason);
    // An unmarked collision still refuses and leaves every old file untouched.
    if (target.status === 'collision') return unavailable(target.reason);
    try {
      if (target.status === 'create') await writeFile(target.target, text, { encoding: 'utf8', flag: 'wx' });
      await replacePackManifest(directory, chain);
    } catch {
      return unavailable('the prompt pack could not be written');
    }
    return { status: 'ready', value: {
      templateId, version: newVersion, fromPack: packId, text,
      slots: TEMPLATE_SLOTS[templateId]!, mentionsTools: [...mentionsTools],
    } };
  }

  async function templateRestoreRoute(input: unknown): Promise<SettingsResponse<PromptTemplateReadV1>> {
    if (!isRecord(input)) return invalidRequest('prompts/templates/restore requires an object body');
    const packId = input['packId'];
    // The platform pack is read-only, the same as a save.
    if (packId === 'platform') return forbidden('the platform prompt pack cannot be restored');
    if (typeof packId !== 'string' || !isPromptPackId(packId))
      return notFound('the prompt pack does not exist');
    const templateId = input['templateId'];
    if (typeof templateId !== 'string' || !Object.hasOwn(TEMPLATE_SLOTS, templateId))
      return notFound('the prompt template does not exist');
    const expectedVersion = input['expectedVersion'];
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion))
      return invalidRequest('expectedVersion must be an integer', packId, templateId);
    const read = await packChainForSave(packId);
    if (read.kind === 'rejected') return read.response;
    // Only this pack's own declaration can be removed; an inherited one is not
    // this pack's to restore, and recording its version would free a number this
    // pack never released.
    const ownManifest = JSON.parse(read.read.chain[0]!.manifest.text) as PromptPackManifestV1;
    if (!isRecord(ownManifest.templates) || !Object.hasOwn(ownManifest.templates, templateId))
      return notFound('the prompt pack does not declare this template');
    const effectiveVersion = effectiveTemplateVersionOf(read.read.chain, templateId);
    if (expectedVersion !== effectiveVersion)
      return revisionConflict('the prompt template version changed since it was read');
    // Drop only this pack's own declaration and its file table; the nearest
    // remaining declaration (a custom parent, never necessarily the platform)
    // becomes the effective one.
    const chain = removeTemplateFromChain(read.read.chain, templateId, effectiveVersion);
    const validation = resolvePromptPackV1(chain);
    if (validation.status === 'rejected')
      return invalidProblems('the prompt pack would be invalid', validation.problems);
    const directory = read.read.directory;
    if (directory === null) return unavailable('the prompt pack has no directory');
    try { await replacePackManifest(directory, chain); }
    catch { return unavailable('the prompt pack could not be written'); }
    const origin = validation.value.origins[templateId];
    if (origin === undefined) return notFound('the prompt template does not exist');
    return { status: 'ready', value: {
      templateId, version: origin.version, fromPack: origin.packId,
      text: validation.value.templates[templateId]!, slots: TEMPLATE_SLOTS[templateId]!,
      mentionsTools: [...origin.mentionsTools],
    } };
  }

  async function toolReadRoute(input: unknown): Promise<SettingsResponse<PromptToolReadV1>> {
    if (!isRecord(input)) return invalidRequest('prompts/tools/read requires an object body');
    const read = await packForRoute(input['packId']);
    if (read.kind === 'rejected') return read.response;
    const toolName = input['toolName'];
    if (typeof toolName !== 'string' || !Object.hasOwn(read.read.value.tools, toolName))
      return notFound('the prompt tool does not exist');
    const entry = read.read.value.tools[toolName];
    const fromPack = read.read.value.toolOrigins[toolName];
    if (entry === undefined || fromPack === undefined) return notFound('the prompt tool does not exist');
    return { status: 'ready', value: { toolName, fromPack, entry, digest: promptToolTextDigest(entry) } };
  }

  async function toolSaveRoute(input: unknown): Promise<SettingsResponse<PromptToolReadV1>> {
    if (!isRecord(input)) return invalidRequest('prompts/tools/save requires an object body');
    const packId = input['packId'];
    if (packId === 'platform') return forbidden('the platform prompt pack cannot be saved');
    if (typeof packId !== 'string' || !isPromptPackId(packId))
      return notFound('the prompt pack does not exist');
    const toolName = input['toolName'];
    if (typeof toolName !== 'string') return notFound('the prompt tool does not exist');
    const read = await packChainForSave(packId);
    if (read.kind === 'rejected') return read.response;
    // The same save order as a template: the nearest declaration's digest
    // decides the conflict before the request entry is checked.
    const effective = effectiveToolTextOf(read.read.chain, toolName);
    if (effective.status === 'missing') return notFound('the prompt tool does not exist');
    if (effective.status === 'unreadable') {
      return invalidProblems('the prompt pack is invalid', read.read.problems.length > 0 ? read.read.problems
        : [{ packId, templateId: null, toolName, kind: 'file_problem',
            reason: `tool "${toolName}" text could not be read` }]);
    }
    const expectedDigest = input['expectedDigest'];
    if (typeof expectedDigest !== 'string')
      return invalidRequest('expectedDigest must be a string', packId, null, toolName);
    if (expectedDigest !== promptToolTextDigest(effective.entry))
      return revisionConflict('the prompt tool text changed since it was read');
    const rawEntry = input['entry'];
    if (!isRecord(rawEntry)) return invalidRequest('entry must be an object', packId, null, toolName);
    const description = rawEntry['description'];
    const parameters = rawEntry['parameters'];
    if (typeof description !== 'string' || !isRecord(parameters)
      || !Object.values(parameters).every(value => typeof value === 'string')) {
      return invalidRequest('entry must carry a description and named string parameters', packId, null, toolName);
    }
    const entry: ToolTextV1 = {
      description,
      parameters: { ...parameters as Record<string, string> },
    };
    const digest = promptToolTextDigest(entry);
    const body = canonicalToolTextBody(entry);
    const file = `tools/${toolName}@${digest.slice(0, 16)}.json`;
    const chain = proposeToolChain(read.read.chain, toolName, file, body);
    const validation = resolvePromptPackV1(chain);
    if (validation.status === 'rejected')
      return invalidProblems('the prompt pack would be invalid', validation.problems);
    const directory = read.read.directory;
    if (directory === null) return unavailable('the prompt pack has no directory');
    const target = await preparePackWriteTarget(promptsRoot, directory, file, body);
    if (target.status === 'rejected')
      return invalidProblems('the prompt pack has an unsafe save target',
        [{ packId: packId, templateId: null, toolName, kind: 'file_problem', reason: target.reason }]);
    if (target.status === 'collision') return unavailable(target.reason);
    try {
      if (target.status === 'create') await writeFile(target.target, body, { encoding: 'utf8', flag: 'wx' });
      await replacePackManifest(directory, chain);
    } catch {
      return unavailable('the prompt pack could not be written');
    }
    return { status: 'ready', value: { toolName, fromPack: packId, entry, digest } };
  }

  const dispatch = async (route: SettingsRoute, input: unknown): Promise<SettingsResponse<unknown>> => {
    switch (route) {
      case 'snapshot': return { status: 'ready', value: snapshotOf() };
      case 'directories': return await directoriesRoute(input);
      case 'models/save': return await saveModelRoute(input);
      case 'models/select': return await selectModelRoute(input);
      case 'workspaces/open': return await openWorkspaceRoute(input);
      case 'workspaces/access': return await workspaceAccessRoute(input);
      case 'workspaces/withdraw': return await workspaceRemovalRoute('withdraw', input);
      case 'workspaces/remove': return await workspaceRemovalRoute('remove', input);
      case 'projects/forget': return await forgetProjectRoute(input);
      case 'checks/approve': return await approveChecksRoute(input);
      case 'checks/withdraw': return await withdrawCheckRoute(input);
      case 'automation/save': return await saveAutomationRoute(input);
      case 'resource-caps/save': return await saveResourceCapsRoute(input);
      case 'run-budget/save': return await saveRunBudgetRoute(input);
      case 'command-review/save': return await saveCommandReviewLineRoute(input);
      case 'plan-loop-limits/save': return await savePlanLoopLimitsRoute(input);
      case 'knowledge-local': return await knowledgeLocalRoute(input);
      case 'structural-approval/save': return await structuralApprovalRoute(input);
      case 'reply-deadline/save': return await replyDeadlineRoute(input);
      case 'prompts/packs/list': return await packsListRoute();
      case 'prompts/packs/create': return await packsCreateRoute(input);
      case 'prompts/templates/read': return await templateReadRoute(input);
      case 'prompts/templates/save': return await templateSaveRoute(input);
      case 'prompts/templates/restore': return await templateRestoreRoute(input);
      case 'prompts/tools/read': return await toolReadRoute(input);
      case 'prompts/tools/save': return await toolSaveRoute(input);
    }
  };

  return {
    call: async <K extends SettingsRoute>(
      route: K,
      input: SettingsRoutes[K]['input'],
    ): Promise<SettingsResponse<SettingsRoutes[K]['value']>> => {
      return await serialize(() => dispatch(route, input)) as SettingsResponse<SettingsRoutes[K]['value']>;
    },
    applyChecksForAdoption: (ctx, input) => serialize(() => applyChecksForAdoption(ctx, input)),
    adoptWithPlanChecks,
    readSavedChecks,
    confirmInstalledChecks,
    runExclusive: <T>(operation: () => Promise<T>): Promise<T> => serialize(operation),
  };
}
