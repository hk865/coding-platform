/**
 * Hand-written expected secretary inputs: the text a secretary round (`callKind: 'secretary'`, template
 * `secretary-round` v1) sends as its input, built only from literals and from values a test got from public steps
 * (ids, revisions, `since` cursors as a public read shows them, texts the test submitted). Nothing here calls
 * production rendering code or imports a production constant; every literal is copied by hand from the frozen
 * secretary rules (the `secretary-round` and `secretary-answer` templates, the secretary strings, the rendering of
 * the secretary's preparation, the two answer formats) or from today's platform pack and renderer, and each piece
 * names its source. The secretary templates are not in the platform pack yet, so these samples are the expected
 * values the secretary rows compare with.
 *
 * Where the frozen rules leave the exact text open, these samples fix it, each in one place: every section starts
 * with today's section header, as every other call kind's input does (`## Goal` before `## Workspace`, `## Accepted
 * task` before `## This round`); the lines of the goal section are joined by one `\n`, like today's goal payload;
 * the drafts note follows the v2 format after one `\n`; a goal line cuts its objective's first line to 160 code
 * points and then appends `…`; an earlier entry without an answer reads `(no answer) <close code>`; earlier entries
 * are separated by a blank line; a no-goal request lists the project understanding and norms in the notes section
 * with today's understanding and norm lines.
 *
 * Layout of one input (the `secretary-round` template; `\n\n` separates every section, as today's renderer does):
 *   <prelude>\n\n<role><goal><notes><task_round><task_batched><task_earlier>
 * - prelude: today's Query prelude (`context.prelude.query`).
 * - role: `## Runtime context`, then today's role payload of a legacy-template secretary whose role is `absent`
 *   (`R/context-fact-text.ts` `rolePayload`), then the stale-files reminder on its own line when the round takes the
 *   Session's history.
 * - goal: `## Goal`, then the workspace block (`## Workspace`, the project id, the workspace, architecture and
 *   completion policy lines, the served roles, the top-level module cards), the goals block (`## Goals`, one line per
 *   goal), then the selected goal's payload (`goalPayload`) or `This request has no goal yet.`; every line joined by `\n`.
 * - notes (omitted when empty): `## Note index`, then the goal's note index (a goal request) or the project
 *   understanding and norms (a no-goal request), one line each.
 * - task (one section of three adjacent slots): `## Accepted task` and `## This round`, the executing round's
 *   material, a blank line and the answer format; `## Also queued in this request` and the batch's material; `## Earlier
 *   rounds of this request on other secretaries` and the earlier entries, separated by a blank line.
 * A person's pack may order the sections differently (the role first, the three task slots as one block); `order`
 * takes that order and every slot keeps its own leading `\n\n`.
 */
import type { NoteDraftAnchorV1 } from '../../src/contracts/note.js';

// ---------------------------------------------------------------------------
// Literals: the secretary strings and templates
// ---------------------------------------------------------------------------

/** The secretary strings of the platform pack, keyed as the pack keys them. */
export const SECRETARY_STRINGS = {
  'secretary.workspaceHeading': '## Workspace',
  'secretary.goalsHeading': '## Goals',
  'secretary.noGoal': 'This request has no goal yet.',
  'secretary.roundHeading': '## This round',
  'secretary.selectedIdea': 'Selected idea:',
  'secretary.batchedHeading': '## Also queued in this request',
  'secretary.earlierHeading': '## Earlier rounds of this request on other secretaries',
  'secretary.answerOmitted': '(answer cut at 2 KiB)',
  'secretary.noAnswer': '(no answer)',
  'secretary.notEnded': '(still running or result unknown)',
} as const;

/** `secretary-round.txt`: `role` and `task_round` required, the other slots optional. */
export const SECRETARY_ROUND_TEMPLATE_V1 =
  '{{prelude}}\n\n{{role}}{{goal}}{{notes}}{{task_round}}{{task_batched}}{{task_earlier}}';

/** The platform pack's versions of the two secretary templates (neither mentions a tool). */
export const SECRETARY_TEMPLATE_VERSIONS = { 'secretary-round': 1, 'secretary-answer': 2 } as const;

