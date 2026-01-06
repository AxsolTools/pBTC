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
 * Fetch enhanced transactions for a token mint using Helius getTransactionsForAddress RPC method
 * This is a Helius-exclusive method available with Developer plan
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
    // Use Helius getTransactionsForAddress RPC method
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "get-token-txs",
        method: "getTransactionsForAddress",
        params: [
          tokenMint, // The token mint address
          {
            transactionDetails: "full",
            sortOrder: "desc", // Newest first
            limit: Math.min(limit, 100), // Helius only allows up to 100 transactions when transactionDetails is 'full'
            filters: {
              status: "succeeded", // Only successful transactions
            },
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[HELIUS] Error fetching transactions: ${response.status} - ${errorText}`)
      return []
    }

    const data = await response.json()

    if (data.error) {
      console.error(`[HELIUS] RPC error: ${data.error.message}`)
      return []
    }

    const transactions = data.result?.data || []

    if (transactions.length === 0) {
      return []
    }

    // Convert to HeliusEnhancedTransaction format and filter for swaps
    const swapTransactions: HeliusEnhancedTransaction[] = []

    for (const tx of transactions) {
      if (!tx.transaction || !tx.meta) continue

      const signature = tx.transaction.signatures[0]
      const blockTime = tx.blockTime || Math.floor(Date.now() / 1000)

      // Check postTokenBalances for our token mint
      const postBalances = tx.meta.postTokenBalances || []
      const preBalances = tx.meta.preTokenBalances || []
      
      const hasTokenMint = postBalances.some((b: any) => b.mint === tokenMint)
      const hasWSOL = postBalances.some((b: any) => b.mint === "So11111111111111111111111111111111111111112")

      // If transaction involves both our token and WSOL, it's likely a swap
      if (hasTokenMint && hasWSOL) {
        // Find token mint and WSOL balances to calculate swap amounts
        let tokenAmount = 0
        let solAmount = 0
        let wallet = ""
        let isBuy = false

        // Find token mint transfer
        for (const postBalance of postBalances) {
          if (postBalance.mint === tokenMint) {
            const preBalance = preBalances.find((b: any) => 
              b.accountIndex === postBalance.accountIndex && b.mint === tokenMint
            )
            
            const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount?.uiAmountString || "0") : 0
            const postAmount = parseFloat(postBalance.uiTokenAmount?.uiAmountString || "0")
            tokenAmount = Math.abs(postAmount - preAmount)
            
            // If token increased, it's a buy; if decreased, it's a sell
            isBuy = postAmount > preAmount
            wallet = postBalance.owner || tx.transaction.message.accountKeys[0] || ""
          }
          
          // Find WSOL transfer (SOL amount)
          if (postBalance.mint === "So11111111111111111111111111111111111111112") {
            const preBalance = preBalances.find((b: any) => 
              b.accountIndex === postBalance.accountIndex && b.mint === "So11111111111111111111111111111111111111112"
            )
            
            const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount?.uiAmountString || "0") : 0
            const postAmount = parseFloat(postBalance.uiTokenAmount?.uiAmountString || "0")
            solAmount = Math.abs(postAmount - preAmount)
            
            if (!wallet) {
              wallet = postBalance.owner || tx.transaction.message.accountKeys[0] || ""
            }
          }
        }

        // Also check native SOL transfers
        if (solAmount === 0 && tx.meta.preBalances && tx.meta.postBalances) {
          for (let i = 0; i < tx.meta.postBalances.length; i++) {
            const diff = (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9 // Convert lamports to SOL
            if (Math.abs(diff) > 0.01) {
              solAmount = Math.abs(diff)
              if (!wallet && i < tx.transaction.message.accountKeys.length) {
                wallet = tx.transaction.message.accountKeys[i] || ""
              }
              break
            }
          }
        }

        if (solAmount > 0.01 && tokenAmount > 0) {
          swapTransactions.push({
            signature,
            type: "SWAP",
            description: "Token swap",
            source: "unknown",
            fee: tx.meta.fee || 0,
            feePayer: tx.transaction.message.accountKeys[0] || "",
            slot: tx.slot,
            timestamp: blockTime,
            tokenTransfers: [
              {
                mint: tokenMint,
                tokenAmount: tokenAmount,
                fromUserAccount: isBuy ? "" : wallet,
                toUserAccount: isBuy ? wallet : "",
                tokenStandard: "Fungible",
              },
              {
                mint: "So11111111111111111111111111111111111111112",
                tokenAmount: solAmount,
                fromUserAccount: isBuy ? wallet : "",
                toUserAccount: isBuy ? "" : wallet,
                tokenStandard: "Fungible",
              },
            ],
            nativeTransfers: [],
            instructions: [],
          })
        }
      }
    }

    console.log(`[HELIUS] Found ${swapTransactions.length} token swaps for mint ${tokenMint.slice(0, 8)}...`)
    return swapTransactions.slice(0, limit)
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

  // Look for token transfers involving our token mint and WSOL/SOL
  // Don't require explicit "SWAP" type - many swaps don't have that label
  if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
    const tokenTransfer = tx.tokenTransfers.find((t) => t.mint === tokenMint)
    const solTransfer = tx.tokenTransfers.find((t) => t.mint === WSOL_MINT)

    // If we have both token and SOL transfers, it's likely a swap
    if (tokenTransfer && solTransfer) {
      // Determine direction: if token is received, it's a buy; if sent, it's a sell
      const isBuy = tokenTransfer.toUserAccount && 
                   tokenTransfer.toUserAccount !== tx.feePayer &&
                   tokenTransfer.toUserAccount !== tokenTransfer.fromUserAccount
      const direction = isBuy ? "buy" : "sell"
      
      // Get SOL amount from WSOL transfer
      let solAmount = solTransfer.tokenAmount || 0

      // Also check native transfers for SOL amount if WSOL transfer doesn't have amount
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

  // Fallback: Check if transaction type explicitly indicates a swap
  if (tx.type === "SWAP" || tx.description?.toLowerCase().includes("swap")) {
    if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
      const tokenTransfer = tx.tokenTransfers.find((t) => t.mint === tokenMint)
      const solTransfer = tx.tokenTransfers.find((t) => t.mint === WSOL_MINT) || 
                         tx.nativeTransfers?.find((t) => t.amount > 0)

      if (tokenTransfer && solTransfer) {
        const isBuy = tokenTransfer.toUserAccount && tokenTransfer.toUserAccount !== tx.feePayer
        const direction = isBuy ? "buy" : "sell"
        
        let solAmount = 0
        if ("tokenAmount" in solTransfer) {
          solAmount = solTransfer.tokenAmount
        } else if ("amount" in solTransfer) {
          solAmount = solTransfer.amount
        }

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

