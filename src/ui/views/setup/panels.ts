/** The project-settings tab: project/workspace, Goal, architecture and plan, re-reads, graphs and files panels in flat groups. */

import {
  actionButton,
  detailsBlock,
  escapeHtml,
  refusalLine,
  renderGap,
  shown,
  versionLine,
} from '../../components/html.js';
import { record } from '../../state/values.js';
import { reviewArchitectures, reviewGoals, reviewPlans, reviewPolicies, state } from '../../state/workbench.js';
import { renderExecution } from '../execution/panel.js';
import { renderFileRead, renderSourceCapture } from '../files/render.js';
import { renderCompareForm } from '../files/tabs.js';
import { renderAdoptedGraph, renderObservedGraph, renderTaskGraph } from '../graphs/node-link.js';
import { renderGoalDetail, renderPlanProposal } from './render.js';
import { architectureDraftPreview } from './requests.js';
import { renderCommandForm } from '../terminal/commands.js';

export function renderScope(): string {
  // The whole project tree (projects + current project children) is rendered by
  // renderNav, so the left column is one real tree rather than a selector plus a
  // separate member area.
  return '';
}
function renderInit(): string {
  const current = state();
  const policies = reviewPolicies();
  const policyOptions = policies.map((policy, index) =>
    `<option value="${index}"${current.forms.policyIndex === String(index) ? ' selected' : ''}>${escapeHtml(policy.policyId)} · 内容版本 ${escapeHtml(policy.contentRevision)}</option>`).join('');
  return `<section class="panel" data-view="init"><h2>项目 / 工作区</h2>`
    + `<label class="inline">项目 ID <input data-field="projectId" value="${escapeHtml(current.forms.projectId)}" placeholder="${escapeHtml(current.config.scope.projectId)}"></label>`
    + `<div class="buttons">${actionButton('create-project', '创建项目', true, '')}</div>`
    + versionLine('项目', current.project, '尚未读取登记状态（本页无创建回执）')
    + `<div class="buttons">${actionButton('register-workspace', '登记工作区', current.project !== null, '本页尚未取得项目的正式版本')}</div>`
    + versionLine('工作区', current.workspace, '尚未读取登记状态（本页无登记回执）')
    + `<h3>完成策略</h3>`
    + (policies.length === 0 ? refusalLine('本机没有提供完成策略资料。') : `<label class="inline">选择策略 <select data-field="policyIndex">${policyOptions}</select></label>`)
    + `<div class="buttons">`
      + actionButton('install-policy', '安装完成策略', current.project !== null && policies.length > 0, policies.length === 0 ? '没有可用策略资料' : '本页尚未取得项目的正式版本')
      + actionButton('activate-policy', '启用完成策略', current.policyInstall !== null, '需要先安装完成策略')
    + `</div>`
    + (current.policyInstall === null ? '<p class="muted">完成策略：尚未安装</p>'
      : `<p>完成策略：已安装，内容版本 ${escapeHtml(current.policyInstall.contentRevision)}</p>`
        + detailsBlock('查看详情', `<pre>${escapeHtml(JSON.stringify({ ref: current.policyInstall.ref, contentDigest: current.policyInstall.contentDigest }, null, 2))}</pre>`))
    + (current.policyActive === null ? '' : `<p>完成策略：已启用（版本 ${escapeHtml(current.policyActive.revision)}）</p>`)
    + `</section>`;
}

function renderGoal(): string {
  const current = state();
  const fallback = reviewGoals()[0];
  const placeholderGoal = current.goal?.ref.goalId ?? fallback?.goalId ?? '';
  const placeholderObjective = current.goal?.objective ?? fallback?.objective ?? '';
  const enabled = current.project !== null && current.workspace !== null;
  return `<section class="panel" data-view="goal"><h2>目标</h2>`
    + `<label class="inline">目标 ID <input data-field="goalId" value="${escapeHtml(current.forms.goalId)}" placeholder="${escapeHtml(placeholderGoal)}"></label>`
    + `<label class="inline">目标内容 <input data-field="objective" value="${escapeHtml(current.forms.objective)}" placeholder="${escapeHtml(placeholderObjective)}"></label>`
    + `<div class="buttons">${actionButton('create-goal', '创建目标', enabled, '本页尚未取得项目与工作区的正式版本')}</div>`
    + (current.goal === null ? '<p class="muted">目标：尚未创建</p>'
      : `<p>目标 <code>${escapeHtml(current.goal.ref.goalId)}</code>：已创建，版本 ${escapeHtml(current.goal.revision)}</p>`
        + `<p class="muted">${escapeHtml(current.goal.objective)}</p>`
        + detailsBlock('查看版本引用', `<pre>${escapeHtml(JSON.stringify(current.goal.ref, null, 2))}</pre>`))
    + `</section>`;
}

