// `kolo evidence replay` (KoLo 2.0, M12c): the stepper on a bundle or on a job under KOLO_HOME.
// Interactive on a terminal (n, p, j N, q); `--step N` prints one state; without a terminal and
// without --step every step is printed in order.
import fs from "node:fs";
import readline from "node:readline";
import type { RuntimeEnv } from "../runtime.js";
import type { EvidenceEvent } from "./types.js";
import { defaultRuntime } from "../runtime.js";
import { createStepper, formatStep, type ReplayState } from "./replay.js";
import { isSafeJobId, readJobEvents } from "./store.js";
import { eventsOfBundle, loadBundle } from "./verify.js";

export type ReplayCliDeps = {
  runtime?: RuntimeEnv;
  env?: NodeJS.ProcessEnv;
  /** Test hook: lines a person would type (interactive mode). */
  input?: AsyncIterable<string> | string[];
  isTTY?: boolean;
};

async function resolveEvents(target: string, env?: NodeJS.ProcessEnv): Promise<EvidenceEvent[]> {
  if (fs.existsSync(target)) {
    return eventsOfBundle(await loadBundle(target));
  }
  if (isSafeJobId(target)) {
    return readJobEvents(target, env);
  }
  return [];
}

function parseStep(raw: string | undefined, total: number): number | null {
  if (raw === undefined) {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > total) {
    throw new Error(`--step must be between 0 and ${total}; got "${raw}"`);
  }
  return n;
}

export async function runReplayCli(
  target: string,
  opts: { step?: string; json?: boolean },
  deps: ReplayCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  const name = target?.trim() ?? "";
  if (!name) {
    runtime.error("kolo evidence replay: a bundle path or job id is required");
    return 2;
  }
  let events: EvidenceEvent[];
  try {
    events = await resolveEvents(name, deps.env);
  } catch (err) {
    runtime.error(
      `kolo evidence replay: cannot read ${name} (${err instanceof Error ? err.message : String(err)})`,
    );
    return 1;
  }
  if (events.length === 0) {
    runtime.error(`kolo evidence replay: no events found for ${name}`);
    return 1;
  }
  let step: number | null;
  try {
    step = parseStep(opts.step, events.length);
  } catch (err) {
    runtime.error(`kolo evidence replay: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const stepper = createStepper(events, step ?? 1);
  const print = (state: ReplayState) => {
    runtime.log(opts.json ? JSON.stringify(state) : formatStep(state).join("\n"));
  };
  if (step !== null) {
    print(stepper.current());
    return 0;
  }
  const interactive =
    deps.input !== undefined || (deps.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY));
  if (!interactive) {
    for (let i = 1; i <= events.length; i++) {
      print(stepper.jump(i));
      if (!opts.json) {
        runtime.log("");
      }
    }
    return 0;
  }
  print(stepper.current());
  if (!opts.json) {
    runtime.log("commands: n next, p prev, j <step> jump, q quit");
  }
  const lines: AsyncIterable<string> = deps.input
    ? Array.isArray(deps.input)
      ? (async function* () {
          for (const l of deps.input as string[]) {
            yield l;
          }
        })()
      : deps.input
    : readline.createInterface({ input: process.stdin, terminal: false });
  for await (const raw of lines) {
    const [verb, arg] = raw.trim().split(/\s+/);
    switch ((verb ?? "").toLowerCase()) {
      case "":
      case "n":
      case "next":
        print(stepper.next());
        break;
      case "p":
      case "prev":
        print(stepper.prev());
        break;
      case "j":
      case "jump": {
        const to = Number.parseInt(arg ?? "", 10);
        if (!Number.isInteger(to)) {
          runtime.log("usage: j <step>");
          break;
        }
        print(stepper.jump(to));
        break;
      }
      case "q":
      case "quit":
        return 0;
      default:
        runtime.log("commands: n next, p prev, j <step> jump, q quit");
    }
  }
  return 0;
}
