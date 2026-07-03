/**
 * Direct x402 inference: pay a specific miner per call, no Engine routing.
 *
 * Calls Zeus weather forecasting (miner 18) via the miner dispatcher:
 *   GET /miner-dispatcher/v1/18/predict?lat=…&lon=…&variable=2t
 * First request → 402 challenge; sign USDC EIP-3009; retry; verify the
 * settled transfer on Base Sepolia.
 *
 * Usage: npm run x402:weather -- [lat] [lon]
 */
import { ethers } from "ethers";
import { config, requireAgentKey } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";
import { fetchWithPayment } from "../../src/lib/x402.js";
import { provider, findTransfers, pollUntil } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN, fmtUSDC } from "../../src/lib/protocol.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const lat = args[0] ?? "51.5";
const lon = args[1] ?? "-0.12";

async function main() {
  log.banner("Direct x402 → Zeus weather (miner 18)");
  const wallet = new ethers.Wallet(requireAgentKey());
  const p = provider();
  const startBlock = await p.getBlockNumber();
  const url = `${config.dispatcherUrl}/v1/18/predict?lat=${lat}&lon=${lon}&variable=2t&forecast_hours=12`;
  log.kv("payer", wallet.address);
  log.kv("url", url);

  const { response, paid, payment } = await fetchWithPayment(url, { method: "GET" }, wallet, config.chainId);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const body: any = await response.json();

  const temps: number[] = body?.hourly?.["2t"] ?? [];
  log.ok(`forecast received (paid: ${paid})`);
  log.kv("model", body?.model);
  log.kv("reference_time", body?.reference_time);
  if (temps.length) {
    const toC = (k: number) => (k - 273.15).toFixed(1);
    log.kv("next 12h (°C)", temps.map(toC).join(", "));
  } else {
    log.json(body, 600);
  }

  if (paid && payment) {
    log.banner("On-chain verification");
    log.step("waiting for facilitator settlement…");
    const transfer = await pollUntil(async () => {
      const xfers = await findTransfers(ADDRESSES.usdcX402, startBlock, { from: wallet.address, to: payment.accept.payTo }, p);
      return xfers.find((x) => x.value === BigInt(payment.authorization.value)) ?? null;
    }, { timeoutMs: 120_000, intervalMs: 5_000, label: "USDC settlement transfer" });
    log.ok(`paid ${fmtUSDC(transfer.value)} → ${transfer.to}`);
    log.kv("tx", `${BASESCAN}/tx/${transfer.txHash}`);
  }
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
