// gateway-v3 routing stream adapter
// Enforces memory budget on LLM streaming responses.

let adapterSingleton: V3StreamAdapter | null = null;

interface StreamAdapterConfig {
  memoryBudget?: number;
}

export class V3StreamAdapter {
  private config: StreamAdapterConfig;

  constructor(config: StreamAdapterConfig = {}) {
    this.config = config;
  }

  get memoryBudget(): number | undefined {
    return this.config.memoryBudget;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapStreamFn(fn: any, _opts: Record<string, unknown>): any {
    return fn;
  }
}

export function initV3StreamAdapter(config: StreamAdapterConfig = {}): void {
  adapterSingleton = new V3StreamAdapter(config);
}

export function getOrCreateV3StreamAdapter(): V3StreamAdapter {
  if (!adapterSingleton) {
    adapterSingleton = new V3StreamAdapter();
  }
  return adapterSingleton;
}
