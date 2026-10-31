/**
 * Check your runnable-URL executor the way a validator's remote check does,
 * before you register.
 *
 * Sends ONE batch request with the score identity a validator sends
 * (foundation_hash, adapter_hash = the package's keccak256, tokenizer_hash,
 * input_root), then checks the reply: status, one result per item in order,
 * scores as f32 bit patterns, the identity echo, the optional input_root echo,
 * and that the same tokens give the same bits. It does not check the scores'
 * values: after the download a validator re-scores the same texts on its own
 * foundation and rejects any score that differs by a single bit.
 *
 * Usage:
 *   npm run adapter:check-executor -- --url https://your-executor.example/ --package <INTENT>.safetensors \
 *     [--foundation foundation.json | --foundation-hash <sha256>]
 */
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { log } from "../src/lib/log.js";
import { batchInputRoot, readPackage } from "./package.js";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

// Short token lists ([CLS] … [SEP], ModernBERT ids). The first and the last are
// the same input, so their bits must be equal.
const BATCH = [
  [50281, 4118, 17526, 27, 187, 18658, 436, 13814, 1818, 50282],
  [50281, 4118, 17526, 27, 187, 1276, 310, 253, 5347, 50282],
  [50281, 4118, 17526, 27, 187, 18658, 436, 13814, 1818, 50282],
];

async function main() {
  const url = flag("url");
  const pkgPath = flag("package");
  if (!url || !pkgPath) {
    log.fail("usage: npm run adapter:check-executor -- --url <runnable URL> --package <INTENT>.safetensors [--foundation foundation.json]");
    process.exit(2);
  }
  const bytes = readFileSync(pkgPath);
  const pkg = readPackage(bytes);
  const fpath = flag("foundation");
  const foundationHash = (fpath ? JSON.parse(readFileSync(fpath, "utf8")).foundation_hash : flag("foundation-hash")) ?? pkg.meta.foundation_hash;
  const ident = {
    foundation_hash: String(foundationHash).toLowerCase(),
    adapter_hash: ethers.keccak256(bytes).slice(2), // lowercase hex, no 0x
    tokenizer_hash: pkg.meta.tokenizer_hash.toLowerCase(),
    input_root: batchInputRoot(BATCH),
  };
  log.banner(`Executor check ${url}`);
  for (const [k, v] of Object.entries(ident)) log.kv(k, v);

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batch: BATCH.map((tokens) => ({ tokens })), ...ident }),
    redirect: "manual", // validators do not follow redirects
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const text = await res.text();
  log.kv("status", `${res.status} in ${secs}s (${BATCH.length} texts; a validator sends up to 30)`);
  const problems: string[] = [];
  if (res.status >= 300 && res.status < 400) problems.push("a redirect: validators do not follow it");
  if ([408, 429].includes(res.status) || res.status >= 500) problems.push(`status ${res.status}: a validator retries later and rejects after 3 failed attempts`);
  else if (res.status !== 200) problems.push(`status ${res.status}: a validator reads it as "no batch support" and rejects at once`);
  if (text.length > 64 * 1024) problems.push(`reply is ${text.length} bytes; a validator reads at most 64 KiB`);

  let body: any = {};
  try { body = JSON.parse(text); } catch { if (res.status === 200) problems.push("reply is not JSON"); }
  if (res.status === 200) {
    if (!Array.isArray(body.results)) {
      problems.push('no "results" array: a validator rejects at once (the endpoint does not implement the batch request)');
    } else if (body.results.length !== BATCH.length) {
      problems.push(`${body.results.length} results for ${BATCH.length} items`);
    } else {
      body.results.forEach((r: any, i: number) => {
        if (r.error) { problems.push(`item ${i} refused: ${r.error} (a refused public pair rejects the registration)`); return; }
        const s = r.score;
        if (!Number.isInteger(s) || s < 0 || s > 0xffffffff) { problems.push(`item ${i}: score ${s} is not f32 bits (an unsigned 32-bit integer)`); return; }
        const f = new DataView(new Uint32Array([s]).buffer).getFloat32(0, true);
        if (!Number.isFinite(f)) problems.push(`item ${i}: score bits 0x${s.toString(16)} are NaN or infinite`);
        log.kv(`item ${i}`, `${s} (0x${s.toString(16).padStart(8, "0")}, ${f})`);
      });
      if (body.results[0]?.score !== body.results[2]?.score) problems.push("the same tokens gave different bits: scoring must be deterministic");
    }
    const echo = ["foundation_hash", "adapter_hash", "tokenizer_hash"];
    if (echo.every((k) => !body[k])) {
      problems.push("no identity echo: a validator rejects a delta adapter whose executor does not echo foundation_hash / adapter_hash / tokenizer_hash");
    } else {
      for (const k of echo) {
        if (String(body[k] ?? "").toLowerCase() !== (ident as any)[k]) {
          problems.push(`echoed ${k} "${body[k]}", sent "${(ident as any)[k]}": identity echo mismatch (rejected at once)`);
        }
      }
    }
    if (body.input_root && String(body.input_root).toLowerCase() !== ident.input_root) {
      problems.push(`echoed input_root "${body.input_root}", sent "${ident.input_root}": identity echo mismatch`);
    }
  }

  if (problems.length) {
    for (const p of problems) log.fail(p);
    process.exit(1);
  }
  log.ok("the executor answers the batch request and echoes the identity it was sent");
  log.step("the values themselves are checked by the validator after the download, bit for bit");
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
