# Evaluator Adapter Example

Two pre-flight tools for an **Evaluator adapter**: the scoring module of a judgment or
hybrid intent. Since the shared Foundation Model, an adapter is a **safetensors delta
package** (a few MB of LoRA deltas and a reward head) that every validator runs on the same
Foundation Model. You build it with the adapter kit,
[telegraph-wasm-baseline](https://github.com/telegraphprotocol/telegraph-wasm-baseline);
these scripts check the two things you then put on chain, the package and your executor,
before you pay for a registration.

```
evaluator-adapter/
├── package.ts           the package format and the node's Stage 1 rules, in TypeScript
├── inspect-package.ts   npm run adapter:inspect: check a package, print its keccak256 and the registerWasm arguments
└── check-executor.ts    npm run adapter:check-executor: send your runnable URL the request a validator sends
```

Guide: [Train an Evaluator Adapter](https://docs.telegraphprotocol.com/docs/scoring/train-a-scoring-adapter).
Upgrading a full-model adapter:
[Upgrading to the shared Foundation Model](https://docs.telegraphprotocol.com/docs/scoring/upgrade-shared-foundation).

> **Full-model `.wasm` adapters are no longer accepted.** The earlier format (the whole
> ~600 MB model baked into a WASI command) is rejected at registration with
> `legacy_full_model`, and an Active one is taken out of service when a validator upgrades.
> Re-export the delta from the original training run with the kit's `export_adapter.py` and
> register it again.

## 1. Inspect the package

```bash
npm run adapter:inspect -- runs/CODE_REVIEW/CODE_REVIEW.safetensors \
  --foundation foundation/foundation.json --class judgment
```

It prints the metadata, the **keccak256** (the hash you register, not the sha256), and the
first Stage 1 rule the package breaks, with the node's reason name (`foundation_mismatch`,
`tokenizer_mismatch`, `class_mismatch`, `rank_too_large`, `bad_target_module`, `bad_shape`,
`bad_offsets`, `trailing_bytes`, `truncated`, `non_finite`, `too_large`, `bad_max_tokens`,
`bad_header`, `bad_abi`, `bad_version`, `bad_container`, `missing_metadata`). It is a quick
check; the kit's `adapterbuild lora` runs the node's own parser and is authoritative.

What a package must hold (the node's `pkg/wasm/runtime/lora_adapter.go`):

- `__metadata__` (every value a string): `format_version` `"1"`, `abi` `"lora-v1"`,
  `class` (`judgment` or `hybrid`, the intent's class), `intent`, `foundation_hash`,
  `foundation_version`, `tokenizer_hash`, `rank` (1 to 16), `alpha`, `target_modules` (a
  JSON array of `Wqkv`, `Wo`, `Wi`), `max_tokens` (1 to 512), optional `training`, optional
  `x-*` keys. Any other key is refused.
- Tensors, all `F32`, tiling the data exactly: `lora.<l>.<target>.A` `[in, r]` and `.B`
  `[r, out]` for `attn.Wqkv`, `attn.Wo`, `mlp.Wi`, `mlp.Wo` in each of the 22 layers, plus
  `head.weight` `[768, 1]` and `head.bias` `[1]`: 178 tensors.
- At most 64 MiB (a validator's `ADAPTER_LORA_MAX_BYTES`). A rank-8 package is 6.8 MB.
- `tokenizer_hash` `67bc76f8b9386efba1a761c1c8e5ad439fd0eaf1c2826e9dd1a205c7af4dc456`, and
  the `foundation_hash` of the Foundation Model validators run. The foundation and its
  `foundation.json` are not published yet: the Telegraph team will publish them at a public
  location announced with the deploy. Without `--foundation` the script does not compare
  the foundation hash.

## 2. Check your executor

Every registration needs a `wasmRunnableUrl`. A validator calls it **before** downloading
your package, with 15 public evaluation pairs (up to 30 texts) in one request, and later
re-scores the same texts itself: every score must match bit for bit. So the executor has to
run your package on the same Foundation Model and engine the validators run.

```bash
npm run adapter:check-executor -- --url https://your-executor.example/ \
  --package runs/CODE_REVIEW/CODE_REVIEW.safetensors --foundation foundation/foundation.json
```

It sends three short token lists with the identity a validator sends and checks the reply.

**Request** (`POST`, JSON):

```json
{
  "batch": [{"tokens": [50281, 4118, 17526, 27, 187, 18658, 436, 13814, 1818, 50282]}],
  "foundation_hash": "<sha256 of the validator's foundation graph>",
  "adapter_hash": "<the registered keccak256, lowercase hex, no 0x>",
  "tokenizer_hash": "<sha256 of the validator's tokenizer.json>",
  "input_root": "<sha256 of the sorted \"<index>:<sha256 of the item's input JSON>\" lines>"
}
```

**Reply** (`200`):

```json
{
  "results": [{"score": 3204838382}],
  "foundation_hash": "<the foundation you scored with>",
  "adapter_hash": "<the keccak256 of the package you scored with>",
  "tokenizer_hash": "<that package's tokenizer hash>",
  "input_root": "<optional: the root of the tokens you received>"
}
```

- One result per item, in order: `{"score": N}`, the f32 bit pattern of the reward logit as
  an unsigned 32-bit integer (`3204838382` is `0xbf05f3ee`), or `{"error": "..."}`.
- Echo the identity you actually scored with. A different echo rejects the registration at
  once (`identity echo mismatch`); a missing echo rejects it after the download (`its
  runnable URL did not echo the score identity`).
- `4xx`, or a `200` without `results`, is rejected at once; `408`, `429` and `5xx` are
  retried at the next epoch rollover or within the hour, and rejected after 3 failed
  attempts. Replies over 64 KiB are refused. Redirects are not followed, and in production
  validators refuse loopback, private and link-local addresses.
- The whole check must finish within 30 minutes (`WASM_REMOTE_EVAL_BUDGET`). On a laptop
  CPU one 512-token text takes 13-14 s on the foundation, so 30 texts take about 7 minutes.

The reference executor is the adapter kit's [`cmd/adapterexec`](https://github.com/telegraphprotocol/telegraph-wasm-baseline/tree/main/cmd/adapterexec): it runs the foundation and your
package with the node's own runtime, so its bits match the validators'.

## 3. Register

`inspect-package` prints the arguments of
`registerWasm(bytes32 wasmHash, string wasmUrl, string intent, address feeAddress, string wasmRunnableUrl)`.
Host the package unchanged at an `https://` or `ipfs://` URL, approve the adapter bond in
MACHINA (`entityBonds()` on the Diamond; released in full when you deregister), and register
on the family prefix. Then follow the registration on `GET /api/wasm/<registrationId>`: it
stays `pending` while it waits for the first confirmed epoch after the registration, then
for the remote check, the download and Stage 1, the local confirmation and the competition
round on the hidden evaluation split. Expect tens of minutes on top of the epoch wait.
