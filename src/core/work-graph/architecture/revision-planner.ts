/**
 * The one non-committing catalog revision planner. It validates the expected
 * pin against the current window, runs G1's op engine, applies the delete and
 * responsibility-move rules and returns the whole contribution. The committing
 * owner is `reviseArchitectureCatalog` (or another caller that merges the
 * contribution into its own commit).
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { CatalogRepairOpV1, ResponsibilityMoveV1 } from '../../../contracts/note.js';
import { canonicalJson, canonicalKey, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { roleLineDutyOf, type RoleLineDutyV1 } from '../../../contracts/role-lines.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  CommitCursorBinding, EncodedRecord, GoalRecordTransactionPort, RecordGuard, UniqueClaimChange,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { CommitFragment } from '../persistence/command-executor.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { decodeProjectSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { projectRefFor, workspaceRefFor } from '../persistence/commit-compiler.js';
import { planReanchor, type ReanchorMoveV1 } from '../state/reanchor.js';
import {
  ARCHITECTURE_CATALOG_REVISED_EVENT, architectureBaselineDigest, encodeArchitectureCatalog,
  encodeArchitectureCatalogRevisedEvent, type ArchitectureCatalogRevisedEventV1,
} from './catalog-record-codecs.js';
import type {
  ArchitectureBaselineContentV1, ArchitectureBaselineRevisionSnapshot, ArchitectureCatalogRecord,
  ArchitectureRevision,
} from './catalog-contracts.js';
import { parseRepairOps, applyRepairOps, catalogRevisionMovesProblem } from './repair-ops.js';
import {
  BASELINE_ACTIVE_SCHEMA_ID, BASELINE_SCHEMA_ID, activeRefKey, baselineRefFor, catalogPinOf, catalogRefFor,
  readCurrentCatalogWindow,
} from './catalog-service.js';
import { exactKeys } from './architecture-service.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { CatalogPlanFactsPort, CatalogResponsibilityPort } from '../model/catalog-revision-ports.js';

/** The catalog service imports the move check from here; its one definition is in repair-ops. */
export { catalogRevisionMovesProblem };

export type CatalogRevisionInputV1 = {
  expected: ArchitectureCatalogPinV1;
  ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[];
  reason: string;
  commandId: string;
};

export type CatalogRevisionContribution = CommitFragment & {
  revision: ArchitectureRevision;
  pin: ArchitectureCatalogPinV1;
};

export type CatalogRevisionDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  now(): string;
  eventId(): string;
  taskFacts?: CatalogPlanFactsPort;
  responsibility?: CatalogResponsibilityPort;
  duty?: SessionDutyReadPort;
};

const REVISE_IDENTITY_PREFIX = 'architecture-catalog-revise:';
const REVISE_COMMAND_TYPE = 'ReviseArchitectureCatalog';
const MAX_REVISE_REASON_BYTES = 2048;

/** The exact identity and fingerprint of one revision input; the service reuses
 * them for its receipt lookup and commit without a second formula. */
export function catalogRevisionKeys(input: CatalogRevisionInputV1, actor: ActorRef, projectId: string):
  { identityKey: string; fingerprint: string } {
  return {
    identityKey: REVISE_IDENTITY_PREFIX + commandIdentityKey({ projectId, actor, idempotencyKey: input.commandId }),
    fingerprint: sha256Hex(canonicalJson({
      schemaVersion: 1, commandType: REVISE_COMMAND_TYPE,
      expected: input.expected, ops: input.ops, responsibilityMoves: input.responsibilityMoves,
      reason: input.reason,
    } as unknown as JsonValue)),
  };
}

function invalid(reason: string): CoreRejection { return rejected('invalid', reason); }
function unavailable(reason: string): CoreRejection { return rejected('unavailable', reason); }
function forbiddenRevision(reason: string): CoreRejection { return rejected('forbidden', reason); }

