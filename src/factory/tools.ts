// Factory agent tools (KoLo 2.0, M15a): a resident creates cards, moves them and comments on
// them through the same store the API uses. The tools are classified under the exec permission
// class with the targets `factory_card:create`, `factory_card:move` and `factory_card:comment`,
// so an operator grants them with rules such as `exec:factory_card:*` (deny by default, M5).
// Running a card is not a tool: runs start from the API, the CLI or the Kanban.
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { jsonResult } from "../agents/tools/common.js";
import { parseColumn } from "./state.js";
import {
  annotateCard,
  createCard,
  FactoryInputError,
  FactoryNotFoundError,
  FactoryTransitionError,
  getCard,
  listCards,
  moveCard,
} from "./store.js";
import { FACTORY_COLUMNS, summarizeCard } from "./types.js";

export const FACTORY_CARD_CREATE_TOOL = "factory_card_create";
export const FACTORY_CARD_MOVE_TOOL = "factory_card_move";
export const FACTORY_CARD_COMMENT_TOOL = "factory_card_comment";
export const FACTORY_TOOL_NAMES = [
  FACTORY_CARD_CREATE_TOOL,
  FACTORY_CARD_MOVE_TOOL,
  FACTORY_CARD_COMMENT_TOOL,
] as const;

export type FactoryToolOptions = {
  /** Resident id the tools act as (owner of created cards, author of comments). */
  agentId: string;
  sessionKey?: string;
  defaultBoard?: string;
  defaultRepo?: string;
};

function failure(message: string) {
  return {
    content: [{ type: "text" as const, text: `factory: ${message}` }],
    details: { ok: false, error: message },
  };
}

function describeError(err: unknown): string {
  if (
    err instanceof FactoryInputError ||
    err instanceof FactoryNotFoundError ||
    err instanceof FactoryTransitionError
  ) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function createFactoryTools(opts: FactoryToolOptions): AnyAgentTool[] {
  const create: AnyAgentTool = {
    name: FACTORY_CARD_CREATE_TOOL,
    label: "Factory: create card",
    description:
      "Create a factory card: a goal for a repository that the factory turns into a reviewed " +
      "pull request. The card starts in the inbox; an operator or the owner runs it.",
    parameters: Type.Object({
      goal: Type.String({ description: "What the change should accomplish." }),
      title: Type.Optional(Type.String({ description: "Short title (default: first line)." })),
      repo: Type.Optional(
        Type.String({
          description: "Absolute path of the git checkout (default: the board's repository).",
        }),
      ),
      board: Type.Optional(Type.String({ description: "Board id (default: the default board)." })),
    }),
    execute: async (_id, args) => {
      const p = (args ?? {}) as {
        goal?: unknown;
        title?: unknown;
        repo?: unknown;
        board?: unknown;
      };
      try {
        const card = createCard({
          goal: typeof p.goal === "string" ? p.goal : "",
          title: typeof p.title === "string" ? p.title : undefined,
          repo: typeof p.repo === "string" ? p.repo : opts.defaultRepo,
          boardId: typeof p.board === "string" ? p.board : opts.defaultBoard,
          owner: opts.agentId,
          by: opts.agentId,
        });
        return jsonResult({ ok: true, card: summarizeCard(card) });
      } catch (err) {
        return failure(describeError(err));
      }
    },
  };

  const move: AnyAgentTool = {
    name: FACTORY_CARD_MOVE_TOOL,
    label: "Factory: move card",
    description:
      `Move a factory card to another column (${FACTORY_COLUMNS.join(", ")}). The state ` +
      "machine refuses illegal moves; every move is audited.",
    parameters: Type.Object({
      cardId: Type.String(),
      to: Type.String({ description: `Target column: ${FACTORY_COLUMNS.join(" | ")}.` }),
      reason: Type.Optional(Type.String()),
    }),
    execute: async (_id, args) => {
      const p = (args ?? {}) as { cardId?: unknown; to?: unknown; reason?: unknown };
      const to = parseColumn(p.to);
      if (!to) {
        return failure(`unknown column "${String(p.to)}"`);
      }
      try {
        const card = moveCard(typeof p.cardId === "string" ? p.cardId : "", to, {
          by: opts.agentId,
          reason: typeof p.reason === "string" ? p.reason : undefined,
        });
        return jsonResult({ ok: true, card: summarizeCard(card) });
      } catch (err) {
        return failure(describeError(err));
      }
    },
  };

  const comment: AnyAgentTool = {
    name: FACTORY_CARD_COMMENT_TOOL,
    label: "Factory: comment on card",
    description: "Add a comment to a factory card's timeline, or list cards when no id is given.",
    parameters: Type.Object({
      cardId: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      board: Type.Optional(Type.String({ description: "List cards of this board." })),
    }),
    execute: async (_id, args) => {
      const p = (args ?? {}) as { cardId?: unknown; text?: unknown; board?: unknown };
      const cardId = typeof p.cardId === "string" ? p.cardId.trim() : "";
      if (!cardId) {
        const cards = listCards({
          boardId: typeof p.board === "string" ? p.board : opts.defaultBoard,
          limit: 50,
        });
        return jsonResult({ ok: true, cards: cards.map(summarizeCard) });
      }
      if (!getCard(cardId)) {
        return failure(`card not found: ${cardId}`);
      }
      try {
        const card = annotateCard(cardId, {
          kind: "comment",
          by: opts.agentId,
          text: typeof p.text === "string" ? p.text : "",
        });
        return jsonResult({ ok: true, card: summarizeCard(card) });
      } catch (err) {
        return failure(describeError(err));
      }
    },
  };

  return [create, move, comment];
}
