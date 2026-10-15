// `kurahi doctor` section for the self-check plugin report (KoLo 2.0, M7).
// The plugin (extensions/self-check) writes <stateDir>/self-check/latest.json on every run; doctor
// only reads it, so a doctor run never needs the gateway to be up.
import { readSelfCheckReport, selfCheckReportPath } from "../cli/plugins-cli.js";
import { note } from "../terminal/note.js";
import { shortenHomePath } from "../utils.js";

export function noteSelfCheckReport(): void {
  const report = readSelfCheckReport();
  if (!report) {
    return;
  }
  const problems = report.findings.filter((f) => f.level !== "info");
  const checks = Object.entries(report.checks)
    .map(([name, state]) => `${name}=${state}`)
    .join(" ");
  const lines = [
    `Last run: ${report.ranAt} (${report.ok ? "ok" : "findings"})`,
    checks ? `Checks: ${checks}` : null,
    ...problems.map((f) => `- [${f.level}] ${f.check}: ${f.message}`),
    `Report: ${shortenHomePath(selfCheckReportPath())}`,
  ].filter((line): line is string => Boolean(line));
  note(lines.join("\n"), problems.length > 0 ? "Self-check (plugin)" : "Self-check (plugin): ok");
}
