// `kurahi connect web`: open the dashboard on a phone browser. A one-shot pairing invitation (M3a,
// scope attach, 10 minutes) is rendered as a QR of `<dashboard URL>#pair=<code>`; the dashboard
// redeems it with a device key it keeps in the browser. The code sits in the URL fragment, which
// browsers never send to a server or in a Referer.
//
// Offered only when the gateway is reachable from the phone: bind lan, tailnet or custom, which
// `kurahi init` sets together with gateway.remote.enabled (explicit opt-in, M2). On loopback the
// flow explains why and how to enable it. Browsers keep device keys only on secure pages, so the
// dashboard must be served over HTTPS (gateway.tls).
import type { KoLoConfig } from "../../config/config.js";
import type { ConnectDeps, ConnectOptions, ConnectResult } from "./types.js";
import { resolveGatewayPort } from "../../config/paths.js";
import { DOCS_URL } from "../../config/product-urls.js";
import { EXIT, fail, printQr, sayer } from "./shared.js";

export const WEB_PAIR_TTL_MINUTES = 10;

export type PhoneDashboard =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: "loopback" | "no-address" | "insecure"; detail: string };

function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

/** Where a phone on the same network or tailnet reaches the dashboard, or why it cannot. */
export function resolvePhoneDashboard(
  cfg: KoLoConfig,
  deps: Pick<ConnectDeps, "lanAddress" | "tailnetAddress">,
): PhoneDashboard {
  const bind = cfg.gateway?.bind ?? "loopback";
  if (bind === "loopback" || bind === "auto") {
    return {
      ok: false,
      reason: "loopback",
      detail:
        "The gateway listens on this computer only (gateway.bind loopback), so a phone cannot reach the dashboard. To allow devices on your network or tailnet, run kurahi init --bind lan (or --bind tailnet), which also sets gateway.remote.enabled, restart the gateway, then run kurahi connect web.",
    };
  }
  const port = resolveGatewayPort(cfg);
  const base = normalizeBasePath(cfg.gateway?.controlUi?.basePath);
  const host =
    bind === "custom"
      ? cfg.gateway?.customBindHost?.trim()
      : bind === "tailnet"
        ? deps.tailnetAddress()
        : deps.lanAddress();
  if (!host) {
    return {
      ok: false,
      reason: "no-address",
      detail: `no ${bind === "tailnet" ? "tailnet" : bind === "custom" ? "gateway.customBindHost" : "network"} address found on this machine`,
    };
  }
  if (cfg.gateway?.tls?.enabled !== true) {
    return {
      ok: false,
      reason: "insecure",
      detail: `Phone browsers keep a device key only on HTTPS pages, and the dashboard at http://${host}:${port}${base} is plain HTTP. Enable TLS (kurahi config set gateway.tls.enabled true; a self-signed certificate is generated, your phone asks you to trust it once), restart the gateway, then run kurahi connect web. Docs: ${DOCS_URL}/gateway/security`,
    };
  }
  return { ok: true, url: `https://${host}:${port}${base}`, host };
}

export async function connectWeb(deps: ConnectDeps, opts: ConnectOptions): Promise<ConnectResult> {
  const say = sayer(deps, opts);
  const cfg = await deps.readConfig();
  const where = resolvePhoneDashboard(cfg, deps);
  if (!where.ok) {
    return fail("web", EXIT.error, where.detail);
  }
  let invitation: Awaited<ReturnType<ConnectDeps["createInvitation"]>>;
  try {
    invitation = await deps.createInvitation({
      ttlMinutes: WEB_PAIR_TTL_MINUTES,
      label: "phone browser",
    });
  } catch (err) {
    return fail(
      "web",
      EXIT.unreachable,
      `could not create the pairing invitation (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const link = `${where.url}#pair=${encodeURIComponent(invitation.code)}`;
  say("Scan with your phone camera on the same network or tailnet. The dashboard opens and pairs");
  say("this phone with attach scope (chat and watch; no configuration changes):");
  printQr(deps, opts, link);
  say(`dashboard  ${where.url}`);
  say(
    `expires    ${invitation.expiresAt} (single use; kurahi pair revoke ${invitation.id} withdraws it)`,
  );
  return {
    ok: true,
    channel: "web",
    link,
    code: invitation.code,
    expiresAt: invitation.expiresAt,
    owner: null,
    exitCode: EXIT.ok,
    message: "invitation created",
  };
}
