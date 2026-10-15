import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { loadOrCreateOwnerKey, signPolicyFile } from "../policy/attestation.js";
import { readKillState } from "../policy/kill.js";
import { resolvePolicyLocations } from "../policy/paths.js";
import {
  diffPolicies,
  type GatewayCall,
  PolicyCliError,
  runPolicyApply,
  runPolicyBudget,
  runPolicyDiff,
  runPolicyInit,
  runPolicyKill,
  runPolicyRelease,
  runPolicySchema,
  runPolicyShow,
  runPolicySign,
  runPolicyStatus,
  runPolicyValidate,
  runPolicyVerify,
} from "./policy-cli-actions.js";

let home: string;
let loc: ReturnType<typeof resolvePolicyLocations>;
let out: string[];
let errs: string[];
let runtime: RuntimeEnv;
let env: NodeJS.ProcessEnv;
const unreachable: GatewayCall = async () => null;

function deps(gateway: GatewayCall = unreachable) {
  return { runtime, env, gateway, now: () => new Date("2026-10-14T12:00:00Z") };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-policy-cli-"));
  env = { ...process.env, KOLO_HOME: home, KOLO_STATE_DIR: home, KOLO_POLICY_MODE: "enforce" };
  process.env.KOLO_HOME = home;
  process.env.KOLO_STATE_DIR = home;
  loc = resolvePolicyLocations(env);
  out = [];
  errs = [];
  runtime = {
    log: (...args: unknown[]) => out.push(args.join(" ")),
    error: (...args: unknown[]) => errs.push(args.join(" ")),
    exit: (code?: number) => {
      throw new Error(`exit ${code}`);
    },
  } as unknown as RuntimeEnv;
});

