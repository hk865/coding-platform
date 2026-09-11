/**
 * Type surface for `module-map.mjs`.
 *
 * The map itself stays a plain `.mjs` script so `check-module-boundaries.mjs`
 * and the test suite import one single source of truth. This declaration exists
 * only so TypeScript consumers (notably
 * `tests/contracts/module-ownership.test.ts`) can import it without an
 * implicit-any error. The `.d.mts` extension is required: the declaration must
 * sit next to the `.mjs` for NodeNext resolution, and `tsconfig.json` only
 * includes `src` and `tests`.
 */

/** The twelve product Modules, in canonical order. */
export declare const modules: readonly string[];

/** Registered long-term Module dependencies, including injected ports. */
export declare const allowedModuleDependencies: Readonly<Record<string, readonly string[]>>;

/**
 * Owning Module (or shared surface: Contracts/Fixtures/TestDoubles/Host/Storage/UI)
 * for a product source path. Returns 'Unmapped' when the path names no owner.
 */
export declare function owner(file: string): string;
