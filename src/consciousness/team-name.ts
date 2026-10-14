// The consciousness team namespaces the shared transport, task and event folders under the
// shared state root. Operators who run several residents as one team pick the name with
// KOLO_TEAM_NAME; the default suits a single installation.
export const DEFAULT_TEAM_NAME = "kolo-team";

export function resolveTeamName(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.KOLO_TEAM_NAME?.trim();
  return raw && /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : DEFAULT_TEAM_NAME;
}
