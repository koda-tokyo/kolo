// Code Mode worker (KoLo 2.0, M6). This module exports the JavaScript source of the worker
// thread as a string; the host starts it with `new Worker(source, { eval: true })`, which
// evaluates the source inside the worker thread only. Nothing from the host is ever eval'd.
//
// Inside the worker the agent script runs in a `node:vm` context that holds nothing but the
// injected `tools` namespace, a capturing `console`, `sleep` and the JS builtins. There is no
// `process`, `require`, `fetch`, `import()`, `WebAssembly`, `SharedArrayBuffer` or `Atomics`.
// Every value crossing the realm boundary is a primitive string (JSON): a host-realm object or
// function (whose `.constructor.constructor` would be the host Function) is never handed to
// the sandbox, and nothing from the sandbox is handed to the host except strings.
//
// Message protocol (worker → host): call | log | done | error.  Host → worker: result.

export const CODE_MODE_WORKER_SOURCE = String.raw`
"use strict";
(function () {
const builtin = (name) =>
  typeof require === "function" ? require(name) : process.getBuiltinModule(name);
const { parentPort, workerData } = builtin("node:worker_threads");
const vm = builtin("node:vm");

const { script, tools, maxLogBytes } = workerData;
const pending = new Map();
let callSeq = 0;
let logBytes = 0;

function post(message) {
  parentPort.postMessage(message);
}

// Bridge functions are host-realm (worker main) functions. They take and return primitives
// only; the sandbox-realm wrappers below never see a host object.
function bridgeCall(toolId, argsJson) {
  const id = ++callSeq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    post({ t: "call", id, tool: String(toolId), args: String(argsJson) });
  });
}

function bridgeLog(level, text) {
  const line = String(text);
  logBytes += line.length;
  if (logBytes > maxLogBytes) {
    return "overflow";
  }
  post({ t: "log", level: String(level), text: line });
  return "ok";
}

function bridgeSleep(ms) {
  const n = Math.max(0, Math.min(Number(ms) || 0, 30000));
  return new Promise((resolve) => setTimeout(() => resolve("ok"), n));
}

parentPort.on("message", (message) => {
  if (!message || message.t !== "result") {
    return;
  }
  const resolve = pending.get(message.id);
  if (!resolve) {
    return;
  }
  pending.delete(message.id);
  // The resolved value is a JSON string describing {ok, value|error}; decoded in the sandbox.
  resolve(String(message.payload));
});

const sandbox = Object.create(null);
const context = vm.createContext(sandbox, {
  name: "kolo-code-mode",
  codeGeneration: { strings: false, wasm: false },
});

// Remove the builtins that could reach memory shared with other threads or native code.
vm.runInContext(
  'for (const k of ["SharedArrayBuffer", "Atomics", "WebAssembly"]) { try { delete globalThis[k]; } catch {} }',
  context,
);

const factory = vm.runInContext(
  ${JSON.stringify(String.raw`
(function (toolSpecsJson, call, log, sleepFn) {
  const specs = JSON.parse(toolSpecsJson);
  const root = Object.create(null);
  const decode = (raw) => {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.ok === true) {
      return parsed.value;
    }
    const err = new Error(parsed && parsed.error ? String(parsed.error) : "tool call failed");
    err.name = parsed && parsed.code ? String(parsed.code) : "ToolError";
    throw err;
  };
  for (const spec of specs) {
    const id = spec.id;
    const fn = async function (args) {
      const json = args === undefined ? "{}" : JSON.stringify(args);
      if (typeof json !== "string") {
        throw new TypeError("tool arguments must be JSON-serialisable");
      }
      const raw = await call(id, json);
      return decode(raw);
    };
    Object.defineProperty(fn, "name", { value: spec.path[spec.path.length - 1] });
    let node = root;
    for (let i = 0; i < spec.path.length - 1; i++) {
      const seg = spec.path[i];
      if (!(seg in node)) {
        node[seg] = Object.create(null);
      }
      node = node[seg];
    }
    node[spec.path[spec.path.length - 1]] = fn;
    root[id] = fn;
  }
  const freezeDeep = (o) => {
    for (const k of Object.keys(o)) {
      if (o[k] && typeof o[k] === "object") {
        freezeDeep(o[k]);
      }
    }
    return Object.freeze(o);
  };
  freezeDeep(root);
  const format = (args) =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.stack || a.message;
        try {
          const s = JSON.stringify(a);
          return s === undefined ? String(a) : s;
        } catch {
          return String(a);
        }
      })
      .join(" ");
  const consoleObj = Object.freeze({
    log: (...a) => void log("log", format(a)),
    info: (...a) => void log("info", format(a)),
    warn: (...a) => void log("warn", format(a)),
    error: (...a) => void log("error", format(a)),
    debug: (...a) => void log("debug", format(a)),
  });
  const sleep = async (ms) => {
    await sleepFn(ms);
  };
  return { tools: root, console: consoleObj, sleep };
})
`)},
  context,
  { filename: "code-mode-prelude.js" },
);

const injected = factory(JSON.stringify(tools), bridgeCall, bridgeLog, bridgeSleep);
sandbox.tools = injected.tools;
sandbox.console = injected.console;
sandbox.sleep = injected.sleep;
Object.freeze(sandbox);

// \`script\` is already a function expression: "(async () => { ...body... })" (transpile.ts).
let compiled;
try {
  compiled = new vm.Script("(" + script + ")()", {
    filename: "code-mode-script.js",
    lineOffset: -1,
  });
} catch (err) {
  post({ t: "error", code: "invalid_script", message: String(err && err.message ? err.message : err) });
  return;
}

const serialize = vm.runInContext(
  "(v) => { if (v === undefined) return undefined; const s = JSON.stringify(v); return s === undefined ? 'null' : s; }",
  context,
);

Promise.resolve()
  .then(() => compiled.runInContext(context, { displayErrors: false }))
  .then(
    (value) => {
      let json;
      try {
        json = serialize(value);
      } catch (err) {
        post({ t: "error", code: "script_error", message: "return value is not JSON-serialisable: " + String(err && err.message ? err.message : err) });
        return;
      }
      post({ t: "done", value: json });
    },
    (err) => {
      const message = err && err.message !== undefined ? String(err.message) : String(err);
      const name = err && err.name ? String(err.name) : "Error";
      const stack = err && typeof err.stack === "string" ? err.stack.split("\n").slice(0, 6).join("\n") : undefined;
      post({ t: "error", code: "script_error", message: name === "Error" ? message : name + ": " + message, stack });
    },
  );
})();
`;
