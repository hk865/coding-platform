/** event protocol schema validation. Structural checks do not grant authority. */
import { normalizeObjective } from '../command-event.js';
import { isKnownEventType } from '../events.js';
import { REPLACEMENT_REASONS } from '../handoff.js';
import type { ValidationIssue } from './common.js';
import { isRecord, stringField, validateEnum } from './common.js';
import { validateActor } from './identity.js';

export function validateDomainEvent(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "event must be an object" });
    return issues;
  }
  const eventType = value["eventType"];
  if (typeof eventType !== "string" || !isKnownEventType(eventType)) {
    issues.push({ path: "eventType", code: "unknown_event_type", message: "unknown eventType" });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({
      path: "schemaVersion",
      code: "unknown_schema_version",
      message: "only schemaVersion 1 is supported",
    });
  }
  stringField(value, "eventId", issues);
  stringField(value, "aggregateType", issues);
  stringField(value, "aggregateId", issues);
  const isActivationEvent =
    eventType === "CompletionPolicyActivated" ||
    eventType === "ArchitectureBaselineActivated" ||
    eventType === "RunEventRecorded" ||
    eventType === "RunOutcomeUnknown" ||
    eventType === "TaskReductionUpdated" ||
    eventType === "GoalPhaseUpdated" ||
    eventType === "WorkspaceReadLeaseReleased" ||
    eventType === "WorkspaceWriteLeaseReleased" ||
    eventType === "IntegrationJoined";
  // Creation events are always revision 1; activation aggregates advance (>= 1).
  if (!isActivationEvent && value["aggregateRevision"] !== 1) {
    issues.push({
      path: "aggregateRevision",
      code: "bad_type",
      message: "aggregateRevision must be 1 for v1 creation events",
    });
  }
  if (isActivationEvent && (!Number.isSafeInteger(value["aggregateRevision"]) || (value["aggregateRevision"] as number) < 1)) {
    issues.push({
      path: "aggregateRevision",
      code: "bad_type",
      message: "aggregateRevision must be a positive integer",
    });
  }
  stringField(value, "causationId", issues);
  stringField(value, "correlationId", issues);
  stringField(value, "idempotencyKey", issues);
  validateActor(value["actor"], "actor", issues);
  stringField(value, "occurredAt", issues);
  if (eventType === "GoalCreated") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (isRecord(payload)) {
      const objective = stringField(payload, "objective", issues);
      if (objective !== null && normalizeObjective(objective).length === 0) {
        issues.push({
          path: "payload.objective",
          code: "empty_objective",
          message: "objective must be non-empty after normalization",
        });
      }
    } else {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    }
  } else if (eventType === "WorkspaceBootstrapped" || eventType === "ProjectBootstrapped") {
    stringField(value, "projectId", issues);
    if (eventType === "WorkspaceBootstrapped") stringField(value, "workspaceId", issues);
  } else if (
    eventType === "CompletionPolicyInstalled" ||
    eventType === "ArchitectureBaselineInstalled" ||
    eventType === "CompletionPolicyActivated" ||
    eventType === "ArchitectureBaselineActivated" ||
    eventType === "PlanRevisionAccepted"
  ) {
    stringField(value, "projectId", issues);
    if (eventType === "PlanRevisionAccepted") stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    if (eventType === "PlanRevisionAccepted") {
      stringField(payload, "goalId", issues, "payload.goalId");
      if (!Number.isSafeInteger(payload["goalAggregateRevision"]) || (payload["goalAggregateRevision"] as number) < 1) {
        issues.push({
          path: "payload.goalAggregateRevision",
          code: "bad_type",
          message: "goalAggregateRevision must be a positive integer",
        });
      }
      if (!isRecord(payload["planRevision"])) {
        issues.push({ path: "payload.planRevision", code: "bad_type", message: "planRevision must be an object" });
      }
    }
  } else if (eventType === "EvidenceAdmitted" || eventType === "TaskReductionUpdated" || eventType === "GoalPhaseUpdated") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    stringField(payload, "goalId", issues, "payload.goalId");
    if (eventType === "EvidenceAdmitted") {
      stringField(payload, "taskId", issues, "payload.taskId");
      if (!isRecord(payload["evidence"])) {
        issues.push({ path: "payload.evidence", code: "bad_type", message: "evidence must be an object" });
      }
    } else if (eventType === "TaskReductionUpdated") {
      stringField(payload, "taskId", issues, "payload.taskId");
      if (!isRecord(payload["reduction"])) {
        issues.push({ path: "payload.reduction", code: "bad_type", message: "reduction must be an object" });
      }
    } else {
      if (!isRecord(payload["explanation"])) {
        issues.push({ path: "payload.explanation", code: "bad_type", message: "explanation must be an object" });
      }
      if (!isRecord(payload["sideEffectReconciliation"])) {
        issues.push({ path: "payload.sideEffectReconciliation", code: "bad_type", message: "sideEffectReconciliation must be an object" });
      }
    }
  } else if (eventType === "HandoffRecorded") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    stringField(payload, "goalId", issues, "payload.goalId");
    stringField(payload, "taskId", issues, "payload.taskId");
    if (!isRecord(payload["packet"])) {
      issues.push({ path: "payload.packet", code: "bad_type", message: "packet must be an object" });
    }
    stringField(payload, "recordedAt", issues, "payload.recordedAt");
  } else if (eventType === "ReplacementClaimed") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    stringField(payload, "goalId", issues, "payload.goalId");
    stringField(payload, "taskId", issues, "payload.taskId");
    if (!isRecord(payload["packetRef"])) {
      issues.push({ path: "payload.packetRef", code: "bad_type", message: "packetRef must be an object" });
    }
    if (!isRecord(payload["replacementRef"])) {
      issues.push({ path: "payload.replacementRef", code: "bad_type", message: "replacementRef must be an object" });
    }
    if (!isRecord(payload["priorAttemptRef"])) {
      issues.push({ path: "payload.priorAttemptRef", code: "bad_type", message: "priorAttemptRef must be an object" });
    }
    if (!isRecord(payload["priorRunRef"])) {
      issues.push({ path: "payload.priorRunRef", code: "bad_type", message: "priorRunRef must be an object" });
    }
    if (!isRecord(payload["attemptRef"])) {
      issues.push({ path: "payload.attemptRef", code: "bad_type", message: "attemptRef must be an object" });
    }
    if (!isRecord(payload["runRef"])) {
      issues.push({ path: "payload.runRef", code: "bad_type", message: "runRef must be an object" });
    }
    if (!isRecord(payload["outboxRef"])) {
      issues.push({ path: "payload.outboxRef", code: "bad_type", message: "outboxRef must be an object" });
    }
    validateEnum(payload["reason"], REPLACEMENT_REASONS, "payload.reason", issues);
    stringField(payload, "claimedAt", issues, "payload.claimedAt");
  } else if (
    eventType === "WorkspaceReadLeaseGranted" ||
    eventType === "WorkspaceReadLeaseReleased" ||
    eventType === "WorkspaceWriteLeaseGranted" ||
    eventType === "WorkspaceWriteLeaseReleased" ||
    eventType === "IntegrationJoined" ||
    eventType === "PatchRecorded"
  ) {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    if (eventType === "WorkspaceReadLeaseGranted" || eventType === "WorkspaceWriteLeaseGranted") {
      stringField(payload, "leaseId", issues, "payload.leaseId");
      if (!isRecord(payload["scope"])) {
        issues.push({ path: "payload.scope", code: "bad_type", message: "scope must be an object" });
      }
      if (!isRecord(payload["holder"])) {
        issues.push({ path: "payload.holder", code: "bad_type", message: "holder must be an object" });
      }
      if (payload["expiresAt"] !== null && typeof payload["expiresAt"] !== "string") {
        issues.push({ path: "payload.expiresAt", code: "bad_type", message: "expiresAt must be a string or null" });
      }
    } else if (eventType === "WorkspaceReadLeaseReleased" || eventType === "WorkspaceWriteLeaseReleased") {
      stringField(payload, "leaseId", issues, "payload.leaseId");
      stringField(payload, "releasedAt", issues, "payload.releasedAt");
      if (payload["releasedBy"] !== null && payload["releasedBy"] !== "holder") {
        issues.push({ path: "payload.releasedBy", code: "bad_type", message: "releasedBy must be holder or null" });
      }
      if (eventType === "WorkspaceWriteLeaseReleased") {
        validateEnum(payload["releasedVia"], ["explicit", "patch-record", "expiry-vacate"], "payload.releasedVia", issues);
        if (payload["postWriteWorkspaceRevision"] !== null && !Number.isSafeInteger(payload["postWriteWorkspaceRevision"])) {
          issues.push({ path: "payload.postWriteWorkspaceRevision", code: "bad_type", message: "postWriteWorkspaceRevision must be an integer or null" });
        }
      }
    } else if (eventType === "IntegrationJoined") {
      stringField(payload, "goalId", issues, "payload.goalId");
      stringField(payload, "taskId", issues, "payload.taskId");
      stringField(payload, "resultId", issues, "payload.resultId");
      if (!isRecord(payload["runRef"])) {
        issues.push({ path: "payload.runRef", code: "bad_type", message: "runRef must be an object" });
      }
      if (!Array.isArray(payload["conflicts"])) {
        issues.push({ path: "payload.conflicts", code: "bad_type", message: "conflicts must be an array" });
      }
      if (payload["explanation"] !== null && typeof payload["explanation"] !== "string") {
        issues.push({ path: "payload.explanation", code: "bad_type", message: "explanation must be a string or null" });
      }
      if (typeof payload["escalate"] !== "boolean") {
        issues.push({ path: "payload.escalate", code: "bad_type", message: "escalate must be a boolean" });
      }
    } else if (eventType === "PatchRecorded") {
      stringField(payload, "patchId", issues, "payload.patchId");
      stringField(payload, "goalId", issues, "payload.goalId");
      stringField(payload, "taskId", issues, "payload.taskId");
      stringField(payload, "title", issues, "payload.title");
      if (!Number.isSafeInteger(payload["beforeWorkspaceRevision"]) || !Number.isSafeInteger(payload["afterWorkspaceRevision"])) {
        issues.push({ path: "payload.workspaceRevisions", code: "bad_type", message: "workspace revisions must be integers" });
      }
      if (!Array.isArray(payload["changedPaths"])) {
        issues.push({ path: "payload.changedPaths", code: "bad_type", message: "changedPaths must be an array" });
      }
    }
  } else if (typeof eventType === "string" && isKnownEventType(eventType)) {
    // covered above by per-type field checks
    void 0;
  }
  return issues;
}
