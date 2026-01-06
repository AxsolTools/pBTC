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
    const PBTC_TOKEN_MINT = process.env.PBTC_TOKEN_MINT
    
    if (!PBTC_TOKEN_MINT) {
      console.error("[WEBHOOK] PBTC_TOKEN_MINT not set in environment")
    } else {
      console.log(`[WEBHOOK] Monitoring token mint: ${PBTC_TOKEN_MINT.slice(0, 8)}...`)
    }
    
    let processed = 0

    for (const tx of payload) {
      try {
        const timestamp = tx.timestamp * 1000 // Convert to milliseconds
        const created_at = new Date(timestamp).toISOString()

        // Detect SWAP transactions (token buys/sells)
        // Check if this transaction involves our token mint
        if (PBTC_TOKEN_MINT && tx.tokenTransfers && tx.tokenTransfers.length > 0) {
          const tokenTransfer = tx.tokenTransfers.find((t) => t.mint === PBTC_TOKEN_MINT)
          
          if (tokenTransfer) {
            console.log(`[WEBHOOK] Found transaction involving token mint: ${tx.signature.slice(0, 8)}...`)
            console.log(`[WEBHOOK] Transaction type: ${tx.type}, Description: ${tx.description}`)
            
            // This transaction involves our token - check if it's a swap
            // Be more lenient - if it involves our token and has SOL/WSOL transfers, it's likely a swap
            const hasSolTransfer = tx.tokenTransfers.some((t) => t.mint === WSOL_MINT) || 
                                   (tx.nativeTransfers && tx.nativeTransfers.length > 0)
            
            const isSwap = tx.type === "SWAP" || 
                          tx.description?.toLowerCase().includes("swap") ||
                          tx.instructions?.some((ix) => 
                            ix.programName?.toLowerCase().includes("jupiter") ||
                            ix.programName?.toLowerCase().includes("raydium") ||
                            ix.programName?.toLowerCase().includes("orca") ||
                            ix.type === "SWAP"
                          ) ||
                          (hasSolTransfer && tokenTransfer) // If it has our token + SOL, it's likely a swap

            if (isSwap) {
              // Find SOL/WSOL amount in the swap
              const solTransfer = tx.tokenTransfers.find((t) => t.mint === WSOL_MINT) || 
                                 tx.nativeTransfers?.find((t) => Math.abs(t.amount) > 0.01)

              let solAmount = 0
              if (solTransfer) {
                if ("tokenAmount" in solTransfer) {
                  solAmount = solTransfer.tokenAmount
                } else if ("amount" in solTransfer) {
                  solAmount = Math.abs(solTransfer.amount)
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
                // Determine if it's a buy or sell
                // If token is received (toUserAccount), it's a buy
                // If token is sent (fromUserAccount), it's a sell
                const isBuy = tokenTransfer.toUserAccount && 
                             tokenTransfer.toUserAccount !== tx.feePayer &&
                             tokenTransfer.toUserAccount !== tokenTransfer.fromUserAccount
                
                const wallet = tokenTransfer.toUserAccount || tokenTransfer.fromUserAccount || tx.feePayer
                const direction = isBuy ? "buy" : "sell"
                
                console.log(`[WEBHOOK] Processing TOKEN SWAP (${direction}): ${solAmount} SOL in tx ${tx.signature.slice(0, 8)}... by ${wallet.slice(0, 8)}...`)

                try {
                  await supabase.from("activity_log").insert({
                    type: "swap",
                    amount: solAmount,
                    token_symbol: "SOL",
                    wallet_address: wallet,
                    tx_signature: tx.signature,
                    status: "completed",
                    created_at,
                  })
                  processed++
                  console.log(`[WEBHOOK] ✅ Stored swap event in database`)
                } catch (dbError: any) {
                  console.warn(`[WEBHOOK] Could not insert token swap into activity_log: ${dbError.message}`)
                  // Still count as processed even if DB insert fails
                  processed++
                }
                continue // Skip other checks if we found a token swap
              }
            }
          }
        }

        // Legacy: Detect WSOL wrapping (for backwards compatibility)
        if (tx.type === "SWAP" || tx.description?.toLowerCase().includes("swap") || tx.description?.toLowerCase().includes("wrap")) {
          if (tx.tokenTransfers) {
            for (const transfer of tx.tokenTransfers) {
              if (transfer.mint === WSOL_MINT && transfer.tokenAmount > 0.01) {
                console.log(`[WEBHOOK] Processing WSOL WRAP: ${transfer.tokenAmount} WSOL in tx ${tx.signature.slice(0, 8)}...`)

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
                  console.warn(`[WEBHOOK] Could not insert swap into activity_log: ${dbError.message}`)
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

