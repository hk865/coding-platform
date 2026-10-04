/// <reference lib="dom" />

import type { CoreScope } from '../../app/core-http-types.js';
import type { ScopeState } from './scope-state.js';
import { record, scopeKey } from './values.js';
import { selectedKey, view } from './workbench.js';

// ---------------------------------------------------------------------------
// Scope display-identity seam: each scope owns its own display-id record, so a
// write for scope B in another tab can never erase scope A. Only lastscope/theme
// are global. These are display ids only: never a body, token or owner fact.
// ---------------------------------------------------------------------------

/** Legacy single-record key; its explicit `scopeKey` is the only scope its ids
 * may migrate to, and it never overwrites an existing v2 record. */
export const DISPLAY_PREFERENCE_V1_KEY = 'workbench.display-preference.v1';

const DISPLAY_PREFERENCE_V2_SCOPE_PREFIX = 'workbench.display-preference.v2.scope:';
const DISPLAY_PREFERENCE_V2_GLOBAL_KEY = 'workbench.display-preference.v2.global';

/** Display ids for ONE scope. Never a body, token or business fact. */
export type ScopeDisplayIds = {
  goalId: string | null;
  sessionId: string | null;
  mainSessionId: string | null;
};

/** The only shared (global) display fields. */
export type GlobalDisplayPreference = {
  lastScopeKey: string | null;
  theme: 'light' | 'dark' | 'system' | null;
};

/** Injectable storage boundary; the browser passes localStorage. */
export type DisplayPreferenceStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

/** Formal read port: exactly `goals/read` + `sessions/read`. A missing or
 * mismatched id resolves null. It can only display, never submit/claim/create. */
export type ScopeDisplayReadPort = {
  readGoal(goalId: string): Promise<{ status: 'ready'; value: unknown } | null>;
  readSession(sessionId: string): Promise<{ status: 'ready'; value: unknown } | null>;
};

/** The real owner payloads applied for ONE scope, not just the restored forms. */
export type ScopeDisplayRestore = {
  goalId: string | null;
  sessionId: string | null;
  mainSessionId: string | null;
  goalRead: unknown | null;
  sessionRead: unknown | null;
  mainSessionRead: unknown | null;
};

export type ScopeDisplayStore = {
  /** Persist ids for the ORIGINAL scope and start a new selection generation. */
  save(origin: CoreScope, ids: ScopeDisplayIds): void;
  /** Read one scope's ids, migrating an explicit old-v1 scopeKey exactly once. */
  load(scope: CoreScope): ScopeDisplayIds;
  readGlobal(): GlobalDisplayPreference;
  writeGlobal(global: GlobalDisplayPreference): void;
  /** Restore through formal reads for THIS scope. A late response for a
   * superseded selection resolves null; a missing/mismatched read is no success. */
  restore(scope: CoreScope, read: ScopeDisplayReadPort): Promise<ScopeDisplayRestore | null>;
};

const emptyDisplayIds = (): ScopeDisplayIds => ({ goalId: null, sessionId: null, mainSessionId: null });

function displayIdsOfRecord(value: unknown): ScopeDisplayIds {
  const source = record(value);
  return {
    goalId: typeof source.goalId === 'string' ? source.goalId : null,
    sessionId: typeof source.sessionId === 'string' ? source.sessionId : null,
    mainSessionId: typeof source.mainSessionId === 'string' ? source.mainSessionId : null,
  };
}

const displayThemeOf = (value: unknown): GlobalDisplayPreference['theme'] =>
  value === 'light' || value === 'dark' || value === 'system' ? value : null;

function displayGlobalOfRecord(value: unknown): GlobalDisplayPreference {
  const source = record(value);
  return {
    lastScopeKey: typeof source.lastScopeKey === 'string' ? source.lastScopeKey : null,
    theme: displayThemeOf(source.theme),
  };
}

/** The formal read payloads carry the ref inside `value.goal` (GoalDetail) and
 * `value.record` (SessionCard); `value` itself is never an id. */
function readPayloadGoalId(payload: { value: unknown }): string | null {
  const ref = record(record(record(payload.value).goal).ref);
  return typeof ref.goalId === 'string' ? ref.goalId : null;
}

function readPayloadSessionId(payload: { value: unknown }): string | null {
  const ref = record(record(record(payload.value).record).ref);
  return typeof ref.sessionId === 'string' ? ref.sessionId : null;
}

