/**
 * Read an Evaluator adapter package (a safetensors delta for the shared
 * Foundation Model) and check it against the rules a Telegraph node applies at
 * Stage 1 (the node's pkg/wasm/runtime/lora_adapter.go). This is a pre-flight
 * for examples only: the authoritative check is `adapterbuild lora` in the
 * adapter kit, which runs the node's own parser.
 */
import { createHash } from "node:crypto";

/** The tokenizer every package must name: sha256 of ModernBERT-base's tokenizer.json. */
export const NODE_TOKENIZER_SHA256 = "67bc76f8b9386efba1a761c1c8e5ad439fd0eaf1c2826e9dd1a205c7af4dc456";
export const R_MAX = 16;
export const MAX_TOKENS = 512;
/** ADAPTER_LORA_MAX_BYTES default on a node (64 MiB). */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const TARGET_MODULES = ["Wi", "Wo", "Wqkv"];
export const TARGETS = ["attn.Wqkv", "attn.Wo", "mlp.Wi", "mlp.Wo"];

/** The LoRA layout of the ModernBERT-base foundation (foundation.json "targets"). */
export const MODERNBERT_BASE = {
  numLayers: 22,
  hiddenSize: 768,
  targets: { "attn.Wqkv": [768, 2304], "attn.Wo": [768, 768], "mlp.Wi": [768, 2304], "mlp.Wo": [1152, 768] } as Record<string, [number, number]>,
};
export type Layout = typeof MODERNBERT_BASE;

const KNOWN_KEYS = new Set(["format_version", "abi", "class", "intent", "foundation_hash", "foundation_version",
  "tokenizer_hash", "rank", "alpha", "target_modules", "max_tokens", "training"]);
const REQUIRED_KEYS = [...KNOWN_KEYS].filter((k) => k !== "training");

export interface Tensor { name: string; dtype: string; shape: number[]; begin: number; end: number }

export interface Package {
  bytes: Buffer;
  meta: Record<string, string>;
  tensors: Tensor[];
  dataStart: number;
}

export class Reject extends Error {
  constructor(public reason: string, detail: string) { super(`${reason}: ${detail}`); }
}

/** Parse the safetensors container: u64 LE header length | JSON header | tensor bytes. */
export function readPackage(bytes: Buffer): Package {
  if (bytes.length < 9) throw new Reject("bad_container", `${bytes.length} bytes, shorter than a safetensors header`);
  const hl = Number(bytes.readBigUInt64LE(0));
  if (hl === 0 || hl > 1 << 20) throw new Reject("bad_container", `safetensors header length ${hl}`);
  if (bytes.length < 8 + hl) throw new Reject("truncated", "safetensors header runs past the end of the file");
  let header: Record<string, any>;
  try {
    header = JSON.parse(bytes.subarray(8, 8 + hl).toString("utf8"));
  } catch (e) {
    throw new Reject("bad_container", `safetensors header is not JSON: ${e}`);
  }
  const meta = header.__metadata__;
  if (!meta || typeof meta !== "object") throw new Reject("missing_metadata", "no __metadata__ in the safetensors header");
  const tensors: Tensor[] = Object.entries(header)
    .filter(([k]) => k !== "__metadata__")
    .map(([name, v]: [string, any]) => ({ name, dtype: v.dtype, shape: v.shape, begin: v.data_offsets?.[0], end: v.data_offsets?.[1] }))
    .sort((a, b) => a.begin - b.begin || (a.name < b.name ? -1 : 1));
  return { bytes, meta, tensors, dataStart: 8 + hl };
}

/** What a package must match on a validator. Empty strings skip that comparison. */
export interface Expect { foundationHash?: string; tokenizerHash?: string; cls?: string; layout?: Layout; maxBytes?: number }

