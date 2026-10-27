/**
 * Row 40: the one shared expected route table. Each route-table test compares `CORE_ROUTE_SPECS`
 * with the rows it names here. Literal expected rows only: no helper logic, no read and no production import.
 */

/** The expected kind, binding and documented owner of every route a route-table test checks. */
export const EXPECTED_ROUTE_ROWS = {
  // Slice 1 (spec §4.4): the Session facts, corrections and archive routes.
  'sessions/archive-line': { kind: 'graph_write', binding: 'archiveLine', owner: 'workflow.archiveLine' },
  'sessions/archive-continue': { kind: 'plain', binding: 'continueArchiveLine', owner: 'workflow.continueArchiveLine' },
  'sessions/archive-release': { kind: 'graph_write', binding: 'releaseSessionArchiveRequest', owner: 'sessions.releaseSessionArchiveRequest' },
  'sessions/facts': { kind: 'plain', binding: 'readSessionFacts', owner: 'sessionFacts.readSessionFacts' },
  'sessions/successors': { kind: 'plain', binding: 'findSessionSuccessors', owner: 'sessionFacts.findSessionSuccessors' },
  'sessions/executions': { kind: 'plain', binding: 'listSessionExecutions', owner: 'sessionFacts.listSessionExecutions' },
  'sessions/queries': { kind: 'plain', binding: 'listSessionQueries', owner: 'sessionFacts.listSessionQueries' },
  'sessions/transfer-responsibility': { kind: 'graph_write', binding: 'transferSessionResponsibility',
    owner: 'responsibilities.transferSessionResponsibility' },
  'tasks/archive-state': { kind: 'plain', binding: 'readTaskArchiveState', owner: 'sessionAnomalies.readTaskArchiveState' },
  'anomalies/list': { kind: 'plain', binding: 'listSessionAnomalies', owner: 'sessionAnomalies.listSessionAnomalies' },
  'messages/undelivered-replies': { kind: 'plain', binding: 'readUndeliveredReplies', owner: 'messages.readUndeliveredReplies' },
  // Slice 2C (§2): the line and node-detail routes.
  'lines/list': { kind: 'plain', binding: 'listWorkLines', owner: 'workLines.listWorkLines' },
  'lines/archived': { kind: 'plain', binding: 'listArchivedLines', owner: 'workLines.listArchivedLines' },
  'lines/read': { kind: 'plain', binding: 'readWorkLine', owner: 'workLines.readWorkLine' },
  'lines/page': { kind: 'plain', binding: 'readWorkLinePage', owner: 'workLineConversation.readWorkLinePage' },
  'lines/pin': { kind: 'graph_write', binding: 'setLinePins', owner: 'lineSettings.setLinePins' },
  'graph/hover': { kind: 'plain', binding: 'readGraphHover', owner: 'nodeDetail.readGraphHover' },
  'graph/detail': { kind: 'plain', binding: 'readNodeDetail', owner: 'nodeDetail.readNodeDetail' },
  // Slice 4C (R-01): the notes and version-list routes.
  'notes/list': { kind: 'plain', binding: 'listNotes', owner: 'notes.listNotes' },
  'notes/write': { kind: 'plain', binding: 'writeNote', owner: 'notes.writeNote' },
  'notes/withdraw': { kind: 'plain', binding: 'withdrawNote', owner: 'notes.withdrawNote' },
  'notes/review': { kind: 'plain', binding: 'reviewNote', owner: 'notes.reviewNote' },
  'plans/versions': { kind: 'plain', binding: 'listPlanVersions', owner: 'notes.listPlanVersions' },
  'architecture/versions': { kind: 'plain', binding: 'listCatalogVersions', owner: 'notes.listCatalogVersions' },
  // The MVP UI routes.
  'executions/list': { kind: 'plain', binding: 'listExecutions', owner: 'executions.listExecutions' },
  'projects/read': { kind: 'plain', binding: 'readProject', owner: 'projects.readProject' },
  'files/save': { kind: 'plain', binding: 'saveWorkspaceFile', owner: 'workbench.saveFile' },
  'files/list': { kind: 'plain', binding: 'listWorkspaceFiles', owner: 'workbench.listFiles' },
  'files/compare': { kind: 'plain', binding: 'compareWorkspaceFiles', owner: 'workspace.compareWorkspace' },
  'commands/start': { kind: 'plain', binding: 'startCommand', owner: 'workbench.startCommand' },
  'commands/read': { kind: 'plain', binding: 'readCommand', owner: 'workbench.readCommand' },
  'commands/stop': { kind: 'plain', binding: 'stopCommand', owner: 'workbench.stopCommand' },
  // Slice 8A: the three architecture reads.
  'architecture/compare': { kind: 'plain', binding: 'compareArchitecture', owner: 'architecture.compareArchitecture' },
  'architecture/compare-formal': { kind: 'plain', binding: 'compareFormalObserved', owner: 'architecture.compareFormalObserved' },
  'architecture/impact': { kind: 'plain', binding: 'queryImpact', owner: 'architecture.queryImpact' },
  // Slice 3: the graph find route and the three legacy reads beside it.
  'graph/find': { kind: 'plain', binding: 'findGraph', owner: 'graphContext.findGraph' },
  'tasks/query': { kind: 'plain', binding: 'queryTaskGraph', owner: 'plans.queryTaskGraph' },
  'executions/history': { kind: 'plain', binding: 'readTaskExecutionHistory', owner: 'runtime.readTaskExecutionHistory' },
  'executions/brief': { kind: 'plain', binding: 'readContinuationBrief', owner: 'runtime.readContinuationBrief' },
  // The two Goal-card commands, the copy preview and the initialization adoption.
  'goals/confirm-draft': { kind: 'plain', binding: 'confirmGoalDraft', owner: 'goals.confirmDraft' },
  'goals/copy-draft': { kind: 'plain', binding: 'readGoalCopyDraft', owner: 'goals.readGoalCopyDraft' },
  'goals/copy-confirm': { kind: 'plain', binding: 'confirmGoalCopy', owner: 'goals.confirmGoalCopy' },
  'initialization/adopt': { kind: 'plain', binding: 'adoptInitialization', owner: 'initialization.adopt' },
} as const;