function renderPlan(): string {
  const current = state();
  const architectures = reviewArchitectures();
  const plans = reviewPlans();
  const architectureOptions = architectures.map((architecture, index) =>
    `<option value="${index}"${current.forms.architectureIndex === String(index) ? ' selected' : ''}>${escapeHtml(architecture.baselineId)} · ${escapeHtml(architecture.description)}</option>`).join('');
  const planOptions = plans.map((plan, index) =>
    `<option value="${index}"${current.forms.planIndex === String(index) ? ' selected' : ''}>${escapeHtml(plan.planId)} · ${escapeHtml(plan.reasonText)}</option>`).join('');
  const draftButton = actionButton('adopt-architecture-draft', '采用粘贴的初始架构',
    current.forms.architectureDraft.trim().length > 0 && !current.sending,
    current.sending ? '正在发送，请稍候' : '请先粘贴已审阅的初始架构 JSON');
  const advanced = `<details class="details" data-view="architecture-draft"><summary>高级：粘贴/导入已审阅的初始架构 JSON</summary>`
    + `<p class="muted">字段形状：<code>baselineId</code>（字符串）、<code>catalog</code>（包含 <code>modules</code>、<code>dependencies</code>、<code>requireDag</code>，可选 <code>containment</code>）、<code>description</code>（字符串）、<code>constraints</code>（<code>{ name, scope }</code> 数组）。模块与依赖只能由你显式提供；本页不会从来源或计划推断，也不会填入默认架构，最终仍由架构 owner 校验。</p>`
    + `<label class="inline">初始架构输入 JSON <textarea data-field="architectureDraft" rows="6" spellcheck="false">${escapeHtml(current.forms.architectureDraft)}</textarea></label>`
    + `<div data-architecture-draft-preview>${architectureDraftPreview(current.forms.architectureDraft)}</div>`
    + `<div class="buttons">${draftButton}</div>`
    + `</details>`;
  return `<section class="panel" data-view="plan"><h2>初始架构与计划</h2>`
    + (architectures.length === 0 ? refusalLine('本机没有提供初始架构资料。')
      : `<label class="inline">初始架构 <select data-field="architectureIndex">${architectureOptions}</select></label>`)
    + `<div class="buttons">${actionButton('adopt-architecture', '采用初始架构', current.project !== null && current.workspace !== null && architectures.length > 0, architectures.length === 0 ? '没有可用初始架构' : '本页尚未取得项目与工作区的正式版本')}</div>`
    + (current.adopted === null ? '<p class="muted">采用架构：尚未采用</p>'
      : `<p>采用架构：已采用，版本 ${escapeHtml(current.adopted.baseline.revision)}`
        + (current.adopted.catalog === null ? '（该基线早于目录，未记录模块）' : `，模块 ${current.adopted.catalog.catalog.modules.length}`) + `</p>`
        + detailsBlock('查看版本与摘要', `<pre>${escapeHtml(JSON.stringify({ baselineId: current.adopted.baseline.baselineId, revision: current.adopted.baseline.revision, contentDigest: current.adopted.baseline.contentDigest }, null, 2))}</pre>`))
    + advanced
    + `<h3>计划</h3>`
    + (plans.length === 0 ? refusalLine('本机没有提供计划草案资料。')
      : `<label class="inline">计划草案 <select data-field="planIndex">${planOptions}</select></label>`)
    + `<div class="buttons">`
      + actionButton('propose-plan', '提交计划草案', current.goal !== null && plans.length > 0, plans.length === 0 ? '没有可用计划草案' : '需要先创建目标')
      + actionButton('apply-plan', '采用计划', current.proposal !== null, '需要先提交计划草案')
    + `</div>`
    + (current.proposal === null ? '<p class="muted">计划草案：尚未提交</p>'
      : `<p>计划草案：已提交，版本 ${escapeHtml(current.proposal.revision)}，校验问题 ${current.proposal.issues.length}</p>`
        + detailsBlock('查看草案引用', `<pre>${escapeHtml(JSON.stringify(current.proposal.ref, null, 2))}</pre>`))
    + (current.plan === null ? '' : `<p>计划：已采用 <code>${escapeHtml(current.plan.ref.planId)}</code>，业务版本 ${escapeHtml(current.plan.planRevision)}</p>`
        + detailsBlock('查看计划引用', `<pre>${escapeHtml(JSON.stringify(current.plan.ref, null, 2))}</pre>`))
    + `</section>`;
}

