"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import useSWR from "swr"

const CYCLE_DURATION = 20 * 60 // 20 minutes in seconds

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function Countdown() {
  const [timeLeft, setTimeLeft] = useState(CYCLE_DURATION)
  const [isUrgent, setIsUrgent] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch the last buyback time from the server
  const { data, isLoading: isDataLoading, error } = useSWR("/api/countdown", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 5000, // Refresh every 5 seconds to stay in sync
  })

  useEffect(() => {
    setIsLoading(isDataLoading)
  }, [isDataLoading])

  // Calculate time left based on server data
  useEffect(() => {
    if (!data?.nextBuybackTime) return

    const calculateTimeLeft = () => {
      const now = new Date().getTime()
      const nextBuyback = new Date(data.nextBuybackTime).getTime()
      const remaining = Math.max(0, Math.floor((nextBuyback - now) / 1000))

      setTimeLeft(remaining)
      setIsUrgent(remaining < 60)
    }

    calculateTimeLeft()

    // Update every second
    const interval = setInterval(calculateTimeLeft, 1000)
    return () => clearInterval(interval)
  }, [data?.nextBuybackTime])

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  const formatDigit = (num: number) => num.toString().padStart(2, "0")

  return (
    <section className="relative border-y border-border bg-surface py-8">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-center justify-center gap-4">
          <span className="text-xs text-gold-muted font-mono uppercase tracking-[0.2em]">Next Buyback In</span>

          <motion.div
            className={`flex items-center gap-2 font-mono text-5xl font-bold tracking-wider md:text-6xl ${
              isUrgent ? "text-warning" : "text-foreground"
            }`}
            animate={isUrgent ? { scale: [1, 1.02, 1] } : {}}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 0.5 }}
          >
            <span className="inline-flex flex-col items-center">
              <span className={`tabular-nums ${isUrgent ? "animate-pulse" : ""}`}>{formatDigit(minutes)}</span>
              <span className="text-xs text-muted mt-1">MIN</span>
            </span>
            <span className="text-gold mb-6">:</span>
            <span className="inline-flex flex-col items-center">
              <span className={`tabular-nums ${isUrgent ? "animate-pulse" : ""}`}>{formatDigit(seconds)}</span>
              <span className="text-xs text-muted mt-1">SEC</span>
            </span>
          </motion.div>

          {/* Progress bar */}
          <div className="w-full max-w-md h-1 bg-border rounded-full overflow-hidden">
            <motion.div
              className={`h-full ${isUrgent ? "bg-warning" : "bg-gold"}`}
              initial={{ width: "100%" }}
              animate={{ width: `${(timeLeft / CYCLE_DURATION) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
