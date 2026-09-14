/** Internal shared commit construction. Control admission remains in the command handler. */



export type CoordinationFoldDeps = {
  eventId: () => string;
  now: () => string;
  workspaceId: string;
};


/** 一次提交内的事件上下文（身份 + 命令 + 时间）。 */
export type FoldContext = {
  commandId: string;
  correlationId: string;
  occurredAt: string;
  identity: import("../../../../contracts/command-event.js").CommandIdentity;
};


export function ctxOf(command: { commandId: string; correlationId: string; identity: import("../../../../contracts/command-event.js").CommandIdentity }, occurredAt: string): FoldContext {
  return { commandId: command.commandId, correlationId: command.correlationId, occurredAt, identity: command.identity };
}
