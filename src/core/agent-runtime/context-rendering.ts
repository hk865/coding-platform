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
import { parseTemplateV1, renderTemplate } from '../../contracts/prompts/render-template.js';
import { byKey, utf8Bytes } from './context-support.js';
import type {
  ContextRenderMaterialV1, ContextRerenderV1, ContextSectionPlanV1, ContextTemplateId,
  OptionalRow, OptionalSectionName,
} from './context-types.js';

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

/**
 * The platform pack v2 `work-input` order (ruling 9). It is also the vocabulary
 * of section names the template scan recognizes, so a pack cannot smuggle in a
 * name the binding format does not know.
 */
export const CONTEXT_SECTION_ORDER: readonly ContextSectionNameV1[] = [
  'role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'unknown_call_review', 'reminders',
];

const SECTION_NAMES: ReadonlySet<string> = new Set(CONTEXT_SECTION_ORDER);

/** The call-kind half of ruling 9 (the table of state/context-input.ts, for the kinds a preparation produces). */
const CALL_KIND_SECTIONS: Readonly<Partial<Record<ContextCallKindV1, readonly ContextSectionNameV1[]>>> = {
  work: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'unknown_call_review', 'reminders'],
  continuation: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'reminders'],
  planning: ['role', 'goal', 'task', 'footprint'],
  copy: ['role', 'goal', 'task'],
};

/**
 * Ruling 9: the order lives in the input template's text. The resolver has
 * already validated the template, so a failure here is a pack bug.
 */
export function templateSectionOrder(texts: PromptTextsV1, templateId: ContextTemplateId): ContextSectionNameV1[] {
  const source = texts.templates[templateId];
  if (source === undefined) throw new Error(`the resolved prompt pack has no template "${templateId}"`);
  const parsed = parseTemplateV1(templateId, source);
  if (parsed.status === 'invalid') throw new Error(parsed.error.message);
  const order: ContextSectionNameV1[] = [];
  for (const node of parsed.nodes) {
    if (node.kind === 'slot' && SECTION_NAMES.has(node.name)) order.push(node.name as ContextSectionNameV1);
  }
  return order;
}

/**
 * Ruling 9/11: the template's slot order projected onto the call kind's legal
 * sections. A person's pack that declares another legal order is followed.
 */
export function sectionOrderFor(
  callKind: 'work' | 'continuation' | 'planning' | 'copy',
  templateId: ContextTemplateId,
  texts: PromptTextsV1 = DEFAULT_TEXTS,
): ContextSectionNameV1[] {
  const allowed = new Set(CALL_KIND_SECTIONS[callKind] ?? []);
  return templateSectionOrder(texts, templateId).filter(name => allowed.has(name));
}

/** Every call kind a Work preparation can produce (`work` also covers a review-purpose Run). */
export function workPreparedSectionOrder(texts: PromptTextsV1 = DEFAULT_TEXTS): PromptSetV1['sectionOrder'] {
  return { work: sectionOrderFor('work', 'work-input', texts),
    continuation: sectionOrderFor('continuation', 'work-input', texts) };
}

/**
 * Every call kind a Query preparation can produce. PC-1 records only the call
 * kinds the pack covers, so a pack that declares one Query template records one
 * kind; the platform pack declares both.
 */
export function queryPreparedSectionOrder(texts: PromptTextsV1 = DEFAULT_TEXTS): PromptSetV1['sectionOrder'] {
  const order: PromptSetV1['sectionOrder'] = {};
  if (texts.templates['query-planning-input'] !== undefined)
    order.planning = sectionOrderFor('planning', 'query-planning-input', texts);
  if (texts.templates['query-copy-input'] !== undefined)
    order.copy = sectionOrderFor('copy', 'query-copy-input', texts);
  return order;
}

/**
 * Ruling 10/18: a Skill renders like `base`, through the renderer with the
 * frozen final tool list and no slots. Q builds each `SkillContext` with it.
 */
export function renderSkillTextV1(
  texts: PromptTextsV1, templateId: string, toolNames: readonly string[],
): string {
  return renderTemplate(texts, templateId, {}, toolNames).text;
}

/** Absent `toolNames` means every tool block renders (ruling 10): the generated pack's full set. */
function everyToolName(): readonly string[] {
  return Object.keys(PLATFORM_PROMPT_PACK_V1.tools);
}

/** Ruling 10: the BUDGET order stays footprint, notes, reminders, inputs; a template cannot change it. */
const OPTIONAL_SECTIONS: readonly OptionalSectionName[] = ['footprint', 'notes', 'reminders', 'inputs'];

export const ATTENTION_HEADER = '[attention s3-v1]';
export const ATTENTION_MAX_BYTES = 16_384;

