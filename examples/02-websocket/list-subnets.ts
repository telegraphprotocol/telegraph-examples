/**
 * WebSocket: list the loaded miner catalog over the socket (`list_subnets`).
 * Anonymous action — same data as GET /engine/v1/subnets.
 */
import { config } from "../../src/lib/config.js";
import { TelegraphWS } from "../../src/lib/ws.js";
import { log } from "../../src/lib/log.js";

async function main() {
  log.banner("WebSocket list_subnets");
  const ws = new TelegraphWS(config.wsUrl);
  await ws.connect();
  ws.send({ action: "list_subnets" });
  const msg = await ws.waitFor(["subnets", "subnet_list", "result", "error"], 30_000);
  if (msg.type === "error") throw new Error(JSON.stringify(msg.data));
  const d: any = msg.data ?? {};
  const list: any[] = d.subnets ?? d.miners ?? [];
  log.ok(`${list.length} miners`);
  for (const s of list) console.log(`  [${String(s.id).padStart(3)}] ${s.name ?? s.slug}`);
  ws.close();
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
