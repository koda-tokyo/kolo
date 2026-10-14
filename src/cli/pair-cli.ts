// `kolo pair …` — scoped device pairing (KoLo 2.0, M3a).
//
//   kolo pair invite --scope attach [--ttl 10m] [--label x] [--no-auto-approve] [--json]
//   kolo pair list [--json]                    invitations
//   kolo pair devices [--json]                 paired devices
//   kolo pair approve <fingerprint>            trust a pending device
//   kolo pair revoke <fingerprint|invitationId>
//   kolo pair redeem <code> [--name x] [--url http://host:port]   (device side)
//
// Admin verbs talk to the running gateway through the generated client with the owner token
// found by discover() (KOLO_HOME lock + 0600 token file, env overrides); nothing is taken
// from argv. The invitation code is printed exactly once, at creation.
import type { Command } from "commander";
import {
  KoloApiError,
  KoloClient,
  KoloNetworkError,
  KoloPairError,
  pair,
} from "@kodasoken/kolo-client";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { formatCliCommand } from "./command-format.js";

export const PAIR_EXIT = { ok: 0, error: 1, usage: 2, unreachable: 3 } as const;

type PairCliDeps = {
  runtime?: RuntimeEnv;
  createClient?: (opts: { baseUrl?: string }) => Promise<KoloClient>;
  pair?: typeof pair;
};

class UsageError extends Error {}

/** "10m", "90s", "1h" or plain minutes → minutes (1..60). */
export function parseTtlMinutes(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const m = /^(\d+(?:\.\d+)?)\s*([smh]?)$/i.exec(raw.trim());
  if (!m) {
    throw new UsageError(`--ttl expects minutes or a duration like 10m, 90s, 1h; got "${raw}"`);
  }
  const n = Number.parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const minutes = unit === "s" ? n / 60 : unit === "h" ? n * 60 : n;
  if (!(minutes > 0) || minutes > 60) {
    throw new UsageError("--ttl must be between 1 second and 60 minutes");
  }
  return Math.max(1, Math.ceil(minutes));
}

/** `--sessions a,b --sessions c` → ["a","b","c"] (trimmed, deduplicated, lower-cased). */
export function parseSessionPatterns(raw: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const chunk of raw ?? []) {
    for (const part of chunk.split(",")) {
      const value = part.trim().toLowerCase();
      if (!value) {
        continue;
      }
      if (value.length > 200) {
        throw new UsageError("--sessions: a pattern is longer than 200 characters");
      }
      if (!out.includes(value)) {
        out.push(value);
      }
    }
  }
  if (out.length > 32) {
    throw new UsageError("--sessions: at most 32 patterns");
  }
  return out;
}

function formatAge(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) {
    return "-";
  }
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function formatIn(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) {
    return "-";
  }
  return t <= now ? "expired" : `in ${formatAge(new Date(2 * now - t).toISOString(), now)}`;
}

function exitWith(runtime: RuntimeEnv, err: unknown, json: boolean | undefined): never {
  if (err instanceof UsageError) {
    runtime.error(err.message);
    runtime.exit(PAIR_EXIT.usage);
  }
  if (err instanceof KoloApiError) {
    const body = err.body as { error?: unknown } | undefined;
    const nested =
      body?.error && typeof body.error === "object"
        ? (body.error as { message?: unknown }).message
        : undefined;
    const message =
      typeof body?.error === "string"
        ? body.error
        : typeof nested === "string"
          ? nested
          : `HTTP ${err.status}`;
    if (json) {
      runtime.error(JSON.stringify({ ok: false, status: err.status, error: message }));
    } else {
      runtime.error(
        err.status === 403
          ? `Forbidden: this credential cannot manage pairing (admin scope or the owner token needed).`
          : `Gateway refused: ${message} (HTTP ${err.status})`,
      );
    }
    runtime.exit(PAIR_EXIT.error);
  }
  if (err instanceof KoloNetworkError) {
    runtime.error(
      `Gateway unreachable: ${err.message}. Is it running? (${formatCliCommand("kolo gateway status")})`,
    );
    runtime.exit(PAIR_EXIT.unreachable);
  }
  if (err instanceof KoloPairError) {
    runtime.error(json ? JSON.stringify({ ok: false, error: err.reason }) : err.message);
    runtime.exit(err.reason.startsWith("unreachable") ? PAIR_EXIT.unreachable : PAIR_EXIT.error);
  }
  runtime.error(err instanceof Error ? err.message : String(err));
  runtime.exit(PAIR_EXIT.error);
}

