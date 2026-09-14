/** Internal StateLedger governance rules. Both adapters invoke these inside their commit protocol. */

import type { GovernanceActivateLedgerCommitV1, GovernanceInstallLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { ArchitectureBaselineRevisionSnapshot, CompletionPolicyRevisionSnapshot, ProjectArchitectureBaselineActiveSnapshot, ProjectCompletionPolicyActiveSnapshot } from "../../../contracts/governance.js";
// ArchitectureEvolutionPolicy uses the same immutable snapshot rules as other versioned governance.
import type { ArchitectureEvolutionPolicyRevisionSnapshot, ProjectArchitectureEvolutionPolicyActiveSnapshot } from "../../../contracts/architecture-evolution-policy.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { identityMatchesActor } from './batch-identity.js';
import { validateInitialDesignCommon } from './architecture-evolution.js';


// ------------------------------------------------------------------------ //
// governance-install                                                        //
// ------------------------------------------------------------------------ //

export function validateGovernanceInstallCommit(
  batch: GovernanceInstallLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1 || snapshot.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== 1) return false;
  if (snapshot.revision !== 1) return false;

  if (event.eventType === "CompletionPolicyInstalled") {
    if (event.aggregateType !== "CompletionPolicyRevision") return false;
    if (snapshot.ref.aggregateType !== "CompletionPolicyRevision") return false;
    const s = snapshot as CompletionPolicyRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.policyId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else if (event.eventType === "ArchitectureBaselineInstalled") {
    if (event.aggregateType !== "ArchitectureBaselineRevision") return false;
    if (snapshot.ref.aggregateType !== "ArchitectureBaselineRevision") return false;
    const s = snapshot as ArchitectureBaselineRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.baselineId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else if (event.eventType === "ArchitectureEvolutionPolicyInstalled") {
    // ArchitectureEvolutionPolicy: exactly one immutable revision snapshot and one event.
    if (event.aggregateType !== "ArchitectureEvolutionPolicyRevision") return false;
    if (snapshot.ref.aggregateType !== "ArchitectureEvolutionPolicyRevision") return false;
    const s = snapshot as ArchitectureEvolutionPolicyRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.policyId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision.contentRevision ||
      s.contentDigest !== event.payload.revision.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.revision.content)) return false;
    if (canonicalJson(event.payload.revision.ref) !== canonicalJson(snapshot.ref)) return false;
  } else {
    return false;
  }

  // Immutability CAS: exactly one expected version = the revision at 0.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}


// ------------------------------------------------------------------------ //
// governance-activate                                                       //
// ------------------------------------------------------------------------ //

export function validateGovernanceActivateCommit(
  batch: GovernanceActivateLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== snapshot.revision) return false;
  if (!Number.isSafeInteger(event.aggregateRevision) || event.aggregateRevision < 1) return false;

  if (event.eventType === "CompletionPolicyActivated") {
    if (event.aggregateType !== "ProjectCompletionPolicyActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectCompletionPolicyActive") return false;
    const s = snapshot as ProjectCompletionPolicyActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.policyId !== event.payload.target.ref.policyId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else if (event.eventType === "ArchitectureBaselineActivated") {
    if (event.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    const s = snapshot as ProjectArchitectureBaselineActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.baselineId !== event.payload.target.ref.baselineId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else if (event.eventType === "ArchitectureEvolutionPolicyActivated") {
    // ArchitectureEvolutionPolicy: one Project active aggregate for this kind.
    if (event.aggregateType !== "ProjectArchitectureEvolutionPolicyActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectArchitectureEvolutionPolicyActive") return false;
    const s = snapshot as ProjectArchitectureEvolutionPolicyActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.policyId !== event.payload.activeRevision.policyId ||
      s.activeRevision.projectId !== event.payload.activeRevision.projectId ||
      s.activeRevision.revision !== event.payload.activeRevision.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.activeRevision)) return false;
    if (canonicalJson(s.ref) !== canonicalJson(event.payload.activeRef)) return false;
  } else {
    return false;
  }

  // CAS: [Project@expected, ActiveAggregate@(snapshot.revision - 1)].
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.ref.aggregateType !== "Project") return false;
  if (batch.expectedVersions[0]!.ref.projectId !== event.projectId) return false;
  if (batch.expectedVersions[1]!.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

export function validateCoordinationPolicyInstallCommit(batch: import("../../../contracts/ledger.js").CoordinationPolicyInstallRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CoordinationPolicyInstalled" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.policyId !== event.aggregateId || canonicalJson(snap.content) !== canonicalJson(event.payload.revision.content) || snap.contentDigest !== event.payload.revision.contentDigest || snap.installedAt !== event.payload.revision.installedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return validateInitialDesignCommon(event, batch);
}

export function validateCoordinationPolicyActivateCommit(batch: import("../../../contracts/ledger.js").CoordinationPolicyActivateRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CoordinationPolicyActivated" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.projectId !== event.projectId || canonicalJson(snap.activeRevision) !== canonicalJson(event.payload.activeRevision)) return false;
  // CAS: Project@expected and ActiveAggregate@(snapshot.revision - 1), per versioned-governance semantics.
  if (batch.expectedVersions.length !== 2) return false;
  const pE = batch.expectedVersions[0]!; const aE = batch.expectedVersions[1]!;
  if (pE.ref.aggregateType !== "Project" || pE.ref.projectId !== event.projectId) return false;
  if (!Number.isSafeInteger(pE.revision) || pE.revision < 0) return false;
  if (canonicalJson(aE.ref) !== canonicalJson(snap.ref) || aE.revision !== snap.revision - 1) return false;
  return true;
}


// ------------------------------------------------------------------------ //
//  role-spec governance commit validators                              //
// ------------------------------------------------------------------------ //

/**
 * RoleSpecRevision 安装：一条事件 + 一个不可改写快照，CAS@0。
 * 校验的是「事件与快照逐字对齐」这一 StateLedger 级不变量——内容好坏、摘要口径与权限是否
 * 合理属于 Control 侧的安装守卫，不在这里重复判断（与 CoordinationPolicy 同一分工）。
 */
export function validateRoleSpecInstallCommit(batch: import("../../../contracts/ledger.js").RoleSpecInstallRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RoleSpecInstalled" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.roleId !== event.aggregateId || snap.ref.roleId !== snap.roleId || snap.contentRevision !== snap.ref.revision) return false;
  if (canonicalJson(snap.content) !== canonicalJson(event.payload.revision.content) || snap.contentDigest !== event.payload.revision.contentDigest || snap.installedAt !== event.payload.revision.installedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return event.aggregateRevision === 1 && identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


/**
 * RoleSpecRevision 激活：每个 (project, role) 一个生效引用，CAS 与其他版本化治理同口径：
 * Project@expectedRevision（形状校验，运行时 CAS 由账本判定）+ 该角色生效聚合 @(snapshot.revision - 1)。
 * 与 CoordinationPolicy 的关键差别：这里把 activeRevision.roleId 与快照、事件三者绑成同一个角色，
 * 避免「A 角色的生效引用被写成 B 角色的规格」这种跨角色漂移。
 */
export function validateRoleSpecActivateCommit(batch: import("../../../contracts/ledger.js").RoleSpecActivateRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RoleSpecActivated" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.projectId !== event.projectId) return false;
  if (snap.roleId !== snap.ref.roleId || snap.roleId !== snap.activeRevision.roleId) return false;
  if (event.aggregateId !== snap.roleId || event.aggregateRevision !== snap.revision) return false;
  if (canonicalJson(snap.activeRevision) !== canonicalJson(event.payload.activeRevision)) return false;
  if (batch.expectedVersions.length !== 2) return false;
  const pE = batch.expectedVersions[0]!;
  const aE = batch.expectedVersions[1]!;
  if (pE.ref.aggregateType !== "Project" || pE.ref.projectId !== event.projectId) return false;
  if (!Number.isSafeInteger(pE.revision) || pE.revision < 0) return false;
  if (canonicalJson(aE.ref) !== canonicalJson(snap.ref) || aE.revision !== snap.revision - 1) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
