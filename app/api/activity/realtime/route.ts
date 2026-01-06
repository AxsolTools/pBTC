import { NextResponse } from "next/server"
import { getEnhancedTransactionsForTokenMint } from "@/lib/solana/helius-enhanced"
import { PBTC_TOKEN_MINT } from "@/lib/solana/connection"

// Store last seen transaction signatures to detect new ones
const lastSeenSignatures = new Set<string>()

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const since = searchParams.get("since") // Timestamp in milliseconds

    if (!PBTC_TOKEN_MINT) {
      return NextResponse.json({ swaps: [], error: "PBTC_TOKEN_MINT not configured" })
    }

    // Get recent swaps
    const transactions = await getEnhancedTransactionsForTokenMint(PBTC_TOKEN_MINT, 50)

    // Filter for new swaps (not seen before, or after the "since" timestamp)
    const sinceTimestamp = since ? parseInt(since) : 0
    const newSwaps = transactions
      .filter((tx) => {
        const txTimestamp = tx.timestamp * 1000 // Convert to milliseconds
        return txTimestamp > sinceTimestamp && !lastSeenSignatures.has(tx.signature)
      })
      .map((tx) => {
        // Mark as seen
        lastSeenSignatures.add(tx.signature)

        // Determine if buy or sell
        const tokenTransfer = tx.tokenTransfers?.find((t) => t.mint === PBTC_TOKEN_MINT)
        const isBuy = tokenTransfer?.toUserAccount && tokenTransfer.toUserAccount !== tx.feePayer

        // Get SOL amount
        const solTransfer = tx.tokenTransfers?.find((t) => t.mint === "So11111111111111111111111111111111111111112")
        const solAmount = solTransfer?.tokenAmount || 0

        return {
          signature: tx.signature,
          type: isBuy ? "buy" : "sell",
          amount: solAmount,
          wallet: tokenTransfer?.toUserAccount || tokenTransfer?.fromUserAccount || tx.feePayer,
          timestamp: tx.timestamp * 1000,
        }
      })
      .filter((swap) => swap.amount > 0.01) // Only significant swaps

    // Clean up old signatures (keep last 1000)
    if (lastSeenSignatures.size > 1000) {
      const signaturesArray = Array.from(lastSeenSignatures)
      signaturesArray.slice(0, signaturesArray.length - 1000).forEach((sig) => {
        lastSeenSignatures.delete(sig)
      })
    }

    return NextResponse.json({
      swaps: newSwaps,
      count: newSwaps.length,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error("[REALTIME] Error:", error)
    return NextResponse.json({
      swaps: [],
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}

