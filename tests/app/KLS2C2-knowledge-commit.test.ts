/**
 * KLS-2c-2a status and commit through a real Host (K12b, K30–K35; [2C2-06]–[2C2-09]; errata 2c2#3, #4; G10).
 * The checkout is a real git repository under the test's own root; the knowledge files come from the public adoption
 * and revision, a person edits, stages and commits with real git, and the platform answers on `knowledge/status` and
 * `knowledge/commit`. Checks read git itself (HEAD, the commit's files and message, the index, the config) and the
 * decision queue. The world is `KLS2C-knowledge-host.ts` with an idle threshold no row reaches (only the named
 * reconciles run), unless a row says otherwise; only K12b (snapshots) runs on both backends. The builder's owner rows
 * for what these leave open joined them at the dedupe: a staged rename (K30), an empty message (K32) and a pre-commit
 * hook slower than the 15 seconds of the other git calls (about 17 seconds, the only row that catches that timeout).
 *
 * Names from SEAM-2C2 that the tree before 2c-2a does not have (checked at the merge): the plain routes
 * `knowledge/status` `{scope, input: {}}` → `{status: 'ready', value: {branch, dirty, files, localOnly}}` (errata
 * 2c2#4: `input` must be there) and `knowledge/commit` `{scope, input: {message}}` → `{status: 'ready', value: {commit,
 * branch, files}}` or a rejection (errata 2c2#3: no `committed`, nothing is recorded). The answers are typed here.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { plain, readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cEditModule, kls2cModuleFile, kls2cReviseResponsibility, KLS2C_NEVER_IDLE_MS, noteFileText,
  openKLS2CHost, type KLS2CHost, type KLS2COpenOptions,
} from '../helpers/KLS2C-knowledge-host.js';
import { gitIn } from '../scenarios/support/git-workspace.js';
import { settingsPost } from './support/S8A-L8-host.js';

type Answer<V> = { status: string; code?: string; reason?: string; value?: V };
type StatusValue = { branch: string; dirty: number; files: number; localOnly: boolean };
type CommitValue = { commit: string; branch: string; files: number };

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
  vi.unstubAllEnvs();
  await cleanupRestart();
});

async function hostWorld(opts: Partial<KLS2COpenOptions> = {}): Promise<KLS2CHost> {
  const world = await openKLS2CHost({ storage: 'memory', git: true, idleMs: KLS2C_NEVER_IDLE_MS, ...opts });
  worlds.push(world);
  return world;
}

const statusOf = (world: KLS2CHost, scope: CoreScope = world.scope) =>
  world.call<Answer<StatusValue>>('knowledge/status', plain(scope, {}));
const commitOf = (world: KLS2CHost, message: string | null, scope: CoreScope = world.scope) =>
  world.call<Answer<CommitValue>>('knowledge/commit', plain(scope, { message }));
const headOf = (root: string): string => gitIn(root, 'rev-parse', 'HEAD').trim();
const linesOf = (text: string): string[] => text.split('\n').filter(line => line !== '').sort();

/** The person names themselves in this repository (its local git config), as anyone does before committing. */
function personIdentity(world: KLS2CHost): void {
  world.git(['config', 'user.name', 'KLS2C2 Person']);
  world.git(['config', 'user.email', 'kls2c2-person@example.invalid']);
}

/** `core` adopted through the route and its files committed by the person: `.workbench/` is clean. */
async function adoptedAndCommitted(world: KLS2CHost): Promise<string> {
  await kls2cAdopt(world, ['core']);
  world.git(['add', '--', '.workbench']);
  world.git(['commit', '-q', '-m', 'kls2c2 architecture']);
  return kls2cModuleFile(world, 'core');
}

/** [2C2-07]: a commit the platform made answers `ready` with HEAD's full sha. */
function expectCommitted(world: KLS2CHost, answer: Answer<CommitValue>): void {
  expect(answer, JSON.stringify(answer)).toMatchObject({ status: 'ready', value: { commit: headOf(world.root) } });
}

/**
 * The row's own git environment from here on (the Host's git runs in this process): a fresh HOME with `gitconfig` as
 * its `.gitconfig`, no XDG or system config, the C locale. The person's real git config is never read or changed.
 */
async function isolatedGit(gitconfig: string): Promise<void> {
  const home = await tempDir('kls2c2-home-');
  writeFileSync(join(home, '.gitconfig'), gitconfig);
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', join(home, '.config'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('LC_ALL', 'C');
}

/**
 * The Host's clock as a Host input (A8) the row switches: held at T0 the idle reconcile never runs (threshold one
 * minute; the first heartbeat read T0 as the moment the platform went idle); `idle()` moves it ten minutes past T0,
 * a second more each call, so every heartbeat reconciles and each round's snapshots are later than the last.
 */
