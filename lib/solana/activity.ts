import { PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js"
import bs58 from "bs58"
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
 * Get dev wallet public key from ENV (if available)
 */
function getDevWalletPublicKey(): PublicKey | null {
  try {
    const envPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY
    if (envPrivateKey) {
      try {
        const keypair = Keypair.fromSecretKey(bs58.decode(envPrivateKey))
        return keypair.publicKey
      } catch {
        try {
          const parsed = JSON.parse(envPrivateKey)
          if (Array.isArray(parsed)) {
            const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed))
            return keypair.publicKey
          }
        } catch {
          // Invalid format
        }
      }
    }
  } catch {
    // Could not get dev wallet
  }
  return null
}

/**
 * Fetch recent on-chain activities for the token
 * This includes swaps, distributions, and buybacks from blockchain
 */
export async function getOnChainActivities(limit: number = 50): Promise<OnChainActivity[]> {
  const connection = getConnection()
  const activities: OnChainActivity[] = []

  if (!PBTC_TOKEN_MINT) {
    console.warn("[ACTIVITY] PBTC_TOKEN_MINT not configured. Check PBTC_TOKEN_MINT environment variable.")
    return []
  }

  console.log(`[ACTIVITY] Fetching activities for mint: ${PBTC_TOKEN_MINT.slice(0, 8)}...`)

  try {
    const tokenMint = new PublicKey(PBTC_TOKEN_MINT)
    const wsolMint = new PublicKey(WSOL_MINT)
    const devWalletPubkey = getDevWalletPublicKey()

    // Get recent signatures for dev wallet to catch buybacks AND swaps
    let devWalletSignatures: any[] = []
    if (devWalletPubkey) {
      try {
        console.log(`[ACTIVITY] Fetching transactions for dev wallet: ${devWalletPubkey.toString().slice(0, 8)}...`)
        devWalletSignatures = await connection.getSignaturesForAddress(devWalletPubkey, {
          limit: limit,
        })
        console.log(`[ACTIVITY] Found ${devWalletSignatures.length} dev wallet transactions`)
      } catch (err) {
        console.error("[ACTIVITY] Error fetching dev wallet signatures:", err)
      }
    } else {
      console.warn("[ACTIVITY] Dev wallet not configured, cannot detect swaps/buybacks from dev wallet")
    }

    // Process dev wallet transactions (buybacks AND swaps)
    if (devWalletPubkey && devWalletSignatures.length > 0) {
      for (const sigInfo of devWalletSignatures) {
        try {
          const tx = await connection.getTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
          })

          if (!tx) continue

          const blockTime = sigInfo.blockTime ? sigInfo.blockTime * 1000 : Date.now()

          // Check for WSOL wrapping (swap) - look for sync native instruction
          const hasSyncNative = tx.transaction.message.instructions.some((ix: any) => {
            // Program ID for Token Program (sync native instruction)
            const tokenProgramId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            return ix.programId?.toString() === tokenProgramId
          })

          // Check for WSOL balance changes (swaps)
          if (hasSyncNative && tx.meta?.postTokenBalances && tx.meta?.preTokenBalances) {
            const postBalances = tx.meta.postTokenBalances
            const preBalances = tx.meta.preTokenBalances

            // Look for WSOL balance increases (wrapping) from dev wallet
            for (const postBalance of postBalances) {
              if (postBalance.mint === WSOL_MINT) {
                const preBalance = preBalances.find(
                  (b) => b.accountIndex === postBalance.accountIndex && b.mint === WSOL_MINT,
                )

                if (preBalance) {
                  const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || "0")
                  const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || "0")
                  const amount = postAmount - preAmount

                  if (amount > 0.01) {
                    console.log(`[ACTIVITY] Found swap: ${amount} WSOL wrapped in tx ${sigInfo.signature.slice(0, 8)}...`)
                    activities.push({
                      type: "swap",
                      amount: amount,
                      token_symbol: "WSOL",
                      wallet_address: devWalletPubkey.toString(),
                      tx_signature: sigInfo.signature,
                      timestamp: blockTime,
                    })
                    break
                  }
                } else if (postBalance.uiTokenAmount.uiAmountString) {
                  // New WSOL account created (wrapping)
                  const amount = parseFloat(postBalance.uiTokenAmount.uiAmountString)
                  if (amount > 0.01) {
                    console.log(`[ACTIVITY] Found swap: ${amount} WSOL wrapped (new account) in tx ${sigInfo.signature.slice(0, 8)}...`)
                    activities.push({
                      type: "swap",
                      amount: amount,
                      token_symbol: "WSOL",
                      wallet_address: devWalletPubkey.toString(),
                      tx_signature: sigInfo.signature,
                      timestamp: blockTime,
                    })
                    break
                  }
                }
              }
            }
          }

          // Check for large SOL transfers (buybacks/claims)
          if (tx.meta?.postBalances && tx.meta?.preBalances) {
            const solTransfers: number[] = []
            for (let i = 0; i < tx.meta.postBalances.length; i++) {
              const diff = (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / LAMPORTS_PER_SOL
              if (Math.abs(diff) > 0.1) {
                solTransfers.push(diff)
              }
            }

            // Large incoming SOL transfers to dev wallet (buybacks)
            const largeIncoming = solTransfers.find((t) => t > 0.1)
            if (largeIncoming) {
              console.log(`[ACTIVITY] Found buyback: ${largeIncoming} SOL in tx ${sigInfo.signature.slice(0, 8)}...`)
              activities.push({
                type: "buyback",
                amount: largeIncoming,
                token_symbol: "SOL",
                wallet_address: devWalletPubkey.toString(),
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
    }

    // Sort by timestamp (newest first) and limit
    activities.sort((a, b) => b.timestamp - a.timestamp)
    const limited = activities.slice(0, limit)
    
    console.log(`[ACTIVITY] Found ${limited.length} total activities (${limited.filter(a => a.type === 'swap').length} swaps, ${limited.filter(a => a.type === 'buyback').length} buybacks)`)
    
    return limited
  } catch (error) {
    console.error("[ACTIVITY] Error fetching on-chain activities:", error)
    console.error("[ACTIVITY] Error details:", error instanceof Error ? error.message : String(error))
    return []
  }
}

