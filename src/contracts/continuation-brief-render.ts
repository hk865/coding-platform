/**
 * The Chinese renderer of the continuation brief (spec §6.1 contract (e)): the
 * fixed texts read from one prompt pack, the template rendering, the byte budget
 * with its step-by-step caps and omissions, and the approved-method lines the
 * WorkGraph owner measures with this same function.
 *
 * It value-imports only the leaf `continuation-brief-base.ts`, `prompts/`,
 * `utf8.ts` and `validation/common.ts`, and takes the brief's types from
 * `continuation-brief.ts` with `import type` only: that module re-exports this one, so a value import back
 * would form a load cycle, and a value of it read here at load time (as
 * `RENDER_TEXT_CAPS` reads the bounds) could still be uninitialized.
 */
import type { SessionAnomalyAnchorV1 } from './session-anomaly.js';
import type { ReworkActorClass, ReworkFailureClass, StopRequester } from './task-requeue.js';
import { truncateUtf8 } from './utf8.js';
import { utf8Bytes } from './validation/common.js';
import { canonicalJson } from './fingerprint.js';
import type { HandoffBriefMaterialV1, HandoffBriefNoteIndexV1, HandoffBriefTaskV1 } from './handoff-brief.js';
import { PLATFORM_PROMPT_PACK_V1 } from './prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from './prompts/prompt-set.js';
import { packString } from './prompts/pack-string.js';
import { parseTemplateV1, renderTemplate, type TemplateNodeV1 } from './prompts/render-template.js';
import { CONTINUATION_BRIEF_LIMITS, continuationBriefMarker } from './continuation-brief-base.js';
import type {
  BoundedTextV1, ContinuationAnomalySectionV1, ContinuationBriefV1, ContinuationDiffOmittedReasonV1,
  ContinuationSourceCheckpointV1, ContinuationToolCallV1, ContinuationUnknownCallReviewFileV1,
  ContinuationUnknownCallReviewItemV1, ContinuationUnknownCallReviewV1,
} from './continuation-brief.js';

// ------------------------------------------------------------------------ //
// Chinese renderer                                                          //
// ------------------------------------------------------------------------ //
/**
 * Every fixed text and label the renderer needs, read from one pack (ruling
 * 14). A preparation passes the resolved pack; a direct call keeps the
 * generated platform pack, so existing renderer tests are unchanged.
 */
type BriefTexts = {
  pack: PromptTextsV1;
  S: (key: string) => string;
  failureClass: Readonly<Record<ReworkFailureClass, string>>;
  actorClass: Readonly<Record<ReworkActorClass, string>>;
  stopRequester: Readonly<Record<StopRequester, string>>;
  toolResult: Readonly<Record<ContinuationToolCallV1['result'], string>>;
  sideEffect: Readonly<Record<NonNullable<ContinuationToolCallV1['sideEffect']>, string>>;
  waitStatus: Readonly<Record<'pending' | 'read' | 'responded', string>>;
  checkpoint: Readonly<Record<ContinuationSourceCheckpointV1['kind'], string>>;
  anomalyCause: Readonly<Record<SessionAnomalyAnchorV1['cause'], string>>;
  anomalyMixedOwnership: string;
  anomalyLastSentence: string;
  reviewTitle: string;
  reviewNotListed: string;
  reviewBlocked: string;
  blockedTitle: string;
  blockedState: Readonly<Record<'pending' | 'allowed' | 'denied' | 'denied_final', string>>;
  disposition: Readonly<Record<NonNullable<ContinuationUnknownCallReviewV1['disposition']>['choice'], string>>;
  noDisposition: string;
  reviewSource: Readonly<Record<NonNullable<ContinuationUnknownCallReviewV1['disposition']>['source'], string>>;
  autoSource: string;
  reviewVerdict: Readonly<Record<string, string>>;
  reviewChange: Readonly<Record<ContinuationUnknownCallReviewFileV1['change'], string>>;
  reviewMode: Readonly<Record<'replace' | 'create', string>>;
  reviewDiffReason: Readonly<Record<ContinuationDiffOmittedReasonV1, string>>;
};

/** Builds the whole fixed-text table from one pack; nothing falls back per key. */
function briefTexts(texts: PromptTextsV1): BriefTexts {
  const S = (key: string): string => packString(texts, key);
  return {
    pack: texts,
    S,
    failureClass: Object.freeze({
      interrupted: S('brief.failureClass.interrupted') ?? '', cancelled: S('brief.failureClass.cancelled') ?? '',
      check_failed: S('brief.failureClass.check_failed') ?? '', run_failed: S('brief.failureClass.run_failed') ?? '',
      check_incomplete: S('brief.failureClass.check_incomplete') ?? '',
    }),
    actorClass: Object.freeze({
      human: S('brief.actorClass.human') ?? '', system: S('brief.actorClass.system') ?? '',
      agent: S('brief.actorClass.agent') ?? '',
    }),
    stopRequester: {
      human: S('brief.stopRequester.human') ?? '', goal_fan_out: S('brief.stopRequester.goal_fan_out') ?? '',
      system: S('brief.stopRequester.system') ?? '', none: S('brief.stopRequester.none') ?? '',
    },
    toolResult: {
      success: S('brief.toolResult.success') ?? '', error: S('brief.toolResult.error') ?? '',
      cancelled: S('brief.toolResult.cancelled') ?? '', not_started: S('brief.toolResult.not_started') ?? '',
      outcome_unknown: S('brief.toolResult.outcome_unknown') ?? '',
    },
    sideEffect: {
      none: S('brief.sideEffect.none') ?? '', possible: S('brief.sideEffect.possible') ?? '',
      confirmed: S('brief.sideEffect.confirmed') ?? '',
    },
    waitStatus: {
      pending: S('brief.waitStatus.pending') ?? '', read: S('brief.waitStatus.read') ?? '',
      responded: S('brief.waitStatus.responded') ?? '',
    },
    checkpoint: {
      round_open: S('brief.checkpoint.round_open') ?? '', requeue: S('brief.checkpoint.requeue') ?? '',
      brief: S('brief.checkpoint.brief') ?? '',
    },
    anomalyCause: {
      archive_interrupted: S('brief.anomaly.cause.archive_interrupted') ?? '',
      retired_archive: S('brief.anomaly.cause.retired_archive') ?? '',
    },
    anomalyMixedOwnership: S('brief.anomaly.mixedOwnership') ?? '',
    anomalyLastSentence: S('brief.anomaly.lastSentence') ?? '',
    reviewTitle: S('brief.review.title') ?? '',
    reviewNotListed: S('brief.review.notListed') ?? '',
    reviewBlocked: S('brief.review.blocked') ?? '',
    blockedTitle: S('brief.blocked.title') ?? '',
    blockedState: {
      pending: S('brief.blocked.state.pending') ?? '', allowed: S('brief.blocked.state.allowed') ?? '',
      denied: S('brief.blocked.state.denied') ?? '', denied_final: S('brief.blocked.state.denied_final') ?? '',
    },
    disposition: {
      rerun_as_is: S('brief.review.disposition.rerun_as_is') ?? '',
      skip_as_done: S('brief.review.disposition.skip_as_done') ?? '',
      handle_myself: S('brief.review.disposition.handle_myself') ?? '',
      safer_method: S('brief.review.disposition.safer_method') ?? '',
    },
    noDisposition: S('brief.review.noDisposition') ?? '',
    reviewSource: { card: S('brief.review.source.card') ?? '', direct: S('brief.review.source.direct') ?? '',
      adviser: S('brief.review.source.adviser') ?? '' },
    autoSource: S('brief.review.autoSource') ?? '',
    reviewVerdict: {
      no_review_needed: S('brief.review.verdict.no_review_needed') ?? '', done: S('brief.review.verdict.done') ?? '',
      not_done: S('brief.review.verdict.not_done') ?? '',
      compare_in_continuation: S('brief.review.verdict.compare_in_continuation') ?? '',
      pending: S('brief.review.verdict.pending') ?? '', partial: S('brief.review.verdict.partial') ?? '',
      undetermined: S('brief.review.verdict.undetermined') ?? '',
    },
    reviewChange: {
      added: S('brief.review.change.added') ?? '', modified: S('brief.review.change.modified') ?? '',
      deleted: S('brief.review.change.deleted') ?? '', mode_changed: S('brief.review.change.mode_changed') ?? '',
      unchanged: S('brief.review.change.unchanged') ?? '', not_visible: S('brief.review.change.not_visible') ?? '',
      unknown: S('brief.review.change.unknown') ?? '',
    },
    reviewMode: { replace: S('brief.review.mode.replace') ?? '', create: S('brief.review.mode.create') ?? '' },
    reviewDiffReason: {
      baseline_dirty: S('brief.review.diffReason.baseline_dirty') ?? '', binary: S('brief.review.diffReason.binary') ?? '',
      too_large: S('brief.review.diffReason.too_large') ?? '', protected: S('brief.review.diffReason.protected') ?? '',
      section_limit: S('brief.review.diffReason.section_limit') ?? '', not_text: S('brief.review.diffReason.not_text') ?? '',
    },
  };
}

