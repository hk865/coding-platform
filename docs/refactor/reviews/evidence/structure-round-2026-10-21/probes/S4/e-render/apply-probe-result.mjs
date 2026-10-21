#!/usr/bin/env node
/**
 * S4 (D3b) byte-proof probe installer — RESULT variant.
 *
 * Usage: node apply-probe-result.mjs <copy-dir> [--check]
 *
 * Same probe and the same record shape as apply-probe-base.mjs, but wraps the
 * result modules:
 *   src/core/agent-runtime/context-rendering.ts   renderContext, renderAttentionChanges
 *   src/core/agent-runtime/context-fact-text.ts   the 13 fact formatters
 *   src/core/work-graph/notes/note-read-model.ts  the nested generalWarningLabel
 *
 * `wrapByName` asserts the exact `export function NAME(` declaration occurs once
 * in the named module (anchor-asserting): a moved or renamed function fails the
 * installer before anything is written. The edge harness and case list are
 * identical to the base variant; only `tests/probes/edge-targets.ts` differs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
if (root === undefined || root === '') {
  console.error('usage: node apply-probe-result.mjs <copy-dir> [--check]');
  process.exit(2);
}
const checkOnly = process.argv.includes('--check');

const files = new Map();
function load(rel) { if (!files.has(rel)) files.set(rel, readFileSync(join(root, rel), 'utf8')); return files.get(rel); }
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

function wrapByName(rel, name, probeName) {
  replaceOnce(rel, `export function ${name}(`, `function ${name}Impl(`);
  append(rel, `export function ${name}(...args: Parameters<typeof ${name}Impl>): ReturnType<typeof ${name}Impl> {
  const out = ${name}Impl(...args);
  probe(${JSON.stringify(probeName)}, args, out);
  return out;
}
export function probe${cap(name)}(...args: Parameters<typeof ${name}Impl>): ReturnType<typeof ${name}Impl> {
  return ${name}Impl(...args);
}
`);
}

store('src/probe-hook.ts', payload('probe-hook.ts'));
store('tests/probe-setup.ts', payload('probe-setup.ts'));
store('tests/probes/edge-cases.ts', payload('edge-cases.ts'));
store('tests/probes/edge.test.ts', payload('edge.test.ts'));
store('tests/probes/edge-targets.ts', payload('edge-targets-result.ts'));
store('tests/probes/planning-query.test.ts', payload('planning-query.test.ts'));

replaceOnce('vitest.config.ts', "environment: 'node',",
  "environment: 'node', setupFiles: ['./tests/probe-setup.ts'],");

const RENDERING = 'src/core/agent-runtime/context-rendering.ts';
prependOnce(RENDERING, "import { probe } from '../../probe-hook.js';");
wrapByName(RENDERING, 'renderContext', 'renderContext');
// The result split the Query path out; Query calls are replayed through this
// function by the adapter (classified by the query prelude), so wrap it too.
wrapByName(RENDERING, 'renderQueryContext', 'renderQueryContext');
wrapByName(RENDERING, 'renderAttentionChanges', 'renderAttentionChanges');

const FACT_TEXT = 'src/core/agent-runtime/context-fact-text.ts';
prependOnce(FACT_TEXT, "import { probe } from '../../probe-hook.js';");
for (const name of [
  'effectiveDuty', 'rolePayload', 'goalPayload', 'taskPayload', 'queryFocusLines',
  'queryPlanSummary', 'notImplementedExtensions', 'noteSourcesOf', 'declarationsForTask',
  'missingInputReminder', 'optionalRowsFromExtensions', 'annotations', 'topLevelModuleCards',
]) {
  wrapByName(FACT_TEXT, name, `fact.${name}`);
}

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
  console.log(`all result anchors match in ${root} (nothing written)`);
  process.exit(0);
}
for (const [rel, text] of files) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
console.log(`result probe installed in ${root}`);
