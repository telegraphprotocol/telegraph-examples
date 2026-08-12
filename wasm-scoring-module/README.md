# WASM Scoring Module Example

A minimal, runnable pair of projects for building and testing a Telegraph
**scoring module** — the WASM program that judges how good a miner's answer
is. See [Build a Scoring Module](../../telegraph-docs/scoring/build-a-scoring-module.md)
for the full explanation of what this is and why it exists; this folder is
the code that guide walks through.

```
wasm-scoring-module/
├── rust-module/    the scoring module itself (compiles to .wasm)
└── go-tester/      a CLI that loads a .wasm module and runs it, no Telegraph code needed
```

## rust-module/ — the scoring module

A bare-bones module that scores a miner's answer by word overlap against the
ground truth (exact match scores 1.0, no overlap scores 0.0). It's a
legitimate starting point, not a toy: it implements the exact three exports
(`alloc`, `dealloc`, `rank_answer`) every real scoring module needs.

Build it:

```bash
cd rust-module
rustup target add wasm32-unknown-unknown   # once
cargo build --release --target wasm32-unknown-unknown
```

Output: `rust-module/target/wasm32-unknown-unknown/release/scoring_module.wasm`

## go-tester/ — test it before you register it

A small standalone CLI, independent of any Telegraph code, that loads a
`.wasm` file the same way the node does: write `question`/`ground_truth`/
`miner_answer` into the module's memory via its own `alloc`, then call
`rank_answer`. Uses [wazero](https://wazero.io), the same pure-Go WASM
runtime the node runs modules in.

Run it against the module you just built:

```bash
cd go-tester
go run . ../rust-module/target/wasm32-unknown-unknown/release/scoring_module.wasm \
  "What is the capital of France?" \
  "Paris is the capital of France." \
  "The capital of France is Paris"
# score: 0.8333
```

Try it with a few kinds of input before registering anything on-chain:

- The exact correct answer → should score at or near `1.0`.
- A clearly wrong or unrelated answer → should score `0.0` or near it.
- An empty string as the answer → must score exactly `0.0`.
- A reworded version of the correct answer → a good scorer still recognizes it.

## Next step

Once your module behaves sensibly, register it — see "How to submit /
register your module" in
[Build a Scoring Module](../../telegraph-docs/scoring/build-a-scoring-module.md).
