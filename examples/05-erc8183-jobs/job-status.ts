/**
 * ERC-8183: inspect any job by id (or list yours).
 *
 * Usage:
 *   npm run jobs:status              # list this wallet's jobs
 *   npm run jobs:status -- 42        # inspect job 42
 */
import { log } from "../../src/lib/log.js";
import { provider, agentWallet, diamond } from "../../src/lib/chain.js";
import { JOB_STATES, fmtUSDC } from "../../src/lib/protocol.js";

const arg = process.argv.slice(2).filter((a) => a !== "--")[0];

async function main() {
  const p = provider();
  const wallet = agentWallet(p);
  const d = diamond(p);

  if (arg === undefined) {
    log.banner(`Jobs created by ${wallet.address}`);
    const ids: bigint[] = await d.jobsByAgent(wallet.address);
    log.kv("total on Diamond", await d.jobCount());
    if (!ids.length) { log.warn("no jobs yet — run: npm run jobs:create"); return; }
    for (const id of ids) {
      const j = await d.getJob(id);
      console.log(`  #${String(id).padStart(4)}  ${JOB_STATES[Number(j.state)].padEnd(9)} budget ${fmtUSDC(j.budget)}  created ${new Date(Number(j.createdAt) * 1000).toISOString()}`);
    }
    return;
  }

  const id = BigInt(arg);
  log.banner(`Job ${id}`);
  const j = await d.getJob(id);
  log.kv("agent", j.agent);
  log.kv("intentId", j.intentId);
  log.kv("callback", j.callback);
  log.kv("state", JOB_STATES[Number(j.state)]);
  log.kv("budget", fmtUSDC(j.budget));
  log.kv("minerPayment", fmtUSDC(j.minerPayment));
  log.kv("protocolFee", fmtUSDC(j.protocolFee));
  log.kv("createdAt", new Date(Number(j.createdAt) * 1000).toISOString());
  log.kv("outputHash", await d.getJobOutput(id));
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
