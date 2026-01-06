import { type Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js"
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token"
import { getConnection, WSOL_MINT } from "./connection"

interface DistributionResult {
  wallet: string
  amount: number
  txSignature?: string
  success: boolean
  error?: string
}

/**
 * Distribute WSOL to top 25 holders proportionally
 */
export async function distributeToHolders(
  keypair: Keypair,
  wsolAmount: number,
  holders: { wallet: string; balance: number; rank: number }[],
): Promise<DistributionResult[]> {
  const connection = getConnection()
  const results: DistributionResult[] = []
  const wsolMint = new PublicKey(WSOL_MINT)

  // Calculate total holdings for proportional distribution
  const totalHoldings = holders.reduce((sum, h) => sum + h.balance, 0)

  // Get source WSOL token account
  const sourceAta = await getAssociatedTokenAddress(wsolMint, keypair.publicKey)

  for (const holder of holders) {
    try {
      // Calculate proportional share
      const share = (holder.balance / totalHoldings) * wsolAmount
      const shareLamports = Math.floor(share * 1e9) // WSOL has 9 decimals (same as SOL)

      if (shareLamports <= 0) {
        results.push({
          wallet: holder.wallet,
          amount: 0,
          success: false,
          error: "Share too small",
        })
        continue
      }

      const destinationWallet = new PublicKey(holder.wallet)
      const destinationAta = await getAssociatedTokenAddress(wsolMint, destinationWallet)

      const transaction = new Transaction()

      // Check if destination ATA exists
      try {
        await getAccount(connection, destinationAta)
      } catch {
        // Create ATA if it doesn't exist
        transaction.add(
          createAssociatedTokenAccountInstruction(keypair.publicKey, destinationAta, destinationWallet, wsolMint),
        )
      }

      // Add transfer instruction
      transaction.add(createTransferInstruction(sourceAta, destinationAta, keypair.publicKey, shareLamports))

      const signature = await sendAndConfirmTransaction(connection, transaction, [keypair])

      results.push({
        wallet: holder.wallet,
        amount: share,
        txSignature: signature,
        success: true,
      })

      console.log(`[DISTRIBUTE] Sent ${share} WSOL to ${holder.wallet.slice(0, 8)}...`)
    } catch (error) {
      results.push({
        wallet: holder.wallet,
        amount: 0,
        success: false,
        error: error instanceof Error ? error.message : "Distribution failed",
      })
    }
  }

  return results
}
