// Plugin instance lifecycle (KoLo 2.0, M7).
//
// Every plugin instance owns the timers, listeners, servers and `onDispose` callbacks it registers
// through `api.lifecycle`; `disposeLifecycle` releases them in reverse order and never throws, so a
// reload or a disable can never leak the previous instance. Signals are a tiny named-value bus
// shared by every plugin in one registry (a circadian plugin publishes `circadian.phase`, a trigger
// rule reads it); subscriptions made through a plugin's api die with that plugin.
import type { KoLoPluginLifecycle, KoLoPluginSignals } from "./types.js";

type Disposer = () => void | Promise<void>;

export type PluginLifecycleHandle = {
  api: KoLoPluginLifecycle;
  /** Number of resources still held (tests, `kolo plugins list --verbose`). */
  size: () => number;
  dispose: (onError?: (what: string, err: unknown) => void) => Promise<void>;
};

export function createPluginLifecycle(): PluginLifecycleHandle {
  const disposers: Array<{ what: string; run: Disposer }> = [];
  let disposed = false;
  const timers = new Set<NodeJS.Timeout>();

  const track = (what: string, run: Disposer) => {
    if (disposed) {
      // Registering after dispose started: release immediately so nothing outlives the instance.
      void Promise.resolve()
        .then(run)
        .catch(() => undefined);
      return;
    }
    disposers.push({ what, run });
  };

  const api: KoLoPluginLifecycle = {
    get disposed() {
      return disposed;
    },
    onDispose: (fn) => track("onDispose", fn),
    setInterval: (fn, ms) => {
      const timer = setInterval(() => {
        if (disposed) {
          return;
        }
        try {
          fn();
        } catch {
          // plugin tick errors are the plugin's to log; never unhandled here
        }
      }, ms);
      timer.unref?.();
      timers.add(timer);
      track("interval", () => {
        clearInterval(timer);
        timers.delete(timer);
      });
      return timer;
    },
    setTimeout: (fn, ms) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (disposed) {
          return;
        }
        try {
          fn();
        } catch {
          // see above
        }
      }, ms);
      timer.unref?.();
      timers.add(timer);
      track("timeout", () => {
        clearTimeout(timer);
        timers.delete(timer);
      });
      return timer;
    },
    clearTimer: (timer) => {
      clearTimeout(timer);
      clearInterval(timer);
      timers.delete(timer);
    },
    addListener: (emitter, event, fn) => {
      emitter.on(event, fn);
      track(`listener:${event}`, () => {
        if (typeof emitter.off === "function") {
          emitter.off(event, fn);
        } else if (typeof emitter.removeListener === "function") {
          emitter.removeListener(event, fn);
        }
      });
    },
    trackServer: (server) => {
      track(
        "server",
        () =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            try {
              const result = server.close(() => finish());
              if (result && typeof (result as Promise<unknown>).then === "function") {
                void (result as Promise<unknown>).then(finish, finish);
              }
            } catch {
              finish();
            }
            // A server with sockets still open may never call back; bound the wait.
            setTimeout(finish, 2_000).unref?.();
          }),
      );
    },
  };

  return {
    api,
    size: () => disposers.length,
    dispose: async (onError) => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const entry of disposers.splice(0).reverse()) {
        try {
          await entry.run();
        } catch (err) {
          onError?.(entry.what, err);
        }
      }
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      timers.clear();
    },
  };
}

export type PluginSignalBus = {
  /** Signals api bound to one plugin instance (subscriptions released on its dispose). */
  forPlugin: (lifecycle: KoLoPluginLifecycle) => KoLoPluginSignals;
  get: <T = unknown>(name: string) => T | undefined;
  set: (name: string, value: unknown) => void;
  list: () => Record<string, unknown>;
};

export function createPluginSignalBus(): PluginSignalBus {
  const values = new Map<string, unknown>();
  const subscribers = new Map<string, Set<(value: unknown) => void>>();

  const set = (name: string, value: unknown) => {
    const key = name.trim();
    if (!key) {
      return;
    }
    values.set(key, value);
    for (const fn of subscribers.get(key) ?? []) {
      try {
        fn(value);
      } catch {
        // a subscriber failing must not stop the publisher
      }
    }
  };
  const get = <T = unknown>(name: string): T | undefined =>
    values.get(name.trim()) as T | undefined;
  const list = () => Object.fromEntries(values);
  const subscribe = (name: string, fn: (value: unknown) => void) => {
    const key = name.trim();
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  };

  return {
    get,
    set,
    list,
    forPlugin: (lifecycle) => ({
      get,
      set,
      list,
      subscribe: (name, fn) => {
        const off = subscribe(name, fn);
        lifecycle.onDispose(off);
        return off;
      },
    }),
  };
}
