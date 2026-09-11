import type { ArtifactRef } from './artifact.js';
import type { RunRef } from './dispatch.js';
import type { PlanRevisionRef } from './plan.js';

/** Public feedback is a request for investigation, never a completion claim. */
type ExecutionFeedback = {
  kind: 'execution_feedback';
  category: 'missing_material' | 'source_conflict' | 'verification_failure';
  summary: string;
  question: string;
};
export type FeedbackSource = {
  runRef: RunRef; taskId: string; planRef: PlanRevisionRef;
  workspaceRevision: number; reportRef: ArtifactRef;
  sourcePin: import('./material-access.js').MaterialSourcePinV1;
};
type FeedbackResolution = {
  kind: 'feedback_resolution';
  action: 'continue' | 'supplement' | 'needs_decision' | 'blocked';
  availability: 'available' | 'proven_empty' | 'unavailable' | 'forbidden' | 'stale' | 'investigating';
  summary: string;
  material: string;
  sourcePaths: string[];
};
export const EXECUTION_FEEDBACK_GUIDE = `If missing material, uncertain source, a conflict with the task, or an unexecutable acceptance check prevents sound progress, report the concrete gap to the coordinator. End with one public JSON object {"kind":"execution_feedback","category":"missing_material"|"source_conflict"|"verification_failure","summary":"public facts (at most 1024 UTF-8 bytes)","question":"specific investigation needed (at most 2048 UTF-8 bytes)"}. Do not guess the missing rule, claim completion, or change acceptance criteria. The platform binds this response to the actual Run, Task, plan and workspace; do not invent those identities. Subsequent sourced material remains a reference, does not grant permissions and does not satisfy verification obligations.`;
export const FEEDBACK_RESPONSE_GUIDE = `Consume the attached execution feedback and current goal, plan and source. Investigate the concrete question using read-only source tools. Return JSON {kind:"feedback_resolution",action:"continue"|"supplement"|"needs_decision"|"blocked",availability:"available"|"proven_empty"|"unavailable"|"forbidden"|"stale"|"investigating",summary,material,sourcePaths:[workspace-relative paths actually read]}. Distinguish proven absence from unavailable, forbidden, stale or incomplete investigation. Provide the sourced rule and its applicable scope in material. Do not invent a source, authorization or acceptance. If a product decision is necessary, put concrete options, recommendation, impacts and independent work in material and use needs_decision. A response does not change the plan or satisfy evidence requirements.`;
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && Buffer.byteLength(v) <= max;
export function parseExecutionFeedback(body: string): ExecutionFeedback | null {
  let v; try { v = JSON.parse(body); } catch { return null; }
  if (v?.kind !== 'execution_feedback') return null;
  if (!['missing_material', 'source_conflict', 'verification_failure'].includes(v.category) || !bounded(v.summary, 1024) || !bounded(v.question, 2048)) throw Error('Invalid bounded execution feedback');
  return { kind: v.kind, category: v.category, summary: v.summary, question: v.question };
}
export function parseFeedbackResolution(body: string): FeedbackResolution {
  const v = JSON.parse(body);
  if (v?.kind !== 'feedback_resolution' || !['continue', 'supplement', 'needs_decision', 'blocked'].includes(v.action) ||
      !['available', 'proven_empty', 'unavailable', 'forbidden', 'stale', 'investigating'].includes(v.availability) ||
      !bounded(v.summary, 2048) || !bounded(v.material, 8192) || !Array.isArray(v.sourcePaths) || v.sourcePaths.length > 16 ||
      v.sourcePaths.some((p: unknown) => !bounded(p, 1024) || /[\\:\0]/.test(p) || p.startsWith('/') || p.split('/').some(x => !x || x === '..' || x === '.'))) throw Error('Invalid feedback resolution');
  if (['continue', 'supplement'].includes(v.action) && (!['available', 'proven_empty'].includes(v.availability) || !v.sourcePaths.length)) throw Error('Resolution lacks investigated sources');
  return v as FeedbackResolution;
}
