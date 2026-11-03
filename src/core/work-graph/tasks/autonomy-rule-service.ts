/**
 * L37 autonomy rules: the one read and the three person-only commands (create, revoke, update). Each write is one
 * commit of the shared R2 executor (`persistence/command-executor.ts`): the rule record and the project's rule set,
 * whose revision every write bumps, plus one `AutonomyRuleSetChanged` event appended last, because the receipt check
 * reads its last event. The result is the view re-read after the commit, never projected from the event.
 *
 * The pure validation, match and next set revision are `state/autonomy-rules.ts`; the records, the event and their
 * codecs are the role-line ones (`contracts/role-lines.ts`, `sessions/role-line-orchestration-codecs.ts`). The read
 * has no person check: the policy's owners read the same rules through it.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { canonicalJson, canonicalKey, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RuleActionV1 } from '../../../contracts/goal-decisions.js';
import {
  AUTONOMY_RULES_BY_PROJECT_LOOKUP, ROLE_LINE_DEFAULT_LIMITS,
  type AutonomyRuleSetV1, type AutonomyRuleV1, type RoleLimitsNumbersV1, type RoleScopeV1,
} from '../../../contracts/role-lines.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { executeWriteCommand } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { sessionStoreFailureToRejection, storeFailureToRejection } from '../persistence/read-result-failures.js';
import {
  nextAutonomyRuleSetRevision, validateAutonomyRule, type AutonomyRuleLimitsV1,
} from '../state/autonomy-rules.js';
import {
  autonomyRuleCodec, autonomyRuleSetChangedCodec, autonomyRuleSetCodec,
} from '../sessions/role-line-orchestration-codecs.js';
import type { RoleLimitsPort } from '../sessions/role-limits-service.js';
import { eventIdOf, trustedContext, type TrustedContext } from '../sessions/trusted-context.js';

export type AutonomyRuleCreateRequestV1 = {
  commandId: string; actions: readonly RuleActionV1[]; scope: readonly RoleScopeV1[];
  limits: AutonomyRuleLimitsV1; expiresAt: string | null;
  approvedFrom: { cardKey: string; answerMessageRef: SessionMessageRef } | null;
};
export type AutonomyRuleRevokeRequestV1 = {
  commandId: string; ruleId: string; expectedRevision: number; expectedSetRevision: number;
};
export type AutonomyRuleUpdateRequestV1 = {
  commandId: string; ruleId: string; expectedRevision: number; expectedSetRevision: number;
  expiresAt: string | null;
};
export type AutonomyRuleViewV1 = { set: AutonomyRuleSetV1; rules: AutonomyRuleV1[] };

export interface AutonomyRulePort {
  read(ctx: CoreCallContext, input: { projectRef: ProjectScope }):
    Promise<ReadResult<AutonomyRuleViewV1>>;
  create(ctx: CoreCallContext, request: AutonomyRuleCreateRequestV1):
    Promise<WriteResult<AutonomyRuleViewV1>>;
  revoke(ctx: CoreCallContext, request: AutonomyRuleRevokeRequestV1):
    Promise<WriteResult<AutonomyRuleViewV1>>;
  update(ctx: CoreCallContext, request: AutonomyRuleUpdateRequestV1):
    Promise<WriteResult<AutonomyRuleViewV1>>;
}

/** `limits` gives the project's open cap a new rule is checked against; an absent limits record is the defaults. */
export type AutonomyRuleServiceDependenciesV1 = {
  records: GoalRecordTransactionPort & Pick<RecordLookupPort, 'lookup'>;
  now: () => Date;
  limits: Pick<RoleLimitsPort, 'readRoleLimits'>;
};

type RuleFacts = { set: AutonomyRuleSetV1 | null; rule: AutonomyRuleV1 | null };
type RuleDecision = { rule: AutonomyRuleV1; ruleGuard: number | null; setGuard: number | null; setRevision: number };
type TrustedScope = Extract<TrustedContext, { ok: true }>;