/** The eleven slice-1 suffixes, in the order `tests/app/S1-session-routes.test.ts` checks them. */
export const SLICE1_ROUTES = [
  'sessions/archive-line', 'sessions/archive-continue', 'sessions/archive-release', 'sessions/facts',
  'sessions/successors', 'sessions/executions', 'sessions/queries', 'sessions/transfer-responsibility',
  'tasks/archive-state', 'anomalies/list', 'messages/undelivered-replies',
] as const;

/** The seven slice-2C suffixes (`tests/app/S2C-line-routes.test.ts`). */
export const SLICE2C_ROUTES = [
  'lines/list', 'lines/archived', 'lines/read', 'lines/page', 'lines/pin', 'graph/hover', 'graph/detail',
] as const;

/** The six notes and version-list suffixes (`tests/app/S4C-note-routes.test.ts`). */
export const NOTES_ROUTES = [
  'notes/list', 'notes/write', 'notes/withdraw', 'notes/review', 'plans/versions', 'architecture/versions',
] as const;

/** The eight MVP UI suffixes (`tests/app/MVP-ui-entry.test.ts`). */
export const MVP_UI_ROUTES = [
  'executions/list', 'projects/read', 'files/save', 'files/list', 'files/compare',
  'commands/start', 'commands/read', 'commands/stop',
] as const;

/** The three slice-8A architecture reads (`tests/app/S8A-architecture-routes.test.ts`). */
export const ARCHITECTURE_READ_ROUTES = ['architecture/compare', 'architecture/compare-formal', 'architecture/impact'] as const;

/** The three legacy reads `tests/app/S3-graph-routes.test.ts` RT06 checks. */
export const LEGACY_READ_ROUTES = ['tasks/query', 'executions/history', 'executions/brief'] as const;

/** The four Goal-card and adoption suffixes (`tests/app/S6B3-routes.test.ts`). */
export const S6B3_ROUTES = ['goals/confirm-draft', 'goals/copy-draft', 'goals/copy-confirm', 'initialization/adopt'] as const;
