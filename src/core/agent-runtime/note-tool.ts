/**
 * Slice 4C L14: the `record_note` platform tool.
 *
 * One new coordination tool with three strictly separated `op` branches:
 *  - `write` maps the model's draft to `NoteDraftV1`, calls the SAME
 *    `NoteWritePort.writeNote` the person's route uses, and on a successful
 *    commit calls `NoteCheckPort.checkNotes({ withSimilar: true })`. A failed
 *    check is reported as `{ status: 'unavailable', reason }` and NEVER undoes
 *    the write; a rejected write commits nothing and returns `{ write, check }`
 *    with the write's reason (never a fabricated successful check).
 *  - `review` / `withdraw` call `reviewNote` / `withdrawNote` and return the
 *    real `NoteDispositionResult` verbatim, including its receipt.
 *
 * The tool is a thin adapter. The trusted context is snapshotted from the
 * factory config (never model JSON); the bound Run, plan and catalog revisions
 * are resolved by the note service from that context, never by the model. The
 * note service remains the one owner of authority: a non-scribe `review` gets
 * the service's `forbidden`, not a second tool-level check.
 */
import { messageOf } from '../../contracts/error-message.js';
import type { NoteKind } from '../../contracts/note.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type {
  NoteCheckPort, NoteCheckV1, NoteDispositionResult, NoteWritePort, WriteNoteInput,
} from '../work-graph/model/note-contracts.js';
import {
  recordNoteRequestOf, type RecordNoteArgs, type RecordNoteRequestV1,
} from '../work-graph/model/note-contracts.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

/** Typed view: the generated pack's literal `tools` object has no string index signature. */
const PLATFORM_TOOL_TEXTS: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;

// K3 (decision 72, U1): the shared builder lives in WorkGraph/model so the owner
// lookup can use it too; it stays exported here for the existing tool surface.
export { recordNoteRequestOf };
export type { RecordNoteRequestV1 };

export const NOTE_TOOL_NAMES = ['record_note'] as const;

export type NoteToolsConfig = {
  /** Trusted, already-bound context. Snapshotted at factory creation. */
  context: CoreCallContext;
  /** The SAME write service the `notes/*` routes bind. */
  notes: NoteWritePort;
  /** The SAME derivation owner `notes.checkNotes` exposes (L22). */
  check: Pick<NoteCheckPort, 'checkNotes'>;
  /** Trusted command identity: Kernel `ToolCall.callId` + bound Run/operation. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** The write kinds this caller admits, in the declaration's order. */
  kinds: readonly NoteKind[];
  /** Whether the caller admits the withdraw operation. */
  withdraw: boolean;
  /** The platform tools' model-facing texts; defaults to the generated pack. */
  texts?: Readonly<Record<string, ToolTextV1>>;
};

export type NoteToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}

/**
 * RW-15: the note service echoes the accepted model draft in a rejection
 * (`draft.note`), and a bodyless general-kind draft leaves `note.body`
 * `undefined`. `jsonValueSchema` (the frozen Kernel's output validator) rejects
 * a nested `undefined`, which would fail the Run after a correctable model
 * mistake. This returns a value the Kernel accepts: `undefined` object
 * properties and array entries are dropped recursively, `null`/`false`/`0`/`''`
 * are kept, and every value without `undefined` is structurally unchanged.
 */
function jsonSafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter(entry => entry !== undefined).map(entry => jsonSafe(entry));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) out[key] = jsonSafe(entry);
    }
    return out;
  }
  return value;
}

function outputValue(value: unknown): ToolResult['output'] {
  return [{ kind: 'json', value: jsonSafe(value) as never }];
}

function success(callId: string, value: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: outputValue(value), effects: noneEffects() };
}

/**
 * RW-15: a per-kind field mismatch the strict input schema can express is
 * answered before the service call, in the SAME `{ write, check }` shape the
 * tool uses for a rejected write, with the service's own reason text. The
 * service still owns body/sections PRESENCE (GTN02/RW-14 pin the bodyless
 * pass-through); this only catches a body on an understanding or sections on a
 * general kind.
 */
function rejectedWrite(callId: string, reason: string): ToolResult {
  return success(callId, {
    write: { status: 'rejected', code: 'invalid', reason },
    check: { status: 'unavailable', reason },
  });
}

