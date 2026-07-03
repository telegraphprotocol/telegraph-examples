/**
 * Discovery: Daemon signal categories + per-category statistics.
 * GET /daemon/api/categories — free, no auth.
 */
import { config } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";

async function main() {
  log.banner("Daemon categories — /daemon/api/categories");
  const res = await fetch(`${config.daemonUrl}/api/categories`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  log.json(await res.json(), 4000);
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
