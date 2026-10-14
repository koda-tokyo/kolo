// Zip in and out for evidence bundles (KoLo 2.0, M12b), on the dependency the updater already
// uses. A bundle is a flat map of relative paths to bytes; nothing is executed from it.
import JSZip from "jszip";

export type BundleFiles = Map<string, Buffer>;

export async function writeZip(files: BundleFiles): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of [...files.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    zip.file(name, data, { date: new Date(0), compression: "DEFLATE" });
  }
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const SAFE_ENTRY = /^(?!\/)(?!.*(^|\/)\.\.(\/|$)).+$/;

export async function readZip(buffer: Buffer, maxBytes = 512 * 1024 * 1024): Promise<BundleFiles> {
  const zip = await JSZip.loadAsync(buffer);
  const out: BundleFiles = new Map();
  let total = 0;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue;
    }
    if (name.includes("\0") || !SAFE_ENTRY.test(name)) {
      throw new Error(`zip entry has an unsafe path: ${name}`);
    }
    const data = await entry.async("nodebuffer");
    total += data.length;
    if (total > maxBytes) {
      throw new Error(`zip larger than ${maxBytes} bytes when extracted`);
    }
    out.set(name, data);
  }
  return out;
}
