import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { TEMP_FILE_PREFIX } from "./cli-name.js";

export type CanvasSnapshotPayload = {
  format: string;
  base64: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseCanvasSnapshotPayload(value: unknown): CanvasSnapshotPayload {
  const obj = asRecord(value);
  const format = asString(obj.format);
  const base64 = asString(obj.base64);
  if (!format || !base64) {
    throw new Error("invalid canvas.snapshot payload");
  }
  return { format, base64 };
}

export function canvasSnapshotTempPath(opts: { ext: string; tmpDir?: string; id?: string }) {
  const tmpDir = opts.tmpDir ?? os.tmpdir();
  const id = opts.id ?? randomUUID();
  const ext = opts.ext.startsWith(".") ? opts.ext : `.${opts.ext}`;
  // Temp artefacts use the lowercase file prefix (same as logs), not the display CLI name.
  return path.join(tmpDir, `${TEMP_FILE_PREFIX}-canvas-snapshot-${id}${ext}`);
}
