"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import useSWR from "swr"
import { createClient } from "@/lib/supabase/client"

const fetcher = async (url: string) => {
  try {
    const res = await fetch(url)
    if (!res.ok) return { activities: [] }
    return res.json()
  } catch {
    return { activities: [] }
  }
}

interface Activity {
  id: string
  type: "buyback" | "swap" | "distribution"
  amount: number
  token_symbol: string
  wallet_address?: string
  tx_signature?: string
  status: string
  created_at: string
}

function ActivityCard({ activity, isNew }: { activity: Activity; isNew: boolean }) {
  const typeColors = {
    buyback: "border-gold",
    swap: "border-warning",
    distribution: "border-success",
  }

  const typeLabels = {
    buyback: "BUYBACK",
    swap: "SWAP",
    distribution: "REWARD",
  }

  const timeSince = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    return `${Math.floor(seconds / 3600)}h ago`
  }

  return (
    <motion.div
      initial={isNew ? { x: 100, opacity: 0 } : false}
      animate={{ x: 0, opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className={`relative overflow-hidden rounded border ${typeColors[activity.type]} bg-surface p-3`}
    >
      {/* Scan line effect for new items */}
      {isNew && (
        <motion.div
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-gold/20 to-transparent"
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-mono font-bold ${
                activity.type === "buyback" ? "text-gold" : activity.type === "swap" ? "text-warning" : "text-success"
              }`}
            >
              {typeLabels[activity.type]}
            </span>
            <span className="text-xs text-muted font-mono">{timeSince(activity.created_at)}</span>
          </div>

          <p className="font-mono text-sm text-foreground">
            {activity.amount.toFixed(6)} {activity.token_symbol}
          </p>

          {activity.wallet_address && (
            <p className="font-mono text-xs text-muted">
              → {activity.wallet_address.slice(0, 4)}...{activity.wallet_address.slice(-4)}
            </p>
          )}
        </div>

        {activity.tx_signature && (
          <a
            href={`https://solscan.io/tx/${activity.tx_signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gold-muted hover:text-gold font-mono"
          >
            {activity.tx_signature.slice(0, 4)}...
          </a>
        )}
      </div>
    </motion.div>
  )
}

function ActivityColumn({
  type,
  title,
  activities,
  newIds,
}: {
  type: string
  title: string
  activities: Activity[]
  newIds: Set<string>
}) {
  const filtered = activities.filter((a) => a.type === type)
  const statusColor = filtered.length > 0 ? "bg-success" : "bg-muted"

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-4 py-3">
        <div className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-xs font-mono font-bold text-foreground tracking-wider">{title}</span>
        <span className="text-xs font-mono text-muted ml-auto">{filtered.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[500px]">
        <AnimatePresence mode="popLayout">
          {filtered.map((activity, index) => (
            <ActivityCard key={activity.id} activity={activity} isNew={newIds.has(activity.id)} />
          ))}
        </AnimatePresence>

        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted text-sm font-mono">Awaiting activity...</div>
        )}
      </div>
    </div>
  )
}

export function ActivityTerminal() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  const { data } = useSWR("/api/activity?limit=50", fetcher, {
    refreshInterval: 10000,
    onSuccess: (data) => {
      if (data?.activities) {
        setActivities(data.activities)
      }
    },
  })

  useEffect(() => {
    let channel: any = null

    try {
      const supabase = createClient()
      if (!supabase) return

      channel = supabase
        .channel("activity-realtime")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, (payload: any) => {
          const newActivity = payload.new as Activity
          setNewIds((prev) => new Set(prev).add(newActivity.id))
          setActivities((prev) => [newActivity, ...prev].slice(0, 50))

          setTimeout(() => {
            setNewIds((prev) => {
              const next = new Set(prev)
              next.delete(newActivity.id)
              return next
            })
          }, 2000)
        })
        .subscribe()
    } catch (err) {
      console.warn("[pBTC] Realtime subscription failed:", err)
    }

    return () => {
      if (channel) {
        try {
          const supabase = createClient()
          supabase?.removeChannel(channel)
        } catch {}
      }
    }
  }, [])

  return (
    <section id="terminal" className="py-12">
      <div className="mx-auto w-full px-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-gold animate-pulse" />
          <h2 className="text-lg font-mono font-bold tracking-wider text-foreground">LIVE TERMINAL</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border">
          <div className="bg-background">
            <ActivityColumn type="buyback" title="BUYBACKS" activities={activities} newIds={newIds} />
          </div>
          <div className="bg-background">
            <ActivityColumn type="swap" title="SWAPS" activities={activities} newIds={newIds} />
          </div>
          <div className="bg-background">
            <ActivityColumn type="distribution" title="DISTRIBUTIONS" activities={activities} newIds={newIds} />
          </div>
        </div>
      </div>
    </section>
  )
}
