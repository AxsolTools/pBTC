import { HELIUS_API_KEY, PBTC_TOKEN_MINT } from "./connection"

/**
 * Subscribe to real-time transactions for token mint using Helius WebSocket
 * Returns a WebSocket connection that emits swap events
 */
export function subscribeToTokenSwaps(
  onSwap: (swap: {
    signature: string
    type: "buy" | "sell"
    amount: number
    wallet: string
    timestamp: number
  }) => void,
): WebSocket | null {
  if (!HELIUS_API_KEY || !PBTC_TOKEN_MINT) {
    console.error("[WEBSOCKET] Missing HELIUS_API_KEY or PBTC_TOKEN_MINT")
    return null
  }

  // Helius WebSocket URL
  const wsUrl = `wss://atlas-mainnet.helius-rpc.com?api-key=${HELIUS_API_KEY}`
  
  const ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    console.log("[WEBSOCKET] Connected to Helius")
    
    // Subscribe to transactions involving the token mint
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "token-swap-sub",
        method: "transactionSubscribe",
        params: [
          {
            accountInclude: [PBTC_TOKEN_MINT],
            failed: false, // Only successful transactions
          },
          {
            commitment: "confirmed",
            encoding: "jsonParsed",
            transactionDetails: "full",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
    )
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)

      // Handle subscription confirmation
      if (data.id === "token-swap-sub" && data.result) {
        console.log("[WEBSOCKET] Subscribed to token mint transactions")
        return
      }

      // Handle transaction notifications
      if (data.method === "transactionNotification" && data.params?.result) {
        const tx = data.params.result.transaction
        const meta = data.params.result.meta

        if (!tx || !meta) return

        // Check if this is a swap (has token transfers involving our mint and WSOL)
        const postBalances = meta.postTokenBalances || []
        const preBalances = meta.preTokenBalances || []

        const hasTokenMint = postBalances.some((b: any) => b.mint === PBTC_TOKEN_MINT)
        const hasWSOL = postBalances.some((b: any) => b.mint === "So11111111111111111111111111111111111111112")

        if (hasTokenMint && hasWSOL) {
          // Calculate swap amount and direction
          let solAmount = 0
          let wallet = ""
          let isBuy = false

          // Find WSOL transfer amount
          for (const postBalance of postBalances) {
            if (postBalance.mint === "So11111111111111111111111111111111111111112") {
              const preBalance = preBalances.find(
                (b: any) => b.accountIndex === postBalance.accountIndex && b.mint === postBalance.mint,
              )

              const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount?.uiAmountString || "0") : 0
              const postAmount = parseFloat(postBalance.uiTokenAmount?.uiAmountString || "0")
              solAmount = Math.abs(postAmount - preAmount)
              wallet = postBalance.owner || ""
            }
          }

          // Find token mint transfer to determine buy/sell
          for (const postBalance of postBalances) {
            if (postBalance.mint === PBTC_TOKEN_MINT) {
              const preBalance = preBalances.find(
                (b: any) => b.accountIndex === postBalance.accountIndex && b.mint === postBalance.mint,
              )

              const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount?.uiAmountString || "0") : 0
              const postAmount = parseFloat(postBalance.uiTokenAmount?.uiAmountString || "0")
              
              // If token amount increased, it's a buy
              if (postAmount > preAmount) {
                isBuy = true
                wallet = postBalance.owner || wallet
              }
            }
          }

          if (solAmount > 0.01) {
            const signature = tx.signatures[0]
            const blockTime = data.params.result.blockTime || Math.floor(Date.now() / 1000)

            onSwap({
              signature,
              type: isBuy ? "buy" : "sell",
              amount: solAmount,
              wallet,
              timestamp: blockTime * 1000, // Convert to milliseconds
            })
          }
        }
      }
    } catch (error) {
      console.error("[WEBSOCKET] Error parsing message:", error)
    }
  }

  ws.onerror = (error) => {
    console.error("[WEBSOCKET] Error:", error)
  }

  ws.onclose = () => {
    console.log("[WEBSOCKET] Connection closed")
  }

  return ws
}

