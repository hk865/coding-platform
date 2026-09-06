/**
 * P1-07 Control entry: WorkspaceDrivePort implementation (parallel drive).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane B fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" item 7/三路并行 B: ALL eligible intents of the (projectId, goalId)
 * slice are assembled + started CONCURRENTLY (real run overlap — no implicit
 * ordering inside a Stage), then runtime handles are consumed in parallel;
 * replacement intents are skipped (P1-06 HandoffPort); outbox-before-side-effect
 * unchanged.
 */
import type { DispatchDriveFailure, DispatchDriveResult, RunHandle, RunPort } from "../contracts/ports.js";
import type { WorkspaceDrivePort, WorkspaceDriveTriggerV1 } from "../contracts/workspace-drive.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine } from "../contracts/modules.js";
import type { TaskContextPort, TaskContextRequestV1 } from "../contracts/task-envelope.js";
import type { DispatchIntentV1, DispatchOutboxRef } from "../contracts/dispatch.js";
import { buildDispatchStartCommand, buildRunFactCommand } from "../contracts/fixtures/dispatch-fixtures.js";
import { replacementAttemptRefFor } from "../contracts/handoff.js";

export type WorkspaceDriveDeps = {
  ledger: StateLedger;
  control: ControlEngine;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
  now: () => string;
};

type StartedEntry = { handle: RunHandle; intent: DispatchIntentV1; outboxRef: DispatchOutboxRef };

export class WorkspaceDriveEngineImpl implements WorkspaceDrivePort {
  constructor(private readonly deps: WorkspaceDriveDeps) {}

  async driveParallel(trigger: WorkspaceDriveTriggerV1): Promise<DispatchDriveResult> {
    const maxIntents = trigger.maxIntents ?? 8;
    const pending = await this.deps.ledger.pendingDispatchIntents(maxIntents);

    // Restrict to the ONE (projectId, goalId) slice this drive owns.
    const slice = pending.filter(
      (e) => e.intent.projectId === trigger.projectId && e.intent.goalId === trigger.goalId,
    );

    let scanned = 0;
    let started = 0;
    let completed = 0;
    const failures: DispatchDriveFailure[] = [];

    // P1-06 skip: an intent with a co-committed ReplacementAttempt belongs to the
    // HandoffPort (driveHandoff) — never assembled by the parallel drive (skipped
    // BEFORE scanning; not a failure, not counted).
    const eligible: { intent: DispatchIntentV1; outboxRef: DispatchOutboxRef }[] = [];
    for (const entry of slice) {
      const intent = entry.intent;
      const replacementResult = await this.deps.ledger.load(
        replacementAttemptRefFor(intent.projectId, intent.goalId, intent.taskId, intent.attemptRef.attemptId),
      );
      if (replacementResult.status === "found") continue;
      eligible.push({ intent, outboxRef: entry.ref });
    }

    // Phase 1 (CONCURRENT): assemble -> startRun -> runtime.start for ALL
    // eligible intents in the slice (real overlap — no implicit ordering).
    const startedEntries = await Promise.all(
      eligible.map(async ({ intent, outboxRef }): Promise<StartedEntry | null> => {
        scanned += 1;

        // assemble (bounded envelope + vault bundle).
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
          return null;
        }
        if (assembled.status === "rejected") {
          failures.push({
            intentId: intent.intentId,
            outboxRef,
            code: "context_rejected",
            message: "context rejected: " + assembled.issues.join("; "),
          });
          return null;
        }
        if (assembled.status === "needs_material") {
          failures.push({
            intentId: intent.intentId,
            outboxRef,
            code: "rejected",
            message: "needs_material: " + assembled.gaps.map((g) => g.message).join("; "),
          });
          return null;
        }

        const { envelope, manifest } = assembled;

        // startRun (dispatch-start commit) BEFORE runtime.start.
        const startCommand = buildDispatchStartCommand({
          commandId: "start-" + intent.intentId,
          correlationId: intent.correlationId,
          submittedAt: intent.requestedAt,
          projectId: intent.projectId,
          idempotencyKey: intent.intentId,
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
          return null;
        }
        started += 1;

        // ONLY NOW invoke the runtime (outbox-before-side-effect).
        try {
          const handle = await this.deps.runtime.start(envelope);
          return { handle, intent, outboxRef };
        } catch (err) {
          failures.push({
            intentId: intent.intentId,
            outboxRef,
            code: "runtime_error",
            message: String(err),
          });
          return null;
        }
      }),
    );

    // Phase 2 (CONCURRENT): consume each started run in parallel.
    const startedHandles = startedEntries.filter((e): e is StartedEntry => e !== null);
    await Promise.all(
      startedHandles.map(async ({ handle, intent, outboxRef }) => {
        try {
          const n = await this.consumeRun(handle, intent);
          completed += n;
        } catch (err) {
          failures.push({
            intentId: intent.intentId,
            outboxRef,
            code: "runtime_error",
            message: String(err),
          });
        }
      }),
    );

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
          // conflict): stop consuming; the outbox/run stay as committed.
          return completed;
        }
      }
      if (terminal) break;
    }
    return completed;
  }
}
