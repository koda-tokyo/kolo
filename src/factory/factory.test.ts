import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FactoryEvent } from "./types.js";
import {
  checkToolPermission,
  resolveToolPermissions,
  ToolPermissionDeniedError,
  wrapToolWithPermissionGuard,
} from "../agents/permissions.js";
import { canTransition, columnForEngineStatus, parseColumn, pathTo } from "./state.js";
import {
  __resetFactoryForTest,
  annotateCard,
  createCard,
  ensureBoard,
  FactoryInputError,
  FactoryNotFoundError,
  FactoryTransitionError,
  getCard,
  listBoards,
  listCards,
  moveCard,
  onFactoryEvent,
  resolveFactoryDir,
} from "./store.js";
import { createFactoryTools, FACTORY_CARD_MOVE_TOOL } from "./tools.js";
import { FACTORY_COLUMNS } from "./types.js";

let home = "";
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-factory-"));
  env = { ...process.env, KOLO_STATE_DIR: home, KOLO_HOME: home };
  __resetFactoryForTest({ env });
});

afterEach(() => {
  __resetFactoryForTest();
  fs.rmSync(home, { recursive: true, force: true });
});

const REPO = path.join(os.tmpdir(), "repo-alice");

describe("factory state machine", () => {
  it("accepts the forward path and the documented back edges only", () => {
    expect(canTransition("inbox", "spec")).toBe(true);
    expect(canTransition("spec", "build")).toBe(true);
    expect(canTransition("build", "review")).toBe(true);
    expect(canTransition("review", "ready")).toBe(true);
    expect(canTransition("ready", "merged")).toBe(true);
    expect(canTransition("review", "build")).toBe(true);
    expect(canTransition("inbox", "ready")).toBe(false);
    expect(canTransition("merged", "inbox")).toBe(false);
    expect(canTransition("failed", "inbox")).toBe(true);
    expect(canTransition("failed", "build")).toBe(false);
    for (const column of FACTORY_COLUMNS) {
      expect(canTransition(column, column)).toBe(false);
    }
  });

  it("maps engine statuses to columns and finds forward paths", () => {
    expect(columnForEngineStatus("spec")).toBe("spec");
    expect(columnForEngineStatus("coding")).toBe("build");
    expect(columnForEngineStatus("qa")).toBe("review");
    expect(columnForEngineStatus("ready_to_merge")).toBe("ready");
    expect(columnForEngineStatus("merged")).toBe("merged");
    expect(columnForEngineStatus("cancelled")).toBe("failed");
    expect(columnForEngineStatus("whatever")).toBeNull();
    expect(pathTo("inbox", "review")).toEqual(["spec", "build", "review"]);
    expect(pathTo("review", "spec")).toEqual([]);
    expect(pathTo("build", "failed")).toEqual(["failed"]);
    expect(pathTo("merged", "failed")).toEqual([]);
    expect(parseColumn(" Ready ")).toBe("ready");
    expect(parseColumn("done")).toBeNull();
  });
});

describe("factory store", () => {
  it("creates boards and cards under KOLO_HOME/factory and reloads them", () => {
    const events: FactoryEvent[] = [];
    onFactoryEvent((e) => events.push(e));
    const card = createCard({
      goal: "Add a /health endpoint\nwith a test",
      repo: REPO,
      owner: "alice",
    });
    expect(card.column).toBe("inbox");
    expect(card.title).toBe("Add a /health endpoint");
    expect(card.boardId).toBe("main");
    expect(card.timeline).toHaveLength(1);
    expect(events.map((e) => e.kind)).toEqual(["board.created", "card.created"]);
    const file = path.join(resolveFactoryDir(env), "main", "cards", `${card.id}.json`);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(path.join(resolveFactoryDir(env), "main", "board.json"))).toBe(true);

    __resetFactoryForTest({ env });
    expect(listBoards().map((b) => b.id)).toEqual(["main"]);
    const reloaded = getCard(card.id);
    expect(reloaded?.goal).toBe(card.goal);
    expect(reloaded?.timeline[0].kind).toBe("created");
  });

  it("validates input", () => {
    expect(() => createCard({ goal: "", repo: REPO, owner: "alice" })).toThrow(FactoryInputError);
    expect(() => createCard({ goal: "x", repo: "relative/path", owner: "alice" })).toThrow(
      /absolute path/,
    );
    expect(() => createCard({ goal: "x", owner: "alice" })).toThrow(/repo is required/);
    expect(() => ensureBoard({ id: "Bad Id" })).toThrow(FactoryInputError);
    ensureBoard({ id: "team", repo: REPO });
    const card = createCard({ goal: "x", owner: "alice", boardId: "team" });
    expect(card.repo).toBe(REPO);
  });

  it("moves through the machine, audits, and refuses illegal moves", () => {
    const moved: Array<[string, string]> = [];
    onFactoryEvent((e) => {
      if (e.kind === "card.moved") {
        moved.push([e.from, e.to]);
      }
    });
    const card = createCard({ goal: "x", repo: REPO, owner: "alice" });
    moveCard(card.id, "spec", { by: "owner:token" });
    expect(() => moveCard(card.id, "ready", { by: "owner:token" })).toThrow(FactoryTransitionError);
    moveCard(card.id, "failed", { by: "runner", reason: "engine boom" });
    moveCard(card.id, "inbox", { by: "alice" });
    expect(getCard(card.id)?.column).toBe("inbox");
    expect(moved).toEqual([
      ["inbox", "spec"],
      ["spec", "failed"],
      ["failed", "inbox"],
    ]);
    const kinds = getCard(card.id)?.timeline.map((e) => e.kind);
    expect(kinds).toEqual(["created", "moved", "moved", "moved"]);
    expect(() => moveCard("nope", "spec", { by: "x" })).toThrow(FactoryNotFoundError);
  });

  it("annotates cards and bounds the timeline", () => {
    const card = createCard({ goal: "x", repo: REPO, owner: "alice" });
    annotateCard(card.id, {
      kind: "job",
      by: "runner",
      text: "job started",
      patch: {
        addJobId: "job-1",
        addEvidenceId: "job-1",
        engineTaskId: "001-x",
        branch: "kip/001-x",
      },
    });
    annotateCard(card.id, {
      kind: "job",
      by: "runner",
      text: "again",
      patch: { addJobId: "job-1" },
    });
    const after = getCard(card.id)!;
    expect(after.jobIds).toEqual(["job-1"]);
    expect(after.evidenceIds).toEqual(["job-1"]);
    expect(after.engineTaskId).toBe("001-x");
    expect(after.branch).toBe("kip/001-x");
    expect(() => annotateCard(card.id, { kind: "comment", by: "a", text: "  " })).toThrow(
      FactoryInputError,
    );
    for (let i = 0; i < 600; i++) {
      annotateCard(card.id, { kind: "engine", by: "engine", text: `event ${i}` });
    }
    expect(getCard(card.id)!.timeline.length).toBe(500);
    expect(getCard(card.id)!.timeline[499].seq).toBe(603);
  });

  it("lists with filters, newest first", () => {
    const a = createCard({ goal: "a", repo: REPO, owner: "alice" });
    const b = createCard({ goal: "b", repo: REPO, owner: "ops-bot" });
    moveCard(b.id, "spec", { by: "ops-bot" });
    expect(listCards({ owner: "alice" }).map((c) => c.id)).toEqual([a.id]);
    expect(listCards({ column: "spec" }).map((c) => c.id)).toEqual([b.id]);
    expect(listCards({ boardId: "other" })).toEqual([]);
    expect(listCards()[0].id).toBe(b.id);
  });
});

