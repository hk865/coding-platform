/**
 * The taskbook export (spec §5.3.4): one markdown file per stage under an
 * external settings directory, and the read-only probe the notice source uses.
 *
 * The export never throws and never blocks a plan: no settings directory is
 * `skipped`, a stage missing from the plan or an fs failure is `failed`, and the
 * caller keeps the adoption result. Before writing anything the batch export
 * compares the real export root with every real workspace root — the settings
 * directory itself is not otherwise checked by the Host. Files are overwritten
 * in place; there is no manifest, temp file, rollback or retry.
 */
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../contracts/plan.js';
import type { TaskbookExportReadV1, TaskbookFileStatusV1 } from '../contracts/plan-round.js';
import { messageOf } from '../contracts/error-message.js';
import {
  renderTaskbookMarkdown, taskbookRelativePath,
} from '../core/work-graph/views/taskbook-markdown.js';
import { isPathWithin } from './prompt-packs.js';

export type TaskbookExportV1 =
  | { status: 'written'; path: string }
  | { status: 'skipped'; reason: 'no_settings_directory' }
  | { status: 'failed'; reason: string };

type ExportScope = { projectId: string; workspaceId: string; goalId: string };
type ExportPlan = PlanRevisionDraft | PlanRevisionSnapshot;

function failedExport(reason: string): TaskbookExportV1 {
  return { status: 'failed', reason };
}

/** Writes one stage's book below `root` (`<settingsDirectory>/taskbooks`). */
export async function exportTaskbook(input: {
  root: string | null;                 // <settingsDirectory>/taskbooks；null = settings 未启用
  plan: ExportPlan;
  stageId: string;
  scope: ExportScope;
}): Promise<TaskbookExportV1> {
  if (input.root === null) return { status: 'skipped', reason: 'no_settings_directory' };

  const markdown = renderTaskbookMarkdown(input.plan, input.stageId);
  if (markdown === null) {
    return failedExport(`stage ${input.stageId} is not in plan ${input.plan.planId}@${input.plan.planRevision}`);
  }
  const path = join(input.root, taskbookRelativePath({
    projectId: input.scope.projectId,
    workspaceId: input.scope.workspaceId,
    goalId: input.scope.goalId,
    stageId: input.stageId,
    planId: input.plan.planId,
    planRevision: input.plan.planRevision,
  }));

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, markdown, 'utf8');
  } catch (error) {
    return failedExport(messageOf(error));
  }
  return { status: 'written', path };
}

/**
 * The Host wrapper: one book per stage. The real export root is checked against
 * every real workspace root before the directory is created or a file written;
 * a hit fails the whole batch with that workspace in the reason.
 */
export async function exportTaskbooksForPlan(input: {
  root: string | null;                 // the Host settingsDirectory; null = settings 未启用
  workspaceRoots: readonly string[];
  plan: ExportPlan;
  scope: ExportScope;
}): Promise<TaskbookExportV1[]> {
  const stageIds = input.plan.stages.map((stage) => stage.stageId);
  if (input.root === null) {
    return stageIds.map(() => ({ status: 'skipped', reason: 'no_settings_directory' }));
  }

  let settingsReal: string;
  try {
    settingsReal = await realpath(input.root);
  } catch (error) {
    return stageIds.map(() => failedExport(
      `the settings directory could not be resolved: ${messageOf(error)}`,
    ));
  }

  const workspaceReals: string[] = [];
  for (const workspaceRoot of input.workspaceRoots) {
    try {
      workspaceReals.push(await realpath(workspaceRoot));
    } catch (error) {
      return stageIds.map(() => failedExport(
        `the workspace root ${workspaceRoot} could not be resolved: ${messageOf(error)}`,
      ));
    }
  }

  const taskbookRoot = join(settingsReal, 'taskbooks');
  const insideInitial = workspaceReals.find((workspaceReal) => isPathWithin(workspaceReal, taskbookRoot));
  if (insideInitial !== undefined) {
    return stageIds.map(() => failedExport(`the taskbook root is inside the workspace ${insideInitial}`));
  }

  let exportRoot: string;
  try {
    await mkdir(taskbookRoot, { recursive: true });
    exportRoot = await realpath(taskbookRoot);
  } catch (error) {
    return stageIds.map(() => failedExport(
      `the taskbook root could not be prepared: ${messageOf(error)}`,
    ));
  }

  // A link may have appeared between the first check and mkdir.
  const insideCreated = workspaceReals.find((workspaceReal) => isPathWithin(workspaceReal, exportRoot));
  if (insideCreated !== undefined) {
    return stageIds.map(() => failedExport(`the taskbook root is inside the workspace ${insideCreated}`));
  }

  const results: TaskbookExportV1[] = [];
  for (const stageId of stageIds) {
    results.push(await exportTaskbook({
      root: exportRoot, plan: input.plan, stageId, scope: input.scope,
    }));
  }
  return results;
}

/**
 * The probe: no writes, no caching. `root` is the Host settingsDirectory. A
 * file that cannot be read is `missing` (the notice's "未写出" line), not
 * `not_configured`; only a probe that cannot run at all is `unavailable`.
 */
export async function exportBooks(input: {
  root: string | null;                 // the Host settingsDirectory; null = settings 未启用
  plan: ExportPlan;
  scope: ExportScope;
}): Promise<TaskbookExportReadV1> {
  if (input.root === null) return { status: 'not_configured' };

  const stages: TaskbookFileStatusV1[] = [];
  for (const stage of input.plan.stages) {
    const markdown = renderTaskbookMarkdown(input.plan, stage.stageId);
    const path = join(input.root, 'taskbooks', taskbookRelativePath({
      projectId: input.scope.projectId,
      workspaceId: input.scope.workspaceId,
      goalId: input.scope.goalId,
      stageId: stage.stageId,
      planId: input.plan.planId,
      planRevision: input.plan.planRevision,
    }));
    // The stage comes from this plan's own `stages`, so it always renders.
    const expectedBytes = Buffer.byteLength(markdown!, 'utf8');

    let actualBytes: number;
    try {
      actualBytes = (await readFile(path)).byteLength;
    } catch {
      stages.push({ state: 'missing', stageId: stage.stageId, path });
      continue;
    }
    if (actualBytes < expectedBytes) {
      stages.push({
        state: 'incomplete',
        stageId: stage.stageId,
        path,
        actualBytes,
        expectedBytes,
      });
    } else {
      stages.push({ state: 'written', stageId: stage.stageId, path, bytes: actualBytes });
    }
  }
  return { status: 'ready', stages };
}
