/** Pure architecture containment tree and dependency list. */

import type { ArchitectureRevision, ReadResult } from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, rejectionPanel, renderGap } from '../../components/html.js';
import type { WorkbenchGraphDisplay } from '../../state/layout.js';
import { renderNodeLinkGraph } from './node-link.js';

export type ArchitectureContainmentDisplay = {
  activeModuleIds: string[];
  expanded: string[];
  pinned: string[];
  selected: string | null;
};

/** Formal containment tree. Containment comes ONLY from
 * `catalog.catalog.containment.parentOf`; a missing `containment` is a real
 * "not declared" gap and paths/dependencies are never used to infer a parent.
 * Active modules expand the union of their ancestor paths (and their siblings),
 * manual branches stay open and pinned nodes keep their ancestors open. */
export function renderArchitectureContainment(
  result: ReadResult<ArchitectureRevision>,
  display?: ArchitectureContainmentDisplay,
): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('architecture/read', '没有已采用的架构 baseline');
  if (result.status === 'not_ready') return renderGap('architecture/read', '采用架构尚未就绪');
  const revision = result.value;
  if (revision.catalog === null) {
    return `<section class="panel" data-view="architecture-containment"><h3>架构包含结构</h3>`
      + `<p class="muted">该 baseline 早于 catalog，未记录模块包含关系。</p></section>`;
  }
  const modules = revision.catalog.catalog.modules;
  const containment = revision.catalog.catalog.containment;
  // A missing containment declaration is not a guessed tree: an empty relation
  // set makes every declared module a real parallel root on the SAME roots/graph
  // path. Dependencies and paths never become edges.
  const parentOf = containment?.parentOf ?? [];
  const moduleById = new Map(modules.map(module => [module.ref.moduleId, module]));
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const edge of parentOf) {
    const parentId = edge.parent.moduleId;
    const childId = edge.child.moduleId;
    if (!moduleById.has(parentId) || !moduleById.has(childId)) continue;
    const bucket = children.get(parentId);
    if (bucket === undefined) children.set(parentId, [childId]); else bucket.push(childId);
    parent.set(childId, parentId);
  }
  const roots = modules.filter(module => !parent.has(module.ref.moduleId)).map(module => module.ref.moduleId);
  const active = new Set(display?.activeModuleIds ?? []);
  const manualExpanded = new Set(display?.expanded ?? []);
  const pinned = new Set(display?.pinned ?? []);
  const requiredOpen = new Set<string>(manualExpanded);
  const markAncestors = (moduleId: string): void => {
    let current = parent.get(moduleId);
    let guard = 0;
    while (current !== undefined && guard < 256) { requiredOpen.add(current); current = parent.get(current); guard += 1; }
  };
  for (const moduleId of active) markAncestors(moduleId);
  for (const moduleId of pinned) markAncestors(moduleId);
  const visible = new Set<string>();
  const visit = (moduleId: string): void => {
    visible.add(moduleId);
    if (requiredOpen.has(moduleId)) for (const child of children.get(moduleId) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  const graph = renderNodeLinkGraph(modules.filter(module => visible.has(module.ref.moduleId)).map(module => ({
    id: module.ref.moduleId, label: module.name,
    caption: active.has(module.ref.moduleId) ? '工作中' : '已采用模块',
    action: 'select-node',
    data: { 'target-kind': 'module', 'project-id': module.ref.projectId, 'module-id': module.ref.moduleId },
    title: `${module.name}（${module.ref.moduleId}）\n${module.responsibility}`,
    ...((children.get(module.ref.moduleId)?.length ?? 0) > 0 ? { branch: { expanded: requiredOpen.has(module.ref.moduleId) } } : {}),
  })), parentOf.filter(edge => visible.has(edge.parent.moduleId) && visible.has(edge.child.moduleId))
    .map(edge => ({ from: edge.parent.moduleId, to: edge.child.moduleId })), '架构包含结构图',
    { pinned: [...pinned],
      labels: [...new Set([...roots, ...active, ...requiredOpen, ...[...requiredOpen].flatMap(id => children.get(id) ?? []), ...pinned, ...(display?.selected !== null && display?.selected !== undefined ? [display.selected] : [])])],
      selected: display?.selected !== undefined && display.selected !== null && moduleById.has(display.selected)
        ? { kind: 'module', nodeId: display.selected, target: { kind: 'module', ref: moduleById.get(display.selected)!.ref } } : null });
  return `<section class="panel" data-view="architecture-containment">`
    + (containment === undefined
      ? detailsFor('未声明包含关系（containment）',
        `<p class="muted">该修订未声明包含关系；包含结构不从 paths 或 dependencies 推断，以上为真实并列根模块。</p>`)
      : '')
    + graph
    + detailsFor('图信息与显示选项', `<p>${modules.length} 个模块 · 活跃 ${active.size}</p>`
      + `<button data-action="expand-active-paths">展开活跃路径</button>`
      + `<button data-action="collapse-branches">收起手动分支</button>`
      + `<p>基线 ${escapeHtml(revision.baseline.baselineId)} · 版本 ${escapeHtml(revision.baseline.revision)}</p>`)
    + `</section>`;
}

/** The independent dependency DAG. It reads only `catalog.dependencies` and is
 * never derived from containment or paths. */
export function renderArchitectureDependencies(
  result: ReadResult<ArchitectureRevision>, display?: WorkbenchGraphDisplay,
): string {
  if (result.status === 'rejected') return rejectionPanel(result);
  if (result.status === 'not_found') return renderGap('architecture/read', '没有已采用的架构 baseline');
  if (result.status === 'not_ready') return renderGap('architecture/read', '采用架构尚未就绪');
  const revision = result.value;
  if (revision.catalog === null) return `<section class="panel" data-view="architecture-dependencies"><h3>模块依赖 DAG</h3><p class="muted">该 baseline 早于 catalog，未记录依赖。</p></section>`;
  const modules = revision.catalog.catalog.modules;
  const dependencies = revision.catalog.catalog.dependencies;
  const html = renderNodeLinkGraph(
    modules.map(module => ({
      id: `dep:${module.ref.moduleId}`,
      label: module.name,
      caption: '已采用模块',
      action: 'select-node',
      data: { 'target-kind': 'module', 'project-id': module.ref.projectId, 'module-id': module.ref.moduleId,
        'node-label': module.name, 'node-detail': module.responsibility },
      title: `${module.name}（${module.ref.moduleId}）`,
    })),
    dependencies.map(dependency => ({ from: `dep:${dependency.from.moduleId}`, to: `dep:${dependency.to.moduleId}`, label: dependency.reason })),
    '模块依赖 DAG', display,
  );
  const edges = dependencies.map(dependency =>
    `<li>${escapeHtml(dependency.from.moduleId)} \u2192 ${escapeHtml(dependency.to.moduleId)} `
    + `<span class="muted">${escapeHtml(dependency.reason)}</span></li>`).join('');
  return `<section class="panel" data-view="architecture-dependencies">`
    + html + (edges.length === 0 ? '<p class="muted">没有声明依赖</p>' : detailsFor('依赖依据', `<ul class="edges">${edges}</ul>`)) + `</section>`;
}
