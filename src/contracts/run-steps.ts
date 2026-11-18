/**
 * P1（决定 121-147）：一次 Work Run 或一次 Query 轮的步骤读 `executions/steps`。
 *
 * 读的是这一次固定 Kernel Turn 的原始记录：模型回复里的思考（只认已保存的 `reasoningContent`）
 * 和每一次工具调用，按 Kernel 位置排好、分页。头行数字（`summary`）是整个 Turn 的，不随分页变。
 * 只读，不写任何记录；截文字只为一页有界，不为脱敏。
 */
import type { SessionRef } from './core/identity.js';
import type { RunRef } from './dispatch.js';
import type { QueryRunRef } from './query-job.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RunActivityUnknownReason } from './run-activity.js';
import type { BoundedTextV1 } from './continuation-brief.js';

/** 一页最多这么多步。 */
export const RUN_STEPS_PAGE_LIMIT = 50;
/** 思考从头取这么多 UTF-8 字节；超了 truncated 为真，P2 写“思考较长，只显示前 16 KB”。 */
export const RUN_STEP_THINK_BYTES = 16000;
/** 消息文字从头取这么多 UTF-8 字节。 */
export const RUN_STEP_TEXT_BYTES = 4000;
/** 路径、命令行、工具目标、错误消息从头取这么多字节。 */
export const RUN_STEP_TARGET_BYTES = 500;
/** 命令的 stdout、stderr 各取末尾这么多字节（用 streamTail，Kernel 已截的带标记）。 */
export const RUN_STEP_OUTPUT_TAIL_BYTES = 2000;

export type RunStepsRequestV1 = {
  ref: RunRef | QueryRunRef;
  /** 只要位置大于它的步；null 从头读。 */
  after: number | null;
  /** 1..RUN_STEPS_PAGE_LIMIT。 */
  limit: number;
};

export type RunStepStatusV1 = 'running' | 'done' | 'failed' | 'cancelled' | 'unknown';

/** 一次工具调用的公共部分。position 是它的 tool.started 的位置。 */
type CallStepBaseV1 = {
  position: number; callId: string; tool: string; status: RunStepStatusV1;
  startedAt: string; endedAt: string | null;
  error: { code: string; message: BoundedTextV1 } | null;
};

export type RunStepV1 =
  | { kind: 'think'; position: number; at: string; text: BoundedTextV1 }
  | (CallStepBaseV1 & { kind: 'read'; path: string | null })
  | (CallStepBaseV1 & { kind: 'edit'; path: string | null; lines: { added: number; deleted: number } | null })
  | (CallStepBaseV1 & { kind: 'command'; command: BoundedTextV1 | null; exitCode: number | null;
      stdout: BoundedTextV1 | null; stderr: BoundedTextV1 | null })
  | (CallStepBaseV1 & { kind: 'message';
      to: { kind: 'session'; sessionRef: SessionRef } | { kind: 'person' } | { kind: 'reply'; messageRef: SessionMessageRef } | null;
      text: BoundedTextV1 | null })
  | (CallStepBaseV1 & { kind: 'tool'; target: BoundedTextV1 | null });

/** 整个 Turn 的头行数字，不随分页变。 */
export type RunStepsSummaryV1 = {
  startedAt: string; lastAt: string; live: boolean;
  /** 成功读过的不同路径数。 */
  reads: number;
  /** 改动文件，字段名和算法照活动视图（activity-read-helpers.ts 的 changedFiles）：definite、possible 是列出的个数。 */
  changedFiles: { definite: number; possible: number; possiblyIncomplete: boolean };
  /** 开始过的命令调用数（shell + run_readonly_command），执行前被拒的也算。 */
  commands: number;
};

export type RunStepsReadV1 =
  | { kind: 'not_started' }
  | { kind: 'not_entered' }
  | { kind: 'unknown'; reason: RunActivityUnknownReason; detail: string }
  | { kind: 'steps'; summary: RunStepsSummaryV1; steps: RunStepV1[];
      /** 后面还有步时，是这一页最后一步的位置；否则 null。 */
      next: number | null;
      /** 整个 Turn 里最早一个 running 步的位置；没有就是 null。正在跑的块从它前一位重读即可刷新。 */
      runningFrom: number | null };
