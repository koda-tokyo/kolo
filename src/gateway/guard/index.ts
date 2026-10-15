/**
 * guard/index.ts — Gateway Permission Hardening Module
 *
 * Extracted from Claude Code's permission architecture (CC-source/spec/05).
 *
 * Single entry point for all permission checks in the Kurahi Gateway.
 * Drop-in replacement for the current simple timeout-based exec approval.
 *
 * Usage:
 *   import { guard } from "../gateway/guard/index.js";
 *
 *   const decision = guard.decidePermission({
 *     toolName: "exec",
 *     command: "rm file.txt",
 *     context: { mode: "auto", sessionTrusted: false },
 *   });
 *   // → { action: "ask", explanation: "...", risk: { tier: "MEDIUM", ... } }
 *
 *   const pathCheck = await guard.checkPath("/etc/passwd", [os.homedir()]);
 *   // → { safe: false, reason: "outside allowed roots" }
 */

export { classifyToolRisk, RiskTier, RiskFlag } from "./risk-classifier.js";
export type { RiskAssessment } from "./risk-classifier.js";

export {
  validatePath,
  isProtected,
  securePath,
  PROTECTED_FILES,
  PROTECTED_DIRS,
} from "./path-guard.js";

export { decide, buildExplainer, PermissionMode } from "./permission-modes.js";
export type { PermissionDecision, PermissionContext } from "./permission-modes.js";

import type { PermissionContext, PermissionDecision } from "./permission-modes.js";
import { securePath } from "./path-guard.js";
import { decide, buildExplainer } from "./permission-modes.js";
// ── Convenience: single guard object ─────────────────────────────────
import { classifyToolRisk } from "./risk-classifier.js";

export const guard = {
  /** Classify a tool operation by risk */
  classifyRisk: classifyToolRisk,

  /** Full permission decision (risk + mode → allow/deny/ask) */
  decidePermission(params: {
    toolName: string;
    operation?: string;
    paths?: string[];
    command?: string;
    context: PermissionContext;
  }): PermissionDecision {
    return decide(params);
  },

  /** Secure a file path against traversal + protection violations */
  checkPath: securePath,

  /** Build a user-facing risk explainer */
  explain: buildExplainer,
};

// ── Re-export integration layer ───────────────────────────────────
export {
  guardToolCall,
  assessToolRisk,
  validateToolPath,
  logGuardDecision,
} from "./guard-integration.js";
export type { GuardResult } from "./guard-integration.js";
