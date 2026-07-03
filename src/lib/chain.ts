import { ethers } from "ethers";
import { config } from "./config.js";
import { ADDRESSES, DIAMOND_ABI, ERC20_ABI } from "./protocol.js";

export function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
}

export function agentWallet(p = provider()): ethers.Wallet {
  if (!config.agentPrivateKey) throw new Error("AGENT_PRIVATE_KEY not set in .env");
  return new ethers.Wallet(config.agentPrivateKey, p);
}

export function diamond(runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(ADDRESSES.diamond, DIAMOND_ABI, runner);
}

export function erc20(address: string, runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(address, ERC20_ABI, runner);
}

/** Snapshot of every balance relevant to payment verification. */
export interface BalanceSnapshot {
  block: number;
  agentEth: bigint;
  agentUsdcX402: bigint;
  agentUsdcEscrowToken: bigint;
  agentEscrow: bigint;         // inside the Diamond
  agentMachina: bigint;
  treasuryUsdcEscrowToken: bigint;
  receiverUsdcX402: bigint;    // x402 receiving address
}

export async function snapshotBalances(agent: string, p = provider()): Promise<BalanceSnapshot> {
  const d = diamond(p);
  const usdcX = erc20(ADDRESSES.usdcX402, p);
  const usdcE = erc20(ADDRESSES.usdcEscrow, p);
  const mach = erc20(ADDRESSES.machina, p);

  const [block, agentEth, agentUsdcX402, agentUsdcEscrowToken, agentEscrow, agentMachina, treasuryUsdcEscrowToken, receiverUsdcX402] =
    await Promise.all([
      p.getBlockNumber(),
      p.getBalance(agent),
      usdcX.balanceOf(agent),
      usdcE.balanceOf(agent),
      d.escrowBalance(agent),
      mach.balanceOf(agent),
      usdcE.balanceOf(ADDRESSES.treasury),
      usdcX.balanceOf(ADDRESSES.x402Receiver),
    ]);

  return { block, agentEth, agentUsdcX402, agentUsdcEscrowToken, agentEscrow, agentMachina, treasuryUsdcEscrowToken, receiverUsdcX402 };
}

/** Public RPCs cap eth_getLogs ranges (sepolia.base.org: 2000 blocks) — chunk queries. */
export async function queryFilterChunked(
  c: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  fromBlock: number,
  toBlock: number,
  chunk = 1990,
): Promise<(ethers.EventLog | ethers.Log)[]> {
  const out: (ethers.EventLog | ethers.Log)[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(start + chunk - 1, toBlock);
    out.push(...await c.queryFilter(filter, start, end));
  }
  return out;
}

/**
 * Scan an ERC-20 for Transfer(from→to) events since a block.
 * Used to prove x402 settlement and job payouts actually happened on-chain.
 */
export async function findTransfers(
  token: string,
  fromBlock: number,
  filter: { from?: string; to?: string },
  p = provider(),
): Promise<{ txHash: string; block: number; from: string; to: string; value: bigint }[]> {
  const c = erc20(token, p);
  const tip = await p.getBlockNumber();
  const events = await queryFilterChunked(
    c,
    c.filters.Transfer(filter.from ?? null, filter.to ?? null),
    fromBlock,
    tip,
  );
  return events.map((e) => {
    const ev = e as ethers.EventLog;
    return {
      txHash: ev.transactionHash,
      block: ev.blockNumber,
      from: ev.args[0] as string,
      to: ev.args[1] as string,
      value: ev.args[2] as bigint,
    };
  });
}

/** Poll fn until it returns non-null or the timeout elapses. Transient RPC errors are tolerated. */
export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  { timeoutMs = 300_000, intervalMs = 5_000, label = "condition" } = {},
): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v !== null) return v;
    } catch (e) {
      lastErr = e; // public RPCs rate-limit eth_getLogs — retry until timeout
    }
    if (Date.now() - start > timeoutMs) {
      const suffix = lastErr ? ` (last error: ${(lastErr as Error)?.message ?? lastErr})` : "";
      throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${label}${suffix}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
