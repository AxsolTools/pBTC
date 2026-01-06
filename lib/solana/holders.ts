import { PBTC_TOKEN_MINT } from "./connection"

interface TokenHolder {
  wallet: string
  balance: number
  rank: number
}

interface TokenAccountInfo {
  address: string // Token account address
  amount: string
  decimals: number
  uiAmount: number
  uiAmountString: string
}

/**
 * Fetch top 25 holders using Helius DAS API
 * Returns OWNER wallets (not token accounts) for proper distribution
 */
export async function getTopHolders(): Promise<TokenHolder[]> {
  const heliusApiKey = process.env.HELIUS_API_KEY

  if (!heliusApiKey) {
    console.error("[HELIUS] API key not configured")
    console.error(`[HELIUS] Environment check - HELIUS_API_KEY exists: ${!!process.env.HELIUS_API_KEY}`)
    console.error(`[HELIUS] Environment check - HELIUS_API_KEY length: ${process.env.HELIUS_API_KEY?.length || 0}`)
    console.error(`[HELIUS] All HELIUS env vars:`, Object.keys(process.env).filter(k => k.includes('HELIUS')))
    return []
  }

  console.log(`[HELIUS] API key found (length: ${heliusApiKey.length})`)

  if (!PBTC_TOKEN_MINT) {
    console.error("[HELIUS] PBTC_TOKEN_MINT not configured. Check PBTC_TOKEN_MINT environment variable.")
    return []
  }

  console.log(`[HELIUS] Fetching holders for mint: ${PBTC_TOKEN_MINT.slice(0, 8)}...`)

  try {
    // Step 1: Get largest token accounts
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "pbtc-holders",
        method: "getTokenLargestAccounts",
        params: [PBTC_TOKEN_MINT],
      }),
    })

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.error) {
      console.error("[HELIUS] RPC error:", data.error)
      throw new Error(data.error.message || "RPC error")
    }
    
    const accounts: TokenAccountInfo[] = data.result?.value || []

    if (accounts.length === 0) {
      console.log(`[HELIUS] No token accounts found for mint ${PBTC_TOKEN_MINT}`)
      console.log(`[HELIUS] This could mean: 1) Token has no holders yet, 2) Mint address is incorrect, 3) Token is on different network`)
      return []
    }

    console.log(`[HELIUS] Found ${accounts.length} token accounts for mint ${PBTC_TOKEN_MINT}`)

    // Step 2: Get owner wallets for each token account (in parallel batches)
    const top25Accounts = accounts.slice(0, 25)
    const holders: TokenHolder[] = []

    // Batch requests for efficiency (5 at a time)
    const batchSize = 5
    for (let i = 0; i < top25Accounts.length; i += batchSize) {
      const batch = top25Accounts.slice(i, i + batchSize)
      
      const ownerPromises = batch.map(async (account, batchIndex) => {
        const owner = await getTokenAccountOwner(account.address)
        if (owner) {
          return {
            wallet: owner, // Owner wallet address (for receiving distributions)
            balance: account.uiAmount || 0,
            rank: i + batchIndex + 1,
          }
        }
        return null
      })

      const batchResults = await Promise.all(ownerPromises)
      holders.push(...batchResults.filter((h): h is TokenHolder => h !== null))
    }

    console.log(`[HELIUS] Successfully fetched ${holders.length} holders for pBTC`)
    if (holders.length === 0) {
      console.warn(`[HELIUS] No holders found. Token mint: ${PBTC_TOKEN_MINT}`)
      console.warn(`[HELIUS] Verify: 1) Token exists on mainnet, 2) Token has holders, 3) Mint address is correct`)
    }
    return holders
  } catch (error) {
    console.error("[HELIUS] Failed to fetch holders:", error)
    console.error(`[HELIUS] Mint address used: ${PBTC_TOKEN_MINT}`)
    console.error(`[HELIUS] Helius API key configured: ${!!process.env.HELIUS_API_KEY}`)
    return []
  }
}

/**
 * Get owner wallet address from a token account
 */
export async function getTokenAccountOwner(tokenAccount: string): Promise<string | null> {
  const heliusApiKey = process.env.HELIUS_API_KEY

  if (!heliusApiKey) return null

  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "get-owner",
        method: "getAccountInfo",
        params: [tokenAccount, { encoding: "jsonParsed" }],
      }),
    })

    if (!response.ok) {
      console.error(`[HELIUS] getAccountInfo failed: ${response.status}`)
      return null
    }

    const data = await response.json()
    
    if (data.error) {
      console.error("[HELIUS] RPC error:", data.error)
      return null
    }
    
    const owner = data.result?.value?.data?.parsed?.info?.owner
    return owner || null
  } catch (error) {
    console.error("[HELIUS] getTokenAccountOwner error:", error)
    return null
  }
}

/**
 * Refresh holders from on-chain data
 * Called by cron job to update the holders table
 */
export async function refreshHoldersFromChain(): Promise<TokenHolder[]> {
  console.log("[HELIUS] Refreshing holders from chain...")
  const holders = await getTopHolders()
  console.log(`[HELIUS] Refreshed ${holders.length} holders`)
  return holders
}
