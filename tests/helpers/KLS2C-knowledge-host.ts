/**
 * KLS-2c-1 Host world (test writer; 2c-1a built the Host and the file edits, 2c-1b adds `idle()`, `notices()`,
 * the Host-route adoption and revision, `noteFileText` and the out-of-process `crashAt`; 2c-1b2 the person's module-file
 * conflict `kls2cConflict`, the exported graph-write pins and the never-idle threshold; 2c-1c the Host clock `now`, a
 * second served project `alsoServe`, the adopt and revise bodies a crash child sends, the two recovery routes, the blob
 * id by `git hash-object` and a wait for a notice count; 2c-1d `armedSeam`, which platform rows hand to
 * `openKLS2AWorld`). One real
 * `createLocalWorkbenchHost` (memory or SQLite) with one workspace on the test's own root (a real git repository
 * through `initGitWorkspace` when `git`), the Project and Workspace records through the public routes. The Host
 * options are Host inputs only (A8): the root, the idle threshold `linkBatchIdleMs` (`idleMs`, 2c1#7), a short
 * heartbeat (`scribeReminderPeriodMs`, the Host's own loop period, as `S8E2-H-link-batch` gives it), and the build's
 * test seam `knowledgeWriteHold` (SEAM-2C, A2 named boundary), handed to the Host as given. A project's store sits
 * where its projectId and root put it (KLS-1a), so "two Hosts, two project stores, one checkout" is the same `root`
 * with a different `scope`. Temporary directories go with `cleanupRestart()` (A2-restart-fixture).
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions } from '../../src/app/host.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { projectRef, workspaceRef } from '../app/support/S8A-L8-host.js';
import { gitIn, initGitWorkspace } from '../scenarios/support/git-workspace.js';
import { publicDirectory, tempDir } from './A2-restart-fixture.js';
import { corePost, graphWrite, plain, readPageToken } from './AG2b-collaboration-fixture.js';

export type KLS2CHoldPoint = 'committed' | 'applied';
export const KLS2C_SCOPE: CoreScope = { projectId: 'kls2c-p', workspaceId: 'kls2c-ws' };
const OPERATOR = { kind: 'human' as const, id: 'kls2c-operator' };
/** The Host's loop period in these worlds (milliseconds). */
const HEARTBEAT_MS = 25;

export type KLS2CNoticeKind = 'knowledge_write_unconfirmed' | 'knowledge_reverted' | 'knowledge_conflict';
/**
 * The decision queue's notice item carries no kind (`project-notice-notices.ts`), so a kind is told by the words
 * of its summary: [2C1-14] “平台有 n 次写没确认落盘”, “架构图和注记被撤回了 n 处”; [2C1-17] “知识文件有 n 处问题：”.
 */
const NOTICE_WORDS: Record<KLS2CNoticeKind, string> = {
  knowledge_write_unconfirmed: '没确认落盘', knowledge_reverted: '撤回', knowledge_conflict: '知识文件有',
};
export type KLS2CNotice = { noticeId: string; summary: string };

export type KLS2CHost = {
  readonly host: LocalWorkbenchHost;
  readonly root: string;
  readonly scope: CoreScope;
  /** The SQLite storage directory to reopen on (with the same `root` and `scope`). */
  readonly database: string;
  /** A public core route; `body` is the whole request body (`plain(...)` or `graphWrite(...)`), the answer decoded. */
  call<T>(suffix: string, body: unknown): Promise<T>;
  /** One idle heartbeat that began after the call has finished: three consume barriers (2c1#7). */
  idle(): Promise<void>;
  /** The project notices of the decision queue (`decisions/queue`), all of them or one kind's. */
  notices(kind?: KLS2CNoticeKind): Promise<KLS2CNotice[]>;
  /** At most `rounds` idle heartbeats, reading after each: the notices as soon as there are any, else `[]`. */
  noticesWithin(kind: KLS2CNoticeKind, rounds?: number): Promise<KLS2CNotice[]>;
  /** A person's edit, landing whole (a file written beside the root, then renamed into place). */
  edit(rel: string, text: string): void;
  remove(rel: string): void;
  read(rel: string): Buffer | null;
  /** Real git in the root, like a person. */
  git(args: string[]): string;
  close(): Promise<void>;
};

