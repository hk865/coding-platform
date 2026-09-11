/**
 * P1-06 DispatchEngine.HandoffPort implementation (src/control/handoff-drive.ts).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane A fills the
 * implementation). Frozen ordering (mirrors P1-03 drive + outbox-before-
 * side-effect):
 *   1. ledger.pendingDispatchIntents(maxIntents ?? 8, ordinary);
 *   2. for each pending intent: load the ReplacementAttempt for
 *      (projectId, goalId, taskId, attemptId); missing -> failure
 *      not_a_replacement (this intent belongs to the NORMAL drive; NOT scanned);
 *   3. HandoffContextPort.assemble(HandoffContextRequestV1) — bounded context
 *      derived from the registered packet (never a transcript);
 *   4. Control.startRun(B's envelope) — the intent -> started;
 *   5. ONLY THEN RunPort.start(envelope) + poll events via Control.runFact
 *      (expectedRevision tracked from each accepted fact's runRevision; any
 *      rejected fact stops that intent — no retry in P1-06, P1-10).
 * The NORMAL DispatchPort.drive SKIPS replacement intents (baseline guard).
 */
import type { StateLedger } from "../../contracts/ledger.js";
import type { ControlEngine } from "../../contracts/modules.js";
import type { RunHandle, RunPort } from "../../contracts/ports.js";
import type { HandoffContextPort, HandoffContextRequestV1 } from "../../contracts/handoff-context.js";
import {
  replacementAttemptRefFor,
} from "../../contracts/handoff.js";
import type {
  HandoffDriveFailure,
  HandoffDriveResult,
  HandoffDriveTrigger,
  HandoffPort,
  ReplacementAttemptSnapshot,
} from "../../contracts/handoff.js";
import type { DispatchIntentV1 } from "../../contracts/dispatch.js";
import type { ContextManifestV1 } from "../../contracts/task-envelope.js";
import { buildDispatchStartCommand, buildRunFactCommand } from "../../contracts/commands/dispatch.js";

export type HandoffDriveDeps = {
  ledger: StateLedger;
  control: ControlEngine;
  handoffContext: HandoffContextPort;
  runtime: RunPort;
  /** Optional injectable clock (deterministic tests); defaults to wall time. */
  now?: () => string;
};

export class HandoffDriveEngineImpl implements HandoffPort {
  constructor(private readonly deps: HandoffDriveDeps) {}

  async driveHandoff(trigger: HandoffDriveTrigger): Promise<HandoffDriveResult> {
    const maxIntents = trigger.maxIntents ?? 8;
    const pending = await this.deps.ledger.pendingDispatchIntents(maxIntents, { workKind: 'ordinary' });

    let scanned = 0;
    let started = 0;
    let completed = 0;
    const failures: HandoffDriveFailure[] = [];

    for (const entry of pending) {
      const intent = entry.intent;
      const outboxRef = entry.ref;

      // Guard 2: this intent belongs to the HandoffPort ONLY when a
      // ReplacementAttempt was co-committed for the (projectId, goalId, taskId,
      // attemptId) tuple. A missing replacement -> not_a_replacement failure
      // (NOT scanned); the NORMAL drive would have skipped it.
      const replacementRef = replacementAttemptRefFor(
        intent.projectId,
        intent.goalId,
        intent.taskId,
        intent.attemptRef.attemptId,
      );
      const replacementResult = await this.deps.ledger.load(replacementRef);
      if (
        replacementResult.status === "not_found" ||
        replacementResult.snapshot.ref.aggregateType !== "ReplacementAttempt"
      ) {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "not_a_replacement",
          message: "intent has no co-committed ReplacementAttempt (belongs to the normal drive)",
        });
        continue;
      }
      const replacement = replacementResult.snapshot as ReplacementAttemptSnapshot;

      // Counted as a processed replacement intent from here on.
      scanned += 1;

      // Guard 3: assemble B's bounded HandoffContext (from the registered
      // packet; never a transcript).
      const request = this.buildContextRequest(intent, replacement);
      let assembled;
      try {
        assembled = await this.deps.handoffContext.assemble(request);
      } catch (err) {
        failures.push({ intentId: intent.intentId, outboxRef, code: "context_rejected", message: String(err) });
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

      // Guard 4: record B's envelope via Control.startRun BEFORE any runtime
      // side-effect (outbox-before-side-effect).
      const startCommand = buildDispatchStartCommand({
        // Preserve the identity used for this persisted command protocol.
        actor: { kind: "human", id: "user-1" },
        commandId: "start-" + intent.intentId,
        correlationId: intent.correlationId,
        submittedAt: intent.requestedAt,
        projectId: intent.projectId,
        runId: intent.runRef.runId,
        expectedRevision: 1,
        envelope,
        manifest: toContextManifest(manifest),
        // A UNIQUE per-intent key: a replacement run's start must never contend
        // with a prior run's start (A's run-before-handoff) over the shared
        // default "p1-03-start" key (same project -> same identity namespace).
        idempotencyKey: "p1-06-start-" + intent.intentId,
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

      // Guard 5: ONLY NOW invoke the runtime, then poll/consume run facts.
      try {
        const handle = await this.deps.runtime.start(envelope);
        completed += await this.consumeRun(handle, intent);
      } catch (err) {
        failures.push({ intentId: intent.intentId, outboxRef, code: "runtime_error", message: String(err) });
      }
    }

    const remaining = await this.deps.ledger.pendingDispatchIntents(maxIntents, { workKind: 'ordinary' });
    return { scanned, started, completed, pendingRemaining: remaining.length, failures };
  }

  private buildContextRequest(
    intent: DispatchIntentV1,
    replacement: ReplacementAttemptSnapshot,
  ): HandoffContextRequestV1 {
    return {
      schemaVersion: 1,
      requestId: "handoff-" + intent.intentId,
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      goalId: intent.goalId,
      taskId: intent.taskId,
      planRef: intent.planRef,
      runRef: intent.runRef,
      attemptRef: intent.attemptRef,
      roleBinding: intent.roleBinding,
      declaredPermissions: intent.declaredPermissions,
      scope: {
        tools: [...intent.declaredPermissions.tools],
        writeScope: [...intent.declaredPermissions.writeScope],
      },
      workspaceSnapshot: {
        workspaceId: intent.workspaceSnapshot.workspaceId,
        revision: intent.workspaceSnapshot.revision,
      },
      handoffPacketRef: replacement.packetRef,
      budget: intent.budget,
      submittedAt: this.now(),
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
          actor: { kind: "human", id: "user-1" },
          idempotencyKey: "p1-03-runfact",
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
          // retry in P1-06 (retry/cancel is P1-10).
          return completed;
        }
      }
      if (terminal) break;
    }
    return completed;
  }

  private now(): string {
    return this.deps.now !== undefined ? this.deps.now() : new Date().toISOString();
  }
}

function toContextManifest(manifest: {
  schemaVersion: 1;
  selectedRefs: ContextManifestV1["selectedRefs"];
  gaps: ContextManifestV1["gaps"];
  freshness: ContextManifestV1["freshness"];
}): ContextManifestV1 {
  return {
    schemaVersion: 1,
    selectedRefs: manifest.selectedRefs,
    gaps: manifest.gaps,
    freshness: manifest.freshness,
  };
}

export function createHandoffDriveEngine(deps: HandoffDriveDeps): HandoffPort {
  return new HandoffDriveEngineImpl(deps);
}
