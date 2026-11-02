/**
 * The one maintainer world: W0, W4, the flat world and the single-root world, shared by the maintainer writer and read
 * rows.
 *
 * Every state is produced by a public step: the real `createTargetPlatform` composition (`openCatalogWorld` of the
 * frozen catalog fixture, given the project id `p1`), the public `architecture/adopt-initial` owner for a fixed catalog,
 * the real route table `createWorkbenchServer` + `createPlatformCoreRouteBindings` for the HTTP entry, and
 * `sessions/create` / `sessions/link` / `sessions/transfer-responsibility` / `sessions/archive-line` /
 * `sessions/archive-continue` over that HTTP entry as the Host's person. The continuation step is the platform's
 * `sessionHandoff.acceptHandoff` plus the published advance (`handoff.accept` and its create/scope-transfer children),
 * with the saved operation read back through `sessions/operation`. The role facts are the real
 * `platformRoleProfile(duty).template` refs, or a real RoleSpec installed through the public `roles` owner (the duty
 * read's fault rows); every pin a write step sends comes from `sessions/read` just before the write. No record, event
 * or Session field is written by hand, and nothing is asserted by reading a store.
 *
 * `commitBarrier` and `byClaimMove` are the frozen `S6A-commit-barrier.ts` ones. The test file owns the two `vi.mock`
 * lines (they hoist per file); this file exports the barrier and the maintainer predicate so rows do not spell the
 * prefix. Both backends are accepted; a world is one platform, one HTTP server and one project. `reopenHost` is the
 * SQLite only reopen: it closes this platform and starts a new one on the same database directory.
 *
 * The read rows add their own tool/card/route steps test-locally.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ModuleRef, SessionRef, VersionPin, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import type { ArchiveTaskChoiceV1 } from '../../src/contracts/core/session-archive.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { HandoffApprovalV1 } from '../../src/contracts/handoff.js';
import type { RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { roleSpecContentDigest } from '../../src/contracts/role-spec.js';
import type { HandoffProgressV1 } from '../../src/core/work-graph/model/session-handoff-contracts.js';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionCard, SessionOperationRecordOf, SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import type { ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { MODULE_MAINTAINER_PREFIX } from '../../src/contracts/role-lines.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest } from '../../src/app/core-routes.js';
import type { CoreRouteSuffix } from '../../src/app/core-http-types.js';
import { createHostCoreCallContext, type HostActor } from '../../src/app/core-call-context.js';
import { createWorkbenchServer, type WorkbenchServer } from '../../src/app/server.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { responsibleLinkRef } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import * as materialService from '../../src/core/work-graph/materials/material-service.js';
import { corePost, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { openCatalogWorld, type Backend } from './S8B-catalog-steps.js';
import type { PlatformFixture } from './S8D-platform-fixture.js';
import { byClaimMove, commitBarrier } from './S6A-commit-barrier.js';
import { valueOf } from './S6B3-fixture.js';

export { commitBarrier, byClaimMove } from './S6A-commit-barrier.js';
/** The one barrier predicate: a real writer's prepared commit that moves the module-maintainer claim. */
export const maintainerClaimMove = byClaimMove(MODULE_MAINTAINER_PREFIX);

/** The world's project id (the frozen expectation's `p1`; the workspace is the fixture's `main`). */
export const MAINTAINER_PROJECT_ID = 'p1';
export const MAINTAINER_WORKSPACE_ID = 'main';

/** W0's active catalog: the executor module `M`, the second module `M2` and the task module `N`, no containment. */
const w0Module = (moduleId: string, path: string): ModuleDefinition =>
  ({ ref: { projectId: MAINTAINER_PROJECT_ID, moduleId }, name: `Module ${moduleId}`,
    responsibility: `Own ${moduleId}`, paths: [path], interfaces: [] });

