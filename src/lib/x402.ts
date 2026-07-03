import { ethers } from "ethers";
import { log } from "./log.js";

/**
 * x402 client for Telegraph nodes.
 *
 * Flow (x402 v2, "exact" scheme on EVM):
 *   1. Request without payment  → HTTP 402 + base64 challenge in `Payment-Required` header
 *   2. Pick the eip155 option from `accepts[]`
 *   3. Sign an EIP-3009 TransferWithAuthorization (EIP-712 typed data) for the
 *      exact USDC amount to the node's receiving address. No gas needed — the
 *      PayAI facilitator submits the transfer on-chain.
 *   4. Retry the same request with the signed payload base64-encoded in the
 *      `PAYMENT-SIGNATURE` header.
 *
 * The EIP-712 domain (name/version) MUST come from `accepts[].extra` — Base
 * Sepolia USDC uses name "USDC", version "2".
 */

export interface X402Accept {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string; [k: string]: unknown };
}

export interface X402Challenge {
  x402Version: number;
  error?: string;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: X402Accept[];
}

export function decodeChallenge(header: string): X402Challenge {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

export interface SignedPayment {
  header: string;               // base64 PAYMENT-SIGNATURE value
  authorization: {
    from: string; to: string; value: string;
    validAfter: string; validBefore: string; nonce: string;
  };
  accept: X402Accept;
}

/** Sign the EVM (eip155) option of a 402 challenge with an ethers wallet. */
export async function signPayment(challenge: X402Challenge, wallet: ethers.Wallet, chainId: number): Promise<SignedPayment> {
  const accept = challenge.accepts.find((a) => a.network.startsWith("eip155:"));
  if (!accept) throw new Error("no eip155 payment option in 402 challenge");

  const acceptChainId = parseInt(accept.network.split(":")[1], 10);
  if (acceptChainId !== chainId) {
    throw new Error(`challenge chain ${acceptChainId} != configured chain ${chainId}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: ethers.getAddress(wallet.address),
    to: ethers.getAddress(accept.payTo),
    value: accept.amount,
    validAfter: String(now - 30),
    validBefore: String(now + Math.max(accept.maxTimeoutSeconds ?? 60, 300)),
    nonce: ethers.hexlify(ethers.randomBytes(32)),
  };

  const domain = {
    name: accept.extra?.name ?? "USDC",
    version: accept.extra?.version ?? "2",
    chainId: acceptChainId,
    verifyingContract: ethers.getAddress(accept.asset),
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const signature = await wallet.signTypedData(domain, types, {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  });

  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: accept.network,
    accepted: accept,
    payload: { signature, authorization },
    extensions: {},
  };

  return {
    header: Buffer.from(JSON.stringify(payload)).toString("base64"),
    authorization,
    accept,
  };
}

export interface X402Result {
  response: Response;
  paid: boolean;
  payment?: SignedPayment;
  settleHeader?: string;        // x-payment-settle-response (audit trail)
}

/**
 * fetch() with automatic x402 payment. Makes the request; on 402, signs the
 * challenge and retries once with the PAYMENT-SIGNATURE header.
 */
export async function fetchWithPayment(
  url: string,
  init: RequestInit,
  wallet: ethers.Wallet,
  chainId: number,
  quiet = false,
): Promise<X402Result> {
  const first = await fetch(url, init);
  if (first.status !== 402) {
    return { response: first, paid: false };
  }

  const header = first.headers.get("Payment-Required") ?? first.headers.get("payment-required");
  if (!header) throw new Error("402 response without Payment-Required header");

  const challenge = decodeChallenge(header);
  const evm = challenge.accepts.find((a) => a.network.startsWith("eip155:"));
  if (!quiet) {
    log.step(`402 Payment Required — ${challenge.resource?.description ?? url}`);
    log.kv("amount", `${evm?.amount} units (= $${(Number(evm?.amount) / 1e6).toFixed(4)} USDC)`);
    log.kv("payTo", evm?.payTo);
    log.kv("asset", evm?.asset);
    log.kv("network", evm?.network);
  }

  const payment = await signPayment(challenge, wallet, chainId);
  if (!quiet) {
    log.step("signed EIP-3009 TransferWithAuthorization — retrying with PAYMENT-SIGNATURE header");
    log.kv("payer", payment.authorization.from);
    log.kv("nonce", payment.authorization.nonce);
  }

  const retry = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), "PAYMENT-SIGNATURE": payment.header },
  });

  const settleHeader =
    retry.headers.get("x-payment-settle-response") ??
    retry.headers.get("X-Payment-Settle-Response") ??
    undefined;

  return { response: retry, paid: true, payment, settleHeader };
}
