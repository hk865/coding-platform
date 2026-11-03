/**
 * A1b's one Admission world (`7d2-start-rulings.v4.md` §11).
 *
 * Two builders over the existing Host worlds:
 * - `openS7D2RetainedWorld`: two adviser lines archived through the formal `sessions/archive`, allocation at
 *   0 holders / 0 reservations and `open.adviser = 1` through `projects/role-limits/set` (RL-08). It extends
 *   `openS7D1AllocationWorld` and uses only its public `createLine` / `archive` / `setOpen` / `allocation` steps.
 * - `openS7D2RunningWorld`: adviser running cap 4 through `projects/role-limits/set`, three occupied adviser
 *   QueryRuns, two prepared adviser starters (a Work Run left `starting`/`authorized` through `workflow/advance`, a
 *   Query `prepared` through `queries/prepare`) and a prepared secretary starter (RL-10). An entered occupant holds
 *   its real `list_files` call at the world's tool gate, so its line stays occupied and a later crash leaves the call
 *   with no result; the Work starter's script opens with the same call. On SQLite the builder is the restart builder
 *   (DR/A1b-07): the Host crashes while the first occupant's call is held, so the same-store start-up reconcile
 *   records it `unknown` (QRR-05), and every other step runs on the new Host. On memory it is the race builder:
 *   three entered occupants and no crash.
 * - `openS7D2SecretaryCapWorld` (the request driver on): secretary running cap 1 held by one secretary Query at its
 *   model gate (`occupant.release()` lets it answer and free the seat; a crash settles it, QRR-04), and a second
 *   secretary line for a request round. The model window is 625,000, so a round that reports 500,000 input tokens
 *   ends too long (0.8 × 625,000).
 *
 * Everything is a public input: ids, route bodies, scripted replies and the caps through the real limits route. No
 * `ctx`, record, store or derived value is built here, and no Runtime or Host is impersonated.
 */
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, graphWrite, plain,
} from './AG2b-collaboration-fixture.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { asRecord, ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { committedValue, readyValue } from './S6A-memory-fixture.js';
import {
  S6A_SCOPE, S6A_SECRETARY_ROLE_BINDING,
  type S6ABackend, type S6ASession,
} from './S6A-request-fixture.js';
import { bindingOf } from './S7A-fixture.js';
import {
  PL_ADVISER_PROFILE_ID, PL_ADVISER_ROLE, PL_ADVISER_ROLE_BINDING,
  adoptPLMixedPlan, createPLLine,
} from './PL-consumption-fixture.js';
import { claimQuery, prepareAttempt } from './request-claim-steps.js';
import {
  archiveS7D1Session, openS7D1AllocationWorld, setS7D1Limits, type S7D1AllocationWorld,
} from './S7D1-allocation-world.js';

const ADVISER_BINDING = bindingOf('s7d2-adviser-binding', PL_ADVISER_ROLE, 'S7D2 adviser guidance', ['read']);

/** The Host inputs the running world needs: the adviser Runtime binding, Workflow binding and Query profile. */
const ADVISER_EXTENSION = {
  binding: ADVISER_BINDING,
  workflow: { workspace: S6A_SCOPE, sessionRole: PL_ADVISER_ROLE, roleBinding: PL_ADVISER_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } },
  queryProfile: {
    id: PL_ADVISER_PROFILE_ID, label: 'S7D2 adviser', scope: S6A_SCOPE,
    runtimeBindingId: ADVISER_BINDING.id, sessionRole: PL_ADVISER_ROLE,
    roleBinding: PL_ADVISER_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
    budget: { maxTokens: null, deadline: null }, consumerId: AG2B_CONSUMER_ID,
  },
};

// ---------------------------------------------------------------------------
// RL-08: the retained cap world
// ---------------------------------------------------------------------------

export type S7D2RetainedWorld = {
  readonly world: S7D1AllocationWorld;
  readonly a: S6ASession;
  readonly b: S6ASession;
  /** `sessions/reactivate` at the Session's current read pin; the route body, rejection included. */
  reactivate(session: S6ASession, requestId: string): Promise<Record<string, unknown>>;
  /** `decisions/queue` of the waiting cards. */
  queue(): Promise<DecisionQueueReadV1>;
  close(): Promise<void>;
};

