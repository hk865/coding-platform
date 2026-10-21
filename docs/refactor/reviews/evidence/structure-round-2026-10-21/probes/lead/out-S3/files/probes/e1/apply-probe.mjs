#!/usr/bin/env node
/**
 * S3 byte-proof probe installer.
 *
 * Usage: node apply-probe.mjs <copy-dir> [--check]
 *
 * Applies the SAME probe to a scratch copy of the repository (the base copy,
 * later the result copy). It never touches the repository tree:
 *
 *  - adds `src/probe-hook.ts`, `tests/probe-setup.ts`, `tests/probes/*` from
 *    `payload/` (copy-only files);
 *  - adds `setupFiles` to the copy's `vitest.config.ts`;
 *  - wraps every S3 target: the real body is renamed to `...Impl` and a
 *    same-signature wrapper records one JSON line per call through the hook;
 *  - extracts the two inline expressions and the three context-extensions row
 *    texts into local functions of the copy (same text), then wraps them.
 *
 * Every patch asserts that its anchor occurs exactly once. All edits are made
 * in memory and written only after every anchor matched, so a copy whose tree
 * moved a target is left untouched and the failure names the missing anchor.
 * `--check` only verifies the anchors.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
if (root === undefined || root === '') {
  console.error('usage: node apply-probe.mjs <copy-dir> [--check]');
  process.exit(2);
}
const checkOnly = process.argv.includes('--check');

const files = new Map();
function load(rel) {
  if (!files.has(rel)) files.set(rel, readFileSync(join(root, rel), 'utf8'));
  return files.get(rel);
}
function store(rel, text) { files.set(rel, text); }
function payload(name) { return readFileSync(join(here, 'payload', name), 'utf8'); }
function count(haystack, needle) { return haystack.split(needle).length - 1; }
function has(rel, needle) { return load(rel).includes(needle); }

function apply(rel, ops) {
  let text = load(rel);
  for (const op of ops) {
    if (op.replace !== undefined) {
      const n = count(text, op.replace);
      if (n !== 1) throw new Error(`${rel}: anchor ${n} times, wanted 1: ${op.replace.slice(0, 80)}`);
      text = text.replace(op.replace, op.with);
    } else if (op.insertAfter !== undefined) {
      const n = count(text, op.insertAfter);
      if (n !== 1) throw new Error(`${rel}: insertAfter anchor ${n} times: ${op.insertAfter.slice(0, 80)}`);
      text = text.replace(op.insertAfter, op.insertAfter + op.with);
    } else if (op.insertBefore !== undefined) {
      const n = count(text, op.insertBefore);
      if (n !== 1) throw new Error(`${rel}: insertBefore anchor ${n} times: ${op.insertBefore.slice(0, 80)}`);
      text = text.replace(op.insertBefore, op.with + op.insertBefore);
    } else if (op.replaceLineContaining !== undefined) {
      const lines = text.split('\n');
      const hits = lines.map((line, index) => (line.includes(op.replaceLineContaining) ? index : -1)).filter(i => i >= 0);
      if (hits.length !== 1) throw new Error(`${rel}: line anchor ${hits.length} times: ${op.replaceLineContaining}`);
      lines[hits[0]] = op.with;
      text = lines.join('\n');
    } else if (op.replaceLineBlock !== undefined) {
      const lines = text.split('\n');
      const start = lines.findIndex(line => line.includes(op.replaceLineBlock.startContaining));
      if (start < 0) throw new Error(`${rel}: line block start not found: ${op.replaceLineBlock.startContaining}`);
      if (!lines[start + op.replaceLineBlock.skip].includes(op.replaceLineBlock.secondContaining)) {
        throw new Error(`${rel}: line block second line mismatch at ${start + op.replaceLineBlock.skip}`);
      }
      lines.splice(start, op.replaceLineBlock.skip + 1, op.with);
      text = lines.join('\n');
    } else {
      throw new Error('unknown op');
    }
  }
  store(rel, text);
}

// --------------------------------------------------------------------------
// Copy-only files.
// --------------------------------------------------------------------------
store('src/probe-hook.ts', payload('probe-hook.ts'));
store('tests/probe-setup.ts', payload('probe-setup.ts'));
store('tests/probes/edge-inputs.ts', payload('edge-inputs.ts'));
store('tests/probes/edge.test.ts', payload('edge.test.ts'));

// --------------------------------------------------------------------------
// vitest setupFiles.
// --------------------------------------------------------------------------
apply('vitest.config.ts', [
  { replace: "environment: 'node',", with: "environment: 'node', setupFiles: ['./tests/probe-setup.ts']," },
]);

// --------------------------------------------------------------------------
// continuation-brief.ts: renderer, approved methods, private blocked lines.
// --------------------------------------------------------------------------
apply('src/contracts/continuation-brief.ts', [
  {
    insertAfter: "import { ROUND_CHECK_INCOMPLETE_CAUSES, type VerificationRoundRef } from './verification.js';",
    with: "\nimport { probe } from '../probe-hook.js';",
  },
  {
    replace: 'export function renderContinuationBriefZh(brief: ContinuationBriefV1, digest: string): string {',
    with: `export function renderContinuationBriefZh(brief: ContinuationBriefV1, digest: string): string {
  const out = renderContinuationBriefZhImpl(brief, digest);
  probe('brief.render', [brief, digest], out);
  return out;
}
export function renderContinuationBriefZhImpl(brief: ContinuationBriefV1, digest: string): string {`,
  },
  {
    replace: `export function approvedMethodLinesZh(
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
): string[] {`,
    with: `export function approvedMethodLinesZh(
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
): string[] {
  const out = approvedMethodLinesZhImpl(methods);
  probe('brief.approvedMethods', [methods], out);
  return out;
}
export function approvedMethodLinesZhImpl(
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
): string[] {`,
  },
  {
    replace: `function blockedCommandsLinesZh(
  entries: NonNullable<ContinuationBriefV1['blockedCommands']>, keep: number, withCountLine: boolean,
): string[] {`,
    with: `function blockedCommandsLinesZh(
  entries: NonNullable<ContinuationBriefV1['blockedCommands']>, keep: number, withCountLine: boolean,
): string[] {
  const out = blockedCommandsLinesZhImpl(entries, keep, withCountLine);
  probe('brief.blockedCommands', [entries, keep, withCountLine], out);
  return out;
}
export function probeBlockedCommandsLinesZh(
  entries: NonNullable<ContinuationBriefV1['blockedCommands']>, keep: number, withCountLine: boolean,
): string[] {
  return blockedCommandsLinesZhImpl(entries, keep, withCountLine);
}
function blockedCommandsLinesZhImpl(
  entries: NonNullable<ContinuationBriefV1['blockedCommands']>, keep: number, withCountLine: boolean,
): string[] {`,
  },
]);

// --------------------------------------------------------------------------
// prepared-execution.ts: renderUnknownCallReviewZh.
// --------------------------------------------------------------------------
apply('src/contracts/core/prepared-execution.ts', [
  {
    insertAfter: "import type { BoundedTextV1 } from '../continuation-brief.js';",
    with: "\nimport { probe } from '../../probe-hook.js';",
  },
  {
    replace: 'export function renderUnknownCallReviewZh(input: UnknownCallReviewInputV1): string {',
    with: `export function renderUnknownCallReviewZh(input: UnknownCallReviewInputV1): string {
  const out = renderUnknownCallReviewZhImpl(input);
  probe('unknownCallReview.render', [input], out);
  return out;
}
export function renderUnknownCallReviewZhImpl(input: UnknownCallReviewInputV1): string {`,
  },
]);

// --------------------------------------------------------------------------
// role-profiles.ts: platformRoleProfile.
// --------------------------------------------------------------------------
apply('src/core/agent-runtime/role-profiles.ts', [
  {
    insertAfter: "import type { RoleResponsibilityV1 } from '../../contracts/role-spec.js';",
    with: "\nimport { probe } from '../../probe-hook.js';",
  },
  {
    replace: 'export function platformRoleProfile(duty: PlatformDutyV1): PlatformRoleProfileV1 {',
    with: `export function platformRoleProfile(duty: PlatformDutyV1): PlatformRoleProfileV1 {
  const out = platformRoleProfileImpl(duty);
  probe('roleProfile', [duty], out);
  return out;
}
export function platformRoleProfileImpl(duty: PlatformDutyV1): PlatformRoleProfileV1 {`,
  },
]);

// --------------------------------------------------------------------------
// execution-inputs.ts: formatDecisionResponseInput.
// --------------------------------------------------------------------------
apply('src/core/agent-runtime/execution-inputs.ts', [
  {
    insertAfter: "import type { SessionRecord as KernelSessionRecord } from '../../../vendor/coding-agent/dist/public-api.js';",
    with: "\nimport { probe } from '../../probe-hook.js';",
  },
  {
    replace: 'export function formatDecisionResponseInput(body: UserDecisionBodyV1): string {',
    with: `export function formatDecisionResponseInput(body: UserDecisionBodyV1): string {
  const out = formatDecisionResponseInputImpl(body);
  probe('decisionResponseInput', [body], out);
  return out;
}
export function formatDecisionResponseInputImpl(body: UserDecisionBodyV1): string {`,
  },
]);

// --------------------------------------------------------------------------
// architecture-reminders.ts: architectureReminderRowEntries.
// --------------------------------------------------------------------------
apply('src/core/agent-runtime/architecture-reminders.ts', [
  {
    insertAfter: "import { bestModuleDirectoryPrefixLength, pathOwnershipOf } from '../../contracts/path-ownership.js';",
    with: "\nimport { probe } from '../../probe-hook.js';",
  },
  {
    replace: `export function architectureReminderRowEntries(input: {
  facts: ArchitectureReminderFactsV1; taskModuleRef: ModuleRef | null; now: string;
}): ArchitectureReminderRow[] {`,
    with: `export function architectureReminderRowEntries(input: {
  facts: ArchitectureReminderFactsV1; taskModuleRef: ModuleRef | null; now: string;
}): ArchitectureReminderRow[] {
  const out = architectureReminderRowEntriesImpl(input);
  probe('architectureReminderRows', [input], out);
  return out;
}
export function architectureReminderRowEntriesImpl(input: {
  facts: ArchitectureReminderFactsV1; taskModuleRef: ModuleRef | null; now: string;
}): ArchitectureReminderRow[] {`,
  },
]);

// --------------------------------------------------------------------------
// note.ts: renderNoteHeader.
// --------------------------------------------------------------------------
apply('src/contracts/note.ts', [
  {
    insertAfter: "import type { PlatformDutyV1 } from './platform-duty.js';",
    with: "\nimport { probe } from '../probe-hook.js';",
  },
  {
    replace: 'export function renderNoteHeader(note: { kind: NoteKind; anchor: NoteAnchorV1; structural: boolean; conclusion: string }): string {',
    with: `export function renderNoteHeader(note: { kind: NoteKind; anchor: NoteAnchorV1; structural: boolean; conclusion: string }): string {
  const out = renderNoteHeaderImpl(note);
  probe('noteHeader', [note], out);
  return out;
}
export function renderNoteHeaderImpl(note: { kind: NoteKind; anchor: NoteAnchorV1; structural: boolean; conclusion: string }): string {`,
  },
]);

// --------------------------------------------------------------------------
// consultation.ts: extract the guidance expression, then wrap it.
// Base: inline template. Final: renderTemplate call. Same output either way.
// --------------------------------------------------------------------------
const CONSULTATION = 'src/business/workflow/consultation.ts';
const CONSULTATION_LEAD = "question: isolatedInquiry || value.part === 'response' ? question : ";
const CONSULTATION_BASE = CONSULTATION_LEAD + '`';
const CONSULTATION_FINAL = CONSULTATION_LEAD + 'renderTemplate(';
const CONSULTATION_CALL = '      question: isolatedInquiry || value.part === \'response\' ? question : consultationGuidanceText(message.ref.messageId, message.sourceRef),';
if (has(CONSULTATION, CONSULTATION_BASE)) {
  apply(CONSULTATION, [
    {
      insertAfter: "import { ownContext, type Owned } from './workflow.js';",
      with: "\nimport { probe } from '../../probe-hook.js';",
    },
    {
      insertBefore: 'export function createConsultationConsumer(deps: {',
      with: payload('consultation-guidance.ts') + '\n',
    },
    { replaceLineContaining: CONSULTATION_BASE, with: CONSULTATION_CALL },
  ]);
} else if (has(CONSULTATION, CONSULTATION_FINAL)) {
  apply(CONSULTATION, [
    {
      insertAfter: "import { ownContext, type Owned } from './workflow.js';",
      with: "\nimport { probe } from '../../probe-hook.js';",
    },
    {
      insertBefore: 'export function createConsultationConsumer(deps: {',
      with: payload('consultation-guidance-final.ts') + '\n',
    },
    {
      replaceLineBlock: {
        startContaining: CONSULTATION_FINAL,
        skip: 2,
        secondContaining: 'sourceJson: JSON.stringify(message.sourceRef)',
      },
      with: CONSULTATION_CALL,
    },
  ]);
} else {
  throw new Error(`${CONSULTATION}: neither the base nor the final guidance expression was found`);
}

// --------------------------------------------------------------------------
// host.ts: extract the scribe reminder expression, then wrap it.
// Base: inline template. Final: renderTemplate call. Same output either way.
// --------------------------------------------------------------------------
const HOST = 'src/app/host.ts';
const HOST_BASE_MARKER = "const SCRIBE_REMINDER_MARKER = '书记提醒：';";
const HOST_FINAL_MARKER = "const SCRIBE_REMINDER_MARKER = PLATFORM_PROMPT_PACK_V1.strings['scribe.marker'];";
const HOST_BASE_TEXT = 'const text = `${SCRIBE_REMINDER_MARKER}待审';
const HOST_FINAL_TEXT = "const text = renderTemplate(PLATFORM_PROMPT_PACK_V1, 'scribe-reminder', {";
const HOST_CALL = '    const text = scribeReminderText(pendingCount, updateDueCount, anchorNames);';
if (has(HOST, HOST_BASE_MARKER) && has(HOST, HOST_BASE_TEXT)) {
  apply(HOST, [
    {
      insertAfter: "import { MIB, defaultResourceCapSettings } from '../contracts/resource-caps.js';",
      with: "\nimport { probe } from '../probe-hook.js';",
    },
    { insertAfter: HOST_BASE_MARKER, with: '\n' + payload('scribe-reminder.ts') },
    {
      replaceLineBlock: { startContaining: HOST_BASE_TEXT, skip: 1, secondContaining: '锚点：' },
      with: HOST_CALL,
    },
  ]);
} else if (has(HOST, HOST_FINAL_MARKER) && has(HOST, HOST_FINAL_TEXT)) {
  apply(HOST, [
    {
      insertAfter: "import { MIB, defaultResourceCapSettings } from '../contracts/resource-caps.js';",
      with: "\nimport { probe } from '../probe-hook.js';",
    },
    { insertAfter: HOST_FINAL_MARKER, with: '\n' + payload('scribe-reminder-final.ts') },
    {
      replaceLineBlock: { startContaining: HOST_FINAL_TEXT, skip: 5, secondContaining: "}, []).text;" },
      with: HOST_CALL,
    },
  ]);
} else {
  throw new Error(`${HOST}: neither the base nor the final scribe reminder expression was found`);
}

// --------------------------------------------------------------------------
// context-extensions.ts: the three row texts of row 46.
// Base: inline templates. Final: PLATFORM_PROMPT_PACK_V1.strings lookups.
// --------------------------------------------------------------------------
const CONTEXT = 'src/core/work-graph/views/context-extensions.ts';
const CONTEXT_BASE_DECISION = '      text: `待决定：${card.source.kind}；source=${card.source.key}`,';
const CONTEXT_FINAL_DECISION = "contextExtension.decisionPrefix";
const CONTEXT_FINAL_UNAVAILABLE = "contextExtension.unavailablePrefix";
if (has(CONTEXT, CONTEXT_BASE_DECISION)) {
  apply(CONTEXT, [
    {
      insertAfter: "import type { NoteMemoryMaterialPort, NoteMemoryMaterialV1 } from '../model/note-contracts.js';",
      with: "\nimport { probe } from '../../../probe-hook.js';",
    },
    { replace: CONTEXT_BASE_DECISION, with: '      text: decisionRowText(card.source),' },
    { replace: '      text: `待决来源尚未接入：${capability.source}`,', with: '      text: notAvailableRowText(capability.source),' },
    {
      replace: 'function anchorText(anchor: SessionAnomalyAnchorV1): string {',
      with: 'function anchorTextImpl(anchor: SessionAnomalyAnchorV1): string {',
    },
    {
      insertBefore: 'function anchorRow(item: SessionAnomalyViewV1): ContextIndexRowV1 {',
      with: payload('context-extension-texts.ts') + '\n',
    },
  ]);
} else if (has(CONTEXT, CONTEXT_FINAL_DECISION) && has(CONTEXT, CONTEXT_FINAL_UNAVAILABLE)) {
  apply(CONTEXT, [
    {
      insertAfter: "import type { NoteMemoryMaterialPort, NoteMemoryMaterialV1 } from '../model/note-contracts.js';",
      with: "\nimport { probe } from '../../../probe-hook.js';",
    },
    { replaceLineContaining: CONTEXT_FINAL_DECISION, with: '      text: decisionRowText(card.source),' },
    { replaceLineContaining: CONTEXT_FINAL_UNAVAILABLE, with: '      text: notAvailableRowText(capability.source),' },
    {
      replace: 'function anchorText(anchor: SessionAnomalyAnchorV1): string {',
      with: 'function anchorTextImpl(anchor: SessionAnomalyAnchorV1): string {',
    },
    {
      insertBefore: 'function anchorRow(item: SessionAnomalyViewV1): ContextIndexRowV1 {',
      with: payload('context-extension-texts-final.ts') + '\n',
    },
  ]);
} else {
  throw new Error(`${CONTEXT}: neither the base nor the final row texts were found`);
}

if (checkOnly) {
  console.log(`all anchors match in ${root} (nothing written)`);
  process.exit(0);
}
for (const [rel, text] of files) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
console.log(`probe installed in ${root}`);
