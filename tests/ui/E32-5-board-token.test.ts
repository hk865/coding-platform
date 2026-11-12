import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CoreRouteBindings } from '../../src/app/core-routes.js';
import { bootPage, findClass } from './helpers/boot-page.js';
import { createWorkbenchServer, type WorkbenchServer } from '../../src/app/server.js';

/**
 * E32-5 (ruling item 4): a board response carries the per-instance token meta
 * and `no-store`; the token enters neither `support.js` nor the board source.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const publicDir = `${root}dist/app/public/workbench`;
const TOKEN = 'e32-token';

let server: WorkbenchServer | undefined;

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-ui.mjs'], { cwd: root, stdio: 'pipe' });
}, 30_000);

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('E32-5 board token', () => {
  it('injects the token into a board page only, with no-store', async () => {
    server = createWorkbenchServer({
      token: TOKEN,
      bindings: () => ({}) as CoreRouteBindings,
      actor: { kind: 'human', id: 'e32-operator' },
      bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
      allowsScope: () => false,
      publicDir,
    });
    const address = await server.listen(0);
    const origin = `http://${address.host}:${address.port}`;

    /* E3-NAV §4.3: the second working copy goes through the same static-page
       injection; TaskMap keeps its row. */
    for (const name of ['ArchOverview', 'Chain', 'Decide', 'Done', 'Goals', 'Main', 'Member', 'TaskMap']) {
      const board = await fetch(`${origin}/workbench/${name}.dc.html`);
      expect(board.status).toBe(200);
      expect(await board.text()).toContain(`<meta name="platform-token" content="${TOKEN}">`);
      expect(board.headers.get('cache-control')).toBe('no-store');

      expect(readFileSync(`${root}src/ui/boards/${name}.dc.html`, 'utf8')).not.toContain(TOKEN);
    }

    const support = await fetch(`${origin}/workbench/support.js`);
    expect(support.status).toBe(200);
    expect(await support.text()).not.toContain(TOKEN);
  });

  it('a TaskMap page without the token meta mounts the empty board and makes no core call', async () => {
    let routeCalls = 0;
    const page = await bootPage({
      name: 'TaskMap', token: null,
      request: async (url) => {
        if (url.includes('/api/real/core/')) routeCalls += 1;
        return new Response('{}', { status: 404 });
      },
    });
    try {
      /* Ruling 1: no token is the empty page, not the sample board. */
      expect(page.pageFetches()).toBe(1);
      expect(routeCalls).toBe(0);
      const text = page.root.textContent;
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('状态机可靠性改造');
      expect(text).not.toContain('状态机规格对齐');
      expect(text).not.toContain('目标验收');
      expect(text).not.toContain('{{');
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('undefined');
      /* The empty copy is UNSPECIFIED by the frozen rulings; only the default
         DAG frame and its now column are asserted. */
      expect(findClass(page.root, 'dg-now')).toBeDefined();
    } finally {
      await page.restore();
    }
  });
});