const DEFAULT_TEXTS: PromptTextsV1 = PLATFORM_PROMPT_PACK_V1;

/**
 * Every tool block a template declares, in first-read order, recursively. A
 * renderer called without an explicit frozen list uses this to render every
 * block the CURRENT template names (ruling 10); the generated pack's platform
 * tool table is not that declaration. An absent or unparseable template has no
 * names, and `renderTemplate` reports the real problem when it renders.
 */
export function templateToolNames(texts: PromptTextsV1, templateId: string): readonly string[] {
  const source = Object.hasOwn(texts.templates, templateId) ? texts.templates[templateId] : undefined;
  if (source === undefined) return [];
  const parsed = parseTemplateV1(templateId, source);
  if (parsed.status === 'invalid') return [];
  const names: string[] = [];
  const visit = (nodes: readonly TemplateNodeV1[]): void => {
    for (const node of nodes) {
      if (node.kind === 'tool') {
        if (!names.includes(node.name)) names.push(node.name);
        visit(node.children);
      } else if (node.kind === 'block') {
        visit(node.children);
      }
    }
  };
  visit(parsed.nodes);
  return names;
}

/** Successively shorter caps (UTF-16 code units) tried on every text before body items are left out. */
const RENDER_TEXT_CAPS: readonly number[] = [CONTINUATION_BRIEF_LIMITS.textChars, 1000, 250, 60];

/** The arrays the template renders; every non-empty part carries the leading LF its joined layout had. */
type ContinuationBriefTemplateParts = {
  body: readonly string[];
  blockedOmission: readonly string[];
  bodyOmission: readonly string[];
  anomalies: readonly string[];
  review: readonly string[];
  blocked: readonly string[];
};
/**
 * Renders the selected parts through the pack template. The title, the marker
 * position and the fixed closing block are the template's; a non-empty part is
 * prefixed with the single LF the old array join supplied, so an empty part
 * renders no bytes at all. `sectionRanges` is not part of the brief output.
 */
function renderBriefTemplateZh(
  B: BriefTexts, marker: string, parts: ContinuationBriefTemplateParts, toolNames: readonly string[],
): string {
  const slot = (lines: readonly string[]): string => (lines.length === 0 ? '' : `\n${lines.join('\n')}`);
  return renderTemplate(B.pack, 'continuation-brief', {
    marker,
    body: slot(parts.body),
    blockedOmission: slot(parts.blockedOmission),
    bodyOmission: slot(parts.bodyOmission),
    anomalies: slot(parts.anomalies),
    review: slot(parts.review),
    blocked: slot(parts.blocked),
  }, toolNames).text;
}

/**
 * Renders the brief into the `continuation` slot of `manifest.input` (spec §6.1
 * (e)): an independent section in the frozen order, never the tail of another
 * section. Line 1 is the title, line 2 `continuationBriefMarker(digest)`;
 * WorkGraph re-renders and compares this text. Pure and deterministic. The result
 * stays within `renderedBytes` UTF-8 bytes: every text is first cut shorter step
 * by step, then trailing body lines are left out with a note; the fixed
 * instruction block is always kept. Where the records cannot tell, it says so
 * and never claims "no change".
 *
 * The previous Run's ending: `origin: 'observed'` reads "执行记录" (D-7
 * not-entered cancels and RUN-23 are observed too); a not-entered Run renders
 * from `stoppedAt.kernel: 'not_entered'`; a RUN-23 cancel is recognized by the
 * synthesized `run_cancelled` reason carried in `stoppedAt.reason`
 * (`cancelled_at_reconcile`: Host-restart wording; `cancelled_while_paused`:
 * the in-process wording).
 */
