/**
 * PC-2 Host fixture (frozen 2026-10-22; Codex wrote it, the lead checked it against book v4 §5.1).
 *
 * Uses the real Host and HTTP request handler. Only socket binding is replaced;
 * requests are streams delivered to the real Server request listener.
 * No fetch, socket, real provider or network listener is used.
 *
 * Construct/start fixtures serially: composition capture and listen capture are
 * temporary spies. All filesystem writes belong to the fixture's temporary root.
 */
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import {
  Server, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { vi } from 'vitest';
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import {
  createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions,
} from '../../src/app/host.js';
import { PLATFORM_TOKEN_HEADER, type CoreScope } from '../../src/app/core-http-types.js';
import {
  SETTINGS_API_PREFIX, type SettingsResponse, type SettingsRoutes,
} from '../../src/app/host-settings-types.js';
import type { PromptPackChainEntryV1 } from '../../src/contracts/prompts/prompt-pack.js';
import * as platformModule from '../../src/composition/create-platform.js';
import { PLATFORM_TOKEN_META_NAME, writeHostPage } from './host-page.js';
import { scriptedModel } from './PC-platform-fixture.js';
import { writePC2Packs } from './PC2-pack-fixture.js';

export const PC2_PROMPT_ROUTES = [
  'prompts/packs/list', 'prompts/packs/create',
  'prompts/templates/read', 'prompts/templates/save',
  'prompts/tools/read', 'prompts/tools/save',
] as const satisfies readonly (keyof SettingsRoutes)[];

export type PC2HttpOptions = {
  method?: string;
  token?: string | null;
  origin?: string | null;
  rawBody?: string;
};
export type PC2HttpResult<T = unknown> = {
  status: number; headers: OutgoingHttpHeaders; text: string; body: T;
};
export type PC2HostStart = Partial<Pick<LocalWorkbenchHostOptions,
  'settings' | 'workspaces' | 'runtimeConfiguration' | 'kernelStores' | 'runtime'>>;
export type PC2HostOptions = {
  start?: boolean;
  scope?: CoreScope;
  packs?: readonly PromptPackChainEntryV1[];
  model?: ReturnType<typeof scriptedModel>;
  models?: NonNullable<LocalWorkbenchHostOptions['settings']>['models'];
  runtimeConfiguration?: LocalWorkbenchHostOptions['runtimeConfiguration'];
};

type Platform = Awaited<ReturnType<typeof platformModule.createTargetPlatform>>;
type RuntimeBinding = Parameters<typeof platformModule.createTargetPlatform>[0]['runtime'];
type Address = Awaited<ReturnType<LocalWorkbenchHost['listen']>>;

async function directoryLink(target: string, path: string): Promise<void> {
  await symlink(resolve(target), path, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Capture the real Server without invoking node's socket-binding implementation. */
async function listenInProcess(host: LocalWorkbenchHost): Promise<{ server: Server; address: Address }> {
  const captured: Server[] = [];
  const replacement = function (this: Server, ...args: unknown[]): Server {
    captured.push(this);
    const callback = args.at(-1);
    if (typeof callback !== 'function') throw new Error('Unexpected Host listen signature');
    queueMicrotask(() => callback());
    return this;
  };
  const spy = vi.spyOn(Server.prototype, 'listen')
    .mockImplementation(replacement as typeof Server.prototype.listen);
  try {
    const address = await host.listen(18081);
    const server = captured[0];
    if (!server || captured.length !== 1) throw new Error('No unique Host HTTP server');
    return { server, address };
  } finally { spy.mockRestore(); }
}

async function dispatch(
  server: Server, address: Address, token: string,
  path: string, input: unknown, options: PC2HttpOptions = {},
): Promise<PC2HttpResult> {
  const base = new URL(address.url);
  const method = options.method ?? 'POST';
  const body = options.rawBody ?? (input === undefined ? undefined : JSON.stringify(input));
  const headers: Record<string, string> = { host: base.host, 'content-type': 'application/json' };
  const selectedToken = options.token === undefined ? token : options.token;
  const origin = options.origin === undefined ? base.origin : options.origin;
  if (selectedToken !== null) headers[PLATFORM_TOKEN_HEADER] = selectedToken;
  if (origin !== null) headers.origin = origin;
  const request = Object.assign(
    Readable.from(body === undefined ? [] : [Buffer.from(body)]),
    { headers, method, url: path, setTimeout() { return this; } },
  );
  const chunks: Buffer[] = [];
  let status = 0;
  let responseHeaders: OutgoingHttpHeaders = {};
  const response = Object.assign(new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
      done();
    },
  }), {
    writeHead(code: number, supplied: OutgoingHttpHeaders = {}) {
      status = code;
      responseHeaders = { ...supplied };
      return this;
    },
  });
  const finished = new Promise<void>((done, reject) => {
    response.once('finish', done);
    response.once('error', reject);
    request.once('error', reject);
  });
  if (!server.emit('request', request as unknown as IncomingMessage, response as unknown as ServerResponse)) {
    throw new Error('The Host has no request listener');
  }
  await finished;
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* HTML and empty bodies remain text. */ }
  return { status, headers: responseHeaders, text, body: parsed };
}

