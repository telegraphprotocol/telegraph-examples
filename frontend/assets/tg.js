/* Shared helpers for the Telegraph example frontends. */

export const ADDR = {
  diamond: "0x45b0A6e07E2e15D203f3B5285945c549221f5b0a",
  machina: "0xbAd88F9F77AdCF455d8a6aC08B2d1bA2b312f3e7",
  usdcX402: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  usdcEscrow: "0xfFC3a7e0F71E9b48D8DBa86dc7d7B44aB24edD18",
  treasury: "0xB82E4DE09f1C43BBD9ca4907c01f1EEd65a521B9",
  x402Receiver: "0x43Eb1B49a079a4587E0D7e8dA81035dc791c91F8",
};
export const BASESCAN = "https://sepolia.basescan.org";

let cfg = null;
export async function loadConfig() {
  if (!cfg) cfg = await (await fetch("/config.json")).json();
  return cfg;
}

/** All HTTP calls go same-origin through the dev server's /node passthrough. */
export const NODE = "/node";

export const $ = (sel) => document.querySelector(sel);

export function logger(el) {
  const box = typeof el === "string" ? $(el) : el;
  const line = (cls, msg) => {
    const div = document.createElement("div");
    div.className = cls;
    div.textContent = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  };
  return {
    step: (m) => line("dim", `▶ ${m}`),
    ok: (m) => line("ok", `✔ ${m}`),
    warn: (m) => line("warn", `⚠ ${m}`),
    err: (m) => line("err", `✘ ${m}`),
    sig: (m) => line("sig", `◆ ${m}`),
    json: (obj) => {
      const pre = document.createElement("div");
      pre.className = "dim";
      let s = JSON.stringify(obj, null, 2);
      if (s && s.length > 2000) s = s.slice(0, 2000) + " …";
      pre.textContent = s;
      box.appendChild(pre);
      box.scrollTop = box.scrollHeight;
    },
    clear: () => { box.innerHTML = ""; },
  };
}

export const fmtUSDC = (units) => `$${(Number(units) / 1e6).toFixed(4)}`;

/**
 * Signer that works with MetaMask when available, or a pasted testnet key.
 * Returns { address, signTypedData, signMessage, sendTx, provider } using the
 * ethers module passed in (loaded from CDN by the page).
 */
export async function makeSigner(ethers, rpcUrl, chainId, pastedKey) {
  if (pastedKey && pastedKey.trim()) {
    const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    const wallet = new ethers.Wallet(pastedKey.trim(), provider);
    return {
      kind: "key", address: wallet.address, provider,
      signTypedData: (d, t, v) => wallet.signTypedData(d, t, v),
      signMessage: (m) => wallet.signMessage(m),
      getSigner: async () => wallet,
    };
  }
  if (!window.ethereum) throw new Error("no MetaMask and no pasted key");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== chainId) {
    await provider.send("wallet_switchEthereumChain", [{ chainId: "0x" + chainId.toString(16) }]);
  }
  const signer = await provider.getSigner();
  return {
    kind: "metamask", address: await signer.getAddress(), provider,
    signTypedData: (d, t, v) => signer.signTypedData(d, t, v),
    signMessage: (m) => signer.signMessage(m),
    getSigner: async () => signer,
  };
}

/** x402: decode challenge header, sign EIP-3009, return retry header value. */
export async function signX402(ethers, signer, challengeB64, chainId) {
  const challenge = JSON.parse(atob(challengeB64));
  const accept = challenge.accepts.find((a) => a.network.startsWith("eip155:"));
  if (!accept) throw new Error("no EVM option in 402 challenge");
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: ethers.getAddress(signer.address),
    to: ethers.getAddress(accept.payTo),
    value: accept.amount,
    validAfter: String(now - 30),
    validBefore: String(now + 300),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
  };
  const signature = await signer.signTypedData(
    {
      name: accept.extra?.name ?? "USDC",
      version: accept.extra?.version ?? "2",
      chainId,
      verifyingContract: ethers.getAddress(accept.asset),
    },
    {
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" },
        { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    {
      from: authorization.from, to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  );
  const payload = {
    x402Version: 2, scheme: "exact", network: accept.network,
    accepted: accept, payload: { signature, authorization }, extensions: {},
  };
  return { header: btoa(JSON.stringify(payload)), accept, authorization };
}

/** fetch with automatic x402 payment through the /node passthrough. */
export async function fetchWithPayment(ethers, signer, chainId, url, init = {}, onEvent = () => {}) {
  const first = await fetch(url, init);
  if (first.status !== 402) return { response: first, paid: false };
  const hdr = first.headers.get("Payment-Required");
  if (!hdr) throw new Error("402 without Payment-Required header");
  const decoded = JSON.parse(atob(hdr));
  onEvent("challenge", decoded);
  const signed = await signX402(ethers, signer, hdr, chainId);
  onEvent("signed", signed);
  const retry = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), "PAYMENT-SIGNATURE": signed.header },
  });
  return { response: retry, paid: true, signed };
}

export const DIAMOND_ABI = [
  "function depositUSDC(uint256 amount)",
  "function escrowBalance(address user) view returns (uint256)",
  "function effectiveBalance(address user) view returns (uint256)",
  "function createJob(bytes32 intentId, (address[] addresses, uint256[] integers, string[] strings, bool[] bools) params, address callback) returns (uint256)",
  "function getJob(uint256 jobId) view returns ((address agent, bytes32 intentId, address callback, uint256 budget, uint256 minerPayment, uint256 protocolFee, uint8 state, uint256 createdAt))",
  "function jobsByAgent(address agent) view returns (uint256[])",
  "function getJobBasePrice() view returns (uint256)",
  "function getJobOutput(uint256 jobId) view returns (bytes32)",
  "event JobCreated(uint256 indexed jobId, address indexed agent, bytes32 intentId, address callback)",
  "event JobTerminal(uint256 indexed jobId, uint256 fee, uint256 minerPaid)",
];
export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
export const CALLBACK_ABI = [
  "function results(uint256) view returns (bool received, bool success, string firstString, string errorMessage, uint256 receivedAt)",
];
export const JOB_STATES = ["Funded", "Terminal", "Cancelled"];