export function renderContinuationBriefZh(
  brief: ContinuationBriefV1,
  digest: string,
  texts: PromptTextsV1 = DEFAULT_TEXTS,
  /** Ruling 10: the frozen tool list; absent renders every tool block the template names. */
  toolNames: readonly string[] = templateToolNames(texts, 'continuation-brief'),
): string {
  const B = briefTexts(texts);
  const marker = continuationBriefMarker(digest);
  const limit = CONTINUATION_BRIEF_LIMITS.renderedBytes;
  const anomalies = brief.anomalies;
  const review = brief.unknownCallReview ?? null;
  const allPaths = anomalies === undefined ? 0 : anomalyPathLineCount(anomalies);
  const allReviewLines = review === null ? 0 : unknownCallReviewOptionalLineCount(review);
  const blockedAll = brief.blockedCommands ?? [];
  const blockedKeepMax = Math.min(16, blockedAll.length);
  let blockedOmitted = 0;
  let body: string[] = [];
  let anomaly: string[] = [];
  let reviewLines: string[] = [];
  // K3 B3 item 7 / lead answer 6: the blocked section is an ordinary OPTIONAL
  // part that goes FIRST. With every other optional part at full length, take
  // its entries away from the end (the count line first, then the lines from the
  // last; the empty line and heading go with the last line) before the text caps
  // shorten or the other optional lines are omitted.
  if (blockedAll.length > 0) {
    const firstCap = RENDER_TEXT_CAPS[0]!;
    const fullBody = briefBodyZh(B, brief, firstCap);
    const fullAnomaly = anomalyLinesZh(B, brief, firstCap, allPaths);
    const fullReview = unknownCallReviewLinesZh(B, brief, firstCap, allReviewLines);
    // K3 B3 item 9: the count line is its own last entry (present only while all
    // 16 lines are shown and the Task has more), and every candidate is measured
    // WITH the note for the command lines it just removed — the count line itself
    // is never counted. Removing all command lines also removes the empty line
    // and heading, so the whole section is gone at `keep === 0`. The note stays
    // inside the `blocked` part here: it follows the section's last line and
    // precedes the fixed closing block, and the template's separate
    // `blockedOmission` slot is the position used once the section is gone.
    const candidate = (keep: number, withCountLine: boolean): string => {
      const removed = blockedKeepMax - keep;
      const note = removed > 0 ? [omittedNoteZh(B, removed)] : [];
      return renderBriefTemplateZh(B, marker, {
        body: fullBody, blockedOmission: [], bodyOmission: [], anomalies: fullAnomaly, review: fullReview,
        blocked: [...blockedCommandsLinesZh(B, blockedAll, keep, withCountLine), ...note],
      }, toolNames);
    };
    if (blockedAll.length > blockedKeepMax) {
      const text = candidate(blockedKeepMax, true);
      if (utf8Bytes(text) <= limit) return text;
    }
    for (let keep = blockedKeepMax; keep >= 0; keep -= 1) {
      const text = candidate(keep, false);
      if (utf8Bytes(text) <= limit) return text;
    }
    // The whole section is gone and the brief is still over: only now do the
    // ordinary caps and omissions apply to the other optional parts.
    blockedOmitted = blockedKeepMax;
  }
  for (const cap of RENDER_TEXT_CAPS) {
    body = briefBodyZh(B, brief, cap);
    anomaly = anomalyLinesZh(B, brief, cap, allPaths);
    reviewLines = unknownCallReviewLinesZh(B, brief, cap, allReviewLines);
    // The removed blocked command lines are already owed a note; measure every
    // cap candidate WITH it and return that measured text (never a shorter one).
    const note = blockedOmitted > 0 ? [omittedNoteZh(B, blockedOmitted)] : [];
    const text = renderBriefTemplateZh(B, marker, {
      body, blockedOmission: note, bodyOmission: [], anomalies: anomaly, review: reviewLines, blocked: [],
    }, toolNames);
    if (utf8Bytes(text) <= limit) return text;
  }
  if (anomalies === undefined && review === null && blockedAll.length === 0) {
    // A brief without either mandatory section: the longest prefix of ordinary
    // body lines whose FULL text fits, rendered through the frozen template and
    // tool list. The candidate with no body lines (its omission note included)
    // is the smallest one; when even that is over the limit the template's own
    // fixed text cannot fit, so refuse `capacity` instead of returning it.
    for (let kept = body.length; kept >= 0; kept -= 1) {
      const text = renderBriefTemplateZh(B, marker, {
        body: body.slice(0, kept), blockedOmission: [], bodyOmission: [omittedNoteZh(B, body.length - kept)],
        anomalies: [], review: [], blocked: [],
      }, toolNames);
      if (utf8Bytes(text) <= limit) return text;
    }
    throw new ContinuationBriefCapacityError(
      `the fixed text of the continuation brief does not fit in the ${String(limit)}-byte limit`);
  }
  // Still too long with the shortest texts. Every present mandatory section is
  // kept in full (spec §2.7; K3 L20 "必需部分"); only its optional lines are
  // budgeted, counting what is left out. Every candidate is rendered through the
  // frozen template and tool list and measured by its actual bytes. If even the
  // mandatory lines do not fit, refuse `capacity` instead of dropping a section.
  const cap = RENDER_TEXT_CAPS[RENDER_TEXT_CAPS.length - 1]!;
  const fixedCandidate = (anomalyLines: readonly string[], reviewLines: readonly string[]): string =>
    renderBriefTemplateZh(B, marker, {
      body: [], blockedOmission: [], bodyOmission: [], anomalies: anomalyLines, review: reviewLines, blocked: [],
    }, toolNames);
  // The two mandatory sections are always kept as separate parts: a template may
  // place, format or condition them independently, so merging them into one
  // array would measure (and render) a different text than the template says.
  let suffixMandatory: { anomaly: readonly string[]; review: readonly string[] };
  if (review === null) {
    let budgeted: string[] | null = null;
    for (let allowed = allPaths; allowed >= 0; allowed -= 1) {
      const candidate = anomalyLinesZh(B, brief, cap, allowed);
      if (utf8Bytes(fixedCandidate(candidate, [])) <= limit) { budgeted = candidate; break; }
    }
    if (budgeted === null) {
      throw new ContinuationBriefCapacityError(
        `the mandatory anomaly section does not fit in the ${String(limit)}-byte continuation brief limit`);
    }
    suffixMandatory = { anomaly: budgeted, review: [] };
  } else {
    // K3 L20: the review section is a second mandatory part, placed after the
    // anomaly section and before the fixed closing block. Budget the optional
    // lines of both sections (anomaly paths first, then the review detail) while
    // keeping every mandatory line.
    let chosen: { anomaly: readonly string[]; review: readonly string[] } | null = null;
    for (let allowedAnomaly = allPaths; allowedAnomaly >= 0 && chosen === null; allowedAnomaly -= 1) {
      const anomalyCandidate = anomalyLinesZh(B, brief, cap, allowedAnomaly);
      for (let allowedReview = allReviewLines; allowedReview >= 0; allowedReview -= 1) {
        const reviewCandidate = unknownCallReviewLinesZh(B, brief, cap, allowedReview);
        if (utf8Bytes(fixedCandidate(anomalyCandidate, reviewCandidate)) <= limit) {
          chosen = { anomaly: anomalyCandidate, review: reviewCandidate };
          break;
        }
      }
    }
    if (chosen === null) {
      throw new ContinuationBriefCapacityError(
        `the mandatory unknown-call review section does not fit in the ${String(limit)}-byte continuation brief limit`);
    }
    suffixMandatory = chosen;
  }
  // Body lines are optional: take the longest prefix whose FULL text fits with
  // the note for every omitted line (the removed blocked lines included). The
  // mandatory-only minimum was measured above, so it is the final fallback, also
  // rendered through the same template.
  for (let kept = body.length; kept >= 0; kept -= 1) {
    const text = renderBriefTemplateZh(B, marker, {
      body: body.slice(0, kept), blockedOmission: [],
      bodyOmission: [omittedNoteZh(B, body.length - kept + blockedOmitted)],
      anomalies: suffixMandatory.anomaly, review: suffixMandatory.review, blocked: [],
    }, toolNames);
    if (utf8Bytes(text) <= limit) return text;
  }
  return fixedCandidate(suffixMandatory.anomaly, suffixMandatory.review);
}

/**
 * The handoff brief's task-round value: the facts of F2's normalized material,
 * in the same fixed layout as the continuation brief. It renders facts only and
 * never adds one; the module index and the understanding pointer are the two
 * pointers §3.6 requires, and the conclusion is the body the material already
 * read (never thinking, never an intermediate reply).
 */
/** One plain material text through the shared bounded-text truncator (the material never marks a cut). */
function handoffTextZh(B: BriefTexts, text: string, cap: number): string {
  return boundedZh(B, { text, truncated: false }, cap);
}

function handoffNoteIndexTextZh(
  B: BriefTexts, index: HandoffBriefNoteIndexV1, cap: number,
): string {
  if (index.length === 0) return B.S('brief.list.none');
  return index.map(entry =>
    `${entry.moduleId}: ${listZh(B, entry.notes.map(note => `${note.noteRef}@${String(note.version)}`), cap)}`,
  ).join(B.S('brief.separator.semicolon'));
}

function handoffTaskLineZh(B: BriefTexts, task: HandoffBriefTaskV1, cap: number, prefix = ''): string {
  const result = task.lastResult === null ? B.S('brief.list.none') : handoffTextZh(B, task.lastResult, cap);
  return `${prefix}- task ${canonicalJson(task.task)}: phase ${task.phase}; last result: ${result}`;
}

