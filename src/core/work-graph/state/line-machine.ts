/**
 * The only writer of the line record (`Line@1`, `src/contracts/line.ts`). A line is born `open` at revision 1 with
 * the HEAD it forked from; a branch switch in its folder moves it to that branch (`nextLineIdentity`), and its end
 * (`nextLineStatus` judges, `nextLineClosed` writes) makes it `merged` or `removed` for good (KLS-3b).
 */
import { lineKeyOf, type CheckoutIdentity, type LineSnapshot } from '../../../contracts/line.js';

export function newLineRecord(input: {
  projectId: string; workspaceId: string; line: CheckoutIdentity; forkPoint: string | null; now: string;
}): LineSnapshot {
  return {
    ref: { aggregateType: 'Line', projectId: input.projectId, workspaceId: input.workspaceId,
      lineRef: lineKeyOf(input.workspaceId, input.line.folder) },
    revision: 1,
    repoKey: input.line.repoKey,
    folder: input.line.folder,
    branch: input.line.branch,
    firstCommit: input.line.firstCommit,
    forkPoint: input.forkPoint,
    status: 'open',
    createdAt: input.now,
    closedAt: null,
  };
}

/** The git and registration facts the Host reads for one line; the decision never touches git or the clock. */
export type LineStatusFacts = {
  /** The workspace's first line (`readLines` order), which the others merge into. */
  isBaseLine: boolean;
  /** The workspace registration carries `removedAt` (withdrawn or removed). */
  workspaceRemoved: boolean;
  /** The line's checkout is there; the Host says false only once it is surely gone (lead 11-14 Q4). */
  folderExists: boolean;
  /** The line's branch still resolves, or its folder still holds a branch (see the Host's `sweepLines`). */
  branchExists: boolean;
  /** The folder's HEAD now; null before the first commit or when git cannot read it. */
  head: string | null;
  /** The line's fork point (`line.forkPoint`); null when it was made before its first commit. */
  forkPoint: string | null;
  /** The base line folder's HEAD contains `head`: null when git cannot tell. */
  ancestorOfBase: boolean | null;
  /** No uncommitted code or knowledge file in the line's folder: null when git cannot tell. */
  worktreeClean: boolean | null;
};

/**
 * kls-design §2.3.2: how an open line ends, or `null` while it stays open. A removed workspace's lines
 * end with it (121-90), and so does a line whose folder or branch is gone. A line other than the base one is merged
 * once its HEAD moved off its fork point into the base line's history with nothing left uncommitted; a line just
 * opened (HEAD at its fork point) or one with no fork point (made before any commit) is not, and the base line never
 * merges into itself. A fact git could not answer (null) judges nothing. A closed line never reopens.
 */
export function nextLineStatus(line: LineSnapshot, facts: LineStatusFacts): 'merged' | 'removed' | null {
  if (line.status !== 'open') return null;
  if (facts.workspaceRemoved || !facts.folderExists || !facts.branchExists) return 'removed';
  if (facts.isBaseLine || facts.head === null || facts.forkPoint === null || facts.head === facts.forkPoint) return null;
  return facts.ancestorOfBase === true && facts.worktreeClean === true ? 'merged' : null;
}

/**
 * The same folder on another branch (or with another first commit): the same line (lead ruling KLS-3a 2), forked
 * anew from the HEAD at the switch (KLS-3b ruling 7), so the switch itself never reads as merged.
 */
export function nextLineIdentity(current: LineSnapshot, input: {
  branch: string; firstCommit: string | null; forkPoint: string | null;
}): LineSnapshot {
  return { ...current, revision: current.revision + 1, branch: input.branch, firstCommit: input.firstCommit,
    forkPoint: input.forkPoint };
}

/** The line's end: `merged` and `removed` are both closed at `at`. */
export function nextLineClosed(current: LineSnapshot, status: 'merged' | 'removed', at: string): LineSnapshot {
  return { ...current, revision: current.revision + 1, status, closedAt: at };
}
