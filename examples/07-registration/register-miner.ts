/**
 * Miner registration — the full permissionless lifecycle.
 *
 * 1. Host a miner YAML over HTTP (frontend/yaml/demo-miner.yaml, served by
 *    `npm run frontend` at http://127.0.0.1:8787/yaml/demo-miner.yaml).
 *    frontend/yaml/example-miner.yaml is the annotated reference version —
 *    set MINER_YAML_FILE / MINER_YAML_URL / MINER_INTENTS to register it.
 * 2. registerMiner(yamlUrl, sha256(yaml), feeAddress, minPriceUsdc, intents)
 *    on the Diamond — permissionless, no bond in this release.
 * 3. At the next epoch boundary the node's listener fetches the YAML,
 *    verifies the hash, schema-validates it and stores the record.
 * 4. Read the record back with getMiner(registrationId).
 *
 * Run against a LOCAL node (the node must be able to reach the YAML URL):
 *   npm run frontend            # serves the YAML
 *   npm run reg:miner           # register
 *   npm run reg:miner -- deregister <id>   # clean up
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { log } from "../../src/lib/log.js";
import { provider, agentWallet, diamond } from "../../src/lib/chain.js";
import { BASESCAN, fmtUSDC } from "../../src/lib/protocol.js";

const REGISTER_ABI = [
  "function registerMiner(string yamlUrl, bytes32 yamlHash, address feeAddress, uint256 minPriceUsdc, string[] supportedIntents) returns (uint256)",
  "function deregisterMiner(uint256 registrationId)",
  "event MinerRegistered(uint256 indexed registrationId, address indexed miner, string yamlUrl, bytes32 yamlHash, address feeAddress, uint256 minPriceUsdc, string[] supportedIntents)",
];

// Defaults register the minimal demo-miner.yaml. Point both at
// frontend/yaml/example-miner.yaml to register the fully annotated example
// instead — MINER_YAML_FILE is what gets hashed, MINER_YAML_URL is what the
// node fetches, and they must be the same bytes.
const YAML_FILE = process.env.MINER_YAML_FILE ?? "frontend/yaml/demo-miner.yaml";
const YAML_URL = process.env.MINER_YAML_URL ?? "http://127.0.0.1:8787/yaml/demo-miner.yaml";
const INTENTS = (process.env.MINER_INTENTS ?? "WEATHER_CHECK").split(",").map((s) => s.trim()).filter(Boolean);
const args = process.argv.slice(2).filter((a) => a !== "--");

async function main() {
  const p = provider();
  const wallet = agentWallet(p);
  const d = diamond(wallet);
  const { ethers } = await import("ethers");
  const reg = new ethers.Contract(await d.getAddress(), REGISTER_ABI, wallet);

  if (args[0] === "deregister") {
    const id = BigInt(args[1]);
    log.banner(`Deregister miner ${id}`);
    const tx = await reg.deregisterMiner(id);
    await tx.wait();
    log.ok(`deregistered — tx ${BASESCAN}/tx/${tx.hash}`);
    return;
  }

  log.banner("Register a miner on-chain");
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const yaml = readFileSync(join(root, YAML_FILE));
  const yamlHash = "0x" + createHash("sha256").update(yaml).digest("hex");

  log.kv("miner wallet", wallet.address);
  log.kv("yaml file", YAML_FILE);
  log.kv("yaml url", YAML_URL);
  log.kv("sha256(yaml)", yamlHash);
  log.kv("intents", INTENTS.join(", "));

  // sanity: the URL must serve exactly these bytes or the node will reject it
  try {
    const served = Buffer.from(await (await fetch(YAML_URL)).arrayBuffer());
    if (!served.equals(yaml)) log.warn("served YAML differs from local file — node will reject on hash mismatch");
    else log.ok("YAML is being served with a matching hash");
  } catch {
    log.warn(`YAML URL not reachable (${YAML_URL}) — start \`npm run frontend\` first; the node will mark the record rejected until it can fetch it`);
  }

  const tx = await reg.registerMiner(YAML_URL, yamlHash, wallet.address, 10_000, INTENTS);
  const rcpt = await tx.wait();
  const ev = rcpt.logs
    .map((l: any) => { try { return reg.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "MinerRegistered");
  const regId = ev?.args?.registrationId;
  log.ok(`registered — id ${regId} — tx ${BASESCAN}/tx/${tx.hash}`);

  const m = await d.getMiner(regId);
  log.kv("on-chain record", "");
  log.kv("  miner", m.miner);
  log.kv("  active", m.active);
  log.kv("  intentId", m.intentId);
  log.kv("  minPrice", fmtUSDC(m.minPriceUsdc));
  log.kv("  intents", m.supportedIntents.join(", "));

  log.step("the node ingests this at its next epoch boundary (watch: journalctl -u telegraph | grep processMinerRecord)");
  log.step(`clean up when done: npm run reg:miner -- deregister ${regId}`);
}

main().catch((e) => { log.fail(String(e?.shortMessage ?? e?.message ?? e)); process.exit(1); });
