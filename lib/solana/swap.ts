import { type Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js"
import {
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token"
import { getConnection, WSOL_MINT } from "./connection"

interface SwapResult {
  success: boolean
  txSignature?: string
  outputAmount?: number
  error?: string
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
