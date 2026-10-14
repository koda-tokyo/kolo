// Types for scripts/release-prep.mjs (imported by src/packaging/release-prep.test.ts).
export const VERSION_RE: RegExp;
export function bumpVersion(current: string, spec: string, now?: Date): string;
export function parseChangelog(text: string): Array<{ version: string; body: string }>;
export function validateChangelogTop(
  text: string,
  version: string,
): { ok: true; notes: string } | { ok: false; reason: string };
export function extractChangelogNotes(text: string, version: string): string | null;
export function versionFiles(root: string): string[];
export function syncVersions(root: string, version: string): string[];
export function parseArgs(argv: string[]): {
  spec: string;
  dryRun: boolean;
  commit: boolean;
  tag: boolean;
  allowDirty: boolean;
};
export function main(
  argv?: string[],
  root?: string,
): { version: string; tag: string; changed: string[]; committed: boolean; tagged: boolean };
