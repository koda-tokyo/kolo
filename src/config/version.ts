export type KoLoVersion = {
  major: number;
  minor: number;
  patch: number;
  revision: number;
};

/** Majors at or above this are calendar versions, older than any product version. */
export const CALENDAR_VERSION_MIN_MAJOR = 2000;

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-(\d+))?/;

export function parseKoLoVersion(raw: string | null | undefined): KoLoVersion | null {
  if (!raw) {
    return null;
  }
  const match = raw.trim().match(VERSION_RE);
  if (!match) {
    return null;
  }
  const [, major, minor, patch, revision] = match;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    revision: revision ? Number.parseInt(revision, 10) : 0,
  };
}

export function compareKoLoVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const parsedA = parseKoLoVersion(a);
  const parsedB = parseKoLoVersion(b);
  if (!parsedA || !parsedB) {
    return null;
  }
  // Calendar versions (2026.2.1-kolo.1) predate the semantic product line (2.0.0).
  const calA = parsedA.major >= CALENDAR_VERSION_MIN_MAJOR;
  const calB = parsedB.major >= CALENDAR_VERSION_MIN_MAJOR;
  if (calA !== calB) {
    return calA ? -1 : 1;
  }
  if (parsedA.major !== parsedB.major) {
    return parsedA.major < parsedB.major ? -1 : 1;
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor < parsedB.minor ? -1 : 1;
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch < parsedB.patch ? -1 : 1;
  }
  if (parsedA.revision !== parsedB.revision) {
    return parsedA.revision < parsedB.revision ? -1 : 1;
  }
  return 0;
}
