// `<KOLO_HOME>/env`: KEY=VALUE lines read by systemd (EnvironmentFile=) and by the runner on
// macOS/Windows. Secrets live here (mode 0600), never in unit files, plists or argv.
import fs from "node:fs";
import path from "node:path";

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!KEY_PATTERN.test(key)) {
      continue;
    }
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\(["\\$`n])/g, (_m, ch: string) => (ch === "n" ? "\n" : ch));
      }
    }
    out[key] = value;
  }
  return out;
}

export function readEnvFile(file: string): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export const ENV_FILE_TEMPLATE = `# KoLo service environment (KEY=VALUE, one per line). Read by the OS service on start.
# Keep this file private (mode 0600). Never put secrets in kolo.json, unit files or argv.
# The gateway token is read from <KOLO_HOME>/secrets/gateway.token (0600), created on first start.
# To use another file, set its PATH here (never the token value):
# KOLO_GATEWAY_TOKEN_FILE=
`;

/** Create the env file with mode 0600 if it does not exist yet; never overwrites. */
export function ensureEnvFile(file: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, ENV_FILE_TEMPLATE, { flag: "wx", mode: 0o600 });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw err;
  }
}
