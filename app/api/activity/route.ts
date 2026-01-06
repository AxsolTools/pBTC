import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"
import { getOnChainActivities } from "@/lib/solana/activity"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // buyback, swap, distribution
    const limit = Number.parseInt(searchParams.get("limit") || "50")

    // PRIORITY: Get real-time activities from database (webhook events)
    // These are the live swaps/buys/sells coming in via webhooks
    let dbActivities: any[] = []
    try {
      const supabase = getAdminClient()
      let query = supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit * 2) // Get more to account for filtering

      if (type) {
        query = query.eq("type", type)
      }

      const { data, error } = await query

      if (!error && data) {
        dbActivities = data
        console.log(`[ACTIVITY] Found ${dbActivities.length} real-time activities from webhooks (database)`)
      } else if (error) {
        console.warn(`[ACTIVITY] Database query error: ${error.message}`)
      }
    } catch (dbError) {
      console.warn("[ACTIVITY] Could not fetch from database:", dbError)
    }

    // Fallback: Fetch historical on-chain activities if database is empty
    let onChainActivities: any[] = []
    if (dbActivities.length === 0) {
      console.log("[ACTIVITY] No webhook data found, fetching historical on-chain activities...")
      console.log(`[ACTIVITY] PBTC_TOKEN_MINT from env: ${process.env.PBTC_TOKEN_MINT ? `${process.env.PBTC_TOKEN_MINT.slice(0, 8)}...` : "NOT SET"}`)
      onChainActivities = await getOnChainActivities(limit)
      console.log(`[ACTIVITY] Found ${onChainActivities.length} historical on-chain activities`)
    }

    // Merge activities, prioritizing database (webhook) data
    const activityMap = new Map<string, any>()

    // Add database activities FIRST (these are real-time from webhooks)
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

    // Add on-chain activities only if not already in database (no duplicates)
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

    console.log(`[ACTIVITY] Returning ${activities.length} activities to frontend`)
    return NextResponse.json({ activities })
  } catch (error) {
    console.error("[ACTIVITY] Error:", error)
    console.error("[ACTIVITY] Error details:", error instanceof Error ? error.message : String(error))
    // Return empty array instead of 500 error so UI still displays
    return NextResponse.json({ 
      activities: [],
      error: error instanceof Error ? error.message : "Unknown error",
      debug: {
        mintConfigured: !!process.env.PBTC_TOKEN_MINT,
        heliusConfigured: !!process.env.HELIUS_API_KEY,
        devWalletConfigured: !!process.env.DEV_WALLET_PRIVATE_KEY,
      }
    })
  }
}
