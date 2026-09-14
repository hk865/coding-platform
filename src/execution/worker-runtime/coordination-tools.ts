/**
 * 协调 Host 工具（协作通信，Agent 归因与工具边界）：模型**唯一**能发起协作通信的入口。
 *
 * ── 身份为什么不在模型手里 ────────────────────────────────────────────────────
 * 每个工具的 inputSchema 都是 `.strict()`，字段里**没有** agentInstanceId / participationRef /
 * roleBinding / runRef / workContextRef，也没有任何可以指定"以谁的身份"的字段。身份来自构造本
 * 工具集时宿主绑定的 `CoordinationToolAccessPort.principal`（由 canonical 事实派生）。
 * 模型只能提供内容参数，因此它既不能填写、也不能替换 principal。
 *
 * ── 受理才算成功（body-first）────────────────────────────────────────────────
 * handler 只把 `access.*` 的结果原样转成工具结果：adapter 内部先写 ArtifactVault，再经 Control
 * 的正式写入口提交，**只有拿到提交回执**才返回 accepted。因此不存在"先回 ok 再补交"的窗口。
 *
 * ── 能力声明：改平台状态，不是只读；真正的准入在平台侧（协议约束 2.3）─────────────
 * 这些工具会**修改平台状态**（登记请求/报告/订阅/等待），**不**读写模型的工作区：
 *   · 每条工具描述里都明写 **"This tool MODIFIES platform canonical state … It does NOT read or
 *     write the model workspace, and it grants no file-write or shell permission."** —— 读者与模型
 *     都不应把它们当成只读能力（描述与实际行为一致，见 PLATFORM_EFFECT_NOTE）。
 *   · **真正的准入点是平台侧的能力校验**：宿主在执行前解析"这个 Run 是否被授予协调能力"
 *     （`coordination-capability.ts`，依据是账本里的参与关系/接续受理事实），而且
 *     **每一个写操作**都会在 `vault.put` 与 Control 写入口**之前**再校验一次
 *     （`coordination-tool-access.ts` 的 `capabilityDenial`）。未授予 → 拒绝并给可读原因，
 *     不静默降级、不回退成"只读成功"。
 *   · effectClass **不是** `read_only`：它是 `workspace_write`（"非只读、有确定性副作用"）。
 *     内核的 `ToolEffectClass` 只有 read_only / workspace_write / process 三档，没有"平台状态
 *     写入"这一档——这是**内核词表的限制**，不是"这些工具是只读的"；平台用自有的
 *     `platformEffect: 'coordination_state'` 标记补足语义。把它们标成 read_only 来换取放行，
 *     正是协议约束 2.3 明令禁止的"伪装成只读工具绕过现有检查"，本实现不做这件事。
 *
 *     **不新增 effectClass。** 内核的放行判据只有宿主
 *     `hostAuthorizedTools` 一条（`permission-policy.ts` 的 `effectClass !== 'read_only' &&
 *     hostAuthorizedTools.has(tool)`），新增一个名为 `platform_state_write` 的取值**不改变任何
 *     准入强度**，却要再动三个内核文件并重建 dist；因此现状（`workspace_write` +
 *     `requiredCapabilities: []` + `independentReadOnly: false` + 平台自有 `platformEffect`）
 *     就是最终方案，上面的词表缺口如实保留在案。
 *   · requiredCapabilities 为空：**不申请任何沙箱能力**（协调能力 ≠ 工作区读写、≠ 文件写、≠ shell）。
 *   · independentReadOnly 一律 false（内核规则：只有 read_only 工具可以声明它）。
 * 不改变的安全边界：凭据/隐藏路径、内置 read/check/edit/shell 的规则、未授权的未知操作
 * 默认拒绝，全部继续优先。
 *
 * ── 拒绝发生在哪一层（三层，各自独立可核对）──────────────────────────────────
 *   层 1 装配层（fail-closed）：宿主没授予协调能力 → 运行入口**根本不注入**这些工具，
 *        本 Run 的 enabledNames / 实际模型请求的工具清单里没有 `coordination_*`。
 *        模型即使硬要调用，内核也只会回 `unknown_tool`（工具未注册）。
 *        用例：coordination-capability.test.ts「未授予的 Run…」。
 *   层 2 Adapter 调用期：访问面只能带着**明确授予**被构造；每个**写**操作在 `vault.put` 与
 *        Control 写入口**之前**还会再校验一次授予是否仍然成立（coordination-tool-access.ts 的
 *        `capabilityDenial`）→ 失效即 `rejected/not_granted`，零平台写入。
 *        注意：**Adapter 内部确实有这一次能力校验**，不是"只有装配层管"。
 *        用例：coordination-capability.test.ts「每个写操作在动 Vault/Control 之前校验能力…」。
 *   层 3 内核策略层：即使工具被注入并启用，只要没进宿主的 `hostAuthorizedTools`，
 *        内核按"未授权的未知操作"拒绝（`permission_denied`），handler **不执行**。
 *        用例：coordination-capability.test.ts「内核策略层…」。
 */
