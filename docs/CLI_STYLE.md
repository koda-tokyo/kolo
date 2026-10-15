# CLI voice and conventions

Every string a person can see from the `kolo` command follows this page. Reviewers apply it to pull requests; `pnpm pack:check` and the smoke suite enforce the parts a machine can check.

## Voice

- Plain sentences, present tense, second person where a person is addressed ("run `kurahi init`"). No jokes, no mascots, no emoji, no exclamation marks.
- The same input produces the same text. No rotating taglines, holiday variants or random quips.
- Name the thing, then the state, then the next action: `gateway unreachable on port 18789 (connection refused). Start it with: kurahi service install`.
- No product-internal names, no personal names, no machine paths from a developer's computer, no model vendor names in copy. Providers are configuration; the copy says "provider".
- Examples use neutral identities: `alice`, `ops-bot`, `default`, `@ops-channel`, `+15555550100`.
- English only in the product. Translations live in the i18n table and never in call sites.

## Output

- One line per fact, aligned with two spaces: `state      /home/alice/.kolo`.
- Default output is the summary a person needs; detail is behind `--verbose`; machines use `--json` (stable keys, no ANSI, nothing else on stdout).
- Logs and diagnostics go to stderr; results go to stdout. `--version` prints the version and nothing else.
- Never print a secret, a token, a key, a full credential file path with its content, or another user's home directory.
- Never print a stack trace unless `--verbose` or `KOLO_DEBUG=1` is set. Errors are one line: `kolo <command>: <what happened> (<reason>). <next action>`.

## Exit codes

| Code | Meaning                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 0    | success                                                                                                    |
| 1    | the command ran and failed (including "gateway not running" for status commands)                           |
| 2    | usage: unknown command, bad flag, invalid value; usage text is printed                                     |
| 3    | the gateway is unreachable where reaching it was the point (`kurahi api`, `kurahi attach`, `kurahi agent`) |
| 4    | authentication or authorization failed                                                                     |

Each subcommand's `--help` ends with its exit codes when they differ from the table.

## Verbs

Subcommands use one verb set. Older synonyms stay as aliases so scripts keep working.

| Verb                                                                       | Use for                         | Aliases accepted                                 |
| -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `list`                                                                     | enumerate                       | `ls`                                             |
| `show`                                                                     | one item in detail              | `info`, `get`                                    |
| `add`                                                                      | create                          | `create` where the noun is created, not attached |
| `remove`                                                                   | delete                          | `rm`, `delete`                                   |
| `test`                                                                     | probe without changing anything | `check`, `verify`                                |
| `set` / `unset`                                                            | configuration values            |                                                  |
| `install` / `uninstall` / `start` / `stop` / `restart` / `status` / `logs` | the OS service                  |                                                  |
| `invite` / `approve` / `revoke`                                            | pairing                         |                                                  |

Nouns are singular for the group (`kurahi pair`, `kurahi secret`?) only where that is already the established name; do not rename existing groups for this rule.

## Help text

- Description: one line, no trailing period, starts with a verb or a noun phrase (`Scoped device pairing`).
- Options: `--flag <value>` with a short explanation and the default in parentheses.
- Examples section with two to five realistic invocations.
- Footer: `Docs: <url>` built from `src/config/product-urls.ts`; never a literal host.

## Flags

- `--json`, `--verbose`, `--yes`, `--non-interactive`, `--timeout <ms>` mean the same thing everywhere.
- Interactive prompts only when stdin and stdout are terminals and `--non-interactive` is absent; every prompt has a flag equivalent.
- Secrets are read from files, the secrets store, or `--stdin`; never from a flag value.

## First run

`kurahi init` is the only command a new user must know. It creates the state directory, the config and the gateway token, runs the doctor report and prints the next three commands. Everything it writes is idempotent and merge-safe.
