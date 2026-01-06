import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  try {
    const supabase = getAdminClient()

    let totalBoughtBack = 0
    let totalDistributed = 0
    let uniqueHoldersRewarded = 0

    // Get aggregated stats with error handling for missing tables
    try {
      const buybacksResult = await supabase
        .from("buybacks")
        .select("sol_amount, wbtc_amount")
        .eq("status", "completed")

      // PGRST116 = no rows, PGRST205 = table doesn't exist
      if (!buybacksResult.error || buybacksResult.error.code === "PGRST116" || buybacksResult.error.code === "PGRST205") {
        totalBoughtBack = buybacksResult.data?.reduce((sum, b) => sum + (Number(b.sol_amount) || 0), 0) || 0
      } else {
        console.warn("[STATS] Error fetching buybacks:", buybacksResult.error.code)
      }
    } catch (err) {
      console.warn("[STATS] Could not fetch buybacks, using 0")
    }

    try {
      const distributionsResult = await supabase
        .from("distributions")
        .select("wbtc_amount, wallet_address")
        .eq("status", "completed")

      if (!distributionsResult.error || distributionsResult.error.code === "PGRST116" || distributionsResult.error.code === "PGRST205") {
        totalDistributed = distributionsResult.data?.reduce((sum, d) => sum + (Number(d.wbtc_amount) || 0), 0) || 0
        uniqueHoldersRewarded = new Set(distributionsResult.data?.map((d) => d.wallet_address) || []).size
      } else {
        console.warn("[STATS] Error fetching distributions:", distributionsResult.error.code)
      }
    } catch (err) {
      console.warn("[STATS] Could not fetch distributions, using 0")
    }

    return NextResponse.json({
      totalBoughtBack,
      totalDistributed,
      holdersRewarded: uniqueHoldersRewarded,
    })
  } catch (error) {
    console.error("[STATS] Error:", error)
    // Return zeros instead of error so UI still displays
    return NextResponse.json({
      totalBoughtBack: 0,
      totalDistributed: 0,
      holdersRewarded: 0,
    })
  }
}
