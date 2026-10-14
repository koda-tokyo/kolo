import type { KoLoPluginApi } from "KoLo/plugin-sdk";
import { emptyPluginConfigSchema, registerMatrixAlertSender } from "KoLo/plugin-sdk";
import { matrixPlugin } from "./src/channel.js";
import { setMatrixRuntime } from "./src/runtime.js";
import { sendMessageMatrix } from "./src/matrix/send.js";

const plugin = {
  id: "matrix",
  name: "Matrix",
  description: "Matrix channel plugin (matrix-js-sdk)",
  configSchema: emptyPluginConfigSchema(),
  register(api: KoLoPluginApi) {
    setMatrixRuntime(api.runtime);
    api.registerChannel({ plugin: matrixPlugin });
    registerMatrixAlertSender(async (roomId, text) => sendMessageMatrix(roomId, text));
  },
};

export default plugin;