describe("factory tools", () => {
  const WS = "/ws";

  it("create, move and comment through the tools as the resident", async () => {
    const [create, move, comment] = createFactoryTools({ agentId: "alice", defaultRepo: REPO });
    const created = (await create.execute("c1", { goal: "Build the thing" }, undefined)) as {
      details: { ok: boolean; card: { id: string; owner: string } };
    };
    expect(created.details.ok).toBe(true);
    expect(created.details.card.owner).toBe("alice");
    const id = created.details.card.id;
    const moved = (await move.execute("c2", { cardId: id, to: "spec" }, undefined)) as {
      details: { ok: boolean; card: { column: string } };
    };
    expect(moved.details.card.column).toBe("spec");
    const bad = (await move.execute("c3", { cardId: id, to: "merged" }, undefined)) as {
      details: { ok: boolean; error: string };
    };
    expect(bad.details.ok).toBe(false);
    expect(bad.details.error).toContain("cannot move");
    const commented = (await comment.execute(
      "c4",
      { cardId: id, text: "looks right" },
      undefined,
    )) as { details: { ok: boolean; card: { timelineLength: number } } };
    expect(commented.details.card.timelineLength).toBe(3);
    const listed = (await comment.execute("c5", {}, undefined)) as {
      details: { cards: Array<{ id: string }> };
    };
    expect(listed.details.cards.map((c) => c.id)).toEqual([id]);
  });

  it("is deny-by-default under the exec class and grantable per verb", async () => {
    const none = resolveToolPermissions({ entry: ["read:**"], workspaceDir: WS });
    expect(
      checkToolPermission({
        toolName: FACTORY_CARD_MOVE_TOOL,
        args: {},
        permissionSet: none,
        workspaceDir: WS,
      }).ok,
    ).toBe(false);
    const commentOnly = resolveToolPermissions({
      entry: ["exec:factory_card:comment"],
      workspaceDir: WS,
    });
    expect(
      checkToolPermission({
        toolName: "factory_card_comment",
        args: {},
        permissionSet: commentOnly,
        workspaceDir: WS,
      }).ok,
    ).toBe(true);
    expect(
      checkToolPermission({
        toolName: "factory_card_create",
        args: {},
        permissionSet: commentOnly,
        workspaceDir: WS,
      }).ok,
    ).toBe(false);
    const all = resolveToolPermissions({ entry: ["exec:factory_card:*"], workspaceDir: WS });
    expect(
      checkToolPermission({
        toolName: "factory_card_create",
        args: {},
        permissionSet: all,
        workspaceDir: WS,
      }).ok,
    ).toBe(true);
    const [, move] = createFactoryTools({ agentId: "alice", defaultRepo: REPO });
    const guarded = wrapToolWithPermissionGuard(move, {
      permissionSet: commentOnly,
      workspaceDir: WS,
      agentId: "alice",
    });
    await expect(
      guarded.execute("g1", { cardId: "x", to: "spec" } as never, undefined),
    ).rejects.toThrow(ToolPermissionDeniedError);
  });
});
