import path from "node:path";

/** Real binary / npm package name; use for every printed command. */
export const CLI_BIN = "kolo";

/** Brand name for prose, banners and docs. Never use for printed commands. */
export const PRODUCT_NAME = "KoLo";

export const DEFAULT_CLI_NAME = CLI_BIN;

/** Lowercase prefix for files KoLo writes (logs, temp media): stable across CLI name casing. */
export const TEMP_FILE_PREFIX = "kolo";

const KNOWN_CLI_NAMES = new Set([CLI_BIN, PRODUCT_NAME]);
const CLI_PREFIX_RE = /^(?:((?:pnpm|npm|bunx|npx)\s+))?(KoLo|kolo)\b/;

export function resolveCliName(argv: string[] = process.argv): string {
  const argv1 = argv[1];
  if (!argv1) {
    return DEFAULT_CLI_NAME;
  }
  const base = path.basename(argv1).trim();
  if (KNOWN_CLI_NAMES.has(base)) {
    return CLI_BIN;
  }
  return DEFAULT_CLI_NAME;
}

export function replaceCliName(command: string, cliName = resolveCliName()): string {
  if (!command.trim()) {
    return command;
  }
  if (!CLI_PREFIX_RE.test(command)) {
    return command;
  }
  return command.replace(CLI_PREFIX_RE, (_match, runner: string | undefined) => {
    return `${runner ?? ""}${cliName}`;
  });
}
