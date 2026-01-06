"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import useSWR from "swr"
import { createClient } from "@/lib/supabase/client"

const fetcher = async (url: string) => {
  try {
    const res = await fetch(url)
    if (!res.ok) return { totalBoughtBack: 0, totalDistributed: 0, holdersRewarded: 0 }
    return res.json()
  } catch {
    return { totalBoughtBack: 0, totalDistributed: 0, holdersRewarded: 0 }
  }
}

function FlipNumber({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    setDisplayValue(value)
  }, [value])

  const formatted = displayValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })

  return (
    <span className="font-mono text-3xl font-bold text-gold tabular-nums">
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}

export function StatsCard() {
  const [stats, setStats] = useState({
    totalBoughtBack: 0,
    totalDistributed: 0,
    holdersRewarded: 0,
  })

  // Fetch initial stats and poll for updates
  const { data, error, mutate } = useSWR("/api/stats", fetcher, {
    refreshInterval: 10000, // Poll every 10 seconds
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  })

  // Update stats when data changes
  useEffect(() => {
    if (data) {
      setStats({
        totalBoughtBack: data.totalBoughtBack || 0,
        totalDistributed: data.totalDistributed || 0,
        holdersRewarded: data.holdersRewarded || 0,
      })
    }
  }, [data])

  // Real-time Supabase subscriptions for instant updates
  useEffect(() => {
    let channels: any[] = []

    try {
      const supabase = createClient()
      if (!supabase) return

      // Subscribe to buybacks table for real-time updates
      const buybacksChannel = supabase
        .channel("stats-buybacks")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "buybacks",
            filter: "status=eq.completed",
          },
          () => {
            // Refetch stats when buyback is completed
            mutate()
          },
        )
        .subscribe()

      // Subscribe to distributions table for real-time updates
      const distributionsChannel = supabase
        .channel("stats-distributions")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "distributions",
            filter: "status=eq.completed",
          },
          () => {
            // Refetch stats when distribution is completed
            mutate()
          },
        )
        .subscribe()

      channels = [buybacksChannel, distributionsChannel]
    } catch (err) {
      console.warn("[STATS] Realtime subscription failed:", err)
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

  const statsList = [
    {
      label: "TOTAL BOUGHT BACK",
      value: stats.totalBoughtBack,
      suffix: " SOL",
    },
    {
      label: "TOTAL DISTRIBUTED",
      value: stats.totalDistributed,
      suffix: " WSOL",
    },
    {
      label: "HOLDERS REWARDED",
      value: stats.holdersRewarded,
      suffix: "",
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, delay: 0.4 }}
      className="rounded-lg border border-border bg-surface p-6"
    >
      <div className="flex items-center gap-2 mb-6">
        <div className="h-2 w-2 rounded-full bg-success" />
        <span className="text-xs text-muted font-mono uppercase tracking-wider">System Status: Active</span>
      </div>

      <div className="space-y-6">
        {statsList.map((stat, index) => (
          <div key={stat.label} className="space-y-1">
            <p className="text-xs text-gold-muted font-mono tracking-wider">{stat.label}</p>
            <FlipNumber value={stat.value} suffix={stat.suffix} />
          </div>
        ))}
      </div>

      {/* Mini chart placeholder */}
      <div className="mt-6 h-24 rounded border border-border-subtle bg-background flex items-end gap-1 p-2">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-gold/30 rounded-sm transition-all hover:bg-gold/50"
            style={{ height: `${Math.random() * 80 + 10}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted font-mono">24h Activity</p>
    </motion.div>
  )
}
