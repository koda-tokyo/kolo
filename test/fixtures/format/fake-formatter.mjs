// Fake formatter for tests: rewrites the file to a canonical form, or misbehaves on request.
// usage: node fake-formatter.mjs [--fail] [--sleep <ms>] [--noop] <file>
import fs from "node:fs";

const args = process.argv.slice(2);
const file = args[args.length - 1];
if (args.includes("--sleep")) {
  const ms = Number(args[args.indexOf("--sleep") + 1]);
  await new Promise((resolve) => setTimeout(resolve, ms));
}
if (args.includes("--fail")) {
  console.error("fake-formatter: syntax error at line 1");
  process.exit(2);
}
if (!args.includes("--noop")) {
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, `${text.trim().replace(/\s+/g, " ")}\n`);
}
console.log("done");
