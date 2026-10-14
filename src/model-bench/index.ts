// Model bench (KoLo 2.0): resident-oriented model benchmark and the KODA tested catalogue.
export * from "./types.js";
export { benchSuite, selectTasks, type BenchSubset } from "./suite.js";
export {
  runModelBench,
  DEFAULT_MODEL_TOKEN_CAP,
  slugOf,
  type BenchTarget,
  type RunBenchOptions,
} from "./runner.js";
export { scoreModel, efficiencyScore, RESIDENT_TURNS_PER_HOUR } from "./scoring.js";
export {
  buildBenchReport,
  verifyBenchReport,
  benchReportToMarkdown,
  readBenchReport,
  writeBenchReport,
} from "./report.js";
export {
  createPiAiClient,
  parseBenchModelRef,
  benchSupportsProvider,
  type BenchModelClient,
} from "./client.js";
export { mergeBenchReports, BenchMergeError } from "./merge.js";
