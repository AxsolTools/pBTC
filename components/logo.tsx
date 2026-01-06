"use client"

export function PBTCLogo({ className = "", size = 48 }: { className?: string; size?: number }) {
  return (
    <img
      src="/pBTC.png"
      alt="pBTC Logo"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, display: 'block' }}
    />
  )
}

export function PBTCLogoMark({ className = "" }: { className?: string }) {
  return <span className={`text-gold font-bold tracking-wider ${className}`}>pBTC</span>
}
