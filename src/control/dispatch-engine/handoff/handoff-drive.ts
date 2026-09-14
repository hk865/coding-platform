import { deferDispatch } from '../execution/dispatch-retry.js';
import { dispatchBacklog } from '../../../contracts/dispatch-backlog.js';
import { ExecutionSlots } from '../execution/execution-slots.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import { ensureWorkIdentity } from '../work-identity.js';
/** Consumes only co-committed ReplacementAttempt intents. Handoff Context
 * remains distinct; execution fences and runtime facts share the common policy. */
import { randomUUID } from 'node:crypto';
import { authorizeRuntimeEntry } from '../execution/runtime-entry.js';
import { consumeDispatchedRun } from '../dispatch-engine.js';
import { createModelCallAccess } from '../execution/model-call-access.js';
import type { StateLedger } from "../../../contracts/ledger.js";
import type { ControlEngine } from "../../../contracts/modules.js";
import type { RunPort } from "../../../contracts/ports.js";
import type { HandoffContextPort, HandoffContextRequestV1 } from "../../../contracts/handoff-context.js";
import {
  replacementAttemptRefFor,
} from "../../../contracts/handoff.js";
import type {
  HandoffDriveFailure,
  HandoffDriveResult,
  HandoffDriveTrigger,
  HandoffPort,
  ReplacementAttemptSnapshot,
} from "../../../contracts/handoff.js";
import type { DispatchIntentV1 } from "../../../contracts/dispatch.js";
import type { ContextManifestV1 } from "../../../contracts/task-envelope.js";

export type HandoffDriveDeps = {
  executionSlots?: ExecutionSlots;
  ledger: StateLedger;
  control: ControlEngine;
  handoffContext: HandoffContextPort;
  runtime: RunPort;
  prepare?: (intent: DispatchIntentV1, replacement: ReplacementAttemptSnapshot) => Promise<void>;
  /** Optional injectable clock (deterministic tests); defaults to wall time. */
  now?: () => string;
};

export class HandoffDriveEngineImpl implements HandoffPort {
  private readonly consumerId = 'handoff-' + randomUUID();
  private readonly inFlight = new Set<string>();
  private readonly slots: ExecutionSlots;
  constructor(private readonly deps: HandoffDriveDeps) { this.slots = deps.executionSlots ?? new ExecutionSlots(); }

  async driveHandoff(trigger: HandoffDriveTrigger): Promise<HandoffDriveResult> {
    const maxIntents = trigger.maxIntents ?? 8;
    const pending = await this.deps.ledger.pendingDispatchIntents(maxIntents, { workKind: 'replacement', dueAt: this.now() });

    let scanned = 0;
    let started = 0;
    let completed = 0;
    const failures: HandoffDriveFailure[] = [];

    await Promise.all(pending.map(async entry => {
      const key = canonicalJson(entry.ref);
      if (this.inFlight.has(key)) return;
      this.inFlight.add(key);
      try { await this.slots.run(entry.intent, async () => {
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
        return;
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
        return;
      }
      if (assembled.status === "rejected") {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "context_rejected",
          message: "context rejected: " + assembled.issues.join("; "),
        });
        return;
      }
      if (assembled.status === "needs_material") {
        failures.push({
          intentId: intent.intentId,
          outboxRef,
          code: "rejected",
          message: "needs_material: " + assembled.gaps.map((g) => g.message).join("; "),
        });
        return;
      }

      const { envelope, manifest } = assembled;
      const identity = await ensureWorkIdentity({ ledger: this.deps.ledger, control: this.deps.control, now: () => intent.requestedAt }, intent);
      if (identity.status === 'rejected') {
        failures.push({ intentId: intent.intentId, outboxRef, code: 'rejected', message: identity.message }); return;
      }
      try { await this.deps.prepare?.(intent, replacement); }
      catch (error) { failures.push({ intentId: intent.intentId, outboxRef, code: 'context_rejected', message: String(error) }); return; }


      const start = await authorizeRuntimeEntry({ ledger: this.deps.ledger, control: this.deps.control, now: () => this.now() }, {
        intent, envelope, manifest: toContextManifest(manifest), consumerId: this.consumerId,
        identity: revision => ({ actor: { kind: 'human', id: 'user-1' }, commandId: 'start-' + intent.intentId,
          correlationId: intent.correlationId, submittedAt: intent.requestedAt,
          idempotencyKey: 'p1-06-start-' + intent.intentId + (revision === 1 ? '' : '-r' + revision) }),
      });
      if (start.status === 'rejected') {
        failures.push({ intentId: intent.intentId, outboxRef, code: start.code === 'not_found' ? 'not_found' : 'rejected', message: 'Runtime entry rejected: ' + start.code });
        return;
      }
      if (start.status === 'replayed') return;
      started += 1;

      // Guard 5: ONLY NOW invoke the runtime, then poll/consume run facts.
      try {
        const handle = await this.deps.runtime.start(envelope, { modelCalls: createModelCallAccess({ ledger: this.deps.ledger, control: this.deps.control, envelope, now: () => this.now() }) });
        completed += await consumeDispatchedRun(this.deps.control, handle, intent, undefined, this.deps.ledger);
      } catch (err) {
        failures.push({ intentId: intent.intentId, outboxRef, code: "runtime_error", message: String(err) });
      }
      }); } finally { this.inFlight.delete(key); }
    }));

    for (const failure of failures) {
      if (failure.code === 'runtime_error') continue;
      const entry = pending.find(row => canonicalJson(row.ref) === canonicalJson(failure.outboxRef));
      if (!entry) continue;
      const rejection = await deferDispatch(this.deps, entry, failure.message);
      if (rejection) failure.message += '; durable retry was not recorded: ' + rejection;
    }
    const remaining = await this.deps.ledger.pendingDispatchIntents(Number.MAX_SAFE_INTEGER, { workKind: 'replacement', includeQuarantined: true });
    return { scanned, started, completed, pendingRemaining: remaining.length, failures,
      ...(remaining.length ? { backlog: dispatchBacklog(remaining, this.now()) } : {}) };
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