function renderGraphs(): string {
  const current = state();
  const adoptedSource = current.architectureRead ?? (current.adopted === null ? null : { status: 'ready', value: current.adopted });
  const adoptedPanel = adoptedSource === null ? renderGap('采用架构', '尚未读取采用架构') : renderAdoptedGraph(adoptedSource as never);
  const observedPanel = current.observed === null ? renderGap('观察结构', '尚未查询观察结构（需先捕获）') : renderObservedGraph(current.observed as never);
  const taskPanel = current.taskGraph === null ? renderGap('任务图', '尚未读取任务图') : renderTaskGraph(current.taskGraph as never);
  return `<section class="panel" data-view="graphs"><h2>采用架构 / 观察结构 / 任务图</h2>`
    + `<div class="buttons">`
      + actionButton('capture-observed', '捕获观察结构', current.project !== null && current.workspace !== null && current.adopted !== null, current.adopted === null ? '需要先采用初始架构' : '本页尚未取得项目与工作区的正式版本')
      + actionButton('query-observed', '查看观察结构', current.observedCapture !== null, '需要先捕获观察结构')
      + actionButton('query-tasks', '查看任务图', true, '')
      + `<button data-action="open-task-graph">在辅助页打开任务结构</button>`
      + `<button data-action="open-architecture-graph">在辅助页打开架构图</button>`
    + `</div>`
    + (current.observedCapture === null ? '' : detailsBlock('查看观察捕获引用', `<pre>${escapeHtml(JSON.stringify(current.observedCapture, null, 2))}</pre>`))
    + `<div class="graph-panels">${adoptedPanel}${observedPanel}${taskPanel}</div>`
    + `</section>`;
}

function renderFiles(): string {
  const current = state();
  const providers = ['text', 'typescript', 'python', 'cpp'].map(provider =>
    `<option value="${provider}"${current.forms.provider === provider ? ' selected' : ''}>${provider}</option>`).join('');
  const page = current.sourcePage;
  const items = page === null ? '' : page.items.map(item => {
    const hit = record(item);
    const rawPath = record(hit.file).path;
    const path = typeof rawPath === 'string' ? rawPath : '';
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    return `<li><button class="link" data-action="read-path" data-path="${escapeHtml(path)}">${path.length === 0 ? shown(hit.kind) : escapeHtml(path)}</button>`
      + `<button class="link" data-action="open-file" data-path="${escapeHtml(path)}">打开文件页</button>`
      + (directory.length === 0 ? '' : `<button class="link" data-action="open-directory" data-path="${escapeHtml(directory)}">目录</button>`)
      + `</li>`;
  }).join('');
  return `<section class="panel" data-view="files"><h2>文件</h2>`
    + `<label class="inline">来源类型 <select data-field="provider">${providers}</select></label>`
    + `<label class="inline">路径前缀 <input data-field="prefix" value="${escapeHtml(current.forms.prefix)}" placeholder="src"></label>`
    + `<div class="buttons">`
      + actionButton('capture-source', '捕获来源', true, '')
      + actionButton('query-paths', '列出文件', current.capture !== null, '需要先捕获来源')
      + actionButton('query-next', '下一页', current.sourcePage !== null && current.sourcePage.nextCursor !== null, '没有更多了')
      + `<button data-action="open-directory" data-path="${escapeHtml(current.forms.prefix.trim())}">打开目录页</button>`
    + `</div>`
    + (current.capture === null ? '<p class="muted">来源：尚未捕获；打开页面不会自动捕获。</p>'
      : `<div>${renderSourceCapture({ status: 'ready', value: current.capture } as never)}</div>`)
    + (page === null ? '' : `<p>已列出 ${page.items.length} 个文件${page.nextCursor === null ? '' : '，还有更多'}</p>`
      + `<ul class="paths">${items}</ul>`
      + detailsBlock('查看游标', `<pre>${escapeHtml(String(page.nextCursor ?? 'none'))}</pre>`))
    + `<label class="inline">文件路径 <input data-field="filePath" value="${escapeHtml(current.forms.filePath)}" placeholder="README.md"></label>`
    + `<label class="inline">版本 <select data-field="readVersion"><option value="working_tree"${current.forms.readVersion === 'working_tree' ? ' selected' : ''}>工作区当前内容</option><option value="capture"${current.forms.readVersion === 'capture' ? ' selected' : ''}>已捕获内容</option></select></label>`
    + `<div class="buttons">${actionButton('read-file', '读取文件', true, '')}</div>`
    + (current.file === null ? '<p class="muted">文件内容：尚未读取</p>' : `<div>${renderFileRead({ status: 'ready', value: current.file } as never)}</div>`)
    + `</section>`;
}