export type KLS2COpenOptions = {
  storage: 'memory' | 'sqlite';
  git: boolean;
  /** `linkBatchIdleMs`; default 0 (every heartbeat is idle). */
  idleMs?: number;
  /** Reopen: the records already exist, none are created. */
  database?: string;
  root?: string;
  /** Default `KLS2C_SCOPE`; a second Host on the same root takes another projectId (its own project store). */
  scope?: CoreScope;
  /** Handed to the Host's `knowledgeWriteHold` as is. */
  hold?: (point: KLS2CHoldPoint) => Promise<void>;
  /** A Kernel store for the workspace (`kernelStores`, beside the project store), so Sessions can be made (K08). */
  kernelStore?: true;
  /** The Host's injected clock (`now`), handed to every project's platform as is (K16 holds it still). */
  now?: () => string;
  /** One more project this Host serves, on a fresh root of its own (K37: two projects, one Host; not for a reopen). */
  alsoServe?: CoreScope;
};

/** The Host's workspace entry for one scope on one root (the in-process Host and the crash child give the same). */
const workspaceEntry = (scope: CoreScope, root: string) =>
  ({ scope, name: scope.workspaceId, root, workspaceRevision: 1, readPrefixes: ['.'] });

export async function openKLS2CHost(opts: KLS2COpenOptions): Promise<KLS2CHost> {
  const scope = opts.scope ?? KLS2C_SCOPE;
  const root = opts.root ?? await tempDir('kls2c-root-');
  if (opts.root === undefined && opts.git) await initGitWorkspace(root);
  const database = opts.database ?? await tempDir('kls2c-store-');
  const storage: LocalWorkbenchHostOptions['storage'] = opts.storage === 'sqlite'
    ? { kind: 'sqlite', directory: database } : { kind: 'memory' };
  const served = [workspaceEntry(scope, root)];
  if (opts.alsoServe !== undefined) {
    const alsoRoot = await tempDir('kls2c-root-');
    if (opts.git) await initGitWorkspace(alsoRoot);
    served.push(workspaceEntry(opts.alsoServe, alsoRoot));
  }
  const host = await createLocalWorkbenchHost({
    storage, actor: OPERATOR, publicDir: await publicDirectory(),
    workspaces: served,
    ...(opts.now === undefined ? {} : { now: opts.now }),
    ...(opts.storage === 'memory' ? { settings: { settingsDirectory: join(database, 'host-settings') } } : {}),
    linkBatchIdleMs: opts.idleMs ?? 0,
    scribeReminderPeriodMs: HEARTBEAT_MS,
    ...(opts.hold === undefined ? {} : { knowledgeWriteHold: opts.hold }),
    ...(opts.kernelStore === undefined ? {} : { kernelStores: { entries: [{ adapterId: 'kls2c-kernel',
      storeKey: 'kls2c-kernel-store', workspace: scope, databasePath: join(database, 'kernel.sqlite') }] } }),
  });
  try {
    const { url } = await host.listen();
    const token = await readPageToken(url);
    const call = async <T>(suffix: string, body: unknown): Promise<T> =>
      await (await corePost(url, suffix, token, body)).json() as T;
    for (const { scope: each } of opts.database === undefined ? served : []) {
      const steps: [string, unknown, unknown[]][] = [
        ['projects/create', { projectId: each.projectId }, [{ ref: projectRef(each), revision: 0 }]],
        ['workspaces/register', { workspace: each },
          [{ ref: projectRef(each), revision: 1 }, { ref: workspaceRef(each), revision: 0 }]],
      ];
      for (const [suffix, input, expected] of steps) {
        const answer = await call<{ status?: string }>(suffix,
          graphWrite(each, input, `kls2c-${each.workspaceId}-${suffix}`, expected));
        if (answer.status !== 'committed') throw new Error(`${suffix} did not commit: ${JSON.stringify(answer)}`);
      }
    }
    const underRoot = (rel: string): string => join(root, rel);
    const idle = async (): Promise<void> => {
      for (let barrier = 0; barrier < 3; barrier += 1) await host.consumeBarrier();
    };
    const queueNotices = async (kind?: KLS2CNoticeKind): Promise<KLS2CNotice[]> => {
      const read = await call<{ status: string; value?: { notices: { itemKey: string; summary: string }[] } }>(
        'decisions/queue', plain(scope, { workspace: scope, sections: ['notices'], categories: ['project_notice'],
          page: { limit: 100 } }));
      if (read.status !== 'ready' || read.value === undefined) throw new Error(`decisions/queue: ${JSON.stringify(read)}`);
      return read.value.notices
        .filter(item => kind === undefined || item.summary.includes(NOTICE_WORDS[kind]))
        .map(item => ({ noticeId: item.itemKey.slice('project_notice:'.length), summary: item.summary }));
    };
    return {
      host, root, scope, database, call, idle, notices: queueNotices,
      noticesWithin: async (kind, rounds = 20) => {
        for (let round = 0; round < rounds; round += 1) {
          await idle();
          const found = await queueNotices(kind);
          if (found.length > 0) return found;
        }
        return [];
      },
      edit: (rel, text) => {
        mkdirSync(dirname(underRoot(rel)), { recursive: true });
        const staged = join(root, `.kls2c-edit-${randomUUID()}`);
        writeFileSync(staged, text);
        renameSync(staged, underRoot(rel));
      },
      remove: rel => { rmSync(underRoot(rel), { force: true }); },
      read: rel => (existsSync(underRoot(rel)) ? readFileSync(underRoot(rel)) : null),
      git: args => gitIn(root, ...args),
      close: () => host.close(),
    };
  } catch (error) {
    await host.close();
    throw error;
  }
}

