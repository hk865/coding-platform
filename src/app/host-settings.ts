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
import type { RegisteredCommandCheck } from '../contracts/verification.js';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { canonicalJson, type JsonValue } from '../contracts/fingerprint.js';
import type { BootstrapResponse, CoreScope } from './core-http-types.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { ReadResult } from '../contracts/core/results.js';
import type {
  QueryRuntimeConfigurationInput,
  ResolvedRuntimeConfiguration,
  RuntimeConfigurationInput,
  RuntimeHostBindings,
} from '../core/agent-runtime/execution-contracts.js';
import type { WorkbenchRuntimeProviderDependencies } from './runtime-configuration.js';
import type {
  DirectoryListing,
  HostSettingsPort,
  HostSettingsSnapshot,
  OpenSettingsWorkspace,
  SettingsModel,
  SettingsProvider,
  SettingsResponse,
  SettingsRoute,
  SettingsRoutes,
} from './host-settings-types.js';

/** The published settings route set. `SettingsRoutes` stays the type truth. */
export const SETTINGS_ROUTE_SUFFIXES = [
  'snapshot', 'directories', 'models/save', 'models/select', 'workspaces/open', 'checks/approve',
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
   * with the SAVED Answer source they came from. It is a projection of the real
   * settings file, never model input. */
  checks: { scope: CoreScope; checks: RegisteredCommandCheck[];
    answerRef: QueryJobAnswerRef; answerDigest: string }[];
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
  listProjectIds(): readonly string[];
  openWorkspace(request: OpenSettingsWorkspace & { workspaceId?: string }): Promise<SettingsResponse<HostSettingsOpenedHost>>;
  bootstrap(): BootstrapResponse;
  /** Boolean-only probe: whether the trusted Host can resolve the named secret.
   * The value itself never crosses this seam and never enters a response. */
  secretConfigured(name: string): boolean;
}

/** The one Host callback. It receives a validated private snapshot (key only
 * internal); the Host keeps its original bindings/grants and installs a NEW
 * immutable runtime version. */
export type HostSettingsCallbacks = {
  onConfigurationChanged(snapshot: HostSettingsPrivateSnapshot): void | Promise<void>;
};

/** Trusted settings startup configuration. `settingsDirectory` is only an
 * override: the Host enables settings by default beside a SQLite ledger and
 * treats an in-memory store with no explicit persistent directory as
 * `unsupported`. The provider seam is Host-internal. */
export type HostSettingsConfig = {
  settingsDirectory?: string;
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
  readonly currentVersion: number;
  install(bindings: RuntimeHostBindings): number;
}