/** `secretary-answer.txt`: the answer format of a `semantic_query` round. */
export const SECRETARY_ANSWER_FORMAT_V1 = `Return exactly one JSON object as your entire final answer: no preface, no trailing note, no commentary and no markdown or code fences. The platform parses that one object strictly and never extracts or repairs JSON out of surrounding text.
The object has exactly these fields:
- schemaVersion: 1.
- body: your answer to the person, in the person's language. It must not be empty.
- ideas: [] or 2 to 3 options, each {"title", "detail"}. title is one line of at most 120 characters; detail is at most 600 characters. Give options only when the person has a real choice between different approaches. Never give exactly one option and never more than three.
- goalCardDrafts: [] unless this request has no goal and the person asks for new work. Each draft is {"objective", "completion", "autonomy", "screening"}: objective is one sentence; completion is a non-empty array of checkable completion criteria; autonomy is "every_step" or "after_plan_confirmation"; screening is optional: omit it or use null when you did not screen the draft, otherwise give {"modules": [ModuleRef...], "size": "small" | "medium" | "large" | "unknown", "conflictsWith": [GoalRef...], "dependsOn": [GoalRef...], "urgency": "high" | "normal" | "low", "suggestedPosition": null or an integer >= 0, "note": a string of at most 512 UTF-8 bytes}. Use the full ModuleRef and GoalRef objects exactly as the tools show them. A draft is a proposal only; no goal exists until the person confirms it.`;

/** `secretary.initialDrafts`: follows the v2 answer format in a no-goal `initial_coordination` round. */
export const SECRETARY_INITIAL_DRAFTS = `This request has no goal yet, so a "plan" answer MUST carry a top-level "goalCardDrafts" array with at least one draft; a "needs_decision" answer may carry drafts or none. Each draft is {"objective", "completion", "autonomy", "screening"}, objective one sentence, completion a non-empty array of checkable criteria, autonomy "every_step" or "after_plan_confirmation". "screening" is optional: omit it or use null when the draft was not screened, otherwise {"modules", "size", "conflictsWith", "dependsOn", "urgency", "suggestedPosition", "note"} with full ModuleRef and GoalRef objects exactly as the tools show them; size is "small", "medium", "large" or "unknown", urgency is "high", "normal" or "low", suggestedPosition is null or an integer >= 0, note is at most 512 UTF-8 bytes. A "plan" answer MUST also carry a top-level "planDraftIndex" integer naming the zero-based index of the draft this plan is for. A "needs_decision" answer carries no planDraftIndex. A draft is a proposal only.`;

/** `secretary.setupRequired`: follows the v2 answer format in every `initial_coordination` round. */
export const SECRETARY_SETUP_REQUIRED = `This project has no adopted architecture or no active completion policy yet (see "architecture:" and "completion policy:" above), so a "plan" answer MUST carry the top-level "setup" object with all three fields (architecture, completionPolicy, checks); for this request the OPTIONAL and "Omit setup" wording above does not apply. Use the projectId shown above in every module ref and only the available roles shown above in assignments.`;

/** `SECRETARY_HISTORY_ROUNDS` and `SECRETARY_HISTORY_ANSWER_BYTES`: the latest earlier entries shown, each answer's cut. */
export const SECRETARY_HISTORY_ROUNDS = 10;
export const SECRETARY_HISTORY_ANSWER_BYTES = 2048;
/** A goal line shows its objective's first line cut to this many code points, then `…`. */
export const SECRETARY_GOAL_LINE_CODE_POINTS = 160;

// ---------------------------------------------------------------------------
// Literals: today's texts the secretary input reuses
// ---------------------------------------------------------------------------

/**
 * `initial-planning-answer` v2 (resources/prompts/platform/templates/initial-planning-answer.txt, unchanged by the
 * secretary rounds): the answer format of an `initial_coordination` round. It mentions no tool, so it renders as is.
 */
