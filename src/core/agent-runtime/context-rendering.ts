/**
 * The pure context renderer. It owns the frozen section order, the byte
 * budget of the four optional sections and the exact `\n\n` separators (no
 * trailing LF); every literal comes from the platform pack.
 *
 * The budget keeps the longest global prefix of optional rows (per-section
 * sort, full `k = 0..totalRows` scan); the text is rendered from one frozen
 * template exactly once, and the section intervals the binding records are
 * derived from the template's slot ranges.
 */
import type {
  AttentionChangesV1, ContextAssemblyBindingV1, ContextCallKindV1, ContextSectionNameV1,
} from '../../contracts/graph-context.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptSetV1, PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import { byKey, utf8Bytes } from './context-support.js';
import type { OptionalRow, OptionalSectionName } from './context-types.js';

/** A direct call without a resolved pack keeps the generated platform pack (ruling 14). */
const DEFAULT_TEXTS: PromptTextsV1 = PLATFORM_PROMPT_PACK_V1;

/** One fixed string of the resolved pack; a missing key is a pack bug. */
function packString(texts: PromptTextsV1, key: string): string {
  const value = texts.strings[key];
  if (value === undefined) throw new Error(`the resolved prompt pack has no string "${key}"`);
  return value;
}

/** The section headers of one resolved pack, in render order. */
export function contextSectionHeaders(texts: PromptTextsV1): Readonly<Record<ContextSectionNameV1, string>> {
  return {
    role: packString(texts, 'context.section.role'),
    goal: packString(texts, 'context.section.goal'),
    task: packString(texts, 'context.section.task'),
    footprint: packString(texts, 'context.section.footprint'),
    notes: packString(texts, 'context.section.notes'),
    reminders: packString(texts, 'context.section.reminders'),
    inputs: packString(texts, 'context.section.inputs'),
    continuation: '',
    unknown_call_review: '',
  };
}

export function workContextPrelude(texts: PromptTextsV1): string { return packString(texts, 'context.prelude.work'); }
export function queryContextPrelude(texts: PromptTextsV1): string { return packString(texts, 'context.prelude.query'); }

/** The frozen format version of an assembled context binding (§4.3). */
export const CONTEXT_FORMAT_VERSION = 's3-context-v1' as const;

export const CONTEXT_SECTION_ORDER: readonly ContextSectionNameV1[] = [
  'role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation',
];

/** R1: the review instruction is the last section, legal only for the `work` call kind. */
const SECTION_ORDER_WITH_REVIEW: readonly ContextSectionNameV1[] = [...CONTEXT_SECTION_ORDER, 'unknown_call_review'];

/** The sections each template declares a slot for (the template half of ruling 18). */
const TEMPLATE_SECTIONS: Readonly<Record<ContextTemplateId, readonly ContextSectionNameV1[]>> = {
  'work-input': SECTION_ORDER_WITH_REVIEW,
  'query-planning-input': ['role', 'goal', 'task', 'footprint'],
  'query-copy-input': ['role', 'goal', 'task'],
};

/** The call-kind half of ruling 18 (the table of state/context-input.ts ~65-73, for the kinds a preparation produces). */
const CALL_KIND_SECTIONS: Readonly<Partial<Record<ContextCallKindV1, readonly ContextSectionNameV1[]>>> = {
  work: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'unknown_call_review'],
  continuation: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation'],
  planning: ['role', 'goal', 'task', 'footprint'],
  copy: ['role', 'goal', 'task'],
};

/**
 * Ruling 18: today's fixed section order projected onto what a template and a
 * call kind allow. PC-1 records it; nothing reads it yet.
 */
export function sectionOrderFor(
  callKind: 'work' | 'continuation' | 'planning' | 'copy',
  templateId: ContextTemplateId,
): ContextSectionNameV1[] {
  const callKindAllowed = new Set(CALL_KIND_SECTIONS[callKind] ?? []);
  const templateAllowed = new Set(TEMPLATE_SECTIONS[templateId]);
  return SECTION_ORDER_WITH_REVIEW.filter(name => callKindAllowed.has(name) && templateAllowed.has(name));
}

/** Every call kind a Work preparation can produce (`work` also covers a review-purpose Run). */
export function workPreparedSectionOrder(): PromptSetV1['sectionOrder'] {
  return { work: sectionOrderFor('work', 'work-input'),
    continuation: sectionOrderFor('continuation', 'work-input') };
}

