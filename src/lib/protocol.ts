import { ethers } from "ethers";

/** Live contract addresses on Base Sepolia (chain 84532). */
export const ADDRESSES = {
  diamond: "0x45b0A6e07E2e15D203f3B5285945c549221f5b0a",
  machina: "0xbAd88F9F77AdCF455d8a6aC08B2d1bA2b312f3e7",
  /** Circle's canonical Base Sepolia USDC — used by the x402 payment gate. */
  usdcX402: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  /** Protocol test USDC — used by Diamond escrow, ERC-8183 jobs and settlement. */
  usdcEscrow: "0xfFC3a7e0F71E9b48D8DBa86dc7d7B44aB24edD18",
  treasury: "0xB82E4DE09f1C43BBD9ca4907c01f1EEd65a521B9",
  x402Receiver: "0x43Eb1B49a079a4587E0D7e8dA81035dc791c91F8",
} as const;

export const BASESCAN = "https://sepolia.basescan.org";

/**
 * Canonical Intent names. An ERC-8183 job targets an intentId which the node
 * resolves to a miner. Two forms work:
 *   1. keccak256(canonical intent name)  — routed via the intent map
 *   2. a registered miner's intentId     — from MinerRegistryFacet.getMiner()
 */
export const CANONICAL_INTENTS = [
  "LANGUAGE_GENERATION", "CHAT_COMPLETION", "TEXT_GENERATION",
  "WEATHER_CHECK", "STORM_ALERT", "WEATHER_FORECAST", "WEATHER_RISK_ASSESSMENT",
  "MULTIMODAL_INFERENCE", "IMAGE_GENERATION", "TEXT_TO_IMAGE",
  "TASK_COMPLETION", "AGENT_TASK",
  "WEB_SEARCH", "TWITTER_SEARCH", "NEWS_SEARCH", "RESEARCH_SYNTHESIS", "FACT_CHECK",
  "TEXT_AUTHENTICITY_CHECK", "AI_TEXT_DETECTION", "CONTENT_VERIFICATION",
  "DEEPFAKE_DETECTION", "MEDIA_AUTHENTICITY_CHECK", "IMAGE_VERIFICATION", "VIDEO_VERIFICATION",
  "HIGH_PERFORMANCE_INFERENCE", "CONTENT_MODERATION",
] as const;

export function intentIdFor(intentName: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(intentName));
}

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

export const DIAMOND_ABI = [
  // EscrowFacet
  "function depositUSDC(uint256 amount)",
  "function requestWithdraw(uint256 amount)",
  "function executeWithdraw()",
  "function escrowBalance(address user) view returns (uint256)",
  "function effectiveBalance(address user) view returns (uint256)",
  "event Deposited(address indexed user, uint256 amount)",
  "event WithdrawRequested(address indexed user, uint256 amount, uint256 unlockTime)",

  // JobFacet (ERC-8183)
  "function createJob(bytes32 intentId, (address[] addresses, uint256[] integers, string[] strings, bool[] bools) params, address callback) returns (uint256 jobId)",
  "function cancelJob(uint256 jobId)",
  "function getJob(uint256 jobId) view returns ((address agent, bytes32 intentId, address callback, uint256 budget, uint256 minerPayment, uint256 protocolFee, uint8 state, uint256 createdAt))",
  "function getJobOutput(uint256 jobId) view returns (bytes32)",
  "function jobsByAgent(address agent) view returns (uint256[])",
  "function jobCount() view returns (uint256)",
  "function getJobBasePrice() view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed agent, bytes32 intentId, address callback)",
  "event JobTerminal(uint256 indexed jobId, uint256 fee, uint256 minerPaid)",
  "event JobCancelled(uint256 indexed jobId)",

  // MinerRegistryFacet
  "function minerCount() view returns (uint256)",
  "function getMiner(uint256 registrationId) view returns (address miner, string yamlUrl, bytes32 yamlHash, bool active, bytes32 intentId, address feeAddress, uint256 minPriceUsdc, string[] supportedIntents)",
  "function getCanonicalIntents() view returns (string[])",

  // SettlementFacet views + events
  "function epochSettled(uint256 epochId) view returns (bool)",
  "function epochTotalUSDC(uint256 epochId) view returns (uint256)",
  "function epochTotalMachina(uint256 epochId) view returns (uint256)",
  "event EpochSubmitted(uint256 indexed epochId, bytes32 merkleRoot, uint256 totalUSDC, uint256 totalMachina)",
  "event USDCSwapped(uint256 usdcIn, uint256 machinaOut, uint256 indexed epochId)",
  "event BalanceDeducted(address indexed agent, uint256 amount, uint256 indexed epochId)",

  // Treasury view
  "function getTreasury() view returns (address)",
];

export const JOB_STATES = ["Funded", "Terminal", "Cancelled"] as const;

export function fmtUSDC(units: bigint | number | string): string {
  const n = BigInt(units);
  return `$${(Number(n) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0")}`;
}

export function fmtMachina(wei: bigint | number | string): string {
  return `${ethers.formatEther(BigInt(wei))} MACHINA`;
}
