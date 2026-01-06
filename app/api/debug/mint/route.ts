import { NextResponse } from "next/server"
import { PBTC_TOKEN_MINT } from "@/lib/solana/connection"

/**
 * Debug endpoint to check if PBTC_TOKEN_MINT is configured
 */
export async function GET() {
  const mint = PBTC_TOKEN_MINT
  const envMint = process.env.PBTC_TOKEN_MINT
  
  return NextResponse.json({
    configured: !!mint && mint.length > 0,
    mint: mint || "NOT SET",
    envVar: envMint ? `${envMint.slice(0, 8)}...` : "NOT SET",
    envVarLength: envMint?.length || 0,
  })
}

