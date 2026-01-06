import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { getTopHolders } from "@/lib/solana/holders"

export async function GET() {
  try {
    const supabase = getAdminClient()

    // Try to get holders from database first
    const { data, error } = await supabase.from("holders").select("*").order("rank", { ascending: true }).limit(25)

    // If table doesn't exist or is empty, fetch from chain
    if (error || !data || data.length === 0) {
      console.log("[HOLDERS] Table empty or doesn't exist, fetching from chain...")
      const chainHolders = await getTopHolders()
      
      // Format to match database structure
      const formattedHolders = chainHolders.map((h) => ({
        id: `chain-${h.rank}`,
        wallet_address: h.wallet,
        pbtc_balance: h.balance,
        rank: h.rank,
        last_reward_amount: null,
        last_reward_at: null,
        updated_at: new Date().toISOString(),
      }))

      return NextResponse.json({ holders: formattedHolders })
    }

    return NextResponse.json({ holders: data })
  } catch (error) {
    console.error("[HOLDERS] Error:", error)
    // Fallback: try to fetch from chain
    try {
      const chainHolders = await getTopHolders()
      const formattedHolders = chainHolders.map((h) => ({
        id: `chain-${h.rank}`,
        wallet_address: h.wallet,
        pbtc_balance: h.balance,
        rank: h.rank,
        last_reward_amount: null,
        last_reward_at: null,
        updated_at: new Date().toISOString(),
      }))
      return NextResponse.json({ holders: formattedHolders })
    } catch (chainError) {
      return NextResponse.json({ holders: [] })
    }
  }
}
