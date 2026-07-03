/**
 * Discovery: node health across all services (all free, no auth).
 */
import { config } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";

const checks: [string, string][] = [
  ["miner dispatcher", `${config.dispatcherUrl}/healthz`],
  ["daemon", `${config.daemonUrl}/health`],
  ["engine (subnet list)", `${config.engineUrl}/v1/subnets`],
];

async function main() {
  log.banner("Node health");
  log.kv("node", config.nodeUrl);
  let allOk = true;
  for (const [name, url] of checks) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const ms = Date.now() - t0;
      if (res.ok) log.ok(`${name.padEnd(24)} ${res.status} in ${ms}ms`);
      else { log.fail(`${name.padEnd(24)} HTTP ${res.status}`); allOk = false; }
    } catch (e: any) {
      log.fail(`${name.padEnd(24)} ${e?.message ?? e}`);
      allOk = false;
    }
  }
  process.exit(allOk ? 0 : 1);
}

main();
