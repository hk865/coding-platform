/**
 * A.2 step 4 (spec §14.3): lifecycle fields are written only by the record
 * constructors of `src/core/work-graph/state/`.
 *
 * A TypeScript checker scans every `src/` file of the `tsconfig.json`
 * Program (fixtures under `tests/` are not scanned). Protected types are the
 * §14.1 table, identified by declaration file + type name; a type is
 * protected when a union or intersection member, the type argument of
 * `Partial`/`Readonly`/`Pick`/`Omit`/`Required`, an array element, the
 * constraint of a type parameter (`<T extends P>`), or the record whose
 * properties a derived object type keeps (a re-aliased mapped type, an object
 * rest, a spread copy) is one of them. Outside `state/` and outside the §14.2
 * decoder functions:
 *
 * - R1: an object literal whose contextual type, or a type it is asserted to
 *   (`{...} as unknown as P`), is protected assigns a protected field;
 * - R2: an object literal spreads a protected value and then writes a
 *   protected field (a property, or a later spread that carries it);
 * - R3: an assignment (destructuring targets and `for…in`/`for…of` heads
 *   included), `delete`, `++`/`--` or array mutator writes a protected field,
 *   directly or through a deeper access;
 * - R4: `Object.assign` writes a protected field into a protected target or
 *   into the object a protected field holds, or a value reaches a protected
 *   field through a non-`state/` helper parameter of type `Partial<protected>`.
 *
 * The projection `CanonicalTaskState`/`TaskRow` and the read model
 * `TaskFailureFactsV1` are checked by R1/R2 only: the projection value must
 * come from `projectTaskPhase` (or copy the same projected field, never
 * through a type assertion), and the read model is produced only by
 * `buildTaskFailureFacts` inside `state/`.
 *
 * Known limits: a write through `any`, `Object.defineProperty` or
 * reflection; an in-place mutation through a local alias of a field's value
 * (`const gaps = round.gaps; gaps.push(g)`); and a literal built without a
 * protected contextual type that reaches a record only later, e.g. through an
 * encoder whose parameter is an untyped object (so every §14.2 private encoder
 * takes the record type itself).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATE_DIRECTORY = 'src/core/work-graph/state/';
const WORK_GRAPH = 'src/core/work-graph/';
const PROJECT_TASK_PHASE = { file: 'src/core/work-graph/state/task-machine.ts', name: 'projectTaskPhase' };

// -------------------------------------------------------------------------- //
// §14.1 protected record types and fields                                     //
// -------------------------------------------------------------------------- //

type ProtectedType = {
  /** Declaration file relative to the project root. */
  file: string;
  name: string;
  /** `all`: an immutable record that is only ever created whole. */
  fields: readonly string[] | 'all';
  /** The `state/` producer the report points to. */
  use: string;
  /** `record`: R1–R4; `projection` and `read_model`: R1/R2 only (§14.3). */
  kind: 'record' | 'projection' | 'read_model';
};

const RUN_FIELDS = ['status', 'outcome', 'executionAuthorization', 'controlState', 'controlInputs', 'reconciliation',
  'continuation', 'consumedWait', 'startedAt', 'endedAt', 'executionHistory', 'lastEventSeq', 'lastRuntimeEventId',
  'lastFactEventId', 'requeueRef', 'terminalPayload'] as const;
const ATTEMPT_USE = 'state/attempt-machine.ts newTaskAttemptRecord or transitionAttempt';
const OUTBOX_USE = 'state/attempt-machine.ts newDispatchOutboxRecord or transitionDispatchOutbox';
const SESSION_USE = 'state/session-availability.ts createSessionRecord, occupySessionRecord, releaseSessionRecord, '
  + 'archiveSessionRecord, reactivateSessionRecord, observeSessionHealthRecord, requestSessionArchiveRecord, '
  + 'releaseSessionArchiveRequestRecord or bindSessionUnavailableCursor';
const ROUND_USE = 'state/verification-machine.ts buildOpenedRound, withCheckPhase, buildFinalizedRound or buildSuccessorRound';
const MESSAGE_USE = 'state/message-machine.ts createSessionMessageRecord, nextSessionMessageRecord or bindMessageResponseCursor';
const MESSAGE_FIELDS = ['status', 'readAt', 'response', 'acceptedInputs', 'consultationDerivation',
  'replyHandler', 'archiveWaitDisposition', 'decision', 'application', 'responseSince'] as const;
const WORKSPACE_USE = 'state/notice-settings-machine.ts buildWorkspaceDecisionSettingsRecord or '
  + 'state/line-pin-machine.ts buildWorkspaceLineSettingsRecord';
const PROPOSAL_USE = 'state/plan-machine.ts newCandidateProposal or acceptProposalRecord';
const QUERY_USE = 'state/query-run-recovery.ts newPendingQueryRecords, advanceQueryExecutionRecord, '
  + 'markQueryRunUnknownRecord or settleQueryRunRecord';
const PROJECTION_USE = 'state/task-machine.ts projectTaskPhase';

/**
 * The §14.1 table. `state/` declares structural copies of three work-graph
 * records because it may import only `src/contracts` (`DispatchOutboxRecord`,
 * `SessionMessageRecord`, the `PlanProposal` variants); services use them too,
 * so they are protected like the declarations they copy.
 */
