// Factory store (KoLo 2.0, M15a): boards and cards under <KOLO_HOME>/factory/<boardId>/, one
// JSON file per board (board.json) and per card (cards/<cardId>.json). The in-memory registry is
// authoritative while the gateway runs; files are written atomically on every change so a restart
// finds the same board. Every transition goes through the state machine and is audited; listeners
// (the gateway broadcaster) receive one FactoryEvent per change.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  FactoryBoard,
  FactoryCard,
  FactoryCardPolicy,
  FactoryColumn,
  FactoryEvent,
  FactoryPullRequest,
  FactoryTimelineEntry,
  FactoryTimelineKind,
} from "./types.js";
import { auditSafe } from "../audit/audit-log.js";
import { resolveStateDir } from "../config/paths.js";
import { assertTransition, FactoryTransitionError } from "./state.js";
import { FACTORY_COLUMNS, FACTORY_TERMINAL_COLUMNS } from "./types.js";

export { FactoryTransitionError };

export const DEFAULT_BOARD_ID = "main";
export const DEFAULT_MAX_TIMELINE = 500;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_GOAL_CHARS = 20_000;
const MAX_TITLE_CHARS = 200;
const MAX_TEXT_CHARS = 4000;

export class FactoryNotFoundError extends Error {
  constructor(what: "board" | "card", id: string) {
    super(`${what} not found: ${id}`);
    this.name = "FactoryNotFoundError";
  }
}

export class FactoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactoryInputError";
  }
}

export function isSafeFactoryId(id: string): boolean {
  return ID_RE.test(id);
}

export function resolveFactoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "factory");
}

type Registry = {
  boards: Map<string, FactoryBoard>;
  cards: Map<string, FactoryCard>;
  loaded: boolean;
};

const registry: Registry = { boards: new Map(), cards: new Map(), loaded: false };
const listeners = new Set<(event: FactoryEvent) => void>();
let maxTimeline = DEFAULT_MAX_TIMELINE;
// Write order within one process: breaks same-millisecond ties in listCards deterministically.
let touchSeq = 0;
const touched = new Map<string, number>();
let envOverride: NodeJS.ProcessEnv | undefined;

/** Options the gateway sets once from config; tests reset them. */
export function configureFactoryStore(opts: {
  maxTimelineEntries?: number;
  env?: NodeJS.ProcessEnv;
}): void {
  if (typeof opts.maxTimelineEntries === "number" && opts.maxTimelineEntries >= 20) {
    maxTimeline = opts.maxTimelineEntries;
  }
  if (opts.env) {
    envOverride = opts.env;
  }
}

function env(): NodeJS.ProcessEnv {
  return envOverride ?? process.env;
}

export function onFactoryEvent(listener: (event: FactoryEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: FactoryEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A listener must never break a transition.
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function boardFile(boardId: string): string {
  return path.join(resolveFactoryDir(env()), boardId, "board.json");
}

function cardFile(card: Pick<FactoryCard, "id" | "boardId">): string {
  return path.join(resolveFactoryDir(env()), card.boardId, "cards", `${card.id}.json`);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function isColumn(value: unknown): value is FactoryColumn {
  return typeof value === "string" && (FACTORY_COLUMNS as readonly string[]).includes(value);
}

function normalizeCard(raw: unknown): FactoryCard | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const c = raw as Partial<FactoryCard>;
  if (typeof c.id !== "string" || typeof c.boardId !== "string" || !isColumn(c.column)) {
    return null;
  }
  return {
    id: c.id,
    boardId: c.boardId,
    title: typeof c.title === "string" ? c.title : "",
    goal: typeof c.goal === "string" ? c.goal : "",
    repo: typeof c.repo === "string" ? c.repo : "",
    owner: typeof c.owner === "string" ? c.owner : "",
    column: c.column,
    createdAt: typeof c.createdAt === "string" ? c.createdAt : nowIso(),
    updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : nowIso(),
    engineTaskId: typeof c.engineTaskId === "string" ? c.engineTaskId : null,
    branch: typeof c.branch === "string" ? c.branch : null,
    jobIds: Array.isArray(c.jobIds) ? c.jobIds.filter((j) => typeof j === "string") : [],
    evidenceIds: Array.isArray(c.evidenceIds)
      ? c.evidenceIds.filter((j) => typeof j === "string")
      : [],
    pr: c.pr && typeof c.pr === "object" && typeof c.pr.url === "string" ? c.pr : null,
    policy: { autoMerge: c.policy?.autoMerge === true },
    // A run that was in progress belongs to a process that no longer exists.
    runningJobId: null,
    summary: typeof c.summary === "string" ? c.summary : null,
    error: typeof c.error === "string" ? c.error : null,
    timeline: Array.isArray(c.timeline)
      ? c.timeline.filter(
          (e): e is FactoryTimelineEntry =>
            Boolean(e) && typeof e === "object" && typeof e.seq === "number",
        )
      : [],
  };
}

function ensureLoaded(): void {
  if (registry.loaded) {
    return;
  }
  registry.loaded = true;
  const root = resolveFactoryDir(env());
  let boardDirs: string[] = [];
  try {
    boardDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isSafeFactoryId(d.name))
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const boardId of boardDirs) {
    const board = readJson<FactoryBoard>(boardFile(boardId));
    if (!board || board.id !== boardId) {
      continue;
    }
    registry.boards.set(boardId, { ...board, columns: FACTORY_COLUMNS });
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(root, boardId, "cards")).filter((f) => f.endsWith(".json"));
    } catch {
      files = [];
    }
    for (const file of files) {
      const card = normalizeCard(readJson(path.join(root, boardId, "cards", file)));
      if (card && card.boardId === boardId) {
        registry.cards.set(card.id, card);
      }
    }
  }
}

