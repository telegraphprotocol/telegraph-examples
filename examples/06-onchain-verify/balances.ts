/**
 * On-chain verification: every balance that matters, in one view.
 * Run before/after any example to see exactly what moved.
 */
import { ethers } from "ethers";
import { log } from "../../src/lib/log.js";
import { provider, agentWallet, snapshotBalances } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN, fmtUSDC, fmtMachina } from "../../src/lib/protocol.js";

async function main() {
  const p = provider();
  const wallet = agentWallet(p);
  const s = await snapshotBalances(wallet.address, p);

  log.banner("On-chain balances (Base Sepolia)");
  log.kv("block", s.block);
  log.kv("agent", `${wallet.address}  (${BASESCAN}/address/${wallet.address})`);
  console.log();
  log.kv("agent ETH", `${ethers.formatEther(s.agentEth)} ETH`);
  log.kv("agent USDC (x402)", `${fmtUSDC(s.agentUsdcX402)}  [Circle ${ADDRESSES.usdcX402.slice(0, 10)}…]`);
  log.kv("agent USDC (escrow tok)", `${fmtUSDC(s.agentUsdcEscrowToken)}  [protocol ${ADDRESSES.usdcEscrow.slice(0, 10)}…]`);
  log.kv("agent escrow @Diamond", fmtUSDC(s.agentEscrow));
  log.kv("agent MACHINA", fmtMachina(s.agentMachina));
  console.log();
  log.kv("treasury USDC", `${fmtUSDC(s.treasuryUsdcEscrowToken)}  [${ADDRESSES.treasury.slice(0, 10)}…]`);
  log.kv("x402 receiver USDC", `${fmtUSDC(s.receiverUsdcX402)}  [${ADDRESSES.x402Receiver.slice(0, 10)}…]`);
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
