/**
 * R6 execution entry: trusted startup configuration for the local Host.
 *
 * This is the ONLY module that turns the serializable workbench runtime
 * description into the existing `RuntimeHostBindings` port. It owns no model
 * loop, no second registry and no credential store: the model client always
 * comes from the frozen Kernel `ProviderRegistry` (or a controlled test double
 * of the same narrow shape), and a secret is read only at the first actual
 * binding resolution through the exact named environment variable.
 *
 * The factory validates the pure configuration, selects the unique binding for
 * the exact scope + complete Role, lazily binds the selected provider/secret on
 * a binding's first real resolution and assembles the existing
 * `ResolvedRuntimeConfiguration`; it never re-runs the model loop, budget or
 * Role/Grant admission. A Host without a runtime configuration keeps every
 * other page working.
 */
import {
  createBuiltinProviderRegistry,
  type ProviderId,
  type ProviderRegistry,
  type SecretSource,
} from '../../vendor/coding-agent/dist/public-api.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import type { RoleBindingRefV1 } from '../contracts/dispatch.js';
import type { JsonValue } from '../contracts/fingerprint.js';
import type { QueryJobIntentV1 } from '../contracts/query-job.js';
import { validateRuntimeBudget, type RuntimeBudget } from '../contracts/runtime-budget.js';
import type {
  QueryRuntimeConfigurationInput,
  ResolvedRuntimeConfiguration,
  RuntimeConfigurationInput,
  RuntimeHostBindings,
} from '../core/agent-runtime/execution-contracts.js';

/** One trusted model description. It carries the environment-variable NAME
 * only; the secret value never enters this value, a digest, a log or a body. */
export type WorkbenchModelConfiguration = {
  revision: string;
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  options?: Readonly<Record<string, JsonValue>>;
  secretEnvironmentVariable?: string;
};

/** One trusted runtime binding for a complete workspace scope plus one complete
 * `RoleConfigurationRef`. `grant` is the trusted Host grant; it is never rebuilt
 * from task text and never widened to a default shell/whole-workspace write. */
export type WorkbenchRuntimeBinding = {
  id: string;
  label: string;
  scope: WorkspaceScope;
  role: RoleConfigurationRef;
  configurationRevision: string;
  model: WorkbenchModelConfiguration;
  grant: Omit<ResolvedRuntimeConfiguration, 'configurationRevision' | 'model'>;
};

/** The display/selection projection a user picks for one read-only Query. The
 * formal RoleBinding/pins/budget are the trusted ones; the UI only names this
 * profile id. It is the safe subset of the runtime configuration that may be
 * published in bootstrap. */
export type WorkbenchQueryProfile = {
  id: string;
  label: string;
  scope: WorkspaceScope;
  runtimeBindingId: string;
  sessionRole: RoleConfigurationRef;
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
};

export type WorkbenchRuntimeConfiguration = {
  schemaVersion: 1;
  bindings: WorkbenchRuntimeBinding[];
  queryProfiles: WorkbenchQueryProfile[];
};

/** Narrow programmatic seam a controlled acceptance test may substitute for the
 * builtin registry / process environment. It is Host-internal only: it is never
 * a CLI or HTTP field, and no provider definition, client or secret crosses it
 * from a request. */
export type WorkbenchRuntimeProviderDependencies = {
  registry?: Pick<ProviderRegistry, 'get' | 'create'>;
  secretSource?: SecretSource;
};

