/**
 * ERC-8183: create an on-chain AI job and watch the full lifecycle.
 *
 *   createJob(intentId, params, callback)          [you, on-chain]
 *     → node listener sees JobCreated              [node]
 *     → routes to the miner serving that intent    [node]
 *     → miner answers                              [miner]
 *     → transitionToTerminal on-chain:             [node/validator]
 *         2%  USDC → Treasury
 *         98% USDC → swap → MACHINA → miner (TWAP; direct USDC if no router)
 *     → callback.subnetMessage(jobId, …)           [protocol → your contract]
 *
 * The intentId is keccak256 of a canonical Intent name (or a registered
 * miner's intentId from getMiner()). Everything is verified on-chain at the
 * end: job state, escrow delta, treasury fee, miner payout, callback storage.
 *
 * Usage:
 *   npm run jobs:create                                    # CHAT_COMPLETION default prompt
 *   npm run jobs:create -- CHAT_COMPLETION "What is 2+2?"
 *   npm run jobs:create -- WEATHER_FORECAST
 */
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { log } from "../../src/lib/log.js";
import { provider, agentWallet, diamond, erc20, pollUntil, snapshotBalances } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN, JOB_STATES, fmtUSDC, fmtMachina, intentIdFor, CANONICAL_INTENTS } from "../../src/lib/protocol.js";
import { loadCallbackAddress } from "./deploy-callback.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const intentName = (args[0] ?? "CHAT_COMPLETION").toUpperCase();
const prompt = args.slice(1).join(" ") || "In exactly one sentence, what is a decentralized AI inference marketplace?";

async function main() {
  log.banner("ERC-8183 on-chain job");
  if (!(CANONICAL_INTENTS as readonly string[]).includes(intentName)) {
    log.warn(`"${intentName}" is not a canonical intent — the node may not find a miner for it`);
  }

  const p = provider();
  const wallet = agentWallet(p);
  const d = diamond(wallet);
  const intentId = intentIdFor(intentName);

  const callback = loadCallbackAddress();
  if (!callback) {
    log.fail("no callback contract deployed yet — run: npm run jobs:deploy-callback");
    process.exit(1);
  }

  log.kv("agent", wallet.address);
  log.kv("intent", `${intentName} → ${intentId}`);
  log.kv("callback", callback);
  log.kv("params.strings[0]", prompt);

  const before = await snapshotBalances(wallet.address, p);
  const basePrice: bigint = await d.getJobBasePrice();
  log.kv("job base price", fmtUSDC(basePrice));
  log.kv("escrow before", fmtUSDC(before.agentEscrow));
  if (before.agentEscrow < basePrice) {
    log.fail(`escrow too low — deposit with: npm run jobs:escrow -- deposit 5`);
    process.exit(1);
  }

  // What goes in OnChainData depends on the target miner's YAML on_chain
  // config. For chat-style intents strings[0] is the prompt.
  const params = { addresses: [], integers: [], strings: [prompt], bools: [] };

  log.step("createJob…");
  const tx = await d.createJob(intentId, params, callback);
  const receipt = await tx.wait();
  const created = receipt.logs
    .map((l: any) => { try { return d.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "JobCreated");
  const jobId: bigint = created!.args.jobId;
  log.ok(`job ${jobId} created — tx ${BASESCAN}/tx/${tx.hash}`);

  log.step("waiting for the node to route → miner → validators → transitionToTerminal (epochs are minutes on testnet)…");
  const job = await pollUntil(async () => {
    const j = await d.getJob(jobId);
    return Number(j.state) === 1 ? j : null; // Terminal
  }, { timeoutMs: 15 * 60_000, intervalMs: 10_000, label: `job ${jobId} Terminal` });

  log.ok(`job ${jobId} is Terminal`);
  log.kv("budget", fmtUSDC(job.budget));
  log.kv("minerPayment (98%)", fmtUSDC(job.minerPayment));
  log.kv("protocolFee (2%)", fmtUSDC(job.protocolFee));

  // ── Find the JobTerminal event + the settlement transaction ────────────────
  const terminalEvents = await d.queryFilter(d.filters.JobTerminal(jobId), before.block, "latest");
  const terminalTx = terminalEvents[0]?.transactionHash;
  if (terminalTx) log.kv("terminal tx", `${BASESCAN}/tx/${terminalTx}`);

  // ── On-chain verification ──────────────────────────────────────────────────
  log.banner("On-chain verification");
  const after = await snapshotBalances(wallet.address, p);

  log.kv("escrow delta", `${fmtUSDC(before.agentEscrow - after.agentEscrow)} (should equal budget ${fmtUSDC(job.budget)})`);
  log.kv("treasury delta", `+${fmtUSDC(after.treasuryUsdcEscrowToken - before.treasuryUsdcEscrowToken)} USDC (protocol fee)`);

  if (terminalTx) {
    // Decode every token movement inside the settlement tx.
    const rcpt = await p.getTransactionReceipt(terminalTx);
    const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    log.step("token transfers in the settlement tx:");
    for (const l of rcpt!.logs) {
      let parsed: ethers.LogDescription | null = null;
      try { parsed = iface.parseLog(l); } catch { /* not a Transfer */ }
      if (!parsed) continue;
      const token = l.address === ADDRESSES.usdcEscrow ? "USDC(escrow)"
        : l.address === ADDRESSES.machina ? "MACHINA"
        : l.address;
      const amount = token === "MACHINA" ? fmtMachina(parsed.args.value) : fmtUSDC(parsed.args.value);
      const to = parsed.args.to === ADDRESSES.treasury ? `${parsed.args.to} (TREASURY)` : parsed.args.to;
      console.log(`     ${token.padEnd(14)} ${parsed.args.from} → ${to}  ${amount}`);
    }
  }

  // ── Callback result stored in your contract ───────────────────────────────
  const cb = new ethers.Contract(callback, [
    "function results(uint256) view returns (bool received, bool success, string firstString, string errorMessage, uint256 receivedAt)",
  ], p);
  const stored = await cb.results(jobId);
  log.banner("Callback contract state");
  if (stored.received) {
    log.ok(`callback received result for job ${jobId}`);
    log.kv("success", stored.success);
    log.kv("result strings[0]", stored.firstString || "(empty)");
    if (stored.errorMessage) log.kv("error", stored.errorMessage);
  } else {
    log.warn("callback has no stored result (the protocol may deliver the callback in a later epoch tx, or the response packing produced no data — check verify:job)");
  }

  log.kv("audit any time", `npm run verify:job -- ${jobId}`);
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