type RenderResult = {
  input: string; sections: ContextAssemblyBindingV1['sections']; residentBytes: number; totalBytes: number;
  /** Ruling 13 L4: what the review shrink re-renders from, filled from this one render. */
  material: ContextRenderMaterialV1;
};

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
  /** Ruling 10: the display order, already projected onto this call kind. */
  sectionOrder: readonly ContextSectionNameV1[];
  prelude: string;
  required: { role: string; goal: string | null; task: string | null };
  optional: Partial<Record<OptionalSectionName, OptionalRow[]>>;
  continuationSuffix: string | null;
  reviewSuffix: string | null;
  /** Ruling 15: the history decision takes the stale-files reminder at the role slot's end. */
  takesSessionHistory: boolean;
  residentBudgetBytes: number;
  toolNames: readonly string[];
  texts: PromptTextsV1;
};

/** Ruling 15: the reminder is a template rendered with the same frozen tool list, appended inside the role range. */
function staleFilesReminder(texts: PromptTextsV1, toolNames: readonly string[]): string {
  return renderTemplate(texts, 'stale-files-reminder', {}, toolNames).text;
}

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
  const role = input.takesSessionHistory
    ? input.required.role + '\n' + staleFilesReminder(texts, input.toolNames)
    : input.required.role;
  const slots: Record<string, string | undefined> = {
    prelude: input.prelude,
    role: headers.role + '\n' + role,
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

  const omittedRows = new Map<ContextSectionNameV1, number>();
  const whollyOmitted = new Set<ContextSectionNameV1>();
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
      omittedRows.set(section.name, missing);
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
      omittedRows.set(name, count);
      whollyOmitted.add(name);
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

  const rendered = renderTemplate(texts, input.templateId, slots, input.toolNames);
  const rangeOf = (name: string) => {
    const range = rendered.sectionRanges[name];
    // Every slot below has a non-empty value, so a missing range is a code bug.
    if (range === undefined) throw new Error(`template "${input.templateId}" rendered no "${name}" slot`);
    return range;
  };

  // Ruling 10: the display order is the frozen order; every rendered section and
  // every wholly omitted one appears, in that order.
  const sections: ContextAssemblyBindingV1['sections'] = [];
  const budgetSections = new Set<string>(OPTIONAL_SECTIONS);
  for (const name of input.sectionOrder) {
    if (name === 'role') {
      const range = rangeOf('role');
      sections.push({ name: 'role', startByte: range.startByte, endByte: range.endByte, omitted: 0 });
      continue;
    }
    if (budgetSections.has(name)) {
      const omitted = omittedRows.get(name);
      // A budget section with no rows at all is not a section of this input.
      if (omitted === undefined) continue;
      if (whollyOmitted.has(name)) {
        sections.push({ name, startByte: null, endByte: null, omitted });
        continue;
      }
      const range = rangeOf(name);
      sections.push({ name, startByte: range.startByte + 2, endByte: range.endByte, omitted });
      continue;
    }
    if (name === 'goal' && goal === null) continue;
    if (name === 'task' && task === null) continue;
    if (name === 'continuation' && input.continuationSuffix === null) continue;
    if (name === 'unknown_call_review' && input.reviewSuffix === null) continue;
    const range = rangeOf(name);
    sections.push({ name, startByte: range.startByte + 2, endByte: range.endByte, omitted: 0 });
  }

  // Ruling 10: `residentBytes` is what the budget choice BILLED (its rendered
  // prefix text), never the last-optional-end difference.
  const residentBytes = fallback || chosenRender === null ? 0 : utf8Bytes(chosenRender.text);

  const materialSlots: Record<string, string | undefined> = { ...slots };
  delete materialSlots.unknown_call_review;

  const text = rendered.text;
  return {
    input: text, sections, residentBytes, totalBytes: utf8Bytes(text),
    material: {
      pack: texts,
      templateId: input.templateId,
      slots: materialSlots,
      toolNames: input.toolNames,
      residentBudgetBytes: input.residentBudgetBytes,
      residentBytes,
      sections: sections.map((section): ContextSectionPlanV1 => ({
        name: section.name, omitted: section.omitted, wholeOmitted: section.startByte === null,
      })),
    },
  };
}