export function createScopeDisplayStore(storage: DisplayPreferenceStorage): ScopeDisplayStore {
  const generations = new Map<string, number>();
  const scopeStorageKey = (scope: CoreScope): string => DISPLAY_PREFERENCE_V2_SCOPE_PREFIX + scopeKey(scope);
  const readLegacy = (): Record<string, unknown> | null => {
    try {
      const raw = storage.get(DISPLAY_PREFERENCE_V1_KEY);
      return raw === null ? null : record(JSON.parse(raw));
    } catch { return null; }
  };
  const loadIds = (scope: CoreScope): ScopeDisplayIds => {
    const key = scopeKey(scope);
    const storageKey = scopeStorageKey(scope);
    try {
      const raw = storage.get(storageKey);
      if (raw !== null) return displayIdsOfRecord(JSON.parse(raw));
    } catch { /* malformed entry falls back to migration/empty */ }
    // A scope's old v1 ids migrate ONLY to the scope named by its scopeKey.
    const legacy = readLegacy();
    if (legacy === null || legacy.scopeKey !== key) return emptyDisplayIds();
    const ids = displayIdsOfRecord(legacy);
    try { storage.set(storageKey, JSON.stringify(ids)); } catch { /* storage disabled */ }
    return ids;
  };
  const readGlobal = (): GlobalDisplayPreference => {
    try {
      const raw = storage.get(DISPLAY_PREFERENCE_V2_GLOBAL_KEY);
      if (raw !== null) return displayGlobalOfRecord(JSON.parse(raw));
    } catch { /* malformed entry falls back to migration/empty */ }
    // Startup migrates the old v1 lastscope/theme into the global key only.
    const legacy = readLegacy();
    const migrated = displayGlobalOfRecord(legacy === null ? {} : { lastScopeKey: legacy.scopeKey, theme: legacy.theme });
    if (legacy !== null) {
      try { storage.set(DISPLAY_PREFERENCE_V2_GLOBAL_KEY, JSON.stringify(migrated)); } catch { /* storage disabled */ }
    }
    return migrated;
  };
  return {
    save(origin, ids) {
      const key = scopeKey(origin);
      generations.set(key, (generations.get(key) ?? 0) + 1);
      try { storage.set(scopeStorageKey(origin), JSON.stringify(displayIdsOfRecord(ids))); } catch { /* storage disabled */ }
    },
    load: loadIds,
    readGlobal,
    writeGlobal(global) {
      // Global has its OWN key, so this can never touch a scope record.
      try { storage.set(DISPLAY_PREFERENCE_V2_GLOBAL_KEY, JSON.stringify(displayGlobalOfRecord(global))); } catch { /* storage disabled */ }
    },
    async restore(scope, read) {
      const key = scopeKey(scope);
      const start = generations.get(key) ?? 0;
      const superseded = (): boolean => (generations.get(key) ?? 0) !== start;
      const stored = loadIds(scope);
      if (superseded()) return null;
      let goalId: string | null = null; let goalRead: unknown | null = null;
      let sessionId: string | null = null; let sessionRead: unknown | null = null;
      let mainSessionId: string | null = null; let mainSessionRead: unknown | null = null;
      if (stored.goalId !== null) {
        const payload = await read.readGoal(stored.goalId);
        if (superseded()) return null;
        if (payload !== null && payload.status === 'ready' && readPayloadGoalId(payload) === stored.goalId) {
          goalId = stored.goalId; goalRead = payload;
        }
      }
      const readSession = async (wanted: string): Promise<{ id: string; payload: unknown } | null> => {
        const payload = await read.readSession(wanted);
        if (superseded()) return null;
        return payload !== null && payload.status === 'ready' && readPayloadSessionId(payload) === wanted
          ? { id: wanted, payload } : null;
      };
      if (stored.sessionId !== null) {
        const hit = await readSession(stored.sessionId);
        if (hit === null && superseded()) return null;
        if (hit !== null) { sessionId = hit.id; sessionRead = hit.payload; }
      }
      if (stored.mainSessionId !== null) {
        const hit = await readSession(stored.mainSessionId);
        if (hit === null && superseded()) return null;
        if (hit !== null) { mainSessionId = hit.id; mainSessionRead = hit.payload; }
      }
      if (goalId === null && sessionId === null && mainSessionId === null) return null;
      return { goalId, sessionId, mainSessionId, goalRead, sessionRead, mainSessionRead };
    },
  };
}

/** The page's single store; localStorage is touched lazily so importing this
 * module in Node never reads `window`. */
export const displayPreferenceStore = createScopeDisplayStore({
  get: key => { try { return window.localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* storage disabled */ } },
});

function displayIdsOf(scope: ScopeState): ScopeDisplayIds {
  const goalId = scope.forms.goalId.trim();
  return {
    goalId: goalId.length > 0 ? goalId : null,
    sessionId: scope.activeSession?.sessionId ?? null,
    mainSessionId: scope.mainSession?.sessionId ?? null,
  };
}

/** Persist the display ids for the EXACT scope the caller acted on. */
export function saveScopeDisplay(scope: ScopeState): void {
  displayPreferenceStore.save(scope.config.scope, displayIdsOf(scope));
}

/** Persist only the global lastscope/theme; a theme toggle is not a selection. */
export function saveGlobalDisplay(): void {
  displayPreferenceStore.writeGlobal({
    lastScopeKey: selectedKey().length > 0 ? selectedKey() : null,
    theme: view.theme,
  });
}
