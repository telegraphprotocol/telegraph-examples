/**
 * WebSocket: wallet authentication handshake (EIP-191).
 *
 * Flow: connect with ?wallet_address= → {action:auth_wallet} → server sends a
 * nonce challenge → sign with personal_sign → {action:wallet_verify} → server
 * checks the signature AND your on-chain USDC escrow (≥ $1.00 via the
 * KnockGate) → wallet_verified → connected.
 *
 * If your escrow is underfunded run `npm run fund-agent` first.
 */
import { ethers } from "ethers";
import { config, requireAgentKey } from "../../src/lib/config.js";
import { TelegraphWS } from "../../src/lib/ws.js";
import { log } from "../../src/lib/log.js";
import { diamond, provider } from "../../src/lib/chain.js";
import { fmtUSDC } from "../../src/lib/protocol.js";

async function main() {
  log.banner("WebSocket wallet authentication");
  const key = requireAgentKey();
  const wallet = new ethers.Wallet(key);
  log.kv("wallet", wallet.address);
  log.kv("ws url", config.wsUrl);

  const escrow = await diamond(provider()).escrowBalance(wallet.address);
  log.kv("on-chain escrow", `${fmtUSDC(escrow)} (KnockGate requires ≥ $1.00)`);

  const ws = new TelegraphWS(config.wsUrl);
  log.step("connecting…");
  await ws.connect(wallet.address);
  log.ok("socket open — starting EIP-191 handshake");

  ws.onMessage((m) => {
    if (m.type === "wallet_challenge") log.kv("challenge nonce", (m.data as any)?.nonce);
  });

  await ws.authenticate(key);
  log.ok("wallet verified — connection authenticated");
  log.step("this connection can now subscribe to Daemon signals (see ws:subscribe)");
  ws.close();
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
