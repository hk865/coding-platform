/**
 * The secretary round's answer check (slice-6 spec L7), pure.
 *
 * A `semantic_query` round answers with ONE strict JSON object, exactly the
 * fields of the `secretary-answer` format: `schemaVersion` 1, a non-empty
 * `body`, `ideas` of 0, 2 or 3 options and `goalCardDrafts`. The whole final
 * text is parsed as that object; JSON is never extracted from surrounding text
 * or repaired, with one exception: a single code fence that wraps the whole
 * answer is stripped, and prose before or after it is still refused. The
 * form-filled answer (97-1) replaces that stopgap. An `initial_coordination`
 * round keeps the v2 initial-planning answer, checked by its one parser. A
 * goal-less plan carries at least one
 * draft and names it in `planDraftIndex`; a goal request carries no drafts; a
 * `needs_decision` answer may carry drafts and never carries a `planDraftIndex`.
 * Drafts are proposals only. A draft may carry the model's optional
 * `screening`; `null` or an absent field means not screened.
 *
 * Every refusal is `protocol` with a platform reason. An empty or over-long
 * final text never reaches this parse: the Runtime observation decides those
 * before it calls here.
 */
import type { GoalAutonomyV1 } from '../../../contracts/goal-decisions.js';
import { parseInitialPlanningResponseV2 } from '../../../contracts/initial-planning-parse.js';
import { GoalScreeningShape, type GoalCardDraftV1, type GoalScreeningV1 } from '../../../contracts/query-job.js';
import { hasOnlyKeys, isRecord, nonEmpty, parseTaggedObject } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { ideasIssues } from '../model/request-ideas.js';

type SecretaryIdea = { title: string; detail: string };
type SecretaryAnswerCheck =
  | {
    ok: true; body: string; ideas: SecretaryIdea[]; goalCardDrafts: GoalCardDraftV1[];
    /** The draft a no-goal plan answer's plan belongs to; null when the answer names none. */
    planDraftIndex: number | null;
  }
  | { ok: false; detail: 'protocol'; reason: string };

const ANSWER_FIELDS = ['schemaVersion', 'body', 'ideas', 'goalCardDrafts'] as const;
const IDEA_FIELDS = ['title', 'detail'] as const;
const DRAFT_FIELDS = ['objective', 'completion', 'autonomy', 'screening'] as const;
/** Keyed by `GoalAutonomyV1`, so a new autonomy value cannot be missed here. */
const AUTONOMIES: Readonly<Record<GoalAutonomyV1, true>> = { every_step: true, after_plan_confirmation: true };

function protocol(reason: string): SecretaryAnswerCheck {
  return { ok: false, detail: 'protocol', reason };
}

/**
 * The one wrapping fence this check strips: the whole text, outer whitespace
 * ignored, is exactly an opening line of three backticks with an optional
 * language word, the content, and a closing line of three backticks. Prose
 * around it or a second fence stays in place, so the strict parse refuses it.
 */