function revisionHostActorOf(ctx: CoreCallContext): ActorRef | CoreRejection {
  if (!ctx || typeof ctx !== 'object') return forbiddenRevision('a bound call context is required');
  if (ctx.principal.kind !== 'host') return forbiddenRevision('a catalog revision is admitted only through a host principal');
  const actor = ctx.principal.actor;
  if (actor.kind !== 'human' && actor.kind !== 'system') {
    return forbiddenRevision('a catalog revision requires a trusted human or system actor');
  }
  return actor;
}

export function catalogRevisionPinProblem(pin: ArchitectureCatalogPinV1): string | null {
  if (!isRecord(pin) || !exactKeys(pin, ['catalogRef', 'baseline'])) return 'the expected catalog pin is incomplete';
  const catalog = pin.catalogRef;
  const baseline = pin.baseline;
  if (!isRecord(catalog) || !isRecord(baseline)) return 'the expected catalog pin is incomplete';
  if (catalog['aggregateType'] !== 'ArchitectureCatalog' || !nonEmpty(catalog['projectId'])
    || !nonEmpty(catalog['baselineId']) || typeof catalog['revision'] !== 'number'
    || !Number.isSafeInteger(catalog['revision']) || catalog['revision'] < 1) {
    return 'the expected catalog ref is not a complete ArchitectureCatalog ref';
  }
  const ref = baseline['ref'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'ArchitectureBaselineRevision' || !nonEmpty(ref['projectId'])
    || !nonEmpty(ref['baselineId']) || typeof ref['revision'] !== 'number'
    || !Number.isSafeInteger(ref['revision']) || ref['revision'] < 1) {
    return 'the expected baseline pin is incomplete';
  }
  if (!nonEmpty(baseline['digest'])) return 'the expected baseline pin has no digest';
  if (catalog['projectId'] !== ref['projectId'] || catalog['baselineId'] !== ref['baselineId']
    || catalog['revision'] !== ref['revision']) {
    return 'the expected catalog ref does not name the pinned baseline revision';
  }
  return null;
}

/**
 * The book removes a containment edge when the child is removed in the same
 * revision; `remove_module` in the op engine does that, so the planner applies
 * the caller's original ops and keeps its fingerprint untouched.
 */
