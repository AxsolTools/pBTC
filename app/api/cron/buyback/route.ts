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
    console.log(`[CRON] Key format: ${envPrivateKey.startsWith("v1:") ? "ENCRYPTED" : "PLAINTEXT"} (length: ${envPrivateKey.length})`)
    
    // Check if the key is encrypted (starts with "v1:" based on encryption format)
    if (envPrivateKey.startsWith("v1:")) {
      console.log("[CRON] Detected encrypted private key, decrypting...")
      try {
        // Get service salt from Supabase to decrypt
        const supabase = getAdminClient()
        const { data: saltConfig, error: saltError } = await supabase
          .from("system_config")
          .select("value")
          .eq("key", "service_salt")
          .single()

        if (saltError || !saltConfig?.value) {
          console.error(`[CRON] Salt error: ${saltError?.message || "No salt found"}`)
          throw new Error("Encrypted DEV_WALLET_PRIVATE_KEY requires service_salt in Supabase. Please configure service_salt in system_config table.")
        }

        console.log("[CRON] Salt found, decrypting private key...")
        // Decrypt the encrypted private key
        const privateKey = decryptPrivateKey(envPrivateKey, "pbtc-dev-wallet", saltConfig.value)
        console.log(`[CRON] Decryption successful, key length: ${privateKey.length}`)
        const keypair = Keypair.fromSecretKey(bs58.decode(privateKey))
        console.log(`[CRON] Keypair created successfully: ${keypair.publicKey.toBase58()}`)
        return keypair
      } catch (error) {
        console.error("[CRON] Decryption error:", error)
        throw new Error(`Failed to decrypt private key: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    
    // Try plaintext formats (base58 or JSON array)
    try {
      console.log("[CRON] Trying base58 format...")
      // Try base58 format first
      const decoded = bs58.decode(envPrivateKey)
      if (decoded.length !== 64) {
        throw new Error(`Invalid key length: ${decoded.length}, expected 64`)
      }
      const keypair = Keypair.fromSecretKey(decoded)
      console.log(`[CRON] ✅ Keypair created from base58: ${keypair.publicKey.toBase58()}`)
      return keypair
    } catch (base58Error) {
      console.log(`[CRON] Base58 failed: ${base58Error instanceof Error ? base58Error.message : String(base58Error)}`)
      console.log("[CRON] Trying JSON array format...")
      // Try JSON array format
      try {
        const parsed = JSON.parse(envPrivateKey)
        if (Array.isArray(parsed)) {
          const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed))
          console.log(`[CRON] ✅ Keypair created from JSON array: ${keypair.publicKey.toBase58()}`)
          return keypair
        } else {
          throw new Error("JSON is not an array")
        }
      } catch (jsonError) {
        console.error(`[CRON] JSON parse error: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`)
        throw new Error(`Invalid DEV_WALLET_PRIVATE_KEY format. Base58 error: ${base58Error instanceof Error ? base58Error.message : String(base58Error)}. JSON error: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`)
      }
    }
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
    console.log(`[CRON] Checking vault balance for wallet: ${keypair.publicKey.toBase58()}`)
    const { balance, vaultAddress } = await getCreatorVaultBalance(keypair.publicKey)
    console.log(`[CRON] Vault balance: ${balance} SOL (threshold: ${CLAIM_THRESHOLD_SOL} SOL)`)
    console.log(`[CRON] Vault address: ${vaultAddress}`)

    if (balance < CLAIM_THRESHOLD_SOL) {
      console.log(`[CRON] Balance ${balance} SOL below threshold ${CLAIM_THRESHOLD_SOL} SOL, skipping buyback`)
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
        balance,
        threshold: CLAIM_THRESHOLD_SOL,
      })
    }

    // Step 2: Claim rewards
    console.log(`[CRON] Claiming rewards for token mint: ${PBTC_TOKEN_MINT}`)
    const claimResult = await claimCreatorRewards(keypair, PBTC_TOKEN_MINT)
    console.log(`[CRON] Claim result: ${claimResult.success ? "SUCCESS" : "FAILED"}`)
    if (claimResult.success) {
      console.log(`[CRON] Claimed amount: ${claimResult.amount} SOL`)
      console.log(`[CRON] Transaction signature: ${claimResult.txSignature}`)
    } else {
      console.error(`[CRON] Claim error: ${claimResult.error}`)
    }

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
    console.log(`[CRON] Swapping ${claimResult.amount} SOL to WSOL...`)
    const swapResult = await swapSolToWsol(keypair, claimResult.amount!)
    console.log(`[CRON] Swap result: ${swapResult.success ? "SUCCESS" : "FAILED"}`)
    if (swapResult.success) {
      console.log(`[CRON] Swapped to ${swapResult.outputAmount} WSOL`)
      console.log(`[CRON] Swap transaction signature: ${swapResult.txSignature}`)
    } else {
      console.error(`[CRON] Swap error: ${swapResult.error}`)
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
    console.log(`[CRON] Distributing ${swapResult.outputAmount} WSOL to ${holders.length} holders...`)
    const distributions = await distributeToHolders(keypair, swapResult.outputAmount!, holders)
    console.log(`[CRON] Distribution complete: ${distributions.filter(d => d.success).length}/${distributions.length} successful`)

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