function handoffDecisionTextZh(
  B: BriefTexts, decisions: readonly { source: string; key: string }[], cap: number,
): string {
  return listZh(B, decisions.map(decision => `${decision.source}:${decision.key}`), cap);
}

function handoffUnderstandingTextZh(
  B: BriefTexts, understanding: readonly { noteId: string; version: number }[], cap: number,
): string {
  return listZh(B, understanding.map(note => `${note.noteId}@${String(note.version)}`), cap);
}

/** The lines the handoff template puts in its one `task_round` slot, with `cap` applied to every free text. */
function handoffBriefLinesZh(material: HandoffBriefMaterialV1, B: BriefTexts, cap: number): string[] {
  const lines: string[] = [];
  if (material.duty === 'executor') {
    for (const task of material.tasks) lines.push(handoffTaskLineZh(B, task, cap));
    if ('absent' in material.conclusion) {
      lines.push('- conclusion: no formal final answer');
    } else {
      lines.push(`- conclusion ${canonicalJson(material.conclusion.run)}: `
        + `${handoffTextZh(B, material.conclusion.body, cap)}`);
    }
    lines.push(`- note index: ${handoffNoteIndexTextZh(B, material.noteIndex, cap)}`);
    lines.push(`- understanding: ${handoffUnderstandingTextZh(B, material.understanding, cap)}`);
    lines.push(`- old line: ${canonicalJson(material.oldLine)}`);
  } else {
    lines.push(`- handed scope: ${listZh(B, material.handedScope.map(scope => canonicalJson(scope)), cap)}`);
    lines.push('- project background:');
    for (const goal of material.goals) {
      lines.push(`- goal ${canonicalJson(goal.goalRef)}`);
      for (const task of goal.tasks) lines.push(handoffTaskLineZh(B, task, cap, '  '));
      lines.push(`  - note index: ${handoffNoteIndexTextZh(B, goal.noteIndex, cap)}`);
      lines.push(`  - open decisions: ${handoffDecisionTextZh(B, goal.openDecisions, cap)}`);
    }
    if (material.queryAnswers.length === 0) {
      lines.push(`- query answers: ${B.S('brief.list.none')}`);
    } else {
      for (const answer of material.queryAnswers) {
        lines.push(`- query answer ${canonicalJson(answer.run)}: ${handoffTextZh(B, answer.body, cap)}`);
      }
    }
    lines.push(`- understanding: ${handoffUnderstandingTextZh(B, material.understanding, cap)}`);
    lines.push(`- old line: ${canonicalJson(material.oldLine)}`);
  }
  lines.push(B.S('handoff.briefTools'));
  return lines;
}

/**
 * The successor's first-round handoff brief (B4): F2's executor/adviser template
 * over the one `task_round` value built from the material, with the same byte
 * budget and truncation/omission rules as the continuation brief. Pure and
 * deterministic; it reads the pack's frozen texts only and never re-derives a
 * fact. The digest is NOT rendered here: record 5's digest covers the material
 * alone (B2-03).
 */
export function renderHandoffBriefZh(material: HandoffBriefMaterialV1, texts: PromptTextsV1): string {
  const B = briefTexts(texts);
  const templateId = material.duty === 'executor' ? 'handoff-brief-executor' : 'handoff-brief-adviser';
  // The frozen public signature takes no tool list; the two templates declare
  // `read`, so the renderer derives their current tool blocks itself.
  const toolNames = templateToolNames(texts, templateId);
  const limit = CONTINUATION_BRIEF_LIMITS.renderedBytes;
  const render = (lines: readonly string[]): string =>
    renderTemplate(texts, templateId, { task_round: lines.join('\n') }, toolNames).text;
  for (const cap of RENDER_TEXT_CAPS) {
    const text = render(handoffBriefLinesZh(material, B, cap));
    if (utf8Bytes(text) <= limit) return text;
  }
  // Even the shortest per-text cap does not fit: keep the leading lines (the
  // tasks and facts that matter most) and state how many were left out.
  const lines = handoffBriefLinesZh(material, B, RENDER_TEXT_CAPS[RENDER_TEXT_CAPS.length - 1]!);
  for (let kept = lines.length - 1; kept >= 1; kept -= 1) {
    const text = render([omittedNoteZh(B, lines.length - kept), ...lines.slice(0, kept)]);
    if (utf8Bytes(text) <= limit) return text;
  }
  return render([omittedNoteZh(B, lines.length)]);
}

function omittedNoteZh(B: BriefTexts, lines: number): string {
  return `${B.S('brief.omitted.prefix')}${String(CONTINUATION_BRIEF_LIMITS.renderedBytes)}`
    + `${B.S('brief.omitted.between')}${String(lines)}${B.S('brief.omitted.suffix')}`;
}
/**
 * K3 B3 item 7/9: the optional `### 被拦的命令` section. `keep` is the number of
 * command lines still rendered (0..16); `withCountLine` shows the count line,
 * which is the section's own last entry and is only shown while all 16 lines
 * are. The caller counts every removed command line in the ordinary omission
 * note and measures the candidate together with that note; the count line is
 * never counted, and the empty line plus heading disappear with the last line.
 */
function blockedCommandsLinesZh(
  B: BriefTexts, entries: NonNullable<ContinuationBriefV1['blockedCommands']>, keep: number, withCountLine: boolean,
): string[] {
  if (entries.length === 0 || keep <= 0) return [];
  const lines: string[] = ['', B.blockedTitle];
  for (const entry of entries.slice(0, Math.min(16, keep))) {
    let line = `${B.S('brief.blocked.lineLead')}${String(entry.alias)}${B.S('brief.blocked.lineMiddle')}`
      + `${entry.reviewRunId.slice(0, 8)}${B.S('brief.blocked.lineSuffix')}`;
    if (entry.requestState !== null) line += `${B.S('brief.blocked.stateLead')}${B.blockedState[entry.requestState]}`;
    const forms: string[] = [];
    const seen = new Set<string>();
    for (const raw of entry.declaredForms) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      forms.push(truncateUtf8(raw, 160));
    }
    if (forms.length > 0) {
      line += `${B.S('brief.blocked.formsLead')}${forms.slice(0, 3).join(B.S('brief.list.separator'))}`;
      if (forms.length > 3) line += `${B.S('brief.blocked.formsMoreLead')}${String(forms.length)}${B.S('brief.blocked.formsMoreSuffix')}`;
    }
    lines.push(line);
  }
  if (withCountLine && entries.length > 16) {
    lines.push(`${B.S('brief.blocked.omittedLead')}${String(entries.length - 16)}${B.S('brief.blocked.omittedSuffix')}`);
  }
  return lines;
}
/** `text` cut to `cap` UTF-16 code units without splitting a surrogate pair; continuation lines are indented. */
function clip(B: BriefTexts, text: string, cap: number): string {
  let cut = text;
  if (text.length > cap) {
    const end = cap > 0 && /[\uD800-\uDBFF]/.test(text.charAt(cap - 1)) ? cap - 1 : cap;
    cut = `${text.slice(0, end)}${B.S('brief.clip.truncatedSuffix')}`;
  }
  return cut.replace(/\r?\n/g, B.S('brief.clip.newlineIndent'));
}
function boundedZh(B: BriefTexts, value: BoundedTextV1, cap: number): string {
  const text = clip(B, value.text, cap);
  const truncated = B.S('brief.clip.truncatedSuffix');
  return value.truncated && !text.endsWith(truncated) ? `${text}${truncated}` : text;
}
function listZh(B: BriefTexts, items: readonly string[], cap: number): string {
  return items.length === 0
    ? B.S('brief.list.none') : items.map((item) => clip(B, item, cap)).join(B.S('brief.list.separator'));
}
function moreZh(B: BriefTexts, omitted: number): string {
  return omitted > 0 ? `${B.S('brief.list.morePrefix')}${String(omitted)}${B.S('brief.list.moreSuffix')}` : '';
}

