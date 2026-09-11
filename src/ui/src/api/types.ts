/**
 * Response types for the Agent Platform Node host.
 *
 * These mirror the server-side contracts the workbench actually consumes. The
 * backend remains the authority for every business fact; this file only names the
 * fields the UI renders so a shape drift is a type error instead of a silent
 * "undefined" on screen.
 */

export type Scope = { projectId: string; workspaceId: string };
export type GoalScope = Scope & { goalId: string };
export type HistoryView = {
  materials: Array<{ id: string; label: string; workspaceId: string; owner: { projectId: string; goalId: string; runId: string }; artifactRef: { digest: string } }>;
  grants: { status: 'ready'; grants: Array<{ ref: { grantId: string }; grant: { purpose: string; reader: { runId: string } }; revocation?: { reason: string } }> } | { status: 'not_ready' };
  coverage: string;
};

export type ProjectEntry = Scope & { root: string; name: string };

/** B-1: the host's explicit execution capability. `fixtureEnabled` is the only
 * fact that may gate fixture affordances; identifier shape never is. */
export type ExecutionCapability = {
  executor: 'coding-agent' | 'fixture';
  source: 'configured-runtime' | 'explicit-fixture-service';
  fixtureEnabled: boolean;
};

export type Meta = {
  scopes: ProjectEntry[];
  executor: string;
  executionCapability: ExecutionCapability;
  exploration: { available: boolean; contextOnlyProjectIds: string[] };
  workspaceToken: string;
};

export type GoalView = {
  goalId: string;
  projectId: string;
  workspaceId: string;
  objective: string;
  activePlanRevision: { planId: string; planRevision: number } | null;
  aggregateRevision: number;
  sourceCursor: string;
};

export type GoalViewResult =
  | { status: 'ready'; goal: GoalView; observedCursor: string }
  | { status: 'not_ready'; requiredCursor: string; observedCursor: string | null }
  | { status: 'not_found'; observedCursor: string | null };

export type Phase = 'pending' | 'active' | 'satisfied' | 'blocked' | 'failed';
export type TaskReductionPhase = 'pending' | 'satisfied' | 'blocked' | 'failed' | 'COMPLETED' | 'IN_PROGRESS' | 'BLOCKED' | 'FAILED';

export type PlanMatrixRow = {
  taskId: string;
  title: string;
  stageId: string | null;
  stageTitle: string | null;
  requirementLevel: string;
  taskKind: 'work' | 'gate' | string;
  disposition: string;
  plannedPhase: Phase;
  livePhase: TaskReductionPhase | null;
  phaseMismatch: boolean;
  sourceCursor: string;
};

export type PlanMatrixView = {
  planRef: { planId: string; planRevision: number };
  planRevision: number;
  stages: Array<{ stageId: string; title: string }>;
  rows: PlanMatrixRow[];
  taskCount: number;
  sourceCursor: string;
  updatedAt: string | null;
};

export type PlanMatrixResult =
  | { status: 'ready'; matrix: PlanMatrixView; observedCursor: string }
  | { status: 'not_ready'; requiredCursor: string; observedCursor: string | null }
  | { status: 'not_found'; observedCursor: string | null };

export type RunDisplayState = 'starting' | 'ongoing' | 'completed_run' | 'crashed' | 'cancelled' | 'budget_exhausted' | 'outcome_unknown' | 'ended_no_outcome';

export type AgentRunRow = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  runRef: { runId: string };
  attemptRef: { attemptId: string };
  binding: { templateId: string; roleBindingId?: string };
  runStatus: string;
  runOutcome: string | null;
  exitCode: number | null;
  lastEventSeq: number;
  startedAt: string | null;
  endedAt: string | null;
  displayState: RunDisplayState;
  handoff: null | { reason: string; claimedAt: string };
  sourceCursor: string;
};

export type AgentsView = { rows: AgentRunRow[]; taskCount: number; sourceCursor: string; updatedAt: string | null };
export type AgentsResult =
  | { status: 'ready'; agents: AgentsView; observedCursor: string }
  | { status: 'not_ready'; requiredCursor: string; observedCursor: string | null }
  | { status: 'not_found'; observedCursor: string | null };

export type EvidenceEntry = {
  evidenceId: string;
  kind: string;
  marker: string;
  outcome: string;
  summary: string;
  checkId: string | null;
  artifactRef: { digest?: string; refId?: string } | null;
  sourceRunRef: { runId: string } | null;
  admittedAt: string;
  applicability: string | null;
};

