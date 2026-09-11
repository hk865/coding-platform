import {expect,test} from '@playwright/test';
import {semanticCollaborationFixture} from '../../../tests/app/semantic-collaboration-fixture.js';

for(const humanChoice of [false,true]){
test(humanChoice?'真实任务通过界面选择未决产品适用范围后完成必要独立审阅':'同一个真实开发任务显示协调调查来源、必要独立审阅和原始 FAIL',async({page},testInfo)=>{
  const built=await import(new URL('../../../dist/app/server.js',import.meta.url).href) as {createGuiServer:Parameters<typeof semanticCollaborationFixture>[0]};
  await semanticCollaborationFixture(built.createGuiServer,async({base,scope,final,review})=>{
    await page.goto(base+'/workbench?'+new URLSearchParams(scope),{waitUntil:'domcontentloaded'});
    await expect(page.getByTestId('app')).toBeVisible();
    await expect(page.getByText('执行反馈',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('协调角色调查',{exact:true}).first()).toBeVisible();
    const answer=page.locator('article.message.assistant').filter({hasText:'协调角色调查'}).filter({hasText:'Label rule v1'}).first();
    await expect(answer).toContainText('Label rule v1');
    await answer.locator('summary').click();
    await expect(answer).toContainText('RULES.md');
    await page.screenshot({path:testInfo.outputPath('semantic-conversation.png'),fullPage:true});
    await page.getByTestId('tab-verification').click();
    const successor=final.liveRuns.find((r:any)=>r.spec.mode!=='review' && r.spec.taskId.startsWith('rework-'));
    await page.getByTestId('open-round-'+successor.rounds[0].requestId).click();
    await expect(page.getByTestId('round-outcome')).toHaveText('INCONCLUSIVE');
    await expect(page.getByTestId('verification-round-detail')).toContainText('已接纳');
    await page.getByTestId('open-review-'+review.requestId).click();
    await expect(page.getByTestId('review-requirements')).toContainText('semantic-review');
    await expect(page.getByTestId('review-requirements')).toContainText('PASS');
    await expect(page.getByTestId('review-detail')).toContainText('satisfied');
    await page.getByTestId('review-raw-report').click();
    await expect(page.getByTestId('review-raw-body')).toContainText('independent-review-result');
    await expect(page.getByTestId('review-raw-body')).toContainText('source:normalize.py');
    await page.screenshot({path:testInfo.outputPath('semantic-independent-review.png'),fullPage:true});
    await page.getByTestId('open-round-first-check').click();
    await expect(page.getByTestId('round-outcome')).toHaveText('FAIL');
    await page.getByTestId('round-report-label-behavior').click();
    await expect(page.getByTestId('check-report')).toContainText('AssertionError');
    await page.screenshot({path:testInfo.outputPath('semantic-original-fail.png'),fullPage:true});
  },humanChoice?{humanChoice:true,chooseHumanOption:async(base,input)=>{
    await page.goto(base+'/workbench?'+new URLSearchParams({projectId:input.projectId,workspaceId:input.workspaceId,goalId:input.goalId}),{waitUntil:'domcontentloaded'});
    const choice=page.getByTestId('feedback-choice');
    await expect(choice).toBeVisible();
    await expect(choice).toContainText('需要你的目标澄清');
    await expect(choice).toContainText('USE-CASE.md identifies ingestion as the next integration milestone');
    await expect(choice).toContainText('Retain the original failed report');
    await expect(choice).toContainText('User-facing display labels');
    await expect(choice).toContainText('Authorize the machine-facing catalog ingestion use case');
    await expect(choice).toContainText('Authorize the presentation-text use case');
    const option=choice.getByText('Catalog import identifiers（推荐）',{exact:true}).locator('..').getByRole('button',{name:'选择此项',exact:true});
    await expect(option).toBeEnabled();
    await page.screenshot({path:testInfo.outputPath('semantic-human-options.png'),fullPage:true});
    const responsePromise=page.waitForResponse(response=>response.url()===base+'/api/real/feedback/choose' && response.request().method()==='POST');
    await option.click();
    const response=await responsePromise;
    expect(response.request().postDataJSON()).toEqual(input);
    const body=await response.json();
    expect(response.status(),JSON.stringify(body)).toBe(200);
    await expect(page.getByText('关联人的决定：'+body.decisionRef.decisionId,{exact:false}).first()).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('semantic-human-recorded.png'),fullPage:true});
    return {status:response.status(),body};
  }}:{});
});
}
