// One verb set across every subcommand (docs/CLI_STYLE.md): list / show / add / remove / test.
// Commands registered under older synonyms keep working and gain the canonical verb as an
// alias, so `kolo pair show <id>` and `kolo pair info <id>` are the same command and help
// prints both. Applied once, after all subcommands (including lazily registered ones) exist.

import type { Command } from "commander";

const CANONICAL: Record<string, string> = {
  info: "show",
  get: "show",
  delete: "remove",
  rm: "remove",
  ls: "list",
  check: "test",
  verify: "test",
};

const SHORTHAND: Record<string, string> = {
  list: "ls",
  remove: "rm",
};

function hasName(parent: Command, name: string): boolean {
  return parent.commands.some((cmd) => cmd.name() === name || cmd.aliases().includes(name));
}

export function applyVerbAliases(root: Command): void {
  const walk = (parent: Command) => {
    for (const cmd of parent.commands) {
      const name = cmd.name();
      const canonical = CANONICAL[name];
      if (canonical && !hasName(parent, canonical)) {
        cmd.alias(canonical);
      }
      const short = SHORTHAND[name];
      if (short && !hasName(parent, short)) {
        cmd.alias(short);
      }
      walk(cmd);
    }
  };
  walk(root);
}