const PROTECTED_TYPES: readonly ProtectedType[] = [
  { file: 'src/contracts/dispatch.ts', name: 'RunSnapshot', kind: 'record', fields: RUN_FIELDS,
    use: 'state/run-machine.ts transitionRun or newRunRecord' },
  { file: 'src/contracts/dispatch.ts', name: 'TaskAttemptSnapshot', kind: 'record',
    fields: ['status', 'startedAt', 'endedAt', 'endOutcome', 'requeueRef'], use: ATTEMPT_USE },
  { file: 'src/contracts/dispatch.ts', name: 'TaskLeaseSnapshot', kind: 'record',
    fields: ['holderRunId', 'attemptId', 'release'], use: 'state/attempt-machine.ts newTaskLeaseRecord or transitionTaskLease' },
  { file: 'src/core/work-graph/model/claim-contracts.ts', name: 'TaskClaimOutbox', kind: 'record',
    fields: ['status', 'dispatchState'], use: OUTBOX_USE },
  { file: 'src/core/work-graph/state/attempt-machine.ts', name: 'DispatchOutboxRecord', kind: 'record',
    fields: ['status', 'dispatchState'], use: OUTBOX_USE },
  { file: 'src/contracts/reduction.ts', name: 'TaskReductionSnapshot', kind: 'record',
    fields: ['phase'], use: 'state/task-machine.ts newTaskReductionRecord' },
  { file: 'src/contracts/task-requeue.ts', name: 'TaskRequeueSnapshotV1', kind: 'record',
    fields: 'all', use: 'state/task-machine.ts newTaskRequeueRecord' },
  { file: 'src/contracts/task-requeue.ts', name: 'TaskReworkRefusalSnapshotV1', kind: 'record',
    fields: 'all', use: 'state/task-failure.ts newTaskReworkRefusalRecord' },
  // Slice 8 L8 (book ruling 3): the per-workspace automatic-capture request
  // record; only its state-layer constructors and projection write it.
  { file: 'src/contracts/architecture-observation.ts', name: 'ArchitectureAutoCaptureRecordV1', kind: 'record',
    fields: ['status', 'failure', 'revision', 'requestSeq'],
    use: 'state/architecture-capture.ts newArchitectureCaptureRequestRecord, newArchitectureCaptureFailureRecord or architectureAutoCaptureState' },
  { file: 'src/contracts/session-anomaly.ts', name: 'SessionAnomalyAnchorV1', kind: 'record',
    fields: 'all', use: 'state/session-anomaly.ts newSessionAnomalyAnchorRecord' },
  { file: 'src/contracts/control-intent.ts', name: 'ControlIntentSnapshotV1', kind: 'record',
    fields: ['status', 'observation', 'revision'],
    use: 'state/control-intent-machine.ts newQueuedControlIntentRecord or controlIntentRecordOf' },
  { file: 'src/contracts/core/session.ts', name: 'SessionRecord', kind: 'record',
    fields: ['lifecycle', 'health', 'occupancy', 'archivedAt', 'lastExecutionRef', 'historyCursor', 'healthConclusion',
      'provenance', 'archiveRequest', 'unavailableSince'],
    use: SESSION_USE },
  { file: 'src/contracts/verification.ts', name: 'RoundSnapshot', kind: 'record',
    fields: ['status', 'outcome', 'gaps', 'evidenceRefs', 'checks', 'chain'], use: ROUND_USE },
  { file: 'src/contracts/verification.ts', name: 'RoundCheckSnapshot', kind: 'record',
    fields: ['phase', 'invocationId', 'outcome', 'reportRef', 'sourceStatus', 'incompleteCause'],
    use: 'state/verification-machine.ts withCheckPhase' },
  { file: 'src/contracts/evidence.ts', name: 'TaskEvidenceIndexSnapshot', kind: 'record',
    fields: ['revision', 'evidenceIds'], use: 'state/verification-machine.ts nextTaskEvidenceIndex' },
  { file: 'src/core/work-graph/model/communication-contracts.ts', name: 'SessionMessage', kind: 'record',
    fields: MESSAGE_FIELDS, use: MESSAGE_USE },
  { file: 'src/core/work-graph/state/message-machine.ts', name: 'SessionMessageRecord', kind: 'record',
    fields: MESSAGE_FIELDS, use: MESSAGE_USE },
  { file: 'src/contracts/ledger.ts', name: 'GoalSnapshot', kind: 'record',
    fields: ['desiredState', 'desiredStateRevision', 'activePlanRevision', 'desiredStateRequestedBy', 'settings'],
    use: 'state/goal-machine.ts newGoalSnapshot, nextGoalPointer or nextGoalDesiredState' },
  { file: 'src/contracts/ledger.ts', name: 'WorkspaceSnapshot', kind: 'record',
    fields: ['decisionSettings', 'lineSettings'], use: WORKSPACE_USE },
  { file: 'src/contracts/goal-phase.ts', name: 'GoalPhaseSnapshot', kind: 'record',
    fields: ['phase', 'planRef', 'adoptedTaskReductions'], use: 'state/goal-machine.ts buildGoalPhaseSnapshot' },
  { file: 'src/core/work-graph/model/plan-contracts.ts', name: 'PlanProposal', kind: 'record',
    fields: ['status', 'requestRef', 'notAdopted'], use: PROPOSAL_USE },
  { file: 'src/core/work-graph/state/plan-machine.ts', name: 'CandidatePlanProposal', kind: 'record',
    fields: ['status', 'requestRef', 'notAdopted'], use: PROPOSAL_USE },
  { file: 'src/contracts/query-job.ts', name: 'QueryRunV1', kind: 'record',
    fields: ['status', 'endedAt', 'outcome'], use: QUERY_USE },
  { file: 'src/contracts/query-job.ts', name: 'QueryExecutionStateV1', kind: 'record',
    fields: ['phase'], use: QUERY_USE },
  { file: 'src/contracts/query-job.ts', name: 'QueryJobV1', kind: 'record',
    fields: ['status', 'closeReason'], use: QUERY_USE },
  // Projection: `CanonicalTaskState` and `TaskRow` carry the phase and its TD-1 cause
  // (`CanonicalTaskState.phaseCause` declared in A.2 step 5.3).
  { file: 'src/core/work-graph/tasks/plan-readers.ts', name: 'CanonicalTaskState', kind: 'projection',
    fields: ['effectivePhase', 'phaseCause'], use: PROJECTION_USE },
  { file: 'src/core/work-graph/model/plan-contracts.ts', name: 'TaskRow', kind: 'projection',
    fields: ['effectivePhase', 'phaseCause'], use: PROJECTION_USE },
  { file: 'src/contracts/task-failure.ts', name: 'TaskFailureFactsV1', kind: 'read_model',
    fields: ['failureClass', 'automation', 'requeueActors', 'reverifyActors', 'notReworkableCause'],
    use: 'state/task-failure.ts buildTaskFailureFacts' },
  // Slice 4 (spec §6, A2): the note head's lifecycle fields and the immutable
  // version and current-pointer records are written only by the note machine.
  { file: 'src/contracts/note.ts', name: 'NoteHeadSnapshot', kind: 'record',
    fields: ['version', 'state', 'reviewReasons', 'confirmedByUser', 'stagedRunKey'],
    use: 'state/note-machine.ts newNoteHeadRecord or transitionNote' },
  { file: 'src/contracts/note.ts', name: 'NoteVersionSnapshot', kind: 'record',
    fields: ['version', 'state', 'reviewReasons', 'change'],
    use: 'state/note-machine.ts newNoteVersionRecord' },
  { file: 'src/contracts/note.ts', name: 'CurrentPointerSnapshot', kind: 'record',
    fields: ['noteId', 'revision'],
    use: 'state/note-machine.ts newCurrentPointerRecord or moveCurrentPointerRecord' },
];

// -------------------------------------------------------------------------- //
// §14.2 allowlist: decoders, by file + function                               //
// -------------------------------------------------------------------------- //

/** Files are relative to `src/core/work-graph/`; `*` matches any part of a function name. */
const ALLOWED_DECODERS: readonly { file: string; functions: readonly string[] }[] = [
  { file: 'persistence/record-codecs.ts', functions: ['decodeGoalSnapshot', 'decodeGoalCreatedEvent',
    'goalSnapshotFromCreatedEvent', 'decodeWorkspaceSnapshot'] },
  { file: 'persistence/decision-record-codecs.ts', functions: ['decodeGoalSettingsChangedEvent',
    'decodeWorkspaceNoticeSeenChangedEvent'] },
  { file: 'persistence/line-settings-codecs.ts', functions: ['decodeWorkspaceLinePinsChangedEvent'] },
  { file: 'configuration/project-bootstrap-record-codecs.ts', functions: ['workspaceSnapshotFromValue'] },
  { file: 'persistence/control-record-codecs.ts', functions: ['decodeControlIntentSnapshot',
    'controlIntentSubmittedEventFromEvent', 'controlIntentObservedEventFromEvent'] },
  { file: 'persistence/execution-entry-codecs.ts', functions: ['*EventFromEvent', '*Problem'] },
  { file: 'tasks/claim-record-codecs.ts', functions: ['decodeTaskAttemptSnapshot', 'decodeDispatchOutboxEntry',
    'taskClaimedEventFromEvent', 'decodeTaskRequeueSnapshot', 'decodeTaskReworkRefusalSnapshot',
    'taskRequeuedEventFromEvent', 'taskReworkRefusedEventFromEvent'] },
  { file: 'tasks/completion-record-codecs.ts', functions: ['decodeGoalPhaseSnapshot', 'completionEventFromEvent'] },
  { file: 'tasks/session-anomaly-codecs.ts', functions: ['decodeSessionAnomalyAnchor', 'sessionAnomalyRecordedEventFromEvent'] },
  { file: 'sessions/lifecycle-record-codecs.ts', functions: ['sessionArchiveChangedEventFromEvent',
    'sessionResponsibilityChangedEventFromEvent'] },
  { file: 'persistence/plan-record-codecs.ts', functions: ['decodePlanProposalRecord', 'decodePlanRevisionSnapshot',
    'decodePlanProposalRecordedEvent', 'decodePlanRevisionAcceptedEvent'] },
  { file: 'sessions/session-record-codecs.ts', functions: ['decodeSessionRecord', 'decodeSessionOperationRecord',
    'decodeSessionWorkLink', 'sessionCreatedPayloadFromEvent', 'check*'] },
  { file: 'sessions/message-record-codecs.ts', functions: ['decodeSessionMessageRecord',
    'sessionMessageFromEvent', 'check*'] },
  { file: 'persistence/evidence-record-codecs.ts', functions: ['decodeVerificationRoundSnapshot',
    'decodeEvidenceSnapshot', 'decodeTaskEvidenceIndexSnapshot', 'verificationRoundEventFromEvent'] },
  { file: 'queries/query-record-codecs.ts', functions: ['decodeQueryJobSnapshot', 'decodeQueryRunSnapshotRecord',
    'decode*Event'] },
  { file: 'persistence/note-record-codecs.ts', functions: ['decodeNoteHeadSnapshot', 'decodeNoteVersionSnapshot',
    'decodeCurrentPointerSnapshot', 'noteWrittenEventFromEvent', 'noteDispositionChangedEventFromEvent',
    'currentPointerMovedEventFromEvent'] },
  { file: 'materials/record-readers.ts', functions: ['validateRunSnapshot', 'validateQueryRunSnapshot'] },
  // Slice 8 L8: the one decoder for the auto-capture request record/events.
  { file: 'architecture/architecture-record-codecs.ts', functions: ['decodeArchitectureAutoCapture',
    'decodeArchitectureAutoCaptureEvent'] },
];

