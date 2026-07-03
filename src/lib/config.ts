import "dotenv/config";

function env(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

/** All examples read their configuration from here (.env overrides defaults). */
export const config = {
  // Telegraph node
  nodeUrl: env("NODE_URL", "http://13.237.89.59:7044"),
  get engineUrl() { return `${this.nodeUrl}/engine`; },
  get dispatcherUrl() { return `${this.nodeUrl}/miner-dispatcher`; },
  get daemonUrl() { return `${this.nodeUrl}/daemon`; },
  wsUrl: env("WS_URL", "ws://13.237.89.59:7044/engine/ws"),

  // Chain (Base Sepolia)
  rpcUrl: env("RPC_URL", "https://sepolia.base.org"),
  chainId: parseInt(env("CHAIN_ID", "84532"), 10),

  // The wallet the examples act as (the "agent"/user).
  agentPrivateKey: env("AGENT_PRIVATE_KEY", env("PRIVATE_KEY")),

  // Optional well-funded wallet used only by scripts/fund-agent.ts
  funderPrivateKey: env("FUNDER_PRIVATE_KEY"),

  // WebSocket subscription settings
  subscribeIntents: env("SUBSCRIBE_INTENTS", "CHAT_COMPLETION,WEATHER_FORECAST,WEB_SEARCH")
    .split(",").map((s) => s.trim()).filter(Boolean),
  maxSignals: parseInt(env("MAX_SIGNALS", "3"), 10),
  signalTimeoutSeconds: parseInt(env("SIGNAL_TIMEOUT_SECONDS", "300"), 10),
};

export function requireAgentKey(): string {
  if (!config.agentPrivateKey) {
    console.error("AGENT_PRIVATE_KEY is not set in .env — this example signs transactions/messages and needs a funded Base Sepolia key.");
    process.exit(1);
  }
  return config.agentPrivateKey;
}
