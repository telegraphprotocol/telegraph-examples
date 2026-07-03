/**
 * ERC-8183 escrow management on the Diamond.
 *
 * Jobs are funded from your USDC escrow inside the Diamond (protocol test
 * USDC 0xfFC3…, not the Circle x402 token). Withdrawals have a 4h timelock.
 *
 * Usage:
 *   npm run jobs:escrow                    # show balances
 *   npm run jobs:escrow -- deposit 5       # deposit $5
 *   npm run jobs:escrow -- withdraw 2      # request withdrawal (starts 4h timelock)
 *   npm run jobs:escrow -- execute         # execute after timelock
 */
import { log } from "../../src/lib/log.js";
import { provider, agentWallet, diamond, erc20 } from "../../src/lib/chain.js";
import { ADDRESSES, fmtUSDC } from "../../src/lib/protocol.js";

const [cmd, amountStr] = process.argv.slice(2).filter((a) => a !== "--");

async function main() {
  const p = provider();
  const wallet = agentWallet(p);
  const d = diamond(wallet);
  const usdc = erc20(ADDRESSES.usdcEscrow, wallet);

  log.banner("Diamond escrow");
  log.kv("wallet", wallet.address);

  if (cmd === "deposit") {
    const amount = BigInt(Math.round(parseFloat(amountStr) * 1e6));
    log.step(`approve + depositUSDC(${fmtUSDC(amount)})`);
    await (await usdc.approve(ADDRESSES.diamond, amount)).wait();
    while ((await usdc.allowance(wallet.address, ADDRESSES.diamond)) < amount) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    const tx = await d.depositUSDC(amount);
    await tx.wait();
    log.ok(`deposited — tx ${tx.hash}`);
  } else if (cmd === "withdraw") {
    const amount = BigInt(Math.round(parseFloat(amountStr) * 1e6));
    const tx = await d.requestWithdraw(amount);
    await tx.wait();
    log.ok(`withdrawal requested (4h timelock) — tx ${tx.hash}`);
  } else if (cmd === "execute") {
    const tx = await d.executeWithdraw();
    await tx.wait();
    log.ok(`withdrawal executed — tx ${tx.hash}`);
  }

  const [walletBal, escrow, effective] = await Promise.all([
    usdc.balanceOf(wallet.address),
    d.escrowBalance(wallet.address),
    d.effectiveBalance(wallet.address),
  ]);
  log.kv("wallet USDC", fmtUSDC(walletBal));
  log.kv("escrow balance", fmtUSDC(escrow));
  log.kv("effective balance", `${fmtUSDC(effective)} (escrow − pending withdrawals)`);
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
