import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

const CYCLE_DURATION = 5 * 60 * 1000 // 5 minutes in milliseconds

export async function GET() {
  try {
    const supabase = getAdminClient()
    let nextBuybackTime: string
    const now = Date.now()

    // Step 1: Check for last completed buyback
    let lastBuyback = null
    try {
      const { data, error } = await supabase
        .from("buybacks")
        .select("completed_at")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single()

      // PGRST116 = no rows returned (that's okay)
      // PGRST205 = table doesn't exist (that's okay)
      if (!error || error.code === "PGRST116" || error.code === "PGRST205") {
        lastBuyback = data
      } else {
        console.warn("[COUNTDOWN] Error fetching buybacks:", error.code)
      }
    } catch (err) {
      console.warn("[COUNTDOWN] Could not fetch buybacks, continuing...")
    }

    if (lastBuyback?.completed_at) {
      // Calculate next buyback time based on last completed buyback
      const lastCompletedTime = new Date(lastBuyback.completed_at).getTime()
      const calculatedNext = lastCompletedTime + CYCLE_DURATION
      
      // If the calculated next time is in the past, restart the countdown from now
      if (calculatedNext < now) {
        console.log("[COUNTDOWN] Last buyback was too long ago, restarting countdown from now")
        nextBuybackTime = new Date(now + CYCLE_DURATION).toISOString()
        
        // Update countdown start time to now
        try {
          await supabase.from("system_config").upsert({
            key: "countdown_start_time",
            value: new Date().toISOString(),
          })
        } catch {
          // Table doesn't exist - that's okay
        }
      } else {
        nextBuybackTime = new Date(calculatedNext).toISOString()
      }
    } else {
      // No buybacks yet - check if we have a countdown start time in system_config
      let countdownConfig = null
      try {
        const { data, error } = await supabase
          .from("system_config")
          .select("value")
          .eq("key", "countdown_start_time")
          .single()

        if (!error || error.code === "PGRST116" || error.code === "PGRST205") {
          countdownConfig = data
        }
      } catch (configError: any) {
        // Table doesn't exist or no config - that's okay, we'll initialize
        console.log("[COUNTDOWN] No system_config table or no stored start time, initializing...")
      }

      if (countdownConfig?.value) {
        // Use stored countdown start time
        const startTime = new Date(countdownConfig.value).getTime()
        const cyclesSinceStart = Math.floor((now - startTime) / CYCLE_DURATION)
        const nextCycleStart = startTime + ((cyclesSinceStart + 1) * CYCLE_DURATION)
        
        // If the next cycle is in the past, restart from now
        if (nextCycleStart < now) {
          console.log("[COUNTDOWN] Stored start time is too old, restarting from now")
          const newStartTime = new Date().toISOString()
          try {
            await supabase.from("system_config").upsert({
              key: "countdown_start_time",
              value: newStartTime,
            })
          } catch {
            // Table doesn't exist - that's okay
          }
          nextBuybackTime = new Date(now + CYCLE_DURATION).toISOString()
        } else {
          nextBuybackTime = new Date(nextCycleStart).toISOString()
        }
      } else {
        // First time - initialize countdown start time
        console.log("[COUNTDOWN] Initializing countdown for the first time")
        const startTime = new Date().toISOString()
        
        // Try to store it in Supabase (if table exists)
        try {
          await supabase.from("system_config").upsert({
            key: "countdown_start_time",
            value: startTime,
          })
          console.log("[COUNTDOWN] Stored countdown start time in Supabase")
        } catch (storeError: any) {
          // Table doesn't exist yet - that's okay, we'll still return a countdown
          console.log("[COUNTDOWN] Could not store in Supabase (table may not exist), using in-memory countdown")
        }
        
        nextBuybackTime = new Date(now + CYCLE_DURATION).toISOString()
      }
    }

    console.log(`[COUNTDOWN] Next buyback time: ${nextBuybackTime}`)

    return NextResponse.json({
      nextBuybackTime,
      cycleDuration: CYCLE_DURATION / 1000, // in seconds
    })
  } catch (error) {
    console.error("[COUNTDOWN] Error:", error)
    // Even on error, return a countdown starting from now
    const fallbackTime = new Date(Date.now() + CYCLE_DURATION).toISOString()
    return NextResponse.json({
      nextBuybackTime: fallbackTime,
      cycleDuration: CYCLE_DURATION / 1000,
    })
  }
}

