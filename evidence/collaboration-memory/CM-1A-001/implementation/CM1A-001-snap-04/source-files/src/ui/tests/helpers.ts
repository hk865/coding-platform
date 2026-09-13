import { expect, type Page } from '@playwright/test';

export const APP = '/workbench';

export async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(APP + query, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app')).toBeVisible();
  await expect(page.getByTestId('conversation')).toBeVisible();
}

export async function selectProject(page: Page, projectId: string): Promise<void> {
  await page.getByTestId('project-select').click();
  await page.getByRole('option', { name: projectId === 'acceptance-alpha' ? '主验收项目' : '隔离对照项目' }).click();
  await expect(page.getByTestId('app')).toBeVisible();
}

export async function waitForSynced(page: Page): Promise<void> {
  await expect(page.getByTestId('syncing')).toHaveCount(0, { timeout: 20_000 });
}

/** Server-scoped API call from the test process (never from the page). */
export async function api(page: Page, path: string, body?: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(async ({ path, body }) => {
    const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
    const response = await fetch(path, body === undefined
      ? { headers: { 'x-platform-token': meta.workspaceToken } }
      : { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': meta.workspaceToken }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}
