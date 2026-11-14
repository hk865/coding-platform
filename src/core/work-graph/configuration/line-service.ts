/**
 * The line owner (kls-design §2.3.1, lead rulings KLS-3a): `registerLine` is the one writer of a workspace's line
 * records, `readLine` and `readLines` the reads behind `lines/list`. The Host registers a line when it opens a
 * workspace (`src/app/host.ts`); KLS-3b's join adds a line through the same entry.
 *
 * `registerLine` keeps one line per (workspace, folder): a folder that already has its line answers that line and
 * writes no record (the event still commits, so the answer carries a real cursor, as `lines/pin`'s no-op does).
 */
import { principalIdentity, type CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
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
import type { ProjectRegistrationPort, RegisterLineInputV1 } from './project-bootstrap-contracts.js';
import { executeWriteCommand, type Keys } from '../persistence/command-executor.js';
import {
  lineCodec, lineRecordKey, lineRegisteredCodec, readLineRecord, readProjectLines, type LineRegisteredEventV1,
} from '../persistence/line-record-codecs.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { newLineRecord } from '../state/line-machine.js';

export type LineServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  now(): string;
};

export type LineService = Pick<ProjectRegistrationPort, 'registerLine' | 'readLine' | 'readLines'>;

const RegisterLineInputShape = defineShape({ name: 'RegisterLineInput', fields: {
  workspaceId: id, line: f.object({ ...LineRefShape.fields, firstCommit: f.nullable(id) }), forkPoint: f.nullable(id),
} });

/** `horizon`: the line set's read position; the commit CASes on it, so two first lines cannot both pass `sameCheckout`. */
type Facts = { workspaceRevision: number; existing: LineSnapshot | null; lines: LineSnapshot[]; horizon: CommitCursor | null };
type Decision = { line: LineSnapshot; existing: LineSnapshot | null; horizon: CommitCursor | null };

export function createLineService(deps: LineServiceDependencies): LineService {
  async function registerLine(ctx: CoreCallContext, request: GraphWrite<RegisterLineInputV1>):
    Promise<WriteResult<LineSnapshot>> {
    // Safety: a line names a folder the project's Runs will work in, so only the Host, which probed the checkout, names one.
    if (ctx.principal.kind !== 'host') return rejected('forbidden', 'only the Host registers a line');
    const input = structuredClone(request.input);
    const problem = checkShape(RegisterLineInputShape, input, 'stored');
    if (problem !== null) return rejected('invalid', problem);
    if (ctx.workspaceId !== input.workspaceId) return rejected('forbidden', 'the line belongs to another workspace than the call');
    const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: ctx.projectId, workspaceId: input.workspaceId };
    const workspaceKey = canonicalRefKey(workspaceRef);
    const meta = request.meta;
    if (typeof meta?.requestId !== 'string' || meta.requestId === '') return rejected('invalid', 'registerLine requires meta.requestId');
    const pins = Array.isArray(meta.expected) ? meta.expected : [];
    const pin = pins.length === 1 && canonicalRefKey(pins[0]!.ref) === workspaceKey ? pins[0]! : null;
    if (pin === null) return rejected('invalid', 'registerLine takes exactly the Workspace version pin');
    const scope = { projectId: ctx.projectId, workspaceId: input.workspaceId };
    const key = lineRecordKey(scope.projectId, scope.workspaceId, input.line.folder);
    const written = await executeWriteCommand<Facts, Decision, CoreRejection, LineRegisteredEventV1, LineSnapshot>(
      deps.records, {
        operation: 'line.register', scope, principal: principalIdentity(ctx.principal), commandId: meta.requestId,
        fingerprintInput: { input, expected: pins } as unknown as JsonValue,
        async read() {
          const read = await deps.records.readMany([workspaceKey]);
          if (read.status !== 'ready') return storeFailureToRejection(read);
          const record = read.value.records.find(entry => entry.refKey === workspaceKey);
          if (record === undefined) return rejected('not_found', `the workspace ${input.workspaceId} is not registered`);
          const workspace = decodeWorkspaceSnapshot(record);
          if (workspace.status !== 'decoded') return rejected('unavailable', `the workspace record is damaged: ${workspace.reason}`);
          const existing = await readLineRecord(deps.records, scope.projectId, scope.workspaceId, input.line.folder);
          if (existing.status === 'rejected') return existing;
          const lines = await readProjectLines(deps.records, scope.projectId, scope.workspaceId);
          if (lines.status !== 'ready') return lines;
          return { status: 'ready', facts: { workspaceRevision: workspace.value.revision,
            existing: existing.status === 'ready' ? existing.value : null, lines: lines.value, horizon: lines.watermark } };
        },
        decide(facts) {
          if (facts.workspaceRevision !== pin.revision) {
            return { refuse: rejectedWithCurrent('revision_conflict', 'the Workspace pin does not match the version read',
              [{ ref: workspaceRef, revision: facts.workspaceRevision } as VersionPin]) };
          }
          if (facts.existing !== null) {
            return { decision: { line: facts.existing, existing: facts.existing, horizon: facts.horizon } };
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
            records: decision.existing === null ? [lineCodec.encode(decision.line)] : [],
            guards: [{ refKey: workspaceKey, expectedRevision: pin.revision },
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

  return {
    registerLine,
    async readLine(ctx, input) {
      return readLineRecord(deps.records, ctx.projectId, input.workspaceId, input.folder);
    },
    async readLines(ctx, input) {
      const lines = await readProjectLines(deps.records, ctx.projectId, input.workspaceId);
      return lines.status === 'ready' ? { status: 'ready', value: { lines: lines.value } } : lines;
    },
  };
}