function saveBoard(board: FactoryBoard): void {
  try {
    writeJsonAtomic(boardFile(board.id), board);
  } catch {
    // The registry stays authoritative; a write failure is not a transition failure.
  }
}

function saveCard(card: FactoryCard): void {
  touched.set(card.id, ++touchSeq);
  try {
    writeJsonAtomic(cardFile(card), card);
  } catch {
    // Same as saveBoard.
  }
}

// ── boards ───────────────────────────────────────────────────────────────────────────────────

export function listBoards(): FactoryBoard[] {
  ensureLoaded();
  return [...registry.boards.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

export function getBoard(id: string): FactoryBoard | undefined {
  ensureLoaded();
  return registry.boards.get(id);
}

export function ensureBoard(input: {
  id?: string;
  name?: string;
  repo?: string | null;
}): FactoryBoard {
  ensureLoaded();
  const id = (input.id ?? DEFAULT_BOARD_ID).trim();
  if (!isSafeFactoryId(id)) {
    throw new FactoryInputError(`board id must match ${ID_RE.source}`);
  }
  const existing = registry.boards.get(id);
  if (existing) {
    return existing;
  }
  const ts = nowIso();
  const board: FactoryBoard = {
    id,
    name: input.name?.trim() || id,
    repo: input.repo?.trim() || null,
    columns: FACTORY_COLUMNS,
    createdAt: ts,
    updatedAt: ts,
  };
  registry.boards.set(id, board);
  saveBoard(board);
  emit({ kind: "board.created", board });
  return board;
}

// ── cards ────────────────────────────────────────────────────────────────────────────────────

export function listCards(filter?: {
  boardId?: string;
  column?: FactoryColumn;
  owner?: string;
  limit?: number;
}): FactoryCard[] {
  ensureLoaded();
  const limit = Math.max(1, Math.min(filter?.limit ?? 200, 1000));
  return [...registry.cards.values()]
    .filter(
      (card) =>
        (!filter?.boardId || card.boardId === filter.boardId) &&
        (!filter?.column || card.column === filter.column) &&
        (!filter?.owner || card.owner === filter.owner),
    )
    .toSorted(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        (touched.get(b.id) ?? 0) - (touched.get(a.id) ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function getCard(id: string): FactoryCard | undefined {
  ensureLoaded();
  return registry.cards.get(id);
}

export function requireCard(id: string): FactoryCard {
  const card = getCard(id);
  if (!card) {
    throw new FactoryNotFoundError("card", id);
  }
  return card;
}

function pushEntry(
  card: FactoryCard,
  kind: FactoryTimelineKind,
  by: string,
  text: string,
  data?: Record<string, unknown>,
): FactoryTimelineEntry {
  const last = card.timeline.length > 0 ? card.timeline[card.timeline.length - 1].seq : 0;
  const entry: FactoryTimelineEntry = {
    seq: last + 1,
    ts: nowIso(),
    kind,
    by,
    text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text,
    ...(data ? { data } : {}),
  };
  card.timeline.push(entry);
  if (card.timeline.length > maxTimeline) {
    card.timeline.splice(0, card.timeline.length - maxTimeline);
  }
  card.updatedAt = entry.ts;
  return entry;
}

export type CreateCardInput = {
  boardId?: string;
  title?: string;
  goal: string;
  repo?: string;
  owner: string;
  policy?: Partial<FactoryCardPolicy>;
  /** Who created it, for the timeline and the audit line (default: the owner). */
  by?: string;
  id?: string;
};

export function createCard(input: CreateCardInput): FactoryCard {
  ensureLoaded();
  const goal = (input.goal ?? "").trim();
  if (!goal) {
    throw new FactoryInputError("goal is required");
  }
  if (goal.length > MAX_GOAL_CHARS) {
    throw new FactoryInputError(`goal is longer than ${MAX_GOAL_CHARS} characters`);
  }
  const owner = (input.owner ?? "").trim();
  if (!owner) {
    throw new FactoryInputError("owner is required");
  }
  const board = ensureBoard({ id: input.boardId });
  const repo = (input.repo ?? board.repo ?? "").trim();
  if (!repo) {
    throw new FactoryInputError("repo is required (the board has no default repository)");
  }
  if (!path.isAbsolute(repo)) {
    throw new FactoryInputError("repo must be an absolute path to a git checkout");
  }
  const title = (input.title ?? "").trim() || goal.split("\n")[0].slice(0, 80);
  if (title.length > MAX_TITLE_CHARS) {
    throw new FactoryInputError(`title is longer than ${MAX_TITLE_CHARS} characters`);
  }
  const id = input.id?.trim() || randomUUID();
  if (registry.cards.has(id)) {
    throw new FactoryInputError(`card id already exists: ${id}`);
  }
  const ts = nowIso();
  const by = input.by ?? owner;
  const card: FactoryCard = {
    id,
    boardId: board.id,
    title,
    goal,
    repo,
    owner,
    column: "inbox",
    createdAt: ts,
    updatedAt: ts,
    engineTaskId: null,
    branch: null,
    jobIds: [],
    evidenceIds: [],
    pr: null,
    policy: { autoMerge: input.policy?.autoMerge === true },
    runningJobId: null,
    summary: null,
    error: null,
    timeline: [],
  };
  pushEntry(card, "created", by, `Card created in inbox by ${by}.`, { title, repo });
  registry.cards.set(id, card);
  saveCard(card);
  void auditSafe({
    identity: by,
    scope: `factory:${board.id}`,
    action: "factory.card.created",
    outcome: "ok",
    source: "factory.store",
    detail: { cardId: id, boardId: board.id, owner, repo, title },
  });
  emit({ kind: "card.created", card });
  return card;
}

/** Validated, audited transition. Throws FactoryTransitionError when the machine refuses. */
export function moveCard(
  id: string,
  to: FactoryColumn,
  opts: { by: string; reason?: string; data?: Record<string, unknown> },
): FactoryCard {
  const card = requireCard(id);
  if (!isColumn(to)) {
    throw new FactoryInputError(`unknown column: ${String(to)}`);
  }
  const from = card.column;
  assertTransition(from, to);
  card.column = to;
  if (to === "inbox") {
    card.error = null;
  }
  const entry = pushEntry(
    card,
    "moved",
    opts.by,
    `${from} → ${to}${opts.reason ? `: ${opts.reason}` : ""}`,
    { from, to, ...opts.data },
  );
  saveCard(card);
  void auditSafe({
    identity: opts.by,
    scope: `factory:${card.boardId}`,
    action: "factory.card.moved",
    outcome: "ok",
    source: "factory.store",
    detail: { cardId: card.id, from, to, reason: opts.reason ?? null, seq: entry.seq },
  });
  emit({ kind: "card.moved", card, from, to });
  return card;
}

/** Append a timeline entry (comment, engine event, job link, …) without changing the column. */
export function annotateCard(
  id: string,
  input: {
    kind: FactoryTimelineKind;
    by: string;
    text: string;
    data?: Record<string, unknown>;
    patch?: Partial<
      Pick<
        FactoryCard,
        "engineTaskId" | "branch" | "pr" | "runningJobId" | "summary" | "error" | "title"
      >
    > & { addJobId?: string; addEvidenceId?: string; pr?: FactoryPullRequest | null };
  },
): FactoryCard {
  const card = requireCard(id);
  const text = (input.text ?? "").trim();
  if (!text) {
    throw new FactoryInputError("text is required");
  }
  const patch = input.patch;
  if (patch) {
    if (patch.engineTaskId !== undefined) {
      card.engineTaskId = patch.engineTaskId;
    }
    if (patch.branch !== undefined) {
      card.branch = patch.branch;
    }
    if (patch.pr !== undefined) {
      card.pr = patch.pr;
    }
    if (patch.runningJobId !== undefined) {
      card.runningJobId = patch.runningJobId;
    }
    if (patch.summary !== undefined) {
      card.summary = patch.summary;
    }
    if (patch.error !== undefined) {
      card.error = patch.error;
    }
    if (typeof patch.title === "string" && patch.title.trim()) {
      card.title = patch.title.trim().slice(0, MAX_TITLE_CHARS);
    }
    if (patch.addJobId && !card.jobIds.includes(patch.addJobId)) {
      card.jobIds.push(patch.addJobId);
    }
    if (patch.addEvidenceId && !card.evidenceIds.includes(patch.addEvidenceId)) {
      card.evidenceIds.push(patch.addEvidenceId);
    }
  }
  const entry = pushEntry(card, input.kind, input.by, text, input.data);
  saveCard(card);
  if (input.kind === "comment") {
    void auditSafe({
      identity: input.by,
      scope: `factory:${card.boardId}`,
      action: "factory.card.comment",
      outcome: "ok",
      source: "factory.store",
      detail: { cardId: card.id, seq: entry.seq, chars: text.length },
    });
  }
  emit({ kind: "card.updated", card, entry });
  return card;
}

export function isCardTerminal(card: Pick<FactoryCard, "column">): boolean {
  return FACTORY_TERMINAL_COLUMNS.has(card.column);
}

/** Test helper: drops the in-memory registry (files are left alone) and the listeners. */
export function __resetFactoryForTest(opts?: { env?: NodeJS.ProcessEnv }): void {
  registry.boards.clear();
  registry.cards.clear();
  registry.loaded = false;
  listeners.clear();
  maxTimeline = DEFAULT_MAX_TIMELINE;
  envOverride = opts?.env;
}