/** Reuses host-page and PC's scripted provider; the Host builds its own platform. */
export async function openPC2HostFixture(options: PC2HostOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pc2-host-'));
  const paths = {
    directory, database: join(directory, 'database'), workspace: join(directory, 'workspace'),
    settingsDirectory: join(directory, 'settings'), promptsDirectory: join(directory, 'settings', 'prompts'),
    publicDir: join(directory, 'public'), unrelated: join(directory, 'unrelated'),
  };
  const scope: CoreScope = options.scope ?? { projectId: 'pc2-host-project', workspaceId: 'pc2-host-workspace' };
  const model = options.model ?? scriptedModel([]);
  const definitions = createBuiltinProviderRegistry();
  let live: {
    host: LocalWorkbenchHost; platform: Platform; runtime: RuntimeBinding;
    server: Server; address: Address; token: string;
  } | undefined;
  let current: PC2HostStart = {};
  let closed = false;
  const defaults: LocalWorkbenchHostOptions = {
    storage: { kind: 'sqlite', directory: paths.database },
    actor: { kind: 'human', id: 'pc2-host-operator' },
    workspaces: [{
      scope, name: 'PC2 workspace', root: paths.workspace,
      workspaceRevision: 1, readPrefixes: ['.'],
    }],
    settings: {
      settingsDirectory: paths.settingsDirectory,
      ...(options.models === undefined ? {} : { models: options.models }),
    },
    publicDir: paths.publicDir,
    now: () => '2026-10-22T00:00:00.000Z',
    runtimeProvider: {
      registry: { get: definitions.get.bind(definitions), create: () => model.client },
      secretSource: { get: () => 'pc2-fixture-secret' },
    },
    ...(options.runtimeConfiguration === undefined ? {} : { runtimeConfiguration: options.runtimeConfiguration }),
  };
  const requireLive = () => {
    if (!live) throw new Error('Start the PC2 Host first');
    return live;
  };
  const stop = async (): Promise<void> => {
    const prior = live;
    live = undefined;
    await prior?.host.close();
  };
  const start = async (overrides: PC2HostStart = {}) => {
    if (closed) throw new Error('The PC2 Host fixture is closed');
    if (live) throw new Error('Stop the current Host before starting another');
    current = { ...current, ...overrides };
    let platform: Platform | undefined;
    let runtime: RuntimeBinding;
    let host: LocalWorkbenchHost | undefined;
    const actual = platformModule.createTargetPlatform;
    const spy = vi.spyOn(platformModule, 'createTargetPlatform').mockImplementation(async input => {
      runtime = input.runtime;
      platform = await actual(input);
      return platform;
    });
    try {
      host = await createLocalWorkbenchHost({ ...defaults, ...current });
    } catch (error) {
      await platform?.close();
      throw error;
    } finally { spy.mockRestore(); }
    try {
      if (!platform) throw new Error('The Host did not construct its platform');
      const transport = await listenInProcess(host);
      const page = await dispatch(transport.server, transport.address, '', '/workbench/', undefined, {
        method: 'GET', token: null,
      });
      const token = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(page.text)?.[1];
      if (page.status !== 200 || token === undefined) throw new Error('The Host page supplied no token');
      live = { host, platform, runtime, ...transport, token };
      return live;
    } catch (error) { await host.close(); throw error; }
  };
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try { await stop(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  };
  const request = (path: string, input: unknown, requestOptions: PC2HttpOptions = {}) => {
    const currentHost = requireLive();
    return dispatch(currentHost.server, currentHost.address, currentHost.token, path, input, requestOptions);
  };
  const call = async <K extends keyof SettingsRoutes>(
    route: K, input: SettingsRoutes[K]['input'], requestOptions: PC2HttpOptions = {},
  ): Promise<PC2HttpResult<SettingsResponse<SettingsRoutes[K]['value']>>> =>
    request(SETTINGS_API_PREFIX + route, input, requestOptions) as
      Promise<PC2HttpResult<SettingsResponse<SettingsRoutes[K]['value']>>>;

  try {
    for (const path of Object.values(paths)) await mkdir(path, { recursive: true });
    await writeFile(join(paths.workspace, 'README.md'), '# PC2 workspace\n');
    await writeHostPage(paths.publicDir);
    await writePC2Packs(paths.promptsDirectory, options.packs ?? []);
    if (options.start !== false) await start();
  } catch (error) { await close(); throw error; }

  return {
    paths, scope, model, get live() { return requireLive(); },
    start, stop, close, request, call,
    async restart(overrides: PC2HostStart = {}) { await stop(); return start(overrides); },
    async linkPack(pack: PromptPackChainEntryV1) {
      const settingsDirectory = current.settings?.settingsDirectory ?? paths.settingsDirectory;
      const promptsDirectory = join(settingsDirectory, 'prompts');
      const outside = join(directory, 'outside-packs');
      const written = await writePC2Packs(outside, [pack]);
      const target = written[pack.packId];
      if (!target) throw new Error('Only a user pack can be linked');
      await mkdir(promptsDirectory, { recursive: true });
      const link = join(promptsDirectory, pack.packId);
      await directoryLink(target, link);
      return { link, target, promptsDirectory };
    },
  };
}

export type PC2DirectoryRelation = 'settings-inside' | 'prompts-inside' | 'equal' | 'symlink';

/**
 * Restored cases obtain host-settings.json from a successful public
 * workspaces/open, then relocate that unchanged file before the tested start.
 */
export async function openPC2DirectoryCase(
  relation: PC2DirectoryRelation, registration: 'configured' | 'restored',
) {
  const fixture = await openPC2HostFixture({ start: false });
  try {
    const area = join(fixture.paths.directory, 'relation');
    let root = join(area, 'workspace');
    let settingsDirectory = join(area, 'settings');
    if (relation === 'settings-inside') settingsDirectory = join(root, 'private');
    if (relation === 'prompts-inside') root = settingsDirectory;
    if (relation === 'equal') root = join(settingsDirectory, 'prompts');
    const promptsDirectory = join(settingsDirectory, 'prompts');
    await mkdir(root, { recursive: true });
    await mkdir(settingsDirectory, { recursive: true });
    if (relation === 'symlink') {
      const realPrompts = join(root, 'linked-prompts');
      await mkdir(realPrompts, { recursive: true });
      await directoryLink(realPrompts, promptsDirectory);
    } else {
      await mkdir(promptsDirectory, { recursive: true });
    }
    const finalOptions: PC2HostStart = {
      settings: { settingsDirectory },
      workspaces: registration === 'configured' ? [{
        scope: fixture.scope, name: 'PC2 covered root', root,
        workspaceRevision: 1, readPrefixes: ['.'],
      }] : [],
    };
    if (registration === 'restored') {
      const staging = join(fixture.paths.directory, 'staging-settings');
      await fixture.start({ settings: { settingsDirectory: staging }, workspaces: [] });
      const opened = await fixture.call('workspaces/open', {
        path: root, writeAllowed: false, commandsAllowed: false,
      });
      if (opened.status !== 200 || opened.body.status !== 'ready') {
        throw new Error(`Could not create the restored-root setup: ${opened.text}`);
      }
      await fixture.stop();
      await copyFile(join(staging, 'host-settings.json'), join(settingsDirectory, 'host-settings.json'));
    }
    return {
      fixture, relation, registration, root, settingsDirectory, promptsDirectory,
      start: () => fixture.start(finalOptions),
      close: () => fixture.close(),
    };
  } catch (error) { await fixture.close(); throw error; }
}
