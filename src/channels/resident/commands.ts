import type { JobRecord } from "../../agents/jobs.js";
// Conversation commands usable from any channel (KoLo 2.0, M14b): /status, /jobs, /cancel,
// /evidence, /pause, /resume, /help, and the approval keywords. Permission comes from the
// sender's role (identity.ts): reading commands need `attach`, acting commands need `admin`
// (owner implies admin). Replies use the channel locale. Every command is audited.
import type { KoLoConfig } from "../../config/config.js";
import type { ChannelIdentityRole } from "../../config/types.channels-resident.js";
import type { ResidentInbound } from "./ingress.js";
import { cancelJob, getJob, listJobs } from "../../agents/jobs.js";
import { auditSafe } from "../../audit/audit-log.js";
import { isSafeJobId, readJobEvents, readJobManifest } from "../../evidence/store.js";
import { summarizeEvents } from "../../evidence/summary.js";
import { parseApprovalReply, resolveChannelApproval } from "./approvals.js";
import { hasConfiguredIdentities, roleAtLeast } from "./identity.js";
import { getPause, pauseConversation, resumeConversation } from "./pause.js";
import { channelText } from "./templates.js";

export type ResidentCommandName =
  | "help"
  | "status"
  | "jobs"
  | "cancel"
  | "evidence"
  | "pause"
  | "resume"
  | "approve"
  | "deny";

export const RESIDENT_COMMANDS: readonly ResidentCommandName[] = [
  "help",
  "status",
  "jobs",
  "cancel",
  "evidence",
  "pause",
  "resume",
  "approve",
  "deny",
];

const REQUIRED_ROLE: Record<ResidentCommandName, ChannelIdentityRole> = {
  help: "attach",
  status: "attach",
  jobs: "attach",
  evidence: "attach",
  cancel: "admin",
  pause: "admin",
  resume: "admin",
  approve: "admin",
  deny: "admin",
};

export type ParsedResidentCommand = {
  name: ResidentCommandName;
  args: string[];
  raw: string;
};

/** `/status`, `/cancel abc`, `/evidence:abc`, `approve abc`, `deny abc`. */
export function parseResidentCommand(text: string): ParsedResidentCommand | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const approval = parseApprovalReply(trimmed);
  if (approval) {
    return {
      name: approval.decision === "deny" ? "deny" : "approve",
      args: [approval.id, approval.decision],
      raw: trimmed,
    };
  }
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const firstLine = trimmed.split("\n")[0].trim();
  const m = firstLine.match(/^\/([a-z]+)(?:[\s:]+(.*))?$/i);
  if (!m) {
    return null;
  }
  const name = m[1].toLowerCase();
  if (!(RESIDENT_COMMANDS as readonly string[]).includes(name)) {
    return null;
  }
  const args = (m[2] ?? "")
    .split(/\s+/)
    .map((a) => a.trim())
    .filter(Boolean);
  return { name: name as ResidentCommandName, args, raw: trimmed };
}

export type ResidentCommandResult = {
  handled: true;
  reply: string;
  command: ResidentCommandName;
  outcome: "ok" | "denied" | "error";
};