function switchedClock(): { now: () => string; idle(): void; busy(): void } {
  const t0 = Date.parse('2026-11-12T00:00:00.000Z');
  let at = t0;
  let step = 0;
  return {
    now: () => new Date(at).toISOString(),
    idle: () => { step += 1; at = t0 + 600_000 + step * 1_000; },
    busy: () => { at = t0; },
  };
}

describe.each(['memory', 'sqlite'] as const)('%s', storage => {
  it('K12b knowledge/commit reconciles its line before it answers: the committed module file\'s snapshots go, so '
    + 'writing the adopted bytes back right after is no revert', async () => {
    const clock = switchedClock();
    const world = await hostWorld({ storage, idleMs: 60_000, now: clock.now });
    await world.idle();
    const idleRound = async (): Promise<void> => { clock.idle(); await world.idle(); clock.busy(); };
    personIdentity(world);
    await kls2cAdopt(world, ['core']);
    const file = kls2cModuleFile(world, 'core');
    const adopted = world.read(file)?.toString('utf8') ?? '';
    await idleRound();
    await kls2cReviseResponsibility(world, 'core', 'k12b 修订后', 'kls2c2-k12b-revise');
    expect(world.read(file)?.toString('utf8')).not.toBe(adopted);
    await idleRound();
    expectCommitted(world, await commitOf(world, null));
    // 提交之后没有空闲对账，人马上把模块文件写回采用时的字节；之后才放空闲对账。
    world.edit(file, adopted);
    clock.idle();
    // 具名改坏 [2C2-08]「删 commit 之后的 reconcile('after_commit')」→ 采用时的字节还在快照里，出一条撤回通知，红在这一句。
    expect(await world.noticesWithin('knowledge_reverted')).toEqual([]);
  }, 180_000);
});

const teammateNote = (topic: string): string => noteFileText({ kind: 'convention', topic, conclusion: `${topic} 结论`,
  body: `${topic} 正文`, anchor: { kind: 'module', moduleId: 'core' }, source: { kind: 'user', principalId: 'teammate' } });

it.each([
  ['未暂存的改动', 1, 1, (world: KLS2CHost, file: string) => { kls2cEditModule(world, file, { responsibility: 'k30 改' }); }],
  ['暂存后再改', 2, 1, (world: KLS2CHost, file: string) => {
    kls2cEditModule(world, file, { responsibility: 'k30 暂存' });
    world.git(['add', '--', file]);
    kls2cEditModule(world, file, { responsibility: 'k30 再改' });
  }],
  ['一个新的未跟踪文件', 1, 1, (world: KLS2CHost) => {
    world.edit('.workbench/modules/0123456789abcdef0123456789abcdef.json', '{}\n');
  }],
  ['新子目录里两个未跟踪文件', 2, 2, (world: KLS2CHost) => {
    world.edit('.workbench/notes/k30-teammate/0f1e2d3c4b5a69788796a5b4c3d2e1f0.md', teammateNote('k30 一'));
    world.edit('.workbench/notes/k30-teammate/1f1e2d3c4b5a69788796a5b4c3d2e1f0.md', teammateNote('k30 二'));
  }],
  ['只改 local/', 0, 0, (world: KLS2CHost) => { world.edit('.workbench/local/k30.json', '{}\n'); }],
  ['暂存的改名（只算新路径）', 1, 1, (world: KLS2CHost, file: string) => {
    world.git(['mv', file, '.workbench/modules/2f1e2d3c4b5a69788796a5b4c3d2e1f0.json']);
  }],
] as const)('K30 knowledge/status: %s → %i places, %i paths', async (_, dirty, files, change) => {
  const world = await hostWorld();
  change(world, await adoptedAndCommitted(world));
  // 具名改坏 [2C2-06]「git status 去掉 --untracked-files=all」→ 新目录只记 1 处、1 个路径，只“新子目录”条目红在这一句。
  // 具名改坏 [2C2-06]「改名的旧路径也算一个文件」→ 2 个路径，只“暂存的改名”条目红在这一句。
  expect(await statusOf(world)).toEqual({ status: 'ready', value: {
    branch: world.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), dirty, files, localOnly: false } });
}, 120_000);

it('K31 knowledge/commit commits .workbench/ only: the code the person staged stays staged', async () => {
  const world = await hostWorld();
  personIdentity(world);
  world.edit('src/a.ts', 'export const a = 31;\n');
  world.git(['add', '--', 'src/a.ts']);
  await kls2cAdopt(world, ['core']);
  const knowledge = linesOf(world.git(['ls-files', '--others', '--exclude-standard', '--', '.workbench']));
  const answer = await commitOf(world, null);
  expectCommitted(world, answer);
  // 采用 core 写了两个文件（architecture.json 和 core 的模块文件），回答的 files 是 2。
  expect(answer.value?.files).toBe(2);
  // 具名改坏 [2C2-07]「git commit 不带 -- .workbench/」→ 暂存区的 src/a.ts 一起进了提交，红在这一句。
  expect(linesOf(world.git(['show', '--name-only', '--format=', 'HEAD']))).toEqual(knowledge);
  expect(linesOf(world.git(['diff', '--cached', '--name-only']))).toEqual(['src/a.ts']);
}, 120_000);