export type WorkbenchRuntimeConfigurationProblem = {
  code: 'invalid' | 'unsupported';
  reason: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const scopeKey = (scope: WorkspaceScope): string => `${scope.projectId}\u0000${scope.workspaceId}`;

/** Structural equality of one complete `RoleConfigurationRef`: never a prefix
 * match, never a first-match guess. */
export function sameRoleConfiguration(left: RoleConfigurationRef, right: RoleConfigurationRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'role_spec' && right.kind === 'role_spec') {
    return left.pin.ref.aggregateType === right.pin.ref.aggregateType
      && left.pin.ref.projectId === right.pin.ref.projectId
      && left.pin.ref.roleId === right.pin.ref.roleId
      && left.pin.ref.revision === right.pin.ref.revision
      && left.pin.digest === right.pin.digest;
  }
  if (left.kind === 'legacy_template' && right.kind === 'legacy_template') {
    return left.templateId === right.templateId && left.templateRevision === right.templateRevision;
  }
  return false;
}

function validScope(value: unknown): value is WorkspaceScope {
  return isPlainObject(value) && nonEmpty(value.projectId) && nonEmpty(value.workspaceId);
}
function validRole(value: unknown): value is RoleConfigurationRef {
  if (!isPlainObject(value)) return false;
  if (value.kind === 'role_spec') {
    const pin = value.pin;
    if (!isPlainObject(pin) || !nonEmpty(pin.digest)) return false;
    const ref = pin.ref;
    return isPlainObject(ref) && ref.aggregateType === 'RoleSpecRevision' && nonEmpty(ref.projectId)
      && nonEmpty(ref.roleId) && typeof ref.revision === 'number'
      && Number.isSafeInteger(ref.revision) && ref.revision >= 0;
  }
  if (value.kind === 'legacy_template') return nonEmpty(value.templateId) && nonEmpty(value.templateRevision);
  return false;
}

/**
 * Pure configuration validation before any provider/env access. Duplicate
 * binding/profile ids, two bindings for the same scope+Role, a profile pointing
 * at a missing or mismatched binding, an inverted Role/template grant and an
 * invalid RuntimeBudget are explicit configuration errors; nothing is guessed
 * from the first entry.
 */
