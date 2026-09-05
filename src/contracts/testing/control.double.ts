/** Consistent ControlEngine test double (used by HumanCollaboration tests). */
import type { CommandReceipt, CreateGoalCommand } from "../command-event.js";
import { makeCommitCursor } from "../ledger.js";
import type {
  WorkspaceBootstrapCommand,
  WorkspaceBootstrapReceipt,
} from "../bootstrap.js";
import type { ControlEngine } from "../modules.js";

export function committedReceiptFor(command: CreateGoalCommand): CommandReceipt {
  return {
    status: "committed",
    commandId: command.commandId,
    replayed: false,
    aggregateRevision: 1,
    eventIds: ["evt-for-test"],
    commitCursor: makeCommitCursor(1),
  };
}

export function rejectedReceiptFor(
  command: CreateGoalCommand,
  code: "invalid" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable",
): CommandReceipt {
  return { status: "rejected", commandId: command.commandId, code };
}

export type SubmitBehavior = (
  command: CreateGoalCommand,
) => Promise<CommandReceipt> | CommandReceipt;
export type BootstrapBehavior = (
  command: WorkspaceBootstrapCommand,
) => Promise<WorkspaceBootstrapReceipt> | WorkspaceBootstrapReceipt;

export class ScriptedControlEngine implements ControlEngine {
  readonly submitCalls: CreateGoalCommand[] = [];
  readonly bootstrapCalls: WorkspaceBootstrapCommand[] = [];

  constructor(
    private readonly options: {
      submit?: SubmitBehavior;
      bootstrap?: BootstrapBehavior;
      defaultSubmit?: CommandReceipt;
      defaultBootstrap?: WorkspaceBootstrapReceipt;
    } = {},
  ) {}

  async submit(command: CreateGoalCommand): Promise<CommandReceipt> {
    this.submitCalls.push(command);
    if (this.options.submit) return this.options.submit(command);
    return this.options.defaultSubmit ?? committedReceiptFor(command);
  }

  async bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt> {
    this.bootstrapCalls.push(command);
    if (this.options.bootstrap) return this.options.bootstrap(command);
    if (this.options.defaultBootstrap) return this.options.defaultBootstrap;
    throw new Error("ScriptedControlEngine: no bootstrap behavior configured");
  }
}