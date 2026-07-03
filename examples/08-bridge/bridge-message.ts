/**
 * Cross-chain bridge message (CrossChainFacet).
 *
 * A wallet/contract calls outboundMessage(sender, destination, OnChainData,
 * endChain) on the source-chain Diamond. The node's listener sees the
 * BridgeSwapOutData event, collects validator signatures, and calls
 * executeInboundMessage on the endChain's Diamond, which delivers the payload
 * to your destination contract's portMessage(). Gas on the destination side
 * is reimbursed from your GasFacet deposit.
 *
 * This example deploys a BridgeReceiverTestApp as the destination, deposits a
 * little gas, sends the message, and polls the receiver's callCount.
 *
 * Usage: npm run bridge:send -- [endChain]      (default: Base-Sepolia)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { log } from "../../src/lib/log.js";
import { provider, agentWallet, pollUntil } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN } from "../../src/lib/protocol.js";

const BRIDGE_ABI = [
  "function outboundMessage(address sender, address destination, (address[] addresses, uint256[] integers, string[] strings, bool[] bools) data, string endChain)",
  "function depositGas(uint256 amount) payable",
  "function getUserGasBalance(address user) view returns (uint256)",
];
const RECEIVER_ABI = [
  "function callCount() view returns (uint256)",
  "function lastSender() view returns (address)",
  "function lastStartChain() view returns (string)",
  "function lastStrings(uint256) view returns (string)",
];

const endChain = process.argv.slice(2).filter((a) => a !== "--")[0] ?? "Base-Sepolia";

async function main() {
  log.banner("Cross-chain bridge message");
  const p = provider();
  const wallet = agentWallet(p);
  const bridge = new ethers.Contract(ADDRESSES.diamond, BRIDGE_ABI, wallet);
  log.kv("sender", wallet.address);
  log.kv("endChain", endChain);

  // 1. destination contract (must implement portMessage)
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const artifact = JSON.parse(readFileSync(join(root, "contracts/out/BridgeReceiverTestApp.sol/BridgeReceiverTestApp.json"), "utf8"));
  log.step("deploying BridgeReceiverTestApp (destination)…");
  const receiver = await new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet).deploy();
  await receiver.waitForDeployment();
  const dest = await receiver.getAddress();
  log.ok(`receiver at ${dest}`);

  // 2. gas deposit for destination-side execution reimbursement
  const gasBal: bigint = await bridge.getUserGasBalance(wallet.address);
  if (gasBal < ethers.parseEther("0.0002")) {
    log.step("depositGas 0.0003 ETH…");
    const amt = ethers.parseEther("0.0003");
    await (await bridge.depositGas(amt, { value: amt })).wait();
    log.ok("gas deposited");
  } else log.ok(`gas balance ok (${ethers.formatEther(gasBal)} ETH)`);

  // 3. send the message
  const data = {
    addresses: [wallet.address],
    integers: [42n],
    strings: ["hello through the Telegraph bridge"],
    bools: [true],
  };
  log.step("outboundMessage…");
  const tx = await bridge.outboundMessage(wallet.address, dest, data, endChain);
  await tx.wait();
  log.ok(`sent — tx ${BASESCAN}/tx/${tx.hash}`);

  // 4. wait for the node to deliver portMessage on the destination
  log.step("waiting for the node to deliver portMessage on the destination…");
  const rc = new ethers.Contract(dest, RECEIVER_ABI, p);
  try {
    await pollUntil(async () => (await rc.callCount()) > 0n ? true : null,
      { timeoutMs: 300_000, intervalMs: 10_000, label: "bridge delivery" });
    log.ok("delivered!");
    log.kv("lastSender", await rc.lastSender());
    log.kv("lastStartChain", await rc.lastStartChain());
    log.kv("strings[0]", await rc.lastStrings(0));
  } catch (e) {
    log.fail(String((e as Error).message));
    log.warn("no delivery within the wait window — bridging requires a node configured with the destination network (multi-chain local setup). NOTE(node-version): re-test as newer node deployments roll out.");
  }
}

main().catch((e) => { log.fail(String(e?.shortMessage ?? e?.message ?? e)); process.exit(1); });
