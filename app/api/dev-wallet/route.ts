import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"

/**
 * Get dev wallet public key from ENV
 */
function getDevWalletPublicKey(): string | null {
  try {
    const envPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY
    if (envPrivateKey) {
      try {
        const keypair = Keypair.fromSecretKey(bs58.decode(envPrivateKey))
        return keypair.publicKey.toBase58()
      } catch {
        try {
          const parsed = JSON.parse(envPrivateKey)
          if (Array.isArray(parsed)) {
            const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed))
            return keypair.publicKey.toBase58()
          }
        } catch {
          // Invalid format
        }
      }
    }
  } catch {
    // Could not get dev wallet
  }
  return null
}

/**
 * Get dev wallet activities: buybacks, distributions, and last reward times
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // buybacks, distributions, rewards

    const devWalletAddress = getDevWalletPublicKey()
    if (!devWalletAddress) {
      return NextResponse.json({ 
        error: "Dev wallet not configured",
        buybacks: [],
        distributions: [],
        rewards: []
      })
    }

    const supabase = getAdminClient()

    // Get buybacks (from activity_log where wallet is dev wallet)
    let buybacks: any[] = []
    try {
      const { data } = await supabase
        .from("activity_log")
        .select("*")
        .eq("type", "buyback")
        .eq("wallet_address", devWalletAddress)
        .order("created_at", { ascending: false })
        .limit(50)

      if (data) {
        buybacks = data.map((b: any) => ({
          id: b.id,
          amount: parseFloat(b.amount),
          token_symbol: b.token_symbol,
          tx_signature: b.tx_signature,
          created_at: b.created_at,
        }))
      }
    } catch (err) {
      console.warn("[DEV-WALLET] Could not fetch buybacks:", err)
    }

    // Get distributions (from activity_log where type is distribution)
    let distributions: any[] = []
    try {
      const { data } = await supabase
        .from("activity_log")
        .select("*")
        .eq("type", "distribution")
        .order("created_at", { ascending: false })
        .limit(100)

      if (data) {
        distributions = data.map((d: any) => ({
          id: d.id,
          amount: parseFloat(d.amount),
          token_symbol: d.token_symbol,
          wallet_address: d.wallet_address,
          tx_signature: d.tx_signature,
          created_at: d.created_at,
        }))
      }
    } catch (err) {
      console.warn("[DEV-WALLET] Could not fetch distributions:", err)
    }

    // Get last reward times (from holders table)
    let rewards: any[] = []
    try {
      const { data } = await supabase
        .from("holders")
        .select("wallet_address, last_reward_amount, last_reward_at, rank")
        .not("last_reward_at", "is", null)
        .order("last_reward_at", { ascending: false })
        .limit(50)

      if (data) {
        rewards = data.map((r: any) => ({
          wallet_address: r.wallet_address,
          rank: r.rank,
          last_reward_amount: r.last_reward_amount ? parseFloat(r.last_reward_amount) : null,
          last_reward_at: r.last_reward_at,
        }))
      }
    } catch (err) {
      console.warn("[DEV-WALLET] Could not fetch rewards:", err)
    }

    // Filter by type if specified
    if (type === "buybacks") {
      return NextResponse.json({ buybacks })
    } else if (type === "distributions") {
      return NextResponse.json({ distributions })
    } else if (type === "rewards") {
      return NextResponse.json({ rewards })
    }

    return NextResponse.json({
      dev_wallet: devWalletAddress,
      buybacks,
      distributions,
      rewards,
    })
  } catch (error) {
    console.error("[DEV-WALLET] Error:", error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : "Unknown error",
      buybacks: [],
      distributions: [],
      rewards: []
    })
  }
}

