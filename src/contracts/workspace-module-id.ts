/**
 * The ONE module-id grammar of the project view, beside the path grammar
 * (`workspace-path.ts`). A module of the main workspace keeps the id the model
 * gave; one that itself begins with `/@ws:` is escaped as `/@ws:#` plus the
 * encoded id. A module of another workspace is `/@ws:` + the encoded workspace
 * id + `/` + the encoded module id. `encodeURIComponent` encodes `/` and `#`, so
 * the mapping is injective for any id: no character-set rule is put on the
 * model's ids.
 *
 * The "file frame" writes a reference as seen from the workspace the file (or
 * the caller) belongs to: that workspace's own ids and paths stay bare and
 * every other workspace, the project's main one included, carries the prefix.
 * The four frame functions only call the two id functions and the path
 * functions with that workspace as the main one; there is no second grammar.
 */
import type { ModuleRef } from './core/identity.js';
import { WORKSPACE_PROJECT_PATH_PREFIX, qualifyProjectPath, resolveStoredProjectPath } from './workspace-path.js';

const ESCAPED_MAIN_PREFIX = `${WORKSPACE_PROJECT_PATH_PREFIX}#`;

/** The project-view id of `moduleId` in `workspaceId`. */
export function projectModuleId(workspaceId: string, moduleId: string, mainWorkspaceId: string): string {
  if (workspaceId === mainWorkspaceId) {
    return moduleId.startsWith(WORKSPACE_PROJECT_PATH_PREFIX) ? ESCAPED_MAIN_PREFIX + encodeURIComponent(moduleId) : moduleId;
  }
  return `${WORKSPACE_PROJECT_PATH_PREFIX}${encodeURIComponent(workspaceId)}/${encodeURIComponent(moduleId)}`;
}

/**
 * The reverse; `workspaceId: null` is the main workspace. A prefix without its
 * `/` or with an undecodable part is not an id of this grammar and throws: an
 * entry that takes model input catches it as `invalid`.
 */
export function rawModuleId(projectViewId: string): { workspaceId: string | null; moduleId: string } {
  if (projectViewId.startsWith(ESCAPED_MAIN_PREFIX)) {
    return { workspaceId: null, moduleId: decodeURIComponent(projectViewId.slice(ESCAPED_MAIN_PREFIX.length)) };
  }
  if (!projectViewId.startsWith(WORKSPACE_PROJECT_PATH_PREFIX)) return { workspaceId: null, moduleId: projectViewId };
  const rest = projectViewId.slice(WORKSPACE_PROJECT_PATH_PREFIX.length);
  const slash = rest.indexOf('/');
  const workspaceId = slash < 1 ? '' : decodeURIComponent(rest.slice(0, slash));
  const moduleId = slash < 1 ? '' : decodeURIComponent(rest.slice(slash + 1));
  if (workspaceId === '' || moduleId === '') throw new Error(`invalid workspace module id: ${projectViewId}`);
  return { workspaceId, moduleId };
}

export function projectModuleRef(projectId: string, workspaceId: string, moduleId: string,
  mainWorkspaceId: string): ModuleRef {
  return { projectId, moduleId: projectModuleId(workspaceId, moduleId, mainWorkspaceId) };
}

export function rawModuleRef(ref: ModuleRef): { workspaceId: string | null; moduleId: string } {
  return rawModuleId(ref.moduleId);
}

/** A project-view id written in the frame of `fileWorkspaceId`. */
export function fileModuleId(projectViewId: string, fileWorkspaceId: string, mainWorkspaceId: string): string {
  const raw = rawModuleId(projectViewId);
  return projectModuleId(raw.workspaceId ?? mainWorkspaceId, raw.moduleId, fileWorkspaceId);
}

/** An id written in the frame of `fileWorkspaceId` (a file's or a caller's), back to the project view. */
export function projectModuleIdOfFile(fileId: string, fileWorkspaceId: string, mainWorkspaceId: string): string {
  const raw = rawModuleId(fileId);
  return projectModuleId(raw.workspaceId ?? fileWorkspaceId, raw.moduleId, mainWorkspaceId);
}

/** A project path written in the frame of `fileWorkspaceId`. */
export function fileProjectPath(projectPath: string, fileWorkspaceId: string, mainWorkspaceId: string): string {
  const stored = resolveStoredProjectPath(projectPath, mainWorkspaceId);
  return qualifyProjectPath(stored.workspaceId, stored.path, fileWorkspaceId);
}

/** A path written in the frame of `fileWorkspaceId`, back to the project view. */
export function projectPathOfFile(filePath: string, fileWorkspaceId: string, mainWorkspaceId: string): string {
  const stored = resolveStoredProjectPath(filePath, fileWorkspaceId);
  return qualifyProjectPath(stored.workspaceId, stored.path, mainWorkspaceId);
}
