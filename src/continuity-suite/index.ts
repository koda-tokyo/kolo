// Continuity suite (KoLo 2.0, M11): prove that a resident is the same resident after a model
// swap, a gateway restart, a state-dir move and a session close.
export * from "./types.js";
export {
  buildContinuityManifest,
  canonicalJson,
  chainEntries,
  diffKind,
  entryHash,
  loadSigningKey,
  manifestSigningInput,
  resolveResidentWorkspaceDir,
  signManifest,
  verifyManifest,
} from "./manifest.js";
export { keywordRecall, tokenize } from "./recall.js";
export { INVARIANTS, RECALL_THRESHOLD, scoreRun, summarize } from "./scorer.js";
export {
  buildBadge,
  buildReport,
  readReport,
  REPORT_BADGE,
  REPORT_JSON,
  REPORT_MD,
  reportToMarkdown,
  verifyReport,
  writeReport,
} from "./report.js";
export { parseDisruptions, runContinuity, scanForLeaks } from "./runner.js";
export { ProbeClient, waitFor } from "./client.js";
export { startFakeProvider, FAKE_PROFILES, composeAnswer } from "./fake-provider.js";
export { ThrowawayGateway } from "./throwaway.js";
export { SEED_FACTS, seedResidentWorkspace, newIdentityMarker } from "./seed.js";