export function createAutonomyRuleService(deps: AutonomyRuleServiceDependenciesV1): AutonomyRulePort {
  async function read(
    _ctx: CoreCallContext, input: { projectRef: ProjectScope },
  ): Promise<ReadResult<AutonomyRuleViewV1>> {
    const projectRef: ProjectScope = { projectId: input.projectRef.projectId };
    const facts = await readRuleFacts(deps.records, projectRef.projectId, null);
    if (facts.status !== 'ready') return facts;
    let batch;
    try {
      batch = await lookupAll(deps.records, AUTONOMY_RULES_BY_PROJECT_LOOKUP, [projectRef.projectId]);
    } catch (failure) {
      return storeFailureToRejection(failure);
    }
    const rules: AutonomyRuleV1[] = [];
    for (const record of batch.items) {
      const decoded = autonomyRuleCodec.decode(record);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `an autonomy rule is damaged: ${decoded.reason}`);
      }
      rules.push(decoded.value);
    }
    // No set yet is revision 0 with no rule, the same absence the role limits read answers.
    return { status: 'ready', value: {
      set: facts.value.set ?? { ref: ruleSetRef(projectRef.projectId), projectRef, revision: 0 }, rules } };
  }

  /** The one commit of the three writes: the rule, the set at its next revision, the event last, then the re-read. */
  async function commitRuleChange(ctx: CoreCallContext, trusted: TrustedScope, input: {
    kind: 'create' | 'revoke' | 'update'; commandId: string; fingerprintInput: JsonValue; ruleId: string;
    /** The rule facts and the project's current open cap, both read after the receipt check. */
    next(facts: RuleFacts & { projectOpen: RoleLimitsNumbersV1 }):
      { refuse: CoreRejection } | { decision: RuleDecision };
  }): Promise<WriteResult<AutonomyRuleViewV1>> {
    const projectId = trusted.scope.projectId;
    const workspaceId = trusted.scope.workspaceId;
    const committed = await executeWriteCommand(deps.records, {
      operation: `autonomy-rules:${input.kind}`, principal: ctx.principal, commandId: input.commandId,
      scope: { projectId, workspaceId },
      fingerprintInput: input.fingerprintInput,
      read: async () => {
        const facts = await readRuleFacts(deps.records, projectId, input.ruleId);
        if (facts.status !== 'ready') return facts;
        const limits = await deps.limits.readRoleLimits(ctx, { projectRef: { projectId } });
        if (limits.status !== 'ready') {
          return limits.status === 'rejected' ? limits
            : rejected('unavailable', `the role limits read answered ${limits.status}`);
        }
        return { status: 'ready', facts: { ...facts.value, projectOpen: limits.value.open } };
      },
      decide: (facts) => input.next(facts),
      build: (decision, keys) => {
        const set: AutonomyRuleSetV1 = { ref: ruleSetRef(projectId), projectRef: { projectId },
          revision: decision.setRevision };
        return {
          records: [autonomyRuleCodec.encode(decision.rule), autonomyRuleSetCodec.encode(set)],
          claims: [],
          guards: [{ refKey: canonicalKey(ruleRef(projectId, input.ruleId)), expectedRevision: decision.ruleGuard },
            { refKey: canonicalKey(ruleSetRef(projectId)), expectedRevision: decision.setGuard }],
          events: [autonomyRuleSetChangedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'changed'),
            eventType: 'AutonomyRuleSetChanged', schemaVersion: 1, occurredAt: deps.now().toISOString(), projectId,
            workspaceId, actor: trusted.actor, revision: set.revision })],
        };
      },
      result: { eventType: 'AutonomyRuleSetChanged', schemaVersion: 1,
        decode: (event) => autonomyRuleSetChangedCodec.decode(event),
        validate: (event, receipt, keys) => event.projectId !== projectId || event.workspaceId !== workspaceId
          ? 'the event records another scope'
          : receipt.identityKey === keys.identityKey ? null : 'the receipt belongs to another command',
        project: (event) => event.revision },
    });
    if (committed.status === 'refused') return committed.refusal;
    if (committed.status === 'rejected') return rejectedWithCurrent(committed.code, committed.reason, committed.current);
    const view = await read(ctx, { projectRef: { projectId } });
    if (view.status !== 'ready') {
      return view.status === 'rejected' ? view
        : rejected('unavailable', 'the autonomy rules read after the commit is not ready');
    }
    return { status: 'committed', value: view.value, replayed: committed.replayed, cursor: committed.cursor };
  }

  async function create(
    ctx: CoreCallContext, request: AutonomyRuleCreateRequestV1,
  ): Promise<WriteResult<AutonomyRuleViewV1>> {
    const trusted = trustedContext(ctx, 'autonomy-rules/create');
    if (!trusted.ok) return trusted.rejection;
    if (trusted.actor.kind !== 'human') return rejected('forbidden', 'autonomy-rules/create is person-only');
    const projectId = trusted.scope.projectId;
    const ruleId = 'autonomy-rule-' + sha256Hex(canonicalJson({ projectId,
      commandId: request.commandId } as unknown as JsonValue));
    return commitRuleChange(ctx, trusted, {
      kind: 'create', commandId: request.commandId, ruleId,
      // Only the keys the request carries: the canonical serializer refuses `undefined`, and a missing field is the
      // validator's refusal in `next`.
      fingerprintInput: Object.fromEntries(Object.entries({ actions: request.actions, scope: request.scope,
        limits: request.limits, expiresAt: request.expiresAt, approvedFrom: request.approvedFrom })
        .filter(([, value]) => value !== undefined)) as unknown as JsonValue,
      // The cap is checked in `next`, after the receipt check: a committed create replays though the cap was
      // lowered since, and a lower cap revokes no rule.
      next: (facts) => {
        const problem = validateAutonomyRule({ ...request, projectOpen: facts.projectOpen });
        return problem !== null ? { refuse: problem } : { decision: {
          rule: {
            ref: ruleRef(projectId, ruleId), projectRef: { projectId },
            revision: 1, actions: [...request.actions], scope: structuredClone([...request.scope]),
            limits: structuredClone(request.limits), expiresAt: request.expiresAt,
            approvedBy: trusted.actor,
            approvedFrom: request.approvedFrom === null ? null : structuredClone(request.approvedFrom),
            state: 'active',
          },
          ruleGuard: null,
          setRevision: nextAutonomyRuleSetRevision(facts.set),
          setGuard: facts.set?.revision ?? null,
        } };
      },
    });
  }

  /** Revoke and update change one stored rule; both guard the rule and the set at the person's expected revisions. */
  async function changeRule(ctx: CoreCallContext, kind: 'revoke' | 'update',
    request: AutonomyRuleRevokeRequestV1 | AutonomyRuleUpdateRequestV1,
    change: (rule: AutonomyRuleV1) => { refuse: CoreRejection } | { rule: AutonomyRuleV1 },
  ): Promise<WriteResult<AutonomyRuleViewV1>> {
    const trusted = trustedContext(ctx, `autonomy-rules/${kind}`);
    if (!trusted.ok) return trusted.rejection;
    if (trusted.actor.kind !== 'human') return rejected('forbidden', `autonomy-rules/${kind} is person-only`);
    return commitRuleChange(ctx, trusted, {
      kind, commandId: request.commandId, ruleId: request.ruleId,
      fingerprintInput: { ruleId: request.ruleId, expectedRevision: request.expectedRevision,
        expectedSetRevision: request.expectedSetRevision,
        ...('expiresAt' in request ? { expiresAt: request.expiresAt } : {}) } as unknown as JsonValue,
      next: (facts) => {
        if (facts.rule === null) return { refuse: rejected('not_found', 'the autonomy rule does not exist') };
        const changed = change(facts.rule);
        if ('refuse' in changed) return changed;
        return { decision: { rule: { ...changed.rule, revision: facts.rule.revision + 1 },
          ruleGuard: request.expectedRevision,
          setRevision: nextAutonomyRuleSetRevision(facts.set), setGuard: request.expectedSetRevision } };
      },
    });
  }

  return {
    read,
    create,
    revoke: (ctx, request) => changeRule(ctx, 'revoke', request,
      (rule) => ({ rule: { ...structuredClone(rule), state: 'revoked' } })),
    update: (ctx, request) => changeRule(ctx, 'update', request, (rule) => {
      // Only `expiresAt` changes, so only it is checked: the open limits are left empty and the project cap is not
      // checked — a cap lowered after the rule was created does not refuse a new expiry.
      const problem = validateAutonomyRule({ actions: rule.actions, scope: rule.scope, limits: { open: {} },
        expiresAt: request.expiresAt, projectOpen: ROLE_LINE_DEFAULT_LIMITS.open });
      return problem !== null ? { refuse: problem }
        : { rule: { ...structuredClone(rule), expiresAt: request.expiresAt } };
    }),
  };
}