const WRAPPER_ALIASES = new Set(['Partial', 'Readonly', 'Pick', 'Omit', 'Required']);
const ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

function globPattern(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

// -------------------------------------------------------------------------- //
// Scanner                                                                     //
// -------------------------------------------------------------------------- //

type ScanResult = {
  violations: string[];
  /** §14.1 rows whose declaration or field is missing from the Program. */
  unknownProtected: string[];
  /** §14.2 rows whose file or function is missing from the Program. */
  unknownAllowed: string[];
  scannedFiles: number;
};

function scanStateWrites(projectDir: string): ScanResult {
  const root = resolve(projectDir);
  const configPath = join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  const relativePath = (fileName: string) => relative(root, fileName).split(sep).join('/');
  const sourceNames = parsed.fileNames.filter(name => relativePath(name).startsWith('src/'));
  const program = ts.createProgram({ rootNames: sourceNames, options: parsed.options });
  const checker = program.getTypeChecker();
  const protectedByKey = new Map(PROTECTED_TYPES.map(entry => [`${entry.file}#${entry.name}`, entry]));
  const allowedByFile = new Map(ALLOWED_DECODERS.map(entry => [WORK_GRAPH + entry.file, entry.functions.map(globPattern)]));
  const found = new Map<string, string>();

  // ---- protected type identification ----------------------------------- //

  /** The §14.1 row a type literal, alias or interface declaration belongs to. */
  function entryOfDeclaration(declaration: ts.Node | undefined): ProtectedType | undefined {
    let node = declaration;
    // A member of `type T = A & ({...} | {...})` belongs to T; a property's own type literal does not.
    while (node !== undefined && (ts.isTypeLiteralNode(node) || ts.isUnionTypeNode(node)
      || ts.isIntersectionTypeNode(node) || ts.isParenthesizedTypeNode(node))) node = node.parent;
    if (node === undefined || !(ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))) return undefined;
    return protectedByKey.get(`${relativePath(node.getSourceFile().fileName)}#${node.name.text}`);
  }
  function entriesOfSymbol(symbol: ts.Symbol | undefined): ProtectedType[] {
    const entries: ProtectedType[] = [];
    for (const declaration of symbol?.declarations ?? []) {
      const entry = entryOfDeclaration(declaration);
      if (entry !== undefined && !entries.includes(entry)) entries.push(entry);
    }
    return entries;
  }
  /** The base constraint of a type parameter or an indexed access `T['f']`; any other type itself. */
  function constraintOf(type: ts.Type): ts.Type {
    if ((type.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.IndexedAccess)) === 0) return type;
    return checker.getBaseConstraintOfType(type) ?? type;
  }
  const protectedCache = new Map<ts.Type, ProtectedType[]>();
  function protectedOf(type: ts.Type): ProtectedType[] {
    const cached = protectedCache.get(type);
    if (cached !== undefined) return cached;
    const entries = new Set<ProtectedType>();
    protectedCache.set(type, []); // cycle guard
    const add = (list: readonly ProtectedType[]) => { for (const entry of list) entries.add(entry); };
    if (type.aliasSymbol !== undefined) {
      add(entriesOfSymbol(type.aliasSymbol));
      const argument = type.aliasTypeArguments?.[0];
      if (WRAPPER_ALIASES.has(type.aliasSymbol.name) && argument !== undefined) add(protectedOf(argument));
    }
    add(entriesOfSymbol(type.getSymbol()));
    // A generic helper `<T extends P>(value: T)` writes P through T.
    const constraint = constraintOf(type);
    if (constraint !== type) add(protectedOf(constraint));
    if (type.isUnionOrIntersection()) for (const member of type.types) add(protectedOf(member));
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      for (const element of checker.getTypeArguments(type as ts.TypeReference)) add(protectedOf(element));
    }
    // A type derived from P keeps the declarations of P's properties: `type W =
    // Readonly<P>` (the mapped type is re-aliased to W), an object rest
    // `const { status, ...rest } = run`, a spread copy `{ ...run }`.
    if (entries.size === 0 && (type.flags & ts.TypeFlags.Object) !== 0
      && !checker.isArrayType(type) && !checker.isTupleType(type)) {
      for (const property of type.getProperties()) {
        for (const declaration of property.declarations ?? []) {
          if (!ts.isPropertySignature(declaration)) continue;
          const entry = entryOfDeclaration(declaration.parent);
          if (entry !== undefined) entries.add(entry);
        }
      }
    }
    const result = [...entries];
    protectedCache.set(type, result);
    return result;
  }
  /** The type is the whole record itself (not a wrapper or a patch of it); `T extends P` counts as P. */
  function isWholeRecord(type: ts.Type, entry: ProtectedType): boolean {
    const membersOf = (current: ts.Type): ts.Type[] => {
      const constraint = constraintOf(current);
      if (constraint !== current) return membersOf(constraint);
      return current.isUnion() ? current.types.flatMap(membersOf) : [current];
    };
    return membersOf(type).some(member => (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0
      && !(member.aliasSymbol !== undefined && WRAPPER_ALIASES.has(member.aliasSymbol.name))
      && ((member.flags & ts.TypeFlags.Object) === 0 || ((member as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) === 0)
      && [...entriesOfSymbol(member.aliasSymbol), ...entriesOfSymbol(member.getSymbol())].includes(entry));
  }
  const protects = (entry: ProtectedType, field: string) => entry.fields === 'all' || entry.fields.includes(field);

  // ---- syntax helpers ---------------------------------------------------- //

  function skipOuter(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
    return current;
  }
  function nameText(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
      || ts.isNoSubstitutionTemplateLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
    if (ts.isComputedPropertyName(name)) {
      const inner = skipOuter(name.expression);
      if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text;
    }
    return null;
  }
  /** Names an element access writes: a literal key or a literal-union key type. */
  function accessNames(access: ts.PropertyAccessExpression | ts.ElementAccessExpression): string[] {
    if (ts.isPropertyAccessExpression(access)) return [access.name.text];
    const argument = skipOuter(access.argumentExpression);
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return [argument.text];
    const keyType = checker.getTypeAtLocation(argument);
    const keys = keyType.isUnion() ? keyType.types : [keyType];
    return keys.filter(key => key.isStringLiteral()).map(key => (key as ts.StringLiteralType).value);
  }
  /** Property and element access targets of `x.f`, a destructuring target `[x.f] = …` or `({ k: x.f } = …)`. */
  function assignmentTargets(expression: ts.Expression): ts.Expression[] {
    const current = skipOuter(expression);
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) return [current];
    if (ts.isArrayLiteralExpression(current)) {
      return current.elements.flatMap(element => assignmentTargets(ts.isSpreadElement(element) ? element.expression : element));
    }
    if (ts.isObjectLiteralExpression(current)) {
      return current.properties.flatMap(property => ts.isPropertyAssignment(property) ? assignmentTargets(property.initializer)
        : ts.isSpreadAssignment(property) ? assignmentTargets(property.expression) : []);
    }
    // A destructuring default `[x.f = d] = …`.
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return assignmentTargets(current.left);
    }
    return [];
  }
  /** Types a literal is asserted to on its way out: `{...} as unknown as P` gives it the contextual type `unknown`. */
  function assertedTypes(node: ts.Expression): ts.Type[] {
    const types: ts.Type[] = [];
    for (let current: ts.Node = node; ; current = current.parent) {
      const parent = current.parent;
      if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isSatisfiesExpression(parent)) {
        if (!ts.isConstTypeReference(parent.type)) types.push(checker.getTypeFromTypeNode(parent.type));
      } else if (!ts.isParenthesizedExpression(parent)) return types;
    }
  }
  /** Literals an expression evaluates to: `{...}`, `c ? {...} : {...}`, `c && {...}`. */
  function literalsOf(expression: ts.Expression): ts.ObjectLiteralExpression[] {
    const current = skipOuter(expression);
    if (ts.isObjectLiteralExpression(current)) return [current];
    if (ts.isConditionalExpression(current)) return [...literalsOf(current.whenTrue), ...literalsOf(current.whenFalse)];
    if (ts.isBinaryExpression(current) && (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      || current.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return literalsOf(current.right);
    return [];
  }
  type Written = { name: string; node: ts.Node; value: ts.Expression | null };
  /** Fields an object literal element writes; a non-literal spread writes the properties of its type. */
  function writtenBy(element: ts.ObjectLiteralElementLike, base: ProtectedType | null): Written[] {
    if (ts.isPropertyAssignment(element)) {
      const name = nameText(element.name);
      return name === null ? [] : [{ name, node: element, value: element.initializer }];
    }
    if (ts.isShorthandPropertyAssignment(element)) return [{ name: element.name.text, node: element, value: element.name }];
    if (ts.isMethodDeclaration(element) || ts.isGetAccessorDeclaration(element) || ts.isSetAccessorDeclaration(element)) {
      const name = nameText(element.name);
      return name === null ? [] : [{ name, node: element, value: null }];
    }
    if (ts.isSpreadAssignment(element)) {
      const literals = literalsOf(element.expression);
      if (literals.length > 0) return literals.flatMap(literal => literal.properties.flatMap(inner => writtenBy(inner, base)));
      const type = checker.getTypeAtLocation(element.expression);
      if (base !== null && isWholeRecord(type, base)) return [];
      return checker.getApparentType(type).getProperties().map(property => ({ name: property.name, node: element, value: null }));
    }
    return [];
  }

  // ---- projection provenance -------------------------------------------- //

  function isProjectTaskPhaseCall(expression: ts.Expression): boolean {
    const current = skipOuter(expression);
    if (!ts.isCallExpression(current)) return false;
    let symbol = checker.getSymbolAtLocation(current.expression);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.name === PROJECT_TASK_PHASE.name && (symbol.declarations ?? [])
      .some(declaration => relativePath(declaration.getSourceFile().fileName) === PROJECT_TASK_PHASE.file);
  }
  /** `projectTaskPhase(f)`, `.phase` of it, or a `const` (or destructured `const`) bound to it. */
  function fromProjectTaskPhase(expression: ts.Expression, depth = 0): boolean {
    if (depth > 8) return false;
    const current = skipOuter(expression);
    if (isProjectTaskPhaseCall(current)) return true;
    if (ts.isPropertyAccessExpression(current)) return fromProjectTaskPhase(current.expression, depth + 1);
    if (!ts.isIdentifier(current)) return false;
    const symbol = ts.isShorthandPropertyAssignment(current.parent) && current.parent.name === current
      ? checker.getShorthandAssignmentValueSymbol(current.parent) : checker.getSymbolAtLocation(current);
    let declaration: ts.Node | undefined = symbol?.valueDeclaration;
    while (declaration !== undefined && (ts.isBindingElement(declaration) || ts.isObjectBindingPattern(declaration)
      || ts.isArrayBindingPattern(declaration))) declaration = declaration.parent;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) return false;
    if ((ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0) return false;
    return fromProjectTaskPhase(declaration.initializer, depth + 1);
  }
  /**
   * A copy of the same projected field from another projection value, e.g.
   * `state.effectivePhase`; not from a value asserted to be one
   * (`(fake as unknown as TaskRow).effectivePhase`).
   */
  function isProjectionCopy(value: ts.Expression, field: string): boolean {
    const current = skipOuter(value);
    if (!ts.isPropertyAccessExpression(current) || current.name.text !== field) return false;
    let object: ts.Expression = current.expression;
    while (ts.isParenthesizedExpression(object) || ts.isNonNullExpression(object)) object = object.expression;
    if (ts.isAsExpression(object) || ts.isTypeAssertionExpression(object)) return false;
    return protectedOf(checker.getTypeAtLocation(current.expression))
      .some(entry => entry.kind === 'projection' && protects(entry, field));
  }

  // ---- reporting --------------------------------------------------------- //

  function enclosingFunctionNames(node: ts.Node): string[] {
    const names: string[] = [];
    for (let cursor = node.parent; cursor !== undefined; cursor = cursor.parent) {
      if ((ts.isFunctionDeclaration(cursor) || ts.isFunctionExpression(cursor) || ts.isMethodDeclaration(cursor))
        && cursor.name !== undefined) {
        const name = nameText(cursor.name);
        if (name !== null) names.push(name);
      }
      if (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) {
        const holder = cursor.parent;
        if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) names.push(holder.name.text);
        if (ts.isPropertyAssignment(holder) || ts.isPropertyDeclaration(holder)) {
          const name = nameText(holder.name);
          if (name !== null) names.push(name);
        }
      }
    }
    return names;
  }
  function report(file: string, sourceFile: ts.SourceFile, node: ts.Node, entry: ProtectedType, field: string): void {
    const allowed = allowedByFile.get(file);
    if (allowed !== undefined && enclosingFunctionNames(node).some(name => allowed.some(pattern => pattern.test(name)))) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const text = `${file}:${line}: ${entry.name}.${field} written outside work-graph/state/ (use ${entry.use})`;
    found.set(`${file}\u0000${String(line).padStart(6, '0')}\u0000${text}`, text);
  }
  /** One literal or spread write; a projection write is allowed only with a `projectTaskPhase` value. */
  function reportWrite(file: string, sourceFile: ts.SourceFile, written: Written, entry: ProtectedType): void {
    if (!protects(entry, written.name)) return;
    if (entry.kind === 'projection' && written.value !== null
      && (fromProjectTaskPhase(written.value) || isProjectionCopy(written.value, written.name))) return;
    report(file, sourceFile, written.node, entry, written.name);
  }

  // ---- rules ------------------------------------------------------------- //

  /** R3 target: every `x.f` along `a.b[i].c` whose object is a protected record. */
  function reportTarget(file: string, sourceFile: ts.SourceFile, target: ts.Expression, at: ts.Node): void {
    let current = skipOuter(target);
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const entries = protectedOf(checker.getTypeAtLocation(current.expression)).filter(entry => entry.kind === 'record');
      for (const name of accessNames(current)) {
        for (const entry of entries) if (protects(entry, name)) report(file, sourceFile, at, entry, name);
      }
      current = skipOuter(current.expression);
    }
  }
  function partialTargets(type: ts.Type): ProtectedType[] {
    const members = type.isUnion() ? type.types : [type];
    return members.flatMap(member => {
      const argument = member.aliasTypeArguments?.[0];
      return member.aliasSymbol?.name === 'Partial' && argument !== undefined
        ? protectedOf(argument).filter(entry => entry.kind === 'record') : [];
    });
  }
  function declaredOutsideState(declaration: ts.Declaration | undefined): boolean {
    if (declaration === undefined) return false;
    const file = relativePath(declaration.getSourceFile().fileName);
    return file.startsWith('src/') && !file.startsWith(STATE_DIRECTORY);
  }

  function visit(file: string, sourceFile: ts.SourceFile, node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      // R1: the literal's contextual type, or a type it is asserted to, is protected.
      const contextual = checker.getContextualType(node);
      const contextualEntries = new Set([...contextual === undefined ? [] : protectedOf(contextual),
        ...assertedTypes(node).flatMap(protectedOf)]);
      for (const element of node.properties) {
        if (ts.isSpreadAssignment(element)) continue;
        for (const written of writtenBy(element, null)) {
          for (const entry of contextualEntries) reportWrite(file, sourceFile, written, entry);
        }
      }
      // R2: a protected spread followed by a protected field.
      node.properties.forEach((element, index) => {
        if (!ts.isSpreadAssignment(element)) return;
        const spreadEntries = protectedOf(checker.getTypeAtLocation(element.expression));
        for (const entry of spreadEntries) {
          for (const later of node.properties.slice(index + 1)) {
            for (const written of writtenBy(later, entry)) reportWrite(file, sourceFile, written, entry);
          }
        }
      });
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      // R3: `x.f = v`, `x.f ??= v`, `[x.f] = v`, `({ k: x.f } = v)`, ...
      for (const target of assignmentTargets(node.left)) reportTarget(file, sourceFile, target, node);
    } else if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      // R3: `for (x.f of values)` assigns x.f on every iteration.
      for (const target of assignmentTargets(node.initializer)) reportTarget(file, sourceFile, target, node.initializer);
    } else if (ts.isDeleteExpression(node)) {
      reportTarget(file, sourceFile, node.expression, node);
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      reportTarget(file, sourceFile, node.operand, node);
    } else if (ts.isCallExpression(node)) {
      const callee = skipOuter(node.expression);
      if (ts.isPropertyAccessExpression(callee) && ARRAY_MUTATORS.has(callee.name.text)
        && checker.isArrayType(checker.getNonNullableType(checker.getTypeAtLocation(callee.expression)))) {
        // R3: `x.f.push(v)` mutates the protected field f in place.
        reportTarget(file, sourceFile, callee.expression, node);
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'assign' && ts.isIdentifier(callee.expression)
        && callee.expression.text === 'Object' && node.arguments.length > 1) {
        // R4: Object.assign(target, ...sources).
        const [target, ...sources] = node.arguments as unknown as [ts.Expression, ...ts.Expression[]];
        const targetNode = skipOuter(target);
        // `Object.assign(run.controlState!, …)` writes the protected field it holds, as R3 does for a deeper write.
        if (ts.isPropertyAccessExpression(targetNode) || ts.isElementAccessExpression(targetNode)) {
          reportTarget(file, sourceFile, targetNode, node);
        }
        const emptyTarget = ts.isObjectLiteralExpression(targetNode) && targetNode.properties.length === 0;
        let entries = protectedOf(checker.getTypeAtLocation(target)).filter(entry => entry.kind === 'record');
        let from = 0;
        if (entries.length === 0 && emptyTarget) {
          // `Object.assign({}, record, patch)` copies the record, then overwrites like a spread.
          from = sources.findIndex(source => protectedOf(checker.getTypeAtLocation(source)).some(entry => entry.kind === 'record'));
          if (from >= 0) entries = protectedOf(checker.getTypeAtLocation(sources[from]!)).filter(entry => entry.kind === 'record');
          from += 1;
        }
        for (const entry of entries) {
          for (const source of sources.slice(from)) {
            const literals = literalsOf(source);
            const writes = literals.length > 0
              ? literals.flatMap(literal => literal.properties.flatMap(element => writtenBy(element, entry)))
              : isWholeRecord(checker.getTypeAtLocation(source), entry) ? []
                : checker.getApparentType(checker.getTypeAtLocation(source)).getProperties()
                  .map(property => ({ name: property.name, node: source, value: null }));
            for (const written of writes) reportWrite(file, sourceFile, written, entry);
          }
        }
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      // R4: a non-literal value passed to a non-`state/` helper's `Partial<protected>` parameter
      // (a literal argument is already R1: its contextual type is that parameter).
      const signature = checker.getResolvedSignature(node);
      if (signature !== undefined && declaredOutsideState(signature.declaration)) {
        (node.arguments ?? []).forEach((argument, index) => {
          const parameter = signature.parameters[index];
          if (parameter === undefined || literalsOf(argument).length > 0) return;
          const targets = partialTargets(checker.getTypeOfSymbolAtLocation(parameter, node));
          if (targets.length === 0) return;
          const properties = checker.getApparentType(checker.getTypeAtLocation(argument)).getProperties();
          for (const entry of targets) {
            for (const property of properties) {
              if (protects(entry, property.name)) report(file, sourceFile, argument, entry, property.name);
            }
          }
        });
      }
    }
    ts.forEachChild(node, child => visit(file, sourceFile, child));
  }

  let scannedFiles = 0;
  for (const sourceFile of program.getSourceFiles()) {
    const file = relativePath(sourceFile.fileName);
    if (!file.startsWith('src/') || sourceFile.isDeclarationFile || file.startsWith(STATE_DIRECTORY)) continue;
    scannedFiles += 1;
    visit(file, sourceFile, sourceFile);
  }

  // The tables must keep naming real declarations, fields and functions.
  const sourceByPath = new Map(program.getSourceFiles().map(sourceFile => [relativePath(sourceFile.fileName), sourceFile]));
  const unknownProtected: string[] = [];
  for (const entry of PROTECTED_TYPES) {
    const sourceFile = sourceByPath.get(entry.file);
    const declaration = sourceFile?.statements.find((statement): statement is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name.text === entry.name);
    if (declaration === undefined) { unknownProtected.push(`${entry.file}: ${entry.name} is not declared`); continue; }
    if (entry.fields === 'all') continue;
    const declared = checker.getTypeAtLocation(declaration.name);
    const members = declared.isUnion() ? declared.types : [declared];
    const declares = (field: string) => members.some(member => checker.getPropertyOfType(member, field) !== undefined);
    for (const field of entry.fields) {
      if (!declares(field)) unknownProtected.push(`${entry.file}: ${entry.name}.${field} is not declared`);
    }
  }
  const unknownAllowed: string[] = [];
  for (const entry of ALLOWED_DECODERS) {
    const sourceFile = sourceByPath.get(WORK_GRAPH + entry.file);
    if (sourceFile === undefined) { unknownAllowed.push(`${WORK_GRAPH}${entry.file} does not exist`); continue; }
    const names = sourceFile.statements.flatMap(statement => ts.isFunctionDeclaration(statement) && statement.name
      ? [statement.name.text] : []);
    for (const pattern of entry.functions) {
      if (!names.some(name => globPattern(pattern).test(name))) unknownAllowed.push(`${WORK_GRAPH}${entry.file}: no function ${pattern}`);
    }
  }
  const violations = [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
  return { violations, unknownProtected, unknownAllowed, scannedFiles };
}

