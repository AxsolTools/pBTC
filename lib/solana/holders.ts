import { PBTC_TOKEN_MINT, HELIUS_API_KEY } from "./connection"

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
  if (!HELIUS_API_KEY) {
    console.error("[HELIUS] API key not configured")
    return []
  }

  console.log(`[HELIUS] API key found (length: ${HELIUS_API_KEY.length})`)

  if (!PBTC_TOKEN_MINT) {
    console.error("[HELIUS] PBTC_TOKEN_MINT not configured. Check PBTC_TOKEN_MINT environment variable.")
    return []
  }

  console.log(`[HELIUS] Fetching holders for mint: ${PBTC_TOKEN_MINT.slice(0, 8)}...`)

  try {
    // Step 1: Get largest token accounts with retry logic
    const response = await retryWithBackoff(async () => {
      const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "pbtc-holders",
          method: "getTokenLargestAccounts",
          params: [PBTC_TOKEN_MINT],
        }),
      })

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error(`Helius API rate limit: ${res.status}`)
        }
        throw new Error(`Helius API error: ${res.status}`)
      }

      const data = await res.json()
      
      if (data.error) {
        if (data.error.code === -32005 || res.status === 429) {
          throw new Error(`Helius API rate limit: ${data.error.message || "429"}`)
        }
        throw new Error(data.error.message || "RPC error")
      }
      
      return data
    })

    if (!response) {
      console.error("[HELIUS] Failed to fetch token accounts after retries")
      return []
    }

    const data = response
    
    const accounts: TokenAccountInfo[] = data.result?.value || []

    if (accounts.length === 0) {
      console.log(`[HELIUS] No token accounts found for mint ${PBTC_TOKEN_MINT}`)
      console.log(`[HELIUS] This could mean: 1) Token has no holders yet, 2) Mint address is incorrect, 3) Token is on different network`)
      return []
    }

    console.log(`[HELIUS] Found ${accounts.length} token accounts for mint ${PBTC_TOKEN_MINT}`)

    // Step 2: Get owner wallets for each token account (in smaller batches with delays)
    const top25Accounts = accounts.slice(0, 25)
    const holders: TokenHolder[] = []

    // Smaller batch size and add delays to avoid rate limiting
    const batchSize = 3 // Reduced from 5 to avoid rate limits
    for (let i = 0; i < top25Accounts.length; i += batchSize) {
      const batch = top25Accounts.slice(i, i + batchSize)
      
      // Process batch sequentially to avoid rate limits
      for (let j = 0; j < batch.length; j++) {
        const account = batch[j]
        const owner = await getTokenAccountOwner(account.address)
        if (owner) {
          holders.push({
            wallet: owner, // Owner wallet address (for receiving distributions)
            balance: account.uiAmount || 0,
            rank: i + j + 1,
          })
        }
        
        // Add delay between requests to avoid rate limiting (except for last item in batch)
        if (j < batch.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200)) // 200ms delay between requests
        }
      }
      
      // Add delay between batches (except for last batch)
      if (i + batchSize < top25Accounts.length) {
        await new Promise(resolve => setTimeout(resolve, 500)) // 500ms delay between batches
      }
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
    console.error(`[HELIUS] Helius API key configured: ${!!HELIUS_API_KEY}`)
    return []
  }
}

/**
 * Retry helper with exponential backoff for rate limiting
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      const isRateLimit = error?.message?.includes("429") || error?.status === 429
      
      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt) // Exponential backoff: 1s, 2s, 4s
        console.log(`[HELIUS] Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      
      throw error
    }
  }
  return null
}

/**
 * Get owner wallet address from a token account with retry logic
 */
export async function getTokenAccountOwner(tokenAccount: string): Promise<string | null> {
  if (!HELIUS_API_KEY) return null

  return retryWithBackoff(async () => {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
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
      if (response.status === 429) {
        throw new Error(`Helius API rate limit: ${response.status}`)
      }
      console.error(`[HELIUS] getAccountInfo failed: ${response.status}`)
      return null
    }

    const data = await response.json()
    
    if (data.error) {
      if (data.error.code === -32005 || response.status === 429) {
        throw new Error(`Helius API rate limit: ${data.error.message || "429"}`)
      }
      console.error("[HELIUS] RPC error:", data.error)
      return null
    }
    
    const owner = data.result?.value?.data?.parsed?.info?.owner
    return owner || null
  })
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