export const INITIAL_PLANNING_ANSWER_V2 = `Return exactly one JSON object as your entire final answer, with schemaVersion 2 and kind "plan" or "needs_decision": no preface, no trailing note, no commentary and no markdown or code fences. The platform parses that one object strictly and never extracts or repairs JSON out of surrounding text.
For needs_decision, provide summary and questions (a non-empty array of strings); ask only the real product or authorization decisions the request leaves open. Do not invent authorization.
For plan, provide summary and plan with schemaVersion 2 and the following fields:
- stages: array of {stageId, title, description?}. A task references a stage only through its own stageId.
- tasks: array of {taskId, stageId?, title, requirementLevel, taskKind, disposition, phase, scope, executionIntent?}. requirementLevel is "required" or "optional". taskKind is "work" or "gate". disposition is "active", "deferred", "cancelled" or "superseded". phase is "pending", "ready", "running", "verifying", "blocked", "satisfied" or "failed"; every task of a NEW plan starts "pending". scope is {kind:"goal"}, {kind:"stage",stageId} or {kind:"module",stageId,moduleRef}. Task scope.moduleRef is a non-empty STRING containing the moduleId, NOT the {projectId,moduleId} object used in the architecture catalog. executionIntent is "plan_only" or "request_execution" and may appear on a work task only.
- assignments: array of {taskId, role, instruction}. A work task with executionIntent "request_execution" needs exactly one assignment whose role is one of the AVAILABLE roles/templateId shown in this context; a work task with executionIntent "plan_only" may omit it; a gate task must never carry an assignment or an executionIntent, because a gate conclusion comes from the formal evidence reduction, not from an execution run. A future work task with executionIntent "plan_only" may omit assignment, obligations/acceptance and dependencies; its incompleteness alone is not a reason to return needs_decision.
- obligations: array of {obligationId, title, requirementLevel, taskIds, verificationRequirements}. taskIds lists only work/gate tasks of this same plan. Every verificationRequirements entry is {requirementId, requirementLevel, kind, description}; requirementLevel is "required" or "optional" and kind must be one of the requirementKinds of the effective CompletionPolicy shown in this context. A required obligation needs at least the policy's minimum number of required verification requirements.
- taskHierarchy: {parentOf:[{parentTaskId, childTaskId}]}. It only expresses display grouping.
- executionDag: {dependsOn:[{taskId, dependsOnId, requires:{kind, label}}]}. requires.kind is "output-contract", "artifact", "decision", "environment-revision" or "gate-result"; use a real versioned input/output dependency, keep the DAG acyclic and never make a task depend on itself.
- taskRelations (optional): array of {fromTaskId, toTaskId, kind, note}; kind is "coordination" or "expected_dependency". It is advisory only and never a dispatch prerequisite.
You MAY also add an OPTIONAL top-level "setup" sibling of "plan"; it is a SUGGESTION only and grants no Host/tool permission. It has exactly these three fields:
- architecture: {baselineId, description, constraints:[{name, scope}], catalog:{requireDag:true, dependencies:[{from:{projectId, moduleId}, to:{projectId, moduleId}, reason}], modules:[{ref:{projectId, moduleId}, name, responsibility, paths, interfaces:[{id, description, paths}]}], containment:{parentOf:[{parent:{projectId, moduleId}, child:{projectId, moduleId}}]}}}. Every module ref MUST use the REAL projectId of this request; never guess a project/workspace id. containment is OPTIONAL: give a parent/child pair only when the real sources show that one module contains the other; omit containment when you do not know (an omitted containment means unknown, never flat); an explicit {parentOf:[]} means every module is flat; never derive a parent from paths or dependencies.
- completionPolicy: {schemaVersion:1, requirementKinds:[...], minimumRequiredRequirementsPerObligation:N}. Copy the requirementKinds of the effective CompletionPolicy shown in this context. When no policy is shown, propose the smallest REAL policy this request needs; never emit an empty policy whose vacuously satisfied obligations would auto-PASS.
- checks: array of {checkId, kind, command, cwd, timeoutMs, taskIds}. "kind" is exactly a policy requirement kind ("static" or "dynamic") and maps directly to the requirement.kind it satisfies; there is NO coverage field and never add one. taskIds is "all" or the real task ids. Use only a command that must really run for this request: never assume a test file exists, never copy an unrelated command, and never invent an empty check list to force a PASS.
Omit "setup" entirely when you have no real architecture/policy/check to propose.
Do not include planId, planRevision, goalId or origin: the platform derives identity from the saved Job project/goal/intentId and provenance from the real Goal/Workspace revisions and the actual answer digest.
Choose every stage, task, scope, role, instruction, obligation, verification requirement and dependency from the actual request and the real sources. Never invent a gate, dependency, assignment, acceptance, verification requirement or role binding the request did not ask for, and never fill a genuinely missing decision with a default; ask that decision through needs_decision instead.
The JSON example below is a SHAPE SAMPLE only: it shows the exact field names and legal enum values. It is NOT authorization for any task, role, acceptance, dependency, architecture, policy or check of this request. Do not copy its ids, projectId, role, tasks, obligations or dependencies; replace every value with the real one from this request.
BEGIN_INITIAL_PLAN_EXAMPLE
{
  "schemaVersion": 2,
  "kind": "plan",
  "summary": "Shape sample only: replace every value with the real work of this request.",
  "plan": {
    "schemaVersion": 2,
    "stages": [
      { "stageId": "sample-stage", "title": "Shape sample stage" }
    ],
    "tasks": [
      { "taskId": "sample-work", "stageId": "sample-stage", "title": "Shape sample executable work",
        "requirementLevel": "required", "taskKind": "work", "disposition": "active", "phase": "pending",
        "scope": { "kind": "stage", "stageId": "sample-stage" }, "executionIntent": "request_execution" },
      { "taskId": "sample-gate", "title": "Shape sample goal gate",
        "requirementLevel": "required", "taskKind": "gate", "disposition": "active", "phase": "pending",
        "scope": { "kind": "goal" } },
      { "taskId": "sample-future", "title": "Shape sample optional future intent",
        "requirementLevel": "optional", "taskKind": "work", "disposition": "active", "phase": "pending",
        "scope": { "kind": "goal" }, "executionIntent": "plan_only" }
    ],
    "assignments": [
      { "taskId": "sample-work", "role": "<role-from-available-configuration>",
        "instruction": "Shape sample instruction: replace with the real requested work" }
    ],
    "obligations": [
      { "obligationId": "sample-obligation", "title": "Shape sample acceptance obligation",
        "requirementLevel": "required", "taskIds": ["sample-work", "sample-gate"],
        "verificationRequirements": [
          { "requirementId": "sample-requirement", "requirementLevel": "required", "kind": "static",
            "description": "Shape sample verification: replace with the real check from this request" }
        ] }
    ],
    "taskHierarchy": { "parentOf": [] },
    "executionDag": { "dependsOn": [
      { "taskId": "sample-gate", "dependsOnId": "sample-work",
        "requires": { "kind": "artifact", "label": "Shape sample required input for the gate" } }
    ] }
  },
  "setup": {
    "architecture": {
      "baselineId": "sample-baseline",
      "description": "Shape sample: replace with the real initial boundary of this project",
      "constraints": [],
      "catalog": {
        "requireDag": true,
        "dependencies": [],
        "modules": [
          { "ref": { "projectId": "<real-project-id-from-this-request>", "moduleId": "sample-module" },
            "name": "Shape sample module", "responsibility": "Replace with the real responsibility",
            "paths": ["src"], "interfaces": [] }
        ]
      }
    },
    "completionPolicy": {
      "schemaVersion": 1,
      "requirementKinds": ["static"],
      "minimumRequiredRequirementsPerObligation": 1
    },
    "checks": [
      { "checkId": "sample-check", "kind": "static", "command": "<real-command-that-must-run>",
        "cwd": ".", "timeoutMs": 60000, "taskIds": "all" }
    ]
  }
}
END_INITIAL_PLAN_EXAMPLE`;

