import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

/** Browser operations belong to the same Host, Goal and persisted scenario. */
export async function openCollaborationBrowser(base: string, scope: Record<string, string>, output: string) {
  await mkdir(output, { recursive: true });
  const requireUi = createRequire(resolve('src/ui/package.json'));
  const { chromium } = requireUi('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } });
  let closed = false;
  const descendantPids = async (pid: number): Promise<number[]> => {
    try { const children = (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number); return [...children, ...(await Promise.all(children.map(descendantPids))).flat()]; } catch { return []; }
  };
  page.setDefaultTimeout(20000);
  assert.equal((await page.goto(base + '/workbench?' + new URLSearchParams(scope)))?.status(), 200);
  const memory = async () => { if (await page.getByTestId('tab-memory').count()) await page.getByTestId('tab-memory').click(); else { await page.getByTestId('add-view').click(); await page.getByTestId('open-memory').click(); } };
  const responseFor = (path: string, requestId?: string) => page.waitForResponse((r: any) => new URL(r.url()).pathname === path && (!requestId || r.request().postDataJSON()?.requestId === requestId));
  const readResponse = async (response: any) => { const result = await response; assert.equal(result.status(), 200); return await result.json(); };
  const save = async (button: string) => {
    const response = page.waitForResponse((r: any) => r.url().endsWith('/api/real/memory/profile/maintain'));
    await page.getByRole('button', { name: button, exact: true }).click();
    const received = await response; assert.equal(received.status(), 200);
    const receipt = await received.json(); assert.equal(receipt.status, 'committed');
    const command = received.request().postDataJSON();
    await writeFile(join(output, `profile-${receipt.revision}.json`), JSON.stringify({ command, receipt }, null, 2));
    return { command, receipt };
  };
  return {
    browser, page,
    async close() {
      if (closed) return; closed = true;
      const descendants = await descendantPids(process.pid);
      await browser.close();
      assert(descendants.length > 0, 'Browser process tree must be observable before claiming cleanup');
      const remaining = [];
      for (const pid of descendants) { try { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]; if (state !== 'Z') remaining.push({ pid, state }); } catch {} }
      await writeFile(join(output, 'process-exit-audit.json'), JSON.stringify({ hostPid: process.pid, observedDescendantPids: descendants, remainingLiveDescendants: remaining }, null, 2));
      assert.equal(remaining.length, 0, 'Browser close must not leave live descendants of this test Host');
    },
    async remember(content: string) {
      await memory(); await page.getByLabel('记住一条偏好或经验', { exact: true }).fill(content);
      const saved = await save('记住'); assert.equal(saved.receipt.revision, 1);
      await page.screenshot({ path: join(output, 'profile-before.png'), fullPage: true });
      return saved.command.edits[0].entryId as string;
    },
    async correct(architecture: string, progress: string, reply: string) {
      await memory(); await page.getByRole('button', { name: '纠正', exact: true }).click();
      await page.getByLabel('纠正记忆', { exact: true }).fill(architecture);
      await page.getByRole('combobox', { name: '适用响应', exact: true }).click(); await page.getByRole('option', { name: '架构解释', exact: true }).click();
      assert.equal((await save('保存纠正')).receipt.revision, 2);
      await page.getByLabel('记住一条偏好或经验', { exact: true }).fill(progress);
      await page.getByRole('combobox', { name: '适用响应', exact: true }).click(); await page.getByRole('option', { name: '进度汇报', exact: true }).click();
      assert.equal((await save('记住')).receipt.revision, 3);
      await page.getByLabel('记住一条偏好或经验', { exact: true }).fill(reply);
      await page.getByRole('combobox', { name: '适用响应', exact: true }).click(); await page.getByRole('option', { name: '日常回复', exact: true }).click();
      const final = await save('记住'); assert.equal(final.receipt.revision, 4);
      await page.screenshot({ path: join(output, 'profile-corrected.png'), fullPage: true });
      return final.receipt.revision as number;
    },
    async decision(input: any, row: any, onRequest: (input: any) => void) {
      // The centre ConversationHost stays mounted while right-side memory edits.
      const center = page.getByTestId('center');
      const card = center.getByTestId('architecture-review'); await card.waitFor();
      // A committed modification can precede the next UI poll. Wait for the
      // exact new proposal, not merely the already-visible old review card.
      await card.getByText(row.review.proposalDigest, { exact: false }).waitFor();
      assert((await card.innerText()).includes(row.review.proposalDigest)); assert((await card.innerText()).includes('groupTodos'));
      await center.getByLabel('决定说明', { exact: true }).fill(input.summary);
      if (input.outcome === 'modify') await center.getByLabel('修改后的方案说明（修改会产生新提案）', { exact: true }).fill(input.description);
      await page.screenshot({ path: join(output, input.outcome + '-before-decision.png'), fullPage: true });
      const received = page.waitForResponse((r: any) => r.url().endsWith('/api/real/architecture-reviews/decide'));
      const listener = (request: any) => { if (request.url().endsWith('/api/real/architecture-reviews/decide')) onRequest(request.postDataJSON()); };
      page.on('request', listener);
      try {
        const [response] = await Promise.all([received,
          center.getByRole('button', { name: ({ accept: '接受', reject: '拒绝', defer: '延后', modify: '修改并重新待决' } as Record<string, string>)[input.outcome], exact: true }).click()]);
        assert.equal(response.status(), 200); return await response.json();
      } finally { page.off('request', listener); }
    },
    async adopted(requestId: string, inputDigest: string) {
      await memory(); await page.getByRole('button', { name: '刷新采用记录', exact: true }).click();
      await page.getByText('real-query-' + requestId, { exact: false }).waitFor();
      assert((await page.locator('body').innerText()).includes(inputDigest));
      await page.screenshot({ path: join(output, 'current-adoption.png'), fullPage: true });
    },
    async recovered(row: any, initialPid: number) {
      assert.notEqual(process.pid, initialPid, 'PID is an OS process witness, not a field purportedly displayed by the UI');
      const card = page.getByTestId('center').getByTestId('architecture-review');
      await card.getByText('全部已通知：是；全部受影响工作已有调用采用证据：是', { exact: true }).waitFor();
      const text = await card.innerText();
      assert(text.includes(row.review.proposalDigest));
      assert(text.includes(({ accepted: '已接受', rejected: '已拒绝', deferred: '已延后' } as Record<string, string>)[row.review.status]!));
      for (const target of row.targets.filter((t: any) => t.mode === 'resume')) {
        assert(text.includes(target.workId)); assert(text.includes(target.runId)); assert(text.includes(target.requestDigest));
      }
      await writeFile(join(output, 'recovered-facts.json'), JSON.stringify({ initialPid, recoveredHostPid: process.pid, scope, row, displayedText: text, boundary: 'PID comes from actual child execution; DOM proves adoption facts loaded by the new Host.' }, null, 2));
      await page.screenshot({ path: join(output, 'recovered-adoption.png'), fullPage: true });
    },
    async completed(finalState: any, verification: Record<string, any>) {
      const refreshed = page.waitForResponse((r: any) => { const u = new URL(r.url()); return u.pathname === '/api/state' && Object.entries(scope).every(([key, value]) => u.searchParams.get(key) === value); });
      await page.getByTestId('refresh').click(); const facts = await readResponse(refreshed);
      assert.equal(facts.goalId, scope['goalId']); assert.equal(facts.goalStatus.status, 'ready'); assert.equal(facts.goalStatus.goal.phase, 'COMPLETED');
      assert.deepEqual(facts.goalStatus.goal, finalState.goalStatus.goal, 'The visible Goal must use the same formal persisted completion fact');
      await page.getByTestId('center').getByText('目标：COMPLETED', { exact: true }).waitFor();
      await page.screenshot({ path: join(output, 'same-goal-completed.png'), fullPage: true });
      await writeFile(join(output, 'completed-facts.json'), JSON.stringify({ scope, goalStatus: facts.goalStatus, hostPid: process.pid }, null, 2));
      if (await page.getByTestId('tab-verification').count()) await page.getByTestId('tab-verification').click();
      else { await page.getByTestId('add-view').click(); await page.getByTestId('open-verification').click(); }
      for (const taskId of ['reader-a', 'reader-b', 'coordinator', 'goal-gate']) {
        const expected = verification[taskId], requestId = expected.round.round.requestId;
        const loading = responseFor('/api/real/verifications/rounds/read', requestId);
        await page.getByTestId('open-round-' + requestId).click(); const round = await readResponse(loading);
        assert.deepEqual(round.scope, expected.target); assert.equal(round.current.status, 'current');
        assert.equal(round.materialIdentity.sourceDigest, expected.round.round.materialIdentity.sourceDigest);
        assert.deepEqual(round.materialIdentity.planRef, expected.round.round.materialIdentity.planRef);
        const detail = page.getByTestId('verification-round-detail');
        await detail.getByText(round.scope.taskId + ' / ' + round.scope.runId, { exact: true }).waitFor();
        await detail.getByText(round.materialIdentity.sourceDigest, { exact: true }).waitFor();
        const shown = await detail.innerText(); assert(shown.includes(round.scope.runId)); assert(shown.includes(round.materialIdentity.planRef.planId)); assert(shown.includes('当前有效来源'));
        if (taskId !== 'goal-gate') {
          const check = round.checks[0]; assert.equal(check.definition.mode, 'readonly-report');
          const loadingReport = responseFor('/api/real/verifications/check-report', check.requestId);
          await page.getByTestId('round-report-' + check.definition.checkId).click(); const report = await readResponse(loadingReport);
          assert.deepEqual(report.reports, expected.report.reports, 'DOM report fetch must return the original persisted bodies verified by the same scenario');
          const original = report.reports.find((r: any) => r.readonlyReport)?.readonlyReport; assert(original?.report);
          await page.getByTestId('check-report').getByText(round.scope.runId, { exact: true }).waitFor();
          const body = page.getByTestId('readonly-report-0'); await body.waitFor(); assert.equal(await body.textContent(), original.report);
          const reportText = await page.getByTestId('check-report').innerText(); assert(reportText.includes(round.scope.runId)); assert(reportText.includes(round.materialIdentity.sourceDigest));
          for (const source of original.sourceReads) { assert(reportText.includes(source.path)); assert(reportText.includes(source.revision)); }
        }
        const reviewId = expected.review.requestId;
        const loadingReview = responseFor('/api/real/verifications/reviews/read', reviewId);
        await page.getByTestId('open-review-' + reviewId).click(); const review = await readResponse(loadingReview);
        assert.equal(review.current.status, 'current'); assert.equal(review.phase, 'settled'); assert.equal(review.formal.taskPhase, 'satisfied');
        if (taskId === 'goal-gate') assert.equal(review.formal.goalPhase, 'COMPLETED');
        const reviewDetail = page.getByTestId('review-detail'); await reviewDetail.getByText(review.work.reviewerRunRef.runId, { exact: true }).waitFor();
        assert((await reviewDetail.innerText()).includes('当前有效'));
        await writeFile(join(output, taskId + '-verification.json'), JSON.stringify({ round, review }, null, 2));
        await page.screenshot({ path: join(output, taskId + '-verification.png'), fullPage: true });
      }
    },
  };
}
