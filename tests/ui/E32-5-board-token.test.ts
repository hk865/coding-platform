import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CoreRouteBindings } from '../../src/app/core-routes.js';
import { bootBoardPage } from '../../src/ui/boot.js';
import { FakeElement, installFakeDom, restoreFakeDom } from './helpers/dom.js';
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
  restoreFakeDom();
  await server?.close();
  server = undefined;
});

describe('E32-5 board token', () => {
  it('injects the token into a board page only, with no-store', async () => {
    server = createWorkbenchServer({
      token: TOKEN,
      bindings: {} as CoreRouteBindings,
      actor: { kind: 'human', id: 'e32-operator' },
      bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
      allowsScope: () => false,
      publicDir,
    });
    const address = await server.listen(0);
    const origin = `http://${address.host}:${address.port}`;

    const board = await fetch(`${origin}/workbench/TaskMap.dc.html`);
    expect(board.status).toBe(200);
    expect(await board.text()).toContain(`<meta name="platform-token" content="${TOKEN}">`);
    expect(board.headers.get('cache-control')).toBe('no-store');

    const support = await fetch(`${origin}/workbench/support.js`);
    expect(support.status).toBe(200);
    expect(await support.text()).not.toContain(TOKEN);

    expect(readFileSync(`${root}src/ui/boards/TaskMap.dc.html`, 'utf8')).not.toContain(TOKEN);
  });

  it('a page without the token meta mounts the sample board and makes no core call', async () => {
    const source = readFileSync(`${root}src/ui/boards/TaskMap.dc.html`, 'utf8');
    const dom = installFakeDom();
    const page = dom as unknown as {
      title: string; readyState: string; head: FakeElement; addEventListener(): void;
      querySelector(selector: string): FakeElement | null;
    };
    const rootElement = new FakeElement('x-dc');
    page.title = '任务图';
    page.readyState = 'loading';
    page.head = new FakeElement('head');
    page.addEventListener = () => {};
    page.querySelector = (selector) => (selector === 'x-dc' ? rootElement : null);
    const createElement = dom.createElement;
    dom.createElement = (tag) => {
      const element = createElement(tag);
      if (tag === 'template') Object.defineProperty(element, 'content', { get: () => createElement('#fragment') });
      return element;
    };

    const savedFetch = globalThis.fetch;
    const savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const calls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      return { text: async () => source } as unknown as Response;
    }) as typeof fetch;
    Object.defineProperty(globalThis, 'location', {
      value: { href: 'http://host/workbench/TaskMap.dc.html', search: '' }, configurable: true,
    });
    try {
      await bootBoardPage();
    } finally {
      globalThis.fetch = savedFetch;
      if (savedLocation) Object.defineProperty(globalThis, 'location', savedLocation);
      else delete (globalThis as { location?: unknown }).location;
    }

    expect(calls).toEqual(['http://host/workbench/TaskMap.dc.html']);
    expect(rootElement.textContent).toContain('状态机可靠性改造');
  });
});
