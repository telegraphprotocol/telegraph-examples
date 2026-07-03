/**
 * Collector registration (admin-gated).
 *
 * Collectors are the Daemon's data scrapers. Registration lives on the
 * IntentRegistryFacet and — in this release — is restricted to protocol
 * admins, so this example signs with FUNDER_PRIVATE_KEY (the testnet owner).
 * A permissionless path (WASM authors) exists via registerWasm.
 *
 * Usage:
 *   npm run reg:collector                          # register demo collector
 *   npm run reg:collector -- deregister <id>       # clean up (entityType 1)
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { config } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";
import { provider } from "../../src/lib/chain.js";
import { ADDRESSES, BASESCAN } from "../../src/lib/protocol.js";

const ABI = [
  "function registerCollector(string yamlUrl, bytes32 yamlHash, address feeAddress) returns (uint256)",
  "function deregisterEntity(uint256 registrationId, uint8 entityType)",
  "function getCollector(uint256 registrationId) view returns (address collector, string yamlUrl, bytes32 yamlHash, address feeAddress, bool active, address approvedBy)",
  "function entityCount(uint8 entityType) view returns (uint256)",
  "event IntentRegistered(uint256 indexed registrationId, address indexed registrant, uint8 entityType, bytes32 intentId, string contentUrl, bytes32 contentHash)",
];
const ENTITY_COLLECTOR = 1;

const YAML_URL = process.env.COLLECTOR_YAML_URL ?? "http://127.0.0.1:8787/yaml/demo-collector.yaml";
const args = process.argv.slice(2).filter((a) => a !== "--");

async function main() {
  if (!config.funderPrivateKey) {
    log.fail("registerCollector is admin-only — set FUNDER_PRIVATE_KEY (protocol owner) in .env");
    process.exit(1);
  }
  const p = provider();
  const admin = new ethers.Wallet(config.funderPrivateKey, p);
  const c = new ethers.Contract(ADDRESSES.diamond, ABI, admin);

  if (args[0] === "deregister") {
    const id = BigInt(args[1]);
    log.banner(`Deregister collector ${id}`);
    const tx = await c.deregisterEntity(id, ENTITY_COLLECTOR);
    await tx.wait();
    log.ok(`deregistered — tx ${BASESCAN}/tx/${tx.hash}`);
    return;
  }

  log.banner("Register a collector on-chain (admin)");
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const yaml = readFileSync(join(root, "frontend/yaml/demo-collector.yaml"));
  const yamlHash = "0x" + createHash("sha256").update(yaml).digest("hex");
  log.kv("admin", admin.address);
  log.kv("yaml url", YAML_URL);
  log.kv("sha256(yaml)", yamlHash);
  log.warn("collector YAML hashes are deduplicated on-chain — re-registering the identical file will revert");

  const tx = await c.registerCollector(YAML_URL, yamlHash, admin.address);
  const rcpt = await tx.wait();
  const ev = rcpt.logs
    .map((l: any) => { try { return c.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "IntentRegistered");
  const regId = ev?.args?.registrationId;
  log.ok(`registered — collector id ${regId} — tx ${BASESCAN}/tx/${tx.hash}`);

  const rec = await c.getCollector(regId);
  log.kv("collector", rec.collector);
  log.kv("active", rec.active);
  log.kv("approvedBy", rec.approvedBy);
  log.step(`clean up when done: npm run reg:collector -- deregister ${regId}`);
}

main().catch((e) => { log.fail(String(e?.shortMessage ?? e?.message ?? e)); process.exit(1); });