/** W0's default maintained module ids (R-07's actual-id variant is `openMaintainerWorld0PrivateUse`). */
export const W0_MODULE_IDS = ['M', 'M2'] as const;
/** R-07: the UTF-8/UTF-16 order probe's real ids, adopted as catalog modules and used by real link steps. */
export const W0_PRIVATE_USE_MODULE_IDS = ['\uE000', '\u{10000}'] as const;

/** W0's active catalog: the executor module `M`, the second module `M2` and the task module `N`, no containment. */
export function w0Catalog(maintained: readonly string[] = W0_MODULE_IDS): AdoptedArchitecture {
  const modules = [...maintained.map((moduleId, index) => w0Module(moduleId, index === 0 ? 'm' : `m${index + 1}`)),
    w0Module('N', 'n')];
  return { modules, dependencies: [], requireDag: true };
}

/** W4's fixed B-04 catalog: root/src/src a/src a/x/docs with the four containment edges. */
export const W4_CATALOG: AdoptedArchitecture = {
  modules: [
    w0Module('root', '.'), w0Module('src', 'src'), w0Module('src/a', 'src/a'),
    w0Module('src/a/x', 'src/a/x'), w0Module('docs', 'docs'),
  ],
  dependencies: [],
  requireDag: true,
  containment: { parentOf: [
    { parent: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'root' }, child: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'src' } },
    { parent: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'src' }, child: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'src/a' } },
    { parent: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'src/a' }, child: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'src/a/x' } },
    { parent: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'root' }, child: { projectId: MAINTAINER_PROJECT_ID, moduleId: 'docs' } },
  ] },
};

/** The flat world's catalog: `root` and `flat2`, no containment. */
export const FLAT_CATALOG: AdoptedArchitecture = {
  modules: [w0Module('root', '.'), w0Module('flat2', 'flat2')],
  dependencies: [],
  requireDag: true,
};

/** The single-root world's catalog: one module at the repository root, the only shape that reads "未细分". */
export const ROOT_CATALOG: AdoptedArchitecture = {
  modules: [w0Module('root', '.')],
  dependencies: [],
  requireDag: true,
};

export type MaintainerModuleTarget = Extract<WorkLinkTarget, { kind: 'module' }>;

/** One Session the world created, with the real role it was created with. */
export type MaintainerLine = { label: string; ref: SessionRef; role: RoleConfigurationRef };

export type MaintainerLinkStep = {
  /** The real route's result in its 200 body. */
  result: WriteResult<SessionWorkLink>;
  /** The two pins the step sent (the Session and the link revision), read from `sessions/read`. */
  expected: readonly VersionPin[];
};

export type MaintainerTransferStep = {
  result: WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>;
  /** The four pins the step sent (source and destination Session and link revisions). */
  expected: readonly VersionPin[];
};

/** One `sessions/archive-line` call: the route's 200 body and the Session pin the step sent. */
export type MaintainerArchiveStep = {
  result: ReadResult<ArchiveLineResultV1>;
  expected: readonly VersionPin[];
};

/** The public archive result's one receipt of a step (a receipt a real step returned, never built). */
export function archiveReceipt(result: ArchiveLineResultV1, step: 'responsibility' | 'archive'):
  ArchiveLineResultV1['receipts'][number] | undefined {
  return result.receipts.find(receipt => receipt.step === step);
}

/**
 * One real `handoff.accept` plus the advance's own successor and scope-transfer children (the continuation path):
 * the accept result, the last progress, the successor line the create child made, and the saved operation the public
 * `sessions/operation` read answers (its `action.progress.scope.entries[i].receipt.cursor` is the transfer child's
 * cursor). Nothing is a plain transfer row and no child receipt is built here.
 */
export type MaintainerHandoffStep = {
  accepted: { operation: OperationRef; stage: 'accepted'; phase: 'accepted'; approval: HandoffApprovalV1 | null };
  progress: HandoffProgressV1;
  successor: SessionRef;
  operation: SessionOperationRecordOf<HandoffActionV1>;
};

