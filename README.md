# Telegraph Protocol — Examples

End-to-end examples for **every** Telegraph Protocol feature, each one a small
use case built the way a real user or agent would use it: connected to a live
node, paying real (testnet) money, and **verifying every payment and payout
on-chain**. No dev-side bypasses.

Live testnet node: `http://13.237.89.59:7044` · Chain: Base Sepolia (84532)

## What's here

| # | Feature | Scripts | Frontend |
|---|---------|---------|----------|
| 01 | **Discovery** — miner catalog, engine list, OpenAPI, health | `discovery:*` | `discovery.html` |
| 02 | **WebSocket** — EIP-191 wallet auth, live `ask`/`ask_direct`, paid Daemon signal subscriptions | `ws:*` | `websocket.html` |
| 03 | **Engine ask over x402** — auto-routed inference, pay per call | `x402:engine-ask` | `x402.html` |
| 04 | **Direct x402 inference** — weather / LLM chat / AI-text detection | `x402:weather`, `x402:chat`, `x402:detect` | `x402.html` |
| 05 | **ERC-8183 on-chain jobs** — escrow, callback contract, createJob → Terminal | `jobs:*` | `jobs.html` |
| 06 | **On-chain verification** — balances, x402 payment audit, full job audit | `verify:*` | built into pages |
| 07 | **Registration** — permissionless miner + admin collector lifecycle | `reg:miner`, `reg:collector` | — |
| 08 | **Bridge** — cross-chain `outboundMessage` → `portMessage` | `bridge:send` | — |
| — | **Daemon feed** — read the autonomous signal feed | `discovery:daemon-feed` | `daemon-feed.html` |

## Quick start

```bash
npm install
cp .env.example .env      # set AGENT_PRIVATE_KEY (and FUNDER_PRIVATE_KEY once)
npm run fund-agent        # one-time: gas + x402 USDC + escrow deposit
npm run discovery:health  # smoke test the node
```

The **agent wallet** is the identity every example acts as. It needs:
- a little Base Sepolia ETH (gas for escrow/createJob),
- Circle USDC `0x036C…` (x402 pay-per-call — gasless EIP-3009 transfers),
- protocol test USDC `0xfFC3…` escrowed in the Diamond (jobs + WS subscriptions).

`npm run fund-agent` sets all of that up from `FUNDER_PRIVATE_KEY`.

## The frontends

```bash
npm run frontend    # http://localhost:8787
```

Five small apps (plain HTML + ethers from CDN, no build step) — a launcher
plus one page per feature. Sign with MetaMask or paste a testnet key.

> The dev server forwards `/node/*` to the node same-origin, so the pages
> work against any node URL with zero CORS configuration. Everything else
> about the flows is exactly what a standalone frontend would do.
> NOTE(node-version): once the latest node CORS config is live, the pages
> can also call the node directly without the passthrough.

## Feature walkthroughs

### x402 pay-per-call (03/04)
```bash
npm run x402:weather                 # Zeus forecast, $0.01
npm run x402:chat -- "hello"         # OpenAI via dispatcher, $0.01
npm run x402:engine-ask -- "..."     # auto-routed, $0.01
npm run verify:x402                  # audit all settled payments on-chain
```
Request → `402` + `Payment-Required` challenge → sign an EIP-712
`TransferWithAuthorization` (no gas needed) → retry with `PAYMENT-SIGNATURE`
→ result. The PayAI facilitator settles the USDC transfer on-chain; the
scripts wait for it and print the Basescan link. **The EIP-712 domain
name/version must come from `accepts[].extra`** (`USDC`/`2` on Base Sepolia).

### ERC-8183 jobs (05)
```bash
npm run jobs:deploy-callback         # once: deploys TelegraphJobCallback
npm run jobs:create                  # createJob → waits for Terminal → audits
npm run verify:job -- <jobId>        # full money-flow audit any time
```
`intentId = keccak256("CHAT_COMPLETION")` (canonical intent names) or a
registered miner's intentId. On Terminal the script proves on-chain:
escrow −budget, treasury +2% (USDC), miner +98% swapped USDC→MACHINA, and
your callback contract holding the miner's answer.

