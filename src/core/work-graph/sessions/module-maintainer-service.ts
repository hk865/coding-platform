/**
 * The module maintainer owner (L9; 8B-04/8B-05): the one read, the assign command and the operation owner.
 *
 * The formal request is one existing `SessionOperationRecord` with the `maintainer_assignment` action arm; there is no
 * second request record and no second link writer. The assign command is one `executeWriteCommand` whose pure decision
 * is `state/assign-maintainer.ts`; it calls the existing `roleLineCommitContribution` with the link decision's own
 * materials (open → `work_linked`; move → `transitionResponsibility`/`openDestination`), so the link, its claim and its
 * event are one commit. The two entries (`{kind:'person'}` and `{kind:'trusted'}`) share the command's migration,
 * contributions and result; only the trusted entry reads the stored operation and checks the call binding.
 *
 * The answer path is the member arm's two-commit shape: the assign command's link/claim commit, then the operation's
 * `done` stage with the single `MaintainerAssignmentRecorded` event carrying the formal `DecisionChangeProofV1`. A
 * reject writes only the `rejected` stage, never a link, proof or receipt. The auto path is the owner's own branch:
 * the created operation is the standing authorization (`since = requestedAt`), and one `notifyProject` follows.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { ModuleRef, SessionRef, VersionPin, WorkspaceScope, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type {
  CoreRejection, ReadResult, WriteResult,
} from '../../../contracts/core/results.js';
import type { DecisionApplicationReceiptV1 } from '../../../contracts/core/session-message.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import {
  ModuleRefShape, OperationRefShape, SessionMessageRefShape, SessionRefShape,
} from '../../../contracts/data-format-refs.js';
import { canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import { truncateUtf8 } from '../../../contracts/utf8.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { maintainerCallBindingOf, maintainerClaimConflictOf, roleLineDutyOf } from '../../../contracts/role-lines.js';
import type { NotifyProjectInputV1, ProjectNoticeV1, RoleScopeV1 } from '../../../contracts/role-lines.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import { readCatalogModuleFacts } from '../architecture/catalog-service.js';
import type { KnowledgeLines } from '../model/line-knowledge.js';
import type { GoalSettingsPort } from '../model/decision-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { SessionDirectoryPort, MaintainerAssignmentOperationV1 } from '../model/session-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import {
  type AssignMaintainerInputV1, type MaintainerAssignmentDecisionInputV1,
  type MaintainerAssignmentRequestV1, type MaintainerAssignmentToolResultV1, type MaintainerCallerV1,
  type ModuleMaintainerPort, maintainerBindingOfOperation,
} from '../model/module-maintainer-contracts.js';
import { platformCheckContext } from '../model/platform-check-context.js';
import {
  type AssignMaintainerDecisionV1, type AssignMaintainerFactsV1, type AssignMaintainerRefusalV1,
  assignMaintainerDecision,
} from '../state/assign-maintainer.js';
import {
  MaintainerAssignmentActionShape, acceptedMaintainerAssignment, advancedMaintainerAssignment,
  type MaintainerAssignmentStepV1,
} from '../state/module-maintainer-assignment.js';
import { decisionActionPolicy } from '../state/decision-policy.js';
import { foldRoleScopeClaimChanges } from '../state/role-scope.js';
import {
  destinationEligible, transitionResponsibility, type ResponsibilityGuardV1,
} from '../state/session-responsibility.js';
import {
  sessionMachineStateOf, transitionSession, type SessionGuardContext,
} from '../state/session-availability.js';
import { commandIdentity, commandKeys, executeWriteCommand } from '../persistence/command-executor.js';
import { lookupCommittedReceipt } from '../persistence/receipt-lookup.js';
import { storeFailureCode, storeFailureToRejection } from '../persistence/read-result-failures.js';
import { eventIdOf } from './trusted-context.js';
import { scopesInProjectView } from './role-line-operations.js';
import { rawModuleRef } from '../../../contracts/workspace-module-id.js';
import {
  SESSION_WORK_LINK_CHANGED_EVENT, encodeSessionWorkLinkChangedEvent, sessionWorkLinkChangedPayloadFromEvent,
  type SessionWorkLinkChangedEventV1,
} from './lifecycle-record-codecs.js';
import { responsibleLinkRef, scopeClaimChangesOf } from './session-responsibility-service.js';
import { roleLineCommitContribution } from './role-scope-commit.js';
import {
  decodeSessionRecord, decodeSessionWorkLink, encodeSessionOperationRecord, encodeSessionRecord,
  operationRefKey, plainSessionRef, plainSessionRefKey, plainSessionRefToAggregate,
  readMaintainerAssignmentOperation, sessionAggregateRefKey, sessionWorkLinkRefKey,
  maintainerAssignmentRecordedCodec, type MaintainerAssignmentRecordedEventV1,
} from './session-record-codecs.js';

/** The service's fixed host actor, used only to satisfy the Host read gate of the stored caller Run. */
const MAINTAINER_SYSTEM_ACTOR = { kind: 'system' as const, id: 'module-maintainer-service' };
const REQUEST_OPERATION = 'modules.requestAssignment';
const STAGE_OPERATION = 'modules.requestAssignment.stage';
const ASSIGN_OPERATION = 'modules.assignMaintainer';

const now = (): string => new Date().toISOString();

function maintainerScopeProblem(ctx: CoreCallContext): CoreRejection | null {
  if (!nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)) {
    return rejected('forbidden', 'a module maintainer call requires a bound project/workspace context');
  }
  return null;
}

function acceptedRecord(input: {
  ref: OperationRef; workspaceId: string; at: string; actionInput: MaintainerAssignmentOperationV1['action']['input'];
}): MaintainerAssignmentOperationV1 {
  const accepted = acceptedMaintainerAssignment(input.actionInput);
  return {
    ref: input.ref,
    revision: 1,
    workspaceId: input.workspaceId,
    action: accepted.action,
    phase: accepted.phase,
    requestedAt: input.at,
    updatedAt: input.at,
    observation: null,
    failure: null,
  };
}

