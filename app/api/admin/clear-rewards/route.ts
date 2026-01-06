import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

/**
 * Clear all last_reward fields from holders table
 * This removes incorrect reward data when distributions didn't actually happen
 */
export async function POST() {
  try {
    const supabase = getAdminClient()
    
    // Clear all last_reward fields
    const { error } = await supabase
      .from("holders")
      .update({
        last_reward_amount: null,
        last_reward_at: null,
      })
      .neq("id", "") // Update all rows
    
    if (error) {
      console.error("[CLEAR-REWARDS] Error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    console.log("[CLEAR-REWARDS] ✅ Cleared all last_reward fields from holders table")
    return NextResponse.json({ 
      success: true, 
      message: "All reward data cleared from holders table" 
    })
  } catch (error) {
    console.error("[CLEAR-REWARDS] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear rewards" },
      { status: 500 }
    )
  }
}

