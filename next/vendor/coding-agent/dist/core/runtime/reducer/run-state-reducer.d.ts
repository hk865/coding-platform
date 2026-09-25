import type { RunState } from "../state/run-state.js";
export declare class ReducerError extends Error {
    readonly code: "transition_rejected" | "state_invalid";
    constructor(code: "transition_rejected" | "state_invalid", message: string);
}
export declare function reduceRunState(stateInput: Readonly<RunState>, eventInput: unknown): RunState;
//# sourceMappingURL=run-state-reducer.d.ts.map