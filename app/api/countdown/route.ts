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

    // If table doesn't exist, treat as no buybacks yet
    if (error && error.code !== "PGRST116" && error.code !== "PGRST205") {
      // PGRST116 = no rows returned, PGRST205 = table doesn't exist
      console.error("[COUNTDOWN] Supabase error:", error)
      // Continue with no buybacks logic instead of returning error
    }

    let nextBuybackTime: string

    if (lastBuyback?.completed_at) {
      // Calculate next buyback time based on last completed buyback
      const lastCompletedTime = new Date(lastBuyback.completed_at).getTime()
      const calculatedNext = lastCompletedTime + CYCLE_DURATION
      const now = Date.now()
      
      // If the calculated next time is in the past, restart the countdown from now
      // This means if a buyback doesn't happen, the timer resets
      if (calculatedNext < now) {
        nextBuybackTime = new Date(now + CYCLE_DURATION).toISOString()
      } else {
        nextBuybackTime = new Date(calculatedNext).toISOString()
      }
    } else {
      // No buybacks yet - check if we have a countdown start time in system_config
      let countdownConfig = null
      try {
        const { data } = await supabase
          .from("system_config")
          .select("value")
          .eq("key", "countdown_start_time")
          .single()
        countdownConfig = data
      } catch (configError: any) {
        // Table doesn't exist or no config - that's okay, we'll use default
      }

      if (countdownConfig?.value) {
        // Use stored countdown start time
        const startTime = new Date(countdownConfig.value).getTime()
        const now = Date.now()
        const cyclesSinceStart = Math.floor((now - startTime) / CYCLE_DURATION) + 1
        nextBuybackTime = new Date(startTime + (cyclesSinceStart * CYCLE_DURATION)).toISOString()
      } else {
        // First time - try to store current time as countdown start (if table exists)
        try {
          const startTime = new Date().toISOString()
          await supabase.from("system_config").upsert({
            key: "countdown_start_time",
            value: startTime,
          })
        } catch {
          // Table doesn't exist yet - that's okay, we'll just use current time
        }
        nextBuybackTime = new Date(Date.now() + CYCLE_DURATION).toISOString()
      }
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