function briefBodyZh(B: BriefTexts, brief: ContinuationBriefV1, cap: number): string[] {
  const t = (value: BoundedTextV1): string => boundedZh(B, value, cap);
  const lines: string[] = [];
  const section = (title: string): void => { lines.push('', `### ${title}`); };
  const trigger = brief.trigger;
  const previous = brief.previous;
  const stoppedAt = brief.stoppedAt;

  let summary = `${B.S('brief.summary.lead')}${brief.task.taskId}${B.S('brief.summary.afterTask')}`
    + `${brief.mode === 'rework' ? B.S('brief.mode.rework') : B.S('brief.mode.resumeAfterInterruption')}${B.S('brief.summary.afterMode')}`
    + `${B.S('brief.summary.requeueLead')}${String(trigger.requeueNumber)}${B.S('brief.summary.beforeFailureClass')}`
    + `${B.failureClass[brief.failureClass]}${B.S('brief.summary.beforeActor')}`
    + `${B.actorClass[trigger.actorClass]}`;
  if (trigger.goalResume) summary += B.S('brief.summary.goalResume');
  if (trigger.autoRework !== null) {
    summary += `${B.S('brief.summary.autoRework')}${String(trigger.autoRework.count)}/${String(trigger.autoRework.cap)}`;
  }
  lines.push(`${summary}。`);
  if (trigger.earlierRequeues.length > 0) {
    lines.push(`${B.S('brief.earlierRequeues.lead')}${trigger.earlierRequeues
      .map((earlier) => `${earlier.afterRunId}（${B.failureClass[earlier.failureClass]}）`).join(B.S('brief.list.separator'))}。`);
  }
  lines.push(continuityZh(B, brief.session));

  section(B.S('brief.section.previous'));
  lines.push(`${B.S('brief.previous.runLead')}${previous.runRef.runId}${B.S('brief.previous.sessionOpen')}`
    + `${previous.sessionRef.sessionId}）${endingZh(B, brief)}。`);
  if (brief.factsFrom.hops > 0) {
    lines.push(`${B.S('brief.previous.factsFromLead')}${brief.factsFrom.runRef.runId}${B.S('brief.previous.factsFromHopsOpen')}`
      + `${String(brief.factsFrom.hops)}${B.S('brief.previous.factsFromHopsSuffix')}`
      + `${brief.factsFrom.truncated ? B.S('brief.previous.factsFromTruncated') : ''}）。`);
  }
  if (previous.interruption !== null) {
    const interruption = previous.interruption;
    lines.push(`${B.S('brief.interruption.lead')}`
      + `${interruption.kind === 'paused' ? B.S('brief.interruption.paused') : B.S('brief.interruption.executing')}`
      + `${B.S('brief.interruption.kernelPrefix')}`
      + `${interruption.kernelPaused ? B.S('brief.interruption.reached') : B.S('brief.interruption.notReached')}`
      + `${B.S('brief.interruption.pointReachedSuffix')}`
      + `${interruption.pausedBy === null || interruption.pausedBy === 'none' ? '' : `${B.S('brief.interruption.requesterPrefix')}${B.stopRequester[interruption.pausedBy]}`}。`);
  }
  if (previous.cancelledBy !== null) {
    lines.push(`${B.S('brief.previous.cancelledByLead')}${B.stopRequester[previous.cancelledBy]}。`);
  }
  if (previous.error !== null) lines.push(`${B.S('brief.previous.errorLead')}${t(previous.error)}`);
  if (previous.limit !== null) {
    lines.push(`${B.S('brief.previous.limitLead')}${clip(B, previous.limit.kind, cap)}${B.S('brief.previous.limitObserved')}`
      + `${String(previous.limit.observed)}${B.S('brief.previous.limitAllowed')}${String(previous.limit.allowed)}。`);
  }
  if (previous.budget !== null) {
    lines.push(`${B.S('brief.previous.budgetLead')}${String(previous.budget.previousTokenBudget)}`
      + `${B.S('brief.previous.budgetCurrent')}${String(previous.budget.currentTokenBudget)}。`);
  }
  if (previous.wait !== null) {
    lines.push(`${B.S('brief.previous.waitLead')}${previous.wait.messageRef.messageId}：${B.waitStatus[previous.wait.status]}。`);
  }
  for (const steer of previous.unacceptedSteers) {
    lines.push(`${B.S('brief.previous.steerLead')}${steer.intentRef.intentId}：${t(steer.text)}`);
  }
  if (previous.endedAt !== null) lines.push(`${B.S('brief.previous.endedAtLead')}${previous.endedAt}。`);

  section(B.S('brief.section.stoppedAt'));
  if (stoppedAt.kernel === 'read') {
    lines.push(`${B.S('brief.stoppedAt.positionLead')}`
      + `${stoppedAt.lastPosition === null ? B.S('brief.unknown') : String(stoppedAt.lastPosition)}`
      + `${B.S('brief.stoppedAt.turnLead')}${stoppedAt.turnStatus ?? B.S('brief.unknown')}。`);
  } else {
    lines.push(stoppedAt.kernel === 'not_entered' ? B.S('brief.stoppedAt.notEntered') : B.S('brief.stoppedAt.unavailable'));
  }
  if (stoppedAt.reason !== null) lines.push(`${B.S('brief.stoppedAt.reasonLead')}${clip(B, stoppedAt.reason, cap)}`);
  if (stoppedAt.lastToolGroup !== null) {
    lines.push(`${B.S('brief.stoppedAt.toolGroupLead')}${stoppedAt.lastToolGroup.sourceMessageId}，`
      + `${String(stoppedAt.lastToolGroup.calls)}${B.S('brief.stoppedAt.toolGroupCallsSuffix')}`);
  }
  if (stoppedAt.lastAssistant !== null) lines.push(`${B.S('brief.stoppedAt.lastAssistantLead')}${t(stoppedAt.lastAssistant)}`);
  if (stoppedAt.window !== null) {
    lines.push(`${B.S('brief.stoppedAt.windowLead')}${String(stoppedAt.window.fromPosition)}`
      + `${B.S('brief.stoppedAt.windowRange')}${String(stoppedAt.window.throughPosition)}`
      + `${stoppedAt.window.omittedRecords > 0 ? `${B.S('brief.stoppedAt.windowOmittedLead')}${String(stoppedAt.window.omittedRecords)}${B.S('brief.stoppedAt.windowOmittedSuffix')}` : ''}。`);
  }

  section(B.S('brief.section.toolCalls'));
  const calls = brief.toolCalls;
  const groups: Array<[string, ContinuationToolCallV1[], number]> = [
    [B.S('brief.toolGroup.confirmed'), calls.confirmed, calls.confirmedOmitted],
    [B.S('brief.toolGroup.notExecuted'), calls.notExecuted, calls.notExecutedOmitted],
    [B.S('brief.toolGroup.unknown'), calls.unknown, calls.unknownOmitted],
  ];
  if (groups.every(([, listed, omitted]) => listed.length === 0 && omitted === 0)) {
    lines.push(stoppedAt.kernel === 'unavailable' ? B.S('brief.toolCalls.noneUnavailable') : B.S('brief.toolCalls.none'));
  }
  for (const [label, listed, omitted] of groups) {
    if (listed.length === 0 && omitted === 0) continue;
    lines.push(`- ${label}：${String(listed.length + omitted)}${B.S('brief.toolCalls.countSuffix')}${moreZh(B, omitted)}`);
    for (const call of listed) lines.push(`  - ${toolCallZh(B, call, cap)}`);
  }

  if (brief.checks !== null) {
    const checks = brief.checks;
    section(B.S('brief.section.checks'));
    lines.push(`${B.S('brief.checks.roundLead')}${checks.roundRef.roundId}${B.S('brief.checks.ordinalOpen')}`
      + `${String(checks.roundOrdinal)}${B.S('brief.checks.failingMiddle')}`
      + `${checks.failing.length === 0 ? B.S('brief.list.none') : ''}`);
    for (const failing of checks.failing) {
      lines.push(`  - ${failing.checkId}${B.S('brief.checks.itemPhase')}${failing.phase}${B.S('brief.checks.itemOutcome')}`
        + `${failing.outcome ?? B.S('brief.list.none')}`
        + `${failing.cause === null ? '' : `${B.S('brief.checks.causeLead')}${failing.cause}`}`
        + `${failing.reportRef === null ? B.S('brief.checks.noReport') : `${B.S('brief.checks.reportLead')}${failing.reportRef.digest}`}`);
    }
    if (checks.gapCodes.length > 0) lines.push(`${B.S('brief.checks.gapsLead')}${listZh(B, checks.gapCodes, cap)}`);
  }

  section(B.S('brief.section.requeue'));
  lines.push(`${B.S('brief.requeue.reasonLead')}${B.actorClass[brief.requeue.reasonAuthor]}`
    + `${B.S('brief.requeue.reasonMiddle')}${t(brief.requeue.reason)}`);
  if (brief.requeue.newInputs.length === 0) lines.push(B.S('brief.requeue.none'));
  for (const input of brief.requeue.newInputs) {
    lines.push(input.kind === 'session_message'
      ? `${B.S('brief.requeue.messageLead')}${input.ref.messageId}${input.replyBody === null ? '' : `${B.S('brief.requeue.replyLead')}${t(input.replyBody)}`}`
      : `${B.S('brief.requeue.materialLead')}${input.ref.contentType}${B.S('brief.requeue.materialDigestLead')}`
        + `${input.ref.digest}${input.body === null ? '' : `：${t(input.body)}`}`);
  }

  section(B.S('brief.section.workspace'));
  const workspace = brief.workspace;
  const self = workspace.selfChanged;
  if (self.status === 'unavailable') lines.push(B.S('brief.workspace.selfUnavailable'));
  else if (self.status === 'not_entered') lines.push(B.S('brief.workspace.selfNotEntered'));
  else {
    lines.push(`${B.S('brief.workspace.selfLead')}`
      + `${self.status === 'known' ? B.S('brief.workspace.selfComplete') : B.S('brief.workspace.selfPartial')}`
      + `${B.S('brief.workspace.selfMiddle')}${listZh(B, self.confirmed, cap)}`
      + `${self.possible.length === 0 ? '' : `${B.S('brief.workspace.possibleLead')}${listZh(B, self.possible, cap)}`}${moreZh(B, self.omitted)}`);
  }
  const unobservedTo = workspace.unobserved.to === null ? null : workspace.checkpoints[workspace.unobserved.to];
  lines.push(`${B.S('brief.workspace.unobservedLead')}${workspace.unobserved.previousEndedAt ?? B.S('brief.workspace.timeUnknown')}`
    + `${B.S('brief.workspace.unobservedMiddle')}`
    + `${unobservedTo === undefined || unobservedTo === null ? B.S('brief.workspace.thisStart') : `“${B.checkpoint[unobservedTo.kind]}”`}`
    + `${B.S('brief.workspace.unobservedAfter')}${B.S('brief.workspace.unobservedTail')}`);
  for (const segment of workspace.segments) {
    const from = workspace.checkpoints[segment.from];
    const to = workspace.checkpoints[segment.to];
    if (from === undefined || to === undefined) continue;
    const verdict = segment.verdict === 'changed' ? B.S('brief.workspace.verdictChanged')
      : segment.verdict === 'unchanged' ? B.S('brief.workspace.verdictUnchanged')
        : `${B.S('brief.workspace.verdictUnknownOpen')}${clip(B, segment.reason, cap)}）`;
    lines.push(`- ${B.checkpoint[from.kind]}${B.S('brief.workspace.segmentArrow')}${B.checkpoint[to.kind]}：${verdict}`);
  }
  const uncommitted = workspace.uncommitted;
  if (uncommitted.status === 'git') {
    lines.push(`${B.S('brief.workspace.uncommittedGitLead')}${uncommitted.baseCommit ?? B.S('brief.workspace.unknownCommit')}`
      + `${B.S('brief.workspace.uncommittedGitMiddle')}${listZh(B, uncommitted.paths, cap)}${moreZh(B, uncommitted.omitted)}`);
  } else if (uncommitted.status === 'not_git') {
    lines.push(B.S('brief.workspace.notGit'));
  } else {
    lines.push(`${B.S('brief.workspace.uncommittedUnknown')}${uncommitted.reason === null ? '' : `：${clip(B, uncommitted.reason, cap)}`}。`);
  }

  const accepted = brief.acceptedInputs;
  if (accepted.steers.length + accepted.steersOmitted + accepted.messages.length + accepted.messagesOmitted > 0) {
    section(B.S('brief.section.acceptedInputs'));
    for (const steer of accepted.steers) lines.push(`${B.S('brief.accepted.steerLead')}${steer.intentRef.intentId}：${t(steer.text)}`);
    if (accepted.steersOmitted > 0) {
      lines.push(`${B.S('brief.accepted.omittedLead')}${String(accepted.steersOmitted)}${B.S('brief.accepted.steersOmittedSuffix')}`);
    }
    for (const message of accepted.messages) {
      lines.push(`${B.S('brief.accepted.messageLead')}${message.messageRef.messageId}（`
        + `${message.part === 'message' ? B.S('brief.accepted.messageInbound') : B.S('brief.accepted.messageReply')}`
        + `）：${t(message.excerpt)}`);
    }
    if (accepted.messagesOmitted > 0) {
      lines.push(`${B.S('brief.accepted.omittedLead')}${String(accepted.messagesOmitted)}${B.S('brief.accepted.messagesOmittedSuffix')}`);
    }
  }
  return lines;
}

