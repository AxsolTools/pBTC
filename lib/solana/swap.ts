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
 */
export async function buyPbtcWithSol(keypair: Keypair, solAmount: number): Promise<BuyResult> {
  try {
    const connection = getConnection()
    
    if (!PBTC_TOKEN_MINT) {
      return {
        success: false,
        error: "PBTC_TOKEN_MINT not configured",
      }
    }

    console.log(`[BUYBACK] Buying pBTC with ${solAmount} SOL...`)
    console.log(`[BUYBACK] Token mint: ${PBTC_TOKEN_MINT}`)

    // Use PumpPortal API to buy tokens
    const tradeBody = {
      publicKey: keypair.publicKey.toBase58(),
      action: "buy",
      mint: PBTC_TOKEN_MINT,
      amount: solAmount, // Amount in SOL
      slippage: 1, // 1% slippage tolerance
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
      console.error("[BUYBACK] PumpPortal buy error:", errorText)
      return {
        success: false,
        error: `PumpPortal API error: ${pumpResponse.status} - ${errorText}`,
      }
    }

    // Deserialize and sign the transaction from PumpPortal
    const txBytes = new Uint8Array(await pumpResponse.arrayBuffer())
    const tx = VersionedTransaction.deserialize(txBytes)
    tx.sign([keypair])

    // Send to RPC
    console.log("[BUYBACK] Submitting buy transaction...")
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    })

    // Confirm transaction
    const confirmation = await connection.confirmTransaction(signature, "confirmed")

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
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
    console.error("[BUYBACK] Buy error:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Buy failed",
    }
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
