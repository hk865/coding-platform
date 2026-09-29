/**
 * R6.1a local workbench CLI.
 *
 * Reads ONE explicitly supplied local JSON configuration, converts it into the
 * programmatic `LocalWorkbenchHostOptions`, starts the loopback Host and prints
 * only the token-free workbench address. The token is generated inside
 * `host.ts`, never accepted from the file and never logged.
 */
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions } from './host.js';
import type { TargetPlatformOptions } from '../composition/create-platform.js';
import type { WorkbenchRuntimeConfiguration } from './runtime-configuration.js';
import type { HostSettingsModelDefinition } from './host-settings.js';
import type { BootstrapReviewMaterial, CoreScope, WorkbenchActor } from './core-http-types.js';

export type WorkbenchCliWorkspace = {
  scope: CoreScope;
  name: string;
  root: string;
  workspaceRevision: number;
  readPrefixes: string[];
  /** Trusted CAS write scope; absence denies every write. */
  writePrefixes?: string[];
  /** Explicit whole-workspace command authorization; absence denies commands. */
  allowCommands?: boolean;
};

export type WorkbenchCliConfig = {
  sqliteDirectory: string;
  actor: WorkbenchActor;
  port?: number;
  workspaces: WorkbenchCliWorkspace[];
  review?: BootstrapReviewMaterial;
  architectureSource?: { provider: 'typescript'; configPath: string };
  kernelStores?: LocalWorkbenchHostOptions['kernelStores'];
  /** Trusted serializable execution configuration. It is pure JSON: the parser
   * never reads an environment variable, opens a provider or writes domain
   * state; the Host assembles the real resolver from it. */
  runtime?: WorkbenchRuntimeConfiguration;
  checks?: TargetPlatformOptions['checks'];
  workflow?: TargetPlatformOptions['workflow'];
  attention?: LocalWorkbenchHostOptions['attention'];
  inputConsumers?: LocalWorkbenchHostOptions['inputConsumers'];
  /** Explicit private settings directory override; absent uses the SQLite default. */
  settingsDirectory?: string;
  /** Trusted startup model catalog seeds (environment variable NAMES only). */
  settingsModels?: HostSettingsModelDefinition[];
};

export const WORKBENCH_CLI_USAGE = 'usage: node dist/app/main.js <workbench-config.json>';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Resolve one explicitly configured trusted resource path against the
 * configuration file directory; an already-absolute path is preserved. */
const resolveConfiguredPath = (value: string, directory: string): string =>
  isAbsolute(value) ? value : resolve(directory, value);

const asScope = (value: unknown, label: string): CoreScope => {
  if (!isPlainObject(value) || typeof value.projectId !== 'string' || value.projectId.length === 0
    || typeof value.workspaceId !== 'string' || value.workspaceId.length === 0)
    throw new Error(`${label} requires a non-empty projectId and workspaceId`);
  return { projectId: value.projectId, workspaceId: value.workspaceId };
};

/** Pure, explicit conversion from the serializable CLI file into the trusted
 * programmatic options. No function-valued configuration is accepted. */
