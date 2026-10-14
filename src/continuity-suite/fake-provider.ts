import type { AddressInfo } from "node:net";
// Deterministic model provider for the continuity suite (KoLo 2.0, M11b). A chat-completions-compatible
// chat-completions server on loopback that never calls a real model: the answer is a function of
// the request alone, so a run on any machine produces the same text. It serves two "profiles"
// (models) so a model swap is a real config change the gateway has to pick up.
//
// Answer format: `model=<id>; marker=<identity marker or none>; echo=<last user text>`.
//   - marker: the first `Continuity marker: <token>` found in system/developer messages — the
//     gateway injects the resident's IDENTITY.md into the system prompt, so the marker proves the
//     identity reached the model.
//   - `[slow:<ms>]` in the user text delays completion (used to leave a job unfinished when a
//     disruption hits). Capped at 120 s.
import http from "node:http";

export const FAKE_PROVIDER_ID = "continuity-fake";
export const FAKE_PROFILES = ["alpha", "beta"] as const;
export type FakeProfile = (typeof FAKE_PROFILES)[number];
export const FAKE_API_KEY_ENV = "CONTINUITY_FAKE_API_KEY";
export const MARKER_RE = /continuity marker:\s*([A-Za-z0-9-]+)/i;
const SLOW_RE = /\[slow:(\d{1,6})\]/;
const MAX_SLOW_MS = 120_000;
const MAX_BODY = 4 * 1024 * 1024;

type ChatMessage = { role?: string; content?: unknown };

export type FakeProviderCall = {
  model: string;
  stream: boolean;
  marker: string | null;
  user: string;
  at: number;
};

export type FakeProvider = {
  port: number;
  baseUrl: string;
  calls: FakeProviderCall[];
  close: () => Promise<void>;
};

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

export function composeAnswer(
  model: string,
  messages: ChatMessage[],
): {
  text: string;
  marker: string | null;
  user: string;
  slowMs: number;
} {
  let marker: string | null = null;
  let user = "";
  for (const m of messages) {
    const text = textOf(m.content);
    if ((m.role === "system" || m.role === "developer") && marker === null) {
      marker = MARKER_RE.exec(text)?.[1] ?? null;
    }
    if (m.role === "user") {
      user = text;
    }
  }
  const slow = SLOW_RE.exec(user);
  const slowMs = slow ? Math.min(MAX_SLOW_MS, Number.parseInt(slow[1], 10)) : 0;
  const cleanUser = user.replace(SLOW_RE, "").trim().slice(0, 200);
  return {
    text: `model=${model}; marker=${marker ?? "none"}; echo=${cleanUser}`,
    marker,
    user: cleanUser,
    slowMs,
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function startFakeProvider(opts: { port?: number } = {}): Promise<FakeProvider> {
  const calls: FakeProviderCall[] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: FAKE_PROFILES.map((id) => ({ id, object: "model", owned_by: FAKE_PROVIDER_ID })),
        }),
      );
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    let body: { model?: string; messages?: ChatMessage[]; stream?: boolean };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid json" } }));
      return;
    }
    const model = typeof body.model === "string" ? body.model : "unknown";
    const answer = composeAnswer(model, Array.isArray(body.messages) ? body.messages : []);
    calls.push({
      model,
      stream: Boolean(body.stream),
      marker: answer.marker,
      user: answer.user,
      at: Date.now(),
    });
    const id = `fake-${calls.length}`;
    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (!body.stream) {
      await sleep(answer.slowMs);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: answer.text },
              finish_reason: "stop",
            },
          ],
          usage,
        }),
      );
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
      );
    chunk({ role: "assistant", content: "" }, null);
    await sleep(answer.slowMs);
    if (res.destroyed) {
      return;
    }
    chunk({ content: answer.text }, null);
    chunk({}, "stop");
    res.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: opts.port ?? 0, host: "127.0.0.1" }, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** `models.providers` entry the throwaway gateway config points at this server. */
export function fakeProviderConfig(baseUrl: string) {
  return {
    baseUrl,
    api: "openai-completions" as const,
    apiKey: FAKE_API_KEY_ENV,
    models: FAKE_PROFILES.map((id) => ({
      id,
      name: `Continuity fake ${id}`,
      reasoning: false,
      input: ["text"] as Array<"text" | "image">,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
      maxTokens: 2048,
    })),
  };
}

export function fakeModelRef(profile: FakeProfile): string {
  return `${FAKE_PROVIDER_ID}/${profile}`;
}
