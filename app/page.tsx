import { Navbar } from "@/components/navbar"
import { Hero } from "@/components/hero"
import { Countdown } from "@/components/countdown"
import { ActivityTerminal } from "@/components/activity-terminal"
import { Leaderboard } from "@/components/leaderboard"
import { Footer } from "@/components/footer"

export default function Home() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />
      <Countdown />
      <ActivityTerminal />
      <Leaderboard />
      <Footer />
    </main>
  )
}