/**
 * Slice 1 §2.7: the `### 异常锚点` section. Empty without `anomalies`, so an
 * old brief renders byte-identically. Each carried anchor keeps its ref, cause,
 * the unknown/mixed-ownership warning where it applies and the fixed closing
 * sentence; only the path lists are clipped by `cap`. `pathLimit` is the number
 * of path lines that may still be written (spec §2.7 budgets them first under
 * the `renderedBytes` bound); every path line left out is counted once.
 */
function anomalyLinesZh(B: BriefTexts, brief: ContinuationBriefV1, cap: number, pathLimit: number): string[] {
  const section = brief.anomalies;
  if (section === undefined) return [];
  const lines: string[] = ['', B.S('brief.anomaly.title')];
  let pathLines = 0;
  let droppedPaths = 0;
  for (const anchor of section.anchors) {
    const files = anchor.changedFiles;
    lines.push(`${B.S('brief.anomaly.anchorLead')}${anchor.runRef.runId}${B.S('brief.anomaly.sessionOpen')}`
      + `${anchor.sessionRef.sessionId}${B.S('brief.anomaly.taskMiddle')}${anchor.task.taskId}`
      + `${B.S('brief.anomaly.reasonMiddle')}${B.anomalyCause[anchor.cause]}`
      + `${B.S('brief.anomaly.recordedAtMiddle')}${anchor.recordedAt}${B.S('brief.anomaly.anchorSuffix')}`);
    if (files.status === 'unavailable') {
      lines.push(`${B.S('brief.anomaly.filesUnavailableLead')}${files.reason === null ? '' : `（${clip(B, files.reason, cap)}）`}。`);
    } else if (files.status === 'not_entered') {
      lines.push(B.S('brief.anomaly.filesNotEntered'));
    } else if (pathLines < pathLimit) {
      pathLines += 1;
      lines.push(`${B.S('brief.anomaly.confirmedFilesLead')}${listZh(B, files.confirmed, cap)}`
        + `${files.possible.length === 0 ? '' : `${B.S('brief.workspace.possibleLead')}${listZh(B, files.possible, cap)}`}`
        + `${moreZh(B, files.omitted)}。`);
    } else {
      pathLines += 1;
      droppedPaths += 1;
    }
    if (files.source === 'worktree') lines.push(`${B.S('brief.anomaly.mixedLead')}${B.anomalyMixedOwnership}。`);
  }
  if (section.omitted > 0) {
    lines.push(`${B.S('brief.anomaly.omittedAnchorsLead')}${String(section.omitted)}${B.S('brief.anomaly.omittedAnchorsSuffix')}`);
  }
  if (droppedPaths > 0) {
    lines.push(`${B.S('brief.anomaly.omittedPathsLead')}${String(droppedPaths)}${B.S('brief.anomaly.omittedPathsSuffix')}`);
  }
  lines.push(B.anomalyLastSentence);
  return lines;
}