export type TaskEvidenceView = {
  taskId: string;
  planRef: { planId: string; planRevision: number };
  planRevision: number;
  evidence: EvidenceEntry[];
  effectiveEvidenceIds: string[];
  blockingEvidenceIds: string[];
  staleEvidenceIds: string[];
  outOfScopeEvidenceIds: string[];
  reduction: { phase: TaskReductionPhase; causes: Array<{ code?: string; message?: string }>; reducedAt: string } | null;
  modelExplanation: { status: string };
  sourceCursor: string;
  updatedAt: string | null;
};

export type TaskEvidenceResult =
  | { status: 'ready'; evidence: TaskEvidenceView; observedCursor: string }
  | { status: 'not_ready'; requiredCursor: string; observedCursor: string | null }
  | { status: 'not_found'; observedCursor: string | null };

export type GoalStatusView = {
  goalId: string;
  phase: string;
  previousPhase: string | null;
  planRef: { planId: string; planRevision: number } | null;
  reasonCodes: string[];
  explanation: { summary?: string; status?: string };
  sideEffectReconciliation: { status?: string; message?: string };
  aggregateRevision: number;
  sourceCursor: string;
  updatedAt: string | null;
};

export type GoalStatusResult =
  | { status: 'ready'; goal: GoalStatusView; observedCursor: string }
  | { status: 'not_ready'; requiredCursor: string; observedCursor: string | null }
  | { status: 'not_found'; observedCursor: string | null };

/**
 * RW-09：计划变更类条目带的事实补充，逐字来自投影（界面不拼接、不推断）。
 * reason 为 `autonomous-rework:<proposalId>` 或 `user-decision-accepted`；
 * actor 来自同一条已提交事件，因此界面可以据此如实标注「系统自动受理／人的决定」。
 */
export type TimelineChangeFact = {
  reason: string;
  actor: { kind: 'human' | 'system'; id: string };
  goalRevision: number;
  activePlanId: string;
  supersededPlanIds: string[];
};

export type TimelineEntry = {
  kind: string;
  summary: string;
  occurredAt: string;
  refs: { taskId?: string; runId?: string; goalId?: string; planId?: string };
  change?: TimelineChangeFact;
};

export type PlanGraph = {
  planRef: { planId: string; planRevision: number };
  planRevision: number;
  acceptedAt: string;
  pinnedCompletionPolicy: { ref: { policyId: string; revision: number } };
  pinnedArchitectureBaseline: { ref: { baselineId: string; revision: number } };
  stages: Array<{ stageId: string; title: string }>;
  tasks: Array<{ taskId: string; title: string; taskKind: string; stageId: string | null; requirementLevel: string }>;
  taskHierarchy: { parentOf: Array<{ parentTaskId: string; childTaskId: string }> };
  executionDag: { dependsOn: Array<{ taskId: string; dependsOnId: string; requires: { kind: string; label: string } }> };
  sourceCursor: string;
};

export type PlanGraphResult =
  | { status: 'ready'; graph: PlanGraph; observedCursor: string }
  | { status: 'not_ready'; requiredCursor: string; observedCursor: string | null }
  | { status: 'not_found'; observedCursor: string | null };

export type QueryJob = {
  queryJobId: string;
  goalId: string;
  submittedAt: string;
  closeReason: { code?: string; message?: string } | null;
  intent: { question: string; focusTaskRefs: Array<{ taskId: string }>; execution?: { kind: string; feedback?: import('../../../contracts/execution-feedback.js').FeedbackSource } };
};

export type QueryJobView = {
  status: 'ready' | 'not_found' | 'not_ready';
  job: QueryJob;
  currentAnswer: { answer: string; answeredAt: string; stale: boolean; sources: Array<{ label?: string; refKey: string; version: string }> } | null;
};

export type WorkspaceSummaryView = {
  goalCount: number;
  taskCount: number;
  planRevisionCount: number;
  agentRunCount: number;
  evidenceCount: number;
  phaseCounts: { taskReduction: Record<string, number>; goalPhase: Record<string, number> };
  sourceCursor: string;
  updatedAt: string | null;
};

export type WorkspaceSummaryResult =
  | { status: 'ready'; summary: WorkspaceSummaryView; observedCursor: string }
  | { status: 'not_ready'; requiredCursor: string; observedCursor: string | null }
  | { status: 'not_found'; observedCursor: string | null };

export type RunEvent = {
  sequence: number;
  type: string;
  at: string;
  data: {
    call?: { callId: string; name: string; arguments?: Record<string, unknown> };
    callId?: string;
    message?: { content: string };
    result?: { status?: string; output?: Array<{ kind: string; text?: string; value?: unknown }> };
    error?: unknown;
  };
};

