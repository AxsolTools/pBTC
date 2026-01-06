import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { getTopHolders } from "@/lib/solana/holders"

export async function GET() {
  try {
    // Always fetch holders from on-chain for real-time accuracy
    console.log("[HOLDERS] Fetching top 25 holders from on-chain...")
    console.log(`[HOLDERS] PBTC_TOKEN_MINT from env: ${process.env.PBTC_TOKEN_MINT ? `${process.env.PBTC_TOKEN_MINT.slice(0, 8)}...` : "NOT SET"}`)
    const chainHolders = await getTopHolders()
    console.log(`[HOLDERS] Found ${chainHolders.length} holders from chain`)
    
    // Get last reward info from database if available (for display purposes)
    let rewardData: Record<string, { last_reward_amount: number | null; last_reward_at: string | null }> = {}
    
    try {
      const supabase = getAdminClient()
      const { data: dbHolders } = await supabase
        .from("holders")
        .select("wallet_address, last_reward_amount, last_reward_at")
      
      if (dbHolders) {
        dbHolders.forEach((h: any) => {
          rewardData[h.wallet_address] = {
            last_reward_amount: h.last_reward_amount,
            last_reward_at: h.last_reward_at,
          }
        })
      }
    } catch (dbError) {
      // Database table doesn't exist or error - that's okay, we'll just use chain data
      console.log("[HOLDERS] Could not fetch reward data from database, using chain data only")
    }
    
    // Format to match expected structure, merging with reward data from DB
    const formattedHolders = chainHolders.map((h) => ({
      id: `chain-${h.rank}`,
      wallet_address: h.wallet,
      pbtc_balance: h.balance,
      rank: h.rank,
      last_reward_amount: rewardData[h.wallet]?.last_reward_amount || null,
      last_reward_at: rewardData[h.wallet]?.last_reward_at || null,
      updated_at: new Date().toISOString(),
    }))

    return NextResponse.json({ holders: formattedHolders })
  } catch (error) {
    console.error("[HOLDERS] Error fetching from chain:", error)
    return NextResponse.json({ holders: [] })
  }
}