/** A test-controlled gate: when `point` is reached, `reached` settles and the step waits for `release()`. */
export function holdGate(point: KLS2CHoldPoint): {
  hold: (p: KLS2CHoldPoint) => Promise<void>; reached: Promise<void>; release(): void;
} {
  let reach!: () => void;
  let open!: () => void;
  const reached = new Promise<void>(resolve => { reach = resolve; });
  const released = new Promise<void>(resolve => { open = resolve; });
  return {
    reached,
    release: () => open(),
    hold: p => {
      if (p !== point) return Promise.resolve();
      reach();
      return released;
    },
  };
}

type KLS2CNoteAnchor = { kind: 'module'; moduleId: string } | { kind: 'file'; path: string };

/** The `notes/write` body of a person's `convention` note; its conclusion is `<topic> 结论`; `replaces` default none. */
export const kls2cNoteWrite = (scope: CoreScope, commandId: string,
  note: { topic: string; anchor: KLS2CNoteAnchor; replaces?: string[] }) =>
  plain(scope, {
    commandId, goalId: null, expectedPointerRevision: null,
    note: {
      kind: 'convention', topic: note.topic, conclusion: `${note.topic} 结论`, body: `${note.topic} 正文`,
      anchor: note.anchor, extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: note.replaces ?? [],
      contradicts: [], coexistWith: [],
    },
  });

/** The Project and Workspace pins a graph write declares, read through `workspaces/registration`. */
export async function kls2cScopePins(world: KLS2CHost): Promise<unknown[]> {
  const read = await world.call<{ status: string; value?: { project: { revision: number }; workspace: { revision: number } } }>(
    'workspaces/registration', plain(world.scope, world.scope));
  if (read.status !== 'ready' || read.value === undefined) throw new Error(`workspaces/registration: ${JSON.stringify(read)}`);
  return [{ ref: projectRef(world.scope), revision: read.value.project.revision },
    { ref: workspaceRef(world.scope), revision: read.value.workspace.revision }];
}

