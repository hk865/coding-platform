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
import type { RegisteredCommandCheck, TrustedCheckConfiguration } from '../contracts/verification.js';
import type {
  ChecksConfigurationPinV1, ChecksConfirmationV1, ChecksSaveResultV1, ChecksSettingsSourceV1,
} from '../contracts/initialization-adoption.js';
import { rejected } from '../contracts/core/rejections.js';
import type { CoreError, ReadResult } from '../contracts/core/results.js';
import type {
  ChecksConfirmationPort, StoredChecksStateV1,
} from '../core/work-graph/model/initialization-adoption-contracts.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, MAX_AUTO_REWORK_LIMIT, type TaskAutomationPolicyV1,
} from '../contracts/task-requeue.js';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import { isNonNeg, isRecord, isSha256Hex, nonEmpty } from '../contracts/validation/common.js';
import {
  checksConfigurationPinProblem,
} from '../contracts/validation/initialization-adoption.js';
import type { PromptPackChainEntryV1, PromptPackManifestV1, PromptPackProblemV1, ToolTextV1 } from '../contracts/prompts/prompt-pack.js';
import { resolvePromptPackV1 } from '../contracts/prompts/resolve-pack.js';
import { canonicalToolTextBody, promptToolTextDigest } from '../contracts/prompts/prompt-set.js';
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
import type { BootstrapResponse, CoreScope } from './core-http-types.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type {
  QueryRuntimeConfigurationInput,
  RuntimeConfigurationInput,
  RuntimeHostBindings,
} from '../core/agent-runtime/execution-contracts.js';
import type { WorkbenchRuntimeProviderDependencies } from './runtime-configuration.js';
import type {
  ChecksAdoptionEntryPort,
  DirectoryListing,
  HostSettingsPort,
  HostSettingsSnapshot,
  OpenSettingsWorkspace,
  SaveResourceCapSettings,
  SettingsModel,
  SettingsProvider,
  SettingsResourceCaps,
  SettingsResponse,
  SettingsRoute,
  SettingsRoutes,
  PromptPackCreateV1,
  PromptPackListV1,
  PromptTemplateReadV1,
  PromptToolReadV1,
} from './host-settings-types.js';

/** The published settings route set. `SettingsRoutes` stays the type truth. */
export const SETTINGS_ROUTE_SUFFIXES = [
  'snapshot', 'directories', 'models/save', 'models/select', 'workspaces/open', 'checks/approve', 'automation/save',
  'resource-caps/save', 'prompts/packs/list', 'prompts/packs/create', 'prompts/templates/read',
  'prompts/templates/save', 'prompts/tools/read', 'prompts/tools/save',
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
  reasoningReplay?: 'current_run' | 'none';
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
  reasoningReplay?: 'current_run' | 'none';
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
  /** C8 automatic-rework policy as stored, or the defaults (3 / true) when the
   * file has none. The Host installs it from A.2 step 5.6 on; `automation/save`
   * (5.8) changes it at runtime. */
  automation: TaskAutomationPolicyV1;
  /** L13: the effective resource-cap values in bytes and task count. The Host
   * installs them into its holder from `resourceCaps/save`; they never enter the
   * runtime configuration version. */
  resourceCaps: { memoryMaxBytes: number; tasksMax: number };
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
    source: ChecksSettingsSourceV1;
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
  /** The Host's own start-up directory check for a restored workspace root. It
   * throws a configuration error naming both paths, so a restored root that
   * covers the prompt directory never reaches the restore loop. */
  assertWorkspaceRoot?: (root: string) => Promise<void>;
  models?: HostSettingsModelDefinition[];
  /** Trusted startup selection projected from the Host runtime configuration.
   * Used only when no private file exists yet; an explicit user selection later
   * overwrites it. */
  seedSelection?: Readonly<Record<string, string | null>>;
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
};
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
};

const scopeKey = (scope: CoreScope): string => `${scope.projectId}\u0000${scope.workspaceId}`;

