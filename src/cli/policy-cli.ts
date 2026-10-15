// `kurahi policy …` — policy as code (KoLo 2.0, M13d). Operator actions only; the policy document
// is signed by an owner key and enforced by the gateway for every resident.
//
//   kurahi policy init                       write a documented starter policy, create the owner key, sign
//   kurahi policy show|validate [file]       print / check a policy document
//   kurahi policy sign|verify [file]         attest with the owner key / check the attestation
//   kurahi policy diff <file>                changes a candidate would make to the active policy
//   kurahi policy apply <file> [--sign]      install a candidate (and its signature) as the active policy
//   kurahi policy status                     mode, attestation, kill switch, pauses (gateway or local)
//   kurahi policy kill|release --agent <id>|--all
//   kurahi policy budget [--agent <id>] [--reset]
//   kurahi policy schema                     the JSON Schema of the document
//
// Exit codes: 0 ok, 1 the command ran and failed (invalid, unsigned, refused), 2 usage.
import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import {
  runPolicyAction,
  runPolicyApply,
  runPolicyBudget,
  runPolicyDiff,
  runPolicyInit,
  runPolicyKill,
  runPolicyRelease,
  runPolicySchema,
  runPolicyShow,
  runPolicySign,
  runPolicyStatus,
  runPolicyValidate,
  runPolicyVerify,
} from "./policy-cli-actions.js";

export function registerPolicyCli(program: Command) {
  const runtime = defaultRuntime;
  const cmd = program
    .command("policy")
    .description("Policy as code: one signed policy.yaml enforced for every resident")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  kurahi policy init",
        "  kurahi policy validate && kurahi policy sign",
        "  kurahi policy diff ./candidate.yaml && kurahi policy apply ./candidate.yaml --sign",
        "  kurahi policy kill --agent ops-bot --reason 'incident 42'",
        "  kurahi policy release --all",
        "",
        `Docs: ${formatDocsLink("/policy")}`,
      ].join("\n"),
    );

  cmd
    .command("init")
    .description("Write a documented starter policy, create the owner key and sign it")
    .option("--force", "overwrite an existing policy")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await runPolicyAction(runtime, () => runPolicyInit(opts));
    });

  cmd
    .command("show")
    .description("Print the active policy (or a file) with its attestation")
    .argument("[file]", "policy file (default: the active policy)")
    .option("--json", "JSON output")
    .action(async (file: string | undefined, opts) => {
      await runPolicyAction(runtime, () => runPolicyShow({ ...opts, file }));
    });

  cmd
    .command("validate")
    .description("Check a policy document against the schema (exit 1 on errors)")
    .argument("[file]", "policy file (default: the active policy)")
    .option("--json", "JSON output")
    .action(async (file: string | undefined, opts) => {
      await runPolicyAction(runtime, () => runPolicyValidate({ ...opts, file }));
    });

  cmd
    .command("sign")
    .description("Sign a policy with the owner key and pin the key as an owner; audited")
    .argument("[file]", "policy file (default: the active policy)")
    .option("--key <file>", "owner key file (default: <KOLO_HOME>/secrets/policy-owner.json)")
    .option("--json", "JSON output")
    .action(async (file: string | undefined, opts) => {
      await runPolicyAction(runtime, () => runPolicySign({ ...opts, file }));
    });

  cmd
    .command("verify")
    .description("Verify the signature and that the signer is a pinned owner (exit 1 otherwise)")
    .argument("[file]", "policy file (default: the active policy)")
    .option("--json", "JSON output")
    .action(async (file: string | undefined, opts) => {
      await runPolicyAction(runtime, () => runPolicyVerify({ ...opts, file }));
    });

  cmd
    .command("diff")
    .description("Show the changes a candidate policy would make to the active one")
    .argument("<file>", "candidate policy file")
    .option("--json", "JSON output")
    .action(async (file: string, opts) => {
      await runPolicyAction(runtime, () => runPolicyDiff(file, opts));
    });

  cmd
    .command("apply")
    .description("Install a candidate (with its .sig, or --sign) as the active policy; audited")
    .argument("<file>", "candidate policy file")
    .option("--sign", "sign the installed copy with the owner key")
    .option("--key <file>", "owner key file for --sign")
    .option("--json", "JSON output")
    .action(async (file: string, opts) => {
      await runPolicyAction(runtime, () => runPolicyApply(file, opts));
    });

  cmd
    .command("status")
    .description(
      "Mode, attestation, kill switch and budget pauses (from the gateway when reachable)",
    )
    .option("--local", "read the files only; do not contact the gateway")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await runPolicyAction(runtime, () => runPolicyStatus(opts));
    });

  cmd
    .command("kill")
    .description("Stop one agent or the fleet now: running jobs aborted, new work refused; audited")
    .option("--agent <id>", "agent id")
    .option("--all", "the whole fleet")
    .option("--reason <text>", "recorded in the audit log")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await runPolicyAction(runtime, () => runPolicyKill(opts));
    });

  cmd
    .command("release")
    .description("Clear the kill switch (and any budget pause) for one agent or the fleet; audited")
    .option("--agent <id>", "agent id")
    .option("--all", "the whole fleet")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await runPolicyAction(runtime, () => runPolicyRelease(opts));
    });

  cmd
    .command("budget")
    .description("Budget meters per agent and for the fleet against the policy limits")
    .option("--agent <id>", "one agent only")
    .option("--reset", "zero every counter (audited)")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await runPolicyAction(runtime, () => runPolicyBudget(opts));
    });

  cmd
    .command("schema")
    .description("Print the JSON Schema of the policy document")
    .action(async () => {
      await runPolicyAction(runtime, () => runPolicySchema());
    });
}
