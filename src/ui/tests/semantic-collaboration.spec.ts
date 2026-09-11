import {expect,test} from '@playwright/test';
import {semanticCollaborationFixture} from '../../../tests/app/semantic-collaboration-fixture.js';

test('同一个真实开发任务显示协调调查来源、当前重验和原始 FAIL',async({page},testInfo)=>{
  const built=await import(new URL('../../../dist/app/server.js',import.meta.url).href) as {createGuiServer:Parameters<typeof semanticCollaborationFixture>[0]};
  await semanticCollaborationFixture(built.createGuiServer,async({base,scope,final})=>{
    await page.goto(base+'/workbench?'+new URLSearchParams(scope),{waitUntil:'domcontentloaded'});
    await expect(page.getByTestId('app')).toBeVisible();
    await expect(page.getByText('执行反馈',{exact:true})).toBeVisible();
    await expect(page.getByText('协调角色调查',{exact:true})).toBeVisible();
    const answer=page.locator('article.message.assistant').filter({hasText:'协调角色调查'});
    await expect(answer).toContainText('Label rule v1');
    await answer.locator('summary').click();
    await expect(answer).toContainText('RULES.md');
    await page.screenshot({path:testInfo.outputPath('semantic-conversation.png'),fullPage:true});
    await page.getByTestId('tab-verification').click();
    const successor=final.liveRuns.find((r:any)=>r.spec.taskId.startsWith('rework-'));
    await page.getByTestId('open-round-'+successor.rounds[0].requestId).click();
    await expect(page.getByTestId('round-outcome')).toHaveText('PASS');
    await expect(page.getByTestId('verification-round-detail')).toContainText('已接纳');
    await page.getByTestId('open-round-first-check').click();
    await expect(page.getByTestId('round-outcome')).toHaveText('FAIL');
    await page.getByTestId('round-report-label-behavior').click();
    await expect(page.getByTestId('check-report')).toContainText('AssertionError');
    await page.screenshot({path:testInfo.outputPath('semantic-original-fail.png'),fullPage:true});
  });
});
