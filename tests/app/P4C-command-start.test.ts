import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { createLocalWorkbenchHost } from '../../src/app/host.js';
import { corePost, plain, readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import { writeHostPage } from '../helpers/host-page.js';
import { EXPECTED_ROUTE_ROWS } from '../helpers/S6B3-route-suffixes.js';

/**
 * P4 命令页的服务行（冻结稿 11-18）：R6 把 `verification/installed-checks` 登记成
 * `platform.confirmInstalledChecks` 的 plain 读；R5-1 在受理前拒绝非正的 `timeoutMs`，走真实 Host 路由
 * （KLS2A2 的写法），真实 bubblewrap，只跑 memory。
 * 具名改坏：路由没登记或绑定名不对（路由行红）；去掉 `isPos` 判断（拒绝行红在 0 被受理）。
 */

it('P4C R6 publishes verification/installed-checks as a plain read of the installed checks', () => {
  expect(CORE_ROUTE_SPECS['verification/installed-checks']).toEqual(EXPECTED_ROUTE_ROWS['verification/installed-checks']);
});

describe('rejects: commands/start with a non-positive timeoutMs', () => {
  it('refuses 0 and then accepts the same requestId with a legal timeout as a running handle', async () => {
    const scope: CoreScope = { projectId: 'p4c-start-project', workspaceId: 'p4c-start-workspace' };
    const root = await mkdtemp(join(tmpdir(), 'p4c-start-ws-'));
    const publicDir = await mkdtemp(join(tmpdir(), 'p4c-start-public-'));
    await writeHostPage(publicDir);
    const host = await createLocalWorkbenchHost({
      storage: { kind: 'memory' }, actor: { kind: 'human', id: 'p4c-start-operator' }, publicDir,
      workspaces: [{ scope, name: 'P4C start workspace', root, workspaceRevision: 1, readPrefixes: ['.'],
        writePrefixes: ['.'], allowCommands: true }],
    });
    try {
      const base = (await host.listen()).url;
      const token = await readPageToken(base);
      const start = async (timeoutMs: number): Promise<unknown> => await (await corePost(base, 'commands/start', token,
        plain(scope, { requestId: 'p4c-start-timeout', command: 'sleep 10', cwd: '.', timeoutMs }))).json();
      expect(await start(0)).toMatchObject({ status: 'rejected', code: 'invalid' });
      /* 被拒的那次什么都没记下：同一个 requestId 换合法时长，回一个新的、running 的句柄。 */
      expect(await start(60_000))
        .toMatchObject({ status: 'ready', value: { commandId: expect.any(String), state: 'running', error: null } });
    } finally {
      await host.close();
      for (const directory of [root, publicDir]) await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
