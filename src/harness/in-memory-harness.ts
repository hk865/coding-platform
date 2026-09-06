/**
 * In-memory P1-00 harness: wires the REAL modules (lanes A/B/C) and the
 * shared contracts into one executable tracer-bullet integration path:
 *   bootstrap -> createGoal -> InMemoryLedger -> EventPage -> ReadModelIndex -> GoalView
 *
 * P1-03 (frozen by the shared baseline): the harness additionally wires the
 * REAL dispatch/run modules — ArtifactVault / ContextCompilerImpl /
 * FakeRuntimeAdapter / DispatchEngineImpl — around the SAME InMemoryLedger, so
 * the full path claim -> assemble -> start -> run facts is executable.
 * Lane entry points (fixed by the shared baseline):
 *   - A: src/ledger/in-memory-ledger.ts        (InMemoryLedger implements StateLedger)
 *   - B: src/control/control-engine.ts         (ControlEngineImpl)
 *   - C: src/read-model/read-model-index.ts    (ReadModelIndexImpl)
 *       src/interaction/human-collaboration.ts (HumanCollaborationImpl)
 *   - P1-03: src/vault/artifact-vault.ts, src/context/context-compiler.ts,
 *            src/runtime/fake-runtime-adapter.ts, src/control/dispatch-engine.ts
 */
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../contracts/bootstrap.js";
import type { CommitCursor } from "../contracts/command-event.js";
import type { ProjectionReceipt } from "../contracts/goal-view.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine, HumanCollaboration } from "../contracts/modules.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "../contracts/governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "../contracts/plan.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../contracts/plan-view.js";
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunFactCommand,
  RunFactReceipt,
} from "../contracts/dispatch.js";
import type { ActiveAgentQuery, ActiveAgentViewResult } from "../contracts/active-agent.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { TaskContextPort } from "../contracts/task-envelope.js";
import type { DispatchDriveResult, DispatchDriveTrigger, DispatchPort, RunPort } from "../contracts/ports.js";
import type {
  TaskVerificationViewQuery,
  TaskVerificationViewResult,
} from "../contracts/verification-view.js";
import type { ReviewerPort, CheckPort, VerificationPort } from "../contracts/verification.js";
import type { SubmitEvidenceCommand, SubmitEvidenceReceipt } from "../contracts/evidence.js";
import type { ReduceTaskCommand, ReduceTaskReceipt } from "../contracts/reduction.js";
import type { ReviewContextPort, ReviewContextRequestV1, ReviewContextResultV1 } from "../contracts/review-context.js";
import type { FakeRuntimeScriptV1 } from "../contracts/fixtures/dispatch-fixtures.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../contracts/fixtures/dispatch-fixtures.js";
import { InMemoryLedger } from "../ledger/in-memory-ledger.js";
import { ControlEngineImpl } from "../control/control-engine.js";
import { ReadModelIndexImpl } from "../read-model/read-model-index.js";
import { HumanCollaborationImpl } from "../interaction/human-collaboration.js";
import { ArtifactVault } from "../vault/artifact-vault.js";
import { ContextCompilerImpl } from "../context/context-compiler.js";
import { FakeRuntimeAdapter } from "../runtime/fake-runtime-adapter.js";
import { DispatchEngineImpl } from "../control/dispatch-engine.js";
import { createDeterministicDeps, type InjectableDeps } from "../contracts/testing/sequences.js";
import { DETERMINISTIC_CHECK_PROVIDERS, FAKE_REVIEWER_PORT } from "../contracts/testing/check-providers.double.js";
import { VerificationEngineImpl } from "../verification/verification-engine.js";
import { ReviewContextCompilerImpl } from "../context/review-context-compiler.js";

export interface InMemoryHarnessOptions {
  /** P1-03: default FakeRuntimeAdapter script (FAKE_RUNTIME_SCRIPT_COMPLETED_V1). */
  runtimeScript?: FakeRuntimeScriptV1;
  /** P1-03: explicit RunPort override (instrumented/probe ports for tests). */
  runtime?: RunPort;
  /** P1-03: explicit TaskContextPort override (default ContextCompilerImpl). */
  contextCompiler?: TaskContextPort;
  /** P1-03: explicit ArtifactPort override (default ArtifactVault). */
  vault?: ArtifactPort;
  /** P1-04: explicit CheckPort registry for the default VerificationEngine. */
  checkPorts?: CheckPort[];
  /** P1-04: explicit reviewer capability port (default FakeReviewerPort). */
  reviewer?: ReviewerPort;
  /** P1-04: explicit VerificationEngine (default: deterministic providers). */
  verification?: VerificationPort;
  /** P1-04: explicit ReviewContextPort (default ReviewContextCompilerImpl). */
  reviewContext?: ReviewContextPort;
  deps?: Partial<InjectableDeps>;
}

