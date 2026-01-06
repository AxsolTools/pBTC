import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase/admin"

export async function GET() {
  try {
    const supabase = getAdminClient()

    const { data, error } = await supabase.from("holders").select("*").order("rank", { ascending: true }).limit(25)

    if (error) throw error

    return NextResponse.json({ holders: data })
  } catch (error) {
    console.error("[HOLDERS] Error:", error)
    return NextResponse.json({ error: "Failed to fetch holders" }, { status: 500 })
  }
}
