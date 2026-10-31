/**
 * Pre-flight an Evaluator adapter package before you host and register it.
 *
 * Reads <INTENT>.safetensors, prints its metadata and hashes, runs the Stage 1
 * rules a node applies (see package.ts), and prints the registerWasm arguments.
 * Nothing is sent. The authoritative check is the adapter kit's
 * `adapterbuild lora`, which runs the node's own parser and can score the
 * package on the foundation.
 *
 * Usage:
 *   npm run adapter:inspect -- <INTENT>.safetensors [--foundation foundation.json] [--class judgment|hybrid]
 *                                                   [--url https://…/<INTENT>.safetensors] [--runnable-url https://…]
 */
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { log } from "../src/lib/log.js";
import { checkPackage, readPackage, sha256Hex, MODERNBERT_BASE, type Layout } from "./package.js";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const file = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));

function main() {
  if (!file) {
    log.fail("usage: npm run adapter:inspect -- <INTENT>.safetensors [--foundation foundation.json] [--class judgment|hybrid]");
    process.exit(2);
  }
  const bytes = readFileSync(file);
  const keccak = ethers.keccak256(bytes);
  log.banner(`Evaluator adapter ${file}`);
  log.kv("bytes", bytes.length);
  log.kv("keccak256 (register)", keccak);
  log.kv("sha256", sha256Hex(bytes));

  // A full-model .wasm (the format before the shared foundation) starts with "\0asm".
  if (bytes.subarray(0, 4).toString("latin1") === "\0asm") {
    log.fail("this is a .wasm module, not a delta package. Nodes reject a full-model float adapter with legacy_full_model, " +
      "and accept no other module for a judgment or hybrid intent. Re-export the delta with the kit's export_adapter.py.");
    process.exit(1);
  }

  let foundationHash: string | undefined;
  let layout: Layout = MODERNBERT_BASE;
  const fpath = flag("foundation");
  if (fpath) {
    const f = JSON.parse(readFileSync(fpath, "utf8"));
    foundationHash = f.foundation_hash;
    layout = { numLayers: f.num_layers, hiddenSize: f.hidden_size, targets: f.targets };
    log.kv("foundation.json", `${f.foundation_version} ${f.foundation_hash}`);
  } else {
    log.warn("no --foundation: foundation_hash is not compared (a validator on another foundation rejects it: foundation_mismatch)");
  }

  let p;
  try {
    p = readPackage(bytes);
  } catch (e: any) {
    log.fail(`rejected: ${e.message}`);
    process.exit(1);
  }
  for (const k of ["intent", "class", "abi", "format_version", "foundation_hash", "foundation_version", "tokenizer_hash", "rank", "alpha", "target_modules", "max_tokens"]) {
    log.kv(k, p.meta[k] ?? "(missing)");
  }
  for (const k of Object.keys(p.meta).filter((k) => k.startsWith("x-") || k === "training")) log.kv(k, String(p.meta[k]).slice(0, 80));
  log.kv("tensors", p.tensors.length);

  const r = checkPackage(p, { foundationHash, cls: flag("class"), layout });
  if (r) {
    log.fail(`a node would reject it at Stage 1: ${r.message}`);
    process.exit(1);
  }
  log.ok("passes the Stage 1 rules (format, metadata, tokenizer, rank, target modules, every tensor shape, offsets, size, finite values)");

  const url = flag("url") ?? "<https:// or ipfs:// URL serving exactly these bytes>";
  const runnable = flag("runnable-url") ?? "<https:// URL of your executor>";
  log.banner("Register");
  log.kv("function", "registerWasm(bytes32,string,string,address,string)");
  log.kv("wasmHash", keccak);
  log.kv("wasmUrl", url);
  log.kv("intent", p.meta.intent);
  log.kv("feeAddress", "<your payout address, not zero>");
  log.kv("wasmRunnableUrl", runnable);
  log.step("approve the adapter bond in MACHINA first (entityBonds() on the Diamond)");
  const foundationArg = fpath ? " --foundation " + fpath : "";
  log.step(`check your executor: npm run adapter:check-executor -- --url ${runnable} --package ${file}${foundationArg}`);
}

main();