function fmtJob(job: JobRecord): string {
  const when = job.endedAt ?? job.startedAt;
  const err = job.error ? ` (${job.error.slice(0, 60)})` : "";
  return `${job.id.slice(0, 8)}  ${job.status}  ${job.kind}  ${when.slice(0, 19).replace("T", " ")}${err}`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) {
    return "-";
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const s = Math.round(ms / 100) / 10;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** Resolve a job by full id or unique prefix among the agent's jobs. */
export function findJobByPrefix(agentId: string, idOrPrefix: string): JobRecord | undefined {
  const exact = getJob(idOrPrefix);
  if (exact) {
    return exact;
  }
  const matches = listJobs({ agent: agentId, limit: 500 }).filter((j) =>
    j.id.startsWith(idOrPrefix),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Compact text form of a job's evidence: the REPORT.md summary, chat-sized. */
export function renderEvidenceSummaryText(
  jobId: string,
  locale: "en" | "ja" | "pt",
): string | null {
  if (!isSafeJobId(jobId)) {
    return null;
  }
  const events = readJobEvents(jobId);
  if (events.length === 0) {
    return null;
  }
  const manifest = readJobManifest(jobId);
  const s = summarizeEvents(events, { signed: Boolean(manifest) });
  const lines: string[] = [];
  lines.push(`evidence ${s.jobId}`);
  lines.push(`agent ${s.agent}`);
  lines.push(`status ${s.status}${s.error ? ` (${s.error.slice(0, 80)})` : ""}`);
  lines.push(`duration ${fmtDuration(s.durationMs)}`);
  lines.push(`model turns ${s.modelTurns}, tool calls ${s.toolCalls} (${s.toolErrors} failed)`);
  if (s.filesChanged.length > 0) {
    lines.push(`files changed ${s.filesChanged.length}: ${s.filesChanged.slice(0, 5).join(", ")}`);
  }
  if (s.permissions.denied > 0) {
    lines.push(`permissions denied ${s.permissions.denied}`);
  }
  if (s.loopStops > 0) {
    lines.push(`loop stops ${s.loopStops}`);
  }
  if (s.finalTextExcerpt) {
    lines.push(`final: ${s.finalTextExcerpt.slice(0, 280)}`);
  }
  lines.push(`signed ${s.signed ? "yes" : "no"}${s.truncated ? ", log truncated" : ""}`);
  const more = { en: "Full report", ja: "詳細", pt: "Relatório completo" }[locale];
  lines.push(`${more}: kolo evidence show ${s.jobId}`);
  return lines.join("\n");
}

export async function handleResidentCommand(input: {
  inbound: ResidentInbound;
  cfg: KoLoConfig;
  text?: string;
  nowMs?: number;
}): Promise<ResidentCommandResult | null> {
  const { inbound, cfg } = input;
  const parsed = parseResidentCommand(input.text ?? inbound.text);
  if (!parsed) {
    return null;
  }
  // `/status` and `/help` exist as built-in channel commands; the resident versions take over
  // only on channels that configured identities. The other names are new and always ours.
  if (
    (parsed.name === "status" || parsed.name === "help") &&
    !hasConfiguredIdentities(cfg, inbound.channel, inbound.accountId)
  ) {
    return null;
  }
  const locale = inbound.locale;
  const role = inbound.identity?.role ?? null;
  const audit = (outcome: ResidentCommandResult["outcome"], detail?: Record<string, unknown>) => {
    void auditSafe({
      identity: inbound.senderId ?? inbound.senderName ?? null,
      scope: inbound.sessionKey,
      action: "channel.command",
      outcome,
      source: "channels.resident",
      detail: {
        channel: inbound.channel,
        accountId: inbound.accountId ?? null,
        command: parsed.name,
        args: parsed.args,
        role,
        ...detail,
      },
    });
  };
  const done = (reply: string, outcome: ResidentCommandResult["outcome"] = "ok") => {
    audit(outcome);
    return { handled: true as const, reply, command: parsed.name, outcome };
  };

  // Approval keywords may also be granted by `channels.approvals.identities`.
  const approvalIdentityOk =
    (parsed.name === "approve" || parsed.name === "deny") &&
    Boolean(inbound.senderId) &&
    (cfg.channels?.approvals?.identities ?? []).some(
      (id) => id.trim().toLowerCase() === inbound.senderId?.toLowerCase(),
    );

  if (!role && !approvalIdentityOk) {
    return done(channelText(locale, "error.unknownIdentity"), "denied");
  }
  if (!roleAtLeast(role, REQUIRED_ROLE[parsed.name]) && !approvalIdentityOk) {
    return done(
      channelText(locale, "error.notPermitted", { command: `/${parsed.name}` }),
      "denied",
    );
  }

  const conv = {
    channel: inbound.channel,
    accountId: inbound.accountId,
    conversationId: inbound.conversationId ?? inbound.sessionKey,
  };

  switch (parsed.name) {
    case "help": {
      const lines = [
        channelText(locale, "help.title"),
        channelText(locale, "help.status"),
        channelText(locale, "help.jobs"),
        channelText(locale, "help.cancel"),
        channelText(locale, "help.evidence"),
        channelText(locale, "help.pause"),
        channelText(locale, "help.resume"),
        channelText(locale, "help.approve"),
        channelText(locale, "help.help"),
        channelText(locale, "help.role", { role: channelText(locale, `role.${role ?? "none"}`) }),
      ];
      return done(lines.join("\n"));
    }
    case "status": {
      const jobs = listJobs({ agent: inbound.agentId, limit: 200 });
      const running = jobs.filter((j) => j.status === "running").length;
      const queued = jobs.filter((j) => j.status === "queued").length;
      const last = jobs[0];
      const paused = getPause(conv) !== null;
      return done(
        channelText(locale, "status.line", {
          agent: inbound.agentId,
          session: inbound.sessionKey,
          mode: channelText(locale, paused ? "status.paused" : "status.active"),
          running,
          queued,
          last: last ? `${last.id.slice(0, 8)} ${last.status}` : channelText(locale, "status.none"),
        }),
      );
    }
    case "jobs": {
      const jobs = listJobs({ agent: inbound.agentId, limit: 8 });
      if (jobs.length === 0) {
        return done(channelText(locale, "jobs.empty"));
      }
      return done([channelText(locale, "jobs.header"), ...jobs.map(fmtJob)].join("\n"));
    }
    case "cancel": {
      const id = parsed.args[0];
      if (!id) {
        return done(channelText(locale, "error.missingArg", { usage: "/cancel <id>" }), "error");
      }
      const job = findJobByPrefix(inbound.agentId, id);
      if (!job) {
        return done(channelText(locale, "cancel.notFound", { id }), "error");
      }
      const result = cancelJob(job.id, {
        requestedBy: `${inbound.channel}:${inbound.senderId ?? "?"}`,
      });
      if (!result.ok) {
        return done(
          channelText(locale, "cancel.finished", {
            id: job.id.slice(0, 8),
            status: result.job?.status ?? "-",
          }),
          "error",
        );
      }
      return done(channelText(locale, "cancel.ok", { id: job.id.slice(0, 8) }));
    }
    case "evidence": {
      const id = parsed.args[0];
      if (!id) {
        return done(
          channelText(locale, "error.missingArg", { usage: "/evidence <jobId>" }),
          "error",
        );
      }
      const job = findJobByPrefix(inbound.agentId, id);
      const text = renderEvidenceSummaryText(job?.id ?? id, locale);
      if (!text) {
        return done(channelText(locale, "evidence.none", { id }), "error");
      }
      return done(text);
    }
    case "pause": {
      const result = pauseConversation({
        ...conv,
        sessionKey: inbound.sessionKey,
        by: inbound.senderId,
        now: input.nowMs ? new Date(input.nowMs) : undefined,
      });
      return done(channelText(locale, result.created ? "pause.ok" : "pause.already"));
    }
    case "resume": {
      const resumed = resumeConversation(conv);
      return done(channelText(locale, resumed ? "resume.ok" : "resume.already"));
    }
    case "approve":
    case "deny": {
      const [id, decisionRaw] = parsed.args;
      const decision =
        decisionRaw === "allow-always" || decisionRaw === "deny" ? decisionRaw : "allow-once";
      const result = await resolveChannelApproval({
        id,
        decision: parsed.name === "deny" ? "deny" : decision,
        resolvedBy: `${inbound.channel}:${inbound.senderId ?? inbound.senderName ?? "?"}`,
        channel: inbound.channel,
        sessionKey: inbound.sessionKey,
        nowMs: input.nowMs,
      });
      if (!result.ok) {
        audit("error", { approvalId: id, reason: result.reason });
        return {
          handled: true,
          reply: channelText(locale, "approval.unknown", { id }),
          command: parsed.name,
          outcome: "error",
        };
      }
      audit("ok", { approvalId: id, decision: result.decision });
      return {
        handled: true,
        reply: channelText(locale, "approval.resolved", {
          id,
          decision: channelText(locale, `approval.decision.${result.decision}`),
          by: inbound.senderName ?? inbound.senderId ?? "-",
        }),
        command: parsed.name,
        outcome: "ok",
      };
    }
    default:
      return null;
  }
}
