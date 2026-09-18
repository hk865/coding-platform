import {expect,test} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {selectProject} from './helpers';
import {semanticCollaborationFixture} from '../../../tests/app/semantic-collaboration-fixture.js';

for(const mode of ['normal','choice','changed-source'] as const){
const humanChoice=mode!=='normal';
test(mode==='changed-source'?'来源在选项检查后改变时界面拒绝旧选择':humanChoice?'真实任务通过界面选择未决产品适用范围后完成必要独立审阅':'同一个真实开发任务显示协调调查来源、必要独立审阅和原始 FAIL',async({page},testInfo)=>{
  const built=await import(new URL('../../../dist/app/server.js',import.meta.url).href) as {createGuiServer:Parameters<typeof semanticCollaborationFixture>[0]};
  const run=()=>semanticCollaborationFixture(built.createGuiServer,async({base,scope,final,review})=>{
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
  },humanChoice?{humanChoice:true,chooseHumanOption:async(base,input,fixture)=>{
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
    // The answer remains historical while its exact choice is still applicable.
    const before=await (await page.request.get(base+'/api/state?'+new URLSearchParams({projectId:input.projectId,workspaceId:input.workspaceId,goalId:input.goalId}))).json();
    expect(before.queries.find((q:any)=>q.currentAnswer?.answerId===input.answerRef.answerId).currentAnswer.stale).toBe(true);
    if(mode==='changed-source') {
      const sourcePath=join(fixture.root,'USE-CASE.md'),original=await readFile(sourcePath,'utf8');
      // Source identity includes metadata; restoring text cannot revive old authority.
      await writeFile(sourcePath,original+'\nChanged source invalidates the old choice.');
      const refused=page.waitForResponse(response=>response.url()===base+'/api/real/feedback/choose');
      await option.click();
      const rejection=await refused;
      expect(rejection.status()).toBe(400);
      expect(JSON.stringify(await rejection.json())).toContain('source changed');
      await expect(option).toBeDisabled();
      await choice.getByRole('button',{name:'重新检查选项',exact:true}).click();
      await expect(choice.getByText('Decision source changed; request current options',{exact:true}).first()).toBeVisible();
      await expect(option).toBeDisabled();
      throw Error('EXPECTED_SOURCE_REFUSAL_NO_DECISION');
    }

    await page.screenshot({path:testInfo.outputPath('semantic-human-options.png'),fullPage:true});
    let release!:()=>void,arrived!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    const waiting=new Promise<void>(resolve=>{arrived=resolve;});
    await page.route(base+'/api/real/feedback/choose',async route=>{
      const original=await route.fetch();arrived();await barrier;await route.fulfill({response:original});
    });
    const responsePromise=page.waitForResponse(response=>response.url()===base+'/api/real/feedback/choose' && response.request().method()==='POST');
    await option.click();
    try { await waiting;await selectProject(page,'acceptance-beta'); }
    finally { release(); }
    const response=await responsePromise;
    await expect(page.getByText('决定已记录：',{exact:false})).toHaveCount(0);
    await page.unroute(base+'/api/real/feedback/choose');
    await selectProject(page,'acceptance-alpha');
    await page.getByTestId('goal-'+input.goalId).click();
    expect(response.request().postDataJSON()).toEqual(input);
    const body=await response.json();
    expect(response.status(),JSON.stringify(body)).toBe(200);
    await expect(page.getByText('关联人的决定：'+body.decisionRef.decisionId,{exact:false}).first()).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('semantic-human-recorded.png'),fullPage:true});
    return {status:response.status(),body};
  }}:{});
  if(mode==='changed-source')await expect(run()).rejects.toThrow('EXPECTED_SOURCE_REFUSAL_NO_DECISION');
  else await run();
});
}
