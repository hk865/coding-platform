import type { RunSnapshot } from './dispatch.js';
export type RoleOutputWitnessChannelV1 =
  /** 该 Run 是独立审阅运行，正式 ReviewWork 已把原报告绑定到本 Run。 */
  | 'run-bound-review-output'
  /** 本 Run 的 canonical PatchRecord（writer 链的实现结果记录）。 */
  | 'run-bound-patch-record'
  /** 本 Run 的 canonical IntegrationResult 记录。 */
  | 'run-bound-integration-result'
  /** 同一条 IntegrationResult 记录里已落账的冲突面（conflicts／escalate／explanation）。 */
  | 'run-bound-conflict-surface'
  /** 本 Run 的 canonical ExecutionNote（工作留痕，body-first）。 */
  | 'run-bound-execution-note'
  | null;


export type RunOutputWitness = { channel: RoleOutputWitnessChannelV1; fact: string } | { channel: RoleOutputWitnessChannelV1; unavailable: string };
export interface RunOutputMaterialPort { runOutputWitness(run: RunSnapshot, channel: Exclude<RoleOutputWitnessChannelV1, null>): Promise<RunOutputWitness>; }
