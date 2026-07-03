/**
 * One-time setup: fund the AGENT wallet so every example can run.
 *
 * The agent needs:
 *   - a little Base Sepolia ETH        (gas for escrow deposit / createJob)
 *   - Circle USDC (0x036C…)            (x402 pay-per-call inference)
 *   - protocol test USDC (0xfFC3…)     (Diamond escrow: ERC-8183 jobs + WS subscriptions)
 *   - ≥ $1.00 deposited in the Diamond escrow (WebSocket KnockGate minimum)
 *
 * Funds are sent from FUNDER_PRIVATE_KEY (any funded Base Sepolia wallet).
 * Amounts are small; re-run any time to top up.
 */
import { ethers } from "ethers";
import { config, requireAgentKey } from "../src/lib/config.js";
import { ADDRESSES, fmtUSDC } from "../src/lib/protocol.js";
import { provider, diamond, erc20, agentWallet } from "../src/lib/chain.js";
import { log } from "../src/lib/log.js";

const ETH_TARGET = ethers.parseEther("0.001");
const X402_USDC_TARGET = 2_000_000n;      // $2 Circle USDC
const ESCROW_TOKEN_TARGET = 20_000_000n;  // $20 protocol test USDC
const ESCROW_DEPOSIT = 10_000_000n;       // $10 into the Diamond escrow

async function main() {
  log.banner("Fund agent wallet");
  requireAgentKey();
  if (!config.funderPrivateKey) {
    log.fail("FUNDER_PRIVATE_KEY not set — set it in .env to a funded Base Sepolia wallet.");
    process.exit(1);
  }

  const p = provider();
  const funder = new ethers.Wallet(config.funderPrivateKey, p);
  const agent = agentWallet(p);
  log.kv("funder", funder.address);
  log.kv("agent", agent.address);

  // 1. ETH for gas
  const ethBal = await p.getBalance(agent.address);
  if (ethBal < ETH_TARGET / 2n) {
    log.step(`sending ${ethers.formatEther(ETH_TARGET)} ETH for gas…`);
    await (await funder.sendTransaction({ to: agent.address, value: ETH_TARGET })).wait();
    log.ok("ETH sent");
  } else log.ok(`ETH ok (${ethers.formatEther(ethBal)})`);

  // 2. Circle USDC for x402
  const usdcX = erc20(ADDRESSES.usdcX402, funder);
  const xBal: bigint = await usdcX.balanceOf(agent.address);
  if (xBal < X402_USDC_TARGET / 2n) {
    log.step(`sending ${fmtUSDC(X402_USDC_TARGET)} Circle USDC (x402)…`);
    await (await usdcX.transfer(agent.address, X402_USDC_TARGET)).wait();
    log.ok("x402 USDC sent");
  } else log.ok(`x402 USDC ok (${fmtUSDC(xBal)})`);

  // 3. Protocol test USDC for escrow/jobs
  const usdcE = erc20(ADDRESSES.usdcEscrow, funder);
  const eBal: bigint = await usdcE.balanceOf(agent.address);
  if (eBal < ESCROW_TOKEN_TARGET / 2n) {
    log.step(`sending ${fmtUSDC(ESCROW_TOKEN_TARGET)} protocol USDC (escrow/jobs)…`);
    await (await usdcE.transfer(agent.address, ESCROW_TOKEN_TARGET)).wait();
    log.ok("protocol USDC sent");
  } else log.ok(`protocol USDC ok (${fmtUSDC(eBal)})`);

  // 4. Deposit into Diamond escrow (agent signs: approve + depositUSDC)
  const d = diamond(agent);
  const escrowBal: bigint = await d.escrowBalance(agent.address);
  if (escrowBal < ESCROW_DEPOSIT / 2n) {
    const usdcAsAgent = erc20(ADDRESSES.usdcEscrow, agent);
    log.step(`approving Diamond for ${fmtUSDC(ESCROW_DEPOSIT)}…`);
    await (await usdcAsAgent.approve(ADDRESSES.diamond, ESCROW_DEPOSIT)).wait();
    // load-balanced public RPCs can lag a block behind their own receipts
    while ((await usdcAsAgent.allowance(agent.address, ADDRESSES.diamond)) < ESCROW_DEPOSIT) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    log.step("depositUSDC into Diamond escrow…");
    await (await d.depositUSDC(ESCROW_DEPOSIT)).wait();
    log.ok(`escrow deposited: ${fmtUSDC(await d.escrowBalance(agent.address))}`);
  } else log.ok(`escrow ok (${fmtUSDC(escrowBal)})`);

  log.banner("Agent funded — every example can now run");
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
