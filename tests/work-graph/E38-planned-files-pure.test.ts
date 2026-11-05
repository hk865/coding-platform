/**
 * E38-R1, E38-R2 (E3-8 spec §3.1, §3.3, §4): the plan codec's format checks for `RuntimeTask.plannedFiles`, and the
 * taskbook's `- Planned files:` line.
 *
 * Pure A5: an otherwise valid PlanRevisionSnapshot (the `PL-segment-codec.test.ts` shape, written again here) goes
 * through the exported `decodePlanRevisionSnapshot`; a hand-written two-task plan goes through the exported
 * `renderTaskbookMarkdown`. Every path and every reason is a literal from the spec; nothing is read from `src`.
 * One illegal field per rejected row (F11).
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { renderTaskbookMarkdown } from '../../src/core/work-graph/views/taskbook-markdown.js';

const projectId = 'e38-planned-files';
const goalRef = { aggregateType: 'Goal', projectId, goalId: 'goal-1' } as const;
const at = '2026-11-05T00:00:00.000Z';

function taskBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: 'work-1',
    stageId: 'stage-1',
    title: 'Work',
    requirementLevel: 'required',
    taskKind: 'work',
    disposition: 'active',
    phase: 'pending',
    scope: { kind: 'stage', stageId: 'stage-1' },
    executionIntent: 'request_execution',
    ...extra,
  };
}

/** A gate task: `executionIntent` is dropped, because a gate carrying it is another error (F11). */
function gateBody(extra: Record<string, unknown>): Record<string, unknown> {
  const { executionIntent: _workOnly, ...gate } = taskBody({ taskKind: 'gate', ...extra });
  return gate;
}

function snapshotBody(task: Record<string, unknown>): Record<string, unknown> {
  return {
    ref: { aggregateType: 'PlanRevision', projectId, planId: 'plan-1' },
    revision: 1,
    schemaVersion: 2,
    goalRef,
    planId: 'plan-1',
    planRevision: 1,
    acceptedAt: at,
    effectiveCompletionPolicy: {
      ref: { aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'policy-1', revision: 1 },
      digest: 'a'.repeat(64),
    },
    effectiveArchitectureBaseline: {
      ref: { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId: 'baseline-1', revision: 1 },
      digest: 'b'.repeat(64),
    },
    stages: [{ stageId: 'stage-1', title: 'First segment' }],
    tasks: [task],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

function encoded(body: Record<string, unknown>): Parameters<typeof decodePlanRevisionSnapshot>[0] {
  return {
    refKey: canonicalJson(body['ref'] as JsonValue),
    schemaId: 'PlanRevisionSnapshot@1',
    revision: body['revision'] as number,
    json: JSON.stringify(body),
  };
}

function decode(task: Record<string, unknown>) {
  return decodePlanRevisionSnapshot(encoded(snapshotBody(task)));
}

/** `src/f0.ts` … `src/f<count - 1>.ts`. */
const numbered = (count: number): string[] => Array.from({ length: count }, (_unused, index) => `src/f${index}.ts`);

describe('accepts: plannedFiles', () => {
  it.each<[string, string[] | undefined]>([
    ['one path', ['src/a/b.ts']],
    ['50 paths', numbered(50)],
    ['a file name with brackets', ['src/app/[id]/page.ts']],
    ['no plannedFiles at all', undefined],
  ])('E38-R1 accepts %s', (_name, plannedFiles) => {
    /* Named mutation: per row, the bound refuses 50, a bracket is taken for a pattern, or the absent field is required. */
    const result = decode(taskBody(plannedFiles === undefined ? {} : { plannedFiles }));
    expect(result.status).toBe('decoded');
    if (result.status !== 'decoded') return;
    const task = result.value.tasks[0];
    if (plannedFiles === undefined) expect(task).not.toHaveProperty('plannedFiles');
    else expect(task?.plannedFiles).toEqual(plannedFiles);
  });
});

const COUNT = 'plan tasks[0].plannedFiles must be an array of 1 to 50 paths when present';
const PATH_0 = 'plan tasks[0].plannedFiles[0] must be a normalized workspace-relative file path';

describe('rejects: plannedFiles (format only)', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['an empty array', taskBody({ plannedFiles: [] }), COUNT],
    ['51 paths', taskBody({ plannedFiles: numbered(51) }), COUNT],
    ['a string, not an array', taskBody({ plannedFiles: 'src/a.ts' }), COUNT],
    ['a non-string item', taskBody({ plannedFiles: [3] }), PATH_0],
    ['a parent segment', taskBody({ plannedFiles: ['../a.ts'] }), PATH_0],
    ['a leading slash', taskBody({ plannedFiles: ['/src/a.ts'] }), PATH_0],
    ['a leading dot segment', taskBody({ plannedFiles: ['./src/a.ts'] }), PATH_0],
    ['a trailing slash (a directory)', taskBody({ plannedFiles: ['src/a/'] }), PATH_0],
    ['a backslash', taskBody({ plannedFiles: ['src\\a.ts'] }), PATH_0],
    ['a star', taskBody({ plannedFiles: ['src/*.ts'] }), PATH_0],
    ['a question mark', taskBody({ plannedFiles: ['src/a?.ts'] }), PATH_0],
    ['a repeated path', taskBody({ plannedFiles: ['src/a.ts', 'src/a.ts'] }),
      'plan tasks[0].plannedFiles[1] repeats an earlier path'],
    ['a gate carrying it', gateBody({ plannedFiles: ['src/a.ts'] }),
      'plan tasks[0].plannedFiles must not appear on a gate task'],
  ])('E38-R1 rejects %s', (_name, task, reason) => {
    /*
     * Named mutation: drop the repeat check (only the repeated-path row goes red); let patterns through by checking
     * only isSafeSourceRelativePath (only the star and question-mark rows go red). Per row, its own check removed.
     */
    const result = decode(task);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain(reason);
  });
});

