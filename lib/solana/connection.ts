import { Connection, clusterApiUrl } from "@solana/web3.js"

// Construct Helius RPC URL from API key, or use provided URL, or fallback to mainnet
function getHeliusRpcUrl(): string {
  // First check for full RPC URL
  if (process.env.HELIUS_RPC_URL) {
    return process.env.HELIUS_RPC_URL
  }
  
  // Construct from API key
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  }
  
  // Fallback to public mainnet (rate limited)
  console.warn("[SOLANA] No Helius API key configured, using public RPC (rate limited)")
  return clusterApiUrl("mainnet-beta")
}

const RPC_URL = getHeliusRpcUrl()

// Singleton connection instance
let connectionInstance: Connection | null = null

export function getConnection(): Connection {
  if (!connectionInstance) {
    connectionInstance = new Connection(RPC_URL, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000,
    })
  }
  return connectionInstance
}

// Token addresses
export const PBTC_TOKEN_MINT = process.env.PBTC_TOKEN_MINT || ""
export const WSOL_MINT = "So11111111111111111111111111111111111111112" // Wrapped SOL (9 decimals)

// Thresholds
export const CLAIM_THRESHOLD_SOL = 0 // Disabled - claim any amount > 0
