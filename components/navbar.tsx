"use client"

import Link from "next/link"
import { PBTCLogo, PBTCLogoMark } from "./logo"

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <PBTCLogo size={36} />
          <PBTCLogoMark className="text-xl" />
        </Link>

        <div className="flex items-center gap-6">
          <a href="#terminal" className="text-sm text-muted hover:text-foreground transition-colors">
            Live Feed
          </a>
          <a href="#leaderboard" className="text-sm text-muted hover:text-foreground transition-colors">
            Leaderboard
          </a>
          <a
            href="https://solscan.io/token/HSLNfbLriUzmbVYxQKHpUcfKZwQbhdAU9D35aXRApump"
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
