// The factory (KoLo 2.0, M15): shared types. A board holds cards; a card is one goal on its way
// from the inbox to a reviewed pull request. Nothing here runs at import time.

export const FACTORY_COLUMNS = [
  "inbox",
  "spec",
  "build",
  "review",
  "ready",
  "merged",
  "failed",
] as const;
export type FactoryColumn = (typeof FACTORY_COLUMNS)[number];

/** Columns a card can never leave. */
export const FACTORY_TERMINAL_COLUMNS: ReadonlySet<FactoryColumn> = new Set<FactoryColumn>([
  "merged",
]);

export const FACTORY_TIMELINE_KINDS = [
  "created",
  "moved",
  "comment",
  "run",
  "engine",
  "job",
  "evidence",
  "pr",
  "merge",
  "error",
] as const;
export type FactoryTimelineKind = (typeof FACTORY_TIMELINE_KINDS)[number];

export type FactoryTimelineEntry = {
  seq: number;
  /** ISO-8601 timestamp. */
  ts: string;
  kind: FactoryTimelineKind;
  /** Who caused the entry: a resident id, "owner:…", "device:…", "runner" or "engine". */
  by: string;
  text: string;
  data?: Record<string, unknown>;
};

export type FactoryCardPolicy = {
  /** Merge through the engine as soon as the run is ready (needs the merge permission). */
  autoMerge: boolean;
};

export type FactoryPullRequest = {
  url: string;
  number?: number;
  branch: string;
  base?: string;
  openedAt: string;
};

export type FactoryCard = {
  id: string;
  boardId: string;
  title: string;
  goal: string;
  /** Absolute path of the git checkout the engine works in. */
  repo: string;
  /** Resident (agent id) that owns the card. */
  owner: string;
  column: FactoryColumn;
  createdAt: string;
  updatedAt: string;
  /** KIP engine task id once a run was started. */
  engineTaskId: string | null;
  /** Engine branch holding the result (kip/<specId>) once known. */
  branch: string | null;
  /** Jobs in the jobs registry that ran for this card (newest last). */
  jobIds: string[];
  /** Evidence bundle ids (job ids with a recorded evidence log). */
  evidenceIds: string[];
  pr: FactoryPullRequest | null;
  policy: FactoryCardPolicy;
  /** Set while a run is in progress (the job id). */
  runningJobId: string | null;
  summary: string | null;
  error: string | null;
  timeline: FactoryTimelineEntry[];
};

export type FactoryBoard = {
  id: string;
  name: string;
  /** Default repository for cards on this board (absolute path), when set. */
  repo: string | null;
  columns: readonly FactoryColumn[];
  createdAt: string;
  updatedAt: string;
};

/** Transitions the state machine accepts, by source column. */
export const FACTORY_TRANSITIONS: Readonly<Record<FactoryColumn, readonly FactoryColumn[]>> = {
  inbox: ["spec", "failed"],
  spec: ["build", "inbox", "failed"],
  build: ["review", "spec", "failed"],
  review: ["ready", "build", "failed"],
  ready: ["merged", "review", "failed"],
  merged: [],
  failed: ["inbox"],
};

export type FactoryEvent =
  | { kind: "board.created"; board: FactoryBoard }
  | { kind: "card.created"; card: FactoryCard }
  | { kind: "card.updated"; card: FactoryCard; entry: FactoryTimelineEntry }
  | { kind: "card.moved"; card: FactoryCard; from: FactoryColumn; to: FactoryColumn };

/** Summary of a card without its timeline (lists, broadcasts). */
export type FactoryCardSummary = Omit<FactoryCard, "timeline"> & {
  timelineLength: number;
  lastEntry: FactoryTimelineEntry | null;
};

export function summarizeCard(card: FactoryCard): FactoryCardSummary {
  const { timeline, ...rest } = card;
  return {
    ...rest,
    timelineLength: timeline.length,
    lastEntry: timeline.length > 0 ? timeline[timeline.length - 1] : null,
  };
}
