import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { decryptPrivateKey } from "@/lib/crypto/encryption"
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import { getCreatorVaultBalance, claimCreatorRewards } from "@/lib/solana/claim-rewards"
import { buyPbtcWithSol, swapSolToWsol } from "@/lib/solana/swap"
import { distributeToHolders } from "@/lib/solana/distribute"
import { getTopHolders } from "@/lib/solana/holders"
import { PBTC_TOKEN_MINT, getConnection } from "@/lib/solana/connection"

/**
 * Get the dev wallet keypair from environment or Supabase
 */
async function getDevWalletKeypair(): Promise<Keypair> {
  const envPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY
  if (envPrivateKey) {
    console.log("[ADMIN] Using private key from environment variable")
    if (envPrivateKey.startsWith("v1:")) {
      console.log("[ADMIN] Detected encrypted private key, decrypting...")
      const supabase = getAdminClient()
      const { data: saltConfig, error: saltError } = await supabase
        .from("system_config")
        .select("value")
        .eq("key", "service_salt")
        .single()

      if (saltError || !saltConfig?.value) {
        throw new Error("Encrypted DEV_WALLET_PRIVATE_KEY requires service_salt in Supabase.")
      }

      const privateKey = decryptPrivateKey(envPrivateKey, "pbtc-dev-wallet", saltConfig.value)
      return Keypair.fromSecretKey(bs58.decode(privateKey))
    }
    
    // Try plaintext formats (base58 or JSON array)
    try {
      console.log("[ADMIN] Trying base58 format...")
      const decoded = bs58.decode(envPrivateKey)
      if (decoded.length !== 64) {
        throw new Error(`Invalid key length: ${decoded.length}, expected 64`)
      }
      const keypair = Keypair.fromSecretKey(decoded)
      console.log(`[ADMIN] ✅ Keypair created from base58: ${keypair.publicKey.toBase58()}`)
      return keypair
    } catch (base58Error) {
      console.log(`[ADMIN] Base58 failed: ${base58Error instanceof Error ? base58Error.message : String(base58Error)}`)
      console.log("[ADMIN] Trying JSON array format...")
      // Try JSON array format
      try {
        const parsed = JSON.parse(envPrivateKey)
        if (Array.isArray(parsed)) {
          const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed))
          console.log(`[ADMIN] ✅ Keypair created from JSON array: ${keypair.publicKey.toBase58()}`)
          return keypair
        } else {
          throw new Error("JSON is not an array")
        }
      } catch (jsonError) {
        console.error(`[ADMIN] JSON parse error: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`)
        throw new Error(`Invalid DEV_WALLET_PRIVATE_KEY format. Base58 error: ${base58Error instanceof Error ? base58Error.message : String(base58Error)}`)
      }
    }
  }

  const supabase = getAdminClient()
  const { data: walletConfig, error: walletError } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", "dev_wallet_encrypted")
    .single()

  const { data: saltConfig, error: saltError } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", "service_salt")
    .single()

  if (walletError || saltError || !walletConfig?.value || !saltConfig?.value) {
    throw new Error("Wallet not configured.")
  }

  const privateKey = decryptPrivateKey(walletConfig.value, "pbtc-dev-wallet", saltConfig.value)
  return Keypair.fromSecretKey(bs58.decode(privateKey))
}