import { toolSchema as z, type ToolDefinition } from '../../../vendor/coding-agent/dist/public-api.js';

/** 工具 handler 的返回类型（由内核的 ToolDefinition 契约取得，不自己复述形状）。 */
type ToolOutcome = Awaited<ReturnType<ToolDefinition['handler']['execute']>>;

/**
 * 平台自己的**效果标记**：这个工具改的是**平台状态**（协调请求/报告/订阅/等待），不是工作区。
 *
 * 为什么单独一个字段：内核 `ToolEffectClass` 是封闭三值（read_only / workspace_write / process），
 * 没有"平台状态写入"这一档（加一档要改内核公共类型，此规则不擅自改）。因此本平台在工具定义上
 * 增加这个**自有的、机器可读**的标记：宿主授权名单与用例都读它，声明与能力因此对得上，
 * 而不是靠把工具标成只读蒙过检查。
 */
export type CoordinationPlatformEffect = 'coordination_state';
type CoordinationToolDefinition = ToolDefinition & { readonly platformEffect: CoordinationPlatformEffect };
import type { CoordinationToolAccessPort, CoordinationToolOutcomeV1, CoordinationToolOperationV1 } from '../../contracts/coordination-tools.js';
import { REQUEST_STATEMENT_MAX_BYTES, SUBSCRIPTION_MAX_TOPICS, WAIT_MAX_CONDITIONS } from '../../contracts/coordination.js';

const effects = { sideEffect: 'none' as const, changedPaths: [], workspaceRevision: null, artifactRefs: [] };

/**
 * 每个**写**工具描述里都明写的效果声明（协议约束 2.3 的"如实标注"）。
 *
 * 为什么必须写在模型能看到的描述里：模型要能分辨"这个工具会改平台状态"与"它给我文件写权限"
 * 是两件事。写清 workspace 影响 = 无，也避免读者把它当成只读能力。
 */
const PLATFORM_EFFECT_NOTE = ' This tool MODIFIES platform canonical state (it registers durable communication facts through the host adapter). It does NOT read or write the model workspace, and it grants no file-write or shell permission.';
const EMPTY_SUMMARY = { paths: [], cwd: null, commandPreview: null };

/** 内容键：确定性派生聚合 id 的依据（同一 Run 内重复调用 = 幂等 replay）。 */
const keySchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).default('1');

/** `accepted` 只来自 Control 的提交回执；这里只做形状转换，不重新判断受理与否。 */
function outcomeResult(callId: string, outcome: CoordinationToolOutcomeV1, operation: CoordinationToolOperationV1): ToolOutcome {
  if (outcome.status === 'accepted') {
    return {
      schemaVersion: 1, callId, status: 'success',
      output: [{ kind: 'json', value: {
        operation, accepted: true, replayed: outcome.replayed,
        references: outcome.references, summary: outcome.summary,
      } as never }],
      effects,
    };
  }
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message: '正式受理未通过（' + outcome.code + '）：' + outcome.issues.join('; '), retryable: false },
    output: [{ kind: 'json', value: { operation, accepted: false, code: outcome.code, issues: outcome.issues } as never }],
    effects,
  };
}

function cancelledResult(callId: string): ToolOutcome {
  return { schemaVersion: 1, callId, status: 'cancelled', reason: 'Coordination call cancelled', output: [], effects };
}

function failureResult(callId: string, message: string): ToolOutcome {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code: 'execution_failed', message, retryable: false },
    output: [], effects,
  };
}

/**
 * 构造本次 Run 的协调工具集。`assertCurrent` 由运行入口注入（运行被取消/材料失效时
 * 必须在调用**之前**拒绝），与既有 reviewer 材料工具同一手法。
 */
