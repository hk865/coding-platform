import {expect,test} from '/mnt/d/1.project/Software/agent_platform/src/ui/node_modules/@playwright/test/index.mjs';
import {api,openApp,selectProject} from '/mnt/d/1.project/Software/agent_platform/src/ui/tests/helpers.ts';
import {verificationRoundFixture} from '/mnt/d/1.project/Software/agent_platform/tests/app/verification-round-fixture.ts';

test('records public experience from an actual run through the browser and preserves it after restart',async({page})=>{
  const cleanup:Array<()=>Promise<void>>=[];
  const {CodingAgentRuntime}=await import('file:///mnt/d/1.project/Software/agent_platform/dist/execution/worker-runtime/coding-agent-runtime.js');
  const originalClose=CodingAgentRuntime.prototype.close;
  CodingAgentRuntime.prototype.close=async function(){console.log('[DEBUG-m-close] runtime-enter');await originalClose.call(this);console.log('[DEBUG-m-close] runtime-exit');};
  const {Server}=await import('node:http');const originalHttpClose=Server.prototype.close;
  Server.prototype.close=function(callback){console.log('[DEBUG-m-close] http-enter',this.address());this.getConnections((error,count)=>console.log('[DEBUG-m-close] connections',count));return originalHttpClose.call(this,(error)=>{console.log('[DEBUG-m-close] http-exit',error?.message);callback?.(error);});};
  cleanup.push(async()=>{CodingAgentRuntime.prototype.close=originalClose;Server.prototype.close=originalHttpClose;});
  const built=await import(new URL('file:///mnt/d/1.project/Software/agent_platform/dist/app/server.js',import.meta.url).href) as {createGuiServer:NonNullable<Parameters<typeof verificationRoundFixture>[2]>};
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
    console.log('[DEBUG-m-close] restart-enter');await fixture.restart();console.log('[DEBUG-m-close] restart-exit');await open();
    await expect(page.getByText('BROWSER_PUBLIC_EXPERIENCE: Verify current file versions before continuing.',{exact:true})).toBeVisible();
  }finally{for(const close of cleanup.reverse())await close();}
});




