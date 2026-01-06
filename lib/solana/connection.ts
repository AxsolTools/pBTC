import { Connection, clusterApiUrl } from "@solana/web3.js"

// Construct Helius RPC URL from API key, or use provided URL, or fallback to mainnet
function getHeliusRpcUrl(): string {
  // First check for full RPC URL
  if (process.env.HELIUS_RPC_URL) {
    return process.env.HELIUS_RPC_URL
  }
  
  // Use the exported HELIUS_API_KEY constant (read at module level)
  if (HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  }
  
  // Fallback to public mainnet (rate limited)
  console.warn("[SOLANA] No Helius API key configured, using public RPC (rate limited)")
  return clusterApiUrl("mainnet-beta")
}

// Singleton connection instance
let connectionInstance: Connection | null = null

export function getConnection(): Connection {
  if (!connectionInstance) {
    // Compute RPC URL lazily when connection is first needed (runtime env vars available)
    const rpcUrl = getHeliusRpcUrl()
    connectionInstance = new Connection(rpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000,
    })
  }
  return connectionInstance
}

// Token addresses
export const PBTC_TOKEN_MINT = process.env.PBTC_TOKEN_MINT || ""
export const WSOL_MINT = "So11111111111111111111111111111111111111112" // Wrapped SOL (9 decimals)

// Helius API Key (read at module level like PBTC_TOKEN_MINT)
// Access process.env at runtime, not at build time
export const HELIUS_API_KEY = (() => {
  // In Next.js API routes, process.env is available at runtime
  // This function ensures it's evaluated when the module loads at runtime
  return process.env.HELIUS_API_KEY || ""
})()

// Thresholds
export const CLAIM_THRESHOLD_SOL = 0.1 // Minimum SOL required to trigger buyback