it.each([
  ['没给说明：默认说明带文件数', null, '更新架构图和注记（1 个文件）'],
  ['给了说明：原样用', 'x', 'x'],
  ['空串：也用默认说明', '', '更新架构图和注记（1 个文件）'],
] as const)('K32 the commit message: %s', async (_, message, expected) => {
  const world = await hostWorld();
  personIdentity(world);
  kls2cEditModule(world, await adoptedAndCommitted(world), { responsibility: 'k32 改' });
  // 具名改坏 [2C2-07]「只有 null 用默认说明」→ git 拒绝空说明、回 unavailable，只第三条红在这一句。
  expectCommitted(world, await commitOf(world, message));
  // 具名改坏 [2C2-07]「忽略 message、总用默认说明」→ 只第二条红在这一句。
  expect(world.git(['log', '-1', '--format=%B']).trim()).toBe(expected);
}, 120_000);

it('K33 a pre-commit hook that refuses: its words come back as they are, it ran once, HEAD stays', async () => {
  const world = await hostWorld();
  personIdentity(world);
  await kls2cAdopt(world, ['core']);
  const runs = join(await tempDir('kls2c2-k33-'), 'runs.txt');
  const hook = join(world.root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, `#!/bin/sh\necho run >> '${runs}'\necho hook-said-no >&2\nexit 1\n`);
  chmodSync(hook, 0o755);
  await isolatedGit('');
  const before = headOf(world.root);
  expect(await commitOf(world, null)).toMatchObject({ status: 'rejected', reason: expect.stringContaining('hook-said-no') });
  expect(headOf(world.root)).toBe(before);
  // 具名改坏 [2C2-07]「失败后再试一次」→ 钩子跑了两次，红在这一句（2 行）。
  expect(linesOf(readFileSync(runs, 'utf8'))).toHaveLength(1);
}, 120_000);

it('[2C2-07] a pre-commit hook slower than the 15 seconds of the other git calls: the commit waits for it and answers '
  + 'the new HEAD, its branch and the files', async () => {
  const world = await hostWorld();
  personIdentity(world);
  kls2cEditModule(world, await adoptedAndCommitted(world), { responsibility: '慢钩子' });
  const hook = join(world.root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nsleep 17\n');
  chmodSync(hook, 0o755);
  const before = headOf(world.root);
  const answer = await commitOf(world, 'slow hook');
  // 具名改坏 [2C2-07]「提交也用 15 秒超时」→ git 在钩子里被杀、回 unavailable、HEAD 不动，红在这两句。
  expect(headOf(world.root)).not.toBe(before);
  expect(answer).toEqual({ status: 'ready', value: { commit: headOf(world.root),
    branch: world.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), files: 1 } });
}, 120_000);

it('K34 no user name or email: git\'s own words come back, HEAD stays, the config is still empty', async () => {
  const world = await hostWorld();
  await kls2cAdopt(world, ['core']);
  // 隔离的 HOME、仓库里都不配名字和邮箱；useConfigOnly 只让 git 不拿机器名猜一个身份（这台机器的主机名带域名，猜得出）。
  await isolatedGit('[user]\n\tuseConfigOnly = true\n');
  for (const name of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) {
    vi.stubEnv(name, undefined);
  }
  const before = headOf(world.root);
  // git 的原话（缺身份时的提示）。
  expect(await commitOf(world, null))
    .toMatchObject({ status: 'rejected', reason: expect.stringContaining('Please tell me who you are') });
  expect(headOf(world.root)).toBe(before);
  // 具名改坏 [2C2-07]「失败后自动 git config user.name/user.email」→ 红在这一句。
  expect(['user.name', 'user.email'].map(key =>
    spawnSync('git', ['config', '--get', key], { cwd: world.root, encoding: 'utf8' }).stdout.trim())).toEqual(['', '']);
}, 120_000);

it('K35 kept on this machine only: status says so, commit is forbidden and HEAD stays', async () => {
  const world = await hostWorld();
  personIdentity(world);
  await kls2cAdopt(world, ['core']);
  const { url } = await world.host.listen();
  const set = await settingsPost(url, 'knowledge-local', await readPageToken(url), { ...world.scope, localOnly: true });
  expect(await set.json()).toMatchObject({ status: 'ready' });
  expect(await statusOf(world)).toMatchObject({ status: 'ready', value: { localOnly: true } });
  const before = headOf(world.root);
  // 具名改坏 [2C2-08]「删 commit 的 localOnly 拒绝」→ 走到 git add（.workbench/ 已被忽略）回别的拒绝，红在 forbidden。
  expect(await commitOf(world, null))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: expect.stringContaining('只留在本机') });
  expect(headOf(world.root)).toBe(before);
}, 120_000);
