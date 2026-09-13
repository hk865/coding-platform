import { contextManifestMarkup } from './context-view.js';
import {renderMarkdown, readableTitle} from './markdown.js';
import {summarizeUsage} from './live-runs.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const terminal = run => run && !['prepared','running'].includes(run.status);
const sameScope = (a,b) => a?.projectId===b?.projectId && a?.workspaceId===b?.workspaceId && a?.goalId===b?.goalId;
export function explorationTaskState(data, taskId, runId) {
  const plan=data?.exploration, task=plan?.tasks?.find(t=>t.taskId===taskId);
  const rows=data?.matrix?.matrix?.rows ?? [], row=rows.find(t=>t.taskId===taskId);
  const run=(data?.liveRuns ?? []).filter(r=>r.spec?.taskId===taskId&&(!runId||r.spec.runId===runId)).at(-1);
  const report=(plan?.reports ?? []).filter(r=>r.taskId===taskId && (!run || r.runId===run.spec.runId)).at(-1);
  const review=(plan?.reviews ?? []).filter(r=>r.taskId===taskId && (!run || r.runId===run.spec.runId)).at(-1);
  const gate=taskId===plan?.gateTaskId;
  const dependencies=task?.dependsOn ?? (gate ? plan?.tasks?.map(t=>t.taskId) ?? [] : []);
  const ready=dependencies.every(id=>rows.find(t=>t.taskId===id)?.livePhase==='satisfied');
  const failedDependencies=dependencies.some(id=>rows.find(t=>t.taskId===id)?.livePhase==='failed');
  let label='未开始';
  if (row?.livePhase==='satisfied'&&(!runId||(review?.verdict==='PASS'&&review?.control?.status==='applied'))) label='已审阅';
  else if ((!runId&&row?.livePhase==='failed') || review?.verdict==='FAIL') label='审阅未通过';
  else if (run?.status==='prepared') label='排队等待执行';
  else if (run?.status==='running') label='正在探索';
  else if (report && terminal(run)) label='运行结束 · 待审阅';
  else if (run?.status==='completed') label=(plan.reportErrors ?? []).some(error=>error.runId===run.spec.runId)?'报告登记失败 · 查看运行记录':'运行结束 · 等待报告';
  else if (run) label=({failed:'探索失败',cancelled:'已取消',budget_exhausted:'达到运行限额',outcome_unknown:'运行结果未知'}[run.status] ?? run.status);
  else if (gate) label=failedDependencies?'受阻：工作节点审阅未通过':ready ? '待总体验收' : '等待全部节点审阅';
  else if (!ready) label=failedDependencies?'受阻：前置审阅未通过':'等待前置审阅';
  return {task,row,run,report,review,gate,ready,label,canRun:!!task&&ready&&!run&&!row?.livePhase?.match(/satisfied|failed/),canReview:row?.livePhase!=='satisfied'&&row?.livePhase!=='failed'&&(gate ? ready&&(plan?.tasks ?? []).every(task=>(plan.reports ?? []).some(report=>report.taskId===task.taskId)) : !!report&&run?.status==='completed')};
}
export function explorationControls(data, taskId) {
  const state=explorationTaskState(data,taskId), id=esc(taskId);
  return (!state.gate ? '<button data-explore-run="'+id+'" '+(!state.canRun?'disabled':'')+'>'+(!state.run ? (state.ready?'开始只读探索':'等待前置审阅') : '已创建运行')+'</button>' : '')+
    (state.report ? '<button data-explore-report="'+id+'">查看报告</button>' : '')+
    (state.run ? '<button data-explore-run-record="'+esc(state.run.spec.runId)+'">运行记录</button>' : '')+
    '<button data-explore-review="'+id+'" '+(!state.canReview?'disabled':'')+'>'+(state.gate?'审阅整体目标':'审阅报告')+'</button>';
}
export function defaultExplorationTasks() {
  return [
    {taskId:'explore-inventory',title:'项目范围与目录清点',dependsOn:[],instruction:'只读探索当前工作区；若提供 FILE_INDEX.txt，先读取目录索引。核对每个项目/依赖目录是源码仓库还是安装产物；记录可见版本、未提交文件与构建产物，概述目录职责。引用实际读取的文件路径与行号，明确未验证项。不要修改文件、安装依赖、运行构建测试或启动服务。'},
    {taskId:'explore-dependencies',title:'构建方式与依赖关系',dependsOn:['explore-inventory'],instruction:'根据前置范围报告，实际读取构建文件、依赖声明与安装元数据，解释模块依赖、构建入口、运行前置条件。区分声明的依赖与已证实的实际解析路径；不得将文档命令视为运行结果。只读，不构建、测试、安装或启动服务。'},
    {taskId:'explore-entrypoints',title:'启动入口与数据流',dependsOn:['explore-inventory'],instruction:'根据前置范围报告，读取实际启动入口、配置与关键调用点，说明默认启动行为、条件分支、模块之间的数据流以及关键配置。引用文件和行号；区分当前代码与可能过时的文档。只读，不启动容器、服务或机器人。'},
    {taskId:'explore-summary',title:'探索汇总与待验证清单',dependsOn:['explore-dependencies','explore-entrypoints'],instruction:'汇总已审阅的前置报告，必要时只读核对源文件，输出项目架构、依赖与入口索引、已有验证证据、风险和建议后续验证顺序。明确事实、推断和未验证事项，不声称本次完成了构建、测试或运行。'}
  ];
}
export function initializeExploration({token,current,refresh,meta}) {
  let latest=null, planScope=null, reviewScope=null, reviewState=null, selected=null, reportKey='';
  const inFlight=new Set(), retries=new Map();
  async function post(action,body) {
    const fingerprint=JSON.stringify([action,body]);
    if (!retries.has(fingerprint)) retries.set(fingerprint,crypto.randomUUID());
    const response=await fetch('/api/real/explorations/'+action,{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify({...body,requestId:retries.get(fingerprint)})});
    const result=await response.json(); if(!response.ok) throw Error(result.error ?? '操作未执行');
    return result;
  }
  function notice(text) { $('notice').hidden=!text; $('notice').textContent=text; }
  function capture() { const c=current(); return {projectId:c.projectId,workspaceId:c.workspaceId,goalId:c.goalId}; }
  function openPlan() {
    if(latest?.data?.exploration) { window.dispatchEvent(new CustomEvent('platform-open-view',{detail:'taskgraph'})); return; }
    const c=current(); if(!c.goalId) { notice('先新建一个探索目标，再配置探索计划。'); return; }
    if(latest?.data?.graph?.graph?.tasks?.length) { notice('当前目标已有计划。请新建目标来配置只读探索。'); return; }
    planScope=capture();
    $('exploration-root').textContent=c.root ?? '';
    $('exploration-plan-tasks').innerHTML=defaultExplorationTasks().map((task,i)=>'<details class="exploration-plan-step" '+(i===0?'open':'')+'><summary>'+esc(task.title)+'</summary><p>依赖：'+esc(task.dependsOn.length?task.dependsOn.map(id=>defaultExplorationTasks().find(t=>t.taskId===id).title).join('、'):'无')+'</p><label>步骤标题<input name="explore-title-'+i+'" value="'+esc(task.title)+'" maxlength="160" required></label><label>探索要求<textarea name="explore-instruction-'+i+'" rows="4" maxlength="4096" required>'+esc(task.instruction)+'</textarea></label></details>').join('');
    $('exploration-plan-error').textContent='';
    const capabilities=meta.exploration;
    const allowed=capabilities?.contextOnlyProjectIds?.includes(planScope.projectId);
    $('exploration-budget-note').textContent=allowed ? '本次专用工作区不设累计输入／输出、调用次数或总时长上限；每次上下文容量由运行配置限制，用量照常累计展示。' : '每个节点使用服务端当前工作区的运行限额。上下文容量与多次调用的累计用量分别记录。';
    $('exploration-plan-dialog').showModal();
  }
  $('exploration-open').onclick=openPlan;
  $('compose-exploration').onclick=openPlan;
  $('exploration-plan-form').onsubmit=async event=>{
    event.preventDefault(); if(!sameScope(planScope,capture())) { $('exploration-plan-error').textContent='项目已切换，请关闭后重新配置。'; return; }
    const button=$('exploration-plan-submit'); button.disabled=true;
    const tasks=defaultExplorationTasks().map((task,i)=>({...task,title:$('exploration-plan-form').elements.namedItem('explore-title-'+i).value.trim(),instruction:$('exploration-plan-form').elements.namedItem('explore-instruction-'+i).value.trim()}));
    try { await post('plan',{...planScope,tasks}); $('exploration-plan-dialog').close(); await refresh(); window.dispatchEvent(new CustomEvent('platform-open-view',{detail:'taskgraph'})); }
    catch(error) { $('exploration-plan-error').textContent=error.message; }
    finally {button.disabled=false;}
  };
  function showReport(taskId,runId) {
    selected={...capture(),taskId,runId}; reportKey=''; updateReport();
    window.dispatchEvent(new CustomEvent('platform-open-view',{detail:'taskgraph'}));
    $('exploration-report').scrollIntoView({block:'start'});
  }
  function updateReport() {
    const host=$('exploration-report');
    if(!selected || !sameScope(selected,capture())) {host.hidden=true; return;}
    const state=explorationTaskState(latest?.data,selected.taskId,selected.runId), report=state.report;
    if(!report) {host.hidden=true;return;}
    host.hidden=false;
    const key=JSON.stringify([report.runId,report.reportDigest,state.label,state.review,state.run?.context?.manifest?.inputDigest]);
    if(key===reportKey) return; reportKey=key;
    const scroll=$('right-panel').scrollTop;
    $('exploration-report-title').textContent=state.task?.title ?? selected.taskId;
    $('exploration-report-state').textContent=state.label+' · '+report.runId;
    const reviewNote=$('exploration-report-review');
    reviewNote.hidden=!state.review;
    if(state.review) {
      reviewNote.dataset.verdict=state.review.verdict;
      $('exploration-report-review-title').textContent='操作人员审阅 · '+(state.review.verdict==='PASS'?'通过':'未通过')+' · '+(state.review.control?.status==='applied'?'已正式登记':'等待正式登记');
      $('exploration-report-review-text').textContent=state.review.reviewText ?? '';
    }

    $('exploration-report-context').innerHTML=contextManifestMarkup(state.run);
    const body=$('exploration-report-body');
    if(body.dataset.digest!==report.reportDigest || body.dataset.runId!==report.runId) {body.innerHTML=renderMarkdown(report.report ?? '报告内容为空。');body.dataset.digest=report.reportDigest;body.dataset.runId=report.runId;}
    $('exploration-report-source').textContent=JSON.stringify({reportDigest:report.reportDigest,sourceDigest:report.sourceDigest,workspaceRevision:report.workspaceRevision,sourceReads:report.sourceReads},null,2);
    const latestRun=explorationTaskState(latest.data,selected.taskId).run;
    $('exploration-report-controls').innerHTML=state.run?.spec.runId===latestRun?.spec.runId ? explorationControls(latest.data,selected.taskId) : '<span class="muted">历史报告</span><button data-explore-run-record="'+esc(report.runId)+'">查看此次运行</button>';
    $('right-panel').scrollTop=scroll;
  }
  $('exploration-report-close').onclick=()=>{selected=null;$('exploration-report').hidden=true;};
  document.addEventListener('click',async event=>{
    const reportButton=event.target.closest('[data-explore-report]');
    if(reportButton) {showReport(reportButton.dataset.exploreReport,reportButton.dataset.exploreReportRun);return;}
    const recordButton=event.target.closest('[data-explore-run-record]');
    if(recordButton) {window.dispatchEvent(new CustomEvent('platform-show-run',{detail:recordButton.dataset.exploreRunRecord}));return;}
    const reviewButton=event.target.closest('[data-explore-review]');
    if(reviewButton) {
      const taskId=reviewButton.dataset.exploreReview, state=explorationTaskState(latest?.data,taskId);
      if(!state.canReview)return;
      reviewScope=capture(); reviewState={taskId,runId:state.run?.spec.runId};
      $('exploration-review-title').textContent=state.gate?'审阅整体探索目标':'审阅：'+(state.task?.title??taskId);
      $('exploration-review-text').value=''; $('exploration-review-verdict').value='PASS'; $('exploration-review-error').textContent='';
      $('exploration-review-basis').textContent=state.gate?'全部工作节点已正式审阅；请核对汇总报告是否满足本目标。':('Run '+state.run.spec.runId+' · 报告 '+state.report.reportDigest);
      $('exploration-review-dialog').showModal(); return;
    }
    const button=event.target.closest('[data-explore-run]'); if(!button)return;
    const taskId=button.dataset.exploreRun, c=capture(), key=JSON.stringify([c,taskId]);
    if(inFlight.has(key)||!explorationTaskState(latest?.data,taskId).canRun)return;
    inFlight.add(key);button.disabled=true;
    try { const result=await post('run',{...c,taskId}); await refresh(); if(sameScope(c,capture())&&result.runId)window.dispatchEvent(new CustomEvent('platform-show-run',{detail:result.runId})); }
    catch(error) { if(sameScope(c,capture()))notice(error.message); }
    finally {inFlight.delete(key);if(button.isConnected)button.disabled=!explorationTaskState(latest?.data,taskId).canRun;}
  });
  $('exploration-review-form').onsubmit=async event=>{
    event.preventDefault(); if(!sameScope(reviewScope,capture())) {$('exploration-review-error').textContent='项目已切换，请重新打开审阅。';return;}
    const button=$('exploration-review-submit');button.disabled=true;
    try {await post('review',{...reviewScope,...reviewState,reviewVerdict:$('exploration-review-verdict').value,reviewText:$('exploration-review-text').value.trim(),reviewOrigin:'operator'});$('exploration-review-dialog').close();await refresh();}
    catch(error){$('exploration-review-error').textContent=error.message;}
    finally{button.disabled=false;}
  };
  window.addEventListener('platform-scope-changing',()=>{latest=null;selected=null;reportKey='';$('exploration-report').hidden=true;$('exploration-overview').hidden=true;});
  window.addEventListener('platform-state',event=>{
    latest=event.detail;
    const {data}=latest, plan=data.exploration, overview=$('exploration-overview');
    overview.hidden=!plan;
    $('exploration-open').disabled=!latest.goalId || (!plan&&!!data.graph?.graph?.tasks?.length);
    $('compose-exploration').disabled=$('exploration-open').disabled;
    $('exploration-open').textContent=plan?'查看探索计划':'探索项目';
    $('compose-exploration').textContent=plan?'查看探索任务':'探索当前项目';
    if(plan) {
      const all=data.liveRuns ?? [], total=summarizeUsage(all.flatMap(run=>run.usage ?? []));
      $('exploration-summary').textContent='只读探索 · 计划由操作人员配置 · '+plan.tasks.length+' 个工作节点';
      $('exploration-total-usage').textContent='当前目标全部运行累计输入 '+total.input.toLocaleString('zh-CN')+' · 输出 '+total.output.toLocaleString('zh-CN')+' tokens · '+total.requests+' 次模型调用'+(total.unknown?'（'+total.unknown+' 次用量未完整报告）':'');
      $('exploration-context-note').textContent='累计量包含此目标各节点及重试的所有模型调用；每次上下文容量在各 Run 中单独显示。运行结束后需人工审阅报告。';
    }
    updateReport();
  });
}