### WebSocket subscriptions (02)
```bash
npm run ws:subscribe
```
Requires ≥$1.00 escrow (KnockGate checks on connect). Daemon signals arrive
in bursts each daemon cycle (2 min – 30 min depending on node build/config);
each delivery is batch-settled against your escrow at the epoch boundary —
the script snapshots escrow before/after so you can see the deduction.

### Registration (07) — run against a local node
```bash
npm run frontend                     # serves the YAMLs the node will fetch
npm run reg:miner                    # permissionless: registerMiner on-chain
npm run reg:collector                # admin key: registerCollector
npm run reg:miner -- deregister <id> # cleanup (same for reg:collector)
```
The node sees the registration event live, fetches your YAML, verifies the
sha256, schema-validates, and stores it (miners: `pending` until approved;
collectors: activated immediately and scraped on the next daemon cycle).
NOTE(node-version): match the collector YAML's `routing` block to your
node's schema — see the comment in `frontend/yaml/demo-collector.yaml`.

#### Writing your own miner YAML

Two miner YAMLs ship here, both wrapping the free, keyless Open-Meteo API so
they register and answer requests as-is:

| File | What it's for |
|---|---|
| [`frontend/yaml/demo-miner.yaml`](frontend/yaml/demo-miner.yaml) | The shortest thing that registers — the required fields and nothing else |
| [`frontend/yaml/example-miner.yaml`](frontend/yaml/example-miner.yaml) | **Annotated reference.** Every block the standard supports, commented with what it does and whether it's required — auth, rate limiting and circuit breaking, endpoints and their param contracts, intents, and the on-chain data mapping |

Start from `example-miner.yaml`, delete what you don't need, and point
`base_url` at your own API. To register it instead of the demo:

```bash
npm run frontend
MINER_YAML_FILE=frontend/yaml/example-miner.yaml \
MINER_YAML_URL=http://127.0.0.1:8787/yaml/example-miner.yaml \
MINER_INTENTS=WEATHER_CHECK,WEATHER_FORECAST \
  npm run reg:miner
```

Field-by-field reference: [YAML Configuration](https://docs.telegraphprotocol.com/docs/miners/yaml-config).

### Bridge (08)
```bash
npm run bridge:send
```
Deploys a `BridgeReceiverTestApp`, deposits destination gas, sends
`outboundMessage`, and polls the receiver for delivery. Bridging requires a
node deployment configured with the destination network — the multi-chain
local setup (`local-telegraph.sh` with two anvil chains) is the intended
environment for this example. NOTE(node-version): behaviour on the live
testnet node may change as newer node deployments roll out.

## Contract addresses (Base Sepolia)

| Contract | Address |
|---|---|
| Diamond (Port) | `0x45b0A6e07E2e15D203f3B5285945c549221f5b0a` |
| MACHINA | `0xbAd88F9F77AdCF455d8a6aC08B2d1bA2b312f3e7` |
| USDC (x402, Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| USDC (escrow/jobs, protocol) | `0xfFC3a7e0F71E9b48D8DBa86dc7d7B44aB24edD18` |
| Treasury | `0xB82E4DE09f1C43BBD9ca4907c01f1EEd65a521B9` |
| x402 receiver | `0x43Eb1B49a079a4587E0D7e8dA81035dc791c91F8` |

## Repo layout

```
src/lib/          shared: config, x402 signer, WS client, chain helpers
examples/01-08    one folder per feature, one script per flow
frontend/         launcher + one page per feature (no build step)
frontend/yaml/    miner/collector YAMLs served for registration
                  (example-miner.yaml = annotated miner reference)
contracts/        TelegraphJobCallback + BridgeReceiverTestApp (forge)
scripts/          fund-agent, serve-frontend
```
