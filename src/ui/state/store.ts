/** Minimal workbench store: typed slices plus a synchronous intent channel. No framework, DOM or network. */

export type Unsubscribe = () => void;
export type StoreAction = { readonly type: string };

export type Store<S extends object, A extends StoreAction> = {
  /** Current slice value, by reference. Container slices (Map/Set/object) are mutated in place by their owner module. */
  get<K extends keyof S>(key: K): S[K];
  /** Replace one slice, then call that slice's subscribers synchronously. No equality check, no render by itself. */
  set<K extends keyof S>(key: K, value: S[K]): void;
  /** Observe one slice (phase 1: tests; phase 2: the SSE `connection` slice). */
  subscribe<K extends keyof S>(key: K, listener: (value: S[K]) => void): Unsubscribe;
  /** Broadcast an intent synchronously to every listener, in registration order. */
  dispatch(action: A): void;
  listen(listener: (action: A) => void): Unsubscribe;
};

/** One registration. Registering the same function twice gives two entries. */
type Entry<T> = { readonly listener: (value: T) => void };

/**
 * Every notification is synchronous and unbatched: `set`/`dispatch` return only
 * after each listener ran, and a nested `dispatch` from inside a listener is
 * delivered depth-first. A notification iterates over a snapshot, so a listener
 * added during it is not called for it and one removed during it is still called
 * once. A listener's exception propagates to the caller and is never swallowed.
 */
export function createStore<S extends object, A extends StoreAction>(initial: S): Store<S, A> {
  const slices: S = { ...initial };
  const subscribers = new Map<keyof S, Entry<unknown>[]>();
  const listeners: Entry<A>[] = [];
  const register = <T>(entries: Entry<T>[], listener: (value: T) => void): Unsubscribe => {
    const entry: Entry<T> = { listener };
    entries.push(entry);
    return () => {
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
    };
  };
  return {
    get<K extends keyof S>(key: K): S[K] {
      return slices[key];
    },
    set<K extends keyof S>(key: K, value: S[K]): void {
      slices[key] = value;
      for (const entry of [...(subscribers.get(key) ?? [])]) entry.listener(value);
    },
    subscribe<K extends keyof S>(key: K, listener: (value: S[K]) => void): Unsubscribe {
      let entries = subscribers.get(key);
      if (entries === undefined) {
        entries = [];
        subscribers.set(key, entries);
      }
      return register(entries, listener as (value: unknown) => void);
    },
    dispatch(action: A): void {
      for (const entry of [...listeners]) entry.listener(action);
    },
    listen(listener: (action: A) => void): Unsubscribe {
      return register(listeners, listener);
    },
  };
}
