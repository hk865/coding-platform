/**
 * R6.1a pure workbench rendering.
 *
 * Every function here turns an already-versioned Host DTO into HTML text. It
 * touches no DOM global, no network and no business state, so the same module
 * is safe to import from the browser bundle and from a Node test. The browser
 * `main.ts` owns the DOM; this file owns the presentation.
 *
 * The adopted architecture and the observed source graph are rendered as two
 * distinct panels with their own refs/versions. A missing or rejected read is
 * shown as a real gap; it is never collapsed into a fake baseline label.
 *
 * This file is the published `views.js` entry and the stable import path for
 * tests. It only re-exports the pure modules listed below; none of them
 * imports DOM, store or transport code.
 */

// ---------------------------------------------------------------------------
// Render contract (stable hooks the tests assert):
//   - `renderWorkbenchLayout` emits `data-view="workbench-layout"`, each tab as
//     `data-tab="<tabId>"` with its `data-tab-kind`, and `草稿快照` on a draft.
//   - `renderSessionHistoryTimeline` emits, per original entry, `data-history`
//     = recordId and `data-history-kind` in
//     user_input | assistant_text | tool_result | unknown |
//     artifact, always in original order and never re-sorted.
//   - `renderTaskStructure` emits `data-structure="hierarchy"` (`parentOf`) and
//     `data-structure="execution"` (`dependsOn`) as two distinct sections and
//     keeps planning-only/optional/future rows.
//   - `renderWorkLinkTarget` emits `data-work-link="task|module|work"` plus the
//     full real ref and a `data-action="find-sessions"` navigation button.
// ---------------------------------------------------------------------------

export {
  UI_PLATFORM_TOKEN_HEADER,
  UI_PLATFORM_TOKEN_META_NAME,
  UI_CORE_API_PREFIX,
  UI_BOOTSTRAP_SUFFIX,
} from './api/protocol.js';
export { escapeHtml, renderGap } from './components/html.js';
export {
  renderBootstrap,
  renderModuleList,
  renderGoalDetail,
  renderPlanProposal,
  renderRouteResponse,
} from './views/setup/render.js';
export {
  renderAdoptedGraph,
  renderObservedGraph,
  renderTaskRow,
  renderTaskGraph,
  renderTaskExecutionEntry,
  renderGraphPanels,
} from './views/graphs/node-link.js';
export {
  renderFileRead,
  renderSourceCapture,
  renderSourcePage,
  renderFileSave,
  renderTextDiff,
  renderWorkspaceComparison,
} from './views/files/render.js';
export {
  renderSessionRoleOptions,
  renderSessionSummary,
  renderSessionDetail,
  renderSessionOperation,
  renderSessionOperationRead,
  renderInbox,
  renderMessage,
  renderMessageBody,
  renderSessionHistory,
  renderRuntimeCapabilities,
} from './views/sessions/render.js';
export { createWorkbenchLayout, reduceWorkbenchLayout, renderWorkbenchLayout } from './state/layout.js';
export type {
  WorkbenchTabKind,
  WorkbenchDraftReference,
  WorkbenchDraft,
  WorkbenchNodeSelection,
  WorkbenchGraphDisplay,
  WorkbenchTab,
  WorkbenchLayout,
  WorkbenchLayoutAction,
} from './state/layout.js';
export {
  renderInitialPlanSetupReview,
  renderSessionHistoryTimeline,
  executionHistoryMatches,
  renderExecutionRecord,
  renderExecutionHistory,
} from './views/history/timeline.js';
export type { WorkbenchExecutionHistoryPage } from './views/history/timeline.js';
export { renderTaskStructure, renderWorkLinkTarget } from './views/graphs/task-structure.js';
export {
  planExecutionContinuation,
  renderExecutionProfiles,
  renderQueryAnswer,
  renderWorkflowAdvance,
  renderInitialPlanning,
} from './views/execution/render.js';
export type { ExecutionContinuation } from './views/execution/render.js';
export { taskTimelineRunKey, renderTaskExecutionTimeline, renderTaskExecutionFold } from './views/observe/render.js';
export type { TaskTimelineDisplay } from './views/observe/render.js';
export { renderArchitectureContainment, renderArchitectureDependencies } from './views/graphs/architecture.js';
export type { ArchitectureContainmentDisplay } from './views/graphs/architecture.js';
export { renderWorkbenchCommand } from './views/terminal/render.js';
export { renderProjectRead, renderProjectConversation } from './views/conversation/project-render.js';
export type { ProjectReadState } from './views/conversation/project-render.js';
