/**
 * 模块职责：121-112 的“正在跑的命令”登记，只在本 Host 进程的内存里。Work 和 Query 两种轮次的
 * 命令工具都在这里登记；Host 的读路由和到线请知悉读这一份。
 *
 * 设计边界：一个命令调用自己就是一个工具组（`dist/tools/registry/tool-registry.js`：只有全部是
 * 独立只读工具才并行，`shell` 和 `run_readonly_command` 都是 `process`），所以工具组前屏障就是它
 * 开始的时刻，组后屏障就是它结束的时刻。`before_tool` 钩子只记下调用的参数，不登记开始——被别的
 * 钩子拦下的调用没有组前屏障，不会登记。取消或失败的 Run 不经过组后屏障，由 `end()` 清掉。
 *
 * 关键流程：不落盘；Host 重启时旧 Run 的登记随旧进程一起没了，由启动对账处理（清单 B 4）。
 */
import type {
  BeforeToolHookDecision, BeforeToolHookInvocation, HookPort, ToolGroupBarrier,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import { isPos, isRecord } from '../../contracts/validation/common.js';
import { COMMAND_DEFAULT_EXPECTED_MS } from '../../contracts/resource-caps.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';

/** `before_tool` 钩子记下的一个命令调用的参数；组前屏障登记时补上开始时刻。 */
type CommandCall = Pick<RunningCommandV1, 'tool' | 'commandPreview' | 'expectedMs'>;

export type RunningCommandV1 = {
  run: { kind: 'run'; runRef: RunRef; taskId: string } | { kind: 'query'; queryRunRef: QueryRunRef };
  workspaceId: string; sessionRef: SessionRef; callId: string;
  /** `command` 的前 512 个字符，同 Kernel shell 定义的 `summarize`。 */
  tool: 'shell' | 'run_readonly_command'; commandPreview: string;
  /** agent 填的 `timeoutMs`（正整数），没填就是 `COMMAND_DEFAULT_EXPECTED_MS`。 */
  expectedMs: number;
  /** 平台的 `now()`。 */
  startedAt: string;
};

/** `executions/running-commands` 的一项：登记加上读时算出的已跑/到线事实。 */
export type RunningCommandViewV1 = RunningCommandV1 & { elapsedMs: number; lineMs: number; overLine: boolean };
export type RunningCommandsReadV1 = { items: RunningCommandViewV1[] };

export type RunningCommandsPort = {
  list(): RunningCommandV1[];
  watch(owner: Pick<RunningCommandV1, 'run' | 'workspaceId' | 'sessionRef'>): {
    /** before_tool：命令工具就把 callId 对应的参数记下，一律回 continue。 */
    hook: HookPort;
    /** 先问 inner；before_group 且 continue 才登记开始；after_group 一律去掉。 */
    barrier(inner?: ToolGroupBarrier): ToolGroupBarrier;
    /** 去掉这个 Run 剩下的。 */
    end(): void;
  };
};

/** 登记的键：一个 Run 的一个调用。`kind` 前缀让 Work Run 和 QueryRun 的 runId 不会相撞。 */
export function runningCommandKey(run: RunningCommandV1['run'], callId: string): string {
  return `${run.kind}:${run.kind === 'run' ? run.runRef.runId : run.queryRunRef.runId}:${callId}`;
}

export function createRunningCommands(now: () => string): RunningCommandsPort {
  const entries = new Map<string, RunningCommandV1>();

  return {
    list: () => [...entries.values()],

    watch(owner) {
      const run = structuredClone(owner.run);
      const pending = new Map<string, CommandCall>();
      const ownKeys = new Set<string>();

      const hook: HookPort = {
        hookId: 'running-commands', point: 'before_tool', priority: 0,
        async execute(invocation: BeforeToolHookInvocation): Promise<BeforeToolHookDecision> {
          const name = invocation.call.name;
          if (name !== 'shell' && name !== READONLY_COMMAND_TOOL_NAME) {
            return { point: 'before_tool', kind: 'continue' };
          }
          const args = invocation.call.arguments;
          const command = isRecord(args) ? args['command'] : undefined;
          const filled = isRecord(args) ? args['timeoutMs'] : undefined;
          pending.set(invocation.call.callId, {
            tool: name, commandPreview: typeof command === 'string' ? command.slice(0, 512) : '',
            expectedMs: isPos(filled) ? filled : COMMAND_DEFAULT_EXPECTED_MS,
          });
          return { point: 'before_tool', kind: 'continue' };
        },
      };

      const barrier = (inner?: ToolGroupBarrier): ToolGroupBarrier => async (invocation, options) => {
        const decision = inner === undefined
          ? { kind: 'continue' as const } : await inner(invocation, options);
        if (invocation.point === 'before_group' && decision.kind === 'continue') {
          for (const callId of invocation.callIds) {
            const call = pending.get(callId);
            if (call === undefined) continue;
            pending.delete(callId);
            const key = runningCommandKey(run, callId);
            ownKeys.add(key);
            entries.set(key, { run: structuredClone(run), workspaceId: owner.workspaceId,
              sessionRef: structuredClone(owner.sessionRef), callId, ...call, startedAt: now() });
          }
        } else if (invocation.point === 'after_group') {
          for (const callId of invocation.callIds) {
            pending.delete(callId);
            const key = runningCommandKey(run, callId);
            ownKeys.delete(key);
            entries.delete(key);
          }
        }
        return decision;
      };

      return {
        hook,
        barrier,
        end() {
          pending.clear();
          for (const key of ownKeys) entries.delete(key);
          ownKeys.clear();
        },
      };
    },
  };
}
