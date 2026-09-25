import type { RunState } from "../../runtime/state/run-state.js";
import type { SessionRecord, SessionRecordDraft } from "./session-store-port.js";
export declare function replaySessionRecords(records: readonly SessionRecord[]): RunState | null;
export declare function applySessionDraft(state: RunState | null, draft: SessionRecordDraft): RunState;
export declare function isActiveSessionState(state: RunState | null): state is RunState;
//# sourceMappingURL=session-projection.d.ts.map