// `kolo connect line`: guided Messaging API setup. The channel secret and access token go to the
// secrets store; the config points at them with `$secret` refs. LINE delivers messages only to a
// public HTTPS webhook, so the flow prints the URL to register and the documented ways to expose
// it; it never creates a tunnel itself. A QR of the bot's add-friend URL and a one-time code
// follow: the first message carrying the code binds the sender as the channel owner.
import type { ConnectDeps, ConnectOptions, ConnectResult } from "./types.js";
import { issueOwnerCode } from "../../channels/resident/owner-binding.js";
import { resolveGatewayPort } from "../../config/paths.js";
import { DOCS_URL } from "../../config/product-urls.js";
import {
  EXIT,
  channelSecretName,
  collectSecrets,
  fail,
  formatExpiry,
  printQr,
  sayer,
  waitForOwner,
  withChannelSecrets,
} from "./shared.js";

function webhookPathOf(cfg: Record<string, unknown>, accountId?: string): string {
  const line = (cfg.channels as Record<string, unknown> | undefined)?.line as
    | { webhookPath?: string; accounts?: Record<string, { webhookPath?: string }> }
    | undefined;
  const fromAccount = accountId ? line?.accounts?.[accountId]?.webhookPath : undefined;
  return fromAccount ?? line?.webhookPath ?? "/line/webhook";
}

export function lineAddFriendUrl(basicId: string): string {
  return `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
}

export async function connectLine(deps: ConnectDeps, opts: ConnectOptions): Promise<ConnectResult> {
  const say = sayer(deps, opts);
  if (deps.prompter && !opts.stdin) {
    say("Set up a LINE Messaging API channel (LINE Developers console):");
    say("  1. Open https://developers.line.biz/console/ and create a Messaging API channel");
    say("  2. Basic settings: copy the Channel secret");
    say("  3. Messaging API: issue a Channel access token (long-lived) and copy it");
    say("");
  }
  const secretName = channelSecretName("line", opts.accountId, "channelSecret");
  const tokenName = channelSecretName("line", opts.accountId, "channelAccessToken");
  const secrets = await collectSecrets(deps, opts, [
    { name: secretName, label: "LINE channel secret", envVar: "LINE_CHANNEL_SECRET" },
    { name: tokenName, label: "LINE channel access token", envVar: "LINE_CHANNEL_ACCESS_TOKEN" },
  ]);
  if ("error" in secrets) {
    return fail("line", secrets.error === "cancelled" ? EXIT.error : EXIT.usage, secrets.error);
  }
  const [channelSecret, accessToken] = secrets.values;
  const probe = await deps.lineProbe(accessToken);
  if (!probe.ok || !probe.basicId) {
    return fail(
      "line",
      EXIT.error,
      `LINE rejected the channel access token (${probe.error ?? "no bot id"}). Issue a new one in the console and run kolo connect line again`,
    );
  }
  const store = deps.secrets();
  store.set(secretName, channelSecret);
  store.set(tokenName, accessToken);
  const cfg = await deps.readConfig();
  await deps.writeConfig(
    withChannelSecrets(cfg, "line", opts.accountId, {
      channelSecret: secretName,
      channelAccessToken: tokenName,
    }),
  );

  const port = resolveGatewayPort(cfg);
  const webhookPath = webhookPathOf(cfg as Record<string, unknown>, opts.accountId);
  say(`bot        ${probe.displayName ?? probe.basicId} (${probe.basicId}); secrets stored`);
  say("");
  say("Webhook. LINE sends messages only to a public HTTPS URL. Register this in the console");
  say("(Messaging API > Webhook URL, then enable Use webhook):");
  say(`  https://<your-public-host>${webhookPath}  ->  this gateway, port ${port}`);
  say("Ways to get a public HTTPS host for the gateway (KoLo does not create one for you):");
  say(`  - a public funnel from your tailnet: ${DOCS_URL}/gateway/tailscale`);
  say("  - a reverse proxy with a TLS certificate on a host you control");
  say("  - a tunnel service you already operate");
  say(`Details: ${DOCS_URL}/channels/line`);

  const startedAt = deps.now();
  const issued = issueOwnerCode({
    channel: "line",
    accountId: opts.accountId,
    env: deps.env,
    now: deps.now,
  });
  const link = lineAddFriendUrl(probe.basicId);
  say("");
  say("Scan to add the bot as a friend, then send the code below as your first message:");
  printQr(deps, opts, link);
  say(`add friend ${link}`);
  say(
    `code       ${issued.code} (single use, expires in ${formatExpiry(issued.expiresAt, startedAt)})`,
  );

  const gatewayUp = await deps.probeGateway(cfg);
  let owner: string | null = null;
  const shouldWait = opts.wait ?? (Boolean(deps.prompter) && gatewayUp);
  if (!gatewayUp) {
    say("");
    say(
      "The gateway is not running here. Start it and finish the webhook before the code expires:",
    );
    say("kolo service install (or kolo gateway in another terminal).");
  }
  if (shouldWait) {
    say("");
    say("Waiting for your first message (Ctrl-C to stop waiting; the code stays valid)...");
    const bound = await waitForOwner(deps, "line", opts.accountId, startedAt, issued.expiresAt);
    if (bound) {
      owner = bound.senderId;
      say(`owner      LINE user ${bound.senderId} bound. Your resident answers you there.`);
    } else {
      say("No message arrived before the code expired. Run kolo connect line for a new code.");
    }
  }
  return {
    ok: true,
    channel: "line",
    link,
    code: issued.code,
    expiresAt: new Date(issued.expiresAt).toISOString(),
    owner,
    exitCode: EXIT.ok,
    message: owner ? "owner bound" : "waiting for the first message with the code",
  };
}
