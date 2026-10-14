import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProtocolJsonSchema } from "../src/gateway/protocol/json-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function writeJsonSchema() {
  const rootSchema = buildProtocolJsonSchema();
  const distDir = path.join(repoRoot, "dist");
  await fs.mkdir(distDir, { recursive: true });
  const jsonSchemaPath = path.join(distDir, "protocol.schema.json");
  await fs.writeFile(jsonSchemaPath, JSON.stringify(rootSchema, null, 2));
  console.log(`wrote ${jsonSchemaPath}`);
  return { jsonSchemaPath, schemaString: JSON.stringify(rootSchema) };
}

async function main() {
  await writeJsonSchema();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
