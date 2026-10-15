// `kurahi connect <channel>` (KoLo 2.0, M16): connect a phone to the resident. Also the last,
// optional step of `kurahi init`. WhatsApp links this machine as a device and binds the linked
// number as owner; Telegram and LINE store the bot credentials and print a one-time code whose
// first use binds the owner; web prints a pairing invitation for the dashboard on a phone
// browser. `kurahi connect --unbind <channel>` removes the owner a binding added.
import http from "node:http";
import https from "node:https";
import os from "node:os";
import type { KoLoConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import type {
  ConnectDeps,
  ConnectOptions,
  ConnectResult,
  PhoneChannel,
  Prompter,
} from "./types.js";
import { listOwnerBindings, unbindChannelOwner } from "../../channels/resident/owner-binding.js";
import { resolveGatewayPort } from "../../config/paths.js";
import { pickPrimaryTailnetIPv4 } from "../../infra/tailnet.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveSecretStore } from "../../secrets/store.js";
import { connectLine } from "./line.js";
import { renderQrText } from "./qr.js";
import { EXIT } from "./shared.js";
import { connectTelegram } from "./telegram.js";
import { PHONE_CHANNELS } from "./types.js";
import { connectWeb } from "./web.js";
import { connectWhatsApp } from "./whatsapp.js";

export { PHONE_CHANNELS, type PhoneChannel } from "./types.js";

export function isPhoneChannel(value: unknown): value is PhoneChannel {
  return typeof value === "string" && (PHONE_CHANNELS as readonly string[]).includes(value);
}

/** Private IPv4 first (what a phone on the same Wi-Fi reaches), then any non-internal IPv4. */
export function pickLanIPv4(
  nets: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
): string | undefined {
  const all: string[] = [];
  for (const list of Object.values(nets)) {
    for (const addr of list ?? []) {
      if (addr.family === "IPv4" && !addr.internal && !addr.address.startsWith("100.")) {
        all.push(addr.address);
      }
    }
  }
  const isPrivate = (a: string) =>
    a.startsWith("192.168.") || a.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  return all.find(isPrivate) ?? all[0];
}

function probeLocalGateway(cfg: KoLoConfig): Promise<boolean> {
  const port = resolveGatewayPort(cfg);
  const tls = cfg.gateway?.tls?.enabled === true;
  return new Promise((resolve) => {
    const req = (tls ? https : http).get(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        timeout: 1500,
        // Local probe of our own gateway; its certificate may be self-signed.
        ...(tls ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    if (chunks.reduce((n, c) => n + c.length, 0) > 64 * 1024) {
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function clackPrompter(): Promise<Prompter> {
  const clack = await import("@clack/prompts");
  return {
    secret: async (message) => {
      const v = await clack.password({ message });
      return clack.isCancel(v) ? null : String(v ?? "");
    },
    confirm: async (message) => {
      const v = await clack.confirm({ message });
      return !clack.isCancel(v) && Boolean(v);
    },
    select: async (message, options, initial) => {
      const v = await clack.select({
        message,
        options: options as Array<{ value: string; label: string; hint?: string }>,
        initialValue: initial,
      });
      return clack.isCancel(v) ? null : (v as typeof initial & string);
    },
  };
}

async function createInvitationViaGatewayOrStore(input: {
  ttlMinutes: number;
  label: string;
}): Promise<{ code: string; id: string; expiresAt: string }> {
  const { KoloClient, KoloNetworkError } = await import("@kodasoken/kurahi-client");
  try {
    const client = await KoloClient.local({});
    const res = await client.createPairInvitation({
      scope: "attach",
      ttlMinutes: input.ttlMinutes,
      label: input.label,
    });
    return { code: res.code, id: res.invitation.id, expiresAt: res.invitation.expiresAt };
  } catch (err) {
    if (!(err instanceof KoloNetworkError)) {
      throw err;
    }
    // Gateway not running: write the invitation to the credential store it loads at start.
    const { getCredentialStore, storeOptionsFromConfig } =
      await import("../../gateway/pair-store.js");
    const { loadConfig } = await import("../../config/config.js");
    const store = getCredentialStore(storeOptionsFromConfig(loadConfig().gateway?.pairing));
    const res = store.createInvitation({
      scope: "attach",
      ttlMs: input.ttlMinutes * 60_000,
      label: input.label,
      createdBy: "owner:cli",
      creatorScope: "owner",
    });
    if (!res.ok) {
      throw new Error(res.reason, { cause: err });
    }
    return { code: res.code, id: res.invitation.id, expiresAt: res.invitation.expiresAt };
  }
}

export async function createDefaultConnectDeps(input: {
  runtime?: RuntimeEnv;
  interactive: boolean;
}): Promise<ConnectDeps> {
  const { readConfigFileSnapshot, writeConfigFile } = await import("../../config/config.js");
  return {
    runtime: input.runtime ?? defaultRuntime,
    prompter: input.interactive ? await clackPrompter() : undefined,
    readConfig: async () => {
      const snapshot = await readConfigFileSnapshot();
      if (snapshot.exists && !snapshot.valid) {
        throw new Error(
          `config is invalid (${snapshot.issues[0]?.path || "<root>"}: ${snapshot.issues[0]?.message ?? "invalid"}); run kurahi doctor`,
        );
      }
      return snapshot.config;
    },
    writeConfig: writeConfigFile,
    secrets: () => resolveSecretStore(),
    renderQr: renderQrText,
    readStdin: readAllStdin,
    env: process.env,
    now: Date.now,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    probeGateway: probeLocalGateway,
    whatsappLink: async (args) => (await import("./whatsapp-link.js")).linkWhatsAppWithQr(args),
    telegramProbe: async (token) => {
      const { probeTelegram } = await import("../../telegram/probe.js");
      const res = await probeTelegram(token, 8000);
      return {
        ok: res.ok,
        username: res.bot?.username ?? undefined,
        error: res.error ?? undefined,
      };
    },
    lineProbe: async (token) => {
      const { probeLineBot } = await import("../../line/probe.js");
      const res = await probeLineBot(token, 8000);
      return res.ok
        ? { ok: true, basicId: res.bot?.basicId, displayName: res.bot?.displayName }
        : { ok: false, error: res.error };
    },
    createInvitation: createInvitationViaGatewayOrStore,
    lanAddress: () => pickLanIPv4(),
    tailnetAddress: () => pickPrimaryTailnetIPv4(),
  };
}

/** Run one flow. Never exits the process; the caller maps `exitCode`. */
export async function runConnect(deps: ConnectDeps, opts: ConnectOptions): Promise<ConnectResult> {
  try {
    switch (opts.channel) {
      case "whatsapp":
        return await connectWhatsApp(deps, opts);
      case "telegram":
        return await connectTelegram(deps, opts);
      case "line":
        return await connectLine(deps, opts);
      case "web":
        return await connectWeb(deps, opts);
    }
  } catch (err) {
    return {
      ok: false,
      channel: opts.channel,
      link: null,
      code: null,
      expiresAt: null,
      owner: null,
      exitCode: EXIT.error,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    ok: false,
    channel: opts.channel,
    link: null,
    code: null,
    expiresAt: null,
    owner: null,
    exitCode: EXIT.usage,
    message: `unknown channel ${String(opts.channel)}`,
  };
}

export async function runUnbind(
  deps: Pick<ConnectDeps, "env" | "readConfig" | "writeConfig" | "now">,
  input: { channel: PhoneChannel; accountId?: string },
): Promise<{ ok: boolean; exitCode: number; message: string; removed: string[] }> {
  if (input.channel === "web") {
    return {
      ok: false,
      exitCode: EXIT.usage,
      message:
        "the web channel has no owner binding; list devices with kurahi pair devices and remove one with kurahi pair revoke <fingerprint>",
      removed: [],
    };
  }
  const res = await unbindChannelOwner(
    { channel: input.channel, accountId: input.accountId },
    { env: deps.env, now: deps.now, readConfig: deps.readConfig, writeConfig: deps.writeConfig },
  );
  const removed = res.removed.map((o) => o.senderId);
  return {
    ok: true,
    exitCode: EXIT.ok,
    message:
      removed.length > 0
        ? `${input.channel}: owner binding removed (${removed.join(", ")}); ${res.codesWithdrawn} pending code(s) withdrawn`
        : `${input.channel}: no owner binding to remove; ${res.codesWithdrawn} pending code(s) withdrawn`,
    removed,
  };
}

/** Bindings for `kurahi connect --list`. */
export function listConnections(env?: NodeJS.ProcessEnv) {
  return listOwnerBindings({ env }).map((o) => ({
    channel: o.channel,
    account: o.accountId ?? "default",
    owner: o.senderId,
    via: o.via,
    boundAt: new Date(o.boundAt).toISOString(),
  }));
}
