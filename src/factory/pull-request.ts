// Pull requests for ready cards (KoLo 2.0, M15b). The runner pushes the engine's branch and
// opens the pull request with the `gh` CLI; both commands run with the repository as working
// directory and never receive a token (gh keeps its own credentials). Injected `exec` keeps the
// tests offline.
import { execFile } from "node:child_process";

export type CommandRunner = (
  file: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const defaultCommandRunner: CommandRunner = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? ((err as { code: number }).code ?? 1)
            : err
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });

export type OpenPullRequestInput = {
  repo: string;
  branch: string;
  base?: string;
  remote: string;
  title: string;
  body: string;
  draft?: boolean;
  exec?: CommandRunner;
  timeoutMs?: number;
};

export type OpenPullRequestResult =
  | { ok: true; url: string; number?: number }
  | { ok: false; error: string };

const URL_RE = /https?:\/\/\S+\/pull\/(\d+)/;

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

export async function openPullRequest(input: OpenPullRequestInput): Promise<OpenPullRequestResult> {
  const exec = input.exec ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? 120_000;
  const push = await exec("git", ["push", "-u", input.remote, input.branch], {
    cwd: input.repo,
    timeoutMs,
  });
  if (push.code !== 0) {
    return {
      ok: false,
      error: `git push failed: ${firstLine(push.stderr) || `exit ${push.code}`}`,
    };
  }
  const args = [
    "pr",
    "create",
    "--head",
    input.branch,
    "--title",
    input.title.slice(0, 200),
    "--body",
    input.body,
  ];
  if (input.base) {
    args.push("--base", input.base);
  }
  if (input.draft) {
    args.push("--draft");
  }
  const pr = await exec("gh", args, { cwd: input.repo, timeoutMs });
  if (pr.code !== 0) {
    return {
      ok: false,
      error: `gh pr create failed: ${firstLine(pr.stderr) || `exit ${pr.code}`}`,
    };
  }
  const match = URL_RE.exec(`${pr.stdout}\n${pr.stderr}`);
  if (!match) {
    return { ok: false, error: "gh pr create did not print a pull request URL" };
  }
  return { ok: true, url: match[0], number: Number.parseInt(match[1], 10) };
}
