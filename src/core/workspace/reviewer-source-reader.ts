import { candidateWorkspaceIncludesPath } from './candidate-workspace-reader.js';

// The Candidate-range rule: lexical path checks plus the Candidate exclusions (no 4096 cap).
/** Shared with Runtime source tools: exact Candidate exclusions at every path segment. */
export function reviewerSourcePathAllowed(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && !/[\\:\0]/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..') && candidateWorkspaceIncludesPath(path);
}
