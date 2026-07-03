/**
 * ERC-8183 step 1: deploy the callback contract that will receive job results.
 *
 * The protocol requires `callback` to be a deployed contract (it checks
 * extcodesize before accepting the job). This deploys TelegraphJobCallback
 * (contracts/TelegraphJobCallback.sol, compiled artifact committed in
 * contracts/out/) and records the address in .callback.json for create-job.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { log } from "../../src/lib/log.js";
import { provider, agentWallet } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN } from "../../src/lib/protocol.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const CALLBACK_STATE = join(root, ".callback.json");

export function loadCallbackAddress(): string | null {
  try { return JSON.parse(readFileSync(CALLBACK_STATE, "utf8")).address ?? null; }
  catch { return null; }
}

async function main() {
  log.banner("Deploy ERC-8183 callback contract");
  const artifact = JSON.parse(readFileSync(join(root, "contracts/out/TelegraphJobCallback.sol/TelegraphJobCallback.json"), "utf8"));
  const wallet = agentWallet(provider());
  log.kv("deployer", wallet.address);
  log.kv("diamond", ADDRESSES.diamond);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
  const contract = await factory.deploy(ADDRESSES.diamond);
  log.step(`deploy tx ${contract.deploymentTransaction()?.hash}`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  writeFileSync(CALLBACK_STATE, JSON.stringify({ address, deployedAt: new Date().toISOString() }, null, 2));
  log.ok(`callback deployed at ${address}`);
  log.kv("explorer", `${BASESCAN}/address/${address}`);
  log.kv("saved to", CALLBACK_STATE);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
}
