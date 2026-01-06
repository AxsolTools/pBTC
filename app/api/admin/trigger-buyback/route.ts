import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { decryptPrivateKey } from "@/lib/crypto/encryption"
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import { getCreatorVaultBalance, claimCreatorRewards } from "@/lib/solana/claim-rewards"
import { swapSolToWsol } from "@/lib/solana/swap"
import { distributeToHolders } from "@/lib/solana/distribute"
import { getTopHolders } from "@/lib/solana/holders"
import { CLAIM_THRESHOLD_SOL, PBTC_TOKEN_MINT } from "@/lib/solana/connection"

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
    
    try {
      return Keypair.fromSecretKey(bs58.decode(envPrivateKey))
    } catch {
      try {
        const parsed = JSON.parse(envPrivateKey)
        if (Array.isArray(parsed)) {
          return Keypair.fromSecretKey(Uint8Array.from(parsed))
        }
      } catch {
        throw new Error("Invalid DEV_WALLET_PRIVATE_KEY format.")
      }
    }
    throw new Error("Failed to parse DEV_WALLET_PRIVATE_KEY")
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
  try {
    const supabase = getAdminClient()
    const keypair = await getDevWalletKeypair()
    console.log(`[ADMIN] Using wallet: ${keypair.publicKey.toBase58()}`)

    // Step 1: Check vault balance
    const { balance } = await getCreatorVaultBalance(keypair.publicKey)

    if (balance < CLAIM_THRESHOLD_SOL) {
      return NextResponse.json({
        success: false,
        message: `Balance ${balance} SOL below threshold ${CLAIM_THRESHOLD_SOL} SOL`,
        balance,
        threshold: CLAIM_THRESHOLD_SOL,
      })
    }

    // Step 2: Claim rewards
    const claimResult = await claimCreatorRewards(keypair, PBTC_TOKEN_MINT)

    if (!claimResult.success) {
      return NextResponse.json({ error: claimResult.error }, { status: 500 })
    }

    // Log buyback activity
    const { data: buyback } = await supabase
      .from("buybacks")
      .insert({
        sol_amount: claimResult.amount,
        tx_signature: claimResult.txSignature,
        status: "processing",
      })
      .select()
      .single()

    await supabase.from("activity_log").insert({
      type: "buyback",
      amount: claimResult.amount,
      token_symbol: "SOL",
      tx_signature: claimResult.txSignature,
      status: "completed",
    })

    // Step 3: Wrap SOL to WSOL
    const swapResult = await swapSolToWsol(keypair, claimResult.amount!)

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

    // Step 4: Get top 25 holders
    const holders = await getTopHolders()

    if (holders.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Buyback complete, no holders to distribute",
        buyback: buyback?.id,
      })
    }

    // Update holders table
    await supabase.from("holders").delete().neq("id", "")
    await supabase.from("holders").insert(
      holders.map((h) => ({
        wallet_address: h.wallet,
        pbtc_balance: h.balance,
        rank: h.rank,
        updated_at: new Date().toISOString(),
      })),
    )

    // Step 5: Distribute WSOL to holders
    const distributions = await distributeToHolders(keypair, swapResult.outputAmount!, holders)

    // Log distributions
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
        solAmount: claimResult.amount,
        wsolAmount: swapResult.outputAmount,
      },
      distributions: distributions.filter((d) => d.success).length,
      totalDistributed: distributions.filter((d) => d.success).reduce((sum, d) => sum + d.amount, 0),
    })
  } catch (error) {
    console.error("[ADMIN] Buyback error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Buyback failed" }, { status: 500 })
  }
}

