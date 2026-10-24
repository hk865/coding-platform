/**
 * The one parser of the versioned initial-planning answer (v2), pure.
 *
 * It lives in `contracts/` because the Plan owner in WorkGraph `tasks/` and the
 * secretary answer check in WorkGraph `queries/` read the same outer protocol,
 * and `queries/` may not import `tasks/`. It imports contracts only.
 */
import { rejected } from './core/rejections.js';
import type { CoreRejection } from './core/results.js';
import { isRecord, nonEmpty } from './validation/common.js';
import type { InitialPlanAssignment, InitialPlanningResponseV2 } from './initial-planning.js';

/**
 * The ONE v2 JSON parse. It judges only the outer protocol shape; the existing
 * Plan codec/validators keep judging task/obligation/DAG/assignment meaning, so
 * this parser never restates them and never repairs the model's plan.
 */
export function parseInitialPlanningResponseV2(
  text: string,
): { status: 'parsed'; response: InitialPlanningResponseV2 } | CoreRejection {
  if (typeof text !== 'string' || text.length === 0) {
    return rejected('invalid', 'the initial-planning answer is empty');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    return rejected('invalid', 'the initial-planning answer is not valid JSON');
  }
  if (!isRecord(parsed)) return rejected('invalid', 'the initial-planning answer must be one JSON object');
  if (parsed['schemaVersion'] !== 2) return rejected('invalid', 'the initial-planning answer must carry schemaVersion 2');
  const summary = parsed['summary'];
  if (typeof summary !== 'string') return rejected('invalid', 'the initial-planning answer must carry a summary string');
  if (parsed['kind'] === 'needs_decision') {
    const questions = parsed['questions'];
    if (!Array.isArray(questions) || !questions.every(nonEmpty)) {
      return rejected('invalid', 'a needs_decision answer must carry a non-empty questions array');
    }
    return { status: 'parsed', response: {
      schemaVersion: 2, kind: 'needs_decision', summary, questions: [...questions] as string[] } };
  }
  if (parsed['kind'] !== 'plan') {
    return rejected('invalid', 'the initial-planning answer kind must be plan or needs_decision');
  }
  const plan = parsed['plan'];
  if (!isRecord(plan)) return rejected('invalid', 'a plan answer must carry a plan object');
  if (plan['schemaVersion'] !== 2) return rejected('invalid', 'the plan body must carry schemaVersion 2');
  for (const key of ['stages', 'tasks', 'obligations'] as const) {
    if (!Array.isArray(plan[key])) return rejected('invalid', `the plan body must carry a ${key} array`);
  }
  if (!isRecord(plan['taskHierarchy']) || !Array.isArray(plan['taskHierarchy']['parentOf'])) {
    return rejected('invalid', 'the plan body must carry taskHierarchy.parentOf');
  }
  if (!isRecord(plan['executionDag']) || !Array.isArray(plan['executionDag']['dependsOn'])) {
    return rejected('invalid', 'the plan body must carry executionDag.dependsOn');
  }
  if (plan['assignments'] !== undefined) {
    if (!Array.isArray(plan['assignments']) || !plan['assignments'].every(validAssignment)) {
      return rejected('invalid', 'the plan assignments must be complete task/role/instruction entries');
    }
  }
  for (const key of ['taskRelations', 'inputRequirements'] as const) {
    if (plan[key] !== undefined && !Array.isArray(plan[key])) {
      return rejected('invalid', `the plan ${key} must be an array when present`);
    }
  }
  return { status: 'parsed', response: parsed as unknown as InitialPlanningResponseV2 };
}

function validAssignment(value: unknown): value is InitialPlanAssignment {
  return isRecord(value) && nonEmpty(value['taskId']) && nonEmpty(value['role']) && nonEmpty(value['instruction']);
}
