import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

interface HeliusWebhookPayload {
  accountData: Array<{
    account: string
    nativeBalanceChange?: number
    tokenBalanceChanges?: Array<{
      mint: string
      rawTokenAmount: {
        tokenAmount: string
        decimals: number
      }
      tokenAccount: string
      userAccount: string
    }>
  }>
  description: string
  fee: number
  feePayer: string
  instructions: Array<{
    programId: string
    programName: string
    type: string
  }>
  nativeTransfers: Array<{
    amount: number
    fromUserAccount: string
    toUserAccount: string
  }>
  signature: string
  source: string
  timestamp: number
  tokenTransfers: Array<{
    fromTokenAccount?: string
    toTokenAccount?: string
    fromUserAccount?: string
    toUserAccount?: string
    mint: string
    tokenAmount: number
    tokenStandard: string
  }>
  type: string
}

/**
 * Helius Webhook Endpoint
 * Receives real-time transaction notifications from Helius
 * Webhook URL: https://physicalbitcoin.fun/api/webhooks/helius
 * Configured for: SWAP, TRANSFER events on account B7tP6jNAcSmnvcuKsTFdvTAJHMkEQaXse8TMxoq2pump
 * Authentication: Bearer token required (set in HELIUS_WEBHOOK_AUTH_TOKEN env var)
 */
export async function POST(request: Request) {
  try {
    // Verify Bearer token authentication
    const authHeader = request.headers.get("authorization")
    const expectedToken = process.env.HELIUS_WEBHOOK_AUTH_TOKEN

    if (expectedToken) {
      const expectedBearer = `Bearer ${expectedToken}`
      if (authHeader !== expectedBearer) {
        console.warn(`[WEBHOOK] Authentication failed. Expected: ${expectedBearer.slice(0, 20)}..., Got: ${authHeader?.slice(0, 20) || "none"}...`)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      console.log("[WEBHOOK] Authentication successful")
    } else {
      console.warn("[WEBHOOK] HELIUS_WEBHOOK_AUTH_TOKEN not configured, accepting all requests (not recommended for production)")
    }

    const payload: HeliusWebhookPayload[] = await request.json()

    if (!Array.isArray(payload) || payload.length === 0) {
      console.log("[WEBHOOK] Empty or invalid payload")
      return NextResponse.json({ received: true, processed: 0 })
    }

    console.log(`[WEBHOOK] Received ${payload.length} transaction(s) from Helius`)

    const supabase = getAdminClient()
    const WSOL_MINT = "So11111111111111111111111111111111111111112"
    let processed = 0

    for (const tx of payload) {
      try {
        const timestamp = tx.timestamp * 1000 // Convert to milliseconds
        const created_at = new Date(timestamp).toISOString()

        // Detect SWAP transactions (WSOL wrapping)
        if (tx.type === "SWAP" || tx.description?.toLowerCase().includes("swap") || tx.description?.toLowerCase().includes("wrap")) {
          // Look for WSOL token transfers
          if (tx.tokenTransfers) {
            for (const transfer of tx.tokenTransfers) {
              if (transfer.mint === WSOL_MINT && transfer.tokenAmount > 0.01) {
                console.log(`[WEBHOOK] Processing SWAP: ${transfer.tokenAmount} WSOL in tx ${tx.signature.slice(0, 8)}...`)

                // Insert into activity_log (if table exists)
                try {
                  await supabase.from("activity_log").insert({
                    type: "swap",
                    amount: transfer.tokenAmount,
                    token_symbol: "WSOL",
                    wallet_address: transfer.toUserAccount || tx.feePayer,
                    tx_signature: tx.signature,
                    status: "completed",
                    created_at,
                  })
                  processed++
                } catch (dbError: any) {
                  // Table might not exist yet - that's okay, we'll still log it
                  console.warn(`[WEBHOOK] Could not insert swap into activity_log: ${dbError.message}`)
                  processed++ // Still count as processed
                }
                break
              }
            }
          }
        }

        // Detect TRANSFER transactions (buybacks/claims)
        if (tx.type === "TRANSFER") {
          // Look for large native SOL transfers (buybacks)
          if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
            for (const transfer of tx.nativeTransfers) {
              // Large incoming transfer (buyback/claim)
              if (transfer.amount > 0.1) {
                console.log(`[WEBHOOK] Processing BUYBACK: ${transfer.amount} SOL in tx ${tx.signature.slice(0, 8)}...`)

                // Insert into activity_log (if table exists)
                try {
                  await supabase.from("activity_log").insert({
                    type: "buyback",
                    amount: transfer.amount,
                    token_symbol: "SOL",
                    wallet_address: transfer.toUserAccount || tx.feePayer,
                    tx_signature: tx.signature,
                    status: "completed",
                    created_at,
                  })
                  processed++
                } catch (dbError: any) {
                  console.warn(`[WEBHOOK] Could not insert buyback into activity_log: ${dbError.message}`)
                  processed++ // Still count as processed
                }
                break
              }
            }
          }

          // Also check for token transfers that might be distributions
          if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
            for (const transfer of tx.tokenTransfers) {
              if (transfer.mint === WSOL_MINT && transfer.tokenAmount > 0.01) {
                // Check if this is a distribution (multiple recipients or from dev wallet)
                const isDistribution = tx.tokenTransfers.length > 1 || transfer.fromUserAccount === tx.feePayer

                if (isDistribution) {
                  console.log(`[WEBHOOK] Processing DISTRIBUTION: ${transfer.tokenAmount} WSOL to ${transfer.toUserAccount} in tx ${tx.signature.slice(0, 8)}...`)

                  try {
                    await supabase.from("activity_log").insert({
                      type: "distribution",
                      amount: transfer.tokenAmount,
                      token_symbol: "WSOL",
                      wallet_address: transfer.toUserAccount,
                      tx_signature: tx.signature,
                      status: "completed",
                      created_at,
                    })
                    processed++
                  } catch (dbError: any) {
                    console.warn(`[WEBHOOK] Could not insert distribution into activity_log: ${dbError.message}`)
                    processed++ // Still count as processed
                  }
                }
              }
            }
          }
        }
      } catch (txError) {
        console.error(`[WEBHOOK] Error processing transaction ${tx.signature}:`, txError)
        continue
      }
    }

    console.log(`[WEBHOOK] Processed ${processed} activity(ies) from ${payload.length} transaction(s)`)

    return NextResponse.json({
      received: true,
      processed,
      transactions: payload.length,
    })
  } catch (error) {
    console.error("[WEBHOOK] Error processing webhook:", error)
    // Return 200 to prevent Helius from retrying
    return NextResponse.json(
      {
        received: true,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 200 },
    )
  }
}

// Handle GET requests (for webhook verification)
export async function GET() {
  return NextResponse.json({
    status: "active",
    endpoint: "/api/webhooks/helius",
    description: "Helius webhook endpoint for real-time transaction notifications",
  })
}

