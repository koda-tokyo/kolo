import type { KoLoPluginApi } from "KoLo/plugin-sdk";
import { emptyPluginConfigSchema } from "KoLo/plugin-sdk";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: KoLoPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
