import {readableTitle} from './markdown.js';
import {explorationTaskState,explorationControls} from './exploration-ui.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title = text => readableTitle(text, '未命名任务');
const phase = value => ({pending:'待处理',ready:'可执行',running:'进行中',done:'已正式完成',completed:'已正式完成',passed:'已通过',failed:'未通过',blocked:'受阻',satisfied:'已满足',invalidated:'需重新验证'}[value] ?? value ?? '待验收');
const put = (node,text) => {if(node.textContent!==text)node.textContent=text;};
const html = (node,value) => {if(node.dataset.value!==value){node.innerHTML=value;node.dataset.value=value;}};
export function dependencyLayers(nodes,edges) {
  const ids=new Set(nodes.map(node=>node.taskId)), remaining=new Set(ids), levels=[];
  while(remaining.size) {
    const ready=nodes.filter(node=>remaining.has(node.taskId)&&edges.filter(edge=>edge.taskId===node.taskId&&ids.has(edge.dependsOnId)).every(edge=>!remaining.has(edge.dependsOnId)));
    if(!ready.length) {levels.push({cyclic:true,nodes:nodes.filter(node=>remaining.has(node.taskId))});break;}
    levels.push({cyclic:false,nodes:ready});
    ready.forEach(node=>remaining.delete(node.taskId));
  }
  return levels;
}
let graphKey='', cards=new Map();
window.addEventListener('platform-scope-changing',()=>{graphKey='';cards.clear();$('task-graph')?.replaceChildren();});
window.addEventListener('platform-state',event=>{
  const {data,scope,goalId}=event.detail, graph=data.graph?.graph, host=$('task-graph');
  if(!host)return;
  if(!graph?.tasks?.length){if(graphKey!=='empty'){host.innerHTML='<p class="empty-note">此目标还没有已接受的任务计划。</p>';graphKey='empty';cards.clear();}return;}
  const nodes=graph.tasks, edges=graph.executionDag?.dependsOn ?? [], rows=data.matrix?.matrix?.rows ?? [];
  const structure=JSON.stringify([scope,goalId,graph.planRevision,nodes.map(n=>[n.taskId,n.title,n.taskKind]),edges,!!data.exploration]);
  if(structure!==graphKey) {
    graphKey=structure;cards.clear();
    host.replaceChildren();
    const origin=document.createElement('p');origin.className='graph-plan-origin';
    origin.textContent=data.exploration?'本探索计划由操作人员配置。下方每张卡对应正式任务，依赖来自已接受计划；模型负责执行节点。':'下方每张卡对应已接受计划中的实际任务；依赖与正式任务判定分别显示。';
    const summary=document.createElement('p');summary.className='graph-summary';summary.textContent='计划版本 '+graph.planRevision+' · '+nodes.length+' 个任务 · '+edges.length+' 条依赖';
    const layers=document.createElement('div');layers.className='graph-layers';
    for(const [i,level] of dependencyLayers(nodes,edges).entries()) {
      const section=document.createElement('section');section.className='graph-layer';
      const label=document.createElement('h3');label.className='graph-layer-label';label.textContent=level.cyclic?'依赖存在循环，无法排列':(i===0?'第 1 层 · 无前置依赖':'第 '+(i+1)+' 层 · 等待所列前置任务');
      const list=document.createElement('ol');list.className='graph-node-list';
      for(const node of level.nodes) {
        const card=document.createElement('li');card.className='graph-task-card';card.dataset.taskId=node.taskId;card.dataset.kind=node.taskKind;
        const heading=document.createElement('h3');heading.textContent=title(node.title);
        const status=document.createElement('p');status.className='graph-task-status';
        const details=document.createElement('details'), head=document.createElement('summary'), dependencies=document.createElement('p');
        const deps=edges.filter(edge=>edge.taskId===node.taskId);
        head.textContent='前置依赖 · '+deps.length;
        dependencies.textContent=deps.length?deps.map(edge=>title(nodes.find(n=>n.taskId===edge.dependsOnId)?.title ?? edge.dependsOnId)+(edge.requires?.label?'（'+edge.requires.label+'）':'')).join('；'):'没有前置依赖。';
        details.append(head,dependencies);
        const actions=document.createElement('div');actions.className='graph-task-actions';
        card.append(heading,status,details,actions);list.append(card);cards.set(node.taskId,{card,status,actions});
      }
      section.append(label,list);layers.append(section);
    }
    host.append(origin,summary,layers);
  }
  for(const node of nodes) {
    const view=cards.get(node.taskId);if(!view)continue;
    if(data.exploration) {
      const state=explorationTaskState(data,node.taskId);
      put(view.status,(state.gate?'目标审阅':'探索节点')+' · '+state.label);
      html(view.actions,explorationControls(data,node.taskId)+'<button data-task-detail="'+esc(node.taskId)+'">任务依据</button>');
    } else {
      const row=rows.find(row=>row.taskId===node.taskId), run=(data.liveRuns ?? []).filter(run=>run.spec?.taskId===node.taskId).at(-1);
      const runLabel={prepared:'等待启动',running:'正在执行',completed:'已结束',failed:'执行失败',cancelled:'已取消',budget_exhausted:'达到限额',outcome_unknown:'结果未知'}[run?.status];
      put(view.status,(runLabel?'运行：'+runLabel+' · ':'')+'验收：'+(row?.livePhase?phase(row.livePhase):'待独立验证'));
      html(view.actions,'<button data-task-detail="'+esc(node.taskId)+'">任务详情</button>'+(run?'<button data-explore-run-record="'+esc(run.spec.runId)+'">运行记录</button>':''));
    }
  }
});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-open-dock],#settings-open');
  if(button)window.dispatchEvent(new CustomEvent('platform-open-view',{detail:button.id==='settings-open'?'settings':button.dataset.openDock}));
});
