// `kolo connect telegram`: guided bot setup. The bot token goes to the secrets store (never argv
// or logs); the config points at it with a `$secret` ref. A one-time code is printed as a deep
// link `https://t.me/<bot>?start=<code>` and as a QR; the first /start with that code binds the
// sender as the channel owner (see channels/resident/owner-binding.ts).
import type { ConnectDeps, ConnectOptions, ConnectResult } from "./types.js";
import { issueOwnerCode } from "../../channels/resident/owner-binding.js";
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

export async function connectTelegram(
  deps: ConnectDeps,
  opts: ConnectOptions,
): Promise<ConnectResult> {
  const say = sayer(deps, opts);
  if (deps.prompter && !opts.stdin) {
    say("Create a Telegram bot (one minute, on your phone or in a browser):");
    say("  1. Open https://t.me/BotFather and send /newbot");
    say("  2. Choose a display name and a username ending in 'bot'");
    say("  3. Copy the token BotFather sends back and paste it below");
    say("");
  }
  const name = channelSecretName("telegram", opts.accountId, "botToken");
  const secrets = await collectSecrets(deps, opts, [
    { name, label: "Telegram bot token", envVar: "TELEGRAM_BOT_TOKEN" },
  ]);
  if ("error" in secrets) {
    return fail("telegram", secrets.error === "cancelled" ? EXIT.error : EXIT.usage, secrets.error);
  }
  const [token] = secrets.values;
  const probe = await deps.telegramProbe(token);
  if (!probe.ok || !probe.username) {
    return fail(
      "telegram",
      EXIT.error,
      `Telegram rejected the bot token (${probe.error ?? "no bot username"}). Check it with BotFather and run kolo connect telegram again`,
    );
  }
  deps.secrets().set(name, token);
  const cfg = await deps.readConfig();
  await deps.writeConfig(withChannelSecrets(cfg, "telegram", opts.accountId, { botToken: name }));

  const startedAt = deps.now();
  const issued = issueOwnerCode({
    channel: "telegram",
    accountId: opts.accountId,
    env: deps.env,
    now: deps.now,
  });
  const link = `https://t.me/${probe.username}?start=${issued.code}`;
  say(`bot        @${probe.username} (token stored as ${name})`);
  say("Scan with your phone camera, or open the link, then press Start:");
  printQr(deps, opts, link);
  say(`link       ${link}`);
  say(
    `code       ${issued.code} (single use, expires in ${formatExpiry(issued.expiresAt, startedAt)})`,
  );

  const gatewayUp = await deps.probeGateway(cfg);
  if (!gatewayUp) {
    say("");
    say("The gateway is not running here. Start it before the code expires so it can receive the");
    say("first message: kolo service install (or kolo gateway in another terminal).");
  }
  let owner: string | null = null;
  const shouldWait = opts.wait ?? (Boolean(deps.prompter) && gatewayUp);
  if (shouldWait) {
    say("");
    say("Waiting for your first message (Ctrl-C to stop waiting; the code stays valid)...");
    const bound = await waitForOwner(deps, "telegram", opts.accountId, startedAt, issued.expiresAt);
    if (bound) {
      owner = bound.senderId;
      say(`owner      telegram user ${bound.senderId} bound. Your resident answers you there.`);
    } else {
      say("No message arrived before the code expired. Run kolo connect telegram for a new code.");
    }
  }
  return {
    ok: true,
    channel: "telegram",
    link,
    code: issued.code,
    expiresAt: new Date(issued.expiresAt).toISOString(),
    owner,
    exitCode: EXIT.ok,
    message: owner ? "owner bound" : "waiting for the first message with the code",
  };
}
