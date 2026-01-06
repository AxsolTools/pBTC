import { type Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, VersionedTransaction } from "@solana/web3.js"
import {
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token"
import { getConnection, WSOL_MINT, PBTC_TOKEN_MINT } from "./connection"

const PUMPPORTAL_LOCAL_TRADE = "https://pumpportal.fun/api/trade-local"

interface SwapResult {
  success: boolean
  txSignature?: string
  outputAmount?: number
  error?: string
}

interface BuyResult {
  success: boolean
  txSignature?: string
  tokenAmount?: number
  solSpent?: number
  error?: string
}

/**
 * Buy pBTC tokens with SOL using PumpPortal API
 * This is the actual "buyback" - buying the token back from the market
 * Includes retry logic with exponential backoff for handling transient failures
 */
export async function buyPbtcWithSol(keypair: Keypair, solAmount: number, retries: number = 3): Promise<BuyResult> {
  const maxRetries = retries
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const connection = getConnection()
      
      if (!PBTC_TOKEN_MINT) {
        return {
          success: false,
          error: "PBTC_TOKEN_MINT not configured",
        }
      }

      if (attempt > 1) {
        // Exponential backoff: wait 1s, 2s, 4s between retries
        const waitTime = Math.pow(2, attempt - 2) * 1000
        console.log(`[BUYBACK] Retry attempt ${attempt}/${maxRetries} after ${waitTime}ms...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }

      console.log(`[BUYBACK] Buying pBTC with ${solAmount} SOL... (attempt ${attempt}/${maxRetries})`)
      console.log(`[BUYBACK] Token mint: ${PBTC_TOKEN_MINT}`)

      // Use PumpPortal API to buy tokens
      // Adaptive slippage: start with base, increase on retries for volatile markets
      const baseSlippage = parseFloat(process.env.BUYBACK_SLIPPAGE || "15") // Default 15% for volatile tokens
      // Increase slippage by 5% on each retry attempt (15%, 20%, 25%)
      const slippageTolerance = baseSlippage + ((attempt - 1) * 5)
      console.log(`[BUYBACK] Using slippage tolerance: ${slippageTolerance}% (attempt ${attempt})`)
      
      const tradeBody = {
        publicKey: keypair.publicKey.toBase58(),
        action: "buy",
        mint: PBTC_TOKEN_MINT,
        amount: solAmount, // Amount in SOL
        slippage: slippageTolerance, // Adaptive slippage tolerance
        priorityFee: 0.0001,
        pool: "pump",
      }

      const pumpResponse = await fetch(PUMPPORTAL_LOCAL_TRADE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tradeBody),
      })

      if (!pumpResponse.ok) {
        const errorText = await pumpResponse.text()
        console.error(`[BUYBACK] PumpPortal buy error (attempt ${attempt}):`, errorText)
        lastError = new Error(`PumpPortal API error: ${pumpResponse.status} - ${errorText}`)
        if (attempt < maxRetries) continue
        return {
          success: false,
          error: lastError.message,
        }
      }

      // Deserialize and sign the transaction from PumpPortal
      const txBytes = new Uint8Array(await pumpResponse.arrayBuffer())
      const tx = VersionedTransaction.deserialize(txBytes)
      tx.sign([keypair])

      // Send to RPC
      console.log(`[BUYBACK] Submitting buy transaction... (attempt ${attempt})`)
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
      })

      // Confirm transaction
      const confirmation = await connection.confirmTransaction(signature, "confirmed")

      if (confirmation.value.err) {
        const errorMsg = `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        lastError = new Error(errorMsg)
        
        // Check if it's a slippage error - if so, retry with higher slippage on next attempt
        const errorStr = JSON.stringify(confirmation.value.err)
        if (errorStr.includes("TooMuchSolRequired") || errorStr.includes("0x1772")) {
          console.log(`[BUYBACK] Slippage error detected, will retry...`)
          if (attempt < maxRetries) continue
        }
        
        throw lastError
      }

      console.log(`[BUYBACK] ✅ Buy successful: ${signature}`)
      console.log(`[BUYBACK] Spent ${solAmount} SOL to buy pBTC tokens`)

      return {
        success: true,
        txSignature: signature,
        solSpent: solAmount,
        // Note: Token amount would need to be calculated from the transaction, 
        // but for now we'll track SOL spent
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`[BUYBACK] Buy error (attempt ${attempt}/${maxRetries}):`, lastError.message)
      
      // If this is the last attempt, return error
      if (attempt === maxRetries) {
        return {
          success: false,
          error: lastError.message,
        }
      }
      
      // Otherwise, continue to next retry
      continue
    }
  }

  // Should never reach here, but just in case
  return {
    success: false,
    error: lastError?.message || "Buy failed after all retries",
  }
}

/**
 * Wrap SOL to WSOL (Wrapped SOL)
 * This creates a WSOL token account and wraps the SOL amount
 */
export async function swapSolToWsol(keypair: Keypair, solAmount: number): Promise<SwapResult> {
  try {
    const connection = getConnection()
    const lamports = Math.floor(solAmount * 1e9)

    // WSOL mint address (same as native SOL mint)
    const wsolMint = new PublicKey(WSOL_MINT)

    // Get or create WSOL token account for the keypair
    const wsolTokenAccount = await getAssociatedTokenAddress(wsolMint, keypair.publicKey)

    const transaction = new Transaction()

    // Check if WSOL token account exists, create if not
    try {
      await getAccount(connection, wsolTokenAccount)
    } catch {
      // Create associated token account if it doesn't exist
      transaction.add(
        createAssociatedTokenAccountInstruction(
          keypair.publicKey, // payer
          wsolTokenAccount, // ata
          keypair.publicKey, // owner
          wsolMint, // mint
        ),
      )
    }

    // Transfer SOL to the WSOL token account
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: wsolTokenAccount,
        lamports,
      }),
    )

    // Sync native (wrap) - converts the SOL in the account to WSOL
    transaction.add(createSyncNativeInstruction(wsolTokenAccount))

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized")
    transaction.recentBlockhash = blockhash
    transaction.feePayer = keypair.publicKey

    // Sign and send
    const signature = await sendAndConfirmTransaction(connection, transaction, [keypair], {
      commitment: "confirmed",
    })

    console.log(`[SWAP] SOL -> WSOL complete: ${signature}, Amount: ${solAmount} WSOL`)

    return {
      success: true,
      txSignature: signature,
      outputAmount: solAmount, // WSOL amount is same as SOL (9 decimals)
    }
  } catch (error) {
    console.error("[SWAP] Error:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Swap failed",
    }
  }
}