/** Every Stage 1 rule, in the node's order. Returns the first rejection, or null. */
export function checkPackage(p: Package, want: Expect = {}): Reject | null {
  try {
    const maxBytes = want.maxBytes ?? DEFAULT_MAX_BYTES;
    if (p.bytes.length > maxBytes) throw new Reject("too_large", `${p.bytes.length} bytes, above the ${maxBytes} byte cap`);
    const m = p.meta;
    for (const k of REQUIRED_KEYS) if (!(k in m)) throw new Reject("missing_metadata", `__metadata__ has no ${k}`);
    for (const k of Object.keys(m)) {
      if (!KNOWN_KEYS.has(k) && !k.startsWith("x-")) throw new Reject("bad_header", `unknown metadata key "${k}" (extension keys start with x-)`);
    }
    if (m.format_version !== "1") throw new Reject("bad_version", `format_version "${m.format_version}", nodes read 1`);
    if (m.abi !== "lora-v1") throw new Reject("bad_abi", `abi "${m.abi}", nodes run "lora-v1"`);
    if (want.foundationHash && m.foundation_hash.toLowerCase() !== want.foundationHash.toLowerCase()) {
      throw new Reject("foundation_mismatch", `built for foundation ${m.foundation_hash}, expected ${want.foundationHash}`);
    }
    const tok = want.tokenizerHash ?? NODE_TOKENIZER_SHA256;
    if (m.tokenizer_hash.toLowerCase() !== tok.toLowerCase()) throw new Reject("tokenizer_mismatch", `built for tokenizer ${m.tokenizer_hash}, nodes use ${tok}`);
    if (m.class !== "judgment" && m.class !== "hybrid") throw new Reject("class_mismatch", `class "${m.class}"; an Evaluator adapter is judgment or hybrid`);
    if (want.cls && m.class !== want.cls) throw new Reject("class_mismatch", `class "${m.class}", the intent needs "${want.cls}"`);
    if (!m.intent) throw new Reject("bad_header", "intent is empty");
    const rank = Number(m.rank);
    if (!Number.isInteger(rank) || rank <= 0 || rank > R_MAX) throw new Reject("rank_too_large", `rank ${m.rank}, the foundation takes 1..${R_MAX}`);
    const alpha = Number(m.alpha);
    if (!(alpha > 0) || !Number.isFinite(alpha)) throw new Reject("bad_header", `alpha ${m.alpha} is not a positive finite number`);
    let mods: unknown;
    try { mods = JSON.parse(m.target_modules); } catch { mods = null; }
    if (!Array.isArray(mods) || mods.length === 0) throw new Reject("bad_target_module", `target_modules ${m.target_modules} is not a non-empty JSON array`);
    if (new Set(mods).size !== mods.length || mods.some((x) => !TARGET_MODULES.includes(x))) {
      throw new Reject("bad_target_module", `target modules ${m.target_modules} (allowed, once each: ${TARGET_MODULES.join(", ")})`);
    }
    const maxTok = Number(m.max_tokens);
    if (!Number.isInteger(maxTok) || maxTok < 1 || maxTok > MAX_TOKENS) throw new Reject("bad_max_tokens", `max_tokens ${m.max_tokens} is outside 1..${MAX_TOKENS}`);
    if ("training" in m) {
      try { JSON.parse(m.training); } catch (e) { throw new Reject("training_record", String(e)); }
    }
    checkTensors(p, rank, want.layout ?? MODERNBERT_BASE);
    return null;
  } catch (e) {
    if (e instanceof Reject) return e;
    throw e;
  }
}

/** The exact tensor set for rank r, tiled contiguously, F32, finite. */
function checkTensors(p: Package, rank: number, l: Layout) {
  const want = new Map<string, number[]>();
  for (let i = 0; i < l.numLayers; i++) {
    for (const t of TARGETS) {
      const [inDim, outDim] = l.targets[t];
      want.set(`lora.${i}.${t}.A`, [inDim, rank]);
      want.set(`lora.${i}.${t}.B`, [rank, outDim]);
    }
  }
  want.set("head.weight", [l.hiddenSize, 1]);
  want.set("head.bias", [1]);
  if (p.tensors.length !== want.size) throw new Reject("bad_shape", `${p.tensors.length} tensors, the foundation needs ${want.size}`);
  const data = p.bytes.subarray(p.dataStart);
  let off = 0;
  const seen = new Set<string>();
  for (const t of p.tensors) {
    const shape = want.get(t.name);
    if (!shape || seen.has(t.name)) throw new Reject("bad_shape", `unexpected or repeated tensor "${t.name}"`);
    seen.add(t.name);
    if (t.dtype !== "F32") throw new Reject("bad_dtype", `tensor ${t.name} has dtype "${t.dtype}", want F32`);
    if (JSON.stringify(t.shape) !== JSON.stringify(shape)) throw new Reject("bad_shape", `tensor ${t.name} shape ${JSON.stringify(t.shape)}, want ${JSON.stringify(shape)}`);
    const n = 4 * shape.reduce((a, b) => a * b, 1);
    if (t.end - t.begin !== n) throw new Reject("bad_offsets", `tensor ${t.name} spans ${t.end - t.begin} bytes, its shape needs ${n}`);
    if (t.begin !== off) throw new Reject("bad_offsets", `tensor ${t.name} at offset ${t.begin}, expected ${off}`);
    if (t.end > data.length) throw new Reject("truncated", `tensor ${t.name} ends at ${t.end}, the data is ${data.length} bytes`);
    off = t.end;
  }
  if (off !== data.length) throw new Reject("trailing_bytes", `${data.length - off} bytes after the last tensor`);
  for (let i = 0; i + 4 <= data.length; i += 4) {
    if (!Number.isFinite(data.readFloatLE(i))) throw new Reject("non_finite", `non-finite value at data offset ${i}`);
  }
}

export const sha256Hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** The node's input encoding for one token list (runtime.EncodeFloatInput). */
export function encodeInput(ids: number[]): string {
  return `{"input_ids":[${ids.join(",")}],"attention_mask":[${ids.map(() => "1").join(",")}]}`;
}

/** remote.BatchInputRoot: sha256 of the sorted "<index>:<sha256(input)>" lines. */
export function batchInputRoot(batch: number[][]): string {
  if (batch.length === 0) return "";
  const leaves = batch.map((ids, i) => `${i}:${sha256Hex(encodeInput(ids))}`).sort();
  return sha256Hex(leaves.join("\n"));
}
