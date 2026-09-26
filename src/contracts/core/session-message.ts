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
