/**
 * Direct x402 inference: AI-text detection via miner 32 (ItsAI, Bittensor SN32).
 *   POST /miner-dispatcher/v1/32/detect — x402-gated.
 *
 * Usage: npm run x402:detect -- "text to check"
 */
import { ethers } from "ethers";
import { config, requireAgentKey } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";
import { fetchWithPayment } from "../../src/lib/x402.js";
import { provider, findTransfers, pollUntil } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN, fmtUSDC } from "../../src/lib/protocol.js";

// ItsAI requires > 200 characters of input text.
const text = process.argv.slice(2).filter((a) => a !== "--").join(" ")
  || "In the ever-evolving landscape of digital transformation, organizations must leverage synergies to unlock unprecedented value across their stakeholder ecosystems. By harnessing cutting-edge paradigms and fostering a culture of continuous innovation, forward-thinking enterprises can seamlessly navigate the complexities of tomorrow while driving sustainable growth and maximizing operational excellence at scale.";

async function main() {
  log.banner("Direct x402 → AI text detection (miner 32)");
  const wallet = new ethers.Wallet(requireAgentKey());
  const p = provider();
  const startBlock = await p.getBlockNumber();
  log.kv("payer", wallet.address);
  log.kv("text", text.slice(0, 90) + (text.length > 90 ? "…" : ""));

  const { response, paid, payment } = await fetchWithPayment(
    `${config.dispatcherUrl}/v1/32/detect`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) },
    wallet,
    config.chainId,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const body: any = await response.json();
  log.ok(`verdict received (paid: ${paid})`);
  log.json(body, 800);

  if (paid && payment) {
    log.banner("On-chain verification");
    const transfer = await pollUntil(async () => {
      const xfers = await findTransfers(ADDRESSES.usdcX402, startBlock, { from: wallet.address, to: payment.accept.payTo }, p);
      return xfers.find((x) => x.value === BigInt(payment.authorization.value)) ?? null;
    }, { timeoutMs: 120_000, intervalMs: 5_000, label: "USDC settlement transfer" });
    log.ok(`paid ${fmtUSDC(transfer.value)} → ${transfer.to}`);
    log.kv("tx", `${BASESCAN}/tx/${transfer.txHash}`);
  }
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
