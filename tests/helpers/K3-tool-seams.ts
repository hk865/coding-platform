/**
 * K3 §5.1 test seams (decision 56): switchable stand-ins for frozen Kernel
 * builtins and for the platform coordination tools.
 *
 * The real builtin `shell` needs bwrap (`isolated_process`), which DSH does not
 * have, so a call would be refused before it could stay in flight. The stand-in
 * keeps the name `shell` and `effectClass: 'process'` (so the L3 table and the
 * classifier see the same tool) but drops `isolated_process` and blocks in the
 * test process until released. When the seam is not armed it returns the real
 * definition.
 *
 * `mailboxToolSeam` does the same for the ONE non-process, `platform`-kind tool
 * (`send_user_message`, L3 row 4): it is registered through the production
 * `createSessionMailboxTools` factory the test replaces with `vi.mock`, and its
 * handler blocks. The Kernel records the real unresolved call; the production
 * classifier/draft then builds a `platform` item. The seam is an injected
 * dependency, never a hand-written fact.
 *
 * `vi.mock` is hoisted per test file, so the test file owns the `vi.mock` call
 * and this module only owns the state and the swapped definition.
 */
import { toolSchema as z, type ProcessSandbox, type ToolCall, type ToolDefinition, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';

export type ShellSeamCall = { callId: string; arguments: unknown };

/**
 * The ONE blocking latch both seams use: an armed gate the handler waits on,
 * the recorded calls, and a way for a test to await the first call.
 */
class BlockingLatch {
  private armed = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  readonly calls: ShellSeamCall[] = [];

  get enabled(): boolean { return this.armed; }

  arm(): void {
    this.armed = true;
    this.calls.length = 0;
    this.gate = new Promise<void>((resolve) => { this.openGate = resolve; });
  }

  release(): void {
    this.armed = false;
    this.openGate?.();
    this.openGate = null;
  }

  /** Resolves once at least one call has entered the stand-in handler. */
  async waitForCall(): Promise<void> {
    if (this.calls.length > 0) return;
    await new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }

  /** Records the call, wakes `waitForCall`, then blocks while armed. */
  async hold(call: Readonly<ToolCall>): Promise<void> {
    this.calls.push({ callId: call.callId, arguments: call.arguments });
    for (const waiter of this.waiters.splice(0)) waiter();
    await this.gate;
  }
}

class ShellSeam {
  /** When armed, every `shell` call blocks until `release()`. */
  private readonly latch = new BlockingLatch();

  get enabled(): boolean { return this.latch.enabled; }
  get calls(): ShellSeamCall[] { return this.latch.calls; }

  arm(): void { this.latch.arm(); }

  release(): void { this.latch.release(); }

  /** Resolves once at least one `shell` call has entered the stand-in handler. */
  waitForCall(): Promise<void> { return this.latch.waitForCall(); }

  private stub(): ToolDefinition {
    return {
      name: 'shell',
      description: 'K3 stand-in shell (blocks until released)',
      inputSchema: z.object({ command: z.string().min(1), cwd: z.string().optional() }).loose(),
      effectClass: 'process',
      requiredCapabilities: [],
      independentReadOnly: false,
      defaultTimeoutMs: 60_000,
      outputLimitBytes: 4_096,
      summarize: () => ({ paths: [], cwd: null, commandPreview: 'K3 shell' }),
      handler: {
        execute: async (call: Readonly<ToolCall>): Promise<ToolResult> => {
          await this.latch.hold(call);
          return { schemaVersion: 1, callId: call.callId, status: 'success',
            output: [{ kind: 'text', text: 'K3 shell stand-in' }],
            effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
        },
      },
    };
  }

  /** The mocked `createShellToolDefinition`: armed → the stand-in, otherwise the real factory. */
  definition(actual: (sandbox: ProcessSandbox) => ToolDefinition, sandbox: ProcessSandbox): ToolDefinition {
    return this.enabled ? this.stub() : actual(sandbox);
  }
}

export const shellSeam = new ShellSeam();

/**
 * A blocking NON-PROCESS tool stand-in. `arm()` makes the factory return this
 * one definition (registered by name/effect class); the handler blocks in the
 * test process just like the shell seam.
 */
class BlockingToolSeam {
  private readonly latch = new BlockingLatch();

  constructor(
    readonly name: string,
    readonly effectClass: NonNullable<ToolDefinition['effectClass']>,
  ) {}

  get enabled(): boolean { return this.latch.enabled; }
  get calls(): ShellSeamCall[] { return this.latch.calls; }

  arm(): void { this.latch.arm(); }

  release(): void { this.latch.release(); }

  waitForCall(): Promise<void> { return this.latch.waitForCall(); }

  /** The stand-in definition (never the real tool body). */
  definition(): ToolDefinition {
    return {
      name: this.name,
      description: `K3 stand-in ${this.name} (blocks until released)`,
      inputSchema: z.object({}).loose(),
      effectClass: this.effectClass,
      requiredCapabilities: [],
      independentReadOnly: false,
      defaultTimeoutMs: 60_000,
      outputLimitBytes: 4_096,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        execute: async (call: Readonly<ToolCall>): Promise<ToolResult> => {
          await this.latch.hold(call);
          return { schemaVersion: 1, callId: call.callId, status: 'success',
            output: [{ kind: 'text', text: `K3 ${this.name} stand-in` }],
            effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
        },
      },
    };
  }

  /** The `{names, create}` handle `selectCoordinationTools` expects. */
  handle(): { names: readonly string[]; create: () => readonly ToolDefinition[] } {
    return { names: [this.name], create: () => [this.definition()] };
  }
}

/** L3 row 4 `platform` tool: the deleted B2-01 platform-only public-path case. */
export const mailboxToolSeam = new BlockingToolSeam('send_user_message', 'workspace_write');

/**
 * L3 row 1 `read_only` tool: an unresolved Kernel `read` call. The draft reader
 * observes a read-only call `no_review_needed`, so a complete inventory whose
 * only call is this one settles `resolved` with no disposition.
 */
export const readToolSeam = new BlockingToolSeam('read', 'read_only');
