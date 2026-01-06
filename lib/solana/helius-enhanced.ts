import { PublicKey } from "@solana/web3.js"
import { HELIUS_API_KEY } from "./connection"

interface HeliusEnhancedTransaction {
  description: string
  type: string
  source: string
  fee: number
  feePayer: string
  signature: string
  slot: number
  timestamp: number
  tokenTransfers?: Array<{
    fromTokenAccount?: string
    toTokenAccount?: string
    fromUserAccount?: string
    toUserAccount?: string
    tokenAmount: number
    mint: string
    tokenStandard: string
  }>
  nativeTransfers?: Array<{
    fromUserAccount: string
    toUserAccount: string
    amount: number
  }>
  instructions?: Array<{
    programId: string
    programName: string
    type: string
  }>
}

interface HeliusEnhancedResponse {
  transactions: HeliusEnhancedTransaction[]
}

/**
 * Fetch enhanced transactions for an address using Helius Enhanced Transactions API
 * This provides pre-parsed transaction data which is much better for detecting swaps
 */
export async function getEnhancedTransactionsForAddress(
  address: string,
  limit: number = 50,
): Promise<HeliusEnhancedTransaction[]> {
  if (!HELIUS_API_KEY) {
    console.error("[HELIUS] Enhanced API key not configured")
    return []
  }

  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[HELIUS] Enhanced Transactions API error: ${response.status} - ${errorText}`)
      return []
    }

    const data: HeliusEnhancedResponse = await response.json()

    if (!data.transactions) {
      console.warn("[HELIUS] No transactions in enhanced response")
      return []
    }

    console.log(`[HELIUS] Fetched ${data.transactions.length} enhanced transactions for ${address.slice(0, 8)}...`)
    return data.transactions.slice(0, limit)
  } catch (error) {
    console.error("[HELIUS] Error fetching enhanced transactions:", error)
    return []
  }
}

/**
 * Fetch enhanced transactions for a token mint
 * Simple: Query the mint address directly - Helius tracks all transactions involving the mint
 */
export async function getEnhancedTransactionsForTokenMint(
  tokenMint: string,
  limit: number = 50,
): Promise<HeliusEnhancedTransaction[]> {
  if (!HELIUS_API_KEY) {
    console.error("[HELIUS] Enhanced API key not configured")
    return []
  }

  try {
    // Query transactions for the mint address directly
    const response = await fetch(
      `https://api.helius.xyz/v0/addresses/${tokenMint}/transactions?api-key=${HELIUS_API_KEY}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[HELIUS] Error fetching transactions: ${response.status} - ${errorText}`)
      return []
    }

    const data: HeliusEnhancedResponse = await response.json()

    if (!data.transactions || data.transactions.length === 0) {
      return []
    }

    // Filter for SWAP transactions only
    const swapTransactions = data.transactions.filter((tx) => {
      const isSwap = tx.type === "SWAP" || 
                    tx.description?.toLowerCase().includes("swap") ||
                    (tx.tokenTransfers && tx.tokenTransfers.some((t) => 
                      t.mint === tokenMint && 
                      tx.tokenTransfers.some((t2) => t2.mint === "So11111111111111111111111111111111111111112")
                    ))
      return isSwap
    })

    // Sort by timestamp (newest first) and limit
    swapTransactions.sort((a, b) => b.timestamp - a.timestamp)
    const limited = swapTransactions.slice(0, limit)

    console.log(`[HELIUS] Found ${limited.length} token swaps for mint ${tokenMint.slice(0, 8)}...`)
    return limited
  } catch (error) {
    console.error("[HELIUS] Error fetching enhanced transactions for token mint:", error)
    return []
  }
}

/**
 * Detect swap activity from enhanced transaction for a specific token mint
 * Returns SOL amount spent/received in the swap
 */
