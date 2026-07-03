/**
 * Discovery: the Engine's routable miner list.
 *
 * GET /engine/v1/subnets shows what the Engine's LLM router can route an
 * auto-routed ask to. ("subnet" is legacy naming — read it as "miner".)
 */
import { config } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";

async function main() {
  log.banner("Engine miner list — /engine/v1/subnets");
  const res = await fetch(`${config.engineUrl}/v1/subnets`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const subnets: any[] = body.miners ?? body.subnets ?? body;
  log.ok(`${body.count ?? subnets.length} routable miners\n`);
  for (const s of subnets) {
    console.log(`  [${String(s.id).padStart(3)}] ${s.name ?? s.slug}`);
    if (s.description) console.log(`        ${String(s.description).split("\n")[0].slice(0, 110)}`);
    if (s.category) console.log(`        category: ${s.category}`);
  }
  console.log();
  log.step("Use an id with `npm run ws:ask-direct -- <id>` or `POST /engine/v1/ask/{id}`.");
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