/** Every call kind a Query preparation can produce. */
export function queryPreparedSectionOrder(): PromptSetV1['sectionOrder'] {
  return { planning: sectionOrderFor('planning', 'query-planning-input'),
    copy: sectionOrderFor('copy', 'query-copy-input') };
}

const OPTIONAL_SECTIONS: readonly OptionalSectionName[] = CONTEXT_SECTION_ORDER.filter(
  (name): name is OptionalSectionName =>
    name === 'footprint' || name === 'notes' || name === 'reminders' || name === 'inputs',
);

export const ATTENTION_HEADER = '[attention s3-v1]';
export const ATTENTION_MAX_BYTES = 16_384;

type RenderResult = {
  input: string; sections: ContextAssemblyBindingV1['sections']; residentBytes: number; totalBytes: number;
};

type ContextTemplateId = 'work-input' | 'query-planning-input' | 'query-copy-input';

/** The optional sections each frozen template actually declares a slot for. */
const TEMPLATE_OPTIONAL_SECTIONS: Readonly<Record<ContextTemplateId, readonly OptionalSectionName[]>> = {
  'work-input': OPTIONAL_SECTIONS,
  'query-planning-input': ['footprint'],
  'query-copy-input': [],
};

/** A pack slot that is empty renders nothing, so the `\n\n` must be inside the value. */
const omissionLine = (texts: PromptTextsV1, count: number): string =>
  packString(texts, 'context.omissions.prefix') + String(count) + packString(texts, 'context.omissions.suffix');

type RenderInput = {
  templateId: ContextTemplateId;
  prelude: string;
  required: { role: string; goal: string | null; task: string | null };
  optional: Partial<Record<OptionalSectionName, OptionalRow[]>>;
  continuationSuffix: string | null;
  reviewSuffix: string | null;
  residentBudgetBytes: number;
  texts: PromptTextsV1;
};