export async function openS7D2RetainedWorld(options: { backend: S6ABackend }): Promise<S7D2RetainedWorld> {
  const world = await openS7D1AllocationWorld({ backend: options.backend });
  try {
    const a = await world.createLine({ label: 's7d2-adviser-a', role: PL_ADVISER_ROLE, duty: 'adviser' });
    const b = await world.createLine({ label: 's7d2-adviser-b', role: PL_ADVISER_ROLE, duty: 'adviser' });
    if (a.session === null || b.session === null) {
      throw new Error(`S7D2: the two adviser lines did not commit: ${JSON.stringify([a.answer.body, b.answer.body])}`);
    }
    await archiveS7D1Session(world.world, a.session.ref, 'S7D2 adviser A archived');
    await archiveS7D1Session(world.world, b.session.ref, 'S7D2 adviser B archived');
    await world.setOpen('adviser', 1);
    const report = await world.allocation();
    const adviser = report.duties.adviser;
    if (adviser.holders.length !== 0 || adviser.reservations.length !== 0 || adviser.limit !== 1) {
      throw new Error(`S7D2: the retained prior is not 0/0 against one open seat: ${JSON.stringify(adviser)}`);
    }
    return {
      world, a: a.session, b: b.session,
      async reactivate(session, requestId) {
        const card = await world.world.readSession(session.ref);
        return asRecord((await world.world.post('sessions/reactivate', graphWrite(S6A_SCOPE, {
          sessionRef: session.ref, reason: 'S7D2 reactivate the adviser line',
        }, requestId, [{ ref: card.record.ref, revision: card.record.revision }]))).body);
      },
      async queue() {
        return readyValue<DecisionQueueReadV1>((await world.world.post('decisions/queue', plain(S6A_SCOPE, {
          workspace: { ...S6A_SCOPE }, sections: ['waiting_answer'], page: { limit: 100 },
        }))).body, 'the decision queue');
      },
      close: () => world.close(),
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// RL-10: the running cap world
// ---------------------------------------------------------------------------

export type S7D2Starter =
  | { readonly kind: 'work'; readonly session: S6ASession; readonly runRef: RunRef;
    readonly startBody: Record<string, unknown> }
  | { readonly kind: 'query'; readonly session: S6ASession; readonly queryJobRef: QueryJobRef;
    readonly queryRunRef: QueryRunRef; readonly startBody: Record<string, unknown> };

export type S7D2RunningWorld = {
  readonly world: S6AHostWorld;
  /** The three occupied adviser QueryRuns; on SQLite the first is the result-unknown one. */
  readonly occupied: readonly S7D2Starter[];
  readonly work: S7D2Starter;
  readonly query: S7D2Starter;
  readonly secretary: S7D2Starter;
  /** The real start route for the starter's kind; it answers only when the call ends or does not enter. */
  start(starter: S7D2Starter): Promise<Record<string, unknown>>;
  /** The public Run/Query read for the starter. */
  read(starter: S7D2Starter): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

async function submitQuery(world: S6AHostWorld, line: S6ASession, label: string,
  roleBinding: RoleBindingRefV1): Promise<Extract<S7D2Starter, { kind: 'query' }>> {
  const registration = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
    (await world.post('workspaces/registration', plain(S6A_SCOPE, { ...S6A_SCOPE }))).body,
    `the registration for ${label}`);
  const goal = readyValue<{ goal: { revision: number } }>(
    (await world.post('goals/read', plain(S6A_SCOPE, world.goals.first))).body, `the Goal for ${label}`);
  const suffix = `s7d2-query-${label}`;
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...S6A_SCOPE, queryJobId: `${suffix}-job` };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...S6A_SCOPE, queryJobId: queryJobRef.queryJobId,
    runId: `${suffix}-run` };
  const intent = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
    workspaceId: S6A_SCOPE.workspaceId, goalId: world.goals.first.goalId,
    question: `S7D2 ${label}`, focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
    multiTurn: { maxRounds: 1 }, correlationId: `${suffix}-corr`,
    execution: { kind: 'semantic_query', roleBinding, runtimeBudget: AG2B_RUNTIME_BUDGET },
  };
  committedValue((await world.post('queries/submit', graphWrite(S6A_SCOPE, {
    queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent,
  }, `${suffix}-submit`, [
    { ref: { aggregateType: 'Project', projectId: S6A_SCOPE.projectId }, revision: registration.project.revision },
    { ref: { aggregateType: 'Workspace', ...S6A_SCOPE }, revision: registration.workspace.revision },
    { ref: world.goals.first, revision: goal.goal.revision },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
  ]))).body, `the Query ${label}`);
  committedValue(await claimQuery(world, queryJobRef, line, null, `${suffix}-claim`), `the claim of ${label}`);
  const prepared: PreparedQueryExecution = await prepareAttempt(world, queryJobRef, `${suffix}-prepare`);
  return { kind: 'query', session: line, queryJobRef, queryRunRef, startBody: {
    prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${suffix}-start`,
  } };
}

/** A real `list_files` call, then a reply that only a re-run would take. */
const toolCallScript = (label: string) => [
  { kind: 'calls' as const, calls: [{ callId: `s7d2-${label}-list`, name: 'list_files', args: { prefix: '.' } }] },
  { kind: 'text' as const, text: `S7D2 ${label} rerun` },
];

/**
 * One occupied Query on `line`, started through the real `queries/start`. `tool` holds its real `list_files` call
 * (a crash leaves the call with no result: QRR-05 `unknown`); `model` holds its first model request (a crash leaves
 * an interrupted clean Turn: QRR-04 settles it and frees the seat).
 */
async function occupy(world: S6AHostWorld, line: S6ASession, label: string,
  roleBinding: RoleBindingRefV1, hold: 'tool' | 'model'): Promise<S7D2Starter & { release(): void }> {
  const query = await submitQuery(world, line, label, roleBinding);
  const gate = hold === 'tool' ? await world.gates.toolCall(line, 'list_files') : await world.gates.modelRequest(line);
  await world.scripted.script(line, hold === 'tool' ? toolCallScript(label) : [{ kind: 'text', text: `S7D2 ${label}` }]);
  world.post('queries/start', plain(S6A_SCOPE, query.startBody)).catch(() => undefined);
  await gate.reached;
  return { ...query, release: () => gate.release() };
}

export async function openS7D2RunningWorld(options: { backend: S6ABackend }): Promise<S7D2RunningWorld> {
  const world = await openS6AHostWorld({ backend: options.backend, extraBindings: [ADVISER_EXTENSION] });
  try {
    await ensureProjectPointers(world);
    committedValue((await setS7D1Limits(world, { running: { adviser: 4 } }, 0, 's7d2-running-cap')).body,
      'the adviser running cap');
    const occupied: S7D2Starter[] = [];
    while (occupied.length < 3) {
      const label = `occupied-${String(occupied.length + 1)}`;
      const line = await createPLLine(world, { label: `s7d2-${label}`, role: PL_ADVISER_ROLE });
      occupied.push(await occupy(world, line, label, PL_ADVISER_ROLE_BINDING, 'tool'));
      // The restart builder (DR/A1b-07): the first occupant's held call has no result when the Host crashes.
      if (options.backend === 'sqlite' && occupied.length === 1) await world.crash();
    }

    // The Work starter: the real Workflow claims, prepares and stops before its start perform.
    const { tasks } = await adoptPLMixedPlan(world, { goal: world.goals.first, label: 's7d2-work',
      tasks: [{ taskId: 's7d2-work-task', role: PL_ADVISER_ROLE.templateId }] });
    const workLine = await createPLLine(world, { label: 's7d2-work', role: PL_ADVISER_ROLE, tasks: [tasks[0]!] });
    const steps = await driveWorkflow(world.ag2b, {
      schemaVersion: 1, goalRef: world.goals.first, flowId: 's7d2-work', sessionHint: workLine.ref,
      kind: 'select_work', taskId: 's7d2-work-task',
    }, { stopBefore: 'start' });
    const last = steps.at(-1);
    const receipt = last?.receipt;
    const next = last?.next;
    if (receipt?.kind !== 'prepare' || receipt.result.status !== 'ready') {
      throw new Error(`S7D2: the Workflow did not leave a prepared Work Run: ${JSON.stringify(receipt)}`);
    }
    if (next === null || next === undefined || next.kind !== 'perform' || next.operation.kind !== 'start') {
      throw new Error(`S7D2: the Workflow did not stop before the Work start: ${JSON.stringify(next)}`);
    }
    await world.scripted.script(workLine, toolCallScript('work'));
    const work: S7D2Starter = { kind: 'work', session: workLine, runRef: receipt.result.value.claim.runRef,
      startBody: next.operation.request as unknown as Record<string, unknown> };

    const queryLine = await createPLLine(world, { label: 's7d2-query', role: PL_ADVISER_ROLE });
    const query = await submitQuery(world, queryLine, 'starter', PL_ADVISER_ROLE_BINDING);
    await world.scripted.script(queryLine, [{ kind: 'text', text: 'S7D2 query answer' }]);

    const secretaryLine = await world.createSecretary('s7d2-secretary');
    const secretary = await submitQuery(world, secretaryLine, 'secretary', S6A_SECRETARY_ROLE_BINDING);
    await world.scripted.script(secretaryLine, [{ kind: 'text', text: 'S7D2 secretary answer' }]);

    return {
      world, occupied, work, query, secretary,
      async start(starter) {
        const route = starter.kind === 'work' ? 'executions/start' : 'queries/start';
        return asRecord((await world.post(route, plain(S6A_SCOPE, starter.startBody))).body);
      },
      async read(starter) {
        if (starter.kind === 'work') {
          return asRecord((await world.post('executions/read', plain(S6A_SCOPE, starter.runRef))).body);
        }
        return asRecord((await world.post('queries/read', plain(S6A_SCOPE, starter.queryJobRef))).body);
      },
      close: () => world.close(),
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

export async function openS7D2SecretaryCapWorld(options: { backend: S6ABackend }):
  Promise<{ world: S6AHostWorld; occupant: { release(): void }; secretary: S6ASession }> {
  const world = await openS6AHostWorld({ backend: options.backend, secretaryBudget: { contextWindowTokens: 625_000 },
    extraHostOptions: { requestDriver: 'on' } });
  try {
    await ensureProjectPointers(world);
    committedValue((await setS7D1Limits(world, { running: { secretary: 1 } }, 0, 's7d2-secretary-cap')).body,
      'the secretary running cap');
    const occupant = await occupy(world, await world.createSecretary('s7d2-occupant'), 'occupant',
      S6A_SECRETARY_ROLE_BINDING, 'model');
    return { world, occupant, secretary: await world.createSecretary('s7d2-round') };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}
