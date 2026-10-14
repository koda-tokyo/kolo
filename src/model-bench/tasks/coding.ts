// Axis (d): small coding edits. Each fixture is a CommonJS module with a failing test file; the
// model edits through KoLo's file tools (an edit only applies when its old text matches, so a
// wrong diff fails), then the harness runs the test under a restricted node (read-only file
// access to the workspace, no child processes, no workers, short timeout).
import type { BenchTask } from "../types.js";
import { readFile, rubric, writeFiles } from "./helpers.js";

type Fixture = {
  id: string;
  title: string;
  quick?: boolean;
  source: string;
  sourceText: string;
  test: string;
  testText: string;
  ask: string;
  /** Substrings of the source that must survive byte-for-byte (minimal edit). */
  keep?: string[];
};

/** `require("./<rel>")` for fixture text, built at runtime so packaging checks do not read it as an import. */
const load = (rel: string) => `require(${JSON.stringify(`./${rel}`)})`;

const assertHeader = 'const assert = require("node:assert/strict");\n';

const FIXTURES: Fixture[] = [
  {
    id: "coding.off-by-one",
    title: "Fix an off-by-one",
    quick: true,
    source: "src/sum.cjs",
    sourceText:
      "// Sum of the integers from a to b, both included.\nfunction sumRange(a, b) {\n  let total = 0;\n  for (let i = a; i < b; i++) {\n    total += i;\n  }\n  return total;\n}\nmodule.exports = { sumRange };\n",
    test: "test-sum.cjs",
    testText: `${assertHeader}const { sumRange } = ${load("src/sum.cjs")};\nassert.equal(sumRange(1, 3), 6);\nassert.equal(sumRange(5, 5), 5);\nassert.equal(sumRange(-2, 2), 0);\nconsole.log("ok");\n`,
    ask: "fix src/sum.cjs",
  },
  {
    id: "coding.title-case",
    title: "Fix a string helper",
    source: "src/text.cjs",
    sourceText:
      "function titleCase(input) {\n  return input.charAt(0).toUpperCase() + input.slice(1);\n}\nmodule.exports = { titleCase };\n",
    test: "test-text.cjs",
    testText: `${assertHeader}const { titleCase } = ${load("src/text.cjs")};\nassert.equal(titleCase("hello big world"), "Hello Big World");\nassert.equal(titleCase("a"), "A");\nassert.equal(titleCase(""), "");\nconsole.log("ok");\n`,
    ask: "fix titleCase in src/text.cjs so every word is capitalised",
  },
  {
    id: "coding.implement",
    title: "Implement a stubbed function",
    quick: true,
    source: "src/dates.cjs",
    sourceText:
      'function isLeapYear(year) {\n  throw new Error("not implemented");\n}\nmodule.exports = { isLeapYear };\n',
    test: "test-dates.cjs",
    testText: `${assertHeader}const { isLeapYear } = ${load("src/dates.cjs")};\nassert.equal(isLeapYear(2024), true);\nassert.equal(isLeapYear(2023), false);\nassert.equal(isLeapYear(1900), false);\nassert.equal(isLeapYear(2000), true);\nconsole.log("ok");\n`,
    ask: "implement isLeapYear in src/dates.cjs (Gregorian rules)",
  },
  {
    id: "coding.async",
    title: "Fix a missing await",
    source: "src/load.cjs",
    sourceText:
      "async function loadAll(ids, fetchOne) {\n  const out = [];\n  for (const id of ids) {\n    out.push(fetchOne(id));\n  }\n  return out;\n}\nmodule.exports = { loadAll };\n",
    test: "test-load.cjs",
    testText: `${assertHeader}const { loadAll } = ${load("src/load.cjs")};\nloadAll([1, 2, 3], async (id) => id * 10).then((values) => {\n  assert.deepEqual(values, [10, 20, 30]);\n  console.log("ok");\n});\n`,
    ask: "fix src/load.cjs so loadAll resolves to the values, not promises",
  },
  {
    id: "coding.defaults",
    title: "Handle invalid input",
    source: "src/config.cjs",
    sourceText:
      "const DEFAULTS = { retries: 3, verbose: false };\nfunction parseConfig(text) {\n  return { ...DEFAULTS, ...JSON.parse(text) };\n}\nmodule.exports = { parseConfig, DEFAULTS };\n",
    test: "test-config.cjs",
    testText: `${assertHeader}const { parseConfig, DEFAULTS } = ${load("src/config.cjs")};\nassert.deepEqual(parseConfig('{"retries":5}'), { retries: 5, verbose: false });\nassert.deepEqual(parseConfig("not json"), DEFAULTS);\nassert.deepEqual(parseConfig(""), DEFAULTS);\nconsole.log("ok");\n`,
    ask: "make parseConfig in src/config.cjs return the defaults when the text is not valid JSON",
  },
  {
    id: "coding.regex",
    title: "Fix a validation pattern",
    source: "src/ids.cjs",
    sourceText:
      "// Ids: a lowercase letter, then 2 to 15 lowercase letters, digits or dashes.\nconst ID_RE = /^[a-z0-9]+$/;\nfunction isValidId(id) {\n  return ID_RE.test(id);\n}\nmodule.exports = { isValidId };\n",
    test: "test-ids.cjs",
    testText: `${assertHeader}const { isValidId } = ${load("src/ids.cjs")};\nassert.equal(isValidId("ops-bot"), true);\nassert.equal(isValidId("a12"), true);\nassert.equal(isValidId("1abc"), false);\nassert.equal(isValidId("ab"), false);\nassert.equal(isValidId("abcdefghijklmnopq"), false);\nassert.equal(isValidId("Alice"), false);\nconsole.log("ok");\n`,
    ask: "fix the pattern in src/ids.cjs to match the comment",
  },
  {
    id: "coding.minimal-edit",
    title: "Fix one function, leave the others",
    source: "src/util.cjs",
    sourceText:
      "function clamp(value, min, max) {\n  return Math.max(max, Math.min(min, value));\n}\n\nfunction lerp(a, b, t) {\n  return a + (b - a) * t;\n}\n\nfunction round2(x) {\n  return Math.round(x * 100) / 100;\n}\n\nmodule.exports = { clamp, lerp, round2 };\n",
    test: "test-util.cjs",
    testText: `${assertHeader}const { clamp, lerp, round2 } = ${load("src/util.cjs")};\nassert.equal(clamp(5, 0, 10), 5);\nassert.equal(clamp(-1, 0, 10), 0);\nassert.equal(clamp(11, 0, 10), 10);\nassert.equal(lerp(0, 10, 0.5), 5);\nassert.equal(round2(1.234), 1.23);\nconsole.log("ok");\n`,
    ask: "fix clamp in src/util.cjs and change nothing else",
    keep: [
      "function lerp(a, b, t) {\n  return a + (b - a) * t;\n}",
      "function round2(x) {\n  return Math.round(x * 100) / 100;\n}",
    ],
  },
  {
    id: "coding.sort",
    title: "Stable multi-key sort",
    source: "src/tasks.cjs",
    sourceText:
      "// Highest priority first; equal priorities by name A-Z.\nfunction sortTasks(tasks) {\n  return [...tasks].sort((a, b) => b.priority - a.priority);\n}\nmodule.exports = { sortTasks };\n",
    test: "test-tasks.cjs",
    testText: `${assertHeader}const { sortTasks } = ${load("src/tasks.cjs")};\nconst input = [\n  { name: "beta", priority: 1 },\n  { name: "alpha", priority: 2 },\n  { name: "delta", priority: 1 },\n  { name: "charlie", priority: 1 },\n];\nassert.deepEqual(sortTasks(input).map((t) => t.name), ["alpha", "beta", "charlie", "delta"]);\nassert.equal(input[0].name, "beta");\nconsole.log("ok");\n`,
    ask: "fix sortTasks in src/tasks.cjs to match its comment",
  },
];

export const CODING_TASKS: BenchTask[] = FIXTURES.map((f) => ({
  id: f.id,
  axis: "coding",
  title: f.title,
  quick: f.quick,
  kits: ["files"],
  maxTurns: 8,
  setup: (ctx) => writeFiles(ctx.workspaceDir, { [f.source]: f.sourceText, [f.test]: f.testText }),
  sessions: [
    {
      prompt: `\`node ${f.test}\` fails. Read the files and ${f.ask} so the test passes. Do not change ${f.test}. You cannot run commands; use the file tools.`,
    },
  ],
  check: async (ctx) => {
    const run = await ctx.runNodeTest(f.test);
    const criteria: Record<string, boolean> = {
      "test passes": run.ok,
      "test file untouched": readFile(ctx.workspaceDir, f.test) === f.testText,
    };
    if (f.keep) {
      const source = readFile(ctx.workspaceDir, f.source) ?? "";
      criteria["other functions untouched"] = f.keep.every((k) => source.includes(k));
    }
    const result = rubric(criteria);
    // An edit that does not make the test pass is not partly right.
    return run.ok ? result : { score: 0, detail: `test fails; ${result.detail}` };
  },
}));
