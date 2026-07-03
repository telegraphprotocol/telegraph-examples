/**
 * WebSocket: subscribe to the Daemon's live signal stream.
 *
 * This is the paid push feed: wallet auth + ≥ $1.00 USDC in the Diamond
 * escrow are required. Every signal the Daemon pushes to your subscription is
 * logged with a receipt and batch-settled against your escrow at the epoch
 * boundary — this script snapshots your escrow before/after so you can see
 * exactly what delivery cost you on-chain.
 *
 * Signals arrive when the Daemon completes a cycle (2 min on the live testnet
 * node, 3 h in production config) — expect bursts, not a steady drip.
 *
 * Usage: npm run ws:subscribe            (intents/limits from .env)
 */
import { ethers } from "ethers";
import { config, requireAgentKey } from "../../src/lib/config.js";
import { TelegraphWS } from "../../src/lib/ws.js";
import { log } from "../../src/lib/log.js";
import { diamond, provider } from "../../src/lib/chain.js";
import { fmtUSDC } from "../../src/lib/protocol.js";

async function main() {
  log.banner("Daemon signal subscription (paid push feed)");
  const key = requireAgentKey();
  const wallet = new ethers.Wallet(key);
  const d = diamond(provider());

  const escrowBefore: bigint = await d.escrowBalance(wallet.address);
  log.kv("wallet", wallet.address);
  log.kv("escrow before", fmtUSDC(escrowBefore));
  log.kv("intents", config.subscribeIntents.join(", "));
  log.kv("stop after", config.maxSignals ? `${config.maxSignals} signals` : "Ctrl-C");

  const ws = new TelegraphWS(config.wsUrl);
  await ws.connect(wallet.address);
  await ws.authenticate(key);
  log.ok("authenticated — KnockGate accepted our on-chain escrow");

  ws.send({ action: "subscribe", intents: config.subscribeIntents });
  const sub = await ws.waitFor(["subscribed", "error"], 20_000);
  if (sub.type === "error") throw new Error(JSON.stringify(sub.data));
  log.ok(`subscribed: ${JSON.stringify(sub.data ?? {})}`);

  const ping = ws.startPing();
  let received = 0;

  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      log.warn(`no signal in ${config.signalTimeoutSeconds}s — the Daemon pushes in bursts at each cycle; try a longer SIGNAL_TIMEOUT_SECONDS or more intents`);
      resolve();
    }, config.signalTimeoutSeconds * 1000);

    ws.onMessage((m) => {
      // Daemon pushes arrive as type:"result" with a subscription_id payload
      // (or type:"daemon" on some builds).
      const d: any = m.data ?? m;
      const isSignal = (m.type === "result" || m.type === "daemon" || m.type === "signal") &&
        (d.subscription_id || d.question);
      if (!isSignal) return;

      received++;
      timer.refresh();
      const q = typeof d.question === "object" ? d.question?.text : d.question;
      log.signal(`#${received} [${d.intent ?? d.category ?? "?"}] ${q}`);
      if (d.routing?.subnet_name) log.kv("routed via", `${d.routing.subnet_name} (${d.routing.intent ?? "?"})`);
      if (d.execution?.cost_usd != null) log.kv("execution cost", `$${d.execution.cost_usd} in ${d.execution.duration_ms}ms`);
      log.json(d.execution?.result ?? d.result ?? {}, 400);

      if (config.maxSignals && received >= config.maxSignals) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  await done;
  clearInterval(ping);
  ws.close();

  const escrowAfter: bigint = await d.escrowBalance(wallet.address);
  log.banner("On-chain settlement");
  log.kv("signals received", received);
  log.kv("escrow before", fmtUSDC(escrowBefore));
  log.kv("escrow after", fmtUSDC(escrowAfter));
  const delta = escrowBefore - escrowAfter;
  if (delta > 0n) log.ok(`escrow deducted ${fmtUSDC(delta)} by validator batch settlement`);
  else log.warn("no deduction visible yet — deliveries settle at the epoch boundary; re-check escrow in a few minutes (npm run verify:balances)");
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
