/**
 * Next.js instrumentation hook
 * Runs once when the server starts
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only run on server startup, not in edge runtime
    console.log('[STARTUP] Server starting, triggering initial buyback...')
    
    // Wait a bit for server to be ready
    setTimeout(async () => {
      try {
        const { triggerBuybackNow } = await import('./lib/buyback-trigger')
        await triggerBuybackNow()
        console.log('[STARTUP] ✅ Initial buyback triggered successfully')
      } catch (error) {
        console.error('[STARTUP] ❌ Failed to trigger initial buyback:', error)
      }
    }, 5000) // Wait 5 seconds for server to be ready
  }
}

