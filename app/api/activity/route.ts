import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // buyback, swap, distribution
    const limit = Number.parseInt(searchParams.get("limit") || "20")

    const supabase = getAdminClient()

    let query = supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit)

    if (type) {
      query = query.eq("type", type)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ activities: data })
  } catch (error) {
    console.error("[ACTIVITY] Error:", error)
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })
  }
}
