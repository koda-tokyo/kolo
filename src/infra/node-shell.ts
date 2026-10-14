// Shell by design: `system.run` on a paired node executes an operator/agent shell command on that
// node (gated by the node exec-approval policy). Callers pass argv; no host shell is involved.
export function buildNodeShellCommand(command: string, platform?: string | null) {
  const normalized = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (normalized.startsWith("win")) {
    return ["cmd.exe", "/d", "/s", "/c", command];
  }
  return ["/bin/sh", "-lc", command];
}
