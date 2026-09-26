import type { HookPoint, HookPort } from "../protocol/hook-protocol.js";
export declare class HookRegistryError extends Error {
    readonly code: "duplicate_hook" | "registry_frozen" | "invalid_hook";
    constructor(code: "duplicate_hook" | "registry_frozen" | "invalid_hook", message: string);
}
export declare class HookRegistry {
    #private;
    constructor(hooks?: readonly HookPort[]);
    register(hook: HookPort): void;
    freeze(): this;
    list<TPoint extends HookPoint>(point: TPoint): readonly Extract<HookPort, {
        point: TPoint;
    }>[];
}
//# sourceMappingURL=hook-registry.d.ts.map