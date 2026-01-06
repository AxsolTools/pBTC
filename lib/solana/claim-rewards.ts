import { type Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js"
import { getConnection } from "./connection"

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P")
const PUMPPORTAL_LOCAL_TRADE = "https://pumpportal.fun/api/trade-local"

interface ClaimResult {
  success: boolean
  amount?: number
  txSignature?: string
  error?: string
}

/**
 * Get creator vault balance
 * Pump.fun uses a per-creator vault (NOT per-token)
 * All tokens created by the same wallet share ONE vault that accumulates all fees
 */
export async function getCreatorVaultBalance(
  creatorPublicKey: PublicKey,
): Promise<{ balance: number; vaultAddress: string }> {
  const connection = getConnection()

  try {
    // Derive creator vault PDA - uses "creator-vault" seed with creator pubkey only
    // This is a per-creator vault, NOT per-token (accumulates fees from all tokens by this creator)
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creatorPublicKey.toBuffer()],
      PUMP_PROGRAM_ID,
    )

    const balance = await connection.getBalance(vaultPda)

    if (balance > 0) {
      console.log(
        `[PUMP] Creator vault ${vaultPda.toBase58().slice(0, 8)}... has ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
      )
    }

    return {
      balance: balance / LAMPORTS_PER_SOL,
      vaultAddress: vaultPda.toBase58(),
    }
  } catch (error) {
    console.error("[PUMP] Get creator vault error:", error)
    return { balance: 0, vaultAddress: "" }
  }
}

/**
 * Claim creator rewards from pump.fun vault
 * Uses PumpPortal API with fallback to direct vault withdrawal
 */
export async function claimCreatorRewards(keypair: Keypair, tokenMint: string): Promise<ClaimResult> {
  const connection = getConnection()

  try {
    // Get current balance first
    const { balance, vaultAddress } = await getCreatorVaultBalance(keypair.publicKey)

    if (balance <= 0) {
      return { success: false, error: "No rewards to claim" }
    }

    console.log(`[PUMP] Claiming ${balance} SOL from vault ${vaultAddress}`)

    // Use PumpPortal API for creator reward claims
    const tradeBody = {
      publicKey: keypair.publicKey.toBase58(),
      action: "collectCreatorFee",
      mint: tokenMint,
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
      console.error("[PUMP] PumpPortal error:", errorText)

      // Fallback: Try direct vault withdrawal (only works if vault is regular account)
      try {
        const vaultPubkey = new PublicKey(vaultAddress)
        const { SystemProgram, Transaction } = await import("@solana/web3.js")
        const transaction = new Transaction()

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized")
        transaction.recentBlockhash = blockhash
        transaction.feePayer = keypair.publicKey

        transaction.add(
          SystemProgram.transfer({
            fromPubkey: vaultPubkey,
            toPubkey: keypair.publicKey,
            lamports: Math.floor(balance * LAMPORTS_PER_SOL),
          }),
        )

        transaction.sign(keypair)

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        })

        await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        )

        console.log(`[PUMP] Claim executed (direct fallback): ${signature}`)
        return {
          success: true,
          amount: balance,
          txSignature: signature,
        }
      } catch (fallbackError) {
        return {
          success: false,
          error: `Unable to claim via API. Please visit https://pump.fun/coin/${tokenMint} to claim your ${balance.toFixed(6)} SOL rewards directly.`,
        }
      }
    }

    // Deserialize and sign the transaction from PumpPortal
    const txBytes = new Uint8Array(await pumpResponse.arrayBuffer())
    const tx = VersionedTransaction.deserialize(txBytes)
    tx.sign([keypair])

    // Send to RPC
    console.log("[PUMP] Submitting claim transaction...")
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    })

    // Confirm transaction
    const confirmation = await connection.confirmTransaction(signature, "confirmed")

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
    }

    console.log("[PUMP] Claim successful:", signature)

    return {
      success: true,
      amount: balance,
      txSignature: signature,
    }
  } catch (error) {
    console.error("[PUMP] Claim error:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Claim failed",
    }
  }
}
