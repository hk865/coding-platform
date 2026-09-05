/**
 * P1-03 Control entry: dispatch readiness (read-only eligibility evaluation).
 */
import type {
  DispatchReadinessQuery,
  DispatchReadinessResult,
} from "../contracts/dispatch.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function evaluateDispatchReadiness(
  deps: ControlEngineDeps,
  query: DispatchReadinessQuery,
): Promise<DispatchReadinessResult> {
  void deps;
  void query;
  return Promise.reject(new Error("P1-03: evaluateDispatchReadiness not implemented yet"));
}
