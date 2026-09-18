import type { QueryFactRead } from './query-execution-context.js';
import type { QueryFactAssertion } from './query-quality-facts.js';

/** Transport structure, not a template for the user's whole conversation. */
export type QueryAnswerPresentation = {
  schemaVersion: 1; language: 'zh' | 'en'; blocks: Array<
    { kind: 'fact'; citation: string } |
    { kind: 'explanation' | 'inference' | 'suggestion' | 'uncertainty'; text: string; basis: string[] }
  >;
};
export function parseQueryAnswerPresentation(text: string): QueryAnswerPresentation {
  const value = JSON.parse(text);
  const exact = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  const marker = (v: unknown) => typeof v === 'string' && /^F[1-9][0-9]*$/.test(v);
  if (!exact(value, ['schemaVersion', 'language', 'blocks']) || value.schemaVersion !== 1 || !['zh', 'en'].includes(value.language)
    || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 64) throw Error('Invalid mixed answer structure');
  for (const block of value.blocks) {
    if (block?.kind === 'fact') {
      if (!exact(block, ['kind', 'citation']) || !marker(block.citation)) throw Error('Fact blocks accept a checked citation only, never model prose');
    } else if (!exact(block, ['kind', 'text', 'basis']) || !['explanation', 'inference', 'suggestion', 'uncertainty'].includes(block.kind)
      || typeof block.text !== 'string' || !block.text.trim() || !Array.isArray(block.basis) || block.basis.length > 24 || !block.basis.every(marker)
      || /\[F[0-9]/.test(block.text)) throw Error('Invalid free explanation or citation basis');
  }
  return value;
}

export type PresentedQueryFact = Extract<QueryFactRead, { status: 'ready' }> & { marker: string; assertion?: QueryFactAssertion };
/** Fixed meanings for declared predicates; no natural-language entailment claim. */
export function renderQueryFact(fact: PresentedQueryFact, language: 'zh' | 'en'): string {
  if (!fact.assertion) throw Error('A fact sentence requires a checked structured assertion');
  const zh = language === 'zh', v = fact.value as Record<string, any>, a = fact.assertion;
  const p = fact.pointer;
  const locations: Record<QueryFactAssertion['kind'], boolean> = {
    goal_phase: p === '/material/goalPhase',
    task_phase: /^\/material\/collaborationWork\/\d+$/.test(p) || /^\/material\/verificationStages\/reviews\/\d+$/.test(p),
    run_status: /^\/material\/collaborationWork\/\d+\/latestRun$/.test(p),
    run_outcome: /^\/material\/collaborationWork\/\d+\/latestRun$/.test(p),
    task_dependencies: p === '/material/acceptedPlan',
    decision_outcome: /^\/material\/architectureReviews\/rows\/\d+(\/decisionFacts(\/acceptedProposal)?)?$/.test(p)
      || /^\/material\/humanActions\/domains\/\d+\/records\/\d+\/value\/decisions\/\d+$/.test(p),
    selected_option: /^\/material\/humanActions\/domains\/\d+\/records\/\d+\/value\/decisions\/\d+$/.test(p),
    current_baseline_activation: p === '/material/architectureActivation',
    baseline_activation: /^\/material\/architectureReviews\/rows\/\d+\/decisionFacts\/activatedBaseline\/records\/\d+$/.test(p),
    pending_human_action: /^\/material\/humanActions\/domains\/\d+\/records\/\d+$/.test(p),
    source_applicability: !!fact.applicabilityAuthority,
    verification_outcome: /^\/material\/verificationStages\/rounds\/\d+$/.test(p),
    observation_status: /^\/material\/(goalPhase|architectureReviews|architectureActivation|humanActions|verificationStages)$/.test(p)
      || /^\/material\/humanActions\/domains\/\d+(\/records\/\d+)?$/.test(p)
      || /^\/material\/verificationStages\/(rounds|reviews)\/\d+(\/applicability)?$/.test(p)
      || /^\/material\/architectureReviews\/rows\/\d+\/decisionFacts\/(acceptedProposal|selectedCandidate|activatedBaseline)$/.test(p),
  };
  if (!locations[a.kind]) throw Error('Fact assertion is outside its authority location');
  const safe = (s: unknown) => String(s ?? '').replace(/[\r\n\[\]<>`*_]/g, ' ').slice(0, 256);
  const suffix = ` [${fact.marker}]`;
  const subjectId = a.kind === 'task_phase' ? v['ref']?.taskId ?? v['taskId'] ?? v['scope']?.taskId
    : a.kind === 'goal_phase' ? v['ref']?.goalId
    : a.kind === 'verification_outcome' ? v['roundId'] : v['ref']?.runId;
  const subject = subjectId ? `「${safe(subjectId)}」` : '';
  const expected = safe(a.expected);
  const historical = v['matchesCurrentPlan'] === false || (v['reduction'] != null && v['reductionMatchesPlan'] === false);
  const recorded = historical ? (zh ? '历史记录（不对应当前计划）：' : 'Historical record (not the current Plan): ') : '';
  switch (a.kind) {
    case 'task_dependencies': {
      const edges = v['executionDag'].dependsOn.filter((e: any) => e.taskId === a.expected);
      const list = edges.map((e: any) => `${safe(e.taskId)} → ${safe(e.dependsOnId)} (${safe(e.requires.kind)})`).join('; ');
      return (zh ? `所引计划版本中任务「${expected}」的依赖：${list || '该版本未列出依赖边'}。依赖关系不单独证明当前阻塞，须结合对应义务和正式验收记录。`
        : `Dependencies of task ${expected} in the cited Plan revision: ${list || 'no edges recorded in this revision'}. Edges alone do not establish a current blocker; obligations and formal acceptance must also be checked.`) + suffix;
    }
    case 'goal_phase': return recorded + (zh ? `目标${subject}的正式账本状态：${expected}。此记录本身不证明当前源码已验收。` : `Recorded Goal ${subject} phase: ${expected}. This record alone does not establish current-source acceptance.`) + suffix;
    case 'task_phase': return recorded + (zh ? `任务${subject}的正式验收状态：${expected}。不据此推导整个目标完成。` : `Recorded Task ${subject} acceptance phase: ${expected}; not an overall Goal completion claim.`) + suffix;
    case 'run_status': case 'run_outcome': return recorded + (zh ? `执行${subject}的记录${a.kind === 'run_status' ? '状态' : '结果'}：${expected}。执行结束或成功不等于任务验收或目标完成。` : `Recorded Run ${subject} ${a.kind === 'run_status' ? 'status' : 'outcome'}: ${expected}; not Task acceptance or Goal completion.`) + suffix;
    case 'decision_outcome': {
      if (v['proposalRef']?.aggregateType === 'InitialDesignProposal') return (zh
        ? `所引初始设计决定对候选「${safe(v['authorizedTarget']?.optionId)}」的记录结果：${expected}。不据此推导基线已激活或当前源码已验收。`
        : `Recorded initial-design decision for option ${safe(v['authorizedTarget']?.optionId)}: ${expected}; not baseline activation or current-source acceptance.`) + suffix;
      return (zh ? `所引决定对该提案的记录结果：${expected}。接受提案不等于选择具体候选，也不等于激活基线。` : `Recorded decision outcome for the cited proposal: ${expected}. Acceptance does not establish a selected option or baseline activation.`) + suffix;
    }
    case 'selected_option': return (zh ? `所引人工决定明确选择的候选：${expected}。不据此推导基线已激活。` : `Explicit option selected by the cited human decision: ${expected}; not baseline activation.`) + suffix;
    case 'current_baseline_activation': {
      const active = v['active'];
      const actor = safe(active.activatedBy.kind + ' ' + (active.activatedBy.id ?? JSON.stringify(active.activatedBy.runRef)));
      return (zh ? `项目所观测的当前架构基线「${safe(active.ref.baselineId)}」revision ${safe(String(active.ref.revision))}，激活者：${actor}。此关系不说明内容作者。` : `Observed current project baseline ${safe(active.ref.baselineId)} revision ${safe(String(active.ref.revision))}, activated by ${actor}; not content authorship.`) + suffix;
    }
    case 'baseline_activation': return (zh ? '所引提案与决定已有对应的历史基线激活记录；不证明当前源码已验收。' : 'A historical baseline activation is recorded for the cited proposal and decision; not current-source acceptance.') + suffix;
    case 'pending_human_action': return (zh ? `所引事项${a.expected === 'true' ? '仍待用户处理' : '当前不待用户处理'}；仅限该事项。` : `The cited item ${a.expected === 'true' ? 'awaits' : 'does not await'} human action; this item only.`) + suffix;
    case 'verification_outcome': return (zh ? `验证轮次${subject}的记录结果：${expected}；仅限该轮次覆盖范围，当前源码适用性须另有见证。` : `Recorded verification round ${subject} outcome: ${expected}, within its recorded coverage; current-source applicability requires a separate witness.`) + suffix;
    case 'source_applicability': {
      const statuses: Record<string, [string, string]> = {
        ready: ['所引验证记录有当前输入所捕获的源码适用性见证，不代表全部产品义务通过。', 'The cited verification record has a source-applicability witness captured in this input; not acceptance of all product obligations.'],
        stale: ['所引验证记录的源码适用性已过期；不能证明适用于当前源码，也不据此否定历史验收或创建重验任务。', 'The cited source-applicability witness is stale; this neither invalidates historical acceptance nor creates a revalidation task.'],
        unavailable: ['所引验证记录的源码适用性无法读取或确定；不等于没有验收记录。', 'Source applicability for the cited verification record is unavailable, not evidence of absent acceptance records.'],
        failed: ['所引验证记录的源码适用性检查失败；不等于产品行为验证失败。', 'Source-applicability checking failed for this record; not a product behavior test failure.'],
        not_found: ['在所引验证记录范围内未找到源码适用性见证；不据此创建任务或否定历史验收。', 'No source-applicability witness was found within this verification record; no task or negation of historical acceptance follows.'],
      };
      const wording = statuses[a.expected]; if (!wording) throw Error('Unsupported source applicability');
      return wording[zh ? 0 : 1] + suffix;
    }
    case 'observation_status': {
      const family = p.endsWith('/selectedCandidate') ? (zh ? '所引决定中的明确人工候选选择' : 'Explicit human option choice in this decision')
        : p === '/material/architectureActivation' ? (zh ? '项目基线激活观察' : 'Project baseline activation observation')
        : p.endsWith('/acceptedProposal') ? (zh ? '所引提案接受记录' : 'Cited proposal acceptance record')
        : p.endsWith('/activatedBaseline') ? (zh ? '所引提案与决定的历史激活记录' : 'Historical activations for this proposal and decision')
        : fact.pointer.startsWith('/material/humanActions') ? (zh ? '待用户事项' : 'Pending human items')
        : fact.pointer.startsWith('/material/verificationStages') ? (zh ? '验证记录' : 'Verification records')
        : fact.pointer.startsWith('/material/architectureReviews') ? (zh ? '所引架构审阅记录' : 'Cited architecture review records') : (zh ? '所引记录' : 'Cited record');
      const states: Record<string, [string, string]> = {
        ready: ['可读取；就绪本身不代表通过验收', 'readable; availability alone is not acceptance'],
        'ready-empty': ['在所引观察范围内为空；不证明其他范围或历史记录不存在', 'empty within the cited observation scope; not absence in other scopes or history'],
        not_found: ['在所引范围内未找到该对象；不作全域不存在判断', 'object not found within the cited scope; not global absence'],
        unavailable: ['无法读取或观察不完整；不能判断不存在', 'unavailable or incompletely observed; absence cannot be concluded'],
        stale: ['所引观察已过期；不能据此断言当前状态', 'observation stale; not a current-state assertion'],
        failed: ['读取或观察失败；不等于记录不存在', 'reading or observation failed; not absent records'],
      };
      const state = states[a.expected]; if (!state) throw Error('Unsupported observation');
      return `${family}：${state[zh ? 0 : 1]}。${suffix}`;
    }
  }
}
