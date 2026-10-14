// `kolo connect whatsapp`: the WhatsApp extension's linked-device login, with the pairing QR
// rendered in this terminal. Scanning it from WhatsApp > Linked devices proves possession of the
// number, so the linked number is bound as the channel owner directly (no code). The owner talks
// to the resident in "Message yourself"; the first message gets a one-line welcome.
import type { ConnectDeps, ConnectOptions, ConnectResult } from "./types.js";
import { bindChannelOwner } from "../../channels/resident/owner-binding.js";
import { EXIT, fail, printQr, sayer } from "./shared.js";

export async function connectWhatsApp(
  deps: ConnectDeps,
  opts: ConnectOptions,
): Promise<ConnectResult> {
  const say = sayer(deps, opts);
  say("On your phone: WhatsApp > Settings > Linked devices > Link a device, then scan:");
  let shown = 0;
  let linked: Awaited<ReturnType<ConnectDeps["whatsappLink"]>>;
  try {
    linked = await deps.whatsappLink({
      accountId: opts.accountId,
      force: opts.force,
      onQr: (qr) => {
        // The pairing QR rotates about every 20 seconds; each refresh is printed again.
        shown += 1;
        if (shown > 1) {
          say("The code refreshed; scan this one:");
        }
        printQr(deps, opts, qr);
      },
    });
  } catch (err) {
    return fail(
      "whatsapp",
      EXIT.error,
      `WhatsApp linking did not finish (${err instanceof Error ? err.message : String(err)}). Run kolo connect whatsapp again`,
    );
  }
  if (linked.alreadyLinked) {
    say("WhatsApp is already linked on this machine (kolo connect whatsapp --force relinks).");
  }
  if (!linked.e164) {
    return fail(
      "whatsapp",
      EXIT.error,
      "Linked, but the phone number could not be read from the session. Add it by hand: kolo config set channels.whatsapp.identities.<+number> owner",
    );
  }
  await bindChannelOwner(
    {
      channel: "whatsapp",
      accountId: opts.accountId,
      senderId: linked.e164,
      via: "linked-device",
      welcomePending: true,
      // The linked number is always admitted to its own chat; the allowlist stays as it is.
      skipAllowFrom: true,
    },
    { env: deps.env, now: deps.now, readConfig: deps.readConfig, writeConfig: deps.writeConfig },
  );
  const cfg = await deps.readConfig();
  const gatewayUp = await deps.probeGateway(cfg);
  say(`linked     ${linked.e164} (owner)`);
  say('Open WhatsApp, choose "Message yourself" and write a message; your resident answers there.');
  if (!gatewayUp) {
    say("The gateway is not running here yet: kolo service install (or kolo gateway).");
  }
  return {
    ok: true,
    channel: "whatsapp",
    link: null,
    code: null,
    expiresAt: null,
    owner: linked.e164,
    exitCode: EXIT.ok,
    message: "linked; owner bound",
  };
}
