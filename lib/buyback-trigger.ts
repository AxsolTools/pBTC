/**
 * Trigger buyback process - FULL PROCESS:
 * 1. Claim creator rewards (SOL)
 * 2. Buy pBTC tokens with 50% of claimed SOL
 * 3. Swap remaining 50% of claimed SOL to WSOL
 * 4. Distribute WSOL to top 25 holders
 * 
 * Can be called on startup or manually
 */
export async function triggerBuybackNow() {
  try {
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const cronSecret = process.env.CRON_SECRET

    const url = `${appUrl}/api/admin/trigger-buyback`
    
    console.log(`[BUYBACK-TRIGGER] ========================================`)
    console.log(`[BUYBACK-TRIGGER] 🚀 TRIGGERING FULL BUYBACK PROCESS`)
    console.log(`[BUYBACK-TRIGGER] URL: ${url}`)
    console.log(`[BUYBACK-TRIGGER] Steps: Claim → Buy pBTC (50%) → Swap SOL→WSOL (50%) → Distribute`)
    console.log(`[BUYBACK-TRIGGER] ========================================`)
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Buyback failed: ${response.status} - ${error}`)
    }

    const result = await response.json()
    console.log(`[BUYBACK-TRIGGER] ✅ FULL PROCESS COMPLETE:`)
    console.log(`[BUYBACK-TRIGGER] - Claimed: ${result.buyback?.solAmount || 0} SOL`)
    console.log(`[BUYBACK-TRIGGER] - Swapped to: ${result.buyback?.wsolAmount || 0} WSOL`)
    console.log(`[BUYBACK-TRIGGER] - Distributed to: ${result.distributions || 0} holders`)
    console.log(`[BUYBACK-TRIGGER] ========================================`)
    return result
  } catch (error) {
    console.error(`[BUYBACK-TRIGGER] ❌ Error triggering buyback:`, error)
    throw error
  }
}