/** The public API of one maintainer world. Each member is a real step or a value a real step returned. */
export type MaintainerWorld = {
  readonly backend: Backend;
  readonly projectId: string;
  readonly scope: { projectId: string; workspaceId: string };
  /** A trusted Host person's context from the real Host/person step (the platform fixture's `p1-operator`). */
  readonly ctx: CoreCallContext;
  /**
   * The real Runtime-issued member context of a Query round this world ran: a `query_run` principal, never the
   * person, so a person-only route refuses it.
   */
  readonly member: CoreCallContext;
  /** The real composed platform (the same object the HTTP bindings wrap). */
  readonly platform: PlatformFixture['platform'];
  /** The real HTTP base URL and its one per-world token (the `corePost` entry). */
  readonly base: string;
  readonly token: string;
  /** One real core-route call over HTTP as the Host person; answers the status and parsed body. */
  postRoute(suffix: string, body: unknown): Promise<{ httpStatus: number; body: unknown }>;
  /** One real core-route call in process under the given trusted context (the refusal rows' entry). */
  dispatch(suffix: string, ctx: CoreCallContext, body: unknown): Promise<unknown>;
  /** The target for a module of this world's catalog. */
  module(moduleId: string): MaintainerModuleTarget;
  /** The named lines: L1/L2/L3 executors, A1 adviser (W0); L1 executor and L2/L3 advisers (W4/flat). */
  readonly lines: { readonly L1: MaintainerLine; readonly L2: MaintainerLine; readonly L3: MaintainerLine;
    readonly A1: MaintainerLine };
  /** A new line with its real role and its open `responsible` module links, through `sessions/create`. */
  createMaintainerLine(input: { label: string; duty: 'executor' | 'adviser'; modules?: readonly string[] | undefined;
    requestId?: string }): Promise<MaintainerLine>;
  /** A real RoleSpec installed through `roles` and a line created with that pin (the duty read's fault rows). */
  createRoleSpecLine(input: { label: string; content: RoleSpecContentV1; modules?: readonly string[] | undefined;
    requestId?: string }): Promise<MaintainerLine>;
  /** `sessions/read` (a public read, never the store). */
  readCard(line: MaintainerLine | SessionRef): Promise<SessionCard>;
  /** The open-or-closed `responsible` link to `target`, from the card `sessions/read` returns. */
  readLink(line: MaintainerLine | SessionRef, target: WorkLinkTarget): Promise<SessionWorkLink | undefined>;
  /** `sessions/link` open/close with the two pins `sessions/read` answers just before the write. */
  link(input: { line: MaintainerLine | SessionRef; target: WorkLinkTarget; active?: boolean; requestId: string }): Promise<MaintainerLinkStep>;
  /** `sessions/transfer-responsibility` with the four pins read just before the write. */
  transfer(input: { from: MaintainerLine | SessionRef; to: MaintainerLine | SessionRef; target: WorkLinkTarget;
    requestId: string }): Promise<MaintainerTransferStep>;
  /**
   * `sessions/archive-line` for one choice set; the Session pin is read just before the write. The route answers the
   * complete composition result, so a partial archive and its committed receipts stay observable.
   */
  archiveLine(input: { line: MaintainerLine | SessionRef; tasks: readonly ArchiveTaskChoiceV1[];
    reason?: string; requestId: string }): Promise<MaintainerArchiveStep>;
  /** `sessions/archive-continue` of a stored archive request, through the public route. */
  continueArchive(input: { line: MaintainerLine | SessionRef; archiveRequestId: string }): Promise<ReadResult<ArchiveLineResultV1>>;
  /**
   * The real continuation: `handoff.accept` (the person's `manual` trigger, one `create` executor successor) and the
   * published advance until it finishes, so the successor and the source's module scope move through the advance's
   * own `transfer` child. The saved operation is read back through `sessions/operation`, never a store.
   */
  handoff(input: { source: MaintainerLine | SessionRef; commandId: string }): Promise<MaintainerHandoffStep>;
  /** `sessions/find` for one target, through the public read. */
  findByTarget(target: WorkLinkTarget, includeArchived?: boolean): Promise<SessionCard[]>;
  /** SQLite only: close this Host's platform and start a new one on the same database directory. */
  reopenHost(sqliteDirectory: string): Promise<void>;
  close(): Promise<void>;
};

