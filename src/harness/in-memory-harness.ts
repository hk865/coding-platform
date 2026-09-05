/**
 * In-memory P1-00 harness: wires the REAL modules (lanes A/B/C) and the
 * shared contracts into one executable tracer-bullet integration path:
 *   bootstrap -> createGoal -> InMemoryLedger -> EventPage -> ReadModelIndex -> GoalView
 *
 * Lane entry points (fixed by the shared baseline):
 *   - A: src/ledger/in-memory-ledger.ts        (InMemoryLedger implements StateLedger)
 *   - B: src/control/control-engine.ts         (ControlEngineImpl)
 *   - C: src/read-model/read-model-index.ts    (ReadModelIndexImpl)
 *       src/interaction/human-collaboration.ts (HumanCollaborationImpl)
 */
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../contracts/bootstrap.js";
import type { CommitCursor } from "../contracts/command-event.js";
import type { ProjectionReceipt } from "../contracts/goal-view.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine, HumanCollaboration } from "../contracts/modules.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";
import { InMemoryLedger } from "../ledger/in-memory-ledger.js";
import { ControlEngineImpl } from "../control/control-engine.js";
import { ReadModelIndexImpl } from "../read-model/read-model-index.js";
import { HumanCollaborationImpl } from "../interaction/human-collaboration.js";
import { createDeterministicDeps, type InjectableDeps } from "../contracts/testing/sequences.js";

export interface InMemoryHarness {
  ledger: StateLedger;
  control: ControlEngine;
  readModel: ReadModelIndex;
  collaboration: HumanCollaboration;
  bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
  /** pull new events from the ledger and push them into the ReadModelIndex */
  advanceProjection(): Promise<ProjectionReceipt>;
  /** last cursor pushed into the ReadModelIndex (null until first advance) */
  observedCursor(): CommitCursor | null;
}

export function createInMemoryHarness(deps?: Partial<InjectableDeps>): InMemoryHarness {
  const d: InjectableDeps = { ...createDeterministicDeps(), ...deps };
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
    bootstrap: (command) => control.bootstrap(command),
    advanceProjection,
    observedCursor: () => lastCursor,
  };
}