function validScope(value: unknown): value is CoreScope {
  return isRecord(value) && nonEmpty(value['projectId']) && nonEmpty(value['workspaceId']);
}

function validRegisteredCheck(value: unknown): value is RegisteredCommandCheck {
  return isRecord(value) && nonEmpty(value['checkId'])
    && (value['kind'] === 'static' || value['kind'] === 'dynamic')
    && nonEmpty(value['command']) && typeof value['cwd'] === 'string'
    && typeof value['timeoutMs'] === 'number' && Number.isSafeInteger(value['timeoutMs']) && value['timeoutMs'] > 0
    && (value['taskIds'] === 'all'
      || (Array.isArray(value['taskIds']) && value['taskIds'].every(nonEmpty)));
}

function parseStoredChecks(value: unknown): RegisteredCommandCheck[] {
  if (!Array.isArray(value) || !value.every(validRegisteredCheck)) {
    throw new Error('the private host settings file is invalid');
  }
  return value.map(check => structuredClone(check));
}

function parseStoredChecksSource(value: unknown): { answerRef: QueryJobAnswerRef; answerDigest: string } {
  if (!isRecord(value) || !isRecord(value['answerRef']) || !nonEmpty(value['answerDigest'])) {
    throw new Error('the private host settings file is invalid');
  }
  const ref = value['answerRef'];
  if (ref['aggregateType'] !== 'QueryJobAnswer' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['workspaceId'])
    || !nonEmpty(ref['queryJobId']) || !nonEmpty(ref['answerId'])) {
    throw new Error('the private host settings file is invalid');
  }
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
  if (!isRecord(value) || value['schemaVersion'] !== 1 || typeof value['resumeOnStartup'] !== 'boolean') {
    throw new Error('the private host settings file is invalid');
  }
  const limit = value['autoReworkLimit'];
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || limit > MAX_AUTO_REWORK_LIMIT) {
    throw new Error('the private host settings file is invalid');
  }
  return { schemaVersion: 1, autoReworkLimit: limit, resumeOnStartup: value['resumeOnStartup'] };
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
  if (value['reasoningReplay'] !== undefined
    && value['reasoningReplay'] !== 'current_run' && value['reasoningReplay'] !== 'none')
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
    };
  });
  return { schemaVersion: 1, models, selection, workspaces,
    ...(raw['automation'] === undefined ? {} : { automation: parseStoredAutomation(raw['automation']) }),
    ...(raw['resourceCaps'] === undefined ? {} : { resourceCaps: parseStoredResourceCaps(raw['resourceCaps']) }) };
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

