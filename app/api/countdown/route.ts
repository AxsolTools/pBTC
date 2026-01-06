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
      const calculatedNext = lastCompletedTime + CYCLE_DURATION
      const now = Date.now()
      
      // If the calculated next time is in the past, calculate from the last buyback
      // by finding the next 20-minute interval
      if (calculatedNext < now) {
        const cyclesSinceLast = Math.floor((now - lastCompletedTime) / CYCLE_DURATION) + 1
        nextBuybackTime = new Date(lastCompletedTime + (cyclesSinceLast * CYCLE_DURATION)).toISOString()
      } else {
        nextBuybackTime = new Date(calculatedNext).toISOString()
      }
    } else {
      // No buybacks yet - use a fixed schedule starting from a reference time
      // This ensures the countdown is global and doesn't reset on refresh
      // Use a fixed reference: January 1, 2024 00:00:00 UTC (or any fixed date)
      const REFERENCE_TIME = new Date("2024-01-01T00:00:00Z").getTime()
      const now = Date.now()
      const cyclesSinceReference = Math.floor((now - REFERENCE_TIME) / CYCLE_DURATION) + 1
      nextBuybackTime = new Date(REFERENCE_TIME + (cyclesSinceReference * CYCLE_DURATION)).toISOString()
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

