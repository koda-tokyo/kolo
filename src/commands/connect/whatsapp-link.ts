// The real WhatsApp linker behind `kurahi connect whatsapp`: the same linked-device login the
// WhatsApp extension uses (`kurahi channels login`), but the pairing QR is handed to the caller so
// it is rendered by `kurahi connect` instead of printed by the socket. Loaded lazily: importing it
// pulls in the WhatsApp Web client.
import type { WhatsAppLinker } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { resolveWhatsAppAccount } from "../../web/accounts.js";
import { readWebSelfId, webAuthExists } from "../../web/auth-store.js";
import { createWaSocket, getStatusCode, waitForWaConnection } from "../../web/session.js";

const RESTART_AFTER_PAIRING = 515;

export const linkWhatsAppWithQr: WhatsAppLinker = async ({ accountId, force, onQr }) => {
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId });
  if (!force && (await webAuthExists(account.authDir))) {
    const self = readWebSelfId(account.authDir);
    return { e164: self.e164, jid: self.jid, alreadyLinked: true };
  }
  const sock = await createWaSocket(false, false, { authDir: account.authDir, onQr });
  try {
    await waitForWaConnection(sock);
  } catch (err) {
    if (getStatusCode(err) !== RESTART_AFTER_PAIRING) {
      throw err;
    }
    // WhatsApp asks for one reconnect right after pairing; the credentials are already saved.
    try {
      sock.ws?.close();
    } catch {
      // ignore
    }
    const retry = await createWaSocket(false, false, { authDir: account.authDir });
    try {
      await waitForWaConnection(retry);
    } finally {
      setTimeout(() => retry.ws?.close(), 500).unref?.();
    }
  } finally {
    setTimeout(() => {
      try {
        sock.ws?.close();
      } catch {
        // ignore
      }
    }, 500).unref?.();
  }
  const self = readWebSelfId(account.authDir);
  return { e164: self.e164, jid: self.jid, alreadyLinked: false };
};
