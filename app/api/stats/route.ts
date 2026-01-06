import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  try {
    const supabase = getAdminClient()

    // Get aggregated stats
    const [buybacksResult, distributionsResult, holdersResult] = await Promise.all([
      supabase.from("buybacks").select("sol_amount, wbtc_amount").eq("status", "completed"),
      supabase.from("distributions").select("wbtc_amount, wallet_address").eq("status", "completed"),
      supabase.from("holders").select("*").order("rank", { ascending: true }).limit(25),
    ])

    const totalBoughtBack = buybacksResult.data?.reduce((sum, b) => sum + (Number(b.sol_amount) || 0), 0) || 0

    const totalDistributed = distributionsResult.data?.reduce((sum, d) => sum + (Number(d.wbtc_amount) || 0), 0) || 0

    const uniqueHoldersRewarded = new Set(distributionsResult.data?.map((d) => d.wallet_address) || []).size

    return NextResponse.json({
      totalBoughtBack,
      totalDistributed,
      holdersRewarded: uniqueHoldersRewarded,
      topHolders: holdersResult.data || [],
    })
  } catch (error) {
    console.error("[STATS] Error:", error)
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