// -------------------------------------------------------------------------- //
// The real tree                                                               //
// -------------------------------------------------------------------------- //

describe('state writes in src/', () => {
  it('writes every protected lifecycle field only through work-graph/state/ (§14.3)', () => {
    const result = scanStateWrites(project);
    expect(result.scannedFiles).toBeGreaterThan(100);
    expect(result.unknownProtected).toEqual([]);
    expect(result.unknownAllowed).toEqual([]);
    expect(result.violations).toEqual([]);
  }, 300_000);
});

// -------------------------------------------------------------------------- //
// Fixtures (a temporary project with the real src/contracts)                  //
// -------------------------------------------------------------------------- //

const FIXTURES: Record<string, string> = {
  'core/work-graph/tasks/r1-literal.ts': `
import type { TaskLeaseRef, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
export function grantLease(ref: TaskLeaseRef, runId: string, attemptId: string, grantedAt: string): TaskLeaseSnapshot {
  return {
    ref, revision: 1, schemaVersion: 1,
    holderRunId: runId,
    attemptId,
    grantedAt, expiresAt: null,
  };
}
`,
  'core/work-graph/tasks/r2-spread.ts': `
import type { RunSnapshot } from '../../../contracts/dispatch.js';
export function endRun(run: RunSnapshot) {
  const next = {
    ...run,
    status: 'ended' as const,
  };
  return next;
}
`,
  'core/work-graph/tasks/r2-rest.ts': `
import type { RunSnapshot } from '../../../contracts/dispatch.js';
export function restart(run: RunSnapshot) {
  const { status, ...rest } = run;
  const copy = { ...run };
  copy.outcome = null;
  return { ...rest,
    status: status === 'ended' ? 'running' as const : status };
}
`,
  'core/work-graph/tasks/r3-assignment.ts': `
import type { ControlIntentRef } from '../../../contracts/control-intent.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
export function mutate(run: RunSnapshot, intentRef: ControlIntentRef): void {
  run.outcome = 'completed';
  run.lastEventSeq += 1;
  run.controlState!.desiredState = 'paused';
  delete run.reconciliation;
  run.controlInputs?.push(intentRef);
  run['endedAt'] = null;
  run.lastEventSeq++;
}
`,
  'core/work-graph/tasks/r4-assign-helper.ts': `
import type { RoundCheckSnapshot } from '../../../contracts/verification.js';
import type { TaskAttemptSnapshot } from '../../../contracts/dispatch.js';
export function endAttempt(attempt: TaskAttemptSnapshot): void {
  Object.assign(attempt, { endedAt: '2026-10-05T00:00:00.000Z' });
}
function withCheck(check: RoundCheckSnapshot, patch: Partial<RoundCheckSnapshot>): RoundCheckSnapshot {
  return { ...check, ...patch };
}
export function finish(check: RoundCheckSnapshot, change: Partial<RoundCheckSnapshot>): RoundCheckSnapshot {
  return withCheck(check,
    change);
}
`,
  'core/work-graph/tasks/alias-wrapper.ts': `
import type { TaskAttemptSnapshot, TaskLeaseRef, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
type FrozenLease = Readonly<TaskLeaseSnapshot>;
type MaybeLease = FrozenLease | null;
type LocalAttempt = TaskAttemptSnapshot;
export function wrapped(ref: TaskLeaseRef, attempt: LocalAttempt | undefined): MaybeLease {
  if (attempt !== undefined) (attempt as LocalAttempt).status = 'ended';
  return {
    ref, revision: 1, schemaVersion: 1, attemptId: 'a', grantedAt: 'g', expiresAt: null,
    holderRunId: 'r',
  };
}
`,
  'core/work-graph/tasks/new-items.ts': `
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunReconciliationV1, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import type { TaskFailureFactsV1 } from '../../../contracts/task-failure.js';
import type { TaskRequeueSnapshotV1, TaskReworkRefusalSnapshotV1 } from '../../../contracts/task-requeue.js';
import type { RoundCheckSnapshot, RoundSnapshot } from '../../../contracts/verification.js';
export function refuse(): TaskReworkRefusalSnapshotV1 {
  return { code: 'no_new_basis' } as TaskReworkRefusalSnapshotV1;
}
export function reclassify(requeue: TaskRequeueSnapshotV1) {
  return { ...requeue,
    failureClass: 'check_failed' as const };
}
export function relink(round: RoundSnapshot) {
  return { ...round,
    chain: { ...round.chain!, ordinal: 2 } };
}
export function interrupt(check: RoundCheckSnapshot): RoundCheckSnapshot {
  return { ...check,
    incompleteCause: 'process_timed_out' };
}
export function terminal(run: RunSnapshot, payload: RunSnapshot['terminalPayload']) {
  return { ...run,
    terminalPayload: payload };
}
export function cleanInterruption(run: RunSnapshot, observation: Extract<RunReconciliationV1['observation'], { kind: 'interrupted_clean' }>,
  basis: RunReconciliationV1['basis']): RunSnapshot {
  return { ...run,
    reconciliation: { status: 'done', observation, basis, recordedAt: 'now' } };
}
export function turnOpen(session: SessionRecord) {
  return { ...session,
    healthConclusion: 'kernel_turn_open' as const };
}
export function failureFacts(): TaskFailureFactsV1 {
  return {
    failureClass: 'check_failed' } as TaskFailureFactsV1;
}
export function pausedBy(goal: GoalSnapshot, actor: ActorRef) {
  return { ...goal,
    desiredStateRequestedBy: actor };
}
`,
  'core/work-graph/persistence/record-codecs.ts': `
import type { GoalSnapshot } from '../../../contracts/ledger.js';
export function decodeGoalSnapshot(value: GoalSnapshot): GoalSnapshot {
  const copy = (goal: GoalSnapshot): GoalSnapshot => ({ ...goal, desiredState: goal.desiredState });
  return { ...copy(value), activePlanRevision: value.activePlanRevision };
}
export function migrateGoalSnapshot(value: GoalSnapshot): GoalSnapshot {
  return { ...value,
    desiredState: 'active' };
}
`,
  'core/work-graph/persistence/other-codecs.ts': `
import type { GoalSnapshot } from '../../../contracts/ledger.js';
export function decodeGoalSnapshot(value: GoalSnapshot): GoalSnapshot {
  return { ...value,
    desiredState: 'active' };
}
`,
  'core/work-graph/state/fixture-machine.ts': `
import type { RunSnapshot, TaskLeaseRef, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
export function grantLease(ref: TaskLeaseRef): TaskLeaseSnapshot {
  return { ref, revision: 1, schemaVersion: 1, holderRunId: 'r', attemptId: 'a', grantedAt: 'g', expiresAt: null };
}
export function endRun(run: RunSnapshot): RunSnapshot {
  const next = { ...run, status: 'ended' as const, terminalPayload: run.terminalPayload };
  next.outcome = 'completed';
  Object.assign(next, { endedAt: 'now' });
  return next;
}
export function turnOpen(session: SessionRecord): SessionRecord {
  return { ...session, healthConclusion: 'kernel_turn_open', health: 'unavailable', occupancy: null };
}
`,
  'core/work-graph/tasks/read-only.ts': `
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
function isFinished(run: Pick<RunSnapshot, 'status' | 'outcome'>): boolean {
  return run.status === 'ended' && run.outcome !== 'outcome_unknown';
}
export function inspect(run: Readonly<RunSnapshot>, session: SessionRecord) {
  if (run.status === 'ended') return { status: run.status, finished: isFinished(run) };
  const { outcome, lastEventSeq } = run;
  const label = \`\${session.health}:\${outcome ?? 'none'}:\${lastEventSeq}\`;
  const copy = { ...run };
  return { label, copy, health: session.health, released: session.occupancy === null };
}
`,
  // Projection: stub declarations at the real paths (the scanner identifies types by file + name).
  'core/work-graph/state/task-machine.ts': `
export type Phase = 'pending' | 'running' | 'blocked';
export function projectTaskPhase(facts: { running: boolean }): { phase: Phase; cause: null } {
  return { phase: facts.running ? 'running' : 'pending', cause: null };
}
`,
  'core/work-graph/tasks/plan-readers.ts': `
import { projectTaskPhase, type Phase } from '../state/task-machine.js';
export type CanonicalTaskState = { taskId: string; effectivePhase: Phase };
export function projected(taskId: string, running: boolean): CanonicalTaskState {
  const projection = projectTaskPhase({ running });
  return { taskId, effectivePhase: projection.phase };
}
export function destructured(taskId: string, running: boolean): CanonicalTaskState {
  const { phase } = projectTaskPhase({ running });
  return { taskId, effectivePhase: phase };
}
export function copied(state: CanonicalTaskState): CanonicalTaskState {
  return { taskId: 'copy', effectivePhase: state.effectivePhase };
}
export function inline(taskId: string, running: boolean): CanonicalTaskState {
  return { taskId,
    effectivePhase: running ? 'running' : 'pending' };
}
`,
};

