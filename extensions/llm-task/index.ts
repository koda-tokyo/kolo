import type { KoLoPluginApi } from "../../src/plugins/types.js";
import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: KoLoPluginApi) {
  api.registerTool(createLlmTaskTool(api), { optional: true });
}
