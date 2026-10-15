// Helpers shared by the `kurahi connect` flows: secret intake, channel config, waiting for the
// owner's first message, and output that respects --json.
import type { KoLoConfig } from "../../config/config.js";
import type { ConnectDeps, ConnectOptions, ConnectResult, PhoneChannel } from "./types.js";
import { listOwnerBindings, type OwnerBinding } from "../../channels/resident/owner-binding.js";
import { secretRef } from "../../secrets/names.js";

export const EXIT = { ok: 0, error: 1, usage: 2, unreachable: 3 } as const;

/** Human lines go to stdout, or to stderr under --json so stdout stays one JSON document. */
export function sayer(deps: ConnectDeps, opts: ConnectOptions): (line?: string) => void {
  return (line = "") => (opts.json ? deps.runtime.error(line) : deps.runtime.log(line));
}

export function fail(channel: PhoneChannel, exitCode: number, message: string): ConnectResult {
  return {
    ok: false,
    channel,
    link: null,
    code: null,
    expiresAt: null,
    owner: null,
    exitCode,
    message,
  };
}

export type SecretSpec = {
  /** Store name, e.g. channel.telegram.botToken. */
  name: string;
  /** What the person is asked for. */
  label: string;
  /** Environment variable the channel already honours. */
  envVar?: string;
};

/**
 * Collect secret values: `--stdin` (one per line, in order), else the channel's environment
 * variable, else a hidden prompt (empty keeps the stored value), else the value already in the
 * secrets store. Values are never echoed, logged or put on argv.
 */
export async function collectSecrets(
  deps: ConnectDeps,
  opts: ConnectOptions,
  specs: SecretSpec[],
): Promise<{ values: string[] } | { error: string }> {
  const store = deps.secrets();
  if (opts.stdin) {
    if (!deps.readStdin) {
      return { error: "--stdin is not available here" };
    }
    const lines = (await deps.readStdin())
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < specs.length) {
      return {
        error: `expected ${specs.length} line(s) on stdin (${specs.map((s) => s.label).join(", ")})`,
      };
    }
    return { values: specs.map((_, i) => lines[i]) };
  }
  const values: string[] = [];
  for (const spec of specs) {
    const fromEnv = spec.envVar ? deps.env[spec.envVar]?.trim() : undefined;
    if (fromEnv) {
      values.push(fromEnv);
      continue;
    }
    const stored = store.get(spec.name)?.trim();
    if (deps.prompter) {
      const answer = await deps.prompter.secret(
        stored ? `${spec.label} (empty keeps the stored value)` : spec.label,
      );
      if (answer === null) {
        return { error: "cancelled" };
      }
      const value = answer.trim() || stored;
      if (!value) {
        return { error: `${spec.label} is required` };
      }
      values.push(value);
      continue;
    }
    if (stored) {
      values.push(stored);
      continue;
    }
    return {
      error: `${spec.label} missing: pipe it with --stdin${spec.envVar ? `, set ${spec.envVar},` : ""} or store it with kurahi secrets set ${spec.name}`,
    };
  }
  return { values };
}

/** Store name for a channel secret, following `kurahi secrets migrate` naming. */
export function channelSecretName(channel: string, accountId: string | undefined, key: string) {
  return accountId && accountId !== "default"
    ? `channel.${channel}.accounts.${accountId}.${key}`
    : `channel.${channel}.${key}`;
}

/** Enable a channel (or one account) and point its credential keys at `$secret` refs. */
export function withChannelSecrets(
  cfg: KoLoConfig,
  channel: string,
  accountId: string | undefined,
  refs: Record<string, string>,
): KoLoConfig {
  const channels = { ...(cfg.channels as Record<string, unknown> | undefined) };
  const entry = { ...(channels[channel] as Record<string, unknown> | undefined) };
  const fields: Record<string, unknown> = {};
  for (const [key, name] of Object.entries(refs)) {
    fields[key] = secretRef(name);
  }
  if (accountId && accountId !== "default") {
    const accounts = { ...(entry.accounts as Record<string, Record<string, unknown>> | undefined) };
    accounts[accountId] = { ...accounts[accountId], enabled: true, ...fields };
    channels[channel] = { ...entry, accounts };
  } else {
    channels[channel] = { ...entry, enabled: true, ...fields };
  }
  return { ...cfg, channels } as KoLoConfig;
}

/**
 * Poll the owner bindings until one for this channel appears after `sinceMs`, or the deadline
 * passes. Bounded: never waits past the code's expiry.
 */
export async function waitForOwner(
  deps: ConnectDeps,
  channel: string,
  accountId: string | undefined,
  sinceMs: number,
  deadlineMs: number,
  intervalMs = 1000,
): Promise<OwnerBinding | null> {
  const acct = accountId && accountId !== "default" ? accountId : null;
  while (deps.now() <= deadlineMs) {
    const hit = listOwnerBindings({ env: deps.env }).find(
      (o) => o.channel === channel && o.accountId === acct && o.boundAt >= sinceMs,
    );
    if (hit) {
      return hit;
    }
    await deps.sleep(intervalMs);
  }
  return null;
}

export function formatExpiry(expiresAtMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((expiresAtMs - nowMs) / 60_000));
  return `${minutes} min (${new Date(expiresAtMs).toISOString()})`;
}

/** Print a QR block with its caption; under --json it goes to stderr like every human line. */
export function printQr(deps: ConnectDeps, opts: ConnectOptions, text: string): void {
  const say = sayer(deps, opts);
  say("");
  for (const line of deps.renderQr(text).split("\n")) {
    say(`  ${line}`);
  }
  say("");
}