const actorOf = (projectId: string): HostActor => ({ kind: 'human', id: `${projectId}-operator` });

async function openWorld(input: { backend: Backend; catalog: AdoptedArchitecture; baselineId: string;
  lines: 'executor-three' | 'w4' | 'flat'; w0Maintained?: readonly string[] | undefined }): Promise<MaintainerWorld> {
  // The Runtime hands its own `query_run` context to the materials port when it stores a Query's answer; the
  // delegating port returns the real one unchanged and keeps that context. `base.answer` is not a request round, so
  // its answer-tool group is never built; this is the one Runtime context the real answer chain does hand out.
  const memberContexts: CoreCallContext[] = [];
  const createMaterialService = materialService.createMaterialService;
  const materialSpy = vi.spyOn(materialService, 'createMaterialService').mockImplementation(deps => {
    const port = createMaterialService(deps);
    const storeArtifact = port.storeArtifact.bind(port);
    return { ...port, storeArtifact: async (ctx, request) => {
      if (ctx.principal.kind === 'query_run') memberContexts.push(ctx);
      return await storeArtifact(ctx, request);
    } };
  });
  let base: Awaited<ReturnType<typeof openCatalogWorld>>;
  try {
    base = await openCatalogWorld(input.backend, MAINTAINER_PROJECT_ID);
  } finally {
    materialSpy.mockRestore();
  }
  const serverTokens = `s8b-maintainer-${input.baselineId}-${Math.random().toString(36).slice(2)}`;
  const scope = { projectId: MAINTAINER_PROJECT_ID, workspaceId: MAINTAINER_WORKSPACE_ID };
  const hostActor = actorOf(MAINTAINER_PROJECT_ID);
  let server: WorkbenchServer | undefined;
  let platform: PlatformFixture['platform'] = base.platform;
  const reopenedPlatforms: PlatformFixture['platform'][] = [];
  let baseUrl = '';
  let reopenRoot: string | null = null;
  // The SQLite reopen's Host inputs (rule sheet A8): the workspace root is an empty temp directory and the
  // authorization is the same Host person grant the frozen fixture uses. Nothing of the archive reads a file.
  const reopenHostBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === MAINTAINER_PROJECT_ID && requested.workspaceId === MAINTAINER_WORKSPACE_ID
        && reopenRoot !== null
        ? { status: 'ready', value: { root: reopenRoot, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize(bound, requested) {
      const permitted = bound.projectId === MAINTAINER_PROJECT_ID && bound.workspaceId === MAINTAINER_WORKSPACE_ID
        && bound.principal.kind === 'host' && bound.principal.actor.id === hostActor.id
        && bound.materialReader.kind === 'host' && bound.materialReader.actor.id === hostActor.id
        && requested.projectId === MAINTAINER_PROJECT_ID && requested.workspaceId === MAINTAINER_WORKSPACE_ID;
      return permitted
        ? { status: 'ready', value: { subjectKey: `${MAINTAINER_PROJECT_ID}-observer`,
          permissionRevision: `${MAINTAINER_PROJECT_ID}-maintainer-reopen-v1`, allowsRead: () => false } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  };
  const startServer = async (): Promise<void> => {
    const created = createWorkbenchServer({
      token: serverTokens,
      bindings: createPlatformCoreRouteBindings(platform as Parameters<typeof createPlatformCoreRouteBindings>[0]),
      actor: hostActor,
      bootstrap: () => ({ workspaces: [], review: null, execution: { queryProfiles: [], workflowScopes: [] } }),
      allowsScope: candidate => candidate.projectId === MAINTAINER_PROJECT_ID
        && candidate.workspaceId === MAINTAINER_WORKSPACE_ID,
    });
    const address = await created.listen(0);
    server = created;
    baseUrl = address.url;
  };
  try {
    await base.adoptInitial({ baselineId: input.baselineId, catalog: input.catalog,
      description: `S8B maintainer ${input.baselineId}`, constraints: [{ name: 'formal module DAG', scope: 'project' }] });
    await startServer();
    const token = serverTokens;
    // The handover driver is an internal Host step: the fixed system actor, never the member Run.
    const systemContext = createHostCoreCallContext({ scope,
      actor: { kind: 'system', id: `${MAINTAINER_PROJECT_ID}-system` }, signal: new AbortController().signal });
    // The member context is the Runtime's own `query_run` context of a real Query round: `base.answer` drives the
    // initialization answer and the delegating materials port keeps the context the Runtime hands it.
    const goal = await base.goal(`s8b-maintainer-${input.baselineId}`);
    const answer = await base.answer(goal, { schemaVersion: 2, kind: 'needs_decision',
      summary: 'S8B maintainer world: the member round', questions: ['Which module does this world maintain?'] });
    const member = memberContexts.find(context => context.principal.kind === 'query_run'
      && context.principal.queryRunRef.queryJobId === answer.answerRef.queryJobId);
    if (member === undefined) {
      throw new Error('S8B maintainer world: the Query round issued no member context');
    }

    const postRoute = async (suffix: string, body: unknown) => {
      const response = await corePost(baseUrl, suffix, token, body);
      return { httpStatus: response.status, body: await response.json() as unknown };
    };
    const dispatch = async (suffix: string, ctx: CoreCallContext, body: unknown): Promise<unknown> => {
      const parsed = parseCoreRouteRequest(suffix as CoreRouteSuffix, body);
      if (!parsed.ok) return parsed.rejection;
      return await dispatchCoreRoute(createPlatformCoreRouteBindings(platform as Parameters<typeof createPlatformCoreRouteBindings>[0]), suffix as CoreRouteSuffix, ctx, parsed);
    };

    const module = (moduleId: string): MaintainerModuleTarget =>
      ({ kind: 'module', ref: { projectId: MAINTAINER_PROJECT_ID, moduleId } });
    const lineRefOf = (line: MaintainerLine | SessionRef): SessionRef =>
      'sessionId' in line ? line : line.ref;

    async function readCard(line: MaintainerLine | SessionRef): Promise<SessionCard> {
      const session = lineRefOf(line);
      return valueOf<SessionCard>((await postRoute('sessions/read', plain(scope, session))).body, 'ready',
        `the Session ${session.sessionId}`);
    }
    async function readLink(line: MaintainerLine | SessionRef, target: WorkLinkTarget): Promise<SessionWorkLink | undefined> {
      const card = await readCard(line);
      const expected = canonicalKey(responsibleLinkRef(lineRefOf(line), target));
      return card.links.find(link => canonicalKey(link.ref) === expected);
    }

    async function createWithRole(request: { label: string; role: RoleConfigurationRef;
      modules?: readonly string[] | undefined; requestId?: string }): Promise<MaintainerLine> {
      const initialLinks = (request.modules ?? []).map(moduleId => ({
        target: module(moduleId), relation: 'responsible' as const,
      }));
      const body = await postRoute('sessions/create', plain(scope, {
        workspace: { ...scope }, role: request.role, recommendedRefs: [], initialLinks,
        meta: { requestId: request.requestId ?? `s8b-line-${request.label}`, expected: [] },
      }));
      const value = valueOf<{ ref: { projectId: string; sessionId: string } }>(body.body, 'completed',
        `the line ${request.label}`);
      return { label: request.label, ref: { projectId: value.ref.projectId, sessionId: value.ref.sessionId },
        role: structuredClone(request.role) };
    }
    async function createMaintainerLine(request: { label: string; duty: 'executor' | 'adviser';
      modules?: readonly string[] | undefined; requestId?: string }): Promise<MaintainerLine> {
      return await createWithRole({ ...request, role: platformRoleProfile(request.duty).template });
    }
    async function createRoleSpecLine(request: { label: string; content: RoleSpecContentV1;
      modules?: readonly string[] | undefined; requestId?: string }): Promise<MaintainerLine> {
      const roleId = `s8b-role-${request.label}`;
      const commandId = `s8b-role-install-${request.label}`;
      const installed = await platform.roles.installRoleSpec(base.ctx, {
        commandId, commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
        correlationId: roleId, submittedAt: '2026-11-02T00:00:00.000Z',
        identity: { projectId: scope.projectId, actor: { ...hostActor }, idempotencyKey: commandId },
        payload: { roleId, revision: 1, content: request.content,
          contentDigest: roleSpecContentDigest(request.content, roleId, 1) } });
      if (installed.status !== 'committed') {
        throw new Error(`S8B maintainer world: the role spec ${roleId} was not installed: ${JSON.stringify(installed)}`);
      }
      const role: RoleConfigurationRef = { kind: 'role_spec',
        pin: { ref: installed.revisionRef, digest: installed.contentDigest } };
      return await createWithRole({ ...request, role });
    }

    async function link(request: { line: MaintainerLine | SessionRef; target: WorkLinkTarget;
      active?: boolean; requestId: string }): Promise<MaintainerLinkStep> {
      const session = lineRefOf(request.line);
      const card = await readCard(session);
      const existing = card.links.find(entry =>
        canonicalKey(entry.ref) === canonicalKey(responsibleLinkRef(session, request.target)));
      const expected: VersionPin[] = [
        { ref: card.record.ref, revision: card.record.revision },
        { ref: responsibleLinkRef(session, request.target), revision: existing?.revision ?? 0 },
      ];
      const body = graphWrite(scope, { sessionRef: session, target: request.target, relation: 'responsible',
        active: request.active ?? true }, request.requestId, expected);
      const answer = await postRoute('sessions/link', body);
      return { result: answer.body as WriteResult<SessionWorkLink>, expected };
    }

    async function transfer(request: { from: MaintainerLine | SessionRef; to: MaintainerLine | SessionRef;
      target: WorkLinkTarget; requestId: string }): Promise<MaintainerTransferStep> {
      const from = lineRefOf(request.from);
      const to = lineRefOf(request.to);
      const fromCard = await readCard(from);
      const toCard = await readCard(to);
      const fromLink = fromCard.links.find(entry =>
        canonicalKey(entry.ref) === canonicalKey(responsibleLinkRef(from, request.target)));
      const toLink = toCard.links.find(entry =>
        canonicalKey(entry.ref) === canonicalKey(responsibleLinkRef(to, request.target)));
      const expected: VersionPin[] = [
        { ref: fromCard.record.ref, revision: fromCard.record.revision },
        { ref: toCard.record.ref, revision: toCard.record.revision },
        { ref: responsibleLinkRef(from, request.target), revision: fromLink?.revision ?? 0 },
        { ref: responsibleLinkRef(to, request.target), revision: toLink?.revision ?? 0 },
      ];
      const answer = await postRoute('sessions/transfer-responsibility', graphWrite(scope,
        { from, to, target: request.target }, request.requestId, expected));
      return { result: answer.body as WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>, expected };
    }

    async function archiveLine(request: { line: MaintainerLine | SessionRef; tasks: readonly ArchiveTaskChoiceV1[];
      reason?: string; requestId: string }): Promise<MaintainerArchiveStep> {
      const session = lineRefOf(request.line);
      const card = await readCard(session);
      const expected: VersionPin[] = [{ ref: card.record.ref, revision: card.record.revision }];
      const body = graphWrite(scope, {
        sessionRef: session, reason: request.reason ?? 'S8B maintainer archive',
        tasks: [...request.tasks], wait: null,
      }, request.requestId, expected);
      const answer = await postRoute('sessions/archive-line', body);
      return { result: answer.body as ReadResult<ArchiveLineResultV1>, expected };
    }
    async function continueArchive(request: { line: MaintainerLine | SessionRef; archiveRequestId: string }):
    Promise<ReadResult<ArchiveLineResultV1>> {
      const answer = await postRoute('sessions/archive-continue', plain(scope, {
        sessionRef: lineRefOf(request.line), archiveRequestId: request.archiveRequestId,
      }));
      return answer.body as ReadResult<ArchiveLineResultV1>;
    }

    async function handoff(request: { source: MaintainerLine | SessionRef;
      commandId: string }): Promise<MaintainerHandoffStep> {
      const source = lineRefOf(request.source);
      const accepted = await platform.sessionHandoff.acceptHandoff(base.ctx, {
        commandId: request.commandId, workspace: { ...scope }, source, trigger: 'manual',
        assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: [] }],
      });
      if (accepted.status !== 'committed') {
        throw new Error(`S8B maintainer world: the handoff accept was refused: ${JSON.stringify(accepted)}`);
      }
      const operation = accepted.value.operation;
      const owner = platform.workflow.sessionHandoff;
      const step = async (call: Promise<ReadResult<HandoffProgressV1>>): Promise<HandoffProgressV1> => {
        const progress = await call;
        if (progress.status !== 'ready') {
          throw new Error(`S8B maintainer world: the handoff advance is not ready: ${JSON.stringify(progress)}`);
        }
        return progress.value;
      };
      // The published continuation entry first, then the advance until the operation finishes (the same loop the
      // frozen S6B2 driver runs); a refusal stops the row here instead of fabricating a successor.
      let progress = await step(owner.continueHandoff(systemContext, { operation }));
      for (let index = 0; index < 32; index += 1) {
        if (progress.phase === 'completed' || progress.phase === 'failed'
          || progress.stage === 'finished' || progress.lastRefusal !== null) break;
        progress = await step(owner.advance(systemContext, { operation }));
      }
      if (progress.successor === null) {
        throw new Error(`S8B maintainer world: the handoff stopped without a successor: ${JSON.stringify(progress)}`);
      }
      const saved = valueOf<SessionOperationRecordOf<HandoffActionV1>>(
        (await postRoute('sessions/operation', plain(scope, operation))).body, 'ready', 'the handoff operation');
      return { accepted: accepted.value, progress, successor: progress.successor, operation: saved };
    }

    async function findByTarget(target: WorkLinkTarget, includeArchived = false): Promise<SessionCard[]> {
      const page = valueOf<SessionPage<SessionCard>>((await postRoute('sessions/find', plain(scope, {
        workspace: { ...scope }, target, includeArchived, page: { limit: 100 },
      }))).body, 'ready', `the ${target.kind} target page`);
      return page.items;
    }

    async function reopenHost(sqliteDirectory: string): Promise<void> {
      if (input.backend !== 'sqlite') throw new Error('S8B maintainer world: reopenHost is SQLite only');
      if (reopenRoot === null) reopenRoot = await mkdtemp(join(tmpdir(), 's8b-maintainer-reopen-'));
      await server?.close();
      server = undefined;
      await platform.close();
      const reopened = await createTargetPlatform({
        storage: { kind: 'sqlite', directory: sqliteDirectory },
        workspace: reopenHostBindings,
        now: () => '2026-11-02T00:00:00.000Z',
        architectureSource: { provider: 'typescript', configPath: null },
      });
      reopenedPlatforms.push(reopened);
      platform = reopened;
      await startServer();
    }

    let lines: MaintainerWorld['lines'];
    if (input.lines === 'w4' || input.lines === 'flat') {
      const regionLink = input.lines === 'w4' ? 'src' : 'root';
      const deeper = input.lines === 'w4' ? 'src/a/x' : 'flat2';
      const L1 = await createMaintainerLine({ label: 'L1', duty: 'executor', requestId: 's8b-w4-l1' });
      // The module link is its own `sessions/link` step after create, never a create initial link.
      await link({ line: L1, target: module(regionLink), requestId: 's8b-w4-l1-module' });
      lines = {
        L1,
        L2: await createMaintainerLine({ label: 'L2', duty: 'adviser', modules: [regionLink], requestId: 's8b-w4-l2' }),
        L3: await createMaintainerLine({ label: 'L3', duty: 'adviser', modules: [deeper], requestId: 's8b-w4-l3' }),
        A1: await createMaintainerLine({ label: 'A1', duty: 'adviser', requestId: 's8b-w4-a1' }),
      };
    } else {
      lines = {
        L1: await createMaintainerLine({ label: 'L1', duty: 'executor', modules: input.w0Maintained, requestId: 's8b-w0-l1' }),
        L2: await createMaintainerLine({ label: 'L2', duty: 'executor', requestId: 's8b-w0-l2' }),
        L3: await createMaintainerLine({ label: 'L3', duty: 'executor', requestId: 's8b-w0-l3' }),
        A1: await createMaintainerLine({ label: 'A1', duty: 'adviser', requestId: 's8b-w0-a1' }),
      };
    }

    const world: MaintainerWorld = {
      backend: input.backend, projectId: MAINTAINER_PROJECT_ID, scope, ctx: base.ctx, member,
      get platform() { return platform; },
      get base() { return baseUrl; },
      token, postRoute, dispatch, module, lines, createMaintainerLine, createRoleSpecLine, readCard, readLink,
      link, transfer, archiveLine, continueArchive, handoff, findByTarget, reopenHost,
      async close() {
        await server?.close();
        for (const reopened of reopenedPlatforms.splice(0)) await reopened.close().catch(() => undefined);
        if (reopenRoot !== null) await rm(reopenRoot, { recursive: true, force: true }).catch(() => undefined);
        await base.close();
      },
    };
    return world;
  } catch (error) {
    await server?.close().catch(() => undefined);
    for (const reopened of reopenedPlatforms.splice(0)) await reopened.close().catch(() => undefined);
    if (reopenRoot !== null) await rm(reopenRoot, { recursive: true, force: true }).catch(() => undefined);
    await base.close().catch(() => undefined);
    throw error;
  }
}

/** W0: project/workspace p1, modules M/M2/N, executor L1/L2/L3, adviser A1, the person and member contexts, HTTP. */
export async function openMaintainerWorld0(options: { backend: Backend;
  /** R-07's parameter: the two maintained module ids the catalog declares; default `M`/`M2`. */
  maintainerModuleIds?: readonly string[] | undefined }): Promise<MaintainerWorld> {
  const maintained = options.maintainerModuleIds ?? W0_MODULE_IDS;
  return await openWorld({ backend: options.backend, catalog: w0Catalog(maintained),
    baselineId: 's8b-w0-baseline', lines: 'executor-three', w0Maintained: options.maintainerModuleIds });
}

/** R-07: W0 with the actual ids `\uE000` / `\u{10000}`, L1 maintaining both through real initial links. */
export async function openMaintainerWorld0PrivateUse(options: { backend: Backend }): Promise<MaintainerWorld> {
  return await openMaintainerWorld0({ backend: options.backend, maintainerModuleIds: W0_PRIVATE_USE_MODULE_IDS });
}

/** W4: the fixed B-04 catalog and lines; L1 maintains `src`, L2 advises `src`, L3 advises `src/a/x`. */
export async function openMaintainerWorld4(options: { backend: Backend }): Promise<MaintainerWorld> {
  return await openWorld({ backend: options.backend, catalog: structuredClone(W4_CATALOG),
    baselineId: 's8b-w4-baseline', lines: 'w4' });
}

/** The flat world: `root` and `flat2` with no containment; L2's region is `root` only. */
export async function openMaintainerWorldFlat(options: { backend: Backend }): Promise<MaintainerWorld> {
  return await openWorld({ backend: options.backend, catalog: structuredClone(FLAT_CATALOG),
    baselineId: 's8b-flat-baseline', lines: 'flat' });
}

/** The single-root world: only `root`, with W0's lines and no module link. */
export async function openMaintainerWorldRoot(options: { backend: Backend }): Promise<MaintainerWorld> {
  return await openWorld({ backend: options.backend, catalog: structuredClone(ROOT_CATALOG),
    baselineId: 's8b-root-baseline', lines: 'executor-three' });
}

