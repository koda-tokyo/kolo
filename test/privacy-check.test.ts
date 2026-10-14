import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "..", "scripts", "privacy-check.mjs");
// The guarded names are never written in plain text in this repository, so the fixture uses
// a made-up word passed through PRIVACY_CHECK_EXTRA_WORDS, plus the one blocked word that is
// also a public product name (built at runtime so this file stays clean).
const FAKE = "zebracorn";
const PRODUCT = ["k", "i", "p"].join("");

let repo: string;

function git(...args: string[]) {
  const res = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  expect(res.status, res.stderr).toBe(0);
}

function write(rel: string, text: string) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function run(...args: string[]) {
  const res = spawnSync(process.execPath, [SCRIPT, "--root", repo, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PRIVACY_CHECK_EXTRA_WORDS: FAKE },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-privacy-check-"));
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "core.hooksPath", "/dev/null");
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("privacy-check", () => {
  it("passes a clean repository", () => {
    write("src/a.ts", 'export const agent = "atlas";\n');
    git("add", "-A");
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain("privacy-check: clean");
  });

  it("fails with file:line on a blocked word, case-insensitive and whole-word only", () => {
    write("src/a.ts", "const ok = 1;\n" + `const k = "AGENT:${FAKE.toUpperCase()}:OPS";\n`);
    write("src/b.ts", `const fine = "${FAKE}ish";\nconst also = "workspace-${FAKE}";\n`);
    git("add", "-A");
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain(`src/a.ts:2: private name "${FAKE.toUpperCase()}"`);
    expect(out).toContain(`src/b.ts:2: private name "${FAKE}"`);
    expect(out).not.toContain("src/b.ts:1:");
  });

  it("only scans tracked files", () => {
    write("src/a.ts", "export {};\n");
    git("add", "-A");
    write("untracked.md", `${FAKE}\n`);
    expect(run().code).toBe(0);
  });

  it("honours .privacy-allow entries by path and line substring", () => {
    write("LICENSE", `Copyright (c) 2026 ${FAKE} (ACME).\nSee ${FAKE} below.\n`);
    write(
      ".privacy-allow",
      `LICENSE | Copyright (c) 2026 ${FAKE} (ACME). | legal copyright line\n`,
    );
    git("add", "-A");
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).not.toContain("LICENSE:1:");
    expect(out).toContain("LICENSE:2:");
  });

  it("rejects a malformed allowlist line", () => {
    write(".privacy-allow", "LICENSE without reason\n");
    git("add", "-A");
    expect(run().code).toBe(2);
  });

  it("allows the product id forms of the engine name but not the name itself", () => {
    write(
      "src/engine.ts",
      [
        `import { x } from "./${PRODUCT}-engine-client";`,
        `// the ${PRODUCT.toUpperCase()} headless engine`,
        `const branch = "${PRODUCT}/001-goal";`,
        `const tmp = "/tmp/kolo-${PRODUCT}-reg";`,
        `const ${PRODUCT}Engine = 1; const ${PRODUCT}_engine_task = 2;`,
        `const repo = "koda-tokyo/${PRODUCT}";`,
      ].join("\n") + "\n",
    );
    git("add", "-A");
    expect(run().code).toBe(0);
    write("src/person.ts", `startJob({ agent: "${PRODUCT}" });\n`);
    git("add", "-A");
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain("src/person.ts:1:");
  });

  it("checks only staged content with --staged", () => {
    write("src/a.ts", "export {};\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    write("src/old.ts", `const x = "${FAKE}";\n`);
    git("add", "src/old.ts");
    git("commit", "-qm", "old");
    write("src/new.ts", "export const y = 1;\n");
    git("add", "src/new.ts");
    expect(run("--staged").code).toBe(0);
    write("src/new.ts", `export const y = "${FAKE}";\n`);
    git("add", "src/new.ts");
    const { code, out } = run("--staged");
    expect(code).toBe(1);
    expect(out).toContain("src/new.ts:1:");
    expect(out).not.toContain("src/old.ts");
  });

  it("reports internal vocabulary in docs as a warning without failing", () => {
    write("docs/a.md", "The sentience layer.\n");
    write("src/a.ts", "const sentience = 1;\n");
    git("add", "-A");
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('warning: docs/a.md:1: internal vocabulary "sentience"');
    expect(out).not.toContain("src/a.ts");
    expect(run("--no-warnings").out).not.toContain("warning:");
  });
});
