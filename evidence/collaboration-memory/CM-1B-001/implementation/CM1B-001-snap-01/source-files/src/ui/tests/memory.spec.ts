import {expect,test} from '@playwright/test';
import {api,openApp,selectProject} from './helpers';
import {verificationRoundFixture} from '../../../tests/app/verification-round-fixture.js';

test('records public experience from an actual run through the browser and preserves it after restart',async({page})=>{
  const cleanup:Array<()=>Promise<void>>=[];
  const built=await import(new URL('../../../dist/app/server.js',import.meta.url).href) as {createGuiServer:NonNullable<Parameters<typeof verificationRoundFixture>[2]>};
  try{
    const fixture=await verificationRoundFixture(cleanup,true,built.createGuiServer);
    const open=async()=>{await page.goto(fixture.baseUrl()+'/workbench?'+new URLSearchParams(fixture.scope));
      await expect(page.getByTestId('app')).toBeVisible();await page.getByTestId('add-view').click();await page.getByTestId('open-memory').click();
      await page.getByRole('combobox',{name:'记忆范围',exact:true}).click();await page.getByRole('option',{name:'当前项目经验',exact:true}).click();};
    await open();
    await page.getByRole('combobox',{name:'经验来源运行',exact:true}).click();await page.getByRole('option').filter({hasText:fixture.runId}).click();
    await page.getByLabel('经验结论',{exact:true}).fill('BROWSER_PUBLIC_EXPERIENCE: Verify current file versions before continuing.');
    await page.getByLabel('经验依据',{exact:true}).fill('Observed in the selected public execution; no verification PASS is claimed.');
    await page.getByRole('button',{name:'保存公开经验',exact:true}).click();
    await expect(page.getByText(/经验已保存，项目版本/)).toBeVisible();
    const result=await api(page,'/api/real/memory/project/view',fixture.scope) as {body:{snapshot:{entries:Array<{source:{kind:string};content:string}>}}};
    expect(result.body.snapshot.entries).toEqual(expect.arrayContaining([expect.objectContaining({source:expect.objectContaining({kind:'work_note'}),content:'BROWSER_PUBLIC_EXPERIENCE: Verify current file versions before continuing.'})]));
    await fixture.restart();await open();
    await expect(page.getByText('BROWSER_PUBLIC_EXPERIENCE: Verify current file versions before continuing.',{exact:true})).toBeVisible();
  }finally{for(const close of cleanup.reverse())await close();}
});

test('maintains profile memory through UI, persists across projects and exposes conflicts without claiming adoption',async({page})=>{
  await openApp(page);await page.getByTestId('add-view').click();await page.getByTestId('open-memory').click();
  const text='BROWSER_MEMORY_'+Date.now();
  await page.getByLabel('记住一条偏好或经验').fill(text);
  await page.getByRole('button',{name:'记住',exact:true}).click();
  await expect(page.getByText(/已保存，版本/)).toBeVisible();
  await expect(page.getByText('尚无真实回应输入记录。')).toBeVisible();
  await selectProject(page,'acceptance-beta');await page.getByTestId('add-view').click();await page.getByTestId('open-memory').click();
  await expect(page.getByText(text,{exact:true})).toBeVisible();
  const entry=page.getByText(text,{exact:true}).locator('..');
  await entry.getByRole('button',{name:'纠正',exact:true}).click();
  await page.getByLabel('纠正记忆',{exact:true}).fill(text+'_corrected');
  // Advance the real collection through another human request before saving the
  // stale editor. This is a real CAS conflict, not a mocked HTTP failure.
  const view=await api(page,'/api/real/memory/profile/view',{}) as {body:{snapshot:{revision:number}}};
  expect(await api(page,'/api/real/memory/profile/maintain',{requestId:'competing-'+text,expectedRevision:view.body.snapshot.revision,
    edits:[{operation:'remember',entryId:'competing-'+text,content:'Concurrent preference '+text}]})).toMatchObject({status:200,body:{status:'committed'}});
  await page.getByRole('button',{name:'保存纠正',exact:true}).click();
  await expect(page.getByText(/未确认保存.*Memory changed/)).toBeVisible();
  await expect(page.getByText(text,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'保存纠正',exact:true}).click();
  await expect(page.getByText(text+'_corrected',{exact:true})).toBeVisible();
  await page.getByText(text+'_corrected',{exact:true}).locator('..').getByRole('button',{name:'删除',exact:true}).click();
  await page.reload();await page.getByTestId('add-view').click();await page.getByTestId('open-memory').click();
  await expect(page.getByText(text+'_corrected',{exact:true})).toHaveCount(0);
  expect(await api(page,'/api/real/memory/profile/view',{})).toMatchObject({status:200,body:{status:'ready',snapshot:{entries:expect.arrayContaining([{entryId:expect.any(String),revision:3,state:'removed',content:null,origin:'explicit',conditions:expect.any(Object),source:expect.any(Object),digest:expect.any(String),createdAt:expect.any(String),updatedAt:expect.any(String)}])}}});
});