export function renderContext(input: {
  prelude: string;
  required: { role: string; goal: string | null; task: string | null };
  optional: Partial<Record<'footprint' | 'notes' | 'reminders' | 'inputs', { key: string; text: string }[]>>;
  continuationSuffix: string | null;
  /** R1: the rendered `unknown_call_review` section of a review-purpose Work Run. */
  reviewSuffix?: string | null;
  residentBudgetBytes: number;
  /** Ruling 10: the frozen tool list; absent renders every tool block (direct call). */
  toolNames?: readonly string[];
  /** Ruling 15: append the stale-files reminder to the role slot. */
  takesSessionHistory?: boolean;
  /** Ruling 10/11: the frozen display order; absent keeps the platform `work` order. */
  sectionOrder?: readonly ContextSectionNameV1[];
  /** The resolved pack; absent keeps the generated pack for a direct call. */
  texts?: PromptTextsV1;
}): RenderResult {
  const texts = input.texts ?? DEFAULT_TEXTS;
  return renderWithTemplate({
    templateId: 'work-input',
    sectionOrder: input.sectionOrder ?? sectionOrderFor(
      input.continuationSuffix === null ? 'work' : 'continuation', 'work-input', texts),
    prelude: input.prelude,
    required: input.required,
    optional: input.optional,
    continuationSuffix: input.continuationSuffix,
    reviewSuffix: input.reviewSuffix ?? null,
    takesSessionHistory: input.takesSessionHistory === true,
    residentBudgetBytes: input.residentBudgetBytes,
    toolNames: input.toolNames ?? everyToolName(),
    texts,
  });
}

export function renderQueryContext(input: {
  templateId: 'query-planning-input' | 'query-copy-input';
  prelude: string;
  required: { role: string; goal: string | null; task: string | null };
  optional: Partial<Record<'footprint', OptionalRow[]>>;
  residentBudgetBytes: number;
  /** Ruling 10: the frozen tool list; absent renders every tool block (direct call). */
  toolNames?: readonly string[];
  /** Ruling 15: append the stale-files reminder to the role slot. */
  takesSessionHistory?: boolean;
  /** Ruling 10/11: the frozen display order; absent keeps the platform order. */
  sectionOrder?: readonly ContextSectionNameV1[];
  /** The resolved pack; absent keeps the generated pack for a direct call. */
  texts?: PromptTextsV1;
}): RenderResult {
  const texts = input.texts ?? DEFAULT_TEXTS;
  return renderWithTemplate({
    templateId: input.templateId,
    sectionOrder: input.sectionOrder ?? sectionOrderFor(
      input.templateId === 'query-planning-input' ? 'planning' : 'copy', input.templateId, texts),
    prelude: input.prelude,
    required: input.required,
    optional: input.optional,
    continuationSuffix: null,
    reviewSuffix: null,
    takesSessionHistory: input.takesSessionHistory === true,
    residentBudgetBytes: input.residentBudgetBytes,
    toolNames: input.toolNames ?? everyToolName(),
    texts,
  });
}

/**
 * Ruling 13: re-render the whole input with only `unknown_call_review` replaced.
 * The frozen slots, pack and tool list are rendered once more; every range and
 * `totalBytes` are recomputed, while `residentBytes` and the omission metadata
 * are copied unchanged (the budget choice is not run again).
 */
export function rerenderContextV1(
  material: ContextRenderMaterialV1,
  review: string,
): ContextRerenderV1 {
  const slots: Record<string, string | undefined> = { ...material.slots };
  if (material.templateId === 'work-input') {
    slots.unknown_call_review = review === '' ? undefined : '\n\n' + review;
  } else if (review !== '') {
    throw new Error(`template "${material.templateId}" has no unknown_call_review slot`);
  }
  const rendered = renderTemplate(material.pack, material.templateId, slots, material.toolNames);
  // Rebuild in the template's frozen order: the review section may be added or
  // removed by this call, so the plan alone cannot fix the order.
  const plan = new Map(material.sections.map(section => [section.name, section]));
  const sections: ContextAssemblyBindingV1['sections'] = [];
  for (const name of templateSectionOrder(material.pack, material.templateId)) {
    const planned = plan.get(name);
    if (planned?.wholeOmitted === true) {
      sections.push({ name, startByte: null, endByte: null, omitted: planned.omitted });
      continue;
    }
    const range = rendered.sectionRanges[name];
    // A budget section the plan does not know had no rows; a required or fixed
    // section that did not render is absent from this input.
    if (range === undefined) {
      if (planned !== undefined && OPTIONAL_SECTIONS.includes(name as OptionalSectionName)) {
        throw new Error(`the re-render of "${material.templateId}" rendered no "${name}" slot`);
      }
      continue;
    }
    sections.push({
      name,
      startByte: name === 'role' ? range.startByte : range.startByte + 2,
      endByte: range.endByte,
      omitted: planned?.omitted ?? 0,
    });
  }
  return {
    input: rendered.text, sections, residentBytes: material.residentBytes, totalBytes: utf8Bytes(rendered.text),
  };
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
