import type React from "react"
import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
// Vercel Analytics removed - not needed on DigitalOcean
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
})

export const metadata: Metadata = {
  title: "pBTC | Physical Bitcoin - Automated Rewards",
  description:
    "Buybacks every 5 minutes. SOL rewards auto-wrapped to WSOL and distributed to top 25 holders. The legend of Casascius lives on.",
  generator: "v0.app",
  keywords: ["Bitcoin", "Solana", "pBTC", "Physical Bitcoin", "Crypto Rewards", "WSOL"],
  icons: {
    icon: [
      {
        url: "/pBTC.png",
        type: "image/png",
      },
    ],
  },
}

export const viewport: Viewport = {
  themeColor: "#09090B",
  colorScheme: "dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
        {/* Vercel Analytics removed - not needed on DigitalOcean */}
      </body>
    </html>
  )
}
