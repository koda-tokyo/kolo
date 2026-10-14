// The last, optional step of `kolo init` (KoLo 2.0, M16): "Connect your phone". Interactive runs
// ask; `--phone whatsapp|telegram|line|web|skip` answers without a prompt. The step runs the same
// flows as `kolo connect <channel>`. A problem here never fails init: the state, config and token
// are already written, and the step can be repeated with `kolo connect`.
import type { RuntimeEnv } from "../runtime.js";
import type { ConnectDeps, ConnectResult, PhoneChannel } from "./connect/types.js";
import { createDefaultConnectDeps, runConnect } from "./connect/index.js";
import { PHONE_CHANNELS } from "./connect/types.js";

export type InitPhoneChoice = PhoneChannel | "skip";
export const INIT_PHONE_CHOICES: readonly InitPhoneChoice[] = [...PHONE_CHANNELS, "skip"];

export function isInitPhoneChoice(value: unknown): value is InitPhoneChoice {
  return typeof value === "string" && (INIT_PHONE_CHOICES as readonly string[]).includes(value);
}

export async function askPhoneChoice(
  deps: Pick<ConnectDeps, "prompter">,
  gatewayBind: string,
): Promise<InitPhoneChoice> {
  if (!deps.prompter) {
    return "skip";
  }
  const browserReachable = gatewayBind !== "loopback";
  const choice = await deps.prompter.select<InitPhoneChoice>(
    "Connect your phone (your resident answers you there)",
    [
      { value: "telegram", label: "Telegram", hint: "your own bot; about two minutes" },
      { value: "whatsapp", label: "WhatsApp", hint: "link this machine as a device; scan a QR" },
      { value: "line", label: "LINE", hint: "Messaging API; needs a public HTTPS webhook" },
      {
        value: "web",
        label: "Phone browser",
        hint: browserReachable
          ? "dashboard on your network or tailnet"
          : "needs --bind lan or tailnet; explains how",
      },
      { value: "skip", label: "Skip", hint: "later: kolo connect <channel>" },
    ],
    "skip",
  );
  return choice ?? "skip";
}

/** Runs the chosen flow and reports; returns null for skip. Never exits the process. */
export async function runInitPhoneStep(input: {
  choice: InitPhoneChoice | undefined;
  interactive: boolean;
  json: boolean;
  gatewayBind: string;
  runtime: RuntimeEnv;
  deps?: ConnectDeps;
}): Promise<ConnectResult | null> {
  if (!input.choice && !input.interactive) {
    return null;
  }
  const deps =
    input.deps ??
    (await createDefaultConnectDeps({ runtime: input.runtime, interactive: input.interactive }));
  const choice = input.choice ?? (await askPhoneChoice(deps, input.gatewayBind));
  if (choice === "skip") {
    return null;
  }
  if (!input.json) {
    input.runtime.log("");
    input.runtime.log(`phone      ${choice}`);
  }
  const result = await runConnect(deps, {
    channel: choice,
    json: input.json,
    fromInit: true,
    // Non-interactive init prints the code and returns; interactive waits like kolo connect.
    wait: input.interactive ? undefined : false,
  });
  if (!result.ok && !input.json) {
    input.runtime.log(`phone      not connected: ${result.message}`);
    input.runtime.log(`           retry any time: kolo connect ${choice}`);
  }
  return result;
}