/** The `architecture/adopt-initial` body: one module per id, its paths `src/<id>`, responsibility `own <id>`. */
export async function kls2cAdoptBody(world: KLS2CHost, moduleIds: string[]): Promise<unknown> {
  const projectId = world.scope.projectId;
  return graphWrite(world.scope, {
    baselineId: 'kls2c-baseline', description: 'KLS2C', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: moduleIds.map(moduleId => ({ ref: { projectId, moduleId }, name: moduleId,
        responsibility: `own ${moduleId}`, paths: [`src/${moduleId}`], interfaces: [] })) },
  }, 'kls2c-adopt', await kls2cScopePins(world));
}

export async function kls2cAdopt(world: KLS2CHost, moduleIds: string[]): Promise<void> {
  const answer = await world.call<{ status?: string }>('architecture/adopt-initial', await kls2cAdoptBody(world, moduleIds));
  if (answer.status !== 'committed') throw new Error(`architecture/adopt-initial: ${JSON.stringify(answer)}`);
}

/** The `architecture/revise` body with one `set_responsibility`, against the current architecture read. */
export async function kls2cReviseBody(world: KLS2CHost, moduleId: string, text: string, requestId: string): Promise<unknown> {
  const current = await world.call<{ status: string; value?: {
    catalog: { ref: unknown }; baseline: { ref: unknown; contentDigest: string } } }>(
    'architecture/read', plain(world.scope, { selection: { kind: 'current' } }));
  if (current.status !== 'ready' || current.value === undefined) throw new Error(`architecture/read: ${JSON.stringify(current)}`);
  return graphWrite(world.scope, {
    expected: { catalogRef: current.value.catalog.ref,
      baseline: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest } },
    ops: [{ op: 'set_responsibility', moduleId, text }], responsibilityMoves: [], reason: 'KLS2C',
  }, requestId, await kls2cScopePins(world));
}

/** `architecture/revise` with one `set_responsibility`, against the current architecture read. */
export async function kls2cReviseResponsibility(world: KLS2CHost, moduleId: string, text: string, requestId: string): Promise<void> {
  const answer = await world.call<{ status?: string }>('architecture/revise',
    await kls2cReviseBody(world, moduleId, text, requestId));
  if (answer.status !== 'committed') throw new Error(`architecture/revise: ${JSON.stringify(answer)}`);
}

/** The root-relative path of the module file whose `id` is `moduleId` (module files have random names). */
export function kls2cModuleFile(world: KLS2CHost, moduleId: string): string {
  const folder = join(world.root, '.workbench/modules');
  const name = readdirSync(folder).find(file =>
    (JSON.parse(readFileSync(join(folder, file), 'utf8')) as { id?: string }).id === moduleId);
  if (name === undefined) throw new Error(`no module file for ${moduleId}`);
  return `.workbench/modules/${name}`;
}

/**
 * A person makes the module files of `core` and `other` (adopted by `kls2cAdopt`) conflict, as K07 names it:
 * `same_id` writes `"id": "core"` into `other`'s file, `same_path` gives `other` the path `src/core`. Answers the
 * two files' paths (`core`'s, then `other`'s).
 */
export function kls2cConflict(world: KLS2CHost, kind: 'same_id' | 'same_path'): [string, string] {
  const core = kls2cModuleFile(world, 'core');
  const other = kls2cModuleFile(world, 'other');
  const file = JSON.parse(world.read(other)?.toString('utf8') ?? '{}') as Record<string, unknown>;
  world.edit(other, `${JSON.stringify(kind === 'same_id' ? { ...file, id: 'core' } : { ...file, paths: ['src/core'] }, null, 2)}\n`);
  return [core, other];
}

/** JSON with its object keys sorted at every level, two-space indent. */
function sortedJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sort(v)]))
      : item;
  return JSON.stringify(sort(value), null, 2);
}

/**
 * A note file as a teammate writes it, by the 2a-1 file format ([2A1-13]) and not by `src`: the version line, the
 * JSON header (sorted keys, the twelve header keys), a `---` line, then the body.
 */
