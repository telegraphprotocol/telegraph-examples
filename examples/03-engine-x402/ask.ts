/**
 * Engine ask over HTTP with a real x402 payment, verified on-chain.
 *
 * 1. POST /engine/v1/ask                → 402 + Payment-Required challenge
 * 2. sign EIP-3009 TransferWithAuthorization (USDC, gasless for the payer)
 * 3. retry with PAYMENT-SIGNATURE       → Engine routes + executes the query
 * 4. watch Base Sepolia for the facilitator-settled USDC Transfer
 *    (payer → node receiving address) and print the tx hash.
 *
 * Usage: npm run x402:engine-ask -- "your question"
 */
import { ethers } from "ethers";
import { config, requireAgentKey } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";
import { fetchWithPayment } from "../../src/lib/x402.js";
import { provider, findTransfers, pollUntil } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN, fmtUSDC } from "../../src/lib/protocol.js";

const query = process.argv.slice(2).filter((a) => a !== "--").join(" ")
  || "What is the weather in London right now?";

async function main() {
  log.banner("Engine ask (HTTP + x402 payment)");
  const wallet = new ethers.Wallet(requireAgentKey());
  const p = provider();
  const startBlock = await p.getBlockNumber();
  log.kv("payer", wallet.address);
  log.kv("query", query);

  const t0 = Date.now();
  const { response, paid, payment, settleHeader } = await fetchWithPayment(
    `${config.engineUrl}/v1/ask`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
    wallet,
    config.chainId,
  );

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const body: any = await response.json();

  log.ok(`answered in ${Date.now() - t0}ms (paid: ${paid})`);
  log.kv("routed to", `${body.subnet_name} (id ${body.subnet_used})`);
  log.kv("intent", body.intent ?? "—");
  log.kv("reasoning", body.reasoning ?? "—");
  log.kv("cost_usd", body.cost_usd);
  log.json(body.result, 800);
  if (settleHeader) log.kv("settle header", settleHeader.slice(0, 60) + "…");

  if (paid && payment) {
    log.banner("On-chain verification");
    log.step("waiting for the facilitator to settle the USDC transfer on Base Sepolia…");
    const transfer = await pollUntil(async () => {
      const xfers = await findTransfers(
        ADDRESSES.usdcX402, startBlock,
        { from: wallet.address, to: payment.accept.payTo }, p,
      );
      return xfers.find((x) => x.value === BigInt(payment.authorization.value)) ?? null;
    }, { timeoutMs: 120_000, intervalMs: 5_000, label: "USDC settlement transfer" });

    log.ok("payment settled on-chain");
    log.kv("amount", fmtUSDC(transfer.value));
    log.kv("from → to", `${transfer.from} → ${transfer.to}`);
    log.kv("tx", `${BASESCAN}/tx/${transfer.txHash}`);
  }
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