/** A temporary project with the real `tsconfig.json` and `src/contracts`, plus the given `src/` files. */
async function fixtureProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'next-state-writes-test-'));
  await cp(join(project, 'tsconfig.json'), join(dir, 'tsconfig.json'));
  await cp(join(project, 'src', 'contracts'), join(dir, 'src', 'contracts'), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, 'src', path)), { recursive: true });
    await writeFile(join(dir, 'src', path), text.trimStart());
  }
  return dir;
}

describe('state-writes checker fixtures', () => {
  let dir = '';
  let violations: string[] = [];
  const hits = (path: string) => violations.filter(line => line.startsWith(`src/${path}:`));

  beforeAll(async () => {
    dir = await fixtureProject(FIXTURES);
    violations = scanStateWrites(dir).violations;
  }, 120_000);
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('R1: a literal with a protected contextual type, property and shorthand', () => {
    expect(hits('core/work-graph/tasks/r1-literal.ts')).toEqual([
      'src/core/work-graph/tasks/r1-literal.ts:5: TaskLeaseSnapshot.holderRunId written outside work-graph/state/ '
        + '(use state/attempt-machine.ts newTaskLeaseRecord or transitionTaskLease)',
      'src/core/work-graph/tasks/r1-literal.ts:6: TaskLeaseSnapshot.attemptId written outside work-graph/state/ '
        + '(use state/attempt-machine.ts newTaskLeaseRecord or transitionTaskLease)',
    ]);
  });

  it('R2: a protected spread followed by a protected field, without a contextual type', () => {
    expect(hits('core/work-graph/tasks/r2-spread.ts')).toEqual([
      'src/core/work-graph/tasks/r2-spread.ts:5: RunSnapshot.status written outside work-graph/state/ '
        + '(use state/run-machine.ts transitionRun or newRunRecord)',
    ]);
  });

  it('R2/R3: an object rest or a spread copy of a record is still that record', () => {
    expect(hits('core/work-graph/tasks/r2-rest.ts').map(line => line.split(' written')[0])).toEqual([
      'src/core/work-graph/tasks/r2-rest.ts:5: RunSnapshot.outcome',
      'src/core/work-graph/tasks/r2-rest.ts:7: RunSnapshot.status',
    ]);
  });

  it('R3: assignments, compound assignments, deeper writes, delete, array mutators and ++', () => {
    const fields = hits('core/work-graph/tasks/r3-assignment.ts').map(line => line.split(': ')[1]);
    expect(hits('core/work-graph/tasks/r3-assignment.ts').map(line => line.split(':')[1])).toEqual(
      ['4', '5', '6', '7', '8', '9', '10']);
    expect(fields).toEqual([
      'RunSnapshot.outcome written outside work-graph/state/ (use state/run-machine.ts transitionRun or newRunRecord)',
      'RunSnapshot.lastEventSeq written outside work-graph/state/ (use state/run-machine.ts transitionRun or newRunRecord)',
      'RunSnapshot.controlState written outside work-graph/state/ (use state/run-machine.ts transitionRun or newRunRecord)',
      'RunSnapshot.reconciliation written outside work-graph/state/ (use state/run-machine.ts transitionRun or newRunRecord)',
      'RunSnapshot.controlInputs written outside work-graph/state/ (use state/run-machine.ts transitionRun or newRunRecord)',
      'RunSnapshot.endedAt written outside work-graph/state/ (use state/run-machine.ts transitionRun or newRunRecord)',
      'RunSnapshot.lastEventSeq written outside work-graph/state/ (use state/run-machine.ts transitionRun or newRunRecord)',
    ]);
  });

  it('R4: Object.assign into a protected target, a Partial<protected> helper body and its call', () => {
    const lines = hits('core/work-graph/tasks/r4-assign-helper.ts');
    expect(lines).toContain('src/core/work-graph/tasks/r4-assign-helper.ts:4: TaskAttemptSnapshot.endedAt written outside '
      + 'work-graph/state/ (use state/attempt-machine.ts newTaskAttemptRecord or transitionAttempt)');
    // The helper body spreads the patch over the check; the call passes a patch variable.
    for (const line of ['7', '11']) {
      expect(lines).toContain(`src/core/work-graph/tasks/r4-assign-helper.ts:${line}: RoundCheckSnapshot.phase written outside `
        + 'work-graph/state/ (use state/verification-machine.ts withCheckPhase)');
      expect(lines).toContain(`src/core/work-graph/tasks/r4-assign-helper.ts:${line}: RoundCheckSnapshot.incompleteCause written `
        + 'outside work-graph/state/ (use state/verification-machine.ts withCheckPhase)');
    }
    expect(new Set(lines.map(line => line.split(':')[1]))).toEqual(new Set(['4', '7', '11']));
  });

  it('expands a type alias, Readonly and a union wrapper', () => {
    expect(hits('core/work-graph/tasks/alias-wrapper.ts').map(line => line.split(' written')[0])).toEqual([
      'src/core/work-graph/tasks/alias-wrapper.ts:6: TaskAttemptSnapshot.status',
      'src/core/work-graph/tasks/alias-wrapper.ts:8: TaskLeaseSnapshot.attemptId',
      'src/core/work-graph/tasks/alias-wrapper.ts:9: TaskLeaseSnapshot.holderRunId',
    ]);
  });

  it('covers the protected items of the 2026-10-03 decisions (C1–C8, LA-7)', () => {
    expect(hits('core/work-graph/tasks/new-items.ts').map(line => line.split(' written')[0])).toEqual([
      'src/core/work-graph/tasks/new-items.ts:9: TaskReworkRefusalSnapshotV1.code',
      'src/core/work-graph/tasks/new-items.ts:13: TaskRequeueSnapshotV1.failureClass',
      'src/core/work-graph/tasks/new-items.ts:17: RoundSnapshot.chain',
      'src/core/work-graph/tasks/new-items.ts:21: RoundCheckSnapshot.incompleteCause',
      'src/core/work-graph/tasks/new-items.ts:25: RunSnapshot.terminalPayload',
      'src/core/work-graph/tasks/new-items.ts:30: RunSnapshot.reconciliation',
      'src/core/work-graph/tasks/new-items.ts:34: SessionRecord.healthConclusion',
      'src/core/work-graph/tasks/new-items.ts:38: TaskFailureFactsV1.failureClass',
      'src/core/work-graph/tasks/new-items.ts:42: GoalSnapshot.desiredStateRequestedBy',
    ]);
  });

  it('exempts only the allowlisted decoder functions of the allowlisted file', () => {
    expect(hits('core/work-graph/persistence/record-codecs.ts').map(line => line.split(' written')[0])).toEqual([
      'src/core/work-graph/persistence/record-codecs.ts:8: GoalSnapshot.desiredState',
    ]);
    expect(hits('core/work-graph/persistence/other-codecs.ts').map(line => line.split(' written')[0])).toEqual([
      'src/core/work-graph/persistence/other-codecs.ts:4: GoalSnapshot.desiredState',
    ]);
  });

  it('does not scan work-graph/state/', () => {
    expect(violations.filter(line => line.startsWith('src/core/work-graph/state/'))).toEqual([]);
  });

  it('ignores read-only access', () => {
    expect(hits('core/work-graph/tasks/read-only.ts')).toEqual([]);
  });

  it('accepts a projection only from projectTaskPhase or a copy of a projected field', () => {
    expect(hits('core/work-graph/tasks/plan-readers.ts')).toEqual([
      'src/core/work-graph/tasks/plan-readers.ts:16: CanonicalTaskState.effectivePhase written outside work-graph/state/ '
        + '(use state/task-machine.ts projectTaskPhase)',
    ]);
  });

  it('reports nothing else', () => {
    const covered = ['r1-literal', 'r2-spread', 'r2-rest', 'r3-assignment', 'r4-assign-helper', 'alias-wrapper', 'new-items',
      'record-codecs', 'other-codecs', 'plan-readers'];
    expect(violations.filter(line => !covered.some(name => line.includes(`/${name}.ts:`)))).toEqual([]);
  });
});