export function createCoordinationTools(access: CoordinationToolAccessPort, assertCurrent: () => Promise<void>): CoordinationToolDefinition[] {
  const run = async (
    call: { callId: string; arguments: unknown },
    options: { signal: AbortSignal },
    operation: CoordinationToolOperationV1,
    invoke: () => Promise<CoordinationToolOutcomeV1>,
  ): Promise<ToolOutcome> => {
    if (options.signal.aborted) return cancelledResult(call.callId);
    try {
      await assertCurrent();
      const outcome = await invoke();
      if (options.signal.aborted) return cancelledResult(call.callId);
      return outcomeResult(call.callId, outcome, operation);
    } catch (error) {
      if (options.signal.aborted) return cancelledResult(call.callId);
      return failureResult(call.callId, error instanceof Error ? error.message : '协调工具不可用');
    }
  };
  const principalNote = 'The caller identity (agent instance, work, participation, role binding and run) is bound by the host; it is not an argument.';

  return [
    {
      name:'report_architecture_conflict',
      description:'Report an interface conflict between at least two existing work packages before tests fail. Supply precise affected modules/interfaces/paths, the conflict and recommended candidate description. The host fixes source Run, Plan, baseline and full Work set. New architectural choices must wait for human decision; independent work may continue under current authority. This tool never activates a baseline. '+principalNote+PLATFORM_EFFECT_NOTE,
      inputSchema:z.object({key:keySchema,description:z.string().min(1).max(4096),proposedDescription:z.string().min(1).max(4096),affectedWorkIds:z.array(z.string().min(1).max(200)).min(2).max(64),affectedRefs:z.object({moduleRefs:z.array(z.string().min(1).max(256)).max(64),interfaceRefs:z.array(z.string().min(1).max(256)).max(64),pathRefs:z.array(z.string().min(1).max(512)).max(64)}).strict()}).strict(),
      effectClass:'workspace_write',requiredCapabilities:[],platformEffect:'coordination_state',defaultTimeoutMs:20000,outputLimitBytes:16*1024,independentReadOnly:false,
      summarize:()=>EMPTY_SUMMARY,
      handler:{execute:(call,options)=>run(call,options,'architecture_report',async()=>access.reportArchitecture?access.reportArchitecture(call.arguments as import('../../contracts/coordination-tools.js').ArchitectureReportInput):{status:'rejected',operation:'architecture_report',code:'unavailable',issues:['当前宿主未配置架构报告入口']})},
    },
    {
      name: 'coordination_request',
      description: 'Send a formally admitted directed request from this run\'s work to another work in the same workspace. The request body is stored first and the request is only reported as accepted once Control has committed it. Returns the exact requestId and the deliveryId that carries the statement body to the target work. ' + principalNote + PLATFORM_EFFECT_NOTE,
      inputSchema: z.object({
        toWorkId: z.string().min(1).max(200),
        statement: z.string().min(1).max(REQUEST_STATEMENT_MAX_BYTES),
        body: z.string().min(1),
        key: keySchema,
      }).strict(),
      effectClass: 'workspace_write', requiredCapabilities: [], platformEffect: 'coordination_state',
      defaultTimeoutMs: 20000, outputLimitBytes: 16 * 1024, independentReadOnly: false,
      summarize: () => EMPTY_SUMMARY,
      handler: { execute: (call, options) => {
        const input = call.arguments as { toWorkId: string; statement: string; body: string; key: string };
        return run(call, options, 'request', () => access.request(input));
      } },
    },
    {
      name: 'coordination_respond',
      description: 'Register the bounded report body as the response to a directed request addressed to this run\'s work. The body is stored first; the response is only reported as accepted once Control has committed it. ' + principalNote + PLATFORM_EFFECT_NOTE,
      inputSchema: z.object({
        requestId: z.string().min(1).max(200),
        body: z.string().min(1),
        key: keySchema,
      }).strict(),
      effectClass: 'workspace_write', requiredCapabilities: [], platformEffect: 'coordination_state',
      defaultTimeoutMs: 20000, outputLimitBytes: 16 * 1024, independentReadOnly: false,
      summarize: () => EMPTY_SUMMARY,
      handler: { execute: (call, options) => {
        const input = call.arguments as { requestId: string; body: string; key: string };
        return run(call, options, 'respond', () => access.respond(input));
      } },
    },
    {
      name: 'coordination_subscribe',
      description: 'Subscribe this work to exact event topics ("DirectedRequestSent", "DirectedRequestResponded", "WorkParticipationEnded", "WaitConditionSatisfied"). Default starts now; an explicit ledger startCursor requests bounded historical catchup before live delivery. ' + principalNote + PLATFORM_EFFECT_NOTE,
      inputSchema: z.object({
        topics: z.array(z.string().min(1).max(64)).min(1).max(SUBSCRIPTION_MAX_TOPICS),
        startCursor: z.string().regex(/^c[0-9]{10}$/).nullable().optional(),
        key: keySchema,
      }).strict(),
      effectClass: 'workspace_write', requiredCapabilities: [], platformEffect: 'coordination_state',
      defaultTimeoutMs: 20000, outputLimitBytes: 16 * 1024, independentReadOnly: false,
      summarize: () => EMPTY_SUMMARY,
      handler: { execute: (call, options) => {
        const input = call.arguments as { topics: string[]; startCursor?: string | null; key: string };
        return run(call, options, 'subscribe', () => access.subscribe(input));
      } },
    },
    {
      name: 'coordination_wait',
      description: 'Wait on exact deliveryIds or requestIds. Default all requires every condition. any waits for the first optional response report actually delivered to this work (subscribe to DirectedRequestResponded first); it never replaces required verification or cancels other work. After this run publicly ends, at most one successor is admitted with the selected report. ' + principalNote + PLATFORM_EFFECT_NOTE,
      inputSchema: z.object({
        mode: z.enum(['all', 'any']).optional(),
        deliveryIds: z.array(z.string().min(1).max(200)).max(WAIT_MAX_CONDITIONS).default([]),
        requestIds: z.array(z.string().min(1).max(200)).max(WAIT_MAX_CONDITIONS).default([]),
        deadlineAt: z.string().min(1).max(64).nullable().default(null),
        key: keySchema,
      }).strict(),
      effectClass: 'workspace_write', requiredCapabilities: [], platformEffect: 'coordination_state',
      defaultTimeoutMs: 20000, outputLimitBytes: 16 * 1024, independentReadOnly: false,
      summarize: () => EMPTY_SUMMARY,
      handler: { execute: (call, options) => {
        const input = call.arguments as { mode?: 'all' | 'any'; deliveryIds: string[]; requestIds: string[]; deadlineAt: string | null; key: string };
        return run(call, options, 'wait', () => access.wait(input));
      } },
    },
    {
      name: 'coordination_cancel',
      description: 'Cancel one of this run\'s work own communication objects (directed_request / subscription / wait). Cancellation is desired-state-first: it is only reported as accepted once Control has committed the cancellation. ' + principalNote + PLATFORM_EFFECT_NOTE,
      inputSchema: z.object({
        target: z.enum(['directed_request', 'subscription', 'wait']),
        targetId: z.string().min(1).max(200),
        reason: z.string().min(1).max(1024),
      }).strict(),
      effectClass: 'workspace_write', requiredCapabilities: [], platformEffect: 'coordination_state',
      defaultTimeoutMs: 20000, outputLimitBytes: 16 * 1024, independentReadOnly: false,
      summarize: () => EMPTY_SUMMARY,
      handler: { execute: (call, options) => {
        const input = call.arguments as { target: 'directed_request' | 'subscription' | 'wait'; targetId: string; reason: string };
        return run(call, options, 'cancel', () => access.cancel(input));
      } },
    },
    {
      name: 'coordination_mailbox',
      description: 'Read the bounded mailbox of this run\'s work: its directed requests, deliveries, subscriptions and waits with their exact ids. Use it to reference the exact object in later calls. This tool only reads; it changes no platform state and no workspace. ' + principalNote,
      inputSchema: z.object({}).strict(),
      effectClass: 'workspace_write', requiredCapabilities: [], platformEffect: 'coordination_state',
      defaultTimeoutMs: 20000, outputLimitBytes: 32 * 1024, independentReadOnly: false,
      summarize: () => EMPTY_SUMMARY,
      handler: { execute: async (call, options) => {
        if (options.signal.aborted) return cancelledResult(call.callId);
        try {
          await assertCurrent();
          const mailbox = await access.mailbox();
          if (options.signal.aborted) return cancelledResult(call.callId);
          if (mailbox.status !== 'ready') return failureResult(call.callId, mailbox.reason);
          return {
            schemaVersion: 1, callId: call.callId, status: 'success',
            output: [{ kind: 'json', value: mailbox.mailbox as never }], effects,
          };
        } catch (error) {
          if (options.signal.aborted) return cancelledResult(call.callId);
          return failureResult(call.callId, error instanceof Error ? error.message : '协调邮箱不可用');
        }
      } },
    },
  ];
}

/** 工具名清单（运行入口据此把它们加入本 Run 启用的工具集）。 */
export const COORDINATION_TOOL_NAMES = [
  'coordination_request', 'coordination_respond', 'coordination_subscribe',
  'coordination_wait', 'coordination_cancel', 'coordination_mailbox', 'report_architecture_conflict',
] as const;