export async function planCatalogRevision(deps: CatalogRevisionDependencies, ctx: CoreCallContext,
  input: CatalogRevisionInputV1): Promise<ReadResult<CatalogRevisionContribution>> {
  const actor = revisionHostActorOf(ctx);
  if ('status' in actor) return actor;
  if (!isRecord(input) || !exactKeys(input, ['expected', 'ops', 'responsibilityMoves', 'reason', 'commandId'])) {
    return invalid('a catalog revision requires expected, ops, responsibilityMoves, reason and commandId');
  }
  if (!nonEmpty(input.commandId)) return invalid('a catalog revision requires a commandId');
  if (typeof input.reason !== 'string' || input.reason.length === 0) return invalid('a catalog revision requires a reason');
  if (Buffer.byteLength(input.reason, 'utf8') > MAX_REVISE_REASON_BYTES) {
    return invalid('a catalog revision reason must be at most 2048 UTF-8 bytes');
  }
  const pin = catalogRevisionPinProblem(input.expected);
  if (pin !== null) return invalid(pin);
  const projectId = input.expected.catalogRef.projectId;
  if (ctx.projectId !== projectId) return forbiddenRevision('the catalog revision is outside the call context project');
  const workspaceId = ctx.workspaceId;
  if (!nonEmpty(workspaceId)) return forbiddenRevision('a bound workspace call context is required');

  const parsed = parseRepairOps(input.ops);
  if (!parsed.ok) return invalid(parsed.problem.reason);
  const ops = parsed.ops;

  const current = await readCurrentCatalogWindow(deps.records, projectId);
  if (current.status === 'not_found') return rejected('incomplete', 'the project has no active architecture baseline to revise');
  if (current.status !== 'ready') return current;
  if (canonicalJson(catalogPinOf(current) as unknown as JsonValue)
    !== canonicalJson(input.expected as unknown as JsonValue)) {
    return rejected('source_stale', 'the expected catalog pin is not the current architecture revision');
  }

  const identity = catalogRevisionKeys(input, actor, projectId);
  const occurredAt = deps.now();
  const parentCatalog = current.catalog.catalog;
  const parentModules = new Map(parentCatalog.modules.map(module => [module.ref.moduleId, module]));
  const ruleSet = current.baseline.content.dependencyRules ?? [];
  const trial = applyRepairOps(parentCatalog, ruleSet, ops, projectId);
  if (!trial.ok) return invalid(trial.problem.reason);
  if (Object.prototype.hasOwnProperty.call(parentCatalog, 'containment')
    && !Object.prototype.hasOwnProperty.call(trial.catalog, 'containment')) {
    return invalid('the parent catalog declared containment, so the revised catalog must declare it explicitly');
  }
  const trialModules = new Set(trial.catalog.modules.map(module => module.ref.moduleId));
  const removed = new Set([...parentModules.keys()].filter(moduleId => !trialModules.has(moduleId)));
  const moves = input.responsibilityMoves;
  const movesProblem = catalogRevisionMovesProblem(moves, projectId, trialModules);
  if (movesProblem !== null) return invalid(movesProblem);

  const scope: WorkspaceScope = { projectId, workspaceId };
  const planGuards: RecordGuard[] = [];
  let taskFactsWatermark: CommitCursor | null | undefined;
  if (removed.size > 0) {
    if (deps.taskFacts === undefined) {
      return unavailable('the catalog revision has no bound task facts reader');
    }
    const uses = await deps.taskFacts.read(deps.records, projectId);
    if (uses.status !== 'ready') return uses;
    taskFactsWatermark = uses.value.watermark;
    const users: string[] = [];
    for (const plan of uses.value.plans) {
      planGuards.push({ refKey: canonicalJson(plan.goalRef as unknown as JsonValue), expectedRevision: plan.revision });
      for (const task of plan.tasks) {
        if (task.closure !== 'open') continue;
        if (task.moduleIds.some(moduleId => removed.has(moduleId))) users.push(task.taskId);
      }
    }
    if (users.length > 0) return invalid('module_in_use: ' + [...new Set(users)].join(', '));
  }

  let responsibilityFragment: CommitFragment | null = null;
  if (removed.size > 0 || moves.length > 0) {
    if (deps.responsibility === undefined || deps.duty === undefined) {
      return unavailable('the catalog revision has no bound responsibility capability');
    }
    const facts = await deps.responsibility.readFacts(deps.records, ctx, scope, moves);
    if (facts.status !== 'ready') return facts;
    const required = new Map<string, { source: ResponsibilityMoveV1['link']; move: ResponsibilityMoveV1 }>();
    for (const move of moves) required.set(canonicalKey(move.link), { source: move.link, move });
    for (const link of facts.value.links.values()) {
      if (link.ref.relation !== 'responsible' || link.until !== null || link.ref.target.kind !== 'module') continue;
      if (!removed.has(link.ref.target.ref.moduleId)) continue;
      if (!required.has(canonicalKey(link.ref))) {
        return invalid('responsibility_destination_missing: the open link ' + link.ref.sessionId + ' is not moved');
      }
    }
    const byDuty = new Map<RoleLineDutyV1, ReanchorMoveV1[]>();
    for (const move of moves) {
      const link = facts.value.links.get(canonicalKey(move.link));
      if (link === undefined) return invalid('the responsibility move names a link that is not present');
      if (link.until !== null) return invalid('the responsibility move names a link that is already closed');
      const session = facts.value.sessions.get(link.ref.sessionId);
      if (session === undefined) return invalid('the responsibility move has no source Session');
      const resolved = await deps.duty(session.role, ctx);
      if (resolved.status !== 'ready') {
        return unavailable(resolved.status === 'rejected' ? resolved.reason : 'the Session duty is not ready');
      }
      const duty = roleLineDutyOf(resolved.value);
      if (duty === null) return unavailable('the Session duty is unknown');
      const destinations = move.to.kind === 'standby' ? [] : move.to.destinations.map(destination => ({
        link: { ...link.ref, target: { kind: 'module' as const, ref: destination }, relation: 'responsible' as const },
        target: { kind: 'module' as const, ref: destination },
      }));
      const list = byDuty.get(duty) ?? [];
      list.push({ duty, source: link.ref, destinations });
      byDuty.set(duty, list);
    }
    const oldCatalog = { state: 'present' as const, revision: current.activeRevision, catalog: parentCatalog };
    const proposedCatalog = { state: 'present' as const, revision: current.activeRevision + 1, catalog: trial.catalog };
    const sessions = new Map<string, import('../../../contracts/core/session.js').SessionRecord>();
    const links = new Map<string, { link: ResponsibilityMoveV1['link']; next: import('../../../contracts/core/session.js').PendingSessionWorkLink | null }>();
    const claimChanges = new Map<string, import('../../../contracts/role-lines.js').RoleScopeClaimChangeV1>();
    const bindings = new Map<string, import('../../../contracts/role-lines.js').RoleLineBindingIntentV1>();
    const events: import('../state/reanchor.js').ReanchorEventMaterialV1[] = [];
    for (const [duty, movesForDuty] of byDuty) {
      const planned = planReanchor({
        projectRef: { projectId }, duty, moves: movesForDuty,
        facts: { sessions: facts.value.sessions, links: facts.value.links, goals: new Map(), catalog: oldCatalog },
        authorization: { actor, scope: [{ kind: 'project' }] },
        proposed: { catalog: proposedCatalog },
      });
      if (!planned.ok) return planned.refusals[0]!;
      for (const entry of planned.plan.sessions) sessions.set(canonicalKey(entry.ref), entry);
      for (const entry of planned.plan.links) links.set(canonicalKey(entry.link), entry);
      for (const change of planned.plan.claimChanges) claimChanges.set(canonicalKey(change), change);
      for (const binding of planned.plan.bindings) bindings.set(canonicalKey(binding), binding);
      for (const event of planned.plan.events) events.push(event);
    }
    const plannedLinkGuards = [...links.values()]
      .filter(entry => !facts.value.links.has(canonicalKey(entry.link)))
      .map(entry => ({ refKey: canonicalKey(entry.link), expectedRevision: null as number | null }));
    const contribution = deps.responsibility.contribution({
      sessions: [...sessions.values()], links: [...links.values()], claimChanges: [...claimChanges.values()],
      bindings: [...bindings.values()], events,
      guards: [...facts.value.guards, ...plannedLinkGuards], identityKey: identity.identityKey, occurredAt,
      projectId, catalogRevision: facts.value.activeRevision,
    });
    if (!contribution.ok) return contribution.rejection;
    responsibilityFragment = {
      records: contribution.fragment.records, events: contribution.fragment.events,
      guards: contribution.fragment.guards, claims: contribution.fragment.claims,
      ...(contribution.fragment.commitCursorBindings === undefined ? {} : { commitCursorBindings: contribution.fragment.commitCursorBindings }),
      ...(contribution.fragment.ledgerHorizon === undefined ? {} : { ledgerHorizon: contribution.fragment.ledgerHorizon }),
    };
  }

  const projectKey = canonicalJson(projectRefFor(projectId) as unknown as JsonValue);
  const workspaceKey = canonicalJson(workspaceRefFor(projectId, workspaceId) as unknown as JsonValue);
  const scopeRead = await deps.records.readMany([projectKey, workspaceKey]);
  if (scopeRead.status !== 'ready') return unavailable(scopeRead.code + ': ' + scopeRead.reason);
  const scopeByKey = new Map(scopeRead.value.records.map(record => [record.refKey, record]));
  const projectRecord = scopeByKey.get(projectKey);
  const workspaceRecord = scopeByKey.get(workspaceKey);
  if (projectRecord === undefined || workspaceRecord === undefined) {
    return rejected('not_found', 'the project and workspace canonical records must exist before a catalog revision');
  }
  const project = decodeProjectSnapshot(projectRecord);
  const workspace = decodeWorkspaceSnapshot(workspaceRecord);
  if (project.status !== 'decoded' || workspace.status !== 'decoded') {
    return unavailable('the canonical project/workspace records are damaged');
  }

  const baselineId = input.expected.baseline.ref.baselineId;
  const nextRevision = input.expected.baseline.ref.revision + 1;
  const content = structuredClone(current.baseline.content) as ArchitectureBaselineContentV1;
  if (content.dependencyRules !== undefined || trial.rules.length > 0) content.dependencyRules = trial.rules;
  const contentDigest = architectureBaselineDigest({
    schemaVersion: 1, baselineId, contentRevision: nextRevision, content,
  });
  if (contentDigest === null) return invalid('the carried baseline content is not canonical JSON');
  const baselineRef = baselineRefFor(projectId, baselineId, nextRevision);
  const baseline: ArchitectureBaselineRevisionSnapshot = {
    ref: baselineRef, revision: 1, schemaVersion: 1, baselineId, contentRevision: nextRevision, contentDigest, content,
  };
  const catalogRef = catalogRefFor(projectId, baselineId, nextRevision);
  const catalogRecord: ArchitectureCatalogRecord = {
    ref: catalogRef, revision: 1, baselineRef, schemaVersion: 1, catalog: trial.catalog, since: null,
  };
  const activeRecord = {
    ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId },
    projectId, revision: current.activeRevision + 1, activeRevision: baselineRef,
  };
  const event: ArchitectureCatalogRevisedEventV1 = {
    eventId: deps.eventId(), eventType: ARCHITECTURE_CATALOG_REVISED_EVENT, schemaVersion: 1,
    occurredAt, identityKey: identity.identityKey, fingerprint: identity.fingerprint, projectId,
    fromPin: input.expected.baseline, actor, reason: input.reason,
    revision: { baseline, catalog: catalogRecord },
  };
  const baselineKey = canonicalJson(baselineRef as unknown as JsonValue);
  const catalogKey = canonicalJson(catalogRef as unknown as JsonValue);
  const guards: RecordGuard[] = [
    { refKey: projectKey, expectedRevision: project.value.revision },
    { refKey: workspaceKey, expectedRevision: workspace.value.revision },
    ...current.guards, ...planGuards,
    { refKey: baselineKey, expectedRevision: null },
    { refKey: catalogKey, expectedRevision: null },
  ];
  const fragment = responsibilityFragment;
  const merged = mergeGuards([...guards, ...(fragment?.guards ?? [])]);
  if (!merged.ok) return merged.rejection;
  const records: EncodedRecord[] = [
    { refKey: baselineKey, schemaId: BASELINE_SCHEMA_ID, revision: 1, json: JSON.stringify(baseline) },
    encodeArchitectureCatalog(catalogRecord),
    { refKey: activeRefKey(projectId), schemaId: BASELINE_ACTIVE_SCHEMA_ID, revision: activeRecord.revision, json: JSON.stringify(activeRecord) },
    ...(fragment?.records ?? []),
  ];
  const events = [
    ...(fragment?.events ?? []),
    encodeArchitectureCatalogRevisedEvent(event),
  ];
  const commitCursorBindings: CommitCursorBinding[] = [
    ...(fragment?.commitCursorBindings ?? []),
    { refKey: catalogKey, field: 'since' },
  ];
  const claims: UniqueClaimChange[] = [...(fragment?.claims ?? [])];
  // A module delete carries the task-facts watermark (read before Goal
  // enumeration) as its ledger horizon; any Goal or plan added meanwhile is a
  // revision_conflict at the commit, never a silently missed user.
  const ledgerHorizon = removed.size > 0 ? taskFactsWatermark : fragment?.ledgerHorizon;
  return {
    status: 'ready',
    value: {
      guards: merged.guards, records, claims, events, commitCursorBindings,
      ...(ledgerHorizon === undefined ? {} : { ledgerHorizon }),
      revision: { baseline, catalog: catalogRecord },
      pin: catalogPinOf({ baseline, catalog: catalogRecord }),
    },
  };
}