// -------------------------------------------------------------------------- //
// Fixtures: generic, nested, asserted and destructured writes                 //
// -------------------------------------------------------------------------- //

const SHAPE_FIXTURES: Record<string, string> = {
  'core/work-graph/tasks/generic-helper.ts': `
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
export function markHealth<T extends SessionRecord>(session: T, health: SessionRecord['health']) {
  session.health = health;
  return { ...session,
    lifecycle: 'archived' as const };
}
export function patchRun<T extends RunSnapshot>(run: T, patch: Partial<T>): T {
  return { ...run, ...patch };
}
export function replaceRun<T extends RunSnapshot>(run: T, other: T) {
  return { ...run, ...other };
}
`,
  'core/work-graph/tasks/nested-assign.ts': `
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
export function nested(run: RunSnapshot, round: RoundSnapshot): void {
  Object.assign(run.controlState!, { desiredState: 'paused' });
  Object.assign(round.chain!, { ordinal: 2 });
}
`,
  'core/work-graph/tasks/double-cast.ts': `
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
export function forged(ref: RunRef): RunSnapshot {
  return ({ ref,
    status: 'ended' } as unknown) as RunSnapshot;
}
`,
  'core/work-graph/tasks/destructuring.ts': `
import type { RunSnapshot } from '../../../contracts/dispatch.js';
export function destructure(run: RunSnapshot, statuses: RunSnapshot['status'][]): void {
  [run.outcome] = [null];
  ({ endedAt: run.endedAt } = { endedAt: null });
  ({ seq: [run.lastEventSeq = 0] } = { seq: [1] });
  for (run.status of statuses) break;
}
`,
  // A stub at the real path that declares the §14.1 projection field `phaseCause`.
  'core/work-graph/tasks/plan-readers.ts': `
export type Phase = 'pending' | 'running';
export type CanonicalTaskState = { taskId: string; effectivePhase: Phase; phaseCause: string | null };
export function laundered(taskId: string): CanonicalTaskState {
  const fake = { effectivePhase: 'running' as const, phaseCause: null };
  return { taskId, phaseCause: null,
    effectivePhase: (fake as unknown as CanonicalTaskState).effectivePhase };
}
`,
};

