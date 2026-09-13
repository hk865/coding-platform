import { expect, test } from '@playwright/test';
import { api, openApp, waitForSynced } from './helpers';

const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main' };
const run = 'ui06scope-' + Date.now();

/**
 * Scope isolation for a delayed command-check report.
 *
 * The report projection needs a real run to exist, so this spec injects ONE
 * synthetic live run into the real `/api/state` answer (everything else — goals,
 * projects, HTTP, SQLite — stays real). What is under test is the UI rule: a report
 * request that is still in flight when the user switches goal must never render
 * under the new goal, and the new goal must show its own (empty) verification state.
 */
test.describe('UI-06 报告作用域隔离', () => {
  test('延迟的报告响应不显示在新目标下，切换后展示新作用域自身状态', async ({ page }) => {
    // The state route stays registered while the page polls, so release in-flight
    // handlers explicitly; otherwise the next test inherits this test's rejection.
    try {
      await openApp(page);
      await waitForSynced(page);
      const other = await api(page, '/api/goals', { ...scope, requestId: run + '-other', objective: 'UI-06 报告作用域隔离对照目标 ' + run }) as { status: number; body: { goalId: string } };
      expect(other.status).toBe(200);

      const check = {
        requestId: 'scope-probe-' + run, status: 'finished', command: 'echo scope-probe', kind: 'dynamic', timeoutMs: 1000,
        startedAt: '2026-09-08T10:00:00.000Z', finishedAt: '2026-09-08T10:00:01.000Z',
        result: { status: 'ready', observations: [{ checkId: 'command-dynamic', kind: 'dynamic', result: 'PASS', summary: 'dynamic command-dynamic: tool_check (PASS)', artifactRef: { digest: 'a'.repeat(64) } }] },
      };
      await page.route('**/api/state**', async route => {
        const response = await route.fetch();
        const body = await response.json() as { goalId?: string; liveRuns?: unknown[] };
        if (body.goalId === 'acceptance-demo') {
          body.liveRuns = [{
            spec: { ...scope, goalId: 'acceptance-demo', runId: 'real-scope-probe', taskId: 'scope-probe', instruction: 'scope probe', budget: {} },
            status: 'completed', error: null, usage: [], trace: [], commandChecks: [check], configuration: null,
          }];
        }
        await route.fulfill({ response, json: body });
      });
      await page.getByTestId('goal-acceptance-demo').click();
      await page.getByTestId('tab-verification').click();
      await expect(page.getByTestId('report-' + check.requestId)).toBeVisible({ timeout: 20_000 });

      // Delay the report answer, then switch goal while it is still in flight.
      await page.route('**/api/real/verifications/check-report', async route => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            requestId: check.requestId, status: 'finished', command: 'echo scope-probe', kind: 'dynamic', timeoutMs: 1000,
            startedAt: check.startedAt, finishedAt: check.finishedAt, observations: check.result.observations,
            reports: [{
              schemaVersion: 1, observationId: 'scope-observation',
              owner: { aggregateType: 'Run', projectId: scope.projectId, goalId: 'acceptance-demo', runId: 'real-scope-probe' },
              context: { projectId: scope.projectId, goalId: 'acceptance-demo', taskId: 'scope-probe', planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: 'scope-plan' }, workspaceRevision: 3, changeScope: { diffClass: 'code-change', changedFiles: [], writeSummary: '' } },
              sourceDigest: 'b'.repeat(64), definition: { checkId: 'command-dynamic', kind: 'dynamic', command: 'echo scope-probe', cwd: '.', timeoutMs: 1000 },
              startedAt: check.startedAt, endedAt: check.finishedAt, category: 'tool_check', result: 'PASS',
              execution: { exitCode: 0, signal: null, timedOut: false, cancelled: false, stdout: { text: 'scope-probe', totalBytes: 11, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false }, sandboxProfileVersion: 'probe', timings: { executionMs: 1 } },
            }],
          }),
        });
      });
      await page.getByTestId('report-' + check.requestId).click();
      await page.getByTestId('goal-' + other.body.goalId).click();

      // Wait past the delayed answer: it belongs to the previous goal and must not render here.
      await page.waitForTimeout(7000);
      await expect(page.getByTestId('check-report')).toHaveCount(0);
      await expect(page.getByTestId('right-workbench')).toContainText('还没有真实运行');
      await expect(page.getByTestId('right-workbench')).not.toContainText('scope-probe');

      // Returning to the original goal shows its own record again, without the stale report.
      await page.getByTestId('goal-acceptance-demo').click();
      await expect(page.getByTestId('report-' + check.requestId)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('check-report')).toHaveCount(0);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});
