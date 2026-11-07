/**
 * 121-34: the syntax check of the Python files one Run changed. It only parses
 * (the resident single-file `ast` walk), never runs or imports the file, and it
 * asks the workspace for just those paths through one batch read. A parser that
 * is unsupported or unavailable supplies nothing: the check asks only for a
 * real Python syntax error.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import { languageOfPath } from './architecture-language-provider.js';
import type { NativeSingleFilePort } from './native-single-file.js';
import type { WorkspaceFile, WorkspaceResult } from './ports.js';
import type { WorkspaceToolsHandle } from './workspace-tools.js';

export type PythonSyntaxProblemV1 = { path: string; digest: string; line: number; message: string };

export async function changedPythonSyntaxProblems(deps: {
  readWorkspaceFiles: WorkspaceToolsHandle['readWorkspaceFiles'];
  lookup: NativeSingleFilePort['lookup'];
}, ctx: CoreCallContext, input: {
  workspace: WorkspaceRef; paths: readonly string[]; maxBytes: number;
}): Promise<PythonSyntaxProblemV1[]> {
  const paths = [...new Set(input.paths.filter(path => languageOfPath(path) === 'python'))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (paths.length === 0) return [];
  let batch: WorkspaceResult<WorkspaceResult<WorkspaceFile>[]>;
  try {
    batch = await deps.readWorkspaceFiles(ctx, { workspace: input.workspace, paths, maxBytes: input.maxBytes });
  } catch { return []; }
  if (batch.status !== 'ready') return [];
  const problems: PythonSyntaxProblemV1[] = [];
  for (const [index, file] of batch.value.entries()) {
    if (file.status !== 'ready') continue;
    const path = paths[index]!;
    const found = await deps.lookup(ctx, { language: 'python', path, text: file.value.content,
      digest: file.value.digest, mode: 'read' });
    if (found.status === 'syntax_error') {
      problems.push({ path, digest: file.value.digest, line: found.line, message: found.message });
    }
  }
  return problems.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.line - right.line);
}
