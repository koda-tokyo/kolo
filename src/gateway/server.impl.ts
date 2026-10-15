import type { CanvasHostServer } from "../canvas-host/server.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import type { RuntimeEnv } from "../runtime.js";
import type { startBrowserControlServerIfEnabled } from "./server-browser.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { registerSkillsChangeListener } from "../agents/skills/refresh.js";
import { initSubagentRegistry } from "../agents/subagent-registry.js";
import { auditSafe } from "../audit/audit-log.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { createResidentApprovalForwarderDeps } from "../channels/resident/approval-bridge.js";
import { setChannelApprovalResolver } from "../channels/resident/approvals.js";
import { onChannelInbound } from "../channels/resident/inbound-bus.js";
import { queuedOutboundDeliver } from "../channels/resident/queued-deliver.js";
import { formatCliCommand } from "../cli/command-format.js";
import { createDefaultDeps } from "../cli/deps.js";
import {
  CONFIG_PATH,
  isNixMode,
  loadConfig,
  migrateLegacyConfig,
  readConfigFileSnapshot,
  writeConfigFile,
} from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { bootConsciousness } from "../consciousness/boot.js";
import { clearAgentRunContext, onAgentEvent } from "../infra/agent-events.js";
import { isDiagnosticsEnabled } from "../infra/diagnostic-events.js";
import { logAcceptedEnvOption } from "../infra/env.js";
import { createExecApprovalForwarder } from "../infra/exec-approval-forwarder.js";
import { onHeartbeatEvent } from "../infra/heartbeat-events.js";
import { startHeartbeatRunner } from "../infra/heartbeat-runner.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { ensureKoLoCliOnPath } from "../infra/path-env.js";
import { setGatewaySigusr1RestartPolicy } from "../infra/restart.js";
import {
  primeRemoteSkillsCache,
  refreshRemoteBinsForConnectedNodes,
  setSkillsRemoteRegistry,
} from "../infra/skills-remote.js";
import { scheduleGatewayUpdateCheck } from "../infra/update-startup.js";
import { startDiagnosticHeartbeat, stopDiagnosticHeartbeat } from "../logging/diagnostic.js";
import { createSubsystemLogger, runtimeForLogger } from "../logging/subsystem.js";
import { startMcpFromConfig } from "../mcp/client/manager.js";
import { getPluginHost } from "../plugins/loader.js";
import { runOnboardingWizard } from "../wizard/onboarding.js";
import { startGatewayConfigReloader } from "./config-reload.js";
import { ExecApprovalManager } from "./exec-approval-manager.js";
import { NodeRegistry } from "./node-registry.js";
import { setGatewayPluginHost } from "./plugins-http.js";
import { createChannelManager } from "./server-channels.js";
import { createAgentEventHandler } from "./server-chat.js";
import { createGatewayCloseHandler } from "./server-close.js";
import { buildGatewayCronService } from "./server-cron.js";
import { startGatewayDiscovery } from "./server-discovery-runtime.js";
import { applyGatewayLaneConcurrency } from "./server-lanes.js";
import { startGatewayMaintenanceTimers } from "./server-maintenance.js";
import { GATEWAY_EVENTS, listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";
import { createExecApprovalHandlers } from "./server-methods/exec-approval.js";
import { safeParseJson } from "./server-methods/nodes.helpers.js";
import { hasConnectedMobileNode } from "./server-mobile-nodes.js";
import { loadGatewayModelCatalog } from "./server-model-catalog.js";
import { createNodeSubscriptionManager } from "./server-node-subscriptions.js";
import { loadGatewayPlugins } from "./server-plugins.js";
import { createGatewayReloadHandlers } from "./server-reload-handlers.js";
import { resolveGatewayRuntimeConfig } from "./server-runtime-config.js";
import { createGatewayRuntimeState } from "./server-runtime-state.js";
import { resolveSessionKeyForRun } from "./server-session-key.js";
import { logGatewayStartup } from "./server-startup-log.js";
import { startGatewaySidecars } from "./server-startup.js";
import { startGatewayTailscaleExposure } from "./server-tailscale.js";
import { createWizardSessionTracker } from "./server-wizard-sessions.js";
import { attachGatewayWsHandlers } from "./server-ws-runtime.js";
import {
  getHealthCache,
  getHealthVersion,
  getPresenceVersion,
  incrementPresenceVersion,
  refreshGatewayHealthSnapshot,
} from "./server/health-state.js";
import { loadGatewayTlsRuntime } from "./server/tls.js";

export { __resetModelCatalogCacheForTest } from "./server-model-catalog.js";

ensureKoLoCliOnPath();

const log = createSubsystemLogger("gateway");
const logCanvas = log.child("canvas");
const logDiscovery = log.child("discovery");
const logTailscale = log.child("tailscale");
const logChannels = log.child("channels");
const logBrowser = log.child("browser");
const logHealth = log.child("health");
const logCron = log.child("cron");
const logReload = log.child("reload");
const logHooks = log.child("hooks");
const logPlugins = log.child("plugins");
const logWsControl = log.child("ws");
const canvasRuntime = runtimeForLogger(logCanvas);

export type GatewayServer = {
  close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
};

export type GatewayServerOptions = {
  /**
   * Bind address policy for the Gateway WebSocket/HTTP server.
   * - loopback: 127.0.0.1
   * - lan: 0.0.0.0
   * - tailnet: bind only to the Tailscale IPv4 address (100.64.0.0/10)
   * - auto: prefer loopback, else LAN
   */
  bind?: import("../config/config.js").GatewayBindMode;
  /**
   * Advanced override for the bind host, bypassing bind resolution.
   * Prefer `bind` unless you really need a specific address.
   */
  host?: string;
  /**
   * If false, do not serve the browser Control UI.
   * Default: config `gateway.controlUi.enabled` (or true when absent).
   */
  controlUiEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/chat/completions`.
   * Default: config `gateway.http.endpoints.chatCompletions.enabled` (or false when absent).
   */
  openAiChatCompletionsEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/responses` (OpenResponses API).
   * Default: config `gateway.http.endpoints.responses.enabled` (or false when absent).
   */
  openResponsesEnabled?: boolean;
  /**
   * Override gateway auth configuration (merges with config).
   */
  auth?: import("../config/config.js").GatewayAuthConfig;
  /**
   * Override gateway Tailscale exposure configuration (merges with config).
   */
  tailscale?: import("../config/config.js").GatewayTailscaleConfig;
  /**
   * Test-only: allow canvas host startup even when NODE_ENV/VITEST would disable it.
   */
  allowCanvasHostInTests?: boolean;
  /**
   * Test-only: override the onboarding wizard runner.
   */
  wizardRunner?: (
    opts: import("../commands/onboard-types.js").OnboardOptions,
    runtime: import("../runtime.js").RuntimeEnv,
    prompter: import("../wizard/prompts.js").WizardPrompter,
  ) => Promise<void>;
};

export async function startGatewayServer(
  port = 18789,
  opts: GatewayServerOptions = {},
): Promise<GatewayServer> {
  // Ensure all default port derivations (browser/canvas) see the actual runtime port.
  process.env.KOLO_GATEWAY_PORT = String(port);
  logAcceptedEnvOption({
    key: "KOLO_RAW_STREAM",
    description: "raw stream logging enabled",
  });
  logAcceptedEnvOption({
    key: "KOLO_RAW_STREAM_PATH",
    description: "raw stream log path override",
  });

  let configSnapshot = await readConfigFileSnapshot();
  if (configSnapshot.legacyIssues.length > 0) {
    if (isNixMode) {
      throw new Error(
        "Legacy config entries detected while running in Nix mode. Update your Nix config to the latest schema and restart.",
      );
    }
    const { config: migrated, changes } = migrateLegacyConfig(configSnapshot.parsed);
    if (!migrated) {
      throw new Error(
        `Legacy config entries detected but auto-migration failed. Run "${formatCliCommand("Kurahi doctor")}" to migrate.`,
      );
    }
    await writeConfigFile(migrated);
    if (changes.length > 0) {
      log.info(
        `gateway: migrated legacy config entries:\n${changes
          .map((entry) => `- ${entry}`)
          .join("\n")}`,
      );
    }
  }

  configSnapshot = await readConfigFileSnapshot();
  if (configSnapshot.exists && !configSnapshot.valid) {
    const issues =
      configSnapshot.issues.length > 0
        ? configSnapshot.issues
            .map((issue) => `${issue.path || "<root>"}: ${issue.message}`)
            .join("\n")
        : "Unknown validation issue.";
    throw new Error(
      `Invalid config at ${configSnapshot.path}.\n${issues}\nRun "${formatCliCommand("Kurahi doctor")}" to repair, then retry.`,
    );
  }

  // ── Boot integrity gate (M2b) ─────────────────────────────────────────────
  // Before plugins and channels: verify every registered constitution file. Throws
  // IntegrityGateError (CLI exits 3) on mismatch/missing unless KOLO_INTEGRITY=warn (dev only).
  {
    const { setAuditErrorReporter } = await import("../audit/audit-log.js");
    setAuditErrorReporter((msg) => log.warn(msg));
    const { runBootIntegrityGate } = await import("../integrity/gate.js");
    await runBootIntegrityGate({ log });
    // M13: then the policy gate. An unattested policy.yaml refuses the boot in enforce mode
    // (exit 3, like the integrity gate); audit mode loads it with a warning; off is inert.
    const { initPolicyEngine } = await import("../policy/engine.js");
    const { resolvePolicyMode } = await import("../policy/paths.js");
    const policyEngine = initPolicyEngine({
      mode: resolvePolicyMode(process.env, configSnapshot.config.policy?.mode),
      strict: true,
    });
    const policyStatus = policyEngine.status();
    if (policyStatus.loaded) {
      log.info(
        `policy gate: ${policyStatus.name ?? "policy"} loaded (${policyStatus.attestation}, mode ${policyStatus.mode})`,
      );
    } else {
      log.info(
        `policy gate: no policy (mode ${policyStatus.mode}); run \`kurahi policy init\` to add one`,
      );
    }
    for (const warning of policyStatus.warnings) {
      log.warn(`policy gate: ${warning}`);
    }
  }

  const autoEnable = applyPluginAutoEnable({ config: configSnapshot.config, env: process.env });
  if (autoEnable.changes.length > 0) {
    try {
      await writeConfigFile(autoEnable.config);
      log.info(
        `gateway: auto-enabled plugins:\n${autoEnable.changes
          .map((entry) => `- ${entry}`)
          .join("\n")}`,
      );
    } catch (err) {
      log.warn(`gateway: failed to persist plugin auto-enable changes: ${String(err)}`);
    }
  }

  const cfgAtStart = loadConfig();
  const diagnosticsEnabled = isDiagnosticsEnabled(cfgAtStart);
  if (diagnosticsEnabled) {
    startDiagnosticHeartbeat();
  }
  setGatewaySigusr1RestartPolicy({ allowExternal: cfgAtStart.commands?.restart === true });
  initSubagentRegistry();

  // Gateway lease — one gateway per state root (<KOLO_HOME>/run/gateway.lock).
  // On by default; `gateway.v3.lease: false` disables it.
  let v3Lease: import("../gateway-v3/supervisor/lease.js").LeaseManager | null = null;
  if ((cfgAtStart as any)?.gateway?.v3?.lease !== false) {
    const { LeaseManager } = await import("../gateway-v3/supervisor/lease.js");
    const { resolveStateDir } = await import("../config/paths.js");
    const { koloRunDir } = await import("../config/kolo-home.js");
    v3Lease = new LeaseManager({
      runtimeDir: koloRunDir(resolveStateDir(process.env)),
      generation: 1,
      version: "v3",
      port,
      onLost: (holder) => {
        log.error(
          `Gateway lease lost (lock now held by PID=${holder?.pid ?? "?"} ` +
            `host=${holder?.hostname ?? "?"}); readiness drops to process_up`,
        );
      },
    });
    const result = v3Lease.acquire();
    if (!result.ok) {
      const holder = result.existing.holder;
      if (holder.pid !== process.pid) {
        // Fail closed: another live gateway owns this state root.
        const { GatewayLockError } = await import("../infra/gateway-lock.js");
        throw new GatewayLockError(
          `gateway lease held by PID=${holder.pid} host=${holder.hostname} ` +
            `port=${holder.port ?? "?"} (${v3Lease.lockPath}); refusing to start a second ` +
            `gateway on the same state root`,
        );
      }
      // Same process (embedded/test harness running two servers): serve, but
      // /health reports the lease as not held.
      log.warn(`Gateway lease already held in this process — serving without the lease`);
    } else {
      v3Lease.startHeartbeat();
      if (result.staleCleaned) {
        log.warn("Gateway lease: reclaimed stale lock from a previous instance");
      }
      log.info(`Gateway lease acquired: ${v3Lease.lockPath} leaseId=${v3Lease.leaseId}`);
    }
  }

  // ── Gateway v3 consciousness dispatchers ──────────────────────────────────
  // Feature-flagged under gateway.v3.enabled. Creates one LlmDispatcher per
  // registered agent so that circuit failures are isolated per-agent (per-agent isolation).
  // Dispatchers are created BEFORE biology so the biology boot can receive the
  // onBiologyUpdate callback that pushes fresh hormone signals to all dispatchers.
  let v3AgentIds: string[] = [];
  if ((cfgAtStart as any)?.gateway?.v3?.enabled) {
    try {
      const { createConsciousnessDispatcher, setV3AgentDispatcher } =
        await import("../gateway-v3/routing/consciousness-adapter.js");
      const { resolveDefaultAgentId: resolveDefault } = await import("../agents/agent-scope.js");

      // Collect all agent IDs — registered agents plus the default agent
      const registeredAgents = (cfgAtStart.agents?.list ?? []).map((a: { id: string }) => a.id);
      const defaultId = resolveDefault(cfgAtStart);
      v3AgentIds = [...new Set([defaultId, ...registeredAgents])];

      // Read memory budget config (enforced, not passive)
      const memBudgetCfg = (cfgAtStart as any)?.gateway?.v3?.memoryBudget ?? {};
      const memBudgetActive = Object.keys(memBudgetCfg).length > 0;

      // Init stream adapter singleton with config (not hardcoded defaults)
      const { initV3StreamAdapter } = await import("../gateway-v3/routing/stream-adapter.js");
      initV3StreamAdapter({ memoryBudget: memBudgetActive ? memBudgetCfg : undefined });

      for (const agentId of v3AgentIds) {
        const dispatcher = createConsciousnessDispatcher({
          agentId,
          tripThreshold: 10, // a transient network blip at 3 silenced all agents
          memoryBudget: memBudgetActive ? memBudgetCfg : undefined,
        });
        setV3AgentDispatcher(agentId, dispatcher);
      }

      log.info(`Gateway v3 consciousness dispatchers ready — ${v3AgentIds.length} agents`);
    } catch (err) {
      log.warn(`Gateway v3 consciousness dispatcher boot failed (non-fatal): ${String(err)}`);
    }
  }

  // ── Gateway v3 biology ─────────────────────────────────────────────────────
  // Feature-flagged: only active when gateway.v3.biology is not explicitly false.
  // Booted AFTER dispatchers so the onBiologyUpdate callback can push fresh
  // hormone signals to all per-agent dispatchers on every 2-min tick.
  let v3BiologyHandle: import("../gateway-v3/biology/boot.js").BiologyBootSupervisor | null = null;
  if ((cfgAtStart as any)?.gateway?.v3?.biology !== false) {
    try {
      const {
        BiologyBootSupervisor,
        runEndocrine,
        runPain,
        runImmune,
        runCardiovascular,
        runSensory,
        runProprioception,
      } = await import("../gateway-v3/biology/index.js");
      const { getAllV3AgentDispatchers } =
        await import("../gateway-v3/routing/consciousness-adapter.js");
      const { resolveStateDir } = await import("../config/paths.js");
      const koloDir = resolveStateDir(process.env);

      // Push model: biology owns state, dispatchers never pull.
      // Called after hormones.json is written so getSignals() returns fresh values.
      const onBiologyUpdate = (
        signals: import("../gateway-v3/routing/types.js").BiologySignals,
      ) => {
        for (const dispatcher of getAllV3AgentDispatchers()) {
          dispatcher.updateBiology(signals);
        }
      };

      const supervisor = new BiologyBootSupervisor({}, undefined, onBiologyUpdate);
      // Core organs (original)
      supervisor.register({ organId: "pain", tick: runPain, timeoutMs: 3_000, intervalMs: 0 });
      supervisor.register({
        organId: "endocrine",
        tick: runEndocrine,
        timeoutMs: 2_000,
        intervalMs: 0,
      });
      // The four sensory organs
      supervisor.register({ organId: "immune", tick: runImmune, timeoutMs: 3_000, intervalMs: 0 });
      supervisor.register({
        organId: "cardiovascular",
        tick: runCardiovascular,
        timeoutMs: 3_000,
        intervalMs: 0,
      });
      supervisor.register({
        organId: "sensory",
        tick: runSensory,
        timeoutMs: 3_000,
        intervalMs: 0,
      });
      supervisor.register({
        organId: "proprioception",
        tick: runProprioception,
        timeoutMs: 3_000,
        intervalMs: 0,
      });
      await supervisor.boot({ koloDir, agents: v3AgentIds });
      v3BiologyHandle = supervisor;

      // Seed all dispatchers with initial biology signals from the first tick
      const initialSignals = supervisor.getSignals();
      for (const dispatcher of getAllV3AgentDispatchers()) {
        dispatcher.updateBiology(initialSignals);
      }

      log.info("Gateway v3 biology booted");
    } catch (err) {
      log.warn(`Gateway v3 biology boot failed (non-fatal): ${String(err)}`);
    }
  }

  if (v3BiologyHandle) {
    const { setBiologySingleton } = await import("../gateway-v3/routing/candidate-scorer.js");
    setBiologySingleton(v3BiologyHandle);
  }

  // Wire v3 health singletons (the health endpoint is a production requirement)
  if (v3Lease || v3BiologyHandle) {
    const { setV3LeaseSingleton, setV3BiologyHealthSingleton } =
      await import("../gateway-v3/health.js");
    if (v3Lease) setV3LeaseSingleton(v3Lease);
    if (v3BiologyHandle) setV3BiologyHealthSingleton(v3BiologyHandle);
  }

  const defaultAgentId = resolveDefaultAgentId(cfgAtStart);
  const defaultWorkspaceDir = resolveAgentWorkspaceDir(cfgAtStart, defaultAgentId);
  const baseMethods = listGatewayMethods();
  const { pluginRegistry, gatewayMethods: baseGatewayMethods } = loadGatewayPlugins({
    cfg: cfgAtStart,
    workspaceDir: defaultWorkspaceDir,
    log,
    coreGatewayHandlers,
    baseMethods,
  });
  const channelLogs = Object.fromEntries(
    listChannelPlugins().map((plugin) => [plugin.id, logChannels.child(plugin.id)]),
  ) as Record<ChannelId, ReturnType<typeof createSubsystemLogger>>;
  const channelRuntimeEnvs = Object.fromEntries(
    Object.entries(channelLogs).map(([id, logger]) => [id, runtimeForLogger(logger)]),
  ) as Record<ChannelId, RuntimeEnv>;
  const channelMethods = listChannelPlugins().flatMap((plugin) => plugin.gatewayMethods ?? []);
  const gatewayMethods = Array.from(new Set([...baseGatewayMethods, ...channelMethods]));
  let pluginServices: PluginServicesHandle | null = null;
  // M7: the host owns the plugin instances; reload/disable/config changes go through it.
  const pluginHost = getPluginHost(pluginRegistry);
  setGatewayPluginHost(pluginHost);
  const runtimeConfig = await resolveGatewayRuntimeConfig({
    cfg: cfgAtStart,
    port,
    bind: opts.bind,
    host: opts.host,
    controlUiEnabled: opts.controlUiEnabled,
    openAiChatCompletionsEnabled: opts.openAiChatCompletionsEnabled,
    openResponsesEnabled: opts.openResponsesEnabled,
    auth: opts.auth,
    tailscale: opts.tailscale,
  });
  const {
    bindHost,
    controlUiEnabled,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    controlUiBasePath,
    resolvedAuth,
    tailscaleConfig,
    tailscaleMode,
  } = runtimeConfig;
  let hooksConfig = runtimeConfig.hooksConfig;
  const canvasHostEnabled = runtimeConfig.canvasHostEnabled;

  const wizardRunner = opts.wizardRunner ?? runOnboardingWizard;
  const { wizardSessions, findRunningWizard, purgeWizardSession } = createWizardSessionTracker();

  const deps = createDefaultDeps();
  let canvasHostServer: CanvasHostServer | null = null;
  const gatewayTls = await loadGatewayTlsRuntime(cfgAtStart.gateway?.tls, log.child("tls"));
  if (cfgAtStart.gateway?.tls?.enabled && !gatewayTls.enabled) {
    throw new Error(gatewayTls.error ?? "gateway tls: failed to enable");
  }
  const {
    canvasHost,
    httpServer,
    httpServers,
    httpBindHosts,
    wss,
    clients,
    broadcast,
    agentRunSeq,
    dedupe,
    chatRunState,
    chatRunBuffers,
    chatDeltaSentAt,
    addChatRun,
    removeChatRun,
    chatAbortControllers,
  } = await createGatewayRuntimeState({
    cfg: cfgAtStart,
    bindHost,
    port,
    controlUiEnabled,
    controlUiBasePath,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    resolvedAuth,
    gatewayTls,
    hooksConfig: () => hooksConfig,
    pluginRegistry,
    deps,
    canvasRuntime,
    canvasHostEnabled,
    allowCanvasHostInTests: opts.allowCanvasHostInTests,
    logCanvas,
    log,
    logHooks,
    logPlugins,
  });
  let bonjourStop: (() => Promise<void>) | null = null;
  const nodeRegistry = new NodeRegistry();
  const nodePresenceTimers = new Map<string, ReturnType<typeof setInterval>>();
  const nodeSubscriptions = createNodeSubscriptionManager();
  const nodeSendEvent = (opts: { nodeId: string; event: string; payloadJSON?: string | null }) => {
    const payload = safeParseJson(opts.payloadJSON ?? null);
    nodeRegistry.sendEvent(opts.nodeId, opts.event, payload);
  };
  const nodeSendToSession = (sessionKey: string, event: string, payload: unknown) =>
    nodeSubscriptions.sendToSession(sessionKey, event, payload, nodeSendEvent);
  const nodeSendToAllSubscribed = (event: string, payload: unknown) =>
    nodeSubscriptions.sendToAllSubscribed(event, payload, nodeSendEvent);
  const nodeSubscribe = nodeSubscriptions.subscribe;
  const nodeUnsubscribe = nodeSubscriptions.unsubscribe;
  const nodeUnsubscribeAll = nodeSubscriptions.unsubscribeAll;
  const broadcastVoiceWakeChanged = (triggers: string[]) => {
    broadcast("voicewake.changed", { triggers }, { dropIfSlow: true });
  };
  const hasMobileNodeConnected = () => hasConnectedMobileNode(nodeRegistry);
  applyGatewayLaneConcurrency(cfgAtStart);

  let cronState = buildGatewayCronService({
    cfg: cfgAtStart,
    deps,
    broadcast,
  });
  let { cron, storePath: cronStorePath } = cronState;

  const channelManager = createChannelManager({
    loadConfig,
    channelLogs,
    channelRuntimeEnvs,
  });
  const { getRuntimeSnapshot, startChannels, startChannel, stopChannel, markChannelLoggedOut } =
    channelManager;

  const machineDisplayName = await getMachineDisplayName();
  const discovery = await startGatewayDiscovery({
    machineDisplayName,
    port,
    gatewayTls: gatewayTls.enabled
      ? { enabled: true, fingerprintSha256: gatewayTls.fingerprintSha256 }
      : undefined,
    wideAreaDiscoveryEnabled: cfgAtStart.discovery?.wideArea?.enabled === true,
    wideAreaDiscoveryDomain: cfgAtStart.discovery?.wideArea?.domain,
    tailscaleMode,
    mdnsMode: cfgAtStart.discovery?.mdns?.mode,
    logDiscovery,
  });
  bonjourStop = discovery.bonjourStop;

  setSkillsRemoteRegistry(nodeRegistry);
  void primeRemoteSkillsCache();
  // Debounce skills-triggered node probes to avoid feedback loops and rapid-fire invokes.
  // Skills changes can happen in bursts (e.g., file watcher events), and each probe
  // takes time to complete. A 30-second delay ensures we batch changes together.
  let skillsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const skillsRefreshDelayMs = 30_000;
  const skillsChangeUnsub = registerSkillsChangeListener((event) => {
    if (event.reason === "remote-node") {
      return;
    }
    if (skillsRefreshTimer) {
      clearTimeout(skillsRefreshTimer);
    }
    skillsRefreshTimer = setTimeout(() => {
      skillsRefreshTimer = null;
      const latest = loadConfig();
      void refreshRemoteBinsForConnectedNodes(latest);
    }, skillsRefreshDelayMs);
  });

  const { tickInterval, healthInterval, dedupeCleanup } = startGatewayMaintenanceTimers({
    broadcast,
    nodeSendToAllSubscribed,
    getPresenceVersion,
    getHealthVersion,
    refreshGatewayHealthSnapshot,
    logHealth,
    dedupe,
    chatAbortControllers,
    chatRunState,
    chatRunBuffers,
    chatDeltaSentAt,
    removeChatRun,
    agentRunSeq,
    nodeSendToSession,
  });

  const agentUnsub = onAgentEvent(
    createAgentEventHandler({
      broadcast,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun,
      clearAgentRunContext,
    }),
  );

  const heartbeatUnsubOnly = onHeartbeatEvent((evt) => {
    broadcast("heartbeat", evt, { dropIfSlow: true });
  });
  // M14: the person's side of a channel conversation, for attached terminals and the TUI.
  const channelInboundUnsub = onChannelInbound((evt) => {
    broadcast("channel.inbound", evt, { dropIfSlow: true });
  });
  const heartbeatUnsub = () => {
    heartbeatUnsubOnly();
    channelInboundUnsub();
  };

  let heartbeatRunner = startHeartbeatRunner({ cfg: cfgAtStart });

  // Boot consciousness engines for sentient-tier agents (N7).
  // Runs alongside the heartbeat — consciousness is the proactive cognitive cycle,
  // heartbeat is the reactive health-check cycle. They coexist.
  const consciousnessHandle = await bootConsciousness({
    cfg: cfgAtStart,
    log: {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
    },
  });

  void cron.start().catch((err) => logCron.error(`failed to start: ${String(err)}`));

  // M6: MCP servers connect in the background; each attempt is bounded by its own timeout and
  // supervised with backoff, so a slow or dead server never delays the gateway coming up.
  void startMcpFromConfig(cfgAtStart, {
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
  }).catch((err) => log.warn(`mcp: ${String(err)}`));

  const execApprovalManager = new ExecApprovalManager();
  // M14: asks go to channels localized with approve/deny actions; keyword answers from a
  // channel resolve here with the same audit and broadcast as a terminal answer.
  const execApprovalForwarder = createExecApprovalForwarder(
    createResidentApprovalForwarderDeps({
      getConfig: loadConfig,
      deliver: queuedOutboundDeliver(deliverOutboundPayloads, "approval"),
    }),
  );
  const execApprovalHandlers = createExecApprovalHandlers(execApprovalManager, {
    forwarder: execApprovalForwarder,
  });
  setChannelApprovalResolver((id, decision, resolvedBy) => {
    const ok = execApprovalManager.resolve(id, decision, resolvedBy);
    if (!ok) {
      return false;
    }
    void auditSafe({
      identity: resolvedBy,
      action: "exec.approval.resolve",
      outcome: "ok",
      source: "exec-approvals",
      detail: { id, decision, via: "channel" },
    });
    broadcast(
      "exec.approval.resolved",
      { id, decision, resolvedBy, ts: Date.now() },
      { dropIfSlow: true },
    );
    void execApprovalForwarder
      .handleResolved({ id, decision, resolvedBy, ts: Date.now() })
      .catch((err) => log.error(`exec approvals: forward resolve failed: ${String(err)}`));
    return true;
  });

  const canvasHostServerPort = (canvasHostServer as CanvasHostServer | null)?.port;

  attachGatewayWsHandlers({
    wss,
    clients,
    port,
    gatewayHost: bindHost ?? undefined,
    canvasHostEnabled: Boolean(canvasHost),
    canvasHostServerPort,
    resolvedAuth,
    gatewayMethods,
    events: GATEWAY_EVENTS,
    logGateway: log,
    logHealth,
    logWsControl,
    // M7: plugin gateway methods are looked up through the prototype so a reloaded plugin's
    // handlers (added/removed in place on the registry object) are live without a restart.
    extraHandlers: Object.assign(
      Object.create(pluginRegistry.gatewayHandlers) as typeof pluginRegistry.gatewayHandlers,
      execApprovalHandlers,
    ),
    broadcast,
    context: {
      deps,
      cron,
      cronStorePath,
      loadGatewayModelCatalog,
      getHealthCache,
      refreshHealthSnapshot: refreshGatewayHealthSnapshot,
      logHealth,
      logGateway: log,
      incrementPresenceVersion,
      getHealthVersion,
      broadcast,
      nodeSendToSession,
      nodeSendToAllSubscribed,
      nodeSubscribe,
      nodeUnsubscribe,
      nodeUnsubscribeAll,
      hasConnectedMobileNode: hasMobileNodeConnected,
      nodeRegistry,
      agentRunSeq,
      chatAbortControllers,
      chatAbortedRuns: chatRunState.abortedRuns,
      chatRunBuffers: chatRunState.buffers,
      chatDeltaSentAt: chatRunState.deltaSentAt,
      addChatRun,
      removeChatRun,
      dedupe,
      wizardSessions,
      findRunningWizard,
      purgeWizardSession,
      getRuntimeSnapshot,
      startChannel,
      stopChannel,
      markChannelLoggedOut,
      wizardRunner,
      broadcastVoiceWakeChanged,
    },
  });
  logGatewayStartup({
    cfg: cfgAtStart,
    bindHost,
    bindHosts: httpBindHosts,
    port,
    tlsEnabled: gatewayTls.enabled,
    log,
    isNixMode,
  });
  scheduleGatewayUpdateCheck({ cfg: cfgAtStart, log, isNixMode });
  const tailscaleCleanup = await startGatewayTailscaleExposure({
    tailscaleMode,
    resetOnExit: tailscaleConfig.resetOnExit,
    port,
    controlUiBasePath,
    logTailscale,
  });

  let browserControl: Awaited<ReturnType<typeof startBrowserControlServerIfEnabled>> = null;
  ({ browserControl, pluginServices } = await startGatewaySidecars({
    cfg: cfgAtStart,
    pluginRegistry,
    defaultWorkspaceDir,
    deps,
    startChannels,
    log,
    logHooks,
    logChannels,
    logBrowser,
  }));
  if (pluginHost && pluginServices) {
    pluginHost.attachServices(pluginServices);
  }
  const hotReloadSettings = pluginHost?.settings();
  if (pluginHost && hotReloadSettings?.enabled && hotReloadSettings.watch) {
    pluginHost.watch({ debounceMs: hotReloadSettings.debounceMs });
  }

  const { applyHotReload, requestGatewayRestart } = createGatewayReloadHandlers({
    deps,
    broadcast,
    pluginHost,
    getState: () => ({
      hooksConfig,
      heartbeatRunner,
      cronState,
      browserControl,
    }),
    setState: (nextState) => {
      hooksConfig = nextState.hooksConfig;
      heartbeatRunner = nextState.heartbeatRunner;
      cronState = nextState.cronState;
      cron = cronState.cron;
      cronStorePath = cronState.storePath;
      browserControl = nextState.browserControl;
    },
    startChannel,
    stopChannel,
    logHooks,
    logBrowser,
    logChannels,
    logCron,
    logReload,
  });

  // M13: hot reload of policy.yaml, its signature, owners.json and the runtime kill file.
  const { startPolicyWatcher } = await import("../policy/watch.js");
  const { getPolicyEngine } = await import("../policy/engine.js");
  const policyWatcher = startPolicyWatcher({
    engine: getPolicyEngine(),
    log: { info: (msg) => logReload.info(msg), warn: (msg) => logReload.warn(msg) },
  });
  const configReloaderInner = startGatewayConfigReloader({
    initialConfig: cfgAtStart,
    readSnapshot: readConfigFileSnapshot,
    onHotReload: applyHotReload,
    onRestart: requestGatewayRestart,
    log: {
      info: (msg) => logReload.info(msg),
      warn: (msg) => logReload.warn(msg),
      error: (msg) => logReload.error(msg),
    },
    watchPath: CONFIG_PATH,
  });
  const configReloader = {
    stop: async () => {
      await policyWatcher.stop();
      await configReloaderInner.stop();
    },
  };

  const close = createGatewayCloseHandler({
    bonjourStop,
    tailscaleCleanup,
    canvasHost,
    canvasHostServer,
    stopChannel,
    pluginServices,
    pluginHost,
    cron,
    heartbeatRunner,
    nodePresenceTimers,
    broadcast,
    tickInterval,
    healthInterval,
    dedupeCleanup,
    agentUnsub,
    heartbeatUnsub,
    chatRunState,
    clients,
    configReloader,
    browserControl,
    wss,
    httpServer,
    httpServers,
  });

  return {
    close: async (opts) => {
      consciousnessHandle.stop();
      if (diagnosticsEnabled) {
        stopDiagnosticHeartbeat();
      }
      if (skillsRefreshTimer) {
        clearTimeout(skillsRefreshTimer);
        skillsRefreshTimer = null;
      }
      skillsChangeUnsub();
      await close(opts);
      v3Lease?.stop();
      // Biology shutdown with timeout — in-flight tick writes could hang under SIGKILL
      // (wrap in try/catch + 5s timeout, then force clear)
      try {
        await Promise.race([
          v3BiologyHandle?.shutdown() ?? Promise.resolve(),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
      } catch {
        // Non-fatal — clear dispatchers regardless
      }
      // Clear all per-agent dispatchers — in-flight ticks fall back to v2 path on retry
      const { clearAllV3AgentDispatchers } =
        await import("../gateway-v3/routing/consciousness-adapter.js");
      clearAllV3AgentDispatchers();
    },
  };
}
