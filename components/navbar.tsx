"use client"

import { PBTCLogo, PBTCLogoMark } from "./logo"

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <PBTCLogo size={36} />
          <PBTCLogoMark className="text-xl" />
        </div>

        <div className="flex items-center gap-6">
          <a href="#terminal" className="text-sm text-muted hover:text-foreground transition-colors">
            Live Feed
          </a>
          <a href="#leaderboard" className="text-sm text-muted hover:text-foreground transition-colors">
            Leaderboard
          </a>
          <a
            href="https://solscan.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Contract
          </a>
        </div>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
    </nav>
  )
}