test('three purposes show different real responses and historical adoption versions after explicit UI saves',async({page})=>{
  test.skip(process.env['MEMORY_MODEL_STUB']!=='1','Requires the explicitly labelled deterministic model fixture');
  await openApp(page);await page.getByTestId('goal-acceptance-demo').click();
  expect(await api(page,'/api/model-settings',{provider:'deepseek',model:'labelled-browser-memory-stub',baseUrl:'http://127.0.0.1',apiKey:'LOCAL_TEST_KEY'})).toMatchObject({status:200});
  await page.getByTestId('add-view').click();await page.getByTestId('open-memory').click();
  await page.getByLabel('记住一条偏好或经验').fill('MEMORY_ALL_BRIEF_browser: 全部回复简洁。');
  await page.getByRole('button',{name:'记住',exact:true}).click();await expect(page.getByText(/已保存，版本/)).toBeVisible();
  const scope={projectId:'acceptance-alpha',workspaceId:'workspace-main',goalId:'acceptance-demo'};
  let count=0;
  const ask=async(label:string)=>{
    await page.getByRole('combobox',{name:'响应用途',exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();
    await page.getByTestId('semantic-question').fill('请说明当前公开情况。');await page.getByTestId('semantic-ask').click();count++;
    await expect.poll(async()=>{
      const result=await api(page,'/api/real/queries/runs',scope) as {body:{runs:{status:string}[]}};
      return result.body.runs.filter(run=>run.status==='completed').length;
    }).toBe(count);
  };
  for(const label of ['日常回复','架构解释','进度汇报'])await ask(label);
  await page.getByLabel('记住一条偏好或经验').fill('MEMORY_ARCH_DETAIL_browser: 架构解释详细，其他用途保留原偏好。');
  await page.getByRole('combobox',{name:'适用响应',exact:true}).click();await page.getByRole('option',{name:'架构解释',exact:true}).click();
  await page.getByRole('button',{name:'记住',exact:true}).click();await expect(page.getByText('MEMORY_ARCH_DETAIL_browser: 架构解释详细，其他用途保留原偏好。',{exact:true})).toBeVisible();
  for(const label of ['日常回复','架构解释','进度汇报'])await ask(label);
  await expect(page.getByText('架构详细：说明模块职责、接口边界和方案取舍。此处是确定性模型见证。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'刷新采用记录'}).click();
  await expect(page.getByText(/输入采用：用户/)).toHaveCount(6);
  const records=await api(page,'/api/real/queries/runs',scope) as {body:{runs:{input:string}[]}};
  const inputs=records.body.runs.map(run=>JSON.parse(run.input));
  expect(inputs.filter(input=>input.maintainedPreferences.entries.some((row:{entry:{content:string}})=>row.entry.content.includes('MEMORY_ARCH_DETAIL_browser')))).toHaveLength(1);
  expect(new Set(inputs.map(input=>input.maintainedPreferences.profileRevision)).size).toBe(2);
});