/** The number of optional path lines the anomaly section can render. */
function anomalyPathLineCount(section: ContinuationAnomalySectionV1): number {
  let count = 0;
  for (const anchor of section.anchors) {
    const status = anchor.changedFiles.status;
    if (status !== 'unavailable' && status !== 'not_entered') count += 1;
  }
  return count;
}

// ------------------------------------------------------------------------ //
// K3 L20: unknown-call review section                                       //
// ------------------------------------------------------------------------ //
/** One non-required conclusion line per item (`#n = <callId>（<工具名>）：…`; D8: the callId appears only here). */
function reviewItemConclusionZh(B: BriefTexts, item: ContinuationUnknownCallReviewItemV1, cap: number): string {
  const parts = [B.reviewVerdict[item.verdict] ?? item.verdict];
  if (item.evidence !== null) parts.push(`${B.S('brief.review.evidencePrefix')}${boundedZh(B, item.evidence, cap)}`);
  if (item.crashSuspicion !== null) {
    const suspicion = item.crashSuspicion.verdict === 'unlikely' ? B.S('brief.review.crash.unlikely')
      : item.crashSuspicion.verdict === 'possible' ? B.S('brief.review.crash.possible') : B.S('brief.review.crash.unknown');
    parts.push(`${B.S('brief.review.crashPrefix')}${suspicion}（${clip(B, item.crashSuspicion.evidence, cap)}）`);
  }
  if (item.reviewerConclusion !== null) {
    parts.push(`${B.S('brief.review.reviewerPrefix')}${boundedZh(B, item.reviewerConclusion, cap)}`);
  }
  return `- #${String(item.alias)} = ${clip(B, item.callId, cap)}（${clip(B, item.toolName, cap)}）`
    + `${B.S('brief.review.conclusionMiddle')}${parts.join(B.S('brief.separator.semicolon'))}`;
}
function reviewFileLinesZh(B: BriefTexts, file: ContinuationUnknownCallReviewFileV1, cap: number): string[] {
  const lines = [`${B.S('brief.review.fileLead')}${clip(B, file.path, cap)}（${B.reviewMode[file.mode]}`
    + `${B.S('brief.review.fileChangeMiddle')}${B.reviewChange[file.change]}。`];
  if (file.oldText !== null) lines.push(`${B.S('brief.review.oldText')}${boundedZh(B, file.oldText, cap)}`);
  if (file.newText !== null) lines.push(`${B.S('brief.review.newText')}${boundedZh(B, file.newText, cap)}`);
  if (file.diff !== null) lines.push(`${B.S('brief.review.diff')}${boundedZh(B, file.diff, cap)}`);
  else if (file.diffOmittedReason !== null) {
    lines.push(`${B.S('brief.review.diffOmitted')}${B.reviewDiffReason[file.diffOmittedReason]}。`);
  }
  return lines;
}
/** The non-required lines of the review section, in render order (never the fixed lines). */
function unknownCallReviewOptionalLinesZh(B: BriefTexts, section: ContinuationUnknownCallReviewV1, cap: number): string[] {
  const lines: string[] = [];
  for (const item of section.items) {
    lines.push(reviewItemConclusionZh(B, item, cap));
    for (const file of item.files) lines.push(...reviewFileLinesZh(B, file, cap));
  }
  // K3 L18: annotations are optional lines after the per-item conclusions. The
  // ② owner already turned the answer object into `null` (the record) or a path.
  for (const annotation of section.disposition?.annotations ?? []) {
    lines.push(`${B.S('brief.review.annotationLead')}`
      + `${annotation.path === null ? B.S('brief.review.annotationRecord') : clip(B, annotation.path, cap)}`
      + `${B.S('brief.review.annotationMiddle')}${clip(B, annotation.text, cap)}`);
  }
  return lines;
}
function unknownCallReviewOptionalLineCount(section: ContinuationUnknownCallReviewV1): number {
  let count = section.disposition?.annotations.length ?? 0;
  for (const item of section.items) {
    count += 1;
    for (const file of item.files) {
      count += 1 + (file.oldText === null ? 0 : 1) + (file.newText === null ? 0 : 1)
        + (file.diff !== null || file.diffOmittedReason !== null ? 1 : 0);
    }
  }
  return count;
}
/**
 * K3 L20: the approved-method lines (`approvedMethodLinesZh`). ONE pure
 * function shared by the WorkGraph owner's byte-budget measurement and the
 * renderer: the alias comes from the item's position in the record, so what is
 * measured at write time is exactly what the continuation will say. A command's
 * or a cwd's `\r\n`/`\n` becomes `\n` plus two spaces (the `clip` indentation,
 * L20: both the command and cwd), and the methods are joined with `\n`; nothing
 * is clipped or omitted.
 */
export function approvedMethodLinesZh(
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
  texts: PromptTextsV1 = DEFAULT_TEXTS,
): string[] {
  return approvedMethodLinesWith(briefTexts(texts), methods);
}
function approvedMethodLinesWith(
  B: BriefTexts,
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
): string[] {
  const indent = B.S('brief.approved.newlineIndent') ?? '';
  return methods.map(method =>
    `${B.S('brief.approved.lead')}${String(method.alias)}${B.S('brief.approved.cwdLead')}`
    + `${(method.cwd ?? '.').replace(/\r\n|\n/g, indent)}${B.S('brief.approved.afterCwd')}`
    + `${indent}${method.command.replace(/\r\n|\n/g, indent)}`);
}