export function parseWorkbenchCliConfig(raw: unknown, configDirectory: string): LocalWorkbenchHostOptions {
  if (!isPlainObject(raw)) throw new Error('the workbench configuration must be a JSON object');
  if (!isPlainObject(raw.actor) || (raw.actor.kind !== 'human' && raw.actor.kind !== 'system')
    || typeof raw.actor.id !== 'string' || raw.actor.id.length === 0)
    throw new Error('actor must be a fixed human or system actor with a non-empty id');
  if (raw.port !== undefined && !Number.isSafeInteger(raw.port))
    throw new Error('port must be an integer when present');
  if (!Array.isArray(raw.workspaces) || raw.workspaces.length === 0)
    throw new Error('workspaces must be a non-empty array');
  const workspaces = (raw.workspaces as unknown[]).map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`workspaces[${index}] must be an object`);
    const scope = asScope(entry.scope, `workspaces[${index}].scope`);
    const name = entry.name;
    if (typeof name !== 'string' || name.length === 0) throw new Error(`workspaces[${index}].name is required`);
    const entryRoot = entry.root;
    if (typeof entryRoot !== 'string' || entryRoot.length === 0) throw new Error(`workspaces[${index}].root is required`);
    const revision = entry.workspaceRevision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
      throw new Error(`workspaces[${index}].workspaceRevision must be a non-negative integer`);
    const prefixesRaw = entry.readPrefixes;
    if (!Array.isArray(prefixesRaw) || prefixesRaw.some(prefix => typeof prefix !== 'string'))
      throw new Error(`workspaces[${index}].readPrefixes must be an array of strings`);
    const readPrefixes = prefixesRaw as string[];
    const writePrefixesRaw = entry.writePrefixes;
    if (writePrefixesRaw !== undefined
      && (!Array.isArray(writePrefixesRaw) || writePrefixesRaw.some(prefix => typeof prefix !== 'string')))
      throw new Error(`workspaces[${index}].writePrefixes must be an array of strings when present`);
    if (entry.allowCommands !== undefined && typeof entry.allowCommands !== 'boolean')
      throw new Error(`workspaces[${index}].allowCommands must be a boolean when present`);
    const root = isAbsolute(entryRoot) ? entryRoot : resolve(configDirectory, entryRoot);
    return { scope, name, root, workspaceRevision: revision, readPrefixes: [...readPrefixes],
      ...(writePrefixesRaw === undefined ? {} : { writePrefixes: [...(writePrefixesRaw as string[])] }),
      ...(entry.allowCommands === undefined ? {} : { allowCommands: entry.allowCommands as boolean }) };
  });
  const rawArchitectureSource = raw.architectureSource;
  let architectureConfigPath: string | undefined;
  if (rawArchitectureSource !== undefined) {
    if (!isPlainObject(rawArchitectureSource) || rawArchitectureSource.provider !== 'typescript'
      || typeof rawArchitectureSource.configPath !== 'string')
      throw new Error('architectureSource must be { provider: "typescript", configPath }');
    architectureConfigPath = rawArchitectureSource.configPath as string;
  }
  const port = raw.port;
  const sqliteDirectory = raw.sqliteDirectory;
  if (typeof sqliteDirectory !== 'string' || sqliteDirectory.length === 0)
    throw new Error('sqliteDirectory must be a non-empty string');
  const rawRuntime = raw.runtime;
  let runtimeConfiguration: WorkbenchRuntimeConfiguration | undefined;
  if (rawRuntime !== undefined) {
    if (!isPlainObject(rawRuntime) || rawRuntime.schemaVersion !== 1
      || !Array.isArray(rawRuntime.bindings) || !Array.isArray(rawRuntime.queryProfiles))
      throw new Error('runtime must be { schemaVersion: 1, bindings: [ ... ], queryProfiles: [ ... ] }');
    runtimeConfiguration = structuredClone(rawRuntime) as unknown as WorkbenchRuntimeConfiguration;
    // Trusted resource paths inside a binding grant are resolved against the
    // configuration directory; the value stays pure data and no credential,
    // provider or client is touched here.
    for (const binding of runtimeConfiguration.bindings) {
      const grant: unknown = binding?.grant;
      if (!isPlainObject(grant)) continue;
      const skills = grant['skills'];
      if (isPlainObject(skills) && typeof skills['resourceRoot'] === 'string' && skills['resourceRoot'].length > 0)
        skills['resourceRoot'] = resolveConfiguredPath(skills['resourceRoot'], configDirectory);
      const sandbox = grant['processSandboxOptions'];
      if (isPlainObject(sandbox) && Array.isArray(sandbox['readOnlyPaths'])) {
        sandbox['readOnlyPaths'] = (sandbox['readOnlyPaths'] as unknown[])
          .map(entry => typeof entry === 'string' ? resolveConfiguredPath(entry, configDirectory) : entry);
      }
    }
  }
  // Kernel SQLite paths are Host-managed resources: a relative entry resolves
  // against the configuration directory, never against the process cwd.
  let kernelStores: NonNullable<LocalWorkbenchHostOptions['kernelStores']> | undefined;
  if (raw.kernelStores !== undefined) {
    if (!isPlainObject(raw.kernelStores) || !Array.isArray(raw.kernelStores.entries))
      throw new Error('kernelStores must be { entries: [ ... ] }');
    kernelStores = structuredClone(raw.kernelStores) as unknown as NonNullable<LocalWorkbenchHostOptions['kernelStores']>;
    for (const entry of kernelStores.entries) {
      if (!isPlainObject(entry) || typeof entry.databasePath !== 'string' || entry.databasePath.length === 0)
        throw new Error('every kernelStores entry requires a non-empty databasePath');
      entry.databasePath = resolveConfiguredPath(entry.databasePath, configDirectory);
    }
    if (Array.isArray(kernelStores.legacyEntries)) {
      for (const entry of kernelStores.legacyEntries) {
        if (isPlainObject(entry) && typeof entry.databasePath === 'string' && entry.databasePath.length > 0)
          entry.databasePath = resolveConfiguredPath(entry.databasePath, configDirectory);
      }
    }
  }
  const settingsDirectoryRaw = raw.settingsDirectory;
  if (settingsDirectoryRaw !== undefined && (typeof settingsDirectoryRaw !== 'string' || settingsDirectoryRaw.length === 0))
    throw new Error('settingsDirectory must be a non-empty string when present');
  const settingsModelsRaw = raw.settingsModels;
  if (settingsModelsRaw !== undefined && !Array.isArray(settingsModelsRaw))
    throw new Error('settingsModels must be an array when present');
  const settings: NonNullable<LocalWorkbenchHostOptions['settings']> | undefined =
    settingsDirectoryRaw === undefined && settingsModelsRaw === undefined ? undefined : {
      ...(settingsDirectoryRaw === undefined ? {}
        : { settingsDirectory: resolveConfiguredPath(settingsDirectoryRaw as string, configDirectory) }),
      ...(settingsModelsRaw === undefined ? {}
        : { models: structuredClone(settingsModelsRaw) as HostSettingsModelDefinition[] }),
    };
  if (raw.checks !== undefined && !isPlainObject(raw.checks)) throw new Error('checks must be a JSON object');
  if (raw.workflow !== undefined && !isPlainObject(raw.workflow)) throw new Error('workflow must be a JSON object');
  if (raw.inputConsumers !== undefined && !Array.isArray(raw.inputConsumers)) throw new Error('inputConsumers must be an array');
  if (raw.attention !== undefined && !Array.isArray(raw.attention)) throw new Error('attention must be an array of scopes');
  return {
    storage: { kind: 'sqlite', directory: isAbsolute(sqliteDirectory) ? sqliteDirectory : resolve(configDirectory, sqliteDirectory) },
    actor: { kind: raw.actor.kind, id: raw.actor.id },
    workspaces,
    ...(port === undefined ? {} : { port: port as number }),
    ...(raw.review === undefined ? {} : { review: raw.review as BootstrapReviewMaterial }),
    ...(architectureConfigPath === undefined ? {} : {
      architectureSource: { provider: 'typescript' as const, configPath: architectureConfigPath },
    }),
    ...(kernelStores === undefined ? {} : { kernelStores }),
    ...(runtimeConfiguration === undefined ? {} : { runtimeConfiguration }),
    ...(raw.checks === undefined ? {} : { checks: raw.checks as TargetPlatformOptions['checks'] }),
    ...(raw.workflow === undefined ? {} : { workflow: raw.workflow as TargetPlatformOptions['workflow'] }),
    ...(raw.attention === undefined ? {} : { attention: raw.attention as NonNullable<LocalWorkbenchHostOptions['attention']> }),
    ...(raw.inputConsumers === undefined ? {} : { inputConsumers: raw.inputConsumers as NonNullable<LocalWorkbenchHostOptions['inputConsumers']> }),
    ...(settings === undefined ? {} : { settings }),
  };
}

export async function loadWorkbenchCliConfig(path: string): Promise<LocalWorkbenchHostOptions> {
  const absolute = resolve(path);
  const text = await readFile(absolute, 'utf8');
  return parseWorkbenchCliConfig(JSON.parse(text) as unknown, dirname(absolute));
}

export async function runWorkbenchCli(argv: string[]): Promise<number> {
  const configPath = argv[0];
  if (configPath === undefined) {
    process.stderr.write(`${WORKBENCH_CLI_USAGE}\n`);
    return 2;
  }
  let host: LocalWorkbenchHost;
  try {
    host = await createLocalWorkbenchHost(await loadWorkbenchCliConfig(configPath));
  } catch (error) {
    process.stderr.write(`workbench configuration rejected: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await host.close();
  };
  process.once('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
  const address = await host.listen();
  process.stdout.write(`workbench listening at ${address.url}\n`);
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const code = await runWorkbenchCli(process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