export function detectTokenSwapFromEnhanced(
  tx: HeliusEnhancedTransaction,
  tokenMint: string,
): { amount: number; direction: "buy" | "sell"; wallet: string } | null {
  const WSOL_MINT = "So11111111111111111111111111111111111111112"

  // Check if this is a SWAP transaction involving our token
  if (tx.type === "SWAP" || tx.description?.toLowerCase().includes("swap")) {
    // Look for token transfers involving our token mint
    if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
      const tokenTransfer = tx.tokenTransfers.find((t) => t.mint === tokenMint)
      const solTransfer = tx.tokenTransfers.find((t) => t.mint === WSOL_MINT) || 
                         tx.nativeTransfers?.find((t) => t.amount > 0)

      if (tokenTransfer) {
        // Determine direction: if token is received, it's a buy; if sent, it's a sell
        const isBuy = tokenTransfer.toUserAccount && tokenTransfer.toUserAccount !== tx.feePayer
        const direction = isBuy ? "buy" : "sell"
        
        // Get SOL amount from WSOL transfer or native transfer
        let solAmount = 0
        if (solTransfer) {
          if ("tokenAmount" in solTransfer) {
            solAmount = solTransfer.tokenAmount
          } else if ("amount" in solTransfer) {
            solAmount = solTransfer.amount
          }
        }

        // Also check native transfers for SOL amount
        if (solAmount === 0 && tx.nativeTransfers && tx.nativeTransfers.length > 0) {
          const nativeTransfer = tx.nativeTransfers.find((t) => Math.abs(t.amount) > 0.01)
          if (nativeTransfer) {
            solAmount = Math.abs(nativeTransfer.amount)
          }
        }

        if (solAmount > 0.01) {
          return {
            amount: solAmount,
            direction,
            wallet: (isBuy ? tokenTransfer.toUserAccount : tokenTransfer.fromUserAccount) || tx.feePayer,
          }
        }
      }
    }
  }

  return null
}

/**
 * Detect swap activity from enhanced transaction (legacy - for WSOL wrapping)
 */
export function detectSwapFromEnhanced(tx: HeliusEnhancedTransaction): { amount: number; tokenMint: string } | null {
  // Look for token transfers involving WSOL
  const WSOL_MINT = "So11111111111111111111111111111111111111112"

  if (tx.tokenTransfers) {
    for (const transfer of tx.tokenTransfers) {
      // Check if this is a WSOL transfer (swap/wrap)
      if (transfer.mint === WSOL_MINT && transfer.tokenAmount > 0) {
        return {
          amount: transfer.tokenAmount,
          tokenMint: transfer.mint,
        }
      }
    }
  }

  // Also check if transaction type indicates a swap
  if (tx.type === "SWAP" || tx.description?.toLowerCase().includes("swap") || tx.description?.toLowerCase().includes("wrap")) {
    // Try to extract amount from token transfers
    if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
      const wsolTransfer = tx.tokenTransfers.find((t) => t.mint === WSOL_MINT)
      if (wsolTransfer) {
        return {
          amount: wsolTransfer.tokenAmount,
          tokenMint: wsolTransfer.mint,
        }
      }
    }
  }

  return null
}

/**
 * Detect buyback activity from enhanced transaction
 */
export function detectBuybackFromEnhanced(tx: HeliusEnhancedTransaction): { amount: number } | null {
  // Look for large native SOL transfers (incoming to dev wallet)
  if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
    for (const transfer of tx.nativeTransfers) {
      // Large incoming transfer (buyback/claim)
      if (transfer.amount > 0.1) {
        return {
          amount: transfer.amount,
        }
      }
    }
  }

  // Check transaction type
  if (tx.type === "TRANSFER" && tx.description?.toLowerCase().includes("claim")) {
    if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
      const largeTransfer = tx.nativeTransfers.find((t) => t.amount > 0.1)
      if (largeTransfer) {
        return {
          amount: largeTransfer.amount,
        }
      }
    }
  }

  return null
}

