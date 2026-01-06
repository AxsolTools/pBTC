"use client"

import { useState } from "react"
import { PBTCLogo } from "./logo"

const CONTRACT_ADDRESS = "HSLNfbLriUzmbVYxQKHpUcfKZwQbhdAU9D35aXRApump"

export function Footer() {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(CONTRACT_ADDRESS)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto w-full px-6">
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between">
          <div className="flex items-center gap-3">
            <PBTCLogo size={28} />
            <span className="text-sm text-muted">Physical Bitcoin — Automated Rewards</span>
          </div>

          <div className="flex items-center gap-6">
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 text-xs font-mono text-muted hover:text-foreground transition-colors"
            >
              <span className="text-gold-muted">CA:</span>
              <span>
                {CONTRACT_ADDRESS.slice(0, 6)}...{CONTRACT_ADDRESS.slice(-4)}
              </span>
              <span className="text-gold">{copied ? "Copied!" : "Copy"}</span>
            </button>

            <a
              href="https://x.com/pbtc2011"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Twitter
            </a>
          </div>
        </div>

        <div className="mt-6 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />

        <p className="mt-6 text-center text-xs text-muted font-mono">
          Buybacks every 5 minutes • 0.1 SOL threshold • Top 25 holders
        </p>
      </div>
    </footer>
  )
}
