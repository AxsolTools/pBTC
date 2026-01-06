"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { StatsCard } from "./stats-card"

const LORE_TEXT = `A Sad Day for Physical Bitcoin Collectors — In 2012, a collector acquired a 100 BTC Casascius physical bar for approximately $500. After years of diamond hands, watching Bitcoin cross unprecedented highs, the legendary piece was finally redeemed. The bittersweet twist: a moment of carelessness exposed the private key, and ~$40k in BCH forks vanished before they could be claimed. A reminder that in crypto, every detail matters.`

export function Hero() {
  const [displayedText, setDisplayedText] = useState("")
  const [isTyping, setIsTyping] = useState(true)

  useEffect(() => {
    if (displayedText.length < LORE_TEXT.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(LORE_TEXT.slice(0, displayedText.length + 1))
      }, 20)
      return () => clearTimeout(timeout)
    } else {
      setIsTyping(false)
    }
  }, [displayedText])

  return (
    <section className="relative min-h-screen pt-24 pb-12">
      {/* Background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(212,175,55,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(212,175,55,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid gap-12 lg:grid-cols-5">
          {/* Left: Lore & Headlines */}
          <div className="lg:col-span-3 flex flex-col justify-center">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-5xl font-bold tracking-tight text-gold md:text-6xl lg:text-7xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              PHYSICAL
              <br />
              <span className="text-foreground">BITCOIN</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mt-4 text-lg text-gold-muted"
            >
              Buybacks. Swaps. Distributions. Every 20 minutes.
            </motion.p>

            {/* Lore typewriter */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-8 rounded-lg border border-border bg-surface p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="h-2 w-2 rounded-full bg-gold animate-pulse" />
                <span className="text-xs text-gold-muted font-mono uppercase tracking-wider">The Legend</span>
              </div>
              <p className="font-mono text-sm leading-relaxed text-muted">
                {displayedText}
                {isTyping && <span className="inline-block w-2 h-4 ml-1 bg-gold animate-pulse" />}
              </p>
            </motion.div>

            <motion.a
              href="#terminal"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="mt-8 inline-flex w-fit items-center justify-center rounded-md bg-gold px-8 py-3 text-sm font-semibold text-background transition-all hover:bg-gold-bright hover:shadow-[0_0_30px_rgba(212,175,55,0.4)]"
            >
              VIEW LIVE FEED
            </motion.a>
          </div>

          {/* Right: Stats */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <StatsCard />
          </div>
        </div>
      </div>
    </section>
  )
}
