/**
 * The line owner (kls-design §2.3.1, lead rulings KLS-3a and KLS-3b): `registerLine` writes a workspace's lines'
 * identity, `settleLine` their end, and `readLine` and `readLines` are the reads behind `workspaces/lines`. The Host
 * registers a line when it opens a workspace or another checkout of its repository (`src/app/host.ts`), and judges
 * and settles its end at its safe points.
 *
 * `registerLine` keeps one line per (workspace, folder): a folder that already has its line answers that line and
 * writes no record (the event still commits, so the answer carries a real cursor, as `lines/pin`'s no-op does), unless
 * the folder switched branch (or first commit) while its line is open: then the line moves to it. Both writes go
 * through `state/line-machine.ts`; `settleLine` is the only writer of a line's status.
 */
import { principalIdentity, type CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommandMeta, VersionPin } from '../../../contracts/core/identity.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { defineShape, f } from '../../../contracts/data-format.js';
import { id } from '../../../contracts/data-format-refs.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import type { WorkspaceRef } from '../../../contracts/ledger.js';
import { LineRefShape, sameCheckout, type LineSnapshot } from '../../../contracts/line.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { ProjectRegistrationPort, RegisterLineInputV1, SettleLineInputV1 } from './project-bootstrap-contracts.js';
import { executeWriteCommand, type Keys } from '../persistence/command-executor.js';
import {
  lineChangedCodec, lineCodec, lineRecordKey, lineRegisteredCodec, readLineRecord, readProjectLines,
  type LineChangedEventV1, type LineRegisteredEventV1,
} from '../persistence/line-record-codecs.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { newLineRecord, nextLineClosed, nextLineIdentity } from '../state/line-machine.js';

export type LineServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  now(): string;
};

export type LineService = Pick<ProjectRegistrationPort, 'registerLine' | 'settleLine' | 'readLine' | 'readLines'>;

const RegisterLineInputShape = defineShape({ name: 'RegisterLineInput', fields: {
  workspaceId: id, line: f.object({ ...LineRefShape.fields, firstCommit: f.nullable(id) }), forkPoint: f.nullable(id),
} });

const SettleLineInputShape = defineShape({ name: 'SettleLineInput', fields: {
  workspaceId: id, folder: id, status: f.enumOf(['merged', 'removed']),
} });

/** `horizon`: the line set's read position; the commit CASes on it, so two first lines cannot both pass `sameCheckout`. */
type Facts = { workspaceRevision: number; existing: LineSnapshot | null; lines: LineSnapshot[]; horizon: CommitCursor | null };
type Decision = { line: LineSnapshot; existing: LineSnapshot | null; horizon: CommitCursor | null };

/** The call's workspace, its key and the one Workspace version pin a line write takes (both writes alike). */
type WorkspacePin = { scope: { projectId: string; workspaceId: string }; ref: WorkspaceRef; key: string;
  pin: VersionPin; pins: readonly VersionPin[]; requestId: string };

function workspacePinOf(ctx: CoreCallContext, workspaceId: string, meta: CommandMeta, operation: string):
  WorkspacePin | CoreRejection {
  if (ctx.workspaceId !== workspaceId) return rejected('forbidden', 'the line belongs to another workspace than the call');
  const ref: WorkspaceRef = { aggregateType: 'Workspace', projectId: ctx.projectId, workspaceId };
  const key = canonicalRefKey(ref);
  if (typeof meta?.requestId !== 'string' || meta.requestId === '') return rejected('invalid', `${operation} requires meta.requestId`);
  const pins = Array.isArray(meta.expected) ? meta.expected : [];
  const pin = pins.length === 1 && canonicalRefKey(pins[0]!.ref) === key ? pins[0]! : null;
  if (pin === null) return rejected('invalid', `${operation} takes exactly the Workspace version pin`);
  return { scope: { projectId: ctx.projectId, workspaceId }, ref, key, pin, pins, requestId: meta.requestId };
}