export function noteFileText(input: { kind: string; topic: string; conclusion: string; body: string;
  anchor: KLS2CNoteAnchor; source: { kind: 'user'; principalId: string } | { kind: 'platform' } }): string {
  const header = { anchor: input.anchor, basisFiles: [], coexistWith: [], conclusion: input.conclusion, contradicts: [],
    extraAnchors: [], facts: [], kind: input.kind, replaces: [], source: input.source, structural: false, topic: input.topic };
  return `--- knowledge-note@1\n${sortedJson(header)}\n---\n${input.body}`;
}

/** An idle threshold no row reaches: only the startup reconcile and the named triggers run (K38, K39, crash child). */
export const KLS2C_NEVER_IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * Out-of-process crash ([2C1-08]): a child Host from `dist/` (`KLS2C-crash-child.mjs`) on the same project store and
 * root (SQLite) with `knowledgeWriteHold` stopping at `point`. `write` gets the child's public route call and must not
 * wait for it; once the child prints `held:<point>` it is SIGKILLed, and the call returns after it has exited. Close
 * any Host of this test on the same store first; reopen afterwards with `openKLS2CHost({ database, root })`.
 */
export async function crashAt(input: { point: KLS2CHoldPoint; database: string; root: string; scope?: CoreScope;
  write: (call: (suffix: string, body: unknown) => Promise<unknown>) => void }): Promise<void> {
  if (!existsSync(fileURLToPath(new URL('../../dist/app/host.js', import.meta.url)))) {
    throw new Error('crashAt runs the built Host: run npm run build first');
  }
  const configPath = join(await tempDir('kls2c-crash-'), 'config.json');
  writeFileSync(configPath, JSON.stringify({ database: input.database, actor: OPERATOR, publicDir: await publicDirectory(),
    idleMs: KLS2C_NEVER_IDLE_MS, workspaces: [workspaceEntry(input.scope ?? KLS2C_SCOPE, input.root)] }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./KLS2C-crash-child.mjs', import.meta.url))], {
    env: { ...process.env, KLS2C_CONFIG: configPath, KLS2C_HOLD: input.point }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); });
  const lines: string[] = [];
  let pending = '';
  let stderr = '';
  let answered: string | null = null;
  let wake: () => void = () => undefined;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    pending += chunk;
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      lines.push(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
    wake();
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  void exited.then(() => wake());
  const childLine = async (match: (line: string) => boolean, what: string): Promise<string> => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const line = lines.find(match);
      if (line !== undefined) return line;
      if (child.exitCode !== null || child.signalCode !== null || answered !== null || Date.now() > deadline) {
        throw new Error(`the crash child printed no ${what} line; answer: ${answered}; stderr: ${stderr}`);
      }
      await new Promise<void>(resolve => { wake = resolve; setTimeout(resolve, 1_000); });
    }
  };
  try {
    const ready = JSON.parse(await childLine(line => line.startsWith('{'), 'ready')) as { url: string };
    const token = await readPageToken(ready.url);
    input.write((suffix, body) => {
      const answer = corePost(ready.url, suffix, token, body).then(response => response.json() as Promise<unknown>);
      answer.then(value => { answered = JSON.stringify(value); wake(); }, () => undefined);
      return answer;
    });
    await childLine(line => line === `held:${input.point}`, `held:${input.point}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}

/** The answer of `knowledge/recovery-items` (a read: `ready` with the items by `itemNo`, or not found). */
export type KLS2CRecoveryItems = { status: string; code?: string;
  value?: { items: { itemNo: number; kind: 'write_unconfirmed' | 'reverted'; path: string }[] } };
/** The answer of `knowledge/recover` (a write: `committed` with the path and the written blob, or rejected). */
export type KLS2CRecovered = { status: string; code?: string; reason?: string; value?: { path: string; blobSha: string | null } };

/** `knowledge/recovery-items {noticeId}` (SEAM-2C, errata 2c1#2: any registered workspace of the project as scope). */
export const kls2cRecoveryItems = (world: KLS2CHost, noticeId: string, scope: CoreScope = world.scope) =>
  world.call<KLS2CRecoveryItems>('knowledge/recovery-items', plain(scope, { noticeId }));
/** `knowledge/recover {noticeId, itemNo}`. */
export const kls2cRecover = (world: KLS2CHost, noticeId: string, itemNo: number, scope: CoreScope = world.scope) =>
  world.call<KLS2CRecovered>('knowledge/recover', plain(scope, { noticeId, itemNo }));

/** A file's blob id by real `git hash-object` in the root (independent of `src`); null when the file is not there. */
export const kls2cBlobSha = (world: KLS2CHost, rel: string): string | null =>
  world.read(rel) === null ? null : world.git(['hash-object', '--', rel]).trim();

/** At most 20 idle heartbeats until the queue holds at least `count` notices of `kind`; what it holds then. */
export async function kls2cNoticesAtLeast(world: KLS2CHost, kind: KLS2CNoticeKind, count: number): Promise<KLS2CNotice[]> {
  let found = await world.notices(kind);
  for (let round = 0; round < 20 && found.length < count; round += 1) {
    await world.idle();
    found = await world.notices(kind);
  }
  return found;
}

const KLS2C_CORE_ANCHOR: KLS2CNoteAnchor = { kind: 'module', moduleId: 'core' };

/** A person's note through `notes/write` (on `module:core` unless told; `core` adopted first); its id and file. */
export async function kls2cWrittenNote(world: KLS2CHost, commandId: string, topic: string,
  anchor: KLS2CNoteAnchor = KLS2C_CORE_ANCHOR): Promise<{ noteId: string; path: string }> {
  const answer = await world.call<{ write: { status: string; noteId?: string } }>('notes/write',
    kls2cNoteWrite(world.scope, commandId, { topic, anchor }));
  if (answer.write.status !== 'accepted' || answer.write.noteId === undefined) {
    throw new Error(`notes/write was not accepted: ${JSON.stringify(answer)}`);
  }
  return { noteId: answer.write.noteId, path: `.workbench/notes/${world.scope.workspaceId}/${answer.write.noteId}.md` };
}

/** The note's item in `notes/list` on `module:core` (the row fails when it is not there). */
export async function kls2cListedNote(world: KLS2CHost, noteId: string): Promise<{ topic: string; verify: unknown }> {
  const page = await world.call<{ status: string; value?: { items: { noteId: string; topic: string; verify: unknown }[] } }>(
    'notes/list', plain(world.scope, { anchor: KLS2C_CORE_ANCHOR, limit: 100, cursor: null }));
  const item = page.value?.items.find(entry => entry.noteId === noteId);
  if (page.status !== 'ready' || item === undefined) throw new Error(`notes/list has no ${noteId}: ${JSON.stringify(page)}`);
  return item;
}

/** A person's hand edit of a module file (JSON): `fields` set, the rest as it was, written whole; the new text. */
export function kls2cEditModule(world: KLS2CHost, rel: string, fields: Record<string, unknown>): string {
  const text = `${JSON.stringify({ ...JSON.parse(world.read(rel)?.toString('utf8') ?? '{}') as object, ...fields }, null, 2)}\n`;
  world.edit(rel, text);
  return text;
}

/**
 * KLS-2c-1d: the same seam, armed by the row when it needs it (every earlier write passes). `hold()` stops the next
 * write at `point` until `release()` (an in-flight write); `fail()` makes the next write fail there once (A2), as a
 * file write that failed after the commit, or a process that died there, leaves it: the records committed, no file
 * landed, its write logs `pending`. In process the leases are still let go.
 */
export function armedSeam(point: KLS2CHoldPoint): {
  seam: (p: KLS2CHoldPoint) => Promise<void>; hold(): { reached: Promise<void>; release(): void }; fail(): void;
} {
  let next: ((p: KLS2CHoldPoint) => Promise<void>) | null = null;
  return {
    seam: p => {
      if (p !== point || next === null) return Promise.resolve();
      const stop = next;
      next = null;
      return stop(p);
    },
    hold() {
      const gate = holdGate(point);
      next = gate.hold;
      return { reached: gate.reached, release: gate.release };
    },
    fail() { next = () => Promise.reject(new Error(`KLS2C: the write stopped at '${point}'`)); },
  };
}
