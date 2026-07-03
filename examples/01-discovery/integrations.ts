/**
 * Discovery: the live miner catalog.
 *
 * GET /miner-dispatcher/integrations is the authoritative, always-free source
 * of truth for which miners are live, what endpoints/schemas they expose and
 * which Intents they serve. Agents should hit this before paying for anything.
 *
 * Usage: npm run discovery:integrations [-- --full]
 */
import { config } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";

const full = process.argv.includes("--full");

async function main() {
  log.banner("Miner catalog — /miner-dispatcher/integrations");
  log.kv("node", config.dispatcherUrl);

  const res = await fetch(`${config.dispatcherUrl}/integrations`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const miners: any[] = await res.json();
  log.ok(`${miners.length} miners live\n`);

  for (const m of miners) {
    console.log(`  ┌─ [${m.id}] ${m.name}  (${m.slug})`);
    console.log(`  │  protocol: ${m.protocol}   kind: ${m.kind ?? "miner"}`);
    console.log(`  │  intents:  ${(m.supported_intents ?? []).join(", ") || "—"}`);
    for (const ep of m.endpoints ?? []) {
      console.log(`  │  endpoint: ${ep.method} /miner-dispatcher/v1/${m.id}${ep.path}`);
    }
    const req = m.input_schema?.required ?? [];
    if (req.length) console.log(`  │  required inputs: ${req.join(", ")}`);
    if (m.on_chain?.min_price_usdc != null) {
      console.log(`  │  floor price: $${m.on_chain.min_price_usdc}`);
    }
    console.log(`  └─ ${String(m.description ?? "").split("\n")[0].slice(0, 100)}\n`);
    if (full) log.json(m, 4000);
  }

  log.step("These endpoints are free. Inference paths (/v1/{id}/…) are x402-gated — see examples/04-x402-direct.");
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