function renderWithTemplate(input: RenderInput): RenderResult {
  const texts = input.texts;
  const headers = contextSectionHeaders(texts);
  const allowed = TEMPLATE_OPTIONAL_SECTIONS[input.templateId];
  const present = allowed
    // §11.4/L20: the `notes` rows already arrive in the memory material's source
    // order; every other optional section keeps its deterministic key sort.
    .map((name) => ({
      name,
      rows: name === 'notes'
        ? [...(input.optional[name] ?? [])]
        : [...(input.optional[name] ?? [])].sort(byKey),
    }))
    .filter((section) => section.rows.length > 0);
  const totalRows = present.reduce((sum, section) => sum + section.rows.length, 0);

  const renderPrefix = (k: number): { text: string; omitted: Map<OptionalSectionName, number> } => {
    let remaining = k;
    const omitted = new Map<OptionalSectionName, number>();
    const parts: string[] = [];
    for (const section of present) {
      const kept = Math.min(remaining, section.rows.length);
      remaining -= kept;
      const missing = section.rows.length - kept;
      omitted.set(section.name, missing);
      let text = headers[section.name];
      if (kept > 0) text += '\n' + section.rows.slice(0, kept).map((row) => row.text).join('\n');
      if (missing > 0) text += '\n' + omissionLine(texts, missing);
      parts.push(text);
    }
    return { text: parts.length === 0 ? '' : '\n\n' + parts.join('\n\n'), omitted };
  };

  // The longest global prefix whose FULL billed string fits. Scanning every k
  // (not stopping at the first failure) keeps the omission counts exact.
  let chosen = -1;
  let chosenRender: { text: string; omitted: Map<OptionalSectionName, number> } | null = null;
  for (let k = 0; k <= totalRows; k += 1) {
    const rendered = renderPrefix(k);
    if (utf8Bytes(rendered.text) <= input.residentBudgetBytes) { chosen = k; chosenRender = rendered; }
  }

  const goal = input.required.goal;
  const task = input.required.task;
  const slots: Record<string, string | undefined> = {
    prelude: input.prelude,
    role: headers.role + '\n' + input.required.role,
    goal: goal === null ? undefined : '\n\n' + headers.goal + '\n' + goal,
    task: task === null ? undefined : '\n\n' + headers.task + '\n' + task,
  };
  // Pass exactly the slots each frozen template's table declares; an absent
  // section is an undefined value, not a missing key.
  if (input.templateId === 'work-input') {
    slots.footprint = undefined;
    slots.notes = undefined;
    slots.reminders = undefined;
    slots.inputs = undefined;
    slots.continuation = input.continuationSuffix === null ? undefined : '\n\n' + input.continuationSuffix;
    slots.unknown_call_review = input.reviewSuffix === null ? undefined : '\n\n' + input.reviewSuffix;
  }
  if (input.templateId === 'query-planning-input') slots.footprint = undefined;

  const omittedSections: { name: OptionalSectionName; count: number }[] = [];
  const optionalSections: { name: OptionalSectionName; omitted: number }[] = [];
  let residentBytes = 0;
  const fallback = chosen < 0 || chosenRender === null;

  if (!fallback && present.length > 0) {
    let remaining = chosen;
    for (const section of present) {
      const kept = Math.min(remaining, section.rows.length);
      remaining -= kept;
      const missing = section.rows.length - kept;
      let text = headers[section.name];
      if (kept > 0) text += '\n' + section.rows.slice(0, kept).map((row) => row.text).join('\n');
      if (missing > 0) text += '\n' + omissionLine(texts, missing);
      slots[section.name] = '\n\n' + text;
      optionalSections.push({ name: section.name, omitted: missing });
    }
  }

  if (fallback) {
    // Even the k=0 marker structure is too large: render no optional section
    // body and list the omitted counts on the last required card instead.
    const lines: string[] = [];
    for (const name of allowed) {
      const count = (input.optional[name] ?? []).length;
      if (count === 0) continue;
      lines.push(`${name}${packString(texts, 'context.omissions.nameSeparator')}${omissionLine(texts, count)}`);
      omittedSections.push({ name, count });
    }
    if (lines.length > 0) {
      const block = '\n\n' + packString(texts, 'context.omissions.heading') + '\n' + lines.join('\n');
      // §4.3/G5.5: the mandatory omission metadata is appended at the end of the
      // required task section (or the goal section when no task exists, or the role
      // section when neither exists). The block is part of that slot's value, so the
      // section's interval, derived from the slot's range, covers those lines and
      // they are not outside every interval.
      if (task !== null) slots.task = (slots.task ?? '') + block;
      else if (goal !== null) slots.goal = (slots.goal ?? '') + block;
      else slots.role = (slots.role ?? '') + block;
    }
  }

  const rendered = renderTemplate(texts, input.templateId, slots, []);
  const rangeOf = (name: string) => {
    const range = rendered.sectionRanges[name];
    // Every slot below has a non-empty value, so a missing range is a code bug.
    if (range === undefined) throw new Error(`template "${input.templateId}" rendered no "${name}" slot`);
    return range;
  };

  const sections: ContextAssemblyBindingV1['sections'] = [];
  const roleRange = rangeOf('role');
  sections.push({ name: 'role', startByte: roleRange.startByte, endByte: roleRange.endByte, omitted: 0 });
  let lastRequiredEnd = roleRange.endByte;
  if (goal !== null) {
    const range = rangeOf('goal');
    sections.push({ name: 'goal', startByte: range.startByte + 2, endByte: range.endByte, omitted: 0 });
    lastRequiredEnd = range.endByte;
  }
  if (task !== null) {
    const range = rangeOf('task');
    sections.push({ name: 'task', startByte: range.startByte + 2, endByte: range.endByte, omitted: 0 });
    lastRequiredEnd = range.endByte;
  }

  if (fallback) {
    for (const omitted of omittedSections) {
      sections.push({ name: omitted.name, startByte: null, endByte: null, omitted: omitted.count });
    }
  } else {
    for (const section of optionalSections) {
      const range = rangeOf(section.name);
      sections.push({
        name: section.name, startByte: range.startByte + 2, endByte: range.endByte, omitted: section.omitted,
      });
    }
    if (present.length > 0) {
      const lastOptional = present[present.length - 1];
      if (lastOptional !== undefined) residentBytes = rangeOf(lastOptional.name).endByte - lastRequiredEnd;
    }
  }

  if (input.templateId === 'work-input' && input.continuationSuffix !== null) {
    const range = rangeOf('continuation');
    sections.push({ name: 'continuation', startByte: range.startByte + 2, endByte: range.endByte, omitted: 0 });
  }
  // R1/D1: the review instruction is the LAST section and is emitted only for a
  // review-purpose Work Run (`reviewSuffix` is null on every other call).
  if (input.templateId === 'work-input' && input.reviewSuffix !== null) {
    const range = rangeOf('unknown_call_review');
    sections.push({ name: 'unknown_call_review', startByte: range.startByte + 2, endByte: range.endByte, omitted: 0 });
  }

  const text = rendered.text;
  return { input: text, sections, residentBytes, totalBytes: utf8Bytes(text) };
}

