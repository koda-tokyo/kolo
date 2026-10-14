import { describe, expect, test } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import {
  CHANNEL_LOCALES,
  channelText,
  channelTextKeys,
  resolveChannelLocale,
} from "./templates.js";

describe("channel templates (M14)", () => {
  test("every key has all three locales and no emoji", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const key of channelTextKeys()) {
      for (const locale of CHANNEL_LOCALES) {
        const text = channelText(locale, key);
        expect(text, `${key}/${locale}`).not.toBe(key);
        expect(text, `${key}/${locale}`).not.toMatch(emoji);
      }
    }
  });

  test("substitutes variables and falls back to English", () => {
    expect(channelText("pt", "cancel.ok", { id: "j1" })).toBe("Job j1 cancelado.");
    expect(channelText("ja", "help.help")).toContain("/help");
    expect(channelText("en", "no.such.key")).toBe("no.such.key");
  });

  test("locale resolves account → channel → channels default → en", () => {
    const cfg = {
      channels: {
        locale: "pt",
        line: { locale: "ja", accounts: { br: { locale: "pt" } } },
        slack: {},
      },
    } as unknown as KoLoConfig;
    expect(resolveChannelLocale(cfg, "line")).toBe("ja");
    expect(resolveChannelLocale(cfg, "line", "br")).toBe("pt");
    expect(resolveChannelLocale(cfg, "slack")).toBe("pt");
    expect(resolveChannelLocale({} as KoLoConfig, "slack")).toBe("en");
  });
});