function advancedRecord(
  operation: MaintainerAssignmentOperationV1,
  at: string,
  step: MaintainerAssignmentStepV1,
): MaintainerAssignmentOperationV1 {
  const next = advancedMaintainerAssignment(operation.action, operation.phase, step);
  return {
    ...operation,
    revision: operation.revision + 1,
    updatedAt: at,
    phase: next.phase,
    action: next.action,
  };
}

/** One operation write's result: the stored `MaintainerAssignmentRecorded` event, never a new record format. */
function operationEvent(record: MaintainerAssignmentOperationV1, eventId: string, at: string,
  actor?: ActorRef, proof?: DecisionChangeProofV1) {
  return maintainerAssignmentRecordedCodec.encode({
    eventId, eventType: 'MaintainerAssignmentRecorded', schemaVersion: 1, occurredAt: at,
    projectId: record.ref.projectId, workspaceId: record.workspaceId,
    operationRef: structuredClone(record.ref), revision: record.revision, phase: record.phase,
    action: structuredClone(record.action),
    ...(actor === undefined ? {} : { actor: structuredClone(actor) }),
    ...(proof === undefined ? {} : { proof: structuredClone(proof) }),
  });
}

function maintainerStageCommand(ref: OperationRef, revision: number, stage: 'accepted' | 'awaiting_decision' | 'done' | 'rejected'): {
  operation: string; commandId: string; fingerprintInput: JsonValue;
} {
  return {
    operation: STAGE_OPERATION,
    commandId: `${ref.operationId}:${stage}:${String(revision)}`,
    fingerprintInput: { operationRef: ref, revision, stage } as unknown as JsonValue,
  };
}

export type ModuleMaintainerDependenciesV1 = {
  findSessions: SessionDirectoryPort['findSessions'];
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** A.1 #4: the module an assignment names is checked against the knowledge files' current catalog. */
  knowledge: KnowledgeLines;
  duty: SessionDutyReadPort;
  catalog: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  notifyProject: (input: NotifyProjectInputV1) => Promise<WriteResult<ProjectNoticeV1>>;
  /** The stored caller Run read; needs the Host read context (`member-service.ts` shape). */
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  /** The one saved Goal/settings read; no default mode and no authorization record. */
  goalSettings: Pick<GoalSettingsPort, 'readGoalSettings'>;
};

type AssignDecision = Extract<AssignMaintainerDecisionV1, { decision: unknown }>['decision'];