export function renderContext(input: {
  prelude: string;
  required: { role: string; goal: string | null; task: string | null };
  optional: Partial<Record<'footprint' | 'notes' | 'reminders' | 'inputs', { key: string; text: string }[]>>;
  continuationSuffix: string | null;
  /** R1: the rendered `unknown_call_review` section of a review-purpose Work Run. */
  reviewSuffix?: string | null;
  residentBudgetBytes: number;
  /** The resolved pack; absent keeps the generated pack for a direct call. */
  texts?: PromptTextsV1;
}): RenderResult {
  return renderWithTemplate({
    templateId: 'work-input',
    prelude: input.prelude,
    required: input.required,
    optional: input.optional,
    continuationSuffix: input.continuationSuffix,
    reviewSuffix: input.reviewSuffix ?? null,
    residentBudgetBytes: input.residentBudgetBytes,
    texts: input.texts ?? DEFAULT_TEXTS,
  });
}

export function renderQueryContext(input: {
  templateId: 'query-planning-input' | 'query-copy-input';
  prelude: string;
  required: { role: string; goal: string | null; task: string | null };
  optional: Partial<Record<'footprint', OptionalRow[]>>;
  residentBudgetBytes: number;
  /** The resolved pack; absent keeps the generated pack for a direct call. */
  texts?: PromptTextsV1;
}): RenderResult {
  return renderWithTemplate({
    templateId: input.templateId,
    prelude: input.prelude,
    required: input.required,
    optional: input.optional,
    continuationSuffix: null,
    reviewSuffix: null,
    residentBudgetBytes: input.residentBudgetBytes,
    texts: input.texts ?? DEFAULT_TEXTS,
  });
}

export function renderAttentionChanges(input: AttentionChangesV1): string {
  const scopeLine = JSON.stringify({
    kind: 'scope', projectId: input.scope.projectId, workspaceId: input.scope.workspaceId,
    goalId: input.goalRef === null ? null : input.goalRef.goalId,
  });
  const rows: string[] = [];
  if (input.revision !== null) {
    rows.push(JSON.stringify({
      kind: 'revision', key: 'graph', change: 'revision_change',
      beforeVersion: input.revision.before, afterVersion: input.revision.after,
    }));
  }
  for (const change of [...input.nodes].sort(byKey)) {
    rows.push(JSON.stringify({
      kind: 'node', key: change.key, change: change.change,
      beforeVersion: change.beforeVersion, afterVersion: change.afterVersion,
      node: change.detail.node, name: change.detail.name, summary: change.detail.summary, state: change.detail.state,
    }));
  }
  for (const edge of [...input.edges].sort(byKey)) {
    rows.push(JSON.stringify({ kind: 'edge', key: edge.key, change: edge.change }));
  }
  for (const file of [...input.files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))) {
    rows.push(JSON.stringify({ kind: 'file', key: file.path, version: file.version }));
  }
  for (const id of [...input.feedbackIds].sort()) {
    rows.push(JSON.stringify({ kind: 'feedback', key: id }));
  }
  if (input.heartbeat !== null) {
    rows.push(JSON.stringify({
      kind: 'heartbeat', key: 'heartbeat',
      pendingInputs: input.heartbeat.pendingInputs, messageCursor: input.heartbeat.messageCursor,
    }));
  }

  const omittedLine = (count: number): string => JSON.stringify({
    kind: 'omitted', count, hint: omissionLine(DEFAULT_TEXTS, count),
  });
  // §4.5/G5.6: keep the longest prefix whose ACTUAL final text fits. The last
  // kept row needs no omission line (count 0), so reserving one always would
  // wrongly drop a row that fits.
  const baseBytes = utf8Bytes(ATTENTION_HEADER) + 1 + utf8Bytes(scopeLine);
  let running = baseBytes;
  let kept = 0;
  for (let k = 1; k <= rows.length; k += 1) {
    running += 1 + utf8Bytes(rows[k - 1] ?? '');
    const omittedBytes = k < rows.length ? 1 + utf8Bytes(omittedLine(rows.length - k)) : 0;
    if (running + omittedBytes <= ATTENTION_MAX_BYTES) kept = k;
  }
  const omittedCount = rows.length - kept;
  const lines = [ATTENTION_HEADER, scopeLine, ...rows.slice(0, kept)];
  if (omittedCount > 0) lines.push(omittedLine(omittedCount));
  return lines.join('\n');
}
