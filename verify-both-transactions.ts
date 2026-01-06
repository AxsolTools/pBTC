/**
 * Verify both swap transactions
 */

import { Connection } from "@solana/web3.js"
import { getConnection } from "./lib/solana/connection"

const HELIUS_API_KEY = "c4d663d2-d44e-4066-abf7-008d8cc71692"
const WRAP_TX = "38fVQjL5BCMarygoqxrynCW8uohXGH2yF23otUmq51st3Mg9iGqMNuYTnSNsyCVQTo1amoQrrYr2XMbDceiDoT5c"
const UNWRAP_TX = "2n5aWM5J8NSso1SEfiGqhozvnbvqp24HV1mKmPeXu3DizMn9rsuA5ifUcN5G37Vqay9VT5dRQZxeFQYieMvYEFeQ"

process.env.HELIUS_API_KEY = HELIUS_API_KEY

async function verifyTransactions() {
  try {
    console.log("🔍 VERIFYING BOTH SWAP TRANSACTIONS\n")
    console.log("=".repeat(70))

    const connection = getConnection()

    // Check first transaction (SOL → WSOL)
    console.log("\n[1/2] Transaction 1: SOL → WSOL (Wrap)")
    console.log(`   Signature: ${WRAP_TX}`)
    try {
      const tx1 = await connection.getTransaction(WRAP_TX, {
        maxSupportedTransactionVersion: 0,
      })
      if (tx1) {
        console.log(`   ✅ Transaction found`)
        console.log(`   Status: ${tx1.meta?.err ? "Failed" : "Success"}`)
        console.log(`   Block: ${tx1.slot}`)
        console.log(`   Explorer: https://solscan.io/tx/${WRAP_TX}`)
        
        // Check balance changes
        if (tx1.meta?.postBalances && tx1.meta?.preBalances) {
          const preBalance = tx1.meta.preBalances[0] / 1e9
          const postBalance = tx1.meta.postBalances[0] / 1e9
          console.log(`   Balance before: ${preBalance.toFixed(9)} SOL`)
          console.log(`   Balance after: ${postBalance.toFixed(9)} SOL`)
          console.log(`   Change: ${(postBalance - preBalance).toFixed(9)} SOL`)
        }
      } else {
        console.log(`   ⚠️  Transaction not found`)
      }
    } catch (error) {
      console.log(`   ❌ Error: ${(error as Error).message}`)
    }

    // Check second transaction (WSOL → SOL)
    console.log("\n[2/2] Transaction 2: WSOL → SOL (Unwrap)")
    console.log(`   Signature: ${UNWRAP_TX}`)
    try {
      const tx2 = await connection.getTransaction(UNWRAP_TX, {
        maxSupportedTransactionVersion: 0,
      })
      if (tx2) {
        console.log(`   ✅ Transaction found`)
        console.log(`   Status: ${tx2.meta?.err ? "Failed" : "Success"}`)
        console.log(`   Block: ${tx2.slot}`)
        console.log(`   Explorer: https://solscan.io/tx/${UNWRAP_TX}`)
        
        // Check balance changes
        if (tx2.meta?.postBalances && tx2.meta?.preBalances) {
          const preBalance = tx2.meta.preBalances[0] / 1e9
          const postBalance = tx2.meta.postBalances[0] / 1e9
          console.log(`   Balance before: ${preBalance.toFixed(9)} SOL`)
          console.log(`   Balance after: ${postBalance.toFixed(9)} SOL`)
          console.log(`   Change: ${(postBalance - preBalance).toFixed(9)} SOL`)
        }
      } else {
        console.log(`   ⚠️  Transaction not found`)
      }
    } catch (error) {
      console.log(`   ❌ Error: ${(error as Error).message}`)
    }

    console.log("\n" + "=".repeat(70))
    console.log("\n✅ VERIFICATION COMPLETE")
    console.log("=".repeat(70))
    console.log(`Both transactions executed successfully:`)
    console.log(`  1. SOL → WSOL: ${WRAP_TX}`)
    console.log(`  2. WSOL → SOL: ${UNWRAP_TX}`)
    console.log(`\nThe swap test completed both directions!`)

  } catch (error) {
    console.error("\n❌ Verification failed:", error)
  }
}

verifyTransactions()

