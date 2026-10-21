#!/usr/bin/env node
/**
 * S4 (D3b) byte-proof probe installer — BASE variant.
 *
 * Usage: node apply-probe-base.mjs <copy-dir> [--check]
 *
 * Applies the SAME probe to a scratch copy of the repository. It never touches
 * the repository tree. Two installers exist:
 *
 *   apply-probe-base.mjs    wraps the base functions in
 *                           `src/core/agent-runtime/context-assembler.ts`
 *   apply-probe-result.mjs  wraps the result modules
 *                           `context-rendering.ts`, `context-fact-text.ts`
 *                           and the nested `generalWarningLabel`
 *
 * Both produce the same record shape and both write
 * `tests/probes/edge-targets.ts` (the only per-copy difference is the import
 * specifiers). Every module-level target is wrapped by renaming the real
 * declaration `NAME` -> `NAMEImpl` and appending a same-name wrapper plus an
 * exported `probeNAME`; function declarations hoist, so the appended wrapper is
 * the one every existing caller resolves. `generalWarningLabel` is nested in
 * `createNoteReadModel`; it is renamed and wrapped in place and its probe source
 * is registered with a module-level hook appended to the file.
 *
 * Every patch asserts that its anchor occurs exactly once. All edits are made in
 * memory and written only after every anchor matched. `--check` only verifies.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
if (root === undefined || root === '') {
  console.error('usage: node apply-probe-base.mjs <copy-dir> [--check]');
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

function replaceOnce(rel, needle, withText) {
  const text = load(rel);
  const n = count(text, needle);
  if (n !== 1) throw new Error(`${rel}: anchor ${String(n)} times, wanted 1: ${needle.slice(0, 100)}`);
  store(rel, text.replace(needle, withText));
}
function prependOnce(rel, line) {
  const text = load(rel);
  if (text.includes(line)) return;
  store(rel, line + '\n' + text);
}
function append(rel, text) {
  const current = load(rel);
  store(rel, current + (current.endsWith('\n') ? '' : '\n') + text);
}
function cap(name) { return name.charAt(0).toUpperCase() + name.slice(1); }

/** Rename `NAME` to `NAMEImpl` and append the wrapper and probe accessor. */
function wrapByName(rel, name, probeName, exported) {
  const declaration = `${exported ? 'export ' : ''}function ${name}(`;
  replaceOnce(rel, declaration, `function ${name}Impl(`);
  append(rel, `${exported ? 'export ' : ''}function ${name}(...args: Parameters<typeof ${name}Impl>): ReturnType<typeof ${name}Impl> {
  const out = ${name}Impl(...args);
  probe(${JSON.stringify(probeName)}, args, out);
  return out;
}
export function probe${cap(name)}(...args: Parameters<typeof ${name}Impl>): ReturnType<typeof ${name}Impl> {
  return ${name}Impl(...args);
}
`);
}

// --------------------------------------------------------------------------
// Copy-only files.
// --------------------------------------------------------------------------
store('src/probe-hook.ts', payload('probe-hook.ts'));
store('tests/probe-setup.ts', payload('probe-setup.ts'));
store('tests/probes/edge-cases.ts', payload('edge-cases.ts'));
store('tests/probes/edge.test.ts', payload('edge.test.ts'));
store('tests/probes/edge-targets.ts', payload('edge-targets-base.ts'));
store('tests/probes/planning-query.test.ts', payload('planning-query.test.ts'));

// --------------------------------------------------------------------------
// vitest setupFiles.
// --------------------------------------------------------------------------
replaceOnce('vitest.config.ts', "environment: 'node',",
  "environment: 'node', setupFiles: ['./tests/probe-setup.ts'],");

// --------------------------------------------------------------------------
// context-assembler.ts: renderContext, renderAttentionChanges, fact formatters.
// --------------------------------------------------------------------------
const ASSEMBLER = 'src/core/agent-runtime/context-assembler.ts';
prependOnce(ASSEMBLER, "import { probe } from '../../probe-hook.js';");
wrapByName(ASSEMBLER, 'renderContext', 'renderContext', true);
wrapByName(ASSEMBLER, 'renderAttentionChanges', 'renderAttentionChanges', true);
for (const name of [
  'effectiveDuty', 'rolePayload', 'goalPayload', 'taskPayload', 'queryFocusLines',
  'queryPlanSummary', 'notImplementedExtensions', 'noteSourcesOf', 'declarationsForTask',
  'missingInputReminder', 'optionalRowsFromExtensions', 'annotations', 'topLevelModuleCards',
]) {
  wrapByName(ASSEMBLER, name, `fact.${name}`, false);
}

// --------------------------------------------------------------------------
// note-read-model.ts: the nested generalWarningLabel (row 28).
// --------------------------------------------------------------------------
const NOTE_MODEL = 'src/core/work-graph/notes/note-read-model.ts';
prependOnce(NOTE_MODEL, "import { probe } from '../../../probe-hook.js';");
replaceOnce(NOTE_MODEL,
  '  function generalWarningLabel(item: NoteItemV1, head: NoteHeadSnapshot): string | null {',
  `  function generalWarningLabel(item: NoteItemV1, head: NoteHeadSnapshot): string | null {
    const out = generalWarningLabelImpl(item, head);
    probe('note.generalWarningLabel', [item, head], out);
    return out;
  }
  setGeneralWarningLabelProbeSource(generalWarningLabelImpl);
  function generalWarningLabelImpl(item: NoteItemV1, head: NoteHeadSnapshot): string | null {`);
append(NOTE_MODEL, `let generalWarningLabelProbeSource: ((item: NoteItemV1, head: NoteHeadSnapshot) => string | null) | null = null;
export function setGeneralWarningLabelProbeSource(source: (item: NoteItemV1, head: NoteHeadSnapshot) => string | null): void {
  generalWarningLabelProbeSource = source;
}
export function probeGeneralWarningLabel(item: NoteItemV1, head: NoteHeadSnapshot): string | null {
  if (generalWarningLabelProbeSource === null) throw new Error('generalWarningLabel probe source is not registered');
  return generalWarningLabelProbeSource(item, head);
}
`);

if (checkOnly) {
  console.log(`all base anchors match in ${root} (nothing written)`);
  process.exit(0);
}
for (const [rel, text] of files) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
console.log(`base probe installed in ${root}`);