/**
 * K3 L20 and lead ruling 5: the review section. The title, the count line, the
 * one-line disposition, the always-present targets line (it reads `无` when
 * there are none), the platform line when it names any, and the fixed sentence
 * are mandatory; the per-item detail (conclusion, evidence, `reviewerConclusion`,
 * excerpts and diffs) and the annotations are bounded by `optionalLimit` and
 * left out by the caller without dropping a mandatory line. The approved-method
 * block sits between the targets and platform lines and is mandatory too (never
 * shortened or omitted); B3 adds the blocked-command sentence after the fixed
 * sentence, which is not built here.
 */
function unknownCallReviewLinesZh(B: BriefTexts, brief: ContinuationBriefV1, cap: number, optionalLimit: number): string[] {
  const section = brief.unknownCallReview ?? null;
  if (section === null) return [];
  const count = section.items.length;
  const lines: string[] = ['', B.reviewTitle,
    `${B.S('brief.review.countLead')}${String(count)}${B.S('brief.review.countMiddle')}${String(count)}`
    + `${B.S('brief.review.countOmittedLead')}${String(section.itemsOmitted)}${B.S('brief.review.countOmittedSuffix')}`
    + B.S('brief.review.countNote')];
  lines.push(...unknownCallReviewOptionalLinesZh(B, section, cap).slice(0, Math.max(0, optionalLimit)));
  const disposition = section.disposition;
  const option = disposition === null
    ? B.noDisposition
    : B.disposition[disposition.choice];
  const source = disposition === null
    ? B.autoSource
    : B.reviewSource[disposition.source];
  // L20: ONE line; the 附言 is clipped to 60 UTF-16 units by `clip`, not RENDER_TEXT_CAPS.
  const note = disposition === null || disposition.text === null || disposition.text.text.length === 0
    ? '' : `${B.S('brief.review.noteLead')}${clip(B, disposition.text.text, 60)}`;
  lines.push(`${B.S('brief.review.dispositionLead')}${option}（${source}）${note}。`);
  // Lead ruling 5: the targets line is ALWAYS present; with no targets (settled
  // by itself or an empty set) it reads exactly `无`. The platform line below
  // stays present only when it names any.
  const targets = disposition === null ? [] : disposition.targets;
  lines.push(targets.length === 0
    ? B.S('brief.review.targetsNone')
    : `${B.S('brief.review.targetsLead')}${targets.map(alias => `#${String(alias)}`).join(B.S('brief.list.separator'))}。`);
  // L20: the approved methods are part of the mandatory block: every line is
  // written whole, between the targets line and the platform line. No approved
  // methods means no bytes change (an absent/empty array renders nothing).
  if (disposition !== null && disposition.approvedMethods.length > 0) {
    lines.push(...approvedMethodLinesWith(B, disposition.approvedMethods));
  }
  if (disposition !== null && disposition.platformTargets.length > 0) {
    lines.push(`${B.S('brief.review.platformLead')}`
      + `${disposition.platformTargets.map(alias => `#${String(alias)}`).join(B.S('brief.list.separator'))}`
      + B.S('brief.review.platformSuffix'));
  }
  lines.push(B.reviewNotListed);
  // K3 B3 item 6: the required signal, present exactly when this record blocked
  // at least one original command. No blocked commands renders no new bytes.
  if (section.blockedCommands !== undefined && section.blockedCommands.length > 0) {
    lines.push(B.reviewBlocked);
  }
  return lines;
}

/**
 * Slice 1 §2.7: `renderContinuationBriefZh` refuses `capacity` when even the
 * mandatory part of the anomaly section cannot fit in `renderedBytes`, instead
 * of silently dropping the section. The preparation owner maps this to a
 * `capacity` rejection.
 */
export class ContinuationBriefCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContinuationBriefCapacityError';
  }
}

function endingZh(B: BriefTexts, brief: ContinuationBriefV1): string {  const previous = brief.previous;
  // `factsFrom.hops > 0` only when the previous Run itself never entered the Kernel.
  if (brief.stoppedAt.kernel === 'not_entered' || brief.factsFrom.hops > 0) {
    return `${B.S('brief.ending.notEnteredLead')}${previous.outcome}）`;
  }
  if (previous.outcome === 'cancelled' && brief.stoppedAt.reason === 'cancelled_at_reconcile') {
    return B.S('brief.ending.cancelledAtReconcile');
  }
  if (previous.outcome === 'cancelled' && brief.stoppedAt.reason === 'cancelled_while_paused') {
    return B.S('brief.ending.cancelledWhilePaused');
  }
  switch (previous.origin) {
    case 'observed':
      return `${B.S('brief.ending.observedLead')}${previous.outcome}${B.S('brief.ending.observedSuffix')}`;
    case 'host_interrupted':
      return `${B.S('brief.ending.hostInterruptedLead')}${previous.outcome}`;
    case 'human_attested':
      return `${B.S('brief.ending.humanAttestedLead')}${previous.outcome}`;
  }
}

function continuityZh(B: BriefTexts, session: ContinuationBriefV1['session']): string {
  const here = `${B.S('brief.continuity.sessionPrefix')}${session.sessionRef.sessionId}`;
  switch (session.continuity) {
    case 'same_session_history':
      return `${B.S('brief.continuity.sameHistoryLead')}${here}${B.S('brief.continuity.sameHistorySuffix')}`;
    case 'same_session_without_previous_turn':
      return `${B.S('brief.continuity.sameHistoryLead')}${here}${B.S('brief.continuity.sameWithoutTurnSuffix')}`;
    case 'other_session_seeded': {
      const seeded = session.seededFrom;
      const from = seeded === null ? B.S('brief.continuity.before') : `${B.S('brief.continuity.sessionPrefix')}${seeded.sessionRef.sessionId}`
        + `${seeded.throughPosition === null ? '' : `${B.S('brief.continuity.throughPosition')}${String(seeded.throughPosition)}`}`;
      return `${B.S('brief.continuity.otherLead')}${here}${B.S('brief.continuity.seededMiddle')}${from}${B.S('brief.continuity.seededSuffix')}`;
    }
    case 'other_session':
      return `${B.S('brief.continuity.otherLead')}${here}${B.S('brief.continuity.otherSuffix')}`;
  }
}

function toolCallZh(B: BriefTexts, call: ContinuationToolCallV1, cap: number): string {
  const parts = [`${call.name}${B.S('brief.toolCall.openCallId')}${call.callId}${B.S('brief.toolCall.beforeResult')}`
    + `${B.toolResult[call.result]}`];
  if (call.sideEffect !== null) parts.push(B.sideEffect[call.sideEffect]);
  if (call.target !== null) parts.push(`${B.S('brief.toolCall.targetLead')}${boundedZh(B, call.target, cap)}`);
  if (call.changedPaths.length > 0 || call.changedPathsOmitted > 0) {
    parts.push(`${B.S('brief.toolCall.changedLead')}${listZh(B, call.changedPaths, cap)}${moreZh(B, call.changedPathsOmitted)}`);
  }
  if (call.error !== null) parts.push(`${B.S('brief.toolCall.errorLead')}${boundedZh(B, call.error, cap)}`);
  return parts.join(B.S('brief.separator.semicolon'));
}
