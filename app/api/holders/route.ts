import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { getTopHolders } from "@/lib/solana/holders"

export async function GET() {
  try {
    const supabase = getAdminClient()
    
    // First, try to get holders from database (cached, faster, avoids rate limits)
    let dbHolders: any[] = []
    try {
      const { data, error } = await supabase
        .from("holders")
        .select("wallet_address, pbtc_balance, rank, last_reward_amount, last_reward_at")
        .order("rank", { ascending: true })
        .limit(25)
      
      if (!error && data && data.length > 0) {
        dbHolders = data
        console.log(`[HOLDERS] Found ${dbHolders.length} holders in database (using cached data)`)
      }
    } catch (dbError) {
      console.log("[HOLDERS] Could not fetch from database, will fetch from chain")
    }
    
    // If we have cached data, use it (avoids rate limiting)
    // Only fetch from chain if database is empty or very stale (>5 minutes old)
    let chainHolders: any[] = []
    if (dbHolders.length === 0) {
      console.log("[HOLDERS] Database empty, fetching from on-chain...")
      console.log(`[HOLDERS] PBTC_TOKEN_MINT from env: ${process.env.PBTC_TOKEN_MINT ? `${process.env.PBTC_TOKEN_MINT.slice(0, 8)}...` : "NOT SET"}`)
      chainHolders = await getTopHolders()
      console.log(`[HOLDERS] Found ${chainHolders.length} holders from chain`)
    } else {
      console.log(`[HOLDERS] Using cached database data (${dbHolders.length} holders)`)
    }
    
    // Use chain data if available, otherwise use DB data
    const holdersToUse = chainHolders.length > 0 ? chainHolders : dbHolders.map((h: any) => ({
      wallet: h.wallet_address,
      balance: h.pbtc_balance,
      rank: h.rank,
    }))
    
    // Build reward data map
    const rewardData: Record<string, { last_reward_amount: number | null; last_reward_at: string | null }> = {}
    dbHolders.forEach((h: any) => {
      rewardData[h.wallet_address] = {
        last_reward_amount: h.last_reward_amount,
        last_reward_at: h.last_reward_at,
      }
    })
    
    // Format to match expected structure, merging with reward data from DB
    const formattedHolders = holdersToUse.map((h) => ({
      id: `holder-${h.rank}`,
      wallet_address: h.wallet,
      pbtc_balance: h.balance,
      rank: h.rank,
      last_reward_amount: rewardData[h.wallet]?.last_reward_amount || null,
      last_reward_at: rewardData[h.wallet]?.last_reward_at || null,
      updated_at: new Date().toISOString(),
    }))

    console.log(`[HOLDERS] Returning ${formattedHolders.length} holders to frontend`)
    return NextResponse.json({ holders: formattedHolders })
  } catch (error) {
    console.error("[HOLDERS] Error fetching from chain:", error)
    console.error("[HOLDERS] Error details:", error instanceof Error ? error.message : String(error))
    return NextResponse.json({ 
      holders: [],
      error: error instanceof Error ? error.message : "Unknown error",
      debug: {
        mintConfigured: !!process.env.PBTC_TOKEN_MINT,
        heliusConfigured: !!process.env.HELIUS_API_KEY,
      }
    })
  }
}
