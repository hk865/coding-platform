/**
 * A line is a folder plus a branch: one checkout of the workspace's repository (decision 121-75, kls-design §2.3.1).
 * A workspace is one repository, recognised by its common git directory (`repoKey`) or, for another clone, by its
 * first commit; each checkout of it is a line. The line record (`Line@1`) lives in the project store, one per
 * (workspace, folder), and is the only place a line's folder, branch and fork point are kept. Only
 * `state/line-machine.ts` builds it.
 */
import { defineRecord, defineShape, f, type InferRecord } from './data-format.js';
import { id } from './data-format-refs.js';
import { canonicalJson } from './fingerprint.js';
import { checkShape } from './validation/data-format.js';

/** git: realpath(git rev-parse --git-common-dir); not git: realpath(the folder). */
export type RepoKey = string;
/** `folder` = realpath(the checkout root), `.workbench/` lives under it; `branch`: '' when not git, 'HEAD' when detached. */
export type LineRef = { repoKey: RepoKey; folder: string; branch: string };
/** A checkout as the Host probes it: its line and its first commit (null: not git, or a repository with no commit yet). */
export type CheckoutIdentity = LineRef & { firstCommit: string | null };
export type LineStatusV1 = 'open' | 'merged' | 'removed';
/** The line record's address; `lineRef` is `lineKeyOf(workspaceId, folder)`. */
export type WorkspaceLineRef = { aggregateType: 'Line'; projectId: string; workspaceId: string; lineRef: string };

/**
 * The key of a line: its workspace and its folder (lead ruling KLS-3a 2). Two clones on `main`, or two detached
 * worktrees, share a branch name but never a folder; a branch switch in one folder is the same line on another branch.
 */
export function lineKeyOf(workspaceId: string, folder: string): string {
  return canonicalJson([workspaceId, folder]);
}

/** The workspace rule (121-64): one repository, or two clones of the same first commit; two unknown ones are not one. */
export function sameCheckout(a: CheckoutIdentity, b: CheckoutIdentity): boolean {
  return a.repoKey === b.repoKey || (a.firstCommit !== null && a.firstCommit === b.firstCommit);
}

/** The line fields a Goal or a Session keeps. */
export const LineRefShape = defineShape({ name: 'LineRef', fields: { repoKey: id, folder: id, branch: f.string() } });

const WorkspaceLineRefShape = defineShape({
  name: 'WorkspaceLineRef', fields: { aggregateType: f.literal('Line'), projectId: id, workspaceId: id, lineRef: id },
});

export const LINE_BY_PROJECT_LOOKUP = 'line-by-project';

export const LineFormat = defineRecord({
  name: 'Line', schemaId: 'Line@1', aggregateType: 'Line',
  fields: {
    ref: f.ref(WorkspaceLineRefShape),
    revision: f.revision({ min: 1 }),
    ...LineRefShape.fields,
    firstCommit: f.nullable(id),
    /** The HEAD when the line was made (kls-design §2.3.2); null when not git or before the first commit. */
    forkPoint: f.nullable(id),
    status: f.enumOf(['open', 'merged', 'removed']),
    createdAt: f.isoTime(),
    closedAt: f.nullable(f.isoTime()),
  },
  rules: [
    value => {
      const line = value as { status: LineStatusV1; closedAt: string | null };
      return (line.status === 'open') === (line.closedAt === null) ? null
        : 'Line closedAt is set exactly when the line is not open';
    },
    value => {
      const line = value as { ref: WorkspaceLineRef; folder: string };
      return line.ref.lineRef === lineKeyOf(line.ref.workspaceId, line.folder) ? null
        : 'Line ref.lineRef is not its workspace and folder';
    },
  ],
  lookups: [{ name: LINE_BY_PROJECT_LOOKUP, equal: ['ref.projectId'] }],
});

export type LineSnapshot = InferRecord<typeof LineFormat.fields>;

/**
 * A kept line (a Session's, its create action's, a Run's workspace pin): required, `null` or a complete `LineRef`
 * (kls-design §2.3.1). The one check of that shape.
 */
export function lineRefProblem(value: unknown): string | null {
  if (value === undefined) return 'lineRef is required';
  if (value === null) return null;
  const problem = checkShape(LineRefShape, value, 'stored');
  return problem === null ? null : `lineRef: ${problem}`;
}

/** The line a Goal or a Session keeps: the record's folder, branch and repository, nothing of its address. */
export function lineRefOf(line: LineRef): LineRef {
  return { repoKey: line.repoKey, folder: line.folder, branch: line.branch };
}