function failure(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: [], effects: noneEffects(),
  };
}

// --------------------------------------------------------------------------
// Strict model-facing schemas. The trusted Goal, Run, plan/catalog revisions
// and authority are bound by config, so a model-supplied identity/scope key is
// an unknown key and fails before the write owner is reached. `write` carries
// the draft; the service validates the kind/body/sections split.
// --------------------------------------------------------------------------

const symbolRequestSchema = z.object({
  language: z.string().min(1),
  name: z.string().min(1),
  range: z.object({ startLine: z.number().int().min(0), endLine: z.number().int().min(0) }).strict().optional(),
}).strict();

const draftAnchorSchema: z.ZodType = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('module'), moduleId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('interface'), moduleId: z.string().min(1), interfaceId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('file'), path: z.string().min(1), symbolRequest: symbolRequestSchema.optional(),
    deleted: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('goal'), goalId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('stage'), goalId: z.string().min(1), stageId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('task'), goalId: z.string().min(1), taskId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('project') }).strict(),
]);

const sectionsSchema = z.object({
  status: z.string().min(1), decided: z.string().min(1), open: z.string().min(1),
  next: z.string().min(1), risks: z.string().min(1),
}).strict();

export function createNoteTools(config: NoteToolsConfig): NoteToolsHandle {
  const description = (config.texts?.['record_note']
    ?? PLATFORM_TOOL_TEXTS['record_note']!).description;
  if (config.kinds.length === 0) {
    // An empty declaration would register a tool that can only be refused;
    // fail at construction instead of hiding that misconfiguration.
    throw new Error('the note tool requires at least one admitted write kind');
  }
  // The declaration follows the caller's admission: the write kind enum holds
  // exactly the admitted kinds. The withdraw operation exists only when
  // admitted. The review operation belongs to the full Work declaration, which
  // alone admits `repair`; a Query must not be shown it.
  const writeSchema = z.object({
    op: z.literal('write'),
    kind: z.enum(config.kinds),
    topic: z.string().min(1),
    conclusion: z.string().min(1),
    anchor: draftAnchorSchema,
    extraAnchors: z.array(draftAnchorSchema).max(4).optional(),
    facts: z.array(z.record(z.string(), z.unknown())).optional(),
    basisFiles: z.array(z.string().min(1)).optional(),
    replaces: z.array(z.string().min(1)).optional(),
    contradicts: z.array(z.string().min(1)).optional(),
    coexistWith: z.array(z.string().min(1)).optional(),
    structural: z.boolean().optional(),
    body: z.string().optional(),
    sections: sectionsSchema.optional(),
    expectedPointerRevision: z.number().int().min(0).nullable().optional(),
  }).strict();
  const reviewSchema = z.object({
    op: z.literal('review'),
    noteId: z.string().min(1),
    expectedVersion: z.number().int().min(1),
    verdict: z.enum(['review', 'accept', 'reject']),
    resolution: z.enum(['supersede', 'coexist']).optional(),
    reason: z.string().min(1).nullable().optional(),
    expectedPointerRevision: z.number().int().min(0).nullable().optional(),
  }).strict();
  const withdrawSchema = z.object({
    op: z.literal('withdraw'),
    noteId: z.string().min(1),
    expectedVersion: z.number().int().min(1),
    reason: z.string().min(1).nullable().optional(),
  }).strict();
  const optionSchemas: [typeof writeSchema, ...(typeof writeSchema | typeof reviewSchema | typeof withdrawSchema)[]] =
    [writeSchema];
  if (config.kinds.includes('repair')) optionSchemas.push(reviewSchema);
  if (config.withdraw) optionSchemas.push(withdrawSchema);
  const recordNoteSchema = z.discriminatedUnion('op', optionSchemas);
  // Freeze the trusted scope/identity before returning the factory.
  const fixedProjectId = config.context.projectId;
  const fixedWorkspaceId = config.context.workspaceId;
  const fixedPrincipal = structuredClone(config.context.principal);
  const fixedMaterialReader = structuredClone(config.context.materialReader);
  const fixedNotes = config.notes;
  const fixedCheck = config.check;

  function snapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: fixedProjectId,
      ...(fixedWorkspaceId === undefined ? {} : { workspaceId: fixedWorkspaceId }),
      principal: structuredClone(fixedPrincipal),
      materialReader: structuredClone(fixedMaterialReader),
      signal,
    };
  }

  async function write(callId: string, request: WriteNoteInput, context: CoreCallContext): Promise<ToolResult> {
    const result = await fixedNotes.writeNote(context, request);
    if (result.status === 'rejected') {
      // A rejected write commits nothing; the check reports the write's own
      // reason instead of pretending the write succeeded.
      return success(callId, {
        write: result,
        check: { status: 'unavailable', reason: result.reason || 'write_rejected' },
      });
    }
    let check: NoteCheckV1 | { status: 'unavailable'; reason: string };
    try {
      const checked = await fixedCheck.checkNotes(context, { items: [{ noteId: result.noteId, version: result.version }], withSimilar: true });
      if (checked.status === 'ready') {
        check = checked.value[0] ?? { status: 'unavailable', reason: 'the note check returned no item' };
      } else if (checked.status === 'rejected') {
        check = { status: 'unavailable', reason: checked.reason };
      } else {
        check = { status: 'unavailable', reason: `the note check is not ready (${checked.status})` };
      }
    } catch (error) {
      // A failed check never undoes the committed write.
      check = { status: 'unavailable', reason: messageOf(error) };
    }
    return success(callId, { write: result, check });
  }

  async function execute(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      return failure('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    const parsed = recordNoteSchema.safeParse(call.arguments);
    if (!parsed.success) return failure(callId, 'invalid_arguments', 'the tool arguments do not match the strict schema');
    let accepted: z.infer<typeof recordNoteSchema>;
    try {
      accepted = structuredClone(parsed.data);
    } catch {
      return failure(callId, 'invalid_arguments', 'the tool arguments cannot be isolated');
    }
    // RW-15: the strict schema cannot refine a discriminated union per `kind`,
    // so the one schema-expressible per-kind mismatch is answered here, before
    // the write owner is reached, as a correctable `{ write, check }` result.
    const args = accepted;
    if (args.op === 'write') {
      if (args.kind !== 'understanding' && args.sections !== undefined) {
        return rejectedWrite(callId, 'only an understanding note carries sections');
      }
      if (args.kind === 'understanding' && args.body !== undefined) {
        return rejectedWrite(callId, 'an understanding note gives sections, not a body');
      }
    }
    let commandId: string;
    try {
      commandId = config.requestIdForCall(call);
    } catch {
      return failure(callId, 'execution_failed', 'no trusted command identity is bound for this call');
    }
    if (typeof commandId !== 'string' || commandId.length === 0) {
      return failure(callId, 'execution_failed', 'the trusted command identity is empty');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) {
      return { schemaVersion: 1, callId, status: 'cancelled', reason: 'the note call was cancelled before the write',
        output: outputValue({ status: 'rejected', code: 'cancelled', reason: 'the note call was cancelled before the write' }),
        effects: noneEffects() };
    }
    try {
      // RW-14: the accepted args become a request in ONE place; the tool only
      // dispatches on the op.
      const built = recordNoteRequestOf(accepted as RecordNoteArgs, commandId);
      if (built.op === 'write') return await write(callId, built.request, context);
      if (built.op === 'review') {
        const result: NoteDispositionResult = await fixedNotes.reviewNote(context, built.request);
        return success(callId, result);
      }
      const result: NoteDispositionResult = await fixedNotes.withdrawNote(context, built.request);
      return success(callId, result);
    } catch {
      return failure(callId, 'execution_failed',
        'the note call did not return a result; its outcome is unconfirmed and it may already be committed. '
        + 'Do not report it as not committed and do not retry under a new callId.');
    }
  }

  function definitionFor(): ToolDefinition {
    return {
      name: 'record_note',
      description,
      inputSchema: recordNoteSchema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      defaultTimeoutMs: 10000,
      outputLimitBytes: 64 * 1024,
      independentReadOnly: false,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return execute(call, options.signal);
        },
      },
    };
  }

  return {
    names: NOTE_TOOL_NAMES,
    create: () => [definitionFor()],
  };
}