describe('state-writes checker: generic, nested, asserted and destructured writes', () => {
  let dir = '';
  let result: ScanResult = { violations: [], unknownProtected: [], unknownAllowed: [], scannedFiles: 0 };
  const hits = (path: string) => result.violations.filter(line => line.startsWith(`src/${path}:`))
    .map(line => line.replace(/ written .*$/, ''));

  beforeAll(async () => {
    dir = await fixtureProject(SHAPE_FIXTURES);
    result = scanStateWrites(dir);
  }, 120_000);
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('expands a type parameter to its constraint, and a whole-record spread of T writes nothing', () => {
    const lines = hits('core/work-graph/tasks/generic-helper.ts');
    expect(lines.filter(line => !line.includes('.ts:9: '))).toEqual([
      'src/core/work-graph/tasks/generic-helper.ts:4: SessionRecord.health',
      'src/core/work-graph/tasks/generic-helper.ts:6: SessionRecord.lifecycle',
    ]);
    // `{ ...run, ...patch }` with `patch: Partial<T>` may overwrite every field.
    expect(lines).toContain('src/core/work-graph/tasks/generic-helper.ts:9: RunSnapshot.status');
    expect(lines).toContain('src/core/work-graph/tasks/generic-helper.ts:9: RunSnapshot.outcome');
  });

  it('R4: Object.assign into the object a protected field holds', () => {
    expect(hits('core/work-graph/tasks/nested-assign.ts')).toEqual([
      'src/core/work-graph/tasks/nested-assign.ts:4: RunSnapshot.controlState',
      'src/core/work-graph/tasks/nested-assign.ts:5: RoundSnapshot.chain',
    ]);
  });

  it('R1: a literal asserted to a protected type through unknown', () => {
    expect(hits('core/work-graph/tasks/double-cast.ts')).toEqual([
      'src/core/work-graph/tasks/double-cast.ts:4: RunSnapshot.status',
    ]);
  });

  it('R3: destructuring targets, nested and with a default, and a for…of head', () => {
    expect(hits('core/work-graph/tasks/destructuring.ts')).toEqual([
      'src/core/work-graph/tasks/destructuring.ts:3: RunSnapshot.outcome',
      'src/core/work-graph/tasks/destructuring.ts:4: RunSnapshot.endedAt',
      'src/core/work-graph/tasks/destructuring.ts:5: RunSnapshot.lastEventSeq',
      'src/core/work-graph/tasks/destructuring.ts:6: RunSnapshot.status',
    ]);
  });

  // A.2 step 5.3 declared `CanonicalTaskState.phaseCause`, the last §14.1 field that was not
  // declared yet, so the table's `pending` list (protected before its declaration) is gone.
  it('protects the projection cause and refuses a projection copied through an assertion', () => {
    expect(hits('core/work-graph/tasks/plan-readers.ts')).toEqual([
      'src/core/work-graph/tasks/plan-readers.ts:5: CanonicalTaskState.phaseCause',
      'src/core/work-graph/tasks/plan-readers.ts:6: CanonicalTaskState.effectivePhase',
    ]);
  });

  it('reports nothing else', () => {
    const covered = Object.keys(SHAPE_FIXTURES).map(path => `src/${path}:`);
    expect(result.violations.filter(line => !covered.some(prefix => line.startsWith(prefix)))).toEqual([]);
  });
});