/** `context.prelude.query` (resources/prompts/platform/strings.json:56). */
export const QUERY_PRELUDE =
  '# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.';

/** `context.section.role|goal|notes|task` (strings.json:57, :58, :61, :59). */
export const SECTION_HEADERS = {
  role: '## Runtime context', goal: '## Goal', notes: '## Note index', task: '## Accepted task',
} as const;

/** The `stale-files-reminder` template (no tool block): appended to the role section on its own line. */
export const STALE_FILES_REMINDER = '- 文件可能已经变化，编辑前先重新读取。';

/** `context.none` (strings.json:69). */
const NONE = '(none)';

/** The reason a legacy-template role resolves `absent` in a project with no coordination policy (role-memory-service.ts:665). */
export const NO_COORDINATION_POLICY_REASON = 'the project has no active coordination policy, so there is no role matrix';

/** The platform secretary template id: the binding's template, which the role resolution uses as the role id. */
export const PLATFORM_SECRETARY_ROLE_ID = 'platform-secretary';

const S = SECRETARY_STRINGS;

// ---------------------------------------------------------------------------
// Small text rules
// ---------------------------------------------------------------------------

/** UTF-8 bytes of one code point. */
function codePointBytes(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** The longest prefix of whole code points within `maxBytes` UTF-8 bytes, and whether anything was cut. */
export function cutUtf8AtCodePoint(text: string, maxBytes: number): { text: string; cut: boolean } {
  let bytes = 0;
  let kept = '';
  for (const char of text) {
    const size = codePointBytes(char.codePointAt(0)!);
    if (bytes + size > maxBytes) return { text: kept, cut: true };
    bytes += size;
    kept += char;
  }
  return { text, cut: false };
}

/** The objective's first line, cut to 160 code points with `…` appended when it is longer. */
export function goalLineObjective(objective: string): string {
  const firstLine = objective.split('\n')[0] ?? '';
  const codePoints = [...firstLine];
  return codePoints.length > SECRETARY_GOAL_LINE_CODE_POINTS
    ? `${codePoints.slice(0, SECRETARY_GOAL_LINE_CODE_POINTS).join('')}…` : firstLine;
}

/** The input `selectIdea` writes for the idea at 0-based `index` (`选了第 2 个思路：<title>` for index 1). */
export function selectIdeaInputText(index: number, title: string): string {
  return `选了第 ${String(index + 1)} 个思路：${title}`;
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

export type SecretaryRoleSample = {
  /** The secretary binding's `configurationRevision` (a Host input; the request world's is `s6a-secretary-binding@1`). */
  policyRevision: string;
  /** The prepared permission tools: the Host grant less the Query bans, in grant order (the request world: `['read']`). */
  tools: readonly string[];
  /** True when the Session already holds a completed history cursor (any round after its first). */
  takesSessionHistory: boolean;
  /** Default `platform-secretary`. */
  roleId?: string;
  /** Default `NO_COORDINATION_POLICY_REASON`. */
  absentReason?: string;
  /** Default 4096 (a binding that names no `contextResidentBytes`). */
  residentBudgetBytes?: number;
};

/**
 * Today's role payload of a secretary whose role is `absent` (`rolePayload`, context-fact-text.ts:65): the binding
 * block, the specification block with the platform secretary profile (strings.json:4–5, role-profiles.ts:31), the
 * duty and the resident budget, the four blocks joined by a blank line.
 */
export function secretaryRolePayload(role: SecretaryRoleSample): string {
  const binding = [
    '## Runtime binding',
    `roleBinding: ${JSON.stringify({ policyRevision: role.policyRevision, tools: [...role.tools], writeScope: [] })}`,
    `tools: ${role.tools.join(', ') || NONE}`,
    `writeScope: ${NONE}`,
  ].join('\n');
  const specification = [
    '## Role specification',
    `role: ${role.roleId ?? PLATFORM_SECRETARY_ROLE_ID} (absent)`,
    role.absentReason ?? NO_COORDINATION_POLICY_REASON,
    'label: Secretary',
    'purpose: Handle the user\'s bounded request.',
    'responsibility: human_decision_support, planning',
  ].join('\n');
  return [binding, specification, 'duty: secretary', `contextResidentBytes: ${String(role.residentBudgetBytes ?? 4096)}`]
    .join('\n\n');
}

/** The role slot: header, payload, and the stale-files reminder when the round takes the Session's history. */
export function secretaryRoleSlot(role: SecretaryRoleSample): string {
  const payload = secretaryRolePayload(role);
  return `${SECTION_HEADERS.role}\n${payload}${role.takesSessionHistory ? `\n${STALE_FILES_REMINDER}` : ''}`;
}

// ---------------------------------------------------------------------------
// Goal section
// ---------------------------------------------------------------------------

export type SampleModule = { projectId: string; moduleId: string; responsibility: string };
export type SampleArchitecture = { baselineId: string; revision: number; topLevelModules: readonly SampleModule[] };
export type SamplePolicy = { policyId: string; revision: number };
export type SampleGoalListEntry = { goalId: string; desiredState: string; objective: string };

/**
 * The architecture as the goal section shows it, from what the adoption or revision returned: the modules that are
 * no module's child under the catalog's containment, in catalog order (`topLevelModuleCards`, context-fact-text.ts:374).
 */
export function architectureSample(pointer: {
  baselineId: string; revision: number;
  catalog: { modules: readonly { ref: { projectId: string; moduleId: string }; responsibility: string }[];
    containment?: { parentOf: readonly { child: { moduleId: string } }[] } };
}): SampleArchitecture {
  const children = new Set((pointer.catalog.containment?.parentOf ?? []).map(entry => entry.child.moduleId));
  return {
    baselineId: pointer.baselineId, revision: pointer.revision,
    topLevelModules: pointer.catalog.modules.filter(module => !children.has(module.ref.moduleId)).map(module => ({
      projectId: module.ref.projectId, moduleId: module.ref.moduleId, responsibility: module.responsibility })),
  };
}

/**
 * One module card: the canonical JSON (keys sorted) of `{ key, node: { kind: 'module', ref }, text, sources: [] }`
 * (`indexRowText`, context-support.ts:37).
 */
export function moduleCardLine(module: SampleModule): string {
  return `{"key":${JSON.stringify(module.moduleId)},"node":{"kind":"module","ref":{"moduleId":${JSON.stringify(module.moduleId)},`
    + `"projectId":${JSON.stringify(module.projectId)}}},"sources":[],"text":${JSON.stringify(module.responsibility)}}`;
}

/** `## Workspace`, the project id, the three pointer lines, the served roles and, with an architecture, its top-level
 *  module cards. */
export function workspaceBlock(input: {
  projectId: string; workspaceId: string; workspaceRevision: number; architecture: SampleArchitecture | null;
  policy: SamplePolicy | null; executionRoles: readonly string[];
}): string {
  const { architecture, policy } = input;
  return [
    S['secretary.workspaceHeading'],
    `projectId: ${input.projectId}`,
    `workspace: ${input.workspaceId}@${String(input.workspaceRevision)}`,
    architecture === null ? `architecture: ${NONE}` : `architecture: ${architecture.baselineId}@${String(architecture.revision)}`,
    policy === null ? `completion policy: ${NONE}` : `completion policy: ${policy.policyId}@${String(policy.revision)}`,
    `available roles: ${input.executionRoles.length === 0 ? NONE : input.executionRoles.join(', ')}`,
    ...(architecture === null ? [] : architecture.topLevelModules.map(moduleCardLine)),
  ].join('\n');
}

/** One goal line. */
export function goalListLine(goal: SampleGoalListEntry): string {
  return `- ${goal.goalId} [${goal.desiredState}] ${goalLineObjective(goal.objective)}`;
}

/**
 * `## Goals` and one line per goal of the workspace, in `listWorkspaceGoals` order (the canonical JSON of the goal
 * ref, goal-conflicts.ts:137: for goals of one project, JSON-encoded goal id order), or `(none)`.
 */
export function goalsBlock(goals: readonly SampleGoalListEntry[]): string {
  const ordered = [...goals].sort((left, right) => {
    const a = JSON.stringify(left.goalId);
    const b = JSON.stringify(right.goalId);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return [S['secretary.goalsHeading'], ...(ordered.length === 0 ? [NONE] : ordered.map(goalListLine))].join('\n');
}

// ---------------------------------------------------------------------------
// Memory lines (today's note rendering)
// ---------------------------------------------------------------------------

export type SampleSections = { status: string; decided: string; open: string; next: string; risks: string };
/** A current understanding as `notes/write` returned its ids, with the text the test wrote. */
export type SampleUnderstanding = { noteId: string; version: number; conclusion: string; sections: SampleSections | null };
export type SampleNoteKind = 'convention' | 'pitfall' | 'tradeoff' | 'open_question' | 'preference' | 'decision'
  | 'understanding' | 'repair';
/** A current note as `notes/write` returned its ids, with the draft the test wrote. */
export type SampleNote = {
  noteId: string; version: number; kind: SampleNoteKind; anchor: NoteDraftAnchorV1; conclusion: string; structural: boolean;
};

/** Kind labels (strings.json:25–32). */
const KIND_LABELS: Readonly<Record<SampleNoteKind, string>> = {
  convention: '约定', pitfall: '坑', tradeoff: '取舍', open_question: '待解问题', preference: '偏好', decision: '决定',
  understanding: '当前理解', repair: '修补',
};

/** `renderNoteHeader` (src/contracts/note.ts): `<kind>(<anchor>)<!>：<conclusion>`, anchor prefixes strings.json:33–40. */
export function noteHeaderLabel(note: Pick<SampleNote, 'kind' | 'anchor' | 'conclusion' | 'structural'>): string {
  const anchor = note.anchor;
  let display: string;
  switch (anchor.kind) {
    case 'project': display = '项目'; break;
    case 'goal': display = `目标 ${anchor.goalId}`; break;
    case 'stage': display = `阶段 ${anchor.stageId}`; break;
    case 'task': display = `任务 ${anchor.taskId}`; break;
    case 'module': display = `模块 ${anchor.moduleId}`; break;
    case 'interface': display = `接口 ${anchor.moduleId}/${anchor.interfaceId}`; break;
    case 'file':
      if (anchor.symbolRequest !== undefined) throw new Error('S6A samples: a symbol anchor needs the resolved symbol');
      display = `${anchor.path}${anchor.deleted === true ? '（已删）' : ''}`;
      break;
  }
  return `${KIND_LABELS[note.kind]}(${display})${note.structural ? '!' : ''}：${note.conclusion}`;
}

/** `<label>（<noteId> v<version>）` (context-fact-text.ts:114, strings.json:121–123). */
function withNoteVersion(label: string, noteId: string, version: number): string {
  return `${label}（${noteId} v${String(version)}）`;
}

/** One note index or norm line: the header label with the note id and version. */
export function noteIndexLine(note: SampleNote): string {
  return withNoteVersion(noteHeaderLabel(note), note.noteId, note.version);
}

/** The understanding body (note-rendering.ts:7). */
export function understandingBody(sections: SampleSections): string {
  return `现状\n${sections.status}\n\n已定\n${sections.decided}\n\n未决\n${sections.open}\n\n下一步\n${sections.next}\n\n风险\n${sections.risks}`;
}

/** The project understanding line: the whole body (`understandingLine`, context-fact-text.ts:139). */
export function projectUnderstandingLine(understanding: SampleUnderstanding): string {
  const body = understanding.sections === null ? understanding.conclusion : understandingBody(understanding.sections);
  return `${withNoteVersion('项目 当前理解', understanding.noteId, understanding.version)}：${body}`;
}

/** A goal understanding line: its conclusion, or the goal's "no current understanding" line. */
export function goalUnderstandingLine(goalId: string, understanding: SampleUnderstanding | null): string {
  if (understanding === null) return `目标 ${goalId}：还没有当前理解`;
  return `${withNoteVersion(`目标 ${goalId} 当前理解`, understanding.noteId, understanding.version)}：${understanding.conclusion}`;
}

/** The omitted-norms line (strings.json:129–130). */
export function normsOmittedLine(count: number): string {
  return `另有 ${String(count)} 条，用‘看’读项目`;
}

// ---------------------------------------------------------------------------
// The selected goal's payload (today's `goalPayload`)
// ---------------------------------------------------------------------------

export type SampleGoalPayload = {
  goalId: string;
  objective: string;
  autonomy: string;
  projectUnderstanding: SampleUnderstanding | null;
  goalUnderstanding: SampleUnderstanding | null;
  /** In display order: newest first. */
  norms: readonly SampleNote[];
  normsOmitted?: number;
};

/**
 * `goalPayload` (context-fact-text.ts:180): goal, objective, workspace, autonomy and the current understanding: the
 * project row (whole body), the goal row, the norms, the omitted line (`notesGoalText`, :164).
 */
export function goalPayloadText(workspace: { workspaceId: string; revision: number }, goal: SampleGoalPayload): string {
  const understanding = [
    ...(goal.projectUnderstanding === null ? [] : [projectUnderstandingLine(goal.projectUnderstanding)]),
    goalUnderstandingLine(goal.goalId, goal.goalUnderstanding),
    ...goal.norms.map(noteIndexLine),
    ...((goal.normsOmitted ?? 0) > 0 ? [normsOmittedLine(goal.normsOmitted!)] : []),
  ];
  return [
    `goal: ${goal.goalId}`,
    `objective: ${goal.objective}`,
    `workspace: ${workspace.workspaceId}@${String(workspace.revision)}`,
    `autonomy: ${goal.autonomy}`,
    `current understanding: ${understanding.join('\n')}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Round material and the three task slots
// ---------------------------------------------------------------------------

export type SampleSelectedIdea = { title: string; detail: string };
/** One round as a public read shows it: its `since` cursor, its stored input and its selected idea. */
export type SampleRound = { since: string; input: string; selectedIdea?: SampleSelectedIdea | null };

/** `- [<since>] <input>`, then for a selected idea `Selected idea:` and `<title>: <detail>` on the next line. */
export function roundMaterialText(round: SampleRound): string {
  const lines = [`- [${round.since}] ${round.input}`];
  if (round.selectedIdea !== undefined && round.selectedIdea !== null) {
    lines.push(S['secretary.selectedIdea'], `${round.selectedIdea.title}: ${round.selectedIdea.detail}`);
  }
  return lines.join('\n');
}

export type SampleEarlierResult =
  | { kind: 'answer'; text: string }
  | { kind: 'no_answer'; closeCode: string }
  | { kind: 'not_ended' };
/** One earlier round on another Session: its material, its absorbed rounds' material, then its result. */
export type SampleEarlierEntry = { round: SampleRound; absorbed?: readonly SampleRound[]; result: SampleEarlierResult };

/** The result line(s) of one earlier entry. */
export function earlierResultText(result: SampleEarlierResult): string {
  if (result.kind === 'not_ended') return S['secretary.notEnded'];
  if (result.kind === 'no_answer') return `${S['secretary.noAnswer']} ${result.closeCode}`;
  const cut = cutUtf8AtCodePoint(result.text, SECRETARY_HISTORY_ANSWER_BYTES);
  return cut.cut ? `${cut.text}\n${S['secretary.answerOmitted']}` : cut.text;
}

export function earlierEntryText(entry: SampleEarlierEntry): string {
  return [roundMaterialText(entry.round), ...(entry.absorbed ?? []).map(roundMaterialText), earlierResultText(entry.result)]
    .join('\n');
}

/** The answer format of a round: the semantic one, or the v2 one (plus the setup note, and the drafts note for a no-goal request). */
export function answerFormatText(input: { executionKind: 'semantic_query' | 'initial_coordination'; noGoal: boolean;
  semanticAnswerFormat?: string }): string {
  if (input.executionKind === 'semantic_query') return input.semanticAnswerFormat ?? SECRETARY_ANSWER_FORMAT_V1;
  return `${INITIAL_PLANNING_ANSWER_V2}\n${SECRETARY_SETUP_REQUIRED}`
    + (input.noGoal ? `\n${SECRETARY_INITIAL_DRAFTS}` : '');
}

/** `task_round`: the task header, `## This round`, the round's material, a blank line, the answer format. */
export function taskRoundSlot(round: SampleRound, answerFormat: string): string {
  return `\n\n${SECTION_HEADERS.task}\n${S['secretary.roundHeading']}\n${roundMaterialText(round)}\n\n${answerFormat}`;
}

/** `task_batched`: the batch's material in `since` order, whole; empty when there is no batch. */
export function taskBatchedSlot(rounds: readonly SampleRound[]): string {
  if (rounds.length === 0) return '';
  return `\n\n${S['secretary.batchedHeading']}\n${rounds.map(roundMaterialText).join('\n')}`;
}

/** `task_earlier`: the earlier entries oldest first, a blank line between entries; empty when there is none. */
export function taskEarlierSlot(entries: readonly SampleEarlierEntry[]): string {
  if (entries.length === 0) return '';
  if (entries.length > SECRETARY_HISTORY_ROUNDS) throw new Error('S6A samples: at most ten earlier entries are shown');
  return `\n\n${S['secretary.earlierHeading']}\n${entries.map(earlierEntryText).join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// The whole input
// ---------------------------------------------------------------------------

export type SecretarySectionName = 'role' | 'goal' | 'notes' | 'task';
export const SECRETARY_SECTION_ORDER: readonly SecretarySectionName[] = ['role', 'goal', 'notes', 'task'];

export type SecretaryRequestSample =
  /** A goal request: the selected goal's payload; notes = that goal's note index (general notes, index order). */
  | { kind: 'goal'; goal: SampleGoalPayload; noteIndex: readonly SampleNote[] }
  /** A no-goal request: notes = the project understanding and the norms (display order, newest first). */
  | { kind: 'no_goal'; projectUnderstanding: SampleUnderstanding | null; norms: readonly SampleNote[]; normsOmitted?: number };

export type SecretaryInputSample = {
  role: SecretaryRoleSample;
  workspace: { projectId: string; workspaceId: string; revision: number };
  /** The roles the in-memory Workflow configuration serves for this workspace. */
  executionRoles: readonly string[];
  architecture: SampleArchitecture | null;
  policy: SamplePolicy | null;
  goals: readonly SampleGoalListEntry[];
  request: SecretaryRequestSample;
  executionKind: 'semantic_query' | 'initial_coordination';
  round: SampleRound;
  batched?: readonly SampleRound[];
  earlier?: readonly SampleEarlierEntry[];
  /** A person's pack: its `secretary-answer` text. */
  semanticAnswerFormat?: string;
  /** A person's pack: its section order (role first, the task slots as one block). */
  order?: readonly SecretarySectionName[];
  /** A person's pack: its `context.prelude.query`. */
  prelude?: string;
};

/** The goal slot: `\n\n## Goal\n`, the workspace block, the goals block, the goal payload or the no-goal line. */
export function secretaryGoalSlot(input: Pick<SecretaryInputSample, 'workspace' | 'executionRoles' | 'architecture' | 'policy' | 'goals' | 'request'>): string {
  const lines = [
    workspaceBlock({ projectId: input.workspace.projectId, workspaceId: input.workspace.workspaceId,
      workspaceRevision: input.workspace.revision, architecture: input.architecture, policy: input.policy,
      executionRoles: input.executionRoles }),
    goalsBlock(input.goals),
    input.request.kind === 'goal' ? goalPayloadText(input.workspace, input.request.goal) : S['secretary.noGoal'],
  ];
  return `\n\n${SECTION_HEADERS.goal}\n${lines.join('\n')}`;
}

/** The notes slot, or empty when there is nothing to list. */
export function secretaryNotesSlot(request: SecretaryRequestSample): string {
  const lines = request.kind === 'goal'
    ? request.noteIndex.map(noteIndexLine)
    : [
      ...(request.projectUnderstanding === null ? [] : [projectUnderstandingLine(request.projectUnderstanding)]),
      ...request.norms.map(noteIndexLine),
      ...((request.normsOmitted ?? 0) > 0 ? [normsOmittedLine(request.normsOmitted!)] : []),
    ];
  return lines.length === 0 ? '' : `\n\n${SECTION_HEADERS.notes}\n${lines.join('\n')}`;
}

/** The whole secretary input. */
export function secretaryInputText(input: SecretaryInputSample): string {
  const order = input.order ?? SECRETARY_SECTION_ORDER;
  if (order[0] !== 'role' || new Set(order).size !== 4 || order.length !== 4) {
    throw new Error('S6A samples: the role section comes first and each section appears once');
  }
  const answerFormat = answerFormatText({ executionKind: input.executionKind, noGoal: input.request.kind === 'no_goal',
    ...(input.semanticAnswerFormat === undefined ? {} : { semanticAnswerFormat: input.semanticAnswerFormat }) });
  const slots: Record<SecretarySectionName, string> = {
    role: secretaryRoleSlot(input.role),
    goal: secretaryGoalSlot(input),
    notes: secretaryNotesSlot(input.request),
    task: taskRoundSlot(input.round, answerFormat) + taskBatchedSlot(input.batched ?? []) + taskEarlierSlot(input.earlier ?? []),
  };
  return `${input.prelude ?? QUERY_PRELUDE}\n\n${order.map(name => slots[name]).join('')}`;
}
