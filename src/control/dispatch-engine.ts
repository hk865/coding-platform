/**
 * P1-03 DispatchEngine driver (DispatchPort).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Frozen ordering
 * (Acceptance 3 — outbox BEFORE side-effect):
 *   1. ledger.pendingDispatchIntents(maxIntents ?? 8) — the intent MUST be
 *      durably loadable before any runtime call;
 *   2. ContextCompiler.assemble(TaskContextRequestV1) — bounded envelope;
 *   3. Control.startRun(dispatch-start commit) — envelope recorded, outbox
 *      intent -> started;
 *   4. ONLY THEN RunPort.start(envelope) (outbox-before-side-effect);
 *   5. poll RunPort events and Control.runFact() each (expectedRevision tracked
 *      by receipt.runRevision) until a terminal fact or the poll drains.
 *
 * Drive NEVER creates a claim, NEVER retries, and NEVER mutates the public
 * contract. Context rejection / needs_material and runtime errors are reported
 * as DispatchDriveFailures and leave the outbox in its committed state (no new
 * Run attempt in P1-03). A startRun rejection likewise leaves the outbox
 * pending (zero-write reject).
 */
import type {
  DispatchDriveFailure,
  DispatchDriveResult,
  DispatchDriveTrigger,
  DispatchPort,
  RunHandle,
  RunPort,
} from "../contracts/ports.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine } from "../contracts/modules.js";
import type { TaskContextPort, TaskContextRequestV1 } from "../contracts/task-envelope.js";
import type { DispatchIntentV1 } from "../contracts/dispatch.js";
import { buildDispatchStartCommand, buildRunFactCommand } from "../contracts/fixtures/dispatch-fixtures.js";
import { replacementAttemptRefFor } from "../contracts/handoff.js";

export type DispatchEngineDeps = {
  ledger: StateLedger;
  control: ControlEngine;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
};

export class DispatchEngineImpl implements DispatchPort {
  constructor(private readonly deps: DispatchEngineDeps) {}

  async drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult> {
    const maxIntents = trigger.maxIntents ?? 8;
    const pending = await this.deps.ledger.pendingDispatchIntents(maxIntents);

    let scanned = 0;
    let started = 0;
    let completed = 0;
    const failures: DispatchDriveFailure[] = [];

    for (const entry of pending) {
      scanned += 1;
      const intent = entry.intent;
      const outboxRef = entry.ref;

      // P1-06 guard: an intent with a co-committed ReplacementAttempt belongs
      // to the HandoffPort (driveHandoff) — the normal drive NEVER assembles a
      // non-handoff context for a replacement run (skip, not a failure).
      const replacementResult = await this.deps.ledger.load(
        replacementAttemptRefFor(intent.projectId, intent.goalId, intent.taskId, intent.attemptRef.attemptId),
      );
      if (replacementResult.status === "found") {
        continue;
      }

      // 2. assemble (bounded envelope + vault bundle).
      let assembled;
      try {
        assembled = await this.deps.contextCompiler.assemble(this.buildContextRequest(intent));
      } catch (err) {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "context_rejected",
          message: String(err),
        });
        continue;
      }

      if (assembled.status === "rejected") {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "context_rejected",
          message: "context rejected: " + assembled.issues.join("; "),
        });
        continue;
      }
      if (assembled.status === "needs_material") {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "rejected",
          message: "needs_material: " + assembled.gaps.map((g) => g.message).join("; "),
        });
        continue;
      }

      const { envelope, manifest } = assembled;

      // 3. startRun (dispatch-start commit) BEFORE runtime.start.
      const startCommand = buildDispatchStartCommand({
        commandId: "start-" + intent.intentId,
        correlationId: intent.correlationId,
        submittedAt: intent.requestedAt,
        projectId: intent.projectId,
        runId: intent.runRef.runId,
        expectedRevision: 1,
        envelope,
        manifest,
      });
      const startReceipt = await this.deps.control.startRun(startCommand);
      if (startReceipt.status !== "committed") {
        const code = startReceipt.status === "rejected" && startReceipt.code === "not_found" ? "not_found" : "rejected";
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code,
          message: "startRun rejected: " + startReceipt.code,
        });
        continue;
      }
      started += 1;

      // 4. only NOW invoke the runtime (outbox-before-side-effect).
      try {
        const handle = await this.deps.runtime.start(envelope);
        const completion = await this.consumeRun(handle, intent);
        completed += completion;
      } catch (err) {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "runtime_error",
          message: String(err),
        });
      }
    }

    const remaining = await this.deps.ledger.pendingDispatchIntents(maxIntents);
    return { scanned, started, completed, pendingRemaining: remaining.length, failures };
  }

  private buildContextRequest(intent: DispatchIntentV1): TaskContextRequestV1 {
    return {
      schemaVersion: 1,
      requestId: "context-" + intent.intentId,
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      goalId: intent.goalId,
      taskId: intent.taskId,
      planRef: intent.planRef,
      runRef: intent.runRef,
      attemptRef: intent.attemptRef,
      roleBinding: intent.roleBinding,
      workspaceSnapshot: intent.workspaceSnapshot,
      declaredPermissions: intent.declaredPermissions,
      scope: {
        tools: [...intent.declaredPermissions.tools],
        writeScope: [...intent.declaredPermissions.writeScope],
      },
      budget: intent.budget,
      submittedAt: intent.requestedAt,
    };
  }

  private async consumeRun(handle: RunHandle, intent: DispatchIntentV1): Promise<number> {
    let completed = 0;
    // The Run is at revision 2 right after startRun; each accepted fact returns
    // its new run revision, which we track for the next single-writer CAS.
    let expectedRevision = 2;
    for (;;) {
      const events = await handle.pollFreshEvents();
      if (events.length === 0) break;
      let terminal = false;
      for (const event of events) {
        const command = buildRunFactCommand({
          commandId: "fact-" + intent.intentId + "-" + String(event.sequence),
          correlationId: intent.correlationId,
          submittedAt: event.occurredAt,
          projectId: intent.projectId,
          runId: intent.runRef.runId,
          expectedRevision,
          fact: { kind: "runtime_event", event },
        });
        const receipt = await this.deps.control.runFact(command);
        if (receipt.status === "committed") {
          expectedRevision = receipt.runRevision;
          if (receipt.terminal) {
            completed += 1;
            terminal = true;
            break;
          }
        } else {
          // Rejected fact (duplicate/stale/conflict/after_terminal/revision
          // conflict): stop consuming; the outbox/run stay as committed. No
          // retry in P1-03.
          return completed;
        }
      }
      if (terminal) break;
    }
    return completed;
  }
}

export function createDispatchEngine(deps: DispatchEngineDeps): DispatchEngineImpl {
  return new DispatchEngineImpl(deps);
}
