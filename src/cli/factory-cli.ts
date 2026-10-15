// `kurahi factory …` — the factory through the gateway API (KoLo 2.0, M15c).
//
//   kurahi factory boards [--json]                       boards with card counts per column
//   kurahi factory cards [--board id] [--column c] [--owner id] [--json]
//   kurahi factory create --goal "<text>" [--repo <path>] [--title t] [--board id] [--owner id]
//                       [--auto-merge] [--run] [--json]
//   kurahi factory show <cardId> [--json]                card with its timeline
//   kurahi factory move <cardId> <column> [--reason r]   audited move through the state machine
//   kurahi factory run <cardId> [--profile p] [--merge]  start the engine run (job id printed)
//   kurahi factory cancel <cardId>                       cancel the run in progress
//
// The gateway is discovered like `kurahi api` (KOLO_HOME, run/gateway.lock, secrets/gateway.token
// or KOLO_GATEWAY_URL/KOLO_GATEWAY_TOKEN); the token never comes from argv.
// Exit codes: 0 ok, 1 the gateway refused (HTTP error), 2 usage, 3 unreachable, 4 forbidden.
import type { Command } from "commander";
import { KoloApiError, KoloClient, KoloNetworkError } from "@kodasoken/kurahi-client";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { formatCliCommand } from "./command-format.js";

export const FACTORY_EXIT = { ok: 0, failed: 1, usage: 2, unreachable: 3, auth: 4 } as const;

export type FactoryCliDeps = {
  runtime?: RuntimeEnv;
  createClient?: (opts: { baseUrl?: string; timeoutMs?: number }) => Promise<KoloClient>;
};

type Board = {
  id: string;
  name: string;
  repo: string | null;
  counts: Record<string, number>;
};

type TimelineEntry = { seq: number; ts: string; kind: string; by: string; text: string };

type Card = {
  id: string;
  boardId: string;
  title: string;
  goal: string;
  repo: string;
  owner: string;
  column: string;
  updatedAt: string;
  engineTaskId: string | null;
  branch: string | null;
  jobIds: string[];
  evidenceIds: string[];
  pr: { url: string; number?: number; branch: string } | null;
  policy: { autoMerge: boolean };
  runningJobId: string | null;
  summary: string | null;
  error: string | null;
  timeline?: TimelineEntry[];
};

const COLUMNS = ["inbox", "spec", "build", "review", "ready", "merged", "failed"];