export function createHostRuntimeResolverRegistry(initial: RuntimeHostBindings): HostRuntimeResolverRegistry {
  let current = initial;
  let version = 0;
  const workPins = new Map<string, RuntimeHostBindings>();
  const queryPins = new Map<string, RuntimeHostBindings>();
  const refKey = (ref: unknown): string => canonicalJson(ref as JsonValue);
  return {
    get currentVersion(): number { return version; },
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
};
type PersistedSettingsV1 = {
  schemaVersion: 1;
  models: HostSettingsStoredModel[];
  selection: Record<string, string | null>;
  workspaces: PersistedWorkspaceV1[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
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

const invalid = (reason: string): SettingsResponse<never> => ({ status: 'rejected', code: 'invalid', reason });
const notFound = (reason: string): SettingsResponse<never> => ({ status: 'rejected', code: 'not_found', reason });
const unavailable = (reason: string): SettingsResponse<never> => ({ status: 'rejected', code: 'unavailable', reason });

function parseStoredModel(value: unknown): HostSettingsStoredModel {
  if (!isRecord(value) || !nonEmpty(value['id']) || !nonEmpty(value['label'])
    || (value['provider'] !== 'deepseek' && value['provider'] !== 'openai') || !nonEmpty(value['model']))
    throw new Error('the private host settings file is invalid');
  if (value['baseUrl'] !== undefined) {
    if (typeof value['baseUrl'] !== 'string' || validateSettingsBaseUrl(value['baseUrl']) !== null)
      throw new Error('the private host settings file is invalid');
  }
  return {
    id: value['id'], label: value['label'], provider: value['provider'], model: value['model'],
    ...(value['baseUrl'] === undefined ? {} : { baseUrl: value['baseUrl'] }),
    ...(value['thinking'] === 'enabled' || value['thinking'] === 'disabled' ? { thinking: value['thinking'] } : {}),
    ...(value['reasoningEffort'] === 'low' || value['reasoningEffort'] === 'high' || value['reasoningEffort'] === 'max'
      ? { reasoningEffort: value['reasoningEffort'] } : {}),
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
    };
  });
  return { schemaVersion: 1, models, selection, workspaces };
}

function toStoredModel(model: HostSettingsModelDefinition): HostSettingsStoredModel {
  if (model.baseUrl !== undefined && validateSettingsBaseUrl(model.baseUrl) !== null)
    throw new Error('a trusted startup settings model has an invalid baseUrl');
  return {
    id: model.id, label: model.label, provider: model.provider, model: model.model,
    ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
    ...(model.thinking === undefined ? {} : { thinking: model.thinking }),
    ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
    ...(model.secretEnvironmentVariable === undefined ? {} : { secretEnvironmentVariable: model.secretEnvironmentVariable }),
  };
}

export async function createHostSettings(
  options: HostSettingsOptions,
  callbacks: HostSettingsCallbacks,
): Promise<HostSettingsPort> {
  const settingsDirectory = options.settingsDirectory;
  if (!nonEmpty(settingsDirectory)) throw new Error('host settings require an explicit persistent directory');
  const assembly = options.assembly;
  const filePath = join(settingsDirectory, 'host-settings.json');

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

  const privateSnapshot = (): HostSettingsPrivateSnapshot => ({
    models: structuredClone(models),
    selection: { ...selection },
    checks: workspaces
      .filter((workspace): workspace is PersistedWorkspaceV1 & { checks: RegisteredCommandCheck[];
        checksSource: { answerRef: QueryJobAnswerRef; answerDigest: string } } =>
        workspace.checks !== undefined && workspace.checks.length > 0 && workspace.checksSource !== undefined)
      .map(workspace => ({ scope: { ...workspace.scope }, checks: structuredClone(workspace.checks),
        answerRef: structuredClone(workspace.checksSource.answerRef), answerDigest: workspace.checksSource.answerDigest })),
  });

  const persist = async (): Promise<void> => {
    const payload: PersistedSettingsV1 = { schemaVersion: 1, models, selection, workspaces };
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
  });

  // Restore every persisted directory registration through the real owners
  // BEFORE the Host listens. A failed restore is an explicit startup failure.
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
    if (input['id'] !== undefined && !nonEmpty(input['id'])) return invalid('id must be a non-empty string when present');
    if (input['apiKey'] !== undefined && typeof input['apiKey'] !== 'string') return invalid('apiKey must be a string when present');

    const label = input['label'];
    const provider = input['provider'];
    const modelName = input['model'];
    const baseUrl = typeof input['baseUrl'] === 'string' ? input['baseUrl'] : undefined;
    const thinking = input['thinking'] === 'enabled' || input['thinking'] === 'disabled' ? input['thinking'] : undefined;
    const reasoningEffort = input['reasoningEffort'] === 'low' || input['reasoningEffort'] === 'high'
      || input['reasoningEffort'] === 'max' ? input['reasoningEffort'] : undefined;
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
    if (answerRef['projectId'] !== scope.projectId || answerRef['workspaceId'] !== scope.workspaceId) {
      return invalid('the saved Answer belongs to another workspace scope');
    }
    const facts = assembly.listWorkspaces().find(workspace => scopeKey(workspace.scope) === scopeKey(scope));
    if (facts === undefined) return notFound('the workspace is not registered');
    if (facts.writeAllowed !== true || facts.commandsAllowed !== true) {
      return { status: 'rejected', code: 'forbidden',
        reason: 'approving command checks requires the workspace real write and command grant' };
    }
    if (assembly.readCheckProposal === undefined) {
      return { status: 'rejected', code: 'unsupported',
        reason: 'the Host does not publish the saved-answer check proposal reader' };
    }
    let proposal;
    try {
      proposal = await assembly.readCheckProposal(scope, answerRef as unknown as QueryJobAnswerRef);
    } catch {
      return unavailable('the saved-answer check proposal could not be read');
    }
    if (proposal.status !== 'ready') return proposal;
    let approvedJson: string;
    let proposalJson: string;
    try {
      approvedJson = canonicalJson(requested as unknown as JsonValue);
      proposalJson = canonicalJson(proposal.value.checks as unknown as JsonValue);
    } catch {
      return invalid('the approved checks are not canonicalizable JSON');
    }
    if (approvedJson !== proposalJson) {
      return invalid('the approved checks do not match the saved Answer proposal');
    }
    const index = workspaces.findIndex(entry => scopeKey(entry.scope) === scopeKey(scope));
    const previous = index >= 0 ? workspaces[index] : undefined;
    const next: PersistedWorkspaceV1 = {
      scope: { ...scope },
      name: facts.name,
      root: facts.root,
      writeAllowed: facts.writeAllowed,
      commandsAllowed: facts.commandsAllowed,
      checks: structuredClone(proposal.value.checks),
      checksSource: { answerRef: structuredClone(proposal.value.answerRef), answerDigest: proposal.value.answerDigest },
    };
    if (index >= 0) workspaces[index] = next; else workspaces.push(next);
    try { await persist(); }
    catch {
      if (index >= 0 && previous !== undefined) workspaces[index] = previous; else workspaces.pop();
      return unavailable('the approved checks could not be persisted');
    }
    try { await notify(); }
    catch {
      return unavailable('the checks were saved but the Host configuration was not confirmed; retry the same approval');
    }
    return { status: 'ready', value: snapshotOf() };
  }

  const dispatch = async (route: SettingsRoute, input: unknown): Promise<SettingsResponse<unknown>> => {
    switch (route) {
      case 'snapshot': return { status: 'ready', value: snapshotOf() };
      case 'directories': return await directoriesRoute(input);
      case 'models/save': return await saveModelRoute(input);
      case 'models/select': return await selectModelRoute(input);
      case 'workspaces/open': return await openWorkspaceRoute(input);
      case 'checks/approve': return await approveChecksRoute(input);
    }
  };

  return {
    call: async <K extends SettingsRoute>(
      route: K,
      input: SettingsRoutes[K]['input'],
    ): Promise<SettingsResponse<SettingsRoutes[K]['value']>> => {
      return await serialize(() => dispatch(route, input)) as SettingsResponse<SettingsRoutes[K]['value']>;
    },
  };
}
