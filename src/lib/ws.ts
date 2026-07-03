import WebSocket from "ws";
import { ethers } from "ethers";
import { log } from "./log.js";

export interface WSMessage<T = any> {
  type: string;
  data?: T;
  timestamp?: string;
  [k: string]: unknown;
}

/**
 * Thin client over the Telegraph Engine WebSocket.
 *
 * Anonymous connections can use: ask, ask_direct, list_subnets, ping.
 * Wallet-authenticated connections (EIP-191 challenge/response + ≥$1 USDC in
 * the Diamond escrow) additionally unlock: subscribe / unsubscribe /
 * list_subscriptions, with pushed Daemon signals settled against escrow.
 */
export class TelegraphWS {
  private ws!: WebSocket;
  private listeners: ((msg: WSMessage) => void)[] = [];
  public verbose: boolean;

  constructor(private url: string, verbose = true) {
    this.verbose = verbose;
  }

  /** Connect; pass walletAddress to enable the wallet-auth handshake. */
  connect(walletAddress?: string): Promise<void> {
    const url = walletAddress ? `${this.url}?wallet_address=${walletAddress}` : this.url;
    this.ws = new WebSocket(url);

    this.ws.on("message", (raw) => {
      let msg: WSMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (this.verbose && msg.type !== "pong") log.step(`⇦ ${msg.type}`);
      for (const fn of [...this.listeners]) fn(msg);
    });

    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(obj: Record<string, unknown>) {
    if (this.verbose) log.step(`⇨ ${obj.action}`);
    this.ws.send(JSON.stringify(obj));
  }

  onMessage(fn: (msg: WSMessage) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  /** Wait for the next message of one of the given types. */
  waitFor(types: string[], timeoutMs = 60_000): Promise<WSMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out after ${timeoutMs / 1000}s waiting for: ${types.join("|")}`));
      }, timeoutMs);
      const off = this.onMessage((msg) => {
        if (types.includes(msg.type)) {
          clearTimeout(timer);
          off();
          resolve(msg);
        }
      });
    });
  }

  /**
   * EIP-191 wallet ownership handshake:
   * auth_wallet → wallet_challenge → personal_sign → wallet_verify → wallet_verified → connected.
   * Requires the connection to have been opened with ?wallet_address=.
   */
  async authenticate(privateKey: string): Promise<void> {
    const wallet = new ethers.Wallet(privateKey);
    this.send({ action: "auth_wallet" });
    const challenge = await this.waitFor(["wallet_challenge", "error"], 20_000);
    if (challenge.type === "error") throw new Error(`auth failed: ${JSON.stringify(challenge.data)}`);

    const message: string = (challenge.data as any).message;
    const signature = wallet.signMessageSync(message);
    this.send({ action: "wallet_verify", signature });

    const verified = await this.waitFor(["wallet_verified", "error"], 20_000);
    if (verified.type === "error") throw new Error(`verify failed: ${JSON.stringify(verified.data)}`);
    await this.waitFor(["connected"], 20_000);
  }

  startPing(intervalMs = 30_000): NodeJS.Timeout {
    return setInterval(() => this.ws?.readyState === WebSocket.OPEN && this.send({ action: "ping" }), intervalMs);
  }

  close() { this.ws?.close(); }
}