export interface InMemoryHarness {
  ledger: StateLedger;
  control: ControlEngine;
  readModel: ReadModelIndex;
  collaboration: HumanCollaboration;
  /** P1-03: real modules (default wiring; overridable per options). */
  vault: ArtifactPort;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
  dispatchEngine: DispatchPort;
  /** P1-04: default VerificationEngine (deterministic check providers). */
  verification: VerificationPort;
  /** P1-04: default ReviewContextPort (bounded ReviewPacket assembly). */
  reviewContext: ReviewContextPort;
  bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
  /** P1-02: governance install (immutable revision; never auto-activates). */
  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt>;
  /** P1-02: governance activation (CAS; per-kind active refs). */
  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt>;
  /** P1-02: accept a hand-authored PlanRevision (fixed pins). */
  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt>;
  /** P1-02: Plan Graph / Task Detail views (freshness by opaque cursor). */
  planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult>;
  taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult>;
  /** P1-03: readiness / claim / start / run-fact control entries. */
  dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult>;
  claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt>;
  startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt>;
  runFact(command: RunFactCommand): Promise<RunFactReceipt>;
  /** P1-04: admit evidence + binding anchor (atomic; full idempotency). */
  submitEvidence(command: SubmitEvidenceCommand): Promise<SubmitEvidenceReceipt>;
  /** P1-04: deterministic Task/Gate reduction (never Goal phase). */
  reduceTask(command: ReduceTaskCommand): Promise<ReduceTaskReceipt>;
  /** P1-03: ActiveAgent view (freshness by opaque cursor). */
  activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult>;
  /** P1-04: task-detail verification view (freshness by opaque cursor). */
  taskVerification(query: TaskVerificationViewQuery): Promise<TaskVerificationViewResult>;
  /** P1-04: review-context assembly (bounded ReviewPacket). */
  assembleReview(request: ReviewContextRequestV1): Promise<ReviewContextResultV1>;
  /** P1-03: outbox drive (claim -> assemble -> start -> events). */
  drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult>;
  /** pull new events from the ledger and push them into the ReadModelIndex */
  advanceProjection(): Promise<ProjectionReceipt>;
  /** last cursor pushed into the ReadModelIndex (null until first advance) */
  observedCursor(): CommitCursor | null;
}

export function createInMemoryHarness(options: InMemoryHarnessOptions = {}): InMemoryHarness {
  const d: InjectableDeps = { ...createDeterministicDeps(), ...(options.deps ?? {}) };
  const ledger: StateLedger = new InMemoryLedger();
  const control = new ControlEngineImpl({
    ledger,
    now: d.clock,
    eventId: d.eventId,
  });
  const readModel = new ReadModelIndexImpl();
  const collaboration = new HumanCollaborationImpl({
    control,
    readModel,
    commandId: d.commandId,
    correlationId: d.correlationId,
    now: d.clock,
  });
  const vault: ArtifactPort = options.vault ?? new ArtifactVault();
  const contextCompiler: TaskContextPort =
    options.contextCompiler ?? new ContextCompilerImpl({ ledger, vault, now: d.clock });
  const runtime: RunPort =
    options.runtime ?? new FakeRuntimeAdapter(options.runtimeScript ?? FAKE_RUNTIME_SCRIPT_COMPLETED_V1);
  const dispatchEngine: DispatchPort = new DispatchEngineImpl({
    ledger,
    control,
    contextCompiler,
    runtime,
  });
  const verification: VerificationPort =
    options.verification ??
    new VerificationEngineImpl(
      { ledger, now: d.clock },
      options.checkPorts ?? DETERMINISTIC_CHECK_PROVIDERS,
      options.reviewer ?? FAKE_REVIEWER_PORT,
    );
  const reviewContext: ReviewContextPort =
    options.reviewContext ?? new ReviewContextCompilerImpl({ ledger, vault, now: d.clock });
  let lastCursor: CommitCursor | null = null;
  async function advanceProjection(): Promise<ProjectionReceipt> {
    let receipt: ProjectionReceipt | null = null;
    for (;;) {
      const page = await ledger.events({ afterCursor: lastCursor, limit: 64 });
      receipt = await readModel.advance(page);
      lastCursor = page.throughCursor;
      if (!page.hasMore) break;
    }
    return receipt!;
  }
  return {
    ledger,
    control,
    readModel,
    collaboration,
    vault,
    contextCompiler,
    runtime,
    dispatchEngine,
    verification,
    reviewContext,
    bootstrap: (command) => control.bootstrap(command),
    install: (command) => control.install(command),
    activate: (command) => control.activate(command),
    applyPlan: (command) => control.applyPlan(command),
    planGraph: (query) => readModel.planGraph(query),
    taskDetail: (query) => readModel.taskDetail(query),
    dispatchReadiness: (query) => control.dispatchReadiness(query),
    claimTask: (command) => control.claimTask(command),
    startRun: (command) => control.startRun(command),
    runFact: (command) => control.runFact(command),
    submitEvidence: (command) => control.submitEvidence(command),
    reduceTask: (command) => control.reduceTask(command),
    activeAgent: (query) => readModel.activeAgent(query),
    taskVerification: (query) => readModel.taskVerification(query),
    assembleReview: (request) => reviewContext.assemble(request),
    drive: (trigger) => dispatchEngine.drive(trigger),
    advanceProjection,
    observedCursor: () => lastCursor,
  };
}