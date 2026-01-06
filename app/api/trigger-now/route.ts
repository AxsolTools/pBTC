import { NextResponse } from "next/server"
import { triggerBuybackNow } from "@/lib/buyback-trigger"

/**
 * Simple endpoint to trigger buyback immediately
 * GET or POST both work
 */
export async function GET() {
  try {
    console.log("[TRIGGER-NOW] Buyback triggered via /api/trigger-now")
    const result = await triggerBuybackNow()
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error("[TRIGGER-NOW] Error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to trigger buyback" },
      { status: 500 }
    )
  }
}

export async function POST() {
  return GET()
}