export function createModuleMaintainer(deps: ModuleMaintainerDependenciesV1): ModuleMaintainerPort {
  // ------------------------------------------------------------------------
  // The one maintainer read
  // ------------------------------------------------------------------------

  async function maintainerOf(ctx: CoreCallContext, input: { workspace: WorkspaceScope; module: ModuleRef }):
    Promise<ReadResult<{ status: 'none' } | { status: 'assigned'; line: SessionRef; link: SessionWorkLink }>> {
    const found: { line: SessionRef; link: SessionWorkLink }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await deps.findSessions(ctx, {
        workspace: input.workspace, target: { kind: 'module', ref: input.module },
        includeArchived: false, page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      });
      if (page.status !== 'ready') return page;
      for (const card of page.value.items) {
        if (card.record.lifecycle !== 'active') continue;
        const link = card.links.find((candidate) =>
          candidate.ref.relation === 'responsible'
          && candidate.ref.target.kind === 'module'
          && candidate.ref.target.ref.projectId === input.module.projectId
          && candidate.ref.target.ref.moduleId === input.module.moduleId
          && candidate.until === null);
        if (link === undefined) continue;
        const duty = await deps.duty(card.record.role, ctx);
        if (duty.status !== 'ready') {
          if (duty.status === 'rejected') return duty;
          return rejected('unavailable', 'the maintainer line duty is not readable');
        }
        if (roleLineDutyOf(duty.value) !== 'executor') continue;
        const line = plainSessionRef(link.ref);
        if (!found.some((entry) => plainSessionRefKey(entry.line) === plainSessionRefKey(line))) {
          found.push({ line, link });
        }
      }
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    if (found.length === 0) return { status: 'ready', value: { status: 'none' } };
    if (found.length > 1) {
      return rejected('unavailable', 'the maintainer claim has two owners');
    }
    return { status: 'ready', value: { status: 'assigned', line: found[0]!.line, link: found[0]!.link } };
  }

  // ------------------------------------------------------------------------
  // The assign command
  // ------------------------------------------------------------------------

  async function readLineSnapshot(scope: WorkspaceScope, line: SessionRef, target: WorkLinkTarget):
    Promise<{ line: SessionRecord; link: SessionWorkLink | null } | CoreRejection> {
    const lineKey = sessionAggregateRefKey(plainSessionRefToAggregate(line));
    const linkRef = responsibleLinkRef(line, target);
    const linkKey = sessionWorkLinkRefKey(linkRef);
    let read: Awaited<ReturnType<ModuleMaintainerDependenciesV1['records']['readMany']>>;
    try {
      read = await deps.records.readMany([lineKey, linkKey]);
    } catch (error) {
      return storeFailureToRejection(error);
    }
    if (read.status !== 'ready') return storeFailureToRejection(read);
    const lineRecord = read.value.records.find((record) => record.refKey === lineKey);
    if (lineRecord === undefined) return rejected('not_found', 'the maintainer line does not exist');
    const decodedLine = decodeSessionRecord(lineRecord);
    if (decodedLine.status !== 'decoded') {
      return rejected('unavailable', `the maintainer line is damaged: ${decodedLine.reason}`);
    }
    const record = decodedLine.value;
    if (record.ref.projectId !== scope.projectId || record.workspaceId !== scope.workspaceId) {
      return rejected('forbidden', 'the maintainer line is outside the bound scope');
    }
    const linkRecord = read.value.records.find((entry) => entry.refKey === linkKey);
    if (linkRecord === undefined) return { line: record, link: null };
    const decodedLink = decodeSessionWorkLink(linkRecord);
    if (decodedLink.status !== 'decoded') {
      return rejected('unavailable', `the maintainer link is damaged: ${decodedLink.reason}`);
    }
    return { line: record, link: decodedLink.value };
  }

  async function readAssignFacts(ctx: CoreCallContext, scope: WorkspaceScope, input: AssignMaintainerInputV1,
    targetLine: SessionRecord, targetLink: SessionWorkLink | null): Promise<AssignMaintainerFactsV1 | CoreRejection> {
    const catalog = await readCatalogModuleFacts(deps.records, ctx, input.module, { lines: deps.knowledge, caller: ctx });
    if (catalog.status === 'rejected') return catalog;
    if (catalog.status !== 'ready' && catalog.status !== 'not_found') {
      return rejected('unavailable', 'the module catalog is not readable');
    }
    if (catalog.status === 'not_found') {
      return { line: targetLine, duty: 'unknown', maintainer: { status: 'none' }, lineLink: targetLink,
        from: null, moduleInCatalog: false };
    }
    const duty = await deps.duty(targetLine.role, ctx);
    if (duty.status !== 'ready') {
      if (duty.status === 'rejected') return duty;
      return rejected('unavailable', 'the maintainer line duty is not readable');
    }
    const maintainer = await maintainerOf(ctx, { workspace: scope, module: input.module });
    if (maintainer.status !== 'ready') {
      if (maintainer.status === 'rejected') return maintainer;
      return rejected('unavailable', 'the module maintainer is not readable');
    }
    let line = targetLine;
    let lineLink = targetLink;
    let from: { session: SessionRecord; link: SessionWorkLink } | null = null;
    if (maintainer.value.status === 'assigned'
      && targetLine.lifecycle === 'active'
      && roleLineDutyOf(duty.value) === 'executor'
      && !(maintainer.value.line.projectId === targetLine.ref.projectId
        && maintainer.value.line.sessionId === targetLine.ref.sessionId)) {
      // The move's own facts and CAS guards are one read of the source Session, its link, the target
      // Session and its link; the earlier target snapshot is not stitched back in.
      const fromKey = plainSessionRefKey(maintainer.value.line);
      const fromLinkKey = sessionWorkLinkRefKey(maintainer.value.link.ref);
      const toKey = sessionAggregateRefKey(plainSessionRefToAggregate(targetLine.ref));
      const toLinkKey = sessionWorkLinkRefKey(responsibleLinkRef(input.line, { kind: 'module', ref: input.module }));
      const rows = await deps.records.readMany([fromKey, fromLinkKey, toKey, toLinkKey]);
      if (rows.status !== 'ready') return storeFailureToRejection(rows);
      const fromRecord = rows.value.records.find((record) => record.refKey === fromKey);
      const fromLinkRecord = rows.value.records.find((record) => record.refKey === fromLinkKey);
      if (fromRecord !== undefined && fromLinkRecord !== undefined) {
        const decodedSession = decodeSessionRecord(fromRecord);
        const decodedLink = decodeSessionWorkLink(fromLinkRecord);
        if (decodedSession.status !== 'decoded') {
          return rejected('unavailable', `the maintainer line is damaged: ${decodedSession.reason}`);
        }
        if (decodedLink.status !== 'decoded') {
          return rejected('unavailable', `the maintainer link is damaged: ${decodedLink.reason}`);
        }
        from = { session: decodedSession.value, link: decodedLink.value };
      }
      const toRecord = rows.value.records.find((record) => record.refKey === toKey);
      if (toRecord === undefined) return rejected('not_found', 'the maintainer line does not exist');
      const decodedLine = decodeSessionRecord(toRecord);
      if (decodedLine.status !== 'decoded') {
        return rejected('unavailable', `the maintainer line is damaged: ${decodedLine.reason}`);
      }
      line = decodedLine.value;
      const toLinkRecord = rows.value.records.find((record) => record.refKey === toLinkKey);
      lineLink = null;
      if (toLinkRecord !== undefined) {
        const decodedLink = decodeSessionWorkLink(toLinkRecord);
        if (decodedLink.status !== 'decoded') {
          return rejected('unavailable', `the maintainer link is damaged: ${decodedLink.reason}`);
        }
        lineLink = decodedLink.value;
      }
    }
    return { line, duty: duty.value, maintainer: maintainer.value, lineLink, from, moduleInCatalog: true };
  }

  async function assignModuleMaintainer(
    ctx: CoreCallContext, request: GraphWrite<AssignMaintainerInputV1>, caller: MaintainerCallerV1,
  ): Promise<WriteResult<SessionWorkLink>> {
    const scopeError = maintainerScopeProblem(ctx);
    if (scopeError !== null) return scopeError;
    if (!isRecord(request) || !isRecord(request.input) || !isRecord(request.meta)) {
      return rejected('invalid', 'the assign maintainer request requires its input and meta');
    }
    const input = structuredClone(request.input);
    if (checkShape(ModuleRefShape, input.module, 'stored') !== null
      || checkShape(SessionRefShape, input.line, 'stored') !== null) {
      return rejected('invalid', 'the assign maintainer request requires a complete module and line');
    }
    if (input.module.projectId !== ctx.projectId || input.line.projectId !== ctx.projectId) {
      return rejected('forbidden', 'the maintainer module or line belongs to another project');
    }
    const scope: WorkspaceScope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId! };
    const target: WorkLinkTarget = { kind: 'module', ref: input.module };
    const targetLinkRef = responsibleLinkRef(input.line, target);
    const targetLinkKey = sessionWorkLinkRefKey(targetLinkRef);
    const lineKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.line));

    type Facts = AssignMaintainerFactsV1;

    const result = await executeWriteCommand<Facts, AssignDecision, AssignMaintainerRefusalV1,
      SessionWorkLinkChangedEventV1, SessionWorkLink>(deps.records, {
      operation: ASSIGN_OPERATION,
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      principal: principalIdentity(ctx.principal),
      commandId: request.meta.requestId,
      fingerprintInput: {
        expected: request.meta.expected,
        module: { projectId: input.module.projectId, moduleId: input.module.moduleId },
        line: { projectId: input.line.projectId, sessionId: input.line.sessionId },
        caller,
      } as unknown as JsonValue,
      read: async () => {
        if (caller.kind === 'trusted') {
          const operationRef = caller.proof.branch === 'approved_answer'
            ? caller.proof.proof.operation : caller.proof.authorization.operation;
          const stored = await readMaintainerAssignmentOperation(deps.records, operationRef);
          if (stored.status === 'rejected') return stored;
          if (stored.status !== 'ready') {
            return rejected('unavailable', 'the maintainer assignment operation is not readable');
          }
          if (stored.value === null) {
            return rejected('unavailable', 'the maintainer assignment operation does not exist');
          }
          const binding = maintainerBindingOfOperation(stored.value);
          const checked = maintainerCallBindingOf(caller.proof, binding);
          if (checked.status !== 'ready') {
            return checked.status === 'rejected'
              ? checked : rejected('forbidden', 'the maintainer call is not admitted');
          }
          if (canonicalKey(input.module) !== canonicalKey(binding.moduleRef)) {
            return rejected('forbidden', 'maintainer_call_mismatch: the maintainer call names a different moduleRef');
          }
          if (canonicalKey(input.line) !== canonicalKey(binding.line)) {
            return rejected('forbidden', 'maintainer_call_mismatch: the maintainer call names a different line');
          }
        }
        const snapshot = await readLineSnapshot(scope, input.line, target);
        if ('status' in snapshot) return snapshot;
        const facts = await readAssignFacts(ctx, scope, input, snapshot.line, snapshot.link);
        if ('status' in facts) return facts;
        return { status: 'ready', facts };
      },
      decide: (facts) => {
        const decided = assignMaintainerDecision(facts);
        return 'refuse' in decided ? { refuse: decided.refuse } : { decision: decided.decision };
      },
      build: async (decision, keys) => {
        const at = now();
        if (decision.kind === 'open') {
          const line = decision.line;
          const currentLink = decision.currentLink;
          const guard: SessionGuardContext = {
            caller: 'service', hostLease: null, pin: null, holder: null, probe: null, kernelHeader: null,
            openResponsibleLink: null, creation: null,
            link: {
              exists: currentLink !== null, open: currentLink !== null && currentLink.until === null,
              targetValid: true, pin: currentLink?.revision ?? null,
            },
          };
          const verdict = transitionSession(sessionMachineStateOf(line), { kind: 'work_linked', active: true }, guard);
          if (!verdict.ok) return rejected(verdict.code, verdict.detail);
          let nextSession: SessionRecord | null = null;
          let bound: 'since' | 'until' | null = null;
          for (const effect of verdict.effects) {
            if (effect.kind === 'bump_session_revision') nextSession = { ...line, revision: line.revision + 1 };
            if (effect.kind === 'write_work_link') bound = effect.bound;
          }
          if (nextSession === null || bound !== 'since') {
            throw new Error('an accepted work link write bumps the Session and binds the link');
          }
          const nextLink = {
            ref: targetLinkRef, revision: (currentLink?.revision ?? 0) + 1, since: null, until: null,
          };
          const event: SessionWorkLinkChangedEventV1 = {
            eventId: eventIdOf(keys.identityKey, 'link'), eventType: SESSION_WORK_LINK_CHANGED_EVENT,
            schemaVersion: 1, occurredAt: at, projectId: scope.projectId, workspaceId: scope.workspaceId,
            sessionRef: plainSessionRef(input.line), sessionRevision: nextSession.revision,
            active: true, link: nextLink, boundField: 'since',
          };
          const claims = await scopeClaimChangesOf(ctx, deps.duty, nextSession, [], [targetLinkRef]);
          if (!claims.ok) return claims.rejection;
          const contribution = roleLineCommitContribution({
            projectRef: { projectId: scope.projectId },
            records: [encodeSessionRecord(nextSession)],
            guards: [
              { refKey: lineKey, expectedRevision: line.revision },
              { refKey: targetLinkKey, expectedRevision: currentLink?.revision ?? null },
            ],
            links: [{ link: targetLinkRef, next: nextLink }],
            claimChanges: claims.changes,
            bindings: [{ link: targetLinkRef, field: 'since' }],
            events: [encodeSessionWorkLinkChangedEvent(event)],
            allocation: null,
          }, null);
          if (!contribution.ok) return contribution.rejection;
          return contribution.fragment;
        }

        const source = decision.from;
        const destination = decision.to;
        const state = {
          source, destination,
          sourceLink: decision.sourceLink, destinationLink: decision.destinationLink,
        };
        const guard: ResponsibilityGuardV1 = {
          sameScope: destination.workspaceId === source.workspaceId,
          targetValid: true, taskTerminal: false, writerStopped: true,
          destinationEligible: destinationEligible(destination), pinsMatch: true,
        };
        const verdict = transitionResponsibility(
          state, { kind: 'responsibility_transferred', to: plainSessionRef(destination.ref) }, guard);
        if (!verdict.ok) return rejected(verdict.code, verdict.detail);
        const effect = verdict.effects.find((entry) => entry.kind === 'write_responsibility');
        if (effect === undefined || effect.kind !== 'write_responsibility') {
          throw new Error('a maintainer transfer must write the responsibility links');
        }
        const closeClaims = await scopeClaimChangesOf(ctx, deps.duty, effect.source, [effect.closed.ref], []);
        if (!closeClaims.ok) return closeClaims.rejection;
        const openClaims = effect.opened !== null && effect.openedBound !== null
          ? await scopeClaimChangesOf(ctx, deps.duty, effect.destination!, [], [effect.opened.ref]) : null;
        if (openClaims !== null && !openClaims.ok) return openClaims.rejection;
        const claimChanges = foldRoleScopeClaimChanges({ projectId: scope.projectId },
          [...closeClaims.changes, ...(openClaims?.changes ?? [])]);
        const sourceKey = sessionAggregateRefKey(plainSessionRefToAggregate(source.ref));
        const destinationKey = sessionAggregateRefKey(plainSessionRefToAggregate(destination.ref));
        const sourceLinkKey = sessionWorkLinkRefKey(effect.closed.ref);
        const destinationLinkKey = effect.opened === null ? null : sessionWorkLinkRefKey(effect.opened.ref);
        const closeEvent: SessionWorkLinkChangedEventV1 = {
          eventId: eventIdOf(keys.identityKey, 'link:close'), eventType: SESSION_WORK_LINK_CHANGED_EVENT,
          schemaVersion: 1, occurredAt: at, projectId: scope.projectId, workspaceId: scope.workspaceId,
          sessionRef: plainSessionRef(effect.source.ref), sessionRevision: effect.source.revision,
          active: false, link: effect.closed, boundField: 'until',
        };
        if (effect.opened === null || effect.openedBound === null) {
          throw new Error('a maintainer transfer opens the destination link');
        }
        const openEvent: SessionWorkLinkChangedEventV1 = {
          eventId: eventIdOf(keys.identityKey, 'link'), eventType: SESSION_WORK_LINK_CHANGED_EVENT,
          schemaVersion: 1, occurredAt: at, projectId: scope.projectId, workspaceId: scope.workspaceId,
          sessionRef: plainSessionRef(effect.destination!.ref), sessionRevision: effect.destination!.revision,
          active: true, link: effect.opened, boundField: 'since',
        };
        const records = [encodeSessionRecord(effect.source), encodeSessionRecord(effect.destination!)];
        const contribution = roleLineCommitContribution({
          projectRef: { projectId: scope.projectId },
          records,
          guards: [
            { refKey: sourceKey, expectedRevision: source.revision },
            { refKey: destinationKey, expectedRevision: destination.revision },
            { refKey: sourceLinkKey, expectedRevision: decision.sourceLink.revision },
            { refKey: destinationLinkKey!, expectedRevision: decision.destinationLink?.revision ?? null },
          ],
          links: [
            { link: effect.closed.ref, next: effect.closed },
            { link: effect.opened.ref, next: effect.opened },
          ],
          claimChanges,
          bindings: [
            { link: effect.closed.ref, field: 'until' },
            { link: effect.opened.ref, field: 'since' },
          ],
          events: [encodeSessionWorkLinkChangedEvent(closeEvent), encodeSessionWorkLinkChangedEvent(openEvent)],
          allocation: null,
        }, null);
        if (!contribution.ok) return contribution.rejection;
        return contribution.fragment;
      },
      result: {
        eventType: SESSION_WORK_LINK_CHANGED_EVENT,
        schemaVersion: 1,
        decode: (event) => sessionWorkLinkChangedPayloadFromEvent(event),
        validate(event, receipt) {
          if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
            return 'the recorded link event belongs to another scope';
          }
          if (event.sessionRef.projectId !== input.line.projectId
            || event.sessionRef.sessionId !== input.line.sessionId) {
            return 'the recorded link event belongs to another Session';
          }
          if (canonicalKey(event.link.ref) !== canonicalKey(targetLinkRef)) {
            return 'the recorded link event belongs to another target or relation';
          }
          if (event.active !== true) return 'the recorded link event is not an open';
          const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.line));
          const sessionVersion = receipt.versions.find((entry) => entry.refKey === sessionKey);
          if (sessionVersion === undefined || sessionVersion.revision !== event.sessionRevision) {
            return 'the recorded link event disagrees with the receipt Session version';
          }
          const linkVersion = receipt.versions.find((entry) => entry.refKey === targetLinkKey);
          if (linkVersion === undefined || linkVersion.revision !== event.link.revision) {
            return 'the recorded link event disagrees with the receipt link version';
          }
          return null;
        },
        project: (event, cursor) => ({
          ref: event.link.ref,
          revision: event.link.revision,
          since: event.boundField === 'since' ? cursor : event.link.since as CommitCursor,
          until: null,
        }),
      },
    });
    if (result.status === 'refused') {
      if ('kind' in result.refusal) {
        return { status: 'committed', value: result.refusal.link, replayed: true, cursor: result.refusal.link.since };
      }
      return result.refusal;
    }
    if (result.status === 'rejected') {
      const store = result.cause !== undefined && 'store' in result.cause ? result.cause.store : null;
      if (store !== null && store.code === 'unique_conflict') {
        const mapped = maintainerClaimConflictOf(store.current);
        if (mapped !== null) return mapped;
      }
      return rejectedWithCurrent(result.code, result.reason, result.current);
    }
    return result;
  }

  // ------------------------------------------------------------------------
  // The operation owner: the request entry, the stage writes and the answer
  // ------------------------------------------------------------------------

  async function writeMaintainerAccepted(
    ctx: CoreCallContext, input: MaintainerAssignmentRequestV1, ref: OperationRef,
    actionInput: MaintainerAssignmentOperationV1['action']['input'],
    workspace: WorkspaceScope,
  ): Promise<{ record: MaintainerAssignmentOperationV1 } | CoreRejection> {
    let built: MaintainerAssignmentOperationV1 | null = null;
    const result = await executeWriteCommand<null, null, CoreRejection,
      MaintainerAssignmentRecordedEventV1, { ref: OperationRef }>(deps.records, {
      operation: REQUEST_OPERATION,
      scope: { projectId: workspace.projectId, workspaceId: workspace.workspaceId },
      principal: principalIdentity(ctx.principal),
      commandId: input.commandId,
      fingerprintInput: {
        workspace, caller: input.caller, moduleRef: input.moduleRef, line: input.line, reason: input.reason,
      } as unknown as JsonValue,
      read: async () => ({ status: 'ready' as const, facts: null }),
      decide: () => ({ decision: null }),
      build: (_decision, keys) => {
        const record = acceptedRecord({ ref, workspaceId: workspace.workspaceId, at: now(), actionInput });
        built = record;
        return {
          guards: [{ refKey: operationRefKey(ref), expectedRevision: null }],
          records: [encodeSessionOperationRecord(record)],
          events: [operationEvent(record, eventIdOf(keys.identityKey, 'accepted'), record.requestedAt)],
          claims: [],
        };
      },
      result: {
        eventType: 'MaintainerAssignmentRecorded',
        schemaVersion: 1,
        decode: (event) => maintainerAssignmentRecordedCodec.decode(event),
        validate(event, _receipt, keys) {
          if (operationRefKey(event.operationRef) !== operationRefKey(ref)) return 'the event records another operation';
          if (event.revision !== 1) return 'the event records another revision';
          if (canonicalKey(event.action.input) !== canonicalKey(actionInput)) return 'the event records another input';
          if (event.action.progress.stage !== 'accepted') return 'the event records another stage';
          if (event.eventId !== eventIdOf(keys.identityKey, 'accepted')) return 'the event records another id';
          return null;
        },
        project: (event) => ({ ref: event.operationRef }),
      },
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status !== 'committed') return rejectedWithCurrent(result.code, result.reason, result.current);
    if (result.replayed) {
      const current = await readMaintainerAssignmentOperation(deps.records, ref);
      if (current.status === 'rejected') return current;
      if (current.status !== 'ready') {
        return rejected('unavailable', 'the committed maintainer request is not readable');
      }
      if (current.value === null) return rejected('unavailable', 'the committed maintainer request has no operation');
      return { record: current.value };
    }
    return { record: built! };
  }

  async function writeMaintainerStage(
    ctx: CoreCallContext, command: { operation: string; commandId: string; fingerprintInput: JsonValue },
    current: MaintainerAssignmentOperationV1,
    stage: 'awaiting_decision' | 'done' | 'rejected',
    makeNext: (at: string) => MaintainerAssignmentOperationV1,
    actor?: ActorRef, proof?: DecisionChangeProofV1,
  ): Promise<WriteResult<MaintainerAssignmentOperationV1>> {
    let built: MaintainerAssignmentOperationV1 | null = null;
    const result = await executeWriteCommand<MaintainerAssignmentOperationV1, null, CoreRejection,
      MaintainerAssignmentRecordedEventV1, { ref: OperationRef; revision: number }>(deps.records, {
      operation: command.operation,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: command.commandId,
      fingerprintInput: command.fingerprintInput,
      read: () => Promise.resolve({ status: 'ready' as const, facts: current }),
      decide: () => ({ decision: null }),
      build: (_decision, keys) => {
        const next = makeNext(now());
        built = next;
        return {
          guards: [{ refKey: operationRefKey(current.ref), expectedRevision: current.revision }],
          records: [encodeSessionOperationRecord(next)],
          events: [operationEvent(next, eventIdOf(keys.identityKey, stage), next.updatedAt, actor, proof)],
          claims: [],
        };
      },
      result: {
        eventType: 'MaintainerAssignmentRecorded',
        schemaVersion: 1,
        decode: (event) => maintainerAssignmentRecordedCodec.decode(event),
        validate(event, receipt) {
          if (operationRefKey(event.operationRef) !== operationRefKey(current.ref)) {
            return 'the event records another operation';
          }
          if (event.revision !== current.revision + 1) return 'the event records another revision';
          if (event.action.progress.stage !== stage) return 'the event records another stage';
          const version = receipt.versions.find((entry) => entry.refKey === operationRefKey(current.ref));
          if (version === undefined || version.revision !== event.revision) {
            return 'the receipt carries no such operation version';
          }
          return null;
        },
        project: (event) => ({ ref: event.operationRef, revision: event.revision }),
      },
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status !== 'committed') return rejectedWithCurrent(result.code, result.reason, result.current);
    if (result.replayed) {
      const read = await readMaintainerAssignmentOperation(deps.records, current.ref);
      if (read.status === 'rejected') return read;
      if (read.status !== 'ready') {
        return rejected('unavailable', 'the committed maintainer stage is not readable');
      }
      if (read.value === null) return rejected('unavailable', 'the committed maintainer stage has no operation');
      return { ...result, value: read.value };
    }
    return { ...result, value: built! };
  }

  async function modeOf(ctx: CoreCallContext, operation: MaintainerAssignmentOperationV1):
    Promise<'needs_decision' | 'automatic' | CoreRejection> {
    const caller = operation.action.input.caller;
    const runRead = await deps.executions.readExecution(platformCheckContext(ctx, MAINTAINER_SYSTEM_ACTOR),
      structuredClone(caller.run));
    if (runRead.status === 'rejected') return runRead;
    if (runRead.status !== 'ready') return rejected('unavailable', 'the maintainer caller Run is not readable');
    const goalRef: GoalRef = {
      aggregateType: 'Goal', projectId: runRead.value.run.ref.projectId, goalId: runRead.value.run.ref.goalId,
    };
    const settingsRead = await deps.goalSettings.readGoalSettings(ctx, { goalRef });
    if (settingsRead.status === 'rejected') return settingsRead;
    if (settingsRead.status !== 'ready') {
      return rejected('unavailable', 'the maintainer Goal settings are not readable');
    }
    const verdict = decisionActionPolicy({
      autonomy: settingsRead.value.settings.autonomy, action: 'module_maintainer',
      actorClass: 'system', countedNext: null, cap: 0,
    });
    return verdict === 'needs_decision' ? 'needs_decision' : 'automatic';
  }

  async function noticeOf(ctx: CoreCallContext, operation: MaintainerAssignmentOperationV1,
    line: SessionRef): Promise<void> {
    try {
      await deps.notifyProject({
        projectRef: { projectId: ctx.projectId }, kind: 'module_maintainer_assigned',
        // The person reads the module's own id; the record keeps the project view (kls-design §2.3.4).
        summary: `模块维护者：${truncateUtf8(rawModuleRef(operation.action.input.moduleRef).moduleId, 244)} ← ${truncateUtf8(line.sessionId, 244)}`,
        operation: structuredClone(operation.ref),
      });
    } catch {
      // A committed assignment is never rewritten as a failure; the notice's operation identity makes its replay safe.
    }
  }

  async function requestAssignment(ctx: CoreCallContext, rawInput: MaintainerAssignmentRequestV1):
    Promise<MaintainerAssignmentToolResultV1> {
    const scopeError = maintainerScopeProblem(ctx);
    if (scopeError !== null) return scopeError;
    if (!isRecord(rawInput) || !nonEmpty(rawInput.commandId)) {
      return rejected('invalid', 'a maintainer request requires a non-empty commandId');
    }
    const input = structuredClone(rawInput);
    if (checkShape(ModuleRefShape, input.moduleRef, 'stored') !== null
      || checkShape(SessionRefShape, input.line, 'stored') !== null) {
      return rejected('invalid', 'a maintainer request requires a complete module and line');
    }
    if (input.moduleRef.projectId !== ctx.projectId || input.line.projectId !== ctx.projectId) {
      return rejected('forbidden', 'the maintainer module or line belongs to another project');
    }
    const workspace: WorkspaceScope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId! };
    // The caller names the module in its own workspace's frame; the claim and the link keep the project view
    // (kls-design §2.3.4).
    const viewed = await scopesInProjectView(deps.records, ctx.projectId, workspace.workspaceId,
      [{ kind: 'region', moduleRef: input.moduleRef }]);
    if (viewed.status !== 'ready') return viewed;
    input.moduleRef = (viewed.value[0] as Extract<RoleScopeV1, { kind: 'region' }>).moduleRef;
    const actionInput: MaintainerAssignmentOperationV1['action']['input'] = {
      moduleRef: structuredClone(input.moduleRef), line: structuredClone(input.line),
      reason: input.reason, caller: structuredClone(input.caller),
    };
    const shapeProblem = checkShape(MaintainerAssignmentActionShape,
      acceptedMaintainerAssignment(actionInput).action, 'stored');
    if (shapeProblem !== null) return rejected('invalid', shapeProblem);
    const identityKey = commandIdentity({
      operation: REQUEST_OPERATION,
      scope: { projectId: workspace.projectId, workspaceId: workspace.workspaceId },
      principal: principalIdentity(ctx.principal), commandId: input.commandId,
    });
    const ref: OperationRef = {
      aggregateType: 'CoreOperation', projectId: workspace.projectId,
      operationId: `maintainer-${identityKey.slice(`${REQUEST_OPERATION}:`.length)}`,
    };
    const accepted = await writeMaintainerAccepted(ctx, input, ref, actionInput, workspace);
    if ('status' in accepted) return accepted;
    const operation = accepted.record;
    const progress = operation.action.progress;
    if (progress.stage === 'done') {
      return await assignedResult(ctx, operation);
    }
    if (progress.stage === 'awaiting_decision') {
      return { status: 'needs_decision', cardKey: progress.decision!.cardKey! };
    }
    if (progress.stage === 'rejected' || progress.stage === 'stale') {
      return rejected(progress.lastRefusal === null ? 'source_stale' : 'invalid',
        progress.lastRefusal?.reason ?? 'the maintainer assignment is stale');
    }
    const mode = await modeOf(ctx, operation);
    if (typeof mode !== 'string') return mode;
    if (mode === 'needs_decision') {
      const cardKey = decisionSourceKey({ kind: 'module_maintainer_assignment', operationRef: operation.ref });
      const written = await writeMaintainerStage(ctx, maintainerStageCommand(operation.ref, operation.revision + 1, 'awaiting_decision'),
        operation, 'awaiting_decision',
        (at) => advancedRecord(operation, at, { kind: 'awaiting_decision', cardKey }));
      if (written.status !== 'committed') return written;
      const current = written.value;
      if (current.action.progress.stage === 'awaiting_decision') {
        return { status: 'needs_decision', cardKey: current.action.progress.decision!.cardKey! };
      }
      return await assignedResult(ctx, current);
    }
    const binding = maintainerBindingOfOperation(operation);
    const assigned = await assignModuleMaintainer(ctx, {
      meta: { requestId: `${operation.ref.operationId}:assign`, expected: [] },
      input: { module: binding.moduleRef, line: binding.line },
    }, { kind: 'trusted', proof: { branch: 'current_authorization', authorization: {
      kind: 'maintainer_assignment', projectRef: { projectId: ctx.projectId },
      operation: binding.operation, moduleRef: binding.moduleRef, line: binding.line,
      since: operation.requestedAt,
    } } });
    if (assigned.status !== 'committed') return assigned;
    const written = await writeMaintainerStage(ctx, maintainerStageCommand(operation.ref, operation.revision + 1, 'done'),
      operation, 'done',
      (at) => advancedRecord(operation, at, {
        kind: 'auto_applied', outcome: { kind: 'assigned', link: assigned.value.ref },
      }), operation.action.input.caller.actor);
    if (written.status !== 'committed') return written;
    await noticeOf(ctx, operation, binding.line);
    return { status: 'assigned', line: plainSessionRef(binding.line) };
  }

  async function readDoneLink(operation: MaintainerAssignmentOperationV1):
    Promise<SessionWorkLink | CoreRejection> {
    const linkRef = operation.action.progress.outcome?.link;
    if (linkRef === undefined) return rejected('unavailable', 'a done maintainer operation has no outcome');
    const key = sessionWorkLinkRefKey(linkRef);
    const read = await deps.records.readMany([key]);
    if (read.status !== 'ready') return storeFailureToRejection(read);
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record === undefined) return rejected('unavailable', 'the maintainer outcome link is missing');
    const decoded = decodeSessionWorkLink(record);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `the maintainer outcome link is damaged: ${decoded.reason}`);
    }
    return decoded.value;
  }

  async function assignedResult(ctx: CoreCallContext, operation: MaintainerAssignmentOperationV1):
    Promise<MaintainerAssignmentToolResultV1> {
    const link = await readDoneLink(operation);
    if ('status' in link) return link;
    if (operation.action.progress.decision?.verdict === 'automatic') {
      await noticeOf(ctx, operation, plainSessionRef(operation.action.input.line));
    }
    return { status: 'assigned', line: plainSessionRef(operation.action.input.line) };
  }

  async function applyMaintainerAssignmentDecision(
    ctx: CoreCallContext, rawInput: MaintainerAssignmentDecisionInputV1,
    caller: Extract<MaintainerCallerV1, { kind: 'trusted' }>,
  ): Promise<Awaited<ReturnType<ModuleMaintainerPort['applyMaintainerAssignmentDecision']>>> {
    const scopeError = maintainerScopeProblem(ctx);
    if (scopeError !== null) return scopeError;
    if (!isRecord(rawInput) || !nonEmpty(rawInput.commandId)) {
      return rejected('invalid', 'a maintainer decision requires a non-empty commandId');
    }
    const input = structuredClone(rawInput);
    if (checkShape(OperationRefShape, input.operation, 'stored') !== null) {
      return rejected('invalid', 'a maintainer decision requires a CoreOperation ref');
    }
    if (input.verdict !== 'approve' && input.verdict !== 'reject') {
      return rejected('invalid', 'a maintainer decision is approve or reject');
    }
    if (checkShape(SessionMessageRefShape, input.answer, 'stored') !== null) {
      return rejected('invalid', 'the maintainer answer is invalid');
    }
    if (input.answer.projectId !== ctx.projectId
      || (ctx.workspaceId !== undefined && input.answer.workspaceId !== ctx.workspaceId)) {
      return rejected('forbidden', 'the maintainer answer belongs to another workspace');
    }
    const read = await readMaintainerAssignmentOperation(deps.records, input.operation);
    if (read.status === 'rejected') return read;
    if (read.status !== 'ready') {
      return rejected('unavailable', 'the maintainer assignment operation is not readable');
    }
    if (read.value === null) return rejected('unavailable', 'the maintainer assignment operation does not exist');
    const operation = read.value;
    const stage = operation.action.progress.stage;
    if (stage === 'done') {
      const link = await readDoneLink(operation);
      if ('status' in link) return link;
      const receipt = await doneReceipt(ctx, operation);
      if ('status' in receipt) return receipt;
      return { status: 'done', operation: structuredClone(operation.ref), link, receipt };
    }
    if (stage === 'rejected') {
      const refusal = operation.action.progress.lastRefusal;
      return {
        status: 'rejected', operation: structuredClone(operation.ref),
        code: storeFailureCode({ code: refusal?.code ?? 'invalid' }),
        reason: refusal?.reason ?? 'the maintainer assignment was rejected',
      };
    }
    if (stage !== 'awaiting_decision') return { status: 'stale', operation: structuredClone(operation.ref) };

    if (input.verdict === 'reject') {
      const written = await writeMaintainerStage(ctx, maintainerStageCommand(operation.ref, operation.revision + 1, 'rejected'),
        operation, 'rejected',
        (at) => advancedRecord(operation, at, {
          kind: 'decided', answer: 'reject', answerRef: structuredClone(input.answer),
        }), caller.proof.branch === 'approved_answer' ? caller.proof.proof.approvedBy : undefined);
      if (written.status !== 'committed') return written;
      const current = written.value;
      const refusal = current.action.progress.lastRefusal;
      return {
        status: 'rejected', operation: structuredClone(current.ref),
        code: storeFailureCode({ code: refusal?.code ?? 'invalid' }),
        reason: refusal?.reason ?? 'the maintainer assignment was rejected',
      };
    }

    const assigned = await assignModuleMaintainer(ctx, {
      meta: { requestId: input.commandId, expected: [] },
      input: { module: operation.action.input.moduleRef, line: operation.action.input.line },
    }, caller);
    if (assigned.status !== 'committed') return assigned;
    const before: VersionPin = { ref: structuredClone(operation.ref), revision: operation.revision };
    const after: VersionPin = { ref: structuredClone(operation.ref), revision: operation.revision + 1 };
    const formal: DecisionChangeProofV1 = {
      acknowledgementRef: structuredClone(input.answer),
      capturedPins: [structuredClone(before)],
      changes: [{ before: structuredClone(before), after: structuredClone(after) }],
      basisRebases: [],
    };
    const written = await writeMaintainerStage(ctx, maintainerStageCommand(operation.ref, operation.revision + 1, 'done'),
      operation, 'done',
      (at) => advancedRecord(operation, at, {
        kind: 'decided', answer: 'approve', answerRef: structuredClone(input.answer), stale: false,
        outcome: { kind: 'assigned', link: assigned.value.ref },
      }),
      caller.proof.branch === 'approved_answer' ? caller.proof.proof.approvedBy : undefined, formal);
    if (written.status !== 'committed') return written;
    const current = written.value;
    const keys = commandKeys({
      operation: STAGE_OPERATION,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: maintainerStageCommand(current.ref, current.revision, 'done').commandId,
      fingerprintInput: maintainerStageCommand(current.ref, current.revision, 'done').fingerprintInput,
    });
    return {
      status: 'done', operation: structuredClone(current.ref), link: assigned.value,
      receipt: { identityKey: keys.identityKey, fingerprint: keys.fingerprint, cursor: written.cursor },
    };
  }

  /** The done stage's own receipt, read by its deterministic stage identity; no write and no later stage. */
  async function doneReceipt(ctx: CoreCallContext, operation: MaintainerAssignmentOperationV1):
    Promise<DecisionApplicationReceiptV1 | CoreRejection> {
    const command = maintainerStageCommand(operation.ref, operation.revision, 'done');
    const keys = commandKeys({
      operation: command.operation,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(ctx.principal),
      commandId: command.commandId, fingerprintInput: command.fingerprintInput,
    });
    const read = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    if (read.status !== 'found') {
      return read.status === 'missing'
        ? rejected('unavailable', 'the maintainer done stage commit is missing')
        : rejected('unavailable', `the maintainer done stage receipt is unavailable: ${read.reason}`);
    }
    return { identityKey: keys.identityKey, fingerprint: keys.fingerprint, cursor: read.receipt.cursor };
  }

  return {
    maintainerOf,
    assignModuleMaintainer,
    applyMaintainerAssignmentDecision,
    requestAssignment,
  };
}

