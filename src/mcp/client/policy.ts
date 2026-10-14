// Which tools of an MCP server the gateway exposes (KoLo 2.0, M6). Default deny for anything
// that looks like it executes or mutates: those need an explicit `allowTools` match.

const EXEC_LIKE_WORDS = new Set([
  "exec",
  "execute",
  "shell",
  "bash",
  "sh",
  "zsh",
  "powershell",
  "cmd",
  "command",
  "run",
  "spawn",
  "terminal",
  "process",
  "kill",
  "sudo",
  "eval",
  "script",
  "delete",
  "remove",
  "rm",
  "rmdir",
  "unlink",
  "write",
  "overwrite",
  "truncate",
  "move",
  "mv",
  "rename",
  "chmod",
  "chown",
  "install",
  "uninstall",
  "deploy",
  "drop",
]);

/** `run_command`, `shellExec`, `files.delete`, `rm` … → true; `read_file`, `search` → false. */
export function isExecLikeToolName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((w) => EXEC_LIKE_WORDS.has(w));
}

export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .trim()
    .toLowerCase()
    .split("*")
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/**
 * Whether a server tool is exposed. `allowTools` globs match the bare tool name or the
 * `mcp:<server>:<tool>` id. Without `allowTools`, everything non-exec-like is exposed.
 */
export function mcpToolExposed(params: {
  server: string;
  tool: string;
  allowTools?: readonly string[];
}): { exposed: boolean; execLike: boolean; reason?: string } {
  const execLike = isExecLikeToolName(params.tool);
  const id = `mcp:${params.server}:${params.tool}`.toLowerCase();
  const name = params.tool.toLowerCase();
  const allow = params.allowTools?.map((p) => p.trim()).filter(Boolean) ?? [];
  const matched = allow.some((p) => {
    const re = globToRegExp(p);
    return re.test(name) || re.test(id);
  });
  if (allow.length > 0) {
    if (!matched) {
      return { exposed: false, execLike, reason: "not in allowTools" };
    }
    if (execLike && allow.every((p) => p.trim() === "*" || p.trim() === "mcp:*")) {
      return {
        exposed: false,
        execLike,
        reason: "exec-like tool needs a specific allowTools glob",
      };
    }
    return { exposed: true, execLike };
  }
  if (execLike) {
    return { exposed: false, execLike, reason: "exec-like tool denied by default" };
  }
  return { exposed: true, execLike };
}