export function registerPairCli(program: Command, deps: PairCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  const createClient =
    deps.createClient ?? (async (opts: { baseUrl?: string }) => await KoloClient.local(opts));
  const doPair = deps.pair ?? pair;

  const cmd = program
    .command("pair")
    .description("Scoped device pairing: one-shot invitations, device-bound credentials")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Scopes:")} observe < attach < admin (owner = the gateway token file).\n` +
        `${theme.muted("Flow:")} ${formatCliCommand("kolo pair invite --scope attach")} on the gateway host, ` +
        `then ${formatCliCommand("kolo pair redeem <code> --url http://host:port")} on the device.\n`,
    );

  cmd
    .command("invite")
    .description("Create a single-use invitation code (printed once)")
    .option("--scope <scope>", "observe | attach | admin (default: attach)", "attach")
    .option("--ttl <duration>", "Lifetime: minutes or 10m/90s/1h (default 10m, max 60m)")
    .option("--label <label>", "Free-text label (who/what this is for)")
    .option("--no-auto-approve", "Leave the device pending until `kolo pair approve`")
    .option(
      "--sessions <patterns>",
      "Session allowlist (M3b): comma-separated globs over session keys, agent ids or label:<x>; repeatable",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--url <baseUrl>", "Gateway base URL (default: discovered)")
    .option("--json", "Print JSON", false)
    .action(
      async (opts: {
        scope: string;
        ttl?: string;
        label?: string;
        autoApprove: boolean;
        sessions?: string[];
        url?: string;
        json?: boolean;
      }) => {
        try {
          const scope = opts.scope.trim().toLowerCase();
          if (!["observe", "attach", "admin"].includes(scope)) {
            throw new UsageError("--scope must be observe, attach or admin");
          }
          const ttlMinutes = parseTtlMinutes(opts.ttl);
          const sessions = parseSessionPatterns(opts.sessions);
          const client = await createClient({ baseUrl: opts.url });
          const result = await client.createPairInvitation({
            scope: scope as "observe" | "attach" | "admin",
            ...(ttlMinutes !== undefined ? { ttlMinutes } : {}),
            ...(opts.label ? { label: opts.label } : {}),
            ...(opts.autoApprove ? {} : { autoApprove: false }),
            ...(sessions.length > 0 ? { sessions } : {}),
          });
          if (opts.json) {
            runtime.log(JSON.stringify(result, null, 2));
            return;
          }
          runtime.log(
            `${theme.success("Invitation created")} ${theme.muted(`(${result.invitation.id})`)}`,
          );
          runtime.log(`  scope      ${result.invitation.scope}`);
          if (result.invitation.sessions?.length) {
            runtime.log(`  sessions   ${result.invitation.sessions.join(", ")}`);
          }
          runtime.log(
            `  expires    ${formatIn(result.invitation.expiresAt)} (${result.invitation.expiresAt})`,
          );
          runtime.log(
            `  approval   ${result.invitation.autoApprove ? "automatic (TOFU)" : "manual: kolo pair approve <fingerprint>"}`,
          );
          runtime.log("");
          runtime.log(`  ${theme.heading("code")}  ${theme.command(result.code)}`);
          runtime.log("");
          runtime.log(theme.muted("Shown once. On the device:"));
          runtime.log(
            `  ${formatCliCommand(`kolo pair redeem ${result.code} --url ${client.baseUrl}`)}`,
          );
        } catch (err) {
          exitWith(runtime, err, opts.json);
        }
      },
    );

  cmd
    .command("list")
    .description("List invitations")
    .option("--url <baseUrl>", "Gateway base URL (default: discovered)")
    .option("--json", "Print JSON", false)
    .action(async (opts: { url?: string; json?: boolean }) => {
      try {
        const client = await createClient({ baseUrl: opts.url });
        const { invitations } = await client.listPairInvitations();
        if (opts.json) {
          runtime.log(JSON.stringify({ invitations }, null, 2));
          return;
        }
        if (invitations.length === 0) {
          runtime.log(theme.muted("No invitations."));
          return;
        }
        runtime.log(
          renderTable({
            width: Math.max(60, (process.stdout.columns ?? 120) - 1),
            columns: [
              { key: "Id", header: "Id", minWidth: 14 },
              { key: "Scope", header: "Scope", minWidth: 7 },
              { key: "Status", header: "Status", minWidth: 8 },
              { key: "Expires", header: "Expires", minWidth: 10 },
              { key: "Label", header: "Label", minWidth: 8, flex: true },
              { key: "By", header: "Created by", minWidth: 12, flex: true },
            ],
            rows: invitations.map((i) => ({
              Id: i.id,
              Scope: i.scope,
              Status: i.status,
              Expires: i.status === "pending" ? formatIn(i.expiresAt) : "-",
              Label: i.label ?? "",
              By: i.createdBy,
            })),
          }).trimEnd(),
        );
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });

  cmd
    .command("devices")
    .description("List paired devices")
    .option("--url <baseUrl>", "Gateway base URL (default: discovered)")
    .option("--json", "Print JSON", false)
    .action(async (opts: { url?: string; json?: boolean }) => {
      try {
        const client = await createClient({ baseUrl: opts.url });
        const { devices } = await client.listPairDevices();
        if (opts.json) {
          runtime.log(JSON.stringify({ devices }, null, 2));
          return;
        }
        if (devices.length === 0) {
          runtime.log(theme.muted("No paired devices."));
          return;
        }
        runtime.log(
          renderTable({
            width: Math.max(60, (process.stdout.columns ?? 120) - 1),
            columns: [
              { key: "Fingerprint", header: "Fingerprint", minWidth: 16 },
              { key: "Name", header: "Name", minWidth: 10, flex: true },
              { key: "Scope", header: "Scope", minWidth: 7 },
              { key: "Status", header: "Status", minWidth: 9 },
              { key: "Paired", header: "Paired", minWidth: 7 },
              { key: "Seen", header: "Last seen", minWidth: 9 },
              { key: "Families", header: "Families", minWidth: 8 },
            ],
            rows: devices.map((d) => ({
              Fingerprint: d.fingerprint,
              Name: d.name,
              Scope: d.scope,
              Status: d.status,
              Paired: formatAge(d.pairedAt),
              Seen: formatAge(d.lastSeenAt),
              Families: `${d.families.active}/${d.families.total}`,
            })),
          }).trimEnd(),
        );
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });

  cmd
    .command("approve")
    .description("Approve a pending device")
    .argument("<fingerprint>", "Device key fingerprint (see `kolo pair devices`)")
    .option("--url <baseUrl>", "Gateway base URL (default: discovered)")
    .option("--json", "Print JSON", false)
    .action(async (fingerprint: string, opts: { url?: string; json?: boolean }) => {
      try {
        const client = await createClient({ baseUrl: opts.url });
        const result = await client.approvePairDevice({ fingerprint });
        runtime.log(
          opts.json ? JSON.stringify(result) : `${theme.success("Approved")} ${result.fingerprint}`,
        );
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });

  cmd
    .command("revoke")
    .description("Revoke a device (every credential it holds) or an unredeemed invitation")
    .argument("<target>", "Device fingerprint or invitation id (inv_…)")
    .option("--url <baseUrl>", "Gateway base URL (default: discovered)")
    .option("--json", "Print JSON", false)
    .action(async (target: string, opts: { url?: string; json?: boolean }) => {
      try {
        const client = await createClient({ baseUrl: opts.url });
        if (target.startsWith("inv_")) {
          const result = await client.revokePairInvitation({ id: target });
          runtime.log(
            opts.json
              ? JSON.stringify(result)
              : `${theme.success("Revoked invitation")} ${result.id}`,
          );
          return;
        }
        const result = await client.revokePairDevice({ fingerprint: target });
        runtime.log(
          opts.json
            ? JSON.stringify(result)
            : `${theme.success("Revoked device")} ${result.fingerprint}`,
        );
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });

  cmd
    .command("redeem")
    .description("Redeem an invitation on this device and store the credential (0600)")
    .argument("<code>", "Invitation code from `kolo pair invite`")
    .option("--url <baseUrl>", "Gateway base URL (default: discovered)")
    .option("--name <name>", "Device name shown to the gateway (default user@host)")
    .option("--json", "Print JSON", false)
    .action(async (code: string, opts: { url?: string; name?: string; json?: boolean }) => {
      try {
        const result = await doPair({ code, baseUrl: opts.url, deviceName: opts.name });
        const { credential, file } = result;
        if (opts.json) {
          // Never the tokens: the file holds them.
          runtime.log(
            JSON.stringify(
              {
                ok: true,
                file,
                fingerprint: credential.fingerprint,
                scope: credential.scope,
                status: credential.status,
                gateway: credential.gateway,
                accessExpiresAt: credential.accessExpiresAt,
                refreshExpiresAt: credential.refreshExpiresAt,
              },
              null,
              2,
            ),
          );
          return;
        }
        runtime.log(`${theme.success("Paired")} ${credential.deviceName} → ${credential.gateway}`);
        runtime.log(`  fingerprint ${credential.fingerprint}`);
        runtime.log(`  scope       ${credential.scope}`);
        runtime.log(
          `  status      ${credential.status}${credential.status === "pending" ? " (ask an admin: kolo pair approve " + credential.fingerprint + ")" : ""}`,
        );
        runtime.log(`  credential  ${file}`);
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });
}
