/**
 * Discovery: machine-readable OpenAPI spec of every miner endpoint.
 *
 * GET /miner-dispatcher/openapi.json — agents can codegen clients or feed
 * this straight to an LLM to learn how to call each miner.
 */
import { config } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";

async function main() {
  log.banner("OpenAPI spec — /miner-dispatcher/openapi.json");
  const res = await fetch(`${config.dispatcherUrl}/openapi.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const spec: any = await res.json();
  log.kv("openapi", spec.openapi);
  log.kv("title", spec.info?.title);
  log.kv("version", spec.info?.version);
  const paths = Object.keys(spec.paths ?? {});
  log.ok(`${paths.length} paths\n`);
  for (const p of paths) {
    const methods = Object.keys(spec.paths[p]).map((m) => m.toUpperCase()).join(",");
    console.log(`  ${methods.padEnd(8)} ${p}`);
    const summary = Object.values<any>(spec.paths[p])[0]?.summary;
    if (summary) console.log(`           ${String(summary).slice(0, 100)}`);
  }
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
