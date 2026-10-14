/**
 * permission-modes.ts — Permission Decision Engine
 *
 * Ported from Claude Code's 4-mode permission system (spec 05 §2).
 *
 * Modes:
 *   DEFAULT  — Interactive prompt for each tool use
 *   AUTO     — ML classifier auto-approves LOW risk, explains MEDIUM, prompts HIGH
 *   BYPASS   — Skip all checks (trusted session)
 *   YOLO     — Deny all (ironically named — "you only live once" = be safe)
 *
 * CC Reference: spec/05_components_agents_permissions_design.md §2.1
 */

import { classifyToolRisk, RiskTier } from "./risk-classifier.js";

export enum PermissionMode {
  /** Interactive — prompt user for every tool decision */
  DEFAULT = "default",
  /** ML-based auto-approval for safe operations */
  AUTO = "auto",
  /** Skip all checks — trusted session */
  BYPASS = "bypass",
  /** Deny everything — maximum safety mode */
  YOLO = "yolo",
}

export type PermissionDecision = {
  /** Allow, deny, or ask user */
  action: "allow" | "deny" | "ask";
  /** Human-readable explanation for the decision */
  explanation: string;
  /** Risk assessment that drove this decision */
  risk: ReturnType<typeof classifyToolRisk>;
  /** Whether to show the risk explainer to the user */
  showExplainer: boolean;
};

export interface PermissionContext {
  mode: PermissionMode;
  /** Session-level permission overrides */
  sessionOverrides?: Partial<Record<string, "allow" | "deny">>;
  /** Has the user explicitly trusted this session? */
  sessionTrusted: boolean;
  /** Is this an auto-approved tool pattern? */
  autoApprovedPatterns?: RegExp[];
}

/**
 * Build a permission explainer string for display to the user.
 * Mirrors CC's permission explainer LLM pattern.
 */
export function buildExplainer(decision: PermissionDecision): string {
  const { risk } = decision;
  const lines: string[] = [];

  lines.push(`⚠️  Risk: ${risk.tier} — ${risk.reason}`);

  if (risk.flags.length > 0) {
    lines.push(`   Flags: ${risk.flags.join(", ")}`);
  }

  if (risk.isDestructive) {
    lines.push("   ⚡ This operation modifies your system.");
  }

  if (risk.hasNetworkAccess) {
    lines.push("   🌐 This operation accesses the network.");
  }

  return lines.join("\n");
}

/**
 * Core permission decision engine.
 * Input: tool details + context → Output: allow/deny/ask + explainer.
 */
export function decide(params: {
  toolName: string;
  operation?: string;
  paths?: string[];
  command?: string;
  context: PermissionContext;
}): PermissionDecision {
  const risk = classifyToolRisk(params);
  const { context } = params;

  // ── YOLO mode: deny everything ──────────────────────────────
  if (context.mode === PermissionMode.YOLO) {
    return {
      action: "deny",
      explanation: `YOLO mode active: ${risk.tier} risk operation denied.`,
      risk,
      showExplainer: false,
    };
  }

  // ── Session override: explicit allow/deny for this tool ─────
  const override = context.sessionOverrides?.[params.toolName];
  if (override === "deny") {
    return {
      action: "deny",
      explanation: `${params.toolName} is denied by session override.`,
      risk,
      showExplainer: false,
    };
  }
  if (override === "allow") {
    return {
      action: "allow",
      explanation: `${params.toolName} allowed by session override.`,
      risk,
      showExplainer: false,
    };
  }

  // ── BYPASS mode: allow everything (trusted) ────────────────
  if (context.mode === PermissionMode.BYPASS && context.sessionTrusted) {
    return {
      action: "allow",
      explanation: `Trusted session: ${params.toolName} auto-approved.`,
      risk,
      showExplainer: risk.tier === RiskTier.HIGH,
    };
  }

  // ── AUTO mode: ML-classifier-style decision ────────────────
  if (context.mode === PermissionMode.AUTO) {
    switch (risk.tier) {
      case RiskTier.LOW:
        return {
          action: "allow",
          explanation: `Auto: ${params.toolName} is read-only — safe.`,
          risk,
          showExplainer: false,
        };
      case RiskTier.MEDIUM:
        // Show explainer but auto-approve for trusted sessions
        if (context.sessionTrusted) {
          return {
            action: "allow",
            explanation: `Auto: ${params.toolName} — reviewed, approved for trusted session.`,
            risk,
            showExplainer: true,
          };
        }
        return {
          action: "ask",
          explanation: `Auto: ${params.toolName} requires review.`,
          risk,
          showExplainer: true,
        };
      case RiskTier.HIGH:
        return {
          action: "ask",
          explanation: `Auto: ${params.toolName} is HIGH risk — requires explicit approval.`,
          risk,
          showExplainer: true,
        };
    }
  }

  // ── DEFAULT mode: always ask ──────────────────────────────
  return {
    action: "ask",
    explanation: `${params.toolName} requires approval.`,
    risk,
    showExplainer: risk.tier !== RiskTier.LOW,
  };
}
