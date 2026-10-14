// The task suite: 51 generic tasks over six axes, plus the reduced `quick` subset for slow local
// models. Ids are stable; a renamed task is a new task.
import type { BenchTask } from "./types.js";
import { CODING_TASKS } from "./tasks/coding.js";
import { CONTINUITY_TASKS } from "./tasks/continuity.js";
import { JAPANESE_TASKS, PORTUGUESE_TASKS } from "./tasks/language.js";
import { POLICY_TASKS } from "./tasks/policy.js";
import { TOOL_USE_TASKS } from "./tasks/tool-use.js";

export type BenchSubset = "full" | "quick";

export function benchSuite(): BenchTask[] {
  return [
    ...TOOL_USE_TASKS,
    ...POLICY_TASKS,
    ...CONTINUITY_TASKS,
    ...CODING_TASKS,
    ...JAPANESE_TASKS,
    ...PORTUGUESE_TASKS,
  ];
}

/** Tasks of a subset, optionally narrowed to ids or id prefixes (`policy.`, `coding.sort`). */
export function selectTasks(params: {
  subset?: BenchSubset;
  only?: readonly string[];
  tasks?: BenchTask[];
}): BenchTask[] {
  const all = params.tasks ?? benchSuite();
  let picked = params.subset === "quick" ? all.filter((t) => t.quick) : all;
  if (params.only && params.only.length > 0) {
    const wanted = params.only.map((s) => s.trim()).filter(Boolean);
    picked = picked.filter((t) => wanted.some((w) => t.id === w || t.id.startsWith(w)));
  }
  return picked;
}
