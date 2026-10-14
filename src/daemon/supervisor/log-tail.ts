import fs from "node:fs/promises";

/** Read at most the last `maxBytes` of a file (and at most `maxLines` lines). Missing file → "". */
export async function readTailBytes(
  file: string,
  maxBytes: number,
  maxLines?: number,
): Promise<string> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(file, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, Math.max(maxBytes, 0));
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, size - length);
    let text = buf.toString("utf8");
    if (length < size) {
      // Drop the partial first line.
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : text;
    }
    if (maxLines !== undefined && maxLines > 0) {
      const lines = text.split("\n");
      const trailing = lines.at(-1) === "" ? 1 : 0;
      text = lines.slice(-(maxLines + trailing)).join("\n");
    }
    return text;
  } catch {
    return "";
  } finally {
    await handle?.close();
  }
}