function oneFenceContent(text: string): string {
  const whole = text.trim();
  const open = whole.indexOf('\n');
  if (open < 0 || !/^```[A-Za-z0-9_+.-]*$/.test(whole.slice(0, open).replace(/\r$/, ''))) return text;
  const close = whole.lastIndexOf('\n');
  if (whole.slice(close + 1) !== '```') return text;
  const end = whole[close - 1] === '\r' ? close - 1 : close;
  const content = whole.slice(open + 1, end);
  return content.split(/\r?\n/).some(line => line.startsWith('```')) ? text : content;
}

export function parseSecretaryAnswer(
  text: string,
  input: { kind: 'semantic_query' | 'initial_coordination'; hasGoal: boolean },
): SecretaryAnswerCheck {
  const content = oneFenceContent(text);
  return input.kind === 'initial_coordination'
    ? coordinationAnswer(content, input.hasGoal)
    : semanticAnswer(content, input.hasGoal);
}

function semanticAnswer(text: string, hasGoal: boolean): SecretaryAnswerCheck {
  const parsed = parseTaggedObject(text, 'the secretary answer');
  if (typeof parsed === 'string') return protocol(parsed);
  if (!hasOnlyKeys(parsed, ANSWER_FIELDS)) {
    return protocol('the secretary answer may carry only schemaVersion, body, ideas and goalCardDrafts');
  }
  if (parsed['schemaVersion'] !== 1) return protocol('the secretary answer must carry schemaVersion 1');
  const body = parsed['body'];
  if (!nonEmpty(body)) return protocol('the secretary answer body must be a non-empty string');
  const ideas = ideasOf(parsed['ideas']);
  if (typeof ideas === 'string') return protocol(ideas);
  const drafts = draftsOf(parsed['goalCardDrafts'], hasGoal);
  if (typeof drafts === 'string') return protocol(drafts);
  // A semantic answer has no top-level plan index: ANSWER_FIELDS refuses one above.
  return { ok: true, body, ideas, goalCardDrafts: drafts, planDraftIndex: null };
}

/** The formal answer text stays the whole v2 JSON text: the plan proposal path reads it as it is. */
function coordinationAnswer(text: string, hasGoal: boolean): SecretaryAnswerCheck {
  const outer = parseInitialPlanningResponseV2(text);
  if (outer.status !== 'parsed') return protocol(outer.reason);
  // The outer parse proved the text is one JSON object; the drafts and the plan
  // index are top-level fields the v2 protocol itself does not judge, read from
  // the text as given (a needs_decision response is rebuilt without them).
  const object = JSON.parse(text) as Record<string, unknown>;
  const present = Object.hasOwn(object, 'goalCardDrafts');
  // Only a request without a goal is offered drafts, so a goal request's answer carries no such field at all.
  if (hasGoal && present) return protocol('an initial_coordination answer on a request that has a goal carries no goalCardDrafts');
  const drafts = present ? draftsOf(object['goalCardDrafts'], hasGoal) : [];
  if (typeof drafts === 'string') return protocol(drafts);
  if (!hasGoal && object['kind'] === 'plan' && drafts.length === 0) {
    return protocol('a plan answer on a request without a goal must carry at least one goal card draft');
  }
  const planDraftIndex = planDraftIndexOf(object, hasGoal, drafts.length);
  if (typeof planDraftIndex === 'string') return protocol(planDraftIndex);
  return { ok: true, body: text, ideas: [], goalCardDrafts: drafts, planDraftIndex };
}

/**
 * A no-goal `initial_coordination` answer of `kind: 'plan'` with drafts must
 * name the draft its plan belongs to in `planDraftIndex`: adoption goes through
 * a binding whose draft index must equal it, so a plan that names none could
 * never be adopted. A goal-less plan carries at least one draft; a goal request
 * carries no drafts; a `needs_decision` answer may carry drafts and never
 * carries a `planDraftIndex`; a present index must be one of the answer's own drafts.
 */
export function planDraftIndexOf(
  object: Record<string, unknown>, hasGoal: boolean, draftCount: number,
): number | null | string {
  if (!Object.hasOwn(object, 'planDraftIndex')) {
    return object['kind'] === 'plan' && draftCount > 0
      ? 'a plan answer with goal card drafts must name its draft in planDraftIndex'
      : null;
  }
  if (hasGoal) return 'an initial_coordination answer on a request that has a goal carries no planDraftIndex';
  if (object['kind'] === 'needs_decision') return 'a needs_decision answer carries no planDraftIndex';
  const value = object['planDraftIndex'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > draftCount - 1) {
    return `planDraftIndex must be an index of one of the ${String(draftCount)} goal card drafts`;
  }
  return value;
}

/** The one idea rule, then the model's format: an idea carries only a title and a detail. */
function ideasOf(value: unknown): SecretaryIdea[] | string {
  const issues = ideasIssues(value, 'ideas');
  if (issues.length > 0) return `the secretary answer ${issues[0]}`;
  // The idea rule proved an array of records with string titles and details.
  const ideas = value as SecretaryIdea[];
  for (const [index, idea] of ideas.entries()) {
    if (!hasOnlyKeys(idea, IDEA_FIELDS)) return `the secretary answer ideas[${index}] may carry only title and detail`;
  }
  return ideas.map(({ title, detail }) => ({ title, detail }));
}

function draftsOf(value: unknown, hasGoal: boolean): GoalCardDraftV1[] | string {
  if (!Array.isArray(value)) return 'goalCardDrafts must be an array';
  // A request that already has a goal is answered within it; a new goal is proposed only before one exists.
  if (hasGoal && value.length > 0) return 'a request that has a goal carries no goal card drafts';
  const drafts: GoalCardDraftV1[] = [];
  for (const [index, draft] of value.entries()) {
    const checked = goalCardDraftCheck(draft, index);
    if (typeof checked === 'string') return checked;
    drafts.push(checked);
  }
  return drafts;
}

/** The one per-draft rule: the parsed draft, or its first problem. `draftsOf` and the submit composer share it. */
export function goalCardDraftCheck(draft: unknown, index: number): GoalCardDraftV1 | string {
  if (!isRecord(draft) || !hasOnlyKeys(draft, DRAFT_FIELDS)) {
    return `goal card draft ${String(index + 1)} may carry only objective, completion, autonomy and screening`;
  }
  const objective = draft['objective'];
  if (!nonEmpty(objective)) return `goal card draft ${index + 1} needs a non-empty objective`;
  const completion = draft['completion'];
  if (!Array.isArray(completion) || completion.length === 0) {
    return `goal card draft ${index + 1} needs at least one completion criterion`;
  }
  if (!completion.every(nonEmpty)) return `goal card draft ${index + 1} has an empty completion criterion`;
  const autonomy = draft['autonomy'];
  if (typeof autonomy !== 'string' || !Object.hasOwn(AUTONOMIES, autonomy)) {
    return `goal card draft ${index + 1} autonomy must be every_step or after_plan_confirmation`;
  }
  const screening = screeningOf(draft['screening'], index);
  if (typeof screening === 'string') return screening;
  return { objective, completion: [...completion], autonomy: autonomy as GoalAutonomyV1, screening };
}

/** The model's screening is kept as returned; `null` or an absent field means not screened. */
function screeningOf(value: unknown, index: number): GoalScreeningV1 | null | string {
  if (value === null || value === undefined) return null;
  const problem = checkShape(GoalScreeningShape, value, 'stored');
  if (problem === null) return value as GoalScreeningV1;
  return `goal card draft ${String(index + 1)} screening: ${problem}`;
}
