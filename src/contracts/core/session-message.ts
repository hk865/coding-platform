// C1 shared address contract.
//
// This is the ONLY C1 declaration that lives in the shared `contracts/` layer:
// `ledger.ts` widens its closed `AggregateRef` union with this reference, so the
// address must be importable without pulling in WorkGraph modules. All other
// SessionMailbox DTOs stay in `core/work-graph/communication/contracts.ts`.
//
// A SessionMessage is addressed by its FULL aggregate ref. `messageId` alone is
// never an address and never an authorization: project/workspace scope is part
// of the identity, exactly like every other persisted aggregate ref.
export type SessionMessageRef = {
  aggregateType: 'SessionMessage';
  projectId: string;
  workspaceId: string;
  messageId: string;
};

/**
 * 发送方的显式通信意图。意图、是否需要回复、发送后是否立即等待是三件独立事实，
 * 不能由一个 replyMode 隐式表达，也不能让平台把通知自动升级成行动授权。
 */
export type SessionMessageIntentV1 = 'notify' | 'inquiry' | 'action_request';

/** 归一后的通信意图契约。旧 replyMode='wait' 只作为等价输入读取，不再是第二套流程。 */
export type SessionMessageIntentFields = {
  intent?: SessionMessageIntentV1;
  needsReply?: boolean;
  waitAfterSend?: boolean;
};