export function validateWorkbenchRuntimeConfiguration(
  configuration: WorkbenchRuntimeConfiguration,
): WorkbenchRuntimeConfigurationProblem | null {
  if (!isPlainObject(configuration) || configuration.schemaVersion !== 1)
    return { code: 'invalid', reason: 'runtime configuration must be { schemaVersion: 1, bindings, queryProfiles }' };
  if (!Array.isArray(configuration.bindings) || !Array.isArray(configuration.queryProfiles))
    return { code: 'invalid', reason: 'runtime configuration requires bindings and queryProfiles arrays' };
  const bindingIds = new Set<string>();
  const seenBindings: { scope: WorkspaceScope; role: RoleConfigurationRef }[] = [];
  for (const [index, binding] of configuration.bindings.entries()) {
    if (!isPlainObject(binding) || !nonEmpty(binding.id)) return { code: 'invalid', reason: `bindings[${index}] requires a non-empty id` };
    if (bindingIds.has(binding.id)) return { code: 'invalid', reason: `duplicate runtime binding id ${binding.id}` };
    bindingIds.add(binding.id);
    if (!validScope(binding.scope)) return { code: 'invalid', reason: `bindings[${index}] requires a project/workspace scope` };
    if (!validRole(binding.role)) return { code: 'invalid', reason: `bindings[${index}] requires a complete RoleConfigurationRef` };
    if (!nonEmpty(binding.configurationRevision)) return { code: 'invalid', reason: `bindings[${index}] requires a configurationRevision` };
    if (!isPlainObject(binding.model) || !nonEmpty(binding.model.model)) return { code: 'invalid', reason: `bindings[${index}] requires a model description` };
    if (!isPlainObject(binding.grant)) return { code: 'invalid', reason: `bindings[${index}] requires a trusted grant` };
    const duplicate = seenBindings.some(seen => scopeKey(seen.scope) === scopeKey(binding.scope)
      && sameRoleConfiguration(seen.role, binding.role));
    if (duplicate) return { code: 'invalid', reason: `duplicate runtime binding for scope ${scopeKey(binding.scope)} and Role configuration` };
    seenBindings.push({ scope: binding.scope, role: binding.role });
    const hostTemplate = binding.grant.hostTemplate;
    if (binding.role.kind === 'legacy_template' && hostTemplate === null)
      return { code: 'invalid', reason: `bindings[${index}] is a legacy_template Role and requires an explicit hostTemplate` };
    if (binding.role.kind === 'role_spec' && hostTemplate !== null)
      return { code: 'invalid', reason: `bindings[${index}] is a role_spec Role and must not carry a legacy hostTemplate` };
    if (!isPlainObject(binding.grant.budget))
      return { code: 'invalid', reason: `bindings[${index}] requires a RuntimeBudget` };
    try {
      validateRuntimeBudget(binding.grant.budget);
    } catch (error) {
      return { code: 'invalid', reason: `bindings[${index}] has an invalid RuntimeBudget: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const profileIds = new Set<string>();
  for (const [index, profile] of configuration.queryProfiles.entries()) {
    if (!isPlainObject(profile) || !nonEmpty(profile.id)) return { code: 'invalid', reason: `queryProfiles[${index}] requires a non-empty id` };
    if (profileIds.has(profile.id)) return { code: 'invalid', reason: `duplicate query profile id ${profile.id}` };
    profileIds.add(profile.id);
    const binding = configuration.bindings.find(candidate => candidate.id === profile.runtimeBindingId);
    if (binding === undefined) return { code: 'invalid', reason: `queryProfiles[${index}] points at missing runtime binding ${String(profile.runtimeBindingId)}` };
    if (!validScope(profile.scope) || !validRole(profile.sessionRole))
      return { code: 'invalid', reason: `queryProfiles[${index}] requires a scope and a complete sessionRole` };
    if (scopeKey(profile.scope) !== scopeKey(binding.scope) || !sameRoleConfiguration(profile.sessionRole, binding.role))
      return { code: 'invalid', reason: `queryProfiles[${index}] does not match its runtime binding scope/Role` };
    if (!nonEmpty(profile.consumerId)) return { code: 'invalid', reason: `queryProfiles[${index}] requires a consumerId` };
    if (!isPlainObject(profile.budget) || typeof profile.budget.maxTokens !== 'number')
      return { code: 'invalid', reason: `queryProfiles[${index}] requires a budget { maxTokens, deadline }` };
    try {
      validateRuntimeBudget(profile.runtimeBudget);
    } catch (error) {
      return { code: 'invalid', reason: `queryProfiles[${index}] has an invalid runtimeBudget: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return null;
}

/**
 * The trusted factory. It validates the pure configuration, snapshots it and
 * returns the existing `RuntimeHostBindings` seam. Both resolution branches
 * select the unique trusted binding (complete scope + complete Role), match the
 * legacy template explicitly and assemble the existing `BoundModel` from the
 * frozen Kernel `ProviderRegistry`/`SecretSource`. The one secret variable is
 * read only on a binding's first actual resolution; the resulting client is
 * reused inside this Host. No model loop, provider or credential store is
 * duplicated and no secret/options/provider payload is echoed in a failure.
 */
export function createWorkbenchRuntimeHostBindings(
  configuration: WorkbenchRuntimeConfiguration,
  dependencies: WorkbenchRuntimeProviderDependencies = {},
): RuntimeHostBindings {
  const problem = validateWorkbenchRuntimeConfiguration(configuration);
  if (problem !== null) throw new Error(`workbench runtime configuration is ${problem.code}: ${problem.reason}`);
  const registry: Pick<ProviderRegistry, 'get' | 'create'> = dependencies.registry ?? createBuiltinProviderRegistry();
  const secretSource: SecretSource = dependencies.secretSource ?? { get: (name: string) => process.env[name] };
  const config = structuredClone(configuration);
  const bind = (scope: WorkspaceScope, role: RoleConfigurationRef): WorkbenchRuntimeBinding | null =>
    config.bindings.find(candidate => candidate.scope.projectId === scope.projectId
      && candidate.scope.workspaceId === scope.workspaceId
      && sameRoleConfiguration(candidate.role, role)) ?? null;

  // One existing `BoundModel` per binding, produced on its first real
  // resolution and reused for the life of this Host.
  const models = new Map<string, ResolvedRuntimeConfiguration['model']>();
  const resolveModel = (binding: WorkbenchRuntimeBinding): { status: 'ready'; value: ResolvedRuntimeConfiguration['model'] } | CoreRejection => {
    const cached = models.get(binding.id);
    if (cached !== undefined) return { status: 'ready', value: cached };
    let definition: ReturnType<typeof registry.get>;
    try {
      definition = registry.get(binding.model.provider);
    } catch {
      return { status: 'rejected', code: 'unsupported', reason: `trusted runtime binding ${binding.id} names a provider that is not registered` };
    }
    const variable = binding.model.secretEnvironmentVariable ?? definition.secretEnvironmentVariable;
    let secret: string | undefined;
    try {
      secret = secretSource.get(variable);
    } catch {
      return { status: 'rejected', code: 'unavailable', reason: `trusted runtime binding ${binding.id} could not read its configured secret` };
    }
    if (typeof secret !== 'string' || secret.length === 0) {
      return { status: 'rejected', code: 'unsupported', reason: `trusted runtime binding ${binding.id} has no configured secret for its selected provider` };
    }
    const baseUrl = binding.model.baseUrl ?? definition.defaultBaseUrl;
    let client;
    try {
      client = registry.create(binding.model.provider, {
        apiKey: secret,
        model: binding.model.model,
        baseUrl,
        ...(binding.model.options === undefined ? {} : { options: binding.model.options }),
      });
    } catch {
      return { status: 'rejected', code: 'unavailable', reason: `trusted runtime binding ${binding.id} could not create its model client` };
    }
    const model: ResolvedRuntimeConfiguration['model'] = {
      configuration: { revision: binding.model.revision, provider: binding.model.provider, model: binding.model.model, baseUrl },
      client,
    };
    models.set(binding.id, model);
    return { status: 'ready', value: model };
  };

  const resolve = (ctx: { projectId: string; workspaceId?: string }, role: RoleConfigurationRef): ReadResult<ResolvedRuntimeConfiguration> => {
    if (ctx.workspaceId === undefined)
      return { status: 'rejected', code: 'forbidden', reason: 'the runtime request has no workspace scope' };
    const binding = bind({ projectId: ctx.projectId, workspaceId: ctx.workspaceId }, role);
    if (binding === null)
      return { status: 'rejected', code: 'forbidden', reason: 'no trusted runtime binding matches the complete workspace scope and Role configuration' };
    const hostTemplate = binding.grant.hostTemplate;
    if (role.kind === 'legacy_template') {
      if (hostTemplate === null || hostTemplate.templateId !== role.templateId || hostTemplate.revision !== role.templateRevision)
        return { status: 'rejected', code: 'forbidden', reason: `trusted runtime binding ${binding.id} does not carry a matching legacy host template` };
    } else if (hostTemplate !== null) {
      return { status: 'rejected', code: 'forbidden', reason: `trusted runtime binding ${binding.id} must not carry a legacy host template for a RoleSpec` };
    }
    const model = resolveModel(binding);
    if (model.status !== 'ready') return model;
    return { status: 'ready', value: {
      configurationRevision: binding.configurationRevision,
      model: model.value,
      ...binding.grant,
    } };
  };

  return {
    async resolveConfiguration(ctx, input: RuntimeConfigurationInput) {
      // The already-resolved Role result is preserved (resolved/absent/
      // inadmissible); the Host does not re-derive Role currentness here.
      return resolve(ctx, input.role);
    },
    async resolveQueryConfiguration(ctx, input: QueryRuntimeConfigurationInput) {
      return resolve(ctx, input.role);
    },
  };
}
