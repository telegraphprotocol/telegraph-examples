/**
 * WebSocket: auto-routed live inference (`ask`).
 *
 * Anonymous — no wallet, no payment at the WS layer. The Engine's LLM router
 * classifies the query, picks a miner, executes, and streams progress events:
 * received → routing → routed → executing → result.
 *
 * Usage: npm run ws:ask -- "Will it rain in London tomorrow?"
 */
import { config } from "../../src/lib/config.js";
import { TelegraphWS } from "../../src/lib/ws.js";
import { log } from "../../src/lib/log.js";

const query = process.argv.slice(2).filter((a) => a !== "--").join(" ")
  || "What is the weather in Dubai right now?";

async function main() {
  log.banner("WebSocket ask (auto-routed)");
  log.kv("query", query);

  const ws = new TelegraphWS(config.wsUrl);
  await ws.connect(); // anonymous
  log.ok("connected (anonymous — ask needs no wallet)");

  ws.onMessage((m) => {
    const d: any = m.data ?? {};
    if (m.type === "routing") log.kv("routing", d.message ?? "");
    if (m.type === "routed") {
      log.kv("routed to", `${d.subnet_name ?? d.subnet_id} — ${d.reasoning ?? ""}`);
      if (d.intent) log.kv("intent", d.intent);
    }
  });

  const t0 = Date.now();
  ws.send({ action: "ask", query });
  const result = await ws.waitFor(["result", "error"], 120_000);
  if (result.type === "error") throw new Error(JSON.stringify(result.data));

  const d: any = result.data ?? {};
  log.ok(`result from miner ${d.subnet_name ?? d.subnet_used} in ${Date.now() - t0}ms`);
  log.kv("cost_usd", d.cost_usd);
  log.kv("intent", d.intent ?? "—");
  log.kv("reasoning", d.reasoning ?? "—");
  log.json(d.result);
  ws.close();
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