/** One stage, two module tasks: `e38-listed` names two planned files, `e38-unlisted` names none. */
function taskbookPlan(): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId: 'e38-plan',
    planRevision: 1,
    goalId: 'g',
    stages: [{ stageId: 'build', title: 'Build stage' }],
    tasks: [
      {
        taskId: 'e38-listed',
        title: 'Listed task',
        requirementLevel: 'required',
        taskKind: 'work',
        disposition: 'active',
        phase: 'pending',
        scope: { kind: 'module', stageId: 'build', moduleRef: 'mod-a' },
        plannedFiles: ['src/a.ts', 'src/b.ts'],
      },
      {
        taskId: 'e38-unlisted',
        title: 'Unlisted task',
        requirementLevel: 'required',
        taskKind: 'work',
        disposition: 'active',
        phase: 'pending',
        scope: { kind: 'module', stageId: 'build', moduleRef: 'mod-a' },
      },
    ],
    assignments: [
      { taskId: 'e38-listed', role: 'executor', instruction: 'Change the two files.' },
      { taskId: 'e38-unlisted', role: 'executor', instruction: 'Change the module.' },
    ],
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

/** The lines of one task's section: from its `## <title>` heading up to the next `## ` heading or the end. */
function sectionOf(lines: readonly string[], title: string): string[] {
  const start = lines.indexOf(`## ${title}`);
  if (start < 0) throw new Error(`E38-R2: the taskbook has no section ${title}: ${JSON.stringify(lines)}`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start, next < 0 ? lines.length : next);
}

describe('E38-R2: the taskbook names a task\'s planned files', () => {
  it('writes "- Planned files:" right after the listed task\'s Scope line, and nothing for the unlisted one', () => {
    /* Named mutation: write the line for a task with no plannedFiles too (the second expect goes red). */
    const text = renderTaskbookMarkdown(taskbookPlan(), 'build') ?? '';
    const lines = text.split('\n');
    const listed = sectionOf(lines, 'Listed task');
    const scope = listed.findIndex(line => line.startsWith('- Scope: '));
    if (scope < 0) throw new Error(`E38-R2: the listed task's section has no Scope line: ${JSON.stringify(listed)}`);
    expect(listed[scope + 1]).toBe('- Planned files: src/a.ts, src/b.ts');
    expect(sectionOf(lines, 'Unlisted task').some(line => line.startsWith('- Planned files:'))).toBe(false);
  });
});