const ruleSetRef = (projectId: string) => ({ aggregateType: 'AutonomyRuleSet' as const, projectId });
const ruleRef = (projectId: string, ruleId: string) => ({ aggregateType: 'AutonomyRule' as const, projectId, ruleId });

/** The set and (when named) one rule in one read; an absent key is `null`, damage is `unavailable`. */
async function readRuleFacts(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string, ruleId: string | null,
): Promise<{ status: 'ready'; value: RuleFacts } | CoreRejection> {
  const setKey = canonicalKey(ruleSetRef(projectId));
  const ruleKey = ruleId === null ? null : canonicalKey(ruleRef(projectId, ruleId));
  const read = await records.readMany(ruleKey === null ? [setKey] : [setKey, ruleKey]);
  if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
  const storedSet = read.value.records.find((each) => each.refKey === setKey);
  const storedRule = ruleKey === null ? undefined : read.value.records.find((each) => each.refKey === ruleKey);
  let set: AutonomyRuleSetV1 | null = null;
  if (storedSet !== undefined) {
    const decoded = autonomyRuleSetCodec.decode(storedSet);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `the autonomy rule set is damaged: ${decoded.reason}`);
    }
    set = decoded.value;
  }
  let rule: AutonomyRuleV1 | null = null;
  if (storedRule !== undefined) {
    const decoded = autonomyRuleCodec.decode(storedRule);
    if (decoded.status !== 'decoded') return rejected('unavailable', `the autonomy rule is damaged: ${decoded.reason}`);
    rule = decoded.value;
  }
  return { status: 'ready', value: { set, rule } };
}
