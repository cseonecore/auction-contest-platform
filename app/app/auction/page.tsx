import { Metadata } from "next"
import { ParticipantAuctionRoom } from "@/features/auction/components/ParticipantAuctionRoom"

export const metadata: Metadata = {
  title: "Live Bidding Arena | Bid2Build Auction Contest",
  description: "Live real-time problem statement bidding arena for the Bid2Build contest.",
}

export default function AuctionPage() {
  return <ParticipantAuctionRoom />
}


