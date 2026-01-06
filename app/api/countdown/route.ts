import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

const CYCLE_DURATION = 20 * 60 * 1000 // 20 minutes in milliseconds

export async function GET() {
  try {
    const supabase = getAdminClient()

    // Get the last completed buyback
    const { data: lastBuyback, error } = await supabase
      .from("buybacks")
      .select("completed_at")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      console.error("[COUNTDOWN] Supabase error:", error)
      return NextResponse.json({ error: "Failed to fetch buyback data" }, { status: 500 })
    }

    let nextBuybackTime: string

    if (lastBuyback?.completed_at) {
      // Calculate next buyback time based on last completed buyback
      const lastCompletedTime = new Date(lastBuyback.completed_at).getTime()
      nextBuybackTime = new Date(lastCompletedTime + CYCLE_DURATION).toISOString()
    } else {
      // No buybacks yet, start from now + 20 minutes
      nextBuybackTime = new Date(Date.now() + CYCLE_DURATION).toISOString()
    }

    return NextResponse.json({
      nextBuybackTime,
      cycleDuration: CYCLE_DURATION / 1000, // in seconds
    })
  } catch (error) {
    console.error("[COUNTDOWN] Error:", error)
    return NextResponse.json({ error: "Failed to calculate countdown" }, { status: 500 })
  }
}

