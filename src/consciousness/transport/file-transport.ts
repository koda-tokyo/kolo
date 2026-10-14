// src/consciousness/transport/file-transport.ts
//
// Filesystem-based transport for local inter-agent messaging.
// Each message is a file: {baseDir}/inboxes/{agent}/msg-{ts}-{uid}.json
// Atomic writes (tmp + rename) prevent partial reads.

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Transport } from "./types.js";
import { resolveSharedKoloHome } from "../../config/kolo-home.js";

function defaultBaseDir(teamName: string): string {
  return join(resolveSharedKoloHome(), "transport", teamName);
}

function inboxDir(baseDir: string, agentName: string): string {
  const dir = join(baseDir, "inboxes", agentName);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export class FileTransport implements Transport {
  readonly name = "file";
  private readonly baseDir: string;

  constructor(teamName: string, baseDir?: string) {
    this.baseDir = baseDir ?? defaultBaseDir(teamName);
    mkdirSync(join(this.baseDir, "inboxes"), { recursive: true });
  }

  async deliver(recipient: string, data: Uint8Array): Promise<void> {
    const inbox = inboxDir(this.baseDir, recipient);
    const ts = Date.now();
    const uid = randomUUID().slice(0, 8);
    const filename = `msg-${ts}-${uid}.json`;
    const tmp = join(inbox, `.tmp-${uid}.json`);
    const target = join(inbox, filename);

    try {
      writeFileSync(tmp, data);
      renameSync(tmp, target);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore cleanup failure */
      }
      throw new Error(`FileTransport: failed to deliver to ${recipient}`);
    }
  }

  async fetch(agentName: string, limit = 10, consume = true): Promise<Uint8Array[]> {
    const inbox = inboxDir(this.baseDir, agentName);
    const files = readdirSync(inbox)
      .filter((f) => f.startsWith("msg-") && f.endsWith(".json"))
      .sort(); // Chronological by timestamp prefix

    const messages: Uint8Array[] = [];
    for (const f of files.slice(0, limit)) {
      const filepath = join(inbox, f);
      try {
        if (consume) {
          const consumed = join(inbox, f.replace(".json", ".consumed"));
          try {
            renameSync(filepath, consumed);
          } catch {
            continue; // Another process consumed it
          }
          try {
            const raw = readFileSync(consumed);
            messages.push(new Uint8Array(raw));
          } finally {
            try {
              unlinkSync(consumed);
            } catch {
              /* ignore */
            }
          }
        } else {
          const raw = readFileSync(filepath);
          messages.push(new Uint8Array(raw));
        }
      } catch {
        continue;
      }
    }
    return messages;
  }

  async count(agentName: string): Promise<number> {
    const inbox = inboxDir(this.baseDir, agentName);
    try {
      return readdirSync(inbox).filter((f) => f.startsWith("msg-") && f.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  async listRecipients(): Promise<string[]> {
    const inboxesDir = join(this.baseDir, "inboxes");
    try {
      return readdirSync(inboxesDir).filter(
        (d) => !d.startsWith(".") && !d.startsWith("_pending_"),
      );
    } catch {
      return [];
    }
  }

  async close(): Promise<void> {
    // No resources to release for file transport
  }
}