/** One flat group per capability area. Every existing control is preserved and
 * stays default-collapsed, so the auxiliary page is a compact list of groups
 * instead of a wall of open cards. */
const setupGroup = (title: string, body: string): string =>
  `<details class="setup-group"><summary>${escapeHtml(title)}</summary><div class="setup-group-body">${body}</div></details>`;

export function renderSetupTab(): string {
  return `<div class="setup-pages">`
    + setupGroup('项目 / 工作区', renderInit())
    + setupGroup('目标', renderGoal())
    + setupGroup('初始架构与计划', renderPlan())
    + setupGroup('重新查看', renderReads())
    + setupGroup('采用架构 / 观察结构 / 任务图', renderGraphs())
    + setupGroup('文件', renderFiles())
    + setupGroup('执行配置 / 只读调查', renderExecution())
    + setupGroup('工作区比较', renderCompareForm())
    + setupGroup('终端命令', renderCommandForm())
    + `</div>`;
}

function renderReads(): string {
  const current = state();
  const architectureSelection = current.forms.archSelection === 'revision'
    ? `<label class="inline">架构 ID <input data-field="baselineId" value="${escapeHtml(current.forms.baselineId)}"></label>`
      + `<label class="inline">版本 <input data-field="baselineRevision" value="${escapeHtml(current.forms.baselineRevision)}"></label>`
    : '';
  return `<section class="panel" data-view="reads"><h2>重新查看</h2>`
    + `<label class="inline">目标 ID <input data-field="goalId" value="${escapeHtml(current.forms.goalId)}" placeholder="${escapeHtml(current.goal?.ref.goalId ?? reviewGoals()[0]?.goalId ?? '')}"></label>`
    + `<div class="buttons">`
      + actionButton('read-goal', '查看目标', true, '')
      + actionButton('query-tasks', '查看任务图', true, '')
    + `</div>`
    + `<label class="inline">计划草案 ID <input data-field="proposalId" value="${escapeHtml(current.forms.proposalId)}" placeholder="${escapeHtml(current.proposal?.ref.proposalId ?? '')}"></label>`
    + `<div class="buttons">${actionButton('read-proposal', '查看计划草案', true, '')}</div>`
    + `<label class="inline">架构范围 <select data-field="archSelection"><option value="current"${current.forms.archSelection === 'current' ? ' selected' : ''}>当前采用</option><option value="revision"${current.forms.archSelection === 'revision' ? ' selected' : ''}>指定版本</option></select></label>`
    + architectureSelection
    + `<div class="buttons">${actionButton('read-architecture', '查看采用架构', true, '')}`
      + `<button data-action="open-architecture-graph">在辅助页打开架构图</button></div>`
    + (current.goalRead === null ? '' : `<div>${renderGoalDetail(current.goalRead)}</div>`)
    + (current.proposalRead === null ? '' : `<div>${renderPlanProposal(current.proposalRead)}</div>`)
    + `</section>`;
}
