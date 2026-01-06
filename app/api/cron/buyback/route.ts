import { NextResponse } from "next/server"
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"
import { getAdminClient } from "@/lib/supabase/admin"
import { decryptPrivateKey } from "@/lib/crypto/encryption"
import { getCreatorVaultBalance, claimCreatorRewards } from "@/lib/solana/claim-rewards"
import { swapSolToWsol } from "@/lib/solana/swap"
import { distributeToHolders } from "@/lib/solana/distribute"
import { getTopHolders } from "@/lib/solana/holders"
import { CLAIM_THRESHOLD_SOL, PBTC_TOKEN_MINT } from "@/lib/solana/connection"

/**
 * Get the dev wallet keypair from environment or Supabase
 * Priority: ENV VAR (DigitalOcean) > Supabase encrypted storage
 */
async function getDevWalletKeypair(): Promise<Keypair> {
  // Option 1: Direct private key from DigitalOcean environment variable
  const envPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY
  if (envPrivateKey) {
    console.log("[CRON] Using private key from environment variable")
    try {
      // Try base58 format first
      return Keypair.fromSecretKey(bs58.decode(envPrivateKey))
    } catch {
      // Try JSON array format
      try {
        const parsed = JSON.parse(envPrivateKey)
        if (Array.isArray(parsed)) {
          return Keypair.fromSecretKey(Uint8Array.from(parsed))
        }
      } catch {
        throw new Error("Invalid DEV_WALLET_PRIVATE_KEY format. Use base58 or JSON array.")
      }
    }
    throw new Error("Failed to parse DEV_WALLET_PRIVATE_KEY")
  }

  // Option 2: Encrypted private key from Supabase
  console.log("[CRON] Fetching encrypted wallet from Supabase")
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
    throw new Error("Wallet not configured in environment or Supabase. Set DEV_WALLET_PRIVATE_KEY env var or configure in Supabase.")
  }

  // Decrypt private key from Supabase
  const privateKey = decryptPrivateKey(walletConfig.value, "pbtc-dev-wallet", saltConfig.value)
  return Keypair.fromSecretKey(bs58.decode(privateKey))
}

// This endpoint is called by DigitalOcean cron every 5 minutes
export async function POST(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = getAdminClient()

    // Get dev wallet keypair (from env or Supabase)
    const keypair = await getDevWalletKeypair()
    console.log(`[CRON] Using wallet: ${keypair.publicKey.toBase58()}`)

    // Step 1: Check vault balance
    const { balance } = await getCreatorVaultBalance(keypair.publicKey)

    if (balance < CLAIM_THRESHOLD_SOL) {
      // Log activity but skip this cycle
      await supabase.from("activity_log").insert({
        type: "buyback",
        amount: 0,
        token_symbol: "SOL",
        status: "skipped",
      })

      return NextResponse.json({
        success: true,
        message: `Balance ${balance} SOL below threshold ${CLAIM_THRESHOLD_SOL} SOL`,
        skipped: true,
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

    // Update buyback with WSOL amount (using wbtc_amount column for backward compatibility)
    const completedAt = new Date().toISOString()
    await supabase
      .from("buybacks")
      .update({
        wbtc_amount: swapResult.outputAmount, // Stored in wbtc_amount column but represents WSOL
        status: "completed",
        completed_at: completedAt,
      })
      .eq("id", buyback?.id)

    // Update countdown start time to this buyback completion time for global synchronization
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
          wbtc_amount: dist.amount, // Stored in wbtc_amount column but represents WSOL
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

        // Update holder's last reward
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
    })
  } catch (error) {
    console.error("[CRON] Buyback error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Buyback failed" }, { status: 500 })
  }
}

// GET for health check
export async function GET() {
  return NextResponse.json({ status: "ok", service: "pbtc-buyback-cron" })
}