export async function POST(request: Request) {
  console.log("[ADMIN] ========================================")
  console.log("[ADMIN] 🚀 BUYBACK TRIGGERED MANUALLY")
  console.log("[ADMIN] ========================================")
  try {
    const supabase = getAdminClient()
    const keypair = await getDevWalletKeypair()
    console.log(`[ADMIN] ✅ Using wallet: ${keypair.publicKey.toBase58()}`)

    // Step 1: Check vault balance and wallet balance
    const { balance: vaultBalance } = await getCreatorVaultBalance(keypair.publicKey)
    console.log(`[ADMIN] Vault balance: ${vaultBalance} SOL`)

    // Also check wallet balance (might have SOL from previous claims)
    const connection = getConnection()
    const walletBalance = await connection.getBalance(keypair.publicKey)
    const walletBalanceSol = walletBalance / 1e9
    console.log(`[ADMIN] Wallet balance: ${walletBalanceSol} SOL`)

    // Step 2: Claim rewards (always attempt, even if vault balance is low)
    console.log(`[ADMIN] 📥 Step 2: Claiming creator rewards...`)
    const claimResult = await claimCreatorRewards(keypair, PBTC_TOKEN_MINT)
    
    if (claimResult.success) {
      console.log(`[ADMIN] ✅ Claimed ${claimResult.amount} SOL`)
      console.log(`[ADMIN] 📝 TX: ${claimResult.txSignature}`)
    } else {
      console.log(`[ADMIN] Claim skipped or failed: ${claimResult.error}`)
      // Continue anyway - might have SOL in wallet already
    }

    // Determine amount to use: claimed amount or wallet balance (minus fees)
    let solAmount = 0
    if (claimResult.success && claimResult.amount) {
      solAmount = claimResult.amount
    } else {
      // Use wallet balance minus 0.01 SOL for fees
      const availableBalance = Math.max(0, walletBalanceSol - 0.01)
      if (availableBalance > 0) {
        console.log(`[ADMIN] Using wallet balance: ${availableBalance} SOL (from previous claims)`)
        solAmount = availableBalance
      } else {
        console.log(`[ADMIN] No SOL available (vault: ${vaultBalance}, wallet: ${walletBalanceSol})`)
        return NextResponse.json({
          success: false,
          message: `No SOL available to process. Vault: ${vaultBalance} SOL, Wallet: ${walletBalanceSol} SOL`,
          vaultBalance,
          walletBalance: walletBalanceSol,
        }, { status: 400 })
      }
    }

    // If claim failed but we have wallet balance, proceed with that
    if (!claimResult.success && solAmount === 0) {
      return NextResponse.json({ 
        success: false, 
        error: claimResult.error || "No SOL available",
        vaultBalance,
        walletBalance: walletBalanceSol,
      }, { status: 500 })
    }

    // Log buyback activity
    const { data: buyback } = await supabase
      .from("buybacks")
      .insert({
        sol_amount: solAmount,
        tx_signature: claimResult.txSignature || null,
        status: "processing",
      })
      .select()
      .single()

    await supabase.from("activity_log").insert({
      type: "buyback",
      amount: solAmount,
      token_symbol: "SOL",
      tx_signature: claimResult.txSignature || null,
      status: claimResult.success ? "completed" : "using_wallet_balance",
    })

    // Step 3: Split claimed SOL: 50% for buying pBTC, 50% for WSOL distribution
    // Reserve 0.01 SOL total for transaction fees
    const feeReserve = 0.01
    const availableForOperations = Math.max(0, solAmount - feeReserve)
    const buybackAmount = availableForOperations * 0.5  // 50% for buying pBTC
    const distributionAmount = availableForOperations * 0.5  // 50% for WSOL distribution
    
    console.log(`[ADMIN] 💰 Split claimed SOL: ${solAmount} SOL total`)
    console.log(`[ADMIN]   - Reserved for fees: ${feeReserve} SOL`)
    console.log(`[ADMIN]   - For buyback: ${buybackAmount.toFixed(6)} SOL (50%)`)
    console.log(`[ADMIN]   - For distribution: ${distributionAmount.toFixed(6)} SOL (50%)`)

    // Step 3a: Buy pBTC tokens with 50% of claimed SOL
    console.log(`[ADMIN] 🛒 Step 3: Buying pBTC with ${buybackAmount.toFixed(6)} SOL (50% of claimed)...`)
    const buyResult = await buyPbtcWithSol(keypair, buybackAmount)
    
    if (buyResult.success) {
      console.log(`[ADMIN] ✅ Bought pBTC tokens, spent ${buyResult.solSpent} SOL`)
      console.log(`[ADMIN] 📝 TX: ${buyResult.txSignature}`)
    } else {
      console.error(`[ADMIN] ❌ Buy failed after retries: ${buyResult.error}`)
      console.error(`[ADMIN] ⚠️  Buyback step failed, but continuing with distribution...`)
      // Continue anyway - we'll still distribute the 50% allocated for distribution
    }

    // Log buyback activity
    if (buyResult.success) {
      await supabase.from("activity_log").insert({
        type: "buyback",
        amount: buyResult.solSpent,
        token_symbol: "pBTC",
        tx_signature: buyResult.txSignature,
        status: "completed",
      })
    }

    // Step 4: Swap the allocated 50% SOL to WSOL for distribution
    // Check wallet balance after buy to ensure we have enough SOL for the swap
    // Reuse existing connection variable
    const walletBalanceAfterBuy = await connection.getBalance(keypair.publicKey)
    const walletBalanceSolAfterBuy = walletBalanceAfterBuy / 1e9
    
    // Use the allocated distribution amount, but don't exceed what's actually available
    // Reserve 0.005 SOL for swap transaction fees
    const swapFeeReserve = 0.005
    const availableForSwap = Math.max(0, walletBalanceSolAfterBuy - swapFeeReserve)
    const solToSwap = Math.min(distributionAmount, availableForSwap)
    
    if (solToSwap <= 0.001) { // Minimum 0.001 SOL needed
      console.log(`[ADMIN] No SOL available to swap to WSOL (allocated: ${distributionAmount.toFixed(6)} SOL, available: ${walletBalanceSolAfterBuy.toFixed(6)} SOL)`)
      return NextResponse.json({
        success: true,
        message: "Buyback complete, no remaining SOL for distribution",
        buyback: buyback?.id,
        buyResult: buyResult.success ? { txSignature: buyResult.txSignature, solSpent: buyResult.solSpent } : null,
        distributionAmount: solToSwap,
        walletBalanceAfterBuy: walletBalanceSolAfterBuy,
      })
    }

    console.log(`[ADMIN] 🔄 Step 4: Swapping ${solToSwap.toFixed(6)} SOL (50% of claimed, ${walletBalanceSolAfterBuy.toFixed(6)} SOL available) to WSOL for distribution...`)
    const swapResult = await swapSolToWsol(keypair, solToSwap)
    
    if (swapResult.success) {
      console.log(`[ADMIN] ✅ Swapped to ${swapResult.outputAmount} WSOL`)
      console.log(`[ADMIN] 📝 TX: ${swapResult.txSignature}`)
    } else {
      console.error(`[ADMIN] ❌ Swap failed: ${swapResult.error}`)
    }

    if (!swapResult.success) {
      await supabase.from("buybacks").update({ status: "failed" }).eq("id", buyback?.id)
      return NextResponse.json({ error: swapResult.error }, { status: 500 })
    }

    // Log swap activity
    await supabase.from("activity_log").insert({
      type: "swap",
      amount: swapResult.outputAmount,
      token_symbol: "WSOL",
      tx_signature: swapResult.txSignature,
      status: "completed",
    })

    // Update buyback with WSOL amount
    const completedAt = new Date().toISOString()
    await supabase
      .from("buybacks")
      .update({
        wbtc_amount: swapResult.outputAmount,
        status: "completed",
        completed_at: completedAt,
      })
      .eq("id", buyback?.id)

    await supabase.from("system_config").upsert({
      key: "countdown_start_time",
      value: completedAt,
    })

    // Step 5: Get top 25 holders
    const holders = await getTopHolders()

    if (holders.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Buyback complete, no holders to distribute",
        buyback: buyback?.id,
      })
    }

    // Update holders table - explicitly clear old reward data first
    await supabase.from("holders").delete().neq("id", "")
    await supabase.from("holders").insert(
      holders.map((h) => ({
        wallet_address: h.wallet,
        pbtc_balance: h.balance,
        rank: h.rank,
        last_reward_amount: null, // Explicitly set to null - only updated after successful distribution
        last_reward_at: null, // Explicitly set to null - only updated after successful distribution
        updated_at: new Date().toISOString(),
      })),
    )

    // Step 6: Distribute WSOL to holders
    console.log(`[ADMIN] 💰 Step 5: Distributing ${swapResult.outputAmount} WSOL to ${holders.length} holders...`)
    const distributions = await distributeToHolders(keypair, swapResult.outputAmount!, holders)
    
    const successful = distributions.filter(d => d.success).length
    console.log(`[ADMIN] ✅ Distributed to ${successful}/${holders.length} holders`)

    // Only update last_reward for holders who actually received distributions
    for (const dist of distributions) {
      if (dist.success) {
        await supabase.from("distributions").insert({
          buyback_id: buyback?.id,
          wallet_address: dist.wallet,
          wbtc_amount: dist.amount,
          holder_rank: holders.find((h) => h.wallet === dist.wallet)?.rank || 0,
          tx_signature: dist.txSignature,
          status: "completed",
          completed_at: new Date().toISOString(),
        })

        await supabase.from("activity_log").insert({
          type: "distribution",
          amount: dist.amount,
          token_symbol: "WSOL",
          wallet_address: dist.wallet,
          tx_signature: dist.txSignature,
          status: "completed",
        })

        await supabase
          .from("holders")
          .update({
            last_reward_amount: dist.amount,
            last_reward_at: new Date().toISOString(),
          })
          .eq("wallet_address", dist.wallet)
      }
    }

    return NextResponse.json({
      success: true,
      buyback: {
        id: buyback?.id,
        solAmount: solAmount,
        wsolAmount: swapResult.outputAmount,
      },
      distributions: distributions.filter((d) => d.success).length,
      totalDistributed: distributions.filter((d) => d.success).reduce((sum, d) => sum + d.amount, 0),
      claimSuccess: claimResult.success,
    })
  } catch (error) {
    console.error("[ADMIN] Buyback error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Buyback failed" }, { status: 500 })
  }
}

