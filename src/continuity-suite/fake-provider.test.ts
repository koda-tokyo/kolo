import { describe, expect, test } from "vitest";
import {
  composeAnswer,
  FAKE_PROFILES,
  fakeModelRef,
  fakeProviderConfig,
  startFakeProvider,
} from "./fake-provider.js";

describe("fake provider", () => {
  test("composeAnswer is deterministic and reads the marker from the system prompt", () => {
    const messages = [
      { role: "system", content: "# Identity\nContinuity marker: CM-ABCD1234\n" },
      { role: "user", content: "Who are you?" },
    ];
    const a = composeAnswer("alpha", messages);
    const b = composeAnswer("alpha", messages);
    expect(a).toEqual(b);
    expect(a.text).toBe("model=alpha; marker=CM-ABCD1234; echo=Who are you?");
    expect(composeAnswer("beta", [{ role: "user", content: "x" }]).text).toBe(
      "model=beta; marker=none; echo=x",
    );
    const slow = composeAnswer("alpha", [{ role: "user", content: "[slow:250] go" }]);
    expect(slow.slowMs).toBe(250);
    expect(slow.text).toContain("echo=go");
    expect(composeAnswer("alpha", [{ role: "user", content: "[slow:999999] go" }]).slowMs).toBe(
      120_000,
    );
  });

  test("serves non-streaming and streaming chat completions and lists two profiles", async () => {
    const provider = await startFakeProvider();
    try {
      const models = await (await fetch(`${provider.baseUrl}/models`)).json();
      expect((models as { data: Array<{ id: string }> }).data.map((m) => m.id)).toEqual([
        ...FAKE_PROFILES,
      ]);

      const plain = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "alpha",
          messages: [
            { role: "system", content: "Continuity marker: CM-1" },
            { role: "user", content: "hello" },
          ],
        }),
      });
      expect(plain.status).toBe(200);
      const body = (await plain.json()) as { choices: Array<{ message: { content: string } }> };
      expect(body.choices[0].message.content).toBe("model=alpha; marker=CM-1; echo=hello");

      const streamed = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "beta",
          stream: true,
          messages: [{ role: "user", content: "[slow:100] hi" }],
        }),
      });
      const text = await streamed.text();
      const frames = text
        .split("\n\n")
        .filter((f) => f.startsWith("data: "))
        .map((f) => f.slice(6));
      expect(frames.at(-1)).toBe("[DONE]");
      const deltas = frames
        .slice(0, -1)
        .map((f) => JSON.parse(f) as { choices: Array<{ delta?: { content?: string } }> })
        .flatMap((f) => f.choices.map((c) => c.delta?.content ?? ""))
        .join("");
      expect(deltas).toBe("model=beta; marker=none; echo=hi");
      expect(provider.calls).toHaveLength(2);
      expect(provider.calls[1]).toMatchObject({ model: "beta", stream: true, user: "hi" });

      const missing = await fetch(`${provider.baseUrl}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await provider.close();
    }
  });

  test("config points the gateway at the server with an env-var api key and two models", () => {
    const cfg = fakeProviderConfig("http://127.0.0.1:1/v1");
    expect(cfg.models.map((m) => m.id)).toEqual(["alpha", "beta"]);
    expect(cfg.apiKey).toBe("CONTINUITY_FAKE_API_KEY");
    expect(fakeModelRef("beta")).toBe("continuity-fake/beta");
  });
});
