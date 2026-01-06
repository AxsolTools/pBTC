import { PublicKey } from "@solana/web3.js"

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
  const heliusApiKey = process.env.HELIUS_API_KEY

  if (!heliusApiKey) {
    console.error("[HELIUS] API key not configured")
    return []
  }

  try {
    const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${heliusApiKey}`, {
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
 * Detect swap activity from enhanced transaction
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

