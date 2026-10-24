/**
 * The secretary round's answer check (slice-6 spec L7), pure.
 *
 * A `semantic_query` round answers with ONE strict JSON object, exactly the
 * fields of the `secretary-answer` format: `schemaVersion` 1, a non-empty
 * `body`, `ideas` of 0, 2 or 3 options and `goalCardDrafts`. The whole final
 * text is parsed as that object; JSON is never extracted from surrounding text
 * or repaired. An `initial_coordination` round keeps the v2 initial-planning
 * answer, checked by its one parser; a request without a goal may add top-level
 * `goalCardDrafts`. Drafts are proposals only: a request that already has a goal
 * carries none, and the platform, never the model, sets `screening: null`.
 *
 * Every refusal is `protocol` with a platform reason. An empty or over-long
 * final text never reaches this parse: the Runtime observation decides those
 * before it calls here.
 */
import type { GoalAutonomyV1 } from '../../../contracts/goal-decisions.js';
import { parseInitialPlanningResponseV2 } from '../../../contracts/initial-planning-parse.js';
import type { GoalCardDraftV1 } from '../../../contracts/query-job.js';
import { hasOnlyKeys, isRecord, nonEmpty, parseTaggedObject } from '../../../contracts/validation/common.js';
import { ideasIssues } from '../model/request-ideas.js';

type SecretaryIdea = { title: string; detail: string };
type SecretaryAnswerCheck =
  | { ok: true; body: string; ideas: SecretaryIdea[]; goalCardDrafts: GoalCardDraftV1[] }
  | { ok: false; detail: 'protocol'; reason: string };

const ANSWER_FIELDS = ['schemaVersion', 'body', 'ideas', 'goalCardDrafts'] as const;
const IDEA_FIELDS = ['title', 'detail'] as const;
const DRAFT_FIELDS = ['objective', 'completion', 'autonomy'] as const;
/** Keyed by `GoalAutonomyV1`, so a new autonomy value cannot be missed here. */
const AUTONOMIES: Readonly<Record<GoalAutonomyV1, true>> = { every_step: true, after_plan_confirmation: true };

function protocol(reason: string): SecretaryAnswerCheck {
  return { ok: false, detail: 'protocol', reason };
}

export function parseSecretaryAnswer(
  text: string,
  input: { kind: 'semantic_query' | 'initial_coordination'; hasGoal: boolean },
): SecretaryAnswerCheck {
  return input.kind === 'initial_coordination'
    ? coordinationAnswer(text, input.hasGoal)
    : semanticAnswer(text, input.hasGoal);
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
  return { ok: true, body, ideas, goalCardDrafts: drafts };
}

/** The formal answer text stays the whole v2 JSON text: the plan proposal path reads it as it is. */
function coordinationAnswer(text: string, hasGoal: boolean): SecretaryAnswerCheck {
  const outer = parseInitialPlanningResponseV2(text);
  if (outer.status !== 'parsed') return protocol(outer.reason);
  // The outer parse proved the text is one JSON object; the drafts are a
  // top-level field the v2 protocol itself does not judge, read from the text
  // as given (a needs_decision response is rebuilt without them).
  const object = JSON.parse(text) as Record<string, unknown>;
  const present = Object.hasOwn(object, 'goalCardDrafts');
  // Only a request without a goal is offered drafts, so a goal request's answer carries no such field at all.
  if (hasGoal && present) return protocol('an initial_coordination answer on a request that has a goal carries no goalCardDrafts');
  const drafts = present ? draftsOf(object['goalCardDrafts'], hasGoal) : [];
  if (typeof drafts === 'string') return protocol(drafts);
  return { ok: true, body: text, ideas: [], goalCardDrafts: drafts };
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
    if (!isRecord(draft) || !hasOnlyKeys(draft, DRAFT_FIELDS)) {
      return `goal card draft ${index + 1} may carry only objective, completion and autonomy`;
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
    drafts.push({ objective, completion: [...completion], autonomy: autonomy as GoalAutonomyV1, screening: null });
  }
  return drafts;
}
