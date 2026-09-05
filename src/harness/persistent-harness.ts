/**
 * P1-01 persistent (file-backed SQLite) harness — restart semantics twin of the
 * P1-00 InMemory harness. Wires the REAL modules (ControlEngineImpl,
 * HumanCollaborationImpl) to the REAL SQLite adapters (SqliteStateLedger,
 * SqliteReadModelIndex) so the full path is executable against a file:
 *
 *   bootstrap -> CreateGoal -> Sqlite ledger.commit -> close() ->
 *   reopen() -> (a) ledger.load(GoalSnapshot) canonical load,
 *              (b) drain persisted EventPage(s) into a fresh read model
 *                  rebuild -> same GoalView
 *
 * Restart semantics (fixed in IMPLEMENTATION-HANDOFF.md — "P1-01 契约与存储语义"):
 *   - durable state lives ONLY in the SQLite file(s); "restart" = close() +
 *     a NEW instance on the SAME file path. No in-process state carries over.
 *   - single-file strategy: one database file for the ledger
 *     (ledger.sqlite), one separate database file for the read model
 *     (readmodel.sqlite), both under one temporary directory (default
 *     mkdtemp in os.tmpdir()) that the caller owns and may clean up.
 *   - closed instances reject further use; close() is idempotent.
 *   - the read model is ALWAYS an event projection: rebuild from a fresh file
 *     (reopen({ readModelFile: ... })) must reproduce the same GoalView.
 *     The canonical Goal state never comes from the read model.
 *
 * The InMemory path (src/harness/in-memory-harness.ts) is untouched.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../contracts/bootstrap.js";
import type { CommitCursor } from "../contracts/command-event.js";
import type { ProjectionReceipt } from "../contracts/goal-view.js";
import type { ControlEngine, HumanCollaboration } from "../contracts/modules.js";
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
import { SqliteStateLedger, createSqliteStateLedger } from "../sqlite-ledger/sqlite-ledger.js";
import {
  SqliteReadModelIndex,
  createSqliteReadModelIndex,
} from "../sqlite-read-model/sqlite-read-model-index.js";
import { ControlEngineImpl } from "../control/control-engine.js";
import { HumanCollaborationImpl } from "../interaction/human-collaboration.js";
import { createDeterministicDeps, type InjectableDeps } from "../contracts/testing/sequences.js";

export interface PersistentSqliteHarnessOptions {
  /** Directory for the SQLite files. Default: fresh mkdtemp in os.tmpdir(). */
  dir?: string;
  /** Ledger database file name (default "ledger.sqlite"). */
  ledgerFile?: string;
  /** Read model database file name (default "readmodel.sqlite"). */
  readModelFile?: string;
  /** Deterministic-sequence overrides (default createDeterministicDeps()). */
  deps?: Partial<InjectableDeps>;
}

export interface PersistentSqliteHarness {
  readonly dir: string;
  readonly ledgerPath: string;
  readonly readModelPath: string;

  ledger: SqliteStateLedger;
  readModel: SqliteReadModelIndex;
  control: ControlEngine;
  collaboration: HumanCollaboration;

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
  /** Pull new events from the ledger and push them into the read model. */
  advanceProjection(): Promise<ProjectionReceipt>;
  /** Last cursor pushed into the read model (null until first advance). */
  observedCursor(): CommitCursor | null;

  /**
   * Emulates a process restart: closes both connections. The harness is dead
   * afterwards; use reopen() for the restarted process. Idempotent.
   */
  close(): Promise<void>;

  /**
   * Restart: NEW instances on the SAME ledger file. readModelFile may differ
   * (default: same file) — pass a fresh file name for the rebuild-from-events
   * evidence path. Deterministic deps restart from their sequence beginning.
   */
  reopen(options?: { readModelFile?: string }): Promise<PersistentSqliteHarness>;

  /** Close both connections and remove the harness directory (best effort). */
  cleanup(): Promise<void>;
}

interface BuiltHarness {
  ledger: SqliteStateLedger;
  readModel: SqliteReadModelIndex;
  control: ControlEngine;
  collaboration: HumanCollaboration;
  advanceProjection: () => Promise<ProjectionReceipt>;
  observedCursor: () => CommitCursor | null;
  planGraph: (query: PlanGraphViewQuery) => Promise<PlanGraphViewResult>;
  taskDetail: (query: TaskDetailViewQuery) => Promise<TaskDetailViewResult>;
}

function buildHarness(
  dir: string,
  ledgerFile: string,
  readModelFile: string,
  deps: Partial<InjectableDeps>,
): BuiltHarness {
  const d: InjectableDeps = { ...createDeterministicDeps(), ...deps };
  const ledger = createSqliteStateLedger({ path: join(dir, ledgerFile) });
  const readModel = createSqliteReadModelIndex({ path: join(dir, readModelFile) });
  const control = new ControlEngineImpl({ ledger, now: d.clock, eventId: d.eventId });
  const collaboration = new HumanCollaborationImpl({
    control,
    readModel,
    commandId: d.commandId,
    correlationId: d.correlationId,
    now: d.clock,
  });
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
    readModel,
    control,
    collaboration,
    advanceProjection,
    observedCursor: () => lastCursor,
    planGraph: (query) => readModel.planGraph(query),
    taskDetail: (query) => readModel.taskDetail(query),
  };
}

export async function createPersistentSqliteHarness(
  options: PersistentSqliteHarnessOptions = {},
): Promise<PersistentSqliteHarness> {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "agent-platform-p1-01-")));
  const ledgerFile = options.ledgerFile ?? "ledger.sqlite";
  const readModelFile = options.readModelFile ?? "readmodel.sqlite";
  const deps = options.deps ?? {};

  const make = (
    ledgerFilename: string,
    readModelFilename: string,
  ): PersistentSqliteHarness => {
    const built = buildHarness(dir, ledgerFilename, readModelFilename, deps);
    let closed = false;
    return {
      dir,
      ledgerPath: join(dir, ledgerFilename),
      readModelPath: join(dir, readModelFilename),
      ledger: built.ledger,
      readModel: built.readModel,
      control: built.control,
      collaboration: built.collaboration,
      bootstrap: (command) => built.control.bootstrap(command),
      install: (command) => built.control.install(command),
      activate: (command) => built.control.activate(command),
      applyPlan: (command) => built.control.applyPlan(command),
      planGraph: (query) => built.planGraph(query),
      taskDetail: (query) => built.taskDetail(query),
      advanceProjection: built.advanceProjection,
      observedCursor: built.observedCursor,
      close: async () => {
        if (closed) return;
        closed = true;
        await Promise.allSettled([built.ledger.close(), built.readModel.close()]);
      },
      reopen: async (reopenOptions) => {
        if (!closed) {
          throw new Error(
            "PersistentSqliteHarness: close() before reopen(); reopen() means process restart",
          );
        }
        const nextReadModelFile = reopenOptions?.readModelFile ?? readModelFilename;
        return make(ledgerFilename, nextReadModelFile);
      },
      cleanup: async () => {
        await Promise.allSettled([built.ledger.close(), built.readModel.close()]);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  };

  return make(ledgerFile, readModelFile);
}
