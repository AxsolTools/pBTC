import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { getOnChainActivities } from "@/lib/solana/activity"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // buyback, swap, distribution
    const limit = Number.parseInt(searchParams.get("limit") || "50")

    // Always fetch real-time on-chain activities first
    console.log("[ACTIVITY] Fetching real-time on-chain activities...")
    const onChainActivities = await getOnChainActivities(limit)

    // Also get activities from database (backend operations)
    let dbActivities: any[] = []
    try {
      const supabase = getAdminClient()
      let query = supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit)

      if (type) {
        query = query.eq("type", type)
      }

      const { data, error } = await query

      if (!error && data) {
        dbActivities = data
      }
    } catch (dbError) {
      // Database table doesn't exist or error - that's okay, we have on-chain data
      console.log("[ACTIVITY] Could not fetch from database, using on-chain data only")
    }

    // Merge on-chain and database activities, removing duplicates by tx_signature
    const activityMap = new Map<string, any>()

    // Add database activities first (these are from our backend operations)
    for (const activity of dbActivities) {
      if (activity.tx_signature) {
        activityMap.set(activity.tx_signature, {
          id: activity.id || `db-${activity.tx_signature}`,
          type: activity.type,
          amount: parseFloat(activity.amount),
          token_symbol: activity.token_symbol,
          wallet_address: activity.wallet_address,
          tx_signature: activity.tx_signature,
          status: activity.status || "completed",
          created_at: activity.created_at,
        })
      }
    }

    // Add on-chain activities (real-time swaps and transactions)
    for (const activity of onChainActivities) {
      if (!activityMap.has(activity.tx_signature)) {
        activityMap.set(activity.tx_signature, {
          id: `chain-${activity.tx_signature}`,
          type: activity.type,
          amount: activity.amount,
          token_symbol: activity.token_symbol,
          wallet_address: activity.wallet_address,
          tx_signature: activity.tx_signature,
          status: "completed",
          created_at: new Date(activity.timestamp).toISOString(),
        })
      }
    }

    // Convert to array and sort by timestamp
    let activities = Array.from(activityMap.values())
    activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Filter by type if specified
    if (type) {
      activities = activities.filter((a) => a.type === type)
    }

    // Limit results
    activities = activities.slice(0, limit)

    return NextResponse.json({ activities })
  } catch (error) {
    console.error("[ACTIVITY] Error:", error)
    // Return empty array instead of 500 error so UI still displays
    return NextResponse.json({ activities: [] })
  }
}
