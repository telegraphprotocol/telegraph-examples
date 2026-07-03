const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", magenta: "\x1b[35m", blue: "\x1b[34m",
};

const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  banner(title: string) {
    console.log(`\n${C.bold}${C.cyan}══════ ${title} ══════${C.reset}\n`);
  },
  step(msg: string) {
    console.log(`${C.dim}[${ts()}]${C.reset} ${C.blue}▶${C.reset} ${msg}`);
  },
  ok(msg: string) {
    console.log(`${C.dim}[${ts()}]${C.reset} ${C.green}✔${C.reset} ${msg}`);
  },
  warn(msg: string) {
    console.log(`${C.dim}[${ts()}]${C.reset} ${C.yellow}⚠${C.reset} ${msg}`);
  },
  fail(msg: string) {
    console.log(`${C.dim}[${ts()}]${C.reset} ${C.red}✘${C.reset} ${msg}`);
  },
  kv(key: string, value: unknown) {
    console.log(`   ${C.dim}${key.padEnd(22)}${C.reset} ${value}`);
  },
  json(obj: unknown, maxLen = 1200) {
    let s = JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    if (s.length > maxLen) s = s.slice(0, maxLen) + `\n   … (${s.length - maxLen} more chars)`;
    console.log(s.split("\n").map((l) => `   ${C.dim}${l}${C.reset}`).join("\n"));
  },
  signal(msg: string) {
    console.log(`${C.dim}[${ts()}]${C.reset} ${C.magenta}◆ SIGNAL${C.reset} ${msg}`);
  },
};