export type UsageEntry = { requestId: string; status: string; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reservedInput?: number; reservedOutput?: number };

/**
 * One explicit command check as projected by `GET /api/state` (liveRuns[].commandChecks).
 * The projection fields are nullable on purpose: records persisted before this
 * projection existed carry no command/kind/timestamps, and the UI must show the
 * gap instead of inventing values. `status` is the record lifecycle
 * (running/finished/interrupted) and is NOT the check verdict; the verdict lives
 * in `result.observations[].result` (PASS/FAIL/INCONCLUSIVE).
 */
export type VerificationObservation = {
  checkId: string;
  kind: 'static' | 'dynamic' | string;
  result: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | string;
  coverage?: Array<{ obligationId: string; requirementId: string }>;
  summary: string;
  artifactRef: { digest?: string; refId?: string; kind?: string } | null;
};

export type VerificationResult =
  | { status: 'ready'; plan?: { planId?: string; planDigest?: string; workspaceRevision?: number; checks?: Array<{ checkId: string; kind: string; satisfactionPath: string }> }; observations: VerificationObservation[]; verificationPlanRef?: { planId?: string; planDigest?: string } }
  | { status: 'incomplete'; gaps?: string[]; issues?: Array<{ path?: string; message?: string }> }
  | { status: 'rejected'; code?: string; issues?: Array<{ path?: string; message?: string }> };

export type CommandCheck = {
  requestId: string;
  status: 'running' | 'finished' | 'interrupted' | string;
  command: string | null;
  kind: 'static' | 'dynamic' | null;
  timeoutMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: VerificationResult | null;
  lifecycle?: string | null;
  recovery?: { reason: string; commandReplayAllowed: false } | null;
  evidenceAdmission?: { status: 'pending' | 'admitted'; reportDigest: string; evidenceIds: string[] } | null;
};

export type VerificationEntry = {
  verificationId: string;
  purpose: string;
  verdict: string;
  candidateDigest?: string;
  candidateId?: string;
  source?: { name?: string; reportUri?: string };
  counts?: { passed?: number; failed?: number; missing?: number };
  control?: { status?: string; taskPhase?: string; goalPhase?: string };
  failedTests?: string[];
  missingTests?: string[];
  importedAt?: string;
  completedAt?: string;
};

export type LiveRun = {
  spec: {
    projectId: string; workspaceId: string; goalId: string; runId: string; taskId: string;
    instruction: string; mode?: string; root?: string;
    budget: { contextWindowTokens: number; inputTokens: number | null; outputTokens: number | null; maxRequests: number | null; maxToolCalls: number | null; timeoutMs: number | null; perResponseTokens?: number | null };
  };
  status: 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled' | 'budget_exhausted' | 'outcome_unknown' | string;
  error: string | null;
  cancelRequested?: boolean;
  sessionId?: string | null;
  configuration?: { revision?: string; provider?: string; model?: string } | null;
  workspaceRevision?: string | number | null;
  usage: UsageEntry[];
  trace: RunEvent[];
  commandChecks?: CommandCheck[];
  rounds?: import('../../../contracts/verification-round.js').VerificationRoundRecord[];
  reviews?: import('../../../contracts/reviewer-verification.js').ReviewReceipt[];
  verifications?: VerificationEntry[];
  taskTitle?: string;
};

export type ExplorationNode = { taskId: string; title: string; instruction: string; dependsOn: string[] };
export type ExplorationReport = {
  taskId: string; runId: string; report: string; reportDigest: string;
  sourceDigest?: string; workspaceRevision?: unknown; sourceReads?: unknown; completedAt?: string;
};
export type ExplorationReview = {
  reviewId: string; taskId: string; runId: string | null; verdict: string; reviewText?: string;
  control?: { status?: string; taskPhase?: string | null; goalPhase?: string | null }; reviewedAt?: string;
};
export type ExplorationView = {
  planOrigin?: string;
  planId?: string;
  tasks?: ExplorationNode[];
  gateTaskId?: string;
  sourceDigest?: string;
  createdAt?: string;
  reports?: ExplorationReport[];
  reviews?: ExplorationReview[];
  reportErrors?: Array<{ runId: string; error: string }>;
};

