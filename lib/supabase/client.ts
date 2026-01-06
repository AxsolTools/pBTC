import { createBrowserClient } from "@supabase/ssr"

let client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (client) return client

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Return null-safe client that won't crash the app
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("[pBTC] Supabase credentials not configured")
    return createMockClient()
  }

  client = createBrowserClient(supabaseUrl, supabaseAnonKey)
  return client
}

// Mock client for when Supabase isn't configured
function createMockClient() {
  return {
    channel: () => ({
      on: () => ({ subscribe: () => {} }),
      subscribe: () => {},
    }),
    removeChannel: () => {},
    from: () => ({
      select: () => ({ data: null, error: null }),
      insert: () => ({ data: null, error: null }),
      update: () => ({ data: null, error: null }),
    }),
  } as any
}
