/**
 * Static server + same-origin passthrough for the example frontends.
 *
 * Serves frontend/ on http://localhost:8787 and forwards anything under
 * /node/* verbatim to NODE_URL, so the pages work against any node URL with
 * zero CORS friction. No keys are involved; it forwards bytes.
 * NOTE(node-version): with the latest node CORS config deployed, pages can
 * also call the node directly and the passthrough becomes optional.
 *
 * GET /config.json exposes NODE_URL / WS_URL / RPC_URL / chain id to the
 * pages (never private keys).
 */
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/lib/config.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../frontend");
const port = parseInt(process.env.FRONTEND_PORT ?? "8787", 10);

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (url.pathname === "/config.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      nodeUrl: config.nodeUrl, wsUrl: config.wsUrl,
      rpcUrl: config.rpcUrl, chainId: config.chainId,
    }));
    return;
  }

  if (url.pathname.startsWith("/node/")) {
    const target = new URL(config.nodeUrl + url.pathname.slice("/node".length) + url.search);
    const headers = { ...req.headers, host: target.host };
    delete headers["origin"]; delete headers["referer"];
    const proxied = httpRequest(target, { method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    proxied.on("error", (e) => { res.writeHead(502); res.end(`upstream error: ${e.message}`); });
    req.pipe(proxied);
    return;
  }

  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(port, () => {
  console.log(`Telegraph example frontends → http://localhost:${port}`);
  console.log(`Passthrough /node/* → ${config.nodeUrl}`);
});
