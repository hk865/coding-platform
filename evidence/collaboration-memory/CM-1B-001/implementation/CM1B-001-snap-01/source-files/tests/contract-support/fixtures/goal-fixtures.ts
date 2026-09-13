import { buildCreateGoalCommand as formalbuildCreateGoalCommand } from "../../../src/contracts/commands/goal.js";
/**
 * P1-00 shared fixtures: multi-scope CreateGoal.
 * Both scopes deliberately reuse the same local goalId AND the same
 * idempotency key — CommandIdentity carries projectId, so these are
 * independent command/aggregate identities per project.
 */
import type { ActorRef, CreateGoalCommand, GoalCreatedEvent } from "../../../src/contracts/command-event.js";
import { commandFingerprint, normalizeObjective } from "../../../src/contracts/command-event.js";
import type { GoalCreateLedgerCommitV1, GoalRef, GoalSnapshot, WorkspaceRef } from "../../../src/contracts/ledger.js";

export type GoalFixtureScope = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  objective: string;
  actor: ActorRef;
};

export type MultiScopeCreateGoalFixtureV1 = {
  schemaVersion: 1;
  sharedIdempotencyKey: string;
  scopes: GoalFixtureScope[];
};

export const MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1: MultiScopeCreateGoalFixtureV1 = {
  schemaVersion: 1,
  sharedIdempotencyKey: "create-goal-shared-key",
  scopes: [
    {
      projectId: "proj-alpha",
      workspaceId: "ws-shared",
      goalId: "goal-1",
      // leading/trailing whitespace (incl. NBSP) exercises NFC + trim normalization
      objective: " \u00a0为 proj-alpha 完成第一个可观察目标：contract pack 可运行 \u00a0",
      actor: { kind: "human", id: "user-1" },
    },
    {
      projectId: "proj-beta",
      workspaceId: "ws-shared",
      goalId: "goal-1",
      objective: "为 proj-beta 完成第一个可观察目标：contract pack 可运行",
      actor: { kind: "human", id: "user-1" },
    },
  ],
};

export type BuildCreateGoalDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  idempotencyKey?: string;
};

export function buildCreateGoalCommand(
  scope: GoalFixtureScope,
  deps: BuildCreateGoalDeps,
): CreateGoalCommand {
  return formalbuildCreateGoalCommand(scope, { ...deps, idempotencyKey: deps.idempotencyKey ?? MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.sharedIdempotencyKey });
}

/** Deterministic GoalCreated event per Command/Event Interface. */
export function goalCreatedEventFor(
  command: CreateGoalCommand,
  deps: { eventId: string; occurredAt: string },
): GoalCreatedEvent {
  return {
    eventId: deps.eventId,
    eventType: "GoalCreated",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "Goal",
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      objective: normalizeObjective(command.payload.objective),
      desiredState: "active",
      activePlanRevision: null,
    },
  };
}

/** Deterministic GoalSnapshot per StateLedger Interface. */
export function goalSnapshotFor(command: CreateGoalCommand): GoalSnapshot {
  const workspaceRef: WorkspaceRef = {
    aggregateType: "Workspace",
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
  };
  const goalRef: GoalRef = {
    aggregateType: "Goal",
    projectId: command.identity.projectId,
    goalId: command.aggregateId,
  };
  return {
    ref: goalRef,
    workspaceRef,
    objective: normalizeObjective(command.payload.objective),
    desiredState: "active",
    activePlanRevision: null,
    revision: 1,
  };
}

/**
 * Deterministic ledger commit batch for CreateGoal (contract shape the
 * ControlEngine fold must reproduce exactly, given the same ids).
 */
export function buildGoalCreateLedgerCommit(
  command: CreateGoalCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    projectRevision: number;
    workspaceRevision: number;
  },
): GoalCreateLedgerCommitV1 {
  const projectRef = { aggregateType: "Project" as const, projectId: command.identity.projectId };
  const workspaceRef: WorkspaceRef = {
    aggregateType: "Workspace",
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
  };
  const goalRef: GoalRef = {
    aggregateType: "Goal",
    projectId: command.identity.projectId,
    goalId: command.aggregateId,
  };
  return {
    commitKind: "goal-create",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: commandFingerprint(command),
    expectedVersions: [
      { ref: projectRef, revision: deps.projectRevision },
      { ref: workspaceRef, revision: deps.workspaceRevision },
      { ref: goalRef, revision: 0 },
    ],
    events: [goalCreatedEventFor(command, deps)],
    snapshots: [goalSnapshotFor(command)],
    outboxIntents: [],
  };
}