export function createLineService(deps: LineServiceDependencies): LineService {
  /** The registered Workspace's revision, read inside a write's facts. */
  async function workspaceRevision(workspace: WorkspacePin): Promise<number | CoreRejection> {
    const read = await deps.records.readMany([workspace.key]);
    if (read.status !== 'ready') return storeFailureToRejection(read);
    const record = read.value.records.find(entry => entry.refKey === workspace.key);
    if (record === undefined) return rejected('not_found', `the workspace ${workspace.scope.workspaceId} is not registered`);
    const decoded = decodeWorkspaceSnapshot(record);
    return decoded.status === 'decoded' ? decoded.value.revision
      : rejected('unavailable', `the workspace record is damaged: ${decoded.reason}`);
  }

  function pinConflict(workspace: WorkspacePin, revision: number): CoreRejection | null {
    return revision === workspace.pin.revision ? null
      : rejectedWithCurrent('revision_conflict', 'the Workspace pin does not match the version read',
        [{ ref: workspace.ref, revision } as VersionPin]);
  }

  async function registerLine(ctx: CoreCallContext, request: GraphWrite<RegisterLineInputV1>):
    Promise<WriteResult<LineSnapshot>> {
    // Safety: a line names a folder the project's Runs will work in, so only the Host, which probed the checkout, names one.
    if (ctx.principal.kind !== 'host') return rejected('forbidden', 'only the Host registers a line');
    const input = structuredClone(request.input);
    const problem = checkShape(RegisterLineInputShape, input, 'stored');
    if (problem !== null) return rejected('invalid', problem);
    const workspace = workspacePinOf(ctx, input.workspaceId, request.meta, 'registerLine');
    if ('status' in workspace) return workspace;
    const scope = workspace.scope;
    const key = lineRecordKey(scope.projectId, scope.workspaceId, input.line.folder);
    const written = await executeWriteCommand<Facts, Decision, CoreRejection, LineRegisteredEventV1, LineSnapshot>(
      deps.records, {
        operation: 'line.register', scope, principal: principalIdentity(ctx.principal), commandId: workspace.requestId,
        fingerprintInput: { input, expected: workspace.pins } as unknown as JsonValue,
        async read() {
          const revision = await workspaceRevision(workspace);
          if (typeof revision !== 'number') return revision;
          const existing = await readLineRecord(deps.records, scope.projectId, scope.workspaceId, input.line.folder);
          if (existing.status === 'rejected') return existing;
          const lines = await readProjectLines(deps.records, scope.projectId, scope.workspaceId);
          if (lines.status !== 'ready') return lines;
          return { status: 'ready', facts: { workspaceRevision: revision,
            existing: existing.status === 'ready' ? existing.value : null, lines: lines.value, horizon: lines.watermark } };
        },
        decide(facts) {
          const conflict = pinConflict(workspace, facts.workspaceRevision);
          if (conflict !== null) return { refuse: conflict };
          const existing = facts.existing;
          if (existing !== null) {
            // KLS-3b (ruling 7): an open line whose folder switched branch moves to it, forked anew at the switch; a
            // closed line never reopens and an unchanged one writes nothing.
            const moved = existing.status === 'open'
              && (existing.branch !== input.line.branch || existing.firstCommit !== input.line.firstCommit);
            return { decision: { existing, horizon: facts.horizon, line: moved ? nextLineIdentity(existing,
              { branch: input.line.branch, firstCommit: input.line.firstCommit, forkPoint: input.forkPoint }) : existing } };
          }
          // Coordination: a workspace is one repository (121-64); module ids and claims are kept per workspace, so a
          // checkout of another repository cannot share them.
          if (facts.lines.some(line => !sameCheckout(line, input.line))) {
            return { refuse: rejected('invalid', `the folder ${input.line.folder} is a checkout of another repository than this workspace`) };
          }
          return { decision: { existing: null, horizon: facts.horizon, line: newLineRecord({ projectId: scope.projectId,
            workspaceId: scope.workspaceId, line: input.line, forkPoint: input.forkPoint, now: deps.now() }) } };
        },
        build(decision, keys: Keys) {
          const event: LineRegisteredEventV1 = { eventId: `${keys.identityKey}:registered`, eventType: 'LineRegistered',
            schemaVersion: 1, occurredAt: deps.now(), projectId: scope.projectId, workspaceId: scope.workspaceId,
            line: decision.line };
          return {
            records: decision.line === decision.existing ? [] : [lineCodec.encode(decision.line)],
            guards: [{ refKey: workspace.key, expectedRevision: workspace.pin.revision },
              { refKey: key, expectedRevision: decision.existing === null ? null : decision.existing.revision }],
            claims: [],
            events: [lineRegisteredCodec.encode(event)],
            // Coordination: a line registered meanwhile moves the ledger; the executor reads the set again and
            // `sameCheckout` judges it anew (no lock).
            ledgerHorizon: decision.horizon,
          };
        },
        retryable: { horizon: true },
        result: {
          eventType: 'LineRegistered', schemaVersion: 1,
          decode: event => lineRegisteredCodec.decode(event),
          validate: event => event.projectId === scope.projectId && event.workspaceId === scope.workspaceId
            ? null : 'the recorded line belongs to another workspace',
          project: event => event.line,
        },
      });
    return written.status === 'refused' ? written.refusal : written;
  }

  async function settleLine(ctx: CoreCallContext, request: GraphWrite<SettleLineInputV1>):
    Promise<WriteResult<LineSnapshot>> {
    const input = structuredClone(request.input);
    const problem = checkShape(SettleLineInputShape, input, 'stored');
    if (problem !== null) return rejected('invalid', problem);
    const workspace = workspacePinOf(ctx, input.workspaceId, request.meta, 'settleLine');
    if ('status' in workspace) return workspace;
    const scope = workspace.scope;
    const key = lineRecordKey(scope.projectId, scope.workspaceId, input.folder);
    const written = await executeWriteCommand<{ workspaceRevision: number; line: LineSnapshot },
      { current: LineSnapshot; next: LineSnapshot }, CoreRejection, LineChangedEventV1, LineSnapshot>(deps.records, {
      operation: 'line.settle', scope, principal: principalIdentity(ctx.principal), commandId: workspace.requestId,
      fingerprintInput: { input, expected: workspace.pins } as unknown as JsonValue,
      async read() {
        const revision = await workspaceRevision(workspace);
        if (typeof revision !== 'number') return revision;
        const line = await readLineRecord(deps.records, scope.projectId, scope.workspaceId, input.folder);
        if (line.status === 'not_found') return rejected('not_found', `the folder ${input.folder} is not a line of this workspace`);
        return line.status === 'ready' ? { status: 'ready', facts: { workspaceRevision: revision, line: line.value } } : line;
      },
      decide(facts) {
        const conflict = pinConflict(workspace, facts.workspaceRevision);
        if (conflict !== null) return { refuse: conflict };
        // Coordination: a line ends once; its end is kept as it was written.
        if (facts.line.status !== 'open') return { refuse: rejected('invalid', 'the line is already closed') };
        return { decision: { current: facts.line, next: nextLineClosed(facts.line, input.status, deps.now()) } };
      },
      build(decision, keys: Keys) {
        const event: LineChangedEventV1 = { eventId: `${keys.identityKey}:changed`, eventType: 'LineChanged',
          schemaVersion: 1, occurredAt: deps.now(), projectId: scope.projectId, workspaceId: scope.workspaceId,
          line: decision.next };
        return {
          records: [lineCodec.encode(decision.next)],
          guards: [{ refKey: workspace.key, expectedRevision: workspace.pin.revision },
            { refKey: key, expectedRevision: decision.current.revision }],
          claims: [],
          events: [lineChangedCodec.encode(event)],
        };
      },
      result: {
        eventType: 'LineChanged', schemaVersion: 1,
        decode: event => lineChangedCodec.decode(event),
        validate: event => event.projectId === scope.projectId && event.workspaceId === scope.workspaceId
          ? null : 'the recorded line belongs to another workspace',
        project: event => event.line,
      },
    });
    return written.status === 'refused' ? written.refusal : written;
  }

  return {
    registerLine,
    settleLine,
    async readLine(ctx, input) {
      return readLineRecord(deps.records, ctx.projectId, input.workspaceId, input.folder);
    },
    async readLines(ctx, input) {
      const lines = await readProjectLines(deps.records, ctx.projectId, input.workspaceId);
      return lines.status === 'ready' ? { status: 'ready', value: { lines: lines.value } } : lines;
    },
  };
}