afterEach(() => {
  delete process.env.KOLO_HOME;
  delete process.env.KOLO_STATE_DIR;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("kurahi policy", () => {
  it("init writes a signed starter policy, pins the owner and refuses to overwrite", async () => {
    await runPolicyInit({}, deps());
    expect(fs.existsSync(loc.policyPath)).toBe(true);
    expect(fs.existsSync(loc.signaturePath)).toBe(true);
    expect(fs.existsSync(loc.ownersPath)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(loc.ownerKeyPath).mode & 0o777).toBe(0o600);
    }
    expect(out.join("\n")).toMatch(/owner key/);
    expect(out.join("\n")).not.toMatch(/BEGIN PRIVATE KEY/);
    await expect(runPolicyInit({}, deps())).rejects.toThrow(/already exists/);
    await runPolicyInit({ force: true, json: true }, deps());
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ ok: true, createdKey: false, mode: "enforce" });
  });

  it("validate, show, verify and sign", async () => {
    await runPolicyInit({}, deps());
    out = [];
    await runPolicyValidate({}, deps());
    expect(out.at(-1)).toMatch(/^valid/);
    await runPolicyVerify({}, deps());
    expect(out.join("\n")).toMatch(/attestation signed/);
    out = [];
    await runPolicyShow({}, deps());
    expect(out[0]).toMatch(/attestation signed/);
    expect(out.join("\n")).toMatch(/version: 1/);

    fs.writeFileSync(loc.policyPath, "version: 1\nname: edited\nkill:\n  fleet: true\n");
    await expect(runPolicyVerify({}, deps())).rejects.toThrow(/not attested \(invalid\)/);
    await runPolicySign({}, deps());
    await runPolicyVerify({ json: true }, deps());
    expect(JSON.parse(out.at(-1)!).attestation.state).toBe("signed");

    fs.writeFileSync(loc.policyPath, "version: 3\n");
    await expect(runPolicyValidate({}, deps())).rejects.toThrow(/invalid/);
    await expect(runPolicySign({}, deps())).rejects.toThrow(/refusing to sign/);
  });

  it("diff and apply a signed candidate; an unsigned candidate needs --sign", async () => {
    await runPolicyInit({}, deps());
    const candidate = path.join(home, "candidate.yaml");
    fs.writeFileSync(
      candidate,
      "version: 1\nname: candidate\nagents:\n  ops-*:\n    tools:\n      deny: [exec]\n",
    );
    out = [];
    await runPolicyDiff(candidate, {}, deps());
    expect(out.join("\n")).toMatch(/\+ agents\.ops-\*: \{"tools":\{"deny":\["exec"\]\}\}/);
    expect(out.join("\n")).toMatch(/- agents\.\*: /);
    expect(out.join("\n")).toMatch(/~ name: "starter" -> "candidate"/);

    await expect(runPolicyApply(candidate, {}, deps())).rejects.toThrow(/\.sig is missing/);
    const err = await runPolicyApply(candidate, {}, deps()).catch((e: unknown) => e);
    expect((err as PolicyCliError).exitCode).toBe(2);

    await runPolicySign({ file: candidate }, deps());
    expect(fs.existsSync(`${candidate}.sig`)).toBe(true);
    out = [];
    await runPolicyApply(candidate, {}, deps());
    expect(out.join("\n")).toMatch(/attestation signed/);
    await runPolicyShow({ json: true }, deps());
    expect(JSON.parse(out.at(-1)!).policy.name).toBe("candidate");

    const stranger = loadOrCreateOwnerKey(path.join(home, "stranger.json"));
    fs.writeFileSync(candidate, "version: 1\nname: stranger\n");
    signPolicyFile({ policyPath: candidate, signaturePath: `${candidate}.sig`, key: stranger });
    await expect(runPolicyApply(candidate, {}, deps())).rejects.toThrow(
      /not attested \(untrusted\)/,
    );
  });

  it("diffPolicies reports adds, removes and changes by path", () => {
    expect(diffPolicies({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3, d: [1] } })).toEqual([
      { op: "~", path: "b.c", from: 2, to: 3 },
      { op: "+", path: "b.d", to: [1] },
    ]);
    expect(diffPolicies({ a: 1 }, {})).toEqual([{ op: "-", path: "a", from: 1 }]);
  });

  it("status falls back to the local files and kill/release write the runtime switch", async () => {
    await runPolicyInit({}, deps());
    out = [];
    await runPolicyStatus({}, deps());
    expect(out[0]).toMatch(/local files/);
    expect(out.join("\n")).toMatch(/policy {6}starter/);

    await expect(runPolicyKill({}, deps())).rejects.toThrow(/--agent <id> or --all/);
    await runPolicyKill({ agent: "Ops-Bot", reason: "drill" }, deps());
    expect(readKillState(loc.killStatePath).agents["ops-bot"]?.reason).toBe("drill");
    expect(out.join("\n")).toMatch(/not reachable/);

    const calls: string[] = [];
    const live: GatewayCall = async (method, pathname, body) => {
      calls.push(`${method} ${pathname} ${JSON.stringify(body ?? null)}`);
      if (pathname === "/api/policy/status") {
        return {
          status: 200,
          body: {
            ok: true,
            status: {
              mode: "enforce",
              loaded: true,
              path: loc.policyPath,
              name: "live",
              warnings: [],
              kill: { fleet: null, agents: {} },
              paused: {},
              fleetPaused: null,
            },
          },
        };
      }
      return { status: 200, body: { ok: true, jobsAborted: 2, released: true } };
    };
    out = [];
    await runPolicyKill({ all: true }, deps(live));
    expect(out.join("\n")).toMatch(/2 running job\(s\) aborted/);
    expect(readKillState(loc.killStatePath).fleet).toBeTruthy();
    await runPolicyRelease({ all: true }, deps(live));
    expect(readKillState(loc.killStatePath).fleet).toBeNull();
    expect(readKillState(loc.killStatePath).agents).toEqual({});
    out = [];
    await runPolicyStatus({}, deps(live));
    expect(out[0]).toMatch(/gateway$/);
    expect(out.join("\n")).toMatch(/policy {6}live/);
    expect(calls).toEqual([
      'POST /api/policy/kill {"all":true}',
      'POST /api/policy/release {"all":true}',
      "GET /api/policy/status null",
    ]);
  });

  it("budget prints the meters and --reset zeroes them", async () => {
    await runPolicyInit({}, deps());
    fs.mkdirSync(path.dirname(loc.budgetsPath), { recursive: true });
    fs.writeFileSync(
      loc.budgetsPath,
      JSON.stringify({
        version: 1,
        day: {
          start: "2026-10-14T00:00:00.000Z",
          fleet: { tokens: 120, cost: 0.5, toolCalls: 3, jobs: 2 },
          agents: { alice: { tokens: 120, cost: 0.5, toolCalls: 3, jobs: 2 } },
        },
        hour: {
          start: "2026-10-14T12:00:00.000Z",
          fleet: { tokens: 0, cost: 0, toolCalls: 3, jobs: 0 },
          agents: { alice: { tokens: 0, cost: 0, toolCalls: 3, jobs: 0 } },
        },
        paused: {},
        fleetPaused: null,
      }),
    );
    out = [];
    await runPolicyBudget({}, deps());
    expect(out.join("\n")).toMatch(
      /alice {7}120 tok, 0\.5000 USD, 3 calls\/h, 2 jobs \/ 5000000 tok/,
    );
    await runPolicyBudget({ reset: true, json: true }, deps());
    const parsed = JSON.parse(out.at(-1)!);
    expect(parsed.meters.day.fleet.tokens).toBe(0);
    expect(parsed.reset).toBe(true);
  });

  it("schema prints the JSON Schema", async () => {
    await runPolicySchema(deps());
    expect(JSON.parse(out.join("\n")).properties.budgets).toBeDefined();
  });
});