async function defaultCreateClient(opts: { baseUrl?: string; timeoutMs?: number }) {
  return await KoloClient.local({ baseUrl: opts.baseUrl, timeoutMs: opts.timeoutMs });
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

/** Maps a thrown client error to an exit code and a one-line message. */
export function describeFailure(command: string, err: unknown): { code: number; message: string } {
  if (err instanceof KoloNetworkError) {
    return {
      code: FACTORY_EXIT.unreachable,
      message: `kurahi factory ${command}: gateway unreachable (${err.message})`,
    };
  }
  if (err instanceof KoloApiError) {
    const body = err.body as { error?: unknown } | null;
    const nested =
      body && typeof body === "object" && body.error && typeof body.error === "object"
        ? (body.error as { message?: unknown }).message
        : undefined;
    const detail =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : typeof nested === "string"
          ? nested
          : `HTTP ${err.status}`;
    if (err.status === 401 || err.status === 403) {
      return {
        code: FACTORY_EXIT.auth,
        message: `kurahi factory ${command}: ${err.status === 401 ? "not authenticated" : "forbidden"} (${detail}). Moving, running and cancelling need an admin or owner credential.`,
      };
    }
    return { code: FACTORY_EXIT.failed, message: `kurahi factory ${command}: ${detail}` };
  }
  return {
    code: FACTORY_EXIT.failed,
    message: `kurahi factory ${command}: ${err instanceof Error ? err.message : String(err)}`,
  };
}

async function call<T>(
  deps: FactoryCliDeps,
  operationId: string,
  input: { params?: Record<string, string>; body?: unknown },
): Promise<T> {
  const client = await (deps.createClient ?? defaultCreateClient)({});
  const res = await client.send<T>(operationId, { params: input.params, body: input.body });
  if (!res.ok) {
    throw new KoloApiError(operationId, res.status, res.data, res.headers);
  }
  return res.data;
}

export function cardLines(card: Card, extra: Record<string, string> = {}): string[] {
  const lines = [
    `card         ${card.id}`,
    `title        ${card.title}`,
    `column       ${card.column}${card.runningJobId ? ` (running, job ${card.runningJobId})` : ""}`,
    `board        ${card.boardId}`,
    `owner        ${card.owner}`,
    `repo         ${card.repo}`,
    `engine task  ${card.engineTaskId ?? "none"}`,
    `branch       ${card.branch ?? "none"}`,
    `pull request ${card.pr ? card.pr.url : "none"}`,
    `policy       ${card.policy.autoMerge ? "auto-merge (needs the merge permission)" : "stop at ready"}`,
    `jobs         ${card.jobIds.length ? card.jobIds.join(", ") : "none"}`,
    `evidence     ${card.evidenceIds.length ? card.evidenceIds.map((id) => `/evidence/${id}`).join(", ") : "none"}`,
    `summary      ${card.summary ?? "none"}`,
    `error        ${card.error ?? "none"}`,
    `updated      ${card.updatedAt}`,
  ];
  for (const [k, v] of Object.entries(extra)) {
    lines.push(`${k.padEnd(12)} ${v}`);
  }
  return lines;
}

export function boardTable(boards: Board[]): string {
  return renderTable({
    columns: [
      { key: "id", header: "Board" },
      { key: "name", header: "Name", flex: true },
      ...COLUMNS.map((c) => ({ key: c, header: c, align: "right" as const })),
    ],
    rows: boards.map((b) => ({
      id: b.id,
      name: b.name,
      ...Object.fromEntries(COLUMNS.map((c) => [c, String(b.counts[c] ?? 0)])),
    })),
  });
}

export function cardTable(cards: Card[]): string {
  return renderTable({
    columns: [
      { key: "id", header: "Card" },
      { key: "column", header: "Column" },
      { key: "title", header: "Title", flex: true },
      { key: "owner", header: "Owner" },
      { key: "state", header: "State" },
      { key: "link", header: "Branch / PR", flex: true },
    ],
    rows: cards.map((c) => ({
      id: shortId(c.id),
      column: c.column,
      title: c.title,
      owner: c.owner,
      state: c.runningJobId
        ? "running"
        : c.error
          ? "error"
          : c.jobIds.length
            ? `${c.jobIds.length} job${c.jobIds.length === 1 ? "" : "s"}`
            : "",
      link: c.pr ? c.pr.url : (c.branch ?? ""),
    })),
  });
}

export async function runFactoryBoards(
  opts: { json?: boolean },
  deps: FactoryCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  try {
    const data = await call<{ boards: Board[] }>(deps, "listFactoryBoards", {});
    if (opts.json) {
      runtime.log(JSON.stringify(data, null, 2));
    } else if (data.boards.length === 0) {
      runtime.log("factory: no boards yet. Create a card with: kurahi factory create --goal ...");
    } else {
      runtime.log(boardTable(data.boards));
    }
    return FACTORY_EXIT.ok;
  } catch (err) {
    const failure = describeFailure("boards", err);
    runtime.error(failure.message);
    return failure.code;
  }
}

export async function runFactoryCards(
  opts: { board?: string; column?: string; owner?: string; json?: boolean },
  deps: FactoryCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  if (opts.column && !COLUMNS.includes(opts.column)) {
    runtime.error(`kurahi factory cards: --column must be one of ${COLUMNS.join(", ")}`);
    return FACTORY_EXIT.usage;
  }
  const params: Record<string, string> = {};
  if (opts.board) {
    params.board = opts.board;
  }
  if (opts.column) {
    params.column = opts.column;
  }
  if (opts.owner) {
    params.owner = opts.owner;
  }
  try {
    const data = await call<{ cards: Card[] }>(deps, "listFactoryCards", { params });
    if (opts.json) {
      runtime.log(JSON.stringify(data, null, 2));
    } else if (data.cards.length === 0) {
      runtime.log("factory: no cards match");
    } else {
      runtime.log(cardTable(data.cards));
    }
    return FACTORY_EXIT.ok;
  } catch (err) {
    const failure = describeFailure("cards", err);
    runtime.error(failure.message);
    return failure.code;
  }
}

export async function runFactoryCreate(
  opts: {
    goal?: string;
    title?: string;
    repo?: string;
    board?: string;
    owner?: string;
    autoMerge?: boolean;
    run?: boolean;
    json?: boolean;
  },
  deps: FactoryCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  const goal = opts.goal?.trim() ?? "";
  if (!goal) {
    runtime.error("kurahi factory create: --goal is required");
    return FACTORY_EXIT.usage;
  }
  try {
    const data = await call<{ card: Card; jobId?: string }>(deps, "createFactoryCard", {
      body: {
        goal,
        ...(opts.title ? { title: opts.title } : {}),
        ...(opts.repo ? { repo: opts.repo } : {}),
        ...(opts.board ? { board: opts.board } : {}),
        ...(opts.owner ? { owner: opts.owner } : {}),
        ...(opts.autoMerge ? { autoMerge: true } : {}),
        ...(opts.run ? { run: true } : {}),
      },
    });
    if (opts.json) {
      runtime.log(JSON.stringify(data, null, 2));
    } else {
      runtime.log(
        cardLines(data.card, data.jobId ? { job: data.jobId } : {}).join("\n") +
          `\nnext         ${formatCliCommand(`kurahi factory ${data.jobId ? "show" : "run"} ${data.card.id}`)}`,
      );
    }
    return FACTORY_EXIT.ok;
  } catch (err) {
    const failure = describeFailure("create", err);
    runtime.error(failure.message);
    return failure.code;
  }
}

export async function runFactoryShow(
  cardId: string | undefined,
  opts: { json?: boolean },
  deps: FactoryCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  const id = cardId?.trim() ?? "";
  if (!id) {
    runtime.error("kurahi factory show: a card id is required");
    return FACTORY_EXIT.usage;
  }
  try {
    const data = await call<{ card: Card; running: boolean }>(deps, "getFactoryCard", {
      params: { id },
    });
    if (opts.json) {
      runtime.log(JSON.stringify(data, null, 2));
      return FACTORY_EXIT.ok;
    }
    const lines = cardLines(data.card);
    const timeline = data.card.timeline ?? [];
    lines.push(`timeline     ${timeline.length} entries`);
    for (const entry of timeline.slice(-20)) {
      lines.push(
        `  ${String(entry.seq).padStart(4)}  ${entry.ts}  ${entry.kind.padEnd(8)} ${entry.by.padEnd(12)} ${entry.text}`,
      );
    }
    runtime.log(lines.join("\n"));
    return FACTORY_EXIT.ok;
  } catch (err) {
    const failure = describeFailure("show", err);
    runtime.error(failure.message);
    return failure.code;
  }
}

export async function runFactoryMove(
  cardId: string | undefined,
  column: string | undefined,
  opts: { reason?: string; json?: boolean },
  deps: FactoryCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  const id = cardId?.trim() ?? "";
  const to = column?.trim().toLowerCase() ?? "";
  if (!id || !to) {
    runtime.error("kurahi factory move: a card id and a column are required");
    return FACTORY_EXIT.usage;
  }
  if (!COLUMNS.includes(to)) {
    runtime.error(`kurahi factory move: column must be one of ${COLUMNS.join(", ")}`);
    return FACTORY_EXIT.usage;
  }
  try {
    const data = await call<{ card: Card }>(deps, "moveFactoryCard", {
      params: { id },
      body: { to, ...(opts.reason ? { reason: opts.reason } : {}) },
    });
    if (opts.json) {
      runtime.log(JSON.stringify(data, null, 2));
    } else {
      runtime.log(`card ${data.card.id} moved to ${data.card.column}`);
    }
    return FACTORY_EXIT.ok;
  } catch (err) {
    const failure = describeFailure("move", err);
    runtime.error(failure.message);
    return failure.code;
  }
}

export async function runFactoryRun(
  cardId: string | undefined,
  opts: { profile?: string; merge?: boolean; json?: boolean },
  deps: FactoryCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  const id = cardId?.trim() ?? "";
  if (!id) {
    runtime.error("kurahi factory run: a card id is required");
    return FACTORY_EXIT.usage;
  }
  try {
    const data = await call<{ jobId: string; card: Card }>(deps, "runFactoryCard", {
      params: { id },
      body: {
        ...(opts.profile ? { profile: opts.profile } : {}),
        ...(opts.merge ? { merge: true } : {}),
      },
    });
    if (opts.json) {
      runtime.log(JSON.stringify(data, null, 2));
    } else {
      runtime.log(
        [
          `card         ${data.card.id}`,
          `job          ${data.jobId}`,
          `column       ${data.card.column}`,
          `follow with  ${formatCliCommand(`kurahi factory show ${data.card.id}`)}`,
          `evidence     ${formatCliCommand(`kurahi evidence show ${data.jobId}`)} (after the run ends)`,
        ].join("\n"),
      );
    }
    return FACTORY_EXIT.ok;
  } catch (err) {
    const failure = describeFailure("run", err);
    runtime.error(failure.message);
    return failure.code;
  }
}

export async function runFactoryCancel(
  cardId: string | undefined,
  opts: { json?: boolean },
  deps: FactoryCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  const id = cardId?.trim() ?? "";
  if (!id) {
    runtime.error("kurahi factory cancel: a card id is required");
    return FACTORY_EXIT.usage;
  }
  try {
    const data = await call<{ jobId: string }>(deps, "cancelFactoryCard", { params: { id } });
    if (opts.json) {
      runtime.log(JSON.stringify(data, null, 2));
    } else {
      runtime.log(`cancel requested for card ${id} (job ${data.jobId})`);
    }
    return FACTORY_EXIT.ok;
  } catch (err) {
    const failure = describeFailure("cancel", err);
    runtime.error(failure.message);
    return failure.code;
  }
}

export function registerFactoryCli(program: Command, deps: FactoryCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  const exit = (code: number) => {
    if (code !== FACTORY_EXIT.ok) {
      runtime.exit(code);
    }
  };
  const cmd = program
    .command("factory")
    .description("The factory: a goal in, a reviewed pull request out, visible as a board")
    .addHelpText("after", () =>
      [
        "",
        theme.muted("Examples:"),
        `  ${formatCliCommand("kurahi factory boards")}`,
        `  ${formatCliCommand('kurahi factory create --goal "Add a /health endpoint" --repo /srv/app --run')}`,
        `  ${formatCliCommand("kurahi factory cards --column ready")}`,
        `  ${formatCliCommand("kurahi factory show 3f1c...")}`,
        `  ${formatCliCommand('kurahi factory move 3f1c... merged --reason "PR #42 merged"')}`,
        "",
        "Exit codes: 0 ok, 1 the gateway refused, 2 usage, 3 gateway unreachable, 4 not allowed.",
        `Docs: ${formatDocsLink("/factory")}`,
        "",
      ].join("\n"),
    );

  cmd
    .command("boards")
    .alias("list")
    .description("Boards with card counts per column")
    .option("--json", "JSON output", false)
    .action(async (opts: { json?: boolean }) => exit(await runFactoryBoards(opts, deps)));

  cmd
    .command("cards")
    .description("Cards, most recently updated first")
    .option("--board <id>", "Board id")
    .option("--column <column>", `One of ${COLUMNS.join(", ")}`)
    .option("--owner <id>", "Owner resident id")
    .option("--json", "JSON output", false)
    .action(async (opts: { board?: string; column?: string; owner?: string; json?: boolean }) =>
      exit(await runFactoryCards(opts, deps)),
    );

  cmd
    .command("create")
    .alias("add")
    .description("Create a card in the inbox (optionally start its run)")
    .requiredOption("--goal <text>", "What the change should accomplish")
    .option("--title <text>", "Short title (default: the goal's first line)")
    .option("--repo <path>", "Absolute path of the git checkout (default: the board's repository)")
    .option("--board <id>", "Board id (default: factory.defaultBoard)")
    .option("--owner <id>", "Owner resident (default: the default agent)")
    .option(
      "--auto-merge",
      "Merge through the engine when ready (needs the merge permission)",
      false,
    )
    .option("--run", "Start the engine run at once", false)
    .option("--json", "JSON output", false)
    .action(
      async (opts: {
        goal?: string;
        title?: string;
        repo?: string;
        board?: string;
        owner?: string;
        autoMerge?: boolean;
        run?: boolean;
        json?: boolean;
      }) => exit(await runFactoryCreate(opts, deps)),
    );

  cmd
    .command("show <cardId>")
    .alias("info")
    .description("One card with its timeline, jobs and evidence links")
    .option("--json", "JSON output", false)
    .action(async (cardId: string, opts: { json?: boolean }) =>
      exit(await runFactoryShow(cardId, opts, deps)),
    );

  cmd
    .command("move <cardId> <column>")
    .description("Move a card (the state machine decides; every move is audited)")
    .option("--reason <text>", "Why (kept on the timeline)")
    .option("--json", "JSON output", false)
    .action(async (cardId: string, column: string, opts: { reason?: string; json?: boolean }) =>
      exit(await runFactoryMove(cardId, column, opts, deps)),
    );

  cmd
    .command("run <cardId>")
    .description("Run the card on the KIP engine")
    .option("--profile <id>", "Engine profile override")
    .option("--merge", "Allow the auto-merge gate for this run (owner credential)", false)
    .option("--json", "JSON output", false)
    .action(async (cardId: string, opts: { profile?: string; merge?: boolean; json?: boolean }) =>
      exit(await runFactoryRun(cardId, opts, deps)),
    );

  cmd
    .command("cancel <cardId>")
    .description("Cancel the run in progress")
    .option("--json", "JSON output", false)
    .action(async (cardId: string, opts: { json?: boolean }) =>
      exit(await runFactoryCancel(cardId, opts, deps)),
    );
}
