import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePolicyText } from "./load.js";
import { policyJsonSchema, validatePolicyDocument } from "./schema.js";
import { STARTER_POLICY_YAML } from "./starter.js";

describe("policy schema", () => {
  it("accepts the starter policy", () => {
    const parsed = parsePolicyText(STARTER_POLICY_YAML);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.policy.version).toBe(1);
      expect(parsed.policy.agents?.["*"]?.limits?.maxConcurrentJobs).toBe(4);
      expect(parsed.policy.data?.neverRead).toContain("~/.ssh/**");
    }
  });

  it("refuses unknown keys and wrong versions with a path", () => {
    const bad = validatePolicyDocument({ version: 2, agents: { "*": { tool: [] } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join("\n")).toMatch(/version/);
      expect(bad.errors.join("\n")).toMatch(/agents\.\*/);
    }
  });

  it("refuses non-mappings and bad YAML", () => {
    expect(validatePolicyDocument("nope").ok).toBe(false);
    expect(parsePolicyText("version: [1\n").ok).toBe(false);
  });

  it("checks what the schema cannot: regexes, permission classes, approval classes", () => {
    const result = validatePolicyDocument({
      version: 1,
      agents: { alice: { permissions: ["delete:/tmp/**", "write:/ws/**"] } },
      data: { secretPatterns: ["(unclosed"] },
      approvals: { require: [{ class: "teleport" }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toMatch(/secretPatterns\[0\]/);
      expect(result.errors[1]).toMatch(/agents\[alice\]\.permissions\[0\]/);
      expect(result.errors[2]).toMatch(/approvals\.require\[0\]\.class/);
    }
  });

  it("warns instead of failing on soft problems", () => {
    const result = validatePolicyDocument({
      version: 1,
      agents: { alice: { tools: { allow: [] } } },
      budgets: { fleet: { costPerDay: 10 } },
      approvals: { require: [{ class: "exec" }] },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(3);
  });

  it("exports a JSON Schema document", () => {
    const schema = policyJsonSchema();
    expect(schema.$schema).toMatch(/json-schema/);
    expect(schema.type).toBe("object");
    expect((schema.properties as Record<string, unknown>).kill).toBeDefined();
  });
});

describe("documented example policies", () => {
  const dir = path.resolve(__dirname, "../../docs/policy/examples");
  for (const name of ["hospital-safe", "trading-desk", "manufacturing-floor"]) {
    it(`${name}.yaml validates without errors`, () => {
      const parsed = parsePolicyText(fs.readFileSync(path.join(dir, `${name}.yaml`), "utf8"));
      expect(parsed.ok, parsed.ok ? "" : parsed.errors.join("\n")).toBe(true);
      if (parsed.ok) {
        expect(parsed.policy.name).toBe(name);
        expect(parsed.policy.attestation?.required).toBe(true);
      }
    });
  }
});
