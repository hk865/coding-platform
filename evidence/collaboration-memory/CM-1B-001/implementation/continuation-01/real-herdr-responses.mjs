import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createGuiServer} from '../../../../../dist/app/server.js';
import {defaultSettingsDirectory} from '../../../../../dist/app/model-settings.js';
const output=resolve('evidence/collaboration-memory/CM-1B-001/implementation/continuation-01/real-herdr-responses-01.json');
const dir=await mkdtemp(join(tmpdir(),'cm1b-real-model-')),root='/mnt/d/1.project/Software/herdr-master/herdr-master';
const options={workspaceRoots:{'acceptance-alpha':root,'acceptance-beta':root},modelSettings:{directory:defaultSettingsDirectory(resolve('.local/gui'))}};
const evidence={kind:'real-provider-through-product-query-runtime',provider:'deepseek',model:'deepseek-flash',sourceProjectsModified:false,sourceProject:root,startedAt:new Date().toISOString(),saves:[],runs:[]};
let app,base,token;
const start=async()=>{app=await createGuiServer(join(dir,'data'),options);await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
  base='http://127.0.0.1:'+app.server.address().port;token=(await(await fetch(base+'/api/meta')).json()).workspaceToken;};
const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify(body)});
  if(!response.ok)throw Error('Product request failed');return response.json();};
const scope={projectId:'acceptance-alpha',workspaceId:'workspace-main',goalId:'acceptance-demo'};
const questions={reply:'请仅查看根目录 README.md，介绍这个项目的用途和你可以提供的帮助。不要运行命令或修改文件。',architecture:'请仅查看 README.md、AGENTS.md、Cargo.toml 和 src/main.rs，解释项目架构、职责与接口边界。不要运行命令或修改文件，未知信息明确说明。',progress:'请仅根据根目录 README.md 和已提供的目标事实汇报目前可确认的状态、未知项和下一步；没有运行或验证证据时不得说已完成。不要运行命令或修改文件。'};
const query=async(stage,purpose)=>{
  const id='real-memory-'+stage+'-'+purpose;
  await post('/api/real/queries',{...scope,requestId:id,responsePurpose:purpose,question:questions[purpose]});
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const run=(await post('/api/real/queries/runs',scope)).runs.find(row=>row.runRef.runId==='real-query-'+id);
    if(run&&run.status!=='running'){
      const input=JSON.parse(run.input),row={stage,purpose,status:run.status,input:input,result:run.result,configuration:run.configuration??null};
      evidence.runs.push(row);await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
      console.log(JSON.stringify({stage,purpose,status:run.status,profileRevision:input.maintainedPreferences?.profileRevision,answerChars:run.result?.answer?.length??0}));
      if(run.status!=='completed')throw Error('Real query incomplete');return;
    }
    await new Promise(done=>setTimeout(done,250));
  }
  throw Error('Real query timed out');
};
try{
  await start();
  evidence.saves.push(await post('/api/real/memory/profile/maintain',{requestId:'brief',expectedRevision:0,edits:[{operation:'remember',entryId:'brief',content:'所有回应使用中文，简洁说明，通常不超过三句话。'}]}));
  for(const purpose of ['reply','architecture','progress'])await query('before',purpose);
  evidence.saves.push(await post('/api/real/memory/profile/maintain',{requestId:'specific',expectedRevision:1,edits:[
    {operation:'remember',entryId:'architecture',content:'架构解释请详细说明职责、接口边界、方案取舍和未确定信息；这一用途不受通常三句话限制。',conditions:{purposes:['architecture'],expiresAt:null}},
    {operation:'remember',entryId:'progress',content:'进度汇报保持简洁，说明事实、阻塞、下一步，不编造完成情况。',conditions:{purposes:['progress'],expiresAt:null}}]}));
  await app.close();app=null;await start();evidence.restartedBeforeAfter=true;
  for(const purpose of ['reply','architecture','progress'])await query('after',purpose);
  evidence.adoption=await post('/api/real/memory/project/adoption',scope);evidence.status='completed';
}catch{evidence.status='incomplete';console.log(JSON.stringify({status:'incomplete',completedRuns:evidence.runs.length}));process.exitCode=1;}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(evidence,null,2)+'\n');await app?.close();await rm(dir,{recursive:true,force:true});}
