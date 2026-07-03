/**
 * Discovery: read the Daemon's autonomously generated signal feed.
 *
 * The Daemon scrapes real-world sources on a cycle, asks the Engine about
 * what it finds, and stores the results. This reads that feed — no payment,
 * no auth, plain GETs. (To *receive* these live, see examples/02-websocket.)
 *
 * Usage:
 *   npm run discovery:daemon-feed                        # latest signals
 *   npm run discovery:daemon-feed -- --category CLIMATE  # filter by category
 *   npm run discovery:daemon-feed -- --top               # hottest last 24h
 *   npm run discovery:daemon-feed -- --min-interest 7
 */
import { config } from "../../src/lib/config.js";
import { log } from "../../src/lib/log.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const top = process.argv.includes("--top");
  const params = new URLSearchParams();
  if (arg("category")) params.set("category", arg("category")!);
  if (arg("source")) params.set("source", arg("source")!);
  if (arg("min-interest")) params.set("min_interest", arg("min-interest")!);
  params.set("limit", arg("limit") ?? "10");
  if (top) params.set("since_hours", arg("since-hours") ?? "24");

  const url = top
    ? `${config.daemonUrl}/api/questions/top?${params}`
    : `${config.daemonUrl}/api/questions?${params}`;

  log.banner(top ? "Top Daemon signals by interest" : "Latest Daemon signals");
  log.kv("url", url);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const results: any[] = body.results ?? [];
  log.ok(`showing ${results.length} of ${body.total ?? "?"} signals\n`);

  for (const r of results) {
    const q = r.question ?? {};
    const routing = r.routing ?? {};
    const exec = r.execution ?? {};
    console.log(`  ◆ [${q.category ?? "?"}] interest ${q.interest_score ?? "?"} — ${q.text}`);
    console.log(`    source: ${r.source}   status: ${r.status}   at: ${r.created_at}`);
    if (routing.subnet_name) console.log(`    routed → ${routing.subnet_name} (${routing.intent ?? "?"})`);
    if (exec.cost_usd != null) console.log(`    cost: $${exec.cost_usd}   duration: ${exec.duration_ms}ms`);
    const resultStr = JSON.stringify(exec.result ?? "").slice(0, 140);
    if (resultStr && resultStr !== '""') console.log(`    result: ${resultStr}…`);
    console.log();
  }
}

main().catch((e) => { log.fail(String(e?.message ?? e)); process.exit(1); });
