const $ = id => document.getElementById(id);
let current, selected, pending=null, token;
window.addEventListener('platform-state',event=>{current=event.detail;});
window.addEventListener('platform-scope-changing',()=>{current=null;if(dialog.open)dialog.close();});
const dialog=document.createElement('dialog'); dialog.id='verification-dialog';
dialog.innerHTML='<form id="verification-form"><div class="dialog-head"><h2>导入独立验收</h2><button type="button" id="verification-close" class="icon-button" aria-label="关闭验收导入">×</button></div><p class="verification-explanation">先登记候选补丁与必测集合，再导入评分结果。成绩由服务器核对；原始成绩、诊断复跑和辅助修复分别保存。</p><label for="verification-file">选择候选登记材料或评分材料（JSON）</label><input class="verification-file" id="verification-file" type="file" accept=".json,application/json" required><div id="verification-preview" class="verification-preview" hidden></div><p id="verification-error" role="alert"></p><button id="verification-submit" class="primary" type="submit" disabled>核对并导入</button></form>';
document.body.append(dialog);
$('verification-close').onclick=()=>dialog.close();
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-import-verification]'); if(!button||!current)return;
  selected={...current.scope,goalId:current.goalId,runId:button.dataset.importVerification};
  pending=null;$('verification-file').value='';$('verification-preview').hidden=true;$('verification-error').textContent='';$('verification-submit').disabled=true;dialog.showModal();
});
$('verification-file').onchange=async()=>{
  pending=null;$('verification-submit').disabled=true;$('verification-error').textContent='';$('verification-preview').hidden=true;
  try{
    const file=$('verification-file').files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('材料不能超过 2 MB');
    const body=JSON.parse(await file.text());if(!body||typeof body!=='object'||Array.isArray(body))throw Error('请选择结构化验收材料');
    for(const field of ['projectId','workspaceId','goalId','runId'])if(body[field]!==selected[field])throw Error('材料不属于当前项目、目标或运行');
    const candidate=typeof body.patch==='string';
    if(!candidate&&typeof body.reportBody!=='string')throw Error('材料缺少候选补丁或原始评分报告');
    pending={route:candidate?'candidates':'import',body};
    $('verification-preview').textContent=(candidate?'登记候选':'导入评分')+'\n来源：'+(candidate?({'model':'原模型候选','assisted-repair':'辅助修复候选'}[body.origin]??body.origin):({'original':'原始评分','diagnostic':'诊断复跑','repair':'辅助修复评分'}[body.purpose]??body.purpose))+'\n候选摘要：'+(body.patchSha256??body.candidateDigest)+'\n'+(candidate?'必测项：'+((body.benchmark?.failToPass?.length??0)+(body.benchmark?.passToPass?.length??0)):'报告来源：'+(body.source?.name??'缺失')+'\n正式结果将在导入后计算');
    $('verification-preview').hidden=false;$('verification-submit').disabled=false;
  }catch(error){$('verification-error').textContent=error.message;}
};
$('verification-form').onsubmit=async event=>{
  event.preventDefault();if(!pending)return;const submission=structuredClone(pending), target={...selected}; const button=$('verification-submit');button.disabled=true; $('verification-file').disabled=true;
  try{
    if(!current||['projectId','workspaceId'].some(k=>current.scope[k]!==target[k])||current.goalId!==target.goalId)throw Error('当前目标已经切换，请重新打开验收导入');
    if(!token){const response=await fetch('/api/meta');const meta=await response.json();token=meta.workspaceToken;}
    const response=await fetch('/api/real/verifications/'+submission.route,{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify(submission.body)});
    const result=await response.json();if(!response.ok)throw Error(result.error??'导入失败');
    dialog.close();$('refresh').click();
    $('notice').hidden=false;$('notice').textContent=submission.route==='candidates'?'候选已登记，可继续导入评分材料。':'验收已保存：'+result.verification.verdict+'；任务状态已重新计算。';
  }catch(error){$('verification-error').textContent=error.message;}finally{button.disabled=false; $('verification-file').disabled=false;}
};

const checkDialog=document.createElement('dialog');
checkDialog.innerHTML='<form id="command-check-form"><h2>运行独立检查</h2><p>在当前开发工作区的沙箱内执行。检查结果会保存，但不会直接完成任务。</p><label>检查命令<input name="command" required maxlength="4096" placeholder="例如：python -m pytest tests/"></label><label>类型<select name="kind"><option value="dynamic">行为测试</option><option value="static">静态检查</option></select></label><label>单次超时（秒）<input name="seconds" type="number" min="1" max="600" value="120" required></label><p class="check-error" role="alert"></p><button type="submit">执行并保存报告</button><button type="button" class="check-close">关闭</button></form>';
document.body.append(checkDialog);
let checkScope,checkRequestId;
checkDialog.querySelector('.check-close').onclick=()=>checkDialog.close();
window.addEventListener('platform-scope-changing',()=>checkDialog.close());
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-run-command-check]');if(!button||!current)return;
 checkScope={...current.scope,goalId:current.goalId,runId:button.dataset.runCommandCheck};checkRequestId=crypto.randomUUID();
 checkDialog.querySelector('.check-error').textContent='';checkDialog.showModal();
});
checkDialog.querySelector('form').onsubmit=async event=>{
 event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
 const target={...checkScope},requestId=checkRequestId,fields=new FormData(form);
 const matches=()=>current&&current.goalId===target.goalId&&['projectId','workspaceId'].every(k=>current.scope[k]===target[k])&&checkRequestId===requestId;
 try{
  if(!matches())throw Error('目标已切换，请重新打开检查');
  if(!token){const response=await fetch('/api/meta');token=(await response.json()).workspaceToken;}
  if(!matches())throw Error('目标已切换，请重新打开检查');
  const response=await fetch('/api/real/verifications/run-check',{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify({...target,requestId,command:fields.get('command'),kind:fields.get('kind'),timeoutMs:Number(fields.get('seconds'))*1000,allowExecute:true})});
  const result=await response.json();if(!response.ok)throw Error(result.error??'检查失败');
  if(matches()){checkDialog.close();$('refresh').click();}
 }catch(error){if(matches())checkDialog.querySelector('.check-error').textContent=error.message;}
 finally{button.disabled=false;}
};

const checkReportDialog=document.createElement('dialog');
checkReportDialog.innerHTML='<h2>检查报告与来源</h2><pre></pre><button type="button">关闭</button>';
document.body.append(checkReportDialog);checkReportDialog.querySelector('button').onclick=()=>checkReportDialog.close();
window.addEventListener('platform-scope-changing',()=>checkReportDialog.close());
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-check-report]');if(!button||!current)return;
 const target={...current.scope,goalId:current.goalId,runId:button.dataset.checkRun,requestId:button.dataset.checkReport};
 button.disabled=true;
 try{
  if(!token){token=(await (await fetch('/api/meta')).json()).workspaceToken;}
  const response=await fetch('/api/real/verifications/check-report',{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify(target)});
  const result=await response.json();if(!response.ok)throw Error(result.error??'报告不可用');
  if(!current||current.goalId!==target.goalId||['projectId','workspaceId'].some(k=>current.scope[k]!==target[k]))return;
  checkReportDialog.querySelector('pre').textContent=JSON.stringify(result,null,2);checkReportDialog.showModal();
 }catch(error){$('notice').hidden=false;$('notice').textContent=error.message;}finally{button.disabled=false;}
});
