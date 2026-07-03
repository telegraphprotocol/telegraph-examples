/**
 * On-chain verification: full audit of an ERC-8183 job.
 *
 * Reads the job record, finds its JobCreated/JobTerminal events, then decodes
 * every token transfer in the settlement transaction to prove:
 *   - the 2% protocol fee reached the Treasury (USDC)
 *   - the 98% miner payment was swapped USDC→MACHINA (or paid USDC fallback)
 *   - what your callback contract stored.
 *
 * Usage: npm run verify:job -- <jobId>
 */
import { ethers } from "ethers";
import { log } from "../../src/lib/log.js";
import { provider, diamond, queryFilterChunked } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN, JOB_STATES, fmtUSDC, fmtMachina } from "../../src/lib/protocol.js";

const arg = process.argv.slice(2).filter((a) => a !== "--")[0];

async function main() {
  if (arg === undefined) { log.fail("usage: npm run verify:job -- <jobId>"); process.exit(1); }
  const jobId = BigInt(arg);
  const p = provider();
  const d = diamond(p);

  log.banner(`Audit: job ${jobId}`);
  const j = await d.getJob(jobId);
  log.kv("state", JOB_STATES[Number(j.state)]);
  log.kv("agent", j.agent);
  log.kv("intentId", j.intentId);
  log.kv("callback", j.callback);
  log.kv("budget", fmtUSDC(j.budget));
  log.kv("split", `${fmtUSDC(j.minerPayment)} miner (98%) + ${fmtUSDC(j.protocolFee)} treasury (2%)`);
  log.kv("outputHash", await d.getJobOutput(jobId));

  // Anchor the search around the job's creation time instead of scanning all history.
  const createdAt = Number(j.createdAt);
  const tip = await p.getBlockNumber();
  const tipTs = (await p.getBlock(tip))!.timestamp;
  const fromBlock = Math.max(0, tip - Math.ceil((tipTs - createdAt) / 2) - 5000); // Base ≈ 2s blocks

  const [createdEvents, terminalEvents] = await Promise.all([
    queryFilterChunked(d, d.filters.JobCreated(jobId), fromBlock, tip),
    queryFilterChunked(d, d.filters.JobTerminal(jobId), fromBlock, tip),
  ]);
  if (createdEvents[0]) log.kv("created tx", `${BASESCAN}/tx/${createdEvents[0].transactionHash}`);

  if (!terminalEvents[0]) {
    log.warn(Number(j.state) === 0
      ? "job is still Funded — the node hasn't settled it yet (or no miner is mapped to this intentId)"
      : "no JobTerminal event found in scan range");
    return;
  }

  const terminalTx = terminalEvents[0].transactionHash;
  log.kv("terminal tx", `${BASESCAN}/tx/${terminalTx}`);

  log.banner("Money flow in settlement tx");
  const rcpt = await p.getTransactionReceipt(terminalTx);
  const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
  let treasuryPaid = 0n, minerMachina = 0n, minerUsdcFallback = 0n;

  for (const l of rcpt!.logs) {
    let parsed: ethers.LogDescription | null = null;
    try { parsed = iface.parseLog(l); } catch { continue; }
    if (!parsed) continue;
    const isUsdc = l.address.toLowerCase() === ADDRESSES.usdcEscrow.toLowerCase();
    const isMachina = l.address.toLowerCase() === ADDRESSES.machina.toLowerCase();
    const label = isUsdc ? "USDC" : isMachina ? "MACHINA" : `token ${l.address.slice(0, 10)}…`;
    const amount = isMachina ? fmtMachina(parsed.args.value) : fmtUSDC(parsed.args.value);
    const toNote = isUsdc && parsed.args.to.toLowerCase() === ADDRESSES.treasury.toLowerCase()
      ? " ← TREASURY (protocol fee)"
      : isMachina ? " ← miner payout (post-swap)" : "";
    console.log(`  ${label.padEnd(9)} ${parsed.args.from} → ${parsed.args.to}  ${amount}${toNote}`);

    if (isUsdc && parsed.args.to.toLowerCase() === ADDRESSES.treasury.toLowerCase()) treasuryPaid += parsed.args.value;
    if (isMachina) minerMachina = parsed.args.value; // last MACHINA hop = miner payout
    if (isUsdc && parsed.args.from.toLowerCase() === ADDRESSES.diamond.toLowerCase()
      && parsed.args.to.toLowerCase() !== ADDRESSES.treasury.toLowerCase()) minerUsdcFallback = parsed.args.value;
  }

  log.banner("Verdict");
  if (treasuryPaid === j.protocolFee) log.ok(`treasury received exactly the 2% fee: ${fmtUSDC(treasuryPaid)}`);
  else if (treasuryPaid > 0n) log.warn(`treasury received ${fmtUSDC(treasuryPaid)} (expected ${fmtUSDC(j.protocolFee)})`);
  else log.fail("no treasury fee transfer found in settlement tx");

  if (minerMachina > 0n) log.ok(`miner paid via USDC→MACHINA swap: ${fmtMachina(minerMachina)}`);
  else if (minerUsdcFallback > 0n) log.warn(`miner paid in USDC fallback (no swap router configured): ${fmtUSDC(minerUsdcFallback)}`);
  else log.fail("no miner payout found in settlement tx");

  if (j.callback !== ethers.ZeroAddress) {
    const cb = new ethers.Contract(j.callback, [
      "function results(uint256) view returns (bool received, bool success, string firstString, string errorMessage, uint256 receivedAt)",
    ], p);
    try {
      const stored = await cb.results(jobId);
      if (stored.received) {
        log.ok(`callback stored the result (success=${stored.success})`);
        if (stored.firstString) log.kv("strings[0]", String(stored.firstString).slice(0, 200));
      } else log.warn("callback contract has no stored result for this job");
    } catch { log.warn("callback is not a TelegraphJobCallback — cannot read stored result"); }
  }
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