export type GuiState = {
  scope: Scope;
  goalId: string;
  goals: GoalViewResult[];
  summary: WorkspaceSummaryResult;
  matrix: PlanMatrixResult;
  agents: AgentsResult;
  timeline: { status: string; timeline?: { entries: TimelineEntry[] } };
  graph: PlanGraphResult;
  evidence: TaskEvidenceResult[];
  queries: QueryJobView[];
  goalStatus: GoalStatusResult;
  exploration: ExplorationView | null;
  planning?: Array<{ queryJobId: string; requestId: string; status: string; issue: string | null;
    proposal: { status: 'needs_decision'; summary: string; questions: string[] } | { status: 'plan'; plan: { planId: string; origin: { summary: string; assignments: Array<{ taskId: string; role: string; instruction: string }> } } } | null;
    runs: Array<{ status: string; kind: string; configuration: { provider: string; model: string } | null; usage: Array<{ inputTokens: number | null; outputTokens: number | null }> }> }>;
  liveRuns: LiveRun[];
  observedCursor: string;
  executor: string;
  executionCapability: ExecutionCapability;
  storage: string;
};

export type FileEntry = { name: string; path: string; kind: 'directory' | 'file' | 'link' };
export type DirectoryListing = { root: string; path: string; entries: FileEntry[]; truncated: boolean };
export type FilePreview =
  | { kind: 'text'; path: string; size: number; sha256: string; content: string }
  | { kind: 'binary' | 'too_large' | 'directory'; path: string; size?: number };
export type TerminalSession = { id: string; cwd: string; createdAt: string; status: 'running' | 'exited'; exitCode: number | null; cols: number; rows: number };
export type TerminalOutput = TerminalSession & { chunks: Array<{ seq: number; data: string; cols: number; rows: number }>; through: number; truncated: boolean };

export type ModelConfiguration = { revision: string; provider: string; model: string; baseUrl: string; protocol: string; updatedAt: string };
export type ModelSettingsView = {
  configuration: ModelConfiguration | null;
  keyConfigured: boolean;
  providers: Array<{ id: string; defaultBaseUrl: string }>;
};
export type ModelTestResult = { ok: boolean; message: string; calls?: Array<{ usage?: { inputTokens?: number; outputTokens?: number } }> };

/** Raw sandbox outcome as persisted inside a command-check report body. */
export type CommandExecution = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: { text: string; totalBytes: number; truncated: boolean };
  stderr: { text: string; totalBytes: number; truncated: boolean };
  effects?: { workspaceRevision?: number | null } & Record<string, unknown>;
  sandboxProfileVersion: string;
  timings?: { snapshotBeforeMs?: number; executionMs?: number; snapshotAfterMs?: number };
};

/**
 * A persisted command-check report body (the JSON written to the ArtifactVault
 * by CommandCheckProvider and returned verbatim in `reports[]`). The command,
 * classification and sandbox output live here — never at the response root.
 */
export type CommandCheckReportBody = {
  schemaVersion: number;
  observationId: string;
  owner: { aggregateType: string; projectId: string; goalId: string; runId: string };
  context: {
    projectId: string; goalId: string; taskId: string;
    planRef: { aggregateType: string; projectId: string; planId: string };
    workspaceRevision: number;
    changeScope: { diffClass: string; changedFiles: string[]; writeSummary: string };
  };
  sourceDigest: string;
  definition: { checkId: string; kind: 'static' | 'dynamic' | string; command: string; cwd: string; timeoutMs: number };
  startedAt: string;
  endedAt: string;
  category: string;
  result: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | string;
  execution: CommandExecution | null;
  effects?: 'known' | 'unknown' | 'not_started';
};

/** POST /api/real/verifications/check-report — record projection + persisted reports. */
export type CheckReportsResponse = {
  requestId: string;
  status: 'running' | 'finished' | 'interrupted' | string;
  command: string | null;
  kind: 'static' | 'dynamic' | null;
  timeoutMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  observations: VerificationObservation[];
  reports: CommandCheckReportBody[];
  lifecycle?: CommandCheck['lifecycle'];
  recovery?: CommandCheck['recovery'];
  evidenceAdmission?: CommandCheck['evidenceAdmission'];
};

/** POST /api/receipts — what the server actually recorded for one logical request. */
export type ReceiptView = {
  requestId: string;
  kind: 'goal' | 'real-task' | 'command-check' | 'verification-round' | 'independent-review';
  found: boolean;
  goalStatus: string | null;
  runId: string | null;
  runStatus: string | null;
  runtimeStatus: string | null;
  check: { runId: string; status: string; command: string | null; kind: string | null; timeoutMs: number | null; startedAt: string | null; finishedAt: string | null } | null;
  round?: { runId: string; taskId: string; status: string; roundId: string; requestId: string } | null;
  review?: import('../../../contracts/reviewer-verification.js').ReviewReceipt | null;
  observedAt: string;
};

export type RequestReference = { path: string; sha256: string; lines?: { start: number; end: number } };