export async function createHostSettings(
  options: HostSettingsOptions,
  callbacks: HostSettingsCallbacks,
): Promise<HostSettingsPort & ChecksAdoptionEntryPort> {
  const settingsDirectory = options.settingsDirectory;
  if (!nonEmpty(settingsDirectory)) throw new Error('host settings require an explicit persistent directory');
  const assembly = options.assembly;
  const filePath = join(settingsDirectory, 'host-settings.json');
  const promptsRoot = options.promptsRoot ?? join(settingsDirectory, 'prompts');

  let persisted: PersistedSettingsV1;
  try {
    persisted = parsePersisted(await readFile(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      persisted = {
        schemaVersion: 1,
        models: (options.models ?? []).map(toStoredModel),
        selection: { ...(options.seedSelection ?? {}) },
        workspaces: [],
      };
    } else {
      // A present-but-unreadable/corrupt file is an explicit startup failure,
      // never silently treated as an empty configuration.
      throw new Error('the private host settings file could not be loaded');
    }
  }

  const models: HostSettingsStoredModel[] = persisted.models;
  const selection: Record<string, string | null> = persisted.selection;
  const workspaces: PersistedWorkspaceV1[] = persisted.workspaces;
  /** Kept exactly as stored (absent stays absent) until `automation/save` writes it. */
  let automation: TaskAutomationPolicyV1 | undefined = persisted.automation;
  /** L13: kept exactly as stored (absent stays absent) until `resource-caps/save`. */
  let resourceCapSetting: ResourceCapSettingsV1 | undefined = persisted.resourceCaps;
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

  const privateSnapshot = (): HostSettingsPrivateSnapshot => ({
    models: structuredClone(models),
    selection: { ...selection },
    checks: workspaces
      .filter((workspace): workspace is PersistedWorkspaceV1 & { checks: RegisteredCommandCheck[];
        checksSource: { answerRef: QueryJobAnswerRef; answerDigest: string } } =>
        workspace.checks !== undefined && workspace.checksSource !== undefined)
      .map(workspace => ({ scope: { ...workspace.scope }, checks: structuredClone(workspace.checks),
        answerRef: structuredClone(workspace.checksSource.answerRef), answerDigest: workspace.checksSource.answerDigest,
        child: workspace.checksChild === undefined ? null : { ...workspace.checksChild },
        checksRevision: workspace.checksRevision ?? 0 })),
    automation: { ...(automation ?? DEFAULT_TASK_AUTOMATION_POLICY) },
    resourceCaps: {
      memoryMaxBytes: effectiveResourceCaps().memoryMaxMiB * MIB,
      tasksMax: effectiveResourceCaps().tasksMax,
    },
  });

  const persist = async (): Promise<void> => {
    const payload: PersistedSettingsV1 = { schemaVersion: 1, models, selection, workspaces,
      ...(automation === undefined ? {} : { automation }),
      ...(resourceCapSetting === undefined ? {} : { resourceCaps: resourceCapSetting }) };
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
   * One checks descriptor save: replaces or appends the workspace entry, persists
   * the whole file and restores the previous descriptor when the write fails. It
   * never notifies; each caller maps notification failure to its own result.
   */
  const saveChecksDescriptor = async (
    scope: CoreScope,
    facts: HostSettingsWorkspaceFacts,
    proposal: { answerRef: QueryJobAnswerRef; answerDigest: string; checks: RegisteredCommandCheck[] },
    checksRevision: number | ((previous: PersistedWorkspaceV1 | undefined) => number),
    child?: { commandId: string; identityKey: string; fingerprint: string },
  ): Promise<boolean> => {
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    const previous = index >= 0 ? workspaces[index] : undefined;
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
    };
    if (index >= 0) workspaces[index] = next; else workspaces.push(next);
    try { await persist(); return true; }
    catch {
      if (index >= 0 && previous !== undefined) workspaces[index] = previous; else workspaces.pop();
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
      credentialConfigured: (typeof model.apiKey === 'string' && model.apiKey.length > 0) || envConfigured,
      ...(model.thinking === undefined ? {} : { thinking: model.thinking }),
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
      ...(model.promptPack === undefined ? {} : { promptPack: model.promptPack }),
      ...(model.reasoningReplay === undefined ? {} : { reasoningReplay: model.reasoningReplay }),
    };
  };

  const snapshotOf = (): HostSettingsSnapshot => ({
    models: models.map(publicModel),
    workspaces: assembly.listWorkspaces().map(facts => {
      const persistedFacts = workspaces.find(entry => scopeKey(entry.scope) === scopeKey(facts.scope));
      return {
        scope: { projectId: facts.scope.projectId, workspaceId: facts.scope.workspaceId },
        name: facts.name,
        root: facts.root,
        modelId: selection[scopeKey(facts.scope)] ?? facts.modelId ?? null,
        writeAllowed: facts.writeAllowed,
        commandsAllowed: facts.commandsAllowed,
        ...(persistedFacts?.checks === undefined ? {} : { checks: structuredClone(persistedFacts.checks) }),
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
  });

  // Restore every persisted directory registration through the real owners
  // BEFORE the Host listens. A failed restore is an explicit startup failure.
  // Every restored root is checked against the prompt directory first, so a
  // covering root fails before any earlier entry's restore has run.
  if (options.assertWorkspaceRoot !== undefined) {
    for (const entry of workspaces) await options.assertWorkspaceRoot(entry.root);
  }
  for (const entry of workspaces) {
    const opened = await assembly.openWorkspace({
      path: entry.root, projectId: entry.scope.projectId, workspaceId: entry.scope.workspaceId,
      name: entry.name, writeAllowed: entry.writeAllowed, commandsAllowed: entry.commandsAllowed,
    });
    if (opened.status !== 'ready') throw new Error('a persisted host settings workspace could not be restored');
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
    if (input['reasoningReplay'] !== undefined
      && input['reasoningReplay'] !== 'current_run' && input['reasoningReplay'] !== 'none')
      return invalid('reasoningReplay must be current_run or none');
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
    const reasoningReplay = input['reasoningReplay'] === 'current_run' || input['reasoningReplay'] === 'none'
      ? input['reasoningReplay'] : undefined;
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
      // `platform` / `current_run`, so a later save never inherits the old pack.
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

  async function openWorkspaceRoute(input: unknown): Promise<SettingsResponse<SettingsRoutes['workspaces/open']['value']>> {
    if (!isRecord(input)) return invalid('workspaces/open requires an object body');
    if (!nonEmpty(input['path'])) return invalid('path is required');
    if (typeof input['writeAllowed'] !== 'boolean' || typeof input['commandsAllowed'] !== 'boolean')
      return invalid('writeAllowed and commandsAllowed are required booleans');
    if (input['commandsAllowed'] === true && input['writeAllowed'] !== true)
      return invalid('commandsAllowed requires writeAllowed');
    if (input['name'] !== undefined && !nonEmpty(input['name'])) return invalid('name must be a non-empty string when present');
    if (input['projectId'] !== undefined && !nonEmpty(input['projectId'])) return invalid('projectId must be a non-empty string when present');
    if (input['modelId'] !== undefined && !nonEmpty(input['modelId'])) return invalid('modelId must be a non-empty string when present');
    if (nonEmpty(input['modelId']) && !models.some(entry => entry.id === input['modelId'])) return notFound('the model does not exist');

    const request: OpenSettingsWorkspace = {
      path: input['path'], writeAllowed: input['writeAllowed'], commandsAllowed: input['commandsAllowed'],
      ...(nonEmpty(input['name']) ? { name: input['name'] } : {}),
      ...(nonEmpty(input['projectId']) ? { projectId: input['projectId'] } : {}),
      ...(nonEmpty(input['modelId']) ? { modelId: input['modelId'] } : {}),
    };
    const opened = await assembly.openWorkspace(request);
    if (opened.status !== 'ready') return opened;

    const key = scopeKey(opened.value.scope);
    const facts = assembly.listWorkspaces().find(workspace => scopeKey(workspace.scope) === key);
    if (facts === undefined) return unavailable('the opened workspace is not visible in the Host registration');
    // The persisted descriptor is the REAL Host registration fact. A repeated
    // open with wider flags can never silently widen the stored permissions.
    const existing = workspaces.find(entry => scopeKey(entry.scope) === key);
    const descriptor: PersistedWorkspaceV1 = {
      scope: { ...facts.scope },
      name: facts.name,
      root: facts.root,
      writeAllowed: facts.writeAllowed,
      commandsAllowed: facts.commandsAllowed,
      ...(existing?.checks === undefined ? {} : { checks: structuredClone(existing.checks) }),
      ...(existing?.checksSource === undefined ? {} : { checksSource: structuredClone(existing.checksSource) }),
      ...(existing?.checksChild === undefined ? {} : { checksChild: { ...existing.checksChild } }),
      ...(existing?.checksRevision === undefined ? {} : { checksRevision: existing.checksRevision }),
    };
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === key);
    if (index >= 0) workspaces[index] = descriptor; else workspaces.push(descriptor);
    if (request.modelId !== undefined) selection[key] = request.modelId;
    try { await persist(); }
    catch {
      // The workspace IS registered and mounted in this Host; do not answer as
      // if it were absent. A repeated open recovers the same scope.
      return unavailable('the workspace was mounted but the settings file could not be written; retry the same open');
    }
    try { await notify(); }
    catch {
      return unavailable('the workspace was saved but the runtime configuration was not confirmed; retry the same open');
    }
    return { status: 'ready', value: {
      settings: snapshotOf(),
      bootstrap: assembly.bootstrap(),
      scope: { ...opened.value.scope },
    } };
  }

  type ValidatedCheckProposal = {
    facts: HostSettingsWorkspaceFacts;
    proposal: { answerRef: QueryJobAnswerRef; answerDigest: string; checks: RegisteredCommandCheck[] };
  };

  /**
   * The one proposal validation both the direct `checks/approve` route and the
   * adoption entry use: the Answer scope, the registered workspace and its real
   * write+command grant, the saved-Answer reader and its error map, the proposed
   * checks' shape, and — for the direct route — the exact requested list. The
   * adoption entry passes `null` and compares the proposal against its own frozen
   * source/digest instead of a request body.
   */
  async function trustedCheckProposal(
    scope: CoreScope,
    answerRef: QueryJobAnswerRef,
    requested: readonly RegisteredCommandCheck[] | null,
  ): Promise<{ status: 'ready'; value: ValidatedCheckProposal } | { status: 'rejected'; response: SettingsRejection }> {
    if (answerRef.projectId !== scope.projectId || answerRef.workspaceId !== scope.workspaceId) {
      return { status: 'rejected', response: invalid('the saved Answer belongs to another workspace scope') };
    }
    const facts = assembly.listWorkspaces().find(workspace => scopeKey(workspace.scope) === scopeKey(scope));
    if (facts === undefined) return { status: 'rejected', response: notFound('the workspace is not registered') };
    if (facts.writeAllowed !== true || facts.commandsAllowed !== true) {
      return { status: 'rejected', response: { status: 'rejected', code: 'forbidden',
        reason: 'approving command checks requires the workspace real write and command grant' } };
    }
    if (assembly.readCheckProposal === undefined) {
      return { status: 'rejected', response: { status: 'rejected', code: 'unsupported',
        reason: 'the Host does not publish the saved-answer check proposal reader' } };
    }
    let proposal;
    try {
      proposal = await assembly.readCheckProposal(scope, answerRef);
    } catch {
      return { status: 'rejected', response: unavailable('the saved-answer check proposal could not be read') };
    }
    if (proposal.status !== 'ready') return { status: 'rejected', response: proposal };
    if (!Array.isArray(proposal.value.checks) || !proposal.value.checks.every(validRegisteredCheck)) {
      return { status: 'rejected', response: invalid('the saved-answer proposal checks are invalid') };
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
    return { status: 'ready', value: {
      facts,
      proposal: {
        answerRef: structuredClone(proposal.value.answerRef),
        answerDigest: proposal.value.answerDigest,
        checks: structuredClone(proposal.value.checks),
      },
    } };
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
    if (!Array.isArray(requested) || !requested.every(validRegisteredCheck)) {
      return invalid('checks/approve requires an array of registered command checks');
    }
    const scope = { projectId: input['scope'].projectId, workspaceId: input['scope'].workspaceId };
    const checked = await trustedCheckProposal(scope, answerRef as unknown as QueryJobAnswerRef, requested);
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
    const checked = await trustedCheckProposal(scope, source.settings.answerRef, null);
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
    if (typeof input['resumeOnStartup'] !== 'boolean') return invalid('resumeOnStartup must be a boolean');
    const previous = automation;
    automation = { schemaVersion: 1, autoReworkLimit: limit, resumeOnStartup: input['resumeOnStartup'] };
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
    const problems = read.status === 'rejected' ? read.problems : [];
    if (read.chain.length === 0 || read.chain[0]?.packId !== packId)
      return { kind: 'rejected', response: invalidProblems('the prompt pack is invalid', problems) };
    const directory = await realpath(join(promptsRoot, packId)).catch(() => null);
    return { kind: 'ready', read: { chain: read.chain, directory, problems } };
  }

  function proposeTemplateChain(
    chain: readonly PromptPackChainEntryV1[], templateId: string,
    file: string, version: number, mentionsTools: readonly string[], text: string,
  ): PromptPackChainEntryV1[] {
    const first = chain[0]!;
    const manifest = JSON.parse(first.manifest.text) as PromptPackManifestV1;
    // Replace an entry only in an object table. A non-object original stays as
    // written, so the whole-pack validation reports it instead of this throwing.
    if (isRecord(manifest.templates))
      manifest.templates[templateId] = { file, version, mentionsTools: [...mentionsTools] };
    return [
      { ...first, manifest: { file: 'pack.json', text: JSON.stringify(manifest) },
        templates: { ...first.templates, [templateId]: { file, text } } },
      ...chain.slice(1),
    ];
  }

  function proposeToolChain(
    chain: readonly PromptPackChainEntryV1[], toolName: string, file: string, text: string,
  ): PromptPackChainEntryV1[] {
    const first = chain[0]!;
    const manifest = JSON.parse(first.manifest.text) as PromptPackManifestV1;
    // The same rule as a template: keep a non-object table for validation.
    if (isRecord(manifest.tools)) manifest.tools[toolName] = file;
    return [
      { ...first, manifest: { file: 'pack.json', text: JSON.stringify(manifest) },
        tools: { ...first.tools, [toolName]: { file, text } } },
      ...chain.slice(1),
    ];
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
        : [{ packId, templateId, reason: 'the template has no declared version' }]);
    }
    if (expectedVersion !== effectiveVersion)
      return revisionConflict('the prompt template version changed since it was read');
    const text = input['text'];
    if (typeof text !== 'string') return invalidRequest('text must be a string', packId, templateId);
    const mentionsTools = input['mentionsTools'];
    if (!Array.isArray(mentionsTools) || !mentionsTools.every(value => typeof value === 'string'))
      return invalidRequest('mentionsTools must be a string array', packId, templateId);
    const newVersion = effectiveVersion + 1;
    const file = `templates/${templateId}@${String(newVersion)}.txt`;
    const chain = proposeTemplateChain(read.read.chain, templateId, file, newVersion, mentionsTools, text);
    const validation = resolvePromptPackV1(chain);
    if (validation.status === 'rejected')
      return invalidProblems('the prompt pack would be invalid', validation.problems);
    const directory = read.read.directory;
    if (directory === null) return unavailable('the prompt pack has no directory');
    const target = await preparePackWriteTarget(promptsRoot, directory, file, text);
    if (target.status === 'rejected')
      return invalidProblems('the prompt pack has an unsafe save target',
        [{ packId: packId, templateId, reason: target.reason }]);
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
        : [{ packId, templateId: null, toolName, reason: `tool "${toolName}" text could not be read` }]);
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
        [{ packId: packId, templateId: null, toolName, reason: target.reason }]);
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
      case 'checks/approve': return await approveChecksRoute(input);
      case 'automation/save': return await saveAutomationRoute(input);
      case 'resource-caps/save': return await saveResourceCapsRoute(input);
      case 'prompts/packs/list': return await packsListRoute();
      case 'prompts/packs/create': return await packsCreateRoute(input);
      case 'prompts/templates/read': return await templateReadRoute(input);
      case 'prompts/templates/save': return await templateSaveRoute(input);
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
    readSavedChecks,
    confirmInstalledChecks,
    runExclusive: <T>(operation: () => Promise<T>): Promise<T> => serialize(operation),
  };
}
