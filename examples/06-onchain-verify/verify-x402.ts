/**
 * On-chain verification: audit x402 payments.
 *
 * Every x402 call you make ends as a USDC Transfer from your wallet to the
 * node's receiving address, submitted by the PayAI facilitator via
 * transferWithAuthorization. This lists them straight from chain logs.
 *
 * Usage: npm run verify:x402 -- [lookback-blocks]     (default 20000 ≈ 11h)
 */
import { log } from "../../src/lib/log.js";
import { provider, agentWallet, findTransfers } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN, fmtUSDC } from "../../src/lib/protocol.js";

const lookback = parseInt(process.argv.slice(2).filter((a) => a !== "--")[0] ?? "20000", 10);

async function main() {
  const p = provider();
  const wallet = agentWallet(p);
  const tip = await p.getBlockNumber();

  log.banner("x402 payment audit");
  log.kv("payer", wallet.address);
  log.kv("receiver", ADDRESSES.x402Receiver);
  log.kv("scanning blocks", `${tip - lookback} → ${tip}`);

  const transfers = await findTransfers(ADDRESSES.usdcX402, tip - lookback, { from: wallet.address, to: ADDRESSES.x402Receiver }, p);

  if (!transfers.length) { log.warn("no settled x402 payments found in range"); return; }
  let total = 0n;
  for (const t of transfers) {
    total += t.value;
    console.log(`  ${String(t.block).padEnd(10)} ${fmtUSDC(t.value).padEnd(10)} ${BASESCAN}/tx/${t.txHash}`);
  }
  console.log();
  log.ok(`${transfers.length} payments, total ${fmtUSDC(total)}`);
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
