"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import useSWR from "swr"
import { createClient } from "@/lib/supabase/client"

const fetcher = async (url: string) => {
  try {
    const res = await fetch(url)
    if (!res.ok) return { holders: [] }
    return res.json()
  } catch {
    return { holders: [] }
  }
}

interface Holder {
  id: string
  wallet_address: string
  pbtc_balance: number
  rank: number
  last_reward_amount: number | null
  last_reward_at: string | null
}

function HolderRow({ holder, isHighlighted }: { holder: Holder; isHighlighted: boolean }) {
  const formatBalance = (balance: number) => {
    if (balance >= 1_000_000) return `${(balance / 1_000_000).toFixed(2)}M`
    if (balance >= 1_000) return `${(balance / 1_000).toFixed(2)}K`
    return balance.toFixed(2)
  }

  const timeSince = (date: string | null) => {
    if (!date) return "—"
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`border-b border-border-subtle transition-colors ${
        isHighlighted ? "bg-gold/10" : "hover:bg-surface-elevated"
      } ${holder.rank <= 3 ? "bg-gradient-to-r from-gold/5 to-transparent" : ""}`}
    >
      <td className="py-3 px-4 font-mono text-sm">
        <span className={`${holder.rank <= 3 ? "text-gold font-bold" : "text-muted"}`}>#{holder.rank}</span>
      </td>
      <td className="py-3 px-4 font-mono text-sm text-foreground">
        {holder.wallet_address.slice(0, 4)}...{holder.wallet_address.slice(-4)}
      </td>
      <td className="py-3 px-4 font-mono text-sm text-foreground text-right tabular-nums">
        {formatBalance(holder.pbtc_balance)} pBTC
      </td>
      <td className="py-3 px-4 font-mono text-sm text-right">
        {holder.last_reward_amount ? (
          <span className="text-success">+{holder.last_reward_amount.toFixed(6)} WSOL</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="py-3 px-4 font-mono text-xs text-muted text-right">{timeSince(holder.last_reward_at)}</td>
    </motion.tr>
  )
}

export function Leaderboard() {
  const [holders, setHolders] = useState<Holder[]>([])
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set())

  const { data, mutate } = useSWR("/api/holders", fetcher, {
    refreshInterval: 10000, // Poll every 10 seconds for on-chain data
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    onSuccess: (data) => {
      if (data?.holders) {
        setHolders(data.holders)
      }
    },
  })

  // Real-time Supabase subscriptions for instant updates
  useEffect(() => {
    const channels: any[] = []

    try {
      const supabase = createClient()
      if (!supabase) return

      // Subscribe to holders table for reward updates
      const holdersChannel = supabase
        .channel("holders-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "holders" }, (payload: any) => {
          const updated = payload.new as Holder

          // Highlight the updated holder
          setHighlightedIds((prev) => new Set(prev).add(updated.id))
          
          // Update the holder in the list
          setHolders((prev) => {
            const existing = prev.find((h) => h.id === updated.id)
            if (existing) {
              return prev.map((h) => (h.id === updated.id ? updated : h))
            } else {
              // New holder, refetch all to get sorted list
              mutate()
              return prev
            }
          })

          setTimeout(() => {
            setHighlightedIds((prev) => {
              const next = new Set(prev)
              next.delete(updated.id)
              return next
            })
          }, 3000)
        })
        .subscribe()
      channels.push(holdersChannel)

      // Subscribe to distributions table - when distributions happen, holders get updated
      const distributionsChannel = supabase
        .channel("distributions-holders-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "distributions" }, () => {
          // Refetch holders when distributions complete (rewards are updated)
          mutate()
        })
        .subscribe()
      channels.push(distributionsChannel)

      // Subscribe to buybacks table - when buyback completes, holders list might change
      const buybacksChannel = supabase
        .channel("buybacks-holders-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "buybacks", filter: "status=eq.completed" }, () => {
          // Refetch holders when buyback completes (new snapshot taken)
          mutate()
        })
        .subscribe()
      channels.push(buybacksChannel)
    } catch (err) {
      console.warn("[LEADERBOARD] Realtime subscription failed:", err)
    }

    return () => {
      channels.forEach((channel) => {
        try {
          const supabase = createClient()
          supabase?.removeChannel(channel)
        } catch {}
      })
    }
  }, [mutate])

  return (
    <section id="leaderboard" className="py-12 border-t border-border">
      <div className="mx-auto w-full px-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-gold" />
            <h2 className="text-lg font-mono font-bold tracking-wider text-foreground">TOP 25 HOLDERS</h2>
          </div>
          <span className="text-xs font-mono text-muted">Updated in real-time</span>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface">
              <tr className="border-b border-border">
                <th className="py-3 px-4 text-left text-xs font-mono font-bold text-gold-muted tracking-wider">RANK</th>
                <th className="py-3 px-4 text-left text-xs font-mono font-bold text-gold-muted tracking-wider">
                  WALLET
                </th>
                <th className="py-3 px-4 text-right text-xs font-mono font-bold text-gold-muted tracking-wider">
                  HOLDINGS
                </th>
                <th className="py-3 px-4 text-right text-xs font-mono font-bold text-gold-muted tracking-wider">
                  LAST REWARD
                </th>
                <th className="py-3 px-4 text-right text-xs font-mono font-bold text-gold-muted tracking-wider">
                  TIME
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {holders.map((holder) => (
                  <HolderRow key={holder.id} holder={holder} isHighlighted={highlightedIds.has(holder.id)} />
                ))}
              </AnimatePresence>

              {holders.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted font-mono">
                    Loading holders...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
