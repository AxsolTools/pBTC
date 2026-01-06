/**
 * Verify the claim was successful by checking vault balance
 */

import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { getConnection } from "./lib/solana/connection"
import { getCreatorVaultBalance } from "./lib/solana/claim-rewards"

const CREATOR_WALLET = "AbiN8j5FpvaBH9q9KkLQ9f7K7Kpa5TLfagfzpowCikto"
const HELIUS_API_KEY = "c4d663d2-d44e-4066-abf7-008d8cc71692"
const TX_SIGNATURE = "5mLTtPSTZr3u7vXoYeDeYTC1CdxuCSM5QSsTdXHMmi5i4YhP7VCkAVvqUy1bZJgadW5TyciktsLfYTEVRfU884tY"

process.env.HELIUS_API_KEY = HELIUS_API_KEY

async function verifyClaim() {
  try {
    console.log("🔍 VERIFYING CLAIM SUCCESS\n")
    console.log("=".repeat(70))
    
    const connection = getConnection()
    const creatorPubkey = new PublicKey(CREATOR_WALLET)
    
    // Check vault balance (should be 0 now)
    console.log("\n[1/2] Checking vault balance after claim...")
    const { balance, vaultAddress } = await getCreatorVaultBalance(creatorPubkey)
    console.log(`   Vault: ${vaultAddress}`)
    console.log(`   Balance: ${balance.toFixed(9)} SOL`)
    
    if (balance === 0) {
      console.log(`   ✅ Vault is empty - claim was successful!`)
    } else {
      console.log(`   ⚠️  Vault still has ${balance.toFixed(6)} SOL`)
    }
    
    // Check transaction status
    console.log("\n[2/2] Checking transaction status...")
    try {
      const txStatus = await connection.getSignatureStatus(TX_SIGNATURE)
      if (txStatus.value) {
        console.log(`   Transaction: ${TX_SIGNATURE}`)
        console.log(`   Status: ${txStatus.value.confirmationStatus || 'unknown'}`)
        if (txStatus.value.err) {
          console.log(`   ❌ Transaction had error: ${JSON.stringify(txStatus.value.err)}`)
        } else {
          console.log(`   ✅ Transaction confirmed successfully!`)
        }
        console.log(`   Explorer: https://solscan.io/tx/${TX_SIGNATURE}`)
      }
    } catch (error) {
      console.log(`   ⚠️  Could not check transaction status: ${(error as Error).message}`)
    }
    
    // Check wallet balance
    console.log("\n[3/3] Checking wallet balance...")
    const walletBalance = await connection.getBalance(creatorPubkey)
    console.log(`   Wallet: ${CREATOR_WALLET}`)
    console.log(`   Balance: ${(walletBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`)
    
    console.log("\n" + "=".repeat(70))
    console.log("\n✅ CLAIM VERIFICATION COMPLETE")
    console.log("=".repeat(70))
    console.log(`Transaction: ${TX_SIGNATURE}`)
    console.log(`Vault Balance After: ${balance.toFixed(9)} SOL`)
    console.log(`Wallet Balance: ${(walletBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`)
    
    if (balance === 0) {
      console.log(`\n🎉 SUCCESS! Rewards were claimed and vault is now empty.`)
    }
    
  } catch (error) {
    console.error("\n❌ Verification failed:", error)
  }
}

verifyClaim()

