import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { getConnection, PBTC_TOKEN_MINT, WSOL_MINT } from "./connection"

interface OnChainActivity {
  type: "buyback" | "swap" | "distribution"
  amount: number
  token_symbol: string
  wallet_address?: string
  tx_signature: string
  timestamp: number
}

/**
 * Fetch recent on-chain activities for the token
 * This includes swaps, distributions, and buybacks from blockchain
 */
export async function getOnChainActivities(limit: number = 50): Promise<OnChainActivity[]> {
  const connection = getConnection()
  const activities: OnChainActivity[] = []

  if (!PBTC_TOKEN_MINT) {
    console.warn("[ACTIVITY] PBTC_TOKEN_MINT not configured")
    return []
  }

  try {
    const tokenMint = new PublicKey(PBTC_TOKEN_MINT)
    const wsolMint = new PublicKey(WSOL_MINT)

    // Get recent signatures for the token mint (transactions involving this token)
    const signatures = await connection.getSignaturesForAddress(tokenMint, {
      limit: limit * 2, // Get more to filter
    })

    // Also get signatures for WSOL mint to catch wrapping transactions
    const wsolSignatures = await connection.getSignaturesForAddress(wsolMint, {
      limit: 20,
    })

    // Process token mint transactions
    for (const sigInfo of signatures.slice(0, limit)) {
      try {
        const tx = await connection.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        })

        if (!tx) continue

        const blockTime = sigInfo.blockTime ? sigInfo.blockTime * 1000 : Date.now()

        // Check for token transfers (swaps/distributions)
        if (tx.meta?.postTokenBalances && tx.meta?.preTokenBalances) {
          const postBalances = tx.meta.postTokenBalances
          const preBalances = tx.meta.preTokenBalances

          // Look for WSOL transfers (swaps)
          for (const postBalance of postBalances) {
            if (postBalance.mint === WSOL_MINT) {
              const preBalance = preBalances.find(
                (b) => b.accountIndex === postBalance.accountIndex && b.mint === WSOL_MINT,
              )

              if (preBalance) {
                const amount = (parseFloat(postBalance.uiTokenAmount.uiAmountString || "0") -
                  parseFloat(preBalance.uiTokenAmount.uiAmountString || "0"))

                if (Math.abs(amount) > 0.000001) {
                  activities.push({
                    type: "swap",
                    amount: Math.abs(amount),
                    token_symbol: "WSOL",
                    tx_signature: sigInfo.signature,
                    timestamp: blockTime,
                  })
                  break
                }
              }
            }
          }
        }

        // Check for SOL transfers (buybacks/claims)
        if (tx.meta?.postBalances && tx.meta?.preBalances) {
          const solTransfers: number[] = []
          for (let i = 0; i < tx.meta.postBalances.length; i++) {
            const diff = (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / LAMPORTS_PER_SOL
            if (Math.abs(diff) > 0.01) {
              solTransfers.push(diff)
            }
          }

          // Large SOL transfers might be buybacks
          const largeTransfer = solTransfers.find((t) => Math.abs(t) > 0.1)
          if (largeTransfer && Math.abs(largeTransfer) > 0) {
            activities.push({
              type: "buyback",
              amount: Math.abs(largeTransfer),
              token_symbol: "SOL",
              tx_signature: sigInfo.signature,
              timestamp: blockTime,
            })
          }
        }
      } catch (txError) {
        // Skip transactions that can't be parsed
        continue
      }
    }

    // Sort by timestamp (newest first) and limit
    activities.sort((a, b) => b.timestamp - a.timestamp)
    return activities.slice(0, limit)
  } catch (error) {
    console.error("[ACTIVITY] Error fetching on-chain activities:", error)
    return []
  }
}

