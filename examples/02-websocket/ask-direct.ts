/**
 * WebSocket: direct miner call (`ask_direct`) — skip routing, you choose the
 * miner and endpoint yourself (find them via discovery:integrations).
 *
 * Usage:
 *   npm run ws:ask-direct                       # default: OpenAI /chat
 *   npm run ws:ask-direct -- 18                 # Zeus weather for Dubai
 */
import { config } from "../../src/lib/config.js";
import { TelegraphWS } from "../../src/lib/ws.js";
import { log } from "../../src/lib/log.js";

const minerId = process.argv.slice(2).filter((a) => a !== "--")[0] ?? "102";

// `method` is required by the WS handler (GET/POST/PUT/PATCH/DELETE).
const presets: Record<string, { endpoint: string; method: string; payload: Record<string, unknown> }> = {
  "102": {
    endpoint: "/chat",
    method: "POST",
    payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "In one sentence: what is the Telegraph Protocol?" }] },
  },
  "18": {
    endpoint: "/predict",
    method: "GET",
    payload: { lat: 25.2, lon: 55.3, variable: "2t", forecast_hours: 6 },
  },
  "32": {
    endpoint: "/detect",
    method: "POST",
    payload: { text: "The rapid advancement of artificial intelligence has transformed numerous industries, revolutionizing the way we approach complex problems." },
  },
};

async function main() {
  const preset = presets[minerId];
  if (!preset) {
    log.fail(`no preset for miner ${minerId} — presets: ${Object.keys(presets).join(", ")}`);
    process.exit(1);
  }

  log.banner(`WebSocket ask_direct → miner ${minerId}`);
  log.kv("endpoint", preset.endpoint);

  const ws = new TelegraphWS(config.wsUrl);
  await ws.connect();
  log.ok("connected (anonymous)");

  const t0 = Date.now();
  ws.send({ action: "ask_direct", subnet_id: minerId, endpoint: preset.endpoint, method: preset.method, payload: preset.payload });
  const result = await ws.waitFor(["result", "error"], 120_000);
  if (result.type === "error") throw new Error(JSON.stringify(result.data));

  const d: any = result.data ?? {};
  log.ok(`result from ${d.subnet_name ?? minerId} in ${Date.now() - t0}ms`);
  log.kv("cost_usd", d.cost_usd);
  log.json(d.result);
  ws.close();
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
